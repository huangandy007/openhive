-- 0033_case_fact_trust：纠错与可信状态的留痕表 ＋ 依赖标记列（2026-11-06）。
--
-- 设计见 docs/superpowers/specs/2026-11-05-案件知识与情报体系/design.md
-- §9.1 / §9.3 / §9.4 / §9.6，判据 A11 / A18。
--
-- 四条取向：
-- - **留痕单独一张表，不写 `audit_event`**：§9.6 要求「改前值、改后值、人、时间、原因」
--   全部留存，且必须与事实改动**同事务**；`audit_event`（0015）的口径是「尽力记、失败
--   不拖垮业务」，只能事后补记；「这条事实改过几次」也要按 (project_id, fact_type, fact_id)
--   查，那张表没有这个索引。
-- - **`before` 是完整快照**（jsonb）：撤销与拆分靠它原样恢复，事实表本身不加「原值列」。
-- - **操作人姓名是写时快照**（同 0015 ②）：账号被清理后留痕仍要能回答「谁」。
-- - **依赖标记是时间戳不是布尔**：§9.4 的传播既要「变了」也要「什么时候变的」。
--
-- ⚠️ 整轮迁移跑在一个事务里 ⇒ 本文件**不能**出现 CREATE INDEX CONCURRENTLY
--   （见 migrations/README.md 第 1 条，会 25001 并拖垮整轮）。

CREATE TABLE auth.case_fact_change (
  id              text    NOT NULL,
  project_id      text    NOT NULL,
  fact_type       text    NOT NULL,
  fact_id         text    NOT NULL,
  action          text    NOT NULL,
  before          jsonb,
  after           jsonb,
  reason_kind     text,
  reason_text     text,
  actor_id        text    NOT NULL,
  actor_name      text    NOT NULL,
  actor_police_no text    NOT NULL,
  created_at      integer NOT NULL,
  PRIMARY KEY (project_id, id),
  CONSTRAINT case_fact_change_type CHECK (fact_type IN ('entity', 'relation', 'event')),
  CONSTRAINT case_fact_change_action CHECK (
    action IN ('确认', '排除', '存疑', '修正', '撤销', '合并', '拆分', '采纳', '否决')
  ),
  CONSTRAINT case_fact_change_reason_kind CHECK (
    reason_kind IS NULL OR reason_kind IN ('识别错', '抽取错', '材料本身有问题')
  ),
  -- §9.2：选「错」要写一句话并选原因（判据 A11）。写成库约束——别指望五个调用点都记得。
  CONSTRAINT case_fact_change_explain_deny CHECK (
    action NOT IN ('排除', '修正')
    OR (reason_kind IS NOT NULL AND reason_text IS NOT NULL AND reason_text <> '')
  ),
  -- §9.3：合并要留「依据什么」；§9.5 / A18：否决提议必须带理由。
  CONSTRAINT case_fact_change_explain_other CHECK (
    action NOT IN ('合并', '否决') OR (reason_text IS NOT NULL AND reason_text <> '')
  )
);

--> statement-breakpoint

-- 「这条事实改过几次」是留痕唯一的常用查法；时间正序读出来就是一条时间线。
CREATE INDEX case_fact_change_fact
  ON auth.case_fact_change (project_id, fact_type, fact_id, created_at);

--> statement-breakpoint

COMMENT ON TABLE auth.case_fact_change IS
  '事实留痕（设计 §9.6）：谁、何时、改前、改后、为什么。只增不改——没有 update / delete 入口';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_fact_change.before IS
  '改前的完整快照（撤销 / 拆分靠它恢复）。形状按 fact_type 定，见 case-trust.ts / case-merge.ts';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_fact_change.after IS
  '改后的值或动作清单。`撤销` 行在这里记 `{"被撤销的留痕": "<留痕 id>"}`，防止同一条被反复撤销';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_fact_change.actor_name IS
  '写时快照：账号被清理后留痕仍要能回答「谁」（同 0015_audit_event ②）';

--> statement-breakpoint

-- §9.4 传播：实体被修正/排除后，指向它的关系与参与它的事件「依据已变更」。
-- 记时间戳而不是布尔：界面要能说「什么时候变的」；清空 = 人已复核过这条依赖事实。
ALTER TABLE auth.case_relation ADD COLUMN basis_changed_at integer;

--> statement-breakpoint

ALTER TABLE auth.case_event ADD COLUMN basis_changed_at integer;

--> statement-breakpoint

COMMENT ON COLUMN auth.case_relation.basis_changed_at IS
  '依据已变更（§9.4）：这条关系的一端实体被修正/排除的时间；对这条关系做任何人工动作即清空';

--> statement-breakpoint

COMMENT ON COLUMN auth.case_event.basis_changed_at IS
  '依据已变更（§9.4）：这条事件的参与实体被修正/排除的时间；对这条事件做任何人工动作即清空';
