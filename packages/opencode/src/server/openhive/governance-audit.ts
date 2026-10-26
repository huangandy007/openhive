export * as OpenhiveGovernanceAudit from "./governance-audit"

/**
 * 010 T010b · **审计日志检索**的 HTTP 出口（FR-009 / DESIGN §4.11.7）。
 *
 * 一条只读出口：`GET /openhive/governance/audit-log?from=&to=&actor=&action=&result=&q=&page=&pageSize=`。
 * 存储与筛选条件全在 `@opencode-ai/auth/audit`（T010a），本文件只做身份、授权、参数收窄。
 *
 * ## 为什么这条出口自己不审计
 *
 * 「谁看了审计日志」是一个合理的问题，但把它记进**同一张表**会让翻页本身变成噪音：
 * 每翻一页涨一行，`total` 也跟着涨，管理员永远翻不到底。设计上也不要求（§4.11.7 只要求
 * 检索与展开详情），所以读动作一律不记——与 T010a 的「治理读动作不记」同一条边界。
 *
 * ## 授权先于参数解析（`LEARNINGS #004-09`）
 *
 * 未授权者递 `from=abc` 必须拿 403。若先解析，400 与 403 的差别就成了「这个端点吃什么参数」
 * 的探针。
 *
 * ## 时间单位是**秒**
 *
 * 表里的 `occurred_at` 是 int4 秒（`@opencode-ai/auth/audit` 文件头）。前端 `usage-cost` 用毫秒，
 * 两个端点**故意不同**——不要把毫秒直接塞进这里（乘一千，窗口就歪到 5 万年后的空集）。
 *
 * ## 缺省窗口 = 近 7 天
 *
 * DESIGN §4.11.7 明写。缺省值只服务直接调 API 的场景：前端永远传 `from`/`to`，
 * 让「界面上显示的时间范围」与「这一屏数据」永远是同一件事。
 */

import { Audit } from "@opencode-ai/auth/audit"
import { User } from "@opencode-ai/core/user"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { GovernanceAuthz } from "./governance-authz"
import { OpenhivePg } from "./pg"

/** 治理板块 id（与 `@opencode-ai/auth/governance` 的闭集、前端 `sections.ts` 逐字相同）。 */
const BOARD = "audit-log"

const PREFIX = "/openhive/governance/audit-log"

/**
 * 客户端契约。前端 `packages/app/src/governance/audit-log-api.ts` **另写一份字面量**，
 * 两边刻意不共享（前端不 import 内核源码；测试也不 import 本常量——`#003-05`）。
 */
export const PATH = {
  list: PREFIX,
} as const

/** 缺省窗口：近 7 天（DESIGN §4.11.7）。 */
const DEFAULT_WINDOW_SECONDS = 7 * 24 * 60 * 60

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403

const 动作闭集: readonly Audit.AuditAction[] = Audit.AUDIT_ACTIONS
const 结果闭集: readonly Audit.AuditResult[] = Audit.AUDIT_RESULTS

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    // 层构造期取闭包、请求期取库（`pg.ts` 文件头：层构造期 `connect()` 会锁死空配置）。
    const deps: Deps = { pg: openhivePg.pg }

    yield* router.add("GET", PATH.list, (request) => handleList(request, deps))
  }),
)

function ok(value: unknown) {
  return HttpServerResponse.jsonUnsafe(value, { status: 200 })
}

function fail(status: number, message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message }, { status })
}

function unauthorized() {
  return HttpServerResponse.empty({ status: UNAUTHORIZED })
}

function forbidden() {
  return fail(FORBIDDEN, "没有审计日志权限")
}

/** 请求期取身份（`Option.none` = 无凭证）。 */
const 身份 = Effect.serviceOption(User.Service)

/** 每请求查一次治理授权（不缓存：改授权应立即生效）；拒绝当场留痕（`governance-authz.ts`）。 */
function 有权(deps: Deps, userId: string) {
  return GovernanceAuthz.进(deps, userId, BOARD, "read")
}

/**
 * 查询串里的十进制整数。`null` = 没给；`NaN` = 给了但不是十进制（400）。
 *
 * 只认 `\d+`：`Number("1e5")` / `Number(" 1 ")` / `Number("0x10")` 都会悄悄放行，
 * 而这些值直接进 SQL 参数参与窗口比较。上限 16 位挡住溢出成一团乱数的值。
 */
function 整数(value: string | null): number | null {
  if (value === null || value === "") return null
  if (!/^\d{1,16}$/.test(value)) return Number.NaN
  return Number(value)
}

function 文本(value: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function handleList(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    // 授权排在解析参数之前（`#004-09`）。
    if (!(yield* 有权(deps, user.value.id))) return forbidden()

    const params = new URL(request.url, "http://localhost").searchParams

    const toRaw = 整数(params.get("to"))
    const fromRaw = 整数(params.get("from"))
    if (toRaw !== null && Number.isNaN(toRaw)) return fail(BAD_REQUEST, "to 必须是秒级时间戳")
    if (fromRaw !== null && Number.isNaN(fromRaw)) return fail(BAD_REQUEST, "from 必须是秒级时间戳")

    const to = toRaw ?? Math.floor(Date.now() / 1000)
    const from = fromRaw ?? to - DEFAULT_WINDOW_SECONDS
    if (from >= to) return fail(BAD_REQUEST, "from 必须早于 to")

    // 用 `find` 收窄而不是 `as`：闭集判定与类型收窄是同一次查表，不会各说各话。
    const resultParam = 文本(params.get("result"))
    const result = resultParam === undefined ? undefined : 结果闭集.find((value) => value === resultParam)
    if (resultParam !== undefined && result === undefined) return fail(BAD_REQUEST, `未知结果：${resultParam}`)

    const actionParam = 文本(params.get("action"))
    const action = actionParam === undefined ? undefined : 动作闭集.find((value) => value === actionParam)
    if (actionParam !== undefined && action === undefined) return fail(BAD_REQUEST, `未知动作：${actionParam}`)

    const page = 整数(params.get("page"))
    if (page !== null && (Number.isNaN(page) || page < 1)) return fail(BAD_REQUEST, "page 必须是正整数")

    const pageSize = 整数(params.get("pageSize"))
    if (pageSize !== null && (Number.isNaN(pageSize) || pageSize < 1 || pageSize > Audit.MAX_PAGE_SIZE)) {
      return fail(BAD_REQUEST, `pageSize 必须是 1–${Audit.MAX_PAGE_SIZE} 的整数`)
    }

    const 页 = yield* Effect.promise(() =>
      Audit.listAuditEvents(deps.pg(), {
        from,
        to,
        actor: 文本(params.get("actor")),
        action,
        result,
        q: 文本(params.get("q")),
        page: page ?? undefined,
        pageSize: pageSize ?? undefined,
      }),
    )
    return ok(页)
  })
}
