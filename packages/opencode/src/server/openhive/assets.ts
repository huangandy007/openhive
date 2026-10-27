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
 * ## 可见性下推进 SQL（需求 6，2026-10-27 改写）
 *
 * 原文写的是「可见性在内存里收敛，真到万级再谈下推，届时也必须从同一份判定生成」。
 * 分页把这句的「届时」带来了：**先在内存里筛、再 limit/offset 必然跳条**——一页取 20 条，
 * 筛完可能只剩 3 条，翻页时行被吃掉，每页条数忽多忽少。
 *
 * 所以条件由 `readableAssetCondition()` 生成（`readable-sql.ts`）——它是 `canReadAsset()`
 * 的 **SQL 投影**，规则仍只有一份。两边是否等价不靠人读代码保证，靠
 * `authorization-pushdown.test.ts` 的双投影相等断言（`#004-02`）。
 *
 * ## 分页
 *
 * `page` 从 1 起，`pageSize` 只接受 20 / 50 / 100（默认 20）。`total` 是**筛选后**的可见
 * 全集条数，与列表用同一份条件（`countAssets()` 与 `listAssets()` 共用一个条件构造器）。
 * 越界值一律 400：任意 `pageSize` 等于给了「一次拖回整张表」的口子。
 *
 * ## 筛选也在服务端（同上，需求 6）
 *
 * 分页一旦落到服务端，「取回一页再在内存里按空间 / 分类筛」就是错的：一页 20 条筛完可能只剩
 * 3 条，`total` 与实际可见行数对不上，翻页还会跳条。所以左栏的三个空间（重复参数
 * `visibility=`）、分类（`category=`）与搜索词（`q=`）都由这里收进 WHERE。
 *
 * 「三个空间全取消」的结果是空集，由前端短路成「不发请求」，出口不提供「空数组 = 不过滤」
 * 这种会被误用的后门（空串 `visibility=` 直接 400）。
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

import { countAssets, listAssets, type AssetListFilters } from "@opencode-ai/asset-service/asset"
import { offsetOf, parsePage } from "./paging"
import {
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  type AssetType,
  type AssetVisibility,
} from "@opencode-ai/asset-service/metadata"
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

function 是可见性(value: string): value is AssetVisibility {
  return (ASSET_VISIBILITIES as readonly string[]).includes(value)
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
    const category = (params.get("category") ?? "").trim()
    // 左栏三个空间是复选：重复参数 `visibility=global&visibility=department`。
    // 闭集在出口收窄：库的 CHECK 只管「列里都是合法值」，不管「客户端传的这个词合法」。
    const 可见性: AssetVisibility[] = []
    for (const value of params.getAll("visibility")) {
      if (!是可见性(value)) return fail(BAD_REQUEST, `未知可见性：${value}`)
      可见性.push(value)
    }
    if (type !== "" && !是类型(type)) return fail(BAD_REQUEST, `未知资产类型：${type}`)

    // 分页参数与治理后台共用一份解析（`paging.ts`）：两处各写一遍会漂成「一边认 50、一边只认 20」。
    const 分页 = parsePage(params)
    if ("error" in 分页) return fail(BAD_REQUEST, 分页.error)

    const filters: AssetListFilters = {
      status: "published",
      ...(type === "" ? {} : { type }),
      ...(search === "" ? {} : { search }),
      ...(category === "" ? {} : { category }),
      ...(可见性.length === 0 ? {} : { visibility: 可见性 }),
    }

    const userId = user.value.id
    const department = yield* 取部门(deps, userId)
    const viewer = { userId, department }

    // 可见性下推（需求 6）：条件由 `readableAssetCondition()` 生成——它是 `canReadAsset()`
    // 的 SQL 投影，规则仍只有一份。内存过滤会让页大小被筛掉的行吃掉（翻页跳条）。
    const 筛选: AssetListFilters = { ...filters, readableBy: viewer }

    // 顺序查而不是 Promise.all：PGlite 夹具是单连接（`PG_POOL_MAX=1`），并发两条查询会撞
    // `42P05 prepared statement already exists`（`real-pg.test.ts` 文件头记过这件事）。
    const assets = yield* Effect.promise(() =>
      listAssets(deps.pg(), 筛选, { limit: 分页.pageSize, offset: offsetOf(分页) }),
    )
    const total = yield* Effect.promise(() => countAssets(deps.pg(), 筛选))

    return ok({ assets, total, page: 分页.page, pageSize: 分页.pageSize })
  })
}
