-- 0003_flags_not_null：把两个标记位收紧为 NOT NULL。
--
-- 为什么：`is_admin` / `must_change_pw` 建表时是可空的，而读取侧一律用 `=== 1` 比
-- （login.ts）。于是 `must_change_pw = NULL` 被读成「不需改密」——失败方向**朝外**，
-- 一个 NULL 就绕过了 FR-006 的强制改密。`is_admin = NULL` 读成非管理员，方向是安全的，
-- 但一并收紧：让「这两列只能是 0 / 1」长在**数据**上，不长在每个读取点的自觉上。
--
-- 先回填再收紧：本迁移之前建的行若为 NULL，`SET NOT NULL` 会直接失败。
-- 回填取值与建表时的 DEFAULT 一致；其中 must_change_pw 回填成 1 是**保守侧**——
-- 多要一次改密，好过放过一个没改过密的账号。
--
-- 本文件 4 条语句**全部幂等**（两条 UPDATE 幂等、两条 SET NOT NULL 幂等），
-- 因此即使运行器逐条执行、中途失败也能自愈。原因写在这里、不指向别处：
-- 运行器**没有事务**——`runFile` 逐条 `execute`（无 BEGIN/COMMIT），而 `_migration` 的记账
-- insert 排在 `runFile` **之后**，所以一个文件中途失败会留下「改了库、没记账」，
-- 重试时**从文件头重跑**。这就是每个迁移文件都必须自幂等的原因（收口见 003 的 T021）。
-- 并发同理：两个 runner 会各自读到同一份 `applied` 后都去应用。

UPDATE auth.user SET is_admin = 0 WHERE is_admin IS NULL;
--> statement-breakpoint
UPDATE auth.user SET must_change_pw = 1 WHERE must_change_pw IS NULL;
--> statement-breakpoint
ALTER TABLE auth.user ALTER COLUMN is_admin SET NOT NULL;
--> statement-breakpoint
ALTER TABLE auth.user ALTER COLUMN must_change_pw SET NOT NULL;
