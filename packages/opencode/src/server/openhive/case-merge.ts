export * as OpenhiveCaseMerge from "./case-merge"

import { sql } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 记变更, 操作人快照 } from "./case-fact-change"
import { 文本数组 } from "./case-fact-store"
import { inTransaction, type Queryable } from "./case-store"

/**
 * 合并与拆分（设计 §9.3）。
 *
 * ## 合并做了什么
 *
 * 别名并集（被并入者的 `canonical_value` 也变成别名）→ 关系两端改指主体 →
 * 合并后成为自环的关系标 `已排除`（自环不是数据错误，是「自己给自己转账」这种事实
 * 已经不成立；按 §9「不删除，只打状态」）→ 删掉被并入那一行。
 *
 * ## 为什么允许删
 *
 * §9.3 原话是「被并入者**成为别名**」——它不再是独立实体，留一行「已合并」的空壳会让
 * 每个读路径都要多判一次。代价是：删之前必须把**全量快照**写进留痕，拆分靠它原样恢复。
 *
 * ## 只允许同类型（R6）
 *
 * 六类要素的计数、图标、排序全按 `type` 走；跨类合并会让「这个实体算什么」失去答案。
 * P19（同一账号被标成账户 / 号码）的正确解是**先修正类型、再合并**。
 */

export const 合并错误码们 = [
  "fact_not_found",
  "type_mismatch",
  "bad_input",
  "not_a_merge",
  "already_split",
  "restore_conflict",
] as const
export type 合并错误码 = (typeof 合并错误码们)[number]

export class 合并冲突 extends Error {
  constructor(
    message: string,
    readonly code: 合并错误码,
  ) {
    super(message)
    this.name = "合并冲突"
  }
}

interface 实体快照 {
  readonly id: string
  readonly type: string
  readonly canonicalValue: string
  readonly aliases: string[]
  readonly attrs: unknown
  readonly trustState: string
  readonly createdAt: number
}

interface 关系快照 {
  readonly id: string
  readonly fromId: string
  readonly toId: string
  readonly trustState: string
}

export interface 合并输入 {
  readonly projectId: string
  readonly survivorId: string
  readonly mergedId: string
  readonly reasonText: string
  readonly by: string
}

export interface 合并结果 {
  readonly changeId: string
  readonly survivorId: string
  readonly aliases: string[]
  readonly movedRelations: number
  readonly selfLoops: readonly string[]
}

/**
 * jsonb 读回：只解「二次编码的旧对象/数组」（字符串以 `{` / `[` 开头），其余原样返回。
 * 不做无条件的 `JSON.parse`——那会把真标量 `"123"` 变成数字、`"null"` 变成 null（Task 1 R4）。
 */
function 读杰森(值: unknown): unknown {
  if (typeof 值 !== "string" || !(值.startsWith("{") || 值.startsWith("["))) return 值 ?? null
  try {
    return JSON.parse(值)
  } catch {
    return 值
  }
}

function 是记录(值: unknown): 值 is Record<string, unknown> {
  return typeof 值 === "object" && 值 !== null && !Array.isArray(值)
}

function 文本组(值: unknown): string[] {
  if (typeof 值 !== "string" || 值 === "") return []
  try {
    const 解: unknown = JSON.parse(值)
    return Array.isArray(解) ? 解.map((x) => String(x)) : []
  } catch {
    return []
  }
}

async function 读实体快照(tx: Queryable, projectId: string, id: string): Promise<实体快照 | undefined> {
  const 行 = rowsOf(
    await tx.execute(sql`
      select id, type, canonical_value, array_to_json(aliases)::text as aliases, attrs,
             trust_state, created_at
        from auth.case_entity
       where project_id = ${projectId} and id = ${id}
       for update
    `),
  )[0]
  if (行 === undefined) return undefined
  return {
    id: String(行.id),
    type: String(行.type),
    canonicalValue: String(行.canonical_value),
    aliases: 文本组(行.aliases),
    attrs: 读杰森(行.attrs),
    trustState: String(行.trust_state),
    createdAt: Number(行.created_at),
  }
}

async function 有牵连的关系(tx: Queryable, projectId: string, entityId: string): Promise<关系快照[]> {
  const 行们 = rowsOf(
    await tx.execute(sql`
      select id, from_id, to_id, trust_state
        from auth.case_relation
       where project_id = ${projectId} and (from_id = ${entityId} or to_id = ${entityId})
       order by id
    `),
  )
  return 行们.map((行) => ({
    id: String(行.id),
    fromId: String(行.from_id),
    toId: String(行.to_id),
    trustState: String(行.trust_state),
  }))
}

/**
 * 合并两个同类型实体。`survivorId` 留下，`mergedId` 成为它的别名。
 *
 * 事务内顺序是承重的：**先读全量快照 → 再改 → 再删 → 最后写留痕**。
 * 留痕里的 `before` 少一样东西，拆分就恢复不回来。
 */
