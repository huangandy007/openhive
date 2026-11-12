import { describe, expect, test } from "bun:test"
import { 事件类型们, 是事件类型 } from "../../src/server/openhive/case-event-types"

describe("事件类型词表（Q17）", () => {
  // 词表是 as const 元组，bun:test 的 toContain 会把参数收窄到字面量并集；这里按
  // readonly string[] 看待，才能用循环变量断言——测的是「有没有」，不是字面量类型。
  const 词表: readonly string[] = 事件类型们

  test("覆盖设计列出的全部 9 项", () => {
    // 期望值写死字面量，不从实现里取：从实现取数组再比等于自证，删一项也照样绿。
    const 应有序 = ["资金交易", "通话", "消费", "乘车", "乘机", "住宿", "见面", "抓获", "其他"]
    for (const t of 应有序) expect(词表).toContain(t)
    // 多出来的项也算漏：只查「包含」挡不住悄悄加值。
    expect(词表.length).toBe(应有序.length)
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
    expect(是事件类型(undefined)).toBe(false)
    expect(是事件类型({})).toBe(false)
    expect(是事件类型(Number.NaN)).toBe(false)
  })
})
