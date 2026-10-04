import { expect } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { User } from "@opencode-ai/core/user"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import type { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageID, SessionID } from "@/session/schema"
import { SessionProcessor } from "@/session/processor"
import { SessionTools } from "@/session/tools"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Plugin } from "@/plugin"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

/**
 * T007（FR-005）：**MCP 查询带身份**——链 A 调 MCP 时，请求体里带上「这次调用是谁发的」。
 *
 * ## 要求原文
 *
 * FR-005：「MCP server / 数据库账号 MUST 带用户身份，用受限账号执行，GRANT/RLS 最终兜底。」
 * 本仓库今天打得到的是前一半（MCP server 侧带身份）；后一半（每角色受限数据库账号 + GRANT）
 * 本机没有业务库、也没有 PG 角色可建——**显式挂账 F6/F7**（见 `004/state.md` 的 T007 缺口表），
 * 不写进「已覆盖」。
 *
 * ## 身份落在哪
 *
 * 落在 MCP 请求的 `_meta` 里（键 `openhive/user`），**不是**自定义 header、**不是** body 注入：
 * `_meta` 是 MCP 协议为这种带外信息留的字段，实测 `CallToolRequestParamsSchema` 的 `_meta` 是
 * `z.core.$loose`（passthrough）⇒ 允许 `openhive/` 前缀的自定义键。
 *
 * ## 身份从哪取
 *
 * 取 `User.Service`——**每请求注入**的服务（`middleware/user-identity.ts` 用
 * `Effect.provideService` 挂在请求 fiber 上），**不是**会话上的字段。两个理由都是实测的：
 * - 会话上的 `metadata` **客户端可写**（`SetMetadataInput` → `session.setMetadata` 整列覆写）
 *   ⇒ 拿它存身份等于让民警自改身份，正是本项目 `Anti-Patterns` 里点名的那种「用前端隐藏替代
 *   权限校验」的形状；
 * - 调用点**够得着** `User.Service`：工具执行走 `EffectBridge`，`EffectBridge.make()` 用
 *   `Effect.context()` 捕获**全量** context 再 `provide(ctx)`（`src/effect/bridge.ts` 实测）
 *   ⇒ 工具 `execute` 里的 Effect 继承请求 fiber 的服务；`promptAsync` 那条 `forkIn` 也继承
 *   （`test/server/httpapi-promptasync-context.test.ts` 已把这条钉成回归）。
 *
 * ## 为什么用**真** `SessionTools.resolve` + **真** `McpCatalog.convertTool`
 *
 * 被测路径是「`resolve` 组装工具 → `convertTool` 发 `tools/call`」，两个都是生产函数。
 * 换掉的只有 MCP **client**（transport 边界）：它记录出站参数，我们断言的是「生产代码往边界上
 * 放了什么」。判据（`LEARNINGS #002-02`）：这条测试**真的执行了**被测路径——把 `resolve` 里
 * 那行身份摘掉、或 `convertTool` 不再写进 params，它一定红；只做类型断言 / mock 掉被测逻辑
 * 的写法不算测试。
 */

const callID = "call-t007"
const sessionID = SessionID.make("ses_t007")
const messageID = MessageID.ascending()

/** 身份门开着时，请求 fiber 上挂着的那个人。 */
const ALICE: User.Info = { id: "u_alice", policeNo: "0451", name: "爱丽丝", isAdmin: false }

const agent: Agent.Info = {
  name: "build",
  mode: "primary",
  options: {},
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
}

const model = {
  providerID: ProviderV2.ID.make("test"),
  api: { id: "test-model" },
} as Provider.Model

const mcpToolDef: MCPToolDef = {
  name: "query",
  description: "公安业务查询",
  inputSchema: { type: "object", properties: {} },
}

/** `mcp.tools()` 给出的那个键：`McpCatalog.toolName("fund", "query")`。 */
const MCP_TOOL_KEY = "fund_query"

interface RecordedCall {
  readonly name: string
  /** 出站 `tools/call` params 里到底有没有 `_meta` 这个键（有则是原值）。 */
  readonly meta: unknown
  readonly hasMeta: boolean
}

/**
 * 假 MCP client：**只**记录出站参数（transport 边界）。
 *
 * 刻意不复刻 `convertTool` 的任何逻辑——那是被测对象。返回值按 `convertTool` 会读的字段
 * 最小化地造（`content` 非空 ⇒ 原样返回 result，见 `catalog.ts:75`）。
 */
function recordingClient(calls: RecordedCall[]) {
  return {
    callTool: async (params: { name: string; _meta?: unknown }) => {
      calls.push({ name: params.name, meta: params._meta, hasMeta: "_meta" in params })
      return { content: [{ type: "text" as const, text: "ok" }] }
    },
  } as unknown as Client
}

