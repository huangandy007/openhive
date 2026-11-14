export * as OpenhiveCaseSourceProfileStore from "./case-source-profile-store"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import type { 档案候选 } from "./case-source-profile"
import type { Queryable } from "./case-store"

/**
 * 数据源档案的 DAO（Task 4 补齐其余函数；本任务只有解析链路要用的两个）。
 *
 * 读侧一律 **fail-closed**：类型不在值域、mapping 不是合法对象、逐条值不是字符串 ⇒
 * 跳过该档案（回落普通识别），而不是猜一个映射出来（设计 §4 / `case-source-profile.ts`）。
 */

export async function 读活跃档案(db: Queryable, projectId: string): Promise<档案候选[]> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select id, name, type, mapping, hit_count, updated_at
        from auth.case_source_profile
       where project_id = ${projectId} and revoked_at is null
    `),
  )
  const 结果: 档案候选[] = []
  for (const 行 of 行们) {
    const type = 行.type
    if (type !== "资金" && type !== "话单" && type !== "其他") continue
    const 原始 = 行.mapping
    const mapping = typeof 原始 === "string" ? JSON.parse(原始) : 原始
    if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) continue
    const 干净: Record<string, string> = {}
    for (const [k, v] of Object.entries(mapping)) if (typeof v === "string") 干净[k] = v
    结果.push({
      id: String(行.id),
      name: String(行.name),
      type,
      mapping: 干净,
      hitCount: Number(行.hit_count ?? 0),
      updatedAt: Number(行.updated_at ?? 0),
    })
  }
  return 结果
}

/** 一份材料同一个档案命中多张表也只 +1（调用方传 Set）。 */
export async function 记档案命中(db: Queryable, projectId: string, id: string): Promise<void> {
  await db.execute(sql`
    update auth.case_source_profile
       set hit_count = hit_count + 1, updated_at = ${nowSeconds()}
     where project_id = ${projectId} and id = ${id} and revoked_at is null
  `)
}
