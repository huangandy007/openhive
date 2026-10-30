import { describe, expect, test } from "bun:test"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { FileContent } from "@/center/file-content"
import type { CodeEditorComponent, CodeEditorLoader } from "./code-view"
import { HtmlView } from "./html-view"

/**
 * 这些断言值得写，是因为它们各自钉住一条**出错时看不出来**的行为：
 *
 * ① 预览卡把**原文一字不改**交给 `srcdoc`——中间任何「顺手净化 / 转义 / 截断」都会让页面
 *    变成另一个页面，而它照样能显示，光看界面分不出对错；
 * ② `sandbox` 里少一个 `allow-same-origin` 就是安全线本身（见那条用例的注释）；
 * ③ 「预览 / 源码」切换与**换文件重置**是两套状态：上一份文件的源码模式若带到下一份，
 *    民警会对着新文件看到旧文件的代码——不报错、不变红，只是内容错了（`#010-04` 同族）；
 * ④ 取不到 / 读失败 / 换文件三种路径都要重新走 `load`，且不许把旧正文留在屏上。
 *
 * ⚠️ **真沙箱行为在本环境验不了**：happy-dom 只保留 `sandbox` / `srcdoc` 属性，
 * 不实现沙箱策略——「页面里的脚本到底能不能跑」「跑起来拿不拿得到 cookie」都是**真实浏览器
 * 核对项**（见 state.md），别把这里的绿读成「沙箱已验证」。
 */

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

/** 让「换路径 → 取内容」整条异步链跑完。 */
const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * 问「这东西在不在」时不要把 DOM 节点交给 `expect`：失败信息会把 happy-dom 的整张元素图
 * 序列化出来（`code-view.test.tsx` 实测过，一条断言 1 MB）。折成布尔，一行读完。
 */
const 在树上 = (元素: Element | null | undefined) => 元素 != null

/** 假编辑器：把收到的入参画出来——测试要断言的是「编辑器收到了什么」，不是它长什么样。 */
const 假编辑器: CodeEditorComponent = (props) => (
  <div data-slot="fake-editor" data-name={props.name}>
    {props.contents}
  </div>
)

const 文本内容 = (content: string): FileContent => ({ type: "text", content })

const 甲正文 = "<!doctype html><html><body><h1>甲卷</h1><p>资金流水 12 笔</p></body></html>"
const 乙正文 = "<!doctype html><html><body><h1>乙卷</h1><p>话单 30 条</p></body></html>"

function 试验台(初始: { path: string; load: (path: string) => Promise<FileContent | undefined> }) {
  const 计数 = { 取内容: [] as string[], 加载编辑器: 0 }
  const [path, setPath] = createSignal(初始.path)
  const load = async (要的: string) => {
    计数.取内容.push(要的)
    return 初始.load(要的)
  }
  const editor: CodeEditorLoader = async () => {
    计数.加载编辑器++
    return 假编辑器
  }
  const host = mount(() => <HtmlView path={path()} load={load} editor={editor} />)
  return { host, 计数, setPath }
}

const 预览框 = (host: HTMLElement) => host.querySelector<HTMLIFrameElement>("[data-slot='html-preview']")
const 源码钮 = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("[data-slot='html-tab-source']")
const 预览钮 = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("[data-slot='html-tab-preview']")
const 假编辑器节点 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-slot='fake-editor']")
const 降级 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-component='degraded-view']")
const 根 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-component='html-view']")

