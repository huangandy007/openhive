import { createSignal } from "solid-js"
import type { AssetMetadata } from "@opencode-ai/asset-service/metadata"
import { createCatalogApi, type CatalogApi, type CatalogOutcome } from "./asset-catalog-api"

/**
 * AI 资产使用面的数据源（T017）：把「拉一次列表」变成可被界面读的三样东西。
 *
 * 与 `AssetCenter` / `WorkspaceEntry` 的关系是**注入缝的下游**：那两层只认访问器，
 * 生产实现在这里（`pages/layout-new.tsx` 建一份、传下去），组件测试因此仍然离线。
 *
 * ## 什么时候拉
 *
 * **进入 AI 资产视图时拉**，不是挂载时拉一次：
 *
 * - 挂载时拉，用户发布完再切过来看到的是旧清单——「刚发布却看不见」正是本轮要修的病，
 *   换成「要刷新页面才看得见」等于没修；
 * - 每次进入都拉，代价是一份列表查询，换来的是「切过来就是最新的」。
 *
 * 由 `WorkspaceEntry` 的 `onAssetsOpen` 在视图变成 `ai-assets` 时触发。
 *
 * ## 失败不静默
 *
 * 失败只把 `error` 置成一句人话，**不清空已有清单**（旧清单比白屏有用），也不把失败
 * 伪装成「没有资产」——那会让用户以为资产丢了。
 *
 * ## 并发的旧回包不覆盖新回包
 *
 * 快速来回切视图会同时飞两三个请求，回包顺序不保证。每次请求领一个代次号，回来时代次
 * 不是最新的就丢弃（`#008-03`：异步链上等回来的是哪一次，得自己钉住）。
 */
export interface AssetCatalog {
  /** 当前清单（首次成功前为空数组）。 */
  readonly assets: () => readonly AssetMetadata[]
  /** 最近一次拉取的失败原因；成功后清空。 */
  readonly error: () => string | undefined
  /** 拉一次（进入视图时调）。重复调用安全。 */
  readonly refresh: () => void
}

export function createAssetCatalog(api: CatalogApi = createCatalogApi()): AssetCatalog {
  const [清单, set清单] = createSignal<readonly AssetMetadata[]>([])
  const [错误, set错误] = createSignal<string | undefined>()

  let 代次 = 0

  const refresh = () => {
    const 本次 = ++代次
    void api.list().then((结果: CatalogOutcome<readonly AssetMetadata[]>) => {
      if (本次 !== 代次) return
      if (结果.kind === "ok") {
        set清单(结果.value)
        set错误(undefined)
        return
      }
      set错误(结果.message)
    })
  }

  return { assets: 清单, error: 错误, refresh }
}
