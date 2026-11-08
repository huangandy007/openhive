import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { Graph, 自动位置, 布局, 画布 } from "./graph"
import type { CaseDetailApi, 图节点, 图边, 关系图结果 } from "../case-detail-api"
import { 订阅会话输入 } from "@/ai-session/send-to-session"

async function 等(条件: () => boolean) {
  for (let i = 0; i < 100; i += 1) {
    if (条件()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("等超时：条件始终没成立")
}
function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}
/**
 * 敲 Escape。
 * ⚠️ 必须派在 `document` 上且 `bubbles`：Kobalte 的浮层把 Escape 听在 `document`，
 * 而派在 `window` 上的事件只到 `window`（不会往下走），菜单会假装「关不掉」。
 * 派在 `document` 冒泡则两处都到（document → window），原先听 `window` 的用例照旧。
 */
function 按Esc() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
}
afterEach(() => {
  document.body.innerHTML = ""
  订阅会话输入(undefined)
})

const 图: 关系图结果 = {
  节点: [
    { id: "e-张", type: "人", value: "张三", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 2, 度数: 2 },
    { id: "e-李", type: "人", value: "李四", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1, 度数: 1 },
    { id: "e-号", type: "号码", subtype: "手机号", value: "13800000001", trust_state: "已确认", 中心: false, 跳数: 1, 关联数: 3, 度数: 3 },
    { id: "e-账", type: "账户", value: "6222****0001", trust_state: "存疑", 中心: false, 跳数: 2, 关联数: 1, 度数: 1 },
    { id: "e-地", type: "地点", value: "湖州市吴兴区", trust_state: "自动抽取", 中心: false, 跳数: 2, 关联数: 1, 度数: 1 },
  ],
  边: [
    { id: "r-1", from: "e-张", to: "e-李", type: "通话", times: 3, amount: null, trust_state: "自动抽取", 明细数: 1 },
    { id: "r-2", from: "e-张", to: "e-号", type: "实际使用", times: 1, amount: null, trust_state: "自动抽取", 明细数: 1 },
    { id: "r-3", from: "e-号", to: "e-账", type: "通话", times: 30, amount: null, trust_state: "自动抽取", 明细数: 1 },
    { id: "r-4", from: "e-号", to: "e-地", type: "转账", times: 1, amount: "100.00", trust_state: "自动抽取", 明细数: 1 },
  ],
  缺口: ["节点上限 50，可能还有更多"],
}

function 假api(over: Partial<CaseDetailApi> = {}): CaseDetailApi {
  return {
    profile: async () => ({ kind: "error", message: "未用" }),
    materialFacts: async () => ({ kind: "error", message: "未用" }),
    timeline: async () => ({ kind: "ok", value: { 数据: [] } }),
    money: async () => ({ kind: "ok", value: { 数据: {} } }),
    graph: async () => ({ kind: "ok", value: 图 }),
    review: async () => ({ kind: "error", message: "本用例不取复核" }),
    trust: async () => ({ kind: "error", message: "本用例不裁决" }),
    ...over,
  }
}

/**
 * 按中心返回不同的图：钉「原地换中心」得能看见**取谁**、**换了什么**。
 * 一图两条节点（中心 ＋ 一个邻居），两条图的邻居不同 ⇒ 「旧图还在不在」判得出来。
 */
function 按中心取图() {
  const 调用: Array<{ id: string; 跳数: 1 | 2 | undefined; 类型: readonly string[] | undefined }> = []
  const 造 = (id: string): 关系图结果 => {
    if (id === "e-号")
      return {
        节点: [
          { id: "e-号", type: "号码", subtype: "手机号", value: "13800000001", trust_state: "已确认", 中心: true, 跳数: 0, 关联数: 1, 度数: 1 },
          { id: "e-赵", type: "人", value: "赵六", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1, 度数: 1 },
        ],
        边: [{ id: "r-x", from: "e-号", to: "e-赵", type: "通话", times: 2, amount: null, trust_state: "自动抽取", 明细数: 1 }],
        缺口: [],
      }
    return {
      节点: [
        { id: "e-张", type: "人", value: "张三", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 1, 度数: 1 },
        { id: "e-号", type: "号码", subtype: "手机号", value: "13800000001", trust_state: "已确认", 中心: false, 跳数: 1, 关联数: 1, 度数: 1 },
      ],
      边: [{ id: "r-y", from: "e-张", to: "e-号", type: "实际使用", times: 1, amount: null, trust_state: "自动抽取", 明细数: 1 }],
      缺口: [],
    }
  }
  const api = 假api({
    graph: async (_projectId, id, 跳数, 类型) => {
      调用.push({ id, 跳数, 类型 })
      return { kind: "ok", value: 造(id) }
    },
  })
  return { api, 调用 }
}

const 点元素 = (host: HTMLElement, id: string) =>
  host.querySelector<SVGGElement>(`[data-slot='graph-node'][data-node-id='${id}']`)!
const 边元素 = (host: HTMLElement, id: string) =>
  host.querySelector<SVGGElement>(`[data-slot='graph-edge'][data-edge-id='${id}']`)!

/**
 * ── 右键菜单的探针（Kobalte `ContextMenu`）──────────────────────────────────
 *
 * 与 `ai-session/session-list.test.tsx` 那套同形，两条硬约束照抄：
 * - 菜单 **Portal 到 `document.body`**，不在 `host` 里 ⇒ 一律查 `document`；
 * - 关闭时**先播退场动画才卸载**，happy-dom 没有 CSS 引擎 ⇒ 元素关掉也还在
 *   ⇒ 判「开着」只能看 `data-expanded`，不能看元素在不在。
 */
