import { describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { renderMarkdown, renderPlainText, RichtextView, sanitizeHtml } from "./richtext-view"

const 字节 = (s: string) => new TextEncoder().encode(s)
const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

describe("纯文本：原样显示，压根不经 HTML 解析", () => {
  test("换行与缩进都留着（话单摘录是一行一行对着看的）", async () => {
    const 容器 = document.createElement("div")
    await renderPlainText(字节("第一行\n  缩进的第二行\n\n第四行"), 容器)

    expect(容器.textContent).toBe("第一行\n  缩进的第二行\n\n第四行")
  })

  test("尖括号是字面量：文件里写着 <script> 就显示成 <script>，不是元素", async () => {
    const 容器 = document.createElement("div")
    await renderPlainText(字节("<script>alert(1)</script><img src=x>"), 容器)

    expect(容器.querySelector("script")).toBeNull()
    expect(容器.querySelector("img")).toBeNull()
    expect(容器.textContent).toBe("<script>alert(1)</script><img src=x>")
  })
})

/**
 * 文件内容是**不可信输入**——民警打开的卷宗可能来自别的单位、别的系统。
 * 只要走 HTML 解析就必须净化，且白名单只放 Markdown 真能产出的那些标签。
 *
 * ⚠️ 跑这一组时终端会打印一段 happy-dom 的 `AsyncTaskManager` / `Fetch.navigate` 的报错栈，
 * 那是 DOMPurify 在 happy-dom 里建解析文档触发的环境噪音（异步任务在 frame 销毁后才到点），
 * **不是本视图的问题**，也不影响断言——不用去追它。
 */
describe("Markdown：渲染成 HTML，且按白名单净化", () => {
  test("常见语法渲染出来（标题 / 粗体 / 列表 / 表格）", async () => {
    const 容器 = document.createElement("div")
    await renderMarkdown(字节("# 标题\n\n**粗**\n\n- 一\n- 二\n\n| 甲 | 乙 |\n| - | - |\n| 1 | 2 |\n"), 容器)

    expect(容器.querySelector("h1")?.textContent).toBe("标题")
    expect(容器.querySelector("strong")?.textContent).toBe("粗")
    expect(容器.querySelectorAll("li")).toHaveLength(2)
    expect(容器.querySelector("table")).not.toBeNull()
  })

  test("raw HTML 里的事件处理器被摘掉（onerror 是文件内容，不是我们的代码）", async () => {
    const 净 = sanitizeHtml(`<p>正文</p><img src="x" onerror="alert(1)">`)

    expect(净).toContain("<img")
    expect(净).not.toContain("onerror")
  })

  test("javascript: 链接被摘掉（href 留着，但点不动那段脚本）", async () => {
    const 净 = sanitizeHtml(`<a href="javascript:alert(1)">点我</a>`)

    expect(净).toContain("点我")
    expect(净).not.toContain("javascript:")
  })

  test("script / iframe 整段去掉，不留内容", async () => {
    expect(sanitizeHtml(`<script>alert(1)</script>`)).toBe("")
    expect(sanitizeHtml(`<iframe src="http://别的单位"></iframe>`)).toBe("")
  })

  // 一次只喂一个被禁标签：happy-dom 的 NodeIterator 在遍历中删掉一个节点后**会停摆**
  // （真浏览器按规范继续走），把两个被禁标签串在一条输入里，第二个根本走不到——
  // 那是环境的坑，不是净化的错。逐条断言才测得准（详见 richtext-view.tsx 的说明与 state.md）。
  test("白名单外的标签不留：style", async () => {
    expect(sanitizeHtml(`<style>body{display:none}</style>`)).toBe("")
  })

  // `form` 不在白名单里，会被整个删掉——**断言只看「表单没了、提交地址没了」**：
  // DOMPurify 默认 `KEEP_CONTENT: true`，删掉一个包装标签时会把它的**子节点提上来保留**，
  // 所以它的子元素还在（那是设计如此：宁肯留净化过的内容，也不整段吞掉）。
  test("白名单外的标签不留：form（element 与 action 一起没了）", async () => {
    const 净 = sanitizeHtml(`<form action="/偷传"><input name="卷宗号"></form>`)

    expect(净).not.toContain("<form")
    expect(净).not.toContain("action")
  })
})

/**
 * `.md` 与 `.txt` 共用一个视图（tasks.md 的扩展名归属），但**渲染方式必须分开**：
 * 拿 Markdown 渲染一段话单，里面的 `#` `*` 会被吃掉变成标题和强调——内容就走样了。
 * 渲染器拿不到路径（`BytesRenderer` 只有字节），所以由视图按扩展名挑渲染器。
 */
describe("图文视图：按扩展名挑渲染器", () => {
  const 装 = (path: string) =>
    mount(() => <RichtextView path={path} load={async () => ({ type: "text", content: "# 标题\n" })} />)

  test(".md 当 Markdown 渲染", async () => {
    const host = 装("/p/说明.md")
    await 落定()

    expect(host.querySelector("[data-component='richtext-view'] h1")).not.toBeNull()
  })

  test(".txt 当纯文本渲染（`#` 就是 `#`，不是标题）", async () => {
    const host = 装("/p/摘录.txt")
    await 落定()

    expect(host.querySelector("[data-component='richtext-view'] h1")).toBeNull()
    expect(host.querySelector("[data-component='richtext-view']")?.textContent).toContain("# 标题")
  })
})
