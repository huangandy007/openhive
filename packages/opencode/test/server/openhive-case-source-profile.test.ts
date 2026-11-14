import { describe, expect, test } from "bun:test"
import { 匹配数据源档案, type 档案候选 } from "../../src/server/openhive/case-source-profile"

const 档案 = (over: Partial<档案候选> = {}): 档案候选 => ({
  id: "sp-1",
  name: "微信流水",
  type: "资金",
  mapping: { 交易时间: "startedAt", 交易金额: "amount", 对方户名: "counterpartyName" },
  hitCount: 0,
  updatedAt: 1,
  ...over,
})

describe("匹配数据源档案", () => {
  test("列顺序打乱仍命中，columns 还原成当前下标", () => {
    const 命中 = 匹配数据源档案({
      表头: ["对方户名", "交易金额", "交易时间"],
      档案们: [档案()],
    })
    expect(命中).toEqual({
      id: "sp-1",
      name: "微信流水",
      columns: { 0: "counterpartyName", 1: "amount", 2: "startedAt" },
    })
  })

  test("缺一列不命中（缺列不套）", () => {
    expect(匹配数据源档案({ 表头: ["交易金额", "交易时间"], 档案们: [档案()] })).toBeNull()
  })

  test("映射出的有效字段 < 2 不命中", () => {
    expect(
      匹配数据源档案({
        表头: ["交易金额", "备注"],
        档案们: [档案({ mapping: { 交易金额: "amount" } })],
      }),
    ).toBeNull()
  })

  test("类型不符不命中（资金档案套不上话单表头）", () => {
    expect(
      匹配数据源档案({
        表头: ["交易时间", "交易金额", "对方户名"],
        档案们: [档案({ type: "话单" })],
      }),
    ).toBeNull()
  })

  test("字段不在当前字段目录 ⇒ 不命中（失效字段回落普通识别）", () => {
    expect(
      匹配数据源档案({
        表头: ["交易时间", "交易金额", "对方户名"],
        档案们: [档案({ mapping: { 交易时间: "startedAt", 交易金额: "已删除字段", 对方户名: "counterpartyName" } })],
      }),
    ).toBeNull()
  })

  test("表头按 trim 后精确相等；空表头不参与", () => {
    expect(
      匹配数据源档案({
        表头: [" 交易时间 ", "交易金额", null],
        档案们: [档案({ mapping: { 交易时间: "startedAt", 交易金额: "amount" } })],
      }),
    ).toEqual({ id: "sp-1", name: "微信流水", columns: { 0: "startedAt", 1: "amount" } })
  })

  test("多候选：映射列数多者优先", () => {
    const 两列 = 档案({ id: "sp-2", mapping: { 交易时间: "startedAt", 交易金额: "amount" }, hitCount: 99 })
    const 三列 = 档案({ id: "sp-3", mapping: { 交易时间: "startedAt", 交易金额: "amount", 对方户名: "counterpartyName" }, hitCount: 0 })
    expect(
      匹配数据源档案({ 表头: ["交易时间", "交易金额", "对方户名"], 档案们: [两列, 三列] })?.id,
    ).toBe("sp-3")
  })

  test("映射列数相同：hitCount 高者优先，再按 updatedAt 新者", () => {
    const 旧 = 档案({ id: "sp-旧", hitCount: 1, updatedAt: 1 })
    const 新 = 档案({ id: "sp-新", hitCount: 1, updatedAt: 2 })
    expect(匹配数据源档案({ 表头: ["交易时间", "交易金额", "对方户名"], 档案们: [新, 旧] })?.id).toBe("sp-新")

    const 常 = 档案({ id: "sp-常", hitCount: 5, updatedAt: 1 })
    const 少 = 档案({ id: "sp-少", hitCount: 2, updatedAt: 9 })
    expect(匹配数据源档案({ 表头: ["交易时间", "交易金额", "对方户名"], 档案们: [少, 常] })?.id).toBe("sp-常")
  })

  test("前两名列数与 hitCount 打平、映射不同 ⇒ 不命中（fail-closed）", () => {
    const 甲 = 档案({ id: "sp-甲", mapping: { 交易时间: "startedAt", 交易金额: "amount" } })
    const 乙 = 档案({ id: "sp-乙", mapping: { 交易时间: "startedAt", 交易金额: "balance" } })
    expect(匹配数据源档案({ 表头: ["交易时间", "交易金额"], 档案们: [甲, 乙] })).toBeNull()
  })

  test("空候选 ⇒ null（撤销由调用方过滤）", () => {
    expect(匹配数据源档案({ 表头: ["交易时间", "交易金额"], 档案们: [] })).toBeNull()
  })
})
