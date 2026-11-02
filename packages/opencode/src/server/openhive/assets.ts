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
 * ## 「只列在线」是产品口径（2026-11-01 终审修正）
 *
 * 使用面是「我能用的东西」：列 `published` **与 `iterating`**，草稿 / 待审 / 待技术发布 /
 * 下线 / 归档都不该出现在这里。`offline` 虽然 `canReadAsset()` 放行（看得见、不能用），
 * 但使用面连列表也不给。
 *
 * 为什么 iterating 要进来：迭代中的内容**仍是线上那一份**（`assetLocation` 对 iterating
 * 返回 `publishDirectory`，内核照常加载），把它从浏览面摘掉等于「迭代期间资产从所有人眼前
 * 消失」；而作者失去入口就意味着设计 §7 的「迭代中 + 提交 / 放弃」一次都渲染不出来。
 * `readable-sql.ts` 的 `SHARED_STATUSES` 早就把 iterating 当共享状态，设计 §7 还专门定义了
 * 「iterating 但我不是作者」的只读态——两者都要求它可见。
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
 *
 * ## 可写集合与内容编辑（2026-10-31）
 *
 * 列表再回一个 `writableIds`：**本页里我有 `write` 的**，与 `favoritedIds` 同构的平行数组
 * （理由同上：不往共用类型上加 per-user 字段）。判据是 `effectivePermissions()` 一份。
 * 写出口是 `PATCH /openhive/assets/:id`（改 `description` / `summary` / `precautions`），
 * 次序恒定「身份 → 存在 → 授权 → 校验 → 写」——**授权先于校验**（见 `handleContent`）。
 */

