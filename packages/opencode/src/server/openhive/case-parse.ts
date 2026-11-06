export * as OpenhiveCaseParse from "./case-parse"

import { Database } from "@opencode-ai/core/database/database"
import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { AnchorWorkspace } from "../routes/instance/httpapi/middleware/anchor-workspace"
import { 可解析扩展名 } from "./case-parseable"
import { 材料视图 } from "./case-materials"
import { OpenhivePg } from "./pg"
import { 成员角色 as 成员角色共享 } from "./project-actor"

/**
 * 材料解析的两个出口（设计 §5.2 / §5.3 / §8.1）。
 *
 * ## 为什么写出口收「动作」而不是收目标状态
 *
 * 界面上的五个菜单项是**动作**（入队 / 重新解析 / 取消 / 跳过），落点由状态机决定：
 * 排队中取消回「未入队」、解析中取消落「有问题」。让前端算目标状态，等于把状态机抄进
 * 前端第二份，两边一漂就会出现「界面说未入队、库里还是解析中」。
 */
export const PREFIX = "/openhive/case"

export const PATH = {
  materials: `${PREFIX}/materials`,
} as const

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
  /** 每用户 SQLite：`成员角色` 判「老项目属主」那一道来源要用（见 `project-actor.ts`）。 */
  readonly database: Database.Interface
  readonly root: string
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const config = yield* AnchorWorkspace.Config
    const database = yield* Database.Service
    const deps: Deps = { pg: openhivePg.pg, database, root: config.root }

    yield* router.add("GET", PATH.materials, (request) => handleMaterials(request, deps))
  }),
)

function ok(value: unknown) {
  return HttpServerResponse.jsonUnsafe(value, { status: 200 })
}

function fail(status: number, error: string, code?: string) {
  return HttpServerResponse.jsonUnsafe(code === undefined ? { error } : { error, code }, { status })
}

const 身份 = Effect.serviceOption(User.Service)

/** 判据只有一份，住在 `./project-actor`（`LEARNINGS #002-06` / `#010-06`）。 */
const 成员角色 = (deps: Deps, userId: string, projectId: string) =>
  成员角色共享({ pg: deps.pg(), database: deps.database }, userId, projectId)

function 是合法段(value: string | null): value is string {
  return value !== null && value !== "" && User.isSafePathSegment(value)
}

function handleMaterials(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })

    const projectId = new URL(request.url, "http://localhost").searchParams.get("projectId")
    if (!是合法段(projectId)) return fail(400, "projectId 非法", "bad_request")
    if ((yield* 成员角色(deps, user.value.id, projectId)) === undefined)
      return fail(403, "不是该项目成员", "forbidden")

    const materials = yield* Effect.promise(() => 材料视图(deps.pg(), projectId))
    return ok({ materials, parseableExtensions: [...可解析扩展名] })
  })
}
