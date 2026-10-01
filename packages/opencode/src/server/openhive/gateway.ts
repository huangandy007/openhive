export * as AuthGateway from "./gateway"

/**
 * openhive 网关（003 T014）：**身份从哪来**这条链的头一段。
 *
 * 它做四件事，都不许绕过：
 *
 * ⓪ **引导首个管理员**（T019）：只在设了 `OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO` 时，在**层构造期**
 *    把迁移跑到最新、再判一次「表里一个管理员都没有」。**这是进程里唯一会写 `auth.user` 的
 *    启动动作**，也是唯一不做鉴权的——判据是表的状态，不是调用者的身份。详见 `bootstrap()`。
 *
 * ① **登录面**（`/openhive/auth/login`、`/logout`、`/me`、`/change-password`）：核密码这件事
 *    由 `packages/auth` 的 `login()` 做（002 落地，此前**没有任何生产代码调用它**），
 *    这里只负责 HTTP 形状——收 `{policeNo, password}`、下发 httpOnly Cookie、把身份与
 *    `mustChangePw` 回给前端。T015 补上的两条（会话自查、自助改密）都由前端在**启动时**
 *    与**进工作台之后**调用，见各自的函数注释。
 * ② **身份注入**：把客户端自带的 `X-User-ID` **剥掉**，按 Cookie 里**验签通过**的凭证
 *    重新注入 `X-User-ID: <真实 id>`。于是明文头从「输入」变成「输出」——
 *    FR-002 ① 的原话是「剥离客户端头后按会话凭证覆盖注入」，这是它唯一落地的地方。
 * ③ **记录活跃**（T017）：认得出身份就顺手刷一下 `auth.user.last_active_at`——
 *    design-v2 §4.1 说的「请求时更新」就是这一处，全仓库唯一写那一列的地方。
 *    **带节流**（默认 60 秒）且**失败被吞掉**，两条都见 `recordActivity()`。
 *
 * ⚠️ **为什么多一道验签**：内核身份门自己也验一次（`middleware/user-identity.ts`）。
 * 两次不是冗余，是**深度防御**：网关这层被绕过（或有人直连内核端口）时，门仍然拦得住；
 * 而门那时候看到的 `X-User-ID` 与凭证不一致，正说明「网关与内核之间被改写」。
 *
 * 🗓️ **登录面的开关跟着 `OPENHIVE_REQUIRE_USER_ID`，默认关**。关着时：`layer` 是恒等中间件、
 * `routes` 一个端点都不注册（`bun run dev` 的行为逐字不变，也**不会**去要 PG 配置和密钥）。
 * 开着时：缺密钥 / 密钥短于 002 的 32 字符地板 ⇒ **层构造期就抛**，进程起不来
 * （D-03 要求「启动时调一次」，这是那个「一次」）。
 *
 * ⓪ 那个引导走**另一个**开关（`OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO`），且**独立于上面这条**：
 * 它排在 `OPENHIVE_REQUIRE_USER_ID` 的早退**之前**，理由是「只设引导变量 ⇒ 静默空操作」这种
 * 失败模式比「多要一次 `PG_*` 配置」严重得多。所以上面那句「不去要 PG 配置」的准确读法是
 * **两个变量都没设时**成立。
 *
 * **不在这里做的事**：签发凭证（`packages/auth` 的 `signToken`，被 `login()` 调用）、
 * 内核端口的网络可达性（部署项 D-02）。本层挡不住「绕过网关直连内核端口」——
 * 那是网络策略的事，代码侧只有门那道验签兜底。
 */

