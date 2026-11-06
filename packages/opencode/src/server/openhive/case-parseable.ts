export * as OpenhiveCaseParseable from "./case-parseable"

/**
 * 表格材料的扩展名白名单——**全仓唯一一份**。
 *
 * 计划 2 里它私有在 `file.ts`；计划 3 的右键「解析入库」与材料视图的 `parseable` 也要问
 * 同一个问题。三处各写一份 `.endsWith` 就是 `LEARNINGS #002-06` 那种「同一前提两处各判，
 * 然后只改一处」的老账，故收口到这里。
 *
 * ⚠️ 只比**小写后缀**，不猜内容：`.xlsm` / `.xlsx.bak` / 尾随空格都不认。
 */
export const 可解析扩展名 = [".xlsx", ".xls", ".csv"] as const

export function 可解析表格(path: string): boolean {
  const 低 = path.toLowerCase()
  return 可解析扩展名.some((扩展名) => 低.endsWith(扩展名))
}
