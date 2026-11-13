import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { Queryable } from "./case-store"
import { 事件归属条件, 账户归属集, 关系归属条件 } from "./case-party"
import { 引用们, type 引用视图 } from "./case-fact-read"
import { 细类 } from "./case-subtype"

/**
 * 实体视图（计划 7 的左栏与中栏）：分组计数、清单、档案三个只读出口。
 *
 * ## 已排除一律默认不出现（§9.1 / R10）
 *
 * 三个出口共用一条口径：`trust_state = '已排除'` 的实体 / 关系 / 事件默认不返回。
 * 档案页是唯一能「切换查看」的地方，且只由 `includeExcluded` 显式开启。
 *
 * ## 数组列一律以 JSON 文本出库
 *
 * `text[]` 在两个驱动上的读回形状没有先例可依（同 `case-fact-read.ts` 文件头）：
 * SQL 侧写 `array_to_json(...)::text`，出库形状就与驱动无关。
 */

export type 实体分组 = "核心" | "提及"

export interface 分组计数 {
  readonly 核心: number
  readonly 提及: number
}

export type 排序 = "涉案" | "名称" | "时间"

export interface 实体清单项 {
  readonly id: string
  readonly type: string
  /** 大类之下的细类（「号码 · 手机号」的后者）；判不出就没有——界面只显示大类。 */
  readonly subtype?: string
  readonly canonical_value: string
  readonly trust_state: string
  /** 有效关系条数（关系未排除、对方未排除）。 */
  readonly 关联数: number
  /** 事件参与数（事件未排除、`participants` 含该实体规范值）。 */
  readonly 事件参与数: number
  /** 排序权重：`关联数 + 事件参与数`。 */
  readonly 权重: number
  readonly 分组: 实体分组
  readonly created_at: number
}

export interface 实体清单结果 {
  readonly 行们: 实体清单项[]
  /** 过滤后的全量条数（`count(*) over()`），不是当前页条数。 */
  readonly 总数: number
  readonly 缺口: string[]
}

export interface 实体清单入参 {
  readonly projectId: string
  /** 省略 = 跨组（搜索用）；给了就只查这一组。 */
  readonly 分组?: 实体分组
  readonly q?: string
  readonly sort?: 排序
  readonly limit?: number
}

export const 清单上限 = 200

/**
 * 关系分两段各留各的上限：数据说的 200、人说的 100。
 *
 * 一个共同的上限会让人说的整段消失：笔录关系里**没有时间原文的那些**（`持有`、`实名登记`
 * 等）`first_at` / `last_at` 仍是 NULL（`case-ingest.ts` 的写口如实照录，只有转账/通话
 * 这类原文写了时间的关系才落到具体时刻），排序键 `coalesce(last_at, first_at, 0)` 把它们
 * 全部排到 0 之后 ⇒ 只要数据关系够 200 条，人说的就一条都不剩。而「人说的」恰恰是
 * 民警从笔录里亲自认下来的关系，比机器抽的转账更需要被看见。
 */
const 关系数据上限 = 200
const 关系人上限 = 100
const 事件上限 = 100
/**
 * 出处的硬顶（2026-11-07）：一个号码能在几百份材料里出现，原先没有上限 ⇒ 档案页一次画几百行。
 * 前端另有更低的「默认只画 50 条 ＋ 展开」，这里是**服务端的兜底**，防止病态数据把回包撑爆。
 */
export const 引用上限 = 500

/**
 * 有效关系度数：清单的 `关联数` 与分组计数共用这一份谓词（`#002-06`）。
 * 只有一层 SQL 片段函数、没有第二个实现；改口径只改这里。
 */
const 关系度数 = () =>
  sql`(
    select count(*)::int
      from auth.case_relation r
     where r.project_id = e.project_id
       and r.trust_state <> '已排除'
       and (r.from_id = e.id or r.to_id = e.id)
       and (case when r.from_id = e.id then r.to_id else r.from_id end)
           in (select id from auth.case_entity
                where project_id = e.project_id and trust_state <> '已排除')
  )`

/** 事件参与数：事件未排除、参与者按规范值等值匹配。与分组计数共用。 */
const 事件参与数 = () =>
  sql`(
    select count(*)::int
      from auth.case_event ev
     where ev.project_id = e.project_id
       and ev.trust_state <> '已排除'
       and ev.participants @> array[e.canonical_value]::text[]
  )`

