-- 0012_asset_preferences：收藏与使用记录（009 T011，FR-007）。
--
-- 这两张表解决的是同一个问题的两半：右栏「更多 skill」抽屉的排序（design §1.5 / PRD §8.2）。
--
-- - `asset_favorite`：**个人偏好**。收藏 ≠ 授权（design §1.3）——收藏行不参与任何
--   `effectivePermissions()` / `canReadAsset()` 判定，只影响排序（`preferences.ts`）。
--   「启用」这个旧概念由此被彻底拆掉：能不能看/用由 `role_resource` 决定，常不常用由本表决定。
-- - `asset_usage`：**最近使用**。每用户每资产一行，只存最近一次时间；次数统计落在
--   `auth.asset.usage_count`（缓存列，与 `favorite_count` 同性质）。
--
-- 为什么不把收藏存进用户沙箱 / 每用户 SQLite：收藏要在网页端跨设备可读、也要能被
-- 「资产下线通知使用者」这类服务端动作解析（T010 §4 的残差正是等这张表）。
--
-- ⚠️ 两个外键都**级联删除**（资产删除 → 收藏/使用记录失去意义；用户注销不能被它们挡住）。
--    用户注销会让 `auth.asset.favorite_count` 暂时偏大——它是缓存，不是账本；
--    对账脚本与 T003 的孤儿目录一并处理。
--
-- ⚠️ 主键 `(user_id, asset_id)` 已覆盖「我的收藏」查询；`asset_id` 上的单列索引是给
--    「这份资产被谁收藏 / 谁最近用过」用的（下线通知的收件人解析），不能省。
--
-- ⚠️ 不写 `CREATE INDEX CONCURRENTLY`：整轮迁移在一个事务里（见 migrations/README.md）。

CREATE TABLE auth.asset_favorite (
  user_id    text NOT NULL REFERENCES auth.user(id) ON DELETE CASCADE,
  asset_id   text NOT NULL REFERENCES auth.asset(id) ON DELETE CASCADE,
  created_at integer NOT NULL,
  PRIMARY KEY (user_id, asset_id)
);

--> statement-breakpoint

CREATE INDEX asset_favorite_asset_idx ON auth.asset_favorite (asset_id);

--> statement-breakpoint

CREATE TABLE auth.asset_usage (
  user_id      text NOT NULL REFERENCES auth.user(id) ON DELETE CASCADE,
  asset_id     text NOT NULL REFERENCES auth.asset(id) ON DELETE CASCADE,
  last_used_at integer NOT NULL,
  PRIMARY KEY (user_id, asset_id)
);

--> statement-breakpoint

CREATE INDEX asset_usage_asset_idx ON auth.asset_usage (asset_id);

--> statement-breakpoint

COMMENT ON TABLE auth.asset_favorite IS
  '资产收藏（个人偏好）；收藏不参与授权判定，只影响右栏抽屉排序（009 T011）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_favorite.user_id IS
  '收藏人用户标识（auth.user.id）；用户注销时级联删除';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_favorite.asset_id IS
  '被收藏的资产标识（auth.asset.id）；资产删除时级联删除';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_favorite.created_at IS
  '收藏时间（Unix 秒）；我的收藏列表按它倒序';

--> statement-breakpoint
COMMENT ON TABLE auth.asset_usage IS
  '资产使用记录（每用户每资产一行，只存最近一次使用时间）；用于抽屉「最近使用上浮」（009 T011）';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_usage.user_id IS
  '使用人用户标识（auth.user.id）；用户注销时级联删除';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_usage.asset_id IS
  '被使用的资产标识（auth.asset.id）；资产删除时级联删除';

--> statement-breakpoint
COMMENT ON COLUMN auth.asset_usage.last_used_at IS
  '最近一次使用时间（Unix 秒）；同一用户多次使用只更新这一列，不累计行数';
