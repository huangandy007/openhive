-- 0049_case_material_report：材料入库报告（016），append-only。
--
-- 每次解析入库留一份：命中的适配器 / 规则版本、源文件 sha256、各闸门判定、告警与跳过行、
-- 字段增强与准入结论。同一次作业至多一份报告 ⇒ UNIQUE (project_id, job_id)。

CREATE TABLE IF NOT EXISTS auth.case_material_report (
  project_id      text    NOT NULL,
  id              text    NOT NULL,
  job_id          text    NOT NULL,
  material_id     text    NOT NULL,
  adapter_id      text,
  adapter_version text,
  rule_version    text,
  source_sha256   text    NOT NULL,
  gates           jsonb   NOT NULL,
  warnings        jsonb   NOT NULL DEFAULT '[]'::jsonb,
  skipped_rows    jsonb   NOT NULL DEFAULT '[]'::jsonb,
  enrich          jsonb,
  admission       jsonb,
  created_at      integer NOT NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, job_id),
  FOREIGN KEY (project_id, material_id)
    REFERENCES auth.case_material (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, job_id)
    REFERENCES auth.case_ingest_job (project_id, id) ON DELETE CASCADE
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS case_material_report_recent
  ON auth.case_material_report (project_id, material_id, created_at DESC);