import { UserIdentity } from "@/server/user-identity"
import { touchActivity } from "@opencode-ai/auth/activity"
import { bootstrapAdmin } from "@opencode-ai/auth/bootstrap"
import { connect } from "@opencode-ai/auth/db"
import { InvalidCredentialsError, login, type LoginResult } from "@opencode-ai/auth/login"
import { migrate } from "@opencode-ai/auth/migrate"
import {
  changePassword,
  EmptyNewPasswordError,
  InvalidCurrentPasswordError,
  WeakNewPasswordError,
} from "@opencode-ai/auth/password"
import {
  activityThrottleSeconds,
  BOOTSTRAP_ADMIN_POLICE_NO_ENV,
  JWT_SECRET_ENV,
} from "@opencode-ai/auth/policy"
import { sessionIdentity } from "@opencode-ai/auth/session"
import { nowSeconds } from "@opencode-ai/auth/time"
import {
  jwtSecret,
  sessionCookie,
  verifyToken,
  type SessionCookie,
  type TokenSubject,
} from "@opencode-ai/auth/token"
import { Context, Effect, Option, Schema } from "effect"
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

export const PREFIX = "/openhive/auth"

export const PATH = {
  login: `${PREFIX}/login`,
  logout: `${PREFIX}/logout`,
  me: `${PREFIX}/me`,
  changePassword: `${PREFIX}/change-password`,
} as const

/**
 * 是不是网关自己的路径。
 *
 * 身份门（`middleware/user-identity.ts`）用它豁免登录/登出——那两个端点**本来就是给
 * 没身份的人用的**。只认这两个精确路径、不做前缀通配：将来在本前缀下加端点，
 * 默认落在**受保护**那一侧，要开口子得回来明写一个常量。
 *
 * T015 加进来的 `/me` 与 `/change-password` 正是照这条约定办的：**两个都留在这里**，
 * 因为它俩问的分别是「我是谁」与「改我自己的密码」，**先有身份才谈得上**——
 * 放行等于让没凭证的人来问「我是谁」。
 */
export function isAuthGatewayPath(pathname: string) {
  return pathname === PATH.login || pathname === PATH.logout
}

/**
 * **解析后**的配置形状（`{ required, secret }`）。理由与身份门里那份同名类型相同：
 * 类型位置的 `UserIdentity.Config` 是「键」，取值形状得走 `Context.Service.Shape`。
 */
type ResolvedConfig = Context.Service.Shape<typeof UserIdentity.Config>

/**
 * 在**启动路径**上解析密钥：缺 / 短于 32 字符一律抛，调用方不吞。
 *
 * 判据复用 `packages/auth` 的 `jwtSecret()`，不在这里重写「≥32 字符」——
 * 那个数只有一处定义，两边各写一份就会在改地板时漏掉一边。
 *
 * 与身份门里那份 `resolveSecret` 的**取向刻意相反**：门是**请求期**用的，
 * 密钥用不了时降级成「每个请求都 401」（fail-closed，但服务还在跑）；
 * 网关是**启动期**用的，用不了就**起不来**——带着弱密钥跑起来的每一天，
 * 全系统的凭证都处于可伪造状态（D-03）。
 */
function startupSecret(config: ResolvedConfig) {
  return jwtSecret({ [JWT_SECRET_ENV]: Option.getOrUndefined(config.secret) })
}

/**
 * 引导首个管理员（003 T019）：**层构造期跑一次**——「起不来好过带着没有管理员的状态跑起来」。
 *
 * 做两件事，次序是要求不是巧合：**先把迁移跑到最新**（`auth.user` 不存在时 `bootstrapAdmin`
 * 会当场报 42P01），**再调 `bootstrapAdmin`**（判据与三种处置见 `packages/auth/src/bootstrap.ts`）。
 * 「先迁移、后引导」由 `openhive-bootstrap.test.ts` 那条**不预先建表**的用例钉着。
 *
 * ⚠️ **开关只看 `OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO`，不看 `OPENHIVE_REQUIRE_USER_ID`**——
 * 于是它落在下面那个「网关没开就早退」之前。理由是一条失败模式：**若两个开关都要，部署方
 * 只设了引导变量时会得到一个静默的空操作**，系统照样在「一个管理员都没有」的状态下起来，
 * 而这正是 T019 存在的理由。宁可让「设了引导变量却没配 `PG_*`」当场炸——那是能被看见的失败。
 *
 * ⚠️ **不设变量时零影响**：不连库、不要 `PG_*`、不发查询。`bun run dev` 的行为逐字不变。
 *
 * ⚠️ **为什么用的是 `Effect.promise` 而不是 `tryPromise` + `catch`**：这里没有「预期内的失败」。
 * 引导失败、连不上库、迁移报错，一律是**缺陷**——层构造随之死掉，进程起不来。给它们编一个
 * 能被 catch 的类型，等于给「失败也继续启动」留了一道门，而那道门通向的就是锁死的系统。
 */
