-- 0012_asset_preferences 的回滚：删掉收藏与使用记录。
--
-- ⚠️ 会丢掉全部个人收藏与使用时间；资产本身、授权与通知都不受影响。
--    回滚后 `auth.asset.favorite_count` / `usage_count` 缓存列仍保留旧值
--    （它们不是由这两张表实时算出来的），需要时另行校准。

DROP TABLE auth.asset_usage;
--> statement-breakpoint
DROP TABLE auth.asset_favorite;
