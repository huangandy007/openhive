import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { Queryable } from "./case-store"
import {
  事件归属条件,
  实体关系归属,
  账户归属集数组,
  账户展示名,
  户名对齐,
  关系归属口径,
  歧义到账户,
  另一端未排除,
  内部往来归属条件,
  归属歧义归属条件,
  已排除规范值,
} from "./case-party"
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
  /** 有效关系条数（关系未排除、对方未排除；归属口径同档案，账户按归属集 XOR）。 */
  readonly 关联数: number
  /** 事件参与数（事件未排除；归属口径同档案，参与者表 ∪ `participants` 文本回退）。 */
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
 * 有效关系度数：清单的 `关联数` 与分组计数共用这一份谓词（`#002-06`），
 * 归属口径与 `实体档案` 共用 `实体关系归属`（基 2 账户 XOR / 基 1 端点相等）。
 * 只有一层 SQL 片段函数、没有第二个实现；改口径只改这里。
 *
 * 归属集由外层 `cross join lateral (... 账户归属集数组 ...) 归属集` 预算成数组（`归属集.ids`）：
 * 相关子查询在某类计划下会被错算，见 `账户归属集数组`（`#013-05`）。
 */
const 关系度数 = () => {
  const { 归属, from属于 } = 实体关系归属({
    projectId: sql`e.project_id`,
    实体id: sql`e.id`,
    类型: sql`e.type`,
    从: sql`r.from_id`,
    到: sql`r.to_id`,
    归属集数组: sql`归属集.ids`,
  })
  return sql`(
    select count(*)::int
      from auth.case_relation r
     where r.project_id = e.project_id
       and r.trust_state <> '已排除'
       and ${归属}
       and ${另一端未排除({ projectId: sql`e.project_id`, from属于, 从: sql`r.from_id`, 到: sql`r.to_id` })}
  )`
}

/** 事件参与数：事件未排除、参与者按基 1 归属（与 `实体档案` 共用 `事件归属条件`）。与分组计数共用。 */
const 事件参与数 = () =>
  sql`(
    select count(*)::int
      from auth.case_event
     where project_id = e.project_id
       and trust_state <> '已排除'
       and ${事件归属条件(sql`e.project_id`, sql`e.id`)}
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
            cross join lateral (select ${账户归属集数组(sql`e.project_id`, sql`e.id`)} as ids) 归属集
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
                cross join lateral (select ${账户归属集数组(sql`e.project_id`, sql`e.id`)} as ids) 归属集
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

/**
 * `实体档案` 的四类截断缺口文案：写口与过滤口共用这一份契约（`#002-06`）。
 *
 * `explore_entity` 不返回 `档案.关系` / `档案.引用`，必须把这些句子挡掉；但按字面前缀
 * 散在两个模块里匹配，改一次文案就会静默漏过滤。文案只能从这里出，过滤也只认这里的
 * `前缀`，两边不会各写一份。
 */
export const 档案截断缺口 = {
  关系数据: {
    前缀: "数据说的关系只显示最近",
    句: (上限: number, 总数: number) =>
      `数据说的关系只显示最近 ${上限} 条，共 ${总数} 条；关系图可按类型筛选查看邻域`,
  },
  关系人: {
    前缀: "人说的关系只显示最近",
    句: (上限: number, 总数: number) => `人说的关系只显示最近 ${上限} 条，共 ${总数} 条`,
  },
  事件: {
    前缀: "事件只显示最近",
    句: (上限: number, 总数: number) =>
      `事件只显示最近 ${上限} 条，共 ${总数} 条；时间线可用起止时间缩小范围`,
  },
  出处: {
    前缀: "出处只显示前",
    句: (上限: number, 总数: number) => `出处只显示前 ${上限} 条，共 ${总数} 条`,
  },
} as const

/** 这句是不是 `实体档案` 自己的截断缺口（`explore_entity` 过滤「无关句」的唯一判据）。 */
export function 是档案截断缺口(句: string): boolean {
  return Object.values(档案截断缺口).some((类) => 句.startsWith(类.前缀))
}

/**
 * `实体档案` 的归属缺口（内部往来 / 归属歧义）：写口与过滤口共用这一份契约（`#002-06`）。
 * `explore_entity` 用「关系圈」措辞重报同一事实，必须挡掉档案版本，免得同一事实两套数字。
 */
export const 档案归属缺口 = {
  内部往来: {
    前缀: "账户内部往来",
    句: (条数: number) => `账户内部往来 ${条数} 条：两端都在本账户归属集内，未计入关系与对方数`,
  },
  归属歧义: {
    前缀: "账户归属歧义",
    句: (条数: number) => `账户归属歧义 ${条数} 条：户名对应多个账户，未归属本账户（fail-closed，不猜）`,
  },
} as const

