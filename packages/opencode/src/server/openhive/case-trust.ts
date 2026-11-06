export * as OpenhiveCaseTrust from "./case-trust"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { pgErrorCode } from "@opencode-ai/auth/pg-errors"
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

/** 修正只认这些键（R4）。不认识的键一律 409——静默忽略会让用户以为改成了。 */
export const 修正白名单: Record<留痕类型, readonly string[]> = {
  entity: ["canonicalValue", "entityType"],
  relation: ["amount", "basis", "relationType"],
  event: ["summary", "occurredAt", "precision"],
}

// 与迁移 0031 的库约束同一份全集：这里挡在前面，用户看到的是人话而不是 500。
const 实体类型们 = ["人", "号码", "账户", "虚拟身份", "车辆", "物品", "地点", "组织"] as const
const 关系类型们 = ["通话", "转账", "实名登记", "实际使用", "同案", "持有", "同行"] as const
const 数据直记关系 = ["通话", "转账", "实名登记"] as const
const 精度们 = ["到日", "到分", "到秒"] as const

function 在(值: unknown, 全集: readonly string[]): boolean {
  return typeof 值 === "string" && 全集.includes(值)
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

  try {
    await 写回(tx, input.projectId, input.factType, input.factId, 前状态, 值)
  } catch (error) {
    // 恢复实体时撞上唯一索引（PG 23505）：这是人能自己解决的情形，翻成明确错误，
    // 别以 500 掉出去。⚠️ drizzle 把 PG 错误包在 `cause` 里，`pgErrorCode` 才认得出。
    if (pgErrorCode(error) === "23505")
      throw new 裁决冲突("恢复的名字已经被别的实体占了，先处理掉再撤销", "merge_required")
    throw error
  }
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
 * 把「状态 ＋ 值」写回事实表。**修正与撤销共用这一处**——写回只有一份，
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
 * 修正：白名单字段写回 + 已修正。原值只进留痕（R3）——`before` 是全量快照，
 * 撤销与「改过什么」都靠它。
 *
 * 校验顺序是刻意的：**先校验全部字段，再写**。写到一半才发现第三个字段不合法，
 * 事务虽然会回滚，但错误信息会指向一个已经通过校验的字段，调试时会被带偏。
 */
async function 修正(tx: Queryable, input: 裁决输入, 当前: 当前事实): Promise<裁决结果> {
  const 改动 = input.changes
  if (改动 === undefined || Object.keys(改动).length === 0)
    throw new 裁决冲突("修正必须给出要改的字段", "bad_changes")
  if (input.reasonKind === null || input.reasonKind === undefined || !input.reasonText?.trim())
    throw new 裁决冲突("修正必须选原因并写一句话", "bad_changes")

  const 允许 = 修正白名单[input.factType]
  for (const 键 of Object.keys(改动)) {
    if (!允许.includes(键))
      throw new 裁决冲突(`「${input.factType}」不能改「${键}」，可改：${允许.join(" / ")}`, "bad_changes")
  }

  const 新值: Record<string, unknown> = { ...当前.值, ...改动 }

  if (input.factType === "entity") {
    const 名称 = 新值["canonicalValue"]
    if (typeof 名称 !== "string" || 名称.trim() === "")
      throw new 裁决冲突("实体规范值不能为空", "bad_changes")
    新值["canonicalValue"] = 名称.trim()
    if (!在(新值["entityType"], 实体类型们)) throw new 裁决冲突("实体类型不合法", "bad_changes")

    const 撞 = rowsOf(
      await tx.execute(sql`
        select id from auth.case_entity
         where project_id = ${input.projectId} and type = ${String(新值["entityType"])}
           and canonical_value = ${String(新值["canonicalValue"])} and id <> ${input.factId}
      `),
    )[0]
    if (撞 !== undefined)
      throw new 裁决冲突(
        `已经有一个实体叫「${String(新值["canonicalValue"])}」，请用合并而不是改名`,
        "merge_required",
      )
  }

  if (input.factType === "relation") {
    if (!在(新值["relationType"], 关系类型们)) throw new 裁决冲突("关系类型不合法", "bad_changes")
    const 金额 = 新值["amount"]
    if (金额 !== null && 金额 !== undefined) {
      if (typeof 金额 !== "number" || !Number.isFinite(金额) || 金额 < 0)
        throw new 裁决冲突("金额必须是不小于 0 的有限数", "bad_changes")
    }
    const 依据 = 新值["basis"]
    if (依据 !== null && 依据 !== undefined && typeof 依据 !== "string")
      throw new 裁决冲突("认定依据必须是文本或空", "bad_changes")
    const 需依据 = !(数据直记关系 as readonly string[]).includes(String(新值["relationType"]))
    if (需依据 && (依据 === null || 依据 === undefined || String(依据).trim() === ""))
      throw new 裁决冲突(`「${String(新值["relationType"])}」必须带认定依据`, "basis_required")
  }

  if (input.factType === "event") {
    const 摘要 = 新值["summary"]
    if (摘要 !== null && 摘要 !== undefined && typeof 摘要 !== "string")
      throw new 裁决冲突("事件摘要必须是文本或空", "bad_changes")
    const 时间 = 新值["occurredAt"]
    if (时间 !== null && 时间 !== undefined && (!Number.isInteger(时间) || (时间 as number) < 0))
      throw new 裁决冲突("发生时间必须是 Unix 秒整数或空", "bad_changes")
    const 精度 = 新值["precision"]
    if (精度 !== null && 精度 !== undefined && !在(精度, 精度们))
      throw new 裁决冲突("精度只能是 到日 / 到分 / 到秒", "bad_changes")
  }

  try {
    await 写回(tx, input.projectId, input.factType, input.factId, "已修正", 新值)
  } catch (error) {
    // 并发下「先查撞名」可能漏掉对手刚插入的那一行，唯一索引（23505）是最后一道：
    // 同样翻成 merge_required，由人走合并，不偷偷合并、也不以 500 掉出去。
    if (pgErrorCode(error) === "23505")
      throw new 裁决冲突("这个改动撞上了已有的唯一值，请用合并而不是改名", "merge_required")
    throw error
  }
  const 留痕 = await 记变更(tx, {
    projectId: input.projectId,
    factType: input.factType,
    factId: input.factId,
    action: "修正",
    before: { trustState: 当前.trustState, ...当前.值 },
    after: { trustState: "已修正", ...新值 },
    reasonKind: input.reasonKind,
    reasonText: input.reasonText,
    actor: await 操作人快照(tx, input.by),
  })
  return { trustState: "已修正", 值: 新值, 留痕 }
}

/**
 * 裁决入口。五个动作各自落到唯一一处：确认 / 排除 / 存疑只改状态，修正改值并留全量快照，
 * 撤销凭最近一条未被撤销的留痕恢复值与状态。
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

    if (input.action === "修正") return 修正(tx, input, 当前)
    if (input.action === "撤销") return 撤销(tx, input, 当前)

    const 未知: never = input.action
    throw new 裁决冲突(`不认识的裁决动作：${String(未知)}`, "bad_changes")
  })
}
