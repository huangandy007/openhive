-- 0044_case_card_template_editor：卡片模板编辑器内核（P4，2026-11-14）。
--
-- 1) 用户模板「停用」保留行：历史卡片可追溯、已验证卡片仍可被 AI 查询；
-- 2) 同项目同事件类型只允许一个启用中的**用户**模板（内置行不受限）；
-- 3) 解析请求可人工指定模板，随作业行透传。

ALTER TABLE auth.case_card_template ADD COLUMN IF NOT EXISTS disabled_at integer;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS case_card_template_active_user
  ON auth.case_card_template (project_id, event_type)
  WHERE disabled_at IS NULL AND id LIKE '用户:%';

--> statement-breakpoint

ALTER TABLE auth.case_ingest_job ADD COLUMN IF NOT EXISTS template_id text;

--> statement-breakpoint

COMMENT ON COLUMN auth.case_card_template.disabled_at IS
  '用户模板停用时间；内置模板恒为 NULL。停用保留行，历史卡片可追溯、已验证卡片仍可被 AI 查询。';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_ingest_job.template_id IS
  '人工指定的卡片模板（解析请求 templateId）；NULL = 按表自动建议。';
