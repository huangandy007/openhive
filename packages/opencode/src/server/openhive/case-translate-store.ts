export * as OpenhiveCaseTranslateStore from "./case-translate-store"

import { sql } from "drizzle-orm"
import { Hash } from "@opencode-ai/core/util/hash"
import { nowSeconds } from "@opencode-ai/auth/time"
import { rowsOf } from "@opencode-ai/auth/migrate"
import {
  addCitations,
  deleteCitationsOfMaterial,
  insertEvents,
  insertParticipants,
  upsertEntity,
  删除本材料的事实,
} from "./case-fact-store"
import type { CitationInput, Queryable } from "./case-store"
import { 账户键, type 翻译结果 } from "./case-translate"

/**
 * 翻译结果落库（01 §4.0 的「⑤ 落库」）。
 *
 * **业务判断一律不在这里**：卡片/别名/跳过的取舍由 `case-translate.ts` 的纯函数决定，
 * 这里只负责把它们写进 PG，并保证**不丢、不重、可重放**。
 *
 * 顺序不能换（Global Constraints 8）：
 * 清机器事实 → 参与者级联 → 别名撤销 → 实体归并 → 卡片/参与者/出处 → 别名 → 关系重建 → 属性。
 * 反序会留下孤儿参与者，或按已删事实找不到该清的行（`#007-02`）。
 */

function 事实id(...parts: (string | number)[]): string {
  return Hash.sha256(parts.join("\u0000")).slice(0, 32)
}

export interface 写入翻译输入 {
  projectId: string
  materialId: string
  templateId: string
  翻译: 翻译结果
}

export async function 清本材料翻译(tx: Queryable, projectId: string, materialId: string): Promise<void> {
  // 「关系对迁移」：本材料贡献过的**旧对**必须在删事件之前取出——事件删完就查不到了。
  // 否则重放换了对手时，旧对没有卡片支持、却从没人传进 `重建关系`，页面上会留一笔
  // 聚合了已删事件的转账（比少一笔更危险：它看起来像真线索）。
  const 旧对们: 关系对[] = rowsOf(
    await tx.execute(sql`
      select distinct 付.entity_id as from_id, 收.entity_id as to_id
        from auth.case_event e
        join auth.case_event_participant 付
          on 付.project_id = e.project_id and 付.event_id = e.id and 付.role = '付款方'
        join auth.case_event_participant 收
          on 收.project_id = e.project_id and 收.event_id = e.id and 收.role = '收款方'
       where e.project_id = ${projectId}
         and e.id in (select fact_id from auth.case_citation
                       where project_id = ${projectId} and material_id = ${materialId}
                         and fact_type = 'event')
         and 付.entity_id is not null and 收.entity_id is not null
    `),
  ).map((r) => ({ fromId: String(r.from_id), toId: String(r.to_id) }))

  await 删除本材料的事实(tx, projectId, materialId)
  // 参与者没有 material_id：它的归属只能从事件反推 ⇒ 事件删掉后按「孤儿」清（Q14）。
  // 只按本项目的孤儿清，别项目的参与者哪怕事件 id 同名也不动（主键是 (project_id, id)）。
  await tx.execute(sql`
    delete from auth.case_event_participant p
     where p.project_id = ${projectId}
       and not exists (
         select 1 from auth.case_event e
          where e.project_id = p.project_id and e.id = p.event_id
       )
  `)
  // 别名按 material_id 撤销（不硬删：有效期语义要留痕，重写时把 revoked_at 清回 null）。
  await tx.execute(sql`
    update auth.case_entity_alias
       set revoked_at = ${nowSeconds()}
     where project_id = ${projectId} and material_id = ${materialId} and revoked_at is null
  `)
  await deleteCitationsOfMaterial(tx, projectId, materialId)
  // 旧对重算放在清理之后：此时它们已无卡片支持 ⇒ 删机器行后不会再插入。
  // 人工保护（已确认/已修正整对放手）照旧由 `重建关系` 生效，清理不会删掉人工结论。
  await 重建关系(tx, projectId, 旧对们)
}

