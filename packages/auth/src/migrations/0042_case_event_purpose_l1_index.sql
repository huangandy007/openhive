-- 0042_case_event_purpose_l1_index：用途一级过滤补索引（2026-11-13）。
--
-- 设计：01 §3.11.6（`query_events` 按用途查）。用途条件是 `purpose = $1 or purpose_l1 = $1`，
-- 而 0041 只建了 `(project_id, purpose)`：OR 的右支没有索引，规划器无法用单个索引同时服务
-- 两支，一级过滤需要自己的索引，否则右支退化为项目内扫描。
--
-- 全部 IF NOT EXISTS：重跑不撞 42P07。不改 0041——它可能已在库上执行过。

CREATE INDEX IF NOT EXISTS case_event_purpose_l1 ON auth.case_event (project_id, purpose_l1);

--> statement-breakpoint