export function 是档案归属缺口(句: string): boolean {
  return Object.values(档案归属缺口).some((类) => 句.startsWith(类.前缀))
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

  // 基 2（11 §3.2）的分派只在 `关系归属口径` 一处（`#002-06`）：账户按「恰好一端落在
  // 归属集里」判定，人 / 组织保持「端点等于自己」；关系圈 / 关系图 / `find_crossings`
  // 与这里同源。逐行的 SQL 形态（清单）走 `实体关系归属`，是同一张表的另一形态。
  // 不看 `含排除` 开关：归属是口径，不是可见性；归属集本身已经排除「已排除」的人。
  const { 归属集, from属于, 触达: 关系归属 } = 关系归属口径({
    projectId: input.projectId,
    ids: [String(实体.id)],
    类型: String(实体.type),
    从: sql`r.from_id`,
    到: sql`r.to_id`,
  })

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
  // §9.1：`participants` 里「已排除」实体的规范值一并剔除（唯一出处 `case-party.已排除规范值`，
  // `#002-06`），与本档案自己的「已排除」开关同口径：开「显示已排除」才原样返回。
  const 已排除值 = 含排除 || 事件行们.length === 0 ? new Set<string>() : await 已排除规范值(db, input.projectId)
  const 事件 = 事件行们.map((行) => ({
    id: String(行.id),
    type: String(行.type),
    occurred_at: 行.occurred_at as number | null,
    occurred_raw: (行.occurred_raw as string | null) ?? null,
    summary: (行.summary as string | null) ?? null,
    participants: 解JSON<string[]>(行.participants, []).filter((项) => !已排除值.has(项)),
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
    缺口.push(档案截断缺口.关系数据.句(关系数据上限, 关系数据总数))
  if (关系人总数 > 关系人上限)
    缺口.push(档案截断缺口.关系人.句(关系人上限, 关系人总数))
  if (事件总数 > 事件上限)
    缺口.push(档案截断缺口.事件.句(事件上限, 事件总数))
  if (引用总数 > 引用上限)
    缺口.push(档案截断缺口.出处.句(引用上限, 引用总数))

  // 基 2 的归属缺口（设计 11 §3.3）：内部往来被 XOR 排除、歧义者 fail-closed，两者都不进
  // 关系总数 / 对方数。谓词与关系圈遗漏 / aggregate_money 共用（case-party.ts，`#002-06`）。
  // 计数基础固定「未排除」，与 `关系圈遗漏` 同口径；不随 `含排除` 开关变（缺口讲归属，不讲可见性）。
  const 归属缺口计数 = async (条件: SQL[]): Promise<number> =>
    Number(
      rowsOf(
        await db.execute(sql`
          select count(*)::int as 数
            from auth.case_relation r
           where ${sql.join(条件, sql` and `)}
        `),
      )[0]?.数 ?? 0,
    )
  const 归属缺口基础 = [sql`r.project_id = ${input.projectId}`, sql`r.trust_state <> '已排除'`]
  const 内部往来条数 =
    归属集 === undefined
      ? 0
      : await 归属缺口计数([
          ...归属缺口基础,
          ...内部往来归属条件({ projectId: input.projectId, 归属集, 从: sql`r.from_id`, 到: sql`r.to_id` }),
        ])
  const 归属歧义条数 =
    归属集 === undefined
      ? 0
      : await 归属缺口计数([
          ...归属缺口基础,
          ...归属歧义归属条件({
            projectId: input.projectId,
            归属集,
            歧义实体: 歧义到账户(input.projectId, [String(实体.id)]),
            从: sql`r.from_id`,
            到: sql`r.to_id`,
          }),
        ])
  if (内部往来条数 > 0) 缺口.push(档案归属缺口.内部往来.句(内部往来条数))
  if (归属歧义条数 > 0) 缺口.push(档案归属缺口.归属歧义.句(归属歧义条数))

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

export interface 关系圈项 {
  readonly 对方: string
  readonly 对方类型: string
  /** 与 `档案关系.对方细类` 同型（`细类()` 返回 `string | undefined`，判不出给 `null`）。 */
  readonly 对方细类: string | null
  readonly 方向: "出" | "入"
  readonly 类型: string
  readonly 次数: number
  readonly 金额: string | null
  readonly 首: number | null
  readonly 末: number | null
}

/** 关系圈最多展示多少组（按金额降序）。超出部分由调用点写进缺口。 */
export const 关系圈上限 = 10

/**
 * 一圈关系按「对方代表」聚合（`explore_entity` 用）：原始关系是每对多行，直接列出去不是
 * 一个圈。
 *
 * - **触达**与 `实体档案` 同一份谓词：账户走基 2 的 XOR（`关系归属条件`），人 / 组织保持
 *   「端点等于自己」。分组键是 `coalesce(户名对齐代表, 对方.id)`，与 `aggregate_money` 的
 *   对手方同口径——人与其唯一户名账户因此合成一组。
 * - **展示**也跟着代表走（10 §3.1「显示优先用户名」）：`人 / 组织` 展示自己；其他类型
 *   展示唯一户名对齐到它的人名（`账户展示名`，与 `aggregate_money` 共用），取不到才展示
 *   端点本身。不改写端点、不合并实体（关系事实仍按原样）。
 * - **只收人民币笔数 > 0 的关系**（D-9）：纯外币关系在 `aggregate_money` 里也不进汇总，
 *   留在这里只会产生金额 0.00 的空组。
 */
interface 关系圈范围 {
  readonly 是账户: boolean
  /** 基 2 的归属集；中心不是账户时无（维持端点相等口径）。 */
  readonly 归属集: SQL | undefined
  readonly from属于: SQL
  readonly 触达: SQL
  readonly 窗: SQL[]
}

/**
 * 关系圈的口径**只在这里定义一次**：`关系圈` 取数、`关系圈遗漏` 计数都从这里出发
 * （`#002-06`）。漏改一处就会出现「圈里按基 2、缺口按端点」的自相矛盾。
 */
function 关系圈范围(input: {
  readonly projectId: string
  readonly id: string
  readonly type: string
  readonly 起?: number
  readonly 止?: number
}): 关系圈范围 {
  // 基 2 的分派在 `case-party.关系归属口径` 一处（`case-party` 的 `#002-06` 注）；
  // 这里只补时间窗。
  const { 是账户, 归属集, from属于, 触达 } = 关系归属口径({
    projectId: input.projectId,
    ids: [input.id],
    类型: input.type,
    从: sql`r.from_id`,
    到: sql`r.to_id`,
  })
  // 时间窗与 `aggregate_money` 同口径：最晚不早于「起」、最早不晚于「止」。
  const 窗: SQL[] = []
  if (input.起 !== undefined) 窗.push(sql`coalesce(r.last_at, r.first_at, 0) >= ${input.起}`)
  if (input.止 !== undefined) 窗.push(sql`coalesce(r.first_at, r.last_at, 0) <= ${input.止}`)
  return { 是账户, 归属集, from属于, 触达, 窗 }
}

export interface 关系圈结果 {
  readonly 项们: 关系圈项[]
  /** 分组后的全量组数（`count(*) over()`，不受 `关系圈上限` 影响）。 */
  readonly 组总数: number
}

export async function 关系圈(
  db: Queryable,
  input: {
    readonly projectId: string
    readonly id: string
    readonly type: string
    readonly 起?: number
    readonly 止?: number
  },
): Promise<关系圈结果> {
  const { 归属集, from属于, 触达, 窗 } = 关系圈范围(input)
  const 行们 = rowsOf(
    await db.execute(sql`
      select coalesce(min(case when 对方.type in ('人', '组织') then 对方.canonical_value end),
                      min(展示.代表值),
                      min(对方.canonical_value)) as 对方值,
             coalesce(min(case when 对方.type in ('人', '组织') then 对方.type end),
                      min(展示.代表类型),
                      min(对方.type)) as 对方类型,
             coalesce(min(case when 对方.type in ('人', '组织') then 对方.attrs::text end),
                      min(展示.代表attrs),
                      min(对方.attrs::text)) as 对方attrs,
             case when ${from属于} then '出' else '入' end as 方向,
             r.type as 关系类型,
             -- 次数与金额、筛选同为人民币口径（times_cny 缺失时回退 times）；
             -- 全币种的 times 属于关系本体，不在这里展示。
             sum(coalesce(r.times_cny, r.times, 1))::int as 次数,
             sum(r.amount)::text as 金额,
             min(coalesce(r.first_at, r.last_at)) as 首,
             max(coalesce(r.last_at, r.first_at)) as 末,
             -- count(*) over() 在 GROUP BY 之后、LIMIT 之前算 ⇒ 全量组数，不受上限影响。
             count(*) over() as 组总数
        from auth.case_relation r
        join auth.case_entity 对方
          on 对方.project_id = r.project_id
         and 对方.id = case when ${from属于} then r.to_id else r.from_id end
         and 对方.trust_state <> '已排除'
        left join lateral ${户名对齐(input.projectId, sql`对方.id`, sql`对方.type`, sql`对方.canonical_value`)} 对齐 on true
        left join lateral ${账户展示名(input.projectId, sql`对方.id`)} 展示 on true
       where r.project_id = ${input.projectId}
         and r.trust_state <> '已排除'
         and ${触达}
         and coalesce(r.times_cny, r.times, 1) > 0
         ${窗.length === 0 ? sql`` : sql`and ${sql.join(窗, sql` and `)}`}
       group by 方向, r.type, coalesce(对齐.代表, 对方.id)
       order by sum(r.amount) desc nulls last, 对方值 asc
       limit ${关系圈上限}
    `),
  )
  const 组总数 = 行们.length === 0 ? 0 : Number(行们[0]!.组总数)
  return {
    项们: 行们.map((行) => ({
      对方: String(行.对方值),
      对方类型: String(行.对方类型),
      对方细类: 细类(String(行.对方类型), String(行.对方值), 解JSON<Record<string, unknown>>(行.对方attrs, {})) ?? null,
      方向: String(行.方向) === "出" ? "出" : "入",
      类型: String(行.关系类型),
      次数: Number(行.次数),
      金额: (行.金额 as string | null) ?? null,
      首: 行.首 === null || 行.首 === undefined ? null : Number(行.首),
      末: 行.末 === null || 行.末 === undefined ? null : Number(行.末),
    })),
    组总数,
  }
}

/** `关系圈` 静默丢掉的三类关系条数（口径与 `aggregate_money` 的缺口计数同源）。 */
export interface 关系圈遗漏 {
  /** 纯外币（`coalesce(times_cny, times, 1) = 0`）：不进圈，但关系真实存在。 */
  readonly 纯外币: number
  /** 两端都在账户归属集里的内部往来：XOR 排除；只在中心是账户时可能非 0。 */
  readonly 内部往来: number
  /** 户名对应多个账户、fail-closed 未归属的关系；只在中心是账户时可能非 0。 */
  readonly 归属歧义: number
}

/**
 * 数清关系圈 where 丢掉的三类关系（11 §3.2 / §3.3、09 §5.2 纪律 2）：
 * 不说清，模型会把「圈里看不到」讲成「没有往来」。
 *
 * 与 `aggregate_money:1813-1839` 同一套计数口径（XOR / 内部往来 / 歧义），差别只有：
 * 关系圈不按 `type = '转账'` 过滤（brief 的 SQL 就是全类型），所以文案里的「转账关系」
 * 在这里说成「关系」；时间窗与 `关系圈` 共用同一份 `关系圈范围`。
 */
export async function 关系圈遗漏(
  db: Queryable,
  input: {
    readonly projectId: string
    readonly id: string
    readonly type: string
    readonly 起?: number
    readonly 止?: number
  },
): Promise<关系圈遗漏> {
  const { 是账户, 归属集, from属于, 触达, 窗 } = 关系圈范围(input)
  const 窗条件 = 窗.length === 0 ? sql`` : sql`and ${sql.join(窗, sql` and `)}`
  // 与 `关系圈` 的 join 同一前提：另一端实体不能是「已排除」（唯一出处见 `另一端未排除`）。
  const 对方未排除 = 另一端未排除({
    projectId: input.projectId,
    from属于,
    从: sql`r.from_id`,
    到: sql`r.to_id`,
  })
  const 基础 = [sql`r.project_id = ${input.projectId}`, sql`r.trust_state <> '已排除'`]
  const 数 = async (条件: SQL): Promise<number> =>
    Number(
      rowsOf(
        await db.execute(sql`
          select count(*)::int as 数 from auth.case_relation r where ${条件}
        `),
      )[0]?.数 ?? 0,
    )
  // 纯外币：XOR 触达里笔数为 0 的关系（内部往来由 XOR 排除，不会在这里重复计数）。
  const 纯外币 = await 数(
    sql`${sql.join(
      [...基础, 触达, 对方未排除, sql`coalesce(r.times_cny, r.times, 1) = 0`],
      sql` and `,
    )} ${窗条件}`,
  )
  if (!是账户 || 归属集 === undefined) return { 纯外币, 内部往来: 0, 归属歧义: 0 }
  // 内部往来与归属歧义的谓词由 `case-party.ts` 提供（与 `aggregate_money` 同一份实现，
  // `#002-06`）；这里只补关系圈自己的基础条件（不按 `type='转账'` 过滤）。
  const 内部往来 = await 数(
    sql`${sql.join(
      [
        ...基础,
        ...内部往来归属条件({
          projectId: input.projectId,
          归属集,
          从: sql`r.from_id`,
          到: sql`r.to_id`,
        }),
      ],
      sql` and `,
    )} ${窗条件}`,
  )
  const 歧义实体 = 歧义到账户(input.projectId, [input.id])
  const 归属歧义 = await 数(
    sql`${sql.join(
      [
        ...基础,
        ...归属歧义归属条件({
          projectId: input.projectId,
          归属集,
          歧义实体,
          从: sql`r.from_id`,
          到: sql`r.to_id`,
        }),
      ],
      sql` and `,
    )} ${窗条件}`,
  )
  return { 纯外币, 内部往来, 归属歧义 }
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
