/**
 * 能力面板的两个写动作（2026-11-01，设计 §4.3 / §4.4）。
 *
 * 与页面其它调用一致：同源 cookie、JSON、失败交回一句可读的人话（由面板 / 表单显示，不吞）。
 *
 * ## 为什么是两次串行请求，而不是一个「原子」端点
 *
 * 设计 §4.3 明确不做假原子：入库成功、提交失败是**可能且可恢复**的中间态。前端能做的是
 * 如实分开这两段——第二段失败时把 `assetId` 也带回来，界面据此刷新成「草稿」，
 * 让用户点面板上的「提交审核」重试，而不是再点一次一键入库、多建一份草稿。
 */

/** 「未入库 → 入库」要交给服务端的字段（设计 §4.4）。 */
export interface 入库入参 {
  readonly projectId: string
  /** 相对项目目录的技能目录（内核条目原样透传的 `skillPath`，不从 `location` 反推）。 */
  readonly skillPath: string
  readonly name: string
  /** 必填非空：`auth.asset` 有 `CHECK (btrim(description) <> '')`，空串存不进去。 */
  readonly description: string
  readonly category: string
  readonly visibility: string
  readonly department?: string
}

/** 单个动作的结果：成功不带值，失败带一句人话。 */
export type 动作结果 = { readonly ok: true } | { readonly ok: false; readonly message: string }

/**
 * 「入库并提交」的结果。
 *
 * 失败时带上 `assetId` = **草稿已经建出来了**（第二段失败）；界面要把那一行刷成「草稿」，
 * 并告诉用户点「提交审核」重试。没有 `assetId` = 第一段就失败了，什么都还没建。
 */
export type 入库提交结果 =
  | { readonly assetId: string }
  | { readonly error: string; readonly assetId?: string }

function 是对象(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

/** 服务端那句话优先；没有就回一句带状态码的兜底（不把 `undefined` 显示给用户）。 */
function 错误话(体: unknown, 兜底: string): string {
  if (是对象(体) && typeof 体["error"] === "string" && 体["error"] !== "") return 体["error"]
  return 兜底
}

async function 发(url: string, body: unknown): Promise<动作结果> {
  let 回包: Response
  try {
    回包 = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, message: "连接服务失败，请检查网络后重试" }
  }
  if (回包.ok) return { ok: true }
  const 体: unknown = await 回包.json().catch(() => undefined)
  return { ok: false, message: 错误话(体, `请求失败（${回包.status}）`) }
}

/** 已入库的草稿 → 提交审核（`POST /openhive/assets/:id/submit`）。 */
export async function 提交审核(assetId: string): Promise<动作结果> {
  return 发(`/openhive/assets/${encodeURIComponent(assetId)}/submit`, {})
}

/** 未入库 → 入库 → 提交。两段串行：第二段失败是**可恢复**的中间态（设计 §4.3）。 */
export async function 入库并提交(输入: 入库入参): Promise<入库提交结果> {
  let 建: Response
  try {
    建 = await fetch("/openhive/assets/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(输入),
    })
  } catch {
    return { error: "连接服务失败，请检查网络后重试" }
  }

  const 体: unknown = await 建.json().catch(() => undefined)
  if (!建.ok) return { error: 错误话(体, `入库失败（${建.status}）`) }
  // 回包没给编号 ⇒ 第二段没有可用的目标。不拿 `String(undefined)` 拼一个 "undefined" 去请求。
  if (!是对象(体) || typeof 体["assetId"] !== "string" || 体["assetId"] === "") {
    return { error: "入库失败：服务端没有返回资产编号" }
  }

  const assetId = 体["assetId"]
  const 交 = await 发(`/openhive/assets/${encodeURIComponent(assetId)}/submit`, {})
  return 交.ok
    ? { assetId }
    : { error: `已入库，但提交失败：${交.message}。请再点一次「提交审核」。`, assetId }
}
