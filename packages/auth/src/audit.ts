export * as Audit from "./audit"

/**
 * 治理审计流水（010 T010 / FR-009 / SC-003）。
 *
 * ## 为什么这个 feature 必须自己建这张表
 *
 * 010 的 plan 写「F4 已埋 AccessDenied 审计点」——**不实**：004 的 T006/T012 明确记
 * 「审计（留痕）未做，用户裁定挂账、**落点 F10**」（`004-access-control/tasks.md:135`、
 * `:259`）。所以在 T010 开工时，全仓没有任何通用审计存储，403 只是一个 `return`。
 * 本模块 + `migrations/0015_audit_event.sql` 就是那笔挂账的偿还。
 *
 * 记账对象是「**写动作** ＋ **全部拒绝**」：谁、何时、在哪个板块、调了什么、结果如何。
 * 治理的**读**动作不记——「谁看了列表」会让审计淹没在噪音里，而 FR-009 说的是「调了什么」。
 *
 * ## 只增不改
 *
 * 这里**没有** update / delete 函数，也不打算有。审计可以被改 = 审计不存在；
 * 这条纪律靠「不写写入函数」守住，不靠权限（DESIGN §4.11.7：无编辑 / 删除入口）。
 *
 * ## 写失败不让业务失败 —— 但**必须留日志**
 *
 * `recordAuditEvent` 会**抛**（存储层就该抛，测试要能看见），是否吞掉由调用方决定：
 * 治理路由用 `server/openhive/audit.ts` 的 `记治理`，工具拒绝用
 * `src/permission/openhive-audit-denied.ts`，两者都 catch ＋ `console.warn`
 * （同 `backup.ts` 的 `记审计`，spec §5.6 / §9.3 的既有口径）。
 *
 * ## 时间单位
 *
 * 一律 **Unix 秒**（`src/time.ts`）。`occurred_at` 是 int4，毫秒会直接溢出。
 *
 * ## 姓名是快照
 *
 * `actor_name` / `actor_police_no` 写入时取值、之后不再 join `auth.user`。理由见迁移注释：
 * 账号被清理后审计仍要能回答「谁」；join 出来的人名会静默变成空白。
 * 代价：改名后旧行仍是旧名——审计记的是**当时**那个人，这是对的行为。
 */

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "./migrate"
import { nowSeconds } from "./time"

/** 本表只认 `execute(query)` 的窄目标（同 `ProjectMemberTarget` / `GrantTarget`）。 */
export interface AuditTarget {
  execute(query: SQL): PromiseLike<unknown>
}

/** 结局闭集：与迁移的 CHECK 逐字相同。 */
export const AUDIT_RESULTS = ["ok", "failed", "denied"] as const
export type AuditResult = (typeof AUDIT_RESULTS)[number]

/**
 * 动作词表（TS 侧闭集，DB 不加 CHECK —— 理由见迁移注释）。
 *
 * 命名是 `域.动词`：域与治理板块一一对应（`tool` 是工具越权，`governance` 是板块准入拒绝）。
 * 前端「动作」筛选下拉直接读这份常量，避免文案在两端各写一份。
 */
