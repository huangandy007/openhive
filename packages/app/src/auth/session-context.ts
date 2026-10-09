/**
 * 登录门交给下游的**会话**（2026-10-09 用户下达「下拉三项全部真实实现」时建立）。
 *
 * ## 为什么要有它
 *
 * `workspace/current-user.ts` 那条缝只带**身份**（姓名 / 警号 / 是否管理员）——顶栏画名字够用，
 * 但「退出登录」需要一个**动作**，而模块级信号接缝装不下动作。故这里再开一条 context：
 * 身份 ＋ `signOut`，由 `AuthGate`（唯一知道会话状态的那一层）提供。
 *
 * ## 为什么不是第二条模块级信号
 *
 * 与 `current-user.ts` 刻意不同：那条缝是 001 留下的**跨层接线缝**（`workspace-entry.tsx`
 * 也在读它的 `policeId`），而本文件服务的是**登录门下面的一棵子树**，正是 context 的形状。
 * 更重要的是**收得回来**：门一卸载，provider 一并没了；模块级信号不会。
 *
 * ## `identity` 为什么可以是 `undefined`
 *
 * `AuthGate` 的第三种启动结局是 `unavailable`（网关不在——`bun run dev` 的常态）：那时界面照常
 * 放行，但**没有任何身份**。把它说成「已登录」就把假身份放进了 DOM（`current-user.ts` 的老话
 * 「宁缺勿假」）。故这里如实留空，顶栏据此不渲染用户区。
 */

import { createContext, useContext } from "solid-js"
import type { Identity } from "./gateway"

export interface AuthSession {
  /** 当前身份；`undefined` = 网关不在（本机开发常态），不是「还没探到」。 */
  identity?: Identity
  /**
   * 退出登录。**成功与否由实现方说清**：失败时**不改变**界面状态（`AuthGate` 那边只弹一句
   * 提示），所以调用方不必自己再判一次——喊完即可，界面自己会走到对的地方。
   */
  signOut: () => Promise<void>
}

/** 无默认值：**门之外读它得到 `undefined`**，而不是一个看起来像真的假会话。 */
const Context = createContext<AuthSession>()

export const AuthSessionProvider = Context.Provider

export function useAuthSession(): AuthSession | undefined {
  return useContext(Context)
}
