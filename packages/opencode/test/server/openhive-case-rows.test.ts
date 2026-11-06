import { describe, expect, test } from "bun:test"
import { parseAmount, parseDuration, toFactRows } from "../../src/server/openhive/case-rows"
import type { RawRow, RawSheet } from "../../src/server/openhive/case-sheet"

function 表(header: string[], rows: string[][]): RawSheet {
  // 空串要变成 null：`RawSheet` 里空单元格就是 `{ text: null }`（Task 2 的 `toRawCell`），
  // 夹具照抄这个口径，否则「整行都空」那条用例测的是夹具、不是实现。
  const 转 = (t: string): RawRow["cells"][number] =>
    t === "" ? { text: null, kind: "empty" } : { text: t, kind: /^-?\d+(\.\d+)?$/.test(t) ? "number" : "text" }
  return {
    name: "Sheet1",
    header: header.map(转),
    rows: rows.map((r, i) => ({ rowNo: i + 2, cells: r.map(转) })),
  }
}

describe("toFactRows", () => {
  test("标准字段各归各位，行号跟文件走", () => {
    const sheet = 表(
      ["主叫号码", "被叫号码", "通话时间", "通话时长"],
      [
        ["13800000000", "13900000000", "2026-01-02 03:04:05", "37"],
        ["13700000000", "13600000000", "2026-01-02 03:05", "00:01:23"],
      ],
    )
    const rows = toFactRows({
      projectId: "p1",
      materialId: "m1",
      sheet,
      mapping: { 0: "caller", 1: "callee", 2: "startedAt", 3: "durationSec" },
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      projectId: "p1",
      materialId: "m1",
      sheet: "Sheet1",
      rowNo: 2,
      caller: "13800000000",
      callee: "13900000000",
      durationSec: 37,
      startedRaw: "2026-01-02 03:04:05",
      precision: "到秒",
      timeType: "发生",
    })
    expect(rows[1]).toMatchObject({ rowNo: 3, durationSec: 83, precision: "到分" })
  })

  test("认不出的列原样进 extras，键是原表头", () => {
    const sheet = 表(["主叫号码", "基站"], [["13800000000", "HZ-01"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "caller" } })
    expect(row?.extras).toEqual({ 基站: "HZ-01" })
  })

  test("空表头/重名表头进 extras 时用「第N列」兜底，不覆盖", () => {
    const sheet = 表(["", "备注", "备注"], [["a", "b", "c"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: {} })
    expect(row?.extras).toEqual({ 第1列: "a", 备注: "b", 第3列: "c" })
  })

  test("整行都空 ⇒ 不产出行（Excel 常见的尾部空行）", () => {
    const sheet = 表(["主叫号码"], [["13800000000"], ["", ""]])
    expect(toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "caller" } })).toHaveLength(1)
  })

  test("时间认不出 ⇒ startedAt 为 null，原文仍在 startedRaw", () => {
    const sheet = 表(["通话时间"], [["昨天下午"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "startedAt" } })
    expect(row?.startedAt).toBeNull()
    expect(row?.startedRaw).toBe("昨天下午")
    expect(row?.precision).toBeNull()
  })

  test("金额去掉千分位与货币符号，保留两位小数", () => {
    const sheet = 表(["金额"], [["-1,234.50"], ["￥5000"], ["abc"]])
    const rows = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "amount" } })
    expect(rows.map((r) => r.amount)).toEqual(["-1234.50", "5000.00", null])
  })

  test("已映射的金额列解析不出 ⇒ 原值补进 extras，不静默丢", () => {
    const sheet = 表(["金额", "摘要"], [["1.234", "转账"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "amount" } })
    expect(row?.amount).toBeNull()
    expect(row?.extras).toEqual({ 金额: "1.234", 摘要: "转账" })
  })

  test("已映射且解析成功 ⇒ 不进 extras（不重复存两遍）", () => {
    const sheet = 表(["金额"], [["1,234.50"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "amount" } })
    expect(row?.amount).toBe("1234.50")
    expect(row?.extras).toEqual({})
  })
})

describe("parseAmount", () => {
  test("去掉千分位、货币符号、空白后必须是合法小数", () => {
    expect(parseAmount("1,234.50")).toBe("1234.50")
    expect(parseAmount("￥1,000")).toBe("1000.00")
    expect(parseAmount("-0.5")).toBe("-0.50")
    expect(parseAmount("")).toBeNull()
    expect(parseAmount("1.234")).toBeNull()
    expect(parseAmount("约1000")).toBeNull()
  })
})

describe("parseDuration", () => {
  test("秒、mm:ss、hh:mm:ss 三种写法", () => {
    expect(parseDuration("37")).toBe(37)
    expect(parseDuration("1:23")).toBe(83)
    expect(parseDuration("01:02:03")).toBe(3723)
    expect(parseDuration("37秒")).toBe(37)
    expect(parseDuration("")).toBeNull()
    expect(parseDuration("不详")).toBeNull()
  })
})
