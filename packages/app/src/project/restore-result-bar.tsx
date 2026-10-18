import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { For, Show, createSignal, type JSX } from "solid-js"
import type { BackupRestoreResult } from "./openhive-backup"

/**
 * 恢复结果条（2026-10-18 用户裁定，替换原先「一句话全塞进 `file-op-message`」的写法）。
 *
 * ## 为什么不能再用那条红色告警
 *
 * 旧实现把 `恢复完成：恢复 3，保留两者 0，…，失败 0` **整句**写进 `文件话`，而那一行的颜色
 * 恒为 `text-v2-state-fg-danger`、`role="alert"` ⇒ **一次完全成功的恢复看起来像报错**。
 * 用户的原话是「分级」：成功不该红，失败才红。
 *
 * ## 三条口径
 *
 * 1. **按结果分色**：没有失败 ⇒ 中性文字 ＋ `✓`（`role="status"`）；有失败 ⇒ **只有失败计数**
 *    转红（`role="alert"`），成功的那部分照旧中性。
 * 2. **零值折叠**：`保留两者 0`、`新建空目录 0` 这类不写——它们不是「结果」，是「没发生」。
 * 3. **详情内联**：失败按 `failed` 的 `path` / `reason` 逐条展开，不再把六个数字挤成一句
 *    （那些数字里唯一能行动的是「哪几个失败、为什么」）。
 *
 * 不自动消失：结果是用户要读的东西，不是 toast。清理由用户点 ✕（`onDismiss`）。
 */
export interface RestoreResultBarProps {
  result: BackupRestoreResult
  /** 点 ✕ 清掉这条结果。省略 ⇒ 不渲染关闭钮。 */
  onDismiss?: () => void
}

export function RestoreResultBar(props: RestoreResultBarProps): JSX.Element {
  const [展开, set展开] = createSignal(false)
  const 有失败 = () => props.result.failed.length > 0

  return (
    <div
      data-slot="restore-result"
      role={有失败() ? "alert" : "status"}
      class="flex w-full min-w-0 flex-col gap-1 rounded-[4px] bg-v2-background-bg-layer-01 px-1.5 py-1 text-[13px]"
    >
      <div class="flex w-full min-w-0 items-start gap-1">
        <span
          data-slot="restore-result-icon"
          aria-hidden="true"
          class={`mt-0.5 shrink-0 ${有失败() ? "text-v2-state-fg-danger" : "text-v2-state-fg-success"}`}
        >
          <Icon name={有失败() ? "circle-x" : "circle-check"} size="small" class="[--icon-base:currentColor]" />
        </span>
        <p data-slot="restore-result-text" class="min-w-0 flex-1 break-all text-v2-text-text-base">
          {标题()}
        </p>
        <Show when={有失败()}>
          <button
            data-slot="restore-result-details"
            type="button"
            aria-expanded={展开() ? "true" : "false"}
            onClick={() => set展开(!展开())}
            class="shrink-0 rounded-[4px] px-1 text-[12px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
          >
            {展开() ? "收起" : "详情"}
          </button>
        </Show>
        <Show when={props.onDismiss}>
          <TooltipV2 value="关闭恢复结果" class="flex shrink-0">
            <button
              data-slot="restore-result-dismiss"
              type="button"
              aria-label="关闭恢复结果"
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-v2-text-text-faint hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
              onClick={() => props.onDismiss?.()}
            >
              <Icon name="close" size="small" class="[--icon-base:currentColor]" />
            </button>
          </TooltipV2>
        </Show>
      </div>

      {/* 详情只在**有失败**且用户点开时展开：`failed` 是唯一能行动的那一段。 */}
      <Show when={有失败() && 展开()}>
        <ul data-slot="restore-result-failures" class="flex min-w-0 flex-col gap-0.5">
          <For each={props.result.failed}>
            {(项) => (
              <li data-slot="restore-result-detail" class="flex min-w-0 items-baseline gap-1.5 text-[12px]">
                <span data-slot="restore-result-detail-path" class="min-w-0 break-all text-v2-text-text-base">
                  {项.path}
                </span>
                <span data-slot="restore-result-detail-reason" class="shrink-0 text-v2-text-text-faint">
                  {项.reason}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )

  /** 第一行：按结果分句；成功那一半中性、失败那一半红（只红计数，不红整句）。 */
  function 标题() {
    const 摘要 = 事实()
    const 尾 = 摘要 === "" ? "" : `；${摘要}`
    if (props.result.failed.length > 0)
      return (
        <>
          恢复完成，
          <span data-slot="restore-result-failed-count" class="text-v2-state-fg-danger">
            {props.result.failed.length} 项失败
          </span>
          {尾}
        </>
      )
    if (props.result.cancelled) return `恢复已取消${尾}`
    return `恢复完成${摘要 === "" ? "" : `：${摘要}`}`
  }

  /**
   * 「实际发生了什么」，只写非零项（零值折叠）。顺序按用户关心的先后：
   * 恢复了多少 → 保住了多少本地版本 → 跳过了多少 → 目录层面的动作。
   */
  function 事实(): string {
    const 段: string[] = []
    const { restored, keptBoth, overwritten, skipped, dirsCreated } = props.result
    if (restored.length > 0) 段.push(`恢复 ${restored.length} 个文件`)
    if (keptBoth.length > 0) 段.push(`保留 ${keptBoth.length} 个本地版本`)
    if (skipped.length > 0) 段.push(`跳过 ${skipped.length} 个相同文件`)
    if (overwritten.length > 0) 段.push(`替换 ${overwritten.length} 个目录`)
    if (dirsCreated.length > 0) 段.push(`新建 ${dirsCreated.length} 个空目录`)
    return 段.join(" · ")
  }
}
