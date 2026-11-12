export * as OpenhiveCaseRowQuery from "./case-row-query"

import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { 归一化值 } from "./case-field-registry"
import type { Queryable } from "./case-store"
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
  readonly 本方账号: string | null
  readonly 对方账号: string | null
  readonly 对方户名: string | null
  /** `extras["备注"]`：预处理标准副本的固定列名（`01` §3.11.1）；没有就是 null。 */
  readonly 备注: string | null
}

const 列 = sql`project_id, material_id, sheet, row_no, caller, callee, started_at, started_raw,
       precision, time_type, duration_sec, amount::text as amount, balance::text as balance,
       counterparty, counterparty_name, owner_account, direction, extras`

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
    本方账号: 行.ownerAccount,
    对方账号: 行.counterparty,
    对方户名: 行.counterpartyName,
    备注: 备注原文(行.extras),
  }
}
