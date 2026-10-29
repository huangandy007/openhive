import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { AssetDetail } from "./asset-detail"
import { AssetGrid } from "./asset-grid"
import { AssetPager, 需要页码条 } from "./asset-pager"
import { AssetSearch } from "./asset-search"
import type { AssetCatalog } from "./asset-catalog"
import type { ProjectEnablement } from "./enable-state"
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
  /**
   * **项目级 skill 启用状态**（2026-10-27 / Task 7）。
   *
   * 【保留的定制 · 同步上游时不要丢】与 `catalog` 同一条注入规矩：生产实现在
   * `pages/layout-new.tsx` 建（`createProjectEnablement` ＋ `bind(() => currentProject()?.id)`），
   * 本组件被组件测试裸挂，自己去取就跑不成离线。
   *
   * 省略 = 整块功能不出现：不画「已启用 N/20」计数条，卡片也不带启用按钮——与加它之前逐字相同。
   *
   * **状态由服务端说了算**：本层只按 `enabled()` 标卡、按 `toggle()` 交回切换请求；不做本地增减
   * （同名拦截、上限、已下线撤销这三件事只有服务端知道，见 `enable-state.ts` 文件头）。
   */
  readonly enablement?: ProjectEnablement
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

  /**
   * 启用按钮不可用的原因（非空 ⇒ 卡片把它写进 `title` 并禁用）：
   * **没选项目** / **已达上限**。
   *
   * **按资产算**（`AssetGrid.enableHintOf`）：达上限只禁「还没启用」的那些——已启用的那张必须
   * 仍能点「停用」，否则 20/20 时用户一个也停不掉（整网格一个值会让功能自锁）。
   */
  const 启用提示 = (asset: AssetMetadata) => {
    const 状态 = props.enablement
    if (状态 === undefined) return undefined
    if (状态.projectId() === undefined) return "请先在左侧选择项目"
    if (状态.enabledCount() >= 状态.limit() && !状态.enabled().has(asset.id))
      return `每个项目最多启用 ${状态.limit()} 个，请先停用一个`
    return undefined
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
        {/* 项目级启用（2026-10-27 / Task 7）：没选项目时整条不出现——「0/20」会被读成
            「一个都没启用」，那是另一件事。启用在**下一条消息**才进内核，故文案这么说。

            自动送达开关（需求 5a）挂同一行：它和配额是一件事的两面（自动项占的就是剩余预算），
            分两行反而要用户自己算。默认「开」，关掉只是不再新增，已装的（含固定的）不动。 */}
        <Show when={props.enablement?.projectId() !== undefined}>
          <div class="flex items-center justify-between gap-2 px-4 pt-2 text-[12px] text-v2-text-text-muted">
            <span data-slot="asset-enable-count">
              已启用 {props.enablement?.enabledCount()}/{props.enablement?.limit()} · 下一条消息生效
            </span>
            <button
              type="button"
              data-slot="asset-auto-delivery"
              data-enabled={props.enablement?.autoDelivery() === true}
              aria-pressed={props.enablement?.autoDelivery() === true}
              aria-busy={props.enablement?.autoDeliveryBusy() === true}
              disabled={props.enablement?.autoDeliveryBusy() === true}
              title={
                props.enablement?.autoDelivery() === true
                  ? "关闭后，后续审核通过并共享给您的 skill 不再自动装入本项目（已装入与固定安装的不受影响）"
                  : "打开后，审核通过并共享给您的 skill 会自动装入本项目（最多 20 个，手动安装优先）"
              }
              onClick={() => {
                const 状态 = props.enablement
                if (状态 === undefined) return
                状态.setAutoDelivery(!状态.autoDelivery())
              }}
              class="shrink-0 cursor-pointer rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-2 py-0.5 text-[11px] text-v2-text-text-base hover:bg-v2-overlay-simple-overlay-hover disabled:cursor-not-allowed disabled:opacity-60 data-[enabled=true]:border-v2-border-border-focus data-[enabled=true]:text-v2-text-text-accent"
            >
              自动送达：{props.enablement?.autoDelivery() === true ? "开" : "关"}
            </button>
          </div>
        </Show>
        {/* 失败如实显示、不清空集合（`enable-state.ts` 文件头）：旧状态比白屏有用。 */}
        <Show when={props.enablement?.error()}>
          <div
            data-slot="asset-enable-error"
            role="alert"
            class="mx-4 mt-2 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-3 py-2 text-[13px] text-v2-state-fg-danger"
          >
            {props.enablement?.error()}
          </div>
        </Show>
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
        {/*
          这里逐个传，比条件展开直白；`onToggleEnabled` 省略 ⇒ 网格不渲染启用按钮
          （`AssetGrid` 只认这一个开关）。
        */}
        <AssetGrid
          assets={props.catalog?.assets}
          onOpen={打开}
          原分类={原分类}
          onToggleEnabled={props.enablement === undefined ? undefined : (asset) => props.enablement!.toggle(asset.id)}
          enabledOf={(asset) => props.enablement?.enabled().has(asset.id) === true}
          autoOf={(asset) => props.enablement?.auto().has(asset.id) === true}
          enableHintOf={启用提示}
          busyId={props.enablement?.busy()}
        />
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
        {(asset) => {
          // 详情拿**数据源里的现行行**（2026-10-29）：`选中()` 是打开那一刻的快照，收藏成功
          // 之后服务端回的 `favoriteCount` 写在数据源的行上——读快照的话「N 人收藏」会停在旧数。
          // 行被筛掉（换条件 / 翻页）时就退回快照，详情不至于空掉。
          const 现行 = () => props.catalog?.assets().find((row) => row.id === asset().id) ?? asset()
          return (
            <div
              data-slot="asset-detail-layer"
              class="absolute inset-0 flex min-h-0 flex-col bg-v2-background-bg-base"
            >
              {/* 启用状态与卡片读同一份（`enablement`）与同一个判断（`启用提示`）——
                  详情里就地启用，用户不必退回卡片（2026-10-29 裁定）。收藏同理读数据源。 */}
              <AssetDetail
                asset={现行()}
                onBack={返回}
                onToggleEnabled={props.enablement === undefined ? undefined : (a) => props.enablement!.toggle(a.id)}
                enabled={props.enablement?.enabled().has(asset().id) === true}
                auto={props.enablement?.auto().has(asset().id) === true}
                enableHint={启用提示(asset())}
                busy={props.enablement?.busy() === asset().id}
                onToggleFavorite={
                  props.catalog === undefined
                    ? undefined
                    : (a) => props.catalog!.setFavorite(a.id, !props.catalog!.favorited().has(a.id))
                }
                favorited={props.catalog?.favorited().has(asset().id) === true}
                favoriteBusy={props.catalog?.favoriteBusy() === asset().id}
              />
            </div>
          )
        }}
      </Show>
    </div>
  )
}
