import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { AccessSession } from "@opencode-ai/core/access/session"
import { UserIdentity } from "../../src/server/user-identity"
import { McpCatalog } from "../../src/mcp/catalog"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * T007 修正（**C1**，2026-10-05）· **命名前缀碰撞 ⇒ 拒绝建会话**（fail-closed 强制点）。
 *
 * ## 这条补的是哪个洞
 *
 * `AccessSession.namingConflicts`（core）只会**报**冲突，它拦不住任何人——判定的**后果**要由
 * 调用方承担。少了这一条，把 `access.ts` 里那次检查整段删掉，**全仓没有一条测试会红**：
 * core 的 8 条命名用例照绿（判定还在），mcp 的 11 条照绿（规则形状没变），
 * `openhive-access-mcp-wiring.test.ts` 也照绿（它的配置**不碰撞**）。
 * 而漏掉检查的后果是**授权随配置键序漂移**，不报错、不变红
 * （实证见 `openhive-access-mcp.test.ts` 那条「键序一换结论就翻」）。
 *
 * ## 判据
 *
 * 只问一件事：**这个请求有没有被拒**。不去断言错误文案（文案会漂，判据不该跟着漂）。
 * 「≥500」而不是「== 500」：本层只承诺「不是成功」，具体状态码归 HTTP 中间件定——
 * 把它钉死在 500 上等于把这条测试绑到中间件的实现细节（`LEARNINGS #003-05` 的反面：判据要
 * 对着**本层**的行为写，不要镜像下游）。
 *
 * ## 不碰撞的对照在哪
 *
 * `openhive-access-mcp-wiring.test.ts` —— 那边配了**两个不碰撞**的 server，`POST /session`
 * 必须**成功**（200）且两边的规则都落库。两条测试合起来才排掉「凡是多 server 就拒」这种
 * 看似 fail-closed、实则没用的实现。**改这条文件时别把那边删了**。
 *
 * ## 夹具
 *
 * 与 `openhive-access-mcp-wiring.test.ts` 同款（真应用 + 真 auth 库 + `process.env` 注入配置）。
 * ⚠️ 配置只能走 `process.env.OPENCODE_CONFIG_CONTENT`（`src/config/config.ts` 读的是
 * `process.env`，不是 Effect 的 `ConfigProvider`），而它是**进程级**的 ⇒ 一个测试文件只能有
 * **一份**配置 ⇒ 碰撞那只夹具必须单开一个文件（就是本文件）。
 */

const it = testEffect(Layer.empty)

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const ALICE: TokenSubject = {
  id: "880e8400-e29b-41d4-a716-446655440003",
  policeNo: "020604",
  name: "赵六",
  isAdmin: false,
}

const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-access-naming-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

/**
 * 🔴 **两个互相覆盖的 server 名**：`fund.db` → `fund_db_*`，`fund.db.prod` → `fund_db_prod_*`，
 * 前者是后者的前缀 ⇒ 工具名 `fund_db_prod_query` 同时命中两条（见 `openhive-access-mcp.test.ts`
 * 的实证）。URL 指到 discard 端口 `9`，万一真去连也拒绝得快。
 */
const COLLIDING = {
  "fund.db": { type: "remote", url: "http://127.0.0.1:9/" },
  "fund.db.prod": { type: "remote", url: "http://127.0.0.1:9/" },
} as const

const previousConfigContent = process.env.OPENCODE_CONFIG_CONTENT
process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ mcp: COLLIDING })

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

  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values (${ALICE.id}, '020604', '赵六', 'x', 'x', 'x', 'x', 'x', 0, 'h', 0)
  `)
  await pg.db.execute(sql`insert into auth.role (id, name) values ('r_analyst', '研判员')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ALICE.id}, 'r_analyst')`)
  // 有一条授权行：这样这次请求**不会**在「查授权」那一步失败 ⇒ 红/绿的唯一来源是命名检查。
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

const openApp = (() => {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(OPEN)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
})()

const token = (subject: TokenSubject) => Effect.promise(() => signToken(subject, SECRET))

const postSessionAs = (subject: TokenSubject) =>
  Effect.gen(function* () {
    const headers = new Headers()
    headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp("/session", { method: "POST", headers })
  })

describe("T007/C1 · 配置里的 server 名互相覆盖 ⇒ 拒绝建会话（fail-closed）", () => {
  /**
   * 🔴 **夹具自证**：先证明「这两个名字真的撞」，再去断行为。
   *
   * 少了这半，一个把配置写错（比如两个名字根本不会碰撞）的夹具会让下面那条**因为错误的理由**
   * 变绿或变红。翻译走**真函数** `McpCatalog.toolName`——与 `access.ts` 用的是同一个，
   * 不是这里复刻的镜像（`LEARNINGS #003-05`）。
   */
  test("夹具自证：这两个名字经真翻译后确实互为前缀", () => {
    const servers = Object.keys(COLLIDING).map((server) => ({
      server,
      toolPattern: McpCatalog.toolName(server, "") + "*",
    }))

    expect(servers.map((naming) => naming.toolPattern).sort()).toEqual(["fund_db_*", "fund_db_prod_*"])
    expect(AccessSession.namingConflicts(servers)).toEqual([["fund.db", "fund.db.prod"]])
  })

  /**
   * 🔴 **本文件的主角**：碰撞 ⇒ 请求**必须失败**。
   *
   * 为什么是拒绝而不是「挑一个顺序」：撞键的两个 server 里**总有一个的工具被另一个的规则罩住**
   * （要么误 deny、要么误 allow），换个顺序只是换个受害者，且全程不报错、不变红。
   * 拒掉把问题推回**配置期**——这是配置错误，不是运行时能自己治好的一件事。
   */
  it.live(
    "碰撞的名单 ⇒ POST /session 不是成功（拒绝建会话，不落一条顺序靠运气的会话）",
    () =>
      Effect.gen(function* () {
        const response = yield* postSessionAs(ALICE)

        expect(response.status).toBeGreaterThanOrEqual(500)
      }),
    30_000,
  )
})
