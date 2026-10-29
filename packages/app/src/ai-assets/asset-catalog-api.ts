/**
 * AI 资产**使用面**的前端客户端（T017 / 需求 6）。
 *
 * 与 `governance/asset-api.ts` 同一套范式：同源相对路径、可注入的 `send`、Outcome 三态
 * （ok / rejected / failed）、严格解析、10 秒超时。理由见 `account-api.ts` 文件头。
 *
 * ## 与治理客户端不是一回事
 *
 * 治理看**全量**（草稿也在）；这条看「我能用的已发布资产」——服务端已按读者收敛过
 * （可见性走 009 的 `canReadAsset()`，状态只留 `published`）。前端**不再**二次过滤：
 * 两份过滤必然漂，漂了就是「卡片看不见但接口里有」这种查不出来的毛病（`#002-06`）。
 *
 * ## 筛选与分页都在这儿交代（需求 6，2026-10-27）
 *
 * 分页一旦落到服务端，**筛选也必须一起下去**：取回 20 条再在内存里按空间 / 分类筛，
 * 一页筛完可能只剩 3 条，`total` 与实际可见行数对不上，翻页还会跳条——那正是「假分页」。
 * 所以 `spaces` / `category` / `q` 全部进查询串，回来的是**已经筛好、切好**的一页。
 *
 * ## 解析是整份资产，不是挑几列
 *
 * 这些行直接喂给 `<AssetCenter>`，它的卡片与详情读的是 `AssetMetadata` 的十几列。
 * 挑列解析会让缺列变成 `undefined` 静默渲染成空白；整份严判则一次把「服务端形状变了」
 * 变成一条可见的 `failed`。
 */

import type { AssetMetadata, AssetStatus, AssetType, AssetVisibility } from "@opencode-ai/asset-service/metadata"

/** 与内核 `OpenhiveAssets.PATH` 逐字对应（刻意不共享，前端不 import 内核源码，`#003-05`）。 */
export const PATH = { list: "/openhive/assets" } as const

/** 一次请求的上限：与 `account-api.ts` 同值同理由。 */
export const TIMEOUT_MS = 10_000

/**
 * 每页条数白名单——与内核 `paging.ts` 的 `PAGE_SIZES` 逐字相同（**刻意另写一份**：
 * 前端不 import 内核源码，`#003-05`）。服务端对表外值直接 400，两处漂了会当场炸，
 * 而不是静默按别的条数回包。
 */
export const PAGE_SIZES = [20, 50, 100] as const
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0]

/** 服务端闭集（与 009 的 `ASSET_*` 逐字相同，另写一份）。 */
const TYPES = ["skill", "mcp", "knowledge_base"] as const satisfies readonly AssetType[]
const STATUSES = [
  "draft",
  "in_review",
  "pending_tech",
  "published",
  "iterating",
  "offline",
  "archived",
] as const satisfies readonly AssetStatus[]
const VISIBILITIES = ["global", "department", "personal"] as const satisfies readonly AssetVisibility[]

export interface CatalogQuery {
  readonly type?: AssetType
  readonly q?: string
  /** 分类 id；`undefined` = 不按分类收窄。 */
  readonly category?: string
  /** 左栏选中的空间；`undefined` = 不过滤，**空数组** = 空集（由数据源短路，不发请求）。 */
  readonly spaces?: readonly AssetVisibility[]
  readonly page?: number
  readonly pageSize?: number
}

