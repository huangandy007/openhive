export * as OpenhiveGovernanceDataSource from "./governance-data-source"

/**
 * 010 T012 · **数据源配置**的 HTTP 出口（FR-011 / US6）：列表 / 注册 / 编辑 / 血缘。
 *
 * 与 `governance-templates.ts` 同一套分层：本文件只做身份、授权、载荷收窄、错误翻译；
 * 表规则（修剪、撞名、成环、整体替换）全在 `@opencode-ai/auth/data-source`，
 * 这里一条都不重写（`#002-06`）。
 *
 * ## 板块是 `data-source`，只授系统管理员
 *
 * 010 T002 的矩阵里 `data-source` 是 `gov-system-admin` 的 read + write；业务专家那一行
 * 是空的（数据源是运维 / 技术的事，不是业务口径）。所以业务专家会真的撞 403，
 * 测试里专门钉了这一格。
 *
 * ## 授权排在读取请求体之前
 *
 * 无权者递畸形载荷必须拿 403，而不是 400 —— 否则 400/403 的差别就是一枚字段探针
 * （`#004-09`，同 T006–T011 的口径）。
 *
 * ## 审计不记连接地址
 *
 * `detail` 只记 `{ name, kind }` / `{ name, fields }`。连接地址虽非秘密，但审计表是**只增**
 * 的、检索面很宽，少记一份就少一份外泄面（且改地址时 detail 会与当前行不一致）。
 *
 * ## 血缘是只读出口，写入走编辑
 *
 * `GET /:id` 回「本行 ＋ 直接上游 ＋ 直接下游」；登记 / 清空上游都走 `POST /:id`
 * 的 `upstreamIds`（`undefined` = 不动，`[]` = 清空）。DESIGN 只要求一级缩进列表，
 * 所以这里**不递归展开**。
 */

import {
  createDataSource,
  DataSourceCycleError,
  DataSourceFieldTooLongError,
  DataSourceNameRequiredError,
  DataSourceNameTakenError,
  DataSourceNotFoundError,
  DataSourceSelfLineageError,
  DataSourceUpstreamNotFoundError,
  DATA_SOURCE_FREQUENCIES,
  DATA_SOURCE_KINDS,
  DATA_SOURCE_STATUSES,
  getDataSourceLineage,
  listDataSources,
  updateDataSource,
  type DataSourceFrequency,
  type DataSourceKind,
  type DataSourceStatus,
} from "@opencode-ai/auth/data-source"
import { User } from "@opencode-ai/core/user"
import { Effect, Option, Result } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenhiveAudit } from "./audit"
import { GovernanceAuthz } from "./governance-authz"
import { OpenhivePg } from "./pg"

/** 板块 id（与 `@opencode-ai/auth/governance` 的闭集、前端 `sections.ts` 逐字相同）。 */
const BOARD = "data-source"

const PREFIX = "/openhive/governance/data-sources"

/**
 * 客户端契约。前端 `packages/app/src/governance/data-source-api.ts` **另写一份字面量**，
 * 两边刻意不共享（前端不 import 内核源码；测试也不 import 本常量——`#003-05`）。
 */
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  one: `${PREFIX}/:id`,
} as const

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403
const NOT_FOUND = 404
const CONFLICT = 409
const CREATED = 201

/** 前端把这几个值标在输入框上；`upstreamIds` 不是输入框，但同一套协议能定位到上游选择区。 */
type Field = "name" | "kind" | "frequency" | "status" | "endpoint" | "owner" | "upstreamIds"

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const deps: Deps = { pg: openhivePg.pg }

    yield* router.add("GET", PATH.list, (request) => handleList(request, deps))
    yield* router.add("POST", PATH.create, (request) => handleCreate(request, deps))
    yield* router.add("GET", PATH.one, (request) => handleLineage(request, deps))
    yield* router.add("POST", PATH.one, (request) => handleEdit(request, deps))
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
  return fail(FORBIDDEN, "没有数据源配置权限")
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

    const sources = yield* Effect.promise(() => listDataSources(deps.pg()))
    return ok({ sources })
  })
}

