import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { sql } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import type { GrantRow } from "@opencode-ai/auth/rbac"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { assetById, insertAsset } from "./asset"
import {
  effectivePermissions,
  type AssetPerm,
  type AssetViewer,
} from "./authorization"
import {
  AssetTransitionError,
  SKILL_ACTIONS,
  allowedSkillActions,
  applySkillTransition,
  type ActorRole,
  type SkillAction,
} from "./lifecycle"
import { ASSET_STATUSES, type AssetMetadata, type AssetStatus } from "./metadata"
import { authorizeTransition } from "./review"
import { assetLocation, transitionAsset } from "./service"
import { archiveDirectory, pendingDirectory, publishDirectory } from "./storage"

/**
 * SC-002 验收：生命周期状态流转正确 + 审核两道关（业务 / 技术）分离。
 *
 * ## 为什么不复用 T008 / T009 的用例
 *
 * T008 的 `service.test.ts` 把每个动作**分段**测（主路径、驳回、迭代、下线、归档各一条），
 * T009 的 `review.test.ts` **抽样**测授权。验收要回答的是另外两个问题：
 *
 * 1. **连起来还对不对**——状态一路带下去时，版本号 / 发布时间 / 文件位置会不会漏刷新；
 * 2. **有没有漏格**——7 状态 × 9 动作 × 各类身份，逐格与转移表 + 权限映射对账。
 *
 * 所以这里的期望值**独立写死一份验收口径**（`验收转移表` / `角色所需权限` / `身份们的权限`），
 * 不从实现里读——实现改了而口径没改，用例必须红。
 *
 * ⚠️ 不覆盖：「同一人显式同时持 review + admin 可连过两道关」是已记录的残差
 * （`review.md` / 设计 §3.3 的口径是「权限互不蕴含」，不是「必须不同人」）。
 */

const databases: ProductionDb[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  await Promise.all(databases.splice(0).map((database) => database.stop()))
})

function tempRoot(): string {
  const root = join(tmpdir(), `openhive-asset-sc002-${randomUUID()}`)
  roots.push(root)
  return root
}

async function freshDb(): Promise<ProductionDb["db"]> {
  const database = await startProductionDb()
  databases.push(database)
  await migrate(database.db)
  await database.db.execute(sql`
    insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
    values ('u1', '010001', '甲民警', 'x', 'x', 'x', '经侦支队', 'x', 0, 'h', 0)
  `)
  return database.db
}

async function writeSkill(directory: string, body: string): Promise<void> {
  await mkdir(join(directory, "references"), { recursive: true })
  await writeFile(join(directory, "SKILL.md"), body)
  await writeFile(join(directory, "references", "notes.txt"), `${body}-notes`)
}

function metadata(over: Partial<AssetMetadata> = {}): AssetMetadata {
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
    ...over,
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

function 同步错误码(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof AssetTransitionError) return error.code
    throw error
  }
  return undefined
}

async function 异步错误码(run: () => Promise<unknown>): Promise<string | undefined> {
  const caught = await run().then(
    () => null,
    (error: unknown) => error,
  )
  if (caught === null) return undefined
  if (caught instanceof AssetTransitionError) return caught.code
  throw caught
}

async function 列目录(directory: string): Promise<Dirent[]> {
  return readdir(directory, { withFileTypes: true }).catch(() => [])
}

/** 目录树快照：`相对路径:内容`，排序后比较。目录不存在 ⇒ 空快照。 */
async function 目录快照(root: string): Promise<string[]> {
  const 结果: string[] = []
  async function 走(directory: string): Promise<void> {
    for (const entry of await 列目录(directory)) {
      const 路径 = join(directory, entry.name)
      if (entry.isDirectory()) await 走(路径)
      // 统一成 `/`：本机是 win32，`relative()` 给反斜杠（`#006-23` 同型）
      else 结果.push(`${relative(root, 路径).split("\\").join("/")}:${await readFile(路径, "utf8")}`)
    }
  }
  await 走(root)
  return 结果.sort()
}

