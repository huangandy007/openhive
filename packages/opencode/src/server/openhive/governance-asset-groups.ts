export * as OpenhiveGovernanceAssetGroups from "./governance-asset-groups"

/**
 * 需求 3b · **授权组**的管理出口（2026-10-27）：列表 / 建组 / 加组员。
 *
 * ## 为什么需要这一组出口
 *
 * 「指定人员」这一档的读权**只**来自 `auth.role_resource` 的授权行，而授权行挂在授权组上
 * （`role_type = 'group'` 的自定义 role）。`authorization.ts` 里的
 * `createAuthorizationGroup` / `addGroupMember` / `grantAssetToGroup` 直到本轮都只有测试在写，
 * 没有任何生产入口——发布时「选组」的弹窗就会是一张永远空的列表。
 *
 * ## 权限：读要 `read`、写要 `admin`
 *
 * 与分类维护（需求 4）同一口径：组名单是管理数据，看得见与改得动分开；业务审核员
 * （`review`）不建组、不加人。
 *
 * ## 这里**不**碰资产的授权行
 *
 * 「这份资产发给哪些组」由发布动作决定（`POST /openhive/governance/assets/:id/transition`
 * 的 `visibility=targeted` ＋ `groupIds`，写 `setAssetReadGroups()`）。组出口只管组本身，
 * 两个写口各管一张表，谁都不替对方写——否则同一条授权会有两个来源，删不干净。
 *
 * ## 幂等
 *
 * 重复加同一个组员**不报错**（`user_role` 的主键会拒，这里把 23505 当成功）：管理员点两下
 * 「添加」不该看到失败。建组撞 id 则是真冲突（409）：id 是引用键，静默复用会把两份不同的
 * 名单合成一份。
 */

import {
  addGroupMember,
  createAuthorizationGroup,
  UnknownAuthorizationGroupError,
} from "@opencode-ai/asset-service/authorization"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { pgErrorCode } from "@opencode-ai/auth/pg-errors"
import { User } from "@opencode-ai/core/user"
import { sql } from "drizzle-orm"
import { Effect, Option, Result } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { OpenhiveAudit } from "./audit"
import { GovernanceAuthz } from "./governance-authz"
import { OpenhivePg } from "./pg"

/** 板块 id（与 `@opencode-ai/auth/governance` 的闭集、前端 `sections.ts` 逐字相同）。 */
const BOARD = "asset-governance"

const PREFIX = "/openhive/governance/asset-groups"

/**
 * 客户端契约。前端 `packages/app/src/governance/*` **另写一份字面量**，两边刻意不共享
 * （前端不 import 内核源码；测试也不 import 本常量——`#003-05`）。
 */
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  members: `${PREFIX}/:id/members`,
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
    yield* router.add("POST", PATH.members, (request) => handleAddMember(request, deps))
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

/** 本模块的审计基底（板块已由 `板块()` 焊住）。 */
type 审计基底 = Pick<OpenhiveAudit.板块审计输入, "action" | "targetType" | "targetId">

/** 记一笔失败结局 ＋ 回同一个错误响应。 */
function 失败(deps: Deps, userId: string, base: 审计基底, status: number, message: string, field?: string) {
  return 记账
    .记失败(deps, userId, base, { status, message, ...(field === undefined ? {} : { field }) })
    .pipe(Effect.as(fail(status, message, field)))
}

function handleList(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    if (!(yield* 有权(deps, user.value.id, "read"))) return forbidden()

    // 成员数用 left join ＋ count：组刚建、一个人都没有时 `count(ur.user_id) = 0`
    // （`count(*)` 会把它数成 1）。
    const rows = yield* Effect.promise(() =>
      deps.pg().execute(sql`
        select r.id as id, r.name as name, count(ur.user_id) as member_count
          from auth.role r
          left join auth.user_role ur on ur.role_id = r.id
         where r.role_type = 'group'
         group by r.id, r.name
         order by r.name, r.id
      `),
    )
    const groups = rowsOf(rows).map((row) => ({
      id: String(row["id"]),
      name: String(row["name"]),
      memberCount: Number(row["member_count"]),
    }))
    return ok({ groups })
  })
}

