import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { CaseDetailApi, 工具结果 } from "../case-detail-api"
import { 时间文本 } from "./format"

export interface TimelineProps {
  readonly projectId: string
  readonly id: string
  readonly api: CaseDetailApi
}

interface 时间线事件 {
  readonly id: string
  readonly type: string
  readonly occurred_at: number | null
  readonly participants: readonly string[]
  readonly summary: string | null
}

/** `数据` 是 `unknown`（工具结果的口径）：认不出的行整条丢掉，不猜字段。 */
function 解事件们(数据: unknown): 时间线事件[] {
  if (!Array.isArray(数据)) return []
  return 数据.flatMap((条) => {
    if (条 === null || typeof 条 !== "object") return []
    const 记 = 条 as Record<string, unknown>
    if (typeof 记.id !== "string" || typeof 记.type !== "string") return []
    return [
      {
        id: 记.id,
        type: 记.type,
        occurred_at: typeof 记.occurred_at === "number" ? 记.occurred_at : null,
        participants: Array.isArray(记.participants) ? 记.participants.filter((值): 值 is string => typeof 值 === "string") : [],
        summary: typeof 记.summary === "string" ? 记.summary : null,
      },
    ]
  })
}

/**
 * 实体时间线。**复用 `query_events` 的返回**（口径与缺口一起摆），
 * 前端不自己拼「某实体的全部事件」——那等于给 §9.1 的过滤开第二个会漂的点。
 */
export function Timeline(props: TimelineProps): JSX.Element {
  const [结果, set结果] = createSignal<工具结果 | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()
  const [载入, set载入] = createSignal(false)

  createEffect(() => {
    const projectId = props.projectId
    const id = props.id
    const api = props.api
    set结果(undefined)
    set错误(undefined)
    set载入(true)
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（`LEARNINGS #005-03`）。
    // 写成 `return () => { 作废 = true }` 时，迟到的回包会盖掉新实体的事件。
    onCleanup(() => {
      作废 = true
    })
    void api.timeline(projectId, id)
      .then((回) => {
        if (作废) return
        set载入(false)
        if (回.kind === "error") {
          set错误(回.message)
          return
        }
        set结果(回.value)
      })
      // 注入的 api 若**抛**（不是回 `{kind:"error"}`），不接住就会一直停在「载入中」，
      // 同时留下一条没人看的 unhandled rejection。
      .catch((错误: unknown) => {
        if (作废) return
        set载入(false)
        set错误(错误 instanceof Error ? 错误.message : String(错误))
      })
  })

  const 事件们 = () => 解事件们(结果()?.数据)

  return (
    <div data-component="timeline" class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-3 py-2">
      <h1 class="text-[16px] font-semibold text-v2-text-text-base">时间线</h1>
      <Show when={错误()}>{(话) => <p data-slot="timeline-error" role="alert" class="text-[13px] text-v2-state-fg-danger">{话()}</p>}</Show>
      <Show when={载入() && 结果() === undefined}>
        <p class="text-[13px] text-v2-text-text-muted">正在读取事件…</p>
      </Show>
      <Show when={结果() && 事件们().length === 0 && 错误() === undefined}>
        <p data-slot="timeline-empty" class="text-[13px] text-v2-text-text-muted">没有事件</p>
      </Show>
      <For each={事件们()}>
        {(事件) => (
          <div data-slot="timeline-event" data-event-id={事件.id} class="border-b border-v2-border-border-muted py-1 text-[13px]">
            <div class="text-v2-text-text-base">
              {时间文本(事件.occurred_at)} · {事件.type}
            </div>
            <Show when={事件.summary}>{(话) => <div class="text-v2-text-text-muted">{话()}</div>}</Show>
            <div class="text-[12px] text-v2-text-text-muted">{事件.participants.join("、")}</div>
          </div>
        )}
      </For>
      <Show when={结果()?.口径}>
        {(话) => <p data-slot="timeline-scope" class="mt-2 text-[12px] text-v2-text-text-muted">{话()}</p>}
      </Show>
      <For each={结果()?.缺口 ?? []}>{(话) => <p data-slot="timeline-gap" class="text-[12px] text-v2-text-text-muted">{话}</p>}</For>
    </div>
  )
}
