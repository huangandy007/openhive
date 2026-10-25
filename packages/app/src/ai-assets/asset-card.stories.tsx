// @ts-nocheck
import { AssetCard } from "./asset-card"
import { 样例资产 } from "./asset-story-fixtures"

/**
 * 资产卡片（009 T006 / T007 / DESIGN §4.9–§4.10）——给 axe 照的观测面（理由见
 * `ai-session/instruction-cards.stories.tsx`）。
 *
 * ⚠️ 卡片自己是 `role="listitem"`，**必须套在 `role="list"` 里**——裸渲染会让 axe 报
 * `listitem` 没有列表父级。这里的包裹不是「为了好看」，是组件**真实使用形状**的一部分
 * （产品里它就是 `AssetGrid` 的 `role="list"` 的孩子）。
 *
 * 两态：**已发布**（徽章「部门 / 已发布」）与**已下线**（徽章换成「已下线」）。徽章文字不同
 * ⇒ 前景 / 背景的对比度组合也不同，只画一种就漏了另一种。
 */

const 打开 = () => {}

export const 已发布 = {
  render: () => (
    <div role="list" style={{ width: "240px" }}>
      <AssetCard asset={样例资产({ id: "a1", name: "资金流水分析" })} onOpen={打开} />
    </div>
  ),
}

export const 已下线 = {
  render: () => (
    <div role="list" style={{ width: "240px" }}>
      <AssetCard
        asset={样例资产({ id: "a3", name: "审讯提纲生成", status: "offline", visibility: "personal" })}
        onOpen={打开}
      />
    </div>
  ),
}

export default {
  title: "App/OpenHive/AiAssets/Card",
  id: "app-openhive-ai-assets-card",
}
