export * as OpenhivePreferences from "./preferences"

/**
 * openhive 账号偏好出口（需求 6，2026-10-27）：`GET / PUT /openhive/preferences`。
 *
 * 【保留的定制 · 同步上游时不要丢】—— openhive 资产中心（需求 6 每页条数跨设备一致）。
 *
 * ## 为什么要有这条
 *
 * 中栏「每页条数」是**账号**偏好：在单位电脑选 50，回家登录也该是 50。浏览器本地存储跨不了
 * 设备，所以进库（`auth.user_preference`）。本出口只做三件事——**身份、闭集收窄、读写**——
 * 不写第二份存储逻辑（`#002-06`）。
 *
 * ## 值的合法性在出口校验
 *
 * `auth/preference.ts` 只管「键认得出、值放得进」；「每页条数只能是 20 / 50 / 100」是**这个键
 * 自己的**约束，写在这里，白名单复用 `paging.ts` 的 `PAGE_SIZES`——与列表出口同一份，
 * 两处各写一份就会漂成「存得进 30、列表不认 30」。
 *
 * ## 写回整份映射
 *
 * `PUT` 回的是**写完之后**的全量映射，而不是只回刚写的那个键：前端保存后就能拿它刷新本地
 * 状态，不必再补一次 `GET`。
 */

import { PREFERENCE_KEYS, readPreferences, writePreference, type PreferenceKey } from "@opencode-ai/auth/preference"
import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenhivePg } from "./pg"
import { PAGE_SIZES } from "./paging"

export const PATH = {
  preferences: "/openhive/preferences",
} as const

const BAD_REQUEST = 400
const UNAUTHORIZED = 401

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const deps: Deps = { pg: openhivePg.pg }

    yield* router.add("GET", PATH.preferences, (request) => handleGet(request, deps))
    yield* router.add("PUT", PATH.preferences, (request) => handlePut(request, deps))
  }),
)

function ok(value: unknown, status = 200) {
  return HttpServerResponse.jsonUnsafe(value, { status })
}

function fail(status: number, message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status })
}

function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

/** 请求期取身份（`Option.none` = 无凭证）。 */
const 身份 = Effect.serviceOption(User.Service)

function 读取体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({
      onFailure: () => undefined,
      onSuccess: (value: unknown) => value,
    }),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * 每个键的值约束。**谁定义键谁校验**——`auth/preference.ts` 只保证放得进。
 *
 * 先正则再转数字：`Number("") === 0`、`Number(" 50 ") === 50`、`Number("5e1") === 50` 都会把
 * 「客户端传了个奇怪的东西」静默变成一条合法偏好（与 `paging.ts` 的同款处置）。
 */
function 值合法(key: PreferenceKey, value: string): boolean {
  switch (key) {
    case "asset.pageSize":
      return /^[0-9]+$/.test(value) && (PAGE_SIZES as readonly number[]).includes(Number(value))
  }
}

function 读全部(deps: Deps, userId: string) {
  return Effect.promise(() => readPreferences(deps.pg(), userId))
}

function handleGet(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()

    const preferences = yield* 读全部(deps, user.value.id)
    return ok({ preferences })
  })
}

function handlePut(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id

    const body = yield* 读取体(request)
    if (!isRecord(body)) return fail(BAD_REQUEST, "请求体不是 JSON 对象")

    const key = body["key"]
    const value = body["value"]
    if (typeof key !== "string" || key === "") return fail(BAD_REQUEST, "缺少 key")
    if (typeof value !== "string") return fail(BAD_REQUEST, "缺少 value")

    // 未知键与非法值都在碰库**之前**变成 400：让它们以异常冒上去就成 500 了，而「客户端传了
    // 个拼错的键」不是服务端故障。闭集只有一份，这里只做收窄，不另立一套。
    if (!(PREFERENCE_KEYS as readonly string[]).includes(key)) return fail(BAD_REQUEST, `未知偏好键：${key}`)
    if (!值合法(key as PreferenceKey, value)) {
      return fail(BAD_REQUEST, `非法每页条数：只允许 ${PAGE_SIZES.join(" / ")}`)
    }

    yield* Effect.promise(() =>
      writePreference(deps.pg(), userId, key, value, Math.floor(Date.now() / 1000)),
    )

    const preferences = yield* 读全部(deps, userId)
    return ok({ preferences })
  })
}
