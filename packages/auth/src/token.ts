import { sign, verify } from "hono/jwt"
import { JWT_SECRET_ENV, SESSION_COOKIE_NAME, TOKEN_TTL_SECONDS } from "./policy"

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

/** 从环境变量取签名密钥。 */
export function jwtSecret(env: Record<string, string | undefined>): string {
  const secret = env[JWT_SECRET_ENV]
  if (!secret) throw new Error(`缺少环境变量 ${JWT_SECRET_ENV}`)
  return secret
}

/** 签发凭证，有效期 `TOKEN_TTL_SECONDS`。 */
export async function signToken(subject: TokenSubject, secret: string): Promise<string> {
  return sign(
    {
      sub: subject.id,
      police_no: subject.policeNo,
      name: subject.name,
      is_admin: subject.isAdmin,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    },
    secret,
  )
}

/**
 * 校验凭证并取回身份。签名不符、已过期、载荷缺字段一律抛错。
 *
 * 载荷校验不是「防御不可能的输入」：本函数的返回类型承诺了一个完整的 `TokenSubject`，
 * 校验是让这个承诺**不说谎**——否则调用方会拿到 `undefined` 却被类型告知是 `string`。
 */
export async function verifyToken(token: string, secret: string): Promise<TokenSubject> {
  const payload = await verify(token, secret)

  const { sub, police_no, name, is_admin } = payload
  if (
    typeof sub !== "string" ||
    typeof police_no !== "string" ||
    typeof name !== "string" ||
    typeof is_admin !== "boolean"
  ) {
    throw new Error("凭证载荷缺字段")
  }

  return { id: sub, policeNo: police_no, name, isAdmin: is_admin }
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
 */
export function sessionCookie(token: string, { secure = false } = {}): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: TOKEN_TTL_SECONDS },
  }
}
