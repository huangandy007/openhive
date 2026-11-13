export * as OpenhiveCaseTranslateStore from "./case-translate-store"

import { sql, type SQL } from "drizzle-orm"
import { Hash } from "@opencode-ai/core/util/hash"
import { nowSeconds } from "@opencode-ai/auth/time"
import { rowsOf } from "@opencode-ai/auth/migrate"
import {
  addCitations,
  deleteCitationsOfMaterial,
  insertEvents,
  insertParticipants,
  upsertEntity,
  文本数组,
  删除本材料的事实,
} from "./case-fact-store"
import { INSERT_CHUNK, type CitationInput, type Queryable } from "./case-store"
import { 账户键, type 翻译结果 } from "./case-translate"
import { 资金交易 } from "./case-event-types"
import { 合并属性, 属性观察表, 剥离本材料出处, 读jsonb } from "./case-entity-attrs"
import { 户名对齐 } from "./case-party"
import { 匹配覆盖事件, type 关系候选, type 事件候选 } from "./case-match"

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

/**
 * 人工结论：重放一律保留（设计 §5.3）。
 *
 * 事件保护（`insertEvents` 的 `do nothing`）与参与者保护（本文件 `受保护` 查询）必须同一份，
 * 改一处即两处（`#002-06`）。漏了参与者这一处，人工卡会变成「旧金额 + 新参与者」——
 * 比整卡覆盖更难解释。
 *
 * 关系侧**不再整对保护**（P3 §3.2 / §5）：`重建关系` 照常写机器行、与人工行并存；
 * 重放换对手时的旧对改由「删除事件之前取出旧对（`旧对们`）+ 聚合排除被 human 覆盖的事件」
 * 承担。人工结论的**机器行**仍受 `trust_state in ('自动抽取','存疑')` 的删除条件保护。
 */
const 人工结论们 = ["已确认", "已修正", "已排除"] as const

/** `in (...)` 用的值列表：「已确认/已修正/已排除」的**事件**整卡保护用。 */
const 人工结论值 = sql.join(
  人工结论们.map((v) => sql`${v}`),
  sql`, `,
)

export interface 写入翻译输入 {
  projectId: string
  materialId: string
  templateId: string
  翻译: 翻译结果
}

