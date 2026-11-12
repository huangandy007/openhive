import { describe, expect, test } from "bun:test"
import { 事件类型们, 是事件类型 } from "../../src/server/openhive/case-event-types"

describe("事件类型词表（Q17）", () => {
  // 词表是 as const 元组，bun:test 的 toContain 会把参数收窄到字面量并集；这里按
  // readonly string[] 看待，才能用循环变量断言——测的是「有没有」，不是字面量类型。
  const 词表: readonly string[] = 事件类型们

  test("覆盖设计列出的首批类型与兜底值", () => {
    for (const t of ["资金交易", "通话", "消费", "乘车", "乘机", "住宿"]) expect(词表).toContain(t)
    expect(词表).toContain("其他")
  })

  test("无重复", () => {
    expect(new Set(事件类型们).size).toBe(事件类型们.length)
  })

  test("词表外的一律不认", () => {
    expect(是事件类型("资金交易")).toBe(true)
    expect(是事件类型("资金")).toBe(false)
    expect(是事件类型("")).toBe(false)
    expect(是事件类型(123)).toBe(false)
    expect(是事件类型(null)).toBe(false)
  })
})
