-- 0015_audit_event：治理审计流水（010 T010 / FR-009 / SC-003）。
--
-- 只增不改：全仓没有任何 UPDATE / DELETE 入口（DESIGN §4.11.7「无编辑 / 删除入口」）。
-- 「审计可以被改」等于「审计不存在」——这条纪律靠「不写写入函数」守住，不靠权限。
--
-- 三处刻意选择：
--
-- ① `occurred_at` 用 integer（Unix 秒），与 `auth.user` / `auth.org_node` 同一口径
--    （`src/time.ts` 有完整理由）。⚠️ 别改 bigint：生产驱动把 bigint 读成字符串而 PGlite
--    读成数字，服务层按数字严格解析，换类型会在真连接上炸而测试全绿（`#002-01`）。
-- ② `actor_name` / `actor_police_no` 是**写时快照**，不是每次 join 出来的：
--    审计要在账号被清理之后仍然回答「谁」，而 join 会让人名静默变成空白（PII 级追溯）。
-- ③ `detail` 存 JSON 文本而不是 jsonb：本表只被本模块读写，没有按 JSON 内部键查询的需求；
--    用 text 让 PGlite 与 bun-sql 的往返形状完全一致（jsonb 在两驱动上的对象形状不同）。
--
-- `action` **不加** CHECK 闭集：动作词表随功能增长（本轮 14 个，T011/T012 还会加），
-- 一条 CHECK 会让每次加动作都要一次迁移；词表的闭集在 TS 侧（`src/audit.ts` 的 `AUDIT_ACTIONS`），
-- 与 `project_backup_event.action` 的既有取向一致。`result` 加 CHECK：它的三值是**语义**，
-- 多一个 `warn` 之类会静默影响界面的徽章与筛选。
CREATE TABLE auth.audit_event (
  id              BIGSERIAL PRIMARY KEY,
  occurred_at     integer NOT NULL,
  actor_id        text NOT NULL,
  actor_name      text NOT NULL,
  actor_police_no text NOT NULL,
  board           text,
  action          text NOT NULL,
  target_type     text,
  target_id       text,
  result          text NOT NULL,
  detail          text NOT NULL DEFAULT '{}',
  CONSTRAINT audit_event_result_check CHECK (result IN ('ok', 'failed', 'denied'))
);
--> statement-breakpoint

-- 检索的主序：时间倒序、同秒按 id 倒序（翻页不重不漏）。
CREATE INDEX audit_event_time_idx ON auth.audit_event (occurred_at DESC, id DESC);
--> statement-breakpoint

-- 「这个人做过什么」是审计最常用的一问。
CREATE INDEX audit_event_actor_idx ON auth.audit_event (actor_id);
--> statement-breakpoint

-- 「把拒绝筛出来」是 SC-003 明写的验收路径。
CREATE INDEX audit_event_result_idx ON auth.audit_event (result);
--> statement-breakpoint

CREATE INDEX audit_event_action_idx ON auth.audit_event (action);
--> statement-breakpoint

COMMENT ON TABLE auth.audit_event IS
  '治理审计流水（只增不改）；occurred_at 是 Unix 秒；actor_name/police_no 是写时快照；detail 是 JSON 文本';
