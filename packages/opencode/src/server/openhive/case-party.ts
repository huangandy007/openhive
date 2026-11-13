export * as OpenhiveCaseParty from "./case-party"

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { Queryable } from "./case-store"

/**
 * 「同一方代表」（10 §3.1）。
 *
 * 人 ↔ 账户在库里是两行实体；笔录写人、流水写账户。对齐证据只有一条：账户上未撤销的
 * `kind='户名'` 别名，且别名值 = 人的规范值。**唯一**候选才对齐；0 个或 ≥2 个一律
 * 不对齐（fail-closed，宁可分开也不错误合并；候选数由读端写进缺口）。
 *
 * `户名来源` 是「未撤销户名 + 未排除实体」这条前提的**唯一出处**（`#002-06`）：
 * `case-identity.ts` 的 `读身份标注`、`case-mcp-tools.ts` 的 `解析户名` 与这里的 `户名对齐`
 * 都从它出发，谁都不许再抄一份 `a.kind='户名' and a.revoked_at is null ...`。
 *
 * ⚠️ 调用约定：`户名来源` 已经以 `where` 结尾，追加条件只能写 `and ...`；别名固定为
 * `a`（别名表）与 `ae`（别名所属实体），不要在调用点再声明同名表。
 */
export function 户名来源(projectId: string): SQL {
  return sql`auth.case_entity_alias a
    join auth.case_entity ae on ae.project_id = a.project_id and ae.id = a.entity_id
   where a.project_id = ${projectId} and a.kind = '户名' and a.revoked_at is null
     and ae.trust_state <> '已排除'`
}

/**
 * 对齐子查询（派生表）：`代表` = 唯一候选账户 id 或 null，`候选数` = 候选账户数。
 *
 * 只有「人」/「组织」才可能对齐；其他类型 `in ('人','组织')` 恒假 ⇒ 代表 null、
 * 候选 0，外层 `coalesce(代表, id)` 自然退回自己。
 *
 * `id` 只为调用点对称（与 `对齐代表` 同形）；本派生表只按 `值` 匹配，回落到自己由
 * `对齐代表` 的 `coalesce` 负责。
 *
 * 候选必须是**账户**（与 `解析户名` 同一过滤，`#002-06`）：别名若挂在非账户实体上，
 * 对齐会指向错误的实体，宁可 fail-closed 回落到自己。
 *
 * 聚合在零行上仍返回一行（count=0、代表 null），所以可以安全地当 lateral 表或标量子查询。
 */
export function 户名对齐(projectId: string, id: SQL, 类型: SQL, 值: SQL): SQL {
  return sql`(select case when count(distinct a.entity_id) = 1 then min(a.entity_id) end as 代表,
                     count(distinct a.entity_id)::int as 候选数
                from ${户名来源(projectId)}
                 and ${类型} in ('人', '组织')
                 and ae.type = '账户'
                 and a.value = ${值})`
}

/** 代表表达式：唯一候选账户，否则自己。 */
export function 对齐代表(projectId: string, id: SQL, 类型: SQL, 值: SQL): SQL {
  return sql`coalesce((select 代表 from ${户名对齐(projectId, id, 类型, 值)} 对齐), ${id})`
}

/**
 * `id in (...)` 片段：调用点把要匹配的列交进来，集合由本文件构造。
 *
 * ⚠️ 调用约定：调用方必须传**非空数组**——空数组会生成 `in ()`，PG 语法报错。
 */
function id集合(ids: readonly string[]): SQL {
  return sql`(${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`
}

/**
 * 反向对齐集（11 §3.1）：**唯一**户名对齐到这批账户的 人 / 组织 id。
 *
 * 与 `户名对齐` 对称、同样 fail-closed：人的规范值恰好只对应一个账户（别名候选数 = 1），
 * 且那个账户就在 `账户ids` 里，才算对齐。别名对应 0 个或多个账户一律不算。
 * 已排除的人不算——那是人的判断，读端不许把它拉回来。
 */
