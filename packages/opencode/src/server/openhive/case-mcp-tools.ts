import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 默认限制, 最大限制, 数据为空, type 出处项, type 下一步项, type 空原因值 } from "./case-envelope"
import type { Queryable } from "./case-store"
import type { 调用身份 } from "./case-mcp-identity"
import { 事实详情, 引用们, type 引用视图 } from "./case-fact-read"
import { 查明细行, 明细入参错误, 读明细行, type 明细查询结果 } from "./case-row-query"
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
  /** 人话，不是数据复述。民警在会话里看到的是这一行（`09` §3.2）。 */
  readonly 摘要: string
  readonly 数据: unknown
  /** 这次取数用了哪些列、按什么过滤。必填。 */
  readonly 口径: string
  /** 这次没覆盖到的（如实说）。无缺口给 `[]`。必填。 */
  readonly 缺口: readonly string[]
  /** 有数据时为 `null`；无数据时必须是 `空原因枚举` 里的值。 */
  readonly 空原因: 空原因值 | null
  /** 只放能支撑 `摘要` 里那些数字的代表行。 */
  readonly 出处: readonly 出处项[]
  /** 建议，不自动执行。 */
  readonly 下一步: readonly 下一步项[]
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

export { 默认限制, 最大限制 } from "./case-envelope"

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
  const 空 = 数据为空(数据)
  return {
    摘要: 空
      ? `没有材料命中${args.关键词 ? `「${args.关键词}」` : ""}${args.类型 ? `（类型=${args.类型}）` : ""}`
      : `命中 ${数据.length} 份材料${args.关键词 ? `（关键词「${args.关键词}」）` : ""}${args.类型 ? `（类型=${args.类型}）` : ""}`,
    数据,
    口径: "材料检索按文件名与正文关键词（ilike），材料范围仅限本项目；正文命中给片段不给全文。",
    缺口: 截断缺口(args.限制, 限制, 数据.length),
    空原因: 空 ? "无匹配行" : null,
    // `代表` 是**下钻入参**（材料 id），不是事实 id：`query_rows` 的 `材料` 直接吃它。
    // `query_rows` 已注册，这条下钻可用。
    出处: 数据.slice(0, 3).map((行) => ({
      事实: `命中材料「${String(行.file_name)}」`,
      代表: String(行.id),
      可下钻: "query_rows",
    })),
    下一步: 空
      ? [{ 工具: "query_entities", 参数: {}, 为什么: "换个说法或按实体名再找；材料名搜不到时实体往往还在" }]
      : [{ 工具: "query_rows", 参数: { 材料: String(数据[0]!.id) }, 为什么: "看这份材料里的明细行" }],
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
  const 空 = 数据为空(数据)
  return {
    摘要: 空
      ? `没有实体匹配${args.关键词 ? `「${args.关键词}」` : ""}${args.类型 ? `（类型=${args.类型}）` : ""}`
      : `找到 ${数据.length} 个实体${args.类型 ? `（类型=${args.类型}）` : ""}，首个是「${String(数据[0]!.canonical_value)}」`,
    数据,
    口径: "实体按类型与规范值/别名关键词过滤；默认不含「已排除」（设计 §9.1）。",
    缺口: 截断缺口(args.限制, 限制, 数据.length),
    空原因: 空 ? "无匹配行" : null,
    出处: 数据.slice(0, 3).map((行) => ({
      事实: `实体「${String(行.canonical_value)}」`,
      代表: String(行.id),
      可下钻: "get_citation",
    })),
    下一步: 空
      ? [{ 工具: "search_materials", 参数: {}, 为什么: "按材料名或正文片段找；实体可能还没从材料里抽出来" }]
      : [{ 工具: "query_relations", 参数: { 实体: String(数据[0]!.canonical_value) }, 为什么: "看它与谁有关系" }],
  }
}

