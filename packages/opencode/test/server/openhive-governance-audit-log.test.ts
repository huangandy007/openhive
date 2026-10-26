/**
 * 010 T010b · **审计日志检索**出口（FR-009 / DESIGN §4.11.7）。
 *
 * 判据只钉这一层答应的事：
 * ① 授权先于参数解析（`#004-09`）——民警递 `from=abc` 必须 403，不是 400；
 * ② 缺省窗口是**近 7 天**（DESIGN 明写），不是「全部」也不是「近 30 天」；
 * ③ 窗口左闭右开，`[from, to)`；
 * ④ 筛选：操作人（姓名或警号子串）/ 动作 / 结果 / 关键词（对象 id 或 detail）；
 * ⑤ 分页：`total` 是筛选后的总数（不受分页影响），翻页不重不漏；
 * ⑥ 读这条出口**不产生审计行**（审计不该自己审计自己，否则每翻一页涨一行）。
 *
 * 「行是怎么写进去的」在 T010a 的 `openhive-governance-audit.test.ts` 钉；本文件只问读。
 */

import { afterAll, beforeAll, describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { Audit } from "@opencode-ai/auth/audit"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ADMIN: TokenSubject = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  policeNo: "920001",
  name: "审计管理员",
  isAdmin: true,
}
const OFFICER: TokenSubject = {
  id: "bbbbbbbb-2222-4222-8222-222222222222",
  policeNo: "920002",
  name: "普通民警",
  isAdmin: false,
}

const URL_PATH = "/openhive/governance/audit-log"

const 一天 = 24 * 60 * 60
const now = Math.floor(Date.now() / 1000)

// 网关在**路由构造期**就要默认口令（`gateway.ts:302`），所以这份 env 必须在建 app 之前写好。
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [ADMIN, OFFICER]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '审计单位', '审计部门', '审计科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)

  // 三行夹具：8 天前（窗口外）/ 1 小时前（拒绝）/ 1 分钟前（成功）。
  await Audit.recordAuditEvent(pg.db, {
    actorId: OFFICER.id,
    actorName: OFFICER.name,
    actorPoliceNo: OFFICER.policeNo,
    board: "account-manage",
    action: "account.create",
    targetType: "user",
    targetId: "旧的账号",
    result: "ok",
    detail: { policeNo: "910001" },
    occurredAt: now - 8 * 一天,
  })
  await Audit.recordAuditEvent(pg.db, {
    actorId: OFFICER.id,
    actorName: OFFICER.name,
    actorPoliceNo: OFFICER.policeNo,
    board: null,
    action: "tool.denied",
    targetType: "session",
    targetId: "ses_拒绝",
    result: "denied",
    detail: { permission: "bash", patterns: ["rm -rf *"] },
    occurredAt: now - 3600,
  })
  await Audit.recordAuditEvent(pg.db, {
    actorId: ADMIN.id,
    actorName: ADMIN.name,
    actorPoliceNo: ADMIN.policeNo,
    board: "org-tree",
    action: "org.create",
    targetType: "org_node",
    targetId: "node-1",
    result: "ok",
    detail: { name: "新建单位" },
    occurredAt: now - 60,
  })
})

const env: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
}

const app = (() => {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler
  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
})()

const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const 读 = (subject: TokenSubject | null, query = "") =>
  Effect.gen(function* () {
    const headers = new Headers()
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* app(`${URL_PATH}${query}`, { headers })
  })

interface 行 {
  readonly id: number
  readonly occurred_at: number
  readonly actor_id: string
  readonly actor_name: string
  readonly actor_police_no: string
  readonly board: string | null
  readonly action: string
  readonly target_type: string | null
  readonly target_id: string | null
  readonly result: string
  readonly detail: Record<string, unknown>
}

interface 页 {
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly items: readonly 行[]
}

/** 只验「回包形状确实是分页」；每一列的值由下面的用例逐个断言。 */
function 是页(value: unknown): value is 页 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return "total" in value && "page" in value && "pageSize" in value && "items" in value && Array.isArray(value.items)
}

const 页 = (response: Response) =>
  Effect.promise(async (): Promise<页> => {
    const body: unknown = await response.json()
    if (!是页(body)) throw new Error(`回包不是分页：${JSON.stringify(body)}`)
    return body
  })

const 审计行数 = () =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    const [row] = rowsOf(await pg.db.execute(sql`select count(*) as n from auth.audit_event`))
    return Number(row?.n ?? 0)
  })

describe("T010b · 准入", () => {
  it.live("无凭证 ⇒ 401（空体，不落审计行）", () =>
    Effect.gen(function* () {
      const before = yield* 审计行数()
      const response = yield* 读(null)
      expect(response.status).toBe(401)
      expect(yield* 审计行数()).toBe(before)
      // 同一个地址管理员能读 ⇒ 上面的 401 来自身份门，不是「路由根本不存在」（`#005-18`）。
      expect((yield* 读(ADMIN)).status).toBe(200)
    }),
  )

  it.live("民警（无 audit-log 授权）⇒ 403", () =>
    Effect.gen(function* () {
      const response = yield* 读(OFFICER)
      expect(response.status).toBe(403)
    }),
  )

  it.live("民警递非法参数 ⇒ 403（授权先于解析，不拿 400 当字段探针）", () =>
    Effect.gen(function* () {
      const response = yield* 读(OFFICER, "?from=abc&result=bogus")
      expect(response.status).toBe(403)
    }),
  )
})

