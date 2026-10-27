import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { AssetDetail } from "./asset-detail"
import { AssetGrid } from "./asset-grid"
import { AssetPager, 需要页码条 } from "./asset-pager"
import { AssetSearch } from "./asset-search"
import type { AssetCatalog } from "./asset-catalog"
import { 兜底分类ID, type AssetFilter } from "./filter"

/**
 * AI 资产中栏（009 T006 / T007 / 需求 6）：搜索框 + 卡片网格 + 页码条；选中资产后
 * **详情盖在浏览区上**。
 *
 * 搜索词**只活在这一层**：它不属于左栏筛选（左栏那三组是「我在看哪一类」，被 `AssetNav`
 * 与网格共享），也不进接入缝。它要传给网格，所以落在两者共同的祖先上。
 *
 * `filter` 由 `WorkspaceEntry` 建、左栏与网格**共享同一份**——两处各建一份的话，左栏点了类型、
 * 网格还按旧类型筛（`LEARNINGS #002-06`）。
 *
 * ## 查询在这一层组装，取数在 `catalog`（需求 6，2026-10-27）
 *
 * 分页之后「筛」和「取」必须在一处：本层把左栏三组 ＋ 搜索词拼成查询交给 `catalog.load()`，
 * 拿到的是**已经筛好、切好**的一页。筛选一变，数据源把页码归 1（`asset-catalog.ts` 文件头）。
 *
 * 搜索框**防抖 250ms**：服务端搜索是每敲一个字一趟请求，不防抖就是「输五个字、飞五个请求、
 * 回包还乱序」——代次号能保证不错位，但没必要制造这场面。
 *
 * **浏览区不卸载**（`hidden` 保活）：返回时网格的滚动位置与搜索词都还在；详情卸载后焦点归还到
 * 刚才打开的那张卡（`#005-17` 的焦点时间线），键盘用户不会被扔回页面顶部。
 */
export interface AssetCenterProps {
  readonly filter: AssetFilter
  /**
   * 使用面的数据源（`createAssetCatalog` 的产物，由入口注入）。省略 = 无数据源
   * （组件测试 / storybook）：网格空着，不放假数据。
   */
  readonly catalog?: AssetCatalog
}

/** 搜索框防抖：这段时间内的连续输入只发最后一趟。 */
export const 搜索防抖ms = 250

export function AssetCenter(props: AssetCenterProps): JSX.Element {
  const [搜索词, set搜索词] = createSignal("")
  /** 真正进入查询的搜索词（防抖之后）。 */
  const [生效搜索, set生效搜索] = createSignal("")
  const [选中, set选中] = createSignal<AssetMetadata>()
  const [最近打开id, set最近打开id] = createSignal<string>()
  let 浏览区: HTMLDivElement | undefined
  let 搜索定时器: ReturnType<typeof setTimeout> | undefined

  const 改搜索 = (value: string) => {
    set搜索词(value)
    clearTimeout(搜索定时器)
    搜索定时器 = setTimeout(() => set生效搜索(value), 搜索防抖ms)
  }

  onCleanup(() => clearTimeout(搜索定时器))

  // 查询组装只在这里：左栏三组来自共享的 `filter`，搜索词来自本层。
  // 数据源按「条件变了 ⇒ 回第 1 页」处理，所以这里不用管页码。
  createEffect(() => {
    props.catalog?.load({
      type: props.filter.type(),
      spaces: props.filter.spaces(),
      category: props.filter.category(),
      q: 生效搜索(),
    })
  })

  /**
   * 「其他」桶里卡片要标原分类（需求 2）：名字取服务端给的 `categoryNames`（含停用分类），
   * 库里查不到就退回 id——那是历史数据 / 直写库的行，管理员得看得见它到底挂在哪个 id 上。
   * 别的模式返回 `undefined`，卡片保持精简四件。
   */
  const 原分类 = (asset: AssetMetadata) => {
    if (props.filter.category() !== 兜底分类ID) return undefined
    return props.catalog?.categoryNames()[asset.category] ?? asset.category
  }

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
          <AssetSearch value={搜索词()} onInput={改搜索} />
        </div>
        <Show when={props.catalog?.error()}>
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
        <AssetGrid assets={props.catalog?.assets} onOpen={打开} 原分类={原分类} />
        <Show when={props.catalog}>
          {(catalog) => (
            <Show when={需要页码条(catalog().total())}>
              <AssetPager
                total={catalog().total()}
                page={catalog().page()}
                pageSize={catalog().pageSize()}
                onPage={catalog().goPage}
                onPageSize={catalog().setPageSize}
              />
            </Show>
          )}
        </Show>
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
