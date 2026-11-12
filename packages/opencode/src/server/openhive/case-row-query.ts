export * as OpenhiveCaseRowQuery from "./case-row-query"

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 归一化值 } from "./case-field-registry"
import { getMaterial, type Queryable } from "./case-store"
import { 默认限制, 最大限制, type 空原因值, type 出处项 } from "./case-envelope"

/**
 * 明细行读取（`01` §7.11 / `09` §4.4）。
 *
 * ## 一条 SQL、一个映射函数
 *
 * 行的读回（列序、`numeric` 转字符串、`extras` 解码）只有 {@link 读明细行} 一处；
 * 行的对外形状只有 {@link 行视图} 一处。`get_citation` 的行分支与列表查询都走这两个，
 * 不再各写一份——两份必然漂成「一边金额是字符串、一边是数字」（`#002-06`）。
 *
 * ## 行级出处不写库
 *
 * 行的出处就是主键 `材料#工作表#行号`，不读也不写 `case_citation.fact_type='row'`
 * （`01` §7.11：同一事实存两处，迟早不一致）。
 */

/** 入参错了（不是「没数据」）。MCP 层折成 `bad_input`，**不要**折成空结果。 */
export class 明细入参错误 extends Error {
  constructor(message: string) {
    super(message)
    this.name = "明细入参错误"
  }
}

/** 一行的原始读回形状。`amount` / `balance` 是 `numeric(18,2)` 的字符串，别转浮点。 */
export interface 明细行原始 {
  readonly projectId: string
  readonly materialId: string
  readonly sheet: string
  readonly rowNo: number
  readonly caller: string | null
  readonly callee: string | null
  readonly startedAt: number | null
  readonly startedRaw: string | null
  readonly precision: string | null
  readonly timeType: string | null
  readonly durationSec: number | null
  readonly amount: string | null
  readonly balance: string | null
  readonly counterparty: string | null
  readonly counterpartyName: string | null
  readonly ownerAccount: string | null
  readonly direction: "收" | "付" | null
  /** 币种：默认 `"CNY"`，外币原样大写（`09` §4.5 第 2 条）。 */
  readonly currency: string
  /** `extras` 已解码成对象（旧行可能是字符串，见 {@link 读杰森}）。 */
  readonly extras: unknown
}

/** 对外的明细行形状（中文键，与信封的 `摘要/数据/口径` 一致）。 */
export interface 明细行视图 {
  /** 材料 id。 */
  readonly 材料: string
  readonly 工作表: string
  readonly 行号: number
  /** 行级定位 `材料#工作表#行号`——就是主键，不解析 `fact_id`（工作表名可含 `#`）。 */
  readonly 定位: string
  /** Unix 秒；解析不出时间是 null（原始写法在 `时间原文`）。 */
  readonly 时间: number | null
  readonly 时间原文: string | null
  readonly 金额: string | null
  readonly 余额: string | null
  readonly 方向: "收" | "付" | null
  /** 币种：默认 `"CNY"`；外币行的金额**不参与** `money_flow` 合计（`09` §4.5 第 2 条）。 */
  readonly 币种: string
  readonly 本方账号: string | null
  readonly 对方账号: string | null
  readonly 对方户名: string | null
  /** `extras["备注"]`：预处理标准副本的固定列名（`01` §3.11.1）；没有就是 null。 */
  readonly 备注: string | null
}

const 列 = sql`project_id, material_id, sheet, row_no, caller, callee, started_at, started_raw,
       precision, time_type, duration_sec, amount::text as amount, balance::text as balance,
       counterparty, counterparty_name, owner_account, direction, currency, extras`

function 文本(值: unknown): string | null {
  return 值 === null || 值 === undefined ? null : String(值)
}

/** 读成不是整数就抛：错数字比没数字害人（`case-fact-read.ts` 同一判据）。 */
function 整数(值: unknown): number | null {
  if (值 === null || 值 === undefined) return null
  const n = Number(值)
  if (!Number.isInteger(n)) throw new Error(`整数列读回的不是整数：${String(值)}`)
  return n
}

/**
 * jsonb 两路收法：驱动已解析就原样，字符串才尝试解析。
 * 不做无条件 `JSON.parse`——那会把真标量 `"123"` 变成数字（`case-fact-read.ts:129` 同款）。
 */
function 读杰森(值: unknown): unknown {
  if (typeof 值 !== "string") return 值 ?? null
  if (!(值.startsWith("{") || 值.startsWith("["))) return 值
  try {
    return JSON.parse(值) as unknown
  } catch {
    return 值
  }
}

