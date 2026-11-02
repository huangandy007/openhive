import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { Config } from "@/config/config"
import { OpenhivePg } from "@/server/openhive/pg"
import { ENTRY_DIR_ENV } from "@/server/openhive/mcp-config-writer"
import {
  OpenhiveMcpConfigSync,
  同步MCP配置,
  尝试同步,
  读取已发布连接,
  触发同步,
} from "@/server/openhive/mcp-config-sync"

/**
 * 批次 4 · 同步器（设计 §3.3.4）。
 *
 * 判据落在**写进 `replaceGlobalMcp` 的那个对象**上：键集（I1）、快照优先于工作副本（I7）、
 * 下线后键消失、非法快照 / 治理键只跳过、并发写不交错、失败不抛。
 *
 * 为什么写者用桩：写盘本身的「整段替换 + 不写半份」是 Task 1 在真文件上钉的
 * （`openhive-mcp-replace.test.ts`）。这里只验**同步器交给它什么**，两层判据不重复。
 */

// PGlite 的 socket server 有连接上限；同一文件里顺序建库，把池压到 1 条
// （与 `openhive-asset-usage.test.ts` 同一纪律）。
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

const databases: ProductionDb[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.stop()))
})
afterAll(() => restorePoolMax())

async function freshDb(): Promise<ProductionDb["db"]> {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  // 列清单与 `openhive-asset-usage.test.ts` 的 `建用户` 逐列对齐（`auth.user` 没有默认值的列别漏）。
  await database.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values ('u1', '010001', '甲民警', 'x', 'x', '市局', '经侦支队', 'x', 1, 0, 'h', 0)
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
  iterationNote: "",
  iterationWorkspace: null,
  ...overrides,
})

type 库 = ProductionDb["db"]

/**
 * 插一行连接。**工作列按快照的形态摆**（`0029` 的两条 CHECK 要求 remote 只带 url、local 只带 command）；
 * 同步器只读 `published_config`，工作列的值不影响断言。
 */
async function 建连接(db: 库, assetId: string, 快照: unknown | null) {
  if (快照 !== null && typeof 快照 === "object" && (快照 as { transport?: unknown }).transport === "local") {
    await db.execute(sql`
      insert into auth.asset_mcp_connection (asset_id, transport, command, published_config, created_at, updated_at)
      values (${assetId}, 'local', array[${"bun"}, ${"run"}, ${"b.ts"}]::text[], ${快照}::jsonb, 1, 1)
    `)
    return
  }
  if (快照 === null) {
    await db.execute(sql`
      insert into auth.asset_mcp_connection (asset_id, transport, url, created_at, updated_at)
      values (${assetId}, 'remote', ${"https://work.example/mcp"}, 1, 1)
    `)
    return
  }
  await db.execute(sql`
    insert into auth.asset_mcp_connection (asset_id, transport, url, published_config, created_at, updated_at)
    values (${assetId}, 'remote', ${"https://work.example/mcp"}, ${快照}::jsonb, 1, 1)
  `)
}

function 记录配置() {
  const 写入: Record<string, unknown>[] = []
  const config = {
    replaceGlobalMcp: (entries: Record<string, unknown>) => {
      写入.push(entries)
      return Effect.succeed({ changed: true })
    },
  } as unknown as Pick<Config.Interface, "replaceGlobalMcp">
  return { config, 写入 }
}

