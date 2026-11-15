import { describe, expect, test } from "bun:test"
import { 压缩出处, 解析出处 } from "../../src/server/openhive/citation"

/**
 * 行级出处 `材料#工作表#行号` 的唯一解析实现（012 T002 / research R7）。
 *
 * 形状：首 `#` 结束材料 id（材料 id 不含 `#`），末 `#` 开始行号，中间整段是工作表名
 * （**可含 `#`**，见 `case-store.ts:423-432`）。区间写作 `材料#表#起-末`。
 * `get_citation` 的 row 分支改为调用 `解析出处`，行为不变（抽取前后既有用例全绿）。
 */
describe("解析出处", () => {
  test("材料名不含 #：首/末 # 切出三段，单行时起=末、不是区间", () => {
    expect(解析出处("m1#Sheet1#12")).toEqual({ 材料: "m1", 工作表: "Sheet1", 起: 12, 末: 12, 是区间: false })
  })

  test("工作表名可含 #：中间整段都是工作表名", () => {
    // 按固定段数拆会错位：`m1#A#B#12` 的表名是 `A#B`，不是 `A`。
    expect(解析出处("m1#A#B#12")).toEqual({ 材料: "m1", 工作表: "A#B", 起: 12, 末: 12, 是区间: false })
  })

  test("区间：12-40 合法，起/末各自为整数", () => {
    expect(解析出处("m#t#12-40")).toEqual({ 材料: "m", 工作表: "t", 起: 12, 末: 40, 是区间: true })
  })

  test("区间写法按写法判：12-12 / 0012-0012 也是区间", () => {
    // `是区间` 不看起末是否相等——`get_citation` 据此拒绝（旧实现也拒 `12-12`）。
    expect(解析出处("m#t#12-12")).toEqual({ 材料: "m", 工作表: "t", 起: 12, 末: 12, 是区间: true })
    expect(解析出处("m#t#0012-0012")).toEqual({ 材料: "m", 工作表: "t", 起: 12, 末: 12, 是区间: true })
  })

  test("区间反向：40-12 不合法", () => {
    expect(解析出处("m#t#40-12")).toBeNull()
  })

  test("行号非整数 ⇒ null", () => {
    expect(解析出处("m#t#1.5")).toBeNull()
    // 多余的一段不是「多一个工作表」：末段是行号，非整数 ⇒ 不合法。
    expect(解析出处("m#t#2#多余")).toBeNull()
  })

  test("任一段为空或缺 # ⇒ null", () => {
    expect(解析出处("没有井号")).toBeNull()
    expect(解析出处("m#t")).toBeNull()
    expect(解析出处("#t#1")).toBeNull()
    expect(解析出处("m##1")).toBeNull()
    expect(解析出处("m#t#")).toBeNull()
  })
})

describe("压缩出处", () => {
  test("连续行压缩为区间，不连续的分开", () => {
    expect(压缩出处("m", "t", [12, 13, 14, 20])).toEqual(["m#t#12-14", "m#t#20"])
  })

  test("超过 50 行只留首末区间", () => {
    const 行号 = Array.from({ length: 51 }, (_, i) => i + 1)
    expect(压缩出处("m", "t", 行号)).toEqual(["m#t#1-51"])
  })

  test("恰好 50 行仍按连续段压缩（不触发首末截断）", () => {
    const 行号 = Array.from({ length: 50 }, (_, i) => i + 1)
    expect(压缩出处("m", "t", 行号)).toEqual(["m#t#1-50"])
  })

  test("保持输入顺序：不排序，按连续段出现的先后输出", () => {
    expect(压缩出处("m", "t", [7, 8, 1, 2])).toEqual(["m#t#7-8", "m#t#1-2"])
  })

  test("重复行号先去重（保持输入顺序），不产出重叠区间", () => {
    expect(压缩出处("m", "t", [12, 13, 12, 14, 20, 13])).toEqual(["m#t#12-14", "m#t#20"])
  })

  test("空输入 ⇒ 空数组", () => {
    expect(压缩出处("m", "t", [])).toEqual([])
  })
})
