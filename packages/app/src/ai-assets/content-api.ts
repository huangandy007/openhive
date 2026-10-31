/**
 * 资产内容编辑客户端（2026-10-31）：`PATCH /openhive/assets/:id`。
 *
 * 与 `favorite-api.ts` 同一套范式：同源相对路径、可注入 `send`、Outcome 三态、10 秒超时。
 *
 * ## 回包是服务端读回来的整行
 *
 * 不回「我送了什么」：写完之后内核重新读库，前端拿这一行就地刷新详情。这样连 `updatedAt`
 * 都跟着变，用户看得见「保存生效了」。
 */

/** 与内核 `OpenhiveAssets.PATH.content` 逐字对应（刻意不共享，前端不 import 内核源码）。 */
export const PATH = { base: "/openhive/assets" } as const
export const TIMEOUT_MS = 10_000

export interface 内容补丁 {
  readonly description?: string
  readonly summary?: string
  readonly precautions?: string
}

export type ContentOutcome =
  | { readonly kind: "ok"; readonly value: Record<string, unknown> }
  | { readonly kind: "rejected"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string }

export type ContentFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface ContentApi {
  save(assetId: string, patch: 内容补丁): Promise<ContentOutcome>
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

function 消息(body: unknown, response: Response): string {
  if (isRecord(body) && typeof body["error"] === "string" && body["error"].length > 0) return body["error"]
  return `保存失败（HTTP ${response.status}）`
}

export function createContentApi(send: ContentFetch = 默认发送): ContentApi {
  return {
    save: async (assetId, patch) => {
      let response: Response
      try {
        response = await send(`${PATH.base}/${encodeURIComponent(assetId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
      } catch {
        return { kind: "failed", message: "保存失败，请检查网络后重试" }
      }

      let body: unknown
      try {
        body = await response.json()
      } catch {
        body = undefined
      }

      if (response.status === 401) return { kind: "rejected", message: "登录状态已失效，请重新登录" }
      if (response.status >= 500) return { kind: "failed", message: 消息(body, response) }
      if (!response.ok) return { kind: "rejected", message: 消息(body, response) }
      if (!isRecord(body)) return { kind: "failed", message: "服务返回的数据格式不对" }
      return { kind: "ok", value: body }
    },
  }
}
