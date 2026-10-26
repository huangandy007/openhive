/**
 * 010 T012 · 数据源配置的四个 HTTP 出口（FR-011 / US6）。
 *
 * 判据落五件事：
 * ① **门**：无凭证 401；民警 / **业务专家** 403（`data-source` 只授 `gov-system-admin`，
 *    见 T002 的矩阵）；系统管理员可读写；自定义只读角色能看不能建；
 * ② **授权在解析之前**（`#004-09`）：无权者递**畸形载荷**必须拿 403，不能拿 400 当字段探针；
 * ③ **写动作落审计**（`data-source.create` / `data-source.update`，板块 `data-source`），
 *    业务失败落 `failed`，**读不落**；审计 detail **不记连接地址**（少一份外泄面）；
 * ④ 400 族逐个点名 `field`（name / kind / frequency / status / upstreamIds）、409 撞名、404 不存在；
 * ⑤ 血缘：登记上游后 `GET /:id` 双向可查；自引用 / 成环 / 上游不存在都是 400，且**不落半截行**。
 */

import { afterAll, beforeAll, describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

/** 系统管理员：`data-source` read+write。 */
const ADMIN: TokenSubject = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  policeNo: "930001",
  name: "系统管理员甲",
  isAdmin: true,
}
/** 业务专家：**没有** `data-source` 授权（那一格是运维/技术）。 */
const EXPERT: TokenSubject = {
  id: "cccccccc-3333-4333-8333-333333333333",
  policeNo: "930003",
  name: "业务专家丙",
  isAdmin: true,
}
const OFFICER: TokenSubject = {
  id: "bbbbbbbb-2222-4222-8222-222222222222",
  policeNo: "930002",
  name: "民警乙",
  isAdmin: false,
}
/** 自定义只读角色：read ≠ write 的观测面。 */
const READER: TokenSubject = {
  id: "dddddddd-4444-4444-8444-444444444444",
  policeNo: "930004",
  name: "只读丁",
  isAdmin: true,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const SOURCES = "/openhive/governance/data-sources"
const oneUrl = (id: string) => `${SOURCES}/${id}`

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [ADMIN, EXPERT, OFFICER, READER]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '数据源单位', '数据源部门', '数据源科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${EXPERT.id}, 'gov-business-expert')`)
  await pg.db.execute(sql`insert into auth.role (id, name) values ('test-data-source-reader', '数据源只读')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-data-source-reader', 'governance', 'data-source', 'read')
  `)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${READER.id}, 'test-data-source-reader')`)
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

const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const 请求 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const get = (subject: TokenSubject | null, url: string) => 请求(subject, url)

const post = (subject: TokenSubject | null, url: string, body?: unknown) =>
  请求(subject, url, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })

const Source = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.String,
  endpoint: Schema.String,
  frequency: Schema.String,
  owner: Schema.String,
  status: Schema.String,
  lastSyncedAt: Schema.NullOr(Schema.Number),
  createdBy: Schema.String,
  createdAt: Schema.Number,
  updatedBy: Schema.String,
  updatedAt: Schema.Number,
})
const LineageNode = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.String,
  status: Schema.String,
})
const ListResponse = Schema.Struct({ sources: Schema.Array(Source) })
const LineageResponse = Schema.Struct({
  source: Source,
  upstream: Schema.Array(LineageNode),
  downstream: Schema.Array(LineageNode),
})
const ErrorResponse = Schema.Struct({ error: Schema.String, field: Schema.optional(Schema.String) })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(schema)(JSON.parse(body))
  })

/** 裸 SQL 数库里的行（不经被测对象）。 */
const 库行数 = (where = "true") =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    const [row] = rowsOf(await pg.db.execute(sql.raw(`select count(*)::int as n from auth.data_source where ${where}`)))
    return Number(row?.n ?? 0)
  })

/** 读审计表（**裸 SQL**）。 */
const 审计 = (where: string) =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    return rowsOf(
      await pg.db.execute(
        sql.raw(
          `select actor_id, board, action, target_type, target_id, result, detail
           from auth.audit_event where ${where} order by id asc`,
        ),
      ),
    )
  })

let 序号 = 0
const 唯一名 = (前缀: string) => `${前缀}-${++序号}`

const 建 = (subject: TokenSubject, body: Record<string, unknown> = {}) =>
  post(subject, SOURCES, {
    name: 唯一名("话单库"),
    kind: "database",
    frequency: "daily",
    endpoint: "pg://10.0.0.8:5432/cdr",
    owner: "科信支队 张三",
    ...body,
  })

describe("T012 · 门", () => {
  it.live("无凭证 ⇒ 401；民警 ⇒ 403；业务专家也 ⇒ 403（data-source 只给系统管理员）", () =>
    Effect.gen(function* () {
      expect((yield* get(null, SOURCES)).status).toBe(401)
      expect((yield* get(OFFICER, SOURCES)).status).toBe(403)

      const 专家 = yield* get(EXPERT, SOURCES)
      expect(专家.status).toBe(403)
      expect((yield* json(ErrorResponse, 专家)).error).toContain("没有")
    }),
  )

  it.live("系统管理员能看列表；只读角色能看、不能建", () =>
    Effect.gen(function* () {
      const 管理员 = yield* get(ADMIN, SOURCES)
      expect(管理员.status).toBe(200)
      expect(Array.isArray((yield* json(ListResponse, 管理员)).sources)).toBe(true)

      expect((yield* get(READER, SOURCES)).status).toBe(200)
      const 名字 = 唯一名("只读不该建出来")
      const 只读建 = yield* 建(READER, { name: 名字 })
      expect(只读建.status).toBe(403)
      expect(yield* 库行数(`name = '${名字}'`)).toBe(0)
    }),
  )

  it.live("无权的写请求拿 403 而不是 400（授权在解析之前，`#004-09`）", () =>
    Effect.gen(function* () {
      const 畸形 = yield* 请求(EXPERT, SOURCES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
      expect(畸形.status).toBe(403)

      const 空名 = yield* 建(EXPERT, { name: "" })
      expect(空名.status).toBe(403)
      expect(yield* 库行数("name = ''")).toBe(0)
    }),
  )
})

