import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { GOVERNANCE_MCP_SERVER } from "@opencode-ai/auth/builtin-mcp"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { grantsFor, type GrantRow } from "@opencode-ai/auth/rbac"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { insertAsset } from "./asset"
import {
  addGroupMember,
  canReadAsset,
  createAuthorizationGroup,
  grantAssetToGroup,
  type AssetPerm,
  type AssetViewer,
} from "./authorization"
import { buildUserMcpConfig, type McpConnectionManifest } from "./downlink"
import { isAssetUsable } from "./lifecycle"
import { ASSET_STATUSES, ASSET_VISIBILITIES, type AssetMetadata, type AssetStatus } from "./metadata"
import { addFavorite, favoriteAssetIds, isFavorite, orderForDrawer } from "./preferences"

/**
 * SC-003 验收：授权与收藏分离，无权资产不可见 / 不可用。
 *
 * ## 与 T004 / T011 的用例分层
 *
 * T004 的 `authorization.test.ts` 抽样测空间 / 权限规则，T011 的 `preferences.test.ts`
 * 抽样测「收藏不改授权」。验收层要回答的是**全格扫描**与**出口一致性**：
 *
 * 1. 7 状态 × 3 空间 × 6 类身份，逐格与独立口径对账（「不可见」是默认，不是例外）；
 * 2. 在真库里逐个状态 × 空间收藏一遍，可见性一格都不变（收藏只是个人偏好）；
 * 3. 收藏清单是**原始清单**——调用方必须再过 `canReadAsset()`，否则收藏入口漏出无权资产；
 * 4. 两个出口一致：**下发的 MCP 绝不超出可见**（「不可用」不允许绕过「看不见」）；
 * 5. 抽屉排序只换顺序、不过滤：读不到的资产仍在输出里，可见性由调用方先过滤。
 *
 * ⚠️ 不覆盖：资产列表 HTTP 接口与 RLS（`state.md` 阻塞项 / `mcp-downlink.md` §6）——
 * 本仓没有的出口不得写成已覆盖（`#002-02`）。
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

function metadata(over: Partial<AssetMetadata> = {}): AssetMetadata {
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
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 独立验收口径（不读实现）
// ---------------------------------------------------------------------------

/** 进入共享空间的状态：只有这些状态才对「非作者且无授权」的人开空间门。 */
const 共享状态: ReadonlySet<AssetStatus> = new Set(["published", "iterating", "offline"])

interface 身份 {
  readonly 名: string
  readonly viewer: AssetViewer
  /** 本人是作者（作者始终读得到自己的资产，含草稿与已归档）。 */
  readonly 作者: boolean
  /** 在该资产上的显式授权；任一档权限都附带 read。 */
  readonly perm?: AssetPerm
}

const 身份们: readonly 身份[] = [
  { 名: "作者本人", viewer: { userId: "u1", department: "经侦支队" }, 作者: true },
  { 名: "同部门他人", viewer: { userId: "u3", department: "经侦支队" }, 作者: false },
  { 名: "跨部门他人", viewer: { userId: "u2", department: "刑侦支队" }, 作者: false },
  { 名: "跨部门 + read 授权", viewer: { userId: "u4", department: "刑侦支队" }, 作者: false, perm: "read" },
  { 名: "跨部门 + review 授权", viewer: { userId: "u5", department: "刑侦支队" }, 作者: false, perm: "review" },
  { 名: "跨部门 + admin 授权", viewer: { userId: "u6", department: "刑侦支队" }, 作者: false, perm: "admin" },
]

/**
 * 独立口径：这个人能不能读到这份资产。
 *
 * 规则来自设计 §1.2 / §3.2：作者恒可读；任一授权行附带 read；其余人只有在
 * **共享状态**下按空间放行（global 全单位、department 同部门、personal / targeted
 * 空间永不放行）。「指定人员」（需求 3b）的读只从授权行来，同部门也不例外——这一格
 * 是**故意**与 department 不同，别把两支合并。
 */
function 期望可读(人: 身份, asset: AssetMetadata): boolean {
  if (人.作者) return true
  if (人.perm !== undefined) return true
  if (!共享状态.has(asset.status)) return false
  if (asset.visibility === "global") return true
  if (asset.visibility === "personal") return false
  if (asset.visibility === "targeted") return false
  return asset.department !== "" && 人.viewer.department !== "" && asset.department === 人.viewer.department
}

function 授权给(人: 身份, asset: AssetMetadata): GrantRow[] {
  return 人.perm === undefined
    ? []
    : [{ resourceType: asset.type, resourceId: asset.id, perm: 人.perm }]
}

