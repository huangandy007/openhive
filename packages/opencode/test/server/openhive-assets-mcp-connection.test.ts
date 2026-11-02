import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { insertAsset } from "@opencode-ai/asset-service/asset"
import { getMcpConnection, MASKED_VALUE } from "@opencode-ai/asset-service/mcp-connection"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { createMcpDraft, transitionAsset } from "@opencode-ai/asset-service/service"
import { assetsRoot } from "@opencode-ai/asset-service/storage"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * MCP 连接出口（2026-11-02 设计 §3.1.2 / §5.2）：
 * `GET` / `PATCH /openhive/assets/:id/connection`。
 *
 * 判据：
 * 1. 凭据值永不出现（响应文本里搜不到原文）；
 * 2. 读：作者 / 显式 read 授权 / 治理管理员可读；无关用户 403；非 MCP 400；无连接行 404；
 * 3. 写：作者 / 资产 admin 授权 / 治理管理员可写；窗口外 409；非法规格 400 且库不变。
 *
 * 次序：身份 → 存在（404）→ 授权（403）→ 类型（400）→ 状态（409）→ 校验（400）→ 写。
 */

const it = testEffect(Layer.empty)
const SECRET = "c1o2n3n4e5c6t7i8o9n0a1b2c3d4e5f6"

const 作者甲: TokenSubject = { id: "conn-u1", policeNo: "980001", name: "作者甲", isAdmin: false }
const 无关乙: TokenSubject = { id: "conn-u2", policeNo: "980002", name: "无关乙", isAdmin: false }
const 管理丙: TokenSubject = { id: "conn-u3", policeNo: "980003", name: "管理丙", isAdmin: true }
const 读者丁: TokenSubject = { id: "conn-u4", policeNo: "980004", name: "读者丁", isAdmin: false }
/** 非属主、非管理员，只有资产上的 `admin` 授权行。 */
const 资产管戊: TokenSubject = { id: "conn-u5", policeNo: "980005", name: "资产管戊", isAdmin: false }
/** 非属主、非管理员，只有资产上的 `write` 授权行（能改描述，不能改连接）。 */
const 写者己: TokenSubject = { id: "conn-u6", policeNo: "980006", name: "写者己", isAdmin: false }

const 数据根 = mkdtempSync(join(tmpdir(), "openhive-mcp-conn-data-"))
const restoreDataRoot = restorePoint({ OPENHIVE_DATA_ROOT: 数据根 })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = 数据根

