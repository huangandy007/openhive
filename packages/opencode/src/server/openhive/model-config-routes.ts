export * as OpenhiveModelConfig from "./model-config-routes"

import { Config } from "@/config/config"
import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

/**
 * 设置页的模型槽位只读出口（2026-11-08，模型统一配置设计 §3.4）。
 *
 * ## 为什么不复用 `GET /config`
 *
 * 1. 它的 success schema 是上游 `ConfigV1.Info`（`groups/config.ts`），没有 `task_model`；
 * 2. 它返回整份配置，含 `provider.options.apiKey` / `baseURL`——不应送到浏览器。
 *
 * 这里只回模型名与来源。没有实例上下文（全局口），所以：
 * - 读 `Config.getGlobal()`，不读 `Config.get()`——后者走 `InstanceState`，而这个口没有
 *   `InstanceRef`（它是端点级中间件才注入的，见 `middleware/instance-context.ts:31`）；
 * - `chat` 只展示配置里的 `model`；运行时若兜底到「最近模型缓存」，设置页显示「未设置」。
 *   为展示去 boot 一个实例等于往项目表写行，不值得。
 */

// 【保留的定制 · 同步上游时不要丢】设置页模型槽位只读出口（2026-11-08，模型统一配置设计 §3.4）。
export const PREFIX = "/openhive/config"

export const PATH = {
  models: `${PREFIX}/models`,
} as const

export type 槽位来源 = "task_model" | "model" | null

export interface 槽位视图值 {
  readonly model: string | null
  readonly source: 槽位来源
}

export interface 模型槽位视图 {
  readonly chat: 槽位视图值
  readonly task: 槽位视图值
}

/**
 * 纯函数：输入配置，输出设置页要的三个事实（聊天用什么、后台用什么、后台是不是显式配的）。
 * 口径必须与 model-resolve.ts 的槽位选择一致（空串 = 未设置、task 缺省回落 model）；改一处要同时改另一处。
 */
export function 槽位视图(config: { readonly model?: string; readonly task_model?: string }): 模型槽位视图 {
  const 聊天 = config.model === undefined || config.model === "" ? null : config.model
  const 后台显式 = config.task_model === undefined || config.task_model === "" ? null : config.task_model
  return {
    chat: { model: 聊天, source: 聊天 === null ? null : "model" },
    task: 后台显式 !== null
      ? { model: 后台显式, source: "task_model" }
      : { model: 聊天, source: 聊天 === null ? null : "model" },
  }
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    yield* router.add("GET", PATH.models, () =>
      Effect.gen(function* () {
        return HttpServerResponse.jsonUnsafe(槽位视图(yield* config.getGlobal()))
      }),
    )
  }),
)
