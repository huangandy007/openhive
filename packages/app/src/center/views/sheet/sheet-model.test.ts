import { describe, expect, test } from "bun:test"
import {
  从UTC日期,
  从文本日期,
  列标,
  估算列宽,
  拖拽后列宽,
  是加密工作簿,
  格式化日期,
  推断列类型,
  文本宽,
  规模,
  行上界,
  列上界,
} from "./sheet-model"

describe("列标", () => {
  test("0→A、25→Z、26→AA、701→ZZ、702→AAA", () => {
    expect(列标(0)).toBe("A")
    expect(列标(25)).toBe("Z")
    expect(列标(26)).toBe("AA")
    expect(列标(701)).toBe("ZZ")
    expect(列标(702)).toBe("AAA")
  })
})

describe("列宽", () => {
  test("全角按 13px、半角按 7px 估算，加 16px 内边距", () => {
    expect(文本宽("张三")).toBe(26)
    expect(文本宽("abc")).toBe(21)
    expect(文本宽("张a")).toBe(20)
  })

  test("初始宽度钳制在 [64, 320]", () => {
    expect(估算列宽("", [])).toBe(规模.列初始最小宽)
    // 内容宽 26 + 内边距 16 = 42，低于下限 ⇒ 钳到 64
    expect(估算列宽("姓名", ["张三", "李四"])).toBe(规模.列初始最小宽)
  })

  test("超长内容钳到 320", () => {
    expect(估算列宽("表头", ["一".repeat(100)])).toBe(规模.列初始最大宽)
  })

  test("拖拽后列宽钳制在 [48, 800] 并取整", () => {
    expect(拖拽后列宽(100, 50.4)).toBe(150)
    expect(拖拽后列宽(100, -1000)).toBe(规模.列最小宽)
    expect(拖拽后列宽(100, 1000)).toBe(规模.列最大宽)
  })
})

describe("日期文本", () => {
  test("纯日期格式化", () => {
    expect(格式化日期({ y: 2026, m: 10, d: 1, H: 0, M: 0, S: 0 }, false)).toBe("2026-10-01")
  })

  test("带时间格式化补零", () => {
    expect(格式化日期({ y: 2026, m: 10, d: 1, H: 8, M: 3, S: 4 }, true)).toBe("2026-10-01 08:03:04")
  })

  test("2026/10/1、2026-10-01 08:30:00、2026.10.01 都认", () => {
    expect(从文本日期("2026/10/1")).toEqual({ text: "2026-10-01", 含时间: false })
    expect(从文本日期("2026-10-01 08:30:00")).toEqual({ text: "2026-10-01 08:30:00", 含时间: true })
    expect(从文本日期("2026.10.01")).toEqual({ text: "2026-10-01", 含时间: false })
  })

  test("不是日期的文本不猜", () => {
    expect(从文本日期("张三")).toBeUndefined()
    expect(从文本日期("2026-13-01")).toBeUndefined()
    expect(从文本日期("2026-10-32")).toBeUndefined()
    expect(从文本日期("2026-10-01 25:00:00")).toBeUndefined()
  })

  test("JS Date 走 UTC getter，零时区平移", () => {
    // SheetJS 的 Date 口径是 UTC；用 UTC 取分量才不会在东八区读出 +8 小时。
    expect(从UTC日期(new Date(Date.UTC(2026, 9, 1, 8, 30, 0)))).toEqual({
      text: "2026-10-01 08:30:00",
      含时间: true,
    })
    expect(从UTC日期(new Date(Date.UTC(2026, 9, 1)))).toEqual({ text: "2026-10-01", 含时间: false })
  })
})

describe("列类型推断", () => {
  test("数字/日期/日期时间/文本", () => {
    expect(推断列类型(["1,200", "300", "50"])).toBe("number")
    expect(推断列类型(["2026-10-01", "2026/9/30"])).toBe("date")
    expect(推断列类型(["2026-10-01 08:30:00"])).toBe("datetime")
    expect(推断列类型(["张三", "1"])).toBe("text")
    expect(推断列类型([null, "", "  "])).toBe("text")
  })
})

describe("规模常量", () => {
  test("行上界/列上界与预览档一致", () => {
    expect(行上界).toBe(1000)
    expect(列上界).toBe(64)
    expect(规模.全量行上限).toBe(100_000)
    expect(规模.全量格上限).toBe(4_000_000)
    expect(规模.全量列上限).toBe(256)
  })
})

describe("认「加密的工作簿」的说法", () => {
  test("SheetJS 那几条要密码的说法都认", () => {
    expect(是加密工作簿(new Error("File is password-protected"))).toBe(true)
    expect(是加密工作簿(new Error("File is password-protected: ECMA-376 Extensible"))).toBe(true)
    expect(是加密工作簿(new Error("Unsupported password protection"))).toBe(true)
    expect(是加密工作簿(new Error("Password is incorrect"))).toBe(true)
  })

  test("别的失败不认；非 Error 不认", () => {
    expect(是加密工作簿(new Error("Cannot find Workbook stream"))).toBe(false)
    expect(是加密工作簿(new Error("Unsupported ZIP file"))).toBe(false)
    expect(是加密工作簿("File is password-protected")).toBe(false)
    expect(是加密工作簿(undefined)).toBe(false)
  })
})
