export * as OpenhiveCaseSheet from "./case-sheet"

import * as XLSX from "xlsx"

/**
 * 服务端读表：把工作簿读成「原始文本网格」。
 *
 * ## 为什么不用 `packages/app` 那份读表器
 *
 * 那份（`app/src/center/views/sheet/sheet-parse-core.ts`）是给浏览器看表格用的，
 * 两件事与服务端相反：① 跑在 Worker 里；② `单元格文本`（`:109-131`）会把日期改写成
 * 规范串、把数值取格式化后的 `w`。服务端要的是**单元格显示文本原样**——它就是
 * `case_fact_row.started_raw`，设计 §4.2 要求「原始值从未被改写」（判据 A16）。
 *
 * 因此这里只做一件事：保留 `w`（Excel 里看到的那个样子），另外把「是不是数字」
 * 记成 `kind`。**注意：目前下游（Task 3/5）只消费 `text`，`kind` 还没有读者**，
 * 留着是给识别层以后判断用，不代表现在已经生效。
 *
 * ## 已知不保真的地方
 *
 * 数值单元格的**底层值**（日期是序列号、金额是 IEEE754 双精度）不保留，只有显示文本。
 * 显示文本正是民警在 Excel 里看到的那个值；真要底层值，另存 `cell.v`，本计划不做。
 */
export type CellKind = "text" | "number" | "empty"

export interface RawCell {
  /** 单元格显示文本；空单元格为 null（不是空串）。 */
  text: string | null
  kind: CellKind
}

export interface RawRow {
  /** **文件里的绝对行号**（表头是第 1 行）；引用要指回原始行，不能用「第几条数据」。 */
  rowNo: number
  cells: RawCell[]
}

export interface RawSheet {
  name: string
  /** 第 1 行。 */
  header: RawCell[]
  rows: RawRow[]
}

export interface ReadLimits {
  maxSheets?: number
  maxRowsPerSheet?: number
}

export interface ReadResult {
  sheets: RawSheet[]
  /** 因 maxSheets 上限而未解析的工作表名，按文件顺序。 */
  skippedSheets: string[]
  /** 因 maxRowsPerSheet 上限被截断的工作表名。 */
  truncatedSheets: string[]
}

const DEFAULT_LIMITS: Required<ReadLimits> = { maxSheets: 8, maxRowsPerSheet: 200_000 }

/**
 * 容器签名：ZIP（.xlsx/.xlsm/.ods）或 OLE2（.xls 旧格式）。
 *
 * OLE2 必须比满 8 字节（`D0 CF 11 E0 A1 B1 1A E1`）：只比前 4 字节时 SheetJS 的 CFB
 * 分派不会命中，会退化成纯文本解析（实测 4 字节 `D0 CF 11 E0` 返回垃圾表头 + 0 行）。
 */
function isContainer(bytes: Uint8Array): boolean {
  const at = (i: number) => bytes[i] ?? 0
  const zip =
    bytes.length >= 4 && at(0) === 0x50 && at(1) === 0x4b && (at(2) === 0x03 || at(2) === 0x05 || at(2) === 0x07)
  const ole2 =
    bytes.length >= 8 &&
    at(0) === 0xd0 &&
    at(1) === 0xcf &&
    at(2) === 0x11 &&
    at(3) === 0xe0 &&
    at(4) === 0xa1 &&
    at(5) === 0xb1 &&
    at(6) === 0x1a &&
    at(7) === 0xe1
  return zip || ole2
}

/**
 * CSV / TSV / HTML 伪 .xls：除 `\t \r \n` 外不含控制字节。UTF-8 BOM 与中文多字节都 ≥ 0x20，
 * 自然放行；任意二进制垃圾（如 `0x01..0x08`）会被挡下 —— 这正是「不是表格的字节」要的效果。
 */
function looksLikeText(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false
  }
  return true
}

