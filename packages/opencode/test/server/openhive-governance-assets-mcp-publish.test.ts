import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import { insertMcpConnection } from "@opencode-ai/asset-service/mcp-connection"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 批次 3 · Task 5（2026-11-02）· **MCP 发布的 HTTP 出口**：可见范围与试连闸门。
 *
 * 这一份只钉「治理台这一层」的三件事，领域规则本身在 asset-service 的测试里：
 *
 * 1. `personal` 只对 MCP 放行（裁定 D-9 / 设计 §3.2.2）：skill 仍 400，MCP 200；
 * 2. 试连失败 ⇒ **409**（Task 4 的映射），且状态停在 `pending_tech`、不了半截；
 * 3. 没有连接规格 ⇒ 409（`mcp_connection_missing`），不是 500。
 *
 * ⚠️ 成功那一条走**真试连**（进程内 MCP server），不注入 probe：出口没有注入点，
 * 注入只能证明服务层，证明不了接线。
 */

const it = testEffect(Layer.empty)

const SECRET = "m1n2o3p4q5r6s7t8u9v0w1x2y3z4a5b6"

const ADMIN: TokenSubject = {
  id: "77777777-7777-4777-8777-777777777777",
  policeNo: "980001",
  name: "系统管理员庚",
  isAdmin: true,
}
/** 被授权的个人 / 组外对照。 */
const U2: TokenSubject = {
  id: "88888888-8888-4888-8888-888888888888",
  policeNo: "980101",
  name: "李四",
  isAdmin: false,
}
const U3: TokenSubject = {
  id: "99999999-9999-4999-8999-999999999999",
  policeNo: "980102",
  name: "王五",
  isAdmin: false,
}

const GOV = "/openhive/governance/assets"
const transitionUrl = (id: string) => `${GOV}/${id}/transition`

const ASSETS_ROOT = mkdtempSync(join(tmpdir(), "openhive-gov-mcp-publish-"))
const restoreAssetsRoot = restorePoint({ OPENHIVE_ASSETS_ROOT: ASSETS_ROOT })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(restoreAssetsRoot)
afterAll(() => rmSync(ASSETS_ROOT, { recursive: true, force: true }))

const 资产 = (over: Partial<AssetMetadata> & Pick<AssetMetadata, "id" | "name" | "status">): AssetMetadata => ({
  type: "skill",
  description: "测试用资产",
  summary: "",
  precautions: "",
  icon: "skill",
  category: "intelligence",
  tags: ["测试"],
  ownerId: ADMIN.id,
  ownerName: ADMIN.name,
  department: "基座部门",
  visibility: "global",
  version: 1,
  favoriteCount: 0,
  usageCount: 0,
  rating: 0,
  ratingCount: 0,
  feedbackCount: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
  publishedAt: null,
  archivedAt: null,
  iterationNote: "",
  iterationWorkspace: null,
  ...over,
})

/**
 * 进程内真 MCP server：StreamableHTTP 列一次工具即算试连成功
 * （与 `test/mcp/openhive-mcp-identity.test.ts` 同款夹具）。
 */
function 起MCP服务() {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const protocol = new Server(
        { name: "mcp-openhive-gov-publish", version: "1.0.0" },
        { capabilities: { tools: {} } },
      )
      protocol.setRequestHandler(ListToolsRequestSchema, () =>
        Promise.resolve({
          tools: [{ name: "query_ledger", description: "查流水", inputSchema: { type: "object" } }],
        }),
      )
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      await protocol.connect(transport)
      const http = Bun.serve({ port: 0, fetch: (request) => transport.handleRequest(request) })
      return {
        url: http.url.toString(),
        close: async () => {
          await protocol.close().catch(() => {})
          void http.stop(true)
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${ADMIN.id}, ${ADMIN.policeNo}, ${ADMIN.name}, 'x', 'x', '基座单位', '基座部门', '基座科室',
            1, 1, 'h', 0)
  `)
  for (const subject of [U2, U3]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '基座部门', '基座科室',
              1, 0, 'h', 0)
    `)
  }
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
}

function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
}

const openApp = realApp(OPEN)
const cookie = (value: string) => ({ Cookie: `${UserIdentity.COOKIE_NAME}=${value}` })
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const as = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", cookie(yield* token(subject)).Cookie)
    return yield* openApp(url, { ...init, headers })
  })

const post = (subject: TokenSubject | null, url: string, body?: unknown) =>
  as(subject, url, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })

const Asset = Schema.Struct({ id: Schema.String, type: Schema.String, status: Schema.String, visibility: Schema.String })
const TransitionResponse = Schema.Struct({ asset: Asset })
const ErrorResponse = Schema.Struct({ error: Schema.String, field: Schema.optional(Schema.String) })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

async function 库状态(id: string): Promise<string> {
  if (!pg) throw new Error("真库没起来")
  const [row] = rowsOf(await pg.db.execute(sql`select status from auth.asset where id = ${id}`))
  if (!row) throw new Error(`资产不存在：${id}`)
  return String(row.status)
}

