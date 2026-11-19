-- 0045_case_ingest_probe_reason_progress：作业原因码 / 进度 / 适配器快照 + 材料 probe（016）。
--
-- 1) 作业失败要能说清「为什么」：reason_code 是闭集（字面值见 CHECK），前缀用 LIKE 收未知列名；
-- 2) progress 供排队 / 解析进度回显；adapter_* 记下当时命中的适配器与版本，报告可追溯；
-- 3) 材料 probe 是「探测结果」（列结构 / 闸门判定），排队扫尾按它判是否待探。

ALTER TABLE auth.case_ingest_job ADD COLUMN IF NOT EXISTS reason_code text;

--> statement-breakpoint

ALTER TABLE auth.case_ingest_job ADD COLUMN IF NOT EXISTS progress jsonb;

--> statement-breakpoint

ALTER TABLE auth.case_ingest_job ADD COLUMN IF NOT EXISTS adapter_id text;

--> statement-breakpoint

ALTER TABLE auth.case_ingest_job ADD COLUMN IF NOT EXISTS adapter_version text;

--> statement-breakpoint

ALTER TABLE auth.case_ingest_job
  ADD CONSTRAINT case_ingest_job_reason_code CHECK (
    reason_code IS NULL
    OR reason_code = '未识别:无匹配适配器'
    OR reason_code LIKE '未识别:缺必需列:%'
    OR reason_code LIKE '未识别:值闸不过:%'
    OR reason_code IN ('失败:读文件','失败:转换器异常','失败:入库异常')
  );

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS case_ingest_job_material_recent
  ON auth.case_ingest_job (project_id, material_id, queued_at DESC, id DESC);

--> statement-breakpoint

ALTER TABLE auth.case_material ADD COLUMN IF NOT EXISTS probe jsonb;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS case_material_probe_queue
  ON auth.case_material (created_at)
  WHERE parse_status = '排队中' AND probe IS NULL;
