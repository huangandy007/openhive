import type { 解析状态 } from "../project/case-materials-api"
import { PREFIX, 默认发送, 请求, type CaseFetch, type 结果 } from "../project/entity-api"

/**
 * 前端侧的案件详情类型。**与后端 DAO 逐字对齐**（`case-entity-list.ts` /
 * `case-material-facts.ts` / `case-graph.ts`），但这里不 import 服务端代码：
 * `packages/app` 的构建产物里不该出现 `drizzle-orm` 那一串。
 *
 * 改了任一侧的字段名，两侧都要改 —— 逐字对齐是这条接缝唯一的契约。
 */
export interface 档案关系 {
  readonly id: string
  readonly type: string
  readonly 方向: "出" | "入"
  readonly 对方id: string
  readonly 对方值: string
  readonly 对方类型: string
  readonly source_kind: string
  readonly basis: string | null
  readonly trust_state: string
  readonly 首: number | null
  readonly 末: number | null
  readonly 次数: number | null
  readonly 金额: string | null
}

export interface 档案事件 {
  readonly id: string
  readonly type: string
  readonly occurred_at: number | null
  readonly occurred_raw: string | null
  readonly summary: string | null
  readonly participants: string[]
  readonly trust_state: string
}

export interface 引用 {
  readonly id: string
  readonly materialId: string
  readonly fileName: string | null
  readonly path: string | null
  readonly locator: unknown
  readonly extractMethod: "机器" | "人工"
  readonly confidence: number | null
}

export interface 实体档案 {
  readonly id: string
  readonly type: string
  /** 大类之下的细类（「号码 · 手机号」的后者）；服务端判不出就没有，界面只显示大类。 */
  readonly subtype?: string
  readonly canonical_value: string
  readonly aliases: string[]
  readonly attrs: Record<string, unknown>
  readonly trust_state: string
  readonly created_at: number
  readonly 关系: readonly 档案关系[]
  readonly 事件: readonly 档案事件[]
  /** 出处的当前页（服务端最多给 500 条）。 */
  readonly 引用: readonly 引用[]
  /** 出处的**全量**条数：界面报数用它，不能拿 `引用.length` 冒充总数。 */
  readonly 引用总数: number
  readonly 一句话: string
  /**
   * 关系 / 事件被上限截断时的整句提示（服务端 `case-entity-list.ts` 的 `实体档案.缺口`）。
   * 没有截断就是 `undefined`——**不给空数组**，免得在「没缺口」和「没算」之间猜。
   *
   * 不画它 = 把「只列了前 200 条」冒充成「就这 200 条」（Task 1 加它是为了说清，不是可选项）。
   */
  readonly 缺口?: readonly string[]
}

export interface 事实行 {
  readonly fact_type: "entity" | "relation" | "event" | "row"
  readonly fact_id: string
  readonly 值: string
  readonly trust_state: string | null
}

export interface 事实组 {
  readonly sheet: string
  readonly 行们: readonly { readonly row_no: number; readonly 事实们: readonly 事实行[] }[]
}

export interface 材料事实清单结果 {
  readonly 材料: {
    readonly id: string
    readonly path: string
    readonly file_name: string
    readonly kind: string
    /**
     * 类型本体在 `../project/case-materials-api`（`解析状态们` 派生，计划 3 的闭集）——
     * 同一件事只留一处，这里不再抄第二份（`#002-06`）。那边说明了为什么要逐字照抄服务端
     * `case-status.ts` 的 `PARSE_STATUSES`。
     */
    readonly parse_status: 解析状态
    readonly parse_detail: unknown
  }
  readonly 分组: readonly 事实组[]
  readonly 缺口: string[]
}

/** 产物复核的一项（字段名与服务端 `case-artifact-citations.ts` 的 `复核项` 逐字相同）。 */
export interface 复核项 {
  readonly fact_type: string
  readonly fact_id: string
  readonly 值: string
  readonly 原文: string | null
  readonly 引用时间: number
  readonly 变更时间: number | null
  readonly 需复核: boolean
  /** 被引用事实当前的信任态；事实行已经不在了就是 `null`。`'已排除'` 行内要标出来。 */
  readonly trust_state: string | null
}

export interface 产物复核结果 {
  readonly 产物: {
    readonly id: string
    readonly path: string
    readonly file_name: string
    readonly kind: string
    readonly fingerprint: string
  } | null
  readonly 引用: readonly 复核项[]
  readonly 需复核: number
  readonly 缺口: string[]
}

export interface 图节点 {
  readonly id: string
  readonly type: string
  /** 大类之下的细类（「号码 · 手机号」的后者）；服务端判不出就没有，界面只显示大类。 */
  readonly subtype?: string
  readonly value: string
  readonly trust_state: string
  readonly 中心: boolean
  readonly 跳数: number
  readonly 关联数: number
}

export interface 图边 {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly type: string
  readonly times: number | null
  readonly amount: string | null
  readonly trust_state: string
}

