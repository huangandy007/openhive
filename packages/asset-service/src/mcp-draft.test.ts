import { afterEach, describe, expect, test } from "bun:test"
import { sql, type SQL } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { AssetMetadataError, assetById, type AssetTarget } from "./asset"
import { getMcpConnection } from "./mcp-connection"
import { createMcpDraft } from "./service"

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

const owner = { id: "u1", name: "甲民警", department: "经侦支队" }

async function 资产数(db: AssetTarget): Promise<number> {
  return rowsOf(await db.execute(sql`select id from auth.asset`)).length
}

/** 让「写连接」那一条 execute 失败，其余照常——用来钉住补偿删除。 */
function 在连接写入处失败(db: AssetTarget): AssetTarget {
  const 文本 = (query: SQL) =>
    query.queryChunks
      .map((chunk) => {
        // drizzle 的 `sql` 把原始参数值直接塞进 `queryChunks`（不是 Param 包装），
        // 所以 `${x ?? null}` 这类插值在这里就是裸 `null`——先收窄再读 `.value`。
        const value =
          chunk !== null && typeof chunk === "object" && "value" in chunk ? chunk.value : undefined
        return Array.isArray(value) ? value.filter((part): part is string => typeof part === "string").join("") : ""
      })
      .join("")
  return {
    execute: async (query) => {
      if (文本(query).includes("asset_mcp_connection")) throw new Error("模拟连接写入失败")
      return db.execute(query)
    },
  }
}

describe("createMcpDraft", () => {
  test("建 remote 草稿：type=mcp / status=draft / 连接落库", async () => {
    const db = await freshDb()
    const asset = await createMcpDraft({
      db,
      owner,
      name: "资金查询 MCP",
      description: "按账户查流水",
      category: "intelligence",
      id: "asset_mcp_new",
      now: 4000,
      connection: { transport: "remote", url: "https://mcp.example/path" },
    })

    expect(asset.type).toBe("mcp")
    expect(asset.status).toBe("draft")
    expect(asset.icon).toBe("mcp")
    expect(asset.visibility).toBe("targeted")
    const row = await assetById(db, "asset_mcp_new")
    expect(row?.type).toBe("mcp")
    const connection = await getMcpConnection(db, "asset_mcp_new")
    expect(connection?.transport).toBe("remote")
    expect(connection?.url).toBe("https://mcp.example/path")
    expect(connection?.createdAt).toBe(4000)
  })

  test("建 local 草稿：命令与工作目录落库", async () => {
    const db = await freshDb()
    await createMcpDraft({
      db,
      owner,
      name: "本地查询 MCP",
      description: "本机脚本",
      category: "intelligence",
      id: "asset_mcp_local",
      now: 4001,
      visibility: "department",
      connection: { transport: "local", command: ["bun", "run", "server.ts"], cwd: "/srv/mcp" },
    })
    const connection = await getMcpConnection(db, "asset_mcp_local")
    expect(connection?.command).toEqual(["bun", "run", "server.ts"])
    expect(connection?.cwd).toBe("/srv/mcp")
    expect(connection?.url).toBeNull()
  })

  test("非法连接 ⇒ 抛 AssetMetadataError 且资产行一条都不落", async () => {
    const db = await freshDb()
    const 前 = await 资产数(db)
    const error = await createMcpDraft({
      db,
      owner,
      name: "坏连接",
      description: "remote 带了命令",
      category: "intelligence",
      id: "asset_mcp_bad",
      connection: { transport: "remote", url: "https://x", command: ["bun"] },
    }).then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(AssetMetadataError)
    expect(await 资产数(db)).toBe(前)
  })

  test("未知分类 ⇒ 抛 AssetMetadataError 且不落库", async () => {
    const db = await freshDb()
    const 前 = await 资产数(db)
    const error = await createMcpDraft({
      db,
      owner,
      name: "错分类",
      description: "分类不存在",
      category: "no-such-category",
      id: "asset_mcp_category",
      connection: { transport: "remote", url: "https://x" },
    }).then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(AssetMetadataError)
    expect(await 资产数(db)).toBe(前)
  })

  test("连接写失败 ⇒ 刚插入的资产行被删掉（不留下半条记录）", async () => {
    const db = await freshDb()
    const 前 = await 资产数(db)
    const 骗 = 在连接写入处失败(db)
    const error = await createMcpDraft({
      db: 骗,
      owner,
      name: "写一半",
      description: "连接写失败",
      category: "intelligence",
      id: "asset_mcp_rollback",
      connection: { transport: "remote", url: "https://x" },
    }).then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain("MCP 连接写入失败")
    expect(await 资产数(db)).toBe(前)
  })
})
