export * as OpenhiveCaseFactStore from "./case-fact-store"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import type { Queryable } from "./case-store"

/**
 * 五张事实表里「AI 抽取会写」的那几笔。
 *
 * ## 为什么单独一个文件
 *
 * `case-store.ts` 已经承担材料/状态/明细行三件事；把实体、关系、事件、引用的写入再塞进去，
 * 会变成又一个「什么都往里放」的文件。这里只放写路径，而且只放本计划用得到的那一半——
 * 读路径（实体清单、关系图）等计划 5/7 用到了再开。
 *
 * ## 无外键 ⇒ 清理必须显式带 project_id
 *
 * 0031 明确不设外键（事实层要能整片重建）。删材料不会级联，所以每条清理都写
 * `project_id = ? and ...`，漏一侧就会跨项目误删（`LEARNINGS` 多租户老账）。
 */

export interface 实体写入 {
  projectId: string
  id: string
  type: string
  canonicalValue: string
  aliases: string[]
}

/**
 * JS 字符串数组 → PG `text[]`。
 *
 * 本仓此前没有写过任何 `text[]` 列（0031 的 `aliases` / `participants` 是第一处），
 * 驱动的数组绑定行为没有先例可依：直接绑 JS 数组，不同驱动可能落成 JSON、也可能报错。
 * 走 JSON 再展开是显式的，与驱动无关，也不会因为升级驱动而悄悄变形状。
 *
 * ⚠️ **`::text` 这一层不是装饰**（2026-11-06 本机实测，bun 1.4.3）：PG 由 `$1::jsonb`
 * 把参数类型推成 jsonb，而 `bun-sql` 对**声明为 jsonb 的字符串参数**会再 `JSON.stringify`
 * 一次 ⇒ `"[]"` 落成 JSON **字符串**（`jsonb_typeof` = `string`），
 * `jsonb_array_elements_text` 报 `22023 cannot extract elements from a scalar`。
 * 先转 `text` 让 PG 把参数推成 text（原样送达），再由 `::jsonb` 解析，才真的得到数组。
 * `case-store.addCitation` 的 locator 读回时仍要 `typeof === "string" ? JSON.parse`：
 * 修复**之前**落库的旧行还是 JSON 字符串标量（本次不回填，旧行只能按旧形状读）。
 */
export function 文本数组(值: readonly string[]) {
  return sql`array(select jsonb_array_elements_text(${JSON.stringify(值)}::text::jsonb))`
}

/**
 * 按 `(project_id, type, canonical_value)` upsert，返回**库里那一行**的 id。
 *
 * 用 `do update` 而不是 `do nothing`：`do nothing` 不返回行，调用方拿不到既有 id，
 * 关系就会挂到一个不存在的实体上。别名取并集并去重。
 */
export async function upsertEntity(db: Queryable, input: 实体写入): Promise<string> {
  const 行 = rowsOf(
    await db.execute(sql`
      insert into auth.case_entity (id, project_id, type, canonical_value, aliases, created_at)
      values (${input.id}, ${input.projectId}, ${input.type}, ${input.canonicalValue},
              ${文本数组(input.aliases)}, ${nowSeconds()})
      on conflict (project_id, type, canonical_value) do update
         set aliases = (
           select coalesce(array_agg(distinct x), '{}'::text[])
             from unnest(auth.case_entity.aliases || excluded.aliases) as x
         )
      returning id
    `),
  )
  // `rowsOf` 返回 `Record<string, unknown>[]`；`!` 在这里是多余断言（本包没开
  // `noUncheckedIndexedAccess`），写成显式判空既过 lint 又能报出「没返回行」这种真异常。
  const id = 行[0]?.id
  // 用 `typeof` 判空而不是 `String(id)`：驱动将来把 `text` 列读成非字符串（Buffer 之类）时，
  // `String()` 会把它悄悄变成 `"[object Object]"` 当 id 返回；显式判型才能当场报出来。
  // 顺带消掉 `no-base-to-string` 的那条 warning（`String(unknown)` 会触发）。
  if (typeof id !== "string") throw new Error(`实体写入没有返回 id：${input.canonicalValue}`)
  return id
}

/**
 * 库约束 `case_relation_trust` / `case_event_trust` 的全集。
 *
 * 写路径不限于机器态：重放清理只删 `自动抽取`/`存疑`，但人工确认/修正/排除过的行
 * **也得能写进来**（用例里 `r-人工` 就是 `已确认`），所以类型按库约束给全。
 */
export type 事实信任态 = "自动抽取" | "已确认" | "已修正" | "已排除" | "存疑"

export interface 关系写入 {
  projectId: string
  id: string
  fromId: string
  toId: string
  type: string
  amount?: number | null
  basis?: string | null
  sourceKind: "data" | "human"
  trustState: 事实信任态
  firstAt?: number | null
  lastAt?: number | null
  precision?: string | null
  times?: number | null
}

