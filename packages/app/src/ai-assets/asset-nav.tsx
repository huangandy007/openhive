import { Icon } from "@opencode-ai/ui/icon"
import { For, Show, type JSX } from "solid-js"
import {
  ASSET_TYPE_LABELS,
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  ASSET_VISIBILITY_LABELS,
} from "@opencode-ai/asset-service/metadata"
import { ASSET_CATEGORY_ROWS, type AssetFilter } from "./filter"

/**
 * AI 资产左栏纯导航（009 T005 / DESIGN §4.8）。
 *
 * 三组：空间筛选 → 类型 Tab → 业务分类单开手风琴。
 * **节点下不列资产**（design §1.1）：左栏任何时刻最多「一个展开的分组标题 + 其余标题」，
 * 不产生长滚动条。资产行只在 T006 的中栏出现。
 *
 * ⚠️ 分类文案与顺序只从 `asset-service` 的 seed 来（`filter.ts` 的 `ASSET_CATEGORY_ROWS`），
 * 不在本文件写死任何一个分类名。空间 / 类型的文案同理取 `metadata.ts` 的标签表。
 */

/** 空间筛选按钮。选中 = 浅金底（§4.8 选中态），未选中走中性 hover。 */
const 空间按钮 = (选中: boolean) =>
  `rounded-[6px] border px-2 py-1 text-[12px] transition-colors ${
    选中
      ? "border-v2-border-border-muted bg-[var(--v2-background-bg-accent-soft)] text-v2-text-text-base"
      : "border-transparent text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
  }`

/** 类型 Tab 与分类行共用同一条选中态语法（同一件事只有一套长相）。 */
const 导航项 = (选中: boolean) =>
  `rounded-md px-2 py-1.5 text-[14px] transition-colors ${
    选中
      ? "bg-[var(--v2-background-bg-accent-soft)] text-v2-text-text-base"
      : "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover"
  }`

export interface AssetNavProps {
  readonly filter: AssetFilter
}

export function AssetNav(props: AssetNavProps): JSX.Element {
  return (
    <aside data-component="asset-nav" class="flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto px-2 py-3">
      <div role="group" aria-label="空间筛选" data-slot="asset-space-filter" class="flex flex-wrap gap-1">
        <For each={ASSET_VISIBILITIES}>
          {(space) => (
            <button
              type="button"
              data-slot="asset-space"
              data-space={space}
              aria-pressed={props.filter.spaceOn(space)}
              class={空间按钮(props.filter.spaceOn(space))}
              onClick={() => props.filter.toggleSpace(space)}
            >
              {ASSET_VISIBILITY_LABELS[space]}
            </button>
          )}
        </For>
      </div>

      <div role="tablist" aria-label="资产类型" data-slot="asset-type-tabs" class="flex gap-1">
        <For each={ASSET_TYPES}>
          {(type) => (
            <button
              type="button"
              role="tab"
              data-slot="asset-type-tab"
              data-type={type}
              aria-selected={props.filter.type() === type}
              class={`flex-1 ${导航项(props.filter.type() === type)}`}
              onClick={() => props.filter.selectType(type)}
            >
              {ASSET_TYPE_LABELS[type]}
            </button>
          )}
        </For>
      </div>

      {/*
        分类是**单开手风琴**：同时最多一个 `aria-expanded="true"`（design §1.1「默认展开当前分类」）。
        展开态下**不渲染任何资产行**——它只表示「中栏当前看的是这一类」。
      */}
      <nav aria-label="业务分类" data-slot="asset-category-list" class="flex flex-col gap-0.5">
        <For each={ASSET_CATEGORY_ROWS}>
          {(category) => {
            const 展开 = () => props.filter.category() === category.id
            return (
              <button
                type="button"
                data-slot="asset-category"
                data-category={category.id}
                aria-expanded={展开()}
                class={`flex w-full items-center gap-2 text-left ${导航项(展开())}`}
                onClick={() => props.filter.selectCategory(category.id)}
              >
                <span class="flex items-center [--icon-base:var(--v2-icon-icon-muted)]">
                  <Icon name={展开() ? "chevron-down" : "chevron-right"} size="small" />
                </span>
                <span class="min-w-0 truncate">{category.name}</span>
              </button>
            )
          }}
        </For>
      </nav>

      {/* 展开态没有子节点是刻意的（左栏不列资产）。给屏幕阅读器一句说明，避免「展开了却是空的」。 */}
      <Show when={props.filter.category() !== undefined}>
        <p data-slot="asset-category-hint" class="px-2 text-[11px] text-v2-text-text-muted">
          该分类的资产在中栏展示
        </p>
      </Show>
    </aside>
  )
}
