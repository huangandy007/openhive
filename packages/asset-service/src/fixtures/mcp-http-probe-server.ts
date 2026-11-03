/**
 * 真栈 E2E 用的**远程** MCP server（fixture，2026-11-03）。
 *
 * 与 `mcp-probe-server.ts`（stdio）同一用意：驱动「发布前试连」这条真链路。
 * 这一份走 streamable HTTP，并且**只认带对 Authorization 的请求**——
 * 于是「发布成功」同时证明了新建表单里填的请求头真的落进连接、真的随试连发出，
 * 而不是被某一层静默丢掉。
 *
 * 用法（从本 package 下跑，SDK 才解析得到）：
 *
 * ```
 * PORT=4799 REQUIRED_AUTH="Bearer e2e-secret" bun src/fixtures/mcp-http-probe-server.ts
 * ```
 *
 * 起好后打一行 `READY <port>`；鉴权失败回 401，其余交给 SDK 的 streamable HTTP 契约。
 */
import { createServer } from "node:http"
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

const port = Number(process.env.PORT ?? 4799)
const required = process.env.REQUIRED_AUTH

const server = createServer((req, res) => {
  if (required !== undefined && req.headers.authorization !== required) {
    res.writeHead(401, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "unauthorized" }))
    return
  }
  // 每请求一套 transport（无状态模式），与 `mcp-probe.test.ts` 的远程 fixture 同形。
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  const mcp = new McpServer({ name: "mcp-http-probe-fixture", version: "1.0.0" }, { capabilities: { tools: {} } })
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "ping", inputSchema: { type: "object" } }],
  }))
  void mcp
    .connect(transport)
    .then(() => transport.handleRequest(req, res))
    .catch(() => {
      if (!res.headersSent) res.statusCode = 500
      res.end()
    })
})

server.listen(port, "127.0.0.1", () => {
  const address = server.address()
  const actual = address !== null && typeof address !== "string" ? address.port : port
  process.stdout.write(`READY ${actual}\n`)
})

function stop() {
  server.close()
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
