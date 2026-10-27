/**
 * 【保留的定制 · 同步上游时不要丢】业务分类的**使用面**前端客户端（需求 4，2026-10-27）。
 *
 * 与 `asset-catalog-api.ts` / `governance/asset-api.ts` 同一套范式：同源相对路径、可注入的
 * `send`、Outcome 三态、严格解析、10 秒超时。理由见 `governance/account-api.ts` 文件头。
 *
 * ## 为什么左栏分类要问服务端
 *
 * 需求 4 之前左栏读的是 `@opencode-ai/asset-service/categories` 的 seed 常量。分类改为管理员
 * 维护之后，再读常量就是「管理员新建 / 改名 / 停用了，用户看不见」——同一件事两份来源，
 * 漂了不报错（`LEARNINGS #002-06`）。所以**删掉了那份常量读法**，唯一来源是内核的
 * `GET /openhive/categories`（只回启用项、已按 `sort_order` 排好）。
 *
 * ## 只认 id 与名字
 *
 * 使用面只需要这两个字段。`sortOrder` / `enabled` / `builtin` 服务端也回，但**校验过就丢**：
 * 前端拿着一份「启用与否」的副本，迟早会有人拿它做判断，而真正说了算的是服务端。
 * 管理面（`governance/category-api.ts`）才保留全部字段。
 */

/** 与内核 `OpenhiveCategories.PATH` 逐字对应（刻意不共享，前端不 import 内核源码，`#003-05`）。 */
export const PATH = { list: "/openhive/categories" } as const

/** 一次请求的上限：与 `account-api.ts` 同值同理由。 */
export const TIMEOUT_MS = 10_000

/** 左栏要用的那一份形状。 */
export interface AssetCategoryRow {
  readonly id: string
  readonly name: string
}

export type CategoryOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 服务端明确拒绝（4xx）。 */
  | { readonly kind: "rejected"; readonly message: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

/** 只用到的那一小片 `fetch`（与 `GovernanceFetch` 同形，便于注入同一个替身）。 */
export type CategoryFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface CategoryApi {
  list(): Promise<CategoryOutcome<readonly AssetCategoryRow[]>>
}

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

/** 每一列都严判（含使用面用不上的三列）：缺列 / 类型不对都算形状变了，不猜默认值。 */
function 行(value: unknown): AssetCategoryRow | undefined {
  if (!isRecord(value)) return undefined
  const { id, name, sortOrder, enabled, builtin } = value
  if (typeof id !== "string" || id === "" || typeof name !== "string" || name === "") return undefined
  if (typeof sortOrder !== "number" || !Number.isFinite(sortOrder)) return undefined
  if (typeof enabled !== "boolean" || typeof builtin !== "boolean") return undefined
  return { id, name }
}

function 列表(value: unknown): readonly AssetCategoryRow[] | undefined {
  if (!isRecord(value) || !Array.isArray(value["categories"])) return undefined
  const parsed: AssetCategoryRow[] = []
  for (const item of value["categories"]) {
    const row = 行(item)
    if (!row) return undefined
    parsed.push(row)
  }
  return parsed
}

function 消息(body: unknown, response: Response): string {
  if (isRecord(body) && typeof body["error"] === "string" && body["error"].length > 0) return body["error"]
  return `读取分类失败（HTTP ${response.status}）`
}

/** 建一份客户端。`send` 省略 = 真实 `fetch` ＋ 超时（测试注入替身）。 */
export function createCategoryApi(send: CategoryFetch = 默认发送): CategoryApi {
  return {
    list: async () => {
      let response: Response
      try {
        response = await send(PATH.list)
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
      if (!response.ok) return { kind: "rejected", message: 消息(body, response) }

      const value = 列表(body)
      if (value === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
      return { kind: "ok", value }
    },
  }
}
