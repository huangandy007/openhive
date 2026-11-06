import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { Queryable } from "./case-store"
import type { 调用身份 } from "./case-mcp-identity"
import { 事实详情, 引用们, type 引用视图 } from "./case-fact-read"
import type { 留痕类型 } from "./case-fact-change"

/**
 * MCP 工具层的取数实现：只认 `{ db, 身份 }`，不认识 MCP、不认识 HTTP。
 *
 * ## 项目隔离在 SQL 层
 *
 * 每条查询都显式带 `project_id = ${身份.projectId}`，参数从**服务端解析出的身份**来，
 * 不接受模型传项目名。成员校验由调用入口（`校验成员`）先做一次，工具本身只负责取数
 * （`LEARNINGS #004-09`：门在副作用之前，且只在一处）。
 *
 * ## 缺口要如实说
 *
 * 结果被截断时必须写进 `缺口`：模型只看到 50 条就下结论，比看不到更危险。
 */

export interface 工具结果 {
  readonly 数据: unknown
  /** 这次取数用了哪些列、按什么过滤。 */
  readonly 口径?: string
  /** 这次没覆盖到的（如实说）。 */
  readonly 缺口?: readonly string[]
}

export type 工具错误码 = "not_a_member" | "bad_input" | "not_found"

export class 工具错误 extends Error {
  readonly code: 工具错误码
  constructor(code: 工具错误码, message: string) {
    super(message)
    this.code = code
    this.name = "工具错误"
  }
}

export interface 工具上下文 {
  readonly db: Queryable
  readonly 身份: 调用身份
}

export const 默认限制 = 50
export const 最大限制 = 200

/** JS 侧的大小写比较与 SQL 的 `ilike` 对齐（`ilike` 不区分大小写）。 */
function lower(值: string): string {
  return 值.toLowerCase()
}

/**
 * 命中片段：以第一个命中为中心前后各 40 个字符。**必须在 JS 做**——SQL 的 substring
 * 按字节切会把中文切碎。不区分大小写：SQL 那边是 `ilike`，这里若用大小写敏感的
 * `indexOf`，大写命中会返回 null，模型看不出为什么这行被搜到。
 */
export function 片段(正文: string, 关键词: string | undefined, 半径 = 40): string | null {
  if (关键词 === undefined || 关键词 === "" || 正文 === "") return null
  const 位置 = 正文.toLowerCase().indexOf(关键词.toLowerCase())
  if (位置 < 0) return null
  return 正文.slice(Math.max(0, 位置 - 半径), Math.min(正文.length, 位置 + 关键词.length + 半径))
}

/**
 * `text[]` / `jsonb` 一律**以 JSON 文本出库**再解析：仓内没有「驱动读回形状」的约定或先例
 * 可依（`case-fact-read.ts:22-25` 记的是同一件事）。查询写 `array_to_json(col)::text` 或
 * `col::text`，出库形状就与驱动无关；裸选后 `as string[]` 则把「程序库给数组还是给
 * `"{a,b}"` 文本」这种不确定行为直接当成契约，测试与生产一旦不同就是绿在测试、错在生产。
 *
 * （不要把风险归因到某个具体驱动：2026-11-06 复审用真 PG、PGlite socket 与
 * `drizzle-orm/pglite` 三处实测，裸选 `text[]` / `jsonb` 都回数组 / 对象。结论是
 * 「没有先例，所以不给它机会」，不是「某个驱动会回字符串」。）
 */
export function 解JSON<T>(值: unknown, 兜底: T): T {
  if (typeof 值 !== "string" || 值 === "") return 兜底
  try {
    return JSON.parse(值) as T
  } catch {
    return 兜底
  }
}

/**
 * 限制归一化。**超上限是截断不是报错**（模型给 999 是常见行为），但必须在 `缺口` 里
 * 说清；非正整数是模型用错了参数，回 `bad_input` 让它改。
 */
export function 归一化限制(值: number | undefined): number {
  if (值 === undefined) return 默认限制
  if (!Number.isInteger(值) || 值 <= 0) throw new 工具错误("bad_input", `限制必须是正整数，收到 ${String(值)}`)
  return Math.min(值, 最大限制)
}

