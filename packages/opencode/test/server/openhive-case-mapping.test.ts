import { describe, expect, test } from "bun:test"
import { classifyMaterialType, detectMapping, formatFingerprint } from "../../src/server/openhive/case-mapping"

describe("detectMapping · 第一层：表头词典", () => {
  test("话单表头逐个对上", () => {
    const r = detectMapping(
      ["主叫号码", "被叫号码", "通话时间", "通话时长", "基站"],
      [["13800000000", "13900000000", "2026-01-02 03:04:05", "37", "HZ-01"]],
    )
    expect(r.method).toBe("词典")
    expect(r.columns).toEqual({ 0: "caller", 1: "callee", 2: "startedAt", 3: "durationSec" })
    expect(r.unknownColumns).toEqual([4])
  })

  test("资金表头对上金额与余额", () => {
    const r = detectMapping(
      ["交易时间", "交易金额", "余额", "对方账号", "摘要"],
      [["2026-01-02 03:04:05", "-1234.50", "5000.00", "6222001", "转账"]],
    )
    expect(r.columns).toEqual({ 0: "startedAt", 1: "amount", 2: "balance", 3: "counterparty" })
    expect(r.unknownColumns).toEqual([4])
  })

  test("表头带空格/全角括号也能对上（规范后再比）", () => {
    const r = detectMapping([" 主叫号码 ", "被叫 号码", "金额（元）"], [["1", "2", "3.00"]])
    expect(r.columns).toEqual({ 0: "caller", 1: "callee", 2: "amount" })
  })

  test("同一个字段只认第一个命中列，不重复占", () => {
    const r = detectMapping(["主叫号码", "被叫号码", "本机号码"], [["1", "2", "3"]])
    expect(r.columns[0]).toBe("caller")
    expect(r.columns[2]).toBeUndefined()
    expect(r.unknownColumns).toEqual([2])
  })

  test("复合表头按后缀认：「主叫通话时长」是时长，不是主叫", () => {
    // 包含匹配会把 col0 认成 caller（「主叫」是它的词），时长列就此静默消失。
    const r = detectMapping(["主叫通话时长", "通话时间"], [["37", "2026-01-02 03:04:05"]])
    expect(r.columns).toEqual({ 0: "durationSec", 1: "startedAt" })
  })

  test("两列都以后缀命中同一字段 ⇒ 消歧不了就不认", () => {
    const r = detectMapping(["主叫通话时长", "被叫通话时长"], [["37", "83"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0, 1])
  })

  test("「通话分钟」不认——裸数字按秒解释会差 60 倍（R24）", () => {
    // parseDuration 对裸数字只能按秒解释；表头明说「分钟」时 5 会被落成 5 秒。
    // 误认比漏认糟：不认该列 ⇒ 原值进 extras，前端可手工修正（计划 3）。
    const r = detectMapping(["通话分钟"], [["5"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0])
  })
})

describe("detectMapping · 第二层：数据特征", () => {
  test("表头不认识，但整列是 yyyy-mm-dd hh:mm:ss ⇒ 认成 startedAt", () => {
    const r = detectMapping(
      ["A", "B"],
      [
        ["13800000000", "2026-01-02 03:04:05"],
        ["13900000000", "2026-01-02 03:05:00"],
      ],
    )
    expect(r.method).toBe("特征")
    expect(r.columns).toEqual({ 1: "startedAt" })
    expect(r.unknownColumns).toEqual([0])
  })

  test("整列两位小数 ⇒ 只有一列候选时才认成 amount", () => {
    const r = detectMapping(["A", "B"], [["1", "-12.50"], ["2", "33.00"]])
    expect(r.columns).toEqual({ 1: "amount" })
  })

  test("两列都像金额 ⇒ 都不认（消歧不了就不猜，§6.3 认不出来也入库）", () => {
    const r = detectMapping(["A", "B"], [["1.00", "2.00"], ["3.00", "4.00"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0, 1])
  })

  test("词典已认走的列不会被特征层重复认走", () => {
    const r = detectMapping(["通话时间", "B"], [["2026-01-02 03:04:05", "2026-01-02 04:04:05"]])
    expect(r.columns).toEqual({ 0: "startedAt" })
    expect(r.unknownColumns).toEqual([1])
  })
})

describe("detectMapping · 认不出来也入库", () => {
  test("全是自由文本 ⇒ 一个都不认，但不抛错", () => {
    const r = detectMapping(["备注", "说明"], [["张三", "打了三次"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0, 1])
  })

  test("表头全空也一样", () => {
    const r = detectMapping([null, null], [["a", "b"]])
    expect(r.unknownColumns).toEqual([0, 1])
  })
})

describe("formatFingerprint", () => {
  test("同表头同列类型 ⇒ 同指纹（与具体取值无关）", () => {
    const a = formatFingerprint(["主叫号码", "金额"], [["13800000000", "1.00"]])
    const b = formatFingerprint(["主叫号码", "金额"], [["13911111111", "2.50"]])
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })

  test("表头变了 ⇒ 指纹变", () => {
    expect(formatFingerprint(["主叫号码"], [["1"]])).not.toBe(formatFingerprint(["被叫号码"], [["1"]]))
  })

  test("列的数据形状变了 ⇒ 指纹变", () => {
    expect(formatFingerprint(["X"], [["1.00"]])).not.toBe(formatFingerprint(["X"], [["甲"]]))
  })

  test("表头只有空格差异 ⇒ 同指纹（先规范化）", () => {
    expect(formatFingerprint([" 主叫号码 "], [["1"]])).toBe(formatFingerprint(["主叫号码"], [["1"]]))
  })
})

describe("classifyMaterialType", () => {
  test("有主叫/被叫/时长 ⇒ 话单", () => {
    expect(classifyMaterialType({ 0: "caller", 1: "callee" })).toBe("话单")
    expect(classifyMaterialType({ 3: "durationSec" })).toBe("话单")
  })

  test("有金额/余额 ⇒ 资金", () => {
    expect(classifyMaterialType({ 1: "amount" })).toBe("资金")
    expect(classifyMaterialType({ 2: "balance" })).toBe("资金")
  })

  test("只认出时间或对方账号 ⇒ 其他", () => {
    expect(classifyMaterialType({ 0: "startedAt" })).toBe("其他")
    expect(classifyMaterialType({ 0: "counterparty" })).toBe("其他")
    expect(classifyMaterialType({})).toBe("其他")
  })
})
