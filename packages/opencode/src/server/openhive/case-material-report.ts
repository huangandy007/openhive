export * as OpenhiveCaseMaterialReport from "./case-material-report"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { Hash } from "@opencode-ai/core/util/hash"
import type { Queryable } from "./case-store"

/**
 * 016 T013 · 材料入库报告（`auth.case_material_report`，迁移 0049）。
 *
 * ## append-only
 *
 * 每次转换成功写一行，重跑**新增**一行，历史一行都不改（FR-060：历史报告保留当时的版本）。
 * `UNIQUE (project_id, job_id)` 保证「一次作业至多一份报告」；同一作业写第二份是**编程错误**，
 * 这里刻意不做 `on conflict do nothing/update` —— 把错误吞掉，等于让「事实写进去了、报告却
 * 没更新」在库里看不出来（`case-material-report` brief §1）。
 *
 * ## 读侧只映射一次
 *
 * 三个读函数直接返回驼峰对象，T016 的 `GET …/report` 不再映射第二遍（`#002-06`）。
 * `最新报告` / `报告历史` 按 `created_at desc, id desc`（与 0049 的
 * `(project_id, material_id, created_at desc)` 索引同形）。
 */

export interface 报告行 {
  id: string
  jobId: string
  materialId: string
  adapterId: string | null
  adapterVersion: string | null
  ruleVersion: string | null
  sourceSha256: string
  gates: unknown[]
  warnings: unknown[]
  skippedRows: unknown[]
  /** 本次作业全部表头闸通过者（含落选者），`priority desc, id asc`（FR-009）。 */
  matches: unknown[]
  /** 本次实际产生的事实行数（迁移 0050）。 */
  convertedRows: number
  /** `null` = 本次没跑富化（非资金材料 / 富化失败）。 */
  enrich: unknown
  /** `null` 不会出现：写报告时准入结论必已算好（Ruling N）。 */
  admission: unknown
  createdAt: number
}

export interface 报告输入 {
  projectId: string
  jobId: string
  materialId: string
  adapterId: string | null
  adapterVersion: string | null
  ruleVersion: string | null
  sourceSha256: string
  gates: unknown[]
  warnings: unknown[]
  skippedRows: unknown[]
  /** 全部命中的适配器（含落选者）。 */
  matches: unknown[]
  /** 本次实际产生的事实行数。 */
  convertedRows: number
  /** `null` = 本次没跑富化。 */
  enrich: unknown
  /** `null` 不该出现；保留给直接调 DAO 的调用方做兜底。 */
  admission: unknown
}

/**
 * 报告 id：与仓库既有 `事实id` 同一风格（`Hash.sha256(parts.join("\u0000")).slice(0, 32)`，
 * `case-ingest.ts` 的 `事实id` / `case-translate-store.ts` 同形），不引 `randomUUID`。
 * 含 `jobId` ⇒ 不同作业必然不同 id，重跑才能追加。
 */
function 报告id(projectId: string, jobId: string): string {
  return Hash.sha256([projectId, jobId, "报告"].join("\u0000")).slice(0, 32)
}

/** 纯 INSERT：冲突要响亮失败（同一作业写两次是编程错误，不是幂等场景）。 */
export async function 写报告(tx: Queryable, 输入: 报告输入): Promise<void> {
  await tx.execute(sql`
    insert into auth.case_material_report
      (project_id, id, job_id, material_id, adapter_id, adapter_version, rule_version,
       source_sha256, gates, warnings, skipped_rows, matches, converted_rows, enrich, admission,
       created_at)
    values (${输入.projectId}, ${报告id(输入.projectId, 输入.jobId)}, ${输入.jobId},
            ${输入.materialId}, ${输入.adapterId}, ${输入.adapterVersion}, ${输入.ruleVersion},
            ${输入.sourceSha256},
            ${JSON.stringify(输入.gates)}::text::jsonb,
            ${JSON.stringify(输入.warnings)}::text::jsonb,
            ${JSON.stringify(输入.skippedRows)}::text::jsonb,
            ${JSON.stringify(输入.matches)}::text::jsonb,
            ${输入.convertedRows},
            ${输入.enrich === null ? null : JSON.stringify(输入.enrich)}::text::jsonb,
            ${输入.admission === null ? null : JSON.stringify(输入.admission)}::text::jsonb,
            ${nowSeconds()})
  `)
}

