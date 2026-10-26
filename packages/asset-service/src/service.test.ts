import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql, type SQL } from "drizzle-orm"
import { migrate, rowsOf } from "@opencode-ai/auth/migrate"
import { pgErrorCode } from "@opencode-ai/auth/pg-errors"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { assetById, insertAsset, type AssetTarget } from "./asset"
import { AssetTransitionError } from "./lifecycle"
import type { AssetMetadata } from "./metadata"
import { AssetNotificationError } from "./notify"
import { assetLocation, discardAsset, storeAsset, transitionAsset } from "./service"
import { archiveDirectory, pendingDirectory, publishDirectory } from "./storage"

/**
 * 009 T003 · 资产服务编排（metadata + storage）。
 *
 * 这里测的是**两套存储之间的一致性**：先复制文件、再写元数据，写库失败时要把复制出来的
 * 目录清掉；删除时先删元数据、再删文件。两条顺序都不是随手定的，理由见 `service.ts`。
 */

const databases: ProductionDb[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  await Promise.all(databases.splice(0).map((database) => database.stop()))
})

function tempRoot(): string {
  const root = join(tmpdir(), `openhive-asset-service-${randomUUID()}`)
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
    status: "in_review",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    publishedAt: null,
    archivedAt: null,
    ...overrides,
  }
}

/**
 * 期望抛错的一次调用，**保留原始错误**：SQLSTATE 由 `pgErrorCode` 从 drizzle 的包壳里取，
 * 测试不自己再写一份「code / errno」的判定（两种驱动的形状不同，见 auth 的 `pg-errors.ts`）。
 */