import { realpath, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import {
  AssetMetadataError,
  assetById,
  countAssets,
  listAssets,
  updateAssetContent,
  type AssetContentPatch,
  type AssetListFilters,
} from "@opencode-ai/asset-service/asset"
import { effectivePermissions } from "@opencode-ai/asset-service/authorization"
import { AssetTransitionError, type SkillAction } from "@opencode-ai/asset-service/lifecycle"
import { favoriteAssetIds } from "@opencode-ai/asset-service/preferences"
import { authorizeTransition } from "@opencode-ai/asset-service/review"
import { createDraftAsset, transitionAsset } from "@opencode-ai/asset-service/service"
import { DIRECTORY_META_KEY, resolveSourceDirectory, sandboxDirectoryOf } from "@opencode-ai/asset-service/governance"
import {
  MissingSourceDirectoryError,
  assetsRoot,
  iterationWorkspaceDirectory,
} from "@opencode-ai/asset-service/storage"
import { grantsFor } from "@opencode-ai/auth/rbac"
import { workspaceRoot } from "@opencode-ai/auth/workspace"
import { categoryNamesOf, listCategories, OTHER_CATEGORY_ID } from "@opencode-ai/asset-service/category-store"
import { Database } from "@opencode-ai/core/database/database"
import { WorkspaceRoot } from "@opencode-ai/core/workspace-root"
import { offsetOf, parsePage } from "./paging"
import { 成员角色 } from "./project-actor"
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
import { Effect, Option, Result } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { create抽取时控, 用量统计 } from "./asset-usage"
import { OpenhivePg } from "./pg"

export const PATH = {
  list: "/openhive/assets",
  content: "/openhive/assets/:id",
  // 【保留的定制 · 同步上游时不要丢】版本迭代（2026-11-01，设计 §6）。
  // 挂在使用面而不是治理台：`governance-assets.ts` 已划定这三条属作者动作。
  iteration: "/openhive/assets/:id/iteration",
  iterationSubmit: "/openhive/assets/:id/iteration/submit",
  iterationAbort: "/openhive/assets/:id/iteration/abort",
  // 【保留的定制 · 同步上游时不要丢】项目技能提交审核（2026-11-01 设计 §4.4）。
  submit: "/openhive/assets/:id/submit",
  // 入库：把项目里**未入库**的 skill 目录登记成草稿（提交审核的上一步）。
  draft: "/openhive/assets/draft",
} as const

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403
const NOT_FOUND = 404
const CONFLICT = 409

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
  /** 使用记录的抽取节流（一个应用层一份；见 `asset-usage.ts` 的 `create抽取时控`）。 */
  readonly 时控: ReturnType<typeof create抽取时控>
  /**
   * **调用者自己的**每用户 SQLite。`projectId` 归属判定要读它（老项目的唯一证据）——
   * 判据是 `./project-actor` 的 `成员角色()`，本文件不另写回落（`#002-06` / `#010-06`）。
   */
  readonly database: Database.Interface
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const database = yield* Database.Service
    const deps: Deps = { pg: openhivePg.pg, 时控: create抽取时控(), database }

    yield* router.add("GET", PATH.list, (request) => handleList(request, deps))
    // 入库（2026-11-01，设计 §4.4）：`/draft` 只有一个路径段，**必须注册在 `:id` 系列之前**——
    // 否则按注册顺序匹配时 `draft` 会被当成某个资产 id。
    yield* router.add("POST", PATH.draft, (request) => handleCreateDraft(request, deps))
    yield* router.add("PATCH", PATH.content, (request) => handleContent(request, deps))
    // 迭代三个端点共用 `handleIteration`：同一件事只该有一条实现（`#002-06`）。
    yield* router.add("POST", PATH.iteration, (request) => handleIteration(request, deps, "start_iteration"))
    yield* router.add("POST", PATH.iterationSubmit, (request) => handleIteration(request, deps, "submit_iteration"))
    yield* router.add("POST", PATH.iterationAbort, (request) => handleIteration(request, deps, "abort_iteration"))
    // 提交审核（2026-11-01，设计 §4.4）：作者在能力面板上点「提交审核」的服务端落点。
    yield* router.add("POST", PATH.submit, () => handleSubmit(deps))
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
      // 在线 = 已发布 + 迭代中（2026-11-01 终审修正）。iterating 的内容仍是线上那一份
      // （`assetLocation` 对 iterating 返回发布目录），摘掉它 = 迭代期间资产从所有人眼前
      // 消失；`readable-sql.ts` 的 `SHARED_STATUSES` 也早把 iterating 当共享状态。
      status: ["published", "iterating"],
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

    // 可写的（2026-10-31）：与 `favoritedIds` 同构的平行数组——不往 `AssetMetadata` 上加
    // per-user 字段（那份类型与治理后台共用，加了会让另一个出口回假值）。
    // 判据只有 `effectivePermissions()` 一份；本页资产已经过可见性下推，这里只看 write。
    const 本页授权 = yield* Effect.promise(() => grantsFor(deps.pg(), userId))
    const writableIds = assets
      .filter((asset) => effectivePermissions(viewer, asset, 本页授权).has("write"))
      .map((asset) => asset.id)

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
      writableIds,
      ...(usageStats === undefined ? {} : { usageStats }),
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function 读取体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({ onFailure: () => undefined, onSuccess: (value: unknown) => value }),
  )
}

/**
 * `PATCH /openhive/assets/:id`（2026-10-31）：改介绍 / 功能描述 / 注意事项。
 *
 * 次序是「身份 → 存在 → 授权 → 校验 → 写」：
 * - 不存在回 404（存在性问题，与 `favorites.ts:140` 同一口径）；
 * - **有资产但无 write 一律 403，先于长度校验的 400**——否则可以靠 400/403 的差别
 *   试探「合法长度是多少」，也等于把校验规则暴露给无权者（`#004-09`）。
 *
 * 回包是**读完库之后的完整元数据**，不是「我送了什么」（与收藏出口同一取向）。
 */
