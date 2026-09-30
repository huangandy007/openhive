export * as SessionQuota from "./session-quota"

import { Effect } from "effect"
import { inArray } from "drizzle-orm"
// 只取类型：`import type` 连编译产物都不留，**从根上避免** database ↔ quota 的运行时循环。
import type { Database } from "../database/database"
import { SessionSchema } from "../session/schema"
import { SessionTable } from "../session/sql"

/**
 * 每用户并发会话限流的**共享判定模块**（T010 · FR-008）。
 *
 * 为什么要有这个模块、而不是在两条链各写一份：D4 二次裁定（2026-09-30）要求
 * 「判定 + 阈值读取 + 计数逻辑**全落在同一处**，只有『活跃集合从哪取』按链注入」。
 * 生产侧有**两条** prompt 链（A：`/session/{id}/prompt_async` → `SessionPrompt`；
 * B：`/api/session/{id}/prompt` → core `SessionV2.prompt`），两条都得拦——
 * 漏一条就等于留了个「换个端点绕过」的后门。**判定写在两处早晚会漂**，故收敛到这里。
 *
 * 放 `packages/core` 而不按 `plan.md` 原写的 `packages/opencode/src/quota/`：
 * **B 链的拦截点在 core**（`SessionV2.prompt`），而 core **不能** import
 * `@opencode-ai/opencode`（见 `packages/core/package.json` 无该依赖）。要两条链共用一个模块，
 * 只能放在两者共同依赖的 core。**这是对 plan.md 的有意偏离**，已记进 `state.md`。
 */

/**
 * 阈值环境变量。照 `database/router.ts` 的 `OPENHIVE_DATA_ROOT` 与 002 的
 * `OPENHIVE_WORKSPACE_ROOT` 先例命名（`OPENHIVE_` 前缀 + 全大写）。
 */
export const MAX_CONCURRENT_ENV = "OPENHIVE_MAX_SESSIONS_PER_USER"

/**
 * 默认阈值（D4-2 裁定：**5**）。
 *
 * 依据 `plan.md` 的「1600 用户 / 并发活跃 320~480」⇒ 人均不到 1，给 5 是 5 倍以上余量。
 * ⚠️ **未经压测，非结论**——压测后按实测调。
 */
export const DEFAULT_MAX_CONCURRENT = 5

/**
 * 读阈值。照 `dataRoot(env)` 先例：**读传入的 env 记录，不直接读 `process.env`**，
 * 好让调用方与测试能注入。
 *
 * **一律回落到默认值、绝不抛错**，四种情况各有各的理由：
 * - **没设 / 空串**：空串按「没设」处理（同 `dataRoot`）——`OPENHIVE_MAX_SESSIONS_PER_USER=`
 *   不该被读成 0。0 意味着**所有人一个会话都开不了**，比不限流更糟：配置里多打一个等号
 *   就是全员停摆。
 * - **非数字**：`Number("abc")` 是 `NaN`，而**任何与 `NaN` 的比较都为假** ⇒ 若放它过去，
 *   `active >= NaN` 恒 false，**限流会静默失效**——门看着还在，实际没有。这是最坏的一种：
 *   没有任何症状。所以必须在这里显式拒掉，不能指望下游的 `>=`。
 * - **非正数**（`0` / `-1`）：同上，按无效处理。
 * - **非整数**（`2.5`）：没有意义，按无效处理比悄悄取整更好猜。
 *
 * 注意这里**不修剪空白**之外的任何容错——刻意不做「逗号分隔的列表」之类的扩展（简单优先）。
 */
export function maxConcurrentSessions(env: Record<string, string | undefined>): number {
  const raw = env[MAX_CONCURRENT_ENV]
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_CONCURRENT
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_CONCURRENT
  return parsed
}

/**
 * 判据：这一次「启动执行」该不该拒。
 *
 * `active` = 本用户**当前正在跑**的会话数（含 `alreadyRunning` 那条，如果它在跑）。
 *
 * ⚠️ **`alreadyRunning` 这一段是必需的，不是优化**。对一个**已经在跑**的会话再唤醒一次
 * **不增加并发**——`run-coordinator.ts` 的 `wake` 对 `active` 里已有的 key 只置
 * `pendingWake`、**不新建条目**。若只写 `active >= limit`，满配额时
 * **给正在跑的会话追加一句 steer 会被误拒**：把「用户在跟当前这轮对话说话」
 * 当成「又开了一个会话」。判据必须两段：先问目标会话在不在跑，在跑就放行。
 *
 * 写成纯函数（不读 env、不碰 DB）是为了让两条链共用同一份判据，
 * 也为了让上面这条容易写错的规则能被单测钉死。
 */
export function exceeds(input: { active: number; limit: number; alreadyRunning: boolean }): boolean {
  if (input.alreadyRunning) return false
  return input.active >= input.limit
}

/**
 * B 链的计数：「本用户」当前有多少个会话正在跑。
 *
 * B 链手里的活跃集合 `SessionExecution.active` 是**进程级**的
 * （`run-coordinator.ts` 的 `Map<Key, Entry>`，一个进程一份、不分用户），而配额是**每用户**的
 * ⇒ 必须做一次交集：**进程级活跃 ∩ 本用户的库**。做法是拿活跃 id 去查**本用户的库**
 * （查询经 T005 的路由钩子落在该用户的连接上），返回的行数就是本用户的活跃数。
 *
 * ⚠️ **为什么数行数、不用 drizzle 的 `count()`**：`count()` 的**行形状随驱动而变**
 * （`LEARNINGS #002-01` 踩的正是这类东西——读结果、错误对象、空值都会随驱动不同）。
 * 数长度就少一个形状假设，少一个「只在生产炸」的坑。
 *
 * ⚠️ **空集合必须在进 SQL 之前拦掉**：`inArray(col, [])` 生成的 SQL 在 drizzle 各版本间
 * 行为不一致（有的给恒假条件、有的直接语法错）。而「没人活跃」是最常见的调用态
 * （系统空载时每次 prompt 都走这条），不能让它抛。
 */
export function countActiveForUser(
  db: Database.Interface["db"],
  active: Iterable<SessionSchema.ID>,
): Effect.Effect<number> {
  const ids = Array.from(active)
  if (ids.length === 0) return Effect.succeed(0)
  return db
    .select({ id: SessionTable.id })
    .from(SessionTable)
    .where(inArray(SessionTable.id, ids))
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.length),
    )
}
