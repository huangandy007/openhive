-- 回滚：删父索引会自动删掉 16 个分区子索引。
DROP INDEX IF EXISTS auth.case_fact_row_project_started;
