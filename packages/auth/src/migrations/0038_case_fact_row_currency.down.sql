-- 0038_case_fact_row_currency（回滚）：只撤父表，分区自动跟随。
ALTER TABLE auth.case_fact_row DROP COLUMN IF EXISTS currency;
