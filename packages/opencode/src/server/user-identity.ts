export * as UserIdentity from "./user-identity"

import { ConfigService } from "@/effect/config-service"
import { Config as EffectConfig } from "effect"

/**
 * openhive 的身份门：opencode 内核**不校验密码**，只认网关注入的用户身份标识（FR-012）。
 * 同目录的 `auth.ts` 是上游自带的 Basic Auth，两者是**替代**关系——本开关打开时
 * `OPENCODE_SERVER_PASSWORD` 不应再设（同时设等于两道门，且密码那道的口令要额外分发）。
 * 不设 `OPENCODE_SERVER_PASSWORD` 时上游那套中间件本就退化成直通（`auth.ts` 的 `required()`），
 * 所以「关闭 Basic Auth」**不需要改任何代码**，不设环境变量即可。
 *
 * ⚠️ **`X-User-ID` 不是凭证，是网关与内核之间的内部约定**。它是明文头，任何够得着这个端口的人
 * 都能自己填 `X-User-ID: <任意 id>`，包括填成管理员。这道门拦的是**注入链路的缺失**（网关没跑、
 * 头被中途剥掉、反代漏配），**不是伪造**。
 *
 * 🔐 **「不可伪造」由验签保证，不由这道门保证**（003 裁定【甲】· 真做验签，2026-09-29）。
 * 内核 MUST 以**验签结果**为身份来源：网关透传会话 JWT，内核用 002 已落地的
 * `packages/auth/src/token.ts` 的 `verifyToken` + `AUTH_JWT_SECRET` 验签，取 subject 为 userId。
 * 本文件的 `X-User-ID` 因此**降级为路由提示**（兼「注入链路是否健在」的探针），
 * **MUST NOT 被当作身份来源**；与验签结果不一致时以验签为准并拒绝（fail-closed）。
 * （这道门是保留还是被验签门取代，见 `003` 的 T003——**别把它当已定案**。）
 * 链路不可达（回环绑定 / 网络策略，F3 落地）仍是必要前置——它是纵深防御的一层，不是唯一那层。
 * 把这道门当鉴权用，等于把门牌号当门锁。
 */

/** 网关注入的身份头。小写——Effect 的 `request.headers` 键是小写（同 `authorization.ts` 读 `authorization`）。 */
export const HEADER = "x-user-id"

export class Config extends ConfigService.Service<Config>()("@opencode/OpenhiveUserIdentityConfig", {
  /**
   * 是否要求每个请求都带 `X-User-ID`。**默认关**（002 裁定，2026-09-29）。
   *
   * 002 落地时网关（F3）还不存在，没有一个客户端会发这个头——默认开等于把 app / desktop /
   * CLI / 内置 web UI 全部锁死在自己机器上。F3 网关上线时置 `OPENHIVE_REQUIRE_USER_ID=1` 打开。
   * 门与测试都在 002 内落地，只是默认不生效。
   */
  required: EffectConfig.boolean("OPENHIVE_REQUIRE_USER_ID").pipe(EffectConfig.withDefault(false)),
}) {}
