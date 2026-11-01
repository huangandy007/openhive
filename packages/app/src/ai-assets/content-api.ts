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
export const PATH = {
  base: "/openhive/assets",
  // 【保留的定制 · 同步上游时不要丢】版本迭代（2026-11-01）。
  iteration: (id: string) => `/openhive/assets/${encodeURIComponent(id)}/iteration`,
  iterationSubmit: (id: string) => `/openhive/assets/${encodeURIComponent(id)}/iteration/submit`,
  iterationAbort: (id: string) => `/openhive/assets/${encodeURIComponent(id)}/iteration/abort`,
} as const
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

/** 迭代三次调用的回包：成功时可能带 `workspace`（发起才有，内核回 `null` 时视为没有）。 */
export type 迭代结果 =
  | { readonly kind: "ok"; readonly value: { readonly workspace?: string } }
  | { readonly kind: "rejected"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string }

export type ContentFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface ContentApi {
  save(assetId: string, patch: 内容补丁): Promise<ContentOutcome>
  /** 发起迭代：`note` 是变更说明（服务端必填），`projectId` 是工作副本落在哪个项目。 */
  iteration(assetId: string, note: string, projectId: string): Promise<迭代结果>
  submitIteration(assetId: string): Promise<迭代结果>
  abortIteration(assetId: string): Promise<迭代结果>
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

// `动作` 有默认值：`save` 的既有文案与调用点一个字都不用动，迭代调用再传「操作」/「提交」。
function 消息(body: unknown, response: Response, 动作 = "保存"): string {
  if (isRecord(body) && typeof body["error"] === "string" && body["error"].length > 0) return body["error"]
  return `${动作}失败（HTTP ${response.status}）`
}

export function createContentApi(send: ContentFetch = 默认发送): ContentApi {
  /**
   * 迭代的一次 POST 三态翻译。`save` 用的是 PATCH 且回包是整行，形状不同，所以只共用
   * 「怎么把 HTTP 结果读成 ok / rejected / failed」这一小段，不强行合并。
   */
  const 发送 = async (
    url: string,
    body: Record<string, unknown> | undefined,
    失败提示: string,
    动作: string,
  ): Promise<迭代结果> => {
    let response: Response
    try {
      response = await send(url, {
        method: "POST",
        // 不带体时不发 Content-Type：空体配 application/json 有些中间层会拒。
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      })
    } catch {
      return { kind: "failed", message: 失败提示 }
    }

    let 回包: unknown
    try {
      回包 = await response.json()
    } catch {
      回包 = undefined
    }

    if (response.status === 401) return { kind: "rejected", message: "登录状态已失效，请重新登录" }
    if (response.status >= 500) return { kind: "failed", message: 消息(回包, response, 动作) }
    if (!response.ok) return { kind: "rejected", message: 消息(回包, response, 动作) }
    if (!isRecord(回包)) return { kind: "failed", message: "服务返回的数据格式不对" }
    // `workspace` 只对发起迭代有意义；不是字符串就当作没给（界面退回「没有路径」的提示），
    // 不因此把一次**已经成功**的流转报成失败。
    const 路径 = 回包["workspace"]
    return { kind: "ok", value: typeof 路径 === "string" && 路径.length > 0 ? { workspace: 路径 } : {} }
  }

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
    iteration: (assetId, note, projectId) =>
      发送(PATH.iteration(assetId), { note, projectId }, "操作失败，请检查网络后重试", "操作"),
    submitIteration: (assetId) =>
      发送(PATH.iterationSubmit(assetId), undefined, "提交失败，请检查网络后重试", "提交"),
    abortIteration: (assetId) => 发送(PATH.iterationAbort(assetId), undefined, "操作失败，请检查网络后重试", "操作"),
  }
}
