import { describe, expect, test } from "bun:test"
import { 识别材料 } from "../../src/server/openhive/case-recognize"
import type { 格式结果 } from "../../src/server/openhive/case-ingest"
import type { RawSheet } from "../../src/server/openhive/case-sheet"
import type { 识别字段 } from "../../src/server/openhive/case-field-registry"

/**
 * 识别编排的纯逻辑（不起库）。
 *
 * 与 `case-ingest.test.ts` 的分工：那边钉「跑表格把识别结果落进哪些表」，
 * 这边钉「识别材料本身怎么组合四层 / 缓存 / 模型」——不依赖 PG，跑得快。
 */
function 表(header: string[], rows: string[][], name = "Sheet1"): RawSheet {
  const 转 = (t: string) => (t === "" ? { text: null, kind: "empty" as const } : { text: t, kind: "text" as const })
  return { name, header: header.map(转), rows: rows.map((r, i) => ({ rowNo: i + 2, cells: r.map(转) })) }
}

function 缓存项(columns: Record<number, 识别字段>, result: 格式结果) {
  return { columns, result }
}

const 无别名 = { 别名: new Map<string, string>(), 版本: 0 }

describe("识别材料", () => {
  test("别名上下文参与识别，命中后记来源", async () => {
    const 结果 = await 识别材料({
      sheets: [表(["对方账卡"], [["6222001"]])],
      别名: { 别名: new Map([["对方账卡", "counterparty"]]), 版本: 3 },
      缓存: [undefined],
    })
    expect(结果.工作表[0]?.列[0]).toBe("counterparty")
    expect(结果.工作表[0]?.来源[0]).toBe("别名库")
    expect(结果.工作表[0]?.命中).toBe(false)
    expect(结果.模型).toEqual({ 调用: 0 })
  })

  test("模型只调一次，且失败不阻断识别", async () => {
    let 调用次数 = 0
    const 错误 = new Error("connect ECONNREFUSED 127.0.0.1:1")
    // `识别材料` 记的是**错误名**（与抽取链的失败口径一致）：真实模型错误由
    // `详细失败` 保留原类名。这里显式给 name，钉住「记名字而不是 message」。
    错误.name = "ECONNREFUSED"
    const 结果 = await 识别材料({
      // 交易金额已被四层认出；「方向X」给了字段候选、「列Y」是未认领的金额形状
      // ⇒ 触发模型，但模型挂了。R39⑤：失败只该丢模型那一层，四层的结果必须仍在。
      sheets: [
        表(
          ["交易金额", "方向X", "列Y"],
          [
            ["1.00", "收", "1.00"],
            ["2.00", "付", "2.00"],
            ["3.00", "收", "3.00"],
          ],
        ),
      ],
      别名: 无别名,
      缓存: [undefined],
      识别器: async () => {
        调用次数++
        throw 错误
      },
    })
    expect(调用次数).toBe(1)
    expect(结果.模型.调用).toBe(1)
    expect(结果.模型.失败).toBe("ECONNREFUSED")
    expect(结果.工作表).toHaveLength(1)
    expect(结果.工作表[0]?.列).toEqual({ 0: "amount" })
    expect(结果.工作表[0]?.来源[0]).toBe("词典")
  })

  test("缓存命中的表不跑四层、不参与模型，待确认与未知列随缓存保留", async () => {
    let 模型收到的表: string[] = []
    // 缓存说第 0 列是 amount。若仍跑 detectMapping，「主叫号码」会被认成 caller
    // ——这条差分断言就是「命中缓存不跑四层」的钉子。
    const 缓存 = 缓存项(
      { 0: "amount" },
      {
        来源: { 0: "词典" },
        待确认: [{ 列号: 0, 表头: "主叫号码", 建议字段: "caller", 原因: "候选不唯一" }],
        方法: "词典",
        未知列: 2,
      },
    )
    const 结果 = await 识别材料({
      sheets: [
        表(["主叫号码"], [["13800000000"]], "命中"),
        // 这张表没有缓存，且满足触发条件（「方向X」给候选、未认领的金额形状）
        // ——模型只该看到它。
        表(
          ["交易金额", "方向X", "列Y"],
          [
            ["1.00", "收", "1.00"],
            ["2.00", "付", "2.00"],
            ["3.00", "收", "3.00"],
          ],
          "未命中",
        ),
      ],
      别名: 无别名,
      缓存: [缓存, undefined],
      识别器: async (输入) => {
        模型收到的表 = 输入.工作表.map((s) => s.名)
        return { 工作表: {} }
      },
    })
    expect(结果.工作表[0]?.列[0]).toBe("amount")
    expect(结果.工作表[0]?.命中).toBe(true)
    expect(结果.工作表[0]?.待确认).toHaveLength(1)
    expect(结果.工作表[0]?.未知列).toBe(2)
    expect(模型收到的表).toEqual(["未命中"])
    expect(结果.模型.调用).toBe(1)
    expect(结果.工作表[1]?.命中).toBe(false)
  })

  test("全部命中缓存 ⇒ 一次模型都不调", async () => {
    let 调用次数 = 0
    const 结果 = await 识别材料({
      sheets: [表(["甲", "乙"], [["1.00", "2.00"]])],
      别名: 无别名,
      缓存: [
        缓存项({ 0: "amount" }, { 来源: { 0: "词典" }, 待确认: [], 方法: "词典", 未知列: 1 }),
      ],
      识别器: async () => {
        调用次数++
        return { 工作表: {} }
      },
    })
    expect(调用次数).toBe(0)
    expect(结果.模型).toEqual({ 调用: 0 })
    expect(结果.工作表[0]?.命中).toBe(true)
  })

  test("方法是按表判的：模型只标它真填过的表，缓存表用缓存的方法", async () => {
    const 缓存 = 缓存项({ 0: "caller" }, { 来源: { 0: "词典" }, 待确认: [], 方法: "词典", 未知列: 0 })
    const 结果 = await 识别材料({
      sheets: [
        表(["主叫号码"], [["13800000000"]], "缓存表"),
        // 资金表：金额列已被词典认领；第三列形状像金额但没被认领 ⇒ 触发模型。
        // 建议 `direction`（收/付形状 ＋ 表头无单位声明）——不依赖单位闸的放行口径，
        // 并行修复收紧 `合并模型结果`（拒绝单位冲突列）时这条用例不该跟着变红。
        表(
          ["交易金额", "方向X", "列Y"],
          [
            ["1.00", "收", "1.00"],
            ["2.00", "付", "2.00"],
            ["3.00", "收", "3.00"],
          ],
          "模型表",
        ),
      ],
      别名: 无别名,
      缓存: [缓存, undefined],
      识别器: async () => ({ 工作表: { 模型表: { 列: { "1": "direction" } } } }),
    })
    expect(结果.工作表[0]?.方法).toBe("词典")
    expect(结果.工作表[1]?.来源[1]).toBe("模型")
    expect(结果.工作表[1]?.方法).toBe("模型")
  })

  test("材料类型话单优先：话单在前、资金在后仍判话单（不沿用「最后一张赢」）", async () => {
    const 结果 = await 识别材料({
      sheets: [
        表(["主叫号码"], [["13800000000"]], "话单"),
        表(["交易金额"], [["1.00"]], "资金"),
      ],
      别名: 无别名,
      缓存: [undefined, undefined],
    })
    expect(结果.类型).toBe("话单")
  })

  test("只有资金表 ⇒ 资金", async () => {
    const 结果 = await 识别材料({
      sheets: [表(["交易金额"], [["1.00"]])],
      别名: 无别名,
      缓存: [undefined],
    })
    expect(结果.类型).toBe("资金")
  })
})
