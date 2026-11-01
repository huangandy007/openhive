-- 0027_asset_iteration：skill 版本迭代的两列（设计 2026-11-01-skill版本迭代-design.md §3）。
--
-- `iteration_note`：最近一次发起迭代的变更说明。发布后**保留**当本版说明，下次发起时覆盖
--   ——这一列描述的是「最近一次发起」的意图，留着一条被放弃的说明会让已发布资产显示错误的注解。
-- `iteration_workspace`：工作副本**相对用户沙箱根**的路径（如
--   `550e8400-…/6db1717a-…/.openhive/iterations/asset_xxx`）。存相对路径而不是绝对路径：
--   换落盘根时不用搬库（LEARNINGS #010-04）。

ALTER TABLE auth.asset ADD COLUMN iteration_note text NOT NULL DEFAULT '';

--> statement-breakpoint

ALTER TABLE auth.asset ADD COLUMN iteration_workspace text;
