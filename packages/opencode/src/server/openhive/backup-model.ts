/**
 * 文件级备份快照的**词表**（2026-10-18，spec `2026-10-18-file-backup-snapshot-design.md`）。
 *
 * 本文件只有常量与类型，没有逻辑——逻辑在 `backup-rules.ts`（纯函数）与 `backup-run.ts`（执行）。
 * 分开的理由与 `project-data.ts` 同：让「一份判断」只有一个住处，两边不会漂。
 */

/** 备份对象的中间前缀段。与归档镜像 `{userId}/{projectId}/` 严格分开。 */
export const BACKUP_NAMESPACE = "_openhive-backups"

export const MANIFEST_VERSION = 1 as const
export const STATE_VERSION = 1 as const

/** 每（用户 × 项目）容量上限：10 GiB（spec §8.3）。 */
export const QUOTA_BYTES = 10 * 1024 ** 3
/** 单文件上限：5 GB（spec §5.3）。 */
export const MAX_FILE_BYTES = 5 * 1024 ** 3
/** GC 宽限：24 小时（spec §8.4）。 */
export const GC_GRACE_MS = 24 * 60 * 60 * 1000
/** 自动备份冷却：1 小时（spec §7.2）。 */
export const AUTO_COOLDOWN_MS = 60 * 60 * 1000
/** 活跃窗口：30 分钟（spec §7.2）。 */
export const ACTIVE_WINDOW_MS = 30 * 60 * 1000
/** 任务终态在内存里留 10 分钟（spec §5.8）。 */
export const JOB_TTL_MS = 10 * 60 * 1000
/** 预览最多 2000 条（spec §6.2）。 */
export const PREVIEW_LIMIT = 2000
/** 预览里「仅本地」最多 100 条（spec §6.2）。 */
export const LOCAL_ONLY_LIMIT = 100
/** 一次列恢复点最多 200 条（spec §10.1）。 */
export const MANIFEST_LIST_LIMIT = 200

export type SnapshotKind = "manual" | "auto"
export type SnapshotStatus = "complete" | "partial"
export type SkipReason =
  | "excluded"
  | "too-large"
  | "unreadable"
  | "changed-during-backup"
  | "symlink"
  | "upload-failed"

export interface ManifestFile {
  readonly path: string
  readonly hash: string
  readonly size: number
  readonly mtimeMs: number
  readonly mode?: number
}

export interface ManifestSkip {
  readonly path: string
  readonly reason: SkipReason
}

export interface ManifestTotals {
  readonly files: number
  readonly bytes: number
  readonly uploadedBytes: number
  readonly skipped: number
}

export interface Manifest {
  readonly version: typeof MANIFEST_VERSION
  readonly id: string
  readonly projectId: string
  readonly ownerId: string
  readonly kind: SnapshotKind
  /** `""` ＝ 整个项目；否则是项目内相对路径。 */
  readonly scope: string
  readonly createdAt: number
  readonly createdBy: string
  readonly source: "manual" | "auto"
  readonly timezone: string
  readonly status: SnapshotStatus
  readonly files: readonly ManifestFile[]
  readonly dirs: readonly string[]
  readonly skipped: readonly ManifestSkip[]
  readonly totals: ManifestTotals
}

export interface SnapshotSummary {
  readonly id: string
  readonly kind: SnapshotKind
  readonly scope: string
  readonly createdAt: number
  readonly status: SnapshotStatus
  readonly totals: ManifestTotals
}

export interface BackupState {
  readonly version: typeof STATE_VERSION
  readonly usageBytes: number
  readonly lastGcAt: number
  readonly autoPaused: boolean
  readonly snapshots: readonly SnapshotSummary[]
}

export type JobKind = "backup" | "preview" | "restore"

export type JobState =
  | "queued"
  | "scanning"
  | "hashing"
  | "uploading"
  | "committing"
  | "previewing"
  | "restoring"
  | "succeeded"
  | "failed"
  | "cancelled"

export interface JobError {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly path?: string
}

export interface JobProgress {
  readonly filesTotal: number
  readonly filesDone: number
  readonly bytesTotal: number
  readonly bytesDone: number
}

export interface Job {
  readonly id: string
  readonly kind: JobKind
  readonly userId: string
  readonly projectId: string
  readonly path: string
  readonly snapshotId?: string
  readonly state: JobState
  readonly progress: JobProgress
  readonly cancelRequested: boolean
  readonly startedAt: number
  readonly updatedAt: number
  readonly finishedAt?: number
  readonly error?: JobError
  readonly result?: unknown
}

export type RestoreDecision = "overwrite" | "keep-both" | "skip"
export type PreviewStatus = "missing" | "same" | "different" | "type-mismatch"

export interface RestorePreviewEntry {
  readonly path: string
  readonly status: PreviewStatus
}

export interface RestorePreview {
  readonly snapshotId: string
  readonly scope: string
  readonly counts: Record<PreviewStatus, number>
  readonly entries: readonly RestorePreviewEntry[]
  readonly truncated: boolean
  /**
   * 本次恢复的**完整目标集合**里有没有 `.git` 内部路径（spec §6.4）。
   *
   * 与 `entries` 的 2000 条上限**无关**：客户端只看 `entries` 的话，`.git/config` 排在第
   * 2001 位就能绕过确认（整支复审 M-1）。前端同形判定见 `workspace-entry.tsx` 的 `需确认`。
   */
  readonly gitAffected: boolean
  readonly localOnly: readonly string[]
  readonly localOnlyTruncated: boolean
}

export interface RestoreResult {
  readonly restored: readonly string[]
  readonly keptBoth: readonly string[]
  /** 目标原本是目录、按 `overwrite` 被整体替换成文件的路径（不算 `restored`）。 */
  readonly overwritten: readonly string[]
  readonly skipped: readonly string[]
  /** 本次**实际新建**的目录（清单里 scope 内、恢复前不存在的那些）。 */
  readonly dirsCreated: readonly string[]
  readonly failed: readonly { readonly path: string; readonly reason: string }[]
  readonly cancelled: boolean
}
