import { describe, expect, test } from "bun:test"
import { 解析出处 as 后端解析 } from "../../src/server/openhive/citation"
import { 解析出处 as 前端解析 } from "../../../app/src/center/case-views/hgraph/citation"

/**
 * T6 · 出处解析跨层守卫：**两处物理副本、一个行为**（`#002-06`）。
 *
 * 前端不能 import 服务端模块（会把服务端代码打进 app），所以 `hgraph/citation.ts` 是一份
 * 镜像。这里同时喂给两份实现同一张表，逐条断言结果深相等（含 `null` 一致）——口头保证
 * 「照抄的」不算数，语义漂了必须在这里红。
 *
 * 表里同时钉**字面期望值**：只断言「两边相等」时，两份一起改错会静默通过（`#005-18`）。
 */
/** 字面期望的形状（与两侧 `出处` 结构相同；不 import 任一实现侧的类型当期望）。 */
interface 期望出处 {
  readonly 材料: string
  readonly 工作表: string
  readonly 起: number
  readonly 末: number
  readonly 是区间: boolean
}

const 用例表: readonly { readonly 输入: string; readonly 期望: 期望出处 | null }[] = [
  { 输入: "m1#Sheet1#12", 期望: { 材料: "m1", 工作表: "Sheet1", 起: 12, 末: 12, 是区间: false } },
  { 输入: "m1#A#B#12", 期望: { 材料: "m1", 工作表: "A#B", 起: 12, 末: 12, 是区间: false } },
  { 输入: "m#t#12-40", 期望: { 材料: "m", 工作表: "t", 起: 12, 末: 40, 是区间: true } },
  { 输入: "m#t#12-12", 期望: { 材料: "m", 工作表: "t", 起: 12, 末: 12, 是区间: true } },
  { 输入: "m#t#0012-0012", 期望: { 材料: "m", 工作表: "t", 起: 12, 末: 12, 是区间: true } },
  { 输入: "m#t# 12 ", 期望: { 材料: "m", 工作表: "t", 起: 12, 末: 12, 是区间: false } },
  { 输入: "m#t#02", 期望: { 材料: "m", 工作表: "t", 起: 2, 末: 2, 是区间: false } },
  { 输入: "m#t#40-12", 期望: null },
  { 输入: "m#t#1.5", 期望: null },
  { 输入: "m#t#2#多余", 期望: null },
  { 输入: "没有井号", 期望: null },
  { 输入: "m#t", 期望: null },
  { 输入: "#t#1", 期望: null },
  { 输入: "m##1", 期望: null },
  { 输入: "m#t#", 期望: null },
]

describe("T6 · 出处解析跨层守卫：前端镜像 = 后端实现（含 null）", () => {
  for (const 用例 of 用例表) {
    test(`「${用例.输入}」：两侧深相等，且等于字面期望`, () => {
      expect(前端解析(用例.输入)).toEqual(后端解析(用例.输入))
      expect(后端解析(用例.输入)).toEqual(用例.期望)
      expect(前端解析(用例.输入)).toEqual(用例.期望)
    })
  }

  test("表覆盖到单行 / 区间 / null 三类（防止表退化成只测一类）", () => {
    const 结果们 = 用例表.map((用例) => 用例.期望)
    expect(结果们.some((值) => 值 === null)).toBe(true)
    expect(结果们.some((值) => 值 !== null && 值.是区间)).toBe(true)
    expect(结果们.some((值) => 值 !== null && !值.是区间)).toBe(true)
  })
})
