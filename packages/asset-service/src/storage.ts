import { randomUUID } from "node:crypto"
import { cp, mkdir, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { AssetType, AssetVisibility } from "./metadata"

/** 资产共享根的变量名；与 `OPENHIVE_WORKSPACE_ROOT` / `OPENHIVE_SHARED_ROOT` 同构。 */
export const ASSETS_ROOT_ENV = "OPENHIVE_ASSETS_ROOT"

/** 生产默认根：由部署方把共享卷挂到这里。 */
export const DEFAULT_ASSETS_ROOT = "/assets"

const ASSET_TYPE_DIRS: Record<AssetType, string> = {
  skill: "skills",
  mcp: "mcp",
  knowledge_base: "knowledge-base",
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * 校验单个路径段。资产 id / 部门 / 可见范围都会直接拼进共享卷路径，
 * 一旦放行 `..` 或分隔符就会写出根目录。
 */
export function assertSafeSegment(value: string, label = "路径段"): string {
  if (typeof value !== "string") throw new Error(`非法${label}：${String(value)}`)
  if (value === "" || value !== value.trim()) throw new Error(`非法${label}：${JSON.stringify(value)}`)
  if (value === "." || value === "..") throw new Error(`非法${label}：${JSON.stringify(value)}`)
  if (value.endsWith(".")) throw new Error(`非法${label}：${JSON.stringify(value)}`)
  if (/[\\/:*?"<>|\0-\x1f]/.test(value)) throw new Error(`非法${label}：${JSON.stringify(value)}`)
  if (WINDOWS_RESERVED.test(value)) throw new Error(`非法${label}：${JSON.stringify(value)}`)
  return value
}

/** 资产共享根：环境变量优先，空串按未配置处理。 */
export function assetsRoot(env: Record<string, string | undefined>): string {
  return env[ASSETS_ROOT_ENV] || DEFAULT_ASSETS_ROOT
}

/** 在资产根下拼安全路径。 */
export function assetDirectory(root: string, ...segments: string[]): string {
  return join(root, ...segments.map((segment) => assertSafeSegment(segment)))
}

/** 审核中：`/assets/pending/{assetId}`。 */
export function pendingDirectory(root: string, assetId: string): string {
  return join(root, "pending", assertSafeSegment(assetId, "资产 id"))
}

/** 已归档：`/assets/archive/{assetId}`。 */
export function archiveDirectory(root: string, assetId: string): string {
  return join(root, "archive", assertSafeSegment(assetId, "资产 id"))
}

export type PublishScope = {
  visibility: AssetVisibility
  /** 可见范围为 `department` 时必填；运行期由 `assertSafeSegment` 再校验。 */
  department?: string
}

/**
 * 已发布目录：
 * - 全局 `/assets/global/{skills,mcp,knowledge-base}/{assetId}`
 * - 部门 `/assets/dept/{department}/{skills,mcp,knowledge-base}/{assetId}`
 *
 * 个人资产留在作者沙箱，不进共享发布目录。
 */
export function publishDirectory(
  root: string,
  type: AssetType,
  scope: PublishScope,
  assetId: string,
): string {
  const typeDirectory = ASSET_TYPE_DIRS[type]
  if (typeDirectory === undefined) throw new Error(`未知资产类型：${type}`)

  const visibilityName: string = scope.visibility
  const visibility = scope.visibility
  if (visibility === "global") {
    return join(root, "global", typeDirectory, assertSafeSegment(assetId, "资产 id"))
  }
  if (visibility === "department") {
    const department = assertSafeSegment(scope.department ?? "", "部门 id")
    return join(root, "dept", department, typeDirectory, assertSafeSegment(assetId, "资产 id"))
  }
  if (visibility === "personal") {
    throw new Error("个人资产不发布：请保留在作者沙箱")
  }
  throw new Error(`未知可见范围：${visibilityName}`)
}

/** 建目录，已存在不报错（重复调用安全）。 */
export async function ensureDir(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o755 })
}

/**
 * 路径必须落在资产根**内部**（不含根本身）。
 *
 * 删除 / 替换这类破坏性操作前调用：`assetId` / 部门名已经逐段校验过，这里再对拼好的
 * 整条路径做一次归一化校验，挡住 `..`、绝对路径、同前缀兄弟目录（`/assets-evil`）与跨盘路径。
 */
export function assertWithinRoot(root: string, candidate: string, label = "路径"): string {
  const rootPath = resolve(root)
  const targetPath = resolve(candidate)
  const relativePath = relative(rootPath, targetPath)
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`非法${label}：${candidate} 不在资产根 ${root} 内`)
  }
  return targetPath
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const code = Reflect.get(error, "code")
  return typeof code === "string" ? code : undefined
}

async function statOrNull(path: string) {
  try {
    return await stat(path)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null
    throw error
  }
}

function isInside(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child))
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  )
}

