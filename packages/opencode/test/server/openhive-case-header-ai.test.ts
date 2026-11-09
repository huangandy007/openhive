import { describe, expect, test } from "bun:test"
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"
import { 合并模型结果, 建表头识别器, 需要模型 } from "../../src/server/openhive/case-header-ai"
import { detectMapping } from "../../src/server/openhive/case-mapping"

const 表头 = ["交易金额", "对方账卡", "摘要"]
const 行 = [
  ["1.00", "6222001", "转账"],
  ["2.00", "6222999", "消费"],
]

/**
 * 拦截模型：截获送进 `generateObject` 的完整 options（system + prompt）。
 * 构造方式与 `openhive-case-extract-ai.test.ts` 的夹具一致（`MockLanguageModelV3`），
 * 不另造第三种假模型。
 */
function 拦截模型() {
  const 收到: string[] = []
  /** 只收集 role=system 的文本：断言提示词内容时不能用整个 options（`responseFormat` 天然含 json）。 */
  const 系统: string[] = []
  const 结果: LanguageModelV3GenerateResult = {
    content: [{ type: "text", text: JSON.stringify({ 工作表: { Sheet1: { 列: { "0": "counterparty" } } } }) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  }
  const 模型 = new MockLanguageModelV3({
    doGenerate: async (options) => {
      收到.push(JSON.stringify(options))
      系统.push(
        (options.prompt ?? [])
          .filter((m) => m.role === "system")
          .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
          .join("\n"),
      )
      return 结果
    },
  })
  return { 模型, 收到, 系统 }
}

describe("触发判定", () => {
  test("关键字段缺失且未知列超 30% ⇒ 触发", () => {
    const r = detectMapping(表头, 行)
    expect(需要模型([r], [表头], [行])).toBe(true)
  })

  test("占比不触发、但存在未认领的金额形状列 ⇒ 由关键字段缺失触发", () => {
    const h = ["交易金额（万元）", "列A", "列B", "列C"]
    const r = [
      ["1.00", "甲", "乙", "丙"],
      ["2.00", "丁", "戊", "己"],
    ]
    // 1 / 4 = 0.25 ≤ 0.3：占比分支不触发，只能由「amount 未认领但整表有金额形状列」触发。
    expect(需要模型([detectMapping(h, r)], [h], [r])).toBe(true)
    // 同一表头把金额列换成文本 ⇒ 关键缺失与占比都不成立。
    const 文行 = [
      ["甲", "乙", "丙", "丁"],
      ["戊", "己", "庚", "辛"],
    ]
    expect(需要模型([detectMapping(h, 文行)], [h], [文行])).toBe(false)
  })

  test("备注/摘要/网点不计入分母：带「备注」触发，换成「列4」不触发", () => {
    const h = ["交易金额", "交易时间", "X", "备注"]
    const r = [["1.00", "2026-01-02 03:04:05", "62212001200", "甲"]]
    // 排除备注后 1 / 3 = 0.333 > 0.3。
    expect(需要模型([detectMapping(h, r)], [h], [r])).toBe(true)
    const h2 = ["交易金额", "交易时间", "X", "列4"]
    const r2 = [["1.00", "2026-01-02 03:04:05", "62212001200", "甲"]]
    // 不排除时 1 / 4 = 0.25 ≤ 0.3。
    expect(需要模型([detectMapping(h2, r2)], [h2], [r2])).toBe(false)
  })

  test("形状命中但不在本表候选集的列不计入「有形状未认领」", () => {
    // 话单表里的长数字列：只命中 counterparty 的账号形状，而 counterparty 不在话单候选集
    // ⇒ 模型填不进去，不该为它触发调用。修复前这里会因 1 / 3 > 0.3 触发。
    const h = ["通话时间", "主叫号码", "流水号"]
    const r = [["2026-01-02 03:04:05", "13800000000", "62220010001"]]
    const 基础 = detectMapping(h, r)
    expect(基础.columns[2]).toBeUndefined()
    expect(需要模型([基础], [h], [r])).toBe(false)
  })

  test("话单表的金额形状列不算关键缺失（amount 不在候选集）", () => {
    // 话单候选集没有 amount ⇒ 模型填不进去，不应为「amount 缺失」触发调用（R27）。
    const h = ["通话时间", "主叫号码", "费用"]
    const r = [["2026-01-02 03:04:05", "13800000000", "1.00"]]
    const 基础 = detectMapping(h, r)
    expect(基础.columns[2]).toBeUndefined()
    expect(需要模型([基础], [h], [r])).toBe(false)
  })

  test("形状不符的待确认不值得触发（模型用同一 0.9 阈值，注定失败）", () => {
    // 别名把列指向 amount，但值不是两位小数 ⇒ 待确认「形状不符」；模型合并时同样过不了。
    const h = ["流水金额", "备注"]
    const r = [["10000", "甲"]]
    const 基础 = detectMapping(h, r, { 别名: new Map([["流水金额", "amount"]]) })
    expect(基础.待确认.some((项) => 项.原因 === "形状不符")).toBe(true)
    expect(需要模型([基础], [h], [r])).toBe(false)
  })
})

describe("模型结果合并", () => {
  test("只填未认领列，不覆盖规则结果", () => {
    const 基础 = detectMapping(表头, 行)
    const 合并 = 合并模型结果(表头, 行, 基础, { 1: "counterparty", 0: "balance" })
    expect(合并.columns[1]).toBe("counterparty")
    expect(合并.columns[0]).toBe("amount") // 规则已认领，模型不许覆盖
    expect(合并.来源[1]).toBe("模型")
  })

  test("模型给的非法字段名/形状不符 ⇒ 丢弃", () => {
    const 基础 = detectMapping(表头, 行)
    expect(合并模型结果(表头, 行, 基础, { 1: "不存在的字段" }).columns[1]).toBeUndefined()
    expect(合并模型结果(表头, 行, 基础, { 2: "counterparty" }).columns[2]).toBeUndefined()
  })

  test("万元列不会被模型当 amount（单位闸）", () => {
    const h = ["交易金额（万元）", "对方账号"]
    const r = [
      ["1.00", "62220012001"],
      ["2.00", "62229999999"],
    ]
    const 基础 = detectMapping(h, r)
    const 合并 = 合并模型结果(h, r, 基础, { 0: "amount" })
    expect(合并.columns[0]).toBeUndefined()
    expect(合并.待确认.some((项) => 项.列号 === 0 && 项.原因 === "单位冲突")).toBe(true)
  })

  test("无词典词但声明万元的列也过不了单位闸（不靠待确认兜）", () => {
    // 「B（万元）」没有任何词典词 ⇒ detectMapping 不认领也不记待确认；
    // 模型建议 amount 时只能由合并层自己的单位闸拦住。
    const h = ["B（万元）", "对方账号"]
    const r = [
      ["1.00", "62220012001"],
      ["2.00", "62229999999"],
    ]
    const 基础 = detectMapping(h, r)
    expect(基础.columns[0]).toBeUndefined()
    expect(基础.待确认).toEqual([])
    expect(合并模型结果(h, r, 基础, { 0: "amount" }).columns[0]).toBeUndefined()
  })

  test("别名跨字段集只能人工确认 ⇒ 模型不许填，待确认必须还在", () => {
    // 用户自己下发的别名把「对方号码」指向 callee，而资金候选集没有 callee ⇒ 别名跨字段集。
    // 模型建议 counterparty 虽然形状/候选集都能过，但不能替用户悄悄改掉这个冲突（R26）。
    const h = ["交易金额", "对方号码"]
    const r = [
      ["1.00", "62220012001"],
      ["2.00", "62229999999"],
    ]
    const 基础 = detectMapping(h, r, { 别名: new Map([["对方号码", "callee"]]) })
    expect(基础.待确认.some((项) => 项.列号 === 1 && 项.原因 === "别名跨字段集")).toBe(true)
    const 合并 = 合并模型结果(h, r, 基础, { 1: "counterparty" })
    expect(合并.columns[1]).toBeUndefined()
    expect(合并.待确认.some((项) => 项.列号 === 1 && 项.原因 === "别名跨字段集")).toBe(true)
  })

  test("表头重名只能人工确认 ⇒ 模型不许填", () => {
    const h = ["金额", "金额"]
    const r = [["1.00"], ["2.00"]]
    const 基础 = detectMapping(h, r, { 别名: new Map([["金额", "amount"]]) })
    expect(基础.待确认.filter((项) => 项.原因 === "表头重名").length).toBe(2)
    expect(合并模型结果(h, r, 基础, { 0: "amount" }).columns[0]).toBeUndefined()
  })

  test("模型填上的列，它的待确认条目被移除，其余保留", () => {
    // 两列都精确命中 counterparty ⇒ detectMapping 记两条「候选不唯一」。
    const h = ["对方账号", "对方卡号"]
    const r = [["62220012001", "62229999999"]]
    const 基础 = detectMapping(h, r)
    expect(基础.待确认.map((项) => 项.列号)).toEqual([0, 1])
    const 合并 = 合并模型结果(h, r, 基础, { 0: "counterparty" })
    expect(合并.columns[0]).toBe("counterparty")
    expect(合并.待确认.map((项) => 项.列号)).toEqual([1])
  })

  test("模型建议正好落在单位冲突列 ⇒ 该列不填、待确认原样保留（R31）", () => {
    const h = ["交易金额（万元）", "对方别名"]
    const r = [
      ["1.00", "62220012001"],
      ["2.00", "62229999999"],
    ]
    const 基础 = detectMapping(h, r)
    expect(基础.待确认.some((项) => 项.列号 === 0 && 项.原因 === "单位冲突")).toBe(true)
    const 合并 = 合并模型结果(h, r, 基础, { 0: "amount" })
    expect(合并.columns[0]).toBeUndefined()
    expect(合并.待确认).toEqual(基础.待确认)
  })

  test("模型把话单字段填进资金表 ⇒ 丢弃（候选集过滤）", () => {
    const 资金表头 = ["交易金额", "联系电话"]
    const 资金行 = [
      ["1.00", "13800000000"],
      ["2.00", "13900000000"],
    ]
    const 基础 = detectMapping(资金表头, 资金行)
    // 形状能过（11 位手机号），但 callee 不在资金候选集里
    expect(合并模型结果(资金表头, 资金行, 基础, { 1: "callee" }).columns[1]).toBeUndefined()
  })

  test("同一字段被建议到多列 ⇒ 只落第一列", () => {
    const 双账号表头 = ["交易金额", "列A", "列B"]
    const 双账号行 = [["1.00", "62220010001", "62229998888"]]
    const 基础 = detectMapping(双账号表头, 双账号行)
    const 合并 = 合并模型结果(双账号表头, 双账号行, 基础, { 1: "counterparty", 2: "counterparty" })
    expect(合并.columns[1]).toBe("counterparty")
    expect(合并.columns[2]).toBeUndefined()
  })

  test("字段已被规则认领 ⇒ 模型不能把它再落到另一列（已用初值）", () => {
    const h = ["对方账号", "列B"]
    const r = [["62220012001", "62229999999"]]
    const 基础 = detectMapping(h, r)
    expect(基础.columns[0]).toBe("counterparty")
    expect(合并模型结果(h, r, 基础, { 1: "counterparty" }).columns[1]).toBeUndefined()
  })

  test("unknownColumns 按合并后的 columns 重算", () => {
    const 基础 = detectMapping(表头, 行)
    expect(基础.unknownColumns).toEqual([1, 2])
    const 合并 = 合并模型结果(表头, 行, 基础, { 1: "counterparty" })
    expect(合并.unknownColumns).toEqual([2])
    expect(合并.method).toBe(基础.method) // 方法由来源判定，合并层不动
  })
})

describe("模型请求组装", () => {
  test("system 提示词里含 json 与 0 基列号要求（不是 responseFormat 的 json）", async () => {
    const { 模型, 系统 } = 拦截模型()
    await 建表头识别器(模型, { 脱敏: false })({
      工作表: [{ 名: "Sheet1", 表头, 样例: 行 }],
      候选字段: ["counterparty"],
    })
    expect(系统[0].toLowerCase()).toContain("json")
    expect(系统[0]).toContain("列号是 0 开始的下标")
  })

  test("payload 逐列给列号，并写明 0 基", async () => {
    const { 模型, 收到 } = 拦截模型()
    await 建表头识别器(模型, { 脱敏: false })({
      工作表: [{ 名: "Sheet1", 表头, 样例: 行 }],
      候选字段: ["counterparty"],
    })
    expect(收到[0]).toContain('\\"列号\\":0') // 每列显式带下标（不是只给顺序）
    expect(收到[0]).toContain('\\"列号\\":2')
    expect(收到[0]).toContain("0 开始")
  })
})

describe("脱敏开关", () => {
  test("默认原文；打开后 11 位账号按 9–11 位档脱敏", async () => {
    const 行11 = [
      ["1.00", "62220012001", "转账"],
      ["2.00", "62229999999", "消费"],
    ]
    const { 模型, 收到 } = 拦截模型()
    const 识别 = 建表头识别器(模型, { 脱敏: false })
    await 识别({ 工作表: [{ 名: "Sheet1", 表头, 样例: 行11 }], 候选字段: ["counterparty"] })
    expect(收到.join()).toContain("62220012001") // 默认原文

    收到.length = 0
    const 脱敏识别 = 建表头识别器(模型, { 脱敏: true })
    await 脱敏识别({ 工作表: [{ 名: "Sheet1", 表头, 样例: 行11 }], 候选字段: ["counterparty"] })
    const 请求 = 收到.join()
    expect(请求).not.toContain("62220012001")
    expect(请求).toContain("622****01") // 首 3 + **** + 末 2
    expect(请求).toContain("622****99")
  })

  test("脱敏分三档给出确切结果（12+ / 9–11 / ≤8 位）", async () => {
    const h = ["账号"]
    const 行档 = [["622200120011"], ["622200120"], ["62220012"], ["6222001"]]
    const { 模型, 收到 } = 拦截模型()
    await 建表头识别器(模型, { 脱敏: true })({
      工作表: [{ 名: "Sheet1", 表头: h, 样例: 行档 }],
      候选字段: ["counterparty"],
    })
    const 请求 = 收到.join()
    expect(请求).toContain("6222****0011") // 12 位：首 4 + **** + 末 4
    expect(请求).toContain("622****20") // 9 位：首 3 + **** + 末 2
    expect(请求).toContain('\\"****\\"') // 8 位与 7 位：整串 ****（不泄漏位数）
    for (const 原 of ["622200120011", "622200120", "62220012", "6222001"]) expect(请求).not.toContain(原)
  })

  test("脱敏兜住国码手机、7 位账号、5 字姓名", async () => {
    const 行混合 = [
      ["1.00", "+8613800138000", "欧阳修文华"],
      ["2.00", "6222001", "张三"],
    ]
    const { 模型, 收到 } = 拦截模型()
    await 建表头识别器(模型, { 脱敏: true })({
      工作表: [{ 名: "Sheet1", 表头, 样例: 行混合 }],
      候选字段: ["counterparty"],
    })
    const 请求 = 收到.join()
    expect(请求).not.toContain("+8613800138000")
    expect(请求).not.toContain("6222001")
    expect(请求).not.toContain("欧阳修文华")
    expect(请求).toContain("138****00") // 剥 +86 后 11 位 → 9–11 档
    expect(请求).toContain("欧**")
    expect(请求).toContain("张**")
  })
})
