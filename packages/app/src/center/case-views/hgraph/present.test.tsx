/**
 * T011：演示态（`演示步进` 纯函数 + 覆盖层）与 `出现序` 步进接入。
 *
 * ## 口径（简报 R35/R37，逐条钉住）
 *
 * - `出现序` 缺省 = 0；负数 = 非法（不抛错、按不可见处理）；同序按 id 排序只影响节奏，
 *   集合语义与顺序无关（`演示步进` 的输出是集合）。
 * - 边必须**两端都可见**且边自身 `出现序 ≤ 步号`；端点未出现 ⇒ 边隐藏（演示的本意）。
 * - `文字` 不参与步进（R35）：演示态文字块照常显示，即使它写了 `出现序`。
 * - 快捷键只挂覆盖层容器，不挂 `window`（FR-040）；焦点在输入框时三个键都不生效。
 * - 演示态零写盘、不进撤销栈；退出后 `选中` 与视口保持进入前的值。
 *
 * ## 为什么编辑器级用例放在本文件
 *
 * `演示切换` 的入口是工具栏，但「不渲染工具栏/检查器」「零写盘」「视口不变」只有把
 * 真编辑器挂起来才能断言；纯函数与覆盖层单条用例在前半段。
 */
import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { HgraphApi, 写应答 } from "@/project/hgraph-api"
import type { 图文件, 边, 节点, 文字 } from "./file"
import type { 画布动作 } from "./canvas"
import { 画布 as 画布组件 } from "./canvas"
import { 处理演示按键, 演示步进, 演示覆盖层 } from "./present"
import { 工具栏 } from "./toolbar"
import { 编辑器 } from "./editor"

const 挂过的: Array<() => void> = []

