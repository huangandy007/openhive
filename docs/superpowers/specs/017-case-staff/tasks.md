# Tasks: 专案内勤（案件工作区初始化 + 材料归档 + 内勤协同）

**Input**: `docs/superpowers/specs/017-case-staff/`（plan.md / spec.md / research.md / data-model.md / contracts/ / quickstart.md）

**Prerequisites**: plan.md ✅、spec.md ✅（7 个 User Story）、data-model.md ✅、contracts/ ✅（2 份）、research.md ✅

**Tests**: 本项目强制 TDD——**每个任务内部先红 → 改到绿 → 变异验证**（`#003-03` / `#005-37`），
不单独立「写测试」任务（与 `016` 的拆法一致）。每条任务的「判据」是**可跑的断言**，不是描述；
「变异」是 `TR-008` 的成对拆法：拆掉实现里那一处，指定用例必须红，并据实记录红在哪一句。

**Organization**: 18 个任务，按 `TR-014` 的依赖顺序（初始化 → 校验 → 联动 → 看板 → 镜像）；
平台适配与真栈插在「看板」与「镜像」之间；US3/US4 是不依赖四个脚本链路的工作流文档，插在看板之后。
任务编号即提交顺序，**一次提交只做一条**。

## Global Constraints（每个任务都适用）

1. **Python**：只用 `python` / `python3` + 标准库；不联网；不读凭据；不写项目根以外。
   用例命令：`cd <repo> && timeout 300 python -I -m unittest discover -s skills/case-staff/scripts/tests -t skills/case-staff -v`。
   兼容 3.8+；输出路径一律项目相对、分隔符 `/`；`--json` 时 stdout **只**有一个 JSON 对象（日志走 stderr）。
2. **TypeScript**：`cd packages/opencode && timeout 300 bun test test/server/<file>.test.ts`。
   **禁止**从仓库根跑 `bun test`（`#004-10`）；退出码 124 = 被杀，先查同步死循环，**不自动重跑**（`#009-01`）。
3. **门禁**：每个任务收尾跑受影响 package 的 `bun run typecheck` + 本任务用例 + 仓库根 `bun run lint`；
   `bun install` 后必须 `git diff --stat bun.lock` 为空（镜像污染）。报告只写实际命令与输出。
4. **测试纪律**：目录/文件/行集合用**精确集合**比对（`#006-22`）；「元素不存在」用布尔比较（`#013-12`）；
   自由文本只断言结构化字段，不断言措辞（`TR-011`）；验不了的写缺口表，**不写成已覆盖**（`TR-013` / `#004-03`）。
5. **内容边界**：不内置任何法律法规、司法解释、判例；`时限参考.md` 只写程序性节点；
   `法律适用/` **不预建**子目录；技能资产只放仓库根 `skills/case-staff/`。
6. **平台改动面**：`move_material` 只加「`工具名` 数组 + `TOOLS` 条目 + `分发表` 条目 + 一个实现函数」；
   **不改** `file.ts` / `case-store.ts` 语义，**不入** `写工具名`，不把归档冻结扩到其他工具；
   `packages/opencode/Dockerfile` 只在镜像任务里改一行，且**单独提交**。
7. **真栈**：必须用 `REAL_STACK_STATE_DIR` 指向独立目录；跑真栈 spec 会拆栈；
   **不与并行会话共用**状态目录或端口。
8. 本清单不改变「实现前须用户批准」的门槛；未获批不写实现代码。

---

## Phase 1: Setup（技能包骨架与共用件）

**Purpose**: 三块互不依赖的资产——路由文档、模板、脚本共用件。三者可并行。

