# 契约 · 技能脚本 CLI（017-case-staff）

四个脚本位于技能包 `scripts/`，由 AI 通过 skill 工具输出的
`Base directory for this skill: <abs>` 定位后执行。**全部**遵守：

- Python 3 标准库；不联网；不读环境变量中的凭据；不写项目根以外的路径；
- 输入输出 UTF-8，输出中的路径一律**项目相对**、分隔符 `/`；
- `--json` 时**只**向 stdout 打一个 JSON 对象（日志走 stderr），供 AI 解析；
- 退出码：`0` 成功 / `1` 有待确认或预检拒绝 / `2` 错误（含内部异常）；
- 幂等：同一输入重复执行，结果与首次成功一致，且不产生第二份文件。

---

## 1. `init_case.py`

**用途**：建案件工作区（FR-001 ~ FR-011）。

| 参数 | 必填 | 说明 |
|---|---|---|
| `--root` | 否 | 项目根，默认当前目录；必须是已存在目录 |
| `--case-name` | 视情况 | 案件名称；已是案件工作区时可省（读 `案件信息.md`） |
| `--case-no` | 否 | 案号；可空 |
| `--dry-run` | 否 | 只预演：不写盘，只输出将创建 / 将保留 |
| `--json` | 否 | 机器可解析输出 |

**预检**（失败 ⇒ 退出码 1、零写入、`errors` 说明原因）：
1. 目标目录存在且可写；
2. 目录为空，或只含项目基础项（`.git/`、`.gitignore`、`.opencode/`、`opencode.json`，
   以及 `.git` 之外的隐藏配置文件不算「无关文件」需在实现时与用例对齐）；
3. 或已是案件工作区（以 `案件信息.md` + `AGENTS.md` 同时存在为标志）⇒ 幂等补建；
4. `--case-name` 中的非法字符、保留字（win32 `CON`/`PRN`/`AUX`/`NUL`/`COM1..9`/`LPT1..9`）；
5. 目标里不存在指向项目外的符号链接（发现即拒绝，FR/US1-6）。

**输出 JSON**：

```json
{
  "ok": true,
  "root": "<绝对路径>",
  "dry_run": false,
  "created_directories": ["材料", "材料/00-待归档"],
  "created_files": ["案件信息.md", "材料/00-材料登记表.md"],
  "kept_files": [],
  "warnings": [],
  "errors": []
}
```

- 失败：`ok=false`，`errors` 非空，退出码 1，**磁盘零改动**；
- 成功：退出码 0；`created_*` 与 `kept_files` 为**项目相对**路径，排序稳定（字典序）；
- 必须产物（FR-003）：`材料/00-待归档/`、`材料/00-材料登记表.md`、`专案协同/00-原始记录/`。

**不变量**：第二次运行 `created_directories == [] && created_files == []`，且既有文件内容哈希不变。

---

## 2. `validate_case.py`

**用途**：校验台账、命名、引用、积压、逾期、跨文档矛盾（FR-080 ~ FR-083）。

| 参数 | 必填 | 说明 |
|---|---|---|
| `--root` | 否 | 项目根，默认当前目录 |
| `--json` | 否 | 机器可解析输出 |
| `--strict` | 否 | 警告也算失败 |

**检查清单**：见 [data-model.md §7](../data-model.md)。实现须复用
`scripts/lib/` 的同一份常量与表格解析，禁止在脚本内另写一份状态字面量。

**输出 JSON**：

```json
{
  "ok": false,
  "errors": [
    {"file": "证据/证据索引.md", "line": 12, "code": "E_SOURCE_MISSING", "message": "E003 的来源 M099 不在材料登记表"}
  ],
  "warnings": [
    {"file": "材料/00-待归档/", "line": 0, "code": "M_PENDING", "message": "收件箱还有 2 份未归档"}
  ],
  "counts": {"errors": 1, "warnings": 1}
}
```