const 菜单内容 = () => document.querySelector<HTMLElement>("[data-component='context-menu-content']")
const 菜单开着 = () => 菜单内容()?.hasAttribute("data-expanded") ?? false
/** 点菜单项：Kobalte 在 `pointerup` 上选中，单发 `.click()` 不够（`file-tree.test.tsx` 实测）。 */
const 点菜单项 = (动作: string) => {
  // ⚠️ 用 `data-action` 不用 `data-slot`：`ContextMenu.Item` 把 `data-slot="context-menu-item"`
  //    **硬写在 `{...rest}` 之后**，传进去的自定义 `data-slot` 会被覆盖（与 `ContextMenu.Trigger` 同一条）。
  const 项 = 菜单内容()?.querySelector<HTMLElement>(`[data-action='${动作}']`)
  if (!项) throw new Error(`菜单里没有「${动作}」——这条用例的前提不成立`)
  for (const 类型 of ["pointerdown", "pointerup"])
    项.dispatchEvent(new PointerEvent(类型, { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true }))
}
const 右键 = (el: Element) =>
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
/** 让 `requestAnimationFrame` 与菜单那边的 `setTimeout(0)` 都跑完（同 `session-list.test.tsx`）。 */
const 冲刷 = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("关系图 · 布局", () => {
  test("每个节点都落在画布内，且不重叠、不挤成一条竖线（视口外那半个图是真实缺陷）", () => {
    // 旧实现：viewBox 0 0 640 420，外环半径恒 250 ⇒ 单节点落在 cy = 210 - 250 = -40，
    // 屏幕外；多个环都从 -90° 起排，节点少时全叠在一条竖线上。
    // 变异靶子：把环半径改回固定值或去掉画布边距，这条必须红。
    const 节点: 图节点[] = [{ id: "c", type: "人", value: "中心", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 20, 度数: 20 }]
    for (let i = 0; i < 8; i += 1)
      节点.push({ id: `a-${i}`, type: i % 2 === 0 ? "号码" : "人", value: `内环${i}`, trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1, 度数: 1 })
    for (let i = 0; i < 12; i += 1)
      节点.push({ id: `b-${i}`, type: i % 3 === 0 ? "账户" : "地点", value: `外环${i}`, trust_state: "自动抽取", 中心: false, 跳数: 2, 关联数: 1, 度数: 1 })
    const 位 = 布局({ 节点, 边: [], 缺口: [] })
    const 全 = [...位.中心, ...位.一层, ...位.二层]
    expect(全).toHaveLength(21)
    for (const 点 of 全) {
      expect(点.x).toBeGreaterThanOrEqual(40)
      expect(点.x).toBeLessThanOrEqual(画布.宽 - 40)
      expect(点.y).toBeGreaterThanOrEqual(40)
      expect(点.y).toBeLessThanOrEqual(画布.高 - 40)
    }
    const 坐标 = 全.map((点) => `${Math.round(点.x)},${Math.round(点.y)}`)
    expect(new Set(坐标).size).toBe(坐标.length)
    expect(new Set(位.一层.map((点) => Math.round(点.x))).size).toBeGreaterThan(2)
  })

  test("1 个 1 跳 + 2 个 2 跳时，三点不排成一条竖线（真实数据：张三 加 3 个号码）", () => {
    // 真实库的 2 跳回包就是「中心 + 1 个号码 + 2 个外围号码」。环都从 -90° 起排的话，
    // 三个点会叠在 x = 中心 的一条竖线上，边也完全重叠（真栈实测的第一版截图就是这样）。
    const 位 = 布局({
      节点: [
        { id: "c", type: "人", value: "张三", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 1, 度数: 1 },
        { id: "a", type: "号码", value: "0001", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 3, 度数: 3 },
        { id: "b", type: "号码", value: "0002", trust_state: "自动抽取", 中心: false, 跳数: 2, 关联数: 1, 度数: 1 },
        { id: "d", type: "号码", value: "0003", trust_state: "自动抽取", 中心: false, 跳数: 2, 关联数: 1, 度数: 1 },
      ],
      边: [],
      缺口: [],
    })
    const 全 = [...位.中心, ...位.一层, ...位.二层]
    expect(全).toHaveLength(4)
    expect(new Set(全.map((点) => Math.round(点.x))).size).toBeGreaterThanOrEqual(3)
  })

  test("1 跳在内环、2 跳在外环（外环比内环离中心更远）", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 距 = (id: string) => {
      const 点 = 点元素(host, id)
      const x = Number(点.getAttribute("data-node-x"))
      const y = Number(点.getAttribute("data-node-y"))
      return Math.hypot(x - 画布.宽 / 2, y - 画布.高 / 2)
    }
    expect(距("e-号")).toBeLessThan(距("e-地"))
    expect(点元素(host, "e-地").getAttribute("data-hop")).toBe("2")
  })
})

describe("关系图 · 画", () => {
  test("节点与边都画出来：中心带 data-center，边按 from→to 画", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    expect(点元素(host, "e-张").getAttribute("data-center")).toBe("true")
    const 边们 = [...host.querySelectorAll("[data-slot='graph-edge']")]
    expect(边们.map((边) => 边.getAttribute("data-edge-id")).sort()).toEqual(["r-1", "r-2", "r-3", "r-4"])
    // 类型筛选按钮上有类型名与计数，图本身不再挂一串纯文本边标签。
    expect(host.textContent).toContain("转账")
    expect(host.querySelectorAll("[data-slot='graph-edge-label']").length).toBe(0)
  })

  test("按类型换形状：人=圆、号码=圆角块、账户=六边形、地点=菱形", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    expect(点元素(host, "e-李").querySelector("circle")).not.toBeNull()
    expect(点元素(host, "e-号").querySelector("rect")).not.toBeNull()
    expect(点元素(host, "e-账").querySelector("polygon")!.getAttribute("points")!.trim().split(/\s+/)).toHaveLength(6)
    expect(点元素(host, "e-地").querySelector("polygon")!.getAttribute("points")!.trim().split(/\s+/)).toHaveLength(4)
  })

  test("节点上的图标：细类优先、回退大类、认不出就不画（内网没有「取不到图标」这回事，图标是内联 path）", async () => {
    const 行 = (id: string, type: string, value: string, subtype?: string): 图节点 => ({
      id,
      type,
      ...(subtype === undefined ? {} : { subtype }),
      value,
      trust_state: "自动抽取",
      中心: false,
      跳数: 1,
      关联数: 1, 度数: 1,
    })
    const 节点: 图节点[] = [
      { id: "e-心", type: "人", value: "中心", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 9, 度数: 9 },
      行("e-手", "号码", "13800000001", "手机号"),
      行("e-座", "号码", "0572-1234567", "固定电话"),
      行("e-证", "号码", "330502199001011234", "身份证"),
      行("e-号", "号码", "0572-7654321"),
      行("e-卡", "账户", "6222020000000001", "银行卡"),
      行("e-账", "账户", "6222020000000002", "银行账号"),
      行("e-付", "账户", "1234567890", "第三方支付"),
      行("e-账二", "账户", "6222020000000003"),
      行("e-邮", "虚拟身份", "a@b.cn", "邮箱"),
      行("e-聊", "虚拟身份", "wx-1234", "微信"),
      行("e-地", "地点", "城东茶馆"),
      行("e-组", "组织", "甲银行"),
      行("e-怪", "船舶", "浙湖渔00001"),
    ]
    // ⚠️ 一条边都没有时画布会落到「还没有关系」那一档（不画节点），所以这里每个邻居都连到中心。
    const 数据: 关系图结果 = {
      节点,
      边: 节点
        .filter((点) => !点.中心)
        .map((点, 序) => ({
          id: `r-${序}`,
          from: "e-心",
          to: 点.id,
          type: "通话",
          times: 1,
          amount: null,
          trust_state: "自动抽取",
          明细数: 1,
        })),
      缺口: [],
    }
    const host = mount(() => (
      <Graph projectId="p" id="e-心" api={假api({ graph: async () => ({ kind: "ok", value: 数据 }) })} onOpenEntity={() => {}} />
    ))
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 14)

    const 图标 = (id: string) =>
      host.querySelector<SVGGElement>(`[data-slot='graph-node'][data-node-id='${id}'] [data-slot='graph-node-icon']`)
    const 图标名 = (id: string) => 图标(id)?.getAttribute("data-icon") ?? null

    // 细类优先：同为「号码」，手机 / 座机 / 证件各画各的。
    expect([图标名("e-手"), 图标名("e-座"), 图标名("e-证")]).toEqual(["smartphone", "phone", "id-card"])
    expect([图标名("e-卡"), 图标名("e-账"), 图标名("e-付")]).toEqual(["credit-card", "landmark", "wallet"])
    expect([图标名("e-邮"), 图标名("e-聊")]).toEqual(["mail", "chat"])
    // 大类兜底：认不出细类时不许「什么都不画」，用大类图标。
    expect([图标名("e-号"), 图标名("e-账二"), 图标名("e-地"), 图标名("e-组")]).toEqual([
      "hash",
      "wallet",
      "pin",
      "building",
    ])
    // 大类也不认识 ⇒ 不画图标，但形状照画（宁可少一个图标，不许出现空框）。
    expect(图标名("e-怪")).toBeNull()
    expect(点元素(host, "e-怪").querySelector("[data-slot='graph-node-shape']")).not.toBeNull()
    // 图标是内联 SVG path，不是 <image>/<use> 外链。
    expect(图标("e-手")!.querySelector("path, rect, circle, line")).not.toBeNull()
    expect(图标("e-手")!.querySelector("image, use")).toBeNull()
  })

  test("图例与画布用同一套图标（图例不教一套、画布画另一套）", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 条目 = [...host.querySelectorAll("[data-slot='graph-legend'] [data-slot='graph-legend-type']")]
    expect(条目.map((条目) => [条目.getAttribute("data-type"), 条目.getAttribute("data-icon")])).toEqual([
      ["人", "user"],
      ["号码", "hash"],
      ["账户", "wallet"],
      ["虚拟身份", "chat"],
      ["地点", "pin"],
      ["组织", "building"],
    ])
  })

  test("只有存疑/已排除的节点用虚线描边（已确认是可信态，不能跟着虚）；长值截断显示，悬停看全文", async () => {
    // 真实库里的四态：自动抽取 / 已确认 / 存疑 / 已排除。早先写成「非自动抽取就虚」会把每一条
    // 已确认的实体都画成虚线圈——虚线的含义是「这条得再看一眼」，不是「不是机器抽的」。
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 存疑 = 点元素(host, "e-账").querySelector("polygon")!
    expect(存疑.getAttribute("stroke-dasharray")).toBe("4 3")
    expect(点元素(host, "e-李").querySelector("circle")!.getAttribute("stroke-dasharray")).toBeNull()
    expect(点元素(host, "e-号").querySelector("rect")!.getAttribute("stroke-dasharray")).toBeNull()
    expect(点元素(host, "e-号").querySelector("title")!.textContent).toBe("13800000001")
  })

  test("边的粗细随次数分档（30 次的通话比 3 次粗）", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 宽 = (id: string) => Number(边元素(host, id).querySelector("[data-slot='graph-edge-line']")!.getAttribute("stroke-width"))
    expect(宽("r-3")).toBeGreaterThan(宽("r-1"))
  })
})

