-- 0037_case_fact_row_started_index：明细行按「项目 + 时间」取数的索引（2026-11-12）。
--
-- 设计见 docs/superpowers/specs/2026-11-09-事实卡片抽象/01-事实卡片与数据翻译-设计.md §7.2 / §7.11。
-- 现状（§7.1 实测）：明细按时间取 100 行 = 138 ms，走 Parallel Seq Scan（177,713 行）。
-- 这是 P1 唯一要加的索引；其余索引挂在 P3 才建的表上，不提前建。
--
-- ⚠️ 为什么不用 `CREATE INDEX CONCURRENTLY`：迁移运行器把整轮包在一个事务里，
--    事务块里建并发索引会 25001 并把整轮迁移拖失败（README §1）。
--    按设计文档 §7.1 的行数（177,713）估算为秒级（估算，非实测）；若目标库规模远超此量级，
--    按 README §1 的既定路线走部署侧「事务外一次性脚本」，本文件仍保留——否则新库从零迁移时会缺这条索引。
--
-- 为什么是 `IF NOT EXISTS`：走上面脚本路线的库已经把索引建好了，再跑 `migrate()` 时这条空转
-- （幂等），记账行照样补上；裸 `CREATE INDEX` 会报 42P07「relation already exists」，而 runner
-- 整轮一个事务 ⇒ 回滚整轮、挡住之后所有迁移。仓库先例见 `0007_project_backup_event.sql`。
--
-- 只写父表：`case_fact_row` 是 16 个 HASH 分区，父表上的 CREATE INDEX 自动下发到每个分区。

CREATE INDEX IF NOT EXISTS case_fact_row_project_started
  ON auth.case_fact_row (project_id, started_at);

--> statement-breakpoint

COMMENT ON INDEX auth.case_fact_row_project_started IS
  '按项目 + 时间窗取明细（01 §7.2）。project_id 必须是首列：所有读取函数都带它（§7.3）。';
