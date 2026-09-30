export * as AnchorWorkspace from "./anchor-workspace"

import { WORKSPACE_ROOT_ENV, workspaceRoot } from "@opencode-ai/auth/workspace"
import { User } from "@opencode-ai/core/user"
import { ConfigService } from "@/effect/config-service"
import { Config as EffectConfig, Effect, Option } from "effect"
import { Headers, HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { join } from "node:path"

/**
 * 工作目录**强制锚定**（003 T006，FR-005）。
 *
 * 内核里「当前工作目录」的每一处最终都来自**请求**：`planRequest` 的
 * `defaultDirectory()` 读 `?directory=` 与 `x-opencode-directory`，旧版
 * `@opencode-ai/server/location` 的 `ref()` 另读 `location[directory]`。
 * 也就是说，**目录是客户端说了算的**——一个够得着端口的人传 `?directory=/` 就能把
 * 文件 / pty / 会话的落点搬到沙箱外面去。
 *
 * 本中间件把这三个入参**全部改写**成 `{沙箱根}/{userId}`，客户端传什么都无效。
 * 出口是「伪造 directory 被忽略，落沙箱根」。
 *
 * ## 为什么是「改写请求」而不是「改解析函数」
 *
 * 两条解析链（v2 的 `workspace-routing.ts`、旧版 `location.ts`）是上游高频文件，
 * 改它们等于每次同步都冲突（宪法 §I）。而它们**都从同一个 `HttpServerRequest` 读**——
 * 在请求进路由树之前把它换掉，两条链同时被锚定，上游一行不动（§V 侵入是「加」不是「改」）。
 *
 * ## 为什么「没有 User 就直通」
 *
 * 身份门默认关着，此时上下文里**没有** `User`（不是空身份，是没有）。若锚定无条件生效，
 * 等于把一个没有身份的系统整体搬到 `{根}/{undefined}` 下面——那比它要堵的洞更像事故。
 * 判据是「**谁在跑**」而不是「有没有」：有身份才锚，与 T004 的裁定一致。
 *
 * ## 残留（已知，不假装已闭合）
 *
 * `planRequest` 是 `session?.directory || defaultDirectory(...)`——**会话行里的 directory 优先于
 * 请求**。所以「锚定上线**之前**就已存在的会话」仍会解析到它当年记下的目录。T005 的每用户
 * 数据库把**跨用户**那一半关掉了（`Session.Service.get` 只读自己的库），**同一用户的历史会话**
 * 那一半不闭合，登记在 `state.md`。
 */
export class Config extends ConfigService.Service<Config>()("@opencode/OpenhiveWorkspaceAnchorConfig", {
  /**
   * 沙箱根。默认取 `workspaceRoot({})` 而不是另写一个 `"/workspaces"`——
   * 那个默认值只有一处定义（design-v2 §5.3），两边各写一份就会在改默认时漏掉一边。
   */
  root: EffectConfig.string(WORKSPACE_ROOT_ENV).pipe(EffectConfig.withDefault(workspaceRoot({}))),
}) {}

export const anchorWorkspaceLayer = HttpRouter.middleware<{ requires: Config; handles: unknown }>()(
  Effect.gen(function* () {
    const config = yield* Config

    return (effect) =>
      Effect.gen(function* () {
        const user = yield* Effect.serviceOption(User.Service)
        if (Option.isNone(user)) return yield* effect

        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* Effect.provideService(
          effect,
          HttpServerRequest.HttpServerRequest,
          anchor(request, join(config.root, user.value.id)),
        )
      })
  }),
).layer

/**
 * 把请求里的目录入参一律改写成 `sandbox`。
 *
 * 三处都要改，因为它们**不是同一条读法**：`?directory=` 是 v2 的，`location[directory]` 是旧版的，
 * 头是两条链共用的兜底。只改一处 = 留一条明路。
 *
 * `?workspace=` 一并删掉：它同样由客户端给，而 `planRequest` 会用工作区自己的 `target.directory`
 * **完全绕过** `defaultDirectory`——留着它，上面三处改写等于白改。删而不是替换，是因为
 * 「一人一工作区」（T004 裁定）下没有第二个工作区 id 可以填。
 */
function anchor(request: HttpServerRequest.HttpServerRequest, sandbox: string) {
  const url = new URL(request.url, "http://localhost")
  url.searchParams.set("directory", sandbox)
  url.searchParams.set("location[directory]", sandbox)
  url.searchParams.delete("workspace")

  return request.modify({
    url: `${url.pathname}${url.search}`,
    headers: Headers.set(request.headers, "x-opencode-directory", sandbox),
  })
}
