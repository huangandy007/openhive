import * as XLSX from "xlsx"
import {
  从UTC日期,
  从文本日期,
  判档,
  列标,
  格式化日期,
  推断列类型,
  是加密工作簿,
  规模,
  type Cell,
  type ColumnType,
  type SheetMeta,
  type 工作表项,
  type 解析限制,
} from "./sheet-model"

export interface 截断信息 {
  rows: number
  cols: number
}

export interface 解析回调 {
  onMeta(meta: SheetMeta): void
  onChunk(start: number, rows: Cell[][]): void
  onDone(mode: "full" | "preview", truncated: 截断信息): void
  onError(kind: "password" | "parse", message: string): void
}

const 让出 = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const 是Zip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b
const 是OLE2 = (bytes: Uint8Array) =>
  bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0

/** 文本分支：CSV/TSV 没有 zip/OLE2 头。 */
const 是文本 = (bytes: Uint8Array) => !是Zip(bytes) && !是OLE2(bytes)

/**
 * 全文一次扫描：行数（引号内换行不算）+ 最大列数（每行逗号/制表符计数取大者）。
 * CSV 引号规则：只有**字段起始处**（行首或紧跟分隔符）的 `"` 才是开引号；
 * 字段中间的 `"`（如 `27"`）按普通字符处理，不会吞掉后续行。
 */
function 扫描文本(text: string): { 行数: number; 列数: number } {
  if (!text) return { 行数: 0, 列数: 1 }
  let 行数 = 1
  let 列数 = 1
  let commas = 0
  let tabs = 0
  let quoted = false
  let 字段起始 = true

  const 结束行 = () => {
    列数 = Math.max(列数, Math.max(commas, tabs) + 1)
    commas = 0
    tabs = 0
    字段起始 = true
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++ // "" 转义
        else {
          quoted = false
          字段起始 = false
        }
      }
      continue
    }
    if (ch === '"' && 字段起始) {
      quoted = true
      continue
    }
    if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) {
      结束行()
      行数++
    } else if (ch === "\r") {
      // \r\n：跳过 \n，按一次换行结束
      i++
      结束行()
      行数++
    } else if (ch === ",") {
      commas++
      字段起始 = true
    } else if (ch === "\t") {
      tabs++
      字段起始 = true
    } else {
      字段起始 = false
    }
  }

  if (!quoted && (text.endsWith("\n") || text.endsWith("\r"))) {
    行数--
  } else {
    结束行()
  }
  return { 行数: Math.max(0, 行数), 列数 }
}

/**
 * 单元格 → 显示文本。
 * 与旧实现一样保留 `raw:false` 的语义：数字/百分比/千分位用 `w`，长 ID 保留科学计数法。
 * 日期优先用序列号 + `SSF.parse_date_code`（墙上时间），CSV 的日期文本用 `从文本日期` 兜底；
 * 两者都零时区平移。
 */
function 单元格文本(cell: XLSX.CellObject | undefined): Cell {
  if (!cell) return null
  if (cell.t === "n" && typeof cell.v === "number") {
    if (cell.z && XLSX.SSF.is_date(cell.z)) {
      const parts = XLSX.SSF.parse_date_code(cell.v)
      if (parts) return 格式化日期(parts, parts.H !== 0 || parts.M !== 0 || parts.S !== 0)
    }
    if (cell.w) {
      const text = 从文本日期(cell.w)
      if (text) return text.text
      return cell.w
    }
    return String(cell.v)
  }
  if (cell.t === "d" && cell.v instanceof Date) return 从UTC日期(cell.v).text
  if (typeof cell.v === "string") {
    const text = 从文本日期(cell.v)
    return text ? text.text : cell.v
  }
  if (cell.w !== undefined) return cell.w
  if (cell.v === undefined || cell.v === null) return null
  return String(cell.v)
}

function 取行(
  sheet: XLSX.WorkSheet,
  startRow: number,
  startCol: number,
  colCount: number,
  rowCount: number,
): Cell[][] {
  const rows: Cell[][] = []
  for (let r = startRow; r < startRow + rowCount; r++) {
    const row: Cell[] = []
    for (let c = startCol; c < startCol + colCount; c++) {
      const cell: XLSX.CellObject | undefined = sheet[XLSX.utils.encode_cell({ r, c })]
      row.push(单元格文本(cell))
    }
    rows.push(row)
  }
  return rows
}

