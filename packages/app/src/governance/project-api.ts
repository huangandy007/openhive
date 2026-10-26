/**
 * 数据项目权限的前端客户端（010 T008 / FR-007 / US4）。
 *
 * 与 `account-api.ts` / `org-api.ts` / `asset-api.ts` 同一套范式：**同源相对路径**、可注入的
 * `send`、Outcome 三态（ok / rejected / failed）、严格解析、10 秒超时。理由不重述，
 * 见 `account-api.ts` 文件头。
 *
 * ## 四个出口，一份契约
 *
 * - `list`：治理后台看的是**全部**数据项目（含已归档）——与使用者那份「我参与的」列表不是一回事。
 * - `members`：一个项目的名单（警号 / 姓名 / 角色 / 加入时间）。
 * - `removeMember`：兜底撤销**普通成员**。创建人撤不掉（服务端 409）——那是 005 的不变量
 *   「项目永远有一个 owner」的出口投影，前端不重写这条规则，只把 409 的话原样显示。
 * - `archive`：兜底归档（全员转存备份 → 删沙箱 → 冻结）。
 *
 * ## 角色与类型闭集在这里也写一份
 *
 * 与 `packages/opencode/src/server/openhive/governance-projects.ts` ＋ 005/006 的闭集逐字对应，
 * **刻意不共享**（前端不 import 内核源码，`#003-05`）。漂了不会静默：服务端对未知值回 409/400，
 * 前端把它当「拒绝」显示。
 */

/** 成员角色（005 FR-004：**没有只读角色**）。 */
export const PROJECT_ROLES = ["owner", "member"] as const
export type ProjectRole = (typeof PROJECT_ROLES)[number]

export const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "创建人",
  member: "成员",
}

/** 项目类型（core `PROJECT_TYPES` 的两值；⚠️ 0006 之前建的项目可能没有名字行 ⇒ 服务端给 `""`）。 */
export const PROJECT_TYPE_LABELS: Record<string, string> = {
  private: "私有",
  shared: "共享",
}

/** 列表里的一行（与内核出口逐字段对应）。 */
export interface ProjectRow {
  readonly id: string
  /** 0006 之前建的项目没有名字行 ⇒ `""`（服务端不编名字；这里也不）。 */
  readonly name: string
  /** 同上，可能是 `""`。 */
  readonly type: string
  readonly archived: boolean
  readonly archivedAt: number | null
  readonly ownerId: string | null
  readonly ownerName: string | null
  readonly memberCount: number
}

export interface MemberRow {
  readonly userId: string
  readonly policeNo: string
  readonly name: string
  readonly role: ProjectRole
  readonly timeCreated: number
}

