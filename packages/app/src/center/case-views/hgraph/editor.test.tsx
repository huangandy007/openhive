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
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { HgraphApi, 写应答 } from "@/project/hgraph-api"
import type { EntityApi, 实体清单项 } from "@/project/entity-api"
import type { CaseDetailApi, 实体档案, 档案关系 } from "@/center/case-detail-api"
import { 解析图, 序列化图, type 边, type 图文件, type 节点, type 文字 } from "./file"
import { 画布 as 画布组件, type 画布动作, type 坐标换算 } from "./canvas"
import { 检查器 } from "./inspector"
import { 工具栏 } from "./toolbar"
import { 编辑器, 构图, 布局目标 } from "./editor"
import { 适配视口 } from "./geometry"
import { 重置导出记录, type 导出依赖 } from "./export"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const 等 = (毫秒: number) => new Promise<void>((resolve) => setTimeout(resolve, 毫秒))
/**
 * 等到条件成立（上限内每 10ms 试一次）。
 *
 * 轮询用例的 `setInterval` 在机器忙时会晚到，固定 `等(120)` 会把「轮询还没跑」误判成
 * 「行为不对」（T013 解析失败用例的偶发红就是这类）。条件等待不掩盖失败：到上限仍未成立
 * 就交给后面的断言红，而不是靠加大 sleep 蒙混。
 */
async function 等到条件(条件: () => boolean, 上限毫秒 = 2000): Promise<void> {
  const 起 = Date.now()
  while (!条件()) {
    if (Date.now() - 起 > 上限毫秒) return
    await 等(10)
  }
}
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
type 读回 = Awaited<ReturnType<HgraphApi["读"]>>

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
  return host
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
    演示切换: () => 记("演示切换", []),
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

  test("批量态：选中 2 个 ⇒ 对齐/等距/合并可用；选中 1 个 ⇒ 对齐/等距/合并 disabled、删除可用", async () => {
    const { 幽, set选中 } = 挂拼装({ 选中: ["n1"] })
    await flush()

    expect((取("[data-slot='hgraph-toolbar-align-左']") as HTMLButtonElement).disabled).toBe(true)
    expect((取("[data-slot='hgraph-toolbar-space-水平']") as HTMLButtonElement).disabled).toBe(true)
    expect((取("[data-slot='hgraph-toolbar-delete']") as HTMLButtonElement).disabled).toBe(false)
    // T016b：合并按钮常驻，选中节点数 < 2 时 disabled（曾被渲染成 disabled 占位）。
    const 合并 = 取("[data-slot='hgraph-toolbar-merge']") as HTMLButtonElement
    expect(合并).not.toBeNull()
    expect(合并.disabled).toBe(true)

    set选中(["n1", "n2"])
    await flush()
    const 对齐 = 取("[data-slot='hgraph-toolbar-align-左']") as HTMLButtonElement
    expect(对齐.disabled).toBe(false)
    expect((取("[data-slot='hgraph-toolbar-space-水平']") as HTMLButtonElement).disabled).toBe(false)
    expect(合并.disabled).toBe(false)
    expect(合并.getAttribute("title")).toBe("合并所选")

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

// ---------------------------------------------------------------------------
// T010 · 修复轮 1（审查 I1 / M1–M6）
// ---------------------------------------------------------------------------

const 右键 = (元素: Element, x = 100, y = 100) =>
  元素.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }))

