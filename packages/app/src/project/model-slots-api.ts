/**
 * 设置页「当前生效模型」的客户端（2026-11-08，模型统一配置设计 §3.4）。
 *
 * 与 `case-materials-api.ts` 同一套范式：同源相对路径、可注入的 `send`、
 * 失败不抛（收成 `{ kind: "error" }`）。
 *
 * ## 形状是闭集，不认识就整份判错
 *
 * `source` 只认 `task_model` / `model` / `null`。服务端将来多一种来源时，最坏行为是
 * 「这一块不显示」——好过把未知来源画成「显式配置」（`#002-02`：不知道 ≠ 空）。
 */
import { defaultSend, readJson, trySend, type ForkFetch } from "./openhive-fetch"

export const PATH = {
  models: "/openhive/config/models",
} as const

export type 槽位来源 = "task_model" | "model" | null

export interface 模型槽位 {
  readonly model: string | null
  readonly source: 槽位来源
}

export interface 生效模型 {
  readonly chat: 模型槽位
  readonly task: 模型槽位
}

export type 模型槽位结果 =
  | { readonly kind: "ok"; readonly value: 生效模型 }
  | { readonly kind: "error"; readonly message: string }

const 是来源 = (值: unknown): 值 is 槽位来源 =>
  值 === null || 值 === "task_model" || 值 === "model"

function 是记录(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

function 解析槽位(值: unknown): 模型槽位 | undefined {
  if (!是记录(值)) return undefined
  const model = 值["model"]
  if (model !== null && typeof model !== "string") return undefined
  if (!是来源(值["source"])) return undefined
  return { model, source: 值["source"] }
}

export function 解析生效模型(体: unknown): 生效模型 | undefined {
  if (!是记录(体)) return undefined
  const chat = 解析槽位(体["chat"])
  const task = 解析槽位(体["task"])
  if (chat === undefined || task === undefined) return undefined
  return { chat, task }
}

export async function 读生效模型(send: ForkFetch = defaultSend): Promise<模型槽位结果> {
  const response = await trySend(send, PATH.models)
  if (response === undefined) return { kind: "error", message: "服务端没有响应" }
  if (!response.ok) return { kind: "error", message: `服务端回了 ${response.status}` }
  const 值 = 解析生效模型(await readJson(response))
  if (值 === undefined) return { kind: "error", message: "服务端回包形状不对" }
  return { kind: "ok", value: 值 }
}