/**
 * 截断说明。两种「可能还有更多」都要讲：请求本身超了上限，或结果正好撞到本次限制。
 * 只按「实得行数 === 限制」判会让「模型要 999、实际只有 3 行」静默丢掉上限这件事。
 */
export function 截断缺口(请求: number | undefined, 限制: number, 实得行数: number): string[] {
  const 句: string[] = []
  if (请求 !== undefined && 请求 > 最大限制) 句.push(`请求的 ${请求} 条超过上限，已按 ${最大限制} 条取`)
  if (实得行数 === 限制) 句.push(`已截到前 ${限制} 条，可能还有更多`)
  return 句
}

/** 成员校验放在调用入口一次，不是每个工具各判一次（`LEARNINGS #004-09`：门在副作用之前）。 */
export async function 校验成员(ctx: 工具上下文): Promise<void> {
  const rows = await ctx.db.execute(sql`
    select 1 from auth.project_member
     where project_id = ${ctx.身份.projectId} and user_id = ${ctx.身份.userId}
     limit 1
  `)
  if (rowsOf(rows).length === 0) {
    throw new 工具错误("not_a_member", `你不是项目「${ctx.身份.projectId}」的成员，看不到它的数据`)
  }
}

export async function search_materials(
  ctx: 工具上下文,
  args: { 关键词?: string; 类型?: string; 限制?: number },
): Promise<工具结果> {
  const 限制 = 归一化限制(args.限制)
  const 条件: SQL[] = [sql`project_id = ${ctx.身份.projectId}`]
  if (args.类型 !== undefined) 条件.push(sql`kind = ${args.类型}`)
  const 关键词 = args.关键词?.trim()
  if (关键词 !== undefined && 关键词 !== "") {
    const 模式 = `%${关键词}%`
    条件.push(sql`(file_name ilike ${模式} or coalesce(text_content, '') ilike ${模式})`)
  }
  const rows = await ctx.db.execute(sql`
    select id, file_name, kind, parse_status, coalesce(text_content, '') as text_content,
           created_at
      from auth.case_material
     where ${sql.join(条件, sql` and `)}
     order by created_at desc, id desc
     limit ${限制}
  `)
  const 数据 = rowsOf(rows).map((行) => ({
    id: 行.id as string,
    file_name: 行.file_name as string,
    kind: 行.kind as string,
    parse_status: 行.parse_status as string,
    片段: 片段(行.text_content as string, 关键词),
    命中文件名: 关键词 !== undefined && lower(行.file_name as string).includes(lower(关键词)),
  }))
  return {
    数据,
    口径: "材料检索按文件名与正文关键词（ilike），材料类型仅限本项目；正文命中给片段不给全文。",
    缺口: 截断缺口(args.限制, 限制, 数据.length),
  }
}

export async function query_entities(
  ctx: 工具上下文,
  args: { 类型?: string; 关键词?: string; 含已排除?: boolean; 限制?: number },
): Promise<工具结果> {
  const 限制 = 归一化限制(args.限制)
  const 条件: SQL[] = [sql`project_id = ${ctx.身份.projectId}`]
  if (args.类型 !== undefined) 条件.push(sql`type = ${args.类型}`)
  const 关键词 = args.关键词?.trim()
  if (关键词 !== undefined && 关键词 !== "") {
    const 模式 = `%${关键词}%`
    条件.push(
      sql`(canonical_value ilike ${模式} or exists (select 1 from unnest(aliases) as 别名 where 别名 ilike ${模式}))`,
    )
  }
  if (args.含已排除 !== true) 条件.push(sql`trust_state <> '已排除'`)
  const rows = await ctx.db.execute(sql`
    select id, type, canonical_value, array_to_json(aliases)::text as aliases, attrs::text as attrs,
           trust_state, created_at
      from auth.case_entity
     where ${sql.join(条件, sql` and `)}
     order by type asc, canonical_value asc, id asc
     limit ${限制}
  `)
  const 数据 = rowsOf(rows).map((行) => ({
    id: 行.id as string,
    type: 行.type as string,
    canonical_value: 行.canonical_value as string,
    aliases: 解JSON<string[]>(行.aliases, []),
    attrs: 解JSON<unknown>(行.attrs, {}),
    trust_state: 行.trust_state as string,
    created_at: 行.created_at as number,
  }))
  return {
    数据,
    口径: "实体按类型与规范值/别名关键词过滤；默认不含「已排除」（设计 §9.1）。",
    缺口: 截断缺口(args.限制, 限制, 数据.length),
  }
}

