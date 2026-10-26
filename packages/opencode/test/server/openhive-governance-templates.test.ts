/**
 * 010 T011 · 模板库的四个 HTTP 出口（FR-010 / US4）。
 *
 * 判据落五件事：
 * ① **门**：无凭证 401；民警 / **系统管理员** 403（`gov-system-admin` 模板里没有 `template-lib`
 *    任何权限，只有 `gov-business-expert` 有 read+write——这不是笔误，见 T002 的矩阵）；
 * ② **授权在解析之前**（`#004-09`）：无权者递**畸形载荷**必须拿 403，不能拿 400 当字段探针；
 * ③ **写动作落审计**（`template.create` / `template.update` / `template.disable`，板块 `template-lib`），
 *    业务失败落 `failed`，**读不落**；
 * ④ 判重 409、空名 400、不存在 404、kind 非法 400；
 * ⑤ 停用幂等：连点两次都 200，第二次 `updatedAt` 不被刷——库里的行说了算。
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

/** 系统管理员：**没有** `template-lib` 授权。 */
const ADMIN: TokenSubject = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  policeNo: "930001",
  name: "系统管理员甲",
  isAdmin: true,
}
/** 业务专家：`template-lib` read+write。 */
const EXPERT: TokenSubject = {
  id: "cccccccc-3333-4333-8333-333333333333",
  policeNo: "930003",
  name: "业务专家丙",
  isAdmin: true,
}
/** 第二个业务专家：只为证明「第二次点停用的人不会被记成更新人」（幂等判据不靠时钟）。 */
const EXPERT2: TokenSubject = {
  id: "eeeeeeee-5555-4555-8555-555555555555",
  policeNo: "930005",
  name: "业务专家戊",
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
const TEMPLATES = "/openhive/governance/templates"
const editUrl = (id: string) => `${TEMPLATES}/${id}`
const disableUrl = (id: string) => `${TEMPLATES}/${id}/disable`

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [ADMIN, EXPERT, EXPERT2, OFFICER, READER]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '模板单位', '模板部门', '模板科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${EXPERT.id}, 'gov-business-expert')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${EXPERT2.id}, 'gov-business-expert')`)
  await pg.db.execute(sql`insert into auth.role (id, name) values ('test-template-reader', '模板只读')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('test-template-reader', 'governance', 'template-lib', 'read')
  `)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${READER.id}, 'test-template-reader')`)
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

const Template = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  name: Schema.String,
  scope: Schema.String,
  content: Schema.String,
  status: Schema.String,
  createdBy: Schema.String,
  createdAt: Schema.Number,
  updatedBy: Schema.String,
  updatedAt: Schema.Number,
  updatedByName: Schema.String,
  updatedByPoliceNo: Schema.String,
})
const ListResponse = Schema.Struct({ templates: Schema.Array(Template) })
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
    const [row] = rowsOf(await pg.db.execute(sql.raw(`select count(*)::int as n from auth.template where ${where}`)))
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

const 建 = (subject: TokenSubject, body: Record<string, unknown>) =>
  Effect.gen(function* () {
    const response = yield* post(subject, TEMPLATES, {
      kind: "report",
      name: "资金分析报告",
      scope: "全单位",
      content: "# 一、案情",
      ...body,
    })
    return response
  })

describe("T011 · 门", () => {
  it.live("无凭证 ⇒ 401；民警 ⇒ 403；系统管理员也 ⇒ 403（模板里没有 template-lib）", () =>
    Effect.gen(function* () {
      expect((yield* get(null, TEMPLATES)).status).toBe(401)
      expect((yield* get(OFFICER, TEMPLATES)).status).toBe(403)

      const 管理员 = yield* get(ADMIN, TEMPLATES)
      expect(管理员.status).toBe(403)
      expect((yield* json(ErrorResponse, 管理员)).error).toContain("没有")
    }),
  )

  it.live("业务专家能看列表；只读角色能看、不能建", () =>
    Effect.gen(function* () {
      const 专家 = yield* get(EXPERT, TEMPLATES)
      expect(专家.status).toBe(200)
      expect(Array.isArray((yield* json(ListResponse, 专家)).templates)).toBe(true)

      expect((yield* get(READER, TEMPLATES)).status).toBe(200)
      const 只读建 = yield* 建(READER, { name: "只读不该建出来" })
      expect(只读建.status).toBe(403)
      expect(yield* 库行数("name = '只读不该建出来'")).toBe(0)
    }),
  )

  it.live("无权的写请求拿 403 而不是 400（授权在解析之前，`#004-09`）", () =>
    Effect.gen(function* () {
      const 畸形 = yield* 请求(OFFICER, TEMPLATES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
      expect(畸形.status).toBe(403)

      const 空名 = yield* 建(ADMIN, { name: "" })
      expect(空名.status).toBe(403)
      expect(yield* 库行数("name = ''")).toBe(0)
    }),
  )
})