/**
 * 实体解析：id 优先、其次规范值；都查不到 ⇒ not_found（`称呼` 进文案，说清是哪一方）。
 *
 * 规范值跨类型可重名（唯一索引是 `(project_id, type, canonical_value)`，见 0031）。
 * 同值多行时取**最新创建**的那行（`created_at desc`）：入库时的 `纠正大类` 会把错标的
 * 旧行换成一个新类别的行，纠正后的新行总是后建的——按 `type asc` 取会永远命中旧「人」行，
 * 而新关系全挂在「组织」行上，MCP 与图谱页因此矛盾。两个确定性兜底：
 * - `created_at` 是**整数秒**，同秒创建会打平 ⇒ 先按 `(type = '人') asc` 让纠正后的类型
 *   排在未纠正的「人」型前（「非人优先」；纠正只会把「人」改成别的类，旧行才是「人」型）；
 * - 再同型才按 `type asc, id asc` 取确定的第一条——不许「取到哪条算哪条」。
 *
 * `ids` 是**关系过滤**用的 id 集合：按 id 请求时只有那一行（单行语义不扩大）；按规范值
 * 请求时返回同值所有类型行——实体从不删除、重灌只删本材料的引用，旧行上的关系仍在，
 * 只按「最新一行」过滤会让另一份材料的关系静默消失。展示用 `id/type` 仍是排序第一名。
 */
export async function 解析实体(
  ctx: 工具上下文,
  值: string,
  称呼: string,
): Promise<{ id: string; value: string; type: string; ids: string[] }> {
  const rows = rowsOf(
    await ctx.db.execute(sql`
      select id, type, canonical_value from auth.case_entity
       where project_id = ${ctx.身份.projectId} and (id = ${值} or canonical_value = ${值})
       order by (id = ${值}) desc, created_at desc, (type = '人') asc, type asc, id asc
    `),
  )
  const 行 = rows[0]
  if (行 === undefined) throw new 工具错误("not_found", `本项目里找不到${称呼}：${值}`)
  const id = String(行.id)
  const ids =
    id === 值
      ? [id]
      : rows.filter((行) => String(行.canonical_value) === 值).map((行) => String(行.id))
  return { id, value: String(行.canonical_value), type: String(行.type), ids }
}

