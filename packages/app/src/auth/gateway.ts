/**
 * 前端的网关客户端（003 T015-c）：把内核回的 HTTP 形状翻译成界面能用的结论。
 *
 * **一律走同源相对路径**（`/openhive/auth/…`），不拼 `useServer()` 的绝对地址。理由：生产里
 * 前端由内核自己伺服（构建期把 `packages/app/dist` 内嵌进二进制），同源是天然成立的，Cookie
 * 也跟着天然可用、零 CORS；而在 dev 下由 `vite.config.ts` 的 `server.proxy` 把这段前缀转给内核。
 * 走绝对地址则要处理跨源 Cookie（`SameSite` + `credentials` 两头都得对），换来的是同一个结果。
 *
 * ⚠️ **这一层不是安全边界**。它决定的是「显示登录页还是工作台」，而一个能改前端的人当然也能
 * 跳过它——真正的门禁在内核的身份门（`packages/opencode/src/server/routes/instance/httpapi/middleware/user-identity.ts`）。
 * 这里唯一的职责是：别把「网关不在」判成「没登录」，也别反过来。
 */

/** 只用到的那一小片 `fetch`。取窄类型是为了让测试注入替身时不必伪造整个 `fetch`。 */
export type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>

const PREFIX = "/openhive/auth"

/**
 * 与内核 `AuthGateway.PATH`（`packages/opencode/src/server/openhive/gateway.ts`）逐字对应。
 *
 * 这份是**线格式契约的两端**，刻意在两边各写一份常量而不是共享：前端包不该 import 内核源码
 * （那是另一棵依赖树，也会把内核的类型拖进构建）。测试里同样写**字面量**而不引这里——
 * 引了就变成「实现和它自己比对」，改错一个字母两边一起错。
 */
export const PATH = {
  login: `${PREFIX}/login`,
  me: `${PREFIX}/me`,
  changePassword: `${PREFIX}/change-password`,
} as const

/**
 * 会话身份。四个字段之外还带 `mustChangePw`——它与 `/me` 的响应**刻意同形状**（内核那边
 * 这么设计就是为了让前端只有一套身份结构要认），登录后能拿到的字段与刷新后拿到的完全一致。
 */
export interface Identity {
  id: string
  policeNo: string
  name: string
  isAdmin: boolean
  mustChangePw: boolean
}

/**
 * 启动探查的三种结论。
 *
 * - `signed-in`：有身份，进工作台；
 * - `signed-out`：网关认得出「没凭证」（401），显示登录页；
 * - `unavailable`：**这一层根本不在**——开关关着时网关一个端点都不注册，请求会落到上游 SPA 的
 *   `/*` 兜底回一页 HTML（或缺了网关的旧内核回 404、内核没起时干脆连不上）。
 *   **一律放行**：`bun run dev` 的开关默认关，把它当「没登录」等于本机开发全站进不去。
 */
export type Session = { kind: "signed-in"; identity: Identity } | { kind: "signed-out" } | { kind: "unavailable" }

export type LoginOutcome =
  | { kind: "signed-in"; identity: Identity }
  /** 凭证被拒（401）。消息来自服务端，**前端不自己改写**。 */
  | { kind: "rejected"; message: string }
  /** 服务端故障 / 网络不通。**与「凭证被拒」分开**：说成密码错会让民警在一个其实填对了的框前反复试。 */
  | { kind: "failed"; message: string }

export type ChangeOutcome =
  | { kind: "changed" }
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string }

const LOGIN_FAILED = "登录请求失败"
const CHANGE_FAILED = "改密请求失败"

/**
 * 一次请求的上限（审查 R-09，2026-10-02）。
 *
 * 防的不是「拒绝」也不是 500——那两种都有响应、都会走到既有的翻译规则里。防的是内核
 * **收了请求却不答**：进程还在、连接还在，就是没有下文。浏览器的 `fetch` 在这上面**没有**
 * 默认超时，于是三条链各自把用户钉死在一个没有出口的地方——探查挂着 = 永久白屏（连登录页
 * 都不显示）、登录挂着 = 永远「登录中…」、改密挂着 = 永远「提交中…」。
 *
 * 取 10 秒：三条链的正常往返都是本地同源的一次查询或一次口令校验，量级在几十毫秒；
 * 留到十秒是给「内核正在启动 / 机器正忙」的余量，不是给慢网络的（这一层压根不做跨网）。
 */
export const TIMEOUT_MS = 10_000

