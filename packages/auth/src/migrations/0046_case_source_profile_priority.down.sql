-- 0046 回滚：删这 4 列。
ALTER TABLE auth.case_source_profile DROP COLUMN IF EXISTS hints;

--> statement-breakpoint

ALTER TABLE auth.case_source_profile DROP COLUMN IF EXISTS rule_version;

--> statement-breakpoint

ALTER TABLE auth.case_source_profile DROP COLUMN IF EXISTS priority;

--> statement-breakpoint

ALTER TABLE auth.case_source_profile DROP COLUMN IF EXISTS optional_headers;
