-- 0001_init：auth schema 的用户表（design-v2 §4.1，2026-09-06-openhive-design-v2.md:124-145）
--
-- 与 sqlite（opencode core）无关：账号存业务 PG 的独立 auth schema，见 plan.md「Storage」。
-- auth schema 本身由迁移运行器保证存在（src/migrate.ts），本文件只负责表。
--
-- `user` 是 PG 保留字，但作为限定名后缀（auth.user）无需加引号——已实测。
--
-- ⚠️ 三个时间列 last_login_at / last_active_at / created_at 的单位是 **Unix 秒**，
--    不是毫秒。integer 是 int4（上限 2147483647），秒装得下、毫秒（1.79e12）装不下——
--    2026-09-29 首次录入账号时实测撞上 22003 numeric_value_out_of_range。
--    写入一律走 src/time.ts 的 nowSeconds()，不要直接写 Date.now()。
--    单位与 JWT 的 exp（hono/jwt，也是秒）保持一致。

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
