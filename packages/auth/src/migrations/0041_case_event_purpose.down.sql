ALTER TABLE auth.case_event DROP COLUMN IF EXISTS purpose_basis;

--> statement-breakpoint

ALTER TABLE auth.case_event DROP COLUMN IF EXISTS purpose_l1;

--> statement-breakpoint

ALTER TABLE auth.case_event DROP COLUMN IF EXISTS purpose;

--> statement-breakpoint

DROP INDEX IF EXISTS auth.case_event_purpose;
