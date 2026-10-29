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
 * - **已发布 skill**：头部右上角渲染「已收藏」与「已启用」（2026-10-29 起从卡片搬进来），
 *   底部有评分 / 收藏 / 使用数——实心星与空心星两种图标都照得到；
 * - **无评分**：头部与评价区都走「暂无评分」分支（文案对比度组合不同），启用按钮走
 *   **禁用态**（没选项目）——`title` 与 `opacity` 是不同的对比度组合；
 * - **知识库**：启用按钮对三类资产都渲染（能不能启用由服务端判，前端不按类型藏）。
 *   三态并置才照得到「按钮该不该出现 / 该不该禁用」。
 *
 * **不给 `onToggleEnabled` 的第四态不画**：省略接线就不渲染按钮（`#008-04`），那是组件被
 * 裸挂的形状，不是产品画面。
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
        onToggleEnabled={() => {}}
        onToggleFavorite={() => {}}
        enabled
        favorited
      />
    </div>
  ),
}

export const 无评分 = {
  render: () => (
    <div style={{ width: "520px", height: "560px", display: "flex", flexDirection: "column" }}>
      <AssetDetail
        asset={样例资产({ id: "a5", name: "关联账户扩展", publishedAt: null })}
        onBack={返回}
        onToggleEnabled={() => {}}
        onToggleFavorite={() => {}}
        enableHint="请先在左侧选择项目"
      />
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
        onToggleEnabled={() => {}}
        onToggleFavorite={() => {}}
      />
    </div>
  ),
}

export default {
  title: "App/OpenHive/AiAssets/Detail",
  id: "app-openhive-ai-assets-detail",
}