describe("关系图 · 悬停", () => {
  test("悬停节点：它和邻居保持原样，其余节点与边降到 25%，并出提示（类型/可信/关联数）", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    点元素(host, "e-号").dispatchEvent(new MouseEvent("mouseenter"))

    // e-号 的邻居：e-张、e-账、e-地；e-李 与它无关。
    expect(点元素(host, "e-李").getAttribute("opacity")).toBe("0.25")
    expect(点元素(host, "e-张").getAttribute("opacity")).toBeNull()
    expect(点元素(host, "e-账").getAttribute("opacity")).toBeNull()
    expect(边元素(host, "r-1").getAttribute("opacity")).toBe("0.25")
    expect(边元素(host, "r-3").getAttribute("opacity")).toBeNull()

    const 提示 = host.querySelector("[data-slot='graph-tip']")!
    expect(提示.textContent).toContain("13800000001")
    expect(提示.textContent).toContain("号码")
    expect(提示.textContent).toContain("已确认")
    expect(提示.textContent).toContain("关联 3")

    点元素(host, "e-号").dispatchEvent(new MouseEvent("mouseleave"))
    expect(点元素(host, "e-李").getAttribute("opacity")).toBeNull()
    expect(host.querySelector("[data-slot='graph-tip']")).toBeNull()
  })

  test("悬停边：线加粗并出提示（类型/次数），不改变节点透明度", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 原宽 = Number(边元素(host, "r-1").querySelector("[data-slot='graph-edge-line']")!.getAttribute("stroke-width"))
    边元素(host, "r-1").dispatchEvent(new MouseEvent("mouseenter"))
    const 新宽 = Number(边元素(host, "r-1").querySelector("[data-slot='graph-edge-line']")!.getAttribute("stroke-width"))
    expect(新宽).toBeGreaterThan(原宽)
    const 提示 = host.querySelector("[data-slot='graph-tip']")!
    expect(提示.textContent).toContain("通话")
    expect(提示.textContent).toContain("3 次")
    expect(点元素(host, "e-李").getAttribute("opacity")).toBeNull()
  })
})

