import { createSignal } from "solid-js"
import { createCatalogApi, type CatalogApi } from "./asset-catalog-api"

/**
 * 能力面板「MCP」组的数据源（2026-11-03）。
 *
 * ## 为什么单独一个源
 *
 * 能力面板挂在项目管理页，而资产目录（`asset-catalog.ts`）是资产 Tab 自己的状态——两处
 * 共用一份会互相改筛选条件。这里只做三件事：**按需取一次、把三态分开、不发重复请求**。
 *
 * ## 判据不在这里
 *
 * 可见性由服务端收敛：`GET /openhive/assets?type=mcp` 已经走 `readableAssetCondition`
 * （与卡片列表、MCP 可用性同一个出口）。前端再过滤一遍就是第二套判据，迟早与后端漂开
 * （`#002-06` / `#010-06`）——所以这里只按 `type` 收窄，不按空间/成员再筛一次。
 *
 * ## 三态
 *
 * `list === undefined` = **还没读到**（初始 / 请求在飞 / 失败）。失败时不要给空数组：
 * 那会把「没读到」画成「一台都没有」（`#002-02`）。
 */
export interface McpCapabilityItem {
  readonly id: string
  readonly name: string
  readonly description: string
}

export interface McpCapability {
  /** 已读到的清单；`undefined` = 还没读到（见文件头「三态」）。 */
  readonly list: () => readonly McpCapabilityItem[] | undefined
  /** 最近一次失败的原因；成功一次就清空。 */
  readonly error: () => string | undefined
  /** 请求在飞。 */
  readonly busy: () => boolean
  /** 取一次；在飞期间再调不发第二个请求（连点不放大）。 */
  readonly load: () => void
}

/**
 * 一页取满：能力面板不是分页列表，只列「有权使用的 MCP」。上限 100 与资产目录的
 * `PAGE_SIZES` 最大值一致；超出的部分这一版不展示（缺口记在 `#002-02` 口径下，不假装全列）。
 */
const 一页条数 = 100

export function createMcpCapability(api: CatalogApi = createCatalogApi()): McpCapability {
  const [清单, set清单] = createSignal<readonly McpCapabilityItem[] | undefined>()
  const [错误, set错误] = createSignal<string | undefined>()
  const [忙, set忙] = createSignal(false)
  // 请求代数：只有最后发出的那一次能落信号。单飞已经挡住并发，这里再挡一道
  // 「上一次的迟回包把新结果盖掉」（`#005-26` 取数时机的同形）。
  let 代次 = 0

  const load = () => {
    if (忙()) return
    const 本次 = ++代次
    set忙(true)
    void api
      .list({ type: "mcp", page: 1, pageSize: 一页条数 })
      .then((结果) => {
        if (本次 !== 代次) return
        if (结果.kind === "ok") {
          set清单(
            结果.value.assets.map((asset) => ({
              id: asset.id,
              name: asset.name,
              description: asset.description,
            })),
          )
          set错误(undefined)
        } else {
          // 失败不产生清单：`undefined` 与空数组在面板上是两句不同的话。
          set错误(结果.message)
        }
        set忙(false)
      })
  }

  return { list: 清单, error: 错误, busy: 忙, load }
}
