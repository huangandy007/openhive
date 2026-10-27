import { createSignal, type Accessor } from "solid-js"
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
 * ## 分类行**不在这里**（需求 4，2026-10-27）
 *
 * 原先本文件从 `@opencode-ai/asset-service/categories` 的 seed 派生 `ASSET_CATEGORY_ROWS`。
 * 分类改为管理员维护、进库之后，那条读法就是「管理员改了、用户看不见」的两份真相
 * （`LEARNINGS #002-06`），已删除。分类的唯一来源是服务端（`category-api.ts` ＋ `categories.ts`），
 * 由 `AssetNav` 通过访问器接收；本文件只管**选中了哪个 id**。
 */

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
  /**
   * 回到「全部」（需求 1，2026-10-27）：不按分类收窄。
   *
   * 与 `selectCategory` 分开是有意的：那是开关（再点同一项也会回到全部），而左栏顶部的
   * 「全部」必须在**任何**状态下都表示「不筛」——包括已经选着某一类的时候。
   */
  readonly clearCategory: () => void
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
    clearCategory: () => setCategory(undefined),
  }
}
