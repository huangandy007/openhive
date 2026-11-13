export * as OpenhiveCaseFactRead from "./case-fact-read"

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { type 变更视图, type 留痕类型, 变更历史 } from "./case-fact-change"
import { 文本数组, type 事实信任态 } from "./case-fact-store"
import type { Queryable } from "./case-store"

/**
 * 单条事实的详情（设计 §9.2 的「详情页」背后那个出口）。
 *
 * ## 为什么只有「单条」
 *
 * 「材料 → 按行分组的全部事实」是计划 7 的「抽取结果」标签页要的形状，它由中栏定；
 * 现在先写一份半成品，会让那边拿到两个版本。实体清单同理（计划 7）。
 *
 * ## 数值列读回来可能是字符串
 *
 * `numeric(18,2)` 在 bun-sql 上是字符串、在 PGlite 上可能是数字。`数字()` 两种都收，
 * **读成不是数字就抛**——错数字比没数字害人（设计 §7.4 同一句话）。
 *
 * ## 数组列一律走 `array_to_json(...)::text`
 *
 * `text[]` 在两个驱动上的读回形状没有先例可依（`case-fact-store.ts` 的 `文本数组`
 * 那条注释写过同一件事）。转成 JSON 文本再解析，形状与驱动无关。
 */

export interface 引用视图 {
  readonly id: string
  readonly materialId: string
  readonly fileName: string | null
  readonly path: string | null
  readonly locator: unknown
  readonly extractMethod: "机器" | "人工"
  readonly confidence: number | null
}

export interface 实体详情 {
  readonly type: "entity"
  readonly id: string
  readonly entityType: string
  readonly canonicalValue: string
  readonly aliases: string[]
  readonly attrs: unknown
  readonly trustState: 事实信任态
  readonly basisChangedAt: number | null
  readonly createdAt: number
}

export interface 关系详情 {
  readonly type: "relation"
  readonly id: string
  readonly fromId: string
  readonly toId: string
  readonly fromValue: string | null
  readonly fromEntityType: string | null
  readonly toValue: string | null
  readonly toEntityType: string | null
  readonly relationType: string
  readonly amount: number | null
  readonly basis: string | null
  readonly sourceKind: "data" | "human"
  readonly times: number | null
  readonly firstAt: number | null
  readonly lastAt: number | null
  readonly precision: string | null
  readonly trustState: 事实信任态
  readonly basisChangedAt: number | null
  readonly createdAt: number
}

export interface 事件详情 {
  readonly type: "event"
  readonly id: string
  readonly eventType: string
  readonly occurredAt: number | null
  readonly occurredRaw: string | null
  readonly precision: string | null
  readonly timeType: string | null
  readonly participants: string[]
  readonly summary: string | null
  readonly trustState: 事实信任态
  readonly basisChangedAt: number | null
  readonly createdAt: number
}

export type 事实 = 实体详情 | 关系详情 | 事件详情

export interface 详情附加 {
  readonly citations: 引用视图[]
  readonly changes: 变更视图[]
}

export type 事实详情 = 事实 & 详情附加

function 文本(值: unknown): string | null {
  return 值 === null || 值 === undefined ? null : String(值)
}

function 数字(值: unknown): number | null {
  if (值 === null || 值 === undefined) return null
  const n = Number(值)
  if (!Number.isFinite(n)) throw new Error(`数值列读回的不是数字：${String(值)}`)
  return n
}

function 整数(值: unknown): number | null {
  const n = 数字(值)
  if (n === null) return null
  if (!Number.isInteger(n)) throw new Error(`整数列读回的不是整数：${String(值)}`)
  return n
}

/** `array_to_json(...)::text` 读回来一定是 JSON 文本；解不开就是空数组（不猜）。 */
function 文本组(值: unknown): string[] {
  if (typeof 值 !== "string" || 值 === "") return []
  try {
    const 解: unknown = JSON.parse(值)
    return Array.isArray(解) ? 解.map((x) => String(x)) : []
  } catch {
    return []
  }
}

/**
 * jsonb 读回：只解「二次编码的旧对象/数组」（字符串以 `{` / `[` 开头），其余原样返回。
 * 不做无条件的 `JSON.parse`——那会把真标量 `"123"` 变成数字、`"null"` 变成 null（Task 1 R4）。
 */
