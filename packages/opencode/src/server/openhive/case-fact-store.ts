export * as OpenhiveCaseFactStore from "./case-fact-store"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import type { CitationInput, Queryable } from "./case-store"
import { 合并属性, 读jsonb } from "./case-entity-attrs"

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
  /**
   * 实体附加信息（jsonb）。目前只有 `subtype`（材料里明确写出的细类）与
   * `属性:<归属>:<键>` 产出的观察数组（01 §3.10）。
   * 按 `合并属性` 合并：观察数组按 `值` 去重、同键不同值并存；标量键新值覆盖。
   */
  attrs?: Record<string, unknown>
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
 *
 * 单条版**直接委托批量版**（同 `insertEvent` → `insertEvents`）：两份 upsert 各自维护
 * 「先读 attrs 再合并」迟早会分叉。逐行调用它仍是每实体两次往返——批量场景用
 * `upsertEntities`（2026-11-15：5000 行流水 = 5001 个账号，逐行时实测外推 445s）。
 */
export async function upsertEntity(db: Queryable, input: 实体写入): Promise<string> {
  const [行] = await upsertEntities(db, [input])
  // `rowsOf` 返回 `Record<string, unknown>[]`；`!` 在这里是多余断言（本包没开
  // `noUncheckedIndexedAccess`），写成显式判空既过 lint 又能报出「没返回行」这种真异常。
  const id = 行?.id
  // 用显式判型而不是 `String(id)`：驱动将来把 `text` 列读成非字符串（Buffer 之类）时，
  // `String()` 会把它悄悄变成 `"[object Object]"` 当 id 返回（`no-base-to-string`）。
  if (typeof id !== "string") throw new Error(`实体写入没有返回 id：${input.canonicalValue}`)
  return id
}

/** 实体的唯一键（与库上 `unique (project_id, type, canonical_value)` 同形）。 */
function 实体键三列(projectId: string, type: string, canonicalValue: string): string {
  return `${projectId}\u0000${type}\u0000${canonicalValue}`
}

/**
 * 批量版：`写入翻译结果` ① 一次写几百上千个账号。
 *
 * 分块多值写（理由同 `insertRows`）：先一次 SELECT 取现有 attrs，再一条
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` 回全部 id ⇒ 每 500 个实体 2 次往返，
 * 而不是 2×N 次。
 *
 * **必须先按唯一键去重**：同一个 `(project_id, type, canonical_value)` 在一个语句里
 * 出现两次时，`do update` 会报 `21000 ON CONFLICT DO UPDATE command cannot affect
 * row a second time`（逐行写时两次调用分属不同语句，撞不出这个错）。合并顺序与逐行一致：
 * attrs 按出现顺序 `合并属性`，aliases 取并集。
 */
