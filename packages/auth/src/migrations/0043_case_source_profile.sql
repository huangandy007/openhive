-- 0043_case_source_profile：数据源档案（2026-11-14）。
--
-- 粒度是「一类来源」：按表头集合认，不按列顺序 / 指纹认。
-- mapping 的键是**表头原文**（trim 后），不是列下标——列顺序无关的前提就在这里。
-- 本轮不建 fingerprint / rule_version / hints 列，偏差已登记在
-- docs/superpowers/specs/2026-11-09-事实卡片抽象/2026-11-14-P4-数据源档案-design.md §2。

CREATE TABLE auth.case_source_profile (
  id          text    NOT NULL,
  project_id  text    NOT NULL,
  name        text    NOT NULL,
  type        text    NOT NULL,
  header_set  jsonb   NOT NULL,
  mapping     jsonb   NOT NULL,
  hit_count   integer NOT NULL DEFAULT 0,
  created_at  integer NOT NULL,
  updated_at  integer NOT NULL,
  revoked_at  integer,
  PRIMARY KEY (project_id, id),
  CONSTRAINT case_source_profile_type CHECK (type IN ('资金','话单','其他'))
);

--> statement-breakpoint

CREATE INDEX case_source_profile_active
  ON auth.case_source_profile (project_id) WHERE revoked_at IS NULL;

--> statement-breakpoint

ALTER TABLE auth.case_material
  ADD COLUMN format_fingerprints jsonb NOT NULL DEFAULT '[]'::jsonb;

--> statement-breakpoint

COMMENT ON TABLE auth.case_source_profile IS
  '数据源档案：表头集合 → 字段映射。按项目隔离；匹配规则见 case-source-profile.ts';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_source_profile.mapping IS
  '{"表头原文":"识别字段"}，列顺序无关；命中时逐字段过字段目录，失效字段不命中';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_material.format_fingerprints IS
  '[{"工作表":"Sheet1","指纹":"…"}]。解析成功时写入，建档接口据此读回 case_table_format';
