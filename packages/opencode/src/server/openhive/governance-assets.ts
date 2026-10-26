export * as OpenhiveGovernanceAssets from "./governance-assets"

/**
 * 010 T007 · **AI 资产治理**的 HTTP 出口（FR-006 / US3）：待审列表 + 审核 / 发布 / 上下架。
 *
 * 能力全在 009：`listAssets` 负责列表，`transitionAsset` 负责 7 状态机、文件迁移、并发守卫
 * 与通知。本文件只做四件事——**身份、治理授权、载荷收窄、错误翻译**——状态与授权规则一条
 * 都不重写（`#002-06`：两份实现漂了不会报错）。
 *
 * ## 为什么要把治理授权「翻译」成资产授权行
 *
 * 009 的 `authorizeTransition()` 只认**逐资产**的授权行（`resource_type = asset.type`、
 * `resource_id = asset.id`），授权组也一样是「一份资产一条」，**没有通配**。而治理后台的权限是
 * 板块级的（`asset-governance` 的 `read` / `review` / `admin`）。两者是两套模型，
 * 直接拿板块权限去查资产授权永远是 0 行。
 *
 * 这里的翻译是**最小且不越权**的：先用 `authorizeGovernance(read)` 过进门那道门（它同时卡
 * `is_admin = 1`），再把本人在 `asset-governance` 上的 `review` / `admin` 行投影成**当前这一份
 * 资产**的授权行，交给 009 的 `authorizeTransition()` 派生角色。于是：
 *
 * - 业务专家（`review`）只能过业务关，发布时撞 `actor_not_allowed` ⇒ 403；
 * - 系统管理员（`admin`）只能过技术关 / 上下架，替业务审核同样 403；
 * - **不改 009 的判定**，也不给板块权限补通配（那会让「审」与「发」当场互相蕴含）。
 *
 * ## 动作是白名单，不是「转发一切」
 *
 * `submit_review` / `start_iteration` 是作者在编辑器里做的动作，走治理后台等于让管理员
 * 替作者提交——出口只收 `GOVERNANCE_ACTIONS`，作者动作 400。
 *
 * ## 授权先于读体
 *
 * 与账号 / 组织出口一致（`#004-09`）：民警递畸形 JSON 必须拿 403，而不是 400。
 *
 * ## 站内信失败不回滚，也不谎报失败
 *
 * `transitionAsset()` 在流转提交后写通知，通知失败抛 `AssetNotificationError`——此时
 * 状态与文件**已经变了**。出口回 200 ＋ `notice`（而不是 500）：回 500 会让前端以为没生效、
 * 用户再点一次就撞 `concurrent_transition`（409），比「成功但通知没写进去」更难解释。
 */

import { assetById, listAssets, type AssetListFilters } from "@opencode-ai/asset-service/asset"
import { AssetTransitionError, type SkillAction } from "@opencode-ai/asset-service/lifecycle"
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  type AssetStatus,
  type AssetType,
} from "@opencode-ai/asset-service/metadata"
import { AssetNotificationError } from "@opencode-ai/asset-service/notify"
import { authorizeTransition } from "@opencode-ai/asset-service/review"
import { transitionAsset } from "@opencode-ai/asset-service/service"
import { assetsRoot, MissingSourceDirectoryError } from "@opencode-ai/asset-service/storage"
import { governanceGrants } from "@opencode-ai/auth/governance"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { GrantRow } from "@opencode-ai/auth/rbac"
import { User } from "@opencode-ai/core/user"
import { sql } from "drizzle-orm"
import { Effect, Option, Result } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenhiveAudit } from "./audit"
import { GovernanceAuthz } from "./governance-authz"
import { OpenhivePg } from "./pg"

/** 板块 id（与 `@opencode-ai/auth/governance` 的闭集、前端 `sections.ts` 逐字相同）。 */
const BOARD = "asset-governance"

const PREFIX = "/openhive/governance/assets"

/**
 * 客户端契约。前端 `packages/app/src/governance/asset-api.ts` **另写一份字面量**，
 * 两边刻意不共享（前端不 import 内核源码；测试也不 import 本常量——`#003-05`）。
 */
