import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { Timeline } from "./timeline"
import { 时间文本 } from "./format"
import type { CaseDetailApi } from "../case-detail-api"

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

const 事件们 = [
  {
    id: "ev-2",
    type: "转账",
    occurred_at: 1_700_000_100,
    occurred_raw: null,
    participants: ["张三", "李四"],
    summary: "转账 100 元",
    trust_state: "自动抽取",
  },
  {
    id: "ev-1",
    type: "见面",
    occurred_at: 1_700_000_050,
    occurred_raw: null,
    participants: ["张三"],
    summary: null,
    trust_state: "自动抽取",
  },
]

function 假api(over: Partial<CaseDetailApi> = {}): CaseDetailApi {
  return {
    profile: async () => ({ kind: "error", message: "未用" }),
    materialFacts: async () => ({ kind: "error", message: "未用" }),
    timeline: async () => ({ kind: "ok", value: { 数据: 事件们, 口径: "按参与实体过滤", 缺口: ["只列了最近 50 条"] } }),
    money: async () => ({ kind: "ok", value: { 数据: {} } }),
    graph: async () => ({ kind: "ok", value: { 节点: [], 边: [], 缺口: [] } }),
    review: async () => ({ kind: "error", message: "本用例不取复核" }),
    trust: async () => ({ kind: "error", message: "本用例不裁决" }),
    ...over,
  }
}

const 线api = (数据: unknown, 其余: { 口径?: string; 缺口?: string[] } = {}) =>
  假api({ timeline: async () => ({ kind: "ok", value: { 数据, ...其余 } }) })

