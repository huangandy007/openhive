/**
 * 文件级备份快照的审计写入（spec §9.3）。
 *
 * 与 `project-member.ts` 同一个形状：只认一个 `execute(query)` 的窄目标——测试能直接塞
 * PGlite 连接，生产塞 `OpenhivePg` 的池。**审计写失败不让主流程失败**是调用方的责任
 * （`backup.ts` 里 `.catch(() => undefined)`），不是这里的。
 */

import { sql } from "drizzle-orm"
import { rowsOf } from "./migrate"
import type { ProjectMemberTarget } from "./project-member"

export interface BackupEventInput {
  readonly projectId: string
  readonly userId: string
  readonly action: "backup" | "restore" | "delete-snapshot" | "auto-backup-paused"
  readonly snapshotId?: string
  readonly detail?: Record<string, unknown>
}

export interface BackupEventRow {
  readonly id: number
  readonly project_id: string
  readonly user_id: string
  readonly action: string
  readonly snapshot_id: string | null
  readonly detail: unknown
  readonly created_at: number
}

export async function recordBackupEvent(target: ProjectMemberTarget, event: BackupEventInput): Promise<void> {
  await target.execute(
    sql`INSERT INTO auth.project_backup_event (project_id, user_id, action, snapshot_id, detail, created_at)
        VALUES (${event.projectId}, ${event.userId}, ${event.action}, ${event.snapshotId ?? null},
                ${event.detail === undefined ? null : JSON.stringify(event.detail)}::jsonb,
                ${Math.floor(Date.now() / 1000)})`,
  )
}

export async function listBackupEvents(
  target: ProjectMemberTarget,
  projectId: string,
  limit = 50,
): Promise<readonly BackupEventRow[]> {
  const result = await target.execute(
    sql`SELECT id, project_id, user_id, action, snapshot_id, detail, created_at
        FROM auth.project_backup_event
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}`,
  )
  // 两种驱动形状不同：PGlite 挂 `rows`、bun-sql 直接给行数组（见 `migrate.ts` 的 `rowsOf`）。
  // 列形状也不同（`LEARNINGS #002-01`）：bun-sql 把 JSONB 原样吐成文本、BIGINT 吐成 BigInt，
  // PGlite 则给对象 / number。出口统一成 `BackupEventRow`，否则「读回来的是什么」随驱动漂。
  return rowsOf(result).map(toBackupEventRow)
}

/** 把一行（驱动形状各异）收敛成 `BackupEventRow`。 */
function toBackupEventRow(row: Record<string, unknown>): BackupEventRow {
  return {
    id: Number(row.id),
    project_id: String(row.project_id),
    user_id: String(row.user_id),
    action: String(row.action),
    snapshot_id: asNullableText(row.snapshot_id),
    detail: parseDetail(row.detail),
    created_at: Number(row.created_at),
  }
}

/** `text` 列只可能是字符串或 `NULL`；未知形状按 `NULL` 收（同 `project-member.ts` 的 `asBool` 取向）。 */
function asNullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/** JSONB 在 bun-sql 下是文本、在 PGlite 下已是对象；两种都吐成对象（`NULL` 保持 `null`）。 */
function parseDetail(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
