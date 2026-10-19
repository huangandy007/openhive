import type { Cell } from "./sheet-model"

/**
 * 中栏表格拖选 → 右栏会话框的载荷格式（2026-10-19 用户提出）。
 *
 * 浏览器对表格里跨行选中的 `text/plain` 是**按块级元素换行**：每个单元格都是一个 div，
 * 于是「一行 5 个字段」被拖进会话框后变成 5 行文字。这里改成 TSV：**一行数据一条文本**，
 * 字段之间用制表符。右栏 `拖入正文` 只读 `text/plain`（`ai-session/drop-reference.ts`），
 * 不需要第二套格式。
 */

/** 单元格内容里的制表符/换行会把 TSV 的行列结构撑破，统一压成空格。 */
const 清洗单元格 = (value: Cell | undefined) => (value ?? "").replace(/[\t\r\n]+/g, " ")

/**
 * 选中的矩形 → TSV。
 *
 * @param rows 原始行数据（`store.rows`），下标是原始行号
 * @param 行   选中的原始行号（显示序由调用方排好）
 * @param 列   选中的列号（按显示序）
 * @param 表头 所选列的字段名（与 `列` 一一对应）。给了就占第一行——模型靠它知道
 *             每个字段是什么，不用猜；不给则保持纯数据载荷。
 */
export function 选区转TSV(
  rows: readonly (readonly Cell[])[],
  行: readonly number[],
  列: readonly number[],
  表头?: readonly string[],
): string {
  const 数据行 = 行.map((row) => 列.map((col) => 清洗单元格(rows[row]?.[col])).join("\t"))
  if (!表头) return 数据行.join("\n")
  return [表头.map((name) => 清洗单元格(name)).join("\t"), ...数据行].join("\n")
}

/** 选区只需要这两下：判断节点是否被选中、是否为空。 */
export interface 选区读数 {
  rangeCount: number
  isCollapsed: boolean
  getRangeAt(index: number): { intersectsNode(node: Node): boolean }
}

export interface 选区矩形 {
  /** 原始行号，按显示序。 */
  行: number[]
  /** 列号，按显示序；不含隐藏列。 */
  列: number[]
}

/**
 * 从 DOM 选区和当前渲染窗口反推矩形。
 *
 * 只认已经渲染出来的行/格（虚拟滚动只渲染窗口，选区也不可能落在没渲染的节点上）；
 * 行取首末命中行在**显示序**里的区间——同一段线性选区不会跳过中间行，逐行收集会漏掉
 * 文本节点没覆盖到的行。
 *
 * 列取**起止格**（DOM 序第一个/最后一个命中格）的列号区间，再按 `可见列号` 过滤隐藏列。
 * ⚠️ 不能用「所有命中格的 min–max」：选区是线性的，从第 0 行第 0 列拖到第 1 行第 1 列，
 * 浏览器会把第 0 行**整行**都算进选区，min–max 于是扩成 40 列（2026-10-19 真栈实测：
 * 两行两列的拖选载荷第一行 40 个字段）。起止格才对应「从哪个格拖到哪个格」的意图。
 */
export function 拖拽选区(
  滚动根: Element,
  selection: 选区读数 | null | undefined,
  显示行: readonly number[],
  可见列号: readonly number[],
): 选区矩形 | undefined {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  const 命中行: number[] = []
  const 命中列: number[] = []
  for (const row of 滚动根.querySelectorAll<HTMLElement>('[data-slot="sheet-row"]')) {
    if (!range.intersectsNode(row)) continue
    命中行.push(Number(row.dataset.row))
    for (const cell of row.querySelectorAll<HTMLElement>('[role="gridcell"][data-col]')) {
      if (range.intersectsNode(cell)) 命中列.push(Number(cell.dataset.col))
    }
  }
  if (命中行.length === 0 || 命中列.length === 0) return undefined

  const 位置 = 命中行.map((raw) => 显示行.indexOf(raw)).filter((index) => index >= 0)
  if (位置.length === 0) return undefined
  const 行 = 显示行.slice(Math.min(...位置), Math.max(...位置) + 1)

  const 起列 = Math.min(命中列[0], 命中列[命中列.length - 1])
  const 止列 = Math.max(命中列[0], 命中列[命中列.length - 1])
  const 列 = 可见列号.filter((index) => index >= 起列 && index <= 止列)
  if (列.length === 0) return undefined
  return { 行, 列 }
}
