export * as OpenhiveCaseUiRoutes from "./case-ui-routes"

import { Database } from "@opencode-ai/core/database/database"
import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 生成提醒, 标记已读, 提醒清单 } from "./case-alerts"
import { 产物复核, 登记产物引用 } from "./case-artifact-citations"
import { 实体档案, 实体清单, 分组计数, type 实体分组, type 排序 } from "./case-entity-list"
import { 关系图, 关系图强度们 } from "./case-graph"
import { 材料事实清单 } from "./case-material-facts"
import { aggregate_money, query_events, 工具错误 } from "./case-mcp-tools"
import { 确认别名, 撤销别名 } from "./case-field-alias"
import { 列出数据源档案, 建数据源档案, 撤销数据源档案, 档案错误 } from "./case-source-profile-store"
import { 单位闸放行, 是识别字段 } from "./case-field-registry"
import { OpenhivePg } from "./pg"
import { 成员角色 as 成员角色共享 } from "./project-actor"
import { getMaterial, 读材料事实行, type Queryable } from "./case-store"
import {
  列出模板,
  读模板行,
  建模板,
  改模板,
  停用模板,
  转正模板,
  草稿模板行,
  模板错误,
} from "./case-card-template-store"
import { 检查模板定义, 模板词表, 是用户模板id, type 模板定义, type 模板行 } from "./case-card-template"
import { 翻译模板 } from "./case-template-translate"
import type { 卡片草稿 } from "./case-translate"

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
  fieldAlias: `${PREFIX}/field-alias`,
  fieldAliasRevoke: `${PREFIX}/field-alias/revoke`,
  sourceProfiles: `${PREFIX}/source-profiles`,
  sourceProfileBuild: `${PREFIX}/source-profile/build`,
  sourceProfileRevoke: `${PREFIX}/source-profile/revoke`,
  cardTemplates: `${PREFIX}/card-templates`,
  cardTemplateCreate: `${PREFIX}/card-template/create`,
  cardTemplateUpdate: `${PREFIX}/card-template/update`,
  cardTemplateDisable: `${PREFIX}/card-template/disable`,
  cardTemplatePreview: `${PREFIX}/card-template/preview`,
  cardTemplateVerify: `${PREFIX}/card-template/verify`,
  cardTemplateVocab: `${PREFIX}/card-template/vocab`,
  cardTemplateRestore: `${PREFIX}/card-template/restore`,
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
    yield* router.add("POST", PATH.fieldAlias, (request) => handleFieldAlias(request, deps))
    yield* router.add("POST", PATH.fieldAliasRevoke, (request) => handleFieldAliasRevoke(request, deps))
    yield* router.add("GET", PATH.sourceProfiles, (request) => handleSourceProfiles(request, deps))
    yield* router.add("POST", PATH.sourceProfileBuild, (request) => handleSourceProfileBuild(request, deps))
    yield* router.add("POST", PATH.sourceProfileRevoke, (request) => handleSourceProfileRevoke(request, deps))
    yield* router.add("GET", PATH.cardTemplates, (request) => handleCardTemplates(request, deps))
    yield* router.add("POST", PATH.cardTemplateCreate, (request) => handleCardTemplateCreate(request, deps))
    yield* router.add("POST", PATH.cardTemplateUpdate, (request) => handleCardTemplateUpdate(request, deps))
    yield* router.add("POST", PATH.cardTemplateDisable, (request) => handleCardTemplateDisable(request, deps))
    yield* router.add("POST", PATH.cardTemplatePreview, (request) => handleCardTemplatePreview(request, deps))
    yield* router.add("POST", PATH.cardTemplateVerify, (request) => handleCardTemplateVerify(request, deps))
    yield* router.add("GET", PATH.cardTemplateVocab, (request) => handleCardTemplateVocab(request))
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

