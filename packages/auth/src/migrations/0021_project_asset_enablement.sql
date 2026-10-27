-- 0021_project_asset_enablement：项目级 skill 启用关系（2026-10-27，用户裁定）。
--
-- 「发布」只是把 skill 复制进共享卷；内核从不读共享卷（`skill/index.ts:186-218` 只扫
-- 项目 `.opencode`、全局配置目录、`.claude/skills`、`.agents/skills`）。本表补的就是
-- 「谁把哪一份装进了哪个项目」——**事实在库，目录是它的投影**（`project-skill-link.ts`）。
--
-- 设计取向：
-- - **只有一张表**：启用＝一行，停用＝删那行。不存「目录是否真的建好了」——目录状态由
--   每次打开资产中心 / 每次启停时的对账修回来，落库反而会漂（`LEARNINGS #007-02`）。
-- - `enabled_by` 记得住是谁开的这个口子：共享项目里任何成员都能启用（本计划 R2），
--   出事要能答「谁装的」。
-- - `asset_id` 外键**级联删除**：资产被 `discardAsset` 删掉时，启用关系跟着走，
--   不留指向空目录的行（与 `0019_user_preference.sql` 对 `user_id` 的处置同取向）。
-- - `enabled_by` 外键**也级联**（同 `0012` / `0019` 的所有 user 外键）：账号注销不能被启用
--   记录挡住。「谁装的」这件事的可查性由审计表（`auth.audit_event` 存 actor 快照）承担，
--   不靠这张关系表——两件事别混。（**前提是启用/停用写审计行**：那两行由 Task 3 的
--   `asset.enable` / `asset.disable` 补上；在它落地之前，删账号会连「谁装的」一起抹掉。）⚠️ 别拿 `0009_asset.sql` 的 `owner_id` 当先例：那条**刻意
--   不级联**，因为「资产成了无主行」比「删不掉账号」更难查；启用关系不是资产本体。
-- - `project_id` **没有外键、也不可能有**：项目本体是 opencode 原生 `project` 表，
--   活在每用户 SQLite，与 PG 是两个库（同 `0005_project_member.sql` 的注释）。
--   悬空 project_id 本层查不出来，能拦它的只有写入侧（`project-assets.ts` 先查 `rolesOf`）。
-- - 主键 `(project_id, asset_id)`：同一份资产在一个项目里只会有一行，重复启用是空操作。
--
-- ⚠️ 上限（20）**不进 CHECK**：它是产品参数，要能调；落在 `enablement.ts` 的
--    `ENABLEMENT_LIMIT`，写入用「count < 上限」的子查询守卫。
--
-- ⚠️ 不写 `CREATE INDEX CONCURRENTLY`：整轮迁移在一个事务里（见 migrations/README.md）。

CREATE TABLE auth.project_asset_enablement (
  project_id text    NOT NULL,
  asset_id   text    NOT NULL REFERENCES auth.asset(id) ON DELETE CASCADE,
  enabled_by text    NOT NULL REFERENCES auth.user(id) ON DELETE CASCADE,
  enabled_at integer NOT NULL,
  PRIMARY KEY (project_id, asset_id)
);

--> statement-breakpoint

-- 主键已覆盖「按项目查全部」；这条索引服务「这份资产被哪些项目启用了」——
-- 下线一份 skill 时要能反查并撤回（本计划尚未实现撤回，索引先留：反查是必然的下一条）。
CREATE INDEX project_asset_enablement_asset_idx
  ON auth.project_asset_enablement (asset_id);

--> statement-breakpoint

COMMENT ON TABLE auth.project_asset_enablement IS
  '项目级 skill 启用关系（项目 × 资产）；启用写一行、停用删一行，目录是其投影';

--> statement-breakpoint

COMMENT ON COLUMN auth.project_asset_enablement.project_id IS
  '项目标识（悬空值本层查不出来：项目本体在每用户 SQLite，跨库无外键）';

--> statement-breakpoint

COMMENT ON COLUMN auth.project_asset_enablement.asset_id IS
  '被启用的资产 id（指向 auth.asset；资产删除时本行级联消失）';

--> statement-breakpoint

COMMENT ON COLUMN auth.project_asset_enablement.enabled_by IS
  '启用人（共享项目里任一成员都可启用，出事要能答「谁装的」）';

--> statement-breakpoint

COMMENT ON COLUMN auth.project_asset_enablement.enabled_at IS
  '启用时间（Unix 秒；不要写毫秒，见 0001_init.sql 的警告）';
