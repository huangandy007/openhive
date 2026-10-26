export * as OpenhiveGovernanceTemplates from "./governance-templates"

/**
 * 010 T011 · **模板库**的 HTTP 出口（FR-010 / US4）：列表 / 新建 / 编辑 / 停用。
 *
 * 与 `governance-org.ts` 同一套分层：本文件只做身份、授权、载荷收窄、错误翻译；
 * 表规则（名字修剪、判重、停用幂等、只动 active 行）全在 `@opencode-ai/auth/template`，
 * 这里一条都不重写（`#002-06`）。
 *
 * ## 板块是 `template-lib`，而且它**不在系统管理员手里**
 *
 * 010 T002 的矩阵里 `template-lib` 只授给 `gov-business-expert`（read + write）；
 * `gov-system-admin` 那份模板**没有**这一行。这不是漏配——模板是业务口径，改它的人
 * 得懂业务。所以本模块的 403 分支会真的被系统管理员撞上，测试里也专门钉了这一格。
 *
 * ## 授权排在读取请求体之前
 *
 * 无权者递畸形载荷必须拿 403，而不是 400 —— 否则 400/403 的差别就是一枚字段探针
 * （`#004-09`，同 T006 / T007 / T008 的口径）。
 *
 * ## 停用走 POST 子路径，不走 DELETE
 *
 * 「停用」不是删除：行留在库里、`status='disabled'`、同名可以重新建（唯一索引只压 active 行）。
 * 用 DELETE 语义会让人以为能「删掉再建同名」，而真删掉就查不到「这条模板曾经生效过」。
 */

import {
  createTemplate,
  disableTemplate,
  listTemplates,
  TemplateFieldTooLongError,
  TemplateNameRequiredError,
  TemplateNameTakenError,
  TemplateNotFoundError,
  TEMPLATE_KINDS,
  updateTemplate,
  type TemplateKind,
} from "@opencode-ai/auth/template"
import { User } from "@opencode-ai/core/user"
import { Effect, Option, Result } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenhiveAudit } from "./audit"
import { GovernanceAuthz } from "./governance-authz"
import { OpenhivePg } from "./pg"

/** 板块 id（与 `@opencode-ai/auth/governance` 的闭集、前端 `sections.ts` 逐字相同）。 */
const BOARD = "template-lib"

const PREFIX = "/openhive/governance/templates"

/**
 * 客户端契约。前端 `packages/app/src/governance/template-api.ts` **另写一份字面量**，
 * 两边刻意不共享（前端不 import 内核源码；测试也不 import 本常量——`#003-05`）。
 */
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  edit: `${PREFIX}/:id`,
  disable: `${PREFIX}/:id/disable`,
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
    yield* router.add("POST", PATH.disable, (request) => handleDisable(request, deps))
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
  return fail(FORBIDDEN, "没有模板库管理权限")
}

/** 请求期取身份（`Option.none` = 无凭证）。 */
const 身份 = Effect.serviceOption(User.Service)

/** 本板块的记账方法（`board` 焊在闭包里）。 */
const 记账 = OpenhiveAudit.板块(BOARD)

/** 每请求查一次治理授权；拒绝当场留痕（`governance-authz.ts`）。 */
function 有权(deps: Deps, userId: string, perm: "read" | "write") {
  return GovernanceAuthz.进(deps, userId, BOARD, perm)
}

function handleList(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    if (!(yield* 有权(deps, user.value.id, "read"))) return forbidden()

    // 查询串不是请求体：`read` 出口不写审计，故这里 400 也不必记账（同 T010 的口径）。
    const kind = 查类型(request)
    if (kind === "invalid") return fail(BAD_REQUEST, "kind 只能是 report / graph / metric", "kind")

    const templates = yield* Effect.promise(() => listTemplates(deps.pg(), kind === null ? {} : { kind }))
    return ok({ templates })
  })
}

