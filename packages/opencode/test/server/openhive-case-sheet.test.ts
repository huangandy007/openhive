import { describe, expect, test } from "bun:test"
import { TextReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import * as XLSX from "xlsx"
import { readSheets } from "../../src/server/openhive/case-sheet"

/** 用同一个库生夹具：不是独立的第三方样本，但走的是真 xlsx 二进制往返。 */
function 造工作簿(sheets: Record<string, (string | number | null)[][]>): Uint8Array {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)
}

/** 单表工作簿，允许在写盘前给单元格设格式（`z`）。 */
function 造带格式的工作簿(rows: (string | number | null)[][], 格式: Record<string, string>): Uint8Array {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  for (const [ref, z] of Object.entries(格式)) {
    ws[ref]!.z = z
  }
  XLSX.utils.book_append_sheet(wb, ws, "S")
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)
}

/**
 * 直接把 zip 里工作表 xml 的 `<dimension ref>` 撑大。
 *
 * ⚠️ **不能再走 `XLSX.write`**：它写盘时会按声明范围逐行遍历（实测 `A1:XFD1000` 就 ~5s），
 * 撑到 `A1:XFD1048576` 直接挂死——夹具本身先冻住了，测不到读表器。真实导出件恰恰是
 * 「文件里 dimension 很大、单元格只有几个」（选中整列设格式），所以这里改的是真实形态。
 *
 * `refs` 的键是 zip 内路径（`xl/worksheets/sheet1.xml`），值是要写进去的 ref。
 */
async function 撑大声明范围(bytes: Uint8Array, refs: Record<string, string>): Promise<Uint8Array> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  const entries = await reader.getEntries()
  const writer = new ZipWriter(new Uint8ArrayWriter())
  for (const entry of entries) {
    if (entry.directory) {
      await writer.add(entry.filename, undefined, { directory: true })
      continue
    }
    const 目标 = refs[entry.filename]
    if (目标 === undefined) {
      await writer.add(entry.filename, new Uint8ArrayReader(await entry.getData!(new Uint8ArrayWriter())))
      continue
    }
    const xml = await entry.getData!(new TextWriter())
    const 改 = xml.replace(/<dimension ref="[^"]*"\s*\/>/, `<dimension ref="${目标}"/>`)
    if (改 === xml) throw new Error(`夹具没找到 dimension 节点：${entry.filename}`)
    await writer.add(entry.filename, new TextReader(改))
  }
  const out = await writer.close()
  await reader.close()
  return new Uint8Array(out)
}

/** UTF-16LE 字节（带 BOM），模拟 Excel「Unicode 文本」导出。 */
function 造UTF16LE(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes[0] = 0xff
  bytes[1] = 0xfe
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes[2 + i * 2] = code & 0xff
    bytes[3 + i * 2] = code >> 8
  }
  return bytes
}

/** UTF-16BE 字节（带 BOM），模拟「Unicode 大端」导出。 */
function 造UTF16BE(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes[0] = 0xfe
  bytes[1] = 0xff
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes[2 + i * 2] = code >> 8
    bytes[3 + i * 2] = code & 0xff
  }
  return bytes
}