/**
 * 实体解析：id 优先、其次规范值；都查不到 ⇒ not_found（`称呼` 进文案，说清是哪一方）。
 *
 * 规范值跨类型可重名（唯一索引是 `(project_id, type, canonical_value)`，见 0031），
 * 所以第二段必须按 `type asc, id asc` 取确定的第一条——不许「取到哪条算哪条」。
 */
export async function 解析实体(
  ctx: 工具上下文,
  值: string,
  称呼: string,
): Promise<{ id: string; value: string; type: string }> {
  const rows = await ctx.db.execute(sql`
    select id, type, canonical_value from auth.case_entity
     where project_id = ${ctx.身份.projectId} and (id = ${值} or canonical_value = ${值})
     order by (id = ${值}) desc, type asc, id asc
     limit 1
  `)
  const 行 = rowsOf(rows)[0]
  if (行 === undefined) throw new 工具错误("not_found", `本项目里找不到${称呼}：${值}`)
  return { id: String(行.id), value: String(行.canonical_value), type: String(行.type) }
}

/** `起` / `止` 都是整数 Unix 秒；非整数、或起大于止，都是模型用错参数。 */
function 校验时间窗(args: { 起?: number; 止?: number }): void {
  for (const [名, 值] of [["起", args.起], ["止", args.止]] as const) {
    if (值 !== undefined && !Number.isInteger(值)) {
      throw new 工具错误("bad_input", `${名} 必须是整数（Unix 秒），收到 ${String(值)}`)
    }
  }
  if (args.起 !== undefined && args.止 !== undefined && args.起 > args.止) {
    throw new 工具错误("bad_input", `时间窗的起大于止：${args.起} > ${args.止}`)
  }
}

/**
 * 计划 5 的 `引用视图`（camelCase）→ 本层的库列名口径。只这 7 个字段，别扩。
 *
 * `row` 分支与 `entity/relation/event` 分支必须同形——模型不该因为出处挂在哪类事实上
 * 就换一套字段名。
 */
function 引用行(引用们: readonly 引用视图[]) {
  return 引用们.map((条) => ({
    id: 条.id,
    material_id: 条.materialId,
    file_name: 条.fileName,
    path: 条.path,
    locator: 条.locator,
    extract_method: 条.extractMethod,
    confidence: 条.confidence,
  }))
}

/**
 * 关系：按实体（id 或规范值）与类型过滤，时间窗按「区间有交集」判。
 *
 * 金额列是 `numeric(18,2)`，一律 `::text` 出库当字符串原样返回（`#002-01`：number 绑定 /
 * 读回的形态随驱动而变，还可能带浮点尾差）。
 */