async function failure(run: () => Promise<unknown>): Promise<Error> {
  const caught = await run().then(
    () => null,
    (error: unknown) => error,
  )
  if (!(caught instanceof Error)) throw new Error("期望这次调用抛错，它却成功了")
  return caught
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

describe("资产位置（assetLocation）", () => {
  test("草稿不进入共享资产根；审核中 / 待发布进 pending；发布态进发布目录；归档进 archive", () => {
    const root = tempRoot()
    const base = metadata()

    expect(assetLocation(root, { ...base, status: "draft" })).toBeUndefined()
    expect(assetLocation(root, { ...base, status: "in_review" })).toBe(pendingDirectory(root, base.id))
    expect(assetLocation(root, { ...base, status: "pending_tech" })).toBe(pendingDirectory(root, base.id))
    expect(assetLocation(root, { ...base, status: "published" })).toBe(
      publishDirectory(root, base.type, { visibility: base.visibility, department: base.department }, base.id),
    )
    expect(assetLocation(root, { ...base, status: "iterating" })).toBe(
      publishDirectory(root, base.type, { visibility: base.visibility, department: base.department }, base.id),
    )
    expect(assetLocation(root, { ...base, status: "offline" })).toBe(
      publishDirectory(root, base.type, { visibility: base.visibility, department: base.department }, base.id),
    )
    expect(assetLocation(root, { ...base, status: "archived" })).toBe(archiveDirectory(root, base.id))
  })

  test("个人资产可以存在于元数据里，但没有共享发布目录", () => {
    const root = tempRoot()
    expect(() => assetLocation(root, metadata({ status: "published", visibility: "personal" }))).toThrow(
      "个人资产不发布",
    )
  })
})

describe("storeAsset · 提交 / 复制", () => {
  test("提交：文件复制到目标目录，元数据同时落库", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "原始 skill")
    const target = pendingDirectory(root, "asset_1")

    const stored = await storeAsset({ db, root, metadata: metadata(), sourceDirectory: source, targetDirectory: target })

    expect(stored.id).toBe("asset_1")
    expect(await assetById(db, "asset_1")).toEqual(metadata())
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("原始 skill")
    expect(await readFile(join(target, "references", "notes.txt"), "utf8")).toBe("原始 skill-notes")
  })

  test("复制：以已有目录为源、新 id 为目标，两份资产都完整", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "可复制的 skill")
    const firstTarget = pendingDirectory(root, "asset_1")
    await storeAsset({ db, root, metadata: metadata(), sourceDirectory: source, targetDirectory: firstTarget })

    const copy = metadata({ id: "asset_2", name: "资金流水分析（副本）", createdAt: 2_000, updatedAt: 2_000 })
    const secondTarget = pendingDirectory(root, "asset_2")
    await storeAsset({ db, root, metadata: copy, sourceDirectory: firstTarget, targetDirectory: secondTarget })

    expect(await assetById(db, "asset_1")).toEqual(metadata())
    expect(await assetById(db, "asset_2")).toEqual(copy)
    expect(await readFile(join(secondTarget, "SKILL.md"), "utf8")).toBe("可复制的 skill")
  })

  test("写库失败要补偿：复制出来的目标目录被清掉，旧数据不动", async () => {
    const db = await freshDb()
    const root = tempRoot()
    await insertAsset(db, metadata())

    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "会失败的新版本")
    const target = pendingDirectory(root, "asset_2")

    const error = await failure(() =>
      storeAsset({ db, root, metadata: metadata({ id: "asset_1" }), sourceDirectory: source, targetDirectory: target }),
    )

    expect(pgErrorCode(error)).toBe("23505")
    expect(await exists(target)).toBe(false)
    expect(await assetById(db, "asset_1")).toEqual(metadata())
  })

  test("不合法的元数据不复制文件、不写库", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "不该被复制")
    const target = pendingDirectory(root, "asset_1")

    const error = await failure(() =>
      storeAsset({
        db,
        root,
        metadata: metadata({ name: "" }),
        sourceDirectory: source,
        targetDirectory: target,
      }),
    )

    expect(error.message).toContain("资产元数据不合法")
    expect(await exists(target)).toBe(false)
    expect(await assetById(db, "asset_1")).toBeUndefined()
  })

  test("目标目录必须位于资产根内：越界路径在复制前就被拒绝", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "越界")

    const error = await failure(() =>
      storeAsset({
        db,
        root,
        metadata: metadata(),
        sourceDirectory: source,
        targetDirectory: join(root, "..", "escape"),
      }),
    )

    expect(error.message).toContain("不在资产根")
    expect(await assetById(db, "asset_1")).toBeUndefined()
  })

  test("目标已存在：报错、不写库、旧目标保持原样", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "新内容")
    const target = pendingDirectory(root, "asset_1")
    await mkdir(target, { recursive: true })
    await writeFile(join(target, "SKILL.md"), "旧内容")

    const error = await failure(() =>
      storeAsset({ db, root, metadata: metadata(), sourceDirectory: source, targetDirectory: target }),
    )

    expect(error.message).toContain("目标目录已存在")
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("旧内容")
    expect(await assetById(db, "asset_1")).toBeUndefined()
  })
})

