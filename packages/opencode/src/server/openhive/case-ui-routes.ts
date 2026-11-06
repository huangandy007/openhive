export * as OpenhiveCaseUiRoutes from "./case-ui-routes"

import { Database } from "@opencode-ai/core/database/database"
import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 生成提醒, 标记已读, 提醒清单 } from "./case-alerts"
import { 产物复核, 登记产物引用 } from "./case-artifact-citations"
import { 实体档案, 实体清单, 类型计数, type 排序 } from "./case-entity-list"
import { 关系图 } from "./case-graph"
import { 材料事实清单 } from "./case-material-facts"
import { aggregate_money, query_events, 工具错误 } from "./case-mcp-tools"
import { OpenhivePg } from "./pg"
import { 成员角色 as 成员角色共享 } from "./project-actor"
import type { Queryable } from "./case-store"

/**
 * 案件视图的读取出口（计划 7）：实体清单 / 实体档案 / 材料事实 / 关系图 / 时间线 / 资金，
 * 加上主动提醒三出口（列出 / 重新比对 / 标记已读）——其中后两个是写口，不要按「只读」对待。
 *
 * ## 这一层只做三件事
 *
 * 身份 → 参数校验 → 调 DAO。判定全在 DAO 与 `project-actor.ts`（成员判据只有一份）。
 * 时间线与资金**复用计划 6 的取数函数**（`query_events` / `aggregate_money`），不复制 SQL：
 * 同一判据写第二份就是给「已排除是否可见」开第二个会漂的点（`LEARNINGS #005-04` / `#002-06`）。
 *
 * ## 错误口径
 *
 * 未登录 401；非成员 403；参数非法 400；DAO 找不到 404；`工具错误` 的 `not_found` ⇒ 404、
 * `bad_input` ⇒ 400、其余 500（`not_a_member` 走到这里说明门没拦住，是服务端问题不是用户问题）。
 */

export const PREFIX = "/openhive/case"

export const PATH = {
  entities: `${PREFIX}/entities`,
  entity: `${PREFIX}/entity`,
  materialFacts: `${PREFIX}/material-facts`,
  graph: `${PREFIX}/graph`,
  timeline: `${PREFIX}/timeline`,
  money: `${PREFIX}/money`,
  alerts: `${PREFIX}/alerts`,
  alertsRefresh: `${PREFIX}/alerts/refresh`,
  alertsRead: `${PREFIX}/alerts/read`,
  artifactCitations: `${PREFIX}/artifacts/citations`,
  artifactReview: `${PREFIX}/artifacts/review`,
} as const

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
  /** 「这项目是我的吗」有一道来源在每用户库（老项目属主），见 `project-actor.ts`。 */
  readonly database: Database.Interface
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const database = yield* Database.Service
    const deps: Deps = { pg: openhivePg.pg, database }
    yield* router.add("GET", PATH.entities, (request) => handleEntities(request, deps))
    yield* router.add("GET", PATH.entity, (request) => handleEntity(request, deps))
    yield* router.add("GET", PATH.materialFacts, (request) => handleMaterialFacts(request, deps))
    yield* router.add("GET", PATH.graph, (request) => handleGraph(request, deps))
    yield* router.add("GET", PATH.timeline, (request) => handleTimeline(request, deps))
    yield* router.add("GET", PATH.money, (request) => handleMoney(request, deps))
    yield* router.add("GET", PATH.alerts, (request) => handleAlerts(request, deps))
    yield* router.add("POST", PATH.alertsRefresh, (request) => handleAlertsRefresh(request, deps))
    yield* router.add("POST", PATH.alertsRead, (request) => handleAlertsRead(request, deps))
    yield* router.add("POST", PATH.artifactCitations, (request) => handleArtifactCitations(request, deps))
    yield* router.add("GET", PATH.artifactReview, (request) => handleArtifactReview(request, deps))
  }),
)

function ok(value: unknown) {
  return HttpServerResponse.jsonUnsafe(value, { status: 200 })
}

function fail(status: number, error: string, code?: string) {
  return HttpServerResponse.jsonUnsafe(code === undefined ? { error } : { error, code }, { status })
}

const 身份 = Effect.serviceOption(User.Service)

/** 判据只有一份，住在 `./project-actor`。 */
const 成员角色 = (deps: Deps, userId: string, projectId: string) =>
  成员角色共享({ pg: deps.pg(), database: deps.database }, userId, projectId)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 体不是 JSON 对象 ⇒ `undefined`（同 `case-fact-routes.ts` 的 `读体`；本仓库的私有小工具各留一份）。 */
function 读体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({ onFailure: () => undefined, onSuccess: (value: unknown) => (isRecord(value) ? value : undefined) }),
  )
}

function 是合法段(value: unknown): value is string {
  return typeof value === "string" && value !== "" && User.isSafePathSegment(value)
}

