import { describe, expect, test } from "bun:test"
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"
import { 合并模型结果, 建表头识别器, 需要模型 } from "../../src/server/openhive/case-header-ai"
import { detectMapping } from "../../src/server/openhive/case-mapping"

const 表头 = ["交易金额", "对方账卡", "摘要"]
const 行 = [
  ["1.00", "6222001", "转账"],
  ["2.00", "6222999", "消费"],
]

/**
 * 拦截模型：只用来截获送进 `generateObject` 的 prompt。
 * 构造方式与 `openhive-case-extract-ai.test.ts` 的夹具一致（`MockLanguageModelV3`），
 * 不另造第三种假模型。
 */
function 拦截模型() {
  const 收到: string[] = []
  const 结果: LanguageModelV3GenerateResult = {
    content: [{ type: "text", text: JSON.stringify({ 工作表: { Sheet1: { 列: { "0": "counterparty" } } } }) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  }
  const 模型 = new MockLanguageModelV3({
    doGenerate: async (options) => {
      收到.push(JSON.stringify(options.prompt))
      return 结果
    },
  })
  return { 模型, 收到 }
}

describe("触发判定", () => {
  test("关键字段缺失且未知列超 30% ⇒ 触发", () => {
    const r = detectMapping(表头, 行)
    expect(需要模型([r], [表头], [行])).toBe(true)
  })

  test("备注/摘要/网点不计入未知列占比 ⇒ 只有一列文本时不触发", () => {
    const 表头2 = ["交易金额", "交易时间", "备注"]
    const 行2 = [["1.00", "2026-01-02 03:04:05", "甲"]]
    const r = detectMapping(表头2, 行2)
    expect(需要模型([r], [表头2], [行2])).toBe(false)
  })
})

describe("模型结果合并", () => {
  test("只填未认领列，不覆盖规则结果", () => {
    const 基础 = detectMapping(表头, 行)
    const 合并 = 合并模型结果(表头, 行, 基础, { 1: "counterparty", 0: "balance" })
    expect(合并.columns[1]).toBe("counterparty")
    expect(合并.columns[0]).toBe("amount") // 规则已认领，模型不许覆盖
    expect(合并.来源[1]).toBe("模型")
  })

  test("模型给的非法字段名/形状不符 ⇒ 丢弃", () => {
    const 基础 = detectMapping(表头, 行)
    expect(合并模型结果(表头, 行, 基础, { 1: "不存在的字段" }).columns[1]).toBeUndefined()
    expect(合并模型结果(表头, 行, 基础, { 2: "counterparty" }).columns[2]).toBeUndefined()
  })

  test("待确认项原样沿用规则结果（合并不新增、不改写）", () => {
    const 基础 = detectMapping(表头, 行)
    const 合并 = 合并模型结果(表头, 行, 基础, { 1: "counterparty" })
    expect(合并.待确认).toEqual(基础.待确认)
  })
})

describe("脱敏开关", () => {
  test("默认原文，打开后账号只留首末四位", async () => {
    // 账号用 11 位（`账号脱敏` 只处理 8 位以上，见实现里的 `/^\d{8,}$/`）。
    const 行11 = [
      ["1.00", "62220012001", "转账"],
      ["2.00", "62229999999", "消费"],
    ]
    const { 模型, 收到 } = 拦截模型()
    const 识别 = 建表头识别器(模型, { 脱敏: false })
    await 识别({ 工作表: [{ 名: "Sheet1", 表头, 样例: 行11 }], 候选字段: ["counterparty"] })
    expect(收到.join()).toContain("6222001")

    收到.length = 0
    const 脱敏识别 = 建表头识别器(模型, { 脱敏: true })
    await 脱敏识别({ 工作表: [{ 名: "Sheet1", 表头, 样例: 行11 }], 候选字段: ["counterparty"] })
    expect(收到.join()).not.toContain("6222001")
    expect(收到.join()).toContain("2001")
  })
})