function bootstrap(database: () => ReturnType<typeof connect>) {
  const policeNo = process.env[BOOTSTRAP_ADMIN_POLICE_NO_ENV]
  if (!policeNo) return Effect.void

  return Effect.promise(async () => {
    // 与 `routes` 里那份同名函数不同，这里是**共用的**：本层的 `database()` 眼下已经要为
    // 每个请求刷活跃而长期持有一个连接池，引导再另开一个只是白多一份。
    const db = database()
    await migrate(db)
    return bootstrapAdmin(db, policeNo)
  })
}

/**
 * 剥离 + 覆盖注入。**必须排在身份门之前**（`server.ts` 里那条 provide 数组的次序），
 * 排在后面等于门先看到客户端自己填的头。
 */
export const layer = HttpRouter.middleware<{ requires: UserIdentity.Config; handles: unknown }>()(
  Effect.gen(function* () {
    // 连接**惰性建、建一次就留着**：`connect()` 每次调用都会新建一个连接池，
    // 按请求建 = 按请求泄漏（plan.md 风险点 R2）。
    //
    // 与 `routes` 里那份**同名同形但不能合并**：两处是各自层构造期的闭包。合并要么放到
    // 模块级——那样同一进程里多个 `app()` 会共用一条已经关掉的连接（测试直接失真，
    // 见 `@opencode-ai/auth/test-support` 的文件头），要么给连接加一个 Effect 服务——
    // 改动面更大（宪法 §I）。代价说清楚：一个进程里有**两个池**（这个刷活跃、那个跑
    // 登录/自查/改密），各按需增长，不是泄漏。
    let db: ReturnType<typeof connect> | undefined
    const database = () => (db ??= connect(process.env))

    yield* bootstrap(database)

    const config = yield* UserIdentity.Config
    if (!config.required) return (effect) => effect

    const secret = startupSecret(config)
    // 在**层构造期**解析（与 `startupSecret` 同一个理由）：配了个读不出来的值时，
    // 要的是「进程起不来」，不是「每个请求都静默不刷活跃」。
    const throttleSeconds = activityThrottleSeconds(process.env)

    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest

        // 先剥离、再按验签结果决定要不要注入。**「剥离」与「验签」是两件事**：
        // 客户端自带什么头都得先扔掉（那是输入），能不能放进一个真的 id 另说——
        // 验不过就让它**保持没有**，门那边自然会 401，而不是拿客户端的头当身份。
        const stripped = Headers.remove(UserIdentity.HEADER)(request.headers)
        const subject = yield* subjectOf(
          UserIdentity.cookieValue(stripped.cookie, UserIdentity.COOKIE_NAME),
          secret,
        )
        const headers = subject ? Headers.set(UserIdentity.HEADER, subject.id)(stripped) : stripped

        // 只有**认得出来的人**才算活跃。认不出就不刷——否则伪造的 Cookie 也能写别人的活跃时间，
        // 而那是把「谁在线」这条运维信号交给外人来写。
        if (subject) yield* recordActivity(database, subject.id, throttleSeconds)

        return yield* Effect.provideService(
          effect,
          HttpServerRequest.HttpServerRequest,
          request.modify({ headers }),
        )
      })
  }),
).layer

