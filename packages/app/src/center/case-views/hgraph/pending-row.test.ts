import { afterEach, describe, expect, test } from "bun:test"
import { 取待定位, 请求定位, 清待定位 } from "./pending-row"

/** 模块级单例：每条用例收尾清掉，别让上一条的目标落到下一条（`#005-03` 同口径）。 */
afterEach(() => 清待定位())

describe("待定位行通道（T6 / R-F10）", () => {
  test("初始为空", () => {
    expect(取待定位()).toBeUndefined()
  })

  test("请求定位记下 项目/材料/行号", () => {
    请求定位("p1", "材料/话单.xlsx", 7)
    expect(取待定位()).toEqual({ 项目: "p1", 材料: "材料/话单.xlsx", 行号: 7, 序: 1 })
  })

  test("同一条连点两次 ⇒ 序递增（第二次也要能触发定位）", () => {
    请求定位("p1", "m1", 7)
    const 第一次 = 取待定位()!
    请求定位("p1", "m1", 7)
    const 第二次 = 取待定位()!
    expect(第二次.序).toBeGreaterThan(第一次.序)
    // 载荷不变：连点同一条不该把落点挪到别处。
    expect(第二次).toEqual({ 项目: "p1", 材料: "m1", 行号: 7, 序: 2 })
  })

  test("清待定位 ⇒ 清空", () => {
    请求定位("p1", "m1", 7)
    清待定位()
    expect(取待定位()).toBeUndefined()
  })
})
