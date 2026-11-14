ALTER TABLE auth.case_material DROP COLUMN IF EXISTS format_fingerprints;

--> statement-breakpoint

DROP INDEX IF EXISTS auth.case_source_profile_active;

--> statement-breakpoint

DROP TABLE IF EXISTS auth.case_source_profile;
