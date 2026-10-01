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

/** 包一层而不是直接用 `fetch`：某些环境下裸调用会丢 `this`（Illegal invocation）。 */
const defaultSend: AuthFetch = (input, init) => fetch(input, init)

/**
 * 读一页响应里的身份。**读不出就返回 `undefined`**，不抛——
 * 「这不是我们那层」与「响应坏了」对调用方是同一种处置（放行 / 失败），分开只会多一条死路。
 *
 * 逐字段挑而不是整份透传：响应里多出来的字段不该悄悄变成前端状态的一部分，
 * 而缺了 `id` 的对象压根不配叫身份（它是后续一切请求的主体）。
 */
/**
 * 窄化到「一个可以按名字取字段的对象」。写成类型谓词而不是 `as`：
 * 断言会让 `no-unsafe-type-assertion` 报一条（本仓 `center/` 里既有同款告警，但那是存量；
 * 新文件的判据是 0 命中），而这里本来也只是个 `typeof` 检查。
 */
function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null
}

async function readIdentity(response: Response): Promise<Identity | undefined> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return undefined
  }
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
async function errorMessage(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json()
    if (!是对象(body)) return undefined
    const error = body.error
    return typeof error === "string" ? error : undefined
  } catch {
    return undefined
  }
}

/**
 * 启动时问一句「我现在是谁」。整个应用只需要这一条请求来决定显示登录页还是工作台。
 *
 * 判据的次序是刻意的：**先认 401**（网关在场且说没凭证），再看「200 且是一份身份」，
 * 其余一律 `unavailable`。反过来写（先看 2xx）会把 SPA 兜底那页 200 的 HTML 当成成功。
 */
export async function probeSession(send: AuthFetch = defaultSend): Promise<Session> {
  let response: Response
  try {
    response = await send(PATH.me, { method: "GET", credentials: "same-origin" })
  } catch {
    return { kind: "unavailable" }
  }

  if (response.status === 401) return { kind: "signed-out" }
  if (!response.ok) return { kind: "unavailable" }

  const identity = await readIdentity(response)
  return identity ? { kind: "signed-in", identity } : { kind: "unavailable" }
}

/**
 * 登录。成功时内核已下发 httpOnly Cookie，这里**拿不到也不该拿**令牌——身份随响应体回来。
 */
export async function login(
  policeNo: string,
  password: string,
  send: AuthFetch = defaultSend,
): Promise<LoginOutcome> {
  let response: Response
  try {
    response = await send(PATH.login, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policeNo, password }),
    })
  } catch {
    return { kind: "failed", message: LOGIN_FAILED }
  }

  if (response.status === 401) {
    return { kind: "rejected", message: (await errorMessage(response)) ?? LOGIN_FAILED }
  }
  if (!response.ok) return { kind: "failed", message: LOGIN_FAILED }

  const identity = await readIdentity(response)
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
): Promise<ChangeOutcome> {
  let response: Response
  try {
    response = await send(PATH.changePassword, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  } catch {
    return { kind: "failed", message: CHANGE_FAILED }
  }

  if (response.status === 400) {
    return { kind: "rejected", message: (await errorMessage(response)) ?? CHANGE_FAILED }
  }
  if (!response.ok) return { kind: "failed", message: CHANGE_FAILED }

  return { kind: "changed" }
}
