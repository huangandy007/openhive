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
 * 头被中途剥掉、反代漏配），**不是伪造**。真正的信任边界是「只有网关够得着这个端口」
 * （回环绑定 / 网络策略，F3 落地）。把这道门当鉴权用，等于把门牌号当门锁。
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
