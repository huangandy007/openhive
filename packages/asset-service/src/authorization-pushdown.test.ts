import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { grantsFor } from "@opencode-ai/auth/rbac"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import {
  addGroupMember,
  canReadAsset,
  createAuthorizationGroup,
  grantAssetToGroup,
  readableAssetCondition,
  type AssetViewer,
} from "./authorization"
import { insertAsset, listAssets } from "./asset"
import type { AssetMetadata } from "./metadata"

/**
 * 需求 6（2026-10-27）· 可见性判定下推成 SQL 条件下的**双投影一致性**（`#004-02`）。
 *
 * ## 为什么必须有这一条
 *
 * 分页要求「先按可见性筛、再 limit/offset」。若仍在内存里过滤，页大小会被筛掉的行吃掉
 * （翻页跳条、每页忽多忽少）。所以规则要下推成 `where` 条件——但**规则只能有一份实现**：
 * `canReadAsset()` 是判据，SQL 是它的第二个投影。两个投影一旦漂，不会报错，只会
 * 「该看见的看不见 / 不该看见的看见了」。
 *
 * 这条用例就是那把尺子：同一批资产 × 同一批读者，
 * - 投影 A：`canReadAsset(viewer, asset, grantsFor(viewer))` 逐条判；
 * - 投影 B：`select id from auth.asset where <readableAssetCondition(viewer)>`。
 *
 * 两个集合必须**逐一相等**。矩阵覆盖：7 种状态 × 4 档可见范围 × 两个部门 × 三种读者
 * （作者 / 同部门非作者 / 异部门），外加一条授权组定向授权（草稿 + 跨部门）。
 * 「指定人员」（需求 3b）在矩阵里与部门档同格：**同部门也不可见**——它的读只来自授权行。
 *
 * ## 变异
 *
 * 从 `readableAssetCondition` 里删掉作者分支 ⇒ 作者那几行从投影 B 消失；删掉状态门
 * ⇒ 草稿进 projections B。两侧任一漂都会让这条用例列出差集。
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
      ('u2', '020002', '乙民警', 'x', 'x', '市局', '刑侦支队', 'x', 0, 'h', 0),
      ('u3', '030003', '丙民警', 'x', 'x', '市局', '经侦支队', 'x', 0, 'h', 0)
  `)
  return database.db
}

const STATUSES = ["draft", "in_review", "pending_tech", "published", "iterating", "offline", "archived"] as const
/**
 * 四档（需求 3b 起）。`targeted` 必须进矩阵：它的判据是「空间不授读」，也就是**没有**
 * 新增的 SQL 分支——恰恰要靠这条相等断言钉住「两侧都没有它」，而不是两边各漂一点、
 * 看起来还相等。
 */
const VISIBILITIES = ["global", "department", "targeted", "personal"] as const
const DEPARTMENTS = ["经侦支队", "刑侦支队"] as const

function row(id: string, overrides: Partial<AssetMetadata>): AssetMetadata {
  return {
    id,
    name: `资产 ${id}`,
    type: "skill",
    description: "判据用夹具",
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

/** 矩阵：状态 × 可见范围 × 部门，每格一条；再加一条跨部门授权组定向授权的草稿。 */
async function seedMatrix(db: ProductionDb["db"]): Promise<void> {
  for (const status of STATUSES) {
    for (const visibility of VISIBILITIES) {
      for (const department of DEPARTMENTS) {
        const id = `a_${status}_${visibility}_${department === "经侦支队" ? "jingzhen" : "xingzhen"}`
        await insertAsset(
          db,
          row(id, {
            status,
            visibility,
            department: visibility === "personal" ? "" : department,
            ownerId: "u1",
            publishedAt: status === "published" ? 1000 : null,
          }),
        )
      }
    }
  }

  // 一条定向授权：跨部门的 u2 拿到 u1 的**个人草稿**的 read。
  await createAuthorizationGroup(db, { id: "g_case", name: "专案组" })
  await addGroupMember(db, { groupId: "g_case", userId: "u2" })
  await grantAssetToGroup(db, { groupId: "g_case", assetId: "a_draft_personal_xingzhen", perm: "read" })
}

const VIEWERS: readonly AssetViewer[] = [
  { userId: "u1", department: "经侦支队" }, // 作者
  { userId: "u2", department: "刑侦支队" }, // 异部门，但被授权了一条
  { userId: "u3", department: "经侦支队" }, // 同部门非作者
]

async function pushdownIds(db: ProductionDb["db"], viewer: AssetViewer): Promise<string[]> {
  const rows = rowsOf(
    await db.execute(sql`select id from auth.asset where ${readableAssetCondition(viewer)} order by id`),
  )
  return rows.map((row) => String(row.id))
}

async function memoryIds(db: ProductionDb["db"], viewer: AssetViewer): Promise<string[]> {
  const all = await listAssets(db)
  const grants = await grantsFor(db, viewer.userId)
  return all
    .filter((asset) => canReadAsset(viewer, asset, grants))
    .map((asset) => asset.id)
    .sort()
}

describe("可见性下推：SQL 投影 ≡ canReadAsset 投影", () => {
  for (const viewer of VIEWERS) {
    test(`读者 ${viewer.userId}（${viewer.department}）两个投影逐一相等`, async () => {
      const db = await freshDb()
      await seedMatrix(db)

      const pushed = await pushdownIds(db, viewer)
      const memory = await memoryIds(db, viewer)

      // 差集逐条报出来：漂了的时候要能一眼看出「哪条只在一侧」。
      const 只在SQL = pushed.filter((id) => !memory.includes(id))
      const 只在内存 = memory.filter((id) => !pushed.includes(id))
      expect({ 只在SQL, 只在内存 }).toEqual({ 只在SQL: [], 只在内存: [] })
      expect(pushed).toEqual(memory)
    })
  }
})
