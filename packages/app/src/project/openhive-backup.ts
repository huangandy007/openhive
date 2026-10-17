/**
 * 文件级备份快照的客户端（Task 13，2026-10-18）。
 *
 * 三态沿用 `openhive-files.ts`：`undefined` ＝ 取不到；`[]` ＝ 明确没有。
 *
 * ## ⚠️ 不带 `x-openhive-project` 头
 *
 * 服务端认的是请求体 / 查询串里的 `projectId`，而 `projectLocationLayer` 会把带那个头的
 * 请求套上「已归档 ⇒ 403」。备份自己的授权已经判过归档（读端点允许归档后查看），
 * 所以这里与 `openhive-members.ts` 同一口径：**项目身份走体 / 查询串**。
 *
 * ## 状态码是服务端实态，不是猜的（`server/openhive/backup.ts`）
 *
 * | 出口 | 成功码 |
 * |---|---|
 * | `POST /backup`、`/restore/preview`、`/restore`、`/jobs/:id/cancel` | **202** |
 * | `POST /backup/heartbeat` | **204**（无体） |
 * | `DELETE /backup/snapshots/:id` | **200** `{ deleted: true }`（幂等） |
 */

import { defaultSend, isRecord, readJson, trySend, type ForkFetch } from "./openhive-fetch"

export const BACKUP_PATH = "/openhive/project/backup"
export const BACKUP_STATUS_PATH = "/openhive/project/backup/status"
export const BACKUP_SNAPSHOTS_PATH = "/openhive/project/backup/snapshots"
export const BACKUP_PREVIEW_PATH = "/openhive/project/backup/restore/preview"
export const BACKUP_RESTORE_PATH = "/openhive/project/backup/restore"
export const BACKUP_HEARTBEAT_PATH = "/openhive/project/backup/heartbeat"
export const BACKUP_JOB_PATH = "/openhive/project/backup/jobs"

export type BackupSnapshotKind = "manual" | "auto"
export type BackupJobState =
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

export interface BackupSnapshot {
  readonly id: string
  readonly kind: BackupSnapshotKind
  readonly scope: string
  readonly createdAt: number
  readonly status: "complete" | "partial"
  readonly totals: {
    readonly files: number
    readonly bytes: number
    readonly uploadedBytes: number
    readonly skipped: number
  }
}

export interface BackupJob {
  readonly id: string
  readonly kind: "backup" | "preview" | "restore"
  readonly state: BackupJobState
  readonly progress: {
    readonly filesTotal: number
    readonly filesDone: number
    readonly bytesTotal: number
    readonly bytesDone: number
  }
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean }
  readonly result?: {
    readonly snapshotId?: string
    readonly preview?: BackupPreview
    readonly restore?: BackupRestoreResult
  }
}

export interface BackupStatus {
  readonly activeJob: BackupJob | null
  readonly lastSnapshot: { readonly id: string; readonly size: number; readonly lastModified: number } | null
  readonly usageBytes: number
  readonly limitBytes: number
  readonly autoPaused: boolean
}

export interface BackupSnapshotDetail extends BackupSnapshot {
  readonly projectId: string
  readonly ownerId: string
  readonly files: readonly {
    readonly path: string
    readonly hash: string
    readonly size: number
    readonly mtimeMs: number
  }[]
  readonly dirs: readonly string[]
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
}

export type RestoreDecision = "overwrite" | "keep-both" | "skip"

export interface BackupPreviewEntry {
  readonly path: string
  readonly status: "missing" | "same" | "different" | "type-mismatch"
}

export interface BackupPreview {
  readonly snapshotId: string
  readonly scope: string
  readonly counts: {
    readonly missing: number
    readonly same: number
    readonly different: number
    readonly "type-mismatch": number
  }
  readonly entries: readonly BackupPreviewEntry[]
  readonly truncated: boolean
  readonly localOnly: readonly string[]
  readonly localOnlyTruncated: boolean
}

export interface BackupRestoreResult {
  readonly restored: readonly string[]
  readonly keptBoth: readonly string[]
  readonly skipped: readonly string[]
  readonly failed: readonly { readonly path: string; readonly reason: string }[]
  readonly cancelled: boolean
}

