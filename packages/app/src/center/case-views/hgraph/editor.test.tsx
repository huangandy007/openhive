/**
 * T009b：`.hgraph` 编辑器（文档/版本/保存状态机）＋画布（指针/连线/选择/文字）。
 *
 * 组件测试没有 `@solidjs/testing-library`（本包未装），用 `solid-js/web` 的 `render` +
 * 自建容器（照 `center/views/hgraph-view.test.tsx`）。每条用例 `afterEach` 卸载并清
 * `document.body`（`#005-03`：mount 泄漏；同一条用例里连挂两次会共用 DOM 造出假绿）。
 *
 * ## 为什么坐标换算要注入
 *
 * happy-dom 没有真实布局：`getBoundingClientRect()` 恒 0（`#005-32` / `#006-30` /
 * `#006-06`）。画布的「屏幕坐标 → 画布坐标」做成可注入函数，用例注入恒等映射并通过
 * `PointerEvent` 的 `clientX/clientY` 直接给坐标；生产实现读 DOM（见 `canvas.tsx`）。
 *
 * ## 防抖是真的 500ms
 *
 * 不注入「防抖毫秒」：那是规格（T009「500ms 防抖」）。用例等 650ms 取实得；另有一条
 * 在 400ms 时断言**一次都没发**，证明写不是立即发生的。
 */
import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { HgraphApi, 写应答 } from "@/project/hgraph-api"
import type { 图文件, 节点, 文字 } from "./file"
import { 编辑器 } from "./editor"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const 等 = (毫秒: number) => new Promise<void>((resolve) => setTimeout(resolve, 毫秒))
/** 防抖 500ms 之后再多给一点：650ms 时那次写必已发出。 */
const 过防抖 = () => 等(650)

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function 造节点(id: string, x: number, y: number, 补丁: Partial<节点> = {}): 节点 {
  return { id, 名称: id, 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, x, y, ...补丁 }
}

function 造文字(id: string, 内容: string, x: number, y: number): 文字 {
  return { id, 内容, x, y, 字号: "中" }
}

/** 三颗节点：n1/n2 普通，n3 锁定；一条文字 t1。 */
function 一份图(): 图文件 {
  return {
    格式: 1,
    标题: "测试图",
    创建于: "2026-11-16T10:00:00+08:00",
    更新于: "2026-11-16T10:00:00+08:00",
    设置: {
      线宽度量: "按类型默认",
      次数阈值: [1, 2, 5, 10, 50],
      金额阈值: [10000, 50000, 200000, 1000000],
      外环阈值: [1, 2, 4, 8],
    },
    节点: [造节点("n1", 100, 100), 造节点("n2", 200, 100), 造节点("n3", 300, 100, { 锁定: true })],
    边: [],
    文字: [造文字("t1", "备注", 50, 50)],
  }
}

type 写入参 = Parameters<HgraphApi["写"]>[0]

function 成功(版本: string, 映射: Record<string, string> = {}): 写应答 {
  return {
    kind: "ok",
    value: {
      版本,
      结果: { 映射, 复用: [], 新增: { 节点: 0, 边: 0, 文字: 0 }, 更新: 1, 删除: { 节点: 0, 边: 0 } },
      重放: false,
    },
  }
}

/**
 * 只实现 `写`；`读` / `初始化` / `导出许可` 一被调用就抛——编辑器必须**不**自己载入
 * （载入归 T007 的打开通道），也不导出。`写` 默认真打一次就成功。
 */
function 假api(剧本: { 写?: (输入: 写入参) => 写应答 | Promise<写应答> } = {}) {
  const 写们: 写入参[] = []
  const api: HgraphApi = {
    读: async () => {
      throw new Error("编辑器不该自己读文件")
    },
    初始化: async () => {
      throw new Error("编辑器不该 init")
    },
    写: async (输入) => {
      写们.push(输入)
      return 剧本.写 === undefined ? 成功("v2") : await 剧本.写(输入)
    },
    导出许可: async () => {
      throw new Error("编辑器不该导出")
    },
  }
  return { api, 写们 }
}