function handleContent(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id

    const 参数 = yield* HttpRouter.params
    const assetId = 参数.id ?? ""
    const body = yield* 读取体(request)
    // 请求体形态检查有意前置到「找资产」之前（终审 M-2）：这是**与资产无关**的请求形态错误
    // （不是 JSON 对象），不是内容校验。不构成存在性探测——对存在与不存在的 id，非对象体
    // 都回同一个 400；只有「请求体是对象」时才继续 404 / 403 / 字段校验那条链。
    if (!isRecord(body)) return fail(BAD_REQUEST, "请求体不是 JSON 对象")

    const asset = yield* Effect.promise(() => assetById(deps.pg(), assetId))
    if (asset === undefined) return fail(NOT_FOUND, "资产不存在")

    const department = yield* 取部门(deps, userId)
    const grants = yield* Effect.promise(() => grantsFor(deps.pg(), userId))
    if (!effectivePermissions({ userId, department }, asset, grants).has("write")) {
      return fail(FORBIDDEN, "无权修改该资产")
    }

    const patch: AssetContentPatch = {}
    for (const 字段 of ["description", "summary", "precautions"] as const) {
      const 值 = body[字段]
      if (值 === undefined) continue
      if (typeof 值 !== "string") return fail(BAD_REQUEST, `${字段} 必须是字符串`)
      patch[字段] = 值
    }
    if (Object.keys(patch).length === 0) return fail(BAD_REQUEST, "没有可修改的字段")

    const 结果 = yield* Effect.result(
      Effect.tryPromise({
        try: () => updateAssetContent(deps.pg(), assetId, patch, nowSeconds()),
        catch: (error) => error,
      }),
    )
    if (Result.isFailure(结果)) {
      const error = 结果.failure
      if (error instanceof AssetMetadataError) return fail(BAD_REQUEST, error.message)
      throw error
    }
    if (结果.success === undefined) return fail(NOT_FOUND, "资产不存在")
    return ok(结果.success)
  })
}

/**
 * `POST /openhive/assets/draft`（2026-11-01，设计 §4.4）：把项目里的一个 skill 目录登记成资产草稿。
 *
 * 【保留的定制 · 同步上游时不要丢】项目技能提交审核的前半程：前端随后串行调
 * `POST /openhive/assets/:id/submit` 完成「一键入库并提交」。
 *
 * ## 两层边界与 MCP 的 `create_skill_draft` 完全相同，**共用同一份实现**
 *
 * ① 调用目录必须落在 `<沙箱根>/<userId>/` 之内（`sandboxDirectoryOf`）；
 * ② `skillPath` 只收相对路径，解析后必须仍在项目目录内（`resolveSourceDirectory`）；
 * ③ **真身**也必须仍在项目目录内：② 只比字面路径，而项目里的 `.opencode/skill/<id>` 是指向
 *    共享资产库的 junction（`#009-03`）——字面判定挡不住链接，必须两边 `realpath` 再比。
 *
 * 少任一层，一个 `../..` 或一条链接就能把服务器上任意目录复制成「已提交的 skill」。
 *
 * ## 次序
 *
 * 身份 → 读体 → 字段校验 → 项目归属 → 目录边界 → 建草稿（**建草稿是唯一副作用**）。
 * 所有拒绝都排在复制之前：失败时 `<资产根>/draft` 一个目录都不会多。
 *
 * 目录边界内部再分：**字面边界（403）→ 源存在性 / SKILL.md（400）→ 真身越界（403）→ 复制**。
 * 越界必须先于任何复制（`#004-09`）；而「源不是目录 / 没有 SKILL.md」是调用方给错了源，
 * 回 400——否则前者会落进 `stageDirectory` 的普通 `Error` 变 500，后者会建出一条内核
 * 永远扫不到、却可提交发布的废草稿。
 *
 * ## `storage` 必传
 *
 * 提交审核只从 `<资产根>/draft/<assetId>` 取内容（Task 2 起）。`createDraftAsset` 的
 * `storage` 是可选参数，漏传会造出一个**永远提交不了**的草稿——本端点显式传。
 */
