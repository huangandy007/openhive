import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogV2, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { createSignal, Show, type JSX } from "solid-js"
import { FileOpError } from "./file-op-error"

/**
 * 解析动作的二次确认（计划 3 · 设计 §8.1）。
 *
 * 两条链共用：文件夹「将解析这个文件夹下的 N 个文件」与单文件「重新解析会重建全部事实」。
 * 壳与 `FileDeleteDialog` 同一套（`useDialog` ＋ `DialogV2`），焦点默认落在「取消」上
 * ——这两个动作都会覆盖已有结果（文件夹会把候选逐个入队；重新解析会删旧事实）。
 *
 * 回话约定同删除弹窗：**回一句字符串 = 没办成**，那句话就地显示、弹窗不关；`undefined` = 收工。
 */
export interface ParseConfirmDialogProps {
  标题: string
  正文: string
  确认文案: string
  /**
   * 确认按钮置灰（文件夹候选为 0 时）。灰着也**必须**把原因写进 `正文`——
   * 只灰不说，用户会以为界面卡了。
   */
  禁用?: boolean
  onConfirm: () => string | undefined | Promise<string | undefined | void>
}

export function ParseConfirmDialog(props: ParseConfirmDialogProps): JSX.Element {
  const dialog = useDialog()
  const [失败话, set失败话] = createSignal<string | undefined>()
  const [忙, set忙] = createSignal(false)

  async function 确定() {
    if (忙()) return
    set忙(true)
    let 回话: string | undefined | void
    try {
      回话 = await props.onConfirm()
    } catch {
      // 调用方正常情况下不会抛（两个出口都把失败收成字符串或 toast），这里只兜底：
      // **不**把异常抛回事件系统（那会变成一条无人接的 rejection、弹窗还开着）。
      回话 = "操作没办成，请重试"
    } finally {
      set忙(false)
    }
    if (typeof 回话 !== "string") {
      dialog.close()
      return
    }
    set失败话(回话)
  }

  return (
    <DialogV2 class="w-[min(26rem,calc(100vw-3rem))]">
      <div data-slot="parse-confirm-dialog" class="contents">
        <DialogHeader>
          <DialogTitle>{props.标题}</DialogTitle>
        </DialogHeader>
        <DialogBody class="flex w-full flex-col gap-2 px-4 pt-4 pb-2">
          <p data-slot="parse-confirm-body" class="min-w-0 text-[13px] text-v2-text-text-base">
            {props.正文}
          </p>
          <Show when={失败话()}>{(话) => <FileOpError 话={话()} />}</Show>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 autofocus data-slot="parse-confirm-cancel" variant="neutral" onClick={() => dialog.close()}>
            取消
          </ButtonV2>
          <ButtonV2
            data-slot="parse-confirm-ok"
            variant="contrast"
            disabled={忙() || props.禁用 === true}
            onClick={() => void 确定()}
          >
            {props.确认文案}
          </ButtonV2>
        </DialogFooter>
      </div>
    </DialogV2>
  )
}
