import { describe, expect, test } from "bun:test"
import { 可解析扩展名, 可解析表格 } from "../../src/server/openhive/case-parseable"

/**
 * 表格白名单是**跨三个调用点**的一条判据：上传自动入队（`file.ts`）、右键入队（`case-parse.ts`）、
 * 材料视图的 `parseable`（`case-materials.ts`）。三处各写一份 `.endsWith` 就会各自长，
 * 所以这条用例钉的是「只有一份」这件事本身。
 */
describe("表格扩展名白名单（计划 2 的唯一一份）", () => {
  test("三种表格扩展名都认，大小写不敏感", () => {
    expect(可解析表格("a.xlsx")).toBe(true)
    expect(可解析表格("A.XLSX")).toBe(true)
    expect(可解析表格("资料/话单.xls")).toBe(true)
    expect(可解析表格("资料/流水.CSV")).toBe(true)
  })

  test("非表格一律不认——包括「看着像表格」的后缀", () => {
    for (const path of ["a.pdf", "a.docx", "a.txt", "a.xlsx.bak", "xlsx", "a.xlsx ", "a.xlsm"]) {
      expect(可解析表格(path), path).toBe(false)
    }
  })

  test("扩展名清单就是这三个（前端与出口都读它）", () => {
    expect([...可解析扩展名]).toEqual([".xlsx", ".xls", ".csv"])
  })
})
