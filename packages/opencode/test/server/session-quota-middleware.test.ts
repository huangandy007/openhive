import { describe, expect } from "bun:test"
import { ConfigProvider, Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { SessionQuota } from "@opencode-ai/core/quota/session-quota"
import {
  apiPromptTarget,
  QuotaConfig as SessionQuotaConfig,
  quotaLayer,
  uiExecutionTarget,
  UiSessionQuotaMiddleware,
} from "../../src/server/routes/instance/httpapi/middleware/session-quota"
import { SessionApi, SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { testEffect } from "../lib/effect"

/**
 * T010 · 每用户并发会话限流：**传输层守卫**的行为（FR-008）。
 *
 * 为什么这一层单独测、且用桩的活跃集合：真活跃集合要靠跑真 agent 才攒得出来（重且不确定），
 * 而这里要钉的是**守卫自己的判据**——路径匹配、阈值、放行/拒绝、响应形状。
 * 「活跃集合从哪取」按链注入是 D4 裁定明写的形状，桩正是这条缝。
 * 真挂载点是否接通由本文件末尾那组守夜测试管。
 */
const it = testEffect(Layer.empty)

/** 桩：活跃集合从哪来不重要，重要的是守卫拿它做什么。 */
const stub = (state: { active: number; alreadyRunning: boolean }, raw = "", target = PROBE_TARGET) =>
  quotaLayer({
    target,
    source: Effect.succeed(() => Effect.succeed(state)),
  }).pipe(
    // 阈值走 `Config` 服务而不是 `process.env`：测试能从这条缝注入，生产从 env 解析。
    Layer.provide(SessionQuotaConfig.configLayer({ maxConcurrent: raw })),
  )

/** 桩路由（`/probe/:sessionID`）的匹配式，与守卫放一起——大部分用例只用这一个。 */
const PROBE_TARGET: typeof uiExecutionTarget = (route) =>
  route.path === "/probe/:sessionID" ? route.params["sessionID"] : undefined

/** 最小路由：一条桩路由（`/probe/:sessionID`），路径形状与被守的两条链同构。 */
function probe(raw = "") {
  return (path: string) => {
    const handler = HttpRouter.toWebHandler(
      HttpRouter.use((router) =>
        Effect.all([
          router.add("POST", "/probe/:sessionID", () =>
            Effect.succeed(HttpServerResponse.jsonUnsafe({ passed: true })),
          ),
          // 兜底通配：让「守卫放行」与「守卫拒绝」在同一个状态码面上可比——
          // 只有窄路由的话，路径不匹配会被路由回 404，跟守卫的 429 混淆。
          // （匹配器优先走更具体的 `/probe/:sessionID`，通配只在它不匹配时兜底。）
          router.add("POST", "/*", () => Effect.succeed(HttpServerResponse.jsonUnsafe({ passed: true }))),
        ]),
      ).pipe(Layer.provide(stub(current, raw))),
      { disableLogger: true },
    ).handler
    return Effect.promise(() =>
      Promise.resolve(
        handler(new Request(new URL(path, "http://localhost"), { method: "POST" }), Context.makeUnsafe(new Map())),
      ),
    )
  }
}

let current = { active: 0, alreadyRunning: false }

/**
 * 与 `probe` 同构，但**注册的是生产的路由模式**（不是 `/*` 通配）。
 *
 * 差别就是本组要钉的东西：通配能让「守卫放行」写得出来，却把**匹配器**从被测对象里摘掉了——
 * 而「一个路径到底归哪条路由」正是匹配器说了算。这里注册真模式，路径交给真匹配器。
 *
 * 注册的既有会被守的（`prompt_async` / `message` / B 链 `prompt`），也有**不该被守的**
 * （`abort`：只取消、不启动执行）——判据「不误伤」那一半也一并走真路由。
 */
const ROUTE_PATTERNS = [
  "/session/:sessionID/prompt_async",
  "/session/:sessionID/message",
  "/session/:sessionID/abort",
  "/api/session/:sessionID/prompt",
] as const

function probeRoutes(target: typeof uiExecutionTarget, raw = "") {
  return (path: string) => {
    const handler = HttpRouter.toWebHandler(
      HttpRouter.use((router) =>
        Effect.all(
          ROUTE_PATTERNS.map((pattern) =>
            router.add("POST", pattern, () => Effect.succeed(HttpServerResponse.jsonUnsafe({ passed: true }))),
          ),
        ),
      ).pipe(Layer.provide(stub(current, raw, target))),
      { disableLogger: true },
    ).handler
    return Effect.promise(() =>
      Promise.resolve(
        handler(new Request(new URL(path, "http://localhost"), { method: "POST" }), Context.makeUnsafe(new Map())),
      ),
    )
  }
}

describe("守卫的判据（T010）", () => {
  it.live("路径不匹配 ⇒ 直通（不碰活跃集合）", () =>
    Effect.gen(function* () {
      current = { active: 99, alreadyRunning: false }
      const response = yield* probe()("/not-a-prompt")
      expect(response.status).toBe(200)
    }),
  )

  it.live("未到上限 ⇒ 直通", () =>
    Effect.gen(function* () {
      current = { active: 4, alreadyRunning: false }
      const response = yield* probe()("/probe/ses_a")
      expect(response.status).toBe(200)
    }),
  )

  it.live("恰好到上限 ⇒ 429", () =>
    Effect.gen(function* () {
      current = { active: 5, alreadyRunning: false }
      const response = yield* probe()("/probe/ses_a")
      expect(response.status).toBe(429)
    }),
  )

  it.live("已在这个会话上跑 ⇒ 放行（哪怕到上限）", () =>
    Effect.gen(function* () {
      current = { active: 5, alreadyRunning: true }
      const response = yield* probe()("/probe/ses_a")
      expect(response.status).toBe(200)
    }),
  )

  it.live("阈值从 env 读（这里设 1）", () =>
    Effect.gen(function* () {
      current = { active: 1, alreadyRunning: false }
      const response = yield* probe("1")("/probe/ses_a")
      expect(response.status).toBe(429)
    }),
  )
})

/**
 * 守夜：**真挂载点**上两个守卫的依赖必须解析得开。
 *
 * 探针实测过坏法长什么样（2026-09-30）：把守卫挂错地方时不是静默放行，而是
 * `Service not found` → 500。所以「不是 500」这条断言钉的是**接线**，不是判据——
 * 判据由上面那组桩测试与 core 的单测钉。
 *
 * ⚠️ 这里**证明不了 429 会真的发生**：要让 `active ≥ limit` 得先有真会话在跑。
 * 端到端「第 6 个真会话被拒」**未覆盖**，已登记进 `state.md`。
 */
describe("真挂载点（T010 · 守夜）", () => {
  const real = (path: string) =>
    Effect.gen(function* () {
      const handler = HttpRouter.toWebHandler(
        HttpApiApp.routes.pipe(
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown({ [SessionQuota.MAX_CONCURRENT_ENV]: "1" })),
          ),
        ),
        { disableLogger: false },
      ).handler
      return yield* Effect.promise(() =>
        Promise.resolve(handler(new Request(new URL(path, "http://localhost"), { method: "POST" }), HttpApiApp.context)),
      )
    })

  it.live("B 链 /api/session/:id/prompt 上守卫的依赖解析得开（不是 500）", () =>
    Effect.gen(function* () {
      const response = yield* real("/api/session/ses_x/prompt")
      expect(response.status).not.toBe(500)
    }),
  )

  it.live("A 链 /session/:id/prompt_async 上守卫的依赖解析得开（不是 500）", () =>
    Effect.gen(function* () {
      const response = yield* real("/session/ses_x/prompt_async")
      expect(response.status).not.toBe(500)
    }),
  )
})

