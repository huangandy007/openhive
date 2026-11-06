ALTER TABLE auth.case_event DROP COLUMN IF EXISTS basis_changed_at;

--> statement-breakpoint

ALTER TABLE auth.case_relation DROP COLUMN IF EXISTS basis_changed_at;

--> statement-breakpoint

DROP TABLE IF EXISTS auth.case_fact_change;
