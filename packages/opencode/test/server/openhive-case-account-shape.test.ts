import { describe, expect, test } from "bun:test"
import { 是账户形状 } from "../../src/server/openhive/case-field-registry"
import { 翻译资金 } from "../../src/server/openhive/case-translate"
import type { FactRowInput } from "../../src/server/openhive/case-store"

function 资金行(over: Partial<FactRowInput> = {}): FactRowInput {
  return {
    projectId: "prj-tenpay",
    materialId: "tp1",
    sheet: "Sheet1",
    rowNo: 2,
    startedAt: 1731117303,
    startedRaw: "2024-11-09 09:15:03",
    precision: "到秒",
    amount: "1.00",
    direction: "付",
    counterparty: "6222021234567890123",
    ownerAccount: "abc@wx.tenpay.com",
    currency: "CNY",
    extras: { ownerName: "张三", "属性:本方:开户行": "招商银行" },
    ...over,
  }
}

describe("是账户形状：已知支付后缀精准放宽（FR-030）", () => {
  test("tenpay 账号（含大小写 / 首尾空白）通过", () => {
    expect(是账户形状("abc@wx.tenpay.com")).toBe(true)
    expect(是账户形状("Abc@WX.TenPay.com")).toBe(true)
    expect(是账户形状(" abc@wx.tenpay.com ")).toBe(true)
  })

  test("不泛化任意邮箱 / 相似后缀 / 无本地部分", () => {
    expect(是账户形状("abc@example.com")).toBe(false)
    expect(是账户形状("abc@wx.tenpay.com.evil.com")).toBe(false)
    expect(是账户形状("@wx.tenpay.com")).toBe(false)
  })

  test("纯数字分支原样保留", () => {
    expect(是账户形状("6222021234567890")).toBe(true)
  })
})

describe("翻译资金：tenpay 账号可建实体、挂户名与属性（FR-030）", () => {
  test("账户实体可建、户名别名与开户行属性都挂上", () => {
    const 结果 = 翻译资金({ projectId: "prj-tenpay", materialId: "tp1", rows: [资金行()] })
    expect(结果.卡片们[0]?.participants[0]?.实体).toBe(true)
    expect(结果.别名们).toContainEqual({ 规范值: "abc@wx.tenpay.com", 值: "张三", 出处: "tp1#Sheet1#2" })
    expect(结果.属性们).toContainEqual({ 归属: "本方", 键: "开户行", 值: "招商银行", 出处: "tp1#Sheet1#2" })
  })

  test("对照行：普通邮箱不建实体、也不产户名别名与属性观察（不静默丢弃）", () => {
    const 对照 = 翻译资金({
      projectId: "prj-tenpay",
      materialId: "tp2",
      rows: [资金行({ materialId: "tp2", ownerAccount: "abc@example.com" })],
    })
    expect(对照.卡片们[0]?.participants[0]?.实体).toBe(false)
    expect(对照.别名们).toEqual([])
    expect(对照.属性们).toEqual([])
    // 行本身仍在（不静默丢行），只是账户不建实体、属性无挂载点。
    expect(对照.跳过们).toEqual([])
  })
})
