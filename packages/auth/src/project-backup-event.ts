/**
 * 文件级备份快照的审计写入（spec §9.3）。
 *
 * 与 `project-member.ts` 同一个形状：只认一个 `execute(query)` 的窄目标——测试能直接塞
 * PGlite 连接，生产塞 `OpenhivePg` 的池。**审计写失败不让业务流程失败**是调用方的责任，
 * 但调用方**必须 catch 并记日志**（spec §5.6 / §9.3），不是静默吞掉。
 */

import { sql } from "drizzle-orm"
import { rowsOf } from "./migrate"
import type { ProjectMemberTarget } from "./project-member"

/** spec §9.3 的动作闭集（下划线写法，与 spec 逐字一致）。 */
export type BackupAction = "backup" | "restore" | "preview" | "delete_snapshot" | "gc"

/** 一次审计的结局。 */
export type BackupResult = "ok" | "partial" | "failed" | "cancelled"

/** 触发方式：手动 / 自动。 */
export type BackupKind = "manual" | "auto"

export interface BackupEventInput {
  readonly projectId: string
  readonly userId: string
  readonly action: BackupAction
  readonly snapshotId?: string | null
  /** 备份范围（如 `资料/甲`）；缺省空串，与 DDL 的 `DEFAULT ''` 一致。 */
  readonly scope?: string
  readonly kind?: BackupKind | null
  readonly files?: number
  readonly bytes?: number
  /** 必填：DDL 是 `NOT NULL` 且无默认值。 */
  readonly result: BackupResult
  readonly errorCode?: string | null
  readonly durationMs?: number
}

export interface BackupEventRow {
  readonly id: number
  readonly user_id: string
  readonly project_id: string
  readonly action: string
  readonly snapshot_id: string | null
  readonly scope: string
  readonly kind: string | null
  readonly files: number
  readonly bytes: number
  readonly result: string
  readonly error_code: string | null
  readonly duration_ms: number
  readonly created_at: number
}

export async function recordBackupEvent(target: ProjectMemberTarget, event: BackupEventInput): Promise<void> {
  await target.execute(
    sql`INSERT INTO auth.project_backup_event
          (user_id, project_id, action, snapshot_id, scope, kind, files, bytes, result, error_code, duration_ms,
           created_at)
        VALUES (${event.userId}, ${event.projectId}, ${event.action}, ${event.snapshotId ?? null},
                ${event.scope ?? ""}, ${event.kind ?? null}, ${event.files ?? 0}, ${event.bytes ?? 0},
                ${event.result}, ${event.errorCode ?? null}, ${event.durationMs ?? 0},
                ${Math.floor(Date.now() / 1000)})`,
  )
}

export async function listBackupEvents(
  target: ProjectMemberTarget,
  projectId: string,
  limit = 50,
): Promise<readonly BackupEventRow[]> {
  const result = await target.execute(
    sql`SELECT id, user_id, project_id, action, snapshot_id, scope, kind, files, bytes, result, error_code,
               duration_ms, created_at
        FROM auth.project_backup_event
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}`,
  )
  // 两种驱动形状不同：PGlite 挂 `rows`、bun-sql 直接给行数组（见 `migrate.ts` 的 `rowsOf`）。
  // 列形状也不同（`LEARNINGS #002-01`）：bun-sql 把 BIGINT 吐成 BigInt、PGlite 给 number。
  // 出口统一成 `BackupEventRow`，否则「读回来的是什么」随驱动漂。
  return rowsOf(result).map(toBackupEventRow)
}

/** 把一行（驱动形状各异）收敛成 `BackupEventRow`：`id` / `bytes` / `created_at` 一律转 number。 */
function toBackupEventRow(row: Record<string, unknown>): BackupEventRow {
  return {
    id: Number(row.id),
    user_id: String(row.user_id),
    project_id: String(row.project_id),
    action: String(row.action),
    snapshot_id: asNullableText(row.snapshot_id),
    scope: String(row.scope),
    kind: asNullableText(row.kind),
    files: Number(row.files),
    bytes: Number(row.bytes),
    result: String(row.result),
    error_code: asNullableText(row.error_code),
    duration_ms: Number(row.duration_ms),
    created_at: Number(row.created_at),
  }
}

/** `text` 列只可能是字符串或 `NULL`；未知形状按 `NULL` 收（同 `project-member.ts` 的 `asBool` 取向）。 */
function asNullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null
}