describe("HTML 预览：渲染成网页，另给源码切换", () => {
  test("预览：正文原样交给沙箱 iframe，sandbox 恰好是 allow-scripts", async () => {
    const { host } = 试验台({ path: "/案件/甲.html", load: async () => 文本内容(甲正文) })
    await 落定()

    const 框 = 预览框(host)
    expect(在树上(框)).toBe(true)
    // **逐字**比对：任何净化 / 转义 / 截断都会让页面变成另一个页面，而界面照样能看
    expect(框?.getAttribute("srcdoc")).toBe(甲正文)
    expect(框?.getAttribute("sandbox")).toBe("allow-scripts")
    expect(框?.getAttribute("title")).toBe("甲.html")
  })

  /**
   * **这是一条安全线，不是格式检查。**
   *
   * `allow-same-origin` 一旦加上，沙箱里的不可信页面就拿到了应用的**来源**：它能读本页的
   * cookie / localStorage，也能反过来碰宿主 DOM（配合 `allow-scripts`，等于沙箱不存在）。
   * 文件内容是不可信输入（卷宗可能来自别的单位、别的系统），故这条必须单独钉：
   * 断言的是「不含」，不是「等于某个更长或更短的字符串」。
   */
  test("安全线：iframe 的 sandbox 不含 allow-same-origin", async () => {
    const { host } = 试验台({ path: "/案件/甲.html", load: async () => 文本内容(甲正文) })
    await 落定()

    const 沙箱 = 预览框(host)?.getAttribute("sandbox")
    expect(沙箱?.includes("allow-same-origin")).toBe(false)
  })

  test("切到源码：编辑器挂出来、iframe 撤下；切回预览：iframe 回来", async () => {
    const { host, 计数 } = 试验台({ path: "/案件/甲.html", load: async () => 文本内容(甲正文) })
    await 落定()

    // 没点过源码之前不该去加载编辑器——真编辑器拖着 worker / 高亮器，没理由提前拉
    expect(计数.加载编辑器).toBe(0)

    源码钮(host)?.click()
    await 落定()

    expect(计数.加载编辑器).toBe(1)
    expect(在树上(预览框(host))).toBe(false)
    const 编辑器 = 假编辑器节点(host)
    expect(编辑器?.getAttribute("data-name")).toBe("甲.html")
    expect(编辑器?.textContent).toContain("资金流水 12 笔")
    expect(源码钮(host)?.getAttribute("aria-pressed")).toBe("true")
    expect(预览钮(host)?.getAttribute("aria-pressed")).toBe("false")

    预览钮(host)?.click()
    await 落定()

    expect(在树上(预览框(host))).toBe(true)
    expect(在树上(假编辑器节点(host))).toBe(false)
    expect(预览钮(host)?.getAttribute("aria-pressed")).toBe("true")
  })

  test("取不到内容 ⇒ empty 降级，不出 iframe", async () => {
    const { host } = 试验台({ path: "/案件/甲.html", load: async () => undefined })
    await 落定()

    expect(在树上(预览框(host))).toBe(false)
    expect(降级(host)?.getAttribute("data-reason")).toBe("empty")
  })

  test("读失败 ⇒ error 降级，不出 iframe", async () => {
    const { host } = 试验台({
      path: "/案件/甲.html",
      load: async () => {
        throw new Error("网络断了")
      },
    })
    await 落定()

    expect(在树上(预览框(host))).toBe(false)
    expect(降级(host)?.getAttribute("data-reason")).toBe("error")
  })

  test("换文件：重新取新路径、正文换成新的、模式回到预览", async () => {
    const { host, 计数, setPath } = 试验台({
      path: "/案件/甲.html",
      load: async (要的) => 文本内容(要的.endsWith("甲.html") ? 甲正文 : 乙正文),
    })
    await 落定()

    源码钮(host)?.click()
    await 落定()
    expect(在树上(假编辑器节点(host))).toBe(true)

    setPath("/案件/乙.html")
    await 落定()

    // 上一份文件停在源码模式，不该带到下一份上去
    expect(根(host)?.getAttribute("data-mode")).toBe("preview")
    expect(在树上(假编辑器节点(host))).toBe(false)
    expect(计数.取内容).toContain("/案件/乙.html")
    expect(预览框(host)?.getAttribute("srcdoc")).toBe(乙正文)
  })
})
