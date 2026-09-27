import DOMPurify from "dompurify"
import { marked } from "marked"
import { extensionOf, type ViewComponent } from "@/center/view-registry"
import { BinaryView, type BytesRenderer } from "./binary-view"

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
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: 允许的标签,
    ALLOWED_ATTR: 允许的属性,
    ALLOW_DATA_ATTR: false,
  })
}

/** 服务端按 UTF-8 可解性判 text / binary，所以这里按 UTF-8 解——解不出的字节落成替换字符。 */
const 解码 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** 把 Markdown 渲成 HTML 挂进容器。导出仅供测试直接驱动——生产路径是 `RichtextView`。 */
export const renderMarkdown: BytesRenderer = async (bytes, container) => {
  container.innerHTML = sanitizeHtml(await marked.parse(解码(bytes)))
}

/**
 * 纯文本：**用 `textContent` 而不是 `innerHTML`**——压根不经 HTML 解析，就没有注入面，
 * 连转义都不必写。换行与缩进靠 `<pre>` 保住（话单摘录是一行一行对着看的）。
 */
export const renderPlainText: BytesRenderer = async (bytes, container) => {
  const pre = document.createElement("pre")
  pre.className = "font-sans whitespace-pre-wrap break-words"
  pre.textContent = 解码(bytes)
  container.appendChild(pre)
}

/**
 * 图文视图（FR-007 的 ⑥ 图文混排：`.md` / `.txt`）。
 *
 * 两个扩展名**必须分开渲**：拿 Markdown 渲染一段话单，里面的 `#` `*` 会被吃掉变成标题和强调，
 * 内容就走样了。而渲染器拿不到路径（`BytesRenderer` 只有字节），所以由视图按扩展名挑渲染器
 * ——这个三元表达式在 Solid 里是响应式的，换文件会重新求值。
 */
export const RichtextView: ViewComponent = (props) => (
  <BinaryView
    name="richtext-view"
    path={props.path}
    load={props.load}
    render={extensionOf(props.path) === ".md" ? renderMarkdown : renderPlainText}
  />
)