export const AUDIT_ACTIONS = [
  "account.create",
  "account.reset_password",
  "account.disable",
  "account.enable",
  "account.batch_disable",
  "org.create",
  "org.rename",
  "org.delete",
  "org.import",
  "asset.transition",
  "project.remove_member",
  "project.archive",
  "template.create",
  "template.update",
  "template.disable",
  "data-source.create",
  "data-source.update",
  "tool.denied",
  "governance.denied",
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditEventInput {
  readonly actorId: string
  readonly actorName: string
  readonly actorPoliceNo: string
  /** 治理板块 id；工具越权没有板块 ⇒ null。 */
  readonly board?: string | null
  readonly action: string
  readonly targetType?: string | null
  readonly targetId?: string | null
  readonly result: AuditResult
  /** 给人看/给检索用的结构化补充（**绝不放密码/口令**）。 */
  readonly detail?: Record<string, unknown> | null
  /** 测试注入用；缺省为当前秒。 */
  readonly occurredAt?: number
}

export interface AuditRow {
  readonly id: number
  readonly occurred_at: number
  readonly actor_id: string
  readonly actor_name: string
  readonly actor_police_no: string
  readonly board: string | null
  readonly action: string
  readonly target_type: string | null
  readonly target_id: string | null
  readonly result: string
  readonly detail: Record<string, unknown>
}

export interface AuditQuery {
  /** 窗口 `[from, to)`，Unix 秒。 */
  readonly from?: number
  readonly to?: number
  /** 姓名或警号的**子串**（`%` / `_` 按字面量处理）。 */
  readonly actor?: string
  readonly action?: string
  readonly result?: AuditResult
  /** 对象 id 或 detail 文本的子串。 */
  readonly q?: string
  readonly page?: number
  readonly pageSize?: number
}

export interface AuditPage {
  /** 筛选后的**总行数**（不受分页影响）。 */
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly items: readonly AuditRow[]
}

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

/** 写一行审计。**会抛** —— 吞不吞由调用方决定（见文件头）。 */
export async function recordAuditEvent(target: AuditTarget, event: AuditEventInput): Promise<void> {
  await target.execute(sql`
    INSERT INTO auth.audit_event
      (occurred_at, actor_id, actor_name, actor_police_no, board, action, target_type, target_id, result, detail)
    VALUES (${event.occurredAt ?? nowSeconds()}, ${event.actorId}, ${event.actorName}, ${event.actorPoliceNo},
            ${event.board ?? null}, ${event.action}, ${event.targetType ?? null}, ${event.targetId ?? null},
            ${event.result}, ${JSON.stringify(event.detail ?? {})})
  `)
}

/**
 * 检索。窗口 `[from, to)`；排序 `occurred_at DESC, id DESC`（同秒按写入顺序倒序，翻页不重不漏）。
 *
 * `total` 与 `items` 用**同一组筛选条件**：只把 limit/offset 加在 items 上——`total` 若忘了带
 * 筛选，翻页器会显示一个比实际大得多的总数，而且看起来「只是有点怪」。
 */
export async function listAuditEvents(target: AuditTarget, query: AuditQuery = {}): Promise<AuditPage> {
  const page = 正整数(query.page) ?? 1
  const pageSize = Math.min(正整数(query.pageSize) ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  const 条件 = 筛选(query)
  const where = 条件.length === 0 ? sql`` : sql` WHERE ${sql.join(条件, sql` AND `)}`

  const totalRow = await target.execute(sql`SELECT count(*) AS total FROM auth.audit_event${where}`)
  const total = Number(rowsOf(totalRow)[0]?.total ?? 0)

  const rows = await target.execute(sql`
    SELECT id, occurred_at, actor_id, actor_name, actor_police_no, board, action, target_type, target_id, result, detail
    FROM auth.audit_event${where}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `)
  return { total, page, pageSize, items: rowsOf(rows).map(toRow) }
}

function 筛选(query: AuditQuery): SQL[] {
  const 条件: SQL[] = []
  if (query.from !== undefined) 条件.push(sql`occurred_at >= ${query.from}`)
  if (query.to !== undefined) 条件.push(sql`occurred_at < ${query.to}`)
  if (query.action) 条件.push(sql`action = ${query.action}`)
  if (query.result) 条件.push(sql`result = ${query.result}`)
  const 人 = 模糊(query.actor)
  if (人) 条件.push(sql`(actor_name ILIKE ${人} OR actor_police_no ILIKE ${人})`)
  const 关键词 = 模糊(query.q)
  if (关键词) 条件.push(sql`(target_id ILIKE ${关键词} OR detail ILIKE ${关键词})`)
  return 条件
}

/**
 * 子串模式，`%` / `_` / `\` 一律转义成字面量。
 *
 * 不转义的后果不是「模糊一点」：管理员在关键词框里输入一个 `%` 就会翻出**全部**审计行，
 * 而结果看起来完全正常。PostgreSQL 的 ILIKE 默认转义符就是反斜杠，所以这里只需转义、不必写 ESCAPE。
 */
function 模糊(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === "") return null
  return `%${trimmed.replace(/[\\%_]/g, (char) => "\\" + char)}%`
}

function 正整数(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
}

function toRow(row: Record<string, unknown>): AuditRow {
  return {
    id: Number(row.id),
    occurred_at: Number(row.occurred_at),
    actor_id: String(row.actor_id),
    actor_name: String(row.actor_name),
    actor_police_no: String(row.actor_police_no),
    board: 文本(row.board),
    action: String(row.action),
    target_type: 文本(row.target_type),
    target_id: 文本(row.target_id),
    result: String(row.result),
    detail: 解析(row.detail),
  }
}

function 文本(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/**
 * `detail` 是我们自己写的 JSON 文本。解析失败时**原样**交给调用方（`{ raw }`）而不是丢掉：
 * 一行审计的可读性比形状整齐重要——将来手工修过库，也要能在界面上看到那一行到底存了什么。
 */
function 解析(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value === "") return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return 是对象(parsed) ? parsed : { raw: parsed }
  } catch {
    return { raw: value }
  }
}

/** 类型谓词而不是 `as`：解析出来的 `unknown` 只有这一处判据，别让它变成一句断言。 */
function 是对象(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