describe("关系图 · 检视面板", () => {
  test("点节点开右侧面板：显示类型/可信/跳数/关联数；「打开档案」把整条节点交给上层", async () => {
    const 收到: 图节点[] = []
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={(点) => 收到.push(点)} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    点元素(host, "e-李").dispatchEvent(new MouseEvent("click", { bubbles: true }))

    const 面板 = host.querySelector("[data-slot='graph-panel']")!
    expect(面板.getAttribute("data-panel-kind")).toBe("node")
    expect(host.querySelector("[data-slot='graph-panel-title']")!.textContent).toContain("李四")
    expect(面板.textContent).toContain("自动抽取")
    expect(面板.textContent).toContain("1 跳")
    expect(面板.textContent).toContain("1 条")
    expect(收到).toHaveLength(0)

    host.querySelector<HTMLElement>("[data-slot='graph-panel-open']")!.click()
    expect(收到).toHaveLength(1)
    // ⚠️ 断言**整条节点**：上层拼标题要用 `value` / `type`，只传 `{ id }` 的桩会照样绿。
    expect(收到[0]).toMatchObject({ id: "e-李", type: "人", value: "李四", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1 })
  })

  test("悬停提示与检视面板都显示细类；判不出细类的节点不硬造", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    // 悬停：细类与信任态同一行，号码这个值本身仍在第一行
    点元素(host, "e-号").dispatchEvent(new MouseEvent("mouseenter"))
    const 提示 = host.querySelector("[data-slot='graph-tip']")!
    expect(提示.textContent).toContain("手机号")
    expect(提示.textContent).toContain("13800000001")
    // 检视面板：断**那一整格**，不拿整块面板的 textContent 做子串匹配（`#006-22`）
    点元素(host, "e-号").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(host.querySelector("[data-slot='graph-panel-subtitle']")!.textContent).toBe("号码 · 手机号 · 已确认")
    // 人没有细类：分隔符与空串都不能留下痕迹
    点元素(host, "e-李").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(host.querySelector("[data-slot='graph-panel-subtitle']")!.textContent).toBe("人 · 自动抽取")
  })

  /**
   * 面板标题旁「复制」（2026-11-07 用户下达）：图上节点标签是**截断**的（`4301231967...`），
   * 全文只在面板里 ⇒ 要能一键拿全文。只复制**值**本身（用户裁定），不带类型/跳数。
   */
  test("面板标题旁「复制」⇒ 值原样进剪贴板；按钮变「已复制」，过后自己复位", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    点元素(host, "e-号").dispatchEvent(new MouseEvent("click", { bubbles: true }))

    // 自己装一个剪贴板记录器，用完还原：**不读环境里那份**——`audit-log.test.tsx` 装过一个
    // 只有 `writeText` 的替身且没还原，全量跑时 `navigator.clipboard.readText` 干脆不存在
    // （2026-11-07 实测：单跑本文件绿、全量红 `readText is not a function`）。
    // 前提：happy-dom 没有 `execCommand`（`copy-text.test.ts` 实测）⇒ `复制文本` 一定走到这里。
    expect(typeof document.execCommand).toBe("undefined")
    const 原生剪贴板 = navigator.clipboard
    const 写入: string[] = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (文字: string) => void 写入.push(文字) },
    })
    try {
      const 钮 = host.querySelector<HTMLElement>("[data-slot='graph-copy-value']")!
      expect(钮.textContent).toBe("复制")
      钮.click()
      await 等(() => 钮.textContent === "已复制")
      expect(写入).toEqual(["13800000001"])

      // 复位：挂着「已复制」不复位，第二次复制就没有任何反馈了。
      for (let i = 0; i < 250 && 钮.textContent !== "复制"; i += 1) await new Promise((r) => setTimeout(r, 10))
      expect(钮.textContent).toBe("复制")
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: 原生剪贴板 })
    }
  })

  test("面板「以此为中心」也是原地换中心；中心节点自己不显示这个按钮", async () => {
    const { api, 调用 } = 按中心取图()
    const host = mount(() => <Graph projectId="p" id="e-张" api={api} onOpenEntity={() => {}} />)
    await 等(() => host.querySelector("[data-slot='graph-node'][data-node-id='e-号']") !== null)

    点元素(host, "e-号").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    host.querySelector<HTMLElement>("[data-slot='graph-panel-focus']")!.click()
    await 等(() => 调用.length === 2)
    expect(调用[1]!.id).toBe("e-号")

    // 已经是中心的那条：面板里不该再给「以此为中心」（没有可钻的下一层）
    await 等(() => host.querySelector("[data-slot='graph-node'][data-node-id='e-号']") !== null)
    点元素(host, "e-号").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(host.querySelector("[data-slot='graph-panel-focus']")).toBeNull()
  })

  /**
   * 右键节点 ⇒ 就地呼出下钻（2026-11-07 用户下达）。
   *
   * 能力本来就有（右侧面板的「以此为中心」），长在面板里要多两步才能用；右键把它挪到指针底下。
   * 同日裁定：「以此为中心」是**在这张图里换中心**，不再交给上层开一条新 tab。
   * 三条用例各钉一件事：作用对象是**右键的那个节点**、下钻是原地换图、空白处不弹。
   */
  test("右键节点 ⇒ 菜单作用于它；「以此为中心」原地换中心（重新取数，不开新 tab）", async () => {
    const { api, 调用 } = 按中心取图()
    const host = mount(() => <Graph projectId="p" id="e-张" api={api} onOpenEntity={() => {}} />)
    await 等(() => host.querySelector("[data-slot='graph-node'][data-node-id='e-号']") !== null)
    expect(调用.map((条) => 条.id)).toEqual(["e-张"])

    // 先把跳数拨到 2：跳数与类型筛选是**查看偏好**，换中心时该留着（用户裁定）。
    host.querySelector<HTMLElement>("[data-slot='graph-hop'][data-hop='2']")!.click()
    await 等(() => 调用.length === 2)

    右键(点元素(host, "e-号"))
    await 等(() => 菜单开着())
    // 右键同时选中：菜单的对象、图上高亮、右侧面板必须是同一个（否则「菜单说的是 A、圈亮在 B」）
    expect(host.querySelector("[data-slot='graph-panel']")?.getAttribute("data-panel-kind")).toBe("node")
    expect(host.querySelector("[data-slot='graph-panel-title']")!.textContent).toContain("13800000001")

    点菜单项("graph-node-menu-recenter")
    await 等(() => 调用.length === 3)

    // ① 取的是「以 e-号为中」，且跳数偏好跟着走（没被写回 1）
    expect(调用[2]).toMatchObject({ id: "e-号", 跳数: 2 })
    // ② 新中心这一圈并进来了
    await 等(() => host.querySelector("[data-slot='graph-node'][data-node-id='e-赵']") !== null)
    // ③ **原来的点不消失**（2026-11-07 追加要求：同一张图里越并越多，不是换一页）
    expect(host.querySelector("[data-slot='graph-node'][data-node-id='e-张']")).not.toBeNull()
    // ④ 头部说得出「现在中心是谁」（tab 标题仍是外面那条，不在图上标出来就会迷路）
    expect(host.querySelector("[data-slot='graph-center']")!.textContent).toContain("13800000001")
    // ⑤ 选中也留着：被右键的那条还在图上，面板不该自己关掉
    expect(host.querySelector("[data-slot='graph-panel']")?.getAttribute("data-panel-kind")).toBe("node")
  })

  test("换跳数 ⇒ 清空重来：只留当前中心这一圈（用户裁定，图上一定符合当前筛选）", async () => {
    const { api, 调用 } = 按中心取图()
    const host = mount(() => <Graph projectId="p" id="e-张" api={api} onOpenEntity={() => {}} />)
    await 等(() => host.querySelector("[data-slot='graph-node'][data-node-id='e-号']") !== null)

    右键(点元素(host, "e-号"))
    await 等(() => 菜单开着())
    点菜单项("graph-node-menu-recenter")
    await 等(() => host.querySelector("[data-slot='graph-node'][data-node-id='e-赵']") !== null)
    // 先证明「并进来了」，否则下面那条「旧点没了」会因为一开始就没有而空转（`#005-18`）
    expect(host.querySelector("[data-slot='graph-node'][data-node-id='e-张']")).not.toBeNull()

    host.querySelector<HTMLElement>("[data-slot='graph-hop'][data-hop='2']")!.click()
    await 等(() => 调用.length === 3)
    expect(调用[2]).toMatchObject({ id: "e-号", 跳数: 2 })
    await 等(() => host.querySelector("[data-slot='graph-node'][data-node-id='e-张']") === null)
    expect(host.querySelector("[data-slot='graph-node'][data-node-id='e-赵']")).not.toBeNull()
  })

  test("「返回」回到上一个中心：再取一次数，回到起点后按钮消失", async () => {
    const { api, 调用 } = 按中心取图()
    const host = mount(() => <Graph projectId="p" id="e-张" api={api} onOpenEntity={() => {}} />)
    await 等(() => host.querySelector("[data-slot='graph-node'][data-node-id='e-号']") !== null)

    右键(点元素(host, "e-号"))
    await 等(() => 菜单开着())
    点菜单项("graph-node-menu-recenter")
    await 等(() => 调用.length === 2)
    await 等(() => host.querySelector("[data-slot='graph-node'][data-node-id='e-赵']") !== null)

    // 按钮得说得出「回到谁」——来路里存的是**离开时的中心名**，不是图上现在能找到的东西
    const 返回钮 = host.querySelector<HTMLButtonElement>("[data-slot='graph-back']")!
    expect(返回钮.textContent).toContain("张三")

    返回钮.click()
    await 等(() => 调用.length === 3)
    expect(调用[2]!.id).toBe("e-张")
    await 等(() => host.querySelector("[data-slot='graph-node'][data-node-id='e-张']") !== null)
    // 返回 = 只挪中心，节点不退（用户裁定）⇒ 李四那一圈还在图上
    expect(host.querySelector("[data-slot='graph-node'][data-node-id='e-赵']")).not.toBeNull()
    // 回到起点 ⇒ 没有上一级了，按钮收掉
    expect(host.querySelector("[data-slot='graph-back']")).toBeNull()
  })

  test("右键节点 ⇒「打开档案」也是同一个对象", async () => {
    const 收到: 图节点[] = []
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={(点) => 收到.push(点)} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)

    右键(点元素(host, "e-李"))
    await 等(() => 菜单开着())
    点菜单项("graph-node-menu-open")
    await 等(() => 收到.length === 1)

    expect(收到[0]).toMatchObject({ id: "e-李", value: "李四" })
  })

  test("空白处右键不弹这个菜单（没有作用对象就不该给一个只能按禁用的菜单）", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)

    // 正对照：先在节点上右键证明「这个菜单确实能开」——否则下面那条 `不能开` 会因为
    // 「菜单压根没接」而永远绿（`#005-18` 假绿四问里的「空转」）。
    右键(点元素(host, "e-李"))
    await 等(() => 菜单开着())
    按Esc()
    await 冲刷()
    expect(菜单开着()).toBe(false)

    右键(host.querySelector("[data-slot='graph-canvas']")!)
    await 冲刷()

    expect(菜单开着()).toBe(false)
  })

  test("点边开面板：类型/次数/金额/方向；两端各一个「打开档案」", async () => {
    const 收到: 图节点[] = []
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={(点) => 收到.push(点)} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    边元素(host, "r-4").dispatchEvent(new MouseEvent("click", { bubbles: true }))

    const 面板 = host.querySelector("[data-slot='graph-panel']")!
    expect(面板.getAttribute("data-panel-kind")).toBe("edge")
    expect(面板.textContent).toContain("转账")
    expect(面板.textContent).toContain("1 次")
    expect(面板.textContent).toContain("100.00 元")
    expect(面板.textContent).toContain("13800000001 → 湖州市吴兴区")

    const 按钮 = [...host.querySelectorAll<HTMLElement>("[data-slot='graph-panel-open']")]
    expect(按钮.map((项) => 项.getAttribute("data-entity-id"))).toEqual(["e-号", "e-地"])
    按钮[1]!.click()
    expect(收到.map((点) => 点.id)).toEqual(["e-地"])
  })

  test("按 Esc 收掉面板；换跳数后选中的节点不在了也自动收掉", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    点元素(host, "e-李").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(host.querySelector("[data-slot='graph-panel']")).not.toBeNull()
    按Esc()
    await 等(() => host.querySelector("[data-slot='graph-panel']") === null)

    // 服务端在新跳数下不再返回 e-账：面板不能继续显示一个图里没有的节点。
    const 无账 = { ...图, 节点: 图.节点.filter((点) => 点.id !== "e-账"), 边: 图.边.filter((边) => 边.id !== "r-3") }
    const host2 = mount(() => (
      <Graph
        projectId="p"
        id="e-张"
        api={假api({ graph: async (_项目, _id, 跳) => ({ kind: "ok", value: 跳 === 2 ? 无账 : 图 }) })}
        onOpenEntity={() => {}}
      />
    ))
    await 等(() => host2.querySelectorAll("[data-slot='graph-node']").length === 5)
    点元素(host2, "e-账").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(host2.querySelector("[data-slot='graph-panel']")).not.toBeNull()
    host2.querySelector<HTMLElement>("[data-slot='graph-hop'][data-hop='2']")!.click()
    await 等(() => host2.querySelectorAll("[data-slot='graph-node']").length === 4)
    expect(host2.querySelector("[data-slot='graph-panel']")).toBeNull()
  })
})

