import { describe, expect, test } from "bun:test"
import { MockLanguageModelV3 } from "ai/test"
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import { 建调用模型 } from "../../src/server/openhive/case-extract-ai"
import { 系统提示 } from "../../src/server/openhive/case-extract"

function 假模型(文本: string, 结束: "stop" | "length" = "stop") {
  const 看见: string[] = []
  // 形状按本机 ai@6.0.168 / @ai-sdk/provider@3.0.16 实测，三处都不是 v5 的样子：
  // - `finishReason` 是**对象** `{ unified, raw }`，写成字符串 `"stop"` ⇒ TS2322；
  // - `usage` 是嵌套对象，不是扁平数字；
  // - 结果对象要**单独注解**成 `LanguageModelV3GenerateResult`：直接内联进 `doGenerate`
  //   时字面量会漂成 `string`，typecheck 报 `finishReason` 不可赋值（探针实测）。
  const 结果: LanguageModelV3GenerateResult = {
    content: [{ type: "text", text: 文本 }],
    finishReason: { unified: 结束, raw: 结束 },
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

  /**
   * 2026-11-07 真栈实测：DeepSeek 走 `generateObject`（`response_format: json_object`）时，
   * 请求里没有「json」字样就直接 400 ——
   * `Prompt must contain the word 'json' in some form to use 'response_format' of type 'json_object'`，
   * 每片重试 3 次后材料落「有问题」、一条实体都抽不出来。抽取口径（`系统提示`）本身没写
   * 「JSON」，所以这条要求只能由**适配器**补：`response_format` 是它在设，约束也该它担。
   */
  test("用真实系统提示调用时，请求里必须出现 json（json_object 模式的服务端硬要求）", async () => {
    const { 模型, 看见 } = 假模型(JSON.stringify({ 实体: [], 关系: [], 事件: [] }))
    const 调用 = 建调用模型(模型)
    await 调用({ 系统: 系统提示(), 用户: "u" })
    // `看见` 存的是 `JSON.stringify(prompt)`，键名与散文都进得去；大小写不敏感。
    expect(看见[0].toLowerCase()).toContain("json")
  })

  /**
   * 2026-11-07 真栈第二轮实测：json 字样补上后，DeepSeek 回了合法 JSON，但键名是它自己猜的
   * （`源实体` / `目标实体` / `金额`），**不是** schema 里的 `从` / `到` / `金额原文` ⇒
   * `No object generated: response did not match schema`，每片重试 3 次全失败。
   *
   * 原因在 provider 层（`node_modules/@ai-sdk/openai-compatible/dist/index.mjs:515`）：
   * `supportsStructuredOutputs !== true` 时只发 `response_format: {type:"json_object"}`，
   * **schema 本身根本不发给模型**。所以字段名只能由我们自己的提示词给出来。
   */
  test("结构化要求里必须逐字给出字段名（provider 走 json_object 时不传 schema）", async () => {
    const { 模型, 看见 } = 假模型(JSON.stringify({ 实体: [], 关系: [], 事件: [] }))
    const 调用 = 建调用模型(模型)
    await 调用({ 系统: 系统提示(), 用户: "u" })
    // 挑两个只在 schema 里出现、散文里不会出现的字段名：
    for (const 字段 of ["金额原文", "参与人"]) expect(看见[0]).toContain(字段)
  })

  /**
   * 2026-11-07 真栈实测：口径里已经写了「细类」，但 `结构化要求` 的实体键名清单里没有它；
   * DeepSeek 严格照着键名清单输出 ⇒ 抽出来的实体 `attrs` 是 `{}`，细类恒不落库。
   * 可选字段也得进清单，否则模型不会写。
   */
  test("结构化要求里也要列可选的「细类」键", async () => {
    const { 模型, 看见 } = 假模型(JSON.stringify({ 实体: [], 关系: [], 事件: [] }))
    const 调用 = 建调用模型(模型)
    // 用哨兵文案代替真实口径：这句断言只能由**结构化要求**满足，不能被口径正文蒙混过去
    // （否则「口径里写了细类」就能让这条用例永远绿——假绿）。
    await 调用({ 系统: "口径正文", 用户: "u" })
    // 断言**带引号的原样键名**：`toContain("细类")` 会被「细类X」这种改名满足（`#006-22` 子串假绿，
    // 2026-11-07 变异实测：把键名改成「细类X」，用例仍绿）。`看见` 是 `JSON.stringify` 后的串，
    // 内层引号是 `\"`。
    expect(看见[0]).toContain('\\"细类\\"?')
    // 可选值也逐字给出：模型从口径里抄类别词，而不是现编一个（白名单会丢，但白丢）
    for (const 值 of ["第三方支付", "固定电话", "银行卡"]) expect(看见[0]).toContain(值)
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
    // 实得文案（本轮记录）：AI_NoObjectGeneratedError: No object generated: could not parse the response.
    // 只钉错误类名：类名是 AI SDK 的导出类型，小版本不会改；后半句是散文，随时可能重写。
    expect(报错).toContain("AI_NoObjectGeneratedError")
  })

  /**
   * 2026-11-07 真栈：docx 有一片报了
   * `No object generated: response did not match schema.`，但 `case-extract-run.ts` 只留
   * 前 200 字 message ⇒ 到底是**被截断**（finishReason=length）还是**字段类型不符**，
   * 事后无从判断。AI SDK 的错误对象本来就带 `text` / `finishReason` / `usage`，
   * 适配器要把它们带进 message，否则排障只能靠重跑。
   */
  test("结构不符时，错误文案要带 finishReason 与输出摘要（排障用）", async () => {
    const { 模型 } = 假模型("字段名猜错了", "length")
    const 调用 = 建调用模型(模型)
    let 报错 = ""
    try {
      await 调用({ 系统: "s", 用户: "u" })
    } catch (error) {
      报错 = String(error)
    }
    expect(报错).toContain("finishReason=length")
    expect(报错).toContain("字段名猜错了")
  })
})
