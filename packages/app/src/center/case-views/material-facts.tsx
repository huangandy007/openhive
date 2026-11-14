import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import type { CaseDetailApi, 材料事实清单结果 } from "../case-detail-api"
import type { 解析状态 } from "../../project/case-materials-api"
import { 案件伪路径 } from "../case-route"
import { useCenterTabs } from "../tab-context"
import { ArtifactReview } from "./artifact-review"

export interface MaterialFactsProps {
  readonly projectId: string
  readonly path: string
  readonly api: CaseDetailApi
}

/** `parse_detail` 是 JSONB，形状随解析器变：字符串原样，其余转成缩进 JSON；空值返回空串。 */
function 解详情(值: unknown): string {
  if (值 === null || 值 === undefined) return ""
  if (typeof 值 === "string") return 值
  try {
    return JSON.stringify(值, null, 2)
  } catch {
    return String(值)
  }
}

interface 待确认项界面 {
  readonly 列号: number
  readonly 表头: string | null
  readonly 原因: string
  readonly 建议字段: string | null
}

/**
 * 这两个状态下 detail 可能还是**上一轮**的：服务端 `applyParseAction` 只在带 `detail` 的动作
 * （有问题 / 已解析）下改写它，「开始」（排队中 / 解析中）不清。把它们当本轮展示 ＝ 说隔夜的话。
 */
const 进行中状态们: readonly 解析状态[] = ["排队中", "解析中"]
const 是进行中 = (状态: 解析状态): boolean => 进行中状态们.includes(状态)

/**
 * 六种 `待确认原因` 里，只有词典层的这两类能靠「写一条别名」真正解决。
 *
 * 其余四类的前提都是该表头**已有活跃别名**，而写别名接口对活跃别名走 `没命中 ⇒ 抛已存在`，
 * 全仓又没有撤销入口；词典层的「单位冲突」更糟：写进去会成功，但下次解析别名层第一件事
 * 就是 `单位闸放行` 失败 ⇒ 又变回单位冲突，还从此把该表头锁在别名层。摆出按钮＝让人点注定失败的操作。
 */
const 可确认原因们: readonly string[] = ["多列争抢", "候选不唯一"]
const 能写别名解决 = (原因: string): boolean => 可确认原因们.includes(原因)

/** 从 parse_detail 里读待确认；形状不对就当没有（不猜）。 */
function 读待确认(详情: unknown): { sheet: string; 项: 待确认项界面 }[] {
  if (typeof 详情 !== "object" || 详情 === null) return []
  const mapping = Reflect.get(详情, "mapping")
  if (typeof mapping !== "object" || mapping === null) return []
  const 工作表 = Reflect.get(mapping, "工作表")
  if (typeof 工作表 !== "object" || 工作表 === null) return []
  const out: { sheet: string; 项: 待确认项界面 }[] = []
  for (const [sheet, 值] of Object.entries(工作表)) {
    if (typeof 值 !== "object" || 值 === null) continue
    const 列表 = Reflect.get(值, "待确认")
    if (!Array.isArray(列表)) continue
    for (const 原始 of 列表) {
      if (typeof 原始 !== "object" || 原始 === null) continue
      const 列号 = Reflect.get(原始, "列号")
      const 表头 = Reflect.get(原始, "表头")
      const 原因 = Reflect.get(原始, "原因")
      // 服务端 `待确认项.表头` 是 `string | null`（表头单元格为空时就是 null），**null 是合法值**：
      // 整条丢掉会让该列在界面上彻底消失、永远无法交给属主定名。
      if (typeof 列号 !== "number" || (typeof 表头 !== "string" && 表头 !== null) || typeof 原因 !== "string")
        continue
      // 空串 / 纯空白同样算「无表头」：服务端不接受空表头，点了只会 400。
      const 规范表头 = typeof 表头 === "string" && 表头.trim() !== "" ? 表头 : null
      const 建议 = Reflect.get(原始, "建议字段")
      out.push({ sheet, 项: { 列号, 表头: 规范表头, 原因, 建议字段: typeof 建议 === "string" ? 建议 : null } })
    }
  }
  return out
}

/**
 * `parse_detail` 里「没认出来的列」：服务端 `case-ingest.ts` 只收**有非空表头**的列
 * （别名库的键就是表头原文），并带上**本表**的候选字段集（`候选字段集`）。
 */