/**
 * 记一次活跃（003 T017）。**跑在每个已认证请求上**，所以两件事必须成立：
 *
 * ① **带节流**——客户端是轮询的，不节流这条 UPDATE 就是全系统最高频的写。窗口值在
 *    层构造期从配置读一次（`activityThrottleSeconds`），不是每请求读环境变量。
 * ② **失败被吞掉**（2026-10-01 裁定）——记活动是**非关键路径**，不该把业务请求带下水：
 *    PG 抖一下就让全平台用不了，代价明显大于收益。
 *
 * ⚠️ **代价如实记**：PG 长时间不可用时这一列会**静默停更**，僵尸识别偏保守（把还活跃的人
 * 算成不活跃）——方向是安全的（宁可漏停，不可误停）。
 * ⚠️ **吞掉不等于装作没发生**：留一行 warning，那是这件事唯一能被运维看见的地方。
 * ⚠️ **它排在请求处理之前、且是 `yield*`（不是 fork）**：一个已认证请求因此多一次往返。
 *    分叉出去能让它不占请求的延迟，但那样调用方与测试都抓不到它什么时候跑完——
 *    现在这条链是「请求返回时，活跃已经记上了」，这是测试能断言的形状。
 */
function recordActivity(
  database: () => ReturnType<typeof connect>,
  userId: string,
  throttleSeconds: number,
) {
  return Effect.tryPromise({
    try: () => touchActivity(database(), userId, { now: nowSeconds(), throttleSeconds }),
    catch: (cause) => cause,
  }).pipe(Effect.catch((cause) => Effect.logWarning("记录最后活跃时间失败", { userId, cause })))
}

/**
 * 验签取身份。`undefined` = 认不出（没带凭证 / 签名不符 / 过期 / 载荷缺字段），
 * 调用方据此**不注入**——它不区分原因，分辨「过期还是伪造」只对攻击者有用。
 */
function subjectOf(token: string | undefined, secret: string): Effect.Effect<TokenSubject | undefined> {
  if (!token) return Effect.succeed(undefined)
  return Effect.tryPromise({
    try: () => verifyToken(token, secret),
    catch: () => undefined,
  }).pipe(Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }))
}

/**
 * 登录/登出端点。**开关关时一个都不注册**——不是「注册了但拒绝」：今天所有客户端都还
 * 没有凭证，挂出来只会回一串 401，还会逼本机 dev 去配 PG 与密钥。
 *
 * 「不注册」在真应用里的表现**不是 404**：没有路由接管的路径会落到 UI 的 `/*` 兜底
 * （上游行为，回页面）。测试因此断言的是「没被登录端点处理」（不下发 Cookie、响应不是
 * JSON），不是状态码。
 */
export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* UserIdentity.Config
    if (!config.required) return

    const secret = startupSecret(config)

    // 连接**惰性建、建一次就留着**：`connect()` 每次调用都会新建一个连接池，
    // 按请求建 = 按请求泄漏；而放在层构造期又会让「只登出、不登录」的场景无谓地
    // 要求 `PG_*` 配置（登出根本不碰库）。
    let db: ReturnType<typeof connect> | undefined
    const database = () => (db ??= connect(process.env))

    yield* router.add("POST", PATH.login, (request) => handleLogin(request, database, secret))
    yield* router.add("POST", PATH.logout, () => Effect.succeed(handleLogout()))
    yield* router.add("GET", PATH.me, (request) => handleMe(request, database, secret))
    yield* router.add("POST", PATH.changePassword, (request) => handleChangePassword(request, database, secret))
  }),
)

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
/** 改密没有内容可回：成功与否已经由状态码说完，再回一段 JSON 只会多一个要跟着改的契约。 */
const NO_CONTENT = 204

const LoginBody = Schema.Struct({ policeNo: Schema.String, password: Schema.String })

