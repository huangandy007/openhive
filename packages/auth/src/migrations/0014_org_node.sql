-- 0014_org_node：组织架构三级树（010 T006 / FR-005）。
--
-- 一张自引用表，`level` 显式存 1/2/3（org / dept / section）。为什么不建三张表：
-- 三级是硬约束、字段完全相同，三张表要写三套增删改与三份「同级同名」守卫，
-- 守卫一漂就是「单位层拦住了、科室层没拦住」。
--
-- 三条约束各挡一件事：
--
-- ① `level between 1 and 3` —— 第四级在数据层就进不来（服务层另有更早的报错）。
-- ② `(parent_id is null) = (level = 1)` —— 根节点只能是单位、单位必须有父节点。
--    跨行的「子级 = 父级 + 1」CHECK 表达不了（要触发器），由服务层保证；
--    这条只挡「挂错层」那一半。
-- ③ 同级同名唯一**用表达式索引**：`parent_id` 为 NULL 时，普通 UNIQUE 不认为两行冲突
--    （NULL 互不相等），而根节点恰恰全是 NULL ⇒ 不套 coalesce 的话「两个甲单位」能建进去。
--
-- 账号**不**挂外键到本表：`auth.user` 的 org/dept/section 是既有文本列，全仓多处读者
-- （登录身份投影、成员名单、资产可见性）都按文本读。节点与账号的关联就是「同一段路径文本」，
-- 改名由服务层在同一事务里级联更新三列（009 §5 的技术债，T006 偿还）。
CREATE TABLE auth.org_node (
  id         text PRIMARY KEY,
  parent_id  text REFERENCES auth.org_node(id) ON DELETE RESTRICT,
  level      smallint NOT NULL,
  name       text NOT NULL,
  -- 时间列用 integer（Unix 秒），与 `auth.user` 同一单位与类型：int4 到 2038 年
  -- （`src/time.ts` 有完整理由）。⚠️ 别改 bigint：生产驱动（bun-sql）把 bigint 读成**字符串**，
  -- PGlite 读成数字——服务层按数字严格解析，换类型会在真连接上炸而测试全绿（`#002-01`）。
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CONSTRAINT org_node_level_check CHECK (level BETWEEN 1 AND 3),
  CONSTRAINT org_node_root_check CHECK ((parent_id IS NULL) = (level = 1)),
  CONSTRAINT org_node_name_check CHECK (length(btrim(name)) > 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX org_node_sibling_name_key ON auth.org_node (coalesce(parent_id, ''), name);
--> statement-breakpoint

CREATE INDEX org_node_parent_idx ON auth.org_node (parent_id);
--> statement-breakpoint

-- 每个字段都写中文注释（0008 起的约束，`comments.test.ts` 会红）。
COMMENT ON TABLE auth.org_node IS '组织架构三级树：level 1=单位(org) / 2=部门(dept) / 3=科室(section)；同级同名唯一';
--> statement-breakpoint

COMMENT ON COLUMN auth.org_node.id IS '节点标识（服务端生成，文本 id）';
--> statement-breakpoint

COMMENT ON COLUMN auth.org_node.parent_id IS '上级节点 id；NULL = 根节点（单位），非 NULL 时层级必须是 2 或 3';
--> statement-breakpoint

COMMENT ON COLUMN auth.org_node.level IS '层级：1 单位 / 2 部门 / 3 科室；第四级在数据层就进不来';
--> statement-breakpoint

COMMENT ON COLUMN auth.org_node.name IS '节点名称，非空；同一上级下唯一（根节点之间也唯一）';
--> statement-breakpoint

COMMENT ON COLUMN auth.org_node.created_at IS '创建时间（Unix 秒，int4）；与 auth.user 的时间列同单位同类型';
--> statement-breakpoint

COMMENT ON COLUMN auth.org_node.updated_at IS '最后修改时间（Unix 秒，int4）；改名级联时为改名时刻';
