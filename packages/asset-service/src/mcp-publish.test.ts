import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { assetById, insertAsset } from "./asset"
import { AssetTransitionError, type SkillAction } from "./lifecycle"
import {
  getMcpConnection,
  insertMcpConnection,
  updateMcpConnection,
  记录试连结果,
  type McpConnectionInput,
} from "./mcp-connection"
import type { AssetMetadata } from "./metadata"
import { transitionAsset } from "./service"
import { pendingDirectory } from "./storage"

/**
 * 发布闸门里的 MCP 试连 / 快照 / abort 回写（设计 §3.1.4 / §5.4）。
 *
 * 夹具照 `mcp-lifecycle.test.ts`：PGlite 生产库、真实授权行、不存在的资产根
 * （MCP 若偷偷碰文件，第一次 `mkdir` 就会把它建出来或直接抛错）。
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
    values ('u1', '010001', '甲民警', 'x', 'x', 'x', '经侦支队', 'x', 0, 'h', 0),
           ('u2', '010002', '乙审核', 'x', 'x', 'x', '刑侦支队', 'x', 0, 'h', 0),
           ('u3', '010003', '丙管理', 'x', 'x', 'x', '刑侦支队', 'x', 0, 'h', 0)
  `)
  return database.db
}

const 作者 = { userId: "u1", department: "经侦支队" }
const 管理 = { userId: "u3", department: "刑侦支队" }

function 授权(assetId: string, perm: "review" | "admin", type: "mcp" | "skill" = "mcp") {
  return [{ resourceType: type, resourceId: assetId, perm }]
}

function 资产(over: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset_base",
    name: "基线",
    type: "skill",
    description: "内容",
    summary: "",
    precautions: "",
    icon: "skill",
    category: "intelligence",
    tags: [],
    ownerId: "u1",
    ownerName: "甲民警",
    department: "经侦支队",
    visibility: "department",
    version: 1,
    status: "draft",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    publishedAt: null,
    archivedAt: null,
    iterationNote: "",
    iterationWorkspace: null,
    ...over,
  }
}

/** 每次用一条不存在的根：MCP 若偷偷碰文件，第一次 `mkdir` 就会把它建出来或直接抛错。 */
function 不存在的根(): string {
  return join(tmpdir(), `openhive-mcp-publish-${randomUUID()}`, "assets")
}

/** 直接种一条 MCP 资产 + 连接规格；`status` 由用例指定，避免把状态机上一段也拖进夹具。 */
async function 有MCP资产(
  db: ProductionDb["db"],
  options: {
    readonly status: AssetMetadata["status"]
    readonly id?: string
    readonly connection?: McpConnectionInput
  },
): Promise<AssetMetadata> {
  const id = options.id ?? `asset_mcp_${randomUUID()}`
  const metadata = 资产({ id, type: "mcp", icon: "mcp", status: options.status })
  await insertAsset(db, metadata)
  await insertMcpConnection(
    db,
    id,
    options.connection ?? { transport: "remote", url: "https://mcp.example" },
    1000,
  )
  return metadata
}

async function 状态(db: ProductionDb["db"], assetId: string): Promise<AssetMetadata["status"] | undefined> {
  return (await assetById(db, assetId))?.status
}

/** 读状态机错误码；不是 `AssetTransitionError` 就返回 `undefined`，断言自然红（不用 `as`）。 */
function 错误码(error: unknown): string | undefined {
  return error instanceof AssetTransitionError ? error.code : undefined
}

async function 流转(
  db: ProductionDb["db"],
  assetId: string,
  action: SkillAction,
  viewer: typeof 作者,
  over: Record<string, unknown> = {},
): Promise<AssetMetadata> {
  return transitionAsset({
    db,
    root: 不存在的根(),
    assetId,
    action,
    viewer,
    now: 5_000,
    ...over,
  } as Parameters<typeof transitionAsset>[0])
}

