-- 0008_column_comments 的回滚：清空本迁移写入的全部注释。
--
-- 注释不承载数据，所以回滚是安全的；清空后表与字段本身保持不变。
-- 顺序与 up 相反（先列、后表、最后 schema），与其它 down 脚本的取向一致。

COMMENT ON COLUMN auth._migration.applied_at IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth._migration.version IS NULL;

--> statement-breakpoint
COMMENT ON TABLE auth._migration IS NULL;

--> statement-breakpoint

COMMENT ON COLUMN auth.project_backup_event.created_at IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.duration_ms IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.error_code IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.result IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.bytes IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.files IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.kind IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.scope IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.snapshot_id IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.action IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.project_id IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.user_id IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_backup_event.id IS NULL;

--> statement-breakpoint
COMMENT ON TABLE auth.project_backup_event IS NULL;

--> statement-breakpoint

COMMENT ON COLUMN auth.project_meta.type IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_meta.name IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_meta.project_id IS NULL;

--> statement-breakpoint
COMMENT ON TABLE auth.project_meta IS NULL;

--> statement-breakpoint

COMMENT ON COLUMN auth.project_archive.archived_at IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_archive.archived IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_archive.project_id IS NULL;

--> statement-breakpoint
COMMENT ON TABLE auth.project_archive IS NULL;

--> statement-breakpoint

COMMENT ON COLUMN auth.project_member.time_created IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_member.role IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_member.user_id IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.project_member.project_id IS NULL;

--> statement-breakpoint
COMMENT ON TABLE auth.project_member IS NULL;

--> statement-breakpoint

COMMENT ON COLUMN auth.role_resource.perm IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.role_resource.resource_id IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.role_resource.resource_type IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.role_resource.role_id IS NULL;

--> statement-breakpoint
COMMENT ON TABLE auth.role_resource IS NULL;

--> statement-breakpoint

COMMENT ON COLUMN auth.user_role.role_id IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user_role.user_id IS NULL;

--> statement-breakpoint
COMMENT ON TABLE auth.user_role IS NULL;

--> statement-breakpoint

COMMENT ON COLUMN auth.role.name IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.role.id IS NULL;

--> statement-breakpoint
COMMENT ON TABLE auth.role IS NULL;

--> statement-breakpoint

COMMENT ON COLUMN auth.user.deactivated_at IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.created_at IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.last_active_at IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.last_login_at IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.must_change_pw IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.is_admin IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.password_hash IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.status IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.section IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.dept IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.org IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.phone IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.id_card IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.name IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.police_no IS NULL;

--> statement-breakpoint
COMMENT ON COLUMN auth.user.id IS NULL;

--> statement-breakpoint
COMMENT ON TABLE auth.user IS NULL;

--> statement-breakpoint
COMMENT ON SCHEMA auth IS NULL;
