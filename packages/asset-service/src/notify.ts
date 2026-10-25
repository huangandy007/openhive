import { randomUUID } from "node:crypto"
import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { AppliedSkillTransition, SkillAction } from "./lifecycle"
import type { AssetMetadata } from "./metadata"

/**
 * 资产状态变化的站内信通知（009 T010，FR-004 / design §2.6）。
 *
 * ## 收件人在写入时解析，并展开成「一行一人」
 *
 * 不在读取时再 join 权限：授权会被撤销，历史通知不该随之消失，也不该改变当时通知了谁。
 * 解析只认**库里的授权行**（`role_resource` → `user_role`）。调用方预取的 `grants`
 * 只用于 T009 的鉴权，不参与通知收件人——「能审」和「该被告知」是两件事。
 *
 * ## 发布不广播
 *
 * 设计明确要求：新资产发布**不通知全体**，让民警在资产工作区主动发现（避免通知轰炸）。
 * 所以这里没有「全单位」收件人，只有作者 / 授权人。
 *
 * ## 已知残差
 *
 * - 「下线 / 重新上线 → 使用者（收藏 / 最近用过）」中的使用者解析不出来：当前没有
 *   收藏明细与使用明细（计数是缓存列），T011 落收藏后回来补。现在只通知作者。
 * - 通知没有已读状态（`read_at`）、没有去重键、失败不重试：前两项属站内信面板，
 *   重试要先有 outbox / 对账，不在 T010 造一个看起来可靠的空壳。
 */

/** 能跑 SQL 的句柄（形状同 `AssetTarget` / `GrantTarget`）。 */
export interface NotificationTarget {
  execute(query: SQL): PromiseLike<unknown>
}

/** 收件人来源。`reviewers` = 持有该资产 `review` 授权的人；`admins` 同理（`admin`）。 */
export type RecipientKind = "author" | "reviewers" | "admins"

/**
 * 每个动作推给谁（design §2.6 的表格）。
 *
 * 两个空数组是**刻意的**，不是漏配：
 * - `start_iteration`：作者自己发起的，通知自己只会制造噪音；
 * - `bring_online`：设计推给「使用者」，但当前没有收藏 / 使用明细（T011），
 *   宁可零收件人，也不凭空造一个收件人列表。
 */
export const TRANSITION_RECIPIENTS: Record<SkillAction, readonly RecipientKind[]> = {
  submit_review: ["reviewers"],
  approve_business: ["author", "admins"],
  reject_business: ["author"],
  publish_tech: ["author"],
  start_iteration: [],
  publish_iteration: ["author"],
  take_offline: ["author"],
  bring_online: [],
  archive: ["author"],
}

export interface AssetTransitionNotice {
  /** 流转**之后**的资产（状态 / 版本已更新，名字用当前值）。 */
  readonly asset: AssetMetadata
  readonly applied: AppliedSkillTransition
  /** 发起人的用户 id；不会收到自己动作的通知。 */
  readonly actorId: string
  /** Unix 秒，与本次流转的 `updatedAt` 同一个值。 */
  readonly now: number
}

/**
 * 流转已生效、但通知写入失败。
 *
 * 单独一个类型而不是直接抛原始 SQL 错误：调用方最需要知道的是「状态已经变了」，
 * 否则会误以为流转失败而重试（重试会撞 `concurrent_transition`）。
 */
export class AssetNotificationError extends Error {
  readonly code = "notification_failed" as const

  constructor(
    readonly assetId: string,
    readonly action: SkillAction,
    cause: unknown,
  ) {
    super(`资产 ${assetId} 的 ${action} 已生效，但站内信通知写入失败`, { cause })
    this.name = "AssetNotificationError"
  }
}

/** 持有某资产某类权限的用户 id（按 id 排序，保证测试与展示稳定）。 */
async function grantHolders(
  db: NotificationTarget,
  asset: AssetMetadata,
  perm: "review" | "admin",
): Promise<string[]> {
  const result = await db.execute(sql`
    select distinct ur.user_id
    from auth.role_resource rr
    join auth.user_role ur on ur.role_id = rr.role_id
    where rr.resource_type = ${asset.type}
      and rr.resource_id = ${asset.id}
      and rr.perm = ${perm}
    order by ur.user_id
  `)
  return rowsOf(result).map((row) => String(row.user_id))
}

