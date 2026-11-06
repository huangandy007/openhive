import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { createCaseAlertsApi, type CaseAlertsApi, type 提醒行 } from "./case-alerts-api"

export interface CaseAlertEntryProps {
  readonly projectId: () => string | undefined
  readonly api?: CaseAlertsApi
  readonly onOpen: () => void
}

/**
 * 右栏会话顶部的「新提醒 N 条」（design §7.3）。
 *
 * **只读、不比对**：比对是写操作（`POST /alerts/refresh`），挂在用户看得见的「重新比对」按钮上
 * （中栏清单页）；右栏每次挂载都扫一遍全项目会把打开右栏变成一次重活。
 *
 * 默认客户端只在第一次用到时建（模块级常量会让测试替身与生产实例混住，同 `#002-02` 取向）。
 */
export function CaseAlertEntry(props: CaseAlertEntryProps): JSX.Element {
  // ⚠️ `let` 必须写在 `api()` 之前：`let` 虽提升，但 TDZ 里第一次调用就是 `ReferenceError`。
  let 默认api: CaseAlertsApi | undefined
  const api = () => props.api ?? (默认api ??= createCaseAlertsApi())
  const [提醒, set提醒] = createSignal<readonly 提醒行[]>([])
  const [错误, set错误] = createSignal(false)

  createEffect(() => {
    const 项目 = props.projectId()
    const 客户端 = api()
    set提醒([])
    set错误(false)
    if (项目 === undefined) return
    let 作废 = false
    // ⚠️ 清理必须挂 `onCleanup`：`createEffect` **不执行**返回值（`LEARNINGS #005-03`）。
    // 写成 `return () => { 作废 = true }` 时，迟到的旧项目回包会盖掉新项目的那一份。
    onCleanup(() => {
      作废 = true
    })
    void 客户端.list(项目).then((结果) => {
      if (作废) return
      if (结果.kind === "error") {
        set错误(true)
        return
      }
      set提醒(结果.value)
    })
  })

  const 未读数 = createMemo(() => 提醒().filter((条) => 条.read_at === null).length)

  return (
    <Show
      when={props.projectId() !== undefined}
      fallback={
        <span data-slot="case-alert-entry" class="px-3 py-1 text-[12px] text-v2-text-text-muted">
          未选择项目
        </span>
      }
    >
      <button
        type="button"
        data-slot="case-alert-entry"
        data-unread={未读数()}
        class="flex w-full shrink-0 cursor-pointer items-center gap-1 border-b border-v2-border-border-muted px-3 py-1 text-start text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
        onClick={() => props.onOpen()}
      >
        <Show when={未读数() > 0} fallback={<span>没有新提醒</span>}>
          <span data-slot="case-alert-count" class="font-semibold text-v2-text-text-base">
            新提醒 {未读数()} 条
          </span>
        </Show>
        <Show when={错误()}>
          <span data-slot="case-alert-error" class="text-v2-state-fg-danger">
            读取失败
          </span>
        </Show>
      </button>
    </Show>
  )
}