afterAll(restoreDataRoot)
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
})
afterAll(() => rmSync(数据根, { recursive: true, force: true }))

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  for (const subject of [作者甲, 无关乙, 管理丙, 读者丁, 资产管戊, 写者己]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${管理丙.id}, 'gov-system-admin')`)
  await pg.db.execute(sql`
    insert into auth.role (id, name, role_type) values ('test-mcp-reader', 'MCP 只读者', 'normal')
  `)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-mcp-reader', 'mcp', 'asset_conn_draft', 'read')
  `)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${读者丁.id}, 'test-mcp-reader')`)
  // 写权的第二条来源：资产上的 `admin` 授权行（非属主）。
  await pg.db.execute(sql`
    insert into auth.role (id, name, role_type) values ('test-mcp-admin', 'MCP 管理员', 'normal')
  `)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-mcp-admin', 'mcp', 'asset_conn_draft', 'admin')
  `)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${资产管戊.id}, 'test-mcp-admin')`)
  // 写权的**反向**来源：只有 `write`（改描述）不能改连接（设计 §5.3，凭据 / 命令不是同一档）。
  await pg.db.execute(sql`
    insert into auth.role (id, name, role_type) values ('test-mcp-writer', 'MCP 内容编辑', 'normal')
  `)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-mcp-writer', 'mcp', 'asset_conn_draft', 'write')
  `)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${写者己.id}, 'test-mcp-writer')`)

  const owner = { id: 作者甲.id, name: 作者甲.name, department: "经侦支队" }
  await createMcpDraft({
    db: pg.db,
    owner,
    name: "资金查询 MCP",
    description: "按账户查流水",
    category: "intelligence",
    id: "asset_conn_draft",
    now: 5000,
    connection: {
      transport: "remote",
      url: "https://mcp.example/path",
      headers: { Authorization: "Bearer s3cret" },
    },
  })
  await createMcpDraft({
    db: pg.db,
    owner,
    name: "待审 MCP",
    description: "审核中的连接",
    category: "intelligence",
    id: "asset_conn_review",
    now: 5001,
    connection: { transport: "remote", url: "https://review.example" },
  })
  await pg.db.execute(sql`
    update auth.asset set status = 'in_review' where id = 'asset_conn_review'
  `)
  // iterating 窗口：先发布，再由属主走真实的 `start_iteration` 流转（MCP 无工作副本，
  // 服务层对文件步骤短路）。直接改 status 会绕过状态机，测不出「窗口里真的能写」。
  await createMcpDraft({
    db: pg.db,
    owner,
    name: "迭代 MCP",
    description: "迭代中的连接",
    category: "intelligence",
    id: "asset_conn_iter",
    now: 5002,
    connection: { transport: "remote", url: "https://iter-before.example" },
  })
  await pg.db.execute(sql`update auth.asset set status = 'published' where id = 'asset_conn_iter'`)
  await transitionAsset({
    db: pg.db,
    root: assetsRoot(process.env),
    assetId: "asset_conn_iter",
    action: "start_iteration",
    viewer: { userId: 作者甲.id, department: "经侦支队" },
    reason: "开始迭代",
    now: 5003,
  })
  await insertAsset(pg.db, 资产({ id: "asset_conn_skill", type: "skill", status: "draft" }))
  await insertAsset(pg.db, 资产({ id: "asset_conn_newmcp", type: "mcp", status: "draft" }))
})

function 资产(over: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset_conn_skill",
    name: "普通 skill",
    type: "skill",
    description: "内容",
    summary: "",
    precautions: "",
    icon: "skill",
    category: "intelligence",
    tags: [],
    ownerId: 作者甲.id,
    ownerName: 作者甲.name,
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

const OPEN: Record<string, string | undefined> = { OPENHIVE_REQUIRE_USER_ID: "1", AUTH_JWT_SECRET: SECRET }

function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler
  return (url: string, init?: RequestInit) =>
    Effect.promise(() => Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)))
}

const openApp = realApp(OPEN)
const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const 发 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const 读连接 = (subject: TokenSubject | null, id: string) =>
  发(subject, `/openhive/assets/${id}/connection`)

const 改连接 = (subject: TokenSubject | null, id: string, connection: unknown) =>
  发(subject, `/openhive/assets/${id}/connection`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connection }),
  })

function 是记录(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const 视图 = Schema.Struct({
  assetId: Schema.String,
  transport: Schema.String,
  url: Schema.NullOr(Schema.String),
  command: Schema.NullOr(Schema.Array(Schema.String)),
  cwd: Schema.NullOr(Schema.String),
  headers: Schema.Record(Schema.String, Schema.String),
  environment: Schema.Record(Schema.String, Schema.String),
  enabled: Schema.Boolean,
  timeoutMs: Schema.NullOr(Schema.Number),
  checkedAt: Schema.NullOr(Schema.Number),
  checkOk: Schema.NullOr(Schema.Boolean),
  checkError: Schema.String,
  toolCount: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

describe("读连接", () => {
  it.effect("作者可读，且凭据值只以遮罩出现", () =>
    Effect.gen(function* () {
      const response = yield* 读连接(作者甲, "asset_conn_draft")
      expect(response.status).toBe(200)
      const text = yield* Effect.promise(() => response.text())
      expect(text).not.toContain("Bearer s3cret")
      const body = Schema.decodeUnknownSync(视图)(JSON.parse(text))
      expect(body.transport).toBe("remote")
      expect(body.url).toBe("https://mcp.example/path")
      expect(body.headers).toEqual({ Authorization: MASKED_VALUE })
    }),
  )

  it.effect("显式 read 授权者可读", () =>
    Effect.gen(function* () {
      const response = yield* 读连接(读者丁, "asset_conn_draft")
      expect(response.status).toBe(200)
    }),
  )

  it.effect("治理管理员（非作者）可读", () =>
    Effect.gen(function* () {
      const response = yield* 读连接(管理丙, "asset_conn_draft")
      expect(response.status).toBe(200)
    }),
  )

  it.effect("无关用户 ⇒ 403", () =>
    Effect.gen(function* () {
      const response = yield* 读连接(无关乙, "asset_conn_draft")
      expect(response.status).toBe(403)
    }),
  )

  it.effect("不存在的资产 ⇒ 404", () =>
    Effect.gen(function* () {
      const response = yield* 读连接(作者甲, "asset_conn_nope")
      expect(response.status).toBe(404)
    }),
  )

  it.effect("skill 资产 ⇒ 400", () =>
    Effect.gen(function* () {
      const response = yield* 读连接(作者甲, "asset_conn_skill")
      expect(response.status).toBe(400)
    }),
  )

  it.effect("mcp 资产没有连接行 ⇒ 404", () =>
    Effect.gen(function* () {
      const response = yield* 读连接(作者甲, "asset_conn_newmcp")
      expect(response.status).toBe(404)
    }),
  )
})

describe("改连接", () => {
  it.effect("作者在 draft 期可改，库随之更新", () =>
    Effect.gen(function* () {
      const response = yield* 改连接(作者甲, "asset_conn_draft", {
        transport: "local",
        command: ["bun", "run", "server.ts"],
        cwd: "/srv/mcp",
      })
      expect(response.status).toBe(200)
      const body = Schema.decodeUnknownSync(视图)(yield* Effect.promise(() => response.json()))
      expect(body.transport).toBe("local")
      expect(body.url).toBeNull()
      const row = yield* Effect.promise(() => getMcpConnection(pg!.db, "asset_conn_draft"))
      expect(row?.command).toEqual(["bun", "run", "server.ts"])
    }),
  )

  it.effect("PATCH 回显同样遮罩：凭据值不出现、无 publishedConfig 键", () =>
    Effect.gen(function* () {
      const response = yield* 改连接(作者甲, "asset_conn_draft", {
        transport: "remote",
        url: "https://mcp.example/x",
        headers: { Authorization: "Bearer live-token" },
      })
      expect(response.status).toBe(200)
      const text = yield* Effect.promise(() => response.text())
      // 出口无论是读还是写，凭据都只以遮罩出现（`遮罩连接` 是唯一投影）。
      expect(text).not.toContain("live-token")
      const body: unknown = JSON.parse(text)
      if (!是记录(body)) throw new Error("回包不是 JSON 对象")
      expect(body["headers"]).toEqual({ Authorization: MASKED_VALUE })
      expect(body["environment"]).toEqual({})
      expect(Object.prototype.hasOwnProperty.call(body, "publishedConfig")).toBe(false)
    }),
  )

  it.effect("资产 admin 授权者可写（非属主）", () =>
    Effect.gen(function* () {
      const response = yield* 改连接(资产管戊, "asset_conn_draft", {
        transport: "remote",
        url: "https://admin-grant.example",
      })
      expect(response.status).toBe(200)
    }),
  )

  it.effect("只有 write 授权者不能改连接 ⇒ 403，库不变", () =>
    Effect.gen(function* () {
      // 设计 §5.3：`write` 是「改描述」，连接里的凭据与命令是运行期高危输入，不同档。
      // 没有这条反向用例时，把写权判据从 `.has("admin")` 放宽成 `.has("write")` 不会红：
      // admin 授权通常也带 write，正向用例照样绿（提权变异存活）。
      const 前 = yield* Effect.promise(() => getMcpConnection(pg!.db, "asset_conn_draft"))
      const response = yield* 改连接(写者己, "asset_conn_draft", {
        transport: "remote",
        url: "https://write-grant.example",
      })
      expect(response.status).toBe(403)
      const 后 = yield* Effect.promise(() => getMcpConnection(pg!.db, "asset_conn_draft"))
      expect(后?.url).toBe(前?.url)
    }),
  )

  it.effect("治理管理员（非属主、无授权）可写", () =>
    Effect.gen(function* () {
      const response = yield* 改连接(管理丙, "asset_conn_draft", {
        transport: "remote",
        url: "https://governance-admin.example",
      })
      expect(response.status).toBe(200)
    }),
  )

  it.effect("无关用户 ⇒ 403，库不变", () =>
    Effect.gen(function* () {
      const 前 = yield* Effect.promise(() => getMcpConnection(pg!.db, "asset_conn_draft"))
      const response = yield* 改连接(无关乙, "asset_conn_draft", {
        transport: "remote",
        url: "https://evil.example",
      })
      expect(response.status).toBe(403)
      const 后 = yield* Effect.promise(() => getMcpConnection(pg!.db, "asset_conn_draft"))
      expect(后?.url).toBe(前?.url)
    }),
  )

  it.effect("iterating 窗口内可写", () =>
    Effect.gen(function* () {
      const response = yield* 改连接(作者甲, "asset_conn_iter", {
        transport: "remote",
        url: "https://iter-after.example",
      })
      expect(response.status).toBe(200)
      const row = yield* Effect.promise(() => getMcpConnection(pg!.db, "asset_conn_iter"))
      expect(row?.url).toBe("https://iter-after.example")
    }),
  )

  it.effect("in_review 期 ⇒ 409，库不变", () =>
    Effect.gen(function* () {
      const 前 = yield* Effect.promise(() => getMcpConnection(pg!.db, "asset_conn_review"))
      const response = yield* 改连接(作者甲, "asset_conn_review", {
        transport: "remote",
        url: "https://changed.example",
      })
      // 先读库、再断状态码：删掉状态门时，红的是「库被改」这一句，而不是一条更靠后的 409。
      const 后 = yield* Effect.promise(() => getMcpConnection(pg!.db, "asset_conn_review"))
      expect(后?.url).toBe(前?.url)
      expect(response.status).toBe(409)
    }),
  )

  it.effect("非法规格 ⇒ 400，库不变", () =>
    Effect.gen(function* () {
      const 前 = yield* Effect.promise(() => getMcpConnection(pg!.db, "asset_conn_draft"))
      const response = yield* 改连接(作者甲, "asset_conn_draft", {
        transport: "remote",
        url: "https://x",
        command: ["bun"],
      })
      expect(response.status).toBe(400)
      const 后 = yield* Effect.promise(() => getMcpConnection(pg!.db, "asset_conn_draft"))
      expect(后?.transport).toBe(前?.transport)
    }),
  )

  it.effect("没有连接行 ⇒ 404", () =>
    Effect.gen(function* () {
      const response = yield* 改连接(作者甲, "asset_conn_newmcp", {
        transport: "remote",
        url: "https://x",
      })
      expect(response.status).toBe(404)
    }),
  )
})
