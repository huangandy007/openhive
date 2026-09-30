import { describe, expect, setSystemTime } from "bun:test"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { DatabaseRouter } from "@opencode-ai/core/database/router"
import { User } from "@opencode-ai/core/user"
import { UserIdentity } from "../../src/server/user-identity"
import { userIdentityLayer } from "../../src/server/routes/instance/httpapi/middleware/user-identity"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
const OTHER_SECRET = "p6o5n4m3l2k1j0i9h8g7f6e5d4c3b2a1"

const SUBJECT: TokenSubject = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  policeNo: "020601",
  name: "张三",
  isAdmin: false,
}

function cookie(token: string) {
  return { Cookie: `${UserIdentity.COOKIE_NAME}=${token}` }
}

/**
 * 最小应用：一条通配路由 + 身份门。**只测门**，不牵扯真实路由树——
 * 门是全局中间件（同 `corsVaryFix` 的装法），套住什么路由与它无关。
 *
 * 路由用 `serviceOption` 取身份：门关着时**没有** User 上下文（不是空身份），
 * 门开着才有。用 `Option` 而不是 `yield* User.Service`，是为了让「关」这一态能跑通，
 * 同时让「开」这一态能断言拿到的是**验签出来的**那个 id。
 */
function app(config: Layer.Layer<UserIdentity.Config>) {
  const handler = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      router.add("GET", "/*", () =>
        Effect.gen(function* () {
          const user = yield* Effect.serviceOption(User.Service)
          return HttpServerResponse.jsonUnsafe({ ok: true, userId: Option.getOrNull(user)?.id ?? null })
        }),
      ),
    ).pipe(
      Layer.provide(
        // 门除身份外还每请求注入「取连接钩子」（003 T005），钩子的依赖在这里满足。
        // 本组只测门、不碰 db：`DatabaseRouter.layer()` 是**惰性**的（`LayerMap` 不打开任何库），
        // 而这里的 root 从不被 `forUser` 用到，所以走默认值也不落盘。
        userIdentityLayer.pipe(Layer.provide(config), Layer.provide(DatabaseRouter.layer())),
      ),
    ),
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

const OFF = UserIdentity.Config.configLayer({ required: false, secret: Option.some(SECRET) })
const on = (secret: Option.Option<string> = Option.some(SECRET)) =>
  UserIdentity.Config.configLayer({ required: true, secret })

/** 用真实签发器造令牌——**不手搓 JWT**，免得测试自己写错格式还自以为对。 */
const token = (subject = SUBJECT, secret = SECRET) => Effect.promise(() => signToken(subject, secret))

