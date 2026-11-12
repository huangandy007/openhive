import { describe, expect, test } from "bun:test"
import { 卡片id, 账户键, 翻译资金 } from "../../src/server/openhive/case-translate"
import { toFactRows } from "../../src/server/openhive/case-rows"
import type { RawRow, RawSheet } from "../../src/server/openhive/case-sheet"
import type { FactRowInput } from "../../src/server/openhive/case-store"
import { 是账户形状, type 识别字段 } from "../../src/server/openhive/case-field-registry"

/** 从表头 + 行造明细行；映射固定用真实列名，避免夹具替实现做选择。 */
function 明细(header: string[], rows: string[][]): FactRowInput[] {
  const 转 = (t: string): RawRow["cells"][number] =>
    t === "" ? { text: null, kind: "empty" } : { text: t, kind: /^-?\d+(\.\d+)?$/.test(t) ? "number" : "text" }
  const sheet: RawSheet = {
    name: "Sheet1",
    header: header.map(转),
    rows: rows.map((r, i) => ({ rowNo: i + 2, cells: r.map(转) })),
  }
  const 映射: Record<number, 识别字段> = {}
  const 字段 = ["startedAt", "amount", "balance", "direction", "counterparty", "counterpartyName", "ownerAccount"] as const
  for (let i = 0; i < Math.min(header.length, 字段.length); i++) 映射[i] = 字段[i]
  映射[7] = "ownerName"
  return toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: 映射 })
}

const 表头 = ["交易时间", "交易金额", "交易余额", "借贷标志", "交易对方账卡号", "交易对方名称", "查询账号", "查询户名"]
const 借行 = ["2024-11-09 09:15:03", "5000.00", "12,300.00", "借", "6222021234567890123", "李四", "6217001234567896514", "张三"]
const 贷行 = ["2024-11-10 10:00:00", "1200.00", "13,500.00", "贷", "6222021234567890123", "李四", "6217001234567896514", "张三"]

function 跑(rows: FactRowInput[], materialId = "m1") {
  return 翻译资金({ projectId: "p1", materialId, rows })
}

describe("资金卡片：一行一张", () => {
  test("借 ⇒ 本方付款方、对方收款方；金额正数；余额进 attrs", () => {
    const r = 跑(明细(表头, [借行]))
    expect(r.跳过们).toEqual([])
    expect(r.卡片们).toHaveLength(1)
    const 卡 = r.卡片们[0]
    expect(卡).toMatchObject({
      type: "资金交易",
      amount: "5000.00",
      currency: "CNY",
      occurredRaw: "2024-11-09 09:15:03",
      precision: "到秒",
      sheet: "Sheet1",
      rowNo: 2,
      attrs: { 余额: "12300.00" },
    })
    expect(卡.participants[0]).toMatchObject({
      规范值: "6217001234567896514",
      角色: "付款方",
      提及: "6217001234567896514",
      ordinal: 0,
      实体: true,
    })
    expect(卡.participants[1]).toMatchObject({
      规范值: "6222021234567890123",
      角色: "收款方",
      ordinal: 1,
      实体: true,
    })
  })

  test("贷 ⇒ 本方收款方、对方付款方", () => {
    const r = 跑(明细(表头, [贷行]))
    const 卡 = r.卡片们[0]
    expect(卡.participants[0]?.角色).toBe("收款方")
    expect(卡.participants[1]?.角色).toBe("付款方")
  })

  test("金额永远正数：-5000.00 + 方向付 ⇒ 5000.00、付款方（不从符号反推方向）", () => {
    const r = 跑(
      明细(表头, [["2024-11-09 09:15:03", "-5000.00", "", "付", "6222021234567890123", "李四", "6217001234567896514", "张三"]]),
    )
    const 卡 = r.卡片们[0]
    expect(卡.amount).toBe("5000.00")
    expect(卡.participants[0]?.角色).toBe("付款方")
    expect(卡.participants[1]?.角色).toBe("收款方")
  })

  test("户名写成别名，挂在账户上（M2），出处到行", () => {
    const r = 跑(明细(表头, [借行]))
    expect(r.别名们).toEqual([
      { 规范值: "6217001234567896514", 值: "张三", 出处: "m1#Sheet1#2" },
      { 规范值: "6222021234567890123", 值: "李四", 出处: "m1#Sheet1#2" },
    ])
  })
})

