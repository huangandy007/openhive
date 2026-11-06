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
    口径: "材料检索按文件名与正文关键词（ilike），材料范围仅限本项目；正文命中给片段不给全文。",
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
  if (args.含已排除 !== true) {
    条件.push(sql`r.trust_state <> '已排除'`)
    // §9.1：「已排除」不只是关系自身的信任态，端点实体被排除时这条关系同样不该回到回答里。
    条件.push(sql`起.trust_state <> '已排除'`)
    条件.push(sql`终.trust_state <> '已排除'`)
  }
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
      "时间窗按「与窗口有交集」判定；默认不含「已排除」的关系及其端点实体；金额为 numeric 字符串，勿自行转浮点；" +
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
    // `participants` 存的是**实体规范值**，不是 id：唯一写口 `case-extract.ts:433` 写的是
    // `项实体.canonicalValue`（`case-ingest.ts:573` 原样落库），而实体 id 是 `事实id(...)` 的
    // sha256 前 32 位，两者永不相等。比 id 会让过滤在生产数据上恒空、静默返回 []（`#006-11`）。
    条件.push(sql`exists (select 1 from unnest(participants) as 参与者 where 参与者 = ${参与实体.value})`)
  }
  // §9.1：`participants` 存的是实体规范值、不是 id，join 不到实体表；先取本项目「已排除」
  // 实体的规范值集合，出库后在 JS 里按值剔除（实现不足 20 行，故不选「写进缺口」的退路）。
  const 已排除值 = new Set<string>()
  if (args.含已排除 !== true) {
    const 排除行 = rowsOf(
      await ctx.db.execute(sql`
        select distinct canonical_value from auth.case_entity
         where project_id = ${ctx.身份.projectId} and trust_state = '已排除'
      `),
    )
    for (const 行 of 排除行) 已排除值.add(String(行.canonical_value))
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
    participants: 解JSON<string[]>(行.participants, []).filter((值) => !已排除值.has(值)),
    summary: 行.summary as string | null,
    trust_state: 行.trust_state as string,
  }))
  return {
    数据,
    口径:
      "事件按类型与参与实体（先按 id、再按规范值解析成实体规范值；规范值跨类型可重名时按 type 升序、" +
      "id 升序取第一条）过滤；时间按 occurred_at 闭区间；默认不含「已排除」的事件，" +
      "participants 里「已排除」实体的规范值也一并剔除；时间以规范值（UTC+8）比较，按各自精度标注。",
    缺口: 截断缺口(args.限制, 限制, 数据.length),
  }
}

/**
 * 出处：`entity` / `relation` / `event` 直接复用计划 5 的只读出口 `事实详情`——它已经把
 * 引用与变更历史一并读回来；`row` 的明细行没有代理主键，按 `<material_id>#<sheet>#<row_no>` 的
 * **首/末 `#`** 解析（中间整段是工作表名，可含 `#`）后查行，再按规范化键取该行的引用。
 *
 * ⛔ 不要在这里自己写 SQL 查事实表：那是计划 5 的两个只读出口已经做完的事，
 * 抄第二份就是给「已排除是否可见」这根判据开第二个会漂的点（`LEARNINGS #005-04`）。
 */
