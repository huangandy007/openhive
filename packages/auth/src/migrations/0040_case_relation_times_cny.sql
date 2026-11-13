-- 0040_case_relation_times_cny：关系补人民币笔数（2026-11-13）。
--
-- 设计：10 §4（P3 第一期）。`times` 仍是全币种笔数（Q16）；本列只数 currency='CNY' 的事件，
-- 供汇总与对手方按人民币口径计笔（纯外币关系 = 0，不进汇总）。
--
-- 可空：human 行没有币种（笔录口述外币仍按 CNY，09 §12 已登记为不做），读侧回退到 times；
-- 老机器行不 backfill，下一次重放整对重建（重建关系是删后重聚合）。
-- 全部 IF NOT EXISTS：重跑不撞 42701。

ALTER TABLE auth.case_relation ADD COLUMN IF NOT EXISTS times_cny integer;

--> statement-breakpoint

COMMENT ON COLUMN auth.case_relation.times_cny IS
  '该对 CNY 资金交易事件数；NULL = 未重放的老机器行或人工关系，读侧回退 times（再退回 1）。';