/**
 * 给一次请求套上超时。到点做两件事：**断掉底层请求**再抛出去。
 *
 * - 「断掉」不能省：只做「我们不等了」的话，那次请求还挂在连接上、内核真回来了也没人接。
 * - **抛**而不是另立一个返回值：三条链现成的 `catch` 已经把「请求没成」翻成了各自的结论
 *   （探查放行 / 登录改密失败），正是想要的落点。放行那一支尤其对——内核挂着的时候，
 *   显示登录页也登不进去，只会把人锁在一个用不了的框前面。
 * - `finally` 清定时器：正常返回、超时、替身抛错三条路都要走到，漏了它一个 10 秒的定时器
 *   会让调用方（尤其是短命进程与测试）白等一场。
 *
 * ## 两个绕过去的形状（复查 R2-04，2026-10-02）
 *
 * 上面那三条只覆盖了「`跑` 返回一张**永不落定**的 promise」。另有两个形状会从旁边绕过去：
 *
 * 1. **`跑` 同步抛**（`fetch` 在某些环境丢 `this` ⇒ `Illegal invocation`）。`跑(...)` 是**同步求值**的，
 *    它一抛，下面那个 `Promise.race` 根本没被建起来 ⇒ `超时` 无人认领，到点就是一记**未处理拒绝**
 *    （Node 下默认终止进程），而定时器还多按事件循环 10 秒（旧实现正是这么写的，实测见过）。
 *    **防法是让 `跑` 一律是 `async` 函数**（三个调用点都经由 `roundTrip`）：同步抛在 `async` 函数体里
 *    一律变成拒绝，`race` 接得住、`finally` 照常清定时器。类型上区分不出「async 函数」与
 *    「返回 promise 的普通函数」，所以这条靠 `gateway.test.ts` 的
 *    「替身**同步**抛出 ⇒ 不留一个没人认领的定时器」守着——谁把 `roundTrip` 改回同步写法，那条就红。
 * 2. **读体在窗口外**。「拿到响应头」不等于「这次请求成了」：内核答了头却卡在写体时，
 *    调用方照样被钉死。故 `跑` 传进来的回调必须**连体读完**（见 `roundTrip`）。
 *
 * 两处都实测过：旧实现（读体在 `带超时` 之后）在「体一直不来」上会永久挂住；
 * 而「改密 + 200 + 体被 abort 打断」在旧实现下直接回 `changed`——**报成功，其实一次都没成**。
 *
 * 顺带记一笔**没写**的东西：本来还想在 `.then` 里拦「abort 之后才落定的不算落定」，实测是多余的
 * ——`拒(...)` 紧跟 `abort()` 同步落定，超时那条**永远先赢**，被 abort 打断的体读根本来不及
 * 落定（打字时以为它抢先）。`gateway.test.ts` 的「200 但体被超时打断 ⇒ 不算改成功」在删掉那段
 * 后依旧全绿，就是这么发现的：没被测试逼出来的代码不留。
 */
function 带超时<T>(毫秒: number, 跑: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const 控制器 = new AbortController()
  let 定时器: ReturnType<typeof setTimeout> | undefined

  const 超时 = new Promise<never>((_, 拒) => {
    定时器 = setTimeout(() => {
      控制器.abort()
      拒(new Error(`请求超时（${毫秒}ms）`))
    }, 毫秒)
  })

  return Promise.race([跑(控制器.signal), 超时]).finally(() => {
    if (定时器 !== undefined) clearTimeout(定时器)
  })
}

/** 包一层而不是直接用 `fetch`：某些环境下裸调用会丢 `this`（Illegal invocation）。 */
const defaultSend: AuthFetch = (input, init) => fetch(input, init)

/**
 * 一次请求的结论：状态码 + **已经读干净的**响应体（读不出来 = `undefined`）。
 *
 * 体为什么在这里读、而不在下面两个翻译函数里：它必须发生在 `带超时` 的预算**之内**
 * （复查 R2-04，理由见 `带超时` 的注释第 2 条）。
 */
interface Reply {
  readonly status: number
  readonly ok: boolean
  readonly body: unknown
}

/**
 * 读体。**读不出就 `undefined`**，不抛——「这不是我们那层」与「响应坏了」对调用方是
 * 同一种处置（放行 / 失败），分开只会多一条死路。204 那种没有体的成功响应也走这条路。
 */
async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * 发出一次请求并**连体读完**。超时罩的是**一次完整的请求**，不是「拿到响应头」为止
 * ——这就是它单独成函数、且读体必须在里面完成的理由（复查 R2-04）。
 *
 * `init` 里含 `signal`，与响应体流同生共死：到点 abort，卡在写体的那次读也一并断掉。
 */
const roundTrip =
  (send: AuthFetch, path: string, init: RequestInit) =>
  async (signal: AbortSignal): Promise<Reply> => {
    const response = await send(path, { ...init, signal })
    return { status: response.status, ok: response.ok, body: await readBody(response) }
  }

