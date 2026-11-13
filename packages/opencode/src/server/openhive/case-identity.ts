export * as OpenhiveCaseIdentity from "./case-identity"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 文本数组 } from "./case-fact-store"
import { 户名来源 } from "./case-party"
import type { Queryable } from "./case-store"

/**
 * 身份三档（设计 §3.8.4）：任何涉及「人」的查询结果必须落在
 * 已核实 / 户名匹配 / 无匹配 之一。
 *
 * 判据是**证据**，不是名字像不像：
 * - 已核实   = 有一条未排除的 `实名登记` 边把实体焊到人上（M3）；
 * - 户名匹配 = 没有实名登记边，只有名字（账户上未撤销的 `kind='户名'` 别名；
 *              或「人」实体本身——笔录抽出的「人」实体就是一个名字）；
 * - 无匹配   = 连名字证据都没有，只能明说「查不到归属」。
 *
 * 不做姓名相似匹配（§3.8.3）：同名多账户由解析层 fail-closed，不在这里挑一个。
 */
export const 身份档们 = ["已核实", "户名匹配", "无匹配"] as const
export type 身份档 = (typeof 身份档们)[number]

export interface 身份判读 {
  readonly 档: 身份档
  /** 人话，含判据与查到了什么；户名匹配档必须含「未核实身份」字样。 */
  readonly 说明: string
  /**
   * 「疑似换主」短句（A6）。只在**已核实**档上出现：档本身仍是「有实名登记证据」，
   * 这句说明这些证据分属不同时段、不能认定当前归属。`身份后缀` 会把它带进摘要。
   */
  readonly 提示?: string
}

export interface 身份标注 extends 身份判读 {
  /** 被标注实体的规范值（展示行）。 */
  readonly 实体: string
}

export interface 身份证据 {
  /** 取值必须是 case-extract.ts 的 实体类型们 原值（"人" / "账户" / "号码" / ...）；"账户" 的字面量比较依赖它。 */
  readonly 类型: string
  readonly 值: string
  /** 该实体上未撤销的 `kind='户名'` 别名值（账户才有）。 */
  readonly 户名们: readonly string[]
  /**
   * 经未排除的 `实名登记` 边连到的「人」的规范值。
   * 实体自己是「人」且有边时，人证就是它自己（说明里不重复点名）。
   */
  readonly 人证们: readonly string[]
  /**
   * 同一条边的带窗版本（`case_relation.first_at` / `last_at`）。A6 换主判定只用它；
   * 缺省 = 不知道时间 ⇒ 不判换主（fail-closed）。
   */
  readonly 人证窗们?: readonly 人证窗[]
}

/** 一条实名登记边的人证 + 时间窗（秒；缺边上的时间就是 null）。 */
export interface 人证窗 {
  readonly 值: string
  readonly 起: number | null
  readonly 止: number | null
}

/**
 * A6「疑似换主」的间隔阈值：90 天。
 * 取自调研结论 `五个待定问题的调研结论.md:194`「两次出现之间超过阈值（建议先取 90 天）」。
 * 先写成代码常量：没有运行期调整的需求就不往 env / 库里加面。
 */
const 换主间隔秒 = 90 * 24 * 60 * 60

/** 三档的读侧口径，五个工具共用一份（`#002-06`：同一前提不两处各写）。 */
export const 身份口径 =
  "涉及人的结果按身份三档（已核实 / 户名匹配 / 无匹配）标注：已核实=有未排除的实名登记证据；" +
  "户名匹配=只有名字、未核实身份；无匹配=查不到归属。户名匹配与无匹配不得当作本人。" +
  "同一号码或账户上有多人实名登记、且时间窗不重叠且间隔超过 90 天时，会提示「疑似换主」，不认定当前归属。"

const 最多列人 = 3

function 列人证(人证们: readonly string[]): string {
  const 前 = 人证们.slice(0, 最多列人)
  return 人证们.length > 最多列人 ? `${前.join("、")} 等 ${人证们.length} 人` : 前.join("、")
}

function 日期(秒: number): string {
  return new Date(秒 * 1000).toISOString().slice(0, 10)
}

interface 人窗 {
  readonly 值: string
  readonly 起: number
  readonly 止: number
}

/**
 * A6：同一实体上多人实名登记、且两人时间窗**不重叠**、间隔超过阈值 ⇒ 疑似换主。
 *
 * 口径（`#002-06`：判据只在这里写一次）：
 * - 只在同一实体上比**不同的人**；同一人的多条边先取并集（他/她自己的归属区间）。
 * - 任一条边缺 `first_at` / `last_at` ⇒ 这个人不参与（宁可不提示，不猜）。
 * - 窗口相接（`前.止 === 后.起`）算重叠，不算换主。
 * - 多对都成立时取间隔最大的一对写进说明。
 */
