import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import type { GrantRow } from "@opencode-ai/auth/rbac"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { insertAsset } from "./asset"
import { authorizeTransition } from "./review"
import { canReadAsset, effectivePermissions, type AssetViewer } from "./authorization"
import type { AssetMetadata } from "./metadata"
import {
  addFavorite,
  favoriteAssetIds,
  isFavorite,
  lastUsedAtOf,
  orderForDrawer,
  recordUsage,
  removeFavorite,
  type DrawerCandidate,
} from "./preferences"

/**
 * 009 T011 · 授权 vs 收藏分离（FR-007）。
 *
 * 判据分四块：
 * ① 收藏与使用记录本身可增删、缓存列跟着走；
 * ② **收藏不改授权**——收藏了读不到的资产仍然读不到，收藏人仍然过不了审核关；
 * ③ 抽屉排序按「最近使用 → 使用次数 → 收藏 → id」确定且稳定；
 * ④ 资产 / 用户删除时记录级联消失。
 */

const databases: ProductionDb[] = []

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.stop()))
})

async function freshDb(): Promise<ProductionDb["db"]> {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  for (const [id, name, dept] of [
    ["u1", "甲民警", "经侦支队"],
    ["u2", "乙民警", "法制支队"],
    ["u3", "丙民警", "科信支队"],
  ] as const) {
    await database.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${id}, ${`0100${id.slice(1)}`}, ${name}, 'x', 'x', 'x', ${dept}, 'x', 0, 'h', 0)
    `)
  }
  return database.db
}

function metadata(overrides: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset_1",
    name: "资金流水分析",
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
    ...overrides,
  }
}

async function insertTwoAssets(db: ProductionDb["db"]): Promise<void> {
  await insertAsset(db, metadata())
  await insertAsset(db, metadata({ id: "asset_2", name: "话单碰撞" }))
}

async function favoriteCount(db: ProductionDb["db"], assetId = "asset_1"): Promise<number> {
  const [row] = rowsOf(
    await db.execute(sql`select favorite_count from auth.asset where id = ${assetId}`),
  )
  return Number(row!.favorite_count)
}

async function usageCount(db: ProductionDb["db"], assetId = "asset_1"): Promise<number> {
  const [row] = rowsOf(
    await db.execute(sql`select usage_count from auth.asset where id = ${assetId}`),
  )
  return Number(row!.usage_count)
}

const viewerOf = (userId: string, department: string): AssetViewer => ({ userId, department })

describe("收藏（个人偏好）", () => {
  test("收藏一次 +1，重复收藏不重复计数、返回 false", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())

    expect(await addFavorite(db, { userId: "u1", assetId: "asset_1", now: 100 })).toBe(true)
    expect(await favoriteCount(db)).toBe(1)

    expect(await addFavorite(db, { userId: "u1", assetId: "asset_1", now: 200 })).toBe(false)
    expect(await favoriteCount(db)).toBe(1)
  })

  test("取消收藏 -1；未收藏时取消返回 false，计数不会掉到负数", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())
    await addFavorite(db, { userId: "u1", assetId: "asset_1", now: 100 })

    expect(await removeFavorite(db, { userId: "u1", assetId: "asset_1" })).toBe(true)
    expect(await favoriteCount(db)).toBe(0)

    expect(await removeFavorite(db, { userId: "u1", assetId: "asset_1" })).toBe(false)
    expect(await favoriteCount(db)).toBe(0)
  })

  test("isFavorite 只回答「我」有没有收藏，不回答别人", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())
    await addFavorite(db, { userId: "u1", assetId: "asset_1" })

    expect(await isFavorite(db, { userId: "u1", assetId: "asset_1" })).toBe(true)
    expect(await isFavorite(db, { userId: "u2", assetId: "asset_1" })).toBe(false)
  })

  test("我的收藏按收藏时间倒序（同时间按 id 升序）", async () => {
    const db = await freshDb()
    await insertTwoAssets(db)
    await addFavorite(db, { userId: "u2", assetId: "asset_1", now: 100 })
    await addFavorite(db, { userId: "u2", assetId: "asset_2", now: 200 })

    expect(await favoriteAssetIds(db, "u2")).toEqual(["asset_2", "asset_1"])
  })
})

describe("收藏不改授权（FR-007 的核心出参）", () => {
  test("收藏了别人的个人资产：仍然读不到，权限集为空", async () => {
    const db = await freshDb()
    const asset = metadata({ visibility: "personal", department: "", ownerId: "u1" })
    await insertAsset(db, asset)
    await addFavorite(db, { userId: "u2", assetId: asset.id })

    const viewer = viewerOf("u2", "法制支队")
    expect(await isFavorite(db, { userId: "u2", assetId: asset.id })).toBe(true)
    expect(effectivePermissions(viewer, asset, [])).toEqual(new Set())
    expect(canReadAsset(viewer, asset, [])).toBe(false)
  })

  test("收藏了别的部门的部门资产：仍然读不到", async () => {
    const db = await freshDb()
    const asset = metadata({ visibility: "department", department: "经侦支队" })
    await insertAsset(db, asset)
    await addFavorite(db, { userId: "u3", assetId: asset.id })

    const viewer = viewerOf("u3", "科信支队")
    expect(canReadAsset(viewer, asset, [])).toBe(false)
  })

  test("收藏不是审核授权：收藏人执行审核动作仍然被拒", async () => {
    const db = await freshDb()
    const asset = metadata({ status: "in_review" })
    await insertAsset(db, asset)
    await addFavorite(db, { userId: "u2", assetId: asset.id })

    const viewer = viewerOf("u2", "法制支队")
    const grants: GrantRow[] = []
    expect(() => authorizeTransition(viewer, asset, grants, "approve_business")).toThrow(
      /不能执行 approve_business/,
    )
  })
})

describe("使用记录（最近使用 / 使用次数）", () => {
  test("首次使用：次数 +1、记下时间；重复使用只更新时间并继续累计次数", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())

    await recordUsage(db, { userId: "u2", assetId: "asset_1", now: 100 })
    expect(await usageCount(db)).toBe(1)
    expect(await lastUsedAtOf(db, "u2")).toEqual(new Map([["asset_1", 100]]))

    await recordUsage(db, { userId: "u2", assetId: "asset_1", now: 300 })
    expect(await usageCount(db)).toBe(2)
    expect(await lastUsedAtOf(db, "u2")).toEqual(new Map([["asset_1", 300]]))
  })

  test("最近使用按用户隔离：别人的使用不会把我排序提前", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())
    await recordUsage(db, { userId: "u3", assetId: "asset_1", now: 100 })

    expect(await lastUsedAtOf(db, "u2")).toEqual(new Map())
  })
})

describe("抽屉排序（设计 §1.5：分组内最近使用上浮 + 收藏加权）", () => {
  const candidate = (id: string, usageCount: number): DrawerCandidate => ({ id, usageCount })

  test("最近使用过的排在没使用过的前面，哪怕后者使用次数更高", async () => {
    const items = [candidate("hot", 99), candidate("recent", 1)]
    const ordered = orderForDrawer(items, {
      favorites: new Set(),
      lastUsedAt: new Map([["recent", 500]]),
    })

    expect(ordered.map((item) => item.id)).toEqual(["recent", "hot"])
  })

  test("都没使用过时按使用次数降序（高频在前）", async () => {
    const items = [candidate("low", 1), candidate("high", 20)]
    expect(
      orderForDrawer(items, { favorites: new Set(), lastUsedAt: new Map() }).map((item) => item.id),
    ).toEqual(["high", "low"])
  })

  test("收藏不会越过高频：收藏的低频资产仍排在未收藏的高频之后（收藏低频排后）", async () => {
    const items = [candidate("fav_low", 1), candidate("hot", 20)]
    expect(
      orderForDrawer(items, {
        favorites: new Set(["fav_low"]),
        lastUsedAt: new Map(),
      }).map((item) => item.id),
    ).toEqual(["hot", "fav_low"])
  })

  test("使用次数相同时收藏的靠前；其余按 id 升序，结果稳定", async () => {
    const items = [candidate("asset_b", 5), candidate("asset_c", 5), candidate("asset_a", 5)]
    const prefs = { favorites: new Set(["asset_c"]), lastUsedAt: new Map<string, number>() }

    expect(orderForDrawer(items, prefs).map((item) => item.id)).toEqual([
      "asset_c",
      "asset_a",
      "asset_b",
    ])
    // 同一份输入重复排序结果一致（比较器不引入随机性）。
    expect(orderForDrawer(items, prefs).map((item) => item.id)).toEqual([
      "asset_c",
      "asset_a",
      "asset_b",
    ])
  })

  test("收藏只排序不过滤：没有任何「无权就消失」的语义在这里发生", async () => {
    const items = [candidate("a", 0), candidate("b", 0), candidate("c", 0)]
    expect(
      orderForDrawer(items, { favorites: new Set(["a"]), lastUsedAt: new Map() }),
    ).toHaveLength(3)
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c"]) // 入参不被就地改写
  })
})

describe("寿命（级联删除）", () => {
  test("资产删除：收藏与使用记录一起消失，不留悬空行", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())
    await addFavorite(db, { userId: "u1", assetId: "asset_1" })
    await recordUsage(db, { userId: "u1", assetId: "asset_1" })

    await db.execute(sql`delete from auth.asset where id = 'asset_1'`)

    const [favorites] = rowsOf(await db.execute(sql`select count(*) as n from auth.asset_favorite`))
    const [usages] = rowsOf(await db.execute(sql`select count(*) as n from auth.asset_usage`))
    expect(Number(favorites!.n)).toBe(0)
    expect(Number(usages!.n)).toBe(0)
  })

  test("用户删除：只为该用户清掉收藏与使用记录，别人的保留", async () => {
    const db = await freshDb()
    // 资产归 u1；被删的是 u2（删除作者会被 asset_owner_id_fkey 挡住，那是另一回事）。
    await insertAsset(db, metadata())
    await addFavorite(db, { userId: "u2", assetId: "asset_1" })
    await addFavorite(db, { userId: "u3", assetId: "asset_1" })
    await recordUsage(db, { userId: "u2", assetId: "asset_1" })

    await db.execute(sql`delete from auth.user where id = 'u2'`)

    expect(await favoriteAssetIds(db, "u3")).toEqual(["asset_1"])
    expect(await isFavorite(db, { userId: "u2", assetId: "asset_1" })).toBe(false)
    expect(await lastUsedAtOf(db, "u2")).toEqual(new Map())
  })
})
