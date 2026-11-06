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
 * 响亮失败、给一句可操作的错误（「CSV 请另存为 UTF-8」）。UTF-16（Excel「Unicode 文本」导出）
 * 同样拒绝，错误信息分两档：**带 UTF-16 BOM 的**点名「UTF-16 文本不受支持」；只是含 NUL 字节、
 * 没有 BOM 的（无 BOM 的 UTF-16、二进制、或本身嵌了 NUL 的 UTF-8）给泛化提示 —— 因为仅凭 NUL
 * 不足以断定是 UTF-16。代价：GBK 导出的 CSV / HTML 伪 `.xls` 要用户转存一次。若真栈验收发现
 * 这类材料多，另开任务做「编码探测＋内容合理性判定」，不进本计划。
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
  /**
   * 日期单元格的 ISO 解析文本（`YYYY-MM-DD` / `YYYY-MM-DD HH:MM:SS`）。
   *
   * 只有「数值单元格 ＋ 日期格式」才有：Excel 默认 `m/d/yy` 的显示文本是 `1/2/26`，
   * `case-time` 的四种格式都认不出。**它不改写 `text`** —— `text` 仍是显示原文（A16），
   * 下游解析时间时优先用它，`started_raw` 照旧落 `text`。
   */
  dateText?: string
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
  /**
   * 数据行。**只含至少有一个非空单元格的行**——全空行（话单里的分隔空行、CSV 尾部空行）
   * 不是事实行，不返回、也不占 `maxRowsPerSheet` 的窗口。`rowNo` 仍是文件里的绝对行号，
   * 下游按它落库；跳空行不影响行号指回原文件。
   */
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
 * 声明范围的**扫描面积**上限（格 = 列宽 × **声明区域全高**），不是返回行数上限。
 *
 * ⚠️ **不能用返回行数封顶**：`maxRowsPerSheet` 只约束返回的行数组，空行不占配额，
 * 外层仍会逐行扫到 `!ref` 的末尾。所以面积必须按 `宽 × (e.r - s.r)` 算，与「会返回几行」
 * 无关。实测扫描速度约 4M 格/秒 ⇒ 单表 2000 万约等于 5 秒上限；正常导出
 * 20 万行 × 15 列 = 300 万格，留了一个数量级的余量。整本 4000 万是防「8 张表各 1900 万」
 * 绕过单表闸。
 *
 * 超限**响亮抛错**（不是静默裁剪）：这类文件多半是「选中整列设格式」把 `!ref` 撑到
 * `A1:XFD1048576`，同步扫完是小时级 ＋ OOM，而它跑在 Bun 事件循环上 ⇒ 整个内核停摆。
 * 即便没到小时级，几十秒的同步阻塞也会让内核整体失去响应（复审实测 26 列 7.3 秒、
 * 99 列 26.4 秒）。
 */
const MAX_SHEET_SCAN_CELLS = 20_000_000
const MAX_WORKBOOK_SCAN_CELLS = 40_000_000

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
 * UTF-16 BOM（`FF FE` / `FE FF`）。只有 BOM 才足以**点名** UTF-16：
 *
 * 仅含 NUL 字节还可能是自带 NUL 的 UTF-8 文本或二进制，说成「UTF-16 文本」会把用户引到
 * 死路（文件本来就是 UTF-8）。无 BOM 的含 NUL 输入由 `hasNulByte` 给泛化措辞。
 */
function hasUtf16Bom(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false
  const b0 = bytes[0] ?? 0
  const b1 = bytes[1] ?? 0
  return (b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff)
}

/** 是否含 NUL 字节（文本通道放行后仍含 NUL ⇒ 不是可读的 UTF-8 表格文本）。 */
function hasNulByte(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0x00) return true
  }
  return false
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

/**
 * 日期序列号 → ISO 文本。Excel 的 1900 闰年问题由 SheetJS 的 `parse_date_code` 处理。
 * 时/分/秒/小数全为 0 才是纯日期；否则补零到 `YYYY-MM-DD HH:MM:SS`。
 */
function 日期文本(serial: number, date1904: boolean): string | undefined {
  // `XLSX.SSF` 在 xlsx 的类型定义里是 `any`，这里按已知返回形状直接读（不做类型断言，
  // 免得给 oxlint 添一条 `no-unsafe-type-assertion`）。
  const d = XLSX.SSF.parse_date_code(serial, { date1904 })
  if (!d) return undefined
  const 补 = (n: number) => String(n).padStart(2, "0")
  const 日 = `${String(d.y).padStart(4, "0")}-${补(d.m)}-${补(d.d)}`
  if (d.H === 0 && d.M === 0 && d.S === 0 && d.u === 0) return 日
  return `${日} ${补(d.H)}:${补(d.M)}:${补(d.S)}`
}

