export * as OpenhiveCaseRows from "./case-rows"

import type { RawSheet } from "./case-sheet"
import { parseTime } from "./case-time"
import { FACT_FIELDS, type FactField } from "./case-mapping"
import type { FactRowInput } from "./case-store"

/**
 * 把「映射 ＋ 原始网格」拼成待写入的明细行。
 *
 * ## extras 的键
 *
 * **原表头文本**，不是列序号——民警在界面上看到的是表头，不是下标。
 * 表头为空或与前面重名时用 `第N列`（N 从 1 起，按本行第几列算）。
 *
 * ## 认不出就留 null
 *
 * 金额/时长/时间解析不出来时写 null，**不猜**；原始文本仍在 `started_raw` 或 `extras` 里。
 * 设计 §4.2 的「原始值从未被改写」靠这条守住（判据 A16）。
 */
export interface ToRowsInput {
  projectId: string
  materialId: string
  sheet: RawSheet
  mapping: Record<number, FactField>
}

/** `numeric(18,2)` 的整数位上限：18 位总精度减 2 位小数。 */
const MAX_AMOUNT_INTEGER_DIGITS = 16
/** `integer`（int4）上限。 */
const MAX_DURATION_SEC = 2147483647

export function parseAmount(raw: string | null): string | null {
  if (raw === null) return null
  // 只去货币符号与空白；千分位逗号**保留**，交给分组校验（I5）——
  // 先剥逗号再验的话 `1234,56` 会被无声放大成 123456。
  const 干净 = raw.replace(/[\s　￥¥$]/g, "").replace(/，/g, ",")
  if (干净.includes(",")) {
    if (!/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(干净)) return null
  } else if (!/^-?\d+(\.\d{1,2})?$/.test(干净)) {
    return null
  }
  const [整数 = "", 小数 = ""] = 干净.replace(/,/g, "").split(".")
  // 超出 numeric(18,2) 会让整块多值 INSERT 一起失败，宁可这里判 null 走 R23（I6）。
  if (整数.replace(/^-/, "").length > MAX_AMOUNT_INTEGER_DIGITS) return null
  return `${整数}.${(小数 + "00").slice(0, 2)}`
}

export function parseDuration(raw: string | null): number | null {
  if (raw === null) return null
  const 干净 = raw.replace(/[秒\s]/g, "")
  let 秒: number | null = null
  if (/^\d+$/.test(干净)) {
    秒 = Number(干净)
  } else {
    const 两段 = /^(\d+):([0-5]\d)$/.exec(干净)
    const 三段 = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(干净)
    if (两段) 秒 = Number(两段[1]) * 60 + Number(两段[2])
    else if (三段) 秒 = Number(三段[1]) * 3600 + Number(三段[2]) * 60 + Number(三段[3])
  }
  // 超出 int4 会让整块多值 INSERT 一起失败，宁可这里判 null 走 R23（I6）。
  if (秒 === null || 秒 > MAX_DURATION_SEC) return null
  return 秒
}

/** `mapping` 里可能混进数据库带出来的脏值，按「不是事实字段」处理，不静默吞掉（I4）。 */
function 是事实字段(value: unknown): value is FactField {
  return typeof value === "string" && (FACT_FIELDS as readonly string[]).includes(value)
}

/** 按**这一列自己的原文**判解析成败（I3：同一个字段被多列映射时不能拿别列的结果代替）。 */
function 解析失败(field: FactField, text: string): boolean {
  if (field === "durationSec") return parseDuration(text) === null
  if (field === "amount" || field === "balance") return parseAmount(text) === null
  // caller / callee / counterparty 是原样字符串，不存在「解析失败」；
  // startedAt 的原文在 started_raw，不走 extras。
  return false
}

function 表头键(header: RawSheet["header"]): string[] {
  const 已用 = new Set<string>()
  return header.map((cell, i) => {
    const 原 = (cell.text ?? "").trim()
    let 键 = 原 !== "" && !已用.has(原) ? 原 : ""
    if (键 === "") {
      // 兜底键也可能撞上真表头（第 1 列就叫「第3列」），从 第i+1列 起循环找空位（I2）。
      let n = i + 1
      while (已用.has(`第${n}列`)) n++
      键 = `第${n}列`
    }
    已用.add(键)
    return 键
  })
}

export function toFactRows(input: ToRowsInput): FactRowInput[] {
  const 键 = 表头键(input.sheet.header)

  const out: FactRowInput[] = []
  for (const row of input.sheet.rows) {
    if (row.cells.every((c) => c.text === null)) continue

    const 值 = (field: FactField): string | null => {
      const 下标 = Object.keys(input.mapping).find((k) => input.mapping[Number(k)] === field)
      if (下标 === undefined) return null
      return row.cells[Number(下标)]?.text ?? null
    }

    const 时间原文 = 值("startedAt")
    const 时间 = 时间原文 === null ? undefined : parseTime(时间原文)
    const 时长 = parseDuration(值("durationSec"))
    const 金额 = parseAmount(值("amount"))
    const 余额 = parseAmount(值("balance"))

    const extras: Record<string, string> = {}
    row.cells.forEach((cell, i) => {
      if (cell.text === null) return
      const field: unknown = input.mapping[i]
      // 已映射的列**按本列原文**解析成功才不进 extras；解析失败（或映射值是数据库带出来的
      // 脏值）一律留底 —— 否则它既不在标准列、也不在 extras 里，原件上写的什么就再也看不到
      // 了（Global Constraints：「认不出就留 null，原值仍在 extras 或 started_raw 里」）。
      // 时间不在此列：它的原文在 started_raw。
      if (是事实字段(field) && !解析失败(field, cell.text)) return
      extras[键[i] ?? `第${i + 1}列`] = cell.text
    })

    out.push({
      projectId: input.projectId,
      materialId: input.materialId,
      sheet: input.sheet.name,
      rowNo: row.rowNo,
      caller: 值("caller"),
      callee: 值("callee"),
      startedAt: 时间?.seconds ?? null,
      startedRaw: 时间原文,
      precision: 时间?.precision ?? null,
      // 表格里的时间一律是「事情什么时候发生」：话单的通话时间、流水的交易时间。
      timeType: 时间 ? "发生" : null,
      durationSec: 时长,
      amount: 金额,
      balance: 余额,
      counterparty: 值("counterparty"),
      extras,
    })
  }
  return out
}
