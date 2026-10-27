-- 0022_asset_targeted_visibility：可见范围第四档「指定人员」（需求 3b，2026-10-27）。
--
-- 「指定人员」= 发布时把资产授权给若干授权组（`auth.role.role_type = 'group'`），
-- 读只来自作者身份与 `auth.role_resource` 的授权行——**不给任何空间读权**
-- （`authorization.ts` 的 `spaceAllowsRead()` 对 targeted 直接返回 false；
-- `readable-sql.ts` 的下推同样没有这一档的分支，两处同源）。
--
-- 为什么不做成「部门档 + 附加授权」：部门档的空间读权会把同部门所有人都放进来，
-- 要满足「组外同部门不可见」就得再加一个抑制空间读权的开关——那等于第二套判定。
--
-- 为什么需要一条迁移：`asset_visibility_check` 是闭集（见 `0009_asset.sql:43`），
-- 不加进去这一档根本写不进库。部门非空约束（`asset_department_required_check`）只对
-- `department` 生效，targeted 行可以没有部门。
--
-- ⚠️ 物理目录同时多一档：`/assets/targeted/{skills,mcp,knowledge-base}/{assetId}`
--   （`storage.ts` 的 `publishDirectory()`）。**不放部门目录下**——路径在部门下会让人
--   顺手当成「同部门可见」，而这一档恰恰不给空间读权。

ALTER TABLE auth.asset DROP CONSTRAINT asset_visibility_check;

--> statement-breakpoint

ALTER TABLE auth.asset ADD CONSTRAINT asset_visibility_check
  CHECK (visibility IN ('global', 'department', 'targeted', 'personal'));

--> statement-breakpoint

COMMENT ON COLUMN auth.asset.visibility IS
  '可见范围闭集（需求 3b 起四档）：global=全局 / department=本部门（需 dept 非空）/ targeted=指定人员（只靠授权行，不给空间读权）/ personal=个人（发布时必转共享档）';