/**
 * 每个读取口的前半段都一样：身份 → projectId → 成员。`undefined` ＝ 已经回了响应。
 *
 * `要属主` 是写给口用的可选加严（R42）：拿到 `{ user }` 后再判一次角色，**不另查一遍 `身份`**；
 * 将来 `过门` 加新判据时，属主口自动跟随（`#005-24` 共同出口）。`成员角色` 仍只查一次。
 *
 * `已知身份` 让写口先自己查一次身份（401 必须在读体之前回，R51），再把结果传进来——
 * 判据仍只在这一个出口，同时避免每个请求查两次 `身份`。
 */
function 过门(
  deps: Deps,
  projectId: string | null,
  选项: { readonly 要属主?: boolean; readonly 已知身份?: User.Info; readonly 属主拒绝文案?: string } = {},
): Effect.Effect<{ readonly user: User.Info } | HttpServerResponse.HttpServerResponse> {
  return Effect.gen(function* () {
    const user = 选项.已知身份 !== undefined ? Option.some(选项.已知身份) : yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "bad_request")
    const 角色 = yield* 成员角色(deps, user.value.id, projectId)
    if (角色 === undefined) return fail(403, "不是该项目成员", "forbidden")
    if (选项.要属主 === true && 角色 !== "owner")
      return fail(403, 选项.属主拒绝文案 ?? "只有项目属主能维护字段别名", "forbidden")
    return { user: user.value }
  })
}

const 是排序 = (值: unknown): 值 is 排序 => 值 === "涉案" || 值 === "名称" || 值 === "时间"

