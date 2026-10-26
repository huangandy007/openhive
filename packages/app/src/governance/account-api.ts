/**
 * 账号管理的前端客户端（010 T005 / FR-004）。
 *
 * 与 `auth/gateway.ts` 同一套范式：**同源相对路径**（`/openhive/governance/accounts`）、
 * 可注入的 `send`（测试不必伪造整个 `fetch`）、把 HTTP 形状翻成界面能用的结论。
 *
 * ## 三种结论，不合并
 *
 * - `ok`：服务端答应了，带回值；
 * - `rejected`：服务端**明确拒绝**（4xx），消息原样展示——409 的「该警号已录入」、
 *   「不能停用当前登录的账号」、「系统至少保留一个管理员」都在这一支；
 * - `failed`：根本没说成（网络不通 / 5xx / 返回体不是约定形状）。
 *
 * 后两者在界面上都要显示，但**分开**的理由与登录出口相同：把「服务出错」说成「操作被拒」
 * 会让管理员对着一个其实没问题的输入反复改。
 *
 * ## 路径字面量另写一份，不 import 内核
 *
 * 前端包不 import 内核源码（另一棵依赖树，也会把内核类型拖进构建）。两边各写一份是
 * **线格式契约的两端**；测试里同样写**字面量**，不引这里的常量（`#003-05`：引了就变成
 * 「实现和自己比对」，改错一个字母两边一起错）。
 *
 * ## 列表项与详情分开
 *
 * 列表不吐证件号 / 手机号（服务端就不吐，PII 不每页 50 行地送到前端）；详情才带。
 * 客户端按各自形状解析，不把详情字段塞成可选——**缺了就是形状不对**，而不是「大概是空」。
 */

/** 列表一项（服务端 `AccountListItem` 的镜像；**不含**证件号 / 手机号 / 密码哈希）。 */
export interface AccountRow {
  readonly id: string
  readonly policeNo: string
  readonly name: string
  readonly org: string
  readonly dept: string
  readonly section: string
  readonly status: number
  readonly isAdmin: number
  readonly lastLoginAt: number | null
  readonly lastActiveAt: number | null
  readonly createdAt: number
  readonly deactivatedAt: number | null
}

/** 详情：列表项的列 ＋ 两项 PII（管理员核实身份用）。 */
export interface AccountDetail extends AccountRow {
  readonly idCard: string
  readonly phone: string
}

export interface AccountPage {
  readonly total: number
  readonly enabled: number
  readonly matched: number
  readonly page: number
  readonly pageSize: number
  readonly items: readonly AccountRow[]
}

/** 录入的 8 个字段。**没有 `isAdmin`**——把别人提升为管理员不在本任务的出口里。 */
export interface NewAccount {
  readonly policeNo: string
  readonly name: string
  readonly idCard: string
  readonly phone: string
  readonly org: string
  readonly dept: string
  readonly section: string
  readonly status: number
}

export type AccountOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 服务端明确拒绝（4xx）。`field` 只在录入的字段校验失败时出现。 */
  | { readonly kind: "rejected"; readonly message: string; readonly field?: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

export interface AccountApi {
  list(query?: AccountQuery): Promise<AccountOutcome<AccountPage>>
  detail(id: string): Promise<AccountOutcome<AccountDetail>>
  create(input: NewAccount): Promise<AccountOutcome<{ id: string }>>
  resetPassword(id: string): Promise<AccountOutcome<void>>
  disable(id: string): Promise<AccountOutcome<void>>
  enable(id: string): Promise<AccountOutcome<void>>
  disableMany(ids: readonly string[]): Promise<AccountOutcome<{ disabled: number }>>
}

/** 只用到的那一小片 `fetch`（同 `AuthFetch`）。 */
export type GovernanceFetch = (input: string, init?: RequestInit) => Promise<Response>

const PREFIX = "/openhive/governance/accounts"

/** 与内核 `OpenhiveGovernanceAccounts.PATH` 逐字对应（刻意不共享，见文件头）。 */
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  detail: (id: string) => `${PREFIX}/${encodeURIComponent(id)}`,
  password: (id: string) => `${PREFIX}/${encodeURIComponent(id)}/password`,
  disable: (id: string) => `${PREFIX}/${encodeURIComponent(id)}/disable`,
  enable: (id: string) => `${PREFIX}/${encodeURIComponent(id)}/enable`,
  batchDisable: `${PREFIX}/batch-disable`,
} as const

/** 一次请求的上限：与 `auth/gateway.ts` 同值同理由（本地同源，正常往返是几十毫秒）。 */
export const TIMEOUT_MS = 10_000

export interface AccountQuery {
  readonly q?: string
  readonly zombie?: boolean
  readonly page?: number
  readonly pageSize?: number
}

/**
 * 默认发送：只补一个超时。
 *
 * 浏览器 `fetch` 没有默认超时，内核收了请求却不答（启动中 / 卡住）时界面会永远「加载中」。
 * 到点 abort 再抛出去，由 `取回` 翻成 `failed`。
 */
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

