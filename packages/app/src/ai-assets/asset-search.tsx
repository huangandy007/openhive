import { Icon } from "@opencode-ai/ui/icon"
import { Show, type JSX } from "solid-js"

/**
 * 中栏搜索框（009 T006 / DESIGN §4.9）。
 *
 * **受控组件**：值由上层持有（`AssetCenter` 的搜索信号），本组件只负责「显示 + 把输入整串交出去」。
 * 这样筛选口径只有一处（`grid-model.ts` 的 `筛选资产`），搜索框不自己再算一遍。
 */
export interface AssetSearchProps {
  readonly value: string
  readonly onInput: (value: string) => void
}

export function AssetSearch(props: AssetSearchProps): JSX.Element {
  let 输入框: HTMLInputElement | undefined

  return (
    <div
      data-slot="asset-search"
      class="flex h-9 items-center gap-2 rounded-[10px] border border-v2-border-border-muted bg-v2-background-bg-base px-3"
    >
      <span
        aria-hidden="true"
        class="flex shrink-0 items-center [--icon-base:var(--v2-icon-icon-muted)]"
      >
        <Icon name="magnifying-glass" size="small" />
      </span>
      <input
        ref={(el) => (输入框 = el)}
        data-slot="asset-search-input"
        type="text"
        aria-label="搜索资产"
        placeholder="搜索资产（名称 / 描述 / 标签）"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        class="min-w-0 flex-1 bg-transparent text-[14px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-muted"
      />
      <Show when={props.value !== ""}>
        <button
          type="button"
          data-slot="asset-search-clear"
          aria-label="清除搜索"
          class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover"
          onClick={() => {
            props.onInput("")
            // 清除后焦点留在输入框：用户多半还要重打一个词，别逼他再点一次。
            输入框?.focus()
          }}
        >
          <Icon name="close-small" size="small" />
        </button>
      </Show>
    </div>
  )
}
