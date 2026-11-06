import { describe, expect, test } from "bun:test"
import { 切片, 每片字数, 最多片数 } from "../../src/server/openhive/case-slice"

describe("切片", () => {
  test("按行边界切，偏移能原样切回原文", () => {
    const 文本 = Array.from({ length: 100 }, (_, i) => `第${i}行：` + "字".repeat(80)).join("\n")
    const 片们 = 切片(文本, { 每片字数: 300 })
    expect(片们.length).toBeGreaterThan(1)
    for (const 片 of 片们) expect(文本.slice(片.起, 片.止)).toBe(片.文本)
    // 该输入无空行，允许逐片首尾相接：片与片之间既不重叠也不留缺口。
    for (let i = 1; i < 片们.length; i++) expect(片们[i].起, `第 ${i} 片`).toBe(片们[i - 1].止)
    expect(片们[0].起).toBe(0)
    expect(片们.at(-1)!.止).toBe(文本.length)
  })

  test("短行跨行打包：能装下的多行合成一片", () => {
    const 文本 = "第一行\n第二行\n第三行\n"
    const 片们 = 切片(文本, { 每片字数: 100 })
    expect(片们).toHaveLength(1)
    expect(片们[0].文本).toBe(文本)
  })

  test("每片尽量不超过上限（单行超限时才硬切）", () => {
    const 文本 = Array.from({ length: 50 }, () => "字".repeat(90) + "\n").join("")
    const 片们 = 切片(文本, { 每片字数: 300 })
    for (const 片 of 片们) expect(片.文本.length).toBeLessThanOrEqual(300)
  })

  test("一万字的单行 ⇒ 硬切成多片，不丢字", () => {
    const 文本 = "字".repeat(10_000)
    const 片们 = 切片(文本, { 每片字数: 1500 })
    expect(片们.length).toBe(7)
    expect(片们.map((p) => p.文本).join("")).toBe(文本)
  })

  test("不劈开代理对（emoji 不会被切成两半）", () => {
    const 文本 = "😀".repeat(1000)
    const 片们 = 切片(文本, { 每片字数: 1001 })
    expect(片们.map((p) => p.文本).join("")).toBe(文本)
    for (const 片 of 片们) expect(片.文本).not.toMatch(/[\uD800-\uDBFF]$/)
  })

  test("空段 / 纯空白片被跳过", () => {
    expect(切片("", { 每片字数: 10 })).toEqual([])
    expect(切片("\n\n\n", { 每片字数: 10 })).toEqual([])
  })

  test("超过字数上限 ⇒ 可操作报错（R8）", () => {
    const 文本 = "字".repeat(每片字数 * (最多片数 + 1))
    expect(() => 切片(文本)).toThrow("超过单份材料上限")
  })

  test("超长的纯空白行不产生空片", () => {
    expect(切片(" ".repeat(10), { 每片字数: 3 })).toEqual([])
  })

  test("非法参数 ⇒ 可解释的报错，别让非整数偏移进 locator", () => {
    expect(() => 切片("字", { 每片字数: 1 })).toThrow("不小于 2 的整数")
    expect(() => 切片("字", { 每片字数: 1.5 })).toThrow("不小于 2 的整数")
    expect(() => 切片("字", { 每片字数: Number.NaN })).toThrow("不小于 2 的整数")
    expect(() => 切片("字", { 最多片数: 0 })).toThrow("不小于 1 的整数")
  })

  test("第二道闸：字数没超、但片数超 ⇒ 同样报可操作错", () => {
    // 恰好 3000 字（1001 + 1001 + 998），过得了 1500×2 的字数闸；
    // 但每片只装得下一行（1001 / 998），三行 ⇒ 三片，撞第二道闸。
    const 文本 = ("字".repeat(1000) + "\n").repeat(2) + "字".repeat(998)
    expect(() => 切片(文本, { 每片字数: 1500, 最多片数: 2 })).toThrow("文本超过 2 片")
  })
})
