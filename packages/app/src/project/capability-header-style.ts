/**
 * 能力面板组头与「入库设置」标题共用的一档样式（2026-11-20 用户要求：
 * 入库设置的高度 / 字号 / 图标要和 MCP、技能、知识库保持一致）。
 *
 * 这是**一份**出处（`#002-06`）：两处都从这里取，改高度或字号不会只改一边。
 * 结构约定见 `capability-panel.tsx` 的 `组头`：`◆` ＋ 标题（`font-semibold`）
 * ＋ 右侧 `›`（收起）/ `⌄`（展开）。
 */
export const 组头样式 =
  "flex h-7 w-full shrink-0 cursor-pointer items-center gap-1.5 px-2 text-[13px] text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"

/** 贴底的组头（知识库 / MCP 那条）：组头样式 ＋ 上边框。 */
export const 贴底组头样式 = `border-t border-v2-border-border-muted ${组头样式}`
