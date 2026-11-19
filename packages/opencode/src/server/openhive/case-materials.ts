export * as OpenhiveCaseMaterials from "./case-materials"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 解析方式 } from "./case-parseable"
import type { MaterialKind, Queryable } from "./case-store"
import type { ParseStatus } from "./case-status"

/**
 * 左栏一份材料的视图行（设计 §5.2 / §8.1）。
 *
 * ## 为什么 `queueAhead` 不带项目过滤
 *
 * 设计 §6.5 是**单 worker 全局顺序消费**（`claimNextJob` 的 `order by queued_at, id` 没有
 * `project_id`）⇒ 「前面还有几个」必须按**全局**队列算。按项目过滤会把别人项目的作业当不存在，
 * 界面上说「前面还有 0 个」，实际要等 20 个——那就是在骗用户（`#010-05` 同族：顺序要按消费者
 * 真正用的那一份）。
 *
 * ## `parseable` 只按扩展名
 *
 * 它回答的是「系统解不解析这个后缀」（表格 ∪ 文本，计划 4 起含文本类），与 `kind` 是两件事。
 * 产物的硬边界由 `applyParseAction` 的守卫与 `kind = 产物` 的库约束拦，**不靠这个布尔**。
 *
 * ## 两种材料的计数口径不同（R10）
 *
 * 表格材料的「事实数」是 `case_fact_row` 行数（明细行）；文本材料没有明细行，取
 * `case_citation` 的去重事实数。两者相加（同一材料不会同时有两种）。号码数同理：
 * 表格取 caller/callee/counterparty，文本取被引用的 `type = '号码'` 实体。
 * 行级引用（fact_type = 'row'）不算在这里——表格材料的明细行已由 facts 计数。
 */
export interface 材料视图行 {
  id: string
  path: string
  kind: MaterialKind
  status: ParseStatus
  detail: unknown
  queueAhead: number
  factCount: number
  numberCount: number
  parseable: boolean
  /** 最近作业实际采用的适配器（规则型 / 四层链为空）。缺值一律 `null`，不发 undefined。 */
  adapterId: string | null
  adapterVersion: string | null
  /** 最近作业的结构化原因码（六值闭集之一或 null），「未识别」按它的前缀筛。 */
  reasonCode: string | null
  progress: unknown
  probe: unknown
}

export interface 材料视图选项 {
  /** `true` ⇒ 只返回最近作业 `reason_code` 以 `未识别:` 开头的材料（FR-038）。 */
  未识别?: boolean
}

/** jsonb 经驱动回来可能是字符串（同 `detail` 的处理），缺值统一落 `null`。 */
const 结构 = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : (value ?? null))

/** text 列缺值落 `null`；非字符串值与缺值同义（不发 `[object Object]`）。 */
const 文本 = (value: unknown) => (typeof value === "string" ? value : null)

export async function 材料视图(
  db: Queryable,
  projectId: string,
  options: 材料视图选项 = {},
): Promise<材料视图行[]> {
  // 只认 `未识别=1`；其余取值由 `case-parse.ts` 收窄成 false，这里按「不带」处理。
  const 只看未识别 = options.未识别 === true ? sql`where rj.reason_code like ${"未识别:%"}` : sql``
  const rows = rowsOf(
    await db.execute(sql`
      with latest as (
        select distinct on (path) id, path, kind, parse_status, parse_detail, probe
          from auth.case_material
         where project_id = ${projectId}
         order by path, created_at desc, id desc
      ),
      facts as (
        select material_id, count(*)::int as n
          from auth.case_fact_row
         where project_id = ${projectId}
         group by material_id
      ),
      numbers as (
        select material_id, count(distinct 号码)::int as n
          from (
            select material_id, caller as 号码
              from auth.case_fact_row
             where project_id = ${projectId} and caller is not null and caller <> ''
            union
            select material_id, callee
              from auth.case_fact_row
             where project_id = ${projectId} and callee is not null and callee <> ''
            union
            select material_id, counterparty
              from auth.case_fact_row
             where project_id = ${projectId} and counterparty is not null and counterparty <> ''
          ) 号码们
         group by material_id
      ),
      cited as (
        select material_id, count(distinct fact_type || ':' || fact_id)::int as n
          from auth.case_citation
         where project_id = ${projectId}
           and fact_type <> 'row'  -- 行级引用是表格材料的明细行，已由 facts 计数，别重复算
         group by material_id
      ),
      cited_numbers as (
        select c.material_id, count(distinct e.id)::int as n
          from auth.case_citation c
          join auth.case_entity e on e.project_id = c.project_id and e.id = c.fact_id
         where c.project_id = ${projectId} and c.fact_type = 'entity' and e.type = '号码'
         group by c.material_id
      ),
      first_job as (
        select distinct on (material_id) material_id, queued_at, id
          from auth.case_ingest_job
         where project_id = ${projectId} and status = '排队中'
         order by material_id, queued_at, id
      ),
      ahead as (
        select f.material_id, count(j.id)::int as n
          from first_job f
          left join auth.case_ingest_job j
            on j.status = '排队中'
           and (j.queued_at, j.id) < (f.queued_at, f.id)
         group by f.material_id
      ),
      recent_job as (
        -- 取消只把作业置「已取消」、行保留；置顶重来得把 queued_at 回填得更小 ⇒ 不排除它
        -- 就会选中那条取消掉的作业（原因码为空），「未识别」永远筛不出来。
        select distinct on (material_id) material_id, reason_code, progress, adapter_id, adapter_version
          from auth.case_ingest_job
         where project_id = ${projectId} and status <> '已取消'
         order by material_id, queued_at desc, id desc
      )
      select l.id, l.path, l.kind, l.parse_status, l.parse_detail, l.probe,
             rj.adapter_id, rj.adapter_version, rj.reason_code, rj.progress,
             coalesce(a.n, 0) as queue_ahead,
             coalesce(f.n, 0) + coalesce(cd.n, 0) as fact_count,
             coalesce(n.n, 0) + coalesce(cn.n, 0) as number_count
        from latest l
        left join ahead a on a.material_id = l.id
        left join facts f on f.material_id = l.id
        left join numbers n on n.material_id = l.id
        left join cited cd on cd.material_id = l.id
        left join cited_numbers cn on cn.material_id = l.id
        left join recent_job rj on rj.material_id = l.id
        ${只看未识别}
       order by l.path, l.id
    `),
  )

  return rows.map((row) => ({
    id: String(row.id),
    path: String(row.path),
    kind: String(row.kind) as MaterialKind,
    status: String(row.parse_status) as ParseStatus,
    detail: 结构(row.parse_detail),
    queueAhead: Number(row.queue_ahead ?? 0),
    factCount: Number(row.fact_count ?? 0),
    numberCount: Number(row.number_count ?? 0),
    parseable: 解析方式(String(row.path)) !== undefined,
    adapterId: 文本(row.adapter_id),
    adapterVersion: 文本(row.adapter_version),
    reasonCode: 文本(row.reason_code),
    progress: 结构(row.progress),
    probe: 结构(row.probe),
  }))
}
