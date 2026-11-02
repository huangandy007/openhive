import { Database } from "bun:sqlite"
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { userDatabasePath } from "@opencode-ai/core/database/router"
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

const 源库连接: Array<Database> = []
afterEach(() => {
  for (const db of 源库连接.splice(0)) db.close()
})

const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

const SOURCE_DDL = `
CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL);
CREATE TABLE message (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);
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
  summary: "",
  precautions: "",
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
  iterationNote: "",
  iterationWorkspace: null,
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
    /** bash 的命令行 / read 的文件路径（2026-10-30 起归因也走这两类 part）。 */
    readonly command?: string
    readonly filePath?: string
  },
) {
  const t = input.timeCreated ?? 1_790_000_000_123
  const 入参: Record<string, string> = { name: input.name ?? "" }
  if (input.command !== undefined) 入参.command = input.command
  if (input.filePath !== undefined) 入参.filePath = input.filePath
  const state =
    input.status === "error"
      ? { status: "error", input: 入参, error: "boom", time: { start: t, end: t } }
      : input.status === "running"
        ? { status: "running", input: 入参, time: { start: t } }
        : {
            status: "completed",
            input: 入参,
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
    // 毒行：data 不是 JSON。没有 CASE 守卫时 `.all()` 在语句级抛 malformed JSON，
    // 整个用户的抽取被 catch 吞掉 ⇒ 下面三处断言全红（scanned 0 / 0 行 / 游标 []）。
    源.query(
      "insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?, ?)",
    ).run("usage-poison", "msg_usage", "usage-s1", 1_790_000_000_123, 1_790_000_000_123, "not json")

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

    // 游标：每用户一条，**秒**（`#002-01`）。写成毫秒会 22003 被 catch 吞成警告、测试却全绿。
    const 游标 = rowsOf(
      await pg.db.execute(sql`select last_updated_sec from auth.asset_usage_cursor where user_id = ${"usage-u1"}`),
    )
    expect(游标).toEqual([{ last_updated_sec: 1_790_000_000 }])
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