describe("transitionAsset · 生命周期流转（T008）", () => {
  /**
   * T009 起，流转入口只收「我是谁」+ 授权行，角色由 `authorizeTransition()` 派生。
   * 这几条授权是**显式传入**的：既让用例专注于流转本身，也让 `raceOnUpdate` 的
   * `execute` 计数保持「第 2 次 = 生命周期 update」（不额外插一条 `grantsFor` 查询）。
   */
  const 作者 = { userId: "u1", department: "经侦支队" }
  const 业务管理员 = { userId: "u2", department: "法制支队" }
  const 系统管理员 = { userId: "u3", department: "科信支队" }
  const 审 = [{ resourceType: "skill", resourceId: "asset_1", perm: "review" }]
  const 管 = [{ resourceType: "skill", resourceId: "asset_1", perm: "admin" }]

  const 发布目录 = (root: string) =>
    publishDirectory(root, "skill", { visibility: "department", department: "经侦支队" }, "asset_1")
  const 待审目录 = (root: string) => pendingDirectory(root, "asset_1")

  function codeOf(error: Error): string | undefined {
    return error instanceof AssetTransitionError ? error.code : undefined
  }

  async function seedSkill(
    db: ProductionDb["db"],
    overrides: Partial<AssetMetadata> = {},
  ): Promise<void> {
    await insertAsset(db, metadata({ status: "draft", ...overrides }))
  }

  /** 走真实主路径到「已发布」，各步时间戳固定。 */
  async function publishToV1(db: ProductionDb["db"], root: string, source: string): Promise<void> {
    await seedSkill(db)
    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "submit_review",
      viewer: 作者,
      grants: [],
      sourceDirectory: source,
      now: 2_000,
    })
    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "approve_business",
      viewer: 业务管理员,
      grants: 审,
      now: 2_001,
    })
    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "publish_tech",
      viewer: 系统管理员,
      grants: 管,
      now: 2_002,
    })
  }

  /**
   * 让第 2 次 `execute`（= 生命周期 update）之前先有别人改掉状态。
   *
   * 不 mock 数据库：它仍走真 PG，只是把「并发写入先落地」这件确定的事排在 update 前面，
   * 于是条件更新命中 0 行——这正是并发时唯一能观察到的真实形态（`#005-13`）。
   */
  async function raceOnUpdate(real: AssetTarget, before: SQL): Promise<AssetTarget> {
    let calls = 0
    return {
      execute(query) {
        calls += 1
        if (calls !== 2) return real.execute(query)
        return Promise.resolve(real.execute(before)).then(() => real.execute(query))
      },
    }
  }

  test("主路径：提交 → 业务通过 → 技术发布，文件随状态迁移", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await seedSkill(db)

    const submitted = await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "submit_review",
      viewer: 作者,
      grants: [],
      sourceDirectory: source,
      now: 2_000,
    })
    expect(submitted.status).toBe("in_review")
    expect(submitted.updatedAt).toBe(2_000)
    expect(await readFile(join(待审目录(root), "SKILL.md"), "utf8")).toBe("v1")

    const approved = await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "approve_business",
      viewer: 业务管理员,
      grants: 审,
      now: 2_001,
    })
    expect(approved.status).toBe("pending_tech")
    expect(await readFile(join(待审目录(root), "SKILL.md"), "utf8")).toBe("v1")

    const published = await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "publish_tech",
      viewer: 系统管理员,
      grants: 管,
      now: 2_002,
    })
    expect(published.status).toBe("published")
    expect(published.publishedAt).toBe(2_002)
    expect(await exists(待审目录(root))).toBe(false)
    expect(await readFile(join(发布目录(root), "SKILL.md"), "utf8")).toBe("v1")
  })

  test("驳回回草稿：必须带理由，已提交的文件留在 pending 等下次覆盖", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await seedSkill(db)
    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "submit_review",
      viewer: 作者,
      grants: [],
      sourceDirectory: source,
      now: 2_000,
    })

    const missingReason = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "reject_business",
        viewer: 业务管理员,
        grants: 审,
        reason: "   ",
        now: 2_001,
      }),
    )
    expect(codeOf(missingReason)).toBe("reason_required")
    expect((await assetById(db, "asset_1"))?.status).toBe("in_review")

    const rejected = await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "reject_business",
      viewer: 业务管理员,
      grants: 审,
      reason: "只适用于本专案，不可泛化",
      now: 2_002,
    })
    expect(rejected.status).toBe("draft")
    expect(await readFile(join(待审目录(root), "SKILL.md"), "utf8")).toBe("v1")
  })

  test("迭代：版本 +1、旧版继续可用；新版本发布后替换旧版", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await publishToV1(db, root, source)

    await writeSkill(source, "v2")
    const iterating = await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "start_iteration",
      viewer: 作者,
      grants: [],
      sourceDirectory: source,
      now: 3_000,
    })
    expect(iterating.status).toBe("iterating")
    expect(iterating.version).toBe(2)
    expect(iterating.publishedAt).toBe(2_002)
    expect(await readFile(join(发布目录(root), "SKILL.md"), "utf8")).toBe("v1")
    expect(await readFile(join(待审目录(root), "SKILL.md"), "utf8")).toBe("v2")

    const republished = await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "publish_iteration",
      viewer: 系统管理员,
      grants: 管,
      now: 3_001,
    })
    expect(republished.status).toBe("published")
    expect(republished.version).toBe(2)
    expect(republished.publishedAt).toBe(3_001)
    expect(await exists(待审目录(root))).toBe(false)
    expect(await readFile(join(发布目录(root), "SKILL.md"), "utf8")).toBe("v2")
  })

  test("下线只改状态、不搬目录；重新上线刷新发布时间", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await publishToV1(db, root, source)

    const offline = await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "take_offline",
      viewer: 系统管理员,
      grants: 管,
      now: 4_000,
    })
    expect(offline.status).toBe("offline")
    expect(offline.publishedAt).toBe(2_002)
    expect(await readFile(join(发布目录(root), "SKILL.md"), "utf8")).toBe("v1")

    const online = await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "bring_online",
      viewer: 系统管理员,
      grants: 管,
      now: 4_001,
    })
    expect(online.status).toBe("published")
    expect(online.publishedAt).toBe(4_001)
    expect(await readFile(join(发布目录(root), "SKILL.md"), "utf8")).toBe("v1")
  })

  test("归档：目录移到 archive，终态不能再流转", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await publishToV1(db, root, source)

    const archived = await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "archive",
      viewer: 系统管理员,
      grants: 管,
      now: 5_000,
    })
    expect(archived.status).toBe("archived")
    expect(archived.archivedAt).toBe(5_000)
    expect(await exists(发布目录(root))).toBe(false)
    expect(await readFile(join(archiveDirectory(root, "asset_1"), "SKILL.md"), "utf8")).toBe("v1")

    const again = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "take_offline",
        viewer: 系统管理员,
        grants: 管,
        now: 5_001,
      }),
    )
    expect(codeOf(again)).toBe("invalid_source")
    expect(await assetById(db, "asset_1")).toEqual(archived)
  })

  test("越权 / 非法源状态：元数据与文件都不动", async () => {
    const db = await freshDb()
    const root = tempRoot()
    await seedSkill(db, { status: "in_review" })
    await mkdir(待审目录(root), { recursive: true })
    await writeFile(join(待审目录(root), "SKILL.md"), "审核中")

    const unauthorized = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "approve_business",
        viewer: 作者,
        grants: [],
        now: 2_000,
      }),
    )
    expect(codeOf(unauthorized)).toBe("actor_not_allowed")

    const invalidSource = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "publish_tech",
        viewer: 系统管理员,
        grants: 管,
        now: 2_001,
      }),
    )
    expect(codeOf(invalidSource)).toBe("invalid_source")

    expect((await assetById(db, "asset_1"))?.status).toBe("in_review")
    expect(await readFile(join(待审目录(root), "SKILL.md"), "utf8")).toBe("审核中")
  })

  test("提交与发起迭代必须给源目录：缺了先报错，不碰库也不建目录", async () => {
    const db = await freshDb()
    const root = tempRoot()
    await seedSkill(db)

    const missing = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "submit_review",
        viewer: 作者,
        grants: [],
        now: 2_000,
      }),
    )
    expect(codeOf(missing)).toBe("source_directory_required")
    expect((await assetById(db, "asset_1"))?.status).toBe("draft")
    expect(await exists(待审目录(root))).toBe(false)
  })

  test("MCP / 知识库不走 Skill 7 状态机", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "mcp 配置")
    await seedSkill(db, { type: "mcp" })

    const error = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "submit_review",
        viewer: 作者,
        grants: [],
        sourceDirectory: source,
        now: 2_000,
      }),
    )
    expect(codeOf(error)).toBe("unsupported_asset_type")
    expect((await assetById(db, "asset_1"))?.status).toBe("draft")
    expect(await exists(待审目录(root))).toBe(false)
  })

  test("个人可见范围的资产发布：给领域错误码，不漏出存储层的裸 Error（出口才能翻成 409）", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await seedSkill(db, { visibility: "personal" })

    // 提交与业务审核都不碰共享目录，「个人」资产能一路走到「待技术发布」——这条路径现实中可达。
    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "submit_review",
      viewer: 作者,
      grants: [],
      sourceDirectory: source,
      now: 2_000,
    })
    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "approve_business",
      viewer: 业务管理员,
      grants: 审,
      now: 2_001,
    })

    const error = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "publish_tech",
        viewer: 系统管理员,
        grants: 管,
        now: 2_002,
      }),
    )
    // 裸 Error 没有 code ⇒ HTTP 出口认不出 ⇒ 500（010 真栈实得）。业务前提必须带 code。
    expect(codeOf(error)).toBe("personal_asset_not_shared")
    expect(error.message).toContain("个人资产")

    // 拒绝发生在写库与搬文件之前：状态与待审目录都保持原样。
    expect((await assetById(db, "asset_1"))?.status).toBe("pending_tech")
    expect(await readFile(join(待审目录(root), "SKILL.md"), "utf8")).toBe("v1")
  })

  test("并发改状态：条件更新落空 ⇒ 复制出来的文件被收回，别人的状态不被覆盖", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await seedSkill(db)

    const racing = await raceOnUpdate(db, sql`update auth.asset set status = 'offline' where id = 'asset_1'`)
    const error = await failure(() =>
      transitionAsset({
        db: racing,
        root,
        assetId: "asset_1",
        action: "submit_review",
        viewer: 作者,
        grants: [],
        sourceDirectory: source,
        now: 2_000,
      }),
    )

    expect(codeOf(error)).toBe("concurrent_transition")
    expect(await exists(待审目录(root))).toBe(false)
    expect((await assetById(db, "asset_1"))?.status).toBe("offline")
  })

  test("迭代发布时并发改状态：旧版本与新版 pending 一起回滚", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await publishToV1(db, root, source)
    await writeSkill(source, "v2")
    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "start_iteration",
      viewer: 作者,
      grants: [],
      sourceDirectory: source,
      now: 3_000,
    })

    const racing = await raceOnUpdate(db, sql`update auth.asset set status = 'offline' where id = 'asset_1'`)
    const error = await failure(() =>
      transitionAsset({
        db: racing,
        root,
        assetId: "asset_1",
        action: "publish_iteration",
        viewer: 系统管理员,
        grants: 管,
        now: 3_001,
      }),
    )

    expect(codeOf(error)).toBe("concurrent_transition")
    expect(await readFile(join(发布目录(root), "SKILL.md"), "utf8")).toBe("v1")
    expect(await readFile(join(待审目录(root), "SKILL.md"), "utf8")).toBe("v2")
    expect((await assetById(db, "asset_1"))?.status).toBe("offline")
  })

  test("并发写者已完成同一流转：条件更新落空不回滚目标目录（不搬走别人的结果）", async () => {
    const db = await freshDb()
    const root = tempRoot()
    await seedSkill(db, { status: "pending_tech" })
    await mkdir(待审目录(root), { recursive: true })
    await writeFile(join(待审目录(root), "SKILL.md"), "v1")

    // 模拟真并发：另一个写者已把**同一流转**落库（状态已是本调用的目标态），
    // 本调用的条件更新因此落空。真 PG 上这条路径另有 `real-pg.test.ts` 守（两条真连接）。
    const racing = await raceOnUpdate(db, sql`update auth.asset set status = 'published' where id = 'asset_1'`)
    const error = await failure(() =>
      transitionAsset({
        db: racing,
        root,
        assetId: "asset_1",
        action: "publish_tech",
        viewer: 系统管理员,
        grants: 管,
        now: 2_000,
      }),
    )

    expect(codeOf(error)).toBe("concurrent_transition")
    // 关键：本调用搬过去的文件不能被「回滚」搬回 pending——那等于抹掉并发写者已提交的结果
    // （真栈实测：Windows 上两条并发 rename 都回成功，输家以为自己搬了、其实没有）。
    expect(await readFile(join(发布目录(root), "SKILL.md"), "utf8")).toBe("v1")
    expect(await exists(待审目录(root))).toBe(false)
    expect((await assetById(db, "asset_1"))?.status).toBe("published")
  })

  test("待发布目录已被并发搬走：抛 invalid_source，不把 fs 异常原样抛给调用方", async () => {
    const db = await freshDb()
    const root = tempRoot()
    await seedSkill(db, { status: "pending_tech" })
    // 故意不建 pending 目录：它已被另一次并发流转搬进了发布目录。

    const error = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "publish_tech",
        viewer: 系统管理员,
        grants: 管,
        now: 2_000,
      }),
    )

    expect(codeOf(error)).toBe("invalid_source")
    expect((await assetById(db, "asset_1"))?.status).toBe("pending_tech")
  })

  test("两道关分离：作者不能自审，业务管理员不能发布，系统管理员不能业务审核", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await seedSkill(db)
    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "submit_review",
      viewer: 作者,
      grants: [],
      sourceDirectory: source,
      now: 2_000,
    })

    // 第一道关：作者（write）过不了业务审核。
    const selfReview = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "approve_business",
        viewer: 作者,
        grants: [],
        now: 2_001,
      }),
    )
    expect(codeOf(selfReview)).toBe("actor_not_allowed")
    expect((await assetById(db, "asset_1"))?.status).toBe("in_review")

    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "approve_business",
      viewer: 业务管理员,
      grants: 审,
      now: 2_002,
    })

    // 第二道关：审内容的人不能发布（admin 不蕴含 review 的镜像）。
    const reviewerPublish = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "publish_tech",
        viewer: 业务管理员,
        grants: 审,
        now: 2_003,
      }),
    )
    expect(codeOf(reviewerPublish)).toBe("actor_not_allowed")
    expect((await assetById(db, "asset_1"))?.status).toBe("pending_tech")
    expect(await readFile(join(待审目录(root), "SKILL.md"), "utf8")).toBe("v1")

    // 管理的人不能回头补业务审核；授权先于状态判定，错误码不是 invalid_source。
    const adminReview = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "approve_business",
        viewer: 系统管理员,
        grants: 管,
        now: 2_004,
      }),
    )
    expect(codeOf(adminReview)).toBe("actor_not_allowed")
    expect((await assetById(db, "asset_1"))?.status).toBe("pending_tech")

    const published = await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "publish_tech",
      viewer: 系统管理员,
      grants: 管,
      now: 2_005,
    })
    expect(published.status).toBe("published")
    expect(await readFile(join(发布目录(root), "SKILL.md"), "utf8")).toBe("v1")
  })

  test("省略 grants 时从真库取授权（grantsFor 接线）：组授权 review 即可过业务关", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await seedSkill(db)

    await db.execute(sql`
      insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
      values ('u2', '010002', '乙民警', 'x', 'x', 'x', '法制支队', 'x', 0, 'h', 0)
    `)
    await db.execute(sql`insert into auth.role (id, name, role_type) values ('g_review', '业务审核组', 'group')`)
    await db.execute(sql`insert into auth.user_role (user_id, role_id) values ('u2', 'g_review')`)
    await db.execute(sql`
      insert into auth.role_resource (role_id, resource_type, resource_id, perm)
      values ('g_review', 'skill', 'asset_1', 'review')
    `)

    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "submit_review",
      viewer: 作者,
      grants: [],
      sourceDirectory: source,
      now: 2_000,
    })

    const approved = await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "approve_business",
      viewer: 业务管理员,
      now: 2_001,
    })
    expect(approved.status).toBe("pending_tech")

    // 同一条路径对没有授权的用户仍要拦住（取到的空授权不能变成放行）。
    const stranger = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "publish_tech",
        viewer: { userId: "u9", department: "经侦支队" },
        now: 2_002,
      }),
    )
    expect(codeOf(stranger)).toBe("actor_not_allowed")
    expect((await assetById(db, "asset_1"))?.status).toBe("pending_tech")
  })

  test("没有任何权限的人不能提交别人的草稿：授权判定在搬文件之前", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "越权提交")
    await seedSkill(db)

    const stranger = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "submit_review",
        viewer: { userId: "u9", department: "经侦支队" },
        grants: [],
        sourceDirectory: source,
        now: 2_000,
      }),
    )

    expect(codeOf(stranger)).toBe("actor_not_allowed")
    expect((await assetById(db, "asset_1"))?.status).toBe("draft")
    expect(await exists(待审目录(root))).toBe(false)
  })

  test("状态变化通知到人（T010）：提交通知审核人，通过通知作者 + 管理员，发布通知作者", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "v1")
    await seedSkill(db)

    for (const [id, name, dept] of [
      ["u2", "乙民警", "法制支队"],
      ["u3", "丙民警", "科信支队"],
    ] as const) {
      await db.execute(sql`
        insert into auth.user (id, police_no, name, id_card, phone, org, dept, section, status, password_hash, created_at)
        values (${id}, ${`0100${id.slice(1)}`}, ${name}, 'x', 'x', 'x', ${dept}, 'x', 0, 'h', 0)
      `)
    }
    for (const [roleId, userId, perm] of [
      ["g_review", "u2", "review"],
      ["g_admin", "u3", "admin"],
    ] as const) {
      await db.execute(sql`insert into auth.role (id, name, role_type) values (${roleId}, ${roleId}, 'group')`)
      await db.execute(sql`insert into auth.user_role (user_id, role_id) values (${userId}, ${roleId})`)
      await db.execute(sql`
        insert into auth.role_resource (role_id, resource_type, resource_id, perm)
        values (${roleId}, 'skill', 'asset_1', ${perm})
      `)
    }

    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "submit_review",
      viewer: 作者,
      sourceDirectory: source,
      now: 2_000,
    })
    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "approve_business",
      viewer: 业务管理员,
      now: 2_001,
    })
    await transitionAsset({
      db,
      root,
      assetId: "asset_1",
      action: "publish_tech",
      viewer: 系统管理员,
      now: 2_002,
    })

    const rows = rowsOf(
      await db.execute(sql`
        select recipient_id, action from auth.asset_notification
        order by created_at, action, recipient_id
      `),
    ).map((row) => [String(row.recipient_id), String(row.action)])

    expect(rows).toEqual([
      ["u2", "submit_review"],
      ["u1", "approve_business"],
      ["u3", "approve_business"],
      ["u1", "publish_tech"],
    ])
  })

  test("通知写库失败：流转已生效，抛 AssetNotificationError（不回滚状态）", async () => {
    const db = await freshDb()
    const root = tempRoot()
    await seedSkill(db, { status: "in_review" })
    await db.execute(sql`drop table auth.asset_notification`)

    const error = await failure(() =>
      transitionAsset({
        db,
        root,
        assetId: "asset_1",
        action: "approve_business",
        viewer: 业务管理员,
        grants: 审,
        now: 2_000,
      }),
    )

    if (!(error instanceof AssetNotificationError)) throw new Error(`期望 AssetNotificationError，得到：${error}`)
    expect(error.code).toBe("notification_failed")
    expect((await assetById(db, "asset_1"))?.status).toBe("pending_tech")
  })
})

describe("discardAsset · 删除", () => {
  test("删除已提交资产：元数据与共享目录一起消失，重复删除返回 false", async () => {
    const db = await freshDb()
    const root = tempRoot()
    const source = join(tempRoot(), "sandbox")
    await writeSkill(source, "将被删除")
    const target = pendingDirectory(root, "asset_1")
    await storeAsset({ db, root, metadata: metadata(), sourceDirectory: source, targetDirectory: target })

    expect(await discardAsset({ db, root, assetId: "asset_1" })).toBe(true)
    expect(await assetById(db, "asset_1")).toBeUndefined()
    expect(await exists(target)).toBe(false)
    expect(await discardAsset({ db, root, assetId: "asset_1" })).toBe(false)
  })

  test("删除草稿：只删元数据，不碰共享根", async () => {
    const db = await freshDb()
    const root = tempRoot()
    await insertAsset(db, metadata({ status: "draft" }))

    expect(await discardAsset({ db, root, assetId: "asset_1" })).toBe(true)
    expect(await assetById(db, "asset_1")).toBeUndefined()
  })
})
