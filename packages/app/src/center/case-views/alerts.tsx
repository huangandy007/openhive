import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import type { CaseDetailApi } from "../case-detail-api"
import type { CaseAlertsApi, 提醒行 } from "../../project/case-alerts-api"
import { 时间文本 } from "./format"

export interface AlertsProps {
  readonly projectId: string
  /** 未用，但与本目录其它视图同一签名（`CaseView` 统一传）；不要为了「用上」去取无关数据。 */
  readonly api: CaseDetailApi
  readonly 提醒api: CaseAlertsApi
}

/**
 * 提醒清单（design §7.3）。**提醒只陈述数据事实**：这一页不出现「可疑」「建议立案」之类的结论。
 *
 * 「重新比对」是这一版唯一的触发点：常驻定时比对需要调度器，不在计划 7 的范围
 * （见文末缺口表）。按了才扫、扫完幂等落库（后端 `生成提醒`）。
 */
export function Alerts(props: AlertsProps): JSX.Element {
  const [行们, set行们] = createSignal<readonly 提醒行[]>([])
  const [错误, set错误] = createSignal<string | undefined>()
  const [新增话, set新增话] = createSignal<string | undefined>()
  const [载入, set载入] = createSignal(false)

  createEffect(() => {
    const projectId = props.projectId
    const api = props.提醒api
    set行们([])
    set错误(undefined)
    set新增话(undefined)
    set载入(true)
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（`LEARNINGS #005-03`）。
    // 写成 `return () => { 作废 = true }` 时，迟到的旧项目回包会盖掉新项目的那一份。
    onCleanup(() => {
      作废 = true
    })
    void api.list(projectId).then((回) => {
      if (作废) return
      set载入(false)
      if (回.kind === "error") {
        set错误(回.message)
        return
      }
      set错误(undefined)
      set行们(回.value)
    })
  })

  const 重新比对 = () => {
    set载入(true)
    void props.提醒api.refresh(props.projectId).then((回) => {
      set载入(false)
      if (回.kind === "error") {
        set错误(回.message)
        return
      }
      set错误(undefined)
      set行们(回.value.提醒)
      set新增话(`新建 ${回.value.新建} 条`)
    })
  }

  const 标记 = (ids: readonly string[]) => {
    if (ids.length === 0) return
    void props.提醒api.markRead(props.projectId, ids).then((回) => {
      if (回.kind === "error") {
        set错误(回.message)
        return
      }
      const 已 = new Set(ids)
      set行们((上一批) =>
        上一批.map((条) =>
          已.has(条.id) && 条.read_at === null ? { ...条, read_at: Math.floor(Date.now() / 1000) } : 条,
        ),
      )
    })
  }

  return (
    <div data-component="alerts" class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-3 py-2">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-[16px] font-semibold text-v2-text-text-base">提醒</h1>
        <button
          type="button"
          data-slot="alerts-refresh"
          onClick={重新比对}
          class="h-7 rounded-[4px] bg-v2-background-bg-layer-01 px-2 text-[13px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover"
        >
          重新比对
        </button>
        <button
          type="button"
          data-slot="alerts-read-all"
          onClick={() =>
            标记(
              行们()
                .filter((条) => 条.read_at === null)
                .map((条) => 条.id),
            )
          }
          class="h-7 rounded-[4px] px-2 text-[13px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
        >
          全部标为已读
        </button>
        <Show when={新增话()}>
          {(话) => (
            <span data-slot="alerts-new-count" class="text-[12px] text-v2-text-text-muted">
              {话()}
            </span>
          )}
        </Show>
      </div>

      <Show when={错误()}>
        {(话) => (
          <p data-slot="alerts-error" role="alert" class="text-[13px] text-v2-state-fg-danger">
            {话()}
          </p>
        )}
      </Show>
      <Show when={载入() && 行们().length === 0}>
        <p class="text-[13px] text-v2-text-text-muted">正在读取提醒…</p>
      </Show>
      <Show when={!载入() && 行们().length === 0 && 错误() === undefined}>
        <p data-slot="alerts-empty" class="text-[13px] text-v2-text-text-muted">
          没有提醒
        </p>
      </Show>

      <For each={行们()}>
        {(条) => (
          <div
            data-slot="alert-row"
            data-alert-id={条.id}
            data-read={条.read_at === null ? "false" : "true"}
            class="flex items-start gap-2 border-b border-v2-border-border-muted py-1 text-[13px]"
          >
            <Show when={条.read_at === null}>
              <span data-slot="alert-unread" class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--v2-state-fg-warning)]" />
            </Show>
            <div class="min-w-0 flex-1">
              <div class="text-v2-text-text-base">{条.标题}</div>
              <div class="text-v2-text-text-muted">{条.内容}</div>
              <div class="text-[12px] text-v2-text-text-muted">
                {时间文本(条.created_at)} · {条.rule_id}
              </div>
            </div>
            <Show when={条.read_at === null}>
              <button
                type="button"
                data-slot="alert-read"
                onClick={() => 标记([条.id])}
                class="shrink-0 rounded-[4px] px-1 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
              >
                已读
              </button>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}
