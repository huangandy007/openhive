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

/** 键 = 路径 + 重载代。重载后旧缓存自动失配。 */
export const 缓存键 = (path: string, 代: number) => `${path}\n${代}`

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
