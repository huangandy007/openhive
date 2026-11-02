-- 0029_asset_mcp_connection：MCP 资产的连接规格（2026-11-02 设计 §3.1.2）。
--
-- 为什么不并进 auth.asset：连接是**运行期接线**，与「它是什么」生命周期不同；混进同一行会让
-- 每次读资产都把凭据带上（设计 §3.1.1）。
--
-- 读接口永不返回值：headers / environment 只返回键名与「已设置」（设计 §5.2）。
-- 本批不加密、不轮换，是已知缺口，见设计 §9。

CREATE TABLE auth.asset_mcp_connection (
  asset_id      text PRIMARY KEY REFERENCES auth.asset(id) ON DELETE CASCADE,
  transport     text NOT NULL,
  url           text,
  command       text[],
  cwd           text,
  headers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  environment   jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled       boolean NOT NULL DEFAULT true,
  timeout_ms    integer,
  -- 最近一次「技术发布」时的连接规格快照；草稿期 / 迭代期改的是上面那组工作列
  published_config jsonb,
  -- 发布前试连的结果（只做展示与排障，不作为运行期判据）
  checked_at    integer,
  check_ok      boolean,
  check_error   text NOT NULL DEFAULT '',
  tool_count    integer,
  created_at    integer NOT NULL,
  updated_at    integer NOT NULL,
  CONSTRAINT asset_mcp_connection_transport_check CHECK (transport IN ('local', 'remote')),
  CONSTRAINT asset_mcp_connection_shape_check CHECK (
    (transport = 'remote' AND url IS NOT NULL AND command IS NULL)
    OR (transport = 'local' AND command IS NOT NULL AND url IS NULL)
  ),
  CONSTRAINT asset_mcp_connection_fields_check CHECK (
    (transport = 'remote' AND environment = '{}'::jsonb)
    OR (transport = 'local' AND headers = '{}'::jsonb)
  ),
  CONSTRAINT asset_mcp_connection_timeout_check CHECK (timeout_ms IS NULL OR timeout_ms > 0)
);

--> statement-breakpoint

COMMENT ON TABLE auth.asset_mcp_connection IS
  'MCP 资产连接规格：资产 id → 内核 ConfigMCPV1.Info 的投影来源；凭据值不出任何读接口';

--> statement-breakpoint

COMMENT ON COLUMN auth.asset_mcp_connection.published_config IS
  '技术发布时的连接快照；同步器只读这一列（草稿 / 迭代期的工作列不上线）';