function toRawCell(cell: XLSX.CellObject | undefined, 基准1904: boolean): RawCell {
  if (cell === undefined || cell.v === undefined || cell.v === null || cell.v === "") {
    return { text: null, kind: "empty" }
  }
  // 只判 `typeof`：`w === ""`（如数字格式 `;;;` 隐藏值）时 Excel 显示空白，空串要原样保留，
  // 不能因为「空」就回退到底层值。
  const text = typeof cell.w === "string" ? cell.w : String(cell.v)
  const kind: CellKind = cell.t === "n" ? "number" : "text"
  const out: RawCell = { text, kind }
  // 日期单元格另给一份可解析文本，**不改写 `text`**（A16）：Excel 默认 `m/d/yy` 的
  // 显示文本（"1/2/26"）四种时间格式都不认，光靠 text 会让 startedAt 全 null。
  if (cell.t === "n" && typeof cell.v === "number" && typeof cell.z === "string" && XLSX.SSF.is_date(cell.z)) {
    const dateText = 日期文本(cell.v, 基准1904)
    if (dateText !== undefined) out.dateText = dateText
  }
  return out
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
  // UTF-16 的 BOM 排在「像不像文本」**之前**：UTF-16LE 的中文可能一个 NUL 都没有
  // （「主叫」= 3B 4E EB 53），排在后面就会被当合法 UTF-8 文本放行，只给泛化提示。
  // 反过来不会误伤：合法 UTF-8 文本不可能以 FF FE / FE FF 开头（这两个字节本就非法）。
  if (!container && hasUtf16Bom(bytes)) throw new Error("UTF-16 文本不受支持，请另存为 UTF-8")
  if (!container && !looksLikeText(bytes)) {
    // 只有 NUL、没有 BOM：可能是无 BOM 的 UTF-16，也可能是二进制，或本身就是 UTF-8 却嵌了 NUL。
    // 这里不能一口咬定 UTF-16，所以提示里给了「检查文件是否损坏」这条对第三类也成立的路。
    if (hasNulByte(bytes))
      throw new Error("文件含 NUL 字节，疑似 UTF-16 或二进制；请检查文件是否损坏，或用 Excel 另存为 UTF-8 CSV 后重试")
    throw new Error("不是可识别的表格文件（xlsx/xls/csv/html）")
  }

  // 逐字段 ??：显式 `undefined` 也要落回默认值（展开合并时 undefined 会覆盖默认值）。
  const maxSheets = limits.maxSheets ?? DEFAULT_LIMITS.maxSheets
  const maxRowsPerSheet = limits.maxRowsPerSheet ?? DEFAULT_LIMITS.maxRowsPerSheet

  // 整本解析（不用 sheetRows，见文件头「上限的代价」）；文本通道先严格解码再交给 SheetJS。
  // `cellNF: true` 保留数字格式串（`cell.z`）：日期单元格要靠它判「这是不是日期」，
  // 才能另外给出 ISO 解析文本而**不改写** `text`（I2）。
  const wb = container
    ? XLSX.read(bytes, { type: "array", cellDates: false, cellStyles: false, cellNF: true })
    : XLSX.read(decodeText(bytes), { type: "string", cellDates: false, cellStyles: false, cellNF: true })

  // 1904 日期系统的工作簿（Mac 老格式）序列号起点不同，解析要跟着走。
  const 基准1904 = Boolean(wb.Workbook?.WBProps?.date1904)

  // 先把上限内、有 !ref 的表连声明范围一起收齐，**进入任何扫描之前**验面积。
  // 闸必须早于循环：它挡的正是「循环本身会让内核停摆」的那类文件（C1）。
  const 可读 = wb.SheetNames.slice(0, maxSheets).flatMap((name) => {
    const ws = wb.Sheets[name]
    // 空表（没有 !ref）跳过，且**不算丢失**：它本来就没数据，塞进 skippedSheets 会让 Task 6
    // 把整份材料误判「有问题」。
    if (!ws || !ws["!ref"]) return []
    return [{ name, ws, range: XLSX.utils.decode_range(ws["!ref"]) }]
  })

  let 累计扫描格 = 0
  for (const { range } of 可读) {
    // 扫描成本 = 列宽 × **声明区域全高**：空行不占 `maxRowsPerSheet` 的配额，外层照样
    // 逐行扫到底。用返回行数封顶会低估真实成本（见常量注释）。
    const 宽 = range.e.c - range.s.c + 1
    const 高 = range.e.r - range.s.r
    const 单表扫描格 = 宽 * 高
    if (单表扫描格 > MAX_SHEET_SCAN_CELLS)
      throw new Error(`声明范围过大（约 ${单表扫描格} 格），请只保留数据区域后重导`)
    累计扫描格 += 单表扫描格
    if (累计扫描格 > MAX_WORKBOOK_SCAN_CELLS)
      throw new Error(`声明范围过大（约 ${累计扫描格} 格），请只保留数据区域后重导`)
  }

  const sheets: RawSheet[] = []
  const truncatedSheets: string[] = []

  for (const { name, ws, range } of 可读) {
    const rowAt = (r: number): RawRow => {
      const cells: RawCell[] = []
      for (let c = range.s.c; c <= range.e.c; c++) {
        cells.push(toRawCell(ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined, 基准1904))
      }
      return { rowNo: r + 1, cells }
    }

    // 「数据行」= 至少有一个非空单元格的行。CSV 导出常在末尾/中间留空行：按位置取窗口会把
    // 空行算进来，既误报截断、又让真正的数据行被挤出窗口而**无声消失**（本模块明确禁止）。
    // 因此**单次遍历、只物化要返回的行**：判定与收集同源，空行不占窗口，溢出即截断。
    const header = rowAt(range.s.r).cells
    const rows: RawRow[] = []
    let 溢出了 = false
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const row = rowAt(r)
      if (row.cells.every((c) => c.text === null)) continue
      if (rows.length < maxRowsPerSheet) {
        rows.push(row)
      } else {
        溢出了 = true
        break
      }
    }
    if (溢出了) truncatedSheets.push(name)
    sheets.push({ name, header, rows })
  }

  if (sheets.length === 0) {
    throw new Error(`没有可读的工作表（文件里有 ${wb.SheetNames.length} 张表，上限 ${maxSheets}）`)
  }

  // 上限之外的空表**不算丢失**：与上限内「空表跳过」同一口径。否则 Excel 新建工作簿
  // 默认带的那张无 !ref 的空表会让 runJob 把整份合法文件误判「有问题」（I4）。
  const skippedSheets = wb.SheetNames.slice(maxSheets).filter((name) => Boolean(wb.Sheets[name]?.["!ref"]))

  return { sheets, skippedSheets, truncatedSheets }
}