describe("资产使用记录：归因与游标", () => {
  /**
   * 每条用例独占一个源库根。抽取按 `root/<用户 id>` 找库、整轮累计计数：共用一个根时，
   * 上一条用例里**没入表**的行（同名 / 名字对不上 / 会话缺失）在下一轮 60 秒回看窗口内
   * 必被重扫、重复计进 `unattributed`（水位恒等于该行自己的时间 ⇒ 永远落在回看窗里）。
   * 实测：第 2 条与第 1 条共用根时 `unattributed` 实得 3，单独跑实得 2。
   */
  const 独占根 = (名: string) => {
    const dir = join(ROOT, 名)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  test("项目里同名两份已启用资产 ⇒ 不猜，不入表，计未归因", async () => {
    await 建用户("usage-u5")
    await insertAsset(pg.db, 资产({ id: "usage-a5x", name: "同名技能" }))
    await insertAsset(pg.db, 资产({ id: "usage-a5y", name: "同名技能" }))
    await 启用("usage-p5", "usage-a5x", "usage-u5")
    await 启用("usage-p5", "usage-a5y", "usage-u5")
    const 根 = 独占根("t5")
    const 源 = 建源库("usage-u5", 根)
    建会话(源, "usage-s5", "usage-p5")
    记调用(源, { partId: "usage-prt5", sessionId: "usage-s5", name: "同名技能" })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(0)
    expect(结果.unattributed).toBe(1)
    expect((await 行("usage-u5")).length).toBe(0)
  })

  test("非 skill 工具 / 未启用资产 / 名字对不上 / 会话不存在 ⇒ 都不是使用记录", async () => {
    await 建用户("usage-u6")
    await insertAsset(pg.db, 资产({ id: "usage-a6", name: "话单比对" }))
    await 启用("usage-p6", "usage-a6", "usage-u6")
    // 资产存在、但项目 p6 没启用它：归因表只认启用台账，不能退化成「库里同名就算」。
    await insertAsset(pg.db, 资产({ id: "usage-a6x", name: "未启用技能" }))
    const 根 = 独占根("t6")
    const 源 = 建源库("usage-u6", 根)
    建会话(源, "usage-s6", "usage-p6")
    记调用(源, { partId: "usage-prt6a", sessionId: "usage-s6", name: "话单比对", tool: "bash" })
    记调用(源, { partId: "usage-prt6b", sessionId: "usage-s6", name: "不存在的技能" })
    记调用(源, { partId: "usage-prt6c", sessionId: "usage-s6-不存在", name: "话单比对" })
    记调用(源, { partId: "usage-prt6d", sessionId: "usage-s6", name: "未启用技能" })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(0)
    // 6a（bash）**进 scanned 但不入表**（2026-10-30 起 bash 也是归因入口，只是它没有 command
    // 字段 ⇒ 命中不了资产段）；6b/6c/6d 三条走 skill 老路径、归因失败。
    // t6 这个独占根里只有 u6 一个源库 ⇒ scanned 是确定值，可以钉。
    expect(结果.scanned).toBe(4)
    // `unattributed` 只数「像 skill 调用却归不了因」的：bash 找不到资产段不算它。
    expect(结果.unattributed).toBe(3)
  })

  test("没有源库的用户 ⇒ 进 missing、不报错、不留游标", async () => {
    await 建用户("usage-u7")
    const 根 = 独占根("t7")
    // 用户目录存在、库文件不存在：这是「缺库」的常见形态（目录可能被沙箱/其他文件建过），
    // 也让下面「不留空库」的断言真的承重——父目录不存在时 `create: true` 也会 CANTOPEN，
    // 建不出文件，那条断言就成了恒真的摆设。
    mkdirSync(join(根, "usage-u7"), { recursive: true })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.missing).toContain("usage-u7")
    // 缺库路径不能有副作用：`new Database(路径)` 若带 `{ create: true }`，第二道
    // `sqlite_master` 守卫仍会把它算 missing，但根里会留下一只空库文件。
    // 用 `userDatabasePath` 拼路径，不写死 `"opencode.db"`：写死的字面量在库文件名改掉后
    // 会变成「这个不存在的路径确实不存在」——断言恒真、静默失效（`#005-18`）。
    expect(existsSync(userDatabasePath(根, "usage-u7"))).toBe(false)
    const 游标 = rowsOf(
      await pg.db.execute(sql`select user_id from auth.asset_usage_cursor where user_id = ${"usage-u7"}`),
    )
    expect(游标).toEqual([])
  })

  test("组织是写时快照：改部门后重抽，旧行不变、新行用新部门", async () => {
    await 建用户("usage-u8", "经侦支队")
    await insertAsset(pg.db, 资产({ id: "usage-a8", name: "快照技能" }))
    await 启用("usage-p8", "usage-a8", "usage-u8")
    const 根 = 独占根("t8")
    const 源 = 建源库("usage-u8", 根)
    建会话(源, "usage-s8", "usage-p8")
    记调用(源, { partId: "usage-prt8a", sessionId: "usage-s8", name: "快照技能", timeCreated: 1_790_000_000_000 })
    await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    await pg.db.execute(sql`update auth.user set dept = '刑侦大队' where id = ${"usage-u8"}`)
    记调用(源, { partId: "usage-prt8b", sessionId: "usage-s8", name: "快照技能", timeCreated: 1_790_000_060_000 })
    await 抽取({ db: pg.db, root: 根, now: 1_790_000_200 })

    const 部门 = rowsOf(
      await pg.db.execute(
        sql`select part_id, dept from auth.asset_usage_event where user_id = ${"usage-u8"} order by part_id`,
      ),
    )
    expect(部门).toEqual([
      { part_id: "usage-prt8a", dept: "经侦支队" },
      { part_id: "usage-prt8b", dept: "刑侦大队" },
    ])
  })

  test("删账号 ⇒ 历史行仍在（无外键）", async () => {
    await 建用户("usage-u9")
    await 建用户("usage-author9")
    await insertAsset(pg.db, 资产({ id: "usage-a9", name: "留档技能", ownerId: "usage-author9" }))
    await 启用("usage-p9", "usage-a9", "usage-u9")
    const 根 = 独占根("t9")
    const 源 = 建源库("usage-u9", 根)
    建会话(源, "usage-s9", "usage-p9")
    记调用(源, { partId: "usage-prt9", sessionId: "usage-s9", name: "留档技能" })
    await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    await pg.db.execute(sql`delete from auth.user where id = ${"usage-u9"}`)

    // 先钉前提：删账号真的删掉了。否则「历史行仍在」会在 delete 静默影响 0 行时假绿（`#005-18`）。
    const 还在 = rowsOf(await pg.db.execute(sql`select id from auth.user where id = ${"usage-u9"}`))
    expect(还在).toEqual([])
    expect((await 行("usage-u9")).length).toBe(1)
  })

  test("同一源根下多用户并存：游标按用户隔离，别人的高水位挡不住本用户的行", async () => {
    const 根 = 独占根("t10")

    // A 先抽一次，把 A 的水位推到 1_790_000_200
    await 建用户("usage-uA")
    await insertAsset(pg.db, 资产({ id: "usage-aA", name: "隔离技能A" }))
    await 启用("usage-pA", "usage-aA", "usage-uA")
    const 源A = 建源库("usage-uA", 根)
    建会话(源A, "usage-sA", "usage-pA")
    记调用(源A, { partId: "usage-prtA", sessionId: "usage-sA", name: "隔离技能A", timeCreated: 1_790_000_200_000 })
    await 抽取({ db: pg.db, root: 根, now: 1_790_000_300 })

    // B 后来才第一次被抽，行时间比既有所有水位都早得多
    await 建用户("usage-uB")
    await insertAsset(pg.db, 资产({ id: "usage-aB", name: "隔离技能B" }))
    await 启用("usage-pB", "usage-aB", "usage-uB")
    const 源B = 建源库("usage-uB", 根)
    建会话(源B, "usage-sB", "usage-pB")
    记调用(源B, { partId: "usage-prtB", sessionId: "usage-sB", name: "隔离技能B", timeCreated: 1_789_000_000_123 })

    const 第二遍 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_400 })

    // B 没有游标 ⇒ 必须被扫到。读游标若漏掉 `where user_id = …`，会取到别人的高水位、
    // 把这一行挡在 60 秒回看窗之外，且不报错不计数（`#002-02`）。行时间取得比任何既有
    // 游标都早，保证漏 WHERE 时不论取到哪一行都会红（不是碰巧取到 B 自己的）。
    //
    // ⚠️ 这条判别力依赖一个**外部前提**：此刻游标表里每一行的水位都 ≥ 1_790_000_000
    // （本文件其它用例的行时间都落在这一秒附近），B 的行才必然被挡在窗外。将来若有用例
    // 写入更早的游标（行时间字面量取更小），这个变异在全量跑里可能变绿。改本文件时间
    // 字面量时回头看这一条。
    expect(第二遍.inserted).toBe(1)
    expect((await 行("usage-uB")).length).toBe(1)
    const 游标 = rowsOf(
      await pg.db.execute(sql`
        select user_id, last_updated_sec from auth.asset_usage_cursor
        where user_id in ('usage-uA', 'usage-uB') order by user_id
      `),
    )
    expect(游标).toEqual([
      { user_id: "usage-uA", last_updated_sec: 1_790_000_200 },
      { user_id: "usage-uB", last_updated_sec: 1_789_000_000 },
    ])
  })

  test("写入失败的那一轮不推进游标：腾空事件表后重抽，行照旧入表、游标才前进", async () => {
    await 建用户("usage-u11")
    await insertAsset(pg.db, 资产({ id: "usage-a11", name: "游标技能" }))
    await 启用("usage-p11", "usage-a11", "usage-u11")
    const 根 = 独占根("t11")
    const 源 = 建源库("usage-u11", 根)
    建会话(源, "usage-s11", "usage-p11")
    记调用(源, { partId: "usage-prt11", sessionId: "usage-s11", name: "游标技能", timeCreated: 1_790_000_000_000 })

    const 游标 = async () =>
      rowsOf(await pg.db.execute(sql`select last_updated_sec from auth.asset_usage_cursor where user_id = ${"usage-u11"}`))

    // 让这一轮的写入必然失败：把事件表挪走。失败发生在「扫到行之后」，正是游标该不该推进的岔口
    // （失败挂在名册查询上的话，任何用户都还没开始，测不到这条）。
    await pg.db.execute(sql`alter table auth.asset_usage_event rename to asset_usage_event_t11`)
    try {
      const 失败轮 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })
      expect(失败轮.inserted).toBe(0)
      // 先把前提钉死：这一轮**确实扫到了**那一行，失败发生在写入而不是扫描之前——
      // 否则「没写游标」可以是「压根没扫到」的假象，本用例就守不住游标位置那条判据。
      expect(失败轮.scanned).toBe(1)
      // 关键断言：没写成 ≠ 读过了。游标不动，下一轮才会重扫这一段的行。
      expect(await 游标()).toEqual([])
    } finally {
      // RENAME 的新名**不能**带 schema 前缀（PG 42601 `syntax error at or near "."`），
      // 限定加在旧名上。
      await pg.db.execute(sql`alter table auth.asset_usage_event_t11 rename to asset_usage_event`)
    }

    const 成功轮 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_200 })
    expect(成功轮.inserted).toBe(1)
    expect((await 行("usage-u11")).length).toBe(1)
    expect(await 游标()).toEqual([{ last_updated_sec: 1_790_000_000 }])
  })
})

