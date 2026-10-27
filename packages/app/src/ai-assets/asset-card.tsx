import { Icon } from "@opencode-ai/ui/icon"
import { Show, type JSX } from "solid-js"
import {
  ASSET_STATUS_LABELS,
  ASSET_VISIBILITY_LABELS,
  type AssetMetadata,
} from "@opencode-ai/asset-service/metadata"
import { 六边形裁切, 资产类型图标 } from "./asset-visual"

/**
 * 资产卡片（009 T006 / T007 / DESIGN §4.9–§4.10）：**精简四件**——六边形图标、名称、两行描述、
 * 空间/状态徽章。
 *
 * **列表语义与点击语义分开**：外层 `role="listitem"` 负责列表结构，内层 `<button>` 负责打开详情。
 * 不把外层直接写成 `role="button"`——那会盖掉 `listitem`，屏幕阅读器就听不出「第几张」了。
 */
const 徽章 = "rounded-[4px] bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-[11px] text-v2-text-text-muted"

export interface AssetCardProps {
  readonly asset: AssetMetadata
  readonly onOpen: (asset: AssetMetadata) => void
  /**
   * 原分类名（需求 2）：**只有「其他」桶里才给**。兜底桶里的资产已经不在任何启用分类，
   * 卡片上不标一句「它原来属于哪类」，管理员根本不知道该把它挪去哪。
   *
   * 名字由服务端给（含停用分类的名字），查不到时上层退回分类 id——这里不做判断。
   */
  readonly 原分类?: string
}

export function AssetCard(props: AssetCardProps): JSX.Element {
  return (
    <div role="listitem" data-slot="asset-card" data-asset-id={props.asset.id} class="h-[132px]">
      <button
        type="button"
        data-slot="asset-card-open"
        aria-label={`查看资产：${props.asset.name}`}
        onClick={() => props.onOpen(props.asset)}
        class="flex h-full w-full cursor-pointer flex-col gap-2 rounded-2xl border border-v2-border-border-muted bg-v2-background-bg-base p-3 text-left shadow-[var(--v2-elevation-raised)] hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v2-border-border-focus"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span
            data-slot="asset-card-icon"
            aria-hidden="true"
            style={{ "clip-path": 六边形裁切 }}
            class="flex size-8 shrink-0 items-center justify-center bg-[var(--v2-background-bg-accent-soft)] text-v2-icon-icon-accent"
          >
            <Icon name={资产类型图标[props.asset.type]} size="small" />
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
          {/* 卡片是定高的（132px，见 `grid-model.ts`）：这一枚只能占同一行的余宽、省略号收口，
              全名挂 `title`。多起一行会把行高撑破，虚拟滚动的几何就跟不上了。 */}
          <Show when={props.原分类}>
            {(名字) => (
              <span
                data-slot="asset-card-category"
                title={`原分类：${名字()}`}
                class={`${徽章} min-w-0 truncate`}
              >
                原分类：{名字()}
              </span>
            )}
          </Show>
        </div>
      </button>
    </div>
  )
}
