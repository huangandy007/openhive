import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Analytics } from "@/governance/analytics"

/**
 * T004 · 分析库（event 表增量抽取 → 用量/成本）的真 SQLite 夹具。
 *
 * 源库用**手写的最小 event 表**（只取抽取器真正读的三列），不是 core 的 `layerFromPath`
 * ——后者会在源库里建上百张无关表。代价是「core 的 event DDL 若改形状，本文件不会红」；
 * 抽取器只读 `id` / `type` / `data`，这三列是事件溯源的稳定面，风险记在 state.md 的缺口里。
 *
 * 事件类型用**字面量**写死（`session.next.step.ended.2`），另有专门用例断言模块从
 * `EventManifest.Durable` 派生的集合包含它们——两处都写才能发现「派生逻辑读错了前缀」。
 */

const STARTED = "session.next.step.started.1"
const ENDED = "session.next.step.ended.2"

const SOURCE_DDL = `
CREATE TABLE event (
  id text PRIMARY KEY,
  aggregate_id text NOT NULL,
  seq integer NOT NULL,
  type text NOT NULL,
  data text NOT NULL
);
`

const closers: Array<() => void> = []
const dirs: string[] = []

afterEach(() => {
  for (const close of closers.splice(0).reverse()) close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "openhive-analytics-"))
  dirs.push(dir)
  return dir
}

function openSource(path: string, withEventTable = true) {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path, { create: true })
  closers.push(() => db.close())
  if (withEventTable) db.exec(SOURCE_DDL)
  return db
}

function openAnalytics(path: string) {
  const store = Analytics.open(path)
  closers.push(() => store.close())
  return store.db
}

function write(db: Database, id: string, type: string, data: unknown) {
  db.query("INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, 'ses_1', 0, ?, ?)").run(
    id,
    type,
    typeof data === "string" ? data : JSON.stringify(data),
  )
}

function started(db: Database, id: string, messageID: string, model = "claude-sonnet", provider = "anthropic") {
  write(db, id, STARTED, {
    timestamp: 1_700_000_000_000,
    sessionID: "ses_1",
    assistantMessageID: messageID,
    agent: "build",
    model: { id: model, providerID: provider },
  })
}

function ended(
  db: Database,
  id: string,
  messageID: string,
  options: {
    timestamp?: number
    cost?: number
    tokens?: { input: number; output: number; reasoning?: number; read?: number; write?: number }
  } = {},
) {
  const tokens = options.tokens ?? { input: 100, output: 50 }
  write(db, id, ENDED, {
    timestamp: options.timestamp ?? 1_700_000_001_000,
    sessionID: "ses_1",
    assistantMessageID: messageID,
    finish: "stop",
    cost: options.cost ?? 0.25,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning ?? 0,
      cache: { read: tokens.read ?? 0, write: tokens.write ?? 0 },
    },
  })
}

const FACTS = `SELECT user_id, event_id, session_id, assistant_message_id, model_id, provider_id, org,
  occurred_at, cost, input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens
  FROM usage_fact ORDER BY event_id`

describe("分析库路径", () => {
  test("默认落在数据根；OPENHIVE_ANALYTICS_DB 覆盖；空串按未设", () => {
    expect(Analytics.analyticsPath({})).toBe(join("/data", "analytics.db"))
    expect(Analytics.analyticsPath({ OPENHIVE_DATA_ROOT: "/srv/data" })).toBe(join("/srv/data", "analytics.db"))
    expect(Analytics.analyticsPath({ OPENHIVE_ANALYTICS_DB: "", OPENHIVE_DATA_ROOT: "/srv" })).toBe(
      join("/srv", "analytics.db"),
    )
    expect(Analytics.analyticsPath({ OPENHIVE_ANALYTICS_DB: "/tmp/analytics.db" })).toBe("/tmp/analytics.db")
  })

  test("durable 类型从 EventManifest 派生，不是写死的字符串", () => {
    expect(Analytics.STARTED_TYPES).toContain(STARTED)
    expect(Analytics.ENDED_TYPES).toContain(ENDED)
  })

  test("建表幂等：同一文件重复 open 不报错，行还在", () => {
    const dir = tempDir()
    const path = join(dir, "analytics.db")
    const first = openAnalytics(path)
    first.query("INSERT INTO analytics_cursor (user_id, last_event_id, updated_at) VALUES ('u_1', '', 1)").run()
    const second = openAnalytics(path)
    expect(second.query("SELECT count(*) AS count FROM analytics_cursor").get()).toEqual({ count: 1 })
  })
})

