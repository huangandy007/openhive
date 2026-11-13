export * as OpenhiveCaseGraph from "./case-graph"

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { Queryable } from "./case-store"
import { 细类 } from "./case-subtype"
import { 关系归属条件, 账户归属集 } from "./case-party"

/**
 * 关系图数据（计划 7 Task 3）。
 *
 * ## 口径
 *
 * - §8.3：图**只画选中实体 1～2 跳**，节点上限约 50 —— 图是「看邻域」的视图，
 *   不是全项目拓扑；超出部分进 `缺口`，让人知道「还有没画出来的」，而不是静默丢。
 * - §9.1：已排除的**实体、关系、端点**都不画。关系两端实体都要可见：`取一圈` 里
 *   两条 `join` 各自带 `trust_state <> '已排除'`，**悬空端点的边因此根本查不出来**。
 * - 跳数用**两轮 SQL 在 TS 里 BFS**，不写递归 CTE：两轮能逐轮限行（第一轮按上限取边，
 *   第二轮只取「剩余名额」条），递归 CTE 要在 SQL 里截断反而更难读。
 * - **截断不许静默**：每轮 `limit 剩余 + 1` 多取一条，并用 `count(*) over()` 拿本跳的全部
 *   条数；装不下的写进 `缺口`。第 1 跳说「画了多少节点 / 共有多少关系」，第 2 跳只说
 *   「还有多少候选关系没画」（`slice` 行数里可能混着已画过的回边，不能说成「画了」）。
 *   只把 `剩余` 当 `limit` 的话，多出来的行会被 SQL 悄悄吃掉——第 2 跳的容量判据在数据层恒假。
 *   `剩余 === 0`（上限 1）也要查一次：否则连库都不碰，空图会被读成「没有任何关联」。
 *
 * ## 项目隔离
 *
 * 与 `case-store` 同约定：项目隔离靠应用层，**所有 SQL 显式带 `project_id = ?`**，
 * 跨表 join 两侧都带 —— 漏带 `to` 侧就会把「关系在本项目、对端实体在别的项目」的
 * 边画成悬空边。
 */

export interface 图节点 {
  readonly id: string
  readonly type: string
  /** 大类之下的细类（「号码 · 手机号」的后者）；判不出就没有——界面只显示大类。 */
  readonly subtype?: string
  readonly value: string
  readonly trust_state: string
  readonly 中心: boolean
  /** 0 = 中心实体，1 / 2 = 第几跳。 */
  readonly 跳数: number
  /** 该节点在本图里连出的边数（只算图里画出来的）。 */
  readonly 关联数: number
  /** 库里与该实体相关、未被排除的关系总数——判枢纽用；不是图上画出来的条数。 */
  readonly 度数: number
  /** 二跳节点是从哪个一跳节点过来的——分簇用；一跳与中心没有。 */
  readonly 经由?: string
}

export const 关系图强度们 = ["全部", "重点", "强"] as const
export type 关系图强度 = (typeof 关系图强度们)[number]

/** 保留条件 = 次数达标 **或** 金额达标（spec §4.1.3）。`金额: null` = 本档不看金额。 */
const 强度阈值: Record<关系图强度, { readonly 次数: number; readonly 金额: string | null }> = {
  全部: { 次数: 0, 金额: null },
  重点: { 次数: 2, 金额: "1000" },
  强: { 次数: 5, 金额: "10000" },
}

export interface 图边 {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly type: string
  /** 合并了几条关系记录的次数之和（每条没写次数按 1 计）——恒 ≥ 1。 */
  readonly times: number
  readonly amount: string | null
  readonly trust_state: string
  /** 合并了多少条原始关系（≥ 1）。 */
  readonly 明细数: number
}

export interface 关系图结果 {
  readonly 节点: 图节点[]
  readonly 边: 图边[]
  readonly 缺口: string[]
  /** 被强度档筛掉、但**在本次取数范围里确实存在**的关系组数；为 0 时不出现。 */
  readonly 强度缺口?: { readonly 未显示: number; readonly 总数: number }
}

export interface 关系图入参 {
  readonly projectId: string
  readonly id: string
  /** 省略 = 1。 */
  readonly 跳数?: 1 | 2
  /** 省略 = 全部类型。 */
  readonly 类型?: readonly string[]
  /** 省略 = `默认节点上限`。 */
  readonly 上限?: number
  /** 省略 = "全部"。 */
  readonly 强度?: 关系图强度
}

