import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"

/**
 * 【这是要保留的定制】openhive 模块：**MCP 调用带用户身份**（004 · T007 · FR-005）。
 *
 * FR-005 原文：「MCP server / 数据库账号 MUST 带用户身份，用受限账号执行，GRANT/RLS 最终兜底。」
 *
 * ## 做什么
 *
 * 把「这次 MCP 调用是谁发的」放进 MCP 请求的 `_meta`，键为 {@link USER_META_KEY}：
 *
 *     { "openhive/user": "<user id>" }
 *
 * 上游 opencode 完全不知道这件事；`_meta` 是 MCP 协议为这种带外信息留的字段，自定义键合法
 * （`CallToolRequestParamsSchema` / `ReadResourceRequestParamsSchema` 的 `_meta` 都是
 * `z.core.$loose`，即 passthrough）。下游的 MCP server（公安业务侧）据此按人取数、按人留痕，
 * 并在自己的数据库上落「受限账号 + GRANT/RLS」——那最后一道由 F6/F7 的业务库侧承接。
 *
 * ## 为什么是「按调用注入」而不是「连接时握手一次」
 *
 * MCP client 的缓存键是 `directory`（`InstanceState`），而链 A 下 `directory` 是
 * `<root>/<user id>`（`server/openhive/anchor-workspace.ts`）⇒ 事实上**每人一个 client**，
 * 连接时握手一次看起来也行。但那是**当前实现的一个副作用**，不是协议保证；哪天有人把
 * directory 改回全局，连接时注入就会把 A 的身份发给 B。按调用注入不依赖任何缓存布局。
 *
 * ## 身份从哪来（不要改成读会话字段）
 *
 * `User.Service`——**每请求注入**（`middleware/user-identity.ts` 用 `Effect.provideService`
 * 挂在请求 fiber 上）。调用点够得着它，是因为工具执行走 `EffectBridge`，而
 * `EffectBridge.make()` 用 `Effect.context()` 捕获**全量** context 再 `provide(ctx)`
 * （`src/effect/bridge.ts`）。
 *
 * ⚠️ **不要**改读 `session.metadata`：那是**客户端可写**的（`SetMetadataInput` →
 * `session.setMetadata` 整列覆写），拿它当身份等于让民警自改身份——本项目 `Anti-Patterns`
 * 里「用前端隐藏替代权限校验」的同一形状。
 *
 * ## 没身份时（返回 `undefined`）
 *
 * 非 HTTP 入口 / 未登录时（`User.Service` 不在 context 里）**不注入 `_meta`**——注意是
 * 「params 里没有这个键」，不是「带了个空身份」。宁可让下游 server 自己决定「看不见身份就拒」，
 * 也不要替它编一个不是本人的身份。
 *
 * ## 已知缺口（挂账，见 `004/state.md` 的 T007 缺口表）
 *
 * `src/tool/code-mode.ts` 里另有一处 `client.callTool`（实验特性，受
 * `OPENCODE_EXPERIMENTAL_CODE_MODE` 门控，**默认关**）：开了 code mode 时
 * `SessionTools.resolve` 会提前 `return tools`，这条注入整个被绕过。默认关闭 ⇒ 今天不可达；
 * 开启前必须先补这里，否则「关了 code mode 有身份、开了没有」——一个开关换一套安全语义。
 */
export const USER_META_KEY = "openhive/user"

/** 出站 MCP 请求的 `_meta`。形状交给调用方（上游 `convertTool` / `readResource` 认 `Record<string, unknown>`）。 */
export type Meta = Readonly<Record<string, unknown>>

/**
 * 本次请求的用户身份，包成 MCP `_meta`。没有 `User.Service` 时给 `undefined`（= 不注入）。
 *
 * 调用点（`session/tools.ts`）在 `resolve` 期取一次、供该请求的所有 MCP 出口共用：
 * server 工具（`convertTool` → `tools/call`）与资源工具（`MCP.readResource`）走的是**同一份**
 * 身份，不各取一次——两处各取一次是 `LEARNINGS #003-05` 说的假镜像形状。
 */
export const userMeta = (): Effect.Effect<Meta | undefined> =>
  Effect.map(Effect.serviceOption(User.Service), (user) =>
    Option.isSome(user) ? { [USER_META_KEY]: user.value.id } : undefined,
  )
