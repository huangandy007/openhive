import { describe, expect, test } from "bun:test"
import { REISSUE_REMAINING_SECONDS, SESSION_ABSOLUTE_CAP_SECONDS, TOKEN_TTL_SECONDS } from "./policy"
import { reissueDecision, reissuedCookie } from "./renewal"

/**
 * 活跃续期（2026-10-13 用户裁定：**滑动续期 ＋ 绝对上限 24 小时**）。
 *
 * 判据全在**纯函数**上——续期是「什么时候换发、换发的有效期多长」这条时刻算术，
 * 与 HTTP 无关，所以先把算术钉死（TDD 的靶子），再接网关那层。
 *
 * 记法：`现在` 是「这一刻」的 Unix 秒；`上限` = `authTime + 24h`，即这次登录绝对不可能被续过的那条线。
 */
const 现在 = 1_700_000_000

describe("续期判定", () => {
  test("刚签发（剩满 2 小时）⇒ 不换发", () => {
    const 现有 = { authTime: 现在, exp: 现在 + TOKEN_TTL_SECONDS }

    expect(reissueDecision(现有, 现在).reissue).toBe(false)
  })

  test("剩余恰好等于阈值 ⇒ 还不换（「不足一半」是严格小于，不到就不动）", () => {
    // authTime 取值不影响这一条（离上限还远）；只把 exp 摆在「剩恰好 1 小时」上。
    const 现有 = { authTime: 现在, exp: 现在 + REISSUE_REMAINING_SECONDS }

    expect(reissueDecision(现有, 现在).reissue).toBe(false)
  })

  test("剩余不足阈值 ⇒ 换发，新过期时刻 = 现在 + 2 小时", () => {
    const 现有 = { authTime: 现在, exp: 现在 + REISSUE_REMAINING_SECONDS - 1 }

    const 判 = reissueDecision(现有, 现在)

    expect(判.reissue).toBe(true)
    expect(判.nextExpiry).toBe(现在 + TOKEN_TTL_SECONDS)
  })

  test("快到绝对上限 ⇒ 新过期时刻被夹在 authTime+24h，不越过上限", () => {
    // 构造：上限落在「现在 + 1 小时」；现有凭证剩 59 分 59 秒（不足阈值 ⇒ 是候选）。
    const 现有 = { authTime: 现在 - (SESSION_ABSOLUTE_CAP_SECONDS - 3600), exp: 现在 + 3599 }

    const 判 = reissueDecision(现有, 现在)

    expect(判.reissue).toBe(true)
    expect(判.nextExpiry).toBe(现有.authTime + SESSION_ABSOLUTE_CAP_SECONDS)
  })

  test("换发也延不了（新过期时刻 == 现有 exp）⇒ 不换，省一条无意义的 Set-Cookie", () => {
    // 上限 = 现在 + 600 = 现有 exp：此刻换发只会得到同一个过期时刻。
    const 现有 = { authTime: 现在 - SESSION_ABSOLUTE_CAP_SECONDS + 600, exp: 现在 + 600 }

    expect(reissueDecision(现有, 现在).reissue).toBe(false)
  })

  test("已到绝对上限那一刻（凭证与上限同时到点）⇒ 不换发", () => {
    const 现有 = { authTime: 现在 - SESSION_ABSOLUTE_CAP_SECONDS, exp: 现在 }

    expect(reissueDecision(现有, 现在).reissue).toBe(false)
  })
})

/** 不验签、直接看凭证载荷——断言 `auth_time` / `exp` 的**线格式**。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function payloadOf(token: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString())
  if (!isRecord(parsed)) throw new Error("凭证载荷不是对象")
  return parsed
}

const 密钥 = "test-secret"
const 身份 = { id: "u1", policeNo: "000001", name: "张三", isAdmin: false }

describe("reissuedCookie：该续就换一张新 Cookie，否则 undefined", () => {
  test("旧凭证没有 auth_time ⇒ 不续（认得出、但续不了，让它自然过期）", async () => {
    const 会话 = { subject: 身份, exp: 现在 + 100 }

    expect(await reissuedCookie(会话, 密钥, 现在)).toBeUndefined()
  })

  test("还早（剩满 2 小时）⇒ 不续", async () => {
    const 会话 = { subject: 身份, exp: 现在 + TOKEN_TTL_SECONDS, authTime: 现在 }

    expect(await reissuedCookie(会话, 密钥, 现在)).toBeUndefined()
  })

  test("到点 ⇒ 换发：新凭证 auth_time 沿用旧值、exp = 现在 + 2h，cookie maxAge 与之一致", async () => {
    const 会话 = { subject: 身份, exp: 现在 + 100, authTime: 现在 - 3600 }

    const cookie = await reissuedCookie(会话, 密钥, 现在)

    expect(cookie).toBeDefined()
    expect(payloadOf(cookie!.value).auth_time).toBe(现在 - 3600)
    expect(payloadOf(cookie!.value).exp).toBe(现在 + TOKEN_TTL_SECONDS)
    expect(cookie!.options.maxAge).toBe(TOKEN_TTL_SECONDS)
  })

  test("到绝对上限附近 ⇒ 新 exp 被夹住，cookie maxAge = 新 exp − 现在（不是 2 小时）", async () => {
    // 上限 = 现在 + 600；现有凭证剩 300 秒（不足阈值 ⇒ 是候选）。
    const authTime = 现在 - (SESSION_ABSOLUTE_CAP_SECONDS - 600)
    const 会话 = { subject: 身份, exp: 现在 + 300, authTime }

    const cookie = await reissuedCookie(会话, 密钥, 现在)

    expect(cookie!.options.maxAge).toBe(600)
    expect(payloadOf(cookie!.value).exp).toBe(现在 + 600)
  })
})
