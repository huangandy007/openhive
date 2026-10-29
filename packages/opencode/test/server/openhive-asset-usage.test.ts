import { Database } from "bun:sqlite"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { 抽取 } from "@/server/openhive/asset-usage"

/**
 * 资产使用记录的抽取器（2026-10-29）。
 *
 * 源库用**手写的最小表**（`session` 两列 + `part` 六列），不是 core 的 `layerFromPath`——
 * 后者会在源库里建上百张无关表。代价写在设计 §10 缺口表：core 的 part DDL 改形状时本文件不会红。
 *
 * 判据落在可观测处：表里的行、字段、`unattributed` 计数。时间一律用固定字面量（不取 now），
 * 断言才有定数（`#009-02` 的同族纪律：先钉死输入再比输出）。
 */

const ROOT = mkdtempSync(join(tmpdir(), "openhive-asset-usage-"))
const 临时目录: string[] = [ROOT]
afterEach(() => {
  for (const dir of 临时目录.splice(1)) rmSync(dir, { recursive: true, force: true })
})

const 源库连接: Array<Database> = []
afterEach(() => {
  for (const db of 源库连接.splice(0)) db.close()
})

const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

const SOURCE_DDL = `
CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL);
CREATE TABLE part (
  id text PRIMARY KEY,
  message_id text NOT NULL,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);
`

let pg: Awaited<ReturnType<typeof startProductionDb>>

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  // `auth.asset.owner_id` 外键指向 `auth.user(id)`（RESTRICT），夹具里每个资产都得有真属主。
  await 建用户("usage-author")
})

afterAll(async () => {
  await pg?.stop()
  restorePoolMax()
  rmSync(ROOT, { recursive: true, force: true })
})

const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name">): AssetMetadata => ({
  type: "skill",
  description: "测试用资产",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  ownerId: "usage-author",
  ownerName: "作者",
  department: "经侦支队",
  visibility: "global",
  version: 1,
  status: "published",
  favoriteCount: 0,
  usageCount: 0,
  rating: 0,
  ratingCount: 0,
  feedbackCount: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
  publishedAt: 900,
  archivedAt: null,
  ...over,
})