function 可空数(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

/** 列表一项的形状。任何一处不对 ⇒ `undefined`（由调用方归 `failed`，不静默补空串）。 */
function 行(value: unknown): AccountRow | undefined {
  if (!isRecord(value)) return undefined
  const { id, policeNo, name, org, dept, section, status, isAdmin, lastLoginAt, lastActiveAt, createdAt, deactivatedAt } = value
  if (typeof id !== "string" || typeof policeNo !== "string" || typeof name !== "string") return undefined
  if (typeof org !== "string" || typeof dept !== "string" || typeof section !== "string") return undefined
  if (typeof status !== "number" || typeof isAdmin !== "number" || typeof createdAt !== "number") return undefined
  if (!可空数(lastLoginAt) || !可空数(lastActiveAt) || !可空数(deactivatedAt)) return undefined
  return { id, policeNo, name, org, dept, section, status, isAdmin, lastLoginAt, lastActiveAt, createdAt, deactivatedAt }
}

function 详情(value: unknown): AccountDetail | undefined {
  const base = 行(value)
  if (!base || !isRecord(value)) return undefined
  const { idCard, phone } = value
  if (typeof idCard !== "string" || typeof phone !== "string") return undefined
  return { ...base, idCard, phone }
}

function 页(value: unknown): AccountPage | undefined {
  if (!isRecord(value)) return undefined
  const { total, enabled, matched, page, pageSize, items } = value
  if (typeof total !== "number" || typeof enabled !== "number" || typeof matched !== "number") return undefined
  if (typeof page !== "number" || typeof pageSize !== "number") return undefined
  if (!Array.isArray(items)) return undefined
  const 行们: unknown[] = items
  const parsed: AccountRow[] = []
  for (const item of 行们) {
    const row = 行(item)
    if (!row) return undefined
    parsed.push(row)
  }
  return { total, enabled, matched, page, pageSize, items: parsed }
}

function 新账号(value: unknown): { id: string } | undefined {
  if (!isRecord(value) || typeof value["id"] !== "string") return undefined
  return { id: value["id"] }
}

function 停用结果(value: unknown): { disabled: number } | undefined {
  if (!isRecord(value) || typeof value["disabled"] !== "number") return undefined
  return { disabled: value["disabled"] }
}

/** 一句给人看的错误话：服务端的 `error` 优先，兜底带状态码。 */
function 消息(body: unknown, response: Response): string {
  if (isRecord(body) && typeof body["error"] === "string" && body["error"].length > 0) return body["error"]
  return `操作失败（HTTP ${response.status}）`
}

function 字段(body: unknown): string | undefined {
  if (isRecord(body) && typeof body["field"] === "string") return body["field"]
  return undefined
}

interface 取回成功 {
  readonly kind: "ok"
  readonly response: Response
  readonly body: unknown
}

/** 发一次请求并把体读完（读体失败不算成功——空体按 `undefined` 处理，由解析器判形状）。 */
async function 取回(
  send: GovernanceFetch,
  input: string,
  init?: RequestInit,
): Promise<取回成功 | { kind: "failed"; message: string }> {
  let response: Response
  try {
    response = await send(input, init)
  } catch {
    return { kind: "failed", message: "连接服务失败，请检查网络后重试" }
  }

  let body: unknown
  if (response.status !== 204) {
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
  }
  return { kind: "ok", response, body }
}

/**
 * 4xx / 5xx / 401 先翻译（成功路径返回 `undefined`）。
 *
 * 401 与 403 分开说：前者是「登录没了」（去登录），后者是「你没有这个权限」（别白试）。
 */
function 错误结论(result: 取回成功): AccountOutcome<never> | undefined {
  const { response, body } = result
  if (response.status === 401) return { kind: "rejected", message: "登录状态已失效，请重新登录" }
  if (response.status >= 500) return { kind: "failed", message: 消息(body, response) }
  if (!response.ok) return { kind: "rejected", message: 消息(body, response), field: 字段(body) }
  return undefined
}

async function 请求<T>(
  send: GovernanceFetch,
  input: string,
  init: RequestInit | undefined,
  解析: (body: unknown) => T | undefined,
): Promise<AccountOutcome<T>> {
  const result = await 取回(send, input, init)
  if (result.kind === "failed") return result
  const 错误 = 错误结论(result)
  if (错误) return 错误
  const value = 解析(result.body)
  if (value === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
  return { kind: "ok", value }
}

/** 204 出口（重置 / 停用 / 启用）：没有体可解析，2xx 即成功。 */
async function 请求空(
  send: GovernanceFetch,
  input: string,
  init?: RequestInit,
): Promise<AccountOutcome<void>> {
  const result = await 取回(send, input, init)
  if (result.kind === "failed") return result
  const 错误 = 错误结论(result)
  if (错误) return 错误
  return { kind: "ok", value: undefined }
}

function 查询串(query: AccountQuery): string {
  const params = new URLSearchParams()
  const q = query.q?.trim() ?? ""
  if (q) params.set("q", q)
  if (query.zombie) params.set("zombie", "1")
  if (query.page !== undefined) params.set("page", String(query.page))
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize))
  const 串 = params.toString()
  return 串 ? `${PATH.list}?${串}` : PATH.list
}

/** 建一份客户端。`send` 省略 = 真实 `fetch` ＋ 超时（测试注入替身）。 */
export function createAccountApi(send: GovernanceFetch = 默认发送): AccountApi {
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  return {
    list: (query = {}) => 请求(send, 查询串(query), undefined, 页),
    detail: (id) => 请求(send, PATH.detail(id), undefined, 详情),
    create: (input: NewAccount) => 请求(send, PATH.create, json(input), 新账号),
    resetPassword: (id) => 请求空(send, PATH.password(id), { method: "POST" }),
    disable: (id) => 请求空(send, PATH.disable(id), { method: "POST" }),
    enable: (id) => 请求空(send, PATH.enable(id), { method: "POST" }),
    disableMany: (ids) => 请求(send, PATH.batchDisable, json({ ids }), 停用结果),
  }
}
