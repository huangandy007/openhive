import { describe, expect, test } from "bun:test"
import { USER_MENU_ITEMS, visibleUserMenuItems } from "./menu"

describe("用户下拉项（FR-003）", () => {
  // 注：本条不是 RED 驱动的——它是「数据 ↔ 需求」的守卫断言。下拉项文案只改一处
  // 就会静默偏离 FR-003，故把需求原文钉在测试里。
  test("下拉项恰为 FR-003 所列，顺序即显示顺序", () => {
    expect(USER_MENU_ITEMS.map((item) => item.label)).toEqual([
      "个人信息",
      "修改密码",
      "用户管理",
      "退出登录",
    ])
  })
})

describe("用户下拉项的可见性（FR-003）", () => {
  test("非管理员：不显示「用户管理」", () => {
    const visible = visibleUserMenuItems(USER_MENU_ITEMS, false)

    expect(visible.map((item) => item.id)).toEqual(["profile", "password", "logout"])
  })

  test("管理员：显示「用户管理」，位置不变（在「退出登录」之上）", () => {
    const visible = visibleUserMenuItems(USER_MENU_ITEMS, true)

    expect(visible.map((item) => item.id)).toEqual(["profile", "password", "admin", "logout"])
  })

  test("未声明 isAdmin 时按非管理员处理：默认不显示管理项", () => {
    const visible = visibleUserMenuItems(USER_MENU_ITEMS, undefined)

    expect(visible.some((item) => item.id === "admin")).toBe(false)
  })
})
