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
    expect(金额元("一百零三")).toBe(103)
    expect(金额元("一亿二千万")).toBe(120000000)
    expect(金额元("壹亿贰仟万元整")).toBe(120000000)
    expect(金额元("一亿零五百万")).toBe(105000000)
    expect(金额元("一亿二百万")).toBe(102000000)
  })
  test("会计写法：元整 / 圆整 / 人民币前缀", () => {
    expect(金额元("壹佰贰拾叁元整")).toBe(123)
    expect(金额元("叁仟元整")).toBe(3000)
    expect(金额元("贰拾捌万圆整")).toBe(280000)
    expect(金额元("人民币28万")).toBe(280000)
  })
  test("括号负数", () => {
    expect(金额元("(1,200)")).toBe(-1200)
    expect(金额元("（三千）元")).toBe(-3000)
  })
  test("千分位必须成组：不合法就 undefined，不许剥完逗号再算", () => {
    expect(金额元("1234,56")).toBeUndefined()
    expect(金额元("1,23")).toBeUndefined()
    expect(金额元("12,34")).toBeUndefined()
  })
  test("千分位后面可以带万 / 亿", () => {
    expect(金额元("1,234万")).toBe(12340000)
    expect(金额元("1,234.5万")).toBe(12345000)
  })
  test("括号里再带负号是冲突写法 ⇒ undefined", () => {
    expect(金额元("(-1200)")).toBeUndefined()
    expect(金额元("（-3,000）")).toBeUndefined()
  })
  test("畸形中文数字 ⇒ undefined（不猜）", () => {
    expect(金额元("万")).toBeUndefined()
    expect(金额元("亿")).toBeUndefined()
    expect(金额元("一二三")).toBeUndefined()
    expect(金额元("二〇二六")).toBeUndefined()
    expect(金额元("一百百")).toBeUndefined()
    expect(金额元("三千五")).toBeUndefined()
    expect(金额元("一千二百三")).toBeUndefined()
  })
  test("超出 numeric(18,2) 能表示的整数 ⇒ undefined", () => {
    expect(金额元("99999999999999999999")).toBeUndefined()
    expect(金额元("9999999999999999万")).toBeUndefined()
  })
  test("舍入到分是确定的四舍五入", () => {
    expect(金额元("1.005")).toBe(1.01)
    expect(金额元("2.675")).toBe(2.68)
  })
  test("舍到分在大额上也精确（EPSILON 是绝对量，压不住百万级尾差）", () => {
    expect(金额元("1234567.005")).toBe(1234567.01)
    expect(金额元("12345678.005")).toBe(12345678.01)
  })
  test("舍到零的负数不带 -0", () => {
    expect(Object.is(金额元("-0.001"), 0)).toBe(true)
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
  test("全角数字先 NFKC", () => {
    expect(号码归一("138００１３８０００")).toBe("13800138000")
  })
  test("身份证校验位 X 要保留", () => {
    expect(号码归一("11010119900101123X")).toBe("11010119900101123X")
  })
  test("不是标识符 ⇒ undefined（日期串不许当号码）", () => {
    expect(号码归一("张三")).toBeUndefined()
    expect(号码归一("2026年3月5日")).toBeUndefined()
    expect(号码归一("")).toBeUndefined()
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
  test("两字名只认「姓相同、名不同」", () => {
    expect(形近命中("李三", "张三")).toBe(false)
    expect(形近命中("转账三千元", "李三")).toBe(false)
  })
  test("脱敏名不是具体的人", () => {
    expect(形近命中("被告人张某向李某转账", "张三")).toBe(false)
    expect(形近命中("张三", "张某")).toBe(false)
  })
  test("长度 1 不做形近（避免把「张」认成「李」）", () => {
    expect(形近命中("张", "李")).toBe(false)
  })
})

describe("实体规范值", () => {
  test("号码去分隔符；其余 NFKC ＋ 去掉全部空白", () => {
    expect(实体规范值("号码", "138-0013-8000")).toBe("13800138000")
    expect(实体规范值("号码", "+86 138-0013-8000")).toBe("8613800138000")
    expect(实体规范值("人", " 张 三 ")).toBe("张三")
    expect(实体规范值("人", "张  三")).toBe("张三")
    expect(实体规范值("人", "ＡＢＣ")).toBe("ABC")
  })
  test("号码里不是标识符 ⇒ undefined", () => {
    expect(实体规范值("号码", "不是号码")).toBeUndefined()
  })
})
