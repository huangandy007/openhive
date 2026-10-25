import { randomUUID } from "node:crypto"
import { sql, type SQL } from "drizzle-orm"
import { rowsOf } from "@opencode-ai/auth/migrate"
import type { AppliedSkillTransition, SkillAction } from "./lifecycle"
import type { AssetMetadata } from "./metadata"
import { favoriteUsers } from "./preferences"

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
 * ## 「使用者」= 收藏者（T011 补齐）
 *
 * 下线 / 重新上线推给**收藏过这份资产的人**（`auth.asset_favorite`，T011 落地）。
 * 设计原文是「使用者（收藏 / 最近用过）」；「最近用过」这一半**暂不纳入**：设计没有
 * 定义「最近」的时间窗（7 天？30 天？），凭空取一个数字就是把产品决策埋进代码。
 * 等产品给出窗口后，`auth.asset_usage` 已有逐用户 `last_used_at`，加一条查询即可。
 *
 * ## 已知残差
 *
 * - 通知没有已读状态（`read_at`）、没有去重键、失败不重试：前两项属站内信面板，
 *   重试要先有 outbox / 对账，不在 T010 造一个看起来可靠的空壳。
 * - 收藏者可能**当前已无权读取**该资产（授权撤销后收藏行仍在）：通知正文只含资产名，
 *   不含任何内容细节，且资产下线 / 上线的消息本身不构成权限泄漏；但若未来正文要带
 *   内容摘要，必须先过滤收件人。
 */

/** 能跑 SQL 的句柄（形状同 `AssetTarget` / `GrantTarget`）。 */
export interface NotificationTarget {
  execute(query: SQL): PromiseLike<unknown>
}

/**
 * 收件人来源。
 * - `reviewers` / `admins`：持有该资产 `review` / `admin` 授权的人；
 * - `favoriters`：收藏过该资产的「使用者」（T011）。
 */
export type RecipientKind = "author" | "reviewers" | "admins" | "favoriters"

/**
 * 每个动作推给谁（design §2.6 的表格）。
 *
 * `start_iteration` 的空数组是**刻意的**，不是漏配：作者自己发起的，
 * 通知自己只会制造噪音。
 */
export const TRANSITION_RECIPIENTS: Record<SkillAction, readonly RecipientKind[]> = {
  submit_review: ["reviewers"],
  approve_business: ["author", "admins"],
  reject_business: ["author"],
  publish_tech: ["author"],
  start_iteration: [],
  publish_iteration: ["author"],
  take_offline: ["author", "favoriters"],
  bring_online: ["favoriters"],
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
  if (kinds.includes("favoriters")) {
    for (const userId of await favoriteUsers(db, notice.asset.id)) recipients.add(userId)
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
    case "bring_online":
      return { title: "skill 已重新上线", body: `${name} 已重新上线，可以继续使用。` }
    case "archive":
      return { title: "skill 已归档", body: `${name} 已归档。` }
    // 没有收件人（见 TRANSITION_RECIPIENTS）；返回什么都写不进库。
    case "start_iteration":
      return { title: "skill 状态变化", body: `${name} 已开始迭代。` }
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
