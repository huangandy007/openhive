/**
 * 卡片模板客户端（设计 §3 / §4 / §6）。
 *
 * 与 `entity-api.ts` / `case-materials-api.ts` 同一套范式：同源相对路径、可注入的 `send`、
 * 10 秒超时、**失败不抛**（收成 `{ kind: "error", message, code? }`）。
 *
 * ⚠️ **不做逐字段形状校验**（同 `entity-api.ts`）：本客户端只把服务端给的东西交给界面，
 * 一处校验等于把「服务端多给一个字段」变成整页空白。词表是例外——它是下拉的数据源，
 * 形状错了宁可不显示也不猜（`词表缓存` 只在成功时写入）。
 */
import { PREFIX, 默认发送, 请求, 请求带错误体, type CaseFetch, type 结果 } from "./entity-api"

/**
 * 槽名：与内核 `九格们` 同一个协议集合。
 *
 * 为什么前端也要列一遍：槽表是**类型**（`槽表: Record<模板槽名, …>`），编译期要它。
 * 展示顺序不读这里——编辑器按词表 `槽们` 渲染，两张表不一致时以词表为准（服务端是边界）。
 */
export const 模板槽名们 = ["谁", "和谁", "何时", "何时止", "何地", "多少钱", "其他"] as const
export type 模板槽名 = (typeof 模板槽名们)[number]

/** 用户模板 id 的前缀（与内核 `用户模板前缀` 同一个协议字面量）。 */
export const 用户模板前缀 = "用户:"
export const 是用户模板id = (id: string): boolean => id.startsWith(用户模板前缀)

export interface 槽填法 {
  readonly 字段: string
  readonly 角色?: string
  readonly 实体类型?: string
}

/** 单值槽（谁/何时/何时止/多少钱）服务端读回是对象，其余槽是数组；两种都收。 */
export type 模板槽位 = Partial<Record<模板槽名, 槽填法 | readonly 槽填法[]>>

export interface 模板行 {
  readonly id: string
  readonly name: string
  readonly event_type: string
  readonly slots: 模板槽位
  readonly required: readonly 模板槽名[]
  readonly version: number
  readonly verified_at: number | null
  readonly hit_count: number
  readonly disabled_at: number | null
}

export interface 模板定义输入 {
  readonly name: string
  readonly eventType: string
  readonly slots: 模板槽位
  readonly required: readonly 模板槽名[]
}

export interface 词表事件类型 {
  readonly 值: string
  readonly 可选: boolean
  readonly 原因?: string
}

export interface 模板词表 {
  readonly 槽们: readonly 模板槽名[]
  readonly 事件类型们: readonly 词表事件类型[]
  readonly 字段们: readonly { readonly 值: string; readonly 显示名: string; readonly 种类: string }[]
  readonly 槽可选字段们: { readonly [K in 模板槽名]: readonly string[] }
  readonly 其他不可选种类: readonly string[]
  readonly 角色们: readonly { readonly 值: string; readonly 地点类: boolean }[]
  readonly 默认角色: { readonly 谁: string; readonly 和谁: string; readonly 何地: string }
  readonly 实体类型们: readonly string[]
  readonly 必填恒含: 模板槽名
}

export interface 预览参与者 {
  readonly 角色: string
  readonly 提及: string
  readonly 规范值: string
  readonly 实体: string | null
  readonly 实体类型: string
  readonly ordinal: number
}

export interface 预览卡 {
  readonly id: string
  readonly type: string
  readonly 摘要: string
  readonly occurredAt: number | null
  readonly occurredRaw: string | null
  readonly precision: string
  readonly occurredEnd: number | null
  readonly amount: string | null
  readonly currency: string
  readonly attrs: Record<string, unknown>
  readonly 参与者们: readonly 预览参与者[]
  readonly 出处: { readonly sheet: string; readonly rowNo: number }
}

export interface 预览输出 {
  readonly 卡片数: number
  readonly 跳过: Record<string, number>
  readonly 卡片们: readonly 预览卡[]
  readonly 工作表们: readonly { readonly sheet: string; readonly 卡片数: number; readonly 跳过: Record<string, number> }[]
}

export interface 转正输出 {
  readonly verified_at: number
  readonly 卡片数: number
  readonly 跳过: Record<string, number>
  readonly already?: boolean
}

export type 转正结果 =
  | { readonly kind: "ok"; readonly value: 转正输出 }
  | { readonly kind: "error"; readonly message: string; readonly code?: string; readonly 跳过?: Record<string, number> }

