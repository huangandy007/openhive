export * as OpenhiveCaseArtifactCitations from "./case-artifact-citations"

import { basename } from "node:path"
import { Hash } from "@opencode-ai/core/util/hash"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { nowSeconds } from "@opencode-ai/auth/time"
import { sql } from "drizzle-orm"
import type { Queryable } from "./case-store"

/**
 * 产物引用（design §4.3 / §9.4）：报告保存时把正文里的 `[[fact:…]]` 标记登记回
 * `case_citation`，并按「依据有没有改过」派生「请复核」。
 *
 * ## 三条口径（不要私自放宽）
 *
 * 1. **产物只登记、不解析**（design §5.5 的硬边界）。材料行 `kind='产物'`、
 *    `parse_status='未入队'`（库的 CHECK `case_material_parsed_source` 只允许这一个值）、
 *    `parse_detail={"原因":"产物只登记不解析"}`。给产物开解析入口＝让报告进事实层，
 *    下一轮被当证据引回来。⚠️ 任务书写的是 `'已跳过'`，但 0031 的 CHECK 明写
 *    `kind <> '产物' OR parse_status = '未入队'`，写 `'已跳过'` 会整条 insert 被拒；本任务
 *    不新增迁移，故按库（也就 design §5.5 的口径）落 `'未入队'`。
 * 2. **引用行与材料引用同表**（`case_citation`）：`material_id` = 产物那一行，
 *    `fact_type` / `fact_id` = 被引用的事实。同表能分清两个方向——「事实出自材料」那些行的
 *    `material_id` 是原始材料，永远不会等于某个产物行的 id。
 * 3. **「请复核」是查询派生的，不是写入态**（裁定 6，不加列、不加迁移）：
 *    `case_fact_change.created_at > case_citation.created_at` ⇒ 这条引用的依据变了。重复保存
 *    同一份产物会把**本路径**的旧引用删掉重登记（引用时间 = 现在），于是「请复核」自动消掉——
 *    **保存这个动作本身就是复核**。判据是**严格大于**：同一秒写下的变更不算「之后改过」。
 *
 * ## 产物指纹 = 路径 ＋ 正文（**不是**正文本身）
 *
 * `case_material` 的唯一键是 `(project_id, fingerprint)`，而产物是**按路径复核**的：同一份正
 * 文存到两个路径下，是两个各自要复核的产物。若指纹只算正文，后登记的路径会把先登记那行的
 * `path` 覆写掉（`on conflict … do update set path`），先那个路径的复核就永远查不到自己的产物
 * ——任务书原稿（`Hash.fast(content)`）与它自己的用例就撞在这里。故产物行的指纹带上路径，
 * 路径无关的那半句话（「同样的内容已作为别的类型入库」）也随之变成「同路径同内容」。
 *
 * 这里仍然**不做任何归一化**：为匹配而做的归一化不许进指纹（`LEARNINGS #011-01`）。
 */

export interface 引用标记 {
  readonly fact_type: "entity" | "relation" | "event"
  readonly fact_id: string
  readonly 原文: string
  readonly 位置: number
}

export interface 未认标记 {
  readonly 原文: string
  readonly 原因: string
}

const 允许类型 = ["entity", "relation", "event"] as const
type 允许类型 = (typeof 允许类型)[number]

const 标记式 = /\[\[fact:([^\]\n]*)\]\]/g

/** 纯函数：只判语法，不查库（查库那一半在 `登记产物引用` 里）。 */
export function 解析标记(content: string): { 引用们: readonly 引用标记[]; 未认: readonly 未认标记[] } {
  const 引用们: 引用标记[] = []
  const 未认: 未认标记[] = []
  const 见过 = new Set<string>()
  for (const 匹配 of content.matchAll(标记式)) {
    const 原文 = 匹配[0]
    const 段 = (匹配[1] ?? "").trim().split(":")
    if (段.length !== 2) {
      未认.push({ 原文, 原因: "标记要写成 [[fact:<类型>:<id>]]" })
      continue
    }
    const [类型, id] = [段[0]!.trim(), 段[1]!.trim()]
    if (!(允许类型 as readonly string[]).includes(类型)) {
      未认.push({ 原文, 原因: `只认 entity / relation / event，不认「${类型}」` })
      continue
    }
    if (id === "" || /\s/.test(id)) {
      未认.push({ 原文, 原因: "id 不能为空、不能含空白" })
      continue
    }
    const 键 = `${类型}:${id}`
    if (见过.has(键)) continue
    见过.add(键)
    引用们.push({ fact_type: 类型 as 允许类型, fact_id: id, 原文, 位置: 匹配.index ?? 0 })
  }
  return { 引用们, 未认 }
}

