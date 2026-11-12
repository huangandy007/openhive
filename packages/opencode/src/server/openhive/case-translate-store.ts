export * as OpenhiveCaseTranslateStore from "./case-translate-store"

import { sql } from "drizzle-orm"
import { Hash } from "@opencode-ai/core/util/hash"
import { nowSeconds } from "@opencode-ai/auth/time"
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

  // ④ 关系重建、⑤ 属性写入在 Task 7 / Task 8 接入；本任务先只做上面的骨架。
  return { 卡片数: 翻译.卡片们.length, 别名数: 翻译.别名们.length, 属性实体数: 0 }
}
