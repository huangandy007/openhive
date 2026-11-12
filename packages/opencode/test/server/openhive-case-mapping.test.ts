import { describe, expect, test } from "bun:test"
import {
  classifyMaterialType,
  detectMapping,
  formatFingerprint,
  type FactField,
} from "../../src/server/openhive/case-mapping"
import { 候选字段集 } from "../../src/server/openhive/case-field-registry"

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

  test("「收/付」是方向列——斜杠写法不认会让整表卡片全部「方向不明」", () => {
    // 合成金标准夹具「收付标志带属性」的真实表头。词典只有「收付标志」这类写法，
    // 斜杠把「收付」拆开 ⇒ 精确/后缀两层都召不回，direction 为空、整表卡片被跳过。
    const r = detectMapping(["收/付", "交易金额"], [["付", "100.00"], ["收", "200.00"]])
    expect(r.columns).toEqual({ 0: "direction", 1: "amount" })
  })

  test("表头带空格/全角括号也能对上（规范后再比）", () => {
    // 第三列换成话单字段：候选字段集按表类型推断，话单表不再参与 amount 认领（设计 §3.2）。
    // 本用例只管「trim ＋ 去内部空白 ＋ 去全角括号」这条规范化，类型混用属于另一条线。
    const r = detectMapping([" 主叫号码 ", "被叫 号码", "通话时长（秒）"], [["1", "2", "37"]])
    expect(r.columns).toEqual({ 0: "caller", 1: "callee", 2: "durationSec" })
  })

  test("同一个字段命中多列且形状分不开 ⇒ 都不认（不重复占，也不猜）", () => {
    // 「主叫号码」与「本机号码」都是 caller 的精确同义词；样例不是手机号，形状命中率都是 0
    // ⇒ 按设计 §3.2 证据规则 3（前两名差距 < 5% 不猜）两列都进待确认。
    const r = detectMapping(["主叫号码", "被叫号码", "本机号码"], [["1", "2", "3"]])
    expect(r.columns).toEqual({ 1: "callee" })
    expect(r.unknownColumns).toEqual([0, 2])
    expect(r.待确认.filter((项) => 项.原因 === "候选不唯一").map((项) => 项.列号)).toEqual([0, 2])
  })

  test("复合表头按后缀认：「主叫通话时长」是时长，不是主叫", () => {
    // 包含匹配会把 col0 认成 caller（「主叫」是它的词），时长列就此静默消失。
    const r = detectMapping(["主叫通话时长", "通话时间"], [["37", "2026-01-02 03:04:05"]])
    expect(r.columns).toEqual({ 0: "durationSec", 1: "startedAt" })
  })

  test("两列都以后缀命中同一字段 ⇒ 消歧不了就不认，且都进待确认", () => {
    const r = detectMapping(["主叫通话时长", "被叫通话时长"], [["37", "83"]])
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0, 1])
    // 「差距 <5% 不猜」的结果必须可解释：两列都要能进待确认，而不是静默消失。
    expect(r.待确认.map((项) => [项.列号, 项.原因, 项.建议字段])).toEqual([
      [0, "候选不唯一", "durationSec"],
      [1, "候选不唯一", "durationSec"],
    ])
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
    // 三行才够形状投票（Task 1 的「≥3 个非空值」闸）：两行会推断成「其他」，
    // amount 根本不在候选集里，用例就成了空转。
    const r = detectMapping(["A", "B"], [["1", "-12.50"], ["2", "33.00"], ["3", "44.00"]])
    expect(r.columns).toEqual({ 1: "amount" })
  })

  test("两列都像金额 ⇒ 都不认（消歧不了就不猜，§6.3 认不出来也入库）", () => {
    const r = detectMapping(
      ["A", "B"],
      [["1.00", "2.00"], ["3.00", "4.00"], ["5.00", "6.00"]],
    )
    expect(r.columns).toEqual({})
    expect(r.unknownColumns).toEqual([0, 1])
    expect(r.待确认.map((项) => 项.原因)).toEqual(["候选不唯一", "候选不唯一"])
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
    const a = formatFingerprint(["主叫号码", "金额"], [["13800000000", "1.00"]], 0)
    const b = formatFingerprint(["主叫号码", "金额"], [["13911111111", "2.50"]], 0)
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })

  test("表头变了 ⇒ 指纹变", () => {
    expect(formatFingerprint(["主叫号码"], [["1"]], 0)).not.toBe(formatFingerprint(["被叫号码"], [["1"]], 0))
  })

  test("列的数据形状变了 ⇒ 指纹变", () => {
    expect(formatFingerprint(["X"], [["1.00"]], 0)).not.toBe(formatFingerprint(["X"], [["甲"]], 0))
  })

  test("指纹必须区分单位声明：7 种写法两两不同（N1）", () => {
    // 指纹用规范化表头会把单位声明折掉：金额 / 金额万元 / 金额USD 全变成「金额」。
    // 缓存命中时 columns 直接取缓存、detectMapping 不跑 ⇒ 单位闸被整个绕过，
    // 先导入基础表头再导入带单位表头会静默错 60 / 10000 倍。指纹必须保留原始表头。
    const 表头们 = ["金额", "金额万元", "金额USD", "通话时长", "通话时长分钟", "通话时长（分钟）", "通话时长sec"]
    const 样本 = [["1.00"]]
    const 指纹 = 表头们.map((h) => formatFingerprint([h], 样本, 0))
    for (let i = 0; i < 指纹.length; i++)
      for (let j = i + 1; j < 指纹.length; j++) expect(指纹[i]).not.toBe(指纹[j])
  })

  test("表头只有空格差异 ⇒ 同指纹（只做 trim，不做规范化）", () => {
    expect(formatFingerprint([" 主叫号码 "], [["1"]], 0)).toBe(formatFingerprint(["主叫号码"], [["1"]], 0))
  })

  test("alias_version 进指纹：版本一变，同表头的指纹也变（§4.2-4）", () => {
    // 别名一变旧缓存必须不可达，否则别名/单位闸的修正对存量缓存不生效（#011-01 同类）。
    expect(formatFingerprint(["主叫号码"], [["1"]], 0)).not.toBe(formatFingerprint(["主叫号码"], [["1"]], 1))
  })
})

