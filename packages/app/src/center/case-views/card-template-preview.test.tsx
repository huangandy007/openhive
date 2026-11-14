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
  })

  test("过期：置灰并说「需重新预览」，不是悄悄用旧结果", () => {
    const host = mount(() => <CardTemplatePreview 结果={结果} 过期 />)
    expect(host.querySelector("[data-slot='card-template-preview']")!.getAttribute("data-expired")).toBe("")
    expect(host.querySelector("[data-slot='card-template-preview-expired']")!.textContent).toContain("需重新预览")
  })
})
