import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import type { JSX } from "solid-js"
import {
  ASSET_STATUS_LABELS,
  ASSET_VISIBILITY_LABELS,
  type AssetMetadata,
  type AssetType,
} from "@opencode-ai/asset-service/metadata"

/**
 * 资产卡片（009 T006 / DESIGN §4.9）：**精简四件**——六边形图标、名称、两行描述、空间/状态徽章。
 *
 * ⚠️ T006 里它是**静态**的：不是 `role="button"`、不带 `tabindex`、没有点击动作。
 * 打开详情是 T007 的事——现在先别给「按得下去但什么也不发生」的形状。
 *
 * 六边形用 `clip-path` 画（图标集里没有 `hexagon`），底走浅金语义 token；
 * 里面放**按类型**区分的图标，让三张同分类的卡不长得一模一样。
 */
const 类型图标: Record<AssetType, IconProps["name"]> = {
  skill: "brain",
  mcp: "mcp",
  knowledge_base: "folder",
}

const 六边形 = "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)"

const 徽章 = "rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-[11px] text-v2-text-text-muted"

export interface AssetCardProps {
  readonly asset: AssetMetadata
}

export function AssetCard(props: AssetCardProps): JSX.Element {
  return (
    <div
      role="listitem"
      data-slot="asset-card"
      data-asset-id={props.asset.id}
      class="flex h-[132px] flex-col gap-2 rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-3 shadow-[var(--v2-elevation-raised)]"
    >
      <div class="flex min-w-0 items-center gap-2">
        <span
          data-slot="asset-card-icon"
          aria-hidden="true"
          style={{ "clip-path": 六边形 }}
          class="flex size-8 shrink-0 items-center justify-center bg-[var(--v2-background-bg-accent-soft)] text-v2-icon-icon-accent"
        >
          <Icon name={类型图标[props.asset.type]} size="small" />
        </span>
        <span
          data-slot="asset-card-name"
          class="min-w-0 truncate text-[14px] leading-5 font-semibold text-v2-text-text-base"
        >
          {props.asset.name}
        </span>
      </div>
      <p
        data-slot="asset-card-description"
        class="line-clamp-2 text-[12px] leading-4 text-v2-text-text-muted"
      >
        {props.asset.description}
      </p>
      <div class="mt-auto flex items-center gap-1.5">
        <span data-slot="asset-card-space" data-space={props.asset.visibility} class={徽章}>
          {ASSET_VISIBILITY_LABELS[props.asset.visibility]}
        </span>
        <span data-slot="asset-card-status" data-status={props.asset.status} class={徽章}>
          {ASSET_STATUS_LABELS[props.asset.status]}
        </span>
      </div>
    </div>
  )
}
