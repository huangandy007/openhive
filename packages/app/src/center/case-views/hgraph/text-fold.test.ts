/**
 * 自由文字的字号像素与自动换行（012 · R-F11 / FR-024，修复轮 2026-11-16）。
 *
 * `字号像素` 是画布 `<text font-size>` 的**唯一出处**；`折行行们` 是**估算**：
 * CJK/全角按 1 个字宽、半角/ASCII 按 0.55 个字宽贪心折行，不做真实字形测量
 * （画布无法在渲染前量字宽，规格只要「按宽度折」）。
 */
import { describe, expect, test } from "bun:test"
import type { 文字 } from "./file"
import { 字号像素, 文字盒, 折行行们 } from "./text-fold"

describe("字号像素", () => {
  test("小 11 / 中 16 / 大 22（与画布原映射逐字相同）", () => {
    expect(字号像素("小")).toBe(11)
    expect(字号像素("中")).toBe(16)
    expect(字号像素("大")).toBe(22)
  })
})

describe("折行行们", () => {
  test("CJK：中号 16px、宽度 44 ⇒ 每行 2 个汉字", () => {
    expect(折行行们("张三李四王五", 44, "中")).toEqual(["张三", "李四", "王五"])
  })

  test("宽度正好等于两行字宽 ⇒ 放得下 2 个（32 = 16 × 2）", () => {
    expect(折行行们("甲乙丙丁", 32, "中")).toEqual(["甲乙", "丙丁"])
  })

  test("ASCII 宽度估算：16px 下 ab = 17.6 ⇒ 宽度 18 放得下 2 个", () => {
    expect(折行行们("ab", 18, "中")).toEqual(["ab"])
    // 17 放不下 2 个半角，只能一行一个（不是溢出成一整行）。
    expect(折行行们("ab", 17, "中")).toEqual(["a", "b"])
  })

  test("单行至少放 1 个字符（字宽 > 宽度也不吐空行/死循环）", () => {
    expect(折行行们("张", 5, "中")).toEqual(["张"])
  })

  test("显式 \\n 先分段（宽度缺省时也保留分段）", () => {
    expect(折行行们("甲\n乙", 44, "中")).toEqual(["甲", "乙"])
    expect(折行行们("甲乙\n丙丁", undefined, "中")).toEqual(["甲乙", "丙丁"])
  })

  test("宽度 undefined 或 ≤ 0 ⇒ 每段原样一行（不自动折）", () => {
    expect(折行行们("张三李四王五", undefined, "中")).toEqual(["张三李四王五"])
    expect(折行行们("张三李四王五", 0, "中")).toEqual(["张三李四王五"])
    expect(折行行们("张三李四王五", -10, "中")).toEqual(["张三李四王五"])
  })

  test("空串 ⇒ 一个空行（不是空数组，保证仍渲染一个 tspan）", () => {
    expect(折行行们("", 44, "中")).toEqual([""])
  })
})

describe("文字盒（选中高亮 / 框选命中共用这一份估算）", () => {
  const 造文字 = (补丁: Partial<文字> = {}): 文字 => ({
    id: "t1",
    内容: "甲乙丙丁",
    x: 100,
    y: 100,
    字号: "中",
    ...补丁,
  })

  test("中号 4 字、宽度 32 ⇒ 两行：宽 32、高 = 行距 + 1.2 字高", () => {
    const 盒 = 文字盒(造文字({ 宽度: 32 }))
    expect(盒.width).toBeCloseTo(32)
    // 16 × 1.35 + 16 × 1.2 = 40.8
    expect(盒.height).toBeCloseTo(40.8)
    expect(盒.x).toBeCloseTo(84) // 居中：100 − 32/2
    expect(盒.y).toBeCloseTo(85.6) // 100 − 16 × 0.9
  })

  test("对齐左 / 右：左 = x，右 = x − 宽", () => {
    expect(文字盒(造文字({ 宽度: 32, 对齐: "左" })).x).toBeCloseTo(100)
    expect(文字盒(造文字({ 宽度: 32, 对齐: "右" })).x).toBeCloseTo(68)
  })

  test("无宽度 ⇒ 单行按整段估算，不折行", () => {
    const 盒 = 文字盒(造文字({ 内容: "甲乙丙丁" }))
    expect(盒.width).toBeCloseTo(64)
    expect(盒.height).toBeCloseTo(19.2)
  })
})
