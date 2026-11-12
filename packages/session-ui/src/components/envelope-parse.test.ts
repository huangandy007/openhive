import { describe, expect, test } from "bun:test"
import { 工具名文本, 数据字节数, 数据行数, 信封工具名, 解析工具输出, 是信封工具键 } from "./envelope-parse"

const 信封文本 = (值: unknown) => JSON.stringify(值)

describe("解析工具输出", () => {
  test("完整七字段信封 → 种类 信封，字段逐一取到", () => {
    const 结果 = 解析工具输出(
      信封文本({
        摘要: "取到 2 行明细",
        数据: [{ 定位: "m-甲#表#1" }, { 定位: "m-甲#表#2" }],
        口径: "按时间升序",
        缺口: ["已按 30 KB 上限只取前 2 行"],
        空原因: null,
        出处: [{ 事实: "转账 100 元", 代表: "m-甲#表#1", 可下钻: "get_citation" }],
        下一步: [{ 工具: "query_rows", 参数: { 游标: "abc" }, 为什么: "还有下一页" }],
      }),
    )
    if (结果.种类 !== "信封") throw new Error("应为信封")
    expect(结果.信封.摘要).toBe("取到 2 行明细")
    expect(结果.信封.口径).toBe("按时间升序")
    expect(结果.信封.缺口).toEqual(["已按 30 KB 上限只取前 2 行"])
    expect(结果.信封.空原因).toBeNull()
    expect(结果.信封.出处[0]!.代表).toBe("m-甲#表#1")
    expect(结果.信封.下一步[0]!.工具).toBe("query_rows")
  })

  test("工具错误 → 种类 工具错误，错误码与消息都取到", () => {
    const 结果 = 解析工具输出(信封文本({ error: "bad_input", message: "缺少必填参数：材料" }))
    if (结果.种类 !== "工具错误") throw new Error("应为工具错误")
    expect(结果.错误码).toBe("bad_input")
    expect(结果.消息).toBe("缺少必填参数：材料")
  })

  test("非信封：空串 / 非 JSON / 数组 / 无摘要对象 / 非字符串 都不冒充信封", () => {
    for (const 值 of ["", "  ", "not json", "[1,2,3]", 信封文本({ 数据: [] }), undefined, null, 42]) {
      expect(解析工具输出(值).种类).toBe("非信封")
    }
  })

  test("缺字段容错：只有 摘要 + 数据 + 口径 时，其余取默认值而不是整体判非信封", () => {
    const 结果 = 解析工具输出(信封文本({ 摘要: "旧实现返回", 数据: [], 口径: "降级" }))
    if (结果.种类 !== "信封") throw new Error("应为信封")
    expect(结果.信封.缺口).toEqual([])
    expect(结果.信封.出处).toEqual([])
    expect(结果.信封.下一步).toEqual([])
    expect(结果.信封.空原因).toBeNull()
  })

  test("类型错容错：缺口非数组 ⇒ 空数组；空原因非字符串 ⇒ null；数据缺失 ⇒ null", () => {
    const 结果 = 解析工具输出(信封文本({ 摘要: "x", 数据: undefined, 口径: "y", 缺口: "不是数组", 空原因: 7 }))
    if (结果.种类 !== "信封") throw new Error("应为信封")
    expect(结果.信封.缺口).toEqual([])
    expect(结果.信封.空原因).toBeNull()
    expect(结果.信封.数据).toBeNull()
  })

  test("出处 / 下一步 的元素形状不合法时逐个丢弃，不炸", () => {
    const 结果 = 解析工具输出(
      信封文本({ 摘要: "x", 数据: [], 口径: "y", 出处: [{ 事实: 1 }, null, { 事实: "真实" }], 下一步: ["坏", { 工具: 5 }] }),
    )
    if (结果.种类 !== "信封") throw new Error("应为信封")
    expect(结果.信封.出处.map((条) => 条.事实)).toEqual(["真实"])
    expect(结果.信封.下一步).toEqual([])
  })
})

describe("数据行数 / 数据字节数", () => {
  test("数组给长度，对象与 null 给 null", () => {
    expect(数据行数([1, 2, 3])).toBe(3)
    expect(数据行数({ 汇总: 1 })).toBeNull()
    expect(数据行数(null)).toBeNull()
    expect(数据行数(undefined)).toBeNull()
  })

  test("字节数按 UTF-8 算（中文 3 字节），null 记 0", () => {
    expect(数据字节数("汉")).toBe(5) // JSON 序列化带引号：`"汉"` = 1 + 3 + 1
    expect(数据字节数([1, 2])).toBe(5) // `[1,2]`
    expect(数据字节数(null)).toBe(0)
    expect(数据字节数(undefined)).toBe(0)
  })
})

describe("是信封工具键", () => {
  test("只要 openhive-case_ 前缀，八个工具都算，其它不算", () => {
    for (const 名 of [
      "search_materials",
      "query_entities",
      "query_relations",
      "query_events",
      "aggregate_money",
      "find_crossings",
      "get_citation",
      "query_rows",
    ])
      expect(是信封工具键(`openhive-case_${名}`)).toBe(true)
    expect(是信封工具键("bash")).toBe(false)
    expect(是信封工具键("openhive-case")).toBe(false)
    expect(是信封工具键("mcp_other_query_rows")).toBe(false)
  })
})

describe("信封工具名", () => {
  test("八个 openhive-case_ 键逐个剥掉前缀，得到裸工具名", () => {
    expect(信封工具名("openhive-case_search_materials")).toBe("search_materials")
    expect(信封工具名("openhive-case_query_entities")).toBe("query_entities")
    expect(信封工具名("openhive-case_query_relations")).toBe("query_relations")
    expect(信封工具名("openhive-case_query_events")).toBe("query_events")
    expect(信封工具名("openhive-case_aggregate_money")).toBe("aggregate_money")
    expect(信封工具名("openhive-case_find_crossings")).toBe("find_crossings")
    expect(信封工具名("openhive-case_get_citation")).toBe("get_citation")
    expect(信封工具名("openhive-case_query_rows")).toBe("query_rows")
  })

  test("不是信封工具键时原样返回", () => {
    expect(信封工具名("search_materials")).toBe("search_materials")
    expect(信封工具名("")).toBe("")
  })
})

describe("工具名文本", () => {
  test("工具名文本：信封键取到译文", () => {
    const 译文表: Record<string, string> = { "ui.envelopeTool.tool.find_crossings": "Find crossings" }
    const t = (键: string) => 译文表[键] ?? 键
    expect(工具名文本(t, "openhive-case_find_crossings")).toBe("Find crossings")
  })

  test("工具名文本：无译文时显示裸工具名，不显示内部键", () => {
    const t = (键: string) => 键
    expect(工具名文本(t, "openhive-case_query_rows")).toBe("query_rows")
  })

  test("工具名文本：无前缀键也照常取译文", () => {
    const 译文表: Record<string, string> = { "ui.envelopeTool.tool.query_rows": "Query rows" }
    const t = (键: string) => 译文表[键] ?? 键
    expect(工具名文本(t, "query_rows")).toBe("Query rows")
  })
})
