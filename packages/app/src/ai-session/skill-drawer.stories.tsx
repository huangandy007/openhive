// @ts-nocheck
import { SkillDrawer } from "./skill-drawer"
import type { SkillGroup } from "./projection"

/**
 * 「更多 skill」抽屉（006 T006）——右栏内的浮层，按 skill 分组。
 *
 * 补 story 的理由与 `instruction-cards.stories.tsx` 逐字相同（让 `@storybook/addon-a11y`
 * 照得到 ⇒ 这一层才有 a11y 审计）。本组件另有一处**必须进审计面**的东西：关闭钮是一颗
 * `IconButtonV2`，它的可访问名称**只由 `aria-label` 提供**（图标本身无可读文字）
 * ——axe 的「按钮必须有可访问名称」正是在这里查。
 */

function 组(group: string, skills: [string, string][]): SkillGroup {
  return {
    group,
    skills: skills.map(([name, description]) => ({
      skill: name,
      name,
      description,
      group,
      cards: [],
    })),
  }
}

export default {
  title: "App/OpenHive/AiSession/SkillDrawer",
  id: "app-openhive-ai-session-skill-drawer",
}

/** 打开态：两组 skill，各两条。这是民警点开抽屉时看到的常态。 */
export const Open = {
  render: () => (
    <SkillDrawer
      open
      groups={[
        组("资金分析", [
          ["资金关联分析", "按账户与流水做关联"],
          ["资金链追踪", "追踪资金的来源与去向"],
        ]),
        组("话单分析", [
          ["通话频次统计", "统计号码之间的通话频次"],
          ["共同联系人", "找出两个号码的共同联系人"],
        ]),
      ]}
      onClose={() => {}}
    />
  ),
}

/**
 * 长列表（条目多于可视高 ⇒ 触发 `overflow-y-auto`）。滚动的容器对 axe 而言仍要满足可读性；
 * 只画「两条」那一态就等于没照到滚动区。条目是**两行文字、没有图标**（§4.7.3）。
 */
export const LongList = {
  render: () => (
    <SkillDrawer
      open
      groups={[
        组(
          "资金分析",
          Array.from({ length: 8 }, (_, i) => [`资金分析能力 ${i + 1}`, "一行说明，用于验证明细行"] as [string, string]),
        ),
      ]}
      onClose={() => {}}
    />
  ),
}

/** 关闭态：`open={false}` ⇒ 整段不渲染。与打开态各占一格，别把「没渲染」误当成「漏测」。 */
export const Closed = {
  render: () => <SkillDrawer open={false} groups={[]} onClose={() => {}} />,
}
