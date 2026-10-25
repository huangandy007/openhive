import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { rowsOf } from "@opencode-ai/auth/migrate"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { insertAsset } from "./asset"
import { SKILL_ACTIONS, type AppliedSkillTransition, type SkillAction } from "./lifecycle"
import type { AssetMetadata } from "./metadata"
import { notifyAssetTransition, TRANSITION_RECIPIENTS } from "./notify"
import { addFavorite } from "./preferences"

/**
 * 009 T010 · 站内信通知（状态变化推送到人）。
 *
 * 判据分三块：
 * ① 防漂移：`asset_notification.action` 的 CHECK ⇔ `SKILL_ACTIONS`；
 * ② 收件人矩阵：每个动作推给谁（design §2.6），谁能被去重、谁被排除；
 * ③ 内容快照：标题 / 正文 / 资产名 / 时间落库，且不随资产改名漂移。
 */

const databases: ProductionDb[] = []

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.stop()))
})

async function freshDb(): Promise<ProductionDb["db"]> {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  for (const [id, name, dept] of [
    ["u1", "甲民警", "经侦支队"],
    ["u2", "乙民警", "法制支队"],
    ["u3", "丙民警", "科信支队"],
  ] as const) {
    await database.db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values (${id}, ${`0100${id.slice(1)}`}, ${name}, 'x', 'x', 'x', ${dept}, 'x', 0, 'h', 0)
    `)
  }
  return database.db
}

function metadata(overrides: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    id: "asset_1",
    name: "资金流水分析",
    type: "skill",
    description: "按账户汇总流水",
    icon: "skill",
    category: "intelligence",
    tags: ["资金"],
    ownerId: "u1",
    ownerName: "甲民警",
    department: "经侦支队",
    visibility: "department",
    version: 1,
    status: "draft",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    publishedAt: null,
    archivedAt: null,
    ...overrides,
  }
}

/** 直接写授权行：组的 role_type 不影响 `grantsFor` / 收件人解析，都只看两张关系表。 */
async function grant(db: ProductionDb["db"], userId: string, perm: string, assetId = "asset_1") {
  const roleId = `role_${userId}_${perm}_${assetId}`
  await db.execute(sql`insert into auth.role (id, name, role_type) values (${roleId}, ${roleId}, 'group')`)
  await db.execute(sql`insert into auth.user_role (user_id, role_id) values (${userId}, ${roleId})`)
  await db.execute(sql`
    insert into auth.role_resource (role_id, resource_type, resource_id, perm)
    values (${roleId}, 'skill', ${assetId}, ${perm})
  `)
}

function applied(action: SkillAction, overrides: Partial<AppliedSkillTransition> = {}): AppliedSkillTransition {
  return {
    from: "draft",
    to: "in_review",
    action,
    actor: "author",
    storage: "none",
    ...overrides,
  }
}

async function notify(
  db: ProductionDb["db"],
  action: SkillAction,
  options: {
    asset?: AssetMetadata
    actorId?: string
    reason?: string
    now?: number
  } = {},
) {
  const asset = options.asset ?? metadata({ status: "in_review" })
  return notifyAssetTransition(db, {
    asset,
    applied: applied(action, options.reason === undefined ? {} : { reason: options.reason }),
    actorId: options.actorId ?? "u2",
    now: options.now ?? 5_000,
  })
}

interface NotificationRow {
  asset_id: string
  asset_name: string
  recipient_id: string
  action: string
  title: string
  body: string
  created_at: number
}

async function rows(db: ProductionDb["db"], recipientId?: string): Promise<NotificationRow[]> {
  const result = await db.execute(
    recipientId === undefined
      ? sql`select asset_id, asset_name, recipient_id, action, title, body, created_at from auth.asset_notification order by recipient_id, action`
      : sql`select asset_id, asset_name, recipient_id, action, title, body, created_at from auth.asset_notification where recipient_id = ${recipientId} order by action`,
  )
  return rowsOf(result).map((row) => ({
    asset_id: String(row.asset_id),
    asset_name: String(row.asset_name),
    recipient_id: String(row.recipient_id),
    action: String(row.action),
    title: String(row.title),
    body: String(row.body),
    created_at: Number(row.created_at),
  }))
}

const literalsOf = (definition: string): string[] =>
  [...definition.matchAll(/'([^']*)'/g)].map((match) => match[1]!).sort()

describe("asset_notification 表（防漂移）", () => {
  test("action CHECK ⇔ SKILL_ACTIONS（逐值，双向）", async () => {
    const db = await freshDb()
    const result = await db.execute(sql`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conname = 'asset_notification_action_check'
    `)
    const [row] = rowsOf(result)
    expect(row).toBeDefined()
    expect(literalsOf(String(row!.def))).toEqual([...SKILL_ACTIONS].sort())
  })
})

describe("收件人矩阵（design §2.6）", () => {
  test("提交审核：只通知持有 review 授权的人，不通知作者", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())
    await grant(db, "u2", "review")

    expect(await notify(db, "submit_review", { actorId: "u1" })).toBe(1)

    const all = await rows(db)
    expect(all).toEqual([
      {
        asset_id: "asset_1",
        asset_name: "资金流水分析",
        recipient_id: "u2",
        action: "submit_review",
        title: "有 skill 待审核",
        body: "资金流水分析 已提交业务审核，请审核内容正确性与可泛化性。",
        created_at: 5_000,
      },
    ])
  })

  test("业务通过：通知作者 + 系统管理员；发起人自己被排除", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "in_review" }))
    await grant(db, "u2", "review")
    await grant(db, "u3", "admin")

    expect(await notify(db, "approve_business", { actorId: "u2" })).toBe(2)
    expect((await rows(db)).map((row) => row.recipient_id)).toEqual(["u1", "u3"])
  })

  test("同一个人既是作者又持有 admin：去重成一条", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "in_review" }))
    await grant(db, "u1", "admin")

    expect(await notify(db, "approve_business", { actorId: "u3" })).toBe(1)
    expect((await rows(db)).map((row) => row.recipient_id)).toEqual(["u1"])
  })

  test("发起人自己是唯一收件人时不发（自己不需要被告知自己做的动作）", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "published" }))

    expect(await notify(db, "take_offline", { actorId: "u1" })).toBe(0)
    expect(await rows(db)).toEqual([])
  })

  test("驳回：只通知作者，正文带驳回理由", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "in_review" }))

    expect(await notify(db, "reject_business", { reason: "只适用于本专案，不可泛化" })).toBe(1)
    const [row] = await rows(db)
    expect(row!.recipient_id).toBe("u1")
    expect(row!.title).toBe("skill 被驳回")
    expect(row!.body).toContain("只适用于本专案，不可泛化")
  })

  test("发布 / 下线 / 归档：通知作者", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "published" }))

    await notify(db, "publish_tech", { actorId: "u3" })
    await notify(db, "take_offline", { actorId: "u3" })
    await notify(db, "archive", { actorId: "u3" })

    const all = await rows(db)
    expect(all.map((row) => [row.recipient_id, row.action])).toEqual([
      ["u1", "archive"],
      ["u1", "publish_tech"],
      ["u1", "take_offline"],
    ])
  })

  test("迭代发布：通知作者，正文带版本号", async () => {
    const db = await freshDb()
    const asset = metadata({ status: "published", version: 2 })
    await insertAsset(db, asset)

    expect(await notify(db, "publish_iteration", { asset, actorId: "u3" })).toBe(1)
    expect((await rows(db))[0]!.body).toContain("第 2 版")
  })

  test("开始迭代没有收件人；重新上线没有收藏者时也是零条", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "published" }))

    expect(await notify(db, "start_iteration", { actorId: "u1" })).toBe(0)
    expect(await notify(db, "bring_online", { actorId: "u1" })).toBe(0)
    expect(await rows(db)).toEqual([])

    // 矩阵本身写清楚「为什么是空 / 为什么是收藏者」，别让后来的人以为是漏配。
    expect(TRANSITION_RECIPIENTS.start_iteration).toEqual([])
    expect(TRANSITION_RECIPIENTS.bring_online).toEqual(["favoriters"])
  })

  test("下线：作者 + 收藏者都收到；发起人若恰好也收藏了则被排除", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "published" }))
    await addFavorite(db, { userId: "u1", assetId: "asset_1" }) // 作者收藏了自己的
    await addFavorite(db, { userId: "u2", assetId: "asset_1" })
    await addFavorite(db, { userId: "u3", assetId: "asset_1" })

    // u3（管理员）下线：作者 u1 与收藏者 u2 收到，发起人 u3 被排除。
    expect(await notify(db, "take_offline", { actorId: "u3" })).toBe(2)
    expect((await rows(db)).map((row) => row.recipient_id)).toEqual(["u1", "u2"])
  })

  test("重新上线：只通知收藏者，不通知作者（作者没收藏就不该收到）", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "offline" }))
    await addFavorite(db, { userId: "u2", assetId: "asset_1" })

    expect(await notify(db, "bring_online", { actorId: "u3" })).toBe(1)
    const [row] = await rows(db)
    expect(row!.recipient_id).toBe("u2")
    expect(row!.title).toBe("skill 已重新上线")
    expect(row!.body).toContain("可以继续使用")
  })

  test("别的资产的收藏者不会串到本资产的通知里", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "published" }))
    await insertAsset(db, metadata({ id: "asset_2", name: "话单碰撞", status: "published" }))
    await addFavorite(db, { userId: "u3", assetId: "asset_2" })

    expect(await notify(db, "take_offline", { actorId: "u2" })).toBe(1)
    expect((await rows(db)).map((row) => row.recipient_id)).toEqual(["u1"])
  })

  test("没有授权人 ⇒ 零条通知，不抛错（不能因没人可通知让流转失败）", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())

    expect(await notify(db, "submit_review", { actorId: "u1" })).toBe(0)
    expect(await rows(db)).toEqual([])
  })

  test("只认 review / admin 权限行：write 授权人不会收到审核通知", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())
    await grant(db, "u2", "write")
    await grant(db, "u3", "review")

    expect(await notify(db, "submit_review", { actorId: "u1" })).toBe(1)
    expect((await rows(db)).map((row) => row.recipient_id)).toEqual(["u3"])
  })

  test("别的资产的授权不会串到本资产", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata())
    await grant(db, "u2", "review", "asset_other")

    expect(await notify(db, "submit_review", { actorId: "u1" })).toBe(0)
  })
})

describe("内容快照与寿命", () => {
  test("资产名是写入时的快照：之后改名不回头改历史通知", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "published" }))
    await notify(db, "publish_tech", { actorId: "u3" })

    await db.execute(sql`update auth.asset set name = '资金流水分析（改名）' where id = 'asset_1'`)
    expect((await rows(db))[0]!.asset_name).toBe("资金流水分析")
  })

  test("资产被删除：通知随外键级联消失，不留指向不存在资产的死链", async () => {
    const db = await freshDb()
    await insertAsset(db, metadata({ status: "published" }))
    await notify(db, "publish_tech", { actorId: "u3" })
    expect(await rows(db)).toHaveLength(1)

    await db.execute(sql`delete from auth.asset where id = 'asset_1'`)
    expect(await rows(db)).toEqual([])
  })
})