const 是分组 = (值: unknown): 值 is 实体分组 => 值 === "核心" || 值 === "提及"

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

    // 省略 `group` = 跨组（搜索用）；给了就必须是枚举值——非法值静默忽略会让人以为筛过了。
    const group原文 = 参数.get("group")
    let 分组值: 实体分组 | undefined
    if (group原文 !== null) {
      if (!是分组(group原文)) return fail(400, "group 只能是 核心 / 提及", "bad_request")
      分组值 = group原文
    }
    const q = 参数.get("q") ?? undefined
    const sort原文 = 参数.get("sort")
    let 排序值: 排序 | undefined
    if (sort原文 !== null) {
      if (!是排序(sort原文)) return fail(400, "sort 只能是 涉案 / 名称 / 时间", "bad_request")
      排序值 = sort原文
    }
    const limit原文 = 读整数(参数.get("limit"))
    if (limit原文 === null) return fail(400, "limit 必须是整数", "bad_request")

    const [groups, list] = yield* Effect.promise(() =>
      Promise.all([
        分组计数(deps.pg(), projectId!),
        实体清单(deps.pg(), {
          projectId: projectId!,
          分组: 分组值,
          q,
          sort: 排序值,
          limit: limit原文,
        }),
      ]),
    )
    return ok({ groups, list })
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
      实体档案(deps.pg(), {
        projectId: projectId!,
        id,
        includeExcluded: 参数.get("includeExcluded") === "true",
        // 未验证模板的卡片对人是可见的，只对 AI 默认隐藏（§11.1）；人的档案页显式放行。
        含未验证: true,
      }),
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
    const 强度原文 = 参数.get("强度")
    const 强度 = 强度原文 === null ? "全部" : 关系图强度们.find((档) => 档 === 强度原文)
    if (强度 === undefined) return fail(400, "强度只能是 全部 / 重点 / 强", "bad_request")
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
        强度,
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
    // 界面时间线是**人看**的：未验证模板卡也要显示（模板是用户自己配的，预览已让他确认过），
    // 与 AI 出口的默认隐藏相反（§11.2）。
    const 结果 = yield* Effect.promise(() =>
      query_events(
        { db: deps.pg(), 身份: { userId: 门.user.id, projectId: projectId! } },
        { 参与实体: 值, 起: 入参.起, 止: 入参.止, 含未验证: true },
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

/**
 * 别名确认口（计划 11 Task 9）。
 *
 * 次序同本文件既有写口（`handleAlertsRefresh` 那一节的口径）：
 * **身份 → 体 → 字段校验 → 门（`要属主`）→ DAO**。
 * - 身份最先（R51）：未登录者不该让服务端去解析他的请求体；未登录 + 体坏也回 401。
 * - 字段校验在门之前：所以「非成员 / 非属主 + 坏字段」回 400，与文件既有写口一致（R51 裁定保留）。
 * - 门拿到 `已知身份`，判据仍只在 `过门` 一个出口，且每个请求只查一次 `身份`。
 *
 * `materialId` 只作审计元数据，不校验它属于该项目（R25）；`projectId` 只用于授权，
 * 不进别名查询条件（R24）。
 *
 * ## 失败口径
 *
 * Effect 的失败不会以 JS `throw` 回到生成器，`try/catch` 是死代码（R23）——所以让 promise
 * **resolve 成错误值**再分支。但**只映射已知业务错误**：DAO 的「已存在」⇒ 409（R47 仍靠文案
 * 子串，本计划不改 tagged error）；其余一律原样 `throw`，让它成为 Effect defect ⇒ 500＋ref，
 * 与兄弟口 `撤销别名`（裸 `Effect.promise`）同口径（R41）。这样 DB / schema / 参数细节不会
 * 以 400 的形式漏给客户端，故障也能按 ref 诊断。
 *
 * 路由前的校验已覆盖「表头为空 / 超长」「字段不在目录内」，所以 DAO 里那两条错误在正常路径
 * 不可达；它们若真出现，按非「已存在」处理 ⇒ 500，属于服务端问题而不是用户参数问题。
 */
function handleFieldAlias(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 用户 = yield* 身份
    if (Option.isNone(用户)) return HttpServerResponse.empty({ status: 401 })

    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = typeof body["projectId"] === "string" ? body["projectId"] : null

    const header = body["header"]
    const field = body["field"]
    const materialId = body["materialId"]
    if (typeof header !== "string") return fail(400, "表头为空或超过 200 字", "bad_request")
    // R43：与 DAO 同口径，先 trim 再判长；否则「200 字 + 尾空格」会被路由先拒。
    const 表头 = header.trim()
    if (表头 === "" || 表头.length > 200) return fail(400, "表头为空或超过 200 字", "bad_request")
    if (typeof field !== "string" || !是识别字段(field))
      return fail(400, "字段不在字段目录内", "bad_request")
    // 与 DAO 同口径（`#002-06`）：单位闸不通的别名注定无效。这是用户参数问题，
    // 在路由给 400；DAO 里那道同样的闸是给绕过路由的调用方兜底。
    if (!单位闸放行(field, 表头)) return fail(400, "表头声明的单位与字段不符，不能写别名", "bad_request")
    if (typeof materialId !== "string" || materialId === "") return fail(400, "materialId 必填", "bad_request")

    const 门 = yield* 过门(deps, projectId, { 要属主: true, 已知身份: 用户.value })
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const 结果 = yield* Effect.promise(() =>
      确认别名(deps.pg(), {
        header: 表头,
        field,
        materialId,
        projectId: projectId!,
        by: 门.user.id,
      }).then(
        () => undefined,
        (错误: unknown) => {
          const 话 = 错误 instanceof Error ? 错误.message : ""
          if (话.includes("已存在")) return { 冲突: 话 }
          // R41：未知错误不映射成 400 —— 原样抛回，成为 defect（500＋ref）。
          throw 错误
        },
      ),
    )
    if (结果 !== undefined) return fail(409, 结果.冲突, "conflict")
    return ok({ ok: true })
  })
}

/**
 * 撤销口：`false` ＝ 没有这条或已撤销 ⇒ 404；DB 错误保持裸 promise（无专用状态码）。
 *
 * 次序同确认口：身份 → 体 → 表头校验 → 门 → DAO（R51）。
 *
 * ⚠️ 传进来的 `by` 目前**只作调用凭据、不落库**：表里没有 `revoked_by` 列，本计划不做迁移
 * （R46）。别把它当成审计记账。
 */
