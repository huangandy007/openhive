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
 * 空间默认**全选**（design §1.1「多选，默认全部」）；类型默认 Skill（三个 Tab 的第一项）。
 *
 * ## 分类默认**不展开**（T017 裁定，2026-10-27）
 *
 * 009 的原口径是「默认展开 `order` 最小的那一项」。**改掉了**，理由是实测出来的：
 * 真栈上已发布的「湖州公安风格领导讲话稿」属于「内勤文字」，而默认展开的是「情报研判」——
 * 用户点进「AI 资产」看到的是一片空态，随后报「AI 资产里面看不到」。分类是**收窄**手段，
 * 使用面的第一屏必须是「我能用的东西」；默认收窄等于把没落在第一类的资产全藏起来。
 *
 * 代价：左栏一进来没有展开项。点一项就收窄、再点它回到「全部」——与空间全选、搜索留空
 * 是同一种「默认不筛」的姿态。若产品以后要「默认落在某类」，改这一行即可。
 */
export function createAssetFilter(): AssetFilter {
  const [spaces, setSpaces] = createSignal<readonly AssetVisibility[]>([...ASSET_VISIBILITIES])
  const [type, setType] = createSignal<AssetType>(ASSET_TYPES[0])
  const [category, setCategory] = createSignal<string | undefined>(undefined)

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
