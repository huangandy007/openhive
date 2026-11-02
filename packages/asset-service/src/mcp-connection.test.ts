import { afterEach, describe, expect, test } from "bun:test"
import { sql, type SQL } from "drizzle-orm"
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

describe("规范化连接 · 拒绝遮罩占位值（终审 I-2）", () => {
  /** 捕获同步抛错；用法与 `failure` 同源，只是这里是同步函数。 */
  const 捕获 = (run: () => unknown): unknown => {
    try {
      run()
      return undefined
    } catch (caught) {
      return caught
    }
  }

  test("remote 的 headers 回传 MASKED_VALUE ⇒ AssetMetadataError，字段指向该键", () => {
    const error = 捕获(() =>
      规范化连接({
        transport: "remote",
        url: "https://x",
        headers: { Authorization: MASKED_VALUE },
      }),
    )
    expect(error).toBeInstanceOf(AssetMetadataError)
    if (!(error instanceof AssetMetadataError)) throw new Error("期望 AssetMetadataError")
    expect(error.issues).toContainEqual({
      field: "connection.headers.Authorization",
      message: "不能提交遮罩占位值，请重新填写真实值",
    })
  })

  test("local 的 environment 回传 MASKED_VALUE ⇒ AssetMetadataError，字段指向该键", () => {
    const error = 捕获(() =>
      规范化连接({
        transport: "local",
        command: ["bun", "server.ts"],
        environment: { API_KEY: MASKED_VALUE },
      }),
    )
    expect(error).toBeInstanceOf(AssetMetadataError)
    if (!(error instanceof AssetMetadataError)) throw new Error("期望 AssetMetadataError")
    expect(error.issues).toContainEqual({
      field: "connection.environment.API_KEY",
      message: "不能提交遮罩占位值，请重新填写真实值",
    })
  })
})

describe("更新连接", () => {
  test("收到遮罩占位值 ⇒ 拒绝且库里仍是原凭据", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    await insertMcpConnection(
      db,
      asset.id,
      规范化连接({
        transport: "remote",
        url: "https://mcp.example/path",
        headers: { Authorization: "Bearer s3cret" },
      }),
      4000,
    )

    const error = await updateMcpConnection(
      db,
      asset.id,
      {
        transport: "remote",
        url: "https://mcp.example/path",
        headers: { Authorization: MASKED_VALUE },
      },
      4001,
    ).then(
      () => null,
      (caught: unknown) => caught,
    )
    // 先断库：变异验证要能在「哨兵落库」这一步直接红，而不是被前面的类型断言挡住。
    const row = await getMcpConnection(db, asset.id)
    expect(row?.headers).toEqual({ Authorization: "Bearer s3cret" })
    expect(row?.updatedAt).toBe(4000)
    expect(error).toBeInstanceOf(AssetMetadataError)
  })

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

/** 把 `sql` 模板里的原始文本拼出来（与 `mcp-draft.test.ts` 的替身同一读法）。 */
function 查询文本(query: SQL): string {
  return query.queryChunks
    .map((chunk) => {
      const value =
        chunk !== null && typeof chunk === "object" && "value" in chunk ? chunk.value : undefined
      return Array.isArray(value) ? value.filter((part): part is string => typeof part === "string").join("") : ""
    })
    .join("")
}

/** 只让 update 那条 execute 抛给定错误，其余委托真 db。 */
function 更新时抛(db: AssetTarget, error: Error): AssetTarget {
  return {
    execute: async (query) => {
      if (查询文本(query).includes("update auth.asset_mcp_connection")) throw error
      return db.execute(query)
    },
  }
}

describe("连接写入异常 · 清洗绑定参数（终审 I-1）", () => {
  test("真实写失败（重复主键，headers 带真凭据）⇒ 异常不带原文、无 cause、仍留约束名", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    const 输入 = 规范化连接({
      transport: "remote",
      url: "https://x",
      headers: { Authorization: "Bearer s3cret" },
    })
    await insertMcpConnection(db, asset.id, 输入, 5000)
    const error = await insertMcpConnection(db, asset.id, 输入, 5001).then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(Error)
    const text = String(error)
    expect(text).not.toContain("Bearer s3cret")
    expect(text).not.toContain("env-raw-42")
    expect(text).not.toContain("params:")
    expect(JSON.stringify(error)).not.toContain("Bearer s3cret")
    expect(JSON.stringify(error)).not.toContain("env-raw-42")
    expect(error instanceof Error ? error.cause : "非 Error").toBeUndefined()
    expect(text).toContain("MCP 连接写入失败")
    expect(text.includes("asset_mcp_connection_pkey") || text.includes("23505")).toBe(true)
  })

  test("真实写失败（重复主键，environment 带真凭据）⇒ 环境变量原文不外带", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    const 输入 = 规范化连接({
      transport: "local",
      command: ["bun", "server.ts"],
      environment: { API_KEY: "env-raw-42" },
    })
    await insertMcpConnection(db, asset.id, 输入, 5002)
    const error = await insertMcpConnection(db, asset.id, 输入, 5003).then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(Error)
    const text = String(error)
    expect(text).not.toContain("env-raw-42")
    expect(text).not.toContain("params:")
    expect(error instanceof Error ? error.cause : "非 Error").toBeUndefined()
    expect(text).toContain("MCP 连接写入失败")
    expect(text.includes("asset_mcp_connection_pkey") || text.includes("23505")).toBe(true)
  })

  test("update 路径：drizzle 形状的外层错误被剥掉，只剩 SQLSTATE 与约束名", async () => {
    const db = await freshDb()
    const asset = await 有资产(db)
    await insertMcpConnection(
      db,
      asset.id,
      规范化连接({ transport: "remote", url: "https://x" }),
      6000,
    )

    const 内层 = new Error(
      'new row for relation "asset_mcp_connection" violates check constraint "asset_mcp_connection_timeout_check"',
    )
    Object.assign(内层, { errno: "23514" })
    const 外层 = new Error(
      "Failed query: update auth.asset_mcp_connection set ...\nparams: Bearer s3cret, env-raw-42",
      { cause: 内层 },
    )

    const error = await updateMcpConnection(
      更新时抛(db, 外层),
      asset.id,
      { transport: "remote", url: "https://x", headers: { Authorization: "Bearer s3cret" } },
      6001,
    ).then(
      () => null,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(Error)
    const text = String(error)
    expect(text).not.toContain("Bearer s3cret")
    expect(text).not.toContain("env-raw-42")
    expect(text).not.toContain("params:")
    expect(text).not.toContain("violates")
    expect(error instanceof Error ? error.cause : "非 Error").toBeUndefined()
    expect(text).toContain("MCP 连接写入失败")
    expect(text).toContain("23514")
    expect(text).toContain("asset_mcp_connection_timeout_check")
  })
})