/** 人确认过的状态：核心判据与「同权重已确认优先」共用，避免两处字面各写一遍。 */
const 已确认或修正 = () => sql`trust_state in ('已确认','已修正')`

/**
 * 核心判据：有连接（有效关系或事件参与）或人已确认。**整个 feature 的准入判据只此一份**（`#002-06`）：
 * 分组计数的核心列、提及列（`not`）、清单分类都引用它；改条件只改这里。
 *
 * 引用派生表列名（`关联数` / `事件参与数` / `trust_state`）⇒ 调用处必须先把两个计数列投影出来。
 */
const 核心判据 = () => sql`(关联数 > 0 or 事件参与数 > 0 or ${已确认或修正()})`

export async function 分组计数(db: Queryable, projectId: string): Promise<分组计数> {
  const 行 = rowsOf(
    await db.execute(sql`
      select count(*) filter (
               where ${核心判据()}
             )::int as 核心,
             count(*) filter (
               where not ${核心判据()}
             )::int as 提及
        from (
          select e.trust_state,
                 ${关系度数()} as 关联数,
                 ${事件参与数()} as 事件参与数
            from auth.case_entity e
           where e.project_id = ${projectId} and e.trust_state <> '已排除'
        ) t
    `),
  )[0]!
  return { 核心: Number(行.核心), 提及: Number(行.提及) }
}

export async function 实体清单(db: Queryable, input: 实体清单入参): Promise<实体清单结果> {
  const 上限 = Math.min(Math.max(1, Math.trunc(input.limit ?? 清单上限)), 清单上限)
  const 条件: SQL[] = [sql`e.project_id = ${input.projectId}`, sql`e.trust_state <> '已排除'`]
  const 词 = input.q?.trim()
  if (词 !== undefined && 词 !== "") {
    // `q` 是用户输入：`%` / `_` / `\` 不转义就会当通配符（搜「100%」不该命中一切）。
    const 模式 = `%${转义模糊(词)}%`
    条件.push(
      sql`(e.canonical_value ilike ${模式} escape '\\'
           or exists (select 1 from unnest(e.aliases) as 别名 where 别名 ilike ${模式} escape '\\'))`,
    )
  }
  const 排序 = input.sort ?? "涉案"
  // 分组 / 权重是在派生表里算的，排序必须引用外层别名 `行`。
  const 顺序 =
    排序 === "名称"
      ? sql`行.canonical_value asc, 行.id asc`
      : 排序 === "时间"
        ? sql`行.created_at desc, 行.id asc`
        : sql`行.权重 desc, (${已确认或修正()}) desc, 行.canonical_value asc, 行.id asc`
  const 分组条件 = input.分组 === undefined ? sql`true` : sql`行.分组 = ${input.分组}`

  const 行们 = rowsOf(
    await db.execute(sql`
      select 行.id, 行.type, 行.canonical_value, 行.attrs, 行.trust_state, 行.created_at,
             行.关联数, 行.事件参与数, 行.权重, 行.分组,
             count(*) over() as 总数
        from (
          select t.*,
                 (t.关联数 + t.事件参与数) as 权重,
                 case when ${核心判据()} then '核心' else '提及' end as 分组
            from (
              select e.id, e.type, e.canonical_value, e.attrs, e.trust_state, e.created_at,
                     ${关系度数()} as 关联数,
                     ${事件参与数()} as 事件参与数
                from auth.case_entity e
               where ${sql.join(条件, sql` and `)}
            ) t
        ) 行
       where ${分组条件}
       order by ${顺序}
       limit ${上限}
    `),
  )
  // `count(*) over()` 在 LIMIT 之前算：正好装下最后一页（总数 === 上限）时**不算截断**。
  const 总数 = 行们.length === 0 ? 0 : Number(行们[0]!.总数)
  const 排好 = 行们.map((行) => ({
    id: String(行.id),
    type: String(行.type),
    subtype: 细类(String(行.type), String(行.canonical_value), 行.attrs),
    canonical_value: String(行.canonical_value),
    trust_state: String(行.trust_state),
    关联数: Number(行.关联数),
    事件参与数: Number(行.事件参与数),
    权重: Number(行.权重),
    分组: String(行.分组) as 实体分组,
    created_at: Number(行.created_at),
  }))

  const 缺口 = 总数 > 上限 ? [`已显示前 ${上限} 条，共 ${总数} 条，请用搜索或分组缩小范围`] : []
  return { 行们: 排好, 总数, 缺口 }
}

