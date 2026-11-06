import { describe, expect, test } from "bun:test"
import { MockLanguageModelV3 } from "ai/test"
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import { 建调用模型 } from "../../src/server/openhive/case-extract-ai"

function 假模型(文本: string) {
  const 看见: string[] = []
  // 形状按本机 ai@6.0.168 / @ai-sdk/provider@3.0.16 实测，三处都不是 v5 的样子：
  // - `finishReason` 是**对象** `{ unified, raw }`，写成字符串 `"stop"` ⇒ TS2322；
  // - `usage` 是嵌套对象，不是扁平数字；
  // - 结果对象要**单独注解**成 `LanguageModelV3GenerateResult`：直接内联进 `doGenerate`
  //   时字面量会漂成 `string`，typecheck 报 `finishReason` 不可赋值（探针实测）。
  const 结果: LanguageModelV3GenerateResult = {
    content: [{ type: "text", text: 文本 }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  }
  const 模型 = new MockLanguageModelV3({
    doGenerate: async (options) => {
      看见.push(JSON.stringify(options.prompt))
      return 结果
    },
  })
  return { 模型, 看见 }
}

describe("建调用模型（generateObject 适配器）", () => {
  test("合法 JSON ⇒ 返回对象，且系统与用户提示都进了请求", async () => {
    const { 模型, 看见 } = 假模型(JSON.stringify({ 实体: [], 关系: [], 事件: [] }))
    // 不用 `as never` 之类的断言：`MockLanguageModelV3` 本身就结构兼容 `LanguageModel`
    // （探针在 `bun run typecheck` 下实测通过）。
    const 调用 = 建调用模型(模型)
    const r = await 调用({ 系统: "口径正文", 用户: "第 3 段原文" })
    expect(r).toEqual({ 实体: [], 关系: [], 事件: [] })
    expect(看见[0]).toContain("口径正文")
    expect(看见[0]).toContain("第 3 段原文")
  })

  test("不合法 JSON ⇒ 抛错（由执行器计一次失败并重试）", async () => {
    const { 模型 } = 假模型("这不是 JSON")
    const 调用 = 建调用模型(模型)
    // 不用 `expect(...).rejects`：本机 bun 类型里它不被认作 Promise，oxlint 会报
    // `await-thenable`（Task 7 已实测两次）。
    let 报错 = ""
    try {
      await 调用({ 系统: "s", 用户: "u" })
    } catch (error) {
      报错 = String(error)
    }
    expect(报错).not.toBe("")
  })
})