describe("同步器：键集与快照（I1 / I7）", () => {
  test("I1：键集 ≡ 已发布 / 迭代中且有发布快照的 MCP 资产 id；草稿 / 下线 / 无快照都不上", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset-a" }))
    await insertAsset(db, 资产({ id: "asset-b", status: "iterating" }))
    await insertAsset(db, 资产({ id: "asset-draft", status: "draft" }))
    await insertAsset(db, 资产({ id: "asset-offline", status: "offline" }))
    await insertAsset(db, 资产({ id: "asset-no-snapshot" }))
    await 建连接(db, "asset-a", { transport: "remote", url: "https://a.example/mcp", headers: { authorization: "Bearer a" } })
    await 建连接(db, "asset-b", { transport: "local", command: ["bun", "run", "b.ts"], environment: { TOKEN: "b" } })
    await 建连接(db, "asset-draft", { transport: "remote", url: "https://draft.example/mcp" })
    await 建连接(db, "asset-offline", { transport: "remote", url: "https://off.example/mcp" })
    await 建连接(db, "asset-no-snapshot", null)

    const { config, 写入 } = 记录配置()
    const 结果 = await 同步MCP配置({ db, config })

    expect(结果.键).toEqual(["asset-a", "asset-b"])
    expect(写入).toHaveLength(1)
    expect(写入[0]).toEqual({
      "asset-a": { type: "remote", url: "https://a.example/mcp", headers: { authorization: "Bearer a" } },
      "asset-b": { type: "local", command: ["bun", "run", "b.ts"], environment: { TOKEN: "b" } },
    })
  })

  test("I7：迭代期改工作副本不影响产出；快照换了才变", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset-a", status: "iterating" }))
    await 建连接(db, "asset-a", { transport: "remote", url: "https://published.example/mcp" })
    await db.execute(sql`
      update auth.asset_mcp_connection set url = ${"https://work.example/mcp"} where asset_id = ${"asset-a"}
    `)

    const 第一 = 记录配置()
    await 同步MCP配置({ db, config: 第一.config })
    expect(第一.写入[0]).toEqual({ "asset-a": { type: "remote", url: "https://published.example/mcp" } })

    await db.execute(sql`
      update auth.asset_mcp_connection
         set published_config = ${{ transport: "remote", url: "https://published2.example/mcp" }}::jsonb
       where asset_id = ${"asset-a"}
    `)
    const 第二 = 记录配置()
    await 同步MCP配置({ db, config: 第二.config })
    expect(第二.写入[0]).toEqual({ "asset-a": { type: "remote", url: "https://published2.example/mcp" } })
  })

  test("下线后下一次同步键消失（整体替换的依据）", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset-a" }))
    await 建连接(db, "asset-a", { transport: "remote", url: "https://a.example/mcp" })

    await 同步MCP配置({ db, config: 记录配置().config })
    await db.execute(sql`update auth.asset set status = 'offline' where id = ${"asset-a"}`)

    const { config, 写入 } = 记录配置()
    const 结果 = await 同步MCP配置({ db, config })
    expect(结果.键).toEqual([])
    expect(写入[0]).toEqual({})
  })

  test("发布快照不合法 ⇒ 跳过并记录原因，其它资产照常下发", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset-a" }))
    await insertAsset(db, 资产({ id: "asset-bad" }))
    await 建连接(db, "asset-a", { transport: "remote", url: "https://a.example/mcp" })
    await 建连接(db, "asset-bad", { transport: "remote" })

    const { config, 写入 } = 记录配置()
    const 结果 = await 同步MCP配置({ db, config })

    expect(结果.键).toEqual(["asset-a"])
    expect(结果.跳过.map((item) => item.id)).toEqual(["asset-bad"])
    expect(Object.keys(写入[0] as Record<string, unknown>)).toEqual(["asset-a"])
  })

  test("资产 id 占用治理键 ⇒ 跳过，不与受保护键抢", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "openhive-governance" }))
    await 建连接(db, "openhive-governance", { transport: "remote", url: "https://evil.example/mcp" })

    const { config, 写入 } = 记录配置()
    const 结果 = await 同步MCP配置({ db, config })

    expect(结果.键).toEqual([])
    expect(结果.跳过.map((item) => item.id)).toEqual(["openhive-governance"])
    expect(写入[0]).toEqual({})
  })

  test("并发的两次同步被串行化（同一份全局配置不能有两个写者交错）", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset-a" }))
    await 建连接(db, "asset-a", { transport: "remote", url: "https://a.example/mcp" })

    let 在写 = 0
    let 峰值 = 0
    const config = {
      replaceGlobalMcp: () =>
        Effect.promise(async () => {
          在写 += 1
          峰值 = Math.max(峰值, 在写)
          await new Promise<void>((resolve) => setTimeout(resolve, 10))
          在写 -= 1
          return { changed: true }
        }),
    } as unknown as Pick<Config.Interface, "replaceGlobalMcp">

    await Promise.all([同步MCP配置({ db, config }), 同步MCP配置({ db, config })])
    expect(峰值).toBe(1)
  })

  test("写配置抛错 ⇒ 尝试同步不抛、返回 undefined（保留上一份）", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset-a" }))
    await 建连接(db, "asset-a", { transport: "remote", url: "https://a.example/mcp" })
    const config = {
      replaceGlobalMcp: () => Effect.die(new Error("EROFS: read-only file system")),
    } as unknown as Pick<Config.Interface, "replaceGlobalMcp">

    const 原error = console.error
    const 记录: unknown[][] = []
    console.error = (...args: unknown[]) => void 记录.push(args)
    try {
      await expect(尝试同步({ db, config })).resolves.toBeUndefined()
      expect(记录).toHaveLength(1)
    } finally {
      console.error = 原error
    }
  })
})

