import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { Queryable } from "./case-store"
import type { 调用身份 } from "./case-mcp-identity"

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
 * `text[]` / `jsonb` 一律**以 JSON 文本出库**再解析：两个驱动的读回形状没有先例可依
 * （`case-fact-read.ts:22-26` 的结论）。所以查询里必须写 `array_to_json(col)::text` 或
 * `col::text`，不要裸选后 `as string[]` —— 那在 bun-sql 上会拿到 `"{a,b}"` 字符串，
 * 测试（PGlite）却可能是数组，绿在测试、错在生产。
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
