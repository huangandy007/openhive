/**
 * AI 资产治理的前端客户端（010 T007 / FR-006）。
 *
 * 与 `account-api.ts` / `org-api.ts` 同一套范式：**同源相对路径**、可注入的 `send`、Outcome 三态
 * （ok / rejected / failed）、严格解析、10 秒超时。理由不重述，见 `account-api.ts` 文件头。
 *
 * ## 两个出口，一份契约
 *
 * - `list`：治理后台看的是**全量**（草稿也在），与使用者的可见面不是一回事——过滤只在
 *   状态 / 类型 / 关键字上，不做可见性收敛（那是服务端的读出口）。
 * - `transition`：回的是**流转后的那一行**。前端据此替换本地行，不猜新状态。
 *
 * ## 状态与动作的闭集在这里也写一份
 *
 * 与 `packages/opencode/src/server/openhive/governance-assets.ts` 的闭集逐字对应，**刻意不共享**
 * （前端不 import 内核源码，`#003-05`）。漂了不会静默：服务端对未知值回 400，前端会把它当
 * 「拒绝」显示出来。
 */

/** 7 状态（与 009 的 `ASSET_STATUSES` 逐字相同）。 */
export const ASSET_STATUSES = [
  "draft",
  "in_review",
  "pending_tech",
  "published",
  "iterating",
  "offline",
  "archived",
] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]

export const ASSET_TYPES = ["skill", "mcp", "knowledge_base"] as const
export type AssetType = (typeof ASSET_TYPES)[number]

export const ASSET_VISIBILITIES = ["global", "department", "targeted", "personal"] as const
export type AssetVisibility = (typeof ASSET_VISIBILITIES)[number]

/** 治理后台能执行的动作（与内核白名单逐字相同；作者动作不在这里）。 */
export const GOVERNANCE_ACTIONS = [
  "approve_business",
  "reject_business",
  "publish_tech",
  "publish_iteration",
  "take_offline",
  "bring_online",
  "archive",
] as const
export type GovernanceAction = (typeof GOVERNANCE_ACTIONS)[number]

export const STATUS_LABELS: Record<AssetStatus, string> = {
  draft: "草稿",
  in_review: "待业务审核",
  pending_tech: "待技术发布",
  published: "已发布",
  iterating: "迭代中",
  offline: "已下线",
  archived: "已归档",
}

export const TYPE_LABELS: Record<AssetType, string> = {
  skill: "Skill",
  mcp: "MCP",
  knowledge_base: "知识库",
}

/** 服务端 `AssetMetadata` 中本页用到的那些列（其余列前端不猜、也不展示）。 */
export interface AssetRow {
  readonly id: string
  readonly name: string
  readonly type: AssetType
  readonly status: AssetStatus
  readonly visibility: AssetVisibility
  readonly department: string
  readonly ownerName: string
  readonly version: number
  readonly updatedAt: number
  readonly publishedAt: number | null
  /**
   * 业务分类 id（需求 2）。库里存的是 id，**名字要另查**（`CategoryAdminApi.list`）——
   * 这里若也存名字，就是第二份真相（`#002-06`）：管理员改名后后台仍显示旧名。
   */
  readonly category: string
}

export interface AssetQuery {
  readonly status?: AssetStatus
  readonly type?: AssetType
  readonly q?: string
}