describe("关系图 · 缩放平移", () => {
  test("＋/－ 改变换矩阵，适应复位；Esc 不影响缩放", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 视口 = () => host.querySelector("[data-slot='graph-viewport']")!
    expect(视口().getAttribute("transform")).toBe("translate(0 0) scale(1)")

    host.querySelector<HTMLElement>("[data-slot='graph-zoom'][data-zoom='in']")!.click()
    expect(视口().getAttribute("transform")).toMatch(/scale\(1\.25\)$/)
    host.querySelector<HTMLElement>("[data-slot='graph-zoom'][data-zoom='in']")!.click()
    expect(视口().getAttribute("transform")).toMatch(/scale\(1\.5625\)$/)
    host.querySelector<HTMLElement>("[data-slot='graph-zoom'][data-zoom='fit']")!.click()
    expect(视口().getAttribute("transform")).toBe("translate(0 0) scale(1)")
  })
})

describe("关系图 · 工具栏", () => {
  test("切 2 跳 ⇒ api 收到 跳数 2", async () => {
    const 调用: Array<1 | 2 | undefined> = []
    const api = 假api({
      graph: async (_projectId, _id, 跳数) => {
        调用.push(跳数)
        return { kind: "ok", value: 图 }
      },
    })
    const host = mount(() => <Graph projectId="p" id="e-张" api={api} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    host.querySelector<HTMLElement>("[data-slot='graph-hop'][data-hop='2']")!.click()
    await 等(() => 调用.length === 2)
    expect(调用.at(-1)).toBe(2)
  })

  test("类型筛选按钮带计数；服务端按类型过滤后，别的类型按钮仍然在（不会变成单选死锁）", async () => {
    const 调用: Array<readonly string[] | undefined> = []
    const api = 假api({
      graph: async (_projectId, _id, _跳数, 类型) => {
        调用.push(类型)
        const 边们 = 类型 === undefined || 类型.length === 0 ? 图.边 : 图.边.filter((边) => 类型.includes(边.type))
        return { kind: "ok", value: { ...图, 边: 边们 } }
      },
    })
    const host = mount(() => <Graph projectId="p" id="e-张" api={api} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-type']").length === 3)

    const 文本 = (类型: string) => host.querySelector(`[data-slot='graph-type'][data-type='${类型}']`)!.textContent!
    expect(文本("通话")).toContain("2")
    expect(文本("通话")).toContain("通话")
    expect(文本("转账")).toContain("1")

    host.querySelector<HTMLElement>("[data-slot='graph-type'][data-type='转账']")!.click()
    await 等(() => 调用.length === 2 && host.querySelectorAll("[data-slot='graph-edge']").length === 1)

    // 回包只剩「转账」一条边，但通话/实际使用的按钮仍在（计数用见过的最大值累加）。
    expect(host.querySelectorAll("[data-slot='graph-type']").length).toBe(3)
    const 转账按钮 = host.querySelector<HTMLElement>("[data-slot='graph-type'][data-type='转账']")!
    expect(转账按钮.getAttribute("aria-pressed")).toBe("true")

    转账按钮.click()
    await 等(() => 调用.length === 3 && host.querySelectorAll("[data-slot='graph-edge']").length === 4)
    expect(调用.at(-1)!.length).toBe(0)
  })
})

describe("关系图 · 边界", () => {
  test("边的端点不在节点里 ⇒ 那条边不画，也不抛", async () => {
    const host = mount(() => (
      <Graph
        projectId="p"
        id="e-张"
        api={假api({
          graph: async () => ({
            kind: "ok",
            value: {
              节点: [图.节点[0]!],
              边: [{ id: "r-悬空", from: "e-张", to: "e-缺", type: "通话", times: 1, amount: null, trust_state: "自动抽取", 明细数: 1 }],
              缺口: [],
            },
          }),
        })}
        onOpenEntity={() => {}}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 1)
    expect(host.querySelectorAll("[data-slot='graph-edge']").length).toBe(0)
  })

  test("缺口如实说", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.textContent!.includes("节点上限 50"))
  })

  test("一个邻居都没有 ⇒ 说「还没有关系」", async () => {
    const host = mount(() => (
      <Graph
        projectId="p"
        id="e-张"
        api={假api({ graph: async () => ({ kind: "ok", value: { 节点: [图.节点[0]!], 边: [], 缺口: [] } }) })}
        onOpenEntity={() => {}}
      />
    ))
    await 等(() => host.textContent!.includes("还没有关系"))
  })

  test("换实体时迟到的旧回包不覆盖新实体（onCleanup 真的作废了旧请求）", async () => {
    const [项目, set项目] = createSignal("p1")
    const 待回: Array<(回: Awaited<ReturnType<CaseDetailApi["graph"]>>) => void> = []
    const api = 假api({
      graph: () => new Promise((resolve) => { 待回.push(resolve) }),
    })
    const host = mount(() => <Graph projectId={项目()} id="e-张" api={api} onOpenEntity={() => {}} />)
    await 等(() => 待回.length === 1)
    set项目("p2")
    await 等(() => 待回.length === 2)
    待回[1]!({
      kind: "ok",
      value: {
        节点: [
          { id: "e-新", type: "人", value: "新邻居", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 1, 度数: 1 },
          { id: "e-乙", type: "人", value: "乙", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1, 度数: 1 },
        ],
        边: [{ id: "r-新", from: "e-新", to: "e-乙", type: "通话", times: 1, amount: null, trust_state: "自动抽取", 明细数: 1 }],
        缺口: [],
      },
    })
    await 等(() => host.textContent!.includes("新邻居"))
    待回[0]!({
      kind: "ok",
      value: {
        节点: [
          { id: "e-旧", type: "人", value: "旧邻居", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 1, 度数: 1 },
          { id: "e-乙", type: "人", value: "乙", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1, 度数: 1 },
        ],
        边: [{ id: "r-旧", from: "e-旧", to: "e-乙", type: "通话", times: 1, amount: null, trust_state: "自动抽取", 明细数: 1 }],
        缺口: [],
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(host.textContent).not.toContain("旧邻居")
  })

  test("取数失败如实说", async () => {
    const host = mount(() => (
      <Graph projectId="p" id="e-张" api={假api({ graph: async () => ({ kind: "error", message: "找不到这个实体" }) })} onOpenEntity={() => {}} />
    ))
    await 等(() => host.textContent!.includes("找不到这个实体"))
  })

  test("取数抛异常 ⇒ 报出来并收掉「载入中」（不留一条 unhandled rejection）", async () => {
    const host = mount(() => (
      <Graph
        projectId="p"
        id="e-张"
        api={假api({
          graph: async () => {
            throw new Error("网络断了")
          },
        })}
        onOpenEntity={() => {}}
      />
    ))
    await 等(() => host.textContent!.includes("网络断了"))
    expect(host.textContent).not.toContain("正在读取关系")
  })
})

describe("关系图 · 排列模式与拖动", () => {
  const 大图: 关系图结果 = (() => {
    const 节点: 图节点[] = [{ id: "c", type: "人", value: "中心", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 20, 度数: 20 }]
    for (let i = 0; i < 8; i += 1)
      节点.push({ id: `a-${i}`, type: i % 2 === 0 ? "号码" : "人", value: `内环${i}`, trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1, 度数: 1 })
    for (let i = 0; i < 12; i += 1)
      节点.push({ id: `b-${i}`, type: i % 3 === 0 ? "账户" : "地点", value: `外环${i}`, trust_state: "自动抽取", 中心: false, 跳数: 2, 关联数: 1, 度数: 1 })
    const 边: 图边[] = 节点.slice(1).map((点, 序) => ({
      id: `r-${序}`,
      from: "c",
      to: 点.id,
      type: "通话",
      times: 1,
      amount: null,
      trust_state: "自动抽取",
      明细数: 1,
    }))
    return { 节点, 边, 缺口: [] }
  })()

  const 坐标 = (host: HTMLElement, id: string) => {
    const 点 = 点元素(host, id)
    return { x: Number(点.getAttribute("data-node-x")), y: Number(点.getAttribute("data-node-y")) }
  }

  /** 真事件派发：`<g>` 在 happy-dom 里没有 `.click()`；拖动走 mousedown → window mousemove → mouseup。 */
  function 拖动(元素: Element, 起: { x: number; y: number }, 终: { x: number; y: number }) {
    元素.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 起.x, clientY: 起.y }))
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 终.x, clientY: 终.y }))
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  }

  test("四种排列都把点放进画布内；网格/分层互不重叠；力导向同输入两次一致", () => {
    for (const 模式 of ["环形", "力导向", "分层", "网格"] as const) {
      const 位 = 自动位置(大图, 画布, 模式)
      expect(位).toHaveLength(21)
      for (const 点 of 位) {
        expect(点.x).toBeGreaterThanOrEqual(40)
        expect(点.x).toBeLessThanOrEqual(画布.宽 - 40)
        expect(点.y).toBeGreaterThanOrEqual(40)
        expect(点.y).toBeLessThanOrEqual(画布.高 - 40)
      }
      if (模式 === "网格" || 模式 === "分层") {
        const 坐标们 = 位.map((点) => `${Math.round(点.x)},${Math.round(点.y)}`)
        expect(new Set(坐标们).size).toBe(坐标们.length)
      }
    }
    // 力导向没有随机数：同一张图算两次必须一模一样（否则每次重绘整张图都在抖）。
    expect(自动位置(大图, 画布, "力导向")).toEqual(自动位置(大图, 画布, "力导向"))
  })

  test("分层按跳数分列：中心在最左、1 跳居中、2 跳在最右", () => {
    const 位 = 自动位置(大图, 画布, "分层")
    const 找 = (id: string) => 位.find((点) => 点.id === id)!
    expect(找("c").x).toBeLessThan(找("a-0").x)
    expect(找("a-0").x).toBeLessThan(找("b-0").x)
  })

  test("切换排列模式 ⇒ 节点换到新坐标，按钮亮起来", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 前 = 坐标(host, "e-李")
    host.querySelector<HTMLElement>("[data-slot='graph-layout'][data-layout='网格']")!.click()
    const 后 = 坐标(host, "e-李")
    expect(`${后.x},${后.y}`).not.toBe(`${前.x},${前.y}`)
    expect(host.querySelector("[data-slot='graph-layout'][data-layout='网格']")!.getAttribute("aria-pressed")).toBe("true")
    expect(host.querySelector("[data-slot='graph-layout'][data-layout='环形']")!.getAttribute("aria-pressed")).toBe("false")
    // 网格布局是纯函数的产物：界面画出来的就是 自动位置(网格) 那一份坐标。
    const 期望 = 自动位置(图, 画布, "网格").find((点) => 点.id === "e-李")!
    expect(后).toEqual({ x: Number(期望.x.toFixed(1)), y: Number(期望.y.toFixed(1)) })
  })

  test("拖节点：跟手移动、松手保留，且拖动不会被当成点击（不弹检视面板）", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 前 = 坐标(host, "e-李")
    const 元素 = 点元素(host, "e-李")
    拖动(元素, { x: 100, y: 100 }, { x: 160, y: 140 })
    const 后 = 坐标(host, "e-李")
    expect(后.x - 前.x).toBeCloseTo(60, 0)
    expect(后.y - 前.y).toBeCloseTo(40, 0)
    // 其余节点不动：拖的是节点，不是整张画布。
    expect(坐标(host, "e-号")).toEqual(
      (() => {
        const 位 = 自动位置(图, 画布, "环形").find((点) => 点.id === "e-号")!
        return { x: Number(位.x.toFixed(1)), y: Number(位.y.toFixed(1)) }
      })(),
    )
    // 拖完浏览器还会补一个 click：它不能把面板打开。
    点元素(host, "e-李").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(host.querySelector("[data-slot='graph-panel']")).toBeNull()
    // 拖过也不算「选中」：节点身上不该出现焦点环。
    expect(点元素(host, "e-李").querySelector("[data-slot='graph-node-focus']")).toBeNull()
    // 再看一次：没拖动过的点击仍然能选中（上一条的「吞掉」不能把下一条也吞了）。
    点元素(host, "e-李").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(host.querySelector("[data-slot='graph-panel'][data-panel-kind='node']")).not.toBeNull()
  })

  test("手动摆的位置跨数据刷新保留（「重排」之前不回到自动布局）", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    拖动(点元素(host, "e-李"), { x: 100, y: 100 }, { x: 140, y: 120 })
    const 摆过 = 坐标(host, "e-李")
    host.querySelector<HTMLElement>("[data-slot='graph-hop'][data-hop='2']")!.click()
    await 等(() => host.querySelector("[data-slot='graph-hop'][data-hop='2']")!.getAttribute("aria-pressed") === "true")
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    expect(坐标(host, "e-李")).toEqual(摆过)
  })

  test("「重排」把手动摆的位置清回自动布局", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 自动 = 坐标(host, "e-李")
    拖动(点元素(host, "e-李"), { x: 100, y: 100 }, { x: 160, y: 140 })
    expect(坐标(host, "e-李")).not.toEqual(自动)
    host.querySelector<HTMLElement>("[data-slot='graph-relayout']")!.click()
    expect(坐标(host, "e-李")).toEqual(自动)
  })

  test("换排列模式同样清掉手动位置（新排列按自动布局算）", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    拖动(点元素(host, "e-李"), { x: 100, y: 100 }, { x: 160, y: 140 })
    host.querySelector<HTMLElement>("[data-slot='graph-layout'][data-layout='分层']")!.click()
    const 期望 = 自动位置(图, 画布, "分层").find((点) => 点.id === "e-李")!
    expect(坐标(host, "e-李")).toEqual({ x: Number(期望.x.toFixed(1)), y: Number(期望.y.toFixed(1)) })
  })
})

