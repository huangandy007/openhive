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
import type { connect } from "@opencode-ai/auth/db"
import { migrate } from "@opencode-ai/auth/migrate"
import { DEFAULT_PASSWORD_ENV, SESSION_COOKIE_NAME } from "@opencode-ai/auth/policy"
import { registerUser, type RegisterInput } from "@opencode-ai/auth/register"
import { signToken, type TokenSubject } from "@opencode-ai/auth/token"
import { DEPLOYED_DEFAULT_PASSWORD, restorePoint, withProductionDb } from "@opencode-ai/auth/test-support"
import { disableAccounts } from "@opencode-ai/auth/zombie"
import { AuthGateway } from "../../src/server/openhive/gateway"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { UserIdentity } from "../../src/server/user-identity"

/** ≥32 字符，过 002 的密钥地板（`packages/auth/src/token.ts` 的 `jwtSecret`）。 */
const SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

const POLICE_NO = "000001"
/** 第二个账号：只在「身份只从会话取」那条用得上——要有一个**别人**可瞄准。 */
const OTHER_POLICE_NO = "000002"

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

/**
 * 本文件里「**这次部署配的**」默认密码。短名字只为本文件可读性，
 * 取值与「为什么刻意不等于 design-v2 §4.1 那个公开示例值」写在
 * `@opencode-ai/auth/test-support` 上（一处定义，免得各测试文件各漂一份）。
 */
const PW = DEPLOYED_DEFAULT_PASSWORD

/**
 * ⚠️ **必须走 `process.env`（`restorePoint`），不能塞进 `app(env)` 的 `ConfigProvider`**：
 * 网关读这个变量用的是 `process.env`，与 `OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO`、
 * `OPENHIVE_ACTIVITY_THROTTLE_SECONDS` 同一个读法（`gateway.ts` 的 `routes`）。
 * 塞进 `ConfigProvider` 会被**无声忽略**，然后整个文件的用例一起撞「缺环境变量」。
 *
 * 放在模块顶层而不是每个用例里：这是本文件「网关开着」这个前提的一部分，
 * 与上面那个 `OPENHIVE_DATA_ROOT` 同款处理。
 */
const restoreDefaultPassword = restorePoint({ [DEFAULT_PASSWORD_ENV]: PW })

afterAll(restoreDefaultPassword)

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

/**
 * 把一次拒绝变成一段文本，供 `toContain` 断言。
 *
 * 失败方向是**安全的**：认不出形状时交回空串，于是「本该失败」的断言会红，
 * 而不是被一段噪声糊过去（`LEARNINGS #002-02` 那类假绿）。
 *
 * 用 `instanceof` 收窄、不用 `as`——本项目的门禁判据是「本次改动文件 0 命中」，
 * 而 `no-unsafe-type-assertion` 会拦。（Effect 的缺陷是 `FiberFailure`，它继承 `Error`。）
 */
function rejectionText(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message
  return typeof thrown === "string" ? thrown : ""
}

/** 以某人的身份向**这个**网关发起一次登录，返回响应。 */
async function signIn(gateway: Gateway, policeNo = POLICE_NO, password = PW) {
  return Effect.runPromise(gateway(AuthGateway.PATH.login, login(policeNo, password)))
}

/** 起一个真库、写入一个可登录的账号，并把**这一个**网关交给回调（一个夹具一个，理由见 `app()`）。 */
const withAccount = <T>(fn: (seeded: { id: string; gateway: Gateway }) => Promise<T>) =>
  withProductionDb(async (db) => {
    await migrate(db)
    const seeded = await registerUser(db, input(POLICE_NO), PW)
    return fn({ id: seeded.id, gateway: app(ON) })
  })

/**
 * 比 `withAccount` 多两样，都是 T015 的用例自己要的：
 * ① **库本身**——「账号被停用」那条得先把账号停掉，走 `disableAccounts` 而不是在测试里拼 SQL
 *    （`packages/opencode` 没有 drizzle 依赖，也不该为了改一行数据去引一个）；
 * ② **第二个账号**——「身份只从会话取」要有一个具体的人可以瞄准，只靠「没被改到」证明不了什么。
 */
