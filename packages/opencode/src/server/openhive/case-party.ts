export * as OpenhiveCaseParty from "./case-party"

import { sql, type SQL } from "drizzle-orm"

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
