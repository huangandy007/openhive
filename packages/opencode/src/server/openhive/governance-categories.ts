export * as OpenhiveGovernanceCategories from "./governance-categories"

/**
 * 需求 4 · **管理面**的业务分类出口：列表 / 新建 / 编辑（改名、排序、启停）。
 *
 * 与 `governance-templates.ts` 同一套分层：本文件只做身份、授权、载荷收窄、错误翻译；
 * 表规则（名字修剪、判重、幂等、只改给了的字段）全在
 * `@opencode-ai/asset-service/category-store`，这里一条都不重写（`#002-06`）。
 *
 * ## 板块是 `asset-governance`
 *
 * 分类是资产域的口径，跟着资产治理走：读要 `read`，写要 `admin`（010 T002 的矩阵里
 * 该板块只有这两个动作）。**不新造板块**——`GOVERNANCE_BOARDS` 与前端 `sections.ts`
 * 是逐字对账的两份清单，加一个词要三处一起动。
 *
 * ## 停用走 POST 子路径，不走 DELETE
 *
 * 本模块**没有**删除：资产行的 `category` 存 id，删掉分类行会让那批资产指向一个查不到的
 * 名字。要「别再让人选」就 `enabled=false`——行还在，左栏不再列出，管理面还能启回来。
 *
 * ## 授权排在读取请求体之前
 *
 * 无权者递畸形载荷必须拿 403 而不是 400，否则 400/403 的差别就是一枚字段探针
 * （`#004-09`，与 T006 / T007 / T008 同一口径）。
 */

import {
  CategoryNameRequiredError,
  CategoryNameTakenError,
  CategoryNotFoundError,
  createCategory,
  listCategories,
  updateCategory,
} from "@opencode-ai/asset-service/category-store"
import { User } from "@opencode-ai/core/user"
import { Effect, Option, Result } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenhiveAudit } from "./audit"
import { GovernanceAuthz } from "./governance-authz"
import { OpenhivePg } from "./pg"

/** 板块 id（与 `@opencode-ai/auth/governance` 的闭集、前端 `sections.ts` 逐字相同）。 */
const BOARD = "asset-governance"

const PREFIX = "/openhive/governance/categories"

/**
 * 客户端契约。前端 `packages/app/src/governance/category-api.ts` **另写一份字面量**，
 * 两边刻意不共享（前端不 import 内核源码；测试也不 import 本常量——`#003-05`）。
 */
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  edit: `${PREFIX}/:id`,
} as const

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403
const NOT_FOUND = 404
const CONFLICT = 409
const CREATED = 201

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const deps: Deps = { pg: openhivePg.pg }

    yield* router.add("GET", PATH.list, (request) => handleList(request, deps))
    yield* router.add("POST", PATH.create, (request) => handleCreate(request, deps))
    yield* router.add("POST", PATH.edit, (request) => handleEdit(request, deps))
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

function forbidden() {
  return fail(FORBIDDEN, "没有资产治理权限")
}

/** 请求期取身份（`Option.none` = 无凭证）。 */
const 身份 = Effect.serviceOption(User.Service)

/** 本板块的记账方法（`board` 焊在闭包里）。 */
const 记账 = OpenhiveAudit.板块(BOARD)

/** 每请求查一次治理授权；拒绝当场留痕（`governance-authz.ts`）。 */
function 有权(deps: Deps, userId: string, perm: "read" | "admin") {
  return GovernanceAuthz.进(deps, userId, BOARD, perm)
}

function handleList(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    if (!(yield* 有权(deps, user.value.id, "read"))) return forbidden()

    // 管理面**看得见停用项**：否则停用过的分类在后台消失，再也启不回来。
    const categories = yield* Effect.promise(() => listCategories(deps.pg(), { includeDisabled: true }))
    return ok({ categories })
  })
}

function handleCreate(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "admin"))) return forbidden()

    const base = { action: "category.create", targetType: "category" } as const
    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")

    const name = body["name"]
    if (typeof name !== "string") return yield* 失败(deps, userId, base, BAD_REQUEST, "name 必须是字符串", "name")
    const sortOrder = body["sortOrder"]
    if (sortOrder !== undefined && (typeof sortOrder !== "number" || !Number.isInteger(sortOrder))) {
      return yield* 失败(deps, userId, base, BAD_REQUEST, "sortOrder 必须是整数", "sortOrder")
    }

    const result = yield* 执行(() =>
      createCategory(deps.pg(), sortOrder === undefined ? { name } : { name, sortOrder }),
    )
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, {
        ...base,
        targetId: result.success.id,
        result: "ok",
        detail: { name: result.success.name, sortOrder: result.success.sortOrder },
      })
      return ok(result.success, CREATED)
    }
    return yield* 翻译(result.failure, deps, userId, base)
  })
}

