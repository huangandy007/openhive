import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { Graph, 布局, 画布 } from "./graph"
import type { CaseDetailApi, 图节点, 关系图结果 } from "../case-detail-api"

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
function 按Esc() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
}
afterEach(() => {
  document.body.innerHTML = ""
})

const 图: 关系图结果 = {
  节点: [
    { id: "e-张", type: "人", value: "张三", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 2 },
    { id: "e-李", type: "人", value: "李四", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1 },
    { id: "e-号", type: "号码", value: "13800000001", trust_state: "已确认", 中心: false, 跳数: 1, 关联数: 3 },
    { id: "e-账", type: "账户", value: "6222****0001", trust_state: "存疑", 中心: false, 跳数: 2, 关联数: 1 },
    { id: "e-地", type: "地点", value: "湖州市吴兴区", trust_state: "自动抽取", 中心: false, 跳数: 2, 关联数: 1 },
  ],
  边: [
    { id: "r-1", from: "e-张", to: "e-李", type: "通话", times: 3, amount: null, trust_state: "自动抽取" },
    { id: "r-2", from: "e-张", to: "e-号", type: "实际使用", times: null, amount: null, trust_state: "自动抽取" },
    { id: "r-3", from: "e-号", to: "e-账", type: "通话", times: 30, amount: null, trust_state: "自动抽取" },
    { id: "r-4", from: "e-号", to: "e-地", type: "转账", times: 1, amount: "100.00", trust_state: "自动抽取" },
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

const 点元素 = (host: HTMLElement, id: string) =>
  host.querySelector<SVGGElement>(`[data-slot='graph-node'][data-node-id='${id}']`)!
const 边元素 = (host: HTMLElement, id: string) =>
  host.querySelector<SVGGElement>(`[data-slot='graph-edge'][data-edge-id='${id}']`)!

describe("关系图 · 布局", () => {
  test("每个节点都落在画布内，且不重叠、不挤成一条竖线（视口外那半个图是真实缺陷）", () => {
    // 旧实现：viewBox 0 0 640 420，外环半径恒 250 ⇒ 单节点落在 cy = 210 - 250 = -40，
    // 屏幕外；多个环都从 -90° 起排，节点少时全叠在一条竖线上。
    // 变异靶子：把环半径改回固定值或去掉画布边距，这条必须红。
    const 节点: 图节点[] = [{ id: "c", type: "人", value: "中心", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 20 }]
    for (let i = 0; i < 8; i += 1)
      节点.push({ id: `a-${i}`, type: i % 2 === 0 ? "号码" : "人", value: `内环${i}`, trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1 })
    for (let i = 0; i < 12; i += 1)
      节点.push({ id: `b-${i}`, type: i % 3 === 0 ? "账户" : "地点", value: `外环${i}`, trust_state: "自动抽取", 中心: false, 跳数: 2, 关联数: 1 })
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
        { id: "c", type: "人", value: "张三", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 1 },
        { id: "a", type: "号码", value: "0001", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 3 },
        { id: "b", type: "号码", value: "0002", trust_state: "自动抽取", 中心: false, 跳数: 2, 关联数: 1 },
        { id: "d", type: "号码", value: "0003", trust_state: "自动抽取", 中心: false, 跳数: 2, 关联数: 1 },
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

  test("「以此为中心」把该节点交给上层重新取图；中心节点自己不显示这个按钮", async () => {
    const 收到: 图节点[] = []
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} onRecenter={(点) => 收到.push(点)} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 5)
    点元素(host, "e-李").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    host.querySelector<HTMLElement>("[data-slot='graph-panel-focus']")!.click()
    expect(收到.map((点) => 点.id)).toEqual(["e-李"])

    点元素(host, "e-张").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(host.querySelector("[data-slot='graph-panel-focus']")).toBeNull()
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
              边: [{ id: "r-悬空", from: "e-张", to: "e-缺", type: "通话", times: 1, amount: null, trust_state: "自动抽取" }],
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
          { id: "e-新", type: "人", value: "新邻居", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 1 },
          { id: "e-乙", type: "人", value: "乙", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1 },
        ],
        边: [{ id: "r-新", from: "e-新", to: "e-乙", type: "通话", times: 1, amount: null, trust_state: "自动抽取" }],
        缺口: [],
      },
    })
    await 等(() => host.textContent!.includes("新邻居"))
    待回[0]!({
      kind: "ok",
      value: {
        节点: [
          { id: "e-旧", type: "人", value: "旧邻居", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 1 },
          { id: "e-乙", type: "人", value: "乙", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1 },
        ],
        边: [{ id: "r-旧", from: "e-旧", to: "e-乙", type: "通话", times: 1, amount: null, trust_state: "自动抽取" }],
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
