import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { getMcpConnection } from "@opencode-ai/asset-service/mcp-connection"
import { assetById } from "@opencode-ai/asset-service/asset"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * MCP 入库出口（2026-11-02 设计 §5.3）：`POST /openhive/assets/draft` 带 `type:"mcp"`。
 *
 * 判据：
 * 1. 只有资产治理管理员能建（普通民警 403，未登录 401）；
 * 2. 合法 remote / local 草稿成功，库里 `type=mcp` 且连接行落库；
 * 3. 非法连接 / 未知分类 / 未知类型 ⇒ 400，且**一条资产行都不落**（授权与校验先于副作用）；
 * 4. skill 分支行为不变（由既有的 `openhive-asset-draft.test.ts` 在门禁里守着）。
 */

const it = testEffect(Layer.empty)
const SECRET = "m1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6"

const ADMIN: TokenSubject = {
  id: "mcp-admin-1111",
  policeNo: "970001",
  name: "资产管理员",
  isAdmin: true,
}
const OFFICER: TokenSubject = { id: "mcp-officer-2222", policeNo: "970002", name: "民警乙", isAdmin: false }

const 数据根 = mkdtempSync(join(tmpdir(), "openhive-mcp-draft-data-"))
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
  for (const subject of [ADMIN, OFFICER]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
})

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

const 入库 = (subject: TokenSubject | null, body: unknown) =>
  发(subject, "/openhive/assets/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

const 回包 = Schema.Struct({
  assetId: Schema.String,
  name: Schema.String,
  status: Schema.String,
  visibility: Schema.String,
})

const mcpBody = (over: Record<string, unknown> = {}) => ({
  type: "mcp",
  name: "资金查询 MCP",
  description: "按账户查流水",
  category: "intelligence",
  visibility: "targeted",
  connection: { transport: "remote", url: "https://mcp.example/path" },
  ...over,
})

async function 同名资产数(name: string): Promise<number> {
  const rows = rowsOf(await pg!.db.execute(sql`select id from auth.asset where name = ${name}`))
  return rows.length
}

describe("MCP 入库 · 授权门", () => {
  it.effect("未登录 ⇒ 401", () =>
    Effect.gen(function* () {
      const response = yield* 入库(null, mcpBody())
      expect(response.status).toBe(401)
    }),
  )

  it.effect("普通民警 ⇒ 403，且不落库", () =>
    Effect.gen(function* () {
      const response = yield* 入库(OFFICER, mcpBody({ name: "拒绝-非管理员" }))
      expect(response.status).toBe(403)
      expect(yield* Effect.promise(() => 同名资产数("拒绝-非管理员"))).toBe(0)
    }),
  )
})

describe("MCP 入库 · 成功面", () => {
  it.effect("remote：草稿落库，连接行存在", () =>
    Effect.gen(function* () {
      const response = yield* 入库(ADMIN, mcpBody({ name: "远程 MCP" }))
      expect(response.status).toBe(200)
      const body = Schema.decodeUnknownSync(回包)(yield* Effect.promise(() => response.json()))
      expect(body.status).toBe("draft")
      expect(body.visibility).toBe("targeted")
      const asset = yield* Effect.promise(() => assetById(pg!.db, body.assetId))
      expect(asset?.type).toBe("mcp")
      const connection = yield* Effect.promise(() => getMcpConnection(pg!.db, body.assetId))
      expect(connection?.transport).toBe("remote")
      expect(connection?.url).toBe("https://mcp.example/path")
    }),
  )

  it.effect("local：命令数组落库", () =>
    Effect.gen(function* () {
      const response = yield* 入库(
        ADMIN,
        mcpBody({
          name: "本地 MCP",
          visibility: "department",
          connection: { transport: "local", command: ["bun", "run", "server.ts"], cwd: "/srv/mcp" },
        }),
      )
      expect(response.status).toBe(200)
      const body = Schema.decodeUnknownSync(回包)(yield* Effect.promise(() => response.json()))
      const connection = yield* Effect.promise(() => getMcpConnection(pg!.db, body.assetId))
      expect(connection?.command).toEqual(["bun", "run", "server.ts"])
      expect(connection?.cwd).toBe("/srv/mcp")
    }),
  )
})

describe("MCP 入库 · 拒绝面不落库", () => {
  it.effect("remote 带 command ⇒ 400", () =>
    Effect.gen(function* () {
      const response = yield* 入库(
        ADMIN,
        mcpBody({ name: "拒绝-坏连接", connection: { transport: "remote", url: "https://x", command: ["bun"] } }),
      )
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => 同名资产数("拒绝-坏连接"))).toBe(0)
    }),
  )

  it.effect("未知分类 ⇒ 400", () =>
    Effect.gen(function* () {
      const response = yield* 入库(ADMIN, mcpBody({ name: "拒绝-坏分类", category: "no-such" }))
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => 同名资产数("拒绝-坏分类"))).toBe(0)
    }),
  )

  it.effect("未知 type ⇒ 400", () =>
    Effect.gen(function* () {
      const response = yield* 入库(ADMIN, mcpBody({ name: "拒绝-坏类型", type: "plugin" }))
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => 同名资产数("拒绝-坏类型"))).toBe(0)
    }),
  )
})
