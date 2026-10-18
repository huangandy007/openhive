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
  判档,
  查找命中,
  排序行,
  筛选行,
  type 列筛选,
  type Cell,
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

  test("JS Date 走 UTC getter：与进程时区无关", () => {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 夹具：只实现 从UTC日期 读取的 getter，故意让 UTC 与本地取值不同（TZ 无关）。
    const 假 = {
      getUTCFullYear: () => 2026, getUTCMonth: () => 0, getUTCDate: () => 2,
      getUTCHours: () => 3, getUTCMinutes: () => 4, getUTCSeconds: () => 5,
      getFullYear: () => 1999, getMonth: () => 11, getDate: () => 31,
      getHours: () => 23, getMinutes: () => 59, getSeconds: () => 59,
    } as unknown as Date
    expect(从UTC日期(假)).toEqual({ text: "2026-01-02 03:04:05", 含时间: true })
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

  test("日期列 ≥80% 即按日期处理：79% / 80% / 81% 边界", () => {
    const 日期 = (i: number) => `2026-10-${String((i % 28) + 1).padStart(2, "0")}`
    const 列 = (日期数: number) => [
      ...Array.from({ length: 日期数 }, (_, i) => 日期(i)),
      ...Array.from({ length: 100 - 日期数 }, () => "N/A"),
    ]
    expect(推断列类型(列(79))).toBe("text")
    expect(推断列类型(列(80))).toBe("date")
    expect(推断列类型(列(81))).toBe("date")
  })

  test("日期 + 数字混合列：日期占 80% 就按日期处理；数字仍要求 100%", () => {
    expect(
      推断列类型([
        "2026-10-01",
        "2026-10-02",
        "2026-10-03",
        "2026-10-04",
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
        "2026-10-08",
        "1200",
        "300",
      ]),
    ).toBe("date")
    // 数字未达 100% ⇒ 不按数字列；日期也没到 80% ⇒ 文本。
    expect(推断列类型(["1", "2", "3", "4", "5", "6", "7", "8", "9", "2026-10-01"])).toBe("text")
  })

  test("日期列含时间 ⇒ datetime（沿用「含时间比例 >0」语义）", () => {
    expect(
      推断列类型([
        "2026-10-01 08:30:00",
        "2026-10-02 08:30:00",
        "2026-10-03 08:30:00",
        "2026-10-04 08:30:00",
        "2026-10-05",
        "待补",
      ]),
    ).toBe("datetime")
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

const 行 = (): Cell[][] => [
  ["姓名", "金额", "日期"],
  ["张三", "1,200", "2026-10-01"],
  ["李四", "300", "2026-09-30"],
  ["王五", "", "2026-10-02"],
  ["赵六", "50", ""],
]

describe("判档", () => {
  test("10 万数据行（不含表头）是边界：=10 万全量，>10 万预览", () => {
    expect(判档(100_001, 10)).toBe("full")
    expect(判档(100_002, 10)).toBe("preview")
  })

  test("400 万格按数据格计（不含表头）：=400 万全量，>400 万预览", () => {
    // 注意 totalRows 含表头：100_001 行 = 100,000 数据行，与「全量行上限」同一口径。
    expect(判档(100_001, 40)).toBe("full") // 100,000 数据行 × 40 = 4,000,000 格 = 上限
    expect(判档(100_002, 40)).toBe("preview") // 100,001 数据行 ⇒ 行超限
    expect(判档(40_001, 100)).toBe("full") // 40,000 数据行 × 100 = 4,000,000 格 = 上限
    expect(判档(40_001, 101)).toBe("preview") // 4,040,000 格 > 400 万
  })

  test("行数没超但格数超，也预览（200 列 × 9 万行）", () => {
    expect(判档(90_001, 200)).toBe("preview")
  })

  test("限制可注入，测试不用造 10 万行", () => {
    expect(判档(5, 1, { 全量行上限: 2, 全量格上限: 100 })).toBe("preview")
  })
})

describe("排序", () => {
  const rows = 行()
  const 全部 = [1, 2, 3, 4]

  test("数字按数值，空值恒最后（升/降都一样）", () => {
    const 升 = 排序行(rows, 全部, 1, "asc", "number")
    expect(升).toEqual([4, 2, 1, 3]) // 50, 300, 1200, 空
    const 降 = 排序行(rows, 全部, 1, "desc", "number")
    expect(降).toEqual([1, 2, 4, 3]) // 1200, 300, 50, 空
  })

  test("日期按规范串字典序", () => {
    expect(排序行(rows, 全部, 2, "asc", "date")).toEqual([2, 1, 3, 4])
  })

  test("80% 日期列混入不可解析值：不抛错，无法解析的日期与空值恒排最后", () => {
    // 列类型推断会把这一列判成 date（8/10 可解析），但那 2 个非日期值不能参与字典序比较。
    const 混合: Cell[][] = [
      ["日期"],
      ["2026-10-03"],
      ["N/A"],
      ["2026-10-01"],
      [""],
      ["待补"],
      ["2026-10-02"],
    ]
    const 全部行 = [1, 2, 3, 4, 5, 6]
    // 升序：可解析日期在前（10-01 / 10-02 / 10-03），不可解析按原序，空白最后。
    expect(排序行(混合, 全部行, 0, "asc", "date")).toEqual([3, 6, 1, 2, 5, 4])
    // 降序只反转可解析日期，不可解析与空值仍最后（不被 `desc` 拉到前面）。
    expect(排序行(混合, 全部行, 0, "desc", "date")).toEqual([1, 6, 3, 2, 5, 4])
    expect(排序行(混合, 全部行, 0, "asc", "datetime")).toEqual([3, 6, 1, 2, 5, 4])
  })

  test("文本按中文 Collator，稳定", () => {
    const 文本 = 排序行(rows, [1, 2, 3, 4], 0, "asc", "text")
    expect(文本.map((i) => rows[i][0])).toEqual(["李四", "王五", "张三", "赵六"])
  })

  test("原始行下标不丢：排序只重排下标", () => {
    const 结果 = 排序行(rows, 全部, 1, "asc", "number")
    expect(结果).toHaveLength(4)
    expect(new Set(结果)).toEqual(new Set(全部))
  })
})

describe("筛选", () => {
  const rows = 行()
  const 全部 = [1, 2, 3, 4]

  test("无筛选返回全部", () => {
    expect(筛选行(rows, 全部, [])).toEqual(全部)
  })

  test("多列 AND", () => {
    const filters: 列筛选[] = [
      { kind: "contains", column: 0, text: "张" },
      { kind: "contains", column: 1, text: "200" },
    ]
    expect(筛选行(rows, 全部, filters)).toEqual([1])
    expect(筛选行(rows, 全部, [{ kind: "contains", column: 0, text: "张" }, { kind: "equals", column: 1, text: "300" }])).toEqual([])
  })

  test("包含/等于大小写不敏感；为空只命中空值", () => {
    expect(筛选行(rows, 全部, [{ kind: "equals", column: 1, text: "1200" }])).toEqual([]) // 原值是 "1,200"
    expect(筛选行(rows, 全部, [{ kind: "contains", column: 1, text: "1,2" }])).toEqual([1])
    expect(筛选行(rows, 全部, [{ kind: "blank", column: 1 }])).toEqual([3])
  })

  test("值清单过滤（精确匹配）+ 空白开关", () => {
    expect(筛选行(rows, 全部, [{ kind: "values", column: 0, values: ["张三", "李四"], includeBlank: false }])).toEqual([1, 2])
    expect(筛选行(rows, 全部, [{ kind: "values", column: 1, values: ["300"], includeBlank: true }])).toEqual([2, 3])
  })
})

describe("查找", () => {
  const rows = 行()
  const 全部 = [1, 2, 3, 4]

  test("只搜给定列，大小写不敏感，返回原始行下标", () => {
    expect(查找命中(rows, 全部, [0], "张")).toEqual([{ row: 1, col: 0 }])
    expect(查找命中(rows, 全部, [1], "1,2")).toEqual([{ row: 1, col: 1 }])
  })

  test("隐藏列不搜：调用方只传可见列", () => {
    expect(查找命中(rows, 全部, [], "张")).toEqual([])
  })

  test("空词返回空", () => {
    expect(查找命中(rows, 全部, [0], "   ")).toEqual([])
  })
})
