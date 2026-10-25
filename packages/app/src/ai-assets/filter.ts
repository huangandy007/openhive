import { createSignal, type Accessor } from "solid-js"
import { ASSET_CATEGORY_SEED } from "@opencode-ai/asset-service/categories"
import {
  ASSET_TYPES,
  ASSET_VISIBILITIES,
  type AssetType,
  type AssetVisibility,
} from "@opencode-ai/asset-service/metadata"

/**
 * AI 资产左栏的筛选条件（009 T005）。
 *
 * **状态按挂载点生成，不做模块级单例**：`filter.ts` 被 `WorkspaceEntry` 调一次、测试各调一次，
 * 互不串味（`LEARNINGS #005-03`：模块级缝没复位，红绿会取决于用例顺序）。
 *
 * 分类行**只从 `asset-service` 的 seed 来**（`categories.ts` 文件头：T005 只消费本字典）：
 * 前端再抄一份，改名时两处就静默分家（`LEARNINGS #002-06`）。
 */
export interface AssetCategoryRow {
  readonly id: string
  readonly name: string
}

/** 左栏展示用的分类行：按 `order` 升序。seed 是只读的，这里只派生一份展示形状。 */
export const ASSET_CATEGORY_ROWS: readonly AssetCategoryRow[] = [...ASSET_CATEGORY_SEED]
  .sort((a, b) => a.order - b.order)
  .map(({ id, name }) => ({ id, name }))

export interface AssetFilter {
  /** 已选空间，恒按 `ASSET_VISIBILITIES` 的顺序。 */
  readonly spaces: Accessor<readonly AssetVisibility[]>
  readonly type: Accessor<AssetType>
  /** 当前展开的分类 id；`undefined` = 全部收起。 */
  readonly category: Accessor<string | undefined>
  readonly spaceOn: (space: AssetVisibility) => boolean
  readonly toggleSpace: (space: AssetVisibility) => void
  readonly selectType: (type: AssetType) => void
  /** 单开手风琴：点同一项收起，点另一项换过去。 */
  readonly selectCategory: (id: string) => void
}

/**
 * 一次挂载一份筛选状态。
 *
 * 空间默认**全选**（design §1.1「多选，默认全部」）；类型默认 Skill（三个 Tab 的第一项）；
 * 分类默认展开 `order` 最小的那一项（design §1.1「默认展开当前分类」——没有更多用户状态时，
 * 第一项就是当前的默认分类）。
 */
export function createAssetFilter(): AssetFilter {
  const [spaces, setSpaces] = createSignal<readonly AssetVisibility[]>([...ASSET_VISIBILITIES])
  const [type, setType] = createSignal<AssetType>(ASSET_TYPES[0])
  const [category, setCategory] = createSignal<string | undefined>(ASSET_CATEGORY_ROWS[0]?.id)

  return {
    spaces,
    type,
    category,
    spaceOn: (space) => spaces().includes(space),
    toggleSpace: (space) =>
      setSpaces((当前) =>
        // 按闭集顺序重建，而不是 push/删后保留操作顺序：顺序是这条信号的契约，不是操作历史。
        ASSET_VISIBILITIES.filter((item) => (item === space ? !当前.includes(item) : 当前.includes(item))),
      ),
    selectType: setType,
    selectCategory: (id) => setCategory((当前) => (当前 === id ? undefined : id)),
  }
}