function handleCreateDraft(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id

    const body = yield* 读取体(request)
    if (!isRecord(body)) return fail(BAD_REQUEST, "请求体不是 JSON 对象")

    const 项目 = body["projectId"]
    if (typeof 项目 !== "string" || !User.isSafePathSegment(项目)) return fail(BAD_REQUEST, "projectId 不合法")
    const 相对 = body["skillPath"]
    if (typeof 相对 !== "string" || 相对.trim() === "") return fail(BAD_REQUEST, "skillPath 不能为空")
    const 名称 = body["name"]
    const 描述 = body["description"]
    const 分类 = body["category"]
    const 可见 = body["visibility"]
    if (typeof 名称 !== "string" || 名称.trim() === "") return fail(BAD_REQUEST, "name 不能为空")
    if (typeof 描述 !== "string") return fail(BAD_REQUEST, "description 必须是字符串")
    if (typeof 分类 !== "string" || 分类.trim() === "") return fail(BAD_REQUEST, "category 不能为空")
    // 分类必须在册（设计 §4.8：停用的分类等同不存在，文案要能指路）。
    // 闭集的唯一来源是 `category-store.ts`，不在这里拼 SQL、也不拿 seed 常量冒充。
    const 分类表 = yield* Effect.promise(() => listCategories(deps.pg()))
    if (!分类表.some((条) => 条.id === 分类 && 条.enabled)) {
      return fail(BAD_REQUEST, "这个分类已停用，请重新选择")
    }
    if (typeof 可见 !== "string" || !是可见性(可见)) return fail(BAD_REQUEST, "未知可见范围")

    // 不是成员 ⇒ 400 而不是 404：404 会变成「这个项目 id 存在吗」的探针（判据只有 `成员角色` 一份）。
    const 角色 = yield* 成员角色({ pg: deps.pg(), database: deps.database }, userId, 项目)
    if (角色 === undefined) return fail(BAD_REQUEST, "目标项目不属于你")

    // 与迭代端点同一条规范化：本机 `%TEMP%` 是 8.3 短名，字面比较会让同一物理目录出现两种形状（`#006-23`）。
    const 沙箱根 = WorkspaceRoot.canonicalRoot(workspaceRoot(process.env))
    const 项目目录 = join(沙箱根, userId, 项目)
    let 源: string
    try {
      // ① 与 MCP 同一个 `sandboxDirectoryOf`：调用目录必须落在 `<沙箱根>/<userId>/` 内。
      sandboxDirectoryOf(沙箱根, userId, { [DIRECTORY_META_KEY]: 项目目录 })
      // ② 与 MCP 同一个 `resolveSourceDirectory`：相对路径解析后仍在项目目录内。
      源 = resolveSourceDirectory(项目目录, 相对)
    } catch {
      return fail(FORBIDDEN, "源目录必须在项目目录之内")
    }
    // 源必须真的是一个带 SKILL.md 的目录（排在字面边界之后、真身判定之前）：
    // - 指向文件 / 不存在 ⇒ 400。不先判，`stageDirectory` 会抛普通 `Error`，被下面 `throw` 成 500；
    // - 没有 SKILL.md ⇒ 400。内核只加载带 SKILL.md 的 skill，建成草稿就是废数据
    //   （可提交、可发布，但内核永远扫不到）。
    const 源信息 = yield* Effect.promise(() => stat(源).catch(() => undefined))
    if (源信息 === undefined || !源信息.isDirectory()) {
      return fail(BAD_REQUEST, "源目录不存在或不是目录")
    }
    // 存在不算数，必须是**文件**：`SKILL.md/` 这样的同名目录只 stat 会过关，内核照样扫不到。
    // 上面的 `isDirectory()` 同理：存在性要连同类型一起判，才能把「调用方给错了源」挡成 400。
    const 有技能文件 = yield* Effect.promise(() =>
      stat(join(源, "SKILL.md")).then(
        (info) => info.isFile(),
        () => false,
      ),
    )
    if (!有技能文件) return fail(BAD_REQUEST, "这个目录里没有 SKILL.md")

    // ③ 字面判定挡不住链接（`#009-03`）：真身越界同样 403，且发生在复制之前。
    if (!(yield* 真身在目录内(项目目录, 源))) {
      return fail(FORBIDDEN, "源目录必须在项目目录之内")
    }

    const 部门 = yield* 取部门(deps, userId)
    const 结果 = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          createDraftAsset({
            db: deps.pg(),
            owner: { id: userId, name: user.value.name, department: 部门 },
            name: 名称,
            description: 描述,
            category: 分类,
            visibility: 可见,
            // 必传：草稿副本落进 `<资产根>/draft/<id>`，提交审核只认这一份。
            storage: { root: assetsRoot(process.env), sourceDirectory: 源, projectDirectory: 项目目录 },
          }),
        catch: (error) => error,
      }),
    )
    if (Result.isFailure(结果)) {
      const error = 结果.failure
      if (error instanceof AssetMetadataError) return fail(BAD_REQUEST, error.message)
      throw error
    }
    const asset = 结果.success
    return ok({ assetId: asset.id, name: asset.name, status: asset.status, visibility: asset.visibility })
  })
}

