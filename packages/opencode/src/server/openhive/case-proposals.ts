export * as OpenhiveCaseProposals from "./case-proposals"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { 记变更, 操作人快照 } from "./case-fact-change"
import { inTransaction, type Queryable } from "./case-store"

/**
 * AI 提议（设计 §9.5）：AI 只提议、不改数。
 *
 * ## 采纳不等于执行
 *
 * 采纳只把状态改成「已采纳」并留痕；**执行合并仍要走 `合并实体`**，而且要人再写一次
 * 「依据什么」（R8）。让「采纳」一步把数据也改了，留痕里的依据就变成模型写的字了。
 *
 * ## 提议本身也落一条留痕
 *
 * 判据 A18 要求「否决必须带理由与人、时间」。库里 `case_ai_proposal` 已经有这三列，
 * 这里再记一条 `case_fact_change`（fact_id = 提议 id）是为了让「这条提议被谁在什么时候
 * 处置过」与事实的留痕在同一个地方可查——复盘时只查一张表。
 *
 * ## 留痕挂在 `entity` 类型下，是有意的约定
 *
 * `case_fact_change.fact_type` 的 CHECK 只允许 `entity / relation / event`，没有「proposal」；
 * 故提议的留痕写成 `fact_type = 'entity'`、`fact_id = 提议 id`。于是 `case_fact_change` 里
 * 会有一批 `fact_id` 在 `case_entity` 里查不到的行——**这是约定，不是脏数据**。
 * 不为此新增迁移加宽 `留痕类型们`：`写回` 按 fact_type 分支，多一个类型会让它落到事件分支。
 *
 * ## 列表顺序
 *
 * `order by created_at asc, id asc`：`created_at` 只有秒级、`id` 是随机 UUID ⇒ 同一秒内的
 * 顺序是确定的，但不是插入序。不为此加 `seq` 列。
 */

export const 提议状态们 = ["待处理", "已采纳", "已否决"] as const
export type 提议状态 = (typeof 提议状态们)[number]

/** 唯一一份「这是不是合法提议状态」的判据：DAO 读回与路由入参都用它。 */
export const 是提议状态 = (value: unknown): value is 提议状态 =>
  typeof value === "string" && (提议状态们 as readonly string[]).includes(value)

export const 提议错误码们 = ["proposal_not_found", "already_decided", "reason_required", "bad_input"] as const
export type 提议错误码 = (typeof 提议错误码们)[number]

export class 提议冲突 extends Error {
  constructor(
    message: string,
    readonly code: 提议错误码,
  ) {
    super(message)
    this.name = "提议冲突"
  }
}

export interface 提议视图 {
  readonly id: string
  readonly kind: string
  readonly payload: unknown
  readonly rationale: string | null
  readonly status: 提议状态
  readonly decidedBy: string | null
  readonly decidedAt: number | null
  readonly rejectReason: string | null
  readonly createdAt: number
}

/**
 * jsonb 读回：只解「二次编码的旧对象/数组」（字符串以 `{` / `[` 开头），其余原样返回。
 * 不做无条件的 `JSON.parse`——那会把真标量 `"123"` 变成数字、`"null"` 变成 null（Task 1 R4）。
 */
function 读杰森(值: unknown): unknown {
  if (typeof 值 !== "string" || !(值.startsWith("{") || 值.startsWith("["))) return 值 ?? null
  try {
    return JSON.parse(值)
  } catch {
    return 值
  }
}

function 映射(行: Record<string, unknown>): 提议视图 {
  // 不认识的状态**抛**，不回落成「待处理」：回落是静默改语义（一条已处置的提议会被列成
  // 还能再处置）；库约束 `case_ai_proposal_status` 本应挡住脏行，真漏进来时要立刻可见。
  const 状态 = 行.status
  if (!是提议状态(状态)) throw new 提议冲突(`库里的提议状态不认识：${String(状态)}`, "bad_input")
  return {
    id: String(行.id),
    kind: String(行.kind),
    payload: 读杰森(行.payload),
    rationale: 行.rationale === null || 行.rationale === undefined ? null : String(行.rationale),
    status: 状态,
    decidedBy: 行.decided_by === null || 行.decided_by === undefined ? null : String(行.decided_by),
    decidedAt: 行.decided_at === null || 行.decided_at === undefined ? null : Number(行.decided_at),
    rejectReason: 行.reject_reason === null || 行.reject_reason === undefined ? null : String(行.reject_reason),
    createdAt: Number(行.created_at),
  }
}