export const PATH = {
  list: PREFIX,
  transition: `${PREFIX}/:id/transition`,
} as const

/**
 * 治理后台能执行的动作：业务审核两道关 ＋ 技术发布 ＋ 上下架 ＋ 归档。
 * `submit_review` / `start_iteration` 归作者，**不在**这里（见文件头）。
 */
export const GOVERNANCE_ACTIONS = [
  "approve_business",
  "reject_business",
  "publish_tech",
  "publish_iteration",
  "take_offline",
  "bring_online",
  "archive",
] as const satisfies readonly SkillAction[]

type GovernanceAction = (typeof GOVERNANCE_ACTIONS)[number]

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403
const NOT_FOUND = 404
const CONFLICT = 409

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const deps: Deps = { pg: openhivePg.pg }

    yield* router.add("GET", PATH.list, (request) => handleList(request, deps))
    yield* router.add("POST", PATH.transition, (request) => handleTransition(request, deps))
  }),
)

function ok(value: unknown, status = 200) {
  return HttpServerResponse.jsonUnsafe(value, { status })
}

function fail(status: number, message: string, field?: string) {
  return field === undefined
    ? HttpServerResponse.jsonUnsafe({ error: message }, { status })
    : HttpServerResponse.jsonUnsafe({ error: message, field }, { status })
}

function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

function forbidden(message = "没有资产治理权限") {
  return fail(FORBIDDEN, message)
}

/** 请求期取身份（`Option.none` = 无凭证）。 */
const 身份 = Effect.serviceOption(User.Service)

/** 本板块的记账方法（`board` 焊在闭包里）。 */
const 记账 = OpenhiveAudit.板块(BOARD)

/** 本模块的审计基底（板块已由 `板块()` 焊住）。 */
type 审计基底 = Pick<OpenhiveAudit.板块审计输入, "action" | "targetType" | "targetId">

/** 每请求查一次治理授权（不缓存进会话：改授权应立即生效）；拒绝当场留痕（`governance-authz.ts`）。 */
function 有权(deps: Deps, userId: string, perm: "read" | "write" | "review" | "admin") {
  return GovernanceAuthz.进(deps, userId, BOARD, perm)
}

/** 记一笔失败结局 ＋ 回同一个错误响应（与账号 / 组织出口同形）。 */
function 失败(
  deps: Deps,
  userId: string,
  base: 审计基底,
  status: number,
  message: string,
  field?: string,
  extra?: Record<string, unknown>,
) {
  return 记账.记失败(deps, userId, base, { status, message, ...(field === undefined ? {} : { field }) }, extra).pipe(
    Effect.as(fail(status, message, field)),
  )
}

function 是状态(value: string): value is AssetStatus {
  return (ASSET_STATUSES as readonly string[]).includes(value)
}

function 是类型(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value)
}

function handleList(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    if (!(yield* 有权(deps, user.value.id, "read"))) return forbidden()

    const params = new URL(request.url, "http://localhost").searchParams
    const status = params.get("status") ?? ""
    const type = params.get("type") ?? ""
    const search = (params.get("q") ?? "").trim()

    // 闭集在出口收窄：库里的 CHECK 只保证「列里都是合法值」，不保证「客户端传的这个词合法」。
    if (status !== "" && !是状态(status)) return fail(BAD_REQUEST, `未知资产状态：${status}`)
    if (type !== "" && !是类型(type)) return fail(BAD_REQUEST, `未知资产类型：${type}`)

    const filters: AssetListFilters = {
      ...(status === "" ? {} : { status }),
      ...(type === "" ? {} : { type }),
      ...(search === "" ? {} : { search }),
    }
    const assets = yield* Effect.promise(() => listAssets(deps.pg(), filters))
    return ok({ assets })
  })
}

