-- 0001_init：auth schema 的用户表（design-v2 §4.1，2026-09-06-openhive-design-v2.md:124-145）
--
-- 与 sqlite（opencode core）无关：账号存业务 PG 的独立 auth schema，见 plan.md「Storage」。
-- auth schema 本身由迁移运行器保证存在（src/migrate.ts），本文件只负责表。
--
-- `user` 是 PG 保留字，但作为限定名后缀（auth.user）无需加引号——已实测。

CREATE TABLE auth.user (
  id             text PRIMARY KEY,
  police_no      text NOT NULL UNIQUE,
  name           text NOT NULL,
  id_card        text NOT NULL,
  phone          text NOT NULL,
  org            text NOT NULL,
  dept           text NOT NULL,
  section        text NOT NULL,
  status         integer NOT NULL,
  password_hash  text NOT NULL,
  is_admin       integer DEFAULT 0,
  must_change_pw integer DEFAULT 1,
  last_login_at  integer,
  last_active_at integer,
  created_at     integer NOT NULL
);