/** 服务端回的一页：行 ＋ 筛选后的总数 ＋ 回显的分页参数 ＋ 本页用到的分类名。 */
export interface CatalogPage {
  readonly assets: readonly AssetMetadata[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  /**
   * 分类 id → 名称（需求 2）：**含停用分类**——「其他」桶里要标原分类，那正是被停用的那一类。
   * 服务端没给就是空表（卡片退回显示 id），不是形状错误。
   */
  readonly categoryNames: Readonly<Record<string, string>>
  /**
   * 本页里**我**收藏过的资产 id（2026-10-29）：收藏态是 per-user 的，所以不进 `AssetMetadata`
   * （那是与治理后台共用的类型，那边没有「当前读者」）。服务端没给就是空数组，不是形状错误。
   */
  readonly favoritedIds: readonly string[]
  /**
   * 最近 N 天的使用统计（2026-10-29）。**省略 = 旧内核没给这个键**：前端不显示这一项，
   * 不是显示 0（`usageStats` 缺失与「没人用过」是两件事）。给了就必须形状正确，否则整页 failed。
   */
  readonly usageStats?: UsageStats
}

export interface UsageStat {
  readonly users: number
  readonly calls: number
}

/**
 * 最近 30 天的使用聚合（2026-10-29）。**只含本页有记录的资产**——没记录的资产不出现，
 * 前端按「还没人用过」渲染（而不是 0 人 0 次）。
 */
export interface UsageStats {
  readonly days: number
  readonly stats: Readonly<Record<string, UsageStat>>
}

export type CatalogOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 服务端明确拒绝（4xx）。 */
  | { readonly kind: "rejected"; readonly message: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

/** 只用到的那一小片 `fetch`（与 `GovernanceFetch` 同形，便于注入同一个替身）。 */
export type CatalogFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface CatalogApi {
  list(query?: CatalogQuery): Promise<CatalogOutcome<CatalogPage>>
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

function 数(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function 闭集<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
}

/** 可空时间戳：`null` 合法、数字合法、其余（含 `undefined`）算形状不对。 */
function 可空时间(value: unknown): number | null | undefined {
  if (value === null) return null
  return 数(value) ? value : undefined
}

/** 每一列都严判：缺一列、类型不对、枚举越界都算 `failed`（不猜默认值）。 */
function 行(value: unknown): AssetMetadata | undefined {
  if (!isRecord(value)) return undefined
  const {
    id,
    name,
    type,
    description,
    icon,
    category,
    tags,
    ownerId,
    ownerName,
    department,
    visibility,
    version,
    status,
    favoriteCount,
    usageCount,
    rating,
    ratingCount,
    feedbackCount,
    createdAt,
    updatedAt,
  } = value
  if (typeof id !== "string" || typeof name !== "string") return undefined
  if (typeof description !== "string" || typeof icon !== "string" || typeof category !== "string") return undefined
  if (typeof ownerId !== "string" || typeof ownerName !== "string" || typeof department !== "string") {
    return undefined
  }
  if (!闭集(TYPES, type) || !闭集(STATUSES, status) || !闭集(VISIBILITIES, visibility)) return undefined
  if (!Array.isArray(tags) || !tags.every((tag): tag is string => typeof tag === "string")) return undefined
  if (!数(version) || !数(favoriteCount) || !数(usageCount)) return undefined
  if (!数(rating) || !数(ratingCount) || !数(feedbackCount)) return undefined
  if (!数(createdAt) || !数(updatedAt)) return undefined
  const publishedAt = 可空时间(value["publishedAt"])
  const archivedAt = 可空时间(value["archivedAt"])
  if (publishedAt === undefined || archivedAt === undefined) return undefined
  return {
    id,
    name,
    type,
    description,
    icon,
    category,
    tags,
    ownerId,
    ownerName,
    department,
    visibility,
    version,
    status,
    favoriteCount,
    usageCount,
    rating,
    ratingCount,
    feedbackCount,
    createdAt,
    updatedAt,
    publishedAt,
    archivedAt,
  }
}

/**
 * 分类名表（需求 2）：省略 = 空表（服务端没给，卡片退回显示 id）；给了就必须是「id → 名字」
 * 的平表——数组 / 字符串 / 值不是字符串的，都算形状变了，不猜。
 */
function 分类名表(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return {}
  if (!isRecord(value)) return undefined
  // 逐键重建而不是断言原对象：断言要在「校验过每个值」与「类型窄化」之间靠人眼对齐，
  // 重建则是类型系统自己认的（oxlint `no-unsafe-type-assertion` 也不放行那种写法）。
  const 名字: Record<string, string> = {}
  for (const [id, name] of Object.entries(value)) {
    if (typeof name !== "string") return undefined
    名字[id] = name
  }
  return 名字
}

/**
 * 「我收藏过的」（2026-10-29）：省略 = 空数组（旧内核没这列，不算形状变了）；给了就必须是
 * 字符串数组——元素类型漂了要当场 `failed`，不能当空数组吞掉：那样「已收藏」会静默变回
 * 「未收藏」，用户点一下才发现是被翻掉了。
 */
function 收藏的(value: unknown): readonly string[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const ids: string[] = []
  for (const id of value) {
    if (typeof id !== "string") return undefined
    ids.push(id)
  }
  return ids
}

type 用量解析 =
  | { readonly kind: "missing" }
  | { readonly kind: "bad" }
  | { readonly kind: "ok"; readonly value: UsageStats }

/** `usageStats`：省略 = missing；给了就逐层严判（days 有限数、stats 是「id → {users,calls}」）。 */
function 解析用量(value: unknown): 用量解析 {
  if (value === undefined) return { kind: "missing" }
  if (!isRecord(value) || !数(value["days"])) return { kind: "bad" }
  const raw = value["stats"]
  if (!isRecord(raw)) return { kind: "bad" }
  const stats: Record<string, UsageStat> = {}
  for (const [id, item] of Object.entries(raw)) {
    if (!isRecord(item) || !数(item["users"]) || !数(item["calls"])) return { kind: "bad" }
    stats[id] = { users: item["users"], calls: item["calls"] }
  }
  return { kind: "ok", value: { days: value["days"], stats } }
}

/** 一页：`assets` 逐行严判，`total / page / pageSize` 必须是有限数字（缺了就是形状变了）。 */
function 一页(value: unknown): CatalogPage | undefined {
  if (!isRecord(value) || !Array.isArray(value["assets"])) return undefined
  const { total, page, pageSize } = value
  if (!数(total) || !数(page) || !数(pageSize)) return undefined
  const categoryNames = 分类名表(value["categoryNames"])
  if (categoryNames === undefined) return undefined
  const favoritedIds = 收藏的(value["favoritedIds"])
  if (favoritedIds === undefined) return undefined
  const 用量 = 解析用量(value["usageStats"])
  if (用量.kind === "bad") return undefined
  const parsed: AssetMetadata[] = []
  for (const item of value["assets"]) {
    const row = 行(item)
    if (!row) return undefined
    parsed.push(row)
  }
  return {
    assets: parsed,
    total,
    page,
    pageSize,
    categoryNames,
    favoritedIds,
    ...(用量.kind === "ok" ? { usageStats: 用量.value } : {}),
  }
}

function 消息(body: unknown, response: Response): string {
  if (isRecord(body) && typeof body["error"] === "string" && body["error"].length > 0) return body["error"]
  return `读取资产失败（HTTP ${response.status}）`
}

/** 拼查询串：`undefined` / 空串都不进 URL；空间用**重复参数**（服务端逐值收窄）。 */
export function 列表地址(query: CatalogQuery = {}): string {
  const params = new URLSearchParams()
  if (query.type !== undefined) params.set("type", query.type)
  if (query.q !== undefined && query.q.trim() !== "") params.set("q", query.q.trim())
  if (query.category !== undefined && query.category !== "") params.set("category", query.category)
  for (const space of query.spaces ?? []) params.append("visibility", space)
  if (query.page !== undefined) params.set("page", String(query.page))
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize))
  const 串 = params.toString()
  return 串 === "" ? PATH.list : `${PATH.list}?${串}`
}

/** 建一份客户端。`send` 省略 = 真实 `fetch` ＋ 超时（测试注入替身）。 */
export function createCatalogApi(send: CatalogFetch = 默认发送): CatalogApi {
  return {
    list: async (query) => {
      let response: Response
      try {
        response = await send(列表地址(query))
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

      const value = 一页(body)
      if (value === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
      return { kind: "ok", value }
    },
  }
}