- `code` 为稳定枚举（`E_SOURCE_MISSING`、`A_REVIEWER_MISSING`、`PATH_MISMATCH`、
  `NAME_ILLEGAL`、`DUP_ID`、`T_OVERDUE`、`X_CONFLICT`、`M_PENDING`、`L_UNRESOLVED` 等），
  新增 code 必须同时进本文件与用例；
  核心检查（T005）另用：`FILE_MISSING`（核心台账缺失）、`TABLE_INVALID`（表格/表头解析失败）、
  `REF_MISSING`（通用引用缺失：正文 E/A/L/T、D 来源记录、T 来源、V 对应L/依据E）、
  `ID_MISMATCH`（文件名编号与台账行不一致）、`CHARGE_CLAIM`（结论含罪名认定）、
  `E_LEGAL_KIND_INVALID`、`E_FIELD_MISSING`、`A_STATUS_INVALID`、`A_CYCLE`、
  `V_RESULT_INVALID`、`T_STATUS_INVALID`、`D_REVIEWER_MISSING`、`M_UNREGISTERED`、
  `STAGE_INVALID`、`INTERNAL_ERROR`；
- 规则检查（T006）沿用上列 code：`NAME_ILLEGAL`（非法字符 / 禁用词 / 目录白名单，
  外部来件豁免）、`M_PENDING`（待归档收件箱、`待归类` 行、原始记录缺「已整理」，
  均为警告）、`T_OVERDUE`（`待办` / `进行中` 且期限早于当天，警告）、
  `X_CONFLICT`（P 姓名 / 角色冲突与汇总人数差异；身份字段为错误、汇总数字为警告）；
  抓捕对象清单中的 P 编号不在人员台账沿用 `REF_MISSING`；
- 退出码：有错误 → `2`；无错误但有警告且 `--strict` → `1`；否则 `0`。

**反向约束**（FR-082）：材料条目检查**排除** `00-材料登记表.md` 与 `.gitkeep`；
命名与禁用词检查**豁免** `材料/` 下原件与 `00-原始记录/` 的外部来件。

---

## 3. `sync_docs.py`

**用途**：台账变更 → 影响清单 + diff → 更新托管块；法律文书只出建议（FR-070 ~ FR-077）。

| 参数 | 必填 | 说明 |
|---|---|---|
| `--root` | 否 | 项目根 |
| `--dry-run` | 二选一 | 只算影响清单与 diff，不写盘 |
| `--apply` | 二选一 | 应用非法律文档的托管块更新 |
| `--doc` | 否 | 只处理某个 D 编号 |
| `--source` | 否 | 只处理某个源（如 `P001`） |
| `--json` | 否 | 机器可解析输出 |

**行为**：
1. 读 `文书/00-文书登记表.md`，逐个算源版本指纹（定义见 data-model §5.2）；
2. 指纹未变 ⇒ 跳过；变了 ⇒ 进「受影响」；
3. 非法律文档：生成托管块 diff；`--apply` 时只替换块内内容，块外一字不动；
4. 法律文书（`文书/报捕|起诉|内部审批/` 下或 D 表标为法律文书）：**只**输出
   `建议` + `待法制审核` 标记，任何模式下都不改原文；
5. 已签发 / 已发放 / `*-发放版.md`：不改原文，只在 `变更日志.md` 追加一条；
6. 块不配对 / 同名块重复 / 块嵌套 ⇒ 该文档报错、跳过，不半写。

**输出 JSON**：

```json
{
  "ok": true,
  "dry_run": true,
  "affected": [
    {"doc": "D003", "path": "专案协同/07-抓捕筹备/00-抓捕对象清单.md", "blocks": ["抓捕对象"], "diff": "@@ ...", "reason": ""}
  ],
  "suggestions": [
    {"doc": "D005", "path": "文书/起诉/起诉意见书草稿.md", "note": "待法制审核：P001 角色由 成员 改为 操盘手"}
  ],
  "changelog": ["D006 2026-11-27 发放版不变，变更记入变更日志"],
  "errors": []
}
```