// ---------------------------------------------------------------------------
// 独立验收口径（不读实现）
// ---------------------------------------------------------------------------

/** 设计 D0-7 / §3.3 的转移表。动作、源状态、目标状态、允许角色都直接抄口径。 */
const 验收转移表 = {
  submit_review: { from: ["draft"], to: "in_review", roles: ["author"] },
  approve_business: { from: ["in_review"], to: "pending_tech", roles: ["business_reviewer"] },
  reject_business: { from: ["in_review"], to: "draft", roles: ["business_reviewer"] },
  publish_tech: { from: ["pending_tech"], to: "published", roles: ["system_admin"] },
  start_iteration: { from: ["published"], to: "iterating", roles: ["author"] },
  publish_iteration: { from: ["iterating"], to: "published", roles: ["system_admin"] },
  take_offline: { from: ["published"], to: "offline", roles: ["system_admin"] },
  bring_online: { from: ["offline"], to: "published", roles: ["author", "system_admin"] },
  archive: { from: ["published", "offline"], to: "archived", roles: ["system_admin"] },
} as const satisfies Record<
  SkillAction,
  { from: readonly AssetStatus[]; to: AssetStatus; roles: readonly ActorRole[] }
>

/** 角色 → 所需权限（设计 §3.3 的最小映射，**不蕴含**：不给 admin 补 review / write）。 */
const 角色所需权限: Record<ActorRole, AssetPerm> = {
  author: "write",
  business_reviewer: "review",
  system_admin: "admin",
}

interface 身份 {
  readonly 名: string
  readonly viewer: AssetViewer
  readonly grants: readonly GrantRow[]
  /** 期望由 `effectivePermissions()` 给出的权限集（独立写死，见「身份 → 权限口径」）。 */
  readonly perms: readonly AssetPerm[]
}

function 授权(assetId: string, perm: AssetPerm): GrantRow {
  return { resourceType: "skill", resourceId: assetId, perm }
}

// 除作者外，部门与资产不同 ⇒ 空间可见性不会额外给 read，权限集就是「授权行」本身。
const 身份们: readonly 身份[] = [
  { 名: "作者本人", viewer: { userId: "u1", department: "经侦支队" }, grants: [], perms: ["read", "write"] },
  {
    名: "他人 + write 授权",
    viewer: { userId: "u2", department: "刑侦支队" },
    grants: [授权("asset_1", "write")],
    perms: ["read", "write"],
  },
  {
    名: "他人 + review 授权",
    viewer: { userId: "u3", department: "刑侦支队" },
    grants: [授权("asset_1", "review")],
    perms: ["read", "review"],
  },
  {
    名: "他人 + admin 授权",
    viewer: { userId: "u4", department: "刑侦支队" },
    grants: [授权("asset_1", "admin")],
    perms: ["read", "admin"],
  },
  {
    名: "他人 + review + admin 双授权",
    viewer: { userId: "u5", department: "刑侦支队" },
    grants: [授权("asset_1", "review"), 授权("asset_1", "admin")],
    perms: ["read", "review", "admin"],
  },
  {
    名: "无任何授权的外人",
    viewer: { userId: "u9", department: "刑侦支队" },
    grants: [],
    perms: [],
  },
]

// ---------------------------------------------------------------------------
// ① 连续旅程
// ---------------------------------------------------------------------------