/**
 * `source` 的**真身**是否仍落在 `root` 的**真身**里（`#009-03`）。
 *
 * 两边都 `realpath` 再逐段比（同 `file.ts` 的 `realInside`）：项目根本身经由链接到达时，
 * 只解一边会把所有正常路径一起拒掉。取不到真身（源不存在 / 无权限）一律 false（fail-closed）——
 * 拒绝只会让调用方拿到 403，不会去复制。
 */
function 真身在目录内(root: string, source: string) {
  return Effect.promise(async () => {
    const [真根, 真源] = await Promise.all([
      realpath(root).catch(() => undefined),
      realpath(source).catch(() => undefined),
    ])
    if (真根 === undefined || 真源 === undefined) return false
    return 真源 === join(真根, relative(root, source))
  })
}

/**
 * 迭代三个端点共用一个处理函数（`#002-06`：同一件事只该有一条实现）。
 *
 * 【保留的定制 · 同步上游时不要丢】版本迭代（2026-11-01，设计 §6）。
 *
 * **顺序是有判据的**（`LEARNINGS #004-09`）：身份 → 资产存在 → **授权** → 读请求体 → 校验
 * projectId → 流转。授权排在读体之前：非作者递畸形 JSON 拿 403 而不是 400——错误码本身
 * 不能变成「你有没有这个权限」的探针。
 *
 * `projectId` 必须是**调用者自己的项目**（判据：`./project-actor` 的 `成员角色()`，两套来源的
 * 唯一入口，`#010-06`）：不是成员回 400 而不是 404——404 会变成「这个项目 id 存在吗」的探针。
 * 这一步在 `transitionAsset()` 之前，所以拒绝时沙箱里一个目录都不会出现。
 */