/**
 * 解析收件人：作者在前，其后 review / admin 授权人；**去重后排除发起人**。
 *
 * 排除发起人是有意的：管理员下线自己名下资产、作者提交自己的草稿，都不需要
 * 一封「你刚做的事」的通知。
 */
export async function resolveNotificationRecipients(
  db: NotificationTarget,
  notice: AssetTransitionNotice,
): Promise<string[]> {
  const kinds = TRANSITION_RECIPIENTS[notice.applied.action]
  const recipients = new Set<string>()

  if (kinds.includes("author")) recipients.add(notice.asset.ownerId)
  if (kinds.includes("reviewers")) {
    for (const userId of await grantHolders(db, notice.asset, "review")) recipients.add(userId)
  }
  if (kinds.includes("admins")) {
    for (const userId of await grantHolders(db, notice.asset, "admin")) recipients.add(userId)
  }

  recipients.delete(notice.actorId)
  return [...recipients]
}

function messageOf(notice: AssetTransitionNotice): { title: string; body: string } {
  const name = notice.asset.name
  const reason = notice.applied.reason?.trim() ?? ""

  switch (notice.applied.action) {
    case "submit_review":
      return {
        title: "有 skill 待审核",
        body: `${name} 已提交业务审核，请审核内容正确性与可泛化性。`,
      }
    case "approve_business":
      return { title: "skill 已过业务审核", body: `${name} 已通过业务审核，等待技术发布。` }
    case "reject_business":
      return {
        title: "skill 被驳回",
        body: reason === "" ? `${name} 被驳回。` : `${name} 被驳回：${reason}`,
      }
    case "publish_tech":
      return { title: "skill 已发布", body: `${name} 已发布上线。` }
    case "publish_iteration":
      return {
        title: "skill 新版本已发布",
        body: `${name} 第 ${notice.asset.version} 版已发布上线。`,
      }
    case "take_offline":
      return {
        title: "skill 已下线",
        body: reason === "" ? `${name} 已下线。` : `${name} 已下线。原因：${reason}`,
      }
    case "archive":
      return { title: "skill 已归档", body: `${name} 已归档。` }
    // 两个动作没有收件人（见 TRANSITION_RECIPIENTS）；这里返回什么都写不进库。
    case "start_iteration":
    case "bring_online":
      return { title: "skill 状态变化", body: `${name} 已${notice.applied.action}。` }
    default: {
      const action: never = notice.applied.action
      throw new Error(`未知生命周期动作：${String(action)}`)
    }
  }
}

/**
 * 为一次已生效的流转写站内信：解析收件人 → 生成文案 → 一批写入。
 *
 * 返回写入条数。没有任何收件人时返回 `0`，**不抛错**——通知是派生信息，
 * 没人可通知不应该让流转失败。
 *
 * 这个函数在流转**提交之后**调用；失败时抛 `AssetNotificationError`，
 * 由调用方区分「流转失败」与「流转成功但通知失败」。
 */
export async function notifyAssetTransition(
  db: NotificationTarget,
  notice: AssetTransitionNotice,
): Promise<number> {
  const recipients = await resolveNotificationRecipients(db, notice)
  if (recipients.length === 0) return 0

  const { title, body } = messageOf(notice)
  const values = recipients.map(
    (recipientId) => sql`(
      ${randomUUID()},
      ${notice.asset.id},
      ${notice.asset.name},
      ${recipientId},
      ${notice.applied.action},
      ${title},
      ${body},
      ${notice.now}
    )`,
  )

  await db.execute(sql`
    insert into auth.asset_notification
      (id, asset_id, asset_name, recipient_id, action, title, body, created_at)
    values ${sql.join(values, sql`, `)}
  `)

  return recipients.length
}