describe("时间线", () => {
  test("按服务端给的顺序逐条画出类型、摘要与参与者", async () => {
    const host = mount(() => <Timeline projectId="p" id="e-张" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='timeline-event']").length === 2)
    const 行们 = [...host.querySelectorAll<HTMLElement>("[data-slot='timeline-event']")]
    expect(行们[0]!.textContent).toContain("转账")
    expect(行们[0]!.textContent).toContain("转账 100 元")
    expect(行们[0]!.textContent).toContain("张三")
    expect(行们[0]!.textContent).toContain("李四")
    expect(行们[1]!.textContent).toContain("见面")
  })

  test("时间以原文为准；精度到日时绝不补出 00:00（那是页面自己编的时刻）", async () => {
    const 到日 = new Date(2026, 2, 6, 0, 0, 0).getTime() / 1000 // 本地零点：与机器时区无关
    const host = mount(() => (
      <Timeline
        projectId="p"
        id="e-张"
        api={线api([
          { id: "e1", type: "见面", occurred_at: 到日, occurred_raw: "2026年3月6日", precision: "到日", participants: ["张三"], summary: "城东茶馆见面", trust_state: "自动抽取" },
        ])}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='timeline-event']").length === 1)
    expect(host.textContent).toContain("2026年3月6日")
    expect(host.textContent).not.toContain("00:00")
  })

  test("原文缺失且精度只到日 ⇒ 只显示日期，不补 00:00", async () => {
    const 到日 = new Date(2026, 2, 6, 0, 0, 0).getTime() / 1000 // 本地零点：与机器时区无关
    const host = mount(() => (
      <Timeline
        projectId="p"
        id="e-张"
        api={线api([
          { id: "e1", type: "见面", occurred_at: 到日, occurred_raw: null, precision: "到日", participants: [], summary: "城东茶馆见面", trust_state: "自动抽取" },
        ])}
      />
    ))
    await 等(() => host.querySelectorAll("[data-slot='timeline-event']").length === 1)
    expect(host.textContent).toMatch(/20\d\d-\d\d-\d\d/)
    expect(host.textContent).not.toContain("00:00")
  })

  test("原文缺失时才退回规范时间（有些抽取结果只有时间戳）", async () => {
    const host = mount(() => <Timeline projectId="p" id="e-张" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='timeline-event']").length === 2)
    expect(host.textContent).toContain(时间文本(1_700_000_100))
  })

  test("同一天归一组，跨天分两组（日期轨是节奏信息，不是装饰）", async () => {
    const 三天 = [
      { id: "a", type: "转账", occurred_at: 1_700_100_000, occurred_raw: "第一天", participants: [], summary: "A", trust_state: "自动抽取" },
      { id: "b", type: "通话", occurred_at: 1_700_100_500, occurred_raw: "第一天", participants: [], summary: "B", trust_state: "自动抽取" },
      { id: "c", type: "见面", occurred_at: 1_700_300_000, occurred_raw: "第三天", participants: [], summary: "C", trust_state: "自动抽取" },
    ]
    const host = mount(() => <Timeline projectId="p" id="e-张" api={线api(三天)} />)
    await 等(() => host.querySelectorAll("[data-slot='timeline-event']").length === 3)
    const 组 = [...host.querySelectorAll<HTMLElement>("[data-slot='timeline-day']")]
    expect(组.length).toBe(2)
    expect(组[0]!.querySelectorAll("[data-slot='timeline-event']").length).toBe(2)
    expect(组[1]!.querySelectorAll("[data-slot='timeline-event']").length).toBe(1)
  })

  test("没有可解析时间的事件排到最后，且仍显示原文（不丢信息）", async () => {
    const 混 = [
      { id: "a", type: "见面", occurred_at: 1_700_100_000, occurred_raw: "2023年11月15日", participants: [], summary: "有时间", trust_state: "自动抽取" },
      { id: "b", type: "通话", occurred_at: null, occurred_raw: "去年冬天", participants: [], summary: "没时间", trust_state: "自动抽取" },
    ]
    const host = mount(() => <Timeline projectId="p" id="e-张" api={线api(混)} />)
    await 等(() => host.querySelectorAll("[data-slot='timeline-event']").length === 2)
    const 组 = [...host.querySelectorAll<HTMLElement>("[data-slot='timeline-day']")]
    expect(组.length).toBe(2)
    expect(组[1]!.textContent).toContain("时间未知")
    expect(组[1]!.textContent).toContain("去年冬天")
  })

  test("信任状态只在非「自动抽取」时标出来（常态全标等于噪音）", async () => {
    const 混 = [
      { id: "a", type: "转账", occurred_at: 1_700_100_000, occurred_raw: "甲", participants: [], summary: "自动的", trust_state: "自动抽取" },
      { id: "b", type: "转账", occurred_at: 1_700_100_100, occurred_raw: "乙", participants: [], summary: "人工认过的", trust_state: "人工确认" },
    ]
    const host = mount(() => <Timeline projectId="p" id="e-张" api={线api(混)} />)
    await 等(() => host.querySelectorAll("[data-slot='timeline-event']").length === 2)
    const 徽标 = [...host.querySelectorAll<HTMLElement>("[data-slot='timeline-trust']")]
    expect(徽标.length).toBe(1)
    expect(徽标[0]!.textContent).toContain("人工确认")
  })

  test("口径默认收起，点一下才展开（技术说明不该压住事件）", async () => {
    const host = mount(() => <Timeline projectId="p" id="e-张" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='timeline-event']").length === 2)
    expect(host.querySelector("[data-slot='timeline-scope']")).toBeNull()
    const 开关 = host.querySelector<HTMLButtonElement>("[data-slot='timeline-scope-toggle']")!
    expect(开关.getAttribute("aria-expanded")).toBe("false")
    expect(开关.textContent).toContain("口径")
    开关.click()
    await 等(() => host.querySelector("[data-slot='timeline-scope']") !== null)
    expect(host.querySelector("[data-slot='timeline-scope']")!.textContent).toContain("按参与实体过滤")
    expect(开关.getAttribute("aria-expanded")).toBe("true")
  })

  test("缺口有才画；没有就不占位", async () => {
    const 有 = mount(() => <Timeline projectId="p" id="e-张" api={假api()} />)
    await 等(() => 有.querySelectorAll("[data-slot='timeline-event']").length === 2)
    expect(有.querySelector("[data-slot='timeline-gap']")!.textContent).toContain("只列了最近 50 条")
    document.body.innerHTML = ""
    const 无 = mount(() => <Timeline projectId="p" id="e-张" api={线api(事件们)} />)
    await 等(() => 无.querySelectorAll("[data-slot='timeline-event']").length === 2)
    expect(无.querySelectorAll("[data-slot='timeline-gap']").length).toBe(0)
  })

  test("页头给出事件数与时间范围", async () => {
    const host = mount(() => <Timeline projectId="p" id="e-张" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='timeline-event']").length === 2)
    const 摘要 = host.querySelector("[data-slot='timeline-summary']")!
    const 日 = 时间文本(1_700_000_100).slice(0, 10)
    expect(摘要.textContent).toContain("2 条事件")
    expect(摘要.textContent).toContain(日)
  })

  test("没有事件 ⇒ 说「没有事件」，不画空列表", async () => {
    const host = mount(() => <Timeline projectId="p" id="e-张" api={线api([])} />)
    await 等(() => host.textContent!.includes("没有事件"))
    expect(host.querySelectorAll("[data-slot='timeline-event']").length).toBe(0)
  })

  test("数据不是数组（形状认不出）⇒ 也说「没有事件」，不抛", async () => {
    const host = mount(() => <Timeline projectId="p" id="e-张" api={线api({ 意料之外: 1 })} />)
    await 等(() => host.textContent!.includes("没有事件"))
    expect(host.querySelectorAll("[data-slot='timeline-event']").length).toBe(0)
  })

  test("换实体时迟到的旧回包不覆盖新实体（onCleanup 真的作废了旧请求）", async () => {
    const [项目, set项目] = createSignal("p1")
    const 待回: Array<(回: Awaited<ReturnType<CaseDetailApi["timeline"]>>) => void> = []
    const api = 假api({
      timeline: () => new Promise((resolve) => { 待回.push(resolve) }),
    })
    const host = mount(() => <Timeline projectId={项目()} id="e-张" api={api} />)
    await 等(() => 待回.length === 1)
    set项目("p2")
    await 等(() => 待回.length === 2)
    待回[1]!({ kind: "ok", value: { 数据: [{ id: "ev-新", type: "新事件", occurred_at: 1, participants: [], summary: null }] } })
    await 等(() => host.textContent!.includes("新事件"))
    待回[0]!({ kind: "ok", value: { 数据: [{ id: "ev-旧", type: "旧事件", occurred_at: 2, participants: [], summary: null }] } })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(host.textContent).not.toContain("旧事件")
  })

  test("取数失败如实说", async () => {
    const host = mount(() => (
      <Timeline projectId="p" id="e-张" api={假api({ timeline: async () => ({ kind: "error", message: "找不到这个实体" }) })} />
    ))
    await 等(() => host.textContent!.includes("找不到这个实体"))
  })

  test("取数抛异常 ⇒ 报出来并收掉「载入中」（不留一条 unhandled rejection）", async () => {
    const host = mount(() => (
      <Timeline
        projectId="p"
        id="e-张"
        api={假api({
          timeline: async () => {
            throw new Error("网络断了")
          },
        })}
      />
    ))
    await 等(() => host.textContent!.includes("网络断了"))
    expect(host.textContent).not.toContain("正在读取事件")
  })
})
