import { afterEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import type { JSX } from "solid-js"
import { CardTemplatePreview } from "./card-template-preview"
import type { 预览输出 } from "../../project/case-template-api"

function mount(element: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  render(element, host)
  return host
}
afterEach(() => {
  document.body.innerHTML = ""
})

const 结果: 预览输出 = {
  卡片数: 1,
  跳过: { "缺少「谁」": 2, 空行: 1 },
  工作表们: [{ sheet: "Sheet1", 卡片数: 1, 跳过: { 空行: 1 } }],
  卡片们: [
    {
      id: "预览:1",
      type: "通话",
      摘要: "通话：13800000001 与 13900000002，时长 180 秒",
      occurredAt: 1_700_000_000,
      occurredRaw: "2023-11-14 22:13:00",
      precision: "秒",
      occurredEnd: null,
      amount: null,
      currency: "CNY",
      attrs: {},
      参与者们: [
        { 角色: "主叫", 提及: "13800000001", 规范值: "13800000001", 实体: "e-1", 实体类型: "号码", ordinal: 0 },
        { 角色: "被叫", 提及: "13900000002", 规范值: "13900000002", 实体: "e-2", 实体类型: "号码", ordinal: 1 },
      ],
      出处: { sheet: "Sheet1", rowNo: 2 },
    },
  ],
}

describe("预览结果区", () => {
  test("汇总：卡片数 / 跳过合计 / 原因明细 / 按工作表回执 / 每表 20 行提示", () => {
    const host = mount(() => <CardTemplatePreview 结果={结果} />)
    const 汇总 = host.querySelector("[data-slot='card-template-preview-summary']")!
    expect(汇总.textContent).toContain("1")
    expect(汇总.textContent).toContain("3")
    // 完整文案断言：单看 "1"/"3" 会被原因明细里的「空行 1」满足（审查 I-1）。
    expect(汇总.textContent).toContain("产出 1 张卡片 · 跳过 3 行")
    // 非过期形态不渲染过期提示（审查 I-2）。
    expect(host.querySelector("[data-slot='card-template-preview-expired']")).toBeNull()
    expect(汇总.textContent).toContain("缺少「谁」 2")
    expect(汇总.textContent).toContain("空行 1")
    expect(host.querySelector("[data-slot='card-template-preview-sheets']")!.textContent).toContain("Sheet1：1 卡")
    expect(host.querySelector("[data-slot='card-template-preview-sheets']")!.textContent).toContain("前 20 行")
  })

  test("卡片表：摘要 / 时间 / 参与者角色＋提及 / 金额 / 来源", () => {
    const host = mount(() => <CardTemplatePreview 结果={结果} />)
    const 行 = host.querySelector("[data-slot='card-template-preview-card']")!
    expect(行.textContent).toContain("通话：13800000001")
    expect(行.textContent).toContain("主叫：13800000001")
    expect(行.textContent).toContain("被叫：13900000002")
    expect(行.textContent).toContain("Sheet1#2")
    expect(行.textContent).toContain("—") // 金额 null ⇒ 金额文本 的占位
    // 时间列是格式化后的 `YYYY-MM-DD HH:mm`，不写死时区值（审查 M-1）。
    const 格们 = 行.querySelectorAll("td")
    expect(格们[1].textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    // 表头文案与列序（审查 M-2）。
    const 表头们 = [...host.querySelectorAll("[data-slot='card-template-preview-cards'] thead th")].map((项) => 项.textContent)
    expect(表头们).toEqual(["摘要", "时间", "参与者", "金额", "来源"])
  })

  test("0 卡：一张工作表全被跳过也不崩，汇总写明产出 0 卡", () => {
    // 服务端可达形态：表在、卡片为 0、跳过计数在（不是 `工作表们: []`）。
    const 全跳过: 预览输出 = {
      卡片数: 0,
      跳过: { 空行: 2 },
      工作表们: [{ sheet: "Sheet1", 卡片数: 0, 跳过: { 空行: 2 } }],
      卡片们: [],
    }
    const host = mount(() => <CardTemplatePreview 结果={全跳过} />)
    expect(host.querySelector("[data-slot='card-template-preview-summary']")!.textContent).toContain(
      "产出 0 张卡片 · 跳过 2 行",
    )
    expect(host.querySelector("[data-slot='card-template-preview-card']")).toBeNull()
    expect(host.querySelector("[data-slot='card-template-preview-sheets']")!.textContent).toContain(
      "Sheet1：0 卡 · 跳过 2",
    )
  })

  test("金额币种：CNY 显示「元」，非 CNY 原样显示币种码（最终广审 T4 M-7）", () => {
    const 两币: 预览输出 = {
      卡片数: 2,
      跳过: {},
      工作表们: [{ sheet: "Sheet1", 卡片数: 2, 跳过: {} }],
      卡片们: [
        { ...结果.卡片们[0]!, id: "预览:1", amount: "100.00", currency: "CNY" },
        { ...结果.卡片们[0]!, id: "预览:2", amount: "200.00", currency: "USD" },
      ],
    }
    const host = mount(() => <CardTemplatePreview 结果={两币} />)
    const 行们 = [...host.querySelectorAll<HTMLElement>("[data-slot='card-template-preview-card']")]
    expect(行们[0]!.textContent).toContain("100.00 元")
    // 非人民币不能冒充「元」：币种码原样显示（项目里真实存在非 CNY 数据）。
    expect(行们[1]!.textContent).toContain("200.00 USD")
    expect(行们[1]!.textContent).not.toContain("元")
  })

  test("过期：置灰并说「需重新预览」，不是悄悄用旧结果", () => {
    const host = mount(() => <CardTemplatePreview 结果={结果} 过期 />)
    expect(host.querySelector("[data-slot='card-template-preview']")!.getAttribute("data-expired")).toBe("")
    expect(host.querySelector("[data-slot='card-template-preview-expired']")!.textContent).toContain(
      "内容已变，需重新预览",
    )
    // 置灰是独立于文案的视觉事实，整 token 匹配（审查 I-2）。
    expect(host.querySelector("[data-slot='card-template-preview']")!.classList.contains("opacity-50")).toBe(true)
  })
})