function 挂上(api: HgraphApi, 初始文档: 图文件 = 一份图(), 初始版本 = "v1") {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(
    render(
      () => (
        <编辑器
          path="分析/测试图.hgraph"
          projectId="p 1"
          api={api}
          初始文档={初始文档}
          初始版本={初始版本}
          坐标换算={({ clientX, clientY }) => ({ x: clientX, y: clientY })}
        />
      ),
      host,
    ),
  )
}

// ---------------------------------------------------------------------------
// DOM 取值与指针
// ---------------------------------------------------------------------------

const 取 = (选择器: string) => document.body.querySelector(选择器)
const 画布 = () => 取("[data-slot='hgraph-canvas']") as HTMLElement | null
const 节点组 = (id: string) => 取(`[data-slot='hgraph-node'][data-node-id='${id}']`)
const 文字行 = (id: string) => 取(`[data-slot='hgraph-text'][data-text-id='${id}']`)
const 文案 = (slot: string) => 取(`[data-slot='${slot}']`)?.textContent?.trim()

function 按下(元素: Element, x: number, y: number, 修饰: PointerEventInit = {}) {
  元素.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      ...修饰,
    }),
  )
}

function 指针移动(x: number, y: number) {
  画布()!.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }),
  )
}

function 松开(x: number, y: number) {
  画布()!.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 }),
  )
}

/** 从屏幕点 (x0,y0) 分 `步数` 步拖到 (x1,y1)；`在` 是 pointerdown 的落点元素。 */
function 拖(在: Element, x0: number, y0: number, x1: number, y1: number, 修饰: PointerEventInit = {}, 步数 = 10) {
  按下(在, x0, y0, 修饰)
  for (let 序 = 1; 序 <= 步数; 序++) 指针移动(x0 + ((x1 - x0) * 序) / 步数, y0 + ((y1 - y0) * 序) / 步数)
  松开(x1, y1)
}

const 按键 = (目标: Element, 初始化: KeyboardEventInit) =>
  目标.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...初始化 }))

// ---------------------------------------------------------------------------
// 保存状态机（防抖 / 失败回滚 / 撤销步）
// ---------------------------------------------------------------------------

