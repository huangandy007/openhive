import { 案件伪路径 } from "../center/case-route"
import { PREFIX, 默认发送, 请求, type CaseFetch, type 结果 } from "./entity-api"

/**
 * 主动提醒的客户端（计划 7 Task 9）。
 *
 * 与 `entity-api.ts` / `case-materials-api.ts` 同一套范式：同源相对路径、可注入的 `send`、
 * **失败不抛**（收成 `{ kind: "error", message, code? }`）。
 */

export interface 提醒行 {
  readonly id: string
  readonly rule_id: string
  readonly 标题: string
  readonly 内容: string
  readonly 事实: unknown
  readonly created_at: number
  readonly read_at: number | null
  readonly handled_at: number | null
}

export interface CaseAlertsApi {
  readonly list: (projectId: string) => Promise<结果<提醒行[]>>
  readonly refresh: (projectId: string) => Promise<结果<{ 新建: number; 提醒: 提醒行[] }>>
  readonly markRead: (projectId: string, ids: readonly string[]) => Promise<结果<{ 已读: number }>>
}

const 体 = (init: RequestInit) => ({
  ...init,
  headers: { "content-type": "application/json" },
})

export function createCaseAlertsApi(send: CaseFetch = 默认发送): CaseAlertsApi {
  return {
    list: async (projectId) => {
      const 参数 = new URLSearchParams({ projectId })
      const 回 = await 请求<{ 提醒: 提醒行[] }>(send, `${PREFIX}/alerts?${参数.toString()}`)
      return 回.kind === "error" ? 回 : { kind: "ok", value: 回.value.提醒 }
    },
    refresh: async (projectId) =>
      请求<{ 新建: number; 提醒: 提醒行[] }>(
        send,
        `${PREFIX}/alerts/refresh`,
        体({ method: "POST", body: JSON.stringify({ projectId }) }),
      ),
    markRead: async (projectId, ids) =>
      请求<{ 已读: number }>(
        send,
        `${PREFIX}/alerts/read`,
        体({ method: "POST", body: JSON.stringify({ projectId, ids }) }),
      ),
  }
}

/**
 * 中栏提醒清单的伪路径。`all` 是这一版唯一的范围（按项目）。
 *
 * ⚠️ 不手拼 `case://`：构造器只有一个（`center/case-route.ts` 的 `案件伪路径`，`#002-06`）。
 * 从左栏/项目侧 import 中栏的构造器有先例：`entity-api.ts` 的 `实体路径`。
 */
export function 提醒路径(projectId: string): string {
  return 案件伪路径({ projectId, view: "alerts", arg: "all" })
}
