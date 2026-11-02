import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { insertAsset } from "./asset"
import { AssetTransitionError, type SkillAction } from "./lifecycle"
import type { AssetMetadata } from "./metadata"
import { createMcpDraft, transitionAsset } from "./service"

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
const 审核 = { userId: "u2", department: "刑侦支队" }
const 管理 = { userId: "u3", department: "刑侦支队" }

function 授权(assetId: string, perm: "review" | "admin") {
  return [{ resourceType: "mcp", resourceId: assetId, perm }]
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
  return join(tmpdir(), `openhive-mcp-root-${randomUUID()}`, "assets")
}

async function failure(run: () => Promise<unknown>): Promise<Error> {
  const caught = await run().then(
    () => null,
    (error: unknown) => error,
  )
  if (!(caught instanceof Error)) throw new Error("期望这次调用抛错，它却成功了")
  return caught
}

/** 读状态机错误码；不是 `AssetTransitionError` 就返回 `undefined`，断言自然红（不用 `as`）。 */
function 错误码(error: Error): string | undefined {
  return error instanceof AssetTransitionError ? error.code : undefined
}

describe("MCP 全状态流转", () => {
  test("draft → in_review → pending_tech → published → iterating → published → offline → published → archived", async () => {
    const db = await freshDb()
    const root = 不存在的根()
    await createMcpDraft({
      db,
      owner: { id: "u1", name: "甲民警", department: "经侦支队" },
      name: "资金查询 MCP",
      description: "按账户查流水",
      category: "intelligence",
      id: "asset_mcp_lc",
      now: 2000,
      visibility: "department",
      connection: { transport: "remote", url: "https://mcp.example/path" },
    })
    const 步 = (action: SkillAction, viewer: typeof 作者, over: Record<string, unknown> = {}) =>
      transitionAsset({
        db,
        root,
        assetId: "asset_mcp_lc",
        action,
        viewer,
        now: 2001,
        ...over,
      } as Parameters<typeof transitionAsset>[0])

    const 审核授权 = 授权("asset_mcp_lc", "review")
    const 管理授权 = 授权("asset_mcp_lc", "admin")

    expect((await 步("submit_review", 作者)).status).toBe("in_review")
    expect((await 步("approve_business", 审核, { grants: 审核授权 })).status).toBe("pending_tech")
    expect((await 步("publish_tech", 管理, { grants: 管理授权 })).status).toBe("published")

    const 迭代 = await 步("start_iteration", 作者, { reason: "第二版改了地址" })
    expect(迭代.status).toBe("iterating")
    expect(迭代.version).toBe(2)
    expect(迭代.iterationNote).toBe("第二版改了地址")
    expect(迭代.iterationWorkspace).toBeNull()

    expect((await 步("submit_iteration", 作者)).status).toBe("iterating")
    expect((await 步("publish_iteration", 管理, { grants: 管理授权 })).status).toBe("published")

    expect((await 步("take_offline", 管理, { grants: 管理授权 })).status).toBe("offline")
    expect((await 步("bring_online", 管理, { grants: 管理授权 })).status).toBe("published")
    expect((await 步("archive", 管理, { grants: 管理授权 })).status).toBe("archived")

    expect(existsSync(root)).toBe(false)
  })

  test("abort_iteration：版本回退、说明清空、工作副本仍为 null", async () => {
    const db = await freshDb()
    const root = 不存在的根()
    const 管理授权 = 授权("asset_mcp_abort", "admin")
    await createMcpDraft({
      db,
      owner: { id: "u1", name: "甲民警", department: "经侦支队" },
      name: "会中止的 MCP",
      description: "描述",
      category: "intelligence",
      id: "asset_mcp_abort",
      now: 3000,
      visibility: "department",
      connection: { transport: "remote", url: "https://x" },
    })
    const 步 = (action: SkillAction, viewer: typeof 作者, over: Record<string, unknown> = {}) =>
      transitionAsset({ db, root, assetId: "asset_mcp_abort", action, viewer, now: 3001, ...over } as Parameters<typeof transitionAsset>[0])

    await 步("submit_review", 作者)
    await 步("approve_business", 审核, { grants: 授权("asset_mcp_abort", "review") })
    await 步("publish_tech", 管理, { grants: 管理授权 })
    await 步("start_iteration", 作者, { reason: "要改" })
    const 退 = await 步("abort_iteration", 作者)
    expect(退.status).toBe("published")
    expect(退.version).toBe(1)
    expect(退.iterationNote).toBe("")
    expect(退.iterationWorkspace).toBeNull()
    expect(existsSync(root)).toBe(false)
  })

  test("personal 发布仍被拒（批次 3 才放开）", async () => {
    const db = await freshDb()
    const root = 不存在的根()
    await createMcpDraft({
      db,
      owner: { id: "u1", name: "甲民警", department: "经侦支队" },
      name: "个人 MCP",
      description: "描述",
      category: "intelligence",
      id: "asset_mcp_personal",
      now: 3100,
      visibility: "personal",
      connection: { transport: "remote", url: "https://x" },
    })
    const 步 = (action: SkillAction, viewer: typeof 作者, over: Record<string, unknown> = {}) =>
      transitionAsset({ db, root, assetId: "asset_mcp_personal", action, viewer, now: 3101, ...over } as Parameters<typeof transitionAsset>[0])
    await 步("submit_review", 作者)
    await 步("approve_business", 审核, { grants: 授权("asset_mcp_personal", "review") })
    const error = await failure(() => 步("publish_tech", 管理, { grants: 授权("asset_mcp_personal", "admin") }))
    expect(错误码(error)).toBe("personal_asset_not_shared")
  })
})

describe("其它类型行为不变", () => {
  test("skill 的 submit_review 仍然要草稿副本", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset_skill", status: "draft" }))
    const error = await failure(() =>
      transitionAsset({
        db,
        root: 不存在的根(),
        assetId: "asset_skill",
        action: "submit_review",
        viewer: 作者,
        now: 4000,
      }),
    )
    expect(错误码(error)).toBe("draft_content_missing")
  })

  test("skill 的 start_iteration 仍然要 workspaceRoot", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset_skill_iter", status: "published" }))
    const error = await failure(() =>
      transitionAsset({
        db,
        root: 不存在的根(),
        assetId: "asset_skill_iter",
        action: "start_iteration",
        viewer: 作者,
        reason: "改一版",
        now: 4001,
      }),
    )
    expect(String(error)).toContain("需要 workspaceRoot")
  })

  test("knowledge_base 仍抛 unsupported_asset_type", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset_kb", type: "knowledge_base", status: "draft" }))
    const error = await failure(() =>
      transitionAsset({
        db,
        root: 不存在的根(),
        assetId: "asset_kb",
        action: "submit_review",
        viewer: 作者,
        now: 4002,
      }),
    )
    expect(错误码(error)).toBe("unsupported_asset_type")
  })
})
