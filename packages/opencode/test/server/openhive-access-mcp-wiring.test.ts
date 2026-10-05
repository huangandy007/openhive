import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { ConfigProvider } from "effect"
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
 * T007（FR-005）· **接线**：capability 里的 mcp 那一半，**从配置里读 server 名单**。
 *
 * ## 为什么必须有这一条
 *
 * 纯函数那一半（`openhive-access-mcp.test.ts`）验的是「**给了名字**怎么拼规则」，它拿的是
 * **手写的**已翻译名字。于是有一整段完全没人守：名单**从哪来**、名字**由谁翻译**。
 * 把 `capabilityFor` 里读 `Config.mcp` 那两行删掉、或把翻译写成 `server + "_*"`（不 sanitize），
 * 纯函数那 10 条**一条都不会红**（`LEARNINGS #002-02`：没真正执行被测路径的测试不是测试）。
 *
 * ## 判据不经过被测接口
 *
 * 与 T006 的接线测试同款：会话建完之后 `permission` **直接从库文件读**，再拿**链 A 真正的
 * 判决器** `evaluate` 问「这个 server 的工具放不放」。
 *
 * ## 为什么 server 名故意带一个点（`fund.db`）
 *
 * 因为本文件要同时钉住**两套名字的两种翻译**（`McpCatalog.toolName` 用的是
 * `sanitize(server) + "_" + sanitize(name)`，而资源 pattern 用的是**原样** server 名）：
 * 名字里没有非法字符时，`sanitize` 是恒等函数 ⇒ 写错也看不出来。`fund.db` 让
 * `fund_db_*`（翻译后）与 `mcp:fund.db:*`（原样）在断言里**必须**长得不一样。
 *
 * ## 为什么这里也要一个真 auth 库
 *
 * 与 `openhive-access-wiring.test.ts` 同因：门开着时 `POST /session` 会按身份查
 * `auth.role_resource`（`@/server/openhive/access`），查不到就不建会话（fail-closed）。
 * 夹具必须**文件级**（理由写在那条文件的头上）。
 */

const it = testEffect(Layer.empty)

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = {
  id: "770e8400-e29b-41d4-a716-446655440002",
  policeNo: "020603",
  name: "王五",
  isAdmin: false,
}

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-access-mcp-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/**
 * 配**两个互不覆盖**的 MCP server——这就是「名单从哪来」的那个 `Config.mcp`。
 *
 * ⚠️ 名字带点（见文件头）。URL 指到 discard 端口（`9`）：万一有别的路径真的去连它，
 * 拒绝得也快（`127.0.0.1` 上没人听），不会把测试挂住。
 *
 * 🔴 **为什么是「两个」而不是一个**（2026-10-05 加）：C1 的 fail-closed 检查
 * （`packages/opencode/src/server/openhive/access.ts`，碰撞即拒绝建会话）需要一个**反向对照**——
 * 一个「凡是多 server 就拒」的实现看着也 fail-closed，却会让真实部署一个 server 都配不了。
 * `fund_db_*` 与 `call_db_*` 互不为前缀 ⇒ 这条请求**必须成功**。配对的那条（碰撞 ⇒ 拒绝）在
 * `openhive-access-naming.test.ts`。**两条要一起看**，删了任何一条，另一半的结论都不成立。
 *
 * `Config` 读的是 **`process.env`**（`src/config/config.ts`：`if (process.env.OPENCODE_CONFIG_CONTENT)`），
 * 不是 Effect 的 `ConfigProvider`——所以这里和 `OPENHIVE_DATA_ROOT` 一样只能走 `process.env`，
 * 并在 `afterAll` 还原（这个进程里还有别的测试文件要读自己的配置）。
 */
const previousConfigContent = process.env.OPENCODE_CONFIG_CONTENT
process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
  mcp: {
    "fund.db": { type: "remote", url: "http://127.0.0.1:9/" },
    "call.db": { type: "remote", url: "http://127.0.0.1:9/" },
  },
})

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

