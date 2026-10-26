/**
 * Skill 生命周期状态机（FR-004 / D0-7）。
 *
 * 纯定义 + 纯函数：不写库、不搬文件。T008/T009/T016 复用这里的转移表，
 * 避免把「哪个状态能做什么」散落成各处 if。
 */

import type { AssetStatus } from "./metadata"

export const SKILL_ACTIONS = [
  "submit_review",
  "approve_business",
  "reject_business",
  "publish_tech",
  "start_iteration",
  "publish_iteration",
  "take_offline",
  "bring_online",
  "archive",
] as const
export type SkillAction = (typeof SKILL_ACTIONS)[number]

export const ACTOR_ROLES = ["author", "business_reviewer", "system_admin"] as const
export type ActorRole = (typeof ACTOR_ROLES)[number]

/** 审核两道关：业务审内容与可泛化性，技术审合规与能跑。 */
export const REVIEW_GATES = ["business_review", "technical_publish"] as const
export type ReviewGate = (typeof REVIEW_GATES)[number]

/**
 * 转移的物理动作（T008）。只写「搬什么」，不写路径——路径由 `service.ts` 按
 * `storage.ts` 的约定算，两边都不各自猜一份。
 *
 * - `copy_to_pending`：从作者沙箱复制新内容到 `pending/`（提交审核 / 发起迭代）；
 * - `move_pending_to_publish`：`pending/` → 发布目录（技术发布 / 迭代发布）；
 * - `move_publish_to_archive`：发布目录 → `archive/`（归档）；
 * - `none`：只改元数据（审核通过 / 驳回 / 下线 / 上线）。
 */
export const STORAGE_INTENTS = [
  "none",
  "copy_to_pending",
  "move_pending_to_publish",
  "move_publish_to_archive",
] as const
export type StorageIntent = (typeof STORAGE_INTENTS)[number]

export interface SkillTransition {
  action: SkillAction
  from: readonly AssetStatus[]
  to: AssetStatus
  /** 允许触发该动作的角色；多角色表示任一即可。 */
  actors: readonly ActorRole[]
  /** 触发前必须满足的审核关；迭代发布同时要求两道关。 */
  gates: readonly ReviewGate[]
  storage: StorageIntent
  requiresReason?: boolean
}

export const SKILL_TRANSITIONS = [
  {
    action: "submit_review",
    from: ["draft"],
    to: "in_review",
    actors: ["author"],
    gates: [],
    storage: "copy_to_pending",
  },
  {
    action: "approve_business",
    from: ["in_review"],
    to: "pending_tech",
    actors: ["business_reviewer"],
    gates: ["business_review"],
    storage: "none",
  },
  {
    action: "reject_business",
    from: ["in_review"],
    to: "draft",
    actors: ["business_reviewer"],
    gates: ["business_review"],
    storage: "none",
    requiresReason: true,
  },
  {
    action: "publish_tech",
    from: ["pending_tech"],
    to: "published",
    actors: ["system_admin"],
    gates: ["technical_publish"],
    storage: "move_pending_to_publish",
  },
  {
    action: "start_iteration",
    from: ["published"],
    to: "iterating",
    actors: ["author"],
    gates: [],
    storage: "copy_to_pending",
  },
  {
    action: "publish_iteration",
    from: ["iterating"],
    to: "published",
    actors: ["system_admin"],
    gates: ["business_review", "technical_publish"],
    storage: "move_pending_to_publish",
  },
  {
    action: "take_offline",
    from: ["published"],
    to: "offline",
    actors: ["system_admin"],
    gates: [],
    storage: "none",
  },
  {
    action: "bring_online",
    from: ["offline"],
    to: "published",
    actors: ["author", "system_admin"],
    gates: ["technical_publish"],
    storage: "none",
  },
  {
    action: "archive",
    from: ["published", "offline"],
    to: "archived",
    actors: ["system_admin"],
    gates: [],
    storage: "move_publish_to_archive",
  },
] as const satisfies readonly SkillTransition[]

export type TransitionErrorCode =
  | "unknown_action"
  | "invalid_source"
  | "actor_not_allowed"
  | "reason_required"
  | "asset_not_found"
  | "unsupported_asset_type"
  | "source_directory_required"
  | "concurrent_transition"
  /** 个人资产没有共享发布目录：要发布，得先把可见范围改成部门 / 全局。 */
  | "personal_asset_not_shared"
  /** 选「本部门」发布，但资产没有可用的部门信息（作者档案部门为空 / 空白 / 不可用作目录段）。 */
  | "department_missing"
  /** 非发布类动作不接受可见范围参数：调用方理解错了，不静默忽略。 */
  | "visibility_not_applicable"

export class AssetTransitionError extends Error {
  constructor(
    readonly code: TransitionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "AssetTransitionError"
  }
}

export interface TransitionRequest {
  actor: ActorRole
  /** 驳回等动作要求非空理由；其他动作可带说明。 */
  reason?: string
}

export interface AppliedSkillTransition {
  from: AssetStatus
  to: AssetStatus
  action: SkillAction
  actor: ActorRole
  storage: StorageIntent
  reason?: string
}

export function transitionFor(action: SkillAction): SkillTransition | undefined {
  return SKILL_TRANSITIONS.find((transition) => transition.action === action)
}

export function allowedSkillActions(status: AssetStatus): SkillAction[] {
  return SKILL_TRANSITIONS.filter((transition) =>
    (transition.from as readonly AssetStatus[]).includes(status),
  ).map((transition) => transition.action)
}

/**
 * 执行一次转移。非法状态 / 越权 / 缺理由都显式抛错，
 * 让调用方无法「静默什么都不做」。
 */
export function applySkillTransition(
  from: AssetStatus,
  action: SkillAction,
  request: TransitionRequest,
): AppliedSkillTransition {
  const transition = transitionFor(action)
  if (!transition) {
    throw new AssetTransitionError("unknown_action", `未知生命周期动作：${action}`)
  }
  if (!transition.from.includes(from)) {
    throw new AssetTransitionError(
      "invalid_source",
      `状态 ${from} 不能执行 ${action}（只允许从 ${transition.from.join(" / ")} 发起）`,
    )
  }
  if (!transition.actors.includes(request.actor)) {
    throw new AssetTransitionError(
      "actor_not_allowed",
      `${request.actor} 不能执行 ${action}（只允许 ${transition.actors.join(" / ")}）`,
    )
  }

  const reason = typeof request.reason === "string" ? request.reason.trim() : ""
  if (transition.requiresReason && reason === "") {
    throw new AssetTransitionError("reason_required", `${action} 必须填写理由`)
  }

  return {
    from,
    to: transition.to,
    action,
    actor: request.actor,
    storage: transition.storage,
    ...(reason === "" ? {} : { reason }),
  }
}

export function isTerminalStatus(status: AssetStatus): boolean {
  return status === "archived"
}

/**
 * 「可用」只指民警能执行/使用该资产。
 * 迭代中旧版本仍可用（D0-7），所以 iterating 也为 true；归档后连旧版也不可用。
 */
export function isAssetUsable(status: AssetStatus): boolean {
  return status === "published" || status === "iterating"
}
