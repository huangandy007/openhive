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
 *
 * ## 两半都在这一个文件里（I9，2026-10-05）
 *
 * `resolve` 里的身份是**取一次、两处共用**的（`src/session/tools.ts:62` 的 `mcpMeta`）：
 * server 工具（`convertTool` → `tools/call`）与资源工具（`MCP.readResource`）走同一份。
 * 上面两条钉 server 那半；下面两条钉资源那半——本文件原先只有前一半，于是
 * **把资源工具那行的 `mcpMeta` 摘掉，全仓不会有任何测试变红**（Step 5 的 I9）。
 * 反向也各有其害：两半各取一次身份 = `LEARNINGS #003-05` 那种「同一个判断写两遍」的假镜像。
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
    // 资源工具要一个「宣称支持 resources」的 client 才注册；那份在 `fakeMcpWithResources`（I9）。
    // 本函数只给 server 工具那条用。
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

/** 除了「请求 fiber 上有没有人」之外，用例们的层**逐字相同**——对照组才成立。 */
const anonymousWith = (mcpLayer: Layer.Layer<MCP.Service>) =>
  Layer.mergeAll(
    Layer.succeed(Plugin.Service, fakePlugin),
    Layer.succeed(Permission.Service, fakePermission),
    mcpLayer,
    Layer.succeed(Truncate.Service, fakeTruncate),
    RuntimeFlags.layer(),
    fakeRegistry,
  )

const anonymous = (calls: RecordedCall[]) => anonymousWith(Layer.succeed(MCP.Service, fakeMcp(calls)))

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

/** 跑一次真 `resolve`，拿到组装好的工具表（链 A 把工具交给模型前后真正发生的事）。 */
const resolveTools = Effect.gen(function* () {
  return yield* SessionTools.resolve({
    agent,
    model,
    session: { id: sessionID, permission: [] } as unknown as Session.Info,
    processor: processed,
    bypassAgentCheck: false,
    messages: [],
    promptOps: {} as never,
  })
})

/** 把某个工具执行一遍，返回整张工具表（也顺带证明那个工具确实注册进去了）。 */
const runTool = (key: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const tools = yield* resolveTools
    const execute = tools[key].execute
    if (!execute) throw new Error(`${key} is missing execute`)
    yield* Effect.promise(() =>
      execute(args, { toolCallId: callID, abortSignal: new AbortController().signal, messages: [] }),
    )
    return Object.keys(tools)
  })

const runMcpTool = runTool(MCP_TOOL_KEY, {})

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

/**
 * I9（2026-10-05）· **资源工具（`read_mcp_resource`）也带同一份身份**（FR-005）。
 *
 * ## 补的是哪个洞
 *
 * `src/session/tools.ts` 里 `mcpMeta` 是 `resolve` 期取一次、**两处共用**的：server 工具走
 * `convertTool`（:396），资源工具走 `MCP.readResource`（:355）。上面两条只钉住了前一处 ⇒
 * 把 :355 那个 `mcpMeta` 摘掉，**全仓测试全绿**——而那正是「资源读不带身份」这个洞，
 * 与它同形的 :396 有测试守着、:355 没有（`LEARNINGS #002-06`：修对了但没测试守着，随时可被静默删掉）。
 *
 * ## 判据落点与 server 那半不同（不是笔误）
 *
 * 这里断言的是 `MCP.readResource` 的**第三个实参**：`{"openhive/user": …}` 或 `undefined`。
 * 「`undefined` 时下游一个字节都不发」由 `MCP.readResource` 的实现保证，已在
 * `test/mcp/openhive-mcp-identity.test.ts` 钉住（那里才看得见出站 params 里键的有无）——
 * 本文件钉的是**这一支有没有去取身份**，与上面两条同一口径。
 */
interface RecordedResourceRead {
  readonly server: string
  readonly uri: string
  /** 出站 `resources/read` 的第 3 个实参（`mcpMeta` 的原值或 `undefined`）。 */
  readonly meta: unknown
}

/** 资源工具只在「某个 client 宣称支持 resources」时才注册（`tools.ts:141`）⇒ 这个 client 必须报 resources。 */
function resourceRecordingClient() {
  return {
    getServerCapabilities: () => ({ resources: { subscribe: false, listChanged: false } }),
  } as unknown as Client
}

function fakeMcpWithResources(reads: RecordedResourceRead[]) {
  return MCP.Service.of({
    tools: () => Effect.succeed({}),
    clients: () => Effect.succeed({ fund: resourceRecordingClient() }),
    // 只记录出站实参；返回值按资源工具会读的字段最小化地造（`content.contents` 里一条 text）。
    readResource: (server: string, uri: string, meta?: Record<string, unknown>) => {
      reads.push({ server, uri, meta })
      return Effect.succeed({ contents: [{ uri, mimeType: "text/plain", text: "ledger" }] })
    },
  } as Partial<MCP.Interface> as MCP.Interface)
}

const RESOURCE_TOOL_KEY = "read_mcp_resource"

const identifiedReads: RecordedResourceRead[] = []
const withIdentityResource = testEffect(
  Layer.merge(anonymousWith(Layer.succeed(MCP.Service, fakeMcpWithResources(identifiedReads))), Layer.succeed(User.Service, ALICE)),
)

withIdentityResource.effect("带身份 ⇒ 资源工具 `resources/read` 的第 3 个实参就是这个人", () =>
  Effect.gen(function* () {
    const keys = yield* runTool(RESOURCE_TOOL_KEY, { server: "fund", uri: "ledger://1" })

    expect(keys).toContain(RESOURCE_TOOL_KEY)
    expect(identifiedReads).toHaveLength(1)
    expect(identifiedReads[0].server).toBe("fund")
    expect(identifiedReads[0].uri).toBe("ledger://1")
    expect(identifiedReads[0].meta).toEqual({ "openhive/user": ALICE.id })
  }),
)

/**
 * **对照组**：没有 `User.Service` ⇒ 传下去的是 `undefined`（= 不注入）。
 * 少了这条，「无条件编一个默认身份」也能让上一条绿——那比不注入更坏。
 */
const anonymousReads: RecordedResourceRead[] = []
const withoutIdentityResource = testEffect(
  anonymousWith(Layer.succeed(MCP.Service, fakeMcpWithResources(anonymousReads))),
)

withoutIdentityResource.effect("对照：没有身份 ⇒ 资源工具 `resources/read` 的第 3 个实参是 `undefined`", () =>
  Effect.gen(function* () {
    const keys = yield* runTool(RESOURCE_TOOL_KEY, { server: "fund", uri: "ledger://1" })

    expect(keys).toContain(RESOURCE_TOOL_KEY)
    expect(anonymousReads).toHaveLength(1)
    expect(anonymousReads[0].meta).toBeUndefined()
  }),
)
