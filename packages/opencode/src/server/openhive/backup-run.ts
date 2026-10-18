/**
 * 备份 / 预览 / 恢复的**执行层**（没有 HTTP、没有 Effect）。
 *
 * 阶段顺序是**写死的**（spec §5.6）：扫描 → 哈希 → 上传 → 写 manifest。取消只在阶段边界与
 * 文件边界检查；取消或失败**不写 manifest** ⇒ 不会留下「半份备份看起来像完整备份」。
 */

import { createHash, randomBytes, randomUUID } from "node:crypto"
import { createReadStream, lstatSync, readdirSync, rmSync, type Stats } from "node:fs"
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm, stat, utimes } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
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
  /** 测试注入的改名（恢复的两步 rename 要可确定地制造失败）；不传就是 `node:fs/promises` 的 `rename`。 */
  readonly renameFile?: (from: string, to: string) => Promise<void>
}

export interface BackupInput {
  readonly kind: SnapshotKind
  readonly scope: string
  readonly createdBy: string
  /** 只有自动备份会传：用来复用哈希、并判「树没变」。 */
  readonly previous?: Manifest
  readonly quotaBytes?: number
  readonly usageBytes?: number
  /**
   * HTTP 预检已经跑过的扫描 / 哈希结果（spec §8.3）：给了就**不再读一遍盘**。
   * 预检公式与执行层共用同一次计算，避免「预检一套、执行另一套」（`#002-06`）。
   */
  readonly prepared?: PreparedBackup
}

