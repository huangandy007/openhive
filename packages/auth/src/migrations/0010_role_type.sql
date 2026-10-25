-- 0010_role_type：给 auth.role 加「角色类型」（009 T004，FR-006）。
--
-- 为什么要加这一列：加它之前 `auth.role` 只有 `id` / `name`，而 009 的「授权组」
-- （跨部门定向授权，design §3.4）在库里**无处标记**。用过 `role.name` 做字符串约定是
-- 错的解法——组一改名，「这是不是一个授权组」就静默失效（D0-4 的裁定原文）。
--
-- 闭集只有两档：
--   normal —— 普通角色（存量角色与「角色为主 + 用户例外」的例外角色都走这档）
--   group  —— 授权组（跨部门拉人进组，按资产定向授权）
--
-- ⚠️ 默认值 `normal` 不是随手给的：`ADD COLUMN ... NOT NULL` 没有默认值时，存量行会被
--    回填成 NULL 或被拒，两种结果都会让现有 RBAC 数据在迁移窗口里失去语义。有了默认值，
--    加列对存量行是「全部归为普通角色」——这正是它们本来的含义。
--
-- ⚠️ 常量名 `role_type_check` **显式写出**，因为 auth 的 `rbac.test.ts` 会从
--    `pg_constraint` 里按这个名字取定义，与 `ROLE_TYPES` 逐值比对（防漂移）。用 PG
--    自动生成的名字（`role_role_type_check`）也能跑，但名字会随表名规则漂，断言就脆。
--
-- ⚠️ 这一列**不参与** `grantsFor()` 的判定：判定只看 `user_role` / `role_resource`。
--    `role_type` 只回答「这是不是一个授权组」，不回答「谁能用什么」——别把标记当权限。

ALTER TABLE auth.role
  ADD COLUMN role_type text NOT NULL DEFAULT 'normal'
    CONSTRAINT role_type_check CHECK (role_type IN ('normal', 'group'));
--> statement-breakpoint
COMMENT ON COLUMN auth.role.role_type IS '角色类型：normal 普通角色 / group 授权组（跨部门定向授权，009 T004）。默认 normal；不参与授权判定，只标记组。';
