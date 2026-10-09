/**
 * 用户下拉项 id → 要做什么（2026-10-09 用户下达：「用户区的下拉三个功能全部真实实现」）。
 *
 * ## 为什么单独一层，而不是在组件里 `switch`
 *
 * `menu.ts` 的清单有**四条**（第四条 `adminOnly: true`），用户要的是**三项**。这层映射
 * 把「哪几项接线了」变成一个可数的东西：`user-menu-actions.test.ts` 拿它跟清单的键集对一遍，
 * 「清单加了项却没人想它接不接线」会红，而埋在 `switch` 里就没人说得清（`LEARNINGS #004-01`）。
 *
 * ## 动作是**语义**，不是实现
 *
 * 返回的是「打开个人信息」这类**意图**，不是组件或回调——于是「点这一项该发生什么」在
 * 本文件一处可读，而「怎么打开」在 `topbar-connected.tsx` 一处可换。
 *
 * ⚠️ `admin`（用户管理）**本轮不接线**，如实落在 `undefined` 那一支——不是「顺手也打开个
 * 什么」。`visibleUserMenuItems` 仍会在管理员那里把它画出来（那是界面收敛，宪法 IV），
 * 点它只是关掉菜单。这是**已知缺口**，收尾报告里单独挂账。
 */
export type 用户菜单动作 = "打开个人信息" | "打开修改密码" | "退出登录"

export function 用户菜单动作(id: string): 用户菜单动作 | undefined {
  switch (id) {
    case "profile":
      return "打开个人信息"
    case "password":
      return "打开修改密码"
    case "logout":
      return "退出登录"
    default:
      // 含 "admin"（用户管理，本轮不接线）与一切不认识的 id——两种都不猜。
      return undefined
  }
}
