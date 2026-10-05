import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { evaluate as evaluateV1 } from "../../src/permission"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * T006（验收 · FR-004）：**capability 真的挂到了会话上**。
 *
 * ## 这条补的是哪个洞
 *
 * `openhive-access.test.ts` 测的是**纯函数**（授权行 ⇒ 规则集、并入顺序、幂等），
 * `packages/auth/src/rbac.test.ts` 测的是**取行**。两半各自全绿，接线（
 * `handlers/session.ts` 的 create 真的调了 `capabilityFor` 并把结果并进去）**没有任何东西守着**——
 * 把那一句 merge 删掉，上面两组测试**照样全绿**（`LEARNINGS #002-02`：没真正执行被测路径的
 * 测试不是测试）。而它是 T006 出参那句话（「越权调用被拒」）唯一的落点。
 *
 * ## 判据不经过被测接口
 *
 * 会话建完之后，`permission` **直接从库文件里读**（`packages/core/src/session/sql.ts` 的
 * `permission` 列，JSON），再拿**链 A 真正的判决器** `evaluate` 去问「这个 skill 到底放不放」。
 * 两条都刻意绕开 HTTP：从 `GET /session/:id` 读，等于拿被测对象证明被测对象。
 *
 * ## 为什么这里也要一个真 auth 库
 *
 * 门开着时 `POST /session` 会按身份查 `auth.role_resource`（`@/server/openhive/access`）；
 * 查不到就不把会话建出来（fail-closed）。本文件走的正是**有授权行**的那条路——所以它同时
 * 钉住了「授权行 → 会话规则集」这一次真正的搬运，而不是只钉住搬运函数的语义。
 *
 * ⚠️ **夹具必须文件级**：应用层模块级构建、全文件只构造一次，层里那个 auth 连接池也随之只建
 * 一次、指向**第一个用例那个端口**（理由写在 `startProductionDb` 上）。与
 * `tenant-db-isolation.test.ts` 同款。
 */

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "020601",
  name: "张三",
  isAdmin: false,
}
const BOB: TokenSubject = {
  id: "660e8400-e29b-41d4-a716-446655440001",
  policeNo: "020602",
  name: "李四",
  isAdmin: false,
}

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-access-wiring-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

/**
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`：`DatabaseRouter.layer` 读的是
 * `dataRoot(process.env)`，**不是** Effect 的 `Config` 服务——塞进 `ConfigProvider` 会被无声忽略。
 * 与 `tenant-db-isolation.test.ts` 同因同注。
 */
const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/** 网关开着时 `routes` 的层构造期要解析它，缺失即抛（T020 的裁定）。 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {}
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  // ALICE：一个用户行（`user_role` 的外键指向它）＋ 一个角色 ＋ **一条 skill 读授权**。
  // BOB **故意什么都不给**——「零授权」那一条用例靠他。
  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values (${ALICE.id}, '020601', '张三', 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
  `)
  await pg.db.execute(sql`insert into auth.role (id, name) values ('r_analyst', '研判员')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ALICE.id}, 'r_analyst')`)
  await pg.db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values ('r_analyst', 'skill', 'fund-analysis', 'read')
  `)
})

afterAll(async () => {
  await pg?.stop()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
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

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.map(Effect.promise(() => response.json()), (body: unknown) => Schema.decodeUnknownSync(schema)(body))

const SessionInfo = Schema.Struct({ id: Schema.String })

const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

/** 以某人的身份建一个会话（可带客户端自填的 `permission`），返回它的 id。 */
const createSessionAs = (subject: TokenSubject, body?: unknown) =>
  Effect.gen(function* () {
    const init: RequestInit =
      body === undefined
        ? { method: "POST" }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    const response = yield* as(subject, "/session", init)
    expect(response.status).toBe(200)
    return (yield* json(SessionInfo, response)).id
  })

