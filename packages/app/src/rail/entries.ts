import type { IconProps } from "@opencode-ai/ui/icon"

/** 图标栏入口（FR-002）。 */
export interface RailEntry {
  /**
   * 稳定标识，同时是模块 key——FR-005 按模块着色、T010 切模块都以它为键。
   * 故意与 `label` 分开：显示文案会改，改文案不该改掉 tab 的身份。
   */
  id: string
  /** 入口名，用于提示与无障碍标签。 */
  label: string
  /** 图标名，取值受 `IconProps["name"]` 约束（编不出不存在的图标）。 */
  icon: IconProps["name"]
  /**
   * 显示该入口所需的能力位；省略 = 不受门禁。
   *
   * 只决定「显不显示」——真正的鉴权在下游执行层（宪法 IV：前端隐藏不替代校验）。
   * 001 里它与 `id` 同值（门禁即「能否进入该模块」）；002–010 可另行收窄。
   */
  capability?: string
}

/**
 * 「AI 会话」那颗入口的 id。
 *
 * ⚠️ **它的出口不是切模块**——是**开关右栏**（`rail/rail.tsx` 的 `onToggleAiSession`）。
 * 这一条不是本文件的私见，是设计文档写死的：
 * `docs/superpowers/specs/2026-09-11-项目管理-design.md:25`「**AI 会话** ｜ 呼出/收起右栏 ｜ 💬」、
 * `archive/2026-08-17-openhive-design-v1.md:229`「点图标呼出/收起对应侧栏；**高亮 = 当前展开**」。
 *
 * 常量单独导出（而不是在 `RAIL_ENTRIES` 与 `rail.tsx` 里各写一遍字面量）：两处各写一份就是
 * 同一个事实的两个出处，改一处另一处静默分家（`LEARNINGS #002-06`）。
 */
export const AI_SESSION_ENTRY_ID = "ai-session"

/** 顶部五个业务入口（FR-002），顺序即显示顺序。 */
export const RAIL_ENTRIES: readonly RailEntry[] = [
  { id: "project", label: "项目管理", icon: "folder", capability: "project" },
  { id: "ai-assets", label: "AI 资产", icon: "archive", capability: "ai-assets" },
  // ⚠️ 这一颗**不是业务模块**（它没有中栏页面、没有左栏内容），是右栏的开关——见上面那个常量。
  { id: AI_SESSION_ENTRY_ID, label: "AI 会话", icon: "speech-bubble", capability: "ai-session" },
  { id: "cdr-analysis", label: "话单分析", icon: "bullet-list", capability: "cdr-analysis" },
  { id: "fund-analysis", label: "资金分析", icon: "branch", capability: "fund-analysis" },
]

/** 底部「系统设置」（FR-002）。不设能力位——它不是业务模块，恒常可见。 */
export const SETTINGS_ENTRY: RailEntry = { id: "settings", label: "系统设置", icon: "settings-gear" }

/**
 * 按会话能力位过滤出可见入口（FR-002）。
 *
 * `capabilities` 省略 = 尚未接入 capability 签发方（001 的常态），此时不过滤、原样返回。
 * 传入（哪怕是空集）= 已由签发方定夺，只留有能力的那些；无能力位的入口（如系统设置）恒留。
 */
export function visibleEntries(
  entries: readonly RailEntry[],
  capabilities?: ReadonlySet<string>,
): RailEntry[] {
  if (!capabilities) return [...entries]
  return entries.filter((entry) => !entry.capability || capabilities.has(entry.capability))
}
