import { afterEach, describe, expect, test } from "bun:test"
import { getTableColumns, sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { pgErrorCode } from "@opencode-ai/auth/pg-errors"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import {
  asset,
  assetById,
  AssetMetadataError,
  countAssets,
  deleteAsset,
  insertAsset,
  listAssets,
  updateAssetCategories,
  updateAssetLifecycle,
} from "./asset"
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  type AssetMetadata,
} from "./metadata"

/**
 * 009 T003 · 资产元数据表（auth.asset）。
 *
 * 表结构的真相来源是 `packages/auth/src/migrations/0009_asset.sql`；本文件做三件事：
 * ① 防漂移：drizzle 模型 ⇔ 迁移列（名字 + 可空性）；
 * ② 闭集防漂移：DB CHECK ⇔ T001 的 `ASSET_TYPES` / `ASSET_VISIBILITIES` / `ASSET_STATUSES`；
 * ③ 仓储行为：写入 / 读取 / 过滤 / 删除，以及「不合法元数据在碰库之前就被拦下」。
 *
 * 走 `startProductionDb()`（bun-sql 生产驱动 + PGlite），不另起一个 PGlite 直连：
 * 这样 `rowsOf` 走的也是生产形态（裸数组），避免只在测试驱动上绿。
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
    values ('u1', '010001', '甲民警', 'x', 'x', 'x', '经侦支队', 'x', 0, 'h', 0)
  `)
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
    tags: ["资金", "流水"],
    ownerId: "u1",
    ownerName: "甲民警",
    department: "经侦支队",
    visibility: "department",
    version: 1,
    status: "in_review",
    favoriteCount: 0,
    usageCount: 0,
    rating: 4.5,
    ratingCount: 2,
    feedbackCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    publishedAt: null,
    archivedAt: null,
    ...overrides,
  }
}

/**
 * 期望抛错的一次调用。**保留原始错误**（不剥 drizzle 的包壳）。
 *
 * SQLSTATE 由 `@opencode-ai/auth/pg-errors` 的 `pgErrorCode` 取——它同时认 PGlite
 * （`cause.code`）与生产 bun-sql（`cause.errno`）两种形状。测试自己写一份
 * 「先 code 后 errno」的口径会踩到驱动的内部码（实测：`code` 是
 * `ERR_POSTGRES_SERVER_ERROR`，SQLSTATE 在 `errno` 上），这里不再复述那份判断。
 */
async function failure(run: () => Promise<unknown>): Promise<Error> {
  const caught = await run().then(
    () => null,
    (error: unknown) => error,
  )
  if (!(caught instanceof Error)) throw new Error("期望这次调用抛错，它却成功了")
  return caught
}

function errorCode(error: Error): string {
  return pgErrorCode(error) ?? ""
}

const literalsOf = (definition: string): string[] =>
  [...definition.matchAll(/'([^']*)'/g)].map((match) => match[1]!).sort()

async function constraintDefOf(db: ProductionDb["db"], name: string): Promise<string> {
  const rows = rowsOf(
    await db.execute(sql`
      select conname as name, pg_get_constraintdef(oid) as def
      from pg_constraint
      where conname = ${name}
    `),
  )
  expect(rows).toHaveLength(1)
  return String(rows[0]!.def)
}

