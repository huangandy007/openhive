/**
 * 审计日志检索的前端客户端（010 T010b / FR-009 / DESIGN §4.11.7）。
 *
 * 与 `account-api.ts` / `usage-cost-api.ts` 同一套范式：**同源相对路径**、可注入的 `send`、
 * Outcome 三态（ok / rejected / failed）、严格解析、10 秒超时。理由不重述，见 `account-api.ts` 文件头。
 *
 * ## 时间单位是**秒**
 *
 * 审计表 `occurred_at` 是 int4 秒；`usage-cost` 的窗口是毫秒。两个端点故意不同——
 * 本模块收发的都是秒，页面里的时间窗预设也按秒算。别把毫秒塞进来（乘一千，窗口歪到空集）。
 *
 * ## 服务端是 snake_case，这里翻成 camelCase
 *
 * 审计行来自裸 SQL（`Audit.listAuditEvents`），字段名就是列名。前端只在这一处翻译一次，
 * 页面里不出现 `occurred_at` 这类下划线名。**每一列都严判**：少一列、类型不对都算 `failed`，
 * 不 Number() 猜、不把 detail 当字符串（`#005-47`：默认值恰好满足断言就成了假绿）。
 *
 * ## 动作与结果的闭集在前端也写一份
 *
 * `AUDIT_ACTIONS` / `AUDIT_RESULTS` 与内核 `@opencode-ai/auth/audit` **刻意不共享**
 * （前端不 import 内核源码，`#003-05`）。漂了不会静默：服务端对未知值回 400，这里把它
 * 当「拒绝」显示；表格对**没有文案的动作**回落成原始 `动作.名`，不隐藏那一行。
 */

/** 结局闭集：与内核 `AUDIT_RESULTS` 逐字相同。 */
export const AUDIT_RESULTS = ["ok", "failed", "denied"] as const
export type AuditResult = (typeof AUDIT_RESULTS)[number]

export const RESULT_LABELS: Record<AuditResult, string> = {
  ok: "成功",
  failed: "失败",
  denied: "拒绝",
}

/**
 * 动作的中文文案。键集合与内核 `AUDIT_ACTIONS` 逐字相同；顺序即筛选下拉的顺序
 * （按板块分组：账号 → 组织 → 资产 → 项目 → 越权）。
 *
 * 表格显示时用 `动作文案()` 回落——库里可能有一行是**旧版本**写的动作词（词表只会加不会删），
 * 未知动作原样显示比显示空白有用。
 */
export const ACTION_LABELS: Readonly<Record<string, string>> = {
  "account.create": "录入账号",
  "account.reset_password": "重置密码",
  "account.disable": "停用账号",
  "account.enable": "启用账号",
  "account.batch_disable": "批量停用",
  "org.create": "新建组织节点",
  "org.rename": "重命名组织节点",
  "org.delete": "删除组织节点",
  "org.import": "从账号导入组织",
  "asset.transition": "资产流转",
  "project.remove_member": "移除项目成员",
  "project.archive": "归档项目",
  "tool.denied": "工具越权",
  "governance.denied": "板块越权",
}

export const ACTION_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = Object.entries(
  ACTION_LABELS,
).map(([value, label]) => ({ value, label }))

export function 动作文案(action: string): string {
  return ACTION_LABELS[action] ?? action
}

/** 结果文案；未知值原样显示（同 `动作文案`）。 */
export function 结果文案(result: string): string {
  return (RESULT_LABELS as Record<string, string | undefined>)[result] ?? result
}

/** 明细表的一行（服务端 snake_case 已翻成 camelCase）。 */
export interface AuditItem {
  readonly id: number
  readonly occurredAt: number
  readonly actorId: string
  readonly actorName: string
  readonly actorPoliceNo: string
  readonly board: string | null
  readonly action: string
  readonly targetType: string | null
  readonly targetId: string | null
  readonly result: AuditResult
  /** 写时快照的结构化补充（**绝不含口令**）。解析失败的行原样在 `{ raw }` 里。 */
  readonly detail: Record<string, unknown>
}

export interface AuditPage {
  /** 筛选后的总行数（不受分页影响）。 */
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly items: readonly AuditItem[]
}

