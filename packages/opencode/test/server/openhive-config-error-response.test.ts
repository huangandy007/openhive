import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ConfigErrorV1 } from "@opencode-ai/core/v1/config/error"
import { 配置错误响应 } from "@/server/openhive/config-error-response"

/**
 * 终审 I4 · HTTP 400 的配置解析错误只回 path。
 *
 * `ConfigParse.jsonc` 的 `JsonError.message` 内嵌整份配置原文（`parse.ts:26-28`）；本批起
 * 全局配置里有业务 MCP 的 `headers` / `environment` 凭据，原样回给调用方就是泄凭据。
 * 行为断言「响应里没有 SECRET」，接线断言「中间件真的先走这个净化口」。
 */

test("JsonError 只回 path，不回 message（配置原文里有凭据）", () => {
  const error = new ConfigErrorV1.JsonError({
    path: "C:/cfg/opencode.jsonc",
    message:
      '\n--- JSONC Input ---\n{"mcp":{"x":{"headers":{"Authorization":"Bearer SECRET"}}}}\n--- Errors ---\n',
  })
  const 响应 = 配置错误响应(error)
  expect(响应).toEqual({ name: "ConfigJsonError", data: { path: "C:/cfg/opencode.jsonc" } })
  expect(JSON.stringify(响应)).not.toContain("SECRET")
})

test("非 JSON 解析错误不接管（返回 undefined）", () => {
  expect(配置错误响应(new Error("x"))).toBeUndefined()
})

test("接线：中间件在通用 400 分支之前走配置错误净化", () => {
  const 源 = readFileSync(
    join(import.meta.dir, "../../src/server/routes/instance/httpapi/middleware/error.ts"),
    "utf8",
  )
  const 净化 = 源.indexOf("配置错误响应(error)")
  const 通用400 = 源.indexOf("HttpServerResponse.jsonUnsafe(error.toObject(), { status: 400 })")
  expect(净化).toBeGreaterThan(-1)
  // 净化口必须在「原样回 error.toObject()」之前。
  if (通用400 !== -1) expect(净化).toBeLessThan(通用400)
  // 原 JsonError 入口必须从通用分支去掉，否则会走回回显 message 的旧路径。
  expect(源).not.toContain("ConfigErrorV1.JsonError.isInstance")
})