afterEach(() => {
  while (挂过的.length) 挂过的.pop()!()
  document.body.innerHTML = ""
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const 等 = (毫秒: number) => new Promise<void>((resolve) => setTimeout(resolve, 毫秒))
const 过防抖 = () => 等(650)

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function 造节点(id: string, x: number, y: number, 补丁: Partial<节点> = {}): 节点 {
  return { id, 名称: id, 类型: "人", 来源: { kind: "手写" }, 时间: { 首: "", 末: "" }, x, y, ...补丁 }
}

function 造边(id: string, 从: string, 到: string, 补丁: Partial<边> = {}): 边 {
  return {
    id,
    从,
    到,
    标签: id,
    性质: "推断",
    方向: "有向",
    来源: { kind: "手写" },
    时间: { 首: "", 末: "" },
    ...补丁,
  }
}

function 造文字(id: string, 内容: string, x: number, y: number, 补丁: Partial<文字> = {}): 文字 {
  return { id, 内容, x, y, 字号: "中", ...补丁 }
}

/**
 * 步进夹具（顺序刻意乱放，防止实现吃 `Object.keys` / 数组顺序）：
 *
 * | 对象 | 出现序 | 备注 |
 * |---|---|---|
 * | n0 | 缺省 | 第 0 步 |
 * | n3 | 0 | 第 0 步 |
 * | n1 | 1 | 第 1 步 |
 * | n2 | 2 | 第 2 步 |
 * | n4 | -1 | 非法 ⇒ 永不可见 |
 * | e01 | 0 n0→n3 | 第 0 步可见 |
 * | e02 | 0 n0→n1 | 端点 n1 第 1 步才出现 |
 * | e03 | 1 n1→n2 | 端点 n2 第 2 步才出现 ⇒ 第 2 步可见 |
 * | e04 | 0 n3→n4 | n4 永不可见 ⇒ 永不可见 |
 * | t1 | 5 | 文字不参与 ⇒ 一直显示 |
 */
function 步进图(): 图文件 {
  return {
    格式: 1,
    标题: "演示夹具",
    创建于: "2026-11-16T10:00:00+08:00",
    更新于: "2026-11-16T10:00:00+08:00",
    设置: {
      线宽度量: "按类型默认",
      次数阈值: [1, 2, 5, 10, 50],
      金额阈值: [10000, 50000, 200000, 1000000],
      外环阈值: [1, 2, 4, 8],
    },
    // 数组顺序刻意与 id / 出现序都不同。
    节点: [
      造节点("n2", 400, 100, { 出现序: 2 }),
      造节点("n0", 100, 100),
      造节点("n4", 500, 100, { 出现序: -1 }),
      造节点("n1", 200, 100, { 出现序: 1 }),
      造节点("n3", 300, 100, { 出现序: 0 }),
    ],
    边: [
      造边("e03", "n1", "n2", { 出现序: 1 }),
      造边("e01", "n0", "n3", { 出现序: 0 }),
      造边("e04", "n3", "n4", { 出现序: 0 }),
      造边("e02", "n0", "n1", { 出现序: 0 }),
    ],
    文字: [造文字("t1", "说明", 50, 50, { 出现序: 5 })],
  }
}

const 集合 = (值: ReadonlySet<string>) => [...值].sort()

// ---------------------------------------------------------------------------
// 纯函数：演示步进
// ---------------------------------------------------------------------------

describe("演示步进 · 纯函数", () => {
  test("#1 第 0 步：只有缺省 / 出现序=0 的节点；边只揭示两端都在的", () => {
    const 出 = 演示步进(步进图(), 0)
    expect(集合(出.可见节点)).toEqual(["n0", "n3"])
    expect(集合(出.可见边)).toEqual(["e01"])
  })

  test("#3 端点未出现 ⇒ 边不可见（两个端点都可见才可能）", () => {
    const 图 = 步进图()
    const 第0 = 演示步进(图, 0)
    expect(第0.可见节点.has("n1")).toBe(false)
    // e02 自己出现序=0，但 n1 未出现 ⇒ 隐藏。
    expect(第0.可见边.has("e02")).toBe(false)

    const 第1 = 演示步进(图, 1)
    expect(第1.可见节点.has("n1")).toBe(true)
    expect(第1.可见边.has("e02")).toBe(true)
    // e03 端点 n2 尚未出现 ⇒ 第 1 步也不可见。
    expect(第1.可见边.has("e03")).toBe(false)

    // n4 出现序为负 ⇒ 永不可见，e04 跟着永不可见。
    for (const 步 of [0, 1, 2, 3, 10]) {
      const 现 = 演示步进(图, 步)
      expect(现.可见节点.has("n4")).toBe(false)
      expect(现.可见边.has("e04")).toBe(false)
    }
  })

  test("#2 步号逐步 +1：可见集合单调不减，新增项恰好是该步号的对象", () => {
    const 图 = 步进图()
    const 各步 = [0, 1, 2, 3].map((步) => 演示步进(图, 步))

    for (let 序 = 1; 序 < 各步.length; 序++) {
      const 前 = 各步[序 - 1]!
      const 后 = 各步[序]!
      // 单调不减：前一步的每个 id 都还在。
      for (const id of 前.可见节点) expect(后.可见节点.has(id)).toBe(true)
      for (const id of 前.可见边) expect(后.可见边.has(id)).toBe(true)
    }

    // 新增项（实得集合差），逐步断言具体 id。
    expect(集合(各步[0]!.可见节点)).toEqual(["n0", "n3"])
    expect(集合(各步[1]!.可见节点)).toEqual(["n0", "n1", "n3"])
    expect(集合(各步[2]!.可见节点)).toEqual(["n0", "n1", "n2", "n3"])
    expect(集合(各步[3]!.可见节点)).toEqual(["n0", "n1", "n2", "n3"])

    expect(集合(各步[0]!.可见边)).toEqual(["e01"])
    expect(集合(各步[1]!.可见边)).toEqual(["e01", "e02"])
    expect(集合(各步[2]!.可见边)).toEqual(["e01", "e02", "e03"])
    expect(集合(各步[3]!.可见边)).toEqual(["e01", "e02", "e03"])
  })

  test("同序按 id 排序只影响节奏、不改集合语义（乱序数组与逆序数组同结果）", () => {
    const 正 = 步进图()
    const 逆 = 步进图()
    逆.节点 = [...逆.节点].reverse()
    逆.边 = [...逆.边].reverse()
    for (const 步 of [0, 1, 2, 3]) {
      expect(集合(演示步进(正, 步).可见节点)).toEqual(集合(演示步进(逆, 步).可见节点))
      expect(集合(演示步进(正, 步).可见边)).toEqual(集合(演示步进(逆, 步).可见边))
    }
  })

  test("步号不是自然数（负数）也不抛错：什么都不揭示", () => {
    const 出 = 演示步进(步进图(), -1)
    expect(集合(出.可见节点)).toEqual([])
    expect(集合(出.可见边)).toEqual([])
  })

  test("M5 出现序: null 与 undefined 同义（读放宽的解析器会保留 null）", () => {
    const 图 = 步进图()
    // 读放宽的解析只做形状闸：`"出现序": null` 会原样留在文档里。
    ;(图.节点[1] as unknown as Record<string, unknown>).出现序 = null
    expect((图.节点[1] as unknown as Record<string, unknown>).出现序).toBeNull()

    const 第0 = 演示步进(图, 0)
    // null 本来是「删键」的同义写法 ⇒ 第 0 步就可见，而不是永不出现。
    expect(第0.可见节点.has("n0")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 覆盖层：纯视觉层（键盘/全屏/焦点都在编辑器的舞台容器上）
// ---------------------------------------------------------------------------

const 覆盖层 = () => document.body.querySelector("[data-slot='hgraph-present']") as HTMLElement | null
const 步骤文案 = () => document.body.querySelector("[data-slot='hgraph-present-step']")?.textContent?.trim()

const 按键 = (目标: Element, 初始化: KeyboardEventInit) =>
  目标.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...初始化 }))

function 挂覆盖层(初 = 0) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(render(() => <演示覆盖层 步号={初} />, host))
}

describe("演示覆盖层 · 纯视觉层（R45）", () => {
  test("只显示步号、带 pointer-events-none、不再抢焦点/不再挂键盘", async () => {
    挂覆盖层(2)
    await flush()

    const 层 = 覆盖层()
    expect(层).not.toBeNull()
    expect(步骤文案()).toBe("第 2 步")
    // R41：覆盖层不吃指针/滚轮，事件落回下面的只读画布（真实命中转发 happy-dom 测不到）。
    expect(层!.classList.contains("pointer-events-none")).toBe(true)
    // R45：键盘容器已收口到共同父容器（hgraph-stage），覆盖层不再需要 tabindex/焦点。
    expect(层!.getAttribute("tabindex")).toBeNull()
    expect(document.activeElement).not.toBe(层)
  })
})

describe("演示按键 · present.tsx 的唯一实现（R45）", () => {
  /** 把导出的处理函数挂到目标上再派发，`事件.target` 才是真实元素（输入框守卫要用）。 */
  function 派发(目标: EventTarget, key: string, 当前: number) {
    let 步 = 当前
    let 关 = 0
    const 事件 = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    const 监听 = (值: Event) => {
      处理演示按键(值 as KeyboardEvent, {
        步号: 当前,
        设置步号: (新) => (步 = 新),
        关闭: () => (关 += 1),
      })
    }
    目标.addEventListener("keydown", 监听)
    try {
      目标.dispatchEvent(事件)
    } finally {
      目标.removeEventListener("keydown", 监听)
    }
    return { 步, 关, 已阻止: 事件.defaultPrevented }
  }

  test("#4 空格 +1 / Backspace −1（到 0 为止）/ Esc 关闭，且都 preventDefault", () => {
    expect(派发(document.body, " ", 0)).toEqual({ 步: 1, 关: 0, 已阻止: true })
    expect(派发(document.body, " ", 2)).toEqual({ 步: 3, 关: 0, 已阻止: true })
    expect(派发(document.body, "Backspace", 2)).toEqual({ 步: 1, 关: 0, 已阻止: true })
    // 0 是合法起始态，不往负数走。
    expect(派发(document.body, "Backspace", 0)).toEqual({ 步: 0, 关: 0, 已阻止: true })
    expect(派发(document.body, "Escape", 0)).toEqual({ 步: 0, 关: 1, 已阻止: true })
  })

  test("#5 焦点在输入框：空格 / Backspace / Esc 都不生效", () => {
    const 输入 = document.createElement("input")
    document.body.appendChild(输入)
    输入.focus()
    expect(document.activeElement).toBe(输入)

    for (const key of [" ", "Backspace", "Escape"]) {
      expect(派发(输入, key, 0)).toEqual({ 步: 0, 关: 0, 已阻止: false })
    }
  })
})

// ---------------------------------------------------------------------------
// 工具栏入口：演示切换只调一条动作
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
  return { 动作, 计数, 参数 }
}

describe("工具栏 · 演示入口", () => {
  test("#11 点「演示」⇒ 动作表 演示切换 恰被调用 1 次", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const 幽 = 幽灵动作表()
    挂过的.push(render(() => <工具栏 选中={[]} 文档={步进图()} 动作表={幽.动作} />, host))
    await flush()

    const 键 = document.body.querySelector("[data-slot='hgraph-toolbar-present']") as HTMLButtonElement | null
    expect(键).not.toBeNull()
    expect(键!.getAttribute("aria-label")).toBe("演示")
    expect(键!.getAttribute("title")).toBe("演示")

    键!.click()
    await flush()
    expect(幽.计数.演示切换).toBe(1)
    // 工具栏不自己拼操作：其余动作一个都没被调。
    expect(Object.keys(幽.计数)).toEqual(["演示切换"])
  })
})

// ---------------------------------------------------------------------------
// 编辑器级：真接线（零写盘 / chrome 收起 / 快捷键恢复 / 视口与选中不变）
// ---------------------------------------------------------------------------

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

function 假api() {
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
      return 成功("v2")
    },
    导出许可: async () => {
      throw new Error("编辑器不该导出")
    },
  }
  return { api, 写们 }
}

