-- 0008_column_comments：给 auth schema 的全部表与字段补中文说明。
--
-- 为什么是**新增迁移**而不是改 0001~0007：那些文件已经应用到远端 PG 上，改文件不会重跑，
-- 库里的注释仍然是空的。`COMMENT ON` 幂等（重复执行只是覆盖同一段文字），
-- 因此本文件是「数据库注释」的唯一来源；建表文件只负责结构。
--
-- 查看方式：
--   psql：\d+ auth.user
--   通用 SQL：
--     select c.relname, a.attname, col_description(c.oid, a.attnum)
--     from pg_class c
--     join pg_attribute a on a.attrelid = c.oid
--     where c.relnamespace = 'auth'::regnamespace and a.attnum > 0;
--
-- DOWN：0008_column_comments.down.sql（把所有注释清空）

COMMENT ON SCHEMA auth IS
  'openhive 业务库：用户账号、RBAC、项目共享态与备份审计；与每用户 SQLite 物理分离';

--> statement-breakpoint

COMMENT ON TABLE auth.user IS
  '用户账号：民警与管理员共用，is_admin 区分；不提供自助注册，只能由管理员录入';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.id IS
  '用户唯一标识（UUID）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.police_no IS
  '警号，也是登录用户名；全局唯一';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.name IS
  '姓名';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.id_card IS
  '身份证号（明文；研判对象，不做脱敏）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.phone IS
  '联系电话（明文；研判对象，不做脱敏）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.org IS
  '单位（组织树第一级）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.dept IS
  '部门（组织树第二级）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.section IS
  '科室（组织树第三级）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.status IS
  '账号状态：1 启用 / 0 停用';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.password_hash IS
  '密码哈希（argon2id），不存明文';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.is_admin IS
  '是否管理员：1 是 / 0 否；录入账号一律为 0，提权走独立路径';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.must_change_pw IS
  '是否必须修改密码：1 是 / 0 否；首次登录与管理员重置密码后为 1';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.last_login_at IS
  '最后登录时刻（Unix 秒；登录成功时更新）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.last_active_at IS
  '最后活跃时刻（Unix 秒；按 60 秒节流窗口更新，比登录时间更准）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.created_at IS
  '创建时刻（Unix 秒）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user.deactivated_at IS
  '停用时刻（Unix 秒）；NULL 表示从未停用，或停用时刻未知的历史数据（见 0002 的三分语义）';

--> statement-breakpoint

COMMENT ON TABLE auth.role IS
  'RBAC 角色（角色为主、用户例外）';

--> statement-breakpoint
COMMENT ON COLUMN auth.role.id IS
  '角色标识';

--> statement-breakpoint
COMMENT ON COLUMN auth.role.name IS
  '角色名称；全局唯一';

--> statement-breakpoint

COMMENT ON TABLE auth.user_role IS
  '用户与角色的关联（多对多）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user_role.user_id IS
  '用户标识（auth.user.id）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user_role.role_id IS
  '角色标识（auth.role.id）';

--> statement-breakpoint

COMMENT ON TABLE auth.role_resource IS
  '角色对资源的权限授予（资源类型与权限动作均为闭集）';

--> statement-breakpoint
COMMENT ON COLUMN auth.role_resource.role_id IS
  '角色标识（auth.role.id）';

--> statement-breakpoint
COMMENT ON COLUMN auth.role_resource.resource_type IS
  '资源类型，闭集：skill / mcp / knowledge_base';

--> statement-breakpoint
COMMENT ON COLUMN auth.role_resource.resource_id IS
  '资源标识（对应资源自己的 ID）';

--> statement-breakpoint
COMMENT ON COLUMN auth.role_resource.perm IS
  '权限动作，闭集：read / write / review / admin（读 / 写 / 审 / 管）';

--> statement-breakpoint

COMMENT ON TABLE auth.project_member IS
  '项目成员关系（项目级共享事实）；角色只有 owner / member，每个项目至多一个 owner';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_member.project_id IS
  '项目业务标识（项目本体在每用户 SQLite，此处无外键）';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_member.user_id IS
  '成员用户标识（auth.user.id）';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_member.role IS
  '项目内角色，闭集：owner / member';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_member.time_created IS
  '加入项目时刻（Unix 秒）';

--> statement-breakpoint

COMMENT ON TABLE auth.project_archive IS
  '项目归档状态（项目级共享事实）；archived 与 archived_at 同真同假';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_archive.project_id IS
  '项目业务标识（无外键，理由同 project_member.project_id）';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_archive.archived IS
  '是否已归档：true 已归档 / false 未归档';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_archive.archived_at IS
  '归档时刻（Unix 秒）；未归档时为 NULL';

--> statement-breakpoint

COMMENT ON TABLE auth.project_meta IS
  '项目名称与类型（项目级共享事实）；被邀请的成员靠它看到项目';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_meta.project_id IS
  '项目业务标识（无外键，理由同 project_member.project_id）';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_meta.name IS
  '项目名称（项目级共享，成员列表据此显示）';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_meta.type IS
  '项目类型，闭集：private 私有 / shared 共享；创建时定死，此后不改';

--> statement-breakpoint

COMMENT ON TABLE auth.project_backup_event IS
  '文件级备份快照审计（只增不改）；不存文件内容；只记路径 / 大小 / 哈希统计；created_at 是 Unix 秒';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.id IS
  '自增主键';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.user_id IS
  '触发者用户标识；自动备份时等于沙箱归属者';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.project_id IS
  '项目业务标识';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.action IS
  '动作，闭集：backup / restore / preview / delete_snapshot / gc';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.snapshot_id IS
  '快照标识；与具体快照无关的动作可为 NULL';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.scope IS
  '备份范围（项目相对路径，如 资料/话单）；空串表示整个项目';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.kind IS
  '触发方式，闭集：manual 手动 / auto 自动；可为 NULL';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.files IS
  '涉及文件数';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.bytes IS
  '涉及文件总字节数（逻辑大小）';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.result IS
  '结果，闭集：ok / partial / failed / cancelled';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.error_code IS
  '失败错误码；成功时为 NULL';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.duration_ms IS
  '本次操作耗时（毫秒）';

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.created_at IS
  '记录时刻（Unix 秒）';

--> statement-breakpoint

COMMENT ON TABLE auth._migration IS
  '迁移运行器的记账表：记录已应用的迁移版本';

--> statement-breakpoint
COMMENT ON COLUMN auth._migration.version IS
  '迁移版本号（等于 up 脚本去掉 .sql 的文件名）';

--> statement-breakpoint
COMMENT ON COLUMN auth._migration.applied_at IS
  '应用时刻（Unix 秒）';