export async function 清本材料翻译(tx: Queryable, projectId: string, materialId: string): Promise<void> {
  // F8（M2）：本函数末尾的 attrs 反查是 `strpos(attrs::text, '"<materialId>#')`，前提是
  // jsonb 文本里 materialId 原样出现；含 `"` 或 `\` 时 jsonb 会转义（`\"`、`\\`），反查
  // 静默漏清。现在的取值只有 `crypto.randomUUID()` / `mat-<hash>`，前提成立；把闸放在
  // **任何副作用之前**，将来若改由用户输入决定，宁可当场报错也不静默留脏属性（`#004-09`）。
  if (materialId.includes('"') || materialId.includes("\\")) {
    throw new Error(`materialId 形状与本函数前提不符：不能含引号或反斜杠：${materialId}`)
  }
  // 「关系对迁移」：本材料贡献过的**旧对**必须在删事件之前取出——事件删完就查不到了。
  // 否则重放换了对手时，旧对没有卡片支持、却从没人传进 `重建关系`，页面上会留一笔
  // 聚合了已删事件的转账（比少一笔更危险：它看起来像真线索）。
  // 角色前提与 `重建关系` 同用 `资金参与者基`，改一处必须改该基（`#002-06`）。
  const 旧对们: 关系对[] = rowsOf(
    await tx.execute(sql`
      select distinct 付.entity_id as from_id, 收.entity_id as to_id
        ${资金参与者基(projectId)}
           and e.id in (select fact_id from auth.case_citation
                         where project_id = ${projectId} and material_id = ${materialId}
                           and fact_type = 'event')
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
  // 属性清理：attrs 按实体存、没有 material_id 列，只能反查「谁的 attrs 里带本材料的出处」。
  // 用 `strpos` 而不是 `like`：materialId 里的 `%` / `_` 在 LIKE 里是通配符。
  // 搜 `"<materialId>#`（带前引号）而不是裸 `<materialId>#`：`am1#` 是 `xam1#` 的子串，
  // jsonb 文本里出处值形如 `"出处": "am1#Sheet1#2"`，带引号才精确到「这个出处值开头」。
  // 只在写入侧（⑤）剥离不够：⑤ 只看得到「本轮仍有新观察」的实体，本轮一条都没有的实体
  // 只能在这里按材料找（Q14）。
  // 前提：materialId 不含 `"` 或 `\`。含这两个字符时 jsonb 文本会转义（`\"`、`\\`），
  // 本反查漏判。函数入口已按 F8 抛错拦住；若将来 materialId 改由用户输入决定，
  // 要换成按 jsonb 结构判定（jsonpath），同时撤掉入口那道闸。
  const 带味实体 = rowsOf(
    await tx.execute(sql`
      select id, attrs from auth.case_entity
       where project_id = ${projectId}
         and strpos(attrs::text, ${'"' + materialId + '#'}) > 0
    `),
  )
  for (let i = 0; i < 带味实体.length; i += INSERT_CHUNK) {
    const chunk = 带味实体.slice(i, i + INSERT_CHUNK)
    await tx.execute(sql`
      update auth.case_entity e
         set attrs = v.attrs
        from (values ${sql.join(
          chunk.map((r) => sql`(${String(r.id)}, ${JSON.stringify(剥离本材料出处(读jsonb(r.attrs), materialId))}::text::jsonb)`),
          sql`, `,
        )}) as v(id, attrs)
       where e.project_id = ${projectId} and e.id = v.id
    `)
  }
  // 旧对重算放在清理之后：此时它们已无卡片支持 ⇒ 删机器行后不会再插入。
  // 人工结论的**机器行**仍受 `trust_state in ('自动抽取','存疑')` 的删除条件保护；
  // 「该对有一个人工结论就整对不写机器行」的粗粒度保护已移除（P3 去重后两者互不相交）。
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

  // 人工结论的事件整卡保护（设计 §5.3 / I1）：`insertEvents` 的 `do nothing` 只保住事件行，
  // 参与者却是无条件 upsert ⇒ 重放换对手时同一张卡会变成「旧金额 + 新参与者」。
  // 刚插入的事件恒为 `自动抽取`，所以这里查到的必然是上一轮已被人工裁决的卡。
  // 关系不需要额外跳过：`重建关系` 从 `case_event` + 参与者聚合，受保护卡的旧参与者仍在库里
  // ⇒ 旧对保持；旧对由 `清本材料翻译` 的 `旧对们` 传入（人工事实的引用被保留）。
  const 卡ids = 翻译.卡片们.map((卡) => 卡.id)
  const 受保护 =
    卡ids.length === 0
      ? new Set<string>()
      : new Set(
          rowsOf(
            await tx.execute(sql`
              select id from auth.case_event
               where project_id = ${projectId} and id = any(${文本数组(卡ids)})
                 and trust_state in (${人工结论值})
            `),
          ).map((r) => String(r.id)),
        )

  // 出处按卡片建一次索引：参与者数 = 2×卡片数，逐个 `find` 是全量扫描 ⇒ 2N² 次比较，
  // 20 万行时会在单 worker 事务内冻住（I4 / `#011-03`）。
  const 引用按卡 = new Map(引用们.map((c) => [c.factId, c.id]))
  const 参与者们 = 翻译.卡片们.flatMap((卡) =>
    // 整卡跳过：不写、也不改（`entity_id` / `role` / `mention_text` 全部保留人工裁决时的值）。
    受保护.has(卡.id)
      ? []
      : 卡.participants.map((p) => ({
          projectId,
          id: 事实id(projectId, "participant", 卡.id, String(p.ordinal)),
          eventId: 卡.id,
          entityId: p.实体 ? (实体缓存.get(账户键(p.规范值)) ?? null) : null,
          role: p.角色,
          mentionText: p.提及,
          citationId: 引用按卡.get(卡.id) ?? null,
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
  // 同一对会被多张卡片命中 ⇒ 按 (from, to) 去重；只处理资金交易卡（`卡片草稿.type`
  // 已有 9 种，将来复用本 store 时别对无关类型做无谓 delete）。
  const 对们: 关系对[] = []
  const 已见对 = new Set<string>()
  for (const 卡 of 翻译.卡片们) {
    if (卡.type !== 资金交易) continue
    const [主体, 对手] = 卡.participants
    if (!主体.实体 || !对手.实体) continue
    const 主体id = 实体缓存.get(账户键(主体.规范值))
    const 对手id = 实体缓存.get(账户键(对手.规范值))
    if (主体id === undefined || 对手id === undefined) continue
    const 对 = 主体.角色 === "付款方" ? { fromId: 主体id, toId: 对手id } : { fromId: 对手id, toId: 主体id }
    const 键 = `${对.fromId}\u0000${对.toId}`
    if (已见对.has(键)) continue
    已见对.add(键)
    对们.push(对)
  }
  await 重建关系(tx, projectId, 对们)

  // ⑤ 属性写入：读 → 剥离本材料出处 → 合并 → 写（Q14 / 05 §5.2）。
  const 按实体 = 属性观察表(翻译.属性们, 实体缓存, 翻译.卡片们, materialId)
  if (按实体.size > 0) {
    const ids = [...按实体.keys()]
    const 现有们 = rowsOf(
      await tx.execute(sql`
        select id, attrs from auth.case_entity
         where project_id = ${projectId} and id = any(${文本数组(ids)})
      `),
    )
    const 现按id = new Map(现有们.map((r) => [String(r.id), 读jsonb(r.attrs)]))
    for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
      const chunk = ids.slice(i, i + INSERT_CHUNK)
      await tx.execute(sql`
        update auth.case_entity e
           set attrs = v.attrs
          from (values ${sql.join(
            chunk.map((id) => {
              const 合并后 = 合并属性(剥离本材料出处(现按id.get(id) ?? {}, materialId), 按实体.get(id) ?? {})
              return sql`(${id}, ${JSON.stringify(合并后)}::text::jsonb)`
            }),
            sql`, `,
          )}) as v(id, attrs)
         where e.project_id = ${projectId} and e.id = v.id
      `)
    }
  }
  return { 卡片数: 翻译.卡片们.length, 别名数: 翻译.别名们.length, 属性实体数: 按实体.size }
}

export interface 关系对 {
  fromId: string
  toId: string
}

/** 关系对一批多少对：18 列上限不适用，按 2 个参数/对留足余量。 */
const INSERT_CHUNK_PAIRS = 500

/**
 * 「事件有一个付款方和一个收款方」的取数基（`#002-06`）：角色前提只写这一处。
 *
 * 三个调用点共用：`清本材料翻译` 取旧对、`重建关系` 取匹配候选、`重建关系` 聚合。
 * 基里**只放**三处都成立的前提（项目、两个角色、两端非空）；`type` / `trust_state` /
 * 对过滤由各调用点自己追加——把它们塞进基里，「旧对」就查不到非转账事件，
 * 重放换对手时会静默留下一笔聚合了已删事件的转账（`#013-02`）。
 */
function 资金参与者基(projectId: string): SQL {
  return sql`from auth.case_event e
    join auth.case_event_participant 付
      on 付.project_id = e.project_id and 付.event_id = e.id and 付.role = '付款方'
    join auth.case_event_participant 收
      on 收.project_id = e.project_id and 收.event_id = e.id and 收.role = '收款方'
   where e.project_id = ${projectId}
     and 付.entity_id is not null and 收.entity_id is not null`
}

/**
 * 从卡片重建关系（§4.0.4：卡片是唯一事实，关系是对卡片的聚合）。
 *
 * 为什么不能「按材料增量累加」：同一对账户常出现在双方各自导出的流水里。增量累加会在
 * 重放时算重（`#007-02` 的同款形态），`on conflict do nothing` 又会让后到材料的笔数
 * 静默丢失。唯一正确的做法是：删掉这一对的机器态，再从 `case_event` + 参与者重新聚合。
 *
 * 去重后 human 行与机器行覆盖**互不相交**的转账，可以并存；因此不再保留
 * 「该对存在人工结论行 ⇒ 整对不写机器行」的粗粒度保护（#013-04 同型：保护父行
 * 不能连孩子一起覆盖）。人工结论的**机器行**仍受 `trust_state in ('自动抽取','存疑')`
 * 的删除条件保护，重放不会覆盖已确认/已修正的机器事实。
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

    // ① 该 chunk 的 human 转账关系（端点先对齐；对齐后落在本 chunk 的才算）。
    //    `#002-06`：别名前提只在 case-party.ts 定义；这里只负责 join 与行值过滤。
    const 关系行 = rowsOf(
      await tx.execute(sql`
        select r.id, r.amount::text as amount, r.first_at, r.trust_state,
               coalesce(起对齐.代表, r.from_id) as from_代表,
               coalesce(终对齐.代表, r.to_id) as to_代表
          from auth.case_relation r
          join auth.case_entity 起 on 起.project_id = r.project_id and 起.id = r.from_id
          join auth.case_entity 终 on 终.project_id = r.project_id and 终.id = r.to_id
          left join lateral ${户名对齐(projectId, sql`起.id`, sql`起.type`, sql`起.canonical_value`)} 起对齐 on true
          left join lateral ${户名对齐(projectId, sql`终.id`, sql`终.type`, sql`终.canonical_value`)} 终对齐 on true
         where r.project_id = ${projectId} and r.type = '转账' and r.source_kind = 'human'
           and r.trust_state <> '已排除'
           and (coalesce(起对齐.代表, r.from_id), coalesce(终对齐.代表, r.to_id)) in (values ${值})
      `),
    )
    const 关系们: 关系候选[] = 关系行.map((行) => {
      // 与聚合循环同款：金额判型失败**抛错**，不能 `String()` 兜成 "[object Object]"。
      if (行.amount !== null && typeof 行.amount !== "string")
        throw new Error(`human 关系的金额不是字符串：${JSON.stringify(行.amount)}`)
      return {
        id: String(行.id),
        from代表: String(行.from_代表),
        to代表: String(行.to_代表),
        amount: 行.amount,
        firstAt: 行.first_at === null ? null : Number(行.first_at),
        trustState: String(行.trust_state),
      }
    })

    // ② 该 chunk 的资金事件（全币种；CNY 由匹配器自己过滤）：这里全取是为了
    //    「全外币对」也有事件可数，只是匹配不上。
    const 事件行 = rowsOf(
      await tx.execute(sql`
        select e.id, e.amount::text as amount, e.occurred_at, e.currency,
               付.entity_id as from_id, 收.entity_id as to_id
        ${资金参与者基(projectId)}
           and e.type = ${资金交易}
           and e.trust_state <> '已排除'
           and (付.entity_id, 收.entity_id) in (values ${值})
      `),
    )
    const 事件们: 事件候选[] = 事件行.map((行) => ({
      id: String(行.id),
      from代表: String(行.from_id),
      to代表: String(行.to_id),
      amount: String(行.amount),
      occurredAt: 行.occurred_at === null ? null : Number(行.occurred_at),
      currency: String(行.currency),
    }))
    const 覆盖 = [...匹配覆盖事件(关系们, 事件们)]

    // ③ 只删本函数自己那条确定性 id（`事实id(projectId, "转账", from, to)`），不能按
    // 「type + 信任态 + 对」整片删：`case-ingest.ts` 从笔录抽出的转账关系 source_kind='human'、
    // trust_state 也是 自动抽取/存疑，整片删会把它连出处一起误删。
    // `trust_state` 条件仍要留：人工把这条关系改成 `已确认` 时 id 不变，不能删。
    const 机器id们 = chunk.map((p) => 事实id(projectId, "转账", p.fromId, p.toId))
    await tx.execute(sql`
      delete from auth.case_relation
       where project_id = ${projectId}
         and id = any(${文本数组(机器id们)})
         and trust_state in ('自动抽取', '存疑')
    `)

    // ④ 聚合：排除被 human 覆盖的事件；times_cny 只数 CNY。
    const 聚合 = rowsOf(
      await tx.execute(sql`
        select 付.entity_id as from_id, 收.entity_id as to_id,
               count(*)::int as times,
               count(*) filter (where e.currency = 'CNY')::int as times_cny,
               coalesce(sum(e.amount) filter (where e.currency = 'CNY'), 0)::numeric(18,2)::text as amount,
               min(e.occurred_at) as first_at, max(e.occurred_at) as last_at,
               -- 精度取最粗；全为 NULL 时输出 NULL（M5：不升级为最细）。
               -- 到秒必须显式列出：把它并进 else 再改 null，会把「真的到秒」也一起抹掉。
               -- 同函数对金额判型失败选择抛错，这里的兜底也不许 fail-open。
               case when bool_or(e.precision = '到日') then '到日'
                    when bool_or(e.precision = '到分') then '到分'
                    when bool_or(e.precision = '到秒') then '到秒'
                    else null end as precision
        ${资金参与者基(projectId)}
           and e.type = ${资金交易}
           and e.trust_state <> '已排除'
           and (付.entity_id, 收.entity_id) in (values ${值})
           and e.id <> all(${文本数组(覆盖)})
         group by 1, 2
      `),
    )

    for (const 行 of 聚合) {
      const fromId = String(行.from_id)
      const toId = String(行.to_id)
      if (typeof 行.amount !== "string")
        throw new Error(`关系聚合的金额不是字符串（${fromId} → ${toId}）：${JSON.stringify(行.amount)}`)
      // 自环（合并后付款方与收款方是同一实体）：**行照样写、状态落「已排除」**。
      // 合并已经把自环标「已排除」（§9「不删除，只打状态」），重放若不守这条，会插回一行
      // 「自动抽取」自环 ⇒ 同一事实两行两态，`query_relations` 默认还把它当关系返回，
      // 而档案 / 探索走 XOR 得 0 条（缺口 #7）。落已排除后两端口径一致：默认读口都不返回，
      // 金额也不会被算重（`aggregate_money` 的 XOR 本就把自环挡在收支之外）。
      const 信任态 = fromId === toId ? "已排除" : "自动抽取"
      const 写入 = rowsOf(
        await tx.execute(sql`
          insert into auth.case_relation
            (id, project_id, from_id, to_id, type, first_at, last_at, precision, times, times_cny, amount,
             basis, source_kind, trust_state, created_at)
          values (${事实id(projectId, "转账", fromId, toId)}, ${projectId}, ${fromId}, ${toId}, '转账',
                  ${行.first_at ?? null}, ${行.last_at ?? null}, ${行.precision ?? null},
                  ${Number(行.times ?? 0)}, ${Number(行.times_cny ?? 0)}, ${行.amount}, null, 'data', ${信任态},
                  ${nowSeconds()})
          on conflict (project_id, id) do nothing
          returning id
        `),
      )
      // 按**实际插入行数**累计：`on conflict do nothing` 时 returning 为空，返回值不虚高。
      written += 写入.length
    }
  }
  return written
}

/**
 * 本材料贡献的 human 转账对，**按对齐后的账户对**返回。
 *
 * 为什么必须对齐：机器行 id 与聚合分组用的是账户对（A, B）；笔录写的可能是
 * （A, 人「李四」）。拿原始对去调 `重建关系`，删不到、也算不到真正受影响的机器行。
 */
export async function 本材料转账对(
  tx: Queryable,
  projectId: string,
  materialId: string,
): Promise<关系对[]> {
  return rowsOf(
    await tx.execute(sql`
      select distinct
             coalesce(起对齐.代表, r.from_id) as from_id,
             coalesce(终对齐.代表, r.to_id) as to_id
        from auth.case_relation r
        join auth.case_entity 起 on 起.project_id = r.project_id and 起.id = r.from_id
        join auth.case_entity 终 on 终.project_id = r.project_id and 终.id = r.to_id
        left join lateral ${户名对齐(projectId, sql`起.id`, sql`起.type`, sql`起.canonical_value`)} 起对齐 on true
        left join lateral ${户名对齐(projectId, sql`终.id`, sql`终.type`, sql`终.canonical_value`)} 终对齐 on true
       where r.project_id = ${projectId} and r.type = '转账' and r.source_kind = 'human'
         and r.id in (select fact_id from auth.case_citation
                       where project_id = ${projectId} and material_id = ${materialId}
                         and fact_type = 'relation')
    `),
  ).map((r) => ({ fromId: String(r.from_id), toId: String(r.to_id) }))
}

/**
 * 一条裁决事实影响的（对齐后）资金对。
 *
 * 裁决的端点不变（关系白名单只改 amount/basis/relationType，事件白名单只改
 * summary/occurredAt/precision），所以可以在裁决**之后**取。
 *
 * - relation：只认 human 转账；返回对齐后的账户对（与 `本材料转账对` 同一横向对齐）。
 * - event：只认 `资金交易`；返回每个（付款方 → 收款方）参与者对（事件端点本来就是账户）。
 */
export async function 事实资金对(
  tx: Queryable,
  projectId: string,
  factType: "relation" | "event",
  factId: string,
): Promise<关系对[]> {
  if (factType === "relation") {
    return rowsOf(
      await tx.execute(sql`
        select coalesce(起对齐.代表, r.from_id) as from_id,
               coalesce(终对齐.代表, r.to_id) as to_id
          from auth.case_relation r
          join auth.case_entity 起 on 起.project_id = r.project_id and 起.id = r.from_id
          join auth.case_entity 终 on 终.project_id = r.project_id and 终.id = r.to_id
          left join lateral ${户名对齐(projectId, sql`起.id`, sql`起.type`, sql`起.canonical_value`)} 起对齐 on true
          left join lateral ${户名对齐(projectId, sql`终.id`, sql`终.type`, sql`终.canonical_value`)} 终对齐 on true
         where r.project_id = ${projectId} and r.id = ${factId}
           and r.type = '转账' and r.source_kind = 'human'
      `),
    ).map((行) => ({ fromId: String(行.from_id), toId: String(行.to_id) }))
  }
  return rowsOf(
    await tx.execute(sql`
      select distinct 付.entity_id as from_id, 收.entity_id as to_id
        from auth.case_event e
        join auth.case_event_participant 付
          on 付.project_id = e.project_id and 付.event_id = e.id and 付.role = '付款方'
        join auth.case_event_participant 收
          on 收.project_id = e.project_id and 收.event_id = e.id and 收.role = '收款方'
       where e.project_id = ${projectId} and e.id = ${factId}
         and e.type = ${资金交易}
         and 付.entity_id is not null and 收.entity_id is not null
    `),
  ).map((行) => ({ fromId: String(行.from_id), toId: String(行.to_id) }))
}