export interface 档案关系 {
  readonly id: string
  readonly type: string
  readonly 方向: "出" | "入"
  readonly 对方id: string
  readonly 对方值: string
  readonly 对方类型: string
  /**
   * 对方实体的细类（「号码 · 手机号」的后者），判据与实体自己的 `subtype` **同一把**
   * （`细类()`：形状优先、`attrs` 补空）。判不出给 `null`——界面据此退回 `对方类型`，
   * 再没有才写「——」（2026-11-08 用户提出：关系行要说清对方是什么）。
   */
  readonly 对方细类: string | null
  /** `data` = 数据直接记录；`human` = 人认定（§4.2）。档案页据此分「数据说的 / 人说的」。 */
  readonly source_kind: string
  readonly basis: string | null
  readonly trust_state: string
  readonly 首: number | null
  readonly 末: number | null
  readonly 次数: number | null
  readonly 金额: string | null
}

export interface 档案事件 {
  readonly id: string
  readonly type: string
  readonly occurred_at: number | null
  readonly occurred_raw: string | null
  readonly summary: string | null
  readonly participants: string[]
  readonly trust_state: string
}

export interface 实体档案 {
  readonly id: string
  readonly type: string
  /** 大类之下的细类（「号码 · 手机号」的后者）；判不出就没有——界面只显示大类。 */
  readonly subtype?: string
  readonly canonical_value: string
  readonly aliases: string[]
  readonly attrs: Record<string, unknown>
  readonly trust_state: string
  readonly created_at: number
  readonly 关系: readonly 档案关系[]
  readonly 事件: readonly 档案事件[]
  /**
   * 关系 / 事件的**全量**条数（`count(*) over()`，不受上限影响）。
   *
   * 界面报数必须用它们：跟着 `关系.length` / `事件.length` 报，会把「只列了前 200 条」
   * 说成「就 200 条」，还会和顶部「一句话」（全量聚合）对不上。
   */
  readonly 关系总数: number
  /** 数据说的 / 人说的两段各自的**全量**条数（关系段头报数用；两段上限不同，见 `关系数据上限`）。 */
  readonly 关系数据总数: number
  readonly 关系人总数: number
  readonly 事件总数: number
  /** 对手方 = 关系对方实体去重后的**全量**个数（与「一句话」的「N 个实体」同源）。 */
  readonly 对方数: number
  /** 出处的当前页（最多 `引用上限` 条）。 */
  readonly 引用: readonly 引用视图[]
  /**
   * 出处的**全量**条数（`count(*) over()`，不受上限影响）。
   *
   * 界面必须用它报数：跟着 `引用.length` 报会把「只取了前 500 条」说成「就 500 条」，
   * 而顶部「一句话」与数字卡的全量口径会因此对不上（同 `关系总数` / `事件总数` 的理由）。
   */
  readonly 引用总数: number
  /**
   * 「待确认」：本实体 + 它的有效关系 + 它的事件里 `trust_state ∈ {自动抽取, 存疑}` 的条数。
   * 已排除一律不计（「显示已排除」开关打开时也不计）。
   */
  readonly 待确认: {
    readonly 实体: number
    readonly 关系: number
    readonly 事件: number
    readonly 合计: number
  }
  /** §8.3：档案页顶部那句文字结论（服务端生成，保证同一份数据两次打开说同一句话）。 */
  readonly 一句话: string
  /**
   * 关系/事件被上限截断时的整句提示（与 `实体清单结果.缺口` 同名同风格）。
   * 没有截断就是 `undefined`——**不给空数组**，免得调用方在「没缺口」和「没算」之间猜。
   */
  readonly 缺口?: readonly string[]
}