export interface 建提议输入 {
  readonly projectId: string
  readonly id?: string
  readonly kind: string
  readonly payload: unknown
  readonly rationale?: string | null
}

/** 建一条提议（计划 6 的 AI 工具会调它；本计划的用例也调它）。 */
export async function 建提议(db: Queryable, input: 建提议输入): Promise<string> {
  if (input.kind.trim() === "") throw new 提议冲突("提议必须说明是哪一类", "bad_input")
  const id = input.id ?? crypto.randomUUID()
  // `?? null` 不是防御性代码：`JSON.stringify(undefined)` 返回的是 `undefined` 而不是字符串，
  // 直接绑进语句会落成 SQL NULL，撞 `payload NOT NULL`。
  await db.execute(sql`
    insert into auth.case_ai_proposal (id, project_id, kind, payload, rationale, status, created_at)
    values (${id}, ${input.projectId}, ${input.kind},
            ${JSON.stringify(input.payload ?? null)}::text::jsonb,
            ${input.rationale ?? null}, '待处理', ${nowSeconds()})
  `)
  return id
}

/** 列表，时间正序；`状态` 不给 = 全部。 */
export async function 提议列表(db: Queryable, projectId: string, 状态?: 提议状态): Promise<提议视图[]> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select id, kind, payload, rationale, status, decided_by, decided_at, reject_reason, created_at
        from auth.case_ai_proposal
       where project_id = ${projectId}
         and (${状态 ?? null}::text is null or status = ${状态 ?? null})
       order by created_at asc, id asc
    `),
  )
  return 行们.map(映射)
}

export interface 处置输入 {
  readonly projectId: string
  readonly id: string
  readonly action: "采纳" | "否决"
  readonly reasonText?: string | null
  readonly by: string
}

/**
 * 处置一条提议。只有「待处理」能处置；重复处置回 409（不覆盖第一次的判断）。
 * 否决必须带理由——库约束 `case_ai_proposal_reject` 也会挡，这里先回一句人话。
 */
export async function 处置提议(db: Queryable, input: 处置输入): Promise<提议视图> {
  if (input.action === "否决" && (input.reasonText === null || input.reasonText === undefined || input.reasonText.trim() === ""))
    throw new 提议冲突("否决必须写一句理由", "reason_required")

  return inTransaction(db, async (tx) => {
    const 人 = await 操作人快照(tx, input.by)
    const 当前 = rowsOf(
      await tx.execute(sql`
        select status from auth.case_ai_proposal
         where project_id = ${input.projectId} and id = ${input.id}
         for update
      `),
    )[0]
    if (当前 === undefined) throw new 提议冲突("找不到这条提议", "proposal_not_found")
    if (String(当前.status) !== "待处理") throw new 提议冲突("这条提议已经处置过了", "already_decided")

    const 状态 = input.action === "采纳" ? "已采纳" : "已否决"
    const 理由 = input.action === "否决" ? (input.reasonText ?? null) : null
    await tx.execute(sql`
      update auth.case_ai_proposal
         set status = ${状态}, decided_by = ${input.by}, decided_at = ${nowSeconds()},
             reject_reason = ${理由}
       where project_id = ${input.projectId} and id = ${input.id}
    `)
    // 提议的留痕挂在 entity 下，`fact_id` 在 `case_entity` 里查不到是有意的（见文件头）。
    await 记变更(tx, {
      projectId: input.projectId,
      factType: "entity",
      factId: input.id,
      action: 状态 === "已采纳" ? "采纳" : "否决",
      before: { status: "待处理" },
      after: { status: 状态 },
      reasonKind: null,
      reasonText: 理由,
      actor: 人,
    })

    const 行 = rowsOf(
      await tx.execute(sql`
        select id, kind, payload, rationale, status, decided_by, decided_at, reject_reason, created_at
          from auth.case_ai_proposal
         where project_id = ${input.projectId} and id = ${input.id}
      `),
    )[0]
    if (行 === undefined) throw new 提议冲突("找不到这条提议", "proposal_not_found")
    return 映射(行)
  })
}
