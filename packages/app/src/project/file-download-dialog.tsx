/**
 * 「文件夹不能下载」的告知弹窗（005 · 2026-10-11 用户下达）。
 *
 * ## 它替掉的是什么
 *
 * 改之前：右键文件夹，菜单里「下载」**是亮的**，点了白跑一次
 * `GET /openhive/file/download?path=材料` —— 服务端 `!info.isFile()` ⇒ **400「文件不存在」**
 * （`packages/opencode/src/server/openhive/file.ts` 的 `handleDownload`），前端只能报一句
 * 「下载「材料」失败」：真相是「文件夹不能下载」，界面说的是「失败」，民警不知道该点哪儿，
 * 而那次 400 还进 F12。
 *
 * 用户原话：「在前端下载文件夹时给出只能下载单个文件的弹窗交互，终止下载。如果只是下载单个文件
 * 就发行下载。」
 *
 * ## 只有一颗钮——这不是确认弹窗
 *
 * `FileDeleteDialog` / `ProjectActionDialog` 都是「问一句、等你选」，所以它们有取消 ＋ 确定两颗。
 * 这一条**没有可确认的事**：下载已经终止，用户能做的只有「知道了」。画一颗「取消」等于假装
 * 刚才有个选择（点了也不会发生别的），那是另一种谎。
 *
 * ## 壳与删除确认同一套
 *
 * `useDialog()` ＋ v2 的 `DialogV2/DialogHeader/DialogBody/DialogFooter`（同
 * `file-delete-dialog.tsx`、`file-create-dialog.tsx`、`project-action-dialog.tsx`）：顶层挂载、
 * 点遮罩关闭、Escape 关闭、右上角关闭键、**焦点陷阱**五样都白拿。
 *
 * ⚠️ `useDialog()` 在没有 `DialogProvider` 时**抛错**，不是返回 `undefined`：这条链要断就当场断。
 *
 * ## 默认焦点用 `attr:autofocus`，不是 `autofocus` prop
 *
 * 本弹窗只有一颗钮，焦点**必须**落在它身上（不然 Enter / 空格落在哪儿都不确定）。`DialogV2` 的
 * `onOpenAutoFocus` 按 **`querySelector("[autofocus]")`** 找元素，找不到就退回 Kobalte 的
 * 「第一个可聚焦项」（实测会落在右上角的**关闭键**上）。而 `ButtonV2` 上的 `autofocus` **prop**
 * 到不了属性上——实测（happy-dom，2026-10-11）`<ButtonV2 autofocus>` ⇒
 * `getAttribute("autofocus")` 是 `null`；写成 `attr:autofocus=""`（Solid 的「这一项走
 * `setAttribute`」写法）⇒ 属性在、焦点对。理由与实测全文见 `project-action-dialog.tsx` 文件头。
 *
 * ⚠️ `file-delete-dialog.tsx:72` 那处同款（`<ButtonV2 autofocus>`）**仍未处理**，登记为待裁定：
 * 本轮的改动范围只到下载这一条，不要因为这里写对了就顺手改它。
 */

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogV2, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { type JSX } from "solid-js"

export interface FileDownloadDialogProps {
  /**
   * 被点的那一项的路径——用户得看得出**是哪一个**文件夹（同 `FileDeleteDialog.path` 的口径）。
   *
   * 它就是文件树里那条路径本身（目录**不带**尾斜杠：尾斜杠是「复制路径」那一项自己对目录的
   * 标示法，见 `file-tree.tsx` 的 `复制路径`）。这里那句「是文件夹」已经把类型说出来了，
   * 不必再靠斜杠。
   */
  path: string
}

export function FileDownloadDialog(props: FileDownloadDialogProps): JSX.Element {
  const dialog = useDialog()

  return (
    <DialogV2 class="w-[min(24rem,calc(100vw-3rem))]">
      <div data-slot="file-download-dialog" class="contents">
        <DialogHeader>
          <DialogTitle>无法下载文件夹</DialogTitle>
        </DialogHeader>
        <DialogBody class="flex w-full flex-col gap-2 px-4 pt-4 pb-2">
          <p class="min-w-0 text-[13px] text-v2-text-text-base">
            「<span data-slot="file-download-name">{props.path}</span>」是文件夹，只能下载单个文件。
          </p>
          {/* 第二句是**怎么办**——只说「不行」的话民警下一步还得自己猜（同 `ProjectActionDialog`
              的 `hint`：那句解释是给「我该做什么」用的，不是措辞洁癖）。 */}
          <p data-slot="file-download-hint" class="min-w-0 text-[12px] text-v2-text-text-muted">
            想取整份文件夹，请打开它、逐个下载里面的文件。
          </p>
        </DialogBody>
        <DialogFooter>
          {/* 唯一一颗钮，也是默认焦点（写法与理由见文件头「默认焦点」那段）。 */}
          <ButtonV2 attr:autofocus="" data-slot="file-download-ok" variant="neutral" onClick={() => dialog.close()}>
            知道了
          </ButtonV2>
        </DialogFooter>
      </div>
    </DialogV2>
  )
}
