import {
  assertValidAssetMetadata,
  assetById,
  deleteAsset,
  insertAsset,
  updateAssetLifecycle,
  type AssetTarget,
} from "./asset"
import {
  AssetTransitionError,
  applySkillTransition,
  type ActorRole,
  type AppliedSkillTransition,
  type SkillAction,
} from "./lifecycle"
import type { AssetMetadata } from "./metadata"
import {
  archiveDirectory,
  assertWithinRoot,
  copyDirectory,
  pendingDirectory,
  publishDirectory,
  removeDirectory,
  replaceDirectory,
} from "./storage"

/**
 * 资产服务编排（009 T003，FR-001）：「元数据」与「`/assets` 文件」两套存储之间的一致性。
 *
 * 两套存储没有共同事务，所以顺序不是随手定的：
 *
 * - **写入**：校验 → 复制文件 → 写元数据 → 写库失败时补偿删除复制出来的文件。
 *   反过来的顺序（先写库再复制）在复制失败时会留下「元数据指向不存在的文件」——
 *   前端点开资产 404，而库里看着一切正常。
 * - **删除**：先删元数据，再删文件。反过来的顺序在删库失败时会留下「元数据指向已被删掉
 *   的文件」。两份都不理想，但**孤儿文件**（可清理、不影响读）比**坏元数据**（对外可见、
 *   每个读者都撞上）轻。
 *
 * ⚠️ **没有做跨存储的自动对账**：中途崩溃（复制成功、进程在写库前退出）仍会留下孤儿目录。
 * 这是设计已知的残差，记录在 `state.md` 的缺口表；对账脚本等 T005 有投影出口后再接。
 */

/**
 * 资产在共享根里的位置；`undefined` 表示**不落共享根**（草稿还在作者沙箱）。
 *
 * 状态到目录的映射与 design §2.5 一致：
 * - `in_review` / `pending_tech` → `pending/{assetId}`
 * - `published` / `iterating` / `offline` → `global|dept/…/{assetId}`（下线不搬目录，旧版仍可见）
 * - `archived` → `archive/{assetId}`
 *
 * ⚠️ **个人资产没有共享发布目录**，`publishDirectory` 会抛错。调用方传进来之前应当先判断
 * 可见范围；这里保留抛错，而不是返回 `undefined`——「个人资产已发布」是元数据与存储约定
 * 不一致的信号，静默当作「不在共享根」会把问题藏起来。
 */
export function assetLocation(root: string, metadata: AssetMetadata): string | undefined {
  switch (metadata.status) {
    case "draft":
      return undefined
    case "in_review":
    case "pending_tech":
      return pendingDirectory(root, metadata.id)
    case "published":
    case "iterating":
    case "offline":
      return publishDirectory(
        root,
        metadata.type,
        { visibility: metadata.visibility, department: metadata.department },
        metadata.id,
      )
    case "archived":
      return archiveDirectory(root, metadata.id)
    default: {
      const status: never = metadata.status
      throw new Error(`未知资产状态：${String(status)}`)
    }
  }
}

export interface StoreAssetInput {
  readonly db: AssetTarget
  readonly root: string
  readonly metadata: AssetMetadata
  /** 源目录（作者沙箱里的成果，或另一份已入库资产）。 */
  readonly sourceDirectory: string
  /** 目标目录；必须位于资产根内。由调用方按 `assetLocation` 算好。 */
  readonly targetDirectory: string
}

/**
 * 提交 / 复制一份资产：文件复制进共享根，再写元数据。
 *
 * 失败顺序与补偿：
 * 1. 元数据不合法 ⇒ 抛 `AssetMetadataError`，**文件一个都不复制**；
 * 2. 目标目录越界 ⇒ 抛「不在资产根」，不复制；
 * 3. 目标已存在 ⇒ 抛「目标目录已存在」，旧内容不动（不静默覆盖）；
 * 4. 写库失败 ⇒ 删掉本次复制出来的目标目录，再把原始错误抛出去。
 *
 * ⚠️ **补偿失败会抛 `AggregateError`**：既保留写库的原始错误，又不静默吞掉清理失败。
 * 宁可能看到「两条都失败」，也不要把「文件留下了」藏起来。
 *
 * ⚠️ **不校验目标目录是否等于 `assetLocation`**：本函数只保证「目标在根内」，位置语义
 * 由调用方（T008 的生命周期流转）负责。放在这里校验就等于把状态机再写一遍。
 */
