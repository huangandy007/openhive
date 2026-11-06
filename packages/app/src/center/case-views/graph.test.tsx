import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { Graph } from "./graph"
import type { CaseDetailApi, 关系图结果 } from "../case-detail-api"

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
afterEach(() => {
  document.body.innerHTML = ""
})

const 图: 关系图结果 = {
  节点: [
    { id: "e-张", type: "人", value: "张三", trust_state: "自动抽取", 中心: true, 跳数: 0, 关联数: 2 },
    { id: "e-李", type: "人", value: "李四", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1 },
    { id: "e-账", type: "账户", value: "6222****0001", trust_state: "自动抽取", 中心: false, 跳数: 1, 关联数: 1 },
  ],
  边: [
    { id: "r-1", from: "e-张", to: "e-李", type: "通话", times: 3, amount: null, trust_state: "自动抽取" },
    { id: "r-2", from: "e-张", to: "e-账", type: "转账", times: 1, amount: "100.00", trust_state: "自动抽取" },
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
    ...over,
  }
}

describe("关系图", () => {
  test("节点与边都画出来：中心带 data-center，边上标类型", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 3)
    expect(host.querySelector("[data-slot='graph-node'][data-center='true']")!.getAttribute("data-node-id")).toBe("e-张")
    const 边们 = [...host.querySelectorAll<HTMLElement>("[data-slot='graph-edge']")]
    expect(边们.length).toBe(2)
    expect(边们.map((边) => 边.getAttribute("data-edge-id")).sort()).toEqual(["r-1", "r-2"])
    expect(host.textContent).toContain("转账")
  })

  test("点非中心节点把整条节点交给上层（打开实体档案）", async () => {
    const 收到: string[] = []
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={(点) => 收到.push(点.id)} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-node']").length === 3)
    host.querySelector<HTMLElement>("[data-slot='graph-node'][data-node-id='e-李']")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    )
    expect(收到).toEqual(["e-李"])
  })

  test("缺口如实说", async () => {
    const host = mount(() => <Graph projectId="p" id="e-张" api={假api()} onOpenEntity={() => {}} />)
    await 等(() => host.textContent!.includes("节点上限 50"))
  })

  test("类型筛选：选中的类型按服务端过滤后仍留在按钮上，可再点一次取消（不会变成单选死锁）", async () => {
    const 调用: Array<readonly string[] | undefined> = []
    const api = 假api({
      graph: async (_projectId, _id, _跳数, 类型) => {
        调用.push(类型)
        // 服务端语义：选了类型就只回这些类型的边（这正是「按钮消失」那条缺陷的来源）。
        const 边们 = 类型 === undefined || 类型.length === 0 ? 图.边 : 图.边.filter((边) => 类型.includes(边.type))
        return { kind: "ok", value: { ...图, 边: 边们 } }
      },
    })
    const host = mount(() => <Graph projectId="p" id="e-张" api={api} onOpenEntity={() => {}} />)
    await 等(() => host.querySelectorAll("[data-slot='graph-type']").length === 2)

    host.querySelector<HTMLElement>("[data-slot='graph-type'][data-type='转账']")!.click()
    await 等(() => 调用.length === 2 && host.querySelectorAll("[data-slot='graph-edge']").length === 1)

    const 转账按钮 = host.querySelector<HTMLElement>("[data-slot='graph-type'][data-type='转账']")
    expect(转账按钮).not.toBeNull()
    expect(转账按钮!.getAttribute("aria-pressed")).toBe("true")

    // 再点一次 ⇒ 取消筛选，服务端回到全部边。
    转账按钮!.click()
    await 等(() => 调用.length === 3 && host.querySelectorAll("[data-slot='graph-edge']").length === 2)
    expect(调用.at(-1)!.length).toBe(0)
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
})
