import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createVirtualizer } from "@tanstack/solid-virtual"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { AssetCard } from "./asset-card"
import { 卡片行高, 卡片行距, 卡片高, 网格列数, 网格行数 } from "./grid-model"

/**
 * 中栏资产网格（009 T006 / DESIGN §4.9）：**按行虚拟滚动**，卡片固定高度。
 *
 * 为什么按行而不是按张：一行 N 列共享同一个 `translateY`，虚拟器只需要算「第几行」；
 * 按张算会要求每一列的 x 也对上，纯属自找麻烦。行高 = 卡片 132 + 行距 12 = 144。
 *
 * ⚠️ **单一滚动容器**（`#006-30`）：只有外层 viewport 滚动，行是它里面的绝对定位层；
 * 别再给内容层套 `overflow`，否则滚轮落点会分裂成两个盒子。
 */
export interface AssetGridProps {
  /**
   * **已经筛好、切好**的这一页（需求 6）。省略 = 空列表（**不放假数据**）。
   *
   * ⚠️ 网格**不再自己筛**：筛选与分页都在服务端（`asset-catalog-api.ts` 文件头）。这里再按
   * 空间 / 分类筛一遍，就会出现「服务端回 20 条、界面显示 3 条、总数写 25」——假分页。
   */
  readonly assets?: () => readonly AssetMetadata[]
  /** 打开详情（T007）：点卡片时把整份元数据交给中栏，由它决定详情怎么呈现。 */
  readonly onOpen: (asset: AssetMetadata) => void
  /**
   * 原分类名（需求 2）：返回 `undefined` = 这张卡不标。由中栏按「是不是在看『其他』」决定，
   * 网格自己不判模式——它连筛选都不认识（见 `assets` 的注释）。
   */
  readonly 原分类?: (asset: AssetMetadata) => string | undefined
  /**
   * 【保留的定制 · 同步上游时不要丢】项目级 skill 启用（2026-10-27）。
   * 以下四个可选 prop 都是本 fork 新增的定制，只做透传；全部省略时网格与加它之前相同。
   */
  /** 已启用判定（服务端权威）。省略 ⇒ 卡片不显示启用按钮。 */
  readonly enabledOf?: (asset: AssetMetadata) => boolean
  readonly onToggleEnabled?: (asset: AssetMetadata) => void
  /**
   * **按资产**算禁用原因。必须是函数而不是一个字符串：达上限时要禁的是**未启用**的那些，
   * 已启用的那张必须仍能点「停用」——整网格一个值会把用户锁死（20/20 时一个也停不掉）。
   */
  readonly enableHintOf?: (asset: AssetMetadata) => string | undefined
  readonly busyId?: string
}

export function AssetGrid(props: AssetGridProps): JSX.Element {
  /** 交给虚拟器的滚动手柄：必须等元素插入文档后（同 `sheet-grid.tsx` 的 ref 注释）。 */
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  let 滚动元素: HTMLDivElement | undefined
  /** 容器宽（列数全靠它）。初值 800 与 `initialRect` 一致，真量到再覆盖。 */
  const [容器宽, set容器宽] = createSignal(800)

  const 结果 = createMemo(() => props.assets?.() ?? [])
  const 列数 = createMemo(() => 网格列数(容器宽()))
  const 行数 = createMemo(() => 网格行数(结果().length, 列数()))

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return 行数()
    },
    getScrollElement: () => scrollEl() ?? null,
    initialRect: { width: 800, height: 600 },
    estimateSize: () => 卡片行高,
    overscan: 2,
  })

  onMount(() => {
    const element = 滚动元素
    if (!element) return
    const 量 = (宽: number) => {
      if (宽 > 0) set容器宽(宽)
    }
    量(element.clientWidth || element.offsetWidth)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) 量(Math.round(rect.width))
    })
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  })

  return (
    <div data-slot="asset-grid" class="flex min-h-0 flex-1 flex-col">
      <Show
        when={结果().length > 0}
        fallback={
          <div
            data-slot="asset-empty"
            class="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-v2-text-text-muted"
          >
            没有符合条件的资产
          </div>
        }
      >
        <div
          ref={(el) => {
            滚动元素 = el
            queueMicrotask(() => setScrollEl(el))
          }}
          data-slot="asset-grid-viewport"
          class="min-h-0 flex-1 overflow-y-auto p-4"
        >
          <div
            role="list"
            aria-label="资产列表"
            class="relative"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            <For each={virtualizer.getVirtualItems()}>
              {(item) => {
                const 本行 = () => {
                  const 起点 = item.index * 列数()
                  return 结果().slice(起点, 起点 + 列数())
                }
                return (
                  <div
                    // 行只是几何容器，不是列表项：`role="presentation"` 让屏幕阅读器跳过它，
                    // `listitem` 仍然直接挂在 `role="list"` 之下（避免多出一层匿名列表语义）。
                    role="presentation"
                    data-slot="asset-row"
                    data-row-index={item.index}
                    class="absolute top-0 right-0 left-0 grid"
                    style={{
                      transform: `translateY(${item.start}px)`,
                      height: `${卡片高}px`,
                      "grid-template-columns": `repeat(${列数()}, minmax(0, 1fr))`,
                      gap: `${卡片行距}px`,
                    }}
                  >
                    <For each={本行()}>
                      {(asset) => (
                        <AssetCard
                          asset={asset}
                          onOpen={props.onOpen}
                          原分类={props.原分类?.(asset)}
                          {...(props.onToggleEnabled === undefined
                            ? {}
                            : {
                                enabled: props.enabledOf?.(asset) === true,
                                onToggleEnabled: props.onToggleEnabled,
                                enableHint: props.enableHintOf?.(asset),
                                busy: props.busyId === asset.id,
                              })}
                        />
                      )}
                    </For>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