function handleCreate(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const base = { action: "template.create", targetType: "template" } as const
    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")

    const kind = body["kind"]
    if (typeof kind !== "string" || !是模板类型(kind))
      return yield* 失败(deps, userId, base, BAD_REQUEST, "kind 只能是 report / graph / metric", "kind")
    const name = body["name"]
    if (typeof name !== "string") return yield* 失败(deps, userId, base, BAD_REQUEST, "name 必须是字符串", "name")
    const scope = body["scope"]
    if (scope !== undefined && typeof scope !== "string")
      return yield* 失败(deps, userId, base, BAD_REQUEST, "scope 必须是字符串", "scope")
    const content = body["content"]
    if (content !== undefined && typeof content !== "string")
      return yield* 失败(deps, userId, base, BAD_REQUEST, "content 必须是字符串", "content")

    const result = yield* 执行(() =>
      createTemplate(deps.pg(), { kind, name, scope: scope ?? "", content: content ?? "", actorId: userId }),
    )
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, {
        ...base,
        targetId: result.success.id,
        result: "ok",
        detail: { kind: result.success.kind, name: result.success.name },
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
    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const params = yield* HttpRouter.params
    const id = params.id ?? ""
    const base = { action: "template.update", targetType: "template", targetId: id } as const

    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")

    const patch = 编辑入参(body)
    if (!patch.ok) return yield* 失败(deps, userId, base, BAD_REQUEST, patch.message, patch.field)
    const result = yield* 执行(() => updateTemplate(deps.pg(), id, { ...patch.value, actorId: userId }))
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, {
        ...base,
        result: "ok",
        detail: { name: result.success.name, fields: Object.keys(patch) },
      })
      return ok(result.success)
    }
    return yield* 翻译(result.failure, deps, userId, base)
  })
}

function handleDisable(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const params = yield* HttpRouter.params
    const id = params.id ?? ""
    const base = { action: "template.disable", targetType: "template", targetId: id } as const

    const result = yield* 执行(() => disableTemplate(deps.pg(), id, { actorId: userId }))
    if (Result.isSuccess(result)) {
      // `changed` 照实记：第二次点「停用」是幂等的 no-op，审计里要能看出这一点。
      yield* 记账.记(deps, userId, {
        ...base,
        result: "ok",
        detail: { name: result.success.row.name, changed: result.success.changed },
      })
      return ok(result.success.row)
    }
    return yield* 翻译(result.failure, deps, userId, base)
  })
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
  if (error instanceof TemplateNameRequiredError) return { status: BAD_REQUEST, message: error.message, field: "name" }
  if (error instanceof TemplateFieldTooLongError)
    return { status: BAD_REQUEST, message: error.message, field: error.field }
  if (error instanceof TemplateNameTakenError) return { status: CONFLICT, message: error.message }
  if (error instanceof TemplateNotFoundError) return { status: NOT_FOUND, message: error.message }
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

function 是模板类型(value: string): value is TemplateKind {
  return (TEMPLATE_KINDS as readonly string[]).includes(value)
}

/** `?kind=` ⇒ 未给时 `null`；非法时 `"invalid"`（由调用方回 400）。 */
function 查类型(request: HttpServerRequest.HttpServerRequest): TemplateKind | null | "invalid" {
  const raw = new URL(request.url, "http://localhost").searchParams.get("kind")
  if (raw === null || raw === "") return null
  return 是模板类型(raw) ? raw : "invalid"
}

/**
 * body → 待改字段。
 *
 * 一个字段都没给 ⇒ 回一句话让调用方回 400：空补丁会把 `updated_at` 无意义地往前推，
 * 还会在审计里留一行什么都没改的 `template.update`。
 */
type 编辑结果 =
  | { readonly ok: true; readonly value: { name?: string; scope?: string; content?: string } }
  | { readonly ok: false; readonly message: string; readonly field?: string }

function 编辑入参(body: Record<string, unknown>): 编辑结果 {
  const out: { name?: string; scope?: string; content?: string } = {}
  for (const key of ["name", "scope", "content"] as const) {
    const value = body[key]
    if (value === undefined) continue
    if (typeof value !== "string") return { ok: false, message: `${key} 必须是字符串`, field: key }
    out[key] = value
  }
  if (Object.keys(out).length === 0) return { ok: false, message: "没有要改的字段" }
  return { ok: true, value: out }
}
