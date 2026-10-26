/**
 * 010 T010 · 治理写动作与拒绝的**审计落点**（FR-009 / SC-003）。
 *
 * 判据只钉五件事：
 * ① **拒绝**要落一行 `governance.denied`（谁、何时、哪个板块、哪个 perm）；
 * ② **写动作**成功落 `ok`、业务失败落 `failed`（4xx 是业务结局，5xx 不是）；
 * ③ **读动作不落**（审计不该被「谁看了列表」淹没）；
 * ④ 操作人姓名/警号是**写时快照**；密码**绝不进 detail**；
 * ⑤ 审计存储坏掉**不阻断业务**（`写一行` 抛、`尽力记` 不抛——两层契约各钉一次）。
 *
 * 检索接口本身的形状在 T010b 的测试里钉；本文件只问「库里的行对不对」。
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { OpenhiveAudit } from "../../src/server/openhive/audit"
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
const 待停甲乙: TokenSubject[] = [
  { id: "dddddddd-4444-4444-8444-444444444444", policeNo: "920005", name: "待停甲", isAdmin: false },
  { id: "eeeeeeee-5555-4555-8555-555555555555", policeNo: "920006", name: "待停乙", isAdmin: false },
]
const 待重置: TokenSubject = {
  id: "ffffffff-6666-4666-8666-666666666666",
  policeNo: "920007",
  name: "待重置",
  isAdmin: false,
}

const ORG = "/openhive/governance/org"
const NODES = `${ORG}/nodes`
const TREE = `${ORG}/tree`
const ACCOUNTS = "/openhive/governance/accounts"
const batchDisableUrl = `${ACCOUNTS}/batch-disable`
const passwordUrl = (id: string) => `${ACCOUNTS}/${id}/password`

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [ADMIN, OFFICER, ...待停甲乙, 待重置]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '审计单位', '审计部门', '审计科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
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

const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const 请求 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${(yield* token(subject))}`)
    return yield* openApp(url, { ...init, headers })
  })

const post = (subject: TokenSubject | null, url: string, body?: unknown) =>
  请求(subject, url, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })

/** 读审计表（**裸 SQL**，不经被测对象）。 */
const 审计 = (where: string) =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    return rowsOf(
      await pg.db.execute(
        sql.raw(
          `select actor_id, actor_name, actor_police_no, board, action, target_type, target_id, result, detail
           from auth.audit_event ${where} order by id asc`,
        ),
      ),
    )
  })

const 审计行数 = () =>
  Effect.promise(async () => {
    if (!pg) throw new Error("真库没起来")
    const [row] = rowsOf(await pg.db.execute(sql`select count(*) as n from auth.audit_event`))
    return Number(row?.n ?? 0)
  })

describe("T010 · 拒绝留痕", () => {
  it.live("民警建节点 ⇒ 403，并落一行 governance.denied（板块 ＋ perm ＋ 姓名快照）", () =>
    Effect.gen(function* () {
      const response = yield* post(OFFICER, NODES, { parentId: null, name: "越权单位" })
      expect(response.status).toBe(403)

      const rows = yield* 审计(`where actor_id = '${OFFICER.id}' and action = 'governance.denied'`)
      expect(rows).toHaveLength(1)
      const row = rows[0]
      expect(row).toMatchObject({
        actor_name: OFFICER.name,
        actor_police_no: OFFICER.policeNo,
        board: "org-tree",
        action: "governance.denied",
        result: "denied",
        target_type: null,
        target_id: null,
      })
      expect(JSON.parse(String(row.detail))).toEqual({ perm: "write" })
    }),
  )
})

describe("T010 · 拒绝留痕先于解析", () => {
  // 既有用例（`openhive-governance-org.test.ts`「民警递非法载荷（空名）」）用空名，
  // 而空名是**领域校验**（在 `createNode` 里、授权之后）——把授权挪到「读体与收窄」之后，
  // 那条用例照样绿。真正能分清次序的是**请求体形状**不对：解析先跑就是 400，
  // 授权先跑就是 403，且拒绝要留痕。
  it.live("民警递非对象请求体 ⇒ 仍 403（不是 400），且落 governance.denied", () =>
    Effect.gen(function* () {
      const response = yield* post(OFFICER, NODES, ["不是对象"])
      expect(response.status).toBe(403)

      const rows = yield* 审计(`where actor_id = '${OFFICER.id}' and action = 'governance.denied'`)
      expect(rows.length).toBeGreaterThanOrEqual(1)
    }),
  )
})

