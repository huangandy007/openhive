export * as UserIdentity from "./user-identity"

import { ConfigService } from "@/effect/config-service"
import { JWT_SECRET_ENV, SESSION_COOKIE_NAME } from "@opencode-ai/auth/policy"
import { Config as EffectConfig } from "effect"

/**
 * openhive 的身份门：opencode 内核**不校验密码**，只认**验签过的**会话凭证（FR-012）。
 * 同目录的 `auth.ts` 是上游自带的 Basic Auth，两者是**替代**关系——本开关打开时
 * `OPENCODE_SERVER_PASSWORD` 不应再设（同时设等于两道门，且密码那道的口令要额外分发）。
 * 不设 `OPENCODE_SERVER_PASSWORD` 时上游那套中间件本就退化成直通（`auth.ts` 的 `required()`），
 * 所以「关闭 Basic Auth」**不需要改任何代码**，不设环境变量即可。
 *
 * 🔐 **身份来源 = 验签结果**（003 裁定【甲】· 真做验签，2026-09-29；2026-09-30 落地为 T003）。
 * 网关把登录时下发的 httpOnly Cookie 原样透传，内核用 002 已落地的
 * `packages/auth/src/token.ts` 的 `verifyToken` + `AUTH_JWT_SECRET` 验签，取 subject 为 userId。
 * 验不了就拒绝——**不是**「验不了当通过」。
 *
 * ⚠️ **`X-User-ID` 已降级为路由提示**（兼「注入链路是否健在」的探针），
 * **MUST NOT 被当作身份来源**：它是明文头，任何够得着这个端口的人都能自己填
 * `X-User-ID: <任意 id>`，包括填成管理员。内核只在它与验签结果**矛盾**时拒绝（fail-closed）——
 * 「缺失」不拒绝（提示不是必要条件），「不一致」拒绝（出现矛盾只有两种解释：链路被改写，或有人手工塞了头）。
 *
 * 🗓️ **本文件在 002 里的形态**是「读头 → 有则放行」，那道门**看起来像鉴权、实际不是**——
 * 002 的收尾评审把这层意思写进了注释（「把这道门当鉴权用，等于把门牌号当门锁」），
 * 2026-09-29 裁定后由 T003 **取代**（是取代，不是叠加）。下方 `HEADER` 保留是因为
 * 提示仍在用；它不再携带任何身份语义。
 * 链路不可达（回环绑定 / 网络策略，F3 落地）仍是必要前置——它是纵深防御的一层，不是唯一那层。
 */

/**
 * 网关注入的身份**提示**头。小写——Effect 的 `request.headers` 键是小写
 * （同 `authorization.ts` 读 `authorization`）。**不是凭证**，见文件头。
 */
export const HEADER = "x-user-id"

/**
 * 承载会话凭证的 Cookie 名。**不在这里写死名字**——和网关用同一个常量
 * （`packages/auth/src/policy.ts`），两侧各写一份就会在改名时静默失联。
 */
export const COOKIE_NAME = SESSION_COOKIE_NAME

export class Config extends ConfigService.Service<Config>()("@opencode/OpenhiveUserIdentityConfig", {
  /**
   * 是否要求每个请求都带**可验签的会话凭证**。**默认关**（002 裁定，2026-09-29；T003 沿用）。
   *
   * 002 落地时网关（F3）还不存在，没有一个客户端会发凭证——默认开等于把 app / desktop /
   * CLI / 内置 web UI 全部锁死在自己机器上。F3 网关上线时置 `OPENHIVE_REQUIRE_USER_ID=1` 打开。
   * **名字继续贴切**：变的是「怎么带身份」（明文头 → 可验签令牌），不是「要不要带」。
   */
  required: EffectConfig.boolean("OPENHIVE_REQUIRE_USER_ID").pipe(EffectConfig.withDefault(false)),

  /**
   * HS256 签名密钥，即 `AUTH_JWT_SECRET`。
   *
   * 是 `Option` 而不是必填：开关默认关时本机根本不该有这把密钥，做成必填会让
   * 「不设 `OPENHIVE_REQUIRE_USER_ID` 就跑 dev」这条零回归路径起不来。
   * **开关开着而密钥缺失/过短 ⇒ 一律拒绝**（fail-closed），由中间件用 002 的
   * `jwtSecret()` 判——密钥地板只有一处定义，核心里不另立一个数。
   */
  secret: EffectConfig.string(JWT_SECRET_ENV).pipe(EffectConfig.option),
}) {}

/**
 * 从 `Cookie` 头里取一个具名 Cookie 的值。
 *
 * 放在这里而不是某个中间件里：**网关（T014）与内核身份门（T003）都要读同一个 Cookie**，
 * 各写一份解析器，将来改编码规则时必漏一边（漏了不报错，只是「登录成功但一直未登录」）。
 *
 * 自己解而不引依赖：只需要读一个名字，而 `packages/opencode` 既没有 `cookie` 也没有 `hono`。
 * **只做这一件事**——无 `=` 的段、名字不匹配的段一律跳过，不认识的输入不抛错。
 */
export function cookieValue(header: string | undefined, name: string) {
  if (!header) return undefined
  for (const part of header.split(";")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== name) continue
    const raw = part.slice(separator + 1).trim()
    if (!raw) return undefined
    // 值可能被 URL 编码过（hono 的 setCookie 默认编码）。JWT 用的 base64url 字符集
    // 在 encodeURIComponent 下不变，所以正常路径上这是恒等变换；解不开就按原文用，
    // 反正下一步验签会把它判掉。
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return undefined
}
