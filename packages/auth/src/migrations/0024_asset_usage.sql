-- 0024_asset_usage：资产使用记录（2026-10-29，用户裁定：每次调用记一条、明细仅系统管理员）。
--
-- 事实来源是**每用户库的 part 表**（v1 内核 1.19.3 实测：event 表里没有 session.next.* 事件，
-- 工具调用落在 part 的 data.tool / data.state.status / data.state.input）。抽取器：
-- `packages/opencode/src/server/openhive/asset-usage.ts`。
--
-- 两条取向：
-- - **不设外键**（user_id / asset_id 都不设）：这是**事实**不是**关系**。账号注销、资产删除之后，
--   「这份 skill 当时被用了多少次」仍要能答（与 0021 的 enabled_by 级联取向相反，理由不同）。
-- - **组织三列是写时快照**：按岗位分析要的是「当时在哪个部门」，联查现在的部门会把历史归错
--   （同 010 分析库 usage_fact.org 的约定）。
--
-- 主键 (user_id, part_id)：重放同一段源库不会翻倍（part 行本身会被 UPDATE，id 不变）。

CREATE TABLE auth.asset_usage_event (
  user_id      text    NOT NULL,
  part_id      text    NOT NULL,
  asset_id     text    NOT NULL,
  session_id   text    NOT NULL,
  call_id      text    NOT NULL,
  skill_name   text    NOT NULL,
  org          text    NOT NULL,
  dept         text    NOT NULL,
  section      text    NOT NULL,
  occurred_at  integer NOT NULL,
  extracted_at integer NOT NULL,
  PRIMARY KEY (user_id, part_id)
);

--> statement-breakpoint

CREATE INDEX asset_usage_event_asset_time ON auth.asset_usage_event (asset_id, occurred_at);

--> statement-breakpoint

CREATE INDEX asset_usage_event_user_time ON auth.asset_usage_event (user_id, occurred_at);

--> statement-breakpoint

COMMENT ON TABLE auth.asset_usage_event IS
  '资产使用事实：一行 = 一次已完成（completed）的 skill 工具调用，归因到项目里唯一的同名已启用资产';

--> statement-breakpoint

COMMENT ON COLUMN auth.asset_usage_event.part_id IS
  '源库 part.id（每用户 SQLite），幂等键；不叫 event_id：源不是 event 表';

--> statement-breakpoint

COMMENT ON COLUMN auth.asset_usage_event.occurred_at IS
  '调用开始时间（Unix 秒；源 part.time_created 是毫秒，抽取时 floor/1000）';

--> statement-breakpoint

-- 游标：每用户一条。**秒**水位——`integer` 是 int4（上限 2 147 483 647），毫秒 1.79e12 装不下，
-- 写毫秒会 22003 被抽取器的 catch 吞成警告 ⇒ 游标停在 0、每轮全量重扫（测试还全绿，
-- 见 0001_init.sql:8-11）。part.id 不保证单调，拿 id 当 `> 游标` 会漏行（见设计 §4「游标表」）。
CREATE TABLE auth.asset_usage_cursor (
  user_id          text    PRIMARY KEY,
  last_updated_sec integer NOT NULL,
  updated_at       integer NOT NULL
);

--> statement-breakpoint

COMMENT ON COLUMN auth.asset_usage_cursor.last_updated_sec IS
  '已消费到的 part.time_updated 水位（Unix 秒）；抽取时回看 60 秒，重扫的行被主键吃掉';

--> statement-breakpoint

COMMENT ON COLUMN auth.asset_usage_cursor.updated_at IS
  '本表写入时间（Unix 秒）';
