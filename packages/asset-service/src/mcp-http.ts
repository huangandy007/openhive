import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { connect } from "@opencode-ai/auth/db"
import { workspaceRoot } from "@opencode-ai/auth/workspace"
import type { AssetTarget } from "./asset"
import { createGovernanceServer } from "./governance"
import { assetsRoot } from "./storage"

/**
 * 资产治理 MCP server 的 HTTP 入口（单进程形态，2026-10-26）。
 *
 * 由 opencode 内核拉起**一份**（不是每用户一份）：只绑 `127.0.0.1`，端口默认由系统分配，
 * 就绪后向 stdout 打一行 `GOVERNANCE_MCP_READY {"port":N}` 供内核解析。
 * 身份与目录都**不靠进程边界**，而是每次调用由内核注入 `_meta`
 * （`packages/opencode/src/mcp/openhive-identity.ts`）——所以一份进程能服务所有人，
 * 且越界判定在 `governance.ts` 里独立成立。
 *
 * 无状态：每个请求一套 transport + server（SDK 的 stateless 用法），不维护会话表。
 */
export const READY_PREFIX = "GOVERNANCE_MCP_READY"
/** 固定端口（重启后复用同一端口，已下发的配置就不会指向死端口）；缺省 0 = 系统分配。 */
export const PORT_ENV = "OPENHIVE_GOVERNANCE_MCP_PORT"
export const MCP_PATH = "/mcp"
export const HEALTH_PATH = "/healthz"

export interface GovernanceHttpDeps {
  readonly db: AssetTarget
  readonly root: string
  readonly workspaceRoot: string
}

function jsonError(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function handleMcp(deps: GovernanceHttpDeps, request: Request): Promise<Response> {
  if (request.method === "GET") {
    // 无状态模式没有可回放的事件流，SDK 要求 GET 回 405（否则客户端会卡在等 SSE）。
    return new Response(null, { status: 405, headers: { allow: "POST" } })
  }
  const server = createGovernanceServer(deps)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return transport.handleRequest(request)
}

export function startGovernanceHttp(
  deps: GovernanceHttpDeps,
  options: { hostname?: string; port?: number } = {},
): { port: number; stop(): void } {
  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    fetch: (request) => {
      const url = new URL(request.url)
      if (url.pathname === HEALTH_PATH) return new Response("ok")
      if (url.pathname !== MCP_PATH) return jsonError(404, { error: "not_found" })
      return handleMcp(deps, request)
    },
  })
  return { port: server.port ?? 0, stop: () => void server.stop(true) }
}

if (import.meta.main) {
  const server = startGovernanceHttp(
    { db: connect(process.env), root: assetsRoot(process.env), workspaceRoot: workspaceRoot(process.env) },
    { port: Number(process.env[PORT_ENV] ?? 0) },
  )
  process.stdout.write(`${READY_PREFIX} ${JSON.stringify({ port: server.port })}\n`)
  const shutdown = () => {
    server.stop()
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}
