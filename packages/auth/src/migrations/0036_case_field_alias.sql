-- 0036_case_field_alias：全局别名库与缓存失效版本（2026-11-09）。
--
-- 设计见 docs/superpowers/specs/2026-11-09-表格字段识别-design.md §4.1 / §6.2 / §6.4。
-- 一张表只放「表头文本 → 字段名」的映射，不含案件事实数据。

CREATE TABLE auth.case_field_alias (
  header       text        NOT NULL,
  field        text        NOT NULL,
  material_id  text        NOT NULL,
  project_id   text        NOT NULL,
  confirmed_by text        NOT NULL,
  confirmed_at integer     NOT NULL,
  hit_count    integer     NOT NULL DEFAULT 0,
  revoked_at   integer,
  PRIMARY KEY (header),
  CONSTRAINT case_field_alias_header_len CHECK (char_length(header) BETWEEN 1 AND 200)
);

--> statement-breakpoint

COMMENT ON TABLE auth.case_field_alias IS
  '部署全局别名库：原始表头（只 trim）→ 字段目录中的字段名。唯一写入口是项目属主的人工确认。';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_field_alias.header IS
  '原始表头，只 trim；**不许归一化后入键**（#011-01：归一化丢语义会让单位声明绕过单位闸）。';

--> statement-breakpoint

CREATE TABLE auth.case_field_alias_version (
  id      smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version bigint   NOT NULL DEFAULT 0
);

--> statement-breakpoint

INSERT INTO auth.case_field_alias_version (id, version) VALUES (1, 0);

--> statement-breakpoint

COMMENT ON TABLE auth.case_field_alias_version IS
  '别名版本：确认/撤销时与别名写入同一事务 +1；参与格式指纹，别名一变旧缓存不可达。';

--> statement-breakpoint

ALTER TABLE auth.case_table_format ADD COLUMN result jsonb;

--> statement-breakpoint

COMMENT ON COLUMN auth.case_table_format.result IS
  '识别结果：{"来源":{...},"待确认":[...],"方法":"...","未知列":N}。缓存命中时用它写 parse_detail.mapping，否则待确认角标会消失。';

--> statement-breakpoint

ALTER TABLE auth.case_table_format DROP CONSTRAINT case_table_format_method;

--> statement-breakpoint

ALTER TABLE auth.case_table_format
  ADD CONSTRAINT case_table_format_method CHECK (method IN ('词典','特征','别名','模型'));