describe("MCP 发布闸门", () => {
  test("试连失败 ⇒ 阻断发布，状态不变，check_error 落库", async () => {
    const db = await freshDb()
    const asset = await 有MCP资产(db, { status: "pending_tech" })
    let 传参: McpConnectionInput | undefined
    const 错 = await 流转(db, asset.id, "publish_tech", 管理, {
      grants: 授权(asset.id, "admin"),
      probe: async (input: McpConnectionInput) => {
        传参 = input
        return { ok: false, error: "connection refused" }
      },
    }).then(
      () => null,
      (error: unknown) => error,
    )

    expect(错).toBeInstanceOf(AssetTransitionError)
    expect(错误码(错)).toBe("mcp_probe_failed")
    expect(await 状态(db, asset.id)).toBe("pending_tech")
    const 连接 = await getMcpConnection(db, asset.id)
    expect(连接?.checkOk).toBe(false)
    expect(连接?.checkError).toContain("connection refused")
    expect(连接?.publishedConfig).toBeNull()
    // 注入的 probe 必须收到**连接规格的实际形状**（不是遮罩后的值）。
    expect(传参).toMatchObject({ transport: "remote", url: "https://mcp.example" })
  })

  test("试连成功 ⇒ 发布，published_config = 工作副本，试连列更新", async () => {
    const db = await freshDb()
    const asset = await 有MCP资产(db, {
      status: "pending_tech",
      connection: {
        transport: "remote",
        url: "https://mcp.example/path",
        headers: { Authorization: "Bearer test-token" },
      },
    })

    const 结果 = await 流转(db, asset.id, "publish_tech", 管理, {
      grants: 授权(asset.id, "admin"),
      probe: async () => ({ ok: true, toolCount: 3 }),
    })

    expect(结果.status).toBe("published")
    const 连接 = await getMcpConnection(db, asset.id)
    expect(连接?.checkOk).toBe(true)
    expect(连接?.toolCount).toBe(3)
    expect(连接?.publishedConfig).not.toBeNull()
    expect(连接?.publishedConfig).toMatchObject({
      transport: "remote",
      url: "https://mcp.example/path",
      headers: { Authorization: "Bearer test-token" },
    })
  })

  test("skill 发布不调用试连", async () => {
    const db = await freshDb()
    const root = 不存在的根()
    const id = "asset_skill_publish"
    await insertAsset(db, 资产({ id, status: "pending_tech" }))
    await mkdir(pendingDirectory(root, id), { recursive: true })
    await writeFile(join(pendingDirectory(root, id), "SKILL.md"), "v1")

    let 调用 = false
    const 结果 = await transitionAsset({
      db,
      root,
      assetId: id,
      action: "publish_tech",
      viewer: 管理,
      grants: 授权(id, "admin", "skill"),
      now: 5_001,
      probe: async () => {
        调用 = true
        throw new Error("不应调用")
      },
    })

    expect(结果.status).toBe("published")
    expect(调用).toBe(false)
  })

  test("abort_iteration 把 published_config 写回工作副本，并清试连列", async () => {
    const db = await freshDb()
    const asset = await 有MCP资产(db, {
      status: "pending_tech",
      connection: { transport: "remote", url: "https://mcp.example/path" },
    })

    await 流转(db, asset.id, "publish_tech", 管理, {
      grants: 授权(asset.id, "admin"),
      probe: async () => ({ ok: true, toolCount: 2 }),
    })
    expect((await getMcpConnection(db, asset.id))?.publishedConfig).toMatchObject({
      url: "https://mcp.example/path",
    })

    await 流转(db, asset.id, "start_iteration", 作者, { reason: "改地址" })
    await updateMcpConnection(
      db,
      asset.id,
      { transport: "remote", url: "https://changed.example" },
      5_002,
    )
    // 迭代期再试一次（失败）⇒ checkOk = false；abort 回写快照时必须把它清空。
    await 记录试连结果(db, asset.id, {
      checkedAt: 5_003,
      ok: false,
      error: "connection refused",
      toolCount: null,
    })
    expect((await getMcpConnection(db, asset.id))?.url).toBe("https://changed.example")
    expect((await getMcpConnection(db, asset.id))?.checkOk).toBe(false)

    const 退 = await 流转(db, asset.id, "abort_iteration", 作者)

    expect(退.status).toBe("published")
    const 连接 = await getMcpConnection(db, asset.id)
    expect(连接?.url).toBe("https://mcp.example/path")
    expect(连接?.checkOk).toBeNull()
    expect(连接?.checkError).toBe("")
  })

  test("abort_iteration 没有发布快照 ⇒ mcp_connection_missing，状态保持 iterating", async () => {
    const db = await freshDb()
    // 从未发布过：`published_config` 为 null，但状态可以是已发布（历史数据 / 直接种）。
    const asset = await 有MCP资产(db, { status: "published" })

    await 流转(db, asset.id, "start_iteration", 作者, { reason: "未发布就迭代" })
    expect(await 状态(db, asset.id)).toBe("iterating")

    const 错 = await 流转(db, asset.id, "abort_iteration", 作者).then(
      () => null,
      (error: unknown) => error,
    )

    expect(错).toBeInstanceOf(AssetTransitionError)
    expect(错误码(错)).toBe("mcp_connection_missing")
    // 抛错在 `updateAssetLifecycle` 之前：版本不回落，状态停在 iterating。
    expect(await 状态(db, asset.id)).toBe("iterating")
  })

  test("发布时资产没有连接行 ⇒ mcp_connection_missing，状态保持 pending_tech", async () => {
    const db = await freshDb()
    const id = "asset_mcp_no_connection"
    // 不走 `有MCP资产`：这里要的正是「有资产、没有连接规格」的坏状态。
    await insertAsset(db, 资产({ id, type: "mcp", icon: "mcp", status: "pending_tech" }))

    const 错 = await 流转(db, id, "publish_tech", 管理, {
      grants: 授权(id, "admin"),
    }).then(
      () => null,
      (error: unknown) => error,
    )

    expect(错).toBeInstanceOf(AssetTransitionError)
    expect(错误码(错)).toBe("mcp_connection_missing")
    expect(await 状态(db, id)).toBe("pending_tech")
  })
})
