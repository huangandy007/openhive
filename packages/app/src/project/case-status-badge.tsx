import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Show, type JSX } from "solid-js"
import type { 解析状态 } from "./case-materials-api"
import { 标记形状 } from "./case-materials-view"

/**
 * 行尾的解析状态标记（设计 §8.1）。
 *
 * ## 形状 + 颜色 + 可访问名称，三样一起传意
 *
 * 只给颜色不满足 `DESIGN §4.3`（不单以颜色传意）；只给形状则色弱用户分不清「半圆是排队
 * 还是解析中」。故：形状区分状态族（运行中 / 完成 / 有问题），颜色做二级区分，`aria-label`
 * 与悬停文案**同源**——读屏读到的就是鼠标悬停看到的那一句。
 *
 * ## 未入队 / 已跳过**不画标记**
 *
 * 这两个状态是「安静的」：一个还没轮到、一个用户主动跳过。画一个灰点会把行变成噪点。
 * 它们的解释由行上的 `title` 给（见 `file-tree.tsx` 的 `行提示`）。
 *
 * ## 本组件**只读传入的 `status`**
 *
 * 不读 store、不推演状态、不挂 `createEffect`（`#005-03`：无 effect 就无清理遗漏）。
 */
export function CaseStatusBadge(props: { status: 解析状态; 文案: string }): JSX.Element {
  const 形状 = () => 标记形状(props.status)
  const 颜色 = () =>
    props.status === "已解析"
      ? "text-v2-state-fg-success"
      : props.status === "有问题"
        ? "text-v2-state-fg-warning"
        : "text-v2-state-fg-info"

  return (
    <Show when={形状()}>
      {(形状值) => (
        <TooltipV2 value={props.文案} class="flex shrink-0">
          <span
            data-slot="file-tree-parse-badge"
            data-status={props.status}
            data-shape={形状值()}
            role="img"
            aria-label={props.文案}
            class={`flex h-4 w-4 shrink-0 items-center justify-center ${颜色()}`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <Show when={形状值() === "half"}>
                <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path d="M7 1.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" />
              </Show>
              <Show when={形状值() === "check"}>
                <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path
                  d="M4.1 7.3l2 2 3.9-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </Show>
              <Show when={形状值() === "alert"}>
                <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path d="M7 4v3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                <circle cx="7" cy="10" r="0.8" fill="currentColor" />
              </Show>
            </svg>
          </span>
        </TooltipV2>
      )}
    </Show>
  )
}
