import type { IconProps } from "@opencode-ai/ui/icon"
import type { AssetType } from "@opencode-ai/asset-service/metadata"

/**
 * 资产视觉常量（009 T006 / T007 共用）。
 *
 * 卡片与详情头部都要画「六边形 + 按类型图标」——两处各写一份映射的话，加第三类资产时
 * 必然漏一处（`LEARNINGS #002-06`：找「谁在按同一个前提做同一件事」）。
 */
export const 资产类型图标: Record<AssetType, IconProps["name"]> = {
  skill: "brain",
  mcp: "mcp",
  knowledge_base: "folder",
}

/** 图标集里没有 `hexagon`，品牌六边形用 `clip-path` 画（DESIGN §5.3）。 */
export const 六边形裁切 = "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)"
