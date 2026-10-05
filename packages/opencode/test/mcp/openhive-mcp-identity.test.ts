import { expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
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

/**
 * 进程内的 MCP server：提供 resources ＋ prompts，并把每次 `resources/read` / `prompts/get`
 * 的 params 各记一份。
 *
 * 两件事共用一个 server（不是两个）：身份是**同一份**（`_meta` 的同一个键），放一个进程里
 * 更能看出「两个出口是不是同源」——两个 server 各自记一份反而像两套语义。
 */
function identityServer() {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const seen: Array<Record<string, unknown>> = []
      const seenPrompts: Array<Record<string, unknown>> = []
      const protocol = new Server(
        { name: "mcp-openhive-identity", version: "1.0.0" },
        { capabilities: { resources: {}, prompts: {} } },
      )
      protocol.setRequestHandler(ListResourcesRequestSchema, () =>
        Promise.resolve({ resources: [{ name: "ledger", uri: "fund://ledger" }] }),
      )
      protocol.setRequestHandler(ReadResourceRequestSchema, (request) => {
        seen.push(request.params as unknown as Record<string, unknown>)
        return Promise.resolve({ contents: [{ uri: request.params.uri, text: "resource result" }] })
      })
      protocol.setRequestHandler(ListPromptsRequestSchema, () =>
        Promise.resolve({ prompts: [{ name: "brief", description: "brief the case" }] }),
      )
      protocol.setRequestHandler(GetPromptRequestSchema, (request) => {
        seenPrompts.push(request.params as unknown as Record<string, unknown>)
        return Promise.resolve({
          description: "brief the case",
          messages: [{ role: "user" as const, content: { type: "text" as const, text: "prompt result" } }],
        })
      })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      await protocol.connect(transport)
      const http = Bun.serve({ port: 0, fetch: (request) => transport.handleRequest(request) })
      return {
        seen,
        seenPrompts,
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

/**
 * R5（2026-10-05）· **第三个出口：`prompts/get` 也要带身份**（FR-005）。
 *
 * ## 补的是哪个洞
 *
 * `_meta` 原先只写进出站 `tools/call`（`convertTool`）与 `resources/read`
 * （`MCP.readResource`）——`MCP.getPrompt` 这一支**没有 meta 形参**，于是 `prompts/get`
 * 是三个 MCP 出口里唯一一个**不带身份**的。原判为 M14 里的一条 minor（「`prompts/get` 未带身份」），
 * R5 复核后**升级为 Important**，理由是它和 I8 是同一个形状：
 *
 * - **不是「没人用所以无所谓」**：`src/command/index.ts` 把每个 MCP prompt 注册成一条
 *   `source: "mcp"` 的命令，`template` 那个 getter 在生产里**真的会调** `MCP.getPrompt`。
 * - **下游是业务 MCP server**：它有 `_meta` 与没有 `_meta` 是两套行为（按人取数 / 按人留痕 /
 *   无身份空集）。「不知道是谁」的那次调用会被下游按匿名处理，而**本侧不报错、不变红**。
 *
 * ## 为什么三条出口必须是**同源的一份**身份
 *
 * 与 I9 同因（`LEARNINGS #003-05`）：身份在调用点**取一次**、三条出口共用一份，而不是各自
 * `userMeta()` 一次——各取一次就是「同一个判断写两遍」的假镜像形状。本文件的两条钉住
 * 「`MCP` 这一层确实把它写进了线上 params」；「调用点有没有把身份交下来」由
 * `test/session/openhive-mcp-identity.test.ts` 与 `test/session/prompt.test.ts` 钉（接线那半）。
 */
it.instance("`getPrompt` 把身份放进 `prompts/get` 的 `_meta`（线上可见）", () =>
  Effect.gen(function* () {
    const server = yield* identityServer()
    const mcp = yield* MCP.Service
    yield* mcp.add("fund-server", { type: "remote", url: server.url, oauth: false })

    const result = yield* mcp.getPrompt("fund-server", "brief", {}, { "openhive/user": "u_alice" })

    expect(result).toBeDefined()
    expect(server.seenPrompts).toHaveLength(1)
    expect(server.seenPrompts[0].name).toBe("brief")
    expect(server.seenPrompts[0]._meta).toEqual({ "openhive/user": "u_alice" })
  }),
)

/**
 * **对照组**：不传 meta ⇒ 协议线上**没有 `_meta` 这个键**（与资源那条同款）。
 *
 * 少了这条，「把 `_meta` 无条件写成 `{}` 或某个默认值」也能让上一条绿——那比不注入更坏：
 * 下游会认为「这次调用有身份，只是身份是空的」，而正确语义是「这次调用没带身份」。
 */
it.instance("不传 meta ⇒ `prompts/get` 的 params 里没有 `_meta` 这个键", () =>
  Effect.gen(function* () {
    const server = yield* identityServer()
    const mcp = yield* MCP.Service
    yield* mcp.add("anon-server", { type: "remote", url: server.url, oauth: false })

    const result = yield* mcp.getPrompt("anon-server", "brief", {})

    expect(result).toBeDefined()
    expect(server.seenPrompts).toHaveLength(1)
    expect("_meta" in server.seenPrompts[0]).toBe(false)
  }),
)
