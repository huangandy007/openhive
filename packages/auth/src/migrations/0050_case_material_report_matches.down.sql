-- 0050 回滚：移除报告的两列。

ALTER TABLE auth.case_material_report DROP COLUMN IF EXISTS matches;

--> statement-breakpoint

ALTER TABLE auth.case_material_report DROP COLUMN IF EXISTS converted_rows;
