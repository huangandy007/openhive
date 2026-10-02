import { afterAll, describe, expect } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { existsSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { Database } from "@opencode-ai/core/database/database"
import { DatabaseRouter } from "@opencode-ai/core/database/router"
import { UserIdentity } from "../../src/server/user-identity"
import { userIdentityLayer } from "../../src/server/routes/instance/httpapi/middleware/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

/**
 * ⚠️ **T020 遗留的修补（2026-10-01，T023 期间发现）**：同 `tenant-db-isolation.test.ts` 与
 * `tenant-directory-isolation.test.ts` 上那两条注释——T020 把 `defaultPassword(process.env)`
 * 放进了网关的层构造期且选定「缺失即抛」，于是**任何建真应用（`HttpApiApp.routes`）的测试，
 * 都必须像一次真部署那样把口令配上**。本文件下面那条「门开着服务真应用路由」正是这种测试。
 *
 * ⚠️ **本条是 T021 那笔修补漏掉的第三处**：T021 修了 T012 / T013 两个文件，但**没有 grep
 * 「还有谁在同一个前提下」**（`LEARNINGS #002-06`），于是这一处一直红着。它的**绿取决于跑它
 * 的那个 shell 有没有碰巧设了 `OPENHIVE_DEFAULT_PASSWORD`**——本机实测：不设 = 1 fail、
 * 设了 = 2 pass。这正是最该被消灭的形态：门禁的绿取决于环境，而门禁自己不会报这件事。
 *
 * 为什么走 `process.env` 而不是下面 `on()` 那个 `ConfigProvider`：网关读的是 `process.env`，
 * 塞进 `ConfigProvider` 会被**无声忽略**（同另两处的注释）。
 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })

afterAll(restoreDefaultPassword)

const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
const SUBJECT: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "020601",
  name: "张三",
  isAdmin: false,
}

const userDb = (root: string, userId: string) => path.join(root, userId, "opencode.db")

/** 直接读库文件里的 `probe` 表。**不经过我们自己的代码**——否则是拿被测对象证明被测对象。 */
function probeValues(file: string): string[] {
  if (!existsSync(file)) return []
  const db = new Sqlite(file)
  try {
    const rows = db.query<{ v: string }, []>("SELECT v FROM probe ORDER BY v").all()
    return rows.map((row) => row.v)
  } catch {
    return [] // 表不存在
  } finally {
    db.close()
  }
}

const withTmp = <A, E>(f: (tmp: string) => Effect.Effect<A, E>) =>
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(path.join(tmpdir(), "openhive-routing-"))),
    // Windows 上 SQLite 的 `-wal`/`-shm` 句柄在层关闭前仍被持有，`rm` 会 EBUSY。
    // 清不掉就留给系统——**清理失败不该变成测试失败**，那与被测对象无关。
    (tmp) =>
      Effect.sync(() => {
        try {
          rmSync(tmp, { recursive: true, force: true })
        } catch {}
      }),
  ).pipe(Effect.flatMap(f))

/**
 * 最小应用：**一条通配路由 + 身份门**，路由体做一次真实的 db 写。
 *
 * 装法与 `realApp` 一致（门套在路由之上），但落点可断言——真应用的路由是固定的，
 * 没法在里面塞一条「往 probe 表写一行」的探针。真应用的**接线**由本文件末尾那组守卫
 * （门开时缺层依赖会直接构建失败）。
 */
function app(config: Layer.Layer<UserIdentity.Config>, root: string, mainFile: string) {
  // 把层构造期的 `db` 送进请求。**请求 fiber 的 context 里没有 app 层服务**（实测：
  // 直接写 `yield* Database.Service` 得到 `Service not found`），所以真实 handler 只能在
  // 层构造期取、请求期用闭包（`handlers/sync.ts`）。这里用中间件送，是为了让路由体保持
  // 「请求期取 db」的形状——**与产品代码里那个身份中间件的形状同构**。
  const dbIntoRequest = HttpRouter.middleware<{ requires: Database.Service; handles: unknown }>()(
    Effect.gen(function* () {
      const database = yield* Database.Service
      return (effect) => Effect.provideService(effect, Database.Service, database)
    }),
  ).layer

  const handler = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      router.add("GET", "/*", () =>
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          yield* db.run(sql`CREATE TABLE IF NOT EXISTS probe (v TEXT)`).pipe(Effect.orDie)
          yield* db.run(sql`INSERT INTO probe (v) VALUES ('hive')`).pipe(Effect.orDie)
          return HttpServerResponse.jsonUnsafe({ ok: true })
        }),
      ),
    ).pipe(
      Layer.provide(
        userIdentityLayer.pipe(Layer.provide(config), Layer.provide(DatabaseRouter.layer({ root }))),
      ),
      Layer.provide(dbIntoRequest),
      Layer.provide(Database.layerFromPath(mainFile)),
    ),
    { disableLogger: true },
  ).handler

  return (init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL("/probe", "http://localhost"), init), HttpApiApp.context)),
    )
}

const on = () => UserIdentity.Config.configLayer({ required: true, secret: Option.some(SECRET) })
const token = (subject = SUBJECT) => Effect.promise(() => signToken(subject, SECRET))

describe("身份 → db 落点（T005 接进请求路径）", () => {
  it.live(
    "开着门：带合法令牌的请求，db 查询落到该用户自己的库文件，主树一个都不落",
    () =>
      withTmp((tmp) =>
        Effect.gen(function* () {
          const root = path.join(tmp, "data")
          const mainFile = path.join(tmp, "main.db")

          const response = yield* app(on(), root, mainFile)({
            headers: { Cookie: `${UserIdentity.COOKIE_NAME}=${yield* token()}` },
          })

          expect(response.status).toBe(200)
          expect(probeValues(userDb(root, SUBJECT.id))).toEqual(["hive"])
          // 主树那份**不该**收到任何一条——否则就是「路由没生效、只是额外多写了一份」
          expect(probeValues(mainFile)).toEqual([])
        }),
      ),
    20_000,
  )
})

// 快照守卫：真应用（`HttpApiApp.routes`）在**开着门**时也必须能构建。
// 中间件从层里取 `DatabaseRouter.Service`，而那条 `Layer.provide` 在 `server.ts` 里——
// 少了它，这组会以「层依赖未满足」直接炸，而不是悄悄回退。
describe("真应用的接线", () => {
  it.live("门开着服务真应用路由", () =>
    Effect.gen(function* () {
      const handler = HttpRouter.toWebHandler(
        HttpApiApp.routes.pipe(
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ OPENHIVE_REQUIRE_USER_ID: "1", AUTH_JWT_SECRET: SECRET }),
            ),
          ),
        ),
        { disableLogger: false },
      ).handler

      const cookie = `${UserIdentity.COOKIE_NAME}=${yield* token()}`
      const response = yield* Effect.promise(() =>
        Promise.resolve(
          handler(
            new Request(new URL("/session/ses_x", "http://localhost"), { headers: { Cookie: cookie } }),
            HttpApiApp.context,
          ),
        ),
      )

      expect(response.status).not.toBe(401)
    }),
  )
})
