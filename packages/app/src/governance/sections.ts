/**
 * 治理后台的八项导航（010 T001 / FR-002）。
 *
 * 与 `rail/entries.ts` 同范式：一张注册表 + 一个纯过滤函数。
 * - `group` 只决定展示分组，**不参与权限判定**；
 * - `capability` 只决定「显不显示」，真正的鉴权在服务端（宪法 IV / FR-013）；
 * - `kind` 声明本页属于「配置 / 审核 / 查看」中的哪一类——**闭集不含分析**（FR-012）；
 * - `capabilities` 省略 = capability 签发方还没接（T003 之前与 rail 001 的常态同口径），
 *   此时不过滤、原样全显；传空集 = 已定夺，一项不留。
 */

import type { IconProps } from "@opencode-ai/ui/icon"

/**
 * 治理后台只承载这三类事（FR-012 / SC-004）。
 *
 * **闭集里刻意没有「分析」**：民警的日常分析在三栏工作台，不在这里。往导航表里
 * 加一页分析，就得先改这个常量（类型 `治理页类别` 从它派生）——`sections.test.ts`
 * 会当场红，而不是等有人在后台里看见一个聊天框。
 */
export const GOVERNANCE_KINDS = ["config", "review", "view"] as const

export type 治理页类别 = (typeof GOVERNANCE_KINDS)[number]

export interface GovernanceSection {
  /** 稳定标识；同时是页面根 `data-section` 与选中态键。 */
  id: string
  label: string
  icon: IconProps["name"]
  /** 本页属于「配置 / 审核 / 查看」中的哪一类（FR-012）。 */
  kind: 治理页类别
  /** 显示该页所需的能力位；省略 = 恒显。 */
  capability?: string
  /** 导航分组标题；顺序由本数组的首次出现决定。 */
  group: string
}

export const GOVERNANCE_SECTIONS: readonly GovernanceSection[] = [
  {
    id: "account-manage",
    label: "账号管理",
    icon: "status",
    kind: "config",
    capability: "account-manage",
    group: "账号与组织",
  },
  { id: "org-tree", label: "组织架构", icon: "branch", kind: "config", capability: "org-tree", group: "账号与组织" },
  {
    id: "asset-governance",
    label: "AI 资产治理",
    icon: "archive",
    kind: "review",
    capability: "asset-governance",
    group: "内容与授权",
  },
  { id: "template-lib", label: "模板库", icon: "edit", kind: "config", capability: "template-lib", group: "内容与授权" },
  {
    id: "data-project-perm",
    label: "数据项目权限",
    icon: "folder",
    kind: "config",
    capability: "data-project-perm",
    group: "内容与授权",
  },
  {
    id: "usage-cost",
    label: "用量成本",
    icon: "status-active",
    kind: "view",
    capability: "usage-cost",
    group: "运维与合规",
  },
  { id: "audit-log", label: "审计日志", icon: "review", kind: "view", capability: "audit-log", group: "运维与合规" },
  { id: "data-source", label: "数据源配置", icon: "server", kind: "config", capability: "data-source", group: "运维与合规" },
]

/**
 * 按能力位过滤可见项（顺序不变）。
 *
 * `capabilities` 省略 = 不过滤；传入（哪怕空集）= 只留授予的项。
 * 与 `visibleEntries` 逐字同义——两处各写一套判断迟早会分家（`#002-06`）。
 */
export function filterGovernanceSections(
  sections: readonly GovernanceSection[],
  capabilities?: ReadonlySet<string>,
): GovernanceSection[] {
  if (!capabilities) return [...sections]
  return sections.filter((section) => !section.capability || capabilities.has(section.capability))
}
