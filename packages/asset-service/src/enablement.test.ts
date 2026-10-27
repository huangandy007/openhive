import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { insertAsset } from "./asset"
import type { AssetMetadata } from "./metadata"
import {
  disableAsset,
  enableAsset,
  enabledAssetIds,
  enablementOf,
  ENABLEMENT_LIMIT,
} from "./enablement"

// 夹具：`beforeAll` 里建好两个用户与 25 份 published 资产（id 形如 `asset_t01`），
// 以及两个项目 id（`proj_a` / `proj_b`）。具体写法照抄 `preferences.test.ts` 的
// `startProductionDb` + `migrate` + 手工 insert，不要新写一份。
//
// ⚠️ 用例之间的独立性：没有给每个用例换项目 id（那会把简报里的 `proj_a` / `proj_b`
// 字面量全部改掉），而是 `beforeEach` 清空启用表——启用关系是这组用例**唯一**的跨用例
// 状态，用户 / 资产是只读夹具。清表之后，原本「依赖上一条用例留下的行」的两处
// （停用那条要 proj_b 里已有 asset_t01、两项目互不相干要 proj_a 里已有 asset_t01）
// 在用例开头自己把前置行启用回来，断言保持简报原文。
const databases: ProductionDb[] = []
let db: ProductionDb["db"]

function metadata(id: string): AssetMetadata {
  return {
    id,
    name: `资产 ${id}`,
    type: "skill",
    description: "按账户汇总流水",
    icon: "skill",
    category: "intelligence",
    tags: ["资金"],
    ownerId: "u1",
    ownerName: "甲民警",
    department: "经侦支队",
    visibility: "department",
    version: 1,
    status: "published",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    publishedAt: 1_000,
    archivedAt: null,
  }
}

beforeAll(async () => {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  db = database.db
  for (const [id, name, dept] of [
    ["u1", "甲民警", "经侦支队"],
    ["u2", "乙民警", "法制支队"],
  ] as const) {
    await database.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${id}, ${`0100${id.slice(1)}`}, ${name}, 'x', 'x', 'x', ${dept}, 'x', 0, 'h', 0)
    `)
  }
  // 25 份：第 21 个用例要「20 个都在、第 21 个被挡」，资产必须真够 25 份。
  for (let index = 1; index <= 25; index += 1) {
    await insertAsset(database.db, metadata(`asset_t${String(index).padStart(2, "0")}`))
  }
})

afterAll(async () => {
  await Promise.all(databases.splice(0).map((database) => database.stop()))
})

beforeEach(async () => {
  await db.execute(sql`delete from auth.project_asset_enablement`)
})

describe("enablement", () => {
  test("空项目：启用集合为空，上限是 20", async () => {
    const state = await enablementOf(db, "proj_a")
    expect(state).toEqual({ enabled: [], enabledCount: 0, limit: ENABLEMENT_LIMIT })
    expect(ENABLEMENT_LIMIT).toBe(20)
  })

  test("启用一次写入一行，重复启用是空操作（不重复计数）", async () => {
    expect(await enableAsset(db, { projectId: "proj_a", assetId: "asset_t01", userId: "u1", now: 1000 })).toBe(
      "enabled",
    )
    expect(await enableAsset(db, { projectId: "proj_a", assetId: "asset_t01", userId: "u1", now: 2000 })).toBe(
      "already_enabled",
    )
    expect(await enabledAssetIds(db, "proj_a")).toEqual(["asset_t01"])
    // 启用人/时间以**首次**为准：第二次不覆盖
    const rows = rowsOf(
      await db.execute(sql`
        select enabled_by, enabled_at from auth.project_asset_enablement
         where project_id = 'proj_a' and asset_id = 'asset_t01'
      `),
    )
    expect(rows).toEqual([{ enabled_by: "u1", enabled_at: 1000 }])
  })

  test("第 21 个被上限挡下，前 20 个都在", async () => {
    for (let index = 1; index <= ENABLEMENT_LIMIT; index += 1) {
      const id = `asset_t${String(index).padStart(2, "0")}`
      await enableAsset(db, { projectId: "proj_b", assetId: id, userId: "u1", now: 1000 })
    }
    expect(await enableAsset(db, { projectId: "proj_b", assetId: "asset_t21", userId: "u1", now: 1000 })).toBe(
      "limit_reached",
    )
    const state = await enablementOf(db, "proj_b")
    expect(state.enabledCount).toBe(ENABLEMENT_LIMIT)
    expect(state.enabled).not.toContain("asset_t21")
  })

  test("停用删掉那一行；再停用一次返回 false", async () => {
    // 本用例只关心「删到 / 没删到」，前置一行由它自己造（`beforeEach` 已清表）。
    await enableAsset(db, { projectId: "proj_b", assetId: "asset_t01", userId: "u1", now: 1000 })
    expect(await disableAsset(db, { projectId: "proj_b", assetId: "asset_t01" })).toBe(true)
    expect(await disableAsset(db, { projectId: "proj_b", assetId: "asset_t01" })).toBe(false)
    expect(await enabledAssetIds(db, "proj_b")).not.toContain("asset_t01")
  })

  test("两个项目互不相干", async () => {
    // proj_a 里先有一份（`beforeEach` 已清表），再验 proj_b 的写入不会串过去。
    await enableAsset(db, { projectId: "proj_a", assetId: "asset_t01", userId: "u1", now: 1000 })
    await enableAsset(db, { projectId: "proj_a", assetId: "asset_t02", userId: "u1", now: 1000 })
    expect(await enabledAssetIds(db, "proj_a")).toEqual(["asset_t01", "asset_t02"])
    expect(await enabledAssetIds(db, "proj_b")).not.toContain("asset_t02")
  })
})
