export interface UserMenuItem {
  id: string
  label: string
  /** 仅管理员可见。⚠️ 这是**界面收敛**，不是鉴权——真正的授权在执行层（宪法 IV）。 */
  adminOnly?: boolean
  /** 危险动作（退出登录），视觉上要区分。 */
  danger?: boolean
}

/** 用户下拉项清单，顺序即显示顺序（FR-003）。 */
export const USER_MENU_ITEMS: readonly UserMenuItem[] = [
  { id: "profile", label: "个人信息" },
  { id: "password", label: "修改密码" },
  { id: "admin", label: "用户管理", adminOnly: true },
  { id: "logout", label: "退出登录", danger: true },
]

/**
 * 按管理员身份过滤下拉项。
 *
 * ⚠️ 只影响「显示哪些」，**不是权限校验**：前端隐藏不阻止调用，管理接口的授权
 * 必须落在执行层（宪法 IV）。
 */
export function visibleUserMenuItems(entries: readonly UserMenuItem[], isAdmin: boolean | undefined) {
  return entries.filter((item) => !item.adminOnly || isAdmin === true)
}
