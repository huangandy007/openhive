import { randomUUID } from "node:crypto"
import { grantsFor, type GrantRow } from "@opencode-ai/auth/rbac"
import {
  AssetMetadataError,
  assertValidAssetMetadata,
  assetById,
  deleteAsset,
  insertAsset,
  updateAssetLifecycle,
  type AssetTarget,
} from "./asset"
import { retargetAssetLinksAcrossWorkspaces } from "./asset-link-fanout"
import type { AssetViewer } from "./authorization"
import { isEnabledCategory } from "./category-store"
import type { AssetStatus, AssetVisibility } from "./metadata"
import {
  AssetTransitionError,
  applySkillTransition,
  type AppliedSkillTransition,
  type SkillAction,
} from "./lifecycle"
import {
  getMcpConnection,
  insertMcpConnection,
  记录试连结果,
  回写发布快照,
  写入发布快照,
  连接输入,
  规范化连接,
} from "./mcp-connection"
import { probeMcpConnection, type McpProbe } from "./mcp-probe"
import type { AssetMetadata } from "./metadata"
import { AssetNotificationError, notifyAssetTransition } from "./notify"
import { linkSkill, unlinkSkill } from "./project-skill-link"
import { authorizeTransition } from "./review"
import {
  archiveDirectory,
  assertSafeSegment,
  assertWithinRoot,
  copyDirectory,
  directoryExists,
  draftDirectory,
  hasPendingContent,
  iterationWorkspaceDirectory,
  iterationWorkspaceRelative,
  MissingSourceDirectoryError,
  pendingDirectory,
  PersonalAssetDirectoryError,
  publishDirectory,
  removeDirectory,
  replaceDirectory,
  type DirectoryReplacement,
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
 * 资产在共享根里的**生命周期**目录；草稿返回 `undefined`。
 *
 * ⚠️ 草稿从需求 3a 起也可能有副本（`draftDirectory()`，`<root>/draft/<id>`），但它**不属于
 * 这一套状态目录**：状态流转从不搬它，删除也单独处理（`discardAsset`）。别把这里当成
 * 「资产有没有落盘」的唯一判据。
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

export interface CreateDraftAssetInput {
  readonly db: AssetTarget
  /** 作者档案；生产由 MCP 身份查 `auth.user` 得到，**不收调用方自报值**。 */
  readonly owner: {
    readonly id: string
    readonly name: string
    readonly department: string
  }
  readonly name: string
  readonly description: string
  /** 业务分类 id，必须在 `categories.ts` 的 seed 里。 */
  readonly category: string
  readonly tags?: readonly string[]
  /** 默认个人空间：草稿不该先对全单位可见。 */
  readonly visibility?: AssetVisibility
  readonly icon?: string
  /** 测试注入；生产省略由服务生成稳定 id。 */
  readonly id?: string
  /** Unix 秒；测试注入固定时间，生产省略取当前。 */
  readonly now?: number
  /**
   * 让草稿「在当前项目直接可用」（需求 3a，2026-10-27）：给了这一组就把源目录复制进
   * `<root>/draft/<id>`，并在 `<projectDirectory>/.opencode/skill/<id>` 建链接指向它。
   *
   * 省略 = 老行为（草稿只停在作者沙箱、共享根里没有副本）。生产路径（MCP
   * `create_skill_draft`）总是给：需求 3a 的验收是「新建草稿 → 当前项目会话可用」。
   */
  readonly storage?: {
    readonly root: string
    readonly sourceDirectory: string
    readonly projectDirectory: string
  }
}

/**
 * 建一份 Skill 草稿（009 T013，FR-008；需求 3a 起可选落盘，2026-10-27）。
 *
 * ## 为什么没有直接走 `storeAsset`
 *
 * `storeAsset` 的职责是「把来源目录复制到**调用方算好的目标目录** + 写元数据」。草稿的目标
 * 目录不是 `assetLocation` 能算出来的（草稿状态返回 `undefined`，见该函数），而且草稿还要
 * 在项目目录里建链接——两件事的顺序与补偿和提交不一样，硬套会把「链接失败」和「写库失败」
 * 混成一种残差。
 *
 * 所以这里自己编排三步：**复制到 `/draft/<id>` → 建项目链接 → 写库**；任一步失败就按相反
 * 顺序清掉已做的（清理也失败则抛 `AggregateError`，与 `storeAsset` 同一条纪律）。
 *
 * 走的仍是资产服务的**正式写入路径**：先按 `validateAssetMetadata` 校验（含业务分类字典），
 * 再 `insertAsset`。不是手拼 SQL，也不伪造作者 / 部门 / 状态；校验在复制之前，校验不过一个
 * 字节都不落盘。
 *
 * ## 不检查同名重复
 *
 * `auth.asset` 没有「同作者同名」约束，同名 skill 在不同目录下可以共存。这个函数因此
 * 每次调用都新建一行；重复调用会产生两份草稿（`state.md` 记为残差，等产品定「同名覆盖
 * 还是并存」后再加约束，不在这里猜）。
 */
export async function createDraftAsset(input: CreateDraftAssetInput): Promise<AssetMetadata> {
  // 闭集读**库**（`category-store.ts` 的 `isEnabledCategory`），不是 `categories.ts` 的常量：
  // 管理员新建的分类必须立刻合法、停用的立刻不合法（需求 4）。常量只是 seed 源。
  if (!(await isEnabledCategory(input.db, input.category))) {
    throw new AssetMetadataError([{ field: "category", message: `未知业务分类：${input.category}` }])
  }

  const now = input.now ?? Math.floor(Date.now() / 1000)
  const metadata: AssetMetadata = {
    id: input.id ?? `asset_${randomUUID()}`,
    name: input.name,
    type: "skill",
    description: input.description,
    summary: "",
    precautions: "",
    icon: input.icon ?? "🧩",
    category: input.category,
    tags: input.tags ?? [],
    ownerId: input.owner.id,
    ownerName: input.owner.name,
    department: input.owner.department,
    visibility: input.visibility ?? "personal",
    version: 1,
    status: "draft",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    archivedAt: null,
    iterationNote: "",
    iterationWorkspace: null,
  }

  if (input.storage !== undefined) {
    const { root, sourceDirectory, projectDirectory } = input.storage
    const target = draftDirectory(root, metadata.id)
    assertWithinRoot(root, target, "草稿目录")
    await copyDirectory(sourceDirectory, target)
    try {
      await linkSkill(projectDirectory, metadata.id, target)
      await insertAsset(input.db, metadata)
    } catch (error) {
      // 先摘链接、再删副本：留下链接会指向一个刚被删掉的目录，内核下一次扫描就报错。
      // 清理本身失败不能吞（`#006-28`：空 catch 是盲区），两条都露出来。
      try {
        await unlinkSkill(projectDirectory, metadata.id)
        await removeDirectory(root, target)
      } catch (cleanupError) {
        // oxlint-disable-next-line preserve-caught-error -- 第三个参数已带 `cause`；规则只认「二参 + cause」写法（实测 oxlint 1.60）。
        throw new AggregateError(
          [error, cleanupError],
          `草稿 ${metadata.id} 建失败，且已复制的目录 / 链接未能清理`,
          { cause: error },
        )
      }
      throw error
    }
    return metadata
  }

  await insertAsset(input.db, metadata)
  return metadata
}

export interface CreateMcpDraftInput {
  readonly db: AssetTarget
  /** 作者档案；与 skill 草稿同一条纪律：不收调用方自报值。 */
  readonly owner: {
    readonly id: string
    readonly name: string
    readonly department: string
  }
  readonly name: string
  readonly description: string
  readonly category: string
  readonly tags?: readonly string[]
  /** 默认 `targeted`：MCP 能直接取数，创建时就按「指定人员」起步（设计 §3.2.2）。 */
  readonly visibility?: AssetVisibility
  /** 测试注入；生产省略由服务生成稳定 id。 */
  readonly id?: string
  readonly now?: number
  /** 连接规格，原样交给 `规范化连接` 校验（出口不必先拆字段）。 */
  readonly connection: unknown
}

/**
 * 【保留的定制 · 同步上游时不要丢】建一份 MCP 草稿（2026-11-02 设计 §3.1.2）。
 *
 * 与 `createDraftAsset` 的差异只有两处：**没有内容目录**（连接就是内容），以及
 * **连接与元数据没有共同事务**。后者的补偿方向与 skill 相反：
 * 先写元数据、再写连接；连接写失败就删掉刚写的元数据（级联删连接），
 * 因为「资产行存在但连不上」比「没有这个资产」更难排障。
 *
 * 校验在**任何写入之前**：分类闭集读库、连接规格 `规范化连接`。
 */
export async function createMcpDraft(input: CreateMcpDraftInput): Promise<AssetMetadata> {
  if (!(await isEnabledCategory(input.db, input.category))) {
    throw new AssetMetadataError([{ field: "category", message: `未知业务分类：${input.category}` }])
  }
  const 连接 = 规范化连接(input.connection)

  const now = input.now ?? Math.floor(Date.now() / 1000)
  const metadata: AssetMetadata = {
    id: input.id ?? `asset_${randomUUID()}`,
    name: input.name,
    type: "mcp",
    description: input.description,
    summary: "",
    precautions: "",
    icon: "mcp",
    category: input.category,
    tags: input.tags ?? [],
    ownerId: input.owner.id,
    ownerName: input.owner.name,
    department: input.owner.department,
    visibility: input.visibility ?? "targeted",
    version: 1,
    status: "draft",
    favoriteCount: 0,
    usageCount: 0,
    rating: 0,
    ratingCount: 0,
    feedbackCount: 0,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    archivedAt: null,
    iterationNote: "",
    iterationWorkspace: null,
  }

  await insertAsset(input.db, metadata)
  try {
    await insertMcpConnection(input.db, metadata.id, 连接, now)
  } catch (error) {
    try {
      await deleteAsset(input.db, metadata.id)
    } catch (cleanupError) {
      // oxlint-disable-next-line preserve-caught-error -- 第三个参数已带 `cause`；规则只认「二参 + cause」写法（实测 oxlint 1.60）。
      throw new AggregateError(
        [error, cleanupError],
        `MCP 草稿 ${metadata.id} 的连接写入失败，且元数据未能清理`,
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

  // 草稿副本（需求 3a）：`rm force` ⇒ 老草稿（共享根里本来就没有副本）也不报错。
  // 项目目录里的链接不在这里摘：那是「哪些项目装了它」的问题，由送达对账统一收拾。
  if (metadata.status === "draft") {
    await removeDirectory(root, draftDirectory(root, assetId))
    return true
  }

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

/**
 * 放弃迭代 = 新版本没发布，版本号回退（设计 §4）。
 *
 * 【保留的定制 · 同步上游时不要丢】版本迭代（2026-11-01）。
 *
 * 为什么不并进上面那个集合改成一个 `-1` 的映射：`VERSION_BUMPING_ACTIONS` 的语义是
 * 「发布前先占一个版本号」，回退是**它失败时的逆操作**，两者成立的前提不同
 * （回退还要守 `version >= 2`）。混在一个集合里，读代码的人得先算正负号。
 */
const VERSION_REVERTING_ACTIONS: ReadonlySet<SkillAction> = new Set(["abort_iteration"])

/** 只有发布类动作可以选可见范围：其它动作带了就是调用方理解错了（不静默忽略）。 */
const SCOPE_SELECTING_ACTIONS: ReadonlySet<SkillAction> = new Set(["publish_tech", "publish_iteration"])

/**
 * 解析这次流转的可见范围，返回**生效后**的 metadata（发布时可能替换 `visibility`）。
 *
 * 个人资产没有共享发布目录：skill 发布必须由发布者选一个共享范围（设计 §2），否则仍是
 * `personal_asset_not_shared`（409）；MCP 不落共享目录，个人档允许（裁定 D-9）。发布者可以
 * 覆盖作者原先选的部门 / 全局。
 */
function withPublishScope(
  asset: AssetMetadata,
  applied: AppliedSkillTransition,
  requested: AssetVisibility | undefined,
): AssetMetadata {
  if (!SCOPE_SELECTING_ACTIONS.has(applied.action)) {
    if (requested !== undefined) {
      throw new AssetTransitionError(
        "visibility_not_applicable",
        `${applied.action} 不接受可见范围（只有发布类动作可以选）`,
      )
    }
    return asset
  }

  const 范围 = requested ?? asset.visibility
  // 【保留的定制 · 同步上游时不要丢】MCP 没有共享目录，个人档在语义上成立（设计 §3.2.2 / 裁定 D-9）。
  if (范围 === "personal" && asset.type !== "mcp") {
    throw new AssetTransitionError(
      "personal_asset_not_shared",
      `个人资产不进入共享空间：${asset.id}（发布时请选择本部门、全局或指定人员）`,
    )
  }
  if (范围 === "department") {
    // 判据必须与落盘同一个谓词：`auth.user.dept` 可能带前导空格（`register.ts:89` 刻意不
    // trim），只判 `trim() === ""` 会放行，随后由 `publishDirectory` 抛裸 Error ⇒ 出口认
    // 不出 ⇒ 500 且不落审计（最终评审 I-3 实测）。
    try {
      assertSafeSegment(asset.department, "部门 id")
    } catch {
      throw new AssetTransitionError(
        "department_missing",
        `资产 ${asset.id} 的部门信息不能用作共享目录（空白或含非法字符）：请发布为全局，或先修正部门`,
      )
    }
  }
  return 范围 === asset.visibility ? asset : { ...asset, visibility: 范围 }
}

/**
 * 本次流转要碰的工作副本。`undefined` = 这一条动作不碰工作副本。
 *
 * 【保留的定制 · 同步上游时不要丢】版本迭代（2026-11-01）。
 *
 * 三条迭代动作各有各的落点来源：
 * - `start_iteration`：**现在算**（用户 + 项目 + 资产），并落库；
 * - `submit_iteration`：**读库里那一段**并解析成绝对目录（要读工作副本）；
 * - `abort_iteration`：同样读库里那一段，但**不解析目录**（只删 pending、清两列），
 *   坏值不该让「解卡」出口自己 500。
 *
 * 库是唯一真相，再由出口传一份就是两份口径（`#002-06` / `#010-04`）。
 */
interface IterationTarget {
  /** 沙箱根（绝对）。 */
  readonly root: string
  /** 相对沙箱根的片段；`null` = 库里没有记录。 */
  readonly relative: string | null
  /** 绝对路径；`abort_iteration` 不需要目录，恒为 `null`（`relative` 为 `null` 时亦然）。 */
  readonly directory: string | null
}

function 迭代目标(input: TransitionAssetInput, asset: AssetMetadata): IterationTarget {
  const 根 = input.workspaceRoot
  if (根 === undefined) {
    // 调用方漏传是**编码错误**，不是状态错误：不翻成用户可读的错误码，
    // 直接炸出来（出口永远会传，漏传说明接线断了）。
    throw new Error(`${input.action} 需要 workspaceRoot`)
  }

  if (input.action === "start_iteration") {
    const 项目 = input.projectId
    if (项目 === undefined) throw new Error("start_iteration 需要 projectId")
    // 用 `viewer.userId` 而不是 `asset.ownerId`：工作副本落在**发起人**的沙箱里，
    // 出口已校验 projectId 属于该发起人。ownerId 与 viewer 在作者动作上恒等，
    // 但写成 viewer 才是「谁发起、落在谁的沙箱」这条事实。
    const 相对 = iterationWorkspaceRelative(input.viewer.userId, 项目, asset.id)
    return { root: 根, relative: 相对, directory: iterationWorkspaceDirectory(根, 相对) }
  }

  const 相对 = asset.iterationWorkspace
  // 只有 `submit_iteration` 要读工作副本；`abort_iteration`（`discard_pending`）只删 pending、
  // 清两列，**不解析目录**。库里若是坏值（手工改库 / 历史数据），解析会抛裸 Error ⇒ abort 500，
  // 而 abort 正是管理员「解卡」的出口——它自己先卡住就没人能救了（2026-11-01 终审）。
  // `start_iteration` 仍在上面的分支里现算。
  const directory =
    input.action === "submit_iteration" && 相对 !== null ? iterationWorkspaceDirectory(根, 相对) : null
  return { root: 根, relative: 相对, directory }
}

/**
 * 本次流转要写进 `iteration_note` / `iteration_workspace` 的值。`undefined` = 不动这两列。
 *
 * - `start_iteration`：记说明、记工作副本；发起那一刻上一版的说明就被覆盖（设计 §3）；
 * - `submit_iteration`：两个都不动（说明仍是本次迭代的，路径仍指向作者手里那份）；
 * - `abort_iteration`：说明清空、路径清空——留着一条被放弃的说明，已发布资产会显示
 *   错误的注解（设计 §3 原话）。
 */
function iterationColumnsOf(
  action: SkillAction,
  reason: string | undefined,
  target: IterationTarget | undefined,
  /** MCP 没有工作副本：`iteration_workspace` 要显式清空，不能写空串。 */
  无工作副本 = false,
):
  | { iterationNote: string; iterationWorkspace: string }
  | { iterationNote: string; clearIteration: true }
  | undefined {
  if (action === "start_iteration") {
    const 说明 = (reason ?? "").trim()
    // 空串在库里是**值**不是「没记录」；MCP 写 "" 会让迭代清单显示一个假路径。
    if (无工作副本) return { iterationNote: 说明, clearIteration: true }
    return { iterationNote: 说明, iterationWorkspace: target?.relative ?? "" }
  }
  // 说明也要清空：`clearIteration` 只处置 `iteration_workspace`，而 `coalesce` 把空串当**值**
  // （不是「不改」），所以显式传 `""` 才能真的写空（Task 1 的 `iterationNote?: string` 语义）。
  if (action === "abort_iteration") return { iterationNote: "", clearIteration: true }
  return undefined
}

export interface TransitionAssetInput {
  readonly db: AssetTarget
  readonly root: string
  readonly assetId: string
  readonly action: SkillAction
  /**
   * 发起人视角。**不收 `actor`**：角色由 `authorizeTransition()` 从授权行派生，
   * 调用方只能声明「我是谁」（T009）。
   */
  readonly viewer: AssetViewer
  /** 省略时从库里取（`grantsFor`）。测试 / 批处理可预取后传入，省一次查询。 */
  readonly grants?: readonly GrantRow[]
  readonly reason?: string
  /** 发布类动作（技术发布 / 迭代发布）的可见范围；省略沿用资产现状。 */
  readonly visibility?: AssetVisibility
  /** Unix 秒；测试注入固定时间，生产省略取当前。 */
  readonly now?: number
  /**
   * 【保留的定制 · 同步上游时不要丢】版本迭代（2026-11-01）。
   *
   * 用户沙箱根（`workspaceRoot(env)`）。迭代三条动作必填——工作副本要落在
   * **发起人自己的**沙箱里，服务层不读环境变量（env 只由出口读）。
   */
  readonly workspaceRoot?: string
  /** 目标项目（`start_iteration` 必填）。出口已校验它属于发起人。 */
  readonly projectId?: string
  /** 试连实现（测试注入用）。缺省 = `probeMcpConnection`。 */
  readonly probe?: McpProbe
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
 * ## 通知（T010）
 *
 * 流转提交后按 design §2.6 写站内信（`notify.ts`）。通知失败**不回滚状态**：此时文件与
 * 元数据都已经落到新状态，倒回文件只会更不一致。抛 `AssetNotificationError`，
 * 消息里明确「流转已生效」，调用方据此区分「流转失败」与「只是通知没写进去」。
 *
 * ## 类型边界
 *
 * Skill 与 MCP 共用 7 状态机；MCP 只是不落文件（`prepareStorageStep` 开头短路）。
 * 知识库的简化生命周期未实现，继续抛 `unsupported_asset_type`。
 */
export async function transitionAsset(input: TransitionAssetInput): Promise<AssetMetadata> {
  const { db, root, assetId } = input

  const asset = await assetById(db, assetId)
  if (!asset) throw new AssetTransitionError("asset_not_found", `资产不存在：${assetId}`)
  // 【保留的定制 · 同步上游时不要丢】MCP 复用同一套 7 状态机（2026-11-02 设计 §3.1.4）：
  // 多一道业务审核与「严格控到人」一致；文件步骤在 `prepareStorageStep` 里短路。
  // 知识库仍未实现，继续显式拒绝——不套一张错的状态表。
  if (asset.type === "knowledge_base") {
    throw new AssetTransitionError("unsupported_asset_type", `知识库不走 7 状态机：${assetId}`)
  }

  // 授权判定在**任何副作用之前**：过不了关就一个文件都不搬（`#004-09`）。
  const grants = input.grants ?? (await grantsFor(db, input.viewer.userId))
  const actor = authorizeTransition(input.viewer, asset, grants, input.action)

  const applied = applySkillTransition(asset.status, input.action, {
    actor,
    reason: input.reason,
  })
  const now = input.now ?? Math.floor(Date.now() / 1000)

  // 范围解析在授权之后、任何文件搬运之前（`#004-09`）。
  const 生效 = withPublishScope(asset, applied, input.visibility)

  // 迭代三条动作要碰工作副本；落点在这里一次算定（授权之后、搬运之前，`#004-09`）。
  // 判据写「存储意图 + 源要从工作副本取」，而不是动作列表：**存储意图才是「要不要搬文件」
  // 的真相**，按动作列表写第二份判断就是两份口径（`#002-06`）。
  // 【保留的定制 · 同步上游时不要丢】MCP 没有工作副本（设计 §3.1.4）：
  // 迭代三条动作对它是空操作，不能走 `迭代目标()`——那个函数对 `start_iteration`
  // 强制要求 workspaceRoot / projectId，对 MCP 是编码错误而不是缺参数。
  const 迭代 =
    asset.type === "skill" &&
    (applied.storage === "copy_publish_to_workspace" ||
      applied.storage === "discard_pending" ||
      applied.action === "submit_iteration")
      ? 迭代目标(input, asset)
      : undefined

  // 写进 `iteration_workspace` 的值由 `iterationWorkspaceRelative()` 唯一产生（`start_iteration`
  // 在 `迭代目标()` 里现算），该函数内部已逐段 `assertSafeSegment`——这里不再「校验」一次。
  const 迭代列 = iterationColumnsOf(applied.action, input.reason, 迭代, asset.type === "mcp")

  // 【保留的定制 · 同步上游时不要丢】MCP 发布前试连：失败不落状态、不写快照（设计 §5.4）。
  // 插在 `迭代列` 之后、文件步骤之前：对 MCP 而言迭代目标与文件步骤都是空操作，放在这里
  // 才能保证「试连失败 ⇒ `updateAssetLifecycle` 根本没跑 ⇒ 状态不变」，而 check_error 已落库。
  if (
    asset.type === "mcp" &&
    (applied.action === "publish_tech" || applied.action === "publish_iteration")
  ) {
    // 只求值一次：`input.probe ?? probeMcpConnection` 写两遍会有两个投影。
    // `asset.status` 是**本次流转发起时**读到的状态：快照写入用它做条件，防止试连期间
    // 被 abort / 他人流转抢先（终审 I-2）。
    await prepareMcpPublish(db, asset.id, input.probe ?? probeMcpConnection, now, asset.status)
  }
  // 【保留的定制 · 同步上游时不要丢】放弃迭代 = 回到线上快照（设计 §3.1.4）。
  if (asset.type === "mcp" && applied.action === "abort_iteration") {
    const 还原 = await 回写发布快照(db, asset.id, now)
    if (!还原) {
      throw new AssetTransitionError(
        "mcp_connection_missing",
        `这台 MCP 资产没有可回写的发布快照：${asset.id}`,
      )
    }
  }

  const step = await prepareStorageStep(root, 生效, applied, asset, 迭代, input.workspaceRoot)

  // 本次要写入的版本号**只算一次**：条件更新与「他人已落地」判据必须用同一个值，
  // 算两遍就可能一边 +1 一边回退，判别式自己先漂掉。
  const 目标版本 = VERSION_BUMPING_ACTIONS.has(applied.action)
    ? asset.version + 1
    : VERSION_REVERTING_ACTIONS.has(applied.action)
      ? Math.max(1, asset.version - 1)
      : asset.version

  let updated: AssetMetadata
  // 条件更新落空之后才知道有没有「另一个写者已经完成同一流转」；它决定 catch 里
  // 是收尾（commit）还是回滚（rollback）——见 catch 里的说明。
  let 他人已落地 = false
  try {
    const result = await updateAssetLifecycle(db, asset.id, {
      expectedStatus: asset.status,
      status: applied.to,
      version: 目标版本,
      updatedAt: now,
      publishedAt: PUBLISHING_ACTIONS.has(applied.action) ? now : asset.publishedAt,
      archivedAt: applied.action === "archive" ? now : asset.archivedAt,
      ...(生效.visibility === asset.visibility ? {} : { visibility: 生效.visibility }),
      ...(迭代列 === undefined ? {} : 迭代列),
    })
    if (result === undefined) {
      // 当前状态已经是本调用的目标态 ⇒ 另一个写者完成了**同一条**流转：
      // 目标目录里放的是它已提交的结果，不是本调用搬过去的（真栈实测：Windows 上
      // 两条并发 `rename` 同一源到同一目标**都**回成功，输家以为自己搬了、其实没有）。
      // 这时回滚会把别人的结果搬回 pending，落成「库里 published、文件在 pending」。
      //
      // ⚠️ **必须连版本一起比**：`publish_iteration` 与 `abort_iteration` 都是
      // `iterating → published`，只比状态会把「abort 已落库」误认成「并发的 publish 已完成」
      // ⇒ `commit()` 删掉旧版备份，线上留下未发布的 v2、库里是已放弃的 v1（2026-11-01
      // 终审：审核闸门被绕过且无审计）。两者的版本号不同：publish 不动版本，abort 回退。
      const 现状 = await assetById(db, asset.id)
      他人已落地 = 现状?.status === applied.to && 现状.version === 目标版本
      throw new AssetTransitionError(
        "concurrent_transition",
        他人已落地
          ? `资产 ${asset.id} 的 ${applied.action} 已由并发请求完成，本请求未重复执行`
          : `资产 ${asset.id} 的状态已被并发修改，未执行 ${applied.action}`,
      )
    }
    updated = result

    if (step?.commit !== undefined) await step.commit()
  } catch (error) {
    if (step !== undefined) {
      try {
        if (他人已落地) await step.commit?.()
        else await step.rollback()
      } catch (rollbackError) {
        // oxlint-disable-next-line preserve-caught-error -- 第三个参数已带 `cause`；规则只认「二参 + cause」写法（实测 oxlint 1.60）。
        throw new AggregateError(
          [error, rollbackError],
          `资产 ${asset.id} 的 ${applied.action} 失败，且文件收尾未完成`,
          { cause: error },
        )
      }
    }
    throw error
  }

  // 通知在流转**提交之后**写（T010）。失败不能回滚已生效的状态——那会让文件与元数据
  // 一起倒回，而库里已经是新状态；所以只把「流转成功、通知失败」显式告诉调用方。
  try {
    await notifyAssetTransition(db, {
      asset: updated,
      applied,
      actorId: input.viewer.userId,
      now,
    })
  } catch (error) {
    throw new AssetNotificationError(updated.id, applied.action, error)
  }

  return updated
}

/**
 * MCP 发布前试连（设计 §5.4）：读连接规格 → 真连一次 → **先落试连结果** → 失败抛错。
 *
 * 顺序是这条闸门的全部意义：结果先入库，失败再抛 ⇒ 出口回 409 时界面能看到
 * `check_error`；把抛错放在前面就会出现「被告知连不上，但库里查不到原因」。
 * 成功才写快照：快照是**已发布**的连接规格，试连没过就不该有它。
 *
 * 错误消息直接带试连文本：生产路径的 `probeMcpConnection` 已按 headers / environment
 * 的值脱敏并截 500，这里不再拼装连接配置原文（二次拼装 = 第二条泄漏面）。
 *
 * ## 快照只写「被试连的那一份」（终审 I-2 根因版）
 *
 * `iterating` 期间允许改连接，所以试连不能拿一份、写快照再重读另一份：并发编辑会把
 * **没试连过的**配置直接发布出去。这里在进函数时把工作副本定格成 `快照`，probe 与写快照
 * 用的是同一个对象；写快照再带 `updated_at` ＋ 状态条件，试连期间被改 / 被 abort 都拒绝发布。
 */
async function prepareMcpPublish(
  db: AssetTarget,
  assetId: string,
  probe: McpProbe,
  now: number,
  expectedStatus: AssetStatus,
): Promise<void> {
  const 连接 = await getMcpConnection(db, assetId)
  if (连接 === undefined) {
    throw new AssetTransitionError("mcp_connection_missing", `这台 MCP 资产没有连接规格：${assetId}`)
  }
  // 这份快照同时交给 probe 和写快照：**试连的就是发布的**，中途不再重读工作副本。
  const 快照 = { ...连接输入(连接) }
  const 结果 = await probe(快照, { timeoutMs: 快照.timeoutMs })
  await 记录试连结果(db, assetId, {
    checkedAt: now,
    ok: 结果.ok,
    error: 结果.ok ? "" : 结果.error,
    toolCount: 结果.ok ? 结果.toolCount : null,
  })
  if (!结果.ok) throw new AssetTransitionError("mcp_probe_failed", `连不上：${结果.error}`)

  const 写入 = await 写入发布快照(db, assetId, 快照, now, {
    status: expectedStatus,
    updatedAt: 连接.updatedAt,
  })
  if (写入) return

  // `false` 不再只意味着「连接行被删」：连接行还在 ⇒ 一定是试连期间被并发改 / 被 abort 抢先。
  // 此时已经试连过的那份配置不能发布，也不能默默换成别人改后的那份（那正是旧实现的漏洞）。
  if ((await getMcpConnection(db, assetId)) !== undefined) {
    throw new AssetTransitionError(
      "concurrent_transition",
      `MCP 连接或资产状态在试连期间被并发修改：${assetId}`,
    )
  }
  // 连接行已不在：维持原行为（发布继续、没有快照；由后续 abort 显式报 `mcp_connection_missing`）。
}

/**
 * 状态机内的「源目录 → 目标目录」，把「源已不存在」翻成状态机错误码。
 *
 * 源不存在不是存储层内部错误：元数据说这一步该搬、文件却已经被搬走，说明另一个并发
 * 流转先一步完成了搬移。把 `MissingSourceDirectoryError` 原样抛出去，MCP / 前端拿到
 * 的是一个既没有 `code`、也没有可操作语义的内部异常（真栈实测：`源目录不存在：…`）。
 */
async function moveWithinTransition(
  source: string,
  target: string,
  action: SkillAction,
): Promise<DirectoryReplacement> {
  try {
    return await replaceDirectory(source, target)
  } catch (error) {
    if (error instanceof MissingSourceDirectoryError) {
      throw new AssetTransitionError(
        "invalid_source",
        `${action} 的源目录已不存在（可能已被并发流转搬走）：${source}`,
      )
    }
    throw error
  }
}

/**
 * 资产的共享发布目录，把「个人资产没有共享目录」翻成状态机错误码。
 *
 * 与 `moveWithinTransition` 同一个理由：存储层的前置检查是**业务前提**，不是内部故障。
 * 裸 `Error` 到出口会变成 500，失败也不会留下审计（010 真栈实得）。
 */
function sharedDirectoryOf(root: string, asset: AssetMetadata): string {
  try {
    return publishDirectory(
      root,
      asset.type,
      { visibility: asset.visibility, department: asset.department },
      asset.id,
    )
  } catch (error) {
    if (error instanceof PersonalAssetDirectoryError) {
      throw new AssetTransitionError(
        "personal_asset_not_shared",
        `个人资产不进入共享空间：${asset.id}（需先把可见范围改为本部门、全局或指定人员）`,
      )
    }
    throw error
  }
}

/**
 * 迭代发布且改了可见范围时，旧版本的共享目录还留在旧范围——它既不在 pending 也不在新 target，
 * 不清理就会被内核按目录扫描继续加载（设计 §5）。范围没变、或旧范围是 personal 时返回 undefined。
 */
function staleSharedDirectoryOf(
  root: string,
  original: AssetMetadata,
  effective: AssetMetadata,
): string | undefined {
  if (effective.visibility === original.visibility) return undefined
  // 个人资产没有共享目录；其余三档（全局 / 部门 / 指定人员，需求 3b）都有，改范围后要清旧的那份。
  if (
    original.visibility !== "department" &&
    original.visibility !== "global" &&
    original.visibility !== "targeted"
  ) {
    return undefined
  }
  return sharedDirectoryOf(root, original)
}

/**
 * 按转移表里的 `storage` 落文件步骤。抛错都发生在**写库之前**——文件没搬成就不该改状态。
 *
 * `original` 是流转**开始前**读到的资产（`asset` 是生效后的 metadata）：迭代发布改范围时
 * 要按旧范围算旧目录，两个都需要。
 */
async function prepareStorageStep(
  root: string,
  asset: AssetMetadata,
  applied: AppliedSkillTransition,
  original: AssetMetadata,
  // 【保留的定制 · 同步上游时不要丢】版本迭代（2026-11-01）。
  迭代: IterationTarget | undefined,
  /** 用户沙箱根；发布后重指项目链接要用。`undefined` = 只删草稿副本、不重指（不读 env）。 */
  workspaceRoot: string | undefined,
): Promise<StorageStep | undefined> {
  // 【保留的定制 · 同步上游时不要丢】MCP 没有内容目录（2026-11-02 设计 §3.1.4）：
  // 所有 storage intent 一律不落文件。放在 switch 之前而不是每个 case 里，
  // 是为了新增 storage 动作时默认也跳过——漏一处就会去搬一个不存在的目录。
  if (asset.type === "mcp") return undefined
  switch (applied.storage) {
    case "none":
      return undefined

    case "copy_to_pending": {
      // 【保留的定制 · 同步上游时不要丢】提交审核的源统一为草稿副本（2026-11-01 设计 §4.5）。
      // `submit_iteration` 仍用**库里记着的那一条**工作副本（`#010-04`：路径进了库就是唯一真相）。
      // `submit_review` 改用 `<root>/draft/<id>`：与项目无关、库里不存用户路径。
      const 提交迭代 = applied.action === "submit_iteration"
      const source = 提交迭代 ? 迭代?.directory : draftDirectory(root, asset.id)
      if (source === undefined || source === null) {
        throw new AssetTransitionError("source_directory_required", "工作副本记录缺失，请重新发起迭代")
      }
      if (!(await directoryExists(source))) {
        throw new AssetTransitionError(
          提交迭代 ? "source_directory_required" : "draft_content_missing",
          提交迭代 ? `工作副本不存在（可能已被删除或换了落盘根）：${source}` : "草稿内容不存在，请重新建草稿",
        )
      }
      const target = pendingDirectory(root, asset.id)
      assertWithinRoot(root, target, "待审目录")
      await copyDirectory(source, target, { replace: true })
      return { rollback: () => removeDirectory(root, target) }
    }

    // 【保留的定制 · 同步上游时不要丢】发起迭代（2026-11-01）：发布目录 → 工作副本。
    case "copy_publish_to_workspace": {
      const 工作副本根 = 迭代?.root
      const 工作副本 = 迭代?.directory
      if (工作副本根 === undefined || 工作副本 === null || 工作副本 === undefined) {
        throw new Error("copy_publish_to_workspace 缺少工作副本路径")
      }
      const source = sharedDirectoryOf(root, asset)
      if (!(await directoryExists(source))) {
        // 线上那份不在（落盘根换过 / 被人删了）⇒ 不能凭空造一个空工作副本：
        // 作者会以为自己在改线上内容，改完发布出来是一片空白。
        throw new MissingSourceDirectoryError(source)
      }
      // `replace: true`：再次发起迭代时以线上为准，工作副本里未提交的改动会被覆盖
      // （设计 §5 / §10 风险 1；发起弹窗里有明写）。
      await copyDirectory(source, 工作副本, { replace: true })
      return {
        rollback: async () => {
          // 删掉的是**从线上复制出来的副本**：线上那份没动，不丢数据；
          // 作者未提交的改动在 copy 那一步已经被覆盖了，这一步也不会再丢什么。
          await removeDirectory(工作副本根, 工作副本)
        },
      }
    }

    // 【保留的定制 · 同步上游时不要丢】放弃迭代（2026-11-01）：删 pending。
    case "discard_pending": {
      const target = pendingDirectory(root, asset.id)
      assertWithinRoot(root, target, "待审目录")
      // `force` ⇒ 本来就不存在也不报错；回滚是空的：pending 是临时区，删了就是删了。
      await removeDirectory(root, target)
      return undefined
    }

    case "move_pending_to_publish": {
      const source = pendingDirectory(root, asset.id)
      // 作者还没交（或交了又被 abort 删了）⇒ 搬一个不存在的目录，落成
      // 「库里 published、文件还在 pending」。设计 §4 要求在这里拦，宁可发布失败也不能
      // 让线上出现一个空版本。
      if (applied.action === "publish_iteration" && !(await hasPendingContent(source))) {
        throw new AssetTransitionError(
          "iteration_not_submitted",
          `资产 ${asset.id} 还没有提交新版本`,
        )
      }
      const target = sharedDirectoryOf(root, asset)
      const 旧目录 =
        applied.action === "publish_iteration" ? staleSharedDirectoryOf(root, original, asset) : undefined
      const replacement = await moveWithinTransition(source, target, applied.action)
      return {
        commit: async () => {
          // 写库已成功，这里的收尾都是「尽力而为」：失败不能让一次已完成的流转回 500，
          // 那会同时跳过站内信（notify 在 try 之后）。残留的备份 / 旧范围目录是
          // 可被告知的缺陷，失败响应是谎报——取前者。
          // （`replaceDirectory.commit()` 先把 `settled` 置真再删备份，删备份失败时
          // rollback 已是空操作，裸错误只会冒成 500。）
          try {
            await replacement.commit()
          } catch {
            // 有意吞掉：见上。
          }
          // 写库失败时 rollback 不碰旧范围目录（旧状态与旧目录仍一致），所以到这里才删。
          if (旧目录 !== undefined) {
            try {
              await removeDirectory(root, 旧目录)
            } catch {
              // 有意吞掉：见上。
            }
          }
          // 【保留的定制 · 同步上游时不要丢】发布后重指项目链接、删草稿副本（2026-11-01 设计 §4.6）。
          //
          // **先重指、再删副本**（与设计 §4.6 的字面顺序不同，2026-11-01 评审裁定）：
          // 反过来的话，重指失败时项目里的链接就从「指向过期副本（还能看）」直接变成
          // 「指向已删目录（用不了）」；Windows 上文件占用导致删 / 改失败很常见。先指后删
          // 同样满足「项目用线上那份」，且任何一步失败都还有副本可退。
          //
          // 重指**不按「草稿目录还在不在」设门**：函数本身只动指向旧目标的链接，没有就空转；
          // 上一次「删成功、重指失败」留下的坏链接也能因此自愈。
          //
          // 两段各自 try：失败不能让一次已完成的流转落进外层 catch 触发 rollback——那会把
          // 已发布的目录搬回 pending。失败也不静默：逐个记 warning（目录 + 错误），便于事后捞。
          //
          // `workspaceRoot` 没传 ⇒ **两段都跳过**（2026-11-01 最终修复轮改的契约）：不重指，
          // 也**不能删草稿副本**。副本是那条退化路径的唯一退路——只删副本会让项目里仍指着它的
          // 链接变成死链，服务层默认值自己产出坏状态；留副本最坏也只是少清理一次。
          // 服务层不读 env（env 只由出口读）。
          if (applied.action === "publish_tech" || applied.action === "publish_iteration") {
            if (workspaceRoot !== undefined) {
              const 草稿 = draftDirectory(root, asset.id)
              try {
                const 重指 = await retargetAssetLinksAcrossWorkspaces(workspaceRoot, asset.id, 草稿, target)
                for (const 失败 of 重指.failed) {
                  console.warn(
                    `[openhive-asset-publish] 资产 ${asset.id} 发布后重指链接失败：${失败.directory}`,
                    失败.error,
                  )
                }
              } catch (error) {
                // 有意不冒出去：见上。整段抛错（理论上只有编码错误）同样要留痕。
                console.warn(`[openhive-asset-publish] 资产 ${asset.id} 发布后重指链接失败`, error)
              }
              try {
                if (await directoryExists(草稿)) await removeDirectory(root, 草稿)
              } catch (error) {
                // 副本删不掉只是残留，不能让已完成的流转回 500。
                console.warn(`[openhive-asset-publish] 资产 ${asset.id} 发布后删除草稿副本失败`, error)
              }
            }
          }
        },
        rollback: () => replacement.rollback(),
      }
    }

    case "move_publish_to_archive": {
      const source = sharedDirectoryOf(root, asset)
      const target = archiveDirectory(root, asset.id)
      const replacement = await moveWithinTransition(source, target, applied.action)
      return {
        commit: async () => {
          // 同样是写库后的纯清理：删备份失败不能让已完成的归档回 500（见上一条分支）。
          try {
            await replacement.commit()
          } catch {
            // 有意吞掉：见上。
          }
        },
        rollback: () => replacement.rollback(),
      }
    }

    default: {
      const intent: never = applied.storage
      throw new Error(`未知存储动作：${String(intent)}`)
    }
  }
}
