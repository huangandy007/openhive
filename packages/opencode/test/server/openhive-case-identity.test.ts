import { describe, expect, test } from "bun:test"
import { 判定身份, type 身份证据 } from "../../src/server/openhive/case-identity"

function 证据(over: Partial<身份证据> = {}): 身份证据 {
  return { 类型: "账户", 值: "6217001234567896514", 户名们: [], 人证们: [], ...over }
}

describe("判定身份：三档只认证据", () => {
  test("账户有实名登记边 ⇒ 已核实，说明写明人", () => {
    const 判读 = 判定身份(证据({ 人证们: ["张三"] }))
    expect(判读.档).toBe("已核实")
    expect(判读.说明).toContain("实名登记")
    expect(判读.说明).toContain("张三")
  })

  test("账户既有实名登记又有户名 ⇒ 已核实（边优先）", () => {
    expect(判定身份(证据({ 人证们: ["张三"], 户名们: ["张三"] })).档).toBe("已核实")
  })

  test("人只有名字 ⇒ 户名匹配，必须写「未核实身份」", () => {
    const 判读 = 判定身份(证据({ 类型: "人", 值: "张三" }))
    expect(判读.档).toBe("户名匹配")
    expect(判读.说明).toContain("未核实身份")
    expect(判读.说明).toContain("张三")
  })

  test("账户只有户名 ⇒ 户名匹配，说明带户名且不冒充本人", () => {
    const 判读 = 判定身份(证据({ 户名们: ["张三"] }))
    expect(判读.档).toBe("户名匹配")
    expect(判读.说明).toContain("未核实身份")
    expect(判读.说明).toContain("张三")
    expect(判读.说明).toContain("不能当作本人")
  })

  test("账户既无户名又无实名登记 ⇒ 无匹配（查不到归属）", () => {
    const 判读 = 判定身份(证据())
    expect(判读.档).toBe("无匹配")
    expect(判读.说明).toContain("查不到归属")
    expect(判读.说明).not.toContain("已核实")
  })

  test("号码没有实名登记 ⇒ 无匹配", () => {
    expect(判定身份(证据({ 类型: "号码", 值: "19900001111" })).档).toBe("无匹配")
  })

  test("人多于 3 个 ⇒ 只列 3 个并写总数", () => {
    const 判读 = 判定身份(证据({ 人证们: ["甲", "乙", "丙", "丁", "戊"] }))
    expect(判读.档).toBe("已核实")
    expect(判读.说明).toContain("甲、乙、丙")
    expect(判读.说明).toContain("等 5 人")
    expect(判读.说明).not.toContain("丁")
  })
})
