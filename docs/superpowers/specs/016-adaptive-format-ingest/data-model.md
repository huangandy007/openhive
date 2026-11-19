# Phase 1 Data Model: 数据格式自适应与自动入库

**Date**: 2026-11-19 | **Plan**: [plan.md](./plan.md) | **Contracts**: [contracts/](./contracts/)

> 只列本 feature 新增 / 变更的存储。**不变**：`case_fact_row`、`case_entity`、`case_entity_alias`、`case_citation`、`case_event`、`case_table_format`、`case_translate` 系列结构。
> 所有新表都在 `auth` schema、带 `project_id`（平台级白名单除外），读取一律经既有项目成员闸。
> **迁移配对**：`0045`–`0049` 每组都必须带 `.down.sql`（撤列 / 删表 / 删索引），与 `0035`–`0044` 既有惯例一致。

---

## 1. 实体总览

| 实体 | 存储 | 新 / 改 | 说明 |
|---|---|---|---|
| 材料（`case_material`） | `auth.case_material` | 改：+`probe` | 落盘即建；状态仍六态闭集 |
| 解析作业（`case_ingest_job`） | `auth.case_ingest_job` | 改：+`reason_code` +`progress` +`adapter_id` +`adapter_version` | 一次执行一行；原因、进度与适配器快照都挂这里 |
| 材料报告（`case_material_report`） | 新表 | 新 | append-only 执行历史；N8 准入闸的输入 |
| 数据源档案（`case_source_profile`） | `auth.case_source_profile` | 改：+4 列 | 匹配判据不变（只用 `header_set`） |
| 项目入库设置（`project_case_ingest_settings`） | 新表 | 新 | 两个项目级开关 |
| 可信技能白名单（`trusted_skill`） | 新表 | 新 | 平台级，`is_admin` 维护 |
| 适配器包 | 文件系统（`.opencode/skill/<assetId>/`） | 无新表 | 注册表按目录签名缓存 |
| 富化结果 | 不落新表 | — | 作为属性观察写入既有 `attrs`（带出处） |
| 富化缓存 / 负缓存 | 进程内存 | — | 重启即失；非派生数据 |

---

## 2. `auth.case_material`（改：+`probe`）

既有列不变（`0031_case_fact_layer.sql:21-41`）。新增：

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `probe` | `jsonb` | 可空 | 探测第一版结论；作业结论以 `parse_status` 为准 |

`probe` 形状：

```json
{ "状态": "探测中|已识别|未识别", "适配器id": "…?", "版本": "…?", "原因码": "未识别:…?", "完成秒": 1730000000 }
```

规则：

- 探测**不写** `parse_status`（避免「排队中 → 有问题」非法转移，见 `case-ingest.ts:363-366`）。
- 作业成功后 `probe` 保留（历史），界面以 `parse_status` + 最近作业原因码为准。
- 探测只处理 `parse_status='排队中'` 且 `probe is null` 的行；旧材料不会被一次性标注。
- `probe.状态='未识别'` 且作业尚未跑完时，界面显示「未识别（待确认）」，**不**提前显示「有问题」。
- 探测认领的形状固定为这一条件，迁移 `0045` 同组加**部分索引**：`INDEX ON auth.case_material (created_at) WHERE parse_status = '排队中' AND probe IS NULL`——否则每轮轮询（500ms）全表扫（`#013-09` 的反面：查询形状变了就要看索引）。

---

## 3. `auth.case_ingest_job`（改：+`reason_code` +`progress` +`adapter_id` +`adapter_version`）

既有列不变（`0031:312-325` + `0032:54` 的 `source_path` + `0044:17` 的 `template_id`）。新增（迁移 `0045`）：

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `reason_code` | `text` | 可空；CHECK 见下 | 结构化原因码，六值闭集 |
| `progress` | `jsonb` | 可空 | 运行中进度 |
| `adapter_id` | `text` | 可空 | 本次实际采用者（规则型 / 四层链为空） |
| `adapter_version` | `text` | 可空 | 同上 |

`adapter_id` / `adapter_version` 存在的理由是**材料视图（M4）要显示「最近作业用了哪个适配器」**，而 `case_material_report` 属于第 3 组（N8），第 1 组不能依赖它；报告仍按 FR-058/060 冻结历史版本，两者分工是「最新运行 vs 历史快照」。

索引：

