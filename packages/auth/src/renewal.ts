import { REISSUE_REMAINING_SECONDS, SESSION_ABSOLUTE_CAP_SECONDS, TOKEN_TTL_SECONDS } from "./policy"
import { signToken, sessionCookie, type SessionCookie, type VerifiedSession } from "./token"

/**
 * 活跃续期（2026-10-13 用户裁定：滑动续期 ＋ 绝对上限 24 小时）。
 *
 * 网关每个已认证请求都过这一条：认得出身份、且当前凭证快到点了，就换发一张新的、
 * 把有效期往后推。推法受两条夹制：
 * - **滑动**：`现在 + 2 小时`（一直被推）。
 * - **上限**：`authTime + 24 小时`（`authTime` 是**这次登录**的时刻，换发时原样沿用，不重置）。
 *
 * 纯函数：时刻算术与 HTTP 无关，落在这里才好钉（TDD 的靶子）。网关只负责把结论接上
 * `Set-Cookie`。
 */

/** 现有凭证里与续期有关的两个时刻。`authTime` 是「这次登录」的时刻（不是换发时刻）。 */
export interface RenewalClock {
  authTime: number
  exp: number
}

/** 该不该换、以及换出来的新过期时刻。 */
export interface RenewalDecision {
  reissue: boolean
  /** 只有 `reissue` 为真时才有意义；为假时它是「若换会得到什么」，供调用方自查。 */
  nextExpiry: number
}

/**
 * 现在这一刻，该不该换发。
 *
 * `nextExpiry = min(现在 + 2h, authTime + 24h)` —— 先按滑动算，再用绝对上限夹一下。
 * 两道门都要过才换发：
 * ① **不足阈值**：`exp - 现在 < 1h`（否则每请求都写 `Set-Cookie`，纯噪音）；
 * ② **换得动**：`nextExpiry > exp`（已停在绝对上限上时两者相等——再换也是同一个时刻，
 *    白写一条 cookie，而且会让「上限已到」这件事在日志里显得像还在续）。
 */
export function reissueDecision(current: RenewalClock, now: number): RenewalDecision {
  const nextExpiry = Math.min(now + TOKEN_TTL_SECONDS, current.authTime + SESSION_ABSOLUTE_CAP_SECONDS)
  const runningLow = current.exp - now < REISSUE_REMAINING_SECONDS
  return { reissue: runningLow && nextExpiry > current.exp, nextExpiry }
}

/**
 * 该续就换发一张新 Cookie，否则 `undefined`。
 *
 * 网关拿到非 `undefined` 就把它拼成 `Set-Cookie` 挂到响应上——**判定与 cookie 构造都在这里**，
 * 网关那边只剩「挂头」这一下（那一层不好单测，留给真栈）。
 *
 * 三种 `undefined`：旧凭证没 `auth_time`（续不了）、还不到点、或换也延不了（见 `reissueDecision`）。
 */
export async function reissuedCookie(
  session: VerifiedSession,
  secret: string,
  now: number,
): Promise<SessionCookie | undefined> {
  if (session.authTime === undefined) return undefined
  const 判 = reissueDecision({ authTime: session.authTime, exp: session.exp }, now)
  if (!判.reissue) return undefined
  const token = await signToken(session.subject, secret, { authTime: session.authTime, now })
  return sessionCookie(token, { maxAge: 判.nextExpiry - now })
}
