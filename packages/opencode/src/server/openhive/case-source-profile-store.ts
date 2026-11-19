export * as OpenhiveCaseSourceProfileStore from "./case-source-profile-store"

import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { 校验档案映射 } from "@opencode-ai/asset-service/ingest-gate"
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
      select id, name, type, mapping, optional_headers, priority, hit_count, updated_at, rule_version
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
      optionalHeaders: 解析字符串数组(行.optional_headers),
      priority: Number(行.priority ?? 100),
      hitCount: Number(行.hit_count ?? 0),
      updatedAt: Number(行.updated_at ?? 0),
      ruleVersion: typeof 行.rule_version === "string" ? 行.rule_version : null,
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
  /** 【保留的定制 · 016】A 类档案映射未过 M10 校验（键 / 字段目录 / 必需列 / 类型）。 */
  | "mapping_invalid"

export class 档案错误 extends Error {
  constructor(
    readonly code: 档案错误码,
    message: string,
    /** 仅 `mapping_invalid` 携带：逐条问题项，出口原样列给用户（不静默丢弃）。 */
    readonly problems?: readonly string[],
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

/** 从 `parse_detail.mapping.工作表[表名].档案.id` 读回这张表在解析时命中的档案。 */
function 读命中档案id(原始: unknown, 工作表: string): string | undefined {
  const 详情 = 解析json(原始)
  if (typeof 详情 !== "object" || 详情 === null || Array.isArray(详情)) return undefined
  const 映射 = (详情 as Record<string, unknown>)["mapping"]
  if (typeof 映射 !== "object" || 映射 === null || Array.isArray(映射)) return undefined
  const 工作表们 = (映射 as Record<string, unknown>)["工作表"]
  if (typeof 工作表们 !== "object" || 工作表们 === null || Array.isArray(工作表们)) return undefined
  const 表 = (工作表们 as Record<string, unknown>)[工作表]
  if (typeof 表 !== "object" || 表 === null || Array.isArray(表)) return undefined
  const 档案 = (表 as Record<string, unknown>)["档案"]
  if (typeof 档案 !== "object" || 档案 === null || Array.isArray(档案)) return undefined
  const id = (档案 as Record<string, unknown>)["id"]
  return typeof id === "string" ? id : undefined
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
        select file_name, format_fingerprints, parse_detail from auth.case_material
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

    let 选中:
      | {
          readonly 来源: "缓存"
          readonly 工作表: string
          readonly 表头: (string | null)[]
          readonly columns: Record<number, 识别字段>
          readonly 类型: "资金" | "话单" | "其他"
        }
      | {
          readonly 来源: "档案"
          readonly 工作表: string
          readonly mapping: Record<string, string>
          readonly headerSet: string[]
          readonly 类型: "资金" | "话单" | "其他"
        }
      | undefined
    let 见过其他 = false
    for (const 项 of 指纹们) {
      if (指定 !== undefined && 指定 !== "" && 项.工作表 !== 指定) continue
      const 缓存行 = rowsOf(
        await tx.execute(sql`
          select header, mapping from auth.case_table_format
           where project_id = ${input.projectId} and fingerprint = ${项.指纹}
        `),
      )[0]
      if (缓存行 === undefined) {
        // 档案命中的表在解析时**有意不写格式缓存**（`case-ingest.ts` 的档案命中分支）。
        // 只查缓存会把这类材料判成「没有可建档的工作表」⇒ HTTP 400（真栈 2026-11-15 复现）。
        // 回落到解析时命中的那条档案：它的映射就是本表的映射。
        const 档案id = 读命中档案id(材料行.parse_detail, 项.工作表)
        if (档案id === undefined) continue
        const 档案行 = rowsOf(
          await tx.execute(sql`
            select header_set, mapping, type from auth.case_source_profile
             where project_id = ${input.projectId} and id = ${档案id}
          `),
        )[0]
        if (档案行 === undefined) continue
        const 档案映射 = 解析映射(档案行.mapping)
        if (Object.keys(档案映射).length === 0) continue
        const 档案类型 = 档案行.type
        if (档案类型 !== "资金" && 档案类型 !== "话单" && 档案类型 !== "其他") continue
        if (档案类型 === "其他") {
          见过其他 = true
          continue
        }
        选中 = {
          来源: "档案",
          工作表: 项.工作表,
          mapping: 档案映射,
          headerSet: 解析字符串数组(档案行.header_set),
          类型: 档案类型,
        }
        break
      }
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
      选中 = { 来源: "缓存", 工作表: 项.工作表, 表头, columns, 类型 }
      break
    }

    if (选中 === undefined) {
      throw new 档案错误(见过其他 ? "type_other" : "no_usable_sheet", "没有可建档的工作表（至少要 2 个有效字段，且不是「其他」）")
    }
    if (选中.类型 === "其他") throw new 档案错误("type_other", "认不出列的格式不固化成档案")

    const mapping: Record<string, string> =
      选中.来源 === "档案"
        ? 选中.mapping
        : (() => {
            const 构造: Record<string, string> = {}
            for (const [k, 字段] of Object.entries(选中.columns)) {
              if (!/^\d+$/.test(k)) continue
              if (!是识别字段(字段)) continue
              const 列号 = Number(k)
              if (!Number.isInteger(列号) || 列号 < 0 || 列号 >= 选中.表头.length) continue
              const 表头 = 选中.表头[列号]?.trim() ?? ""
              if (表头 === "") continue
              if (构造[表头] !== undefined && 构造[表头] !== 字段) {
                throw new 档案错误("header_duplicate", `表头重名，不能建档案：${表头}`)
              }
              构造[表头] = 字段
            }
            return 构造
          })()
    const headerSet = 选中.来源 === "档案" ? 选中.headerSet : Object.keys(mapping).sort()
    if (headerSet.length < 2) throw new 档案错误("no_usable_sheet", "有效表头少于 2 列")

    // 【保留的定制 · 016】M10 / A 类档案：映射键是表头原文、值在字段目录内、必需列非空、
    // 类型在闭集内。规则实现只有 `ingest-gate.ts` 一份；字段目录判定由本层注入。
    // 不成立 ⇒ 在建档写入路径拒绝并列问题项——尤其「档案复用」分支的 mapping 来自库，
    // 之前会原样写回，脏映射会静默固化成新档案。
    const 映射校验 = 校验档案映射({
      type: 选中.类型,
      mapping,
      requiredHeaders: headerSet,
      是识别字段,
    })
    if (!映射校验.ok) {
      throw new 档案错误(
        "mapping_invalid",
        `档案映射未过校验：${映射校验.problems.join("；")}`,
        映射校验.problems,
      )
    }

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
      // 必须按 RETURNING 判 rowcount：候选是**之前**读到的，读取与 UPDATE 之间档案可能被并发
      // 撤销（`where revoked_at is null` 命中 0 行）。此时报成功等于谎报——调用方会以为
      // 映射已改写，实际旧行仍是撤销态（`#013-06`：改指即留痕，判据要取改指语句自己的返回）。
      const 更新行们 = rowsOf(
        await tx.execute(sql`
          update auth.case_source_profile
             set name = ${覆盖后名}, header_set = ${JSON.stringify(headerSet)}::text::jsonb,
                 mapping = ${JSON.stringify(mapping)}::text::jsonb, updated_at = ${now}
           where project_id = ${input.projectId} and id = ${最像.id} and revoked_at is null
          returning id
        `),
      )
      if (更新行们.length === 0) {
        throw new 档案错误("conflict", "档案已被撤销，请重新建档")
      }
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