describe("SC-002 验收 · 生命周期状态流转（T016）", () => {
  test("一条连续旅程：草稿 → 驳回 → 重提 → 发布 → 迭代 → 下线 → 上线 → 归档，状态 / 版本 / 时间 / 文件步步对账", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await insertAsset(db, metadata({ status: "draft" }))

    const 作者 = { userId: "u1", department: "经侦支队" }
    const 业务管理员 = { userId: "u2", department: "法制支队" }
    const 系统管理员 = { userId: "u3", department: "科信支队" }
    const 审 = [授权("asset_1", "review")]
    const 管 = [授权("asset_1", "admin")]

    const 发布目录 = publishDirectory(
      root,
      "skill",
      { visibility: "department", department: "经侦支队" },
      "asset_1",
    )
    const 待审目录 = pendingDirectory(root, "asset_1")

    const 走 = async (input: {
      action: SkillAction
      viewer: AssetViewer
      grants: readonly GrantRow[]
      now: number
      sourceDirectory?: string
      reason?: string
    }) =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: input.action,
        viewer: input.viewer,
        grants: [...input.grants],
        now: input.now,
        ...(input.sourceDirectory === undefined ? {} : { sourceDirectory: input.sourceDirectory }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      })

    // 1. 提交审核：文件复制到 pending，发布时间仍为空
    const 提交 = await 走({ action: "submit_review", viewer: 作者, grants: [], now: 2_000, sourceDirectory: source })
    expect(提交.status).toBe("in_review")
    expect(提交.version).toBe(1)
    expect(提交.publishedAt).toBeNull()
    expect(await readFile(join(待审目录, "SKILL.md"), "utf8")).toBe("v1")

    // 2. 业务驳回：回草稿，pending 留给下次覆盖（T008 口径）
    const 驳回 = await 走({
      action: "reject_business",
      viewer: 业务管理员,
      grants: 审,
      reason: "只适用于本专案，不可泛化",
      now: 2_001,
    })
    expect(驳回.status).toBe("draft")
    expect(驳回.version).toBe(1)
    expect(await readFile(join(待审目录, "SKILL.md"), "utf8")).toBe("v1")

    // 3. 重新提交 + 业务通过：同一个 assetId、同一个 pending 目录
    const 重提 = await 走({ action: "submit_review", viewer: 作者, grants: [], now: 2_002, sourceDirectory: source })
    expect(重提.status).toBe("in_review")
    const 业务通过 = await 走({ action: "approve_business", viewer: 业务管理员, grants: 审, now: 2_003 })
    expect(业务通过.status).toBe("pending_tech")
    expect(await readFile(join(待审目录, "SKILL.md"), "utf8")).toBe("v1")

    // 4. 技术发布：pending 搬进发布目录，发布时间落定
    const 发布 = await 走({ action: "publish_tech", viewer: 系统管理员, grants: 管, now: 2_004 })
    expect(发布.status).toBe("published")
    expect(发布.version).toBe(1)
    expect(发布.publishedAt).toBe(2_004)
    expect(await exists(待审目录)).toBe(false)
    expect(await readFile(join(发布目录, "SKILL.md"), "utf8")).toBe("v1")

    // 5. 发起迭代：版本 +1，旧版继续可用，新内容进 pending
    await writeSkill(source, "v2")
    const 迭代 = await 走({ action: "start_iteration", viewer: 作者, grants: [], now: 3_000, sourceDirectory: source })
    expect(迭代.status).toBe("iterating")
    expect(迭代.version).toBe(2)
    expect(迭代.publishedAt).toBe(2_004)
    expect(await readFile(join(发布目录, "SKILL.md"), "utf8")).toBe("v1")
    expect(await readFile(join(待审目录, "SKILL.md"), "utf8")).toBe("v2")

    // 6. 迭代发布：新版替换旧版，发布时间刷新，版本不再 +1
    const 迭代发布 = await 走({ action: "publish_iteration", viewer: 系统管理员, grants: 管, now: 3_001 })
    expect(迭代发布.status).toBe("published")
    expect(迭代发布.version).toBe(2)
    expect(迭代发布.publishedAt).toBe(3_001)
    expect(await exists(待审目录)).toBe(false)
    expect(await readFile(join(发布目录, "SKILL.md"), "utf8")).toBe("v2")

    // 7. 下线：只改状态、不搬目录，发布时间保留
    const 下线 = await 走({ action: "take_offline", viewer: 系统管理员, grants: 管, now: 4_000 })
    expect(下线.status).toBe("offline")
    expect(下线.publishedAt).toBe(3_001)
    expect(await readFile(join(发布目录, "SKILL.md"), "utf8")).toBe("v2")

    // 8. 重新上线：作者即可（write 语义），发布时间刷新
    const 上线 = await 走({ action: "bring_online", viewer: 作者, grants: [], now: 4_001 })
    expect(上线.status).toBe("published")
    expect(上线.publishedAt).toBe(4_001)
    expect(await readFile(join(发布目录, "SKILL.md"), "utf8")).toBe("v2")

    // 9. 归档：目录进 archive，终态
    const 归档 = await 走({ action: "archive", viewer: 系统管理员, grants: 管, now: 5_000 })
    expect(归档.status).toBe("archived")
    expect(归档.archivedAt).toBe(5_000)
    expect(归档.version).toBe(2)
    expect(await exists(发布目录)).toBe(false)
    expect(await readFile(join(archiveDirectory(root, "asset_1"), "SKILL.md"), "utf8")).toBe("v2")
    expect(allowedSkillActions("archived")).toEqual([])

    // 10. 终态不可再流转，且失败不改库
    expect(
      await 异步错误码(() => 走({ action: "bring_online", viewer: 系统管理员, grants: 管, now: 5_001 })),
    ).toBe("invalid_source")
    expect(await assetById(db, "asset_1")).toEqual(归档)
    expect(await 目录快照(root)).toEqual([
      `archive/asset_1/SKILL.md:v2`,
      `archive/asset_1/references/notes.txt:v2-notes`,
    ])
  })
})

