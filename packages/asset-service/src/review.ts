import type { GrantRow } from "@opencode-ai/auth/rbac"
import { effectivePermissions, type AssetPerm, type AssetViewer } from "./authorization"
import {
  AssetTransitionError,
  transitionFor,
  type ActorRole,
  type SkillAction,
} from "./lifecycle"
import type { AssetMetadata } from "./metadata"

/**
 * 审核两道关（009 T009，FR-005 / design §3.3）。
 *
 * 业务管理员审「内容与可泛化性」，系统管理员审「技术合规与能跑」，两道关**互不蕴含**。
 * 状态机（`lifecycle.ts`）已经写死了每个动作允许的角色，本文件只回答一个问题：
 *
 * > 这个人在这份资产上，凭他**实际持有的权限**，能不能算这个角色？
 *
 * ## 为什么角色必须由权限派生，不能让调用方自报
 *
 * T008 的 `transitionAsset` 收的是 `actor: ActorRole`——调用方说自己是 `system_admin`
 * 就能发布。HTTP / MCP 出口一旦接上，那就是「谁都能自称管理员」。本文件把入口换成
 * `AssetViewer` + 授权行（`grantsFor()`），角色从 `effectivePermissions()` 推出来：
 * 调用方只能提供「我是谁」，不能提供「我是什么角色」。
 *
 * ## 映射是最小化的一组
 *
 * - `author` → `write`：提交 / 发起迭代 / 重新上线要能改内容。作者身份由
 *   `effectivePermissions()` 直接给 `write`；显式 `write` 授权同样算（写权语义一致）。
 * - `business_reviewer` → `review`；`system_admin` → `admin`。
 *
 * 这里**不**给 `admin` 补 `write` / `review`，也不给 `review` 补 `write`：任何一步隐含
 * 都会让「业务关 / 技术关分离」当场失效。需要一人多权时，就显式授多条（审计上也能看见）。
 *
 * ## 已知残差
 *
 * 同一个人若被**显式**同时授予 `review` 与 `admin`，仍可以连续过两道关。FR-005 的口径是
 * 「权限互不蕴含」，不是「审核人必须不同人」：后者要记录每次流转的审核人（`asset_log`），
 * 属 010 审计日志的范围。当前元数据表没有审核人字段，无法在不造数据的前提下强判。
 */

/** 角色 → 该角色动作所需的最小权限。闭集与 `lifecycle.ts` 的 `ACTOR_ROLES` 对齐。 */
export const TRANSITION_REQUIRED_PERMS: Record<ActorRole, AssetPerm> = {
  author: "write",
  business_reviewer: "review",
  system_admin: "admin",
}

/**
 * 判定 `viewer` 能否以某个允许角色执行 `action`，返回命中的角色。
 *
 * 按转移表里 `actors` 的顺序找第一个权限满足的角色（例如 `bring_online` 作者优先），
 * 都不满足 ⇒ 抛 `actor_not_allowed`，消息里写明缺的权限——审核人在后台排查时
 * 「该给他授什么」是第一个问题。
 *
 * 未知动作在这里就抛 `unknown_action`（与 `applySkillTransition()` 同一个错误码）：
 * 不允许「先查授权、再发现动作不存在」这种把错误码搅在一起的顺序。
 */
export function authorizeTransition(
  viewer: AssetViewer,
  asset: AssetMetadata,
  grants: readonly GrantRow[],
  action: SkillAction,
): ActorRole {
  const transition = transitionFor(action)
  if (!transition) {
    throw new AssetTransitionError("unknown_action", `未知生命周期动作：${action}`)
  }

  const perms = effectivePermissions(viewer, asset, grants)
  const actor = transition.actors.find((role) => perms.has(TRANSITION_REQUIRED_PERMS[role]))
  if (actor !== undefined) return actor

  const required = transition.actors.map((role) => `${role}（需 ${TRANSITION_REQUIRED_PERMS[role]}）`)
  throw new AssetTransitionError(
    "actor_not_allowed",
    `${viewer.userId} 不能执行 ${action}：需要 ${required.join(" 或 ")}`,
  )
}
