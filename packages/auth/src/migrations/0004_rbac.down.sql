-- 0004_rbac 的回滚：撤掉 RBAC 三张表。
--
-- ⚠️ 只用于「升级后发现要退回」：DROP TABLE 会**丢掉全部角色、成员关联与授权**，
-- 退回后每个用户都回到「没有任何 RBAC 授权」的状态。对**已上线并已配授权**的环境，
-- 这不是一次可回退的操作——先把授权导出。
--
-- 顺序是反的（先引用方、后被引用方）：`user_role` / `role_resource` 的外键指向 `role`，
-- 直接先删 `role` 会被外键拦住（本迁移刻意没有 CASCADE，见 0004_rbac.sql 的注释）。

DROP TABLE auth.role_resource;
--> statement-breakpoint
DROP TABLE auth.user_role;
--> statement-breakpoint
DROP TABLE auth.role;