/**
 * 窄化到「一个可以按名字取字段的对象」。写成类型谓词而不是 `as`：
 * 断言会让 `no-unsafe-type-assertion` 报一条（本仓 `center/` 里既有同款告警，但那是存量；
 * 新文件的判据是 0 命中），而这里本来也只是个 `typeof` 检查。
 */
function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null
}

/**
 * 从一份**已经读出来的**体里挑出身份（读体是 `readBody` 的事）。**挑不出就返回 `undefined`**，不抛（同上）。
 *
 * 逐字段挑而不是整份透传：响应里多出来的字段不该悄悄变成前端状态的一部分，
 * 而缺了 `id` 的对象压根不配叫身份（它是后续一切请求的主体）。
 */
function readIdentity(body: unknown): Identity | undefined {
  if (!是对象(body)) return undefined

  if (typeof body.id !== "string" || typeof body.policeNo !== "string" || typeof body.name !== "string") {
    return undefined
  }

  return {
    id: body.id,
    policeNo: body.policeNo,
    name: body.name,
    isAdmin: body.isAdmin === true,
    mustChangePw: body.mustChangePw === true,
  }
}

/** 取服务端那句话（`{ error: string }`）。取不到就是 `undefined`，由调用方兜底。 */
function errorMessage(body: unknown): string | undefined {
  if (!是对象(body)) return undefined
  const error = body.error
  return typeof error === "string" ? error : undefined
}

/**
 * 启动时问一句「我现在是谁」。整个应用只需要这一条请求来决定显示登录页还是工作台。
 *
 * 判据的次序是刻意的：**先认 401**（网关在场且说没凭证），再看「200 且是一份身份」，
 * 其余一律 `unavailable`。反过来写（先看 2xx）会把 SPA 兜底那页 200 的 HTML 当成成功。
 *
 * `超时毫秒` 与 `send` 一样是**留给测试的缝**：省略 = `TIMEOUT_MS`。生产调用方一律省略。
 */
export async function probeSession(send: AuthFetch = defaultSend, 超时毫秒: number = TIMEOUT_MS): Promise<Session> {
  let reply: Reply
  try {
    reply = await 带超时(超时毫秒, roundTrip(send, PATH.me, { method: "GET", credentials: "same-origin" }))
  } catch {
    return { kind: "unavailable" }
  }

  if (reply.status === 401) return { kind: "signed-out" }
  if (!reply.ok) return { kind: "unavailable" }

  const identity = readIdentity(reply.body)
  return identity ? { kind: "signed-in", identity } : { kind: "unavailable" }
}

/**
 * 登录。成功时内核已下发 httpOnly Cookie，这里**拿不到也不该拿**令牌——身份随响应体回来。
 */
export async function login(
  policeNo: string,
  password: string,
  send: AuthFetch = defaultSend,
  超时毫秒: number = TIMEOUT_MS,
): Promise<LoginOutcome> {
  let reply: Reply
  try {
    reply = await 带超时(
      超时毫秒,
      roundTrip(send, PATH.login, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policeNo, password }),
      }),
    )
  } catch {
    return { kind: "failed", message: LOGIN_FAILED }
  }

  if (reply.status === 401) {
    return { kind: "rejected", message: errorMessage(reply.body) ?? LOGIN_FAILED }
  }
  if (!reply.ok) return { kind: "failed", message: LOGIN_FAILED }

  const identity = readIdentity(reply.body)
  return identity ? { kind: "signed-in", identity } : { kind: "failed", message: LOGIN_FAILED }
}

/**
 * 自助改密。**请求体里没有 userId**——改谁的密码由 Cookie 决定，不由调用方声明
 * （内核那边专门有一条测试塞别人的 id 来钉这件事）。
 *
 * 成功是 204（无内容）。三种「填得不对」回 400 + 各自的 `error`，那是能安全说清楚的；
 * 其余（500 / 网络）一律 `failed`，不编一句像密码错的话盖住。
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  send: AuthFetch = defaultSend,
  超时毫秒: number = TIMEOUT_MS,
): Promise<ChangeOutcome> {
  let reply: Reply
  try {
    reply = await 带超时(
      超时毫秒,
      roundTrip(send, PATH.changePassword, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    )
  } catch {
    return { kind: "failed", message: CHANGE_FAILED }
  }

  if (reply.status === 400) {
    return { kind: "rejected", message: errorMessage(reply.body) ?? CHANGE_FAILED }
  }
  if (!reply.ok) return { kind: "failed", message: CHANGE_FAILED }

  return { kind: "changed" }
}
