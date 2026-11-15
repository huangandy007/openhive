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
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { HgraphApi, 写应答 } from "@/project/hgraph-api"
import type { 图文件, 节点, 文字 } from "./file"
import { 画布 as 画布组件, type 画布动作, type 坐标换算 } from "./canvas"
import { 检查器 } from "./inspector"
import { 工具栏 } from "./toolbar"
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

/** 每次 `写` 都挂起，由用例逐次 `解(序, 应答)`——覆盖「请求飞行中再操作」。 */
function 闸门api() {
  const 写们: 写入参[] = []
  const 闸们: Array<{ 解: (回: 写应答) => void }> = []
  const api: HgraphApi = {
    读: async () => {
      throw new Error("编辑器不该自己读文件")
    },
    初始化: async () => {
      throw new Error("编辑器不该 init")
    },
    写: async (输入) => {
      写们.push(输入)
      return await new Promise<写应答>((解) => 闸们.push({ 解 }))
    },
    导出许可: async () => {
      throw new Error("编辑器不该导出")
    },
  }
  const 解 = (序: number, 回: 写应答) => 闸们[序]!.解(回)
  return { api, 写们, 解 }
}

function 挂上(
  api: HgraphApi,
  初始文档: 图文件 = 一份图(),
  初始版本 = "v1",
  换算: 坐标换算 = ({ clientX, clientY }) => ({ x: clientX, y: clientY }),
) {
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
          坐标换算={换算}
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
      buttons: 1,
      pointerId: 1,
      ...修饰,
    }),
  )
}

