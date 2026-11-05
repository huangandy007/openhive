-- 0032_case_table_format：表格格式记忆（2026-11-06）。
--
-- 设计见 docs/superpowers/specs/2026-11-05-案件知识与情报体系/design.md §6.2
-- 「认一次，以后全自动」。
--
-- 三条取向：
-- - **fingerprint 是「表头 + 每列数据特征」的摘要，不是文件内容哈希**：
--   同一家运营商每个月的文件内容全变，记得住的是列的形状。
-- - **按项目隔离**（同 0031）：指纹进主键、带 project_id。跨项目复用同一家银行的
--   映射是明显收益，但那要另立一张不含业务数据的全局表，本计划不做。
-- - **mapping 只记认得出的列**：列下标 → 标准字段（JSON 的键是下标字符串）。
--   认不出的列不进 mapping，落库时原样进 `case_fact_row.extras`（设计 §6.3）。
--
-- ⚠️ 整轮迁移跑在一个事务里 ⇒ 本文件不能出现 CREATE INDEX CONCURRENTLY
--   （见 migrations/README.md 第 1 条）。

CREATE TABLE auth.case_table_format (
  project_id      text    NOT NULL,
  fingerprint     text    NOT NULL,
  header          jsonb   NOT NULL,
  mapping         jsonb   NOT NULL,
  method          text    NOT NULL,
  unknown_columns integer NOT NULL DEFAULT 0,
  hit_count       integer NOT NULL DEFAULT 0,
  created_at      integer NOT NULL,
  updated_at      integer NOT NULL,
  PRIMARY KEY (project_id, fingerprint),
  CONSTRAINT case_table_format_method CHECK (method IN ('词典','特征','模型'))
);

--> statement-breakpoint

COMMENT ON COLUMN auth.case_table_format.fingerprint IS
  '表头（规范化后）＋ 每列数据特征的 sha256；与文件内容无关，同一导出格式恒定。';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_table_format.mapping IS
  '{"<列下标>": "<标准字段>"}，只含认得出的列。标准字段是 camelCase 的 FactField 名：caller / callee / startedAt / durationSec / amount / balance / counterparty；**不是** case_fact_row 的 snake_case 列名（started_at / duration_sec）——写错会在落库时被当成未知列塞进 extras，映射「成功」而时间不解析。';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_table_format.hit_count IS
  '这张格式被复用了几次；第二次起不再走识别。';

--> statement-breakpoint

-- 作业要能在「入队之后进程重启」时照样跑完 ⇒ 它得自己带着文件的落点。
-- 存**沙箱根相对路径**（`{userId}/{projectId}/{项目内路径}`，`/` 分隔），不存绝对路径：
-- 落盘根会换（换机器、换盘），绝对路径进了库就得连库一起搬。
-- 与 `case_material.path` 各管一段：那一列是**项目内**路径（界面用），这一列是**沙箱内**路径
-- （worker 用 `join(root, source_path)` 直接读盘，不必反查用户与项目）。
-- ⚠️ 文件被移动/改名之后，旧作业会读不到 ⇒ 落「有问题」并带原因，这是可解释的失败，不是静默。
ALTER TABLE auth.case_ingest_job ADD COLUMN source_path text NOT NULL DEFAULT '';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_ingest_job.source_path IS
  '沙箱根相对路径：{userId}/{projectId}/{项目内路径}，`/` 分隔；worker 用 join(root, source_path) 读盘';
