import { afterAll, beforeAll, expect, test } from "bun:test"
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

test("写一条审计：字段逐字落库，按项目倒序列出", async () => {
  const before = Math.floor(Date.now() / 1000)
  await recordBackupEvent(pg.db, {
    projectId: "p-42",
    userId: "007",
    action: "backup",
    snapshotId: "20261018T140305123Z-abcdef",
    detail: { files: 3, bytes: 9 },
  })
  const rows = await listBackupEvents(pg.db, "p-42")
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    project_id: "p-42",
    user_id: "007",
    action: "backup",
    snapshot_id: "20261018T140305123Z-abcdef",
    detail: { files: 3, bytes: 9 },
  })
  // `created_at` 是 **Unix 秒**（auth 其余表同口径），不是毫秒、也不是「写死一个数」。
  expect(rows[0]!.created_at).toBeGreaterThanOrEqual(before)
  expect(rows[0]!.created_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
})

test("detail 可省略", async () => {
  await recordBackupEvent(pg.db, { projectId: "p-99", userId: "008", action: "restore" })
  expect((await listBackupEvents(pg.db, "p-99"))[0]?.detail).toBeNull()
})
