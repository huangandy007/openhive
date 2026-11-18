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

/**
 * 本轮全部 assistant 消息的 parts 合并（F1）。
 *
 * 真实链路里每步 LLM 调用新建一条 assistant 消息，tool part 挂在**当步**消息上，
 * 最后回答是另一条无 tool 的消息（`packages/opencode/src/session/prompt.ts:1236`、
 * `processor.ts:238`、`prompt.ts:1178`）——收尾行必须吃**本轮全部消息**，不能只吃当步那条。
 */
export function 合并消息部件(按消息: readonly (readonly 统计输入部件[] | undefined)[]): 统计输入部件[] {
  return 按消息.flatMap((部件们) => 部件们 ?? [])
}

/**
 * 接线纯函数（F1 审查）：按消息顺序逐条取 parts 再合并。
 *
 * 抽出来是为了让「收尾行吃本轮全部消息」这条接线能被用例钉住——
 * 真实链路里每步 LLM 调用新建一条 assistant 消息，tool part 分散在各条上。
 */
export function 收尾部件(
  消息们: readonly { readonly id: string }[],
  取部件: (消息id: string) => readonly 统计输入部件[] | undefined,
): 统计输入部件[] {
  return 合并消息部件(消息们.map((消息) => 取部件(消息.id)))
}

export interface 收尾统计 {
  readonly 查询次数: number
  readonly 覆盖材料数: number
  readonly 缺口总项: number
  readonly 首条缺口: string | null
  /** 服务端已注入预算上限缺口（F3）；前端**不**自己按次数判断。 */
  readonly 已达上限: boolean
}

export type 译文 = (键: string, 参数?: Record<string, string | number | boolean>) => string

/**
 * 图工具的 part 键是 `openhive-case_graph_add`（`McpCatalog.toolName` 拼出），
 * 能通过 `是信封工具键` 的前缀判定 ⇒ 必须显式排除，否则图工具会多算一次。
 */
const 是图工具键 = (工具键: string) => 信封工具名(工具键).startsWith("graph_")

/**
 * `代表` 的材料键：`#` 之前段（`m-甲#账户表#1` ⇒ `m-甲`）；**不含 `#` 的不是材料**。
 * 服务端 `代表` 的真实形状（`case-mcp-tools.ts`）：材料行 = `<材料>#<工作表>#<行号>`；
 * 实体 id / 账户号 / 关系 id 不含 `#`，不能各算一份材料（F2）。
 */
const 材料键 = (代表: string) => {
  const 位置 = 代表.indexOf("#")
  return 位置 === -1 ? null : 代表.slice(0, 位置)
}

/**
 * 服务端预算上限缺口文案的**开头**（F3 唯一出处：
 * `packages/opencode/src/server/openhive/case-mcp-server.ts` 的 `预算上限缺口`，
 * 第 12 次起被追加进成功信封的 `缺口`）。前端只认这段文案，不自己数次数——
 * 服务端按 `(userId, projectId)` + 10 分钟空闲窗口计数，前端按轮次计数必然对不上。
 * 这条文案只驱动 `已达上限`；`统计收尾` 会把它从「缺口总项 / 首条缺口」里排除，避免重复念。
 */
const 服务端上限缺口前缀 = "近 10 分钟内查询已达 12 次"

export function 统计收尾(部件们: readonly 统计输入部件[]): 收尾统计 {
  const 材料 = new Set<string>()
  let 查询次数 = 0
  let 缺口总项 = 0
  let 首条缺口: string | null = null
  let 已达上限 = false

  for (const 部件 of 部件们) {
    if (typeof 部件.tool !== "string") continue
    if (!是信封工具键(部件.tool) || 是图工具键(部件.tool)) continue
    // `查询次数` 按工具键计数：服务端预算成功、失败都算，故解析前就 +1（Ruling 8）。
    查询次数 += 1
    const 解析 = 解析工具输出(部件.state?.output)
    // 解析失败 / 非信封 / 工具错误只影响材料与缺口，不影响上面的计数。
    if (解析.种类 !== "信封") continue

    for (const 出处 of 解析.信封.出处) {
      if (出处.代表 === null) continue
      const 键 = 材料键(出处.代表)
      if (键 !== null) 材料.add(键)
    }
    // 服务端注入的上限文案是机器话术，不是真实缺口：既不计入「缺口总项」，也不当「首条缺口」，
    // 否则同一句话会在收尾行出现两遍（`.gaps` 与 `.budget` 各念一次）。
    const 真实缺口 = 解析.信封.缺口.filter((条) => !条.startsWith(服务端上限缺口前缀))
    缺口总项 += 真实缺口.length
    if (首条缺口 === null) 首条缺口 = 真实缺口.find((条) => 条 !== "") ?? null
    if (解析.信封.缺口.some((条) => 条.startsWith(服务端上限缺口前缀))) 已达上限 = true
  }

  return { 查询次数, 覆盖材料数: 材料.size, 缺口总项, 首条缺口, 已达上限 }
}

/** 0 次信封调用 ⇒ `null`（普通闲聊不出现统计行）。 */
export function 收尾行文本(统计: 收尾统计, t: 译文): string | null {
  if (统计.查询次数 === 0) return null

  const 段 = [t("ui.closingLine.summary", { count: 统计.查询次数, materials: 统计.覆盖材料数 })]
  if (统计.缺口总项 > 0)
    段.push(t("ui.closingLine.gaps", { gaps: 统计.缺口总项, first: 统计.首条缺口 ?? "" }))
  if (统计.已达上限) 段.push(t("ui.closingLine.budget"))
  return 段.join(" · ")
}
