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
 * ## 带「我收藏了哪些」（2026-10-29）
 *
 * 回包多一个 `favoritedIds`：**本页里我收藏过的**。写操作（收藏 / 取消）在
 * `./favorites.ts` 的 `POST /openhive/asset-favorite`——本出口仍是只读。
 *
 * 为什么不塞进每条 `AssetMetadata`：那是与治理后台共用的类型，加一个 per-user 字段会让
 * 另一处出口回假值（那里根本没有「当前读者」）。平行数组则要么有、要么空，没有歧义。
 *
 * 使用次数与评分仍不在本出口（工作台没有写它们的路径）。
 */

import { countAssets, listAssets, type AssetListFilters } from "@opencode-ai/asset-service/asset"
import { favoriteAssetIds } from "@opencode-ai/asset-service/preferences"
import { categoryNamesOf, OTHER_CATEGORY_ID } from "@opencode-ai/asset-service/category-store"
import { offsetOf, parsePage } from "./paging"
import {
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  type AssetType,
  type AssetVisibility,
} from "@opencode-ai/asset-service/metadata"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { dataRoot } from "@opencode-ai/core/database/router"
import { User } from "@opencode-ai/core/user"
import { sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { create抽取时控, 用量统计 } from "./asset-usage"
import { OpenhivePg } from "./pg"

export const PATH = {
  list: "/openhive/assets",
} as const

const BAD_REQUEST = 400
const UNAUTHORIZED = 401

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
  /** 使用记录的抽取节流（一个应用层一份；见 `asset-usage.ts` 的 `create抽取时控`）。 */
  readonly 时控: ReturnType<typeof create抽取时控>
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const deps: Deps = { pg: openhivePg.pg, 时控: create抽取时控() }

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

    // 需求 2：「其他」是保留值，翻成兜底条件；其余仍按分类 id 等值筛。
    // 兜底项没有库行，`category = '__other__'` 走等值筛只会恒空——所以必须在这里翻。
    const filters: AssetListFilters = {
      status: "published",
      ...(type === "" ? {} : { type }),
      ...(search === "" ? {} : { search }),
      ...(category === ""
        ? {}
        : category === OTHER_CATEGORY_ID
          ? { categoryOther: true as const }
          : { category }),
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

    // 需求 2：本页资产用到的分类名（**含停用分类**）。「其他」桶里要标「原分类」，
    // 名字只能从库里取——seed 常量在管理员改名/停用之后就是第二份真相（`#002-06`）。
    // 顺序查而不是并发：PGlite 夹具是单连接（同本文件上方「顺序查」的理由）。
    const categoryNames = yield* Effect.promise(() =>
      categoryNamesOf(
        deps.pg(),
        assets.map((asset) => asset.category),
      ),
    )

    // 本页里「我」收藏过的（2026-10-29）。顺序查而不是并发：PGlite 夹具是单连接
    // （同本文件上方「顺序查」的理由）。`favoriteAssetIds()` 回的是**全量**原始清单
    // （可能含已无权读取的旧行），这里与本页求交，既收窄了体积也不会把无权资产漏出去。
    const 收藏 = yield* Effect.promise(() => favoriteAssetIds(deps.pg(), userId))
    const 本页 = new Set(assets.map((asset) => asset.id))
    const favoritedIds = 收藏.filter((id) => 本页.has(id))

    // 使用记录（2026-10-29）：**读之前先抽取**（同 010 T009 的次序）。60 秒节流 ＋ 单飞，
    // 失败沿用已有数据——列表是主功能，不能因为用量统计坏了就 500。
    if (deps.时控.该抽()) {
      yield* Effect.promise(() => deps.时控.跑一次({ db: deps.pg(), root: dataRoot(process.env) }))
    }
    // 读失败也**不能** 500：列表是主功能。省略整个键 ⇒ 前端落进设计 §7 的第三档「这一项不出现」，
    // 不会被渲染成「最近 30 天还没人用过」（那是假 0，正是本 feature 要修的东西，`#002-02`）。
    const usageStats = yield* Effect.promise(() =>
      用量统计(deps.pg(), assets.map((asset) => asset.id), nowSeconds()),
    ).pipe(
      // Effect 4 里旧名 `catchAllCause` 叫 `catchCause`：失败 / 缺陷 / 中断一并接住。
      Effect.catchCause((cause) =>
        Effect.sync(() => console.warn("[openhive-asset-usage] 用量统计失败，本次不带 usageStats", cause)).pipe(
          Effect.as(undefined),
        ),
      ),
    )

    return ok({
      assets,
      total,
      page: 分页.page,
      pageSize: 分页.pageSize,
      categoryNames,
      favoritedIds,
      ...(usageStats === undefined ? {} : { usageStats }),
    })
  })
}
