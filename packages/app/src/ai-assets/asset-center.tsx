import { createSignal, type JSX } from "solid-js"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { AssetGrid } from "./asset-grid"
import { AssetSearch } from "./asset-search"
import type { AssetFilter } from "./filter"

/**
 * AI 资产中栏（009 T006）：搜索框 + 卡片网格。
 *
 * 搜索词**只活在这一层**：它不属于左栏筛选（左栏那三组是「我在看哪一类」，被 `AssetNav`
 * 与网格共享），也不进接入缝。它要传给网格，所以落在两者共同的祖先上。
 *
 * `filter` 由 `WorkspaceEntry` 建、左栏与网格**共享同一份**——两处各建一份的话，左栏点了类型、
 * 网格还按旧类型筛（`LEARNINGS #002-06`）。
 */
export interface AssetCenterProps {
  readonly filter: AssetFilter
  readonly assets?: () => readonly AssetMetadata[]
}

export function AssetCenter(props: AssetCenterProps): JSX.Element {
  const [搜索词, set搜索词] = createSignal("")

  return (
    <div data-slot="asset-center" class="flex h-full min-h-0 w-full flex-col">
      <div class="px-4 pt-4">
        <AssetSearch value={搜索词()} onInput={set搜索词} />
      </div>
      <AssetGrid filter={props.filter} search={搜索词} assets={props.assets} />
    </div>
  )
}
