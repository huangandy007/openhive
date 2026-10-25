-- 0010_role_type 的回滚：删掉「角色类型」列。
--
-- ⚠️ 授权组**不会**因此消失——它们仍在 `auth.role` 里，只是不再被标记为 `group`。
--    009 的授权行（`role_resource`）一条都不动，所以回滚后权限判定行为不变
--    （`grantsFor()` 从不读这一列）；变的是「哪些角色算授权组」这个元信息。
--    真要重放这一列，回滚前先记下 `select id from auth.role where role_type = 'group'`。

ALTER TABLE auth.role DROP COLUMN role_type;
