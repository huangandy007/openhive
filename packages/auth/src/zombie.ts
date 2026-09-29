import { inArray, sql } from "drizzle-orm"
import { ZOMBIE_INACTIVE_DAYS } from "./policy"
import { nowSeconds } from "./time"
import { type UserAccountTarget, type UserRow, user } from "./user"

/**
 * 僵尸账户：超 90 天没活跃的启用账户（FR-009 / design-v2 §4.3，`2026-09-06-openhive-design-v2.md:180`）。
 *
 * 筛选与批量停用是**两步、由管理员确认**的：先把名单给人看，再按 id 停用。不做「自动清理」——
 * 停用是会影响真人登录的动作，名单里出现一个还在办案的民警就得有人能拦下来。
 */

const SECONDS_PER_DAY = 24 * 60 * 60

/** 状态取值：1 启用 / 0 停用（design-v2 `:136`，与 login.ts 同一读法）。 */
const ENABLED = 1
const DISABLED = 0

/** 只用到三个时间列——收窄入参，纯函数才能被直接单测。 */
export type LastSeenFields = Pick<UserRow, "lastActiveAt" | "lastLoginAt" | "createdAt">

/**
 * 「最后一次有活着迹象」的时刻（Unix 秒）。
 *
 * 三级回退，缺省即「从没写过」：
 * - `last_active_at` —— 最准（design-v2 §4.1 说它「请求时更新」，比登录更细）
 * - `last_login_at` —— 登录过但没打过标记的账号
 * - `created_at` —— 建号后从没登录过
 *
 * ⚠️ **`last_active_at` 全仓库没有写入方**：它的写入点是网关每请求刷新，属 T018/F3 的活。
 * 因此**不能**照 design-v2 字面只比 `last_active_at`——那列眼下恒为 NULL，
 * `last_active_at < 截止线` 对 NULL 求值为 NULL（不为真），筛选会**永远返回 0 条**。
 * 而 0 条不会报错、不会变红，管理员只会看到「暂无僵尸账户」并信以为真。回退到 `created_at`
 * 才让这个功能今天就可用；等网关接上写入方后，回退链自然收敛到第一级。
 *
 * SQL 侧（`findZombieAccounts`）与 JS 侧（本函数）是同一规则的两份实现，
 * `zombie.test.ts` 里有一条**对账测试**把两者钉在一起，改一边不改另一边会红。
 */
export function lastSeenAtOf(row: LastSeenFields): number {
  return row.lastActiveAt ?? row.lastLoginAt ?? row.createdAt
}

/** 一条待处理的僵尸账户。 */
export interface ZombieAccount {
  id: string
  policeNo: string
  name: string
  /** 最后一次有活着迹象的时刻（Unix 秒）。取值规则见 `lastSeenAtOf`。 */
  lastSeenAt: number
}

/**
 * 筛出「启用、且超 90 天没活跃」的账户。
 *
 * 条件写成**一条 SQL 表达式**而不是 drizzle 的 `and(eq(...), lt(...))`：
 * 窄接口 `UserAccountTarget.where` 收的是 `SQL`，而 drizzle 的 `and()` 返回 `SQL | undefined`，
 * 拼起来要在调用点处理 undefined；整条 `sql` 模板顺带把 coalesce 写得看得见。
 *
 * `now` 默认取当前时刻，显式传入是为了让「恰好 90 天」这种边界用例可复现。
 *
 * 不排序：查出来是给管理员过目 + 勾选的名单，顺序不稳不影响正确性，前端要排再排。
 */
export async function findZombieAccounts(db: UserAccountTarget, now: number = nowSeconds()): Promise<ZombieAccount[]> {
  const cutoff = now - ZOMBIE_INACTIVE_DAYS * SECONDS_PER_DAY
  const lastSeen = sql`coalesce(${user.lastActiveAt}, ${user.lastLoginAt}, ${user.createdAt})`

  // 严格小于：要求是「**超过** 90 天」，正好 90 天的还不算。
  const rows = await db
    .select()
    .from(user)
    .where(sql`${user.status} = ${ENABLED} and ${lastSeen} < ${cutoff}`)

  return rows.map((row) => ({
    id: row.id,
    policeNo: row.policeNo,
    name: row.name,
    lastSeenAt: lastSeenAtOf(row),
  }))
}

/**
 * 按 id 批量停用（FR-009 的「一键」）。
 *
 * 只改 `status`，**不删任何数据**——停用是可逆的（FR-010 要求 30 天内可恢复），
 * 而删除不可逆。恢复是 T016 的事。
 *
 * 空名单不必特判：`inArray(x, [])` 生成恒假条件，一行也动不了（`zombie.test.ts` 钉住了这条）。
 */
export async function disableAccounts(db: UserAccountTarget, ids: string[]): Promise<void> {
  await db.update(user).set({ status: DISABLED }).where(inArray(user.id, ids))
}
