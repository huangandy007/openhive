export * as OpenhiveCasePropagation from "./case-propagation"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import type { Queryable } from "./case-store"

/**
 * §9.4 传播：改了事实之后，**依赖它的事实**标「依据已变更」。
 *
 * ## 今天只有一种依赖是真的
 *
 * - 关系 → 两端实体（`from_id` / `to_id`）
 * - 事件 → 参与实体（`participants`）
 * - 产物 → 引用的事实：**没有生产者**（产物的 `citation` 要等计划 7 保存产物时才写），
 *   所以「报告请复核」那一半挂账（R9），不在这里建一张空转的列。
 *
 * ## 为什么是时间戳
 *
 * 界面要说「什么时候变的」，而不只是「变了」；清空它 = 人已经复核过这条依赖事实。
 */

/**
 * 标：指向这个实体的关系、参与这个实体的事件，全部置为「刚刚变过」。
 *
 * `unnest(participants)` 而不是 `participants @> array[$1]`：后者在不同驱动上对参数类型的
 * 推断不一致（`could not determine polymorphic type`），展开写法与驱动无关。
 */
export async function 标依赖已变更(
  db: Queryable,
  projectId: string,
  entityId: string,
): Promise<{ relations: number; events: number }> {
  const 时间 = nowSeconds()
  const 关系 = rowsOf(
    await db.execute(sql`
      update auth.case_relation
         set basis_changed_at = ${时间}
       where project_id = ${projectId} and (from_id = ${entityId} or to_id = ${entityId})
      returning id
    `),
  )
  const 事件 = rowsOf(
    await db.execute(sql`
      update auth.case_event
         set basis_changed_at = ${时间}
       where project_id = ${projectId}
         and exists (select 1 from unnest(participants) as 参与者 where 参与者 = ${entityId})
      returning id
    `),
  )
  return { relations: 关系.length, events: 事件.length }
}

/** 清：对某条依赖事实做了任何人工动作 ⇒ 它已经被人看过了。 */
export async function 清依赖标记(
  db: Queryable,
  projectId: string,
  factType: "relation" | "event",
  factId: string,
): Promise<void> {
  const 表 = factType === "relation" ? sql`auth.case_relation` : sql`auth.case_event`
  await db.execute(sql`
    update ${表} set basis_changed_at = null
     where project_id = ${projectId} and id = ${factId}
  `)
}