export async function 实体档案(
  db: Queryable,
  input: { readonly projectId: string; readonly id: string; readonly includeExcluded?: boolean },
): Promise<实体档案 | undefined> {
  const 含排除 = input.includeExcluded === true
  const 实体行们 = rowsOf(
    await db.execute(sql`
      select id, type, canonical_value,
             array_to_json(aliases)::text as aliases, attrs, trust_state, created_at
        from auth.case_entity
       where project_id = ${input.projectId} and id = ${input.id}
       ${含排除 ? sql`` : sql`and trust_state <> '已排除'`}
    `),
  )
  if (实体行们.length === 0) return undefined
  const 实体 = 实体行们[0]!

  // 基 2（11 §3.2）：中心是账户时，关系按「恰好一端落在归属集里」判定；
  // 人 / 组织保持「端点等于自己」的原口径（集合只由账户构造）。
  // 不看 `含排除` 开关：归属是口径，不是可见性；归属集本身已经排除「已排除」的人。
  const 是账户 = String(实体.type) === "账户"
  const 归属集 = 是账户 ? 账户归属集(input.projectId, [String(实体.id)]) : undefined
  const from属于 = 归属集 === undefined ? sql`r.from_id = ${input.id}` : sql`r.from_id in ${归属集}`
  const 关系归属 =
    归属集 === undefined
      ? sql`(r.from_id = ${input.id} or r.to_id = ${input.id})`
      : 关系归属条件(input.projectId, [String(实体.id)], sql`r.from_id`, sql`r.to_id`)

  // 关系：两侧实体 join 出来，取「对方」；已排除的关系与已排除的对方都默认不出现（§9.1）。
  // 「触达」是 project + 该实体（账户走归属集，见上）；「可见」再叠未排除条件。
  // 待确认与列表 / 全量聚合同样用这份谓词，别写第二份。
  // ⚠️ 这组谓词是**唯一一份**：列表查询、全量聚合查询与待确认计数共用它，别写第二份。
  const 关系触达: SQL[] = [sql`r.project_id = ${input.projectId}`, 关系归属]
  const 关系可见: SQL[] = [
    ...关系触达,
    sql`r.trust_state <> '已排除'`,
    sql`对方.trust_state <> '已排除'`,
  ]
  const 关系条件 = 含排除 ? 关系触达 : 关系可见
  // 两段各取各的（见 `关系数据上限` / `关系人上限` 的说明）：同一条谓词，只多一个分段条件。
  // `count(*) over()` 在 LIMIT **之前**算 ⇒ 每段拿到的是自己那一段的全量行数。
  const 取关系段 = async (段: "data" | "human", 上限: number) =>
    rowsOf(
      await db.execute(sql`
        select r.id, r.type, r.from_id, r.to_id, r.source_kind, r.basis, r.trust_state,
               r.first_at, r.last_at, r.times, r.amount::text as amount,
               对方.id as 对方id, 对方.canonical_value as 对方值, 对方.type as 对方类型,
               对方.attrs as 对方attrs,
               (${from属于}) as from属于,
               count(*) over() as 总数
          from auth.case_relation r
          join auth.case_entity 对方
            on 对方.project_id = r.project_id
           and 对方.id = case when ${from属于} then r.to_id else r.from_id end
         where ${sql.join([...关系条件, 段条件(段)], sql` and `)}
         order by coalesce(r.last_at, r.first_at, 0) desc, r.id asc
         limit ${上限}
      `),
    )
  const 数据行的行们 = await 取关系段("data", 关系数据上限)
  const 人行的行们 = await 取关系段("human", 关系人上限)
  const 关系行们 = [...数据行的行们, ...人行的行们]
  const 数段总数 = (行们: ReturnType<typeof rowsOf>) => (行们.length === 0 ? 0 : Number(行们[0].总数))
  const 关系数据总数 = 数段总数(数据行的行们)
  const 关系人总数 = 数段总数(人行的行们)
  const 关系总数 = 关系数据总数 + 关系人总数
  // 一句话的「N 个实体 / 涉及 N 个<类型>」必须是**全量**：列表页只有前 200 行，
  // 按页聚合会在 201 个不同对方时说成「200 个」(§9.1 同口径)。
  const 涉及行们 = rowsOf(
    await db.execute(sql`
      select 对方.type as 类型, count(distinct 对方.id)::int as 个数
        from auth.case_relation r
        join auth.case_entity 对方
          on 对方.project_id = r.project_id
         and 对方.id = case when ${from属于} then r.to_id else r.from_id end
       where ${sql.join(关系条件, sql` and `)}
       group by 对方.type
    `),
  )
  const 涉及 = 涉及行们.map((行) => ({ 类型: String(行.类型), 个数: Number(行.个数) }))
  // 只有一份：`一句话` 与数字卡的「对手方」用的是**同一批**对方实体（#002-06）。
  const 对方数 = 涉及.reduce((和, 项) => 和 + 项.个数, 0)
  const 关系 = 关系行们.map((行) => ({
    id: String(行.id),
    type: String(行.type),
    方向: (行.from属于 as boolean) ? ("出" as const) : ("入" as const),
    对方id: String(行.对方id),
    对方值: String(行.对方值),
    对方类型: String(行.对方类型),
    对方细类: 细类(String(行.对方类型), String(行.对方值), 行.对方attrs) ?? null,
    source_kind: String(行.source_kind),
    basis: (行.basis as string | null) ?? null,
    trust_state: String(行.trust_state),
    首: 行.first_at as number | null,
    末: 行.last_at as number | null,
    次数: 行.times as number | null,
    金额: (行.amount as string | null) ?? null,
  }))

  // 基 1（11 §3.1）：同一个判据，不再只比 `participants @> array[规范值]`。
  // 参与者表（本人 / 正向代表 / 反向对齐者）∪ `participants` 文本回退（规范值 ∪ 别名）。
  // 与关系同理：「触达」到「可见」各一份，待确认计数复用可见谓词。
  const 事件触达: SQL[] = [
    sql`project_id = ${input.projectId}`,
    sql`${事件归属条件(input.projectId, String(实体.id))}`,
  ]
  const 事件可见: SQL[] = [...事件触达, sql`trust_state <> '已排除'`]
  const 事件条件 = 含排除 ? 事件触达 : 事件可见
  const 事件行们 = rowsOf(
    await db.execute(sql`
      select id, type, occurred_at, occurred_raw, summary,
             array_to_json(participants)::text as participants, trust_state,
             count(*) over() as 总数
        from auth.case_event
       where ${sql.join(事件条件, sql` and `)}
       order by occurred_at desc nulls last, id asc
       limit ${事件上限}
    `),
  )
  const 事件总数 = 事件行们.length === 0 ? 0 : Number(事件行们[0]!.总数)
  const 事件 = 事件行们.map((行) => ({
    id: String(行.id),
    type: String(行.type),
    occurred_at: 行.occurred_at as number | null,
    occurred_raw: (行.occurred_raw as string | null) ?? null,
    summary: (行.summary as string | null) ?? null,
    participants: 解JSON<string[]>(行.participants, []),
    trust_state: String(行.trust_state),
  }))

  // 待确认只数「人还没表态的」：`自动抽取 / 存疑`。已排除不进（那是人的决定，不是待办），
  // 所以这里固定用可见谓词，不看 `含排除`——「显示已排除」开关不改变待办口径。
  const 待确认关系行 = rowsOf(
    await db.execute(sql`
      select count(*)::int as 条数
        from auth.case_relation r
        join auth.case_entity 对方
          on 对方.project_id = r.project_id
         and 对方.id = case when ${from属于} then r.to_id else r.from_id end
       where ${sql.join([...关系可见, sql`r.trust_state in ('自动抽取','存疑')`], sql` and `)}
    `),
  )[0]!
  const 待确认事件行 = rowsOf(
    await db.execute(sql`
      select count(*)::int as 条数
        from auth.case_event
       where ${sql.join([...事件可见, sql`trust_state in ('自动抽取','存疑')`], sql` and `)}
    `),
  )[0]!
  const 待确认实体 = ["自动抽取", "存疑"].includes(String(实体.trust_state)) ? 1 : 0
  const 待确认关系 = Number(待确认关系行.条数)
  const 待确认事件 = Number(待确认事件行.条数)

  const { 行们: 引用, 总数: 引用总数 } = await 引用们(db, input.projectId, "entity", input.id, 引用上限)

  // 截断不能伪装成总数：显示的是前 N 条，缺口里说清全量有多少。
  //
  // ⚠️ 别写成「请到关系图 / 时间线看全部」（2026-11-07 改掉）：关系图一次最多画 50 个节点
  // （`case-graph.ts` 的 `默认节点上限`），时间线默认 50 条（`case-mcp-tools.ts` 的 `默认限制`），
  // 都比这里的 200 / 100 还少——那两个入口自己也会截断。能给的只有「怎么缩小范围」。
  const 缺口: string[] = []
  if (关系数据总数 > 关系数据上限)
    缺口.push(`数据说的关系只显示最近 ${关系数据上限} 条，共 ${关系数据总数} 条；关系图可按类型筛选查看邻域`)
  if (关系人总数 > 关系人上限)
    缺口.push(`人说的关系只显示最近 ${关系人上限} 条，共 ${关系人总数} 条`)
  if (事件总数 > 事件上限)
    缺口.push(`事件只显示最近 ${事件上限} 条，共 ${事件总数} 条；时间线可用起止时间缩小范围`)
  if (引用总数 > 引用上限)
    缺口.push(`出处只显示前 ${引用上限} 条，共 ${引用总数} 条`)

  return {
    id: String(实体.id),
    type: String(实体.type),
    subtype: 细类(String(实体.type), String(实体.canonical_value), 实体.attrs),
    canonical_value: String(实体.canonical_value),
    aliases: 解JSON<string[]>(实体.aliases, []),
    attrs: 解JSON<Record<string, unknown>>(实体.attrs, {}),
    trust_state: String(实体.trust_state),
    created_at: Number(实体.created_at),
    关系,
    事件,
    关系总数,
    关系数据总数,
    关系人总数,
    事件总数,
    对方数,
    引用,
    引用总数,
    待确认: {
      实体: 待确认实体,
      关系: 待确认关系,
      事件: 待确认事件,
      合计: 待确认实体 + 待确认关系 + 待确认事件,
    },
    一句话: 一句话结论(String(实体.type), String(实体.canonical_value), 涉及, 对方数, 关系总数, 事件总数),
    ...(缺口.length > 0 ? { 缺口 } : {}),
  }
}