function handleCreate(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    // 授权排在读取请求体之前（`#004-09`）。
    if (!(yield* 有权(deps, userId, "admin"))) return forbidden()

    const base = { action: "asset-group.create", targetType: "asset_group" } as const
    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")

    const id = body["id"]
    if (typeof id !== "string" || id.trim() === "") {
      return yield* 失败(deps, userId, base, BAD_REQUEST, "id 必须是非空字符串", "id")
    }
    const name = body["name"]
    if (typeof name !== "string" || name.trim() === "") {
      return yield* 失败(deps, userId, base, BAD_REQUEST, "name 必须是非空字符串", "name")
    }
    const rawMemberIds = body["memberIds"]
    const memberIds: string[] = []
    if (rawMemberIds !== undefined) {
      if (!Array.isArray(rawMemberIds)) {
        return yield* 失败(deps, userId, base, BAD_REQUEST, "memberIds 必须是用户 id 的数组", "memberIds")
      }
      const items: readonly unknown[] = rawMemberIds
      for (const item of items) {
        if (typeof item !== "string" || item.trim() === "") {
          return yield* 失败(deps, userId, base, BAD_REQUEST, "memberIds 里每一项都必须是非空字符串", "memberIds")
        }
        if (!memberIds.includes(item.trim())) memberIds.push(item.trim())
      }
    }

    const 组id = id.trim()
    const 组名 = name.trim()

    // 先验人、再建组（`#004-09` 的顺序）：外键要等插入才知道，那时组已经建好，
    // 半截状态（组在、人没加）会让管理员以为建成功了。
    if (memberIds.length > 0) {
      const 存在 = yield* Effect.promise(() =>
        deps.pg().execute(
          sql`select id from auth.user where id in (${sql.join(memberIds.map((memberId) => sql`${memberId}`), sql`, `)})`,
        ),
      )
      const 有 = new Set(rowsOf(存在).map((row) => String(row["id"])))
      const 缺 = memberIds.filter((memberId) => !有.has(memberId))
      if (缺.length > 0) {
        return yield* 失败(deps, userId, base, BAD_REQUEST, `用户不存在：${缺.join("、")}`, "memberIds")
      }
    }

    const result = yield* 执行(async () => {
      try {
        await createAuthorizationGroup(deps.pg(), { id: 组id, name: 组名 })
      } catch (error) {
        // 主键撞了：组 id 是引用键，「合并」比报错危险得多。
        if (pgErrorCode(error) === "23505") {
          return { ok: false as const, status: CONFLICT, message: `授权组已存在：${组id}` }
        }
        throw error
      }
      for (const memberId of memberIds) await addGroupMember(deps.pg(), { groupId: 组id, userId: memberId })
      return { ok: true as const }
    })

    if (Result.isFailure(result)) return yield* Effect.die(result.failure)
    if (!result.success.ok) {
      return yield* 失败(deps, userId, base, result.success.status, result.success.message)
    }

    yield* 记账.记(deps, userId, {
      ...base,
      targetId: 组id,
      result: "ok",
      detail: { name: 组名, memberIds },
    })
    return ok({ group: { id: 组id, name: 组名, memberCount: memberIds.length } }, CREATED)
  })
}

function handleAddMember(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    const userId = user.value.id
    if (!(yield* 有权(deps, userId, "admin"))) return forbidden()

    const params = yield* HttpRouter.params
    const groupId = params.id ?? ""
    const base = { action: "asset-group.add_member", targetType: "asset_group", targetId: groupId } as const

    const body = yield* 读取体(request)
    if (!isRecord(body)) return yield* 失败(deps, userId, base, BAD_REQUEST, "请求体不是 JSON 对象")
    const memberId = body["userId"]
    if (typeof memberId !== "string" || memberId.trim() === "") {
      return yield* 失败(deps, userId, base, BAD_REQUEST, "userId 必须是非空字符串", "userId")
    }

    const result = yield* 执行(async () => {
      try {
        await addGroupMember(deps.pg(), { groupId, userId: memberId.trim() })
        return { ok: true as const }
      } catch (error) {
        const code = pgErrorCode(error)
        // 已经在组里：重复点是幂等的，不报错（`user_role` 的主键会拒）。
        if (code === "23505") return { ok: true as const }
        if (code === "23503") {
          return { ok: false as const, status: BAD_REQUEST, message: `用户不存在：${memberId}`, field: "userId" }
        }
        if (error instanceof UnknownAuthorizationGroupError) {
          return { ok: false as const, status: NOT_FOUND, message: error.message }
        }
        throw error
      }
    })

    if (Result.isFailure(result)) return yield* Effect.die(result.failure)
    if (!result.success.ok) {
      return yield* 失败(deps, userId, base, result.success.status, result.success.message, result.success.field)
    }

    yield* 记账.记(deps, userId, {
      ...base,
      result: "ok",
      detail: { userId: memberId.trim() },
    })
    return ok({ ok: true })
  })
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
