import { describe, expect, test } from "bun:test"
import { 是属性列, 解析属性列 } from "../../src/server/openhive/case-attribute-registry"
import { detectMapping } from "../../src/server/openhive/case-mapping"
import { toFactRows } from "../../src/server/openhive/case-rows"
import type { RawRow, RawSheet } from "../../src/server/openhive/case-sheet"

function 表(header: string[], rows: string[][]): RawSheet {
  const 转 = (t: string): RawRow["cells"][number] =>
    t === "" ? { text: null, kind: "empty" } : { text: t, kind: /^-?\d+(\.\d+)?$/.test(t) ? "number" : "text" }
  return { name: "Sheet1", header: header.map(转), rows: rows.map((r, i) => ({ rowNo: i + 2, cells: r.map(转) })) }
}

describe("属性列识别（05 §4.3）", () => {
  test("规范写法解析出归属与键", () => {
    expect(解析属性列("属性:对方:开户行")).toEqual({ 归属: "对方", 键: "开户行" })
    expect(解析属性列("属性:本方:银行卡号")).toEqual({ 归属: "本方", 键: "银行卡号" })
  })

  test("裸写法、非法归属、空键一律不认（fail-closed）", () => {
    expect(是属性列("对方开户行")).toBe(false)
    expect(是属性列("本方银行卡号")).toBe(false)
    expect(是属性列("属性:第三方:开户行")).toBe(false)
    expect(是属性列("属性:对方:")).toBe(false)
    expect(是属性列("")).toBe(false)
    expect(是属性列(null)).toBe(false)
  })

  test("属性列不进四层召回、不进待确认", () => {
    const header = ["交易时间", "交易金额", "借贷标志", "查询账号", "属性:对方:开户行"]
    const rows = [
      ["2024-11-09 09:15:03", "5000.00", "借", "6217001234567896514", "招商银行"],
      ["2024-11-10 10:00:00", "1200.00", "贷", "6217001234567896514", "招商银行"],
    ]
    const r = detectMapping(header, rows)
    expect(r.columns[4]).toBeUndefined()
    expect(r.待确认.some((x) => x.列号 === 4)).toBe(false)
  })

  // 简报原用例的「开户行」不命中账号词尾，四层本就不会认它 ⇒ 那条恒绿、钉不住映射层改动。
  // 这条用会被合成候选认走的键（对手修饰 ＋ 卡号词尾），拆掉映射层的排除逻辑必须变红。
  test("会被合成候选认成账户字段的属性列，必须挡在四层召回之前", () => {
    const header = ["查询账号", "属性:对方:银行卡号", "属性:本方:银行卡号"]
    const rows = [
      ["6217001234567896514", "6222020202020202020", "6217001234567896514"],
      ["6217001234567896514", "6222020202020202020", "6217001234567896514"],
    ]
    const r = detectMapping(header, rows)
    expect(r.columns[1]).toBeUndefined()
    expect(r.columns[2]).toBeUndefined()
    expect(r.待确认.some((x) => x.列号 === 1 || x.列号 === 2)).toBe(false)
  })

  test("属性列原文仍进 extras，键就是原表头", () => {
    const sheet = 表(["查询账号", "属性:对方:开户行"], [["6217001234567896514", "招商银行"]])
    const [row] = toFactRows({ projectId: "p1", materialId: "m1", sheet, mapping: { 0: "ownerAccount" } })
    expect(row?.extras).toEqual({ "属性:对方:开户行": "招商银行" })
  })
})
