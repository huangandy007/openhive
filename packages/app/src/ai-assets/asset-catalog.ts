import { createSignal } from "solid-js"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import {
  createCatalogApi,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  type CatalogApi,
  type CatalogOutcome,
  type CatalogPage,
  type CatalogQuery,
  type UsageStats,
} from "./asset-catalog-api"
import { createFavoriteApi, type FavoriteApi, type FavoriteOutcome } from "./favorite-api"

/**
 * AI 资产使用面的数据源（T017 / 需求 6）：把「拉一页」变成界面能读的一小组信号。
 *
 * 与 `AssetCenter` / `WorkspaceEntry` 的关系是**注入缝的下游**：那两层只认这个对象，
 * 生产实现在这里（`pages/layout-new.tsx` 建一份、传下去），组件测试因此仍然离线。
 *
 * ## 筛选变化 = 回到第 1 页
 *
 * 换分类 / 换空间 / 改搜索词之后还停在第 3 页，用户看到的是「筛完的第 3 页」——大概率是空的。
 * 所以 `load()` 只在**条件真的变了**时把页码归 1；同条件重入（Solid 的 effect 会因为别的信号
 * 再跑一次）不会把用户翻到的页顶回去。
 *
 * ## 每页条数是账号偏好
 *
 * `setPageSize` 改完会回调 `persist`（由入口接到 `/openhive/preferences`），下一个设备登录
 * 读回来还是这个数。**持久化失败不影响浏览**：偏好丢了只是下次回到 20，不该把列表打成错误。
 *
 * ## 失败不静默
 *
 * 失败只把 `error` 置成一句人话，**不清空已有清单**（旧清单比白屏有用），也不把失败
 * 伪装成「没有资产」——那会让用户以为资产丢了。
 *
 * ## 并发的旧回包不覆盖新回包
 *
 * 快速翻页 / 连续输入会同时飞几个请求，回包顺序不保证。每次请求领一个代次号，回来时代次
 * 不是最新的就丢弃（`#008-03`：异步链上等回来的是哪一次，得自己钉住）。
 *
 * ## 收藏：服务端说了算（2026-10-29）
 *
 * 点击**不**先改本地集合再发请求（乐观更新）：失败时界面已经显示「已收藏」，用户得再看一次
 * 它跳回来，等于被界面骗了一次。这里等回包，只认服务端读回来的 `favorited` 与
 * `favoriteCount`——同 `enable-state` 的纪律，也同 `#010-06`（两套来源不各判一次）。
 *
 * 在飞的时候再点直接忽略：一条一条来，回包顺序才有定数，不会出现「先发的后到」把状态翻掉。
 * 集合由 `load` 成功时的 `favoritedIds` 重建，切换筛选 / 翻页后仍然是对的。
 */
export interface AssetCatalog {
  /** 当前这一页（首次成功前为空数组）。 */
  readonly assets: () => readonly AssetMetadata[]
  /** 当前条件下服务端报的总数（不是本页条数）。 */
  readonly total: () => number
  readonly page: () => number
  readonly pageSize: () => number
  /**
   * 本页资产用到的分类名（需求 2，id → 名称，含停用分类）。
   *
   * 「其他」桶里的卡片要标「原分类：xxx」，名字只能从服务端来——前端拼 seed 常量是第二份
   * 真相（管理员改过名就对不上）。失败时**不清**（清单也没清），空集短路时清掉。
   */
  readonly categoryNames: () => Readonly<Record<string, string>>
  /** 最近一次拉取的失败原因；成功后清空。 */
  readonly error: () => string | undefined
  /**
   * 最近 N 天的使用统计（2026-10-29）；`undefined` = 旧内核没给（详情不显示这一项）。
   * 由每次 `load` 成功时的回包重建；空间全取消时清空（与清单同进退）。
   */
  readonly usage: () => UsageStats | undefined
  /** 本页里「我」收藏过的资产 id（2026-10-29）；由每次 `load` 成功时的回包重建。 */
  readonly favorited: () => ReadonlySet<string>
  /** 正在写收藏的那个资产 id；没有在飞的就是 `undefined`。 */
  readonly favoriteBusy: () => string | undefined
  /** 送**目标态**（true = 收藏）。在飞时重复调用被忽略；状态一律照服务端回包改。 */
  readonly setFavorite: (assetId: string, favorited: boolean) => void
  /**
   * 换查询条件并拉第 1 页。同条件重复调用 = 刷新当前页。
   * 空间全取消（空数组）走短路：**不发请求**，直接空集。
   */
  readonly load: (query: CatalogQuery) => void
  /** 翻页（保持当前条件）。越界页码照发，服务端回空页，前端不算总页数时自己收口。 */
  readonly goPage: (page: number) => void
  /** 改每页条数并回到第 1 页；白名单外的值直接忽略（不猜）。 */
  readonly setPageSize: (size: number) => void
  /** 同条件重拉（进入视图 / 失败重试）。 */
  readonly reload: () => void
}

