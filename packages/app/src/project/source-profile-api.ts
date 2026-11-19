/**
 * 016 T017 · 数据源档案的客户端（既有三出口，本任务只消费、不改后端）。
 *
 * 行是**蛇形**（后端 `case-source-profile-store.ts` 的 `数据源档案行` 直接回给前端），
 * 这里照原样解析——自造驼峰等于在两端各写一份线格式，改一处两边一起错。
 *
 * 失败口径同 `case-materials-api.ts`：不抛、收成 `{ kind: "error", message, code?, problems? }`；
 * `mapping_invalid` 会带 `problems`（逐条原因），建档案表单逐条显示。
 */
import { noteStatus } from "./openhive-fetch"

export const PATH = {
  list: "/openhive/case/source-profiles",
  build: "/openhive/case/source-profile/build",
  revoke: "/openhive/case/source-profile/revoke",
} as const

export const TIMEOUT_MS = 10_000

export const 档案类型们 = ["资金", "话单", "其他"] as const
export type 档案类型 = (typeof 档案类型们)[number]

export interface 数据源档案行 {
  readonly id: string
  readonly name: string
  readonly type: 档案类型
  readonly header_set: readonly string[]
  readonly mapping: Readonly<Record<string, string>>
  readonly hit_count: number
  readonly created_at: number
  readonly updated_at: number
  readonly revoked_at: number | null
}

export interface 档案错误 {
  readonly kind: "error"
  readonly message: string
  readonly code?: string
  /** 仅 `mapping_invalid`：逐条映射问题。 */
  readonly problems?: readonly string[]
}

export type 结果<T> = { readonly kind: "ok"; readonly value: T } | 档案错误
export type 撤销结果 = { readonly kind: "ok" } | 档案错误

export type SourceProfileFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface SourceProfileApi {
  readonly list: (input: {
    readonly projectId: string
    /** 只有字面 `true` 才把已撤销的档案也列出来。 */
    readonly 含撤销?: boolean
  }) => Promise<结果<readonly 数据源档案行[]>>
  readonly build: (input: {
    readonly projectId: string
    readonly materialId: string
    readonly 工作表?: string
    readonly name?: string
    readonly 覆盖?: boolean
  }) => Promise<结果<{ readonly id: string; readonly created: boolean }>>
  readonly revoke: (input: { readonly projectId: string; readonly id: string }) => Promise<撤销结果>
}

async function 默认发送(input: string, init?: RequestInit): Promise<Response> {
  const 控制器 = new AbortController()
  const 定时器 = setTimeout(() => 控制器.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(input, { ...init, signal: 控制器.signal })
    noteStatus(response)
    return response
  } finally {
    clearTimeout(定时器)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const 是非负整数 = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0

const 是档案类型 = (value: unknown): value is 档案类型 =>
  typeof value === "string" && 档案类型们.some((项) => 项 === value)

function 解析行(value: unknown): 数据源档案行 | undefined {
  if (!isRecord(value)) return undefined
  const id = value["id"]
  const name = value["name"]
  if (typeof id !== "string" || typeof name !== "string") return undefined
  const type = value["type"]
  if (!是档案类型(type)) return undefined
  const headerSet = value["header_set"]
  if (!Array.isArray(headerSet) || headerSet.some((项) => typeof 项 !== "string")) return undefined
  const mapping = value["mapping"]
  if (!isRecord(mapping)) return undefined
  const 映射: Record<string, string> = {}
  for (const [键, 值] of Object.entries(mapping)) {
    if (typeof 值 !== "string") return undefined
    映射[键] = 值
  }
  const hitCount = value["hit_count"]
  const createdAt = value["created_at"]
  const updatedAt = value["updated_at"]
  if (!是非负整数(hitCount) || !是非负整数(createdAt) || !是非负整数(updatedAt)) return undefined
  const revokedAt = value["revoked_at"]
  if (revokedAt !== null && !是非负整数(revokedAt)) return undefined
  return {
    id,
    name,
    type,
    header_set: headerSet,
    mapping: 映射,
    hit_count: hitCount,
    created_at: createdAt,
    updated_at: updatedAt,
    revoked_at: revokedAt,
  }
}

function 解析清单(body: unknown): readonly 数据源档案行[] | undefined {
  if (!isRecord(body) || !Array.isArray(body["list"])) return undefined
  const 行们: 数据源档案行[] = []
  for (const 项 of body["list"]) {
    const 行 = 解析行(项)
    if (行 === undefined) return undefined
    行们.push(行)
  }
  return 行们
}

function 解析建档(body: unknown): { id: string; created: boolean } | undefined {
  if (!isRecord(body)) return undefined
  if (typeof body["id"] !== "string" || typeof body["created"] !== "boolean") return undefined
  return { id: body["id"], created: body["created"] }
}

async function 读错误(response: Response, body: unknown): Promise<档案错误> {
  const 值: Record<string, unknown> = isRecord(body) ? body : {}
  const message = typeof 值["error"] === "string" ? 值["error"] : `请求失败（${response.status}）`
  const code = typeof 值["code"] === "string" ? 值["code"] : undefined
  const 问题 = 值["problems"]
  const problems =
    Array.isArray(问题) && 问题.every((条): 条 is string => typeof 条 === "string") ? 问题 : undefined
  return {
    kind: "error",
    message,
    ...(code === undefined ? {} : { code }),
    ...(problems === undefined ? {} : { problems }),
  }
}

export function createSourceProfileApi(send: SourceProfileFetch = 默认发送): SourceProfileApi {
  async function 取<T>(
    input: string,
    init: RequestInit | undefined,
    解析: (body: unknown) => T | undefined,
  ): Promise<结果<T>> {
    let response: Response
    try {
      response = await send(input, init)
    } catch (error) {
      return { kind: "error", message: error instanceof Error ? error.message : "网络请求失败" }
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { kind: "error", message: `服务端回了非 JSON（${response.status}）` }
    }
    if (!response.ok) return 读错误(response, body)
    const 值 = 解析(body)
    if (值 === undefined) return { kind: "error", message: "服务端回包形状不对" }
    return { kind: "ok", value: 值 }
  }

  const 放体 = (体: Record<string, unknown>): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(体),
  })

  return {
    list: (input) => {
      const 含撤销 = input.含撤销 === true ? "&含撤销=true" : ""
      return 取(`${PATH.list}?projectId=${encodeURIComponent(input.projectId)}${含撤销}`, undefined, 解析清单)
    },
    build: (input) =>
      取(
        PATH.build,
        放体({
          projectId: input.projectId,
          materialId: input.materialId,
          ...(input.工作表 === undefined ? {} : { 工作表: input.工作表 }),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.覆盖 === undefined ? {} : { 覆盖: input.覆盖 }),
        }),
        解析建档,
      ),
    revoke: async (input) => {
      const 结果 = await 取<true>(PATH.revoke, 放体({ projectId: input.projectId, id: input.id }), (body) =>
        isRecord(body) && body["ok"] === true ? true : undefined,
      )
      if (结果.kind === "error") return 结果
      return { kind: "ok" }
    },
  }
}
