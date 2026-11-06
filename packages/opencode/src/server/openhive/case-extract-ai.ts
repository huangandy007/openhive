export * as OpenhiveCaseExtractAi from "./case-extract-ai"

import { generateObject, type LanguageModel } from "ai"
import { Schema } from "effect"
import { 抽取结构 } from "./case-extract"
import type { 模型调用 } from "./case-extract-run"

/**
 * AI SDK 的结构化调用适配器。
 *
 * ## 为什么是 `generateObject` 而不是 task 子会话（R2）
 *
 * 后台 worker 没有请求级实例上下文；`SessionPrompt` 的会话存档虽好，但它要求 session 与
 * `InstanceRef`。设计 §7.4 想要「会话存档自动留痕」，本计划用 `parse_detail` 记模型名 /
 * prompt 版本 / 每片尝试次数替代；逐次调用流水留给后续计划补。
 *
 * ## 超时
 *
 * 单片一次调用 120 秒上限：模型侧卡死时不能让单 worker 永远停在这一片（设计 §6.5 单 worker
 * 的已知代价，缺口表记录）。超时抛错，执行器按一次失败重试。
 */
const 单片超时ms = 120_000

export function 建调用模型(模型: LanguageModel): 模型调用 {
  // 两个适配器都是**就地**把 `~standard` 挂到 schema 上、返回同一个对象（effect beta.83 的
  // `dist/Schema.js:463` 与 `:517`）。分两步写是为了让顺序（先 validate、再补 jsonSchema）显式可见：
  // 写成 `Object.assign(toStandardSchemaV1(x), toStandardJSONSchemaV1(x))` 会让人以为是两个对象，
  // 万一将来实现改成返回副本，`~standard` 就会被只有 jsonSchema 的那份覆盖，校验直接失效。
  const schema = Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(抽取结构))
  return async (输入) => {
    const 结果 = await generateObject({
      model: 模型,
      schema,
      system: 输入.系统,
      prompt: 输入.用户,
      temperature: 0.1,
      abortSignal: AbortSignal.timeout(单片超时ms),
    })
    return 结果.object
  }
}