export async function storeAsset(input: StoreAssetInput): Promise<AssetMetadata> {
  const { db, root, metadata, sourceDirectory, targetDirectory } = input

  assertValidAssetMetadata(metadata)
  assertWithinRoot(root, targetDirectory, "目标目录")

  await copyDirectory(sourceDirectory, targetDirectory)

  try {
    await insertAsset(db, metadata)
  } catch (error) {
    try {
      await removeDirectory(root, targetDirectory)
    } catch (cleanupError) {
      // oxlint-disable-next-line preserve-caught-error -- 第三个参数已带 `cause`；规则只认「二参 + cause」写法（实测 oxlint 1.60）。
      throw new AggregateError(
        [error, cleanupError],
        `资产 ${metadata.id} 写库失败，且已复制的目录未能清理：${targetDirectory}`,
        { cause: error },
      )
    }
    throw error
  }

  return metadata
}

export interface DiscardAssetInput {
  readonly db: AssetTarget
  readonly root: string
  readonly assetId: string
}

/**
 * 删除一份资产：先删元数据，再删共享目录。返回「是否真的删掉了元数据」。
 *
 * 为什么先读后删：位置要从元数据算（类型 / 可见范围 / 状态），删完就读不到了。
 * 读到的快照只用来**算路径**，删除是否成功以 `deleteAsset` 的返回值为准——
 * 并发下别人先删掉时这里返回 `false`，且不会再动文件（避免删掉别人刚建的新资产目录）。
 *
 * ⚠️ **个人资产只删元数据**：个人资产的文件在作者沙箱，不属于共享根。这不是「跳过」，
 * 是存储约定的定义（`storage.ts` 的 `publishDirectory` 同样拒绝个人资产）。
 *
 * ⚠️ **文件删除失败会抛错**（此时元数据已删掉）：这是方向选择的残差——重试
 * `discardAsset` 会因元数据不在而返回 `false`，孤儿目录仍在。记录在 `state.md`。
 */
export async function discardAsset(input: DiscardAssetInput): Promise<boolean> {
  const { db, root, assetId } = input

  const metadata = await assetById(db, assetId)
  if (!metadata) return false

  const deleted = await deleteAsset(db, assetId)
  if (!deleted) return false

  if (metadata.visibility === "personal") return true

  const location = assetLocation(root, metadata)
  if (location !== undefined) await removeDirectory(root, location)

  return true
}

/** 这些动作把资产送进「可用」：发布目录已在位，发布时间刷新为本次。 */
const PUBLISHING_ACTIONS: ReadonlySet<SkillAction> = new Set([
  "publish_tech",
  "publish_iteration",
  "bring_online",
])

/** 发起迭代 = 新版本在途，版本号 +1（design §2.4）。 */
const VERSION_BUMPING_ACTIONS: ReadonlySet<SkillAction> = new Set(["start_iteration"])

export interface TransitionAssetInput {
  readonly db: AssetTarget
  readonly root: string
  readonly assetId: string
  readonly action: SkillAction
  readonly actor: ActorRole
  readonly reason?: string
  /** 提交审核 / 发起迭代的源目录（作者沙箱里的当前版本）；其他动作不需要。 */
  readonly sourceDirectory?: string
  /** Unix 秒；测试注入固定时间，生产省略取当前。 */
  readonly now?: number
}

/** 一次已落地的文件步骤；`commit` 清理备份，`rollback` 把文件退回原样。 */
interface StorageStep {
  commit?(): Promise<void>
  rollback(): Promise<void>
}

/**
 * 生命周期流转（T008 / FR-004）：状态机校验 → 文件迁移 → 元数据条件更新 → 回滚/收尾。
 *
 * ## 为什么文件先、元数据后
 *
 * 元数据是**对外可读**的那一侧：先写库再搬文件，前端会在「已发布」状态下找不到文件；
 * 先搬文件再写库，写库失败还能把文件搬回去。反过来没有任何回滚手段——库里已经是新状态，
 * 文件却是旧的。
 *
 * ## 每一步的残差
 *
 * - 复制类（提交 / 发起迭代）：写库失败 ⇒ 删掉本次复制出来的 `pending/`。源在作者沙箱，
 *   删掉不丢内容。
 * - 移动类（技术发布 / 迭代发布 / 归档）：写库失败 ⇒ 把新目录搬回源位置；迭代发布额外把
 *   旧版备份放回目标（`replaceDirectory` 保留备份到 `commit()`）。
 * - **驳回不删 `pending/`**：design §2.2 的物理动作是空，作者沙箱的源仍在；下次提交会覆盖
 *   （`replace: true`）。删掉反而多一步不可回滚的破坏性操作。
 * - **下线不搬目录**（与 design §2.2 的「移出发布目录」不同）：T003 已裁定「下线不搬目录、
 *   旧版仍可见」，可用性由 `isAssetUsable()` 判。真正的「不可用」要靠下发清单按状态过滤
 *   （T014），不能靠目录位置——否则下线资产的使用者通知点回去就是 404。
 *
 * ## 并发
 *
 * 元数据更新带 `status = 期望值` 条件。读到的状态是「发起本次流转时的现状」，条件更新落空
 * 说明期间有人改过状态 ⇒ 抛 `concurrent_transition` 并回滚文件，**不覆盖别人的结果**。
 * （`#007-01`：每步幂等 ≠ 整体可重入；这里不假装重试能收敛，只保证不把两份写入搅在一起。）
 *
 * ## 类型边界
 *
 * 7 状态机只适用于 Skill（design §2.0）；MCP / 知识库的简化生命周期未在本任务实现，
 * 显式抛 `unsupported_asset_type`，不套一张错的状态表。
 */