function handleTransition(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    // 授权排在读取请求体之前（`#004-09`）。
    if (!(yield* 有权(deps, userId, "read"))) return forbidden()

    // 解析出 `transition` 之前的失败，`targetId` 还是 null（还不知道对象是谁）。
    const 未知对象 = { action: "asset.transition", targetType: "asset", targetId: null } as const
    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, 未知对象, BAD_REQUEST, "请求体不是 JSON 对象")

    const action = body["action"]
    if (typeof action !== "string" || action === "") {
      return yield* 失败(deps, userId, 未知对象, BAD_REQUEST, "缺少 action")
    }
    const 动 = 治理动作(action)
    if (!动) {
      if (作者动作(action)) {
        return yield* 失败(deps, userId, 未知对象, BAD_REQUEST, `${action} 是作者动作，不在治理后台执行`)
      }
      return yield* 失败(deps, userId, 未知对象, BAD_REQUEST, `未知生命周期动作：${action}`)
    }

    const reason = body["reason"]
    if (reason !== undefined && typeof reason !== "string") {
      return yield* 失败(deps, userId, 未知对象, BAD_REQUEST, "reason 必须是字符串", undefined, { transition: 动 })
    }

    // 可见范围闭集在出口收窄：客户端传的词是否合法不归库的 CHECK 管（与 list 的 status 同理）。
    const visibility = body["visibility"]
    if (visibility !== undefined) {
      if (visibility === "personal") {
        return yield* 失败(deps, userId, 未知对象, BAD_REQUEST, "发布范围必须是部门或全局", "visibility")
      }
      if (visibility !== "department" && visibility !== "global") {
        return yield* 失败(deps, userId, 未知对象, BAD_REQUEST, `未知可见范围：${JSON.stringify(visibility)}`, "visibility")
      }
    }
    const 范围 = visibility === "department" || visibility === "global" ? visibility : undefined

    const params = yield* HttpRouter.params
    const assetId = params.id ?? ""
    const base = { action: "asset.transition", targetType: "asset", targetId: assetId } as const
    // 资产流转的审计要能回答「哪个生命周期动作」——只在 `action` 列写 `asset.transition` 不够。
    const 补充 = { transition: 动 } as const
    const asset = yield* Effect.promise(() => assetById(deps.pg(), assetId))
    if (!asset) return yield* 失败(deps, userId, base, NOT_FOUND, `资产不存在：${assetId}`, undefined, 补充)

    const department = yield* 取部门(deps, userId)
    const grants = yield* 合成授权行(deps, userId, asset.type, asset.id)
    const viewer = { userId, department }

    // 授权先于「类型 / 状态」判定（`#004-09` 在资产层的落点）：`transitionAsset()` 先查类型、
    // 再查授权，于是只有 read 的人对一份 MCP 资产会拿到 400 而不是 403——那 200 毫秒的差别
    // 就是「资产是什么类型」的探针。这里用**同一个** `authorizeTransition()` 先过一遍门；
    // 服务层随后会再算一次（确定性函数、无副作用），不是两份规则。
    const 预检 = yield* Effect.result(
      Effect.try({
        try: () => authorizeTransition(viewer, asset, grants, 动),
        catch: (error) => error,
      }),
    )
    if (Result.isFailure(预检)) return yield* 翻译(预检.failure, deps, userId, base, 补充)

    const result = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          transitionAsset({
            db: deps.pg(),
            root: assetsRoot(process.env),
            assetId,
            action: 动,
            viewer,
            grants,
            ...(reason === undefined ? {} : { reason }),
            ...(范围 === undefined ? {} : { visibility: 范围 }),
          }),
        catch: (error) => error,
      }),
    )
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, {
        ...base,
        result: "ok",
        detail: {
          transition: 动,
          ...(reason === undefined ? {} : { reason }),
          ...(范围 === undefined ? {} : { visibility: 范围 }),
        },
      })
      return ok({ asset: result.success })
    }

    const error = result.failure
    if (error instanceof AssetNotificationError) {
      // 流转已生效、通知没写进去：回 200 ＋ notice，不回 500（文件头最后一段）。
      // 审计同样记 `ok`——状态确实变了，`notice` 说明附带损伤。
      const updated = yield* Effect.promise(() => assetById(deps.pg(), assetId))
      yield* 记账.记(deps, userId, {
        ...base,
        result: "ok",
        detail: { transition: 动, notice: error.message },
      })
      return ok({ asset: updated, notice: error.message })
    }
    return yield* 翻译(error, deps, userId, base, 补充)
  })
}

