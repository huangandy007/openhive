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
 * ## 输入编码（裁定 R11）
 *
 * 文本通道**只认严格 UTF-8**，不做 GBK 自动探测：GB18030 几乎能解码任意字节序列，自动回退
 * 等于把二进制又放进来，还把中文人名/地名/案由解成乱码且不报错——证据数据不可接受。宁可
 * 响亮失败、给一句可操作的错误（「CSV 请另存为 UTF-8」）。UTF-16（Excel「Unicode 文本」导出、
 * 带 NUL 字节）同样拒绝，但错误信息会点名「UTF-16 文本不受支持，请另存为 UTF-8」，不给泛化
 * 提示。代价：GBK 导出的 CSV / HTML 伪 `.xls` 要用户转存一次。若真栈验收发现这类材料多，
 * 另开任务做「编码探测＋内容合理性判定」，不进本计划。
 *
 * ## 已知不保真的地方
 *
 * 数值单元格的**底层值**（日期是序列号、金额是 IEEE754 双精度）不保留，只有显示文本。
 * 显示文本正是民警在 Excel 里看到的那个值；真要底层值，另存 `cell.v`，本计划不做。
 *
 * ## 上限的代价
 *
 * `maxRowsPerSheet` 只约束**返回的行数组**，**不约束解析期内存**：整本工作簿仍会被 SheetJS
 * 读进内存。超大话单的内存保护（`dense: true` / 流式）留到真栈实测再定，本计划不做。
 * （不能用 `sheetRows` 省内存：它按**绝对行号**截断，表头不在第 1 行时会把表头连同数据
 * 整片切掉，`+1` 只补偿表头恰好在第 0 行的情形；解析前又拿不到 `range.s.r`，绕不过去。）
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
 *
 * 这一关先于严格解码：`[0x01..0x08]` 是**合法** UTF-8（控制码），光靠 `fatal` 解不掉。
 */
function looksLikeText(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false
  }
  return true
}

/**
 * UTF-16 文本（`FF FE` / `FE FF` BOM，或含 NUL 且去掉 NUL 后无其它控制字节）。
 *
 * 只用来把**错误信息说清楚**：R11 仍拒绝，不做自动转换——用户拿到「请另存为 UTF-8」比拿到
 * 泛化的「不是可识别的表格文件」更可操作。
 */
function looksLikeUtf16(bytes: Uint8Array): boolean {
  if (bytes.length >= 2) {
    const b0 = bytes[0] ?? 0
    const b1 = bytes[1] ?? 0
    if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff)) return true
  }
  let hasNul = false
  for (const byte of bytes) {
    if (byte === 0x00) {
      hasNul = true
      continue
    }
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false
  }
  return hasNul
}

/**
 * 文本通道的严格解码（裁定 R11）。三类坏输入都**响亮失败**，不静默当表读：
 * 空文件、解不成 UTF-8（GBK / 无控制字节的二进制 / JPEG 头）、解出来只有空白。
 */
function decodeText(bytes: Uint8Array): string {
  if (bytes.length === 0) throw new Error("文件是空的")
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new Error("不是可识别的表格文件：既不是 xlsx/xls，也不是 UTF-8 文本（CSV 请另存为 UTF-8）")
  }
  if (text.trim() === "") throw new Error("文件里没有内容")
  return text
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
 * **抛错**表示这份字节读不成表格（不是可识别格式、编码不是 UTF-8、文件为空，或一份工作表都
 * 读不出）——调用方据此把材料落「有问题」，不要在这里吞掉。**不认识的内容宁可抛错，也不静默
 * 当表读**：这是给办案用的，静默比报错糟。
 *
 * 上限不是静默的：被 `maxSheets` 挡掉的工作表名进 `skippedSheets`，被 `maxRowsPerSheet`
 * 截断的工作表名进 `truncatedSheets`。取证场景里「无声消失」比「报错」糟得多。
 */
export function readSheets(bytes: Uint8Array, limits: ReadLimits = {}): ReadResult {
  const container = isContainer(bytes)
  if (!container && !looksLikeText(bytes)) {
    if (looksLikeUtf16(bytes)) throw new Error("UTF-16 文本不受支持，请另存为 UTF-8")
    throw new Error("不是可识别的表格文件（xlsx/xls/csv/html）")
  }

  // 逐字段 ??：显式 `undefined` 也要落回默认值（展开合并时 undefined 会覆盖默认值）。
  const maxSheets = limits.maxSheets ?? DEFAULT_LIMITS.maxSheets
  const maxRowsPerSheet = limits.maxRowsPerSheet ?? DEFAULT_LIMITS.maxRowsPerSheet

  // 整本解析（不用 sheetRows，见文件头「上限的代价」）；文本通道先严格解码再交给 SheetJS。
  const wb = container
    ? XLSX.read(bytes, { type: "array", cellDates: false, cellStyles: false })
    : XLSX.read(decodeText(bytes), { type: "string", cellDates: false, cellStyles: false })

  const sheets: RawSheet[] = []
  const truncatedSheets: string[] = []

  for (const name of wb.SheetNames.slice(0, maxSheets)) {
    const ws = wb.Sheets[name]
    // 空表（没有 !ref）跳过，且**不算丢失**：它本来就没数据，塞进 skippedSheets 会让 Task 6
    // 把整份材料误判「有问题」。
    if (!ws || !ws["!ref"]) continue
    const range = XLSX.utils.decode_range(ws["!ref"])

    const rowAt = (r: number): RawRow => {
      const cells: RawCell[] = []
      for (let c = range.s.c; c <= range.e.c; c++) {
        cells.push(toRawCell(ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined))
      }
      return { rowNo: r + 1, cells }
    }

    // 「数据行」= 至少有一个非空单元格的行。CSV 导出常在末尾留空行，按位置数（e.r - s.r）会把
    // 空行算进截断判定 ⇒ 好材料被误报，Task 6 直接拒收。判定按**非空行数**，不是按位置差。
    let nonEmptyRows = 0
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      if (rowAt(r).cells.some((c) => c.text !== null)) nonEmptyRows++
    }
    if (nonEmptyRows > maxRowsPerSheet) truncatedSheets.push(name)

    // 返回的 rows 仍按位置取前 maxRowsPerSheet 条（不跳空行）：行号必须能指回原文件。
    const header = rowAt(range.s.r).cells
    const rows: RawRow[] = []
    for (let r = range.s.r + 1; r <= range.e.r && rows.length < maxRowsPerSheet; r++) {
      rows.push(rowAt(r))
    }
    sheets.push({ name, header, rows })
  }

  if (sheets.length === 0) {
    throw new Error(`没有可读的工作表（文件里有 ${wb.SheetNames.length} 张表，上限 ${maxSheets}）`)
  }

  return { sheets, skippedSheets: wb.SheetNames.slice(maxSheets), truncatedSheets }
}
