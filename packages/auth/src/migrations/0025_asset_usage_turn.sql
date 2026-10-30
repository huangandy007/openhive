-- 0025_asset_usage_turn：使用记录按「一轮对话」去重（2026-10-30 用户裁定 C）。
--
-- 口径变化：同一轮用户请求里，模型常把同一个技能跑好几遍（转换 → 检查 → 修正 → 重转），
-- 每一次都是独立的 bash part。按 part 记，「用了一次」会被记成 3 次（真栈 2026-10-30
-- 20:15 实测：同一条请求里 3 条 python 命令 = 3 行）。
--
-- 轮次 id = 该 part 之前**最近一条 role=user 消息**的 `message.id`（源库每用户 SQLite）。
-- 唯一索引 (user_id, turn_id, asset_id)：同一轮里同一资产只留第一行。
--
-- `turn_id` 允许 NULL：迁移前的历史行、找不到用户消息的 part 都留空。PG 的唯一索引里
-- NULL 互不相等 ⇒ 老数据不受这条索引约束，也不会把新行挡掉。

ALTER TABLE auth.asset_usage_event ADD COLUMN turn_id text;

--> statement-breakpoint

CREATE UNIQUE INDEX asset_usage_event_turn_idx
  ON auth.asset_usage_event (user_id, turn_id, asset_id);
