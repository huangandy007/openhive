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
 * 各态对应一段**不同的 DOM**：
 *
 * - **已发布 skill**：头部右上角渲染「已收藏」与「已启用」（2026-10-29 起从卡片搬进来），
 *   **两个都处于选中态**（淡金底 ＋ 金色图标，`asset-action-active.css`）——实心星也在这一态；
 * - **无评分**：启用按钮走**禁用态**（没选项目）——`title` 与 `opacity` 是不同的对比度组合。
 *   （评分 / 评价分区已于 2026-10-29 收起，这个 story 名保留，照的是「按钮禁用」那一态。）
 * - **知识库**：启用按钮对三类资产都渲染（能不能启用由服务端判，前端不按类型藏）。
 * - **失败提示**：收藏失败时头部那条 `role="alert"`（`state-*danger` 一组颜色）——详情打开时
 *   浏览区的横幅是 hidden 的，这条是用户唯一看得见的失败。
 *   各态并置才照得到「按钮该不该出现 / 该不该禁用 / 选中了没有 / 失败了看不看得见」。
 *
 * **不给 `onToggleEnabled` 的那一态不画**：省略接线就不渲染按钮（`#008-04`），那是组件被
 * 裸挂的形状，不是产品画面。唯一例外是文件末尾两个「使用记录」story：它们只照文案三态
 * （`data-slot="asset-detail-usage"`），按钮接不接线不是它们的观测面。
 */

const 返回 = () => {}

export const 已发布skill = {
  render: () => (
    <div style={{ width: "520px", height: "560px", display: "flex", flexDirection: "column" }}>
      <AssetDetail
        asset={样例资产({
          id: "a1",
          name: "资金流水分析",
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

export const 未选中_禁用 = {
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

export const 失败提示 = {
  render: () => (
    <div style={{ width: "520px", height: "560px", display: "flex", flexDirection: "column" }}>
      <AssetDetail
        asset={样例资产({ id: "a1", name: "资金流水分析" })}
        onBack={返回}
        onToggleEnabled={() => {}}
        onToggleFavorite={() => {}}
        favorited
        error="收藏失败，请检查网络后重试"
      />
    </div>
  ),
}

/**
 * 使用记录三态（2026-10-29）：服务端 `usageStats` 给了才显示。两个 story 只差
 * `stats` 里有没有 `a1`——「有人用过」与「还没人用过」是两段不同的文案，不是 0 与正数之差。
 */
export const 有使用记录 = {
  render: () => (
    <div style={{ width: "520px", height: "560px", display: "flex", flexDirection: "column" }}>
      <AssetDetail
        asset={样例资产({ id: "a1", name: "资金流水分析" })}
        onBack={返回}
        usage={{ days: 30, stats: { a1: { users: 3, calls: 12 } } }}
      />
    </div>
  ),
}

export const 还没人用过 = {
  render: () => (
    <div style={{ width: "520px", height: "560px", display: "flex", flexDirection: "column" }}>
      <AssetDetail
        asset={样例资产({ id: "a1", name: "资金流水分析" })}
        onBack={返回}
        usage={{ days: 30, stats: {} }}
      />
    </div>
  ),
}

export default {
  title: "App/OpenHive/AiAssets/Detail",
  id: "app-openhive-ai-assets-detail",
}
