export * as OpenhiveCaseFieldAlias from "./case-field-alias"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { 是识别字段 } from "./case-field-registry"
import { inTransaction, type Queryable } from "./case-store"

/**
 * 部署全局别名库（设计 §4）。
 *
 * 五条安全边界的落点：
 * - 键是**原始表头**（调用方传进来什么样就什么样，本模块只 trim）；
 * - 命中不提供证据，证据由识别层再判；
 * - 优先级由识别层的顺序保证，本模块不参与；
 * - 写入与 `alias_version` +1 **同一事务**；
 * - 字段名由服务端按字段目录校验（`是识别字段`）。
 */

export interface 别名上下文 {
  readonly 别名: ReadonlyMap<string, string>
  readonly 版本: number
}

/** 一个解析任务开始读一次，随任务传下；不要每张 sheet 各读一次（设计 §4.2-4）。 */
export async function 读别名上下文(db: Queryable): Promise<别名上下文> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select header, field from auth.case_field_alias where revoked_at is null
    `),
  )
  const 别名 = new Map<string, string>()
  for (const 行 of 行们) 别名.set(String(行.header), String(行.field))

  const 版本行 = rowsOf(await db.execute(sql`select version from auth.case_field_alias_version where id = 1`))
  return { 别名, 版本: Number(版本行[0]?.version ?? 0) }
}

export interface 确认别名输入 {
  readonly header: string
  readonly field: string
  readonly materialId: string
  readonly projectId: string
  readonly by: string
}

export async function 确认别名(db: Queryable, 输入: 确认别名输入): Promise<void> {
  const header = 输入.header.trim()
  if (header === "" || header.length > 200) throw new Error("表头为空或超过 200 字，不能写别名")
  if (!是识别字段(输入.field)) throw new Error(`字段不在字段目录内：${输入.field}`)

  await inTransaction(db, async (tx) => {
    // 活跃别名存在 ⇒ 0 行 ⇒ 抛「已存在」；已撤销行 ⇒ 复活（R1）。
    const 行们 = rowsOf(
      await tx.execute(sql`
        insert into auth.case_field_alias
          (header, field, material_id, project_id, confirmed_by, confirmed_at, hit_count)
        values (${header}, ${输入.field}, ${输入.materialId}, ${输入.projectId}, ${输入.by}, ${nowSeconds()}, 0)
        on conflict (header) do update
          set field        = excluded.field,
              material_id  = excluded.material_id,
              project_id   = excluded.project_id,
              confirmed_by = excluded.confirmed_by,
              confirmed_at = excluded.confirmed_at,
              revoked_at   = null
          where auth.case_field_alias.revoked_at is not null
        returning header
      `),
    )
    if (行们.length === 0) throw new Error("该表头已存在别名，请先撤销")
    await 递增版本(tx)
  })
}

export async function 撤销别名(db: Queryable, 输入: { header: string; by: string }): Promise<boolean> {
  return await inTransaction(db, async (tx) => {
    const 行们 = rowsOf(
      await tx.execute(sql`
        update auth.case_field_alias
           set revoked_at = ${nowSeconds()}
         where header = ${输入.header.trim()} and revoked_at is null
        returning header
      `),
    )
    if (行们.length === 0) return false
    await 递增版本(tx)
    return true
  })
}

/** 一份材料里同一个别名被多列用到也只 +1（设计 §4.3）。 */
export async function 记别名命中(db: Queryable, 表头们: readonly string[]): Promise<void> {
  const 去重 = [...new Set(表头们.map((h) => h.trim()).filter((h) => h !== ""))]
  if (去重.length === 0) return
  await db.execute(sql`
    update auth.case_field_alias
       set hit_count = hit_count + 1
     where revoked_at is null and header in (${sql.join(去重.map((h) => sql`${h}`), sql`, `)})
  `)
}

async function 递增版本(tx: Queryable): Promise<void> {
  await tx.execute(sql`update auth.case_field_alias_version set version = version + 1 where id = 1`)
}