- `INDEX (project_id, material_id, queued_at DESC, id DESC)`——`材料视图` 的 `distinct on (path)` 取「最近作业」（`case-materials.ts:43-128`）走这条，避免 5,000 材料时每屏都排序全表。

`reason_code` CHECK（字面值见 `contracts/reason-code-contract.md`）：

```sql
CHECK (
  reason_code IS NULL
  OR reason_code = '未识别:无匹配适配器'
  OR reason_code LIKE '未识别:缺必需列:%'
  OR reason_code LIKE '未识别:值闸不过:%'
  OR reason_code IN ('失败:读文件','失败:转换器异常','失败:入库异常')
)
```

> `<列名>` / `<检查项>` 的取值由写入侧保证（词表与检查项来自 `adapter.json`）；迁移只钉前缀与固定值，见 `contracts/reason-code-contract.md`。

`progress` 形状：

```json
{ "阶段": "读表|探测|转换|写入|富化", "已处理": 1200, "总数": 5000, "更新时间": 1730000000 }
```

写入时机：阶段切换必写；批处理时每批写一次（批大小由实现定，不承诺逐行）。`dryRun` 不写。

---

## 4. `auth.case_material_report`（新，迁移 `0049`；`0050` 补两列）

| 列 | 类型 | 约束 |
|---|---|---|
| `project_id` | `text` | NOT NULL |
| `id` | `text` | NOT NULL（报告 id） |
| `job_id` | `text` | NOT NULL |
| `material_id` | `text` | NOT NULL |
| `adapter_id` | `text` | 可空（规则型 / 四层链可为空） |
| `adapter_version` | `text` | 可空 |
| `rule_version` | `text` | 可空 |
| `matches` | `jsonb` | NOT NULL DEFAULT '[]'（全部表头闸命中项 `{id,version,priority}`，按 `priority desc, id asc`，含落选者；迁移 `0050`） |
| `converted_rows` | `integer` | NOT NULL DEFAULT 0（本次实际写入的事实行数；迁移 `0050`） |
| `source_sha256` | `text` | NOT NULL |
| `gates` | `jsonb` | NOT NULL（逐项：分母 / 命中 / 通过率 / 阈值） |
| `warnings` | `jsonb` | NOT NULL DEFAULT '[]' |
| `skipped_rows` | `jsonb` | NOT NULL DEFAULT '[]' |
| `enrich` | `jsonb` | 可空（补全数 / 未补全数 / 参考库版本） |
| `admission` | `jsonb` | 可空（N8 结论：`{"结论":"准入|旁路","依据":[…]}`） |
| `created_at` | `integer` | NOT NULL |

约束与索引：

- `PRIMARY KEY (project_id, id)`；`UNIQUE (project_id, job_id)`（一次作业一份报告）。
- `INDEX (project_id, material_id, created_at DESC)`——界面与 N8 都按「最新一份」读。
- 外键：`material_id` 指向 `(project_id, id)` of `case_material`（同一 schema 复合外键），`ON DELETE CASCADE`；`job_id` 指向 `case_ingest_job (project_id, id)`，`ON DELETE CASCADE`。
- **append-only**：重跑新增一行，不删历史（FR-060）。
- **阅读者分离**：材料列表读 `case_ingest_job` 的 `adapter_id` / `adapter_version`（最新运行），本表只服务「报告」出口与 N8 准入（历史快照）；不要为了 M4 让第 1 组等第 3 组的表。

`gates` 形状（两道闸逐项）：

```json
[{ "闸": "表头", "检查项": "requiredHeaders", "分母": 7, "命中": 7, "通过率": 1, "阈值": 1 },
 { "闸": "值", "检查项": "时间可解析", "分母": 5000, "命中": 4987, "通过率": 0.9974, "阈值": 0.99 }]
```

> 坏行跳过率**不设阈值**（§14 补充裁定）：坏行计入 `skipped_rows` + `warnings`，不因比例把整份材料判失败。

---

## 5. `auth.case_source_profile`（改：+4 列，迁移 `0046`）

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `optional_headers` | `jsonb` | NOT NULL DEFAULT '[]' | 只进报告与建档提示；**不参与命中判定** |
| `priority` | `integer` | NOT NULL DEFAULT 100 | 多档案同分时降序决胜 |
| `rule_version` | `text` | 可空 | 写入报告（FR-058） |
| `hints` | `jsonb` | 可空 | 建档辅助提示 |

