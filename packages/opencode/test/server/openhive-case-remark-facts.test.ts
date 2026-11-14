import { describe, expect, test } from "bun:test"
import { 抽取备注事实, 商户值闸词们 } from "../../src/server/openhive/case-remark-facts"

const 消费 = { 一级: "消费", 二级: "餐饮" }
const 转账 = { 一级: "转账", 二级: null }

function 抽(备注: string | null, over: Partial<Parameters<typeof 抽取备注事实>[0]> = {}) {
  return 抽取备注事实({ 备注, 用途: 消费, 对手名: null, ...over })
}

describe("商户：消费行 + 值闸 + 解码", () => {
  test("取子商户名称段", () => {
    expect(抽("备注：午餐##子商户名称：一号饭店").商户).toBe("一号饭店")
  })

  test("UTF8# base64 解码", () => {
    expect(抽("备注：午餐##子商户名称：UTF8#5LiA5Y+36aWt5bqX").商户).toBe("一号饭店")
  })

  test("渠道/用途值不当作商户", () => {
    for (const 词 of [...商户值闸词们, "手机充值-中国移动", "-", "#|#", ""]) {
      expect(抽(`备注：午餐##子商户名称：${词}`).商户).toBeNull()
    }
  })

  test("非消费行不抽商户（用途闸）", () => {
    expect(抽("备注：微信转账##子商户名称：一号饭店", { 用途: 转账 }).商户).toBeNull()
  })

  test("解码失败不伪造", () => {
    expect(抽("备注：午餐##子商户名称：UTF8#不是base64").商户).toBeNull()
  })

  test("无备注 ⇒ null", () => {
    expect(抽(null).商户).toBeNull()
  })
})

describe("对象：车牌 / 手机号", () => {
  test("车牌、7 位牌、去重", () => {
    expect(抽("停车缴费-湘A12345-测试停车场").车辆).toEqual(["湘A12345"])
    expect(抽("湘A12345 与 湘A12345").车辆).toEqual(["湘A12345"])
  })

  test("车牌前后紧邻字母数字 ⇒ 不命中（防长串截取）", () => {
    expect(抽("AB湘A12345CD").车辆).toEqual([])
  })

  test("手机号、去重", () => {
    expect(抽("扫码付款-给李13800138000").号码).toEqual(["13800138000"])
    expect(抽("13800138000 与 13800138000").号码).toEqual(["13800138000"])
  })

  test("长数字串 / 位数不足 ⇒ 不命中", () => {
    expect(抽("订单1380013800012").号码).toEqual([])
    expect(抽("电话1380013800").号码).toEqual([])
  })
})

describe("摘要：清洗 + 回退链 + 截断", () => {
  test("重复段折叠、空白折叠", () => {
    expect(抽("备注：午餐;午餐##子商户名称：一号饭店").摘要).toBe("午餐")
    expect(抽("备注：  一号   饭店  ").摘要).toBe("一号 饭店")
  })

  test("元数据键开头 ⇒ 回退到商户", () => {
    expect(抽("网银联单号类型：网联##子商户名称：一号饭店").摘要).toBe("一号饭店")
  })

  test("通用词（微信转账）⇒ 回退到对手名（去后缀）", () => {
    expect(抽("备注：微信转账;微信转账", { 对手名: "李四(个人)" }).摘要).toBe("李四")
  })

  test("通用词且无对手名 ⇒ 回退到用途", () => {
    expect(抽("备注：微信转账", { 对手名: null }).摘要).toBe("餐饮")
  })

  test("空备注 ⇒ 回退到用途", () => {
    expect(抽(null, { 对手名: null }).摘要).toBe("餐饮")
  })

  test("60 码点截断补省略号", () => {
    expect(抽(`备注：${"甲".repeat(61)}`).摘要).toBe(`${"甲".repeat(60)}…`)
  })
})