export const 默认节点上限 = 50

/** 入参是只读的，组装过程中要回填跳数与关联数；对外仍是只读视图。 */
type 可写节点 = { -readonly [K in keyof 图节点]: 图节点[K] }

interface 边行 {
  readonly id: string
  readonly from_id: string
  readonly to_id: string
  readonly type: string
  readonly times: number
  readonly amount: string | null
  readonly trust_state: string
  readonly 明细数: number
  /** 这一组里「经户名对齐」的原始关系条数（投影路径才非 0）。 */
  readonly 经对齐数: number
  readonly from_value: string
  readonly from_type: string
  readonly from_trust: string
  readonly from_attrs: unknown
  readonly to_value: string
  readonly to_type: string
  readonly to_trust: string
  readonly to_attrs: unknown
}

interface 聚合入参 {
  readonly projectId: string
  readonly 节点们: readonly string[]
  readonly 类型?: readonly string[]
  readonly 强度: 关系图强度
  /**
   * 中心是账户时的端点投影：落在集合里的端点归并到 `中心`。
   *
   * - 选中固定含 XOR（`归属`）：第 1 跳靠它把对齐边纳入；`计强度` 也靠它覆盖整圈。
   * - `跳过中心端点边`：**归一化之后**再排掉带中心端点的边。第 2 跳开——
   *   中心端点边就是第 1 跳关系（原始端点是否中心都一样：XOR 边归一化后必以中心
   *   为端点），不在第 2 跳补画；第 1 跳与 `计强度` 不开。
   */
  readonly 投影?: {
    readonly 中心: string
    readonly 归属集: SQL
    readonly 跳过中心端点边?: boolean
  }
}

/**
 * 一组端点一条边：`(from_id, to_id, type)` 相同的关系先合成一行**再**去抢名额。
 * 不聚合的话，几百条流水只带出 1 个新节点，别的关系全被挤出上限（spec §4.1.2）。
 */
