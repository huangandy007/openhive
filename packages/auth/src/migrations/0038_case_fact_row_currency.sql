-- 0038_case_fact_row_currency：明细行补币种列（2026-11-12）。
--
-- 设计见 docs/superpowers/specs/2026-11-09-事实卡片抽象/09-AI探索与MCP工具-设计.md §4.5 第 2 条。
--
-- 为什么加这一列：`money_flow` 只汇总人民币，外币行必须能从明细行里认出来、隔离开
-- （不进合计，缺口写「N 行非人民币未计入」）。没有这一列时，外币的 300 与人民币的 300
-- 会混成同一笔，汇率级错误无从发现。
--
-- 认不出的币种怎么办：写入口（`case-rows.ts` 的 `解析币种`）保留原值大写，一律按非人民币计
-- ——fail-closed，宁可少算也不静默当人民币（`#011-02`）。空值 / 没有币种列 ⇒ 默认 CNY。
--
-- 与 01 §14 Q16 的关系：Q16 原定「非 CNY 行 fail-closed 拒收并上报」，09 §4.5 是较新的决定
-- ——存列、回显、进缺口，不拒收。01 的原文回写在 T7 统一处理。
--
-- 只改父表：`case_fact_row` 是 16 个 HASH 分区，父表 `ADD COLUMN` 自动下发到每个分区，
-- 绝不写分区语句。`IF NOT EXISTS` + NOT NULL DEFAULT ⇒ 已有行拿到 CNY，重跑也不会撞 42701。

ALTER TABLE auth.case_fact_row ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CNY';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_fact_row.currency IS
  '币种。默认 CNY；外币原样大写保留（认不出的也保留），按非人民币隔离（09 §4.5 第 2 条）。';
