export * as Analytics from "./analytics"

import { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { dataRoot, userDatabasePath } from "@opencode-ai/core/database/router"
import { EventManifest } from "@/event-manifest"

/**
 * 分析库（010 T004 / FR-008）：从**每用户 SQLite 的 event 表**增量抽取 `step.ended`，
 * 落成一张可聚合的用量/成本事实表，供 T009 的看板读。
 *
 * ## 为什么是「抽取 + 事实表」而不是每次直接扫每用户库
 *
 * 每用户库是事件溯源（`event` 表只有 `(aggregate_id, seq)` 与 `(aggregate_id, type, seq)`
 * 两个索引），按 `type` 过滤就是全表扫。看板每次打开都扫全部用户库 = 成本随历史线性增长。
 * 抽取后只扫一次历史，之后按游标只读新事件。
 *
 * ## 三个守住正确性的关键点
 *
 * 1. **幂等**：主键 `(user_id, event_id)` + `INSERT OR IGNORE`。重复抽取不会翻倍；
 *    游标最后写，中途失败时下一次重扫同一批事件也只是被忽略。
 * 2. **游标**：按事件 id 升序（`evt_` 前 12 位是时间 + counter，字典序 = 时间序）。
 *    **只扫 `id > 游标`**，否则每次都是全量。
 * 3. **模型归属**：`step.ended` 的载荷里**没有模型**，模型在 `step.started` 上（按
 *    `assistantMessageID` 关联）。同一批里用映射表；started 在**上一轮**已过游标时，
 *    回查源库补——否则跨轮的长步骤会全部记成「未知模型」。
 *
 * ## 版本不写死
 *
 * `type` 存的是 `versionedType(type, durable.version)`（如 `session.next.step.ended.2`）。
 * 这里从 `EventManifest.Durable` 按前缀**派生**全部版本，上游 bump 版本后自动跟随；
 * 写死 `.2` 会在同步上游后静默漏采（`LEARNINGS #002-06`）。
 *
 * ## 组织口径
 *
 * `org` 由调用方传入（生产侧从 `auth.user` 读），**抽取时快照**进事实行。分析库因此不依赖
 * auth 包；代价是组织调整不追溯历史（见 010/state.md 的缺口）。
 *
 * ## 没有调度器
 *
 * v1 不造后台任务：暴露 `extractUser` / `extractAll`，由 T009 的读接口在查询前调用。
 * 同步 SQLite 调用会占住事件循环，MVP 规模可接受，接线时记风险。
 */

export const ANALYTICS_DB_ENV = "OPENHIVE_ANALYTICS_DB"
const ANALYTICS_FILENAME = "analytics.db"

/**
 * 分析库文件路径：`OPENHIVE_ANALYTICS_DB` 优先，否则落在数据根下的 `analytics.db`。
 *
 * 不放 `{root}/{userId}/` 里：分析库是**全系统共用**的，混进用户目录会与 `userId` 撞名；
 * 放数据根下与 `{userId}/` 子目录平级，互不干扰。
 */
export function analyticsPath(env: Record<string, string | undefined>): string {
  return env[ANALYTICS_DB_ENV] || join(dataRoot(env), ANALYTICS_FILENAME)
}

export interface Store {
  readonly db: Database
  close(): void
}

/**
 * 打开（必要时创建）分析库。**自建最小 schema**，不跑 opencode 的 `Database.layerFromPath`
 * ——那会在分析库里建出上百张无关表，还会引入整套迁移依赖。
 */
export function open(path: string): Store {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const db = new Database(path, { create: true })
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec(SCHEMA)
  return { db, close: () => db.close() }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_fact (
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  model_id TEXT,
  provider_id TEXT,
  org TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  cost REAL NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  extracted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS usage_fact_occurred_at ON usage_fact(occurred_at);
CREATE TABLE IF NOT EXISTS analytics_cursor (
  user_id TEXT PRIMARY KEY,
  last_event_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`

const STARTED_PREFIX = "session.next.step.started."
const ENDED_PREFIX = "session.next.step.ended."

/** 源库里可能出现的全部 durable 键（跨版本）。空集说明上游改了命名，宁可起不来也别静默漏采。 */
export const STARTED_TYPES: readonly string[] = Object.freeze(
  [...EventManifest.Durable.keys()].filter((key) => key.startsWith(STARTED_PREFIX)),
)
export const ENDED_TYPES: readonly string[] = Object.freeze(
  [...EventManifest.Durable.keys()].filter((key) => key.startsWith(ENDED_PREFIX)),
)
if (STARTED_TYPES.length === 0 || ENDED_TYPES.length === 0) {
  throw new Error(
    `分析库找不到 step 事件的 durable 定义（started=${STARTED_TYPES.length} ended=${ENDED_TYPES.length}）`,
  )
}

interface ModelRef {
  readonly id: string
  readonly providerID: string
}

interface Fact {
  readonly sessionID: string
  readonly assistantMessageID: string
  readonly occurredAt: number
  readonly cost: number
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

export interface ExtractUserInput {
  readonly analytics: Database
  readonly sourcePath: string
  readonly userId: string
  readonly org: string
  readonly now?: number
}

export interface ExtractUserResult {
  readonly scanned: number
  readonly inserted: number
  readonly skipped: number
  readonly cursor: string | null
  /** 源库不存在 / 还没建 event 表。跳过不算失败——新用户第一次登录前就是没有库。 */
  readonly missing: boolean
}

/**
 * 抽取一个用户的新事件。**同步**，调用方决定何时触发。
 *
 * 源库以普通读写方式打开（不是 `readonly`）：WAL 库在 `-shm` 不存在时只读打开会失败，
 * 而这里只跑 SELECT。先 `existsSync` 挡住「打开就建出一个空库」。
 */
export function extractUser(input: ExtractUserInput): ExtractUserResult {
  const now = input.now ?? Date.now()
  const none: ExtractUserResult = { scanned: 0, inserted: 0, skipped: 0, cursor: null, missing: true }
  if (!existsSync(input.sourcePath)) return none

  const source = new Database(input.sourcePath)
  try {
    const hasEvent = source.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event'").get()
    if (!hasEvent) return none

    const cursorRow = input.analytics
      .query<{ last_event_id: string }, [string]>("SELECT last_event_id FROM analytics_cursor WHERE user_id = ?")
      .get(input.userId)
    const previous = cursorRow?.last_event_id ?? null

    const types = [...STARTED_TYPES, ...ENDED_TYPES]
    const rows = source
      .query<{ id: string; type: string; data: string }, string[]>(
        `SELECT id, type, data FROM event WHERE id > ? AND type IN (${types.map(() => "?").join(", ")}) ORDER BY id ASC`,
      )
      .all(previous ?? "", ...types)

    const models = new Map<string, ModelRef>()
    const insert = input.analytics.query(`
      INSERT OR IGNORE INTO usage_fact (
        user_id, event_id, session_id, assistant_message_id, model_id, provider_id, org,
        occurred_at, cost, input_tokens, output_tokens, reasoning_tokens,
        cache_read_tokens, cache_write_tokens, extracted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    let inserted = 0
    let skipped = 0
    for (const row of rows) {
      const data = record(row.data)
      if (STARTED_TYPES.includes(row.type)) {
        const messageID = text(data?.assistantMessageID)
        const model = modelOf(data?.model)
        if (messageID && model) models.set(messageID, model)
        continue
      }

      const fact = toFact(data)
      if (!fact) {
        skipped++
        continue
      }
      const model = models.get(fact.assistantMessageID) ?? lookupModel(source, fact.assistantMessageID)
      const result = insert.run(
        input.userId,
        row.id,
        fact.sessionID,
        fact.assistantMessageID,
        model?.id ?? null,
        model?.providerID ?? null,
        input.org,
        fact.occurredAt,
        fact.cost,
        fact.input,
        fact.output,
        fact.reasoning,
        fact.cacheRead,
        fact.cacheWrite,
        now,
      )
      if (result.changes > 0) inserted++
    }

    // 游标最后写：中途抛错时下一次重扫，INSERT OR IGNORE 兜住幂等。
    const advanced = rows.length > 0 ? rows[rows.length - 1].id : previous ?? ""
    input.analytics
      .query(
        `INSERT INTO analytics_cursor (user_id, last_event_id, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET last_event_id = excluded.last_event_id, updated_at = excluded.updated_at`,
      )
      .run(input.userId, advanced, now)

    return { scanned: rows.length, inserted, skipped, cursor: advanced, missing: false }
  } finally {
    source.close()
  }
}

export interface ExtractAllInput {
  readonly analytics: Database
  readonly dataRoot: string
  readonly users: ReadonlyArray<{ readonly id: string; readonly org: string }>
  readonly now?: number
}

export interface ExtractAllResult {
  readonly scanned: number
  readonly inserted: number
  readonly skipped: number
  readonly missing: readonly string[]
}

/** 全量扫一遍。缺库的用户进 `missing`，不影响其他用户。 */
export function extractAll(input: ExtractAllInput): ExtractAllResult {
  let scanned = 0
  let inserted = 0
  let skipped = 0
  const missing: string[] = []
  for (const user of input.users) {
    const result = extractUser({
      analytics: input.analytics,
      sourcePath: userDatabasePath(input.dataRoot, user.id),
      userId: user.id,
      org: user.org,
      now: input.now,
    })
    scanned += result.scanned
    inserted += result.inserted
    skipped += result.skipped
    if (result.missing) missing.push(user.id)
  }
  return { scanned, inserted, skipped, missing }
}

/**
 * 分组维度。`user` 是 T009 加的（FR-008 的「**谁**调了多少」）——纯增量：键是 `user_id`，
 * 姓名由调用方翻（分析库不依赖 auth，见文件头「组织口径」）。
 */
export type GroupBy = "org" | "model" | "user"

export interface ReportInput {
  readonly analytics: Database
  /** 窗口为左闭右开 `[from, to)`，单位毫秒（与事件载荷的 timestamp 同口径）。 */
  readonly from: number
  readonly to: number
  readonly groupBy: GroupBy
}

export interface ReportRow {
  readonly key: string
  readonly calls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cost: number
}

export interface Report {
  /** 分析库是否抽取过（哪怕抽出来 0 行）：false ⇒ 看板显示「—」而不是 0。 */
  readonly collected: boolean
  /** 分析库水位 = 最近一次抽取完成的时间（毫秒）。 */
  readonly watermark: number | null
  readonly metrics: {
    readonly calls: number
    /** **口径 = 输入 + 输出**；reasoning / cache 不重复计入。 */
    readonly totalTokens: number
    readonly estimatedCost: number
    readonly activeOrgs: number
  }
  readonly rows: readonly ReportRow[]
}

const KEY_OF: Record<GroupBy, string> = {
  org: "coalesce(nullif(org, ''), '未标注')",
  model: "coalesce(nullif(model_id, ''), '未知模型')",
  user: "coalesce(nullif(user_id, ''), '未知用户')",
}

/**
 * 读报表。只读事实表，不触发抽取——抽取由调用方（T009 的读接口）先做。
 *
 * 成本汇总按 6 位小数取整：浮点求和会带出 `0.30000000000000004` 这类尾巴，
 * 而成本是给人看的估算值，不是需要逐分对账的账目。
 */
export function report(input: ReportInput): Report {
  const watermarkRow = input.analytics
    .query<{ watermark: number | null; users: number }, []>(
      "SELECT max(updated_at) AS watermark, count(*) AS users FROM analytics_cursor",
    )
    .get() ?? { watermark: null, users: 0 }

  const metrics = input.analytics
    .query<Report["metrics"], [number, number]>(
      `SELECT count(*) AS calls,
              coalesce(sum(input_tokens + output_tokens), 0) AS totalTokens,
              round(coalesce(sum(cost), 0), 6) AS estimatedCost,
              count(DISTINCT nullif(org, '')) AS activeOrgs
       FROM usage_fact WHERE occurred_at >= ? AND occurred_at < ?`,
    )
    .get(input.from, input.to) ?? { calls: 0, totalTokens: 0, estimatedCost: 0, activeOrgs: 0 }

  const rows = input.analytics
    .query<ReportRow, [number, number]>(
      `SELECT ${KEY_OF[input.groupBy]} AS key,
              count(*) AS calls,
              coalesce(sum(input_tokens), 0) AS inputTokens,
              coalesce(sum(output_tokens), 0) AS outputTokens,
              round(coalesce(sum(cost), 0), 6) AS cost
       FROM usage_fact WHERE occurred_at >= ? AND occurred_at < ?
       GROUP BY key ORDER BY calls DESC, key ASC`,
    )
    .all(input.from, input.to)

  return {
    collected: watermarkRow.users > 0,
    watermark: watermarkRow.watermark ?? null,
    metrics,
    rows,
  }
}

/** 跨轮补模型：同一 `assistantMessageID` 最近一条 started。 */
function lookupModel(source: Database, messageID: string): ModelRef | null {
  const row = source
    .query<{ data: string }, string[]>(
      `SELECT data FROM event WHERE type IN (${STARTED_TYPES.map(() => "?").join(", ")})
       AND json_extract(data, '$.assistantMessageID') = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(...STARTED_TYPES, messageID)
  return row ? modelOf(record(row.data)?.model) : null
}

function toFact(data: Record<string, unknown> | null): Fact | null {
  if (!data) return null
  const sessionID = text(data.sessionID)
  const assistantMessageID = text(data.assistantMessageID)
  const occurredAt = finite(data.timestamp)
  const cost = finite(data.cost)
  const tokens = record(data.tokens)
  if (!sessionID || !assistantMessageID || occurredAt === null || cost === null || !tokens) return null

  const input = finite(tokens.input)
  const output = finite(tokens.output)
  const reasoning = finite(tokens.reasoning)
  const cache = record(tokens.cache)
  const cacheRead = finite(cache?.read)
  const cacheWrite = finite(cache?.write)
  if (input === null || output === null || reasoning === null || cacheRead === null || cacheWrite === null) return null

  return { sessionID, assistantMessageID, occurredAt, cost, input, output, reasoning, cacheRead, cacheWrite }
}

function modelOf(value: unknown): ModelRef | null {
  const model = record(value)
  const id = text(model?.id)
  const providerID = text(model?.providerID)
  return id && providerID ? { id, providerID } : null
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value))
    } catch {
      return null
    }
  }
  return isRecord(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
