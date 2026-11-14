-- 0044 回滚：逆序撤除。
ALTER TABLE auth.case_ingest_job DROP COLUMN IF EXISTS template_id;

--> statement-breakpoint

DROP INDEX IF EXISTS auth.case_card_template_active_user;

--> statement-breakpoint

ALTER TABLE auth.case_card_template DROP COLUMN IF EXISTS disabled_at;
