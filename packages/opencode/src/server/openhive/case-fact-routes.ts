export * as OpenhiveCaseFactRoutes from "./case-fact-routes"

import { Database } from "@opencode-ai/core/database/database"
import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { 留痕类型们, type 留痕类型 } from "./case-fact-change"
import { 事实详情 } from "./case-fact-read"
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