describe("T012 · 注册", () => {
  it.live("201，形状逐字（camelCase、lastSyncedAt 为 null），列表里出现", () =>
    Effect.gen(function* () {
      const 名字 = 唯一名("注册出来的库")
      const response = yield* 建(ADMIN, { name: 名字 })
      expect(response.status).toBe(201)
      const row = yield* json(Source, response)
      expect(row).toMatchObject({
        name: 名字,
        kind: "database",
        endpoint: "pg://10.0.0.8:5432/cdr",
        frequency: "daily",
        owner: "科信支队 张三",
        status: "active",
        lastSyncedAt: null,
        createdBy: ADMIN.id,
        updatedBy: ADMIN.id,
      })

      const 列表 = yield* json(ListResponse, yield* get(ADMIN, SOURCES))
      expect(列表.sources.map((item) => item.id)).toContain(row.id)
    }),
  )

  it.live("400 族逐个点名 field：空名 / kind / frequency / status / upstreamIds 不是数组", () =>
    Effect.gen(function* () {
      const 空名 = yield* 建(ADMIN, { name: "   " })
      expect(空名.status).toBe(400)
      expect((yield* json(ErrorResponse, 空名)).field).toBe("name")

      const 坏类型 = yield* 建(ADMIN, { kind: "video" })
      expect(坏类型.status).toBe(400)
      expect((yield* json(ErrorResponse, 坏类型)).field).toBe("kind")

      const 坏频率 = yield* 建(ADMIN, { frequency: "每分钟" })
      expect(坏频率.status).toBe(400)
      expect((yield* json(ErrorResponse, 坏频率)).field).toBe("frequency")

      const 坏状态 = yield* 建(ADMIN, { status: "deleted" })
      expect(坏状态.status).toBe(400)
      expect((yield* json(ErrorResponse, 坏状态)).field).toBe("status")

      const 坏上游 = yield* 建(ADMIN, { upstreamIds: "not-an-array" })
      expect(坏上游.status).toBe(400)
      expect((yield* json(ErrorResponse, 坏上游)).field).toBe("upstreamIds")

      const 坏上游项 = yield* 建(ADMIN, { upstreamIds: [1] })
      expect(坏上游项.status).toBe(400)
      expect((yield* json(ErrorResponse, 坏上游项)).field).toBe("upstreamIds")
    }),
  )

  it.live("同名 ⇒ 409（带空格的同名也算）", () =>
    Effect.gen(function* () {
      const 名字 = 唯一名("撞名库")
      expect((yield* 建(ADMIN, { name: 名字 })).status).toBe(201)

      const 再建 = yield* 建(ADMIN, { name: 名字 })
      expect(再建.status).toBe(409)
      expect((yield* json(ErrorResponse, 再建)).error).toContain(名字)

      const 空格同名 = yield* 建(ADMIN, { name: `  ${名字}  ` })
      expect(空格同名.status).toBe(409)
    }),
  )

  it.live("注册时带上游 ⇒ 血缘接口里查得到", () =>
    Effect.gen(function* () {
      const 上游 = yield* json(Source, yield* 建(ADMIN, { name: 唯一名("上游库"), kind: "file", frequency: "manual" }))
      const 下游 = yield* json(
        Source,
        yield* 建(ADMIN, { name: 唯一名("下游库"), upstreamIds: [上游.id] }),
      )

      const 线 = yield* json(LineageResponse, yield* get(ADMIN, oneUrl(下游.id)))
      expect(线.source.id).toBe(下游.id)
      expect(线.upstream.map((node) => node.id)).toEqual([上游.id])
      expect(线.downstream).toEqual([])

      const 上游线 = yield* json(LineageResponse, yield* get(ADMIN, oneUrl(上游.id)))
      expect(上游线.downstream.map((node) => node.id)).toEqual([下游.id])
    }),
  )

  it.live("血缘三条门都是 400，且不留下半截行", () =>
    Effect.gen(function* () {
      const a = yield* json(Source, yield* 建(ADMIN, { name: 唯一名("环 A") }))
      const b = yield* json(Source, yield* 建(ADMIN, { name: 唯一名("环 B"), upstreamIds: [a.id] }))

      const 不存在 = yield* 建(ADMIN, { name: 唯一名("挂空"), upstreamIds: ["no-such-id"] })
      expect(不存在.status).toBe(400)
      expect((yield* json(ErrorResponse, 不存在)).field).toBe("upstreamIds")

      const 自指 = yield* post(ADMIN, oneUrl(a.id), { upstreamIds: [a.id] })
      expect(自指.status).toBe(400)
      expect((yield* json(ErrorResponse, 自指)).field).toBe("upstreamIds")

      const 真环 = yield* post(ADMIN, oneUrl(a.id), { name: 唯一名("环 A 改名"), upstreamIds: [b.id] })
      expect(真环.status).toBe(400)
      expect((yield* json(ErrorResponse, 真环)).field).toBe("upstreamIds")

      const 线 = yield* json(LineageResponse, yield* get(ADMIN, oneUrl(a.id)))
      expect(线.upstream).toEqual([])
      expect(线.source.name).toBe(a.name)
    }),
  )
})

