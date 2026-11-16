/**
 * 手画边纯构造器（012 · K1 / R-F1，修复轮 2026-11-16）。
 *
 * 口径：手画边**固定** `性质:"推断"`、`来源 = {kind:"手写", 依据}`（FR-006 / FR-017：
 * 任何入口拒绝无依据推断；设计 §5.7.2.1：手工对象无出处）。构造器只产数据，不发写、不碰 UI。
 */
import { describe, expect, test } from "bun:test"
import { 可连线, 手画边 } from "./edge"

describe("手画边", () => {
  test("每个字段逐字钉死：推断 / 有向 / 手写来源 / 空时间 / 空标签", () => {
    const 条 = 手画边("n1", "n2", { 依据: "两人同日同酒店入住", 可信度: "中" })

    expect(条).toEqual({
      id: expect.stringMatching(/^临时e\d+$/),
      从: "n1",
      到: "n2",
      标签: "",
      性质: "推断",
      方向: "有向",
      来源: { kind: "手写", 依据: "两人同日同酒店入住" },
      可信度: "中",
      时间: { 首: "", 末: "" },
    })
  })

  test("显式 id 原样使用；可选 `标签` / `方向` 照传", () => {
    const 条 = 手画边("n1", "n2", { 依据: "转账", 可信度: "高", 标签: "资金", 方向: "无向" }, "临时e42")

    expect(条.id).toBe("临时e42")
    expect(条.标签).toBe("资金")
    expect(条.方向).toBe("无向")
    expect(条.可信度).toBe("高")
  })

  test("`依据` 原文保留：不去空格、不 trim（与后端 `非空串` 只判有没有内容同口径）", () => {
    const 条 = 手画边("n1", "n2", { 依据: "  两人 同日  ", 可信度: "低" })

    expect(条.来源).toEqual({ kind: "手写", 依据: "  两人 同日  " })
    expect(条.可信度).toBe("低")
  })

  test("两次调用得到不同临时 id（共用 `temp-id` 计数器）", () => {
    const 甲 = 手画边("n1", "n2", { 依据: "甲", 可信度: "中" })
    const 乙 = 手画边("n1", "n2", { 依据: "乙", 可信度: "中" })

    expect(甲.id).not.toBe(乙.id)
  })
})

describe("可连线", () => {
  test("只有空白 ⇒ false；有内容 ⇒ true（UI 用它禁用确认）", () => {
    expect(可连线("")).toBe(false)
    expect(可连线("   ")).toBe(false)
    expect(可连线("\n\t")).toBe(false)
    expect(可连线("甲")).toBe(true)
    expect(可连线("  甲  ")).toBe(true)
  })
})