function 聚合边(input: 聚合入参): SQL {
  const 节点表 = sql.join(
    input.节点们.map((id) => sql`${id}`),
    sql`, `,
  )
  const 类型条件 =
    input.类型 === undefined || input.类型.length === 0
      ? sql``
      : sql`and r.type in (${sql.join(
          input.类型.map((条) => sql`${条}`),
          sql`, `,
        )})`
  const 阈 = 强度阈值[input.强度]
  const 金额阈 = 阈.金额 === null ? sql`null::numeric` : sql`${阈.金额}::numeric`
  const 投影 = input.投影
  // 默认路径：原始端点口径（行为与引入投影前一致；聚合 SQL 形状变了，语义没变）。
  let 选中: SQL = sql`(r.from_id in (${节点表}) or r.to_id in (${节点表}))`
  let 起: SQL = sql`r.from_id`
  let 终: SQL = sql`r.to_id`
  let 经对齐行: SQL = sql`false`
  let 归一化后过滤: SQL = sql``
  if (投影 !== undefined) {
    // 归属判据只在 `case-party` 一份（`#002-06`）：XOR 与「恰好一端在集合」共用同一个函数；
    // `投影.归属集` 只留给起/终的端点归一化。
    const 归属 = 关系归属条件(input.projectId, [投影.中心], sql`r.from_id`, sql`r.to_id`)
    // 选中固定含 XOR：第 1 跳靠它纳入对齐边；第 2 跳靠归一化后的过滤再排掉中心端点，
    // 不需要单独的 XOR 开关（XOR 边归一化后必以中心为端点）。
    选中 = sql`(r.from_id in (${节点表}) or r.to_id in (${节点表}) or ${归属})`
    起 = sql`case when r.from_id in ${投影.归属集} then ${投影.中心} else r.from_id end`
    终 = sql`case when r.to_id in ${投影.归属集} then ${投影.中心} else r.to_id end`
    // 「经户名对齐」的原始关系行：恰好一端在归属集，且两端都不是中心。
    // 这一列与边同一层聚合 ⇒ 第 1 跳的类型条件、强度达标、上限截断都自动同口径。
    // `强度缺口` 走 `计强度`（原样透传投影、不跳中心端点边），所以两边都覆盖第 1 跳组。
    经对齐行 = sql`(${归属} and r.from_id <> ${投影.中心} and r.to_id <> ${投影.中心})`
    // 归一化**之后**的过滤（同时管自环与可选的中心端点）：
    // - 自环：原始口径里自环是合法边，默认路径必须原样保留；只有投影路径要排掉
    //   「两端都在归属集」压成的 `中心 → 中心`——它没有对手方、也不产生方向。
    // - 中心端点：`跳过中心端点边` 为真时，任何归一化后带中心端点的边都排掉。
    //   这既涵盖原始端点就是中心的关系，也涵盖 XOR 边（归一化后必以中心为端点）。
    归一化后过滤 =
      投影.跳过中心端点边 === true
        ? sql`where r.from_id <> r.to_id and r.from_id <> ${投影.中心} and r.to_id <> ${投影.中心}`
        : sql`where r.from_id <> r.to_id`
  }
  return sql`
    select g.from_id, g.to_id, g.type, g.次数, g.金额数, g.金额合计, g.明细数, g.经对齐数, g.信任态,
           coalesce(g.次数 >= ${阈.次数} or (${金额阈} is not null and g.金额数 >= ${金额阈}), false) as 达标
      from (
        select r.from_id, r.to_id, r.type,
               sum(coalesce(r.times, 1))::int as 次数,
               sum(r.amount) as 金额数,
               sum(r.amount)::text as 金额合计,
               count(*)::int as 明细数,
               (count(*) filter (where r.经对齐))::int as 经对齐数,
               case when min(r.trust_state) = max(r.trust_state) then min(r.trust_state) else '混合' end as 信任态
          from (
            select ${起} as from_id, ${终} as to_id, r.type, r.times, r.amount, r.trust_state,
                   ${经对齐行} as 经对齐
              from auth.case_relation r
              join auth.case_entity 起点 on 起点.project_id = r.project_id and 起点.id = r.from_id
              join auth.case_entity 终点 on 终点.project_id = r.project_id and 终点.id = r.to_id
             where r.project_id = ${input.projectId}
               and r.trust_state <> '已排除'
               and 起点.trust_state <> '已排除' and 终点.trust_state <> '已排除'
               and ${选中}
               ${类型条件}
          ) r
         ${归一化后过滤}
         group by r.from_id, r.to_id, r.type
      ) g
  `
}

interface 一圈 {
  readonly 边们: 边行[]
  /** 本跳**达标**的全部组数（`count(*) over()`，不受 `limit` 影响）。 */
  readonly 总数: number
}

/** 取「与这批节点相邻」的一圈边。`剩余` 是本轮最多画几条。 */
async function 取一圈(
  db: Queryable,
  input: {
    readonly projectId: string
    readonly 节点们: readonly string[]
    readonly 类型?: readonly string[]
    readonly 剩余: number
    readonly 强度: 关系图强度
    readonly 投影?: 聚合入参["投影"]
  },
): Promise<一圈> {
  // `剩余 === 0` 也照样查一次（`limit 1`）：只查「还有没有」，不画。否则 `上限 = 1`
  // 时连库都不碰，返回「只有中心、无缺口」，界面会读成「这个人没有任何关联」。
  if (input.节点们.length === 0) return { 边们: [], 总数: 0 }
  const 行们 = rowsOf(
    await db.execute(sql`
      select h.from_id, h.to_id, h.type, h.次数, h.金额合计 as amount, h.信任态 as trust_state, h.明细数,
             h.经对齐数,
             起.canonical_value as from_value, 起.type as from_type, 起.trust_state as from_trust,
             起.attrs as from_attrs,
             终.canonical_value as to_value, 终.type as to_type, 终.trust_state as to_trust,
             终.attrs as to_attrs,
             (count(*) over())::int as 总数
        from (${聚合边(input)}) h
        join auth.case_entity 起 on 起.project_id = ${input.projectId} and 起.id = h.from_id
        join auth.case_entity 终 on 终.project_id = ${input.projectId} and 终.id = h.to_id
       where h.达标
       order by h.次数 desc, h.金额数 desc nulls last, h.明细数 desc,
                h.from_id collate "C" asc, h.to_id collate "C" asc, h.type collate "C" asc
       limit ${input.剩余 + 1}
    `),
  )
  return {
    边们: 行们.map((行) => ({
      id: `rel|${行.from_id}|${行.to_id}|${行.type}`,
      from_id: String(行.from_id),
      to_id: String(行.to_id),
      type: String(行.type),
      times: Number(行.次数),
      amount: (行.amount as string | null) ?? null,
      trust_state: String(行.trust_state),
      明细数: Number(行.明细数),
      经对齐数: Number(行.经对齐数),
      from_value: String(行.from_value),
      from_type: String(行.from_type),
      from_trust: String(行.from_trust),
      from_attrs: 行.from_attrs,
      to_value: String(行.to_value),
      to_type: String(行.to_type),
      to_trust: String(行.to_trust),
      to_attrs: 行.to_attrs,
    })),
    总数: 行们.length === 0 ? 0 : Number(行们[0].总数),
  }
}

