-- 0040_case_relation_times_cny（回滚）：只加过一列，反向删列。

ALTER TABLE auth.case_relation DROP COLUMN IF EXISTS times_cny;

--> statement-breakpoint
