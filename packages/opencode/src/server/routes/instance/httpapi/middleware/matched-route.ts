export * as MatchedRoute from "./matched-route"

import { Effect, Option } from "effect"
import { HttpRouter } from "effect/unstable/http"

/**
 * **本次请求匹配到的路由**——路由表里的规范形状，不是请求 URL 的原文。
 *
 * ## 为什么不能拿 `new URL(request.url).pathname` 去比
 *
 * 审查（R-01）修完之后的复查（2026-10-02）抓到：两处守卫都用**请求路径原文**做字面比对
 * ——`anchor-workspace.ts` 的 `needsLocation` 比 `=== "/api/session"`、
 * `session-quota.ts` 的路径式守卫比 `/^\/session\/([^/]+)\/message$/`。而真正决定「这一枪打到哪个
 * 端点」的是路由匹配器 `find-my-way-ts`，它的默认选项是
 * `ignoreTrailingSlash: true` / `ignoreDuplicateSlashes: true` / `caseSensitive: false`，
 * 且在匹配前还会 `decodeURI` 一遍。实测（2026-10-02，真路由树）这些写法**全部命中同一个端点**：
 * `/api/session/`、`/api//session`、`/API/SESSION`、`/api/%73ession`、
 * `/session/ses_x/message/`、`/session//ses_x/message`、`/session/ses_x/mess%61ge`，
 * 另加 `;`（匹配器把 `;` 也当查询串分隔符，`/session/ses_x/message;x` 同样命中）。
 *
 * 于是「一个字符的写法差异」就够绕过守卫：比原文字面量的那一半失效，而下游照样执行——
 * **两条判据各算各的，谁也不知道对方在算什么**。这正是 `LEARNINGS #002-01` 的形状。
 *
 * ## 为什么不镜像那套归一化
 *
 * 镜像要在本仓再写一遍 `removeDuplicateSlashes → safeDecodeURI → trimLastSlash → toLowerCase`，
 * 且要跟住上游改选项——那是**自己造一个新的漂移点**去修一个漂移点。`HttpRouter.RouteContext`
 * 是 Effect 路由在匹配成功后放进上下文里的**匹配结果本身**（`HttpRouter.js` 的 `asHttpEffect`：
 * 匹配完就 `contextMap.set(RouteContext.key, { route, params })`，再拿这个上下文跑路由处理器）。
 * 中间件——**路由级与端点级都算**——跑在处理器之内，所以都读得到；匹配器怎么归一化，
 * 这里就是什么样，不存在第二份归一化规则。
 *
 * ## 读不到的时候
 *
 * 返回 `undefined`（`RouteContext` 不在上下文里）。它意味着「这条中间件不是挂在一条已匹配的
 * 路由上」——对路由级/端点级中间件不该发生。调用方按**自己那份判据的历史语义**处理：
 * 本仓两处都取「不认识 ⇒ 不管这一枪」，与它们原先「路径不匹配就直通」一致。
 */
export interface Route {
  /** 路由表里注册的路径模式，例如 `/session/:sessionID/message`。 */
  readonly path: string
  /** 匹配出来的路径参数，例如 `{ sessionID: "ses_x" }`。 */
  readonly params: Readonly<Record<string, string | undefined>>
}

export const current: Effect.Effect<Route | undefined> = Effect.serviceOption(HttpRouter.RouteContext).pipe(
  Effect.map((option) =>
    Option.isNone(option) ? undefined : { path: option.value.route.path, params: option.value.params },
  ),
)