export type ProjectOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 服务端明确拒绝（4xx）。 */
  | { readonly kind: "rejected"; readonly message: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

export interface ProjectApi {
  list(): Promise<ProjectOutcome<readonly ProjectRow[]>>
  members(projectId: string): Promise<ProjectOutcome<readonly MemberRow[]>>
  removeMember(projectId: string, userId: string): Promise<ProjectOutcome<{ readonly removed: string }>>
  archive(projectId: string): Promise<ProjectOutcome<{ readonly archived: true }>>
}

/** 只用到的那一小片 `fetch`（与 `GovernanceFetch` 逐字相同，便于注入同一个替身）。 */
export type GovernanceFetch = (input: string, init?: RequestInit) => Promise<Response>

const PREFIX = "/openhive/governance/projects"

/** 与内核 `OpenhiveGovernanceProjects.PATH` 逐字对应（刻意不共享，见文件头）。 */
export const PATH = {
  list: PREFIX,
  members: (id: string) => `${PREFIX}/${encodeURIComponent(id)}/members`,
  remove: (id: string) => `${PREFIX}/${encodeURIComponent(id)}/members/remove`,
  archive: (id: string) => `${PREFIX}/${encodeURIComponent(id)}/archive`,
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

const 是角色 = (value: unknown): value is ProjectRole =>
  typeof value === "string" && (PROJECT_ROLES as readonly string[]).includes(value)

/** 每一列都严判：缺一列、类型不对都算 `failed`（不猜默认值）。 */
function 项目行(value: unknown): ProjectRow | undefined {
  if (!isRecord(value)) return undefined
  const { id, name, type, archived, archivedAt, ownerId, ownerName, memberCount } = value
  if (typeof id !== "string" || typeof name !== "string" || typeof type !== "string") return undefined
  if (typeof archived !== "boolean") return undefined
  if (archivedAt !== null && !数(archivedAt)) return undefined
  if (ownerId !== null && typeof ownerId !== "string") return undefined
  if (ownerName !== null && typeof ownerName !== "string") return undefined
  if (!数(memberCount)) return undefined
  return { id, name, type, archived, archivedAt, ownerId, ownerName, memberCount }
}

function 成员行(value: unknown): MemberRow | undefined {
  if (!isRecord(value)) return undefined
  const { userId, policeNo, name, role, timeCreated } = value
  if (typeof userId !== "string" || typeof policeNo !== "string" || typeof name !== "string") return undefined
  if (!是角色(role) || !数(timeCreated)) return undefined
  return { userId, policeNo, name, role, timeCreated }
}

function 列表(value: unknown): readonly ProjectRow[] | undefined {
  if (!isRecord(value) || !Array.isArray(value["projects"])) return undefined
  const parsed: ProjectRow[] = []
  for (const item of value["projects"]) {
    const row = 项目行(item)
    if (!row) return undefined
    parsed.push(row)
  }
  return parsed
}

function 名单(value: unknown): readonly MemberRow[] | undefined {
  if (!isRecord(value) || !Array.isArray(value["members"])) return undefined
  const parsed: MemberRow[] = []
  for (const item of value["members"]) {
    const row = 成员行(item)
    if (!row) return undefined
    parsed.push(row)
  }
  return parsed
}

function 撤销结果(value: unknown): { readonly removed: string } | undefined {
  if (!isRecord(value) || typeof value["removed"] !== "string") return undefined
  return { removed: value["removed"] }
}

function 归档结果(value: unknown): { readonly archived: true } | undefined {
  if (!isRecord(value) || value["archived"] !== true) return undefined
  return { archived: true }
}

function 消息(body: unknown, response: Response): string {
  if (isRecord(body) && typeof body["error"] === "string" && body["error"].length > 0) return body["error"]
  return `操作失败（HTTP ${response.status}）`
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

function 错误结论(result: 取回成功): ProjectOutcome<never> | undefined {
  const { response, body } = result
  if (response.status === 401) return { kind: "rejected", message: "登录状态已失效，请重新登录" }
  if (response.status >= 500) return { kind: "failed", message: 消息(body, response) }
  if (!response.ok) return { kind: "rejected", message: 消息(body, response) }
  return undefined
}

async function 请求<T>(
  send: GovernanceFetch,
  input: string,
  init: RequestInit | undefined,
  解析: (body: unknown) => T | undefined,
): Promise<ProjectOutcome<T>> {
  const result = await 取回(send, input, init)
  if (result.kind === "failed") return result
  const 错误 = 错误结论(result)
  if (错误) return 错误
  const value = 解析(result.body)
  if (value === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
  return { kind: "ok", value }
}

/** 建一份客户端。`send` 省略 = 真实 `fetch` ＋ 超时（测试注入替身）。 */
export function createProjectApi(send: GovernanceFetch = 默认发送): ProjectApi {
  return {
    list: () => 请求(send, PATH.list, undefined, 列表),
    members: (id) => 请求(send, PATH.members(id), undefined, 名单),
    removeMember: (id, userId) =>
      请求(
        send,
        PATH.remove(id),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId }),
        },
        撤销结果,
      ),
    archive: (id) => 请求(send, PATH.archive(id), { method: "POST" }, 归档结果),
  }
}