/** 每个用例自己建作者，避免删账号用例被 asset.owner_id 的外键挡住。 */
async function 建用户(id: string, dept = "经侦支队") {
  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${id}, ${"P" + id.slice(-6)}, ${"用户" + id.slice(-6)}, 'x', 'x', '基座单位', ${dept}, '基座科室', 1, 0, 'h', 0)
  `)
}

async function 启用(projectId: string, assetId: string, userId: string) {
  await pg.db.execute(sql`
    insert into auth.project_asset_enablement (project_id, asset_id, enabled_by, enabled_at)
    values (${projectId}, ${assetId}, ${userId}, 1000)
  `)
}

function 建源库(userId: string, dir = ROOT) {
  mkdirSync(join(dir, userId), { recursive: true })
  const db = new Database(join(dir, userId, "opencode.db"), { create: true })
  db.exec(SOURCE_DDL)
  源库连接.push(db)
  return db
}

function 建会话(db: Database, sessionId: string, projectId: string) {
  db.query("insert into session (id, project_id) values (?, ?)").run(sessionId, projectId)
}

function 记调用(
  db: Database,
  input: {
    readonly partId: string
    readonly sessionId: string
    readonly name?: string
    readonly tool?: string
    readonly status?: string
    readonly timeCreated?: number
  },
) {
  const t = input.timeCreated ?? 1_790_000_000_123
  const state =
    input.status === "error"
      ? { status: "error", input: { name: input.name ?? "" }, error: "boom", time: { start: t, end: t } }
      : input.status === "running"
        ? { status: "running", input: { name: input.name ?? "" }, time: { start: t } }
        : {
            status: "completed",
            input: { name: input.name ?? "" },
            output: "",
            title: "",
            metadata: {},
            time: { start: t, end: t },
          }
  db.query(
    "insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, 'msg_usage', ?, ?, ?, ?)",
  ).run(input.partId, input.sessionId, t, t, JSON.stringify({ type: "tool", tool: input.tool ?? "skill", callID: "call_" + input.partId, state }))
}

async function 行(userId: string) {
  const result = await pg.db.execute(
    sql`select part_id, asset_id, session_id, call_id, skill_name, org, dept, section, occurred_at, extracted_at
        from auth.asset_usage_event where user_id = ${userId} order by part_id`,
  )
  return rowsOf(result)
}

describe("资产使用记录：抽取", () => {
  test("一次 skill 调用 ⇒ 一行，字段全对（occurred_at 存秒）", async () => {
    await 建用户("usage-u1")
    await insertAsset(pg.db, 资产({ id: "usage-a1", name: "资金分析" }))
    await 启用("usage-p1", "usage-a1", "usage-u1")
    const 源 = 建源库("usage-u1")
    建会话(源, "usage-s1", "usage-p1")
    记调用(源, { partId: "usage-prt1", sessionId: "usage-s1", name: "资金分析" })

    const 结果 = await 抽取({ db: pg.db, root: ROOT, now: 1_790_000_100 })

    expect({ scanned: 结果.scanned, inserted: 结果.inserted, unattributed: 结果.unattributed }).toEqual({
      scanned: 1,
      inserted: 1,
      unattributed: 0,
    })
    expect(结果.missing).not.toContain("usage-u1")
    expect(await 行("usage-u1")).toEqual([
      {
        part_id: "usage-prt1",
        asset_id: "usage-a1",
        session_id: "usage-s1",
        call_id: "call_usage-prt1",
        skill_name: "资金分析",
        org: "基座单位",
        dept: "经侦支队",
        section: "基座科室",
        occurred_at: 1_790_000_000,
        extracted_at: 1_790_000_100,
      },
    ])
  })

  test("同一会话里加载两次 ⇒ 两行（每次调用记一条）", async () => {
    await 建用户("usage-u2")
    await insertAsset(pg.db, 资产({ id: "usage-a2", name: "话单分析" }))
    await 启用("usage-p2", "usage-a2", "usage-u2")
    const 源 = 建源库("usage-u2")
    建会话(源, "usage-s2", "usage-p2")
    记调用(源, { partId: "usage-prt2a", sessionId: "usage-s2", name: "话单分析", timeCreated: 1_790_000_000_000 })
    记调用(源, { partId: "usage-prt2b", sessionId: "usage-s2", name: "话单分析", timeCreated: 1_790_000_060_000 })

    const 结果 = await 抽取({ db: pg.db, root: ROOT, now: 1_790_000_100 })

    expect(结果.inserted).toBe(2)
    expect((await 行("usage-u2")).length).toBe(2)
  })

  test("重放同一段不翻倍：回看窗口里的行被主键吃掉", async () => {
    await 建用户("usage-u3")
    await insertAsset(pg.db, 资产({ id: "usage-a3", name: "涉案账户梳理" }))
    await 启用("usage-p3", "usage-a3", "usage-u3")
    const 源 = 建源库("usage-u3")
    建会话(源, "usage-s3", "usage-p3")
    记调用(源, { partId: "usage-prt3", sessionId: "usage-s3", name: "涉案账户梳理" })

    await 抽取({ db: pg.db, root: ROOT, now: 1_790_000_100 })
    const 第二遍 = await 抽取({ db: pg.db, root: ROOT, now: 1_790_000_200 })

    // 第二遍仍会扫到（水位回看 60 秒）⇒ scanned > 0，但一行也没新增。
    expect(第二遍.inserted).toBe(0)
    expect((await 行("usage-u3")).length).toBe(1)

    // 重放之后，同一用户的新调用仍要能落表：幂等若只靠「主键冲突被 catch 吞掉」，
    // 这一轮的扫描会在回看到的老行上中断，游标不推进、新行永远进不来（`#003-03` 的 ③ 型：全绿＝没覆盖）。
    记调用(源, {
      partId: "usage-prt3b",
      sessionId: "usage-s3",
      name: "涉案账户梳理",
      timeCreated: 1_790_000_001_000,
    })
    const 第三遍 = await 抽取({ db: pg.db, root: ROOT, now: 1_790_000_200 })
    expect(第三遍.inserted).toBe(1)
    expect((await 行("usage-u3")).length).toBe(2)
  })

  test("只有 completed 才算：running 不入表，之后完成再抽就入表", async () => {
    await 建用户("usage-u4")
    await insertAsset(pg.db, 资产({ id: "usage-a4", name: "资金穿透" }))
    await 启用("usage-p4", "usage-a4", "usage-u4")
    const 源 = 建源库("usage-u4")
    建会话(源, "usage-s4", "usage-p4")
    记调用(源, { partId: "usage-prt4", sessionId: "usage-s4", name: "资金穿透", status: "running", timeCreated: 1_790_000_000_000 })

    const 第一遍 = await 抽取({ db: pg.db, root: ROOT, now: 1_790_000_100 })
    expect(第一遍.inserted).toBe(0)
    expect((await 行("usage-u4")).length).toBe(0)

    // 完成态：同一 id 被 UPDATE，time_updated 往前走。
    源.query("update part set time_updated = ?, data = ? where id = ?").run(
      1_790_000_030_000,
      JSON.stringify({
        type: "tool",
        tool: "skill",
        callID: "call_usage-prt4",
        state: {
          status: "completed",
          input: { name: "资金穿透" },
          output: "",
          title: "",
          metadata: {},
          time: { start: 1_790_000_000_000, end: 1_790_000_030_000 },
        },
      }),
      "usage-prt4",
    )

    const 第二遍 = await 抽取({ db: pg.db, root: ROOT, now: 1_790_000_100 })
    expect(第二遍.inserted).toBe(1)
    expect((await 行("usage-u4")).length).toBe(1)
  })
})
