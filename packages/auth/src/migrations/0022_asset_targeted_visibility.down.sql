-- 回滚 0022：可见范围闭集收回三档。
--
-- ⚠️ 库里有 `visibility = 'targeted'` 的行时，ADD CONSTRAINT 会失败——这是**故意**的：
-- 回滚前必须先把这些行改成部门 / 全局，或删掉。静默改数据比回滚失败更难查。

ALTER TABLE auth.asset DROP CONSTRAINT asset_visibility_check;

--> statement-breakpoint

ALTER TABLE auth.asset ADD CONSTRAINT asset_visibility_check
  CHECK (visibility IN ('global', 'department', 'personal'));