describe("一行不产卡片的六类理由（§4.6）", () => {
  test("方向不在映射表 ⇒ 方向不明", () => {
    const r = 跑(明细(表头, [["2024-11-09 09:15:03", "5000.00", "", "其他", "6222", "李四", "6217", "张三"]]))
    expect(r.卡片们).toEqual([])
    expect(r.跳过们).toEqual([{ sheet: "Sheet1", rowNo: 2, 原因: "方向不明" }])
  })

  test("金额解析不出 ⇒ 金额无法解析", () => {
    const r = 跑(明细(表头, [["2024-11-09 09:15:03", "五千", "", "借", "6222", "李四", "6217", "张三"]]))
    expect(r.跳过们).toEqual([{ sheet: "Sheet1", rowNo: 2, 原因: "金额无法解析" }])
  })

  test("时间解析不出 ⇒ 时间无法解析", () => {
    const r = 跑(明细(表头, [["昨天下午", "5000.00", "", "借", "6222", "李四", "6217", "张三"]]))
    expect(r.跳过们).toEqual([{ sheet: "Sheet1", rowNo: 2, 原因: "时间无法解析" }])
  })

  test("合计行 / 小计行 / 空行", () => {
    // 全空行在 `toFactRows` 上游就被丢掉（`case-rows.ts:164`；`RawSheet.rows` 的契约是
    // 「只含至少有一个非空单元格的行」，`case-sheet.ts` 同述）。翻译层仍要防御直接喂进来的
    // 空行，所以手工追加一条 `FactRowInput`（接口字段全可选）。断言的期望值与 brief 逐字一致。
    const 上游 = 明细(表头, [
      ["", "12345.00", "", "", "合计", "", "", ""],
      ["", "6000.00", "", "", "小计", "", "", ""],
    ])
    const r = 跑([...上游, { projectId: "p1", materialId: "m1", sheet: "Sheet1", rowNo: 4 }])
    expect(r.卡片们).toEqual([])
    expect(r.跳过们).toEqual([
      { sheet: "Sheet1", rowNo: 2, 原因: "合计行" },
      { sheet: "Sheet1", rowNo: 3, 原因: "小计行" },
      { sheet: "Sheet1", rowNo: 4, 原因: "空行" },
    ])
  })

  test("跳过记录的 sheet 跟着行来源，不是写死的", () => {
    // 其余用例的输入都在 `Sheet1`，单靠它们判别不出「sheet 是抄来的还是常量」——
    // 把实现里 8 处 `sheet: row.sheet` 写死成 `"Sheet1"`，那些用例照样全绿
    // （`#005-18` 假绿四问之二：默认值满足断言）。多表材料里定位不到行，正是设计 :1006 要防的。
    // 带上 amount 才是「有内容但方向不明」；全空会先被空行分支截住（实得「空行」）。
    const r = 跑([
      { projectId: "p1", materialId: "m1", sheet: "Sheet2", rowNo: 7, amount: "100.00", direction: null },
    ])
    expect(r.跳过们).toEqual([{ sheet: "Sheet2", rowNo: 7, 原因: "方向不明" }])
  })

  test("整格匹配：备注「合计转入的货款」是真实流水，必须产卡片", () => {
    const r = 跑(
      明细([...表头, "备注"], [
        [
          "2024-11-09 09:15:03",
          "5000.00",
          "",
          "借",
          "6222021234567890123",
          "李四",
          "6217001234567896514",
          "张三",
          "合计转入的货款",
        ],
      ]),
    )
    expect(r.跳过们).toEqual([])
    expect(r.卡片们).toHaveLength(1)
  })

  test("整格带金额仍判合计行（合计：5,000.00）", () => {
    const r = 跑(明细(表头, [["", "", "", "", "合计：5,000.00", "", "", ""]]))
    expect(r.跳过们).toEqual([{ sheet: "Sheet1", rowNo: 2, 原因: "合计行" }])
  })

  test("缺本方账号 / 缺对方账号", () => {
    const r = 跑(
      明细(表头, [
        ["2024-11-09 09:15:03", "5000.00", "", "借", "6222", "李四", "", "张三"],
        ["2024-11-09 09:15:03", "5000.00", "", "借", "", "", "6217", "张三"],
      ]),
    )
    expect(r.跳过们).toEqual([
      { sheet: "Sheet1", rowNo: 2, 原因: "缺本方账号" },
      { sheet: "Sheet1", rowNo: 3, 原因: "缺对方账号" },
    ])
  })
})

