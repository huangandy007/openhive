import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { insertAsset } from "./asset"
import type { AssetMetadata } from "./metadata"
import { autoDeliverableAssets, autoDeliveryOf, setAutoDelivery } from "./auto-delivery"

/**
 * 自动送达 · 库与候选集（2026-10-27，需求 5a）。
 *
 * ## 两件事分开验
 *
 * ① **开关**：`auth.project_asset_auto_delivery` 只存「关」的行（默认开）；
 * ② **候选集**：这个人这个项目「该看得到」的、可自动送进沙箱的 skill——
 *    判据必须复用 `readableAssetCondition()`（`#004-02`：可见性只有一份规则），
 *    再叠 `type='skill'` / `status='published'` / 非全局非个人 / 按发布时间倒序。
 *
 * ## 为什么 global 不在候选集里
 *
 * 用户裁定（2026-10-27）：20 个的预算只管**项目内链接**；`global` 档走内核配置的
 * `skills.paths`（`/assets/global/skills`），一份配置全单位生效，不占个人预算。
 * 把它也算进候选集，等于同一份 skill 被送两遍。
 */

const databases: ProductionDb[] = []
let db: ProductionDb["db"]

/** 甲部门（读者所在）/ 乙部门（对照组）。 */
const 甲部门 = "经侦支队"
const 乙部门 = "法制支队"
const 项目 = "proj_auto_1"

function metadata(over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name">): AssetMetadata {
  return {
    type: "skill",
    description: "自动送达夹具",
    icon: "skill",
    category: "intelligence",
    tags: ["测试"],
    ownerId: "u1",
    ownerName: "甲民警",
    department: 甲部门,
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
    ...over,
  }
}

const 部门内 = "asset_auto_dept"
const 乙部门内 = "asset_auto_dept_other"
const 迭代中 = "asset_auto_iterating"
const 全局 = "asset_auto_global"
const 个人 = "asset_auto_personal"
const 定向 = "asset_auto_targeted"
const 未授权定向 = "asset_auto_targeted_denied"
const 非skill = "asset_auto_mcp"
const 较新 = "asset_auto_newer"

beforeAll(async () => {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  db = database.db

  for (const [id, name, dept] of [
    ["u1", "甲民警", 甲部门],
    ["u2", "乙民警", 乙部门],
    ["u3", "丙民警", "刑侦支队"],
  ] as const) {
    await database.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${id}, ${`0100${id.slice(1)}`}, ${name}, 'x', 'x', 'x', ${dept}, 'x', 0, 'h', 0)
    `)
  }

  // 甲部门内、已发布 ⇒ 该送（发布时间 1_000）。
  await insertAsset(db, metadata({ id: 部门内, name: "部门研判" }))
  // 乙部门内、已发布 ⇒ 甲部门的人读不到，不该送。
  await insertAsset(
    db,
    metadata({ id: 乙部门内, name: "乙部门研判", department: 乙部门, ownerId: "u2", ownerName: "乙民警" }),
  )
  // 迭代中：共享状态但不是「审核通过」的发布态 ⇒ 不自动送（手动启用仍可）。
  await insertAsset(db, metadata({ id: 迭代中, name: "迭代中研判", status: "iterating" }))
  // 全局 / 个人 / 非 skill ⇒ 各有各的出口，都不进候选集。
  await insertAsset(db, metadata({ id: 全局, name: "全局研判", visibility: "global" }))
  await insertAsset(db, metadata({ id: 个人, name: "个人研判", visibility: "personal", ownerId: "u1", ownerName: "甲民警" }))
  await insertAsset(db, metadata({ id: 非skill, name: "MCP 工具", type: "mcp" }))
  // 定向：u1 有授权行 ⇒ 送；没有 ⇒ 不送（读权只来自授权行）。
  await insertAsset(db, metadata({ id: 定向, name: "定向研判", visibility: "targeted" }))
  await insertAsset(
    db,
    metadata({ id: 未授权定向, name: "未授权定向", visibility: "targeted", ownerId: "u3", ownerName: "丙民警" }),
  )
  await db.execute(sql`insert into auth.role (id, name) values ('auto_reader', '定向读者')`)
  await db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('auto_reader', 'skill', ${定向}, 'read')
  `)
  await db.execute(sql`insert into auth.user_role (user_id, role_id) values ('u1', 'auto_reader')`)
  // 更晚发布的一份（排序判据）：发布时间 2_000。
  await insertAsset(db, metadata({ id: 较新, name: "较新研判", publishedAt: 2_000 }))
})

afterAll(async () => {
  await Promise.all(databases.splice(0).map((database) => database.stop()))
})

beforeEach(async () => {
  await db.execute(sql`delete from auth.project_asset_auto_delivery`)
})

const 读者 = { userId: "u1", department: 甲部门 }

describe("自动送达开关", () => {
  test("默认是开（表里没有行）", async () => {
    expect(await autoDeliveryOf(db, { userId: "u1", projectId: 项目 })).toEqual({ enabled: true })
  })

  test("关掉之后是关，且能再打开（行删掉即恢复默认开）", async () => {
    await setAutoDelivery(db, { userId: "u1", projectId: 项目, enabled: false })
    expect(await autoDeliveryOf(db, { userId: "u1", projectId: 项目 })).toEqual({ enabled: false })

    await setAutoDelivery(db, { userId: "u1", projectId: 项目, enabled: true })
    expect(await autoDeliveryOf(db, { userId: "u1", projectId: 项目 })).toEqual({ enabled: true })
    // oracle 不经过被测对象：表里真的没行了。
    const rows = rowsOf(
      await db.execute(sql`select user_id from auth.project_asset_auto_delivery where project_id = ${项目}`),
    )
    expect(rows).toEqual([])
  })

  test("开关按人 × 项目隔离：我关了不影响同项目别人", async () => {
    await setAutoDelivery(db, { userId: "u1", projectId: 项目, enabled: false })
    expect(await autoDeliveryOf(db, { userId: "u2", projectId: 项目 })).toEqual({ enabled: true })
  })
})

describe("自动送达候选集", () => {
  test("只含读得到的、已发布的部门/定向 skill", async () => {
    const 候选 = await autoDeliverableAssets(db, 读者, { limit: 20 })
    expect(候选.map((item) => item.id)).toEqual([较新, 部门内, 定向])
  })

  test("按发布时间倒序（同时间按 id 升序，保证稳定）", async () => {
    const 候选 = await autoDeliverableAssets(db, 读者, { limit: 20 })
    expect(候选.map((item) => item.publishedAt)).toEqual([2_000, 1_000, 1_000])
  })

  test("limit 截断（预算由调用方给，模块不自己算 20）", async () => {
    const 候选 = await autoDeliverableAssets(db, 读者, { limit: 2 })
    expect(候选.map((item) => item.id)).toEqual([较新, 部门内])
  })

  test("exclude 里的 id 不再出现（手动装了就不再自动送）", async () => {
    const 候选 = await autoDeliverableAssets(db, 读者, { limit: 20, exclude: [较新, 定向] })
    expect(候选.map((item) => item.id)).toEqual([部门内])
  })

  test("乙部门读者看到的只有乙部门那一份", async () => {
    const 候选 = await autoDeliverableAssets(db, { userId: "u2", department: 乙部门 }, { limit: 20 })
    expect(候选.map((item) => item.id)).toEqual([乙部门内])
  })
})