function handleLineage(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    if (!(yield* 有权(deps, user.value.id, "read"))) return forbidden()

    const params = yield* HttpRouter.params
    const id = params.id ?? ""
    const result = yield* 执行(() => getDataSourceLineage(deps.pg(), id))
    if (Result.isSuccess(result)) return ok(result.success)
    // 读出口**不留痕**（同 T010「审计不审计自己」的口径）：404 直接回，不记 failed。
    const mapped = 映射错误(result.failure)
    return mapped ? fail(mapped.status, mapped.message, mapped.field) : yield* Effect.die(result.failure)
  })
}

function handleCreate(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id

    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const base = { action: "data-source.create", targetType: "data_source" } as const
    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")

    const name = body["name"]
    if (typeof name !== "string") return yield* 失败(deps, userId, base, BAD_REQUEST, "name 必须是字符串", "name")
    const kind = body["kind"]
    if (typeof kind !== "string" || !是类型(kind))
      return yield* 失败(
        deps,
        userId,
        base,
        BAD_REQUEST,
        "kind 只能是 database / file / api",
        "kind",
      )
    const frequency = body["frequency"]
    if (typeof frequency !== "string" || !是频率(frequency))
      return yield* 失败(
        deps,
        userId,
        base,
        BAD_REQUEST,
        "frequency 只能是 manual / hourly / daily / weekly",
        "frequency",
      )
    const status = body["status"]
    if (status !== undefined && (typeof status !== "string" || !是状态(status)))
      return yield* 失败(deps, userId, base, BAD_REQUEST, "status 只能是 active / disabled", "status")

    const 可选 = 可选文本(body, ["endpoint", "owner"])
    if (!可选.ok) return yield* 失败(deps, userId, base, BAD_REQUEST, 可选.message, 可选.field)
    const 上游 = 上游列表(body)
    if (!上游.ok) return yield* 失败(deps, userId, base, BAD_REQUEST, 上游.message, "upstreamIds")

    const result = yield* 执行(() =>
      createDataSource(deps.pg(), {
        name,
        kind,
        frequency,
        endpoint: 可选.value["endpoint"] ?? "",
        owner: 可选.value["owner"] ?? "",
        ...(status === undefined ? {} : { status }),
        ...(上游.value === undefined ? {} : { upstreamIds: 上游.value }),
        actorId: userId,
      }),
    )
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, {
        ...base,
        targetId: result.success.id,
        result: "ok",
        detail: { name: result.success.name, kind: result.success.kind },
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
    const base = { action: "data-source.update", targetType: "data_source", targetId: id } as const

    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")

    const patch = 编辑入参(body)
    if (!patch.ok) return yield* 失败(deps, userId, base, BAD_REQUEST, patch.message, patch.field)
    const result = yield* 执行(() => updateDataSource(deps.pg(), id, { ...patch.value, actorId: userId }))
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, {
        ...base,
        result: "ok",
        detail: { name: result.success.name, fields: patch.fields },
      })
      return ok(result.success)
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
  if (error instanceof DataSourceNameRequiredError)
    return { status: BAD_REQUEST, message: error.message, field: "name" }
  if (error instanceof DataSourceFieldTooLongError)
    return { status: BAD_REQUEST, message: error.message, field: error.field }
  if (error instanceof DataSourceNameTakenError) return { status: CONFLICT, message: error.message }
  if (error instanceof DataSourceNotFoundError) return { status: NOT_FOUND, message: error.message }
  if (error instanceof DataSourceUpstreamNotFoundError)
    return { status: BAD_REQUEST, message: error.message, field: "upstreamIds" }
  if (error instanceof DataSourceSelfLineageError)
    return { status: BAD_REQUEST, message: error.message, field: "upstreamIds" }
  if (error instanceof DataSourceCycleError)
    return { status: BAD_REQUEST, message: error.message, field: "upstreamIds" }
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

function 是类型(value: string): value is DataSourceKind {
  return (DATA_SOURCE_KINDS as readonly string[]).includes(value)
}

function 是频率(value: string): value is DataSourceFrequency {
  return (DATA_SOURCE_FREQUENCIES as readonly string[]).includes(value)
}

function 是状态(value: string): value is DataSourceStatus {
  return (DATA_SOURCE_STATUSES as readonly string[]).includes(value)
}

type 收窄<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string; readonly field: Field }