describe("auth.asset 表模型", () => {
  test("防漂移：drizzle 模型与迁移建出的列逐列一致（名字 + 可空性）", async () => {
    const db = await freshDb()

    const migrated = rowsOf(
      await db.execute(sql`
        select column_name, is_nullable from information_schema.columns
        where table_schema = 'auth' and table_name = 'asset'
        order by column_name
      `),
    ).map((row) => ({ column_name: String(row.column_name), is_nullable: String(row.is_nullable) }))

    const modeled = Object.values(getTableColumns(asset))
      .map((column) => ({ column_name: column.name, is_nullable: column.notNull ? "NO" : "YES" }))
      .sort((a, b) => a.column_name.localeCompare(b.column_name))

    expect(migrated).toEqual(modeled)
  })

  test("闭集防漂移：DB 的 type / visibility / status CHECK ⇔ T001 常量（逐值，双向）", async () => {
    const db = await freshDb()

    expect(literalsOf(await constraintDefOf(db, "asset_type_check"))).toEqual([...ASSET_TYPES].sort())
    expect(literalsOf(await constraintDefOf(db, "asset_visibility_check"))).toEqual(
      [...ASSET_VISIBILITIES].sort(),
    )
    expect(literalsOf(await constraintDefOf(db, "asset_status_check"))).toEqual(
      [...ASSET_STATUSES].sort(),
    )
  })

  test("department 可见范围必须有部门：迁移里落了一条显式命名的 CHECK", async () => {
    const db = await freshDb()
    expect(await constraintDefOf(db, "asset_department_required_check")).toContain("department")
  })
})

