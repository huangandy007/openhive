import { Icon } from "@opencode-ai/ui/icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogBody, DialogFooter, DialogHeader, DialogTitle, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { Show, type JSX } from "solid-js"
import { 格式化字节 } from "./format-bytes"
import type { TransferProgress } from "./openhive-file-ops"

/**
 * 上传 / 下载的**传输弹窗**（2026-10-18 用户下达：不要非模态状态行，要交互式弹窗）。
 *
 * ## 两态，失败不在这里
 *
 * 1. **运行中**：文件名、字节进度、批量序号，只有一个「取消」。
 * 2. **完成**：摘要 ＋ 「关闭」——**停在弹窗**（用户裁定：与备份 / 恢复结果弹窗一致，
 *    传完大文件后一定看得到结果）。
 *
 * 失败**不弹第二张脸**：关窗后落回文件树下方那行内联红字（沿用
 * `file-op-error.tsx` 的口径——传输失败与「重命名失败」是同一类，不该有第二种说法）。
 *
 * ## 取消 / Esc / 点遮罩是**同一条**语义
 *
 * 用户裁定「取消即关窗、不报错」。所以本组件只调 `props.onCancel`／`props.onClose`，
 * **中断交给接线层**（`workspace-entry` 持有 `AbortController` 与 `dialog.show` 的 `onClose`）：
 * Esc 与点遮罩走的是 `dialog.close()`，那条路也会经过同一个收尾函数——不会出现
 * 「窗关了、传输还在后台偷偷跑」。
 */
export type FileTransferState =
  | {
      readonly kind: "running"
      readonly action: "上传" | "下载"
      readonly name: string
      readonly progress: TransferProgress
      /** 批量上传才有：「第 2 / 5 个」。单文件下载没有这一行。 */
      readonly batch?: { readonly index: number; readonly total: number }
    }
  | {
      readonly kind: "done"
      readonly action: "上传" | "下载"
      readonly files: number
      readonly bytes: number
    }

export interface FileTransferDialogProps {
  state: FileTransferState
  onCancel: () => void
  onClose: () => void
}

export function FileTransferDialog(props: FileTransferDialogProps): JSX.Element {
  const 运行 = () => {
    const state = props.state
    return state.kind === "running" ? state : undefined
  }

  return (
    <DialogV2 class="w-[min(24rem,calc(100vw-3rem))]">
      <div data-slot="file-transfer-dialog" data-state={props.state.kind} class="contents">
        <DialogHeader>
          <DialogTitle>
            <span data-slot="file-transfer-title">{标题(props.state)}</span>
          </DialogTitle>
        </DialogHeader>
        <DialogBody class="px-4 pt-4 pb-2">
          <Show when={运行()} fallback={<完成态 state={props.state} />}>
            {(state) => <运行态 state={state()} />}
          </Show>
        </DialogBody>
        <DialogFooter>
          <Show
            when={运行() !== undefined}
            fallback={
              <ButtonV2 attr:autofocus="" data-slot="file-transfer-close" variant="neutral" onClick={props.onClose}>
                关闭
              </ButtonV2>
            }
          >
            <ButtonV2 attr:autofocus="" data-slot="file-transfer-cancel" variant="neutral" onClick={props.onCancel}>
              取消
            </ButtonV2>
          </Show>
        </DialogFooter>
      </div>
    </DialogV2>
  )
}

function 标题(state: FileTransferState): string {
  return state.kind === "running" ? `正在${state.action}` : `${state.action}完成`
}

function 运行态(props: { state: Extract<FileTransferState, { kind: "running" }> }): JSX.Element {
  const 百分比 = () => {
    const { loaded, total } = props.state.progress
    if (total <= 0) return undefined
    return Math.min(100, Math.floor((loaded / total) * 100))
  }
  const 细节 = () => {
    const { loaded, total } = props.state.progress
    const 字节 = total > 0 ? `${格式化字节(loaded)} / ${格式化字节(total)}` : `已传 ${格式化字节(loaded)}`
    const batch = props.state.batch
    return batch === undefined ? 字节 : `第 ${batch.index} / ${batch.total} 个 · ${字节}`
  }

  return (
    <div data-slot="file-transfer-running" class="flex w-full min-w-0 flex-col gap-2">
      <div class="flex w-full min-w-0 items-baseline justify-between gap-2">
        <span data-slot="file-transfer-name" class="min-w-0 truncate text-[13px] text-v2-text-text-base">
          {props.state.name}
        </span>
        <Show when={百分比() !== undefined}>
          <span data-slot="file-transfer-percent" class="shrink-0 text-[13px] tabular-nums text-v2-text-text-base">
            {百分比()}%
          </span>
        </Show>
      </div>
      <span
        data-slot="file-transfer-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={百分比()}
        data-indeterminate={百分比() === undefined ? "true" : "false"}
        aria-label={`${props.state.action}进度`}
        class="block h-1 w-full overflow-hidden rounded-full bg-v2-overlay-simple-overlay-hover"
      >
        {/* 不确定态**不写 width**（同 `minio-bar.tsx` 那条：那是假装知道百分比）。 */}
        <span
          data-slot="file-transfer-progress-fill"
          class={
            百分比() === undefined
              ? "block h-full w-full animate-pulse bg-v2-text-text-base"
              : "block h-full bg-v2-text-text-base transition-[width]"
          }
          style={百分比() === undefined ? undefined : { width: `${百分比()}%` }}
        />
      </span>
      <p data-slot="file-transfer-detail" class="text-[11px] text-v2-text-text-faint">
        {细节()}
      </p>
    </div>
  )
}

function 完成态(props: { state: FileTransferState }): JSX.Element {
  const 摘要 = () => {
    const state = props.state
    if (state.kind !== "done") return ""
    return `${state.files} 个文件 · ${格式化字节(state.bytes)}`
  }

  return (
    <div data-slot="file-transfer-done" role="status" class="flex w-full min-w-0 items-start gap-1.5 text-[13px]">
      <span data-slot="file-transfer-icon" aria-hidden="true" class="mt-0.5 shrink-0 text-v2-state-fg-success">
        <Icon name="circle-check" size="small" class="[--icon-base:currentColor]" />
      </span>
      <p data-slot="file-transfer-summary" class="min-w-0 flex-1 break-all text-v2-text-text-base">
        {摘要()}
      </p>
    </div>
  )
}