function handleIteration(
  request: HttpServerRequest.HttpServerRequest,
  deps: Deps,
  action: SkillAction,
) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id

    const 参数 = yield* HttpRouter.params
    const assetId = 参数.id ?? ""
    const asset = yield* Effect.promise(() => assetById(deps.pg(), assetId))
    if (asset === undefined) return fail(NOT_FOUND, "资产不存在")

    const department = yield* 取部门(deps, userId)
    const grants = yield* Effect.promise(() => grantsFor(deps.pg(), userId))
    const viewer = { userId, department }

    // 授权先于读体（`#004-09`）；这里用**同一个** `authorizeTransition()` 先过一遍门，
    // 服务层随后会再算一次（确定性函数、无副作用），不是两份规则。
    const 预检 = yield* Effect.result(
      Effect.try({
        try: () => authorizeTransition(viewer, asset, grants, action),
        catch: (error) => error,
      }),
    )
    if (Result.isFailure(预检)) return 失败(预检.failure)

    let note: string | undefined
    let projectId: string | undefined
    if (action === "start_iteration") {
      const body = yield* 读取体(request)
      if (!isRecord(body)) return fail(BAD_REQUEST, "请求体不是 JSON 对象")

      const 说明 = body["note"]
      if (typeof 说明 !== "string") return fail(BAD_REQUEST, "note 必须是字符串")
      note = 说明

      const 项目 = body["projectId"]
      if (typeof 项目 !== "string" || !User.isSafePathSegment(项目)) {
        return fail(BAD_REQUEST, "projectId 不合法")
      }
      // 不是成员 ⇒ 400 而不是 404：404 会变成「这个项目 id 存在吗」的探针。
      //
      // 判据**只查这一处**（`./project-actor` 的 `成员角色`，`#002-06`）。不能只查 PG 的
      // `auth.project_member`：多租户改造前建的老项目只在**属主自己**库的 `project_ext` 里
      // 有行，PG 名册里根本没有——只查 PG 会让属主自己发起迭代被判成「不属于你」（`#010-06`，
      // 真栈 13 条清单里 11 条如此）。回落有界：PG 名册有该项目、或 `project_meta` 认识它时，
      // 一律以 PG 为准，绝不放宽（否则别人的库里残留一行就能越权）。
      const 角色 = yield* 成员角色({ pg: deps.pg(), database: deps.database }, userId, 项目)
      if (角色 === undefined) return fail(BAD_REQUEST, "目标项目不属于你")
      projectId = 项目
    }

    // 回包 / 解析工作副本用的根必须与内核锚定侧**同形**（`middleware/anchor-workspace.ts`
    // 的 `Config.root` 也过这一层）。本机 `%TEMP%` 是 8.3 短名（`…\ADMINI~1\…`），原样回给前端
    // 后，它与项目目录（长名）比较、或喂给 AI 再回读时，同一物理目录会出现两个形状（`#006-23`
    // 「resolve≠同形」）。`transitionAsset()` 内部的落盘口径不动——这里只对齐出口。
    const 沙箱根 = WorkspaceRoot.canonicalRoot(workspaceRoot(process.env))
    const 结果 = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          transitionAsset({
            db: deps.pg(),
            root: assetsRoot(process.env),
            assetId,
            action,
            viewer,
            grants,
            workspaceRoot: 沙箱根,
            ...(note === undefined ? {} : { reason: note }),
            ...(projectId === undefined ? {} : { projectId }),
          }),
        catch: (error) => error,
      }),
    )
    if (Result.isFailure(结果)) return 失败(结果.failure)

    const updated = 结果.success
    // 只给作者回工作副本的**绝对路径**（前端要把它写进给 AI 的指令里）。
    // 空 / 缺 `iterationWorkspace` 时回 `null`，不编一个路径。
    // 路径解析只走 `iterationWorkspaceDirectory()`，不在这里另写一份拼接（`#002-06`）。
    const 相对 = updated.iterationWorkspace
    const 工作副本 =
      相对 === null || 相对 === "" ? null : iterationWorkspaceDirectory(沙箱根, 相对)

    return ok({
      assetId: updated.id,
      status: updated.status,
      version: updated.version,
      workspace: 工作副本,
    })
  })
}

/**
 * `POST /openhive/assets/:id/submit`（2026-11-01，设计 §4.4）。
 *
 * 【保留的定制 · 同步上游时不要丢】项目技能提交审核。
 *
 * 次序与迭代三端点逐条一致（`#004-09`）：身份 → 资产存在 → 授权 → 流转。
 * 授权用**同一个** `authorizeTransition()`；状态机自己拒绝「已提交过 / 不是草稿」。
 *
 * 与迭代端点的差别只有三处：不读请求体（本端点无 body）、action 固定 `submit_review`、
 * 不查项目归属（提交不看项目）。也不传 `workspaceRoot`——本动作不发布，不重指项目链接。
 */
