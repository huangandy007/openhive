export * as OpenhiveCaseAlerts from "./case-alerts"

import { Hash } from "@opencode-ai/core/util/hash"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { sql } from "drizzle-orm"
import type { Queryable } from "./case-store"

/**
 * 主动提醒（design §7.3）。
 *
 * ## 提醒只陈述数据事实，结论由人下
 *
 * 文案里不出现「可疑」「涉嫌」，只写「出 N 笔 A 元 / 入 M 笔 B 元」。
 *
 * ## 三条规则都是**全量比对**
 *
 * 每次 `生成提醒` 扫全项目，不是增量：本计划的触发时机是用户点「重新比对」＋ 抽完一批材料后
 * 由调用方触发；定时常驻留给后续计划。
 *
 * ## 幂等靠**确定性 id**
 *
 * `al-` ＋ `Hash.fast(projectId|ruleId|key)` ＋ `on conflict do nothing`：同一份数据重复比对
 * 不会堆出重复提醒，已读状态也不会被冲掉（`LEARNINGS #007-01`）。key 必须是**与方向 / 到达
 * 顺序无关的全序**（通话转账重合那一条把两端 id 排序后拼），否则同一件事会按关系的书写方向
 * 变成两条（`LEARNINGS #010-05`）。
 *
 * ## 已排除的东西不算
 *
 * 关系本身、关系两端实体、中心实体都要带 `trust_state <> '已排除'`。只挡一端的话，
 * 「已排除的关系」仍会参与笔数 / 合计（`#002-06`：同一条判据在每个用到它的地方都要在）。
 */

export interface 提醒行 {
  readonly id: string
  readonly rule_id: string
  readonly 标题: string
  readonly 内容: string
  readonly 事实: unknown
  readonly created_at: number
  readonly read_at: number | null
  readonly handled_at: number | null
}

export const 规则 = {
  资金对称: "资金对称",
  通话转账重合: "通话转账重合",
  号码多账户: "号码多账户",
} as const

/** 出 / 入合计的**相对**偏差上限（5%）。 */
export const 金额对称偏差 = 0.05
export const 对称最少笔数 = 2
export const 对称最少金额 = 5000
export const 通话转账最少金额 = 10000
export const 号码最少账户 = 3

interface 待写 {
  readonly rule_id: string
  readonly key: string
  readonly 标题: string
  readonly 内容: string
  readonly 事实: unknown
}

const 提醒ID = (projectId: string, 条: 待写) => `al-${Hash.fast(`${projectId}|${条.rule_id}|${条.key}`)}`

/** 规整金额显示：numeric 字符串原样（不转浮点），只在比值计算时用 `Number`。 */
const 金额 = (值: unknown) => (typeof 值 === "string" || typeof 值 === "number" ? String(值) : "0")

async function 资金对称(db: Queryable, projectId: string): Promise<待写[]> {
  const 行们 = rowsOf(
    await db.execute(sql`
      with 边 as (
        select r.from_id as 端, r.to_id as 对方, r.amount::numeric as 金额, '出' as 方向
          from auth.case_relation r
         where r.project_id = ${projectId} and r.type = '转账'
           and r.trust_state <> '已排除' and r.amount is not null
           and exists (select 1 from auth.case_entity e2
                        where e2.project_id = r.project_id and e2.id = r.to_id and e2.trust_state <> '已排除')
        union all
        select r.to_id, r.from_id, r.amount::numeric, '入'
          from auth.case_relation r
         where r.project_id = ${projectId} and r.type = '转账'
           and r.trust_state <> '已排除' and r.amount is not null
           and exists (select 1 from auth.case_entity e2
                        where e2.project_id = r.project_id and e2.id = r.from_id and e2.trust_state <> '已排除')
      )
      select 边.端 as id, 实体.canonical_value as 值, 实体.type as 类型,
             sum(case when 方向 = '出' then 金额 else 0 end)::text as 出计,
             count(*) filter (where 方向 = '出')::int as 出笔,
             sum(case when 方向 = '入' then 金额 else 0 end)::text as 入计,
             count(*) filter (where 方向 = '入')::int as 入笔
        from 边
        join auth.case_entity 实体
          on 实体.project_id = ${projectId} and 实体.id = 边.端 and 实体.trust_state <> '已排除'
       group by 边.端, 实体.canonical_value, 实体.type
      having count(*) filter (where 方向 = '出') >= ${对称最少笔数}
         and count(*) filter (where 方向 = '入') >= ${对称最少笔数}
    `),
  )
  return 行们.flatMap((行) => {
    const 出计 = Number(行.出计)
    const 入计 = Number(行.入计)
    if (出计 < 对称最少金额 || 入计 < 对称最少金额) return []
    if (Math.abs(出计 - 入计) / Math.max(出计, 入计) > 金额对称偏差) return []
    const 出笔 = Number(行.出笔)
    const 入笔 = Number(行.入笔)
    return [
      {
        rule_id: 规则.资金对称,
        key: String(行.id),
        标题: `${String(行.值)} 短期资金进出高度对称`,
        内容:
          `${String(行.类型)}「${String(行.值)}」共出 ${出笔} 笔 ${金额(行.出计)} 元、` +
          `入 ${入笔} 笔 ${金额(行.入计)} 元；两向合计相差不超过 ${Math.round(金额对称偏差 * 100)}%。`,
        事实: { 账户: 行.id, 值: 行.值, 类型: 行.类型, 出笔, 入笔, 出计: 行.出计, 入计: 行.入计 },
      },
    ]
  })
}

