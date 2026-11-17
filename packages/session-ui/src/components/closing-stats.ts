/**
 * 收尾行统计与文案纯函数（015 data-model §5 / contracts/ui-card-contract.md §3）。
 *
 * 不碰 DOM / Solid；工具输出只经 `解析工具输出` 认信封（`#002-06` 同一口径单一出处），
 * 这里不 `JSON.parse`。
 */

import { 是信封工具键, 信封工具名, 解析工具输出 } from "./envelope-parse"

/** 调用方传整条消息的 parts（含非工具 part）；非工具 part 一律跳过。 */
export interface 统计输入部件 {
  readonly tool?: string
  readonly state?: { readonly status?: string; readonly output?: unknown }
}

export interface 收尾统计 {
  readonly 查询次数: number
  readonly 覆盖材料数: number
  readonly 缺口总项: number
  readonly 首条缺口: string | null
}

export type 译文 = (键: string, 参数?: Record<string, string | number | boolean>) => string

/**
 * 图工具的 part 键是 `openhive-case_graph_add`（`McpCatalog.toolName` 拼出），
 * 能通过 `是信封工具键` 的前缀判定 ⇒ 必须显式排除，否则图工具会多算一次。
 */
const 是图工具键 = (工具键: string) => 信封工具名(工具键).startsWith("graph_")

/** `代表` 的归属键：`#` 之前段（`m-甲#账户表#1` ⇒ `m-甲`）；没有 `#` 时用全串。 */
const 材料键 = (代表: string) => {
  const 位置 = 代表.indexOf("#")
  return 位置 === -1 ? 代表 : 代表.slice(0, 位置)
}

export function 统计收尾(部件们: readonly 统计输入部件[]): 收尾统计 {
  const 材料 = new Set<string>()
  let 查询次数 = 0
  let 缺口总项 = 0
  let 首条缺口: string | null = null

  for (const 部件 of 部件们) {
    if (typeof 部件.tool !== "string") continue
    if (!是信封工具键(部件.tool) || 是图工具键(部件.tool)) continue
    const 解析 = 解析工具输出(部件.state?.output)
    // 解析失败 / 非信封 / 工具错误一律跳过，不计入任何字段。
    if (解析.种类 !== "信封") continue

    查询次数 += 1
    for (const 出处 of 解析.信封.出处) {
      if (出处.代表 !== null) 材料.add(材料键(出处.代表))
    }
    缺口总项 += 解析.信封.缺口.length
    if (首条缺口 === null) 首条缺口 = 解析.信封.缺口.find((条) => 条 !== "") ?? null
  }

  return { 查询次数, 覆盖材料数: 材料.size, 缺口总项, 首条缺口 }
}

/** 0 次信封调用 ⇒ `null`（普通闲聊不出现统计行）。 */
export function 收尾行文本(统计: 收尾统计, t: 译文): string | null {
  if (统计.查询次数 === 0) return null

  const 段 = [t("ui.closingLine.summary", { count: 统计.查询次数, materials: 统计.覆盖材料数 })]
  if (统计.缺口总项 > 0)
    段.push(t("ui.closingLine.gaps", { gaps: 统计.缺口总项, first: 统计.首条缺口 ?? "" }))
  if (统计.查询次数 >= 12) 段.push(t("ui.closingLine.budget"))
  return 段.join(" · ")
}
