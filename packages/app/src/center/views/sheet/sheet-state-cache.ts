import { 规模, type Cell, type SheetMeta } from "./sheet-model"
import type { SheetUiState } from "./sheet-grid"

export interface SheetCacheData {
  meta: SheetMeta
  rows: Cell[][]
  mode: "full" | "preview"
  truncated: { rows: number; cols: number }
}

const ui = new Map<string, SheetUiState>()
const data = new Map<string, SheetCacheData>()
/** 基键 → 这个文件上次看的那张表。重新打开时用它定位，才知道该读哪一份数据/UI 缓存。 */
const 上次表 = new Map<string, string>()

/** 键 = 项目身份 + 路径 + 重载代。换项目或重载后旧缓存自动失配。 */
export const 缓存键 = (项目: string, path: string, 代: number) => `${项目}\n${path}\n${代}`

/**
 * 单个工作表的键 = 基键 + 表名。**同一文件的不同表不共用**：
 * 列宽/筛选/排序/滚动位置与已解析数据都是「这张表」的，串到另一张上就是拿别人的表头量宽度。
 */
export const 表键 = (基键: string, 表: string) => `${基键}\n${表}`

export function 读上次表(基键: string): string | undefined {
  return 上次表.get(基键)
}

export function 记上次表(基键: string, 表: string): void {
  上次表.delete(基键)
  上次表.set(基键, 表)
  while (上次表.size > 规模.UI状态缓存份数) {
    const oldest = 上次表.keys().next().value
    if (oldest === undefined) break
    上次表.delete(oldest)
  }
}

export function 读UI状态(key: string): SheetUiState | undefined {
  const value = ui.get(key)
  if (!value) return undefined
  ui.delete(key)
  ui.set(key, value) // 读命中刷新 LRU 顺序
  return value
}

export function 写UI状态(key: string, state: SheetUiState): void {
  ui.delete(key)
  ui.set(key, state)
  while (ui.size > 规模.UI状态缓存份数) {
    const oldest = ui.keys().next().value
    if (oldest === undefined) break
    ui.delete(oldest)
  }
}

export function 清空UI状态(): void {
  ui.clear()
}

export function 数据格数(rows: readonly Cell[][]): number {
  return rows.reduce((sum, row) => sum + row.length, 0)
}

export function 读数据(key: string): SheetCacheData | undefined {
  const value = data.get(key)
  if (!value) return undefined
  data.delete(key)
  data.set(key, value)
  return value
}

/** 只在 ≤20 万格时缓存；返回是否真的缓存了。 */
export function 写数据(key: string, value: SheetCacheData): boolean {
  if (数据格数(value.rows) > 规模.缓存格上限) return false
  data.delete(key)
  data.set(key, value)
  while (data.size > 规模.缓存份数) {
    const oldest = data.keys().next().value
    if (oldest === undefined) break
    data.delete(oldest)
  }
  return true
}

export function 清空数据(): void {
  data.clear()
}

/**
 * 换项目时一次清掉两份缓存（UI 状态 + 解析数据）。
 *
 * 键里已经有了项目身份，正常不会再串台；这里再清一遍是防止换回旧项目时**读到换项目前**的
 * 旧数据（那可能是另一个会话/另一次落盘的内容）。两个 Map 必须一起清——只清一份时，
 * 另一份仍会让同路径的 tab 显示出不属于当前项目的内容。
 */
export function 清空表格缓存(): void {
  清空UI状态()
  清空数据()
  上次表.clear()
}