/**
 * 把源目录复制到目标父目录下的**暂存目录**，返回暂存路径。
 *
 * 为什么先复制到暂存目录：目标目录的替换必须是「要么旧版、要么完整新版」。
 * 直接往目标里写会留下「目录存在但内容不全」的窗口（storage.md §4）。
 *
 * `dereference: true`：skill 目录里的符号链接不能原样带进共享卷——链接指向作者沙箱，
 * 发布后那条路径对别人不存在。复制内容而不是复制链接。
 */
async function stageDirectory(source: string, target: string): Promise<string> {
  const sourceInfo = await stat(source)
  if (!sourceInfo.isDirectory()) throw new Error(`源不是目录：${source}`)

  const parent = dirname(target)
  await ensureDir(parent)
  const staging = join(parent, `.${basename(target)}.tmp-${randomUUID()}`)
  try {
    await cp(source, staging, {
      recursive: true,
      dereference: true,
      errorOnExist: true,
      force: false,
    })
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return staging
}

export interface CommitDirectoryOptions {
  /** 目标已存在时是否替换；默认 false（宁可不写，也不静默覆盖）。 */
  replace?: boolean
}

/**
 * 把暂存目录提交到目标位置。
 *
 * 同卷 `rename` 是原子替换：
 * 1. 目标已存在且允许替换 ⇒ 先 `rename(target, backup)`；
 * 2. `rename(staging, target)`；
 * 3. 成功后删备份；失败则把备份 `rename` 回目标。
 *
 * ⚠️ **刻意不先检查暂存目录是否存在**：检查会把这个函数变成「缺失即早退」，
 * 从而永远走不到「备份已挪走、改名失败、再恢复」这条回滚路径。提交失败时由
 * `rename` 自己报 ENOENT，回滚逻辑因此可以被真实用例覆盖（`storage.test.ts`
 * 的「提交失败时把旧版恢复回目标」）。
 */
export async function commitStagedDirectory(
  staging: string,
  target: string,
  options: CommitDirectoryOptions = {},
): Promise<void> {
  const parent = dirname(target)
  await ensureDir(parent)

  const stagingInfo = await statOrNull(staging)
  if (stagingInfo && !stagingInfo.isDirectory()) {
    await rm(staging, { recursive: true, force: true })
    throw new Error(`暂存路径不是目录：${staging}`)
  }

  const existing = await statOrNull(target)
  if (existing && !existing.isDirectory()) {
    if (stagingInfo) await rm(staging, { recursive: true, force: true })
    throw new Error(`目标路径不是目录：${target}`)
  }

  const backup = join(parent, `.${basename(target)}.bak-${randomUUID()}`)
  let movedExisting = false

  if (existing) {
    if (!options.replace) {
      if (stagingInfo) await rm(staging, { recursive: true, force: true })
      throw new Error(`目标目录已存在：${target}`)
    }
    try {
      await rename(target, backup)
    } catch (error) {
      if (stagingInfo) await rm(staging, { recursive: true, force: true })
      throw error
    }
    movedExisting = true
  }

  try {
    await rename(staging, target)
  } catch (error) {
    if (movedExisting) {
      try {
        await rename(backup, target)
      } catch (restoreError) {
        // oxlint-disable-next-line preserve-caught-error -- 第三个参数已带 `cause`；规则只认「二参 + cause」写法（实测 oxlint 1.60）。
        throw new AggregateError([error, restoreError], `目标目录替换失败且旧版恢复失败：${target}`, {
          cause: error,
        })
      }
    }
    await rm(staging, { recursive: true, force: true })
    throw error
  }

  if (movedExisting) await rm(backup, { recursive: true, force: true })
}

export interface CopyDirectoryOptions extends CommitDirectoryOptions {}

/**
 * 复制目录：暂存 → 提交。
 *
 * 跨卷安全：暂存目录建在**目标父目录**里，所以 `staging -> target` 这一步永远同卷；
 * 源目录与目标不在同一卷只影响 `cp`，`cp` 本来就会逐文件复制。
 */
export async function copyDirectory(
  source: string,
  target: string,
  options: CopyDirectoryOptions = {},
): Promise<void> {
  const sourcePath = resolve(source)
  const targetPath = resolve(target)
  if (sourcePath === targetPath) throw new Error("源目录与目标目录相同")
  if (isInside(sourcePath, targetPath)) throw new Error("目标目录不能位于源目录内")

  const staging = await stageDirectory(sourcePath, targetPath)
  await commitStagedDirectory(staging, targetPath, options)
}

/**
 * 源目录不存在（`moveDirectory` / `replaceDirectory` 的前置检查）。
 *
 * 为什么要类型而不是只靠消息：并发流转时另一个写者可能已经把源目录搬走，
 * 编排层要把它翻成状态机错误码（`invalid_source`），而不是把 fs 异常原样抛给
 * 模型 / 前端。消息保持原样（`源目录不存在：<路径>`），既有断言不用改。
 */
export class MissingSourceDirectoryError extends Error {
  constructor(source: string) {
    super(`源目录不存在：${source}`)
    this.name = "MissingSourceDirectoryError"
  }
}

/**
 * 移动目录：优先同卷 `rename`；跨卷（`EXDEV`）退化为「复制到目标卷 → 删源」。
 *
 * 目标已存在时走 `copyDirectory` 的替换流程；复制成功后**才**删源目录。
 * 若删源失败，目标已是完整新版、源目录仍在（重复执行会再次替换，整体可重入），
 * 这是跨卷移动无法做到单步原子的残差，调用方需要知道。
 */
export async function moveDirectory(
  source: string,
  target: string,
  options: CopyDirectoryOptions = {},
): Promise<void> {
  const sourcePath = resolve(source)
  const targetPath = resolve(target)
  if (sourcePath === targetPath) throw new Error("源目录与目标目录相同")
  if (isInside(sourcePath, targetPath)) throw new Error("目标目录不能位于源目录内")
  if (isInside(targetPath, sourcePath)) throw new Error("源目录不能位于目标目录内")

  const sourceInfo = await statOrNull(sourcePath)
  if (!sourceInfo) throw new MissingSourceDirectoryError(source)
  if (!sourceInfo.isDirectory()) throw new Error(`源不是目录：${source}`)

  await ensureDir(dirname(targetPath))

  if (!(await statOrNull(targetPath))) {
    try {
      await rename(sourcePath, targetPath)
      return
    } catch (error) {
      if (errorCode(error) !== "EXDEV") throw error
    }
  }

  await copyDirectory(sourcePath, targetPath, options)
  await rm(sourcePath, { recursive: true, force: true })
}

/**
 * 一次「源目录替换目标目录」的句柄（T008）。
 *
 * 与 `moveDirectory(..., { replace: true })` 的区别只有一条：**旧版不立刻删**。
 * 迭代发布是「文件先换、元数据后写」——如果写库失败（并发改状态 / 库抖动），
 * 调用方需要把旧版放回去；旧版已经删掉就只能报一个「回滚不了」。
 *
 * 生命周期：`commit()` 删备份（元数据已确认写入）；`rollback()` 把新版退回源、旧版放回目标。
 * 两个方法都只生效一次，重复调用是空操作。
 */
export interface DirectoryReplacement {
  /** 替换前目标的备份路径；目标原本不存在时为 `undefined`。 */
  readonly backup: string | undefined
  commit(): Promise<void>
  rollback(): Promise<void>
}

/**
 * 用源目录替换目标目录，**旧版保留在备份路径直到 `commit()`**。
 *
 * 目标原本不存在时不产生备份；源不存在在动目标之前就抛错。
 * 替换本身走 `moveDirectory`（同卷 rename / 跨卷复制后删源，`EXDEV` 语义一致）。
 */
export async function replaceDirectory(
  source: string,
  target: string,
): Promise<DirectoryReplacement> {
  const sourcePath = resolve(source)
  const targetPath = resolve(target)
  if (sourcePath === targetPath) throw new Error("源目录与目标目录相同")
  if (isInside(sourcePath, targetPath)) throw new Error("目标目录不能位于源目录内")
  if (isInside(targetPath, sourcePath)) throw new Error("源目录不能位于目标目录内")

  const sourceInfo = await statOrNull(sourcePath)
  if (!sourceInfo) throw new MissingSourceDirectoryError(source)
  if (!sourceInfo.isDirectory()) throw new Error(`源不是目录：${source}`)

  const targetInfo = await statOrNull(targetPath)
  if (targetInfo && !targetInfo.isDirectory()) throw new Error(`目标路径不是目录：${target}`)

  await ensureDir(dirname(targetPath))
  const backup =
    targetInfo === null ? undefined : join(dirname(targetPath), `.${basename(targetPath)}.bak-${randomUUID()}`)

  if (backup !== undefined) await rename(targetPath, backup)

  try {
    await moveDirectory(sourcePath, targetPath)
  } catch (error) {
    if (backup !== undefined) {
      try {
        await rename(backup, targetPath)
      } catch (restoreError) {
        // oxlint-disable-next-line preserve-caught-error -- 第三个参数已带 `cause`；规则只认「二参 + cause」写法（实测 oxlint 1.60）。
        throw new AggregateError([error, restoreError], `目录替换失败且旧版恢复失败：${target}`, {
          cause: error,
        })
      }
    }
    throw error
  }

  let settled = false

  return {
    backup,
    async commit() {
      if (settled) return
      settled = true
      if (backup !== undefined) await rm(backup, { recursive: true, force: true })
    },
    async rollback() {
      if (settled) return
      settled = true
      const errors: unknown[] = []
      try {
        await moveDirectory(targetPath, sourcePath)
      } catch (error) {
        errors.push(error)
      }
      if (backup !== undefined) {
        try {
          await rename(backup, targetPath)
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, `目录替换回滚失败：${target}`)
    },
  }
}

/**
 * 删除资产根内的目录。已不存在时不报错（重复删除安全）。
 *
 * 删除**不是**授权边界（storage.md §5）：调用方必须先做完 RBAC / 生命周期判断，
 * 这里只负责路径安全与幂等。
 */
export async function removeDirectory(root: string, target: string): Promise<void> {
  assertWithinRoot(root, target, "删除路径")
  await rm(target, { recursive: true, force: true })
}