/** 每个读取口的前半段都一样：身份 → projectId → 成员。`undefined` ＝ 已经回了响应。 */
function 过门(
  deps: Deps,
  projectId: string | null,
): Effect.Effect<{ readonly user: User.Info } | HttpServerResponse.HttpServerResponse> {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "bad_request")
    if ((yield* 成员角色(deps, user.value.id, projectId)) === undefined)
      return fail(403, "不是该项目成员", "forbidden")
    return { user: user.value }
  })
}

const 是排序 = (值: unknown): 值 is 排序 => 值 === "涉案" || 值 === "名称" || 值 === "时间"

/** 秒级整数；缺省 / 空串 / 非法 ⇒ `undefined`（缺省不是错，非法由调用方判）。 */
function 读整数(值: string | null): number | undefined | null {
  if (值 === null || 值 === "") return undefined
  if (!/^-?\d+$/.test(值)) return null
  return Number(值)
}

/** 工具错误 → HTTP：坏输入 400、找不到 404、其余按服务端错误 500。 */
function 翻工具错误(错误: 工具错误) {
  if (错误.code === "bad_input") return fail(400, 错误.message, 错误.code)
  if (错误.code === "not_found") return fail(404, 错误.message, 错误.code)
  return fail(500, 错误.message, 错误.code)
}

