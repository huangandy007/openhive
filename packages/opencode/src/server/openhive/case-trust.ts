export * as OpenhiveCaseTrust from "./case-trust"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import {
  type 纠正原因,
  type 留痕类型,
  记变更,
  最近一次可撤销,
  操作人快照,
} from "./case-fact-change"
import type { 事实信任态 } from "./case-fact-store"
import { inTransaction, type Queryable } from "./case-store"

/**
 * 裁决：人给事实打 ✓ / ✗ / ？、改正错值、撤销上一次人工动作（设计 §9.1 / §9.2 / §9.6）。
 *
 * ## 一个事务里做三件事
 *
 * 读当前值（`for update`）→ 改 → 写留痕。**留痕必须与事实改动同事务**：分开写的话，
 * 进程在中间挂掉就留下「改了但没有痕迹」，而 §9.6 的整个用途就是「事后说得清」。
 *
 * ## 为什么读当前值要 `for update`
 *
 * 两个人同时改同一条事实时，后写的那次若基于读到的旧值算 `before`，留痕里的「改前」
 * 就是假的。锁住这一行，后到的事务会等，然后再读到的就是新值。
 *
 * ## 动作而不是目标状态
 *
 * 与 `case-parse.ts` 的 `POST /parse` 同一条口径：界面发「确认 / 排除」，落点由这里算。
 */

export const 裁决动作们 = ["确认", "排除", "存疑", "修正", "撤销"] as const
export type 裁决动作 = (typeof 裁决动作们)[number]

export const 裁决错误码们 = [
  "fact_not_found",
  "bad_changes",
  "merge_required",
  "basis_required",
  "nothing_to_undo",
] as const
export type 裁决错误码 = (typeof 裁决错误码们)[number]

export class 裁决冲突 extends Error {
  constructor(
    message: string,
    readonly code: 裁决错误码,
  ) {
    super(message)
    this.name = "裁决冲突"
  }
}

/** 一条事实「人改得动」的那几个值。`trustState` 单独放，它不属于「值」。 */
export interface 当前事实 {
  readonly trustState: 事实信任态
  readonly 值: Record<string, unknown>
}

const 信任态们 = ["自动抽取", "已确认", "已修正", "已排除", "存疑"] as const

function 是信任态(值: unknown): 值 is 事实信任态 {
  return typeof 值 === "string" && (信任态们 as readonly string[]).includes(值)
}

function 文本(值: unknown): string | null {
  return 值 === null || 值 === undefined ? null : String(值)
}

function 数字(值: unknown): number | null {
  if (值 === null || 值 === undefined) return null
  const n = Number(值)
  if (!Number.isFinite(n)) throw new Error(`数值列读回的不是数字：${String(值)}`)
  return n
}

/**
 * 读一条事实当前的状态与可改值。**`for update` 必须在事务里**（不在事务里调用会立刻生效，
 * 调用方自己保证传进来的是 `tx`）。
 *
 * 三种事实的「值」形状就是 `case-fact-change.ts` 留痕里 `before` / `after` 的形状——
 * 撤销靠它恢复，所以两边**必须是同一份**：改这里就要改撤销。
 */
export async function 读当前事实(
  db: Queryable,
  projectId: string,
  type: 留痕类型,
  id: string,
): Promise<当前事实 | undefined> {
  if (type === "entity") {
    const 行 = rowsOf(
      await db.execute(sql`
        select trust_state, canonical_value, type from auth.case_entity
         where project_id = ${projectId} and id = ${id}
         for update
      `),
    )[0]
    if (行 === undefined) return undefined
    return {
      trustState: String(行.trust_state) as 事实信任态,
      值: { canonicalValue: String(行.canonical_value), entityType: String(行.type) },
    }
  }
  if (type === "relation") {
    const 行 = rowsOf(
      await db.execute(sql`
        select trust_state, amount, basis, type from auth.case_relation
         where project_id = ${projectId} and id = ${id}
         for update
      `),
    )[0]
    if (行 === undefined) return undefined
    return {
      trustState: String(行.trust_state) as 事实信任态,
      值: {
        amount: 数字(行.amount),
        basis: 文本(行.basis),
        relationType: String(行.type),
      },
    }
  }
  const 行 = rowsOf(
    await db.execute(sql`
      select trust_state, summary, occurred_at, precision from auth.case_event
       where project_id = ${projectId} and id = ${id}
       for update
    `),
  )[0]
  if (行 === undefined) return undefined
  return {
    trustState: String(行.trust_state) as 事实信任态,
    值: {
      summary: 文本(行.summary),
      occurredAt: 数字(行.occurred_at),
      precision: 文本(行.precision),
    },
  }
}

export interface 裁决输入 {
  readonly projectId: string
  readonly factType: 留痕类型
  readonly factId: string
  readonly action: 裁决动作
  readonly reasonKind?: 纠正原因 | null
  readonly reasonText?: string | null
  /** 只有 `修正` 用：白名单字段 → 新值。 */
  readonly changes?: Record<string, unknown>
  readonly by: string
}

export interface 裁决结果 {
  readonly trustState: 事实信任态
  readonly 值: Record<string, unknown>
  readonly 留痕: string
}

