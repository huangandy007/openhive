/** SheetJS 0.20.3（xlsx.mjs）的最小类型声明：只声明本转换器用到的面。 */
export interface 单元格 {
  w?: string
  v?: unknown
}
export interface 工作表 {
  "!ref"?: string
  [单元格: string]: unknown
}
export interface 工作簿 {
  SheetNames: string[]
  Sheets: Record<string, 工作表 | undefined>
}
export function read(
  数据: Uint8Array,
  选项?: { type?: string; cellDates?: boolean; cellFormula?: boolean },
): 工作簿
export const utils: {
  decode_range(范围: string): { s: { r: number; c: number }; e: { r: number; c: number } }
  encode_cell(位置: { r: number; c: number }): string
}
