import { describe, expect } from "bun:test"
import { ConfigProvider, Context, Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { SessionQuota } from "@opencode-ai/core/quota/session-quota"
import {
  QuotaConfig as SessionQuotaConfig,
  quotaLayer,
} from "../../src/server/routes/instance/httpapi/middleware/session-quota"
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
const stub = (state: { active: number; alreadyRunning: boolean }, raw = "") =>
  quotaLayer({
    target: (pathname) => pathname.match(/^\/probe\/([^/]+)$/)?.[1],
    source: Effect.succeed(() => Effect.succeed(state)),
  }).pipe(
    // 阈值走 `Config` 服务而不是 `process.env`：测试能从这条缝注入，生产从 env 解析。
    Layer.provide(SessionQuotaConfig.configLayer({ maxConcurrent: raw })),
  )

/** 最小路由：一条桩路由，路径形状与被守的两条链同构。 */
function probe(raw = "") {
  return (path: string) => {
    const handler = HttpRouter.toWebHandler(
      HttpRouter.use((router) =>
        // 通配：让「守卫放行」与「守卫拒绝」在同一个状态码面上可比——
        // 用窄路由的话，不匹配的路径会被路由回 404，跟守卫的 429 混淆。
        router.add("POST", "/*", () => Effect.succeed(HttpServerResponse.jsonUnsafe({ passed: true }))),
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