function 取表头(row: Cell[] | undefined, startCol: number, colCount: number): string[] {
  return Array.from({ length: colCount }, (_, i) => {
    const text = row?.[i]?.trim()
    return text ? text : 列标(startCol + i)
  })
}

function 推断列类型组(rows: readonly Cell[][], cols: number): ColumnType[] {
  return Array.from({ length: cols }, (_, col) => 推断列类型(rows.slice(0, 200).map((row) => row[col] ?? null)))
}

function 发送(
  callbacks: 解析回调,
  sheets: readonly 工作表项[],
  sheetName: string,
  range: XLSX.Range,
  totalRows: number,
  totalCols: number,
  displayedCols: number,
  preview: Cell[][],
  limits: 解析限制,
) {
  const 首屏 = preview.slice(0, limits.首屏行数 + 1)
  callbacks.onMeta({
    sheets,
    sheetName,
    startRow: range.s.r,
    startCol: range.s.c,
    totalRows,
    totalCols,
    header: 取表头(首屏[0], range.s.c, displayedCols),
    preview: 首屏,
    columnTypes: 推断列类型组(preview.slice(1, 201), displayedCols),
  })
  return 首屏.length
}

/**
 * 工作簿清单：名字按 `SheetNames` 顺序，隐藏标记按同下标的 `Workbook.Sheets[i].Hidden`
 * （0 可见 / 1 隐藏 / 2 深度隐藏；后两者都算隐藏，用户都点得到）。
 */
function 工作表清单(book: XLSX.WorkBook): 工作表项[] {
  return book.SheetNames.map((name, index) => ({
    name,
    hidden: (book.Workbook?.Sheets?.[index]?.Hidden ?? 0) !== 0,
  }))
}

/**
 * 表名 → 实际要读的那张。未指定取第一张（旧行为）；指定了不存在 ⇒ 抛错。
 * 不静默退回第一张：那会把「表被改名/删了」显示成「另一张表的内容」，用户看不出自己看错了表。
 */
function 选表(sheets: readonly 工作表项[], 目标表: string | undefined): string {
  if (sheets.length === 0) throw new Error("工作簿里没有工作表")
  if (目标表 === undefined) return sheets[0].name
  if (sheets.some((表) => 表.name === 目标表)) return 目标表
  throw new Error(`工作表不存在：${目标表}`)
}

async function 解析二进制(
  bytes: Uint8Array<ArrayBuffer>,
  callbacks: 解析回调,
  limits: 解析限制,
  目标表?: string,
): Promise<void> {
  const first = XLSX.read(bytes, {
    type: "array",
    codepage: 65001,
    cellNF: true,
    sheetRows: limits.首屏行数 + 1,
  })
  const sheets = 工作表清单(first)
  const sheetName = 选表(sheets, 目标表)
  const firstSheet = first.Sheets[sheetName]
  // 探针（2026-10-18）：xlsx 与 xls(biff8) 在 sheetRows 下都保留 !fullref。
  const 全范围 = XLSX.utils.decode_range(String(firstSheet["!fullref"] ?? firstSheet["!ref"] ?? "A1"))
  const totalRows = 全范围.e.r - 全范围.s.r + 1
  const totalCols = 全范围.e.c - 全范围.s.c + 1
  const mode = 判档(totalRows, totalCols, limits)
  const displayedCols = Math.min(totalCols, mode === "preview" ? limits.预览列数 : limits.全量列上限)

  const 首屏已全 = totalRows <= limits.首屏行数 + 1
  // 首屏先发：meta 必须在后续（可能的全量）读取之前送出，网格才能先挂载。
  const 已发首屏 = 发送(
    callbacks,
    sheets,
    sheetName,
    全范围,
    totalRows,
    totalCols,
    displayedCols,
    取行(firstSheet, 全范围.s.r, 全范围.s.c, displayedCols, Math.min(totalRows, limits.首屏行数 + 1)),
    limits,
  )

  if (mode === "preview") {
    let 已物化 = 已发首屏
    if (!首屏已全) {
      // 预览档只多读 1001 行，不读全量。
      const 预览本 = XLSX.read(bytes, {
        type: "array",
        codepage: 65001,
        cellNF: true,
        sheetRows: limits.预览行数 + 1,
      })
      const preview = 取行(
        预览本.Sheets[sheetName],
        全范围.s.r,
        全范围.s.c,
        displayedCols,
        Math.min(totalRows, limits.预览行数 + 1),
      )
      已物化 = preview.length
      if (preview.length > 已发首屏) callbacks.onChunk(已发首屏, preview.slice(已发首屏))
    }
    callbacks.onDone("preview", {
      rows: Math.max(0, totalRows - 已物化),
      cols: Math.max(0, totalCols - displayedCols),
    })
    return
  }

  let 数据源 = firstSheet
  if (!首屏已全) {
    await 让出() // 首屏 meta 已交出，再全量解析
    数据源 = XLSX.read(bytes, { type: "array", codepage: 65001, cellNF: true }).Sheets[sheetName]
  }

  for (let start = 已发首屏; start < totalRows; start += limits.分块行数) {
    const rows = 取行(数据源, 全范围.s.r + start, 全范围.s.c, displayedCols, Math.min(limits.分块行数, totalRows - start))
    callbacks.onChunk(start, rows)
  }
  callbacks.onDone("full", { rows: 0, cols: Math.max(0, totalCols - displayedCols) })
}

