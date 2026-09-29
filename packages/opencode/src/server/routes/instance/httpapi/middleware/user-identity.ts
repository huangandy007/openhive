import { UserIdentity } from "@/server/user-identity"
import { isPublicUIPath } from "@/server/shared/public-ui"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

const UNAUTHORIZED = 401

/**
 * openhive 身份门（002 T018，全局中间件，装法同 `corsVaryFix`）。
 *
 * 开关关 → **直通**，与加这道门之前逐字相同；开关开 → 没有 `X-User-ID` 一律 401。
 * 开关与信任模型见 `@/server/user-identity`，这里只陈述**放行规则**的两处刻意选择：
 *
 * 1. **空白按没有处理**。网关注入链路坏掉时送的是空串或空白，不是「没有这个头」；放行等于给下游
 *    一个**空身份**，而空身份在 F3 会被当成一个合法的路由键——宁可当场 401。
 * 2. **公共 UI 资源豁免**（与 Basic Auth 同款，见 `@/server/shared/public-ui`）。浏览器取 PWA
 *    manifest 的请求不带任何应用层凭证，拦了会让 PWA 装不上（上游 #25698）。
 *
 * 拒绝时**不发** `www-authenticate`：那是让浏览器弹 Basic 登录框用的，这里没有 Basic，
 * 发了只会弹出一个永远填不对的框。
 */
export const userIdentityLayer = HttpRouter.middleware<{ requires: UserIdentity.Config; handles: unknown }>()(
  Effect.gen(function* () {
    const config = yield* UserIdentity.Config
    if (!config.required) return (effect) => effect

    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, "http://localhost")
        if (isPublicUIPath(request.method, url.pathname)) return yield* effect

        // 不必 `.trim()`：HTTP 层已按 RFC 9110 去掉字段值的首尾空白，纯空白值到这已是 `""`
        // （实测 `"   "` → `""`、`" u_1 "` → `"u_1"`）。`!userId` 一并挡住空串与缺失两种。
        const userId = request.headers[UserIdentity.HEADER]
        if (!userId) return HttpServerResponse.empty({ status: UNAUTHORIZED })

        return yield* effect
      })
  }),
).layer