// ---------------------------------------------------------------------------
// ② 两道关分离
// ---------------------------------------------------------------------------

describe("SC-002 验收 · 审核两道关分离（T016）", () => {
  test("身份 → 权限口径：由 effectivePermissions 派生，与矩阵使用的期望集一致", () => {
    for (const 人 of 身份们) {
      const 实得 = [...effectivePermissions(人.viewer, metadata(), 人.grants)].sort()
      expect(实得, `${人.名} 的权限集与验收口径不一致`).toEqual([...人.perms].sort())
    }
  })

  test("全矩阵：7 状态 × 9 动作 × 6 类身份，逐格与转移表 + 权限映射对账", () => {
    for (const status of ASSET_STATUSES) {
      const 资产 = metadata({ status })
      for (const action of SKILL_ACTIONS) {
        const 规格 = 验收转移表[action]
        for (const 人 of 身份们) {
          const 标签 = `${人.名} @ ${status} → ${action}`
          const 可担任 = 规格.roles.find((role) => 人.perms.includes(角色所需权限[role]))

          if (可担任 === undefined) {
            // 与 `transitionAsset` 同序：**先判权限，再判源状态**。权限不够时，
            // 即便源状态也不对，也要报 actor_not_allowed（不让调用方靠错误码试探状态）。
            // 「权限门在副作用之前」的实调证据在下面第三条（真库 + 真文件）里。
            expect(同步错误码(() => authorizeTransition(人.viewer, 资产, 人.grants, action)), 标签).toBe(
              "actor_not_allowed",
            )
            continue
          }

          expect(authorizeTransition(人.viewer, 资产, 人.grants, action), 标签).toBe(可担任)

          if (!(规格.from as readonly AssetStatus[]).includes(status)) {
            expect(
              同步错误码(() => applySkillTransition(status, action, { actor: 可担任, reason: "验收用例理由" })),
              标签,
            ).toBe("invalid_source")
            continue
          }

          const 应用 = applySkillTransition(status, action, { actor: 可担任, reason: "验收用例理由" })
          expect(应用.to, 标签).toBe(规格.to)
        }
      }
    }
  })

  test("拒绝发生在任何副作用之前：越权 / 非法源状态都不改库、不动文件、不发通知", async () => {
    const db = await freshDb()
    const root = tempRoot()

    const 资产们: AssetMetadata[] = [
      metadata({ id: "asset_review", status: "in_review" }),
      metadata({ id: "asset_pending", status: "pending_tech" }),
      metadata({ id: "asset_live", status: "published", version: 2, publishedAt: 1_500 }),
    ]
    for (const 资产 of 资产们) await insertAsset(db, 资产)

    // 三份资产各自的真实文件（目录位置按状态算；用实现的 `assetLocation` 摆夹具，
    // 断言的仍是「前后不变」，不是路径字面量）
    for (const 资产 of 资产们) {
      const 目录 = assetLocation(root, 资产)
      if (目录 === undefined) throw new Error(`${资产.id} 有状态却没有目录`)
      await mkdir(目录, { recursive: true })
      await writeFile(join(目录, "SKILL.md"), `${资产.id}-内容`)
    }

    const 作者 = { userId: "u1", department: "经侦支队" }
    const 评审人 = { userId: "u2", department: "法制支队" }
    const 管理员 = { userId: "u3", department: "科信支队" }
    const 外人 = { userId: "u9", department: "刑侦支队" }
    const 审 = (id: string) => [授权(id, "review")]
    const 管 = (id: string) => [授权(id, "admin")]
    const 跑 = (input: {
      assetId: string
      action: SkillAction
      viewer: AssetViewer
      grants: readonly GrantRow[]
      sourceDirectory?: string
    }) =>
      transitionAsset({
        db,
        root,
        assetId: input.assetId,
        action: input.action,
        viewer: input.viewer,
        grants: [...input.grants],
        now: 9_000,
        ...(input.sourceDirectory === undefined ? {} : { sourceDirectory: input.sourceDirectory }),
      })

    // 顺序跑：PGlite 是一条连接，并发发同一条预处理语句会撞 `42P05`
    const 库快照: (AssetMetadata | undefined)[] = []
    for (const 资产 of 资产们) 库快照.push(await assetById(db, 资产.id))
    const 文件快照 = await 目录快照(root)

    const 越权 = [
      { 名: "作者自审", run: () => 跑({ assetId: "asset_review", action: "approve_business", viewer: 作者, grants: [] }) },
      { 名: "业务管理员发布", run: () => 跑({ assetId: "asset_pending", action: "publish_tech", viewer: 评审人, grants: 审("asset_pending") }) },
      { 名: "管理员业务审核", run: () => 跑({ assetId: "asset_review", action: "approve_business", viewer: 管理员, grants: 管("asset_review") }) },
      { 名: "外人下线", run: () => 跑({ assetId: "asset_live", action: "take_offline", viewer: 外人, grants: [] }) },
      // 权限不够时，缺源目录这件事根本不该被报告出来（权限门在文件操作之前）
      { 名: "评审人发起迭代（不给源目录）", run: () => 跑({ assetId: "asset_live", action: "start_iteration", viewer: 评审人, grants: 审("asset_live") }) },
    ]
    for (const 项 of 越权) {
      expect(await 异步错误码(项.run), 项.名).toBe("actor_not_allowed")
    }

    // 权限够但源状态不对：也不碰副作用
    expect(
      await 异步错误码(() =>
        跑({ assetId: "asset_live", action: "publish_tech", viewer: 管理员, grants: 管("asset_live") }),
      ),
    ).toBe("invalid_source")

    const 事后库快照: (AssetMetadata | undefined)[] = []
    for (const 资产 of 资产们) 事后库快照.push(await assetById(db, 资产.id))
    expect(事后库快照).toEqual(库快照)
    expect(await 目录快照(root)).toEqual(文件快照)

    const [通知] = rowsOf(await db.execute(sql`select count(*)::int as count from auth.asset_notification`))
    expect(通知?.count).toBe(0)
  })
})