/**
 * 直接读**库文件**里这条会话的 `permission` 列（JSON），解成规则集。
 *
 * 不调 `GET /session/:id`：那是拿被测对象证明被测对象（`LEARNINGS #002-02`）。
 * 过一遍 `Schema` 而不是 `as`：`as` 会被 oxlint 的 `no-unsafe-type-assertion` 命中，
 * 而断言掉的形状是**假绿的来源**之一（形状变了断言照样过）。
 */
function storedRuleset(userId: string, sessionId: string): PermissionV1.Ruleset {
  const db = new Sqlite(path.join(DATA_ROOT, userId, "opencode.db"))
  try {
    const rows = db
      .query<{ permission: string }, [string]>("SELECT permission FROM session WHERE id = ?")
      .all(sessionId)
    // 「读到了但读的是另一条」与「没读到」都不许静默过去——不然后面的断言是在验空气。
    if (rows.length !== 1) throw new Error(`期望恰好一条会话行，实得 ${rows.length}`)
    return Schema.decodeUnknownSync(PermissionV1.Ruleset)(JSON.parse(rows[0].permission))
  } finally {
    db.close()
  }
}

const clientAllow = (resource: string): PermissionV1.Rule => ({ permission: "skill", pattern: resource, action: "allow" })

describe("T006 · capability 挂到会话上（真应用 + 真库）", () => {
  /**
   * 授过 `fund-analysis` ⇒ 会话里存的就是「**先整体 deny、后逐条 allow**」。
   *
   * 整组 `toEqual` 而不是「含某条」：顺序本身就是语义（链 A 取 `findLast`，后者胜），
   * 顺序反了这条必须红——只看「有没有那条 allow」的断言，正反两种顺序都绿。
   */
  it.live(
    "有授权 ⇒ 会话规则集 = 整体 deny ＋ 该条 allow（顺序即语义）",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(ALICE)

        const stored = storedRuleset(ALICE.id, id)
        expect(stored).toEqual([
          { permission: "skill", pattern: "*", action: "deny" },
          { permission: "skill", pattern: "fund-analysis", action: "allow" },
        ])

        // 拿**链 A 真正的判决器**问一次——这才是 T006 出参那句「越权调用被拒」。
        expect(evaluateV1("skill", "call-analysis", stored).action).toBe("deny")
        expect(evaluateV1("skill", "fund-analysis", stored).action).toBe("allow")
      }),
    30_000,
  )

  /**
   * 🔴 **客户端在创建请求里自带的 `permission` 压不过 capability。**
   *
   * `CreateInput.permission` 是客户端可填的（`packages/opencode/src/session/session.ts` 的
   * `CreateInput`）。若并入时客户端规则排在**后**，一条 `allow skill:*` 就能把 capability
   * 整个抹掉——**一次请求绕过 RBAC**，而且全程不报错。
   *
   * 断言刻意落在「真判决器怎么说」上（不是「列表里有没有 deny」）：这条要红的是
   * **生效顺序**，不是列表内容。
   */
  it.live(
    "客户端自带 allow skill:* ⇒ 压不过 capability（未授的 skill 仍被拒）",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(ALICE, { permission: [clientAllow("*")] })

        const stored = storedRuleset(ALICE.id, id)
        expect(evaluateV1("skill", "call-analysis", stored).action).toBe("deny")
        // 授过的那条照样 allow——并入不是覆盖。
        expect(evaluateV1("skill", "fund-analysis", stored).action).toBe("allow")
      }),
    30_000,
  )

  /**
   * **零授权 ⇒ 一条整体 deny，不是空集。**
   *
   * 空集意味着落回上游兜底的 `ask`，而链 A 的 skill 工具带 `always` ⇒ 界面上会多一个
   * 「总是允许」——没被授予的人**可以自己把自己批进去**。这条从库里读，验的是真的落库了。
   */
  it.live(
    "零授权 ⇒ 会话里仍有一条整体 deny（不是空集）",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(BOB)

        const stored = storedRuleset(BOB.id, id)
        expect(stored).toEqual([{ permission: "skill", pattern: "*", action: "deny" }])
        expect(evaluateV1("skill", "fund-analysis", stored).action).toBe("deny")
        expect(evaluateV1("skill", "fund-analysis", stored).action).not.toBe("ask")
      }),
    30_000,
  )
})

