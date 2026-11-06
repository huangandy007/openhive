export * as OpenhiveCaseFactChange from "./case-fact-change"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import type { Queryable } from "./case-store"

/**
 * 事实留痕（设计 §9.6）：谁、何时、改前、改后、为什么。
 *
 * ## 为什么不是 `audit_event`
 *
 * 见 `0033_case_fact_trust.sql` 文件头：留痕必须与事实改动**同事务**，而 `audit_event`
 * 的口径是「尽力记、失败不拖垮业务」；按事实查「改过几次」也要用到本表自己的索引。
 *
 * ## 只增不改
 *
 * 本文件**没有** update / delete 函数，也不打算有——留痕可以被改 = 留痕不存在
 * （与 `@opencode-ai/auth/audit` 同一条纪律）。
 *
 * ## `before` / `after` 存的是「恢复得回去」的快照
 *
 * 撤销恢复的是 `before`；拆分恢复的是合并那行的 `before`。所以写进来的必须是**全量**，
 * 不是「只变了哪几个字段」——少一个字段，撤销就会把那个字段留在半改状态。
 */

export const 留痕类型们 = ["entity", "relation", "event"] as const
export type 留痕类型 = (typeof 留痕类型们)[number]

export const 留痕动作们 = ["确认", "排除", "存疑", "修正", "撤销", "合并", "拆分", "采纳", "否决"] as const
export type 留痕动作 = (typeof 留痕动作们)[number]

export const 纠正原因们 = ["识别错", "抽取错", "材料本身有问题"] as const
export type 纠正原因 = (typeof 纠正原因们)[number]

/** 可以「撤销」的动作全集：合并的撤销是拆分，提议的撤销不在本计划。 */
export const 可撤销动作们: readonly 留痕动作[] = ["确认", "排除", "存疑", "修正"]

export interface 操作人 {
  readonly id: string
  readonly name: string
  readonly policeNo: string
}

export interface 留痕写入 {
  readonly projectId: string
  readonly factType: 留痕类型
  readonly factId: string
  readonly action: 留痕动作
  readonly before?: unknown
  readonly after?: unknown
  readonly reasonKind?: 纠正原因 | null
  readonly reasonText?: string | null
  readonly actor: 操作人
}

/**
 * JSON 参数：`::text::jsonb` 这一层**不是装饰**（2026-11-06 本机实测，bun 1.4.3）。
 *
 * PG 由 `::jsonb` 把参数推成 jsonb 后，驱动会对「声明为 jsonb 的字符串参数」再
 * `JSON.stringify` 一次 ⇒ `{"a":1}` 落成 JSON **字符串标量**（`jsonb_typeof` = `string`）。
 * 先转 `text` 让参数按 text 原样送达，再由 PG 解析，才真的得到对象。
 * 与 `case-fact-store.ts` 的 `文本数组` 是同一条实测结论。
 */
const 杰森 = (值: unknown) =>
  值 === undefined || 值 === null ? sql`null` : sql`${JSON.stringify(值)}::text::jsonb`

/** 读回来可能是对象（本仓驱动）也可能是字符串（旧行 / 别的驱动）——两种都收。 */
function 读杰森(值: unknown): unknown {
  if (值 === null || 值 === undefined) return null
  if (typeof 值 !== "string") return 值
  try {
    return JSON.parse(值)
  } catch {
    // 驱动已把 jsonb **标量**解析成 JS 字符串（`"abc"` 到手就是 `abc`），JSON.parse 必然抛；
    // 原样返回，别吞成 null——「有个值但读不出形状」和「没有值」是两件事，留痕是证据，
    // 读不出就该看得见（`#006-28` 那类静默吞异常的教训）。
    return 值
  }
}

/**
 * 操作人快照：姓名与警号**写时取**，之后不再 join（同 `0015_audit_event` ②）。
 *
 * 账号查不到（理论不可达）时用「已注销用户（前 8 位）」占位。`slice(0,8)` 的宽度与
 * `audit.ts:71` 同；区别是这边连空串姓名也回落（那边不会）。不隐藏、也不写空串。
 */