describe("T012 · 编辑", () => {
  it.live("部分更新 200：createdAt 不动、updatedBy 变成改的人；坏 id 404；空补丁 400", () =>
    Effect.gen(function* () {
      const row = yield* json(Source, yield* 建(ADMIN, { name: 唯一名("待改库") }))

      const 改后 = yield* post(ADMIN, oneUrl(row.id), { owner: "科信 王五", status: "disabled" })
      expect(改后.status).toBe(200)
      const 新 = yield* json(Source, 改后)
      expect(新).toMatchObject({
        name: row.name,
        owner: "科信 王五",
        status: "disabled",
        createdAt: row.createdAt,
        updatedBy: ADMIN.id,
      })

      expect((yield* post(ADMIN, oneUrl("no-such-id"), { owner: "x" })).status).toBe(404)

      const 空补丁 = yield* post(ADMIN, oneUrl(row.id), {})
      expect(空补丁.status).toBe(400)
      expect((yield* json(ErrorResponse, 空补丁)).error).toContain("没有要改的字段")
    }),
  )

  it.live("改成别人的名字 ⇒ 409", () =>
    Effect.gen(function* () {
      const 甲 = yield* json(Source, yield* 建(ADMIN, { name: 唯一名("甲库") }))
      const 乙 = yield* json(Source, yield* 建(ADMIN, { name: 唯一名("乙库") }))

      const 撞名 = yield* post(ADMIN, oneUrl(甲.id), { name: 乙.name })
      expect(撞名.status).toBe(409)
      expect((yield* json(ErrorResponse, 撞名)).error).toContain(乙.name)
    }),
  )
})

