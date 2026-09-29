import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { UserIdentity } from "../../src/server/user-identity"
import { userIdentityLayer } from "../../src/server/routes/instance/httpapi/middleware/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

/**
 * 最小应用：一条通配路由 + 身份门。**只测门**，不牵扯真实路由树——
 * 门是全局中间件（同 `corsVaryFix` 的装法），套住什么路由与它无关。
 */
function app(config: Layer.Layer<UserIdentity.Config>) {
  const handler = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      router.add("GET", "/*", () => Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true }))),
    ).pipe(Layer.provide(userIdentityLayer.pipe(Layer.provide(config)))),
    { disableLogger: true },
  ).handler

  return (path: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(path, "http://localhost"), init), HttpApiApp.context)),
    )
}

/**
 * **真应用**（`HttpApiApp.routes`）+ 指定的环境变量。上面那个 `app()` 只搭了最小路由，
 * 门没接进 `createRoutes` 也照样绿——所以要有一条走真实装法的，否则测的是孤儿文件。
 */
function realApp(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler

  return (path: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(path, "http://localhost"), init), HttpApiApp.context)),
    )
}

const OFF = UserIdentity.Config.configLayer({ required: false })
const ON = UserIdentity.Config.configLayer({ required: true })

describe("openhive 身份门（T018）", () => {
  it.live("开关关（默认）：不带头也放行——今天所有客户端都不发这个头，关着才是零回归", () =>
    Effect.gen(function* () {
      const response = yield* app(OFF)("/session")

      expect(response.status).toBe(200)
    }),
  )

  it.live("开关开：没有 X-User-ID 一律拒绝", () =>
    Effect.gen(function* () {
      const response = yield* app(ON)("/session")

      expect(response.status).toBe(401)
    }),
  )

  it.live("开关开：带了 X-User-ID 就放行", () =>
    Effect.gen(function* () {
      const response = yield* app(ON)("/session", { headers: { "X-User-ID": "u_000123" } })

      expect(response.status).toBe(200)
    }),
  )

  // 网关注入链路坏掉时送的是空白，不是「没有这个头」。放行等于给下游一个**空身份**，
  // 而空身份在 F3 会被当成一个合法的路由键——宁可当场 401。
  //
  // 这条钉的是「空串也算没有」：HTTP 层把 `"   "` 规整成 `""`（见实现注释），所以门必须用
  // `!userId` 而不是 `userId === undefined`——后者会把这个空身份放行。**变异验证**：把判据换成
  // `=== undefined` → 本条红（另有一条 no-该头 的用例仍绿），即它确实只由这条覆盖。
  it.live("开关开：空白 X-User-ID 按没有处理", () =>
    Effect.gen(function* () {
      const response = yield* app(ON)("/session", { headers: { "X-User-ID": "   " } })

      expect(response.status).toBe(401)
    }),
  )

  it.live("开关开：带上拒绝时不给 www-authenticate——那是给浏览器弹 Basic 登录框用的，这里没有 Basic", () =>
    Effect.gen(function* () {
      const response = yield* app(ON)("/session")

      expect(response.headers.get("www-authenticate")).toBeNull()
    }),
  )

  // 与 Basic Auth 同款豁免（`src/server/shared/public-ui.ts`）：浏览器取 PWA manifest 的请求
  // 不带任何应用层凭证，拦了会让 PWA 装不上（上游 #25698）。
  it.live("开关开：公共 UI 资源照常放过", () =>
    Effect.gen(function* () {
      const response = yield* app(ON)("/site.webmanifest")

      expect(response.status).toBe(200)
    }),
  )

  // 默认态是**关**这条要单独钉：默认若是开，本机跑 dev 就是全站 401。
  it.live("不显式配置时真读环境变量，也必须落到关", () =>
    Effect.gen(function* () {
      const original = process.env.OPENHIVE_REQUIRE_USER_ID
      delete process.env.OPENHIVE_REQUIRE_USER_ID
      yield* Effect.addFinalizer(() => Effect.sync(() => restoreEnv("OPENHIVE_REQUIRE_USER_ID", original)))

      const config = yield* UserIdentity.Config.pipe(Effect.provide(UserIdentity.Config.layer))

      expect(config.required).toBe(false)
    }),
  )
})

describe("门接进了真应用（T018）", () => {
  it.live("开关打开：真应用的路由也拒绝无头请求", () =>
    Effect.gen(function* () {
      const response = yield* realApp({ OPENHIVE_REQUIRE_USER_ID: "1" })("/session/ses_x")

      expect(response.status).toBe(401)
    }),
  )

  it.live("开关打开：带头请求不被身份门拦下（拦不拦得住是路由自己的事，不是 401 即可）", () =>
    Effect.gen(function* () {
      const response = yield* realApp({ OPENHIVE_REQUIRE_USER_ID: "1" })("/session/ses_x", {
        headers: { "X-User-ID": "u_000123" },
      })

      expect(response.status).not.toBe(401)
    }),
  )

  it.live("不设环境变量（默认）：真应用照常，零回归", () =>
    Effect.gen(function* () {
      const response = yield* realApp({})("/session/ses_x")

      expect(response.status).not.toBe(401)
    }),
  )
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
