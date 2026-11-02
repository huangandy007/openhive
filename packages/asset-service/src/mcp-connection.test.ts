import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { AssetMetadataError, deleteAsset, insertAsset, type AssetTarget } from "./asset"
import {
  MASKED_VALUE,
  getMcpConnection,
  insertMcpConnection,
  updateMcpConnection,
  规范化连接,
  遮罩连接,
} from "./mcp-connection"
import type { AssetMetadata } from "./metadata"

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

function 资产(over: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset_mcp_1",
    name: "资金查询 MCP",
    type: "mcp",
    description: "按账户查流水",
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

async function 有资产(db: AssetTarget, over: Partial<AssetMetadata> = {}) {
  const metadata = 资产(over)
  await insertAsset(db, metadata)
  return metadata
}

/**
 * 期望抛错的一次调用，保留原始错误（约束名要从它的消息里读）。
 *
 * ⚠️ **必须剥 `cause`**：drizzle 把 PG 错误包成 `DrizzleQueryError`，它自己的 `message`
 * 只有 `Failed query: …`——约束名不在里面，照着它断言等于什么都没断（同 `authorization.test.ts`）。
 */
async function failure(run: () => Promise<unknown>): Promise<Error> {
  const caught = await run().then(
    () => null,
    (error: unknown) => error,
  )
  if (!(caught instanceof Error)) throw new Error("期望这次调用抛错，它却成功了")
  return caught.cause instanceof Error ? caught.cause : caught
}

describe("连接表 · DDL 约束", () => {
  test("remote 带 command ⇒ shape_check", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    const error = await failure(() =>
      db.execute(sql`
        insert into auth.asset_mcp_connection (asset_id, transport, url, command, created_at, updated_at)
        values (${asset.id}, 'remote', 'https://example', array['bun']::text[], 1, 1)
      `),
    )
    expect(String(error)).toContain("asset_mcp_connection_shape_check")
  })

  test("local 带 headers ⇒ fields_check", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    const error = await failure(() =>
      db.execute(sql`
        insert into auth.asset_mcp_connection (asset_id, transport, command, headers, created_at, updated_at)
        values (${asset.id}, 'local', array['bun']::text[], '{"a":"b"}'::jsonb, 1, 1)
      `),
    )
    expect(String(error)).toContain("asset_mcp_connection_fields_check")
  })

  test("timeout_ms 必须 > 0 ⇒ timeout_check", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    const error = await failure(() =>
      db.execute(sql`
        insert into auth.asset_mcp_connection (asset_id, transport, url, timeout_ms, created_at, updated_at)
        values (${asset.id}, 'remote', 'https://example', 0, 1, 1)
      `),
    )
    expect(String(error)).toContain("asset_mcp_connection_timeout_check")
  })
})

