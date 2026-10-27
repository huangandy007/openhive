/**
 * 账号偏好客户端（需求 6，2026-10-27）：`GET / PUT /openhive/preferences`。
 *
 * 只服务一件事：让中栏的「每页条数」**跨设备一致**（在单位选 50，回家登录还是 50）。
 *
 * ## 失败不打断浏览
 *
 * 偏好是锦上添花：读不到就用默认 20，写不进去就当这次没记住。**不抛错、不弹提示**——
 * 为了「记不住每页几条」把整个资产页打上红条，比丢了这个偏好更糟。
 *
 * ## 与其它客户端同一套范式
 *
 * 同源相对路径、可注入的 `send`、10 秒超时（理由见 `account-api.ts` 文件头）。
 */

export const PATH = { preferences: "/openhive/preferences" } as const

export const TIMEOUT_MS = 10_000

/** 本轮用到的偏好键（与内核 `auth/preference.ts` 的闭集逐字对应，另写一份，`#003-05`）。 */
export const PAGE_SIZE_KEY = "asset.pageSize"

export type PreferencesFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface PreferencesApi {
  /** 读全量映射；失败回 `undefined`（调用方用默认值）。 */
  read(): Promise<Record<string, string> | undefined>
  /** 写一个键；**不抛错**，失败只是返回 `false`（调用方不关心）。 */
  write(key: string, value: string): Promise<boolean>
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

function 偏好映射(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value) || !isRecord(value["preferences"])) return undefined
  const 结果: Record<string, string> = {}
  for (const [key, item] of Object.entries(value["preferences"])) {
    if (typeof item === "string") 结果[key] = item
  }
  return 结果
}

export function createPreferencesApi(send: PreferencesFetch = 默认发送): PreferencesApi {
  return {
    read: async () => {
      try {
        const response = await send(PATH.preferences)
        if (!response.ok) return undefined
        return 偏好映射(await response.json())
      } catch {
        return undefined
      }
    },
    write: async (key, value) => {
      try {
        const response = await send(PATH.preferences, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        })
        return response.ok
      } catch {
        return false
      }
    },
  }
}
