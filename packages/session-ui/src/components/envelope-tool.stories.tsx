// @ts-nocheck
import * as mod from "./envelope-tool"
import { create } from "@opencode-ai/ui/storybook/scaffold"

const 信封 = (值: unknown) => JSON.stringify(值, null, 2)

const docs = `### 事实卡片 · MCP 信封工具卡

七字段信封（摘要 / 数据 / 口径 / 缺口 / 空原因 / 出处 / 下一步）的会话内渲染件。
摘要进触发器标题；缺口与空原因用警示块；原始 JSON 折叠。

### 无障碍
- 触发器复用 \`BasicTool\`（Collapsible 语义）。
- 警示块用 \`bg-surface-warning-weak\` / \`border-border-warning-base\`，light / dark 均须过对比度。
`

const story = create({
  title: "Session/Envelope Tool",
  mod,
  args: {
    tool: "openhive-case_query_rows",
    status: "completed",
    defaultOpen: true,
    input: { 材料: "银行流水-甲.xlsx", 账户: "6222021234567890123" },
    output: 信封({
      摘要: "取到 24 行明细（材料 银行流水-甲.xlsx）",
      数据: Array.from({ length: 24 }, (_, i) => ({
        定位: `m-甲#表#${i + 1}`,
        金额: `${(i + 1) * 100}.00`,
        方向: i % 2 ? "收" : "付",
      })),
      口径: "按时间升序；金额为交易金额（元）",
      缺口: ["本页按 30 KB 上限只取前 24 行（原请求 50 行），其余可用「下一页游标」继续取"],
      空原因: null,
      出处: [{ 事实: "2026-03-01 收到 100.00 元", 代表: "m-甲#表#1", 可下钻: "get_citation" }],
      下一步: [{ 工具: "query_rows", 参数: { 游标: "eyJ0IjoxNzcy" }, 为什么: "还有下一页明细" }],
    }),
  },
})

export default {
  title: "Session/Envelope Tool",
  id: "session-envelope-tool",
  component: story.meta.component,
  tags: ["autodocs"],
  parameters: { docs: { description: { component: docs } } },
}

export const Normal = story.Basic

export const Empty = {
  ...story.Basic,
  args: {
    ...story.Basic.args,
    output: 信封({
      摘要: "没取到明细：本项目没有任何已入库明细",
      数据: [],
      口径: "按时间升序",
      缺口: [],
      空原因: "项目暂无明细",
      出处: [],
      下一步: [{ 工具: "search_materials", 参数: {}, 为什么: "确认材料名与解析状态；未解析的材料要先解析入库" }],
    }),
  },
}

// 错误态不走 EnvelopeTool（`status:"error"` 的 part 由 message-part 的 Match 接走），
// 所以这条 story 直接渲染 `信封错误卡`，喂的就是 `state.error` 里的那段文本。
const ErrorCard = mod.信封错误卡

export const ToolError = {
  args: { tool: "openhive-case_query_rows", status: "error", defaultOpen: true },
  render: () => (
    <ErrorCard
      tool="openhive-case_query_rows"
      status="error"
      defaultOpen
      文本={信封({ error: "bad_input", message: "缺少必填参数：材料" })}
    />
  ),
}

export const ManyGaps = {
  ...story.Basic,
  args: {
    ...story.Basic.args,
    output: 信封({
      摘要: "取到 2 个实体",
      数据: [
        { 名称: "王五", 类型: "人" },
        { 名称: "甲公司", 类型: "公司" },
      ],
      口径: "按名称精确匹配；未核实身份",
      缺口: ["同名 2 人，未做合并", "推断的关系未升为事实", "材料 B 未解析，未纳入查询"],
      空原因: null,
      出处: [{ 事实: "王五（人）", 代表: "e-1", 可下钻: null }],
      下一步: [],
    }),
  },
}
