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
 * ## §9.1 / R10：已排除事实默认不出现
 *
 * 与 `实体档案` 同口径：`includeExcluded: true` 才切换查看。默认过滤条件是
 * 实体 / 事件自身非「已排除」，关系既要自身非「已排除」、也要**两端实体**都非「已排除」
 * （材料视图没有「我方实体」，任一端被排除都不展示这条关系）。悬空引用（事实行不存在）
 * 不算「已排除」——它没有可判定的状态，仍按 `fact_id` 回落列出。
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
  input: {
    readonly projectId: string
    readonly path: string
    /** 默认 `false`：已排除的事实「可切换查看」，不是默认可见（§9.1 / R10）。 */
    readonly includeExcluded?: boolean
  },
): Promise<材料事实清单结果 | undefined> {
  const 含排除 = input.includeExcluded === true
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
  // 排序交给 JS：SQL 没有 limit，前三键不影响「留下哪些行」；且 `->>'row'` 在
  // `{"row":"第2行"}` 这类形状上会 `22P02` 整块 500，与 `解定位` 的 fail-soft 打架。
  const 引用行们 = rowsOf(
    await db.execute(sql`
      select c.id, c.fact_type, c.fact_id, c.locator,
             coalesce(case when c.fact_type = 'entity' then 实体.canonical_value end, '') as 实体值,
             coalesce(case when c.fact_type = 'relation' then
               关系起.canonical_value || ' → ' || 关系终.canonical_value || ' · ' || 关系.type
             end, '') as 关系值,
             coalesce(case when c.fact_type = 'event' then 事件.summary end, '') as 事件值,
             case c.fact_type
               when 'entity' then 实体.trust_state
               when 'relation' then 关系.trust_state
               when 'event' then 事件.trust_state
               else null
             end as trust_state
        from auth.case_citation c
        left join auth.case_entity 实体
          on 实体.project_id = c.project_id and c.fact_type = 'entity' and 实体.id = c.fact_id
        left join auth.case_event 事件
          on 事件.project_id = c.project_id and c.fact_type = 'event' and 事件.id = c.fact_id
        left join auth.case_relation 关系
          on 关系.project_id = c.project_id and c.fact_type = 'relation' and 关系.id = c.fact_id
        left join auth.case_entity 关系起
          on 关系起.project_id = 关系.project_id and 关系起.id = 关系.from_id
        left join auth.case_entity 关系终
          on 关系终.project_id = 关系.project_id and 关系终.id = 关系.to_id
       where c.project_id = ${input.projectId} and c.material_id = ${String(材料.id)}
       ${含排除 ? sql`` : sql`
         and coalesce(case c.fact_type
               when 'entity' then 实体.trust_state
               when 'relation' then 关系.trust_state
               when 'event' then 事件.trust_state
             end, '') <> '已排除'
         and not (c.fact_type = 'relation'
                  and (coalesce(关系起.trust_state = '已排除', false)
                       or coalesce(关系终.trust_state = '已排除', false)))`}
       order by c.id asc
    `),
  )

  const 表 = new Map<string, Map<number, 事实行[]>>()
  let 未定位 = 0
  for (const 行 of 引用行们) {
    const 定位 = 解定位(行.locator)
    if (定位 === undefined) {
      // 不静默吞：`{start,end}`（笔录）、`{page,para}`、坏 JSON 都计数，收进缺口。
      未定位++
      continue
    }
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

  // 过滤下沉到 SQL 后，「空结果」本身分不清「本来就没有引用」与「引用的事实全被排除」。
  // 默认调用下空结果时再数一次过滤前的引用条数；空态文案必须如实，不能把已排除说成没解析。
  let 过滤前有条 = 引用行们.length > 0
  if (!含排除 && !过滤前有条) {
    const 计数行们 = rowsOf(
      await db.execute(sql`
        select count(*)::int as 条数
          from auth.case_citation
         where project_id = ${input.projectId} and material_id = ${String(材料.id)}
      `),
    )
    过滤前有条 = Number(计数行们[0]?.条数 ?? 0) > 0
  }

  const 缺口: string[] = []
  if (引用行们.length === 0) {
    缺口.push(
      过滤前有条
        ? "没有可见引用：可能还没解析，或引用的事实均已排除"
        : "这份材料没有引用：可能还没解析，或解析没有抽出事实",
    )
  } else if (未定位 > 0) 缺口.push(`${未定位} 条引用的定位不是「工作表 / 行」，未列出`)
  const 分组 = [...表.entries()]
    // 不用 `localeCompare`：它的默认排序随系统 locale 变（本机 zh-CN 把汉字排在拉丁字母前，
    // en-US 则相反）⇒ 同一份数据在不同机器上分组顺序不同、测试也跟着红绿摇摆。
    // 这里按码位定序，跨平台稳定；语义仍是「按 sheet 名排序」。中文表名按码位序排列，
    // 若要还原工作簿原始顺序，得由解析侧把 sheet 序号一并带出来。
    .sort((甲, 乙) => (甲[0] < 乙[0] ? -1 : 甲[0] > 乙[0] ? 1 : 0))
    .map(([sheet, 行表]) => {
      const 行们 = [...行表.entries()].sort((甲, 乙) => 甲[0] - 乙[0])
      const 丢 = 行们.length - 每组行上限
      if (丢 > 0) 缺口.push(`${sheet} 本表只显示前 ${每组行上限} 行，另有 ${丢} 行未列出`)
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
