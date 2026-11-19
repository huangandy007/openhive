/**
 * 材料视图与解析动作的客户端（计划 3）。
 *
 * 与 `ai-assets/enable-api.ts` 同一套范式：同源相对路径、可注入的 `send`、10 秒超时、
 * **失败不抛**（收成 `{ kind: "error", message, code? }`）。
 *
 * ## 状态是**闭集**，不认识就整份判错
 *
 * 服务端升级出第七种状态时，前端最坏的行为是「把它画成未入队」——那会让用户对一份已解析的
 * 文件再点一次。`#002-02`：不知道 ≠ 空 / ≠ 未入队。故这里宁可整份回包判错。
 */
import { noteStatus } from "./openhive-fetch"

export const PATH = {
  materials: "/openhive/case/materials",
  parse: "/openhive/case/parse",
} as const

export const TIMEOUT_MS = 10_000

export const 解析状态们 = ["未入队", "排队中", "解析中", "已解析", "有问题", "已跳过"] as const
export type 解析状态 = (typeof 解析状态们)[number]

export const 人工解析动作们 = ["入队", "重新解析", "取消", "跳过"] as const
export type 人工解析动作 = (typeof 人工解析动作们)[number]

export interface 问题切片 {
  readonly range: string
  readonly reason: string
  readonly count: number
}

export interface 材料问题 {
  readonly reason?: string
  readonly slices?: readonly 问题切片[]
}

export const 作业阶段们 = ["读表", "探测", "转换", "写入", "富化"] as const
export type 作业阶段 = (typeof 作业阶段们)[number]

/** 入库作业的结构化进度（`progress`）；`已处理` / `总数` 可能缺（阶段切分不按行计）。 */
export interface 作业进度 {
  readonly 阶段: 作业阶段
  readonly 已处理?: number
  readonly 总数?: number
  readonly 更新时间: number
}

export const 探测状态们 = ["探测中", "已识别", "未识别"] as const
export type 探测状态 = (typeof 探测状态们)[number]

/** 探测结论（`probe`）的闭集形状；`已识别` 带适配器、`未识别` 带原因码。 */
export interface 探测结论 {
  readonly 状态: 探测状态
  readonly 适配器id?: string
  readonly 版本?: string
  readonly 原因码?: string
  readonly 完成秒?: number
}

export interface 材料视图 {
  readonly id: string
  readonly path: string
  readonly kind: string
  readonly status: 解析状态
  readonly detail: 材料问题 | null
  readonly queueAhead: number
  readonly factCount: number
  readonly numberCount: number
  readonly parseable: boolean
  /** 016：最近作业用的适配器；没有作业 ⇒ null。 */
  readonly adapterId: string | null
  readonly adapterVersion: string | null
  /** 最近作业的结构化原因码（`未识别:` 前缀可按它筛）。 */
  readonly reasonCode: string | null
  readonly progress: 作业进度 | null
  readonly probe: 探测结论 | null
}

export interface 材料清单 {
  readonly materials: readonly 材料视图[]
  readonly parseableExtensions: readonly string[]
}

export type 材料清单结果 =
  | { readonly kind: "ok"; readonly value: 材料清单 }
  | { readonly kind: "error"; readonly message: string; readonly code?: string }

export type 解析结果 =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly message: string; readonly code?: string }

export type CaseMaterialsFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface CaseMaterialsApi {
  /** `未识别 === true` ⇒ URL 追加 `&未识别=1`（只认字面 `1`，其余不带）。 */
  readonly read: (projectId: string, 未识别?: boolean) => Promise<材料清单结果>
  readonly parse: (input: {
    readonly projectId: string
    readonly path: string
    readonly action: 人工解析动作
  }) => Promise<解析结果>
}

async function 默认发送(input: string, init?: RequestInit): Promise<Response> {
  const 控制器 = new AbortController()
  const 定时器 = setTimeout(() => 控制器.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(input, { ...init, signal: 控制器.signal })
    // 未登录时后端回**空体 401**：结论侧只会说「服务端回了非 JSON（401）」，而能处理它的
    // 登录门（`AuthGate`）只听得见 `markSessionExpired`。喊一声接在底座上（`openhive-fetch.ts`
    // 的 `trySend` 用的是同一个口），返回值一个字不改。
    noteStatus(response)
    return response
  } finally {
    clearTimeout(定时器)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const 是状态 = (value: unknown): value is 解析状态 =>
  typeof value === "string" && (解析状态们 as readonly string[]).includes(value)

function 解析问题(value: unknown): 材料问题 | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  if (value["reason"] !== undefined && typeof value["reason"] !== "string") return undefined
  const 原 = value["slices"]
  const 切片: 问题切片[] = []
  if (原 !== undefined) {
    if (!Array.isArray(原)) return undefined
    for (const 项 of 原) {
      if (!isRecord(项)) return undefined
      if (typeof 项["range"] !== "string") return undefined
      if (typeof 项["reason"] !== "string") return undefined
      if (typeof 项["count"] !== "number") return undefined
      切片.push({ range: 项["range"], reason: 项["reason"], count: 项["count"] })
    }
  }
  return {
    ...(value["reason"] === undefined ? {} : { reason: value["reason"] }),
    ...(原 === undefined ? {} : { slices: 切片 }),
  }
}

/** 新增字段的三种状态：缺省 / `null` ⇒ `null`；类型不对 ⇒ `undefined`（整份判错）；对 ⇒ 值。 */
function 可空文本(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === "string" ? value : undefined
}

const 是非负整数 = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0

const 是作业阶段 = (value: unknown): value is 作业阶段 =>
  typeof value === "string" && 作业阶段们.some((项) => 项 === value)

const 是探测状态 = (value: unknown): value is 探测状态 =>
  typeof value === "string" && 探测状态们.some((项) => 项 === value)

function 解析进度(value: unknown): 作业进度 | null | undefined {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) return undefined
  const 阶段 = value["阶段"]
  if (!是作业阶段(阶段)) return undefined
  const 时间 = value["更新时间"]
  if (!是非负整数(时间)) return undefined
  const 已处理 = value["已处理"]
  const 总数 = value["总数"]
  if (已处理 !== undefined && !是非负整数(已处理)) return undefined
  if (总数 !== undefined && !是非负整数(总数)) return undefined
  return {
    阶段,
    ...(已处理 === undefined ? {} : { 已处理 }),
    ...(总数 === undefined ? {} : { 总数 }),
    更新时间: 时间,
  }
}

