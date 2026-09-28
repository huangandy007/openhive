import { describe, expect, test } from "bun:test"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { FileContent } from "@/center/file-content"
import { CodeView, type CodeEditorComponent, type CodeEditorLoader } from "./code-view"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

/** 让「点开 → 取内容 → 加载编辑器」整条异步链跑完。 */
const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * 问「这东西在不在」时**不要把 DOM 节点交给 `expect`**。
 *
 * 实测（2026-09-28）：`expect(元素).toBeNull()` 一旦失败，bun 会把整个 happy-dom 元素图序列化进
 * 失败信息——`Symbol(...)` 内部字段、`ownerDocument`、循环引用，一条断言就吐出 1 MB，跑一次像是卡死。
 * 故一律先折成布尔再断言：失败信息是 `Received: true`，一行读完。
 */
const 在树上 = (元素: Element | null | undefined) => 元素 != null

/** 假编辑器：把收到的入参画出来——测试要断言的是「编辑器收到了什么」，不是它长什么样。 */
const 假编辑器: CodeEditorComponent = (props) => (
  <div data-component="probe-editor" data-name={props.name}>
    {props.contents}
  </div>
)

/** 在假编辑器之外另计一次数：`CodeEditorLoader` 是 async，只有计数才知道它有没有被调用过。 */
function 试验台(初始: { path: string; content?: FileContent }) {
  const 计数 = { 加载编辑器: 0 }
  const [path, setPath] = createSignal(初始.path)
  const editor: CodeEditorLoader = async () => {
    计数.加载编辑器++
    return 假编辑器
  }
  const host = mount(() => <CodeView path={path()} load={async () => 初始.content} editor={editor} />)
  return { host, 计数, setPath }
}

const 文本内容: FileContent = { type: "text", content: "const 已撑 = 1\n" }

const 面板 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-component='code-view']")
const 编辑器 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-component='probe-editor']")
const 降级 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-component='degraded-view']")
const 开启按钮 = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("[data-slot='code-open']")

describe("代码文件：默认不进入代码编辑器，要看时才打开（FR-009）", () => {
  test("默认不打开编辑器，也不去加载它", () => {
    const { host, 计数 } = 试验台({ path: "/案件/台账.ts", content: 文本内容 })

    expect(面板(host)?.getAttribute("data-state")).toBe("closed")
    expect(在树上(编辑器(host))).toBe(false)
    // 关键的一半：不是「装着看不见」，而是**根本没去取编辑器**
    expect(计数.加载编辑器).toBe(0)
  })

  test("说得出是哪个文件，并摆出开启入口", () => {
    const { host } = 试验台({ path: "/案件/台账.ts", content: 文本内容 })

    expect(面板(host)?.textContent ?? "").toContain("台账.ts")
    expect(开启按钮(host)?.textContent ?? "").toContain("代码编辑器")
  })

  test("点了才真的挂出编辑器，且把这份文件的内容交给它", async () => {
    const { host, 计数 } = 试验台({ path: "/案件/台账.ts", content: 文本内容 })

    开启按钮(host)?.click()
    await 落定()

    expect(计数.加载编辑器).toBe(1)
    expect(编辑器(host)?.getAttribute("data-name")).toBe("台账.ts")
    expect(编辑器(host)?.textContent).toContain("const 已撑 = 1")
  })

  test("编辑器没加载出来时给降级提示，不是白屏", async () => {
    const [path] = createSignal("/案件/台账.ts")
    const host = mount(() => (
      <CodeView
        path={path()}
        load={async () => 文本内容}
        editor={async () => {
          throw new Error("chunk 拉不下来")
        }}
      />
    ))

    开启按钮(host)?.click()
    await 落定()

    expect(降级(host)?.getAttribute("data-reason")).toBe("load-failed")
  })

  test("取不到内容就不打开编辑器（别让人对着一个空编辑器）", async () => {
    const { host, 计数 } = 试验台({ path: "/案件/台账.ts" })

    开启按钮(host)?.click()
    await 落定()

    expect(计数.加载编辑器).toBe(0)
    expect(降级(host)?.getAttribute("data-reason")).toBe("empty")
  })

  test("换一个文件后回到「未开启」——「默认」是每打开一份文件都成立，不是一次性开关", async () => {
    const { host, setPath } = 试验台({ path: "/案件/台账.ts", content: 文本内容 })

    开启按钮(host)?.click()
    await 落定()
    expect(在树上(编辑器(host))).toBe(true)

    setPath("/案件/流水.json")
    await 落定()

    expect(在树上(编辑器(host))).toBe(false)
    expect(面板(host)?.getAttribute("data-state")).toBe("closed")
  })

  test("点开后又换了文件：迟到的那一次不把内容盖到新文件上", async () => {
    let 放行!: () => void
    const 卡住 = new Promise<void>((resolve) => (放行 = resolve))
    const [path, setPath] = createSignal("/案件/台账.ts")
    const host = mount(() => (
      <CodeView
        path={path()}
        load={async (要的) => {
          // 只让**先点开的那一份**卡住——它就是要迟到的那一次
          if (要的.endsWith("台账.ts")) await 卡住
          return { type: "text", content: `// ${要的}` }
        }}
        editor={async () => 假编辑器}
      />
    ))

    开启按钮(host)?.click()
    await 落定()
    setPath("/案件/流水.json")
    await 落定()
    放行()
    await 落定()

    // 屏幕上必须仍是新文件的「未开启」，而不是旧文件的内容
    expect(在树上(编辑器(host))).toBe(false)
    expect(面板(host)?.getAttribute("data-state")).toBe("closed")
  })

  test("文件名是不可信输入：原样当文字，不当 HTML", () => {
    // 文件名里不可能有 `/`（`文件名()` 取的是最后一段），故这里挑一个不需要斜杠就成立的危险串
    const { host } = 试验台({ path: "/案件/<img src=x onerror=alert(1)>.ts", content: 文本内容 })

    expect(在树上(面板(host)?.querySelector("img"))).toBe(false)
    expect(面板(host)?.textContent).toContain("<img")
  })
})
