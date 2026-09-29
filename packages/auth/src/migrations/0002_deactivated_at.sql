-- 0002_deactivated_at：给 auth.user 加「停用时刻」（002 T016 / FR-010）
--
-- 为什么必须加这一列：design-v2 §4.1 原来的 15 列里，生命周期只有 status 一个字段，
-- **没有任何地方记「什么时候停用的」**。而 FR-010 要求「保留 30 天再归档/删除」——
-- 没有停用时刻，「是否已满 30 天」根本无从判定（T016 因此卡住，经用户裁定补列）。
--
-- 单位仍是 **Unix 秒**，与 created_at / last_login_at / last_active_at 一致（见 src/time.ts）。
--
-- 语义三分：
--   NULL + status = 1  → 从未停用过（常态）
--   NULL + status = 0  → 停用，但**停用时刻未知**（002 之前的历史数据）
--   非 NULL + status = 0 → 停用，且知道从何时起算
-- 第三态是刻意留的：无法判定何时停用的历史账号**不进归档清单**（宁可漏归档，不可误删）。
--
-- 列位置：ALTER ADD COLUMN 会追加到末尾，故它在 created_at 之后。
-- design-v2 §4.1 的表已同步成同样顺序——migrate.test.ts 有「顺序逐字相同」的断言钉着。
--
-- DOWN：0002_deactivated_at.down.sql

ALTER TABLE auth.user ADD COLUMN deactivated_at integer;
