import DOMPurify from "dompurify"

/**
 * 白名单只放 **Markdown 真能产出的**标签（外加 GFM 任务列表的 `input`）——比「先全放再删黑的」稳：
 * 新的危险标签出现时，白名单是默认拒绝的。
 */
const 允许的标签 = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
  "img",
  "span",
  "input",
]

const 允许的属性 = ["href", "src", "alt", "title", "class", "align", "start", "type", "checked", "disabled"]

/**
 * 净化一段 HTML。**文件内容是不可信输入**——民警打开的卷宗可能来自别的单位、别的系统，
 * 文件里写什么由不得我们。只要走 `innerHTML` 就必须先过这里。
 *
 * ⚠️ 这里没有复用 `@opencode-ai/session-ui/markdown-cache` 的 `sanitizeMarkdown`，两个原因：
 * ① 那个模块静态 import 了 `markdown.worker.ts?worker&url`，引它就把 worker 机制拖进预览的 chunk，
 *    而且 Bun 测试环境解不了 `?worker&url`，视图会连测都测不了；
 * ② 那份配置是给聊天消息调的（要 SVG / MathML），**预览要的更窄**。
 * 两者都基于 DOMPurify，策略分叉是有意的，不是漏抄。
 *
 * ⚠️ **测试环境测不满**：happy-dom 的 `NodeIterator` 在遍历中删掉一个节点后会**停摆**
 * （真浏览器按规范继续走下一个兄弟），而 DOMPurify 正是靠它逐节点净化。后果是「某个被禁节点
 * **之后**的内容」在本环境走不到，断言会假红。故测试一律**一条输入只喂一个被禁标签**；
 * 「含有 script 的长文档整体被净化」这件事本环境验不了，留真实浏览器核对（见 state.md）。
 *
 * 独立成模块（2026-10-31）：净化策略只能有一份（`#002-06`），但 `ai-assets` 直接用
 * `richtext-view.tsx` 会把整块预览视图（draft-store、binary-view、工具栏、文件选择）拖进来。
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: 允许的标签,
    ALLOWED_ATTR: 允许的属性,
    ALLOW_DATA_ATTR: false,
  })
}
