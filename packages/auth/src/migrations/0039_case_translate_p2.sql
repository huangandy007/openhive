-- 0039_case_translate_p2：P2 翻译层落库骨架（2026-11-12）。
--
-- 设计：01 §3.2（别名）/ §3.3（参与者）/ §3.5（case_event 扩展）/ §3.9（卡片模板）。
-- 拍板：§14.1 Q13（卡片 id 去版本）/ Q14（按材料清除）/ Q15（template_id）/ Q17（事件类型词表）/ Q18（槽位种类）。
-- `currency` 是本计划 Global Constraints 第 14 条：Q16 要求外币不进人民币合计，卡片层必须有币种落点。
--
-- 全部 IF NOT EXISTS：重跑不撞 42P07 / 42701（0031 / 0038 的老问题）。
-- 不设外键：事实层要能整片重建（0031 文件头同款理由），所以每条清理都显式写 project_id。
-- 每条语句之间用分隔符（README §2）：运行器逐条执行，多语句一次性下发在各驱动上不可移植。

CREATE TABLE IF NOT EXISTS auth.case_entity_alias (
  id          text    NOT NULL,
  project_id  text    NOT NULL,
  entity_id   text    NOT NULL,
  kind        text    NOT NULL,
  value       text    NOT NULL,
  raw_value   text    NOT NULL,
  valid_from  integer,
  valid_to    integer,
  source_kind text    NOT NULL,
  material_id text,
  citation_id text,
  created_at  integer NOT NULL,
  revoked_at  integer,
  PRIMARY KEY (project_id, id),
  CONSTRAINT case_entity_alias_source CHECK (source_kind IN ('表格', '文本', '人工'))
);

--> statement-breakpoint

-- 不建 (kind, value) 唯一：同一个号在不同时段属于不同人是合法状态（§3.2）。
CREATE INDEX IF NOT EXISTS case_entity_alias_lookup ON auth.case_entity_alias (project_id, kind, value);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS case_entity_alias_entity ON auth.case_entity_alias (project_id, entity_id);

--> statement-breakpoint

-- 按材料撤销要用（Q14）：没有它，重放清理是全表扫。
CREATE INDEX IF NOT EXISTS case_entity_alias_material ON auth.case_entity_alias (project_id, material_id);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS auth.case_event_participant (
  id           text    NOT NULL,
  project_id   text    NOT NULL,
  event_id     text    NOT NULL,
  entity_id    text,
  role         text    NOT NULL,
  mention_text text    NOT NULL,
  citation_id  text,
  ordinal      integer NOT NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, event_id, ordinal)
);

--> statement-breakpoint

-- 角色词表是代码常量，不写 CHECK（§3.3：加一种业务角色不改迁移）。
CREATE INDEX IF NOT EXISTS case_event_participant_entity ON auth.case_event_participant (project_id, entity_id);

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS auth.case_card_template (
  id          text    NOT NULL,
  project_id  text    NOT NULL,
  name        text    NOT NULL,
  event_type  text    NOT NULL,
  slots       jsonb   NOT NULL,
  required    text[]  NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  verified_at integer,
  hit_count   integer NOT NULL DEFAULT 0,
  created_at  integer NOT NULL,
  PRIMARY KEY (project_id, id)
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS case_card_template_type ON auth.case_card_template (project_id, event_type);

--> statement-breakpoint

ALTER TABLE auth.case_event ADD COLUMN IF NOT EXISTS occurred_end integer;

--> statement-breakpoint

ALTER TABLE auth.case_event ADD COLUMN IF NOT EXISTS amount       numeric(18,2);

--> statement-breakpoint

ALTER TABLE auth.case_event ADD COLUMN IF NOT EXISTS attrs        jsonb NOT NULL DEFAULT '{}';

--> statement-breakpoint

ALTER TABLE auth.case_event ADD COLUMN IF NOT EXISTS template_id  text;

--> statement-breakpoint

ALTER TABLE auth.case_event ADD COLUMN IF NOT EXISTS currency     text NOT NULL DEFAULT 'CNY';

--> statement-breakpoint

COMMENT ON TABLE auth.case_entity_alias IS
  '实体别名（带有效期）。kind=户名 挂在账户实体上，表示"这个账户登记在谁名下"，不是人名实体（01 §3.2）。';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_event.template_id IS
  '产出这张卡片的模板行 id。代码规则填内置行（内置:资金/v1，verified_at 非空）（Q15）。';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_event.currency IS
  '卡片的币种。默认 CNY；非 CNY 的卡片不进关系合计，也不进 aggregate_money（Q16 / Global Constraints 14）。';
