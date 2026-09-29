import { describe, expect, test } from "bun:test"
import { sign } from "hono/jwt"
import { JWT_SECRET_ENV, SESSION_COOKIE_NAME, TOKEN_TTL_SECONDS } from "./policy"
import { WeakJwtSecretError, jwtSecret, sessionCookie, signToken, verifyToken } from "./token"

const SECRET = "test-secret"
const SUBJECT = { id: "u1", policeNo: "000001", name: "张三", isAdmin: false }
/** 签发时刻之后若干秒的 Unix 时间戳。 */
const after = (seconds: number) => Math.floor(Date.now() / 1000) + seconds

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** 跑一次应当失败的校验，把抛出的错交回来；没抛则得到 undefined。 */
async function failureOf(action: Promise<unknown>): Promise<unknown> {
  try {
    await action
    return undefined
  } catch (cause) {
    return cause
  }
}

/** 不验签、直接看凭证载荷——用来断言**线格式**（字段名），不经过本模块的映射。 */
function payloadOf(token: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString())
  if (!isRecord(parsed)) throw new Error("凭证载荷不是对象")
  return parsed
}

describe("签发与校验", () => {
  test("签发的凭证可被校验，解析出 userId", async () => {
    const token = await signToken(SUBJECT, SECRET)

    expect((await verifyToken(token, SECRET)).id).toBe("u1")
  })

  test("载荷字段名与 design-v2 §4.1 一致（线格式契约）", async () => {
    const payload = payloadOf(await signToken(SUBJECT, SECRET))

    expect(Object.keys(payload).sort()).toEqual(["exp", "is_admin", "name", "police_no", "sub"])
    expect(payload.sub).toBe("u1")
    expect(payload.is_admin).toBe(false)
  })

  test("凭证在 2 小时后过期", async () => {
    const payload = payloadOf(await signToken(SUBJECT, SECRET))

    const remaining = Number(payload.exp) - after(0)
    expect(remaining).toBeGreaterThan(TOKEN_TTL_SECONDS - 5)
    expect(remaining).toBeLessThanOrEqual(TOKEN_TTL_SECONDS)
  })
})

describe("校验拒绝伪造与过期", () => {
  test("载荷被篡改的凭证被拒（签名对不上）", async () => {
    const parts = (await signToken(SUBJECT, SECRET)).split(".")
    const forged = Buffer.from(
      JSON.stringify({ sub: "attacker", police_no: "x", name: "x", is_admin: true, exp: after(600) }),
    ).toString("base64url")

    expect(await failureOf(verifyToken(`${parts[0]}.${forged}.${parts[2]}`, SECRET))).toBeInstanceOf(Error)
  })

  test("用别的密钥签的凭证被拒", async () => {
    const foreign = await signToken(SUBJECT, "another-secret")

    expect(await failureOf(verifyToken(foreign, SECRET))).toBeInstanceOf(Error)
  })

  test("已过期的凭证被拒", async () => {
    const expired = await sign({ sub: "u1", exp: after(-60) }, SECRET)

    expect(await failureOf(verifyToken(expired, SECRET))).toBeInstanceOf(Error)
  })

  test("签名合法但载荷缺字段的凭证被拒（不返回半个身份）", async () => {
    const partial = await sign({ sub: "u1", exp: after(600) }, SECRET)

    expect(await failureOf(verifyToken(partial, SECRET))).toBeInstanceOf(Error)
  })
})

describe("jwtSecret", () => {
  test("缺 AUTH_JWT_SECRET 时点名报错，不用默认密钥兜底", () => {
    expect(() => jwtSecret({})).toThrow(JWT_SECRET_ENV)
  })

  // HS256 的安全性**整个押在这个串上**：签名与验签用同一把钥匙，猜中它就能伪造任意身份的
  // 凭证——`is_admin: true` 只差一个字段。而短密钥可以离线枚举，本机几秒就试完；
  // RFC 7518 §3.2 对 HS256 的原文是「密钥长度 MUST ≥ 哈希输出长度」，即 256 bit。
  test("密钥短于 32 字符时拒绝——短密钥可离线枚举，而这里没有第二次机会", () => {
    expect(() => jwtSecret({ [JWT_SECRET_ENV]: "prod-secret" })).toThrow(WeakJwtSecretError)
  })

  test("报错点名环境变量与现有长度——运维要能直接照做", () => {
    expect(() => jwtSecret({ [JWT_SECRET_ENV]: "abc" })).toThrow(JWT_SECRET_ENV)
    expect(() => jwtSecret({ [JWT_SECRET_ENV]: "abc" })).toThrow("3")
  })

  test("32 字符及以上放行——32 是下限，不是要求恰好 32", () => {
    const secret = "x".repeat(32)
    expect(jwtSecret({ [JWT_SECRET_ENV]: secret })).toBe(secret)
    expect(jwtSecret({ [JWT_SECRET_ENV]: "y".repeat(64) })).toBe("y".repeat(64))
  })

  // 边界钉在「≥32 放行」上，而不是「<32 拒绝」——两条合起来才算把边界说死，
  // 只写一条时把 `<` 误写成 `<=` 不会有任何测试变红。
  test("恰好 31 字符仍拒绝——边界不多不少", () => {
    expect(() => jwtSecret({ [JWT_SECRET_ENV]: "z".repeat(31) })).toThrow(WeakJwtSecretError)
  })
})

describe("sessionCookie", () => {
  test("httpOnly，有效期与凭证一致", () => {
    const cookie = sessionCookie("tok")

    expect(cookie.name).toBe(SESSION_COOKIE_NAME)
    expect(cookie.value).toBe("tok")
    expect(cookie.options.httpOnly).toBe(true)
    expect(cookie.options.maxAge).toBe(TOKEN_TTL_SECONDS)
  })

  test("secure 由调用方决定，默认关（内网多为 HTTP，置 true 会让浏览器直接丢弃 Cookie）", () => {
    expect(sessionCookie("tok").options.secure).toBe(false)
    expect(sessionCookie("tok", { secure: true }).options.secure).toBe(true)
  })
})