- [ ] T001 [P] 技能包骨架与规则文件：`skills/case-staff/SKILL.md`（frontmatter `name: 专案内勤` / `description` 非空、两个入口路由「建一个案件工作区」「记录今日动态」、无脚本步骤索引）＋ `skills/case-staff/references/` 9 份（初始化 / 内勤工作流 / 证据规则 / 研判规则 / 命名与编号 / 阶段检查表 / 时限参考 / 法律适用规范 / 专案协同规则），每份含 data-model 要求的固定小节；`内勤工作流.md` 本任务只立骨架（入账与原始记录两节由 T009/T010 顺序填充，**同文件不得并行**）。**入参**：设计 §4–§13 + data-model §4/§7/§9 → **出参**：1 份 SKILL.md + 9 份 references（UTF-8）。**判据**：`skills/case-staff/scripts/tests/test_package.py`（新）断言 frontmatter 两键、references **精确集合 9 份**、每份标题含约定小节。**变异**：删 `description` ⇒ frontmatter 用例红。

- [ ] T002 [P] 29 份模板：`skills/case-staff/assets/*.template.md`（22 份初始化模板 + 7 份按需，清单见 data-model §1）。**入参**：设计 §7 模板规格 + data-model §1 → **出参**：29 份模板文件。**判据**：`scripts/tests/test_templates.py`（新）断言文件名**精确集合 29 份**，且关键小节存在——四段式日报、溯源块九项、抓捕对象清单 12 列、D 表 9 列、阶段看板 8 列（`TR-012`）。**变异**：删四段式日报的一段 ⇒ 该模板用例红。

- [ ] T003 [P] 脚本共用件：`skills/case-staff/scripts/lib/`——`tables.py`（表头 + 分隔行 + 数据行，表头必须与 data-model 一致，不一致报错不猜列序）、`ids.py`（`next_id(prefix, text)` 取 max+1；调用方写入前**重读**再取一次）、`blocks.py`（只认 `<!-- AUTO:BEGIN <名> -->` / `AUTO:END`，解析失败抛 `BlockError`）、`fingerprint.py`（`source_digest(rows)` 按 data-model §5.2 规范化后取 `sha256` 前 16 位）、`constants.py`（data-model §9 状态字面量总表，模板与校验器共用的唯一一份）、`__init__.py`。**入参**：Markdown 文本 / 行列表 → **出参**：行字典列表 / 新编号 / 块对 / 16 位十六进制串。**判据**：`scripts/tests/test_lib.py`（新）——max+1 连续；**写前重读**（先取号 → 外部追加一行 → 重读再取，得到新号，`TR-008` 第二对）；表头不符报错；块不配对抛 `BlockError`；同一行集指纹稳定、顺序无关；`scripts/tests/test_constants.py`（新）与 29 份模板实际字面量逐项比对（data-model §9）。**变异**：去掉「重读」只取一次 max+1 ⇒ 撞号用例红。

**Checkpoint**: 技能包可被 loader 读到、模板齐全、四个脚本有同一份共用件。

---

## Phase 2: US1 - 一句话把案件工作区建好（P1）

**Goal**: 幂等、非覆盖、可预演的初始化；精确产出 39 目录 / 22 文件 / 27 `.gitkeep`。

**Independent Test**: 空目录跑两次 ⇒ 第二次 `created_*` 全空、内容哈希不变；`--dry-run` 零写入；
含无关文件的项目被拒；symlink 越界被拒。

- [ ] T004 [US1] `skills/case-staff/scripts/init_case.py` 实现 + `scripts/tests/test_init_case.py` + `scripts/tests/fixtures/` 夹具：参数 `--root` / `--case-name` / `--case-no` / `--dry-run` / `--json`（契约 §1）；预检五条（可写、无关文件、已是工作区、非法字符/保留字、symlink 越界），失败退出码 1 且**磁盘零改动**；成功退出码 0，`created_directories` / `created_files` / `kept_files` 为项目相对路径且字典序。**入参**：项目根 → **出参**：契约 §1 的 JSON + 精确集合（39 / 22 / 27，data-model §1）。**判据**：`TR-002` 六项全绿（幂等、非覆盖、dry-run、无关文件、非法目录名、symlink 越界）＋三个上传依赖结构存在（`材料/00-待归档/`、`材料/00-材料登记表.md`、`专案协同/00-原始记录/`）＋ `TR-003` 精确集合。**变异**：`--dry-run` 仍写盘 ⇒ 零写入用例红；接受无关文件 ⇒ 拒绝用例红。

**Checkpoint**: 空项目一条命令建好工作区；重复执行无副作用。

