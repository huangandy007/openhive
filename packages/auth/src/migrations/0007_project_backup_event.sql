-- 文件级备份快照的审计流水（2026-10-18，spec §9.3）。
-- 只增不改：每一次备份 / 恢复 / 删除恢复点 / 自动备份暂停都留一行。
-- 不存文件内容，`detail` 只放可检索的摘要（条数、字节数、冲突策略）。

CREATE TABLE IF NOT EXISTS auth.project_backup_event (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  snapshot_id TEXT,
  detail JSONB,
  created_at BIGINT NOT NULL
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS project_backup_event_project_created_idx
  ON auth.project_backup_event (project_id, created_at DESC);

--> statement-breakpoint

COMMENT ON TABLE auth.project_backup_event IS
  '文件级备份快照审计（只增不改）；created_at 是 Unix 秒，与 auth 其它表同口径';
