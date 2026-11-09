import { describe, expect, test } from "bun:test"
import { parseAmount, parseDuration, toFactRows, 归一化方向 } from "../../src/server/openhive/case-rows"
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

  test("兜底键与真表头同名 ⇒ 顺延到第一个未占用键，不覆盖（I2）", () => {
    // 第 3 列的重名「备注」按「第3列」兜底会撞上第 1 列的真表头「第3列」，
    // 直接写会把 "a" 静默覆盖掉。兜底要从 第3列 起循环找空位。
    const sheet = 表(["第3列", "备注", "备注"], [["a", "b", "c"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: {} })
    expect(row?.extras).toEqual({ 第3列: "a", 备注: "b", 第4列: "c" })
  })

  test("多列映射同一字段 ⇒ 每列按自己的原值判解析，失败列不丢（I3）", () => {
    const sheet = 表(["甲", "乙"], [["1.00", "bad"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "amount", 1: "amount" } })
    expect(row?.amount).toBe("1.00")
    expect(row?.extras).toEqual({ 乙: "bad" })
  })

  test("多列映射同一字段且都解析不出 ⇒ 两个原值都进 extras", () => {
    const sheet = 表(["甲", "乙"], [["bad", "x"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "amount", 1: "amount" } })
    expect(row?.amount).toBeNull()
    expect(row?.extras).toEqual({ 甲: "bad", 乙: "x" })
  })

  test("未选中的列一律进 extras：最小下标失败、后一列成功也不丢（R25a）", () => {
    const sheet = 表(["甲", "乙"], [["bad", "5.00"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "amount", 1: "amount" } })
    expect(row?.amount).toBeNull()
    expect(row?.extras).toEqual({ 甲: "bad", 乙: "5.00" })
  })

  test("未选中的列即使解析成功也进 extras：标准列仍是最小下标（R25a）", () => {
    const sheet = 表(["甲", "乙"], [["1.00", "2.00"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "amount", 1: "amount" } })
    expect(row?.amount).toBe("1.00")
    // 第 1 列没被当标准列用，只有 extras 一条活路。
    expect(row?.extras).toEqual({ 乙: "2.00" })
  })

  test("mapping 里出现非法字段值 ⇒ 当未映射，原值进 extras（I4）", () => {
    const sheet = 表(["时长"], [["37"]])
    const [row] = toFactRows({
      projectId: "p1",
      materialId: "m1",
      sheet,
      mapping: { 0: "通话时长" } as any,
    })
    expect(row?.durationSec).toBeNull()
    expect(row?.extras).toEqual({ 时长: "37" })
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

  test("日期单元格用 dateText 解析，started_raw 仍是原文（I2）", () => {
    // `text` 是 Excel 默认格式的 "1/2/26 3:04:05"（不可解析），`dateText` 是同一时刻的 ISO。
    // 解析走 dateText；落库的原始值仍必须是 text —— 两条判据不能互相替代。
    const sheet: RawSheet = {
      name: "Sheet1",
      header: [{ text: "通话时间", kind: "text" }],
      rows: [
        {
          rowNo: 2,
          cells: [{ text: "1/2/26 3:04:05", kind: "number", dateText: "2026-01-02 03:04:05" }],
        },
      ],
    }
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "startedAt" } })
    expect(row?.startedAt).toBe(Date.UTC(2026, 0, 2, 3, 4, 5) / 1000 - 8 * 3600)
    expect(row?.startedRaw).toBe("1/2/26 3:04:05")
    expect(row?.precision).toBe("到秒")
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

  test("已映射的余额列解析不出 ⇒ 原值补进 extras（R23 的 balance 子句）", () => {
    const sheet = 表(["余额"], [["abc"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "balance" } })
    expect(row?.balance).toBeNull()
    expect(row?.extras).toEqual({ 余额: "abc" })
  })

  test("已映射的时长列解析不出 ⇒ 原值补进 extras（R23 的 durationSec 子句）", () => {
    const sheet = 表(["时长"], [["1:2"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "durationSec" } })
    expect(row?.durationSec).toBeNull()
    expect(row?.extras).toEqual({ 时长: "1:2" })
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

  test("千分位必须分组合法，不能把 1234,56 猜成 123456（I5）", () => {
    expect(parseAmount("1,234.50")).toBe("1234.50")
    expect(parseAmount("1,234,567")).toBe("1234567.00")
    expect(parseAmount("-1,234.50")).toBe("-1234.50")
    expect(parseAmount("1234,56")).toBeNull()
    expect(parseAmount("1,23")).toBeNull()
  })

  test("超出 numeric(18,2) 的整数位 ⇒ null，不炸整块 INSERT（I6）", () => {
    expect(parseAmount("99999999999999999999.99")).toBeNull()
    // 边界：16 位整数位（numeric(18,2) 的上限）仍是合法值
    expect(parseAmount("9999999999999999.99")).toBe("9999999999999999.99")
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

  test("超出 int4 上限 ⇒ null，不炸整块 INSERT（I6）", () => {
    expect(parseDuration("100000000000000000000")).toBeNull()
    expect(parseDuration("2147483647")).toBe(2147483647)
  })
})

describe("新增三列与 extras 键", () => {
  test("对手账号/户名/本方账号/方向各归各列", () => {
    const sheet = 表(
      ["交易对方账卡号", "交易对方名称", "查询账号", "借贷标志", "交易金额"],
      [["6222001", "张三", "6222999", "借", "-100.00"]],
    )
    const rows = toFactRows({
      projectId: "p1",
      materialId: "m1",
      sheet,
      mapping: { 0: "counterparty", 1: "counterpartyName", 2: "ownerAccount", 3: "direction", 4: "amount" },
    })
    expect(rows[0]).toMatchObject({
      counterparty: "6222001",
      counterpartyName: "张三",
      ownerAccount: "6222999",
      direction: "付",
    })
  })

  test("没有方向列时按金额正负兜：负记付，正数不猜", () => {
    const 负 = toFactRows({
      projectId: "p",
      materialId: "m",
      sheet: 表(["金额"], [["-1.00"]]),
      mapping: { 0: "amount" },
    })
    expect(负[0]?.direction).toBe("付")
    const 正 = toFactRows({
      projectId: "p",
      materialId: "m",
      sheet: 表(["金额"], [["1.00"]]),
      mapping: { 0: "amount" },
    })
    expect(正[0]?.direction).toBeNull()
  })

  test("认不出的方向原值进 extras，不能被当成已用标准列吞掉", () => {
    const rows = toFactRows({
      projectId: "p",
      materialId: "m",
      sheet: 表(["收付标志"], [["其他"]]),
      mapping: { 0: "direction" },
    })
    expect(rows[0]?.direction).toBeNull()
    expect(rows[0]?.extras).toMatchObject({ 收付标志: "其他" })
  })

  test("只有户名列时 counterparty 与 counterparty_name 都写", () => {
    const rows = toFactRows({
      projectId: "p",
      materialId: "m",
      sheet: 表(["交易对方名称"], [["张三"]]),
      mapping: { 0: "counterpartyName" },
    })
    expect(rows[0]?.counterparty).toBe("张三")
    expect(rows[0]?.counterpartyName).toBe("张三")
  })

  test("extras 落点字段用 camelCase 字段名作键，不用原表头", () => {
    const rows = toFactRows({
      projectId: "p",
      materialId: "m",
      sheet: 表(["收货地址"], [["杭州市"]]),
      mapping: { 0: "address" },
    })
    expect(rows[0]?.extras).toEqual({ address: "杭州市" })
  })

  test("方向归一化：收/进/入/贷/转入/收入 → 收；付/出/借/转出/支出 → 付", () => {
    expect(归一化方向("收")).toBe("收")
    expect(归一化方向("进")).toBe("收")
    expect(归一化方向("贷")).toBe("收")
    expect(归一化方向("转出")).toBe("付")
    expect(归一化方向("支出")).toBe("付")
    expect(归一化方向("其他")).toBeNull()
    expect(归一化方向(null)).toBeNull()
  })

  test("有方向列但本行单元格为空 ⇒ 不按金额符号猜，记 null", () => {
    const rows = toFactRows({
      projectId: "p",
      materialId: "m",
      sheet: 表(["收付标志", "金额"], [["", "-1.00"]]),
      mapping: { 0: "direction", 1: "amount" },
    })
    expect(rows[0]?.direction).toBeNull()
  })

  test("主叫/被叫写标准列时去国码，原文仍进 extras（若该列另有映射）", () => {
    const rows = toFactRows({
      projectId: "p",
      materialId: "m",
      sheet: 表(["主叫号码"], [["+8613800000000"]]),
      mapping: { 0: "caller" },
    })
    expect(rows[0]?.caller).toBe("13800000000")
  })

  test("对手账号去空白与横线", () => {
    const rows = toFactRows({
      projectId: "p",
      materialId: "m",
      sheet: 表(["对方账号"], [[" 6222-001 "]]),
      mapping: { 0: "counterparty" },
    })
    expect(rows[0]?.counterparty).toBe("6222001")
  })
})