---

## Phase 3: US6 - 校验缺口（P3，按 `TR-014` 提前）

**Goal**: FR-080 九类检查 + 反向豁免 + `--strict`，输出稳定 code 枚举。

**Independent Test**: 每类问题各一条夹具 ⇒ 对应 code；反向两条不误报；`--strict` 下警告退出码 1。

- [ ] T005 [US6] `skills/case-staff/scripts/validate_case.py` 核心检查 + `scripts/tests/test_validate_core.py`：引用（`E` / `A` / `L` / `T` 均存在）、编号（同前缀唯一、文件名与索引一致）、E、A、L/V/T、D、M（登记表路径在盘上；`材料/` 下每份文件有 M 行）、阶段（五态、阶段行齐全）。输出契约 §2 的 `{ok, errors, warnings, counts}`；有错误退出码 2，干净退出码 0。**入参**：`--root` / `--json` → **出参**：上述 JSON。**判据**：每类各一条夹具红转绿；**反向**：登记表自身与 `.gitkeep` 不报缺行。**变异**：去掉「E→M 存在」检查 ⇒ 该夹具漏报红。

- [ ] T006 [US6] `skills/case-staff/scripts/validate_case.py` 规则类检查 + `scripts/tests/test_validate_rules.py`：命名（§4.1 正则、禁用词、目录白名单，外部来件豁免）、积压（`00-待归档/`、`待归类`、原始记录缺「已整理」）、逾期（`T_OVERDUE`：`待办`/`进行中` 且期限早于当天）、跨文档矛盾（`X_CONFLICT`：P 姓名/角色、阶段看板↔阶段行；汇总数字差异为警告）、`--strict`（警告计为失败、退出码 1）。**入参**：`--root` / `--json` / `--strict` → **出参**：契约 §2 JSON（code 稳定枚举）。**判据**：`TR-004` 剩余检查全覆盖 + 反向两条（登记表/占位文件、外部来件命名）；`--strict` 下警告退出码 1。**变异**：取消外部来件命名豁免 ⇒ 合法上传件被判非法名（`TR-008` 第三对）红。

**Checkpoint**: `validate_case.py` 可独立跑出错误/警告清单。

---

## Phase 4: US5 - 改一处，相关文档跟着走（P2）

**Goal**: 源版本指纹 → 影响清单 + diff → 只改托管块；法律文书只出建议。

**Independent Test**: 改 P001 角色 ⇒ `--dry-run` 出 affected/diff 且零写盘；`--apply` 只改块内；
法律文书原文不变；发放版原文不变 + 变更日志一条。

- [ ] T007 [US5] `skills/case-staff/scripts/sync_docs.py` + `scripts/tests/test_sync_docs.py` + 夹具：
  `--root` / `--dry-run`（与 `--apply` 二选一）/ `--doc` / `--source` / `--json`；行为六条（读文书登记表、
  指纹未变跳过、非法律文档只换块内、法律文书只出`建议`+`待法制审核`、已签发/发放版只追加
  `变更日志.md`、块异常报错不半写）。**入参**：项目根 → **出参**：契约 §3 的 JSON + 退出码
  （dry-run 有待确认 1 / apply 成功 0 / errors 2）。**判据**：`TR-005` 七项全绿（diff、dry-run 零写入、
  仅托管块变化、块外保留、法律文书原文不变、发放版原文不变、变更日志追加）。**变异**：法律文书也改托管块
  ⇒「文书原文不变」红（`TR-008` 第四对）。

**Checkpoint**: 角色改动能算出影响面并安全应用。

---

## Phase 5: US6 - 指挥员看一页（P3）

**Goal**: 六段协同台账，只读主数据。

**Independent Test**: 有积压与逾期时看板含对应项；运行前后除 `00-协同台账.md` 外所有文件哈希不变。

