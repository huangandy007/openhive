-- 0019_user_preference：账号级偏好（需求 6，2026-10-27）。
--
-- 起因是分页：中栏的「每页条数」是**账号偏好**，不是浏览器本地状态——民警在单位电脑上选 50，
-- 回家登录后应当还是 50。`localStorage` 做不到跨设备，所以进库。
--
-- 设计取向：
-- - **一张通用键值表**，不为每页条数单开一列。下一个偏好（左栏默认展开哪类、列表密度）不必
--   再走一次迁移；键的语义由读写两侧共同约定（`auth/preference.ts` 的 `PREFERENCE_KEYS`）。
-- - `value` 存 **文本**，由调用方自己编解码（页大小就是 `"50"`）。不做 JSONB：这一轮的值都是
--   标量，JSONB 只会让「读出来是数字还是字符串」多一层不确定。
-- - 主键 `(user_id, key)`：每用户每键一行，写就是 upsert，不留历史。
-- - 外键**级联删除**：用户注销不能被偏好挡住。
--
-- ⚠️ 不写 `CREATE INDEX CONCURRENTLY`：整轮迁移在一个事务里（见 migrations/README.md）。

CREATE TABLE auth.user_preference (
  user_id    text    NOT NULL REFERENCES auth.user(id) ON DELETE CASCADE,
  key        text    NOT NULL,
  value      text    NOT NULL,
  updated_at integer NOT NULL,
  PRIMARY KEY (user_id, key)
);

--> statement-breakpoint

COMMENT ON TABLE auth.user_preference IS
  '账号级偏好（每用户每键一行）；当前用于中栏「每页条数」，跨设备一致（需求 6）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user_preference.user_id IS
  '偏好所属用户（auth.user.id）；用户注销时级联删除';

--> statement-breakpoint
COMMENT ON COLUMN auth.user_preference.key IS
  '偏好键（闭集，见 auth/preference.ts 的 PREFERENCE_KEYS）；不认识的键读写都拒绝';

--> statement-breakpoint
COMMENT ON COLUMN auth.user_preference.value IS
  '偏好值（文本，由调用方编解码；例如每页条数为 "20" / "50" / "100"）';

--> statement-breakpoint
COMMENT ON COLUMN auth.user_preference.updated_at IS
  '最后写入时间（Unix 秒）；只用于排查，不参与排序';
