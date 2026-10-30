import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import type { UsageStats } from "./asset-catalog-api"

/**
 * 卡片与详情页共用的「收藏 / 使用」文案（2026-10-30）。
 *
 * 两处必须同源（`#002-06`）：卡片的悬停提示与详情页的使用记录若各写一份，会出现「卡片说
 * 有人用过、详情说没人用过」这类查不出来的漂移。判定规则也只有一份：
 *
 * - 使用段**只给 skill**：抽取器只统计 skill 资产的使用痕迹（skill 工具 / 跑脚本 / 读说明书 /
 *   斜杠命令），给 MCP / 知识库显示「0 次」是假话。
 * - `usage` 缺省（旧内核没给 `usageStats`）⇒ 整段不出现：「没有这个信息」≠「没人用过」。
 */

/**
 * 使用文案三态（2026-10-29）。窗口天数由**服务端**给：前端硬编码 30 会在服务端换窗口时
 * 显示一个不对的「最近 30 天」（`#002-06`：同一件事别有两份来源）。
 */
export function 使用文案(用量: UsageStats, assetId: string): string {
  const 一份 = 用量.stats[assetId]
  return 一份 === undefined
    ? `最近 ${用量.days} 天还没人用过`
    : `最近 ${用量.days} 天 · ${一份.users} 人用过 · 共 ${一份.calls} 次`
}

export interface 卡片统计 {
  /** 图标旁边只放数字（收藏是「★3」，不是「3 人收藏」）。 */
  readonly 收藏: string
  /** 省略 = 不显示使用段（非 skill，或旧内核没给 `usageStats`）。 */
  readonly 使用?: string
  /** 悬停提示：始终以 `收藏：N 人` 开头；有使用段时用 `；使用：` 接上同一份 `使用文案`。 */
  readonly title: string
}

export function 卡片统计(asset: AssetMetadata, usage: UsageStats | undefined): 卡片统计 {
  const 收藏 = String(asset.favoriteCount)
  const 用量 = asset.type === "skill" ? usage : undefined
  if (用量 === undefined) return { 收藏, title: `收藏：${收藏} 人` }
  // 有 usage 就是 skill：没有该资产的记录 ⇒ 0 次（「这是 skill、确实没人用过」）。
  const calls = 用量.stats[asset.id]?.calls ?? 0
  return {
    收藏,
    使用: `${calls}次`,
    title: `收藏：${收藏} 人；使用：${使用文案(用量, asset.id)}`,
  }
}
