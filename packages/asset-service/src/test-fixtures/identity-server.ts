import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

/**
 * 测试用 stdio MCP server：只回答「进程环境里的 USER_ID」与「这次调用的 `_meta` 身份」。
 *
 * 它**不是**生产入口，也不实现任何 RLS。用途只有一个：把 T014 下发的 local 配置真正拉起一个
 * 子进程，证明连接时的 `USER_ID` 与调用时的 `_meta["openhive/user"]` 都到达了 server
 * （D0-12 允许 fixture 只验「身份到达」这一条，**不冒充 RLS 覆盖**）。
 */

const META_KEY = "openhive/user"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function metaUserId(meta: unknown): string | null {
  if (!isRecord(meta)) return null
  const value = meta[META_KEY]
  return typeof value === "string" ? value : null
}

const server = new Server(
  { name: "openhive-identity-fixture", version: "0.0.0" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "whoami",
      description: "返回连接时的 USER_ID 与本次调用的 _meta 身份",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        envUserId: process.env.USER_ID ?? null,
        metaUserId: metaUserId(request.params._meta),
      }),
    },
  ],
}))

await server.connect(new StdioServerTransport())