function handleSubmit(deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id

    const 参数 = yield* HttpRouter.params
    const assetId = 参数.id ?? ""
    const asset = yield* Effect.promise(() => assetById(deps.pg(), assetId))
    if (asset === undefined) return fail(NOT_FOUND, "资产不存在")

    const department = yield* 取部门(deps, userId)
    const grants = yield* Effect.promise(() => grantsFor(deps.pg(), userId))
    const viewer = { userId, department }

    // 授权先于一切副作用（`#004-09`）；判据只有 `authorizeTransition()` 一份（`#005-24`）。
    const 预检 = yield* Effect.result(
      Effect.try({
        try: () => authorizeTransition(viewer, asset, grants, "submit_review"),
        catch: (error) => error,
      }),
    )
    if (Result.isFailure(预检)) return 失败(预检.failure)

    // 【保留的定制 · 同步上游时不要丢】提交审核只处理 skill（2026-11-02 批次 2 裁定 A/C）：
    // MCP 没有草稿副本，服务层自本批次起对它放行 7 状态机；不在这里按类型拒绝，
    // 属主会拿到 200 + in_review，实际没提交任何内容。MCP 提交入口在批次 3 随 UI / 试连一起定义。
    // 位置放在授权预检之后：否则会把「这是个 MCP 资产」泄漏给没有写权的人（`#004-09`）。
    if (asset.type !== "skill") {
      return 失败(new AssetTransitionError("unsupported_asset_type", `该接口只提交 skill：${assetId}`))
    }

    const 结果 = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          transitionAsset({
            db: deps.pg(),
            root: assetsRoot(process.env),
            assetId,
            action: "submit_review",
            viewer,
            grants,
          }),
        catch: (error) => error,
      }),
    )
    if (Result.isFailure(结果)) {
      const error = 结果.failure
      // 状态口径与迭代出口不同，特殊口径留在本出口，不让共用 `失败()` 背裸状态码（设计 §4.4 / §4.8）。
      if (error instanceof AssetTransitionError) {
        if (error.code === "invalid_source") {
          // 只有「已经送审」才是重复提交。published / offline / archived / iterating / pending_*
          // 从没提交过，说「已经提交过了」是假话（D7 只授权重复提交这一种）。
          return fail(BAD_REQUEST, asset.status === "in_review" ? "已经提交过了" : "当前状态不能提交审核")
        }
        if (error.code === "concurrent_transition") {
          // 并发那一刻可能是别人（比如管理员）动了它——说「已经提交过了」是第二种假话。
          return fail(BAD_REQUEST, "状态已变化，请刷新后再试")
        }
      }
      return 失败(error)
    }

    const updated = 结果.success
    return ok({ assetId: updated.id, status: updated.status, version: updated.version })
  })
}

/**
 * 迭代出口的错误翻译。
 *
 * 与治理台那份**分开写**是有意的：本仓每个出口模块各有一份 `映射错误()`，见
 * `governance-assets.ts` 的同名函数——出口的失败面各不相同，抽成一份公共映射会让
 * 「这个出口会回哪些码」变成要跳文件才能读出来的事。
 *
 * 文案差异也是真的：`reason_required` 在这里是**变更说明**，不是治理台那句「理由」。
 *
 * `default` 里的 `never` 赋值是给未来加码的人用的：新增 `TransitionErrorCode` 却忘了
 * 在这里给映射 ⇒ typecheck 红，而不是运行时悄悄落到 500（Task 3 的 `iteration_not_submitted`
 * 在治理台那边就是这么漏掉的）。
 */
function 失败(error: unknown) {
  if (error instanceof AssetTransitionError) {
    switch (error.code) {
      case "asset_not_found":
        return fail(NOT_FOUND, error.message)
      case "actor_not_allowed":
        return fail(FORBIDDEN, error.message)
      case "reason_required":
        return fail(BAD_REQUEST, "请填写变更说明")
      case "unknown_action":
      case "unsupported_asset_type":
        return fail(BAD_REQUEST, error.message)
      case "invalid_source":
      case "concurrent_transition":
      case "source_directory_required":
      case "draft_content_missing":
      case "personal_asset_not_shared":
      case "department_missing":
      case "visibility_not_applicable":
      case "iteration_not_submitted":
        return fail(CONFLICT, error.message)
      default: {
        const 未覆盖: never = error.code
        throw new Error(`未映射的流转错误码：${String(未覆盖)}`)
      }
    }
  }
  if (error instanceof MissingSourceDirectoryError) return fail(CONFLICT, error.message)
  throw error
}
