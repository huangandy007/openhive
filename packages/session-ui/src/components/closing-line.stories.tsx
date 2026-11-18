// @ts-nocheck
import { create } from "@opencode-ai/ui/storybook/scaffold"
import * as mod from "./closing-line"

/**
 * 三态验收（015 T008）：
 * ① 0 次信封调用 ⇒ 组件不渲染任何内容（画布为空白）；
 * ② 2 次信封调用带 2 条缺口 ⇒ 一行统计 + 缺口段；
 * ③ 信封缺口含服务端上限文案 ⇒ 多出「已达 12 次上限」提示（服务端注入驱动，不按次数数）。
 *
 * `parts` 形状照抄同包 `closing-stats.test.ts` 的夹具（tool + state.output）。
 * storybook 没有全局 `I18nProvider`，`useI18n` 走英文 fallback，故画布文案为英文。
 */

const 信封文本 = (值: unknown) => JSON.stringify(值)

const 工具部件 = (tool: string, output: unknown) => ({
  tool,
  state: { status: "completed", output },
})

const 信封 = (缺口: string[], 代表们: string[]) => ({
  摘要: "示例查询结果",
  数据: [],
  口径: "示例口径",
  缺口,
  空原因: null,
  出处: 代表们.map((代表) => ({ 事实: "示例事实", 代表, 可下钻: "get_citation" })),
  下一步: [],
})

/** ② 2 次信封调用、2 条缺口：每个工具卡各贡献一条缺口。 */
const 两缺口部件 = [
  工具部件(
    "openhive-case_query_entities",
    信封文本(
      信封(["张三名下还有 1 个账户未展开"], ["m-甲#账户表#1", "m-甲#账户表#2"]),
    ),
  ),
  工具部件(
    "openhive-case_aggregate_money",
    信封文本(信封(["m-乙 缺少对手方"], ["m-乙#流水表#7"])),
  ),
]

/** ③ 服务端第 12 次起把上限文案追加进信封 `缺口` ⇒ `收尾行文本` 追加 budget 段。 */
const 上限部件 = [
  工具部件(
    "openhive-case_query_events",
    信封文本(信封(["近 10 分钟内查询已达 12 次，必须收尾并列出未覆盖项"], ["m-1#事件表#1"])),
  ),
]

const docs = `### 收尾行 · ClosingLine

会话最后一条消息尾部的统计行，只调 \`closing-stats.ts\` 的 \`统计收尾\` + \`收尾行文本\`，
组件内不重复统计逻辑（不 \`JSON.parse\`、不过滤 part）。

### 三态
1. **ZeroQueries**：0 次信封调用 ⇒ 不渲染任何节点（画布空白）。
2. **TwoGaps**：2 次信封调用、2 条缺口 ⇒ summary + gaps 两段。
3. **BudgetGap**：信封缺口含服务端上限文案 ⇒ summary + gaps + budget 上限提示。

> storybook 无全局 \`I18nProvider\`，画布文案是英文 fallback。
`

const story = create({
  title: "Session/Closing Line",
  mod,
  args: { parts: [] },
})

export default {
  title: "Session/Closing Line",
  id: "session-closing-line",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
}

export const ZeroQueries = {
  ...story.Basic,
  args: { parts: [] },
}

export const TwoGaps = {
  ...story.Basic,
  args: { parts: 两缺口部件 },
}

export const BudgetGap = {
  ...story.Basic,
  args: { parts: 上限部件 },
}