interface 未认出项界面 {
  readonly sheet: string
  readonly 列号: number
  readonly 表头: string
  readonly 样例: string[]
  readonly 候选字段: string[]
}

/** 从 parse_detail 里读未认出的列；形状不对就当没有（不猜）。 */
function 读未认出(详情: unknown): 未认出项界面[] {
  if (typeof 详情 !== "object" || 详情 === null) return []
  const mapping = Reflect.get(详情, "mapping")
  if (typeof mapping !== "object" || mapping === null) return []
  const 工作表 = Reflect.get(mapping, "工作表")
  if (typeof 工作表 !== "object" || 工作表 === null) return []
  const out: 未认出项界面[] = []
  for (const [sheet, 值] of Object.entries(工作表)) {
    if (typeof 值 !== "object" || 值 === null) continue
    const 列们 = Reflect.get(值, "未认出")
    if (!Array.isArray(列们)) continue
    const 候选 = Reflect.get(值, "候选字段")
    const 候选字段 = Array.isArray(候选) ? 候选.filter((x): x is string => typeof x === "string") : []
    // 候选字段为空 ⇒ 下拉框里没有任何可选项，摆出来只是个点不动的入口（写别名也无从谈起）。
    if (候选字段.length === 0) continue
    for (const 原始 of 列们) {
      if (typeof 原始 !== "object" || 原始 === null) continue
      const 列号 = Reflect.get(原始, "列号")
      const 表头 = Reflect.get(原始, "表头")
      // 表头是别名库的键：空表头服务端不收，点了必然 400 —— 和待确认面板同一条判据。
      if (typeof 列号 !== "number" || typeof 表头 !== "string" || 表头.trim() === "") continue
      const 样例 = Reflect.get(原始, "样例")
      out.push({
        sheet,
        列号,
        表头,
        样例: Array.isArray(样例) ? 样例.filter((x): x is string => typeof x === "string") : [],
        候选字段,
      })
    }
  }
  return out
}

/**
 * 弹窗里的一行：一列没认出来的表头 ＋ 本表可选的字段。
 *
 * 选择状态是**行内**的（`For` 每项各自一个信号）：确认一列后其余行不收影响，
 * 也不会因为父组件重渲染把已经选好的字段清掉。
 */
function 未认出一行(props: {
  readonly 行: 未认出项界面
  readonly 忙: boolean
  readonly onConfirm: (字段名: string) => void
}): JSX.Element {
  const [字段名, set字段名] = createSignal("")
  return (
    <section
      data-slot="material-facts-unrecognized-row"
      class="flex flex-col gap-1 border-b border-v2-border-border-muted pb-3"
    >
      <div class="flex flex-wrap items-baseline gap-2">
        <span class="text-[13px] font-semibold text-v2-text-text-base">{props.行.表头}</span>
        <span class="text-[12px] text-v2-text-text-muted">
          第 {props.行.列号 + 1} 列 · {props.行.sheet}
        </span>
      </div>
      <Show when={props.行.样例.length > 0}>
        <p data-slot="material-facts-unrecognized-samples" class="text-[12px] text-v2-text-text-muted">
          样例：{props.行.样例.join(" · ")}
        </p>
      </Show>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        {/* 原生 `<select>` 包在 label 里：a11y 规则能看见它（同 `asset-detail.tsx` 的项目下拉）。 */}
        <label class="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-v2-text-text-muted">
          这列是
          <select
            data-slot="material-facts-unrecognized-select"
            aria-label={`「${props.行.表头}」是哪个字段`}
            disabled={props.忙}
            value={字段名()}
            onChange={(event) => set字段名(event.currentTarget.value)}
            class="h-7 min-w-0 flex-1 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 text-[12px] text-v2-text-text-base"
          >
            <option value="">请选择</option>
            <For each={props.行.候选字段}>{(名) => <option value={名}>{名}</option>}</For>
          </select>
        </label>
        <button
          type="button"
          data-slot="material-facts-unrecognized-confirm"
          disabled={props.忙 || 字段名() === ""}
          onClick={() => {
            const 名 = 字段名()
            // happy-dom 对 disabled 按钮仍可能派发 click：这道守卫留着（同待确认按钮）。
            if (名 === "") return
            props.onConfirm(名)
          }}
          class="h-7 shrink-0 rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold text-v2-text-text-base disabled:opacity-50"
        >
          {props.忙 ? "处理中…" : "确认并记住"}
        </button>
      </div>
    </section>
  )
}

