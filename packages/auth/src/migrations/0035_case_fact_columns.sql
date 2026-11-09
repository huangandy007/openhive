-- 0035_case_fact_columns：资金明细补三列（2026-11-09）。
--
-- 设计见 docs/superpowers/specs/2026-11-09-表格字段识别-design.md §6.1。
-- 只改父表：PG 的 ADD COLUMN 自动下发到 16 个已有分区，不写 16 条分区语句。
-- `counterparty` 语义收窄为「对手方账号；无账号列时户名兜底（同时写 counterparty_name）」。

ALTER TABLE auth.case_fact_row
  ADD COLUMN counterparty_name text,
  ADD COLUMN owner_account     text,
  ADD COLUMN direction         text;

--> statement-breakpoint

ALTER TABLE auth.case_fact_row
  ADD CONSTRAINT case_fact_row_direction CHECK (direction IS NULL OR direction IN ('收', '付'));

--> statement-breakpoint

COMMENT ON COLUMN auth.case_fact_row.counterparty IS
  '对手方账号。收窄后不再混装户名：只有户名列时该列与 counterparty_name 同时写同一个值（兜住按名匹配）。';
