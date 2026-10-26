-- 0017_data_source：数据源配置（010 T012 / FR-011）。
--
-- 「数据源」是一行可编辑的注册信息：名称 ＋ 类型 ＋ 连接地址 ＋ 更新频率 ＋ 负责人 ＋ 状态。
--
-- ## 没有连接串 / 密码列（刻意）
--
-- DESIGN §4.11.4 的秘密字段规则（永不回显、编辑留空 = 不修改）**等 connector 落地再生效**。
-- v1 的 connector 只留接口、没有任何消费者；在库里落一份明文数据库口令是净风险，
-- 收益为零。等真要连库时，连同密钥方案（加密 / 外部密钥管理）一起定，届时再加列。
--
-- ## 最近同步（`last_synced_at`）为什么现在就留着
--
-- DESIGN §4.11.7 的关键列里有「最近同步」。connector 未实现 ⇒ 这一列**没有任何写者**，
-- 恒为 NULL，界面写「—」（未知，不是 0）。留着列是为了接上 connector 时不用改表；
-- 现在写死 NULL 而不是造一个假时间。
--
-- ## 血缘是一张边表，不是一个字段
--
-- `data_source_lineage(upstream_id, downstream_id)`：一条边 = 「上游 → 下游」。
-- 界面只让登记**上游**，下游由反向查询推出来（谁把我当上游）。两个方向都存在 DB 里
-- 是没有意义的重复；`PRIMARY KEY` 顺带把重复边压掉。
--
-- 三条约束：自引用 CHECK、双向 FK（上游被删则边随之消失）、下游索引（反查是常态）。
-- **成环**由应用层拦（递归可达性），CHECK 只能管住自引用那一种。
CREATE TABLE auth.data_source (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  kind           text NOT NULL,
  endpoint       text NOT NULL DEFAULT '',
  frequency      text NOT NULL DEFAULT 'manual',
  owner          text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'active',
  last_synced_at integer,
  created_by     text NOT NULL,
  created_at     integer NOT NULL,
  updated_by     text NOT NULL,
  updated_at     integer NOT NULL,
  CONSTRAINT data_source_kind_check CHECK (kind IN ('database', 'file', 'api')),
  CONSTRAINT data_source_frequency_check CHECK (frequency IN ('manual', 'hourly', 'daily', 'weekly')),
  CONSTRAINT data_source_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT data_source_name_len_check CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT data_source_endpoint_len_check CHECK (char_length(endpoint) <= 500),
  CONSTRAINT data_source_owner_len_check CHECK (char_length(owner) <= 50)
);
--> statement-breakpoint

-- 名称**全局**唯一：本表没有删除，停用行也留在列表里 —— 同名两行会让人分不清谁是谁。
CREATE UNIQUE INDEX data_source_name_idx ON auth.data_source (name);
--> statement-breakpoint

CREATE INDEX data_source_name_order_idx ON auth.data_source (name);
--> statement-breakpoint

CREATE TABLE auth.data_source_lineage (
  upstream_id   text NOT NULL REFERENCES auth.data_source (id) ON DELETE CASCADE,
  downstream_id text NOT NULL REFERENCES auth.data_source (id) ON DELETE CASCADE,
  PRIMARY KEY (upstream_id, downstream_id),
  CONSTRAINT data_source_lineage_self_check CHECK (upstream_id <> downstream_id)
);
--> statement-breakpoint

CREATE INDEX data_source_lineage_downstream_idx ON auth.data_source_lineage (downstream_id);
--> statement-breakpoint

COMMENT ON TABLE auth.data_source IS
  '治理后台数据源注册（FR-011）；无连接串/密码列（秘密不落库）；last_synced_at 恒 NULL 直至 connector 落地';
--> statement-breakpoint

COMMENT ON TABLE auth.data_source_lineage IS
  '数据源血缘边（上游 → 下游）；界面只登记上游，下游由反向查询推出；成环由应用层拒绝';
