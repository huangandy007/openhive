/**
 * 016 T017 · 入库新出口的客户端（扫描 / 重跑 / 设置 / 报告）。
 *
 * 与 `case-materials-api.ts` 同一套范式：同源相对路径、可注入的 `send`、10 秒超时、
 * **失败不抛**（收成 `{ kind: "error", message, code? }`）、`noteStatus(response)`。
 *
 * ## 形状不认识就整份判错
 *
 * `合计` 是字符串、`截断` 是 `"false"`、`候选` 缺一类——这些都不是「大概为零」，
 * 而是这份回包不该被展示（`#002-02`：不知道 ≠ 空）。扫描数字一旦被降级成 0，
 * 用户会以为「没有要重跑的东西」而错过一批材料。
 */

import { noteStatus } from "./openhive-fetch"

export const PATH = {
  scan: "/openhive/case/ingest/scan",
  rerun: "/openhive/case/ingest/rerun",
  settings: "/openhive/case/ingest/settings",
  report: "/openhive/case/ingest/report",
} as const

export const TIMEOUT_MS = 10_000

/** 重跑范围闭集，与后端 `case-ingest-routes.ts` 的 `范围闭集` 逐字对应。 */
export const 扫描范围们 = ["目录独有", "未入队", "未识别"] as const
export type 扫描范围 = (typeof 扫描范围们)[number]

export interface 目录独有项 {
  readonly path: string
}

export interface 未入队项 {
  readonly materialId: string
  readonly path: string
}

export interface 未识别项 {
  readonly materialId: string
  readonly path: string
  readonly 原因码: string
}

export interface 扫描结果 {
  readonly 合计: number
  readonly 候选: {
    readonly 目录独有: readonly 目录独有项[]
    readonly 未入队: readonly 未入队项[]
    readonly 未识别: readonly 未识别项[]
  }
  readonly 样本: readonly string[]
  readonly 截断: boolean
}

export interface 跳过项 {
  readonly path: string
  readonly 原因: string
}

export interface 重跑结果 {
  readonly 已入队: number
  readonly 跳过: readonly 跳过项[]
  readonly 失败: readonly 跳过项[]
}

export interface 入库设置 {
  readonly autoEnqueue: boolean
  readonly autoEnableTrusted: boolean
  readonly updatedAt: number | null
}

/** 与 `case-material-report.ts` 的 `报告行` 逐字对应（读侧已驼峰）。 */
export interface 报告行 {
  readonly id: string
  readonly jobId: string
  readonly materialId: string
  readonly adapterId: string | null
  readonly adapterVersion: string | null
  readonly ruleVersion: string | null
  readonly sourceSha256: string
  readonly gates: readonly unknown[]
  readonly warnings: readonly unknown[]
  readonly skippedRows: readonly unknown[]
  readonly enrich: unknown
  readonly admission: unknown
  readonly createdAt: number
}

export type 报告响应 = { readonly report: 报告行 | null } | { readonly reports: readonly 报告行[] }

export type 结果<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "error"; readonly message: string; readonly code?: string }

