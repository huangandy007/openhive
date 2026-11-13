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
export function 户名来源(projectId: string | SQL): SQL {
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
export function 户名对齐(projectId: string | SQL, id: SQL, 类型: SQL, 值: SQL): SQL {
  return sql`(select case when count(distinct a.entity_id) = 1 then min(a.entity_id) end as 代表,
                     count(distinct a.entity_id)::int as 候选数
                from ${户名来源(projectId)}
                 and ${类型} in ('人', '组织')
                 and ae.type = '账户'
                 and a.value = ${值})`
}

/** 代表表达式：唯一候选账户，否则自己。 */
export function 对齐代表(projectId: string | SQL, id: SQL, 类型: SQL, 值: SQL): SQL {
  return sql`coalesce((select 代表 from ${户名对齐(projectId, id, 类型, 值)} 对齐), ${id})`
}

/**
 * 账户在关系视图里的展示名（10 §3.1「显示优先用户名」）。
 *
 * `户名来源` 的别名方向是 **entity_id = 账户、value = 人名**，所以反查要按 `value` 匹配
 * 人名实体（`p.canonical_value = a.value`），不能 `p.id = a.entity_id`——那拿到的是账户自己。
 * 与 `户名对齐` 对称、同样 fail-closed：人名候选恰好 1 个才认（`候选数` = 人名种数），
 * 0 个或 ≥2 个时三个代表列为 null，调用点回落到账户本身。守卫在**函数内**（同 `户名对齐`），
 * 调用点直接读 `代表值` / `代表类型` / `代表attrs` 即可——忘套 `case when` 也错不了（缺口 #16）。
 *
 * 返回 lateral 派生表（零行也回一行）：`代表值` / `代表类型` / `代表attrs` / `候选数`。
 * `aggregate_money` 的对手方与 `关系圈` 的对方展示共用这一份（`#002-06`）——两处各写一遍
 * 迟早漂成「汇总显示李四、圈里显示账号」。
 */
export function 账户展示名(projectId: string, 账户id: SQL): SQL {
  // `户名来源` 已以 `where` 结尾，追加条件只能写 `and`（见它的调用约定）。
  return sql`(select case when count(distinct p.canonical_value) = 1 then min(p.canonical_value) end as 代表值,
                     case when count(distinct p.canonical_value) = 1 then min(p.type) end as 代表类型,
                     case when count(distinct p.canonical_value) = 1 then min(p.attrs::text) end as 代表attrs,
                     count(distinct p.canonical_value)::int as 候选数
                from auth.case_entity p, ${户名来源(projectId)}
                 and p.project_id = a.project_id
                 and p.canonical_value = a.value
                 and p.type in ('人', '组织')
                 and p.trust_state <> '已排除'
                 and a.entity_id = ${账户id})`
}

/**
 * 账户 id 集合：字面量数组，或外层行的列 / 子查询表达式（清单、档案复用同一谓词时用后者）。
 */
type 账户id集合 = readonly (string | SQL)[] | string | SQL

/**
 * `id in (...)` 片段：调用点把要匹配的列交进来，集合由本文件构造。
 *
 * ⚠️ 调用约定：调用方必须传**非空数组**——空数组会生成 `in ()`，PG 语法报错。
 */
function id集合(ids: 账户id集合): SQL {
  const 内容 = !是数组(ids) ? sql`${ids}` : sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )
  return sql`(${内容})`
}

/** `id集合` 的收窄：数组走字面量集合，字符串 / SQL 表达式当单元素集合用（外层行相关要用后者）。 */
function 是数组(值: 账户id集合): 值 is readonly (string | SQL)[] {
  return Array.isArray(值)
}

/**
 * 反向对齐集（11 §3.1）：**唯一**户名对齐到这批账户的 人 / 组织 id。
 *
 * 与 `户名对齐` 对称、同样 fail-closed：人的规范值恰好只对应一个账户（别名候选数 = 1），
 * 且那个账户就在 `账户ids` 里，才算对齐。别名对应 0 个或多个账户一律不算。
 * 已排除的人不算——那是人的判断，读端不许把它拉回来。
 */
export function 对齐到账户(projectId: string | SQL, 账户ids: 账户id集合): SQL {
  return 名字对齐到账户(projectId, 账户ids, sql`= 1`)
}

