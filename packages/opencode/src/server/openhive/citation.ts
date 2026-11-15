/**
 * 行级出处 `材料#工作表#行号` 的**唯一**解析实现（012 research R7 / data-model §5.6）。
 *
 * 形状：首 `#` 结束材料 id（材料 id 不含 `#`），末 `#` 开始行号，中间整段是工作表名
 * （**可含 `#`**——Excel 工作表名可以合法含 `#`，按固定段数拆会错位，见 `case-store.ts:423-432`）。
 * 区间写作 `材料#表#起-末`。`get_citation` 的 row 分支与关系图文件校验都调这里，
 * 不许再写第二份（`#002-06`：同一前提单一出处）。
 */

/** 一条行级出处：单行时 `起 === 末`。 */
export interface 出处 {
  readonly 材料: string
  readonly 工作表: string
  readonly 起: number
  readonly 末: number
}

/**
 * 解析行级出处；形状不对、任一段为空、行号非整数、区间反向 ⇒ `null`。
 *
 * 单行的行号判据沿用 `get_citation` 原来的 `Number.isInteger(Number(行号))`：
 * `"02"` 能解析成 `2`（写回时按规范化数字），前后空白也照旧容忍。
 */
export function 解析出处(串: string): 出处 | null {
  const 首 = 串.indexOf("#")
  const 末位 = 串.lastIndexOf("#")
  if (首 <= 0 || 末位 === 首) return null
  const 材料 = 串.slice(0, 首)
  const 工作表 = 串.slice(首 + 1, 末位)
  const 行号段 = 串.slice(末位 + 1)
  if (材料.trim() === "" || 工作表 === "" || 行号段.trim() === "") return null
  // 单行：`02` 与 `2` 是同一行，库里 `fact_id` 的写法是规范化数字。
  const 单 = Number(行号段)
  if (Number.isInteger(单)) return { 材料, 工作表, 起: 单, 末: 单 }
  // 区间 `起-末`：两端都必须是正整数，且起 ≤ 末；反向区间不是「换个写法」，是坏数据。
  const 区间 = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(行号段)
  if (区间 === null) return null
  const 起 = Number(区间[1])
  const 末 = Number(区间[2])
  return 起 <= 末 ? { 材料, 工作表, 起, 末 } : null
}

/** 同一材料的行数超过这么多时，出处只保留首末区间（明细回材料查，FR-003）。 */
export const 出处行上限 = 50

/**
 * 把同一材料 / 工作表下的行号压成出处串：连续行合并为 `材料#表#起-末`，单点仍写
 * `材料#表#行`。**按输入顺序**输出（不排序）——调用方给的顺序就是显示顺序。
 *
 * 超过 `出处行上限` 行时只留首末区间：`[1..51] ⇒ "材料#表#1-51"`，不再逐段列出。
 */
export function 压缩出处(材料: string, 工作表: string, 行号: readonly number[]): string[] {
  if (行号.length === 0) return []
  const 头 = `${材料}#${工作表}#`
  if (行号.length > 出处行上限) {
    // 用 min/max 而不是首尾元素：输入顺序不保证升序，区间必须起 ≤ 末。
    const 首 = 行号.reduce((甲, 乙) => Math.min(甲, 乙))
    const 末 = 行号.reduce((甲, 乙) => Math.max(甲, 乙))
    return [`${头}${首}-${末}`]
  }
  const 结果: string[] = []
  let 起 = 行号[0]
  let 末 = 起
  const 收 = () => {
    结果.push(起 === 末 ? `${头}${起}` : `${头}${起}-${末}`)
  }
  for (const 行 of 行号.slice(1)) {
    if (行 === 末 + 1) {
      末 = 行
      continue
    }
    收()
    起 = 行
    末 = 行
  }
  收()
  return 结果
}
