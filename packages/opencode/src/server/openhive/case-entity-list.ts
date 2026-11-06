import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { Queryable } from "./case-store"
import { 引用们, type 引用视图 } from "./case-fact-read"

/**
 * 实体视图（计划 7 的左栏与中栏）：类型计数、清单、档案三个只读出口。
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

export interface 类型计数 {
  readonly type: string
  readonly count: number
}

export type 排序 = "涉案" | "名称" | "时间"

export interface 实体清单项 {
  readonly id: string
  readonly type: string
  readonly canonical_value: string
  readonly trust_state: string
  readonly 关联数: number
  readonly created_at: number
}

export interface 实体清单结果 {
  readonly 行们: 实体清单项[]
  readonly 缺口: string[]
}

export interface 实体清单入参 {
  readonly projectId: string
  /** 省略 = 跨类型（搜索时用）；给了就只查这一类型。 */
  readonly type?: string
  readonly q?: string
  readonly sort?: 排序
  readonly limit?: number
}

export const 清单上限 = 200

export async function 类型计数(db: Queryable, projectId: string): Promise<类型计数[]> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select type, count(*)::int as count
        from auth.case_entity
       where project_id = ${projectId} and trust_state <> '已排除'
       group by type
       order by count desc, type asc
    `),
  )
  return 行们.map((行) => ({ type: String(行.type), count: Number(行.count) }))
}

export async function 实体清单(db: Queryable, input: 实体清单入参): Promise<实体清单结果> {
  const 上限 = Math.min(Math.max(1, Math.trunc(input.limit ?? 清单上限)), 清单上限)
  const 条件: SQL[] = [sql`e.project_id = ${input.projectId}`, sql`e.trust_state <> '已排除'`]
  if (input.type !== undefined) 条件.push(sql`e.type = ${input.type}`)
  const 词 = input.q?.trim()
  if (词 !== undefined && 词 !== "") {
    const 模式 = `%${词}%`
    条件.push(
      sql`(e.canonical_value ilike ${模式}
           or exists (select 1 from unnest(e.aliases) as 别名 where 别名 ilike ${模式}))`,
    )
  }
  const 排序 = input.sort ?? "涉案"
  // `关联数` 是 output alias，PostgreSQL 允许在 order by 里引用。
  const 顺序 =
    排序 === "名称"
      ? sql`e.canonical_value asc, e.id asc`
      : 排序 === "时间"
        ? sql`e.created_at desc, e.id asc`
        : sql`关联数 desc, e.canonical_value asc, e.id asc`

  const 行们 = rowsOf(
    await db.execute(sql`
      select e.id, e.type, e.canonical_value, e.trust_state, e.created_at,
             -- 与「实体档案」同一口径：对方实体已排除的关系，档案不列、清单也不算（§9.1 不进统计）。
             -- 用 in (select …) 而不是 join：join 会让 project_id / trust_state 变成歧义列
             -- （同 case-mcp-tools.ts 里同款子查询的取法）。
             (select count(*)::int
                from auth.case_relation r
               where r.project_id = e.project_id
                 and r.trust_state <> '已排除'
                 and (r.from_id = e.id or r.to_id = e.id)
                 and (case when r.from_id = e.id then r.to_id else r.from_id end)
                     in (select id
                           from auth.case_entity
                          where project_id = e.project_id and trust_state <> '已排除')) as 关联数
        from auth.case_entity e
       where ${sql.join(条件, sql` and `)}
       order by ${顺序}
       limit ${上限}
    `),
  ).map((行) => ({
    id: String(行.id),
    type: String(行.type),
    canonical_value: String(行.canonical_value),
    trust_state: String(行.trust_state),
    关联数: Number(行.关联数),
    created_at: Number(行.created_at),
  }))

  const 缺口 = 行们.length === 上限 ? [`已显示前 ${上限} 条，请用搜索或类型缩小范围`] : []
  return { 行们, 缺口 }
}

export interface 档案关系 {
  readonly id: string
  readonly type: string
  readonly 方向: "出" | "入"
  readonly 对方id: string
  readonly 对方值: string
  readonly 对方类型: string
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
  readonly canonical_value: string
  readonly aliases: string[]
  readonly attrs: Record<string, unknown>
  readonly trust_state: string
  readonly created_at: number
  readonly 关系: readonly 档案关系[]
  readonly 事件: readonly 档案事件[]
  readonly 引用: readonly 引用视图[]
  /** §8.3：档案页顶部那句文字结论（服务端生成，保证同一份数据两次打开说同一句话）。 */
  readonly 一句话: string
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

  // 关系：两侧实体 join 出来，取「对方」；已排除的关系与已排除的对方都默认不出现（§9.1）。
  const 关系条件: SQL[] = [
    sql`r.project_id = ${input.projectId}`,
    sql`(r.from_id = ${input.id} or r.to_id = ${input.id})`,
  ]
  if (!含排除) 关系条件.push(sql`r.trust_state <> '已排除'`)
  const 关系 = rowsOf(
    await db.execute(sql`
      select r.id, r.type, r.from_id, r.to_id, r.source_kind, r.basis, r.trust_state,
             r.first_at, r.last_at, r.times, r.amount::text as amount,
             对方.id as 对方id, 对方.canonical_value as 对方值, 对方.type as 对方类型
        from auth.case_relation r
        join auth.case_entity 对方
          on 对方.project_id = r.project_id
         and 对方.id = case when r.from_id = ${input.id} then r.to_id else r.from_id end
       where ${sql.join(
         含排除 ? 关系条件 : [...关系条件, sql`对方.trust_state <> '已排除'`],
         sql` and `,
       )}
       order by coalesce(r.last_at, r.first_at, 0) desc, r.id asc
       limit 200
    `),
  ).map((行) => ({
    id: String(行.id),
    type: String(行.type),
    方向: String(行.from_id) === input.id ? ("出" as const) : ("入" as const),
    对方id: String(行.对方id),
    对方值: String(行.对方值),
    对方类型: String(行.对方类型),
    source_kind: String(行.source_kind),
    basis: (行.basis as string | null) ?? null,
    trust_state: String(行.trust_state),
    首: 行.first_at as number | null,
    末: 行.last_at as number | null,
    次数: 行.times as number | null,
    金额: (行.amount as string | null) ?? null,
  }))

  // 事件的参与者存的是**实体规范值**（计划 4 的写口），不是 id。
  const 事件 = rowsOf(
    await db.execute(sql`
      select id, type, occurred_at, occurred_raw, summary,
             array_to_json(participants)::text as participants, trust_state
        from auth.case_event
       where project_id = ${input.projectId}
         and participants @> array[${String(实体.canonical_value)}]::text[]
         ${含排除 ? sql`` : sql`and trust_state <> '已排除'`}
       order by occurred_at desc nulls last, id asc
       limit 100
    `),
  ).map((行) => ({
    id: String(行.id),
    type: String(行.type),
    occurred_at: 行.occurred_at as number | null,
    occurred_raw: (行.occurred_raw as string | null) ?? null,
    summary: (行.summary as string | null) ?? null,
    participants: 解JSON<string[]>(行.participants, []),
    trust_state: String(行.trust_state),
  }))

  const 引用 = await 引用们(db, input.projectId, "entity", input.id)

  return {
    id: String(实体.id),
    type: String(实体.type),
    canonical_value: String(实体.canonical_value),
    aliases: 解JSON<string[]>(实体.aliases, []),
    attrs: 解JSON<Record<string, unknown>>(实体.attrs, {}),
    trust_state: String(实体.trust_state),
    created_at: Number(实体.created_at),
    关系,
    事件,
    引用,
    一句话: 一句话结论(String(实体.type), String(实体.canonical_value), 关系, 事件.length),
  }
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
 * 例：「张三是本项目核心节点：2 个号码、1 个账户、与 3 个实体有 4 条有效关系」
 */
function 一句话结论(type: string, 值: string, 关系: readonly 档案关系[], 事件数: number): string {
  const 按类型 = new Map<string, number>()
  for (const 行 of 关系) 按类型.set(行.对方类型, (按类型.get(行.对方类型) ?? 0) + 1)
  const 组成 = [...按类型.entries()]
    .sort((甲, 乙) => 乙[1] - 甲[1] || 甲[0].localeCompare(乙[0]))
    .map(([类, 数]) => `${数} 个${类}`)
  const 件 = 组成.length === 0 ? "没有有效关系" : `与 ${组成.join("、")} 有 ${关系.length} 条有效关系`
  const 事 = 事件数 === 0 ? "没有关联事件" : `关联 ${事件数} 个事件`
  return `${值}（${type}）：${件}，${事}。`
}