function 读杰森(值: unknown): unknown {
  if (typeof 值 !== "string" || !(值.startsWith("{") || 值.startsWith("["))) return 值 ?? null
  try {
    return JSON.parse(值)
  } catch {
    return 值
  }
}

async function 读实体(
  db: Queryable,
  projectId: string,
  id: string,
  包含已排除: boolean,
): Promise<实体详情 | undefined> {
  const 行 = rowsOf(
    await db.execute(sql`
      select e.id, e.type, e.canonical_value, array_to_json(e.aliases)::text as aliases,
             e.attrs, e.trust_state, e.created_at
        from auth.case_entity e
       where e.project_id = ${projectId} and e.id = ${id}
         and (${包含已排除} or e.trust_state <> '已排除')
    `),
  )[0]
  if (行 === undefined) return undefined
  return {
    type: "entity",
    id: String(行.id),
    entityType: String(行.type),
    canonicalValue: String(行.canonical_value),
    aliases: 文本组(行.aliases),
    attrs: 读杰森(行.attrs),
    trustState: String(行.trust_state) as 事实信任态,
    basisChangedAt: null,
    createdAt: Number(行.created_at),
  }
}

async function 读关系(
  db: Queryable,
  projectId: string,
  id: string,
  包含已排除: boolean,
): Promise<关系详情 | undefined> {
  const 行 = rowsOf(
    await db.execute(sql`
      select r.id, r.from_id, r.to_id, r.type, r.amount, r.basis, r.source_kind, r.times,
             r.first_at, r.last_at, r.precision, r.trust_state, r.basis_changed_at, r.created_at,
             f.canonical_value as from_value, f.type as from_type,
             t.canonical_value as to_value, t.type as to_type
        from auth.case_relation r
        left join auth.case_entity f on f.project_id = r.project_id and f.id = r.from_id
        left join auth.case_entity t on t.project_id = r.project_id and t.id = r.to_id
       where r.project_id = ${projectId} and r.id = ${id}
         and (${包含已排除} or r.trust_state <> '已排除')
    `),
  )[0]
  if (行 === undefined) return undefined
  return {
    type: "relation",
    id: String(行.id),
    fromId: String(行.from_id),
    toId: String(行.to_id),
    fromValue: 文本(行.from_value),
    fromEntityType: 文本(行.from_type),
    toValue: 文本(行.to_value),
    toEntityType: 文本(行.to_type),
    relationType: String(行.type),
    amount: 数字(行.amount),
    basis: 文本(行.basis),
    sourceKind: String(行.source_kind) as "data" | "human",
    times: 整数(行.times),
    firstAt: 整数(行.first_at),
    lastAt: 整数(行.last_at),
    precision: 文本(行.precision),
    trustState: String(行.trust_state) as 事实信任态,
    basisChangedAt: 整数(行.basis_changed_at),
    createdAt: Number(行.created_at),
  }
}

async function 读事件(
  db: Queryable,
  projectId: string,
  id: string,
  包含已排除: boolean,
): Promise<事件详情 | undefined> {
  const 行 = rowsOf(
    await db.execute(sql`
      select e.id, e.type, e.occurred_at, e.occurred_raw, e.precision, e.time_type,
             array_to_json(e.participants)::text as participants, e.summary,
             e.trust_state, e.basis_changed_at, e.created_at
        from auth.case_event e
       where e.project_id = ${projectId} and e.id = ${id}
         and (${包含已排除} or e.trust_state <> '已排除')
    `),
  )[0]
  if (行 === undefined) return undefined
  return {
    type: "event",
    id: String(行.id),
    eventType: String(行.type),
    occurredAt: 整数(行.occurred_at),
    occurredRaw: 文本(行.occurred_raw),
    precision: 文本(行.precision),
    timeType: 文本(行.time_type),
    participants: 文本组(行.participants),
    summary: 文本(行.summary),
    trustState: String(行.trust_state) as 事实信任态,
    basisChangedAt: 整数(行.basis_changed_at),
    createdAt: Number(行.created_at),
  }
}