/**
 * **I3（2026-10-05）· 另外两条会写 `permission` 的路，此前零覆盖。**
 *
 * `POST /session`（上面那组）之外，链 A 还有**两处**能把规则写进会话：
 *
 * | 路径 | 定制点 | 曾经的覆盖 |
 * |---|---|---|
 * | `PATCH /session/:id` | `handlers/session.ts` 的 `update` 改用 `mergeClientRules` | **0** |
 * | `POST /session/:id/fork` | `Session.fork` 带上 `permission: original.permission` | **0** |
 *
 * 两处都是「改上游的一行」——把那一行删掉/写回上游写法，**全仓不会有任何测试变红**
 * （`LEARNINGS #002-06` 第三轮那条：修对了但没测试守着，等于随时可以被静默删掉）。本组就是
 * 那两个守门人：删掉任一处的定制，这里必红（**已用变异验证过**，见 `004/state.md`）。
 *
 * 断言照旧落在**真判决器**上（不是「列表里有没有某条」）：要红的是「客户端能不能压过
 * capability」和「派生会话有没有 capability」这两件**行为**。
 */
describe("I3 · 另外两条写 permission 的路径（真应用 + 真库）", () => {
  /**
   * 🔴 `PATCH /session/:id` 的 `permission` 是**客户端可填**的（`UpdatePayload.permission`）。
   * 上游那里是 `Permission.merge(current, payload)`——**拼接**，客户端规则在**后** ⇒
   * 一条 `allow skill:*` 就压过 capability。
   */
  it.live(
    "PATCH 带 allow skill:* ⇒ 压不过 capability（未授的仍被拒、授过的仍放行）",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(ALICE)

        const response = yield* as(ALICE, `/session/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ permission: [clientAllow("*")] }),
        })
        expect(response.status).toBe(200)

        const stored = storedRuleset(ALICE.id, id)
        expect(evaluateV1("skill", "call-analysis", stored).action).toBe("deny")
        expect(evaluateV1("skill", "fund-analysis", stored).action).toBe("allow")
      }),
    30_000,
  )

  /** 对照：没有客户端规则时，PATCH 别的字段**不动** `permission`（别把既有 capability 洗掉）。 */
  it.live(
    "PATCH 只改 title ⇒ permission 原样不动",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(ALICE)
        const before = storedRuleset(ALICE.id, id)

        const response = yield* as(ALICE, `/session/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "改个名" }),
        })
        expect(response.status).toBe(200)

        expect(storedRuleset(ALICE.id, id)).toEqual(before)
      }),
    30_000,
  )

  /**
   * 🔴 **fork 出来的会话必须继承源会话的 capability。**
   *
   * 上游 `Session.fork` 的 `createNext` **不带** `permission` ⇒ 派生会话没有服务端算好的规则集
   * ⇒ 落回上游兜底 `ask`，而 skill 工具带 `always` ⇒ **派生一下就把 RBAC 绕过去了**
   * （`POST /session/:id/fork` 是客户端可控的端点）。这条从库里读派生的那条会话。
   */
  it.live(
    "fork ⇒ 派生会话的规则集与源会话逐字相同（顺序也是语义）",
    () =>
      Effect.gen(function* () {
        const id = yield* createSessionAs(ALICE)

        const response = yield* as(ALICE, `/session/${id}/fork`, { method: "POST" })
        expect(response.status).toBe(200)
        const forked = (yield* json(SessionInfo, response)).id

        expect(forked).not.toBe(id)
        expect(storedRuleset(ALICE.id, forked)).toEqual(storedRuleset(ALICE.id, id))

        const stored = storedRuleset(ALICE.id, forked)
        expect(evaluateV1("skill", "call-analysis", stored).action).toBe("deny")
        expect(evaluateV1("skill", "fund-analysis", stored).action).toBe("allow")
      }),
    30_000,
  )
})