export async function get_citation(
  ctx: 工具上下文,
  args: { 事实类型: "entity" | "relation" | "event" | "row"; 事实id: string },
): Promise<工具结果> {
  if (args.事实类型 === "row") {
    // 首 `#` 结束材料（材料 id 不含 `#`），末 `#` 开始行号，中间的整段都是工作表名（可含 `#`）。
    // `case-store.ts:423-432` 的契约：Excel 工作表名可以合法含 `#`，按固定段数拆是错的。
    const 首 = args.事实id.indexOf("#")
    const 末 = args.事实id.lastIndexOf("#")
    if (首 <= 0 || 末 === 首) {
      throw new 工具错误("bad_input", `明细行 id 形状应为「材料#工作表#行号」，收到 ${args.事实id}`)
    }
    const 材料 = args.事实id.slice(0, 首)
    const 工作表 = args.事实id.slice(首 + 1, 末)
    const 行号 = args.事实id.slice(末 + 1)
    if (材料.trim() === "" || 工作表 === "" || 行号.trim() === "") {
      throw new 工具错误("bad_input", `明细行 id 形状应为「材料#工作表#行号」，收到 ${args.事实id}`)
    }
    if (!Number.isInteger(Number(行号))) {
      throw new 工具错误("bad_input", `行号必须是整数，收到 ${行号}`)
    }
    // 引用按**规范化键**查：`"…#Sheet1#02"` 能命中明细行，但原始的 `02` 不是库里 `fact_id` 的写法。
    const 规范键 = `${材料}#${工作表}#${Number(行号)}`
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
    const 引用 = await 引用们(ctx.db, ctx.身份.projectId, "row" as unknown as 留痕类型, 规范键)
    // `case_citation.fact_type='row'` 今天**没有生产写入者**（`case-ingest.ts` 只写
    // entity/relation/event 三处；测试里的 row 引用是手工种的）。查不到就如实说，
    // 别让模型以为「没有出处」等于「这行没有依据」。
    const 缺口 =
      引用.length === 0
        ? (["明细行引用尚未在生产写入，查不到时只能按 material/sheet/row_no 定位"] as const)
        : undefined
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
      ...(缺口 === undefined ? {} : { 缺口 }),
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

/** 三个块的固定上界（没有 `限制` 参数，写在 SQL 里）。 */
const 对手方上限 = 10
const 余额行上限 = 200
const 每侧关系上限 = 500
const 共同时空上限 = 50

/**
 * 资金聚合：汇总 / 对手方 / 余额走势三块，**每块的口径与缺口随结果一起返回**。
 *
 * 账户先解析成实体（`解析实体` 给 `{ id, value }`）：
 * - 关系类（汇总、对手方）比 `from_id` / `to_id`，用 `id`；
 * - 明细行（余额走势）比 `counterparty` / `caller` / `callee`，用 `value`——
 *   明细行里存的是实体**规范值**，不是 id（Task 3 复审的 Critical：按 id 比在生产恒空）。
 *
 * 金额与余额一律 `::text` 出库当字符串：`numeric` 的读回形状随驱动而变，`::text` 两个驱动
 * 拿到的是同一串（并保留列的小数位，`"100.00"` 不会变成 `100`）。
 */
export async function aggregate_money(
  ctx: 工具上下文,
  args: { 账户: string; 起?: number; 止?: number },
): Promise<工具结果> {
  校验时间窗(args)
  const 账户 = await 解析实体(ctx, args.账户, "账户")

  const 汇总条件: SQL[] = [
    sql`project_id = ${ctx.身份.projectId}`,
    sql`type = '转账'`,
    sql`trust_state <> '已排除'`,
    sql`(from_id = ${账户.id} or to_id = ${账户.id})`,
  ]
  const 对手方条件: SQL[] = [
    sql`r.project_id = ${ctx.身份.projectId}`,
    sql`r.type = '转账'`,
    sql`r.trust_state <> '已排除'`,
    sql`(r.from_id = ${账户.id} or r.to_id = ${账户.id})`,
  ]
  // 时间窗与 `query_relations` 同口径：最晚不早于「起」、最早不晚于「止」，两端都缺按 0 兜底。
  if (args.起 !== undefined) {
    汇总条件.push(sql`coalesce(last_at, first_at, 0) >= ${args.起}`)
    对手方条件.push(sql`coalesce(r.last_at, r.first_at, 0) >= ${args.起}`)
  }
  if (args.止 !== undefined) {
    汇总条件.push(sql`coalesce(first_at, last_at, 0) <= ${args.止}`)
    对手方条件.push(sql`coalesce(r.first_at, r.last_at, 0) <= ${args.止}`)
  }

  const 汇总 = rowsOf(
    await ctx.db.execute(sql`
      select case when from_id = ${账户.id} then '出' else '入' end as 方向,
             count(*)::int as 笔数,
             coalesce(sum(amount), 0)::text as 合计
        from auth.case_relation
       where ${sql.join(汇总条件, sql` and `)}
       group by 方向
       order by 方向
    `),
  ).map((行) => ({
    方向: String(行.方向),
    笔数: Number(行.笔数),
    合计: String(行.合计),
  }))
  // 执行序不依赖库的字符串排序：2026-11-06 本机 PGlite 实测 `order by 方向` 先回「入」，
  // 而口径固定「出 → 入」。缺了这一步，同样的库、不同的 collation 就会换顺序。
  汇总.sort((左, 右) => (左.方向 === "出" ? 0 : 1) - (右.方向 === "出" ? 0 : 1))

  // §9.1：对手方实体被「已排除」时，不能把它的名字与金额一起回给模型（join 条件里过滤）。
  const 对手方 = rowsOf(
    await ctx.db.execute(sql`
      select 对手.canonical_value as 对手方,
             case when r.from_id = ${账户.id} then '出' else '入' end as 方向,
             count(*)::int as 笔数,
             coalesce(sum(r.amount), 0)::text as 合计
        from auth.case_relation r
        join auth.case_entity 对手
          on 对手.project_id = r.project_id
         and 对手.id = case when r.from_id = ${账户.id} then r.to_id else r.from_id end
         and 对手.trust_state <> '已排除'
       where ${sql.join(对手方条件, sql` and `)}
       group by 对手.canonical_value, 方向
       order by sum(r.amount) desc nulls last, 对手.canonical_value asc
       limit ${对手方上限}
    `),
  ).map((行) => ({
    对手方: String(行.对手方),
    方向: String(行.方向),
    笔数: Number(行.笔数),
    合计: String(行.合计),
  }))

  const 余额条件: SQL[] = [
    sql`project_id = ${ctx.身份.projectId}`,
    sql`(counterparty = ${账户.value} or caller = ${账户.value} or callee = ${账户.value})`,
  ]
  if (args.起 !== undefined) 余额条件.push(sql`started_at is not null and started_at >= ${args.起}`)
  if (args.止 !== undefined) 余额条件.push(sql`started_at is not null and started_at <= ${args.止}`)
  const 余额行 = rowsOf(
    await ctx.db.execute(sql`
      select material_id, sheet, row_no, started_at,
             amount::text as amount, balance::text as balance
        from auth.case_fact_row
       where ${sql.join(余额条件, sql` and `)}
       order by started_at asc nulls last, material_id asc, sheet asc, row_no asc
       limit ${余额行上限}
    `),
  )
  // `balance` 为 null 的行不参与首末与极值。`started_at` 为 null 的行**不能当「末」**：
  // `nulls last` 会让它排在数组最后，但它没有时间，不代表「最后一条流水」——首末只取
  // 有时间且余额非 null 的行（SQL 已按 `started_at` 升序排好）。
  const 余额们 = 余额行.flatMap((行) => (typeof 行.balance === "string" ? [行.balance] : []))
  const 有序余额 = 余额行.flatMap((行) =>
    typeof 行.balance === "string" && typeof 行.started_at === "number" ? [行.balance] : [],
  )
  const 余额走势 =
    余额行.length === 0
      ? null
      : 余额们.length === 0
        ? { 首: null, 末: null, 最高: null, 最低: null, 行数: 余额行.length }
        : {
            首: 有序余额[0] ?? null,
            末: 有序余额[有序余额.length - 1] ?? null,
            最高: 余额们.reduce((甲, 乙) => (Number(乙) > Number(甲) ? 乙 : 甲)),
            最低: 余额们.reduce((甲, 乙) => (Number(乙) < Number(甲) ? 乙 : 甲)),
            行数: 余额行.length,
          }

  const 缺口 = [
    "只统计已抽成关系（type=转账）的转账；明细行里未抽成关系的转账不计入",
    "对手方按实体规范值聚合；未合并的重复实体不会自动合并",
    `对手方最多 ${对手方上限} 条（按合计金额降序）`,
    "余额只按精确匹配取明细行，未做模糊匹配；超过 200 行截断",
  ]
  // 与 `截断缺口` 同口径：命中上限才说「可能还有更多」，没满就不制造假警报。
  if (对手方.length === 对手方上限) 缺口.push(`对手方已截到前 ${对手方上限} 条，可能还有更多`)
  if (余额行.length === 0) 缺口.push("本项目明细行里没有该账户的流水（按 counterparty/caller/callee 精确匹配）")

  return {
    数据: { 汇总, 对手方, 余额走势 },
    口径:
      "汇总与对手方只统计 type=转账 且非「已排除」的关系（对手方实体也须非「已排除」），按出/入分组；" +
      "账户先按 id、再按规范值解析，规范值跨类型可重名时按 type 升序、id 升序取第一条；" +
      "金额为 numeric 字符串，勿自行转浮点；" +
      "余额走势按明细行的 counterparty/caller/callee 精确匹配账户的实体规范值。",
    缺口,
  }
}

/**
 * 交叉分析：共同关联（关系另一端的交集）＋ 共同时空（事件参与者同时含两人）。
 *
 * 共同关联**每侧各查一次**再在 JS 求交：合成一条 `or` 查询再 `limit 500` 会让一方的边
 * 把配额吃光，另一方的交集被静默截断。
 *
 * 共同时空必须比 `participants` 里的**实体规范值**（不是 id）：`participants` 的唯一写口
 * `case-extract.ts:433` 写的是 `canonicalValue`，拿 id 比会恒空。
 */
export async function find_crossings(
  ctx: 工具上下文,
  args: { 甲: string; 乙: string; 起?: number; 止?: number },
): Promise<工具结果> {
  校验时间窗(args)
  const 甲 = await 解析实体(ctx, args.甲, "甲")
  const 乙 = await 解析实体(ctx, args.乙, "乙")
  // fail-closed：`participants @> array[X, X]` 的多重集语义对只含一个 X 的事件可能恒假
  // （漏报），「找自己与自己的交叉」本身也没有意义——不要静默返回空。
  // 只比 id 挡不住「同一规范值、不同类型」的两条实体行（`case_entity` 唯一索引含 type）；
  // 从两个方向问同一个值时，按 id 解析与按规范值解析会落到不同的行。
  if (甲.id === 乙.id || 甲.value === 乙.value) {
    throw new 工具错误("bad_input", `甲和乙是同一个实体（或同一规范值）：${甲.value}，找自己与自己的交叉没有意义`)
  }

  const 另一端们 = async (实体id: string): Promise<{ 值们: string[]; 用满: boolean }> => {
    const 值们 = rowsOf(
      await ctx.db.execute(sql`
        select case when from_id = ${实体id} then to_id else from_id end as 另一端
          from auth.case_relation
         where project_id = ${ctx.身份.projectId} and trust_state <> '已排除'
           and (from_id = ${实体id} or to_id = ${实体id})
         order by 另一端 asc
         limit ${每侧关系上限}
      `),
    ).map((行) => String(行.另一端))
    return { 值们, 用满: 值们.length === 每侧关系上限 }
  }
  // 顺序执行：夹具把多条连接汇进同一个 PG 会话，不并发建两份语句缓存。
  const 侧甲 = await 另一端们(甲.id)
  const 侧乙 = await 另一端们(乙.id)
  const 乙集 = new Set(侧乙.值们)
  const 交集 = [...new Set(侧甲.值们)].filter((id) => 乙集.has(id))

  const 共同关联 =
    交集.length === 0
      ? []
      : rowsOf(
          await ctx.db.execute(sql`
            select id, type, canonical_value as value, trust_state
              from auth.case_entity
             where project_id = ${ctx.身份.projectId} and trust_state <> '已排除'
               and id in (${sql.join(
                 交集.map((id) => sql`${id}`),
                 sql`, `,
               )})
             order by value asc, id asc
          `),
        ).map((行) => ({
          id: String(行.id),
          type: String(行.type),
          value: String(行.value),
          trust_state: String(行.trust_state),
        }))

  const 时空条件: SQL[] = [
    sql`project_id = ${ctx.身份.projectId}`,
    sql`participants @> array[${甲.value}, ${乙.value}]::text[]`,
    sql`trust_state <> '已排除'`,
  ]
  if (args.起 !== undefined) 时空条件.push(sql`occurred_at is not null and occurred_at >= ${args.起}`)
  if (args.止 !== undefined) 时空条件.push(sql`occurred_at is not null and occurred_at <= ${args.止}`)
  const 共同时空 = rowsOf(
    await ctx.db.execute(sql`
      select id, type, occurred_at, occurred_raw, precision,
             array_to_json(participants)::text as participants, summary
        from auth.case_event
       where ${sql.join(时空条件, sql` and `)}
       order by occurred_at desc nulls last, id asc
       limit ${共同时空上限}
    `),
  ).map((行) => ({
    id: String(行.id),
    type: String(行.type),
    occurred_at: 行.occurred_at as number | null,
    occurred_raw: 行.occurred_raw as string | null,
    precision: 行.precision as string | null,
    participants: 解JSON<string[]>(行.participants, []),
    summary: 行.summary as string | null,
  }))

  const 缺口 = [
    "按关系连通算；同一实体若被拆成两条未合并的实体，交集会漏",
    `共同时空最多 ${共同时空上限} 条（按 occurred_at 倒序）`,
  ]
  if (侧甲.用满 || 侧乙.用满) 缺口.push("每侧最多取 500 条关系，交集可能不全")
  if (共同时空.length === 共同时空上限) 缺口.push(`共同时空已截到前 ${共同时空上限} 条，可能还有更多`)
  缺口.push("共同时空按事件参与实体判；只覆盖已抽成事件的时空点")

  return {
    数据: { 共同关联, 共同时空 },
    口径:
      "共同关联取与甲、乙各自相连且非「已排除」的关系的另一端实体，两侧各至多 500 条后在服务端求交；" +
      "甲、乙均先按 id、再按规范值解析，规范值跨类型可重名时按 type 升序、id 升序取第一条；" +
      "共同时空按事件 participants（实体规范值）同时包含两人判定，时间按 occurred_at 闭区间。",
    缺口,
  }
}