export interface CaseTemplateApi {
  readonly list: (projectId: string, 含停用?: boolean) => Promise<结果<模板行[]>>
  readonly vocab: () => Promise<结果<模板词表>>
  readonly create: (input: { readonly projectId: string } & 模板定义输入) => Promise<结果<模板行>>
  readonly update: (input: { readonly projectId: string; readonly id: string } & 模板定义输入) => Promise<结果<模板行>>
  readonly disable: (input: { readonly projectId: string; readonly id: string }) => Promise<结果<{ ok: true }>>
  readonly restore: (input: { readonly projectId: string; readonly id: string }) => Promise<结果<{ ok: true }>>
  readonly preview: (input: {
    readonly projectId: string
    readonly materialId: string
    readonly template: 模板定义输入
  }) => Promise<结果<预览输出>>
  readonly verify: (input: {
    readonly projectId: string
    readonly id: string
    readonly materialId: string
  }) => Promise<转正结果>
}

const 体 = (init: RequestInit) => ({ ...init, headers: { "content-type": "application/json" } })

/**
 * 词表缓存：**只在成功时写入**。失败（网络 / 内核没升级）下次重试；页面刷新即换代。
 * 词表是代码常量，进程内不会变——设计 §3 的「刷新即换代」就是这一行。
 */
let 词表缓存: 模板词表 | undefined

/** 测试用：清掉模块级缓存（生产代码不调用）。 */
export function 复位词表缓存(): void {
  词表缓存 = undefined
}

export function createCaseTemplateApi(send: CaseFetch = 默认发送): CaseTemplateApi {
  return {
    list: async (projectId, 含停用) => {
      // projectId 用 `encodeURIComponent`（同 `entity-api.ts` 的 groups、`case-materials-api`）；
      // `URLSearchParams` 会把空格编成 `+`，与本文件用例约定的 `%20` 不符（服务端两种都解码等价）。
      const 查 = `projectId=${encodeURIComponent(projectId)}${含停用 === true ? "&含停用=true" : ""}`
      const 回 = await 请求<{ list: 模板行[] }>(send, `${PREFIX}/card-templates?${查}`)
      return 回.kind === "error" ? 回 : { kind: "ok", value: 回.value.list }
    },

    vocab: async () => {
      if (词表缓存 !== undefined) return { kind: "ok", value: 词表缓存 }
      const 回 = await 请求<模板词表>(send, `${PREFIX}/card-template/vocab`)
      if (回.kind === "error") return 回
      词表缓存 = 回.value
      return { kind: "ok", value: 回.value }
    },

    create: (input) =>
      请求<模板行>(send, `${PREFIX}/card-template/create`, 体({ method: "POST", body: JSON.stringify(input) })),

    update: (input) =>
      请求<模板行>(send, `${PREFIX}/card-template/update`, 体({ method: "POST", body: JSON.stringify(input) })),

    disable: (input) =>
      请求<{ ok: true }>(send, `${PREFIX}/card-template/disable`, 体({ method: "POST", body: JSON.stringify(input) })),

    restore: (input) =>
      请求<{ ok: true }>(send, `${PREFIX}/card-template/restore`, 体({ method: "POST", body: JSON.stringify(input) })),

    preview: (input) =>
      请求<预览输出>(send, `${PREFIX}/card-template/preview`, 体({ method: "POST", body: JSON.stringify(input) })),

    verify: async (input) => {
      const 回 = await 请求带错误体<转正输出>(
        send,
        `${PREFIX}/card-template/verify`,
        体({ method: "POST", body: JSON.stringify(input) }),
      )
      if (回.kind === "ok") return { kind: "ok", value: 回.value }
      const 跳过 = 读跳过(回.错误体)
      return {
        kind: "error",
        message: 回.message,
        ...(回.code === undefined ? {} : { code: 回.code }),
        ...(跳过 === undefined ? {} : { 跳过 }),
      }
    },
  }
}

/** 错误体里的 `跳过: {原因: 数}`：形状不对就不带（宁可不显示，也不猜）。 */
function 读跳过(体: unknown): Record<string, number> | undefined {
  if (typeof 体 !== "object" || 体 === null) return undefined
  const 原 = (体 as { 跳过?: unknown }).跳过
  if (typeof 原 !== "object" || 原 === null || Array.isArray(原)) return undefined
  const 出: Record<string, number> = {}
  for (const [键, 值] of Object.entries(原)) {
    if (typeof 值 !== "number" || !Number.isInteger(值) || 值 < 0) return undefined
    出[键] = 值
  }
  return 出
}
