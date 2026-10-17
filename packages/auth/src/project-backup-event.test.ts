import { afterAll, beforeAll, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { startProductionDb, type ProductionDb } from "./test-support"
import { migrate } from "./migrate"
import { listBackupEvents, recordBackupEvent } from "./project-backup-event"

let pg: ProductionDb
beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
})
afterAll(async () => {
  // beforeAll 抛错时 pg 从未赋值——这里不能跟着再抛一个错掩盖真因。
  await pg?.stop()
})

test("写一条审计：12 列逐字往返，created_at 是 Unix 秒", async () => {
  const before = Math.floor(Date.now() / 1000)
  await recordBackupEvent(pg.db, {
    projectId: "p-42",
    userId: "007",
    action: "backup",
    snapshotId: "20261018T140305123Z-abcdef",
    scope: "资料/甲",
    kind: "manual",
    files: 3,
    bytes: 9,
    result: "ok",
    errorCode: null,
    durationMs: 12,
  })
  const rows = await listBackupEvents(pg.db, "p-42")
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    user_id: "007",
    project_id: "p-42",
    action: "backup",
    snapshot_id: "20261018T140305123Z-abcdef",
    scope: "资料/甲",
    kind: "manual",
    files: 3,
    bytes: 9,
    result: "ok",
    error_code: null,
    duration_ms: 12,
  })
  // `id` / `created_at` 覆盖 12 列里的剩下两列：id 是 BIGSERIAL、created_at 是 **Unix 秒**。
  expect(rows[0]!.id).toBeGreaterThan(0)
  expect(rows[0]!.created_at).toBeGreaterThanOrEqual(before)
  expect(rows[0]!.created_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
})

test("可选字段缺省：scope 空串、kind/error_code 为 null、计数为 0", async () => {
  await recordBackupEvent(pg.db, { projectId: "p-99", userId: "008", action: "restore", result: "ok" })
  expect((await listBackupEvents(pg.db, "p-99"))[0]).toMatchObject({
    snapshot_id: null,
    scope: "",
    kind: null,
    files: 0,
    bytes: 0,
    error_code: null,
    duration_ms: 0,
  })
})

test("按 created_at 倒序、同秒按 id 倒序", async () => {
  // ⚠️ 这里直接落库、不调 `recordBackupEvent`：helper 只会写「现在」，写不出确定的秒差；
  // 而被测量的是 `listBackupEvents` 的排序，不是写入。三类行钉死两个性质：
  //   a 更早（created_at DESC 会把它排在最后，尽管它的 id 最小）
  //   b / c 同秒（靠 id DESC 决定 c 在 b 前）
  const at = 1_700_000_000
  const insert = (userId: string, createdAt: number, result: string) =>
    pg.db.execute(sql`
      INSERT INTO auth.project_backup_event (user_id, project_id, action, result, created_at)
      VALUES (${userId}, ${"p-sort"}, ${"backup"}, ${result}, ${createdAt})
    `)
  await insert("a", at, "ok")
  await insert("b", at + 1, "ok")
  await insert("c", at + 1, "failed")

  const rows = await listBackupEvents(pg.db, "p-sort")
  expect(rows.map((row) => row.user_id)).toEqual(["c", "b", "a"])
})

test("limit 只回最新的 N 行", async () => {
  const write = (userId: string) =>
    recordBackupEvent(pg.db, { projectId: "p-limit", userId, action: "backup", result: "ok" })
  await write("a")
  await write("b")
  await write("c")

  expect((await listBackupEvents(pg.db, "p-limit", 2)).map((row) => row.user_id)).toEqual(["c", "b"])
})

test("没有审计的项目 ⇒ 空数组", async () => {
  expect(await listBackupEvents(pg.db, "p-none")).toEqual([])
})
