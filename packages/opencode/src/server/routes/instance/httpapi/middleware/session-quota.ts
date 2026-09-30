export * as SessionQuotaMiddleware from "./session-quota"

import { Database } from "@opencode-ai/core/database/database"
import { SessionQuota } from "@opencode-ai/core/quota/session-quota"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { ConfigService } from "@/effect/config-service"
import { Config as EffectConfig, Context, Effect, Layer } from "effect"
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"

/**
 * 每用户并发会话限流的**传输层守卫**（003 T010，FR-008）。
 *
 * ## 为什么在传输层、而不是插进两条链的 service 里
 *
 * 判据、阈值、计数都在 core 的 `SessionQuota`（唯一一份），这里只做「**拦住这一枪**」。
 * 插进 service 层的写法要把一个新错误类型从 core 一路铺到两条链的 HTTP 契约
 * （`protocol/groups/session.ts`、`httpapi/groups/session.ts`、两边的 `errors.ts` 与 handler 映射）
 * ——那是宪法 §I（最小化上游合并冲突）最忌讳的冲突面。这里只加中间件，
 * **错误契约一个都不动**。代价是拒绝形态是**裸 429**、不进类型契约（已记进 `state.md`）。
 *
 * ## 为什么两条链挂法**不一样**（裁定原写「一处挂载」，实测不成立）
 *
 * 实测（2026-09-30，在 `createRoutes` 内的中间件里逐个探，含二分）：
 * - `SessionV2.Service`（含 `active`，B 链的进程级活跃集合）与 `Database.Service`
 *   —— 构造期可取、请求期可用；
 * - `SessionStatus.Service`（A 链的实例级活跃集合）—— 构造期**能取到**，请求期调用**失败**。
 *   根因不是位置没放对：实例上下文（`InstanceRef`）是**端点级** `HttpApiMiddleware`
 *   （`InstanceContextMiddleware` 经 `.middleware(...)` 挂）注入的，**任何路由级中间件都在它外面**。
 *   故 A 链只能走端点级中间件（`UiSessionQuotaMiddleware`），B 链走路由级（`apiQuotaLayer`）。
 *
 * 两次挂载、**一份判定**：`judge` 是唯一的分支处，两种形态只是它的适配器。
 *
 * ## 响应形状
 *
 * 429 + JSON body。**不声明进 HttpApi 的错误契约**；客户端按状态码识别。
 */
const TOO_MANY_REQUESTS = 429

/** A 链的路径式。与端点绑定是双保险：**匹配必须是链专属的**，否则会去读另一条链读不到的活跃集合。 */
const UI_PROMPT = (pathname: string) => /^\/session\/([^/]+)\/prompt_async$/.exec(pathname)?.[1]
/** B 链的路径式。 */
const API_PROMPT = (pathname: string) => /^\/api\/session\/([^/]+)\/prompt$/.exec(pathname)?.[1]

/** 阈值。照 `AnchorWorkspace.Config` 先例：解析出的值可注入（测试用 `configLayer`）。 */
export class QuotaConfig extends ConfigService.Service<QuotaConfig>()("@opencode/OpenhiveSessionQuotaConfig", {
  maxConcurrent: EffectConfig.string(SessionQuota.MAX_CONCURRENT_ENV).pipe(EffectConfig.withDefault("")),
}) {}

/**
 * **解析后**的阈值配置形状。
 *
 * 为什么不是 `Config`：那个名字在**类型位置**指的是「键」（一个 `ServiceClass`，身上是
 * `key` / `[ServiceTypeId]` / `Service`，**没有** `maxConcurrent`）——取值形状得走 Effect 官方的
 * 提取器 `Context.Service.Shape`。同 `user-identity.ts` 的 `ResolvedConfig`，那里也踩过同一个坑。
 */
type ResolvedConfig = Context.Service.Shape<typeof QuotaConfig>

/**
 * 读阈值。**判定仍复用 core 那个被测过的纯函数**（`maxConcurrentSessions`），不在这里重写一遍
 * ——回落到默认值的那四种情况（没设 / 空串 / 非数字 / 非正数）各有各的理由，都写在那边。
 */
const limitOf = (config: ResolvedConfig) =>
  SessionQuota.maxConcurrentSessions({ [SessionQuota.MAX_CONCURRENT_ENV]: config.maxConcurrent })

/** 一条链在某次请求上的活跃状况。**两条链唯一的差异就是这个值从哪来**。 */
export interface ChainState {
  /** 本用户当前正在跑的会话数，**含 `alreadyRunning` 那条**（如果在跑）。 */
  readonly active: number
  /** 目标会话本身就在跑吗。见 `SessionQuota.exceeds` 注释：这一段是必需的，不是优化。 */
  readonly alreadyRunning: boolean
}

interface JudgeInput<R> {
  readonly target: (pathname: string) => string | undefined
  readonly read: (sessionID: string) => Effect.Effect<ChainState, never, R>
  readonly limit: number
}

/**
 * **唯一的分支处**。产出 `undefined` = 放行（调用方继续走原路由），
 * 产出响应 = 拒绝（调用方直接返回它，不再执行下游）。
 *
 * 两条链的适配器都只做这一件事，所以「判据写两遍、早晚会漂」这个风险不存在。
 */
