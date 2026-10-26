/**
 * 模板库的前端客户端（010 T011 / FR-010）。
 *
 * 与 `org-api.ts` 同一套范式：**同源相对路径**、可注入的 `send`、Outcome 三态
 * （ok / rejected / failed）、严格解析、10 秒超时。理由不重述，见 `account-api.ts` 文件头。
 *
 * ## 为什么停用也回整行
 *
 * 服务端四个出口**都回模板行**（新建 201 / 编辑 200 / 停用 200）。前端因此不需要「猜」停用后
 * 那一行长什么样——停用的 `updatedAt` / `updatedBy` 都会变，本地造一份必然漂。
 *
 * ## 三类模板的文案在这层
 *
 * `TEMPLATE_KIND_LABELS` 是**界面文案**，与内核 `TEMPLATE_KINDS` 的键逐字对应；
 * 分段控件与「新建」抽屉的类型选择都读它，不在两处各写一份中文。
 */

export const TEMPLATE_KINDS = ["report", "graph", "metric"] as const
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]

/** 分段控件的文字。键集合与内核 `TEMPLATE_KINDS` 逐字相同。 */
export const TEMPLATE_KIND_LABELS: Readonly<Record<TemplateKind, string>> = {
  report: "报告模板",
  graph: "图谱样式",
  metric: "报表口径",
}

export const TEMPLATE_STATUSES = ["active", "disabled"] as const
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]

/** 服务端 `TemplateRow` 的镜像（全部 camelCase）。 */
export interface TemplateRow {
  readonly id: string
  readonly kind: TemplateKind
  readonly name: string
  readonly scope: string
  readonly content: string
  readonly status: TemplateStatus
  readonly createdBy: string
  readonly createdAt: number
  readonly updatedBy: string
  readonly updatedAt: number
  /** 更新人姓名；账号已清理时为空串（由界面写成「已注销用户」）。 */
  readonly updatedByName: string
  readonly updatedByPoliceNo: string
}

export interface NewTemplate {
  readonly kind: TemplateKind
  readonly name: string
  readonly scope: string
  readonly content: string
}

export interface TemplatePatch {
  readonly name?: string
  readonly scope?: string
  readonly content?: string
}

export type TemplateOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 服务端明确拒绝（4xx）。`field` 只在字段校验失败时出现。 */
  | { readonly kind: "rejected"; readonly message: string; readonly field?: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

export interface TemplateApi {
  list(kind?: TemplateKind): Promise<TemplateOutcome<readonly TemplateRow[]>>
  create(input: NewTemplate): Promise<TemplateOutcome<TemplateRow>>
  update(id: string, patch: TemplatePatch): Promise<TemplateOutcome<TemplateRow>>
  /** 停用（服务端幂等：重复调用不报错，也不刷 `updatedAt`）。 */
  disable(id: string): Promise<TemplateOutcome<TemplateRow>>
}

/** 只用到的那一小片 `fetch`（类型与 `GovernanceFetch` 逐字相同，便于注入同一个替身）。 */
export type GovernanceFetch = (input: string, init?: RequestInit) => Promise<Response>

const PREFIX = "/openhive/governance/templates"

/** 与内核 `OpenhiveGovernanceTemplates.PATH` 逐字对应（刻意不共享，见 `account-api.ts` 文件头）。 */
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  edit: (id: string) => `${PREFIX}/${encodeURIComponent(id)}`,
  disable: (id: string) => `${PREFIX}/${encodeURIComponent(id)}/disable`,
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

function 是类型(value: unknown): value is TemplateKind {
  return typeof value === "string" && (TEMPLATE_KINDS as readonly string[]).includes(value)
}

function 是状态(value: unknown): value is TemplateStatus {
  return typeof value === "string" && (TEMPLATE_STATUSES as readonly string[]).includes(value)
}

/** 每一列都严判：缺一列、类型不对、`kind` / `status` 越界都算形状不对。 */
function 模板(value: unknown): TemplateRow | undefined {
  if (!isRecord(value)) return undefined
  const {
    id,
    kind,
    name,
    scope,
    content,
    status,
    createdBy,
    createdAt,
    updatedBy,
    updatedAt,
    updatedByName,
    updatedByPoliceNo,
  } = value
  if (typeof id !== "string" || typeof name !== "string") return undefined
  if (!是类型(kind) || !是状态(status)) return undefined
  if (typeof scope !== "string" || typeof content !== "string") return undefined
  if (typeof createdBy !== "string" || typeof updatedBy !== "string") return undefined
  if (!数(createdAt) || !数(updatedAt)) return undefined
  if (typeof updatedByName !== "string" || typeof updatedByPoliceNo !== "string") return undefined
  return {
    id,
    kind,
    name,
    scope,
    content,
    status,
    createdBy,
    createdAt,
    updatedBy,
    updatedAt,
    updatedByName,
    updatedByPoliceNo,
  }
}

function 列表(value: unknown): readonly TemplateRow[] | undefined {
  if (!isRecord(value) || !Array.isArray(value["templates"])) return undefined
  const parsed: TemplateRow[] = []
  for (const item of value["templates"]) {
    const row = 模板(item)
    if (!row) return undefined
    parsed.push(row)
  }
  return parsed
}

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

function 错误结论(result: 取回成功): TemplateOutcome<never> | undefined {
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
): Promise<TemplateOutcome<T>> {
  const result = await 取回(send, input, init)
  if (result.kind === "failed") return result
  const 错误 = 错误结论(result)
  if (错误) return 错误
  const value = 解析(result.body)
  if (value === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
  return { kind: "ok", value }
}

/** 建一份客户端。`send` 省略 = 真实 `fetch` ＋ 超时（测试注入替身）。 */
export function createTemplateApi(send: GovernanceFetch = 默认发送): TemplateApi {
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  return {
    list: (kind) =>
      请求(
        send,
        kind === undefined ? PATH.list : `${PATH.list}?kind=${encodeURIComponent(kind)}`,
        undefined,
        列表,
      ),
    create: (input) => 请求(send, PATH.create, json(input), 模板),
    update: (id, patch) => 请求(send, PATH.edit(id), json(patch), 模板),
    disable: (id) => 请求(send, PATH.disable(id), { method: "POST" }, 模板),
  }
}