function 挂编辑器(api: HgraphApi, 文档: 图文件 = 步进图()) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  挂过的.push(
    render(
      () => (
        <编辑器
          path="分析/演示图.hgraph"
          projectId="p1"
          api={api}
          初始文档={文档}
          初始版本="v1"
          坐标换算={({ clientX, clientY }) => ({ x: clientX, y: clientY })}
        />
      ),
      host,
    ),
  )
}

const 取 = (选择器: string) => document.body.querySelector(选择器)
const 画布 = () => 取("[data-slot='hgraph-canvas']") as HTMLElement | null
/** 舞台 = 同时包住画布与覆盖层的共同父容器（R44 的全屏目标 / R45 的键盘容器）。 */
const 舞台 = () => 取("[data-slot='hgraph-stage']") as HTMLElement | null
const 节点组 = (id: string) => 取(`[data-slot='hgraph-node'][data-node-id='${id}']`)
const 文字行 = (id: string) => 取(`[data-slot='hgraph-text'][data-text-id='${id}']`)
const 变换 = () => 取("[data-slot='hgraph-viewport']")?.getAttribute("transform")

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

const 点选 = (id: string, x: number, y: number) => {
  按下(节点组(id)!, x, y)
  松开(x, y)
}

/** 进入演示：点工具栏「演示」；焦点与全屏目标都是 `hgraph-stage`（R44/R45）。 */
const 进入演示 = () => (取("[data-slot='hgraph-toolbar-present']") as HTMLButtonElement).click()

