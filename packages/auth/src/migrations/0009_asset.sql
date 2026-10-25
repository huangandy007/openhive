-- 0009_asset：资产统一元数据表（009 T003，FR-001）。
--
-- 资产域（Skill / MCP / 知识库）暂借 `auth` schema：迁移运行器、记账表、中文注释测试与
-- 真 PG 夹具都只认 `auth`（D0-1 技术债）。F10 评估拆 schema 时整表迁走，不在这里预埋第二套目录。
--
-- 表的真相来源是本文件；drizzle 模型在 `packages/asset-service/src/asset.ts`。
-- 两侧只改一边会被 `asset.test.ts` 的防漂移断言拦下。
--
-- ⚠️ 闭集（type / visibility / status）与 `packages/asset-service/src/metadata.ts` 的
--    `ASSET_TYPES` / `ASSET_VISIBILITIES` / `ASSET_STATUSES` 是同一份值的两处写法。
--    改一边必须改另一边：`asset.test.ts` 从 `pg_constraint` 读定义串，与常量逐值双向比对。
--
-- ⚠️ `owner_id` 外键**不级联**（PG 默认 RESTRICT）。删一个仍有资产的用户会报错，
--    而不是静默把资产变成无主行。资产归属丢失比删除失败更难查。
--
-- ⚠️ 本迁移不写 `CREATE INDEX CONCURRENTLY`：整轮迁移在一个事务里（见 migrations/README.md）。
--    当前只有主键索引；按分类 / 状态 / 所有者的查询索引等 T005/T006 有真实取数形状后再加。

CREATE TABLE auth.asset (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  type           text NOT NULL,
  description    text NOT NULL,
  icon           text NOT NULL,
  category       text NOT NULL,
  tags           text[] NOT NULL DEFAULT '{}'::text[],
  owner_id       text NOT NULL REFERENCES auth.user(id),
  owner_name     text NOT NULL,
  department     text NOT NULL DEFAULT '',
  visibility     text NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  status         text NOT NULL DEFAULT 'draft',
  favorite_count integer NOT NULL DEFAULT 0,
  usage_count    integer NOT NULL DEFAULT 0,
  rating         numeric(3, 2) NOT NULL DEFAULT 0,
  rating_count   integer NOT NULL DEFAULT 0,
  feedback_count integer NOT NULL DEFAULT 0,
  created_at     integer NOT NULL,
  updated_at     integer NOT NULL,
  published_at   integer,
  archived_at    integer,
  CONSTRAINT asset_type_check CHECK (type IN ('skill', 'mcp', 'knowledge_base')),
  CONSTRAINT asset_visibility_check CHECK (visibility IN ('global', 'department', 'personal')),
  CONSTRAINT asset_status_check CHECK (
    status IN ('draft', 'in_review', 'pending_tech', 'published', 'iterating', 'offline', 'archived')
  ),
  CONSTRAINT asset_name_not_blank_check CHECK (btrim(name) <> ''),
  CONSTRAINT asset_description_not_blank_check CHECK (btrim(description) <> ''),
  CONSTRAINT asset_icon_not_blank_check CHECK (btrim(icon) <> ''),
  CONSTRAINT asset_category_not_blank_check CHECK (btrim(category) <> ''),
  CONSTRAINT asset_owner_name_not_blank_check CHECK (btrim(owner_name) <> ''),
  CONSTRAINT asset_department_required_check CHECK (visibility <> 'department' OR btrim(department) <> ''),
  CONSTRAINT asset_version_check CHECK (version >= 1),
  CONSTRAINT asset_counts_check CHECK (
    favorite_count >= 0 AND usage_count >= 0 AND rating_count >= 0 AND feedback_count >= 0
  ),
  CONSTRAINT asset_rating_check CHECK (rating >= 0 AND rating <= 5),
  CONSTRAINT asset_updated_at_check CHECK (updated_at >= created_at)
);

--> statement-breakpoint

COMMENT ON TABLE auth.asset IS
  '资产统一元数据（Skill / MCP / 知识库）；资产域暂借 auth schema，F10 再评估拆 schema';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.id IS
  '资产唯一标识（稳定 ID；/assets 下的目录按它命名，显示名可改而路径不漂）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.name IS
  '资产显示名；可修改，不参与目录路径';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.type IS
  '资产类型，闭集：skill / mcp / knowledge_base';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.description IS
  '资产描述（一行说明；卡片与抽屉展示）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.icon IS
  '图标标识；前端按标识映射到视觉资产，不存图片路径';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.category IS
  '业务分类 ID；取值见 asset-service 的 categories.ts；单值，不等同于 tags';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.tags IS
  '标签数组；用于搜索与分组；同一资产内不允许重复';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.owner_id IS
  '所有者用户标识（auth.user.id）；作者沙箱与权限归属；外键不级联';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.owner_name IS
  '所有者姓名快照；用户改名后历史资产仍显示提交时的姓名';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.department IS
  '所属部门（自由文本，D0-4 技术债）；visibility=department 时必须非空';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.visibility IS
  '可见范围，闭集：global / department / personal（全局 / 部门 / 个人）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.version IS
  '版本号，从 1 开始；迭代发布时加 1';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.status IS
  '生命周期状态，闭集：draft / in_review / pending_tech / published / iterating / offline / archived';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.favorite_count IS
  '收藏数（缓存计数）；收藏只影响排序，不改变授权';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.usage_count IS
  '使用次数（服务端统计，T011 接入）；不是本机最近使用权重';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.rating IS
  '平均评分，0 到 5，保留两位小数';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.rating_count IS
  '评分人数（非负整数）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.feedback_count IS
  '反馈条数（非负整数）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.created_at IS
  '创建时刻（Unix 秒）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.updated_at IS
  '最后更新时刻（Unix 秒）；不得早于 created_at';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.published_at IS
  '首次发布时刻（Unix 秒）；未发布为 NULL';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset.archived_at IS
  '归档时刻（Unix 秒）；未归档为 NULL';