describe("T012 · 审计", () => {
  it.live("create / update 各落一行 ok（板块 data-source），detail 不记连接地址", () =>
    Effect.gen(function* () {
      const 名字 = 唯一名("审计库")
      const row = yield* json(Source, yield* 建(ADMIN, { name: 名字, endpoint: "pg://secret-host:5432/x" }))
      yield* post(ADMIN, oneUrl(row.id), { owner: "审计改过" })

      const 行 = yield* 审计(`action in ('data-source.create', 'data-source.update') and target_id = '${row.id}'`)
      expect(行.map((item) => item.action)).toEqual(["data-source.create", "data-source.update"])
      for (const item of 行) {
        expect(item).toMatchObject({
          actor_id: ADMIN.id,
          board: "data-source",
          target_type: "data_source",
          result: "ok",
        })
        expect(String(item.detail)).not.toContain("secret-host")
      }
    }),
  )

  it.live("业务失败（409 / 404）落 failed；读列表与读血缘不落行", () =>
    Effect.gen(function* () {
      const 名字 = 唯一名("失败库")
      yield* 建(ADMIN, { name: 名字 })
      const 撞名 = yield* 建(ADMIN, { name: 名字, kind: "file", frequency: "manual" })
      expect(撞名.status).toBe(409)
      const 编辑404 = yield* post(ADMIN, oneUrl("no-such-id"), { owner: "x" })
      expect(编辑404.status).toBe(404)

      const 失败行 = yield* 审计(`action = 'data-source.create' and result = 'failed' and target_id is null`)
      expect(失败行.length).toBeGreaterThanOrEqual(1)
      const 详情 = JSON.parse(String(失败行.at(-1)?.detail))
      expect(详情.status).toBe(409)

      const 更新失败 = yield* 审计(`action = 'data-source.update' and result = 'failed'`)
      expect(更新失败.length).toBeGreaterThanOrEqual(1)
      expect(JSON.parse(String(更新失败.at(-1)?.detail)).status).toBe(404)

      const 读用 = yield* json(Source, yield* 建(ADMIN, { name: 唯一名("读不落行") }))
      const 读前 = (yield* 审计("true")).length
      yield* get(ADMIN, SOURCES)
      yield* get(ADMIN, oneUrl(读用.id))
      const 读后 = (yield* 审计("true")).length
      expect(读后).toBe(读前)
    }),
  )

  it.live("无权者撞门 ⇒ governance.denied（业务专家）", () =>
    Effect.gen(function* () {
      const 名字 = 唯一名("越权库")
      yield* 建(EXPERT, { name: 名字 })
      const 行 = yield* 审计(
        `action = 'governance.denied' and board = 'data-source' and actor_id = '${EXPERT.id}'`,
      )
      expect(行.length).toBeGreaterThanOrEqual(1)
    }),
  )
})
