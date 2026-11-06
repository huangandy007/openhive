-- 0034_case_fact_change_seq：给留痕一个真正可排序的序号（2026-11-06）。
--
-- 为什么：`created_at` 是整数秒、`id` 是随机 UUID ⇒ 同一秒内多条留痕没有确定顺序。
-- 复审实测：连写「确认→修正」20 组，`order by created_at, id` 有 11 组把「修正」排到
-- 「确认」前面，`最近一次可撤销` 于是拿到较早那条的 before，撤销会把修正值静默丢弃。
--
-- 0033 已在开发库应用，按 migrations/README.md 不改原地 ⇒ 新开一份。
--
-- 顺带把「原因 / 理由不能是空白」补进库约束：0033 只挡了空串，`'   '` 仍能进。

ALTER TABLE auth.case_fact_change
  ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

--> statement-breakpoint

ALTER TABLE auth.case_fact_change DROP CONSTRAINT case_fact_change_explain_deny;

--> statement-breakpoint

ALTER TABLE auth.case_fact_change ADD CONSTRAINT case_fact_change_explain_deny CHECK (
  action NOT IN ('排除', '修正')
  OR (reason_kind IS NOT NULL AND reason_text IS NOT NULL AND btrim(reason_text) <> '')
);

--> statement-breakpoint

ALTER TABLE auth.case_fact_change DROP CONSTRAINT case_fact_change_explain_other;

--> statement-breakpoint

ALTER TABLE auth.case_fact_change ADD CONSTRAINT case_fact_change_explain_other CHECK (
  action NOT IN ('合并', '否决')
  OR (reason_text IS NOT NULL AND btrim(reason_text) <> '')
);

--> statement-breakpoint

COMMENT ON COLUMN auth.case_fact_change.seq IS
  '留痕的单调序号：同秒多条时的确定顺序。时间线一律按它排，不按 created_at / id';
