import { describe, expect, test } from "bun:test"
import { 细类 } from "../../src/server/openhive/case-subtype"

/**
 * 细类判定（阶段 1）：只回答「这个值能不能稳定判出细类」，判不出就是 `undefined`
 * ——展示层就只显示大类。**绝不猜**：错标一次，民警会按错误的口径去查。
 *
 * 优先级：`attrs.subtype`（材料里明确写出来的）> 值形状。attrs 里的值必须落在该类
 * 白名单里，否则丢弃、回落形状（模型编一个「涉案号码」不能进展示）。
 */
describe("号码细类", () => {
  test("手机号：11 位 1[3-9] 开头；归一后带 86 前缀的 13 位也认", () => {
    expect(细类("号码", "13800000001")).toBe("手机号")
    expect(细类("号码", "19912345678")).toBe("手机号")
    // `号码归一` 剥掉开头的 `+`，`+8613800138000` 落库就是这串 13 位。
    expect(细类("号码", "8613800138000")).toBe("手机号")
    // 12 位 / 10 位都不是手机号
    expect(细类("号码", "1380000000")).toBeUndefined()
    expect(细类("号码", "138000000011")).toBeUndefined()
  })

  test("身份证：18 位要看第 7–14 位是不是真日期；15 位老证看 6 位日期", () => {
    expect(细类("号码", "110101199001011234")).toBe("身份证")
    expect(细类("号码", "11010119900101123X")).toBe("身份证")
    // 月份 13：形状像身份证，日期不成立 ⇒ 不标
    expect(细类("号码", "110101199013011234")).toBeUndefined()
    // 2 月 30 日同样不成立
    expect(细类("号码", "110101199002301234")).toBeUndefined()
    expect(细类("号码", "110101900101123")).toBe("身份证")
    expect(细类("号码", "110101901301123")).toBeUndefined()
  })

  test("固定电话：0 开头的 10–12 位", () => {
    expect(细类("号码", "057188888888")).toBe("固定电话")
    expect(细类("号码", "01088888888")).toBe("固定电话")
    // 16 位卡号不是固定电话（阶段 2 会纠正大类，这里先不标细类）
    expect(细类("号码", "6222020000000001")).toBeUndefined()
  })

  test("认不出的号码不标细类（fail-closed）", () => {
    expect(细类("号码", "110")).toBeUndefined()
    expect(细类("号码", "12345")).toBeUndefined()
  })
})

describe("账户细类", () => {
  test("银行卡：16–19 位且 Luhn 通过；Luhn 不过的同形状叫「银行账号」", () => {
    expect(细类("账户", "4111111111111111")).toBe("银行卡")
    expect(细类("账户", "6222020000000001")).toBe("银行账号")
    expect(细类("账户", "6222020000")).toBeUndefined()
  })

  test("第三方支付：邮箱形态（支付宝账号）；微信标识也算这一类的账户", () => {
    expect(细类("账户", "zhangsan@alipay.com")).toBe("第三方支付")
    expect(细类("账户", "wxid_abc123")).toBe("第三方支付")
    expect(细类("账户", "张三")).toBeUndefined()
  })
})

describe("虚拟身份细类", () => {
  test("邮箱 / QQ / 微信", () => {
    expect(细类("虚拟身份", "zhang@qq.com")).toBe("邮箱")
    expect(细类("虚拟身份", "12345678")).toBe("QQ")
    expect(细类("虚拟身份", "wxid_abc123")).toBe("微信")
    // 4 位数字太短、不像 QQ；带字母的串不是 QQ
    expect(细类("虚拟身份", "1234")).toBeUndefined()
    expect(细类("虚拟身份", "abc123456")).toBeUndefined()
    // `@qq.com` 是邮箱，不是「QQ」
    expect(细类("虚拟身份", "12345678@qq.com")).toBe("邮箱")
  })
})

describe("其他大类不做细类（阶段 1）", () => {
  test("人 / 地点 / 组织 / 车辆 / 物品 一律 undefined", () => {
    for (const 类 of ["人", "地点", "组织", "车辆", "物品"]) {
      expect(细类(类, "张三")).toBeUndefined()
      expect(细类(类, "城东茶馆")).toBeUndefined()
    }
  })
})

describe("attrs.subtype 优先，但必须在本类白名单里", () => {
  test("材料里明确写出来的细类优先于形状", () => {
    // 11 位手机号形状，但原文写着「固定电话」，以原文为准
    expect(细类("号码", "13800000001", { subtype: "固定电话" })).toBe("固定电话")
    expect(细类("账户", "6222020000000001", { subtype: "银行卡" })).toBe("银行卡")
  })

  test("越界的细类（不在白名单 / 不是字符串）一律丢弃，回落形状", () => {
    expect(细类("号码", "13800000001", { subtype: "涉案号码" })).toBe("手机号")
    expect(细类("号码", "13800000001", { subtype: 123 })).toBe("手机号")
    // 白名单是按大类分的：账户的细类不能写到虚拟身份上
    expect(细类("虚拟身份", "wxid_abc123", { subtype: "银行卡" })).toBe("微信")
    // 形状也认不出 ⇒ 仍然 undefined，不因为 attrs 里有个值就冒出来
    expect(细类("号码", "110", { subtype: "涉案号码" })).toBeUndefined()
  })

  // jsonb 列在不同驱动上读回的形状不一致（PGlite 给字符串、bun-sql 可能给对象），
  // 调用方直接把裸列传进来，这里必须两种都认——否则「材料里写了细类」在产品上恒不生效。
  test("attrs 是 JSON 文本时也要读到 subtype", () => {
    expect(细类("号码", "13800000001", '{"subtype":"固定电话"}')).toBe("固定电话")
  })

  test("attrs 是坏 JSON / 数字 / null ⇒ 当作没有 attrs，回落形状", () => {
    expect(细类("号码", "13800000001", "{坏")).toBe("手机号")
    expect(细类("号码", "13800000001", 42)).toBe("手机号")
    expect(细类("号码", "13800000001", null)).toBe("手机号")
  })
})