describe("源文件自带掩码（§4.0.5 坑 1）", () => {
  test("卡片照出，实体不建，原文进 mention", () => {
    const r = 跑(
      明细(表头, [["2024-11-09 09:15:03", "5000.00", "", "借", "6222****1234", "李四", "6217001234567896514", "张三"]]),
    )
    const 卡 = r.卡片们[0]
    expect(卡.participants[1]).toMatchObject({ 提及: "6222****1234", 实体: false })
    expect(r.别名们.map((a) => a.规范值)).toEqual(["6217001234567896514"]) // 对方不可建 ⇒ 不写别名
  })

  test("本方掩码 ⇒ 本方参与者实体不建，规范值原样（明文，不脱敏）", () => {
    const r = 跑(
      明细(表头, [["2024-11-09 09:15:03", "5000.00", "", "借", "6222021234567890123", "李四", "6217****6514", "张三"]]),
    )
    const 卡 = r.卡片们[0]
    expect(卡.participants[0]).toMatchObject({ 规范值: "6217****6514", 提及: "6217****6514", 实体: false })
    // 本方可建 = false ⇒ 不写本方别名；对方仍写。
    expect(r.别名们).toEqual([{ 规范值: "6222021234567890123", 值: "李四", 出处: "m1#Sheet1#2" }])
  })

  test("不可建实体不写属性（归属按可建判定，05 §5）", () => {
    // 对方账号被掩码 ⇒ 对方实体不建，对方属性没有可挂的实体；本方仍可建，本方属性照写。
    const r = 跑(
      明细([...表头, "属性:对方:开户行", "属性:本方:开户行"], [
        [
          "2024-11-09 09:15:03",
          "5000.00",
          "",
          "借",
          "6222****1234",
          "李四",
          "6217001234567896514",
          "张三",
          "招商银行",
          "工商银行",
        ],
      ]),
    )
    expect(r.属性们).toEqual([{ 归属: "本方", 键: "开户行", 值: "工商银行", 出处: "m1#Sheet1#2" }])
  })

  test("全角账号归一化成半角（§4.0.3a）", () => {
    const r = 跑(
      明细(表头, [["2024-11-09 09:15:03", "5000.00", "", "借", "６２２２０２１２３４５６７８９０１２３", "李四", "6217-0012-3456-7896-514", "张三"]]),
    )
    const 卡 = r.卡片们[0]
    expect(卡.participants[0]?.规范值).toBe("6217001234567896514")
    expect(卡.participants[1]?.规范值).toBe("6222021234567890123")
  })
})