/**
 * 框选多选 ＋ 整组拖动（2026-11-07 用户下达：「框选多个节点后整体移动」）。
 *
 * 手势与用户谈定：左键拖空白仍是平移；**Shift + 左键拖空白**才拉框；
 * 拖已选中的节点 ⇒ 整组同位移；拖未选中的节点 ⇒ 只动它并清空多选。
 */
describe("关系图 · 框选与整组拖动", () => {
  const 坐标 = (host: HTMLElement, id: string) => {
    const 点 = 点元素(host, id)
    return { x: Number(点.getAttribute("data-node-x")), y: Number(点.getAttribute("data-node-y")) }
  }
  const 选了 = (host: HTMLElement, id: string) => 点元素(host, id).getAttribute("data-selected") === "true"
  const 全部id = ["e-张", "e-李", "e-号", "e-账", "e-地"]

  /** 真事件派发：mousedown（svg/节点）→ window mousemove → window mouseup。`shift` 决定平移还是拉框。 */
  function 拖动(
    元素: Element,
    起: { x: number; y: number },
    终: { x: number; y: number },
    shift = false,
  ) {
    元素.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, shiftKey: shift, clientX: 起.x, clientY: 起.y }))
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 终.x, clientY: 终.y }))
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  }

  /**
   * 在夹具里挑一对节点、按它们的外接框（±6）拉一次框，返回这对 id。
   *
   * 为什么动态挑：环上哪两个点在几何上"正好一对"取决于布局算法，写死 (账, 地) 的外接框
   * 会把中间的 (李/号) 也框进去（首版就这么错了）。这里按同一几何验一遍：只接受
   * **恰好框住这两个**的矩形，找不到就说明夹具几何变了，直接抛，别让用例悄悄证明别的事。
   */
  function 框住俩(host: HTMLElement): readonly [string, string] {
    const 位 = Object.fromEntries(全部id.map((id) => [id, 坐标(host, id)]))
    const 对们: [string, string][] = []
    for (let i = 0; i < 全部id.length; i++)
      for (let j = i + 1; j < 全部id.length; j++) 对们.push([全部id[i], 全部id[j]])
    // 面积大的优先：框够大，拖动不会被 3px 死区吃掉。
    const 面积 = (对: [string, string]) => {
      const a = 位[对[0]]
      const b = 位[对[1]]
      return Math.abs(a.x - b.x) * Math.abs(a.y - b.y)
    }
    对们.sort((甲, 乙) => 面积(乙) - 面积(甲))
    for (const 对 of 对们) {
      const a = 位[对[0]]
      const b = 位[对[1]]
      const 起 = { x: Math.min(a.x, b.x) - 6, y: Math.min(a.y, b.y) - 6 }
      const 终 = { x: Math.max(a.x, b.x) + 6, y: Math.max(a.y, b.y) + 6 }
      const 在 = 全部id.filter((id) => {
        const 点 = 位[id]
        return 点.x >= 起.x && 点.x <= 终.x && 点.y >= 起.y && 点.y <= 终.y
      })
      if (在.length !== 2) continue
      拖动(host.querySelector("svg")!, 起, 终, true)
      return 对
    }
    throw new Error("夹具里找不到能恰好框住两个节点的矩形")
  }

  test("Shift + 拖空白 ⇒ 框内节点进入多选，框外不进；不弹检视面板", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 期望 = 框住俩(host)
    // 前提自检：这一框确实框住了两个点（不是空框、也不是圈住了半个图）。
    expect(期望).toHaveLength(2)
    for (const id of 全部id) expect(选了(host, id)).toBe(期望.includes(id))
    expect(host.querySelector("[data-slot='graph-panel']")).toBeNull()
  })

  test("拖已选中的节点 ⇒ 整组同位移；没选的节点不动", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 期望 = 框住俩(host)
    const 没选 = 全部id.filter((id) => !期望.includes(id))
    const 前 = Object.fromEntries(全部id.map((id) => [id, 坐标(host, id)]))
    拖动(点元素(host, 期望[0]), { x: 100, y: 100 }, { x: 140, y: 130 })
    for (const id of 期望) {
      const 后 = 坐标(host, id)
      expect(后.x - 前[id].x).toBeCloseTo(40, 0)
      expect(后.y - 前[id].y).toBeCloseTo(30, 0)
    }
    for (const id of 没选) expect(坐标(host, id)).toEqual(前[id])
  })

  test("拖未选中的节点 ⇒ 只动它自己，多选清空", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 期望 = 框住俩(host)
    const 目标 = 全部id.find((id) => !期望.includes(id))!
    const 前 = Object.fromEntries(全部id.map((id) => [id, 坐标(host, id)]))
    拖动(点元素(host, 目标), { x: 100, y: 100 }, { x: 150, y: 120 })
    expect(坐标(host, 目标)).not.toEqual(前[目标])
    for (const id of 期望) expect(坐标(host, id)).toEqual(前[id])
    for (const id of 全部id) expect(选了(host, id)).toBe(false)
  })

  test("普通左键拖空白仍是平移（不拉框）：节点坐标不变，视口位移", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 前 = Object.fromEntries(全部id.map((id) => [id, 坐标(host, id)]))
    const 视口 = host.querySelector("[data-slot='graph-viewport']")!
    const 变换前 = 视口.getAttribute("transform")
    拖动(host.querySelector("svg")!, { x: 10, y: 10 }, { x: 90, y: 60 })
    expect(视口.getAttribute("transform")).not.toBe(变换前)
    for (const id of 全部id) expect(坐标(host, id)).toEqual(前[id])
    for (const id of 全部id) expect(选了(host, id)).toBe(false)
  })

  test("Shift + 点节点 ⇒ 加入 / 移出多选，且不改单选面板", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 节点 = 点元素(host, "e-李")
    节点.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, shiftKey: true, clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    节点.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }))
    expect(选了(host, "e-李")).toBe(true)
    expect(host.querySelector("[data-slot='graph-panel']")).toBeNull()
    节点.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, shiftKey: true, clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    节点.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }))
    expect(选了(host, "e-李")).toBe(false)
  })

  test("Esc ⇒ 清空多选", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 期望 = 框住俩(host)
    expect(期望.some((id) => 选了(host, id))).toBe(true)
    按Esc()
    for (const id of 全部id) expect(选了(host, id)).toBe(false)
  })

  test("框内没有节点 ⇒ 多选为空，不报错", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    框住俩(host)
    // 先从一个**几何上确定空**的 20×20 角里拉：不写死「左上角」——环上的点落在哪个角取决于布局。
    const 位 = Object.fromEntries(全部id.map((id) => [id, 坐标(host, id)]))
    const 角们 = [
      { x: 1, y: 1 },
      { x: 画布.宽 - 21, y: 1 },
      { x: 1, y: 画布.高 - 21 },
      { x: 画布.宽 - 21, y: 画布.高 - 21 },
    ]
    const 空 = 角们.find((角) =>
      全部id.every((id) => {
        const 点 = 位[id]
        return !(点.x >= 角.x && 点.x <= 角.x + 20 && 点.y >= 角.y && 点.y <= 角.y + 20)
      }),
    )
    expect(空).toBeDefined()
    拖动(host.querySelector("svg")!, 空!, { x: 空!.x + 20, y: 空!.y + 20 }, true)
    for (const id of 全部id) expect(选了(host, id)).toBe(false)
    expect(host.querySelector("[data-slot='graph-error']")).toBeNull()
  })
})

