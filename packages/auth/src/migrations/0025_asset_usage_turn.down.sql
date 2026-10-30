DROP INDEX IF EXISTS auth.asset_usage_event_turn_idx;

--> statement-breakpoint

ALTER TABLE auth.asset_usage_event DROP COLUMN IF EXISTS turn_id;
