import { describe, expect, test } from "bun:test"
import {
  可解析扩展名,
  可解析材料,
  可解析表格,
  文本扩展名,
  表格扩展名,
  解析方式,
} from "../../src/server/openhive/case-parseable"

describe("可解析材料白名单（全仓唯一一份）", () => {
  test("表格三种照旧", () => {
    expect(可解析表格("a.xlsx")).toBe(true)
    expect(可解析表格("A.XLSX")).toBe(true)
    expect(可解析表格("资料/话单.xls")).toBe(true)
    expect(可解析表格("资料/流水.CSV")).toBe(true)
  })

  test("文本四种：大小写不敏感", () => {
    expect(解析方式("资料/笔录.txt")).toBe("文本")
    expect(解析方式("资料/笔录.TXT")).toBe("文本")
    expect(解析方式("说明.md")).toBe("文本")
    expect(解析方式("运行.LOG")).toBe("文本")
    expect(解析方式("讯问笔录.docx")).toBe("文本")
  })

  test("表格与文本互不串", () => {
    expect(解析方式("a.csv")).toBe("表格")
    expect(解析方式("a.docx")).toBe("文本")
    expect(可解析表格("a.docx")).toBe(false)
    expect(可解析表格("a.txt")).toBe(false)
  })

  test("认不出的后缀一律不认——包括「看着像」的", () => {
    for (const path of ["a.pdf", "a.jpg", "a.xlsx.bak", "xlsx", "a.txt ", "a.doc", "a.docx.bak"]) {
      expect(解析方式(path), path).toBeUndefined()
      expect(可解析材料(path), path).toBe(false)
    }
  })

  test("对外清单＝表格 ∪ 文本（前端读它决定「系统解不解析」）", () => {
    expect([...可解析扩展名]).toEqual([...表格扩展名, ...文本扩展名])
    for (const 扩展名 of 表格扩展名) expect(解析方式("a" + 扩展名)).toBe("表格")
    for (const 扩展名 of 文本扩展名) expect(解析方式("a" + 扩展名)).toBe("文本")
  })
})
