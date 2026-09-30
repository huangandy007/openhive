/**
 * 003 T014 · 网关（Auth 服务的 HTTP 面）。
 *
 * **挡在中间的是什么**：本组测「身份从哪来」这条链的**头一段**——网关按会话凭证覆盖注入身份、
 * 下发 httpOnly Cookie、把会话 JWT 交给内核。内核那一段（验签后才认）由 T003 的
 * `user-identity.test.ts` 独立守着，两个文件合起来才是 FR-002 的完整三层。
 *
 * ⚠️ **不覆盖**（`LEARNINGS #002-02`：测不了的写成缺口，不写成覆盖）：
 * ① `AUTH_JWT_SECRET` 的**轮转**（代码侧没有轮转机制，是部署纪律）；
 * ② Cookie 的 `Secure` 属性在真实 HTTPS 下的行为（`sessionCookie` 默认关，本组不验）；
 * ③ 内核端口的**真实网络可达性**（回环绑定 / 网络策略）——那是部署项 D-02，
 * 见 `docs/workspace/deploy-todo.md`，本机 win32 单进程验不了。
 *
 * 用**真库**（PGlite 经 TCP，002 的夹具）而不是内存替身：登录这一跳要穿过
 * `connect(process.env)` → drizzle → PG 三种形状，替身会让被测对象消失（`LEARNINGS #002-01`）。
 */

import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD, SESSION_COOKIE_NAME } from "@opencode-ai/auth/policy"
import { registerUser, type RegisterInput } from "@opencode-ai/auth/register"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { withProductionDb } from "@opencode-ai/auth/test-support"
import { AuthGateway } from "../../src/server/openhive/gateway"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { UserIdentity } from "../../src/server/user-identity"

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const POLICE_NO = "000001"

/**
 * 临时根。**不能用默认路径**：带合法凭证访问 `/session` 会真的去开这个用户的库，
 * 默认根是本机真实的数据目录——测试不许碰它（`tenant-db-isolation.test.ts` 同款处理）。
 *
 * ⚠️ `OPENHIVE_DATA_ROOT` 只能走 `process.env`：`DatabaseRouter.layer` 读的是
 * `dataRoot(process.env)`，不是 Effect 的 `Config` 服务，塞进 `ConfigProvider` 会被无声忽略。
 */
const SANDBOX = mkdtempSync(path.join(tmpdir(), "openhive-gateway-"))
const DATA_ROOT = path.join(SANDBOX, "data")
const WORKSPACE_ROOT = path.join(SANDBOX, "workspaces")

const previousDataRoot = process.env.OPENHIVE_DATA_ROOT
process.env.OPENHIVE_DATA_ROOT = DATA_ROOT

afterAll(() => {
  if (previousDataRoot === undefined) delete process.env.OPENHIVE_DATA_ROOT
  else process.env.OPENHIVE_DATA_ROOT = previousDataRoot
  // Windows 上 SQLite 的 `-wal`/`-shm` 句柄可能仍被持有，`rm` 会 EBUSY。
  // 清不掉就留给系统——**清理失败不该变成测试失败**，那与被测对象无关。
  try {
    rmSync(SANDBOX, { recursive: true, force: true })
  } catch {}
})

/** 网关开着的最小环境：门开 + 密钥合规。db 那一半由 `withProductionDb` 临时塞进 `process.env`。 */
const ON: Record<string, string | undefined> = {
  OPENHIVE_REQUIRE_USER_ID: "1",
  AUTH_JWT_SECRET: SECRET,
  OPENHIVE_WORKSPACE_ROOT: WORKSPACE_ROOT,
}

const input = (policeNo: string): RegisterInput => ({
  policeNo,
  name: "张三",
  idCard: "110101199001011234",
  phone: "13800000000",
  org: "市局",
  dept: "刑侦支队",
  section: "一大队",
  status: 1,
})

/**
 * **真应用**（`HttpApiApp.routes`，含 `createRoutes` 的全部接线）+ 指定环境变量。
 *
 * 为什么不用最小路由：网关的装法是「排在身份门**之前**的全局中间件」，
 * **次序本身就是被测对象之一**（排反了就抓不到身份、整层静默直通）。最小路由测不出次序。
 *
 * ⚠️ 两个调用纪律，都是实测撞出来的（`@opencode-ai/auth/test-support` 的文件头记了细节）：
 * ① **一次 `withProductionDb` 只起一个 `app()`**——每个 `app()` 会在首次登录时自建一个
 *    `bun-sql` 客户端，而同一台 PGlite 上**两个客户端执行同一句 SQL 必撞 42P05**；
 *    生产本来就是一个进程、一个连接池服务所有请求，一个请求一个客户端反而是失真。
 * ② **不能跨夹具缓存**：端口每个 `withProductionDb` 都不同，缓存下来的 handler
 *    会连着已经关掉的库。
 */
