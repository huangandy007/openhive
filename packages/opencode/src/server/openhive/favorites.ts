export * as OpenhiveAssetFavorite from "./favorites"

/**
 * openhive 资产收藏出口（2026-10-29）：`POST /openhive/asset-favorite`。
 *
 * 【保留的定制 · 同步上游时不要丢】—— openhive 资产中心（详情页「收藏」按钮）。
 *
 * ## 为什么要有这条
 *
 * 库里早就有 `auth.asset_favorite` 与 `asset-service/preferences.ts` 的读写函数（009 T011），
 * 但**没有任何 HTTP 出口**——前端点不到，那个按钮从 009 起就一直「未接线不渲染」
 * （`asset-detail.tsx` 的旧注记）。这条补的就是那一环。
 *
 * ## 送目标态，不送「翻转」
 *
 * 体是 `{ assetId, favorited }`，不是「toggle」。双击、超时重试、网络重发都会把同一个请求
 * 送两遍；「翻转」语义会让第二遍把状态翻回去，而用户看到的是一次点击。目标态天然幂等
 * （`addFavorite` / `removeFavorite` 本身也幂等：`on conflict do nothing` / 删不到就返回 false）。
 *
 * ## 收藏不能成为越权读的旁路
 *
 * 判定与 `project-assets.ts` 逐字同一份 `canReadAsset()`（R6：授权行也要进判定）——不另写
 * 「按空间猜」的第二套规则（`#002-06`）。读不到的资产回 403 且**一行都不写**：收藏行若
 * 落进库里，将来它可能被当成「我关注过」漏给别的出口。
 *
 * ## 回包给的是**读回来的真状态**
 *
 * 不是「我送了什么就回什么」：写完之后一条 SQL 同时读 `favorite_count` 与「我有没有收藏」，
 * 详情页拿它就地刷新「N 人收藏」（缓存列由 `preferences.ts` 维护，与明细同源）。
 */

import { assetById } from "@opencode-ai/asset-service/asset"
import { canReadAsset } from "@opencode-ai/asset-service/authorization"
import { addFavorite, removeFavorite } from "@opencode-ai/asset-service/preferences"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { grantsFor } from "@opencode-ai/auth/rbac"
import { User } from "@opencode-ai/core/user"
import { sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenhivePg } from "./pg"

export const PATH = {
  toggle: "/openhive/asset-favorite",
} as const

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403
const NOT_FOUND = 404

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const deps: Deps = { pg: openhivePg.pg }

    yield* router.add("POST", PATH.toggle, (request) => handleToggle(request, deps))
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

/** 资产授权的 `AssetViewer` 需要部门（个人 / 部门空间读判据）。与 `assets.ts` 同一取法。 */
function 取部门(deps: Deps, userId: string) {
  return Effect.promise(async (): Promise<string> => {
    const rows = rowsOf(await deps.pg().execute(sql`select dept from auth.user where id = ${userId}`))
    const 部门 = rows[0]?.["dept"]
    return typeof 部门 === "string" ? 部门 : ""
  })
}

/**
 * 写完之后读回来的真状态：`favorite_count`（缓存列）＋「我有没有收藏」（明细）。
 *
 * 一条 SQL 而不是两次往返；`coalesce` 兜住资产行被并发删掉时 `null` 的情形——那是 0 个收藏，
 * 不是「读不到」（回包形状不该因为一次竞态就变）。
 */
function 读状态(deps: Deps, userId: string, assetId: string) {
  return Effect.promise(async () => {
    const rows = rowsOf(
      await deps.pg().execute(sql`
        select coalesce((select favorite_count from auth.asset where id = ${assetId}), 0) as favorite_count,
               exists(
                 select 1 from auth.asset_favorite where user_id = ${userId} and asset_id = ${assetId}
               ) as favorited
      `),
    )
    const 行 = rows[0]
    return {
      favoriteCount: Number(行?.["favorite_count"] ?? 0),
      favorited: 行?.["favorited"] === true || 行?.["favorited"] === 1,
    }
  })
}

function handleToggle(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id

    const body = yield* 读取体(request)
    if (!isRecord(body)) return fail(BAD_REQUEST, "请求体不是 JSON 对象")
    const assetId = body["assetId"]
    const favorited = body["favorited"]
    if (typeof assetId !== "string" || assetId.trim() === "") return fail(BAD_REQUEST, "缺少 assetId")
    if (typeof favorited !== "boolean") return fail(BAD_REQUEST, "缺少 favorited（布尔）")

    const asset = yield* Effect.promise(() => assetById(deps.pg(), assetId))
    if (asset === undefined) return fail(NOT_FOUND, "资产不存在")

    const department = yield* 取部门(deps, userId)
    const grants = yield* Effect.promise(() => grantsFor(deps.pg(), userId))
    // R6：授权组必须进可见性判定——判据只有 `canReadAsset()` 一份（与 `project-assets.ts` 同源）。
    if (!canReadAsset({ userId, department }, asset, grants)) return fail(FORBIDDEN, "无权使用该资产")

    // 目标态幂等：重复送同一个值不会让计数翻倍，也不会把状态翻回去。
    yield* Effect.promise(() =>
      favorited ? addFavorite(deps.pg(), { userId, assetId }) : removeFavorite(deps.pg(), { userId, assetId }),
    )

    const 状态 = yield* 读状态(deps, userId, assetId)
    return ok({ assetId, favorited: 状态.favorited, favoriteCount: 状态.favoriteCount })
  })
}
