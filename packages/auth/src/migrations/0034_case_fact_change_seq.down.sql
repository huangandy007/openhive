ALTER TABLE auth.case_fact_change DROP CONSTRAINT IF EXISTS case_fact_change_explain_deny;

--> statement-breakpoint

ALTER TABLE auth.case_fact_change ADD CONSTRAINT case_fact_change_explain_deny CHECK (
  action NOT IN ('排除', '修正')
  OR (reason_kind IS NOT NULL AND reason_text IS NOT NULL AND reason_text <> '')
);

--> statement-breakpoint

ALTER TABLE auth.case_fact_change DROP CONSTRAINT IF EXISTS case_fact_change_explain_other;

--> statement-breakpoint

ALTER TABLE auth.case_fact_change ADD CONSTRAINT case_fact_change_explain_other CHECK (
  action NOT IN ('合并', '否决') OR (reason_text IS NOT NULL AND reason_text <> '')
);

--> statement-breakpoint

ALTER TABLE auth.case_fact_change DROP COLUMN IF EXISTS seq;
