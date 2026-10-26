import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
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
 * 响应体**流完之后**才收尾（`closeAfterBody`）：提前 `close()` 会把 SSE 掐成半截。
 */
export const READY_PREFIX = "GOVERNANCE_MCP_READY"
/** 固定端口（重启后复用同一端口，已下发的配置就不会指向死端口）；缺省 0 = 系统分配。 */
export const PORT_ENV = "OPENHIVE_GOVERNANCE_MCP_PORT"
export const MCP_PATH = "/mcp"
export const HEALTH_PATH = "/healthz"
/**
 * 这份服务**没有鉴权**，loopback 绑定就是唯一的访问控制——不要为了「让局域网也能连」
 * 改成 `0.0.0.0`（那等于把治理工具开放给任何能连上端口的人）。
 */
export const DEFAULT_HOSTNAME = "127.0.0.1"

export interface GovernanceHttpDeps {
  readonly db: AssetTarget
  readonly root: string
  readonly workspaceRoot: string
}

export interface GovernanceHttpServer {
  readonly port: number
  readonly hostname: string
  stop(): Promise<void>
}

/** 就绪行（逐字契约）：内核与后续 spawn 侧按 `READY_PREFIX + " " + JSON` 解析。 */
export function readyLine(port: number): string {
  return `${READY_PREFIX} ${JSON.stringify({ port })}`
}

function jsonError(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/** 收尾失败只记不漏：连接已经交回，抛出去会变成未处理拒绝、拖垮进程。 */
async function closeQuietly(server: Server, transport: WebStandardStreamableHTTPServerTransport): Promise<void> {
  try {
    await transport.close()
  } catch (error) {
    // 传输层可能已被对端关掉；这里没有可补救的动作，也不该让清理路径抛出去。
    void error
  }
  try {
    await server.close()
  } catch (error) {
    void error
  }
}

/**
 * 把响应体包一层：**流结束（或消费方取消）后**再关 transport / server。
 *
 * 不能在 `handleRequest` 返回后立刻关——`response.body` 可能还是未消费的 SSE 流，
 * 提前 `close()` 会让客户端收到半截响应。这里手动泵：读到最后一块（`done`）才收尾，
 * 消费方中途取消（`cancel`）也收尾。无 body 的响应（如 202）当场收尾。
 */
function closeAfterBody(response: Response, close: () => void): Response {
  const body = response.body
  if (body === null) {
    close()
    return response
  }
  const reader = body.getReader()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          close()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        close()
        controller.error(error)
      }
    },
    cancel() {
      close()
      void reader.cancel()
    },
  })
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers })
}

async function handleMcp(deps: GovernanceHttpDeps, request: Request): Promise<Response> {
  if (request.method === "GET") {
    // 无状态模式没有可回放的事件流，SDK 要求 GET 回 405（否则客户端会卡在等 SSE）。
    return new Response(null, { status: 405, headers: { allow: "POST" } })
  }
  const server = createGovernanceServer(deps)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  const response = await transport.handleRequest(request)
  let closed = false
  return closeAfterBody(response, () => {
    if (closed) return
    closed = true
    void closeQuietly(server, transport)
  })
}

export function startGovernanceHttp(
  deps: GovernanceHttpDeps,
  options: { hostname?: string; port?: number } = {},
): GovernanceHttpServer {
  const server = Bun.serve({
    hostname: options.hostname ?? DEFAULT_HOSTNAME,
    port: options.port ?? 0,
    // 不设 idleTimeout（Bun 默认 10s）：治理工具都是快操作；将来出现 >10s 的调用需复核。
    fetch: (request) => {
      const url = new URL(request.url)
      // 只是 liveness：不探 DB、不反映依赖健康度（监督器据此判断「进程还在」）。
      if (url.pathname === HEALTH_PATH) return new Response("ok")
      if (url.pathname !== MCP_PATH) return jsonError(404, { error: "not_found" })
      return handleMcp(deps, request)
    },
  })
  return {
    port: server.port ?? 0,
    hostname: server.hostname ?? options.hostname ?? DEFAULT_HOSTNAME,
    stop: () => server.stop(true),
  }
}

if (import.meta.main) {
  const server = startGovernanceHttp(
    { db: connect(process.env), root: assetsRoot(process.env), workspaceRoot: workspaceRoot(process.env) },
    { port: Number(process.env[PORT_ENV] ?? 0) },
  )
  process.stdout.write(`${readyLine(server.port)}\n`)
  const shutdown = async () => {
    await server.stop()
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}
