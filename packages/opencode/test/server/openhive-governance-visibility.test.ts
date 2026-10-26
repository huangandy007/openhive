/**
 * 010 T014 · 可见面（导航收敛）：`/me` 回给两类管理员的板块集（SC-002 / T003）
 *
 * 三件事：
 * ① 两身份各**恰好**是自己的那几项（顺序也钉住，`toEqual`）；
 * ② **交集**恰好是 `["asset-governance"]`；
 * ③ **并集**恰好是全部八页。
 *
 * ②③ 是关系断言：各板块自己的测试和 `openhive-governance-split.test.ts` 的读矩阵只保证
 * 「格子没坏」，抓不住「一边加一页、另一边删一页」这种两端同时动、单看各自都还说得通的漂移。
 *
 * ## 为什么这个文件**只**调 `/me`
 *
 * `/me` 走**网关池**，治理出口走**治理池**。两个客户端在同一 PGlite 实例（`startProductionDb`）
 * 上准备同一句 `select … from "auth"."user" where "auth"."user"."id" = $1` 会撞
 * `42P05 duplicate_prepared_statement`（`test-support.ts:67` 记了这条夹具硬约束），
 * 表现为**本进程里第一个治理读请求 500**。
 *
 * 本文件是 T014 交付后补的修正：当时可见面与读矩阵同处一文件，那一格 500 被「非 403」
 * 的放行断言吞掉（`#005-47` 的假绿）。现在可见面单独一套夹具、只走网关池；
 * 治理出口的矩阵在 `openhive-governance-split.test.ts`，那边不调 `/me`。
 */

import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const SECRET = "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8"

/** 系统管理员：6 板块（账号 / 组织 / 资产治理 / 用量 / 审计 / 数据源）。 */
const ADMIN: TokenSubject = {
  id: "bbbbbbbb-2222-4222-8222-222222222222",
  policeNo: "940001",
  name: "可见面系统管理员",
  isAdmin: true,
}
/** 业务专家：3 板块（资产治理 / 模板库 / 数据项目权限）。 */
const EXPERT: TokenSubject = {
  id: "dddddddd-4444-4444-8444-444444444444",
  policeNo: "940002",
  name: "可见面业务专家",
  isAdmin: true,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const ME = "/openhive/auth/me"

/** 八页全集，顺序跟导航注册表一致（`src/governance/sections.ts`）。 */
const 全部板块 = [
  "account-manage",
  "org-tree",
  "asset-governance",
  "template-lib",
  "data-project-perm",
  "usage-cost",
  "audit-log",
  "data-source",
] as const

/**
 * 期望网格：**字面量**，不 import `auth/src/governance.ts` 的模板。
 * 顺序与 `/me` 的投影顺序相同（模板里 grant 的首次出现序），`toEqual` 因此也钉顺序。
 */
const 系统管理员期望 = ["account-manage", "org-tree", "asset-governance", "usage-cost", "audit-log", "data-source"]
const 业务专家期望 = ["asset-governance", "template-lib", "data-project-perm"]

const SANDBOX = mkdtempSync(join(tmpdir(), "openhive-governance-visibility-"))
const WORKSPACE_ROOT = join(SANDBOX, "workspaces")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = join(SANDBOX, "data")

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
// 同族文件一致：PGlite 的 socket 服务把多条连接汇进同一个 PG 会话，第二条连接再准备
// 同名语句会撞 `42P05`（`pg.ts` 文件头记过），故池只留一条。
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {} // Windows 上句柄可能仍被持有，清理失败不该变成测试失败
})

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)

  for (const subject of [ADMIN, EXPERT]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '可见面单位', '可见面部门', '可见面科室',
              ${1}, ${subject.isAdmin ? 1 : 0}, 'h', 0)
    `)
  }
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${ADMIN.id}, 'gov-system-admin')`)
  await pg.db.execute(sql`insert into auth.user_role (user_id, role_id) values (${EXPERT.id}, 'gov-business-expert')`)
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
  OPENHIVE_SHARED_ROOT: join(SANDBOX, "shared"),
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

const 请求 = (subject: TokenSubject | null, url: string) =>
  Effect.gen(function* () {
    const headers = new Headers()
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* Effect.promise(() => signToken(subject, SECRET))}`)
    return yield* openApp(url, { headers })
  })

/** 会话回包只取 `governance` 一段：多出来的字段（比如把 `token` 顺带透出去）不该管这里。 */
const 会话自查 = Schema.Struct({ governance: Schema.optional(Schema.Array(Schema.String)) })

const 板块集 = (subject: TokenSubject) =>
  Effect.gen(function* () {
    const response = yield* 请求(subject, ME)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = yield* Effect.promise(() => response.text())
    return Schema.decodeUnknownSync(会话自查)(JSON.parse(body)).governance ?? []
  })

describe("T014 · 可见面（导航收敛）", () => {
  it.live("无凭证 ⇒ 401：下面两条 200 不是「谁都能读」", () =>
    Effect.gen(function* () {
      expect((yield* 请求(null, ME)).status).toBe(401)
    }),
  )

  it.live("/me 给两类管理员各自的板块集：交集只有 AI 资产治理、并集是全部八页", () =>
    Effect.gen(function* () {
      const 甲 = yield* 板块集(ADMIN)
      const 乙 = yield* 板块集(EXPERT)

      expect(甲).toEqual(系统管理员期望)
      expect(乙).toEqual(业务专家期望)

      // 关系断言：各自数组「改了但看起来还像」时，这两条先红。
      const 交集 = 甲.filter((id) => 乙.includes(id))
      expect(交集).toEqual(["asset-governance"])
      const 并集 = [...new Set([...甲, ...乙])].sort()
      expect(并集).toEqual([...全部板块].sort())
    }),
  )
})
