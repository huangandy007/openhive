import type { 模型调用, 抽取器 } from "../../src/server/openhive/case-extract-run"

/** 按「第几片」返回固定对象；`第几片` 从 1 起（用户提示里的序号）。 */
export function 建假抽取器(回答: (片序号: number) => unknown): 抽取器 & { 调用次数: () => number } {
  let n = 0
  const 调用: 模型调用 = async (输入) => {
    n += 1
    const m = /第 (\d+)\/\d+ 片/.exec(输入.用户)
    return 回答(m ? Number(m[1]) : 1)
  }
  return { 模型标识: "fake/model", 调用, 调用次数: () => n }
}
