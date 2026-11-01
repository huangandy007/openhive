import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
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
  updateAssetContent,
  updateAssetLifecycle,
  type AssetContentPatch,
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
    summary: "",
    precautions: "",
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
    iterationNote: "",
    iterationWorkspace: null,
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

  test("迭代两列：iteration_note 非空默认空串、iteration_workspace 可空", async () => {
    const db = await freshDb()

    const rows = rowsOf(
      await db.execute(sql`
        select column_name, is_nullable, column_default
        from information_schema.columns
        where table_schema = 'auth' and table_name = 'asset'
          and column_name in ('iteration_note', 'iteration_workspace')
        order by column_name
      `),
    )

    expect(rows).toHaveLength(2)
    expect({ 列: String(rows[0]!.column_name), 可空: String(rows[0]!.is_nullable) }).toEqual({
      列: "iteration_note",
      可空: "NO",
    })
    // 默认值在 PG 里读回来是 `''::text`；只钉「有个空串」，不钉 cast 的写法。
    expect(String(rows[0]!.column_default)).toContain("''")
    expect({ 列: String(rows[1]!.column_name), 可空: String(rows[1]!.is_nullable) }).toEqual({
      列: "iteration_workspace",
      可空: "YES",
    })
    expect(rows[1]!.column_default).toBeNull()
  })

  test("迭代两列可写可读：空串说明与相对路径原样回环", async () => {
    const db = await freshDb()
    await insertAsset(
      db,
      metadata({ iterationNote: "补一条统计口径", iterationWorkspace: "u1/p1/.openhive/iterations/asset_1" }),
    )

    const 读回 = await assetById(db, "asset_1")
    expect(读回?.iterationNote).toBe("补一条统计口径")
    expect(读回?.iterationWorkspace).toBe("u1/p1/.openhive/iterations/asset_1")
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

describe("内容字段（2026-10-31）", () => {
  test("插入后 summary / precautions 默认是空串，不是 null", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ id: "a_content_default", name: "内容默认值" }))
    const 读回 = await assetById(db, "a_content_default")
    expect(读回?.summary).toBe("")
    expect(读回?.precautions).toBe("")
  })

  test("0026 迁移的回填语句把 description 复制进 summary", async () => {
    // 回填语句**从迁移文件里读出来**再执行（不是测试自己手写一条）：删掉 0026 里那行
    // `UPDATE auth.asset SET summary = description ...`，这里就找不到语句、用例变红，
    // 迁移的回填口径便由本用例钉住。
    const db = await freshDb()
    await insertAsset(
      db,
      metadata({
        id: "a_content_backfill",
        name: "回填",
        description: "原来的介绍",
        summary: "",
        precautions: "",
      }),
    )
    const 迁移 = await Bun.file(
      join(import.meta.dir, "..", "..", "auth", "src", "migrations", "0026_asset_content_fields.sql"),
    ).text()
    const 回填语句 = 迁移
      .split("--> statement-breakpoint")
      .map((片段) => 片段.replace(/^--.*$/gm, "").trim())
      .find((片段) => /^UPDATE auth\.asset SET summary = description\b/i.test(片段))
    expect(回填语句).toBeDefined()
    await db.execute(sql.raw(回填语句!))
    const 读回 = await assetById(db, "a_content_backfill")
    expect(读回?.summary).toBe("原来的介绍")
  })

  test("updateAssetContent 只改内容列：status / version 一个字都不动", async () => {
    const db = await freshDb()
    await insertAsset(
      db,
      metadata({
        id: "a_content_write",
        name: "写入",
        status: "published",
        version: 3,
        precautions: "原注意事项",
        favoriteCount: 7,
        usageCount: 9,
        rating: 3.25,
        ratingCount: 4,
        feedbackCount: 2,
        visibility: "global",
        publishedAt: 200,
        createdAt: 100,
        updatedAt: 100,
      }),
    )
    const 写完 = await updateAssetContent(
      db,
      "a_content_write",
      { summary: "一句话功能", precautions: "注意甲" },
      5_000,
    )
    expect(写完?.summary).toBe("一句话功能")
    expect(写完?.precautions).toBe("注意甲")
    // 没带的那个内容列也原样保留。
    expect(写完?.description).toBe("按账户汇总流水")
    expect(写完?.status).toBe("published")
    expect(写完?.version).toBe(3)
    expect(写完?.updatedAt).toBe(5_000)
    // 本函数最贵的承诺：内容写入不碰计数 / 评分 / 可见范围 / 发布时间。
    expect(写完?.favoriteCount).toBe(7)
    expect(写完?.usageCount).toBe(9)
    expect(写完?.rating).toBe(3.25)
    expect(写完?.ratingCount).toBe(4)
    expect(写完?.feedbackCount).toBe(2)
    expect(写完?.visibility).toBe("global")
    expect(写完?.publishedAt).toBe(200)

    // 后续写入仍只覆盖带上的字段：只带 summary，precautions 还是上一次写的值。
    const 再写 = await updateAssetContent(db, "a_content_write", { summary: "再一句话" }, 5_500)
    expect(再写?.precautions).toBe("注意甲")
    expect(再写?.updatedAt).toBe(5_500)
  })

  test("updateAssetContent 不带某字段就不动它", async () => {
    const db = await freshDb()
    await insertAsset(
      db,
      metadata({ id: "a_content_partial", name: "部分", description: "原介绍", precautions: "原注意事项" }),
    )
    const 写完 = await updateAssetContent(db, "a_content_partial", { summary: "只改功能描述" }, 6_000)
    expect(写完?.description).toBe("原介绍")
    expect(写完?.precautions).toBe("原注意事项")
    expect(写完?.summary).toBe("只改功能描述")
  })

  test("updateAssetContent 空串是值：清空功能描述能落库，未带的注意事项保留", async () => {
    const db = await freshDb()
    await insertAsset(
      db,
      metadata({ id: "a_content_clear", name: "清空", summary: "旧一句话", precautions: "原注意事项" }),
    )
    const 写完 = await updateAssetContent(db, "a_content_clear", { summary: "" }, 6_500)
    expect(写完?.summary).toBe("")
    expect(写完?.precautions).toBe("原注意事项")
    // 落库确认：空串不是「没传」，读回来也必须是空串。
    expect((await assetById(db, "a_content_clear"))?.summary).toBe("")
  })

  test("updateAssetContent 写入非空介绍", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ id: "a_content_desc", name: "改介绍", description: "旧介绍" }))
    const 新介绍 = "按账户汇总资金流水，识别异常对手方与可疑资金回流。"
    const 写完 = await updateAssetContent(db, "a_content_desc", { description: 新介绍 }, 6_600)
    expect(写完?.description).toBe(新介绍)
    expect((await assetById(db, "a_content_desc"))?.description).toBe(新介绍)
  })

  test("updateAssetContent 对不存在的 id 返回 undefined", async () => {
    const db = await freshDb()
    expect(await updateAssetContent(db, "a_content_missing", { summary: "x" }, 7_000)).toBeUndefined()
  })

  test("updateAssetContent 超长抛 AssetMetadataError 且带字段名", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ id: "a_content_long", name: "超长" }))
    const error = await failure(() =>
      updateAssetContent(db, "a_content_long", { summary: "一".repeat(201) }, 8_000),
    )
    if (!(error instanceof AssetMetadataError)) throw new Error(`期望 AssetMetadataError，实得 ${error.name}`)
    // 只钉字段名：提示文案是产品文案，改一句话不该把语义用例拖红。
    expect(error.issues.map((issue) => issue.field)).toContain("summary")
    // 校验在碰库之前：断言错误类型之外再钉住行一个字节都没动。
    expect((await assetById(db, "a_content_long"))?.updatedAt).toBe(1_000)
  })

  // 终审 I-2：spec §8 要求「三个字段各自超限」。之前只测了 `summary`，
  // `CONTENT_LIMITS.description` / `precautions` 改成多大都不会有机制发现。
  test("updateAssetContent 介绍超 2000 抛 AssetMetadataError 且带字段名", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ id: "a_content_desc_long", name: "超长介绍" }))
    const error = await failure(() =>
      updateAssetContent(db, "a_content_desc_long", { description: "一".repeat(2001) }, 8_100),
    )
    if (!(error instanceof AssetMetadataError)) throw new Error(`期望 AssetMetadataError，实得 ${error.name}`)
    expect(error.issues.map((issue) => issue.field)).toContain("description")
    expect((await assetById(db, "a_content_desc_long"))?.updatedAt).toBe(1_000)
  })

  test("updateAssetContent 注意事项超 1000 抛 AssetMetadataError 且带字段名", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ id: "a_content_prec_long", name: "超长注意事项" }))
    const error = await failure(() =>
      updateAssetContent(db, "a_content_prec_long", { precautions: "一".repeat(1001) }, 8_200),
    )
    if (!(error instanceof AssetMetadataError)) throw new Error(`期望 AssetMetadataError，实得 ${error.name}`)
    expect(error.issues.map((issue) => issue.field)).toContain("precautions")
    expect((await assetById(db, "a_content_prec_long"))?.updatedAt).toBe(1_000)
  })

  // 非字符串是 HTTP 边界的第二道门（`metadata.ts` 的 `typeof value !== "string"`）：
  // 绕过 TS 直接喂运行时脏值，证明校验发生在碰库之前。
  test("updateAssetContent 非字符串抛 AssetMetadataError 且一行未写", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ id: "a_content_type", name: "非字符串" }))
    const 坏补丁 = { summary: 123 } as unknown as AssetContentPatch
    const error = await failure(() => updateAssetContent(db, "a_content_type", 坏补丁, 8_300))
    if (!(error instanceof AssetMetadataError)) throw new Error(`期望 AssetMetadataError，实得 ${error.name}`)
    expect(error.issues.map((issue) => issue.field)).toContain("summary")
    expect((await assetById(db, "a_content_type"))?.updatedAt).toBe(1_000)
  })

  test("updateAssetContent 拒绝空介绍", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ id: "a_content_empty", name: "空介绍" }))
    // 只匹配 /description/ 会被数据库的 `asset_description_not_blank_check` 兜底蒙混过去
    // （那条 SQL 错误的约束名里也有 description），所以这里必须断言错误类型与关库后未写
    // （`#004-09`：校验在副作用之前）。
    const error = await failure(() =>
      updateAssetContent(db, "a_content_empty", { description: "  " }, 9_000),
    )
    if (!(error instanceof AssetMetadataError)) throw new Error(`期望 AssetMetadataError，实得 ${error.name}`)
    expect(error.issues.map((issue) => issue.field)).toContain("description")
    expect((await assetById(db, "a_content_empty"))?.updatedAt).toBe(1_000)
  })
})
