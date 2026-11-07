/**
 * 实体视图的客户端（计划 7 Task 5）。
 *
 * 与 `case-materials-api.ts` 同一套范式：同源相对路径、可注入的 `send`、10 秒超时、
 * **失败不抛**（收成 `{ kind: "error", message, code? }`）。
 *
 * ⚠️ **不做逐字段形状校验**（与计划 6 的客户端一致）：本视图只画服务端给的清单，
 * 一处校验等于把「服务端多给 / 少给一个字段」变成整片空白，而不是一行画错。
 */
import { 案件伪路径 } from "../center/case-route"
import { noteStatus } from "./openhive-fetch"

export type 结果<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "error"; readonly message: string; readonly code?: string }

export interface 类型计数 {
  readonly type: string
  readonly count: number
}
export interface 实体清单项 {
  readonly id: string
  readonly type: string
  /** 大类之下的细类（「号码 · 手机号」的后者）；服务端判不出就没有，界面只显示大类。 */
  readonly subtype?: string
  readonly canonical_value: string
  readonly trust_state: string
  readonly 关联数: number
  readonly created_at: number
}
export type 排序 = "涉案" | "名称" | "时间"

export type CaseFetch = (input: string, init?: RequestInit) => Promise<Response>

export const TIMEOUT_MS = 10_000
export const PREFIX = "/openhive/case"

export async function 默认发送(input: string, init?: RequestInit): Promise<Response> {
  const 控制器 = new AbortController()
  const 定时器 = setTimeout(() => 控制器.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(input, { ...init, signal: 控制器.signal })
    // 401 是空体：只有底座听得见「该重新登录了」（同 `case-materials-api.ts`）。
    noteStatus(response)
    return response
  } finally {
    clearTimeout(定时器)
  }
}

/** 同源 JSON 取数：非 2xx 收成 `{kind:"error"}`，**从不抛**（视图只管画，不管异常）。 */
export async function 请求<T>(send: CaseFetch, url: string, init?: RequestInit): Promise<结果<T>> {
  try {
    const response = await send(url, init)
    if (!response.ok) {
      const 体 = (await response.json().catch(() => undefined)) as { error?: string; code?: string } | undefined
      return { kind: "error", message: 体?.error ?? `服务端回了 ${response.status}`, code: 体?.code }
    }
    try {
      return { kind: "ok", value: (await response.json()) as T }
    } catch {
      // 2xx 却不是 JSON（真实应用里未挂上的路径会落进 UI 的 `/*` 兜底，回 200 ＋ `text/html`）：
      // 说清是哪一种，不要把解析器的原话摔到界面上。
      return { kind: "error", message: `服务端回了非 JSON（${response.status}）` }
    }
  } catch (错误) {
    return { kind: "error", message: 错误 instanceof Error ? 错误.message : String(错误) }
  }
}

export interface EntityApi {
  readonly counts: (projectId: string) => Promise<结果<类型计数[]>>
  readonly list: (input: {
    readonly projectId: string
    readonly type?: string
    readonly q?: string
    readonly sort?: 排序
  }) => Promise<结果<{ readonly 行们: 实体清单项[]; readonly 缺口: string[] }>>
}

export function createEntityApi(send: CaseFetch = 默认发送): EntityApi {
  return {
    counts: async (projectId) => {
      const 结果 = await 请求<{ counts: 类型计数[] }>(
        send,
        `${PREFIX}/entities?projectId=${encodeURIComponent(projectId)}`,
      )
      if (结果.kind === "error") return 结果
      return { kind: "ok", value: 结果.value.counts }
    },
    list: async (input) => {
      const 参数 = new URLSearchParams({ projectId: input.projectId })
      // ⚠️ 空串 ≠ 不过滤：服务端把 `type=` 当成「查一个空类型」（计划 7 Task 4 的 Minor 1）。
      // 所以跨类型搜索时**不写这个键**，而不是写空值。
      if (input.type !== undefined) 参数.set("type", input.type)
      if (input.q !== undefined && input.q.trim() !== "") 参数.set("q", input.q.trim())
      if (input.sort !== undefined) 参数.set("sort", input.sort)
      const 结果 = await 请求<{ list: { 行们: 实体清单项[]; 缺口: string[] } }>(
        send,
        `${PREFIX}/entities?${参数.toString()}`,
      )
      if (结果.kind === "error") return 结果
      return { kind: "ok", value: 结果.value.list }
    },
  }
}

/**
 * 中栏实体档案的伪路径（计划 7 的裁定 3：`case://<projectId>/<kind>/<参数>`）。
 *
 * ⚠️ 这里**不自己拼串**：构造器只有一个（`center/case-route.ts` 的 `案件伪路径`），解析器也只认
 * 那一种拼法（`LEARNINGS #002-06`）。本函数只是给左栏点开实体时用的「tab 三件套」包装。
 */
export function 实体路径(
  projectId: string,
  id: string,
  title: string,
): { module: string; title: string; path: string } {
  return { module: "project", title, path: 案件伪路径({ projectId, view: "entity", arg: id }) }
}
