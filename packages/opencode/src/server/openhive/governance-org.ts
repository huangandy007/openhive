export * as OpenhiveGovernanceOrg from "./governance-org"

/**
 * 010 T006 · **组织架构**的 HTTP 出口（FR-005 / US2）：树 / 建节点 / 改名 / 删除 / 从账号导入。
 *
 * 与 `governance-accounts.ts` 同一套分层：本文件只做身份、授权、载荷收窄、错误翻译；
 * 树的规则（三级、同级唯一、删除守卫、改名级联）全在 `@opencode-ai/auth/org-tree`，
 * 这里一条都不重写（`#002-06`：两份实现漂了不会报错）。
 *
 * ## 授权必须排在一切之前
 *
 * 现有写出口里出现过「先解析、再授权」的写法，结果是**非管理员能拿 400/403 的差别当字段探针**。
 * 这里五条出口统一：取身份 → 查授权 → 才碰请求体与库（`#004-09`）。
 *
 * ## 改名为什么返回 204 而不是新节点
 *
 * 改名会级联改 `auth.user`，前端无论如何都要重拉整棵树（账号数可能变、树里的名字也变了）。
 * 回一个「局部正确的节点」只会让前端有第二个真相可用。
 */

import {
  createNode,
  deleteNode,
  importFromAccounts,
  listNodes,
  OrgHasAccountsError,
  OrgLevelError,
  OrgNameRequiredError,
  OrgNameTakenError,
  OrgNodeNotFoundError,
  OrgNotEmptyError,
  renameNode,
  type NewNodeInput,
} from "@opencode-ai/auth/org-tree"
import { User } from "@opencode-ai/core/user"
import { Effect, Option, Result } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenhiveAudit } from "./audit"
import { GovernanceAuthz } from "./governance-authz"
import { OpenhivePg } from "./pg"

/** 板块 id（与 `@opencode-ai/auth/governance` 的闭集、前端 `sections.ts` 逐字相同）。 */
const BOARD = "org-tree"

const PREFIX = "/openhive/governance/org"

/**
 * 客户端契约。前端 `packages/app/src/governance/org-api.ts` **另写一份字面量**，
 * 两边刻意不共享（前端不 import 内核源码；测试也不 import 本常量——`#003-05`）。
 */
export const PATH = {
  tree: `${PREFIX}/tree`,
  nodes: `${PREFIX}/nodes`,
  node: `${PREFIX}/nodes/:id`,
  rename: `${PREFIX}/nodes/:id/rename`,
  import: `${PREFIX}/import`,
} as const

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403
const NOT_FOUND = 404
const CONFLICT = 409
const NO_CONTENT = 204
const CREATED = 201

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    const deps: Deps = { pg: openhivePg.pg }

    yield* router.add("GET", PATH.tree, (request) => handleTree(request, deps))
    yield* router.add("POST", PATH.nodes, (request) => handleCreate(request, deps))
    yield* router.add("POST", PATH.rename, (request) => handleRename(request, deps))
    yield* router.add("DELETE", PATH.node, (request) => handleDelete(request, deps))
    yield* router.add("POST", PATH.import, () => handleImport(deps))
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
  return fail(FORBIDDEN, "没有组织架构管理权限")
}

/** 请求期取身份（`Option.none` = 无凭证）。 */
const 身份 = Effect.serviceOption(User.Service)

/** 本板块的记账方法（`board` 焊在闭包里，12 条写路由共用一份实现）。 */
const 记账 = OpenhiveAudit.板块(BOARD)

/** 每请求查一次治理授权（不缓存进会话：改授权应立即生效）；拒绝当场留痕（`governance-authz.ts`）。 */
function 有权(deps: Deps, userId: string, perm: "read" | "write") {
  return GovernanceAuthz.进(deps, userId, BOARD, perm)
}

function handleTree(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    if (!(yield* 有权(deps, user.value.id, "read"))) return forbidden()

    const nodes = yield* Effect.promise(() => listNodes(deps.pg()))
    return ok({ nodes })
  })
}

