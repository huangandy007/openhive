-- 0002_deactivated_at 的回滚：撤掉停用时刻列。
--
-- ⚠️ 只用于「升级后发现要退回」：DROP COLUMN 会**丢掉所有停用时刻**，
-- 退回后这些账号会变成「停用但时刻未知」，从而从归档清单里消失（不会误删，只会漏归档）。

ALTER TABLE auth.user DROP COLUMN deactivated_at;
