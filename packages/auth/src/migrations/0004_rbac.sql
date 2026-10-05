-- 0004_rbac：统一 RBAC 三张表（design-v2 §14.3，2026-09-06-openhive-design-v2.md:930-937）。
--
--   role:           role_id, name
--   user_role:      user_id, role_id
--   role_resource:  role_id, resource_type, resource_id, perm
--   -- resource_type ∈ {skill, mcp, knowledge_base}
--   -- perm ∈ {读, 写, 审, 管}（§11.2）
--
-- 建在 `auth` schema（用户 2026-10-04 裁定 D0-3 ①：复用本项目已有的 migrations/ 与
-- `migrate()`，不另起一个库/一套运行器）。判定逻辑在 core（裁定 D0-2），两侧的分工写在
-- `packages/core/src/access/rbac.ts` 的头部。
--
-- ⚠️ **perm / resource_type 存 ASCII，不存中文**。设计文档里的「读 / 写 / 审 / 管」是散文；
--    这四个值要进 DB、进规则字符串、跨语言比对。CHECK 把闭集钉在**数据**上——
--    否则一个拼错的动作（`"rade"`）会静静地躺在表里，等某个用户的权限莫名少一条时才被发现。
--
-- ⚠️ **CHECK 里的闭集与 core 的 `ResourceType` / `Perm` 是同一份值的两处写法**。
--    改一边必须改另一边：`packages/opencode/test/server/openhive-rbac-closed-set.test.ts`
--    把这两个 CHECK 的**定义串**从 `pg_constraint` 里读出来，与 core 的 `RESOURCE_TYPES` /
--    `PERMS` **逐值双向**比对（`LEARNINGS #003-05`：镜像的两侧只要有一条不覆盖的写法，
--    这个镜像就是假的）。断言只挂得住 `packages/opencode`——实测 auth 的 deps 只有
--    drizzle-orm / hono（不依赖 core），core 也不依赖 auth，全仓只有它两边都够得着。
--    ⚠️ 本目录的 `rbac.test.ts` 验的是**另一件事**（未知值被 CHECK 拒），不是这条镜像——
--    2026-10-05 之前这里的注释把它当成了防漂移断言，其实那条断言当时**不存在**（I6）。
--
-- 「角色为主 + 用户例外」（§14.3 标题）：**没有第 4 张表**（用户 2026-10-04 裁定）。
--    「例外」= 给这一个用户单独分配一个（自定义）角色，用这三张表表达。
--
-- ⚠️ 外键**不级联**（PG 默认 RESTRICT）。删一个还被引用的角色会**报错**，而不是静默地把
--    它的授权、成员的关联一起抹掉。RBAC 的授权丢失是「有人突然没权限了」这类最难查的故障，
--    宁可让删除先失败、逼调用方显式清理。真要做级联，是另一个裁定 + 另一个迁移。
--
-- ⚠️ 本迁移**不写 `CREATE INDEX CONCURRENTLY`**——整轮迁移在一个事务里，硬写会报 25001
--    （见 migrations/README.md §1）。这三张表都是小表，普通索引也不需要。

CREATE TABLE auth.role (
  id   text PRIMARY KEY,
  name text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE auth.user_role (
  user_id text NOT NULL REFERENCES auth.user(id),
  role_id text NOT NULL REFERENCES auth.role(id),
  PRIMARY KEY (user_id, role_id)
);
--> statement-breakpoint
CREATE TABLE auth.role_resource (
  role_id       text NOT NULL REFERENCES auth.role(id),
  resource_type text NOT NULL CHECK (resource_type IN ('skill', 'mcp', 'knowledge_base')),
  resource_id   text NOT NULL,
  perm          text NOT NULL CHECK (perm IN ('read', 'write', 'review', 'admin')),
  PRIMARY KEY (role_id, resource_type, resource_id, perm)
);