describe("T010 · 写动作留痕", () => {
  it.live("管理员建根 ⇒ org.create / ok，target_id 是节点 id", () =>
    Effect.gen(function* () {
      const response = yield* post(ADMIN, NODES, { parentId: null, name: "审计根单位" })
      expect(response.status).toBe(201)
      const node: { id: string } = yield* Effect.promise(() => response.json())

      const rows = yield* 审计(`where action = 'org.create' and result = 'ok'`)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        actor_id: ADMIN.id,
        actor_name: ADMIN.name,
        actor_police_no: ADMIN.policeNo,
        board: "org-tree",
        target_type: "org_node",
        target_id: node.id,
        result: "ok",
      })
      expect(JSON.parse(String(rows[0].detail))).toEqual({ name: "审计根单位" })
    }),
  )

  it.live("管理员建空名 ⇒ 400，并落 org.create / failed（detail 带状态码与字段）", () =>
    Effect.gen(function* () {
      const response = yield* post(ADMIN, NODES, { parentId: null, name: "" })
      expect(response.status).toBe(400)

      const rows = yield* 审计(`where action = 'org.create' and result = 'failed'`)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ board: "org-tree", target_type: "org_node" })
      const detail = JSON.parse(String(rows[0].detail))
      expect(detail).toMatchObject({ status: 400, field: "name" })
    }),
  )

  it.live("批量停用 ⇒ 每个账号一行（不是「一批一行」）", () =>
    Effect.gen(function* () {
      const response = yield* post(ADMIN, batchDisableUrl, { ids: 待停甲乙.map((subject) => subject.id) })
      expect(response.status).toBe(200)

      const rows = yield* 审计(`where action = 'account.batch_disable'`)
      expect(rows).toHaveLength(2)
      expect(new Set(rows.map((row) => row.target_id))).toEqual(new Set(待停甲乙.map((subject) => subject.id)))
      for (const row of rows) expect(row.result).toBe("ok")
    }),
  )

  it.live("重置密码 ⇒ detail 里**没有**口令（密码不是审计素材）", () =>
    Effect.gen(function* () {
      const response = yield* post(ADMIN, passwordUrl(待重置.id))
      expect(response.status).toBe(204)

      const rows = yield* 审计(`where action = 'account.reset_password'`)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ target_type: "user", target_id: 待重置.id, result: "ok" })
      // 判据是「整行序列化后不含那个口令」——只查某个键名会漏掉别的写法的回归。
      expect(String(rows[0].detail)).not.toContain(DEPLOYED_DEFAULT_PASSWORD)
    }),
  )
})

describe("T010 · 读动作不落", () => {
  it.live("管理员读树 ⇒ 审计表一行不增", () =>
    Effect.gen(function* () {
      const before = yield* 审计行数()
      const response = yield* 请求(ADMIN, TREE)
      expect(response.status).toBe(200)
      expect(yield* 审计行数()).toBe(before)
    }),
  )
})

/**
 * 两层契约：`写一行` **抛**（存储层就该抛，测试要能看见），`尽力记` **不抛**
 * （业务不许被审计拖死）。判据用「把表改名，让它写不进去」造一个真实的存储故障，
 * 不 mock——mock 出来的失败证明不了 catch 挂对了地方。
 */
describe("T010 · 审计坏掉不阻断业务", () => {
  test("表不可写 ⇒ 写一行 抛、尽力记 不抛", async () => {
    if (!pg) throw new Error("真库没起来")
    const db = pg.db
    await db.execute(sql`alter table auth.audit_event rename to audit_event_offline`)
    try {
      let 抛了 = false
      try {
        await OpenhiveAudit.写一行(db, ADMIN.id, { action: "account.enable", result: "ok" })
      } catch {
        抛了 = true
      }
      expect(抛了).toBe(true)

      // 用 `Effect.result` 看结局，不靠「resolve 不 reject」的写法：
      // 这样「尽力记 把失败吞了」是一个可读的值，而不是一个没抛的副作用。
      const 结局 = await Effect.runPromise(
        Effect.result(OpenhiveAudit.尽力记(db, ADMIN.id, { action: "account.enable", result: "ok" })),
      )
      expect(结局._tag).toBe("Success")
    } finally {
      await db.execute(sql`alter table auth.audit_event_offline rename to audit_event`)
    }
  })
})