describe("关系图 · 选中焦点", () => {
  const 形 = (host: HTMLElement, id: string) => 点元素(host, id).querySelector("[data-slot='graph-node-shape']")!
  const 焦点环 = (host: HTMLElement, id: string) => 点元素(host, id).querySelector("[data-slot='graph-node-focus']")

  test("点节点 ⇒ 节点自己换焦点色（深金描边＋高亮填充＋焦点环），别的节点不变", async () => {
    // 真栈实测（改前）：点前/点后同一个节点 fill/stroke/stroke-width 三项一模一样
    //（rgb(236,241,254) / rgba(0,0,0,0.2) / 1.5px）——只有右侧面板变了，节点毫无反应。
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    点元素(host, "e-李").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(形(host, "e-李").getAttribute("fill")).toBe("var(--v2-brand-gold)")
    expect(形(host, "e-李").getAttribute("stroke")).toBe("var(--v2-brand-gold-deep)")
    expect(焦点环(host, "e-李")).not.toBeNull()
    // 号码节点仍是类型色（青），焦点环也不在它身上
    expect(形(host, "e-号").getAttribute("fill")).toBe("var(--v2-state-bg-info)")
    expect(焦点环(host, "e-号")).toBeNull()
  })

  test("点形状本体（真实鼠标的 target 是 rect/circle，不是外层 <g>）也能选中", async () => {
    // 真栈实测：点节点图形时事件 target 是 `<rect data-slot="graph-node-shape">`；
    // 焦点色一改，图形元素当场被重建，等事件冒泡到 svg 时 target 已经脱离文档
    //（isConnected=false、parentElement=null），svg 那层的「点空白 ⇒ 取消选中」认不出它，
    // 于是同一次点击里选中又被清空。用例必须点形状本体，点 `<g>` 碰不到这条路径。
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    形(host, "e-李").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(host.querySelector("[data-slot='graph-panel']")).not.toBeNull()
    expect(焦点环(host, "e-李")).not.toBeNull()
  })

  test("点中心节点也必须有颜色变化：它本来就填高亮色，焦点色不能再是同一个色", async () => {
    // 真栈截图暴露的缺口：中心节点默认就是「高亮填充＋深金描边」，焦点色沿用同一组值时，
    // 点它只有 2.5px→3px 和一圈淡环——用户看不出焦点落在谁身上。
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 原色 = 形(host, "e-张").getAttribute("fill")!
    expect(原色).toBe("var(--v2-background-bg-accent-soft)")
    点元素(host, "e-张").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(形(host, "e-张").getAttribute("fill")).not.toBe(原色)
    expect(形(host, "e-张").getAttribute("fill")).toBe("var(--v2-brand-gold)")
  })

  test("聚焦跟着点选走：换点另一个节点后旧的恢复原色；Esc 后焦点消失", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    点元素(host, "e-李").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    点元素(host, "e-号").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(焦点环(host, "e-李")).toBeNull()
    expect(形(host, "e-李").getAttribute("fill")).toBe("var(--v2-background-bg-layer-02)")
    expect(焦点环(host, "e-号")).not.toBeNull()
    // 号码本来是青色，被点选后必须换成焦点色——只钉「旧节点恢复」的话，
    // 焦点色整体失效时这条会假绿（图形不随选中变，旧节点本来就一直是原色）。
    expect(形(host, "e-号").getAttribute("fill")).toBe("var(--v2-brand-gold)")
    按Esc()
    expect(焦点环(host, "e-号")).toBeNull()
    expect(形(host, "e-号").getAttribute("fill")).toBe("var(--v2-state-bg-info)")
  })
})

