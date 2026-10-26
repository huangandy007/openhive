/**
 * 用量/成本看板的前端客户端（010 T009 / FR-008 / US5）。
 *
 * 与 `account-api.ts` / `project-api.ts` 同一套范式：**同源相对路径**、可注入的 `send`、
 * Outcome 三态（ok / rejected / failed）、严格解析、10 秒超时。理由不重述，见 `account-api.ts` 文件头。
 *
 * ## 一个出口，三种分组
 *
 * `GET /openhive/governance/usage-cost?from=&to=&groupBy=org|model|user`。
 * 看板只读这一份数据：卡片上的汇总（`metrics`）与明细表（`rows`）来自**同一次**查询——
 * 分两次拉会出现「卡片是 30 天、表是 7 天」这种对不上账的界面。
 *
 * ## 分组的闭集在这里也写一份
 *
 * 与内核 `governance-usage.ts` 的 `GROUPINGS` 逐字对应，**刻意不共享**（前端不 import 内核源码，
 * `#003-05`）。漂了不会静默：服务端对未知分组回 400，这里把它当「拒绝」显示。
 *
 * ## `collected: false` 不是「0 次调用」
 *
 * 分析库还没抽取过任何东西（新部署 / 数据根配错）时，服务端回 `collected: false` 且指标全 0。
 * 界面必须显示「—」而不是 0——T004 的 `Report` 注释把这条写成了契约，这里只是照办。
 */

/** 分组维度：单位 / 模型 / 人员（FR-008 的三个问法）。 */
export const GROUP_BY = ["org", "model", "user"] as const
export type GroupBy = (typeof GROUP_BY)[number]

export const GROUP_LABELS: Record<GroupBy, string> = {
  org: "单位",
  model: "模型",
  user: "人员",
}

/** 明细表的一行（`label` 由服务端翻译：单位名 / 模型 id / 「姓名（警号）」）。 */
export interface UsageRow {
  readonly key: string
  readonly label: string
  readonly calls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cost: number
}

export interface UsageMetrics {
  readonly calls: number
  /** **口径 = 输入 + 输出**（服务端注释：reasoning / cache 不重复计入）。 */
  readonly totalTokens: number
  /** 估算成本，6 位小数。 */
  readonly estimatedCost: number
  readonly activeOrgs: number
}

export interface UsageReport {
  /** `false` ⇒ 分析库还没抽取过：界面显示「—」而不是 0。 */
  readonly collected: boolean
  /** 数据截至（毫秒）；`null` = 一次都没抽过。 */
  readonly watermark: number | null
  /** 服务端回显的窗口（毫秒，左闭右开）。 */
  readonly from: number
  readonly to: number
  readonly groupBy: GroupBy
  readonly metrics: UsageMetrics
  readonly rows: readonly UsageRow[]
}

export type UsageOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 服务端明确拒绝（4xx）。 */
  | { readonly kind: "rejected"; readonly message: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

export interface UsageQuery {
  /** 毫秒，左闭右开。省略 = 服务端缺省（近 30 天）。 */
  readonly from?: number
  readonly to?: number
  readonly groupBy: GroupBy
}

export interface UsageApi {
  report(query: UsageQuery): Promise<UsageOutcome<UsageReport>>
}

/** 只用到的那一小片 `fetch`（与其他 api 模块同一个形状，便于注入同一个替身）。 */
export type GovernanceFetch = (input: string, init?: RequestInit) => Promise<Response>

const PREFIX = "/openhive/governance/usage-cost"

/** 与内核 `OpenhiveGovernanceUsage.PATH` 逐字对应（刻意不共享，见文件头）。 */
export const PATH = { report: PREFIX } as const

/** 一次请求的上限：与 `account-api.ts` 同值同理由。 */
export const TIMEOUT_MS = 10_000

async function 默认发送(input: string, init?: RequestInit): Promise<Response> {
  const 控制器 = new AbortController()
  const 定时器 = setTimeout(() => 控制器.abort(), TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: 控制器.signal })
  } finally {
    clearTimeout(定时器)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function 数(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

const 是分组 = (value: unknown): value is GroupBy =>
  typeof value === "string" && (GROUP_BY as readonly string[]).includes(value)

/** 每一列都严判：缺一列、类型不对都算 `failed`（不猜默认值）。 */
function 指标(value: unknown): UsageMetrics | undefined {
  if (!isRecord(value)) return undefined
  const { calls, totalTokens, estimatedCost, activeOrgs } = value
  if (!数(calls) || !数(totalTokens) || !数(estimatedCost) || !数(activeOrgs)) return undefined
  return { calls, totalTokens, estimatedCost, activeOrgs }
}

function 行(value: unknown): UsageRow | undefined {
  if (!isRecord(value)) return undefined
  const { key, label, calls, inputTokens, outputTokens, cost } = value
  if (typeof key !== "string" || typeof label !== "string") return undefined
  if (!数(calls) || !数(inputTokens) || !数(outputTokens) || !数(cost)) return undefined
  return { key, label, calls, inputTokens, outputTokens, cost }
}

function 报表(value: unknown): UsageReport | undefined {
  if (!isRecord(value)) return undefined
  const { collected, watermark, from, to, groupBy } = value
  if (typeof collected !== "boolean") return undefined
  if (watermark !== null && !数(watermark)) return undefined
  if (!数(from) || !数(to) || !是分组(groupBy)) return undefined
  const metrics = 指标(value["metrics"])
  if (!metrics) return undefined
  if (!Array.isArray(value["rows"])) return undefined
  const rows: UsageRow[] = []
  for (const item of value["rows"]) {
    const row = 行(item)
    if (!row) return undefined
    rows.push(row)
  }
  return { collected, watermark, from, to, groupBy, metrics, rows }
}

function 消息(body: unknown, response: Response): string {
  if (isRecord(body) && typeof body["error"] === "string" && body["error"].length > 0) return body["error"]
  return `读取失败（HTTP ${response.status}）`
}

/** 服务端窗口是左闭右开；这里只负责把可选参数拼进查询串（`URLSearchParams` 负责转义）。 */
export function 查询串(query: UsageQuery): string {
  const params = new URLSearchParams()
  if (query.from !== undefined) params.set("from", String(query.from))
  if (query.to !== undefined) params.set("to", String(query.to))
  params.set("groupBy", query.groupBy)
  return `${PATH.report}?${params.toString()}`
}

interface 取回成功 {
  readonly kind: "ok"
  readonly response: Response
  readonly body: unknown
}

async function 取回(send: GovernanceFetch, input: string): Promise<取回成功 | { kind: "failed"; message: string }> {
  let response: Response
  try {
    response = await send(input)
  } catch {
    return { kind: "failed", message: "连接服务失败，请检查网络后重试" }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  return { kind: "ok", response, body }
}

/** 建一份客户端。`send` 省略 = 真实 `fetch` ＋ 超时（测试注入替身）。 */
export function createUsageApi(send: GovernanceFetch = 默认发送): UsageApi {
  return {
    report: async (query) => {
      const result = await 取回(send, 查询串(query))
      if (result.kind === "failed") return result
      const { response, body } = result
      if (response.status === 401) return { kind: "rejected", message: "登录状态已失效，请重新登录" }
      if (response.status >= 500) return { kind: "failed", message: 消息(body, response) }
      if (!response.ok) return { kind: "rejected", message: 消息(body, response) }

      const value = 报表(body)
      if (value === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
      return { kind: "ok", value }
    },
  }
}