/**
 * ## A 链「启动执行」的端点清点（2026-10-02 · 代码审查 R-02）
 *
 * T010 把守卫挂在**一处**（`promptAsync`），依据是「A 链 = `prompt_async`」。**这个清点是错的**：
 * `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` 里另有**五个**端点
 * 同样启动一轮执行——
 *
 * | 端点 | 路径 | 落到 |
 * |---|---|---|
 * | `prompt` | `POST /session/{id}/message` | `promptSvc.prompt` |
 * | `command` | `POST /session/{id}/command` | `promptSvc.command` |
 * | `shell` | `POST /session/{id}/shell` | `promptSvc.shell` |
 * | `init` | `POST /session/{id}/init` | `promptSvc.command(Command.Default.INIT)` |
 * | `summarize` | `POST /session/{id}/summarize` | `promptSvc.loop` |
 *
 * 于是「满配额时换用 `/session/{id}/message`」就绕过了限流。判据用 D4 已经裁定过的那句：
 * **能被另一个端点绕过的配额不是配额**。
 *
 * **不算的**：`revert` / `unrevert` 走 `SessionError.mapBusy`——忙的时候是**失败**，不启动执行；
 * `abort` 只取消。（B 链那边清过了，没有同类兄弟端点：`/api/session/{id}/compact` 直接返回
 * `OperationUnavailableError`，整条 B 链只有 `prompt` 一个执行入口。）
 *
 * **为什么这组测的是「清点」而不是端到端要一个 429**：真 429 得先有一个**真在跑的会话**把
 * `SessionStatus` 撑起来，本机测试建不出（同上面「守夜」那组已登记的缺口）。所以这里钉
 * **两份清点必须一致**——「认哪些路径」与「挂哪些端点」，漏任一边都红。
 */