/**
 * 一份材料的抽取结果（design §8.4）。
 *
 * **按工作表分组、行上并排列事实**——民警核对的是「这一行原文有没有被抽成事实」，
 * 按事实类型平铺就丢了「同一行」这个对照关系。
 *
 * **仅当 `parse_status === "有问题"`** 时才摆 `parse_detail`：解析成功时的 detail 是机器噪声，
 * 常驻只会把真正要看的东西挤下去。别写成 `!== "已解析"`——`解析中` / `排队中` 可能还带着
 * 上一轮的 detail，把隔夜的原因当成本轮的原因摆出来，是同一种谎话。
 */
export function MaterialFacts(props: MaterialFactsProps): JSX.Element {
  const [清单, set清单] = createSignal<材料事实清单结果 | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()
  const [载入, set载入] = createSignal(false)
  // 与实体档案同一个开关语义（§9.1）：默认只看可见事实，用户点了才把已排除的一并带出。
  const [含排除, set含排除] = createSignal(false)
  // 待确认面板**独立于「有问题」路径**：解析成功也可能有列等着属主定名。
  const [待确认, set待确认] = createSignal<{ sheet: string; 项: 待确认项界面 }[]>([])
  const [确认中, set确认中] = createSignal<string | undefined>()
  const [确认错误, set确认错误] = createSignal<string | undefined>()
  // 别名写的是全局库，当前材料的 `parse_detail` 不会自己变——确认成功后不提示「需重新解析」，
  // 属主会以为已经修好了。
  const [已写入别名, set已写入别名] = createSignal(false)
  // 「没认出来的列」走弹窗（人工确认入口）：角标只报数，点开才逐列定名。
  const [未认出, set未认出] = createSignal<未认出项界面[]>([])
  const [弹窗开, set弹窗开] = createSignal(false)
  const [记住中, set记住中] = createSignal<string | undefined>()
  const [记住错误, set记住错误] = createSignal<string | undefined>()
  const [已记住, set已记住] = createSignal<string[]>([])

  const center = useCenterTabs()
  const 打开卡片模板 = () =>
    center.open(
      {
        module: center.module() ?? "project",
        title: "卡片模板",
        path: 案件伪路径({ projectId: props.projectId, view: "templates", arg: "all" }),
      },
      center.activePane(),
    )

  createEffect(() => {
    const 材料 = 清单()?.材料
    set待确认(材料 === undefined ? [] : 读待确认(材料.parse_detail))
    set未认出(材料 === undefined ? [] : 读未认出(材料.parse_detail))
  })

  createEffect(() => {
    const projectId = props.projectId
    const path = props.path
    const api = props.api
    const 要排除 = 含排除()
    set清单(undefined)
    set错误(undefined)
    // 确认态属于**上一份清单**：重取（换材料 / 切「含排除」）后不清会让旧 403 文案跟着新材料复活。
    set确认中(undefined)
    set确认错误(undefined)
    set已写入别名(false)
    set弹窗开(false)
    set记住中(undefined)
    set记住错误(undefined)
    set已记住([])
    set载入(true)
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（同 `entity-profile.tsx`，
    // `LEARNINGS #005-03`）。写成 `return () => …` 时迟到的回包会盖掉新材料的结果。
    // 开关切换也会重跑本 effect——旧请求同样要作废。
    onCleanup(() => {
      作废 = true
    })
    void api.materialFacts(projectId, path, 要排除).then((结果) => {
      if (作废) return
      set载入(false)
      if (结果.kind === "error") {
        set错误(结果.message)
        return
      }
      set清单(结果.value)
    })
  })

  /**
   * 把「这列是什么」写成一条别名（一次一列）。
   *
   * 与待确认按钮同一套防迟到规则：回包跨了材料就整条丢掉（`#005-03`），否则旧材料的 403
   * 会落到新材料上。成功即从清单里摘掉这一列；全部摘完就关弹窗——留个空壳只会让人以为还有事做。
   */
  const 记住一列 = (行: 未认出项界面, field: string) => {
    const 键 = `${行.sheet}:${行.列号}`
    const 发起材料 = 清单()?.材料.id
    set记住中(键)
    set记住错误(undefined)
    void props.api
      .confirmFieldAlias({
        projectId: props.projectId,
        header: 行.表头,
        field,
        materialId: 发起材料 ?? "",
      })
      .then((结果) => {
        if (清单()?.材料.id !== 发起材料) return
        if (结果.kind === "error") {
          set记住错误(结果.message)
          return
        }
        const 剩下 = 未认出().filter((项) => `${项.sheet}:${项.列号}` !== 键)
        set未认出(剩下)
        set已记住((话们) => [...话们, `已记住「${行.表头}」→ ${field}，重新解析该材料后生效`])
        if (剩下.length === 0) set弹窗开(false)
      })
      // 只清自己这一条：跨材料时旧回包结算不许解除新请求的禁用态。
      .finally(() => set记住中((当前) => (当前 === 键 ? undefined : 当前)))
  }

  return (
    <div data-component="material-facts" class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-3 py-2">
      {/* 开关必须在 `Show when={清单()}` **之外**（与 `entity-profile.tsx` 同构）：请求在飞或失败时
          清单仍是 `undefined`，塞在 `Show` 里会让用户切到「含排除」后遇到一次失败就再也点不回去。
          产物没有事实可排除，清单落地后按 kind 隐藏。 */}
      <Show when={清单()?.材料.kind !== "产物"}>
        <button
          type="button"
          data-slot="material-facts-include-excluded"
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
      </Show>
      <Show when={错误()}>
        {(话) => (
          <p data-slot="material-facts-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
            {话()}
          </p>
        )}
      </Show>
      <Show when={载入() && 清单() === undefined}>
        <p data-slot="material-facts-loading" class="text-[13px] text-v2-text-text-muted">
          正在读取抽取结果…
        </p>
      </Show>
      <Show when={清单()}>
        {(清单) => (
          <>
            <div class="flex flex-wrap items-baseline gap-2">
              <h1 data-slot="material-facts-title" class="text-[16px] font-semibold text-v2-text-text-base">
                {清单().材料.file_name || 清单().材料.path}
              </h1>
              <span class="text-[12px] text-v2-text-text-muted">{清单().材料.kind}</span>
              <span data-slot="material-facts-status" class="rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-[12px] text-v2-text-text-muted">
                {清单().材料.parse_status}
              </span>
              {/* 入口与待确认面板同一条判据：进行中的 detail 可能是上一轮的，别把隔夜结论摆出来。 */}
              <div class="ml-auto flex items-center gap-2">
                <Show when={未认出().length > 0 && !是进行中(清单().材料.parse_status)}>
                  <button
                    type="button"
                    data-slot="material-facts-unrecognized-badge"
                    onClick={() => set弹窗开(true)}
                    class="h-6 shrink-0 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2 text-[12px] font-semibold text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                  >
                    {未认出().length} 列没认出来
                  </button>
                </Show>
                <button
                  type="button"
                  data-slot="material-facts-templates-button"
                  onClick={打开卡片模板}
                  class="h-6 shrink-0 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-2 text-[12px] font-semibold text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
                >
                  卡片模板
                </button>
              </div>
            </div>

            {/* 待确认面板与「有问题」的 detail 是**两条独立的路径**：解析成功的材料同样可能有
                认不出名字的列。别把它套进 `parse_status === "有问题"`——那正是 spec 警告的那条路。 */}
            <Show when={待确认().length > 0 && !是进行中(清单().材料.parse_status)}>
              <section class="mt-2 rounded-[4px] border border-v2-border-border-muted p-2">
                <p data-slot="material-facts-pending-badge" class="text-[12px] font-semibold text-v2-text-text-base">
                  {待确认().length} 列待确认
                </p>
                <Show when={确认错误()}>
                  {(话) => (
                    <p data-slot="material-facts-pending-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
                      {话()}
                    </p>
                  )}
                </Show>
                <For each={待确认()}>
                  {(行) => (
                    <div class="mt-1 flex flex-wrap items-baseline gap-2 text-[12px]">
                      <span class="text-v2-text-text-muted">{行.sheet}</span>
                      <span data-slot="material-facts-pending-header" class="text-v2-text-text-base">
                        {/* `列号` 是 0 起（与 mapping 的键一致，设计 §8.4）；给人看的是 1 起。 */}
                        {行.项.表头 ?? `（第${行.项.列号 + 1}列无表头）`}
                      </span>
                      <span class="text-v2-text-text-muted">{行.项.原因}</span>
                      <Show
                        when={能写别名解决(行.项.原因)}
                        fallback={
                          <span data-slot="material-facts-pending-manual" class="text-v2-text-text-muted">
                            该列需人工处理（写别名解决不了）
                          </span>
                        }
                      >
                        <button
                          type="button"
                          data-slot="material-facts-pending-confirm"
                          disabled={确认中() !== undefined || 行.项.建议字段 === null || 行.项.表头 === null}
                          onClick={() => {
                            const field = 行.项.建议字段
                            const 表头 = 行.项.表头
                            // 服务端不接受空表头（无表头项点了只会 400），也不接受没建议字段时瞎猜。
                            if (field === null || 表头 === null) return
                            const 键 = `${行.sheet}:${行.项.列号}`
                            // 发起时的材料：迟到的回包若跨了材料，错误与摘行都不能落到新材料上（`#005-03`）。
                            const 发起材料 = 清单()?.材料.id
                            set确认中(键)
                            set确认错误(undefined)
                            void props.api
                              .confirmFieldAlias({
                                projectId: props.projectId,
                                header: 表头,
                                field,
                                materialId: 清单()?.材料.id ?? "",
                              })
                              .then((结果) => {
                                if (清单()?.材料.id !== 发起材料) return
                                if (结果.kind === "error") {
                                  set确认错误(结果.message)
                                  return
                                }
                                // 成功即不再「待确认」：留下的行会让角标继续宣称 N 列，是句假话。
                                set待确认((行们) => 行们.filter((行) => `${行.sheet}:${行.项.列号}` !== 键))
                                // 别名进的是全局库，本材料的 detail 不会自己变。
                                set已写入别名(true)
                              })
                              // 只清自己这一条：跨材料时旧回包结算不许解除新请求的禁用态；
                              // 材料切换由取数 effect 的 `set确认中(undefined)` 兜底，不会永久禁用。
                              .finally(() => set确认中((当前) => (当前 === 键 ? undefined : 当前)))
                          }}
                          class="h-6 rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 font-semibold text-v2-text-text-base disabled:opacity-50"
                        >
                          确认为 {行.项.建议字段 ?? "（需人工指定）"}
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
              </section>
            </Show>
            {/* 摘掉行之后面板可能整块消失（最后一列确认完），提示必须活在面板之外，否则一闪就没。 */}
            <Show when={已写入别名() && !是进行中(清单().材料.parse_status)}>
              <p data-slot="material-facts-pending-applied" class="mt-1 text-[12px] text-v2-text-text-muted">
                已写入别名，需重新解析该材料后生效
              </p>
            </Show>
            {/* 摘行后弹窗可能整块关闭，提示必须活在弹窗之外，否则一闪就没。 */}
            <Show when={已记住().length > 0 && !是进行中(清单().材料.parse_status)}>
              <For each={已记住()}>
                {(话) => (
                  <p data-slot="material-facts-remembered" class="mt-1 text-[12px] text-v2-text-text-muted">
                    {话}
                  </p>
                )}
              </For>
            </Show>
            <Show when={清单().材料.parse_status === "有问题" && 解详情(清单().材料.parse_detail) !== ""}>
              <pre data-slot="material-facts-detail" class="mt-2 overflow-x-auto rounded-[4px] bg-v2-background-bg-layer-01 p-2 text-[12px] text-v2-text-text-muted">
                {解详情(清单().材料.parse_detail)}
              </pre>
            </Show>

            {/* 产物走另一套读取（引用复核），不摆 sheet / row 分组：产物没有 sheet / row 定位，
                「这份材料还没有登记事实」那句对产物是错的（它有引用）。两条路各自说自己那一套。 */}
            <Show
              when={清单().材料.kind === "产物"}
              fallback={
                <>
                  {/* 缺口非空时**不摆通用空态**：DAO 的缺口可能是「引用的事实均已排除」，
                      与「这份材料还没有登记事实」同时出现就是两句互相打脸的话。 */}
                  <Show when={清单().分组.length === 0 && 清单().缺口.length === 0}>
                    <p data-slot="material-facts-empty" class="mt-3 text-[13px] text-v2-text-text-muted">
                      这份材料还没有登记事实
                    </p>
                  </Show>

                  <For each={清单().分组}>
                    {(组) => (
                      <section class="mt-3">
                        <h2 data-slot="material-facts-sheet" class="text-[13px] font-semibold text-v2-text-text-base">
                          {组.sheet}
                        </h2>
                        <Show when={组.行们.length === 0}>
                          <p data-slot="material-facts-empty-sheet" class="text-[13px] text-v2-text-text-muted">
                            这一页没有登记事实
                          </p>
                        </Show>
                        <For each={组.行们}>
                          {(行) => (
                            <div data-slot="material-facts-row" data-row={行.row_no} class="flex flex-wrap items-baseline gap-1 border-b border-v2-border-border-muted py-0.5 text-[13px]">
                              <span class="shrink-0 text-v2-text-text-muted">第 {行.row_no} 行</span>
                              <For each={行.事实们}>
                                {(事实) => (
                                  <span data-slot="material-fact" data-type={事实.fact_type} class="rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-v2-text-text-base">
                                    {事实.值}
                                  </span>
                                )}
                              </For>
                            </div>
                          )}
                        </For>
                      </section>
                    )}
                  </For>

                  <For each={清单().缺口}>
                    {(话) => (
                      <p data-slot="material-facts-gap" class="mt-1 text-[12px] text-v2-text-text-muted">
                        {话}
                      </p>
                    )}
                  </For>
                </>
              }
            >
              <ArtifactReview projectId={props.projectId} path={props.path} api={props.api} />
            </Show>
          </>
        )}
      </Show>

      {/* 弹窗挂在组件树最外层、`清单` 的 `Show` 之外：`Show` 切走时（换材料 / 重取）弹窗
          也要能干净地退场，而关它的动作来自弹窗自己的按钮。 */}
      <Kobalte open={弹窗开()} onOpenChange={(打开) => !打开 && set弹窗开(false)}>
        <Kobalte.Portal>
          <Kobalte.Overlay class="fixed inset-0 z-40 bg-v2-overlay-simple-overlay-scrim" />
          <Kobalte.Content
            data-slot="material-facts-confirm-dialog"
            class="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[min(34rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base shadow-[var(--v2-elevation-overlay)]"
          >
            <div class="flex items-center gap-3 border-b border-v2-border-border-muted px-5 py-4">
              <Kobalte.Title class="min-w-0 flex-1 text-[15px] font-semibold text-v2-text-text-base">
                没认出的列
              </Kobalte.Title>
              <span data-slot="material-facts-dialog-hint" class="text-[12px] text-v2-text-text-muted">
                {未认出().length} 列 · 选好后，以后同表头的材料都按这个认
              </span>
              <Kobalte.CloseButton
                type="button"
                aria-label="关闭"
                class="flex size-7 items-center justify-center rounded-lg text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
              >
                ✕
              </Kobalte.CloseButton>
            </div>
            <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
              <Show when={记住错误()}>
                {(话) => (
                  <p data-slot="material-facts-unrecognized-error" role="alert" class="text-[12px] text-v2-state-fg-danger">
                    {话()}
                  </p>
                )}
              </Show>
              <For each={未认出()}>
                {(行) => (
                  <未认出一行
                    行={行}
                    忙={记住中() === `${行.sheet}:${行.列号}`}
                    onConfirm={(field) => 记住一列(行, field)}
                  />
                )}
              </For>
            </div>
            <div class="flex justify-end border-t border-v2-border-border-muted px-5 py-3">
              <button
                type="button"
                data-slot="material-facts-unrecognized-close"
                onClick={() => set弹窗开(false)}
                class="h-8 rounded-[4px] border border-v2-border-border-muted px-3 text-[12px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
              >
                关掉
              </button>
            </div>
          </Kobalte.Content>
        </Kobalte.Portal>
      </Kobalte>
    </div>
  )
}
