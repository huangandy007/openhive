import { beforeEach, describe, expect, test } from "bun:test"
import {
  缓存键,
  清空UI状态,
  清空数据,
  清空表格缓存,
  写UI状态,
  写数据,
  读UI状态,
  读数据,
  数据格数,
} from "./sheet-state-cache"
import type { SheetUiState } from "./sheet-grid"

const 状态 = (n: number): SheetUiState => ({
  headerIsFirstRow: true,
  columns: [{ index: 0, letter: "A", name: "姓名", type: "text", width: 100 + n, hidden: false }],
  filters: [],
  sort: undefined,
  scrollTop: n,
  scrollLeft: 0,
})

beforeEach(() => {
  清空UI状态()
  清空数据()
})

describe("UI 状态 LRU", () => {
  test("最多 20 份，挤掉最久未用", () => {
    for (let i = 0; i <= 20; i++) 写UI状态(`k${i}`, 状态(i))
    expect(读UI状态("k0")).toBeUndefined()
    expect(读UI状态("k20")?.scrollTop).toBe(20)
  })

  test("读命中刷新顺序", () => {
    for (let i = 0; i < 20; i++) 写UI状态(`k${i}`, 状态(i))
    读UI状态("k0")
    写UI状态("k20", 状态(20))
    expect(读UI状态("k0")).toBeDefined()
    expect(读UI状态("k1")).toBeUndefined()
  })

  test("键含重载代", () => {
    expect(缓存键("项目甲", "/案卷/名单.xlsx", 0)).not.toBe(缓存键("项目甲", "/案卷/名单.xlsx", 1))
    expect(缓存键("项目甲", "/案卷/名单.xlsx", 0)).toBe("项目甲\n/案卷/名单.xlsx\n0")
  })

  test("键含项目身份：同 path 不同项目不串台，同一键读写仍命中", () => {
    // 换项目时重载代会被重置为 0（`清空会话改过`），只按 path+代 做键会让项目 B 读到项目 A 的数据。
    expect(缓存键("项目甲", "/案卷/名单.xlsx", 0)).not.toBe(缓存键("项目乙", "/案卷/名单.xlsx", 0))
    const key = 缓存键("项目甲", "/案卷/名单.xlsx", 3)
    expect(缓存键("项目甲", "/案卷/名单.xlsx", 0)).not.toBe(key)
    写UI状态(key, 状态(42))
    expect(读UI状态(key)?.scrollTop).toBe(42)
  })
})

describe("数据缓存 LRU", () => {
  const 数据 = (cells: number) => ({
    meta: {
      sheetNames: ["明细"],
      sheetName: "明细",
      startRow: 0,
      startCol: 0,
      totalRows: 2,
      totalCols: 2,
      header: ["A", "B"],
      preview: [["A", "B"], ["1", "2"]],
      columnTypes: ["text", "text"] as ("text" | "number" | "date" | "datetime")[],
    },
    rows: Array.from({ length: Math.ceil(cells / 2) }, () => ["1", "2"]),
    mode: "full" as const,
    truncated: { rows: 0, cols: 0 },
  })

  test("≤20 万格才缓存；超过返回 false", () => {
    expect(写数据("small", 数据(200_000))).toBe(true)
    expect(写数据("big", 数据(200_002))).toBe(false)
    expect(读数据("big")).toBeUndefined()
  })

  test("最多 3 份，挤掉最久未用", () => {
    for (let i = 0; i < 3; i++) 写数据(`k${i}`, 数据(10))
    读数据("k0")
    写数据("k3", 数据(10))
    expect(读数据("k0")).toBeDefined()
    expect(读数据("k1")).toBeUndefined()
    expect(读数据("k3")).toBeDefined()
  })

  test("数据格数按行累加", () => {
    expect(数据格数([["1", "2"], ["3"]])).toBe(3)
  })

  test("清空表格缓存同时清 UI 状态与数据缓存", () => {
    写UI状态("k", 状态(1))
    写数据("k", 数据(10))
    清空表格缓存()
    expect(读UI状态("k")).toBeUndefined()
    expect(读数据("k")).toBeUndefined()
  })
})
