// @ts-nocheck
import { AssetDetail } from "./asset-detail"
import { 样例资产 } from "./asset-story-fixtures"

/**
 * 资产详情（009 T007 / DESIGN §4.10）——给 axe 照的观测面（理由见
 * `ai-session/instruction-cards.stories.tsx`）。
 *
 * 详情是**页内状态**（`AssetCenter` 选中后盖在浏览区上），不是路由，所以 story 直接给
 * `asset` ＋ 空 `onBack` 就还原了真实画面。默认落在「介绍」分区（`当前` 初值）。
 *
 * 三态各自对应一段**不同的 DOM**：
 *
 * - **已发布 skill**：头部渲染「▶ 让 AI 助手执行此 skill」（T015），底部有评分 / 收藏 / 使用数；
 * - **无评分**：头部与评价区都走「暂无评分」分支（文案对比度组合不同）；
 * - **知识库**：按 design，执行按钮**只对 skill 渲染** ⇒ 这一态头部少一颗按钮，可访问名称的
 *   邻接关系也不同。只画 skill 那一种就照不到「不该有的按钮有没有出现」。
 */

const 返回 = () => {}

export const 已发布skill = {
  render: () => (
    <div style={{ width: "520px", height: "560px", display: "flex", flexDirection: "column" }}>
      <AssetDetail
        asset={样例资产({
          id: "a1",
          name: "资金流水分析",
          usageCount: 128,
          favoriteCount: 12,
          rating: 4.6,
          ratingCount: 8,
        })}
        onBack={返回}
      />
    </div>
  ),
}

export const 无评分 = {
  render: () => (
    <div style={{ width: "520px", height: "560px", display: "flex", flexDirection: "column" }}>
      <AssetDetail asset={样例资产({ id: "a5", name: "关联账户扩展", publishedAt: null })} onBack={返回} />
    </div>
  ),
}

export const 知识库 = {
  render: () => (
    <div style={{ width: "520px", height: "560px", display: "flex", flexDirection: "column" }}>
      <AssetDetail
        asset={样例资产({
          id: "a4",
          name: "涉案财物清单",
          type: "knowledge_base",
          tags: ["文书", "财物"],
        })}
        onBack={返回}
      />
    </div>
  ),
}

export default {
  title: "App/OpenHive/AiAssets/Detail",
  id: "app-openhive-ai-assets-detail",
}