export async function query_relations(
  ctx: 工具上下文,
  args: { 实体?: string; 类型?: string; 起?: number; 止?: number; 含已排除?: boolean; 限制?: number },
): Promise<工具结果> {
  校验时间窗(args)
  const 限制 = 归一化限制(args.限制)
  const 条件: SQL[] = [sql`r.project_id = ${ctx.身份.projectId}`]
  if (args.实体 !== undefined) {
    const 实体 = await 解析实体(ctx, args.实体, "实体")
    条件.push(sql`(r.from_id = ${实体.id} or r.to_id = ${实体.id})`)
  }
  if (args.类型 !== undefined) 条件.push(sql`r.type = ${args.类型}`)
  if (args.含已排除 !== true) 条件.push(sql`r.trust_state <> '已排除'`)
  // 「与窗口有交集」：最晚的一次不早于起，且最早的一次不晚于止。两端都缺时按 0 兜底，
  // 让「没有时间的关系」只在没有窗口约束时出现。
  if (args.起 !== undefined) 条件.push(sql`coalesce(r.last_at, r.first_at, 0) >= ${args.起}`)
  if (args.止 !== undefined) 条件.push(sql`coalesce(r.first_at, r.last_at, 0) <= ${args.止}`)
  const rows = await ctx.db.execute(sql`
    select r.id, r.from_id, r.to_id, r.type, r.first_at, r.last_at, r.precision,
           r.times, r.amount::text as amount, r.basis, r.source_kind, r.trust_state,
           起.canonical_value as from_value, 终.canonical_value as to_value
      from auth.case_relation r
      join auth.case_entity 起 on 起.project_id = r.project_id and 起.id = r.from_id
      join auth.case_entity 终 on 终.project_id = r.project_id and 终.id = r.to_id
     where ${sql.join(条件, sql` and `)}
     order by r.last_at desc nulls last, r.first_at desc nulls last, r.id asc
     limit ${限制}
  `)
  const 数据 = rowsOf(rows).map((行) => ({
    id: 行.id as string,
    from_id: 行.from_id as string,
    to_id: 行.to_id as string,
    type: 行.type as string,
    first_at: 行.first_at as number | null,
    last_at: 行.last_at as number | null,
    precision: 行.precision as string | null,
    times: 行.times as number | null,
    amount: 行.amount as string | null,
    basis: 行.basis as string | null,
    source_kind: 行.source_kind as string,
    trust_state: 行.trust_state as string,
    from_value: 行.from_value as string | null,
    to_value: 行.to_value as string | null,
  }))
  return {
    数据,
    口径:
      "关系按实体（先按 id、再按规范值解析；规范值跨类型可重名时按 type 升序、id 升序取第一条）与类型过滤；" +
      "时间窗按「与窗口有交集」判定；默认不含「已排除」；金额为 numeric 字符串，勿自行转浮点；" +
      "时间以规范值（UTC+8）比较，按各自精度标注。",
    缺口: 截断缺口(args.限制, 限制, 数据.length),
  }
}

/** 事件：按类型与参与实体过滤，时间按 `occurred_at` 闭区间。 */
export async function query_events(
  ctx: 工具上下文,
  args: { 起?: number; 止?: number; 类型?: string; 参与实体?: string; 含已排除?: boolean; 限制?: number },
): Promise<工具结果> {
  校验时间窗(args)
  const 限制 = 归一化限制(args.限制)
  const 条件: SQL[] = [sql`project_id = ${ctx.身份.projectId}`]
  if (args.类型 !== undefined) 条件.push(sql`type = ${args.类型}`)
  if (args.含已排除 !== true) 条件.push(sql`trust_state <> '已排除'`)
  if (args.起 !== undefined) 条件.push(sql`occurred_at is not null and occurred_at >= ${args.起}`)
  if (args.止 !== undefined) 条件.push(sql`occurred_at is not null and occurred_at <= ${args.止}`)
  if (args.参与实体 !== undefined) {
    const 参与实体 = await 解析实体(ctx, args.参与实体, "参与实体")
    条件.push(sql`exists (select 1 from unnest(participants) as 参与者 where 参与者 = ${参与实体.id})`)
  }
  const rows = await ctx.db.execute(sql`
    select id, type, occurred_at, occurred_raw, precision, time_type,
           array_to_json(participants)::text as participants, summary, trust_state
      from auth.case_event
     where ${sql.join(条件, sql` and `)}
     order by occurred_at desc nulls last, id asc
     limit ${限制}
  `)
  const 数据 = rowsOf(rows).map((行) => ({
    id: 行.id as string,
    type: 行.type as string,
    occurred_at: 行.occurred_at as number | null,
    occurred_raw: 行.occurred_raw as string | null,
    precision: 行.precision as string | null,
    time_type: 行.time_type as string | null,
    participants: 解JSON<string[]>(行.participants, []),
    summary: 行.summary as string | null,
    trust_state: 行.trust_state as string,
  }))
  return {
    数据,
    口径:
      "事件按类型与参与实体（先按 id、再按规范值解析成实体 id）过滤；时间按 occurred_at 闭区间；" +
      "默认不含「已排除」；时间以规范值（UTC+8）比较，按各自精度标注。",
    缺口: 截断缺口(args.限制, 限制, 数据.length),
  }
}