/** 实体 id → 规范值（时间线 / 资金两个口要按值过滤：`participants` 与 `解析实体` 都认值）。 */
async function 取规范值(db: Queryable, projectId: string, id: string): Promise<string | undefined> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select canonical_value from auth.case_entity
       where project_id = ${projectId} and id = ${id} and trust_state <> '已排除'
    `),
  )
  return 行们.length === 0 ? undefined : String(行们[0].canonical_value)
}

/** 时间线 / 资金共用的入参读法：`id` ＋ 可选整数时间窗。 */
function 读实体与时间窗(
  参数: URLSearchParams,
): { readonly id: string; readonly 起: number | undefined; readonly 止: number | undefined } | undefined {
  const id = 参数.get("id")
  if (typeof id !== "string" || id === "") return undefined
  const 起 = 读整数(参数.get("起"))
  const 止 = 读整数(参数.get("止"))
  if (起 === null || 止 === null) return undefined
  return { id, 起, 止 }
}

function handleEntities(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    const projectId = 参数.get("projectId")
    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const type = 参数.get("type") ?? undefined
    const q = 参数.get("q") ?? undefined
    const sort原文 = 参数.get("sort")
    let 排序值: 排序 | undefined
    if (sort原文 !== null) {
      if (!是排序(sort原文)) return fail(400, "sort 只能是 涉案 / 名称 / 时间", "bad_request")
      排序值 = sort原文
    }
    const limit原文 = 读整数(参数.get("limit"))
    if (limit原文 === null) return fail(400, "limit 必须是整数", "bad_request")

    const [counts, list] = yield* Effect.promise(() =>
      Promise.all([
        类型计数(deps.pg(), projectId!),
        实体清单(deps.pg(), {
          projectId: projectId!,
          type,
          q,
          sort: 排序值,
          limit: limit原文,
        }),
      ]),
    )
    return ok({ counts, list })
  })
}

function handleEntity(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    const projectId = 参数.get("projectId")
    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const id = 参数.get("id")
    if (typeof id !== "string" || id === "") return fail(400, "id 不能为空", "bad_request")
    const 档 = yield* Effect.promise(() =>
      实体档案(deps.pg(), { projectId: projectId!, id, includeExcluded: 参数.get("includeExcluded") === "true" }),
    )
    if (档 === undefined) return fail(404, "找不到这个实体", "entity_not_found")
    return ok(档)
  })
}

function handleMaterialFacts(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    const projectId = 参数.get("projectId")
    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const path = 参数.get("path")
    if (typeof path !== "string" || path === "") return fail(400, "path 不能为空", "bad_request")
    const 清单 = yield* Effect.promise(() =>
      材料事实清单(deps.pg(), {
        projectId: projectId!,
        path,
        // 与档案出口同一个开关语义：只有显式 `true` 才带出已排除事实（§9.1 / R10）。
        includeExcluded: 参数.get("includeExcluded") === "true",
      }),
    )
    if (清单 === undefined) return fail(404, "这个项目里没有这份材料", "material_not_found")
    return ok(清单)
  })
}

function handleGraph(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    const projectId = 参数.get("projectId")
    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const id = 参数.get("id")
    if (typeof id !== "string" || id === "") return fail(400, "id 不能为空", "bad_request")
    const 跳数原文 = 参数.get("跳数")
    if (跳数原文 !== null && 跳数原文 !== "1" && 跳数原文 !== "2")
      return fail(400, "跳数只能是 1 或 2", "bad_request")
    const 上限原文 = 读整数(参数.get("limit"))
    if (上限原文 === null) return fail(400, "limit 必须是整数", "bad_request")
    const 类型原文 = 参数.get("type")
    const 类型 = 类型原文 === null || 类型原文 === "" ? undefined : 类型原文.split(",").map((条) => 条.trim())
    const 图 = yield* Effect.promise(() =>
      关系图(deps.pg(), {
        projectId: projectId!,
        id,
        跳数: 跳数原文 === "2" ? 2 : 1,
        类型,
        上限: 上限原文,
      }),
    )
    if (图 === undefined) return fail(404, "找不到这个实体", "entity_not_found")
    return ok(图)
  })
}

function handleTimeline(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    const projectId = 参数.get("projectId")
    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const 入参 = 读实体与时间窗(参数)
    if (入参 === undefined) return fail(400, "id 不能为空，起 / 止 必须是整数秒", "bad_request")
    const 值 = yield* Effect.promise(() => 取规范值(deps.pg(), projectId!, 入参.id))
    if (值 === undefined) return fail(404, "找不到这个实体", "entity_not_found")
    const 结果 = yield* Effect.promise(() =>
      query_events(
        { db: deps.pg(), 身份: { userId: 门.user.id, projectId: projectId! } },
        { 参与实体: 值, 起: 入参.起, 止: 入参.止 },
      ).catch((错误: unknown) => {
        if (错误 instanceof 工具错误) return 错误
        throw 错误
      }),
    )
    return 结果 instanceof 工具错误 ? 翻工具错误(结果) : ok(结果)
  })
}

function handleMoney(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    const projectId = 参数.get("projectId")
    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const 入参 = 读实体与时间窗(参数)
    if (入参 === undefined) return fail(400, "id 不能为空，起 / 止 必须是整数秒", "bad_request")
    const 值 = yield* Effect.promise(() => 取规范值(deps.pg(), projectId!, 入参.id))
    if (值 === undefined) return fail(404, "找不到这个实体", "entity_not_found")
    const 结果 = yield* Effect.promise(() =>
      aggregate_money(
        { db: deps.pg(), 身份: { userId: 门.user.id, projectId: projectId! } },
        { 账户: 值, 起: 入参.起, 止: 入参.止 },
      ).catch((错误: unknown) => {
        if (错误 instanceof 工具错误) return 错误
        throw 错误
      }),
    )
    return 结果 instanceof 工具错误 ? 翻工具错误(结果) : ok(结果)
  })
}

function handleAlerts(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    const projectId = 参数.get("projectId")
    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门
    return ok({ 提醒: yield* Effect.promise(() => 提醒清单(deps.pg(), projectId!)) })
  })
}

/**
 * 两个写口的**次序是判据**：身份 → 体 → 字段校验 → 成员 → DAO。
 *
 * - **身份最先**：未登录必须是 401，不能因为体坏了先回 400（出口还没认出是谁）。
 * - **字段校验在成员之前**：体不是对象 / `projectId` 不是字符串 ⇒ 400，而不是拿一个
 *   拼不出来的 id 去问成员、再回 403。
 * - **门前不碰库**：`过门` 内部的 `成员角色` 只是一次无状态服务查询；DAO 一律在门之后。
 */
function handleAlertsRefresh(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })

    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = body["projectId"]
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "bad_request")

    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门
    return ok(yield* Effect.promise(() => 生成提醒(deps.pg(), projectId)))
  })
}

/** 标记已读一次最多提交多少个 id。超了回 400，不在 DAO 里静默截断（`标记已读` 文件头）。 */
export const 已读IDs上限 = 500

function handleAlertsRead(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })

    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = body["projectId"]
    const ids = body["ids"]
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "bad_request")
    if (!Array.isArray(ids) || ids.some((id: unknown) => typeof id !== "string" || id === ""))
      return fail(400, "ids 必须是字符串数组", "bad_request")
    if (ids.length > 已读IDs上限)
      return fail(400, `ids 一次最多 ${已读IDs上限} 条（本次 ${ids.length} 条）`, "bad_request")

    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门
    return ok({ 已读: yield* Effect.promise(() => 标记已读(deps.pg(), projectId, ids as string[])) })
  })
}

/**
 * 产物引用两个出口（计划 7 Task 10）。
 *
 * POST 的次序与上面两个写口一致：**身份最先**（未登录不因体坏先回 400）→ 读体 → `projectId`
 * 走 `过门`（非法 400 / 非成员 403）→ `path` / `content` 校验 → DAO。
 * GET 复核**永远 200**：没登记过是本任务要如实说的一种状态，不是 404。
 */
function handleArtifactCitations(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })

    const body = yield* 读体(request)
    const projectId = typeof body?.projectId === "string" ? body.projectId : null
    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const path = body?.path
    const content = body?.content
    if (typeof path !== "string" || path === "") return fail(400, "path 不能为空", "bad_request")
    if (typeof content !== "string") return fail(400, "content 必须是字符串", "bad_request")
    return ok(yield* Effect.promise(() => 登记产物引用(deps.pg(), { projectId: projectId!, path, content })))
  })
}

function handleArtifactReview(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    const projectId = 参数.get("projectId")
    const 门 = yield* 过门(deps, projectId)
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const path = 参数.get("path")
    if (typeof path !== "string" || path === "") return fail(400, "path 不能为空", "bad_request")
    return ok(yield* Effect.promise(() => 产物复核(deps.pg(), { projectId: projectId!, path })))
  })
}