describe("关系图 · 面板遮挡让位", () => {
  // 检视面板浮在画布右边缘（`w-[280px]`），底下那一列节点点不到也拖不到：
  // 真栈实操时在面板正下方起手拖动，按到的是面板按钮（误触「以此为中心」开了新关系图）。
  const 视口平移 = (host: HTMLElement) => {
    const 数 = host
      .querySelector("[data-slot='graph-viewport']")!
      .getAttribute("transform")!
      .match(/-?[\d.]+/g)!
      .map(Number)
    return { x: 数[0]!, y: 数[1]!, 缩放: 数[2]! }
  }

  test("点选落在面板底下的节点 ⇒ 画布自动左移把它让出来", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 最右 = 自动位置(图, 画布).slice().sort((甲, 乙) => 乙.x - 甲.x)[0]!
    const 右界 = 画布.宽 - 304 // 面板 280 ＋ 24 边距
    expect(最右.x).toBeGreaterThan(右界)
    expect(视口平移(host)).toEqual({ x: 0, y: 0, 缩放: 1 })
    点元素(host, 最右.id).dispatchEvent(new MouseEvent("click", { bubbles: true }))
    const 后 = 视口平移(host)
    expect(最右.x * 后.缩放 + 后.x).toBeLessThanOrEqual(右界 + 0.001)
    // 让位靠平移、不改布局：节点自己的 viewBox 坐标一个不差
    expect(Number(点元素(host, 最右.id).getAttribute("data-node-x"))).toBe(Number(最右.x.toFixed(1)))
    // 面板宽度的单一事实源写在测试里：改了 `w-[280px]` 而没同步让位口径，这条会红。
    expect(host.querySelector<HTMLElement>("[data-slot='graph-panel']")!.className).toContain("w-[280px]")
  })

  test("点选本来就在面板外的节点 ⇒ 画面不动（不乱晃）", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 最左 = 自动位置(图, 画布).slice().sort((甲, 乙) => 甲.x - 乙.x)[0]!
    点元素(host, 最左.id).dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(视口平移(host)).toEqual({ x: 0, y: 0, 缩放: 1 })
  })
})

describe("关系图 · 面板不挤压画布", () => {
  test("检视面板脱离布局流（absolute）——点节点不再从画布里抠走 280px 让整张图重排缩小", async () => {
    // 真栈实测（1440）：改前点节点 画布宽 737→457、中心到最远点 267px→127px，整张图缩到约 48%；
    // 改后点节点 画布宽 737→737、四个节点屏幕坐标一个不差。
    // happy-dom 没有版面尺寸，几何只能在真浏览器里量；这里钉住它的结构前提：
    // 面板一旦回到 flex 流（去掉 absolute / inset-y-0 right-0），画布就会被挤窄，重刷时上一条要靠人再量一次。
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    点元素(host, "e-李").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    const 板 = host.querySelector<HTMLElement>("[data-slot='graph-panel']")!
    expect(板).not.toBeNull()
    expect(板.className).toContain("absolute")
    expect(板.className).toContain("inset-y-0")
    expect(板.className).toContain("right-0")
  })

  test("面板打开时缩放条让开面板宽度（否则「适应」被盖住点不到）", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    const 条 = () => host.querySelector<HTMLElement>("[data-slot='graph-zoom-bar']")!
    expect(条().style.right).toBe("8px")
    点元素(host, "e-李").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(条().style.right).toBe("292px")
  })
})

/**
 * 图上的「带走」手势（2026-11-08 用户下达：同一个动作长到每一页）。
 *
 * 图里拖拽已经是「整组移动」，所以这两项落在**图自带的右键菜单**里（用户选定）；
 * 多选 ≥2 颗时右键其中一颗 ⇒ 带走**整组**，否则只带走这一颗。
 */
describe("关系图 · 右键复制与发送到会话", () => {
  const 在多选里 = (host: HTMLElement, id: string) => 点元素(host, id).getAttribute("data-selected") === "true"
  const shift点 = (host: HTMLElement, id: string) => {
    const 节点 = 点元素(host, id)
    节点.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, shiftKey: true, clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    节点.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }))
  }

  test("右键一颗节点 ⇒「复制」带走这一颗的原文（类型 · 值）", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    右键(点元素(host, "e-号"))
    await 等(() => 菜单开着())

    const 原生剪贴板 = navigator.clipboard
    const 写入: string[] = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (文字: string) => void 写入.push(文字) },
    })
    try {
      点菜单项("graph-node-menu-copy")
      await 等(() => 写入.length === 1)
      expect(写入).toEqual(["号码 · 手机号 · 13800000001"])
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: 原生剪贴板 })
    }
  })

  test("右键一颗节点 ⇒「发送到会话」把这颗的原文送进右栏", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => void 收到.push(文本))
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    右键(点元素(host, "e-号"))
    await 等(() => 菜单开着())
    点菜单项("graph-node-menu-ask")
    expect(收到).toEqual(["号码 · 手机号 · 13800000001"])
  })

  test("多选 ≥2 颗后右键其中一颗 ⇒ 发送的是整组（每行一条）", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => void 收到.push(文本))
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    shift点(host, "e-李")
    shift点(host, "e-号")
    expect(在多选里(host, "e-李")).toBe(true)
    expect(在多选里(host, "e-号")).toBe(true)

    右键(点元素(host, "e-李"))
    await 等(() => 菜单开着())
    点菜单项("graph-node-menu-ask")
    expect(收到).toHaveLength(1)
    const 文本 = 收到[0] ?? ""
    expect(文本.split("\n")).toHaveLength(2)
    expect(文本).toContain("李四")
    expect(文本).toContain("13800000001")
  })

  test("多选里只有一颗（或右键的是组外节点）⇒ 只带走这一颗，不把整张图发出去", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => void 收到.push(文本))
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    shift点(host, "e-李") // 多选只有一颗
    右键(点元素(host, "e-号")) // 右键的是组外那颗
    await 等(() => 菜单开着())
    点菜单项("graph-node-menu-ask")
    expect(收到).toEqual(["号码 · 手机号 · 13800000001"])
  })
})
