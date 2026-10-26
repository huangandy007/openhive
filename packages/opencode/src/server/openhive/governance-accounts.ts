export * as OpenhiveGovernanceAccounts from "./governance-accounts"

/**
 * 010 T005 · **账号管理**的 HTTP 出口（FR-004 / US2）：列表 / 详情 / 录入 / 重置 / 停用 / 启用 / 批量停用。
 *
 * ## 这一层只做三件事
 *
 * 1. **身份**：请求期从 `User.Service` 取（身份门每请求注入；层构造期没有它）。
 * 2. **授权**：`authorizeGovernance(...)` 每请求查库，读接口要 `account-manage/read`、
 *    写接口要 `account-manage/write`。**必须排在一切副作用之前**——校验、读目标行、
 *    建目录、落库都不许抢在它前面（`#004-09`：否则「先写库、再发现无权」的实现也能全绿，
 *    而且管理员与非管理员之间的 400/403 差别会变成字段合法性探针）。
 * 3. **错误翻译**：领域错误 → HTTP 状态码 ＋ 一句给人看的中文。服务层自己不做鉴权
 *    （`resetPassword` 的注释明写「真正的门禁在调用方」），所以这里是**唯一的门**。
 *
 * 读 / 写的业务逻辑**不在本文件**：列表与详情在 `@opencode-ai/auth/account-admin`，
 * 录入 / 重置 / 停用 / 启用各在 auth 包已有的模块里。这里不重写任何一条规则——两份实现
 * 漂了不会报错（`#002-06`）。
 *
 * ## 三个刻意的边界
 *
 * - **录入走 `provisionUser`，不走 `registerUser`**：后者不建沙箱目录，会留下「能过认证、
 *  却没有沙箱」的账号，而且挡住重试（003 T022 的移交，见 `tasks.md` 文件头）。
 * - **不能停用自己**：DESIGN §4.11.7 要求界面上该按钮 disabled，但前端隐藏不是门
 *   （宪法 §IV）。单条与批量都在服务端挡，批量整批拒绝——「部分成功」是运维最难查的形态。
 * - **`LastAdminError` 有消费方，但经本路由不可达**：`authorizeGovernance` 要求调用者本人是
 *   **启用的管理员** ⇒ 任何「覆盖全部启用管理员」的 ids 必然包含调用者 ⇒ 先被上面那条
 *   「不能停用自己」挡下。服务层的守卫因此是**纵深防御**；映射函数单独导出、单独测，
 *   可达性缺口如实写进 `state.md`，不写成「已覆盖」。
 *
 * ## 未配置默认口令时
 *
 * `defaultPassword(process.env)` 会抛（没有兜底值是 003 T020 的裁定）。那一刻请求以 500
 * 结束——这是**部署配置错误**，不是客户端能救的；与登录出口同一处置。
 */

import { accountById, listAccounts, type AccountQuery } from "@opencode-ai/auth/account-admin"
import { resetPassword } from "@opencode-ai/auth/password"
import { defaultPassword } from "@opencode-ai/auth/policy"
import {
  DuplicatePoliceNoError,
  InvalidStatusError,
  MissingFieldError,
  provisionUser,
  type RegisterInput,
} from "@opencode-ai/auth/register"
import { disableAccounts, LastAdminError, restoreAccount } from "@opencode-ai/auth/zombie"
import { User } from "@opencode-ai/core/user"
import { Effect, Option, Result } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { AnchorWorkspace } from "@/server/routes/instance/httpapi/middleware/anchor-workspace"
import { OpenhiveAudit } from "./audit"
import { GovernanceAuthz } from "./governance-authz"
import { OpenhivePg } from "./pg"

/** 板块 id（与 `@opencode-ai/auth/governance` 的闭集、前端 `sections.ts` 逐字相同）。 */
const BOARD = "account-manage"

const PREFIX = "/openhive/governance/accounts"

/**
 * 客户端契约。前端 `packages/app/src/governance/account-api.ts` **另写一份字面量**，
 * 两边刻意不共享（前端不 import 内核源码；测试也不 import 本常量——`#003-05`）。
 */
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  detail: `${PREFIX}/:id`,
  password: `${PREFIX}/:id/password`,
  disable: `${PREFIX}/:id/disable`,
  enable: `${PREFIX}/:id/enable`,
  batchDisable: `${PREFIX}/batch-disable`,
} as const

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403
const NOT_FOUND = 404
const CONFLICT = 409
const NO_CONTENT = 204
const CREATED = 201

interface Deps {
  /** 沙箱根：`provisionUser` 要在这里建 `{root}/{id}`（与项目出口共用同一个配置源）。 */
  readonly root: string
  readonly pg: OpenhivePg.Interface["pg"]
}

/**
 * 所有服务在**层构造期**取、请求期用闭包。身份是唯一例外：它由身份门**每请求**注入
 * （请求 fiber 的 context 里没有 app 层服务，见 `project.ts` 的同款注释）。
 */