describe("资产仓储（T003）", () => {
  test("写入后可完整读回：tags、评分、空时间戳都不丢形状", async () => {
    const db = await freshDb()
    const input = metadata()

    await insertAsset(db, input)

    expect(await assetById(db, input.id)).toEqual(input)
  })

  test("不合法元数据在碰库之前就被拦下，且错误一次列全", async () => {
    const db = await freshDb()

    const error = await failure(() =>
      insertAsset(
        db,
        metadata({
          name: " ",
          version: 0,
          rating: 6,
        }),
      ),
    )

    if (!(error instanceof AssetMetadataError)) throw new Error(`期望 AssetMetadataError，实得 ${error.name}`)
    expect(error.issues).toContainEqual({ field: "name", message: "不能为空" })
    expect(error.issues).toContainEqual({ field: "version", message: "必须是从 1 开始的整数" })
    expect(error.issues).toContainEqual({ field: "rating", message: "必须是 0 到 5 之间的数字" })
    expect(await assetById(db, "asset_1")).toBeUndefined()
  })

  test("所有者外键：不存在的 owner_id 被数据库拒绝", async () => {
    const db = await freshDb()

    const error = await failure(() => insertAsset(db, metadata({ ownerId: "missing" })))
    expect(errorCode(error)).toBe("23503")
  })

  test("主键冲突：同一个资产 id 不能写两次", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())

    const error = await failure(() => insertAsset(db, metadata()))
    expect(errorCode(error)).toBe("23505")
  })

  test("列表：按更新时间倒序，并支持类型 / 状态 / 分类 / 可见范围 / 搜索过滤", async () => {
    const db = await freshDb()

    await insertAsset(
      db,
      metadata({
        id: "a1",
        name: "资金分析",
        description: "查流水",
        type: "skill",
        category: "intelligence",
        status: "in_review",
        visibility: "department",
        updatedAt: 3_000,
      }),
    )
    await insertAsset(
      db,
      metadata({
        id: "a2",
        name: "案件查询",
        description: "查案件",
        type: "mcp",
        category: "case-handling",
        status: "published",
        visibility: "global",
        updatedAt: 2_000,
      }),
    )
    await insertAsset(
      db,
      metadata({
        id: "a3",
        name: "话单分析",
        description: "查话单",
        type: "skill",
        category: "case-handling",
        status: "draft",
        visibility: "personal",
        updatedAt: 1_000,
      }),
    )

    const ids = (rows: AssetMetadata[]) => rows.map((row) => row.id)

    expect(ids(await listAssets(db))).toEqual(["a1", "a2", "a3"])
    expect(ids(await listAssets(db, { type: "skill" }))).toEqual(["a1", "a3"])
    expect(ids(await listAssets(db, { status: "published" }))).toEqual(["a2"])
    expect(ids(await listAssets(db, { category: "case-handling" }))).toEqual(["a2", "a3"])
    expect(ids(await listAssets(db, { visibility: "global" }))).toEqual(["a2"])
    expect(ids(await listAssets(db, { search: "话单" }))).toEqual(["a3"])
  })

  /**
   * 需求 2（2026-10-27）：「其他」兜底与批量改分类。
   *
   * 兜底口径是**「分类不在启用清单里」**，不是「分类为空」——`category` 是 NOT NULL，
   * 空分类这种情形不存在。停用的分类算兜底、库里根本没有的 id 也算（历史数据 / 直写库）。
   */
  test("categoryOther：停用分类与未知分类进兜底，启用分类不进；count 与 list 同口径", async () => {
    const db = await freshDb()
    await db.execute(sql`update auth.asset_category set enabled = false where id = 'supervision'`)

    await insertAsset(db, metadata({ id: "on", category: "intelligence", updatedAt: 3_000 }))
    await insertAsset(db, metadata({ id: "off", category: "supervision", updatedAt: 2_000 }))
    await insertAsset(db, metadata({ id: "ghost", category: "no-such-category", updatedAt: 1_000 }))

    const ids = (rows: AssetMetadata[]) => rows.map((row) => row.id)

    expect(ids(await listAssets(db, { categoryOther: true }))).toEqual(["off", "ghost"])
    // 总数与列表必须同一份条件，否则翻页时 total 与可见行数对不上。
    expect(await countAssets(db, { categoryOther: true })).toBe(2)
    // 与显式分类互不干扰：给了 category 仍按等值筛。
    expect(ids(await listAssets(db, { category: "intelligence" }))).toEqual(["on"])
  })

  test("updateAssetCategories：只动不在目标类的行，返回旧值；未知 id 归 missing；重复调用幂等", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ id: "x", category: "supervision" }))
    await insertAsset(db, metadata({ id: "y", category: "case-handling" }))

    const 结果 = await updateAssetCategories(db, ["x", "y"], "case-handling", 5_000)

    expect(结果).toEqual({ changed: [{ id: "x", from: "supervision" }], missing: [] })
    expect((await assetById(db, "x"))?.category).toBe("case-handling")
    // 已经是目标类 ⇒ 一个字节都不动（`updated_at` 也不动），否则审计会被「没改也算改」灌水。
    expect((await assetById(db, "y"))?.category).toBe("case-handling")
    expect((await assetById(db, "y"))?.updatedAt).toBe(1_000)

    const 再 = await updateAssetCategories(db, ["x"], "case-handling", 6_000)
    expect(再.changed).toEqual([])

    // 有一个 id 不存在 ⇒ 整批不写（半个批量最难对账）。
    const 缺一 = await updateAssetCategories(db, ["x", "missing"], "intelligence", 7_000)
    expect(缺一).toEqual({ changed: [], missing: ["missing"] })
    expect((await assetById(db, "x"))?.category).toBe("case-handling")
  })

  test("删除：命中返回 true，未命中返回 false", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())

    expect(await deleteAsset(db, "missing")).toBe(false)
    expect(await deleteAsset(db, "asset_1")).toBe(true)
    expect(await assetById(db, "asset_1")).toBeUndefined()
  })
})

describe("生命周期列的条件更新（T008）", () => {
  test("期望状态不匹配 ⇒ 返回 undefined，行一个字节都不动", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "in_review" }))

    const updated = await updateAssetLifecycle(db, "asset_1", {
      expectedStatus: "draft",
      status: "archived",
      version: 9,
      updatedAt: 5_000,
      publishedAt: null,
      archivedAt: 5_000,
    })

    expect(updated).toBeUndefined()
    expect(await assetById(db, "asset_1")).toEqual(metadata({ status: "in_review" }))
  })

  test("命中时只改生命周期列，内容字段原样返回", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "pending_tech", version: 2, publishedAt: null }))

    const updated = await updateAssetLifecycle(db, "asset_1", {
      expectedStatus: "pending_tech",
      status: "published",
      version: 2,
      updatedAt: 5_000,
      publishedAt: 5_000,
      archivedAt: null,
    })

    expect(updated).toEqual(
      metadata({ status: "published", version: 2, updatedAt: 5_000, publishedAt: 5_000 }),
    )
    expect(await assetById(db, "asset_1")).toEqual(updated)
  })
})