function 换主判读(窗们: readonly 人证窗[]): { 说明: string; 提示: string } | undefined {
  const 按人 = new Map<string, { 起: number; 止: number }>()
  for (const 窗 of 窗们) {
    if (窗.起 === null || 窗.止 === null) continue
    const 现 = 按人.get(窗.值)
    if (现 === undefined) 按人.set(窗.值, { 起: 窗.起, 止: 窗.止 })
    else 按人.set(窗.值, { 起: Math.min(现.起, 窗.起), 止: Math.max(现.止, 窗.止) })
  }
  if (按人.size < 2) return undefined

  const 人列: 人窗[] = [...按人.entries()]
    .map(([值, 窗]) => ({ 值, 起: 窗.起, 止: 窗.止 }))
    .sort((左, 右) => 左.起 - 右.起 || (左.值 < 右.值 ? -1 : 左.值 > 右.值 ? 1 : 0))

  let 最佳: { 前: 人窗; 后: 人窗; 间: number } | undefined
  for (let i = 0; i < 人列.length; i += 1) {
    for (let j = i + 1; j < 人列.length; j += 1) {
      const 前 = 人列[i]
      const 后 = 人列[j]
      if (前.止 >= 后.起) continue
      const 间 = 后.起 - 前.止
      if (间 <= 换主间隔秒) continue
      if (最佳 === undefined || 间 > 最佳.间) 最佳 = { 前, 后, 间 }
    }
  }
  if (最佳 === undefined) return undefined

  const 相隔天 = Math.round(最佳.间 / (24 * 60 * 60))
  return {
    说明:
      `疑似换主：${最佳.前.值}（${日期(最佳.前.起)} ~ ${日期(最佳.前.止)}）→ ` +
      `${最佳.后.值}（${日期(最佳.后.起)} ~ ${日期(最佳.后.止)}），相隔 ${相隔天} 天，不能认定当前归属`,
    提示: `疑似换主：${最佳.前.值} → ${最佳.后.值}`,
  }
}

export function 判定身份(证据: 身份证据): 身份判读 {
  if (证据.人证们.length > 0) {
    if (证据.类型 === "人")
      return { 档: "已核实", 说明: `已核实：「${证据.值}」已有实名登记证据，身份链完整` }
    const 换主 = 换主判读(证据.人证窗们 ?? [])
    return {
      档: "已核实",
      说明:
        `已核实：该${证据.类型}经「实名登记」证据关联到人：${列人证(证据.人证们)}` +
        (换主 === undefined ? "" : `；${换主.说明}`),
      ...(换主 === undefined ? {} : { 提示: 换主.提示 }),
    }
  }
  if (证据.类型 === "人")
    return {
      档: "户名匹配",
      说明: `只知道姓名「${证据.值}」，没有身份证号或实名登记证据，未核实身份`,
    }
  if (证据.类型 === "账户" && 证据.户名们.length > 0)
    return {
      档: "户名匹配",
      说明:
        `户名匹配，未核实身份：该账户登记在「${证据.户名们.join("、")}」名下，` +
        "但没有身份证号等实名登记证据，不能当作本人",
    }
  return {
    档: "无匹配",
    说明:
      证据.类型 === "账户"
        ? "查不到归属：该账户没有任何户名或实名登记证据，不能断定是谁的"
        : `查不到归属：该${证据.类型}没有任何户名或实名登记证据`,
  }
}

/** 查询主体的人话称呼：按户名解析到时写「户名为「X」的账户」（A11）。 */
export function 实体称呼(解析: { readonly 命中: "id" | "规范值" | "户名" }, 输入: string): string {
  return 解析.命中 === "户名" ? `户名为「${输入}」的账户` : `「${输入}」`
}

/**
 * 摘要末尾的身份后缀：已核实不打扰；另两档必须显著（§3.8.4）。
 * 多实体时带实体名，避免「甲是哪一档、乙是哪一档」说不清。
 */
export function 身份后缀(标注s: readonly 身份标注[]): string {
  // 已核实档默认不打扰，但「疑似换主」必须带进摘要——否则只看摘要的人会以为归属已定。
  const 要带 = 标注s.filter((a) => a.档 !== "已核实" || a.提示 !== undefined)
  if (要带.length === 0) return ""
  const 逐 = 要带.map((a) => {
    if (a.提示 !== undefined) return 标注s.length > 1 ? `${a.实体}：${a.提示}` : a.提示
    const 档词 = a.档 === "户名匹配" ? "户名匹配，未核实身份" : "查不到归属，未核实身份"
    return 标注s.length > 1 ? `${a.实体}：${档词}` : 档词
  })
  return `（${逐.join("；")}）`
}