export interface AssetCatalogOptions {
  /** 每页条数改了之后调一次（持久化到账号偏好）。省略 = 不持久化。 */
  readonly persistPageSize?: (size: number) => void
  /** 初始每页条数（从账号偏好读回来之前不设，读到再调 `setPageSize`）。 */
  readonly initialPageSize?: number
  /** 收藏的写出口；省略 = 真 `fetch`（测试注入替身）。 */
  readonly favoriteApi?: FavoriteApi
}

/**
 * 条件的稳定键：只比条件，不比页码（页码归 1 的判据就在这儿）。
 *
 * ⚠️ `spaces: undefined`（不过滤）与 `spaces: []`（全取消 = 空集）**必须是两个键**：
 * 用一个 `?? []` 抹平，用户点掉最后一个空间时条件「没变」，短路分支永远进不去。
 */
function 条件键(query: CatalogQuery): string {
  const spaces = query.spaces === undefined ? "*" : [...query.spaces].sort().join(",")
  return JSON.stringify([query.type ?? "", query.category ?? "", query.q?.trim() ?? "", spaces])
}

export function createAssetCatalog(api: CatalogApi = createCatalogApi(), options: AssetCatalogOptions = {}): AssetCatalog {
  const [清单, set清单] = createSignal<readonly AssetMetadata[]>([])
  const [总数, set总数] = createSignal(0)
  const [页码, set页码] = createSignal(1)
  const [每页, set每页] = createSignal(options.initialPageSize ?? DEFAULT_PAGE_SIZE)
  const [分类名, set分类名] = createSignal<Readonly<Record<string, string>>>({})
  const [错误, set错误] = createSignal<string | undefined>()
  const [用量, set用量] = createSignal<UsageStats | undefined>()
  const [收藏, set收藏] = createSignal<ReadonlySet<string>>(new Set<string>())
  const [收藏中, set收藏中] = createSignal<string | undefined>()
  const 收藏Api = options.favoriteApi ?? createFavoriteApi()

  let 当前条件: CatalogQuery = {}
  let 当前键 = 条件键({})
  let 代次 = 0

  const 拉 = () => {
    // 空间全取消：结果是空集。发一个不带 visibility 的请求会回全量——那正是「取消不掉」
    // 这个 bug 的形状，所以在**本地**就把它钉成空。
    if (当前条件.spaces !== undefined && 当前条件.spaces.length === 0) {
      代次 += 1
      set清单([])
      set总数(0)
      set分类名({})
      set用量(undefined)
      set收藏(new Set<string>())
      set错误(undefined)
      set页码(1)
      return
    }

    const 本次 = ++代次
    void api
      .list({ ...当前条件, page: 页码(), pageSize: 每页() })
      .then((结果: CatalogOutcome<CatalogPage>) => {
        if (本次 !== 代次) return
        if (结果.kind === "ok") {
          set清单(结果.value.assets)
          set总数(结果.value.total)
          set分类名(结果.value.categoryNames)
          set用量(结果.value.usageStats)
          set收藏(new Set(结果.value.favoritedIds))
          set错误(undefined)
          return
        }
        set错误(结果.message)
      })
  }

  const load = (query: CatalogQuery) => {
    const 键 = 条件键(query)
    if (键 !== 当前键) {
      当前键 = 键
      当前条件 = query
      set页码(1)
    }
    拉()
  }

  const goPage = (page: number) => {
    if (!Number.isInteger(page) || page < 1) return
    set页码(page)
    拉()
  }

  const setPageSize = (size: number) => {
    if (!(PAGE_SIZES as readonly number[]).includes(size)) return
    if (size === 每页()) return
    set每页(size)
    set页码(1)
    options.persistPageSize?.(size)
    拉()
  }

  const setFavorite = (assetId: string, favorited: boolean) => {
    // 一条一条来：先发的后到会把状态翻掉，而用户只点了一次。
    if (收藏中() !== undefined) return
    set收藏中(assetId)
    void 收藏Api.set(assetId, favorited).then((结果: FavoriteOutcome) => {
      set收藏中(undefined)
      if (结果.kind !== "ok") {
        // 失败不动集合：界面显示「已收藏」但它其实没存上，比不响应更糟。
        set错误(结果.message)
        return
      }
      const { assetId: 目标, favorited: 已收藏, favoriteCount } = 结果.value
      set收藏((旧) => {
        const 新 = new Set(旧)
        if (已收藏) 新.add(目标)
        else 新.delete(目标)
        return 新
      })
      // 「N 人收藏」用服务端读回来的数，不在本地 ±1：并发收藏 / 旧缓存会让本地算的数越漂越远。
      set清单((旧) => 旧.map((资产) => (资产.id === 目标 ? { ...资产, favoriteCount } : 资产)))
      set错误(undefined)
    })
  }

  return {
    assets: 清单,
    total: 总数,
    page: 页码,
    pageSize: 每页,
    categoryNames: 分类名,
    error: 错误,
    usage: 用量,
    favorited: 收藏,
    favoriteBusy: 收藏中,
    setFavorite,
    load,
    goPage,
    setPageSize,
    reload: 拉,
  }
}
