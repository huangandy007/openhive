-- 0005_project_member 的回滚：撤掉 005 的两张共享态表。
--
-- ⚠️ 只用于「升级后发现要退回」：DROP TABLE 会**丢掉全部成员关系与归档状态**——
-- 退回后每个共享项目都变回「无人认领」，而 `project` 行（每用户 SQLite，本迁移碰不到）
-- 还在。**没有自动重建的路径**：成员关系只能重新邀请、归档状态只能重新归档。
-- 对**已上线并已有共享项目**的环境，这不是一次可回退的操作——先把两张表导出。
--
-- ⚠️ 顺序无关紧要（两张表之间没有外键；`project_member.user_id` 指向的 `auth.user`
-- 本迁移不删）。保持与 up 相反的书写顺序只是为了让两份文件对着读时好比对。

DROP TABLE auth.project_archive;
--> statement-breakpoint
DROP TABLE auth.project_member;
