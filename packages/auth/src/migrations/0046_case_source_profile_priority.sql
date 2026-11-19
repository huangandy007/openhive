-- 0046_case_source_profile_priority：数据源档案补 4 列（016）。
--
-- optional_headers：允许缺失的表头；priority：命中优先级（数大优先，降序决胜，见 data-model §priority；默认 100）；
-- rule_version：产出该档案的规则版本；hints：适配器提示（如工作表名、表头行号）。

ALTER TABLE auth.case_source_profile
  ADD COLUMN IF NOT EXISTS optional_headers jsonb NOT NULL DEFAULT '[]'::jsonb;

--> statement-breakpoint

ALTER TABLE auth.case_source_profile
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100;

--> statement-breakpoint

ALTER TABLE auth.case_source_profile ADD COLUMN IF NOT EXISTS rule_version text;

--> statement-breakpoint

ALTER TABLE auth.case_source_profile ADD COLUMN IF NOT EXISTS hints jsonb;
