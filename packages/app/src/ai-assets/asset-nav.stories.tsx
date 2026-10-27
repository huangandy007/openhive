// @ts-nocheck
import { ASSET_CATEGORY_SEED } from "@opencode-ai/asset-service/categories"
import { AssetNav } from "./asset-nav"
import { createAssetFilter } from "./filter"

/**
 * AI 资产左栏（009 T005 / DESIGN §4.8）——**给 axe 照的观测面**。
 *
 * 理由与 `ai-session/instruction-cards.stories.tsx`（蓝本）逐字相同：jsx-a11y 那道 lint 门只判
 * 「静态可判」的一半（键盘可达 / 可访问名称 / aria 角色用法），**对比度**要 axe ＋ 真浏览器；
 * 而 axe 只照得到**有 story 的组件**（`packages/storybook/.storybook/main.ts` 的 glob 决定）。
 *
 * ## 两态都要进审计面
 *
 * 选中态走 `bg-[var(--v2-background-bg-accent-soft)]`（空间按钮 / 类型 Tab / 展开的分类行）。
 * 浅金底那对颜色在 dark 主题下是**已知的对比度敏感处**（[[dark-theme-selected-state-contrast]]），
 * 只画「全默认态」就等于放弃另一半审计面。
 */

/**
 * 故事用的分类夹具：需求 4 起分类由服务端来，故事里直接拿 seed 当「服务端回了这九类」。
 * （seed 在这条路径上只是替身——生产实现见 `ai-assets/categories.ts`。）
 */
const 分类 = [...ASSET_CATEGORY_SEED].map(({ id, name }) => ({ id, name }))

function 默认筛选() {
  const filter = createAssetFilter()
  return <AssetNav filter={filter} categories={() => 分类} />
}

/**
 * 默认态（design §1.1 的初始画面）：空间全选、类型 Skill、分类默认展开 `order` 最小的那一项。
 */
export const 默认 = {
  render: () => <默认筛选 />,
}

/** 另一头：只留部门空间、类型切到 MCP、分类全部收起（`aria-expanded` 全 false）。 */
function 收窄筛选() {
  const filter = createAssetFilter()
  filter.toggleSpace("global")
  filter.toggleSpace("personal")
  filter.selectType("mcp")
  filter.selectCategory("intelligence")
  return <AssetNav filter={filter} categories={() => 分类} />
}

export const 收窄 = {
  render: () => <收窄筛选 />,
}

export default {
  title: "App/OpenHive/AiAssets/Nav",
  id: "app-openhive-ai-assets-nav",
}