function app(env: Record<string, string | undefined>) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
    { disableLogger: true },
  ).handler

  return (url: string, init?: RequestInit) =>
    Effect.promise(() =>
      Promise.resolve(handler(new Request(new URL(url, "http://localhost"), init), HttpApiApp.context)),
    )
}

type Gateway = ReturnType<typeof app>

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
})

const login = (policeNo: string, password: string) => post({ policeNo, password })

/** 从 `Set-Cookie` 里取出 `名=值` 那一对，供下一步原样带上。 */
function cookieOf(response: Response): string {
  const header = response.headers.get("set-cookie")
  if (!header) throw new Error("响应里没有 Set-Cookie")
  return header.slice(0, header.indexOf(";"))
}

/** 以某人的身份向**这个**网关发起一次登录，返回响应。 */
async function signIn(gateway: Gateway, policeNo = POLICE_NO, password = DEFAULT_PASSWORD) {
  return Effect.runPromise(gateway(AuthGateway.PATH.login, login(policeNo, password)))
}

/** 起一个真库、写入一个可登录的账号，并把**这一个**网关交给回调（一个夹具一个，理由见 `app()`）。 */
const withAccount = <T>(fn: (seeded: { id: string; gateway: Gateway }) => Promise<T>) =>
  withProductionDb(async (db) => {
    await migrate(db)
    const seeded = await registerUser(db, input(POLICE_NO))
    return fn({ id: seeded.id, gateway: app(ON) })
  })

describe("T014 网关门面", () => {
  test(
    "登录成功：下发 httpOnly 会话 Cookie，并回身份与 mustChangePw",
    () =>
      withAccount(async ({ id, gateway }) => {
        const response = await signIn(gateway)

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          id,
          policeNo: POLICE_NO,
          name: "张三",
          isAdmin: false,
          mustChangePw: true,
        })

        const cookie = response.headers.get("set-cookie")
        expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`)
        // `HttpOnly` 是「脚本读不到凭证」这条的全部依据，掉一个字符就作废。
        expect(cookie).toContain("HttpOnly")
        expect(cookie).toContain("SameSite=Lax")
        expect(cookie).toContain("Path=/")
      }),
    30_000,
  )

  test(
    "凭证不对与账号不存在：同一个 401、同一句话、都不下发 Cookie",
    () =>
      withAccount(async ({ gateway }) => {
        const wrongPassword = await signIn(gateway, POLICE_NO, "not-the-password")
        const noSuchAccount = await signIn(gateway, "999999", DEFAULT_PASSWORD)

        expect(wrongPassword.status).toBe(401)
        expect(noSuchAccount.status).toBe(401)
        // 各读一次（响应体只能读一次，读两遍会 ERR_BODY_ALREADY_USED）。
        const wrongBody = await wrongPassword.json()
        const noSuchBody = await noSuchAccount.json()

        // 两种失败必须**逐字相同**：分辨得出「账号存不存在」等于白送一个账号枚举接口。
        expect(wrongBody).toEqual(noSuchBody)
        expect(wrongBody).toMatchObject({ error: "账号或密码错误" })
        expect(wrongPassword.headers.get("set-cookie")).toBeNull()
        expect(noSuchAccount.headers.get("set-cookie")).toBeNull()
      }),
    30_000,
  )

  test(
    "登录拿到的 Cookie 能过内核身份门（会话 JWT 透传到内核，内核再验一次）",
    () =>
      withAccount(async ({ gateway }) => {
        const authed = await signIn(gateway)

        const response = await Effect.runPromise(
          gateway("/session/ses_x", { headers: { Cookie: cookieOf(authed) } }),
        )

        // 断言的是「内核**不是**因为认不出身份而拒绝」——拦不拦得住是路由自己的事。
        expect(response.status).not.toBe(401)
      }),
    60_000,
  )

  test("登出：清掉会话 Cookie", async () => {
    const response = await Effect.runPromise(app(ON)(AuthGateway.PATH.logout, { method: "POST" }))

    expect(response.status).toBe(204)
    const cookie = response.headers.get("set-cookie")
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`)
    // `Max-Age=0` 才是「删掉」；只把值置空，浏览器会留下一条空 Cookie。
    expect(cookie).toContain("Max-Age=0")
  })

  test("开关关（默认）：网关整体不注册，登录端点不存在——今天所有客户端都还没登录，关着才是零回归", async () => {
    const response = await Effect.runPromise(app({})(AuthGateway.PATH.login, login(POLICE_NO, DEFAULT_PASSWORD)))

    // ⚠️ **不能断言 404**：真应用里「没被任何路由接管」的路径会落到 UI 的 `/*` 兜底
    // （上游行为，返回页面而不是 404）。能钉死的是「它没有被登录端点处理」——
    // 既没下发会话 Cookie，也不是登录端点那种 JSON 响应（真被接管了就一定是 JSON，
    // 成功/失败都一样）。
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("content-type") ?? "").not.toContain("application/json")
  })
})