async function 取度数(
  db: Queryable,
  input: { readonly projectId: string; readonly 节点们: readonly string[] },
): Promise<Map<string, number>> {
  if (input.节点们.length === 0) return new Map()
  const 节点表 = sql.join(
    input.节点们.map((id) => sql`${id}`),
    sql`, `,
  )
  const 行们 = rowsOf(
    await db.execute(sql`
      select 端.id, count(*)::int as 度数
        from (
          select r.from_id as id
            from auth.case_relation r
            join auth.case_entity 对 on 对.project_id = r.project_id and 对.id = r.to_id
           where r.project_id = ${input.projectId}
             and r.trust_state <> '已排除'
             and 对.trust_state <> '已排除'
             and r.from_id in (${节点表})
          union all
          select r.to_id as id
            from auth.case_relation r
            join auth.case_entity 对 on 对.project_id = r.project_id and 对.id = r.from_id
           where r.project_id = ${input.projectId}
             and r.trust_state <> '已排除'
             and 对.trust_state <> '已排除'
             and r.to_id in (${节点表})
             and r.from_id <> r.to_id
        ) 端
       group by 端.id
    `),
  )
  return new Map(行们.map((行) => [String(行.id), Number(行.度数)]))
}

/**
 * 范围里**全部**组数 vs **达标**组数（不受 `limit` 影响，永远回一行）。给 `强度缺口` 用。
 * 为什么不像 spec §4.1.6 那样把两个窗口塞进取一圈：那条 SQL 带 `where h.达标`，
 * 一旦一条都不达标，窗口值随行一起被筛掉，`全部组数` 就再也拿不到；
 * 聚合函数不带 group by 时恒回一行，才稳。
 */
async function 计强度(
  db: Queryable,
  input: 聚合入参,
): Promise<{ readonly 全部: number; readonly 达标: number }> {
  if (input.节点们.length === 0) return { 全部: 0, 达标: 0 }
  const 行 = rowsOf(
    await db.execute(sql`
      select (count(*))::int as 全部, (count(*) filter (where h.达标))::int as 达标
        from (${聚合边(input)}) h
    `),
  )[0]
  return { 全部: Number(行.全部), 达标: Number(行.达标) }
}

/**
 * 以 `id` 为中心取 1～2 跳的关系图。
 *
 * 中心实体不存在 / 已排除 / 不属于本项目时返回 `undefined`（让路由回 404，而不是
 * 回一张空的图——空图会被界面读成「这人没有关联」，与「查不到这人」是两回事）。
 */
