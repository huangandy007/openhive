import { describe, expect, test } from "bun:test"
import {
  extras字段们,
  候选字段集,
  归一化值,
  推断表类型,
  是标准列,
  是识别字段,
  标准列字段们,
  形状命中率,
} from "../../src/server/openhive/case-field-registry"

describe("字段目录", () => {
  test("资金表：两位小数列占多数 ⇒ 候选集含对手/本方/金额/余额/方向", () => {
    const 候选 = 候选字段集(
      ["交易时间", "交易金额", "余额", "交易对方账卡号", "查询账号", "借贷标志"],
      [["2026-01-02 03:04:05", "-1.00", "5.00", "6222001", "6222999", "借"]],
    )
    expect(候选.has("amount")).toBe(true)
    expect(候选.has("balance")).toBe(true)
    expect(候选.has("counterparty")).toBe(true)
    expect(候选.has("counterpartyName")).toBe(true)
    expect(候选.has("ownerAccount")).toBe(true)
    expect(候选.has("direction")).toBe(true)
  })

  test("话单表：11 位手机号列 ⇒ 候选集含主叫/被叫/时长，不含金额", () => {
    const 候选 = 候选字段集(
      ["主叫号码", "被叫号码", "通话时间", "通话时长"],
      [["13800000000", "13900000000", "2026-01-02 03:04:05", "37"]],
    )
    expect(候选.has("caller")).toBe(true)
    expect(候选.has("callee")).toBe(true)
    expect(候选.has("durationSec")).toBe(true)
    expect(候选.has("amount")).toBe(false)
  })

  test("订餐表：没有金额/手机号 ⇒ 候选集含 extras 字段", () => {
    const 候选 = 候选字段集(["收货地址", "商户名称", "联系电话", "下单时间"], [["杭州市", "某店", "0571-1", "2026-01-02"]])
    expect(候选.has("address")).toBe(true)
    expect(候选.has("merchant")).toBe(true)
    expect(候选.has("contactPhone")).toBe(true)
    expect(候选.has("deliveredAt")).toBe(true)
  })

  test("账号归一化只去空白与横线，原文不动", () => {
    expect(归一化值("counterparty", " 6222-001  ")).toBe("6222001")
    expect(归一化值("caller", "+8613800000000")).toBe("13800000000")
  })

  test("形状命中率：空列 0，两位小数 100%", () => {
    expect(形状命中率("amount", [null, "", " "])).toBe(0)
    expect(形状命中率("amount", ["1.00", "2.50", null])).toBe(1)
    expect(形状命中率("amount", ["1.00", "abc"])).toBe(0.5)
  })

  test("extras 字段不是标准列", () => {
    for (const f of extras字段们) expect(是标准列(f)).toBe(false)
    expect(是标准列("counterpartyName")).toBe(true)
  })

  test("话单带费用列：表头词投票优先于金额形状 ⇒ 仍判话单，金额不进候选", () => {
    const 候选 = 候选字段集(
      ["主叫号码", "被叫号码", "通话时间", "通话时长", "费用"],
      [["13800000000", "13900000000", "2026-01-02 03:04:05", "37", "0.50"]],
    )
    expect(候选.has("caller")).toBe(true)
    expect(候选.has("callee")).toBe(true)
    expect(候选.has("durationSec")).toBe(true)
    expect(候选.has("amount")).toBe(false)
  })

  test("资金表金额为整数且带 11 位号码列 ⇒ 表头词投票判资金，不放行 caller", () => {
    const 候选 = 候选字段集(
      ["交易时间", "交易金额", "余额", "交易对方账卡号", "对方手机号"],
      [["2026-01-02 03:04:05", "1000", "5000", "6222001", "13800000000"]],
    )
    expect(候选.has("counterparty")).toBe(true)
    expect(候选.has("ownerAccount")).toBe(true)
    expect(候选.has("caller")).toBe(false)
  })

  test("标准列字段目录精确且有序（漂移即红）", () => {
    expect(标准列字段们).toEqual([
      "caller",
      "callee",
      "startedAt",
      "durationSec",
      "amount",
      "balance",
      "counterparty",
      "counterpartyName",
      "ownerAccount",
      "direction",
    ])
  })

  test("是识别字段：标准列 / extras 正例，非法值负例", () => {
    expect(是识别字段("counterpartyName")).toBe(true)
    expect(是识别字段("address")).toBe(true)
    expect(是识别字段("nope")).toBe(false)
    expect(是识别字段(1)).toBe(false)
    expect(是识别字段(null)).toBe(false)
  })

  test("形状命中率 0.9 阈值边界", () => {
    const 十中九 = ["1.00", "2.00", "3.00", "4.00", "5.00", "6.00", "7.00", "8.00", "9.00", "abc"]
    expect(形状命中率("amount", 十中九)).toBe(0.9)
    const 九中八 = ["1.00", "2.00", "3.00", "4.00", "5.00", "6.00", "7.00", "8.00", "abc"]
    expect(形状命中率("amount", 九中八)).toBeCloseTo(8 / 9)
    expect(形状命中率("amount", 九中八)).toBeLessThan(0.9)
  })

  test("样本不足 3 个非空值的列不参与形状投票", () => {
    const 候选 = 候选字段集(["X", "Y"], [["1.00", "2.00"]])
    expect(候选.has("amount")).toBe(false)
  })

  test("行数很大时推断表类型不因展开参数而崩", () => {
    // Bun 1.4.3 / JSC 实测：200_000 个展开实参不抛，1_000_000 抛 RangeError。
    // 共用同一个行数组，让测试只压「行数」而不制造 100 万份数组的内存开销。
    const 一行: (string | null)[] = ["1.00"]
    const 大表 = Array.from({ length: 1_000_000 }, () => 一行)
    expect(() => 推断表类型(["金额"], 大表)).not.toThrow()
    expect(推断表类型(["金额"], 大表)).toBe("资金")
  })
})

// 防止「候选集只按 kind 拍脑袋」：同一批列换一种形状，结果必须不同
test("候选集随列形状变化，而不是只看表头字面", () => {
  const 甲 = 候选字段集(
    ["X", "Y"],
    [
      ["1.00", "2.00"],
      ["3.00", "4.00"],
      ["5.00", "6.00"],
    ],
  )
  const 乙 = 候选字段集(
    ["X", "Y"],
    [
      ["甲", "乙"],
      ["丙", "丁"],
      ["戊", "己"],
    ],
  )
  expect(甲.has("amount")).toBe(true)
  expect(乙.has("amount")).toBe(false)
})