匹配规则不变（`case-source-profile.ts:46-119`）：表头集合全含才命中、列序无关、缺列不命中、前两名同分不猜；本 feature 只追加「同分按 `priority` → `id`」的确定性决胜，避免「谁先读谁赢」。**`optional_headers` 不参与命中判定**（FR-065 要求 MUST NOT 改变表头集合匹配规则）。

**不写格式缓存（二轮复核修正）**：本表不改 `case_table_format` 的写入行为。`setMaterialFormatFingerprints` 现状对**所有工作表**无条件写（`case-ingest.ts:781-791`），档案分支跳过的只是 `case_table_format`（`:548`）；「只被档案命中的材料无法再建档」那个问题已由 commit `92c8e1252a`（2026-11-15）在 `case-source-profile-store.ts:248-270` 用「回落到命中档案」修掉。若反过来在档案命中时写 `case_table_format`，档案撤销后不再命中时，缓存行就是唯一来源（解析顺序：档案 → 缓存 → 四层 / 模型，`case-ingest.ts:453-477`），等于用撤销的映射继续解析，违反 FR-059 一族。

发布校验（M10 的 A 类分支）：`mapping` 的键为表头原文、值为字段目录内识别字段；`requiredHeaders`（字段集合）非空；`type` ∈ `('资金','话单','其他')`。任一不成立拒绝并列出问题项。校验追加在 `case-source-profile-store.ts` 既有建档写入路径上，出口形状不变。

---

## 6. `auth.project_case_ingest_settings`（新，迁移 `0047`）

| 列 | 类型 | 约束 |
|---|---|---|
| `project_id` | `text` | PRIMARY KEY |
| `auto_enqueue` | `boolean` | NOT NULL DEFAULT true |
| `auto_enable_trusted` | `boolean` | NOT NULL DEFAULT false |
| `updated_by` | `text` | 可空（FK `auth.user(id)` ON DELETE SET NULL） |
| `updated_at` | `integer` | NOT NULL |

规则：

- 行缺失 = 取默认（自动入队开、自动启用可信技能关）。
- 写入要求项目属主；变更一律 `记治理`（谁、何时、改成了什么 → `detail`）。
- 开关在**服务端执行路径**读取：入队前读 `auto_enqueue`；自动启用技能前读 `auto_enable_trusted` 并查白名单。

---

## 7. `auth.trusted_skill`（新，迁移 `0048`）

| 列 | 类型 | 约束 |
|---|---|---|
| `asset_id` | `text` | PK；FK `auth.asset(id)` ON DELETE CASCADE |
| `added_by` | `text` | NOT NULL；FK `auth.user(id)` ON DELETE CASCADE |
| `added_at` | `integer` | NOT NULL |

规则：

- **平台级**，无 `project_id`；维护要求 `user.is_admin`（服务端判）。
- 只白名单**已发布**技能：写入时校验 `asset.type='skill' AND asset.status='published'`；资产退回草稿 / 下线时，启用前再判一次（防止白名单里的旧条目绕过）。
- 变更走 `记治理` 留痕。

---

## 8. 适配器包（文件系统实体，无新表）

位置：`<项目目录>/.opencode/skill/<assetId>/`（`project-skill-link.ts` 的链接投影；目录口径 = `作业项目目录`，`case-ingest.ts:313`）。

四件套（FR-015）：

```text
<assetId>/
├── SKILL.md          # description 只写「什么时候用」（发布评审项）
├── adapter.json      # 识别卡（schema 见 contracts/adapter-json-contract.md）
├── convert.ts        # kind=converter 的入口；kind=rowRules 可为薄封装或不提供
└── test/             # 金标准：原件 + 期望 rows + 变异样本
```

注册表缓存键：目录签名 = `(adapter.json 的 realpath, mtime, size, 所在目录的 realpath)`；签名变化即重扫。**不改** `packages/opencode/src/skill/index.ts`（上游文件）。

识别卡摘要字段（完整 schema 见契约）：`id` / `name` / `version` / `kind`(`rowRules`|`converter`) / `materialType` / `attributeKeys` / `match.{requiredHeaders,optionalHeaders,priority}` / `admission.{checks,thresholds}` / `rowRules` / `entry.{command,input,output}` / `output.file`。

---

## 9. 状态与原因码

### 状态机（不变）