describe("编辑器 · 保存状态机", () => {
  test("拖一个节点：拖动中一次都不发，松手后 500ms 才发一次移动", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    按下(节点组("n1")!, 100, 100)
    for (let 序 = 1; 序 <= 10; 序++) 指针移动(100 + 序 * 5, 100 + 序 * 3)

    // 主判据一：拖动中 `ops` 调用数 0（不是「最后有调用」）。
    expect(写们.length).toBe(0)
    // 手按住超过一个防抖周期也**不许**发：拖动只在 dragend 进待发。
    await 过防抖()
    expect(写们.length).toBe(0)
    // 继续按着不动也不算「松手」：位置不变，只是把时间拖过防抖窗口。
    for (let 序 = 0; 序 < 5; 序++) 指针移动(150, 130)
    松开(150, 130)

    // 主判据二：松手后**不是立刻**发——防抖窗口内仍为 0。
    await 等(400)
    expect(写们.length).toBe(0)

    await 等(300)
    expect(写们.length).toBe(1)
    expect(写们[0]!.projectId).toBe("p 1")
    expect(写们[0]!.path).toBe("分析/测试图.hgraph")
    expect(写们[0]!.版本).toBe("v1")
    // 一批 = 一步：非空批次号（撤销栈按它算一步）。
    expect(typeof 写们[0]!.批次).toBe("string")
    expect(写们[0]!.批次).not.toBe("")
    expect(写们[0]!.操作).toEqual([
      { 操作: "移动", 目标: [{ 类别: "节点", id: "n1", x: 150, y: 130 }] },
    ])
    expect(文案("hgraph-save-status")).toBe("已保存")
  })

  test("保存失败（网络）⇒ 节点回改前位置 + 「没存上」+ 不自动重试", async () => {
    let 解!: (回: 写应答) => void
    const 闸 = new Promise<写应答>((收) => (解 = 收))
    const { api, 写们 } = 假api({ 写: () => 闸 })
    挂上(api)
    await flush()

    拖(节点组("n1")!, 100, 100, 180, 100)
    await flush()
    // 先证明「字段真的变过」——否则「回改前值」可能只是从来没改（假绿）。
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(180 100)")

    await 过防抖()
    expect(写们.length).toBe(1)
    解({ kind: "error", message: "网络断了", code: "network" })
    await flush()
    await flush()

    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(100 100)")
    expect(文案("hgraph-save-status")).toContain("没存上")
    expect(文案("hgraph-save-status")).not.toContain("已保存")
    expect(取("[data-slot='hgraph-save-status']")!.getAttribute("data-state")).toBe("待发")

    // 不自动重试：再等一个防抖周期，仍然只有那一次。
    await 过防抖()
    expect(写们.length).toBe(1)
  })

  test("409 版本冲突 ⇒ 回改前值 + 「没存上」+ 保留服务端的最新版本、不重试", async () => {
    let 解!: (回: 写应答) => void
    const 闸 = new Promise<写应答>((收) => (解 = 收))
    const { api, 写们 } = 假api({ 写: () => 闸 })
    挂上(api)
    await flush()

    拖(节点组("n1")!, 100, 100, 180, 100)
    await 过防抖()
    expect(写们.length).toBe(1)
    解({ kind: "error", message: "文件已被改过", code: "VERSION_CONFLICT", 最新版本: "v9" })
    await flush()
    await flush()

    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(100 100)")
    expect(文案("hgraph-save-status")).toContain("没存上")
    expect(取("[data-slot='hgraph-save-status']")!.getAttribute("data-state")).toBe("待发")
    // T013 要拿它问「重新载入？」——本轮不实现界面，只保证信息不丢。
    expect(取("[data-slot='hgraph-save-status']")!.getAttribute("data-latest-version")).toBe("v9")
    await 过防抖()
    expect(写们.length).toBe(1)
  })

  test("保存成功 ⇒ 压一步撤销；Ctrl+Z 弹一步（只在画布容器上生效）", async () => {
    const { api } = 假api()
    挂上(api)
    await flush()

    const 撤销键 = 取("[data-slot='hgraph-undo']") as HTMLButtonElement
    const 重做键 = 取("[data-slot='hgraph-redo']") as HTMLButtonElement
    expect(撤销键.disabled).toBe(true)

    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()
    expect(撤销键.disabled).toBe(false)

    // window 上没有监听：全局 Ctrl+Z 不动这张图的栈。
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))
    await flush()
    expect(撤销键.disabled).toBe(false)

    按键(画布()!, { key: "z", ctrlKey: true })
    await flush()
    expect(撤销键.disabled).toBe(true)
    expect(重做键.disabled).toBe(false)

    按键(画布()!, { key: "z", ctrlKey: true, shiftKey: true })
    await flush()
    expect(撤销键.disabled).toBe(false)
    expect(重做键.disabled).toBe(true)
  })

  test("保存失败 ⇒ **不**压撤销步（失败的批次不能假装可撤）", async () => {
    const { api } = 假api({ 写: () => ({ kind: "error", message: "写不进去", code: "INTERNAL" }) })
    挂上(api)
    await flush()

    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()
    await flush()

    expect((取("[data-slot='hgraph-undo']") as HTMLButtonElement).disabled).toBe(true)
    expect(文案("hgraph-save-status")).toContain("没存上")
  })
})

// ---------------------------------------------------------------------------
// 模式、选择、锁定
// ---------------------------------------------------------------------------