function handleEdit(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "admin"))) return forbidden()

    const params = yield* HttpRouter.params
    const id = params.id ?? ""
    const base = { action: "category.update", targetType: "category", targetId: id } as const

    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")

    const patch = 编辑入参(body)
    if (!patch.ok) return yield* 失败(deps, userId, base, BAD_REQUEST, patch.message, patch.field)

    const result = yield* 执行(() => updateCategory(deps.pg(), id, patch.value))
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, {
        ...base,
        result: "ok",
        detail: { name: result.success.name, fields: Object.keys(patch.value) },
      })
      return ok(result.success)
    }
    return yield* 翻译(result.failure, deps, userId, base)
  })
}

type 编辑补丁 = { readonly name?: string; readonly sortOrder?: number; readonly enabled?: boolean }

/**
 * 编辑入参：只认这三种字段，且**至少要给一个**。
 *
 * 空补丁返回 400 而不是 200：否则「点保存但什么都没改」与「保存成功」在审计与前端提示上
 * 长成同一件事。
 */
function 编辑入参(
  body: Record<string, unknown>,
): { ok: true; value: 编辑补丁 } | { ok: false; message: string; field?: string } {
  const patch: { name?: string; sortOrder?: number; enabled?: boolean } = {}

  if (body["name"] !== undefined) {
    if (typeof body["name"] !== "string") return { ok: false, message: "name 必须是字符串", field: "name" }
    patch.name = body["name"]
  }
  if (body["sortOrder"] !== undefined) {
    const sortOrder = body["sortOrder"]
    if (typeof sortOrder !== "number" || !Number.isInteger(sortOrder)) {
      return { ok: false, message: "sortOrder 必须是整数", field: "sortOrder" }
    }
    patch.sortOrder = sortOrder
  }
  if (body["enabled"] !== undefined) {
    if (typeof body["enabled"] !== "boolean") {
      return { ok: false, message: "enabled 必须是布尔值", field: "enabled" }
    }
    patch.enabled = body["enabled"]
  }
  if (Object.keys(patch).length === 0) return { ok: false, message: "没有要改的字段" }
  return { ok: true, value: patch }
}

/** 本模块的审计基底（板块已由 `板块()` 焊住）。 */
type 审计基底 = Pick<OpenhiveAudit.板块审计输入, "action" | "targetType" | "targetId">

/** 记一笔失败结局 ＋ 回同一个错误响应（两处各写一遍就会说两套话）。 */
function 失败(deps: Deps, userId: string, base: 审计基底, status: number, message: string, field?: string) {
  return 记账
    .记失败(deps, userId, base, { status, message, ...(field === undefined ? {} : { field }) })
    .pipe(Effect.as(fail(status, message, field)))
}

/** 把领域错误翻成状态码 ＋ 给人看的一句话；认不出的继续炸（500），不吞。 */
export function 映射错误(
  error: unknown,
): { readonly status: number; readonly message: string; readonly field?: string } | undefined {
  if (error instanceof CategoryNameRequiredError) return { status: BAD_REQUEST, message: error.message, field: "name" }
  if (error instanceof CategoryNameTakenError) return { status: CONFLICT, message: error.message, field: "name" }
  if (error instanceof CategoryNotFoundError) return { status: NOT_FOUND, message: error.message }
  return undefined
}

/** 领域错误 → 状态码；认得出的 4xx 都留一行 failed，认不出的继续炸。 */
function 翻译(error: unknown, deps: Deps, userId: string, base: 审计基底) {
  const mapped = 映射错误(error)
  if (mapped) return 失败(deps, userId, base, mapped.status, mapped.message, mapped.field)
  return Effect.die(error)
}

function 执行<A>(work: () => Promise<A>) {
  return Effect.result(Effect.tryPromise({ try: work, catch: (error) => error }))
}

/** `request.json` 失败（畸形 JSON / 空体）⇒ `undefined`。 */
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
