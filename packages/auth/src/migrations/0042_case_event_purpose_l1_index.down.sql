-- 0042_case_event_purpose_l1_index（回滚）：只加过一个索引，反向删索引。

DROP INDEX IF EXISTS auth.case_event_purpose_l1;

--> statement-breakpoint
