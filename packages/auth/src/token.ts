import { sign, verify } from "hono/jwt"
import { JWT_SECRET_ENV, SESSION_ABSOLUTE_CAP_SECONDS, SESSION_COOKIE_NAME, TOKEN_TTL_SECONDS } from "./policy"

/**
 * 登录凭证（JWT）的签发与校验，以及承载它的 Cookie 描述。
 *
 * 载荷字段与 `design-v2 §4.1`（`2026-09-06-openhive-design-v2.md:150`）一致：
 * `{ sub, police_no, name, is_admin, exp }`。签名算法取 `hono/jwt` 默认的 HS256。
 */

/** 签发凭证所需的身份信息。刻意只收这 4 个字段，不把整行用户记录传进来。 */
export interface TokenSubject {
  id: string
  policeNo: string
  name: string
  isAdmin: boolean
}

/**
 * HS256 密钥的下限：**32 字符**。
 *
 * 依据是 RFC 7518 §3.2——HMAC 的密钥长度 MUST ≥ 哈希输出长度，HS256 即 256 bit（32 字节）。
 * 判的是**字符数**（`String.length`，即 UTF-16 码元），对 ASCII 的随机 hex / base64 串成立
 * （「1 字符 = 1 字节」）。非 ASCII 会**偏保守**：20 个汉字是 60 字节、已然够 RFC 的数，
 * 却会被拦下——方向落在安全侧，故不为此加分字节的分支。
 *
 * 这是**地板，不是强度计**：它只拦「一眼就看得出顶不住枚举」的密钥（`prod-secret`、占位符、
 * 从别处抄来的短口令），不做熵估算、不查弱口令表。与 `changePassword` 里那组检查同一个立场
 * （见 `password.ts`）——拦得住「填了等于没填」，拦不住「填了一个自以为很妙的口令」。
 */
const MIN_SECRET_LENGTH = 32

/** 签名密钥太短——HS256 的安全性整个押在它上面，短密钥可离线枚举。 */
export class WeakJwtSecretError extends Error {
  constructor(length: number) {
    super(`${JWT_SECRET_ENV} 太短（${length} 字符），至少需要 ${MIN_SECRET_LENGTH} 字符`)
    this.name = "WeakJwtSecretError"
  }
}

/**
 * 从环境变量取签名密钥。
 *
 * 为什么在**取的时候**就判强度、而不是等签发时：调用方应在**启动路径**上取一次并留着，
 * 于是失败即「起不来」，运维当场就看见并去改环境变量；拖到签发时才抛，症状是
 * 「能登录、但登录接口 500」，排查要多绕好几层。宁可起不来，不可带着弱密钥跑起来——
 * 它跑起来的每一天，全系统的凭证都处于可伪造状态。
 *
 * ⚠️ **上面那句是「调用方应当如此」，不是本函数已经做到的事**：截至 002 收尾，全仓库
 * **没有任何生产代码调用本函数**（调用者只有 `token.test.ts`）。真正的执行点是 003 的网关
 * （`003-multi-tenant-isolation/tasks.md` 的 T014），它必须①在启动时调一次、②把
 * **≥32 字符**这条写进部署文档——否则运维要等到网关那侧报错才知道有这条地板。
 */
export function jwtSecret(env: Record<string, string | undefined>): string {
  const secret = env[JWT_SECRET_ENV]
  if (!secret) throw new Error(`缺少环境变量 ${JWT_SECRET_ENV}`)
  if (secret.length < MIN_SECRET_LENGTH) throw new WeakJwtSecretError(secret.length)
  return secret
}

/** 签发凭证时的两个时刻（都省略＝用真实时钟的现在）。 */
export interface SignTokenOptions {
  /**
   * **这次登录**的时刻——换发时**沿用旧凭证里的值，不重置**。它是绝对上限的锚点
   * （`authTime + 24h`），重置它等于每次都重新给一个 24 小时窗口，上限就形同虚设。
   */
  authTime?: number
  /** 现在这一刻。省略＝真实时钟；测试注入用。 */
  now?: number
}

