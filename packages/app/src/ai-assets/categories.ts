import { createSignal } from "solid-js"
import {
  createCategoryApi,
  type AssetCategoryRow,
  type CategoryApi,
  type CategoryOutcome,
} from "./category-api"

/**
 * 【保留的定制 · 同步上游时不要丢】AI 资产左栏的分类数据源（需求 4，2026-10-27）。
 *
 * 与 `asset-catalog.ts` 同一种角色：**注入缝的下游**。`AssetNav` 只认一个访问器，生产实现
 * 在这里（`pages/layout-new.tsx` 建一份传下去），组件测试因此仍然离线、不发请求。
 *
 * ## 失败不清空已有分类
 *
 * 拉不到时只把 `error` 置成一句人话，**保留上一次的清单**——旧分类还能点，比左栏突然空掉
 * 好得多；空掉会让用户以为分类没了。首次就失败时清单本来就是空的，`AssetNav` 据此显示那句错。
 *
 * ## 并发的旧回包不覆盖新回包
 *
 * 进资产视图会 `reload()`，用户来回切视图时可能几条请求同时在飞。每次领一个代次号，
 * 回来时不是最新就丢弃（`LEARNINGS #008-03`）。
 *
 * ## 不自动拉
 *
 * 建好之后由入口决定什么时候拉（`pages/layout-new.tsx` 挂载时拉一次、每次进入资产视图再拉）。
 * 在本函数里拉会让组件测试（注入替身）多一次意料之外的调用。
 */
export interface AssetCategories {
  /** 左栏当前的分类行（首次成功前为空数组）。 */
  readonly rows: () => readonly AssetCategoryRow[]
  /** 最近一次拉取的失败原因；成功后清空。 */
  readonly error: () => string | undefined
  readonly reload: () => void
}

export function createAssetCategories(api: CategoryApi = createCategoryApi()): AssetCategories {
  const [行, set行] = createSignal<readonly AssetCategoryRow[]>([])
  const [错误, set错误] = createSignal<string | undefined>()

  let 代次 = 0

  const reload = () => {
    const 本次 = ++代次
    void api.list().then((结果: CategoryOutcome<readonly AssetCategoryRow[]>) => {
      if (本次 !== 代次) return
      if (结果.kind === "ok") {
        set行(结果.value)
        set错误(undefined)
        return
      }
      set错误(结果.message)
    })
  }

  return { rows: 行, error: 错误, reload }
}
