import { afterAll, beforeAll, describe, expect } from "bun:test"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV } from "@opencode-ai/auth/policy"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint } from "@opencode-ai/auth/test-support"
import { startProductionDb } from "@opencode-ai/auth/test-support"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { UserIdentity } from "../../src/server/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * 需求 6 · 账号偏好出口（`GET/PUT /openhive/preferences`）。
 *
 * 判据：写进去的每页条数**换一个请求读得回来**（跨设备一致的意义就在这里）；未知键与非法
 * 条数一律 400；没登录 401。闭集在出口收窄：库只管列，不管「客户端传的这个词合不合法」。
 */

const it = testEffect(Layer.empty)

const SECRET = "b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6"

const ME: TokenSubject = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  policeNo: "940001",
  name: "民警戊",
  isAdmin: false,
}

/** 客户端契约：**写字面量，不 import 生产常量**（`#003-05`）。 */
const PREFS = "/openhive/preferences"

const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: DEPLOYED_DEFAULT_PASSWORD })
const restorePoolMax = restorePoint({ PG_POOL_MAX: "1" })

afterAll(restoreDefaultPassword)
afterAll(restorePoolMax)

let pg: Awaited<ReturnType<typeof startProductionDb>> | undefined

beforeAll(async () => {
  pg = await startProductionDb()
  await migrate(pg.db)
  await pg.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, is_admin, password_hash, created_at)
    values (${ME.id}, ${ME.policeNo}, ${ME.name}, 'x', 'x', '基座单位', '甲部门', '基座科室', 1, 0, 'h', 0)
  `)
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

const as = (subject: TokenSubject | null, url: string, init?: RequestInit) =>
  Effect.gen(function* () {
    const headers = new Headers(init?.headers)
    if (subject) headers.set("Cookie", `${UserIdentity.COOKIE_NAME}=${yield* token(subject)}`)
    return yield* openApp(url, { ...init, headers })
  })

const get = (subject: TokenSubject | null, url: string) => as(subject, url)
const put = (subject: TokenSubject | null, url: string, body: unknown) =>
  as(subject, url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const 偏好 = Schema.Struct({ preferences: Schema.Record(Schema.String, Schema.String) })
const 错误 = Schema.Struct({ error: Schema.String })

const json = <A>(schema: Schema.Codec<A>, response: Response) =>
  Effect.gen(function* () {
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    return Schema.decodeUnknownSync(schema)(JSON.parse(yield* Effect.promise(() => response.text())))
  })

describe("需求 6 · 账号偏好出口", () => {
  it.live("无凭证 ⇒ 401", () =>
    Effect.gen(function* () {
      expect((yield* get(null, PREFS)).status).toBe(401)
      expect((yield* put(null, PREFS, { key: "asset.pageSize", value: "50" })).status).toBe(401)
    }),
  )

  it.live("未写过 ⇒ 空对象（不是默认值伪装成已存）", () =>
    Effect.gen(function* () {
      const 空 = yield* json(偏好, yield* get(ME, PREFS))
      expect(空.preferences).toEqual({})
    }),
  )

  it.live("写进去的每页条数，换一个请求读得回来", () =>
    Effect.gen(function* () {
      const 写 = yield* put(ME, PREFS, { key: "asset.pageSize", value: "50" })
      expect(写.status).toBe(200)
      expect((yield* json(偏好, 写)).preferences["asset.pageSize"]).toBe("50")

      const 读 = yield* json(偏好, yield* get(ME, PREFS))
      expect(读.preferences["asset.pageSize"]).toBe("50")
    }),
  )

  it.live("未知键 ⇒ 400；条数不在白名单 ⇒ 400；值不落库", () =>
    Effect.gen(function* () {
      const 未知 = yield* put(ME, PREFS, { key: "asset.unknown", value: "1" })
      expect(未知.status).toBe(400)
      expect((yield* json(错误, 未知)).error).toContain("偏好键")

      for (const bad of ["999", "0", "abc", "50.5"]) {
        const 响应 = yield* put(ME, PREFS, { key: "asset.pageSize", value: bad })
        expect(响应.status).toBe(400)
      }

      // 上面几次 400 之后，之前写成功的 50 仍在，没被坏值顶掉。
      expect((yield* json(偏好, yield* get(ME, PREFS))).preferences["asset.pageSize"]).toBe("50")
    }),
  )

  it.live("请求体不是对象 / 缺字段 ⇒ 400", () =>
    Effect.gen(function* () {
      expect((yield* put(ME, PREFS, [])).status).toBe(400)
      expect((yield* put(ME, PREFS, { key: "asset.pageSize" })).status).toBe(400)
      expect((yield* put(ME, PREFS, { value: "50" })).status).toBe(400)
    }),
  )
})