async function 通话转账重合(db: Queryable, projectId: string): Promise<待写[]> {
  // ⚠️ **按无序对聚合**：`group by a.from_id, a.to_id` 会把 A→B 与 B→A 拆成两组——
  // 反向各 6000（合计 12000）两组都过不了阈值，整条规则漏报；两个方向各自 ≥ 10000 时
  // 又会撞同一个 key，落库数字取决于无 ORDER BY 的行序。这里统一取 least/greatest。
  const 行们 = rowsOf(
    await db.execute(sql`
      select least(a.from_id, a.to_id) as 甲,
             greatest(a.from_id, a.to_id) as 乙,
             甲.canonical_value as 甲值, 乙.canonical_value as 乙值,
             sum(a.amount)::text as 转账合计, count(*)::int as 转账笔数
        from auth.case_relation a
        join auth.case_entity 甲
          on 甲.project_id = a.project_id and 甲.id = least(a.from_id, a.to_id)
         and 甲.trust_state <> '已排除'
        join auth.case_entity 乙
          on 乙.project_id = a.project_id and 乙.id = greatest(a.from_id, a.to_id)
         and 乙.trust_state <> '已排除'
       where a.project_id = ${projectId} and a.type = '转账' and a.trust_state <> '已排除'
         and exists (select 1 from auth.case_relation b
                      where b.project_id = a.project_id and b.type = '通话' and b.trust_state <> '已排除'
                        and least(b.from_id, b.to_id) = least(a.from_id, a.to_id)
                        and greatest(b.from_id, b.to_id) = greatest(a.from_id, a.to_id))
       group by least(a.from_id, a.to_id), greatest(a.from_id, a.to_id),
                甲.canonical_value, 乙.canonical_value
      having sum(a.amount) >= ${通话转账最少金额}
    `),
  )
  return 行们.map((行) => ({
    rule_id: 规则.通话转账重合,
    // 甲/乙 已经是 least/greatest 的无序对，key 直接拼即与方向无关（`LEARNINGS #010-05`）。
    key: `${String(行.甲)}|${String(行.乙)}`,
    标题: `${String(行.甲值)} 与 ${String(行.乙值)} 既有通话又有转账`,
    内容:
      `两人之间转账 ${Number(行.转账笔数)} 笔、合计 ${金额(行.转账合计)} 元，` +
      `同时存在通话记录。（口径：同一对实体；转账合计 ≥ ${通话转账最少金额} 元）`,
    事实: { 甲: 行.甲, 乙: 行.乙, 甲值: 行.甲值, 乙值: 行.乙值, 转账合计: 行.转账合计, 转账笔数: 行.转账笔数 },
  }))
}

