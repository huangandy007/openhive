export * as OpenhiveCaseGraph from "./case-graph"

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { Queryable } from "./case-store"
import { 细类 } from "./case-subtype"

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
}

export interface 图边 {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly type: string
  readonly times: number | null
  readonly amount: string | null
  readonly trust_state: string
}

export interface 关系图结果 {
  readonly 节点: 图节点[]
  readonly 边: 图边[]
  readonly 缺口: string[]
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
}

export const 默认节点上限 = 50

/** 入参是只读的，组装过程中要回填跳数与关联数；对外仍是只读视图。 */
type 可写节点 = { -readonly [K in keyof 图节点]: 图节点[K] }

interface 边行 {
  readonly id: string
  readonly from_id: string
  readonly to_id: string
  readonly type: string
  readonly times: number | null
  readonly amount: string | null
  readonly trust_state: string
  readonly from_value: string
  readonly from_type: string
  readonly from_trust: string
  readonly from_attrs: unknown
  readonly to_value: string
  readonly to_type: string
  readonly to_trust: string
  readonly to_attrs: unknown
}

interface 一圈 {
  /** 本跳最多取 `剩余 + 1` 条（多取一条只为判断「还有没有」）。 */
  readonly 边们: 边行[]
  /** 本跳满足条件的**全部**条数（`count(*) over()`，不受 `limit` 影响）。 */
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
  },
): Promise<一圈> {
  // `剩余 === 0` 也照样查一次（`limit 1`）：只查「还有没有」，不画。否则 `上限 = 1`
  // 时连库都不碰，返回「只有中心、无缺口」，界面会读成「这个人没有任何关联」。
  if (input.节点们.length === 0) return { 边们: [], 总数: 0 }
  const 节点表 = sql.join(
    input.节点们.map((id) => sql`${id}`),
    sql`, `,
  )
  const 类型条件: SQL[] =
    input.类型 === undefined || input.类型.length === 0
      ? []
      : [sql`r.type in (${sql.join(input.类型.map((条) => sql`${条}`), sql`, `)})`]

  const 行们 = rowsOf(
    await db.execute(sql`
      select r.id, r.from_id, r.to_id, r.type, r.times, r.amount::text as amount, r.trust_state,
             起.canonical_value as from_value, 起.type as from_type, 起.trust_state as from_trust,
             起.attrs as from_attrs,
             终.canonical_value as to_value, 终.type as to_type, 终.trust_state as to_trust,
             终.attrs as to_attrs,
             (count(*) over())::int as 总数
        from auth.case_relation r
        join auth.case_entity 起 on 起.project_id = r.project_id and 起.id = r.from_id
        join auth.case_entity 终 on 终.project_id = r.project_id and 终.id = r.to_id
       where r.project_id = ${input.projectId}
         and r.trust_state <> '已排除'
         and 起.trust_state <> '已排除' and 终.trust_state <> '已排除'
         and (r.from_id in (${节点表}) or r.to_id in (${节点表}))
         ${类型条件.length === 0 ? sql`` : sql`and ${sql.join(类型条件, sql` and `)}`}
       order by coalesce(r.times, 0) desc, coalesce(r.last_at, r.first_at, 0) desc, r.id collate "C" asc
       limit ${input.剩余 + 1}
    `),
  )
  return {
    边们: 行们.map((行) => ({
      id: String(行.id),
      from_id: String(行.from_id),
      to_id: String(行.to_id),
      type: String(行.type),
      times: 行.times as number | null,
      amount: (行.amount as string | null) ?? null,
      trust_state: String(行.trust_state),
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

/**
 * 以 `id` 为中心取 1～2 跳的关系图。
 *
 * 中心实体不存在 / 已排除 / 不属于本项目时返回 `undefined`（让路由回 404，而不是
 * 回一张空的图——空图会被界面读成「这人没有关联」，与「查不到这人」是两回事）。
 */
export async function 关系图(db: Queryable, input: 关系图入参): Promise<关系图结果 | undefined> {
  const 上限 = Math.min(Math.max(1, Math.trunc(input.上限 ?? 默认节点上限)), 默认节点上限)
  const 跳数 = input.跳数 ?? 1

  const 中心行们 = rowsOf(
    await db.execute(sql`
      select id, type, canonical_value, attrs, trust_state
        from auth.case_entity
       where project_id = ${input.projectId} and id = ${input.id} and trust_state <> '已排除'
    `),
  )
  if (中心行们.length === 0) return undefined
  const 中心 = 中心行们[0]

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
  })

  /**
   * 把一圈边收进图里；返回这一圈里**新出现的对方节点 id**（供下一跳用）。
   *
   * 容量由**调用点**保证：每圈只 `slice` 到剩余名额条，而每条边必有一端已在图里
   * （`节点们` 都来自图内）、最多带 1 个新节点，所以节点数不会越过上限。这里不再留
   * 兜底的截断分支——它在本轮改动后不可达，留着只会多出一种近似文案；真被截断的条数
   * 由调用点用 `count(*) over()` 的 `总数` 写进缺口。
   */
  const 收一圈 = (边们: readonly 边行[]): string[] => {
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
      })
      for (const [id, 值, 类型, 信任态, 属性] of [
        [边.from_id, 边.from_value, 边.from_type, 边.from_trust, 边.from_attrs] as const,
        [边.to_id, 边.to_value, 边.to_type, 边.to_trust, 边.to_attrs] as const,
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
  })
  const 一跳点 = 收一圈(第一圈.边们.slice(0, 可用))
  const 第一跳截断 = 第一圈.总数 > 可用
  if (可用 === 0) {
    // 一个邻居都放不下（上限 1）：只要库里还有边，就必须说出来，不能返回一张「干净的」空图。
    if (第一圈.总数 > 0) 缺口.push(`节点已达上限 ${上限}，第 1 跳的关联关系未画`)
  } else if (第一跳截断) {
    缺口.push(`第 1 跳只画了前 ${节点表.size} 个节点，共 ${第一圈.总数} 条关联关系`)
  }

  if (跳数 === 2) {
    const 剩余 = 上限 - 节点表.size
    if (剩余 <= 0) {
      // 第 1 跳真被截断时上面那句已经说清「还有没画的」，不再补一句近似的；
      // 恰好装满（库里也没有更多）才说「未展开」——我们确实没展开。
      if (!第一跳截断) 缺口.push(`节点已达上限 ${上限}，未展开第 2 跳`)
    } else {
      const 第二圈 = await 取一圈(db, {
        projectId: input.projectId,
        节点们: 一跳点,
        类型: input.类型,
        剩余,
      })
      收一圈(第二圈.边们.slice(0, 剩余))
      // 不声称「画了多少」：`slice` 行数里可能混着第 1 跳已画过的回边（`收一圈` 会跳过）。
      // 只陈述「候选里还有多少没画」——M 是 pre-LIMIT 的候选总数减「剩余」名额。
      if (第二圈.总数 > 剩余) 缺口.push(`第 2 跳还有 ${第二圈.总数 - 剩余} 条候选关系没有画（节点上限 ${上限}）`)
    }
  }

  // 跳数按**实际画出来的最短距离**回填：第二圈里连到中心节点的边不该把中心改成 1 跳。
  const 邻居 = new Set(一跳点)
  for (const 点 of 节点表.values()) {
    if (点.中心) continue
    点.跳数 = 邻居.has(点.id) ? 1 : 2
  }
  // 关联数按**图里画出来的边**数（不是库里的总数）——它要解释「屏幕上这几条」。
  // `new Set`：自环（from = to）是一条边，不能给同一个节点加两次。
  for (const 边 of 边表.values()) {
    for (const id of new Set([边.from, 边.to])) {
      const 点 = 节点表.get(id)
      if (点) 点.关联数 += 1
    }
  }

  return { 节点: [...节点表.values()], 边: [...边表.values()], 缺口 }
}