export async function transitionAsset(input: TransitionAssetInput): Promise<AssetMetadata> {
  const { db, root, assetId } = input

  const asset = await assetById(db, assetId)
  if (!asset) throw new AssetTransitionError("asset_not_found", `资产不存在：${assetId}`)
  if (asset.type !== "skill") {
    throw new AssetTransitionError(
      "unsupported_asset_type",
      `${asset.type} 不走 Skill 7 状态机：${assetId}`,
    )
  }

  const applied = applySkillTransition(asset.status, input.action, {
    actor: input.actor,
    reason: input.reason,
  })
  const now = input.now ?? Math.floor(Date.now() / 1000)

  const step = await prepareStorageStep(root, asset, applied, input.sourceDirectory)

  try {
    const updated = await updateAssetLifecycle(db, asset.id, {
      expectedStatus: asset.status,
      status: applied.to,
      version: VERSION_BUMPING_ACTIONS.has(applied.action) ? asset.version + 1 : asset.version,
      updatedAt: now,
      publishedAt: PUBLISHING_ACTIONS.has(applied.action) ? now : asset.publishedAt,
      archivedAt: applied.action === "archive" ? now : asset.archivedAt,
    })
    if (updated === undefined) {
      throw new AssetTransitionError(
        "concurrent_transition",
        `资产 ${asset.id} 的状态已被并发修改，未执行 ${applied.action}`,
      )
    }

    if (step?.commit !== undefined) await step.commit()
    return updated
  } catch (error) {
    if (step !== undefined) {
      try {
        await step.rollback()
      } catch (rollbackError) {
        // oxlint-disable-next-line preserve-caught-error -- 第三个参数已带 `cause`；规则只认「二参 + cause」写法（实测 oxlint 1.60）。
        throw new AggregateError(
          [error, rollbackError],
          `资产 ${asset.id} 的 ${applied.action} 失败，且文件回滚未完成`,
          { cause: error },
        )
      }
    }
    throw error
  }
}

/**
 * 按转移表里的 `storage` 落文件步骤。抛错都发生在**写库之前**——文件没搬成就不该改状态。
 */
async function prepareStorageStep(
  root: string,
  asset: AssetMetadata,
  applied: AppliedSkillTransition,
  sourceDirectory: string | undefined,
): Promise<StorageStep | undefined> {
  switch (applied.storage) {
    case "none":
      return undefined

    case "copy_to_pending": {
      if (sourceDirectory === undefined) {
        throw new AssetTransitionError(
          "source_directory_required",
          `${applied.action} 需要作者沙箱里的源目录`,
        )
      }
      const target = pendingDirectory(root, asset.id)
      assertWithinRoot(root, target, "待审目录")
      await copyDirectory(sourceDirectory, target, { replace: true })
      return { rollback: () => removeDirectory(root, target) }
    }

    case "move_pending_to_publish": {
      const source = pendingDirectory(root, asset.id)
      const target = publishDirectory(
        root,
        asset.type,
        { visibility: asset.visibility, department: asset.department },
        asset.id,
      )
      const replacement = await replaceDirectory(source, target)
      return { commit: () => replacement.commit(), rollback: () => replacement.rollback() }
    }

    case "move_publish_to_archive": {
      const source = publishDirectory(
        root,
        asset.type,
        { visibility: asset.visibility, department: asset.department },
        asset.id,
      )
      const target = archiveDirectory(root, asset.id)
      const replacement = await replaceDirectory(source, target)
      return { commit: () => replacement.commit(), rollback: () => replacement.rollback() }
    }

    default: {
      const intent: never = applied.storage
      throw new Error(`未知存储动作：${String(intent)}`)
    }
  }
}
