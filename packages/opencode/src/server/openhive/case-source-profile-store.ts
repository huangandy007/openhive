export * as OpenhiveCaseSourceProfileStore from "./case-source-profile-store"

import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { classifyMaterialType, 解析缓存映射 } from "./case-mapping"
import { 是识别字段, type 识别字段 } from "./case-field-registry"
import type { 档案候选 } from "./case-source-profile"
import { inTransaction, type Queryable } from "./case-store"

/**
 * 数据源档案的 DAO。
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

export type 档案错误码 =
  | "material_not_found"
  | "no_fingerprints"
  | "sheet_not_found"
  | "no_usable_sheet"
  | "type_other"
  | "header_duplicate"
  | "conflict"

export class 档案错误 extends Error {
  constructor(
    readonly code: 档案错误码,
    message: string,
  ) {
    super(message)
    this.name = "档案错误"
  }
}

export interface 数据源档案行 {
  id: string
  name: string
  type: "资金" | "话单" | "其他"
  header_set: string[]
  mapping: Record<string, string>
  hit_count: number
  created_at: number
  updated_at: number
  revoked_at: number | null
}

/** jsonb 在 bun-sql 下可能是对象也可能是字符串；坏值一律当空，不抛（`#006-28`：catch 里要有动作）。 */
function 解析json(原始: unknown): unknown {
  if (typeof 原始 !== "string") return 原始
  try {
    return JSON.parse(原始)
  } catch {
    return undefined
  }
}

function 解析映射(原始: unknown): Record<string, string> {
  const 值 = 解析json(原始)
  if (typeof 值 !== "object" || 值 === null || Array.isArray(值)) return {}
  const 干净: Record<string, string> = {}
  for (const [k, v] of Object.entries(值)) if (typeof v === "string") 干净[k] = v
  return 干净
}

function 解析字符串数组(原始: unknown): string[] {
  const 值 = 解析json(原始)
  return Array.isArray(值) ? 值.filter((v): v is string => typeof v === "string") : []
}

