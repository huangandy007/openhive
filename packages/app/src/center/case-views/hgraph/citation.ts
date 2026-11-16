/**
 * 行级出处 `材料#工作表#行号` 的**前端镜像**（012 · T6 / R-F10 / FR-033）。
 *
 * 唯一实现是 `packages/opencode/src/server/openhive/citation.ts` 的 `解析出处`；前端不能
 * import 服务端模块（会把服务端代码打进 app），所以这里是一份**逐字同语义的物理副本**。
 * 「两处物理副本、一个行为」由 `packages/opencode/test/server/case-hgraph-citation-parity.test.ts`
 * 钉住（`#002-06`：不靠口头保证一致）。
 *
 * 形状：首 `#` 结束材料 id（材料 id 不含 `#`），末 `#` 开始行号，中间整段是工作表名
 * （**可含 `#`**——Excel 工作表名可以合法含 `#`，按固定段数拆会错位）。
 * 区间写作 `材料#表#起-末`。
 */

/**
 * 一条行级出处：单行时 `起 === 末`。
 *
 * `是区间` 按**写法**判，不看起末是否相等：`12-40` 与 `12-12` 都是区间写法，`12` 不是。
 */
export interface 出处 {
  readonly 材料: string
  readonly 工作表: string
  readonly 起: number
  readonly 末: number
  readonly 是区间: boolean
}

/**
 * 解析行级出处；形状不对、任一段为空、行号非整数、区间反向 ⇒ `null`。
 *
 * 单行的行号判据沿用后端 `Number.isInteger(Number(行号段))`：`"02"` 能解析成 `2`，
 * 前后空白也照旧容忍。**改这里必须同时改后端并用 parity 用例确认**。
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
  if (Number.isInteger(单)) return { 材料, 工作表, 起: 单, 末: 单, 是区间: false }
  // 区间 `起-末`：两端都必须是非负整数，且起 ≤ 末；反向区间不是「换个写法」，是坏数据。
  const 区间 = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(行号段)
  if (区间 === null) return null
  const 起 = Number(区间[1])
  const 末 = Number(区间[2])
  return 起 <= 末 ? { 材料, 工作表, 起, 末, 是区间: true } : null
}