describe("连接规格 · 读写往返", () => {
  test("remote：url / headers 原样读回，JSON 列读出是对象", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    await insertMcpConnection(
      db,
      asset.id,
      规范化连接({
        transport: "remote",
        url: "https://mcp.example/path",
        headers: { Authorization: "Bearer s3cret" },
        timeoutMs: 15000,
      }),
      2000,
    )

    const row = await getMcpConnection(db, asset.id)
    expect(row?.transport).toBe("remote")
    expect(row?.url).toBe("https://mcp.example/path")
    expect(row?.command).toBeNull()
    expect(row?.headers).toEqual({ Authorization: "Bearer s3cret" })
    expect(row?.environment).toEqual({})
    expect(row?.enabled).toBe(true)
    expect(row?.timeoutMs).toBe(15000)
    expect(row?.createdAt).toBe(2000)
  })

  test("local：command 数组读回仍是数组（不是行构造器 / 字符串）", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    await insertMcpConnection(
      db,
      asset.id,
      规范化连接({
        transport: "local",
        command: ["bun", "run", "server.ts"],
        cwd: "/srv/mcp",
        environment: { USER_ID: "u1" },
      }),
      2001,
    )

    const row = await getMcpConnection(db, asset.id)
    expect(row?.transport).toBe("local")
    expect(row?.command).toEqual(["bun", "run", "server.ts"])
    expect(row?.url).toBeNull()
    expect(row?.cwd).toBe("/srv/mcp")
    expect(row?.environment).toEqual({ USER_ID: "u1" })
    expect(row?.headers).toEqual({})
  })

  test("读接口遮罩：键名保留、值一律 MASKED_VALUE、publishedConfig 不出视图", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    await insertMcpConnection(
      db,
      asset.id,
      规范化连接({
        transport: "local",
        command: ["bun", "server.ts"],
        headers: undefined,
        environment: { TOKEN: "s3cret", USER_ID: "u1" },
      }),
      2002,
    )

    const row = await getMcpConnection(db, asset.id)
    if (row === undefined) throw new Error("连接行没读回来")
    const view = 遮罩连接(row)
    expect(view.environment).toEqual({ TOKEN: MASKED_VALUE, USER_ID: MASKED_VALUE })
    expect(JSON.stringify(view)).not.toContain("s3cret")
    expect("publishedConfig" in view).toBe(false)
  })

  test("删掉资产 ⇒ 连接行级联删除", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    await insertMcpConnection(
      db,
      asset.id,
      规范化连接({ transport: "remote", url: "https://example" }),
      2003,
    )

    await deleteAsset(db, asset.id)
    expect(await getMcpConnection(db, asset.id)).toBeUndefined()
    const rows = rowsOf(
      await db.execute(sql`select asset_id from auth.asset_mcp_connection where asset_id = ${asset.id}`),
    )
    expect(rows.length).toBe(0)
  })
})

describe("规范化连接 · 拒绝", () => {
  const 拒 = (value: unknown) => {
    expect(() => 规范化连接(value)).toThrow(AssetMetadataError)
  }

  test("remote 缺 url", () => 拒({ transport: "remote" }))
  test("remote 带 command", () => 拒({ transport: "remote", url: "https://x", command: ["bun"] }))
  test("remote 带 environment", () => 拒({ transport: "remote", url: "https://x", environment: { A: "b" } }))
  test("local 缺 command", () => 拒({ transport: "local" }))
  test("local 的首个参数是空串", () => 拒({ transport: "local", command: [""] }))
  test("local 带 url", () => 拒({ transport: "local", command: ["bun"], url: "https://x" }))
  test("未知 transport", () => 拒({ transport: "stdio", command: ["bun"] }))
  test("请求头的值不是字符串", () => 拒({ transport: "remote", url: "https://x", headers: { A: 1 } }))
  test("enabled 不是布尔", () => 拒({ transport: "remote", url: "https://x", enabled: "yes" }))
  test("timeoutMs 不是正整数", () => {
    拒({ transport: "remote", url: "https://x", timeoutMs: 0 })
    拒({ transport: "remote", url: "https://x", timeoutMs: 1.5 })
  })
})

describe("更新连接", () => {
  test("remote → local：url 被清空、command 落库、updated_at 前移", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    await insertMcpConnection(
      db,
      asset.id,
      规范化连接({ transport: "remote", url: "https://old.example" }),
      3000,
    )

    const 改后 = await updateMcpConnection(
      db,
      asset.id,
      { transport: "local", command: ["node", "server.js"], cwd: "/srv" },
      3001,
    )
    expect(改后?.transport).toBe("local")
    expect(改后?.url).toBeNull()
    expect(改后?.command).toEqual(["node", "server.js"])
    expect(改后?.cwd).toBe("/srv")
    expect(改后?.updatedAt).toBe(3001)
  })

  test("资产没有连接行 ⇒ undefined（不静默插入）", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    expect(
      await updateMcpConnection(db, asset.id, { transport: "remote", url: "https://x" }, 3002),
    ).toBeUndefined()
  })
})