/** 引用查询的唯一出处（`引用们` 单人 / `批量引用` 批量都走它，`#002-06`）。 */
async function 查引用(
  db: Queryable,
  projectId: string,
  factType: 留痕类型,
  范围: SQL,
  上限?: number,
): Promise<{ 行们: (引用视图 & { factId: string })[]; 总数: number }> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select c.id, c.fact_id, c.material_id, c.locator, c.extract_method, c.confidence,
             m.file_name, m.path, count(*) over() as 总数
        from auth.case_citation c
        left join auth.case_material m on m.project_id = c.project_id and m.id = c.material_id
       where c.project_id = ${projectId} and c.fact_type = ${factType} and ${范围}
       order by c.created_at asc, c.id asc
       ${上限 === undefined ? sql`` : sql`limit ${上限}`}
    `),
  )
  const 总数 = Number(行们[0]?.总数 ?? 0)
  return {
    总数,
    行们: 行们.map((行) => ({
      factId: String(行.fact_id),
      id: String(行.id),
      materialId: String(行.material_id),
      fileName: 文本(行.file_name),
      path: 文本(行.path),
      locator: 读杰森(行.locator),
      extractMethod: String(行.extract_method) as "机器" | "人工",
      confidence: 数字(行.confidence),
    })),
  }
}

/**
 * 这条事实的出处：按时间正序。材料被删过时 `fileName/path` 为 null（引用不悬空、也不猜）。
 *
 * `上限` 缺省 = 不截断（`事实详情` / MCP 出口要全量）；给了就只取前 N 条，`总数` **仍是全量**
 * （`count(*) over()` 在 LIMIT 之前算）。截断与总数由调用方决定怎么说，这里只管取。
 *
 * ⚠️ 别在调用点另写一份引用查询（`#002-06`）：`已排除` 那类判据一旦分叉就会漂。
 */
export async function 引用们(
  db: Queryable,
  projectId: string,
  factType: 留痕类型,
  factId: string,
  上限?: number,
): Promise<{ 行们: 引用视图[]; 总数: number }> {
  const { 行们, 总数 } = await 查引用(db, projectId, factType, sql`c.fact_id = ${factId}`, 上限)
  return { 总数, 行们: 行们.map(({ factId: _factId, ...行 }) => 行) }
}

/** 一批事实的引用（时间线一页一次拿全，按 `created_at, id` 正序）。 */
export async function 批量引用(
  db: Queryable,
  projectId: string,
  factType: 留痕类型,
  factIds: readonly string[],
): Promise<Map<string, 引用视图[]>> {
  if (factIds.length === 0) return new Map()
  const { 行们 } = await 查引用(db, projectId, factType, sql`c.fact_id = any(${文本数组([...factIds])})`)
  const 按事实 = new Map<string, 引用视图[]>()
  for (const { factId, ...行 } of 行们) {
    const 列 = 按事实.get(factId)
    if (列 === undefined) 按事实.set(factId, [行])
    else 列.push(行)
  }
  return 按事实
}

export interface 事实详情入参 {
  readonly projectId: string
  readonly type: 留痕类型
  readonly id: string
  /** 默认 false：已排除的事实「可切换查看」，不是默认可见（§9.1 / R10）。 */
  readonly includeExcluded?: boolean
}

/**
 * 一条事实的完整画像。找不到（或已排除且没要求包含）⇒ `undefined`。
 *
 * 三个读必须是**同一个库句柄**：调用方给事务就给事务，给连接就给连接。
 */
export async function 事实详情(db: Queryable, input: 事实详情入参): Promise<事实详情 | undefined> {
  const 包含已排除 = input.includeExcluded === true
  const 事实 =
    input.type === "entity"
      ? await 读实体(db, input.projectId, input.id, 包含已排除)
      : input.type === "relation"
        ? await 读关系(db, input.projectId, input.id, 包含已排除)
        : await 读事件(db, input.projectId, input.id, 包含已排除)
  if (事实 === undefined) return undefined
  // ⚠️ 两条查询必须**顺序**跑，不能用 `Promise.all`：PGlite 把多条连接汇进同一个 PG 会话，
  // 单连接下并发查同一会话会撞 42P05（仓内约定见 `assets.ts:259` / `governance-assets.ts:264`）。
  const { 行们: citations } = await 引用们(db, input.projectId, input.type, input.id)
  const changes = await 变更历史(db, input.projectId, input.type, input.id)
  return { ...事实, citations, changes }
}
