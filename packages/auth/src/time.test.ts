import { describe, expect, test } from "bun:test"
import { nowSeconds } from "./time"

describe("nowSeconds", () => {
  test("返回 Unix 秒，不是毫秒", () => {
    // 毫秒会差出 3 个数量级（1.79e12 vs 1.79e9），这条断言能直接钉住单位。
    // 用户表的时间列是 PG integer（上限 2147483647），写成毫秒会插不进去——
    // 2026-09-29 录入首行时实测撞上过 22003 numeric_value_out_of_range。
    expect(Math.abs(nowSeconds() - Math.floor(Date.now() / 1000))).toBeLessThan(2)
  })

  test("取整，不带小数", () => {
    expect(Number.isInteger(nowSeconds())).toBe(true)
  })
})
