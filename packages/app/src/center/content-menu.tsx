import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { type ParentProps } from "solid-js"
import { 发送到会话, 发送失败提示 } from "@/ai-session/send-to-session"
import { 复制文本 } from "@/utils/copy-text"
import { showToast } from "@/utils/toast"

/**
 * 中栏内容区的右键菜单（2026-10-14 用户提出：选中一段内容，右键发给 AI 会话）。
 *
 * ## 为什么挂在中栏容器上、不挂在每个视图里
 *
 * 中栏的内容视图（表格 / 文档 / 代码）样式各异，但**系统选区是全局的**
 * （`window.getSelection()`）：一处挂、全覆盖，且拿到的就是用户看到的那一段
 * （原生拖选给出的表格文本是制表符分隔的，探针实测）。
 *
 * ## 「没选中就不接管」（关键词法，已核实 Kobalte 源码）
 *
 * `@kobalte/core` 的 `ContextMenu.Trigger` 在自己的 `onContextMenu` 里
 * **无条件** `preventDefault()` ＋ 开菜单（`context-menu-trigger.tsx:100-109`）——一旦事件冒泡到它，
 * 浏览器原生菜单就没了。所以：
 * - 我们的 handler 挂在 Trigger **里面**的一层；
 * - 没选中 ⇒ `e.stopPropagation()`（事件到不了 Trigger ⇒ 原生菜单照出）；
 * - 有选中 ⇒ 不拦，让它冒泡上去、由 Trigger 接管。
 *
 * 这就是「右键菜单里有『复制』」之所以是**底线**的原因：我们接管的那一刻，浏览器那份（复制 /
 * 全选 / 打印）就没了（`LEARNINGS #006-32`：降级实现不能变成「功能更少的控件」）。
 *
 * ## 两层 `display: contents`
 *
 * Trigger 那一层与里面那一层都**不产生盒** ⇒ 中栏两栏的 flex 布局逐像素不变。这是必须的：
 * `data-slot="center-split"` 被真栈 e2e 依赖，而 Kobalte 的 Trigger 会覆盖我们传的 `data-slot`
 * （`LEARNINGS #005-22`）⇒ 那个 div 只能留在里面、不能自己当 Trigger。
 */
const 默认取选区 = () => window.getSelection()?.toString() ?? ""

export interface 内容菜单Props {
  /** 读当前系统选区。**测试注入替身**（happy-dom 的 Selection 与真浏览器不同），生产用默认那个。 */
  取选区?: () => string
}

export function 内容菜单(props: ParentProps<内容菜单Props>) {
  const 取选区 = () => (props.取选区 ?? 默认取选区)()
  /** 右键那一刻的选中文本。菜单项读它——右键之后、点菜单之前，选区不会变。 */
  let 这次的选区 = ""

  /**
   * 复制那段选中的内容。失败时说一句——**静默失败最难查**。
   * 复用仓里已有的口（`utils/copy-text.ts` 的 `复制文本`），不自己写一套 clipboard（`LEARNINGS #005-20`）。
   */
  const 复制 = () => {
    void 复制文本(这次的选区).then((成) => {
      if (!成) showToast("复制没成功")
    })
  }

  /** 发给右栏会话。失败的说法由接线盒给（只有那一处，`#002-06`），这里只管弹出来。 */
  const 发送 = () => {
    const 结果 = 发送到会话(这次的选区)
    if (!结果.ok) showToast(发送失败提示(结果.原因))
  }

  return (
    <ContextMenu modal={false}>
      <ContextMenu.Trigger class="contents">
        <div
          class="contents"
          onContextMenu={(事件) => {
            const 文本 = 取选区().trim()
            if (!文本) {
              // 不接管 ⇒ 但也不能让它冒泡到 Trigger（那会被 preventDefault、原生菜单就没了）
              事件.stopPropagation()
              return
            }
            这次的选区 = 文本
          }}
        >
          {props.children}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <ContextMenu.Item onSelect={复制}>
            <ContextMenu.ItemLabel>复制</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={发送}>
            <ContextMenu.ItemLabel>发送到会话</ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}
