import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { CaseDetailApi, 材料事实清单结果 } from "../case-detail-api"
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
  readonly 表头: string
  readonly 原因: string
  readonly 建议字段: string | null
}

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
      if (typeof 列号 !== "number" || typeof 表头 !== "string" || typeof 原因 !== "string") continue
      const 建议 = Reflect.get(原始, "建议字段")
      out.push({ sheet, 项: { 列号, 表头, 原因, 建议字段: typeof 建议 === "string" ? 建议 : null } })
    }
  }
  return out
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

  createEffect(() => {
    const 材料 = 清单()?.材料
    set待确认(材料 === undefined ? [] : 读待确认(材料.parse_detail))
  })

  createEffect(() => {
    const projectId = props.projectId
    const path = props.path
    const api = props.api
    const 要排除 = 含排除()
    set清单(undefined)
    set错误(undefined)
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
            </div>

            {/* 待确认面板与「有问题」的 detail 是**两条独立的路径**：解析成功的材料同样可能有
                认不出名字的列。别把它套进 `parse_status === "有问题"`——那正是 spec 警告的那条路。 */}
            <Show when={待确认().length > 0}>
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
                        {行.项.表头}
                      </span>
                      <span class="text-v2-text-text-muted">{行.项.原因}</span>
                      <button
                        type="button"
                        data-slot="material-facts-pending-confirm"
                        disabled={确认中() !== undefined || 行.项.建议字段 === null}
                        onClick={() => {
                          const field = 行.项.建议字段
                          if (field === null) return
                          set确认中(`${行.sheet}:${行.项.列号}`)
                          set确认错误(undefined)
                          void props.api
                            .confirmFieldAlias({
                              projectId: props.projectId,
                              header: 行.项.表头,
                              field,
                              materialId: 清单()?.材料.id ?? "",
                            })
                            .then((结果) => {
                              if (结果.kind === "error") set确认错误(结果.message)
                            })
                            .finally(() => set确认中(undefined))
                        }}
                        class="h-6 rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 font-semibold text-v2-text-text-base disabled:opacity-50"
                      >
                        确认为 {行.项.建议字段 ?? "（需人工指定）"}
                      </button>
                    </div>
                  )}
                </For>
              </section>
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
    </div>
  )
}
