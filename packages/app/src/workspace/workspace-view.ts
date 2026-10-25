/**
 * 哪些模块拥有**自己的工作台视图**（009 T005 / D0-3）。
 *
 * 今天两个：
 * - `project`：左栏项目侧栏；中栏仍是文件 tab / 路由页（既有行为）。
 * - `ai-assets`：左栏纯导航；中栏是**模块级视图**（文件 tab 保留在状态里，但不可见）。
 *
 * 业务模块（话单 / 资金分析等）没有自己的左栏内容，`undefined` 让左栏整列让位——这与
 * 「切到别的模块左栏消失」的既有行为一致。
 *
 * ⚠️ 判据只有这一处。`left` 的内容分支与 `leftCollapsed` 的开关轴都从这里取；两处各写一份
 * `module === "..."` 就是同一个判断的第二套读法（`LEARNINGS #002-06`）。
 */
export const AI_ASSETS_MODULE = "ai-assets"

export type WorkspaceView = "project" | typeof AI_ASSETS_MODULE

export function workspaceView(module: string | undefined): WorkspaceView | undefined {
  if (module === "project") return "project"
  if (module === AI_ASSETS_MODULE) return "ai-assets"
  return undefined
}

export function isWorkspaceModule(module: string | undefined): boolean {
  return workspaceView(module) !== undefined
}
