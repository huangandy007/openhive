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

export interface 分组计数 {
  readonly 核心: number
  readonly 提及: number
}
export type 实体分组 = "核心" | "提及"
export interface 实体清单项 {
  readonly id: string
  readonly type: string
  /** 大类之下的细类（「号码 · 手机号」的后者）；服务端判不出就没有，界面只显示大类。 */
  readonly subtype?: string
  readonly canonical_value: string
  readonly trust_state: string
  readonly 关联数: number
  readonly 事件参与数: number
  readonly 权重: number
  readonly 分组: 实体分组
  readonly created_at: number
}
export interface 实体清单结果 {
  readonly 行们: 实体清单项[]
  readonly 总数: number
  readonly 缺口: string[]
}
export type 排序 = "涉案" | "名称" | "时间"

export type CaseFetch = (input: string, init?: RequestInit) => Promise<Response>

export const TIMEOUT_MS = 10_000
export const PREFIX = "/openhive/case"

/**
 * 超时那一刻给民警的话。
 *
 * 不能把浏览器原文（`signal is aborted without reason`）透出去——2026-11-07 用户实报的红字就是它
 * （截图 `images/screen/2026-11-07_203854.png`）。那句是**无参 `abort()` 之后 fetch 的拒因**，
 * 真浏览器实测逐字如此；它是给我们看的，不是给民警看的。
 */
export const 超时提示 = `读取超时（${TIMEOUT_MS / 1000} 秒），请稍后重试`

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
    // 本客户端里 abort **只有一个来源**：`默认发送` 到点（`TIMEOUT_MS`）那一记。所以按 `name` 认
    // 就是「这次是超时」——`AbortError` 的 `message` 是浏览器内部话，一个字都不该往界面上放。
    if (错误 instanceof Error && 错误.name === "AbortError")
      return { kind: "error", message: 超时提示, code: "timeout" }
    return { kind: "error", message: 错误 instanceof Error ? 错误.message : String(错误) }
  }
}

/**
 * 超时**自动再打一次**。
 *
 * 为什么：内核有整段「同步忙」的窗口——实例引导＋skill 扫描（2026-11-07 20:38 实测：同一时刻五个
 * 项目在 boot，计数请求排队排过了 10 秒预算）。窗口一过，同一条请求 60–70ms 就回来。这类超时是
 * 一次性的，重打一次就自己好，不该逼民警去切项目自救（计数这条链只在换项目时重取）。
 *
 * 只重 `code === "timeout"`：网络的错（连接被拒 / 断了）与服务端的错（4xx/5xx）重打只是再等一遍。
 * 重试**放在这里一处**，`groups` 与 `list` 都经它——两条链各写一份就会漂（`LEARNINGS #002-06`）。
 */
async function 超时再打一次<T>(一次: () => Promise<结果<T>>): Promise<结果<T>> {
  const 首 = await 一次()
  if (首.kind === "ok" || 首.code !== "timeout") return 首
  return await 一次()
}

export interface EntityApi {
  readonly groups: (projectId: string) => Promise<结果<分组计数>>
  readonly list: (input: {
    readonly projectId: string
    readonly group?: 实体分组
    readonly q?: string
    readonly sort?: 排序
    readonly limit?: number
  }) => Promise<结果<实体清单结果>>
}

export function createEntityApi(send: CaseFetch = 默认发送): EntityApi {
  return {
    groups: async (projectId) => {
      const 结果 = await 超时再打一次(() =>
        请求<{ groups: 分组计数 }>(send, `${PREFIX}/entities?projectId=${encodeURIComponent(projectId)}`),
      )
      if (结果.kind === "error") return 结果
      return { kind: "ok", value: 结果.value.groups }
    },
    list: async (input) => {
      const 参数 = new URLSearchParams({ projectId: input.projectId })
      // ⚠️ 空串 ≠ 不过滤：省略 `group` 才是跨组（搜索）。不要写 `group=`。
      if (input.group !== undefined) 参数.set("group", input.group)
      if (input.q !== undefined && input.q.trim() !== "") 参数.set("q", input.q.trim())
      if (input.sort !== undefined) 参数.set("sort", input.sort)
      if (input.limit !== undefined) 参数.set("limit", String(input.limit))
      const 结果 = await 超时再打一次(() =>
        请求<{ list: 实体清单结果 }>(send, `${PREFIX}/entities?${参数.toString()}`),
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
