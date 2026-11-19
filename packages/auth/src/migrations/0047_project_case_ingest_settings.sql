-- 0047_project_case_ingest_settings：项目级自动入库开关（016）。
--
-- 每项目一行；auto_enqueue = 自动把新拖入材料排队，auto_enable_trusted = 允许自动启用可信技能。

CREATE TABLE IF NOT EXISTS auth.project_case_ingest_settings (
  project_id          text    NOT NULL,
  auto_enqueue        boolean NOT NULL DEFAULT true,
  auto_enable_trusted boolean NOT NULL DEFAULT false,
  updated_by          text    REFERENCES auth."user"(id) ON DELETE SET NULL,
  updated_at          integer NOT NULL,
  PRIMARY KEY (project_id)
);
