-- 0018_asset_paging 的回滚：只删本次建的索引，不动表。
DROP INDEX IF EXISTS auth.asset_category_idx;

--> statement-breakpoint

DROP INDEX IF EXISTS auth.asset_owner_status_idx;

--> statement-breakpoint

DROP INDEX IF EXISTS auth.asset_updated_idx;

--> statement-breakpoint

DROP INDEX IF EXISTS auth.asset_status_updated_idx;
