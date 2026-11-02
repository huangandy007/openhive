import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { Effect, Layer, Logger } from "effect"
import { migrate } from "@opencode-ai/auth/migrate"
import { restorePoint, startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { Config } from "@/config/config"
import { OpenhivePg } from "@/server/openhive/pg"
import { ENTRY_DIR_ENV, 串行写, 串行写Effect } from "@/server/openhive/mcp-config-writer"
import type { McpAvailabilityTarget } from "@/server/openhive/mcp-availability"
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

/**
 * 「不该被碰」的库桩：只计数、调用即拒。
 *
 * **断言面必须是计数，不能只靠拒绝**：`尝试同步` 按设计吞掉异常，删掉「非 MCP / 开关未开」
 * 这类门后，异常被吞、`写入` 仍为 0，只断言 `写入` 的用例照样绿（变异 4 的失效模式）。
 */
function 计数桩() {
  let 次数 = 0
  const db = {
    execute: () => {
      次数 += 1
      return Promise.reject(new Error("不该查库"))
    },
  }
  return { db, 计数: () => 次数 }
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
      // 裁决 2：失败日志只留类型名，绝不带 message——`ConfigParse.jsonc` 的失败消息会嵌入
      // 整份配置原文（含本同步器写入的 headers / environment 值），PG 的 message 可能带连接串。
      expect(JSON.stringify(记录)).not.toContain("EROFS: read-only file system")
      expect(JSON.stringify(记录)).toContain("Error")
    } finally {
      console.error = 原error
    }
  })
})

describe("串行写：同一队列（I1 / I2）", () => {
  test("I1：串行写占住队列时，串行写Effect 的桩在放行前零调用", async () => {
    let 调用 = 0
    let 放行!: () => void
    const 闸门 = new Promise<void>((resolve) => {
      放行 = resolve
    })

    // 占住共享队列，模拟同步器 / 治理监督器正在写。
    const 占位 = 串行写(async () => {
      await 闸门
    })

    const 跑 = Effect.runPromise(串行写Effect(Effect.sync(() => {
      调用 += 1
      return "ok"
    })))
    try {
      await new Promise((resolve) => setTimeout(resolve, 20))
      // 跑在另一条队列上 ⇒ 它此刻已经调用过桩。
      expect(调用).toBe(0)
    } finally {
      放行()
    }

    await 占位
    await expect(跑).resolves.toBe("ok")
    expect(调用).toBe(1)
  })

  test("I1 接线：configUpdate 走串行写Effect（不是直接 updateGlobal）", () => {
    const 源 = readFileSync(
      join(import.meta.dir, "../../src/server/routes/instance/httpapi/handlers/global.ts"),
      "utf8",
    )
    // 必须真的 `yield*` 这一行；整行注释掉（以 `//` 开头）或只写在别处都算没接上。
    expect(源).toMatch(
      /^\s+const result = yield\* OpenhiveMcpConfigWriter\.串行写Effect\(config\.updateGlobal\(ctx\.payload\)\)/m,
    )
  })

  test("I2：读库也在队列内——两次并发同步，最终写入后完成那次的快照", async () => {
    let 查询次数 = 0
    let 放行首查!: () => void
    const 首查闸门 = new Promise<void>((resolve) => {
      放行首查 = resolve
    })

    // 第一次查询挂在门闩上（慢），第二次立即返回不同快照（快）。
    const db = {
      execute: async () => {
        查询次数 += 1
        const 本次 = 查询次数
        if (本次 === 1) await 首查闸门
        return [
          {
            id: `asset-${本次}`,
            published_config: JSON.stringify({ transport: "remote", url: `https://s${本次}.example/mcp` }),
          },
        ]
      },
    } as unknown as McpAvailabilityTarget

    const 写入: string[][] = []
    const config = {
      replaceGlobalMcp: (entries: Record<string, unknown>) => {
        写入.push(Object.keys(entries).toSorted())
        return Effect.succeed({ changed: true })
      },
    } as unknown as Pick<Config.Interface, "replaceGlobalMcp">

    const 慢 = 同步MCP配置({ db, config })
    // 让慢的那次先进入读库并挂住。
    await new Promise((resolve) => setTimeout(resolve, 0))
    const 快 = 同步MCP配置({ db, config })
    try {
      // 等快的那次完成写（读库在队列外时它会先写完，把旧快照留在最后）。
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      放行首查()
    }

    await Promise.all([慢, 快])
    // 后完成的是第二次查询的快照：它读库时第一次还没放行。
    expect(写入.at(-1)).toEqual(["asset-2"])
    expect(查询次数).toBe(2)
  })
})

