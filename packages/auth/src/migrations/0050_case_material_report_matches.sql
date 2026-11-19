-- 0050_case_material_report_matches：报告补「全部命中项」与「转换行数」（016，T018 A3/A7）。
--
-- `matches`：本次作业所有表头闸通过者（含落选者），按 `priority desc, id asc`；FR-009。
-- `converted_rows`：本次实际产生的事实行数（适配器与四层通路同一口径），不是分母、不推算。

ALTER TABLE auth.case_material_report
  ADD COLUMN IF NOT EXISTS matches jsonb NOT NULL DEFAULT '[]'::jsonb;

--> statement-breakpoint

ALTER TABLE auth.case_material_report
  ADD COLUMN IF NOT EXISTS converted_rows integer NOT NULL DEFAULT 0;
