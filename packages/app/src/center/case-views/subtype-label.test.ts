import { describe, expect, test } from "bun:test"
import { 细类显示名 } from "./subtype-label"

describe("细类显示名", () => {
  test("身份证统一显示为证件号；其余原样", () => {
    expect(细类显示名("身份证")).toBe("证件号")
    expect(细类显示名("手机号")).toBe("手机号")
    expect(细类显示名("银行卡")).toBe("银行卡")
  })

  test("空值不硬造（null / undefined / 空串都返回 undefined）", () => {
    expect(细类显示名(null)).toBeUndefined()
    expect(细类显示名(undefined)).toBeUndefined()
    expect(细类显示名("")).toBeUndefined()
  })

  test("原型键不被当成映射表里的值", () => {
    expect(细类显示名("constructor")).toBe("constructor")
    expect(细类显示名("__proto__")).toBe("__proto__")
  })
})
