export * as AccountAdmin from "./account-admin"

/**
 * 账号管理的**读取面**（010 T005 / FR-004）：列表（搜索 / 筛选 / 分页 / 统计）与详情。
 *
 * ## 为什么在 auth 包里，而不是写在 HTTP 路由里
 *
 * 搜索、状态筛选、僵尸判定、统计口径都是**关于账号表的事**，与「谁在问」无关。
 * 放进路由模块的话，它们就只能靠一条 HTTP 用例隔着三层去测；放在这里，PGlite 上直接钉住
 * `ilike`、`coalesce`、`limit` 的真实行为。路由模块只负责身份、授权、错误翻译。
 *
 * ## 写入动作**不在这里**
 *
 * 录入 / 重置 / 停用 / 启用各有自己的服务层模块（`register.ts` / `password.ts` / `zombie.ts`），
 * 这里一份都不重写——两份实现漂了不会报错（`#002-06`）。本模块只读。
 *
 * ## 僵尸判定：规则的**第二份实现**，靠对账测试钉住
 *
 * `findZombieAccounts` 用 SQL 的 `coalesce`，`lastSeenAtOf` 用 JS 的三级回退，两者是
 * **同一条规则的两份实现**（`zombie.ts` 的文件头已写明，并已有对账测试）。本模块的
 * `zombieOnly` 筛选又需要一次 SQL 条件，于是这里出现第三处——所以
 * `account-admin.test.ts` 里有一条判据把「本函数的僵尸集合」与 `findZombieAccounts` 的 id
 * 集合**逐值相等**地钉在一起。改一边不改另一边会红，而不是靠人记得同时改三处。
 *
 * ## 两件刻意不做的事
 *
 * - **列表项不吐证件号 / 手机号 / 密码哈希**：前两项只在详情出口给（管理员核实身份时才要），
 *   后者任何出口都不给。每页 50 行地把 PII 送到前端没有用处。
 * - **统计不受搜索 / 筛选影响**：顶部两张卡说的是「注册总数 / 启用数」，是**全库口径**；
 *   `matched` 才是「当前筛选命中多少行」。两者混用会让管理员以为「一搜就少了人」。
 */

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "./migrate"
import { ZOMBIE_INACTIVE_DAYS } from "./policy"

/** 只用到 `execute`——与 `GrantTarget` 同形。PGlite 与 bun-sql 两种驱动都满足。 */
export interface AccountQueryTarget {
  execute(query: SQL): PromiseLike<unknown>
}

/** 一页 50 行（DESIGN §4.11.3）。上限挡住「pageSize=100000」把整表一次拉走。 */
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

const SECONDS_PER_DAY = 24 * 60 * 60
const ENABLED = 1

/** 列表一项：**只含表格要用的列**（见文件头「两件刻意不做的事」）。时间一律 Unix 秒。 */
export interface AccountListItem {
  readonly id: string
  readonly policeNo: string
  readonly name: string
  readonly org: string
  readonly dept: string
  readonly section: string
  readonly status: number
  readonly isAdmin: number
  readonly lastLoginAt: number | null
  readonly lastActiveAt: number | null
  readonly createdAt: number
  readonly deactivatedAt: number | null
}

/** 详情：列表项的列 ＋ 两项 PII（管理员核实身份用）。仍然没有密码哈希。 */
export interface AccountDetail extends AccountListItem {
  readonly idCard: string
  readonly phone: string
}

export interface AccountQuery {
  /** 子串搜索：警号 / 姓名 / 单位 / 部门 / 科室，不区分大小写。 */
  readonly q?: string
  /** 精确状态过滤（1 启用 / 0 停用）。省略 = 不筛。 */
  readonly status?: 0 | 1
  /** 仅看僵尸账户（启用且 90 天未活跃）。 */
  readonly zombieOnly?: boolean
  readonly page?: number
  readonly pageSize?: number
  /** 当前时刻（Unix 秒）。显式传入让「恰好 90 天」的边界用例可复现。 */
  readonly now?: number
}

export interface AccountList {
  /** 注册总数（全库，**不受**搜索 / 筛选影响）。 */
  readonly total: number
  /** 启用总数（全库，同上）。 */
  readonly enabled: number
  /** 当前筛选命中的行数（分页前）——前端用它算总页数。 */
  readonly matched: number
  readonly page: number
  readonly pageSize: number
  readonly items: readonly AccountListItem[]
}

const 列表列 = sql`id, police_no, name, org, dept, section, status, is_admin,
  last_login_at, last_active_at, created_at, deactivated_at`

/**
 * 搜索词里的 `%` / `_` / `\` 当**字面量**。
 *
 * 不转义的话，管理员搜一个 `%` 就命中全库（「怎么搜谁都出来」）；更糟的是 `_` 会静默
 * 匹配任意单字符，管理员以为搜了「0_1」其实搜了三种警号。PG 的 `ilike` 默认转义符是
 * 反斜杠，所以只需把这三个字符自己加上反斜杠。
 */
