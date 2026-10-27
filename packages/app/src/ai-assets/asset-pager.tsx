import { For, type JSX } from "solid-js"
import { PAGE_SIZES } from "./asset-catalog-api"

/**
 * 中栏底部的页码条（需求 6，2026-10-27）。
 *
 * 三样东西：**总数**（让用户知道筛完还剩多少，翻不到底也有数）、**上/下页**（最常用）、
 * **每页条数**（账号偏好，跨设备一致）。
 *
 * ## 为什么不做「1 2 3 … 87」
 *
 * 每页 20 条时页码条常常几十个，做出来就是半截数字墙，窄窗口还会换行顶掉网格高度。
 * 资产浏览是「找东西」，不是「读到第几页」——上/下页 ＋ 当前页/总页已经够用。
 *
 * ## 越界不在这层兜
 *
 * 上一页在第一页、下一页在最后一页时按钮直接 `disabled`；页码本身由数据源收口
 * （`createAssetCatalog.goPage` 拒绝非正整数）。
 */
export interface AssetPagerProps {
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly onPage: (page: number) => void
  readonly onPageSize: (size: number) => void
}

/** 总页数：至少 1（0 条也算「第 1 / 1 页」，否则会出现「第 1 / 0 页」）。 */
export function 总页数(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(total / pageSize))
}

export function AssetPager(props: AssetPagerProps): JSX.Element {
  const 页数 = () => 总页数(props.total, props.pageSize)
  const 能上 = () => props.page > 1
  const 能下 = () => props.page < 页数()

  return (
    <div
      data-slot="asset-pager"
      class="flex flex-wrap items-center justify-between gap-3 border-t border-v2-border-border-base px-4 py-2 text-[13px] text-v2-text-text-muted"
    >
      <span data-slot="asset-pager-total">共 {props.total} 条</span>

      <div class="flex items-center gap-2">
        <button
          type="button"
          data-slot="asset-pager-prev"
          class="rounded-md border border-v2-border-border-base px-2 py-1 disabled:opacity-40"
          disabled={!能上()}
          onClick={() => props.onPage(props.page - 1)}
        >
          上一页
        </button>
        <span data-slot="asset-pager-position">
          第 {props.page} / {页数()} 页
        </span>
        <button
          type="button"
          data-slot="asset-pager-next"
          class="rounded-md border border-v2-border-border-base px-2 py-1 disabled:opacity-40"
          disabled={!能下()}
          onClick={() => props.onPage(props.page + 1)}
        >
          下一页
        </button>
      </div>

      <label class="flex items-center gap-1">
        <span>每页</span>
        <select
          data-slot="asset-pager-size"
          class="rounded-md border border-v2-border-border-base bg-transparent px-1 py-0.5"
          onChange={(event) => props.onPageSize(Number(event.currentTarget.value))}
        >
          <For each={PAGE_SIZES}>
            {(size) => (
              <option value={size} selected={size === props.pageSize}>
                {size}
              </option>
            )}
          </For>
        </select>
        <span>条</span>
      </label>
    </div>
  )
}

/** 只有一页且总数不为 0 时也显示（用户要能看到「共几条」）；0 条时整条隐藏。 */
export const 需要页码条 = (total: number): boolean => total > 0
