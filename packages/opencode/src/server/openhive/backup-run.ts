/**
 * 备份 / 预览 / 恢复的**执行层**（没有 HTTP、没有 Effect）。
 *
 * 阶段顺序是**写死的**（spec §5.6）：扫描 → 哈希 → 上传 → 写 manifest。取消只在阶段边界与
 * 文件边界检查；取消或失败**不写 manifest** ⇒ 不会留下「半份备份看起来像完整备份」。
 */

import { createHash, randomBytes } from "node:crypto"
import { createReadStream, type Stats } from "node:fs"
import { lstat, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import {
  MAX_FILE_BYTES,
  type Job,
  type Manifest,
  type ManifestFile,
  type ManifestSkip,
  type SnapshotKind,
} from "./backup-model"
import { estimateManifestBytes, isExcluded, isPathInScope, isSafeRelativePath, snapshotIdOf } from "./backup-rules"
import type { BackupStore } from "./backup-store"

export class CancelledError extends Error {
  override readonly name = "CancelledError"
}
export class UnchangedError extends Error {
  override readonly name = "UnchangedError"
}
export class QuotaError extends Error {
  override readonly name = "QuotaError"
  constructor(
    readonly usageBytes: number,
    readonly requiredBytes: number,
    readonly limitBytes: number,
  ) {
    super(`备份需要 ${requiredBytes} 字节，已用 ${usageBytes} / ${limitBytes}`)
  }
}
export class NotFoundError extends Error {
  override readonly name = "NotFoundError"
}

export interface ScannedFile {
  readonly path: string
  readonly size: number
  readonly mtimeMs: number
  readonly mode: number
}

export interface RunDeps {
  readonly store: BackupStore
  readonly directory: string
  /** 写进 manifest 的归属。`BackupStore.readManifest` 会拿这两个值校验（防止把别人的清单当自己的）。 */
  readonly projectId: string
  readonly ownerId: string
  readonly timezone: string
  readonly report: (patch: Partial<Job>) => void
  readonly isCancelled: () => boolean
  readonly maxFileBytes?: number
  readonly concurrency?: number
  /** 测试注入的时钟；不传就是 `Date.now()`。 */
  readonly now?: () => number
}

export interface BackupInput {
  readonly kind: SnapshotKind
  readonly scope: string
  readonly createdBy: string
  /** 只有自动备份会传：用来复用哈希、并判「树没变」。 */
  readonly previous?: Manifest
  readonly quotaBytes?: number
  readonly usageBytes?: number
}

const 并发 = 4

function 检查取消(deps: RunDeps) {
  if (deps.isCancelled()) throw new CancelledError("任务已取消")
}

async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  let failed: unknown
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      try {
        await worker(items[index]!)
      } catch (error) {
        failed ??= error
        return
      }
    }
  })
  await Promise.all(runners)
  if (failed !== undefined) throw failed
}

/** 扫描一个范围。`scope` 是文件时只返回它自己；是目录时返回整棵子树。 */
export async function scanScope(
  directory: string,
  scope: string,
  options: { maxFileBytes?: number } = {},
): Promise<{ files: ScannedFile[]; dirs: string[]; skipped: ManifestSkip[] }> {
  if (!isSafeRelativePath(scope)) throw new Error(`非法范围：${JSON.stringify(scope)}`)
  const 上限 = options.maxFileBytes ?? MAX_FILE_BYTES
  const files: ScannedFile[] = []
  const dirs: string[] = []
  const skipped: ManifestSkip[] = []
  const 绝对 = (path: string) => join(directory, ...(path === "" ? [] : path.split("/")))

  const root = scope === "" ? directory : 绝对(scope)
  let info: Stats
  try {
    info = await lstat(root)
  } catch {
    throw new NotFoundError(`路径不存在：${JSON.stringify(scope)}`)
  }

  const 收文件 = async (path: string, stats: Stats) => {
    if (isExcluded(path)) {
      skipped.push({ path, reason: "excluded" })
      return
    }
    if (stats.size > 上限) {
      skipped.push({ path, reason: "too-large" })
      return
    }
    files.push({ path, size: stats.size, mtimeMs: stats.mtimeMs, mode: stats.mode & 0o777 })
  }

  const 走 = async (path: string, stats: Stats) => {
    if (stats.isSymbolicLink()) {
      skipped.push({ path, reason: "symlink" })
      return
    }
    if (stats.isFile()) {
      await 收文件(path, stats)
      return
    }
    if (!stats.isDirectory()) return
    if (path !== "") dirs.push(path)
    let entries
    try {
      entries = await readdir(绝对(path), { withFileTypes: true })
    } catch {
      skipped.push({ path, reason: "unreadable" })
      return
    }
    for (const entry of entries) {
      const 子 = path === "" ? entry.name : `${path}/${entry.name}`
      let 子信息: Stats
      try {
        子信息 = await lstat(绝对(子))
      } catch {
        skipped.push({ path: 子, reason: "unreadable" })
        continue
      }
      await 走(子, 子信息)
    }
  }

  if (info.isSymbolicLink()) {
    skipped.push({ path: scope, reason: "symlink" })
  } else if (info.isFile()) {
    await 收文件(scope, info)
  } else if (info.isDirectory()) {
    await 走(scope, info)
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  dirs.sort((a, b) => a.localeCompare(b))
  skipped.sort((a, b) => a.path.localeCompare(b.path))
  return { files, dirs, skipped }
}

async function hashFile(file: ScannedFile, absolute: string): Promise<string> {
  const before = await stat(absolute)
  const hash = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(absolute)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", resolve)
  })
  const after = await stat(absolute)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error("changed-during-backup")
  }
  return hash.digest("hex")
}

