import { describe, expect, test } from "bun:test"
import { 实体类型们, 细类备选 } from "./field-options"

describe("检查器下拉备选（需求第 6 项②）", () => {
  test("类型备选 = 后端 `实体类型们` + 图内专属的「未分类」「事件」", () => {
    expect([...实体类型们]).toEqual([
      "人",
      "号码",
      "账户",
      "虚拟身份",
      "车辆",
      "物品",
      "地点",
      "组织",
      "事件",
      "未分类",
    ])
  })

  test("细类按类型给：号码 / 账户 / 虚拟身份有白名单，其余为空", () => {
    expect([...细类备选("号码")]).toEqual(["手机号", "身份证", "固定电话"])
    expect([...细类备选("账户")]).toEqual(["银行卡", "银行账号", "第三方支付"])
    expect([...细类备选("虚拟身份")]).toEqual(["邮箱", "QQ", "微信"])
    expect(细类备选("人")).toEqual([])
    expect(细类备选(undefined)).toEqual([])
    // 原型键不能取到东西（与后端 `白名单` 同一防护口径）。
    expect(细类备选("constructor")).toEqual([])
  })
})
