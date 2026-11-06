import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { CaseDetailApi, 产物复核结果, 复核项 } from "../case-detail-api"
import { 时间文本 } from "./format"

export interface ArtifactReviewProps {
  readonly projectId: string
  readonly path: string
  readonly api: CaseDetailApi
}

/**
 * 产物页（design §9.4）：「这份文件引用了哪几条事实」＋「其中几条的依据后来被改过，请复核」。
 *
 * **请复核是派生出来的、不落库**：后端按 `case_fact_change.created_at > case_citation.created_at`
 * 现算（裁定 6）。所以这一页每次打开都是当前结论，不存在「标记没清掉」的陈旧状态。
 *
 * ⚠️ 清理必须走 `onCleanup`：`createEffect` **不执行**返回值（`LEARNINGS #005-03`）。写成
 * `return () => …`（任务书原稿）时，切换产物/tab 后迟到的旧回包会盖掉新结果。
 */
export function ArtifactReview(props: ArtifactReviewProps): JSX.Element {
  const [结果, set结果] = createSignal<产物复核结果 | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()

  createEffect(() => {
    const projectId = props.projectId
    const path = props.path
    const api = props.api
    set结果(undefined)
    set错误(undefined)
    let 作废 = false
    onCleanup(() => {
      作废 = true
    })
    void api.review(projectId, path).then((回) => {
      if (作废) return
      if (回.kind === "error") {
        set错误(回.message)
        return
      }
      set结果(回.value)
    })
  })

  return (
    <div data-component="artifact-review" class="mt-2 flex flex-col gap-1">
      <Show when={错误()}>
        {(话) => (
          <p data-slot="artifact-review-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
            {话()}
          </p>
        )}
      </Show>
      <Show when={结果()}>
        {(值) => (
          <>
            <h2 data-slot="artifact-review-title" class="text-[13px] font-semibold text-v2-text-text-base">
              这份产物引用了 {值().引用.length} 条事实
            </h2>
            <Show when={值().需复核 > 0}>
              <p
                data-slot="artifact-review-banner"
                role="status"
                class="rounded-[4px] bg-[var(--v2-state-bg-warning)] px-2 py-1 text-[13px] text-v2-text-text-base"
              >
                有 {值().需复核} 条引用的依据已更新，请复核
              </p>
            </Show>
            <Show when={值().引用.length === 0}>
              <p data-slot="artifact-review-empty" class="text-[13px] text-v2-text-text-muted">
                这份产物没有引用任何事实
              </p>
            </Show>
            <For each={值().引用}>
              {(条: 复核项) => (
                <div
                  data-slot="artifact-review-row"
                  data-fact-id={条.fact_id}
                  data-needs-review={条.需复核 ? "true" : "false"}
                  class="flex flex-wrap items-baseline gap-1 border-b border-v2-border-border-muted py-0.5 text-[13px]"
                >
                  <span class="text-v2-text-text-base">{条.值}</span>
                  <Show when={条.原文}>
                    {(原文) => <code class="text-[12px] text-v2-text-text-muted">{原文()}</code>}
                  </Show>
                  <span class="text-[12px] text-v2-text-text-muted">引用 {时间文本(条.引用时间)}</span>
                  <Show when={条.需复核}>
                    <span
                      data-slot="artifact-review-needs"
                      class="rounded-[4px] bg-[var(--v2-state-bg-warning)] px-1 text-[12px]"
                    >
                      依据 {时间文本(条.变更时间)} 已更新，请复核
                    </span>
                  </Show>
                </div>
              )}
            </For>
            <For each={值().缺口}>
              {(话) => (
                <p data-slot="artifact-review-gap" class="text-[12px] text-v2-text-text-muted">
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
