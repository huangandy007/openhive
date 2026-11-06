import { describe, expect, test } from "bun:test"
import { 号码归一, 形近命中, 文本包含, 实体规范值, 金额元 } from "../../src/server/openhive/case-value"

describe("金额元", () => {
  test("普通数字 / 千分位 / 元后缀", () => {
    expect(金额元("280000")).toBe(280000)
    expect(金额元("￥1,234.50")).toBe(1234.5)
    expect(金额元("1234.5 元")).toBe(1234.5)
  })
  test("万 / 亿", () => {
    expect(金额元("28万")).toBe(280000)
    expect(金额元("1.5亿")).toBe(150000000)
    expect(金额元("3万元")).toBe(30000)
  })
  test("中文数字（大写与小写）", () => {
    expect(金额元("二十八万")).toBe(280000)
    expect(金额元("壹佰贰拾叁")).toBe(123)
    expect(金额元("两千五百")).toBe(2500)
  })
  test("括号负数", () => {
    expect(金额元("(1,200)")).toBe(-1200)
    expect(金额元("（三千）元")).toBe(-3000)
  })
  test("认不出 ⇒ undefined，不猜", () => {
    expect(金额元("若干")).toBeUndefined()
    expect(金额元("")).toBeUndefined()
  })
})

describe("号码归一", () => {
  test("去分隔符", () => {
    expect(号码归一("138-0013-8000")).toBe("13800138000")
    expect(号码归一("138 0013 8000")).toBe("13800138000")
  })
  test("没有数字 ⇒ undefined", () => {
    expect(号码归一("张三")).toBeUndefined()
  })
})

describe("文本包含 / 形近", () => {
  test("忽略空白差异", () => {
    expect(文本包含("张三 向李四\n转账", "张三向李四转账")).toBe(true)
    expect(文本包含("张三向李四转账", "王五")).toBe(false)
  })
  test("形近只允许一个字不同，且必须真的出现在原文里", () => {
    expect(形近命中("张叁向李四转账", "张三")).toBe(true)
    // 不能拿「张四」当反例：原文里有「李四」，与它正好差一个字，形近规则会命中。
    expect(形近命中("张叁向李四转账", "赵六")).toBe(false)
    expect(形近命中("李四", "张三")).toBe(false)
  })
  test("长度 1 不做形近（避免把「张」认成「李」）", () => {
    expect(形近命中("张", "李")).toBe(false)
  })
})

describe("实体规范值", () => {
  test("号码去分隔符；其余 NFKC ＋ 折叠空白", () => {
    expect(实体规范值("号码", "138-0013-8000")).toBe("13800138000")
    expect(实体规范值("人", " 张 三 ")).toBe("张 三")
    expect(实体规范值("人", "ＡＢＣ")).toBe("ABC")
  })
  test("号码里没有数字 ⇒ undefined", () => {
    expect(实体规范值("号码", "不是号码")).toBeUndefined()
  })
})
