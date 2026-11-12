export * as OpenhiveCaseIdentity from "./case-identity"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 文本数组 } from "./case-fact-store"
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
}

/** 三档的读侧口径，五个工具共用一份（`#002-06`：同一前提不两处各写）。 */
export const 身份口径 =
  "涉及人的结果按身份三档（已核实 / 户名匹配 / 无匹配）标注：已核实=有未排除的实名登记证据；" +
  "户名匹配=只有名字、未核实身份；无匹配=查不到归属。户名匹配与无匹配不得当作本人。"

const 最多列人 = 3

function 列人证(人证们: readonly string[]): string {
  const 前 = 人证们.slice(0, 最多列人)
  return 人证们.length > 最多列人 ? `${前.join("、")} 等 ${人证们.length} 人` : 前.join("、")
}

export function 判定身份(证据: 身份证据): 身份判读 {
  if (证据.人证们.length > 0) {
    if (证据.类型 === "人")
      return { 档: "已核实", 说明: `已核实：「${证据.值}」已有实名登记证据，身份链完整` }
    return {
      档: "已核实",
      说明: `已核实：该${证据.类型}经「实名登记」证据关联到人：${列人证(证据.人证们)}`,
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
  const 未核实 = 标注s.filter((a) => a.档 !== "已核实")
  if (未核实.length === 0) return ""
  const 逐 = 未核实.map((a) => {
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
      select r.from_id, r.to_id,
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
  const 加人证 = (id: string, 人: string) => {
    const 列 = 人证按.get(id)
    if (列 === undefined) 人证按.set(id, [人])
    else if (!列.includes(人)) 列.push(人)
  }
  for (const 行 of 边们) {
    const fromId = String(行.from_id)
    const toId = String(行.to_id)
    const fromType = String(行.from_type)
    const toType = String(行.to_type)
    if (fromType === "人" && toType !== "人") {
      if (id集.has(fromId)) 加人证(fromId, String(行.from_value))
      if (id集.has(toId)) 加人证(toId, String(行.from_value))
    } else if (toType === "人" && fromType !== "人") {
      if (id集.has(fromId)) 加人证(fromId, String(行.to_value))
      if (id集.has(toId)) 加人证(toId, String(行.to_value))
    }
  }

  const 别名们 = rowsOf(
    await db.execute(sql`
      select a.entity_id, a.value
        from auth.case_entity_alias a
        join auth.case_entity e on e.project_id = a.project_id and e.id = a.entity_id
       where a.project_id = ${projectId} and a.kind = '户名' and a.revoked_at is null
         and e.trust_state <> '已排除'
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
      }),
    })
  }
  return 结果
}