- [ ] T008 [US6] `skills/case-staff/scripts/digest.py` + `scripts/tests/test_digest.py`：
  `--root` / `--date` / `--open` / `--json`；整文件重生 `专案协同/00-协同台账.md`，
  六段固定（新增线索 / 待办与逾期任务 / 待决策 / 风险 / 收网准备度 / 待归档与待归类积压）；
  读取失败或块解析失败退出码 2、不写半份。**入参**：项目根 + 基准日 → **出参**：契约 §4 JSON + 看板文件。
  **判据**：`TR-006`——输出含积压与逾期项；运行前后**主数据文件哈希精确不变**（只读性）。**变异**：
  运行中顺手写回 `案件信息.md` ⇒ 哈希不变用例红。

**Checkpoint**: 四个脚本全部可单独运行，`TR-014` 的四步链闭环。

---

## Phase 6: US3 - 说一段话，剩下的 AI 入账（P1）

**Goal**: 固定话术 → E/L/T 结构化入账；未确认前零改动；推断只进线索。

**Independent Test**: 固定话术夹具回读后，台账新增行的编号、类型、字段与期望 JSON 逐字段相等。

- [ ] T009 [US3] 入账工作流：补 `references/内勤工作流.md` 的「口述入账」节（扫收件箱分 M、
  口述拆 E/L/T、编号用 `next_id` 且在写入前重读、推断与事实分开、确认前不动台账）+
  `scripts/tests/test_intake.py` + `scripts/tests/fixtures/intake/`：夹具项目 + 固定话术期望结构
  （JSON：`类型` / `编号` / `字段`）。**入参**：固定话术夹具 + 空台账夹具 → **出参**：期望结构 JSON + 回读断言。
  **判据**：`tables.py` 回读的行与期望 JSON **逐字段相等**（`TR-011` 只断言结构）；编号连续；
  未确认路径下台账哈希不变（用夹具模拟「未确认」态）。**变异**：编号改为页面上手填（不重读）
  ⇒ 与 T003 的撞号用例成对红；参考资料删除「推断不进事实」约束 ⇒ 夹具中推断行被写成 E ⇒ 红。

**Checkpoint**: AI 能按固定规则把一段话落成台账行，形状可验证。

---

## Phase 7: US4 - 原始记录整理分流（P2）

**Goal**: 会议/碰头记录整理成 E/L/T 分流，并打「已整理」标记。

**Independent Test**: 原始记录 fixture 整理后，标记存在、分流行结构正确、`validate_case.py` 不报积压。

- [ ] T010 [US4] 原始记录工作流：补 `references/内勤工作流.md` 的「原始记录整理」节（保留原文、
  只追加分流结果、顶部写「已整理」标记、外部来件不改写）+ `scripts/tests/test_raw_notes.py` + 夹具。
  **入参**：原始记录 fixture → **出参**：分流后的台账行 + 标记。**判据**：整理后
  `validate_case.py` 不报「原始记录缺已整理」；分流 E/L/T 行字段与期望 JSON 相等；原文内容不变。
  **变异**：去掉「已整理」标记 ⇒ T006 的积压用例红（同一判据两处引用，`#002-06`）。

**Checkpoint**: US3/US4 两条内勤工作流都可按固定夹具验收。

---

## Phase 8: 平台前置 - 技能发现

**Goal**: 技能包放进项目 `.opencode/skill/` 后能被 loader 识别。

- [ ] T011 `packages/opencode/test/server/openhive-case-staff-skill.test.ts`（新）：把
  `skills/case-staff` 复制到临时项目的 `.opencode/skill/case-staff`，调用既有 loader，
  断言 `name = 专案内勤`、`description` 非空。**入参**：临时项目 + 技能包副本 → **出参**：loader 结果。
  **判据**：用例绿；不新增 loader 代码（只测既有能力）。**变异**：删 frontmatter `name` ⇒ 用例红。

**Checkpoint**: 技能可被发现，不需要平台新增加载逻辑。

---

## Phase 9: US2 - 说一句「归档」（P1）

**Goal**: `move_material` 把「归档 = 移动」暴露给 AI，移动后材料路径同步。

**Independent Test**: 属主移动 `材料/00-待归档/a.txt` → `材料/01-接报案` ⇒ 盘上移动 +
`case_material.path` 变成新相对路径；归档项目被拒。

