/**
 * 「这个文件较大」弹窗（2026-10-12 / FR-005 的闸门那一半）。
 *
 * ## 壳走房子里那一套
 *
 * `useDialog()` ＋ v2 的 `DialogV2/…`（同 `project/file-create-dialog.tsx`）：顶层挂载、
 * 点遮罩关闭、Escape 关闭、右上角关闭键四样都白拿，**焦点陷阱也在里面**。
 *
 * ## 关掉 ＝ 取消（本文件最要紧的一条）
 *
 * Escape / 遮罩 / 右上角的 `×` 走的是 `dialog.close()`，**不会**经过下面那两个 `答()`。
 * 而调用方（闸门的 `dialog` 那一支）在 `await` 一个 Promise——不兜底它就会**永远悬着**：
 * 用户按了 Escape，屏幕上什么都没发生，而且以后再点「打开」也没反应（那一刻闸门还在等上一个）。
 *
 * 兜底放在 `onCleanup`：组件被拆掉时若还没答过，就按**取消**收尾。
 * ⚠️ 时序上必须安全：`答()` 先置 `已答` 再 `close()`，而 `close()` 是**两步**
 * （状态立刻变、节点 100ms 后才 `dispose()`，`LEARNINGS #005-33`）⇒ 正常那两颗钮不会
 * 触发兜底里的第二次 `on答`。
 *
 * ## 说真话
 *
 * 文案里给**真实数字**（「87 MB」）而不是「很大」；按钮叫「仍然打开」而不是「确定」
 * ——「确定」对用户是「确定要打开吗」的默认答案是「是」，而这里想让默认答案是「不」。
 * **不给**「以后别再问我」：那会把「每次提醒」变成「一次提醒」，而阈值本来就是按格式
 * 分的两档、说不清「以后」是同一种文件还是所有文件（设计文档 §4.4 的第三条取舍）。
 */

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogBody, DialogFooter, DialogHeader, DialogTitle, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { onCleanup, type JSX } from "solid-js"
import type { 问用户 } from "./open-file"

/** 「87 MB」——四舍五入到整数兆。 */
export function 多少兆(字节: number): string {
  return `${Math.round(字节 / (1024 * 1024))} MB`
}

export interface BigFileDialogProps {
  /** 文件名（含扩展名）——弹窗一盖，树上那一行就不在眼前了。 */
  文件: string
  /** 字节数（真实值）。 */
  字节: number
  /** 交出去的答案。**恰好调一次**：两颗钮各一次，或关闭时兜底一次。 */
  on答: (仍然打开: boolean) => void
}

export function BigFileDialog(props: BigFileDialogProps): JSX.Element {
  const dialog = useDialog()
  let 已答 = false

  const 答 = (仍然打开: boolean) => {
    if (已答) return
    已答 = true
    // 先收弹窗再喊回调：回调那侧会开一张 tab / 继续走闸门，弹窗不该再多留一会儿。
    dialog.close()
    props.on答(仍然打开)
  }

  // 关掉（Escape / 遮罩 / ×）＝ **取消**。理由见文件头。
  onCleanup(() => {
    if (!已答) props.on答(false)
  })

  return (
    <DialogV2 class="w-[min(26rem,calc(100vw-3rem))]">
      <div data-slot="big-file-dialog" class="contents">
        <DialogHeader>
          <DialogTitle>这个文件较大</DialogTitle>
        </DialogHeader>
        <DialogBody class="flex w-full flex-col gap-2 px-4 pt-4 pb-2">
          <p data-slot="big-file-dialog-text" class="min-w-0 text-[13px] break-all text-v2-text-text-base">
            「{props.文件}」有 <span class="font-semibold">{多少兆(props.字节)}</span>
            ，直接打开可能要等一会儿。仍然打开吗？
          </p>
        </DialogBody>
        <DialogFooter>
          {/* `autofocus` 落在**取消**上（同 `file-delete-dialog.tsx` 的取向）：默认答案是不开。
              `DialogV2` 的 `onOpenAutoFocus` 按 `[autofocus]` 找。 */}
          <ButtonV2 data-slot="big-file-cancel" type="button" variant="neutral" autofocus onClick={() => 答(false)}>
            取消
          </ButtonV2>
          <ButtonV2 data-slot="big-file-open" type="button" variant="contrast" onClick={() => 答(true)}>
            仍然打开
          </ButtonV2>
        </DialogFooter>
      </div>
    </DialogV2>
  )
}

/**
 * 把「问一句」接到弹窗上：回一个 `问用户`，每次调用弹一次、拿到答案才 resolve。
 *
 * ⚠️ 必须在**组件里**调（它要 `useDialog()`，缺 `DialogProvider` 会抛错）。
 */
export function useBigFileAsk(): 问用户 {
  const dialog = useDialog()
  return (提醒) =>
    new Promise<boolean>((resolve) => {
      void dialog.show(() => <BigFileDialog 文件={提醒.文件} 字节={提醒.字节} on答={(仍然打开) => resolve(仍然打开)} />)
    })
}
