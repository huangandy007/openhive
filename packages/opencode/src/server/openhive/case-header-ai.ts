export * as OpenhiveCaseHeaderAi from "./case-header-ai"

import { Schema } from "effect"
import type { LanguageModel } from "ai"
import { 建调用模型 } from "./case-extract-ai"
import { 字段目录, 是识别字段, 形状命中率, type 识别字段 } from "./case-field-registry"
import type { MappingResult } from "./case-mapping"

/**
 * 表头模型识别（四层召回之后的兜底层）。
 *
 * 复用 `case-extract-ai` 的 `建调用模型` seam：超时、错误详情、json_object 的「json 字样」
 * 都在那一层维护（`#002-06`），这里不再写第二份 `generateObject`。
 */

export interface 表头识别输入 {
  工作表: { 名: string; 表头: (string | null)[]; 样例: (string | null)[][] }[]
  候选字段: string[]
}
export interface 表头识别结果 {
  工作表: Record<string, { 列: Record<number, string> }>
}
export type 表头识别器 = (输入: 表头识别输入) => Promise<表头识别结果>

const 表头输出 = Schema.Struct({
  工作表: Schema.Record(
    Schema.String,
    Schema.Struct({ 列: Schema.Record(Schema.String, Schema.String) }),
  ),
})

/** DeepSeek 见到请求里没有「json」字样会 400（同 case-extract-ai 的注释）。 */
const 表头要求 = `
只输出一个 JSON 对象：{"工作表":{"<sheet 名>":{"列":{"<列号>":"<字段名或 unknown>"}}}}。
字段名只能从用户给出的候选字段里选；认不出的列写 "unknown"，不许编造字段名。`

const 账号脱敏 = (v: string) => {
  const s = v.replace(/[\s-]/g, "")
  return /^\d{8,}$/.test(s) ? `${s.slice(0, 4)}****${s.slice(-4)}` : v
}
const 姓名脱敏 = (v: string) => (/^[一-龥]{2,4}$/.test(v.trim()) ? `${v.trim().slice(0, 1)}**` : v)
const 金额脱敏 = (v: string) => (/^-?\d+\.\d{2}$/.test(v.trim()) ? `*${v.trim().length}位` : v)

function 脱敏样例(样例: (string | null)[][]): (string | null)[][] {
  return 样例.map((行) => 行.map((v) => (v === null ? null : 金额脱敏(姓名脱敏(账号脱敏(v))))))
}

export function 建表头识别器(模型: LanguageModel, 选项: { 脱敏: boolean }): 表头识别器 {
  const 调用 = 建调用模型<{ 工作表: Record<string, { 列: Record<string, string> }> }>(模型, {
    结构: 表头输出,
    系统后缀: 表头要求,
  })
  return async (输入) => {
    const 样例们 = 选项.脱敏
      ? 输入.工作表.map((s) => ({ ...s, 样例: 脱敏样例(s.样例) }))
      : 输入.工作表
    const 用户 = JSON.stringify({
      候选字段: 输入.候选字段,
      工作表: 样例们.map((s) => ({ 名: s.名, 表头: s.表头, 样例: s.样例 })),
    })
    const 结果 = await 调用({
      系统: "你是表格表头识别器。表头可能换名、带修饰语或单位后缀；按列的数据形状判断它是什么字段。",
      用户,
    })
    const 标准化: 表头识别结果 = { 工作表: {} }
    for (const [名, 值] of Object.entries(结果.工作表 ?? {})) {
      const 列: Record<number, string> = {}
      for (const [k, v] of Object.entries(值.列 ?? {})) 列[Number(k)] = v
      标准化.工作表[名] = { 列 }
    }
    return 标准化
  }
}

/**
 * 触发判定：四层召回漏掉了**有形状证据**的列时，才值得花一次模型调用。
 *
 * 两条口径（设计阈值，不许改）：
 * - 关键字段缺失：`startedAt` / `amount` 一个都没认出来，但整表里确实有一列形状像它；
 * - 有形状未认领的列占比 > 30%。`总列` 排除「名称为空」与备注/摘要/网点/说明/用途/序号
 *   这类无信息列 —— 它们进模型也认不出字段，只会把分母撑大、把触发压下去。
 */
export function 需要模型(
  每表: readonly MappingResult[],
  表头们: readonly (string | null)[][],
  行们: readonly (string | null)[][][],
): boolean {
  let 有形状未认领 = 0
  let 总列 = 0
  for (let s = 0; s < 每表.length; s++) {
    const 结果 = 每表[s]
    const 表头 = 表头们[s] ?? []
    const 行 = 行们[s] ?? []
    const 字段们 = Object.values(结果.columns)
    if (!字段们.includes("startedAt") && 有形状列("startedAt", 表头, 行)) return true
    if (!字段们.includes("amount") && 有形状列("amount", 表头, 行)) return true
    if (结果.待确认.some((项) => 项.原因 === "多列争抢" || 项.原因 === "候选不唯一" || 项.原因 === "形状不符"))
      return true
    for (let i = 0; i < 表头.length; i++) {
      const 名 = (表头[i] ?? "").trim()
      if (名 === "" || /备注|摘要|网点|说明|用途|序号/.test(名)) continue
      总列++
      if (结果.columns[i] !== undefined) continue
      // 只有真有形状定义的字段才可能提供证据（无形状字段的 `形状命中率` 恒为 0）。
      const 像某种形状 = ["amount", "startedAt", "callee", "counterparty", "ownerAccount"].some(
        (f) => 是识别字段(f) && 形状命中率(f, 行.map((r) => r[i] ?? null)) >= 0.9,
      )
      if (像某种形状) 有形状未认领++
    }
  }
  return 总列 > 0 && 有形状未认领 / 总列 > 0.3
}

function 有形状列(field: 识别字段, 表头: (string | null)[], 行: (string | null)[][]): boolean {
  return 表头.some((_, i) => 形状命中率(field, 行.map((r) => r[i] ?? null)) >= 0.9)
}

/**
 * 合并模型建议：只填**未认领**的列，规则/别名已认领的不许覆盖。
 * 待确认项原样沿用——模型不替人做决定，也不清掉给人看的证据。
 */
export function 合并模型结果(
  表头: (string | null)[],
  行: (string | null)[][],
  基础: MappingResult,
  建议: Record<number, string>,
): MappingResult {
  const columns = { ...基础.columns }
  const 来源 = { ...基础.来源 }
  for (const [键, 字段名] of Object.entries(建议)) {
    const i = Number(键)
    if (!Number.isInteger(i) || i < 0 || i >= 表头.length) continue
    if (columns[i] !== undefined) continue // 规则/别名已认领，模型不许覆盖
    if (!是识别字段(字段名)) continue
    // extras 字段没有可验证的形状证据：靠模型自由发挥会污染 extras（本期模型只认标准列）。
    if (字段目录[字段名].落点 !== "列") continue
    if (!形状命中(字段名, 行.map((r) => r[i] ?? null))) continue
    columns[i] = 字段名
    来源[i] = "模型"
  }
  return { ...基础, columns, 来源 }
}

function 形状命中(field: 识别字段, 值们: (string | null)[]): boolean {
  return 字段目录[field].形状 === undefined || 形状命中率(field, 值们) >= 0.9
}
