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
 * 1. 只有资产治理管理员能建（普通民警 403，未登录 401），且**授权先于字段校验**、拒绝留
 *    `governance.denied` 审计行（前者由「非法字段仍得 403」钉住，后者由审计行数 ＋1 钉住）；
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
  // 「指定人员」的授权组：组本身是 `auth.role` 里 `role_type='group'` 的一行。
  await pg.db.execute(sql`insert into auth.role (id, name, role_type) values ('g_mcp', 'MCP 专案组', 'group')`)
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

/**
 * 读治理拒绝审计（**裸 SQL**，不经被测对象；读法照 `openhive-governance-audit.test.ts:137-156`）。
 * 按 actor ＋ board 收窄：前面「普通民警 ⇒ 403」那条也会落一行，靠「请求前后条数 ＋1」分清。
 */
function 治理拒绝行() {
  return Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    return rowsOf(
      await pg.db.execute(
        sql`select board, action, result, detail from auth.audit_event
            where actor_id = ${OFFICER.id} and action = 'governance.denied' and board = 'asset-governance'
            order by id asc`,
      ),
    )
  })
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

  it.effect("普通民警递非法字段 ⇒ 403（授权先于字段校验），且留 governance.denied", () =>
    Effect.gen(function* () {
      // 常规「民警 ⇒ 403」用例送的是完全合法的字段：把 `校验资产表单` 挪到授权门之前，
      // 那条仍然绿（字段合法、无 400）。用**非法字段**才能分清次序——
      // 授权先跑得 403，校验先跑得 400（`#005-18` 的「假绿四问」）。
      const 前 = (yield* 治理拒绝行()).length
      const response = yield* 入库(OFFICER, mcpBody({ name: "", description: "" }))
      expect(response.status).toBe(403)

      // 拒绝要留痕：裸判权（不走 `GovernanceAuthz.进`）时 403 照样绿，但这里会少一行。
      const rows = yield* 治理拒绝行()
      expect(rows.length).toBe(前 + 1)
      const row = rows[rows.length - 1]
      expect(row).toMatchObject({ board: "asset-governance", action: "governance.denied", result: "denied" })
      expect(JSON.parse(String(row?.detail))).toEqual({ perm: "admin" })
    }),
  )
})

describe("MCP 入库 · 成功面", () => {
  it.effect("remote：草稿落库，连接行存在", () =>
    Effect.gen(function* () {
      const response = yield* 入库(
        ADMIN,
        mcpBody({
          name: "远程 MCP",
          connection: {
            transport: "remote",
            url: "https://mcp.example/path",
            headers: { Authorization: "Bearer s3cret" },
          },
        }),
      )
      expect(response.status).toBe(200)
      const text = yield* Effect.promise(() => response.text())
      // 凭据安全：回包只有 `{assetId,name,status,visibility}`，连接头 / 环境变量的**值**一个都不能出现。
      expect(text).not.toContain("s3cret")
      const body = Schema.decodeUnknownSync(回包)(JSON.parse(text))
      expect(body.status).toBe("draft")
      expect(body.visibility).toBe("targeted")
      const asset = yield* Effect.promise(() => assetById(pg!.db, body.assetId))
      expect(asset?.type).toBe("mcp")
      const connection = yield* Effect.promise(() => getMcpConnection(pg!.db, body.assetId))
      expect(connection?.transport).toBe("remote")
      expect(connection?.url).toBe("https://mcp.example/path")
    }),
  )

  it.effect("指定人员：创建时的组与人落成 read 授权行，readers 出口据此预填", () =>
    Effect.gen(function* () {
      const response = yield* 入库(
        ADMIN,
        mcpBody({
          name: "定向 MCP",
          groupIds: ["g_mcp"],
          userIds: [OFFICER.id],
        }),
      )
      expect(response.status).toBe(200)
      const body = Schema.decodeUnknownSync(回包)(yield* Effect.promise(() => response.json()))

      const readers = yield* 发(ADMIN, `/openhive/assets/${body.assetId}/readers`)
      expect(readers.status).toBe(200)
      expect(yield* Effect.promise(() => readers.json())).toEqual({
        groups: [{ id: "g_mcp", name: "MCP 专案组", memberCount: 0 }],
        users: [{ id: OFFICER.id, name: OFFICER.name, dept: "经侦支队" }],
      })
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

  it.effect("不存在的授权组 ⇒ 400，且资产与授权行都不落", () =>
    Effect.gen(function* () {
      const response = yield* 入库(ADMIN, mcpBody({ name: "拒绝-坏组", groupIds: ["g_missing"] }))
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => 同名资产数("拒绝-坏组"))).toBe(0)
      const 授权行 = rowsOf(
        yield* Effect.promise(() =>
          pg!.db.execute(sql`select resource_id from auth.role_resource where role_id = 'g_missing'`),
        ),
      )
      expect(授权行).toHaveLength(0)
    }),
  )

  it.effect("不存在的用户 ⇒ 400，且资产不落", () =>
    Effect.gen(function* () {
      const response = yield* 入库(ADMIN, mcpBody({ name: "拒绝-坏人", userIds: ["u_missing"] }))
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => 同名资产数("拒绝-坏人"))).toBe(0)
    }),
  )

  it.effect("可见范围不是「指定人员」却带 groupIds ⇒ 400（不静默丢掉调用方的选择）", () =>
    Effect.gen(function* () {
      const response = yield* 入库(
        ADMIN,
        mcpBody({ name: "拒绝-范围不符", visibility: "department", groupIds: ["g_mcp"] }),
      )
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => 同名资产数("拒绝-范围不符"))).toBe(0)
    }),
  )
})

describe("MCP 授权对象 · 读取出口", () => {
  it.effect("未登录 ⇒ 401；非作者非管理员 ⇒ 403", () =>
    Effect.gen(function* () {
      const 建 = yield* 入库(ADMIN, mcpBody({ name: "读取权限 MCP" }))
      const body = Schema.decodeUnknownSync(回包)(yield* Effect.promise(() => 建.json()))

      expect((yield* 发(null, `/openhive/assets/${body.assetId}/readers`)).status).toBe(401)

      // OFFICER 不是作者、没有 admin 授权、也不是治理管理员：授权对象不给他看。
      expect((yield* 发(OFFICER, `/openhive/assets/${body.assetId}/readers`)).status).toBe(403)
    }),
  )

  it.effect("不存在的资产 ⇒ 404（先判存在再判权限）", () =>
    Effect.gen(function* () {
      const response = yield* 发(ADMIN, "/openhive/assets/asset_missing/readers")
      expect(response.status).toBe(404)
    }),
  )
})
