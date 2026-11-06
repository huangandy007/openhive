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
    ...over,
  }
}

describe("时间线", () => {
  test("按服务端给的顺序逐条画出时间、类型、摘要与参与者", async () => {
    const host = mount(() => <Timeline projectId="p" id="e-张" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='timeline-event']").length === 2)
    const 行们 = [...host.querySelectorAll<HTMLElement>("[data-slot='timeline-event']")]
    expect(行们[0]!.textContent).toContain(时间文本(1_700_000_100))
    expect(行们[0]!.textContent).toContain("转账 100 元")
    expect(行们[0]!.textContent).toContain("张三、李四")
    expect(行们[1]!.textContent).toContain("见面")
  })

  test("口径与缺口都摆出来（结论能不能用，取决于覆盖到哪）", async () => {
    const host = mount(() => <Timeline projectId="p" id="e-张" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='timeline-event']").length === 2)
    expect(host.querySelector("[data-slot='timeline-scope']")!.textContent).toContain("按参与实体过滤")
    expect(host.querySelector("[data-slot='timeline-gap']")!.textContent).toContain("只列了最近 50 条")
  })

  test("没有事件 ⇒ 说「没有事件」，不画空列表", async () => {
    const host = mount(() => (
      <Timeline projectId="p" id="e-张" api={假api({ timeline: async () => ({ kind: "ok", value: { 数据: [] } }) })} />
    ))
    await 等(() => host.textContent!.includes("没有事件"))
    expect(host.querySelectorAll("[data-slot='timeline-event']").length).toBe(0)
  })

  test("数据不是数组（形状认不出）⇒ 也说「没有事件」，不抛", async () => {
    const host = mount(() => (
      <Timeline projectId="p" id="e-张" api={假api({ timeline: async () => ({ kind: "ok", value: { 数据: { 意料之外: 1 } } }) })} />
    ))
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
