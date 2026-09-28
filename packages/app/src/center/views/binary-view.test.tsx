import { describe, expect, test, vi } from "bun:test"
import { createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import type { FileContent, LoadFileContent } from "@/center/file-content"
import { BinaryView, type BytesRenderer, 格式不支持 } from "./binary-view"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}

/** 让「load → decode → render」整条异步链跑完。 */
const 落定 = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 同 `mount`，另把 `dispose` 交出来——卸下视图才能验「卸载时归还资源」。 */
function mountDisposable(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(element, host)
  return { host, dispose }
}

const 内容 = (bytes: number[]): FileContent => ({
  type: "binary",
  content: btoa(String.fromCharCode(...bytes)),
  encoding: "base64",
})

const 视图 = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-component='probe']") ?? undefined

const 降级 = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-component='degraded-view']")

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
    expect(降级(host)).toBeNull() // 渲染出来了就没有「看不了」这回事
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

  test("读不到内容：不调渲染器，标记 empty 并给出降级提示（T015）", async () => {
    let 调了 = 0
    const host = mount(() => (
      <BinaryView name="probe" path="/p/无.docx" load={async () => undefined} render={async () => void 调了++} />
    ))

    await 落定()

    expect(调了).toBe(0)
    expect(视图(host)?.getAttribute("data-state")).toBe("empty")
    expect(降级(host)?.getAttribute("data-reason")).toBe("empty")
    expect(降级(host)?.textContent).toContain("/p/无.docx") // 说得出是哪个文件
  })

  test("渲染器失败：标记 error，不把异常抛给中栏（一个坏文件不该掀掉整个工作台）", async () => {
    const 警告 = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
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
      expect(降级(host)?.getAttribute("data-reason")).toBe("error")
    } finally {
      警告.mockRestore()
    }
  })

  /**
   * 「坏文件在界面上只变成一句降级提示」是**最难查**的那类故障：说得出话的是界面，查得着的只剩控制台。
   * 故渲染失败除了落 `error`，还要在控制台留一条，且带上是**哪个文件**——
   * 一份卷宗打不开时，民警截图给运维的信息里往往没有控制台，但开发/排障的那一头要有。
   */
  test("渲染失败：控制台留一条带文件名的记录（静默失败最难查）", async () => {
    const 警告 = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      mount(() => (
        <BinaryView
          name="probe"
          path="/p/坏卷宗.pdf"
          load={async () => 内容([0])}
          render={async () => {
            throw new Error("不是该格式的字节")
          }}
        />
      ))
      await 落定()

      expect(警告).toHaveBeenCalled()
      expect(警告.mock.calls.map((参数) => 参数.join(" ")).join("\n")).toContain("/p/坏卷宗.pdf")
    } finally {
      警告.mockRestore()
    }
  })

  /**
   * 渲染器**认得出**「这不是我能渲染的写法」时（如 docx-preview 拿到 OLE2 的老 `.doc`），
   * 要落 `unsupported` 而不是 `error`。两者对民警是两件事：前者「换工具打开」，后者「怀疑
   * 文件坏了」——把「我们没接这种格式」说成「你的卷宗坏了」，归因是反的。
   */
  test("渲染器说「这种格式我不认」：落 unsupported，不冤枉文件", async () => {
    // 已知边界不是故障：控制台**不该**为此喊一声（喊了就会把真故障淹掉）
    const 警告 = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const host = mount(() => (
        <BinaryView
          name="probe"
          path="/p/老卷宗.doc"
          load={async () => 内容([0])}
          render={async () => {
            throw 格式不支持("这是 OLE2 二进制格式")
          }}
        />
      ))

      await 落定()

      expect(视图(host)?.getAttribute("data-state")).toBe("unsupported")
      expect(降级(host)?.getAttribute("data-reason")).toBe("unsupported")
      expect(警告).not.toHaveBeenCalled()
    } finally {
      警告.mockRestore()
    }
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

/**
 * 「看不了」的两种状态（`empty` / `error`）都要**先把容器收干净**再画提示。
 * 渲染器是往容器里**就地**写 DOM 的，若转换状态时不清，屏幕上会留着**上一个文件**的内容——
 * 民警点开「无.docx」却看着上一份卷宗，是比白屏更糟的那种错。
 */
describe("转到看不了的状态：先收干净容器，再画降级提示", () => {
  test("换成读不到内容的文件：上一个文件的内容不能留在屏幕上", async () => {
    const [path, setPath] = createSignal("/p/a.docx")
    const host = mount(() => (
      <BinaryView
        name="probe"
        path={path()}
        load={async (p) => (p === "/p/a.docx" ? 内容([1]) : undefined)}
        render={async (_bytes, container) => void (container.textContent = "上一份的内容")}
      />
    ))
    await 落定()
    expect(视图(host)?.textContent).toBe("上一份的内容")

    setPath("/p/无.docx")
    await 落定()

    expect(视图(host)?.getAttribute("data-state")).toBe("empty")
    expect(视图(host)?.textContent).toBe("")
    expect(降级(host)).not.toBeNull()
  })

  test("渲染器抛错：它写了一半的残片也要清掉，不跟提示同屏", async () => {
    const 警告 = vi.spyOn(console, "warn").mockImplementation(() => {}) // 本条会走「真故障」那一支，控制台有话要说
    try {
      const host = mount(() => (
        <BinaryView
          name="probe"
          path="/p/坏.docx"
          load={async () => 内容([0])}
          render={async (_bytes, container) => {
            container.textContent = "写了一半"
            throw new Error("不是该格式的字节")
          }}
        />
      ))

      await 落定()

      expect(视图(host)?.getAttribute("data-state")).toBe("error")
      expect(视图(host)?.textContent).toBe("")
      expect(降级(host)).not.toBeNull()
    } finally {
      警告.mockRestore()
    }
  })
})

/**
 * 有些渲染器**持有需要归还的资源**——图片用 object URL（`URL.createObjectURL`）指向字节，
 * 不 `revokeObjectURL` 就整份占着内存直到页面关闭。民警一晚上翻几十张扫描件，这个漏是攒出来的。
 * 故渲染器可返回清理函数，由壳负责在**换内容前**与**卸载时**调用它。
 */
describe("渲染器持有资源时：壳负责归还", () => {
  test("换内容前先归还上一份的资源", async () => {
    const [path, setPath] = createSignal("/p/a.png")
    const 归还过的: number[] = []
    let 第几次 = 0
    const render: BytesRenderer = async () => {
      const 序号 = ++第几次
      return () => void 归还过的.push(序号)
    }
    mount(() => <BinaryView name="probe" path={path()} load={async () => 内容([1])} render={render} />)
    await 落定()

    setPath("/p/b.png")
    await 落定()

    expect(归还过的).toEqual([1]) // 第一份已还，第二份还拿着
  })

  test("换成读不到内容的文件也算「换内容」：上一份的资源照样还掉", async () => {
    const [path, setPath] = createSignal("/p/a.png")
    const 归还过的: number[] = []
    let 第几次 = 0
    mount(() => (
      <BinaryView
        name="probe"
        path={path()}
        load={async (p) => (p === "/p/a.png" ? 内容([1]) : undefined)}
        render={async () => {
          const 序号 = ++第几次
          return () => void 归还过的.push(序号)
        }}
      />
    ))
    await 落定()

    setPath("/p/无.png")
    await 落定()

    expect(归还过的).toEqual([1]) // 内容换成「看不了」，那份 object URL 没有理由继续拿着
  })

  test("视图卸下时归还当前那份（不能只靠「换下一份时顺手还」）", async () => {
    const 归还过的: number[] = []
    const { dispose } = mountDisposable(() => (
      <BinaryView
        name="probe"
        path="/p/a.png"
        load={async () => 内容([1])}
        render={async () => () => void 归还过的.push(1)}
      />
    ))
    await 落定()

    dispose()

    expect(归还过的).toEqual([1])
  })

  test("迟到的渲染：归还它自己的资源，但不夺走当前那份", async () => {
    const [path, setPath] = createSignal("/p/慢.png")
    let 放行慢的!: () => void
    const 慢的 = new Promise<void>((resolve) => (放行慢的 = resolve))
    const 归还过的: string[] = []
    const render: BytesRenderer = async (bytes) => {
      if (bytes[0] === 111) {
        await 慢的
        return () => void 归还过的.push("慢")
      }
      return () => void 归还过的.push("快")
    }
    const { dispose } = mountDisposable(() => (
      <BinaryView
        name="probe"
        path={path()}
        load={async (p) => 内容(p === "/p/慢.png" ? [111] : [222])}
        render={render}
      />
    ))
    await 落定()

    setPath("/p/快.png")
    await 落定()
    放行慢的()
    await 落定()

    expect(归还过的).toEqual(["慢"]) // 迟到者自己还掉，没有把「快」的那份挤掉
    dispose()
    expect(归还过的).toEqual(["慢", "快"]) // 卸载时还的是当前那份
  })

  /**
   * 清理函数是**渲染器给的三方代码**，它抛错不该把「换内容」这件事本身搞砸。
   * 当前实现里 `归还()` 一旦抛出，异常会穿到取数那条 async 链的 `.catch` 上——
   * 于是「换了一份文件」被记成「这份文件渲染失败」，视图落 error：
   * 归因反了不说，真正的故障（清理函数）还被顶替掉了。
   */
  test("清理函数抛错：不影响换内容本身（不许把它记成新文件渲染失败）", async () => {
    const 警告 = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const [path, setPath] = createSignal("/p/a.png")
      const host = mount(() => (
        <BinaryView
          name="probe"
          path={path()}
          load={async () => 内容([1])}
          render={async (bytes) => {
            if (bytes[0] === 1) {
              return () => {
                throw new Error("清理失败")
              }
            }
            return undefined
          }}
        />
      ))
      await 落定()

      setPath("/p/b.png")
      await 落定()

      expect(视图(host)?.getAttribute("data-state")).toBe("ready")
      expect(降级(host)).toBeNull()
    } finally {
      警告.mockRestore()
    }
  })

  test("卸载后才到点的渲染：自己还掉，别挂上一个再也没机会归还的资源", async () => {
    let 放行!: () => void
    const 卡住的 = new Promise<void>((resolve) => (放行 = resolve))
    const 归还过的: string[] = []
    const { dispose } = mountDisposable(() => (
      <BinaryView
        name="probe"
        path="/p/a.png"
        load={async () => 内容([1])}
        render={async () => {
          await 卡住的
          return () => void 归还过的.push("迟")
        }}
      />
    ))
    await 落定()

    dispose()
    放行()
    await 落定()

    expect(归还过的).toEqual(["迟"])
  })
})