export function 对齐到账户(projectId: string, 账户ids: readonly string[]): SQL {
  return sql`(select pe.id
     from auth.case_entity pe
    where pe.project_id = ${projectId}
      and pe.type in ('人', '组织')
      and pe.trust_state <> '已排除'
      and (select count(distinct a.entity_id)
             from ${户名来源(projectId)}
              and ae.type = '账户'
              and a.value = pe.canonical_value) = 1
      and exists (select 1 from ${户名来源(projectId)}
                   and a.entity_id in ${id集合(账户ids)}
                   and a.value = pe.canonical_value))`
}

/**
 * 归属实体集：实体自己 ∪ 正向代表（人 → 唯一户名账户）∪ 反向对齐者（账户 → 唯一户名的
 * 人/组织）。**事件与值都从这一个集合出发**（`#002-06`）。
 */
export function 归属实体集(projectId: string, 实体id: string): SQL {
  const id = sql`${实体id}`
  const 类型 = sql`(select type from auth.case_entity where project_id = ${projectId} and id = ${id})`
  const 值 = sql`(select canonical_value from auth.case_entity where project_id = ${projectId} and id = ${id})`
  return sql`(select ${id}::text as id
              union
              select (${对齐代表(projectId, id, 类型, 值)}) as id
              union
              select id from ${对齐到账户(projectId, [实体id])} 反向)`
}

/**
 * 归属值集：归属实体集里每个实体的规范值 ∪ 别名（`case_entity.aliases`）。
 * `participants text[]` 存的是规范值（`01` §3.3）；合并 / 改名只把旧值并进别名、不改 text[]，
 * 所以旧事件靠这一路仍然命中。
 */
export function 归属值集(projectId: string, 实体id: string): SQL {
  return sql`(select x.canonical_value as 值
                from auth.case_entity x
               where x.project_id = ${projectId} and x.id in ${归属实体集(projectId, 实体id)}
              union
              select 别名
                from auth.case_entity x, unnest(x.aliases) as 别名
               where x.project_id = ${projectId} and x.id in ${归属实体集(projectId, 实体id)})`
}

/** `归属值集` 的 JS 版：给需要按值过滤（对手、方向）的读端用。 */
export async function 读归属值(db: Queryable, projectId: string, 实体id: string): Promise<string[]> {
  const 行们 = rowsOf(await db.execute(sql`select 值 from ${归属值集(projectId, 实体id)} 值们`))
  return 行们.map((行) => String(行.值))
}

/**
 * 基 2（11 §3.2）：账户归属集 = 账户自己的 ids ∪ 唯一户名对齐到它的人/组织。
 * 只由账户构造：人 / 组织查关系时仍用「端点等于自己」的原口径。
 */
export function 账户归属集(projectId: string, 账户ids: readonly string[]): SQL {
  return sql`(select id from auth.case_entity
               where project_id = ${projectId} and id in ${id集合(账户ids)}
              union
              select id from ${对齐到账户(projectId, 账户ids)} 反向)`
}

/**
 * 关系归属某账户 ⇔ **恰好一端**落在归属集里（XOR，不是 `OR`）。
 *
 * 两端都落在集合里 = 账户内部往来（如「李四 → B」）：它在账户视角下会变成一个自环，
 * 既不产生对手方也不产生方向 ⇒ 不归属、不画、不计数，条数进缺口。
 */
export function 关系归属条件(
  projectId: string,
  账户ids: readonly string[],
  从: SQL,
  到: SQL,
): SQL {
  const 集 = 账户归属集(projectId, 账户ids)
  return sql`((${从} in ${集}) <> (${到} in ${集}))`
}

/**
 * 基 1（11 §3.1）：事件是否归属该实体。
 *
 * - 参与者表：`p.entity_id` ∈ 归属实体集（本人 / 正向代表 / 反向对齐者）；
 * - 文本回退：`participants` 的规范值 ∈ 归属值集（旧数据、对不上档案的参与者走这一路）。
 *
 * ⚠️ 只在 `from auth.case_event`（未起别名）的查询里用：片段裸引 `case_event.id` 与
 * `participants`。
 */
export function 事件归属条件(projectId: string, 实体id: string): SQL {
  return sql`(exists (select 1 from auth.case_event_participant p
                        where p.project_id = ${projectId}
                          and p.event_id = case_event.id
                          and p.entity_id in ${归属实体集(projectId, 实体id)})
           or exists (select 1 from unnest(participants) as 参与者
                       where 参与者 in ${归属值集(projectId, 实体id)}))`
}