afterAll(() => {
  if (previousConfigContent === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
  else process.env.OPENCODE_CONFIG_CONTENT = previousConfigContent
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

  // ALICE：一条 skill 读授权（顺手钉住「mcp 与 skill 共存」），**没有** mcp 授权行。
  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values (${ALICE.id}, '020603', '王五', 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
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

const as = (subject: TokenSubject, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(cookie(yield* token(subject)))) headers.set(key, value)
    return yield* openApp(url, { ...init, headers })
  })

/** 直接读库文件里这条会话的 `permission` 列（不调 `GET /session/:id`：那是拿被测对象证明被测对象）。 */
function storedRuleset(userId: string, sessionId: string): PermissionV1.Ruleset {
  const db = new Sqlite(path.join(DATA_ROOT, userId, "opencode.db"))
  try {
    const rows = db
      .query<{ permission: string }, [string]>("SELECT permission FROM session WHERE id = ?")
      .all(sessionId)
    if (rows.length !== 1) throw new Error(`期望恰好一条会话行，实得 ${rows.length}`)
    return Schema.decodeUnknownSync(PermissionV1.Ruleset)(JSON.parse(rows[0].permission))
  } finally {
    db.close()
  }
}

describe("T007 · 配置里的 MCP server 进了 capability（真应用 + 真库）", () => {
  /**
   * 🔴 **整组 `toEqual`，不是「含某条」**——四件事同时在一条断言里：
   * ① mcp 那两条**真的被铺上了**（读到了 `Config.mcp`）；
   * ② 工具前缀是**翻译过**的 `fund_db_*`（不是 `fund.db_*`）⇒ 证明走的是 `McpCatalog.sanitize`；
   * ③ 资源 pattern 是**原样**的 `mcp:fund.db:*` ⇒ 证明两套名字分别翻译；
   * ④ 顺序：整体 deny 在前、mcp 在中、skill 的 allow 在后（链 A 取 `findLast`，顺序即语义）。
   *
   * 🔴 **两个 server 都要出现**（C1 的反向对照，见文件头）：`fund_db_*` 与 `call_db_*` 互不为前缀
   * ⇒ 检查放行、两个各出一对规则。只断言 `fund.db` 的话，一个「只认第一个 server」的实现照样绿。
   */
  it.live(
    "配了两个不碰撞的 server 且没授权 ⇒ 请求成功、两个各出一对 deny（工具前缀已 sanitize、资源用原样名）",
    () =>
      Effect.gen(function* () {
        const response = yield* as(ALICE, "/session", { method: "POST" })
        expect(response.status).toBe(200)
        const id = (yield* Effect.map(Effect.promise(() => response.json()), (body) =>
          Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(body),
        )).id

        const stored = storedRuleset(ALICE.id, id)
        expect(stored).toEqual([
          { permission: "skill", pattern: "*", action: "deny" },
          { permission: "fund_db_*", pattern: "*", action: "deny" },
          { permission: "read", pattern: "mcp:fund.db:*", action: "deny" },
          { permission: "call_db_*", pattern: "*", action: "deny" },
          { permission: "read", pattern: "mcp:call.db:*", action: "deny" },
          { permission: "skill", pattern: "fund-analysis", action: "allow" },
        ])

        // 拿**链 A 真正的判决器**问一次——这才是本 task 出参那句「受限执行」。
        expect(evaluateV1("fund_db_query", "*", stored).action).toBe("deny")
        expect(evaluateV1("read", "mcp:fund.db:ledger", stored).action).toBe("deny")
        expect(evaluateV1("call_db_query", "*", stored).action).toBe("deny")
        expect(evaluateV1("read", "mcp:call.db:ledger", stored).action).toBe("deny")
        // 授过的 skill 照旧放行（并入不是覆盖）。
        expect(evaluateV1("skill", "fund-analysis", stored).action).toBe("allow")
        // 文件读取不受影响（资源那条 deny 只锚着一个 server）。
        expect(evaluateV1("read", "src/index.ts", stored).action).not.toBe("deny")
      }),
    30_000,
  )
})
