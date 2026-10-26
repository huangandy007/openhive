-- 0017_data_source 的回滚：先删边表（它有双向 FK），再删主表。
DROP TABLE IF EXISTS auth.data_source_lineage;
DROP TABLE IF EXISTS auth.data_source;