function 解析探测(value: unknown): 探测结论 | null | undefined {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) return undefined
  const 状态 = value["状态"]
  if (!是探测状态(状态)) return undefined
  const 适配器id = value["适配器id"]
  const 版本 = value["版本"]
  const 原因码 = value["原因码"]
  const 完成秒 = value["完成秒"]
  if (适配器id !== undefined && typeof 适配器id !== "string") return undefined
  if (版本 !== undefined && typeof 版本 !== "string") return undefined
  if (原因码 !== undefined && typeof 原因码 !== "string") return undefined
  if (完成秒 !== undefined && !是非负整数(完成秒)) return undefined
  return {
    状态,
    ...(适配器id === undefined ? {} : { 适配器id }),
    ...(版本 === undefined ? {} : { 版本 }),
    ...(原因码 === undefined ? {} : { 原因码 }),
    ...(完成秒 === undefined ? {} : { 完成秒 }),
  }
}

function 解析清单(body: unknown): 材料清单 | undefined {
  if (!isRecord(body)) return undefined
  const 原 = body["materials"]
  const 扩展名 = body["parseableExtensions"]
  if (!Array.isArray(原) || !Array.isArray(扩展名)) return undefined
  if (!扩展名.every((item): item is string => typeof item === "string")) return undefined

  const 行们: 材料视图[] = []
  for (const 项 of 原) {
    if (!isRecord(项)) return undefined
    if (typeof 项["id"] !== "string" || typeof 项["path"] !== "string" || typeof 项["kind"] !== "string") return undefined
    if (!是状态(项["status"])) return undefined
    const detail = 解析问题(项["detail"])
    if (detail === undefined) return undefined
    for (const key of ["queueAhead", "factCount", "numberCount"] as const) {
      if (typeof 项[key] !== "number" || !Number.isInteger(项[key]) || 项[key] < 0) return undefined
    }
    if (typeof 项["parseable"] !== "boolean") return undefined
    const adapterId = 可空文本(项["adapterId"])
    const adapterVersion = 可空文本(项["adapterVersion"])
    const reasonCode = 可空文本(项["reasonCode"])
    if (adapterId === undefined || adapterVersion === undefined || reasonCode === undefined) return undefined
    const progress = 解析进度(项["progress"])
    const probe = 解析探测(项["probe"])
    if (progress === undefined || probe === undefined) return undefined
    行们.push({
      id: 项["id"],
      path: 项["path"],
      kind: 项["kind"],
      status: 项["status"],
      detail,
      queueAhead: 项["queueAhead"] as number,
      factCount: 项["factCount"] as number,
      numberCount: 项["numberCount"] as number,
      parseable: 项["parseable"],
      adapterId,
      adapterVersion,
      reasonCode,
      progress,
      probe,
    })
  }
  return { materials: 行们, parseableExtensions: 扩展名 }
}

async function 读错误(response: Response, body: unknown): Promise<{ message: string; code?: string }> {
  const 值: Record<string, unknown> = isRecord(body) ? body : {}
  const message = typeof 值["error"] === "string" ? 值["error"] : `请求失败（${response.status}）`
  const code = typeof 值["code"] === "string" ? 值["code"] : undefined
  return code === undefined ? { message } : { message, code }
}

export function createCaseMaterialsApi(send: CaseMaterialsFetch = 默认发送): CaseMaterialsApi {
  const 读 = async (projectId: string, 未识别?: boolean): Promise<材料清单结果> => {
    let response: Response
    try {
      const 查询 = `${PATH.materials}?projectId=${encodeURIComponent(projectId)}${未识别 === true ? "&未识别=1" : ""}`
      response = await send(查询)
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
    const 清单 = 解析清单(body)
    if (清单 === undefined) return { kind: "error", message: "服务端回包形状不对" }
    return { kind: "ok", value: 清单 }
  }

  const 解析 = async (input: {
    projectId: string
    path: string
    action: 人工解析动作
  }): Promise<解析结果> => {
    let response: Response
    try {
      response = await send(PATH.parse, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: input.projectId, path: input.path, action: input.action }),
      })
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
    if (!isRecord(body) || body["ok"] !== true) return { kind: "error", message: "服务端回包形状不对" }
    return { kind: "ok" }
  }

  return { read: 读, parse: 解析 }
}