export interface 登记结果 {
  readonly 登记: number
  readonly 删除: number
  readonly 跳过: readonly 未认标记[]
  readonly 材料id: string | null
}

const 表名 = { entity: "auth.case_entity", relation: "auth.case_relation", event: "auth.case_event" } as const

export async function 登记产物引用(
  db: Queryable,
  input: { readonly projectId: string; readonly path: string; readonly content: string },
): Promise<登记结果> {
  const { 引用们, 未认 } = 解析标记(input.content)
  // 产物指纹带路径：同一路径的同一份正文幂等，不同路径互不覆写（见文件头）。
  const 指纹 = Hash.fast(`${input.path}\u0000${input.content}`)

  // 同内容已经以**别的类型**入过库 ⇒ 不翻它的类型、也不改它的解析状态（那份可能正在被解析）。
  // ⚠️ **当前不可达（指纹来源决定），保留为防御**：产物指纹是 `Hash.fast(path + 正文)`
  // （sha1），而材料入库的指纹一律是 `Hash.sha256(文件字节)`（`case-parse.ts:254`、`file.ts:785`）
  // ——两套算法、两种输入，同一份内容也撞不上同一个指纹。它防的是「将来有人把产物指纹改成
  // 与材料同源的 `sha256(字节)`」时，静默把一份正在被解析的材料翻成产物。
  const 同指纹 = rowsOf(await db.execute(sql`
    select id, kind from auth.case_material
     where project_id = ${input.projectId} and fingerprint = ${指纹}
     limit 1
  `))[0]
  if (同指纹 !== undefined && String(同指纹.kind) !== "产物")
    return {
      登记: 0,
      删除: 0,
      材料id: null,
      跳过: [...未认, { 原文: "", 原因: `同样的内容已作为「${String(同指纹.kind)}」入库，不登记为产物` }],
    }

  // 先清掉**本路径**旧版本的引用：引用行的核对基准是「现在这份正文」，旧版本的回链留着只会
  // 让「请复核」永远亮着。旧正文在盘上（重登记只是重算），所以清掉不是丢证据。
  const 删除 = rowsOf(await db.execute(sql`
    delete from auth.case_citation
     where project_id = ${input.projectId}
       and material_id in (
         select id from auth.case_material
          where project_id = ${input.projectId} and kind = '产物' and path = ${input.path}
       )
    returning id
  `)).length

  if (引用们.length === 0) return { 登记: 0, 删除, 材料id: null, 跳过: 未认 }

  const 材料id = await 登记产物行(db, input, 指纹)
  // 跳过项按「先查库发现的、后语法认不出的」排列（任务书的用例断言的就是这个次序）。
  const 跳过: 未认标记[] = []
  let 登记 = 0
  for (const 类型 of 允许类型) {
    const 这批 = 引用们.filter((条) => 条.fact_type === 类型)
    if (这批.length === 0) continue
    // `sql.raw(表名[类型])` 是**白名单查表**，不是拼接用户输入：`类型` 只可能是那三个字面量
    // （`解析标记` 已挡过）。加类型只改 `表名` 与 `允许类型` 两处。
    const 在 = new Set(
      rowsOf(await db.execute(sql`
        select id from ${sql.raw(表名[类型])}
         where project_id = ${input.projectId}
           and id in (${sql.join(这批.map((条) => sql`${条.fact_id}`), sql`, `)})
      `)).map((行) => String(行.id)),
    )
    for (const 条 of 这批) {
      if (!在.has(条.fact_id)) {
        跳过.push({ 原文: 条.原文, 原因: "这个项目里没有这条事实" })
        continue
      }
      登记 += rowsOf(await db.execute(sql`
        insert into auth.case_citation
          (id, project_id, fact_type, fact_id, material_id, locator, extract_method, created_at)
        values (
          ${"cit-" + Hash.fast(`${input.projectId}|${材料id}|${条.fact_type}|${条.fact_id}`)},
          ${input.projectId}, ${条.fact_type}, ${条.fact_id}, ${材料id},
          ${JSON.stringify({ 类型: "正文标记", 序: 条.位置, 原文: 条.原文 })}::text::jsonb,
          '人工', ${nowSeconds()}
        )
        on conflict (project_id, id) do nothing
        returning id
      `)).length
    }
  }
  return { 登记, 删除, 材料id, 跳过: [...跳过, ...未认] }
}