export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* AnchorWorkspace.Config
    const openhivePg = yield* OpenhivePg.Service

    const deps: Deps = { root: config.root, pg: openhivePg.pg }

    yield* router.add("GET", PATH.list, (request) => handleList(request, deps))
    yield* router.add("GET", PATH.detail, (request) => handleDetail(request, deps))
    yield* router.add("POST", PATH.create, (request) => handleCreate(request, deps))
    yield* router.add("POST", PATH.password, (request) => handlePassword(request, deps))
    yield* router.add("POST", PATH.disable, (request) => handleDisable(request, deps))
    yield* router.add("POST", PATH.enable, (request) => handleEnable(request, deps))
    yield* router.add("POST", PATH.batchDisable, (request) => handleBatchDisable(request, deps))
  }),
)

function ok(value: unknown, status = 200) {
  return HttpServerResponse.jsonUnsafe(value, { status })
}

function empty() {
  return HttpServerResponse.empty({ status: NO_CONTENT })
}

function fail(status: number, message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status })
}

function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

function forbidden() {
  return fail(FORBIDDEN, "没有账号管理权限")
}

function notFound() {
  return fail(NOT_FOUND, "账号不存在")
}

/** 请求期取身份（`Option.none` = 无凭证）。 */
const 身份 = Effect.serviceOption(User.Service)

/** 本板块的记账方法（`board` 焊在闭包里，写路由共用一份实现）。 */
const 记账 = OpenhiveAudit.板块(BOARD)

/** 本模块的审计基底（板块已由 `板块()` 焊住）。 */
type 审计基底 = Pick<OpenhiveAudit.板块审计输入, "action" | "targetType" | "targetId">

/** 每请求查一次治理授权（不缓存进会话：改授权应立即生效）；拒绝当场留痕（`governance-authz.ts`）。 */
function 有权(deps: Deps, userId: string, perm: "read" | "write") {
  return GovernanceAuthz.进(deps, userId, BOARD, perm)
}

/**
 * 记一笔失败结局 ＋ 回同一个错误响应。
 *
 * 收成一个函数是为了「记的 400 与回的 400 永远是同一句话」——两处各写一遍，某天改了一处
 * 就是审计说一套、界面看另一套。
 */
function 失败(deps: Deps, userId: string, base: 审计基底, status: number, message: string, field?: string) {
  return 记账.记失败(deps, userId, base, { status, message, ...(field === undefined ? {} : { field }) }).pipe(
    Effect.as(
      field === undefined
        ? fail(status, message)
        : HttpServerResponse.jsonUnsafe({ error: message, field }, { status }),
    ),
  )
}

function handleList(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    if (!(yield* 有权(deps, user.value.id, "read"))) return forbidden()

    const params = new URL(request.url, "http://localhost").searchParams
    const query: AccountQuery = {
      q: params.get("q") ?? undefined,
      status: 状态筛选(params.get("status")),
      zombieOnly: params.get("zombie") === "1",
      page: 数字(params.get("page")),
      pageSize: 数字(params.get("pageSize")),
    }

    return ok(yield* Effect.promise(() => listAccounts(deps.pg(), query)))
  })
}

function handleDetail(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    if (!(yield* 有权(deps, user.value.id, "read"))) return forbidden()

    const params = yield* HttpRouter.params
    const detail = yield* Effect.promise(() => accountById(deps.pg(), params.id ?? ""))
    return detail ? ok(detail) : notFound()
  })
}

function handleCreate(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    // 授权排在解析与校验**之前**：民警递非法载荷必须拿 403，而不是 400（见文件头第 2 条）。
    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const base = { action: "account.create", targetType: "user" } as const
    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")
    const input = 录入入参(body)

    const result = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          provisionUser(deps.pg(), input, deps.root, defaultPassword(process.env)),
        catch: (error) => error,
      }),
    )
    if (Result.isSuccess(result)) {
      yield* 记账.记(deps, userId, {
        ...base,
        targetId: result.success.id,
        result: "ok",
        detail: { policeNo: input.policeNo },
      })
      return ok({ id: result.success.id }, CREATED)
    }

    const error = result.failure
    if (error instanceof MissingFieldError) {
      return yield* 失败(deps, userId, base, BAD_REQUEST, error.message, error.field)
    }
    if (error instanceof DuplicatePoliceNoError) return yield* 失败(deps, userId, base, CONFLICT, "该警号已录入")
    if (error instanceof InvalidStatusError) return yield* 失败(deps, userId, base, BAD_REQUEST, error.message)
    return yield* Effect.die(error)
  })
}

function handlePassword(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const params = yield* HttpRouter.params
    const id = params.id ?? ""
    // ⚠️ `detail` 只记「重置了谁的密码」，**绝不记口令本身**（判据见 T010 的用例）：
    // 审计表是只增不改的，写进去的口令没有任何手段收回。
    const base = { action: "account.reset_password", targetType: "user", targetId: id } as const
    const target = yield* Effect.promise(() => accountById(deps.pg(), id))
    if (!target) return yield* 失败(deps, userId, base, NOT_FOUND, "账号不存在")

    yield* Effect.promise(() => resetPassword(deps.pg(), id, defaultPassword(process.env)))
    yield* 记账.记(deps, userId, { ...base, result: "ok" })
    return empty()
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
    const base = { action: "account.disable", targetType: "user", targetId: id } as const
    if (id === userId) return yield* 失败(deps, userId, base, BAD_REQUEST, "不能停用当前登录的账号")
    if (!(yield* Effect.promise(() => accountById(deps.pg(), id)))) {
      return yield* 失败(deps, userId, base, NOT_FOUND, "账号不存在")
    }

    return yield* 停用(deps, userId, [id], "account.disable", NO_CONTENT)
  })
}

