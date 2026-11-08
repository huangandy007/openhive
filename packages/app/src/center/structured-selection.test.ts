import { afterEach, describe, expect, test } from "bun:test"
import { 多行选区文本, 行载荷, type 选区读数 } from "./structured-selection"

afterEach(() => {
  document.body.innerHTML = ""
})

/** 建一棵行树：`null` 表示这一行没有 `data-copy`（普通文字，不该进结构化载荷）。 */
function 建根(...行们: Array<string | null>): HTMLElement {
  const 根 = document.createElement("div")
  for (const 文本 of 行们) {
    const 行 = document.createElement("div")
    if (文本 !== null) 行.setAttribute("data-copy", 文本)
    const 内 = document.createElement("span")
    内.textContent = 文本 ?? "普通文字"
    行.appendChild(内)
    根.appendChild(行)
  }
  document.body.appendChild(根)
  return 根
}

/** 只认「命中集合」的选区替身：`happy-dom` 的 Selection 与真浏览器不同（同表格拖选那条口径）。 */
const 选区 = (命中: readonly Node[]): 选区读数 => {
  const 集 = new Set(命中)
  return { rangeCount: 1, isCollapsed: false, getRangeAt: () => ({ intersectsNode: (node: Node) => 集.has(node) }) }
}

describe("选区跨多行 ⇒ 每行一条（结构化载荷）", () => {
  test("跨两行：按 DOM 顺序，一行一条，用换行拼起来", () => {
    const 根 = 建根("出 → 甲（手机号）· 转账", "← 入 乙（人）· 亲属")
    const 行们 = [...根.children]
    expect(多行选区文本(根, 选区(行们))).toBe("出 → 甲（手机号）· 转账\n← 入 乙（人）· 亲属")
  })

  test("只命中一行 ⇒ 不接管（用户可能只想精确拖走这一行里的几个字）", () => {
    const 根 = 建根("出 → 甲（手机号）· 转账", "← 入 乙（人）· 亲属")
    expect(多行选区文本(根, 选区([根.children[0]]))).toBeUndefined()
  })

  test("命中两行、但只有一行带 data-copy ⇒ 只有一条，仍不接管", () => {
    const 根 = 建根("出 → 甲（手机号）· 转账", null)
    expect(多行选区文本(根, 选区([...根.children]))).toBeUndefined()
  })

  test("没有选区 / 选区折叠 / rangeCount 为 0 ⇒ 都不接管", () => {
    const 根 = 建根("甲", "乙")
    expect(多行选区文本(根, null)).toBeUndefined()
    expect(多行选区文本(根, undefined)).toBeUndefined()
    expect(多行选区文本(根, { ...选区([]), isCollapsed: true })).toBeUndefined()
    expect(多行选区文本(根, { ...选区([]), rangeCount: 0 })).toBeUndefined()
  })

  test("空 data-copy 不算一行（空白行不能把「一行内」凑成「跨两行」）", () => {
    const 根 = 建根("甲", "   ")
    expect(多行选区文本(根, 选区([...根.children]))).toBeUndefined()
  })
})

describe("没选区时右键落在哪一行 ⇒ 就是那一行的载荷", () => {
  test("从行内子元素往上找到那一行", () => {
    const 根 = 建根("出 → 甲（手机号）· 转账")
    const 子 = 根.querySelector("span")!
    expect(行载荷(子)).toBe("出 → 甲（手机号）· 转账")
  })

  test("不在任何行里 ⇒ 不接管（交给浏览器原生菜单）", () => {
    const 别处 = document.createElement("div")
    document.body.appendChild(别处)
    expect(行载荷(别处)).toBeUndefined()
    expect(行载荷(null)).toBeUndefined()
  })

  test("行有 data-copy 但是空的 ⇒ 不接管（空引用等于什么都没选）", () => {
    const 根 = 建根("")
    expect(行载荷(根.children[0])).toBeUndefined()
  })
})