function 原始行(行: Record<string, unknown>): 明细行原始 {
  const 方向 = 文本(行.direction)
  return {
    projectId: String(行.project_id),
    materialId: String(行.material_id),
    sheet: String(行.sheet),
    rowNo: Number(行.row_no),
    caller: 文本(行.caller),
    callee: 文本(行.callee),
    startedAt: 整数(行.started_at),
    startedRaw: 文本(行.started_raw),
    precision: 文本(行.precision),
    timeType: 文本(行.time_type),
    durationSec: 整数(行.duration_sec),
    amount: 文本(行.amount),
    balance: 文本(行.balance),
    counterparty: 文本(行.counterparty),
    counterpartyName: 文本(行.counterparty_name),
    ownerAccount: 文本(行.owner_account),
    direction: 方向 === "收" || 方向 === "付" ? 方向 : null,
    // 老行 / 外部写入可能没有币种：读成 CNY，别让 undefined 漂到行视图（与列默认值同口径）。
    currency: 文本(行.currency) ?? "CNY",
    extras: 读杰森(行.extras),
  }
}

/** 单行按主键取。读不到 ⇒ `undefined`（不是抛错：调用方决定这是「空」还是 `not_found`）。 */
export async function 读明细行(
  db: Queryable,
  projectId: string,
  key: { readonly materialId: string; readonly sheet: string; readonly rowNo: number },
): Promise<明细行原始 | undefined> {
  const 行 = rowsOf(
    await db.execute(sql`
      select ${列}
        from auth.case_fact_row
       where project_id = ${projectId}
         and material_id = ${key.materialId}
         and sheet = ${key.sheet}
         and row_no = ${key.rowNo}
    `),
  )[0]
  return 行 === undefined ? undefined : 原始行(行)
}

/** `extras` 只认对象；数组 / 标量 / null 一律当「没有这个键」。 */
function 备注原文(extras: unknown): string | null {
  if (typeof extras !== "object" || extras === null || Array.isArray(extras)) return null
  const 值 = (extras as Record<string, unknown>)["备注"]
  if (值 === null || 值 === undefined) return null
  return typeof 值 === "string" ? 值 : String(值)
}

/** 原始行 → 对外视图。**这是行形状的唯一出处**。 */
export function 行视图(行: 明细行原始): 明细行视图 {
  return {
    材料: 行.materialId,
    工作表: 行.sheet,
    行号: 行.rowNo,
    定位: `${行.materialId}#${行.sheet}#${行.rowNo}`,
    时间: 行.startedAt,
    时间原文: 行.startedRaw,
    金额: 行.amount,
    余额: 行.balance,
    方向: 行.direction,
    币种: 行.currency ?? "CNY",
    本方账号: 行.ownerAccount,
    对方账号: 行.counterparty,
    对方户名: 行.counterpartyName,
    备注: 备注原文(行.extras),
  }
}

export interface 查明细行入参 {
  readonly projectId: string
  /** 材料 id（不是路径、不是文件名）。 */
  readonly 材料?: string
  /** 账户：命中**本方账号或对方账号**之一（R1）。入参先按去横线归一化。 */
  readonly 账户?: string
  readonly 方向?: "收" | "付"
  /** `numeric(18,2)` 字符串；闭区间。 */
  readonly 金额起?: string
  readonly 金额止?: string
  /** Unix 秒；闭区间。 */
  readonly 时间起?: number
  readonly 时间止?: number
  /** 上一页最后一行；**只回传本函数签发的那串**，自己造即 `明细入参错误`。 */
  readonly 游标?: string
  readonly 限制?: number
}

export interface 明细查询结果 {
  readonly 数据: {
    readonly 行们: readonly 明细行视图[]
    readonly 下一页游标: string | null
  }
  readonly 口径: string
  readonly 缺口: readonly string[]
  /** 有数据时必为 `null`；无数据时必是 `09` §3.5 的枚举值（镜像校验）。 */
  readonly 空原因: 空原因值 | null
  readonly 出处: readonly 出处项[]
}

interface 游标载荷 {
  /** 上一行的时间；`null` 表示已经翻到「无时间」那一段。 */
  readonly t: number | null
  readonly m: string
  readonly s: string
  readonly r: number
}

function 编码游标(载荷: 游标载荷): string {
  return Buffer.from(JSON.stringify(载荷), "utf8").toString("base64url")
}

