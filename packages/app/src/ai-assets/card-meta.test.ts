import { describe, expect, test } from "bun:test"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { 卡片统计 } from "./card-meta"
import { 样例资产 } from "./asset-story-fixtures"

/**
 * 卡片统计（2026-10-30）：收藏数 / 近 N 天使用次数，卡片与详情页**同源**。
 *
 * 断言纪律（`#006-22` / `#005-47`）：title 用**全等**而非 `toContain`——「有记录」和
 * 「没记录」两态的前半段一模一样，子串匹配会让「恒回有记录」的变异体照样绿；夹具也把
 * `favoriteCount` 设成非 0，避免「默认值刚好满足断言」。
 */
const 资产 = (over: Partial<AssetMetadata> = {}): AssetMetadata =>
  样例资产({ id: "a1", name: "资金分析", favoriteCount: 3, ...over })

const 用量 = (days: number, stats: Readonly<Record<string, { users: number; calls: number }>>) => ({
  days,
  stats,
})

describe("卡片统计 · 使用次数", () => {
  test("skill 有记录 ⇒ 使用「12次」，title 写清天数 / 人数 / 次数", () => {
    const 统计 = 卡片统计(资产(), 用量(30, { a1: { users: 3, calls: 12 } }))
    expect(统计.收藏).toBe("3")
    expect(统计.使用).toBe("12次")
    // 天数来自 usage.days（这里 30），不是前端硬编码。
    expect(统计.title).toBe("收藏：3 人；使用：最近 30 天 · 3 人用过 · 共 12 次")
  })

  test("skill 给了 usage 但该资产没记录 ⇒ 使用「0次」，title 说「还没人用过」", () => {
    // 给的是**别的**资产的记录：这条资产本身不在 stats 里。
    const 统计 = 卡片统计(资产(), 用量(30, { b2: { users: 9, calls: 99 } }))
    expect(统计.使用).toBe("0次")
    expect(统计.title).toBe("收藏：3 人；使用：最近 30 天还没人用过")
  })

  test("非 skill（mcp）就算 stats 里有它的 id，也不显示使用段", () => {
    // 抽取器只统计 skill 工具调用：给 MCP 显示「0次」或「12次」都是假话。
    const 统计 = 卡片统计(资产({ type: "mcp" }), 用量(30, { a1: { users: 3, calls: 12 } }))
    expect(统计.使用).toBeUndefined()
    expect(统计.title).toBe("收藏：3 人")
  })

  test("usage 缺省（旧内核没给 usageStats）⇒ 不显示使用段，title 只有收藏", () => {
    // 「没有这个信息」≠「没人用过」：不能显示 0 次。
    const 统计 = 卡片统计(资产({ favoriteCount: 0 }), undefined)
    expect(统计.使用).toBeUndefined()
    expect(统计.title).toBe("收藏：0 人")
  })

  test("收藏为 0 也照实显示 0", () => {
    const 统计 = 卡片统计(资产({ favoriteCount: 0 }), undefined)
    expect(统计.收藏).toBe("0")
  })

  test("天数不硬编码：usage.days 是 7 时 title 就写「最近 7 天」", () => {
    const 统计 = 卡片统计(资产(), 用量(7, { a1: { users: 3, calls: 12 } }))
    expect(统计.title).toBe("收藏：3 人；使用：最近 7 天 · 3 人用过 · 共 12 次")
  })
})