export async function 写入翻译结果(
  tx: Queryable,
  input: 写入翻译输入,
): Promise<{ 卡片数: number; 别名数: number; 属性实体数: number }> {
  const { projectId, materialId, templateId, 翻译 } = input

  // ① 实体归并：内存 Map 缓存「账户\u0000规范值 → entityId」（§4.0.3c，硬要求）。
  const 实体缓存 = new Map<string, string>()
  for (const 卡 of 翻译.卡片们) {
    for (const p of 卡.participants) {
      if (!p.实体) continue
      const 键 = 账户键(p.规范值)
      if (实体缓存.has(键)) continue
      const id = await upsertEntity(tx, {
        projectId,
        id: 事实id(projectId, "账户", p.规范值),
        type: "账户",
        canonicalValue: p.规范值,
        aliases: [],
      })
      实体缓存.set(键, id)
    }
  }

  // ② 卡片 + 参与者 + 出处（一份材料 2×N 行参与者，必须批量）
  const 引用们: CitationInput[] = []
  const 事件们 = 翻译.卡片们.map((卡) => ({
    projectId,
    id: 卡.id,
    type: 卡.type,
    occurredAt: 卡.occurredAt,
    occurredRaw: 卡.occurredRaw,
    precision: 卡.precision,
    // 原样落库：翻译层已保证是正数字符串（§3.5 / §4.0.5 坑 2），这里不做数值处理。
    amount: 卡.amount,
    participants: 卡.participants.map((p) => p.规范值),
    summary: null,
    trustState: "自动抽取" as const,
    attrs: 卡.attrs,
    currency: 卡.currency,
    templateId,
  }))
  for (const 卡 of 翻译.卡片们) {
    引用们.push({
      id: 事实id(projectId, "event", 卡.id, materialId),
      projectId,
      factType: "event",
      factId: 卡.id,
      materialId,
      locator: { sheet: 卡.sheet, row: 卡.rowNo },
      extractMethod: "机器",
    })
  }
  await insertEvents(tx, 事件们)
  await addCitations(tx, 引用们)

  const 参与者们 = 翻译.卡片们.flatMap((卡) =>
    卡.participants.map((p) => ({
      projectId,
      id: 事实id(projectId, "participant", 卡.id, String(p.ordinal)),
      eventId: 卡.id,
      entityId: p.实体 ? (实体缓存.get(账户键(p.规范值)) ?? null) : null,
      role: p.角色,
      mentionText: p.提及,
      citationId: 引用们.find((c) => c.factId === 卡.id)?.id ?? null,
      ordinal: p.ordinal,
    })),
  )
  await insertParticipants(tx, 参与者们)

  // ③ 别名（kind='户名'，挂账户）：id 由 (材料, 实体, 值) 决定，重放时把 revoked_at 清回 null。
  for (const a of 翻译.别名们) {
    const entityId = 实体缓存.get(账户键(a.规范值))
    if (entityId === undefined) continue
    await tx.execute(sql`
      insert into auth.case_entity_alias
        (id, project_id, entity_id, kind, value, raw_value, source_kind, material_id, created_at, revoked_at)
      values (${事实id(projectId, "alias", entityId, a.值, materialId)}, ${projectId}, ${entityId},
              '户名', ${a.值}, ${a.值}, '表格', ${materialId}, ${nowSeconds()}, null)
      on conflict (project_id, id) do update
         set value = excluded.value, raw_value = excluded.raw_value, revoked_at = null
    `)
  }

  // ④ 关系重建：只重算本次受影响的账户对（双方都可建实体才算，掩码账号不建关系）。
  const 对们: 关系对[] = 翻译.卡片们.flatMap((卡) => {
    const [主体, 对手] = 卡.participants
    if (!主体.实体 || !对手.实体) return []
    const 主体id = 实体缓存.get(账户键(主体.规范值))
    const 对手id = 实体缓存.get(账户键(对手.规范值))
    if (主体id === undefined || 对手id === undefined) return []
    return [主体.角色 === "付款方" ? { fromId: 主体id, toId: 对手id } : { fromId: 对手id, toId: 主体id }]
  })
  await 重建关系(tx, projectId, 对们)

  // ⑤ 属性写入在 Task 8 接入。
  return { 卡片数: 翻译.卡片们.length, 别名数: 翻译.别名们.length, 属性实体数: 0 }
}

export interface 关系对 {
  fromId: string
  toId: string
}

/** 关系对一批多少对：18 列上限不适用，按 2 个参数/对留足余量。 */
const INSERT_CHUNK_PAIRS = 500

