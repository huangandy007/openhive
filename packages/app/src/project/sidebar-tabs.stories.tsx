// @ts-nocheck
import { createSignal } from "solid-js"
import { SidebarTabs, type SidebarTabKey } from "./sidebar-tabs"

/**
 * 左栏 tab 容器（005 T019 · 设计 §2 ②）：`[会话] [文件]`，默认「文件」。
 *
 * ## 为什么这两个 story 都非要不可
 *
 * 本组件是一个 **ARIA tabs**（`role="tablist"` / `role="tab"` / `role="tabpanel"` +
 * `aria-controls` + `aria-labelledby` + roving tabindex）。这套东西**只有一个 tab 可见**
 * 不是缺陷、而是规格：非激活的 pane 带 `hidden`，因此**不进 Tab 顺序**。
 * 所以「会话」与「文件」是**两个不同的可访问性状态**，axe 各查一遍才算照全。
 *
 * ## 受控：状态必须由 story 自己持有
 *
 * `active` 是受控 prop（组件不持有 tab 状态——它要同时被 MinIO 窄条与中栏模块切换读到）。
 * 所以这里用 `createSignal` 包一层，让 storybook 里点得动。
 */
export default {
  title: "App/OpenHive/SidebarTabs",
  id: "app-openhive-sidebar-tabs",
  component: SidebarTabs,
}

/** 「文件」tab 的 body 由调用方注入——组件不认识文件树，所以 story 也不必用真树。 */
const 文件body = (
  <p data-slot="story-files-body" class="px-1 py-2 text-[13px] text-v2-text-text-faint">
    （这里由调用方注入文件树）
  </p>
)

/** 「会话」tab 的 body **同样**由调用方注入（生产接的是 `@/ai-session/sidebar-sessions`）。 */
const 会话body = (
  <p data-slot="story-sessions-body" class="px-1 py-2 text-[13px] text-v2-text-text-faint">
    （这里由调用方注入会话列表）
  </p>
)

const 受控 = (初始: SidebarTabKey) => {
  const [active, setActive] = createSignal<SidebarTabKey>(初始)
  return () => (
    <SidebarTabs active={active()} onSelect={setActive} files={文件body} sessions={会话body} />
  )
}

/** 默认档：激活「文件」，`会话` pane 带 `hidden`（不进 Tab 顺序）。 */
export const FilesTab = {
  render: 受控("files"),
}

/** 激活「会话」：body 是调用方注入的那一块（空态归列表自己，不在这里）。 */
export const SessionTab = {
  render: 受控("session"),
}
