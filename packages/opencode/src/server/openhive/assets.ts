export * as OpenhiveAssets from "./assets"

/**
 * T017 · **使用面**的资产列表出口（`GET /openhive/assets`）。
 *
 * ## 与治理出口的分工
 *
 * `/openhive/governance/assets` 服务管理员：全量（草稿也在），进门要板块授权。
 * 这条服务**普通民警**：只要登录，回「**这个读者能看见的已发布资产**」。两者共用同一份
 * 可见性判定——009 的 `canReadAsset()`——本文件不写第二份规则（`#002-06`）。
 *
 * ## 为什么可见性在内存里收敛，而不是写进 SQL
 *
 * `listAssets()` 不知道读者是谁，也没有 per-viewer 的作用域。判定规则本身是一段有分支的
 * 函数（作者恒可读、授权行、`global` / 同部门 `department`、`personal` 只给作者）。把它
 * 复制进 `where` 子句就是第二份实现：两边漂了不会报错，只会「该看见的看不见 / 不该看见的
 * 看见了」。所以 SQL 只负责**状态与类型**这两个纯数据条件，可见性逐条过 `canReadAsset()`。
 *
 * 代价是每次请求都要把已发布资产读出来再过滤。以本单位资产量级（百级）这是可忽略的；
 * 真到万级再谈把规则下推，届时也必须从同一份判定生成。
 *
 * ## 「只列已发布」是产品口径
 *
 * 使用面是「我能用的东西」：草稿 / 待审 / 迭代中 / 下线 / 归档都不该出现在这里。
 * `offline` 虽然 `canReadAsset()` 放行（看得见、不能用），但使用面连列表也不给。
 *
 * ## 列表不带写操作
 *
 * 收藏、使用次数、评分、「用这个 skill 执行」都不在本轮范围内（用户裁定 2026-10-27）。
 */

import { canReadAsset } from "@opencode-ai/asset-service/authorization"
import { listAssets, type AssetListFilters } from "@opencode-ai/asset-service/asset"
import { ASSET_TYPES, type AssetType } from "@opencode-ai/asset-service/metadata"
import { grantsFor } from "@opencode-ai/auth/rbac"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { User } from "@opencode-ai/core/user"
import { sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenhivePg } from "./pg"

export const PATH = {
  list: "/openhive/assets",
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

    yield* router.add("GET", PATH.list, (request) => handleList(request, deps))
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

function 是类型(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value)
}

/** 资产授权的 `AssetViewer` 需要部门（个人 / 部门空间读判据）。 */
function 取部门(deps: Deps, userId: string) {
  return Effect.promise(async (): Promise<string> => {
    const rows = rowsOf(await deps.pg().execute(sql`select dept from auth.user where id = ${userId}`))
    const 部门 = rows[0]?.["dept"]
    return typeof 部门 === "string" ? 部门 : ""
  })
}

function handleList(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()

    const params = new URL(request.url, "http://localhost").searchParams
    const type = params.get("type") ?? ""
    const search = (params.get("q") ?? "").trim()

    // 闭集在出口收窄：库的 CHECK 只管「列里都是合法值」，不管「客户端传的这个词合法」。
    if (type !== "" && !是类型(type)) return fail(BAD_REQUEST, `未知资产类型：${type}`)

    const filters: AssetListFilters = {
      status: "published",
      ...(type === "" ? {} : { type }),
      ...(search === "" ? {} : { search }),
    }

    const userId = user.value.id
    const department = yield* 取部门(deps, userId)
    const viewer = { userId, department }
    const grants = yield* Effect.promise(() => grantsFor(deps.pg(), userId))
    const assets = yield* Effect.promise(() => listAssets(deps.pg(), filters))

    return ok({ assets: assets.filter((asset) => canReadAsset(viewer, asset, grants)) })
  })
}
