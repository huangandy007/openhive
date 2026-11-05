-- 0031_case_fact_layer：案件知识与情报体系的事实层（2026-11-06）。
--
-- 设计见 docs/superpowers/specs/2026-11-05-案件知识与情报体系/design.md §4.2。
-- 逻辑名 material/entity/relation/event/citation 在本库统一加 `case_` 前缀，
-- 与 `asset_*` / `project_*` 同风格，也避开 `auth.event` 这种过于宽泛的名字。
--
-- 三条取向：
-- - **项目隔离走应用层**（用户 2026-11-06 裁定，不引入 RLS）：所以每张表
--   `PRIMARY KEY (project_id, id)`。它**不能**拦住漏写 `where project_id = ?`，
--   只保证同一份数据不可能在两个项目里撞成一行。
-- - **不设外键**：原始层与事实层要能各自重放；删材料不该级联删事实（同 0024 的取向）。
-- - **时间列一律 integer Unix 秒**，与 `packages/auth/src/time.ts` 同口径。
--   别改成 timestamptz：本库既有 30 份迁移全是秒，混用会让比较运算按驱动变形。
--
-- ⚠️ 整轮迁移跑在一个事务里 ⇒ 本文件**不能**出现 CREATE INDEX CONCURRENTLY
--    （见 migrations/README.md 第 1 条，会 25001 并拖垮整轮）。

CREATE TABLE auth.case_material (
  id               text    NOT NULL,
  project_id       text    NOT NULL,
  file_name        text    NOT NULL,
  kind             text    NOT NULL,
  fingerprint      text    NOT NULL,
  path             text    NOT NULL,
  text_content     text,
  parse_status     text    NOT NULL DEFAULT '未入队',
  parse_detail     jsonb,
  queued_by        text,
  clock_offset_sec integer NOT NULL DEFAULT 0,
  created_at       integer NOT NULL,
  PRIMARY KEY (project_id, id),
  CONSTRAINT case_material_kind CHECK (kind IN ('话单','资金','笔录','视频','物证照','产物','其他')),
  CONSTRAINT case_material_status CHECK (
    parse_status IN ('未入队','排队中','解析中','已解析','有问题','已跳过')
  ),
  -- 设计 §5.5 硬边界：产物（本平台自己生成的文件）不解析、也不可推进解析状态。
  CONSTRAINT case_material_parsed_source CHECK (kind <> '产物' OR parse_status = '未入队')
);

--> statement-breakpoint

-- 幂等键：同一个文件重复拖入不产生第二行（设计 §5.3）。DAO 走
-- `on conflict (project_id, fingerprint) do update ... returning id`，拿回的是**老那行的 id**。
CREATE UNIQUE INDEX case_material_fingerprint ON auth.case_material (project_id, fingerprint);

--> statement-breakpoint

CREATE INDEX case_material_status ON auth.case_material (project_id, parse_status);

--> statement-breakpoint

COMMENT ON TABLE auth.case_material IS
  '材料：一行 = 项目文件树里的一份文件。产物也在这里登记一行，但解析状态恒为「未入队」且不可推进（设计 §5.5 硬边界）';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_material.clock_offset_sec IS
  '设备时钟偏移修正量（秒）。只参与规范值计算，不动原始值（设计 §4.2）';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_material.parse_detail IS
  '「有问题」的原因明细，形如 {"slices":[{"range":"1201-1400","reason":"无法回读","count":2}]}';

--> statement-breakpoint

CREATE TABLE auth.case_entity (
  id              text    NOT NULL,
  project_id      text    NOT NULL,
  type            text    NOT NULL,
  canonical_value text    NOT NULL,
  aliases         text[]  NOT NULL DEFAULT '{}',
  attrs           jsonb   NOT NULL DEFAULT '{}'::jsonb,
  trust_state     text    NOT NULL DEFAULT '自动抽取',
  created_at      integer NOT NULL,
  PRIMARY KEY (project_id, id),
  CONSTRAINT case_entity_type CHECK (
    type IN ('人','号码','账户','虚拟身份','车辆','物品','地点','组织')
  ),
  CONSTRAINT case_entity_trust CHECK (
    trust_state IN ('自动抽取','已确认','已修正','已排除','存疑')
  )
);

--> statement-breakpoint

CREATE UNIQUE INDEX case_entity_canonical ON auth.case_entity (project_id, type, canonical_value);

--> statement-breakpoint

COMMENT ON COLUMN auth.case_entity.aliases IS
  '合并后的别名（设计 §9.3）；被并入者不再单独成行，其关系一并转移';

--> statement-breakpoint

