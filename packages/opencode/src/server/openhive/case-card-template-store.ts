export * as OpenhiveCaseCardTemplateStore from "./case-card-template-store"

import { sql } from "drizzle-orm"
import { pgErrorCode } from "@opencode-ai/auth/pg-errors"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { 文本数组 } from "./case-fact-store"
import {
  归一槽位,
  是用户模板id,
  用户模板前缀,
  解析必填,
  读模板,
  type 模板行,
  type 模板定义,
} from "./case-card-template"
import { 是事件类型 } from "./case-event-types"
import type { Queryable } from "./case-store"

/**
 * 模板 DAO（§7）。判定（能不能改、能不能转正）放在这里，路由只翻错误码。
 *
 * 三个不变量：
 * 1. **内置行不可变**：`内置:` 前缀一律 `immutable`，代码规则不归用户改；
 * 2. **停用保留行**：`disabled_at` 只写一次，历史卡片照旧可追溯；
 * 3. **改内容才升版本**：`slots` / `required` / `event_type` 任一变化 ⇒ `version+1` 且
 *    `verified_at` 清空——验证只管「这一版」，改过的模板必须重新预览转正。
 */

export const 模板错误码 = ["bad_request", "conflict", "immutable", "not_found", "state_changed"] as const
export type 模板错误码 = (typeof 模板错误码)[number]

export class 模板错误 extends Error {
  readonly code: 模板错误码
  constructor(code: 模板错误码, message: string) {
    super(message)
    this.name = "模板错误"
    this.code = code
  }
}

/** jsonb / text[] 的读回形状随驱动而变（`#002-01`）：字符串就解析，对象直接用。 */
function 读json(值: unknown): unknown {
  if (typeof 值 !== "string") return 值
  try {
    const 解: unknown = JSON.parse(值)
    return 解
  } catch {
    return undefined
  }
}

function 映射模板行(行: Record<string, unknown>): 模板行 {
  const eventType = 行.event_type
  if (!是事件类型(eventType)) throw new Error(`模板的事件类型不在词表里：${String(eventType)}`)
  return {
    id: String(行.id),
    name: String(行.name),
    event_type: eventType,
    slots: 归一槽位(读json(行.slots)),
    required: 解析必填(行.required),
    version: Number(行.version),
    verified_at: 行.verified_at === null || 行.verified_at === undefined ? null : Number(行.verified_at),
    hit_count: Number(行.hit_count),
    disabled_at: 行.disabled_at === null || 行.disabled_at === undefined ? null : Number(行.disabled_at),
  }
}

const 列 = sql`id, name, event_type, slots, required, version, verified_at, hit_count, disabled_at`

/** 非用户前缀：只有 `内置:` 算「代码规则维护」，其余 id 一律不存在。 */
const 内置模板前缀 = "内置:"

/**
 * 列表：启用中的在前（`disabled_at nulls first`），同状态按事件类型、id 升序。
 * 停用行默认不列——「停用」在民警那边就是「没有了」（历史卡片不受影响）。
 */