export async function 列出数据源档案(
  db: Queryable,
  input: { projectId: string; 含撤销?: boolean },
): Promise<数据源档案行[]> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select id, name, type, header_set, mapping, hit_count, created_at, updated_at, revoked_at
        from auth.case_source_profile
       where project_id = ${input.projectId}
         and (${input.含撤销 === true} or revoked_at is null)
       order by updated_at desc, id asc
    `),
  )
  const 结果: 数据源档案行[] = []
  for (const 行 of 行们) {
    const type = 行.type
    if (type !== "资金" && type !== "话单" && type !== "其他") continue
    结果.push({
      id: String(行.id),
      name: String(行.name),
      type,
      header_set: 解析字符串数组(行.header_set),
      mapping: 解析映射(行.mapping),
      hit_count: Number(行.hit_count ?? 0),
      created_at: Number(行.created_at ?? 0),
      updated_at: Number(行.updated_at ?? 0),
      revoked_at: 行.revoked_at === null || 行.revoked_at === undefined ? null : Number(行.revoked_at),
    })
  }
  return 结果
}

interface 指纹项 {
  工作表: string
  指纹: string
}

function 解析指纹(原始: unknown): 指纹项[] {
  const 值 = 解析json(原始)
  if (!Array.isArray(值)) return []
  const 结果: 指纹项[] = []
  for (const 项 of 值) {
    if (typeof 项 !== "object" || 项 === null || Array.isArray(项)) continue
    const 表 = 项 as Record<string, unknown>
    if (typeof 表["工作表"] !== "string" || typeof 表["指纹"] !== "string") continue
    结果.push({ 工作表: 表["工作表"], 指纹: 表["指纹"] })
  }
  return 结果
}

/** 表头重合率：`交集 / max(两边)`。分母取大的，宁严勿宽。 */
function 重合率(甲: readonly string[], 乙: readonly string[]): number {
  const 甲集 = new Set(甲)
  const 乙集 = new Set(乙)
  let 交 = 0
  for (const 值 of 甲集) if (乙集.has(值)) 交 += 1
  return 交 / Math.max(甲集.size, 乙集.size)
}

function 同映射(甲: Record<string, string>, 乙: Record<string, string>): boolean {
  const 键 = (m: Record<string, string>) => Object.keys(m).sort()
  const 甲键 = 键(甲)
  const 乙键 = 键(乙)
  if (甲键.length !== 乙键.length) return false
  return 甲键.every((k, i) => k === 乙键[i] && 甲[k] === 乙[k])
}

export async function 建数据源档案(
  db: Queryable,
  input: {
    projectId: string
    materialId: string
    工作表?: string
    name?: string
    覆盖?: boolean
  },
): Promise<{ id: string; created: boolean }> {
  return await inTransaction(db, async (tx) => {
    const 材料行 = rowsOf(
      await tx.execute(sql`
        select file_name, format_fingerprints from auth.case_material
         where project_id = ${input.projectId} and id = ${input.materialId}
      `),
    )[0]
    if (材料行 === undefined) throw new 档案错误("material_not_found", "没有这份材料")

    const 指纹们 = 解析指纹(材料行.format_fingerprints)
    if (指纹们.length === 0) {
      throw new 档案错误("no_fingerprints", "该材料还没有可用的解析指纹，请先重放")
    }

    const 指定 = input.工作表?.trim()
    if (指定 !== undefined && 指定 !== "" && !指纹们.some((项) => 项.工作表 === 指定)) {
      throw new 档案错误("sheet_not_found", `工作表不在这份材料的解析指纹里：${指定}`)
    }

    let 选中: { 工作表: string; 表头: (string | null)[]; columns: Record<number, 识别字段>; 类型: "资金" | "话单" | "其他" } | undefined
    let 见过其他 = false
    for (const 项 of 指纹们) {
      if (指定 !== undefined && 指定 !== "" && 项.工作表 !== 指定) continue
      const 缓存行 = rowsOf(
        await tx.execute(sql`
          select header, mapping from auth.case_table_format
           where project_id = ${input.projectId} and fingerprint = ${项.指纹}
        `),
      )[0]
      if (缓存行 === undefined) continue
      const columns = 解析缓存映射(解析json(缓存行.mapping))
      if (Object.keys(columns).length === 0) continue
      const 原始表头 = 解析json(缓存行.header)
      if (!Array.isArray(原始表头)) continue
      const 表头 = 原始表头.map((v) => (typeof v === "string" ? v : null))
      const 有效 = Object.values(columns).filter((f) => 是识别字段(f)).length
      const 类型 = classifyMaterialType(columns)
      if (有效 >= 2 && 类型 === "其他") {
        见过其他 = true
        continue
      }
      if (有效 < 2) continue
      选中 = { 工作表: 项.工作表, 表头, columns, 类型 }
      break
    }

    if (选中 === undefined) {
      throw new 档案错误(见过其他 ? "type_other" : "no_usable_sheet", "没有可建档的工作表（至少要 2 个有效字段，且不是「其他」）")
    }
    if (选中.类型 === "其他") throw new 档案错误("type_other", "认不出列的格式不固化成档案")

    const mapping: Record<string, string> = {}
    for (const [k, 字段] of Object.entries(选中.columns)) {
      if (!/^\d+$/.test(k)) continue
      if (!是识别字段(字段)) continue
      const 列号 = Number(k)
      if (!Number.isInteger(列号) || 列号 < 0 || 列号 >= 选中.表头.length) continue
      const 表头 = 选中.表头[列号]?.trim() ?? ""
      if (表头 === "") continue
      if (mapping[表头] !== undefined && mapping[表头] !== 字段) {
        throw new 档案错误("header_duplicate", `表头重名，不能建档案：${表头}`)
      }
      mapping[表头] = 字段
    }
    const headerSet = Object.keys(mapping).sort()
    if (headerSet.length < 2) throw new 档案错误("no_usable_sheet", "有效表头少于 2 列")

    const name = (input.name ?? "").trim() || `${String(材料行.file_name)} · ${选中.工作表}`

    const 活跃 = rowsOf(
      await tx.execute(sql`
        select id, name, header_set, mapping from auth.case_source_profile
         where project_id = ${input.projectId} and type = ${选中.类型} and revoked_at is null
         order by updated_at desc, id asc
      `),
    )
    for (const 行 of 活跃) {
      const 旧映射 = 解析映射(行.mapping)
      const 旧表头 = 解析字符串数组(行.header_set)
      if (同映射(旧映射, mapping) && JSON.stringify([...旧表头].sort()) === JSON.stringify(headerSet)) {
        return { id: String(行.id), created: false }
      }
    }

    let 最像: { id: string; name: string; 重合: number } | undefined
    for (const 行 of 活跃) {
      const 重合 = 重合率(解析字符串数组(行.header_set), headerSet)
      if (重合 >= 0.8 && (最像 === undefined || 重合 > 最像.重合)) {
        最像 = { id: String(行.id), name: String(行.name), 重合 }
      }
    }

    const now = nowSeconds()
    if (最像 !== undefined) {
      if (input.覆盖 !== true) {
        throw new 档案错误("conflict", "同类型且表头高度重合的档案已存在但映射不同；确认要覆盖请传 覆盖=true")
      }
      // 覆盖只换映射；没显式给 name 就保留原名，别把用户改过的名字悄悄重置成默认值。
      const 覆盖后名 = (input.name ?? "").trim() || 最像.name
      await tx.execute(sql`
        update auth.case_source_profile
           set name = ${覆盖后名}, header_set = ${JSON.stringify(headerSet)}::text::jsonb,
               mapping = ${JSON.stringify(mapping)}::text::jsonb, updated_at = ${now}
         where project_id = ${input.projectId} and id = ${最像.id} and revoked_at is null
      `)
      return { id: 最像.id, created: false }
    }

    const id = randomUUID()
    await tx.execute(sql`
      insert into auth.case_source_profile
        (id, project_id, name, type, header_set, mapping, hit_count, created_at, updated_at)
      values (${id}, ${input.projectId}, ${name}, ${选中.类型},
              ${JSON.stringify(headerSet)}::text::jsonb, ${JSON.stringify(mapping)}::text::jsonb,
              0, ${now}, ${now})
    `)
    return { id, created: true }
  })
}

export async function 撤销数据源档案(
  db: Queryable,
  input: { projectId: string; id: string },
): Promise<boolean> {
  const 行们 = rowsOf(
    await db.execute(sql`
      update auth.case_source_profile
         set revoked_at = ${nowSeconds()}
       where project_id = ${input.projectId} and id = ${input.id} and revoked_at is null
      returning id
    `),
  )
  return 行们.length > 0
}