function handleLogin(
  request: HttpServerRequest.HttpServerRequest,
  database: () => ReturnType<typeof connect>,
  secret: string,
) {
  return Effect.gen(function* () {
    // 请求体解不开 ⇒ 当成「没填对」走 400，不走 500：畸形 JSON 是客户端的事，不是服务端故障。
    const body = yield* request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    )
    const credentials = Schema.decodeUnknownOption(LoginBody)(body)
    if (Option.isNone(credentials)) {
      return HttpServerResponse.jsonUnsafe({ error: "请求体不是合法的警号与密码" }, { status: BAD_REQUEST })
    }

    return yield* Effect.tryPromise({
      try: () => login(database(), credentials.value, secret),
      catch: (cause) => cause,
    }).pipe(
      Effect.map(signedIn),
      // 只有一种错误能预期到（`login()` 的文档契约：账号不存在与密码错误抛同一个类型、
      // 同一句消息）。别的错误一律是**缺陷**——交给应用的错误层呈现，不要在这里
      // 编一句好听的话把它盖住。
      Effect.catch((cause) =>
        cause instanceof InvalidCredentialsError
          ? Effect.succeed(
              HttpServerResponse.jsonUnsafe({ error: cause.message }, { status: UNAUTHORIZED }),
            )
          : Effect.die(cause),
      ),
    )
  })
}

/** 登录成功的响应体。**逐字段列出**，不把 `LoginResult` 直接透传——它身上还有 `token`。 */
function signedIn(result: LoginResult) {
  return HttpServerResponse.jsonUnsafe(
    {
      id: result.subject.id,
      policeNo: result.subject.policeNo,
      name: result.subject.name,
      isAdmin: result.subject.isAdmin,
      mustChangePw: result.mustChangePw,
    },
    { headers: { "set-cookie": setCookieHeader(result.cookie) } },
  )
}

/**
 * 取**这次请求的调用者**：验 Cookie、验不了返回 `undefined`。
 *
 * 存在的理由只有一条：**userId 只能从这里来**。凡是「改某个账号」的端点，都从这个函数拿主体，
 * 绝不从请求体、查询串或 `X-User-ID` 里取——那些都是客户端说了算的输入。
 *
 * 走到本函数的请求**理应都已经过身份门**（这两条路径不在豁免名单里），所以 `undefined`
 * 在今天的链路上几乎不可能出现。仍然逐个判，是因为「门已经拦过了」是**环境**给的保证，
 * 而这个函数是**这一层**自己的判据：哪天有人把路径加进豁免名单，这里还是关着的。
 */
function caller(request: HttpServerRequest.HttpServerRequest, secret: string) {
  return subjectOf(UserIdentity.cookieValue(request.headers.cookie, UserIdentity.COOKIE_NAME), secret)
}

/**
 * 会话自查：把「我现在是谁、还要不要强制改密」告诉前端。
 *
 * 前端靠它一条请求决定三件事：显示登录页还是工作台、顶栏挂谁的名字、弹不弹强制改密框。
 * **刻意与登录成功回同一个形状**（见 `signedIn`）——前端因此只有一套身份结构要认，
 * 少一处「登录后能拿到的字段、刷新后拿不到」的漂移。
 *
 * `mustChangePw` 一律取**库里**的现值，不认可 Cookie 里的东西（cookie 里也没有）：
 * 民警改完密码刷新页面，这个框必须立刻不再弹。
 */
function handleMe(
  request: HttpServerRequest.HttpServerRequest,
  database: () => ReturnType<typeof connect>,
  secret: string,
) {
  return Effect.gen(function* () {
    const subject = yield* caller(request, secret)
    if (!subject) return unauthorized()

    const identity = yield* Effect.tryPromise({
      try: () => sessionIdentity(database(), subject.id),
      catch: (cause) => cause,
    }).pipe(Effect.orDie)

    // 查不到（账号没了）与已停用，在 `sessionIdentity` 里是同一个 `undefined`，对外也同一个 401。
    if (!identity) return unauthorized()

    return HttpServerResponse.jsonUnsafe(identity)
  })
}

const ChangePasswordBody = Schema.Struct({ currentPassword: Schema.String, newPassword: Schema.String })