// ---------------------------------------------------------------------------
// ① 可见性全矩阵
// ---------------------------------------------------------------------------

describe("SC-003 验收 · 无权资产不可见（T017）", () => {
  test("可见性全矩阵：7 状态 × 4 档可见范围 × 6 类身份，逐格与独立口径对账", () => {
    for (const status of ASSET_STATUSES) {
      for (const visibility of ASSET_VISIBILITIES) {
        const asset = metadata({ id: `a_${status}_${visibility}`, status, visibility })
        for (const 人 of 身份们) {
          const 标签 = `${人.名} / ${status} / ${visibility}`
          expect(canReadAsset(人.viewer, asset, 授权给(人, asset)), 标签).toBe(期望可读(人, asset))
        }
      }
    }
  })

  test("「不可见」是默认：非作者、无授权、非共享状态下，任何空间都读不到", () => {
    for (const visibility of ASSET_VISIBILITIES) {
      for (const status of ASSET_STATUSES.filter((item) => !共享状态.has(item))) {
        const asset = metadata({ status, visibility })
        const 外人 = 身份们[2]!
        expect(canReadAsset(外人.viewer, asset), `外人 / ${status} / ${visibility}`).toBe(false)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// ② 收藏不改变可见性（真库全扫描）
// ---------------------------------------------------------------------------

describe("SC-003 验收 · 授权与收藏分离（T017）", () => {
  test("真库全扫描：每个状态 × 空间都收藏一遍，可见性与授权行一格不变", async () => {
    const db = await freshDb()
    const 跨部门人 = 身份们[2]!
    const 资产们: AssetMetadata[] = []
    for (const status of ASSET_STATUSES) {
      for (const visibility of ASSET_VISIBILITIES) {
        const asset = metadata({ id: `fav_${status}_${visibility}`, status, visibility })
        资产们.push(asset)
        await insertAsset(db, asset)
      }
    }

    for (const asset of 资产们) {
      expect(await addFavorite(db, { userId: 跨部门人.viewer.userId, assetId: asset.id, now: 500 })).toBe(true)
    }

    const 授权 = await grantsFor(db, 跨部门人.viewer.userId)
    expect(授权).toEqual([])
    for (const asset of 资产们) {
      expect(await isFavorite(db, { userId: 跨部门人.viewer.userId, assetId: asset.id })).toBe(true)
      expect(canReadAsset(跨部门人.viewer, asset, 授权), `${asset.id}：收藏后被放行`).toBe(
        期望可读(跨部门人, asset),
      )
    }

    // 收藏只写个人偏好两表之一，不写授权行。
    // ⚠️ 010 T003 起 `role_resource` 里有迁移种的**治理模板行**（`resource_type='governance'`），
    // 它们不是资产授权 ⇒ 只数资产那一侧，否则这条会因无关的种子红（判据本来也不是「整表空」）。
    const [资源授权] = rowsOf(
      await db.execute(
        sql`select count(*)::int as count from auth.role_resource where resource_type <> 'governance'`,
      ),
    )
    expect(资源授权?.count).toBe(0)
  })

  test("收藏清单是原始清单：调用方必须再过 canReadAsset() 才不会漏出无权资产", async () => {
    const db = await freshDb()
    const 跨部门人 = 身份们[2]!
    const 资产们 = [
      metadata({ id: "fav_global", visibility: "global" }),
      metadata({ id: "fav_dept", visibility: "department", department: "经侦支队" }),
      metadata({ id: "fav_personal", visibility: "personal" }),
      metadata({ id: "fav_granted", visibility: "personal" }),
    ]
    for (const asset of 资产们) {
      await insertAsset(db, asset)
      await addFavorite(db, { userId: 跨部门人.viewer.userId, assetId: asset.id, now: 500 })
    }
    // 通过生产写路径（授权组）给跨部门人一条 read 授权
    await createAuthorizationGroup(db, { id: "g_taskforce", name: "电诈专案组" })
    await addGroupMember(db, { groupId: "g_taskforce", userId: 跨部门人.viewer.userId })
    await grantAssetToGroup(db, { groupId: "g_taskforce", assetId: "fav_granted", perm: "read" })

    const 原始 = await favoriteAssetIds(db, 跨部门人.viewer.userId)
    expect(原始.sort()).toEqual(["fav_dept", "fav_global", "fav_granted", "fav_personal"])

    const 授权 = await grantsFor(db, 跨部门人.viewer.userId)
    const 按id = new Map(资产们.map((asset) => [asset.id, asset]))
    const 过滤后 = 原始.filter((id) => {
      const asset = 按id.get(id)
      if (asset === undefined) throw new Error(`收藏了不存在的资产：${id}`)
      return canReadAsset(跨部门人.viewer, asset, 授权)
    })

    // 原始清单里确实混着读不到的（否则下面那条过滤就是空转）
    expect(原始).toContain("fav_dept")
    expect(原始).toContain("fav_personal")
    expect(过滤后.sort()).toEqual(["fav_global", "fav_granted"])
  })
})

// ---------------------------------------------------------------------------
// ③ 不可用出口：下发绝不超出可见
// ---------------------------------------------------------------------------

describe("SC-003 验收 · 无权资产不可用（T017）", () => {
  test("下发不超出可见：每个下发的 MCP 都满足 canReadAsset 且可用；收藏不产生下发", () => {
    const 跨部门人 = 身份们[2]!
    const 资产们: AssetMetadata[] = []
    const connections: Record<string, McpConnectionManifest[string]> = {}
    for (const status of ASSET_STATUSES) {
      for (const visibility of ASSET_VISIBILITIES) {
        const id = `mcp_${status}_${visibility}`
        资产们.push(metadata({ id, name: id, type: "mcp", status, visibility }))
        connections[id] = { type: "local", command: ["bun", "run", "server.ts"] }
      }
    }

    const 跑 = (grants: readonly GrantRow[]) =>
      buildUserMcpConfig({ userId: 跨部门人.viewer.userId, grants, assets: 资产们, connections })

    // 情形 A：没有任何授权 ⇒ 只有内建治理 server（收藏与否都不进这个函数）
    expect(Object.keys(跑([]))).toEqual([GOVERNANCE_MCP_SERVER])

    // 情形 B：全部 read 授权 ⇒ 只下发可用状态（published / iterating），且全部可读
    const 读授权: GrantRow[] = 资产们.map((asset) => ({
      resourceType: "mcp",
      resourceId: asset.id,
      perm: "read",
    }))
    const 读配置 = 跑(读授权)
    const 下发id = Object.keys(读配置).filter((key) => key !== GOVERNANCE_MCP_SERVER)
    const 按id = new Map(资产们.map((asset) => [asset.id, asset]))
    for (const id of 下发id) {
      const asset = 按id.get(id)
      if (asset === undefined) throw new Error(`下发了不存在的资产：${id}`)
      expect(canReadAsset(跨部门人.viewer, asset, 读授权), `${id}：下发了但不可读`).toBe(true)
      expect(isAssetUsable(asset.status), `${id}：下发了但不可用`).toBe(true)
    }
    expect(下发id.sort()).toEqual(
      资产们.filter((asset) => isAssetUsable(asset.status)).map((asset) => asset.id).sort(),
    )

    // 情形 C：read 之外的授权（review）虽然能读，但**不产生下发**（下发出口更严）
    const 审授权: GrantRow[] = 资产们.map((asset) => ({
      resourceType: "mcp",
      resourceId: asset.id,
      perm: "review",
    }))
    expect(Object.keys(跑(审授权))).toEqual([GOVERNANCE_MCP_SERVER])
    for (const asset of 资产们.filter((item) => isAssetUsable(item.status))) {
      expect(canReadAsset(跨部门人.viewer, asset, 审授权), `${asset.id}：审授权不带读`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// ④ 排序出口：只换顺序、不过滤
// ---------------------------------------------------------------------------

describe("SC-003 验收 · 收藏只影响排序（T017）", () => {
  test("抽屉排序是排列：入参原样保留（含读不到的资产），收藏只改变先后", () => {
    const items = [
      metadata({ id: "s_1", usageCount: 5 }),
      metadata({ id: "s_2", usageCount: 5 }),
      metadata({ id: "s_3", usageCount: 1, visibility: "personal" }),
    ]
    const 无偏好 = orderForDrawer(items, { favorites: new Set(), lastUsedAt: new Map() })
    expect(无偏好.map((item) => item.id)).toEqual(["s_1", "s_2", "s_3"])

    // 收藏 s_2（与 s_1 同使用次数）⇒ s_2 上浮；读不到的 s_3 仍在列表里
    const 有偏好 = orderForDrawer(items, { favorites: new Set(["s_2"]), lastUsedAt: new Map() })
    expect(有偏好.map((item) => item.id)).toEqual(["s_2", "s_1", "s_3"])
    expect([...有偏好].sort((a, b) => (a.id < b.id ? -1 : 1)).map((item) => item.id)).toEqual(
      [...items].sort((a, b) => (a.id < b.id ? -1 : 1)).map((item) => item.id),
    )
  })
})
