/**
 * 016 T017 · 平台级「可信技能」白名单的客户端（FR-047）。
 *
 * 三个出口都要求管理员（服务端 `governance-trusted-skill.ts` 一处判定）；403 的
 * `code: "forbidden"` 原样带回，管理页据此显示「只有单位管理员能维护」。
 *
 * 范式同 `case-materials-api.ts`：同源相对路径 + 可注入 `send` + 10 秒超时 + 失败不抛。
 */
import { ASSET_STATUSES, type AssetStatus } from "@opencode-ai/asset-service/metadata"
import { noteStatus } from "../project/openhive-fetch"

export const PATH = {
  list: "/openhive/governance/trusted-skills",
  revoke: "/openhive/governance/trusted-skills/revoke",
} as const

export const TIMEOUT_MS = 10_000

export interface 可信技能行 {
  readonly assetId: string
  readonly name: string
  /** 闭集（`AssetStatus`）：未知状态按「无法识别」处理，不把脏值带进类型（B7）。 */
  readonly status: AssetStatus
  readonly addedBy: string
  readonly addedAt: number
}

export type 错误 =
  | { readonly kind: "error"; readonly message: string; readonly code?: string }

export type 结果<T> = { readonly kind: "ok"; readonly value: T } | 错误
export type 写入结果 = { readonly kind: "ok" } | 错误

export type TrustedSkillFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface TrustedSkillApi {
  readonly list: () => Promise<结果<readonly 可信技能行[]>>
  readonly add: (assetId: string) => Promise<写入结果>
  readonly revoke: (assetId: string) => Promise<写入结果>
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

/** 状态只认闭集；认不出 ⇒ 该行判坏（列表回错误包，不抛）。 */
const 是状态 = (value: unknown): value is AssetStatus =>
  ASSET_STATUSES.some((状态) => 状态 === value)

function 解析行(value: unknown): 可信技能行 | undefined {
  if (!isRecord(value)) return undefined
  const assetId = value["assetId"]
  const name = value["name"]
  const status = value["status"]
  const addedBy = value["addedBy"]
  const addedAt = value["addedAt"]
  if (
    typeof assetId !== "string" ||
    typeof name !== "string" ||
    !是状态(status) ||
    typeof addedBy !== "string"
  )
    return undefined
  if (!是非负整数(addedAt)) return undefined
  return { assetId, name, status, addedBy, addedAt }
}

function 解析清单(body: unknown): readonly 可信技能行[] | undefined {
  if (!isRecord(body) || !Array.isArray(body["list"])) return undefined
  const 行们: 可信技能行[] = []
  for (const 项 of body["list"]) {
    const 行 = 解析行(项)
    if (行 === undefined) return undefined
    行们.push(行)
  }
  return 行们
}

async function 读错误(response: Response, body: unknown): Promise<错误> {
  const 值: Record<string, unknown> = isRecord(body) ? body : {}
  const message = typeof 值["error"] === "string" ? 值["error"] : `请求失败（${response.status}）`
  const code = typeof 值["code"] === "string" ? 值["code"] : undefined
  return { kind: "error", message, ...(code === undefined ? {} : { code }) }
}

export function createTrustedSkillApi(send: TrustedSkillFetch = 默认发送): TrustedSkillApi {
  async function 发(input: string, init?: RequestInit): Promise<{ response: Response; body: unknown } | 错误> {
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
    return { response, body }
  }

  const 放体 = (assetId: string): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetId }),
  })

  async function 写(assetId: string, 路径: string): Promise<写入结果> {
    const 回 = await 发(路径, 放体(assetId))
    if ("kind" in 回) return 回
    if (!isRecord(回.body) || 回.body["ok"] !== true) return { kind: "error", message: "服务端回包形状不对" }
    return { kind: "ok" }
  }

  return {
    list: async () => {
      const 回 = await 发(PATH.list)
      if ("kind" in 回) return 回
      const 值 = 解析清单(回.body)
      if (值 === undefined) return { kind: "error", message: "服务端回包形状不对" }
      return { kind: "ok", value: 值 }
    },
    add: (assetId) => 写(assetId, PATH.list),
    revoke: (assetId) => 写(assetId, PATH.revoke),
  }
}
