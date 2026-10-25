import type { AssetMetadata, AssetType, AssetVisibility } from "@opencode-ai/asset-service/metadata"

/**
 * 中栏卡片网格的纯逻辑（009 T006 / DESIGN §4.9）。
 *
 * 之所以把「筛选 + 搜索 + 列数」抽成不碰 DOM 的函数：网格里最容易错的是**三组条件怎么相交**，
 * 而这件事在组件测试里只能间接着看（渲染出几张卡）。抽出来才能逐条钉住，虚拟滚动那边只剩
 * 「窗口取到哪几行」一件事（`LEARNINGS #005-47`：组件测绿得可疑时，先把可测的谓词挪出来）。
 */

/** 卡片最小宽度（DESIGN §4.9「列数 = floor((容器宽 + 列距) / (最小卡宽 + 列距))」）。 */
export const 卡片最小宽 = 240

/** 卡片固定高度（DESIGN §4.9）：虚拟滚动按固定行高算，卡片内容靠 clamp 收在两行内。 */
export const 卡片高 = 132

/** 卡片行距，同时是列距（DESIGN §4.9 的 `gap: 12px`）。 */
export const 卡片行距 = 12

/** 一行网格占的总高度，虚拟滚动的 `estimateSize` 用它。 */
export const 卡片行高 = 卡片高 + 卡片行距

/**
 * 中栏此刻的查询条件：左栏三组（空间 / 类型 / 分类）＋ 搜索框。
 *
 * `spaces` 为空数组是**合法的**——它表示用户把三个空间全取消了，结果是空集，
 * **不是**「退回全选」（那样空选和全选就没有区别，用户取消不掉任何东西）。
 */
export interface AssetQuery {
  readonly spaces: readonly AssetVisibility[]
  readonly type: AssetType
  /** `undefined` = 分类全部收起，此时不按分类过滤。 */
  readonly category: string | undefined
  readonly search: string
}

/**
 * 搜索匹配口径（DESIGN §4.9）：名称 / 描述 / 标签，子串匹配、忽略大小写、去首尾空格。
 *
 * 空搜索（含纯空白）视为「不过滤」。标签逐个参与匹配，不拼成一个字符串——拼起来会让
 * 跨标签的伪子串命中（`["资金", "研判"]` 不该被 `"金研"` 搜到）。
 */
export function 匹配搜索(asset: AssetMetadata, search: string): boolean {
  const 词 = search.trim().toLowerCase()
  if (词 === "") return true
  return [asset.name, asset.description, ...asset.tags].some((文本) => 文本.toLowerCase().includes(词))
}

/** 左栏筛选与搜索的交集；保持输入顺序（排序是后端的事，见 DESIGN §4.9）。 */
export function 筛选资产(
  assets: readonly AssetMetadata[],
  query: AssetQuery,
): readonly AssetMetadata[] {
  return assets.filter(
    (asset) =>
      query.spaces.includes(asset.visibility) &&
      asset.type === query.type &&
      (query.category === undefined || asset.category === query.category) &&
      匹配搜索(asset, query.search),
  )
}

/** 容器宽 → 列数（至少 1 列：窄窗口下也要有一条能走的路）。 */
export function 网格列数(容器宽: number): number {
  return Math.max(1, Math.floor((容器宽 + 卡片行距) / (卡片最小宽 + 卡片行距)))
}

/** 若干项排成 `列数` 列时占几行（虚拟滚动的行总数）。 */
export function 网格行数(项数: number, 列数: number): number {
  return Math.ceil(项数 / 列数)
}
