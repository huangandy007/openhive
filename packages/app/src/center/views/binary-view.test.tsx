import { describe, expect, test } from "bun:test"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { FileContent, LoadFileContent } from "@/center/file-content"
import { BinaryView, type BytesRenderer } from "./binary-view"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

/** 让「load → decode → render」整条异步链跑完。 */
const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))

const 内容 = (bytes: number[]): FileContent => ({
  type: "binary",
  content: btoa(String.fromCharCode(...bytes)),
  encoding: "base64",
})

const 视图 = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-component='probe']") ?? undefined

describe("字节型视图的公共壳：取字节 → 交渲染器", () => {
  test("拿到字节就交给渲染器，渲染完标记 ready", async () => {
    const 收到: number[][] = []
    const render: BytesRenderer = async (bytes) => void 收到.push([...bytes])
    const host = mount(() => (
      <BinaryView name="probe" path="/p/a.docx" load={async () => 内容([1, 2, 3])} render={render} />
    ))

    await 落定()

    expect(收到).toEqual([[1, 2, 3]])
    expect(视图(host)?.getAttribute("data-state")).toBe("ready")
  })

  test("渲染器拿到的容器就是这个视图的元素（不是别处挂的一个游离节点）", async () => {
    let 收到容器: HTMLElement | undefined
    const host = mount(() => (
      <BinaryView
        name="probe"
        path="/p/a.docx"
        load={async () => 内容([1])}
        render={async (_bytes, container) => void (收到容器 = container)}
      />
    ))

    await 落定()

    expect(收到容器).toBe(视图(host))
  })

  test("读不到内容：不调渲染器，标记 empty（降级呈现由 T015 负责）", async () => {
    let 调了 = 0
    const host = mount(() => (
      <BinaryView name="probe" path="/p/无.docx" load={async () => undefined} render={async () => void 调了++} />
    ))

    await 落定()

    expect(调了).toBe(0)
    expect(视图(host)?.getAttribute("data-state")).toBe("empty")
  })

  test("渲染器失败：标记 error，不把异常抛给中栏（一个坏文件不该掀掉整个工作台）", async () => {
    const host = mount(() => (
      <BinaryView
        name="probe"
        path="/p/坏.docx"
        load={async () => 内容([0])}
        render={async () => {
          throw new Error("不是该格式的字节")
        }}
      />
    ))

    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("error")
  })

  test("path 变了：按新 path 重取重渲（否则两张 document tab 会显示同一份文件）", async () => {
    const [path, setPath] = createSignal("/p/a.docx")
    const 取过的: string[] = []
    const 渲过的: number[][] = []
    const load: LoadFileContent = async (p) => {
      取过的.push(p)
      return 内容(p === "/p/a.docx" ? [1] : [2])
    }
    mount(() => (
      <BinaryView
        name="probe"
        path={path()}
        load={load}
        render={async (bytes) => void 渲过的.push([...bytes])}
      />
    ))
    await 落定()

    setPath("/p/b.docx")
    await 落定()

    expect(取过的).toEqual(["/p/a.docx", "/p/b.docx"])
    expect(渲过的).toEqual([[1], [2]])
  })

  test("慢的旧请求晚回来也盖不掉新文件：连点两张 tab 不会张冠李戴", async () => {
    const [path, setPath] = createSignal("/p/慢.docx")
    let 放行慢的!: () => void
    const 慢的 = new Promise<void>((resolve) => (放行慢的 = resolve))
    const render: BytesRenderer = async (bytes) => void 渲过的.push([...bytes])
    const 渲过的: number[][] = []
    const load: LoadFileContent = async (p) => {
      if (p === "/p/慢.docx") await 慢的
      return 内容(p === "/p/慢.docx" ? [111] : [222])
    }
    mount(() => <BinaryView name="probe" path={path()} load={load} render={render} />)
    await 落定()

    setPath("/p/快.docx")
    await 落定()
    放行慢的()
    await 落定()

    expect(渲过的).toEqual([[222]])
  })
})
