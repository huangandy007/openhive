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

/**
 * 终审 I-2 的根因版（2026-11-02）：发布快照必须绑定**实际试连过的那份配置**。
 *
 * `iterating` 期间允许改连接（`assets.ts` 的 `CONNECTION_WRITABLE_STATUSES`），而旧实现
 * 「先试连 X、写快照时再重读工作副本」⇒ 试连期间被并发改成 Y 时，**没试连过的 Y 会被直接发布**。
 * 这两条用例都让 probe 在返回前改库：一条改连接，一条 abort 掉状态。
 */
describe("MCP 发布 · 试连期间的并发", () => {
  const OLD = { transport: "remote", url: "https://old.example" } as const
  const X = { transport: "remote", url: "https://x.example" } as const
  const Y = { transport: "remote", url: "https://y.example" } as const

  /** 已发布过 OLD、正在迭代、工作副本已改成 X 的 MCP 资产。 */
  async function 迭代中的资产(db: ProductionDb["db"]) {
    const asset = await 有MCP资产(db, { status: "pending_tech", connection: OLD })
    // 先真发布一次：published_config = OLD。
    await 流转(db, asset.id, "publish_tech", 管理, {
      grants: 授权(asset.id, "admin"),
      probe: async () => ({ ok: true, toolCount: 1 }),
    })
    await 流转(db, asset.id, "start_iteration", 作者, { reason: "并发编辑" })
    await updateMcpConnection(db, asset.id, X, 5_002)
    return asset
  }

  test("试连期间连接被并发改 ⇒ 拒绝发布，published_config 不留未试连的 Y", async () => {
    const db = await freshDb()
    const asset = await 迭代中的资产(db)

    let 试连: McpConnectionInput | undefined
    const 错 = await 流转(db, asset.id, "publish_iteration", 管理, {
      grants: 授权(asset.id, "admin"),
      probe: async (input: McpConnectionInput) => {
        试连 = input
        // 试连在飞时，另一个写者把工作副本改成 Y。
        await updateMcpConnection(db, asset.id, Y, 5_003)
        return { ok: true, toolCount: 1 }
      },
    }).then(
      () => null,
      (error: unknown) => error,
    )

    // probe 收到的是**实际工作副本 X**（发布闸门试的就是它）。
    expect(试连).toMatchObject({ transport: "remote", url: "https://x.example" })
    // 先断库：变异验证要能在「快照落成 Y」这一步直接红（改前旧实现正是如此）。
    const 连接 = await getMcpConnection(db, asset.id)
    expect(连接?.publishedConfig).toMatchObject({ url: "https://old.example" })
    expect(错).toBeInstanceOf(AssetTransitionError)
    expect(错误码(错)).toBe("concurrent_transition")
    // 并发编辑没被吞掉：工作副本仍是 Y。
    expect(连接?.url).toBe("https://y.example")
    expect(await 状态(db, asset.id)).toBe("iterating")
  })

  /**
   * 控制方核实的证伪用例：旧实现「abort 回写后被快照覆盖」**不成立**——`写入发布快照`
   * 落库前会重读工作副本，abort 已把它还原成 OLD，快照写回去的也是 OLD。这条用例在旧实现
   * 下应为绿（已实测），改后它守的是新实现的**状态条件**（`exists … status = expected.status`）。
   *
   * `now` 与连接此刻的 `updated_at` 取同一秒：让 `updated_at` 条件也通过，只有状态条件能挡住。
   */
  test("试连期间 abort ⇒ 拒绝发布，旧快照不被覆盖", async () => {
    const db = await freshDb()
    const asset = await 迭代中的资产(db)
    const 试连前 = await getMcpConnection(db, asset.id)
    if (试连前 === undefined) throw new Error("连接行没读回来")
    const 同一秒 = 试连前.updatedAt

    const 错 = await 流转(db, asset.id, "publish_iteration", 管理, {
      grants: 授权(asset.id, "admin"),
      probe: async () => {
        // abort 把工作副本还原成 OLD、状态推到 published，`updated_at` 仍是同一秒。
        await transitionAsset({
          db,
          root: 不存在的根(),
          assetId: asset.id,
          action: "abort_iteration",
          viewer: 作者,
          now: 同一秒,
        })
        return { ok: true, toolCount: 1 }
      },
    }).then(
      () => null,
      (error: unknown) => error,
    )

    expect(错).toBeInstanceOf(AssetTransitionError)
    expect(错误码(错)).toBe("concurrent_transition")
    const 连接 = await getMcpConnection(db, asset.id)
    expect(连接?.publishedConfig).toMatchObject({ url: "https://old.example" })
    expect(await 状态(db, asset.id)).toBe("published")
  })
})