/** 备份。返回写进 MinIO 的 manifest。 */
export async function runBackup(deps: RunDeps, input: BackupInput): Promise<Manifest> {
  const total = { filesTotal: 0, filesDone: 0, bytesTotal: 0, bytesDone: 0 }
  deps.report({ state: "scanning", progress: total })
  const 扫描 = await scanScope(deps.directory, input.scope, { maxFileBytes: deps.maxFileBytes })
  total.filesTotal = 扫描.files.length
  total.bytesTotal = 扫描.files.reduce((sum, file) => sum + file.size, 0)
  deps.report({ state: "hashing", progress: { ...total } })
  检查取消(deps)

  const 上次 = new Map<string, ManifestFile>()
  if (input.previous) for (const file of input.previous.files) 上次.set(file.path, file)

  const files: ManifestFile[] = []
  const skipped = [...扫描.skipped]
  for (const file of 扫描.files) {
    检查取消(deps)
    const 绝对 = join(deps.directory, ...file.path.split("/"))
    const 旧 = 上次.get(file.path)
    let hash: string
    if (input.kind === "auto" && 旧 && 旧.size === file.size && 旧.mtimeMs === file.mtimeMs) {
      hash = 旧.hash
    } else {
      try {
        hash = await hashFile(file, 绝对)
      } catch (error) {
        skipped.push({
          path: file.path,
          reason: error instanceof Error && error.message === "changed-during-backup" ? "changed-during-backup" : "unreadable",
        })
        total.filesDone += 1
        deps.report({ progress: { ...total } })
        continue
      }
    }
    files.push({ path: file.path, hash, size: file.size, mtimeMs: file.mtimeMs, mode: file.mode })
    total.filesDone += 1
    deps.report({ progress: { ...total } })
  }

  检查取消(deps)
  if (input.previous && 树没变(input.previous, files, 扫描.dirs, input.scope)) throw new UnchangedError("自上次快照以来没有变化")

  const 已有 = new Set((await deps.store.blobs()).map((blob) => blob.hash))
  const 缺 = new Map<string, { size: number; path: string }>()
  for (const file of files) if (!已有.has(file.hash) && !缺.has(file.hash)) 缺.set(file.hash, { size: file.size, path: file.path })

  const 上传字节 = [...缺.values()].reduce((sum, blob) => sum + blob.size, 0)
  const 需要 = 上传字节 + estimateManifestBytes(files.reduce((sum, file) => sum + file.size, 0))
  if (input.quotaBytes !== undefined && (input.usageBytes ?? 0) + 需要 > input.quotaBytes) {
    throw new QuotaError(input.usageBytes ?? 0, 需要, input.quotaBytes)
  }

  deps.report({ state: "uploading", progress: { ...total } })
  total.bytesDone = 0
  await runPool([...缺.entries()], deps.concurrency ?? 并发, async ([hash, blob]) => {
    检查取消(deps)
    const 绝对 = join(deps.directory, ...blob.path.split("/"))
    try {
      await deps.store.putBlob({
        hash,
        size: blob.size,
        body: 上传源(绝对, hash),
        onProgress: (bytes) => {
          total.bytesDone += bytes
          deps.report({ progress: { ...total } })
        },
      })
    } catch (error) {
      await deps.store.deleteBlob(hash).catch(() => undefined)
      throw error
    }
  })

  检查取消(deps)
  deps.report({ state: "committing", progress: { ...total } })
  const at = deps.now?.() ?? Date.now()
  const manifest: Manifest = {
    version: 1,
    id: snapshotIdOf(at, randomBytes(4).toString("hex")),
    projectId: deps.projectId,
    ownerId: deps.ownerId,
    kind: input.kind,
    scope: input.scope,
    createdAt: at,
    createdBy: input.createdBy,
    source: input.kind,
    timezone: deps.timezone,
    status: skipped.length === 0 ? "complete" : "partial",
    files,
    dirs: 扫描.dirs,
    skipped,
    totals: { files: files.length, bytes: total.bytesTotal, uploadedBytes: 上传字节, skipped: skipped.length },
  }
  return manifest
}

/** 上传时再算一遍哈希；与扫描时不一致就中途拒绝（spec §5.5）。 */
async function* 上传源(absolute: string, expected: string): AsyncGenerator<Uint8Array> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(absolute)) {
    hash.update(chunk as Buffer)
    yield chunk as Uint8Array
  }
  if (hash.digest("hex") !== expected) throw new Error("changed-during-backup")
}

function 树没变(previous: Manifest, files: readonly ManifestFile[], dirs: readonly string[], scope: string): boolean {
  if (previous.scope !== scope) return false
  const 旧 = previous.files.filter((file) => isPathInScope(scope, file.path))
  if (旧.length !== files.length) return false
  for (let i = 0; i < files.length; i += 1) {
    const a = 旧[i]!
    const b = files[i]!
    if (a.path !== b.path || a.size !== b.size || a.mtimeMs !== b.mtimeMs || a.hash !== b.hash) return false
  }
  return previous.dirs.length === dirs.length && previous.dirs.every((dir, index) => dir === dirs[index])
}