/**
 * 档案关系的分段谓词：与界面「数据说的 / 人说的」同一刀（前端按 `source_kind === "human"` 分）。
 * 两段必须互补——判据写歪了会有关系两边都不进，或两边都进被数两遍。
 */
function 段条件(段: "data" | "human"): SQL {
  return 段 === "human" ? sql`r.source_kind = 'human'` : sql`r.source_kind <> 'human'`
}

/** 用户输入里的模糊通配符先转义，再拼 `%…%`（SQL 侧配 `escape '\'`）。 */
function 转义模糊(词: string): string {
  return 词.replace(/[\\%_]/g, (字) => `\\${字}`)
}

/** 库列是 text[] 或 jsonb：驱动读回可能是数组，也可能是字符串 ⇒ 两种都收。 */
function 解JSON<T>(值: unknown, 兜底: T): T {
  if (typeof 值 !== "string") {
    // PGlite / bun-sql 的裸选都可能给数组，但仓库不给它机会：SQL 侧已 `array_to_json(…)::text`。
    return (值 as T | null | undefined) ?? 兜底
  }
  try {
    return JSON.parse(值) as T
  } catch {
    return 兜底
  }
}

/**
 * §8.3：一句话结论只陈述**可数的事实**，不下判断。
 * 例：「张三：人。与本项目 2 个实体有 2 条有效关系，涉及 1 个人、1 个账户；关联 2 个事件。」
 *
 * 「N 个<类型>」数的是**对方实体个数**，不是关系条数：同一个账户转了两笔仍是「1 个账户」。
 * 两个数字都必须走**全量**（`涉及` 是 SQL `count(distinct 对方.id)` 聚合、`关系总数` 是窗口计数），
 * 不能用当前页的 `关系.length`——截断不能冒充总数。
 */
function 一句话结论(
  type: string,
  值: string,
  涉及: readonly { readonly 类型: string; readonly 个数: number }[],
  对方数: number,
  关系总数: number,
  事件数: number,
): string {
  const 组成 = [...涉及]
    .sort((甲, 乙) => 乙.个数 - 甲.个数 || 甲.类型.localeCompare(乙.类型))
    .map((项) => `${项.个数} 个${项.类型}`)
  const 件 =
    关系总数 === 0 ? "没有有效关系" : `与本项目 ${对方数} 个实体有 ${关系总数} 条有效关系`
  const 涉 = 组成.length === 0 ? "" : `，涉及 ${组成.join("、")}`
  const 事 = 事件数 === 0 ? "没有关联事件" : `关联 ${事件数} 个事件`
  return `${值}：${type}。${件}${涉}；${事}。`
}