describe("Task 5 · MCP 发布的 HTTP 出口", () => {
  it.live("MCP 资产 personal 发布 ⇒ 200（真试连）；skill personal ⇒ 400", () =>
    Effect.gen(function* () {
      const db = pg!.db

      // skill：personal 仍不成立（没有共享发布目录）。
      const skillId = "asset-mcp-publish-skill-0001"
      yield* Effect.promise(() =>
        insertAsset(db, 资产({ id: skillId, name: "个人话术", status: "pending_tech", visibility: "personal" })),
      )
      const skill = yield* post(ADMIN, transitionUrl(skillId), { action: "publish_tech", visibility: "personal" })
      expect(skill.status).toBe(400)
      expect((yield* json(ErrorResponse, skill)).error).toContain("本部门、全局或指定人员")
      expect(yield* Effect.promise(() => 库状态(skillId))).toBe("pending_tech")

      // MCP：不落共享目录，personal 在语义上成立（裁定 D-9）。
      const 服务 = yield* 起MCP服务()
      const mcpId = "asset-mcp-publish-personal-0002"
      yield* Effect.promise(async () => {
        await insertAsset(db, 资产({ id: mcpId, name: "个人档 MCP", type: "mcp", status: "pending_tech", visibility: "personal" }))
        await insertMcpConnection(db, mcpId, { transport: "remote", url: 服务.url }, 1_100)
      })

      const mcp = yield* post(ADMIN, transitionUrl(mcpId), { action: "publish_tech", visibility: "personal" })
      expect(mcp.status).toBe(200)
      const 体 = yield* json(TransitionResponse, mcp)
      expect(体.asset.type).toBe("mcp")
      expect(体.asset.visibility).toBe("personal")
      expect(体.asset.status).toBe("published")
      expect(yield* Effect.promise(() => 库状态(mcpId))).toBe("published")
    }),
  )

  it.live("试连失败 ⇒ 409 且资产仍是 pending_tech（状态、审计一起看）", () =>
    Effect.gen(function* () {
      const db = pg!.db
      const id = "asset-mcp-publish-probe-fail-0003"
      yield* Effect.promise(async () => {
        await insertAsset(db, 资产({ id, name: "连不上的 MCP", type: "mcp", status: "pending_tech" }))
        // port 1：本机没有服务在听，连接立即被拒（不靠超时）。
        await insertMcpConnection(db, id, { transport: "remote", url: "http://127.0.0.1:1/mcp" }, 1_100)
      })

      const 发布 = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech" })

      expect(发布.status).toBe(409)
      expect((yield* json(ErrorResponse, 发布)).error).toContain("连不上")
      expect(yield* Effect.promise(() => 库状态(id))).toBe("pending_tech")

      // 409 走过 `失败()`：审计必须有一行 failed/409（500 会走 Effect.die，什么都不留）。
      const [审计] = rowsOf(
        yield* Effect.promise(() =>
          db.execute(
            sql`select result, detail::jsonb->>'status' as status from auth.audit_event where target_id = ${id} order by id desc limit 1`,
          ),
        ),
      )
      expect(String(审计?.result)).toBe("failed")
      expect(String(审计?.status)).toBe("409")
    }),
  )

  it.live("没有连接规格 ⇒ 409（mcp_connection_missing），资产仍在 pending_tech", () =>
    Effect.gen(function* () {
      const db = pg!.db
      const id = "asset-mcp-publish-no-conn-0004"
      yield* Effect.promise(() =>
        insertAsset(db, 资产({ id, name: "没配连接的 MCP", type: "mcp", status: "pending_tech" })),
      )

      const 发布 = yield* post(ADMIN, transitionUrl(id), { action: "publish_tech" })

      expect(发布.status).toBe(409)
      expect((yield* json(ErrorResponse, 发布)).error).toContain("连接规格")
      expect(yield* Effect.promise(() => 库状态(id))).toBe("pending_tech")
    }),
  )

  /**
   * 评审 F3：按人授权的授权行 `resource_type` 必须随资产真实类型走（MCP 是 `mcp`）。
   * 只测 skill 的话，「写授权时把 resourceType 写死成 skill」这个变异不会被任何用例听见——
   * 授权行看起来完全合法，但 `effectivePermissions()` 按 `resource_type === asset.type`
   * 匹配，永远匹配不上 ⇒ 「发布成功、被选的人却看不见」。
   */
  it.live("MCP targeted + userIds ⇒ 200，个人授权行落在 resource_type = 'mcp'", () =>
    Effect.gen(function* () {
      const db = pg!.db
      const 服务 = yield* 起MCP服务()
      const id = "asset-mcp-targeted-user-0005"
      yield* Effect.promise(async () => {
        await insertAsset(
          db,
          资产({ id, name: "只发给李四的 MCP", type: "mcp", status: "pending_tech", visibility: "personal" }),
        )
        await insertMcpConnection(db, id, { transport: "remote", url: 服务.url }, 1_100)
      })

      const 发布 = yield* post(ADMIN, transitionUrl(id), {
        action: "publish_tech",
        visibility: "targeted",
        userIds: [U2.id],
      })

      expect(发布.status).toBe(200)
      const 体 = yield* json(TransitionResponse, 发布)
      expect(体.asset.type).toBe("mcp")
      expect(体.asset.visibility).toBe("targeted")
      expect(体.asset.status).toBe("published")

      // 授权行的资源类型必须与资产类型同源（不是写死的 skill）。
      const 行 = rowsOf(
        yield* Effect.promise(() =>
          db.execute(
            sql`select role_id, resource_type, perm from auth.role_resource where resource_id = ${id} order by role_id`,
          ),
        ),
      )
      expect(行).toHaveLength(1)
      expect(String(行[0]?.["role_id"])).toBe(`personal:${U2.id}`)
      expect(String(行[0]?.["resource_type"])).toBe("mcp")
      expect(String(行[0]?.["perm"])).toBe("read")

      // 组外用户没有这条授权行。
      const 组外 = rowsOf(
        yield* Effect.promise(() =>
          db.execute(
            sql`select 1 from auth.role_resource where resource_id = ${id} and role_id = ${`personal:${U3.id}`}`,
          ),
        ),
      )
      expect(组外).toHaveLength(0)
    }),
  )
})