/** `id in (...)` 片段：`from_id ${id属于(ids)}`。`ids` 至少含展示行，不会为空。 */
function id属于(ids: readonly string[]): SQL {
  return sql`in (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`
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
    // 按值解析时 `ids` 是同值所有类型行：旧「人」行上的关系不能因为纠正后的新行而消失。
    条件.push(sql`(r.from_id ${id属于(实体.ids)} or r.to_id ${id属于(实体.ids)})`)
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
  const 空 = 数据为空(数据)
  const 对方数 = new Set(数据.flatMap((行) => [String(行.from_id), String(行.to_id)])).size
  return {
    摘要: 空
      ? `没有关系命中${args.实体 ? `（实体「${args.实体}」）` : ""}`
      : `${数据.length} 条关系${args.实体 ? `（实体「${args.实体}」）` : ""}，涉及 ${对方数} 个端点`,
    数据,
    口径:
      "关系按实体（先按 id、再按规范值解析；规范值跨类型可重名时取最新创建的一行，同创建时间再按 type 升序、id 升序取第一条；" +
      "按规范值查询时合并同值多行的关系）与类型过滤；" +
      "时间窗按「与窗口有交集」判定；默认不含「已排除」的关系及其端点实体；金额为 numeric 字符串，勿自行转浮点；" +
      "时间以规范值（UTC+8）比较，按各自精度标注。",
    缺口: 截断缺口(args.限制, 限制, 数据.length),
    空原因: 空 ? "无匹配行" : null,
    出处: 数据.slice(0, 3).map((行) => ({
      事实: `关系 ${String(行.from_value)}→${String(行.to_value)}，${行.times == null ? "次数未知" : `${String(行.times)} 次`}`,
      代表: String(行.id),
      可下钻: "get_citation",
    })),
    // `aggregate_money` 的 `账户` 必填：空结果时没有可填的端点，给不出可执行的建议就不给。
    下一步: 空
      ? []
      : [
          {
            工具: "aggregate_money",
            参数: { 账户: String(数据[0]!.from_value) },
            为什么: "转账关系可进一步按账户汇总进出金额",
          },
        ],
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
  const 空 = 数据为空(数据)
  // 取数按 `occurred_at desc` 排序：`数据[0]` 才是最近的一个（末尾是最早的）。
  const 最近 = 数据[0]
  return {
    摘要: 空
      ? `时间窗内没有事件${args.类型 ? `（类型=${args.类型}）` : ""}`
      : `${数据.length} 个事件${args.类型 ? `（类型=${args.类型}）` : ""}，最近一个是「${String(最近!.summary ?? 最近!.type)}」`,
    数据,
    口径:
      "事件按类型与参与实体（先按 id、再按规范值解析成实体规范值；规范值跨类型可重名时取最新创建的一行，" +
      "同创建时间再按 type 升序、id 升序取第一条）过滤；时间按 occurred_at 闭区间；默认不含「已排除」的事件，" +
      "participants 里「已排除」实体的规范值也一并剔除；时间以规范值（UTC+8）比较，按各自精度标注。",
    缺口: 截断缺口(args.限制, 限制, 数据.length),
    空原因: 空 ? "无匹配行" : null,
    出处: 数据.slice(0, 3).map((行) => ({
      事实: `事件「${String(行.type)}」@${String(行.occurred_raw ?? 行.occurred_at ?? "时间缺失")}`,
      代表: String(行.id),
      可下钻: "get_citation",
    })),
    // `get_citation` 的 `事实类型` / `事实id` 必填：没有事件可抽验时给不出可执行建议，直接不给。
    下一步: 空
      ? []
      : [
          {
            工具: "get_citation",
            参数: { 事实类型: "event", 事实id: String(最近!.id) },
            为什么: "抽验一条事件的原文与出处",
          },
        ],
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
    // 一行的读回／解码只有一处（`case-row-query.ts` 的 `读明细行`）。
    // 原来这里内联一份 SQL，等于给「金额读成字符串还是数字、extras 怎么解」开第二个出处（`#002-06`）。
    const 行 = await 读明细行(ctx.db, ctx.身份.projectId, {
      materialId: 材料,
      sheet: 工作表,
      rowNo: Number(行号),
    })
    if (行 === undefined) throw new 工具错误("not_found", `本项目里没有这条明细行：${args.事实id}`)
    // `引用们` 的第三参类型是 `留痕类型`（entity/relation/event），但 `case_citation.fact_type`
    // 的库约束也允许 `row`——计划 5 的单条事实详情只服务三类事实，没把 row 收进类型。
    // SQL 按字符串比较、不依赖这个类型，所以只在调用点摊开，不复制第二份引用查询。
    const { 行们: 引用 } = await 引用们(ctx.db, ctx.身份.projectId, "row" as unknown as 留痕类型, 规范键)
    // `case_citation.fact_type='row'` 今天**没有生产写入者**（`case-ingest.ts` 只写
    // entity/relation/event 三处；测试里的 row 引用是手工种的）。查不到就如实说，
    // 别让模型以为「没有出处」等于「这行没有依据」。
    const 缺口 =
      引用.length === 0
        ? (["明细行引用尚未在生产写入，查不到时只能按 material/sheet/row_no 定位"] as const)
        : undefined
    return {
      摘要: `明细行原文：${材料}#${工作表}#${行号}`,
      数据: {
        明细行: {
          project_id: 行.projectId,
          material_id: 行.materialId,
          sheet: 行.sheet,
          row_no: 行.rowNo,
          caller: 行.caller,
          callee: 行.callee,
          started_at: 行.startedAt,
          started_raw: 行.startedRaw,
          precision: 行.precision,
          time_type: 行.timeType,
          duration_sec: 行.durationSec,
          amount: 行.amount,
          balance: 行.balance,
          counterparty: 行.counterparty,
          counterparty_name: 行.counterpartyName,
          owner_account: 行.ownerAccount,
          direction: 行.direction,
          // 保持原有默认：库里 `extras` 是 NOT NULL DEFAULT '{}'，读不到时仍给 `{}` 而不是 null
          // （`09` §3.4 的老规矩：字段缺席会让模型把「没有备注」讲成「这行没信息」）。
          extras: 行.extras ?? {},
        },
        引用: 引用行(引用),
      },
      口径: "明细行按「材料#工作表#行号」解析；`引用` 为库列名。",
      缺口: 缺口 ?? [],
      // 查不到抛 not_found ⇒ 这个分支的数据永不为空，`空原因` 恒 null。
      空原因: null,
      出处: [{ 事实: `明细行定位 ${材料}#${工作表}#${行号}`, 代表: `${材料}#${工作表}#${行号}`, 可下钻: null }],
      下一步: [{ 工具: "query_rows", 参数: { 材料 }, 为什么: "在同一份材料里按时间或账户继续翻明细" }],
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
    摘要: `${args.事实类型} 引用详情：${args.事实id}`,
    数据: { 事实: 本体, 引用: 引用行(citations), 变更历史: changes },
    口径: "`事实` 与 `变更历史` 沿用仓内只读出口的字段名，`引用` 为库列名。",
    // 事实本身存在 ⇒ 数据非空，`空原因` 恒 null；「一条引用都没有」是缺口，不是空。
    缺口: citations.length === 0 ? ["该事实暂无引用记录"] : [],
    空原因: null,
    出处: [{ 事实: `${args.事实类型} ${args.事实id}`, 代表: args.事实id, 可下钻: null }],
    下一步: [],
  }
}

/**
 * 明细回溯（`09` §4.4）。只读 `case_fact_row`，不写 `case_citation`（`01` §7.11）。
 *
 * 契约唯一来源是 `09` §4.4；入参校验与分页语义**全部**在内核 `查明细行`（`01` P1）。
 * 这里只做两件事：把 `明细入参错误` 折成工具的 `bad_input`（其余异常原样抛，交给 server
 * 折 `tool_failed`），把内核返回的五个字段映射成七字段。**不重写一遍条件判断**——
 * 同一判据开第二个出处，迟早漂成「工具说不匹配、内核说匹配」（`#002-06`）。
 */
export async function query_rows(
  ctx: 工具上下文,
  args: {
    材料?: string
    账户?: string
    方向?: "收" | "付"
    金额起?: string
    金额止?: string
    时间起?: number
    时间止?: number
    游标?: string
    限制?: number
  },
): Promise<工具结果> {
  let 结果: 明细查询结果
  try {
    结果 = await 查明细行(ctx.db, { projectId: ctx.身份.projectId, ...args })
  } catch (错) {
    // 入参错了不是「没数据」：折成 bad_input 让模型改参数，别退化成空结果。
    if (错 instanceof 明细入参错误) throw new 工具错误("bad_input", 错.message)
    throw 错
  }

  const 行们 = 结果.数据.行们
  // ⚠️ `数据` 必须是**行数组**，不能包成 `{ 行们, 下一页游标 }`：
  // R5 的「空 = null 或长度 0 的数组」只有数组判得出来；对象会让七字段镜像校验与
  // 30 KB 截断双双失效（对象永不为空、截断只处理数组）。游标只经 `下一步` 交给模型。
  const 下一页游标 = 结果.数据.下一页游标
  const 空 = 结果.空原因 !== null
  return {
    摘要: 空
      ? // 取**最后一条**缺口：内核先推截断提示（「请求的 N 行超过上限」，`case-row-query.ts:350`），
        // 再推真正的空原因细节（`360` / `369`）——首条在两者同时成立时是截断提示，不是真因。
        `没取到明细：${结果.空原因}${结果.缺口.length > 0 ? `（${结果.缺口[结果.缺口.length - 1]!}）` : ""}`
      : `取到 ${行们.length} 行明细${args.材料 ? `（材料 ${args.材料}）` : ""}${args.账户 ? `（账户 ${args.账户}）` : ""}${下一页游标 ? "，还有下一页" : ""}`,
    // 空结果就是 `[]`，与 `空原因` 非 null 天然一致（`09` §4.4 补白的镜像）。
    数据: 行们,
    口径: 结果.口径,
    缺口: 结果.缺口,
    空原因: 结果.空原因,
    出处: 行们.slice(0, 5).map((行) => ({
      事实: [
        `明细行 ${行.时间原文 ?? (行.时间 === null ? "时间缺失" : String(行.时间))}`,
        行.金额,
        行.方向,
      ]
        .filter((段): 段 is string => typeof 段 === "string" && 段 !== "")
        .join(" "),
      // 行级定位就是主键 `材料#工作表#行号`：内核的 `定位` 字段是这串的唯一出处
      // （工作表名可含 `#`，不要在这里按 `#` 重新拼一遍）。
      代表: 行.定位,
      可下钻: "get_citation",
    })),
    下一步: 空
      ? [{ 工具: "search_materials", 参数: {}, 为什么: "确认材料名与解析状态；未解析的材料要先解析入库" }]
      : [
          {
            工具: "get_citation",
            // `get_citation` 的 `事实类型` / `事实id` 必填：行级定位就是 row 分支的 `事实id`。
            参数: { 事实类型: "row", 事实id: 行们[0]!.定位 },
            为什么: "抽验一行的原文与备注",
          },
          ...(下一页游标 === null
            ? []
            : [
                {
                  工具: "query_rows",
                  // `数据` 里不放游标（见上），这里是模型拿到续页游标的**唯一**出口。
                  // 参数能直接喂回：材料 / 账户 / 区间照原样带，游标用内核签发的那串
                  // （`...args` 里若有旧游标，被后面的赋值覆盖）。
                  参数: { ...args, 游标: 下一页游标 },
                  为什么: "还有下一页明细",
                },
              ]),
        ],
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
 * - 明细行（余额走势）比 `counterparty` / `counterparty_name` / `owner_account` / `caller` /
 *   `callee`，用 `value`——
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
    // 按值查询时 `账户.ids` 含同值所有类型行：旧行上的转账不能因为纠正后的新行而消失。
    sql`(from_id ${id属于(账户.ids)} or to_id ${id属于(账户.ids)})`,
    // §9.1：与 `对手方` 同一口径——对手方实体被「已排除」时，这笔关系既不进对手方，
    // 也不进汇总的笔数/合计；否则同一次调用里「出 N 笔」与对手方列表对不上。
    // 用 `in (select …)` 而不是 join：`汇总条件` 里的列名未加表别名，加 join 会让
    // `project_id` / `trust_state` 变成有歧义列（报错）。
    sql`(case when from_id ${id属于(账户.ids)} then to_id else from_id end) in (
      select id from auth.case_entity
       where project_id = ${ctx.身份.projectId} and trust_state <> '已排除'
    )`,
  ]
  const 对手方条件: SQL[] = [
    sql`r.project_id = ${ctx.身份.projectId}`,
    sql`r.type = '转账'`,
    sql`r.trust_state <> '已排除'`,
    sql`(r.from_id ${id属于(账户.ids)} or r.to_id ${id属于(账户.ids)})`,
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
      select case when from_id ${id属于(账户.ids)} then '出' else '入' end as 方向,
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
             case when r.from_id ${id属于(账户.ids)} then '出' else '入' end as 方向,
             count(*)::int as 笔数,
             coalesce(sum(r.amount), 0)::text as 合计
        from auth.case_relation r
        join auth.case_entity 对手
          on 对手.project_id = r.project_id
         and 对手.id = case when r.from_id ${id属于(账户.ids)} then r.to_id else r.from_id end
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
    sql`(counterparty = ${账户.value}
      or counterparty_name = ${账户.value}
      or owner_account = ${账户.value}
      or caller = ${账户.value}
      or callee = ${账户.value})`,
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

  // R5：对象不算空 ⇒ 无命中时 `数据` 返回 `null`，不返回一个全是空数组的对象。
  const 空 = 汇总.length === 0 && 对手方.length === 0 && 余额走势 === null
  // `对手方` 是按「对手方 + 方向」分组的（来/回各一行）⇒ 按行数说「N 个对手」会把同一人算两次。
  const 对手个数 = new Set(对手方.map((行) => String(行.对手方))).size
  const 缺口 = [
    "只统计已抽成关系（type=转账）的转账；明细行里未抽成关系的转账不计入",
    "对手方按实体规范值聚合；未合并的重复实体不会自动合并",
    `对手方最多 ${对手方上限} 条（按合计金额降序）`,
    "余额只按精确匹配取明细行，未做模糊匹配；超过 200 行截断",
  ]
  // 与 `截断缺口` 同口径：命中上限才说「可能还有更多」，没满就不制造假警报。
  if (对手方.length === 对手方上限) 缺口.push(`对手方已截到前 ${对手方上限} 条，可能还有更多`)
  if (余额行.length === 0)
    缺口.push("本项目明细行里没有该账户的流水（按 counterparty/counterparty_name/owner_account/caller/callee 精确匹配）")

  return {
    摘要: 空
      ? `「${args.账户}」在给定条件下没有任何转账关系或明细流水`
      : `「${args.账户}」${汇总.map((行) => `${行.方向} ${行.笔数} 笔 / ${行.合计} 元`).join("，") || "无转账关系"}；${对手个数} 个对手${余额走势 ? `；明细 ${余额走势.行数} 行` : "；无明细流水"}`,
    数据: 空 ? null : { 汇总, 对手方, 余额走势 },
    口径:
      "汇总与对手方只统计 type=转账 且非「已排除」的关系（对手方实体也须非「已排除」），按出/入分组；" +
      "账户先按 id、再按规范值解析，规范值跨类型可重名时取最新创建的一行，同创建时间再按 type 升序、id 升序取第一条；" +
      "按规范值查询时合并同值多行的关系；" +
      "金额为 numeric 字符串，勿自行转浮点；" +
      "余额走势按明细行的 counterparty/counterparty_name/owner_account/caller/callee 精确匹配账户的实体规范值。",
    缺口: 空 ? [...缺口, "汇总、对手方、余额走势三者都为空：该账户在时间窗内既无转账关系也无明细流水"] : 缺口,
    空原因: 空 ? "无匹配行" : null,
    // `代表` 是**下钻入参**（账户规范值），不是事实 id：`query_rows` 的 `账户` 直接吃它。
    // `query_rows` 已注册，这条下钻可用。
    出处: 空
      ? []
      : [{ 事实: `账户「${账户.value}」的转账汇总`, 代表: 账户.value, 可下钻: "query_rows" }],
    下一步: 空
      ? [{ 工具: "query_entities", 参数: { 关键词: args.账户 }, 为什么: "确认这个账户在实体里到底叫什么规范值" }]
      : [{ 工具: "query_rows", 参数: { 账户: 账户.value }, 为什么: "看构成汇总的逐笔明细" }],
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

  // `实体ids` 按值解析时是同值所有类型行：旧「人」行上的关系也要算进交集。
  const 另一端们 = async (实体ids: readonly string[]): Promise<{ 值们: string[]; 用满: boolean }> => {
    const 值们 = rowsOf(
      await ctx.db.execute(sql`
        select case when from_id ${id属于(实体ids)} then to_id else from_id end as 另一端
          from auth.case_relation
         where project_id = ${ctx.身份.projectId} and trust_state <> '已排除'
           and (from_id ${id属于(实体ids)} or to_id ${id属于(实体ids)})
         order by 另一端 asc
         limit ${每侧关系上限}
      `),
    ).map((行) => String(行.另一端))
    return { 值们, 用满: 值们.length === 每侧关系上限 }
  }
  // 顺序执行：夹具把多条连接汇进同一个 PG 会话，不并发建两份语句缓存。
  const 侧甲 = await 另一端们(甲.ids)
  const 侧乙 = await 另一端们(乙.ids)
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

  const 空 = 共同关联.length === 0 && 共同时空.length === 0
  const 缺口 = [
    "按关系连通算；同一实体若被拆成两条未合并的实体，交集会漏",
    `共同时空最多 ${共同时空上限} 条（按 occurred_at 倒序）`,
  ]
  if (侧甲.用满 || 侧乙.用满) 缺口.push("每侧最多取 500 条关系，交集可能不全")
  if (共同时空.length === 共同时空上限) 缺口.push(`共同时空已截到前 ${共同时空上限} 条，可能还有更多`)
  缺口.push("共同时空按事件参与实体判；只覆盖已抽成事件的时空点")

  return {
    摘要: 空
      ? `「${args.甲}」与「${args.乙}」没有共同关联，也没有共同时空`
      : `「${args.甲}」与「${args.乙}」共同关联 ${共同关联.length} 个、共同时空 ${共同时空.length} 条`,
    数据: 空 ? null : { 共同关联, 共同时空 },
    口径:
      "共同关联取与甲、乙各自相连且非「已排除」的关系的另一端实体，两侧各至多 500 条后在服务端求交；" +
      "甲、乙均先按 id、再按规范值解析，规范值跨类型可重名时取最新创建的一行，同创建时间再按 type 升序、id 升序取第一条；" +
      "按规范值查询时合并同值多行的关系；" +
      "共同时空按事件 participants（实体规范值）同时包含两人判定，时间按 occurred_at 闭区间。",
    缺口: 空 ? [...缺口, "共同关联与共同时空都为空：两侧在时间窗内没有可求交的边或事件"] : 缺口,
    空原因: 空 ? "无匹配行" : null,
    出处: 空
      ? []
      : [{ 事实: `「${args.甲}」与「${args.乙}」的交叉`, 代表: String(甲.id), 可下钻: "get_citation" }],
    下一步: 空
      ? [{ 工具: "query_relations", 参数: { 实体: args.甲 }, 为什么: "先看这一侧自己的关系，确认边是否已抽出来" }]
      : [{ 工具: "query_events", 参数: {}, 为什么: "共同时空往往是通话或同行，可按时间窗查事件" }],
  }
}
