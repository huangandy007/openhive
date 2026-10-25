import { describe, expect, test } from "bun:test"
import { isWorkspaceModule, workspaceView } from "./workspace-view"

/**
 * 「哪些模块有自己的工作台视图」（009 T005 / D0-3）。
 *
 * 这个判据有**两个读者**：`LeftPane` 的内容分支与 `leftCollapsed` 的开关轴。两处各写一份
 * `module === "..."` 就是同一个判断的第二套读法（`LEARNINGS #002-06`）。
 */
describe("工作台视图模块", () => {
  test("项目管理是工作台视图", () => {
    expect(workspaceView("project")).toBe("project")
    expect(isWorkspaceModule("project")).toBe(true)
  })

  test("AI 资产是工作台视图（模块级页面，不是路由页）", () => {
    expect(workspaceView("ai-assets")).toBe("ai-assets")
    expect(isWorkspaceModule("ai-assets")).toBe(true)
  })

  test("业务模块与未知模块没有自己的左栏工作台视图", () => {
    for (const 模块 of ["fund-analysis", "cdr-analysis", "ai-session", "settings", "", undefined]) {
      expect(workspaceView(模块)).toBeUndefined()
      expect(isWorkspaceModule(模块)).toBe(false)
    }
  })
})