describe("openhive 身份门（T003：验签后才认）", () => {
  it.live("开关关（默认）：不带任何凭证也放行——今天所有客户端都没有会话凭证，关着才是零回归", () =>
    Effect.gen(function* () {
      const response = yield* app(OFF)("/session")

      expect(response.status).toBe(200)
    }),
  )

  it.live("开关开：没有凭证一律拒绝", () =>
    Effect.gen(function* () {
      const response = yield* app(on())("/session")

      expect(response.status).toBe(401)
    }),
  )

  it.live("开关开：合法令牌放行，且请求内读到的是**验签出来的** userId", () =>
    Effect.gen(function* () {
      const response = yield* app(on())("/session", { headers: cookie(yield* token()) })

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({ userId: SUBJECT.id })
    }),
  )

  // 签名是唯一挡在「自填一个 id 就冒充他人」前面的东西。改一个字符即失效。
  it.live("开关开：令牌被篡改 → 拒绝", () =>
    Effect.gen(function* () {
      const valid = yield* token()
      const tampered = valid.slice(0, -1) + (valid.at(-1) === "A" ? "B" : "A")

      const response = yield* app(on())("/session", { headers: cookie(tampered) })

      expect(response.status).toBe(401)
    }),
  )

  it.live("开关开：令牌过期 → 拒绝", () =>
    Effect.gen(function* () {
      // 把时钟拨回 3 小时前签发（TTL 是 2 小时），再拨回来当「现在」——令牌就已过期。
      yield* Effect.addFinalizer(() => Effect.sync(() => setSystemTime()))
      setSystemTime(new Date(Date.now() - 3 * 60 * 60 * 1000))
      const expired = yield* token()
      setSystemTime()

      const response = yield* app(on())("/session", { headers: cookie(expired) })

      expect(response.status).toBe(401)
    }),
  )

  // 换个密钥签 = 攻击者自签。验签必须只认自己那把密钥。
  it.live("开关开：用别的密钥签的令牌 → 拒绝", () =>
    Effect.gen(function* () {
      const response = yield* app(on())("/session", { headers: cookie(yield* token(SUBJECT, OTHER_SECRET)) })

      expect(response.status).toBe(401)
    }),
  )

  // `X-User-ID` 降级为路由提示后，唯一要拦的是**矛盾**：令牌说 A、头说 B。
  // 出现矛盾只有两种解释——链路被改写，或有人手工塞了头。两种都不该放行。
  it.live("开关开：令牌合法但 X-User-ID 与 subject 不一致 → 拒绝（fail-closed）", () =>
    Effect.gen(function* () {
      const response = yield* app(on())("/session", {
        headers: { ...cookie(yield* token()), "X-User-ID": "u_999999" },
      })

      expect(response.status).toBe(401)
    }),
  )

  it.live("开关开：令牌合法且 X-User-ID 与 subject 一致 → 放行", () =>
    Effect.gen(function* () {
      const response = yield* app(on())("/session", {
        headers: { ...cookie(yield* token()), "X-User-ID": SUBJECT.id },
      })

      expect(response.status).toBe(200)
    }),
  )

  // 头**不是**身份来源的正面证据：提示缺失不该影响放行，否则等于把头当成了必要条件。
  it.live("开关开：令牌合法、X-User-ID 缺失 → 放行（头只是提示，不是身份来源）", () =>
    Effect.gen(function* () {
      const response = yield* app(on())("/session", { headers: cookie(yield* token()) })

      expect(response.status).toBe(200)
    }),
  )

  // 验不了就得拒绝，不能「验不了就当通过」——那正是这道门被裁定取代之前的毛病。
  it.live("开关开：没配 AUTH_JWT_SECRET → 拒绝（fail-closed，不是放行）", () =>
    Effect.gen(function* () {
      const response = yield* app(on(Option.none()))("/session", {
        headers: cookie(yield* token()),
      })

      expect(response.status).toBe(401)
    }),
  )

  // 复用 002 的地板（`jwtSecret` 的 32 字符），而不是在核心里另立一个数。
  it.live("开关开：AUTH_JWT_SECRET 短于 32 字符 → 拒绝", () =>
    Effect.gen(function* () {
      const weak = "short-secret"
      const response = yield* app(on(Option.some(weak)))("/session", {
        headers: cookie(yield* token(SUBJECT, weak)),
      })

      expect(response.status).toBe(401)
    }),
  )

  it.live("开关开：拒绝时不给 www-authenticate——那是给浏览器弹 Basic 登录框用的，这里没有 Basic", () =>
    Effect.gen(function* () {
      const response = yield* app(on())("/session")

      expect(response.headers.get("www-authenticate")).toBeNull()
    }),
  )

  // 与 Basic Auth 同款豁免（`src/server/shared/public-ui.ts`）：浏览器取 PWA manifest 的请求
  // 不带任何应用层凭证，拦了会让 PWA 装不上（上游 #25698）。
  it.live("开关开：公共 UI 资源照常放过", () =>
    Effect.gen(function* () {
      const response = yield* app(on())("/site.webmanifest")

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

describe("门接进了真应用", () => {
  it.live("开关打开：真应用的路由也拒绝无凭证请求", () =>
    Effect.gen(function* () {
      const response = yield* realApp({ OPENHIVE_REQUIRE_USER_ID: "1", AUTH_JWT_SECRET: SECRET })("/session/ses_x")

      expect(response.status).toBe(401)
    }),
  )

  it.live("开关打开：合法令牌不被身份门拦下（拦不拦得住是路由自己的事，不是 401 即可）", () =>
    Effect.gen(function* () {
      const response = yield* realApp({ OPENHIVE_REQUIRE_USER_ID: "1", AUTH_JWT_SECRET: SECRET })("/session/ses_x", {
        headers: cookie(yield* token()),
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