CREATE TABLE auth.case_relation (
  id          text    NOT NULL,
  project_id  text    NOT NULL,
  from_id     text    NOT NULL,
  to_id       text    NOT NULL,
  type        text    NOT NULL,
  first_at    integer,
  last_at     integer,
  precision   text,
  times       integer,
  amount      numeric(18,2),
  basis       text,
  source_kind text    NOT NULL,
  trust_state text    NOT NULL DEFAULT '自动抽取',
  created_at  integer NOT NULL,
  PRIMARY KEY (project_id, id),
  CONSTRAINT case_relation_type CHECK (
    type IN ('通话','转账','实名登记','实际使用','同案','持有','同行')
  ),
  CONSTRAINT case_relation_source CHECK (source_kind IN ('data','human')),
  CONSTRAINT case_relation_precision CHECK (precision IS NULL OR precision IN ('到日','到分','到秒')),
  CONSTRAINT case_relation_trust CHECK (
    trust_state IN ('自动抽取','已确认','已修正','已排除','存疑')
  ),
  -- 设计 §4.2「关系：数据说的与人说的」：除三种数据直记的关系外，缺认定依据不入库。
  CONSTRAINT case_relation_basis CHECK (
    type IN ('通话','转账','实名登记') OR basis IS NOT NULL
  )
);

--> statement-breakpoint

CREATE INDEX case_relation_from ON auth.case_relation (project_id, from_id, type);

--> statement-breakpoint

CREATE INDEX case_relation_to ON auth.case_relation (project_id, to_id, type);

--> statement-breakpoint

COMMENT ON COLUMN auth.case_relation.basis IS
  '认定依据：供述指认 / 扣押实物 / 技侦 / 登录或使用日志 / 资金闭环 / 推断（设计 §4.2）';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_relation.source_kind IS
  'data = 数据直接记录；human = 人认定。档案页与关系图按这一列区分「数据说的」与「人说的」';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_relation.precision IS
  '聚合时间（first_at/last_at）的精度，取值源行的**最粗**精度；聚合值不存原始值（多行原始值无处安放），需要原始值请回查明细行。';

--> statement-breakpoint

CREATE TABLE auth.case_event (
  id           text    NOT NULL,
  project_id   text    NOT NULL,
  type         text    NOT NULL,
  occurred_at  integer,
  occurred_raw text,
  precision    text,
  time_type    text,
  participants text[]  NOT NULL DEFAULT '{}',
  summary      text,
  trust_state  text    NOT NULL DEFAULT '自动抽取',
  created_at   integer NOT NULL,
  PRIMARY KEY (project_id, id),
  CONSTRAINT case_event_precision CHECK (precision IS NULL OR precision IN ('到日','到分','到秒')),
  CONSTRAINT case_event_time_type CHECK (time_type IS NULL OR time_type IN ('发生','记录','入库')),
  CONSTRAINT case_event_trust CHECK (
    trust_state IN ('自动抽取','已确认','已修正','已排除','存疑')
  )
);

--> statement-breakpoint

CREATE INDEX case_event_time ON auth.case_event (project_id, occurred_at);

--> statement-breakpoint

COMMENT ON COLUMN auth.case_event.occurred_raw IS
  '原始值：原文照抄、永不改写（设计 §4.2「时间的四个字段」）';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_event.occurred_at IS
  '规范值：统一换算到 UTC+8 后的 Unix 秒。跨源比对只许用它';

--> statement-breakpoint

CREATE TABLE auth.case_citation (
  id             text    NOT NULL,
  project_id     text    NOT NULL,
  fact_type      text    NOT NULL,
  fact_id        text    NOT NULL,
  material_id    text    NOT NULL,
  locator        jsonb   NOT NULL,
  extract_method text    NOT NULL,
  confidence     numeric(4,3),
  created_at     integer NOT NULL,
  PRIMARY KEY (project_id, id),
  CONSTRAINT case_citation_fact_type CHECK (fact_type IN ('entity','relation','event','row')),
  CONSTRAINT case_citation_method CHECK (extract_method IN ('机器','人工')),
  CONSTRAINT case_citation_confidence CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

--> statement-breakpoint

CREATE INDEX case_citation_fact ON auth.case_citation (project_id, fact_type, fact_id);

--> statement-breakpoint

CREATE INDEX case_citation_material ON auth.case_citation (project_id, material_id);

--> statement-breakpoint

COMMENT ON COLUMN auth.case_citation.fact_id IS
  '被引用事实的 id。fact_type = entity/relation/event 时是对应表的主键 id；
   fact_type = row 时为 <material_id>#<sheet>#<row_no>（明细行没有代理主键，见 case_fact_row 的 PK）';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_citation.locator IS
  '定位：{"sheet":"Sheet1","row":2041} / {"page":12,"para":3} / {"start":0,"end":1200}';

--> statement-breakpoint

-- 明细行：量最大的一张，千万行级。按 project_id 做 HASH 分区而不是 LIST：
-- LIST 要为每个项目建分区、项目一多就是运行时 DDL；HASH 固定 16 片，建库时一次到位。
-- 代价是「按项目查」会落到全部 16 片，靠片内 (project_id, material_id) 主键索引收敛。
CREATE TABLE auth.case_fact_row (
  project_id   text    NOT NULL,
  material_id  text    NOT NULL,
  sheet        text    NOT NULL,
  row_no       integer NOT NULL,
  caller       text,
  callee       text,
  started_at   integer,
  started_raw  text,
  precision    text,
  time_type    text,
  duration_sec integer,
  amount       numeric(18,2),
  balance      numeric(18,2),
  counterparty text,
  extras       jsonb   NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (project_id, material_id, sheet, row_no),
  CONSTRAINT case_fact_row_precision CHECK (precision IS NULL OR precision IN ('到日','到分','到秒')),
  CONSTRAINT case_fact_row_time_type CHECK (time_type IS NULL OR time_type IN ('发生','记录','入库'))
) PARTITION BY HASH (project_id);

--> statement-breakpoint

CREATE TABLE auth.case_fact_row_p00 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 0);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p01 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 1);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p02 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 2);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p03 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 3);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p04 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 4);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p05 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 5);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p06 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 6);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p07 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 7);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p08 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 8);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p09 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 9);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p10 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 10);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p11 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 11);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p12 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 12);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p13 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 13);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p14 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 14);
--> statement-breakpoint
CREATE TABLE auth.case_fact_row_p15 PARTITION OF auth.case_fact_row FOR VALUES WITH (MODULUS 16, REMAINDER 15);

