import { describe, expect, test } from "bun:test"
import { 拖拽选区, 选区转TSV, type 选区读数 } from "./sheet-drag"

describe("选区转 TSV", () => {
  const rows = [
    ["姓名", "金额", "备注"],
    ["张三", "1200", "现金"],
    ["李四", "300", ""],
  ]

  test("一行数据一条文本，字段之间是制表符；没选表头就不带表头", () => {
    expect(选区转TSV(rows, [1, 2], [0, 1])).toBe("张三\t1200\n李四\t300")
  })

  test("单列与缺值：空位就是空串，不凭空补内容", () => {
    expect(选区转TSV([["甲", "乙"], ["丙"]], [0, 1], [1])).toBe("乙\n")
  })

  test("单元格里的制表符/换行压成空格，不破坏行列结构", () => {
    expect(选区转TSV([["a\tb", "c\nd"]], [0], [0, 1])).toBe("a b\tc d")
  })
})

describe("拖拽选区 → 矩形", () => {
  /** 按 data-row / data-col 造一个最小网格：3 行 × 3 格。 */
  function 造网格() {
    const 根 = document.createElement("div")
    const 行们: HTMLElement[] = []
    const 格们: HTMLElement[][] = []
    for (let row = 1; row <= 3; row++) {
      const 行 = document.createElement("div")
      行.dataset.slot = "sheet-row"
      行.dataset.row = String(row)
      const 格行: HTMLElement[] = []
      for (let col = 0; col < 3; col++) {
        const 格 = document.createElement("div")
        格.setAttribute("role", "gridcell")
        格.dataset.col = String(col)
        行.appendChild(格)
        格行.push(格)
      }
      根.appendChild(行)
      行们.push(行)
      格们.push(格行)
    }
    return { 根, 行们, 格们 }
  }

  const 假选区 = (选中: Set<Node>): 选区读数 => ({
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => ({ intersectsNode: (node) => 选中.has(node) }),
  })

  test("跨两行两列：行按显示序取区间，列取 min–max", () => {
    const { 根, 行们, 格们 } = 造网格()
    const 选中 = new Set<Node>([行们[0], 行们[1], 格们[0][0], 格们[0][1], 格们[1][1]])
    expect(拖拽选区(根, 假选区(选中), [1, 2, 3], [0, 1, 2])).toEqual({ 行: [1, 2], 列: [0, 1] })
  })

  test("首行整行被线性选区覆盖时，列范围仍按起止格——min–max 会误扩到全部列", () => {
    const { 根, 行们, 格们 } = 造网格()
    // 真浏览器从 (行0,列0) 拖到 (行1,列1)：行0 的**所有**格都在选区里，行1 只有前两格。
    const 选中 = new Set<Node>([行们[0], 行们[1], ...格们[0], 格们[1][0], 格们[1][1]])
    expect(拖拽选区(根, 假选区(选中), [1, 2, 3], [0, 1, 2])).toEqual({ 行: [1, 2], 列: [0, 1] })
  })

  test("区间里的隐藏列被过滤掉（可见列号不含它）", () => {
    const { 根, 行们, 格们 } = 造网格()
    const 选中 = new Set<Node>([行们[0], 格们[0][0], 格们[0][2]])
    expect(拖拽选区(根, 假选区(选中), [1, 2, 3], [0, 2])).toEqual({ 行: [1], 列: [0, 2] })
  })

  test("没有选区 / 空选区：不接管，让浏览器走默认拖拽", () => {
    const { 根 } = 造网格()
    expect(拖拽选区(根, null, [1, 2, 3], [0, 1, 2])).toBeUndefined()
    expect(
      拖拽选区(根, { rangeCount: 0, isCollapsed: true, getRangeAt: () => ({ intersectsNode: () => true }) }, [1], [0]),
    ).toBeUndefined()
  })
})
