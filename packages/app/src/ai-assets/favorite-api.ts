/**
 * 收藏客户端（2026-10-29）：`POST /openhive/asset-favorite`。
 *
 * 与 `asset-catalog-api.ts` 同一套范式：同源相对路径、可注入的 `send`、Outcome 三态
 * （ok / rejected / failed）、严格解析、10 秒超时。理由见 `account-api.ts` 文件头。
 *
 * ## 送目标态，不送「翻转」
 *
 * 体是 `{ assetId, favorited }`。双击 / 超时重试会把同一个请求送两遍——「翻转」语义下
 * 第二遍会把状态翻回去，而用户只点了一次。目标态天然幂等，内核那边也按目标态实现。
 *
 * ## 回包给的是服务端读回来的真值
 *
 * `favoriteCount` 不由前端 `±1` 算：并发收藏、旧缓存、读到一半状态变了，前端自己加减
 * 迟早对不上。写完之后内核重新读库，这里原样交回。
 */

/** 与内核 `OpenhiveAssetFavorite.PATH` 逐字对应（刻意不共享，前端不 import 内核源码，`#003-05`）。 */
export const PATH = { set: "/openhive/asset-favorite" } as const

/** 一次请求的上限：与 `account-api.ts` 同值同理由。 */
export const TIMEOUT_MS = 10_000

/** 写完之后的样子：我收没收藏 ＋ 这个资产一共几人收藏。 */
export interface 收藏状态 {
  readonly assetId: string
  readonly favorited: boolean
  readonly favoriteCount: number
}

export type FavoriteOutcome =
  | { readonly kind: "ok"; readonly value: 收藏状态 }
  /** 服务端明确拒绝（4xx）。 */
  | { readonly kind: "rejected"; readonly message: string }
  /** 没说成：网络 / 超时 / 5xx / 返回体形状不对。 */
  | { readonly kind: "failed"; readonly message: string }

/** 只用到的那一小片 `fetch`（与 `CatalogFetch` 同形，便于注入同一个替身）。 */
export type FavoriteFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface FavoriteApi {
  /** `favorited` 是**目标态**（true = 收藏，false = 取消），不是「翻转」。 */
  set(assetId: string, favorited: boolean): Promise<FavoriteOutcome>
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

/** 三列都必须是本来的类型：缺一列或类型漂了都算形状变了（不猜默认值）。 */
function 收藏回包(value: unknown): 收藏状态 | undefined {
  if (!isRecord(value)) return undefined
  const { assetId, favorited, favoriteCount } = value
  if (typeof assetId !== "string" || typeof favorited !== "boolean") return undefined
  if (typeof favoriteCount !== "number" || !Number.isFinite(favoriteCount)) return undefined
  return { assetId, favorited, favoriteCount }
}

function 消息(body: unknown, response: Response): string {
  if (isRecord(body) && typeof body["error"] === "string" && body["error"].length > 0) return body["error"]
  return `收藏失败（HTTP ${response.status}）`
}

/** 建一份客户端。`send` 省略 = 真实 `fetch` ＋ 超时（测试注入替身）。 */
export function createFavoriteApi(send: FavoriteFetch = 默认发送): FavoriteApi {
  return {
    set: async (assetId, favorited) => {
      let response: Response
      try {
        response = await send(PATH.set, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId, favorited }),
        })
      } catch {
        return { kind: "failed", message: "收藏失败，请检查网络后重试" }
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

      const value = 收藏回包(body)
      if (value === undefined) return { kind: "failed", message: "服务返回的数据格式不对" }
      return { kind: "ok", value }
    },
  }
}
