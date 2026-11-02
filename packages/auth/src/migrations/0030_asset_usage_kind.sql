-- 0030_asset_usage_kind：使用记录区分「用的是什么」（2026-11-02 设计 §7 批次 4）。
--
-- 为什么加列而不是另建一张表：MCP 调用与 skill 调用是**同一种事实**（某人某时用了一个资产，
-- 一次调用一行），只是资产类型不同。另建表会让「这个资产被用了多少次」变成两条查询。
--
-- kind 闭集（与 `asset-usage.ts` 的 `形态` 变量逐值一致）：
--   skill = skill 工具 / bash 跑技能脚本 / read 读 SKILL.md（三条老入口）；
--   mcp   = MCP 工具调用（工具名形如 `<资产 id>_<工具名>`）；
--   slash = 斜杠命令展开的文本 part。
--
-- 历史行（0024~0029）**无法再区分**形态，统一回填 'skill'。这是已知缺口，写在设计 §9；
-- 不要为了「猜得更准」按 tool_name 反推——那时还没有 tool_name 这一列。
--
-- tool_name 存**模型实际调用的工具名**：MCP 是完整工具名（便于排障与将来拆工具级授权），
-- 斜杠命令没有工具 ⇒ 空串。

ALTER TABLE auth.asset_usage_event
  ADD COLUMN kind text NOT NULL DEFAULT 'skill';

--> statement-breakpoint

ALTER TABLE auth.asset_usage_event
  ADD COLUMN tool_name text NOT NULL DEFAULT '';

--> statement-breakpoint

ALTER TABLE auth.asset_usage_event
  ADD CONSTRAINT asset_usage_event_kind_check CHECK (kind IN ('skill', 'mcp', 'slash'));

--> statement-breakpoint

COMMENT ON COLUMN auth.asset_usage_event.kind IS
  '使用形态闭集：skill（skill / bash / read 三条入口）/ mcp（MCP 工具调用）/ slash（斜杠命令）；历史行统一回填 skill';

--> statement-breakpoint

COMMENT ON COLUMN auth.asset_usage_event.tool_name IS
  '模型实际调用的工具名；MCP 为 <资产 id>_<工具名>，斜杠命令为空串';
