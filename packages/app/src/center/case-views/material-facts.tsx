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
                  <button
                    type="button"
                    data-slot="material-facts-include-excluded"
                    aria-pressed={含排除()}
                    onClick={() => set含排除((值) => !值)}
                    class={
                      含排除()
                        ? "mt-2 h-6 w-fit shrink-0 rounded-[4px] bg-[var(--v2-background-bg-accent-soft)] px-2 text-[12px] font-semibold text-v2-text-text-base"
                        : "mt-2 h-6 w-fit shrink-0 rounded-[4px] px-2 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
                    }
                  >
                    显示已排除
                  </button>
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