/**
 * `started_at` / `row_no` 都是 `integer`（4 字节）。游标里的整数字段必须落在 int32 内，
 * 否则伪造的越界值会漏过闸、让 PG 抛 22003（`DrizzleQueryError`），而不是 `明细入参错误`。
 * 用 `Number.isSafeInteger` 而不是 `Number.isInteger`：`1e21` 也是「整数」，但已不可精确表示。
 */
function 是int32(值: unknown): 值 is number {
  return typeof 值 === "number" && Number.isSafeInteger(值) && 值 >= -2147483648 && 值 <= 2147483647
}

function 解游标(文本: string): 游标载荷 {
  let 解: unknown
  try {
    解 = JSON.parse(Buffer.from(文本, "base64url").toString("utf8")) as unknown
  } catch {
    throw new 明细入参错误("游标不是本函数签发的形状（应原样回传上一页给出的续页游标）")
  }
  if (typeof 解 !== "object" || 解 === null || Array.isArray(解)) throw new 明细入参错误("游标不是本函数签发的形状")
  const o = 解 as Record<string, unknown>
  const t = o.t
  const t合法 = t === null || 是int32(t)
  if (!t合法 || typeof o.m !== "string" || typeof o.s !== "string" || !是int32(o.r))
    throw new 明细入参错误("游标字段不全、类型不对或数值超出 integer 范围")
  if (o.m.includes("\u0000") || o.s.includes("\u0000"))
    throw new 明细入参错误("游标字段不能包含 NUL 字符")
  return { t, m: o.m, s: o.s, r: o.r }
}

/**
 * 游标条件。排序是 `started_at asc nulls last`，所以：
 * - 上一行有时间 ⇒ 下一页 = 更晚的时间 **＋ 全部无时间的行**（`started_at is null` 那段还没开始）；
 * - 上一行无时间 ⇒ 只在无时间那段里按主键往后走。
 * 写成一个条件而不是 `coalesce(...)`，是为了让 `order by started_at` 还能吃到索引。
 */
function 游标条件(游标: 游标载荷): SQL {
  const 键后 = sql`(material_id, sheet, row_no) > (${游标.m}::text, ${游标.s}::text, ${游标.r}::integer)`
  if (游标.t === null) return sql`started_at is null and ${键后}`
  return sql`(started_at is null or started_at > ${游标.t} or (started_at = ${游标.t} and ${键后}))`
}

/**
 * 金额是 `numeric(18,2)` 字符串：转成「分」的 BigInt 再比，**不走 double**。
 * `Number("1000000000000000001") === Number("1000000000000000000")`，
 * 用浮点比较判不出方向 ⇒ 反向区间会静默退化成「无匹配行」（`时间起` 越界同款失败形态）。
 */
function 金额分(值: string): bigint {
  const 负 = 值.startsWith("-")
  const [整, 小 = ""] = (负 ? 值.slice(1) : 值).split(".")
  return BigInt(`${负 ? "-" : ""}${整}${小.padEnd(2, "0")}`)
}

/** 字符串入参的运行时闸：`null` / 数字 / 含 NUL 的串都当场拒，不让驱动抛 `TypeError` / `DrizzleQueryError`。 */
function 字符串入参(值: unknown, 名: string): string | undefined {
  if (值 === undefined) return undefined
  if (typeof 值 !== "string") throw new 明细入参错误(`${名} 必须是字符串，收到 ${typeof 值}`)
  if (值.includes("\u0000")) throw new 明细入参错误(`${名} 不能包含 NUL 字符`)
  return 值
}

function 金额串(值: string | undefined, 名: string): string | undefined {
  if (值 === undefined) return undefined
  // 只认 `<数字>[.<1~2 位>]`：`1,000` / `1e3` / 空串都当场拒，不让 PG 抛 22P02 变成 500。
  if (!/^-?\d+(\.\d{1,2})?$/.test(值)) throw new 明细入参错误(`${名} 必须是数字（可带 1~2 位小数），收到 ${值}`)
  return 值
}

function 整数值(值: number | undefined, 名: string): number | undefined {
  if (值 === undefined) return undefined
  // `started_at` 是 integer(4 字节)：越界值要么让 PG 抛 22003，要么按更宽类型静默比出错误结果。
  // 与游标共用 `是int32`，不再造第二个范围常量；int32 本身也远在 `Date` 可表示范围内。
  if (!是int32(值)) throw new 明细入参错误(`${名} 必须是整型秒（int32），收到 ${String(值)}`)
  return 值
}

