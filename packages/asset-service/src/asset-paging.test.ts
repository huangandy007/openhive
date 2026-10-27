import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { grantsFor } from "@opencode-ai/auth/rbac"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { canReadAsset } from "./authorization"
import { countAssets, insertAsset, listAssets } from "./asset"
import type { AssetMetadata } from "./metadata"

/**
 * 需求 6 · 服务端分页（2026-10-27）。
 *
 * 三件事分开钉：
 * ① **切片正确**：`limit/offset` 作用在「已按 `updated_at desc, id asc` 排好的全序」上，
 *    不是先切再排（那会翻页跳条）；
 * ② **总数与列表同源**：`countAssets` 与 `listAssets` 用同一份条件——两处各写一份 WHERE，
 *    就会出现「总数说有 25 条、翻到第 2 页只剩 3 条」；
 * ③ **可见性进 WHERE**：`readableBy` 让「能看见多少」由库回答，而不是取回 20 条再内存筛
 *    （后者正是「每页条数忽多忽少」的来源）。
 */

const databases: ProductionDb[] = []

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.stop()))
})

async function freshDb(): Promise<ProductionDb["db"]> {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  await database.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values
      ('u1', '010001', '甲民警', 'x', 'x', '市局', '经侦支队', 'x', 0, 'h', 0),
      ('u2', '020002', '乙民警', 'x', 'x', '市局', '刑侦支队', 'x', 0, 'h', 0)
  `)
  return database.db
}

function row(id: string, overrides: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id,
    name: `资产 ${id}`,
    type: "skill",
    description: "分页夹具",
    icon: "skill",
    category: "intelligence",
    tags: [],
    ownerId: "u1",
    ownerName: "甲民警",
    department: "经侦支队",
    visibility: "global",
    version: 1,
    status: "published",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    publishedAt: 1000,
    archivedAt: null,
    ...overrides,
  }
}

/** 五条，`updated_at` 递增 ⇒ 全序是 a5, a4, a3, a2, a1（desc）。 */
async function seedFive(db: ProductionDb["db"]): Promise<void> {
  for (let i = 1; i <= 5; i += 1) {
    await insertAsset(db, row(`a${i}`, { updatedAt: 1000 + i }))
  }
}

describe("迁移 0018：分页索引", () => {
  test("四条索引都建在 auth.asset 上", async () => {
    const db = await freshDb()
    const rows = rowsOf(
      await db.execute(sql`
        select indexname from pg_indexes
        where schemaname = 'auth' and tablename = 'asset'
        order by indexname
      `),
    )
    const names = rows.map((row) => String(row.indexname))

    expect(names).toContain("asset_status_updated_idx")
    expect(names).toContain("asset_updated_idx")
    expect(names).toContain("asset_owner_status_idx")
    expect(names).toContain("asset_category_idx")
  })
})

describe("listAssets 分页", () => {
  test("不传分页参数时行为不变：返回全部", async () => {
    const db = await freshDb()
    await seedFive(db)

    expect((await listAssets(db)).map((asset) => asset.id)).toEqual(["a5", "a4", "a3", "a2", "a1"])
  })

  test("limit/offset 切在排好序的全序上（不是先切再排）", async () => {
    const db = await freshDb()
    await seedFive(db)

    expect((await listAssets(db, {}, { limit: 2, offset: 1 })).map((asset) => asset.id)).toEqual(["a4", "a3"])
    expect((await listAssets(db, {}, { limit: 2, offset: 4 })).map((asset) => asset.id)).toEqual(["a1"])
    expect((await listAssets(db, {}, { limit: 2, offset: 10 })).map((asset) => asset.id)).toEqual([])
  })

  test("非法分页参数当场抛错，不下发非法 SQL", async () => {
    const db = await freshDb()
    await seedFive(db)

    await expect(listAssets(db, {}, { limit: 0, offset: 0 })).rejects.toThrow("limit")
    await expect(listAssets(db, {}, { limit: 1.5, offset: 0 })).rejects.toThrow("limit")
    await expect(listAssets(db, {}, { limit: 1, offset: -1 })).rejects.toThrow("offset")
  })
})

describe("countAssets 与 listAssets 同源", () => {
  test("同一份筛选下：总数 = 不分页列表长度", async () => {
    const db = await freshDb()
    await seedFive(db)
    await insertAsset(db, row("m1", { type: "mcp" }))

    expect(await countAssets(db)).toBe(6)
    expect(await countAssets(db, { type: "skill" })).toBe(5)
    expect(await countAssets(db, { type: "mcp" })).toBe(1)
    expect(await countAssets(db, { type: "mcp" })).toBe((await listAssets(db, { type: "mcp" })).length)
  })

  test("总数不受分页参数影响，但受可见性条件影响", async () => {
    const db = await freshDb()
    await seedFive(db)
    await insertAsset(db, row("p1", { visibility: "personal", department: "" }))
    await insertAsset(db, row("d1", { visibility: "department", department: "刑侦支队" }))

    const viewer = { userId: "u2", department: "刑侦支队" }
    const filters = { readableBy: viewer }

    const all = await listAssets(db, filters)
    expect(all.length).toBeGreaterThan(1)
    expect(await countAssets(db, filters)).toBe(all.length)
    // 分页只切列表，不切总数：取一条，总数仍是全量。
    expect((await listAssets(db, filters, { limit: 1, offset: 0 })).length).toBe(1)
    expect(await countAssets(db, filters)).toBe(all.length)
  })
})

describe("多空间过滤（左栏三个空间是复选）", () => {
  test("visibility 传数组 = in (...) ；空数组 = 空集，不是「不过滤」", async () => {
    const db = await freshDb()
    await seedFive(db) // 五条都是 global
    await insertAsset(db, row("d1", { visibility: "department", department: "经侦支队" }))
    await insertAsset(db, row("p1", { visibility: "personal", department: "" }))

    expect((await listAssets(db, { visibility: ["global"] })).length).toBe(5)
    expect((await listAssets(db, { visibility: ["department", "personal"] })).map((a) => a.id).sort()).toEqual([
      "d1",
      "p1",
    ])
    // 用户把三个空间全取消：结果是空集。若这里回全量，「取消」就永远取消不掉（`#006-22`）。
    expect(await listAssets(db, { visibility: [] })).toEqual([])
    expect(await countAssets(db, { visibility: [] })).toBe(0)
  })
})

describe("readableBy：可见性进 WHERE", () => {
  test("SQL 筛出的集合 = canReadAsset 逐条判出的集合", async () => {
    const db = await freshDb()
    await seedFive(db)
    await insertAsset(db, row("p1", { visibility: "personal", department: "" }))
    await insertAsset(db, row("d1", { visibility: "department", department: "刑侦支队" }))
    await insertAsset(db, row("d2", { status: "draft", visibility: "department", department: "刑侦支队" }))

    for (const viewer of [
      { userId: "u1", department: "经侦支队" },
      { userId: "u2", department: "刑侦支队" },
    ]) {
      const grants = await grantsFor(db, viewer.userId)
      const expected = (await listAssets(db))
        .filter((asset) => canReadAsset(viewer, asset, grants))
        .map((asset) => asset.id)
        .sort()
      const actual = (await listAssets(db, { readableBy: viewer })).map((asset) => asset.id).sort()

      expect(actual).toEqual(expected)
      expect(await countAssets(db, { readableBy: viewer })).toBe(expected.length)
    }
  })
})
