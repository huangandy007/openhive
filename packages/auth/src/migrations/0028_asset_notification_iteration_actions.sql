-- 0028_asset_notification_iteration_actions：站内信动作闭集加上迭代的两个新动作
-- （设计 2026-11-01-skill版本迭代-design.md §9）。
--
-- 为什么这条重建要单独成一个迁移、而不是并进 0027：`notify.test.ts` 断言
-- 「DB 的 CHECK ⇔ `lifecycle.ts` 的 `SKILL_ACTIONS` 逐值双向相等」。闭集重建必须与
-- `SKILL_ACTIONS` 加值**同一个提交**落地，否则中间那段提交无论先把哪边改过去，
-- 快照都会常红（bisect 落到那里会误判成「这个提交把功能弄坏了」）。
--
-- 取值 = 0011 的 9 个 + `submit_iteration` + `abort_iteration`，顺序与 0011 保持一致，
-- 新值插在 `start_iteration` 之后（与 `SKILL_ACTIONS` 的排列同形，方便人眼对账）。

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
      'submit_iteration',
      'abort_iteration',
      'publish_iteration',
      'take_offline',
      'bring_online',
      'archive'
    )
  );

--> statement-breakpoint

-- 列注释里也列着闭集（0011 写的），不跟着改就会变成一句过期的说明。
COMMENT ON COLUMN auth.asset_notification.action IS
  '触发的生命周期动作，闭集同 SKILL_ACTIONS：submit_review / approve_business / reject_business / publish_tech / start_iteration / submit_iteration / abort_iteration / publish_iteration / take_offline / bring_online / archive';
