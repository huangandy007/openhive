import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { Queryable } from "./case-store"

/**
 * 材料事实清单（计划 7 中栏 / 左栏 drill-down）：这份材料引出了哪些实体 / 关系 / 事件。
 *
 * ## 行级定位只认 `citation.locator`，绝不拆 `fact_id`
 *
 * `citation.fact_id` 是不透明键：`fact_type = row` 时它形如
 * `<material_id>#<sheet>#<row_no>`，而**工作表名本身可以含 `#`**（计划 6 缺口表已记）。
 * 按 `#` 拆会在这种表上把 sheet / row 拆错。所以分组只用 `locator` 的 `sheet`/`row`；
 * `fact_id` 原样回传。
 *
 * ## 事实值取不到就写 id，不编
 *
 * 实体取 `canonical_value`，关系拼两端规范值与类型，事件取 `summary`；引用悬空
 * （事实行被删）时回落成 `fact_id`。
 *
 * ## 「最新一行」口径与 `getMaterialByPath` 逐字相同
 *
 * `created_at desc, id desc`：同一路径改过内容会另建一行（幂等键是内容指纹，不是路径），
 * 界面认最新那行。
 */

export interface 事实行 {
  readonly fact_type: "entity" | "relation" | "event" | "row"
  readonly fact_id: string
  /** 给人看的一句话；取不到就写 id（不要编）。 */
  readonly 值: string
  readonly trust_state: string | null
}

export interface 事实组 {
  readonly sheet: string
  readonly 行们: readonly { readonly row_no: number; readonly 事实们: readonly 事实行[] }[]
}

export interface 材料事实清单结果 {
  readonly 材料: {
    readonly id: string
    readonly path: string
    readonly file_name: string
    readonly kind: string
    readonly parse_status: string
    readonly parse_detail: unknown
  }
  readonly 分组: readonly 事实组[]
  readonly 缺口: string[]
}

/** 每组（sheet）最多回多少行；超了写缺口。 */
export const 每组行上限 = 500

export async function 材料事实清单(
  db: Queryable,
  input: { readonly projectId: string; readonly path: string },
): Promise<材料事实清单结果 | undefined> {
  const 材料行们 = rowsOf(
    await db.execute(sql`
      select id, path, file_name, kind, parse_status, parse_detail
        from auth.case_material
       where project_id = ${input.projectId} and path = ${input.path}
       order by created_at desc, id desc
       limit 1
    `),
  )
  if (材料行们.length === 0) return undefined
  const 材料 = 材料行们[0]!

  // 定位只认 locator；fact_id 原样回传，不当定位键（工作表名可含 `#`）。
  const 引用行们 = rowsOf(
    await db.execute(sql`
      select c.id, c.fact_type, c.fact_id, c.locator,
             coalesce(case when c.fact_type = 'entity' then 实体.canonical_value end, '') as 实体值,
             coalesce(case when c.fact_type = 'relation' then
               (select 起.canonical_value || ' → ' || 终.canonical_value || ' · ' || 关系.type
                  from auth.case_relation 关系
                  join auth.case_entity 起 on 起.project_id = 关系.project_id and 起.id = 关系.from_id
                  join auth.case_entity 终 on 终.project_id = 关系.project_id and 终.id = 关系.to_id
                 where 关系.project_id = c.project_id and 关系.id = c.fact_id)
             end, '') as 关系值,
             coalesce(case when c.fact_type = 'event' then 事件.summary end, '') as 事件值,
             case c.fact_type
               when 'entity' then 实体.trust_state
               when 'relation' then (select trust_state from auth.case_relation where project_id = c.project_id and id = c.fact_id)
               when 'event' then 事件.trust_state
               else null
             end as trust_state
        from auth.case_citation c
        left join auth.case_entity 实体
          on 实体.project_id = c.project_id and c.fact_type = 'entity' and 实体.id = c.fact_id
        left join auth.case_event 事件
          on 事件.project_id = c.project_id and c.fact_type = 'event' and 事件.id = c.fact_id
       where c.project_id = ${input.projectId} and c.material_id = ${String(材料.id)}
       order by c.locator->>'sheet' asc, (c.locator->>'row')::int asc, c.id asc
    `),
  )

  const 表 = new Map<string, Map<number, 事实行[]>>()
  for (const 行 of 引用行们) {
    const 定位 = 解定位(行.locator)
    if (定位 === undefined) continue
    const 组 = 表.get(定位.sheet) ?? new Map<number, 事实行[]>()
    表.set(定位.sheet, 组)
    const 行们 = 组.get(定位.row) ?? []
    组.set(定位.row, 行们)
    行们.push({
      fact_type: String(行.fact_type) as 事实行["fact_type"],
      fact_id: String(行.fact_id),
      值: String(行.实体值 || 行.关系值 || 行.事件值 || 行.fact_id),
      trust_state: (行.trust_state as string | null) ?? null,
    })
  }

  const 缺口: string[] = []
  if (引用行们.length === 0) 缺口.push("这份材料没有引用：可能还没解析，或解析没有抽出事实")
  const 分组 = [...表.entries()]
    // 不用 `localeCompare`：它的默认排序随系统 locale 变（本机 zh-CN 把汉字排在拉丁字母前，
    // en-US 则相反）⇒ 同一份数据在不同机器上分组顺序不同、测试也跟着红绿摇摆。
    // 这里按码位定序，跨平台稳定；语义仍是「按 sheet 名排序」。
    .sort((甲, 乙) => (甲[0] < 乙[0] ? -1 : 甲[0] > 乙[0] ? 1 : 0))
    .map(([sheet, 行表]) => {
      const 行们 = [...行表.entries()].sort((甲, 乙) => 甲[0] - 乙[0])
      if (行们.length > 每组行上限) 缺口.push(`${sheet} 超过 ${每组行上限} 行，已截断`)
      return { sheet, 行们: 行们.slice(0, 每组行上限).map(([row_no, 事实们]) => ({ row_no, 事实们 })) }
    })

  return {
    材料: {
      id: String(材料.id),
      path: String(材料.path),
      file_name: String(材料.file_name),
      kind: String(材料.kind),
      parse_status: String(材料.parse_status),
      parse_detail: 解JSON(材料.parse_detail),
    },
    分组,
    缺口,
  }
}

/** locator 是 jsonb：可能是对象（驱动已解析），也可能是字符串（旧行 / 某些驱动）。 */
function 解定位(值: unknown): { sheet: string; row: number } | undefined {
  const 对象 = typeof 值 === "string" ? 安全解析(值) : 值
  if (typeof 对象 !== "object" || 对象 === null) return undefined
  const sheet = (对象 as Record<string, unknown>)["sheet"]
  const row = (对象 as Record<string, unknown>)["row"]
  if (typeof sheet !== "string" || typeof row !== "number" || !Number.isInteger(row)) return undefined
  return { sheet, row }
}

/** jsonb 的两路收法：字符串就解析，驱动已解析就原样返回（`parse_detail` 同款）。 */
function 解JSON(值: unknown): unknown {
  return typeof 值 === "string" ? 安全解析(值) : 值
}

function 安全解析(文本: string): unknown {
  try {
    return JSON.parse(文本) as unknown
  } catch {
    return undefined
  }
}