describe("T010b · 参数", () => {
  it.live("管理员递非数字 from ⇒ 400", () =>
    Effect.gen(function* () {
      const response = yield* 读(ADMIN, "?from=abc")
      expect(response.status).toBe(400)
    }),
  )

  it.live("from 不早于 to ⇒ 400", () =>
    Effect.gen(function* () {
      const response = yield* 读(ADMIN, `?from=${now}&to=${now}`)
      expect(response.status).toBe(400)
    }),
  )

  it.live("未知 result ⇒ 400", () =>
    Effect.gen(function* () {
      const response = yield* 读(ADMIN, "?result=bogus")
      expect(response.status).toBe(400)
    }),
  )

  it.live("未知 action ⇒ 400", () =>
    Effect.gen(function* () {
      const response = yield* 读(ADMIN, "?action=account.destroy")
      expect(response.status).toBe(400)
    }),
  )

  it.live("page / pageSize 非正整数 ⇒ 400（不悄悄回落默认值）", () =>
    Effect.gen(function* () {
      expect((yield* 读(ADMIN, "?page=0")).status).toBe(400)
      expect((yield* 读(ADMIN, "?page=abc")).status).toBe(400)
      expect((yield* 读(ADMIN, "?pageSize=0")).status).toBe(400)
      expect((yield* 读(ADMIN, "?pageSize=999")).status).toBe(400)
    }),
  )
})

describe("T010b · 窗口与排序", () => {
  it.live("缺省窗口 = 近 7 天：8 天前那行不出现", () =>
    Effect.gen(function* () {
      const response = yield* 读(ADMIN)
      expect(response.status).toBe(200)
      const body = yield* 页(response)
      expect(body.total).toBe(2)
      expect(body.items.map((row) => row.action)).toEqual(["org.create", "tool.denied"])
    }),
  )

  it.live("窗口左闭右开：`to` 正好等于行时间 ⇒ 该行不出现", () =>
    Effect.gen(function* () {
      const body = yield* 页(yield* 读(ADMIN, `?from=${now - 7200}&to=${now - 60}`))
      expect(body.items.map((row) => row.action)).toEqual(["tool.denied"])
    }),
  )

  it.live("显式窗口可取到 8 天前那行", () =>
    Effect.gen(function* () {
      const body = yield* 页(yield* 读(ADMIN, `?from=${now - 9 * 一天}&to=${now}`))
      expect(body.total).toBe(3)
      expect(body.items.map((row) => row.action)).toEqual(["org.create", "tool.denied", "account.create"])
    }),
  )

  it.live("明细字段原样回来（detail 是对象，不是字符串）", () =>
    Effect.gen(function* () {
      const body = yield* 页(yield* 读(ADMIN, "?action=tool.denied"))
      expect(body.items[0]).toMatchObject({
        actor_name: OFFICER.name,
        actor_police_no: OFFICER.policeNo,
        board: null,
        action: "tool.denied",
        target_type: "session",
        target_id: "ses_拒绝",
        result: "denied",
      })
      expect(body.items[0].detail).toEqual({ permission: "bash", patterns: ["rm -rf *"] })
    }),
  )
})

describe("T010b · 筛选", () => {
  it.live("操作人按姓名子串", () =>
    Effect.gen(function* () {
      const body = yield* 页(yield* 读(ADMIN, "?actor=普通"))
      expect(body.items.map((row) => row.action)).toEqual(["tool.denied"])
    }),
  )

  it.live("操作人按警号子串", () =>
    Effect.gen(function* () {
      const body = yield* 页(yield* 读(ADMIN, "?actor=920001"))
      expect(body.items.map((row) => row.action)).toEqual(["org.create"])
    }),
  )

  it.live("`%` 按字面量处理（不转义就会翻出全部行）", () =>
    Effect.gen(function* () {
      const body = yield* 页(yield* 读(ADMIN, "?actor=%25"))
      expect(body.total).toBe(0)
    }),
  )

  it.live("按动作", () =>
    Effect.gen(function* () {
      const body = yield* 页(yield* 读(ADMIN, "?action=tool.denied"))
      expect(body.total).toBe(1)
    }),
  )

  it.live("按结果（denied 就是「越权可筛出」）", () =>
    Effect.gen(function* () {
      const body = yield* 页(yield* 读(ADMIN, "?result=denied"))
      expect(body.items.map((row) => row.action)).toEqual(["tool.denied"])
    }),
  )

  it.live("关键词命中 target_id", () =>
    Effect.gen(function* () {
      const body = yield* 页(yield* 读(ADMIN, "?q=node-1"))
      expect(body.items.map((row) => row.action)).toEqual(["org.create"])
    }),
  )

  it.live("关键词命中 detail 文本", () =>
    Effect.gen(function* () {
      const body = yield* 页(yield* 读(ADMIN, "?q=rm -rf"))
      expect(body.items.map((row) => row.action)).toEqual(["tool.denied"])
    }),
  )
})

describe("T010b · 分页", () => {
  it.live("total 是筛选后的总数，不受 pageSize 影响；按时间倒序", () =>
    Effect.gen(function* () {
      const body = yield* 页(yield* 读(ADMIN, "?pageSize=1&page=2"))
      expect(body.total).toBe(2)
      expect(body.page).toBe(2)
      expect(body.pageSize).toBe(1)
      expect(body.items.map((row) => row.action)).toEqual(["tool.denied"])
    }),
  )

  it.live("读这条出口本身不落审计行（翻页不涨行）", () =>
    Effect.gen(function* () {
      const before = yield* 审计行数()
      yield* 读(ADMIN, "?pageSize=1&page=1")
      yield* 读(ADMIN, "?pageSize=1&page=2")
      expect(yield* 审计行数()).toBe(before)
    }),
  )
})
