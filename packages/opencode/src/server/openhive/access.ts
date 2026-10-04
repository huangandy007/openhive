export * as OpenhiveAccess from "./access"

import { connect } from "@opencode-ai/auth/db"
import { grantsFor } from "@opencode-ai/auth/rbac"
import { AccessSession } from "@opencode-ai/core/access/session"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Effect } from "effect"

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
   */
  return (userId: string): Effect.Effect<PermissionV1.Ruleset> =>
    Effect.promise(() => grantsFor(database(), userId)).pipe(Effect.map(AccessSession.sessionRuleset))
}
