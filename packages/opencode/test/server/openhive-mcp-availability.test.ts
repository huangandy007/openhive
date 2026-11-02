import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { scanUsableMcpServers } from "../../src/server/openhive/mcp-availability"

/**
 * spec §3.4.1：读者读得到的、已发布（或迭代中）的 **MCP 资产** ⇒ 配置键名单。
 *
 * 判据必须复用 `readableAssetCondition()`（`#004-02`）：本文件出现的每一档可见范围，
 * 在 `authorization.test.ts`（内存判据）与 `readable-sql`（SQL 投影）里各有一份同源结论。
 * 这里只验「SQL 那一份」在 mcp 上被接对了——别在这里另写一套可见性。
 *
 * ⚠️ **夹具的所有者必须刻意分开**：`readableAssetCondition` 的第一支是
 * `owner_id = viewer`，它不看 `status` / `visibility`。若正向用例的资产都归 U1 所有，
 * 它们会**只靠作者身份**进名单，`global` / `department` / 授权行那几条路径一次都没被走到；
 * 反向用例里归 U1 的资产也会被作者身份放行，`[]` 根本不可达。故：
 * - 正向里靠可见范围 / 授权行入选的，一律 `ownerId: "u2"`；只有 `personal` 那条留给作者支；
 * - 反向里靠「不可见」排除的，一律 `ownerId: "u2"`；靠 `status` / `type` 排除的留给 U1，
 *   这样它们的排除**只能**来自这两个过滤（Step 5 的变异就靠这一点）。
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

const 资产 = (overrides: Partial<AssetMetadata> & Pick<AssetMetadata, "id">): AssetMetadata => ({
  name: "MCP 服务",
  type: "mcp",
  description: "测试用 MCP 资产",
  summary: "",
  precautions: "",
  icon: "mcp",
  category: "intelligence",
  tags: [],
  ownerId: "u1",
  ownerName: "甲民警",
  department: "经侦支队",
  visibility: "targeted",
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
  iterationNote: "",
  iterationWorkspace: null,
  ...overrides,
})

const U1 = { userId: "u1", department: "经侦支队" }

describe("scanUsableMcpServers（spec §3.4.1）", () => {
  test("global / department / targeted 命中授权 / personal 作者 / iterating ⇒ 都进名单", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset-global", visibility: "global", ownerId: "u2" }))
    await insertAsset(db, 资产({ id: "asset-dept", visibility: "department", department: "经侦支队", ownerId: "u2" }))
    await insertAsset(db, 资产({ id: "asset-iterating", visibility: "global", status: "iterating", ownerId: "u2" }))
    await insertAsset(db, 资产({ id: "asset-own-personal", visibility: "personal" }))
    await insertAsset(db, 资产({ id: "asset-targeted-mine", visibility: "targeted", ownerId: "u2" }))
    await db.execute(sql`insert into auth.role (id, name, role_type) values ('g_a', '组A', 'group')`)
    await db.execute(sql`insert into auth.user_role (user_id, role_id) values ('u1', 'g_a')`)
    await db.execute(sql`
      insert into auth.role_resource (role_id, resource_type, resource_id, perm)
      values ('g_a', 'mcp', 'asset-targeted-mine', 'read')
    `)

    const scan = await scanUsableMcpServers(db, U1)

    expect(scan.names).toEqual([
      "asset-dept",
      "asset-global",
      "asset-iterating",
      "asset-own-personal",
      "asset-targeted-mine",
    ])
    expect(scan.skipped).toEqual([])
  })

  test("跨部门 / 别人的 targeted / 别人的 personal / draft / in_review / offline / archived / 非 mcp ⇒ 都不进名单", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset-other-dept", visibility: "department", department: "刑侦支队", ownerId: "u2" }))
    await insertAsset(db, 资产({ id: "asset-targeted-other", visibility: "targeted", ownerId: "u2" }))
    await insertAsset(db, 资产({ id: "asset-other-personal", visibility: "personal", ownerId: "u2" }))
    await insertAsset(db, 资产({ id: "asset-draft", visibility: "global", status: "draft" }))
    await insertAsset(db, 资产({ id: "asset-review", visibility: "global", status: "in_review" }))
    await insertAsset(db, 资产({ id: "asset-offline", visibility: "global", status: "offline" }))
    await insertAsset(db, 资产({ id: "asset-archived", visibility: "global", status: "archived" }))
    await insertAsset(db, 资产({ id: "asset-skill", visibility: "global", type: "skill" }))

    const scan = await scanUsableMcpServers(db, U1)

    expect(scan.names).toEqual([])
  })

  test("id 含通配字符 ⇒ skipped（fail-closed，不当配置键用）", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset_*", visibility: "global" }))
    await insertAsset(db, 资产({ id: "asset-ok", visibility: "global" }))

    const scan = await scanUsableMcpServers(db, U1)

    expect(scan.names).toEqual(["asset-ok"])
    expect(scan.skipped).toEqual([{ id: "asset_*", reason: "资产 id 含通配字符，不能当配置键：asset_*" }])
  })

  test("空 id ⇒ skipped（否则会退化成 `_*`，同样会放大成别的键）", async () => {
    const db = await freshDb()
    // `insertAsset` 的元数据校验拒绝空 id，所以这里直接写行：本用例防的正是「库里已有脏行」
    // 被当成配置键（空串不含通配字符，只看通配字符时会一路放行）。
    await db.execute(sql`
      insert into auth.asset
        (id, name, type, description, icon, category, owner_id, owner_name, department,
         visibility, status, created_at, updated_at, published_at)
      values
        ('', '空 id 资产', 'mcp', '夹具', 'mcp', 'intelligence', 'u1', '甲民警', '经侦支队',
         'global', 'published', 1000, 1000, 1000)
    `)

    const scan = await scanUsableMcpServers(db, U1)

    expect(scan.names).toEqual([])
    expect(scan.skipped.map((item) => item.id)).toEqual([""])
  })
})