/**
 * 出处：`entity` / `relation` / `event` 直接复用计划 5 的只读出口 `事实详情`——它已经把
 * 引用与变更历史一并读回来；`row` 的明细行没有代理主键，按 `<material_id>#<sheet>#<row_no>`
 * 解析后查行，再取该行的引用。
 *
 * ⛔ 不要在这里自己写 SQL 查事实表：那是计划 5 的两个只读出口已经做完的事，
 * 抄第二份就是给「已排除是否可见」这根判据开第二个会漂的点（`LEARNINGS #005-04`）。
 */
export async function get_citation(
  ctx: 工具上下文,
  args: { 事实类型: "entity" | "relation" | "event" | "row"; 事实id: string },
): Promise<工具结果> {
  if (args.事实类型 === "row") {
    const 段 = args.事实id.split("#")
    if (段.length !== 3 || 段.some((s) => s.trim() === "")) {
      throw new 工具错误("bad_input", `明细行 id 形状应为「材料#工作表#行号」，收到 ${args.事实id}`)
    }
    const [材料, 工作表, 行号] = 段 as [string, string, string]
    if (!Number.isInteger(Number(行号))) {
      throw new 工具错误("bad_input", `行号必须是整数，收到 ${行号}`)
    }
    const 行 = rowsOf(
      await ctx.db.execute(sql`
        select project_id, material_id, sheet, row_no, caller, callee, started_at, started_raw,
               precision, time_type, duration_sec, amount::text as amount, balance::text as balance,
               counterparty, extras::text as extras
          from auth.case_fact_row
         where project_id = ${ctx.身份.projectId} and material_id = ${材料}
           and sheet = ${工作表} and row_no = ${Number(行号)}
      `),
    )[0]
    if (行 === undefined) throw new 工具错误("not_found", `本项目里没有这条明细行：${args.事实id}`)
    // `引用们` 的第三参类型是 `留痕类型`（entity/relation/event），但 `case_citation.fact_type`
    // 的库约束也允许 `row`——计划 5 的单条事实详情只服务三类事实，没把 row 收进类型。
    // SQL 按字符串比较、不依赖这个类型，所以只在调用点摊开，不复制第二份引用查询。
    const 引用 = await 引用们(ctx.db, ctx.身份.projectId, "row" as unknown as 留痕类型, args.事实id)
    return {
      数据: {
        明细行: {
          project_id: 行.project_id as string,
          material_id: 行.material_id as string,
          sheet: 行.sheet as string,
          row_no: 行.row_no as number,
          caller: 行.caller as string | null,
          callee: 行.callee as string | null,
          started_at: 行.started_at as number | null,
          started_raw: 行.started_raw as string | null,
          precision: 行.precision as string | null,
          time_type: 行.time_type as string | null,
          duration_sec: 行.duration_sec as number | null,
          amount: 行.amount as string | null,
          balance: 行.balance as string | null,
          counterparty: 行.counterparty as string | null,
          extras: 解JSON<unknown>(行.extras, {}),
        },
        引用: 引用行(引用),
      },
      口径: "明细行按「材料#工作表#行号」解析；`引用` 为库列名。",
    }
  }
  const 事实 = await 事实详情(ctx.db, {
    projectId: ctx.身份.projectId,
    type: args.事实类型,
    id: args.事实id,
    includeExcluded: true,
  })
  if (事实 === undefined) throw new 工具错误("not_found", `本项目里没有这条${args.事实类型}：${args.事实id}`)
  const { citations, changes, ...本体 } = 事实
  return {
    数据: { 事实: 本体, 引用: 引用行(citations), 变更历史: changes },
    口径: "`事实` 与 `变更历史` 沿用仓内只读出口的字段名，`引用` 为库列名。",
  }
}