/** 扫描 ＋ 哈希 ＋ 缺失 blob 计算的产物（`prepareBackup` 的返回值）。 */
export interface PreparedBackup {
  readonly files: readonly ManifestFile[]
  readonly dirs: readonly string[]
  readonly skipped: readonly ManifestSkip[]
  readonly missing: ReadonlyMap<string, { readonly size: number; readonly path: string }>
  readonly logicalBytes: number
  readonly requiredBytes: number
  readonly filesTotal: number
  readonly filesDone: number
  readonly bytesTotal: number
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

type 路径守卫结果 = "ok" | "symlink" | "unreadable"

/**
 * 沿相对路径**逐段**检查：已存在的前缀只要有一段是符号链接就拒；不存在的尾巴允许
 * （调用方的 `mkdir` 会建真目录），再用 `realpath` 复核最深已存在前缀的真身
 * 是否恰好等于「项目根真身 ＋ 相对尾段」——处理 win32 junction / 8.3 短名
 * （同 `file.ts:461 realInside` 的写法）。任何取不到 realpath 的情形 fail-closed。
 *
 * ⚠️ 只 `lstat` 完整路径的最后一段**不够**：`资料` 是目录符号链接时，
 * `lstat(<根>/资料/甲.txt)` 会穿过它，`mkdir` ＋ `rename` 就把文件写到项目外。
 */
async function 检查路径(directory: string, path: string): Promise<路径守卫结果> {
  const 段 = path === "" ? [] : path.split("/")
  const 真根 = await realpath(directory).catch(() => undefined)
  if (真根 === undefined) return "unreadable"
  let 最深存在 = directory
  for (let i = 0; i < 段.length; i += 1) {
    const 绝对 = join(directory, ...段.slice(0, i + 1))
    let 信息: Stats
    try {
      信息 = await lstat(绝对)
    } catch {
      break // 不存在的尾巴：再深的段也不可能存在
    }
    if (信息.isSymbolicLink()) return "symlink"
    最深存在 = 绝对
    if (i < 段.length - 1 && !信息.isDirectory()) break // 中间是非目录：后面的路走不通
  }
  const 真路径 = await realpath(最深存在).catch(() => undefined)
  if (真路径 === undefined) return "unreadable"
  return 真路径 === join(真根, relative(directory, 最深存在)) ? "ok" : "symlink"
}

/** 被占用（win32 `EBUSY` / `EPERM`）时重试 3 次；别的错误原样抛。 */
async function 重命名(
  改名: (from: string, to: string) => Promise<void>,
  from: string,
  to: string,
): Promise<void> {
  let 最后: unknown
  for (let 尝试 = 0; 尝试 < 3; 尝试 += 1) {
    try {
      await 改名(from, to)
      return
    } catch (error) {
      最后 = error
      const code =
        typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
      if (code !== "EBUSY" && code !== "EPERM") throw error
    }
  }
  throw 最后
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
  // 备份侧同一条洞：scope 指向链接内部时，读的是沙箱外的文件。根路径本身是链接
  // （或中间段是链接）一律不读，按 skipped 记账；不存在的 scope 仍走下面的 NotFoundError。
  if (scope !== "") {
    const 守卫 = await 检查路径(directory, scope)
    if (守卫 !== "ok") {
      return { files: [], dirs: [], skipped: [{ path: scope, reason: 守卫 === "symlink" ? "symlink" : "unreadable" }] }
    }
  }
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

/**
 * 扫描 ＋ 哈希 ＋ 缺失 blob / 配额需要量。
 *
 * HTTP 预检与执行层**共用这一段**（spec §8.3）：预检算过的结果通过 `BackupInput.prepared`
 * 传给 `runBackup`，后者不再读一遍盘——否则「预检按一个公式、执行按另一个」迟早漂（`#002-06`）。
 */
export async function prepareBackup(deps: RunDeps, input: BackupInput): Promise<PreparedBackup> {
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
        // `bytesDone` 是「**已处理**的源文件字节」，不是「已上传」：明确跳过的文件也算处理过。
        // 上传阶段另建 `total`（`bytesDone: 0`，只计新上传 blob）——增量备份百分比偏低是接受的语义。
        total.bytesDone += file.size
        deps.report({ progress: { ...total } })
        continue
      }
    }
    files.push({ path: file.path, hash, size: file.size, mtimeMs: file.mtimeMs, mode: file.mode })
    total.filesDone += 1
    // 命中缓存（auto 的 size/mtime 未变）走的也是这一支：它同样算「已处理字节」，
    // 否则校验阶段的字节进度会一直钉在 0（窄条在 `bytesTotal > 0` 时按字节算百分比）。
    total.bytesDone += file.size
    deps.report({ progress: { ...total } })
  }

  检查取消(deps)
  const 已有 = new Set((await deps.store.blobs()).map((blob) => blob.hash))
  const 缺 = new Map<string, { size: number; path: string }>()
  for (const file of files) if (!已有.has(file.hash) && !缺.has(file.hash)) 缺.set(file.hash, { size: file.size, path: file.path })

  const logicalBytes = files.reduce((sum, file) => sum + file.size, 0)
  const requiredBytes = [...缺.values()].reduce((sum, blob) => sum + blob.size, 0) + estimateManifestBytes(logicalBytes)
  return {
    files,
    dirs: 扫描.dirs,
    skipped,
    missing: 缺,
    logicalBytes,
    requiredBytes,
    filesTotal: total.filesTotal,
    filesDone: total.filesDone,
    bytesTotal: total.bytesTotal,
  }
}

