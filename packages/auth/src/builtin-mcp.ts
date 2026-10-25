/**
 * 内建 MCP server 名单（009 T014，FR-009）。
 *
 * ## 为什么需要这份名单
 *
 * capability 的 MCP 规则是**按 `role_resource` 授权行**铺的（`AccessSession.sessionRuleset`
 * 的 mcp 段）：配置里有这个 server、但库里没有 `(mcp, server, read)` 授权行 ⇒ 两条 deny，
 * 模型看不到它的工具。资产型 MCP 正该如此（没授权就不下发、也不可见）。
 *
 * 但**治理 server** 不是资产：它是 T012 / T013 交付的三个工具
 * （`create_skill_draft` / `submit_skill_for_review` / `publish_skill`），没有「资产 id」
 * 可以授。若照资产那条路走，模型永远看不到它们——T013 留下的「工具没注册」就只是从
 * 「没写进配置」变成「写进配置但被 capability 拒掉」。
 *
 * 所以给这类 server 一个**显式标记**：`McpServerNaming.builtin = true` ⇒ 第①层恒 allow。
 * **动作级校验仍在 server 内第③层**：建草稿要求账号有效，提交要求该资产 `write`，
 * 发布要求 `admin`（`governance.ts` → `transitionAsset` → `authorizeTransition`）。
 * 第①层只做「server 级」过滤，它分不出同一个 server 里的三个工具。
 *
 * ## 为什么住在 auth 包
 *
 * 两个消费者在**两条互不依赖的边**上：
 * - `packages/opencode/src/server/openhive/access.ts`：capability 接线；
 * - `packages/asset-service/src/downlink.ts`：按用户拼 `mcp` 段。
 *
 * 它们**互相不能 import**（opencode 不依赖 asset-service，asset-service 也不依赖 opencode；
 * 加这条边就是会话交接里明确禁止的那条）。而两边都依赖 `@opencode-ai/auth`，所以常量放这里
 * 是唯一不需要新增依赖边的落点（`LEARNINGS #002-06`：同一个前提只留一份写法）。
 *
 * ## 信任边界（重要）
 *
 * `BUILTIN_MCP_SERVERS` 按**配置键名**放行。这成立的前提是：用户的 `opencode.json` 由服务端
 * 下发、**不在民警可写的工作区里**。若配置可被用户改写，这个名单就是一条「把恶意 local MCP
 * 改名成 `openhive-governance` 就能让工具进清单」的口子——但那种前提下，改配置本身已经能
 * 拉起任意 local 进程（比工具清单严重得多），所以名单**没有引入新的威胁类别**。
 * 这条前提写进 `docs/superpowers/specs/009-ai-assets/mcp-downlink.md` 的验收清单。
 */
export const GOVERNANCE_MCP_SERVER = "openhive-governance"

/**
 * 不走 `role_resource`、恒由 capability 放行的 server 名单。
 *
 * ⚠️ 往里加名字等于**扩大第①层的放行面**：加之前先确认该 server 内部有动作级硬拦
 * （第③层），并且它的配置由服务端下发。
 */
export const BUILTIN_MCP_SERVERS: readonly string[] = [GOVERNANCE_MCP_SERVER]