export async function 列出模板(
  db: Queryable,
  input: { projectId: string; 含停用?: boolean },
): Promise<模板行[]> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select ${列}
        from auth.case_card_template
       where project_id = ${input.projectId}
         and (${input.含停用 === true} or disabled_at is null)
       order by disabled_at nulls first, event_type asc, id asc
    `),
  )
  return 行们.map(映射模板行)
}

/** 单行（编辑器回显 / 解析选模板 / 转正前读 version 共用）。 */
export async function 读模板行(db: Queryable, projectId: string, id: string): Promise<模板行 | undefined> {
  const 行 = await 读模板(db, projectId, id)
  return 行 === undefined ? undefined : 映射模板行(行)
}

export async function 建模板(db: Queryable, input: { projectId: string; 定义: 模板定义 }): Promise<模板行> {
  const id = `${用户模板前缀}${crypto.randomUUID()}`
  let 结果: unknown
  try {
    结果 = await db.execute(sql`
      insert into auth.case_card_template
        (id, project_id, name, event_type, slots, required, version, verified_at, hit_count, created_at, disabled_at)
      values (${id}, ${input.projectId}, ${input.定义.name}, ${input.定义.event_type},
              ${JSON.stringify(input.定义.slots)}::text::jsonb, ${文本数组(input.定义.required)},
              1, null, 0, ${nowSeconds()}, null)
      returning ${列}
    `)
  } catch (错误: unknown) {
    // 部分唯一索引撞车（23505）：同类型已有一个启用中的用户模板。
    // 预检 SELECT 挡不住并发，唯一索引才是真闸；这里把 DB 错误翻成人能懂的话。
    if (pgErrorCode(错误) === "23505") {
      throw new 模板错误("conflict", "同类型下已有启用中的用户模板；请先停用旧模板再新建")
    }
    throw 错误
  }
  const 行 = rowsOf(结果)[0]
  if (行 === undefined) throw new Error("建模板后没有返回行")
  return 映射模板行(行)
}

/**
 * 改模板。**`verified_at` 只在内容真变时清空**（§7.3）：
 * 只改名字不重置验证状态——名字不影响翻译结果，重置只会让民警白跑一遍预览。
 */
export async function 改模板(
  db: Queryable,
  input: { projectId: string; id: string; 定义: 模板定义 },
): Promise<模板行> {
  要求用户模板(input.id, "修改")
  const 现有 = await 读模板行(db, input.projectId, input.id)
  if (现有 === undefined || 现有.disabled_at !== null) throw new 模板错误("not_found", "没有这个模板")

  const slots = sql`${JSON.stringify(input.定义.slots)}::text::jsonb`
  const required = 文本数组(input.定义.required)
  const eventType = sql`${input.定义.event_type}`
  const 变了 = sql`(slots is distinct from ${slots} or required is distinct from ${required} or event_type is distinct from ${eventType})`

  let 结果: unknown
  try {
    结果 = await db.execute(sql`
      update auth.case_card_template
         set name = ${input.定义.name},
             slots = ${slots},
             required = ${required},
             event_type = ${eventType},
             version = version + case when ${变了} then 1 else 0 end,
             verified_at = case when ${变了} then null else verified_at end
       where project_id = ${input.projectId} and id = ${input.id} and disabled_at is null
       returning ${列}
    `)
  } catch (错误: unknown) {
    // 改事件类型可能撞 0044 的部分唯一索引（同项目同类型只能有一个启用中的用户模板）：
    // 与建模板一样翻成人能懂的错误，否则路由只能 500。
    if (pgErrorCode(错误) === "23505") {
      throw new 模板错误("conflict", "同类型下已有启用中的用户模板；不能改成该事件类型")
    }
    throw 错误
  }
  const 行们 = rowsOf(结果)
  const 行 = 行们[0]
  if (行 === undefined) throw new 模板错误("not_found", "没有这个模板")
  return 映射模板行(行)
}

/** 停用：保留行。返回是否真的停了（已停用 ⇒ false；不存在 ⇒ not_found）。 */
export async function 停用模板(db: Queryable, input: { projectId: string; id: string }): Promise<boolean> {
  要求用户模板(input.id, "停用")
  const 现有 = await 读模板行(db, input.projectId, input.id)
  if (现有 === undefined) throw new 模板错误("not_found", "没有这个模板")
  if (现有.disabled_at !== null) return false
  const 行们 = rowsOf(
    await db.execute(sql`
      update auth.case_card_template
         set disabled_at = ${nowSeconds()}
       where project_id = ${input.projectId} and id = ${input.id} and disabled_at is null
       returning id
    `),
  )
  return 行们.length > 0
}

/**
 * 恢复：把 `disabled_at` 置回 null（设计 §4）。
 *
 * 先用**一条带条件的 UPDATE**，0 行后再回读区分三种成因（已启用 / 不存在 / 并发改回）：
 * - 回读放在 UPDATE 之后而不是之前：判定依据是「这次 UPDATE 真的改到了没有」，
 *   不是「读的时候看起来是什么」（先读再写会把这个窗口里的状态当成结论）。
 * - 同类型已有启用中的用户模板 ⇒ 唯一索引 23505，翻成 conflict 的人话；
 *   这个分支**只有**在真去恢复时才会触发，所以它是恢复语义的真闸。
 * - 恢复不改 `verified_at` / `version`：验证状态管的是「这一版的定义」，停用/恢复不动定义。
 */
export async function 恢复模板(db: Queryable, input: { projectId: string; id: string }): Promise<void> {
  要求用户模板(input.id, "恢复")
  let 行们: Record<string, unknown>[]
  try {
    行们 = rowsOf(
      await db.execute(sql`
        update auth.case_card_template
           set disabled_at = null
         where project_id = ${input.projectId} and id = ${input.id} and disabled_at is not null
         returning id
      `),
    )
  } catch (错误: unknown) {
    if (pgErrorCode(错误) === "23505") {
      throw new 模板错误("conflict", "同类型下已有启用中的用户模板；请先停用旧模板再恢复")
    }
    throw 错误
  }
  if (行们.length > 0) return
  const 现有 = await 读模板行(db, input.projectId, input.id)
  if (现有 === undefined) throw new 模板错误("not_found", "没有这个模板")
  if (现有.disabled_at === null) return // 已启用：幂等
  // UPDATE 0 行但回读仍是停用 ⇒ 两次读之间被别的请求改回了停用；让用户刷新重来。
  throw new 模板错误("state_changed", "模板状态在恢复期间被改动，请刷新后重试")
}

/**
 * 转正（§10.4）：`expectedVersion` 是预览时读到的版本 —— 预览与转正之间模板被改过 ⇒
 * `state_changed`，让用户重新预览。已转正的返回原时间（幂等，带 `already` 标记）。
 *
 * 停用是「行还在、状态不对」⇒ `conflict`（409），与「不存在」分开（§7.3）。
 */
export async function 转正模板(
  db: Queryable,
  input: { projectId: string; id: string; expectedVersion: number },
): Promise<{ verified_at: number; version: number; already?: true }> {
  要求用户模板(input.id, "转正")
  const 现有 = await 读模板行(db, input.projectId, input.id)
  if (现有 === undefined) throw new 模板错误("not_found", "没有这个模板")
  if (现有.disabled_at !== null) throw new 模板错误("conflict", "模板已停用，需先恢复")
  if (现有.verified_at !== null) return { verified_at: 现有.verified_at, version: 现有.version, already: true }

  const 行们 = rowsOf(
    await db.execute(sql`
      update auth.case_card_template
         set verified_at = ${nowSeconds()}
       where project_id = ${input.projectId} and id = ${input.id}
         and verified_at is null and disabled_at is null and version = ${input.expectedVersion}
       returning verified_at, version
    `),
  )
  const 行 = 行们[0]
  if (行 === undefined) {
    // UPDATE 0 行有两种成因：并发转正已经写成（再读一次 ⇒ 幂等 `already`），或版本被改
    // ⇒ `state_changed`。不重读就会把「另一个请求刚转正」误报成「你预览期间被改了」（§10.4）。
    // 0 行本身就是权威信号（单语句 UPDATE + 独立 SELECT）：并发事务未提交时这里读不到新值，
    // 最多误报 `state_changed`，客户端重试会在预读分支拿到 `already`。
    // 注意：串行 PGlite 下第二个请求在预读分支就早退，此支不可达，无并发用例覆盖。
    const 最新 = await 读模板行(db, input.projectId, input.id)
    if (最新 !== undefined && 最新.verified_at !== null) {
      return { verified_at: 最新.verified_at, version: 最新.version, already: true }
    }
    throw new 模板错误("state_changed", "模板在预览期间被修改，请重新预览")
  }
  return { verified_at: Number(行.verified_at), version: Number(行.version) }
}

/**
 * 解析命中计数：只认**用户**模板（内置行不参与编辑器热度），跳过不存在。
 * 单条 `UPDATE … where id = any(...)` 天然按集合去重——同一 id 传几次都只加 1。
 */
export async function 记模板命中(db: Queryable, input: { projectId: string; ids: readonly string[] }): Promise<void> {
  const 用户id们 = input.ids.filter(是用户模板id)
  if (用户id们.length === 0) return
  await db.execute(sql`
    update auth.case_card_template
       set hit_count = hit_count + 1
     where project_id = ${input.projectId} and id = any(${文本数组(用户id们)})
  `)
}

/** 可编辑性闸：内置 ⇒ immutable；非用户前缀且非内置 ⇒ not_found。 */
function 要求用户模板(id: string, 动作: string): void {
  if (是用户模板id(id)) return
  if (id.startsWith(内置模板前缀)) throw new 模板错误("immutable", `内置模板由代码规则维护，不能${动作}`)
  throw new 模板错误("not_found", "没有这个模板")
}

/** 未保存草稿的伪模板行：卡片 id 的槽位用固定字面量「预览」，永不落库（§10.3）。 */
export const 预览模板id = "预览"

export function 草稿模板行(定义: 模板定义): 模板行 {
  return {
    id: 预览模板id,
    name: 定义.name,
    event_type: 定义.event_type,
    slots: 定义.slots,
    required: 定义.required,
    version: 0,
    verified_at: null,
    hit_count: 0,
    disabled_at: null,
  }
}
