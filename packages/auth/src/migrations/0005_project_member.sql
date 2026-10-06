-- 0005_project_member：005（工作空间轴）的两张共享态表。
--
--   project_member:  project_id, user_id, role, time_created
--   -- role ∈ {owner, member}（FR-004 微信群模型，**不设只读角色**）
--   project_archive: project_id, archived, archived_at
--   -- archived_at 为 Unix 秒（**不是**毫秒，见 0001_init.sql 的同一条警告）
--
-- 建在 `auth` schema：**复用本项目已有的 `migrations/` 与 `migrate()`**，不另起一个库、
-- 也不另起一套运行器（用户 2026-10-04 裁定 D0-3 ①，`0004_rbac.sql` 是同一处置）。
--
-- ## 为什么这两张表在 PG、而不在每用户的 SQLite
--
-- 「归档后**成员**失权、owner 保留找回权」（FR-010）推不出「个人态归档」——
-- 归档必须是**项目级共享态**；同理「谁和谁在一个项目里」（FR-004）也是项目级的事实。
-- 每用户 SQLite 是**物理隔离**的（003 落地），一份数据只属于一个人，装不下项目级共享态。
-- 反过来说，**个人态**的东西（`type` / `project_type` / `shared_directory` /
-- `last_accessed_at`）留在每用户库的 `project_ext`（005 T003）——那张表与本文件无关。
-- 这条切分是 Q3 裁定（2026-10-06），它覆盖了 U4 的「六字段一张表」。
--
-- ## 判定不在这里
--
-- 「这个身份 ＋ 这个动作 ⇒ 能不能」的**唯一**实现在 `packages/core/src/project/membership.ts`
-- （纯函数，U5 裁定：`project_member` 自成一条线、**不接** `core/access` capability）。
-- 本文件只保证「库里不会出现判定函数看不懂的行」。
--
-- ⚠️ **role 的 CHECK 与 core 的 `MEMBER_ROLES` 是同一份值的两处写法**。改一边必须改另一边：
--    `packages/opencode/test/server/openhive-project-member-closed-set.test.ts` 把本 CHECK 的
--    **定义串**从 `pg_constraint` 里读出来，与 core 的 `MEMBER_ROLES` **逐值双向**比对
--    （`LEARNINGS #003-05`：镜像的两侧只要有一条不覆盖的写法，这个镜像就是假的）。
--    那条断言住在 `packages/opencode`——实测 auth 的 deps 只有 drizzle-orm / hono（不依赖 core），
--    core 也不依赖 auth，**全仓只有它两边都够得着**（同 0004_rbac.sql 对 `PERMS` 的处置）。
--
-- ⚠️ **`project_id` 没有外键、也不可能有**：项目的本体是 opencode 原生 `project` 表，
--    它活在**每用户的 SQLite**（003 的物理隔离），与 PG 是两个库、两个进程边界。
--    所以这里存的是**业务标识**，不指向任何一行——「悬空 project_id」在本层**查不出来**，
--    能拦住它的只有写入侧（把 `project` 行与这两张表的行**收成一个写入模块**，
--    见 `plan.md` R1 的代价栏）。
--
-- ⚠️ **`time_created` / `archived_at` 一律走 `src/time.ts` 的 `nowSeconds()`**，
--    不要直接写 `Date.now()`：毫秒装不进 `integer`，会 22003（见 0001_init.sql）。
--
-- ⚠️ 本迁移**不写 `CREATE INDEX CONCURRENTLY`**——整轮迁移在一个事务里，硬写会报 25001
--    （见 migrations/README.md §1，审查 R-15）。

CREATE TABLE auth.project_member (
  project_id   text NOT NULL,
  user_id      text NOT NULL REFERENCES auth.user(id),
  role         text NOT NULL CHECK (role IN ('owner', 'member')),
  time_created integer NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
--> statement-breakpoint
-- **一个项目至多一个 owner**（FR-004「谁建谁 owner」的**唯一性**那一半）。
--
-- 判定函数（core 的 `decide`）只看得到一个 `role`，它**分不出**「这个项目有两个 owner」
-- 这种库状态——两个 owner 各自都能归档、都能找回，谁说了算没有答案。
-- 「至少一个 owner」由判定侧守（`leave` 拒 owner、`remove` 拒 owner 目标，
-- 见 membership.ts 文件头的不变量），「至多一个」只能由库守。
--
-- ⚠️ `WHERE role = 'owner'` **不能省**：省了就变成「一个项目至多一个成员」，
--    症状是「共享项目加不进人」，而报错信息看起来只是主键冲突。
CREATE UNIQUE INDEX project_member_single_owner ON auth.project_member (project_id) WHERE role = 'owner';
--> statement-breakpoint
CREATE TABLE auth.project_archive (
  project_id  text PRIMARY KEY,
  archived    boolean NOT NULL,
  archived_at integer,
  CONSTRAINT project_archive_coherence_check CHECK (archived = (archived_at IS NOT NULL))
);
