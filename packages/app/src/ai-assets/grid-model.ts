/**
 * 中栏卡片网格的**几何**纯逻辑（009 T006 / DESIGN §4.9）。
 *
 * 只剩「列数 / 行数 / 行高」三件事：它们不碰 DOM，抽出来才能逐条钉住，组件测试里只看
 * 「按这个几何取到了哪几行」。
 *
 * ⚠️ 这里**原先还有 `筛选资产` / `匹配搜索`**（空间 ∧ 类型 ∧ 分类 ∧ 搜索的交集）。需求 6 把
 * 筛选连同分页一起下推服务端之后删掉了——两处都筛就会出现「服务端回 20 条、界面 3 条」
 * （`#002-06`）。服务端的匹配口径在 `packages/asset-service/src/asset.ts` 的 `search` 条件
 * （名称 / 描述 / 标签，`ilike` 子串）。
 */

/** 卡片最小宽度（DESIGN §4.9「列数 = floor((容器宽 + 列距) / (最小卡宽 + 列距))」）。 */
export const 卡片最小宽 = 240

/** 卡片固定高度（DESIGN §4.9）：虚拟滚动按固定行高算，卡片内容靠 clamp 收在两行内。 */
export const 卡片高 = 132

/** 卡片行距，同时是列距（DESIGN §4.9 的 `gap: 12px`）。 */
export const 卡片行距 = 12

/** 一行网格占的总高度，虚拟滚动的 `estimateSize` 用它。 */
export const 卡片行高 = 卡片高 + 卡片行距

/** 容器宽 → 列数（至少 1 列：窄窗口下也要有一条能走的路）。 */
export function 网格列数(容器宽: number): number {
  return Math.max(1, Math.floor((容器宽 + 卡片行距) / (卡片最小宽 + 卡片行距)))
}

/** 若干项排成 `列数` 列时占几行（虚拟滚动的行总数）。 */
export function 网格行数(项数: number, 列数: number): number {
  return Math.ceil(项数 / 列数)
}
