export * as OpenhiveConfigErrorResponse from "./config-error-response"

import { ConfigErrorV1 } from "@opencode-ai/core/v1/config/error"

/**
 * 【这是要保留的定制】HTTP 400 的配置解析错误**只回路径**。
 *
 * `ConfigParse.jsonc` 的 `JsonError.message` 内嵌整份配置原文（`parse.ts:26-28`）；本批起
 * 全局配置里有业务 MCP 的 `headers` / `environment` 凭据，原样回给调用方就是泄凭据。
 * 其它配置错误（`InvalidError` 等）不含原文，保持上游行为。
 */
export function 配置错误响应(error: unknown): { name: string; data: { path: string } } | undefined {
  if (!ConfigErrorV1.JsonError.isInstance(error)) return undefined
  return { name: "ConfigJsonError", data: { path: error.data.path } }
}
