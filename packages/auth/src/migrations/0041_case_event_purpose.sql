-- 0041_case_event_purpose：卡片层落用途（2026-11-13）。
--
-- 设计：01 §3.11.2（purpose / purpose_basis）、§12.1 P4（用途二期）。
--
-- 三列都**不设枚举 CHECK**：类别存字符串、词表版本化，加小类只改规则表 + 升词表版本，
-- 不碰迁移（01 §3.11.4「类别存字符串，不用 PG enum」）。
--
-- purpose      = 最具体类（二级叶子，或直接是一级类）
-- purpose_l1   = 一级类（12 类之一）；两级都能直接过滤，报表不必自己维护叶子→一级映射
-- purpose_basis= 依据（规则 / 命中词 / 字段 / 词表版本），A20 要求的可审计最小集
--
-- 可空：AI 抽取路径不判用途；本迁移之前的老行同样没有。不 backfill——
-- 重放（右键重新解析）会按词表重算机器卡，人工卡保留旧判断并由 basis 的词表版本区分。
ALTER TABLE auth.case_event ADD COLUMN IF NOT EXISTS purpose       text;

--> statement-breakpoint

ALTER TABLE auth.case_event ADD COLUMN IF NOT EXISTS purpose_l1    text;

--> statement-breakpoint

ALTER TABLE auth.case_event ADD COLUMN IF NOT EXISTS purpose_basis jsonb;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS case_event_purpose ON auth.case_event (project_id, purpose);

--> statement-breakpoint

COMMENT ON COLUMN auth.case_event.purpose IS
  '用途：最具体类（二级叶子或一级类）。判不出落「未识别转账 / 消费其他 / 未分类」，不硬猜（01 §3.11.3）';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_event.purpose_l1 IS
  '用途一级类（12 类之一）。A20 的「一级合计 = 明细行数」直接数这一列';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_event.purpose_basis IS
  '判定依据：{"规则","命中","字段","词表"}。无词粗类规则的 命中/字段 为 null（01 §3.11.4.1）';