function handleFieldAliasRevoke(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 用户 = yield* 身份
    if (Option.isNone(用户)) return HttpServerResponse.empty({ status: 401 })

    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = typeof body["projectId"] === "string" ? body["projectId"] : null

    const header = body["header"]
    if (typeof header !== "string") return fail(400, "表头为空或超过 200 字", "bad_request")
    // R43：撤销口同样先 trim 再判长，与 DAO 的 `撤销别名` 同口径。
    const 表头 = header.trim()
    if (表头 === "" || 表头.length > 200) return fail(400, "表头为空或超过 200 字", "bad_request")

    const 门 = yield* 过门(deps, projectId, { 要属主: true, 已知身份: 用户.value })
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const 撤销 = yield* Effect.promise(() => 撤销别名(deps.pg(), { header: 表头, by: 门.user.id }))
    return 撤销 ? ok({ ok: true }) : fail(404, "没有这个别名或已撤销", "not_found")
  })
}

/**
 * 数据源档案三个出口（P4 Task 5）。
 *
 * 读口只有一个开关：`含撤销=true` 才把已撤销的档案也列出来；只有显式 `true` / `false`
 * 合法，其他值回 400（静默忽略会让人以为筛过了）。写口两个都是**属主口**：
 * 门文案换成「只有项目属主能维护数据源档案」，别让档案口回一句「维护字段别名」。
 *
 * 建档的次序沿用本文件写口口径（R51）：身份最先（未登录 + 坏体也是 401）→ 读体 →
 * 字段校验 → 门（`要属主`）→ DAO。DAO 的业务错误按 `档案错误` 的 code 翻成 404 / 409 / 400；
 * 其余错误原样抛出，成为 defect（500＋ref），不把 DB / schema 细节当 400 漏给客户端。
 */
function 翻档案错误(错误: 档案错误) {
  if (错误.code === "material_not_found") return fail(404, 错误.message, "not_found")
  if (错误.code === "no_fingerprints") return fail(409, 错误.message, "conflict")
  if (错误.code === "conflict") return fail(409, 错误.message, "conflict")
  return fail(400, 错误.message, "bad_request")
}

function handleSourceProfiles(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    const 门 = yield* 过门(deps, 参数.get("projectId"))
    if (HttpServerResponse.isHttpServerResponse(门)) return 门
    const 含撤销 = 参数.get("含撤销")
    if (含撤销 !== null && 含撤销 !== "true" && 含撤销 !== "false") {
      return fail(400, "含撤销 只能是 true / false", "bad_request")
    }
    const list = yield* Effect.promise(() =>
      列出数据源档案(deps.pg(), { projectId: 参数.get("projectId")!, 含撤销: 含撤销 === "true" }),
    )
    return ok({ list })
  })
}

function handleSourceProfileBuild(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 用户 = yield* 身份
    if (Option.isNone(用户)) return HttpServerResponse.empty({ status: 401 })

    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = typeof body["projectId"] === "string" ? body["projectId"] : null
    const materialId = body["materialId"]
    if (typeof materialId !== "string" || materialId === "") return fail(400, "materialId 必填", "bad_request")
    const 工作表 = body["工作表"]
    if (工作表 !== undefined && (typeof 工作表 !== "string" || 工作表.trim() === "")) {
      return fail(400, "工作表 必须是非空字符串", "bad_request")
    }
    const name = body["name"]
    if (name !== undefined && (typeof name !== "string" || name.trim() === "" || name.length > 200)) {
      return fail(400, "name 必须是非空字符串且不超过 200 字", "bad_request")
    }
    const 覆盖 = body["覆盖"]
    if (覆盖 !== undefined && typeof 覆盖 !== "boolean") return fail(400, "覆盖 必须是布尔值", "bad_request")

    const 门 = yield* 过门(deps, projectId, {
      要属主: true,
      已知身份: 用户.value,
      属主拒绝文案: "只有项目属主能维护数据源档案",
    })
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const 结果 = yield* Effect.promise(() =>
      建数据源档案(deps.pg(), {
        projectId: projectId!,
        materialId,
        ...(工作表 === undefined ? {} : { 工作表 }),
        ...(name === undefined ? {} : { name }),
        ...(覆盖 === undefined ? {} : { 覆盖 }),
      }).then(
        (值) => ({ 值 }),
        (错误: unknown) => {
          if (错误 instanceof 档案错误) return { 错误 }
          throw 错误
        },
      ),
    )
    if ("错误" in 结果) return 翻档案错误(结果.错误)
    return ok(结果.值)
  })
}