describe("画布 · 模式与选择", () => {
  test("指针模式拖到另一颗节点上：只发移动，永不建边", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    // 从 n1 精确拖到 n2 圆心（200,100）：若模式判错就会变成加边。
    拖(节点组("n1")!, 100, 100, 200, 100)
    await 过防抖()

    expect(写们.length).toBe(1)
    expect(写们[0]!.操作.map((操作) => 操作.操作)).toEqual(["移动"])
    expect(写们[0]!.操作).toEqual([
      { 操作: "移动", 目标: [{ 类别: "节点", id: "n1", x: 200, y: 100 }] },
    ])
  })

  test("连线模式从节点拖到另一节点 ⇒ 一条加边（从/到）", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    ;(取("[data-slot='hgraph-mode-connect']") as HTMLButtonElement).click()
    await flush()
    expect(画布()!.getAttribute("data-mode")).toBe("连线")

    拖(节点组("n1")!, 100, 100, 200, 100)
    await 过防抖()

    expect(写们.length).toBe(1)
    expect(写们[0]!.操作.length).toBe(1)
    const 操作 = 写们[0]!.操作[0]!
    expect(操作.操作).toBe("加边")
    if (操作.操作 !== "加边") throw new Error("不是加边")
    expect(操作.边.length).toBe(1)
    expect(操作.边[0]!.从).toBe("n1")
    expect(操作.边[0]!.到).toBe("n2")
  })

  test("连线模式拖到空白 ⇒ 不成边（一次写都没有）", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    ;(取("[data-slot='hgraph-mode-connect']") as HTMLButtonElement).click()
    await flush()

    拖(节点组("n1")!, 100, 100, 600, 500)
    await 过防抖()

    expect(写们.length).toBe(0)
  })

  test("Shift 拖空白框选：命中圆圈内的普通节点，锁定节点不被命中", async () => {
    const { api } = 假api()
    挂上(api)
    await flush()

    拖(画布()!, 50, 50, 350, 150, { shiftKey: true })

    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")
    expect(节点组("n2")!.getAttribute("data-selected")).toBe("true")
    // n3 的圆心 (300,100) 在框内，但 `锁定` ⇒ 框选不命中。
    expect(节点组("n3")!.getAttribute("data-selected")).toBeNull()
  })

  test("Shift 点击是加减选；普通点击换成只选它", async () => {
    const { api } = 假api()
    挂上(api)
    await flush()

    // 点 n1（无位移）
    按下(节点组("n1")!, 100, 100)
    松开(100, 100)
    await flush()
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")

    // Shift 点 n2 ⇒ 追加
    按下(节点组("n2")!, 200, 100, { shiftKey: true })
    松开(200, 100)
    await flush()
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")
    expect(节点组("n2")!.getAttribute("data-selected")).toBe("true")

    // Shift 再点 n1 ⇒ 移出
    按下(节点组("n1")!, 100, 100, { shiftKey: true })
    松开(100, 100)
    await flush()
    expect(节点组("n1")!.getAttribute("data-selected")).toBeNull()
    expect(节点组("n2")!.getAttribute("data-selected")).toBe("true")

    // 普通点 n1 ⇒ 换成只选它
    按下(节点组("n1")!, 100, 100)
    松开(100, 100)
    await flush()
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")
    expect(节点组("n2")!.getAttribute("data-selected")).toBeNull()
  })

  test("锁定节点拖不动：没有写、位置不变", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    拖(节点组("n3")!, 300, 100, 400, 200)
    await 过防抖()

    expect(写们.length).toBe(0)
    expect(节点组("n3")!.getAttribute("transform")).toBe("translate(300 100)")
  })
})

// ---------------------------------------------------------------------------
// 文字块
// ---------------------------------------------------------------------------

