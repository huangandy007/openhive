import { describe, expect, test } from "bun:test"
import { RAIL_ENTRIES } from "../rail/entries"
import { moduleColorVar } from "./module-color"

describe("模块着色（FR-005 / DESIGN §4.5）", () => {
  test("五个图标栏入口两两不同色——同色就区分不出 tab 来自哪个模块", () => {
    const colors = RAIL_ENTRIES.map((entry) => moduleColorVar(entry.id))

    expect(new Set(colors).size).toBe(RAIL_ENTRIES.length)
  })

  test("没登记的模块兜底成灰：不抛错、也不留白（DESIGN §4.5 兜底行）", () => {
    expect(moduleColorVar("some-future-module")).toBe("--v2-avatar-bg-gray")
  })

  // 以下 2 条**非 RED 驱动**：是「实现 ↔ 设计系统」的守卫断言（先有映射、后有测试），
  // 写法沿用 T006/T007 对同类守卫的处理——在此声明，不谎称它们抓过 bug。
  test("话单分析取蓝——沿用 DESIGN §1.3 的既有依据，不是自选", () => {
    expect(moduleColorVar("cdr-analysis")).toBe("--v2-avatar-bg-blue")
  })

  test("一律引用 v2 语义变量名，不是写死的 hex（宪法 §八）", () => {
    for (const entry of [...RAIL_ENTRIES, { id: "unknown" }]) {
      expect(moduleColorVar(entry.id)).toMatch(/^--v2-[a-z0-9-]+$/)
    }
  })
})