function handleSourceProfileRevoke(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 用户 = yield* 身份
    if (Option.isNone(用户)) return HttpServerResponse.empty({ status: 401 })

    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = typeof body["projectId"] === "string" ? body["projectId"] : null
    const id = body["id"]
    if (typeof id !== "string" || id === "") return fail(400, "id 必填", "bad_request")

    const 门 = yield* 过门(deps, projectId, {
      要属主: true,
      已知身份: 用户.value,
      属主拒绝文案: "只有项目属主能维护数据源档案",
    })
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const 撤销 = yield* Effect.promise(() => 撤销数据源档案(deps.pg(), { projectId: projectId!, id }))
    return 撤销 ? ok({ ok: true }) : fail(404, "没有这个档案或已撤销", "not_found")
  })
}

/**
 * 卡片模板六口（P4 Task 5，§10）。
 *
 * 权限口径：列表与预览是**成员**（`过门` 非属主分支），建 / 改 / 停用 / 转正是**属主**。
 * 写口次序沿用本文件口径（R51）：身份最先（未登录不因体坏先回 400）→ 读体 → 形状与词表校验
 * → 门（`要属主`）→ DAO。判定全在 `case-card-template-store.ts`，这里只翻错误码。
 *
 * 预览是**只读口**：不落库、不调模型、不记 `hit_count`（§10.3）。`templateId` 与 `template`
 * 二选一；给草稿时用 `草稿模板行` 造伪行（卡片 id 槽位固定「预览」）。
 */
function 读定义(
  body: Record<string, unknown>,
): { name: string; eventType: string; slots: unknown; required: unknown } | undefined {
  const name = body["name"]
  const eventType = body["eventType"]
  const slots = body["slots"]
  const required = body["required"]
  // 形状闸：`检查模板定义` 对非字符串 name / eventType 会直接 `.trim()` 抛 TypeError ⇒ 500。
  if (typeof name !== "string" || typeof eventType !== "string") return undefined
  if (typeof slots !== "object" || slots === null || Array.isArray(slots)) return undefined
  if (!Array.isArray(required) || required.some((项) => typeof 项 !== "string")) return undefined
  return { name, eventType, slots, required }
}

function 翻模板错误(错误: 模板错误) {
  if (错误.code === "not_found") return fail(404, 错误.message, "not_found")
  if (错误.code === "state_changed") return fail(409, 错误.message, "state_changed")
  return fail(错误.code === "bad_request" ? 400 : 409, 错误.message, 错误.code)
}

/** DAO 调用统一捕 `模板错误`，其余照抛（defect ⇒ 500+ref）。 */
function 跑模板<T>(工作: () => Promise<T>) {
  return Effect.promise(() =>
    工作().then(
      (值) => ({ 值 }),
      (错误: unknown) => {
        if (错误 instanceof 模板错误) return { 错误 }
        throw 错误
      },
    ),
  )
}

/**
 * 词表口（设计 §3）：登录即可，不查项目。词表是代码常量，没有项目差异；
 * 前端拿它渲染下拉，服务端保存时仍按同一份规则校验（词表只省一次往返，不是授权边界）。
 */
function handleCardTemplateVocab(_request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    const 用户 = yield* 身份
    if (Option.isNone(用户)) return HttpServerResponse.empty({ status: 401 })
    return ok(模板词表())
  })
}

function handleCardTemplates(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 参数 = new URL(request.url, "http://localhost").searchParams
    // 纯字段校验先于项目门（§10.2 的校验顺序）：非成员传坏参数也该是 400，不是 403。
    const 含停用 = 参数.get("含停用")
    if (含停用 !== null && 含停用 !== "true" && 含停用 !== "false") {
      return fail(400, "含停用 只能是 true / false", "bad_request")
    }
    const 门 = yield* 过门(deps, 参数.get("projectId"))
    if (HttpServerResponse.isHttpServerResponse(门)) return 门
    const list = yield* Effect.promise(() =>
      列出模板(deps.pg(), { projectId: 参数.get("projectId")!, 含停用: 含停用 === "true" }),
    )
    return ok({ list })
  })
}