describe("classifyMaterialType", () => {
  test("有主叫/被叫/时长 ⇒ 话单", () => {
    expect(classifyMaterialType({ 0: "caller" })).toBe("话单")
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

  test("extras 字段不参与类型判定：address ⇒ 其他", () => {
    expect(classifyMaterialType({ 0: "address" })).toBe("其他")
  })

  test("脏缓存值（非法字段名）不抛错，按「其他」处理", () => {
    // 格式缓存里的 columns 可能来自旧版本 / 被污染的行；`字段目录[字段].落点` 会 TypeError。
    // 分类是只读的旁路，脏值只能降级成「其他」，不能让整条材料处理崩掉。
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const 脏 = { 0: "垃圾" } as never
    expect(() => classifyMaterialType(脏)).not.toThrow()
    expect(classifyMaterialType(脏)).toBe("其他")
  })
})

describe("新增：表头变体与两轮制", () => {
  test("三种真实银行表头能被同义词直接认出", () => {
    const r = detectMapping(
      ["交易对方名称", "交易对方账卡号", "查询账号"],
      [["张三", "6222001", "6222999"]],
    )
    // 查询账号是精确同义词，直接认；另两列允许通过后缀认，但绝不能认错字段
    expect(r.columns[2]).toBe("ownerAccount")
    expect(r.columns[1]).toBe("counterparty")
    expect(r.columns[0]).toBe("counterpartyName")
  })

  test("对手账号与对手户名两列都落，不是只取一列（R2）", () => {
    const r = detectMapping(["对方账号", "对方户名"], [["6222001", "张三"]])
    expect(r.columns).toEqual({ 0: "counterparty", 1: "counterpartyName" })
  })

  test("「对方账号」不能被 ownerAccount 的后缀「账号」抢走", () => {
    const r = detectMapping(["对方账号", "查询账号"], [["6222001", "6222999"]])
    expect(r.columns).toEqual({ 0: "counterparty", 1: "ownerAccount" })
  })

  test("「交易对方」归户名，不归账号（旧词典归属已改）", () => {
    const r = detectMapping(["交易对方"], [["张三"]])
    expect(r.columns).toEqual({ 0: "counterpartyName" })
  })

  test("微信支付导出的「收款方…名称」系列直接由词典认成对方户名", () => {
    // 真库现场：同表头的两份 tenpay 文件里，这列只能靠模型兜底，一份认出一份没认出。
    // 这类表头是常见写法，放进词典就不再依赖样例与模型。
    const 表头 = ["交易金额", "交易时间", "收款方的商户名称"]
    const 行 = [
      ["1.00", "2026-01-02 03:04:05", "彭小林(个人)"],
      ["2.00", "2026-01-02 03:05:06", "微民保险代理有限公司(商户)"],
    ]
    const r = detectMapping(表头, 行)
    expect(r.columns[2]).toBe("counterpartyName")
    expect(r.来源[2]).toBe("词典")
  })

  test("修饰语优先与候选遍历顺序无关：对手账号不被 ownerAccount 的通用词「账号」抢走", () => {
    // 候选顺序故意把 ownerAccount 放前面：没有修饰语闸时，后缀轮先给它认领（通用词「账号」，
    // 命中率 100%），counterparty 的长词「对方账号」就轮不到了。修饰语优先保证结果与顺序无关。
    const r = detectMapping(["交易对方账号"], [["6222001"]], {
      候选字段: new Set(["ownerAccount", "counterparty"] as const),
    })
    expect(r.columns).toEqual({ 0: "counterparty" })
  })

  test("精确轮先于后缀轮：「送达时间」归 deliveredAt，不被 startedAt 的通用词「时间」抢走", () => {
    // 「送达时间」是 deliveredAt 的精确同义词，也以 startedAt 的通用词「时间」结尾。
    // 单轮（边遍历字段边做后缀）会让 startedAt 先拿走；两轮制先让精确命中全部落定。
    const r = detectMapping(["送达时间"], [["2026-01-02 03:04:05"]])
    expect(r.columns).toEqual({ 0: "deliveredAt" })
  })

  test("别名命中：原始表头精确、目标在候选集内、形状通过 ⇒ 落库", () => {
    const r = detectMapping(["对方账卡"], [["6222001"]], {
      别名: new Map([["对方账卡", "counterparty"]]),
    })
    expect(r.columns).toEqual({ 0: "counterparty" })
    expect(r.来源[0]).toBe("别名库")
    expect(r.method).toBe("别名")
  })

  test("别名命中但形状不达标 ⇒ 进待确认（别名不提供证据）", () => {
    // 别名只是「这一列叫什么」的提示；值全是汉字、不像账号 ⇒ 不许直接落库（§4.2-2）。
    const r = detectMapping(["对方账卡"], [["张三"]], {
      别名: new Map([["对方账卡", "counterparty"]]),
    })
    expect(r.columns).toEqual({})
    expect(r.待确认).toEqual([
      { 列号: 0, 表头: "对方账卡", 建议字段: "counterparty", 原因: "形状不符" },
    ])
  })

  test("别名目标不在候选集 ⇒ 不生效、进待确认（§4.2-5）", () => {
    const r = detectMapping(["号码"], [["13800000000"]], {
      别名: new Map([["号码", "counterparty"]]),
      候选字段: new Set(["caller", "callee"] as const),
    })
    expect(r.columns).toEqual({})
    expect(r.待确认).toEqual([
      { 列号: 0, 表头: "号码", 建议字段: "counterparty", 原因: "别名跨字段集" },
    ])
  })

  test("别名命中「金额（万元）」：单位闸仍拦下，进待确认", () => {
    const r = detectMapping(["金额（万元）"], [["1.00"]], {
      别名: new Map([["金额（万元）", "amount"]]),
    })
    expect(r.columns).toEqual({})
    expect(r.待确认[0]?.原因).toBe("单位冲突")
  })

  test("同一表头重名 ⇒ 别名不生效，走位置键（§4.3）", () => {
    const r = detectMapping(["金额", "金额"], [["1.00", "2.00"]], {
      别名: new Map([["金额", "amount"]]),
    })
    expect(r.columns).toEqual({})
    expect(r.待确认.every((项) => 项.原因 === "表头重名")).toBe(true)
  })

  test("话单两个时间列不唯一 ⇒ 待确认，不静默 started_at 为空", () => {
    const r = detectMapping(
      ["通话开始时间", "通话结束时间"],
      [["2026-01-02 03:04:05", "2026-01-02 03:05:05"]],
    )
    // 「通话开始时间」是 startedAt 的精确同义词 ⇒ 落定；「通话结束时间」只以通用词「时间」
    // 后缀命中、且 startedAt 已被占 ⇒ 进待确认，不静默丢。（原断言写的是
    // `columns["startedAt"]`，而 columns 的键是列号，永远 undefined —— 改成真断言。）
    expect(r.columns[0]).toBe("startedAt")
    expect(r.columns[1]).toBeUndefined()
    expect(r.待确认.some((项) => 项.原因 === "候选不唯一")).toBe(true)
  })
})

describe("R11：修饰语只约束账号/户名三个字段", () => {
  test("修饰语 + 通用词尾：交易对方银行卡号 归 counterparty", () => {
    // 「银行卡号」不是任何字段的同义词（词典里是「对方卡号」「交易对方账卡号」），
    // 必须靠「对手修饰 ＋ 账号词尾」合成候选，否则真实资金表整列进 unknown。
    const r = detectMapping(["交易对方银行卡号"], [["6222001"]])
    expect(r.columns).toEqual({ 0: "counterparty" })
  })

  test("修饰语 + 通用词尾：本方银行卡号 归 ownerAccount", () => {
    const r = detectMapping(["本方银行卡号"], [["6222999"]])
    expect(r.columns).toEqual({ 0: "ownerAccount" })
  })

  test("修饰语 + 词典里没有的词尾：本方银行账户 归 ownerAccount", () => {
    // 「账户」不是 ownerAccount 的同义词（只有「本方账户」）⇒ 只能走合成分支；
    // 这条才真正钉住 ownerAccount 的合成规则（「本方银行卡号」靠同义词「卡号」就能过）。
    const r = detectMapping(["本方银行账户"], [["6222999"]])
    expect(r.columns).toEqual({ 0: "ownerAccount" })
  })

  test("修饰语不再误伤其它字段：对方通话时间 归 startedAt", () => {
    // R11 前：含「对方」的表头对所有字段一律 false ⇒ startedAt 的后缀「通话时间」被拦，
    // 整列静默进 unknown、连待确认都没有，材料照样标「已解析」而 started_at 全空。
    const r = detectMapping(
      ["对方通话时间", "主叫号码", "被叫号码", "通话时长"],
      [["2026-01-02 03:04:05", "13800000000", "13900000000", "37"]],
    )
    expect(r.columns[0]).toBe("startedAt")
    // 只断 columns 会被形状层兜住（值是时间形状）⇒ 假绿；「被后缀词认出」要看来源。
    expect(r.来源[0]).toBe("词典")
  })

  test("修饰语不再误伤其它字段：客户交易金额 归 amount", () => {
    // 「客户」属于本方修饰；R11 前只许 ownerAccount，amount 的后缀召回被误杀。
    const r = detectMapping(["客户交易金额"], [["1.00"]])
    expect(r.columns).toEqual({ 0: "amount" })
    // 同上：形状层也能认成 amount，必须钉住是词典层认的。
    expect(r.来源[0]).toBe("词典")
  })
})

describe("候选字段集：表类型决定谁参与认领", () => {
  test("话单表里的金额列不进候选集 ⇒ 金额列不被认（Task 1 的后果）", () => {
    // 话单候选集不含 amount：同表里出现金额列时宁可进 extras，也不按话单材料落库。
    const 表头 = ["主叫号码", "被叫号码", "通话时长", "交易金额"]
    const 行 = [["13800000000", "13900000000", "37", "1.00"]]
    expect(候选字段集(表头, 行).has("amount")).toBe(false)
    const r = detectMapping(表头, 行)
    expect(r.columns).toEqual({ 0: "caller", 1: "callee", 2: "durationSec" })
    expect(r.unknownColumns).toEqual([3])
  })
})