async function 只改状态(
  tx: Queryable,
  input: 裁决输入,
  当前: 当前事实,
  目标: 事实信任态,
): Promise<裁决结果> {
  const 表 =
    input.factType === "entity"
      ? sql`auth.case_entity`
      : input.factType === "relation"
        ? sql`auth.case_relation`
        : sql`auth.case_event`
  await tx.execute(sql`
    update ${表} set trust_state = ${目标}
     where project_id = ${input.projectId} and id = ${input.factId}
  `)
  const 留痕 = await 记变更(tx, {
    projectId: input.projectId,
    factType: input.factType,
    factId: input.factId,
    action: input.action as "确认" | "排除" | "存疑",
    before: { trustState: 当前.trustState },
    after: { trustState: 目标 },
    reasonKind: input.reasonKind ?? null,
    reasonText: input.reasonText ?? null,
    actor: await 操作人快照(tx, input.by),
  })
  return { trustState: 目标, 值: 当前.值, 留痕 }
}

async function 撤销(
  tx: Queryable,
  input: 裁决输入,
  当前: 当前事实,
): Promise<裁决结果> {
  const 目标 = await 最近一次可撤销(tx, input.projectId, input.factType, input.factId)
  if (目标 === undefined) throw new 裁决冲突("这条事实没有可以撤销的人工动作", "nothing_to_undo")

  const 前 = 目标.before
  if (typeof 前 !== "object" || 前 === null) throw new 裁决冲突("留痕里没有可恢复的前值", "nothing_to_undo")
  const 快照 = 前 as Record<string, unknown>
  const 前状态 = 快照["trustState"]
  if (!是信任态(前状态)) throw new 裁决冲突("留痕里的前状态不合法", "nothing_to_undo")

  const 值: Record<string, unknown> = { ...当前.值 }
  for (const 键 of Object.keys(当前.值)) {
    if (键 in 快照) 值[键] = 快照[键]
  }

  await 写回(tx, input.projectId, input.factType, input.factId, 前状态, 值)
  const 留痕 = await 记变更(tx, {
    projectId: input.projectId,
    factType: input.factType,
    factId: input.factId,
    action: "撤销",
    before: { trustState: 当前.trustState, ...当前.值 },
    after: { trustState: 前状态, ...值, 被撤销的留痕: 目标.id },
    actor: await 操作人快照(tx, input.by),
  })
  return { trustState: 前状态, 值, 留痕 }
}

/**
 * 把「状态 ＋ 值」写回事实表。**Task 4 的修正与撤销共用这一处**——写回只有一份，
 * 三种表的列名映射也只有一份。
 */
export async function 写回(
  tx: Queryable,
  projectId: string,
  type: 留痕类型,
  id: string,
  trustState: 事实信任态,
  值: Record<string, unknown>,
): Promise<void> {
  if (type === "entity") {
    await tx.execute(sql`
      update auth.case_entity
         set trust_state = ${trustState}, canonical_value = ${String(值["canonicalValue"])},
             type = ${String(值["entityType"])}
       where project_id = ${projectId} and id = ${id}
    `)
    return
  }
  if (type === "relation") {
    const 金额 = 值["amount"]
    await tx.execute(sql`
      update auth.case_relation
         set trust_state = ${trustState}, amount = ${金额 === null || 金额 === undefined ? null : Number(金额).toFixed(2)},
             basis = ${值["basis"] === null || 值["basis"] === undefined ? null : String(值["basis"])},
             type = ${String(值["relationType"])}
       where project_id = ${projectId} and id = ${id}
    `)
    return
  }
  await tx.execute(sql`
    update auth.case_event
       set trust_state = ${trustState},
           summary = ${值["summary"] === null || 值["summary"] === undefined ? null : String(值["summary"])},
           occurred_at = ${值["occurredAt"] === null || 值["occurredAt"] === undefined ? null : Number(值["occurredAt"])},
           precision = ${值["precision"] === null || 值["precision"] === undefined ? null : String(值["precision"])}
     where project_id = ${projectId} and id = ${id}
  `)
}

/**
 * 裁决入口。`修正` 与 `撤销` 在 Task 4 接上；本任务只认 确认 / 排除 / 存疑。
 */
export async function 裁决(db: Queryable, input: 裁决输入): Promise<裁决结果> {
  return inTransaction(db, async (tx) => {
    const 当前 = await 读当前事实(tx, input.projectId, input.factType, input.factId)
    if (当前 === undefined) throw new 裁决冲突("找不到这条事实", "fact_not_found")

    if (input.action === "确认" || input.action === "排除" || input.action === "存疑") {
      const 目标: 事实信任态 =
        input.action === "确认" ? "已确认" : input.action === "排除" ? "已排除" : "存疑"
      // §9.2：选「错」要写一句话并选原因。库约束也会挡，但在这里先回一句人话。
      if (input.action === "排除" && (input.reasonKind === null || input.reasonKind === undefined || !input.reasonText?.trim()))
        throw new 裁决冲突("判定为错时必须选原因并写一句话", "bad_changes")
      if (input.action !== "排除" && input.reasonKind != null)
        throw new 裁决冲突("只有「排除 / 修正」需要原因", "bad_changes")
      return 只改状态(tx, input, 当前, 目标)
    }

    if (input.action === "撤销") return 撤销(tx, input, 当前)

    // Task 4 接上「修正」；在那之前这是一句明确的「还没做」，不是静默。
    throw new 裁决冲突("「修正」在 Task 4 接上", "bad_changes")
  })
}
