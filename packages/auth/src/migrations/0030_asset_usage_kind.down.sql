ALTER TABLE auth.asset_usage_event DROP CONSTRAINT IF EXISTS asset_usage_event_kind_check;

--> statement-breakpoint

ALTER TABLE auth.asset_usage_event DROP COLUMN IF EXISTS tool_name;

--> statement-breakpoint

ALTER TABLE auth.asset_usage_event DROP COLUMN IF EXISTS kind;