function 收窄快照(value: unknown): BackupSnapshot | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== "string" || typeof value.createdAt !== "number") return undefined
  if (value.kind !== "manual" && value.kind !== "auto") return undefined
  if (value.status !== "complete" && value.status !== "partial") return undefined
  if (typeof value.scope !== "string" || !isRecord(value.totals)) return undefined
  const totals = value.totals
  if (typeof totals.files !== "number" || typeof totals.bytes !== "number") return undefined
  return {
    id: value.id,
    kind: value.kind,
    scope: value.scope,
    createdAt: value.createdAt,
    status: value.status,
    totals: {
      files: totals.files,
      bytes: totals.bytes,
      uploadedBytes: typeof totals.uploadedBytes === "number" ? totals.uploadedBytes : 0,
      skipped: typeof totals.skipped === "number" ? totals.skipped : 0,
    },
  }
}

async function 发(
  send: ForkFetch,
  url: string,
  init: RequestInit,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await trySend(send, url, init)
  if (!response) return { status: 0, body: undefined }
  const body = response.status === 204 ? undefined : await readJson(response)
  return { status: response.status, body }
}

export async function listSnapshots(
  projectId: string,
  path = "",
  send: ForkFetch = defaultSend,
): Promise<readonly BackupSnapshot[] | undefined> {
  const 查询 = new URLSearchParams({ projectId, path })
  const res = await 发(send, `${BACKUP_SNAPSHOTS_PATH}?${查询}`, { method: "GET", credentials: "same-origin" })
  if (res.status !== 200 || !isRecord(res.body) || !Array.isArray(res.body.snapshots)) return undefined
  return res.body.snapshots.map(收窄快照).filter((snapshot): snapshot is BackupSnapshot => snapshot !== undefined)
}

export async function backupStatus(
  projectId: string,
  send: ForkFetch = defaultSend,
): Promise<BackupStatus | undefined> {
  const res = await 发(send, `${BACKUP_STATUS_PATH}?${new URLSearchParams({ projectId })}`, {
    method: "GET",
    credentials: "same-origin",
  })
  if (res.status !== 200 || !isRecord(res.body)) return undefined
  const body = res.body
  if (typeof body.usageBytes !== "number" || typeof body.limitBytes !== "number") return undefined
  return {
    // `activeJob` 服务端恒回 `Job | null`（`backup.ts` 的 `contextStatus`）——这里收窄到「有 id」即可，
    // 逐字段抄一遍 `BackupJob` 没有增益：任务详情另有 `taskOf` 那条出口。
    // 形状不对 / 缺 id 退回 `null`，与服务端「没有任务」同义（契约里没有 `undefined` 这个值）。
    activeJob:
      isRecord(body.activeJob) && typeof body.activeJob.id === "string"
        ? // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 形状是服务端 `Job`（backup-model.ts），这里只判了「有没有 id」是为了不复制一份联合类型判定。
          (body.activeJob as unknown as BackupJob)
        : null,
    lastSnapshot:
      isRecord(body.lastSnapshot) && typeof body.lastSnapshot.id === "string"
        ? {
            id: body.lastSnapshot.id,
            size: typeof body.lastSnapshot.size === "number" ? body.lastSnapshot.size : 0,
            lastModified: typeof body.lastSnapshot.lastModified === "number" ? body.lastSnapshot.lastModified : 0,
          }
        : null,
    usageBytes: body.usageBytes,
    limitBytes: body.limitBytes,
    autoPaused: body.autoPaused === true,
  }
}