export type CaseIngestFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface CaseIngestApi {
  readonly scan: (projectId: string) => Promise<结果<扫描结果>>
  readonly rerun: (input: {
    readonly projectId: string
    readonly 范围?: readonly 扫描范围[]
  }) => Promise<结果<重跑结果>>
  readonly readSettings: (projectId: string) => Promise<结果<入库设置>>
  readonly writeSettings: (input: {
    readonly projectId: string
    readonly autoEnqueue?: boolean
    readonly autoEnableTrusted?: boolean
  }) => Promise<结果<入库设置>>
  readonly report: (input: {
    readonly projectId: string
    readonly materialId: string
    readonly 历史?: boolean
  }) => Promise<结果<报告响应>>
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

/** 解可空文本：缺省 / `null` ⇒ `null`；类型不对 ⇒ `undefined`（判错）。 */
function 可空文本(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === "string" ? value : undefined
}

function 解析扫描(body: unknown): 扫描结果 | undefined {
  if (!isRecord(body)) return undefined
  const 合计 = body["合计"]
  const 截断 = body["截断"]
  if (!是非负整数(合计)) return undefined
  if (typeof 截断 !== "boolean") return undefined
  const 样本 = body["样本"]
  if (!Array.isArray(样本) || 样本.some((项) => typeof 项 !== "string")) return undefined
  const 候选 = body["候选"]
  if (!isRecord(候选)) return undefined

  const 目录独有 = 候选["目录独有"]
  const 未入队 = 候选["未入队"]
  const 未识别 = 候选["未识别"]
  if (!Array.isArray(目录独有) || !Array.isArray(未入队) || !Array.isArray(未识别)) return undefined

  const 目录项们: 目录独有项[] = []
  for (const 项 of 目录独有) {
    if (!isRecord(项) || typeof 项["path"] !== "string") return undefined
    目录项们.push({ path: 项["path"] })
  }
  const 未入队项们: 未入队项[] = []
  for (const 项 of 未入队) {
    if (!isRecord(项) || typeof 项["materialId"] !== "string" || typeof 项["path"] !== "string") return undefined
    未入队项们.push({ materialId: 项["materialId"], path: 项["path"] })
  }
  const 未识别项们: 未识别项[] = []
  for (const 项 of 未识别) {
    if (
      !isRecord(项) ||
      typeof 项["materialId"] !== "string" ||
      typeof 项["path"] !== "string" ||
      typeof 项["原因码"] !== "string"
    )
      return undefined
    未识别项们.push({ materialId: 项["materialId"], path: 项["path"], 原因码: 项["原因码"] })
  }

  return {
    合计,
    候选: { 目录独有: 目录项们, 未入队: 未入队项们, 未识别: 未识别项们 },
    样本,
    截断,
  }
}

function 解析跳过项们(value: unknown): 跳过项[] | undefined {
  if (!Array.isArray(value)) return undefined
  const 项们: 跳过项[] = []
  for (const 项 of value) {
    if (!isRecord(项) || typeof 项["path"] !== "string" || typeof 项["原因"] !== "string") return undefined
    项们.push({ path: 项["path"], 原因: 项["原因"] })
  }
  return 项们
}

function 解析重跑(body: unknown): 重跑结果 | undefined {
  if (!isRecord(body)) return undefined
  if (!是非负整数(body["已入队"])) return undefined
  const 跳过 = 解析跳过项们(body["跳过"])
  const 失败 = 解析跳过项们(body["失败"])
  if (跳过 === undefined || 失败 === undefined) return undefined
  return { 已入队: body["已入队"], 跳过, 失败 }
}

function 解析设置(body: unknown): 入库设置 | undefined {
  if (!isRecord(body)) return undefined
  if (typeof body["autoEnqueue"] !== "boolean") return undefined
  if (typeof body["autoEnableTrusted"] !== "boolean") return undefined
  const updatedAt = body["updatedAt"]
  if (updatedAt !== null && !(typeof updatedAt === "number" && Number.isFinite(updatedAt))) return undefined
  return { autoEnqueue: body["autoEnqueue"], autoEnableTrusted: body["autoEnableTrusted"], updatedAt }
}

function 解析报告行(value: unknown): 报告行 | undefined {
  if (!isRecord(value)) return undefined
  const id = value["id"]
  const jobId = value["jobId"]
  const materialId = value["materialId"]
  const sourceSha256 = value["sourceSha256"]
  if (
    typeof id !== "string" ||
    typeof jobId !== "string" ||
    typeof materialId !== "string" ||
    typeof sourceSha256 !== "string"
  )
    return undefined
  const adapterId = 可空文本(value["adapterId"])
  const adapterVersion = 可空文本(value["adapterVersion"])
  const ruleVersion = 可空文本(value["ruleVersion"])
  if (adapterId === undefined || adapterVersion === undefined || ruleVersion === undefined) return undefined
  const gates = value["gates"]
  const warnings = value["warnings"]
  const skippedRows = value["skippedRows"]
  if (!Array.isArray(gates) || !Array.isArray(warnings) || !Array.isArray(skippedRows)) return undefined
  const enrich = value["enrich"]
  const admission = value["admission"]
  const createdAt = value["createdAt"]
  if (enrich === undefined || admission === undefined) return undefined
  if (!是非负整数(createdAt)) return undefined
  return {
    id,
    jobId,
    materialId,
    adapterId,
    adapterVersion,
    ruleVersion,
    sourceSha256,
    gates,
    warnings,
    skippedRows,
    enrich,
    admission,
    createdAt,
  }
}

function 解析报告(body: unknown): 报告响应 | undefined {
  if (!isRecord(body)) return undefined
  if ("report" in body) {
    if (body["report"] === null) return { report: null }
    const 行 = 解析报告行(body["report"])
    return 行 === undefined ? undefined : { report: 行 }
  }
  if ("reports" in body) {
    if (!Array.isArray(body["reports"])) return undefined
    const 行们: 报告行[] = []
    for (const 项 of body["reports"]) {
      const 行 = 解析报告行(项)
      if (行 === undefined) return undefined
      行们.push(行)
    }
    return { reports: 行们 }
  }
  return undefined
}

async function 读错误(response: Response, body: unknown): Promise<{ message: string; code?: string }> {
  const 值: Record<string, unknown> = isRecord(body) ? body : {}
  const message = typeof 值["error"] === "string" ? 值["error"] : `请求失败（${response.status}）`
  const code = typeof 值["code"] === "string" ? 值["code"] : undefined
  return code === undefined ? { message } : { message, code }
}

export function createCaseIngestApi(send: CaseIngestFetch = 默认发送): CaseIngestApi {
  /** 统一的「发出去 → 解体 → 判形状」；`解析` 返回 `undefined` 就是形状不对。 */
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
    if (!response.ok) return { kind: "error", ...(await 读错误(response, body)) }
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
    scan: (projectId) => 取(`${PATH.scan}?projectId=${encodeURIComponent(projectId)}`, undefined, 解析扫描),
    rerun: (input) =>
      取(PATH.rerun, 放体({ projectId: input.projectId, ...(input.范围 === undefined ? {} : { 范围: input.范围 }) }), 解析重跑),
    readSettings: (projectId) =>
      取(`${PATH.settings}?projectId=${encodeURIComponent(projectId)}`, undefined, 解析设置),
    writeSettings: (input) =>
      取(
        PATH.settings,
        放体({
          projectId: input.projectId,
          ...(input.autoEnqueue === undefined ? {} : { autoEnqueue: input.autoEnqueue }),
          ...(input.autoEnableTrusted === undefined ? {} : { autoEnableTrusted: input.autoEnableTrusted }),
        }),
        解析设置,
      ),
    report: (input) => {
      const 历史 = input.历史 === true
      const 查询 = `${PATH.report}?projectId=${encodeURIComponent(input.projectId)}&materialId=${encodeURIComponent(input.materialId)}${历史 ? "&历史=1" : ""}`
      return 取(查询, undefined, 解析报告)
    },
  }
}