describe("A 链「启动执行」的端点清点（R-02）", () => {
  /** 六个「启动执行」的端点名（与 `SessionPaths` 的键同名）。 */
  const EXECUTION_ENDPOINTS = ["promptAsync", "prompt", "command", "shell", "init", "summarize"] as const

  const SESSION_ID = "ses_00000000000000000000000000"

  /**
   * 造一条「匹配结果」。路径**就用 `SessionPaths` 的原样**（含 `:sessionID` 占位），
   * 一是因为守卫认的正是路由模式，二是因为这里不该再出现第二份「路径长什么样」的知识——
   * 端点注册用的是 `SessionPaths`，守卫认的也该是它。
   */
  const routeOf = (path: string) => ({ path, params: { sessionID: SESSION_ID } })

  /** 端点上真挂着的中间件集合。类型上 `Record` 把端点宽化掉了，读之前得先确认形状对得上。 */
  const mounted = (): ReadonlySet<string> => {
    const group = SessionApi.groups["session"]
    const names: string[] = []
    for (const endpoint of Object.values(group.endpoints)) {
      const middlewares = (endpoint as { middlewares?: ReadonlySet<unknown> }).middlewares
      if (middlewares?.has(UiSessionQuotaMiddleware)) names.push(endpoint.name)
    }
    return new Set(names)
  }

  it.live("守卫认得全部六条「启动执行」的路由（不只 prompt_async）", () =>
    Effect.sync(() => {
      for (const name of EXECUTION_ENDPOINTS) {
        expect({ name, target: uiExecutionTarget(routeOf(SessionPaths[name])) }).toEqual({ name, target: SESSION_ID })
      }
    }),
  )

  it.live("六个端点上真的挂了守卫（清了路径却不挂＝白清）", () =>
    Effect.sync(() => {
      const mountedNames = mounted()
      for (const name of EXECUTION_ENDPOINTS) {
        expect({ name, mounted: mountedNames.has(name) }).toEqual({ name, mounted: true })
      }
    }),
  )

  // 清点要两面都钉：只有「该认的都认了」不够，还得「不该认的没认」——
  // 否则把匹配放宽成「任何 /session/ 下的路径」也能让上面两条绿，而那是把读接口也拦了。
  it.live("不误伤：B 链路由、非执行端点、读接口都不算", () =>
    Effect.sync(() => {
      expect(uiExecutionTarget(routeOf("/api/session/:sessionID/prompt"))).toBeUndefined()
      expect(uiExecutionTarget(routeOf(SessionPaths.revert))).toBeUndefined()
      expect(uiExecutionTarget(routeOf(SessionPaths.unrevert))).toBeUndefined()
      // 读消息详情：`/session/:sessionID/message/:messageID`——与执行端点共享前缀，别误伤。
      expect(uiExecutionTarget(routeOf(SessionPaths.message))).toBeUndefined()
      expect(uiExecutionTarget(routeOf(SessionPaths.list))).toBeUndefined()
    }),
  )
})