describe("触发同步：只对 MCP、只在开关打开时（§3.3.4 触发点 2）", () => {
  test("非 MCP 资产 ⇒ 不碰库也不写配置", async () => {
    const { db, 计数 } = 计数桩()
    const { config, 写入 } = 记录配置()
    await Effect.runPromise(
      触发同步({ type: "skill", db, config, env: { [ENTRY_DIR_ENV]: "/srv/asset-service" } }),
    )
    expect(计数()).toBe(0)
    expect(写入).toHaveLength(0)
  })

  test("开关未开 ⇒ 不碰库也不写配置", async () => {
    const { db, 计数 } = 计数桩()
    const { config, 写入 } = 记录配置()
    await Effect.runPromise(触发同步({ type: "mcp", db, config, env: {} }))
    expect(计数()).toBe(0)
    expect(写入).toHaveLength(0)
  })

  test("没有 Config 服务 ⇒ 不碰库也不写配置", async () => {
    const { db, 计数 } = 计数桩()
    await Effect.runPromise(
      触发同步({ type: "mcp", db, config: undefined, env: { [ENTRY_DIR_ENV]: "/srv/asset-service" } }),
    )
    expect(计数()).toBe(0)
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

  test("取库当场抛 ⇒ 层能建起来，日志只留错误名、不含连接串（裁决 2）", async () => {
    const { config, 写入 } = 记录配置()
    const 层 = OpenhiveMcpConfigSync.layer.pipe(
      Layer.provide(Layer.succeed(Config.Service, config as Config.Interface)),
      Layer.provide(
        Layer.succeed(OpenhivePg.Service, {
          pg: () => {
            // 故意把连接串形态的原文塞进 message：日志若回显 message 就会带出 SECRET。
            throw new Error("password=SECRET")
          },
        } as unknown as OpenhivePg.Interface),
      ),
    )

    const 日志: unknown[] = []
    const 原 = process.env[ENTRY_DIR_ENV]
    process.env[ENTRY_DIR_ENV] = "/srv/asset-service"
    try {
      await Effect.runPromise(
        Effect.scoped(Layer.build(层)).pipe(
          // 只装捕获器，不叠默认 console logger：断言的就是「交给日志的是什么」。
          Effect.provide(
            Logger.layer(
              [
                Logger.make<unknown, void>((options) => {
                  日志.push(options.message)
                }),
              ],
              { mergeWithExisting: false },
            ),
          ),
        ),
      )
    } finally {
      if (原 === undefined) delete process.env[ENTRY_DIR_ENV]
      else process.env[ENTRY_DIR_ENV] = 原
    }

    // 层能建起来（上面没抛）= 「同步不可用」没有升级成「内核起不来」。
    expect(写入).toHaveLength(0)
    expect(JSON.stringify(日志)).toContain("MCP 配置同步跳过")
    expect(JSON.stringify(日志)).not.toContain("SECRET")
    expect(JSON.stringify(日志)).toContain('"error":["Error"]')
  })
})

/**
 * **接线**用例，不是行为用例。
 *
 * 行为由上面的 `触发同步` 三条 ＋ 真栈验收覆盖；这里只钉「生命周期出口真的调了 trigger，
 * 且把 `Option` 里的 Config 交了出去」。全文装配需要起完整 HTTP 应用 + 把
 * `Global.Path.config` 指到临时目录，成本远大于它守的东西。两个出口都要接：成功分支与
 * 「流转已生效、通知失败」分支（后者状态也已经变了）。
 */
test("生命周期出口接上了触发同步，并把 Config 交给它（接线检查）", () => {
  const 源码 = readFileSync(
    join(import.meta.dir, "../../src/server/openhive/governance-assets.ts"),
    "utf8",
  )
  expect(源码).toContain("OpenhiveMcpConfigSync.触发同步(")
  expect(源码).toContain("config: Option.getOrUndefined(deps.config)")
  // 两处出口：成功分支与「流转已生效、通知失败」分支（后者状态也已经变了）。
  expect(源码.match(/OpenhiveMcpConfigSync\.触发同步\(/g)?.length).toBe(2)
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