/** `GOVERNANCE_ACTIONS` 收窄；不在白名单回 `undefined`（调用方分「作者动作」与「未知动作」）。 */
function 治理动作(value: string): GovernanceAction | undefined {
  return GOVERNANCE_ACTIONS.find((action) => action === value)
}

/** 作者在编辑器里做的动作（出口只用来把它们与拼错的动作区分开，不执行）。 */
const AUTHOR_ACTIONS: ReadonlySet<string> = new Set(["submit_review", "start_iteration"])

function 作者动作(value: string): boolean {
  return AUTHOR_ACTIONS.has(value)
}

/**
 * 治理板块的权限行 → **当前这一份资产**的授权行。
 *
 * 只投影 `review` / `admin`（`read` 是进门那道门，不是动作权）；`write` 刻意不投影：
 * 后台没有「以作者身份改内容」的动作。同一份资产上重复的 perm 无害（`Set` 去重），
 * 保留原始顺序只为让下游的 `find()` 结果确定。
 */
function 合成授权行(deps: Deps, userId: string, resourceType: string, resourceId: string) {
  return Effect.promise(async (): Promise<GrantRow[]> => {
    const rows = await governanceGrants(deps.pg(), userId)
    return rows
      .filter((row) => row.board === BOARD && (row.perm === "review" || row.perm === "admin"))
      .map((row) => ({ resourceType, resourceId, perm: row.perm }))
  })
}

/** 资产授权的 `AssetViewer` 需要部门（个人 / 部门空间读判据）；治理动作不靠它，但别传假值。 */
function 取部门(deps: Deps, userId: string) {
  return Effect.promise(async (): Promise<string> => {
    const rows = rowsOf(await deps.pg().execute(sql`select dept from auth.user where id = ${userId}`))
    const 部门 = rows[0]?.["dept"]
    return typeof 部门 === "string" ? 部门 : ""
  })
}

/** `request.json` 失败（畸形 JSON / 空体）⇒ `undefined`（客户端的事，不是服务端故障）。 */
function 读取体(request: HttpServerRequest.HttpServerRequest) {
  return request.json.pipe(
    Effect.match({
      onFailure: () => undefined,
      onSuccess: (value: unknown) => value,
    }),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * 把领域错误翻成状态码 ＋ 给人看的一句话；认不出的继续炸（500），不吞。
 *
 * 409 覆盖五种「状态 / 配置 / 文件不允许」：`invalid_source`（当前状态不能做这个动作）、
 * `concurrent_transition`（别人先改了）、源目录缺失（文件与库不一致，需要人看一眼）、
 * `personal_asset_not_shared`（个人资产没有共享发布目录，先把可见范围改成部门 / 全局），
 * 以及 `department_missing`（选了本部门，但资产的部门为空 / 空白 / 不能作为目录名，只能发布为全局或先修正部门）。
 */
export function 映射错误(
  error: unknown,
): { readonly status: number; readonly message: string; readonly field?: string } | undefined {
  if (error instanceof AssetTransitionError) {
    switch (error.code) {
      case "asset_not_found":
        return { status: NOT_FOUND, message: error.message }
      case "actor_not_allowed":
        return { status: FORBIDDEN, message: error.message }
      case "reason_required":
        return { status: BAD_REQUEST, message: error.message, field: "reason" }
      case "unknown_action":
      case "unsupported_asset_type":
      case "visibility_not_applicable":
        return { status: BAD_REQUEST, message: error.message }
      case "invalid_source":
      case "concurrent_transition":
      case "source_directory_required":
      case "personal_asset_not_shared":
      case "department_missing":
        return { status: CONFLICT, message: error.message }
    }
  }
  if (error instanceof MissingSourceDirectoryError) return { status: CONFLICT, message: error.message }
  return undefined
}

/** 领域错误 → 状态码；承认得出的 4xx 都留一行 failed/denied（403 记 denied），认不出的继续炸（500）。 */
function 翻译(
  error: unknown,
  deps: Deps,
  userId: string,
  base: 审计基底,
  extra?: Record<string, unknown>,
) {
  const mapped = 映射错误(error)
  if (mapped) return 失败(deps, userId, base, mapped.status, mapped.message, mapped.field, extra)
  return Effect.die(error)
}