describe("T014 剥离并覆盖注入 X-User-ID（FR-002 ①）", () => {
  const SUBJECT: TokenSubject = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    policeNo: "020601",
    name: "张三",
    isAdmin: false,
  }
  const FORGED = "u_999999"

  const token = Effect.promise(() => signToken(SUBJECT, SECRET))

  /**
   * 最小路由：**只装身份注入层**，让下游把它收到的 `x-user-id` 原样报回来。
   *
   * 为什么不能只看「真应用返回 200」：真实链路里「头缺失」与「头被覆盖成正确值」**都会** 200，
   * 断言分不出「剥离过」与「根本没动它」。把下游收到的东西报出来，才测得到这一层做了什么。
   */
  function echoApp(config: Layer.Layer<UserIdentity.Config>) {
    const handler = HttpRouter.toWebHandler(
      HttpRouter.use((router) =>
        router.add("GET", "/*", () =>
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            return HttpServerResponse.jsonUnsafe({ hint: request.headers[UserIdentity.HEADER] ?? null })
          }),
        ),
      ).pipe(Layer.provide(AuthGateway.layer.pipe(Layer.provide(config)))),
      { disableLogger: true },
    ).handler

    return (headers: Record<string, string>) =>
      Effect.promise(() =>
        Promise.resolve(handler(new Request(new URL("/anything", "http://localhost"), { headers }), HttpApiApp.context)),
      )
  }

  const on = UserIdentity.Config.configLayer({ required: true, secret: Option.some(SECRET) })

  test("客户端自带的 X-User-ID 被**剥离**：没有凭证时它到不了下游", async () => {
    const response = await Effect.runPromise(echoApp(on)({ [UserIdentity.HEADER]: FORGED }))

    expect(await response.json()).toEqual({ hint: null })
  })

  test("剥离之后按**验签结果覆盖注入**：头不是被删空了，是换成了真的那个 id", async () => {
    const response = await Effect.runPromise(
      echoApp(on)({
        Cookie: `${UserIdentity.COOKIE_NAME}=${await Effect.runPromise(token)}`,
        [UserIdentity.HEADER]: FORGED,
      }),
    )

    expect(await response.json()).toEqual({ hint: SUBJECT.id })
  })

  test(
    "真应用：伪造的 X-User-ID 不会让合规凭证的请求被拒（头已不是输入，剩的矛盾只可能来自链路被改写）",
    () =>
      withAccount(async ({ gateway }) => {
        const authed = await signIn(gateway)

        const response = await Effect.runPromise(
          gateway("/session/ses_x", {
            headers: { Cookie: cookieOf(authed), [UserIdentity.HEADER]: FORGED },
          }),
        )

        expect(response.status).not.toBe(401)
      }),
    60_000,
  )
})

describe("T014 启动路径的密钥地板（D-03）", () => {
  /**
   * 「**层构建**」= 这里被测的那一步。走的正是生产的路子（`toWebHandler` 在第一次请求时
   * 建 `routes` 那一整个层树），所以它建不起来 ⇔ 进程起不来，不是某种只在测试里存在的构造方式。
   *
   * 返回值是**会被拒的 promise**：缺陷从 `Layer.buildWithScope` 里冒出来，`runPromise` 直接拒。
   */
  const build = (secret: Option.Option<string>) =>
    HttpRouter.toWebHandler(
      AuthGateway.layer.pipe(Layer.provide(UserIdentity.Config.configLayer({ required: true, secret: secret }))),
      { disableLogger: true },
    ).handler(new Request(new URL("/", "http://localhost")), HttpApiApp.context)

  test("密钥短于 32 字符 → 网关层构建即失败（起不来，不是「能登录、但登录接口 500」）", async () => {
    expect(build(Option.some("short-secret"))).rejects.toThrow("32")
  })

  test("没配密钥 → 网关层构建即失败，且报的是缺哪个环境变量", async () => {
    expect(build(Option.none())).rejects.toThrow("AUTH_JWT_SECRET")
  })
})
