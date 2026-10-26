-- 0013_governance：治理后台的分权（010 T003 / FR-003）。
--
-- 两件事，缺一不可：
--
-- ① 把 `'governance'` 加进 `role_resource.resource_type` 的闭集。治理板块的授权行就存在
--    这张表里：`resource_id` = 八个板块 id（`packages/auth/src/governance.ts` 的
--    `GOVERNANCE_BOARDS`），`perm` 仍是 read / write / review / admin 四值（那条 CHECK 不动）。
--
--    ⚠️ 约束名必须**显式重建**：`0004_rbac.sql` 里那条是**列内联、没起名**的 CHECK，PG 按
--    「表名_列名_check」自动命名为 `role_resource_resource_type_check`，而三处读者
--    （`packages/opencode/test/server/openhive-rbac-closed-set.test.ts`、
--    `packages/asset-service/src/authorization.test.ts`）都是按这个名字去 `pg_constraint`
--    里取定义的。改成匿名 ADD 也能跑，但名字会漂，断言就脆。
--
-- ② 种两张**模板角色**（T002 的权限矩阵）。名字只给人看——判定只读 `role_resource` 行，
--    不读 `role.name`（009 §2.4 明令：改名即静默失效）。
--
--    ⚠️ 只种角色与授权行，**不给人挂角色**：v1 的初始分配是部署侧的动作（没有 UI），
--    谁被挂哪张模板由 T005 的账号管理页落地。别在这里给某个具体警号挂模板——
--    迁移不该认识业务里的人。
--
--    ⚠️ `role_type` 走默认值 `normal`：它是「普通角色」，不是 009 的授权组（`group`）。
--    治理模板与授权组是两件事，别把标记混用。

ALTER TABLE auth.role_resource
  DROP CONSTRAINT role_resource_resource_type_check;
--> statement-breakpoint

ALTER TABLE auth.role_resource
  ADD CONSTRAINT role_resource_resource_type_check
  CHECK (resource_type IN ('skill', 'mcp', 'knowledge_base', 'governance'));
--> statement-breakpoint

-- 列注释也是闭集的读者之一（`0008_column_comments.sql` 里那一份还写着三值）。
-- 不回去改 0008（已应用的迁移是历史，不重放），在这里覆盖成当前事实。
COMMENT ON COLUMN auth.role_resource.resource_type IS '资源类型，闭集：skill / mcp / knowledge_base / governance';
--> statement-breakpoint

INSERT INTO auth.role (id, name) VALUES ('gov-system-admin', '系统管理员');
--> statement-breakpoint

INSERT INTO auth.role (id, name) VALUES ('gov-business-expert', '业务专家');
--> statement-breakpoint

INSERT INTO auth.role_resource (role_id, resource_type, resource_id, perm) VALUES
  ('gov-system-admin', 'governance', 'account-manage', 'read'),
  ('gov-system-admin', 'governance', 'account-manage', 'write'),
  ('gov-system-admin', 'governance', 'org-tree', 'read'),
  ('gov-system-admin', 'governance', 'org-tree', 'write'),
  ('gov-system-admin', 'governance', 'asset-governance', 'read'),
  ('gov-system-admin', 'governance', 'asset-governance', 'admin'),
  ('gov-system-admin', 'governance', 'usage-cost', 'read'),
  ('gov-system-admin', 'governance', 'audit-log', 'read'),
  ('gov-system-admin', 'governance', 'data-source', 'read'),
  ('gov-system-admin', 'governance', 'data-source', 'write');
--> statement-breakpoint

INSERT INTO auth.role_resource (role_id, resource_type, resource_id, perm) VALUES
  ('gov-business-expert', 'governance', 'asset-governance', 'read'),
  ('gov-business-expert', 'governance', 'asset-governance', 'review'),
  ('gov-business-expert', 'governance', 'template-lib', 'read'),
  ('gov-business-expert', 'governance', 'template-lib', 'write'),
  ('gov-business-expert', 'governance', 'data-project-perm', 'read'),
  ('gov-business-expert', 'governance', 'data-project-perm', 'admin');
-- 数法：系统管理员 10 行 + 业务专家 6 行 = 16 行。
-- 这份种子与 `governance.ts` 的 `GOVERNANCE_TEMPLATES` **必须逐行相等**——
-- `governance.test.ts` 把库读出来双向比，改一边漏一边会当场红（LEARNINGS #003-05）。
