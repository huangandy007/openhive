/**
 * 项目级动作的二次确认弹窗（005 · 2026-10-11 用户下达）。
 *
 * ## 换掉了什么
 *
 * 改之前：点「归档」⇒ **面板最底下**冒出内联确认条 `project-archive-confirm`；「找回」则
 * **一句都不问**，点一下当场办。用户原话：「归档按钮我看到了，但是我希望归档按钮被点击后，
 * 其交互为弹窗式交互」，以及（对找回）「通过弹窗进行交互，让用户选择『找回』、『取消』」。
 *
 * 于是**一条弹窗、两个动作**：归档与找回问的是同一件事（「你确定要动这一行吗」），差别只在
 * 后果与危险色——所以不是两个组件，是同一个组件收一个 `action`。
 *
 * ## 壳与删除确认同一套
 *
 * `useDialog()` ＋ v2 的 `DialogV2/DialogHeader/DialogBody/DialogFooter`（同
 * `file-delete-dialog.tsx`、`file-create-dialog.tsx`）。顶层挂载、点遮罩关闭、Escape 关闭、
 * 右上角关闭键、**焦点陷阱**五样都白拿——手搭一层 overlay 就得自己操心，而「点遮罩 / 按
 * Escape 关掉时**不能**把项目归档掉」正是这条链最容易写漏的一支。
 *
 * ⚠️ `useDialog()` 在没有 `DialogProvider` 时**抛错**，不是返回 `undefined`：这条链要断就当场断。
 * app 里那层 Provider 在 `app.tsx`；组件测试要自己补（`project-panel.test.tsx` 顶部）。
 *
 * ## 只交一个「干 / 不干」出去
 *
 * `projectName` 是**开弹窗那一刻**由面板的行定下的，作为 prop 进来、弹窗自己不重算——所以回调
 * **不带参数**（要动哪一行，调用方那边已经是知道的那一个）。与改之前那条内联条交给
 * `onArchive` 的东西逐字相同（同一行项目），换的只是「在哪儿问」。
 *
 * ## 「取消」是默认焦点（⚠️ 这里用 `attr:autofocus`，不是 `autofocus`）
 *
 * 两个动作都把初始焦点给**安全的那一颗**。归档那边理由是「Enter 的肌肉记忆不该正好命中一个
 * 不可逆的动作」（同 `file-delete-dialog.tsx`）；找回这边是**同一个默认更有用**——用户在面板上
 * 敲回车时不该把东西从归档里拽出来。
 *
 * `DialogV2` 的 `onOpenAutoFocus` 按 **`querySelector("[autofocus]")`** 找元素
 * （`dialog-v2.tsx:101-108`），找不到就退回 Kobalte 的「第一个可聚焦项」——那会落在右上角的
 * **关闭键**上。所以这里要的是**DOM 属性**，而 `ButtonV2` 上的 `autofocus` **prop** 到不了属性上：
 *
 * - 实测（happy-dom，2026-10-11）`<ButtonV2 autofocus>` ⇒ `getAttribute("autofocus")` 是 `null`，
 *   弹窗开出来后 `activeElement` 是 `dialog-close-button`；
 * - 同一个 `<button autofocus>`（原生元素，走 Solid 编译期的属性路径）⇒ 属性在、焦点对；
 * - `<ButtonV2 attr:autofocus="">`（`attr:` 强制走 `setAttribute`）⇒ 属性在、**焦点落在取消上**。
 *
 * `attr:` 前缀是 Solid 的「这一项写成属性、不要写成 property」的写法（`jsx.d.ts:184` 给所有
 * 元素都开了 `attr:*` 这一族键）。之所以不沿用 `file-delete-dialog.tsx` 那个 `autofocus` prop：
 * 那条链在本机**量不出来**（同款实测见上），而这条要能被用例钉住——「默认焦点在取消上」是用户
 * 2026-10-11 点名要的性质，不该只靠一句注释说它有。
 *
 * ⚠️ **上游的同类落点尚未处理**（`file-delete-dialog.tsx:72` 的 `<ButtonV2 autofocus>`）——
 * 本轮的改动范围只到项目面板，那一条登记为待裁定，不要因为这里修了就顺手改它。
 */

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogV2, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { type JSX } from "solid-js"