/**
 * 歧义对齐者（11 §3.3）：名字对应 **≥2** 个账户、其中至少一个在 `账户ids` 里。
 *
 * 与 `对齐到账户` 同一前提（`户名来源` 唯一出处），只把候选数从 `= 1` 换成 `>= 2`：
 * 这些 人/组织 因 fail-closed 不进归属集，凡是以它们为端点的关系在归属阶段被排除，
 * 读端必须把条数写进缺口（`aggregate_money` 用它区分「内部往来」与「歧义未归属」）。
 */
export function 歧义到账户(projectId: string | SQL, 账户ids: 账户id集合): SQL {
  return 名字对齐到账户(projectId, 账户ids, sql`>= 2`)
}

/** `对齐到账户` / `歧义到账户` 的共同前提，只差候选数的比较符（`#002-06`）。 */
function 名字对齐到账户(
  projectId: string | SQL,
  账户ids: 账户id集合,
  候选条件: SQL,
): SQL {
  return sql`(select pe.id
     from auth.case_entity pe
    where pe.project_id = ${projectId}
      and pe.type in ('人', '组织')
      and pe.trust_state <> '已排除'
      and (select count(distinct a.entity_id)
             from ${户名来源(projectId)}
              and ae.type = '账户'
              and a.value = pe.canonical_value) ${候选条件}
      and exists (select 1 from ${户名来源(projectId)}
                   and a.entity_id in ${id集合(账户ids)}
                   and a.value = pe.canonical_value))`
}

/**
 * 归属实体集：实体自己 ∪ 正向代表（人 → 唯一户名账户）∪ 反向对齐者（账户 → 唯一户名的
 * 人/组织）。**事件与值都从这一个集合出发**（`#002-06`）。
 */
