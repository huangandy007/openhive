/**
 * 顶栏接线（2026-10-09 用户下达：「用户区下拉三个功能全部真实实现」）。
 *
 * ## 为什么单独一层（与 `topbar-mount.tsx` 同一套理由）
 *
 * 能读 context 的那一层算，`Topbar`／`TopbarMount` 只认值。顶栏自己（品牌、主页、站内信、全屏）
 * 与身份、会话都无关，裸挂得起；而「点菜单项该干什么」要 `useAuthSession()`（喊 `signOut`）
 * 与 `useDialog()`（开弹窗）两样 context，**这两样只有入口层那棵树上才有**。于是照
 * `topbar-mount.tsx` 立下的老规矩再分一层：宿主与按下态照旧从 props 进，身份与动作在这里从
 * context 取。
 *
 * ## 身份为什么也走 context（而不是继续 `currentUser()`）
 *
 * `AuthGate` 是 `currentUser()` 的**唯一**生产写入者（2026-10-09 实测全仓 grep：写方只有
 * `auth-gate.tsx`，读方只有本项与 `workspace-entry.tsx`），而它同一刻也在发这条 context ⇒
 * 两者对顶栏而言**同源**。用 context 是因为「个人信息」弹窗要的那份 `Identity`（含 id 与
 * `mustChangePw`）比 `TopbarUser` 更全，而同一件事从两处取数正是 `LEARNINGS #002-06` 那类
 * 缺陷的产地。**代价要写清**：context 取不到时（用户区那棵树没挂进去）界面会**静默少一块**，
 * 故 `#006-14` 那条纪律适用——「横切机制在新出口上生效」是推断，「真栈上它生效」是事实，
 * 收尾必须去真栈点一遍（见 `state.md` 的验收记录）。
 *
 * ## 「用户管理」为什么不在这里
 *
 * 它是管理员可见的第四项，但**本轮刻意不接线**：内核网关只有 `/login`、`/me`、
 * `/change-password`、`/logout` 四条（`packages/opencode/src/server/openhive/gateway.ts`），
 * 没有任何管理端点，接了也是个点不动的空壳。判据落在 `user-menu-actions.ts`（映射函数对
 * `"admin"` 返回 `undefined`，且那条清单有「只有它未接线」的报警断言）。
 */

import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { JSX } from "solid-js"
import type { AuthFetch } from "@/auth/gateway"
import { useAuthSession } from "@/auth/session-context"
import { ChangePasswordDialog } from "./change-password-dialog"
import { ProfileDialog } from "./profile-dialog"
import type { TopbarUser } from "./topbar"
import { TopbarMount } from "./topbar-mount"
import { 用户菜单动作 } from "./user-menu-actions"

export interface TopbarConnectedProps {
  /** 宿主元素；为空 = 无处可挂（透传给 `TopbarMount`，判据仍在那边）。 */
  host?: HTMLElement | null
  homeActive?: boolean
  onOpenHome?: () => void
  /** 测试注入用；省略 = 真 `fetch`。只影响改密弹窗。 */
  send?: AuthFetch
}

export function TopbarConnected(props: TopbarConnectedProps): JSX.Element {
  const session = useAuthSession()
  const dialog = useDialog()

  /** 身份 → 顶栏要的形状。**没有身份就不画用户区**（`current-user.ts` 的老话：宁缺勿假）。 */
  const 用户 = (): TopbarUser | undefined => {
    const identity = session?.identity
    if (!identity) return undefined
    return { name: identity.name, policeId: identity.policeNo, isAdmin: identity.isAdmin }
  }

  const 处理 = (id: string) => {
    switch (用户菜单动作(id)) {
      case "打开个人信息": {
        const identity = session?.identity
        if (!identity) return
        void dialog.show(() => <ProfileDialog identity={identity} />)
        return
      }
      case "打开修改密码":
        void dialog.show(() => <ChangePasswordDialog send={props.send} />)
        return
      case "退出登录":
        // **不弹确认框**（用户 2026-10-09 的裁定：点一下直接退）。界面怎么变由 `AuthGate` 负责。
        void session?.signOut()
        return
      // 其余一律**什么都不做**：`用户菜单动作` 对「用户管理」与一切不认识的 id 都回 `undefined`，
      // 而 `switch(undefined)` 不匹配任何一条 ⇒ 落到函数末尾。不写 `default: return` 是因为那行
      // 与「什么都不写」逐字同义。
    }
  }

  return (
    <TopbarMount
      host={props.host}
      user={用户()}
      homeActive={props.homeActive}
      onOpenHome={props.onOpenHome}
      onSelect={处理}
    />
  )
}
