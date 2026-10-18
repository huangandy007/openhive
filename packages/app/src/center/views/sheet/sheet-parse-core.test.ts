import { describe, expect, test } from "bun:test"
import * as XLSX from "xlsx"
import type { 解析限制 } from "./sheet-model"
import { 解析工作簿, type 解析回调 } from "./sheet-parse-core"

function 工作簿字节(表: unknown[][], 名 = "明细"): Uint8Array<ArrayBuffer> {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(表), 名)
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }))
}

function 收集(): {
  回调: 解析回调
  meta: Parameters<解析回调["onMeta"]>[0][]
  chunks: { start: number; rows: (string | null)[][] }[]
  done: Parameters<解析回调["onDone"]>[]
  errors: Parameters<解析回调["onError"]>[]
} {
  const meta: Parameters<解析回调["onMeta"]>[0][] = []
  const chunks: { start: number; rows: (string | null)[][] }[] = []
  const done: Parameters<解析回调["onDone"]>[] = []
  const errors: Parameters<解析回调["onError"]>[] = []
  return {
    meta,
    chunks,
    done,
    errors,
    回调: {
      onMeta: (m) => meta.push(m),
      onChunk: (start, rows) => chunks.push({ start, rows }),
      onDone: (...args) => done.push(args),
      onError: (...args) => errors.push(args),
    },
  }
}

const 小限制 = (over: Partial<解析限制> = {}): 解析限制 => ({
  首屏行数: 2,
  预览行数: 3,
  预览列数: 2,
  全量行上限: 100,
  全量格上限: 1000,
  全量列上限: 4,
  分块行数: 2,
  ...over,
})

describe("解析：xlsx", () => {
  test("首屏 meta 带表头、总数、前 2 行；随后分块到 done", async () => {
    const 表 = [["姓名", "金额"], ["张三", "100"], ["李四", "200"], ["王五", "300"], ["赵六", "400"]]
    const c = 收集()
    await 解析工作簿(工作簿字节(表), c.回调, 小限制())

    expect(c.errors).toEqual([])
    expect(c.meta).toHaveLength(1)
    expect(c.meta[0].header).toEqual(["姓名", "金额"])
    expect(c.meta[0].totalRows).toBe(5)
    expect(c.meta[0].totalCols).toBe(2)
    expect(c.meta[0].preview).toEqual([["姓名", "金额"], ["张三", "100"], ["李四", "200"]])
    expect(c.chunks.map((x) => x.start)).toEqual([3])
    expect(c.chunks[0].rows).toEqual([["王五", "300"], ["赵六", "400"]])
    expect(c.done).toEqual([["full", { rows: 0, cols: 0 }]])
  })

  test("小表一次解析拿全：不回 chunk", async () => {
    const c = 收集()
    await 解析工作簿(工作簿字节([["姓名"], ["张三"], ["李四"]]), c.回调, 小限制({ 首屏行数: 10 }))
    expect(c.chunks).toEqual([])
    expect(c.done).toEqual([["full", { rows: 0, cols: 0 }]])
  })

  test("预览档：超过全量行上限只回前 3 数据行，并带 truncated rows", async () => {
    const 表 = [["姓名"], ...Array.from({ length: 8 }, (_, i) => [`第${i}行`])]
    const c = 收集()
    await 解析工作簿(工作簿字节(表), c.回调, 小限制({ 全量行上限: 2, 首屏行数: 2, 预览行数: 3 }))

    expect(c.meta[0].preview).toHaveLength(3) // 表头 + 2 数据行
    expect(c.chunks).toEqual([{ start: 3, rows: [["第2行"]] }])
    expect(c.done[0][0]).toBe("preview")
    expect(c.done[0][1].rows).toBe(9 - 4) // 总 9 行 - 实际物化 4 行（表头+3）
  })

  test("列截断：预览档 64 列上限可注入为 2", async () => {
    const c = 收集()
    await 解析工作簿(工作簿字节([["A", "B", "C"], ["1", "2", "3"]]), c.回调, 小限制({ 全量列上限: 2, 预览列数: 2 }))
    expect(c.meta[0].header).toEqual(["A", "B"])
    expect(c.meta[0].totalCols).toBe(3)
    expect(c.done[0][1].cols).toBe(1)
  })

  test("日期：xlsx 日期格输出规范串，不吐序列号", async () => {
    const c = 收集()
    const bytes = 工作簿字节([["姓名", "日期"], ["张三", new Date(Date.UTC(2026, 9, 1, 8, 30, 0))]])
    await 解析工作簿(bytes, c.回调, 小限制())
    const 文本 = c.meta[0].preview.flat().join("|")
    expect(文本).toContain("2026-10-01 08:30:00")
    expect(文本).not.toContain("46296")
  })

  test("CSV：UTF-8 中文不乱码；日期同样规范化", async () => {
    const c = 收集()
    await 解析工作簿(new TextEncoder().encode("姓名,日期\n张三,2026-10-01 08:30:00\n"), c.回调, 小限制())
    expect(c.meta[0].preview).toEqual([["姓名", "日期"], ["张三", "2026-10-01 08:30:00"]])
  })

  test("加密工作簿：onError(kind=password)", async () => {
    // 复用既有夹具；路径从 test 文件出发。
    const { 加密的Office容器 } = await import("../__fixtures__/office")
    const c = 收集()
    await 解析工作簿(加密的Office容器(["/encryption"]), c.回调, 小限制())
    expect(c.meta).toEqual([])
    expect(c.errors[0]?.[0]).toBe("password")
  })

  test("损坏的 zip：onError(kind=parse)", async () => {
    const c = 收集()
    await 解析工作簿(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), c.回调, 小限制())
    expect(c.errors[0]?.[0]).toBe("parse")
  })

  test("残缺行按最宽列补 null，列不错位", async () => {
    const c = 收集()
    await 解析工作簿(工作簿字节([["A", "B", "C"], ["只有一列"]]), c.回调, 小限制({ 首屏行数: 10 }))
    expect(c.meta[0].preview).toEqual([["A", "B", "C"], ["只有一列", null, null]])
  })

  test("HTML 内容原样当文本交回（渲染层负责按文本落 DOM）", async () => {
    const c = 收集()
    await 解析工作簿(工作簿字节([["<img src=x onerror=alert(1)>"]]), c.回调, 小限制())
    expect(c.meta[0].preview[0][0]).toBe("<img src=x onerror=alert(1)>")
  })
})