/** 可选文本字段：给了就必须是字符串（空串合法——那是「没填」，不是「非法」）。 */
function 可选文本(
  body: Record<string, unknown>,
  keys: readonly ("endpoint" | "owner")[],
): 收窄<Partial<Record<"endpoint" | "owner", string>>> {
  const out: Partial<Record<"endpoint" | "owner", string>> = {}
  for (const key of keys) {
    const value = body[key]
    if (value === undefined) continue
    if (typeof value !== "string") return { ok: false, message: `${key} 必须是字符串`, field: key }
    out[key] = value
  }
  return { ok: true, value: out }
}

/** `upstreamIds`：未给 ⇒ `undefined`（不改血缘）；给了必须是字符串数组（`[]` = 清空）。 */
function 上游列表(body: Record<string, unknown>): 收窄<readonly string[] | undefined> {
  const value = body["upstreamIds"]
  if (value === undefined) return { ok: true, value: undefined }
  if (!Array.isArray(value)) return { ok: false, message: "upstreamIds 必须是字符串数组", field: "upstreamIds" }
  if (!value.every((item) => typeof item === "string"))
    return { ok: false, message: "upstreamIds 必须是字符串数组", field: "upstreamIds" }
  return { ok: true, value }
}

/**
 * body → 待改字段。
 *
 * 一个字段都没给 ⇒ 回一句话让调用方回 400：空补丁会把 `updated_at` 无意义地往前推，
 * 还会在审计里留一行什么都没改的 `data-source.update`。
 */
type 编辑结果 =
  | {
      readonly ok: true
      readonly value: {
        name?: string
        kind?: DataSourceKind
        frequency?: DataSourceFrequency
        endpoint?: string
        owner?: string
        status?: DataSourceStatus
        upstreamIds?: readonly string[]
      }
      readonly fields: readonly string[]
    }
  | { readonly ok: false; readonly message: string; readonly field?: Field }

function 编辑入参(body: Record<string, unknown>): 编辑结果 {
  const out: {
    name?: string
    kind?: DataSourceKind
    frequency?: DataSourceFrequency
    endpoint?: string
    owner?: string
    status?: DataSourceStatus
    upstreamIds?: readonly string[]
  } = {}
  const fields: string[] = []

  for (const key of ["name", "endpoint", "owner"] as const) {
    const value = body[key]
    if (value === undefined) continue
    if (typeof value !== "string") return { ok: false, message: `${key} 必须是字符串`, field: key }
    out[key] = value
    fields.push(key)
  }

  const kind = body["kind"]
  if (kind !== undefined) {
    if (typeof kind !== "string" || !是类型(kind))
      return { ok: false, message: "kind 只能是 database / file / api", field: "kind" }
    out.kind = kind
    fields.push("kind")
  }

  const frequency = body["frequency"]
  if (frequency !== undefined) {
    if (typeof frequency !== "string" || !是频率(frequency))
      return { ok: false, message: "frequency 只能是 manual / hourly / daily / weekly", field: "frequency" }
    out.frequency = frequency
    fields.push("frequency")
  }

  const status = body["status"]
  if (status !== undefined) {
    if (typeof status !== "string" || !是状态(status))
      return { ok: false, message: "status 只能是 active / disabled", field: "status" }
    out.status = status
    fields.push("status")
  }

  const 上游 = 上游列表(body)
  if (!上游.ok) return { ok: false, message: 上游.message, field: "upstreamIds" }
  if (上游.value !== undefined) {
    out.upstreamIds = 上游.value
    fields.push("upstreamIds")
  }

  if (fields.length === 0) return { ok: false, message: "没有要改的字段" }
  return { ok: true, value: out, fields }
}
