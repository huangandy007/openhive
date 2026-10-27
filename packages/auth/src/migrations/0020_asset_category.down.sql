-- 回滚 0020：分类表整张丢掉。
--
-- ⚠️ 这会丢掉管理员维护过的分类（改名 / 排序 / 新增 / 启停），且资产行的 `category` 里
-- 可能留着本表已不存在的 id。回滚前先导出：`select * from auth.asset_category`。

DROP TABLE IF EXISTS auth.asset_category;