/**
 * `numeric(18,2)` 列一律用**字符串**绑（`#002-01`、`case-store.ts` 里 `FactRowInput.amount`
 * 的注释同款理由：number 绑定出来的形状随驱动而变，还可能带浮点尾差）。调用方给 number，
 * 这里统一补两位小数。
 */
function 金额参数(值: number | null | undefined): string | null {
  return 值 === null || 值 === undefined ? null : 值.toFixed(2)
}

export async function insertRelation(db: Queryable, input: 关系写入): Promise<void> {
  await db.execute(sql`
    insert into auth.case_relation
      (id, project_id, from_id, to_id, type, first_at, last_at, precision, times, amount,
       basis, source_kind, trust_state, created_at)
    values (${input.id}, ${input.projectId}, ${input.fromId}, ${input.toId}, ${input.type},
            ${input.firstAt ?? null}, ${input.lastAt ?? null}, ${input.precision ?? null},
            ${input.times ?? null}, ${金额参数(input.amount)}, ${input.basis ?? null},
            ${input.sourceKind}, ${input.trustState}, ${nowSeconds()})
    on conflict (project_id, id) do nothing
  `)
}

export interface 事件写入 {
  projectId: string
  id: string
  type: string
  occurredAt: number | null
  occurredRaw: string | null
  precision: string | null
  participants: string[]
  summary: string | null
  trustState: 事实信任态
}

export async function insertEvent(db: Queryable, input: 事件写入): Promise<void> {
  await db.execute(sql`
    insert into auth.case_event
      (id, project_id, type, occurred_at, occurred_raw, precision, participants, summary,
       trust_state, created_at)
    values (${input.id}, ${input.projectId}, ${input.type}, ${input.occurredAt},
            ${input.occurredRaw}, ${input.precision}, ${文本数组(input.participants)},
            ${input.summary}, ${input.trustState}, ${nowSeconds()})
    on conflict (project_id, id) do nothing
  `)
}

/**
 * 删除「被本材料引用、且是机器抽出来」的关系与事件。
 *
 * ⚠️ 必须先于 `deleteCitationsOfMaterial`：删完引用就找不到该删哪些事实了。
 * 人工确认/修正/排除过的一律不删（设计 §5.3「重放不丢人工结论」）。
 */
export async function 删除本材料的事实(db: Queryable, projectId: string, materialId: string): Promise<void> {
  await db.execute(sql`
    delete from auth.case_relation r
     using auth.case_citation c
     where c.project_id = ${projectId} and c.material_id = ${materialId}
       and c.fact_type = 'relation'
       and r.project_id = c.project_id and r.id = c.fact_id
       and r.trust_state in ('自动抽取', '存疑')
  `)
  await db.execute(sql`
    delete from auth.case_event e
     using auth.case_citation c
     where c.project_id = ${projectId} and c.material_id = ${materialId}
       and c.fact_type = 'event'
       and e.project_id = c.project_id and e.id = c.fact_id
       and e.trust_state in ('自动抽取', '存疑')
  `)
}

/**
 * 删除本材料**不会被保留的事实**的引用（重放前清理）。
 *
 * 判断依据是「事实会不会被保留」，**不是引用自己怎么来的**：人工确认的事实，它的引用
 * 往往是抽取时以 `机器` 建的；按 `extract_method` 删会把出处一起删掉，而事实行因为
 * `on conflict do nothing` 不会重建引用 ⇒ locator 永久消失。
 *
 * - 关系 / 事件：`已确认`/`已修正`/`已排除` 的事实会被 `删除本材料的事实` 保留，
 *   它们的引用也留着（`not exists` 两个子查询）。
 * - 实体：实体本身从不删除，重放会重新引用；没再被抽到就该失去这条出处 ⇒ 照旧全删。
 */
export async function deleteCitationsOfMaterial(
  db: Queryable,
  projectId: string,
  materialId: string,
): Promise<void> {
  await db.execute(sql`
    delete from auth.case_citation c
     where c.project_id = ${projectId} and c.material_id = ${materialId}
       and not exists (
         select 1 from auth.case_relation r
          where c.fact_type = 'relation' and r.project_id = c.project_id and r.id = c.fact_id
            and r.trust_state in ('已确认','已修正','已排除')
       )
       and not exists (
         select 1 from auth.case_event e
          where c.fact_type = 'event' and e.project_id = c.project_id and e.id = c.fact_id
            and e.trust_state in ('已确认','已修正','已排除')
       )
  `)
}

export async function setMaterialText(
  db: Queryable,
  projectId: string,
  materialId: string,
  text: string,
): Promise<void> {
  const 行 = rowsOf(
    await db.execute(sql`
      update auth.case_material set text_content = ${text}
       where project_id = ${projectId} and id = ${materialId}
      returning id
    `),
  )
  if (行.length === 0) throw new Error(`材料不存在：${projectId}/${materialId}`)
}
