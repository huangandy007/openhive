/**
 * 备份 / 预览 / 恢复的**执行层**（没有 HTTP、没有 Effect）。
 *
 * 阶段顺序是**写死的**（spec §5.6）：扫描 → 哈希 → 上传 → 写 manifest。取消只在阶段边界与
 * 文件边界检查；取消或失败**不写 manifest** ⇒ 不会留下「半份备份看起来像完整备份」。
 */

import { createHash, randomBytes, randomUUID } from "node:crypto"
import { createReadStream, lstatSync, readdirSync, rmSync, type Stats } from "node:fs"
import { chmod, lstat, mkdir, open, readdir, rename, rm, stat, utimes } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  LOCAL_ONLY_LIMIT,
  MAX_FILE_BYTES,
  PREVIEW_LIMIT,
  type Job,
  type Manifest,
  type ManifestFile,
  type ManifestSkip,
  type PreviewStatus,
  type RestoreDecision,
  type RestorePreview,
  type RestorePreviewEntry,
  type RestoreResult,
  type SkipReason,
  type SnapshotKind,
} from "./backup-model"
import {
  estimateManifestBytes,
  isExcluded,
  isPathInScope,
  isSafeRelativePath,
  keepBothName,
  snapshotIdOf,
} from "./backup-rules"
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

/**
 * 路径排序用**固定 locale**，不用裸 `localeCompare`：后者跟随宿主默认 locale（本机 zh-CN 下
 * `甲 < 乙`，en-US 下按 UCA 隐式权重反而 `乙 < 甲`）⇒ manifest 顺序会随宿主机漂移，`树没变`
 * 的按下标比较在换宿主后恒判「变了」。spec §5.2 要求排序后写入（确定性）。
 */
const 排序 = new Intl.Collator("zh-CN")

function 检查取消(deps: RunDeps) {
  if (deps.isCancelled()) throw new CancelledError("任务已取消")
}

async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  let failed: unknown
  // `limit <= 0` 时不能静默不传（那会假装成功）；至少起一个 runner。
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
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

  files.sort((a, b) => 排序.compare(a.path, b.path))
  dirs.sort((a, b) => 排序.compare(a, b))
  skipped.sort((a, b) => 排序.compare(a.path, b.path))
  return { files, dirs, skipped }
}

async function hashFile(absolute: string): Promise<string> {
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
        hash = await hashFile(绝对)
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

  const 计划上传字节 = [...缺.values()].reduce((sum, blob) => sum + blob.size, 0)
  const 需要 = 计划上传字节 + estimateManifestBytes(files.reduce((sum, file) => sum + file.size, 0))
  if (input.quotaBytes !== undefined && (input.usageBytes ?? 0) + 需要 > input.quotaBytes) {
    throw new QuotaError(input.usageBytes ?? 0, 需要, input.quotaBytes)
  }

  deps.report({ state: "uploading", progress: { ...total } })
  total.bytesDone = 0
  // 单个 blob 失败**不中止整轮**（spec §5.5：任一文件最终失败 ⇒ 记入 skipped，快照落 partial）：
  // 清掉半截对象、记下原因，其余 blob 继续。`changed-during-backup` 原样保留，其余归 `upload-failed`。
  const 上传失败 = new Map<string, SkipReason>()
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
      上传失败.set(
        hash,
        error instanceof Error && error.message === "changed-during-backup" ? "changed-during-backup" : "upload-failed",
      )
    }
  })

  检查取消(deps)
  // 失败 blob 引用的**所有**文件都从 files 剔除并记 skipped（同 hash 可能对应多个路径）。
  const 成功文件 = files.filter((file) => !上传失败.has(file.hash))
  for (const file of files) {
    const reason = 上传失败.get(file.hash)
    if (reason) skipped.push({ path: file.path, reason })
  }
  const 上传字节 = [...缺.entries()]
    .filter(([hash]) => !上传失败.has(hash))
    .reduce((sum, [, blob]) => sum + blob.size, 0)
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
    files: 成功文件,
    dirs: 扫描.dirs,
    skipped,
    // files / bytes 必须按**剔完失败项之后**的 files 算：失败的文件既不在 files 里，
    // 它的字节也不能还留在 bytes 里（否则清单自己前后矛盾）。
    totals: {
      files: 成功文件.length,
      bytes: 成功文件.reduce((sum, file) => sum + file.size, 0),
      uploadedBytes: 上传字节,
      skipped: skipped.length,
    },
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

// ─────────────────────────────────────────────────────────────────────────────
// 预览与恢复（spec §6）
// ─────────────────────────────────────────────────────────────────────────────

export interface PreviewInput {
  readonly manifest: Manifest
  readonly scope: string
}

/** 预览：逐文件比对并列出「仅本地」。条数有上限（spec §6.2）。 */
export async function runPreview(deps: RunDeps, input: PreviewInput): Promise<RestorePreview> {
  const 目标 = input.manifest.files.filter((file) => isPathInScope(input.scope, file.path))
  const entries: RestorePreviewEntry[] = []
  const counts: Record<PreviewStatus, number> = { missing: 0, same: 0, different: 0, "type-mismatch": 0 }
  for (const file of 目标) {
    检查取消(deps)
    const 绝对 = join(deps.directory, ...file.path.split("/"))
    let 本地: Stats | undefined
    try {
      本地 = await lstat(绝对)
    } catch {
      counts.missing += 1
      if (entries.length < PREVIEW_LIMIT) entries.push({ path: file.path, status: "missing" })
      continue
    }
    let status: PreviewStatus
    // 符号链接（不论指向哪里）与目录都算类型冲突：恢复时既不写穿、也不删目录。
    if (!本地.isFile()) status = "type-mismatch"
    else if (本地.size !== file.size) status = "different"
    else {
      const 本地hash = await hashFile(绝对).catch(() => undefined)
      status = 本地hash === file.hash ? "same" : "different"
    }
    counts[status] += 1
    if (entries.length < PREVIEW_LIMIT) entries.push({ path: file.path, status })
  }

  const 清单里 = new Set(目标.map((file) => file.path))
  const localOnly: string[] = []
  let 仅本地超限 = false
  for (const file of (await scanScope(deps.directory, input.scope)).files) {
    if (清单里.has(file.path)) continue
    if (localOnly.length >= LOCAL_ONLY_LIMIT) {
      仅本地超限 = true
      break
    }
    localOnly.push(file.path)
  }

  return {
    snapshotId: input.manifest.id,
    scope: input.scope,
    counts,
    entries,
    truncated: 目标.length > entries.length,
    localOnly,
    localOnlyTruncated: 仅本地超限,
  }
}