describe("增量抽取", () => {
  test("两条 step.ended 落两行事实，token / 成本 / 模型 / 单位逐字段相等", () => {
    const dir = tempDir()
    const sourcePath = join(dir, "data", "u_1", "opencode.db")
    const source = openSource(sourcePath)
    started(source, "evt_0001", "msg_1", "claude-sonnet", "anthropic")
    ended(source, "evt_0002", "msg_1", {
      timestamp: 1_700_000_002_000,
      cost: 0.25,
      tokens: { input: 100, output: 50, reasoning: 10, read: 5, write: 2 },
    })
    started(source, "evt_0003", "msg_2", "gpt-5", "openai")
    ended(source, "evt_0004", "msg_2", {
      timestamp: 1_700_000_003_000,
      cost: 0.5,
      tokens: { input: 200, output: 80 },
    })
    const analytics = openAnalytics(join(dir, "analytics.db"))

    const result = Analytics.extractUser({ analytics, sourcePath, userId: "u_1", org: "湖州市局", now: 999 })

    expect(result).toEqual({ scanned: 4, inserted: 2, skipped: 0, cursor: "evt_0004", missing: false })
    expect(analytics.query(FACTS).all()).toEqual([
      {
        user_id: "u_1",
        event_id: "evt_0002",
        session_id: "ses_1",
        assistant_message_id: "msg_1",
        model_id: "claude-sonnet",
        provider_id: "anthropic",
        org: "湖州市局",
        occurred_at: 1_700_000_002_000,
        cost: 0.25,
        input_tokens: 100,
        output_tokens: 50,
        reasoning_tokens: 10,
        cache_read_tokens: 5,
        cache_write_tokens: 2,
      },
      {
        user_id: "u_1",
        event_id: "evt_0004",
        session_id: "ses_1",
        assistant_message_id: "msg_2",
        model_id: "gpt-5",
        provider_id: "openai",
        org: "湖州市局",
        occurred_at: 1_700_000_003_000,
        cost: 0.5,
        input_tokens: 200,
        output_tokens: 80,
        reasoning_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
    ])
  })

  test("重复抽取幂等：第二次 scanned=0 / inserted=0，总量不变", () => {
    const dir = tempDir()
    const sourcePath = join(dir, "u_1", "opencode.db")
    const source = openSource(sourcePath)
    started(source, "evt_0001", "msg_1")
    ended(source, "evt_0002", "msg_1")
    const analytics = openAnalytics(join(dir, "analytics.db"))

    expect(Analytics.extractUser({ analytics, sourcePath, userId: "u_1", org: "A", now: 1 }).inserted).toBe(1)
    expect(Analytics.extractUser({ analytics, sourcePath, userId: "u_1", org: "A", now: 2 })).toEqual({
      scanned: 0,
      inserted: 0,
      skipped: 0,
      cursor: "evt_0002",
      missing: false,
    })
    expect(analytics.query("SELECT count(*) AS count FROM usage_fact").get()).toEqual({ count: 1 })
  })

  test("游标没写成功时重跑同一批：不翻倍、不抛（崩溃窗口靠主键 + OR IGNORE 兜住）", () => {
    const dir = tempDir()
    const sourcePath = join(dir, "u_1", "opencode.db")
    const source = openSource(sourcePath)
    started(source, "evt_0001", "msg_1")
    ended(source, "evt_0002", "msg_1")
    const analytics = openAnalytics(join(dir, "analytics.db"))
    Analytics.extractUser({ analytics, sourcePath, userId: "u_1", org: "A", now: 1 })

    // 模拟「事件已入库、游标还没落盘」的崩溃窗口。
    analytics.query("UPDATE analytics_cursor SET last_event_id = '' WHERE user_id = 'u_1'").run()

    expect(Analytics.extractUser({ analytics, sourcePath, userId: "u_1", org: "A", now: 2 })).toEqual({
      scanned: 2,
      inserted: 0,
      skipped: 0,
      cursor: "evt_0002",
      missing: false,
    })
    expect(analytics.query("SELECT count(*) AS count FROM usage_fact").get()).toEqual({ count: 1 })
  })

  test("游标只扫新事件：追加一条 ended 后 scanned=1 / inserted=1", () => {
    const dir = tempDir()
    const sourcePath = join(dir, "u_1", "opencode.db")
    const source = openSource(sourcePath)
    started(source, "evt_0001", "msg_1")
    ended(source, "evt_0002", "msg_1")
    const analytics = openAnalytics(join(dir, "analytics.db"))
    Analytics.extractUser({ analytics, sourcePath, userId: "u_1", org: "A", now: 1 })

    started(source, "evt_0003", "msg_2")
    ended(source, "evt_0004", "msg_2")

    expect(Analytics.extractUser({ analytics, sourcePath, userId: "u_1", org: "A", now: 2 })).toEqual({
      scanned: 2,
      inserted: 1,
      skipped: 0,
      cursor: "evt_0004",
      missing: false,
    })
  })

  test("模型在上一轮、ended 在这一轮：回查源库仍拿到模型", () => {
    const dir = tempDir()
    const sourcePath = join(dir, "u_1", "opencode.db")
    const source = openSource(sourcePath)
    started(source, "evt_0001", "msg_1", "claude-opus", "anthropic")
    const analytics = openAnalytics(join(dir, "analytics.db"))
    expect(Analytics.extractUser({ analytics, sourcePath, userId: "u_1", org: "A", now: 1 }).cursor).toBe("evt_0001")

    ended(source, "evt_0002", "msg_1", { timestamp: 1_700_000_009_000 })

    const result = Analytics.extractUser({ analytics, sourcePath, userId: "u_1", org: "A", now: 2 })
    expect(result).toEqual({ scanned: 1, inserted: 1, skipped: 0, cursor: "evt_0002", missing: false })
    expect(analytics.query("SELECT model_id, provider_id FROM usage_fact").get()).toEqual({
      model_id: "claude-opus",
      provider_id: "anthropic",
    })
  })

  test("脏数据计入 skipped、不入库，游标照样前进", () => {
    const dir = tempDir()
    const sourcePath = join(dir, "u_1", "opencode.db")
    const source = openSource(sourcePath)
    write(source, "evt_0001", ENDED, "{not json")
    write(source, "evt_0002", ENDED, {
      timestamp: 1_700_000_000_000,
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      finish: "stop",
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const analytics = openAnalytics(join(dir, "analytics.db"))

    expect(Analytics.extractUser({ analytics, sourcePath, userId: "u_1", org: "A", now: 1 })).toEqual({
      scanned: 2,
      inserted: 0,
      skipped: 2,
      cursor: "evt_0002",
      missing: false,
    })
    expect(analytics.query("SELECT count(*) AS count FROM usage_fact").get()).toEqual({ count: 0 })
  })

  test("源库文件不存在 / 没有 event 表 ⇒ missing，不抛", () => {
    const dir = tempDir()
    const analytics = openAnalytics(join(dir, "analytics.db"))
    expect(
      Analytics.extractUser({ analytics, sourcePath: join(dir, "nope", "opencode.db"), userId: "u_1", org: "A" }),
    ).toEqual({ scanned: 0, inserted: 0, skipped: 0, cursor: null, missing: true })

    const empty = openSource(join(dir, "u_2", "opencode.db"), false)
    empty.exec("CREATE TABLE other (x text)")
    expect(
      Analytics.extractUser({ analytics, sourcePath: join(dir, "u_2", "opencode.db"), userId: "u_2", org: "A" }),
    ).toEqual({ scanned: 0, inserted: 0, skipped: 0, cursor: null, missing: true })
  })

  test("extractAll：缺库的用户进 missing，其余照抽", () => {
    const dir = tempDir()
    const root = join(dir, "data")
    const source = openSource(join(root, "u_1", "opencode.db"))
    started(source, "evt_0001", "msg_1")
    ended(source, "evt_0002", "msg_1")
    const analytics = openAnalytics(join(dir, "analytics.db"))

    expect(
      Analytics.extractAll({
        analytics,
        dataRoot: root,
        users: [
          { id: "u_1", org: "A" },
          { id: "u_2", org: "B" },
        ],
        now: 1,
      }),
    ).toEqual({ scanned: 2, inserted: 1, skipped: 0, missing: ["u_2"] })
  })
})

describe("报表", () => {
  function seed(dir: string, analytics: Database) {
    const rows: Array<{ user: string; org: string; model: string; message: string; event: string; at: number }> = [
      { user: "u_1", org: "A", model: "claude", message: "msg_1", event: "evt_0002", at: 2_000 },
      { user: "u_2", org: "A", model: "gpt", message: "msg_2", event: "evt_0004", at: 3_000 },
      { user: "u_3", org: "B", model: "claude", message: "msg_3", event: "evt_0006", at: 4_000 },
      { user: "u_4", org: "", model: "claude", message: "msg_4", event: "evt_0008", at: 5_000 },
    ]
    for (const row of rows) {
      const sourcePath = join(dir, "data", row.user, "opencode.db")
      const source = openSource(sourcePath)
      started(source, "evt_0001", row.message, row.model, "provider")
      ended(source, row.event, row.message, {
        timestamp: row.at,
        cost: 0.1,
        tokens: { input: 10, output: 5, reasoning: 3, read: 2, write: 1 },
      })
      Analytics.extractUser({ analytics, sourcePath, userId: row.user, org: row.org, now: 1 })
    }
  }

  test("窗口 [from, to)：恰在 to 的事件被排除", () => {
    const dir = tempDir()
    const analytics = openAnalytics(join(dir, "analytics.db"))
    seed(dir, analytics)

    expect(Analytics.report({ analytics, from: 2_000, to: 4_000, groupBy: "org" }).metrics.calls).toBe(2)
    expect(Analytics.report({ analytics, from: 2_000, to: 5_000, groupBy: "org" }).metrics.calls).toBe(3)
  })

  test("按单位 / 按模型聚合；空单位归「未标注」", () => {
    const dir = tempDir()
    const analytics = openAnalytics(join(dir, "analytics.db"))
    seed(dir, analytics)

    expect(Analytics.report({ analytics, from: 0, to: 10_000, groupBy: "org" }).rows).toEqual([
      { key: "A", calls: 2, inputTokens: 20, outputTokens: 10, cost: 0.2 },
      { key: "B", calls: 1, inputTokens: 10, outputTokens: 5, cost: 0.1 },
      { key: "未标注", calls: 1, inputTokens: 10, outputTokens: 5, cost: 0.1 },
    ])
    expect(Analytics.report({ analytics, from: 0, to: 10_000, groupBy: "model" }).rows).toEqual([
      { key: "claude", calls: 3, inputTokens: 30, outputTokens: 15, cost: 0.3 },
      { key: "gpt", calls: 1, inputTokens: 10, outputTokens: 5, cost: 0.1 },
    ])
  })

  test("token 总量口径 = input + output；活跃单位 = 非空单位的去重数", () => {
    const dir = tempDir()
    const analytics = openAnalytics(join(dir, "analytics.db"))
    seed(dir, analytics)

    expect(Analytics.report({ analytics, from: 0, to: 10_000, groupBy: "org" }).metrics).toEqual({
      calls: 4,
      totalTokens: 60,
      estimatedCost: 0.4,
      activeOrgs: 2,
    })
  })

  test("从未抽取 ⇒ collected=false / watermark=null；抽过但窗口空 ⇒ 0 值 + collected=true", () => {
    const dir = tempDir()
    const analytics = openAnalytics(join(dir, "analytics.db"))

    expect(Analytics.report({ analytics, from: 0, to: 10, groupBy: "org" })).toEqual({
      collected: false,
      watermark: null,
      metrics: { calls: 0, totalTokens: 0, estimatedCost: 0, activeOrgs: 0 },
      rows: [],
    })

    const sourcePath = join(dir, "u_1", "opencode.db")
    const source = openSource(sourcePath)
    started(source, "evt_0001", "msg_1")
    ended(source, "evt_0002", "msg_1", { timestamp: 2_000 })
    Analytics.extractUser({ analytics, sourcePath, userId: "u_1", org: "A", now: 777 })

    expect(Analytics.report({ analytics, from: 0, to: 1_000, groupBy: "org" })).toEqual({
      collected: true,
      watermark: 777,
      metrics: { calls: 0, totalTokens: 0, estimatedCost: 0, activeOrgs: 0 },
      rows: [],
    })
  })
})