export interface 关系图结果 {
  readonly 节点: 图节点[]
  readonly 边: 图边[]
  readonly 缺口: string[]
}

export interface 工具结果 {
  readonly 数据: unknown
  readonly 口径?: string
  readonly 缺口?: readonly string[]
}

/**
 * 「✗ 错」的三选一原因（design §9.2 的表格）。**只此一份**：客户端类型由此推导，
 * 界面直接用这个数组渲染，服务端 `case-fact-change.ts` 的 `纠正原因们` 是同一组词。
 */
export const 纠正原因们 = ["识别错", "抽取错", "材料本身有问题"] as const
export type 纠正原因 = (typeof 纠正原因们)[number]

export interface CaseDetailApi {
  readonly profile: (projectId: string, id: string, includeExcluded?: boolean) => Promise<结果<实体档案>>
  readonly materialFacts: (
    projectId: string,
    path: string,
    includeExcluded?: boolean,
  ) => Promise<结果<材料事实清单结果>>
  readonly timeline: (projectId: string, id: string, 起?: number, 止?: number) => Promise<结果<工具结果>>
  readonly money: (projectId: string, id: string, 起?: number, 止?: number) => Promise<结果<工具结果>>
  readonly graph: (
    projectId: string,
    id: string,
    跳数?: 1 | 2,
    类型?: readonly string[],
  ) => Promise<结果<关系图结果>>
  /** 产物页（design §9.4）：这份产物引用了哪几条事实、其中几条的依据后来改过。 */
  readonly review: (projectId: string, path: string) => Promise<结果<产物复核结果>>
  /**
   * 可信状态裁决（design §9.1 / §9.2）：动作而不是目标状态，落点由服务端算。
   * 回包只给服务端算出的新 `trustState`——界面以它为准重取档案，不自己猜。
   */
  readonly trust: (input: {
    readonly projectId: string
    readonly factType: "entity" | "relation" | "event"
    readonly factId: string
    readonly action: "确认" | "排除" | "存疑"
    readonly reasonKind?: 纠正原因
    readonly reasonText?: string
  }) => Promise<结果<{ readonly trustState: string }>>
}

const 项目参数 = (projectId: string) => {
  const 参数 = new URLSearchParams({ projectId })
  return 参数
}

export function createCaseDetailApi(send: CaseFetch = 默认发送): CaseDetailApi {
  return {
    profile: async (projectId, id, includeExcluded) => {
      const 参数 = 项目参数(projectId)
      参数.set("id", id)
      if (includeExcluded === true) 参数.set("includeExcluded", "true")
      return 请求<实体档案>(send, `${PREFIX}/entity?${参数.toString()}`)
    },
    materialFacts: async (projectId, path, includeExcluded) => {
      const 参数 = 项目参数(projectId)
      参数.set("path", path)
      if (includeExcluded === true) 参数.set("includeExcluded", "true")
      return 请求<材料事实清单结果>(send, `${PREFIX}/material-facts?${参数.toString()}`)
    },
    timeline: async (projectId, id, 起, 止) => {
      const 参数 = 项目参数(projectId)
      参数.set("id", id)
      if (起 !== undefined) 参数.set("起", String(起))
      if (止 !== undefined) 参数.set("止", String(止))
      return 请求<工具结果>(send, `${PREFIX}/timeline?${参数.toString()}`)
    },
    money: async (projectId, id, 起, 止) => {
      const 参数 = 项目参数(projectId)
      参数.set("id", id)
      if (起 !== undefined) 参数.set("起", String(起))
      if (止 !== undefined) 参数.set("止", String(止))
      return 请求<工具结果>(send, `${PREFIX}/money?${参数.toString()}`)
    },
    graph: async (projectId, id, 跳数, 类型) => {
      const 参数 = 项目参数(projectId)
      参数.set("id", id)
      if (跳数 !== undefined) 参数.set("跳数", String(跳数))
      if (类型 !== undefined && 类型.length > 0) 参数.set("type", 类型.join(","))
      return 请求<关系图结果>(send, `${PREFIX}/graph?${参数.toString()}`)
    },
    review: (projectId, path) => {
      const 参数 = new URLSearchParams({ projectId, path })
      return 请求<产物复核结果>(send, `${PREFIX}/artifacts/review?${参数.toString()}`)
    },
    trust: (input) =>
      请求<{ readonly trustState: string }>(send, `${PREFIX}/facts/trust`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // 字段名与服务端 `handleTrust` 逐字一致（`projectId/factType/factId/action/reasonKind/reasonText`）。
        // `JSON.stringify` 会丢掉 `undefined` 的键：确认 / 存疑不带原因时，服务端看到的是「没有这个字段」。
        body: JSON.stringify({
          projectId: input.projectId,
          factType: input.factType,
          factId: input.factId,
          action: input.action,
          reasonKind: input.reasonKind,
          reasonText: input.reasonText,
        }),
      }),
  }
}
