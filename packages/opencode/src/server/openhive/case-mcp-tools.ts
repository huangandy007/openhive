import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import {
  默认限制,
  最大限制,
  数据为空,
  数据预算字节,
  序列化字节,
  type 出处项,
  type 下一步项,
  type 空原因值,
} from "./case-envelope"
import { getMaterial, type Queryable } from "./case-store"
import type { 调用身份 } from "./case-mcp-identity"
import { 事实详情, 批量引用, 引用们, type 引用视图 } from "./case-fact-read"
import {
  查明细行,
  明细入参错误,
  读明细行,
  未解析材料份数,
  编码游标对象,
  解码游标对象,
  是int32,
  type 明细查询结果,
} from "./case-row-query"
import { 文本数组 } from "./case-fact-store"
import type { 留痕类型 } from "./case-fact-change"
import { 对齐代表, 户名对齐, 户名来源 } from "./case-party"
import {
  读身份标注,
  实体称呼,
  身份后缀,
  身份口径,
  type 身份标注,
  type 待标注实体,
} from "./case-identity"

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
  /** 涉及人的实体身份档（§3.8.4）：已核实 / 户名匹配 / 无匹配。不涉及实体时省略。 */
  readonly 身份?: readonly 身份标注[]
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
      sql`(canonical_value ilike ${模式}
        or exists (select 1 from unnest(aliases) as 别名 where 别名 ilike ${模式})
        -- 不并入 case-party 的「户名来源」：本处的「已排除」由外层 where 按「含已排除」开关决定，
        -- 而「户名来源」内含 ae.trust_state <> '已排除'，并入会让「含已排除=true」按户名搜不到（#002-06 的例外，已裁定）。
        or exists (select 1 from auth.case_entity_alias a
                    where a.project_id = ${ctx.身份.projectId} and a.entity_id = e.id
                      and a.kind = '户名' and a.revoked_at is null and a.value ilike ${模式}))`,
    )
  }
  if (args.含已排除 !== true) 条件.push(sql`trust_state <> '已排除'`)
  const rows = await ctx.db.execute(sql`
    select id, type, canonical_value, array_to_json(aliases)::text as aliases, attrs::text as attrs,
           trust_state, created_at
      from auth.case_entity e
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
  const 待标们: 待标注实体[] = 数据
    .filter((行) => 行.type === "人" || 行.type === "账户")
    .map((行) => ({ id: 行.id, 类型: 行.type, 值: 行.canonical_value }))
  const 身份表 = await 读身份标注(ctx.db, ctx.身份.projectId, 待标们)
  const 数据带身份 = 数据.map((行) => {
    const 标注 = 身份表.get(行.id)
    return 标注 === undefined ? 行 : { ...行, 身份: 标注 }
  })
  const 未核实数 = [...身份表.values()].filter((a) => a.档 !== "已核实").length
  const 空 = 数据为空(数据带身份)
  return {
    摘要: 空
      ? `没有实体匹配${args.关键词 ? `「${args.关键词}」` : ""}${args.类型 ? `（类型=${args.类型}）` : ""}`
      : `找到 ${数据带身份.length} 个实体${args.类型 ? `（类型=${args.类型}）` : ""}，首个是「${String(数据带身份[0]!.canonical_value)}」${未核实数 > 0 ? `（其中 ${未核实数} 个未核实身份）` : ""}`,
    数据: 数据带身份,
    口径: "实体按类型与规范值/别名关键词过滤；关键词也匹配未撤销的户名别名。默认不含「已排除」（设计 §9.1）。" + 身份口径,
    缺口: 截断缺口(args.限制, 限制, 数据.length),
    空原因: 空 ? "无匹配行" : null,
    出处: 数据带身份.slice(0, 3).map((行) => ({
      事实: `实体「${String(行.canonical_value)}」`,
      代表: String(行.id),
      可下钻: "get_citation",
    })),
    下一步: 空
      ? [{ 工具: "search_materials", 参数: {}, 为什么: "按材料名或正文片段找；实体可能还没从材料里抽出来" }]
      : [{ 工具: "query_relations", 参数: { 实体: String(数据带身份[0]!.canonical_value) }, 为什么: "看它与谁有关系" }],
  }
}

export interface 实体解析 {
  readonly id: string
  readonly value: string
  readonly type: string
  readonly ids: string[]
  /** 解析到的途径：id / 规范值 / 户名（A11 的「户名为 X 的账户」据此措辞）。 */
  readonly 命中: "id" | "规范值" | "户名"
}

/**
 * 按户名找账户（M2）：**精确等值**、不做相似匹配（§3.8.3）。
 *
 * 同一户名对应多个账户 ⇒ `bad_input` 列出候选。M4 的「唯一性候选」要人点一次采纳，
 * 本期不做；在此之前不许挑一个冒充答案（§3.8.4「无匹配不给近似值」）。
 *
 * 别名行按 (project_id, kind, value) 有索引（0039）；账户被「已排除」时不参与。
 */
export async function 解析户名(
  ctx: 工具上下文,
  值: string,
): Promise<{ id: string; value: string; type: string; ids: string[]; 命中: "户名" } | undefined> {
  const 行们 = rowsOf(
    await ctx.db.execute(sql`
      select ae.id, ae.type, ae.canonical_value
        from ${户名来源(ctx.身份.projectId)}
         and a.value = ${值}
         and ae.type = '账户'
       order by ae.created_at desc, ae.type asc, ae.id asc
    `),
  )
  const 按id = new Map<string, Record<string, unknown>>()
  for (const 行 of 行们) {
    const id = String(行.id)
    if (!按id.has(id)) 按id.set(id, 行)
  }
  const 候选 = [...按id.values()]
  if (候选.length === 0) return undefined
  if (候选.length > 1) {
    const 前 = 候选.slice(0, 5).map((行) => String(行.canonical_value))
    const 尾巴 = 候选.length > 5 ? ` 等 ${候选.length} 个` : ""
    throw new 工具错误(
      "bad_input",
      `户名「${值}」在本项目对应 ${候选.length} 个账户（${前.join("、")}${尾巴}），` +
        "无法确定是哪一个；请改用账号查询",
    )
  }
  const 唯一 = 候选[0]
  return {
    id: String(唯一.id),
    value: String(唯一.canonical_value),
    type: String(唯一.type),
    ids: [String(唯一.id)],
    命中: "户名",
  }
}

/**
 * 实体解析：id 优先、其次规范值、再次未撤销的 `kind='户名'` 别名（`解析户名`）；
 * 仍查不到 ⇒ not_found（`称呼` 进文案，说清是哪一方）。
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
): Promise<实体解析> {
  const rows = rowsOf(
    await ctx.db.execute(sql`
      select id, type, canonical_value from auth.case_entity
       where project_id = ${ctx.身份.projectId} and (id = ${值} or canonical_value = ${值})
       order by (id = ${值}) desc, created_at desc, (type = '人') asc, type asc, id asc
    `),
  )
  const 行 = rows[0]
  if (行 !== undefined) {
    const id = String(行.id)
    const ids =
      id === 值
        ? [id]
        : rows.filter((行) => String(行.canonical_value) === 值).map((行) => String(行.id))
    return { id, value: String(行.canonical_value), type: String(行.type), ids, 命中: id === 值 ? "id" : "规范值" }
  }
  const 户名 = await 解析户名(ctx, 值)
  if (户名 !== undefined) return 户名
  throw new 工具错误("not_found", `本项目里找不到${称呼}：${值}`)
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
 * 项目内「尚未解析」的材料份数（判定表第 4 条的证据）。
 *
 * 判据只有一份：`case-row-query.ts` 的 `未解析材料份数`（同一 path 只认最新一行、产物不计）。
 * 这里只做上下文到库参数的委托——另开一份 `count(*)` 就会在「重传后已解析」上漂成永久误报
 * （`#002-06`）。
 *
 * 为什么**不**按「资金」这类 `kind` 过滤：材料在认出列之前 `kind` 一律是 `其他`
 * （`case-ingest.ts:123`），按 `kind = '资金'` 找会把「刚上传、还没解析的流水」整批漏掉。
 * 唯一例外是 `产物`：按设计永不解析（design §5.5），算进「待翻译」会让任何生成过产物的
 * 项目永远报「材料未翻译」，而产物里不可能有资金流水（`09` §3.5 原话是「有**资金材料**
 * 但没翻译」）。
 */
async function 未解析材料数(ctx: 工具上下文): Promise<number> {
  return 未解析材料份数(ctx.db, ctx.身份.projectId)
}

/**
 * 空原因判定表（`09` §3.5 第 1–4 条）的证据。**一次查齐**：`aggregate_money`（资金四拆）
 * 与 `关系空原因`（关系两拆）都从这里取数——同一判据只有这一个出处（`#002-06`）。
 *
 * `窗内转账数` 与 `转账总数` 是两件事：第 1 条问「**时间窗内** 0 笔」，第 2 条问
 * 「**任何**转账关系都没有」。合成一个数会让「窗外有转账、窗内没有」的账户被误判成
 * 「账户未在材料中出现」。
 */
interface 空证据 {
  /** 该实体名下的 `持有` 关系数（全时段）。 */
  readonly 持有数: number
  /** 时间窗内的 `转账` 关系数（第 1 条用）。 */
  readonly 窗内转账数: number
  /** 全时段的 `转账` 关系数（第 2 条用）。 */
  readonly 转账总数: number
  /** 明细行里本方/对方账号等于该实体规范值的行数（全时段）。 */
  readonly 明细行数: number
  /** 项目内尚未解析的材料份数（第 4 条用）。 */
  readonly 未解析材料数: number
}

async function 查空证据(
  ctx: 工具上下文,
  实体: { ids: readonly string[] },
  时间窗: { 起?: number; 止?: number } = {},
  /** 调用点已经数过就传进来，免得同一次工具调用把同一句 `count` 跑两遍。 */
  已知未解析份数?: number,
): Promise<空证据> {
  // 时间窗与 `aggregate_money` / `query_relations` 同口径：最晚不早于「起」、最早不晚于「止」。
  //
  // 【有意不与汇总对齐，别「顺手」加 trust_state 过滤】这里数的是**原始事实**：窗内转账数不跳过
  // `trust_state = '已排除'` 的关系、也不跳过端点为「已排除」的对手方；而 `aggregate_money` 的
  // `汇总条件` / `对手方` join 数的是**可报告事实**（两处都排除）。两边不一致只会让空原因落到更保
  // 守的兜底 `无匹配行`（窗内转账被算多 ⇒「确实没有交易」不成立），不会产生「账户未在材料中出现」
  // 这类假否证。对齐反而更错：只在一条已排除转账里出现过的账户会被推去「账户未在材料中出现」，
  // 把「没算进汇总」说成「材料里没有这个人」。见 `09` §13.5。
  const 窗内条件: SQL[] = [
    sql`project_id = ${ctx.身份.projectId}`,
    sql`type = '转账'`,
    sql`(from_id ${id属于(实体.ids)} or to_id ${id属于(实体.ids)})`,
  ]
  if (时间窗.起 !== undefined) 窗内条件.push(sql`coalesce(last_at, first_at, 0) >= ${时间窗.起}`)
  if (时间窗.止 !== undefined) 窗内条件.push(sql`coalesce(first_at, last_at, 0) <= ${时间窗.止}`)
  const 行 = rowsOf(
    await ctx.db.execute(sql`
      with 实体值 as (
        select canonical_value
          from auth.case_entity
         where project_id = ${ctx.身份.projectId} and id ${id属于(实体.ids)}
      )
      select
        (select count(*)::int from auth.case_relation
          where project_id = ${ctx.身份.projectId} and type = '持有'
            and (from_id ${id属于(实体.ids)} or to_id ${id属于(实体.ids)})) as 持有数,
        (select count(*)::int from auth.case_relation
          where ${sql.join(窗内条件, sql` and `)}) as 窗内转账数,
        (select count(*)::int from auth.case_relation
          where project_id = ${ctx.身份.projectId} and type = '转账'
            and (from_id ${id属于(实体.ids)} or to_id ${id属于(实体.ids)})) as 转账总数,
        -- 明细行存的是实体规范值、不是 id（本文件既有口径），所以按 id 取回规范值再比；
        -- 本方/对方账号的列与余额走势的条件完全一致（counterparty / counterparty_name /
        -- owner_account / caller / callee），不另立一套「账户出现」的判据。
        (select count(*)::int from auth.case_fact_row r
          where r.project_id = ${ctx.身份.projectId}
            and (r.counterparty in (select canonical_value from 实体值)
              or r.counterparty_name in (select canonical_value from 实体值)
              or r.owner_account in (select canonical_value from 实体值)
              or r.caller in (select canonical_value from 实体值)
              or r.callee in (select canonical_value from 实体值))) as 明细行数
    `),
  )[0]
  return {
    持有数: Number(行?.持有数 ?? 0),
    窗内转账数: Number(行?.窗内转账数 ?? 0),
    转账总数: Number(行?.转账总数 ?? 0),
    明细行数: Number(行?.明细行数 ?? 0),
    未解析材料数: 已知未解析份数 ?? (await 未解析材料数(ctx)),
  }
}

/** 未解析材料的缺口文案：数量必须写出来，且不许声称已知它是资金材料（认出列之前 `kind` 是「其他」）。 */
function 未翻译缺口(份数: number): string {
  return `${份数} 份材料尚未解析，其中可能含资金流水`
}

/** 「材料没翻译」时唯一可执行的引导：先确认 / 推进解析。两个出口共用一条（`#002-06`）。 */
const 材料未翻译下一步: 下一步项 = {
  工具: "search_materials",
  参数: {},
  为什么: "确认项目内材料的解析状态；未解析的材料要先解析入库，再问资金",
}

/**
 * 资金空原因的判定（`09` §3.5 的资金四拆 + 外币 + 兜底）。**顺序即优先级**，前一条命中即用。
 *
 * 两道理性闸门：
 * - **材料没读全时不许说「没有」**：第 1–3 条都以「材料已翻译」为前提（`实体没有关联账户`
 *   与第 1、2 条一样是**对全案数据**的否证——他的持有关系可能就在那份未解析的材料里）。
 *   还有未解析材料时直接落到第 4 条（或兜底），绝不答「确实没有交易 / 账户未在材料中出现 /
 *   实体没有关联账户」。
 * - **第 1、2 条只认「账户」**，第 3 条只认「人 / 组织」：一条「人」实体即便没有持有关系，
 *   也不能被说成「账户未在材料中出现」或「确实没有交易」——那是把「人」当「账户」。
 *   `09` §3.5 总表把「实体没有关联账户」排在「账户未在材料中出现」之前，与本函数的字面
 *   次序不同；但第 2 条只认「账户」、第 3 条只认「人 / 组织」，**按实体类型互斥** ⇒
 *   两条不可能同时成立，字面次序不改变结果。别照着总表把第 3 条提到第 2 条前面——
 *   那样「人」会先被第 3 条接住、第 2 条对「账户」的语义不变，改的只是可读性，不是判据。
 * - **外币行也是流水**：第 1 条的前提是「时间窗内 0 笔」，窗口里只有外币明细时这句话不成立
 *   （它们只是不计入人民币汇总，`09` §4.5 第 2 条）⇒ 第 1 条必须让位给 `外币行全部未计入`。
 *   `外币行数` 由调用点按同一时间窗数好传进来（`空证据` 结构不动）。
 */
function 判资金空原因(证据: 空证据, 实体: { type: string }, 外币行数: number): 空原因值 {
  // 材料没读全时不许说「没有」：第 1、2 条都以「材料已翻译」为前提（09 §3.5）。
  const 已翻译 = 证据.未解析材料数 === 0
  // 1. 确实没有交易：账户有存在证据（持有 / 明细行），但时间窗内 0 笔——外币行也算一笔，
  //    只是不进人民币合计，所以有外币行时这句「0 笔」是假话。
  if (
    已翻译 &&
    实体.type === "账户" &&
    (证据.持有数 > 0 || 证据.明细行数 > 0) &&
    证据.窗内转账数 === 0 &&
    外币行数 === 0
  )
    return "确实没有交易"
  // 2. 账户未在材料中出现：同上前提，且任何事实里都没有它。
  if (
    已翻译 &&
    实体.type === "账户" &&
    证据.持有数 === 0 &&
    证据.转账总数 === 0 &&
    证据.明细行数 === 0
  )
    return "账户未在材料中出现"
  // 3. 实体没有关联账户：人 / 组织没有任何「持有」关系。同第 1、2 条，是对全案数据的否证，
  //    材料没读全时不能下（`09` §3.5）。
  if (已翻译 && (实体.type === "人" || 实体.type === "组织") && 证据.持有数 === 0)
    return "实体没有关联账户"
  // 4. 项目内资金材料未翻译：还有没解析的材料，不能据此下「没有」的结论。
  if (证据.未解析材料数 > 0) return "项目内资金材料未翻译"
  // 5. 外币行全部未计入（`09` §3.5 总表：排在 `项目内资金材料未翻译` 之后、`无匹配行` 之前）：
  //    窗口里还有非人民币明细，但它们不进人民币合计/余额走势。不能兜底成「无条件无命中」。
  if (外币行数 > 0) return "外币行全部未计入"
  return "无匹配行"
}

/**
 * 关系空原因：**只有第 3 条与兜底**。
 *
 * 不做第 1、2、4 条：查关系查不到不代表没有交易，也不代表账户没出现——用
 * `确实没有交易` / `账户未在材料中出现` 回答「查关系」是误导。宁可兜底，不说错话。
 *
 * 第 3 条还要看**类型过滤**：只有「没按类型过滤」或「问的就是持有关系」时，
 * 「实体没有关联账户」才成立；问「转账」却一条没有，不能反过来说它没有账户。
 *
 * 与资金类第 3 条同一理由，也受「材料已翻译」闸门约束：`实体没有关联账户` 是对全案数据的
 * 否证，材料没读全时命中不了就兜底（关系类不做第 4 条）。
 */
function 判关系空原因(证据: 空证据, 实体: { type: string }, 类型?: string): 空原因值 {
  const 可判持有 = 类型 === undefined || 类型 === "持有"
  const 已翻译 = 证据.未解析材料数 === 0
  if (已翻译 && 可判持有 && (实体.type === "人" || 实体.type === "组织") && 证据.持有数 === 0)
    return "实体没有关联账户"
  return "无匹配行"
}

/**
 * 关系类空原因（只有第 3 条与兜底）。`query_relations` 用。
 *
 * 一并回未解析材料份数：缺口要追加「未翻译」提示，但**不许为了拿这个数再查一次库**——
 * 证据里已经有了（`#002-06`）。
 */
export async function 关系空原因(
  ctx: 工具上下文,
  实体: { ids: readonly string[]; type: string },
  类型?: string,
): Promise<{ 空原因: 空原因值; 未解析材料数: number }> {
  const 证据 = await 查空证据(ctx, 实体)
  return { 空原因: 判关系空原因(证据, 实体, 类型), 未解析材料数: 证据.未解析材料数 }
}

/**
 * R-C：「材料没翻译」也是**空结果**，不是 `not_found`。
 *
 * 民警刚上传流水、还没解析完就来问账户时，实体表里确实还没有它——但这不是「查无此账户」，
 * 而是「还答不了」。把错误抛出去会让模型把它讲成「没有这个账户」（`09` §5.2 纪律 3）。
 */
function 材料未翻译信封(账户: string, 份数: number): 工具结果 {
  return {
    摘要: `「${账户}」的资金材料还没翻译完：项目内还有 ${份数} 份材料尚未解析，现在不能断定有没有交易`,
    数据: null,
    口径:
      "账户先在实体表解析（按 id、再按规范值）；解析不到时若项目内仍有未解析材料，" +
      "不把「查无此实体」当结论——翻译完之前它可能就在这些材料里。",
    缺口: [未翻译缺口(份数)],
    空原因: "项目内资金材料未翻译",
    出处: [],
    下一步: [材料未翻译下一步],
  }
}

/**
 * 账户解析：`not_found` 且项目内有未解析材料时，折成「材料未翻译」信封而不是抛错（R-C）。
 * 这个判断只属于 `aggregate_money`，**不塞进 `解析实体`**：后者被四个工具共用，
 * 在那里改语义会把另外三个工具的「查不到实体」也说成「材料没翻译」（`#002-06`）。
 *
 * 账户语境优先户名（§3.8.1「查询按账户组织」）：规范值先命中了同名「人」实体时，
 * 再按户名找账户；否则问「张三的流水」会在人实体上算 0 笔——错得像个正确答案。
 * 户名对应多账户时 `解析户名` 抛 `bad_input`，不在这里兜底挑一个。
 */
async function 解析账户(
  ctx: 工具上下文,
  账户: string,
): Promise<{ 实体: 实体解析 } | { 信封: 工具结果 }> {
  try {
    const 实体 = await 解析实体(ctx, 账户, "账户")
    if (实体.type === "账户") return { 实体 }
    const 户名 = await 解析户名(ctx, 账户)
    if (户名 !== undefined) return { 实体: 户名 }
    return { 实体 }
  } catch (错) {
    if (错 instanceof 工具错误 && 错.code === "not_found") {
      const 份数 = await 未解析材料数(ctx)
      if (份数 > 0) return { 信封: 材料未翻译信封(账户, 份数) }
    }
    throw 错
  }
}

/**
 * 切片定位的判据只有这一处：`{ start, end }` 两个非负整数、且 `end >= start` 才算区间。
 * 其余形态（`{sheet,row}` 这类行级 locator、`{page,para}`、缺键、负数）一律「不是切片」——
 * 不猜、不把整篇正文当成这条引用的原文（`case-slice.ts` 的 `起/止` 是唯一合法形状）。
 */
function 是切片定位(locator: unknown): locator is { start: number; end: number } {
  if (locator === null || typeof locator !== "object") return false
  // 用 `Reflect.get` + `typeof` 收窄，不写 `as`（oxlint 的 `no-unsafe-type-assertion` 会记告警）。
  const 起 = Reflect.get(locator, "start")
  const 止 = Reflect.get(locator, "end")
  if (typeof 起 !== "number" || typeof 止 !== "number") return false
  return Number.isInteger(起) && Number.isInteger(止) && 起 >= 0 && 止 >= 起
}

/**
 * 一次取全本次所有引用所在材料的正文：同一材料的多条引用共用一份，别每条引用查一次库。
 * 缺键 / NULL 都进表里记成 `null`，由 `引用行` 统一说缺口（材料被删时 fileName/path
 * 已经是 null，正文也给不出）。
 */
async function 读原文表(
  ctx: 工具上下文,
  引用们: readonly 引用视图[],
): Promise<Map<string, string | null>> {
  const 表 = new Map<string, string | null>()
  const ids = [...new Set(引用们.map((条) => 条.materialId))]
  if (ids.length === 0) return 表
  const rows = rowsOf(
    await ctx.db.execute(sql`
      select id, text_content from auth.case_material
       where project_id = ${ctx.身份.projectId} and id ${id属于(ids)}
    `),
  )
  for (const 行 of rows) 表.set(String(行.id), typeof 行.text_content === "string" ? 行.text_content : null)
  return 表
}

/**
 * 引用的 `原文切片`：按 locator 的 `[start, end)` 从材料正文切，`trim()` 后原样回显。
 *
 * - locator 不是 `{start,end}` ⇒ `null`（`case_citation.locator` 也可以是行级定位，那不是原文区间）；
 * - 材料没有正文（xlsx 等）⇒ `null` + 缺口；同一份材料只说一次；
 * - `end` 越过正文长度 ⇒ 切到末尾并在缺口里明说（夹住，不静默）。
 *
 * 切片逻辑**只此一份**：两个分支都经 `引用行`（`#002-06`）。
 */
function 切原文(
  条: 引用视图,
  原文表: ReadonlyMap<string, string | null>,
  缺口: string[],
  已说无正文: Set<string>,
  已说越界: Set<string>,
): string | null {
  if (!是切片定位(条.locator)) return null
  const 正文 = 原文表.get(条.materialId)
  if (正文 === undefined || 正文 === null) {
    if (!已说无正文.has(条.materialId)) {
      已说无正文.add(条.materialId)
      缺口.push("该材料没有原文正文，给不出原文切片")
    }
    return null
  }
  const { start, end } = 条.locator
  if (end > 正文.length) {
    if (!已说越界.has(条.materialId)) {
      已说越界.add(条.materialId)
      缺口.push("locator 超出原文长度，已夹到末尾")
    }
    return 正文.slice(start).trim()
  }
  return 正文.slice(start, end).trim()
}

/**
 * 计划 5 的 `引用视图`（camelCase）→ 本层的库列名口径 + `原文切片`。
 *
 * `row` 分支与 `entity/relation/event` 分支必须同形——模型不该因为出处挂在哪类事实上
 * 就换一套字段名。`原文切片` **永远给键**（`09` §3.4：字段缺席会被模型讲成「这条没有依据」），
 * 切不出时给 `null` 并把原因写进调用方传进来的 `缺口`。
 */
function 引用行(
  引用们: readonly 引用视图[],
  原文表: ReadonlyMap<string, string | null>,
  缺口: string[],
) {
  const 已说无正文 = new Set<string>()
  const 已说越界 = new Set<string>()
  return 引用们.map((条) => ({
    id: 条.id,
    material_id: 条.materialId,
    file_name: 条.fileName,
    path: 条.path,
    locator: 条.locator,
    extract_method: 条.extractMethod,
    confidence: 条.confidence,
    原文切片: 切原文(条, 原文表, 缺口, 已说无正文, 已说越界),
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
  // 下一步建议要用**本次查询主体**的规范值：首条关系的 `from_value` 不保证是查询方
  // （查「乙」时首条可能是「甲→乙」），拿它当账户就是编户名（A3）。没给 `实体` 时
  // 根本不知道查询主体是谁，也就没有可汇总的账户 ⇒ `下一步` 留空。
  let 查询实体值: string | undefined
  // 空结果的原因要用**查询主体**的身份（类型 / id 集）判，解析结果留在这里（`关系空原因`）。
  let 查询实体: 实体解析 | undefined
  if (args.实体 !== undefined) {
    const 实体 = await 解析实体(ctx, args.实体, "实体")
    查询实体 = 实体
    查询实体值 = 实体.value
    // 按值解析时 `ids` 是同值所有类型行：旧「人」行上的关系不能因为纠正后的新行而消失。
    条件.push(sql`(r.from_id ${id属于(实体.ids)} or r.to_id ${id属于(实体.ids)})`)
  }
  const 身份表 =
    查询实体 === undefined
      ? new Map<string, 身份标注>()
      : await 读身份标注(ctx.db, ctx.身份.projectId, [
          { id: 查询实体.id, 类型: 查询实体.type, 值: 查询实体.value },
        ])
  const 身份们 = [...身份表.values()]
  const 主体称呼 = 查询实体 === undefined ? "" : 实体称呼(查询实体, args.实体 ?? "")
  const 后缀 = 身份后缀(身份们)
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
  // 没给 `实体` 时不知道查询主体是谁，没有可判的身份 ⇒ 兜底；给了才按 `关系空原因` 判。
  // 未解析份数随空原因一并带回（同一份证据），不为了报缺口再查一次库。
  const 空判定 = !空
    ? undefined
    : 查询实体 === undefined
      ? { 空原因: "无匹配行" as 空原因值, 未解析材料数: await 未解析材料数(ctx) }
      : await 关系空原因(ctx, 查询实体, args.类型)
  const 缺口 = 截断缺口(args.限制, 限制, 数据.length)
  // 事实列表按事实各列一条（human 与机器行都在）；去重发生在汇总/对手方。
  // 不说清，模型会拿本列表的条数去对汇总的笔数（#006-29：口径要写在结果里）。
  if (args.类型 === undefined || args.类型 === "转账")
    缺口.push("同一笔转账可能同时有人工关系与流水机器关系两条；汇总与对手方已去重，本列表按事实各列一条")
  // R-W：只要项目内还有未解析材料，空结果就要在缺口里说清（命中哪一条空原因都一样）。
  if (空判定 !== undefined && 空判定.未解析材料数 > 0) 缺口.push(未翻译缺口(空判定.未解析材料数))
  const 对方数 = new Set(数据.flatMap((行) => [String(行.from_id), String(行.to_id)])).size
  return {
    摘要: 空
      ? // 关系类判定没有第 4 条：还有未解析材料时落 `无匹配行`，摘要也只能限定在
        // 「已解析材料」里——否则与同一信封里的「N 份材料尚未解析」缺口自相矛盾
        // （`09` §5.2 纪律 2）。份数从 `空判定` 拿，不另查库（`#002-06`）。
        (空判定?.未解析材料数 ?? 0) > 0
        ? `${args.实体 ? 主体称呼 : ""}按现有已解析材料没有命中（还有 ${空判定?.未解析材料数} 份材料尚未解析）${后缀}`
        : `没有关系命中${args.实体 ? `（实体${主体称呼}）` : ""}${后缀}`
      : `${数据.length} 条关系${args.实体 ? `（实体${主体称呼}）` : ""}，涉及 ${对方数} 个端点${后缀}`,
    数据,
    口径:
      "关系按实体（先按 id、再按规范值解析；规范值跨类型可重名时取最新创建的一行，同创建时间再按 type 升序、id 升序取第一条；" +
      "按规范值查询时合并同值多行的关系）与类型过滤；" +
      "时间窗按「与窗口有交集」判定；默认不含「已排除」的关系及其端点实体；金额为 numeric 字符串，勿自行转浮点；" +
      "时间以规范值（UTC+8）比较，按各自精度标注。" + 身份口径,
    缺口,
    空原因: 空判定?.空原因 ?? null,
    出处: 数据.slice(0, 3).map((行) => ({
      事实: `关系 ${String(行.from_value)}→${String(行.to_value)}，${行.times == null ? "次数未知" : `${String(行.times)} 次`}`,
      代表: String(行.id),
      可下钻: "get_citation",
    })),
    // `aggregate_money` 的 `账户` 必填：空结果时没有可填的端点，给不出可执行的建议就不给；
    // 非空时也只填**查询主体**的规范值（`查询实体值`），不拿首条关系的 `from_value` 冒充。
    下一步:
      空 || 查询实体值 === undefined
        ? []
        : [
            {
              工具: "aggregate_money",
              参数: { 账户: 查询实体值 },
              为什么: "按这个账户汇总进出金额（关系可进一步聚合）",
            },
          ],
    ...(身份们.length === 0 ? {} : { 身份: 身份们 }),
  }
}

/**
 * 「事件是否涉及该实体」的唯一出处（10 §6.2，`#002-06`）。
 *
 * 两路证据缺一不可：
 * - `participants text[]`：所有写口都写实体规范值（笔录写人名、表格写账号）；
 * - 参与者表 + 对齐：按**人**查时，表格事件的参与者是账户，text[] 里没有人名。
 *   对齐代表把「李四」换成唯一户名账户 B，才查得到 B 的流水事件。
 *
 * 只在 `from auth.case_event`（未起别名）的查询里用：片段裸引 `participants` / `case_event.id`。
 */
export function 事件参与者条件(ctx: 工具上下文, 实体: 实体解析): SQL {
  const 代表 = 对齐代表(
    ctx.身份.projectId,
    sql`${实体.id}`,
    sql`${实体.type}`,
    sql`${实体.value}`,
  )
  return sql`(exists (select 1 from unnest(participants) as 参与者 where 参与者 = ${实体.value})
    or exists (select 1 from auth.case_event_participant p
                where p.project_id = ${ctx.身份.projectId}
                  and p.event_id = case_event.id
                  and p.entity_id = ${代表}))`
}

/** 事件：按类型与参与实体过滤，时间按 `occurred_at` 闭区间。 */
export async function query_events(
  ctx: 工具上下文,
  args: {
    起?: number
    止?: number
    类型?: string
    参与实体?: string
    地点?: string
    含已排除?: boolean
    限制?: number
  },
): Promise<工具结果> {
  // 时间窗校验先于地点拒答：反向窗口本身就是坏入参，若先回「能力未就绪」，下一步会带着
  // 这组起止重跑并立即抛 `bad_input`，等于建议一个跑不通的查询。
  校验时间窗(args)
  // `09` §4.5 / D5：事件表没有地点维度，`地点` 只可能出现在摘要文本里。
  // **在取数之前**明确拒答 `能力未就绪`：静默忽略会让「某地点某周发生了什么」
  // 变成「这周所有事件」，是比报错更危险的答非所问。
  if (args.地点 !== undefined && args.地点 !== "") {
    const 参数: Record<string, unknown> = {}
    if (args.起 !== undefined) 参数.起 = args.起
    if (args.止 !== undefined) 参数.止 = args.止
    return {
      摘要: `按地点检索事件尚未支持：事件表没有地点维度，无法按「${args.地点}」这类地点过滤`,
      数据: null,
      口径: "事件只按类型、参与实体与时间过滤；材料里没有地点字段，`地点` 参数不参与取数",
      缺口: ["事件表没有地点维度：地点只可能出现在事件摘要文本里，不能当作过滤条件"],
      空原因: "能力未就绪",
      出处: [],
      下一步: [{ 工具: "query_events", 参数, 为什么: "先按时间窗取事件，再在摘要里人工看地点" }],
    }
  }
  const 限制 = 归一化限制(args.限制)
  const 条件: SQL[] = [sql`project_id = ${ctx.身份.projectId}`]
  if (args.类型 !== undefined) 条件.push(sql`type = ${args.类型}`)
  if (args.含已排除 !== true) 条件.push(sql`trust_state <> '已排除'`)
  if (args.起 !== undefined) 条件.push(sql`occurred_at is not null and occurred_at >= ${args.起}`)
  if (args.止 !== undefined) 条件.push(sql`occurred_at is not null and occurred_at <= ${args.止}`)
  let 参与实体解析: 实体解析 | undefined
  if (args.参与实体 !== undefined) {
    参与实体解析 = await 解析实体(ctx, args.参与实体, "参与实体")
    // 「事件是否涉及该实体」只有一处定义（`事件参与者条件`）：text[] 规范值 ∪ 参与者表的对齐代表。
    // `participants` 存的是**实体规范值**、不是 id（`case-extract.ts:433` 写 `canonicalValue`），
    // 比 id 会让过滤在生产数据上恒空、静默返回 []（`#006-11`）。
    条件.push(事件参与者条件(ctx, 参与实体解析))
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
  const 身份们 =
    参与实体解析 === undefined
      ? []
      : [
          ...(
            await 读身份标注(ctx.db, ctx.身份.projectId, [
              { id: 参与实体解析.id, 类型: 参与实体解析.type, 值: 参与实体解析.value },
            ])
          ).values(),
        ]
  const 后缀 = 身份后缀(身份们)
  const 空 = 数据为空(数据)
  // 取数按 `occurred_at desc` 排序：`数据[0]` 才是最近的一个（末尾是最早的）。
  const 最近 = 数据[0]
  return {
    摘要: 空
      ? `时间窗内没有事件${args.类型 ? `（类型=${args.类型}）` : ""}${后缀}`
      : `${数据.length} 个事件${args.类型 ? `（类型=${args.类型}）` : ""}，最近一个是「${String(最近!.summary ?? 最近!.type)}」${后缀}`,
    数据,
    口径:
      "事件按类型与参与实体（先按 id、再按规范值解析成实体规范值；规范值跨类型可重名时取最新创建的一行，" +
      "同创建时间再按 type 升序、id 升序取第一条）过滤；参与实体按 participants 规范值或参与者表的对齐代表命中（人 → 唯一户名账户）；" +
      "时间按 occurred_at 闭区间；默认不含「已排除」的事件，" +
      "participants 里「已排除」实体的规范值也一并剔除；时间以规范值（UTC+8）比较，按各自精度标注。" + 身份口径,
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
    ...(身份们.length === 0 ? {} : { 身份: 身份们 }),
  }
}

/** 文本列：驱动回的不是字符串就当缺失（`String(unknown)` 会把对象串成 `[object Object]`）。 */
function 文本(值: unknown): string | null {
  return typeof 值 === "string" ? 值 : null
}

/**
 * 时间线（09 §4.3 / 10 §6.3）：某实体或某地点的事件，按 `(occurred_at, id)` **升序**游标翻页。
 *
 * 空原因四拆（顺序即优先级）：
 * 1. `地点` 分支 ⇒ `能力未就绪`（事件表没有地点维度，先拒答）；
 * 2. 该实体全期 0 个事件 ⇒ `对象未登记`（不是「没有事件」——对象根本不在事件里）；
 * 3. 有事件但全部缺时间 ⇒ `时间全部缺失`；
 * 4. 其余（有时间事件但窗口内 0 条）⇒ `无事件`。
 *
 * 查询预算 ≤7：解析 1 + 事件 1 + 统计 1 + 参与者 1 + 出处 1 + 读身份标注 2
 * （plan D-6，见 `docs/superpowers/plans/2026-11-13-P3-去重与卡片读端.md:36`）。
 * 参与者也走 `事件参与者条件`（含对齐），所以按人能看到其唯一户名账户的流水事件。
 */
export async function query_timeline(
  ctx: 工具上下文,
  args: {
    实体?: string
    地点?: string
    起?: number
    止?: number
    类型?: string
    游标?: string
    限制?: number
  },
): Promise<工具结果> {
  校验时间窗(args)
  if (args.实体 !== undefined && args.地点 !== undefined)
    throw new 工具错误("bad_input", "实体与地点只能给一个")
  if (args.地点 !== undefined && args.地点 !== "") {
    const 参数: Record<string, unknown> = {}
    if (args.起 !== undefined) 参数.起 = args.起
    if (args.止 !== undefined) 参数.止 = args.止
    return {
      摘要: `按地点查时间线尚未支持：事件表没有地点维度，无法按「${args.地点}」过滤`,
      数据: null,
      口径: "时间线只按实体、类型与时间过滤；材料里没有地点字段，`地点` 参数不参与取数",
      缺口: ["事件表没有地点维度：地点只可能出现在事件摘要文本里，不能当作过滤条件"],
      空原因: "能力未就绪",
      出处: [],
      下一步: [{ 工具: "query_events", 参数, 为什么: "先按时间窗取事件，再在摘要里人工看地点" }],
    }
  }
  if (args.实体 === undefined || args.实体 === "")
    throw new 工具错误("bad_input", "实体与地点必须给一个（本期地点只返回「能力未就绪」）")

  const 实体 = await 解析实体(ctx, args.实体, "实体")
  const 限制 = 归一化限制(args.限制)
  const 参与 = 事件参与者条件(ctx, 实体)
  const 类型条件 = args.类型 === undefined ? sql`` : sql`and type = ${args.类型}`

  let 游标: { t: number; id: string } | undefined
  if (args.游标 !== undefined) {
    let 解: Record<string, unknown>
    try {
      解 = 解码游标对象(args.游标)
    } catch {
      throw new 工具错误("bad_input", "游标不是本函数签发的形状（应原样回传上一页给出的续页游标）")
    }
    const { t, id } = 解
    if (typeof t !== "number" || !是int32(t) || typeof id !== "string" || id === "" || id.includes("\u0000"))
      throw new 工具错误("bad_input", "游标字段不全、类型不对或数值超出 integer 范围")
    游标 = { t, id }
  }

  const 窗: SQL[] = [sql`occurred_at is not null`]
  if (args.起 !== undefined) 窗.push(sql`occurred_at >= ${args.起}`)
  if (args.止 !== undefined) 窗.push(sql`occurred_at <= ${args.止}`)
  // 游标条件与排序一致：(occurred_at, id) 严格大于上一页最后一行。
  if (游标 !== undefined)
    窗.push(sql`(occurred_at > ${游标.t} or (occurred_at = ${游标.t} and id > ${游标.id}))`)

  const 行们 = rowsOf(
    await ctx.db.execute(sql`
      select id, type, occurred_at, occurred_raw, precision,
             array_to_json(participants)::text as participants, summary, trust_state
        from auth.case_event
       where project_id = ${ctx.身份.projectId} and trust_state <> '已排除'
         and ${参与} ${类型条件}
         and ${sql.join(窗, sql` and `)}
       order by occurred_at asc, id asc
       limit ${限制 + 1}
    `),
  )
  const 本页 = 行们.slice(0, 限制)
  const 下一页游标 =
    行们.length > 限制 && 本页.length > 0
      ? 编码游标对象({ t: Number(本页[本页.length - 1].occurred_at), id: String(本页[本页.length - 1].id) })
      : null

  // 统计：全期事件数与「有时间」的事件数。窗口、游标、**类型**都不进——
  // 空原因是对象的属性（`09` §3.5：「对象未登记」= 实体不在事件参与者集合里）；
  // 若让 `类型` 参与，一个只有话单事件的实体查「转账」时间线会被误报成「对象未登记」。
  const 统计 = rowsOf(
    await ctx.db.execute(sql`
      select count(*)::int as 总数,
             count(*) filter (where occurred_at is not null)::int as 有时数
        from auth.case_event
       where project_id = ${ctx.身份.projectId} and trust_state <> '已排除'
         and ${参与}
    `),
  )[0]
  const 总数 = Number(统计?.总数 ?? 0)
  const 有时数 = Number(统计?.有时数 ?? 0)
  const 缺时间条数 = 总数 - 有时数

  const 空 = 本页.length === 0
  const 空原因: 空原因值 | null = 空
    ? 总数 === 0
      ? "对象未登记"
      : 有时数 === 0
        ? "时间全部缺失"
        : "无事件"
    : null

  const ids = 本页.map((行) => String(行.id))
  const 参与者按事件 = new Map<string, string[]>()
  if (!空) {
    const 参与者行 = rowsOf(
      await ctx.db.execute(sql`
        select p.event_id, p.role, e.canonical_value as value
          from auth.case_event_participant p
          join auth.case_entity e on e.project_id = p.project_id and e.id = p.entity_id
         where p.project_id = ${ctx.身份.projectId} and p.event_id = any(${文本数组(ids)})
         order by p.event_id asc, p.ordinal asc
      `),
    )
    for (const 行 of 参与者行) {
      const id = String(行.event_id)
      const 列 = 参与者按事件.get(id)
      const 项 = `${String(行.role)}：${String(行.value)}`
      if (列 === undefined) 参与者按事件.set(id, [项])
      else 列.push(项)
    }
  }
  const 引用按事件 = 空 ? new Map<string, 引用视图[]>() : await 批量引用(ctx.db, ctx.身份.projectId, "event", ids)

  const 事件们 = 本页.map((行) => {
    const id = String(行.id)
    const 参与者 =
      参与者按事件.get(id) ?? 解JSON<string[]>(行.participants, []).map((值) => `参与者：${值}`)
    const 引用 = 引用按事件.get(id)?.[0]
    return {
      id,
      类型: String(行.type),
      时间: Number(行.occurred_at),
      时间精度: 文本(行.precision),
      时间原文: 文本(行.occurred_raw),
      参与者,
      事件摘要: 文本(行.summary),
      信任态: String(行.trust_state),
      代表出处:
        引用 === undefined
          ? null
          : { 材料: 引用.fileName, 定位: 引用.locator },
    }
  })

  // 升序排列下 `事件们` 末尾是**本页最新**的一条；`下一步` 的 `query_rows` 建议以它为锚。
  const 末事件 = 事件们.length === 0 ? undefined : 事件们[事件们.length - 1]
  // `query_rows` 的 `材料` 是**材料 id**（`引用.materialId`），不是 `代表出处.材料`（那是文件名，
  // 给人看的）。传文件名会被 `query_rows` 判「材料未入库」。
  const 末引用 = 末事件 === undefined ? undefined : 引用按事件.get(末事件.id)?.[0]

  const 身份们 = [
    ...(
      await 读身份标注(ctx.db, ctx.身份.projectId, [
        { id: 实体.id, 类型: 实体.type, 值: 实体.value },
      ])
    ).values(),
  ]
  const 后缀 = 身份后缀(身份们)
  const 称呼 = 实体称呼(实体, args.实体)
  const 缺口 = [
    ...截断缺口(args.限制, 限制, 本页.length),
    `${限制} 条/页（时间升序）；游标只经本工具返回，不要自己造`,
  ]
  if (缺时间条数 > 0) 缺口.push(`${缺时间条数} 个事件没有时间，未进入时间线`)
  if (下一页游标 !== null) 缺口.push("还有下一页：把本页 `下一页游标` 原样传回 `游标`")
  // 游标越过了末页：事件都在游标之前。`空原因` 仍是 `无事件`（状态机不变），
  // 只说清「不是没有数据，是翻过了头」，免得把游标失效误读成对象没事件。
  if (空 && args.游标 !== undefined && 总数 > 0 && 有时数 > 0)
    缺口.push("游标之后没有更多事件（换第一页或更早的游标再翻）")

  return {
    摘要: 空
      ? 空原因 === "对象未登记"
        ? `${称呼}在事件里没有出现（对象存在但没有任何事件）${后缀}`
        : 空原因 === "时间全部缺失"
          ? `${称呼}有 ${总数} 个事件，但全都没有时间，排不出时间线${后缀}`
          : `${称呼}在给定时间窗内没有事件${后缀}`
      : `${称呼}的 ${事件们.length} 个事件（时间升序）${事件们[0].时间原文 ?? 事件们[0].类型} 起${后缀}`,
    数据: 空 ? null : { 事件们, 缺时间条数, 下一页游标 },
    口径:
      "事件按实体（先按 id、再按规范值解析；参与实体走 text[] 规范值 ∪ 参与者表的对齐代表）过滤；" +
      "时间按 occurred_at 闭区间、升序排列；游标是 (occurred_at, id)；默认不含「已排除」事件；" +
      "时间为 UTC+8 规范值，精度按各自标注。" + 身份口径,
    缺口,
    空原因,
    出处: 空
      ? []
      : 事件们.slice(0, 3).map((行) => ({
          事实: `事件「${行.类型}」@${行.时间原文 ?? String(行.时间)}`,
          代表: 行.id,
          可下钻: "get_citation",
        })),
    下一步: 空
      ? []
      : [
          ...(下一页游标 === null
            ? []
            : [
                {
                  工具: "query_timeline",
                  参数: {
                    实体: args.实体,
                    ...(args.起 === undefined ? {} : { 起: args.起 }),
                    ...(args.止 === undefined ? {} : { 止: args.止 }),
                    ...(args.类型 === undefined ? {} : { 类型: args.类型 }),
                    游标: 下一页游标,
                  },
                  为什么: "继续看下一页（时间升序）",
                },
              ]),
          {
            工具: "get_citation",
            参数: { 事实类型: "event", 事实id: 事件们[0].id },
            为什么: "抽验时间线第一条事件的原文与出处",
          },
          // `09` §4.3 的下一步契约有两条：抽验（get_citation）与看该事件明细（query_rows）。
          // `材料` 取材料 **id**（`query_rows` 按 id 查，文件名会被判 `材料未入库`）；
          // 没有引用时不写这个键。
          ...(末事件 === undefined
            ? []
            : [
                {
                  工具: "query_rows",
                  参数: {
                    ...(末引用 === undefined ? {} : { 材料: 末引用.materialId }),
                    时间起: 末事件.时间,
                    时间止: 末事件.时间,
                  },
                  为什么: "看该事件的明细行",
                },
              ]),
        ],
    ...(身份们.length === 0 ? {} : { 身份: 身份们 }),
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
    const 缺口: string[] = []
    if (引用.length === 0) {
      缺口.push("明细行引用尚未在生产写入，查不到时只能按 material/sheet/row_no 定位")
    }
    // 材料定位只取 `case_material.path`（入队写的就是项目内文件名）；材料行没了就不编。
    const 材料行 = await getMaterial(ctx.db, ctx.身份.projectId, 材料)
    if (材料行 === undefined) 缺口.push("材料已不在本项目的材料表里，给不出材料定位")
    const 原文表 = await 读原文表(ctx, 引用)
    return {
      摘要: `明细行原文：${材料}#${工作表}#${行号}`,
      数据: {
        材料定位:
          材料行 === undefined ? null : { path: 材料行.path, sheet: 工作表, rowNo: Number(行号) },
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
          // 币种列（snake_case 与其他列一致）：漏掉它时 USD 行只回金额，等于把外币当人民币
          // 展示。这是 `行视图` 已有的判据，手工投影必须同步（`#002-06`）。
          currency: 行.currency,
          // 保持原有默认：库里 `extras` 是 NOT NULL DEFAULT '{}'，读不到时仍给 `{}` 而不是 null
          // （`09` §3.4 的老规矩：字段缺席会让模型把「没有备注」讲成「这行没信息」）。
          extras: 行.extras ?? {},
        },
        引用: 引用行(引用, 原文表, 缺口),
      },
      口径:
        "明细行按「材料#工作表#行号」解析；`引用` 为库列名；`材料定位` 取 `case_material.path`，" +
        "`原文切片` 按引用 locator 的 `{start,end}` 从材料正文切出（切不出为 null）。",
      缺口,
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
  // 事实本身存在 ⇒ 数据非空，`空原因` 恒 null；「一条引用都没有」是缺口，不是空。
  const 缺口: string[] = citations.length === 0 ? ["该事实暂无引用记录"] : []
  const 原文表 = await 读原文表(ctx, citations)
  return {
    摘要: `${args.事实类型} 引用详情：${args.事实id}`,
    数据: { 事实: 本体, 引用: 引用行(citations, 原文表, 缺口), 变更历史: changes },
    口径:
      "`事实` 与 `变更历史` 沿用仓内只读出口的字段名，`引用` 为库列名；" +
      "`原文切片` 按引用 locator 的 `{start,end}` 从材料正文切出（切不出为 null）。",
    缺口,
    空原因: null,
    出处: [{ 事实: `${args.事实类型} ${args.事实id}`, 代表: args.事实id, 可下钻: null }],
    下一步: [],
  }
}

/**
 * 明细回溯（`09` §4.4）。只读 `case_fact_row`，不写 `case_citation`（`01` §7.11）。
 *
 * 契约唯一来源是 `09` §4.4；入参校验与分页语义**全部**在内核 `查明细行`（`01` P1）。
 * 这里做三件事：把 `明细入参错误` 折成工具的 `bad_input`（其余异常原样抛，交给 server
 * 折 `tool_failed`）；把内核返回的五个字段映射成七字段；单页超 30 KB 时按字节预算退让、
 * 用更小的 `限制` **重取同一页**（游标因此落在真正交付的最后一行，见函数内注释）。
 * **不重写一遍条件判断**——同一判据开第二个出处，迟早漂成「工具说不匹配、内核说匹配」（`#002-06`）。
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
  const 取页 = async (限制?: number): Promise<明细查询结果> => {
    try {
      return await 查明细行(ctx.db, {
        projectId: ctx.身份.projectId,
        ...args,
        ...(限制 === undefined ? {} : { 限制 }),
      })
    } catch (错) {
      // 入参错了不是「没数据」：折成 bad_input 让模型改参数，别退化成空结果。
      if (错 instanceof 明细入参错误) throw new 工具错误("bad_input", 错.message)
      throw 错
    }
  }

  let 结果 = await 取页(args.限制)
  let 行们 = 结果.数据.行们

  // 一页有多大，由工具自己按 §3.4 的字节预算决定（服务端截断从此只作兜底）。
  //
  // 为什么不能交给服务端截：服务端截断在工具写完 摘要 / 出处 / 下一步 **之后**，而续页游标
  // 是内核按**未截断的页尾**签发的。整页超 30 KB 时，被服务端截掉的那些行用游标永远取不回来
  // （第 N+1..50 行永久跳过），摘要里的行数也与交付不符。退让后**重取同一页**，游标就落在
  // 真正交付的最后一行。
  let 字节退让 = 0 // 0 = 未因字节退让；>0 = 实际交付的前 k 行
  let 原请求行数 = 0
  if (结果.空原因 === null && 序列化字节(行们) > 数据预算字节) {
    原请求行数 = 行们.length
    // 行大小不均，二分要额外调用；线性从 len-1 往下退（纯内存测量，不打库）。
    let k = Math.max(原请求行数 - 1, 1)
    while (k > 1 && 序列化字节(行们.slice(0, k)) > 数据预算字节) k--
    // 「连首行都装不下」不在这里补缺口：服务端 30 KB 兜底会写「首条记录自身即超限」，
    // 游标仍按第 1 行签出（下一行从第 2 行开始，不漏）。
    if (序列化字节(行们.slice(0, k)) <= 数据预算字节) 字节退让 = k
    结果 = await 取页(字节退让 === 0 ? 1 : 字节退让)
    行们 = 结果.数据.行们
  }
  const 缺口 =
    字节退让 === 0
      ? 结果.缺口
      : [
          ...结果.缺口,
          `本页按 30 KB 上限只取前 ${字节退让} 行（原请求 ${原请求行数} 行），其余可用「下一页游标」继续取`,
        ]
  // ⚠️ `数据` 必须是**行数组**，不能包成 `{ 行们, 下一页游标 }`：
  // R5 的「空 = null 或长度 0 的数组」只有数组判得出来；对象会让七字段镜像校验与
  // 30 KB 截断双双失效（对象永不为空、截断只处理数组）。游标只经 `下一步` 交给模型。
  const 下一页游标 = 结果.数据.下一页游标
  // `09` §4.5 第 2 条（裁定 A）：外币行不进合计。明细行照常返回（带 `币种`），
  // 缺口里写明**本页**有多少行非人民币未计入——分页时不能声称全库只有这些外币行。
  //
  // 「全是外币」的空原因只在**一整次结果都看得见**时给：没有进来时的游标、也没有下一页，
  // 否则把「本页恰好全外币」说成「外币行全部未计入」，是在声称一个没检查过的结论。
  // 命中时 `数据: []`，满足「`空原因` 非空 ⇒ `数据` 为空」的七字段不变量。
  const 非人民币行数 = 行们.filter((行) => 行.币种 !== "CNY").length
  const 全外币 =
    结果.空原因 === null &&
    行们.length > 0 &&
    非人民币行数 === 行们.length &&
    args.游标 === undefined &&
    下一页游标 === null
  const 空原因: 空原因值 | null = 全外币 ? "外币行全部未计入" : 结果.空原因
  if (全外币) 行们 = []
  const 本页缺口 = 非人民币行数 > 0 ? [...缺口, `本页 ${非人民币行数} 行非人民币未计入`] : 缺口
  const 空 = 空原因 !== null
  return {
    摘要: 空
      ? // 取**最后一条**缺口：内核先推截断提示（「请求的 N 行超过上限」，`case-row-query.ts:350`），
        // 再推真正的空原因细节（`360` / `369`）——首条在两者同时成立时是截断提示，不是真因。
        `没取到明细：${空原因}${本页缺口.length > 0 ? `（${本页缺口[本页缺口.length - 1]!}）` : ""}`
      : `取到 ${行们.length} 行明细${args.材料 ? `（材料 ${args.材料}）` : ""}${args.账户 ? `（账户 ${args.账户}）` : ""}${下一页游标 ? "，还有下一页" : ""}`,
    // 空结果就是 `[]`，与 `空原因` 非 null 天然一致（`09` §4.4 补白的镜像）。
    数据: 行们,
    口径: 结果.口径,
    缺口: 本页缺口,
    空原因,
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
  // R-C：解析不到且项目里有未解析材料时，回「材料未翻译」信封（不是 not_found）。
  const 解析结果 = await 解析账户(ctx, args.账户)
  if ("信封" in 解析结果) return 解析结果.信封
  const 账户 = 解析结果.实体
  const 身份们 = [
    ...(
      await 读身份标注(ctx.db, ctx.身份.projectId, [
        { id: 账户.id, 类型: 账户.type, 值: 账户.value },
      ])
    ).values(),
  ]
  const 账户称呼 = 实体称呼(账户, args.账户)
  const 后缀 = 身份后缀(身份们)

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
  // 笔数口径：times_cny 为 NULL 时回退 times，再回退 1（human 行没有 times，D-2）。
  // 该值为 0 = 纯外币关系：不进汇总/对手方，但仍出现在 query_relations。
  const 人民币笔数 = sql`coalesce(times_cny, times, 1) > 0`
  const 对手人民币笔数 = sql`coalesce(r.times_cny, r.times, 1) > 0`

  const 汇总 = rowsOf(
    await ctx.db.execute(sql`
      select case when from_id ${id属于(账户.ids)} then '出' else '入' end as 方向,
             sum(coalesce(times_cny, times, 1))::int as 笔数,
             coalesce(sum(amount), 0)::text as 合计
        from auth.case_relation
       where ${sql.join(汇总条件, sql` and `)} and ${人民币笔数}
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
      select coalesce(min(case when 对手.type in ('人', '组织') then 对手.canonical_value end),
                      min(case when 对手.type not in ('人', '组织') then 账户户名.代表值 end),
                      min(对手.canonical_value)) as 对手方,
             case when r.from_id ${id属于(账户.ids)} then '出' else '入' end as 方向,
             sum(coalesce(r.times_cny, r.times, 1))::int as 笔数,
             coalesce(sum(r.amount), 0)::text as 合计,
             max(对齐.候选数)::int as 候选数
        from auth.case_relation r
        join auth.case_entity 对手
          on 对手.project_id = r.project_id
         and 对手.id = case when r.from_id ${id属于(账户.ids)} then r.to_id else r.from_id end
         and 对手.trust_state <> '已排除'
        left join lateral ${户名对齐(ctx.身份.projectId, sql`对手.id`, sql`对手.type`, sql`对手.canonical_value`)} 对齐 on true
        left join lateral (
          -- 别名方向：entity_id = 账户，value = 人名。所以人名要按 **value** 反查，
          -- 不能 p.id = a.entity_id——那拿到的是账户自己（P2「写入翻译结果」的写口）。
          select min(p.canonical_value) as 代表值
            from auth.case_entity_alias a
            join auth.case_entity p on p.project_id = a.project_id and p.canonical_value = a.value
           where a.project_id = ${ctx.身份.projectId} and a.kind = '户名' and a.revoked_at is null
             and p.trust_state <> '已排除' and p.type = '人'
             and a.entity_id = 对手.id
          having count(distinct p.canonical_value) = 1
        ) 账户户名 on true
       where ${sql.join(对手方条件, sql` and `)} and ${对手人民币笔数}
       group by 方向,
                coalesce(对齐.代表, 对手.id)
       order by sum(r.amount) desc nulls last, 对手方 asc
       limit ${对手方上限}
    `),
  ).map((行) => ({
    对手方: String(行.对手方),
    方向: String(行.方向),
    笔数: Number(行.笔数),
    合计: String(行.合计),
    _候选数: Number(行.候选数 ?? 0),
  }))
  // `_候选数` 只进缺口，不进 `数据`：歧义（同一人名对应多个账户）不自动合并。
  const 歧义条数 = 对手方.filter((行) => 行._候选数 >= 2).length
  const 对外对手方 = 对手方.map(({ _候选数, ...行 }) => 行)

  // 明细行（余额走势 / 外币行数）共用「账户精确匹配 + 时间窗」这一份基础条件（`#002-06`）：
  // 两条查询只差币种那一条，复制两遍迟早漂成「余额含外币、缺口数不含」。
  const 明细基础条件: SQL[] = [
    sql`project_id = ${ctx.身份.projectId}`,
    sql`(counterparty = ${账户.value}
      or counterparty_name = ${账户.value}
      or owner_account = ${账户.value}
      or caller = ${账户.value}
      or callee = ${账户.value})`,
  ]
  if (args.起 !== undefined) 明细基础条件.push(sql`started_at is not null and started_at >= ${args.起}`)
  if (args.止 !== undefined) 明细基础条件.push(sql`started_at is not null and started_at <= ${args.止}`)
  // 余额走势只取人民币（`09` §4.5 第 2 条）：外币余额与人民币余额相加是汇率级错误。
  const 余额条件 = [...明细基础条件, sql`currency = 'CNY'`]
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
  // 外币行数：同一匹配条件上换一条币种条件。**不加** `余额行上限`——上限管「返回多少行」，
  // 不管「窗口里有多少行」，截断后计数会少报（`#011-02` fail-closed：宁可多报未计入）。
  // `解析币种` 已把认不出的币种原样大写保留，所以 `<> 'CNY'` 就是「非人民币」，不用枚举。
  const 外币行数 = Number(
    rowsOf(
      await ctx.db.execute(sql`
        select count(*)::int as 数
          from auth.case_fact_row
         where ${sql.join([...明细基础条件, sql`currency <> 'CNY'`], sql` and `)}
      `),
    )[0]?.数 ?? 0,
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
  //
  // 【只有外币】本页明细里只有外币行（`外币行数 > 0`）、人民币余额走势为空，且汇总/对手方
  // 没有任何非零金额（纯外币关系已被 SQL 的 `人民币笔数` 过滤，这里只剩金额 0.00 的人民币行）
  // ⇒ 按空处理，让 `判资金空原因` 回「外币行全部未计入」。
  // 守卫的实际作用：若只凭「有行」判非空，`09` §4.5 第 2 条的外币原因永远不可达，还会把
  // 「窗口里明明有外币流水」讲成「没有任何交易」（§5.2 纪律 2）。
  // （`#013-02` 同型：派生行改变了上游判据的输入形状，判据要跟着看语义而不是看行数。）
  const 只有外币 =
    外币行数 > 0 &&
    余额走势 === null &&
    [...汇总, ...对手方].every((行) => Number(行.合计) === 0)
  const 空 = (汇总.length === 0 && 对手方.length === 0 && 余额走势 === null) || 只有外币
  // R-W：未解析材料份数每查必报（缺口），空时还要拿它当第 1、2 条的前置。只查一次。
  const 未解析份数 = await 未解析材料数(ctx)
  // 空结果的原因按证据判（`09` §3.5 资金四拆）：不是「一律无匹配行」。只在空时查一次证据。
  const 证据 = 空 ? await 查空证据(ctx, 账户, args, 未解析份数) : undefined
  const 空原因: 空原因值 | null = 证据 === undefined ? null : 判资金空原因(证据, 账户, 外币行数)
  // 「材料没翻译」是数据类空原因：摘要与下一步都要指向「去解析」，不能讲成「没有」。
  const 材料未翻译 = 空原因 === "项目内资金材料未翻译"
  // 全外币也是「不能下人民币结论」，但同理不许说成「没有任何流水」（`09` §5.2 纪律 2）。
  const 外币未计入 = 空原因 === "外币行全部未计入"
  // `对手方` 是按「对手方 + 方向」分组的（来/回各一行）⇒ 按行数说「N 个对手」会把同一人算两次。
  const 对手个数 = new Set(对外对手方.map((行) => String(行.对手方))).size
  const 缺口 = [
    "只统计已抽成关系（type=转账）的转账；明细行里未抽成关系的转账不计入",
    "对手方按对齐后的代表实体聚合（唯一未撤销户名证据；0 或多候选不对齐，按各自实体分开）",
    `对手方最多 ${对手方上限} 条（按合计金额降序）`,
    "余额只按精确匹配取明细行，未做模糊匹配；人民币余额行超过 200 行截断",
  ]
  // 与 `截断缺口` 同口径：命中上限才说「可能还有更多」，没满就不制造假警报。
  if (对手方.length === 对手方上限) 缺口.push(`对手方已截到前 ${对手方上限} 条，可能还有更多`)
  // 这条只在**确实一行都没有**时成立：有外币行时「没有该账户的流水」与下一条外币缺口
  // 自相矛盾（窗口里明明有流水，只是不计入人民币口径）。
  if (余额行.length === 0 && 外币行数 === 0)
    缺口.push("本项目明细行里没有该账户的流水（按 counterparty/counterparty_name/owner_account/caller/callee 精确匹配）")
  // 纯外币关系（times_cny = 0）不进汇总/对手方，但确实存在——不说清，模型会把
  // 「看不到」讲成「没有」（09 §5.2 纪律 2）。
  const 纯外币条数 = Number(
    rowsOf(
      await ctx.db.execute(sql`
        select count(*)::int as 数
          from auth.case_relation
         where ${sql.join([...汇总条件, sql`coalesce(times_cny, times, 1) = 0`], sql` and `)}
      `),
    )[0]?.数 ?? 0,
  )
  if (纯外币条数 > 0)
    缺口.push(`${纯外币条数} 条转账关系金额为 0.00 且笔数含外币（外币金额不进合计）`)
  // 计数按「对手方 + 方向」行数（`歧义条数`），不是人/户名的去重个数——文案跟着计数口径说。
  if (歧义条数 > 0)
    缺口.push(`${歧义条数} 条对手方记录对应的户名有多个账户，未合并（按各自账户分开）`)
  // `09` §4.5 第 2 条：外币行不进合计。恒追加（不论结果空不空）——模型据此写明未计入的行数。
  if (外币行数 > 0) 缺口.push(`本窗口内 ${外币行数} 行非人民币未计入汇总与余额走势`)
  // R-W：不管命中哪一条空原因（甚至结果非空），只要项目里还有没解析的材料，就必须在缺口里说清。
  if (未解析份数 > 0) 缺口.push(未翻译缺口(未解析份数))
  return {
    摘要: 空
      ? 材料未翻译
        ? `${账户称呼}的资金材料还没翻译完：项目内还有 ${未解析份数} 份材料尚未解析，现在不能断定有没有交易${后缀}`
        : 外币未计入
          ? `${账户称呼}在给定条件下只有 ${外币行数} 行外币流水，外币不进合计，无法给出人民币口径的结论${后缀}`
          : `${账户称呼}在给定条件下没有任何转账关系或明细流水${后缀}`
      : `${账户称呼}${汇总.map((行) => `${行.方向} ${行.笔数} 笔 / ${行.合计} 元`).join("，") || "无转账关系"}；${对手个数} 个对手${余额走势 ? `；明细 ${余额走势.行数} 行` : 外币行数 > 0 ? "；无人民币明细流水" : "；无明细流水"}${后缀}`,
    数据: 空 ? null : { 汇总, 对手方: 对外对手方, 余额走势, 外币行数 },
    口径:
      "汇总与对手方只统计 type=转账 且非「已排除」的关系（对手方实体也须非「已排除」），按出/入分组；" +
      "账户先按 id、再按规范值解析，规范值跨类型可重名时取最新创建的一行，同创建时间再按 type 升序、id 升序取第一条；" +
      "按规范值查询时合并同值多行的关系；" +
      "金额为 numeric 字符串，勿自行转浮点；" +
      "余额走势与外币行数都按明细行的 counterparty/counterparty_name/owner_account/caller/callee 精确匹配账户的实体规范值；" +
      "余额走势只取 currency = 'CNY' 的明细行（行数为参与走势的人民币行数），外币行数按 currency <> 'CNY' 计数。" + 身份口径,
    // 有外币行时这句「也无明细流水」是假话（外币行只是不计入）——改由上面的外币缺口说明。
    缺口:
      空 && 外币行数 === 0
        ? [...缺口, "汇总、对手方、余额走势三者都为空：该账户在时间窗内既无转账关系也无明细流水"]
        : 缺口,
    空原因,
    // `代表` 是**下钻入参**（账户规范值），不是事实 id：`query_rows` 的 `账户` 直接吃它。
    // `query_rows` 已注册，这条下钻可用。
    出处: 空
      ? []
      : [{ 事实: `账户「${账户.value}」的转账汇总`, 代表: 账户.value, 可下钻: "query_rows" }],
    下一步: 空
      ? 材料未翻译
        ? [材料未翻译下一步]
        : [{ 工具: "query_entities", 参数: { 关键词: args.账户 }, 为什么: "确认这个账户在实体里到底叫什么规范值" }]
      : [
          {
            工具: "query_relations",
            // 汇总来自**关系**（type=转账），不是明细行：指向 `query_rows` 会让模型拿明细去
            // 核一个它根本凑不出来的合计（A2）。`query_relations` 吃 `实体`（规范值），
            // 时间窗照原样带过去，口径与 `汇总条件` 一致；不要在这里提内核不认识的键。
            参数: {
              实体: 账户.value,
              类型: "转账",
              ...(args.起 === undefined ? {} : { 起: args.起 }),
              ...(args.止 === undefined ? {} : { 止: args.止 }),
            },
            为什么: "看构成汇总的转账关系明细（汇总来自关系）",
          },
        ],
    ...(身份们.length === 0 ? {} : { 身份: 身份们 }),
  }
}

/**
 * 交叉分析：共同关联（关系另一端的交集）＋ 共同时空（事件参与者同时含两人）。
 *
 * 共同关联**每侧各查一次**再在 JS 求交：合成一条 `or` 查询再 `limit 500` 会让一方的边
 * 把配额吃光，另一方的交集被静默截断。
 *
 * 共同时空走共享的 `事件参与者条件`：text[] 规范值 ∪ 参与者表的对齐代表。
 * 只比 text[] 会让「按人查」看不到表格卡片的事件（表格参与者是账户）。
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
  const 身份表 = await 读身份标注(ctx.db, ctx.身份.projectId, [
    { id: 甲.id, 类型: 甲.type, 值: 甲.value },
    { id: 乙.id, 类型: 乙.type, 值: 乙.value },
  ])
  const 身份们 = [身份表.get(甲.id), 身份表.get(乙.id)].filter((a): a is 身份标注 => a !== undefined)
  const 后缀 = 身份后缀(身份们)
  const 甲称呼 = 实体称呼(甲, args.甲)
  const 乙称呼 = 实体称呼(乙, args.乙)

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
    事件参与者条件(ctx, 甲),
    事件参与者条件(ctx, 乙),
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
      ? `${甲称呼}与${乙称呼}没有共同关联，也没有共同时空${后缀}`
      : `${甲称呼}与${乙称呼}共同关联 ${共同关联.length} 个、共同时空 ${共同时空.length} 条${后缀}`,
    数据: 空 ? null : { 共同关联, 共同时空 },
    口径:
      "共同关联取与甲、乙各自相连且非「已排除」的关系的另一端实体，两侧各至多 500 条后在服务端求交；" +
      "甲、乙均先按 id、再按规范值解析，规范值跨类型可重名时取最新创建的一行，同创建时间再按 type 升序、id 升序取第一条；" +
      "按规范值查询时合并同值多行的关系；" +
      "共同时空按事件参与实体判定：participants 规范值，或参与者表里两人的对齐代表（人 → 唯一户名账户）；时间按 occurred_at 闭区间。" + 身份口径,
    缺口: 空 ? [...缺口, "共同关联与共同时空都为空：两侧在时间窗内没有可求交的边或事件"] : 缺口,
    空原因: 空 ? "无匹配行" : null,
    出处: 空
      ? []
      : [{ 事实: `「${args.甲}」与「${args.乙}」的交叉`, 代表: String(甲.id), 可下钻: "get_citation" }],
    下一步: 空
      ? [{ 工具: "query_relations", 参数: { 实体: args.甲 }, 为什么: "先看这一侧自己的关系，确认边是否已抽出来" }]
      : [{ 工具: "query_events", 参数: {}, 为什么: "共同时空往往是通话或同行，可按时间窗查事件" }],
    ...(身份们.length === 0 ? {} : { 身份: 身份们 }),
  }
}
