import { afterAll, beforeAll, describe, expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { UserIdentity } from "../../src/server/user-identity"
import { testEffect } from "../lib/effect"
import { 建实体 } from "./openhive-case-fact-fixture"

/**
 * 纠错出口的真应用测试（计划 5）。夹具与 `openhive-case-materials.test.ts` 逐行一致：
 * `HttpRouter.toWebHandler` ＋ `ConfigProvider` ＋ **Cookie 身份**（不是 Bearer）。
 *
 * 夹具只在这里写一次；Task 3 / 4 / 6 / 7 往本文件**追加** describe 段。
 *
 * ⚠️ 测试自己发的 SQL 文本必须与出口 DAO 的 SQL 不同（PGlite 连接级语句缓存，42P05）。
 */
const test = testEffect(Layer.empty)
const it = test.live
const SECRET = "f4a5c6t7r8u9s0t1e2s3t4a5b6c7d8e9"

const 我: TokenSubject = { id: "u-纠错-我", policeNo: "970011", name: "甲民警", isAdmin: false }
const 别人: TokenSubject = { id: "u-纠错-别", policeNo: "970012", name: "乙民警", isAdmin: false }
const 项目 = "p-纠错-我的"
const 别人的项目 = "p-纠错-别人的"

const 沙箱根 = mkdtempSync(join(tmpdir(), "openhive-case-facts-"))
const restoreWs = restorePoint({ OPENHIVE_WORKSPACE_ROOT: 沙箱根 })
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })
const restoreWorker = restorePoint({ OPENHIVE_CASE_INGEST_WORKER: "0" })

afterAll(restoreWs)
afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)
afterAll(restoreWorker)
afterAll(() => rmSync(沙箱根, { recursive: true, force: true }))

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  for (const subject of [我, 别人]) {
    await pg.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
      values (${subject.id}, ${subject.policeNo}, ${subject.name}, 'x', 'x', '基座单位', '经侦支队', '基座科室', 1, 0, 'h', 0)
    `)
  }
  // 成员关系是 200 的前提：`成员角色` 只认 `project_member` 与每用户库里的老项目属主；
  // 不种这一行，除 401/403 的用例外，其余全部会掉进 403。
  await pg.db.execute(sql`
    insert into auth.project_member (project_id, user_id, role, time_created)
    values (${项目}, ${我.id}, 'owner', 0),
           (${别人的项目}, ${别人.id}, 'owner', 0)
  `)
  await 建实体(pg.db, { id: "e-路由", projectId: 项目, value: "王五" })
  await 建实体(pg.db, { id: "e-别人", projectId: 别人的项目, value: "赵六" })
})

afterAll(async () => {
  await pg?.stop()
})

const OPEN: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: 沙箱根,
}

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

/** 身份走 **Cookie**（`UserIdentity.COOKIE_NAME`），不是 `Authorization: Bearer`。 */
const 发 = (subject: TokenSubject | null, url: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const headers = new Headers(init.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const 发体 = (subject: TokenSubject | null, url: string, body: unknown) =>
  发(subject, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

/** 读回 JSON 体：`yield* 读回<{ code: string }>(响应)`。 */
const 读回 = <T>(响应: Response) => Effect.promise(() => 响应.json() as Promise<T>)

describe("GET /openhive/case/facts", () => {
  it("没登录 ⇒ 401", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(null, `/openhive/case/facts?projectId=${项目}&type=entity&id=e-路由`)
      expect(响应.status).toBe(401)
    }),
  )

  it("不是成员 ⇒ 403", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(我, `/openhive/case/facts?projectId=${别人的项目}&type=entity&id=e-别人`)
      expect(响应.status).toBe(403)
    }),
  )

  it("type 不是三种之一 ⇒ 400", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(我, `/openhive/case/facts?projectId=${项目}&type=row&id=e-路由`)
      expect(响应.status).toBe(400)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("bad_request")
    }),
  )

  it("找不到 ⇒ 404 fact_not_found", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(我, `/openhive/case/facts?projectId=${项目}&type=entity&id=e-无`)
      expect(响应.status).toBe(404)
      expect((yield* 读回<{ code: string }>(响应)).code).toBe("fact_not_found")
    }),
  )

  it("成员读自己的项目 ⇒ 200，回包里带引用与变更历史", () =>
    Effect.gen(function* () {
      const 响应 = yield* 发(我, `/openhive/case/facts?projectId=${项目}&type=entity&id=e-路由`)
      expect(响应.status).toBe(200)
      const 体 = yield* 读回<{
        type: string
        canonicalValue: string
        citations: unknown[]
        changes: unknown[]
      }>(响应)
      expect(体.type).toBe("entity")
      expect(体.canonicalValue).toBe("王五")
      expect(Array.isArray(体.citations)).toBe(true)
      expect(Array.isArray(体.changes)).toBe(true)
    }),
  )
})
