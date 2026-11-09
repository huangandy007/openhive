ALTER TABLE auth.case_fact_row DROP CONSTRAINT IF EXISTS case_fact_row_direction;

--> statement-breakpoint

ALTER TABLE auth.case_fact_row
  DROP COLUMN IF EXISTS counterparty_name,
  DROP COLUMN IF EXISTS owner_account,
  DROP COLUMN IF EXISTS direction;