function 秒转ISO(秒: number): string {
  return new Date(秒 * 1000).toISOString()
}

/** 口径文本：**固定顺序、无 locale 依赖**（`#011-01` 的反面：别让同一份数据在不同机器上写出两句话）。 */
function 口径文本(
  入参: 查明细行入参,
  账户: string | undefined,
  金额起: string | undefined,
  金额止: string | undefined,
  时间起: number | undefined,
  时间止: number | undefined,
): string {
  return [
    `项目=${入参.projectId}`,
    `材料=${入参.材料 ?? "全部"}`,
    `账户=${账户 ?? "不限"}（命中本方账号或对方账号之一）`,
    `方向=${入参.方向 ?? "不限"}`,
    `金额=${金额起 ?? "不限"}~${金额止 ?? "不限"}（闭区间，numeric 字符串）`,
    `时间=${时间起 === undefined ? "不限" : 秒转ISO(时间起)}~${时间止 === undefined ? "不限" : 秒转ISO(时间止)}（闭区间）`,
    "只取已入库明细行 auth.case_fact_row",
    "行级定位即主键 材料#工作表#行号",
    '备注取 extras["备注"]（预处理标准副本列名）',
    "排序：时间升序、无时间的排最后，同键按材料/工作表/行号",
  ].join("；")
}

/**
 * 项目内「尚未解析」的材料份数：同一 `path` 只认最新一行（重传后已解析不得再报），产物不计。
 *
 * 口径必须与 `材料视图` 一致：同一 path 内容变了会另建一行、旧行留着（幂等键是内容指纹），
 * 「界面上那份文件」只认最新一行。直接数所有历史行会把「重传后已解析」永久误报成未解析。
 *
 * 两个出口共用这一份 SQL（`#002-06`）：明细行查询的缺口，与 MCP 空原因判定的第 4 条证据。
 */
export async function 未解析材料份数(db: Queryable, projectId: string): Promise<number> {
  const 行 = rowsOf(
    await db.execute(sql`
      with latest as (
        select distinct on (path) id, path, kind, parse_status
          from auth.case_material
         where project_id = ${projectId}
         order by path, created_at desc, id desc
      )
      select count(*)::int as 份数
        from latest
       where parse_status <> '已解析' and kind <> '产物'
    `),
  )[0]
  return Number(行?.份数 ?? 0)
}

/**
 * 按条件翻明细行（`09` §4.4 的契约，`01` §7.11 的 P1 交付边界）。
 *
 * 空结果**必须分类**（`材料未入库` / `该材料未解析` / `无匹配行`）——「真的没有」与
 * 「还没解析」长得一样时会错得像个正确答案（`01` §3.8.5）。
 */
