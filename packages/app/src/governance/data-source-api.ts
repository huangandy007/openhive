/**
 * 数据源配置的前端客户端（010 T012 / FR-011 / US6）。
 *
 * 与 `template-api.ts` / `org-api.ts` 同一套范式：**同源相对路径**、可注入的 `send`、
 * Outcome 三态（ok / rejected / failed）、严格解析、10 秒超时。理由不重述，见 `account-api.ts` 文件头。
 *
 * ## 路径与类型闭集在前端各写一份
 *
 * 内核 `@opencode-ai/auth/data-source` 的 `DATA_SOURCE_KINDS` / `FREQUENCIES` / `STATUSES`
 * 与这里的常量**刻意不共享**（前端不 import 内核源码；测试也不 import `PATH`——`#003-05`）。
 * 漂了不会静默：服务端对越界值回 400，这里显示成「拒绝」。
 *
 * ## 没有口令字段
 *
 * v1 只收**非秘密**的连接信息（连接地址 / 库名）。这一层连「secret」这个词都不出现：
 * 不转发、不解析、不留位。connector 落地前没有同步，所以 `lastSyncedAt` 恒为 null，
 * 解析时**原样**保留 null（不是 0，也不是当前时间——那会让「未同步」看起来像「刚同步」）。
 */

/** 类型闭集：与内核 `DATA_SOURCE_KINDS` 逐字相同。 */
export const DATA_SOURCE_KINDS = ["database", "file", "api"] as const
export type DataSourceKind = (typeof DATA_SOURCE_KINDS)[number]

export const KIND_LABELS: Record<DataSourceKind, string> = {
  database: "数据库",
  file: "文件",
  api: "接口",
}

/** 更新频率闭集：与内核 `DATA_SOURCE_FREQUENCIES` 逐字相同。 */
export const DATA_SOURCE_FREQUENCIES = ["manual", "hourly", "daily", "weekly"] as const
export type DataSourceFrequency = (typeof DATA_SOURCE_FREQUENCIES)[number]

export const FREQUENCY_LABELS: Record<DataSourceFrequency, string> = {
  manual: "手动上传",
  hourly: "每小时",
  daily: "每天",
  weekly: "每周",
}

export const DATA_SOURCE_STATUSES = ["active", "disabled"] as const
export type DataSourceStatus = (typeof DATA_SOURCE_STATUSES)[number]

export const STATUS_LABELS: Record<DataSourceStatus, string> = {
  active: "启用",
  disabled: "停用",
}

/** 列表 / 详情共用的一行。`lastSyncedAt` 为 null ＝ 从未同步（connector 未落地）。 */
export interface DataSourceRow {
  readonly id: string
  readonly name: string
  readonly kind: DataSourceKind
  readonly endpoint: string
  readonly frequency: DataSourceFrequency
  readonly owner: string
  readonly status: DataSourceStatus
  readonly lastSyncedAt: number | null
  readonly createdBy: string
  readonly createdAt: number
  readonly updatedBy: string
  readonly updatedAt: number
}

/** 血缘里的一个节点（只够画一级缩进列表）。 */
export interface LineageNode {
  readonly id: string
  readonly name: string
  readonly kind: DataSourceKind
  readonly status: DataSourceStatus
}

export interface DataSourceLineage {
  readonly source: DataSourceRow
  readonly upstream: readonly LineageNode[]
  readonly downstream: readonly LineageNode[]
}

export interface NewDataSource {
  readonly name: string
  readonly kind: DataSourceKind
  readonly frequency: DataSourceFrequency
  readonly endpoint?: string
  readonly owner?: string
  readonly status?: DataSourceStatus
  /** 未给 ＝ 不登记血缘；`[]` ＝ 清空（注册时两者等价）。 */
  readonly upstreamIds?: readonly string[]
}

/** 编辑补丁：没给的字段 ＝ 不改；`upstreamIds: []` ＝ 清空血缘。 */
export interface DataSourcePatch {
  readonly name?: string
  readonly kind?: DataSourceKind
  readonly frequency?: DataSourceFrequency
  readonly endpoint?: string
  readonly owner?: string
  readonly status?: DataSourceStatus
  readonly upstreamIds?: readonly string[]
}

export type DataSourceOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 服务端明确拒绝（4xx）。`field` 有值 = 该标在哪个输入项上。 */
  | { readonly kind: "rejected"; readonly message: string; readonly field?: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

export interface DataSourceApi {
  list(): Promise<DataSourceOutcome<readonly DataSourceRow[]>>
  lineage(id: string): Promise<DataSourceOutcome<DataSourceLineage>>
  create(input: NewDataSource): Promise<DataSourceOutcome<DataSourceRow>>
  update(id: string, patch: DataSourcePatch): Promise<DataSourceOutcome<DataSourceRow>>
}

/** 只用到的那一小片 `fetch`（与其他 api 模块同一个形状，便于注入同一个替身）。 */
export type GovernanceFetch = (input: string, init?: RequestInit) => Promise<Response>

const PREFIX = "/openhive/governance/data-sources"

/** 与内核 `OpenhiveGovernanceDataSource.PATH` 逐字对应（刻意不共享，见文件头）。 */
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  one: (id: string) => `${PREFIX}/${encodeURIComponent(id)}`,
} as const

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

function 是文本(value: unknown): value is string {
  return typeof value === "string"
}

const 是类型 = (value: unknown): value is DataSourceKind =>
  typeof value === "string" && (DATA_SOURCE_KINDS as readonly string[]).includes(value)

const 是频率 = (value: unknown): value is DataSourceFrequency =>
  typeof value === "string" && (DATA_SOURCE_FREQUENCIES as readonly string[]).includes(value)

