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

/** 顶部五个业务入口（FR-002），顺序即显示顺序。 */
export const RAIL_ENTRIES: readonly RailEntry[] = [
  { id: "project", label: "项目管理", icon: "folder", capability: "project" },
  { id: "ai-assets", label: "AI 资产", icon: "archive", capability: "ai-assets" },
  { id: "ai-session", label: "AI 会话", icon: "speech-bubble", capability: "ai-session" },
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
