export * as OpenhiveCaseRows from "./case-rows"

import type { RawCell, RawSheet } from "./case-sheet"
import { parseTime } from "./case-time"
import { 是标准列, 是识别字段, 归一化值, type 识别字段 } from "./case-field-registry"
import type { FactRowInput } from "./case-store"

/**
 * 把「映射 ＋ 原始网格」拼成待写入的明细行。
 *
 * ## extras 的键
 *
 * - **extras 落点字段**（`address` / `ownerName`…）：用**字段名**作键，不用原表头——
 *   字段身份与表头写法解耦，换一家银行的「收货地址」仍是同一个键。
 * - **标准列**：只有「被选中且本列解析失败」才留底，键仍是**原表头文本**——民警在界面上
 *   看到的是表头，不是下标。表头为空或与前面重名时用 `第N列`（N 从 1 起）。
 *
 * ## 认不出就留 null
 *
 * 金额/时长/时间/方向解析不出来时写 null，**不猜**；原始文本仍在 `started_raw` 或 `extras` 里。
 * 设计 §4.2 的「原始值从未被改写」靠这条守住（判据 A16）。
 */
export interface ToRowsInput {
  projectId: string
  materialId: string
  sheet: RawSheet
  mapping: Record<number, 识别字段>
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

/**
 * field → 被 `值()` 选中的列（最小下标）。**只有标准列**参与：extras 字段不走标准列。
 *
 * R25a：只有**被选中且解析成功**的列才有资格不进 extras；同一个字段被多列映射时，
 * 其余列没被当标准列用，原文只有 extras 一条活路（否则「最小下标失败、后一列成功」
 * 会把后一列静默丢掉）。
 *
 * `mapping` 里可能混进数据库带出来的脏值（不是任何识别字段），按「未映射」处理，
 * 不静默吞掉（I4）。迁移 `0032_case_table_format.sql:39` 的 COMMENT 仍写着 extras
 * 「值静默丢弃」，与当前实现**相反**（解析失败的原值会补进 extras，R23）；该迁移已冻结。
 */
function 选中列(mapping: Record<number, 识别字段>): Map<识别字段, number> {
  const out = new Map<识别字段, number>()
  for (const [key, field] of Object.entries(mapping)) {
    if (!是识别字段(field) || !是标准列(field)) continue
    const i = Number(key)
    if (!Number.isInteger(i)) continue
    const 已有 = out.get(field)
    if (已有 === undefined || i < 已有) out.set(field, i)
  }
  return out
}

/** 方向原值归一化；认不出（含 null）⇒ null。 */
export function 归一化方向(原值: string | null): "收" | "付" | null {
  const v = (原值 ?? "").trim()
  if (["收", "进", "入", "贷", "转入", "收入"].includes(v)) return "收"
  if (["付", "出", "借", "转出", "支出"].includes(v)) return "付"
  return null
}

/** 按**这一列自己的原文**判解析成败（I3：同一个字段被多列映射时不能拿别列的结果代替）。 */
function 解析失败(field: 识别字段, text: string): boolean {
  if (field === "durationSec") return parseDuration(text) === null
  if (field === "amount" || field === "balance") return parseAmount(text) === null
  if (field === "direction") return 归一化方向(text) === null
  // caller / callee / counterparty* / ownerAccount 是原样字符串；
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
  const 键们 = 表头键(input.sheet.header)
  const 选中 = 选中列(input.mapping)

  const out: FactRowInput[] = []
  for (const row of input.sheet.rows) {
    if (row.cells.every((c) => c.text === null)) continue

    const 单元格 = (field: 识别字段): RawCell | undefined => {
      const 下标 = Object.keys(input.mapping).find((k) => input.mapping[Number(k)] === field)
      if (下标 === undefined) return undefined
      return row.cells[Number(下标)]
    }
    const 值 = (field: 识别字段): string | null => 单元格(field)?.text ?? null

    const 时间原文 = 值("startedAt")
    // 日期单元格的 `text` 是 Excel 显示原文（"1/2/26"），解析用 `dateText` 的 ISO；
    // `started_raw` 仍写 `text`（A16：原始值从不改写）。
    const 时间解析文本 = 单元格("startedAt")?.dateText ?? 时间原文
    const 时间 = 时间解析文本 === null ? undefined : parseTime(时间解析文本)
    const 时长 = parseDuration(值("durationSec"))
    const 金额 = parseAmount(值("amount"))
    const 余额 = parseAmount(值("balance"))
    const 方向原值 = 值("direction")
    // 有方向列就只认归一化结果：本行单元格为空/认不出也记 null，**不**拿金额符号去补
    // （设计 §6.3「其他 / 空 → null（进待确认）」）。只有整表**没有方向列**时，负数金额
    // 才推「付」，正数不猜。判据必须是「列是否被选中」，不能用「本行值是否为空」——
    // 后者把「没有列」和「有列但这一格空着」混成一类。
    const 方向 =
      归一化方向(方向原值) ?? (!选中.has("direction") && 金额 !== null && 金额.startsWith("-") ? "付" : null)
    const 主叫原值 = 值("caller")
    const 被叫原值 = 值("callee")
    const 对手账号 = 值("counterparty")
    const 对手户名 = 值("counterpartyName")
    const 本方账号原值 = 值("ownerAccount")

    const extras: Record<string, string> = {}
    row.cells.forEach((cell, i) => {
      if (cell.text === null) return
      const field: unknown = input.mapping[i]
      // 标准列：只有**被选中且本列解析成功**才不进 extras（R25a）。未选中的列没被当标准列用，
      // 解析失败或映射值是数据库带出来的脏值，同样留底 —— 否则它既不在标准列、也不在 extras
      // 里，原件上写的什么就再也看不到了（Global Constraints：「认不出就留 null，原值仍在
      // extras 或 started_raw 里」）。时间不在此列：它的原文在 started_raw。
      // extras 落点字段：一律留底，键用**字段名**（`address` / `ownerName`…），不用原表头。
      if (是识别字段(field) && 是标准列(field) && 选中.get(field) === i && !解析失败(field, cell.text)) return
      const 键 = 是识别字段(field) && !是标准列(field) ? field : (键们[i] ?? `第${i + 1}列`)
      extras[键] = cell.text
    })

    out.push({
      projectId: input.projectId,
      materialId: input.materialId,
      sheet: input.sheet.name,
      rowNo: row.rowNo,
      // 号码写标准列时归一化（去空白/国码）；原文仍留在 extras（若该列另有映射）。
      caller: 主叫原值 === null ? null : 归一化值("caller", 主叫原值),
      callee: 被叫原值 === null ? null : 归一化值("callee", 被叫原值),
      startedAt: 时间?.seconds ?? null,
      startedRaw: 时间原文,
      precision: 时间?.precision ?? null,
      // 表格里的时间一律是「事情什么时候发生」：话单的通话时间、流水的交易时间。
      timeType: 时间 ? "发生" : null,
      durationSec: 时长,
      amount: 金额,
      balance: 余额,
      // 有账号列时写归一化后的账号；只有户名列时用户名兜底（同时写 counterpartyName，
      // 兜住按名匹配）。户名兜底保持原文，不做账号归一化。
      counterparty: 对手账号 === null ? 对手户名 : 归一化值("counterparty", 对手账号),
      counterpartyName: 对手户名 ?? null,
      ownerAccount: 本方账号原值 === null ? null : 归一化值("ownerAccount", 本方账号原值),
      direction: 方向,
      extras,
    })
  }
  return out
}