- [ ] T012 [US2] 先写红：`packages/opencode/test/server/openhive-case-mcp-move.test.ts`（新）覆盖契约 §6
  用例 **1–14**（成功移动、路径同步、同名冲突、非 `材料/`、目标不存在、登记表、非成员、归档、
  链接逃逸、库迁移失败、未知键、留痕、目录源、符号链接源）+「按属主拼」工具层探针。
  **入参**：测试夹具（真库 + 临时项目目录）→ **出参**：14 条用例 + 1 条探针。**判据**：工具未实现时
  全部红，按 `#003-03` 记录红成哪一类（编译失败 / 断言失败 / 超时）；**不**为通过而放宽断言。
  **变异**：本任务不适用（测试先行）。

- [ ] T013 [US2] 注册与归档冻结：`packages/opencode/src/server/openhive/case-mcp-server.ts` 加 `工具名`、`TOOLS` 的 `inputSchema`、
  `分发表` 条目（三处，缺 `TOOLS` 会折成 `tool_failed`）；`packages/opencode/src/server/openhive/case-mcp-tools.ts` 加 `move_material` 骨架 +
  归档冻结（`archiveStatesOf` → `ProjectMembership.frozen`，无行 = 未归档），落在**任何文件系统访问之前**；
  留一行「不入 `写工具名`」的理由注释。**入参**：`(ctx, args)` → **出参**：`forbidden` / `bad_input` / 后续执行。
  **判据**：用例 7 / 8 / 11 / 12 绿；未知键回 `bad_input("不认识的参数：…")`。**变异**：拆掉冻结 ⇒ 用例 8 红。

- [ ] T014 [US2] 守卫与迁移（`packages/opencode/src/server/openhive/case-mcp-tools.ts`）：项目根**恒按属主**拼（`项目属主` + `projectDirectory`；`workspaceRoot` 缺省
  fail-closed）；`inside` + `realInside`（`await Effect.runPromise(...)`）+ `inGitOf`；源必须是 `材料/` 下
  **普通文件**（`lstat` 不跟链接）；目标目录必须存在；同名拒；`rename`；成功后
  `迁移材料路径(..., 作业目录: \`${属主}/${projectId}\`)`，失败不回滚、写 `缺口`。**入参**：`{路径, 目标目录}`
  → **出参**：契约 §4 七字段信封 + `数据[0].材料路径已同步`。**判据**：用例 1–6 / 9 / 10 / 13 / 14 与
  「按属主拼」探针绿。**变异**：移动后不调 `迁移材料路径` ⇒ 用例 2 / 10 红（`TR-008` 第一对）。

- [ ] T015 [US2] 真栈：`packages/app/e2e/real-stack/case-staff-move-real.spec.ts`（新）——从监督器写入的
  全局配置读 `openhive-case` 的 MCP URL，带 `_meta` 发一次 `tools/call`，断言盘上路径与
  `auth.case_material.path` **同时**变化（不依赖模型）。**入参**：真栈（独立 `REAL_STACK_STATE_DIR`）
  → **出参**：Playwright 报告 + 两条断言的实际值。**判据**：`TR-007`——真栈通过；**不用**单测/替身冒充。
  **变异**：本任务不适用（真栈是结论层）。

**Checkpoint**: 会话内可以「归档」；平台侧路径同步有真栈证据。

---

## Phase 10: 镜像（单独提交）

- [ ] T016 `packages/opencode/Dockerfile` base 阶段 `apk add ... python3`（单行）。**入参**：Dockerfile
  → **出参**：含 `python3` 的镜像。**判据**：`docker build -f packages/opencode/Dockerfile -t openhive:017-check .`
  成功，`docker run --rm openhive:017-check python3 -V` 成功；**记录**镜像体积前后差值（只记录，不承诺阈值）。
  **变异**：本任务不适用。**提交约束**：单独提交，不与本特性其他改动混合（`TR-014`）。

**Checkpoint**: 生产镜像具备解释器；无解释器兜底仍保留（T017）。

---

## Phase 11: US7 - 没有解释器也照样建卷（P3）