export interface RestoreInput {
  readonly manifest: Manifest
  readonly scope: string
  readonly global: RestoreDecision
  readonly decisions: Readonly<Record<string, RestoreDecision>>
}

/** 恢复。逐文件：临时文件 → 边写边校验 → rename 两次（spec §6.4）。 */
export async function runRestore(deps: RunDeps, input: RestoreInput): Promise<RestoreResult> {
  const 目标 = input.manifest.files.filter((file) => isPathInScope(input.scope, file.path))
  const restored: string[] = []
  const keptBoth: string[] = []
  const skipped: string[] = []
  const failed: { path: string; reason: string }[] = []
  let cancelled = false

  // 空目录先建（spec §6.4）
  for (const dir of input.manifest.dirs) {
    if (!isPathInScope(input.scope, dir)) continue
    try {
      await mkdir(join(deps.directory, ...dir.split("/")), { recursive: true })
    } catch {
      // 目录建不出来时具体文件会逐个失败，不在这里吞掉整个恢复。
    }
  }

  for (const file of 目标) {
    if (deps.isCancelled()) {
      cancelled = true
      break
    }
    const 绝对 = join(deps.directory, ...file.path.split("/"))
    const 决定 = input.decisions[file.path] ?? input.global
    let 本地: Stats | undefined
    try {
      本地 = await lstat(绝对)
    } catch {
      本地 = undefined
    }

    // 不写穿符号链接；类型冲突只允许跳过（覆盖要先删用户目录，本版不给）。
    if (本地 !== undefined && !本地.isFile()) {
      failed.push({ path: file.path, reason: 本地.isSymbolicLink() ? "symlink" : "type-mismatch" })
      continue
    }
    if (本地 !== undefined && 本地.size === file.size) {
      const 本地hash = await hashFile(绝对).catch(() => undefined)
      if (本地hash === file.hash) {
        skipped.push(file.path)
        continue
      }
    }
    if (本地 !== undefined && 决定 === "skip") {
      skipped.push(file.path)
      continue
    }

    let 目标路径 = file.path
    if (本地 !== undefined && 决定 === "keep-both") {
      目标路径 = keepBothName(file.path, input.manifest.createdAt, (candidate) => {
        try {
          lstatSync(join(deps.directory, ...candidate.split("/")))
          return true
        } catch {
          return false
        }
      })
    }
    const 目标绝对 = join(deps.directory, ...目标路径.split("/"))
    try {
      await mkdir(dirname(目标绝对), { recursive: true })
      const body = await deps.store.openBlob({ hash: file.hash })
      if (body === undefined) {
        failed.push({ path: file.path, reason: "blob-missing" })
        continue
      }
      const 临时 = join(dirname(目标绝对), `.openhive-restore-${randomUUID()}.tmp`)
      const hash = createHash("sha256")
      let 收到 = 0
      const 句柄 = await open(临时, "w")
      try {
        for await (const chunk of body) {
          hash.update(chunk)
          收到 += chunk.byteLength
          await 句柄.write(chunk)
        }
        await 句柄.sync()
      } finally {
        await 句柄.close()
      }
      // 校验必须在 rename **之前**：内容不对时目标一个字都不该动。
      if (hash.digest("hex") !== file.hash || 收到 !== file.size) {
        await rm(临时, { force: true })
        failed.push({ path: file.path, reason: "hash-mismatch" })
        continue
      }
      // 只有「写回原路径的覆盖」才需要把旧文件挪开；keep-both 的目标是**新名字**，
      // 旧文件原地不动（把 `目标绝对` 当旧文件挪会直接 ENOENT——brief 里的写法就有这一处）。
      const 旧 =
        本地 !== undefined && 目标路径 === file.path
          ? join(dirname(目标绝对), `.openhive-old-${randomUUID()}`)
          : undefined
      if (旧) await rename(目标绝对, 旧)
      await rename(临时, 目标绝对)
      if (旧) await rm(旧, { force: true })
      if (file.mode !== undefined && process.platform !== "win32") await chmod(目标绝对, file.mode)
      await utimes(目标绝对, file.mtimeMs / 1000, file.mtimeMs / 1000)
      if (目标路径 === file.path) restored.push(file.path)
      else keptBoth.push(file.path)
    } catch (error) {
      failed.push({ path: file.path, reason: error instanceof Error ? error.message : "unknown" })
      // 临时文件兜底清理（本目录内所有本实现的临时文件；幂等，失败不升级成第二个错误）。
      try {
        for (const name of readdirSync(dirname(目标绝对))) {
          if (name.startsWith(".openhive-restore-")) rmSync(join(dirname(目标绝对), name), { force: true })
        }
      } catch {
        // 目录都不在了就没有临时文件要清；原错误已经记进 failed。
      }
    }
  }

  return { restored, keptBoth, skipped, failed, cancelled }
}