export async function 关系图(db: Queryable, input: 关系图入参): Promise<关系图结果 | undefined> {
  const 上限 = Math.min(Math.max(1, Math.trunc(input.上限 ?? 默认节点上限)), 默认节点上限)
  const 跳数 = input.跳数 ?? 1
  const 强度 = input.强度 ?? "全部"

  const 中心行们 = rowsOf(
    await db.execute(sql`
      select id, type, canonical_value, attrs, trust_state
        from auth.case_entity
       where project_id = ${input.projectId} and id = ${input.id} and trust_state <> '已排除'
    `),
  )
  if (中心行们.length === 0) return undefined
  const 中心 = 中心行们[0]

  // 中心是账户时，把「唯一户名对齐到它的人/组织」的端点投影到中心（D-2：只影响画哪些边）。
  const 是账户 = String(中心.type) === "账户"
  const 归属集 = 是账户 ? 账户归属集(input.projectId, [String(中心.id)]) : undefined
  const 投影 =
    归属集 === undefined ? undefined : { 中心: String(中心.id), 归属集: 归属集 }

  const 节点表 = new Map<string, 可写节点>()
  const 边表 = new Map<string, 图边>()
  const 缺口: string[] = []

  const 加点 = (点: 可写节点) => {
    if (节点表.has(点.id)) return
    节点表.set(点.id, 点)
  }
  加点({
    id: String(中心.id),
    type: String(中心.type),
    subtype: 细类(String(中心.type), String(中心.canonical_value), 中心.attrs),
    value: String(中心.canonical_value),
    trust_state: String(中心.trust_state),
    中心: true,
    跳数: 0,
    关联数: 0,
    度数: 0,
  })

  /**
   * 把一圈边收进图里；返回这一圈里**新出现的对方节点 id**（供下一跳用）。
   *
   * 容量由**调用点**保证：每圈只 `slice` 到剩余名额条，而每条边必有一端已在图里
   * （`节点们` 都来自图内）、最多带 1 个新节点，所以节点数不会越过上限。这里不再留
   * 兜底的截断分支——它在本轮改动后不可达，留着只会多出一种近似文案；真被截断的条数
   * 由调用点用 `count(*) over()` 的 `总数` 写进缺口。
   */
  const 收一圈 = (边们: readonly 边行[], 父们?: ReadonlySet<string>): string[] => {
    const 新点: string[] = []
    for (const 边 of 边们) {
      if (边表.has(边.id)) continue
      边表.set(边.id, {
        id: 边.id,
        from: 边.from_id,
        to: 边.to_id,
        type: 边.type,
        times: 边.times,
        amount: 边.amount,
        trust_state: 边.trust_state,
        明细数: 边.明细数,
      })
      for (const [id, 值, 类型, 信任态, 属性, 另一端] of [
        [边.from_id, 边.from_value, 边.from_type, 边.from_trust, 边.from_attrs, 边.to_id] as const,
        [边.to_id, 边.to_value, 边.to_type, 边.to_trust, 边.to_attrs, 边.from_id] as const,
      ]) {
        if (节点表.has(id)) continue
        加点({
          id,
          type: 类型,
          subtype: 细类(类型, 值, 属性),
          value: 值,
          trust_state: 信任态,
          中心: false,
          跳数: 1,
          关联数: 0,
          度数: 0,
          ...(父们?.has(另一端) === true ? { 经由: 另一端 } : {}),
        })
        新点.push(id)
      }
    }
    return 新点
  }

  // 第 1 跳最多画 `可用` 条边：中心已占 1 个名额，而每条边最多带 1 个新节点。
  // 查询多取 1 条、并带 `count(*) over()`，用来判断「真被截断」还是「恰好画完」。
  const 可用 = 上限 - 1
  const 第一圈 = await 取一圈(db, {
    projectId: input.projectId,
    节点们: [String(中心.id)],
    类型: input.类型,
    剩余: 可用,
    强度,
    ...(投影 === undefined ? {} : { 投影 }),
  })
  const 画出的第一圈 = 第一圈.边们.slice(0, 可用)
  const 一跳点 = 收一圈(画出的第一圈)
  const 第一跳截断 = 第一圈.总数 > 可用
  if (可用 === 0) {
    // 一个邻居都放不下（上限 1）：只要库里还有边，就必须说出来，不能返回一张「干净的」空图。
    if (第一圈.总数 > 0) 缺口.push(`节点已达上限 ${上限}，第 1 跳的关联关系未画`)
  } else if (第一跳截断) {
    缺口.push(`第 1 跳只画了前 ${节点表.size} 个节点，该跳共 ${第一圈.总数} 条符合当前强度的关联关系`)
  }

  if (跳数 === 2) {
    const 剩余 = 上限 - 节点表.size
    if (剩余 <= 0) {
      // 第 1 跳真被截断时上面那句已经说清「还有没画的」，不再补一句近似的；
      // 恰好装满（库里也没有更多）才说「未展开」——我们确实没展开。
      if (!第一跳截断) 缺口.push(`节点已达上限 ${上限}，未展开第 2 跳`)
    } else {
      // 第 2 跳：跳过归一化后带中心端点的边——它们就是第 1 跳关系（XOR 边归一化后也
      // 必以中心为端点），不能在第 2 跳补画，否则同一关系换跳数又冒出来、占名额、标错跳数。
      const 第二圈 = await 取一圈(db, {
        projectId: input.projectId,
        节点们: 一跳点,
        类型: input.类型,
        剩余,
        强度,
        ...(投影 === undefined ? {} : { 投影: { ...投影, 跳过中心端点边: true } }),
      })
      收一圈(第二圈.边们.slice(0, 剩余), new Set(一跳点))
      // 不声称「画了多少」：`slice` 行数里可能混着第 1 跳已画过的回边（`收一圈` 会跳过）。
      // 只陈述「候选里还有多少没画」——M 是 pre-LIMIT 的候选总数减「剩余」名额。
      // 注意 `第二圈.总数` 是上界：它按组计数，已画过的边、以及再次归一化到同一组的
      // 不同来源都会占一个名额，故「还有 N 条」只多不少。
      if (第二圈.总数 > 剩余) 缺口.push(`第 2 跳还有 ${第二圈.总数 - 剩余} 条候选关系没有画（节点上限 ${上限}）`)
    }
  }

  // 经对齐条数直接取**画出来的第 1 跳边**的贡献（`聚合边` 的 `经对齐数`）：
  // 类型条件、强度达标、上限截断都已在那份 SQL 里生效，不会宣称图上没有的归并。
  const 经对齐数 = 画出的第一圈.reduce((和, 边) => 和 + 边.经对齐数, 0)
  if (投影 !== undefined && 经对齐数 > 0)
    缺口.push(`${经对齐数} 条关系经户名对齐归属本账户（图上的端点已归并到本账户）`)

  // 强度缺口只在**本次取数范围**内统计：跳数 1 只看中心；跳数 2 看中心＋已画出的全部一跳点。
  // 不能拿每轮的数字相加——中心↔一跳点那批组会在两轮里各出现一次，相加会翻倍。
  let 强度缺口: { 未显示: number; 总数: number } | undefined
  if (强度 !== "全部") {
    const 计数 = await 计强度(db, {
      projectId: input.projectId,
      节点们: 跳数 === 2 ? [String(中心.id), ...一跳点] : [String(中心.id)],
      类型: input.类型,
      强度,
      // 原样透传：计强度 量的是「中心＋一跳点」整张图，中心端点组正是其中的第 1 跳部分，
      // 不能跟着第 2 跳跳过（否则 `强度缺口` 会漏掉中心↔一跳点的未达标组）。
      ...(投影 === undefined ? {} : { 投影 }),
    })
    if (计数.全部 > 计数.达标) 强度缺口 = { 未显示: 计数.全部 - 计数.达标, 总数: 计数.全部 }
  }

  // 跳数按**实际画出来的最短距离**回填：第二圈里连到中心节点的边不该把中心改成 1 跳。
  const 邻居 = new Set(一跳点)
  for (const 点 of 节点表.values()) {
    if (点.中心) continue
    点.跳数 = 邻居.has(点.id) ? 1 : 2
  }
  // 度数只对图上这些节点查一轮（≤50），不能让 `关联数` 兼任枢纽判据（spec §4.1.4）。
  const 度数表 = await 取度数(db, { projectId: input.projectId, 节点们: [...节点表.keys()] })
  for (const 点 of 节点表.values()) 点.度数 = 度数表.get(点.id) ?? 0
  // 关联数按**图里画出来的边**数（不是库里的总数）——它要解释「屏幕上这几条」。
  // ⚠️ 账户中心的端点投影会改变它（投影进来的边也算一条）；`度数` 才是原始端点口径。
  // `new Set`：自环（from = to）是一条边，不能给同一个节点加两次。
  for (const 边 of 边表.values()) {
    for (const id of new Set([边.from, 边.to])) {
      const 点 = 节点表.get(id)
      if (点) 点.关联数 += 1
    }
  }

  return { 节点: [...节点表.values()], 边: [...边表.values()], 缺口, ...(强度缺口 === undefined ? {} : { 强度缺口 }) }
}