describe("T010 · 修复轮 1", () => {
  test("I1 右键菜单：在工具栏上 pointerdown ⇒ 菜单收起", async () => {
    const { api } = 假api()
    挂上(api)
    await flush()
    点选("n1", 100, 100)
    await flush()

    右键(节点组("n1")!)
    await flush()
    expect(取("[data-slot='hgraph-menu']")).not.toBeNull()

    取("[data-slot='hgraph-toolbar-add-node']")!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1 }),
    )
    await flush()
    expect(取("[data-slot='hgraph-menu']")).toBeNull()
  })

  test("I1 复现：n1 菜单开着时从工具栏加节点 ⇒ 菜单已关、没有删错对象", async () => {
    const { api } = 假api({
      写: (输入) => {
        const 操作 = 输入.操作[0]!
        if (操作.操作 === "加节点") return 成功("v2", { [String(操作.节点[0]!.id)]: "n7" })
        return 成功("v3")
      },
    })
    挂上(api)
    await flush()
    点选("n1", 100, 100)
    await flush()

    右键(节点组("n1")!)
    await flush()
    expect(取("[data-slot='hgraph-menu']")).not.toBeNull()

    // 真实一次点击 = pointerdown → pointerup → click；菜单在 pointerdown 就该收。
    按下(取("[data-slot='hgraph-toolbar-add-node']")!, 40, 40)
    ;(取("[data-slot='hgraph-toolbar-add-node']") as HTMLButtonElement).click()
    await flush()
    await 过防抖()

    // 菜单必须已经收起：否则下一步点菜单「删除」删的是当前选中的新节点，不是菜单打开的 n1。
    expect(取("[data-slot='hgraph-menu']")).toBeNull()
    expect(取("[data-slot='hgraph-menu-delete']")).toBeNull()
    expect(节点组("n1")).not.toBeNull()
    expect(节点组("n7")).not.toBeNull()

    // 菜单收起后 Delete 按当前选中删的是新节点；n1 不受影响。
    按键(画布()!, { key: "Delete" })
    await 过防抖()
    expect(节点组("n1")).not.toBeNull()
    expect(节点组("n7")).toBeNull()
  })

  test("M1 画布内输入框 + 非空选中：Delete / F2 不生效", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()
    点选("n1", 100, 100)
    await flush()
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")

    文字行("t1")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 50, clientY: 50 }))
    await flush()
    const 输入 = 取("[data-slot='hgraph-text-editor']") as HTMLInputElement
    expect(输入).not.toBeNull()

    按键(输入, { key: "Delete" })
    按键(输入, { key: "F2" })
    await flush()
    await 过防抖()

    expect(写们.length).toBe(0)
    expect(节点组("n1")).not.toBeNull()
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")
    expect(取("[data-slot='hgraph-rename-editor']")).toBeNull()
  })

  test("M2 双击画布 chrome 按钮不触发加节点", async () => {
    const { 幽 } = 挂拼装()
    await flush()

    取("[data-slot='hgraph-mode-pointer']")!.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
    )
    await flush()
    expect(幽.计数.加节点 ?? 0).toBe(0)
  })

  test("M3 加节点应答前 F2：映射后改名输入框仍连着正式 id，提交发正式 id", async () => {
    const { api, 写们, 解 } = 闸门api()
    挂上(api)
    await flush()

    ;(取("[data-slot='hgraph-toolbar-add-node']") as HTMLButtonElement).click()
    await flush()
    按键(画布()!, { key: "F2" })
    await flush()
    expect(取("[data-slot='hgraph-rename-editor']")).not.toBeNull()

    await 过防抖()
    expect(写们.length).toBe(1)
    const 加 = 写们[0]!.操作[0]!
    expect(加.操作).toBe("加节点")
    if (加.操作 !== "加节点") throw new Error("不是加节点")
    const 临时 = String(加.节点[0]!.id)

    解(0, 成功("v2", { [临时]: "n7" }))
    await flush()
    await flush()

    // 映射之后输入框必须还连着正式 id（临时 id 在文档里已经不存在了）。
    const 还在 = 取("[data-slot='hgraph-rename-editor']") as HTMLInputElement | null
    expect(还在).not.toBeNull()
    还在!.value = "正式名"
    按键(还在!, { key: "Enter" })
    await 过防抖()

    expect(写们.length).toBe(2)
    expect(写们[1]!.操作).toEqual([
      { 操作: "改字段", 目标: [{ 类别: "节点", id: "n7", 补丁: { 名称: "正式名" } }] },
    ])
  })

  test("M4 锁定切换：一次批次锁两个节点；再来一次解锁（false）", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()
    点选("n1", 100, 100)
    点选("n2", 200, 100, { shiftKey: true })
    await flush()

    ;(取("[data-slot='hgraph-toolbar-lock']") as HTMLButtonElement).click()
    await 过防抖()
    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([
      {
        操作: "改字段",
        目标: [
          { 类别: "节点", id: "n1", 补丁: { 锁定: true } },
          { 类别: "节点", id: "n2", 补丁: { 锁定: true } },
        ],
      },
    ])
    expect(取("[data-slot='hgraph-toolbar-lock']")!.textContent?.trim()).toBe("解锁")

    ;(取("[data-slot='hgraph-toolbar-lock']") as HTMLButtonElement).click()
    await 过防抖()
    expect(写们.length).toBe(2)
    expect(写们[1]!.操作).toEqual([
      {
        操作: "改字段",
        目标: [
          { 类别: "节点", id: "n1", 补丁: { 锁定: false } },
          { 类别: "节点", id: "n2", 补丁: { 锁定: false } },
        ],
      },
    ])
  })

  test("M5 边菜单标签 Enter 只提交一次，之后再 blur 也不重复", async () => {
    const 图 = 一份图()
    图.边 = [
      {
        id: "e1",
        从: "n1",
        到: "n2",
        标签: "",
        性质: "推断",
        方向: "有向",
        来源: { kind: "手写" },
        时间: { 首: "", 末: "" },
      },
    ]
    const { 幽 } = 挂拼装({ 文档: 图 })
    await flush()

    右键(取("[data-slot='hgraph-edge'][data-edge-id='e1']")!)
    await flush()
    const 输入 = 取("[data-slot='hgraph-menu-edge-label']") as HTMLInputElement
    expect(输入).not.toBeNull()
    输入.value = "新标签"
    按键(输入, { key: "Enter" })
    await flush()
    expect(幽.计数.改字段).toBe(1)

    // 菜单卸载后浏览器/测试补发的 blur 不能再提交一次。
    输入.dispatchEvent(new FocusEvent("blur"))
    await flush()
    expect(幽.计数.改字段).toBe(1)
  })

  test("M6 加节点失败 ⇒ 选中清空、工具栏删除不可用", async () => {
    const { api } = 假api({ 写: () => ({ kind: "error", message: "写不进去", code: "INTERNAL" }) })
    挂上(api)
    await flush()

    ;(取("[data-slot='hgraph-toolbar-add-node']") as HTMLButtonElement).click()
    await flush()
    await 过防抖()
    await flush()

    expect((取("[data-slot='hgraph-toolbar-delete']") as HTMLButtonElement).disabled).toBe(true)
    expect(document.querySelector("[data-node-id^='临时']")).toBeNull()
    expect(取("[data-slot='hgraph-rename-editor']")).toBeNull()
  })

  test("M7 构图：度数为边数、中心取度数最大 / id 最小、跳数为无向 BFS 层数", () => {
    const 图 = 一份图()
    图.节点 = [造节点("n1", 100, 100), 造节点("n2", 200, 100), 造节点("n3", 300, 100)]
    图.边 = [
      { id: "e1", 从: "n1", 到: "n2", 标签: "", 性质: "推断", 方向: "无向", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" } },
      { id: "e2", 从: "n2", 到: "n3", 标签: "", 性质: "推断", 方向: "无向", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" } },
    ]

    const 结果 = 构图(图)
    const 表 = new Map(结果.节点.map((点) => [点.id, 点]))
    // 链 n1-n2-n3 按「度数 = 相连边数」：中间 n2 有两条边 ⇒ 度数 2，是中心；
    // 两侧各 1 条；无向 BFS 从 n2 出发 ⇒ n2=0、n1/n3=1。
    // （审查示例写的「中心 n1、跳数 0/1/2、度数都 1」与这三条定义互相矛盾：
    //  链上 n2 必有 2 条边；若要从 n1 取得 0/1/2 的跳数，n2 的度数就不可能也是 1。）
    expect(表.get("n1")!.度数).toBe(1)
    expect(表.get("n2")!.度数).toBe(2)
    expect(表.get("n3")!.度数).toBe(1)
    expect(表.get("n2")!.中心).toBe(true)
    expect(表.get("n1")!.中心).toBe(false)
    expect(表.get("n3")!.中心).toBe(false)
    expect(表.get("n2")!.跳数).toBe(0)
    expect(表.get("n1")!.跳数).toBe(1)
    expect(表.get("n3")!.跳数).toBe(1)

    // 并列规则：一条边 n1-n2（两边度数都是 1）⇒ 取 id 字典序最小 n1。
    const 两粒 = 一份图()
    两粒.节点 = [造节点("n2", 200, 100), 造节点("n1", 100, 100)]
    两粒.边 = [
      { id: "e1", 从: "n1", 到: "n2", 标签: "", 性质: "推断", 方向: "无向", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" } },
    ]
    const 表二 = new Map(构图(两粒).节点.map((点) => [点.id, 点]))
    expect(表二.get("n1")!.中心).toBe(true)
    expect(表二.get("n2")!.中心).toBe(false)
    expect(表二.get("n1")!.跳数).toBe(0)
    expect(表二.get("n2")!.跳数).toBe(1)

    // 无边 ⇒ 取 id 最小者为中心，其余不可达按 1。
    const 孤立 = 一份图()
    孤立.节点 = [造节点("n2", 200, 100), 造节点("n1", 100, 100)]
    孤立.边 = []
    const 表三 = new Map(构图(孤立).节点.map((点) => [点.id, 点]))
    expect(表三.get("n1")!.中心).toBe(true)
    expect(表三.get("n1")!.跳数).toBe(0)
    expect(表三.get("n2")!.跳数).toBe(1)
    expect(表三.get("n2")!.度数).toBe(0)
  })

  test("T011 #6 检查器改出现序 2 后失焦：恰一条写、一步撤销（T016a：撤销写回 null）", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()
    点选("n1", 100, 100)
    await flush()
    expect(写们.length).toBe(0)

    const 输入 = 取("[data-slot='hgraph-field-出现序']") as HTMLInputElement
    expect(输入).not.toBeNull()
    输入.value = "2"
    输入.dispatchEvent(new FocusEvent("blur"))
    await 过防抖()

    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([
      { 操作: "改字段", 目标: [{ 类别: "节点", id: "n1", 补丁: { 出现序: 2 } }] },
    ])

    // 一次改动 = 一步撤销：撤销按钮亮起，Ctrl+Z 弹掉这一步。
    const 撤销键 = 取("[data-slot='hgraph-undo']") as HTMLButtonElement
    expect(撤销键.disabled).toBe(false)
    按键(画布()!, { key: "z", ctrlKey: true })
    await flush()
    expect(撤销键.disabled).toBe(true)
    // T016a：撤销应用逆操作并发一次写——旧键不存在 ⇒ 补丁 null（删键）。
    await 过防抖()
    expect(写们.length).toBe(2)
    expect(写们[1]!.操作).toEqual([
      { 操作: "改字段", 目标: [{ 类别: "节点", id: "n1", 补丁: { 出现序: null } }] },
    ])
  })

  test("M7 自动布局：默认环形与网格产出不同坐标；锁定节点不在目标里", () => {
    const 图 = 一份图()
    图.节点 = [造节点("n1", 100, 100), 造节点("n2", 200, 100), 造节点("n3", 300, 100)]
    图.边 = [
      { id: "e1", 从: "n1", 到: "n2", 标签: "", 性质: "推断", 方向: "无向", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" } },
      { id: "e2", 从: "n2", 到: "n3", 标签: "", 性质: "推断", 方向: "无向", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" } },
    ]
    const 键 = (目标: ReturnType<typeof 布局目标>) => 目标.map((位) => `${位.id}:${位.x},${位.y}`)

    const 默认 = 布局目标(图)
    const 环形 = 布局目标(图, "环形")
    const 网格 = 布局目标(图, "网格")
    // 默认是环形（R36）——参数原样透传，不是写死某一种。
    expect(键(默认)).toEqual(键(环形))
    expect(键(环形)).not.toEqual(键(网格))
    for (const 位 of [...默认, ...网格]) {
      expect(Number.isInteger(位.x)).toBe(true)
      expect(Number.isInteger(位.y)).toBe(true)
    }

    const 带锁 = 一份图()
    带锁.节点 = [造节点("n1", 100, 100), 造节点("n2", 200, 100), 造节点("n3", 300, 100, { 锁定: true })]
    expect(布局目标(带锁).some((位) => 位.id === "n3")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// T013 · 页面接收 AI 改动（轮询 / 静默重载 / 询问 / 清栈 / 提示）
// ---------------------------------------------------------------------------

const 文本 = (图: 图文件) => 序列化图(undefined, 图)

/** 按 data-slot 取按钮；`querySelector` 的泛型直接给出元素类型，避免重复断言。 */
const 按钮 = (slot: string) => document.body.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)!

/** 从当前远端图造一次「外部改动」：多一颗 n9（判据显眼，且不影响旧节点）。 */
function 外部改过的图(基: 图文件): 图文件 {
  return {
    ...基,
    更新于: "2026-11-16T11:30:00+08:00",
    节点: [...基.节点, 造节点("n9", 600, 400)],
  }
}

/**
 * T013 的假服务端：`读` 回远端快照；`写` 真的把 `移动` 应用到远端并推进版本，
 * 让「自己保存成功」不被下一 tick 误判成外部改动。只实现用例用到的操作。
 */
function 假服务端(初始图: 图文件, 选项: { 写挂起?: boolean; 写闸?: number; 读挂起?: boolean; 读失败?: boolean } = {}) {
  const 解析 = 解析图(文本(初始图))
  if (!解析.ok) throw new Error(`T013 夹具不是合法图：${解析.说明}`)
  const 图 = 解析.文档
  const 远端 = { 内容: 文本(图), 版本: "w1", 读失败: 选项.读失败 === true }
  let 序 = 0
  let 已读挂 = false
  let 已闸 = 0
  const 写们: 写入参[] = []
  const 读们: Array<{ projectId: string; path: string }> = []
  const 写闸们: Array<((回: 写应答) => void) | undefined> = []
  let 读闸: ((回: 读回) => void) | undefined

  const 应用移动 = (输入: 写入参) => {
    for (const 操作 of 输入.操作) {
      if (操作.操作 !== "移动") continue
      for (const 目标 of 操作.目标) {
        const 目标行 =
          目标.类别 === "节点"
            ? 图.节点.find((点) => 点.id === 目标.id)
            : 图.文字.find((行) => 行.id === 目标.id)
        if (目标行 !== undefined) {
          目标行.x = 目标.x
          目标行.y = 目标.y
        }
      }
    }
    图.更新于 = `自存-${++序}`
    远端.内容 = 文本(图)
    远端.版本 = `自存${序}`
    return 远端.版本
  }

  const api: HgraphApi = {
    读: async (输入) => {
      读们.push(输入)
      if (远端.读失败) return { kind: "error", message: "网络断了", code: "network" }
      if (选项.读挂起 === true && !已读挂) {
        已读挂 = true
        return await new Promise<读回>((解) => {
          读闸 = 解
        })
      }
      return { kind: "ok", value: { 内容: 远端.内容, 版本: 远端.版本 } }
    },
    初始化: async () => {
      throw new Error("编辑器不该 init")
    },
    写: async (输入) => {
      写们.push(输入)
      if (选项.写挂起 === true) return await new Promise<写应答>(() => {})
      if (已闸 < (选项.写闸 ?? 0)) {
        已闸++
        return await new Promise<写应答>((解) => 写闸们.push(解))
      }
      return 成功(应用移动(输入))
    },
    导出许可: async () => {
      throw new Error("编辑器不该导出")
    },
  }
  return {
    api,
    写们,
    读们,
    远端,
    现图: () => 图,
    设远端(新图: 图文件, 版本: string) {
      远端.内容 = 文本(新图)
      远端.版本 = 版本
      // 后续自己发的写要落在**新远端**上（否则写成功后远端缺了外部改动，又被判成外部变更）。
      Object.assign(图, 新图)
    },
    /** 任意原文（坏 JSON 等）：验证解析失败走询问、不覆盖。 */
    设原文(内容: string, 版本: string) {
      远端.内容 = 内容
      远端.版本 = 版本
    },
    设读失败(失败: boolean) {
      远端.读失败 = 失败
    },
    /** 放行挂起的那次读（用当前远端快照）。 */
    解读() {
      const 解 = 读闸
      读闸 = undefined
      解?.({ kind: "ok", value: { 内容: 远端.内容, 版本: 远端.版本 } })
    },
    /** 放行第 `序` 次挂起的写；应答由用例给，不改远端（用例自行设远端）。 */
    解写(序: number, 回: 写应答) {
      写闸们[序]?.(回)
      写闸们[序] = undefined
    },
  }
}

/** T013 专用挂载：多两个测试缝（`轮询毫秒` / `外部改动`）。 */
function 挂轮询(
  api: HgraphApi,
  选项: {
    初始文档?: 图文件
    初始版本?: string
    轮询毫秒?: number
    外部改动?: (旧文档: 图文件, 新文档: 图文件) => void
  } = {},
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
          初始文档={选项.初始文档 ?? 一份图()}
          初始版本={选项.初始版本 ?? "v1"}
          坐标换算={({ clientX, clientY }) => ({ x: clientX, y: clientY })}
          轮询毫秒={选项.轮询毫秒 ?? 25}
          外部改动={选项.外部改动}
        />
      ),
      host,
    ),
  )
}

describe("T013 · 页面接收 AI 改动", () => {
  test("#1 无待发时版本变 ⇒ 静默重载 + 清栈 + 提示；重载零写盘", async () => {
    const 服 = 假服务端(一份图())
    挂轮询(服.api, { 轮询毫秒: 40 })
    await flush()

    // 先制造一步撤销（旧历史），并让假服务端真的接受这次移动。
    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()
    expect(按钮("hgraph-undo").disabled).toBe(false)
    const 存档 = 服.写们.length
    expect(存档).toBe(1)

    // AI 改了文件：多一颗 n9、版本变了。
    服.设远端(外部改过的图(服.现图()), "a1")
    await 等(200)

    expect(节点组("n9")).not.toBeNull()
    expect(文案("hgraph-reload-notice")).toBe("图已重新载入，之前的撤销记录已清空")
    expect(取("[data-slot='hgraph-reload-notice']")!.getAttribute("role")).toBe("status")
    // R92b（语义变更）：AI 那一步已压栈 ⇒ 撤销可用（旧步已清）；深度恰 1 见 #7。
    expect(按钮("hgraph-undo").disabled).toBe(false)
    expect(按钮("hgraph-redo").disabled).toBe(true)
    // 重载只读：写调用数停在存档那一次。
    expect(服.写们.length).toBe(存档)
  })

  test("#2 自己保存成功后下一次轮询：不重载，文档与选中不变", async () => {
    const 收到: unknown[] = []
    const 服 = 假服务端(一份图())
    挂轮询(服.api, { 轮询毫秒: 40, 外部改动: (旧, 新) => 收到.push([旧, 新]) })
    await flush()

    点选("n1", 100, 100)
    await flush()
    拖(节点组("n2")!, 200, 100, 260, 100)
    await 过防抖()
    // 让至少 3 个 tick 跑过：读回同版本不该触发任何重载。
    await 等(220)

    expect(节点组("n2")!.getAttribute("transform")).toBe("translate(260 100)")
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")
    expect(文案("hgraph-reload-notice")).toBeUndefined()
    expect(收到.length).toBe(0)
    expect(按钮("hgraph-undo").disabled).toBe(false)
  })

  test("#3 有待发时版本变 ⇒ 只问不重载（旧节点仍在）", async () => {
    const 服 = 假服务端(一份图(), { 写挂起: true })
    挂轮询(服.api, { 轮询毫秒: 25 })
    await flush()

    // 立刻产生待发（500ms 防抖窗口内），随后远端被外部改掉。
    拖(节点组("n1")!, 100, 100, 150, 130)
    服.设远端(外部改过的图(服.现图()), "a1")
    await 等(120)

    expect(取("[data-slot='hgraph-reload-ask']")).not.toBeNull()
    expect(文案("hgraph-reload-ask")).toContain("图已被更新，重新载入？")
    expect(节点组("n9")).toBeNull()
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(150 130)")
    expect(文案("hgraph-reload-notice")).toBeUndefined()
  })

  test("#4 询问里点「重新载入」⇒ 换新文档 + 清栈 + 提示；零写盘", async () => {
    const 服 = 假服务端(一份图(), { 写挂起: true })
    挂轮询(服.api, { 轮询毫秒: 25 })
    await flush()
    拖(节点组("n1")!, 100, 100, 150, 130)
    服.设远端(外部改过的图(服.现图()), "a1")
    await 等(100)
    expect(取("[data-slot='hgraph-reload-ask']")).not.toBeNull()

    按钮("hgraph-reload-ask-reload").click()
    await flush()
    await flush()

    expect(节点组("n9")).not.toBeNull()
    expect(取("[data-slot='hgraph-reload-ask']")).toBeNull()
    expect(文案("hgraph-reload-notice")).toBe("图已重新载入，之前的撤销记录已清空")
    // I-2：必须**跨过原来的 500ms 防抖窗口**再断言，否则计时器还没到点、
    // 卸载时又被 afterEach 清掉 ⇒ 断言恒真（假绿）。
    await 过防抖()
    expect(服.写们.length).toBe(0)
  })

  test("#5 「保留我的改动」⇒ 询问消失、文档不变；下一 tick 再问（不吞）", async () => {
    const 服 = 假服务端(一份图(), { 写挂起: true })
    挂轮询(服.api, { 轮询毫秒: 25 })
    await flush()
    拖(节点组("n1")!, 100, 100, 150, 130)
    服.设远端(外部改过的图(服.现图()), "a1")
    await 等(100)
    expect(取("[data-slot='hgraph-reload-ask']")).not.toBeNull()

    按钮("hgraph-reload-ask-keep").click()
    // 点击是同步的：询问条立刻收起（不等 tick；点击前已发起的那次读可能在 flush 后回填）。
    expect(取("[data-slot='hgraph-reload-ask']")).toBeNull()
    expect(节点组("n9")).toBeNull()

    // 版本仍不同 ⇒ 下一个 tick 重新问，不吞。
    await 等(120)
    expect(取("[data-slot='hgraph-reload-ask']")).not.toBeNull()
    expect(节点组("n9")).toBeNull()
  })

  test("#6 读失败 ⇒ 静默跳过本 tick：文档/栈/版本不变、无错误提示", async () => {
    const 收到: unknown[] = []
    const 服 = 假服务端(一份图(), { 读失败: true })
    挂轮询(服.api, { 轮询毫秒: 25, 外部改动: (旧, 新) => 收到.push([旧, 新]) })
    await flush()
    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()
    expect(按钮("hgraph-undo").disabled).toBe(false)

    // 远端内容变了，但读一直失败 ⇒ 不重载、不提示、不弹错。
    服.设远端(外部改过的图(服.现图()), "a1")
    await 等(200)

    expect(节点组("n9")).toBeNull()
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(150 130)")
    expect(按钮("hgraph-undo").disabled).toBe(false)
    expect(文案("hgraph-save-status")).toBe("已保存")
    expect(文案("hgraph-save-status")).not.toContain("没存上")
    expect(取("[data-slot='hgraph-reload-ask']")).toBeNull()
    expect(文案("hgraph-reload-notice")).toBeUndefined()
    expect(收到.length).toBe(0)
  })

  test("#7 重载后按 Ctrl+Z ⇒ 恰 1 次写、只含 AI 还原、旧步不写回（R92b）", async () => {
    const 服 = 假服务端(一份图())
    挂轮询(服.api, { 轮询毫秒: 25 })
    await flush()
    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()
    expect(服.写们.length).toBe(1)
    expect(按钮("hgraph-undo").disabled).toBe(false)

    服.设远端(外部改过的图(服.现图()), "a1")
    await 等到条件(() => 节点组("n9") !== null)
    await flush()
    expect(节点组("n9")).not.toBeNull()
    // R92b：栈里恰有 AI 一步（旧步已清空）⇒ 撤销可用、重做没有内容。
    // 「恰 1」由下面一次 Ctrl+Z 后撤销即变灰来钉死。
    expect(按钮("hgraph-undo").disabled).toBe(false)
    expect(按钮("hgraph-redo").disabled).toBe(true)

    按键(画布()!, { key: "z", ctrlKey: true })
    await 过防抖()
    // 恰好一次写（不是每对象一次），且只含 AI 还原：删掉 AI 新增的 n9。
    expect(服.写们.length).toBe(2)
    expect(服.写们[1]!.操作).toEqual([{ 操作: "删对象", 目标: [{ 类别: "节点", id: "n9" }] }])
    // 旧步（把 n1 挪到 150,130）没有被写回：n1 仍在重载后的位置。
    expect(节点组("n9")).toBeNull()
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(150 130)")
    expect(按钮("hgraph-undo").disabled).toBe(true)
    expect(按钮("hgraph-redo").disabled).toBe(false)
  })

  test("#8 重载后选中清空，检查器不再显示旧节点", async () => {
    const 服 = 假服务端(一份图())
    挂轮询(服.api, { 轮询毫秒: 25 })
    await flush()
    点选("n1", 100, 100)
    await flush()
    expect(取("[data-slot='hgraph-field-名称']")).not.toBeNull()

    服.设远端(外部改过的图(服.现图()), "a1")
    await 等(150)

    expect(节点组("n1")!.getAttribute("data-selected")).toBeNull()
    expect(取("[data-slot='hgraph-field-名称']")).toBeNull()
  })

  test("#9 演示中版本变 ⇒ 本 tick 不重载；退出演示后下一 tick 重载", async () => {
    const 服 = 假服务端(一份图())
    挂轮询(服.api, { 轮询毫秒: 30 })
    await flush()
    按钮("hgraph-toolbar-present").click()
    await flush()
    expect(取("[data-slot='hgraph-present']")).not.toBeNull()

    服.设远端(外部改过的图(服.现图()), "a1")
    await 等(150)
    // 演示不被打断：覆盖层还在，新文档没有套上。
    expect(取("[data-slot='hgraph-present']")).not.toBeNull()
    expect(节点组("n9")).toBeNull()
    expect(文案("hgraph-reload-notice")).toBeUndefined()

    // 退出演示（舞台上的 Esc）⇒ 下一 tick 自然处理。
    按键(取("[data-slot='hgraph-stage']")!, { key: "Escape" })
    await flush()
    await flush()
    expect(取("[data-slot='hgraph-present']")).toBeNull()

    await 等(150)
    expect(节点组("n9")).not.toBeNull()
    expect(文案("hgraph-reload-notice")).toBe("图已重新载入，之前的撤销记录已清空")
  })

  test("#10 重载时外部改动收到（旧文档, 新文档）各一次；同版本不重复回调", async () => {
    const 收到: Array<{ 旧: 图文件; 新: 图文件 }> = []
    const 服 = 假服务端(一份图())
    挂轮询(服.api, { 轮询毫秒: 25, 外部改动: (旧, 新) => 收到.push({ 旧, 新 }) })
    await flush()

    服.设远端(外部改过的图(服.现图()), "a1")
    await 等(150)
    // 再跑几个 tick：同版本不该重复回调。
    await 等(120)

    expect(收到.length).toBe(1)
    expect(收到[0].旧.节点.some((点) => 点.id === "n9")).toBe(false)
    expect(收到[0].新.节点.some((点) => 点.id === "n9")).toBe(true)
  })

  test("R85 版本变但内容相同 ⇒ 不掉栈、不提示、不触发回调；版本照常更新", async () => {
    const 收到: unknown[] = []
    const 服 = 假服务端(一份图())
    挂轮询(服.api, { 轮询毫秒: 40, 外部改动: (旧, 新) => 收到.push([旧, 新]) })
    await flush()

    // 先保存一次，让栈里有一步（才能判「有没有被清」）。
    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()
    expect(按钮("hgraph-undo").disabled).toBe(false)
    expect(服.写们.length).toBe(1)

    // 服务端同值补丁：只刷新 `更新于` 并推进版本，用户可见内容一模一样。
    const 同内容 = { ...服.现图(), 更新于: "2026-11-16T12:00:00+08:00" }
    服.设远端(同内容, "w9")
    await 等(200)

    expect(文案("hgraph-reload-notice")).toBeUndefined()
    expect(按钮("hgraph-undo").disabled).toBe(false)
    expect(收到.length).toBe(0)
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(150 130)")

    // 版本确实推进到 w9：下一次写必须带 w9（否则下一轮重复比对 / 409）。
    拖(节点组("n2")!, 200, 100, 220, 100)
    await 过防抖()
    expect(服.写们.length).toBe(2)
    expect(服.写们[1].版本).toBe("w9")

    // 真正的 AI 改动（内容变了）⇒ 正常重载并回调一次。
    服.设远端(外部改过的图(服.现图()), "w10")
    await 等(200)
    expect(节点组("n9")).not.toBeNull()
    expect(文案("hgraph-reload-notice")).toBe("图已重新载入，之前的撤销记录已清空")
    expect(收到.length).toBe(1)
  })

  test("解析失败（坏 JSON）⇒ 走询问路径不覆盖；保留后文档不变", async () => {
    const 服 = 假服务端(一份图())
    挂轮询(服.api, { 轮询毫秒: 25 })
    await flush()

    服.设原文("{ 这不是 JSON", "bad1")
    // 条件等待代替固定 `等(120)`：轮询 25ms，机器忙时固定窗口会偶发假红。
    await 等到条件(() => 取("[data-slot='hgraph-reload-ask']") !== null)
    expect(取("[data-slot='hgraph-reload-ask']")).not.toBeNull()
    expect(节点组("n1")).not.toBeNull()
    expect(文案("hgraph-reload-notice")).toBeUndefined()

    按钮("hgraph-reload-ask-keep").click()
    // 「保留」是同步收起；**下一 tick 读到同一份坏 JSON 会再问**（实现口径：不吞）。
    // 因此收起必须在同一个同步步里断言——原先先 `await flush()` 再断言，正好把 25ms
    // 轮询的再问窗口放进来，形成与本用例目的无关的偶发红。
    expect(取("[data-slot='hgraph-reload-ask']")).toBeNull()
    await flush()
    expect(节点组("n1")).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // 修复轮 1（R89）：在途写的应答晚于外部重载 ⇒ 整段丢弃
  // -------------------------------------------------------------------------

  test("I-1 在途写「成功」应答晚于外部重载 ⇒ 不覆盖新文档、不回填旧撤销步", async () => {
    const 服 = 假服务端(一份图(), { 写闸: 1 })
    挂轮询(服.api, { 轮询毫秒: 25 })
    await flush()

    // 拖一下 ⇒ 500ms 后这批写发出，服务端应答被挂住（飞行中）。
    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()
    expect(服.写们.length).toBe(1)
    // 还没成功：栈里没有这一步。
    expect(按钮("hgraph-undo").disabled).toBe(true)

    // 飞行中 AI 改了文件 ⇒ 只问不重载。
    服.设远端(外部改过的图(服.现图()), "a1")
    await 等(120)
    expect(取("[data-slot='hgraph-reload-ask']")).not.toBeNull()

    按钮("hgraph-reload-ask-reload").click()
    await flush()
    expect(节点组("n9")).not.toBeNull()
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(100 100)")

    // 现在才让那批旧写的**成功**应答回来：它基于旧文档，必须整段丢弃。
    服.解写(0, 成功("a1"))
    await flush()
    await flush()

    expect(节点组("n9")).not.toBeNull()
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(100 100)")
    // R92b（语义变更）：栈里是重载时压入的 AI 一步（旧步没有回填）；撤销可用。
    expect(按钮("hgraph-undo").disabled).toBe(false)
    expect(文案("hgraph-save-status")).toBe("已保存")

    // I-2 修复：不能只看 disabled —— 按一次 Ctrl+Z 必须「一次到底」并让撤销变灰，
    // 才证明栈深恰 1（旧步没有被回填成第二步）。
    // I-1：载荷只许含 AI 还原；被丢弃的那次拖动（n1 → 150,130）绝不能借撤销写回。
    按键(画布()!, { key: "z", ctrlKey: true })
    await 过防抖()
    expect(服.写们.length).toBe(2)
    // 这一次写必须基于重载版本 a1（否则 409 / 下一 tick 又误判外部改动）。
    expect(服.写们[1].版本).toBe("a1")
    expect(服.写们[1].操作).toEqual([{ 操作: "删对象", 目标: [{ 类别: "节点", id: "n9" }] }])
    expect(节点组("n9")).toBeNull()
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(100 100)")
    expect(按钮("hgraph-undo").disabled).toBe(true)
    expect(按钮("hgraph-redo").disabled).toBe(false)
  })

  test("I-1 在途写「失败」应答晚于外部重载 ⇒ 不被旧基线覆盖、状态不误导", async () => {
    const 服 = 假服务端(一份图(), { 写闸: 1 })
    挂轮询(服.api, { 轮询毫秒: 25 })
    await flush()

    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()
    expect(服.写们.length).toBe(1)

    服.设远端(外部改过的图(服.现图()), "a1")
    await 等(120)
    expect(取("[data-slot='hgraph-reload-ask']")).not.toBeNull()

    按钮("hgraph-reload-ask-reload").click()
    await flush()
    expect(节点组("n9")).not.toBeNull()

    服.解写(0, { kind: "error", message: "没存上", code: "SERVER" })
    await flush()
    await flush()

    // 旧基线（拖过 n1、没有 n9）不许覆盖重载后的文档。
    expect(节点组("n9")).not.toBeNull()
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(100 100)")
    // R92b（语义变更）：AI 一步在栈里（失败批的旧步没有回填）；撤销可用。
    expect(按钮("hgraph-undo").disabled).toBe(false)
    // 状态说「没存上」会误导：这批结果已丢弃，当前文档就是服务端那份。
    expect(文案("hgraph-save-status")).toBe("已保存")
    expect(取("[data-slot='hgraph-save-status']")!.getAttribute("data-state")).toBe("已存")

    // I-2 修复：一次 Ctrl+Z 必须到底（撤销变灰 ⇒ 栈深恰 1），且载荷只含 AI 还原；
    // I-1：失败批的拖动（n1 → 150,130）已经「没存上」，不许借撤销写回。
    按键(画布()!, { key: "z", ctrlKey: true })
    await 过防抖()
    expect(服.写们.length).toBe(2)
    expect(服.写们[1].操作).toEqual([{ 操作: "删对象", 目标: [{ 类别: "节点", id: "n9" }] }])
    expect(节点组("n9")).toBeNull()
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(100 100)")
    expect(按钮("hgraph-undo").disabled).toBe(true)
  })

  test("I-1 回归：没有外部重载时正常发送仍落地文档 + 压栈", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()

    expect(写们.length).toBe(1)
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(150 130)")
    expect(按钮("hgraph-undo").disabled).toBe(false)
    expect(文案("hgraph-save-status")).toBe("已保存")
  })

  test("I-2 重载丢弃旧待发：重载后立即再拖 ⇒ 下一次写只含新操作", async () => {
    const 服 = 假服务端(一份图())
    挂轮询(服.api, { 轮询毫秒: 25 })
    await flush()

    // 先产生一笔未发出的旧待发（500ms 防抖窗口内），再让远端被外部改掉。
    拖(节点组("n1")!, 100, 100, 150, 130)
    服.设远端(外部改过的图(服.现图()), "a1")
    await 等(100)
    expect(取("[data-slot='hgraph-reload-ask']")).not.toBeNull()

    按钮("hgraph-reload-ask-reload").click()
    await flush()
    expect(节点组("n9")).not.toBeNull()

    // 重载后立刻再拖一次：旧待发必须已丢，下一次写只能有新操作。
    拖(节点组("n2")!, 200, 100, 230, 100)
    await 过防抖()

    expect(服.写们.length).toBe(1)
    const 操作们 = 服.写们[0].操作
    expect(操作们.length).toBe(1)
    const 第一 = 操作们[0]
    if (第一.操作 !== "移动") throw new Error(`期望移动操作，实得 ${第一.操作}`)
    expect(第一.目标.map((项) => 项.id)).toEqual(["n2"])
  })

  test("m-1 读在途时进入演示 ⇒ 应答回来不静默重载；退出演示后下一 tick 补上", async () => {
    const 服 = 假服务端(一份图(), { 读挂起: true })
    挂轮询(服.api, { 轮询毫秒: 25 })
    await flush()
    // 第一个 tick 的读已发出并挂住（在演示开始之前）。
    await 等(60)
    expect(服.读们.length).toBe(1)

    按钮("hgraph-toolbar-present").click()
    await flush()
    expect(取("[data-slot='hgraph-present']")).not.toBeNull()

    服.设远端(外部改过的图(服.现图()), "a1")
    服.解读()
    await 等(120)

    // 应答在演示中回来：不许换文档。
    expect(取("[data-slot='hgraph-present']")).not.toBeNull()
    expect(节点组("n9")).toBeNull()
    expect(文案("hgraph-reload-notice")).toBeUndefined()

    按键(取("[data-slot='hgraph-stage']")!, { key: "Escape" })
    await flush()
    await flush()
    await 等(150)
    expect(节点组("n9")).not.toBeNull()
  })

  test("卸载后轮询停止：读调用数不再增长（探针）", async () => {
    const 服 = 假服务端(一份图())
    挂轮询(服.api, { 轮询毫秒: 20 })
    await 等(80)
    const 卸载前 = 服.读们.length
    expect(卸载前).toBeGreaterThan(0)

    挂过的.pop()!()
    await 等(120)
    expect(服.读们.length).toBe(卸载前)
  })
})

// ---------------------------------------------------------------------------
// T016a · 逆操作接线（撤销/重做）与 AI 外部改动一步还原
// ---------------------------------------------------------------------------

/** 一条手写推断边（端点由调用方给）。 */
function 造边(id: string, 从: string, 到: string): 边 {
  return { id, 从, 到, 标签: "", 性质: "推断", 方向: "无向", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" } }
}

/** n4/n5/n6 三颗节点 + e1/e2（串起三颗）/e3（n1–n4，删 n4 会被级联带走）。 */
function 带边的图(): 图文件 {
  const 基 = 一份图()
  return {
    ...基,
    节点: [...基.节点, 造节点("n4", 400, 200), 造节点("n5", 500, 200), 造节点("n6", 600, 200)],
    边: [造边("e1", "n4", "n5"), 造边("e2", "n5", "n6"), 造边("e3", "n1", "n4")],
  }
}

const 节点数 = () => document.querySelectorAll("[data-slot='hgraph-node']").length
const 边数 = () => document.querySelectorAll("[data-slot='hgraph-edge']").length

describe("T016a · 撤销/重做与 AI 一步还原", () => {
  test("#6 重做应用 正操作：撤销写回原位、重做再写回新位（不是重发逆操作）", async () => {
    const { api, 写们 } = 假api()
    挂上(api)
    await flush()

    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()
    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([
      { 操作: "移动", 目标: [{ 类别: "节点", id: "n1", x: 150, y: 130 }] },
    ])

    // 撤销 ⇒ 写回旧坐标。
    按键(画布()!, { key: "z", ctrlKey: true })
    await 过防抖()
    expect(写们.length).toBe(2)
    expect(写们[1]!.操作).toEqual([
      { 操作: "移动", 目标: [{ 类别: "节点", id: "n1", x: 100, y: 100 }] },
    ])
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(100 100)")
    // 撤销触发的写不压新步 ⇒ 重做栈还在。
    expect((取("[data-slot='hgraph-redo']") as HTMLButtonElement).disabled).toBe(false)

    // 重做 ⇒ 应用 `正操作`（回到 150,130），不是把逆操作再发一次。
    按键(画布()!, { key: "z", ctrlKey: true, shiftKey: true })
    await 过防抖()
    expect(写们.length).toBe(3)
    expect(写们[2]!.操作).toEqual([
      { 操作: "移动", 目标: [{ 类别: "节点", id: "n1", x: 150, y: 130 }] },
    ])
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(150 130)")
    expect((取("[data-slot='hgraph-undo']") as HTMLButtonElement).disabled).toBe(false)
    expect((取("[data-slot='hgraph-redo']") as HTMLButtonElement).disabled).toBe(true)
  })

  test("#8 AI 删 3 节点（连带 3 条边）⇒ 一次 Ctrl+Z 整批还原：回原值、恰 1 次写", async () => {
    const 服 = 假服务端(带边的图())
    挂轮询(服.api, { 轮询毫秒: 25, 初始文档: 带边的图() })
    await flush()
    expect(节点数()).toBe(6)
    expect(边数()).toBe(3)

    const 删后 = { ...服.现图() }
    删后.节点 = 删后.节点.filter((点) => !["n4", "n5", "n6"].includes(点.id))
    删后.边 = 删后.边.filter((条) => !["e1", "e2", "e3"].includes(条.id))
    删后.更新于 = "2026-11-16T13:00:00+08:00"
    服.设远端(删后, "a1")
    await 等到条件(() => 节点组("n4") === null)
    await flush()

    expect(节点数()).toBe(3)
    expect(边数()).toBe(0)
    expect(按钮("hgraph-undo").disabled).toBe(false)

    按键(画布()!, { key: "z", ctrlKey: true })
    await 过防抖()

    // 整批一次回来：节点/边数回到删前具体值。
    expect(节点数()).toBe(6)
    expect(边数()).toBe(3)
    // 恰 1 次写（重载零写 + 撤销一次写），只含还原操作；原 id 加回（R93）。
    expect(服.写们.length).toBe(1)
    const 还原 = 服.写们[0]!.操作
    expect(还原.map((操作) => 操作.操作)).toEqual(["加节点", "加边"])
    const 加节点 = 还原[0]!
    if (加节点.操作 !== "加节点") throw new Error("不是加节点")
    expect(加节点.节点.map((行) => 行.id)).toEqual(["n4", "n5", "n6"])
    const 加边 = 还原[1]!
    if (加边.操作 !== "加边") throw new Error("不是加边")
    expect(加边.边.map((行) => `${行.id}:${行.从}-${行.到}`)).toEqual(["e1:n4-n5", "e2:n5-n6", "e3:n1-n4"])
    expect(按钮("hgraph-undo").disabled).toBe(true)
  })

  test("#9 失败批：只丢本批草稿，之前步仍可撤；飞行中新增的临时 id 不被清", async () => {
    const { api, 写们, 解 } = 闸门api()
    挂上(api)
    await flush()

    // 第一笔：n2 拖动，成功 ⇒ 栈里一步（失败后必须仍在）。
    拖(节点组("n2")!, 200, 100, 230, 100)
    await 过防抖()
    expect(写们.length).toBe(1)
    解(0, 成功("v2"))
    await flush()
    await flush()
    expect(按钮("hgraph-undo").disabled).toBe(false)

    // 第二笔：n1 拖动，应答挂住（飞行中）。
    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()
    expect(写们.length).toBe(2)

    // 飞行中再加一颗节点：它的临时 id 不在发送时快照里。
    ;(取("[data-slot='hgraph-toolbar-add-node']") as HTMLButtonElement).click()
    await flush()
    const 飞行中 = document.querySelector("[data-node-id^='临时']")
    expect(飞行中).not.toBeNull()

    // 第二笔失败：回滚到已接受值，但飞行中新增的节点/选中必须留着。
    解(1, { kind: "error", message: "写不进去", code: "INTERNAL" })
    await flush()
    await flush()

    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(100 100)")
    expect(document.querySelector("[data-node-id^='临时']")).not.toBeNull()
    expect(节点数()).toBe(4)
    expect(document.querySelector("[data-node-id^='临时']")!.getAttribute("data-selected")).toBe("true")
    expect(文案("hgraph-save-status")).toContain("没存上")

    // 之前那一步仍可撤：撤一次就到底（说明栈里恰好还是 1 步，失败批没有混进去）。
    expect(按钮("hgraph-undo").disabled).toBe(false)
    按键(画布()!, { key: "z", ctrlKey: true })
    await flush()
    expect(按钮("hgraph-undo").disabled).toBe(true)
    expect(节点组("n2")!.getAttribute("transform")).toBe("translate(200 100)")
    // 飞行中新增的节点不受撤销影响（它不在那一步里）。
    expect(document.querySelector("[data-node-id^='临时']")).not.toBeNull()
  })

  test("#11 撤销写失败 ⇒ 步骤放回撤销栈（可直接再按 Ctrl+Z 重试），不进重做栈", async () => {
    let 次 = 0
    const { api, 写们 } = 假api({
      写: () => {
        次 += 1
        if (次 === 2) return { kind: "error", message: "写不进去", code: "INTERNAL" }
        return 成功("v2")
      },
    })
    挂上(api)
    await flush()

    拖(节点组("n1")!, 100, 100, 150, 130)
    await 过防抖()
    expect(写们.length).toBe(1)
    const 撤销键 = 按钮("hgraph-undo")
    expect(撤销键.disabled).toBe(false)

    按键(画布()!, { key: "z", ctrlKey: true })
    await 过防抖()
    // 失败：文档回滚到已存（150,130），但这一步必须回到**撤销栈**——用户能直接再撤一次。
    expect(写们.length).toBe(2)
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(150 130)")
    expect(撤销键.disabled).toBe(false)
    expect(按钮("hgraph-redo").disabled).toBe(true)
    expect(文案("hgraph-save-status")).toContain("没存上")

    // 再按一次 Ctrl+Z：直接重试（不是先按重做把步挪回来）。
    按键(画布()!, { key: "z", ctrlKey: true })
    await 过防抖()
    expect(写们.length).toBe(3)
    expect(写们[2]!.操作).toEqual([
      { 操作: "移动", 目标: [{ 类别: "节点", id: "n1", x: 100, y: 100 }] },
    ])
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(100 100)")
  })

  test("#12 成功应答后选中收口：已不存在的 id 清掉、仍在的保留（R81 成功路径）", async () => {
    let 次 = 0
    const { api } = 假api({
      写: (输入) => {
        次 += 1
        if (次 > 1) return 成功("v2")
        const 加 = 输入.操作[0]!
        if (加.操作 !== "加节点") throw new Error("期望加节点")
        return 成功("v2", { [String(加.节点[0]!.id)]: "n7" })
      },
    })
    挂上(api)
    await flush()

    // 加一颗节点（临时 id 立刻被选中），成功后映射成 n7。
    ;(取("[data-slot='hgraph-toolbar-add-node']") as HTMLButtonElement).click()
    await 过防抖()
    await flush()
    await flush()
    expect(节点组("n7")).not.toBeNull()
    expect(节点组("n7")!.getAttribute("data-selected")).toBe("true")

    // 再 Shift 点选 n1：选中 = [n7, n1]。撤销「加节点」后 n7 不再存在，n1 必须留着。
    点选("n1", 100, 100, { shiftKey: true })
    await flush()
    expect(document.querySelectorAll("[data-slot='hgraph-node'][data-selected='true']").length).toBe(2)

    按键(画布()!, { key: "z", ctrlKey: true })
    await 过防抖()
    await flush()

    expect(节点组("n7")).toBeNull()
    const 选中们 = [...document.querySelectorAll("[data-slot='hgraph-node'][data-selected='true']")]
    expect(选中们.map((元素) => 元素.getAttribute("data-node-id"))).toEqual(["n1"])
    // 选中集合里不能再留着 n7：否则「已选 2 个」⇒ 批量对齐可用（DOM 上已看不出这颗节点）。
    expect(按钮("hgraph-toolbar-align-左").disabled).toBe(true)
    expect(按钮("hgraph-undo").disabled).toBe(true)
  })

  test("R94 AI 改了白名单外字段（来源）⇒ 不压栈、撤销不可用、提示不能自动撤销", async () => {
    const 服 = 假服务端(一份图())
    挂轮询(服.api, { 轮询毫秒: 25 })
    await flush()

    const 改后 = {
      ...服.现图(),
      更新于: "2026-11-16T13:30:00+08:00",
      节点: 服.现图().节点.map((点) =>
        点.id === "n1" ? { ...点, 来源: { kind: "实体" as const, 实体: "e9", 值: "n1" } } : 点,
      ),
    }
    服.设远端(改后, "a1")
    await 等到条件(() => 文案("hgraph-undo-notice") !== undefined)
    await flush()

    expect(文案("hgraph-undo-notice")).toBe("AI 的改动中有不能自动撤销的部分")
    expect(按钮("hgraph-undo").disabled).toBe(true)
    // 重载本身仍发生、零写盘（写回旧状态会让「看得见 AI 的改动」失效）。
    expect(取("[data-slot='hgraph-reload-notice']")).not.toBeNull()
    await 过防抖()
    expect(服.写们.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// T014 · 从库加入 + 检查器接线（快照 / 刷新 / 打开档案）
// ---------------------------------------------------------------------------

/** 本地时区当天中午的秒数（`日期文本` 按本地时区格式化）。 */
const 秒 = (年: number, 月: number, 日: number) => new Date(年, 月 - 1, 日, 12).getTime() / 1000
const T014落定 = async () => {
  await flush()
  await flush()
}

function 档案关系(首: number | null, 末: number | null): 档案关系 {
  return {
    id: `r-${首}-${末}`,
    type: "转账",
    方向: "出",
    对方id: "x",
    对方值: "x",
    对方类型: "人",
    对方细类: null,
    source_kind: "交易",
    basis: null,
    trust_state: "已确认",
    首,
    末,
    次数: 1,
    金额: null,
  }
}

function 档案(补丁: Partial<实体档案> & { id: string }): 实体档案 {
  return {
    type: "人",
    canonical_value: 补丁.id,
    aliases: [],
    attrs: {},
    trust_state: "已确认",
    created_at: 0,
    关系: [],
    事件: [],
    关系总数: 0,
    关系数据总数: 0,
    关系人总数: 0,
    事件总数: 0,
    对方数: 0,
    引用: [],
    引用总数: 0,
    待确认: { 实体: 0, 关系: 0, 事件: 0, 合计: 0 },
    一句话: "",
    ...补丁,
  }
}

type 档案返回 = Awaited<ReturnType<CaseDetailApi["profile"]>>

/** profile 替身：`换回应` 让用例中途换「库里的新状态」（刷新场景）。 */
function 假详情(初始: (id: string) => 档案返回) {
  const 调用: Array<[string, string]> = []
  let 回应 = 初始
  const api: Pick<CaseDetailApi, "profile"> = {
    profile: async (projectId, id) => {
      调用.push([projectId, id])
      return await 回应(id)
    },
  }
  return {
    api,
    调用,
    换回应(新回应: (id: string) => 档案返回) {
      回应 = 新回应
    },
  }
}

function 假实体(行们: 实体清单项[]) {
  const 调用: Array<Parameters<EntityApi["list"]>[0]> = []
  const api: Pick<EntityApi, "list"> = {
    list: async (input) => {
      调用.push(input)
      return { kind: "ok", value: { 行们, 总数: 行们.length, 缺口: [] } }
    },
  }
  return { api, 调用 }
}

/** 一颗已绑库节点 + 一颗手写节点 + 一颗锁定节点：选中切换用。 */
function 绑定图(补丁: Partial<节点> = {}): 图文件 {
  return {
    ...一份图(),
    节点: [
      造节点("n1", 100, 100, {
        名称: "张三",
        类型: "人",
        来源: { kind: "实体", 实体: "e1", 值: "张三" },
        属性: [{ 键: "A", 值: "1" }],
        ...补丁,
      }),
      造节点("n2", 200, 100),
      造节点("n3", 300, 100, { 锁定: true }),
    ],
    文字: [造文字("t1", "备注", 50, 50)],
  }
}

/** T014 专用挂载：多三条接缝（实体api / 详情api / 打开档案）。 */
function 挂详情(选项: {
  api: HgraphApi
  初始文档?: 图文件
  详情api?: Pick<CaseDetailApi, "profile">
  实体api?: Pick<EntityApi, "list">
  打开档案?: (实体id: string, 标题: string) => void
}) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(
    render(
      () => (
        <编辑器
          path="分析/测试图.hgraph"
          projectId="p 1"
          api={选项.api}
          初始文档={选项.初始文档 ?? 绑定图()}
          初始版本="v1"
          坐标换算={({ clientX, clientY }) => ({ x: clientX, y: clientY })}
          详情api={选项.详情api}
          实体api={选项.实体api}
          打开档案={选项.打开档案}
        />
      ),
      host,
    ),
  )
}

const 选择器面板 = () => 取("[data-slot='hgraph-entity-picker']")

describe("T014 · 检查器快照接线", () => {
  test("#8 选中已绑节点 ⇒ fetch profile 恰 1 次；库里的值/类型/可信态/时间都在；零写盘", async () => {
    const 写 = 假api()
    const 详情 = 假详情((id) =>
      id === "e1"
        ? {
            kind: "ok",
            value: 档案({
              id: "e1",
              canonical_value: "张三",
              type: "人",
              subtype: "嫌疑人",
              trust_state: "已确认",
              关系: [档案关系(秒(2025, 12, 1), 秒(2026, 3, 1))],
            }),
          }
        : { kind: "error", message: "不该取别的实体" },
    )
    挂详情({ api: 写.api, 详情api: 详情.api })
    await flush()

    点选("n1", 100, 100)
    await T014落定()

    expect(详情.调用).toEqual([["p 1", "e1"]])
    expect(文案("hgraph-snapshot-值")).toBe("张三")
    expect(文案("hgraph-snapshot-类型")).toBe("人 · 嫌疑人")
    expect(文案("hgraph-snapshot-可信态")).toBe("已确认")
    expect(文案("hgraph-snapshot-时间")).toBe("2025-12-01 ~ 2026-03-01")

    // 切走再切回：缓存按实体 id，不重复取。
    点选("n2", 200, 100)
    await T014落定()
    点选("n1", 100, 100)
    await T014落定()
    expect(详情.调用.length).toBe(1)

    await 过防抖()
    expect(写.写们.length).toBe(0)
  })

  test("#9 改名后重开（文档「张三」 vs 库「张三丰」）⇒ diff 句出现；零写盘", async () => {
    const 写 = 假api()
    const 详情 = 假详情(() => ({
      kind: "ok",
      value: 档案({ id: "e1", canonical_value: "张三丰", type: "人" }),
    }))
    挂详情({ api: 写.api, 详情api: 详情.api })
    await flush()

    点选("n1", 100, 100)
    await T014落定()

    expect(文案("hgraph-snapshot-diff")).toBe("文件里记的是「张三」，库里现在是「张三丰」")
    await 过防抖()
    expect(写.写们.length).toBe(0)
  })

  test("#10 库里没有（合并/删除，profile 404）⇒「这条不在库里」；零写盘", async () => {
    const 写 = 假api()
    const 详情 = 假详情(() => ({ kind: "error", message: "实体不存在", code: "NOT_FOUND" }))
    挂详情({ api: 写.api, 详情api: 详情.api })
    await flush()

    点选("n1", 100, 100)
    await T014落定()

    expect(文案("hgraph-snapshot-empty")).toBe("这条不在库里")
    await 过防抖()
    expect(写.写们.length).toBe(0)
  })

  test("#10b 库里已排除：可信态行显示排除字样；只加角标不改文件（零写盘）", async () => {
    const 写 = 假api()
    const 详情 = 假详情(() => ({
      kind: "ok",
      value: 档案({ id: "e1", canonical_value: "张三", trust_state: "已排除" }),
    }))
    挂详情({ api: 写.api, 详情api: 详情.api })
    await flush()

    点选("n1", 100, 100)
    await T014落定()

    expect(文案("hgraph-snapshot-可信态")).toBe("已排除")
    await 过防抖()
    expect(写.写们.length).toBe(0)
  })
})

describe("T014 · 刷新此节点（R61）", () => {
  test("#11 库名已改 ⇒ 恰 1 条「改字段 {名称}」；属性不写回；一致时零写 + 「与库一致」", async () => {
    const 写 = 假api()
    const 详情 = 假详情(() => ({
      kind: "ok",
      value: 档案({ id: "e1", canonical_value: "张三", type: "人", attrs: { 开户行: "招商银行" } }),
    }))
    挂详情({ api: 写.api, 详情api: 详情.api })
    await flush()

    点选("n1", 100, 100)
    await T014落定()
    expect(文案("hgraph-snapshot-值")).toBe("张三")

    // 库里改名（类型不变、没细类）。
    详情.换回应(() => ({
      kind: "ok",
      value: 档案({ id: "e1", canonical_value: "张三丰", type: "人", attrs: { 开户行: "招商银行" } }),
    }))
    按钮("hgraph-snapshot-refresh").click()
    await T014落定()
    await 过防抖()

    expect(写.写们.length).toBe(1)
    expect(写.写们[0]!.操作).toEqual([
      { 操作: "改字段", 目标: [{ 类别: "节点", id: "n1", 补丁: { 名称: "张三丰" } }] },
    ])
    // 属性是只读快照：文档里的「A：1」一字不动。
    expect(文案("hgraph-readonly-属性")).toContain("A：1")
    expect(文案("hgraph-refresh-note")).toBe("属性/出处/时间只读，未写回")
    // 刷新只取一次：写回补丁改文档不该把选中 effect 再拨醒去取第二遍。
    expect(详情.调用.length).toBe(2)

    // 再刷一次：库与文件已一致 ⇒ 零写 + 「与库一致」。
    按钮("hgraph-snapshot-refresh").click()
    await T014落定()
    await 过防抖()
    expect(写.写们.length).toBe(1)
    expect(文案("hgraph-refresh-note")).toBe("与库一致")
  })
})

describe("T014 修复轮 1 · 刷新按选中节点定位（R91）", () => {
  test("R91-1 两颗同来源 e1：刷新改的是选中的第二颗，第一颗不动", async () => {
    const 写 = 假api()
    const 详情 = 假详情(() => ({
      kind: "ok",
      value: 档案({ id: "e1", canonical_value: "张三丰", type: "人" }),
    }))
    const 图: 图文件 = {
      ...一份图(),
      节点: [
        造节点("n1", 100, 100, {
          名称: "张三",
          类型: "人",
          来源: { kind: "实体", 实体: "e1", 值: "张三" },
        }),
        造节点("n2", 200, 100, {
          名称: "李四",
          类型: "人",
          来源: { kind: "实体", 实体: "e1", 值: "李四" },
        }),
      ],
    }
    挂详情({ api: 写.api, 初始文档: 图, 详情api: 详情.api })
    await flush()

    点选("n2", 200, 100)
    await T014落定()

    按钮("hgraph-snapshot-refresh").click()
    await T014落定()
    await 过防抖()

    // 补丁必须落在**选中的** n2；旧实现按「第一颗匹配 e1」会改写 n1。
    expect(写.写们.length).toBe(1)
    expect(写.写们[0]!.操作).toEqual([
      { 操作: "改字段", 目标: [{ 类别: "节点", id: "n2", 补丁: { 名称: "张三丰" } }] },
    ])

    // 第一颗的文档值原样：选它看一眼，仍是「张三」。
    点选("n1", 100, 100)
    await T014落定()
    expect((取("[data-slot='hgraph-field-名称']") as HTMLInputElement).value).toBe("张三")
  })

  test("R91-1b 刷新途中选中换成别的实体节点 ⇒ 回落「第一颗匹配」", async () => {
    const 写 = 假api()
    const 详情 = 假详情((id) =>
      id === "e1"
        ? { kind: "ok", value: 档案({ id: "e1", canonical_value: "张三丰", type: "人" }) }
        : { kind: "ok", value: 档案({ id, canonical_value: "王五", type: "人" }) },
    )
    const 图: 图文件 = {
      ...一份图(),
      节点: [
        造节点("n1", 100, 100, {
          名称: "张三",
          类型: "人",
          来源: { kind: "实体", 实体: "e1", 值: "张三" },
        }),
        造节点("n2", 200, 100, {
          名称: "李四",
          类型: "人",
          来源: { kind: "实体", 实体: "e1", 值: "李四" },
        }),
        造节点("n3", 300, 100, {
          名称: "王五",
          类型: "人",
          来源: { kind: "实体", 实体: "e5", 值: "王五" },
        }),
      ],
    }
    挂详情({ api: 写.api, 初始文档: 图, 详情api: 详情.api })
    await flush()

    点选("n2", 200, 100)
    await T014落定()

    // 点刷新的那一刻回调带 e1；档案应答落地前把选中切到 n3（来源 e5）。
    按钮("hgraph-snapshot-refresh").click()
    点选("n3", 300, 100)
    await T014落定()
    await 过防抖()

    // 选中与回调实体不符 ⇒ 回落第一颗来源 e1 的节点 n1（不是 n3、也不是 n2）。
    expect(写.写们.length).toBe(1)
    expect(写.写们[0]!.操作).toEqual([
      { 操作: "改字段", 目标: [{ 类别: "节点", id: "n1", 补丁: { 名称: "张三丰" } }] },
    ])
  })
})

describe("T014 · 打开档案（R63）", () => {
  test("#12 注入回调：点按钮收到 (实体id, '名称 · 类型') 恰 1 次", async () => {
    const 写 = 假api()
    const 收到: Array<[string, string]> = []
    挂详情({ api: 写.api, 打开档案: (id, 标题) => 收到.push([id, 标题]) })
    await flush()

    点选("n1", 100, 100)
    await T014落定()

    按钮("hgraph-open-archive").click()
    expect(收到).toEqual([["e1", "张三 · 人"]])
  })
})

describe("T014 · 从库加入接线", () => {
  test("工具栏「从库加入」→ 选择器 → 加入：一个批次的「加节点」，新节点被选中", async () => {
    const 写 = 假api()
    const 实体 = 假实体([
      {
        id: "e1",
        type: "人",
        subtype: "嫌疑人",
        canonical_value: "张三",
        trust_state: "已确认",
        关联数: 1,
        事件参与数: 0,
        权重: 0,
        分组: "核心",
        created_at: 0,
      },
    ])
    const 详情 = 假详情(() => ({
      kind: "ok",
      value: 档案({ id: "e1", canonical_value: "张三", type: "人", subtype: "嫌疑人", attrs: { 开户行: "招商银行" } }),
    }))
    挂详情({ api: 写.api, 初始文档: 一份图(), 实体api: 实体.api, 详情api: 详情.api })
    await flush()

    按钮("hgraph-toolbar-from-library").click()
    await T014落定()
    expect(选择器面板()).not.toBeNull()

    const 框 = 取("[data-slot='hgraph-picker-check'][data-entity-id='e1']") as HTMLInputElement
    框.checked = true
    框.dispatchEvent(new Event("change", { bubbles: true }))
    按钮("hgraph-picker-add").click()
    await T014落定()
    await 过防抖()

    // 一次批量、一次撤销：写请求恰 1 次，里面只 1 条「加节点」。
    expect(写.写们.length).toBe(1)
    const 操作们 = 写.写们[0]!.操作
    expect(操作们.length).toBe(1)
    expect(操作们[0]!.操作).toBe("加节点")
    if (操作们[0]!.操作 !== "加节点") throw new Error("形状不对")
    expect(操作们[0]!.节点.length).toBe(1)
    expect(操作们[0]!.节点[0]).toMatchObject({ 名称: "张三", 类型: "人", 细类: "嫌疑人", 出处: [] })

    // 面板收起，新节点被选中（检查器可编辑区显示它的名称）。
    expect(选择器面板()).toBeNull()
    expect(document.body.querySelectorAll("[data-slot='hgraph-node']").length).toBe(4)
    expect((取("[data-slot='hgraph-field-名称']") as HTMLInputElement).value).toBe("张三")
  })
})

// ---------------------------------------------------------------------------
// T015 · 导出 PNG（工具栏入口 → 选项面板 → 导出PNG）
// ---------------------------------------------------------------------------

describe("T015 · 导出 PNG 面板", () => {
  // 文件名去重记录是模块级会话状态：不重置，上一条用例的同名下载会让这条变成 `-2`。
  beforeEach(() => 重置导出记录())

  const 按钮 = (slot: string) => document.body.querySelector<HTMLButtonElement>(`[data-slot='${slot}']`)

  /** 一个许可可用的 api：`写` 照常记账，`导出许可` 按剧本回。 */
  function 导出api(
    许可: HgraphApi["导出许可"] = async () => ({
      kind: "ok",
      value: { 允许: true, 文件名: "专案A-测试图-20261116-1003.png" },
    }),
  ) {
    const 写们: 写入参[] = []
    let 许可次数 = 0
    const api: HgraphApi = {
      读: async () => {
        throw new Error("编辑器不该自己读文件")
      },
      初始化: async () => {
        throw new Error("编辑器不该 init")
      },
      写: async (输入) => {
        写们.push(输入)
        return 成功("v2")
      },
      导出许可: async (输入) => {
        许可次数 += 1
        return await 许可(输入)
      },
    }
    return { api, 写们, 许可次数: () => 许可次数 }
  }

  /** 记账依赖：happy-dom 没有 canvas/Image ⇒ 光栅化注入；下载只记文件名。 */
  function 记账依赖() {
    const 下载们: string[] = []
    const 光栅化们: Array<{ readonly svg: string; readonly 宽: number; readonly 高: number }> = []
    const 依赖: 导出依赖 = {
      解析变量: () => "#111111",
      根字体: () => "Test Sans",
      现在: () => new Date("2026-11-16T10:03:00+08:00"),
      光栅化: async (svg, 宽, 高) => {
        光栅化们.push({ svg, 宽, 高 })
        return new Blob(["png"], { type: "image/png" })
      },
      下载: (文件名) => 下载们.push(文件名),
    }
    return { 依赖, 下载们, 光栅化们 }
  }

  function 挂导出(api: HgraphApi, 依赖: 导出依赖) {
    const host = document.createElement("div")
    document.body.appendChild(host)
    挂过的.push(
      render(
        () => (
          <编辑器
            path="分析/测试图.hgraph"
            projectId="p 1"
            api={api}
            初始文档={一份图()}
            初始版本="v1"
            坐标换算={({ clientX, clientY }) => ({ x: clientX, y: clientY })}
            项目名="专案A"
            导出人="王警官"
            导出依赖={依赖}
          />
        ),
        host,
      ),
    )
    return host
  }

  test("工具栏「导出 PNG」只开选项面板：零写、不进撤销栈；取消只收起", async () => {
    const { api, 写们 } = 导出api()
    const { 依赖, 下载们 } = 记账依赖()
    挂导出(api, 依赖)

    expect(取("[data-slot='hgraph-export-panel']")).toBeNull()
    按钮("hgraph-toolbar-export")!.click()
    expect(取("[data-slot='hgraph-export-panel']")).not.toBeNull()
    expect(按钮("hgraph-undo")!.disabled).toBe(true)

    await 过防抖()
    expect(写们.length).toBe(0)
    expect(下载们).toEqual([])

    按钮("hgraph-export-cancel")!.click()
    expect(取("[data-slot='hgraph-export-panel']")).toBeNull()
    expect(下载们).toEqual([])
  })

  test("点「导出」⇒ 许可后光栅化并下载：文件名取许可值、提示「已记录本次导出」、面板收起、零写", async () => {
    const { api, 写们, 许可次数 } = 导出api()
    const { 依赖, 下载们, 光栅化们 } = 记账依赖()
    挂导出(api, 依赖)

    按钮("hgraph-toolbar-export")!.click()
    按钮("hgraph-export-ok")!.click()
    await flush()
    await flush()

    expect(许可次数()).toBe(1)
    expect(光栅化们.length).toBe(1)
    expect(下载们).toEqual(["专案A-测试图-20261116-1003.png"])
    expect(文案("hgraph-export-status")).toBe("已记录本次导出")
    expect(取("[data-slot='hgraph-export-panel']")).toBeNull()
    expect(写们.length).toBe(0)
  })

  test("尺寸 A3 / 标题块 / 附附录 都传下去：宽高 3508×4961、标题含项目与导出人、第二个下载是 .md", async () => {
    const { api } = 导出api()
    const { 依赖, 下载们, 光栅化们 } = 记账依赖()
    挂导出(api, 依赖)

    按钮("hgraph-toolbar-export")!.click()
    const 尺寸 = 取("[data-slot='hgraph-export-size']") as HTMLSelectElement
    尺寸.value = "A3"
    尺寸.dispatchEvent(new Event("change", { bubbles: true }))
    const 标题块 = 取("[data-slot='hgraph-export-title-block']") as HTMLInputElement
    标题块.checked = true
    标题块.dispatchEvent(new Event("change", { bubbles: true }))
    const 附录 = 取("[data-slot='hgraph-export-appendix']") as HTMLInputElement
    附录.checked = true
    附录.dispatchEvent(new Event("change", { bubbles: true }))

    按钮("hgraph-export-ok")!.click()
    await flush()
    await flush()

    expect(光栅化们.length).toBe(1)
    expect(光栅化们[0]).toMatchObject({ 宽: 3508, 高: 4961 })
    expect(光栅化们[0]!.svg).toContain("专案A")
    expect(光栅化们[0]!.svg).toContain("测试图")
    expect(光栅化们[0]!.svg).toContain("王警官")
    expect(下载们).toEqual(["专案A-测试图-20261116-1003.png", "专案A-测试图-20261116-1003.md"])
  })

  test("许可失败 ⇒ 提示用接口 message、零光栅化零下载，面板仍开着", async () => {
    const { api } = 导出api(async () => ({ kind: "error", message: "你不是这个项目的成员" }))
    const { 依赖, 下载们, 光栅化们 } = 记账依赖()
    挂导出(api, 依赖)

    按钮("hgraph-toolbar-export")!.click()
    按钮("hgraph-export-ok")!.click()
    await flush()
    await flush()

    expect(文案("hgraph-export-status")).toBe("你不是这个项目的成员")
    expect(光栅化们.length).toBe(0)
    expect(下载们).toEqual([])
    expect(取("[data-slot='hgraph-export-panel']")).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// T016b · 合并节点 / 复制粘贴（R79 / R80 / R96 / R97）
// ---------------------------------------------------------------------------

/** n1、n2 都带来源/出处，n3 作集外端点；三条边里只有 e1 两端都在 {n1,n2}。 */
function 合并图(): 图文件 {
  return {
    ...一份图(),
    节点: [
      造节点("n1", 100, 100, {
        名称: "张三",
        备注: "甲备注",
        出处: ["甲"],
        来源: { kind: "实体", 实体: "x1", 值: "张三" },
      }),
      造节点("n2", 200, 100, {
        名称: "李四",
        备注: "乙备注",
        出处: ["乙"],
        来源: { kind: "实体", 实体: "x2", 值: "李四" },
      }),
      造节点("n3", 300, 100, { 名称: "王五" }),
    ],
    边: [造边("e1", "n1", "n2"), 造边("e2", "n2", "n3"), 造边("e3", "n3", "n1")],
    文字: [],
  }
}

/** 应答映射：本批所有「临时」节点/边换成正式 id（模拟服务端 `映射`）。 */
function 副本映射(输入: 写入参, 节根 = 8, 边根 = 8): Record<string, string> {
  const 映射: Record<string, string> = {}
  let 节 = 节根
  let 边 = 边根
  for (const 操作 of 输入.操作) {
    if (操作.操作 === "加节点") {
      for (const 行 of 操作.节点) {
        if (typeof 行.id === "string" && 行.id.startsWith("临时")) 映射[行.id] = `n${++节}`
      }
    }
    if (操作.操作 === "加边") {
      for (const 行 of 操作.边) {
        if (typeof 行.id === "string" && 行.id.startsWith("临时")) 映射[行.id] = `e${++边}`
      }
    }
  }
  return 映射
}

const 节点标签们 = () =>
  [...document.querySelectorAll("[data-slot='hgraph-node-label']")].map((元素) => 元素.textContent?.trim() ?? "")

const 边线们 = () =>
  [...document.querySelectorAll("[data-slot='hgraph-edge-line']")].map((元素) => [
    Number(元素.getAttribute("x1")),
    Number(元素.getAttribute("y1")),
    Number(元素.getAttribute("x2")),
    Number(元素.getAttribute("y2")),
  ])

describe("T016b · 合并节点", () => {
  test("#12 合并后端点指向保留者（断言具体 id）；一次撤销按名称/字段还原，重做保持禁用（R96）", async () => {
    const { api, 写们 } = 假api({
      写: (输入) => {
        if (输入.操作.some((操作) => 操作.操作 === "合并节点")) return 成功("v2")
        return 成功("v3", 副本映射(输入, 7, 6))
      },
    })
    挂上(api, 合并图())
    await flush()

    点选("n1", 100, 100)
    点选("n2", 200, 100, { shiftKey: true })
    await flush()
    const 合并 = 按钮("hgraph-toolbar-merge")
    expect(合并.disabled).toBe(false)
    合并.click()
    await flush()
    expect(文案("hgraph-merge-confirm")).toContain("合并到「张三」？")

    按钮("hgraph-merge-confirm-ok")!.click()
    await 过防抖()

    // 整批一次写：保留者 n1，并入 n2（不含保留者）。
    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([{ 操作: "合并节点", 保留: "n1", 并入: ["n2"] }])
    expect(节点数()).toBe(2)
    expect(边数()).toBe(3)
    // 端点重指：三条边全部落在 n1/n3 之间（本地乐观应用后位置反映这一点）。
    // T018：线从节点边缘外起止（+17 / −20）；e1 变成 n1 自环（长度 0）⇒ 不画线
    // （组仍在，所以 `边数` 是 3）；e2/e3 是同一无向对 ⇒ e3 按 8px 偏移错开。
    expect(边线们()).toEqual([
      [117, 100, 280, 100], // e2 n2→n3 改指 n1
      [283, 92, 120, 92], // e3 不变（与 e2 平行，法线反向 ⇒ 另一侧 8px）
    ])

    // 撤销：逆操作 = 删保留者 + 加节点副本 + 加边副本；应答把临时 id 换正式 id。
    按键(画布()!, { key: "z", ctrlKey: true })
    await 过防抖()
    await flush()
    await flush()

    expect(写们.length).toBe(2)
    expect(写们[1]!.操作.map((操作) => 操作.操作)).toEqual(["删对象", "加节点", "加边"])

    // 按名称/坐标逐一还原（不断言 id：合并逆操作会重建 id，R79/R96）。
    expect(节点数()).toBe(3)
    expect(节点标签们().sort()).toEqual(["张三", "李四", "王五"].sort())
    expect(边数()).toBe(3)
    // T018：边从节点边缘外起止（起 +17、终 −20）；三条边各自不同端点对 ⇒ 无偏移。
    expect(边线们()).toEqual([
      [117, 100, 180, 100],
      [217, 100, 280, 100],
      [283, 100, 120, 100],
    ])
    // R96：合并步的逆操作会重建 id ⇒ 撤销后不提供重做（重做为必然打空的写）。
    expect(按钮("hgraph-redo").disabled).toBe(true)
  })

  test("I2 合并本地并集：出处并集、备注「；」连接、来源.并入 追加（复制即观测）+ 选中收口/确认条收起", async () => {
    const { api, 写们 } = 假api({
      写: (输入) => {
        if (输入.操作.some((操作) => 操作.操作 === "合并节点")) return 成功("v2")
        return 成功("v3", 副本映射(输入, 20, 20))
      },
    })
    挂上(api, 合并图())
    await flush()

    点选("n1", 100, 100)
    点选("n2", 200, 100, { shiftKey: true })
    await flush()
    按钮("hgraph-toolbar-merge").click()
    await flush()
    按钮("hgraph-merge-confirm-ok")!.click()
    await 过防抖()

    // M2：确认条收起、选中收口到保留者 n1。
    expect(取("[data-slot='hgraph-merge-confirm']")).toBeNull()
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")

    // 本地乐观应用已把 n2 的 出处/备注/来源 并进保留者；Ctrl+D 复制保留者即把本地字段写进请求体。
    按键(画布()!, { key: "d", ctrlKey: true })
    await 过防抖()

    expect(写们.length).toBe(2)
    const 加节点 = 写们[1]!.操作[0]!
    if (加节点.操作 !== "加节点") throw new Error("期望加节点")
    expect(加节点.节点).toHaveLength(1)
    expect(加节点.节点[0]!.名称).toBe("张三副本")
    expect(加节点.节点[0]!.出处).toEqual(["甲", "乙"])
    expect(加节点.节点[0]!.备注).toBe("甲备注；乙备注")
    expect(加节点.节点[0]!.来源).toEqual({ kind: "实体", 实体: "x1", 值: "张三", 并入: ["x2"] })
  })

  test("M3 一次撤销后，被并入节点的 来源/出处 在集成层逐字还原", async () => {
    const { api, 写们 } = 假api({
      写: (输入) => {
        if (输入.操作.some((操作) => 操作.操作 === "合并节点")) return 成功("v2")
        if (输入.操作.some((操作) => 操作.操作 === "删对象")) return 成功("v3", 副本映射(输入, 7, 6))
        return 成功("v4", 副本映射(输入, 20, 20))
      },
    })
    挂上(api, 合并图())
    await flush()

    点选("n1", 100, 100)
    点选("n2", 200, 100, { shiftKey: true })
    await flush()
    按钮("hgraph-toolbar-merge").click()
    await flush()
    按钮("hgraph-merge-confirm-ok")!.click()
    await 过防抖()

    按键(画布()!, { key: "z", ctrlKey: true })
    await 过防抖()
    await flush()
    await flush()

    // 还原后 id 已重建（R79）：按名称找到「李四」，点选后 Ctrl+D 复制，请求体带出还原的字段。
    const 李四组 = [...document.querySelectorAll("[data-slot='hgraph-node']")].find(
      (元素) => 元素.querySelector("[data-slot='hgraph-node-label']")?.textContent?.trim() === "李四",
    )
    expect(李四组).toBeDefined()
    const 李四id = 李四组!.getAttribute("data-node-id")!
    点选(李四id, 200, 100)
    await flush()
    按键(画布()!, { key: "d", ctrlKey: true })
    await 过防抖()

    expect(写们.length).toBe(3)
    const 加节点 = 写们[2]!.操作[0]!
    if (加节点.操作 !== "加节点") throw new Error("期望加节点")
    expect(加节点.节点[0]!.名称).toBe("李四副本")
    expect(加节点.节点[0]!.出处).toEqual(["乙"])
    expect(加节点.节点[0]!.来源).toEqual({ kind: "实体", 实体: "x2", 值: "李四" })
  })

  test("#16 合并按钮：选中 1 个 disabled、2 个可用；确认条文案含保留者；取消零写；保留者下拉可改", async () => {
    const { api, 写们 } = 假api()
    挂上(api, 合并图())
    await flush()

    const 合并 = 按钮("hgraph-toolbar-merge")
    expect(合并.disabled).toBe(true)
    点选("n1", 100, 100)
    await flush()
    expect(合并.disabled).toBe(true)
    点选("n2", 200, 100, { shiftKey: true })
    await flush()
    expect(合并.disabled).toBe(false)

    // 默认保留者 = 选中中文档顺序第一（n1 = 张三）。
    合并.click()
    await flush()
    expect(文案("hgraph-merge-confirm")).toContain("合并到「张三」？")
    expect(取("[data-slot='hgraph-merge-confirm']")).not.toBeNull()

    // 取消 ⇒ 收起、零写。
    按钮("hgraph-merge-confirm-cancel")!.click()
    await flush()
    expect(取("[data-slot='hgraph-merge-confirm']")).toBeNull()
    await 过防抖()
    expect(写们.length).toBe(0)

    // 再开，下拉改保留者为 n2（李四）。
    合并.click()
    await flush()
    const 下拉 = 取("[data-slot='hgraph-merge-keeper']") as HTMLSelectElement
    expect([...下拉.options].map((项) => 项.value)).toEqual(["n1", "n2"])
    下拉.value = "n2"
    下拉.dispatchEvent(new Event("change", { bubbles: true }))
    await flush()
    expect(文案("hgraph-merge-confirm")).toContain("合并到「李四」？")

    按钮("hgraph-merge-confirm-ok")!.click()
    await 过防抖()
    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([{ 操作: "合并节点", 保留: "n2", 并入: ["n1"] }])
  })
})

describe("T016b · 复制粘贴", () => {
  test("#14 Ctrl+C 零写；Ctrl+V 偏移 24、名称加「副本」、只带两端在选区的边", async () => {
    const { api, 写们 } = 假api({ 写: (输入) => 成功("v2", 副本映射(输入)) })
    挂上(api, 合并图())
    await flush()

    点选("n1", 100, 100)
    点选("n2", 200, 100, { shiftKey: true })
    await flush()

    按键(画布()!, { key: "c", ctrlKey: true })
    await 过防抖()
    expect(写们.length).toBe(0)

    按键(画布()!, { key: "v", ctrlKey: true })
    await 过防抖()
    expect(写们.length).toBe(1)
    const 操作 = 写们[0]!.操作
    expect(操作.map((条) => 条.操作)).toEqual(["加节点", "加边"])
    const 加节点 = 操作[0]!
    if (加节点.操作 !== "加节点") throw new Error("期望加节点")
    expect(加节点.节点.map((行) => 行.名称)).toEqual(["张三副本", "李四副本"])
    expect(加节点.节点.map((行) => [行.x, 行.y])).toEqual([
      [124, 124],
      [224, 124],
    ])
    const 加边 = 操作[1]!
    if (加边.操作 !== "加边") throw new Error("期望加边")
    // e1 两端都在选区；e2/e3 只有一端 ⇒ 不复制。
    expect(加边.边).toHaveLength(1)

    await flush()
    await flush()
    expect(节点数()).toBe(5)
    expect(边数()).toBe(4)
    expect(节点标签们()).toEqual(expect.arrayContaining(["张三副本", "李四副本"]))
    // 应答映射后画面上不能再留下临时 id（前缀选择器：临时 id 实际是 临时c1/临时c2…）。
    expect(取("[data-slot='hgraph-node'][data-node-id^='临时c']")).toBeNull()
    // 粘贴后选中新节点（应答映射把临时 id 换成正式 id）。
    const 选中们 = [...document.querySelectorAll("[data-slot='hgraph-node'][data-selected='true']")]
    expect(选中们.map((元素) => 元素.getAttribute("data-node-id"))).toEqual(["n9", "n10"])
  })

  test("#15 Ctrl+D 偏移 0（原地复制），与 Ctrl+V 的 24 分开断言", async () => {
    const { api, 写们 } = 假api({ 写: (输入) => 成功("v2", 副本映射(输入)) })
    挂上(api, 合并图())
    await flush()

    点选("n1", 100, 100)
    点选("n2", 200, 100, { shiftKey: true })
    await flush()

    按键(画布()!, { key: "d", ctrlKey: true })
    await 过防抖()
    expect(写们.length).toBe(1)
    const 加节点 = 写们[0]!.操作[0]!
    if (加节点.操作 !== "加节点") throw new Error("期望加节点")
    expect(加节点.节点.map((行) => [行.x, 行.y])).toEqual([
      [100, 100],
      [200, 100],
    ])
  })

  test("R97 Alt+拖：先复制所选（偏移 0），再把拖动目标切到副本；一次写含 加节点 + 移动", async () => {
    const { api, 写们 } = 假api({ 写: (输入) => 成功("v2", 副本映射(输入)) })
    挂上(api, 合并图())
    await flush()

    点选("n1", 100, 100)
    await flush()

    拖(节点组("n1")!, 100, 100, 130, 120, { altKey: true })
    await 过防抖()

    expect(写们.length).toBe(1)
    const 操作 = 写们[0]!.操作
    expect(操作.map((条) => 条.操作)).toEqual(["加节点", "移动"])
    const 加节点 = 操作[0]!
    if (加节点.操作 !== "加节点") throw new Error("期望加节点")
    expect(加节点.节点.map((行) => [行.名称, 行.x, 行.y])).toEqual([["张三副本", 100, 100]])
    const 移动 = 操作[1]!
    if (移动.操作 !== "移动") throw new Error("期望移动")
    expect(移动.目标).toEqual([{ 类别: "节点", id: String(加节点.节点[0]!.id), x: 130, y: 120 }])

    await flush()
    await flush()
    // 原节点不动，副本落在拖动终点且被选中。
    expect(节点组("n1")!.getAttribute("transform")).toBe("translate(100 100)")
    expect(节点组("n9")!.getAttribute("transform")).toBe("translate(130 120)")
    expect(节点组("n9")!.getAttribute("data-selected")).toBe("true")
  })

  test("M4 Ctrl+C 在无节点选区时清空旧剪贴板（粘贴不出上次的节点）", async () => {
    const { api, 写们 } = 假api()
    挂上(api, 合并图())
    await flush()

    点选("n1", 100, 100)
    点选("n2", 200, 100, { shiftKey: true })
    await flush()
    按键(画布()!, { key: "c", ctrlKey: true })
    await 过防抖()
    expect(写们.length).toBe(0)

    // 点空白清空选中，再按 Ctrl+C：剪贴板应被清空，而不是保留上一次的节点。
    按下(画布()!, 500, 500)
    松开(500, 500)
    await flush()
    按键(画布()!, { key: "c", ctrlKey: true })
    await flush()
    按键(画布()!, { key: "v", ctrlKey: true })
    await 过防抖()
    expect(写们.length).toBe(0)
  })

  test("M5 剪贴板实例内隔离：甲编辑器复制后，乙编辑器粘贴零写", async () => {
    const 甲 = 假api()
    const 甲host = 挂上(甲.api, 合并图())
    await flush()
    点选("n1", 100, 100)
    await flush()
    按键(甲host.querySelector("[data-slot='hgraph-canvas']")!, { key: "c", ctrlKey: true })
    await flush()

    const 乙 = 假api()
    const 乙host = 挂上(乙.api, 合并图())
    await flush()
    按键(乙host.querySelector("[data-slot='hgraph-canvas']")!, { key: "v", ctrlKey: true })
    await 过防抖()
    expect(乙.写们.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// T017b · 大图找得到、看得清（搜索 / 隔离 / 筛选 / 查找路径 / 标签分级）
//
// 口径：R70 视口归画布（编辑器只递增请求序号）、R71 标签取舍由画布调用、R72 隔离与
// 筛选共用「已隐藏 N」。所有新交互都是本地展示态，**零写盘**（用例断言 `写们.length` 不变）。
// ---------------------------------------------------------------------------

const 节点标签个数 = () => document.querySelectorAll("[data-slot='hgraph-node-label']").length
const 边标签个数 = () => document.querySelectorAll("[data-slot='hgraph-edge-label']").length
const 已选节点id们 = () =>
  [...document.querySelectorAll("[data-slot='hgraph-node'][data-selected='true']")].map((元素) =>
    元素.getAttribute("data-node-id"),
  )
const 带标签的节点id们 = () =>
  [...document.querySelectorAll("[data-slot='hgraph-node']")]
    .filter((组) => 组.querySelector("[data-slot='hgraph-node-label']") !== null)
    .map((组) => 组.getAttribute("data-node-id"))
/** 断言集合用的稳定升序（不用裸 `.sort()`：oxlint 要求显式 compare）。 */
const 升序 = (值: readonly (string | null)[]) =>
  [...值].sort((甲, 乙) => {
    const 左 = 甲 ?? ""
    const 右 = 乙 ?? ""
    return 左 < 右 ? -1 : 左 > 右 ? 1 : 0
  })

const 勾选 = (输入: HTMLInputElement, 值: boolean) => {
  输入.checked = 值
  输入.dispatchEvent(new Event("change", { bubbles: true }))
}

const 输入搜索词 = (词: string) => {
  const 输入 = 取("[data-slot='hgraph-search']") as HTMLInputElement
  expect(输入).not.toBeNull()
  输入.value = 词
  输入.dispatchEvent(new Event("input", { bubbles: true }))
  return 输入
}

const 滚轮 = (deltaY: number) =>
  画布()!.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY }))

/** n1–n2 相连，n3 孤立；类型：n1/n2 是「人」，n3 是「公司」。 */
function 三点图(): 图文件 {
  return {
    ...一份图(),
    节点: [
      造节点("n1", 100, 100, { 类型: "人" }),
      造节点("n2", 200, 100, { 类型: "人" }),
      造节点("n3", 400, 400, { 类型: "公司" }),
    ],
    边: [造边("e1", "n1", "n2")],
    文字: [],
  }
}

/** 四跳链 n1–n2–n3–n4（名称：张三/李四/王五/赵六）。 */
function 链图(): 图文件 {
  return {
    ...一份图(),
    节点: [
      造节点("n1", 100, 100, { 名称: "张三" }),
      造节点("n2", 200, 100, { 名称: "李四" }),
      造节点("n3", 300, 100, { 名称: "王五" }),
      造节点("n4", 400, 100, { 名称: "赵六" }),
    ],
    边: [造边("e1", "n1", "n2"), 造边("e2", "n2", "n3"), 造边("e3", "n3", "n4")],
    文字: [],
  }
}

/** 宽图：两颗节点相距 6000，适配后缩放 ≈ 0.11（低于 0.3 档）。 */
function 宽图(): 图文件 {
  return {
    ...一份图(),
    节点: [造节点("n1", 0, 0), 造节点("n2", 6000, 0)],
    边: [],
    文字: [],
  }
}

/** 1001 颗节点（>1000）：40 列 × 26 行网格。 */
function 千点图(): 图文件 {
  const 节点们: 节点[] = []
  for (let 序 = 0; 序 < 1001; 序++) {
    节点们.push(造节点(`n${序}`, (序 % 40) * 60, Math.floor(序 / 40) * 60))
  }
  return { ...一份图(), 节点: 节点们, 边: [], 文字: [] }
}

/**
 * 挂一块裸画布（不拼工具栏/检查器）：R70 的视口请求、R71 的标签分级都在画布内落地。
 * `恢复毫秒` 是运动帧恢复的测试缝（默认 200）；`标签开` = 编辑器的 >800 落点。
 */
function 挂画布(
  文档: 图文件,
  选项: {
    选中?: readonly string[]
    居中请求?: { readonly id: string; readonly 序号: number }
    适配请求?: number
    适配目标?: readonly string[]
    标签开?: boolean
    恢复毫秒?: number
  } = {},
) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const 幽 = 幽灵动作表()
  const [选中, set选中] = createSignal<readonly string[]>(选项.选中 ?? [])
  const [居中请求, set居中请求] = createSignal(选项.居中请求)
  const [适配请求, set适配请求] = createSignal(选项.适配请求)
  const [适配目标, set适配目标] = createSignal(选项.适配目标)
  const [标签开, set标签开] = createSignal(选项.标签开)
  挂过的.push(
    render(
      () => (
        <画布组件
          文档={文档}
          选中={选中()}
          模式="指针"
          坐标换算={({ clientX, clientY }) => ({
            // WheelEvent 的 clientX/Y 在 happy-dom 下可能是 undefined：按内容原点兜底。
            x: Number.isFinite(clientX) ? clientX : 0,
            y: Number.isFinite(clientY) ? clientY : 0,
          })}
          动作={幽.动作}
          居中请求={居中请求()}
          适配请求={适配请求()}
          适配目标={适配目标()}
          标签开={标签开()}
          恢复毫秒={选项.恢复毫秒}
        />
      ),
      host,
    ),
  )
  return { 幽, 选中, set选中, set居中请求, set适配请求, set适配目标, set标签开 }
}

describe("T017b · 隔离（R72）", () => {
  test("#10 只看邻居：只渲染 1 跳集合，角落条写明已隐藏 N 个节点", async () => {
    const { api, 写们 } = 假api()
    挂上(api, 三点图())
    await flush()

    点选("n1", 100, 100)
    await flush()
    const 按钮 = 取("[data-slot='hgraph-toolbar-neighbors']") as HTMLButtonElement
    expect(按钮).not.toBeNull()
    expect(按钮.disabled).toBe(false)
    按钮.click()
    await flush()

    // 可见集合：n1 与其 1 跳邻居 n2；n3 孤立 ⇒ 被隐藏。
    expect(节点组("n1")).not.toBeNull()
    expect(节点组("n2")).not.toBeNull()
    expect(节点组("n3")).toBeNull()
    expect(文案("hgraph-hidden-badge")).toContain("已隐藏 1 个节点")
    await 过防抖()
    expect(写们.length).toBe(0)
  })

  test("#11 退出隔离：角落条消失、全部节点重新渲染", async () => {
    const { api } = 假api()
    挂上(api, 三点图())
    await flush()

    点选("n1", 100, 100)
    await flush()
    ;(取("[data-slot='hgraph-toolbar-neighbors']") as HTMLButtonElement).click()
    await flush()
    expect(取("[data-slot='hgraph-hidden-badge']")).not.toBeNull()

    ;(取("[data-slot='hgraph-exit-isolation']") as HTMLButtonElement).click()
    await flush()

    expect(取("[data-slot='hgraph-hidden-badge']")).toBeNull()
    expect(节点组("n3")).not.toBeNull()
  })
})

describe("T017b · 筛选（R72）", () => {
  test("#12 类型筛选：选「人」后隐藏计数 = 非「人」节点数（1）", async () => {
    const { api, 写们 } = 假api()
    挂上(api, 三点图())
    await flush()

    ;(取("[data-slot='hgraph-filter-toggle']") as HTMLButtonElement).click()
    await flush()
    const 人 = 取("[data-slot='hgraph-filter-type'][value='人']") as HTMLInputElement
    expect(人).not.toBeNull()
    勾选(人, true)
    await flush()

    expect(节点组("n1")).not.toBeNull()
    expect(节点组("n2")).not.toBeNull()
    expect(节点组("n3")).toBeNull()
    expect(文案("hgraph-hidden-badge")).toContain("已隐藏 1 个节点")
    await 过防抖()
    expect(写们.length).toBe(0)
  })

  test("#12b 性质筛选只作用于边：选「推断」后事实边不渲染，节点不被隐藏", async () => {
    const { api, 写们 } = 假api()
    const 图: 图文件 = {
      ...三点图(),
      边: [
        { ...造边("e1", "n1", "n2"), 性质: "事实" },
        { ...造边("e2", "n2", "n3"), 性质: "推断" },
      ],
    }
    挂上(api, 图)
    await flush()
    expect(边数()).toBe(2)

    ;(取("[data-slot='hgraph-filter-toggle']") as HTMLButtonElement).click()
    await flush()
    const 性质 = 取("[data-slot='hgraph-filter-kind']") as HTMLSelectElement
    性质.value = "推断"
    性质.dispatchEvent(new Event("change", { bubbles: true }))
    await flush()

    expect(边数()).toBe(1)
    expect(节点数()).toBe(3)
    // 性质筛选不隐藏节点 ⇒ 「已隐藏 N」为 0，角落条不渲染（R72：共用节点口径）。
    expect(取("[data-slot='hgraph-hidden-badge']")).toBeNull()
    await 过防抖()
    expect(写们.length).toBe(0)
  })
})

describe("T017b · 搜索（R72）", () => {
  test("#13 搜索 Enter：选中 1 个、节点落 viewBox 中心（居中请求生效）、零写", async () => {
    const { api, 写们 } = 假api()
    挂上(api, 三点图())
    await flush()

    const 输入 = 输入搜索词("n2")
    await flush()
    按键(输入, { key: "Enter" })
    await flush()

    expect(已选节点id们()).toEqual(["n2"])
    // 画布宽高 760×680、缩放不变（1）⇒ n2(200,100) 落在中心：translate(180 240)。
    expect(取("[data-slot='hgraph-viewport']")!.getAttribute("transform")).toBe("translate(180 240) scale(1)")
    // 验收 #13「触发 1 次」：一次 Enter 只推进一次序号（`data-center-seq` 是可观测口径）。
    expect(取("[data-slot='hgraph-search-wrap']")!.getAttribute("data-center-seq")).toBe("1")
    // 命中后下拉收起（Minor-5 / 修复轮 1）。
    expect(取("[data-slot='hgraph-search-results']")).toBeNull()
    await 过防抖()
    expect(写们.length).toBe(0)
  })

  test("#14 搜索无结果：文案「没有匹配的节点」，选中不变", async () => {
    const { api } = 假api()
    挂上(api, 三点图())
    await flush()

    点选("n1", 100, 100)
    await flush()
    输入搜索词("不存在的人")
    await flush()

    expect(文案("hgraph-search-empty")).toBe("没有匹配的节点")
    expect(已选节点id们()).toEqual(["n1"])
  })
})

describe("T017b · 查找路径（R72）", () => {
  test("#15 有路径：面板含「3 跳」与途经名称，选中 = 路径 id，零写", async () => {
    const { api, 写们 } = 假api()
    挂上(api, 链图())
    await flush()

    点选("n1", 100, 100)
    点选("n4", 400, 100, { shiftKey: true })
    await flush()
    const 按钮 = 取("[data-slot='hgraph-toolbar-path']") as HTMLButtonElement
    expect(按钮).not.toBeNull()
    expect(按钮.disabled).toBe(false)
    按钮.click()
    await flush()

    const 面板 = 文案("hgraph-path-panel") ?? ""
    expect(面板).toContain("3 跳")
    expect(面板).toContain("张三")
    expect(面板).toContain("李四")
    expect(面板).toContain("王五")
    expect(面板).toContain("赵六")
    expect(升序(已选节点id们())).toEqual(["n1", "n2", "n3", "n4"])
    await 过防抖()
    expect(写们.length).toBe(0)
  })

  test("#16 不连通：面板明说没有路径，选中不变、零写", async () => {
    const { api, 写们 } = 假api()
    挂上(api, { ...三点图(), 边: [] })
    await flush()

    点选("n1", 100, 100)
    点选("n2", 200, 100, { shiftKey: true })
    await flush()
    ;(取("[data-slot='hgraph-toolbar-path']") as HTMLButtonElement).click()
    await flush()

    expect(文案("hgraph-path-panel")).toContain("这两个节点之间没有连通的路径")
    expect(升序(已选节点id们())).toEqual(["n1", "n2"])
    await 过防抖()
    expect(写们.length).toBe(0)
  })
})

describe("T017b · 标签分级与运动帧（R71 / R70）", () => {
  test("#17 适配后缩放 ≈ 11%（<30%）只留选中标签；放到 ≥60% 恢复全部", async () => {
    const 图 = 宽图()
    const 预期 = 适配视口(图.节点, { 宽: 760, 高: 680 })
    挂画布(图, { 选中: ["n1"], 恢复毫秒: 40, 适配请求: 1 })
    await flush()

    // 适配请求（R70）：画布用 `适配视口(节点们, {宽:760, 高:680})` 落地，原点不动。
    expect(取("[data-slot='hgraph-viewport']")!.getAttribute("transform")).toBe(
      `translate(${预期.x} ${预期.y}) scale(${预期.缩放})`,
    )
    // 缩放 ≈ 0.11 < 0.3 ⇒ 只留选中节点。
    expect(带标签的节点id们()).toEqual(["n1"])

    for (let 序 = 0; 序 < 13; 序++) 滚轮(-100)
    await 等(80)
    expect(升序(带标签的节点id们())).toEqual(["n1", "n2"])
  })

  test("#18 拖动中标签全隐；松手后延迟恢复（不是立即显示）", async () => {
    挂画布(三点图(), { 恢复毫秒: 40 })
    await flush()
    expect(节点标签个数()).toBe(3)
    expect(边标签个数()).toBe(1)

    按下(节点组("n1")!, 100, 100)
    for (let 序 = 1; 序 <= 6; 序++) 指针移动(100 + 序 * 10, 100)
    expect(节点标签个数()).toBe(0)
    expect(边标签个数()).toBe(0)

    松开(160, 100)
    await flush()
    // 松手后不是立即恢复：定时器（40ms）尚未到。
    expect(节点标签个数()).toBe(0)
    await 等(80)
    expect(节点标签个数()).toBe(3)
  })

  test("#19 边标签：缩放 50% 不渲染，≥80% 才渲染", async () => {
    挂画布(三点图(), { 恢复毫秒: 40 })
    await flush()
    expect(边标签个数()).toBe(1)

    // deltaY > 0 = 缩小（canvas.tsx 的滚轮公式）。
    for (let 序 = 0; 序 < 5; 序++) 滚轮(100)
    await 等(80)
    expect(取("[data-slot='hgraph-viewport']")!.getAttribute("transform")).toContain("scale(0.5)")
    expect(边标签个数()).toBe(0)

    // 0.5 × 1.15⁴ ≈ 0.87 ≥ 0.8。
    for (let 序 = 0; 序 < 4; 序++) 滚轮(-100)
    await 等(80)
    expect(边标签个数()).toBe(1)
  })
})

describe("T017b · 大图提示与标签开关", () => {
  test(">300 提示拆图、>1000 提示性能风险但不拦；>800 默认关标签，工具栏可强制打开", async () => {
    const { api, 写们 } = 假api()
    挂上(api, 千点图())
    await flush()

    expect(文案("hgraph-size-notice")).toBe("这张图已经偏大，建议拆成多张")
    expect(文案("hgraph-size-warn")).toContain("1000")
    // >800 默认关标签：只显选中与悬停（这里没有选中）。
    expect(节点标签个数()).toBe(0)

    const 开关 = 取("[data-slot='hgraph-toolbar-all-labels']") as HTMLButtonElement | null
    expect(开关).not.toBeNull()
    expect(开关!.getAttribute("aria-pressed")).toBe("false")
    开关!.click()
    await flush()

    expect(开关!.getAttribute("aria-pressed")).toBe("true")
    expect(节点标签个数()).toBeGreaterThan(0)
    await 过防抖()
    expect(写们.length).toBe(0)
  })
})

describe("T017b · 视口请求（R70）", () => {
  test("居中请求：只平移不改缩放，节点落 viewBox 中心", async () => {
    const { set居中请求 } = 挂画布(三点图())
    await flush()

    set居中请求({ id: "n2", 序号: 1 })
    await flush()

    // n2(200,100) ⇒ translate(760/2-200, 680/2-100) = (180, 240)，缩放保持 1。
    expect(取("[data-slot='hgraph-viewport']")!.getAttribute("transform")).toBe("translate(180 240) scale(1)")
  })

  test("适配全部按钮：编辑器只递增请求，画布用 `适配视口` 落地", async () => {
    const { api } = 假api()
    const 图 = 宽图()
    挂上(api, 图)
    await flush()

    const 预期 = 适配视口(图.节点, { 宽: 760, 高: 680 })
    ;(取("[data-slot='hgraph-toolbar-fit']") as HTMLButtonElement).click()
    await flush()

    expect(取("[data-slot='hgraph-viewport']")!.getAttribute("transform")).toBe(
      `translate(${预期.x} ${预期.y}) scale(${预期.缩放})`,
    )
  })
})

describe("T017b · 修复轮 1（R102–R104 / 覆盖补强）", () => {
  test("R102 检查器「只看邻居」：选中 n1 → 点检查器按钮 ⇒ n3 隐藏 + 角落条 1 + 零写", async () => {
    const { api, 写们 } = 假api()
    挂上(api, 三点图())
    await flush()

    点选("n1", 100, 100)
    await flush()
    const 按钮 = 取("[data-slot='hgraph-inspector-neighbors']") as HTMLButtonElement | null
    expect(按钮).not.toBeNull()
    按钮!.click()
    await flush()

    expect(节点组("n1")).not.toBeNull()
    expect(节点组("n2")).not.toBeNull()
    expect(节点组("n3")).toBeNull()
    expect(文案("hgraph-hidden-badge")).toContain("已隐藏 1 个节点")
    await 过防抖()
    expect(写们.length).toBe(0)
  })

  test("框选与可见集求交：隔离后框住隐藏节点 ⇒ 选中不包含它", async () => {
    const { api } = 假api()
    挂上(api, 三点图())
    await flush()
    点选("n1", 100, 100)
    await flush()
    ;(取("[data-slot='hgraph-toolbar-neighbors']") as HTMLButtonElement).click()
    await flush()
    expect(节点组("n3")).toBeNull()

    // 框 (300,300)-(500,500) 几何上覆盖隐藏的 n3(400,400)；n1/n2 在框外。
    拖(画布()!, 300, 300, 500, 500, { shiftKey: true })
    await flush()

    expect(已选节点id们()).toContain("n1")
    expect(已选节点id们()).not.toContain("n3")
    // 选中集合不能只看 DOM：被隔离的节点即使被选中也可能不渲染。查找路径按钮只按
    // 「选中里的节点数 === 2」启用，是选中集合的独立观测口（`#005-18` 假绿四问）。
    expect((取("[data-slot='hgraph-toolbar-path']") as HTMLButtonElement).disabled).toBe(true)
    expect(节点组("n3")).toBeNull()
  })

  test("居中保留当前缩放：先放大到 ≈1.52 再居中 ⇒ scale 不变、目标落中心", async () => {
    const { set居中请求 } = 挂画布(三点图())
    await flush()

    // 滚轮向上 3 次：1 × 1.15³ ≈ 1.5208749999999999（居中若重置为 1 会红）。
    for (let 序 = 0; 序 < 3; 序++) 滚轮(-100)
    await 等(80)

    const 视口元素 = 取("[data-slot='hgraph-viewport']")!
    const 变换 = 视口元素.getAttribute("transform")!
    const 匹配 = /scale\(([^)]+)\)/.exec(变换)
    expect(匹配).not.toBeNull()
    const 缩放 = Number(匹配![1])
    expect(缩放).toBeGreaterThan(1.5)

    set居中请求({ id: "n2", 序号: 1 })
    await flush()

    // n2(200,100)、画布 760×680：translate(380-200·s, 340-100·s)，scale 保持 s。
    expect(视口元素.getAttribute("transform")).toBe(
      `translate(${380 - 200 * 缩放} ${340 - 100 * 缩放}) scale(${缩放})`,
    )
  })

  test("pointercancel 收尾：拖动中取消后 40ms 恢复标签（不是永远隐藏）", async () => {
    挂画布(三点图(), { 恢复毫秒: 40 })
    await flush()
    expect(节点标签个数()).toBe(3)

    按下(节点组("n1")!, 100, 100)
    for (let 序 = 1; 序 <= 6; 序++) 指针移动(100 + 序 * 10, 100)
    expect(节点标签个数()).toBe(0)

    画布()!.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        cancelable: true,
        clientX: 160,
        clientY: 100,
        pointerId: 1,
      }),
    )
    await flush()
    expect(节点标签个数()).toBe(0)
    await 等(80)
    expect(节点标签个数()).toBe(3)
  })

  test("搜索 ↑/↓：两条结果 ↓ 后 Enter 选第二条、↑ 后 Enter 回第一条", async () => {
    const { api } = 假api()
    const 图: 图文件 = {
      ...三点图(),
      节点: [
        造节点("n1", 100, 100, { 名称: "张三" }),
        造节点("n2", 200, 100, { 名称: "张四" }),
        造节点("n3", 400, 400, { 名称: "王五" }),
      ],
    }
    挂上(api, 图)
    await flush()

    const 输入 = 输入搜索词("张")
    await flush()
    expect(document.querySelectorAll("[data-slot='hgraph-search-result']").length).toBe(2)

    按键(输入, { key: "ArrowDown" })
    按键(输入, { key: "Enter" })
    await flush()
    expect(已选节点id们()).toEqual(["n2"])

    按键(输入, { key: "ArrowUp" })
    按键(输入, { key: "Enter" })
    await flush()
    expect(已选节点id们()).toEqual(["n1"])
  })

  test("隔离并集：隔离 n1 后对 n3 再隔离 ⇒ 并集保留 n1（不是替换）", async () => {
    const { api } = 假api()
    挂上(api, 三点图())
    await flush()
    点选("n1", 100, 100)
    await flush()
    ;(取("[data-slot='hgraph-toolbar-neighbors']") as HTMLButtonElement).click()
    await flush()
    expect(节点组("n3")).toBeNull()

    // 搜索能选中被隔离的 n3（R104：选中始终渲染），再按只看邻居。
    const 输入 = 输入搜索词("n3")
    await flush()
    按键(输入, { key: "Enter" })
    await flush()
    expect(节点组("n3")).not.toBeNull()

    ;(取("[data-slot='hgraph-toolbar-neighbors']") as HTMLButtonElement).click()
    await flush()

    // 并集 {n1,n2,n3}：n1 仍在（替换实现会只剩 {n3}），角落条 N=0 消失。
    expect(节点组("n1")).not.toBeNull()
    expect(节点组("n2")).not.toBeNull()
    expect(取("[data-slot='hgraph-hidden-badge']")).toBeNull()
  })

  test("R103 隔离覆盖全图（N=0）时工具栏可退出隔离（角落条不可及的空档）", async () => {
    const { api } = 假api()
    挂上(api, 三点图())
    await flush()
    点选("n1", 100, 100)
    await flush()
    const 按钮 = 取("[data-slot='hgraph-toolbar-neighbors']") as HTMLButtonElement
    按钮.click()
    await flush()
    // 隔离启用后「只看邻居」仍是并集扩展入口（R72）；退出按钮独立出现。
    expect(按钮.textContent?.trim()).toBe("只看邻居")
    expect(取("[data-slot='hgraph-toolbar-exit-isolation']")).not.toBeNull()

    const 输入 = 输入搜索词("n3")
    await flush()
    按键(输入, { key: "Enter" })
    await flush()
    按钮.click()
    await flush()
    // 并集 = 全集 ⇒ 隐藏数 0，角落条不渲染；退出入口只能来自工具栏。
    expect(取("[data-slot='hgraph-hidden-badge']")).toBeNull()
    const 退出 = 取("[data-slot='hgraph-toolbar-exit-isolation']") as HTMLButtonElement | null
    expect(退出).not.toBeNull()
    expect(退出!.getAttribute("aria-label")).toBe("退出隔离")

    退出!.click()
    await flush()
    expect(取("[data-slot='hgraph-toolbar-exit-isolation']")).toBeNull()

    // 退出后从新集合开始：选中仍是 n3 ⇒ 只显示 {n3}，隐藏 n1/n2。
    按钮.click()
    await flush()
    expect(文案("hgraph-hidden-badge")).toContain("已隐藏 2 个节点")
    expect(节点组("n1")).toBeNull()
  })

  test("R104 隔离后搜索命中隐藏节点：该节点渲染、选中 1 个、隐藏计数减 1、下拉收起", async () => {
    const { api, 写们 } = 假api()
    挂上(api, 链图())
    await flush()
    点选("n1", 100, 100)
    await flush()
    ;(取("[data-slot='hgraph-toolbar-neighbors']") as HTMLButtonElement).click()
    await flush()
    expect(文案("hgraph-hidden-badge")).toContain("已隐藏 2 个节点")

    const 输入 = 输入搜索词("王五")
    await flush()
    按键(输入, { key: "Enter" })
    await flush()

    expect(已选节点id们()).toEqual(["n3"])
    expect(节点组("n3")).not.toBeNull()
    // 可见 = 隔离 ∩ 筛选 ∪ 选中 ⇒ n3 计入可见，隐藏数 2 → 1。
    expect(文案("hgraph-hidden-badge")).toContain("已隐藏 1 个节点")
    expect(取("[data-slot='hgraph-search-results']")).toBeNull()
    await 过防抖()
    expect(写们.length).toBe(0)
  })
})
