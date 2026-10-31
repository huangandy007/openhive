import { marked } from "marked"
import { createMemo, onCleanup, onMount, type JSX } from "solid-js"
import { sanitizeHtml } from "@/center/views/sanitize-html"

/**
 * 资产里的 Markdown（2026-10-31）。
 *
 * 作者在「介绍」「注意事项」里写 Markdown，读者看到的是排版后的正文；「功能描述」不渲染
 * ——它是卡片悬停浮层的一句话，渲染成块级排版反而挤坏浮层。
 *
 * 净化只有一份：走 `center/views/sanitize-html.ts`（`richtext-view` 的预览也读它）。
 * 直接 import `richtext-view.tsx` 会把整块预览视图（draft-store、binary-view、工具栏、
 * 文件选择）拖进来，所以那份策略被提成了独立模块（`#002-06`）。
 */

/** Markdown 源码 → 已净化的 HTML。同步、无 worker。 */
export function 渲染Markdown(源: string): string {
  // `marked` 在块级元素之后补了一个换行，容器里那条文本节点会让 `textContent` 与源码不全等
  // （详情页的既有用例按全等断言）。首尾空白没有意义，去掉。
  return sanitizeHtml(marked.parse(源, { async: false })).trim()
}

/**
 * Markdown 源码 → 纯文字（给卡片的两行预览用，近似实现即可）。
 *
 * 卡片只有两行、还要做行数截断，渲染成元素既挤不下也没必要——这里只把标记去掉。
 * 它是**近似**实现：复杂嵌套（列表里套代码块、链接里套图片…）允许不完美，目标是
 * 「作者写了 `**加粗**`，卡片上不露出星号」。
 */
export function 去Markdown(源: string): string {
  return (
    源
      // 围栏代码块：只去掉 ``` 那两行，块内文字保留。
      .replace(/^[ \t]*```[^\n]*$/gm, "")
      // 标题前缀
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      // 引用前缀
      .replace(/^[ \t]*>[ \t]?/gm, "")
      // 列表前缀（含 GFM 任务列表的 [ ] / [x]）
      .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+(?:\[[ xX]\][ \t]+)?/gm, "")
      // 表格分隔行（| --- | :---: |）——连行尾换行一起去掉，否则表格中间会多一个空行
      .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*\n?/gm, "")
      // 水平线
      .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "")
      // 图片 ⇒ alt（必须排在链接之前，否则 `![alt](src)` 会先被链接规则吃掉）
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // 链接 ⇒ 文字
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // 行内代码
      .replace(/`([^`]+)`/g, "$1")
      // 粗体
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      // 删除线
      .replace(/~~(.*?)~~/g, "$1")
      // 斜体（近似：不处理单词内部的单个下划线）
      .replace(/(\*|_)([^*_\n]+)\1/g, "$2")
      // 表格竖线 ⇒ 空格
      .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, 行: string) =>
        行
          .split("|")
          .map((格) => 格.trim())
          .join(" "),
      )
      // 多余空行收一收
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
}

/**
 * 详情页用的渲染容器：写完 HTML，点链接不整页跳走。
 *
 * `data-format="markdown"` 是样式钩子（`index.css` 的元素级排版规则按它分流），与
 * `richtext-view` 的 Markdown 预览共用同一套规则。
 *
 * 渲染结果为空串时也照常渲染空容器——空态由外层（详情页的 `emptyText` / 卡片）负责。
 */
export function 资产Markdown(props: { readonly text: string; readonly slot: string }): JSX.Element {
  const 已净化 = createMemo(() => 渲染Markdown(props.text))
  let 容器: HTMLDivElement | undefined

  /**
   * 拦住链接的默认跳转：这是一张 SPA，整页跳走等于把民警正在看的东西丢了。
   * 有协议前缀的（`https:` / `mailto:` …）另开标签页；`#` 开头的页内锚点交给浏览器。
   * 相对链接同样拦下——它的基准是哪个目录这里不知道，先不猜。
   */
  const 点链接 = (事件: MouseEvent) => {
    if (事件.defaultPrevented) return
    const 链接 = (事件.target as Element | null)?.closest("a")
    if (!链接) return
    const href = 链接.getAttribute("href")
    if (href === null || href.startsWith("#")) return
    事件.preventDefault()
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) window.open(href, "_blank", "noopener,noreferrer")
  }

  // 监听挂在容器上、不是挂在每个 `<a>` 上：`innerHTML` 换内容时子节点会重建，容器不变。
  onMount(() => 容器?.addEventListener("click", 点链接))
  onCleanup(() => 容器?.removeEventListener("click", 点链接))

  return <div ref={容器} data-slot={props.slot} data-format="markdown" innerHTML={已净化()} />
}
