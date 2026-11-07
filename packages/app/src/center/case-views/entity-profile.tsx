import { createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, Show, type JSX } from "solid-js"
import { EntityTypeBadge } from "../../components/entity-type-badge"
import {
  纠正原因们,
  type CaseDetailApi,
  type 档案事件,
  type 档案关系,
  type 实体档案,
  type 纠正原因,
} from "../case-detail-api"
import { 定位文本, 金额文本, 时间文本 } from "./format"

export interface EntityProfileProps {
  readonly projectId: string
  readonly id: string
  readonly api: CaseDetailApi
  /** 三个跳转；标题在这里拼（档案页手里有规范值，`CaseView` 只认路径）。 */
  readonly onOpen: (view: "timeline" | "money" | "graph", 标题: string) => void
}

// 悬停必须看得见，而在**不透明底**上这不容易，两代写法都被真栈否掉了：
// ① `hover:bg-v2-overlay-*`（4% 黑）直接顶掉不透明底 ⇒ 242 → 245，反而更亮；
// ② `hover:bg-v2-background-bg-layer-03` 换相邻一档灰 ⇒ 242 → 238，只差 4 个色阶。
// 设计系统的口径（`button-v2.css`）是**叠层**：`background-image` 铺 4% 黑在底色之上。
// `cursor-pointer` 也必须显式给——全站没有 `button { cursor: pointer }`，默认 `default`。
const 悬停叠层 =
  "hover:[background-image:linear-gradient(0deg,var(--v2-overlay-simple-overlay-hover),var(--v2-overlay-simple-overlay-hover))]"

const 裁决按钮类 = (押下: boolean) =>
  押下
    ? `h-7 cursor-pointer rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[13px] font-semibold text-v2-text-text-base transition-colors ${悬停叠层} disabled:cursor-not-allowed disabled:opacity-50`
    : `h-7 cursor-pointer rounded-[4px] bg-v2-background-bg-layer-02 px-2 text-[13px] text-v2-text-text-base transition-colors ${悬停叠层} disabled:cursor-not-allowed disabled:opacity-50`

/** 关系行的六列：方向 / 对方 / 类型 / 次数 / 金额 / 状态。表头与行共用同一份列宽。 */
const 关系列 =
  "grid grid-cols-[48px_minmax(0,1fr)_56px_52px_92px_64px] items-baseline gap-x-2 px-3"