function handleCardTemplateCreate(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 用户 = yield* 身份
    if (Option.isNone(用户)) return HttpServerResponse.empty({ status: 401 })
    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = typeof body["projectId"] === "string" ? body["projectId"] : null
    const 定义 = 读定义(body)
    if (定义 === undefined) return fail(400, "模板定义字段不全或类型不对", "bad_request")
    const 检查 = 检查模板定义(定义)
    if (检查.错.length > 0) return fail(400, 检查.错.join("；"), "bad_request")
    const 门 = yield* 过门(deps, projectId, {
      要属主: true,
      已知身份: 用户.value,
      属主拒绝文案: "只有项目属主能维护卡片模板",
    })
    if (HttpServerResponse.isHttpServerResponse(门)) return 门
    const 结果 = yield* 跑模板(() => 建模板(deps.pg(), { projectId: projectId!, 定义: 检查.值! }))
    if ("错误" in 结果) return 翻模板错误(结果.错误)
    return ok(结果.值)
  })
}

function handleCardTemplateUpdate(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 用户 = yield* 身份
    if (Option.isNone(用户)) return HttpServerResponse.empty({ status: 401 })
    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = typeof body["projectId"] === "string" ? body["projectId"] : null
    const id = body["id"]
    if (typeof id !== "string" || id === "") return fail(400, "id 必填", "bad_request")
    const 定义 = 读定义(body)
    if (定义 === undefined) return fail(400, "模板定义字段不全或类型不对", "bad_request")
    const 检查 = 检查模板定义(定义)
    if (检查.错.length > 0) return fail(400, 检查.错.join("；"), "bad_request")
    const 门 = yield* 过门(deps, projectId, {
      要属主: true,
      已知身份: 用户.value,
      属主拒绝文案: "只有项目属主能维护卡片模板",
    })
    if (HttpServerResponse.isHttpServerResponse(门)) return 门
    const 结果 = yield* 跑模板(() => 改模板(deps.pg(), { projectId: projectId!, id, 定义: 检查.值! }))
    if ("错误" in 结果) return 翻模板错误(结果.错误)
    return ok(结果.值)
  })
}

function handleCardTemplateDisable(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 用户 = yield* 身份
    if (Option.isNone(用户)) return HttpServerResponse.empty({ status: 401 })

    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = typeof body["projectId"] === "string" ? body["projectId"] : null
    const id = body["id"]
    if (typeof id !== "string" || id === "") return fail(400, "id 必填", "bad_request")

    const 门 = yield* 过门(deps, projectId, {
      要属主: true,
      已知身份: 用户.value,
      属主拒绝文案: "只有项目属主能维护卡片模板",
    })
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const 停 = yield* 跑模板(() => 停用模板(deps.pg(), { projectId: projectId!, id }))
    if ("错误" in 停) return 翻模板错误(停.错误)
    return 停.值 ? ok({ ok: true }) : fail(404, "没有这个模板或已停用", "not_found")
  })
}

/** 预览输出（§10.3）：`卡片们` 只给编辑器要画的字段。 */
interface 预览输出 {
  卡片数: number
  跳过: Record<string, number>
  卡片们: ReturnType<typeof 预览卡>[]
  工作表们: { sheet: string; 卡片数: number; 跳过: Record<string, number> }[]
}

/** 可判别联合：成功 / 失败各带自己的字段，调用处 `if (!结果.ok)` 一次分流（不用 `as`）。 */
type 预览结果 = { ok: true; 预览: 预览输出 } | { ok: false; 状态: 404 | 409; code: string; error: string }