/**
 * 自助改密（FR-006）：核当前密码 → 换新哈希 → 解除强制改密。
 *
 * **请求体里没有 `userId`，也永远不会有**。改谁的密码这件事由凭证决定，不由调用方声明——
 * 否则这就是一个「知道别人 id 就能改别人密码」的接口。测试里专门有一条塞进别人的 id 来钉这件事。
 *
 * 三种「填得不对」各自回**自己的那句话**（与登录失败刻意相反）：能走到这里说明已经通过鉴权，
 * 说清楚不构成枚举信号，而说不清只会让民警在一个其实填对了的框前反复试。
 * 别的错误一律是**缺陷**，交给应用的错误层——不在这里编一句好听的话盖住。
 *
 * ⚠️ **停用账号在这一条上仍能改密**（`/me` 会先把它挡在界面外，但接口本身不看状态）。
 * 影响为零：改完照样登不进来（`login()` 认状态），`mustChangePw` 清成 0 也无从生效。
 * 为它加一次查询不划算，故**如实记在这里**，而不是假装已经拦了。
 */
function handleChangePassword(
  request: HttpServerRequest.HttpServerRequest,
  database: () => ReturnType<typeof connect>,
  secret: string,
) {
  return Effect.gen(function* () {
    const subject = yield* caller(request, secret)
    if (!subject) return unauthorized()

    const body = yield* request.json.pipe(
      Effect.match({ onFailure: () => undefined as unknown, onSuccess: (value) => value as unknown }),
    )
    const payload = Schema.decodeUnknownOption(ChangePasswordBody)(body)
    if (Option.isNone(payload)) {
      return HttpServerResponse.jsonUnsafe({ error: "请求体不是合法的当前密码与新密码" }, { status: BAD_REQUEST })
    }

    return yield* Effect.tryPromise({
      try: () =>
        changePassword(database(), {
          userId: subject.id,
          currentPassword: payload.value.currentPassword,
          newPassword: payload.value.newPassword,
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.map(() => HttpServerResponse.empty({ status: NO_CONTENT })),
      Effect.catch((cause) => {
        const message = rejectedPassword(cause)
        return message === undefined
          ? Effect.die(cause)
          : Effect.succeed(HttpServerResponse.jsonUnsafe({ error: message }, { status: BAD_REQUEST }))
      }),
    )
  })
}

/** 三种「填得不对」的话都由领域错误自带；别的错误一律返回 `undefined`（= 走缺陷通道）。 */
function rejectedPassword(cause: unknown) {
  return cause instanceof EmptyNewPasswordError ||
    cause instanceof WeakNewPasswordError ||
    cause instanceof InvalidCurrentPasswordError
    ? cause.message
    : undefined
}

/** 认不出身份。响应体留空：这里没什么可对客户端说的，说多了只是给探测者回话。 */
function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

/**
 * 登出：把同一个 Cookie 用 `Max-Age=0` 覆盖掉。
 *
 * 描述复用 `sessionCookie("")` 再改 `maxAge`，而不是另写一句字面量——名字、`Path`、
 * `SameSite`、`HttpOnly` 就都只有一处定义，改一处两边同时生效。
 */
function handleLogout() {
  const cleared = sessionCookie("")
  return HttpServerResponse.empty({
    status: 204,
    headers: { "set-cookie": setCookieHeader({ ...cleared, options: { ...cleared.options, maxAge: 0 } }) },
  })
}

/**
 * 把 `SessionCookie` 描述拼成 `Set-Cookie` 头。
 *
 * 自己在网关这侧拼、不走框架的 `cookies` 通道：本仓库此前没有任何一处下发过 Cookie，
 * 用框架特性等于把「Cookie 到底有没有出现在响应头上」这件事押在一个**本项目没验过**的
 * 行为上，而它恰恰是「登录拿不到凭证」这类故障唯一的表现面。
 * 拼出来的字符串有测试逐项守着（`HttpOnly` / `SameSite` / `Path` / `Max-Age`）。
 */
function setCookieHeader(cookie: SessionCookie) {
  const attributes = [
    `Path=${cookie.options.path}`,
    `Max-Age=${cookie.options.maxAge}`,
    cookie.options.httpOnly ? "HttpOnly" : undefined,
    cookie.options.secure ? "Secure" : undefined,
    `SameSite=${cookie.options.sameSite === "lax" ? "Lax" : cookie.options.sameSite}`,
  ].filter((attribute) => attribute !== undefined)

  return [`${cookie.name}=${encodeURIComponent(cookie.value)}`, ...attributes].join("; ")
}