export async function upsertEntities(
  db: Queryable,
  inputs: readonly 实体写入[],
): Promise<{ id: string; type: string; canonicalValue: string }[]> {
  if (inputs.length === 0) return []
  const 待写 = new Map<string, 实体写入>()
  for (const input of inputs) {
    const 键 = 实体键三列(input.projectId, input.type, input.canonicalValue)
    const 已有 = 待写.get(键)
    待写.set(
      键,
      已有 === undefined
        ? input
        : {
            ...已有,
            attrs: 合并属性(已有.attrs ?? {}, input.attrs ?? {}),
            aliases: [...new Set([...已有.aliases, ...input.aliases])],
          },
    )
  }
  const 列表 = [...待写.values()]

  // 现有 attrs 一次取回。三个列一起做行值 `in (values …)`：用两个 `= any(…)` 等于把
  // 「项目 × 值」做成笛卡尔积，规划器各扫一遍（`#013-05`：同一归属集只写一遍）。
  const 现按实体 = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < 列表.length; i += INSERT_CHUNK) {
    const chunk = 列表.slice(i, i + INSERT_CHUNK)
    const 行们 = rowsOf(
      await db.execute(sql`
        select project_id, type, canonical_value, attrs from auth.case_entity
         where (project_id, type, canonical_value) in (values ${sql.join(
           chunk.map((e) => sql`(${e.projectId}, ${e.type}, ${e.canonicalValue})`),
           sql`, `,
         )})
      `),
    )
    for (const r of 行们) {
      现按实体.set(实体键三列(String(r.project_id), String(r.type), String(r.canonical_value)), 读jsonb(r.attrs))
    }
  }

  const 返回: { id: string; type: string; canonicalValue: string }[] = []
  for (let i = 0; i < 列表.length; i += INSERT_CHUNK) {
    const chunk = 列表.slice(i, i + INSERT_CHUNK)
    const 行们 = rowsOf(
      await db.execute(sql`
        insert into auth.case_entity (id, project_id, type, canonical_value, aliases, attrs, created_at)
        values ${sql.join(
          chunk.map(
            (e) => sql`(${e.id}, ${e.projectId}, ${e.type}, ${e.canonicalValue},
                        ${文本数组(e.aliases)},
                        ${JSON.stringify(合并属性(现按实体.get(实体键三列(e.projectId, e.type, e.canonicalValue)) ?? {}, e.attrs ?? {}))}::text::jsonb,
                        ${nowSeconds()})`,
          ),
          sql`, `,
        )}
        on conflict (project_id, type, canonical_value) do update
           set aliases = (
             select coalesce(array_agg(distinct x), '{}'::text[])
               from unnest(auth.case_entity.aliases || excluded.aliases) as x
           ),
           attrs = excluded.attrs
        returning id, type, canonical_value
      `),
    )
    for (const r of 行们) {
      返回.push({ id: String(r.id), type: String(r.type), canonicalValue: String(r.canonical_value) })
    }
  }
  return 返回
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
  /** 金额：number 走 `toFixed(2)`，字符串原样绑（`numeric::text` 在 18 位上不能过 Number）。 */
  amount?: number | string | null
  basis?: string | null
  sourceKind: "data" | "human"
  trustState: 事实信任态
  firstAt?: number | null
  lastAt?: number | null
  precision?: string | null
  times?: number | null
  /** 人民币笔数（0040）。不传即 NULL——单条版历史列集不含它，语义不变。 */
  timesCny?: number | null
}

/**
 * `numeric(18,2)` 列一律用**字符串**绑（`#002-01`、`case-store.ts` 里 `FactRowInput.amount`
 * 的注释同款理由：number 绑定出来的形状随驱动而变，还可能带浮点尾差）。调用方给 number，
 * 这里统一补两位小数。
 */
function 金额参数(值: number | string | null | undefined): string | null {
  if (值 === null || 值 === undefined) return null
  // 已经是 `numeric::text` 的字符串原样绑：经 `Number` 再 `toFixed` 会在 18 位金额上丢精度
  // （`重建关系` 的聚合金额就是这种字符串）。
  return typeof 值 === "string" ? 值 : 值.toFixed(2)
}

/** 单条版委托批量版（理由同 `upsertEntity`）；批量场景用 `insertRelations`。 */
export async function insertRelation(db: Queryable, input: 关系写入): Promise<void> {
  await insertRelations(db, [input])
}

/**
 * 批量写关系，返回**实际插入**的行数（`on conflict do nothing` 的 returning 为空，不虚高）。
 *
 * `do nothing` 允许同一语句里出现重复 id（`do update` 才会 21000），所以这里不去重。
 * 2026-11-15：`重建关系` 曾按对逐条插——5000 行流水 = 5000 个对手对，单次往返 22ms
 * ⇒ 110s 只写关系。
 */
export async function insertRelations(db: Queryable, inputs: readonly 关系写入[]): Promise<number> {
  let written = 0
  for (let i = 0; i < inputs.length; i += INSERT_CHUNK) {
    const chunk = inputs.slice(i, i + INSERT_CHUNK)
    const 结果 = rowsOf(
      await db.execute(sql`
        insert into auth.case_relation
          (id, project_id, from_id, to_id, type, first_at, last_at, precision, times, times_cny, amount,
           basis, source_kind, trust_state, created_at)
        values ${sql.join(
          chunk.map(
            (r) => sql`(${r.id}, ${r.projectId}, ${r.fromId}, ${r.toId}, ${r.type},
                        ${r.firstAt ?? null}, ${r.lastAt ?? null}, ${r.precision ?? null},
                        ${r.times ?? null}, ${r.timesCny ?? null}, ${金额参数(r.amount)},
                        ${r.basis ?? null}, ${r.sourceKind}, ${r.trustState}, ${nowSeconds()})`,
          ),
          sql`, `,
        )}
        on conflict (project_id, id) do nothing
        returning id
      `),
    )
    written += 结果.length
  }
  return written
}