async function 跑预览(
  db: Queryable,
  input: { projectId: string; materialId: string; 模板: 模板行 },
): Promise<预览结果> {
  const 材料 = await getMaterial(db, input.projectId, input.materialId)
  if (材料 === undefined) return { ok: false, 状态: 404, code: "material_not_found", error: "找不到这份材料" }
  const 表们 = 预览表们(材料.parseDetail)
  if (材料.parseStatus !== "已解析" || 表们.length === 0 || 表们.some((表) => !表.有列)) {
    return {
      ok: false,
      状态: 409,
      code: "material_not_ready",
      error: "这份材料还没有可预览的解析结果（旧材料需要重新解析）",
    }
  }
  const 卡片们: ReturnType<typeof 预览卡>[] = []
  const 跳过合计: Record<string, number> = {}
  const 表回执们: { sheet: string; 卡片数: number; 跳过: Record<string, number> }[] = []
  for (const 表 of 表们) {
    const 行们 = await 读材料事实行(db, input.projectId, input.materialId, 表.sheet, 20)
    const 翻译 = 翻译模板({
      projectId: input.projectId,
      materialId: input.materialId,
      template: input.模板,
      rows: 行们,
    })
    const 跳过: Record<string, number> = {}
    for (const 条 of 翻译.跳过们) 跳过[条.原因] = (跳过[条.原因] ?? 0) + 1
    for (const [原因, 数] of Object.entries(跳过)) 跳过合计[原因] = (跳过合计[原因] ?? 0) + 数
    表回执们.push({ sheet: 表.sheet, 卡片数: 翻译.卡片们.length, 跳过 })
    for (const 卡 of 翻译.卡片们) 卡片们.push(预览卡(卡))
  }
  return { ok: true, 预览: { 卡片数: 卡片们.length, 跳过: 跳过合计, 卡片们, 工作表们: 表回执们 } }
}

function 是记录值(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

/** parse_detail.mapping.工作表 的条目；`列` 是「这份材料可预览」的判据（§10.3）。 */
function 预览表们(detail: unknown): { sheet: string; 有列: boolean }[] {
  if (!是记录值(detail)) return []
  const mapping = detail["mapping"]
  if (!是记录值(mapping)) return []
  const 表 = mapping["工作表"]
  if (!是记录值(表)) return []
  return Object.entries(表).flatMap(([sheet, 值]) => (是记录值(值) ? [{ sheet, 有列: 是记录值(值["列"]) }] : []))
}

/** 预览卡的响应形状（§10.3）：只给编辑器要画的字段，不暴露内部类型。 */
function 预览卡(卡: 卡片草稿) {
  return {
    id: 卡.id,
    type: 卡.type,
    摘要: 卡.摘要,
    occurredAt: 卡.occurredAt,
    occurredRaw: 卡.occurredRaw,
    precision: 卡.precision,
    occurredEnd: 卡.occurredEnd ?? null,
    amount: 卡.amount,
    currency: 卡.currency,
    attrs: 卡.attrs,
    参与者们: 卡.participants.map((p) => ({
      角色: p.角色,
      提及: p.提及,
      规范值: p.规范值,
      实体: p.实体,
      实体类型: p.实体类型,
      ordinal: p.ordinal,
    })),
    出处: { sheet: 卡.sheet, rowNo: 卡.rowNo },
    跳过: null,
  }
}

function handleCardTemplatePreview(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 用户 = yield* 身份
    if (Option.isNone(用户)) return HttpServerResponse.empty({ status: 401 })
    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = typeof body["projectId"] === "string" ? body["projectId"] : ""
    const materialId = body["materialId"]
    if (typeof materialId !== "string" || materialId === "") return fail(400, "materialId 必填", "bad_request")
    const templateId = body["templateId"]
    const template = body["template"]
    if ((templateId === undefined) === (template === undefined)) {
      return fail(400, "templateId 与 template 必须二选一", "bad_request")
    }
    let 草稿: 模板定义 | undefined
    if (template !== undefined) {
      const 定义 = isRecord(template) ? 读定义(template) : undefined
      if (定义 === undefined) return fail(400, "template 字段不全或类型不对", "bad_request")
      const 检查 = 检查模板定义(定义)
      if (检查.值 === undefined) return fail(400, 检查.错.join("；"), "bad_request")
      草稿 = 检查.值
    }

    // 预览是只读口：成员即可（不写库、不计命中）。
    const 门 = yield* 过门(deps, projectId, { 已知身份: 用户.value })
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    let 选中: 模板行 | undefined
    if (草稿 !== undefined) {
      选中 = 草稿模板行(草稿)
    } else if (typeof templateId === "string" && templateId !== "") {
      选中 = yield* Effect.promise(() => 读模板行(deps.pg(), projectId, templateId))
      if (选中 === undefined) return fail(404, "没有这个模板", "not_found")
      // §10.3：`templateId` 须是用户模板；内置行由代码规则维护，不能作为可编辑预览的对象。
      // 停用模板允许预览（只读、不写库）：民警常要先看一眼再决定恢复。
      if (!是用户模板id(选中.id)) {
        return fail(400, "内置模板不可编辑，请先另存为项目模板再预览", "bad_request")
      }
    }
    if (选中 === undefined) return fail(400, "templateId 与 template 必须二选一", "bad_request")
    const 模板 = 选中

    const 结果 = yield* Effect.promise(() => 跑预览(deps.pg(), { projectId, materialId, 模板 }))
    if (!结果.ok) return fail(结果.状态, 结果.error, 结果.code)
    return ok(结果.预览)
  })
}

