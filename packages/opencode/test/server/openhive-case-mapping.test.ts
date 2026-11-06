import { describe, expect, test } from "bun:test"
import {
  classifyMaterialType,
  detectMapping,
  formatFingerprint,
  type FactField,
} from "../../src/server/openhive/case-mapping"

describe("detectMapping · 第一层：表头词典", () => {
  test("话单表头逐个对上", () => {
    const r = detectMapping(
      ["主叫号码", "被叫号码", "通话时间", "通话时长", "基站"],
      [["13800000000", "13900000000", "2026-01-02 03:04:05", "37", "HZ-01"]],
    )
    expect(r.method).toBe("词典")
    expect(r.columns).toEqual({ 0: "caller", 1: "callee", 2: "startedAt", 3: "durationSec" })
    expect(r.unknownColumns).toEqual([4])
  })

  test("资金表头对上金额与余额", () => {
    const r = detectMapping(
      ["交易时间", "交易金额", "余额", "对方账号", "摘要"],
      [["2026-01-02 03:04:05", "-1234.50", "5000.00", "6222001", "转账"]],
    )
    expect(r.columns).toEqual({ 0: "startedAt", 1: "amount", 2: "balance", 3: "counterparty" })
    expect(r.unknownColumns).toEqual([4])
  })

  test("表头带空格/全角括号也能对上（规范后再比）", () => {
    const r = detectMapping([" 主叫号码 ", "被叫 号码", "金额（元）"], [["1", "2", "3.00"]])
    expect(r.columns).toEqual({ 0: "caller", 1: "callee", 2: "amount" })
  })

  test("同一个字段只认第一个命中列，不重复占", () => {
    const r = detectMapping(["主叫号码", "被叫号码", "本机号码"], [["1", "2", "3"]])
    expect(r.columns[0]).toBe("caller")
    expect(r.columns[2]).toBeUndefined()
    expect(r.unknownColumns).toEqual([2])
  })

  test("复合表头按后缀认：「主叫通话时长」是时长，不是主叫", () => {
    // 包含匹配会把 col0 认成 caller（「主叫」是它的词），时长列就此静默消失。
    const r = detectMapping(["主叫通话时长", "通话时间"], [["37", "2026-01-02 03:04:05"]])
    expect(r.columns).toEqual({ 0: "durationSec", 1: "startedAt" })
  })

  test("两列都以后缀命中同一字段 ⇒ 消歧不了就不认", () => {
    const r = detectMapping(["主叫通话时长", "被叫通话时长"], [["37", "83"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0, 1])
  })

  test("「通话分钟」不认——裸数字按秒解释会差 60 倍（R24）", () => {
    // parseDuration 对裸数字只能按秒解释；表头明说「分钟」时 5 会被落成 5 秒。
    // 误认比漏认糟：不认该列 ⇒ 原值进 extras，前端可手工修正（计划 3）。
    const r = detectMapping(["通话分钟"], [["5"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0])
  })

  test("括号里的单位不是默认单位 ⇒ 该列对该字段不认（R25b）", () => {
    // 规范化会剥掉括号后缀，不拦的话「通话时长（分钟）」仍被认成 durationSec，
    // 5 落成 5 秒（60 倍错）——R24 的同一前提，换了个表头写法。
    for (const 表头 of ["通话时长（分钟）", "通话时长(分钟)", "时长(分钟)"]) {
      const r = detectMapping([表头], [["5"]])
      expect(r.columns).toEqual({})
      expect(r.unknownColumns).toEqual([0])
    }
  })

  test("金额/余额以万元为单位 ⇒ 不认（剥括号按元落库会错 10000 倍，R25b）", () => {
    for (const 表头 of ["交易金额（万元）", "余额(万元)"]) {
      const r = detectMapping([表头], [["10000"]])
      expect(r.columns).toEqual({})
      expect(r.unknownColumns).toEqual([0])
    }
  })

  test("括号里是默认单位 ⇒ 照常认，闸不是把带括号的全掐掉（R25b）", () => {
    expect(detectMapping(["通话时长(秒)"], [["37"]]).columns).toEqual({ 0: "durationSec" })
    expect(detectMapping(["金额（元）"], [["3.00"]]).columns).toEqual({ 0: "amount" })
  })
})

describe("单位声明白名单（I1：黑名单漏掉的分/角/美元会静默错倍）", () => {
  // 括号内容对 durationSec / amount / balance 是**单位声明**：只放行白名单里的默认单位。
  // 黑名单挡不住「分」「角」「美元」「含手续费」——认成默认单位会静默错 60 / 10 / 汇率倍，
  // 而且因为「解析成功」，原文连 extras 都进不去。宁可整列不认，原值进 extras。
  const 不认: [string, string][] = [
    ["通话时长（分）", "分 = 60 秒"],
    ["通话时长(分钟)", "半角括号；黑名单已覆盖，白名单不能因它退化成黑名单"],
    ["时长（小时）", "小时 = 3600 秒"],
    ["时长（毫秒）", "毫秒 = 1/1000 秒"],
    ["金额（美元）", "币种不同"],
    ["金额(角)", "角 = 0.1 元"],
    ["金额（万元）", "万元 = 10000 元"],
    ["金额（千元）", "千元 = 1000 元"],
    ["余额（分）", "余额同样走金额单位"],
    ["金额（含手续费）", "括号里不是单位也算「说不清」⇒ 不认"],
  ]
  for (const [表头, 为什么] of 不认) {
    test(`${表头} ⇒ 不认（${为什么}），原值留给 extras`, () => {
      const 值 = 表头.includes("金额") || 表头.includes("余额") ? "5.00" : "5"
      const r = detectMapping([表头], [[值]])
      expect(r.columns).toEqual({})
      expect(r.unknownColumns).toEqual([0])
    })
  }

  const 认: [string, FactField][] = [
    ["通话时长（秒）", "durationSec"],
    ["金额（元）", "amount"],
    ["金额（人民币）", "amount"],
    ["金额(元)", "amount"],
    ["余额（RMB）", "balance"],
  ]
  for (const [表头, field] of 认) {
    test(`${表头} ⇒ 照常认成 ${field}`, () => {
      const 值 = field === "durationSec" ? "5" : "5.00"
      expect(detectMapping([表头], [[值]]).columns).toEqual({ 0: field })
    })
  }

  test("无单位概念的字段不受白名单波及：主叫号码（本地）仍是 caller", () => {
    // 白名单只针对「有默认单位」的三个字段。给 caller 也套单位闸会误伤正常表头。
    expect(detectMapping(["主叫号码（本地）"], [["13800000000"]]).columns).toEqual({ 0: "caller" })
  })

  test("特征层金额候选同样受白名单管：金额（美元）整列两位小数也不认（I1 落点清完）", () => {
    // 词典层被拦下的列若只靠形状仍会被认回 amount ⇒ 静默错倍。三道认路必须共用同一道闸。
    const r = detectMapping(["金额（美元）"], [["5.00"], ["6.00"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0])
  })
})

describe("单位声明的全部写法（I1 残余：只在圆括号生效会漏网）", () => {
  // 复审实测：单位闸只认 `（）`/`()`，下面这些写法全部被认成默认单位——静默错倍/错汇率，
  // 而且因为「解析成功」，原文连 extras 都进不去。单位声明必须覆盖全部括号对 ＋ 裸后缀。
  const 不认: [string, string][] = [
    ["金额【美元】", "方头括号"],
    ["金额[美元]", "半角方括号"],
    ["金额〔美元〕", "六角括号"],
    ["金额美元", "裸后缀（无括号）"],
    ["金额USD", "裸后缀、大小写不敏感"],
    ["金额（元）（分）", "多组括号：任一组不是默认单位就不认"],
    ["通话时长[毫秒]", "全角/半角方括号都要管到时长的单位"],
  ]
  for (const [表头, 为什么] of 不认) {
    test(`${表头} ⇒ 不认（${为什么}），原值留给 extras`, () => {
      const 值 = 表头.includes("金额") ? "5.00" : "5"
      const r = detectMapping([表头], [[值]])
      expect(r.columns).toEqual({})
      expect(r.unknownColumns).toEqual([0])
    })
  }

  const 认: [string, FactField][] = [
    ["金额（人民币）", "amount"],
    ["金额rmb", "amount"],
    ["金额（元）", "amount"],
    ["金额CNY", "amount"],
    ["金额元", "amount"],
    ["通话时长（秒）", "durationSec"],
    ["通话时长sec", "durationSec"],
  ]
  for (const [表头, field] of 认) {
    test(`${表头} ⇒ 照常认成 ${field}`, () => {
      const 值 = field === "durationSec" ? "5" : "5.00"
      expect(detectMapping([表头], [[值]]).columns).toEqual({ 0: field })
    })
  }

  test("特征层同样受新的单位抽取管：金额USD 整列两位小数也不认（三层共用一道闸）", () => {
    const r = detectMapping(["金额USD"], [["5.00"], ["6.00"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0])
  })
})

describe("单位闸 fail-closed：未列币种与孤立右括号（N2/N3）", () => {
  // 剥掉末尾单位 token 后，若表头里明明有该字段的词典词、剩余串却不再以词典词结尾，
  // 说明单位后面还黏着无法识别的东西（未知币种、孤立的右括号）⇒ 一律不认。
  // 只靠白名单挡不住：`欧元` 会被剥成「欧」＋白名单里的「元」，`EUR`/`$` 根本不是单位词。
  const 不认: [string, string][] = [
    ["金额欧元", "欧元被剥成「元」后，剩余不以词典词结尾"],
    ["金额EUR", "未列币种（拉丁）"],
    ["金额MOP", "未列币种"],
    ["金额HKD", "未列币种"],
    ["金额$", "货币符号不是单位词"],
    ["金额美元)", "孤立右括号剥不掉"],
    ["金额美元]", "孤立右括号剥不掉"],
    ["通话时长毫秒列", "单位后面还有异物"],
  ]
  for (const [表头, 为什么] of 不认) {
    test(`${表头} ⇒ 不认（${为什么}），原值留给 extras`, () => {
      const 值 = 表头.includes("通话") ? "5" : "5.00"
      const r = detectMapping([表头], [[值]])
      expect(r.columns).toEqual({})
      expect(r.unknownColumns).toEqual([0])
    })
  }

  const 认: [string, FactField][] = [
    ["主叫通话时长", "durationSec"],
    ["交易金额（元）", "amount"],
    ["金额人民币", "amount"],
    ["通话时长sec", "durationSec"],
    ["金额", "amount"],
  ]
  for (const [表头, field] of 认) {
    test(`${表头} ⇒ 照旧认成 ${field}`, () => {
      const 值 = field === "durationSec" ? "5" : "5.00"
      expect(detectMapping([表头], [[值]]).columns).toEqual({ 0: field })
    })
  }
})

describe("非默认币种扫描（第四轮：自然表头不能静默按人民币落库）", () => {
  // `美元金额` / `USD金额` / `$金额` 这类自然表头，币种写在词典词**前面**，
  // 单位闸只看末尾 ⇒ 被静默当成人民币金额（USD≈7 倍、JPY≈20 倍量级错）。
  // 币种与词典词无关，必须无条件扫描。
  const 不认: [string, string][] = [
    ["美元金额", "币种在词典词前面"],
    ["欧元金额", "币种在词典词前面"],
    ["港币金额", "港币"],
    ["港元余额", "港元；balance 同闸"],
    ["日元金额", "日元"],
    ["英镑金额", "英镑"],
    ["外币金额", "外币（未指明币种）"],
    ["原币金额", "原币（未指明币种）"],
    ["折美元金额", "折美元"],
    ["USD金额", "ISO 码"],
    ["$金额", "货币符号"],
    ["€金额", "货币符号"],
    ["金额美元金额", "币种夹在中间"],
  ]
  for (const [表头, 为什么] of 不认) {
    test(`${表头} ⇒ 不认（${为什么}），原值留给 extras`, () => {
      const r = detectMapping([表头], [["5.00"]])
      expect(r.columns).toEqual({})
      expect(r.unknownColumns).toEqual([0])
    })
  }

  const 不含词典词: [string, string][] = [
    ["EUR", "纯 ISO 码"],
    ["Amt EUR", "英文 ＋ ISO 码"],
    ["GBP Amount", "币种在前"],
    ["Amount CHF", "币种在后"],
  ]
  for (const [表头, 为什么] of 不含词典词) {
    test(`${表头} ⇒ 特征层也不认成 amount（${为什么}）`, () => {
      const r = detectMapping([表头], [["5.00"], ["6.00"]])
      expect(r.columns).not.toHaveProperty("0")
      expect(r.unknownColumns).toEqual([0])
    })
  }

  const 认: [string, FactField][] = [
    ["人民币金额", "amount"],
    ["金额", "amount"],
    ["交易金额（元）", "amount"],
    ["金额rmb", "amount"],
    ["主叫通话时长", "durationSec"],
    ["通话时长sec", "durationSec"],
    ["金额（元）", "amount"],
  ]
  for (const [表头, field] of 认) {
    test(`${表头} ⇒ 照旧认成 ${field}（默认币种不受影响）`, () => {
      const 值 = field === "durationSec" ? "5" : "5.00"
      expect(detectMapping([表头], [[值]]).columns).toEqual({ 0: field })
    })
  }
})

describe("detectMapping · 第二层：数据特征", () => {
  test("表头不认识，但整列是 yyyy-mm-dd hh:mm:ss ⇒ 认成 startedAt", () => {
    const r = detectMapping(
      ["A", "B"],
      [
        ["13800000000", "2026-01-02 03:04:05"],
        ["13900000000", "2026-01-02 03:05:00"],
      ],
    )
    expect(r.method).toBe("特征")
    expect(r.columns).toEqual({ 1: "startedAt" })
    expect(r.unknownColumns).toEqual([0])
  })

  test("整列两位小数 ⇒ 只有一列候选时才认成 amount", () => {
    const r = detectMapping(["A", "B"], [["1", "-12.50"], ["2", "33.00"]])
    expect(r.columns).toEqual({ 1: "amount" })
  })

  test("两列都像金额 ⇒ 都不认（消歧不了就不猜，§6.3 认不出来也入库）", () => {
    const r = detectMapping(["A", "B"], [["1.00", "2.00"], ["3.00", "4.00"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0, 1])
  })

  test("词典已认走的列不会被特征层重复认走", () => {
    const r = detectMapping(["通话时间", "B"], [["2026-01-02 03:04:05", "2026-01-02 04:04:05"]])
    expect(r.columns).toEqual({ 0: "startedAt" })
    expect(r.unknownColumns).toEqual([1])
  })

  test("特征层也不能把万元列认成 amount——单位冲突闸覆盖两层（R25b）", () => {
    // 词典层被单位闸拦下后，两位小数的形状会让特征层把它认回 amount（10000 倍错）。
    const r = detectMapping(["交易金额（万元）"], [["10000.00"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0])
  })

  test("冲突列不进特征层候选：另一列像金额时认那一列，不整列不猜（R25b）", () => {
    // 第 2 列用非词典表头，确保它只能由特征层认出来——这条才真的走到特征层的闸。
    const r = detectMapping(
      ["交易金额（万元）", "B"],
      [
        ["10000.00", "10000.00"],
        ["10000.00", "10000.00"],
      ],
    )
    expect(r.columns).toEqual({ 1: "amount" })
    expect(r.unknownColumns).toEqual([0])
  })

  test("冲突列不进特征层候选（词典表头版）：认第 2 列为 amount", () => {
    const r = detectMapping(
      ["交易金额（万元）", "金额"],
      [
        ["10000.00", "10000.00"],
        ["10000.00", "10000.00"],
      ],
    )
    expect(r.columns).toEqual({ 1: "amount" })
    expect(r.unknownColumns).toEqual([0])
  })
})

describe("detectMapping · 认不出来也入库", () => {
  test("全是自由文本 ⇒ 一个都不认，但不抛错", () => {
    const r = detectMapping(["备注", "说明"], [["张三", "打了三次"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0, 1])
  })

  test("表头全空也一样", () => {
    const r = detectMapping([null, null], [["a", "b"]])
    expect(r.unknownColumns).toEqual([0, 1])
  })
})

describe("formatFingerprint", () => {
  test("同表头同列类型 ⇒ 同指纹（与具体取值无关）", () => {
    const a = formatFingerprint(["主叫号码", "金额"], [["13800000000", "1.00"]])
    const b = formatFingerprint(["主叫号码", "金额"], [["13911111111", "2.50"]])
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })

  test("表头变了 ⇒ 指纹变", () => {
    expect(formatFingerprint(["主叫号码"], [["1"]])).not.toBe(formatFingerprint(["被叫号码"], [["1"]]))
  })

  test("列的数据形状变了 ⇒ 指纹变", () => {
    expect(formatFingerprint(["X"], [["1.00"]])).not.toBe(formatFingerprint(["X"], [["甲"]]))
  })

  test("指纹必须区分单位声明：7 种写法两两不同（N1）", () => {
    // 指纹用规范化表头会把单位声明折掉：金额 / 金额万元 / 金额USD 全变成「金额」。
    // 缓存命中时 columns 直接取缓存、detectMapping 不跑 ⇒ 单位闸被整个绕过，
    // 先导入基础表头再导入带单位表头会静默错 60 / 10000 倍。指纹必须保留原始表头。
    const 表头们 = ["金额", "金额万元", "金额USD", "通话时长", "通话时长分钟", "通话时长（分钟）", "通话时长sec"]
    const 样本 = [["1.00"]]
    const 指纹 = 表头们.map((h) => formatFingerprint([h], 样本))
    for (let i = 0; i < 指纹.length; i++)
      for (let j = i + 1; j < 指纹.length; j++) expect(指纹[i]).not.toBe(指纹[j])
  })

  test("表头只有空格差异 ⇒ 同指纹（只做 trim，不做规范化）", () => {
    expect(formatFingerprint([" 主叫号码 "], [["1"]])).toBe(formatFingerprint(["主叫号码"], [["1"]]))
  })
})

describe("classifyMaterialType", () => {
  test("有主叫/被叫/时长 ⇒ 话单", () => {
    expect(classifyMaterialType({ 0: "caller", 1: "callee" })).toBe("话单")
    expect(classifyMaterialType({ 3: "durationSec" })).toBe("话单")
  })

  test("有金额/余额 ⇒ 资金", () => {
    expect(classifyMaterialType({ 1: "amount" })).toBe("资金")
    expect(classifyMaterialType({ 2: "balance" })).toBe("资金")
  })

  test("只认出时间或对方账号 ⇒ 其他", () => {
    expect(classifyMaterialType({ 0: "startedAt" })).toBe("其他")
    expect(classifyMaterialType({ 0: "counterparty" })).toBe("其他")
    expect(classifyMaterialType({})).toBe("其他")
  })
})
