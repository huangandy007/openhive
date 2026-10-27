/**
 * 项目级 skill 启用的客户端（2026-10-27）。
 *
 * 出口的分工见 `packages/opencode/src/server/openhive/project-assets.ts` 文件头。
 * 这里只做四件事：拼 URL、发请求、把**成功/失败**收成三态、把服务端的 `code` 原样带回去。
 *
 * 四个出口：读状态、单条启用、单条停用、**一键开关自动送达**（需求 5a——它回的是整份状态，
 * 与读状态同形，因为关掉之后「还有哪些自动项」只有服务端知道）。
 *
 * **失败不抛**：调用方（`enable-state.ts`）把它变成一条给人看的错误，再决定是否回滚乐观态。
 * 与服务端回包同口径：`{ error }` 就是那句人话。
 *
 * ## `enabledCount` 不是 `enabled.length`
 *
 * `enabled` 只含**当前读者可见**的 id；`enabledCount` 是**项目真相**（含读者看不见的）。
 * 两者不等是刻意的——配额按项目算，不是按「我看得见几个」算。故这里整份原样解析，
 * **不用数组长度重算计数**。
 *
 * ## 与其它客户端同一套范式
 *
 * 同源相对路径、可注入的 `send`、10 秒超时（理由见 `account-api.ts` 文件头）。
 */

export const PATH = {
  state: "/openhive/project/assets",
  enable: "/openhive/project/assets/enable",
  disable: "/openhive/project/assets/disable",
  autoDelivery: "/openhive/project/assets/auto-delivery",
} as const

export const TIMEOUT_MS = 10_000

export interface EnablementState {
  readonly enabled: readonly string[]
  readonly enabledCount: number
  readonly limit: number
  /**
   * 【保留的定制 · 同步上游时不要丢】自动送达（需求 5a，2026-10-27）。
   *
   * `enabled` 是**手动启用**（库里真有启用行）；`auto` 是服务端按「读得到的已发布 skill，
   * 按发布时间倒序、占满剩余预算」自动链进项目的那些。两者都在项目目录里、都对内核可见，
   * 区别只在「下次对账还算不算你」——故分开报，不合并成一个数组。
   *
   * `autoDelivery` 是项目级开关（无行 = 开）：关掉后服务端不再新增自动项。
   */
  readonly auto: readonly string[]
  readonly autoDelivery: boolean
}

export type EnableOutcome =
  | { readonly kind: "ok"; readonly value: EnablementState }
  | { readonly kind: "error"; readonly message: string; readonly code?: string }

export type EnableFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface EnableApi {
  readonly read: (projectId: string) => Promise<EnableOutcome>
  readonly enable: (input: { readonly projectId: string; readonly assetId: string }) => Promise<EnableOutcome>
  readonly disable: (input: { readonly projectId: string; readonly assetId: string }) => Promise<EnableOutcome>
  /** 一键开关自动送达（需求 5a）。回包与 `read` 同形：关掉后 `auto` 就是空的。 */
  readonly setAutoDelivery: (input: {
    readonly projectId: string
    readonly enabled: boolean
  }) => Promise<EnableOutcome>
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

function 解析状态(body: unknown): EnablementState | undefined {
  if (!isRecord(body)) return undefined
  const 值 = body
  const 启用 = 值["enabled"]
  if (!Array.isArray(启用)) return undefined
  // 元素必须是字符串：不再 `String()` 把 `[1]` 洗成 `["1"]`——形状不对就说形状不对。
  if (!启用.every((item): item is string => typeof item === "string")) return undefined
  if (typeof 值["enabledCount"] !== "number") return undefined
  if (typeof 值["limit"] !== "number") return undefined
  // 需求 5a 的两个字段同样是硬形状：缺了不能退化成「没有自动送达」——那与「服务端没升级」
  // 长得一模一样（`#002-02`）。
  const 自动 = 值["auto"]
  if (!Array.isArray(自动)) return undefined
  if (!自动.every((item): item is string => typeof item === "string")) return undefined
  if (typeof 值["autoDelivery"] !== "boolean") return undefined
  return {
    enabled: 启用,
    enabledCount: 值["enabledCount"],
    limit: 值["limit"],
    auto: 自动,
    autoDelivery: 值["autoDelivery"],
  }
}

async function 解包(response: Response): Promise<EnableOutcome> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: "error", message: `服务端回了非 JSON（${response.status}）` }
  }
  if (!response.ok) {
    const 值: Record<string, unknown> = isRecord(body) ? body : {}
    const message = typeof 值["error"] === "string" ? 值["error"] : `请求失败（${response.status}）`
    const code = typeof 值["code"] === "string" ? 值["code"] : undefined
    return code === undefined ? { kind: "error", message } : { kind: "error", message, code }
  }
  const 状态 = 解析状态(body)
  if (状态 === undefined) return { kind: "error", message: "服务端回包形状不对" }
  return { kind: "ok", value: 状态 }
}

export function createEnableApi(send: EnableFetch = 默认发送): EnableApi {
  const 发送 = async (url: string, init?: RequestInit): Promise<EnableOutcome> => {
    try {
      return await 解包(await send(url, init))
    } catch (error) {
      return { kind: "error", message: error instanceof Error ? error.message : "网络请求失败" }
    }
  }

  const 切换 = (url: string, input: { projectId: string; assetId: string }) =>
    发送(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: input.projectId, assetId: input.assetId }),
    })

  return {
    read: (projectId) => 发送(`${PATH.state}?projectId=${encodeURIComponent(projectId)}`),
    enable: (input) => 切换(PATH.enable, input),
    disable: (input) => 切换(PATH.disable, input),
    setAutoDelivery: (input) =>
      发送(PATH.autoDelivery, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: input.projectId, enabled: input.enabled }),
      }),
  }
}
