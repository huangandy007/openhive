import { expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { MCP } from "../../src/mcp/index"
import { testEffect } from "../lib/effect"

/**
 * T007（FR-005）· **资源那一半**：`MCP.Service.readResource` 要把身份放进 `resources/read`
 * 出站请求的 `_meta`。
 *
 * ## 为什么这条必须走「真 MCP 层 + 真 transport」
 *
 * `session/tools.ts` 里那条测试（`test/session/openhive-mcp-identity.test.ts`）验的是**接线**：
 * `resolve` 把 meta 交给了 `mcp.readResource(server, uri, meta)`——但那里的 `MCP.Service` 是替身，
 * 所以它**碰不到** `src/mcp/index.ts` 里把 `meta` 塞进 `client.readResource(...)` 的那一行。
 * 两半是两回事：接线对了、那一行丢了，资源请求照样不带身份而前一条测试照样绿
 * （`LEARNINGS #002-02`：没执行被测路径的测试不是测试）。
 *
 * 这里跑**生产** `MCP.node`，连一个真的、进程内的 streamable-http MCP server
 * （`WebStandardStreamableHTTPServerTransport`，同 `lifecycle.test.ts` 的做法），
 * 在 server 侧把收到的 `params` 记下来——断言的就是**协议线上**到底有没有 `_meta`。
 * server 端能看见它，是因为 `ReadResourceRequestParamsSchema` 的 `_meta` 是 passthrough。
 */

/** 进程内的 MCP server：只提供 resources，并把每次 `resources/read` 的 params 记下来。 */
function identityServer() {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const seen: Array<Record<string, unknown>> = []
      const protocol = new Server(
        { name: "mcp-openhive-identity", version: "1.0.0" },
        { capabilities: { resources: {} } },
      )
      protocol.setRequestHandler(ListResourcesRequestSchema, () =>
        Promise.resolve({ resources: [{ name: "ledger", uri: "fund://ledger" }] }),
      )
      protocol.setRequestHandler(ReadResourceRequestSchema, (request) => {
        seen.push(request.params as unknown as Record<string, unknown>)
        return Promise.resolve({ contents: [{ uri: request.params.uri, text: "resource result" }] })
      })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      await protocol.connect(transport)
      const http = Bun.serve({ port: 0, fetch: (request) => transport.handleRequest(request) })
      return {
        seen,
        url: http.url.toString(),
        close: async () => {
          await protocol.close().catch(() => {})
          http.stop(true)
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

const it = testEffect(LayerNode.compile(MCP.node))

it.instance("`readResource` 把身份放进 `resources/read` 的 `_meta`（线上可见）", () =>
  Effect.gen(function* () {
    const server = yield* identityServer()
    const mcp = yield* MCP.Service
    yield* mcp.add("fund-server", { type: "remote", url: server.url, oauth: false })

    const content = yield* mcp.readResource("fund-server", "fund://ledger", { "openhive/user": "u_alice" })

    expect(content).toBeDefined()
    expect(server.seen).toHaveLength(1)
    expect(server.seen[0].uri).toBe("fund://ledger")
    expect(server.seen[0]._meta).toEqual({ "openhive/user": "u_alice" })
  }),
)

/**
 * **对照组**：不传 meta ⇒ 协议线上**没有 `_meta` 这个键**。
 *
 * 少了这条，「把 `_meta` 无条件写成 `{}` 或某个默认值」也能让上一条绿。断言 `"_meta" in params`
 * 而不是 `params._meta === undefined`：要的是「没带身份」，不是「带了个空身份」。
 */
it.instance("不传 meta ⇒ `resources/read` 的 params 里没有 `_meta` 这个键", () =>
  Effect.gen(function* () {
    const server = yield* identityServer()
    const mcp = yield* MCP.Service
    yield* mcp.add("anon-server", { type: "remote", url: server.url, oauth: false })

    const content = yield* mcp.readResource("anon-server", "fund://ledger")

    expect(content).toBeDefined()
    expect(server.seen).toHaveLength(1)
    expect("_meta" in server.seen[0]).toBe(false)
  }),
)