export type AuditOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 服务端明确拒绝（4xx）。 */
  | { readonly kind: "rejected"; readonly message: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

export interface AuditQuery {
  /** 秒，左闭右开。省略 = 服务端缺省（近 7 天）。 */
  readonly from?: number
  readonly to?: number
  /** 操作人姓名或警号的子串。 */
  readonly actor?: string
  readonly action?: string
  readonly result?: AuditResult
  /** 对象 id 或 detail 文本的子串。 */
  readonly q?: string
  readonly page?: number
  readonly pageSize?: number
}

export interface AuditApi {
  list(query: AuditQuery): Promise<AuditOutcome<AuditPage>>
}

/** 只用到的那一小片 `fetch`（与其他 api 模块同一个形状，便于注入同一个替身）。 */
export type GovernanceFetch = (input: string, init?: RequestInit) => Promise<Response>

const PREFIX = "/openhive/governance/audit-log"

/** 与内核 `OpenhiveGovernanceAudit.PATH` 逐字对应（刻意不共享，见文件头）。 */
export const PATH = { list: PREFIX } as const

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

const 是结果 = (value: unknown): value is AuditResult =>
  typeof value === "string" && (AUDIT_RESULTS as readonly string[]).includes(value)

function 可空文本(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === "string" ? value : undefined
}

/** 一行审计：每一列都严判（见文件头）。 */
function 行(value: unknown): AuditItem | undefined {
  if (!isRecord(value)) return undefined
  const { id, occurred_at, actor_id, actor_name, actor_police_no, action, result, detail } = value
  if (!数(id) || !数(occurred_at)) return undefined
  if (typeof actor_id !== "string" || typeof actor_name !== "string" || typeof actor_police_no !== "string") {
    return undefined
  }
  if (typeof action !== "string" || !是结果(result)) return undefined
  const board = 可空文本(value["board"])
  const targetType = 可空文本(value["target_type"])
  const targetId = 可空文本(value["target_id"])
  if (board === undefined || targetType === undefined || targetId === undefined) return undefined
  if (!isRecord(detail)) return undefined
  return {
    id,
    occurredAt: occurred_at,
    actorId: actor_id,
    actorName: actor_name,
    actorPoliceNo: actor_police_no,
    board,
    action,
    targetType,
    targetId,
    result,
    detail,
  }
}

function 页(value: unknown): AuditPage | undefined {
  if (!isRecord(value)) return undefined
  const { total, page, pageSize } = value
  if (!数(total) || !数(page) || !数(pageSize)) return undefined
  if (!Array.isArray(value["items"])) return undefined
  const items: AuditItem[] = []
  for (const item of value["items"]) {
    const parsed = 行(item)
    if (!parsed) return undefined
    items.push(parsed)
  }
  return { total, page, pageSize, items }
}

function 消息(body: unknown, response: Response): string {
  if (isRecord(body) && typeof body["error"] === "string" && body["error"].length > 0) return body["error"]
  return `读取失败（HTTP ${response.status}）`
}

/** 空串 / 纯空白不是筛选条件（`URLSearchParams` 负责转义）。 */
function 填(params: URLSearchParams, key: string, value: string | undefined) {
  const trimmed = value?.trim()
  if (trimmed) params.set(key, trimmed)
}

export function 查询串(query: AuditQuery): string {
  const params = new URLSearchParams()
  if (query.from !== undefined) params.set("from", String(query.from))
  if (query.to !== undefined) params.set("to", String(query.to))
  填(params, "actor", query.actor)
  填(params, "action", query.action)
  填(params, "result", query.result)
  填(params, "q", query.q)
  if (query.page !== undefined) params.set("page", String(query.page))
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize))
  const 串 = params.toString()
  return 串 ? `${PATH.list}?${串}` : PATH.list
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
export function createAuditApi(send: GovernanceFetch = 默认发送): AuditApi {
  return {
    list: async (query) => {
      const result = await 取回(send, 查询串(query))
      if (result.kind === "failed") return result
      const { response, body } = result
      if (response.status === 401) return { kind: "rejected", message: "登录状态已失效，请重新登录" }
      if (response.status >= 500) return { kind: "failed", message: 消息(body, response) }
      if (!response.ok) return { kind: "rejected", message: 消息(body, response) }

      const value = 页(body)
      if (value === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
      return { kind: "ok", value }
    },
  }
}
