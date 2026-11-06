export * as OpenhiveCaseFactRoutes from "./case-fact-routes"

import { Database } from "@opencode-ai/core/database/database"
import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { 纠正原因们, type 纠正原因, 留痕类型们, type 留痕类型 } from "./case-fact-change"
import { 事实详情 } from "./case-fact-read"
import { 裁决, 裁决动作们, 裁决冲突, type 裁决动作 } from "./case-trust"
import { OpenhivePg } from "./pg"
import { 成员角色 as 成员角色共享 } from "./project-actor"

/**
 * 纠错与可信状态的出口（设计 §9）。**这里只有出站与入参校验**，判定全在
 * `case-trust.ts` / `case-merge.ts` / `case-proposals.ts`。
 *
 * ## 为什么再写一遍 `ok` / `fail` / `成员角色`
 *
 * `case-parse.ts` 里那三个是文件私有的六行小工具，不是判据。真正的判据只有一份：
 * `project-actor.ts` 的 `成员角色`（`#002-06` / `#010-06`）。这里 import 的就是它。
 *
 * ## 动作而不是目标状态
 *
 * `POST /facts/trust` 收 `action ∈ {确认, 排除, 存疑, 修正, 撤销}`，落点由服务端算——
 * 与 `case-parse.ts` 的 `POST /parse` 同一条口径。
 */

export const PREFIX = "/openhive/case"

export const PATH = {
  facts: `${PREFIX}/facts`,
  trust: `${PREFIX}/facts/trust`,
  merge: `${PREFIX}/entities/merge`,
  split: `${PREFIX}/entities/split`,
  proposals: `${PREFIX}/proposals`,
  proposalDecide: `${PREFIX}/proposals/decide`,
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

    yield* router.add("GET", PATH.facts, (request) => handleFacts(request, deps))
    yield* router.add("POST", PATH.trust, (request) => handleTrust(request, deps))
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

/** 体不是 JSON 对象 ⇒ `undefined`（同 `project-assets.ts` / `case-parse.ts` 的 `读体`）。 */
function 读体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({ onFailure: () => undefined, onSuccess: (value: unknown) => (isRecord(value) ? value : undefined) }),
  )
}

function 是合法段(value: unknown): value is string {
  return typeof value === "string" && value !== "" && User.isSafePathSegment(value)
}

const 是事实类型 = (value: unknown): value is 留痕类型 =>
  typeof value === "string" && (留痕类型们 as readonly string[]).includes(value)

const 是裁决动作 = (value: unknown): value is 裁决动作 =>
  typeof value === "string" && (裁决动作们 as readonly string[]).includes(value)

/** 自由字符串不能直接断言成 `纠正原因`：非法的要先回 400，别落进库约束炸成 500。 */
const 是纠正原因 = (value: unknown): value is 纠正原因 =>
  typeof value === "string" && (纠正原因们 as readonly string[]).includes(value)

function handleFacts(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })

    const 参数 = new URL(request.url, "http://localhost").searchParams
    const projectId = 参数.get("projectId")
    const type = 参数.get("type")
    const id = 参数.get("id")
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "bad_request")
    if (!是事实类型(type)) return fail(400, "type 只能是 entity / relation / event", "bad_request")
    if (typeof id !== "string" || id === "") return fail(400, "id 不能为空", "bad_request")

    if ((yield* 成员角色(deps, user.value.id, projectId)) === undefined)
      return fail(403, "不是该项目成员", "forbidden")

    const 详情 = yield* Effect.promise(() =>
      事实详情(deps.pg(), {
        projectId,
        type,
        id,
        includeExcluded: 参数.get("includeExcluded") === "true",
      }),
    )
    if (详情 === undefined) return fail(404, "找不到这条事实", "fact_not_found")
    return ok(详情)
  })
}

function handleTrust(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })

    const body = yield* 读体(request)
    if (body === undefined) return fail(400, "请求体不是 JSON 对象", "bad_request")

    const projectId = body["projectId"]
    const factType = body["factType"]
    const factId = body["factId"]
    const action = body["action"]
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "bad_request")
    if (!是事实类型(factType)) return fail(400, "factType 只能是 entity / relation / event", "bad_request")
    if (typeof factId !== "string" || factId === "") return fail(400, "factId 不能为空", "bad_request")
    if (!是裁决动作(action)) return fail(400, "action 只能是 确认 / 排除 / 存疑 / 修正 / 撤销", "bad_request")

    if ((yield* 成员角色(deps, user.value.id, projectId)) === undefined)
      return fail(403, "不是该项目成员", "forbidden")

    const reasonKind = body["reasonKind"]
    if (reasonKind !== undefined && reasonKind !== null && !是纠正原因(reasonKind))
      return fail(400, "reasonKind 只能是 识别错 / 抽取错 / 材料本身有问题", "bad_request")

    const 结果 = yield* Effect.promise(() =>
      裁决(deps.pg(), {
        projectId,
        factType,
        factId,
        action,
        reasonKind: 是纠正原因(reasonKind) ? reasonKind : null,
        reasonText: typeof body["reasonText"] === "string" ? body["reasonText"] : null,
        changes: isRecord(body["changes"]) ? body["changes"] : undefined,
        by: user.value.id,
      }).catch((error: unknown) => {
        if (error instanceof 裁决冲突) return error
        throw error
      }),
    )
    if (结果 instanceof 裁决冲突) return fail(409, 结果.message, 结果.code)
    return ok({ ok: true, trustState: 结果.trustState })
  })
}
