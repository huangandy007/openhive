-- 0006_project_meta · 「项目的名字与类型」这一条**项目级共享事实**落 PG。
--
-- 表只有三列：project_id（主键）、name、type。
--
-- ## 为什么非要有这张表（这是它存在的唯一理由）
--
-- 名字的家**不在** PG——它在上游的 `project` 表里，而那张表活在**每用户 SQLite**
-- （003 的物理隔离：一人一份库）。于是「甲建了一个共享项目」这件事，在乙那份库里
-- **一行都没有**。列表出口（`packages/opencode/src/server/openhive/project.ts` 的 `handleList`）
-- 此前既只读每用户的 `project_ext` 取名单，又只从**各自**的 SQLite 取名字 ⇒
-- **被邀进来的成员看不到那个项目，而且不报错、不变红**（乙的列表就是一个合法的空数组）。
--
-- 名单那一半由 `project_member` 提供（0005 已裁定：「谁和谁在一个项目里」是项目级共享事实）。
-- 名字这一半 `project_member` 盖不到——**名字是项目的属性，不是成员关系的属性**。
-- 若把它挂到每条成员行上，owner 改一次名就得写 N 行，漏改一行就是一份静默的旧名字。
--
-- ## 为什么 `type` 也在这张表里（而不是由消费侧「假定成员看到的都是 shared」）
--
-- 「这条名单是从哪儿来的」是消费侧**能**看到的，「被邀进来的那个项目是什么类型」它**看不到**。
-- 消费侧若一律写死 `shared`，那么一个被邀进**私有**项目的成员会拿到一个**写错的类型**——
-- 而今天没有任何东西拦得住「邀请一个私有项目的成员」（`ProjectMembership.decide` 无此规则）。
-- `type` 在创建时定死、此后不改，是项目级事实，与 name 同行最省一处判据（`LEARNINGS #002-06`）。
--
-- ## `project_id` 没有外键，也不可能有
--
-- 理由与 0005 逐字相同：项目的本体在每用户 SQLite 里，PG 这一侧够不着它。
-- 「悬空的 project_id」在本层查不出来，能拦住它的只有写入侧（建项目那一个调用点）。
--
-- ## type 的 CHECK 与 core 的 PROJECT_TYPES 是同一份值的两处写法
--
-- 改一边必须改另一边：`packages/opencode/test/server/openhive-project-member-closed-set.test.ts`
-- 把本 CHECK 的**定义串**从 `pg_constraint` 里读出来，与 core 的 `PROJECT_TYPES` **逐值双向**比。
-- 那条断言住在 `packages/opencode` —— auth 的 deps 只有 drizzle-orm / hono，够不着 core
-- （与 `project_member_role_check` 那条同因）。`LEARNINGS #003-05`：镜像的两侧只要有一条
-- 不覆盖的写法，这个镜像就是假的。
--
-- ## 本迁移不写 CREATE INDEX CONCURRENTLY
--
-- 见 `migrations/README.md` §1（整轮跑在一个事务里，`CONCURRENTLY` 会被 PG 以 25001 拒掉）。
-- 本表也不需要二级索引：两个消费者分别是「建项目时 upsert 一行」与「列项目时按主键批量取 N 行」。
--
-- ## 回填：没有（如实记，不假装）
--
-- 0006 之前建的项目**回填不了名字**——那些名字只存在于各自创建者的每用户 SQLite 里，
-- 而迁移跑在 PG 上，够不着。已存在的共享项目在成员的列表里会以**空名字 ＋ 类型按 shared 兜底**
-- 出现（消费侧 `?? ""` / `?? "shared"` 那两处类型收敛），直到 owner 重新建一个。
-- 今天**没有**「重新写名字」的出口 ⇒ 如实登记为已知缺口（006 的 `state.md`）。
-- 开发期不受影响：真栈的库可重建（`REAL_STACK_STATE_DIR` 一删就干净）。

CREATE TABLE auth.project_meta (
  project_id text PRIMARY KEY,
  name       text NOT NULL,
  type       text NOT NULL CHECK (type IN ('private', 'shared'))
);