export function 归属实体集(projectId: string | SQL, 实体id: string | SQL): SQL {
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
export function 归属值集(projectId: string | SQL, 实体id: string | SQL): SQL {
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
 * 「已排除」实体的规范值集合（§9.1）：`participants text[]` 里要剔除的值的**唯一出处**
 * （`#002-06`；此前只写在 `case-mcp-tools.ts` 的 `参与者视图` 里）。
 *
 * 剔除按**值**不按 id——`participants` 存的只有规范值。同名跨类型（缺口 #11）时可见实体的
 * 同值也会被一起剔，这是既有前提，不在此另立规矩。调用方按自己的「含已排除」开关决定是否用。
 */
export async function 已排除规范值(db: Queryable, projectId: string): Promise<Set<string>> {
  const 行们 = rowsOf(
    await db.execute(sql`
      select distinct canonical_value from auth.case_entity
       where project_id = ${projectId} and trust_state = '已排除'
    `),
  )
  return new Set(行们.map((行) => String(行.canonical_value)))
}

/**
 * 基 2（11 §3.2）：账户归属集 = 账户自己的 ids ∪ 唯一户名对齐到它的人/组织。
 * 只由账户构造：人 / 组织查关系时仍用「端点等于自己」的原口径。
 */
export function 账户归属集(projectId: string | SQL, 账户ids: 账户id集合): SQL {
  return sql`(select id from auth.case_entity
               where project_id = ${projectId} and id in ${id集合(账户ids)}
              union
              select id from ${对齐到账户(projectId, 账户ids)} 反向)`
}

/**
 * `账户归属集` 的**数组形态**：给同一个实体行要多次用到归属集的读端（清单 / 分组计数）。
 *
 * 为什么不重复写 `账户归属集`（实测 PG 16.3，`#013-05`）：`(case when e.type='账户' then
 * (r.from_id in 集) <> (r.to_id in 集) …)` 再与第二个相关子查询（另一端未排除）`and` 起来时，
 * 计划器把相关子查询当「hashed SubPlan」缓存，导致同一实体算出的度数比实际少（实测 2 / 0，
 * 应为 4；`set enable_hashjoin = off` 即恢复 4）。改成「每行先算一次数组、谓词用 `= any(...)`」
 * 后结果正确，也不再随计划变化。
 */
export function 账户归属集数组(projectId: string | SQL, 账户ids: 账户id集合): SQL {
  return sql`(select array_agg(id) from (${账户归属集(projectId, 账户ids)}) 归属集)`
}

/**
 * 关系归属某账户 ⇔ **恰好一端**落在归属集里（XOR，不是 `OR`）。
 *
 * 两端都落在集合里 = 账户内部往来（如「李四 → B」）：它在账户视角下会变成一个自环，
 * 既不产生对手方也不产生方向 ⇒ 不归属、不画、不计数，条数进缺口。
 */
export function 关系归属条件(
  projectId: string | SQL,
  账户ids: 账户id集合,
  从: SQL,
  到: SQL,
): SQL {
  const 集 = 账户归属集(projectId, 账户ids)
  return sql`((${从} in ${集}) <> (${到} in ${集}))`
}

/** 账户类型名：基 2 分派判据（含逐行 SQL 形态）的唯一字面值出处（`#002-06`）。 */
export const 账户类型 = "账户"

/** 「类型是不是账户」：基 2 分派判据的唯一出处（`#002-06`）。 */
export function 是账户类型(类型: string): boolean {
  return 类型 === 账户类型
}

/**
 * 基 2 的类型分派（11 §3.2），**唯一出处**：账户 → `账户归属集`；人 / 组织 / 其他 →
 * 无归属集（读端退回「端点等于自己」）。
 *
 * 实体档案 / 关系圈 / 关系图 / `find_crossings` 四个读口都从这里取——将来基 2 扩到
 * 组织只改这里（`#002-06`）。逐行（`e.type`）的 SQL 形态是 `实体关系归属` 的 CASE，
 * 两者是同一张表的两形态，别在调用点再写第三份。
 */
export function 关系归属范围(
  projectId: string,
  ids: readonly (string | SQL)[],
  类型: string,
): { readonly 是账户: boolean; readonly 归属集: SQL | undefined } {
  return 是账户类型(类型)
    ? { 是账户: true, 归属集: 账户归属集(projectId, ids) }
    : { 是账户: false, 归属集: undefined }
}

/**
 * `关系归属范围` 的谓词形态：`from属于` 供「另一端」判定，`触达` 是该关系是否归属该实体。
 * 账户走 `关系归属条件` 的 XOR（内部往来不归属）；其他类型退回端点相等（自环照旧触达）。
 */
export function 关系归属口径(input: {
  readonly projectId: string
  readonly ids: readonly (string | SQL)[]
  readonly 类型: string
  readonly 从: SQL
  readonly 到: SQL
}): {
  readonly 是账户: boolean
  readonly 归属集: SQL | undefined
  readonly from属于: SQL
  readonly 触达: SQL
} {
  const 范围 = 关系归属范围(input.projectId, input.ids, input.类型)
  if (范围.归属集 === undefined) {
    const 集 = id集合(input.ids)
    const from属于 = sql`${input.从} in ${集}`
    return { ...范围, from属于, 触达: sql`(${from属于} or ${input.到} in ${集})` }
  }
  return {
    ...范围,
    from属于: sql`${input.从} in ${范围.归属集}`,
    触达: 关系归属条件(input.projectId, input.ids, input.从, input.到),
  }
}

/**
 * 缺口计数的共享谓词（`关系圈遗漏` 与 `aggregate_money` 共用，`#002-06`）。
 *
 * 只描述「这条关系为什么没进汇总/圈」；项目、信任态、类型、时间窗等基础条件由调用点
 * 按各自口径补齐（例如关系圈不按 `type='转账'` 过滤）。`从` / `到` 是关系两端的列
 * 表达式，允许调用点带表别名。
 */

/** 「另一端」是否未排除：`从` 属于某集合时取 `到`，否则取 `从`。 */
export function 另一端未排除(input: {
  readonly projectId: string | SQL
  readonly from属于: SQL
  readonly 从: SQL
  readonly 到: SQL
}): SQL {
  return sql`(case when ${input.from属于} then ${input.到} else ${input.从} end) in (
      select id from auth.case_entity
       where project_id = ${input.projectId} and trust_state <> '已排除'
    )`
}

/** 内部往来：两端都在归属集里（XOR 必然排除它们）。 */
export function 内部往来归属条件(input: {
  readonly projectId: string | SQL
  readonly 归属集: SQL
  readonly 从: SQL
  readonly 到: SQL
}): SQL[] {
  const from属于 = sql`${input.从} in ${input.归属集}`
  return [
    from属于,
    sql`${input.到} in ${input.归属集}`,
    另一端未排除({ projectId: input.projectId, from属于, 从: input.从, 到: input.到 }),
  ]
}

/** 归属歧义：两端都不在归属集，且一端是候选 ≥2 的歧义者；另一端也不能已排除。 */
export function 归属歧义归属条件(input: {
  readonly projectId: string | SQL
  readonly 归属集: SQL
  readonly 歧义实体: SQL
  readonly 从: SQL
  readonly 到: SQL
}): SQL[] {
  return [
    sql`${input.从} not in ${input.归属集} and ${input.到} not in ${input.归属集}`,
    sql`(${input.从} in ${input.歧义实体} or ${input.到} in ${input.歧义实体})`,
    另一端未排除({
      projectId: input.projectId,
      from属于: sql`${input.从} in ${input.歧义实体}`,
      从: input.从,
      到: input.到,
    }),
  ]
}

/**
 * 事件在指定角色上涉及该实体（`#002-06`：方向过滤的唯一出处）。
 *
 * 参与者表侧用 `归属实体集`（本人 / 正向代表 / 反向对齐者），不是裸实体 id：
 * 按规范值解析时同值多行、以及人 ↔ 唯一户名账户都不能漏。
 *
 * ⚠️ 只在 `from auth.case_event`（未起别名）的查询里用：片段裸引 `case_event.id`。
 */
export function 事件角色条件(
  projectId: string | SQL,
  实体id: string | SQL,
  角色: "付款方" | "收款方",
): SQL {
  return sql`exists (select 1 from auth.case_event_participant p
                       where p.project_id = ${projectId}
                         and p.event_id = case_event.id
                         and p.entity_id in ${归属实体集(projectId, 实体id)}
                         and p.role = ${角色})`
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
export function 事件归属条件(projectId: string | SQL, 实体id: string | SQL): SQL {
  return sql`(exists (select 1 from auth.case_event_participant p
                        where p.project_id = ${projectId}
                          and p.event_id = case_event.id
                          and p.entity_id in ${归属实体集(projectId, 实体id)})
           or exists (select 1 from unnest(participants) as 参与者
                       where 参与者 in ${归属值集(projectId, 实体id)}))`
}

/**
 * 「关系是否归属某实体」的唯一出处（11 §3.1 / §3.2，`#002-06`）：`实体档案` 与 `实体清单` 共用。
 *
 * - 账户：基 2，归属集 = 自己 ∪ 唯一户名对齐者，按 XOR（恰好一端）归属；
 * - 人 / 组织：基 1，端点等于自己（集合只由账户构造）。
 *
 * `projectId` / `实体id` / `类型` 可以是字面量或外层行的列表达式；`从` / `到` 是关系两端的
 * 列表达式，允许调用点带表别名。
 *
 * `归属集数组`：外层行已经用 `账户归属集数组` 算好数组时传进来（清单 / 分组计数），谓词改用
 * `= any(...)`。不传则退回 `账户归属集` 子查询（档案）。两种形态语义相同——为什么要分两种，
 * 见 `账户归属集数组` 上的实测（`#013-05`）。
 */
export function 实体关系归属(input: {
  readonly projectId: string | SQL
  readonly 实体id: string | SQL
  readonly 类型: string | SQL
  readonly 从: SQL
  readonly 到: SQL
  readonly 归属集数组?: SQL
}): { readonly 归属集: SQL; readonly from属于: SQL; readonly 归属: SQL } {
  const 集 = 账户归属集(input.projectId, input.实体id)
  const 是账户 = sql`${input.类型} = ${账户类型}`
  const 数组 = input.归属集数组
  if (数组 !== undefined)
    return {
      归属集: 集,
      from属于: sql`(case when ${是账户} then ${input.从} = any(${数组}) else ${input.从} = ${input.实体id} end)`,
      归属: sql`(case when ${是账户}
                     then (${input.从} = any(${数组})) <> (${input.到} = any(${数组}))
                     else (${input.从} = ${input.实体id} or ${input.到} = ${input.实体id}) end)`,
    }
  return {
    归属集: 集,
    from属于: sql`(case when ${是账户} then ${input.从} in ${集} else ${input.从} = ${input.实体id} end)`,
    归属: sql`(case when ${是账户}
                   then (${input.从} in ${集}) <> (${input.到} in ${集})
                   else (${input.从} = ${input.实体id} or ${input.到} = ${input.实体id}) end)`,
  }
}