export interface 待标注实体 {
  readonly id: string
  readonly 类型: string
  readonly 值: string
}

/**
 * 批量读三档证据：**两条 SQL**（实名登记边 + 未撤销户名），与实体数无关。
 *
 * 证据的资格同一条口径：关系本身、两端实体、别名所属实体都不能是「已排除」
 * （§9.1：被排除的东西不该继续提供身份背书）。只认「一端是人、另一端不是人」的边：
 * 两端同型是脏数据，不作为身份证据。
 */
export async function 读身份标注(
  db: Queryable,
  projectId: string,
  实体们: readonly 待标注实体[],
): Promise<Map<string, 身份标注>> {
  const 结果 = new Map<string, 身份标注>()
  if (实体们.length === 0) return 结果
  const id们 = [...new Set(实体们.map((e) => e.id))]
  const id集 = new Set(id们)

  const 边们 = rowsOf(
    await db.execute(sql`
      select r.from_id, r.to_id, r.first_at, r.last_at,
             f.type as from_type, f.canonical_value as from_value,
             t.type as to_type, t.canonical_value as to_value
        from auth.case_relation r
        join auth.case_entity f on f.project_id = r.project_id and f.id = r.from_id
        join auth.case_entity t on t.project_id = r.project_id and t.id = r.to_id
       where r.project_id = ${projectId}
         and r.type = '实名登记'
         and r.trust_state <> '已排除'
         and f.trust_state <> '已排除' and t.trust_state <> '已排除'
         and (r.from_id = any(${文本数组(id们)}) or r.to_id = any(${文本数组(id们)}))
       order by f.canonical_value asc, f.id asc, t.canonical_value asc, t.id asc, r.id asc
    `),
  )

  const 人证按 = new Map<string, string[]>()
  const 窗按 = new Map<string, 人证窗[]>()
  const 加人证 = (id: string, 人: string, 起: number | null, 止: number | null) => {
    const 列 = 人证按.get(id)
    if (列 === undefined) 人证按.set(id, [人])
    else if (!列.includes(人)) 列.push(人)
    const 窗 = { 值: 人, 起, 止 }
    const 窗列 = 窗按.get(id)
    if (窗列 === undefined) 窗按.set(id, [窗])
    else if (!窗列.some((条) => 条.值 === 人 && 条.起 === 起 && 条.止 === 止)) 窗列.push(窗)
  }
  const 秒 = (值: unknown): number | null => (值 === null || 值 === undefined ? null : Number(值))
  for (const 行 of 边们) {
    const fromId = String(行.from_id)
    const toId = String(行.to_id)
    const fromType = String(行.from_type)
    const toType = String(行.to_type)
    const 起 = 秒(行.first_at)
    const 止 = 秒(行.last_at)
    if (fromType === "人" && toType !== "人") {
      if (id集.has(fromId)) 加人证(fromId, String(行.from_value), 起, 止)
      if (id集.has(toId)) 加人证(toId, String(行.from_value), 起, 止)
    } else if (toType === "人" && fromType !== "人") {
      if (id集.has(fromId)) 加人证(fromId, String(行.to_value), 起, 止)
      if (id集.has(toId)) 加人证(toId, String(行.to_value), 起, 止)
    }
  }

  // 户名前提与端点对齐共用 `户名来源`（#002-06）：未撤销 + 未排除只在这里定义一次。
  const 别名们 = rowsOf(
    await db.execute(sql`
      select a.entity_id, a.value
        from ${户名来源(projectId)}
         and a.entity_id = any(${文本数组(id们)})
       order by a.entity_id asc, a.created_at asc, a.id asc
    `),
  )
  const 户名按 = new Map<string, string[]>()
  for (const 行 of 别名们) {
    const id = String(行.entity_id)
    const 值 = String(行.value)
    const 列 = 户名按.get(id)
    if (列 === undefined) 户名按.set(id, [值])
    else if (!列.includes(值)) 列.push(值)
  }

  for (const e of 实体们) {
    if (结果.has(e.id)) continue
    结果.set(e.id, {
      实体: e.值,
      ...判定身份({
        类型: e.类型,
        值: e.值,
        户名们: 户名按.get(e.id) ?? [],
        人证们: 人证按.get(e.id) ?? [],
        人证窗们: 窗按.get(e.id) ?? [],
      }),
    })
  }
  return 结果
}