function handleCreate(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    // 授权排在读取请求体之前：民警递非法载荷必须拿 403，而不是 400（文件头）。
    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const base = { action: "org.create", targetType: "org_node" } as const
    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")
    const input = 建节点入参(body)
    if (!input) return yield* 失败(deps, userId, base, BAD_REQUEST, "parentId 必须是字符串或 null")

    const result = yield* 执行(() => createNode(deps.pg(), input))
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, {
        ...base,
        targetId: result.success.id,
        result: "ok",
        detail: { name: result.success.name },
      })
      return ok(result.success, CREATED)
    }
    return yield* 翻译(result.failure, deps, userId, base)
  })
}

function handleRename(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const params = yield* HttpRouter.params
    const id = params.id ?? ""
    const base = { action: "org.rename", targetType: "org_node", targetId: id } as const

    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")
    const name = typeof body["name"] === "string" ? body["name"] : ""

    const result = yield* 执行(() => renameNode(deps.pg(), id, name))
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, { ...base, result: "ok", detail: { name } })
      return HttpServerResponse.empty({ status: NO_CONTENT })
    }
    return yield* 翻译(result.failure, deps, userId, base)
  })
}

function handleDelete(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const params = yield* HttpRouter.params
    const id = params.id ?? ""
    const base = { action: "org.delete", targetType: "org_node", targetId: id } as const

    const result = yield* 执行(() => deleteNode(deps.pg(), id))
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, { ...base, result: "ok" })
      return HttpServerResponse.empty({ status: NO_CONTENT })
    }
    return yield* 翻译(result.failure, deps, userId, base)
  })
}

function handleImport(deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const base = { action: "org.import", targetType: null, targetId: null } as const
    const result = yield* 执行(() => importFromAccounts(deps.pg()))
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, { ...base, result: "ok", detail: { created: result.success.created } })
      return ok(result.success)
    }
    return yield* 翻译(result.failure, deps, userId, base)
  })
}

/** 本模块的审计基底（板块已由 `板块()` 焊住）。 */
type 审计基底 = Pick<OpenhiveAudit.板块审计输入, "action" | "targetType" | "targetId">

/**
 * 记一笔失败结局 ＋ 回同一个错误响应。
 *
 * 收成一个函数是为了「记的 400 与回的 400 永远是同一句话」——两处各写一遍，某天改了一处
 * 就是审计说一套、界面看另一套。
 */
function 失败(deps: Deps, userId: string, base: 审计基底, status: number, message: string, field?: string) {
  return 记账
    .记失败(deps, userId, base, { status, message, ...(field === undefined ? {} : { field }) })
    .pipe(Effect.as(fail(status, message, field)))
}

/** 把领域错误翻成状态码 ＋ 给人看的一句话；认不出的继续炸（500），不吞。 */
export function 映射错误(
  error: unknown,
): { readonly status: number; readonly message: string; readonly field?: string } | undefined {
  if (error instanceof OrgNameRequiredError) return { status: BAD_REQUEST, message: error.message, field: "name" }
  if (error instanceof OrgLevelError) return { status: BAD_REQUEST, message: error.message }
  if (error instanceof OrgNameTakenError) return { status: CONFLICT, message: error.message }
  if (error instanceof OrgNodeNotFoundError) return { status: NOT_FOUND, message: error.message }
  if (error instanceof OrgNotEmptyError) return { status: CONFLICT, message: error.message }
  if (error instanceof OrgHasAccountsError) return { status: CONFLICT, message: error.message }
  return undefined
}

/** 领域错误 → 状态码；**承认得出的 4xx 都留一行 failed/denied**，认不出的继续炸（500，不记）。 */
function 翻译(error: unknown, deps: Deps, userId: string, base: 审计基底) {
  const mapped = 映射错误(error)
  if (mapped) return 失败(deps, userId, base, mapped.status, mapped.message, mapped.field)
  return Effect.die(error)
}

function 执行<A>(work: () => Promise<A>) {
  return Effect.result(Effect.tryPromise({ try: work, catch: (error) => error }))
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

/** body → `NewNodeInput`；`parentId` 的类型不对时回 `null`（由调用方回 400）。 */
function 建节点入参(body: Record<string, unknown>): NewNodeInput | undefined {
  const parent = body["parentId"]
  if (parent !== null && typeof parent !== "string") return undefined
  return { parentId: parent, name: typeof body["name"] === "string" ? body["name"] : "" }
}
