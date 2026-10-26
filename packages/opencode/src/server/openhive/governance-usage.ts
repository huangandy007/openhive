export * as OpenhiveGovernanceUsage from "./governance-usage"

/**
 * 010 T009 · **用量/成本看板**的 HTTP 出口（FR-008 / US5）。
 *
 * 一条只读出口：`GET /openhive/governance/usage-cost?from=&to=&groupBy=org|model|user`。
 * 数据全部来自 T004 的分析库（`@/governance/analytics`），这里不碰每用户 SQLite 的细节。
 *
 * ## 读之前先抽取——这是 T004 的约定，不是本模块的发明
 *
 * `analytics.ts` 的 `report` docstring 写着「只读事实表，不触发抽取——抽取由调用方（T009 的
 * 读接口）先做」。所以本出口的次序固定为：`extractAll` → `report`。反过来（先 `report` 再补抽）
 * 会让**第一次打开看板**永远显示空，第二次又突然有数——那是最难解释给管理员看的一种错。
 *
 * v1 没有调度器：每次读都同步抽一遍。幂等（主键 + 游标）保证不会翻倍，代价是请求线程要等
 * SQLite 扫一遍新增事件。MVP 规模可接受，风险记在 `010/state.md` 的缺口里。
 *
 * ## 🔴 两个「根」不是一回事（实测踩过的坑，写下来免得下次混用）
 *
 * `AnchorWorkspace.Config.root` 读的是 `OPENHIVE_WORKSPACE_ROOT`（**沙箱根**，默认 `/workspaces`）——
 * 那是项目文件长的地方。分析库与每用户 SQLite 的根是 `OPENHIVE_DATA_ROOT`（`core/database/router`
 * 的 `dataRoot`，默认 `/data`）。抽取器按 `{dataRoot}/{userId}/opencode.db` 找源库，
 * 若拿沙箱根去拼，结果永远是「所有用户都缺库」⇒ `collected: false`，而且**不报错**。
 * 所以本模块**不取** `AnchorWorkspace.Config`，两个路径都在请求期从 `process.env` 读
 * （同 `OpenhivePg` 的理由：测试在 `beforeAll` 才写 env，层构造期读会锁死空配置）。
 *
 * ## 授权先于参数解析（`LEARNINGS #004-09`）
 *
 * 未授权者递 `from=abc` 必须拿 403，不能从「400 还是 403」探出这个端点解析什么。
 * `usage-cost` 只授**系统管理员** `read`（`auth/src/governance.ts`；业务专家没有这一格）。
 *
 * ## 分组与标签
 *
 * `org` / `model` 直接是事实表里的列（org 是**抽取时快照**，组织调整不追溯——T004 的约定）。
 * `user` 的键是 `user_id`，本出口用 `usersByIds` 翻成「姓名（警号）」；账号被清理后历史消耗
 * 仍是事实，翻不出来就回落成 `已注销用户（前 8 位）`——**不隐藏这一行**。
 *
 * 错误码：401 无凭证（空体，与 005/010 其他出口一致）/ 403 无治理权限 / 400 参数不合法。
 */

import { Analytics } from "@/governance/analytics"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { usersByIds } from "@opencode-ai/auth/user"
import { dataRoot } from "@opencode-ai/core/database/router"
import { User } from "@opencode-ai/core/user"
import { sql } from "drizzle-orm"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { GovernanceAuthz } from "./governance-authz"
import { OpenhivePg } from "./pg"

/** 治理板块 id（与 `@opencode-ai/auth/governance` 的闭集、前端 `sections.ts` 逐字相同）。 */
const BOARD = "usage-cost"

const PREFIX = "/openhive/governance/usage-cost"

/**
 * 客户端契约。前端 `packages/app/src/governance/usage-cost-api.ts` **另写一份字面量**，
 * 两边刻意不共享（前端不 import 内核源码；测试也不 import 本常量——`#003-05`）。
 */
export const PATH = {
  report: PREFIX,
} as const

/** 分组闭集：**运行时**也收窄一次（客户端传的字符串不受类型保护）。 */
const GROUPINGS: readonly Analytics.GroupBy[] = ["org", "model", "user"]

const DEFAULT_GROUP_BY: Analytics.GroupBy = "org"

/** 缺省窗口：近 30 天。前端有 7/30/90 的预设，缺省值只服务直接调 API 的场景。 */
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const BAD_REQUEST = 400
const UNAUTHORIZED = 401
const FORBIDDEN = 403

interface Deps {
  readonly pg: OpenhivePg.Interface["pg"]
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const openhivePg = yield* OpenhivePg.Service
    // 层构造期取闭包、请求期取库（`pg.ts` 文件头：层构造期 `connect()` 会锁死空配置）。
    const deps: Deps = { pg: openhivePg.pg }

    yield* router.add("GET", PATH.report, (request) => handleReport(request, deps))
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
  return fail(FORBIDDEN, "没有用量看板权限")
}

/** 请求期取身份（`Option.none` = 无凭证）。 */
const 身份 = Effect.serviceOption(User.Service)

/** 每请求查一次治理授权（不缓存：改授权应立即生效）；拒绝当场留痕（`governance-authz.ts`）。 */
function 有权(deps: Deps, userId: string) {
  return GovernanceAuthz.进(deps, userId, BOARD, "read")
}