async function 号码多账户(db: Queryable, projectId: string): Promise<待写[]> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select n.id as id, n.canonical_value as 值, count(distinct 账.id)::int as 账户数
        from auth.case_entity n
        join auth.case_relation r
          on r.project_id = n.project_id and (r.from_id = n.id or r.to_id = n.id)
         and r.trust_state <> '已排除'
        join auth.case_entity 账
          on 账.project_id = r.project_id
         and 账.id = case when r.from_id = n.id then r.to_id else r.from_id end
         and 账.type = '账户' and 账.trust_state <> '已排除'
       where n.project_id = ${projectId} and n.type = '号码' and n.trust_state <> '已排除'
       group by n.id, n.canonical_value
      having count(distinct 账.id) >= ${号码最少账户}
    `),
  )
  return 行们.map((行) => ({
    rule_id: 规则.号码多账户,
    key: String(行.id),
    标题: `号码 ${String(行.值)} 关联了 ${Number(行.账户数)} 个账户`,
    内容: `号码「${String(行.值)}」在项目里关联到 ${Number(行.账户数)} 个不同账户。`,
    事实: { 号码: 行.id, 值: 行.值, 账户数: 行.账户数 },
  }))
}

export async function 生成提醒(db: Queryable, projectId: string): Promise<{ 新建: number; 提醒: 提醒行[] }> {
  const 待写们 = [
    ...(await 资金对称(db, projectId)),
    ...(await 通话转账重合(db, projectId)),
    ...(await 号码多账户(db, projectId)),
  ]
  const 现在 = nowSeconds()
  let 新建 = 0
  for (const 条 of 待写们) {
    // `fact_refs` 没有别的读者（全仓只有建表语句）：表上没有标题 / 内容列，所以把展示所需的
    // 三项一起放进 jsonb。**这不是 schema 错误**，别下次顺手改成「只存 id 再 join」——
    // 那样要再加一张表或改 DDL，而这个字段今天只服务本文件写、本文件读。
    const 插入 = rowsOf(
      await db.execute(sql`
        insert into auth.case_alert (id, project_id, rule_id, fact_refs, created_at)
        values (
          ${提醒ID(projectId, 条)}, ${projectId}, ${条.rule_id},
          ${JSON.stringify({ 标题: 条.标题, 内容: 条.内容, 事实: 条.事实 })}::text::jsonb,
          ${现在}
        )
        on conflict (project_id, id) do nothing
        returning id
      `),
    )
    新建 += 插入.length
  }
  return { 新建, 提醒: await 提醒清单(db, projectId) }
}

const 解JSON = <T>(值: unknown, 缺省: T): T => {
  if (值 !== null && typeof 值 === "object") return 值 as T
  if (typeof 值 !== "string") return 缺省
  try {
    return JSON.parse(值) as T
  } catch {
    return 缺省
  }
}

export async function 提醒清单(db: Queryable, projectId: string): Promise<提醒行[]> {
  return rowsOf(
    await db.execute(sql`
      select id, rule_id, fact_refs::text as fact_refs, created_at, read_at, handled_at
        from auth.case_alert
       where project_id = ${projectId}
       order by created_at desc, id asc
    `),
  ).map((行) => {
    const 体 = 解JSON<{ 标题?: string; 内容?: string; 事实?: unknown }>(行.fact_refs, {})
    return {
      id: String(行.id),
      rule_id: String(行.rule_id),
      标题: 体.标题 ?? String(行.rule_id),
      内容: 体.内容 ?? "",
      事实: 体.事实 ?? null,
      created_at: Number(行.created_at),
      read_at: 行.read_at === null ? null : Number(行.read_at),
      handled_at: 行.handled_at === null ? null : Number(行.handled_at),
    }
  })
}

/**
 * 把给定的 id 标为已读，返回**实际改了行数**。
 *
 * ⚠️ **不截断**：brief 的 `.slice(0, 200)` 会静默丢掉排在第 200 之后的 id——与「截断冒充总数」
 * 同一类缺陷。要设上限就在出口回 400，不在这里悄悄少改。空数组 / 非法项直接忽略（调用方
 * 已按 `string[]` 校验过；这里只做防御，不把它变成一次「改了 0 行」的假成功）。
 */
export async function 标记已读(db: Queryable, projectId: string, ids: readonly string[]): Promise<number> {
  const 有效 = ids.filter((id) => typeof id === "string" && id !== "")
  if (有效.length === 0) return 0
  const 行们 = rowsOf(
    await db.execute(sql`
      update auth.case_alert
         set read_at = ${nowSeconds()}
       where project_id = ${projectId} and read_at is null
         and id in (${sql.join(
           有效.map((id) => sql`${id}`),
           sql`, `,
         )})
      returning id
    `),
  )
  return 行们.length
}
