import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { migrate } from "@opencode-ai/auth/migrate"
import { pgErrorCode } from "@opencode-ai/auth/pg-errors"
import { startProductionDb, type ProductionDb } from "@opencode-ai/auth/test-support"
import { assetById, insertAsset } from "./asset"
import type { AssetMetadata } from "./metadata"
import { assetLocation, discardAsset, storeAsset } from "./service"
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