export interface 实体别名写入 {
  projectId: string
  id: string
  entityId: string
  kind: string
  value: string
  rawValue: string
  sourceKind: string
  materialId: string
  createdAt: number
}

/**
 * 批量写 `case_entity_alias`。重放语义：命中同 id 时把 `revoked_at` 清回 null
 * （逐条版写死 `null`，`do update` 里也写死 `null`——这是「撤销过的别名重新出现」的复位）。
 *
 * 必须按 `(project_id, id)` 去重：`do update` 不允许一条语句改同一行两次（21000）。
 * 2026-11-15：`写入翻译结果` ③ 曾逐条插——5001 个别名 × 22ms = 110s。
 */
export async function upsertEntityAliases(db: Queryable, inputs: readonly 实体别名写入[]): Promise<number> {
  const 待写 = new Map<string, 实体别名写入>()
  for (const a of inputs) 待写.set(`${a.projectId}\u0000${a.id}`, a)
  const 列表 = [...待写.values()]
  let written = 0
  for (let i = 0; i < 列表.length; i += INSERT_CHUNK) {
    const chunk = 列表.slice(i, i + INSERT_CHUNK)
    const 结果 = rowsOf(
      await db.execute(sql`
        insert into auth.case_entity_alias
          (id, project_id, entity_id, kind, value, raw_value, source_kind, material_id, created_at, revoked_at)
        values ${sql.join(
          chunk.map(
            (a) => sql`(${a.id}, ${a.projectId}, ${a.entityId}, ${a.kind}, ${a.value}, ${a.rawValue},
                        ${a.sourceKind}, ${a.materialId}, ${a.createdAt}, null)`,
          ),
          sql`, `,
        )}
        on conflict (project_id, id) do update
           set value = excluded.value, raw_value = excluded.raw_value, revoked_at = null
        returning id
      `),
    )
    written += 结果.length
  }
  return written
}

export interface 事件写入 {
  projectId: string
  id: string
  type: string
  occurredAt: number | null
  occurredRaw: string | null
  precision: string | null
  /**
   * 时间类型：`发生` = 真实交易时刻，`记录` = 系统批处理记账时刻（如银行 02:00 的利息入账）。
   * 作息/到账时点分析必须剔除 `记录`；来源未声明时为 null（不臆造 `发生`）。
   */
  timeType?: "发生" | "记录" | "入库" | null
  /**
   * 金额，`numeric(18,2)` 一律字符串传（`#002-01`），**永远正数**（01 §3.5 / §4.0.5 坑 2）。
   * 非资金类事件（住宿、话单）为 null。列在迁移 `0039:89`，T7 的 `sum(e.amount)` 依赖它——
   * 漏写这一列，聚合会恒为 0 而不报错。
   */
  amount?: string | null
  participants: string[]
  summary: string | null
  trustState: 事实信任态
  /** 区间事件结束（住宿）。点事件为 null（01 §3.5）。 */
  occurredEnd?: number | null
  /** 类型专属属性，只放不参与过滤的（余额等）。 */
  attrs?: Record<string, unknown>
  /** 卡片币种：非 CNY 不进关系合计（Global Constraints 14）。 */
  currency?: string
  /** 产出这张卡片的模板行 id（Q15）。 */
  templateId?: string | null
  /** 用途：最具体类（二级叶子或一级类）。AI 抽取路径不判用途，传 undefined（01 §3.11.2）。 */
  purpose?: string | null
  /** 一级类：报表按一级出，两级都要能直接过滤。 */
  purposeL1?: string | null
  /** 依据：规则 / 命中词 / 字段 / 词表版本（A20 可审计）。 */
  purposeBasis?: Record<string, unknown> | null
}

/**
 * 单条版：**直接委托批量版**，不再维护第二份 10 列 INSERT。
 *
 * 两份列集曾经不一致（单条缺 `amount/currency/attrs/template_id/occurred_end`），
 * 接口上「能传」与「会落」不一致是下一期最容易踩的坑（`#002-06` / M3）。
 */
export async function insertEvent(db: Queryable, input: 事件写入): Promise<void> {
  await insertEvents(db, [input])
}