export async function snapshotDetail(
  projectId: string,
  snapshotId: string,
  send: ForkFetch = defaultSend,
): Promise<BackupSnapshotDetail | undefined> {
  const res = await 发(
    send,
    `${BACKUP_SNAPSHOTS_PATH}/${encodeURIComponent(snapshotId)}?${new URLSearchParams({ projectId })}`,
    { method: "GET", credentials: "same-origin" },
  )
  if (res.status !== 200 || !isRecord(res.body) || !Array.isArray(res.body.files)) return undefined
  const 快照 = 收窄快照(res.body)
  if (!快照) return undefined
  return {
    ...快照,
    projectId,
    ownerId: typeof res.body.ownerId === "string" ? res.body.ownerId : "",
    files: res.body.files.flatMap((file) =>
      isRecord(file) && typeof file.path === "string" && typeof file.size === "number"
        ? [
            {
              path: file.path,
              hash: typeof file.hash === "string" ? file.hash : "",
              size: file.size,
              mtimeMs: typeof file.mtimeMs === "number" ? file.mtimeMs : 0,
            },
          ]
        : [],
    ),
    dirs: Array.isArray(res.body.dirs) ? res.body.dirs.filter((dir): dir is string => typeof dir === "string") : [],
    skipped: Array.isArray(res.body.skipped)
      ? res.body.skipped.flatMap((skip) =>
          isRecord(skip) && typeof skip.path === "string" && typeof skip.reason === "string"
            ? [{ path: skip.path, reason: skip.reason }]
            : [],
        )
      : [],
  }
}

export async function backupProject(
  projectId: string,
  path = "",
  allowOverQuota = false,
  send: ForkFetch = defaultSend,
): Promise<{ jobId: string } | { code: string; jobId?: string } | undefined> {
  const res = await 发(send, BACKUP_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, path, allowOverQuota }),
  })
  if (res.status === 202 && isRecord(res.body) && typeof res.body.jobId === "string") return { jobId: res.body.jobId }
  if (res.status === 409 && isRecord(res.body)) {
    return {
      code: typeof res.body.code === "string" ? res.body.code : "job_running",
      ...(typeof res.body.jobId === "string" ? { jobId: res.body.jobId } : {}),
    }
  }
  return undefined
}

export async function previewRestore(
  projectId: string,
  input: { snapshotId: string; path: string },
  send: ForkFetch = defaultSend,
): Promise<string | undefined> {
  const res = await 发(send, BACKUP_PREVIEW_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, ...input }),
  })
  return res.status === 202 && isRecord(res.body) && typeof res.body.jobId === "string" ? res.body.jobId : undefined
}

export async function restoreBackup(
  projectId: string,
  input: { snapshotId: string; path: string; decision: RestoreDecision; decisions?: Record<string, RestoreDecision> },
  send: ForkFetch = defaultSend,
): Promise<string | undefined> {
  const res = await 发(send, BACKUP_RESTORE_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, ...input }),
  })
  return res.status === 202 && isRecord(res.body) && typeof res.body.jobId === "string" ? res.body.jobId : undefined
}

export async function deleteSnapshot(
  projectId: string,
  snapshotId: string,
  send: ForkFetch = defaultSend,
): Promise<boolean> {
  const res = await 发(
    send,
    `${BACKUP_SNAPSHOTS_PATH}/${encodeURIComponent(snapshotId)}?${new URLSearchParams({ projectId })}`,
    { method: "DELETE", credentials: "same-origin" },
  )
  return res.status === 200 || res.status === 204
}

export async function taskOf(jobId: string, send: ForkFetch = defaultSend): Promise<BackupJob | undefined> {
  const res = await 发(send, `${BACKUP_JOB_PATH}/${encodeURIComponent(jobId)}`, {
    method: "GET",
    credentials: "same-origin",
  })
  if (res.status !== 200 || !isRecord(res.body) || typeof res.body.id !== "string") return undefined
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- 服务端直接回 `Job`（backup-model.ts）；逐字段抄一份会多一个漂点，而这里唯一要判的是「这是不是一个任务」。
  return res.body as unknown as BackupJob
}

export async function cancelTask(jobId: string, send: ForkFetch = defaultSend): Promise<boolean> {
  const res = await 发(send, `${BACKUP_JOB_PATH}/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    credentials: "same-origin",
  })
  // 服务端 `handleCancel` 回 **202**（`{ cancelling }`）；200 是给旧版本留的宽口径。
  return res.status === 202 || res.status === 200
}

/** 心跳：失败不报错（最坏只是这个项目这一轮不算活跃）。 */
export async function backupHeartbeat(projectId: string, send: ForkFetch = defaultSend): Promise<boolean> {
  const res = await 发(send, BACKUP_HEARTBEAT_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  })
  return res.status === 204
}