function handleBatchDisable(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const base = { action: "account.batch_disable", targetType: "user", targetId: null } as const
    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")
    const ids = id列表(body)
    if (!ids) return yield* 失败(deps, userId, base, BAD_REQUEST, "ids 必须是账号 id 数组")
    if (ids.length === 0) return yield* 失败(deps, userId, base, BAD_REQUEST, "请选择要停用的账号")
    if (ids.includes(userId)) return yield* 失败(deps, userId, base, BAD_REQUEST, "不能停用当前登录的账号")

    // 先查齐再动：有一个不存在就整批 404，不留「停了一半」。
    for (const id of ids) {
      if (!(yield* Effect.promise(() => accountById(deps.pg(), id)))) {
        return yield* 失败(deps, userId, base, NOT_FOUND, "账号不存在")
      }
    }

    return yield* 停用(deps, userId, ids, "account.batch_disable", 200, ids.length)
  })
}

function handleEnable(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "write"))) return forbidden()

    const params = yield* HttpRouter.params
    const id = params.id ?? ""
    const base = { action: "account.enable", targetType: "user", targetId: id } as const
    if (!(yield* Effect.promise(() => accountById(deps.pg(), id)))) {
      return yield* 失败(deps, userId, base, NOT_FOUND, "账号不存在")
    }

    yield* Effect.promise(() => restoreAccount(deps.pg(), id))
    yield* 记账.记(deps, userId, { ...base, result: "ok" })
    return empty()
  })
}

/**
 * 停用的公共尾巴：调**服务层**的 `disableAccounts`（守卫、幂等、整批语义都在那里，
 * 不在这里重写），把 `LastAdminError` 翻译成 409。
 *
 * `disabled` 报的是**本次处理的条数**（不是「状态真的从 1 变 0 的条数」）：服务层对已停用的
 * id 是幂等 no-op，而「点了 3 个、处理了 3 个」比「其中 1 个本来就已经停用」更像管理员要的
 * 回答。这个口径与 `disableAccounts` 的注释一致。
 */
function 停用(
  deps: Deps,
  userId: string,
  ids: string[],
  action: "account.disable" | "account.batch_disable",
  成功状态: number,
  disabled?: number,
) {
  return Effect.gen(function* () {
    const result = yield* Effect.result(
      Effect.tryPromise({ try: () => disableAccounts(deps.pg(), ids), catch: (error) => error }),
    )
    if (Result.isSuccess(result)) {
      // **每个账号一行**：审计要回答「某人把哪几个号停了」，一行带 ids 数组答不了这个问题
      // （筛选、计数、按对象追溯都会变成字符串匹配）。
      for (const id of ids) {
        yield* 记账.记(deps, userId, { action, targetType: "user", targetId: id, result: "ok" })
      }
      return disabled === undefined ? empty() : ok({ disabled }, 成功状态)
    }

    const mapped = 停用失败(result.failure)
    if (mapped) return yield* 失败(deps, userId, { action, targetType: "user", targetId: null }, mapped.status, mapped.message)
    return yield* Effect.die(result.failure)
  })
}

/**
 * `LastAdminError` → 给管理员看的一句话。
 *
 * 单独导出：**经本路由不可达**（理由见文件头最后一条），但服务层守卫必须有人翻译——
 * 将来若有别的调用方（后台任务、批量运维脚本），它不该变成 500。这里直接把映射钉住，
 * 而不是让那句「不可达」的说明同时充当「它是对的」的证据。
 */
export function 停用失败(error: unknown): { readonly status: number; readonly message: string } | undefined {
  if (error instanceof LastAdminError) return { status: CONFLICT, message: "系统至少保留一个管理员" }
  return undefined
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

/** body → `RegisterInput`。**类型不对的文本字段折成空串**，交给 `validate` 统一判「没填」。 */
function 录入入参(body: Record<string, unknown>): RegisterInput {
  const status = body["status"]
  return {
    policeNo: 文本(body, "policeNo"),
    name: 文本(body, "name"),
    idCard: 文本(body, "idCard"),
    phone: 文本(body, "phone"),
    org: 文本(body, "org"),
    dept: 文本(body, "dept"),
    section: 文本(body, "section"),
    status: typeof status === "number" ? status : Number.NaN,
  }
}

function 文本(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === "string" ? value : ""
}

function id列表(body: Record<string, unknown>): string[] | null {
  const value = body["ids"]
  if (!Array.isArray(value)) return null
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) return null
    ids.push(item)
  }
  return ids
}

function 状态筛选(value: string | null): 0 | 1 | undefined {
  if (value === "1") return 1
  if (value === "0") return 0
  return undefined
}

function 数字(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