function handleCardTemplateVerify(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 用户 = yield* 身份
    if (Option.isNone(用户)) return HttpServerResponse.empty({ status: 401 })
    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")
    const projectId = typeof body["projectId"] === "string" ? body["projectId"] : ""
    const id = body["id"]
    const materialId = body["materialId"]
    if (typeof id !== "string" || id === "") return fail(400, "id 必填", "bad_request")
    if (typeof materialId !== "string" || materialId === "") return fail(400, "materialId 必填", "bad_request")
    const 期望版本 = body["expectedVersion"]
    if (期望版本 !== undefined && (typeof 期望版本 !== "number" || !Number.isInteger(期望版本))) {
      return fail(400, "expectedVersion 必须是整数", "bad_request")
    }

    const 门 = yield* 过门(deps, projectId, {
      要属主: true,
      已知身份: 用户.value,
      属主拒绝文案: "只有项目属主能维护卡片模板",
    })
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const 模板 = yield* Effect.promise(() => 读模板行(deps.pg(), projectId, id))
    if (模板 === undefined) return fail(404, "没有这个模板", "not_found")
    // §7.3：停用是「行还在、状态不对」，不是「不存在」——报 409 让前端能提示先恢复。
    if (模板.disabled_at !== null) return fail(409, "模板已停用，需先恢复", "conflict")
    if (!是用户模板id(模板.id)) return fail(409, "内置模板由代码规则维护，不能修改/停用/转正", "immutable")

    const 预览 = yield* Effect.promise(() => 跑预览(deps.pg(), { projectId, materialId, 模板 }))
    if (!预览.ok) return fail(预览.状态, 预览.error, 预览.code)
    const { 卡片数, 跳过 } = 预览.预览
    if (模板.verified_at !== null) {
      return ok({ verified_at: 模板.verified_at, 卡片数, 跳过, already: true })
    }
    // 失败响应也带 `跳过`：0 卡的原因全在跳过原因表里，前端不用再跑一次预览（§10.4）。
    if (卡片数 === 0) {
      return HttpServerResponse.jsonUnsafe(
        { error: "预览没有产出任何卡片：请检查必填槽与数据", code: "preview_failed", 跳过 },
        { status: 400 },
      )
    }
    // 没给 expectedVersion 就用刚才读到的版本：「有卡可看」这件事已经发生过，版本只在
    // 预览与转正之间被改过时才有意义；DAO 的 `version = $expected` 是最终一致性闸。
    const 结果 = yield* 跑模板(() =>
      转正模板(deps.pg(), {
        projectId,
        id,
        expectedVersion: typeof 期望版本 === "number" ? 期望版本 : 模板.version,
      }),
    )
    if ("错误" in 结果) return 翻模板错误(结果.错误)
    return ok({
      verified_at: 结果.值.verified_at,
      卡片数,
      跳过,
      ...(结果.值.already === true ? { already: true } : {}),
    })
  })
}