const 是状态 = (value: unknown): value is DataSourceStatus =>
  typeof value === "string" && (DATA_SOURCE_STATUSES as readonly string[]).includes(value)

/** 一行数据源：每一列都严判（见文件头）。`lastSyncedAt` 只接受 null 或数字。 */
function 数据源(value: unknown): DataSourceRow | undefined {
  if (!isRecord(value)) return undefined
  const { id, name, endpoint, owner, lastSyncedAt, createdBy, createdAt, updatedBy, updatedAt } = value
  if (!是文本(id) || !是文本(name) || !是文本(endpoint) || !是文本(owner)) return undefined
  if (!是类型(value["kind"]) || !是频率(value["frequency"]) || !是状态(value["status"])) return undefined
  if (lastSyncedAt !== null && !数(lastSyncedAt)) return undefined
  if (!是文本(createdBy) || !是文本(updatedBy)) return undefined
  if (!数(createdAt) || !数(updatedAt)) return undefined
  return {
    id,
    name,
    kind: value["kind"],
    endpoint,
    frequency: value["frequency"],
    owner,
    status: value["status"],
    lastSyncedAt,
    createdBy,
    createdAt,
    updatedBy,
    updatedAt,
  }
}

/** 血缘节点：只有四列（多给的忽略、少一列算坏）。 */
function 节点(value: unknown): LineageNode | undefined {
  if (!isRecord(value)) return undefined
  const { id, name } = value
  if (!是文本(id) || !是文本(name)) return undefined
  if (!是类型(value["kind"]) || !是状态(value["status"])) return undefined
  return { id, name, kind: value["kind"], status: value["status"] }
}

function 列表(value: unknown): readonly DataSourceRow[] | undefined {
  if (!isRecord(value) || !Array.isArray(value["sources"])) return undefined
  const out: DataSourceRow[] = []
  for (const item of value["sources"]) {
    const parsed = 数据源(item)
    if (!parsed) return undefined
    out.push(parsed)
  }
  return out
}

function 血缘体(value: unknown): DataSourceLineage | undefined {
  if (!isRecord(value)) return undefined
  const source = 数据源(value["source"])
  if (!source) return undefined
  const 一级 = (raw: unknown): LineageNode[] | undefined => {
    if (!Array.isArray(raw)) return undefined
    const out: LineageNode[] = []
    for (const item of raw) {
      const parsed = 节点(item)
      if (!parsed) return undefined
      out.push(parsed)
    }
    return out
  }
  const upstream = 一级(value["upstream"])
  if (!upstream) return undefined
  const downstream = 一级(value["downstream"])
  if (!downstream) return undefined
  return { source, upstream, downstream }
}

function 消息(body: unknown, response: Response): string {
  if (isRecord(body) && 是文本(body["error"]) && body["error"].length > 0) return body["error"]
  return `请求失败（HTTP ${response.status}）`
}

function 字段(body: unknown): string | undefined {
  return isRecord(body) && 是文本(body["field"]) && body["field"].length > 0 ? body["field"] : undefined
}

interface 取回成功 {
  readonly kind: "ok"
  readonly response: Response
  readonly body: unknown
}

async function 取回(send: GovernanceFetch, input: string, init?: RequestInit): Promise<取回成功 | { kind: "failed"; message: string }> {
  let response: Response
  try {
    response = await send(input, init)
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

/** 把一次应答翻成三态里的「拒 / 失败」；成功与否由调用方拿 `response` / `body` 自行判定。 */
function 错误结论(result: 取回成功): DataSourceOutcome<never> | undefined {
  const { response, body } = result
  if (response.status === 401) return { kind: "rejected", message: "登录状态已失效，请重新登录" }
  if (response.status >= 500) return { kind: "failed", message: 消息(body, response) }
  if (!response.ok) {
    const field = 字段(body)
    return field === undefined
      ? { kind: "rejected", message: 消息(body, response) }
      : { kind: "rejected", message: 消息(body, response), field }
  }
  return undefined
}

function 写体(method: string, value: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  }
}

const 格式不对 = { kind: "failed", message: "服务返回的数据格式不对" } as const

/** 建一份客户端。`send` 省略 = 真实 `fetch` ＋ 超时（测试注入替身）。 */
export function createDataSourceApi(send: GovernanceFetch = 默认发送): DataSourceApi {
  return {
    list: async () => {
      const result = await 取回(send, PATH.list)
      if (result.kind === "failed") return result
      const 错误 = 错误结论(result)
      if (错误) return 错误
      const value = 列表(result.body)
      if (value === undefined) return 格式不对
      return { kind: "ok", value }
    },

    lineage: async (id) => {
      const result = await 取回(send, PATH.one(id))
      if (result.kind === "failed") return result
      const 错误 = 错误结论(result)
      if (错误) return 错误
      const value = 血缘体(result.body)
      if (value === undefined) return 格式不对
      return { kind: "ok", value }
    },

    create: async (input) => {
      const result = await 取回(send, PATH.create, 写体("POST", input))
      if (result.kind === "failed") return result
      const 错误 = 错误结论(result)
      if (错误) return 错误
      const value = 数据源(result.body)
      if (value === undefined) return 格式不对
      return { kind: "ok", value }
    },

    update: async (id, patch) => {
      const result = await 取回(send, PATH.one(id), 写体("POST", patch))
      if (result.kind === "failed") return result
      const 错误 = 错误结论(result)
      if (错误) return 错误
      const value = 数据源(result.body)
      if (value === undefined) return 格式不对
      return { kind: "ok", value }
    },
  }
}