describe("资产使用记录：不止 skill 工具（2026-10-30 口径）", () => {
  /**
   * 用户裁定（2026-10-30）：
   * - **①A 一次工具调用 = 一次**：同一个 part 里跑十个脚本也只记一行（主键天然如此）。
   * - **②A 只认真的执行了技能脚本**：命令行里得出现 `<资产 id>/scripts/`，`ls` 目录不算。
   * - **归因走路径里的资产 id**，不查项目启用台账——「用了就是用了」，未启用的一样记。
   */
  const 独占根 = (名: string) => {
    const dir = join(ROOT, 名)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  function 记文本(
    db: Database,
    input: { readonly partId: string; readonly sessionId: string; readonly text: string; readonly timeCreated?: number },
  ) {
    const t = input.timeCreated ?? 1_790_000_000_123
    db.query(
      "insert into part (id, message_id, session_id, time_created, time_updated, data) values (?, 'msg_usage', ?, ?, ?, ?)",
    ).run(input.partId, input.sessionId, t, t, JSON.stringify({ type: "text", text: input.text }))
  }

  test("跑脚本 / 读说明书 / 斜杠命令 ⇒ 各记一行，归因到路径里的资产 id", async () => {
    await 建用户("usage-u20")
    await insertAsset(pg.db, 资产({ id: "usage-a20", name: "脚本技能" }))
    await 启用("usage-p20", "usage-a20", "usage-u20")
    const 根 = 独占根("t20")
    const 源 = 建源库("usage-u20", 根)
    建会话(源, "usage-s20", "usage-p20")

    记调用(源, {
      partId: "usage-prt20a",
      sessionId: "usage-s20",
      tool: "bash",
      command: 'python ".opencode/skill/usage-a20/scripts/md_to_word.py" "a.md" "b.docx"',
      timeCreated: 1_790_000_000_000,
    })
    记调用(源, {
      partId: "usage-prt20b",
      sessionId: "usage-s20",
      tool: "read",
      filePath: ".opencode/skill/usage-a20/SKILL.md",
      timeCreated: 1_790_000_010_000,
    })
    记文本(源, {
      partId: "usage-prt20c",
      sessionId: "usage-s20",
      text: "# Skill: 脚本技能\n……正文……\n\nBase directory for this skill: .opencode/skill/usage-a20\nRelative paths in this skill are relative to this base directory.",
      timeCreated: 1_790_000_020_000,
    })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(3)
    expect(await 行("usage-u20")).toEqual([
      expect.objectContaining({ part_id: "usage-prt20a", asset_id: "usage-a20", skill_name: "脚本技能" }),
      expect.objectContaining({ part_id: "usage-prt20b", asset_id: "usage-a20", skill_name: "脚本技能" }),
      expect.objectContaining({ part_id: "usage-prt20c", asset_id: "usage-a20", skill_name: "脚本技能" }),
    ])
  })

  test("同一个 part 里跑两个脚本 ⇒ 仍然只记一行（①A）", async () => {
    await 建用户("usage-u21")
    await insertAsset(pg.db, 资产({ id: "usage-a21", name: "批量技能" }))
    const 根 = 独占根("t21")
    const 源 = 建源库("usage-u21", 根)
    建会话(源, "usage-s21", "usage-p21")
    记调用(源, {
      partId: "usage-prt21",
      sessionId: "usage-s21",
      tool: "bash",
      command:
        'python .opencode/skill/usage-a21/scripts/a.py && python .opencode/skill/usage-a21/scripts/b.py && python .opencode/skill/usage-a21/scripts/c.py',
      timeCreated: 1_790_000_000_000,
    })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(1)
    expect((await 行("usage-u21")).length).toBe(1)
  })

  test("只摸目录不跑脚本 ⇒ 不算（②A）：ls 技能目录、read 非 SKILL.md 都不记", async () => {
    await 建用户("usage-u22")
    await insertAsset(pg.db, 资产({ id: "usage-a22", name: "摸鱼技能" }))
    const 根 = 独占根("t22")
    const 源 = 建源库("usage-u22", 根)
    建会话(源, "usage-s22", "usage-p22")
    记调用(源, {
      partId: "usage-prt22a",
      sessionId: "usage-s22",
      tool: "bash",
      command: "ls -la .opencode/skill/usage-a22",
      timeCreated: 1_790_000_000_000,
    })
    记调用(源, {
      partId: "usage-prt22b",
      sessionId: "usage-s22",
      tool: "read",
      filePath: ".opencode/skill/usage-a22/README.md",
      timeCreated: 1_790_000_010_000,
    })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(0)
    expect((await 行("usage-u22")).length).toBe(0)
  })

  function 记用户消息(
    db: Database,
    input: { readonly id: string; readonly sessionId: string; readonly timeCreated: number },
  ) {
    db.query("insert into message (id, session_id, time_created, time_updated, data) values (?, ?, ?, ?, ?)").run(
      input.id,
      input.sessionId,
      input.timeCreated,
      input.timeCreated,
      JSON.stringify({ role: "user" }),
    )
  }

  test("同一轮里把同一个技能跑三遍 ⇒ 只记一次；下一轮再跑才记第二次（裁定 C）", async () => {
    await 建用户("usage-u30")
    await insertAsset(pg.db, 资产({ id: "usage-a30", name: "轮次技能" }))
    await 启用("usage-p30", "usage-a30", "usage-u30")
    const 根 = 独占根("t30")
    const 源 = 建源库("usage-u30", 根)
    建会话(源, "usage-s30", "usage-p30")

    // 第一轮：一条用户消息，后面跟三次独立的 bash 调用（真栈 20:15 的形状）。
    记用户消息(源, { id: "usage-msg30a", sessionId: "usage-s30", timeCreated: 1_790_000_000_000 })
    记调用(源, {
      partId: "usage-prt30a",
      sessionId: "usage-s30",
      tool: "bash",
      command: "python .opencode/skill/usage-a30/scripts/a.py",
      timeCreated: 1_790_000_001_000,
    })
    记调用(源, {
      partId: "usage-prt30b",
      sessionId: "usage-s30",
      tool: "bash",
      command: "python .opencode/skill/usage-a30/scripts/b.py",
      timeCreated: 1_790_000_002_000,
    })
    记调用(源, {
      partId: "usage-prt30c",
      sessionId: "usage-s30",
      tool: "bash",
      command: "python .opencode/skill/usage-a30/scripts/c.py",
      timeCreated: 1_790_000_003_000,
    })

    const 第一遍 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })
    expect(第一遍.inserted).toBe(1)
    expect(await 行("usage-u30")).toEqual([
      expect.objectContaining({ part_id: "usage-prt30a", asset_id: "usage-a30" }),
    ])

    // 第二轮：新的一条用户消息，再跑一次 ⇒ 这是「第二次使用」。
    记用户消息(源, { id: "usage-msg30b", sessionId: "usage-s30", timeCreated: 1_790_000_100_000 })
    记调用(源, {
      partId: "usage-prt30d",
      sessionId: "usage-s30",
      tool: "bash",
      command: "python .opencode/skill/usage-a30/scripts/a.py",
      timeCreated: 1_790_000_101_000,
    })

    const 第二遍 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_200 })
    expect(第二遍.inserted).toBe(1)
    expect((await 行("usage-u30")).length).toBe(2)

    // 轮次 id 落表：第一行归第一轮、第二行归第二轮。
    const 轮次 = rowsOf(
      await pg.db.execute(sql`
        select part_id, turn_id from auth.asset_usage_event
        where user_id = ${"usage-u30"} order by part_id
      `),
    )
    expect(轮次).toEqual([
      { part_id: "usage-prt30a", turn_id: "usage-msg30a" },
      { part_id: "usage-prt30d", turn_id: "usage-msg30b" },
    ])
  })

  test("未启用的资产被跑了脚本 ⇒ 照样记（归因不查启用台账）", async () => {
    await 建用户("usage-u23")
    await insertAsset(pg.db, 资产({ id: "usage-a23", name: "没启用的技能" }))
    // 注意：**不调用 `启用`**。旧口径下未启用 = 不可归因。
    const 根 = 独占根("t23")
    const 源 = 建源库("usage-u23", 根)
    建会话(源, "usage-s23", "usage-p23")
    记调用(源, {
      partId: "usage-prt23",
      sessionId: "usage-s23",
      tool: "bash",
      command: "python D:/assets/draft/usage-a23/scripts/run.py",
      timeCreated: 1_790_000_000_000,
    })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(1)
    expect(await 行("usage-u23")).toEqual([
      expect.objectContaining({ part_id: "usage-prt23", asset_id: "usage-a23", skill_name: "没启用的技能" }),
    ])
  })

  /**
   * 名字目录回落（2026-11-01 用户裁定 A）。
   *
   * 现场：资产按 `<项目>/.opencode/skill/<资产 id>/` 交付，但项目里同时留着一份**同内容**的
   * 名字目录（真栈实测 `.opencode/skill/html-ppt` 与 `asset_46f47fb1…` 239 个文件全同）。
   * 模型挑了好读的那个名字 ⇒ 命令行里没有资产 id 段 ⇒ 旧口径一条都不记：
   * 王五 22:18–22:21 的 50 条 html-ppt 相关 part，按旧规则可归因 0 条，游标却已推进
   * （`last_updated_sec` 1793542885 晚于全部使用时刻）——不是抽取器停摆，是判定漏了这一入口。
   *
   * 回落卡在「**本项目启用台账里恰好一个同名资产**」，与 `skill` 工具同一条规则（`#010-05`）：
   * 名字是猜测性身份，只在本项目内无歧义时才认。
   */
  test("按技能名目录跑脚本 / 读说明书 / 斜杠命令 ⇒ 回落到唯一同名启用资产", async () => {
    await 建用户("usage-u40")
    await insertAsset(pg.db, 资产({ id: "usage-a40", name: "名字目录技能" }))
    await 启用("usage-p40", "usage-a40", "usage-u40")
    const 根 = 独占根("t40")
    const 源 = 建源库("usage-u40", 根)
    建会话(源, "usage-s40", "usage-p40")

    记调用(源, {
      partId: "usage-prt40a",
      sessionId: "usage-s40",
      tool: "bash",
      command: "bash .opencode/skill/名字目录技能/scripts/new-deck.sh deck 04_PPT",
      timeCreated: 1_790_000_000_000,
    })
    记调用(源, {
      partId: "usage-prt40b",
      sessionId: "usage-s40",
      tool: "read",
      filePath: ".opencode/skill/名字目录技能/SKILL.md",
      timeCreated: 1_790_000_010_000,
    })
    记文本(源, {
      partId: "usage-prt40c",
      sessionId: "usage-s40",
      text: "# Skill: 名字目录技能\n……正文……\n\nBase directory for this skill: .opencode/skill/名字目录技能\nRelative paths in this skill are relative to this base directory.",
      timeCreated: 1_790_000_020_000,
    })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(3)
    expect(await 行("usage-u40")).toEqual([
      expect.objectContaining({ part_id: "usage-prt40a", asset_id: "usage-a40", skill_name: "名字目录技能" }),
      expect.objectContaining({ part_id: "usage-prt40b", asset_id: "usage-a40", skill_name: "名字目录技能" }),
      expect.objectContaining({ part_id: "usage-prt40c", asset_id: "usage-a40", skill_name: "名字目录技能" }),
    ])
  })

  test("名字回落不猜：本项目没启用 / 同名两份 ⇒ 都不记（不退化成全库同名匹配）", async () => {
    await 建用户("usage-u41")
    await insertAsset(pg.db, 资产({ id: "usage-a41x", name: "同名两件" }))
    await insertAsset(pg.db, 资产({ id: "usage-a41y", name: "同名两件" }))
    await 启用("usage-p41", "usage-a41x", "usage-u41")
    await 启用("usage-p41", "usage-a41y", "usage-u41")
    // 库里存在、但项目 p41 没启用：回落只问本项目台账，不能被全库同名吸走。
    await insertAsset(pg.db, 资产({ id: "usage-a41z", name: "没启用的名字" }))
    const 根 = 独占根("t41")
    const 源 = 建源库("usage-u41", 根)
    建会话(源, "usage-s41", "usage-p41")
    记调用(源, {
      partId: "usage-prt41a",
      sessionId: "usage-s41",
      tool: "bash",
      command: "bash .opencode/skill/同名两件/scripts/a.sh",
      timeCreated: 1_790_000_000_000,
    })
    记调用(源, {
      partId: "usage-prt41b",
      sessionId: "usage-s41",
      tool: "bash",
      command: "bash .opencode/skill/没启用的名字/scripts/a.sh",
      timeCreated: 1_790_000_010_000,
    })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(0)
    expect((await 行("usage-u41")).length).toBe(0)
  })

  /**
   * 名字大小写（2026-11-01 用户裁定 A）。
   *
   * 真栈现场：项目 `6db1717a` 的启用台账登记名是 `Archify`，模型调 `skill` 工具传的是
   * `input.name = "archify"` ⇒ 精确比对 0 个候选 ⇒ 记成未归因，使用次数不涨
   * （22:46:54 实测：Archify 资产事件数 0，游标已越过该 part）。
   *
   * 名字来自模型输入，大小写不该决定「认不认得这个技能」。落表的 `skill_name` 统一用
   * **资产登记名**：否则同一资产在报表/检索里会出现 `archify` 与 `Archify` 两种写法。
   *
   * 归一后仍守「唯一」：两个资产名只差大小写 ⇒ 2 个候选 ⇒ 不猜（`#010-05`）。
   */
  test("skill 工具名字忽略大小写：台账 `Archify` 对得上调用 `ArChIfY`", async () => {
    await 建用户("usage-u50")
    await insertAsset(pg.db, 资产({ id: "usage-a50", name: "Archify" }))
    await 启用("usage-p50", "usage-a50", "usage-u50")
    const 根 = 独占根("t50")
    const 源 = 建源库("usage-u50", 根)
    建会话(源, "usage-s50", "usage-p50")
    // 调用名故意用混合大小写：全小写的话，正则化后的键恰好等于调用名，就分不出
    // 「索引侧归一」和「查询侧归一」哪一侧被拆掉（本用例第一版就是这样，变异时没红）。
    记调用(源, { partId: "usage-prt50", sessionId: "usage-s50", name: "ArChIfY" })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(1)
    expect(结果.unattributed).toBe(0)
    expect(await 行("usage-u50")).toEqual([
      expect.objectContaining({ part_id: "usage-prt50", asset_id: "usage-a50", skill_name: "Archify" }),
    ])
  })

  test("大小写归一后仍不猜：两个资产的登记名只差大小写 ⇒ 不记", async () => {
    await 建用户("usage-u51")
    await insertAsset(pg.db, 资产({ id: "usage-a51x", name: "Archify" }))
    await insertAsset(pg.db, 资产({ id: "usage-a51y", name: "ARCHIFY" }))
    await 启用("usage-p51", "usage-a51x", "usage-u51")
    await 启用("usage-p51", "usage-a51y", "usage-u51")
    const 根 = 独占根("t51")
    const 源 = 建源库("usage-u51", 根)
    建会话(源, "usage-s51", "usage-p51")
    记调用(源, { partId: "usage-prt51", sessionId: "usage-s51", name: "archify" })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(0)
    expect(结果.unattributed).toBe(1)
  })
})