export async function 合并实体(db: Queryable, input: 合并输入): Promise<合并结果> {
  if (input.survivorId === input.mergedId) throw new 合并冲突("不能把自己并进自己", "bad_input")
  if (input.reasonText.trim() === "") throw new 合并冲突("合并必须写下依据", "bad_input")

  return inTransaction(db, async (tx) => {
    const 主体 = await 读实体快照(tx, input.projectId, input.survivorId)
    if (主体 === undefined) throw new 合并冲突("找不到留下的那个实体", "fact_not_found")
    const 并入 = await 读实体快照(tx, input.projectId, input.mergedId)
    if (并入 === undefined) throw new 合并冲突("找不到被并入的实体", "fact_not_found")
    if (主体.type !== 并入.type)
      throw new 合并冲突(
        `只能合并同类型实体（${主体.type} ≠ ${并入.type}）——先把类型改对`,
        "type_mismatch",
      )

    const 关系们 = await 有牵连的关系(tx, input.projectId, 并入.id)

    // 参与者与别名的快照必须在改指之前取：拆分要靠它原样恢复（01 §9.3）。
    const 参与者们 = rowsOf(
      await tx.execute(sql`
        select event_id, ordinal from auth.case_event_participant
         where project_id = ${input.projectId} and entity_id = ${并入.id}
         order by event_id asc, ordinal asc
      `),
    ).map((行) => ({ eventId: String(行.event_id), ordinal: Number(行.ordinal) }))
    const 别名们 = rowsOf(
      await tx.execute(sql`
        select id from auth.case_entity_alias
         where project_id = ${input.projectId} and entity_id = ${并入.id}
         order by id asc
      `),
    ).map((行) => String(行.id))

    const 自环 = 关系们
      .filter(
        (条) =>
          (条.fromId === 并入.id && 条.toId === 主体.id) ||
          (条.toId === 并入.id && 条.fromId === 主体.id) ||
          (条.fromId === 并入.id && 条.toId === 并入.id),
      )
      .map((条) => 条.id)

    // 关系改指：两端都改，两次 update 各自只动一侧。
    await tx.execute(sql`
      update auth.case_relation set from_id = ${主体.id}
       where project_id = ${input.projectId} and from_id = ${并入.id}
    `)
    await tx.execute(sql`
      update auth.case_relation set to_id = ${主体.id}
       where project_id = ${input.projectId} and to_id = ${并入.id}
    `)

    // 自环最多几条，逐条写比拼 `in (...)` 更稳：不依赖 `sql.join` 的写法（本仓没有先例）。
    for (const id of 自环) {
      await tx.execute(sql`
        update auth.case_relation set trust_state = '已排除'
         where project_id = ${input.projectId} and id = ${id}
      `)
    }

    // 指向跟随：被并入行一删，参与者与户名别名若不改指就成了悬空引用
    // （户名别名悬空会让 `户名对齐` 的 join 落空，阻断 1 的修复随之失效）。
    // `participants text[]` 不改：旧规范值并进幸存者别名，由基 1 的文本回退命中（11 §4.1）。
    await tx.execute(sql`
      update auth.case_event_participant set entity_id = ${主体.id}
       where project_id = ${input.projectId} and entity_id = ${并入.id}
    `)
    await tx.execute(sql`
      update auth.case_entity_alias set entity_id = ${主体.id}
       where project_id = ${input.projectId} and entity_id = ${并入.id}
    `)

    // 别名并集：主体的旧别名 ＋ 被并入者的别名 ＋ 被并入者的规范值；去重、去掉主体自己的规范值。
    const 别名集 = new Set<string>([...主体.aliases, ...并入.aliases, 并入.canonicalValue])
    别名集.delete(主体.canonicalValue)
    const 别名 = [...别名集].sort()

    // `text[]` 必须走 `文本数组`：JS 数组裸绑会被展开成 `()`，PGlite 报 42601（Task 2 实测）。
    await tx.execute(sql`
      update auth.case_entity set aliases = ${文本数组(别名)}
       where project_id = ${input.projectId} and id = ${主体.id}
    `)
    await tx.execute(sql`
      delete from auth.case_entity where project_id = ${input.projectId} and id = ${并入.id}
    `)

    const 留痕 = await 记变更(tx, {
      projectId: input.projectId,
      factType: "entity",
      factId: 主体.id,
      action: "合并",
      before: {
        survivorAliases: 主体.aliases,
        被并入: 并入,
        关系们,
        参与者们,
        别名们,
      },
      after: {
        aliases: 别名,
        自环,
      },
      reasonText: input.reasonText,
      actor: await 操作人快照(tx, input.by),
    })

    return {
      changeId: 留痕,
      survivorId: 主体.id,
      aliases: 别名,
      movedRelations: 关系们.length,
      selfLoops: 自环,
    }
  })
}