export async function 查明细行(db: Queryable, 入参: 查明细行入参): Promise<明细查询结果> {
  const 请求 = 入参.限制
  if (请求 !== undefined && (!Number.isInteger(请求) || 请求 <= 0))
    throw new 明细入参错误(`限制必须是正整数，收到 ${String(请求)}`)
  const 限制 = 请求 === undefined ? 默认限制 : Math.min(请求, 最大限制)

  const 材料 = 字符串入参(入参.材料, "材料")
  if (材料 !== undefined && 材料.trim() === "") throw new 明细入参错误("材料不能是空串")
  // 类型收窄不等于运行时校验：上层透传原始字符串时，坏值会静默过滤成 0 行、被读成「无匹配行」。
  if (入参.方向 !== undefined && 入参.方向 !== "收" && 入参.方向 !== "付")
    throw new 明细入参错误(`方向只能是「收」或「付」，收到 ${String(入参.方向)}`)
  const 账户入参 = 字符串入参(入参.账户, "账户")
  const 账户 = 账户入参 === undefined ? undefined : 归一化值("ownerAccount", 账户入参)
  if (账户 === "") throw new 明细入参错误("账户不能是空串")
  const 金额起 = 金额串(入参.金额起, "金额起")
  const 金额止 = 金额串(入参.金额止, "金额止")
  const 时间起 = 整数值(入参.时间起, "时间起")
  const 时间止 = 整数值(入参.时间止, "时间止")
  if (金额起 !== undefined && 金额止 !== undefined && 金额分(金额起) > 金额分(金额止))
    throw new 明细入参错误(`金额起（${金额起}）大于金额止（${金额止}）`)
  if (时间起 !== undefined && 时间止 !== undefined && 时间起 > 时间止)
    throw new 明细入参错误(`时间起（${时间起}）晚于时间止（${时间止}）`)
  const 游标 = 入参.游标 === undefined ? undefined : 解游标(入参.游标)

  const 口径 = 口径文本(入参, 账户, 金额起, 金额止, 时间起, 时间止)
  const 缺口: string[] = []
  if (请求 !== undefined && 请求 > 最大限制) 缺口.push(`请求的 ${请求} 行超过上限，已按 ${最大限制} 行取`)

  // 材料闸：指定了材料就先确认「它在不在本项目」「解没解析」——这两件事不能靠「查不到行」推。
  if (材料 !== undefined) {
    const 已存材料 = await getMaterial(db, 入参.projectId, 材料)
    if (已存材料 === undefined) {
      return {
        数据: { 行们: [], 下一页游标: null },
        口径,
        // 早退不能静默吞掉前置缺口（截断提示）：缺口契约是「截断/未解析全在这里」。
        缺口: [...缺口, `本项目没有这份材料：${材料}（按材料 id 查，不是文件名）`],
        空原因: "材料未入库",
        出处: [],
      }
    }
    if (已存材料.parseStatus !== "已解析") {
      return {
        数据: { 行们: [], 下一页游标: null },
        口径,
        缺口: [...缺口, `材料「${已存材料.path}」当前状态：${已存材料.parseStatus}`],
        空原因: "该材料未解析",
        出处: [],
      }
    }
  }

  const 条件: SQL[] = [sql`project_id = ${入参.projectId}`]
  if (材料 !== undefined) 条件.push(sql`material_id = ${材料}`)
  if (账户 !== undefined) 条件.push(sql`(owner_account = ${账户} or counterparty = ${账户})`)
  if (入参.方向 !== undefined) 条件.push(sql`direction = ${入参.方向}`)
  if (金额起 !== undefined) 条件.push(sql`amount >= ${金额起}::numeric`)
  if (金额止 !== undefined) 条件.push(sql`amount <= ${金额止}::numeric`)
  if (时间起 !== undefined) 条件.push(sql`started_at >= ${时间起}`)
  if (时间止 !== undefined) 条件.push(sql`started_at <= ${时间止}`)
  if (游标 !== undefined) 条件.push(游标条件(游标))

  // 多取一条：只有这样才能判「还有没有下一页」，不用 count(*) 扫一遍（`01` §7.3 只要求带 limit）。
  const 读回 = rowsOf(
    await db.execute(sql`
      select ${列}
        from auth.case_fact_row
       where ${sql.join(条件, sql` and `)}
       order by started_at asc nulls last, material_id asc, sheet asc, row_no asc
       limit ${限制 + 1}
    `),
  ).map(原始行)

  const 有更多 = 读回.length > 限制
  const 本页 = 读回.slice(0, 限制)
  const 末 = 本页[本页.length - 1]
  const 下一页游标 =
    有更多 && 末 !== undefined ? 编码游标({ t: 末.startedAt, m: 末.materialId, s: 末.sheet, r: 末.rowNo }) : null
  if (下一页游标 !== null) 缺口.push(`已取前 ${限制} 行，还有更多；可用续页游标继续取`)

  // 未解析材料：成功结果同样受影响（那些材料里的明细不在本次结果里），所以每查必报。
  const 份数 = await 未解析材料份数(db, 入参.projectId)
  if (份数 > 0) 缺口.push(`项目内还有 ${份数} 份材料未解析，其中的明细不在本次结果里`)

  if (本页.length === 0) {
    // 没有指定材料时，「零行」可能是「项目里根本没有已入库明细」。这句必须说，否则读成「确实没有」。
    if (材料 === undefined) {
      const 有行 = rowsOf(
        await db.execute(sql`select 1 as 有 from auth.case_fact_row where project_id = ${入参.projectId} limit 1`),
      )
      if (有行.length === 0) 缺口.push("本项目没有任何已入库明细：材料可能还没解析入库")
    }
    return { 数据: { 行们: [], 下一页游标: null }, 口径, 缺口, 空原因: "无匹配行", 出处: [] }
  }

  const 首 = 本页[0]!
  return {
    数据: { 行们: 本页.map(行视图), 下一页游标 },
    口径,
    缺口,
    空原因: null,
    出处: [{ 事实: `本页 ${本页.length} 行明细`, 代表: `${首.materialId}#${首.sheet}#${首.rowNo}`, 可下钻: "get_citation" }],
  }
}
