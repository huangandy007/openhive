-- 0045 回滚：逆序 —— 先删两条索引，再删 5 个列。
DROP INDEX IF EXISTS auth.case_material_probe_queue;

--> statement-breakpoint

DROP INDEX IF EXISTS auth.case_ingest_job_material_recent;

--> statement-breakpoint

ALTER TABLE auth.case_material DROP COLUMN IF EXISTS probe;

--> statement-breakpoint

ALTER TABLE auth.case_ingest_job DROP COLUMN IF EXISTS reason_code;

--> statement-breakpoint

ALTER TABLE auth.case_ingest_job DROP COLUMN IF EXISTS progress;

--> statement-breakpoint

ALTER TABLE auth.case_ingest_job DROP COLUMN IF EXISTS adapter_id;

--> statement-breakpoint

ALTER TABLE auth.case_ingest_job DROP COLUMN IF EXISTS adapter_version;
