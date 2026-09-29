-- 0003 的 down：把两列的可空性放回去。
--
-- ⚠️ 与 up **不对称、且有损**：up 把 NULL 回填成了 0 / 1，down 无法还原
-- 「哪几行原本是 NULL」——回滚后这些行的值停在回填值上。
-- 对账号语义没有影响（0 / 1 本来就是唯一合法取值），但记账上要知道
-- 这一步不是逐字可逆的，与 0002 的 down 同理（那一个更严重：会丢数据）。

ALTER TABLE auth.user ALTER COLUMN must_change_pw DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE auth.user ALTER COLUMN is_admin DROP NOT NULL;