function 转义通配符(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** 把越界值夹回合法区间（`NaN` / 省略走默认值）。 */
function 夹(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * 筛条件。**SQL 里不拼接用户输入**——`q` 只以参数形式进 `ilike`（转义见上）。
 *
 * 僵尸条件与 `findZombieAccounts` 的取行条件**逐字同义**（`status = 1` ＋ 三级回退的
 * `coalesce`），对账测试守着两份不漂（文件头「僵尸判定」）。
 */
function 筛条件(query: AccountQuery, now: number): SQL[] {
  const 条件: SQL[] = []

  const q = query.q?.trim() ?? ""
  if (q) {
    const pattern = `%${转义通配符(q)}%`
    条件.push(sql`(
      police_no ilike ${pattern} or name ilike ${pattern} or org ilike ${pattern}
      or dept ilike ${pattern} or section ilike ${pattern}
    )`)
  }

  if (query.status !== undefined) 条件.push(sql`status = ${query.status}`)

  if (query.zombieOnly) {
    条件.push(
      sql`status = ${ENABLED} and coalesce(last_active_at, last_login_at, created_at) < ${
        now - ZOMBIE_INACTIVE_DAYS * SECONDS_PER_DAY
      }`,
    )
  }

  return 条件
}

/** 列一页账号 ＋ 三个计数。 */
export async function listAccounts(
  db: AccountQueryTarget,
  query: AccountQuery = {},
): Promise<AccountList> {
  const now = query.now ?? Math.floor(Date.now() / 1000)
  const page = 夹(query.page, 1, Number.MAX_SAFE_INTEGER, 1)
  const pageSize = 夹(query.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)

  const 条件 = 筛条件(query, now)
  const where = 条件.length > 0 ? sql` where ${sql.join(条件, sql` and `)}` : sql``

  // 全局统计与筛选命中数**分两条**：统计不挂 `where`（文件头最后一条）。
  const stats = rowsOf(
    await db.execute(sql`
      select count(*)::int as total,
             count(*) filter (where status = ${ENABLED})::int as enabled
      from auth.user
    `),
  )[0]
  const matched = rowsOf(await db.execute(sql`select count(*)::int as matched from auth.user${where}`))[0]

  // 两条 `count(*)` 都恒返回一行；读不到只可能是驱动语义变了 —— 那该炸，不静默报 0。
  if (!stats || !matched) throw new Error("账号计数查询没有返回行")

  const rows = rowsOf(
    await db.execute(sql`
      select ${列表列}
      from auth.user${where}
      order by police_no asc
      limit ${pageSize} offset ${(page - 1) * pageSize}
    `),
  )

  return {
    total: 数值(stats, "total"),
    enabled: 数值(stats, "enabled"),
    matched: 数值(matched, "matched"),
    page,
    pageSize,
    items: rows.map(列表项),
  }
}

/** 单个账号的详情（含证件号与手机号）。未知 id 回 `undefined`。 */
export async function accountById(
  db: AccountQueryTarget,
  id: string,
): Promise<AccountDetail | undefined> {
  const [row] = rowsOf(
    await db.execute(sql`
      select ${列表列}, id_card, phone
      from auth.user
      where id = ${id}
    `),
  )
  if (!row) return undefined
  return { ...列表项(row), idCard: 文本(row, "id_card"), phone: 文本(row, "phone") }
}

function 列表项(row: Record<string, unknown>): AccountListItem {
  return {
    id: 文本(row, "id"),
    policeNo: 文本(row, "police_no"),
    name: 文本(row, "name"),
    org: 文本(row, "org"),
    dept: 文本(row, "dept"),
    section: 文本(row, "section"),
    status: 数值(row, "status"),
    isAdmin: 数值(row, "is_admin"),
    lastLoginAt: 可空数值(row, "last_login_at"),
    lastActiveAt: 可空数值(row, "last_active_at"),
    createdAt: 数值(row, "created_at"),
    deactivatedAt: 可空数值(row, "deactivated_at"),
  }
}

/**
 * 列值的读取是**严格**的：形状不对就抛，不静默给 `""` / `0`。
 *
 * 静默兜底的后果不是崩溃而是**错数据**——一个 `null` 姓名画成空行，管理员看不出是库坏了。
 * 这里的列都由本模块的 SQL 选定，类型是确定的；读不到只可能是驱动语义变了，那该炸。
 */
function 文本(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`账号表的 ${key} 不是字符串：${String(value)}`)
  return value
}

function 数值(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`账号表的 ${key} 不是数字：${String(value)}`)
  }
  return value
}

function 可空数值(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`账号表的 ${key} 不是数字或 NULL：${String(value)}`)
  }
  return value
}