export async function 操作人快照(db: Queryable, userId: string): Promise<操作人> {
  if (userId === "") throw new Error("留痕缺少操作人")
  const 行 = rowsOf(await db.execute(sql`select name, police_no from auth.user where id = ${userId}`))
  const 人 = 行[0]
  const 名 = 人?.name
  return {
    id: userId,
    name: typeof 名 === "string" && 名 !== "" ? 名 : `已注销用户（${userId.slice(0, 8)}）`,
    policeNo: typeof 人?.police_no === "string" ? 人.police_no : "",
  }
}

/** 记一条留痕，返回它的 id。**必须与事实改动在同一个事务里**（调用方负责）。 */
export async function 记变更(db: Queryable, input: 留痕写入): Promise<string> {
  const id = crypto.randomUUID()
  await db.execute(sql`
    insert into auth.case_fact_change
      (id, project_id, fact_type, fact_id, action, before, after, reason_kind, reason_text,
       actor_id, actor_name, actor_police_no, created_at)
    values (${id}, ${input.projectId}, ${input.factType}, ${input.factId}, ${input.action},
            ${杰森(input.before)}, ${杰森(input.after)},
            ${input.reasonKind ?? null}, ${input.reasonText ?? null},
            ${input.actor.id}, ${input.actor.name}, ${input.actor.policeNo}, ${nowSeconds()})
  `)
  return id
}

export interface 变更视图 {
  readonly id: string
  readonly action: 留痕动作
  readonly before: unknown
  readonly after: unknown
  readonly reasonKind: 纠正原因 | null
  readonly reasonText: string | null
  readonly actorId: string
  readonly actorName: string
  readonly createdAt: number
}

function 纠正原因或空(值: unknown): 纠正原因 | null {
  return typeof 值 === "string" && (纠正原因们 as readonly string[]).includes(值) ? (值 as 纠正原因) : null
}

function 文本或空(值: unknown): string | null {
  if (值 === null || 值 === undefined) return null
  return typeof 值 === "string" ? 值 : null
}

/**
 * 按事实读全部留痕，时间正序（读出来就是一条时间线）。
 *
 * 按 `seq` 排，不按 `created_at` / `id`——时间只有秒级，id 是随机 UUID，同秒内它们是随机序。
 */
export async function 变更历史(
  db: Queryable,
  projectId: string,
  factType: 留痕类型,
  factId: string,
): Promise<变更视图[]> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select id, action, before, after, reason_kind, reason_text, actor_id, actor_name, created_at
        from auth.case_fact_change
       where project_id = ${projectId} and fact_type = ${factType} and fact_id = ${factId}
       order by seq asc
    `),
  )
  return 行们.map((行) => ({
    id: String(行.id),
    action: String(行.action) as 留痕动作,
    before: 读杰森(行.before),
    after: 读杰森(行.after),
    reasonKind: 纠正原因或空(行.reason_kind),
    reasonText: 文本或空(行.reason_text),
    actorId: String(行.actor_id),
    actorName: String(行.actor_name),
    createdAt: Number(行.created_at),
  }))
}

/**
 * 从一条「撤销」留痕里读出它撤销了哪一条。
 *
 * 用途：同一条动作不能被反复撤销（否则「撤销」变成永动机，留痕里堆一串一样的行）。
 */
export function 被撤销的留痕(after: unknown): string | undefined {
  if (typeof after !== "object" || after === null) return undefined
  const 值 = (after as Record<string, unknown>)["被撤销的留痕"]
  return typeof 值 === "string" ? 值 : undefined
}

/**
 * 最近一次**还没被撤销过**的可撤销动作。没有 ⇒ `undefined`（调用点据此回 `nothing_to_undo`）。
 *
 * 时间正序读、反向找：先跳过所有 `撤销` 行（它们不是被撤销的对象），再跳过已经被某条
 * `撤销` 点名过的那几条。
 */
export async function 最近一次可撤销(
  db: Queryable,
  projectId: string,
  factType: 留痕类型,
  factId: string,
): Promise<变更视图 | undefined> {
  const 全部 = await 变更历史(db, projectId, factType, factId)
  const 已撤销 = new Set(
    全部
      .filter((条) => 条.action === "撤销")
      .map((条) => 被撤销的留痕(条.after))
      .filter((id): id is string => id !== undefined),
  )
  return [...全部]
    .reverse()
    .find((条) => 可撤销动作们.includes(条.action) && !已撤销.has(条.id))
}
