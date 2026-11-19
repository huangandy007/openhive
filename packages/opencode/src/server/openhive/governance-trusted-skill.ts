export * as OpenhiveGovernanceTrustedSkill from "./governance-trusted-skill"

/**
 * 平台级「可信技能」白名单出口（016 T016 / FR-047）。
 *
 * ## 判据：`User.Info.isAdmin`，服务端一处
 *
 * 三个出口（列表 / 加入 / 撤出）都先过同一道管理员门：无凭证 401，`isAdmin !== true` 403。
 * 权限判定在**读体之前**——没权限的人连体格式都不该被评（`#004-09`）。不查治理授权行：
 * FR-047 是 `is_admin` 总开关口径，与 T014 写函数里的 `操作人是管理员` 同源
 * （`packages/core/src/user.ts:30`）。
 *
 * ## 审计不在这里记
 *
 * `加白名单` / `撤白名单` 内部已按「真的改动了才留痕」写 `记治理`
 * （`case.trusted_skill.add` / `.revoke`）。路由再记一遍就是两条审计、两个前提（`#002-06`）。
 *
 * ## 错误映射
 *
 * `forbidden` → 403；`asset_not_found` → 404；`asset_not_skill` / `asset_not_published` → 409。
 */

import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { 加白名单, 撤白名单, 列白名单, type 白名单写入结果 } from "./case-trusted-skill"
import { OpenhivePg } from "./pg"

export const PREFIX = "/openhive/governance/trusted-skills"

export const PATH = {
  list: PREFIX,
  revoke: `${PREFIX}/revoke`,
} as const

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const deps: Deps = { pg: openhivePg.pg }

    yield* router.add("GET", PATH.list, () => handleList(deps))
    yield* router.add("POST", PATH.list, (request) => handleAdd(request, deps))
    yield* router.add("POST", PATH.revoke, (request) => handleRevoke(request, deps))
  }),
)

function ok(value: unknown) {
  return HttpServerResponse.jsonUnsafe(value, { status: 200 })
}

function fail(status: number, error: string, code?: string) {
  return HttpServerResponse.jsonUnsafe(code === undefined ? { error } : { error, code }, { status })
}

const 身份 = Effect.serviceOption(User.Service)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function 读体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({ onFailure: () => undefined, onSuccess: (value: unknown) => (isRecord(value) ? value : undefined) }),
  )
}

/** 管理员门：401 / 403 的响应由调用方直接返回；通过则给 `{ user }`。 */
const 过管理员 = Effect.gen(function* () {
  const user = yield* 身份
  if (Option.isNone(user)) return HttpServerResponse.empty({ status: 401 })
  if (!user.value.isAdmin) return fail(403, "只有单位管理员能维护可信技能白名单", "forbidden")
  return { user: user.value }
})

function 读资产id(体: Record<string, unknown> | undefined) {
  if (体 === undefined) return fail(400, "请求体必须是 JSON 对象", "bad_request")
  if (typeof 体.assetId !== "string" || 体.assetId === "")
    return fail(400, "assetId 不能为空", "bad_request")
  return 体.assetId
}

function 映射写入结果(结果: 白名单写入结果) {
  if (结果.ok) return ok({ ok: true })
  if (结果.code === "forbidden") return fail(403, "只有单位管理员能维护可信技能白名单", 结果.code)
  if (结果.code === "asset_not_found") return fail(404, "资产不存在", 结果.code)
  if (结果.code === "asset_not_skill") return fail(409, "只能加入 type=skill 的资产", 结果.code)
  // 剩下的只有 asset_not_published（联合只剩四个值）。
  return fail(409, "该技能未发布，不能加入", 结果.code)
}

function handleList(deps: Deps) {
  return Effect.gen(function* () {
    const 门 = yield* 过管理员
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const 列表 = yield* Effect.promise(() => 列白名单(deps.pg()))
    return ok({ list: 列表 })
  })
}

function handleAdd(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 门 = yield* 过管理员
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const assetId = 读资产id(yield* 读体(request))
    if (HttpServerResponse.isHttpServerResponse(assetId)) return assetId

    const 结果 = yield* Effect.promise(() =>
      加白名单(deps.pg(), { assetId, userId: 门.user.id, 操作人是管理员: true }),
    )
    return 映射写入结果(结果)
  })
}

function handleRevoke(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const 门 = yield* 过管理员
    if (HttpServerResponse.isHttpServerResponse(门)) return 门

    const assetId = 读资产id(yield* 读体(request))
    if (HttpServerResponse.isHttpServerResponse(assetId)) return assetId

    const 结果 = yield* Effect.promise(() =>
      撤白名单(deps.pg(), { assetId, userId: 门.user.id, 操作人是管理员: true }),
    )
    return 映射写入结果(结果)
  })
}