/** 这一问是为了哪件事。三个动作共用一条弹窗，差别全在这张表上。 */
export type ProjectActionKind = "archive" | "restore" | "delete"

export interface ProjectActionDialogProps {
  action: ProjectActionKind
  /** 要动的那个项目的名字——用户得看得出对象（改之前那条内联条上的 `project-archive-name` 同款）。 */
  projectName: string
  /** 用户按下那颗确认键才喊；取消 / 点遮罩 / Escape / 右上角关闭**一次都不喊**。 */
  onConfirm: () => void
}

/**
 * 两个动作各自的文案与危险色。
 *
 * 归档那段说明句写清**三步**（用户 2026-10-06 裁定）：文件先备份进 MinIO、本地那份会删掉、
 * 之后能在「已归档」里找回——这不是措辞洁癖，民警要据此判断「我点下去会失去什么、还能不能
 * 拿回来」。找回那段只写**它会回到哪儿**：它不毁东西，别把危险操作的那套话套在它身上。
 */
const 文案 = {
  archive: {
    title: "归档",
    question: "确定归档",
    /** 一句话讲清「失去什么 + 还能不能拿回来」，对应实现里三个真实的事实。 */
    hint: "文件会先备份进 MinIO、本地这份会删掉，之后可以在「已归档」里找回。",
    ok: "归档",
    variant: "danger",
  },
  restore: {
    title: "找回",
    question: "确定找回",
    hint: "找回后它会回到「最近」与「全部」里。",
    ok: "找回",
    variant: "neutral",
  },
  /**
   * 删除（2026-10-16 spec §8）。
   *
   * ⚠️ **不提聊天记录**（用户 2026-10-16 裁决 7）：这句话只说文件会删、找不回来。
   * 它**不是假话**——它没有声称「所有数据都没了」；但**它是省略**（会话与消息仍在库里，
   * spec §11 取舍 3）。那件事**必须对管理员写清楚**，不是对民警。
   */
  delete: {
    title: "删除",
    question: "确定删除",
    hint: "项目里的文件会一并删掉，删了找不回来。",
    ok: "删除",
    variant: "danger",
  },
} as const

export function ProjectActionDialog(props: ProjectActionDialogProps): JSX.Element {
  const dialog = useDialog()
  const 本 = () => 文案[props.action]

  function 确定() {
    // 先收弹窗再喊回调（同 `file-delete-dialog` 的收尾顺序）：回调那侧会去发请求，若它同步失败
    // （哨兵 / 抛错），弹窗已经不在，用户不会对着一个「按了却没反应」的框发呆。
    dialog.close()
    props.onConfirm()
  }

  return (
    <DialogV2 class="w-[min(24rem,calc(100vw-3rem))]">
      <div data-slot="project-action-dialog" class="contents">
        <DialogHeader>
          <DialogTitle>{本().title}</DialogTitle>
        </DialogHeader>
        <DialogBody class="flex w-full flex-col gap-2 px-4 pt-4 pb-2">
          <p class="min-w-0 text-[13px] text-v2-text-text-base">
            {本().question}「<span data-slot="project-action-name">{props.projectName}</span>」？
          </p>
          <p data-slot="project-action-hint" class="min-w-0 text-[12px] text-v2-text-text-muted">
            {本().hint}
          </p>
        </DialogBody>
        <DialogFooter>
          {/* `attr:autofocus` 让焦点落在「取消」上（写法与理由见文件头「默认焦点」那段）。 */}
          <ButtonV2
            attr:autofocus=""
            data-slot="project-action-cancel"
            variant="neutral"
            onClick={() => dialog.close()}
          >
            取消
          </ButtonV2>
          <ButtonV2 data-slot="project-action-ok" variant={本().variant} onClick={确定}>
            {本().ok}
          </ButtonV2>
        </DialogFooter>
      </div>
    </DialogV2>
  )
}
