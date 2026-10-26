-- 0016_template：模板库（010 T011 / FR-010）。
--
-- 「配置模板」就是一行可编辑的配置：类型（报告模板 / 图谱样式 / 报表口径）＋ 名称 ＋
-- 适用范围 ＋ **一段正文**。v1 不给正文定结构化 schema——报告生成 / 图谱渲染的消费者都还
-- 不存在，先造一套没人读的字段就是给未来埋错（`plan.md` 的 MVP 取舍）。
--
-- 三处刻意选择：
--
-- ① `id` 是 text（应用侧 `crypto.randomUUID()`），与 `auth.user` / `auth.org_node` / `auth.asset`
--    同一口径。别换 bigserial：本仓 BIGSERIAL 只给**流水**用（`project_backup_event` /
--    `audit_event`），配置行要能被前端直接当路径参数带回，text 少一层解析。
-- ② `created_at` / `updated_at` 是 integer（Unix 秒，同 `src/time.ts`）。
-- ③ **停用 ≠ 删除**：`status` 只有 active / disabled，没有 DELETE 入口。停用的行仍留在库里
--    （将来按 id 追溯「这条模板曾经生效过」时还找得到），但**不进列表**、也不可再编辑。
--
-- 唯一性只在 active 行上：`(kind, name) WHERE status = 'active'`。停用后同名可以重新建——
-- 「停用」常常就是因为要换一份同名的新版本，若把唯一性也压在历史行上，管理员只能靠改名绕。
CREATE TABLE auth.template (
  id          text PRIMARY KEY,
  kind        text NOT NULL,
  name        text NOT NULL,
  scope       text NOT NULL DEFAULT '',
  content     text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'active',
  created_by  text NOT NULL,
  created_at  integer NOT NULL,
  updated_by  text NOT NULL,
  updated_at  integer NOT NULL,
  CONSTRAINT template_kind_check CHECK (kind IN ('report', 'graph', 'metric')),
  CONSTRAINT template_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT template_name_len_check CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT template_scope_len_check CHECK (char_length(scope) <= 200),
  CONSTRAINT template_content_len_check CHECK (char_length(content) <= 20000)
);
--> statement-breakpoint

CREATE UNIQUE INDEX template_active_name_idx ON auth.template (kind, name) WHERE status = 'active';
--> statement-breakpoint

-- 列表的唯一序：按「最近改过」排，分段控件切换后仍然稳定。
CREATE INDEX template_kind_updated_idx ON auth.template (kind, updated_at DESC);
--> statement-breakpoint

COMMENT ON TABLE auth.template IS
  '治理后台模板库（报告模板/图谱样式/报表口径）；停用 = status=disabled 且不进列表；唯一性只约束 active 行';
