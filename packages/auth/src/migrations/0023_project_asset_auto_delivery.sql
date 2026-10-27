-- 0023_project_asset_auto_delivery：项目级「自动送达」开关（2026-10-27，需求 5a）。
--
-- 需求：审核通过的 skill 自动出现在「该看得到它的人」的项目里。默认**开**；关掉这一行为
-- 需要记住（否则下次打开又自动送回来）。
--
-- 设计取向：
-- - **只存「关」的行**：默认开 ⇒ 没行就是开。若反过来存「开」的行，每一个新项目、每一个
--   新加入的人都得先补一行才算数，漏一行就是静默不送达（`LEARNINGS #006-11`：默认值要与
--   生产常态同形）。
-- - 主键 `(user_id, project_id)`：自动送达改的是**这个人自己那份沙箱**（每人一个项目目录），
--   所以开关按「人 × 项目」记，不是按项目记——甲关掉不该让乙的沙箱也停送。
-- - `user_id` 外键级联：账号注销不能被一行开关挡住（同 `0019` / `0021` 的所有 user 外键）。
-- - `project_id` 没有外键、也不可能有：项目本体是 opencode 原生 `project` 表，活在每用户
--   SQLite，与 PG 是两个库（同 `0021` 的注释）。悬空 project_id 由写入侧（先查 `rolesOf`）挡。
-- - 不存「送过哪些」：那是目录的现状（`.opencode/skill/<assetId>` 的链接），由每次 GET 的
--   对账修回来；落库反而会漂（同 `0021` 的取向，`LEARNINGS #007-02`）。

CREATE TABLE auth.project_asset_auto_delivery (
  user_id     text    NOT NULL REFERENCES auth.user(id) ON DELETE CASCADE,
  project_id  text    NOT NULL,
  disabled_at integer NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

--> statement-breakpoint

COMMENT ON TABLE auth.project_asset_auto_delivery IS
  '项目级自动送达开关（人 × 项目）；有行 = 这个人把这个项目的自动送达关了，无行 = 默认开';

--> statement-breakpoint

COMMENT ON COLUMN auth.project_asset_auto_delivery.disabled_at IS
  '关闭时间（Unix 秒；不要写毫秒，见 0001_init.sql 的警告）';
