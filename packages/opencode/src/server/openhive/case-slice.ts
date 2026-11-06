export * as OpenhiveCaseSlice from "./case-slice"

/**
 * 把一份长文本切成「适合一次模型调用」的片。
 *
 * ## 四条口径
 *
 * 1. **不重叠**：重叠会让同一段事实被抽两遍，实体去重能兜住、关系会重复（R7 的确定性 id
 *    也兜不住「同一段区间出现两次不同数字」）。宁可边界处的半句话交给下一片。
 * 2. **按行边界切**：笔录的语义单位是段；按字数硬切会把一句话劈开，模型的回读定位会跟着错。
 *    只有单行本身就超限时才硬切。
 * 3. **偏移是原文坐标**：`起/止` 直接进 `case_citation.locator`（0031 注释里的
 *    `{"start":0,"end":1200}`），面板要按它回跳原文。
 * 4. **纯空白段被丢弃**：`冲刷()` 与硬切都跳过 `trim()` 为空的片 ⇒ 有空白段时片与片之间
 *    会出现缺口，此时把所有 `片.文本` 拼起来不等于原文；没有空白段时拼接恰好能还原，但
 *    **别依赖这一点**——要还原原文一律按 `起/止` 取。
 *
 * 上限（R8）按**扫描成本**算，不按「看起来大不大」：超过就报错让用户拆文件，
 * 静默截断会让抽出来的结论看起来是完整的（`LEARNINGS #011-03` 同族）。
 */
export interface 文本片 {
  readonly 起: number
  readonly 止: number
  readonly 文本: string
}

export const 每片字数 = 1500
export const 最多片数 = 400

export function 切片(
  text: string,
  opts: { 每片字数?: number; 最多片数?: number } = {},
): 文本片[] {
  const 上限 = opts.每片字数 ?? 每片字数
  const 片数上限 = opts.最多片数 ?? 最多片数
  // 下限是 2 不是 1：上限为 1 时任何非 BMP 字符都必然被劈开，`j - 1 > i` 只能防死循环、
  // 防不了孤立代理；整数校验是为了让 `起/止` 始终能写进 locator。
  if (!Number.isInteger(上限) || 上限 < 2) throw new Error("每片字数必须是不小于 2 的整数")
  if (!Number.isInteger(片数上限) || 片数上限 < 1) throw new Error("最多片数必须是不小于 1 的整数")
  if (text.length > 上限 * 片数上限)
    throw new Error(
      `文本共 ${text.length} 字，超过单份材料上限（${片数上限} 片 × ${上限} 字）；请拆分后再导入`,
    )

  const 片: 文本片[] = []
  let 起 = 0
  let 长 = 0
  let 行首 = 0

  const 冲刷 = () => {
    if (长 === 0) return
    const 文本 = text.slice(起, 起 + 长)
    if (文本.trim() !== "") 片.push({ 起, 止: 起 + 长, 文本 })
    长 = 0
  }

  for (const 行 of text.split(/(?<=\n)/)) {
    if (行.length > 上限) {
      冲刷()
      for (let i = 0; i < 行.length; ) {
        let j = Math.min(i + 上限, 行.length)
        // 别把代理对劈成两半：末尾是高代理时退一格。
        // 下限已提到 2，`j - 1 > i` 现在恒真（`j - 1 ≥ i + 1 > i`）；留着防将来放宽下限时死循环。
        const 末 = 行.charCodeAt(j - 1)
        if (j < 行.length && j - 1 > i && 末 >= 0xd800 && 末 <= 0xdbff) j -= 1
        const 片段 = 行.slice(i, j)
        if (片段.trim() !== "") 片.push({ 起: 行首 + i, 止: 行首 + j, 文本: 片段 })
        i = j
      }
      行首 += 行.length
      continue
    }
    if (长 > 0 && 长 + 行.length > 上限) 冲刷()
    if (长 === 0) 起 = 行首
    长 += 行.length
    行首 += 行.length
  }
  冲刷()

  if (片.length > 片数上限) throw new Error(`文本超过 ${片数上限} 片；请拆分后再导入`)
  return 片
}
