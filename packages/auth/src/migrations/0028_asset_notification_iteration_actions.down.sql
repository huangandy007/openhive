-- 0028 的回滚：把动作闭集恢复成 0027 之前的 9 值（0011 原样）。
--
-- ⚠️ 若库里已经存在 `submit_iteration` / `abort_iteration` 的通知行，下面这条 ADD CONSTRAINT
--    会失败——这是**有意**的：down 不静默删数据。要回滚就先由操作者决定那些通知留不留。

ALTER TABLE auth.asset_notification
  DROP CONSTRAINT IF EXISTS asset_notification_action_check;

--> statement-breakpoint

ALTER TABLE auth.asset_notification
  ADD CONSTRAINT asset_notification_action_check CHECK (
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
  );

--> statement-breakpoint

COMMENT ON COLUMN auth.asset_notification.action IS
  '触发的生命周期动作，闭集同 SKILL_ACTIONS：submit_review / approve_business / reject_business / publish_tech / start_iteration / publish_iteration / take_offline / bring_online / archive';