describe("画布 · 文字块", () => {
  test("双击文字改内容并回车 ⇒ 一个「改字段·文字」操作", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    文字行("t1")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 50, clientY: 50 }))
    await flush()

    const 输入 = 取("[data-slot='hgraph-text-editor']") as HTMLInputElement | null
    expect(输入).not.toBeNull()
    expect(输入!.value).toBe("备注")

    输入!.value = "新备注"
    输入!.dispatchEvent(new Event("input", { bubbles: true }))
    按键(输入!, { key: "Enter" })
    await flush()

    // 乐观显示：DOM 里已经是新内容。
    expect(文字行("t1")!.textContent).toBe("新备注")

    await 过防抖()
    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([
      { 操作: "改字段", 目标: [{ 类别: "文字", id: "t1", 补丁: { 内容: "新备注" } }] },
    ])
  })

  test("拖文字块 ⇒ 一个「移动·文字」操作（拖动中不发）", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    按下(文字行("t1")!, 50, 50)
    for (let 序 = 1; 序 <= 10; 序++) 指针移动(50 + 序 * 3, 50 + 序 * 4)
    expect(写们.length).toBe(0)
    松开(80, 90)

    await 过防抖()
    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([
      { 操作: "移动", 目标: [{ 类别: "文字", id: "t1", x: 80, y: 90 }] },
    ])
  })

  test("文字改字段保存失败 ⇒ 内容回改前值 + 「没存上」", async () => {
    let 解!: (回: 写应答) => void
    const 闸 = new Promise<写应答>((收) => (解 = 收))
    const { api } = 假api({ 写: () => 闸 })
    挂上(api)
    await flush()

    文字行("t1")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 50, clientY: 50 }))
    await flush()
    const 输入 = 取("[data-slot='hgraph-text-editor']") as HTMLInputElement
    输入.value = "新备注"
    输入.dispatchEvent(new Event("input", { bubbles: true }))
    按键(输入, { key: "Enter" })
    await flush()
    expect(文字行("t1")!.textContent).toBe("新备注")

    await 过防抖()
    解({ kind: "error", message: "写不进去", code: "INTERNAL" })
    await flush()
    await flush()

    expect(文字行("t1")!.textContent).toBe("备注")
    expect(文案("hgraph-save-status")).toContain("没存上")
  })

  test("加文字按钮 ⇒ 一个「加文字」操作；选中文字按 Delete ⇒ 一个「删对象」操作", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    ;(取("[data-slot='hgraph-add-text']") as HTMLButtonElement).click()
    await flush()
    await 过防抖()

    expect(写们.length).toBe(1)
    const 加 = 写们[0]!.操作[0]!
    expect(加.操作).toBe("加文字")
    if (加.操作 !== "加文字") throw new Error("不是加文字")
    expect(加.文字.length).toBe(1)
    expect(加.文字[0]!.内容).toBe("文字")
    expect(typeof 加.文字[0]!.x).toBe("number")
    expect(typeof 加.文字[0]!.y).toBe("number")

    // 选中已有文字 t1（点一下，无位移），Delete 删它。
    按下(文字行("t1")!, 50, 50)
    松开(50, 50)
    await flush()
    按键(画布()!, { key: "Delete" })
    await flush()
    await 过防抖()

    expect(写们.length).toBe(2)
    expect(写们[1]!.操作).toEqual([{ 操作: "删对象", 目标: [{ 类别: "文字", id: "t1" }] }])
    expect(文字行("t1")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 键盘作用域
// ---------------------------------------------------------------------------

describe("画布 · 键盘作用域", () => {
  test("焦点在输入框里按 Delete 不删文字", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    文字行("t1")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 50, clientY: 50 }))
    await flush()
    const 输入 = 取("[data-slot='hgraph-text-editor']") as HTMLInputElement

    按键(输入, { key: "Delete" })
    await flush()
    await 过防抖()

    expect(写们.length).toBe(0)
    expect(文字行("t1")).not.toBeNull()
  })
})