- [ ] T017 [US7] 无解释器演练（`TR-010`）：按 `SKILL.md` 的无脚本步骤，在**干净 shell**
  （`python` / `python3` 从 `PATH` 隐去）里对空项目建工作区；再用 `init_case.py` 对另一个空项目跑一次；
  导出两份集合（目录 / 文件 / `.gitkeep`）逐项比对。**入参**：空项目 ×2 → **出参**：演练记录
  （命令、环境、集合比对结果），进任务汇报。**判据**：两份集合**逐项相等**；不写成「自动化已覆盖」。
  **变异**：本任务不适用（人工演练，`TR-010` 允许）。

**Checkpoint**: 无解释器路径有可复核的执行记录。

---

## Phase 12: Polish - 门禁与全量验收

- [ ] T018 门禁与 quickstart：仓库根 `timeout 600 bun run typecheck`、`bun run lint`；受影响包逐文件
  `timeout 300 bun test …`（move / file-ops / skill 三条）；Python 套件全量；按
  [quickstart.md](./quickstart.md) §4 走一遍手工验收；把验不了的（真实会话解析质量、生产镜像内解释器探测、
  非属主成员经网关恒 `identity_required`）写进缺口表。**入参**：全分支 → **出参**：命令原样输出 + 缺口表。
  **判据**：退出码全 0（或按预期：dry-run 有待确认 = 1）；退出码 124 不重跑；缺口表逐条对应
  `TR-013` / `#004-03`。**变异**：本任务不适用。

---

## Dependencies & Execution Order

### Critical path

```text
T001 ─ T011
T002 ─┐
T003 ─┴─ T004(US1) ─ T005 ─ T006 ─ T007 ─ T008   （TR-014 四步链，前一步未绿不得开始下一步）
                     T009 ─ T010                  （同一份 references 文件，顺序做）
                     T012 ─ T013 ─ T014 ─ T015    （move：红 → 注册/冻结 → 守卫/迁移 → 真栈）
                     T016（镜像，单独提交）
                     T017（无解释器演练，依赖 T001 + T004）
                     T018（门禁，依赖以上全部）
```

- **T003 必须先于 T004–T010**：四个脚本共用 `tables/ids/blocks/fingerprint`。
- **T005 必须先于 T006**：同一文件 `validate_case.py` 顺序追加，不得并行。
- **T006 必须先于 T008**：看板的积压/逾期口径复用校验的同一判据（`#002-06`）。
- **T004 必须先于 T017**：兜底演练要与脚本产出集合比对。
- **T012 必须先于 T013/T014**：红态先立。
- **T014 必须先于 T015**：真栈验证真实工具。
- **T016 在 T008 之后、T015 之后**：`TR-014` 的镜像位置 + 平台适配先落地。

### Parallel Opportunities

- `T001` / `T002` / `T003` 三者不同目录，可并行（[P]）。
- `T009` 与 `T012` 之间无文件依赖，可由不同人并行；但 `T009`/`T010` 同文件、`T012`–`T014` 同文件，
  组内不得并行。
- `T011` 只读技能包，可在 `T001` 绿后任何时候做。

### 不可并行清单（同一文件/同一判据）

| 文件 | 任务 |
|---|---|
| `references/内勤工作流.md` | T001（骨架）→ T009 → T010 |
| `scripts/validate_case.py` | T005 → T006 |
| `case-mcp-server.ts` / `case-mcp-tools.ts` | T013 → T014 |
| `scripts/lib/*` | T003（之后只读） |

### MVP 口径

最小可交付 = **T001–T004**（技能包 + 初始化）＋ **T011**（可被发现）：
用户能说「建一个案件工作区」并得到精确产物；其余故事按 `TR-014` 顺序增量接入。

## Notes

- 每条任务的「变异」就是 `#003-03` 的第四步；报告里写「拆哪一行 → 红哪一条 → 红在哪一句」。
- 任务编号即提交顺序；一次提交只做一条；提交信息写命中的 LEARNINGS 条目号
  （`#002-06` / `#003-03` / `#004-03` / `#005-37` / `#006-22` / `#013-12`）。
- 本文件自身不产生代码改动；实现开始前按 HARD-GATE 等用户批准。
