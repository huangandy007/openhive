DROP TABLE IF EXISTS auth.case_table_format;

--> statement-breakpoint

ALTER TABLE auth.case_ingest_job DROP COLUMN IF EXISTS source_path;
