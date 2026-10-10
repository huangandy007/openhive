/**
 * 「新建文件 / 新建文件夹」弹窗（005 · 2026-10-11 用户下达）。
 *
 * ## 换掉了什么
 *
 * 改之前：点「＋」⇒ 工具栏下**撑开一块**两项的下拉 ⇒ 选一项 ⇒ **同一处再撑开一根输入条**
 * ⇒ 敲 Enter 才建。用户原话：「会在文件 Tab 页面的图标下方显示输入框……这与日常习惯不符，
 * 我希望还是以弹窗的方式进行交互更好」。
 *
 * 改之后：选完「新建文件 / 新建文件夹」，名字在一个**模态弹窗**里问——落点写在弹窗里
 * （`建在：…`），因为弹窗一盖，树就不在眼前了。
 *
 * ## 壳走房子里的那一套，不自己搭
 *
 * `useDialog()`（`@opencode-ai/ui/context/dialog`）＋ v2 的 `Dialog/DialogHeader/DialogBody/
 * DialogFooter`（同 `components/dialog-edit-project-v2.tsx`）。顶层挂载、点遮罩关闭、Escape 关闭、
 * 右上角关闭键四样都白拿，**焦点陷阱也在里面**——手搭一层 overlay 就得自己操心这些
 * （`auth/change-password.tsx` 的注释里记着那个代价）。
 *
 * ⚠️ `useDialog()` 在没有 `DialogProvider` 时**抛错**，不是返回 `undefined`：这条链要断就当场断。
 * app 里那层 Provider 在 `app.tsx`；组件测试要自己补（`file-create-dialog.test.tsx` 顶部）。
 *
 * ## 判据「名字值不值得交出去」复用 `改名草稿`
 *
 * `trim` 后为空 ⇒ 不算一次新建（服务端 `name` 是必填，「建一个没名字的条目」根本不成立）。
 * 这条判据**不在这里再写一份**——`@/components/inline-rename-input` 的 `改名草稿` 就是它
 * （`LEARNINGS #002-06`：同一个判断两处各写一份，迟早只改一处）。新建这一支没有「原名」可比较，
 * 传 `undefined`，那个函数的第二条判据自然不成立。
 *
 * ## 只交一个名字出去
 *
 * `kind` 与 `parent` 是**开弹窗那一刻**由树的入口（＋ 下拉 / 右键菜单）定下的，作为 prop 进来、
 * 弹窗自己不重算——所以回调只回 `name`。这与改之前那根行内输入条交给 `onCreate` 的东西逐字相同
 * （`{ kind, parent, name }`），换的只是「名字在哪儿问」。
 */

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogV2, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { createSignal, type JSX } from "solid-js"
import { 改名草稿 } from "@/components/inline-rename-input"

export interface FileCreateDialogProps {
  /** 建文件还是建文件夹——只决定标题与占位文案（服务端 `Schema.Literals(["file","directory"])`）。 */
  kind: "file" | "directory"
  /** **落点目录**（`""` ＝ 项目根）。规则与 `onCreate` 的 `parent` 同一份，在 `file-tree.tsx` 里算。 */
  parent: string
  /** 用户确认后交出**已 trim**的名字；取消 / 关闭**一次都不喊**。 */
  onConfirm: (name: string) => void
}

export function FileCreateDialog(props: FileCreateDialogProps): JSX.Element {
  const dialog = useDialog()
  const [草稿, set草稿] = createSignal("")

  const 是文件夹 = () => props.kind === "directory"
  /** `undefined` ＝ 这份草稿还不值得交出去（空 / 只有空白）⇒ 「确定」禁用、提交直接返回。 */
  const 名字 = () => 改名草稿(草稿(), undefined)

  function 确定() {
    const name = 名字()
    if (name === undefined) return
    // 先收弹窗再喊回调：回调那侧会去发请求，若它同步失败（哨兵 / 抛错），弹窗已经不在，
    // 用户不会对着一个「填好了却没反应」的框发呆（同改之前那根行内输入条收尾的顺序）。
    dialog.close()
    props.onConfirm(name)
  }

  return (
    <DialogV2 class="w-[min(24rem,calc(100vw-3rem))]">
      <form
        data-slot="file-create-dialog"
        class="contents"
        onSubmit={(event) => {
          event.preventDefault()
          确定()
        }}
      >
        <DialogHeader>
          <DialogTitle>{是文件夹() ? "新建文件夹" : "新建文件"}</DialogTitle>
        </DialogHeader>
        <DialogBody class="flex w-full flex-col gap-2 px-4 pt-4 pb-2">
          <Field>
            <Field.Label>名称</Field.Label>
            {/* `autofocus` 由 `DialogV2` 的 `onOpenAutoFocus` 认（它按 `[autofocus]` 找）——
                打开就落在这个框里，用户不必先点一下。 */}
            <TextInputV2
              autofocus
              appearance="large"
              class="!w-full"
              name="fileName"
              aria-label={是文件夹() ? "新文件夹名称" : "新文件名称"}
              placeholder={是文件夹() ? "文件夹名" : "文件名"}
              value={草稿()}
              onInput={(event) => set草稿(event.currentTarget.value)}
            />
          </Field>
          {/* 落点（用户 2026-10-11 裁定「要显示」）：弹窗盖住了树，「建在哪儿」就没有第二个地方
              看得见了。根那一档写**「项目根目录」**而不是留空——「什么都没写」与「写在根上」
              是两句话，空着会读成前者。 */}
          <p data-slot="file-create-parent" class="min-w-0 truncate text-[13px] text-v2-text-text-muted">
            建在：{props.parent || "项目根目录"}
          </p>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 data-slot="file-create-cancel" type="button" variant="neutral" onClick={() => dialog.close()}>
            取消
          </ButtonV2>
          <ButtonV2 data-slot="file-create-ok" type="submit" variant="contrast" disabled={名字() === undefined}>
            确定
          </ButtonV2>
        </DialogFooter>
      </form>
    </DialogV2>
  )
}
