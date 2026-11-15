import { afterEach, describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { Money } from "./money"
import type { CaseDetailApi } from "../case-detail-api"
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
/** 每条用例装过的探针的还原函数：抛错也要还原原型，否则会漏给下一条（`#005-34`）。 */
const 待还原: Array<() => void> = []
afterEach(() => {
  while (待还原.length) 待还原.pop()!()
  document.body.innerHTML = ""
  订阅会话输入(undefined)
})

/** 真浏览器的 Selection 在 happy-dom 里形状不同 ⇒ 只替 `多行选区文本` 用到的那三样。 */
function 装选区(命中: (node: Node) => boolean) {
  const 原 = Object.getOwnPropertyDescriptor(window, "getSelection")
  Object.defineProperty(window, "getSelection", {
    configurable: true,
    value: () => ({
      rangeCount: 1,
      isCollapsed: false,
      toString: () => "选中的文字",
      getRangeAt: () => ({ intersectsNode: 命中 }),
    }),
  })
  待还原.push(() => {
    if (原 === undefined) Reflect.deleteProperty(window, "getSelection")
    else Object.defineProperty(window, "getSelection", 原)
  })
}

/** happy-dom 没有 `DataTransfer`：只造 handler 真正用到的 `setData` / `effectAllowed`。 */
function 触发拖动(目标: Element) {
  const 写进: Array<[string, string]> = []
  const 事件 = new Event("dragstart", { bubbles: true, cancelable: true })
  Object.defineProperty(事件, "dataTransfer", {
    value: { effectAllowed: "none", setData: (类型: string, 值: string) => void 写进.push([类型, 值]) },
  })
  目标.dispatchEvent(事件)
  return 写进
}

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

/** 带明细的回包：流水两笔（一笔无时间、一笔无摘要）+ 人说的两笔（一笔缺金额与时间、聚合 3 次）。 */
const 带明细 = {
  ...数据,
  单笔最大: [
    { id: "ev-1", 金额: "50000.00", 时间: 1773300000, 摘要: "转账-货款" },
    { id: "ev-2", 金额: "120.00", 时间: null, 摘要: null },
  ],
  人说的笔: [
    { id: "r-1", 方向: "出", 对手: "李四", 金额: "50000.00", 首: 1773300000, 末: 1773300000, 精度: "到日", 次数: null },
    { id: "r-2", 方向: "入", 对手: "王五", 金额: null, 首: null, 末: null, 精度: null, 次数: 3 },
  ],
}

const 明细api = (数据段: unknown) =>
  假api({
    money: async () => ({ kind: "ok", value: { 数据: 数据段, 口径: "只统计已抽成关系的转账", 缺口: [] } }),
  })

function 假api(over: Partial<CaseDetailApi> = {}): CaseDetailApi {
  return {
    profile: async () => ({ kind: "error", message: "未用" }),
    materialFacts: async () => ({ kind: "error", message: "未用" }),
    timeline: async () => ({ kind: "ok", value: { 数据: [] } }),
    money: async () => ({ kind: "ok", value: { 数据, 口径: "只统计已抽成关系的转账", 缺口: ["对手方最多 50 条"] } }),
    graph: async () => ({ kind: "ok", value: { 节点: [], 边: [], 缺口: [] } }),
    review: async () => ({ kind: "error", message: "本用例不取复核" }),
    trust: async () => ({ kind: "error", message: "本用例不裁决" }),
    confirmFieldAlias: async () => ({ kind: "error", message: "本用例不写别名" }),
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

  /**
   * 2026-11-08：同一个手势长到每一页——资金页也能拖选、右键复制、发进右栏。
   */
  test("资金页正文能拖选，对手方行带 data-copy", async () => {
    const host = mount(() => <Money projectId="p" id="e-账" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='money-counterparty']").length === 2)
    expect(host.querySelector("[data-component='money']")!.className.split(/\s+/)).toContain("select-text")
    const 首 = host.querySelector<HTMLElement>("[data-slot='money-counterparty']")!
    expect(首.getAttribute("data-copy")).toContain("6222****0001")
    expect(首.getAttribute("data-copy")).toContain("2 笔")
    expect(首.getAttribute("data-copy")).toContain("200.00")
  })

  test("双击一个对手方 ⇒ 这一行的原文进右栏", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => void 收到.push(文本))
    const host = mount(() => <Money projectId="p" id="e-账" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='money-counterparty']").length === 2)
    const 行 = host.querySelector<HTMLElement>("[data-slot='money-counterparty']")!
    行.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    expect(收到).toEqual([行.getAttribute("data-copy")!])
  })

  test("拖选跨汇总与对手方 ⇒ 每行一条的结构化载荷", async () => {
    const host = mount(() => <Money projectId="p" id="e-账" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='money-counterparty']").length === 2)
    装选区(() => true)
    const 写进 = 触发拖动(host.querySelector("[data-component='money']")!)
    const 载荷 = 写进.find(([类型]) => 类型 === "text/plain")?.[1] ?? ""
    // 2 条汇总 ＋ 2 个对手方 ＋ 1 条余额：每行一条。
    expect(载荷.split("\n").length).toBe(5)
    expect(载荷).toContain("出 3 笔 · 300.00")
    expect(载荷).toContain("李四")
  })

  test("明细两段都渲染：流水在前、人说的在后，缺失段照实写", async () => {
    const host = mount(() => <Money projectId="p" id="e-账" api={明细api(带明细)} />)
    await 等(() => host.querySelectorAll("[data-slot='money-human']").length === 2)
    const 流水 = [...host.querySelectorAll<HTMLElement>("[data-slot='money-flow']")]
    expect(流水).toHaveLength(2)
    expect(流水[0]!.textContent).toContain("50000.00 元")
    expect(流水[0]!.textContent).toContain("转账-货款")
    expect(流水[1]!.textContent).toContain("时间未知")
    expect(流水[1]!.textContent).toContain("无摘要")
    const 人说 = [...host.querySelectorAll<HTMLElement>("[data-slot='money-human']")]
    expect(人说[0]!.textContent).toContain("出 → 李四")
    expect(人说[0]!.textContent).toContain("50000.00 元")
    // 缺失照实（`#002-02`）：不补 0、不写空串。
    expect(人说[1]!.textContent).toContain("金额未记")
    expect(人说[1]!.textContent).toContain("时间未记")
    expect(人说[1]!.textContent).toContain("3 次")
  })

  test("精度只到日的人说行只显示日期，不补出时分（页面不替抽取器编时刻）", async () => {
    const host = mount(() => <Money projectId="p" id="e-账" api={明细api(带明细)} />)
    await 等(() => host.querySelectorAll("[data-slot='money-human']").length === 2)
    const 行 = host.querySelector<HTMLElement>("[data-slot='money-human']")!
    // 首 = 1773300000（本地 2026-03-12）；精度「到日」⇒ 时分是占位，不许出现。
    expect(行.getAttribute("data-copy")).toContain("2026-03-12")
    expect(行.getAttribute("data-copy")).not.toContain(":")
  })

  test("数据: null（新服务端明确表示空）⇒ 两段说「没有」，不说「本次未返回」", async () => {
    const host = mount(() => <Money projectId="p" id="e-账" api={明细api(null)} />)
    await 等(() => host.textContent!.includes("没有流水笔"))
    expect(host.textContent).toContain("没有人说的笔")
    expect(host.textContent).not.toContain("本次未返回")
  })

  test("两段各有自己的空态（不共用一句「没有明细」）", async () => {
    const host = mount(() => <Money projectId="p" id="e-账" api={明细api({ ...数据, 单笔最大: [], 人说的笔: [] })} />)
    await 等(() => host.textContent!.includes("没有流水笔"))
    expect(host.textContent).toContain("没有人说的笔")
  })

  test("服务端没返回明细（老版本）⇒ 两段都说「本次未返回」，不说成「没有」", async () => {
    const host = mount(() => <Money projectId="p" id="e-账" api={假api()} />)
    await 等(() => host.querySelectorAll("[data-slot='money-flow-empty']").length === 1)
    expect(host.textContent).toContain("本次未返回")
    expect(host.textContent).not.toContain("没有流水笔")
    expect(host.textContent).not.toContain("没有人说的笔")
  })

  test("人说的笔形状不对（方向认不出）⇒ 整段判错，不半份显示", async () => {
    const 坏 = {
      ...带明细,
      人说的笔: [...带明细.人说的笔, { id: "r-坏", 方向: "x", 对手: "某人", 金额: null, 首: null, 末: null, 精度: null, 次数: null }],
    }
    const host = mount(() => <Money projectId="p" id="e-账" api={明细api(坏)} />)
    await 等(() => host.textContent!.includes("本次未返回"))
    expect(host.querySelectorAll("[data-slot='money-human']").length).toBe(0)
  })

  test("人说的行能带走：data-copy 与双击发进右栏", async () => {
    const 收到: string[] = []
    订阅会话输入((文本) => void 收到.push(文本))
    const host = mount(() => <Money projectId="p" id="e-账" api={明细api(带明细)} />)
    await 等(() => host.querySelectorAll("[data-slot='money-human']").length === 2)
    const 行 = host.querySelector<HTMLElement>("[data-slot='money-human']")!
    expect(行.getAttribute("data-copy")).toContain("出 → 李四")
    行.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    expect(收到).toEqual([行.getAttribute("data-copy")!])
  })
})
