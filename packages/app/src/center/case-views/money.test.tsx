import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { Money } from "./money"
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

const 数据 = {
  汇总: [
    { 方向: "出", 笔数: 3, 合计: "300.00" },
    { 方向: "入", 笔数: 1, 合计: "100.00" },
  ],
  对手方: [
    { 对手方: "6222****0001", 方向: "出", 笔数: 2, 合计: "200.00" },
    { 对手方: "李四", 方向: "入", 笔数: 1, 合计: "100.00" },
  ],
  余额走势: { 首: "1000.00", 末: "800.00", 最高: "1100.00", 最低: "800.00", 行数: 4 },
}

function 假api(over: Partial<CaseDetailApi> = {}): CaseDetailApi {
  return {
    profile: async () => ({ kind: "error", message: "未用" }),
    materialFacts: async () => ({ kind: "error", message: "未用" }),
    timeline: async () => ({ kind: "ok", value: { 数据: [] } }),
    money: async () => ({ kind: "ok", value: { 数据, 口径: "只统计已抽成关系的转账", 缺口: ["对手方最多 50 条"] } }),
    graph: async () => ({ kind: "ok", value: { 节点: [], 边: [], 缺口: [] } }),
    ...over,
  }
}

describe("资金", () => {
  test("汇总按出 / 入两行给出笔数与合计（numeric 字符串原样显示）", async () => {
    const host = mount(() => <Money projectId="p" id="e-账" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='money-summary']").length === 2)
    const 行们 = [...host.querySelectorAll<HTMLElement>("[data-slot='money-summary']")]
    expect(行们[0]!.textContent).toContain("出")
    expect(行们[0]!.textContent).toContain("3 笔")
    expect(行们[0]!.textContent).toContain("300.00")
    expect(行们[1]!.textContent).toContain("入")
  })

  test("对手方逐条列出，方向与合计都在", async () => {
    const host = mount(() => <Money projectId="p" id="e-账" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='money-counterparty']").length === 2)
    const 行们 = [...host.querySelectorAll<HTMLElement>("[data-slot='money-counterparty']")]
    expect(行们[0]!.textContent).toContain("6222****0001")
    expect(行们[0]!.textContent).toContain("200.00")
  })

  test("余额走势给出首 / 末 / 最高 / 最低；没有余额数据时说清楚", async () => {
    const host = mount(() => <Money projectId="p" id="e-账" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='money-balance']").length === 1)
    const 块 = host.querySelector("[data-slot='money-balance']")!
    expect(块.textContent).toContain("1000.00")
    expect(块.textContent).toContain("800.00")

    const 空 = mount(() => (
      <Money projectId="p" id="e-账" api={假api({ money: async () => ({ kind: "ok", value: { 数据: { ...数据, 余额走势: null } } }) })} />
    ))
    await 等(() => 空.textContent!.includes("没有可用余额"))
  })

  test("口径与缺口都摆出来", async () => {
    const host = mount(() => <Money projectId="p" id="e-账" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='money-summary']").length === 2)
    expect(host.querySelector("[data-slot='money-scope']")!.textContent).toContain("只统计已抽成关系的转账")
    expect(host.querySelector("[data-slot='money-gap']")!.textContent).toContain("对手方最多 50 条")
  })

  test("换实体时迟到的旧回包不覆盖新实体（onCleanup 真的作废了旧请求）", async () => {
    const [项目, set项目] = createSignal("p1")
    const 待回: Array<(回: Awaited<ReturnType<CaseDetailApi["money"]>>) => void> = []
    const api = 假api({
      money: () => new Promise((resolve) => { 待回.push(resolve) }),
    })
    const host = mount(() => <Money projectId={项目()} id="e-账" api={api} />)
    await 等(() => 待回.length === 1)
    set项目("p2")
    await 等(() => 待回.length === 2)
    待回[1]!({ kind: "ok", value: { 数据: { 对手方: [{ 对手方: "新的对手", 方向: "出", 笔数: 1, 合计: "1.00" }] } } })
    await 等(() => host.textContent!.includes("新的对手"))
    待回[0]!({ kind: "ok", value: { 数据: { 对手方: [{ 对手方: "旧的对手", 方向: "入", 笔数: 1, 合计: "2.00" }] } } })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(host.textContent).not.toContain("旧的对手")
  })

  test("取数失败如实说", async () => {
    const host = mount(() => (
      <Money projectId="p" id="e-账" api={假api({ money: async () => ({ kind: "error", message: "找不到这个实体" }) })} />
    ))
    await 等(() => host.textContent!.includes("找不到这个实体"))
  })

  test("取数抛异常 ⇒ 报出来并收掉「载入中」（不留一条 unhandled rejection）", async () => {
    const host = mount(() => (
      <Money
        projectId="p"
        id="e-账"
        api={假api({
          money: async () => {
            throw new Error("网络断了")
          },
        })}
      />
    ))
    await 等(() => host.textContent!.includes("网络断了"))
    expect(host.textContent).not.toContain("正在汇总资金")
  })
})
