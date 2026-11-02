/**
 * MCP 连接规格的只读客户端（2026-11-02 设计 §3.1.2 / §5.2）。
 *
 * 与服务端类型同形：`McpConnectionView` 从 `asset-service` **只做类型导入**（不把内核
 * 运行时代码带进前端）。严格解析每一列——服务端契约变了要报「数据格式不对」，
 * 不能把缺字段静默当成空值（那会让「没试连」与「字段丢了」长得一样）。
 */
import type { McpConnectionView } from "@opencode-ai/asset-service/mcp-connection"

export type McpConnectionOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "rejected"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string }

export type McpConnectionFetch = (input: string, init?: RequestInit) => Promise<Response>

export const TIMEOUT_MS = 10_000

export const PATH = {
  connection: (assetId: string) => `/openhive/assets/${encodeURIComponent(assetId)}/connection`,
} as const

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

function 可空数(value: unknown): number | null | undefined {
  if (value === null) return null
  return 数(value) ? value : undefined
}

/** `checkOk` 只能是 `boolean | null`；`undefined`（缺字段）也判坏。 */
function 可空布尔(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean"
}

function 字符串表(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return undefined
    out[key] = item
  }
  return out
}

function 连接(value: unknown): McpConnectionView | undefined {
  if (!isRecord(value)) return undefined
  const { assetId, transport, url, command, cwd, enabled, checkError } = value
  if (typeof assetId !== "string" || (transport !== "local" && transport !== "remote")) return undefined
  if (url !== null && typeof url !== "string") return undefined
  if (command !== null && (!Array.isArray(command) || !command.every((part) => typeof part === "string"))) {
    return undefined
  }
  if (cwd !== null && typeof cwd !== "string") return undefined
  const headers = 字符串表(value["headers"])
  const environment = 字符串表(value["environment"])
  if (headers === undefined || environment === undefined) return undefined
  if (typeof enabled !== "boolean") return undefined
  if (typeof checkError !== "string") return undefined
  if (!可空布尔(value["checkOk"])) return undefined
  const timeoutMs = 可空数(value["timeoutMs"])
  const checkedAt = 可空数(value["checkedAt"])
  const toolCount = 可空数(value["toolCount"])
  if (timeoutMs === undefined || checkedAt === undefined || toolCount === undefined) return undefined
  const createdAt = value["createdAt"]
  const updatedAt = value["updatedAt"]
  if (!数(createdAt) || !数(updatedAt)) return undefined
  return {
    assetId,
    transport,
    url,
    command: command === null ? null : command,
    cwd,
    headers,
    environment,
    enabled,
    timeoutMs,
    checkedAt,
    checkOk: value["checkOk"],
    checkError,
    toolCount,
    createdAt,
    updatedAt,
  }
}

async function 发送并解析(
  send: McpConnectionFetch,
  input: string,
): Promise<McpConnectionOutcome<McpConnectionView>> {
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
  const message =
    isRecord(body) && typeof body["error"] === "string" && body["error"].length > 0
      ? body["error"]
      : `操作失败（HTTP ${response.status}）`
  if (response.status === 401) return { kind: "rejected", message: "登录状态已失效，请重新登录" }
  if (response.status >= 500) return { kind: "failed", message }
  if (!response.ok) return { kind: "rejected", message }
  const parsed = 连接(body)
  if (parsed === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
  return { kind: "ok", value: parsed }
}

export interface McpConnectionApi {
  get(assetId: string): Promise<McpConnectionOutcome<McpConnectionView>>
}

export function createMcpConnectionApi(send: McpConnectionFetch = 默认发送): McpConnectionApi {
  return {
    get: (assetId) => 发送并解析(send, PATH.connection(assetId)),
  }
}
