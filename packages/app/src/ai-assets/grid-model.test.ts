import { describe, expect, test } from "bun:test"
import { 卡片行距, 卡片高, 网格列数, 网格行数 } from "./grid-model"

/**
 * 中栏网格的纯逻辑（009 T006 / DESIGN §4.9）。
 *
 * 只剩**几何**：列数（宽 → 列，DOM 量不到时也有确定答案）与行数（虚拟滚动的行总数）。
 *
 * 筛选与搜索口径已随需求 6 下推服务端（`packages/asset-service/src/asset.ts` 的 `search` 条件），
 * 这里不再持有第二份（`#002-06`）。
 */

describe("网格列数", () => {
  test("按 240px 最小卡宽 + 12px 列距算，至少 1 列", () => {
    expect(网格列数(0)).toBe(1)
    expect(网格列数(251)).toBe(1)
    expect(网格列数(252)).toBe(1)
    expect(网格列数(504)).toBe(2)
    expect(网格列数(756)).toBe(3)
    expect(网格列数(1024)).toBe(4)
  })

  test("行高常量：卡片 132px + 行距 12px（虚拟滚动按它算）", () => {
    expect(卡片高).toBe(132)
    expect(卡片行距).toBe(12)
  })
})

describe("网格行数", () => {
  test("按列数向上取整；0 项是 0 行", () => {
    expect(网格行数(0, 3)).toBe(0)
    expect(网格行数(1, 3)).toBe(1)
    expect(网格行数(3, 3)).toBe(1)
    expect(网格行数(4, 3)).toBe(2)
    expect(网格行数(20, 4)).toBe(5)
  })
})
