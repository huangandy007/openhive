import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { CaseDetailApi, 材料事实清单结果 } from "../case-detail-api"

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
 * `parse_status !== "解析完成"` 时才摆 `parse_detail`：解析成功时的 detail 是机器噪声，
 * 常驻只会把真正要看的东西挤下去。
 */
export function MaterialFacts(props: MaterialFactsProps): JSX.Element {
  const [清单, set清单] = createSignal<材料事实清单结果 | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()
  const [载入, set载入] = createSignal(false)

  createEffect(() => {
    const projectId = props.projectId
    const path = props.path
    const api = props.api
    set清单(undefined)
    set错误(undefined)
    set载入(true)
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（同 `entity-profile.tsx`，
    // `LEARNINGS #005-03`）。写成 `return () => …` 时迟到的回包会盖掉新材料的结果。
    onCleanup(() => {
      作废 = true
    })
    void api.materialFacts(projectId, path).then((结果) => {
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
            <Show when={清单().材料.parse_status !== "解析完成" && 解详情(清单().材料.parse_detail) !== ""}>
              <pre data-slot="material-facts-detail" class="mt-2 overflow-x-auto rounded-[4px] bg-v2-background-bg-layer-01 p-2 text-[12px] text-v2-text-text-muted">
                {解详情(清单().材料.parse_detail)}
              </pre>
            </Show>

            <Show when={清单().分组.length === 0}>
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
        )}
      </Show>
    </div>
  )
}