describe("T011 · 建", () => {
  it.live("201，形状逐字；操作人姓名 join 得出来；列表里出现", () =>
    Effect.gen(function* () {
      const response = yield* 建(EXPERT, { name: "建出来的报告" })
      expect(response.status).toBe(201)
      const row = yield* json(Template, response)
      expect(row).toMatchObject({
        kind: "report",
        name: "建出来的报告",
        scope: "全单位",
        content: "# 一、案情",
        status: "active",
        createdBy: EXPERT.id,
        updatedBy: EXPERT.id,
        updatedByName: EXPERT.name,
        updatedByPoliceNo: EXPERT.policeNo,
      })
      expect(row.createdAt).toBeGreaterThan(0)

      const 列表 = yield* json(ListResponse, yield* get(EXPERT, TEMPLATES))
      expect(列表.templates.map((item) => item.id)).toContain(row.id)
    }),
  )

  it.live("空名 / 非 JSON 体 ⇒ 400；名字超长 ⇒ 400；kind 非法 ⇒ 400", () =>
    Effect.gen(function* () {
      const 空名 = yield* 建(EXPERT, { name: "   " })
      expect(空名.status).toBe(400)
      expect((yield* json(ErrorResponse, 空名)).field).toBe("name")

      const 畸形 = yield* 请求(EXPERT, TEMPLATES, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
      expect(畸形.status).toBe(400)

      const 超长 = yield* 建(EXPERT, { name: "名".repeat(101) })
      expect(超长.status).toBe(400)
      expect((yield* json(ErrorResponse, 超长)).field).toBe("name")

      const 坏类 = yield* 建(EXPERT, { kind: "video", name: "不认识的类型" })
      expect(坏类.status).toBe(400)
      expect((yield* json(ErrorResponse, 坏类)).field).toBe("kind")
    }),
  )

  it.live("同 kind 同名 ⇒ 409；同 kind 同名（带空格）⇒ 409；不同 kind 同名 ⇒ 201", () =>
    Effect.gen(function* () {
      expect((yield* 建(EXPERT, { kind: "graph", name: "判重图谱" })).status).toBe(201)
      expect((yield* 建(EXPERT, { kind: "graph", name: "判重图谱" })).status).toBe(409)
      expect((yield* 建(EXPERT, { kind: "graph", name: "  判重图谱  " })).status).toBe(409)
      expect((yield* 建(EXPERT, { kind: "metric", name: "判重图谱" })).status).toBe(201)
    }),
  )
})

describe("T011 · 列表", () => {
  it.live("?kind= 过滤生效；kind 非法 ⇒ 400；不给 kind ⇒ 三类都带出来", () =>
    Effect.gen(function* () {
      yield* 建(EXPERT, { kind: "report", name: "过滤用报告" })
      yield* 建(EXPERT, { kind: "metric", name: "过滤用口径" })

      const 报告 = yield* json(ListResponse, yield* get(EXPERT, `${TEMPLATES}?kind=report`))
      expect(报告.templates.every((row) => row.kind === "report")).toBe(true)
      expect(报告.templates.map((row) => row.name)).toContain("过滤用报告")

      const 全部 = yield* json(ListResponse, yield* get(EXPERT, TEMPLATES))
      expect(new Set(全部.templates.map((row) => row.kind))).toEqual(new Set(["report", "graph", "metric"]))

      expect((yield* get(EXPERT, `${TEMPLATES}?kind=video`)).status).toBe(400)
    }),
  )
})

describe("T011 · 编辑", () => {
  it.live("改名称 / 范围 / 正文 ⇒ 200；created_* 不动，updated_* 跟着走", () =>
    Effect.gen(function* () {
      const 原 = yield* json(Template, yield* 建(EXPERT, { name: "待改模板" }))
      const response = yield* post(EXPERT, editUrl(原.id), { name: "改后模板", scope: "经侦支队", content: "新正文" })
      expect(response.status).toBe(200)
      expect(yield* json(Template, response)).toMatchObject({
        id: 原.id,
        name: "改后模板",
        scope: "经侦支队",
        content: "新正文",
        createdAt: 原.createdAt,
        createdBy: 原.createdBy,
        updatedBy: EXPERT.id,
      })
    }),
  )

  it.live("改成同 kind 已有的名字 ⇒ 409；不存在 / 已停用 ⇒ 404", () =>
    Effect.gen(function* () {
      const 甲 = yield* json(Template, yield* 建(EXPERT, { kind: "metric", name: "改名前甲" }))
      yield* 建(EXPERT, { kind: "metric", name: "改名前乙" })
      expect((yield* post(EXPERT, editUrl(甲.id), { name: "改名前乙" })).status).toBe(409)

      expect((yield* post(EXPERT, editUrl("没有这个 id"), { scope: "x" })).status).toBe(404)

      const 将停 = yield* json(Template, yield* 建(EXPERT, { kind: "metric", name: "停后再改" }))
      expect((yield* post(EXPERT, disableUrl(将停.id))).status).toBe(200)
      expect((yield* post(EXPERT, editUrl(将停.id), { scope: "x" })).status).toBe(404)
    }),
  )
})

describe("T011 · 停用", () => {
  it.live("停用 ⇒ 200；列表里消失；同名可重新建（唯一性只压 active）", () =>
    Effect.gen(function* () {
      const 原 = yield* json(Template, yield* 建(EXPERT, { kind: "graph", name: "待停图谱" }))
      const response = yield* post(EXPERT, disableUrl(原.id))
      expect(response.status).toBe(200)
      expect((yield* json(Template, response)).status).toBe("disabled")

      const 列表 = yield* json(ListResponse, yield* get(EXPERT, `${TEMPLATES}?kind=graph`))
      expect(列表.templates.map((row) => row.id)).not.toContain(原.id)

      // 行还在库里（停用 ≠ 删除）
      expect(yield* 库行数(`id = '${原.id}' and status = 'disabled'`)).toBe(1)

      expect((yield* 建(EXPERT, { kind: "graph", name: "待停图谱" })).status).toBe(201)
    }),
  )

  it.live("连停两次 ⇒ 都 200，第二次 updatedAt / updatedBy 不被刷（**换个操作人**点，判据不靠时钟）", () =>
    Effect.gen(function* () {
      const 原 = yield* json(Template, yield* 建(EXPERT, { kind: "report", name: "连停两次" }))
      const 一 = yield* json(Template, yield* post(EXPERT, disableUrl(原.id)))
      // 第二次换一个人点：若停用不幂等，`updated_by` 会变成 EXPERT2——同一秒内也照得出来。
      const 二 = yield* json(Template, yield* post(EXPERT2, disableUrl(原.id)))
      expect(二.status).toBe("disabled")
      expect(二.updatedAt).toBe(一.updatedAt)
      expect(二.updatedBy).toBe(EXPERT.id)

      expect((yield* post(EXPERT, disableUrl("没有这个 id"))).status).toBe(404)
    }),
  )
})

describe("T011 · 审计", () => {
  it.live("建 / 改 / 停各落一行 ok，板块 template-lib，操作人是写时快照", () =>
    Effect.gen(function* () {
      const 建出 = yield* json(Template, yield* 建(EXPERT, { kind: "report", name: "审计用模板" }))
      yield* post(EXPERT, editUrl(建出.id), { scope: "改过" })
      yield* post(EXPERT, disableUrl(建出.id))

      const 行 = yield* 审计(`target_id = '${建出.id}'`)
      expect(行.map((row) => row.action)).toEqual(["template.create", "template.update", "template.disable"])
      expect(行.every((row) => row.board === "template-lib")).toBe(true)
      expect(行.every((row) => row.result === "ok")).toBe(true)
      expect(行.every((row) => row.actor_id === EXPERT.id)).toBe(true)
      expect(行.every((row) => row.target_type === "template")).toBe(true)
    }),
  )

  it.live("业务失败落 failed（判重 409 / 空名 400）；读列表不落审计", () =>
    Effect.gen(function* () {
      yield* 建(EXPERT, { kind: "metric", name: "审计判重" })
      const 判重 = yield* 建(EXPERT, { kind: "metric", name: "审计判重" })
      expect(判重.status).toBe(409)

      const 失败行 = yield* 审计(`action = 'template.create' and result = 'failed'`)
      expect(失败行.length).toBeGreaterThanOrEqual(1)
      expect(JSON.parse(String(失败行.at(-1)?.detail))).toMatchObject({ status: 409 })

      const 读前 = (yield* 审计("true")).length
      yield* get(EXPERT, TEMPLATES)
      const 读后 = (yield* 审计("true")).length
      expect(读后).toBe(读前)
    }),
  )

  it.live("无权访问落一行 governance.denied（板块 template-lib）", () =>
    Effect.gen(function* () {
      expect((yield* get(OFFICER, TEMPLATES)).status).toBe(403)
      const 行 = yield* 审计(`action = 'governance.denied' and board = 'template-lib'`)
      expect(行.length).toBeGreaterThanOrEqual(1)
      expect(行.at(-1)?.actor_id).toBe(OFFICER.id)
    }),
  )
})
