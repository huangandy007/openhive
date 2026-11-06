export * as OpenhiveCaseParseable from "./case-parseable"

/**
 * 可解析材料的扩展名白名单——**全仓唯一一份**。
 *
 * 计划 2 只有表格；计划 4 增加文本类（AI 抽取 harness）。上传自动入队（`file.ts`）、
 * 右键入队（`case-parse.ts`）、材料视图的 `parseable`（`case-materials.ts`）三处问的是
 * 同一个问题，三处各写一份 `.endsWith` 就是 `LEARNINGS #002-06` 那种「同一前提两处各判，
 * 然后只改一处」的老账。
 *
 * ⚠️ 只比**小写后缀**，不猜内容：`.xlsm` / `.docx.bak` / 尾随空格都不认。
 */
export const 表格扩展名 = [".xlsx", ".xls", ".csv"] as const
export const 文本扩展名 = [".txt", ".md", ".log", ".docx"] as const
export const 可解析扩展名 = [...表格扩展名, ...文本扩展名] as const

export type 解析方式 = "表格" | "文本"

export function 解析方式(path: string): 解析方式 | undefined {
  const 低 = path.toLowerCase()
  if (表格扩展名.some((扩展名) => 低.endsWith(扩展名))) return "表格"
  if (文本扩展名.some((扩展名) => 低.endsWith(扩展名))) return "文本"
  return undefined
}

export function 可解析表格(path: string): boolean {
  return 解析方式(path) === "表格"
}

export function 可解析材料(path: string): boolean {
  return 解析方式(path) !== undefined
}