/**
 * 签发凭证。有效期 `TOKEN_TTL_SECONDS`（滑动窗口），再被 `authTime + SESSION_ABSOLUTE_CAP_SECONDS`
 * 夹一下——登录时两者同为「现在 + 2h」，换发时后者才可能更早（见 `renewal.ts`）。
 * 载荷多一个 `auth_time`（2026-10-13 活跃续期加；design-v2 §4.1 原文只列了另外五个）。
 */
export async function signToken(
  subject: TokenSubject,
  secret: string,
  options: SignTokenOptions = {},
): Promise<string> {
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const authTime = options.authTime ?? now
  return sign(
    {
      sub: subject.id,
      police_no: subject.policeNo,
      name: subject.name,
      is_admin: subject.isAdmin,
      auth_time: authTime,
      exp: Math.min(now + TOKEN_TTL_SECONDS, authTime + SESSION_ABSOLUTE_CAP_SECONDS),
    },
    secret,
  )
}

/** 验签后取回的**全部声明**：身份，加上续期要用的两个时刻。 */
export interface VerifiedSession {
  subject: TokenSubject
  exp: number
  /**
   * 这次登录的时刻。**可缺**——部署前签发的旧凭证里没有 `auth_time`。缺了 ⇒ 续不了
   * （`renewal.ts` 那边据此跳过），但**照旧认得出身份**：不能因为多要一个字段，就把当期
   * 在线的人全踢下线。
   */
  authTime?: number
}

/**
 * 校验凭证并取回全部声明。签名不符、已过期、载荷缺字段一律抛错。
 *
 * 载荷校验不是「防御不可能的输入」：本函数的返回类型承诺了一个完整的 `VerifiedSession`，
 * 校验是让这个承诺**不说谎**——否则调用方会拿到 `undefined` 却被类型告知是 `string`。
 * `exp` 是硬要求（续期没有它没法算）；`auth_time` 是可选的（见上）。
 */
export async function verifySession(token: string, secret: string): Promise<VerifiedSession> {
  const payload = await verify(token, secret)

  const { sub, police_no, name, is_admin, exp, auth_time } = payload
  if (
    typeof sub !== "string" ||
    typeof police_no !== "string" ||
    typeof name !== "string" ||
    typeof is_admin !== "boolean" ||
    typeof exp !== "number"
  ) {
    throw new Error("凭证载荷缺字段")
  }

  return {
    subject: { id: sub, policeNo: police_no, name, isAdmin: is_admin },
    exp,
    authTime: typeof auth_time === "number" ? auth_time : undefined,
  }
}

/** 只要身份——既有的调用方用这个（`verifySession` 的薄封装）。 */
export async function verifyToken(token: string, secret: string): Promise<TokenSubject> {
  return (await verifySession(token, secret)).subject
}

/** 交给网关下发的 Cookie 描述（`Set-Cookie` 三要素：名、值、属性）。 */
export interface SessionCookie {
  name: string
  value: string
  options: {
    httpOnly: boolean
    secure: boolean
    sameSite: "lax"
    path: string
    maxAge: number
  }
}

/**
 * 把凭证包成 httpOnly Cookie。
 *
 * `secure` 默认**关**：内网部署多为 HTTP，置 true 会让浏览器直接丢弃 Cookie，症状是
 * 「登录成功但立刻又未登录」，很难归因。网关前挂了 HTTPS 时再由调用方开。
 *
 * `maxAge` 默认 2 小时（登录那一次）。**续发时要传新凭证的真实剩余寿命**——到绝对上限附近换发的
 * 凭证活不到 2 小时，若 cookie 仍写 2 小时，浏览器会留着一个内核已不认的凭证，症状是
 * 「明明还登着，却处处 401」。
 */
export function sessionCookie(
  token: string,
  { secure = false, maxAge = TOKEN_TTL_SECONDS } = {},
): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge },
  }
}