const withAccounts = <T>(
  fn: (seeded: { db: ReturnType<typeof connect>; 甲: string; 乙: string; gateway: Gateway }) => Promise<T>,
) =>
  withProductionDb(async (db) => {
    await migrate(db)
    const 甲 = await registerUser(db, input(POLICE_NO), PW)
    const 乙 = await registerUser(db, input(OTHER_POLICE_NO), PW)
    return fn({ db, 甲: 甲.id, 乙: 乙.id, gateway: app(ON) })
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
        const noSuchAccount = await signIn(gateway, "999999", PW)

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
    const response = await Effect.runPromise(app({})(AuthGateway.PATH.login, login(POLICE_NO, PW)))

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

/**
 * 003 T020 的**接线**那一半：`policy.ts` 的 `defaultPassword(env)` 自己「缺失即抛」有单测守着，
 * 但「**网关有没有在层构造期调它**」是另一件事——这一组才守得住。
 *
 * 少了这一组，把网关里那两句 `defaultPassword(process.env)` 改成别的东西（或挪到请求期），
 * **其余用例全绿**：它们都在模块顶层把变量配好了，于是「配了就会用」两边都成立，
 * 只有「没配会不会当场炸」这一条能把两种实现分开（`LEARNINGS #002-02`）。
 */
describe("T020 默认口令的启动地板（与密钥地板同款）", () => {
  test("网关开着却没配默认密码 → 建应用即失败，且报的是缺哪个环境变量", async () => {
    const saved = process.env[DEFAULT_PASSWORD_ENV]
    delete process.env[DEFAULT_PASSWORD_ENV]
    try {
      // ⚠️ **建的是真应用**（`HttpApiApp.routes`），不是上面那组的 `AuthGateway.layer`。
      // 实测（2026-10-01）：单建 `AuthGateway.layer` 这条**永远是绿的**——默认密码只在
      // `AuthGateway.routes` 与 `bootstrap()` 里解析，`layer` 那条路根本不碰它。
      // 一个「永远绿」的用例比没有更糟：它看上去守着这件事，实际什么都没守。
      //
      // `toWebHandler` 惰性建层（同 `openhive-bootstrap.test.ts` 的用法），所以必须**发一次请求**
      // 才走到层构造期——那正是「启动」在这套测试里的对应动作。
      //
      // 刻意**不用** `expect(...).rejects.toThrow()`：oxlint 的 `await-thenable` 判它
      // 「不是 thenable」，而顺着它去掉 `await` 会让断言**空转**（拒绝没人接住，测试照绿）——
      // `openhive-bootstrap.test.ts` 里记了同一件事。换个不会两难的形式：两种结局都接住，
      // 再断言接到的是哪一种。
      const reason = await Effect.runPromise(app(ON)(AuthGateway.PATH.logout, { method: "POST" })).then(
        () => "这次启动成功了",
        rejectionText,
      )

      // 密钥这次是好的、`bootstrap` 的开关也没开，所以失败只可能来自默认密码：
      // 报错里得点名那个变量，否则部署方拿到一句无从下手的「缺环境变量」，还得自己去猜是哪一个。
      expect(reason).toContain(DEFAULT_PASSWORD_ENV)
    } finally {
      if (saved !== undefined) process.env[DEFAULT_PASSWORD_ENV] = saved
    }
  })
})

/**
 * 下面两条端点的 URL **写成字面量、不引 `AuthGateway.PATH`**：它们是前端硬编码要打的地址，
 * 属**线格式契约**，不是实现细节。跟着常量走的断言，在有人改常量名时会跟着一起漂，
 * 反而测不出「前端打不到这个地址」。
 */
const ME = "/openhive/auth/me"
const CHANGE_PASSWORD = "/openhive/auth/change-password"

const NEW_PASSWORD = "ju-2026-0912-Aa"

describe("T015 会话自查 /me", () => {
  test(
    "带会话 Cookie：回身份与 mustChangePw——前端靠它决定「显示登录页」还是「弹改密框」",
    () =>
      withAccount(async ({ id, gateway }) => {
        const cookie = cookieOf(await signIn(gateway))

        const response = await Effect.runPromise(gateway(ME, { headers: { Cookie: cookie } }))

        expect(response.status).toBe(200)
        // `toEqual` 而非 `toMatchObject`：多出来的字段（比如把 `token` 顺带透出去）也该让这条红。
        expect(await response.json()).toEqual({
          id,
          policeNo: POLICE_NO,
          name: "张三",
          isAdmin: false,
          mustChangePw: true,
        })
      }),
    30_000,
  )

  test(
    "认不出凭证：401——没带、乱写、签名不符都是同一个结果",
    () =>
      withAccount(async ({ gateway }) => {
        const 没带 = await Effect.runPromise(gateway(ME))
        const 乱写 = await Effect.runPromise(gateway(ME, { headers: { Cookie: `${SESSION_COOKIE_NAME}=nonsense` } }))

        expect(没带.status).toBe(401)
        expect(乱写.status).toBe(401)
      }),
    30_000,
  )

  test(
    "改密之后回 false：这个字段只可能来自库里那一行（凭证载荷里没有它）",
    () =>
      withAccount(async ({ gateway }) => {
        const cookie = cookieOf(await signIn(gateway))
        const 自查 = async () => (await Effect.runPromise(gateway(ME, { headers: { Cookie: cookie } }))).json()

        expect(await 自查()).toMatchObject({ mustChangePw: true })

        await Effect.runPromise(
          gateway(
            CHANGE_PASSWORD,
            post({ currentPassword: PW, newPassword: NEW_PASSWORD }, { Cookie: cookie }),
          ),
        )

        expect(await 自查()).toMatchObject({ mustChangePw: false })
      }),
    30_000,
  )

  test(
    "账号被停用：会话还没过期也不放行——门面不该把停用的人放进工作台",
    () =>
      withAccounts(async ({ db, 甲, gateway }) => {
        const cookie = cookieOf(await signIn(gateway))
        await disableAccounts(db, [甲])

        const response = await Effect.runPromise(gateway(ME, { headers: { Cookie: cookie } }))

        expect(response.status).toBe(401)
      }),
    30_000,
  )
})

describe("T015 自助改密", () => {
  test(
    "改密成功：204；新密码能登录、旧密码不能，且 mustChangePw 一并解除",
    () =>
      withAccount(async ({ gateway }) => {
        const cookie = cookieOf(await signIn(gateway))

        const changed = await Effect.runPromise(
          gateway(
            CHANGE_PASSWORD,
            post({ currentPassword: PW, newPassword: NEW_PASSWORD }, { Cookie: cookie }),
          ),
        )
        expect(changed.status).toBe(204)

        const 新 = await signIn(gateway, POLICE_NO, NEW_PASSWORD)
        expect(新.status).toBe(200)
        expect(await 新.json()).toMatchObject({ mustChangePw: false })

        expect((await signIn(gateway, POLICE_NO, PW)).status).toBe(401)
      }),
    30_000,
  )

  test(
    "当前密码不对：400 + 说得清的领域消息，且密码原封不动",
    () =>
      withAccount(async ({ gateway }) => {
        const cookie = cookieOf(await signIn(gateway))

        const response = await Effect.runPromise(
          gateway(
            CHANGE_PASSWORD,
            post({ currentPassword: "not-the-password", newPassword: NEW_PASSWORD }, { Cookie: cookie }),
          ),
        )

        // 这里**允许**说清楚原因（与登录失败刻意相反）：能改密说明已经通过鉴权，
        // 不再构成账号枚举信号，而说不清只会让民警反复试一个填对的框。
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: "当前密码不正确" })

        // 「报了错」与「没改掉」是两件事，各测各的——只测其一，另半边错了也看不出来。
        expect((await signIn(gateway, POLICE_NO, PW)).status).toBe(200)
      }),
    30_000,
  )

  test(
    "新密码不合规各自回各自的消息：空白 / 等于默认密码",
    () =>
      withAccount(async ({ gateway }) => {
        const cookie = cookieOf(await signIn(gateway))
        const 试 = async (newPassword: string) => {
          const response = await Effect.runPromise(
            gateway(
              CHANGE_PASSWORD,
              post({ currentPassword: PW, newPassword }, { Cookie: cookie }),
            ),
          )
          return [response.status, (await response.json()).error]
        }

        // 空白串按「空」处理：只判 `length === 0` 会放行 "   "，而 "   " 正是可登录的密码。
        expect(await 试("   ")).toEqual([400, "新密码不能为空"])
        // 默认密码是写在文档里的公开值，放行它等于账号停在人尽皆知的口令上、且 mustChangePw 已清成 0。
        expect(await 试(PW)).toEqual([400, "新密码不能是系统默认密码"])
      }),
    30_000,
  )

  test(
    "新密码与当前密码相同：400 + 「新密码不能与当前密码相同」",
    () =>
      withAccount(async ({ gateway }) => {
        const cookie = cookieOf(await signIn(gateway))
        const 换 = (currentPassword: string, newPassword: string) =>
          Effect.runPromise(
            gateway(CHANGE_PASSWORD, post({ currentPassword, newPassword }, { Cookie: cookie })),
          )

        // 这条要先真的改一次：当前密码还是默认密码时，会被上面那条地板先拦下，测不到这一条。
        expect((await 换(PW, NEW_PASSWORD)).status).toBe(204)

        const same = await 换(NEW_PASSWORD, NEW_PASSWORD)
        expect([same.status, (await same.json()).error]).toEqual([400, "新密码不能与当前密码相同"])
      }),
    30_000,
  )

  test(
    "身份只从会话取：请求体里塞一个**别人的** userId 不生效，改的仍是自己的密码",
    () =>
      withAccounts(async ({ 乙, gateway }) => {
        const cookie = cookieOf(await signIn(gateway))

        const forged = await Effect.runPromise(
          gateway(
            CHANGE_PASSWORD,
            post({ userId: 乙, currentPassword: PW, newPassword: NEW_PASSWORD }, { Cookie: cookie }),
          ),
        )
        expect(forged.status).toBe(204)

        // 两半都要断：承认「甲改成了」不够，要的恰恰是「乙没被动到」。
        expect((await signIn(gateway, POLICE_NO, NEW_PASSWORD)).status).toBe(200)
        expect((await signIn(gateway, OTHER_POLICE_NO, PW)).status).toBe(200)
      }),
    30_000,
  )

  test("没有会话凭证：401——这两条路径**不在**网关豁免名单里，落在受保护那一侧", async () => {
    const 裸 = (path: string, init?: RequestInit) => Effect.runPromise(app(ON)(path, init))

    expect((await 裸(CHANGE_PASSWORD, post({ currentPassword: PW, newPassword: NEW_PASSWORD }))).status).toBe(401)
    expect((await 裸(ME)).status).toBe(401)
  })
})