/**
 * 产物那一行：单条语句、按 `(project_id, fingerprint)` 幂等——与 `createMaterial` 同键，
 * 但**多了「只在产物行上更新」这一道**，所以不能直接复用它。
 *
 * `do update … where auth.case_material.kind = '产物'`：`fingerprint` 撞上一条**非产物**
 * 材料时，这条语句一行不返回（`WHERE` 挡住了更新），于是抛错、上层把这次登记记成失败。
 * **这是有意 fail-closed**——比静默把别人的材料改成「产物」好。
 *
 * ⚠️ **当前不可达（指纹来源决定），保留为防御**：产物指纹是 `Hash.fast(path + 正文)`，
 * 材料指纹是 `Hash.sha256(文件字节)`，两套算法不会撞（理由同上，也见 `登记产物引用` 里
 * 「同指纹」那段的注释）。它防的是「产物指纹改成与材料同源」后，覆盖一条正在被解析的材料行。
 */
async function 登记产物行(
  db: Queryable,
  input: { readonly projectId: string; readonly path: string },
  指纹: string,
): Promise<string> {
  const 行们 = rowsOf(await db.execute(sql`
    insert into auth.case_material
      (id, project_id, file_name, kind, fingerprint, path, parse_status, parse_detail, created_at)
    values (
      ${"mat-" + Hash.fast(`${input.projectId}|${input.path}|${指纹}`)},
      ${input.projectId}, ${basename(input.path)}, '产物', ${指纹}, ${input.path},
      '未入队', ${JSON.stringify({ 原因: "产物只登记不解析" })}::text::jsonb, ${nowSeconds()}
    )
    on conflict (project_id, fingerprint) do update
       set path = excluded.path, file_name = excluded.file_name
     where auth.case_material.kind = '产物'
    returning id
  `))
  const id = 行们[0]?.id
  if (typeof id !== "string") throw new Error(`登记产物没有拿到材料 id：${JSON.stringify(行们[0] ?? null)}`)
  return id
}

export interface 复核项 {
  readonly fact_type: string
  readonly fact_id: string
  readonly 值: string
  readonly 原文: string | null
  readonly 引用时间: number
  readonly 变更时间: number | null
  readonly 需复核: boolean
  /** 被引用事实当前的信任态；事实行已经不在了就是 `null`（不按「已排除」过滤：那样会吞掉待复核行）。 */
  readonly trust_state: string | null
}

export interface 产物复核结果 {
  readonly 产物: {
    readonly id: string
    readonly path: string
    readonly file_name: string
    readonly kind: string
    readonly fingerprint: string
  } | null
  readonly 引用: readonly 复核项[]
  readonly 需复核: number
  readonly 缺口: string[]
}