/** jsonb 在 bun-sql 下可能是对象也可能是字符串；坏值一律当空，不猜（`#006-28` 的反面：不裸抛）。 */
function 解析json(原始: unknown): unknown {
  if (typeof 原始 !== "string") return 原始
  try {
    return JSON.parse(原始)
  } catch {
    return undefined
  }
}

function 解析数组(原始: unknown): unknown[] {
  const 值 = 解析json(原始)
  return Array.isArray(值) ? 值 : []
}

/** text 列在驱动里本该是 string / null；非字符串（驱动形状漂移）如实序列化，不写成 `[object Object]`。 */
function 或空串(值: unknown): string | null {
  if (值 === null || 值 === undefined) return null
  return typeof 值 === "string" ? 值 : (JSON.stringify(值) ?? null)
}

function 映射行(行: Record<string, unknown>): 报告行 {
  return {
    id: String(行.id),
    jobId: String(行.job_id),
    materialId: String(行.material_id),
    adapterId: 或空串(行.adapter_id),
    adapterVersion: 或空串(行.adapter_version),
    ruleVersion: 或空串(行.rule_version),
    sourceSha256: String(行.source_sha256),
    gates: 解析数组(行.gates),
    warnings: 解析数组(行.warnings),
    skippedRows: 解析数组(行.skipped_rows),
    matches: 解析数组(行.matches),
    convertedRows: Number(行.converted_rows ?? 0),
    enrich: 解析json(行.enrich) ?? null,
    admission: 解析json(行.admission) ?? null,
    createdAt: Number(行.created_at ?? 0),
  }
}

const 全列 = sql`
  project_id, id, job_id, material_id, adapter_id, adapter_version, rule_version,
  source_sha256, gates, warnings, skipped_rows, matches, converted_rows, enrich, admission,
  created_at
`

/** 该材料最新一份报告；没有 ⇒ `undefined`（「还没跑完」是正常态，不是错误）。 */
export async function 最新报告(
  db: Queryable,
  projectId: string,
  materialId: string,
): Promise<报告行 | undefined> {
  const 行 = rowsOf(
    await db.execute(sql`
      select ${全列}
        from auth.case_material_report
       where project_id = ${projectId} and material_id = ${materialId}
       order by created_at desc, id desc
       limit 1
    `),
  )[0]
  return 行 === undefined ? undefined : 映射行(行)
}

/** 该材料全部报告（新的在前）。append-only：不做任何去重 / 折叠。 */
export async function 报告历史(
  db: Queryable,
  projectId: string,
  materialId: string,
): Promise<报告行[]> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select ${全列}
        from auth.case_material_report
       where project_id = ${projectId} and material_id = ${materialId}
       order by created_at desc, id desc
    `),
  )
  return 行们.map(映射行)
}

/**
 * 按内容指纹取本项目最新一份报告（N5 重跑扫描判「同内容是否入过库」用）。
 *
 * 0049 的索引是 `(project_id, material_id, created_at desc)`，本查询按
 * `(project_id, source_sha256)` 过滤 ⇒ 不走该索引。候选扫描（T015）**不走本查询**，
 * 这里只服务量小的单次查询，注释清楚，不为此加迁移。
 */
export async function 按内容查最新报告(
  db: Queryable,
  projectId: string,
  sourceSha256: string,
): Promise<报告行 | undefined> {
  const 行 = rowsOf(
    await db.execute(sql`
      select ${全列}
        from auth.case_material_report
       where project_id = ${projectId} and source_sha256 = ${sourceSha256}
       order by created_at desc, id desc
       limit 1
    `),
  )[0]
  return 行 === undefined ? undefined : 映射行(行)
}