describe("属性列（05 §5）", () => {
  const 带属性表头 = [...表头, "属性:对方:开户行", "属性:对方:银行卡号", "属性:本方:开户行"]
  const 行 = [...借行, "招商银行", "6214830012345678", "工商银行"]

  test("归属决定挂到哪个实体，值带出处", () => {
    const r = 跑(明细(带属性表头, [行]))
    expect(r.属性们).toEqual([
      { 归属: "对方", 键: "开户行", 值: "招商银行", 出处: "m1#Sheet1#2" },
      { 归属: "对方", 键: "银行卡号", 值: "6214830012345678", 出处: "m1#Sheet1#2" },
      { 归属: "本方", 键: "开户行", 值: "工商银行", 出处: "m1#Sheet1#2" },
    ])
  })

  test("同键同值只留一条，出处取首次出现", () => {
    const r = 跑(明细(带属性表头, [行, [...借行, "招商银行", "", ""]]))
    const 开户行 = r.属性们.filter((a) => a.归属 === "对方" && a.键 === "开户行")
    expect(开户行).toEqual([{ 归属: "对方", 键: "开户行", 值: "招商银行", 出处: "m1#Sheet1#2" }])
    // 别名同样「同键同值只留一条」：第二行的张三 / 李四不能再出现一次。
    expect(r.别名们).toHaveLength(2)
  })

  test("去重按实体：两个对手账户同一开户行值 ⇒ 各留一条，出处各自的行", () => {
    // 第二行换一个对手账号（同开户行值），归属仍为「对方」——去重粒度是每个实体内部。
    const 第二行 = [
      "2024-11-09 09:15:03",
      "5000.00",
      "",
      "借",
      "6222029999999999999",
      "王五",
      "6217001234567896514",
      "张三",
      "招商银行",
      "",
      "",
    ]
    const r = 跑(明细(带属性表头, [行, 第二行]))
    const 开户行们 = r.属性们.filter((a) => a.归属 === "对方" && a.键 === "开户行")
    expect(开户行们).toEqual([
      { 归属: "对方", 键: "开户行", 值: "招商银行", 出处: "m1#Sheet1#2" },
      { 归属: "对方", 键: "开户行", 值: "招商银行", 出处: "m1#Sheet1#3" },
    ])
  })

  test("空值不写属性", () => {
    const r = 跑(明细(带属性表头, [[...借行, "", "", ""]]))
    expect(r.属性们).toEqual([])
  })
})

describe("是账户形状（与识别层共用 `账号形状`，`#002-06`）", () => {
  test("空格 / 横线不敏感（同一条正则）；掩码与位数不足不算", () => {
    // 识别层用 `账号形状` 判列，翻译层判实体——若有人在这里另写一条 `/^\d{6,32}$/`，
    // 空格/横线这两条会红：那正是「识别认了、实体建不出来」的错位起点。
    expect(是账户形状("6217 0012 3456 7896 514")).toBe(true)
    expect(是账户形状("6217-0012-3456-7896-514")).toBe(true)
    expect(是账户形状("6222****1234")).toBe(false)
    expect(是账户形状("6222")).toBe(false)
  })
})

describe("账户键（写入器 / 关系 / 属性三处共用的那一份）", () => {
  test("格式固定为 账户\\u0000规范值，不同账号不同键", () => {
    expect(账户键("6217001234567896514")).toBe("账户\u00006217001234567896514")
    expect(账户键("6222")).not.toBe(账户键("6223"))
  })
})

describe("卡片 id（Q13：去版本）", () => {
  test("同输入同 id、不同行不同 id、与模板无关", () => {
    const a = 卡片id("p1", "m1", "Sheet1", 2, "资金")
    expect(a).toBe(卡片id("p1", "m1", "Sheet1", 2, "资金"))
    expect(a).toHaveLength(32)
    expect(a).not.toBe(卡片id("p1", "m1", "Sheet1", 3, "资金"))
    expect(a).not.toBe(卡片id("p1", "m2", "Sheet1", 2, "资金"))
  })

  test("翻译产出的卡片 id 用的就是它", () => {
    const r = 跑(明细(表头, [借行]))
    expect(r.卡片们[0]?.id).toBe(卡片id("p1", "m1", "Sheet1", 2, "资金"))
  })
})
