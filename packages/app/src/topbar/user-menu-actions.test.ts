/**
 * 用户下拉项 id → 动作 的映射（2026-10-09 用户下达：「用户区的下拉三个功能全部真实实现」）。
 *
 * 这个文件存在的理由是**「哪几项接线了」需要一个可数的落点**：`menu.ts` 里的
 * `USER_MENU_ITEMS` 有四条（第四条第 `adminOnly`），而用户要的是**三项**。把这层映射
 * 摆在一个纯函数里，「第四项没接」就有一条会红的对照，而不是埋在某个组件的 `switch` 里
 * 谁也说不清（`LEARNINGS #004-01`：数覆盖了几个出口，要数**底层动作被调用的地方**）。
 */

import { describe, expect, test } from "bun:test"
import { USER_MENU_ITEMS } from "./menu"
import { 用户菜单动作 } from "./user-menu-actions"

describe("用户下拉项 → 动作", () => {
  test("个人信息 ⇒ 打开个人信息", () => {
    expect(用户菜单动作("profile")).toBe("打开个人信息")
  })

  test("修改密码 ⇒ 打开修改密码", () => {
    expect(用户菜单动作("password")).toBe("打开修改密码")
  })

  test("退出登录 ⇒ 退出登录", () => {
    expect(用户菜单动作("logout")).toBe("退出登录")
  })

  /**
   * 对照：**用户管理本轮不接线**（用户只点了三项名）。它必须落到 `undefined`——
   * 而不是「顺手也打开个什么」。红的时候一眼看得出是这里，而不是「弹窗没弹出来」。
   */
  test("对照：用户管理不接线 ⇒ undefined（不是「随便打开一个」）", () => {
    expect(用户菜单动作("admin")).toBeUndefined()
  })

  test("对照：清单外的 id ⇒ undefined（不猜「大概是说第一项」）", () => {
    expect(用户菜单动作("nope")).toBeUndefined()
  })

  /**
   * 与 `USER_MENU_ITEMS` 的**键集**对上：清单里出现了新 id 而忘了想「它接不接线」时，
   * 这条会红。它比对的是清单本身，故上游加项 / 改名都会走到这里（`#004-02`：两个投影
   * 并存时写一条**故意的报警**断言，而不是靠注释约定同步）。
   */
  test("报警：清单里的每个 id 都想过一遍（未接线的那几个明写在下面）", () => {
    const 未接线 = ["admin"]
    const 想过 = USER_MENU_ITEMS.map((item) => item.id).filter((id) => 用户菜单动作(id) !== undefined)

    expect(想过).toEqual(USER_MENU_ITEMS.map((item) => item.id).filter((id) => !未接线.includes(id)))
  })
})
