import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { sql } from "drizzle-orm"
import { connect } from "@opencode-ai/auth/db"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { realPgEnabled, withRealPg } from "@opencode-ai/auth/real-pg-test-support"
import { assetById, insertAsset } from "./asset"
import type { AssetMetadata } from "./metadata"
import { addFavorite } from "./preferences"
import { assetLocation, transitionAsset } from "./service"

/**
 * 真 PostgreSQL 上的资产服务缺口（009 收尾补测 B2 / B3 / B4）。
 *
 * 默认 **skip**（`OPENHIVE_TEST_PG=1` 才跑）。跑法：
 *
 * ```bash
 * bun run --filter @opencode-ai/asset-service test:real-pg
 * ```
 *
 * ## 为什么 PGlite 那套不够
 *
 * PGlite 是单连接嵌入式引擎：`Promise.all` 打两条查询会撞 `42P05 prepared statement
 * already exists`（T016 实测）⇒ 现有全部用例都是**串行**的。于是两件生产性质从未被验过：
 *
 * 1. **真实例的约束语义**（唯一 / CHECK / 外键 / jsonb 往返）——PGlite 上跑绿不等于真 PG 收下；
 * 2. **真并发**——两条**真连接**同时打同一条不变量（收藏计数、状态机恰好一个赢家）。
 *
 * 另补 B4：`mcp-main.ts`（stdio 真进程入口）需要真进程 + 真 PG 才能起，PGlite 夹具不允许
 * 同一实例开第二个客户端（`mcp-main.ts` 的注释已把这一条记为缺口）。
 *
 * ⚠️ 每个用例都会 `DROP SCHEMA auth CASCADE`（`withRealPg` 的既有语义），本文件按串行看。
 * ⚠️ 仍不覆盖：RLS 策略（不在本仓，`mcp-downlink.md` §6）。
 */

const enabled = realPgEnabled()

function metadata(over: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset_real",
    name: "资金流水分析",
    type: "skill",
    description: "按账户汇总流水",
    icon: "skill",
    category: "intelligence",
    tags: ["资金", "话单"],
    ownerId: "u1",
    ownerName: "甲民警",
    department: "经侦支队",
    visibility: "department",
    version: 1,
    status: "pending_tech",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    publishedAt: null,
    archivedAt: null,
    ...over,
  }
}

