import { describe, expect, test } from "bun:test"
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

describe("readSheets", () => {
  test("表头单独取出，数据行从第 2 行起、行号是文件里的绝对行号", () => {
    const bytes = 造工作簿({
      Sheet1: [
        ["主叫号码", "被叫号码", "通话时间"],
        ["13800000000", "13900000000", "2026-01-02 03:04:05"],
        ["13700000000", "13600000000", "2026-01-02 03:05:00"],
      ],
    })
    const [sheet] = readSheets(bytes)
    expect(sheet?.name).toBe("Sheet1")
    expect(sheet?.header.map((c) => c.text)).toEqual(["主叫号码", "被叫号码", "通话时间"])
    expect(sheet?.rows.map((r) => r.rowNo)).toEqual([2, 3])
    expect(sheet?.rows[0]?.cells[0]?.text).toBe("13800000000")
  })

  test("空单元格是 null，不是空串", () => {
    const bytes = 造工作簿({ S: [["a", "b"], ["1", null]] })
    const [sheet] = readSheets(bytes)
    expect(sheet?.rows[0]?.cells[1]).toEqual({ text: null, kind: "empty" })
  })

  test("数字按显示文本取，去掉千分位后仍是原样", () => {
    const bytes = 造工作簿({ S: [["金额"], ["1,234.50"], [1234.5]] })
    const [sheet] = readSheets(bytes)
    // 字符串单元格原样；数值单元格取 Excel 的显示文本
    expect(sheet?.rows[0]?.cells[0]?.text).toBe("1,234.50")
    expect(sheet?.rows[1]?.cells[0]?.text).toBe("1234.5")
    expect(sheet?.rows[1]?.cells[0]?.kind).toBe("number")
  })

  test("多张工作表全都读出来，顺序与文件一致", () => {
    const bytes = 造工作簿({ 甲: [["x"], ["1"]], 乙: [["y"], ["2"]] })
    expect(readSheets(bytes).map((s) => s.name)).toEqual(["甲", "乙"])
  })

  test("maxRowsPerSheet 截断，且不静默：返回的 rows 长度就是上限", () => {
    const bytes = 造工作簿({ S: [["h"], ["1"], ["2"], ["3"]] })
    expect(readSheets(bytes, { maxRowsPerSheet: 2 })[0]?.rows).toHaveLength(2)
  })

  test("不是表格的字节 ⇒ 抛错（由调用方落「有问题」）", () => {
    expect(() => readSheets(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow()
  })
})
