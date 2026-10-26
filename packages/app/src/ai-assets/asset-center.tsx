import { createSignal, Show, type JSX } from "solid-js"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { AssetDetail } from "./asset-detail"
import { AssetGrid } from "./asset-grid"
import { AssetSearch } from "./asset-search"
import type { AssetFilter } from "./filter"

/**
 * AI 资产中栏（009 T006 / T007）：搜索框 + 卡片网格；选中资产后**详情盖在浏览区上**。
 *
 * 搜索词**只活在这一层**：它不属于左栏筛选（左栏那三组是「我在看哪一类」，被 `AssetNav`
 * 与网格共享），也不进接入缝。它要传给网格，所以落在两者共同的祖先上。
 *
 * `filter` 由 `WorkspaceEntry` 建、左栏与网格**共享同一份**——两处各建一份的话，左栏点了类型、
 * 网格还按旧类型筛（`LEARNINGS #002-06`）。
 *
 * **浏览区不卸载**（`hidden` 保活）：返回时网格的滚动位置与搜索词都还在；详情卸载后焦点归还到
 * 刚才打开的那张卡（`#005-17` 的焦点时间线），键盘用户不会被扔回页面顶部。
 */
export interface AssetCenterProps {
  readonly filter: AssetFilter
  readonly assets?: () => readonly AssetMetadata[]
  /**
   * 取数失败的原因（T017）。有值就**在网格上方挂一条提示**——失败不能长成空列表：
   * 「没有符合条件的资产」与「服务连不上」是两件事，混成一件用户会以为资产丢了。
   *
   * 形状是访问器（与 `assets` 同因）：重试成功后要能消失。
   */
  readonly loadError?: () => string | undefined
}

export function AssetCenter(props: AssetCenterProps): JSX.Element {
  const [搜索词, set搜索词] = createSignal("")
  const [选中, set选中] = createSignal<AssetMetadata>()
  const [最近打开id, set最近打开id] = createSignal<string>()
  let 浏览区: HTMLDivElement | undefined

  const 打开 = (asset: AssetMetadata) => {
    set最近打开id(asset.id)
    set选中(asset)
  }

  const 返回 = () => {
    const id = 最近打开id()
    set选中(undefined)
    if (id === undefined) return
    // 等 Solid 把浏览区重新显示出来（微任务），再把焦点送回原卡片。
    queueMicrotask(() => {
      const card = [...(浏览区?.querySelectorAll<HTMLElement>('[data-slot="asset-card"]') ?? [])].find(
        (el) => el.dataset.assetId === id,
      )
      card?.querySelector<HTMLElement>('[data-slot="asset-card-open"]')?.focus()
    })
  }

  return (
    <div data-slot="asset-center" class="relative flex h-full min-h-0 w-full flex-col">
      <div
        ref={(el) => (浏览区 = el)}
        data-slot="asset-center-browse"
        class="flex min-h-0 flex-1 flex-col"
        classList={{ hidden: 选中() !== undefined }}
      >
        <div class="px-4 pt-4">
          <AssetSearch value={搜索词()} onInput={set搜索词} />
        </div>
        <Show when={props.loadError?.()}>
          {(原因) => (
            <div
              data-slot="asset-load-error"
              role="alert"
              class="mx-4 mt-3 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 text-[13px] text-v2-text-text-muted"
            >
              {原因()}
            </div>
          )}
        </Show>
        <AssetGrid filter={props.filter} search={搜索词} assets={props.assets} onOpen={打开} />
      </div>

      <Show when={选中()}>
        {(asset) => (
          <div
            data-slot="asset-detail-layer"
            class="absolute inset-0 flex min-h-0 flex-col bg-v2-background-bg-base"
          >
            <AssetDetail asset={asset()} onBack={返回} />
          </div>
        )}
      </Show>
    </div>
  )
}