--> statement-breakpoint

COMMENT ON TABLE auth.case_fact_row IS
  '明细行：表格类材料拆出来的每一行，不直接给民警看，只供抽取与统计（设计 §4.2）';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_fact_row.started_raw IS
  '原始值：原文照抄、永不改写（设计 §4.2「时间的四个字段」）';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_fact_row.started_at IS
  '规范值：统一换算到 UTC+8 后的 Unix 秒。跨源比对只许用它';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_fact_row.precision IS
  '精度：到日 / 到分 / 到秒（设计 §4.2「时间的四个字段」）';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_fact_row.time_type IS
  '时间类型：发生 / 记录 / 入库（设计 §4.2「时间的四个字段」）';

--> statement-breakpoint

CREATE TABLE auth.case_ingest_job (
  id          text    NOT NULL,
  project_id  text    NOT NULL,
  material_id text    NOT NULL,
  status      text    NOT NULL DEFAULT '排队中',
  attempts    integer NOT NULL DEFAULT 0,
  queued_by   text,
  queued_at   integer NOT NULL,
  started_at  integer,
  finished_at integer,
  error       text,
  PRIMARY KEY (project_id, id),
  CONSTRAINT case_ingest_job_status CHECK (status IN ('排队中','运行中','完成','失败','已取消'))
);

--> statement-breakpoint

CREATE INDEX case_ingest_job_queue ON auth.case_ingest_job (status, queued_at);

--> statement-breakpoint

COMMENT ON COLUMN auth.case_ingest_job.queued_by IS
  '谁让它入的队：null = 系统自动；有值 = 民警右键「解析入库」时指定（设计 §8.1 留痕要求）';

--> statement-breakpoint

CREATE TABLE auth.case_alert (
  id          text    NOT NULL,
  project_id  text    NOT NULL,
  rule_id     text    NOT NULL,
  fact_refs   jsonb   NOT NULL,
  created_at  integer NOT NULL,
  read_at     integer,
  handled_at  integer,
  PRIMARY KEY (project_id, id)
);

--> statement-breakpoint

CREATE INDEX case_alert_unread ON auth.case_alert (project_id, read_at);

--> statement-breakpoint

CREATE TABLE auth.case_ai_proposal (
  id            text    NOT NULL,
  project_id    text    NOT NULL,
  kind          text    NOT NULL,
  payload       jsonb   NOT NULL,
  rationale     text,
  status        text    NOT NULL DEFAULT '待处理',
  decided_by    text,
  decided_at    integer,
  reject_reason text,
  created_at    integer NOT NULL,
  PRIMARY KEY (project_id, id),
  CONSTRAINT case_ai_proposal_status CHECK (status IN ('待处理','已采纳','已否决')),
  -- 设计 §10.5：否决必须带理由与人、时间（判据 A18）。写成库约束，别指望调用点记得。
  CONSTRAINT case_ai_proposal_reject CHECK (
    status <> '已否决'
    OR (reject_reason IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

--> statement-breakpoint

CREATE INDEX case_ai_proposal_pending ON auth.case_ai_proposal (project_id, status);

--> statement-breakpoint

COMMENT ON TABLE auth.case_ai_proposal IS
  'AI 提议：只提议不改数。三态留痕，同时是评价 AI 提议质量的数据来源（设计 §10.5）';
