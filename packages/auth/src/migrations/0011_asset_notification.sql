-- 0011_asset_notification：资产状态变化的站内信通知（009 T010，FR-004）。
--
-- 为什么先落这张表，而不是复用前端的 notification（`packages/app/src/context/notification.tsx`）：
-- 那份是**浏览器本地**的 AI 事件索引（turn-complete / error），按会话存在 IndexedDB 里，
-- 没有「用户」这个概念，也没法把「待审核」推给另一个民警。资产通知必须落服务端、按人投递。
--
-- 收件人在写入时解析并**展开成一行一人**，不在读取时再 join 权限：
-- 授权会被撤销，历史通知不该随之消失或改变收件范围。
--
-- 表里存 `asset_name` 快照、不存「去 auth.asset 现查名字」：资产改名后，
-- 历史通知应该还是当时那句话。
--
-- ⚠️ 两个外键都**级联删除**：
--   - 资产删除（`discardAsset`）后，指向它的通知就是死链，留着只会让收件人点进 404；
--   - 用户注销（zombie 清理）若被 RESTRICT 挡住，会让账号清理任务失败，比丢历史通知严重。
--   通知是派生信息，不是审计记录——审计归 010 的日志表。
--
-- ⚠️ `action` 的闭集与 `packages/asset-service/src/lifecycle.ts` 的 `SKILL_ACTIONS` 是同一份
--    值的两处写法；`notify.test.ts` 从 `pg_constraint` 读定义串逐值比对（同 0009 的做法）。
--
-- ⚠️ 当前没有 `read_at` / 已读状态：未读红点与「标记已读」属于站内信面板（design-v2 §8.3），
--    不在 T010。等那个 feature 落地时再加列，避免现在先埋一个没人写也没人读的字段。

CREATE TABLE auth.asset_notification (
  id           text PRIMARY KEY,
  asset_id     text NOT NULL REFERENCES auth.asset(id) ON DELETE CASCADE,
  asset_name   text NOT NULL,
  recipient_id text NOT NULL REFERENCES auth.user(id) ON DELETE CASCADE,
  action       text NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL,
  created_at   integer NOT NULL,
  CONSTRAINT asset_notification_action_check CHECK (
    action IN (
      'submit_review',
      'approve_business',
      'reject_business',
      'publish_tech',
      'start_iteration',
      'publish_iteration',
      'take_offline',
      'bring_online',
      'archive'
    )
  ),
  CONSTRAINT asset_notification_title_not_blank_check CHECK (btrim(title) <> ''),
  CONSTRAINT asset_notification_body_not_blank_check CHECK (btrim(body) <> '')
);

--> statement-breakpoint

-- 收件箱的主查询形状：某人的通知按时间倒序。当前没有读取方，但这也是站内信面板
-- 唯一能用的查询形状；等有读取方再补索引等于让第一版面板先全表扫。
CREATE INDEX asset_notification_inbox_idx
  ON auth.asset_notification (recipient_id, created_at DESC);

--> statement-breakpoint

COMMENT ON TABLE auth.asset_notification IS
  '资产状态变化的站内信通知（按人投递；收件人与资产名都在写入时快照，不随授权/改名回写）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_notification.id IS
  '通知唯一标识（写入时生成 UUID 文本；仅用于去重与前端 key）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_notification.asset_id IS
  '源资产标识（auth.asset.id）；资产删除时级联删除通知，避免死链';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_notification.asset_name IS
  '资产显示名快照（写入时的名字）；之后改名不改历史通知';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_notification.recipient_id IS
  '收件人用户标识（auth.user.id）；用户注销时级联删除';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_notification.action IS
  '触发的生命周期动作，闭集同 SKILL_ACTIONS：submit_review / approve_business / reject_business / publish_tech / start_iteration / publish_iteration / take_offline / bring_online / archive';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_notification.title IS
  '通知标题（写入时生成的中文短句，如「有 skill 待审核」）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_notification.body IS
  '通知正文（含资产名；驳回时含驳回理由）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_notification.created_at IS
  '写入时间（Unix 秒），取该次状态流转的时间戳';