const judge = <R>(input: JudgeInput<R>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const sessionID = input.target(new URL(request.url, "http://localhost").pathname)
    if (sessionID === undefined) return undefined

    const state = yield* input.read(sessionID)
    if (!SessionQuota.exceeds({ ...state, limit: input.limit })) return undefined

    return HttpServerResponse.jsonUnsafe(
      {
        name: "SessionQuotaExceeded",
        data: {
          sessionID,
          limit: input.limit,
          active: state.active,
          hint: `${SessionQuota.MAX_CONCURRENT_ENV}=${input.limit}`,
        },
      },
      { status: TOO_MANY_REQUESTS },
    )
  })

/**
 * A 链（web UI）：`POST /session/{id}/prompt_async` → `SessionPrompt.prompt` → `SessionRunState`。
 *
 * **必须挂成端点级中间件**（在 `groups/session.ts` 的 `promptAsync` 上 `.middleware(...)`），
 * 否则读不到实例作用域的 `SessionStatus`——路由级会 500，不会静默放行（见文件头实测）。
 *
 * 活跃集合取 `SessionStatus`。**它天然就是本用户的**：实例由工作目录决定，而工作目录被 T006
 * 锚定到 `{沙箱根}/{userId}`，所以这个 Map 里不可能有别人的会话——不需要再与库做交集
 * （B 链则必须，见下）。`SessionStatus.set` 对 idle 条目做 `delete`，留下的就是「在跑」的。
 *
 * 路径匹配在这里**必然命中**（端点级的层只挂在这一个端点上），保留它是为了让两种形态共用
 * 同一份 `judge`——**没有第二处判据可比对**，少一个会漂的地方。
 */
/**
 * ⚠️ **不写 `requires`**（虽然类型上写得出来）——照官方 `Authorization` 的先例：`requires` 写进去的
 * 需求会**焊进 API 的类型**（`InstanceHttpApi` 的 requirement），而那个位置**任何 `Layer.provide`
 * 都消不掉**，只能由 `createRoutes` 最外层满足。表现是：层在下面 `pipe(Layer.provide(...))` 供了、
 * 运行期也对，typecheck 却坚持说 `QuotaConfig` 还欠着（2026-09-30 实测，二分定位到本处）。
 * 需求留在**层**上（`uiQuotaLayer` 自己 require），由挂载处的 `.pipe(Layer.provide(...))` 消掉即可。
 */
export class UiSessionQuotaMiddleware extends HttpApiMiddleware.Service<UiSessionQuotaMiddleware>()(
  "@opencode/OpenhiveSessionQuotaUi",
) {}

export const uiQuotaLayer = Layer.effect(
  UiSessionQuotaMiddleware,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const limit = limitOf(yield* QuotaConfig)
    const read = (sessionID: string) =>
      status.list().pipe(
        Effect.map((list) => {
          const id = SessionID.make(sessionID)
          return { active: list.size, alreadyRunning: list.has(id) }
        }),
      )

    return UiSessionQuotaMiddleware.of((effect) =>
      Effect.gen(function* () {
        const denial = yield* judge({ target: UI_PROMPT, read, limit })
        return denial === undefined ? yield* effect : denial
      }),
    )
  }),
)

/**
 * 造一个**路由级**守卫层（B 链用，测试也用）。
 *
 * 只在「服务在路由层就够得着」时可用——`SessionStatus` 属于反例，见文件头。
 * `source` 在层构造期取一次服务，产出「拿去查某会话状况」的读取器；
 * 测试传桩就在这条缝上（D4 裁定明写「活跃集合从哪取按链注入」）。
 */
export function quotaLayer<R = never>(options: {
  readonly target: (pathname: string) => string | undefined
  readonly source: Effect.Effect<(sessionID: string) => Effect.Effect<ChainState>, never, R>
}) {
  return HttpRouter.middleware<{ requires: R | QuotaConfig; handles: unknown }>()(
    Effect.gen(function* () {
      const read = yield* options.source
      const limit = limitOf(yield* QuotaConfig)

      return (effect) =>
        Effect.gen(function* () {
          const denial = yield* judge({ target: options.target, read, limit })
          return denial === undefined ? yield* effect : denial
        })
    }),
  ).layer
}

/**
 * B 链（CLI serve / sdk-next）：`POST /api/session/{id}/prompt` → core `SessionV2.prompt`。
 *
 * 活跃集合取 `SessionV2.active`（= `SessionExecution.active`，**进程级**、不分用户），
 * 而配额是**每用户**的 ⇒ 必须做交集：拿活跃 id 去查**本用户的库**（查询走 T005 的连接路由钩子），
 * 数出来的行数才是本用户的活跃数。这一步就是 core 的 `SessionQuota.countActiveForUser`。
 */
export const apiQuotaLayer = quotaLayer({
  target: API_PROMPT,
  source: Effect.gen(function* () {
    const v2 = yield* SessionV2.Service
    const database = yield* Database.Service
    return (sessionID: string) =>
      Effect.gen(function* () {
        const active = yield* v2.active
        return {
          active: yield* SessionQuota.countActiveForUser(database.db, active),
          // 目标会话在进程级活跃集合里吗。**不需要再问「是不是本用户的」**——
          // 请求已经路由到本用户的库，别人的会话走不到这里。
          alreadyRunning: active.has(SessionSchema.ID.make(sessionID)),
        }
      })
  }),
})
