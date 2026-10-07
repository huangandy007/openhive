// @ts-nocheck
import { ProjectAnchor } from "./project-anchor"

/**
 * 项目锚点行（005 T005）——左栏顶上那一条。
 *
 * ## 这些 story 是为谁写的
 *
 * **不是给人看样式**（样式归 `docs/superpowers/specs/openhive-DESIGN.md`），而是让
 * `@storybook/addon-a11y`（axe 4.11.4 就在 bun store 里）**照得到这个组件**。
 * `packages/storybook/.storybook/main.ts` 已经 glob 了 `packages/app/src/**\/*.stories.tsx`，
 * 所以「组件没有 story」＝「工具照不到」＝「这一层没有 a11y 审计」。补 story 就是补这个缺口。
 *
 * ## 每个 story 对应一个**真实状态**，不是装饰
 *
 * 本组件三个按钮的「禁用 vs 可点」由「有没有传回调」决定（未接线即禁用），
 * 而 axe 眼里 `disabled` 与可点按钮是**两种东西**（可点按钮必须有可访问名称、
 * 必须能进 Tab 顺序）。只写「全部接线」那一个 story，就等于放弃了另一半的审计面。
 */
export default {
  title: "App/OpenHive/ProjectAnchor",
  id: "app-openhive-project-anchor",
  component: ProjectAnchor,
}

/** 尚未选中项目：走空态文案，三个按钮仍画出来（此时未接线 ⇒ 全禁用）。 */
export const Empty = {
  render: () => <ProjectAnchor />,
}

/** 私有项目：**没有**成员徽章——徽章只属于共享项目（设计 §4，不给假数）。 */
export const Private = {
  render: () => <ProjectAnchor name="8·17 专案" onToggleList={() => {}} onCreate={() => {}} />,
}

/** 共享项目：带 `👥 N` 徽章，三个按钮全部接线（全部可点、都进 Tab 顺序）。 */
export const Shared = {
  render: () => (
    <ProjectAnchor
      name="8·17 专案"
      memberCount={4}
      onToggleList={() => {}}
      onCreate={() => {}}
      onOpenMembers={() => {}}
    />
  ),
}

/**
 * 生产现状（T006/T010 尚未接）：只给名字与徽章、**不给任何回调** ⇒ 三个按钮全 `disabled`。
 *
 * 「看起来能点」比「少个按钮」更难查，所以这一档必须单独进审计面——它是今天真实的画面。
 */
export const NotWired = {
  render: () => <ProjectAnchor name="8·17 专案" memberCount={4} />,
}