async function 形态行(userId: string) {
  const result = await pg.db.execute(
    sql`select part_id, asset_id, kind, tool_name
          from auth.asset_usage_event where user_id = ${userId} order by part_id`,
  )
  return rowsOf(result)
}

describe("MCP 调用（批次 4 · 设计 §7）", () => {
  // 与上面两个 describe 同一理由：共用一个根时，上一条用例里没入表的行（歧义工具名）会在
  // 60 秒回看窗内被下一轮重扫、重复计进 `ambiguous`。
  const 独占根 = (名: string) => {
    const dir = join(ROOT, 名)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  test("MCP 工具按「资产 id 前缀」归因，kind=mcp、tool_name=实际工具名", async () => {
    await 建用户("usage-mcp1")
    await insertAsset(pg.db, 资产({ id: "mcp-fund", name: "资金查询", type: "mcp" }))
    const 根 = 独占根("mcp1")
    const 源 = 建源库("usage-mcp1", 根)
    建会话(源, "usage-mcp-s1", "usage-p-mcp1")
    记调用(源, { partId: "usage-mcp-prt1", sessionId: "usage-mcp-s1", tool: "mcp-fund_query_account" })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(1)
    expect(await 形态行("usage-mcp1")).toEqual([
      { part_id: "usage-mcp-prt1", asset_id: "mcp-fund", kind: "mcp", tool_name: "mcp-fund_query_account" },
    ])
  })

  test("工具名同时命中两个资产（一个是另一个的前缀）⇒ 不归因、计入 ambiguous、不落表", async () => {
    await 建用户("usage-mcp2")
    await insertAsset(pg.db, 资产({ id: "mcp-dup", name: "重复甲", type: "mcp" }))
    await insertAsset(pg.db, 资产({ id: "mcp-dup_x", name: "重复乙", type: "mcp" }))
    const 根 = 独占根("mcp2")
    const 源 = 建源库("usage-mcp2", 根)
    建会话(源, "usage-mcp-s2", "usage-p-mcp2")
    记调用(源, { partId: "usage-mcp-prt2", sessionId: "usage-mcp-s2", tool: "mcp-dup_x_query" })

    const 原warn = console.warn
    const 记录: unknown[][] = []
    console.warn = (...args: unknown[]) => void 记录.push(args)
    try {
      const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })
      expect(结果.inserted).toBe(0)
      expect(结果.ambiguous).toBe(1)
      expect(await 形态行("usage-mcp2")).toEqual([])
      expect(记录.some((args) => String(args[0]).includes("无法唯一归因"))).toBe(true)
    } finally {
      console.warn = 原warn
    }
  })

  test("内建工具（不是任何 MCP 资产的前缀）⇒ 不入表、不计 ambiguous", async () => {
    await 建用户("usage-mcp3")
    await insertAsset(pg.db, 资产({ id: "mcp-fund3", name: "资金查询", type: "mcp" }))
    const 根 = 独占根("mcp3")
    const 源 = 建源库("usage-mcp3", 根)
    建会话(源, "usage-mcp-s3", "usage-p-mcp3")
    记调用(源, { partId: "usage-mcp-prt3", sessionId: "usage-mcp-s3", tool: "edit" })

    const 结果 = await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })

    expect(结果.inserted).toBe(0)
    expect(结果.ambiguous).toBe(0)
    expect(await 形态行("usage-mcp3")).toEqual([])
  })

  test("MCP 调用也只认 completed：running 不入表，完成后重抽才入", async () => {
    await 建用户("usage-mcp4")
    await insertAsset(pg.db, 资产({ id: "mcp-fund4", name: "资金查询", type: "mcp" }))
    const 根 = 独占根("mcp4")
    const 源 = 建源库("usage-mcp4", 根)
    建会话(源, "usage-mcp-s4", "usage-p-mcp4")
    记调用(源, {
      partId: "usage-mcp-prt4",
      sessionId: "usage-mcp-s4",
      tool: "mcp-fund4_query_account",
      status: "running",
    })
    expect((await 抽取({ db: pg.db, root: 根, now: 1_790_000_100 })).inserted).toBe(0)

    // 完成态：同一 id 被 UPDATE，`time_updated` 往前走（与既有用例第 266 行同一写法）。
    源.query("update part set time_updated = ?, data = ? where id = ?").run(
      1_790_000_060_123,
      JSON.stringify({
        type: "tool",
        tool: "mcp-fund4_query_account",
        callID: "call_usage-mcp-prt4",
        state: {
          status: "completed",
          input: {},
          output: "",
          title: "",
          metadata: {},
          time: { start: 1_790_000_000_123, end: 1_790_000_060_123 },
        },
      }),
      "usage-mcp-prt4",
    )

    expect((await 抽取({ db: pg.db, root: 根, now: 1_790_000_200 })).inserted).toBe(1)
    expect((await 形态行("usage-mcp4")).map((row) => row.kind)).toEqual(["mcp"])
  })
})
