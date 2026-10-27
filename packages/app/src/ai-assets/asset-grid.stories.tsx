// @ts-nocheck
import { AssetGrid } from "./asset-grid"
import { 样例资产列表 } from "./asset-story-fixtures"

/**
 * 中栏资产网格（009 T006 / DESIGN §4.9）——给 axe 照的观测面（理由见
 * `ai-session/instruction-cards.stories.tsx`）。
 *
 * ⚠️ 网格是**按行虚拟滚动**（`@tanstack/solid-virtual`），必须有真浏览器给的滚动容器与
 * `ResizeObserver` 才出内容——happy-dom 里量到的宽恒为 800、行高恒为 0，**一张卡都渲染不出来**。
 * 所以这几条 story 只有在这个审计面（真 Chromium）里才有意义；包裹容器给死宽高，等同产品里
 * 中栏的尺寸约束。
 *
 * 两态：有资产（`role="list"` ＋ 卡片）、空列表（fallback 文案，无列表语义）。
 *
 * 需求 6 起网格只画**服务端给的那一页**：筛选与搜索都在服务端，所以「搜索无命中」与「空列表」
 * 在网格看来是同一个画面——这里不再造两种。
 */

const 打开 = () => {}

function 网格() {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "760px", height: "520px" }}>
      <AssetGrid assets={() => 样例资产列表} onOpen={打开} />
    </div>
  )
}

export const 有资产 = {
  render: () => <网格 />,
}

export const 空列表 = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", width: "760px", height: "520px" }}>
      <AssetGrid assets={() => []} onOpen={打开} />
    </div>
  ),
}

export default {
  title: "App/OpenHive/AiAssets/Grid",
  id: "app-openhive-ai-assets-grid",
}
