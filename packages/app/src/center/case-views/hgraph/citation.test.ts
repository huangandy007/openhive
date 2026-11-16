import { describe, expect, test } from "bun:test"
import { 解析出处 } from "./citation"

/**
 * 前端镜像（T6 / R-F10）——**与后端 `packages/opencode/src/server/openhive/citation.ts`
 * 逐字同语义**。前端不能 import 服务端模块（会把服务端代码打进 app），所以是一份物理副本；
 * 「一个行为」由 `packages/opencode/test/server/case-hgraph-citation-parity.test.ts` 钉住。
 *
 * 本文件的输入表与后端 `openhive-case-citation.test.ts` 同款：两侧各自被同一张表钉住，
 * 任一侧改语义都会先在它自己那侧红（`#002-06`）。
 */
describe("解析出处（前端镜像）", () => {
  test("材料名不含 #：首/末 # 切出三段，单行时起=末、不是区间", () => {
    expect(解析出处("m1#Sheet1#12")).toEqual({ 材料: "m1", 工作表: "Sheet1", 起: 12, 末: 12, 是区间: false })
  })

  test("工作表名可含 #：中间整段都是工作表名", () => {
    expect(解析出处("m1#A#B#12")).toEqual({ 材料: "m1", 工作表: "A#B", 起: 12, 末: 12, 是区间: false })
  })

  test("区间：12-40 合法，起/末各自为整数", () => {
    expect(解析出处("m#t#12-40")).toEqual({ 材料: "m", 工作表: "t", 起: 12, 末: 40, 是区间: true })
  })

  test("区间写法按写法判：12-12 / 0012-0012 也是区间", () => {
    expect(解析出处("m#t#12-12")).toEqual({ 材料: "m", 工作表: "t", 起: 12, 末: 12, 是区间: true })
    expect(解析出处("m#t#0012-0012")).toEqual({ 材料: "m", 工作表: "t", 起: 12, 末: 12, 是区间: true })
  })

  test("区间反向：40-12 不合法", () => {
    expect(解析出处("m#t#40-12")).toBeNull()
  })

  test("行号非整数 ⇒ null", () => {
    expect(解析出处("m#t#1.5")).toBeNull()
    expect(解析出处("m#t#2#多余")).toBeNull()
  })

  test("任一段为空或缺 # ⇒ null", () => {
    expect(解析出处("没有井号")).toBeNull()
    expect(解析出处("m#t")).toBeNull()
    expect(解析出处("#t#1")).toBeNull()
    expect(解析出处("m##1")).toBeNull()
    expect(解析出处("m#t#")).toBeNull()
  })

  // 后端注释承诺的宽松写法：`02` 归一成 2、前后空白容忍。前端镜像必须同样宽松，
  // 否则同一个出处串在 AI 侧能定位、在检查器里却点不动。
  test("行号前后空白与 02 写法：照后端归一成数字", () => {
    expect(解析出处("m#t# 12 ")).toEqual({ 材料: "m", 工作表: "t", 起: 12, 末: 12, 是区间: false })
    expect(解析出处("m#t#02")).toEqual({ 材料: "m", 工作表: "t", 起: 2, 末: 2, 是区间: false })
  })
})
