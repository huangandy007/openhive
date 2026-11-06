import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { Queryable } from "./case-store"
import { createCaseMcpServer } from "./case-mcp-server"

/**
 * 案件情报 MCP server 的 HTTP 入口（计划 6 / Task 6）。
 *
 * 由内核拉起**一份**（不是每用户一份）：只绑 `127.0.0.1`，端口默认由系统分配，
 * 就绪后由 `case-mcp-main.ts` 向 stdout 打一行 `CASE_MCP_READY {"port":N}` 供监督器解析。
 * 身份与项目边界**不靠进程边界**：每次调用由内核注入 `_meta`
 *（`case-mcp-identity.ts`），服务端独立校验成员。
 *
 * 无状态：每个请求一套 transport + server（SDK 的 stateless 用法），不维护会话表。
 * 响应体**流完之后**才收尾（`closeAfterBody`）：提前 `close()` 会把 SSE 掐成半截。
 */
export const READY_PREFIX = "CASE_MCP_READY"
/** 固定端口（重启后复用同一端口，已下发的配置就不会指向死端口）；缺省 0 = 系统分配。 */
export const PORT_ENV = "OPENHIVE_CASE_MCP_PORT"
export const MCP_PATH = "/mcp"
export const HEALTH_PATH = "/healthz"
/**
 * 这份服务**没有鉴权**，loopback 绑定就是唯一的访问控制——不要为了「让局域网也能连」
 * 改成 `0.0.0.0`（那等于把案件数据开放给任何能连上端口的人）。
 */
export const DEFAULT_HOSTNAME = "127.0.0.1"

export interface CaseHttpDeps {
  readonly db: Queryable
  readonly workspaceRoot: string
}

/** 就绪行（逐字契约）：`case-mcp-main.ts` 与监督器按 `READY_PREFIX + " " + JSON` 解析。 */
export function readyLine(port: number): string {
  return `${READY_PREFIX} ${JSON.stringify({ port })}`
}

/**
 * 首启端口：缺省 / 非整数 / 超出 1..65535 ⇒ 0（系统分配）。
 * 只挡 `NaN` 不够——`-1`、`70000` 会被原样交给 `Bun.serve`，抛 `RangeError` 后子进程起不来。
 */
function firstPort(env: Record<string, string | undefined>): number {
  const raw = env[PORT_ENV]
  if (raw === undefined || raw.trim() === "") return 0
  const port = Number(raw)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 0
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
 * 不能在 `handleRequest` 返回后立刻关——`response.body` 可能还是未消费的 SSE 流。
 */
export function closeAfterBody(response: Response, close: () => void): Response {
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
      // 上游取消已经失败（对端可能早断了），挂 `catch` 只为不变成未处理拒绝。
      void reader.cancel().catch(() => {})
    },
  })
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers })
}

/**
 * 处理一次 `/mcp` 请求。收尾必须**每次请求恰好一次**（无状态形态下没有别处会关它）：
 * ① 响应体流完 / 消费方取消；② `connect` 或 `handleRequest` 抛出 ⇒ 收尾后原样抛出；
 * ③ 无 body 的响应（如 202）当场收尾。
 */
async function handleMcp(deps: CaseHttpDeps, request: Request): Promise<Response> {
  if (request.method === "GET") {
    // 无状态模式没有可回放的事件流，SDK 要求 GET 回 405（否则客户端会卡在等 SSE）。
    return new Response(null, { status: 405, headers: { allow: "POST" } })
  }
  const server = createCaseMcpServer({ db: deps.db, workspaceRoot: deps.workspaceRoot })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    void closeQuietly(server, transport)
  }
  try {
    await server.connect(transport)
    const response = await transport.handleRequest(request)
    return closeAfterBody(response, close)
  } catch (error) {
    // 不吞异常：这里只补上「已创建的 server + transport 要收掉」，然后把原错误抛出去。
    close()
    throw error
  }
}

/**
 * 起 HTTP 入口。端口读 `OPENHIVE_CASE_MCP_PORT`（`spawnGovernanceMcp` 每轮把它传进子进程；
 * 重启沿用上一轮端口）。
 */
export async function startCaseMcpHttp(deps: CaseHttpDeps): Promise<{
  readonly port: number
  readonly stop: () => Promise<void>
}> {
  const server = Bun.serve({
    hostname: DEFAULT_HOSTNAME,
    port: firstPort(process.env),
    fetch: (request) => {
      const url = new URL(request.url)
      // 只是 liveness：不探 DB、不反映依赖健康度；运维手动探活用。
      if (url.pathname === HEALTH_PATH) return new Response("ok")
      if (url.pathname !== MCP_PATH) return jsonError(404, { error: "not_found" })
      return handleMcp(deps, request)
    },
  })
  return {
    port: server.port ?? 0,
    stop: () => server.stop(true),
  }
}
