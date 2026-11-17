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

/**
 * 行级出处作为 `get_citation` 事实id 的形状。
 *
 * `出处项`（`case-envelope.ts:59-65`）的 `代表` 是 `材料#工作表#行号`，`可下钻` 指向
 * `get_citation`；而 `get_citation` 的 row 分支只接受**单行**写法，区间（含 `12-12`）
 * 是「出处汇总」的写法、会被拒成 `bad_input`（`case-mcp-tools.ts:1447-1452`）。
 * 「单行 / 区间」的判据只有 `解析出处.是区间` 一处，这里钉住的正是它决定可下钻与否。
 */
describe("行级出处作为 get_citation 事实id 的形状", () => {
  test("单行定位可原样回喂：解析出的是单行，重建后与 id 逐字相同", () => {
    const 定位 = "m-甲#Sheet1#2"
    const 出 = 解析出处(定位)
    expect(出).not.toBeNull()
    if (出 === null) return
    // 拒的是「是区间」，不是「起 === 末」：这里必须断言 `是区间 === false`。
    expect(出.是区间).toBe(false)
    // 规范 id（无补零、无区间）解析后不改写，可原样作为 `事实id` 回喂。
    expect(`${出.材料}#${出.工作表}#${出.起}`).toBe(定位)
  })

  test("压缩出处分流：单行段可下钻，区间段是汇总写法不能当事实id", () => {
    const 压缩 = 压缩出处("m", "t", [12, 13, 14, 20])
    expect(压缩).toHaveLength(2)
    const [区间, 单行] = 压缩
    if (区间 === undefined || 单行 === undefined) throw new Error("压缩出处应给出区间与单行两段")
    // 多行写成 `起-末`：`是区间 === true` ⇒ `get_citation` 的 row 分支必拒
    // （真栈行为在 mcp-tools 用例里钉 `bad_input`）。
    expect(解析出处(区间)?.是区间).toBe(true)
    // 单行仍是 `m#t#20`：`是区间 === false` ⇒ 可作为 `事实id` 下钻。
    expect(解析出处(单行)?.是区间).toBe(false)
  })
})
