// @ts-nocheck
import { createSignal } from "solid-js"
import { AssetSearch } from "./asset-search"

/**
 * 中栏搜索框（009 T006 / DESIGN §4.9）——给 axe 照的观测面（理由见
 * `ai-session/instruction-cards.stories.tsx`）。
 *
 * 受控组件（值由上层持有），所以 story 必须自带一份信号：**空值**与**有值**是两种真实状态
 * ——有值时右侧多出「清除搜索」按钮（一个独立可聚焦按钮，axe 要查它的可访问名称），
 * 只画空态就照不到它。
 */

function 受控(props: { readonly 初值?: string }) {
  const [值, set值] = createSignal(props.初值 ?? "")
  return (
    <div style={{ width: "420px", padding: "12px" }}>
      <AssetSearch value={值()} onInput={set值} />
    </div>
  )
}

export const 空 = {
  render: () => <受控 />,
}

export const 有搜索词 = {
  render: () => <受控 初值="资金" />,
}

export default {
  title: "App/OpenHive/AiAssets/Search",
  id: "app-openhive-ai-assets-search",
}