async function seedUser(db: ReturnType<typeof connect>): Promise<void> {
  await db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values ('u1', '010001', '甲民警', 'x', 'x', '市局', '经侦支队', 'x', 1, 'h', 0)
  `)
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

/**
 * 从错误链里取 SQLSTATE。
 *
 * drizzle 把驱动错误包成 `DrizzleQueryError`，真正的 `code` 在 `cause` 上；再往下还有
 * 驱动的 `errno`。直接读顶层 `code` 会拿到 `undefined`——实测（2026-10-25）。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** 从任意拒绝原因里取错误码（`PromiseRejectedResult.reason` 是 `any`，不直接断言）。 */
function codeOf(reason: unknown): string | undefined {
  if (!isRecord(reason)) return undefined
  const code = reason["code"]
  return typeof code === "string" ? code : undefined
}

function sqlstateOf(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 6; depth++) {
    if (current === undefined || current === null) return undefined
    if (isRecord(current)) {
      for (const key of ["code", "errno"] as const) {
        const value = current[key]
        if (typeof value === "string" && /^[0-9A-Z]{5}$/.test(value)) return value
      }
    }
    const message =
      isRecord(current) && typeof current["message"] === "string"
        ? current["message"]
        : typeof current === "string"
          ? current
          : ""
    const fromMessage = /\b((?:08|22|23|42|53)[0-9A-Z]{3})\b/.exec(message)?.[1]
    if (fromMessage !== undefined) return fromMessage
    current = isRecord(current) ? current["cause"] : undefined
  }
  return undefined
}

/** 断言某条写库请求以指定 SQLSTATE 失败（约束 / CHECK / 外键由**库**兜住，不是应用层）。 */
async function 期望SQLSTATE(run: () => Promise<unknown>, expected: string): Promise<void> {
  let failed = false
  try {
    await run()
  } catch (error) {
    failed = true
    expect(sqlstateOf(error), `期望 SQLSTATE ${expected}，实得 ${String(error).slice(0, 200)}`).toBe(expected)
  }
  if (!failed) throw new Error(`应当以 SQLSTATE ${expected} 失败，却成功了`)
}

describe.skipIf(!enabled)("真 PG · 资产服务缺口补测", () => {
  test("B2 约束与序列化：唯一收藏 / 权限 CHECK / 外键 / jsonb 与时间往返", async () => {
    await withRealPg(async ({ db }) => {
      await seedUser(db)
      const asset = metadata()
      await insertAsset(db, asset)

      // ① jsonb 与时间列往返：写进去什么、读出来还是什么（`tags` 是 jsonb，顺序也要留住）。
      const 读回 = await assetById(db, asset.id)
      expect(读回?.tags).toEqual(["资金", "话单"])
      expect(读回?.createdAt).toBe(1_000)
      expect(读回?.status).toBe("pending_tech")

      // ② 收藏唯一约束（真 PG 的 23505，不是应用层判重）
      await db.execute(sql`insert into auth.asset_favorite (user_id, asset_id, created_at) values ('u1', ${asset.id}, 0)`)
      await 期望SQLSTATE(
        () =>
          db.execute(
            sql`insert into auth.asset_favorite (user_id, asset_id, created_at) values ('u1', ${asset.id}, 0)`,
          ),
        "23505",
      )

      // ③ 权限 CHECK：未知 perm 在库层就被拒（不是靠 TS 类型）
      await db.execute(sql`insert into auth.role (id, name, role_type) values ('r1', 'r1', 'group')`)
      await 期望SQLSTATE(
        () =>
          db.execute(sql`
            insert into auth.role_resource (role_id, resource_type, resource_id, perm)
            values ('r1', 'skill', ${asset.id}, 'owner')
          `),
        "23514",
      )

      // ④ 外键：给不存在的用户加组，库层拒（应用层不查也能被兜住）
      await db.execute(sql`insert into auth.role (id, name, role_type) values ('g1', 'g1', 'group')`)
      await 期望SQLSTATE(
        () => db.execute(sql`insert into auth.user_role (user_id, role_id) values ('u404', 'g1')`),
        "23503",
      )
    })
  })

  test("B3 真并发：两条连接同时收藏同一资产，计数只加一次", async () => {
    await withRealPg(async ({ db }) => {
      await seedUser(db)
      const asset = metadata({ status: "published" })
      await insertAsset(db, asset)

      const 另一条 = connect(process.env)
      try {
        const results = await Promise.all([
          addFavorite(db, { userId: "u1", assetId: asset.id, now: 500 }),
          addFavorite(另一条, { userId: "u1", assetId: asset.id, now: 500 }),
        ])
        // `on conflict do nothing` + `exists(inserted)` 在同一条语句里 ⇒ 只有一个能声称插入成功。
        expect(results.filter((inserted) => inserted)).toHaveLength(1)
        expect(results.filter((inserted) => !inserted)).toHaveLength(1)

        const [收藏行] = rowsOf(
          await db.execute(sql`select count(*)::int as count from auth.asset_favorite where asset_id = ${asset.id}`),
        )
        expect(Number(收藏行?.count)).toBe(1)

        const [缓存] = rowsOf(await db.execute(sql`select favorite_count from auth.asset where id = ${asset.id}`))
        expect(Number(缓存?.favorite_count), "计数不能被并发加两次").toBe(1)
      } finally {
        await 另一条.$client.close()
      }
    })
  })

  test("B3 真并发：两条连接同时发布同一资产，恰好一个赢家，文件不留重影", async () => {
    await withRealPg(async ({ db }) => {
      await seedUser(db)
      const asset = metadata({ status: "pending_tech" })
      await insertAsset(db, asset)

      const root = await tempDir("realpg-assets-")
      const 待发布 = join(root, "pending", asset.id)
      await mkdir(待发布, { recursive: true })
      await writeFile(join(待发布, "SKILL.md"), "# 资金流水分析\n")
      const 发布目录 = assetLocation(root, { ...asset, status: "published" })
      if (发布目录 === undefined) throw new Error("发布目录解析失败")

      const 授权 = [{ resourceType: "skill", resourceId: asset.id, perm: "admin" }] as const
      const 另一条 = connect(process.env)
      try {
        // 先热一次连接：否则「第二条连接首查询的建连开销」会把两条请求错开，
        // 测到的就不是同一个窗口里的并发。
        await 另一条.execute(sql`select 1`)

        const 跑 = (handle: typeof db) =>
          transitionAsset({
            db: handle,
            root,
            assetId: asset.id,
            action: "publish_tech",
            viewer: { userId: "u1", department: "经侦支队" },
            grants: 授权,
            now: 2_000,
          })
        const 结果 = await Promise.allSettled([跑(db), 跑(另一条)])

        const 成功 = 结果.filter((item) => item.status === "fulfilled")
        const 失败 = 结果.filter((item) => item.status === "rejected")
        expect(成功).toHaveLength(1)
        expect(失败).toHaveLength(1)

        // 输家必须给出**状态机语义**的错误码，而不是把文件系统异常原样抛给模型。
        // 两种合法交错（取决于输家读状态时赢家是否已提交）：
        //   ① 两条都读到 pending_tech ⇒ 条件更新落空 ⇒ `concurrent_transition`
        //   ② 输家晚读到 published ⇒ 状态机先拒 ⇒ `invalid_source`
        // 两者的共同点是「不覆盖别人的结果」；`concurrent_transition` 的①路径
        // 另有 `service.test.ts` 的确定性用例守着。
        const 输家 = 失败[0]!
        expect(
          ["concurrent_transition", "invalid_source"],
          `输家错误：${String(输家.reason)}`,
        ).toContain(codeOf(输家.reason) ?? "<无错误码>")

        // 不变量：状态只落一次、文件只在一处、内容完整。
        const 最终 = await assetById(db, asset.id)
        expect(最终?.status).toBe("published")
        expect(await readFile(join(发布目录, "SKILL.md"), "utf8")).toBe("# 资金流水分析\n")
        const 待发布仍在 = await readFile(join(root, "pending", asset.id, "SKILL.md"), "utf8").catch(() => undefined)
        expect(待发布仍在, "待发布目录应已被移走").toBeUndefined()
      } finally {
        await 另一条.$client.close()
        await rm(root, { recursive: true, force: true })
      }
    })
  })

  test("B4 stdio 真进程：mcp-main.ts 起得来，身份写入走真库", async () => {
    await withRealPg(async ({ db }) => {
      await seedUser(db)
      const assetsRoot = await tempDir("realpg-stdio-assets-")
      const workspaceRoot = await tempDir("realpg-stdio-workspace-")
      const workspace = join(workspaceRoot, "u1")
      await mkdir(join(workspace, "fund-analysis"), { recursive: true })
      await writeFile(
        join(workspace, "fund-analysis", "SKILL.md"),
        "---\nname: fund-analysis\ndescription: 按账户汇总资金流水\n---\n\n# 资金流水分析\n",
      )

      const transport = new StdioClientTransport({
        command: "bun",
        args: ["run", join(import.meta.dir, "mcp-main.ts")],
        cwd: workspace,
        env: {
          ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
          OPENHIVE_ASSETS_ROOT: assetsRoot,
          OPENHIVE_WORKSPACE_ROOT: workspaceRoot,
        },
        stderr: "pipe",
      })
      const client = new Client({ name: "real-stdio-client", version: "0" }, { capabilities: {} })
      try {
        await client.connect(transport)
        const { tools } = await client.listTools()
        expect(tools.map((tool) => tool.name).sort()).toEqual([
          "create_skill_draft",
          "publish_skill",
          "submit_skill_for_review",
        ])

        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- SDK 的 callTool 入参是联合类型
        const result = (await client.callTool({
          name: "create_skill_draft",
          arguments: {
            name: "资金流水分析",
            description: "按账户汇总流水",
            category: "intelligence",
            sourceDirectory: "fund-analysis",
          },
          _meta: { "openhive/user": "u1", "openhive/directory": workspace },
        } as never)) as { isError?: boolean; content: Array<{ type: string; text?: string }> }

        expect(result.isError).toBeUndefined()
        const payload: unknown = JSON.parse(result.content[0]?.text ?? "{}")
        if (!isRecord(payload)) throw new Error("create_skill_draft 的出参不是对象")
        expect(payload["status"]).toBe("draft")

        // 真进程真的写进了真库（而不是只回了一个 ok）。
        const [row] = rowsOf(
          await db.execute(sql`select owner_id, status from auth.asset where id = ${String(payload["assetId"])}`),
        )
        expect(String(row?.owner_id)).toBe("u1")
        expect(String(row?.status)).toBe("draft")
      } finally {
        await client.close()
        await rm(assetsRoot, { recursive: true, force: true })
        await rm(workspaceRoot, { recursive: true, force: true })
      }
    })
  })
})