async function 解析文本(
  bytes: Uint8Array<ArrayBuffer>,
  callbacks: 解析回调,
  limits: 解析限制,
  目标表?: string,
): Promise<void> {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "")
  // 全文扫描先于任何 meta 发送：晚出现的宽列也要计入 totalCols，不能只信首读 201 行。
  const { 行数, 列数: 粗列数 } = 扫描文本(text)
  const 首屏本 = XLSX.read(bytes, {
    type: "array",
    codepage: 65001,
    cellNF: true,
    sheetRows: limits.首屏行数 + 1,
  })
  // 文本（CSV/TSV）只有一张表，且没有隐藏属性。
  const sheets: 工作表项[] = 首屏本.SheetNames.map((name) => ({ name, hidden: false }))
  const sheetName = 选表(sheets, 目标表)
  const sheet = 首屏本.Sheets[sheetName]
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1")
  const totalRows = 行数
  const totalCols = Math.max(粗列数, range.e.c - range.s.c + 1)
  const mode = 判档(totalRows, totalCols, limits)
  const displayedCols = Math.min(totalCols, mode === "preview" ? limits.预览列数 : limits.全量列上限)
  const 首屏已全 = totalRows <= limits.首屏行数 + 1
  // 首屏先发：meta 必须在后续（可能的全量）读取之前送出，网格才能先挂载。
  const 已发首屏 = 发送(
    callbacks,
    sheets,
    sheetName,
    range,
    totalRows,
    totalCols,
    displayedCols,
    取行(sheet, range.s.r, range.s.c, displayedCols, Math.min(totalRows, limits.首屏行数 + 1)),
    limits,
  )

  if (mode === "preview") {
    let 已物化 = 已发首屏
    if (!首屏已全) {
      const 预览本 = XLSX.read(bytes, {
        type: "array",
        codepage: 65001,
        cellNF: true,
        sheetRows: limits.预览行数 + 1,
      })
      const preview = 取行(
        预览本.Sheets[sheetName],
        range.s.r,
        range.s.c,
        displayedCols,
        Math.min(totalRows, limits.预览行数 + 1),
      )
      已物化 = preview.length
      if (preview.length > 已发首屏) callbacks.onChunk(已发首屏, preview.slice(已发首屏))
    }
    callbacks.onDone("preview", {
      rows: Math.max(0, totalRows - 已物化),
      cols: Math.max(0, totalCols - displayedCols),
    })
    return
  }

  let 数据源 = sheet
  if (!首屏已全) {
    await 让出() // 首屏 meta 已交出，再全量解析
    数据源 = XLSX.read(bytes, { type: "array", codepage: 65001, cellNF: true }).Sheets[sheetName]
  }

  for (let start = 已发首屏; start < totalRows; start += limits.分块行数) {
    const rows = 取行(数据源, range.s.r + start, range.s.c, displayedCols, Math.min(limits.分块行数, totalRows - start))
    callbacks.onChunk(start, rows)
  }
  callbacks.onDone("full", { rows: 0, cols: Math.max(0, totalCols - displayedCols) })
}

/** 解析入口。错误经 `onError` 分档，不向调用方抛。 */
export async function 解析工作簿(
  bytes: Uint8Array<ArrayBuffer>,
  callbacks: 解析回调,
  limits: 解析限制 = 规模,
  目标表?: string,
): Promise<void> {
  try {
    if (是文本(bytes)) await 解析文本(bytes, callbacks, limits, 目标表)
    else await 解析二进制(bytes, callbacks, limits, 目标表)
  } catch (原因) {
    callbacks.onError(是加密工作簿(原因) ? "password" : "parse", 原因 instanceof Error ? 原因.message : String(原因))
  }
}