function toRawCell(cell: XLSX.CellObject | undefined): RawCell {
  if (cell === undefined || cell.v === undefined || cell.v === null || cell.v === "") {
    return { text: null, kind: "empty" }
  }
  // 只判 `typeof`：`w === ""`（如数字格式 `;;;` 隐藏值）时 Excel 显示空白，空串要原样保留，
  // 不能因为「空」就回退到底层值。
  const text = typeof cell.w === "string" ? cell.w : String(cell.v)
  return { text, kind: cell.t === "n" ? "number" : "text" }
}

/**
 * 读全部（上限内）工作表。
 *
 * **抛错**表示这份字节读不成表格（不是可识别格式，或一份工作表都读不出）——调用方据此把材料
 * 落「有问题」，不要在这里吞掉。**不认识的内容宁可抛错，也不静默当表读**：这是给办案用的，
 * 静默比报错糟。
 *
 * 上限不是静默的：被 `maxSheets` 挡掉的工作表名进 `skippedSheets`，被 `maxRowsPerSheet`
 * 截断的工作表名进 `truncatedSheets`。取证场景里「无声消失」比「报错」糟得多。
 */
export function readSheets(bytes: Uint8Array, limits: ReadLimits = {}): ReadResult {
  const container = isContainer(bytes)
  if (!container && !looksLikeText(bytes)) {
    throw new Error("不是可识别的表格文件（xlsx/xls/csv/html）")
  }

  // 逐字段 ??：显式 `undefined` 也要落回默认值（展开合并时 undefined 会覆盖默认值）。
  const maxSheets = limits.maxSheets ?? DEFAULT_LIMITS.maxSheets
  const maxRowsPerSheet = limits.maxRowsPerSheet ?? DEFAULT_LIMITS.maxRowsPerSheet
  const readOptions = { cellDates: false, cellStyles: false, sheetRows: maxRowsPerSheet + 1 } as const

  // sheetRows 让 SheetJS 在**解析阶段**就截断（不是整本读进内存再砍数组），多算 1 行表头。
  // 文本格式先按 UTF-8 自己解码再交给 SheetJS：它的 codepage 表没随包带上（会打印
  // “Codepage tables are not loaded” 并可能给出乱码），而平台 TextDecoder 的 UTF-8 是完整的。
  // ⚠️ 已知限制：GBK / UTF-16 的 CSV 会变乱码，需要上游转码；本计划只承诺 UTF-8。
  const wb = container
    ? XLSX.read(bytes, { ...readOptions, type: "array" })
    : XLSX.read(new TextDecoder("utf-8").decode(bytes), { ...readOptions, type: "string" })

  const sheets: RawSheet[] = []
  const truncatedSheets: string[] = []

  for (const name of wb.SheetNames.slice(0, maxSheets)) {
    const ws = wb.Sheets[name]
    if (!ws || !ws["!ref"]) continue
    const range = XLSX.utils.decode_range(ws["!ref"])

    // 截断判定：zip/CFB 格式被 sheetRows 截断时，完整范围留在 `!fullref`，`!ref` 只到上限。
    // 文本格式（CSV/HTML）sheetRows 同样生效，但**不写 `!fullref`**，只能在「行数正好顶到上限」
    // 时保守报出——宁可多报「可能截断」，也不静默丢行。
    const full = ws["!fullref"] ? XLSX.utils.decode_range(ws["!fullref"]) : undefined
    const truncated = full ? full.e.r > range.e.r : range.e.r - range.s.r >= maxRowsPerSheet
    if (truncated) truncatedSheets.push(name)

    const rowAt = (r: number): RawRow => {
      const cells: RawCell[] = []
      for (let c = range.s.c; c <= range.e.c; c++) {
        cells.push(toRawCell(ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined))
      }
      return { rowNo: r + 1, cells }
    }

    const header = rowAt(range.s.r).cells
    const rows: RawRow[] = []
    for (let r = range.s.r + 1; r <= range.e.r && rows.length < maxRowsPerSheet; r++) {
      rows.push(rowAt(r))
    }
    sheets.push({ name, header, rows })
  }

  if (sheets.length === 0) throw new Error("没有可读的工作表")

  return { sheets, skippedSheets: wb.SheetNames.slice(maxSheets), truncatedSheets }
}