function fakeMcp(calls: RecordedCall[]) {
  return MCP.Service.of({
    tools: () => Effect.succeed({ [MCP_TOOL_KEY]: { def: mcpToolDef, client: recordingClient(calls) } }),
    // 资源工具要一个「宣称支持 resources」的 client 才注册；本文件只验 server 工具那条。
    // 资源那一半（`_meta` 要走真 transport）在 test/mcp/openhive-mcp-identity.test.ts。
    clients: () => Effect.succeed({}),
  } as Partial<MCP.Interface> as MCP.Interface)
}

const fakePlugin = Plugin.Service.of({
  init: () => Effect.void,
  list: () => Effect.succeed([]),
  trigger: (_name, _input, output) => Effect.succeed(output),
} satisfies Plugin.Interface)

const fakePermission = Permission.Service.of({
  ask: () => Effect.void,
  reply: () => Effect.void,
  list: () => Effect.succeed([]),
} satisfies Permission.Interface)

const fakeTruncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed("output.txt"),
  output: (text: string) => Effect.succeed({ content: text, truncated: false }),
  limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50 * 1024 }),
} satisfies Truncate.Interface)

const fakeRegistry = Layer.succeed(
  ToolRegistry.Service,
  ToolRegistry.Service.of({
    ids: () => Effect.succeed([]),
    all: () => Effect.succeed([]),
    named: () => Effect.die("unused"),
    tools: () => Effect.succeed([]),
  }),
)

/** 除了「请求 fiber 上有没有人」之外，两个用例的层**逐字相同**——对照组才成立。 */
const anonymous = (calls: RecordedCall[]) =>
  Layer.mergeAll(
    Layer.succeed(Plugin.Service, fakePlugin),
    Layer.succeed(Permission.Service, fakePermission),
    Layer.succeed(MCP.Service, fakeMcp(calls)),
    Layer.succeed(Truncate.Service, fakeTruncate),
    RuntimeFlags.layer(),
    fakeRegistry,
  )

const processed = {
  message: {
    id: messageID,
    sessionID,
    role: "assistant",
    parentID: MessageID.ascending(),
    agent: "build",
    mode: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ModelV2.ID.make("test-model"),
    providerID: ProviderV2.ID.make("test"),
    time: { created: 1 },
  } satisfies SessionV1.Assistant,
  updateToolCall: () => Effect.die("unused"),
  completeToolCall: () => Effect.void,
} satisfies Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">

/** 跑一次真 `resolve`，把那个 MCP 工具执行一遍（链 A 把工具交给模型前后真正发生的事）。 */
const runMcpTool = Effect.gen(function* () {
  const tools = yield* SessionTools.resolve({
    agent,
    model,
    session: { id: sessionID, permission: [] } as unknown as Session.Info,
    processor: processed,
    bypassAgentCheck: false,
    messages: [],
    promptOps: {} as never,
  })
  const execute = tools[MCP_TOOL_KEY].execute
  if (!execute) throw new Error(`${MCP_TOOL_KEY} is missing execute`)
  yield* Effect.promise(() =>
    execute({}, { toolCallId: callID, abortSignal: new AbortController().signal, messages: [] }),
  )
  return Object.keys(tools)
})

const identifiedCalls: RecordedCall[] = []
const withIdentity = testEffect(Layer.merge(anonymous(identifiedCalls), Layer.succeed(User.Service, ALICE)))

withIdentity.effect("带身份 ⇒ MCP `tools/call` 的 `_meta` 里带上这个人", () =>
  Effect.gen(function* () {
    const keys = yield* runMcpTool

    expect(keys).toContain(MCP_TOOL_KEY)
    expect(identifiedCalls).toHaveLength(1)
    expect(identifiedCalls[0].name).toBe("query")
    expect(identifiedCalls[0].hasMeta).toBe(true)
    expect(identifiedCalls[0].meta).toEqual({ "openhive/user": ALICE.id })
  }),
)

/**
 * **对照组**：身份门关着（没有 `User.Service`——非 HTTP 入口 / 未登录）⇒ **一个字节都不多发**。
 *
 * 少了这条，「把 `_meta` 无条件写成一个默认值」也能让上一条绿——那等于给每个 MCP server
 * 发一个**不是本人**的身份，比不注入更坏。这条的断言是 `"_meta" in params === false`，
 * 不是 `_meta === undefined`：`{_meta: undefined}` 与「没有这个键」在 JSON-RPC 上是两回事，
 * 而我们要的是后者（不是「带了个空身份」，是「压根没带身份」）。
 */
const anonymousCalls: RecordedCall[] = []
const withoutIdentity = testEffect(anonymous(anonymousCalls))

withoutIdentity.effect("没有身份 ⇒ 出站 params 里根本没有 `_meta` 这个键", () =>
  Effect.gen(function* () {
    const keys = yield* runMcpTool

    expect(keys).toContain(MCP_TOOL_KEY)
    expect(anonymousCalls).toHaveLength(1)
    expect(anonymousCalls[0].hasMeta).toBe(false)
    expect(anonymousCalls[0].meta).toBeUndefined()
  }),
)