export async function 产物复核(
  db: Queryable,
  input: { readonly projectId: string; readonly path: string },
): Promise<产物复核结果> {
  const 材料 = rowsOf(await db.execute(sql`
    select id, path, file_name, kind, fingerprint
      from auth.case_material
     where project_id = ${input.projectId} and path = ${input.path}
     order by created_at desc, id desc
     limit 1
  `))[0]
  if (材料 === undefined)
    return {
      产物: null,
      引用: [],
      需复核: 0,
      缺口: ["这个路径下还没有登记过引用：保存一次带 [[fact:…]] 标记的报告就会登记"],
    }

  const 行们 = rowsOf(await db.execute(sql`
    with 变更 as (
      select fact_type, fact_id, max(created_at) as 变更时间
        from auth.case_fact_change
       where project_id = ${input.projectId}
       group by fact_type, fact_id
    )
    select c.id, c.fact_type, c.fact_id, c.locator, c.created_at,
           变更.变更时间,
           coalesce(实体.canonical_value,
                    (select 起.canonical_value || ' → ' || 终.canonical_value || ' · ' || 关系.type
                       from auth.case_relation 关系
                       join auth.case_entity 起 on 起.project_id = 关系.project_id and 起.id = 关系.from_id
                       join auth.case_entity 终 on 终.project_id = 关系.project_id and 终.id = 关系.to_id
                      where 关系.project_id = c.project_id and 关系.id = c.fact_id),
                    事件.summary,
                    c.fact_id) as 值,
           -- 信任态只带回、**不按它过滤**：已排除的事实照样列出来（用户才知道自己引了它），
           -- 由前端标「已排除」。按已排除过滤会连「待复核」一起吞掉。
           coalesce(实体.trust_state, 关联.trust_state, 事件.trust_state) as trust_state
      from auth.case_citation c
      left join 变更 on 变更.fact_type = c.fact_type and 变更.fact_id = c.fact_id
      left join auth.case_entity 实体
        on 实体.project_id = c.project_id and c.fact_type = 'entity' and 实体.id = c.fact_id
      left join auth.case_relation 关联
        on 关联.project_id = c.project_id and c.fact_type = 'relation' and 关联.id = c.fact_id
      left join auth.case_event 事件
        on 事件.project_id = c.project_id and c.fact_type = 'event' and 事件.id = c.fact_id
     where c.project_id = ${input.projectId} and c.material_id = ${String(材料.id)}
     order by c.created_at desc, c.id asc
  `))

  const 引用 = 行们.map((行) => {
    const 引用时间 = Number(行.created_at)
    const 变更时间 = 行.变更时间 === null || 行.变更时间 === undefined ? null : Number(行.变更时间)
    return {
      fact_type: String(行.fact_type),
      fact_id: String(行.fact_id),
      值: String(行.值),
      原文: 取原文(行.locator),
      引用时间,
      变更时间,
      // 严格大于：同秒的那条变更不算（它可能是这次保存前后脚写下的，见文件头第 3 条）。
      需复核: 变更时间 !== null && 变更时间 > 引用时间,
      trust_state: 行.trust_state === null || 行.trust_state === undefined ? null : String(行.trust_state),
    }
  })

  const 缺口: string[] = []
  if (String(材料.kind) !== "产物") 缺口.push(`这个路径最新的一条材料是「${String(材料.kind)}」，不是产物`)
  if (引用.length === 0) 缺口.push("这份产物没有引用任何事实")

  return {
    产物: {
      id: String(材料.id),
      path: String(材料.path),
      file_name: String(材料.file_name),
      kind: String(材料.kind),
      fingerprint: String(材料.fingerprint),
    },
    引用,
    需复核: 引用.filter((条) => 条.需复核).length,
    缺口,
  }
}

/** locator 里我们写的 `原文`；不是我们写的形状就给 null（不猜）。 */
function 取原文(locator: unknown): string | null {
  const 对象 = typeof locator === "string" ? 安全解析(locator) : locator
  if (typeof 对象 !== "object" || 对象 === null) return null
  const 原文 = (对象 as Record<string, unknown>)["原文"]
  return typeof 原文 === "string" ? 原文 : null
}

/** locator 是 jsonb：可能是对象（驱动已解析），也可能是字符串（旧行 / 某些驱动）。 */
function 安全解析(文本: string): unknown {
  try {
    return JSON.parse(文本) as unknown
  } catch {
    return undefined
  }
}