describe("触发同步：只对 MCP、只在开关打开时（§3.3.4 触发点 2）", () => {
  const 不查库 = { execute: () => Promise.reject(new Error("不该查库")) }

  test("非 MCP 资产 ⇒ 不碰库也不写配置", async () => {
    const { config, 写入 } = 记录配置()
    await Effect.runPromise(
      触发同步({ type: "skill", db: 不查库, config, env: { [ENTRY_DIR_ENV]: "/srv/asset-service" } }),
    )
    expect(写入).toHaveLength(0)
  })

  test("开关未开 ⇒ 不碰库也不写配置", async () => {
    // 计数而不是「让 execute 拒绝」：拒绝会被 `尝试同步` 按设计吞掉，
    // 断言面看不出「碰过库」（变异 4 曾因此存活）。
    let 查库 = 0
    const db = {
      execute: () => {
        查库 += 1
        return Promise.reject(new Error("不该查库"))
      },
    }
    const { config, 写入 } = 记录配置()
    await Effect.runPromise(触发同步({ type: "mcp", db, config, env: {} }))
    expect(查库).toBe(0)
    expect(写入).toHaveLength(0)
  })

  test("开关打开 ⇒ 按库里的快照写一次", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset-a" }))
    await 建连接(db, "asset-a", { transport: "remote", url: "https://a.example/mcp" })

    const { config, 写入 } = 记录配置()
    await Effect.runPromise(
      触发同步({ type: "mcp", db, config, env: { [ENTRY_DIR_ENV]: "/srv/asset-service" } }),
    )
    expect(写入).toHaveLength(1)
    expect(写入[0]).toEqual({ "asset-a": { type: "remote", url: "https://a.example/mcp" } })
  })
})

describe("兜底层：开关是唯一的门", () => {
  test("开关未开 ⇒ 层建起来什么都不做（不查库、不写配置）", async () => {
    const db = await freshDb()
    let 查库 = 0
    const { config, 写入 } = 记录配置()
    const 层 = OpenhiveMcpConfigSync.layer.pipe(
      Layer.provide(Layer.succeed(Config.Service, config as Config.Interface)),
      Layer.provide(
        Layer.succeed(OpenhivePg.Service, {
          pg: () => {
            查库 += 1
            return db
          },
        } as unknown as OpenhivePg.Interface),
      ),
    )

    const 原 = process.env[ENTRY_DIR_ENV]
    delete process.env[ENTRY_DIR_ENV]
    try {
      await Effect.runPromise(Effect.scoped(Layer.build(层)))
    } finally {
      if (原 !== undefined) process.env[ENTRY_DIR_ENV] = 原
    }

    expect(查库).toBe(0)
    expect(写入).toHaveLength(0)
  })

  test("开关打开 ⇒ 启动时同步一次，作用域收尾不卡住", async () => {
    const db = await freshDb()
    await insertAsset(db, 资产({ id: "asset-a" }))
    await 建连接(db, "asset-a", { transport: "remote", url: "https://a.example/mcp" })
    const { config, 写入 } = 记录配置()
    const 层 = OpenhiveMcpConfigSync.layer.pipe(
      Layer.provide(Layer.succeed(Config.Service, config as Config.Interface)),
      Layer.provide(
        Layer.succeed(OpenhivePg.Service, { pg: () => db } as unknown as OpenhivePg.Interface),
      ),
    )

    const 原 = process.env[ENTRY_DIR_ENV]
    process.env[ENTRY_DIR_ENV] = "/srv/asset-service"
    try {
      await Effect.runPromise(Effect.scoped(Layer.build(层)))
    } finally {
      if (原 === undefined) delete process.env[ENTRY_DIR_ENV]
      else process.env[ENTRY_DIR_ENV] = 原
    }

    expect(写入).toHaveLength(1)
    expect(写入[0]).toEqual({ "asset-a": { type: "remote", url: "https://a.example/mcp" } })
  })
})

// 读快照的入口单独钉一次：`published_config` 是 jsonb，PGlite / bun-sql 的返回形状不同，
// 同步器只认 `::text` 再 parse 这一条路（与 `mcp-connection.ts` 同一条理由）。
test("读取已发布连接：published_config 以 JSON 文本取出", async () => {
  const db = await freshDb()
  await insertAsset(db, 资产({ id: "asset-a" }))
  await 建连接(db, "asset-a", { transport: "remote", url: "https://a.example/mcp" })

  const 行 = await 读取已发布连接(db)
  expect(行).toHaveLength(1)
  expect(JSON.parse(行[0]?.published_config ?? "")).toEqual({ transport: "remote", url: "https://a.example/mcp" })
})