`未入队 → 排队中 → 解析中 → 已解析 | 有问题`；`已跳过` 由人工从非解析中状态置入（`case-status.ts:13-31` 的 7 动作）。**本 feature 不新增第七态**，探测结论走 `probe` 列，不走状态机。

### 原因码（六值闭集）

| 原因码 | 触发 | 写入 |
|---|---|---|
| `未识别:无匹配适配器` | 注册表零命中且四层 / 档案也无结论 | 作业失败路径 + `probe` |
| `未识别:缺必需列:<列名>` | 适配器 `requiredHeaders` 缺列（单列时精确给出列名；多列时取第一个缺失列） | 作业失败路径 |
| `未识别:值闸不过:<检查项>` | `admission.thresholds` 未过 | 作业失败路径 |
| `失败:读文件` | 读盘 / 读表抛错 | 作业失败路径 |
| `失败:转换器异常` | 子进程非零退出 / 超时 / 输出不合契约 | 作业失败路径 |
| `失败:入库异常` | 事实行写入失败 | 作业失败路径 |

规则（FR-036/037）：原因码只覆盖**入过队**的材料；「未入队」不伪造原因码；自由文本 `reason` 与作业 `error` 保留。

---

## 10. 富化键分类表（受控，代码常量）

| 键（叶子词） | 类别 | 查不到时 |
|---|---|---|
| 开户行 | 参考类 | 留空 + 告警，不阻塞入库 |
| 卡种 / 卡行 | 参考类 | 同上 |
| 号码归属地 | 参考类 | 同上 |
| 行号 | 参考类 | 同上 |
| 证件号 | 身份类 | 进「待确认」，不猜、不写空值 |
| 户名 | 身份类（别名通道，非属性） | 进「待确认」 |
| 实名核验结论 | 身份类 | 进「待确认」 |
| 案件库的账号 / 人名 / 组织名 | 匹配类 | 记「未匹配」；不告警、不进待确认 |
| **未登记的任何键** | **身份类（fail-closed）** | 同身份类 |

> 分类依据是**键的语义**，与数据源无关（spec FR-052 / Clarifications Q5）。表未登记的新键在发布期就不会出现（`attributeKeys` 须在词表内），运行期出现的词表外键按身份类兜底并告警。

---

## 11. 派生数据清理 / 保留登记（M7 义务）

| 派生存储 | 归属键 | 重跑时 | 清理 / 保留策略 |
|---|---|---|---|
| 属性观察（`attrs`） | 出处 `材料#表#行` | 由既有「按出处剥离 attrs」清后重写 | **已有**（`case-translate-store.ts:70-145`） |
| 别名 | `material_id` | 既有「按材料撤销别名」 | **已有** |
| 参与者 / 引用 / 旧对 | `material_id` / 出处 | 既有清理出口 | **已有** |
| 富化缓存 / 负缓存 | 无（按键） | 不增长（按键 upsert） | 进程内存，重启即失；**非派生数据** |
| 开关留痕（审计） | 无（人操作） | 重跑不触碰 | 审计表按治理策略保留；**非派生数据** |
| 材料报告 | `material_id` | 每次作业新增一行 | **执行历史**，按 FR-060 保留；随材料级联删除 |

判据：重跑不叠加的是「可重算的派生数据」（属性 / 别名 / 参与者）；报告与审计是「执行记录」，每跑一行是预期行为（SC-007 口径只覆盖前者）。

---

## 12. 权限矩阵（服务端判定）

| 动作 | 成员 | 项目属主 | 平台管理员（`is_admin`） |
|---|---|---|---|
| 拖入（自动入队） | ✅ | ✅ | ✅ |
| 查看材料 / 报告 / 进度 | ✅ | ✅ | ✅ |
| 触发重跑（批量出口） | ✅（既有 `case-parse` 口径：成员可入队） | ✅ | ✅ |
| 启用 / 停用技能 | ❌ 403（既有裁定） | ✅ | ✅（若为属主） |
| 建档 / 撤销数据源档案 | ✅（沿用既有三出口权限） | ✅ | ✅ |
| 切换项目开关（自动入队 / 可信技能） | ❌ 403 | ✅ | ✅（若为属主） |
| 维护可信技能白名单 | ❌ 403 | ❌ 403 | ✅ |

> 前端置灰只省一次往返，**不是权限**（`project-assets.ts:886-892` 的既有注释同口径）。