/**
 * 实体档案（design §8.3）。
 *
 * 关系**分两段**：「数据说的」是抽取器直出的（`source_kind !== "human"`），「人说的」是民警
 * 认定过的。合并成一张表会让民警分不清哪条能当依据——这正是 §4.2 要区分 `data` / `human` 的理由。
 *
 * ## 版面（2026-11-07 视觉改版）
 *
 * 根节点不再自己滚动，而是「固定身份头 / 滚动体 / 固定裁决条」三段：
 * 滚动时始终看得见「这是谁」，也始终够得着 ✓ 对 / ✗ 错 / ？存疑（原来要滚到页尾）。
 * 身份头始终渲染（载入 / 出错时只剩「实体档案」字样），因为「显示已排除」开关在错误态
 * 仍是重试入口，不能被 `<Show when={档()}>` 一起藏掉。
 *
 * ## 数字条为什么没有「涉及金额」
 *
 * `金额` 是**逐条关系**的 numeric 字符串，出入双向各记一遍：4×3 万来回会在客户端加成 12 万
 * （真正的交易额是 12 万，但「流入」「流出」两侧各算一次会得到 24 万）。服务端不提供聚合，
 * 前端就不摆这个数字——宁可少一个指标，不编一个错数。计数一律按**本页列出的条目**算，
 * 服务端截断时由数字卡页脚的「缺口」说明（与清单同一口径）。
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
  // 裁决自己的错误：**不能**与「读不到档案」共用信号——那条画在滚动体最顶部，档案很长时
  // 用户在底部提交失败根本看不见，切「显示已排除」重取还会把它抹掉。
  const [裁决错误, set裁决错误] = createSignal<string | undefined>()
  const 原因区id = createUniqueId()
  let 原因框: HTMLTextAreaElement | undefined

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

  /** 数字条只报本页列出的条目数（服务端截断由「缺口」说明，见组件注释）。 */
  const 统计 = createMemo(() => {
    const 当前 = 档()
    if (当前 === undefined) return []
    return [
      { key: "关系", 值: 当前.关系.length },
      { key: "事件", 值: 当前.事件.length },
      { key: "出处", 值: 当前.引用.length },
      { key: "对手方", 值: new Set(当前.关系.map((行) => 行.对方值).filter((值) => 值 !== "")).size },
    ]
  })

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
    set裁决错误(undefined)
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
        set裁决错误(回.message)
        return
      }
      set展开原因(false)
      set原因类型(undefined)
      set原因说明("")
      // ⚠️ 排除成功后服务端默认不再返回这条（§9.1）：还按「不含已排除」重取只会拿到 404，
      // 界面会从「已排除」跳成「找不到这个实体」。先打开「显示已排除」，这次重取才读得到它。
      // 开关本来就是 true（用户自己开着的）时，set 同值不会触发 effect，改走 `重取序`。
      if (action === "排除" && !含排除()) set含排除(true)
      else set重取序((序) => 序 + 1)
    } catch (错误值) {
      // 客户端契约是「从不抛」，但夹具 / 将来换了实现仍可能抛：与 `kind:"error"` 同一个出口。
      set裁决错误(错误值 instanceof Error ? 错误值.message : "提交裁决失败")
    } finally {
      set裁决中(false)
    }
  }

  return (
    <div data-component="entity-profile" class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <header data-slot="entity-profile-head" class="@container shrink-0 border-b border-v2-border-border-muted">
        <div class="mx-auto flex w-full max-w-[760px] flex-wrap items-start gap-3 px-4 py-2.5">
          <Show
            when={档()}
            fallback={<span class="min-w-0 flex-1 text-[13px] text-v2-text-text-muted">实体档案</span>}
          >
            {(档) => (
              // 中栏被挤窄时（右侧会话音轨 + 左栏同时开着）整个身份块独占一行，
              // 标题不在一串号码中间硬折行；三个跳转掉到下一行。
              <div class="flex min-w-0 flex-1 items-start gap-3 @max-[520px]:w-full">
                <EntityTypeBadge type={档().type} 大 />
                <div class="min-w-0">
                  <h1
                    data-slot="entity-profile-title"
                    class="break-words text-[18px] font-semibold leading-7 text-v2-text-text-base"
                  >
                    {档().canonical_value}
                  </h1>
                  <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span
                      data-slot="entity-profile-type"
                      class="rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-[12px] text-v2-text-text-muted"
                    >
                      {`${档().type}${档().subtype === undefined ? "" : ` · ${档().subtype}`}`}
                    </span>
                    <span
                      data-slot="entity-profile-trust-state"
                      class="rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-[12px] text-v2-text-text-muted"
                    >
                      {档().trust_state}
                    </span>
                    <Show when={档().aliases.length > 0}>
                      <span data-slot="entity-profile-aliases" class="text-[12px] text-v2-text-text-muted">
                        别名：{档().aliases.join("、")}
                      </span>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <div class="flex shrink-0 flex-col items-end gap-1 @max-[520px]:w-full @max-[520px]:items-start">
            {/* 真实交互元素 + 文字标签（不是只靠颜色表达状态）：`aria-pressed` 也是状态的唯一判据。
                放在固定头里：错误态它仍是重试入口，不能被档案的 `<Show>` 藏掉。 */}
            <button
              type="button"
              data-slot="entity-profile-include-excluded"
              aria-pressed={含排除()}
              onClick={() => set含排除((值) => !值)}
              class={
                含排除()
                  ? `h-6 shrink-0 cursor-pointer rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold text-v2-text-text-base transition-colors ${悬停叠层}`
                  : "h-6 shrink-0 cursor-pointer rounded-[4px] px-2 text-[12px] text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover"
              }
            >
              显示已排除
            </button>
            <Show when={档()}>
              {(档) => (
                <div class="flex flex-wrap justify-end gap-1">
                  {/* 同一实体换视图：路径由 `CaseView` 拼（它手里有 projectId 与 id），标题在这里拼
                      （档案页手里有规范值，关系图 / 时间线只拿到 id）。 */}
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
                        class={`h-7 cursor-pointer rounded-[4px] bg-v2-background-bg-layer-02 px-2 text-[12px] text-v2-text-text-base transition-colors ${悬停叠层}`}
                      >
                        {文案}
                      </button>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </div>
        </div>
      </header>

      <div data-slot="entity-profile-body" class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-[760px] px-4 py-3">
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
              <div class="flex flex-col gap-3">
                {/* 结论由服务端生成（§8.3）：同一份数据两次打开必须说同一句话。前端不拼第二份。 */}
                <p
                  data-slot="entity-profile-conclusion"
                  class="text-[14px] leading-6 text-v2-text-text-base"
                >
                  {档().一句话}
                </p>

                <section
                  data-slot="entity-profile-summary"
                  class="overflow-hidden rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
                >
                  <div class="grid grid-cols-4 divide-x divide-v2-border-border-muted">
                    <For each={统计()}>
                      {(项) => (
                        <div class="px-3 py-2">
                          <div
                            data-slot="entity-stat"
                            data-key={项.key}
                            class="text-[20px] font-semibold leading-7 tabular-nums text-v2-text-text-base"
                          >
                            {项.值}
                          </div>
                          <div class="text-[11px] text-v2-text-text-muted">{项.key}</div>
                        </div>
                      )}
                    </For>
                  </div>
                  {/* 服务端截断（关系 / 事件只列了前 N 条）就照实说，与清单的 `缺口` 同一套口径。
                      放在数字卡里：让「这是截断后的计数」和数字挨着说，不冒充全量。 */}
                  <For each={档().缺口 ?? []}>
                    {(话) => (
                      <p
                        data-slot="entity-profile-gap"
                        class="border-t border-v2-border-border-muted px-3 py-1.5 text-[11px] text-v2-text-text-muted"
                      >
                        {话}
                      </p>
                    )}
                  </For>
                </section>

                <section
                  data-slot="entity-relations"
                  class="@container overflow-hidden rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
                >
                  <关系段 标题="数据说的" slot="entity-relations-data" 行们={数据说的()} />
                  <关系段 标题="人说的" slot="entity-relations-human" 行们={人说的()} 分隔 />
                </section>

                <section
                  data-slot="entity-events"
                  class="overflow-hidden rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
                >
                  <div class="flex items-baseline gap-1.5 px-3 pt-2">
                    <h2 class="text-[12px] font-semibold text-v2-text-text-base">事件</h2>
                    <span class="text-[11px] tabular-nums text-v2-text-text-muted">{档().事件.length} 起</span>
                  </div>
                  <Show
                    when={档().事件.length > 0}
                    fallback={<p class="px-3 py-1 pb-2 text-[12px] text-v2-text-text-muted">没有共同事件</p>}
                  >
                    <div class="px-3 pt-1 pb-2">
                      <For each={档().事件}>{(事件) => 事件行(事件)}</For>
                    </div>
                  </Show>
                </section>

                <section
                  data-slot="entity-citations"
                  class="overflow-hidden rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
                >
                  <div class="flex items-baseline gap-1.5 px-3 pt-2 pb-1">
                    <h2 class="text-[12px] font-semibold text-v2-text-text-base">出处</h2>
                    <span class="text-[11px] tabular-nums text-v2-text-text-muted">{档().引用.length} 条</span>
                  </div>
                  <Show when={档().引用.length === 0}>
                    <p class="px-3 pb-2 text-[12px] text-v2-text-text-muted">没有登记出处</p>
                  </Show>
                  <For each={档().引用}>
                    {(引用) => (
                      <div
                        data-slot="entity-citation"
                        class="flex flex-wrap items-baseline gap-x-2 border-t border-v2-border-border-muted px-3 py-1 text-[12px]"
                      >
                        <span class="text-v2-text-text-base">
                          {引用.path ?? 引用.fileName ?? 引用.materialId}
                        </span>
                        <Show when={定位文本(引用.locator) !== ""}>
                          <span class="text-v2-text-text-muted">{定位文本(引用.locator)}</span>
                        </Show>
                        <span class="text-v2-text-text-faint">{引用.extractMethod}</span>
                      </div>
                    )}
                  </For>
                </section>
              </div>
            )}
          </Show>
        </div>
      </div>

      {/* 纠正入口（design §9.2）：✓ 对 / ✗ 错 / ？存疑 是这一页的业务动作，固定在底栏——
          长档案里不用先滚到页尾，裁决完也始终看得见自己在评谁。 */}
      <Show when={档()}>
        {(档) => (
          <footer class="shrink-0 border-t border-v2-border-border-muted bg-v2-background-bg-layer-01">
            <div class="mx-auto w-full max-w-[760px] px-4 py-2">
              {/* 裁决自己的错误画在按钮 / 原因区旁边（不是滚动体顶部的「读不到档案」）。 */}
              <Show when={裁决错误()}>
                {(话) => (
                  <p data-slot="entity-trust-error" role="alert" class="mb-1 text-[13px] text-v2-state-fg-danger">
                    {话()}
                  </p>
                )}
              </Show>
              {/* 原因区在按钮**上方**展开：底栏贴着窗口下沿，向下长会把输入框顶出屏幕。 */}
              <Show when={展开原因()}>
                <div
                  id={原因区id}
                  data-slot="entity-trust-reason"
                  class="mb-1 max-h-[45vh] w-full overflow-y-auto rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-base p-2"
                >
                  <textarea
                    ref={(框) => (原因框 = 框)}
                    data-slot="entity-trust-reason-text"
                    aria-label="错在哪里（一句话）"
                    class="w-full rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-base p-2 text-[13px] leading-6 text-v2-text-text-base"
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
                    <For each={纠正原因们}>
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
              <div data-slot="entity-trust" class="flex flex-wrap items-center gap-1">
                <span class="mr-1 text-[12px] text-v2-text-text-muted">这条事实：</span>
                {/* 形如「✓ 对」的符号是装饰，语义由可见文字与 `aria-label` 承担；
                    当前态用 `aria-pressed` ＋ 头部徽章的文字表达，不只靠颜色。 */}
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
                  aria-expanded={展开原因()}
                  aria-controls={原因区id}
                  disabled={裁决中()}
                  onClick={() => {
                    set展开原因(true)
                    // 原因区整块是 `<Show>` 新插入的，Solid 的渲染在本次事件里同步完成 ⇒ ref 已就绪。
                    原因框?.focus()
                  }}
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
            </div>
          </footer>
        )}
      </Show>
    </div>
  )
}

/**
 * 关系的一段（数据说的 / 人说的）。
 *
 * 表头与行共用 `关系列`：靠列对齐扫读，不再把方向、对方、类型、次数、金额、依据、信任态
 * 挤成一行文字墙。空的段只留一行灰字，不白占一整块版面。
 */
function 关系段(props: {
  readonly 标题: string
  readonly slot: string
  readonly 行们: readonly 档案关系[]
  readonly 分隔?: boolean
}): JSX.Element {
  return (
    <div class={props.分隔 === true ? "border-t border-v2-border-border-muted" : ""}>
      <div class="flex items-baseline gap-1.5 px-3 pt-2">
        <h2 class="text-[12px] font-semibold text-v2-text-text-base">{props.标题}</h2>
        <span class="text-[11px] tabular-nums text-v2-text-text-muted">{props.行们.length} 条</span>
        {/* 空的段只多一句「没有」，不白占一整块版面（原来它自己占掉两行）。 */}
        <Show when={props.行们.length === 0}>
          <span class="text-[12px] text-v2-text-text-muted">· 没有</span>
        </Show>
      </div>
      <div data-slot={props.slot} class="pb-1">
        <Show when={props.行们.length > 0}>
          <div class={`${关系列} pb-1 text-[11px] text-v2-text-text-muted @max-[560px]:hidden`}>
            <span>方向</span>
            <span>对方</span>
            <span>类型</span>
            <span class="text-right">次数</span>
            <span class="text-right">金额</span>
            <span>状态</span>
          </div>
          <For each={props.行们}>
            {(行) => (
              <div
                data-slot="entity-relation"
                data-source={行.source_kind}
                class={`${关系列} border-t border-v2-border-border-muted py-1.5 text-[13px] hover:bg-v2-overlay-simple-overlay-hover @max-[560px]:flex @max-[560px]:flex-wrap @max-[560px]:gap-y-1`}
              >
                <span
                  data-slot="entity-relation-direction"
                  class="w-12 shrink-0 whitespace-nowrap text-[12px] text-v2-text-text-muted"
                >
                  {行.方向 === "出" ? "出 →" : "← 入"}
                </span>
                {/* 窄栏降级时对方值独占一行：号码只差最后几位，截断会把四行截成同一个样子。 */}
                <div class="min-w-0 flex-1 @max-[560px]:flex-none @max-[560px]:basis-[calc(100%-56px)]">
                  <div data-slot="entity-relation-counterparty" class="truncate text-v2-text-text-base">
                    {行.对方值}
                  </div>
                  {/* 依据放不下第六列（列宽会把对方值挤没），压在对方值下面一行；不丢信息。 */}
                  <Show when={行.basis}>
                    {(依据) => (
                      <div class="truncate text-[11px] text-v2-text-text-muted">依据：{依据()}</div>
                    )}
                  </Show>
                </div>
                <span
                  data-slot="entity-relation-type"
                  class="shrink-0 truncate text-[12px] text-v2-text-text-muted"
                >
                  {行.type}
                </span>
                <span
                  data-slot="entity-relation-count"
                  class="shrink-0 text-right tabular-nums text-v2-text-text-muted"
                >
                  {行.次数 === null ? "—" : `${行.次数} 次`}
                </span>
                <span
                  data-slot="entity-relation-amount"
                  class="shrink-0 text-right tabular-nums text-v2-text-text-base"
                >
                  {金额文本(行.金额)}
                </span>
                <span
                  data-slot="entity-relation-state"
                  class="shrink-0 justify-self-start rounded-[4px] bg-v2-background-bg-base px-1.5 leading-4 text-[11px] text-v2-text-text-muted"
                >
                  {行.trust_state}
                </span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

/** 一条事件：左轨日期与时刻，右列类型 / 摘要 / 参与人。日期用 `时间文本` 的同一份手写格式。 */
function 事件行(事件: 档案事件): JSX.Element {
  const 时间 = 时间文本(事件.occurred_at)
  const [日, 刻] = 时间.split(" ")
  return (
    <div data-slot="entity-event" class="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3">
      <div class="py-1.5 text-right">
        <div class="text-[11px] tabular-nums text-v2-text-text-muted">{日 ?? "—"}</div>
        <Show when={刻}>
          <div class="text-[11px] tabular-nums text-v2-text-text-faint">{刻}</div>
        </Show>
      </div>
      <div class="relative border-l border-v2-border-border-muted py-1.5 pl-3">
        <span
          aria-hidden="true"
          class="absolute -left-[3.5px] top-[9px] size-1.5 rounded-full bg-[var(--v2-brand-gold)]"
        />
        <div class="flex flex-wrap items-baseline gap-1.5">
          <span class="rounded-[4px] bg-v2-background-bg-base px-1.5 py-0.5 text-[11px] text-v2-text-text-muted">
            {事件.type}
          </span>
          <Show when={事件.summary}>
            {(话) => <span class="text-[13px] text-v2-text-text-base">{话()}</span>}
          </Show>
        </div>
        <div class="mt-0.5 text-[12px] text-v2-text-text-muted">{事件.participants.join("、")}</div>
      </div>
    </div>
  )
}