export type AssetOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 服务端明确拒绝（4xx）。`field` 只在字段校验失败时出现。 */
  | { readonly kind: "rejected"; readonly message: string; readonly field?: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

/**
 * 授权组（需求 3b）：「指定人员」发布时可选的那份名单。
 *
 * 只有这三个字段——弹窗只需要「勾哪个、叫什么、发给几个人」。组里具体是谁属于账号 / 组织
 * 那套接口的事，同一个人名出现在这里不会帮用户判断任何事。
 */
export interface AssetGroup {
  readonly id: string
  readonly name: string
  readonly memberCount: number
}

export interface AssetApi {
  list(query?: AssetQuery): Promise<AssetOutcome<readonly AssetRow[]>>
  /**
   * 流转一份资产。`reason` 只在 `reject_business` 上是必填——其它动作也可以带（不是驳回专属）；
   * 发布类动作可带 `visibility`（本部门 / 全局），个人资产发布时必填。
   *
   * 回包里的 `notice` **只**出现在「状态已变、站内信没写进去」那条罕见路径上：有就提示用户，
   * 但动作本身已经生效，不要当成失败。
   *
   * 刻意**不**新造 `PublishScope` 这个名字：`asset-service/storage.ts` 里已经有一个同名的
   * 存储入参类型（`{visibility, department}`），两个意思不同、不该同名。
   */
  transition(
    id: string,
    action: GovernanceAction,
    reason?: string,
    visibility?: "department" | "global" | "targeted",
    groupIds?: readonly string[],
  ): Promise<AssetOutcome<{ readonly asset: AssetRow; readonly notice?: string }>>
  /**
   * 授权组清单（需求 3b）：发布为「指定人员」时弹窗里的可选项。
   *
   * 只读、无参数、不分页——授权组是管理员手工维护的小集合（一个专案组、一个专班），
   * 不存在翻到第二页才找得到的情况。形状不对照旧算 `failed`，不当空列表。
   */
  listGroups(): Promise<AssetOutcome<readonly AssetGroup[]>>
  /**
   * 把一批资产挪到某个**启用**分类（需求 2）：管理员收拾「其他」兜底桶的收尾动作。
   *
   * 服务端整批原子——有一个 id 不存在就 404、一个都不写。回包只有 `updated`（真改了几条）：
   * 重复提交同一批 ⇒ `updated = 0`，不是失败。
   */
  batchCategory(ids: readonly string[], category: string): Promise<AssetOutcome<{ readonly updated: number }>>
}

/** 只用到的那一小片 `fetch`（类型与 `GovernanceFetch` 逐字相同，便于注入同一个替身）。 */
export type GovernanceFetch = (input: string, init?: RequestInit) => Promise<Response>

const PREFIX = "/openhive/governance/assets"

/** 与内核 `OpenhiveGovernanceAssets.PATH` 逐字对应（刻意不共享，见文件头）。 */
export const PATH = {
  list: PREFIX,
  transition: (id: string) => `${PREFIX}/${encodeURIComponent(id)}/transition`,
  /** 需求 2：批量改分类。与内核 `PATH.batchCategory` 逐字对应（刻意不共享）。 */
  batchCategory: `${PREFIX}/batch-category`,
  /** 需求 3b：授权组清单。与内核 `OpenhiveGovernanceAssetGroups.PATH.list` 逐字对应。 */
  groups: "/openhive/governance/asset-groups",
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

function 闭集<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
}

/** 每一列都严判：缺一列、类型不对、枚举越界都算 `failed`（不猜默认值）。 */
function 行(value: unknown): AssetRow | undefined {
  if (!isRecord(value)) return undefined
  const { id, name, type, status, visibility, department, ownerName, version, updatedAt, publishedAt, category } =
    value
  if (typeof id !== "string" || typeof name !== "string") return undefined
  if (typeof department !== "string" || typeof ownerName !== "string") return undefined
  if (!闭集(ASSET_TYPES, type) || !闭集(ASSET_STATUSES, status) || !闭集(ASSET_VISIBILITIES, visibility)) return undefined
  if (!数(version) || !数(updatedAt)) return undefined
  if (publishedAt !== null && !数(publishedAt)) return undefined
  // 分类 id 是 NOT NULL 的列：缺了就是形状变了（批量改分类的「原分类」要读它）。
  if (typeof category !== "string") return undefined
  return { id, name, type, status, visibility, department, ownerName, version, updatedAt, publishedAt, category }
}

function 列表(value: unknown): readonly AssetRow[] | undefined {
  if (!isRecord(value) || !Array.isArray(value["assets"])) return undefined
  const parsed: AssetRow[] = []
  for (const item of value["assets"]) {
    const row = 行(item)
    if (!row) return undefined
    parsed.push(row)
  }
  return parsed
}

function 流转结果(value: unknown): { readonly asset: AssetRow; readonly notice?: string } | undefined {
  if (!isRecord(value)) return undefined
  const asset = 行(value["asset"])
  if (!asset) return undefined
  const notice = value["notice"]
  if (notice !== undefined && typeof notice !== "string") return undefined
  return notice === undefined ? { asset } : { asset, notice }
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
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  return { kind: "ok", response, body }
}

function 错误结论(result: 取回成功): AssetOutcome<never> | undefined {
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
): Promise<AssetOutcome<T>> {
  const result = await 取回(send, input, init)
  if (result.kind === "failed") return result
  const 错误 = 错误结论(result)
  if (错误) return 错误
  const value = 解析(result.body)
  if (value === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
  return { kind: "ok", value }
}

/** 拼查询串：`undefined` / 空串都不进 URL（服务端把空串当「没传」也一样，但别让地址栏脏）。 */
export function 列表地址(query: AssetQuery = {}): string {
  const params = new URLSearchParams()
  if (query.status !== undefined) params.set("status", query.status)
  if (query.type !== undefined) params.set("type", query.type)
  if (query.q !== undefined && query.q.trim() !== "") params.set("q", query.q.trim())
  const 串 = params.toString()
  return 串 === "" ? PATH.list : `${PATH.list}?${串}`
}

/** 授权组清单：`{ groups: [{ id, name, memberCount }] }`，逐项严判（`memberCount` 不能是字符串）。 */
function 授权组清单(value: unknown): readonly AssetGroup[] | undefined {
  if (!isRecord(value) || !Array.isArray(value["groups"])) return undefined
  const parsed: AssetGroup[] = []
  for (const item of value["groups"]) {
    if (!isRecord(item)) return undefined
    const { id, name, memberCount } = item
    if (typeof id !== "string" || typeof name !== "string" || !数(memberCount)) return undefined
    parsed.push({ id, name, memberCount })
  }
  return parsed
}

/** 批量改分类的回包：`{ updated }`，缺了 / 不是数字都算形状变了（不能当 0 条蒙混）。 */
function 批量结果(value: unknown): { readonly updated: number } | undefined {
  if (!isRecord(value) || !数(value["updated"])) return undefined
  return { updated: value["updated"] }
}

/** 建一份客户端。`send` 省略 = 真实 `fetch` ＋ 超时（测试注入替身）。 */
export function createAssetApi(send: GovernanceFetch = 默认发送): AssetApi {
  return {
    list: (query) => 请求(send, 列表地址(query), undefined, 列表),
    transition: (id, action, reason, visibility, groupIds) =>
      请求(send, PATH.transition(id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          ...(reason === undefined ? {} : { reason }),
          ...(visibility === undefined ? {} : { visibility }),
          // 空数组不带：服务端把「给了 groupIds 却不是 targeted」当 400，别自己造一个。
          ...(groupIds === undefined || groupIds.length === 0 ? {} : { groupIds: [...groupIds] }),
        }),
      }, 流转结果),
    listGroups: () => 请求(send, PATH.groups, undefined, 授权组清单),
    batchCategory: (ids, category) =>
      请求(
        send,
        PATH.batchCategory,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: [...ids], category }),
        },
        批量结果,
      ),
  }
}
