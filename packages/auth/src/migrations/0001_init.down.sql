-- 0001_init 的回滚：撤掉用户表。
--
-- 由迁移运行器的 rollback() 执行（src/migrate.ts），不需要手工在 PG 里敲。
-- 只撤表、不撤 auth schema——schema 是运行器的前置物，保留无副作用。

DROP TABLE auth.user;