/** 备份。返回写进 MinIO 的 manifest。 */
export async function runBackup(deps: RunDeps, input: BackupInput): Promise<Manifest> {
  const 预 = input.prepared ?? (await prepareBackup(deps, input))
  const files = [...预.files]
  const skipped = [...预.skipped]

  检查取消(deps)
  if (input.previous && 树没变(input.previous, files, [...预.dirs], input.scope)) throw new UnchangedError("自上次快照以来没有变化")

  if (input.quotaBytes !== undefined && (input.usageBytes ?? 0) + 预.requiredBytes > input.quotaBytes) {
    throw new QuotaError(input.usageBytes ?? 0, 预.requiredBytes, input.quotaBytes)
  }

  const total = { filesTotal: 预.filesTotal, filesDone: 预.filesDone, bytesTotal: 预.bytesTotal, bytesDone: 0 }
  deps.report({ state: "uploading", progress: { ...total } })
  // 单个 blob 失败**不中止整轮**（spec §5.5：任一文件最终失败 ⇒ 记入 skipped，快照落 partial）：
  // 清掉半截对象、记下原因，其余 blob 继续。`changed-during-backup` 原样保留，其余归 `upload-failed`。
  const 上传失败 = new Map<string, SkipReason>()
  await runPool([...预.missing.entries()], deps.concurrency ?? 并发, async ([hash, blob]) => {
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
  const 上传字节 = [...预.missing.entries()]
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
    dirs: [...预.dirs],
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

/** 路径任一段是 `.git`（含裸目录本身）。前端同形判定见 `workspace-entry.tsx` 的 `需确认` / 恢复对话框的 `涉git`。 */
function 是git路径(path: string): boolean {
  return path.split("/").includes(".git")
}

/** 预览：逐文件比对并列出「仅本地」。条数有上限（spec §6.2）。 */
export async function runPreview(deps: RunDeps, input: PreviewInput): Promise<RestorePreview> {
  const 目标 = input.manifest.files.filter((file) => isPathInScope(input.scope, file.path))
  const entries: RestorePreviewEntry[] = []
  const counts: Record<PreviewStatus, number> = { missing: 0, same: 0, different: 0, "type-mismatch": 0 }
  // `.git` 必须按**全部**目标判（spec §6.4）：`entries` 只有 2000 条，截断之后再看就晚了（M-1）。
  let gitAffected = false
  for (const file of 目标) {
    if (是git路径(file.path)) gitAffected = true
    检查取消(deps)
    // 中间段是符号链接 ⇒ 不能读（lstat 会穿过去，比出来的「same」是链接外那个文件的）。
    if ((await 检查路径(deps.directory, file.path)) !== "ok") {
      counts["type-mismatch"] += 1
      if (entries.length < PREVIEW_LIMIT) entries.push({ path: file.path, status: "type-mismatch" })
      continue
    }
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
  // 本地 scope 已被删时预览整轮不该抛：逐条都判 missing、localOnly 为空（spec §6.2）。
  let 本地文件: ScannedFile[] = []
  try {
    本地文件 = (await scanScope(deps.directory, input.scope)).files
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error
  }
  for (const file of 本地文件) {
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
    gitAffected,
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

function 清理恢复临时(目录: string) {
  try {
    for (const name of readdirSync(目录)) {
      if (name.startsWith(".openhive-restore-")) rmSync(join(目录, name), { force: true })
    }
  } catch {
    // 目录都不在了就没有临时文件要清；不升级成第二个错误。
  }
}

/** 恢复。逐文件：临时文件 → 边写边校验 → rename 两次（spec §6.4）。 */
export async function runRestore(deps: RunDeps, input: RestoreInput): Promise<RestoreResult> {
  const 目标 = input.manifest.files.filter((file) => isPathInScope(input.scope, file.path))
  const restored: string[] = []
  const keptBoth: string[] = []
  const overwritten: string[] = []
  const skipped: string[] = []
  const dirsCreated: string[] = []
  const failed: { path: string; reason: string }[] = []
  const 改名 = deps.renameFile ?? rename
  let cancelled = false

  // 空目录先建（spec §6.4）。路径不合法 / 祖先有链接的目录一律不建（§9.5）。
  for (const dir of input.manifest.dirs) {
    if (!isPathInScope(input.scope, dir)) continue
    if (!isSafeRelativePath(dir)) continue
    if ((await 检查路径(deps.directory, dir)) !== "ok") continue
    const 绝对 = join(deps.directory, ...dir.split("/"))
    let 已存在 = false
    try {
      已存在 = (await lstat(绝对)).isDirectory()
    } catch {
      已存在 = false
    }
    try {
      await mkdir(绝对, { recursive: true })
      if (!已存在) dirsCreated.push(dir)
    } catch {
      // 目录建不出来时具体文件会逐个失败，不在这里吞掉整个恢复。
    }
  }

  for (const file of 目标) {
    if (deps.isCancelled()) {
      cancelled = true
      break
    }
    // §9.5：manifest 是不可信输入，写盘前再查一次路径形状（不合法 ⇒ 一个字节都不写）。
    if (!isSafeRelativePath(file.path)) {
      failed.push({ path: file.path, reason: "manifest-invalid" })
      continue
    }
    // 中间段是符号链接 ⇒ 永远写不了（不受决策影响）。
    if ((await 检查路径(deps.directory, file.path)) !== "ok") {
      failed.push({ path: file.path, reason: "symlink" })
      continue
    }
    const 绝对 = join(deps.directory, ...file.path.split("/"))
    const 决定 = input.decisions[file.path] ?? input.global
    let 本地: Stats | undefined
    try {
      本地 = await lstat(绝对)
    } catch {
      本地 = undefined
    }

    // 目标存在且不是普通文件（spec §6.3 / §13.2#23）：
    // 符号链接永远拒；目录在 overwrite 下整体替换，skip 下跳过，其余决策记 type-mismatch。
    let 覆盖目录 = false
    if (本地 !== undefined && !本地.isFile()) {
      if (本地.isSymbolicLink()) {
        failed.push({ path: file.path, reason: "symlink" })
        continue
      }
      if (决定 === "skip") {
        skipped.push(file.path)
        continue
      }
      if (决定 !== "overwrite") {
        failed.push({ path: file.path, reason: "type-mismatch" })
        continue
      }
      覆盖目录 = true
    }
    if (本地 !== undefined && !覆盖目录 && 本地.size === file.size) {
      const 本地hash = await hashFile(绝对).catch(() => undefined)
      if (本地hash === file.hash) {
        skipped.push(file.path)
        continue
      }
    }
    if (本地 !== undefined && !覆盖目录 && 决定 === "skip") {
      skipped.push(file.path)
      continue
    }

    let 目标路径 = file.path
    if (本地 !== undefined && !覆盖目录 && 决定 === "keep-both") {
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
    let 回滚失败 = false
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
        failed.push({ path: file.path, reason: "blob-corrupt" })
        continue
      }
      // 只有「写回原路径」才需要把旧文件 / 旧目录挪开；keep-both 的目标是**新名字**，
      // 旧文件原地不动（把 `目标绝对` 当旧文件挪会直接 ENOENT）。
      const 旧 =
        本地 !== undefined && 目标路径 === file.path
          ? join(dirname(目标绝对), `.openhive-old-${randomUUID()}`)
          : undefined
      if (旧 !== undefined) await 重命名(改名, 目标绝对, 旧)
      try {
        await 重命名(改名, 临时, 目标绝对)
      } catch (error) {
        if (旧 === undefined) throw error
        // 第二步失败 ⇒ 把旧文件 / 旧目录放回原路径（spec §6.4 第 8 步）。
        try {
          await 重命名(改名, 旧, 目标绝对)
        } catch {
          回滚失败 = true
          // `.openhive-old-*` 保留在原处，路径写进 reason：不许静默丢用户文件。
          failed.push({ path: file.path, reason: `rollback-failed:${旧}` })
        }
        if (回滚失败) {
          清理恢复临时(dirname(目标绝对))
          continue
        }
        throw error
      }
      if (旧 !== undefined) await rm(旧, { recursive: true, force: true })
      if (file.mode !== undefined && process.platform !== "win32") await chmod(目标绝对, file.mode)
      await utimes(目标绝对, file.mtimeMs / 1000, file.mtimeMs / 1000)
      if (覆盖目录) overwritten.push(file.path)
      else if (目标路径 === file.path) restored.push(file.path)
      else keptBoth.push(file.path)
    } catch (error) {
      if (!回滚失败) failed.push({ path: file.path, reason: error instanceof Error ? error.message : "unknown" })
      清理恢复临时(dirname(目标绝对))
    }
  }

  return { restored, keptBoth, overwritten, skipped, dirsCreated, failed, cancelled }
}