export interface 拆分输入 {
  readonly projectId: string
  readonly changeId: string
  readonly by: string
}

export interface 拆分结果 {
  readonly changeId: string
  readonly restoredEntityId: string
  readonly restoredRelations: readonly string[]
  /** 合并之后被人动过、或已经不存在的关系：**不覆盖**，列出来让人知道。 */
  readonly 未恢复: readonly string[]
}

/**
 * 拆分 = 撤销某一次合并（§9.3「并错了 → 拆分，原样恢复」）。
 *
 * 恢复的边界：只回滚**合并这一步**。合并之后人又动过的关系（状态变了 / 被删了），
 * 拆分不去覆盖它——那会把人后来的判断抹掉。这些关系进 `未恢复` 清单。
 *
 * ## 「没被动过」按「合并后应有的长相」判
 *
 * 合并**自己**会把指向关系改成自环并标 `已排除`；拿「当前状态 === 合并前快照」去判，
 * 会把合并自己的改动误判成人动过 ⇒ 自环永远恢复不了。所以期望值由快照 ＋ 合并留痕的
 * `after.自环` 一起算：端点按「被并入者 → 主体」映射，状态按「是否在自环清单里」定。
 */
export async function 拆分合并(db: Queryable, input: 拆分输入): Promise<拆分结果> {
  return inTransaction(db, async (tx) => {
    // `for update`：两个事务同时拆同一次合并时，后到者在这里等第一个提交，之后再判
    // 「已拆」才读得到对方刚插入的拆分留痕（READ COMMITTED 下每条语句取新快照），
    // 否则两边都判不到、都去 insert 同一实体 id，后者撞 23505 以 500 掉出去。
    const 行 = rowsOf(
      await tx.execute(sql`
        select id, project_id, fact_id, action, before, after
          from auth.case_fact_change
         where project_id = ${input.projectId} and id = ${input.changeId}
         for update
      `),
    )[0]
    if (行 === undefined) throw new 合并冲突("找不到这条留痕", "fact_not_found")
    if (String(行.action) !== "合并") throw new 合并冲突("这条留痕不是一次合并", "not_a_merge")

    const 已拆 = rowsOf(
      await tx.execute(sql`
        select id from auth.case_fact_change
         where project_id = ${input.projectId} and fact_type = 'entity' and action = '拆分'
           and after ->> '合并留痕' = ${input.changeId}
      `),
    )
    if (已拆.length > 0) throw new 合并冲突("这次合并已经拆过了", "already_split")

    const 前 = 读杰森(行.before) as
      | {
          survivorAliases: string[]
          被并入: 实体快照
          关系们: 关系快照[]
          参与者们?: { eventId: string; ordinal: number }[]
          别名们?: string[]
        }
      | null
    if (
      前 === null ||
      typeof 前 !== "object" ||
      前.被并入 === undefined ||
      !Array.isArray(前.survivorAliases)
    )
      throw new 合并冲突("留痕里没有可恢复的快照", "restore_conflict")

    const 后 = 读杰森(行.after)
    if (!是记录(后) || !Array.isArray(后["aliases"]))
      throw new 合并冲突("留痕里没有可恢复的别名快照", "restore_conflict")
    const 合并后别名 = 后["aliases"].map((x) => String(x))
    const 自环原 = 后["自环"]
    const 自环 = Array.isArray(自环原) ? 自环原.map((x) => String(x)) : []

    const 主体Id = String(行.fact_id)
    const 被并入 = 前.被并入

    // 本次合并加进去的别名 = 合并后的别名集 − 合并前主体的别名集。
    // 拆分只减掉这一份增量：合并之后另一次合并加进来的名字（以及它带来的实体身份）
    // 不跟着消失——把别名整份覆盖成 `前.survivorAliases` 会静默抹掉它们。
    const 前别名集 = new Set(前.survivorAliases)
    const 增量 = 合并后别名.filter((名) => !前别名集.has(名))

    // 主体当前别名必须加行锁再读：与另一次合并/改名并发时，按合并当时的口径写回会抹掉后到的改动。
    const 主体行 = rowsOf(
      await tx.execute(sql`
        select array_to_json(aliases)::text as aliases
          from auth.case_entity
         where project_id = ${input.projectId} and id = ${主体Id}
         for update
      `),
    )[0]
    if (主体行 === undefined)
      throw new 合并冲突("主体的别名在合并之后又变过，先处理再拆", "restore_conflict")
    const 当前别名 = 文本组(主体行.aliases)
    const 当前别名集 = new Set(当前别名)
    // 增量里缺任何一个 ⇒ 主体在合并之后被别的操作改过，口径对不上。fail-closed：
    // 不静默把别名写回旧快照（那会抹掉那次改动），交给人先处理。
    if (增量.some((名) => !当前别名集.has(名)))
      throw new 合并冲突("主体的别名在合并之后又变过，先处理再拆", "restore_conflict")
    const 增量集 = new Set(增量)
    const 新别名 = 当前别名.filter((名) => !增量集.has(名))

    const 撞 = rowsOf(
      await tx.execute(sql`
        select id from auth.case_entity
         where project_id = ${input.projectId} and type = ${被并入.type}
           and canonical_value = ${被并入.canonicalValue}
      `),
    )[0]
    if (撞 !== undefined)
      throw new 合并冲突(
        `已经又有一个实体叫「${被并入.canonicalValue}」了，先把那个处理掉再拆`,
        "restore_conflict",
      )

    await tx.execute(sql`
      insert into auth.case_entity (id, project_id, type, canonical_value, aliases, attrs, trust_state, created_at)
      values (${被并入.id}, ${input.projectId}, ${被并入.type}, ${被并入.canonicalValue},
              ${文本数组(被并入.aliases)},
              ${被并入.attrs === null || 被并入.attrs === undefined ? sql`'{}'::jsonb` : sql`${JSON.stringify(被并入.attrs)}::text::jsonb`},
              ${被并入.trustState}, ${被并入.createdAt})
    `)

    await tx.execute(sql`
      update auth.case_entity set aliases = ${文本数组(新别名)}
       where project_id = ${input.projectId} and id = ${主体Id}
    `)

    const 恢复: string[] = []
    const 未恢复: string[] = []
    for (const 关系 of 前.关系们) {
      const 当前 = rowsOf(
        await tx.execute(sql`
          select from_id, to_id, trust_state from auth.case_relation
           where project_id = ${input.projectId} and id = ${关系.id}
        `),
      )[0]
      if (当前 === undefined) {
        未恢复.push(关系.id)
        continue
      }
      // 合并后应有的长相：端点映射到最后留下的主体，自环状态是「已排除」，其余保持快照。
      const 期望from = 关系.fromId === 被并入.id ? 主体Id : 关系.fromId
      const 期望to = 关系.toId === 被并入.id ? 主体Id : 关系.toId
      const 期望trust = 自环.includes(关系.id) ? "已排除" : 关系.trustState
      const 没被动过 =
        String(当前.from_id) === 期望from &&
        String(当前.to_id) === 期望to &&
        String(当前.trust_state) === 期望trust
      if (!没被动过) {
        未恢复.push(关系.id)
        continue
      }
      // 三个字段都写回：合并改过的 trust_state 也是「合并这一步」的一部分。
      await tx.execute(sql`
        update auth.case_relation set from_id = ${关系.fromId}, to_id = ${关系.toId}, trust_state = ${关系.trustState}
         where project_id = ${input.projectId} and id = ${关系.id}
      `)
      恢复.push(关系.id)
    }

    // 参与者与别名：按留痕原样指回被并入者。**被人动过的不覆盖**（行已不存在、或
    // entity_id 已不是幸存者），进 `未恢复` 清单，不静默。
    const 参与者们 = 前.参与者们 ?? []
    const 别名们 = 前.别名们 ?? []
    for (const 条 of 参与者们) {
      const 当前 = rowsOf(
        await tx.execute(sql`
          select entity_id from auth.case_event_participant
           where project_id = ${input.projectId} and event_id = ${条.eventId} and ordinal = ${条.ordinal}
        `),
      )[0]
      if (当前 === undefined || String(当前.entity_id ?? "") !== 主体Id) {
        未恢复.push(`参与者:${条.eventId}#${条.ordinal}`)
        continue
      }
      await tx.execute(sql`
        update auth.case_event_participant set entity_id = ${被并入.id}
         where project_id = ${input.projectId} and event_id = ${条.eventId} and ordinal = ${条.ordinal}
      `)
    }
    for (const 别名id of 别名们) {
      const 当前 = rowsOf(
        await tx.execute(sql`
          select entity_id from auth.case_entity_alias
           where project_id = ${input.projectId} and id = ${别名id}
        `),
      )[0]
      if (当前 === undefined || String(当前.entity_id ?? "") !== 主体Id) {
        未恢复.push(`别名:${别名id}`)
        continue
      }
      await tx.execute(sql`
        update auth.case_entity_alias set entity_id = ${被并入.id}
         where project_id = ${input.projectId} and id = ${别名id}
      `)
    }

    const 留痕Id = await 记变更(tx, {
      projectId: input.projectId,
      factType: "entity",
      factId: 主体Id,
      action: "拆分",
      before: null,
      after: { 合并留痕: input.changeId, 未恢复 },
      actor: await 操作人快照(tx, input.by),
    })

    return { changeId: 留痕Id, restoredEntityId: 被并入.id, restoredRelations: 恢复, 未恢复 }
  })
}