/** 临时全屏环境：happy-dom 三者都没有；只在用例内挂桩，finally 还原。 */
function 临时全屏环境(选项: {
  readonly request?: () => Promise<unknown>
  readonly exit?: () => Promise<unknown>
  readonly fullscreenElement?: unknown
}): () => void {
  const 原型 = HTMLDivElement.prototype as unknown as Record<string, unknown>
  const 文档 = document as unknown as Record<string, unknown>
  const 原请求 = 原型.requestFullscreen
  const 原退出 = 文档.exitFullscreen
  const 原全屏 = 文档.fullscreenElement
  if (选项.request !== undefined) 原型.requestFullscreen = 选项.request
  if (选项.exit !== undefined) 文档.exitFullscreen = 选项.exit
  if ("fullscreenElement" in 选项) 文档.fullscreenElement = 选项.fullscreenElement
  return () => {
    if (原请求 === undefined) delete 原型.requestFullscreen
    else 原型.requestFullscreen = 原请求
    if (原退出 === undefined) delete 文档.exitFullscreen
    else 文档.exitFullscreen = 原退出
    if (原全屏 === undefined) delete 文档.fullscreenElement
    else 文档.fullscreenElement = 原全屏
  }
}

/** 记录 focus 落点，用来断言「exit 落地之后才 focus」（R46）。 */
function 临时焦点探针(顺序: string[]): () => void {
  const 原 = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (this: HTMLElement) {
    顺序.push(`focus:${this.getAttribute("data-slot") ?? this.tagName.toLowerCase()}`)
    return 原.call(this)
  }
  return () => {
    HTMLElement.prototype.focus = 原
  }
}

