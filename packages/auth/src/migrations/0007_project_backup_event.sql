-- 文件级备份快照的审计流水（2026-10-18，spec §9.3）。
-- 只增不改；不存文件内容；只记路径 / 大小 / 哈希统计。

CREATE TABLE IF NOT EXISTS auth.project_backup_event (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  action TEXT NOT NULL,
  snapshot_id TEXT,
  scope TEXT NOT NULL DEFAULT '',
  kind TEXT,
  files INTEGER NOT NULL DEFAULT 0,
  bytes BIGINT NOT NULL DEFAULT 0,
  result TEXT NOT NULL,
  error_code TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS project_backup_event_project_time
  ON auth.project_backup_event (project_id, created_at DESC);

--> statement-breakpoint

COMMENT ON TABLE auth.project_backup_event IS
  '文件级备份快照审计（只增不改）；不存文件内容；只记路径 / 大小 / 哈希统计；created_at 是 Unix 秒';
