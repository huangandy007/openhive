import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { CaseDetailApi, 档案关系, 实体档案 } from "../case-detail-api"
import { 定位文本, 金额文本, 时间文本 } from "./format"

export interface EntityProfileProps {
  readonly projectId: string
  readonly id: string
  readonly api: CaseDetailApi
  /** 三个跳转；标题在这里拼（档案页手里有规范值，`CaseView` 只认路径）。 */
  readonly onOpen: (view: "timeline" | "money" | "graph", 标题: string) => void
}

type 纠正原因 = "识别错" | "抽取错" | "材料本身有问题"

const 裁决按钮类 = (押下: boolean) =>
  押下
    ? "h-7 rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[13px] font-semibold text-v2-text-text-base disabled:opacity-50"
    : "h-7 rounded-[4px] bg-v2-background-bg-layer-01 px-2 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover disabled:opacity-50"

/**
 * 实体档案（design §8.3）。
 *
 * 关系**分两段**：「数据说的」是抽取器直出的（`source_kind !== "human"`），「人说的」是民警
 * 认定过的。合并成一张表会让民警分不清哪条能当依据——这正是 §4.2 要区分 `data` / `human` 的理由。
 */
export function EntityProfile(props: EntityProfileProps): JSX.Element {
  const [档, set档] = createSignal<实体档案 | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()
  const [载入, set载入] = createSignal(false)
  // §9.1 / Global Constraint：已排除的事实默认不出现，档案页是唯一能「切换查看」的地方。
  // 开关状态**只由用户点它改变**：请求失败只进错误态，不回滚开关（否则用户会以为是自己点错了）。
  const [含排除, set含排除] = createSignal(false)

  // 纠正入口（design §9.2）：✓ 对 / ✗ 错 / ？存疑，只作用于这个实体本身。
  const [裁决中, set裁决中] = createSignal(false)
  const [展开原因, set展开原因] = createSignal(false)
  const [原因类型, set原因类型] = createSignal<纠正原因 | undefined>()
  const [原因说明, set原因说明] = createSignal("")
  // 裁决成功后 +1 ⇒ 下面的取数 effect 重跑，以服务端回包的 `trust_state` 为准。
  // **不在这里乐观改写档案**：裁决成功但重取失败时，界面该说的是「读不到档案」。
  const [重取序, set重取序] = createSignal(0)

  createEffect(() => {
    const projectId = props.projectId
    const id = props.id
    const api = props.api
    const 要排除 = 含排除()
    // 只为了订阅「重取」信号（值本身不参与取数），见上面的 `set重取序`。
    void 重取序()
    set档(undefined)
    set错误(undefined)
    set载入(true)
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（与 Task 5 同一处修过的坑，
    // `LEARNINGS #005-03`）。写成 `return () => …` 时迟到的回包会盖掉新实体的档案。
    // 开关切换也会重跑本 effect——旧请求同样要被作废，否则迟到的旧回包会盖掉新选择。
    onCleanup(() => {
      作废 = true
    })
    void api.profile(projectId, id, 要排除)
      .then((结果) => {
        if (作废) return
        set载入(false)
        if (结果.kind === "error") {
          set错误(结果.message)
          return
        }
        set档(结果.value)
      })
      // ⚠️ 必须接 rejection：不接就是「载入中」永远不散 ＋ 一条 unhandled rejection。失败与
      // `kind: "error"` 是同一件事（读不到档案），说法也只该有一种（同一个错误信号）。
      .catch((错误值: unknown) => {
        if (作废) return
        set载入(false)
        set错误(错误值 instanceof Error ? 错误值.message : "读取实体档案失败")
      })
  })

  const 数据说的 = createMemo(() => 档()?.关系.filter((行) => 行.source_kind !== "human") ?? [])
  const 人说的 = createMemo(() => 档()?.关系.filter((行) => 行.source_kind === "human") ?? [])

  /** 排除必须同时有原因类型与一句说明（design §9.2）。只判空，不改用户输入。 */
  const 可提交排除 = () => 原因类型() !== undefined && 原因说明().trim() !== ""

  /**
   * 发一次裁决。**成功后不乐观改界面**：收起原因区、清空输入，然后让取数 effect 重跑，
   * 信任态一律读服务端的。失败则保留原因区原文，直接可重试。
   *
   * 在途防重只靠按钮的 `disabled`（裁决中）——`.click()` / 真双击在按钮禁用后都不会再触发。
   */
  const 裁决 = async (
    action: "确认" | "排除" | "存疑",
    原因?: { readonly reasonKind: 纠正原因; readonly reasonText: string },
  ) => {
    set裁决中(true)
    set错误(undefined)
    try {
      const 回 = await props.api.trust({
        projectId: props.projectId,
        factType: "entity",
        factId: props.id,
        action,
        reasonKind: 原因?.reasonKind,
        reasonText: 原因?.reasonText,
      })
      if (回.kind === "error") {
        set错误(回.message)
        return
      }
      set展开原因(false)
      set原因类型(undefined)
      set原因说明("")
      set重取序((序) => 序 + 1)
    } catch (错误值) {
      // 客户端契约是「从不抛」，但夹具 / 将来换了实现仍可能抛：与 `kind:"error"` 同一个出口。
      set错误(错误值 instanceof Error ? 错误值.message : "提交裁决失败")
    } finally {
      set裁决中(false)
    }
  }

  return (
    <div data-component="entity-profile" class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-3 py-2">
      {/* 真实交互元素 + 文字标签（不是只靠颜色表达状态）：`aria-pressed` 也是状态的唯一判据。 */}
      <button
        type="button"
        data-slot="entity-profile-include-excluded"
        aria-pressed={含排除()}
        onClick={() => set含排除((值) => !值)}
        class={
          含排除()
            ? "mb-1 h-6 w-fit shrink-0 rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold text-v2-text-text-base"
            : "mb-1 h-6 w-fit shrink-0 rounded-[4px] px-2 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
        }
      >
        显示已排除
      </button>
      <Show when={错误()}>
        {(话) => (
          <p data-slot="entity-profile-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
            {话()}
          </p>
        )}
      </Show>
      <Show when={载入() && 档() === undefined}>
        <p data-slot="entity-profile-loading" class="text-[13px] text-v2-text-text-muted">
          正在读取实体档案…
        </p>
      </Show>
      <Show when={档()}>
        {(档) => (
          <>
            <div class="flex flex-wrap items-baseline gap-2">
              <h1 data-slot="entity-profile-title" class="text-[18px] font-semibold text-v2-text-text-base">
                {档().canonical_value}
              </h1>
              <span data-slot="entity-profile-type" class="rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-[12px] text-v2-text-text-muted">{档().type}</span>
              <span data-slot="entity-profile-trust-state" class="rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-[12px] text-v2-text-text-muted">{档().trust_state}</span>
            </div>
            <Show when={档().aliases.length > 0}>
              <p data-slot="entity-profile-aliases" class="mt-1 text-[13px] text-v2-text-text-muted">
                别名：{档().aliases.join("、")}
              </p>
            </Show>
            {/* 结论由服务端生成（§8.3）：同一份数据两次打开必须说同一句话。前端不拼第二份。 */}
            <p data-slot="entity-profile-conclusion" class="mt-2 text-[13px] text-v2-text-text-base">
              {档().一句话}
            </p>
            {/* 同一实体换视图：路径由 `CaseView` 拼（它手里有 projectId 与 id），标题在这里拼
                （档案页手里有规范值，关系图 / 时间线只拿到 id）。 */}
            <div class="mt-2 flex flex-wrap gap-1">
              <For each={[
                ["timeline", "时间线", "entity-open-timeline"],
                ["money", "资金", "entity-open-money"],
                ["graph", "关系图", "entity-open-graph"],
              ] as const}>
                {([视图, 文案, slot]) => (
                  <button
                    type="button"
                    data-slot={slot}
                    onClick={() => props.onOpen(视图, `${档().canonical_value} · ${文案}`)}
                    class="h-7 rounded-[4px] bg-v2-background-bg-layer-01 px-2 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                  >
                    {文案}
                  </button>
                )}
              </For>
            </div>
            {/* 服务端截断（关系 / 事件只列了前 N 条）就照实说，与清单的 `缺口` 同一套口径。
                省略这一块 = 把「只列了前 200 条」冒充成「就这 200 条」。 */}
            <For each={档().缺口 ?? []}>
              {(话) => (
                <p data-slot="entity-profile-gap" class="mt-1 text-[12px] text-v2-text-text-muted">
                  {话}
                </p>
              )}
            </For>

            <段 标题="数据说的" slot="entity-relations-data" 行们={数据说的()} />
            <Show when={人说的().length > 0}>
              <段 标题="人说的" slot="entity-relations-human" 行们={人说的()} />
            </Show>

            <h2 class="mt-4 text-[13px] font-semibold text-v2-text-text-base">事件</h2>
            <Show when={档().事件.length === 0}>
              <p class="text-[13px] text-v2-text-text-muted">没有共同事件</p>
            </Show>
            <For each={档().事件}>
              {(事件) => (
                <div data-slot="entity-event" class="border-b border-v2-border-border-muted py-1 text-[13px]">
                  <div class="text-v2-text-text-base">
                    {时间文本(事件.occurred_at)} · {事件.type}
                  </div>
                  <Show when={事件.summary}>{(话) => <div class="text-v2-text-text-muted">{话()}</div>}</Show>
                  <div class="text-[12px] text-v2-text-text-muted">{事件.participants.join("、")}</div>
                </div>
              )}
            </For>

            <h2 class="mt-4 text-[13px] font-semibold text-v2-text-text-base">出处</h2>
            <Show when={档().引用.length === 0}>
              <p class="text-[13px] text-v2-text-text-muted">没有登记出处</p>
            </Show>
            <For each={档().引用}>
              {(引用) => (
                <div data-slot="entity-citation" class="py-0.5 text-[13px] text-v2-text-text-base">
                  {引用.path ?? 引用.fileName ?? 引用.materialId}
                  <Show when={定位文本(引用.locator) !== ""}>
                    <span class="ml-1 text-[12px] text-v2-text-text-muted">{定位文本(引用.locator)}</span>
                  </Show>
                  <span class="ml-1 text-[12px] text-v2-text-text-muted">{引用.extractMethod}</span>
                </div>
              )}
            </For>

            {/* 纠正入口（design §9.2）：档案底部三按钮，作用于这个实体本身。
                形如「✓ 对」的符号是装饰，语义由可见文字与 `aria-label` 承担；
                当前态用 `aria-pressed` ＋ 顶部徽章的文字表达，不只靠颜色。 */}
            <div data-slot="entity-trust" class="mt-4 flex flex-wrap items-center gap-1 border-t border-v2-border-border-muted pt-2">
              <button
                type="button"
                data-slot="entity-trust-confirm"
                aria-label="这条事实对（确认）"
                aria-pressed={档().trust_state === "已确认"}
                disabled={裁决中()}
                onClick={() => void 裁决("确认")}
                class={裁决按钮类(档().trust_state === "已确认")}
              >
                ✓ 对
              </button>
              <button
                type="button"
                data-slot="entity-trust-reject"
                aria-label="这条事实有错（排除）"
                aria-pressed={档().trust_state === "已排除"}
                disabled={裁决中()}
                onClick={() => set展开原因(true)}
                class={裁决按钮类(档().trust_state === "已排除")}
              >
                ✗ 错
              </button>
              <button
                type="button"
                data-slot="entity-trust-doubt"
                aria-label="这条事实存疑"
                aria-pressed={档().trust_state === "存疑"}
                disabled={裁决中()}
                onClick={() => void 裁决("存疑")}
                class={裁决按钮类(档().trust_state === "存疑")}
              >
                ？存疑
              </button>
              <Show when={裁决中()}>
                <span data-slot="entity-trust-pending" role="status" class="text-[12px] text-v2-text-text-muted">
                  提交中…
                </span>
              </Show>
            </div>
            <Show when={展开原因()}>
              <div data-slot="entity-trust-reason" class="mt-1 w-full">
                <textarea
                  data-slot="entity-trust-reason-text"
                  aria-label="错在哪里（一句话）"
                  class="w-full rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 p-2 text-[13px] leading-6 text-v2-text-text-base"
                  rows={2}
                  placeholder="写一句话说明哪里错了"
                  value={原因说明()}
                  onInput={(事件) => set原因说明(事件.currentTarget.value)}
                />
                <div
                  data-slot="entity-trust-reason-kinds"
                  role="radiogroup"
                  aria-label="错误原因"
                  class="mt-1 flex flex-wrap gap-1"
                >
                  <For each={["识别错", "抽取错", "材料本身有问题"] as const}>
                    {(值) => (
                      <button
                        type="button"
                        role="radio"
                        data-slot="entity-trust-reason-kind"
                        data-kind={值}
                        aria-checked={原因类型() === 值}
                        disabled={裁决中()}
                        class={裁决按钮类(原因类型() === 值)}
                        onClick={() => set原因类型(值)}
                      >
                        {值}
                      </button>
                    )}
                  </For>
                </div>
                <div class="mt-1 flex gap-1">
                  <button
                    type="button"
                    data-slot="entity-trust-reason-submit"
                    disabled={裁决中() || !可提交排除()}
                    onClick={() => {
                      const 类型 = 原因类型()
                      if (类型 === undefined) return
                      void 裁决("排除", { reasonKind: 类型, reasonText: 原因说明() })
                    }}
                    class={裁决按钮类(false)}
                  >
                    提交
                  </button>
                  <button
                    type="button"
                    data-slot="entity-trust-reason-cancel"
                    disabled={裁决中()}
                    onClick={() => {
                      set展开原因(false)
                      set原因类型(undefined)
                      set原因说明("")
                    }}
                    class={裁决按钮类(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

function 段(props: { readonly 标题: string; readonly slot: string; readonly 行们: readonly 档案关系[] }): JSX.Element {
  return (
    <>
      <h2 class="mt-4 text-[13px] font-semibold text-v2-text-text-base">{props.标题}</h2>
      <Show when={props.行们.length === 0}>
        <p class="text-[13px] text-v2-text-text-muted">没有</p>
      </Show>
      <div data-slot={props.slot}>
        <For each={props.行们}>
          {(行) => (
            <div data-slot="entity-relation" data-source={行.source_kind} class="flex flex-wrap items-baseline gap-1 border-b border-v2-border-border-muted py-0.5 text-[13px]">
              <span class="text-v2-text-text-base">
                {行.方向 === "出" ? "→" : "←"} {行.对方值}
              </span>
              <span class="text-v2-text-text-muted">{行.type}</span>
              <span class="text-v2-text-text-muted">
                {行.次数 === null ? "—" : `${行.次数} 次`} · {金额文本(行.金额)}
              </span>
              <Show when={行.basis}>{(依据) => <span class="text-[12px] text-v2-text-text-muted">依据：{依据()}</span>}</Show>
              <span class="text-[12px] text-v2-text-text-muted">{行.trust_state}</span>
            </div>
          )}
        </For>
      </div>
    </>
  )
}
