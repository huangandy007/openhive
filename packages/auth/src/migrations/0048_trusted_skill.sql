-- 0048_trusted_skill：平台级可信技能白名单（016）。
--
-- 无 project_id：可信是平台级裁定，不是项目级。asset_id 即主键，一个技能至多一行。

CREATE TABLE IF NOT EXISTS auth.trusted_skill (
  asset_id text    NOT NULL REFERENCES auth.asset(id) ON DELETE CASCADE,
  added_by text    NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
  added_at integer NOT NULL,
  PRIMARY KEY (asset_id)
);