/**
 * 从卡片重建关系（§4.0.4：卡片是唯一事实，关系是对卡片的聚合）。
 *
 * 为什么不能「按材料增量累加」：同一对账户常出现在双方各自导出的流水里。增量累加会在
 * 重放时算重（`#007-02` 的同款形态），`on conflict do nothing` 又会让后到材料的笔数
 * 静默丢失。唯一正确的做法是：删掉这一对的机器态，再从 `case_event` + 参与者重新聚合。
 *
 * 人工结论优先：该对已有 `已确认`/`已修正` 行时整对跳过——机器行与人工行并存会被
 * 求和逻辑算成两笔。
 *
 * 币种口径（Q16 / Global Constraints 14，2026-11-12 裁定）：`times` 统计**所有币种**的
 * 资金交易笔数（「这两人有没有往来」是定性事实，抹掉外币往来等于隐藏线索）；`amount`
 * 只累加 `currency='CNY'` 的金额（外币行不进人民币合计）。未计入张数由调用方写
 * `parse_detail`。
 */
export async function 重建关系(tx: Queryable, projectId: string, 对们: readonly 关系对[]): Promise<number> {
  if (对们.length === 0) return 0
  let written = 0
  for (let i = 0; i < 对们.length; i += INSERT_CHUNK_PAIRS) {
    const chunk = 对们.slice(i, i + INSERT_CHUNK_PAIRS)
    const 值 = sql.join(
      chunk.map((p) => sql`(${p.fromId}, ${p.toId})`),
      sql`, `,
    )

    // 人工行存在就对整对放手：不清、不写。
    const 人工 = rowsOf(
      await tx.execute(sql`
        select distinct r.from_id, r.to_id
          from auth.case_relation r
         where r.project_id = ${projectId} and r.type = '转账'
           and r.trust_state in ('已确认', '已修正')
           and (r.from_id, r.to_id) in (values ${值})
      `),
    )
    const 保护 = new Set(人工.map((r) => `${String(r.from_id)}\u0000${String(r.to_id)}`))

    await tx.execute(sql`
      delete from auth.case_relation
       where project_id = ${projectId} and type = '转账'
         and trust_state in ('自动抽取', '存疑')
         and (from_id, to_id) in (values ${值})
    `)

    const 聚合 = rowsOf(
      await tx.execute(sql`
        select 付.entity_id as from_id, 收.entity_id as to_id,
               count(*)::int as times,
               coalesce(sum(e.amount) filter (where e.currency = 'CNY'), 0)::numeric(18,2)::text as amount,
               min(e.occurred_at) as first_at, max(e.occurred_at) as last_at,
               case when bool_or(e.precision = '到日') then '到日'
                    when bool_or(e.precision = '到分') then '到分'
                    else '到秒' end as precision
          from auth.case_event e
          join auth.case_event_participant 付
            on 付.project_id = e.project_id and 付.event_id = e.id and 付.role = '付款方'
          join auth.case_event_participant 收
            on 收.project_id = e.project_id and 收.event_id = e.id and 收.role = '收款方'
         where e.project_id = ${projectId}
           and e.type = '资金交易'
           and e.trust_state <> '已排除'
           and 付.entity_id is not null and 收.entity_id is not null
           and (付.entity_id, 收.entity_id) in (values ${值})
         group by 1, 2
      `),
    )

    for (const 行 of 聚合) {
      const fromId = String(行.from_id)
      const toId = String(行.to_id)
      if (保护.has(`${fromId}\u0000${toId}`)) continue
      // `::text` 聚合列按字符串回读；显式判型而不是 `String(...)`，否则驱动把 numeric
      // 读成对象时会静默落成 `"[object Object]"`（`upsertEntity` 里同一条理由）。
      const 金额 = typeof 行.amount === "string" ? 行.amount : "0.00"
      await tx.execute(sql`
        insert into auth.case_relation
          (id, project_id, from_id, to_id, type, first_at, last_at, precision, times, amount,
           basis, source_kind, trust_state, created_at)
        values (${事实id(projectId, "转账", fromId, toId)}, ${projectId}, ${fromId}, ${toId}, '转账',
                ${行.first_at ?? null}, ${行.last_at ?? null}, ${行.precision ?? null},
                ${Number(行.times ?? 0)}, ${金额}, null, 'data', '自动抽取',
                ${nowSeconds()})
        on conflict (project_id, id) do nothing
      `)
      written += 1
    }
  }
  return written
}
