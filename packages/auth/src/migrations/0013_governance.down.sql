-- 0013_governance 的回滚：撤掉治理分权。
--
-- ⚠️ 顺序是语义，不能换：
-- ① 先删**所有**治理授权行（不只是两张模板的）——只要还剩一行 `resource_type='governance'`，
--    下一步把 CHECK 收窄回三值就会当场失败（整轮回滚，什么都没撤成，而且报错说的是 CHECK，
--    看起来像「加错了闭集」，其实根因是「还有行引用它」）。
-- ② 再删指向两张模板的 `user_role`：`role_resource` 与 `user_role` 都是 RESTRICT 外键，
--    漏掉它 `DELETE FROM auth.role` 会被拦。
-- ③ 才删角色本身。
-- ④ 最后把 CHECK 换回 0004 的三值。
--
-- ⚠️ 回滚会丢「谁被挂了哪张模板」——这是 OSS 侧没有撤销表可依赖的必然（004 也没做）。
--    真要留痕，回滚前先 `select user_id, role_id from auth.user_role where role_id like 'gov-%'` 记一笔。

DELETE FROM auth.role_resource WHERE resource_type = 'governance';
--> statement-breakpoint

DELETE FROM auth.user_role WHERE role_id IN ('gov-system-admin', 'gov-business-expert');
--> statement-breakpoint

DELETE FROM auth.role WHERE id IN ('gov-system-admin', 'gov-business-expert');
--> statement-breakpoint

ALTER TABLE auth.role_resource
  DROP CONSTRAINT role_resource_resource_type_check;
--> statement-breakpoint

ALTER TABLE auth.role_resource
  ADD CONSTRAINT role_resource_resource_type_check
  CHECK (resource_type IN ('skill', 'mcp', 'knowledge_base'));
--> statement-breakpoint

COMMENT ON COLUMN auth.role_resource.resource_type IS '资源类型，闭集：skill / mcp / knowledge_base';