/**
 * ## 路径的**等价写法**也必须在守卫之内（2026-10-02 · 复查 R2-02）
 *
 * R-02 把 A 链的守卫从一处补齐成六个端点，但认路径用的是**请求路径原文**的正则
 * （`/^\/session\/([^/]+)\/(?:prompt_async|message|…)$/`）。而决定「这一枪打到哪个端点」的
 * 不是那段正则，是路由匹配器 `find-my-way-ts`——默认
 * `ignoreTrailingSlash: true` / `ignoreDuplicateSlashes: true` / `caseSensitive: false`，
 * 匹配前还会 `decodeURI` 一遍，`;` 也被它当查询串分隔符。实测（2026-10-02，真路由树）下列写法
 * **全部命中 `POST /session/:sessionID/message`**：`/session/ses_x/message/`、
 * `/session//ses_x/message`、`/SESSION/ses_x/MESSAGE`、`/session/ses_x/mess%61ge`、
 * `/session/ses_x/message;x`。
 *
 * 于是 R-02 的修复**整体落空**，而且难得发现：清点看着是对的、端点确实挂上了，
 * 只有「换个写法再打一次」才看得出来。这正是 `LEARNINGS #002-01` 的形状——同一个维度上
 * 两条判据各算各的，谁也不知道对方在算什么。
 *
 * 修法不去镜像那套归一化（镜像就是下一个漂移点），而是读**路由匹配结果**
 * （`HttpRouter.RouteContext`，见 `middleware/matched-route.ts`）：匹配器怎么归一化，
 * 守卫看到的就是什么样。本组把守卫架在**生产的路由模式**上，走真匹配器，钉的才是这件事本身。
 *
 * `abort` 一并注册进去，是「不误伤」那一半的真路由版本：它同样匹配 `/session/:sessionID/*`，
 * 但**只取消、不启动执行**，必须放行。
 */
describe("守卫认的是路由，不是路径原文（R2-02）", () => {
  const over = () => {
    current = { active: 5, alreadyRunning: false }
  }

  it.live("对照：规范写法命中（证明确实守在这条路由上）", () =>
    Effect.gen(function* () {
      over()
      expect((yield* probeRoutes(uiExecutionTarget)("/session/ses_a/message")).status).toBe(429)
    }),
  )

  it.live("A 链：尾斜杠 / 重复斜杠 / 大小写 / 百分号转义，一个都不能漏", () =>
    Effect.gen(function* () {
      over()
      for (const path of [
        "/session/ses_a/message/",
        "/session//ses_a/message",
        "/SESSION/ses_a/MESSAGE",
        "/session/ses_a/mess%61ge",
        "/session/ses_a/message;x",
        "/session/ses_a/prompt_async/",
      ]) {
        expect({ path, status: (yield* probeRoutes(uiExecutionTarget)(path)).status }).toEqual({ path, status: 429 })
      }
    }),
  )

  it.live("A 链：不误伤——`abort` 同样匹配 `/session/:sessionID/*`，但必须放行", () =>
    Effect.gen(function* () {
      over()
      for (const path of ["/session/ses_a/abort", "/session/ses_a/abort/"]) {
        expect({ path, status: (yield* probeRoutes(uiExecutionTarget)(path)).status }).toEqual({ path, status: 200 })
      }
    }),
  )

  // B 链那条判据里的路由模式是**上游文件里的字面量**，本仓推不出来，只能这么钉：
  // 上游改了路径，这条红，否则守卫会静默地不再守任何东西（不是 500、不是报错，是放行）。
  it.live("B 链：等价写法同样命中", () =>
    Effect.gen(function* () {
      over()
      for (const path of [
        "/api/session/ses_a/prompt",
        "/api//session/ses_a/prompt/",
        "/API/SESSION/ses_a/PROMPT",
        "/api/session/ses_a/prompt;x",
      ]) {
        expect({ path, status: (yield* probeRoutes(apiPromptTarget)(path)).status }).toEqual({ path, status: 429 })
      }
    }),
  )
})
