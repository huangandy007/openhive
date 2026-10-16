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
import { Show, createSignal, type JSX } from "solid-js"
import { 改名草稿 } from "@/components/inline-rename-input"
import { FileOpError } from "./file-op-error"

export interface FileCreateDialogProps {
  /** 建文件还是建文件夹——只决定标题与占位文案（服务端 `Schema.Literals(["file","directory"])`）。 */
  kind: "file" | "directory"
  /** **落点目录**（`""` ＝ 项目根）。规则与 `onCreate` 的 `parent` 同一份，在 `file-tree.tsx` 里算。 */
  parent: string
  /**
   * 回话约定（与 `ProjectPanel.onCreate` **逐字相同**，见 `project-panel.tsx:178-187`）：
   * **回一句字符串 = 没办成**，那句话就地在弹窗里给民警看、弹窗**不关**；`undefined` / 不回 /
   * `Promise<void>` = 收工（弹窗关掉）。
   *
   * 取消 / 关闭仍然**一次都不喊**。
   */
  onConfirm: (name: string) => string | undefined | Promise<string | undefined> | void
}

export function FileCreateDialog(props: FileCreateDialogProps): JSX.Element {
  const dialog = useDialog()
  const [草稿, set草稿] = createSignal("")
  /** 上一次没办成的那句话；`undefined` = 没话说。用户一动输入框就清掉（见 `onInput`）。 */
  const [失败话, set失败话] = createSignal<string | undefined>()
  /** 交出去之后、回话之前。这段缝隙里「确定」是锁着的（见 `确定`）。 */
  const [忙, set忙] = createSignal(false)

  const 是文件夹 = () => props.kind === "directory"
  /** `undefined` ＝ 这份草稿还不值得交出去（空 / 只有空白）⇒ 「确定」禁用、提交直接返回。 */
  const 名字 = () => 改名草稿(草稿(), undefined)

  async function 确定() {
    const name = 名字()
    // `忙` 守卫：「弹窗不关」**新造**出一个旧形状不存在的洞——请求在飞时再按一次「确定」会
    // **建两次**。改之前弹窗立刻关，这个洞不存在（spec §5.2 第 1 条）。
    if (name === undefined || 忙()) return
    set忙(true)
    let 回话: string | undefined | void
    try {
      回话 = await props.onConfirm(name)
    } catch (err) {
      // 抛错 = 「我们这边坏了」。保住原注释那条理由：别让用户对着一个「填好了却没反应」的框。
      // 这一支**不在本次射程内**，一个字不改它的行为。
      dialog.close()
      throw err
    } finally {
      set忙(false)
    }
    // 只有**字符串**算「有话要说」——`undefined` / `void` 都按收工处理（同 `project-panel.tsx:711`）。
    if (typeof 回话 !== "string") {
      dialog.close()
      return
    }
    set失败话(回话)
  }

  return (
    <DialogV2 class="w-[min(24rem,calc(100vw-3rem))]">
      <form
        data-slot="file-create-dialog"
        class="contents"
        onSubmit={(event) => {
          event.preventDefault()
          void 确定()
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
              onInput={(event) => {
                set草稿(event.currentTarget.value)
                set失败话(undefined)
              }}
            />
          </Field>
          {/* 落点（用户 2026-10-11 裁定「要显示」）：弹窗盖住了树，「建在哪儿」就没有第二个地方
              看得见了。根那一档写**「项目根目录」**而不是留空——「什么都没写」与「写在根上」
              是两句话，空着会读成前者。 */}
          <p data-slot="file-create-parent" class="min-w-0 truncate text-[13px] text-v2-text-text-muted">
            建在：{props.parent || "项目根目录"}
          </p>
          {/* 失败就地在弹窗里（spec §3：失败回到**发起它的那个面**）。
              位置在落点那行下面、按钮上面——用户的眼睛本来就在这一带来回。 */}
          <Show when={失败话()}>{(话) => <FileOpError 话={话()} />}</Show>
        </DialogBody>
        <DialogFooter>
          <ButtonV2 data-slot="file-create-cancel" type="button" variant="neutral" onClick={() => dialog.close()}>
            取消
          </ButtonV2>
          <ButtonV2 data-slot="file-create-ok" type="submit" variant="contrast" disabled={名字() === undefined || 忙()}>
            确定
          </ButtonV2>
        </DialogFooter>
      </form>
    </DialogV2>
  )
}
