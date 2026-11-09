ALTER TABLE auth.case_table_format DROP CONSTRAINT IF EXISTS case_table_format_method;

--> statement-breakpoint

ALTER TABLE auth.case_table_format
  ADD CONSTRAINT case_table_format_method CHECK (method IN ('词典','特征','模型'));

--> statement-breakpoint

ALTER TABLE auth.case_table_format DROP COLUMN IF EXISTS result;

--> statement-breakpoint

DROP TABLE IF EXISTS auth.case_field_alias_version;

--> statement-breakpoint

DROP TABLE IF EXISTS auth.case_field_alias;
