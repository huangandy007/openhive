import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogV2, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { For, Show, type JSX } from "solid-js"

/**
 * 「搬一批」的结果（2026-10-15 用户下达：失败要**通过弹窗**交互，不要内联一句话）。
 *
 * ⚠️ 类型定义在**弹窗这一侧**而不是接线层：它是这个弹窗唯一要读的东西，接线层 import 它，
 * 两边不各写一份（`LEARNINGS #002-06`）。
 */
export type 搬报告 = {
  标题: "移动" | "复制"
  成了: string[]
  没成: { 路径: string; 原因: string }[]
}

export interface FileMoveReportDialogProps {
  报告: 搬报告
}

/**
 * 批量移动 / 复制的**只读**报告弹窗。
 *
 * ## 为什么由接线层开、不由文件树自己开
 *
 * 删除的二次确认由树自己开（对象就在树里），这条正相反：**远端结果只有发请求那一层知道**
 * （哪几个成了、服务端各回了什么话）。树只交出「哪一批、往哪儿」，结果回到接线层，
 * 由它决定怎么报（spec §3.2）。
 *
 * ## 壳与新建 / 删除弹窗同一套
 *
 * `useDialog()` ＋ v2 的 `DialogV2/DialogHeader/DialogBody/DialogFooter`（同
 * `file-delete-dialog.tsx`）：顶层挂载、点遮罩关闭、Escape 关闭、右上角关闭键、**焦点陷阱**
 * 五样都白拿——手搭一层 overlay 就得自己操心。`attr:autofocus=""` 而非 `autofocus`：
 * prop 形态落不成 DOM 属性，判据钉不住（同 `file-download-dialog.tsx`）。
 *
 * ## 全成那一条**不会**开到这儿
 *
 * 全部成功时不弹窗（spec §6：这是最常走的那条，不该每次都拦一下）⇒ 本组件不必画「一切顺利」
 * 的样子，它出现的每一次都至少有一条没成。
 */
export function FileMoveReportDialog(props: FileMoveReportDialogProps): JSX.Element {
  const dialog = useDialog()
  return (
    <DialogV2 class="w-[min(30rem,calc(100vw-3rem))]">
      <div data-slot="file-move-report-dialog" class="contents">
        <DialogHeader>
          <DialogTitle>
            {props.报告.标题}：{props.报告.没成.length} 个没成功
          </DialogTitle>
        </DialogHeader>
        <DialogBody class="flex w-full flex-col gap-2 px-4 pt-4 pb-2">
          {/* 列表可能很长（一次拖了十几行）⇒ 限高 ＋ 自己能滚，别把弹窗撑出屏幕。 */}
          <ul data-slot="file-move-report-failed" class="flex max-h-64 min-w-0 flex-col gap-1 overflow-y-auto">
            <For each={props.报告.没成}>
              {(项) => (
                <li class="flex min-w-0 flex-col gap-0.5">
                  <span data-slot="file-move-report-failed-path" class="min-w-0 truncate text-[13px] text-v2-text-text-base">
                    {项.路径}
                  </span>
                  <span class="min-w-0 text-[12px] text-v2-text-text-muted">{项.原因}</span>
                </li>
              )}
            </For>
          </ul>
          {/* 「成了的」只在**确实有**的时候画：全败时画一段空的「成功」列表是句假话（`#005-45`）。 */}
          <Show when={props.报告.成了.length > 0}>
            <div class="flex min-w-0 flex-col gap-1 border-t border-v2-border-border-base pt-2">
              <span class="text-[12px] text-v2-text-text-muted">这些已经搬好了：</span>
              <ul data-slot="file-move-report-done" class="flex max-h-32 min-w-0 flex-col gap-0.5 overflow-y-auto">
                <For each={props.报告.成了}>
                  {(路径) => (
                    <li data-slot="file-move-report-done-path" class="min-w-0 truncate text-[12px] text-v2-text-text-base">
                      {路径}
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 attr:autofocus="" data-slot="file-move-report-close" variant="neutral" onClick={() => dialog.close()}>
            关闭
          </ButtonV2>
        </DialogFooter>
      </div>
    </DialogV2>
  )
}
