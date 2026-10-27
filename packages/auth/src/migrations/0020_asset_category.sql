-- 0020_asset_category：业务分类改由管理员维护（需求 4，2026-10-27）。
--
-- 今天分类是代码里的一份常量（`asset-service/src/categories.ts` 的 `ASSET_CATEGORY_SEED`）。
-- 需求 4 要求管理员能增、改名、排序、启停，所以进库；常量降级为「seed 源」。
--
-- 设计取向：
-- - **seed 用 `on conflict do nothing`，绝不用 `do update`**：后者会让每次部署把管理员
--   改过的名字/顺序/启停状态覆盖回初稿，等于「维护过的白维护」。
-- - **无硬删除**：`enabled` 管启停。资产行的 `category` 存的是 id，删掉分类行会让那批资产
--   指向一个再也查不到的名字；停用则是「左栏不再列出、资产仍在」，交给需求 2 的「其他」兜底。
-- - `id` 稳定、`name` 可改：改名不换 id，已发布资产自动跟着改文案。
-- - `builtin` 标出 seed 那九类（只作排查/审计用，**不参与任何判权**）。
-- - `name` 唯一：左栏出现两个同名分类，用户没法分辨该点哪个。
-- - 排序用 `sort_order`（`order` 是 SQL 关键字，列名带引号以后到处要转义）。
--
-- ⚠️ 不写 `CREATE INDEX CONCURRENTLY`：整轮迁移在一个事务里（见 migrations/README.md）。

CREATE TABLE auth.asset_category (
  id         text    PRIMARY KEY,
  name       text    NOT NULL,
  sort_order integer NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  builtin    boolean NOT NULL DEFAULT false,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT asset_category_name_not_blank_check CHECK (btrim(name) <> '')
);

--> statement-breakpoint
CREATE UNIQUE INDEX asset_category_name_key ON auth.asset_category (name);

--> statement-breakpoint
CREATE INDEX asset_category_order_idx ON auth.asset_category (sort_order, id);

--> statement-breakpoint
INSERT INTO auth.asset_category (id, name, sort_order, enabled, builtin, created_at, updated_at) VALUES
  ('intelligence',        '情报研判', 10, true, true, extract(epoch from now())::integer, extract(epoch from now())::integer),
  ('case-handling',       '案件办理', 20, true, true, extract(epoch from now())::integer, extract(epoch from now())::integer),
  ('interrogation',       '审讯深挖', 30, true, true, extract(epoch from now())::integer, extract(epoch from now())::integer),
  ('arrest-prosecution',  '报捕起诉', 40, true, true, extract(epoch from now())::integer, extract(epoch from now())::integer),
  ('document-drafting',   '文书写作', 50, true, true, extract(epoch from now())::integer, extract(epoch from now())::integer),
  ('internal-affairs',    '内勤文字', 60, true, true, extract(epoch from now())::integer, extract(epoch from now())::integer),
  ('planning',            '方案制作', 70, true, true, extract(epoch from now())::integer, extract(epoch from now())::integer),
  ('supervision',         '督导考核', 80, true, true, extract(epoch from now())::integer, extract(epoch from now())::integer),
  ('special-action',      '专项行动', 90, true, true, extract(epoch from now())::integer, extract(epoch from now())::integer)
ON CONFLICT DO NOTHING;

--> statement-breakpoint
COMMENT ON TABLE auth.asset_category IS
  '业务分类（需求 4）：管理员可增 / 改名 / 排序 / 启停，无硬删除；资产行的 category 存本表 id';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_category.name IS
  '分类文案（可改；改名不换 id，已发布资产自动跟着改显示文案）；全表唯一';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_category.sort_order IS
  '左栏展示顺序（小的在前）；同名次按 id 兜底排序，保证顺序稳定';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_category.enabled IS
  '是否启用：停用后左栏不再列出，但已归入该类别的资产仍在（需求 2 的「其他」兜底）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_category.builtin IS
  '是否 seed 内置分类（仅用于排查与审计，不参与任何权限/可用性判定）';
