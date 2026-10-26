/**
 * 组织架构的前端客户端（010 T006 / FR-005）。
 *
 * 与 `account-api.ts` 同一套范式：**同源相对路径**、可注入的 `send`、Outcome 三态
 * （ok / rejected / failed）、严格解析、10 秒超时。理由不重述，见该文件头。
 *
 * ## 这层只搬形状，不建树
 *
 * 服务端给的是**扁平列表**（每项自带 `path` / `childCount` / `accountCount`）。分组成父子结构
 * 是界面的事——但那件事在 `org-tree.tsx` 里也只做一次（`平铺行`），不在这里预排好，
 * 否则「点开某个节点」与「渲染整棵树」会各拿一份顺序，漂了不报错（`#002-06`）。
 *
 * ## 写出口的 `204`
 *
 * 改名与删除都回**空体** 204：改名的结果必须重拉整棵树（账号数可能变、名字也变了），
 * 客户端不猜新名字，也不在本地改那一行。
 */

/** 树的节点（服务端 `OrgNode` 的镜像）。`path` 是从根到自己的名字序列。 */
export interface OrgNodeRow {
  readonly id: string
  readonly parentId: string | null
  /** 1 = 单位 / 2 = 部门 / 3 = 科室（服务端闭集）。 */
  readonly level: 1 | 2 | 3
  readonly name: string
  readonly path: readonly string[]
  readonly childCount: number
  readonly accountCount: number
  readonly createdAt: number
}

export interface NewOrgNode {
  /** `null` = 建根节点（单位）。 */
  readonly parentId: string | null
  readonly name: string
}

export type OrgOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 服务端明确拒绝（4xx）。`field` 只在字段校验失败时出现。 */
  | { readonly kind: "rejected"; readonly message: string; readonly field?: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

export interface OrgApi {
  tree(): Promise<OrgOutcome<readonly OrgNodeRow[]>>
  create(input: NewOrgNode): Promise<OrgOutcome<OrgNodeRow>>
  rename(id: string, name: string): Promise<OrgOutcome<void>>
  remove(id: string): Promise<OrgOutcome<void>>
  importFromAccounts(): Promise<OrgOutcome<{ created: number }>>
}

/** 只用到的那一小片 `fetch`（同 `GovernanceFetch`，类型逐字相同以便注入同一个替身）。 */
export type GovernanceFetch = (input: string, init?: RequestInit) => Promise<Response>

const PREFIX = "/openhive/governance/org"

/** 与内核 `OpenhiveGovernanceOrg.PATH` 逐字对应（刻意不共享，见 `account-api.ts` 文件头）。 */
export const PATH = {
  tree: `${PREFIX}/tree`,
  nodes: `${PREFIX}/nodes`,
  rename: (id: string) => `${PREFIX}/nodes/${encodeURIComponent(id)}/rename`,
  node: (id: string) => `${PREFIX}/nodes/${encodeURIComponent(id)}`,
  import: `${PREFIX}/import`,
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

function 层级(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3
}

/** 每一项都按形状严判：缺一列、类型不对、`level` 越界都算 `failed`。 */
function 节点(value: unknown): OrgNodeRow | undefined {
  if (!isRecord(value)) return undefined
  const { id, parentId, level, name, path, childCount, accountCount, createdAt } = value
  if (typeof id !== "string" || typeof name !== "string") return undefined
  if (parentId !== null && typeof parentId !== "string") return undefined
  if (!层级(level)) return undefined
  if (!Array.isArray(path) || path.some((part) => typeof part !== "string")) return undefined
  if (!数(childCount) || !数(accountCount) || !数(createdAt)) return undefined
  return { id, parentId, level, name, path, childCount, accountCount, createdAt }
}

function 树(value: unknown): readonly OrgNodeRow[] | undefined {
  if (!isRecord(value) || !Array.isArray(value["nodes"])) return undefined
  const parsed: OrgNodeRow[] = []
  for (const item of value["nodes"]) {
    const row = 节点(item)
    if (!row) return undefined
    parsed.push(row)
  }
  return parsed
}

function 导入结果(value: unknown): { created: number } | undefined {
  if (!isRecord(value) || !数(value["created"])) return undefined
  return { created: value["created"] }
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

function 错误结论(result: 取回成功): OrgOutcome<never> | undefined {
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
): Promise<OrgOutcome<T>> {
  const result = await 取回(send, input, init)
  if (result.kind === "failed") return result
  const 错误 = 错误结论(result)
  if (错误) return 错误
  const value = 解析(result.body)
  if (value === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
  return { kind: "ok", value }
}

/** 204 出口（改名 / 删除）：没有体可解析，2xx 即成功。 */
async function 请求空(send: GovernanceFetch, input: string, init?: RequestInit): Promise<OrgOutcome<void>> {
  const result = await 取回(send, input, init)
  if (result.kind === "failed") return result
  const 错误 = 错误结论(result)
  if (错误) return 错误
  return { kind: "ok", value: undefined }
}

/** 建一份客户端。`send` 省略 = 真实 `fetch` ＋ 超时（测试注入替身）。 */
export function createOrgApi(send: GovernanceFetch = 默认发送): OrgApi {
  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  return {
    tree: () => 请求(send, PATH.tree, undefined, 树),
    create: (input) => 请求(send, PATH.nodes, json(input), 节点),
    rename: (id, name) => 请求空(send, PATH.rename(id), json({ name })),
    remove: (id) => 请求空(send, PATH.node(id), { method: "DELETE" }),
    importFromAccounts: () => 请求(send, PATH.import, { method: "POST" }, 导入结果),
  }
}