/**
 * 批量写入的分块大小。与 `case-store.ts` 的 `INSERT_CHUNK` 同值同理由
 * （事件 18 列 × 500 = 9000 个绑定参数，离 PG 上限 65535 有量级余量）；那份是模块内常量、
 * 未导出，这里按本文件需要的量级单独定一份，不从调用方借。
 */
const INSERT_CHUNK = 500

const 事件列 = sql`
  id, project_id, type, occurred_at, occurred_raw, precision, time_type, amount, participants, summary,
  trust_state, created_at, occurred_end, attrs, currency, template_id,
  purpose, purpose_l1, purpose_basis
`

function 事件值(e: 事件写入) {
  return sql`(${e.id}, ${e.projectId}, ${e.type}, ${e.occurredAt}, ${e.occurredRaw},
              ${e.precision}, ${e.timeType ?? null}, ${e.amount ?? null}, ${文本数组(e.participants)}, ${e.summary}, ${e.trustState},
              ${nowSeconds()}, ${e.occurredEnd ?? null},
              ${JSON.stringify(e.attrs ?? {})}::text::jsonb, ${e.currency ?? "CNY"},
              ${e.templateId ?? null},
              ${e.purpose ?? null}, ${e.purposeL1 ?? null},
              ${e.purposeBasis === undefined || e.purposeBasis === null ? null : JSON.stringify(e.purposeBasis)}::text::jsonb)`
}

/** 一条一份材料的卡片不逐行发语句：5,000 行 = 5,000 次往返（§6.5）。 */
export async function insertEvents(db: Queryable, inputs: readonly 事件写入[]): Promise<number> {
  let written = 0
  for (let i = 0; i < inputs.length; i += INSERT_CHUNK) {
    const chunk = inputs.slice(i, i + INSERT_CHUNK)
    const 结果 = rowsOf(
      await db.execute(sql`
        insert into auth.case_event (${事件列})
        values ${sql.join(chunk.map(事件值), sql`, `)}
        on conflict (project_id, id) do nothing
        returning id
      `),
    )
    written += 结果.length
  }
  return written
}

export interface 参与者写入 {
  projectId: string
  id: string
  eventId: string
  entityId: string | null
  role: string
  mentionText: string
  citationId: string | null
  ordinal: number
}

export async function insertParticipants(db: Queryable, inputs: readonly 参与者写入[]): Promise<number> {
  let written = 0
  for (let i = 0; i < inputs.length; i += INSERT_CHUNK) {
    const chunk = inputs.slice(i, i + INSERT_CHUNK)
    const 结果 = rowsOf(
      await db.execute(sql`
        insert into auth.case_event_participant
          (id, project_id, event_id, entity_id, role, mention_text, citation_id, ordinal)
        values ${sql.join(
          chunk.map(
            (p) => sql`(${p.id}, ${p.projectId}, ${p.eventId}, ${p.entityId}, ${p.role},
                        ${p.mentionText}, ${p.citationId}, ${p.ordinal})`,
          ),
          sql`, `,
        )}
        on conflict (project_id, event_id, ordinal) do update
           set entity_id = excluded.entity_id,
               role = excluded.role,
               mention_text = excluded.mention_text
        returning id
      `),
    )
    written += 结果.length
  }
  return written
}

/** `addCitation` 的批量版；locator 走 `::text::jsonb`（`case-store.ts:476` 的老坑）。 */
export async function addCitations(db: Queryable, inputs: readonly CitationInput[]): Promise<number> {
  let written = 0
  for (let i = 0; i < inputs.length; i += INSERT_CHUNK) {
    const chunk = inputs.slice(i, i + INSERT_CHUNK)
    const 结果 = rowsOf(
      await db.execute(sql`
        insert into auth.case_citation
          (id, project_id, fact_type, fact_id, material_id, locator, extract_method, confidence, created_at)
        values ${sql.join(
          chunk.map(
            (c) => sql`(${c.id}, ${c.projectId}, ${c.factType}, ${c.factId}, ${c.materialId},
                        ${JSON.stringify(c.locator)}::text::jsonb, ${c.extractMethod},
                        ${c.confidence ?? null}, ${nowSeconds()})`,
          ),
          sql`, `,
        )}
        on conflict (project_id, id) do nothing
        returning id
      `),
    )
    written += 结果.length
  }
  return written
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