- `affected` 条目：源版本变了就必须出现（`blocks`/`diff` 可为空）；块内不需要改时
  `diff` 为空串，`reason` 说明原因（如「文档没有托管块，源记录已更新」）。只有被报出的
  文档才推进 D 表「源版本（指纹）」。
- 退出码：`--dry-run` 且 `affected`/`suggestions` 非空 → `1`（有待确认）；`--apply` 成功 → `0`；
  有 `errors` → `2`；无变化 → `0`。`changelog` 只做留痕，不计入「有待确认」。
- 错误 `code`（`errors[].code`，稳定枚举；新增必须同时进本文件与用例）：
  `FILE_MISSING`（项目根 / D 表 / 变更日志 / 目标文书缺失）、
  `PATH_MISSING`（D 行路径为空）、`PATH_INVALID`（绝对路径、盘符、`..`、或 `realpath`
  越出项目根）、`TABLE_INVALID`（D 表 / 变更日志 / 源台账的表头或表格解析失败）、
  `SOURCE_UNKNOWN`（来源记录 token 不认识）、`SOURCE_ROW_MISSING`（点名的来源行不在对应台账）、
  `BLOCK_INVALID`（AUTO 块不配对 / 重名 / 嵌套，或块内表头不符）、
  `BLOCK_UNSUPPORTED`（块名不在 data-model §5.3 的来源映射内）、
  `DOC_NOT_FOUND`（`--doc` 指定的 D 编号不在登记表）、
  `INTERNAL_ERROR`（内部异常，统一转退出码 2）。

---

## 4. `digest.py`

**用途**：生成指挥员一页协同台账（FR-084；US6-7）。

| 参数 | 必填 | 说明 |
|---|---|---|
| `--root` | 否 | 项目根 |
| `--date` | 否 | 统计基准日，默认今天，`YYYY-MM-DD` |
| `--open` | 否 | 生成后尝试用系统默认程序打开（失败只警告） |
| `--json` | 否 | 机器可解析输出 |

**输出**：写 `专案协同/00-协同台账.md`（整文件重生，属派生视图），六段固定：
新增线索 / 待办与逾期任务 / 待决策 / 风险 / 收网准备度 / 待归档与待归类积压。

**只读约束**：运行前后，除 `00-协同台账.md` 外所有文件哈希不变（TR-006）；
不写任何台账、不在 `案件信息.md` 写回。

**输出 JSON**：

```json
{
  "ok": true,
  "path": "专案协同/00-协同台账.md",
  "date": "2026-11-27",
  "sections": {"新增线索": 2, "逾期任务": 1, "待决策": 3, "风险": 1, "收网准备度": "未开始", "积压": 4}
}
```

退出码：`0` 成功；`2` 读取失败或块解析失败（不写半份）。

---

## 5. 共用约定

- **表格解析**：`scripts/lib/tables.py` 读取「表头行 + 分隔行 + 数据行」，容忍单元格两侧空格；
  表头名称必须与 data-model 完全一致（不一致 = 校验错误，不猜测列序）。
- **编号分配**：`scripts/lib/ids.py` 的 `next_id(prefix, text)` 取 max+1；调用方在写入前
  **重读**文件再取一次（FR-042）。
- **托管块**：`scripts/lib/blocks.py` 只认 `<!-- AUTO:BEGIN <名> -->` / `<!-- AUTO:END <名> -->`；
  解析失败抛 `BlockError`，调用方转成退出码 2。
- **指纹**：`scripts/lib/fingerprint.py` 的 `source_digest(rows)` 按 data-model §5.2 规范化后取
  `sha256` 前 16 位。
- **测试**：每个脚本在 `scripts/tests/` 有独立用例文件，夹具项目在 `scripts/tests/fixtures/`；
  断言用精确集合与结构化字段，不断言自然语言措辞（TR-011）。
