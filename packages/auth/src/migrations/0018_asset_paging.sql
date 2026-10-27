-- 0018_asset_paging：资产列表的服务端分页索引（需求 6，2026-10-27）。
--
-- ## 为什么要建
--
-- 0009 的文件头写着「当前只有主键索引；按分类 / 状态 / 所有者的查询索引等 T005/T006 有
-- 真实取数形状后再加」。现在形状定了：列表恒按 `updated_at desc, id asc` 排，条件落在
-- `status` / `type` / `category` / `owner_id` 上，而且**分页要求先筛后切**——没有索引时
-- `limit 20 offset N` 仍要扫全表排序，翻到后面几页就是一次「全量扫 + 排序」。
--
-- ## 四条索引与它们各自的读者
--
-- - `asset_status_updated_idx`：使用面（`status = 'published'`）与治理列表（按状态筛）
--   的主路径。列序 `status` 在前，因为它是等值条件且选择性最高。
-- - `asset_updated_idx`：治理列表**不传状态**时的全量分页。`ORDER BY updated_at DESC, id ASC`
--   与索引顺序逐字一致，才能走 index scan 而不是 sort。
-- - `asset_owner_status_idx`：需求 3d「我自己的个人资产」——按作者取自己的东西。
-- - `asset_category_idx`：需求 4/2 的分类筛选与「其他」兜底（`category` 不在启用集合）。
--
-- ## 不写 CONCURRENTLY
--
-- 整轮迁移在一个事务里（见 migrations/README.md §1），事务块内写 `CONCURRENTLY` 会报 25001
-- 且**整轮一起失败**。资产表今天是百级行，直接建；真到需要在线建索引的规模，按 README
-- 走部署侧的一次性脚本。

CREATE INDEX asset_status_updated_idx ON auth.asset (status, updated_at DESC, id ASC);

--> statement-breakpoint

CREATE INDEX asset_updated_idx ON auth.asset (updated_at DESC, id ASC);

--> statement-breakpoint

CREATE INDEX asset_owner_status_idx ON auth.asset (owner_id, status);

--> statement-breakpoint

CREATE INDEX asset_category_idx ON auth.asset (category, updated_at DESC, id ASC);