function 指针移动(x: number, y: number) {
  画布()!.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      buttons: 1,
      pointerId: 1,
    }),
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

  // ```text
  // 方向 A：飞行中再拖一次，第一批**失败** ⇒ 失败的批丢弃，但飞行中那次从未发出，
  // 必须折回可见文档并继续发；不能出现「第二批成功、界面却停在回改值」。
  // ```
  test("飞行中再拖：第一批失败 ⇒ 只丢失败的批，飞行中的待发重折后继续发", async () => {
    const { api, 写们, 解 } = 闸门api()
    挂上(api)
    await flush()

    拖(节点组("n1")!, 100, 100, 180, 100)
    await 过防抖()
    expect(写们.length).toBe(1)

    // 请求还在飞行中，画布已是乐观值 180；从这里再拖到 260。
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(180 100)")
    拖(节点组("n1")!, 180, 100, 260, 100)
    await flush()

    解(0, { kind: "error", message: "网络断了", code: "network" })
    await flush()
    await flush()

    // 失败的批（→180）丢弃；飞行中那一批（→260）从未发出，重折后仍可见。
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(260 100)")
    expect(文案("hgraph-save-status")).toContain("没存上")
    expect(取("[data-slot='hgraph-save-status']")!.getAttribute("data-state")).toBe("待发")
    expect(写们.length).toBe(1)

    // 第二批只含飞行中那条，不是重试失败批。
    await 过防抖()
    expect(写们.length).toBe(2)
    expect(写们[1]!.操作).toEqual([
      { 操作: "移动", 目标: [{ 类别: "节点", id: "n1", x: 260, y: 100 }] },
    ])
    解(1, 成功("v2"))
    await flush()
    await flush()
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(260 100)")
    expect(文案("hgraph-save-status")).toBe("已保存")
  })

  // ```text
  // 方向 B：飞行中拖 n2，第一批**成功** ⇒ 新基线只能含已发批（n2 还在 200）；
  // 若拿当前乐观文档当基线，n2 的 300 会被误当成「服务端已接受」。
  // ```
  test("飞行中拖 n2：第一批成功 ⇒ 基线不含未发操作；第二批失败回改到已接受值", async () => {
    const { api, 写们, 解 } = 闸门api()
    挂上(api)
    await flush()

    拖(节点组("n1")!, 100, 100, 180, 100)
    await 过防抖()
    expect(写们.length).toBe(1)

    拖(节点组("n2")!, 200, 100, 300, 100)
    await flush()
    expect(节点组("n2")!.getAttribute("transform")).toBe("translate(300 100)")

    解(0, 成功("v2"))
    await flush()
    await flush()

    // 第一批只含 n1；n2 的 300 仍在待发 ⇒ 可见 300，但状态必须是「待发」。
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(180 100)")
    expect(节点组("n2")!.getAttribute("transform")).toBe("translate(300 100)")
    expect(取("[data-slot='hgraph-save-status']")!.getAttribute("data-state")).toBe("待发")

    await 过防抖()
    expect(写们.length).toBe(2)
    expect(写们[1]!.操作).toEqual([
      { 操作: "移动", 目标: [{ 类别: "节点", id: "n2", x: 300, y: 100 }] },
    ])
    解(1, { kind: "error", message: "写不进去", code: "INTERNAL" })
    await flush()
    await flush()

    // n2 回到服务端真正接受过的 200；n1 停在已接受的 180。
    expect(节点组("n2")!.getAttribute("transform")).toBe("translate(200 100)")
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(180 100)")
    expect(文案("hgraph-save-status")).toContain("没存上")

    // 失败批不自动重试。
    await 过防抖()
    expect(写们.length).toBe(2)
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
    // 服务端必填（V-04：事实边要有出处/证据；手画边标推断 + 来源「手写」才过闸）。
    expect(操作.边[0]!.标签).toBe("")
    expect(操作.边[0]!.性质).toBe("推断")
    expect(操作.边[0]!.来源).toEqual({ kind: "手写" })
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

  test("整组拖动：缺坐标的节点按 0 起算（不发 NaN / null）", async () => {
    const { api, 写们 } = 假api()
    const 图 = 一份图()
    // 解析图是读放宽的：缺 x/y 也能打开。这里模拟那种行（类型要求 x/y，故断言成节点）。
    图.节点.push({ id: "n4", 名称: "n4", 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" } } as unknown as 节点)
    挂上(api, 图)
    await flush()

    expect(节点组("n4")!.getAttribute("transform")).toBe("translate(0 0)")
    // 选中 n4，再 Shift 选中 n1；从 n1 按下即整组拖动。
    按下(节点组("n4")!, 0, 0)
    松开(0, 0)
    await flush()
    按下(节点组("n1")!, 100, 100, { shiftKey: true })
    松开(100, 100)
    await flush()
    expect(节点组("n4")!.getAttribute("data-selected")).toBe("true")
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")

    拖(节点组("n1")!, 100, 100, 120, 130)
    await flush()
    expect(节点组("n4")!.getAttribute("transform")).toBe("translate(20 30)")

    await 过防抖()
    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([
      {
        操作: "移动",
        目标: [
          { 类别: "节点", id: "n1", x: 120, y: 130 },
          { 类别: "节点", id: "n4", x: 20, y: 30 },
        ],
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// 视口与指针捕获
// ---------------------------------------------------------------------------

describe("画布 · 视口与指针捕获", () => {
  test("拖空白 = 平移画布；按下捕获指针、松手释放", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    按下(画布()!, 10, 10)
    expect(画布()!.hasPointerCapture(1)).toBe(true)
    for (let 序 = 1; 序 <= 10; 序++) 指针移动(10 + 序 * 2, 10 + 序 * 3)
    松开(30, 40)
    await flush()

    expect(取("[data-slot='hgraph-viewport']")!.getAttribute("transform")).toBe("translate(20 30) scale(1)")
    expect(画布()!.hasPointerCapture(1)).toBe(false)
    // 平移是视口操作，不写文件。
    await 过防抖()
    expect(写们.length).toBe(0)
  })

  test("滚轮缩放 ×1.15 / ÷1.15，夹在 0.5..3；不写文件", async () => {
    const { api, 写们 } = 假api()
    // 锚点固定为内容原点：happy-dom 的 WheelEvent.clientX 不可靠，本用例只钉公式与夹取。
    挂上(api, 一份图(), "v1", () => ({ x: 0, y: 0 }))
    await flush()

    const 滚 = (deltaY: number) =>
      画布()!.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY }))
    const 变换 = () => 取("[data-slot='hgraph-viewport']")!.getAttribute("transform")

    滚(-100)
    await flush()
    expect(变换()).toBe("translate(0 0) scale(1.15)")

    for (let 次 = 0; 次 < 20; 次++) 滚(-100)
    await flush()
    expect(变换()).toBe("translate(0 0) scale(3)")

    for (let 次 = 0; 次 < 40; 次++) 滚(100)
    await flush()
    expect(变换()).toBe("translate(0 0) scale(0.5)")

    await 过防抖()
    expect(写们.length).toBe(0)
  })

  test("pointerup 丢失（move 的 buttons=0）⇒ 按松手收尾，不丢这次移动", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    按下(节点组("n1")!, 100, 100)
    指针移动(150, 130)
    // 浏览器在容器外松手：后续 move 的 buttons === 0。
    画布()!.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: 150,
        clientY: 130,
        buttons: 0,
        pointerId: 1,
      }),
    )
    await flush()
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(150 130)")

    await 过防抖()
    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([
      { 操作: "移动", 目标: [{ 类别: "节点", id: "n1", x: 150, y: 130 }] },
    ])
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
    expect(加.文字[0]!.字号).toBe("中")
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

// ---------------------------------------------------------------------------
// T010 · 动作单一出口（工具栏 / 快捷键 / 右键 / 检查器）
// ---------------------------------------------------------------------------

function 幽灵动作表() {
  const 计数: Record<string, number> = {}
  const 参数: Record<string, unknown[][]> = {}
  const 记 = (名: string, 参: unknown[]) => {
    计数[名] = (计数[名] ?? 0) + 1
    ;(参数[名] ??= []).push(参)
  }
  const 动作: 画布动作 = {
    选择: (ids, 追加) => 记("选择", [ids, 追加]),
    移动: (目标) => 记("移动", [目标]),
    加边: (从, 到) => 记("加边", [从, 到]),
    加文字: (x, y) => 记("加文字", [x, y]),
    改字段: (类别, id, 补丁) => 记("改字段", [类别, id, 补丁]),
    删对象: (目标) => 记("删对象", [目标]),
    撤销: () => 记("撤销", []),
    重做: () => 记("重做", []),
    切换模式: (模式) => 记("切换模式", [模式]),
    加节点: (位置) => 记("加节点", [位置]),
    删除所选: () => 记("删除所选", []),
    重命名: (id) => 记("重命名", [id]),
    锁定切换: (ids) => 记("锁定切换", [ids]),
    对齐: (边, ids) => 记("对齐", [边, ids]),
    等距: (轴, ids) => 记("等距", [轴, ids]),
    自动布局: (模式) => 记("自动布局", [模式]),
  }
  const 总 = () => Object.values(计数).reduce((甲, 乙) => 甲 + 乙, 0)
  return { 动作, 计数, 参数, 总 }
}

/**
 * 把工具栏 / 画布 / 检查器拼在一个宿主里，共用**同一张幽灵动作表**。
 * 这是「同一出口」的判据载体：点按钮与按快捷键必须落到同一个 spy 条目。
 */
function 挂拼装(选项: { 选中?: readonly string[]; 文档?: 图文件 } = {}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const 幽 = 幽灵动作表()
  const [选中, set选中] = createSignal<readonly string[]>(选项.选中 ?? [])
  const [重命名id, set重命名id] = createSignal<string | undefined>()
  const 动作: 画布动作 = {
    ...幽.动作,
    选择: (ids, 追加) => {
      幽.动作.选择(ids, 追加)
      set选中(追加 ? [...new Set([...选中(), ...ids])] : ids)
    },
    重命名: (id) => {
      幽.动作.重命名(id)
      set重命名id(id)
    },
  }
  const 文档 = 选项.文档 ?? 一份图()
  挂过的.push(
    render(
      () => (
        <div>
          <工具栏 选中={选中()} 文档={文档} 动作表={动作} />
          <画布组件
            文档={文档}
            选中={选中()}
            模式="指针"
            坐标换算={({ clientX, clientY }) => ({ x: clientX, y: clientY })}
            动作={动作}
            重命名id={重命名id()}
          />
          <检查器 选中={选中()} 文档={文档} 动作表={动作} />
        </div>
      ),
      host,
    ),
  )
  return { 幽, 选中, set选中, 文档 }
}

function 点选(id: string, x = 100, y = 100, 修饰: PointerEventInit = {}) {
  按下(节点组(id)!, x, y, 修饰)
  松开(x, y)
}

describe("T010 · 单一出口", () => {
  test("删除：工具栏按钮与画布 Delete 打到同一个动作条目；各 1 个批次", async () => {
    // 幽灵侧：两个入口必须落到同一个 `删除所选` spy，且都不自己拼操作。
    const { 幽 } = 挂拼装()
    await flush()
    点选("n1", 100, 100)
    await flush()
    ;(取("[data-slot='hgraph-toolbar-delete']") as HTMLButtonElement).click()
    await flush()
    expect(幽.计数.删除所选).toBe(1)
    expect(幽.计数.删对象 ?? 0).toBe(0)

    按键(画布()!, { key: "Delete" })
    await flush()
    expect(幽.计数.删除所选).toBe(2)
    expect(幽.计数.删对象 ?? 0).toBe(0)

    // 真编辑器侧：每个入口恰好一个批次（不是每对象一批、也不是重复批）。
    document.body.innerHTML = ""
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()
    点选("n1", 100, 100)
    await flush()
    ;(取("[data-slot='hgraph-toolbar-delete']") as HTMLButtonElement).click()
    await 过防抖()
    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([{ 操作: "删对象", 目标: [{ 类别: "节点", id: "n1" }] }])
    expect(节点组("n1")).toBeNull()

    点选("n2", 200, 100)
    await flush()
    按键(画布()!, { key: "Delete" })
    await 过防抖()
    expect(写们.length).toBe(2)
    expect(写们[1]!.操作).toEqual([{ 操作: "删对象", 目标: [{ 类别: "节点", id: "n2" }] }])
    expect(节点组("n2")).toBeNull()
  })

  test("焦点在检查器输入框按 Delete ⇒ 动作表零调用，节点仍在", async () => {
    const { 幽 } = 挂拼装({ 选中: ["n1"] })
    await flush()

    const 输入 = 取("[data-slot='hgraph-field-名称']") as HTMLInputElement
    expect(输入).not.toBeNull()
    输入.focus()
    按键(输入, { key: "Delete" })
    await flush()

    expect(幽.总()).toBe(0)
    expect(节点组("n1")).not.toBeNull()
  })

  test("双击节点标签：出现改名输入框；回车一个 改字段（名称），Esc 零操作", async () => {
    const { 幽 } = 挂拼装()
    await flush()

    const 标签 = 节点组("n1")!.querySelector("[data-slot='hgraph-node-label']")!
    标签.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 100, clientY: 127 }))
    await flush()

    const 输入 = 取("[data-slot='hgraph-rename-editor']") as HTMLInputElement | null
    expect(输入).not.toBeNull()
    expect(输入!.value).toBe("n1")

    输入!.value = "新名字"
    按键(输入!, { key: "Enter" })
    await flush()
    expect(幽.计数.改字段).toBe(1)
    expect(幽.参数.改字段![0]).toEqual(["节点", "n1", { 名称: "新名字" }])
    expect(取("[data-slot='hgraph-rename-editor']")).toBeNull()

    // Esc：重新打开后放弃 ⇒ 改字段计数不动，且输入框收起。
    标签.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 100, clientY: 127 }))
    await flush()
    const 再次 = 取("[data-slot='hgraph-rename-editor']") as HTMLInputElement
    expect(再次).not.toBeNull()
    再次.value = "不该存"
    按键(再次, { key: "Escape" })
    await flush()
    expect(幽.计数.改字段).toBe(1)
    expect(取("[data-slot='hgraph-rename-editor']")).toBeNull()
  })

  test("F2 与双击走同一动作（同一 spy 各 +1）", async () => {
    const { 幽 } = 挂拼装({ 选中: ["n1"] })
    await flush()

    按键(画布()!, { key: "F2" })
    await flush()
    expect(幽.计数.重命名).toBe(1)
    expect(幽.参数.重命名![0]).toEqual(["n1"])
    expect(取("[data-slot='hgraph-rename-editor']")).not.toBeNull()

    const 标签 = 节点组("n1")!.querySelector("[data-slot='hgraph-node-label']")!
    标签.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 100, clientY: 127 }))
    await flush()
    expect(幽.计数.重命名).toBe(2)
  })

  test("右键节点：菜单项只调动作表（重命名）", async () => {
    const { 幽 } = 挂拼装()
    await flush()

    节点组("n1")!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }),
    )
    await flush()
    expect(取("[data-slot='hgraph-menu']")).not.toBeNull()
    ;(取("[data-slot='hgraph-menu-rename']") as HTMLButtonElement).click()
    await flush()

    expect(幽.计数.重命名).toBe(1)
    expect(取("[data-slot='hgraph-rename-editor']")).not.toBeNull()
  })

  test("右键空白：加节点在点处（动作表收到坐标）", async () => {
    const { 幽 } = 挂拼装()
    await flush()

    画布()!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 321, clientY: 234 }),
    )
    await flush()
    ;(取("[data-slot='hgraph-menu-add-node']") as HTMLButtonElement).click()
    await flush()

    expect(幽.计数.加节点).toBe(1)
    expect(幽.参数.加节点![0]).toEqual([{ x: 321, y: 234 }])
  })

  test("检查器改名称：逐字输入 0 次待发，失焦恰好 1 次写", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()
    点选("n1", 100, 100)
    await flush()

    const 输入 = 取("[data-slot='hgraph-field-名称']") as HTMLInputElement
    expect(输入.value).toBe("n1")
    for (const 值 of ["张", "张三", "张三丰"]) {
      输入.value = 值
      输入.dispatchEvent(new Event("input", { bubbles: true }))
      await flush()
    }
    await 过防抖()
    expect(写们.length).toBe(0)

    输入.dispatchEvent(new FocusEvent("blur"))
    await 过防抖()
    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([
      { 操作: "改字段", 目标: [{ 类别: "节点", id: "n1", 补丁: { 名称: "张三丰" } }] },
    ])
  })

  test("清空备注后失焦 ⇒ 补丁含 备注: null，不是空串", async () => {
    const { api, 写们 } = 假api()
    const 图 = 一份图()
    图.节点[0]!.备注 = "旧备注"
    挂上(api, 图)
    await flush()
    点选("n1", 100, 100)
    await flush()

    const 输入 = 取("[data-slot='hgraph-field-备注']") as HTMLInputElement
    expect(输入.value).toBe("旧备注")
    输入.value = ""
    输入.dispatchEvent(new FocusEvent("blur"))
    await 过防抖()

    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([
      { 操作: "改字段", 目标: [{ 类别: "节点", id: "n1", 补丁: { 备注: null } }] },
    ])
  })

  test("批量态：选中 2 个 ⇒ 对齐/等距可用、合并 disabled；选中 1 个 ⇒ 对齐/等距 disabled、删除可用", async () => {
    const { 幽, set选中 } = 挂拼装({ 选中: ["n1"] })
    await flush()

    expect((取("[data-slot='hgraph-toolbar-align-左']") as HTMLButtonElement).disabled).toBe(true)
    expect((取("[data-slot='hgraph-toolbar-space-水平']") as HTMLButtonElement).disabled).toBe(true)
    expect((取("[data-slot='hgraph-toolbar-delete']") as HTMLButtonElement).disabled).toBe(false)
    expect(取("[data-slot='hgraph-toolbar-merge']")).toBeNull()

    set选中(["n1", "n2"])
    await flush()
    const 对齐 = 取("[data-slot='hgraph-toolbar-align-左']") as HTMLButtonElement
    expect(对齐.disabled).toBe(false)
    expect((取("[data-slot='hgraph-toolbar-space-水平']") as HTMLButtonElement).disabled).toBe(false)
    const 合并 = 取("[data-slot='hgraph-toolbar-merge']") as HTMLButtonElement
    expect(合并).not.toBeNull()
    expect(合并.disabled).toBe(true)
    expect(合并.getAttribute("title")).toBe("合并（下个任务做）")

    // 检查器批量面板也出现且可用（FR-028）。
    expect(取("[data-slot='hgraph-batch']")).not.toBeNull()
    expect((取("[data-slot='hgraph-batch-align-左']") as HTMLButtonElement).disabled).toBe(false)

    对齐.click()
    await flush()
    expect(幽.参数.对齐![0]).toEqual(["左", ["n1", "n2"]])
  })

  test("工具栏加节点：恰好 1 个带坐标的 加节点；应答映射后节点出现且选中是正式 id", async () => {
    const { api, 写们 } = 假api({
      写: (输入) => {
        const 加 = 输入.操作[0]!
        if (加.操作 !== "加节点") throw new Error("期望加节点")
        return 成功("v2", { [String(加.节点[0]!.id)]: "n7" })
      },
    })
    挂上(api)
    await flush()

    ;(取("[data-slot='hgraph-toolbar-add-node']") as HTMLButtonElement).click()
    await flush()
    await 过防抖()

    expect(写们.length).toBe(1)
    const 操作 = 写们[0]!.操作
    expect(操作.length).toBe(1)
    const 加 = 操作[0]!
    expect(加.操作).toBe("加节点")
    if (加.操作 !== "加节点") throw new Error("不是加节点")
    expect(加.节点.length).toBe(1)
    expect(typeof 加.节点[0]!.x).toBe("number")
    expect(typeof 加.节点[0]!.y).toBe("number")
    expect(Number.isInteger(加.节点[0]!.x)).toBe(true)
    expect(Number.isInteger(加.节点[0]!.y)).toBe(true)

    await flush()
    await flush()
    const 新 = 节点组("n7")
    expect(新).not.toBeNull()
    expect(新!.getAttribute("data-selected")).toBe("true")
    expect(document.querySelector("[data-node-id^='临时']")).toBeNull()
  })

  test("批量对齐 3 个节点 ⇒ 一条写、一步撤销", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()
    点选("n1", 100, 100)
    点选("n2", 200, 100, { shiftKey: true })
    点选("n3", 300, 100, { shiftKey: true })
    await flush()

    ;(取("[data-slot='hgraph-toolbar-align-左']") as HTMLButtonElement).click()
    await 过防抖()

    expect(写们.length).toBe(1)
    expect(写们[0]!.操作.length).toBe(1)
    const 移动 = 写们[0]!.操作[0]!
    expect(移动.操作).toBe("移动")
    if (移动.操作 !== "移动") throw new Error("不是移动")
    // n1 本来就在 x=100；n2/n3 被对齐到 100（锁定节点仍参与显式对齐）。
    expect(移动.目标.map((目标) => `${目标.id}:${目标.x}`)).toEqual(["n2:100", "n3:100"])

    const 撤销键 = 取("[data-slot='hgraph-undo']") as HTMLButtonElement
    expect(撤销键.disabled).toBe(false)
    按键(画布()!, { key: "z", ctrlKey: true })
    await flush()
    expect(撤销键.disabled).toBe(true)
  })

  test("自动布局：先确认；确认后一次批次，锁定节点不动", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    ;(取("[data-slot='hgraph-toolbar-layout']") as HTMLButtonElement).click()
    await 过防抖()
    expect(写们.length).toBe(0)
    expect(取("[data-slot='hgraph-layout-confirm']")).not.toBeNull()

    ;(取("[data-slot='hgraph-layout-confirm-ok']") as HTMLButtonElement).click()
    await 过防抖()
    expect(写们.length).toBe(1)
    const 操作 = 写们[0]!.操作
    expect(操作.length).toBe(1)
    expect(操作[0]!.操作).toBe("移动")
    if (操作[0]!.操作 !== "移动") throw new Error("不是移动")
    // n3 锁定 ⇒ 不在目标里；其余节点的坐标是整数。
    expect(操作[0]!.目标.some((目标) => 目标.id === "n3")).toBe(false)
    for (const 目标 of 操作[0]!.目标) {
      expect(Number.isInteger(目标.x)).toBe(true)
      expect(Number.isInteger(目标.y)).toBe(true)
    }
  })
})