/**
 * 查询串里的毫秒时间戳。`null` = 没给（走缺省）；`NaN` = 给了但不是毫秒（400）。
 *
 * 只认十进制数字串：`Number("1e5")`、`Number(" 1 ")`、`Number("0x10")` 都会悄悄放行，
 * 而这里的值直接进 SQL 参数参与窗口比较——错一位就是「账对不上」而不是「少了个东西」。
 */
function 毫秒(value: string | null): number | null {
  if (value === null || value === "") return null
  if (!/^\d{1,16}$/.test(value)) return Number.NaN
  return Number(value)
}

function handleReport(request: HttpServerRequest.HttpServerRequest, deps: Deps) {
  return Effect.gen(function* () {
    const user = yield* 身份
    if (Option.isNone(user)) return unauthorized()
    // 授权排在解析参数之前（`#004-09`）：未授权者不该从 400/200 的差异读出这个端点吃什么参数。
    if (!(yield* 有权(deps, user.value.id))) return forbidden()

    const params = new URL(request.url, "http://localhost").searchParams
    const toRaw = 毫秒(params.get("to"))
    const fromRaw = 毫秒(params.get("from"))
    if (toRaw !== null && Number.isNaN(toRaw)) return fail(BAD_REQUEST, "to 必须是毫秒时间戳")
    if (fromRaw !== null && Number.isNaN(fromRaw)) return fail(BAD_REQUEST, "from 必须是毫秒时间戳")

    const to = toRaw ?? Date.now()
    const from = fromRaw ?? to - DEFAULT_WINDOW_MS
    if (from >= to) return fail(BAD_REQUEST, "from 必须早于 to")

    const groupByRaw = params.get("groupBy") ?? DEFAULT_GROUP_BY
    const groupBy = GROUPINGS.find((value) => value === groupByRaw)
    if (!groupBy) return fail(BAD_REQUEST, `未知分组：${groupByRaw}`)

    const pg = deps.pg()
    const 名册 = yield* Effect.promise(() => 使用人(pg))
    // 分析库的根是 `OPENHIVE_DATA_ROOT`（**不是**沙箱根，见文件头）。
    const 库路径 = Analytics.analyticsPath(process.env)
    const 根 = dataRoot(process.env)
    const 报表 = yield* Effect.sync(() => 汇总({ path: 库路径, root: 根, users: 名册, from, to, groupBy }))
    const 标签 = yield* Effect.promise(() => 行标签(pg, 报表.rows, groupBy))

    return ok({
      collected: 报表.collected,
      watermark: 报表.watermark,
      from,
      to,
      groupBy,
      metrics: 报表.metrics,
      rows: 报表.rows.map((row) => ({ ...row, label: 标签.get(row.key) ?? row.key })),
    })
  })
}

/**
 * 抽取范围的「使用人」：**全部** `auth.user` 行（含已停用的）。
 *
 * 不过滤 `status`：停用账号历史上调用的 token 是已经付过的成本，把它从账里抹掉只会让成本
 * 对不上；它们今天没有新事件，是因为没有新会话，不是因为被排除。没有库的人由抽取器自己
 * 记成 `missing`（`existsSync` 挡住「打开就建空库」），不影响其他人。
 */
async function 使用人(pg: ReturnType<OpenhivePg.Interface["pg"]>): Promise<Array<{ id: string; org: string }>> {
  const result = await pg.execute(sql`select id, org from auth.user`)
  return rowsOf(result).map((row) => ({ id: String(row["id"]), org: String(row["org"]) }))
}

interface 汇总输入 {
  readonly path: string
  readonly root: string
  readonly users: ReadonlyArray<{ id: string; org: string }>
  readonly from: number
  readonly to: number
  readonly groupBy: Analytics.GroupBy
}

/**
 * 打开分析库 → 抽取 → 报表 → **必关**。
 *
 * 一个请求一次开关：分析库是全系统共用的单文件，长驻句柄省下的那点时间不值得多一个
 * 「谁该在什么时候关它」的问题（`analytics.ts` 的 `Store` 就是为这种用法给的）。
 */
function 汇总(input: 汇总输入): Analytics.Report {
  const store = Analytics.open(input.path)
  try {
    // 抽取先于报表：理由见文件头（`analytics.ts` 的 `report` 把这件事交给调用方）。
    Analytics.extractAll({ analytics: store.db, dataRoot: input.root, users: input.users })
    return Analytics.report({ analytics: store.db, from: input.from, to: input.to, groupBy: input.groupBy })
  } finally {
    store.close()
  }
}

/**
 * `groupBy=user` 的显示名。其他分组的键本身就是给人看的（单位名 / 模型 id），不翻。
 *
 * `usersByIds` 的「缺席」语义是「库里没有这个人」——那是**账号被清理**后的历史行，
 * 必须回落成可读的占位而不是留白或裸 UUID（否则管理员看到一个 36 位的 id 无从下手）。
 */
async function 行标签(
  pg: ReturnType<OpenhivePg.Interface["pg"]>,
  rows: readonly Analytics.ReportRow[],
  groupBy: Analytics.GroupBy,
): Promise<Map<string, string>> {
  if (groupBy !== "user") return new Map()
  const ids = rows.map((row) => row.key)
  const people = await usersByIds(pg, ids)
  return new Map(
    ids.map((id) => {
      const 人 = people.get(id)
      return [id, 人 ? `${人.name}（${人.policeNo}）` : `已注销用户（${id.slice(0, 8)}）`]
    }),
  )
}
