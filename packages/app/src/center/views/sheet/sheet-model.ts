export type Cell = string | null
export type ColumnType = "text" | "number" | "date" | "datetime"
export type 档位 = "full" | "preview"

/**
 * 规模阈值单一来源。数字改动只在这里改，测试与 UI 都读它。
 * 预览行数 = 数据行（不含首行表头）；首屏行数同理。
 */
export const 规模 = {
  首屏行数: 200,
  预览行数: 1000,
  预览列数: 64,
  全量行上限: 100_000,
  全量格上限: 4_000_000,
  全量列上限: 256,
  分块行数: 5000,
  缓存格上限: 200_000,
  缓存份数: 3,
  UI状态缓存份数: 20,
  行高: 28,
  行号列宽: 56,
  列最小宽: 48,
  列最大宽: 800,
  列初始最小宽: 64,
  列初始最大宽: 320,
  拖拽热区: 5,
} as const

/** 兼容旧调用点：行/列上界仍表示预览档的物化上限。 */
export const 行上界 = 规模.预览行数
export const 列上界 = 规模.预览列数

export interface 解析限制 {
  首屏行数: number
  预览行数: number
  预览列数: number
  全量行上限: number
  全量格上限: number
  全量列上限: number
  分块行数: number
}

export const 默认解析限制: 解析限制 = 规模

/**
 * 解析端交回的元信息。
 * - `preview` 是**原始行**（含首行），不是数据行；行号 = `startRow + 原始行下标 + 1`。
 * - `header` 与 `columnTypes` 的长度 = 实际显示列数（可能被 256/64 截断）。
 */
export interface SheetMeta {
  sheetNames: string[]
  sheetName: string
  startRow: number
  startCol: number
  totalRows: number
  totalCols: number
  header: string[]
  preview: Cell[][]
  columnTypes: ColumnType[]
}

export interface 日期分量 {
  y: number
  m: number
  d: number
  H: number
  M: number
  S: number
}

/** Excel 列号：0→A，25→Z，26→AA。 */
export function 列标(index: number): string {
  let n = index + 1
  let result = ""
  while (n > 0) {
    const rem = (n - 1) % 26
    result = String.fromCharCode(65 + rem) + result
    n = Math.floor((n - 1) / 26)
  }
  return result || "A"
}

/** 全角/宽字符（CJK、全角标点）按 13px，其余 7px。 */
const 全角 = /[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/

export function 文本宽(text: string): number {
  let width = 0
  for (const ch of text.slice(0, 80)) width += 全角.test(ch) ? 13 : 7
  return width
}

/** 初始列宽：内容/表头较宽者 + 16px 内边距，钳制 [64, 320]。 */
export function 估算列宽(header: string, samples: readonly Cell[]): number {
  let 内容 = 文本宽(header)
  for (const cell of samples) 内容 = Math.max(内容, 文本宽(cell ?? ""))
  return Math.max(规模.列初始最小宽, Math.min(规模.列初始最大宽, 内容 + 16))
}

/** 拖拽后的列宽：取整并钳制 [48, 800]。 */
export function 拖拽后列宽(起始: number, 位移: number): number {
  return Math.max(规模.列最小宽, Math.min(规模.列最大宽, Math.round(起始 + 位移)))
}

const 补 = (n: number) => String(n).padStart(2, "0")

/** 规范日期串：`yyyy-MM-dd` 或 `yyyy-MM-dd HH:mm:ss`。 */
export function 格式化日期(parts: 日期分量, 含时间: boolean): string {
  const 日期 = `${String(parts.y).padStart(4, "0")}-${补(parts.m)}-${补(parts.d)}`
  return 含时间 ? `${日期} ${补(parts.H)}:${补(parts.M)}:${补(parts.S)}` : 日期
}

/** JS Date → 规范串。只用于防御性分支：SheetJS 的 Date 口径是 UTC。 */
export function 从UTC日期(date: Date): { text: string; 含时间: boolean } {
  const parts = {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    H: date.getUTCHours(),
    M: date.getUTCMinutes(),
    S: date.getUTCSeconds(),
  }
  const 含时间 = parts.H !== 0 || parts.M !== 0 || parts.S !== 0
  return { text: 格式化日期(parts, 含时间), 含时间 }
}

const 日期文本 = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

/**
 * 文本日期 → 规范串。**不**用 `new Date` 解析 `"YYYY-MM-DD"` 这类字符串：那会把日期按 UTC 解释，
 * 东八区读出会偏一天。这里只拆分量、只校验范围，不做任何时区换算。
 */
export function 从文本日期(value: string): { text: string; 含时间: boolean } | undefined {
  const match = 日期文本.exec(value.trim())
  if (!match) return undefined
  const parts: 日期分量 = {
    y: Number(match[1]),
    m: Number(match[2]),
    d: Number(match[3]),
    H: Number(match[4] ?? 0),
    M: Number(match[5] ?? 0),
    S: Number(match[6] ?? 0),
  }
  if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) return undefined
  if (parts.H > 23 || parts.M > 59 || parts.S > 59) return undefined
  const 含时间 = match[4] !== undefined
  return { text: 格式化日期(parts, 含时间), 含时间 }
}

const 数字形 = /^-?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?%?$/

/**
 * 列类型推断（只看样本，全列一致才下结论）。
 * 日期排在数字后判：规范串里带 `-`/`/`，不会被数字形误吃。
 */
export function 推断列类型(cells: readonly Cell[]): ColumnType {
  let 有值 = 0
  let 数字 = 0
  let 日期 = 0
  let 时间 = 0
  for (const cell of cells) {
    if (cell === null || cell.trim() === "") continue
    有值++
    if (数字形.test(cell.trim())) {
      数字++
      continue
    }
    const 日期值 = 从文本日期(cell)
    if (日期值) {
      日期++
      if (日期值.含时间) 时间++
    }
  }
  if (有值 === 0) return "text"
  if (日期 === 有值) return 时间 > 0 ? "datetime" : "date"
  if (数字 === 有值) return "number"
  return "text"
}

/**
 * SheetJS 交回的这个失败，是不是在说「这份工作簿锁着」。
 * 按消息认，理由见旧 `sheet-view.tsx` 的注释（四种说法，含 Numbers 的
 * `Unsupported password protection`）。非 Error 一律不算。
 */
export function 是加密工作簿(原因: unknown): boolean {
  return 原因 instanceof Error && /password/i.test(原因.message)
}
