export * as OpenhiveAccess from "./access"

import { connect } from "@opencode-ai/auth/db"
import { grantsFor } from "@opencode-ai/auth/rbac"
import { AccessSession } from "@opencode-ai/core/access/session"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Config } from "@/config/config"
import { McpCatalog } from "@/mcp/catalog"
import { Effect } from "effect"

/**
 * 一个 MCP server 的**工具名通配**（`fund.db` → `fund_db_*`）——T007 的「opencode 出名字」那一半。
 *
 * 刻意**不自己拼** `sanitize(server) + "_"`：分隔符住在 `McpCatalog.toolName`
 * （`sanitize(clientName) + "_" + sanitize(name)`，`src/mcp/catalog.ts`）。上游哪天换掉那个 `_`，
 * 自己拼的那份会**静默失配**——规则还在、list 里也看得到，就是永远匹配不上真工具名（不报错、
 * 不变红）。传一个空名字给**真函数**取前缀，分隔符就永远与它一致：这是把 `LEARNINGS #003-05`
 * 那个镜像**消掉**，而不是复刻一份。
 */
const toolPatternOf = (server: string) => McpCatalog.toolName(server, "") + "*"

/**
 * T006 · **接线**：按身份取授权行（FR-004）。
 *
 * 分工分在两处，别混：
 * - **形状**（授权行怎么说成一条链 A 规则集）在 core —— `@opencode-ai/core/access/session`。
 *   它是纯函数，两条链都看得到，且 `src/session/prompt.ts` 也要调它——若把形状放在本目录，
 *   `prompt.ts` 就得 import `src/server/…`，那是一条**今天全仓不存在的边**（实测零命中）、
 *   方向还是反的。
 * - **取行**（user → 角色 → 授权 的 join）只能在这里做：全仓只有本包同时依赖 `auth` 与 `core`（实测）。
 *
 * ## 为什么连接是「每层一个、惰性建、建一次就留着」
 *
 * `connect()` 每次调用都新建一个连接池——**按请求建 = 按请求泄漏**（plan.md 风险点 R2）。
 * 与 `@/server/openhive/gateway` 的写法同款、理由同款（那里有两条同名闭包并存的完整说明）：
 * 放到**模块级**会让同一进程里多个 `app()` 共用一条已经关掉的连接，测试直接失真
 * （见 `@opencode-ai/auth/test-support` 的文件头）。所以闭包由调用方在**层构造期**建一次——
 * 本模块只提供工厂，自己不持有状态。
 *
 * 代价照 gateway 的话说清楚：一个进程里 auth 库现在有**三个池**（gateway 刷活跃 / gateway
 * 登录面 / 这里会话创建），各按需增长，不是泄漏。
 *
 * ## 什么时候**不该**调它
 *
 * 身份门关着、或这次请求没有身份 ⇒ 调用方根本不调 ⇒ 连池都不会建，与加这道门之前逐字相同。
 */
export function capabilityFor() {
  let db: ReturnType<typeof connect> | undefined
  const database = () => (db ??= connect(process.env))

  /**
   * 这个用户名下的 capability 规则集。
   *
   * ⚠️ **失败就是失败**：PG 够不着 / 建连超时（`connect()` 有 3 秒连接超时）时这里会抛，
   * 调用方让会话创建整个失败。这是**故意的 fail-closed**——退回去造一条「没有 capability」
   * 的会话，等于把这次创建降级成上游兜底 `ask`，而 skill 带 `always`
   * （`src/tool/skill.ts`）⇒ 民警能自己批自己。宁可这次创建不成功，也不能造出一条可被自批的会话。
   * 读配置失败同理（T007 起 capability 还依赖 `Config.mcp`）。
   *
   * ## mcp 名单从 `Config.mcp` 来（T007 / FR-005）
   *
   * 会话创建时 MCP server 集合**只能是配置里声明的那些**：capability 是**建会话那一刻冻结**的
   * 规则集，按运行时的连接状态（`MCP.status()`）取名单会让它随「谁先连上」而变，且会把
   * 建会话这一步绑到 MCP 连接上（迟到、甚至挂住）。配置是声明式的、稳定的，也是**权威**的——
   * 能不能连上是 MCP 自己的事，**能不能调**由这里说了算。
   *
   * ⚠️ 已知残差（挂账，见 `004/state.md`）：`POST /mcp`（上游的「动态加一个 server」端点，
   * 只写进 `InstanceState`、不回写配置）加的 server **不在**这份名单里 ⇒ 它的工具落回上游 `ask`。
   * 那条端点本身还能加 `type: "local"`（= 任意进程）——同一个来源，一并挂账。
   *
   * 名单是**键**（`Config.mcp` 的名字），翻译成一对名字交给 core（见模块头「分工分在两处」）：
   * 工具名通配走 {@link toolPatternOf}；资源 pattern 的**原样** server 名由 core 拼
   * （`mcp:<server>:*`，与 `src/session/tools.ts` 的 `ask` 逐字同形）。
   */
  // ⚠️ 出参类型里**必须**写出 `Config.Service` 这个需求（T007 起）。
  // 少写它（= 声明成 `Effect<Ruleset>`）typecheck 当场红——别把它当成类型体操去绕：
  // 那条红正是「capability 现在依赖配置」这件事**唯一会被编译器看见**的地方，
  // 而它恰是本 task 的语义（名单来自 `Config.mcp`）。真正的失败仍按上面那条 fail-closed 走。
  return (userId: string): Effect.Effect<PermissionV1.Ruleset, never, Config.Service> =>
    Effect.gen(function* () {
      const config = yield* Config.Service
      const servers = Object.keys((yield* config.get()).mcp ?? {}).map((server) => ({
        server,
        toolPattern: toolPatternOf(server),
      }))
      const grants = yield* Effect.promise(() => grantsFor(database(), userId))
      return AccessSession.sessionRuleset(grants, servers)
    })
}
