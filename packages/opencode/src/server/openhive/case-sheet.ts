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
 * 记成 `kind`，供识别层判断。
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

const DEFAULT_LIMITS: Required<ReadLimits> = { maxSheets: 8, maxRowsPerSheet: 200_000 }

function toRawCell(cell: XLSX.CellObject | undefined): RawCell {
  if (cell === undefined || cell.v === undefined || cell.v === null || cell.v === "") {
    return { text: null, kind: "empty" }
  }
  const text = typeof cell.w === "string" && cell.w.length > 0 ? cell.w : String(cell.v)
  return { text, kind: cell.t === "n" ? "number" : "text" }
}

/**
 * SheetJS 对不认识的字节**不抛错**：它会退化成纯文本解析，把任意字节读成一张「Sheet1」
 * （实测 `[1..8]` ⇒ `SheetNames: ["Sheet1"]`）。所以先按容器签名判定，别让它蒙混过关。
 *
 * - ZIP（`PK\x03\x04` / `PK\x05\x06` / `PK\x07\x08`）⇒ .xlsx / .xlsm / .ods
 * - OLE2（`D0 CF 11 E0`）⇒ .xls 旧格式
 */
function isSpreadsheetContainer(bytes: Uint8Array): boolean {
  const at = (i: number) => bytes[i] ?? 0
  const zip = bytes.length >= 4 && at(0) === 0x50 && at(1) === 0x4b && (at(2) === 0x03 || at(2) === 0x05 || at(2) === 0x07)
  const cfb = bytes.length >= 4 && at(0) === 0xd0 && at(1) === 0xcf && at(2) === 0x11 && at(3) === 0xe0
  return zip || cfb
}

/**
 * 读全部（上限内）工作表。**抛错**表示这份字节根本不是表格——调用方据此把材料落「有问题」，
 * 不要在这里吞掉。
 */
export function readSheets(bytes: Uint8Array, limits: ReadLimits = {}): RawSheet[] {
  if (!isSpreadsheetContainer(bytes)) throw new Error("不是可识别的表格文件（xlsx/xls/ods）")
  const { maxSheets, maxRowsPerSheet } = { ...DEFAULT_LIMITS, ...limits }
  const wb = XLSX.read(bytes, { type: "array", cellDates: false, cellStyles: false })

  const out: RawSheet[] = []
  for (const name of wb.SheetNames.slice(0, maxSheets)) {
    const ws = wb.Sheets[name]
    if (!ws || !ws["!ref"]) continue
    const range = XLSX.utils.decode_range(ws["!ref"])
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
    out.push({ name, header, rows })
  }
  return out
}
