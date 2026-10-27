/**
 * 【保留的定制 · 同步上游时不要丢】业务分类**管理面**的前端客户端（需求 4，2026-10-27）。
 *
 * 与 `asset-api.ts` 同一套范式：同源相对路径、可注入的 `send`、Outcome 三态、严格解析、
 * 10 秒超时（理由见 `account-api.ts` 文件头）。
 *
 * ## 没有删除
 *
 * 服务端没有删除出口（资产行的 `category` 存 id，删掉分类行会让那批资产指向查不到的名字），
 * 客户端因此也**不提供** `remove`。要「别再让人选」就 `update(id, { enabled: false })`。
 *
 * ## 编辑走 POST 子路径
 *
 * `POST /openhive/governance/categories/<id>`，载荷只带**要改的字段**。服务端对空补丁回 400
 * ——「点了保存但什么都没改」与「保存成功」在审计里必须长得不一样，所以本客户端也**不发空补丁**。
 *
 * ## 路径与闭集另写一份（`#003-05`）
 *
 * 与内核 `OpenhiveGovernanceCategories.PATH` 逐字对应，**刻意不共享**：前端不 import 内核源码。
 */

/** 管理面的一行（比使用面多三列：顺序 / 启停 / 是否内置）。 */
export interface CategoryAdminRow {
  readonly id: string
  readonly name: string
  readonly sortOrder: number
  readonly enabled: boolean
  readonly builtin: boolean
}

export type CategoryAdminOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 服务端明确拒绝（4xx），`field` 指向出问题的字段（若有）。 */
  | { readonly kind: "rejected"; readonly message: string; readonly field?: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

/** 编辑补丁：只带要改的字段（服务端对空补丁回 400）。 */
export interface CategoryPatch {
  readonly name?: string
  readonly sortOrder?: number
  readonly enabled?: boolean
}

export type CategoryFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface CategoryAdminApi {
  /** 列表**含停用项**（停用过的分类在后台要看得见，否则再也启不回来）。 */
  list(): Promise<CategoryAdminOutcome<readonly CategoryAdminRow[]>>
  create(input: { readonly name: string; readonly sortOrder?: number }): Promise<CategoryAdminOutcome<CategoryAdminRow>>
  /** `id` 由服务端生成，改名不换 id。 */
  update(id: string, patch: CategoryPatch): Promise<CategoryAdminOutcome<CategoryAdminRow>>
}

/** 与内核 `OpenhiveGovernanceCategories.PATH` 逐字对应。 */
const PREFIX = "/openhive/governance/categories"
export const PATH = {
  list: PREFIX,
  create: PREFIX,
  edit: (id: string) => `${PREFIX}/${encodeURIComponent(id)}`,
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

/** 每一列都严判：缺列 / 类型不对都算形状变了，不猜默认值。 */
function 行(value: unknown): CategoryAdminRow | undefined {
  if (!isRecord(value)) return undefined
  const { id, name, sortOrder, enabled, builtin } = value
  if (typeof id !== "string" || id === "" || typeof name !== "string" || name === "") return undefined
  if (typeof sortOrder !== "number" || !Number.isFinite(sortOrder)) return undefined
  if (typeof enabled !== "boolean" || typeof builtin !== "boolean") return undefined
  return { id, name, sortOrder, enabled, builtin }
}

function 列表(value: unknown): readonly CategoryAdminRow[] | undefined {
  if (!isRecord(value) || !Array.isArray(value["categories"])) return undefined
  const parsed: CategoryAdminRow[] = []
  for (const item of value["categories"]) {
    const row = 行(item)
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

async function 请求<T>(
  send: CategoryFetch,
  input: string,
  init: RequestInit | undefined,
  parse: (body: unknown) => T | undefined,
): Promise<CategoryAdminOutcome<T>> {
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

  if (response.status === 401) return { kind: "rejected", message: "登录状态已失效，请重新登录" }
  if (response.status >= 500) return { kind: "failed", message: 消息(body, response) }
  if (!response.ok) {
    const field = 字段(body)
    return field === undefined
      ? { kind: "rejected", message: 消息(body, response) }
      : { kind: "rejected", message: 消息(body, response), field }
  }

  const value = parse(body)
  if (value === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
  return { kind: "ok", value }
}

/** 建一份客户端。`send` 省略 = 真实 `fetch` ＋ 超时（测试注入替身）。 */
export function createCategoryAdminApi(send: CategoryFetch = 默认发送): CategoryAdminApi {
  return {
    list: () => 请求(send, PATH.list, undefined, 列表),
    create: (input) =>
      请求(
        send,
        PATH.create,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            input.sortOrder === undefined ? { name: input.name } : { name: input.name, sortOrder: input.sortOrder },
          ),
        },
        行,
      ),
    update: (id, patch) =>
      请求(
        send,
        PATH.edit(id),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
        行,
      ),
  }
}
