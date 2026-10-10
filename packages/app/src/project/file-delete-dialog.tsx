/**
 * 「删除」二次确认弹窗（005 · 2026-10-11 用户下达，⑦-③）。
 *
 * ## 换掉了什么
 *
 * 改之前：点删除图标 / 右键「删除」⇒ **文件树栏最底部**冒出一条**整栏宽**的横幅，写着
 * 「确定删除「X」？ 取消 删除」。用户原话：「删除的交互在**本页面的底部**显示"取消"、"删除"，
 * 这个体验感不好，我希望还是以弹窗的方式进行交互」。
 *
 * 真栈实测把「体验感不好」量成了几何（读数见 `state.md` ⑦-③）：那条宽 262px（＝ 与工具栏同宽）、
 * 上 813，而**树区域止于 809** ⇒ 它落在**树区域之外**——用户点的是树里第 3 行，条出现在整棵树
 * 下方 800px 处，中间隔了 31 行。所以这不是「位置不好看」，是**确认对象与确认动作被树隔开了**。
 *
 * ## 壳与新建弹窗同一套
 *
 * `useDialog()` ＋ v2 的 `DialogV2/DialogHeader/DialogBody/DialogFooter`（同
 * `file-create-dialog.tsx`）。顶层挂载、点遮罩关闭、Escape 关闭、右上角关闭键、**焦点陷阱**
 * 五样都白拿——手搭一层 overlay 就得自己操心，而「点遮罩/按 Escape 关掉时**不能**删」
 * 正是这条链最容易写漏的一支（`auth/change-password.tsx` 的注释里记着那个代价）。
 *
 * ⚠️ `useDialog()` 在没有 `DialogProvider` 时**抛错**，不是返回 `undefined`：这条链要断就当场断。
 * app 里那层 Provider 在 `app.tsx`；组件测试要自己补（`file-tree.test.tsx` 顶部）。
 *
 * ## 只交一个「删或不删」出去
 *
 * `path` 是**开弹窗那一刻**由树的入口（工具栏 / 右键菜单）定下的，作为 prop 进来、弹窗自己不重算
 * ——所以回调**不带参数**（要删谁，弹窗这边已经是知道的那一个）。这与改之前那条内联横幅交给
 * `onDelete` 的东西逐字相同（同一个 `path`），换的只是「在哪儿问」。
 *
 * ## 「取消」是默认焦点，不是「删除」
 *
 * 破坏性动作的对话框把初始焦点给**安全的那一颗**（`autofocus` 落在「取消」上）：用户敲 Enter
 * 的肌肉记忆在这里不该正好命中删除。`DialogV2` 的 `onOpenAutoFocus` 按 `[autofocus]` 找元素
 * （`dialog-v2.tsx:103`），找不到才退回 Kobalte 的「第一个可聚焦项」。
 */

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogV2, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { type JSX } from "solid-js"

export interface FileDeleteDialogProps {
  /** 要删的那一项的路径——用户得看得出对象（改之前那条横幅上的 `file-tree-delete-name` 同款）。 */
  path: string
  /** 用户按下「删除」才喊；取消 / 点遮罩 / Escape / 右上角关闭**一次都不喊**。 */
  onConfirm: () => void
}

export function FileDeleteDialog(props: FileDeleteDialogProps): JSX.Element {
  const dialog = useDialog()

  function 确定() {
    // 先收弹窗再喊回调（同 `file-create-dialog` 的收尾顺序）：回调那侧会去发请求，若它同步失败
    // （哨兵 / 抛错），弹窗已经不在，用户不会对着一个「按了却没反应」的框发呆。
    dialog.close()
    props.onConfirm()
  }

  return (
    <DialogV2 class="w-[min(24rem,calc(100vw-3rem))]">
      <div data-slot="file-delete-dialog" class="contents">
        <DialogHeader>
          <DialogTitle>删除</DialogTitle>
        </DialogHeader>
        <DialogBody class="flex w-full flex-col gap-2 px-4 pt-4 pb-2">
          <p class="min-w-0 text-[13px] text-v2-text-text-base">
            确定删除「<span data-slot="file-delete-name">{props.path}</span>」？
          </p>
        </DialogBody>
        <DialogFooter>
          {/* `autofocus` 落在「取消」上（见文件头「默认焦点」那段）。 */}
          <ButtonV2 autofocus data-slot="file-delete-cancel" variant="neutral" onClick={() => dialog.close()}>
            取消
          </ButtonV2>
          <ButtonV2 data-slot="file-delete-ok" variant="danger" onClick={确定}>
            删除
          </ButtonV2>
        </DialogFooter>
      </div>
    </DialogV2>
  )
}