describe("readSheets", () => {
  test("表头单独取出，数据行从第 2 行起、行号是文件里的绝对行号", () => {
    const bytes = 造工作簿({
      Sheet1: [
        ["主叫号码", "被叫号码", "通话时间"],
        ["13800000000", "13900000000", "2026-01-02 03:04:05"],
        ["13700000000", "13600000000", "2026-01-02 03:05:00"],
      ],
    })
    const [sheet] = readSheets(bytes).sheets
    expect(sheet?.name).toBe("Sheet1")
    expect(sheet?.header.map((c) => c.text)).toEqual(["主叫号码", "被叫号码", "通话时间"])
    expect(sheet?.rows.map((r) => r.rowNo)).toEqual([2, 3])
    expect(sheet?.rows[0]?.cells[0]?.text).toBe("13800000000")
  })

  test("真日期单元格（m/d/yy）：text 仍是显示原文，dateText 另给 ISO（I2）", () => {
    // Excel 默认日期格式写出来的 `w` 是 "1/2/26"，既不是 ISO 也不是四种可解析格式之一。
    // 数据不丢：`text` 必须保持民警在 Excel 里看到的样子（A16），解析用的 ISO 另放 dateText。
    const wb = XLSX.utils.book_new()
    // 46024.12783564815 = 2026-01-02 03:04:05（1899-12-30 起的天数）
    const ws = XLSX.utils.aoa_to_sheet([["通话时间"], [46024.12783564815], [46024]])
    ws["A2"]!.z = "m/d/yy h:mm:ss"
    ws["A3"]!.z = "m/d/yy"
    XLSX.utils.book_append_sheet(wb, ws, "S")
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)
    const [sheet] = readSheets(bytes).sheets
    expect(sheet?.rows[0]?.cells[0]).toEqual({
      text: "1/2/26 3:04:05",
      kind: "number",
      dateText: "2026-01-02 03:04:05",
    })
    expect(sheet?.rows[1]?.cells[0]).toEqual({ text: "1/2/26", kind: "number", dateText: "2026-01-02" })
  })

  test("非日期的数字单元格不带 dateText（`;;;` 隐藏值也不带）", () => {
    const bytes = 造带格式的工作簿([["金额"], [1234.5]], { A2: "#,##0.00" })
    const [sheet] = readSheets(bytes).sheets
    expect(sheet?.rows[0]?.cells[0]).toEqual({ text: "1,234.50", kind: "number" })
  })

  test("空单元格是 null，不是空串", () => {
    const bytes = 造工作簿({ S: [["a", "b"], ["1", null]] })
    const [sheet] = readSheets(bytes).sheets
    expect(sheet?.rows[0]?.cells[1]).toEqual({ text: null, kind: "empty" })
  })

  test("数值取显示文本，字符串单元格原样保留", () => {
    const bytes = 造工作簿({ S: [["金额"], ["1,234.50"], [1234.5]] })
    const [sheet] = readSheets(bytes).sheets
    // 字符串单元格原样；数值单元格取 Excel 的显示文本
    expect(sheet?.rows[0]?.cells[0]?.text).toBe("1,234.50")
    expect(sheet?.rows[1]?.cells[0]?.text).toBe("1234.5")
    expect(sheet?.rows[1]?.cells[0]?.kind).toBe("number")
  })

  test("数值单元格带格式时取 Excel 的显示文本，不是底层值", () => {
    const bytes = 造带格式的工作簿([["金额"], [1234.5]], { A2: "#,##0.00" })
    const [sheet] = readSheets(bytes).sheets
    // 底层值是 1234.5；显示文本是 "1,234.50" ⇒ 实现必须取 w，不能 String(cell.v)
    expect(sheet?.rows[0]?.cells[0]?.text).toBe("1,234.50")
    expect(sheet?.rows[0]?.cells[0]?.kind).toBe("number")
  })

  test("显示文本是空串时原样保留（数字格式 ;;; 隐藏值），不回退底层值", () => {
    const bytes = 造带格式的工作簿([["金额"], [1234]], { A2: ";;;" })
    const [sheet] = readSheets(bytes).sheets
    expect(sheet?.rows[0]?.cells[0]).toEqual({ text: "", kind: "number" })
  })

  test("多张工作表全都读出来，顺序与文件一致", () => {
    const bytes = 造工作簿({ 甲: [["x"], ["1"]], 乙: [["y"], ["2"]] })
    expect(readSheets(bytes).sheets.map((s) => s.name)).toEqual(["甲", "乙"])
  })

  test("maxRowsPerSheet 截断，且不静默：返回的 rows 长度就是上限", () => {
    const bytes = 造工作簿({ S: [["h"], ["1"], ["2"], ["3"]] })
    expect(readSheets(bytes, { maxRowsPerSheet: 2 }).sheets[0]?.rows).toHaveLength(2)
  })

  test("截断可观测：skippedSheets 与 truncatedSheets 说清丢了什么", () => {
    const bytes = 造工作簿({
      A: [["h"], ["1"], ["2"], ["3"]],
      B: [["h"], ["1"]],
      C: [["h"], ["1"]],
    })
    const result = readSheets(bytes, { maxSheets: 2, maxRowsPerSheet: 2 })
    expect(result.sheets.map((s) => s.name)).toEqual(["A", "B"])
    expect(result.sheets[0]?.rows).toHaveLength(2)
    expect(result.skippedSheets).toEqual(["C"])
    expect(result.truncatedSheets).toEqual(["A"])
  })

  test("显式 undefined 的上限按默认值处理，不是 0", () => {
    const bytes = 造工作簿({ S: [["h"], ["1"], ["2"]] })
    const result = readSheets(bytes, { maxSheets: undefined, maxRowsPerSheet: undefined })
    expect(result.sheets[0]?.rows).toHaveLength(2)
  })

  test("CSV 与 HTML 伪 .xls 也是表格：容器签名之外要有文本通道", () => {
    const csv = new TextEncoder().encode("主叫号码,被叫号码\n13800000000,13900000000\n")
    const [csvSheet] = readSheets(csv).sheets
    expect(csvSheet?.header.map((c) => c.text)).toEqual(["主叫号码", "被叫号码"])
    expect(csvSheet?.rows[0]?.cells[0]?.text).toBe("13800000000")

    const html = new TextEncoder().encode("<table><tr><td>金额</td></tr><tr><td>1234.5</td></tr></table>")
    const [htmlSheet] = readSheets(html).sheets
    expect(htmlSheet?.header.map((c) => c.text)).toEqual(["金额"])
    expect(htmlSheet?.rows[0]?.cells[0]?.text).toBe("1234.5")
  })

  test("只有 OLE2 前 4 字节不算容器（要满 8 字节），也不当文本读", () => {
    expect(() => readSheets(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow()
  })

  test("不是表格的字节 ⇒ 抛错（由调用方落「有问题」）", () => {
    expect(() => readSheets(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow()
  })

  test("一份工作表都读不出 ⇒ 抛错，不返回空数组", () => {
    expect(() => readSheets(造工作簿({ S: [] }))).toThrow("没有可读的工作表")
  })

  test("GBK 编码的 CSV ⇒ 抛错并提示另存 UTF-8，不静默乱码", () => {
    // 「主叫号码\n」的 GBK 字节：D6F7 BDD0 BAC5 C2EB 0A（不是 SheetJS 反向生成，是真字节）
    const bytes = Uint8Array.of(0xd6, 0xf7, 0xbd, 0xd0, 0xba, 0xc5, 0xc2, 0xeb, 0x0a)
    expect(() => readSheets(bytes)).toThrow(/UTF-8/)
  })

  test("无控制字节的二进制（非法 UTF-8）⇒ 抛错，不读出垃圾表", () => {
    expect(() => readSheets(Uint8Array.of(0x80, 0x81, 0x82, 0xfe, 0xff))).toThrow()
    expect(() => readSheets(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toThrow() // JPEG 头
  })

  test("空文件 / 只有空白的文件 ⇒ 抛错，不返回空表", () => {
    expect(() => readSheets(new Uint8Array())).toThrow("文件是空的")
    expect(() => readSheets(new TextEncoder().encode("\n"))).toThrow("文件里没有内容")
  })

  test("表头不在第 1 行（上方只有空行）时，仍按 !ref 起始行取表头与数据", () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([])
    XLSX.utils.sheet_add_aoa(
      ws,
      [
        ["主叫号码", "被叫号码"],
        ["13800000000", "13900000000"],
        ["13700000000", "13600000000"],
      ],
      { origin: "A5" },
    )
    // origin 只挪单元格，`!ref` 仍从 A1 起；手动把「用到的区域」定成 A5:B7（模拟标题行/
    // 空行在上、真实数据从第 5 行起的导出件）。
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 6, c: 1 } })
    XLSX.utils.book_append_sheet(wb, ws, "S")
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)
    const [sheet] = readSheets(bytes, { maxRowsPerSheet: 2 }).sheets
    expect(sheet?.header.map((c) => c.text)).toEqual(["主叫号码", "被叫号码"])
    expect(sheet?.rows.map((r) => r.rowNo)).toEqual([6, 7])
  })

  test("恰好 N 数据行、上限 N ⇒ 不误报截断", () => {
    const bytes = 造工作簿({ S: [["h"], ["1"], ["2"]] })
    const result = readSheets(bytes, { maxRowsPerSheet: 2 })
    expect(result.sheets[0]?.rows).toHaveLength(2)
    expect(result.truncatedSheets).toEqual([])
  })

  test("CSV 尾部空行不算截断（按非空行数判定），行号仍指回原文件", () => {
    const bytes = new TextEncoder().encode("h\n1\n2\n\n")
    const result = readSheets(bytes, { maxRowsPerSheet: 2 })
    expect(result.sheets[0]?.rows).toHaveLength(2)
    expect(result.sheets[0]?.rows.map((r) => r.rowNo)).toEqual([2, 3])
    expect(result.truncatedSheets).toEqual([])
  })

  test("中间有空行不丢行：空行不算数据行，也不占窗口", () => {
    // 表头 + 一个空行 + 数据 1、2；空行是第 2 行，数据在第 3、4 行。
    const bytes = new TextEncoder().encode("h\n\n1\n2\n")
    const result = readSheets(bytes, { maxRowsPerSheet: 10 })
    expect(result.sheets[0]?.rows.map((r) => r.rowNo)).toEqual([3, 4])
    expect(result.sheets[0]?.rows.map((r) => r.cells[0]?.text)).toEqual(["1", "2"])
    expect(result.truncatedSheets).toEqual([])
  })

  test("中间有空行 + 上限恰好够：两行数据都在，且不报截断", () => {
    // 本缺陷的见证：按位置取窗口会把空行算进去，导致 "2" 静默消失且 truncatedSheets 为空。
    const bytes = new TextEncoder().encode("h\n\n1\n2\n")
    const result = readSheets(bytes, { maxRowsPerSheet: 2 })
    expect(result.sheets[0]?.rows.map((r) => r.rowNo)).toEqual([3, 4])
    expect(result.sheets[0]?.rows.map((r) => r.cells[0]?.text)).toEqual(["1", "2"])
    expect(result.truncatedSheets).toEqual([])
  })

  test("非空行真的超过上限才报截断", () => {
    const bytes = new TextEncoder().encode("h\n1\n2\n3\n")
    const result = readSheets(bytes, { maxRowsPerSheet: 2 })
    expect(result.sheets[0]?.rows.map((r) => r.cells[0]?.text)).toEqual(["1", "2"])
    expect(result.truncatedSheets).toEqual(["Sheet1"])
  })

  test("UTF-16（Excel「Unicode 文本」）⇒ 抛错并提示另存 UTF-8", () => {
    expect(() => readSheets(造UTF16LE("主叫号码\n"))).toThrow(/UTF-16/)
    expect(() => readSheets(造UTF16LE("主叫号码\n"))).toThrow(/另存为 UTF-8/)
  })

  test("UTF-16 两种 BOM（FF FE / FE FF）都点名 UTF-16", () => {
    expect(() => readSheets(造UTF16LE("h\n"))).toThrow(/UTF-16 文本不受支持/)
    expect(() => readSheets(造UTF16BE("h\n"))).toThrow(/UTF-16 文本不受支持/)
  })

  test("UTF-16 BOM ＋ 一个 NUL 都没有的中文，也要点名 UTF-16", () => {
    // 「主叫」的 UTF-16LE 字节是 3B 4E EB 53 —— 每个字节都 ≥ 0x20，会被 looksLikeText 判成文本。
    // 所以 BOM 必须先于「像不像文本」判定，否则这类文件只拿到泛化提示（上一轮复审实测的缺口）。
    expect(() => readSheets(造UTF16LE("主叫"))).toThrow(/UTF-16 文本不受支持/)
  })

  test("声明范围被撑大（选中整列设格式）⇒ 响亮抛错，不冻结内核（C1）", async () => {
    // 真实现时 SheetJS 会按 `<dimension ref="A1:XFD1048576">` 给出这个 !ref：
    // 16384 列 × 1048575 行，按声明面积同步扫描是小时级 ＋ OOM，而它跑在 Bun 事件循环上
    // ⇒ 整个内核停摆。闸必须在进入循环**之前**按声明面积判，不能等扫完再说。
    const bytes = await 撑大声明范围(造工作簿({ S: [["主叫号码"], ["13800000000"]] }), {
      "xl/worksheets/sheet1.xml": "A1:XFD1048576",
    })
    expect(() => readSheets(bytes)).toThrow(/声明范围过大/)
  })

  test("单表都在上限内、累计超过工作簿上限 ⇒ 同样抛错（防 8 张表各 1900 万）", async () => {
    // 每张 10000 列 × 1500 行 = 1500 万（低于单表 2000 万），3 张累计 4500 万 > 4000 万。
    const ref = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 1500, c: 9999 } })
    const bytes = await 撑大声明范围(造工作簿({ S0: [["h"], ["1"]], S1: [["h"], ["1"]], S2: [["h"], ["1"]] }), {
      "xl/worksheets/sheet1.xml": ref,
      "xl/worksheets/sheet2.xml": ref,
      "xl/worksheets/sheet3.xml": ref,
    })
    expect(() => readSheets(bytes)).toThrow(/声明范围过大/)
  })

  test("上限之外的空表不算「丢失」：skippedSheets 只收有 !ref 的表（I4）", () => {
    // Excel 新建工作簿默认就带空表（无 !ref）。把它算进 skippedSheets 会让 runJob
    // 把整份合法文件误判「有问题」——与「空表跳过、不算丢失」的既有口径矛盾。
    const wb = XLSX.utils.book_new()
    for (let i = 0; i < 8; i++)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["h"], ["1"]]), `S${i}`)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "空表")
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer)
    const result = readSheets(bytes)
    expect(result.sheets).toHaveLength(8)
    expect(result.skippedSheets).toEqual([])
  })

  test("含 NUL 但没有 UTF-16 BOM ⇒ 给泛化措辞，不谎称是 UTF-16 文本", () => {
    // 纯 ASCII 内容的 UTF-16LE（无 BOM）：0x68 0x00 0x0a 0x00 = "h\n"。
    // 它既可能是 UTF-16，也可能是自带 NUL 的 UTF-8/二进制，不能说死「请另存 UTF-16」。
    const bytes = Uint8Array.of(0x68, 0x00, 0x0a, 0x00)
    expect(() => readSheets(bytes)).toThrow(/NUL/)
    expect(() => readSheets(bytes)).toThrow(/另存为 UTF-8/)
    expect(() => readSheets(bytes)).not.toThrow(/UTF-16 文本不受支持/)
  })
})