describe("编辑器 · 演示态", () => {
  test("#8 演示态：工具栏/检查器不在 DOM、画布 chrome 不渲染、选中描边没有、文字照常", async () => {
    const { api } = 假api()
    挂编辑器(api)
    await flush()
    点选("n1", 200, 100)
    await flush()
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")
    expect(取("[data-slot='hgraph-toolbar']")).not.toBeNull()
    expect(取("[data-slot='hgraph-inspector']")).not.toBeNull()
    expect(取("[data-slot='hgraph-editor-bar']")).not.toBeNull()
    expect(取("[data-slot='hgraph-save-status']")).not.toBeNull()

    进入演示()
    await flush()

    // 条件渲染而不是 display:none：元素根本不在 DOM。
    expect(取("[data-slot='hgraph-toolbar']")).toBeNull()
    expect(取("[data-slot='hgraph-inspector']")).toBeNull()
    expect(取("[data-slot='hgraph-present']")).not.toBeNull()
    // M4：顶栏与保存状态条也属于「全部 chrome」，此前报告里写了但没断言。
    expect(取("[data-slot='hgraph-editor-bar']")).toBeNull()
    expect(取("[data-slot='hgraph-save-status']")).toBeNull()

    // 画布进入只读演示态：chrome 按钮不渲染、选中描边一个都没有。
    expect(画布()!.getAttribute("data-readonly")).toBe("true")
    expect(取("[data-slot='hgraph-canvas-chrome']")).toBeNull()
    expect(取("[data-slot='hgraph-mode-pointer']")).toBeNull()
    expect(取("[data-selected='true']")).toBeNull()

    // 网格尚未实现（T018）⇒ 这里只钉「没有网格节点」，不新画一个。
    expect(取("[data-slot='hgraph-grid']")).toBeNull()

    // 第 0 步：缺省 / 出现序=0 的节点在；第 1/2 步的节点不在。
    expect(节点组("n0")).not.toBeNull()
    expect(节点组("n3")).not.toBeNull()
    expect(节点组("n1")).toBeNull()
    expect(节点组("n2")).toBeNull()
    // 端点未出现的边不渲染。
    expect(取("[data-edge-id='e02']")).toBeNull()
    // R35：文字不参与步进，照常显示（哪怕写了出现序=5）。
    expect(文字行("t1")).not.toBeNull()
  })

  test("#4 空格 / Backspace 步进；Esc 退出后工具栏与检查器回来，焦点还给画布", async () => {
    const { api } = 假api()
    挂编辑器(api)
    await flush()

    进入演示()
    await flush()
    const 父 = 舞台()!
    // R45：键盘容器/焦点落在共同父容器上（不是覆盖层）。
    expect(document.activeElement).toBe(父)
    expect(父.getAttribute("tabindex")).toBe("0")
    expect(取("[data-slot='hgraph-present-step']")!.textContent).toContain("第 0 步")

    按键(父, { key: " " })
    await flush()
    expect(取("[data-slot='hgraph-present-step']")!.textContent).toContain("第 1 步")
    expect(节点组("n1")).not.toBeNull()

    按键(父, { key: " " })
    await flush()
    expect(节点组("n2")).not.toBeNull()
    expect(取("[data-edge-id='e03']")).not.toBeNull()

    按键(父, { key: "Backspace" })
    await flush()
    expect(节点组("n2")).toBeNull()
    expect(节点组("n1")).not.toBeNull()

    // Esc 走父容器（真实全屏里浏览器会先退全屏，这里用桩路径之外的普通 Esc）。
    按键(父, { key: "Escape" })
    await flush()
    expect(取("[data-slot='hgraph-present']")).toBeNull()
    expect(取("[data-slot='hgraph-toolbar']")).not.toBeNull()
    expect(取("[data-slot='hgraph-inspector']")).not.toBeNull()
    // 编辑态的完整图回来（演示只过滤渲染，不改文档）。
    expect(节点组("n2")).not.toBeNull()
    expect(画布()!.getAttribute("data-readonly")).toBeNull()
    // I1：退出后焦点回到画布容器，父容器的 tabindex 收回。
    expect(document.activeElement).toBe(画布())
    expect(父.getAttribute("tabindex")).toBeNull()
  })

  test("R45 演示中点画布：焦点留在舞台容器，空格仍能步进", async () => {
    const { api } = 假api()
    挂编辑器(api)
    await flush()
    进入演示()
    await flush()

    const 父 = 舞台()!
    expect(document.activeElement).toBe(父)

    // happy-dom 不做命中/焦点转移：先把焦点置回 body，模拟真浏览器点击只读画布后的状态。
    // 父容器的 pointerdown 必须把焦点收回自己（否则空格/Backspace/Esc 全死）。
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    按下(画布()!, 200, 100)
    expect(document.activeElement).toBe(父)

    按键(document.activeElement as Element, { key: " " })
    await flush()
    expect(取("[data-slot='hgraph-present-step']")!.textContent).toContain("第 1 步")
  })

  test("快捷键只在容器上：window 上派发空格 / Esc 不动步号、不关闭", async () => {
    const { api } = 假api()
    挂编辑器(api)
    await flush()
    进入演示()
    await flush()

    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    await flush()

    expect(取("[data-slot='hgraph-present']")).not.toBeNull()
    expect(取("[data-slot='hgraph-present-step']")!.textContent).toContain("第 0 步")
  })

  test("#9/#10 演示中 Delete 不删节点、零写盘；Esc 把焦点还给画布，Delete 才删（快捷键真恢复）", async () => {
    const { api, 写们 } = 假api()
    挂编辑器(api)
    await flush()
    // 选第 0 步就能看见的 n3：这样「演示中它还在 DOM 里」与「没被删」是两件事都成立的。
    点选("n3", 300, 100)
    await flush()

    进入演示()
    await flush()
    const 父 = 舞台()!
    expect(document.activeElement).toBe(父)
    expect(节点组("n3")).not.toBeNull()

    按键(父, { key: "Delete" })
    await 过防抖()
    expect(节点组("n3")).not.toBeNull()
    expect(写们.length).toBe(0)

    // Esc 退出后编辑快捷键恢复：同一条用例里先后各按一次 Delete，中间那次零动作。
    按键(父, { key: "Escape" })
    await flush()
    expect(取("[data-slot='hgraph-present']")).toBeNull()
    // 选中在演示期间保持不变 ⇒ 退出后 Delete 仍有目标。
    expect(节点组("n3")!.getAttribute("data-selected")).toBe("true")

    // I1：退出后焦点必须回到画布容器。此前焦点停在 BODY，直接往画布派发是假绿。
    const 布 = 画布()!
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(布)
    // 从 activeElement 起按键（不再直接指定画布元素）。
    const 活 = document.activeElement as Element
    按键(活, { key: "Delete" })
    await 过防抖()
    expect(节点组("n3")).toBeNull()
    expect(写们.length).toBe(1)
    expect(写们[0]!.操作).toEqual([{ 操作: "删对象", 目标: [{ 类别: "节点", id: "n3" }] }])
  })

  test("R44 全屏目标是包住画布与覆盖层的共同父容器，不是覆盖层", async () => {
    const 原型 = HTMLDivElement.prototype as unknown as Record<string, unknown>
    const 原请求 = 原型.requestFullscreen
    const 目标们: Element[] = []
    原型.requestFullscreen = function (this: Element) {
      目标们.push(this)
      return Promise.resolve()
    }
    try {
      const { api } = 假api()
      挂编辑器(api)
      await flush()

      进入演示()
      await flush()

      const 父 = 舞台()!
      expect(目标们.length).toBe(1)
      expect(目标们[0]).toBe(父)
      // Fullscreen 只渲染目标子树 ⇒ 目标必须同时包住画布与覆盖层。
      expect(父.contains(画布()!)).toBe(true)
      expect(父.contains(取("[data-slot='hgraph-present']")!)).toBe(true)
      // 不是覆盖层自己（否则真全屏只剩「第 0 步」）。
      expect(目标们[0]).not.toBe(取("[data-slot='hgraph-present']"))
    } finally {
      if (原请求 === undefined) delete 原型.requestFullscreen
      else 原型.requestFullscreen = 原请求
    }
  })

  test("R46 退出顺序：await exitFullscreen 落地之后才聚焦画布", async () => {
    const 顺序: string[] = []
    let 退出数 = 0
    const 还原全屏 = 临时全屏环境({
      request: () => Promise.resolve(),
      exit: () => {
        退出数++
        顺序.push("exit")
        // 异步退全屏：真浏览器里 Promise 落地前画布还在惰性子树。
        return new Promise<void>((解决) =>
          setTimeout(() => {
            顺序.push("exit-resolved")
            解决()
          }, 0),
        )
      },
      fullscreenElement: undefined,
    })
    const 还原焦点 = 临时焦点探针(顺序)
    try {
      const { api } = 假api()
      挂编辑器(api)
      await flush()
      进入演示()
      await flush()
      // 进入后「我们在全屏里」：归属校验要求当前全屏元素就是舞台。
      ;(document as unknown as Record<string, unknown>).fullscreenElement = 舞台()

      按键(舞台()!, { key: "Escape" })
      await 等(20)

      expect(退出数).toBe(1)
      const 退出位 = 顺序.indexOf("exit")
      const 落地位 = 顺序.indexOf("exit-resolved")
      const 画布焦位 = 顺序.indexOf("focus:hgraph-canvas", 落地位 + 1)
      expect(退出位).toBeGreaterThanOrEqual(0)
      expect(落地位).toBeGreaterThan(退出位)
      // 焦点必须排在 exit 真正落地之后（否则画布可能仍在惰性区域，focus 被拒）。
      expect(画布焦位).toBeGreaterThan(落地位)
    } finally {
      还原焦点()
      还原全屏()
    }
  })

  test("R47 浏览器 Esc 退全屏（fullscreenchange + 元素变 null）⇒ 关闭演示、不再调 exitFullscreen", async () => {
    let 退出数 = 0
    const 还原 = 临时全屏环境({
      request: () => Promise.resolve(),
      exit: () => {
        退出数++
        return Promise.resolve()
      },
      fullscreenElement: undefined,
    })
    try {
      const { api, 写们 } = 假api()
      挂编辑器(api)
      await flush()
      进入演示()
      await flush()
      ;(document as unknown as Record<string, unknown>).fullscreenElement = 舞台()

      // 用户按浏览器保留手势：全屏元素变 null，浏览器派发 fullscreenchange。
      ;(document as unknown as Record<string, unknown>).fullscreenElement = null
      document.dispatchEvent(new Event("fullscreenchange"))
      await flush()

      expect(取("[data-slot='hgraph-present']")).toBeNull()
      // 全屏已是浏览器退的：我们自己不再调 exitFullscreen。
      expect(退出数).toBe(0)
      expect(写们.length).toBe(0)
      // 退出后焦点照样回画布。
      expect(document.activeElement).toBe(画布())
    } finally {
      还原()
    }
  })

  test("Minor 只退自己进入的全屏：fullscreenElement 是别的元素 ⇒ exitFullscreen 0 次", async () => {
    let 退出数 = 0
    const 还原 = 临时全屏环境({
      request: () => Promise.resolve(),
      exit: () => {
        退出数++
        return Promise.resolve()
      },
      fullscreenElement: document.body,
    })
    try {
      const { api } = 假api()
      挂编辑器(api)
      await flush()
      进入演示()
      await flush()

      按键(舞台()!, { key: "Escape" })
      await flush()
      expect(退出数).toBe(0)
      expect(取("[data-slot='hgraph-present']")).toBeNull()
    } finally {
      还原()
    }
  })

  test("不在全屏（fullscreenElement 为空）⇒ 退出演示不调用 exitFullscreen", async () => {
    let 退出数 = 0
    const 还原 = 临时全屏环境({
      exit: () => {
        退出数++
        return Promise.resolve()
      },
      fullscreenElement: undefined,
    })
    try {
      const { api } = 假api()
      挂编辑器(api)
      await flush()
      进入演示()
      await flush()
      按键(舞台()!, { key: "Escape" })
      await flush()
      expect(退出数).toBe(0)
    } finally {
      还原()
    }
  })

  test("没有 requestFullscreen 时进入演示不抛错、步进照常", async () => {
    const 原型 = HTMLDivElement.prototype as unknown as Record<string, unknown>
    const 原 = 原型.requestFullscreen
    delete 原型.requestFullscreen
    try {
      const { api } = 假api()
      挂编辑器(api)
      await flush()

      let 错误: unknown
      try {
        进入演示()
        await flush()
      } catch (抛) {
        错误 = 抛
      }
      expect(错误).toBeUndefined()
      expect(document.activeElement).toBe(舞台())

      按键(舞台()!, { key: " " })
      await flush()
      expect(取("[data-slot='hgraph-present-step']")!.textContent).toContain("第 1 步")
    } finally {
      if (原 !== undefined) 原型.requestFullscreen = 原
    }
  })

  test("Minor 退出演示后紧接着的 Esc 不清编辑态选中（一次性抑制）", async () => {
    const { api, 写们 } = 假api()
    挂编辑器(api)
    await flush()
    点选("n1", 200, 100)
    await flush()
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")

    进入演示()
    await flush()
    按键(舞台()!, { key: "Escape" })
    await flush()

    const 布 = 画布()!
    expect(document.activeElement).toBe(布)
    // 退出那下之后的第一次 Esc（快速连按 / 按键重复）被吞掉，选中不变。
    按键(布, { key: "Escape" })
    await flush()
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")
    // 只抑制一次：再按一次 Esc 就恢复正常（清选中）。
    按键(布, { key: "Escape" })
    await flush()
    expect(节点组("n1")!.getAttribute("data-selected")).toBeNull()
    expect(写们.length).toBe(0)
  })

  test("#5 演示零写盘、不进撤销栈；退出后选中与视口保持进入前的值", async () => {
    const { api, 写们 } = 假api()
    挂编辑器(api)
    await flush()

    // 先平移视口（transform 变化是可断言的实得值），再选中 n1。
    按下(画布()!, 400, 400)
    指针移动(420, 430)
    松开(420, 430)
    await flush()
    expect(变换()).toBe("translate(20 30) scale(1)")
    点选("n1", 200, 100)
    await flush()

    const 撤销键 = () => 取("[data-slot='hgraph-undo']") as HTMLButtonElement
    expect(撤销键().disabled).toBe(true)

    进入演示()
    await flush()
    const 父 = 舞台()!
    按键(父, { key: " " })
    按键(父, { key: " " })
    按键(父, { key: "Backspace" })
    await 过防抖()

    // 进入 / 步进：零写盘、撤销栈一步都没压。
    expect(写们.length).toBe(0)
    // 退出后：视口不变、选中恢复成进入前那个。
    按键(父, { key: "Escape" })
    await flush()
    expect(写们.length).toBe(0)
    expect(变换()).toBe("translate(20 30) scale(1)")
    expect(节点组("n1")!.getAttribute("data-selected")).toBe("true")
    expect(撤销键().disabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 只读画布：演示态的编辑快捷键闸（M1，直接对画布断言「动作表零调用」）
// ---------------------------------------------------------------------------

describe("只读画布 · 编辑快捷键完全静默（M1）", () => {
  function 挂只读画布() {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const 幽 = 幽灵动作表()
    挂过的.push(
      render(
        () => <画布组件 文档={步进图()} 选中={["n3"]} 模式="指针" 动作={幽.动作} 只读={true} />,
        host,
      ),
    )
    return 幽
  }

  test("M1 演示中把 Delete / Ctrl+Z / Ctrl+Shift+Z / F2 派发到画布：动作表零调用、节点仍在", async () => {
    const 幽 = 挂只读画布()
    await flush()
    const 布 = 画布()!
    expect(布.getAttribute("data-readonly")).toBe("true")

    // 选中刻意非空：若没有只读闸，Delete / F2 会真的走动作表（不是被空选中凑巧挡掉）。
    按键(布, { key: "Delete" })
    按键(布, { key: "z", ctrlKey: true })
    按键(布, { key: "z", ctrlKey: true, shiftKey: true })
    按键(布, { key: "F2" })
    await flush()

    expect(幽.计数).toEqual({})
    expect(节点组("n3")).not.toBeNull()
  })
})
