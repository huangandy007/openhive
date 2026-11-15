# Tasks: 解析入库入口收敛与实体页签下架

**Input**: 设计文档来自 `docs/superpowers/specs/011-ingest-entry-entity-tab/`

**Prerequisites**: [plan.md](./plan.md)（必需）、[spec.md](./spec.md)（用户故事与 TDD 要求）、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/ui-contracts.md](./contracts/ui-contracts.md)、[quickstart.md](./quickstart.md)

**Tests**: 本 feature 的 spec 带**强制 TDD**（TR-001–TR-007），所以每个实现任务都先有会红的用例。

**Organization**: 按用户故事分阶段；每条任务单一职责、可单独验证，并写明**入参 / 出参**。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属用户故事（US1 / US2 / US3）
- 描述里带**确切文件路径**；任务下方缩进行是**入参 / 出参 / 依赖 / 验证**

## 命令约定（下文简称）

```bash
# S = 服务端单文件（在 packages/opencode 下）
S: timeout 300 bun test ./test/server/<文件>.test.ts
# A = app 组件/纯函数单文件（在 packages/app 下）
A: timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/<路径>.test.tsx
# T = 包内 typecheck（在对应包下）
T: timeout 300 bun run typecheck
# L = 仓库根 lint
L: cd <仓库根> && timeout 300 bun run lint
```

退出码 `124` 立即停，不自动重跑；禁止根目录 `bun test`。

---

## Phase 1: Setup

**Purpose**: 留基线，后面每条「红」都要和它对得上。

- [x] T001 记录改动前基线：跑四个既有测试文件并记下通过数（`packages/opencode/test/server/openhive-file-ops.test.ts`、`openhive-case-materials.test.ts`、`openhive-file-upload-ingest.test.ts`；`packages/app/src/project/file-tree.test.tsx`）

  > **实测基线（2026-11-15）**：file-ops 117 pass / 0 fail；case-materials 38 pass / 0 fail；file-upload-ingest 14 pass / 0 fail；file-tree 176 pass / 0 fail。

  - **入参**：无（只读）
  - **出参**：四条命令各自的「N pass / 0 fail」实数，记在实现笔记或提交信息里；任何一条本就不绿 ⇒ 停下，先报告，不动代码
  - **依赖**：无
  - **验证**：四条命令 EXIT=0

**Checkpoint**：基线可复现。

---

## Phase 2: Foundational

本 feature **无共享基础设施**：零新接口、零迁移、零新组件，所以没有阻断性前置任务。直接进入 US1。

---

## Phase 3: US1 - 上传只落盘（Priority: P1）

**Goal**：上传不再产生材料与作业；完成弹窗给出下一步入口。

**Independent Test**：上传一份表格 ⇒ 材料 0 行、作业 0 条、弹窗有提示；右键该文件「解析入库」⇒ 各 1 条（由既有路由用例守）。

### Tests first（先红）

- [x] T002 [US1] 反转上传断言为红：`packages/opencode/test/server/openhive-file-ops.test.ts:3146` 的「上传真 .xlsx ⇒ 200，且 case_material / case_ingest_job 各落一行」

  > **红（2026-11-15 实测）**：材料 `Expected 0 / Received 1`；作业 `Expected 0 / Received 1`；该文件 116 pass / 1 fail。

  - **入参**：现用例体（真 `.xlsx` + multipart 上传到 `sub`）
  - **出参**：用例改名「上传只落盘，不建材料行、不排作业」；断言改为材料 0 行、作业 0 条；本步跑 **FAIL**，实得「材料 1 / 作业 1」
  - **依赖**：T001
  - **验证**：`S: openhive-file-ops`，红值记录在案（`#004-03`）

### Implementation

- [x] T003 [US1] 删除上传入队段并收口签名：`packages/opencode/src/server/openhive/file.ts:854-872` 整段删除；`handleUpload`（`:815`）去掉 `pg` 参数；路由注册（`:406`）同步

  > **绿（2026-11-15 实测）**：`openhive-file-ops` 117 pass / 0 fail（T002 的用例转绿）；`openhive-case-materials` 38 pass / 0 fail（唯一入口守门仍绿）。

  - **入参**：T002 的红用例
  - **出参**：`handleUpload(request, root)`；上传只写盘；T002 转绿；`openhive-case-materials.test.ts:452` 的入队用例仍绿（唯一入口没被改坏）
  - **依赖**：T002
  - **验证**：`S: openhive-file-ops` + `S: openhive-case-materials` 全绿

- [x] T004 [US1] 注释随事实改：`file.ts` 的 `入队材料` JSDoc（`:727-738`）、`:743`、`:752-756`、`:759-762`；`openhive-file-ops.test.ts:3134-3145` 的「接线真调了入队」段落

  > **绿（2026-11-15 实测）**：`grep '顺手入队\|上传自动入队\|handleUpload\` 传的就是它\|上传落盘后' file.ts` 0 命中；`file-ops` 117 pass、`file-upload-ingest` 14 pass，均 0 fail。

  - **入参**：T003 后的代码事实
  - **出参**：注释里不再出现「上传落盘后顺手入队」「上传自动入队不传」「`handleUpload` 传的就是它」「计划 4 起 `.txt` 也会入队」这类现已不成立的现在时；历史结论（扰动实测）保留但标明「2026-11-15 起上传不再触库」
  - **依赖**：T003
  - **验证**：`grep -n '顺手入队\|上传自动入队\|handleUpload` 传的就是它' packages/opencode/src/server/openhive/file.ts` 0 命中；`S: openhive-file-ops` 仍绿（纯注释）

- [x] T005 [P] [US1] 上传完成提示：`packages/app/src/project/file-transfer-dialog.tsx:144` 的 `完成态` 按 `props.state.action === "上传"` 渲染一行弱化提示；`packages/app/src/project/file-transfer-dialog.test.tsx` 新增两条用例

  > **红（2026-11-15 实测）**：上传完成态 `Expected to contain "右键" / Received ""`，7 pass / 1 fail。
  > **绿**：8 pass / 0 fail。**变异**：条件改 `action === "下载"` ⇒ 上传用例红；恢复后 8 pass。

  - **入参**：`state = { kind: "done", action: "上传" | "下载", files, bytes }`
  - **出参**：上传完成态含「右键」与「解析入库」提示；下载完成态**不含**；运行中/失败态不变；不加新 prop
  - **依赖**：无（可与 T002–T004 并行）
  - **验证**：先跑 `A: project/file-transfer-dialog.test.tsx` 见红（提示缺失），实现后全绿

**Checkpoint**：US1 可独立验收（SC-001 / C1 / C2）。

---

## Phase 4: US2 - 右键多选批量入库（Priority: P1）

**Goal**：`解析入库` 支持文件夹 / 多选 / 混选；失败不中断；收尾一次说清。

**Independent Test**：多选 3 份（含 1 份已解析）⇒ 菜单「已选 3 项」、确认框 N=2 / M=1、只入队 2 份；中间失败后续仍发。

### Foundational for US2（判据单一出处）

- [x] T006 [US2] 抽出 `文件待入队`：`packages/app/src/project/case-materials-view.ts` 从 `目录下待入队`（`:162-185`，判据在 `:178-182`）抽文件级判定；`目录下待入队` 改为逐个调用

  > **红（2026-11-15 实测）**：`Export named '文件待入队' not found`（0 pass / 1 fail）。
  > **绿**：22 pass / 0 fail；`目录下待入队` 既有用例断言未改、原样全绿（TR-005）。

  - **入参**：`path: string`、`row: 材料视图 | undefined`、`extensions: readonly string[]`
  - **出参**：`boolean`（true = 这份文件可作为入队候选；`产物 / 已解析 / 已跳过 / 排队中 / 解析中 / 不可解析扩展名` 全为 false）
  - **依赖**：T001
  - **验证**：`A: project/case-materials-view.test.tsx` —— 既有用例**不改断言**、全绿（TR-005 行为不变）

- [x] T007 [US2] 新增 `选中集待入队`（先红后绿）：同一文件 `case-materials-view.ts`；用例进 `case-materials-view.test.tsx`

  > **红（2026-11-15 实测）**：`SyntaxError: Export named '选中集待入队' not found`，0 pass / 1 fail / 1 error。
  > **绿**：26 pass / 0 fail（既有 22 + 新增 4）。
  > **变异**：`文件待入队` 去掉 `row.status === "已跳过" ||` 一处 ⇒ 「已跳过」用例红 `Expected: [] / Received: ["资料/跳过.xlsx"]`（总 23 pass / 3 fail，另两条既有用例同红）；恢复后 26 pass / 0 fail。
  > **门禁**：`packages/app` typecheck 退出 0；根 `bun run lint` 退出 1，唯一 error 在未触碰的 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`（既有），本任务两文件仅命中两条既有 `consistent-return` 警告。

  - **入参**：`选中项: readonly string[]`（文件与目录路径混排）、`文件们: readonly string[]`（全树文件）、`行们: readonly 材料视图[]`、`extensions`
  - **出参**：`readonly string[]`（候选路径；文件与目录统一展开、按「见过」去重、**保持输入顺序**）
  - **依赖**：T006
  - **验证**：四条用例（混选去重 / 0 候选 / 已跳过排除 / 不可解析排除）先红后绿；变异「去掉已跳过排除」⇒ 对应用例必须红

- [x] T008 [P] [US2] 改名 `判下载目标` → `判菜单目标`：`packages/app/src/project/file-tree.tsx:723`，同步三处引用（`:737` 下载文案、`:744` 下载可用性、`:1452` 下载执行）

  > **基线（2026-11-15 实测，改名前后各跑一次）**：`file-tree.test.tsx` **176 pass / 0 fail / 377 expect**（改名后同，断言一行未改）。
  > **改名前 grep**：`packages/app/src` 内 `判下载目标` 3 处——`:723` 定义、`:744` 下载可用性、`:1452` 下载执行；brief 所称 `:737` 下载文案**已不引用**该函数（体内只剩 `是选中集`），故实际同步两处引用。
  > **改名后 grep**：`grep -n '判下载目标' packages/app/src` **0 命中**；`判菜单目标` 落点 `:723` / `:744` / `:1452` 三处。
  > **变异（纯改名，无新行为；钉住引用绑定）**：只把定义改回 `判下载目标`（调用点保持新名）⇒ typecheck 红两条 `file-tree.tsx(744,9)/(1452,16): error TS2552: Cannot find name '判菜单目标'`；恢复后退出 0。
  > **门禁**：`packages/app` typecheck 退出 0；根 `bun run lint` 退出 1，唯一 error 在未触碰的 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`（既有），本文件仅命中既有 `consistent-return` 警告（`:687` 等，未触碰）。

  - **入参**：`path: string | undefined`
  - **出参**：`{ kind: "file", path } | { kind: "folder", paths } | { kind: "selection", paths }`（语义与今日完全一致）
  - **依赖**：无（可与 T006/T007 并行，但改的是同一文件 → 实际按序做）
  - **验证**：`A: project/file-tree.test.tsx` 的下载组原样全绿

### 菜单与确认框

- [x] T009 [US2] 多选分支菜单（先红后绿）：`file-tree.tsx` 解析子菜单 + `case-materials-view.ts` 的 `状态文案`；用例进 `file-tree.test.tsx`

  > **红（2026-11-15 实测）**：`file-tree.test.tsx` 起点 176 pass / 0 fail，新增 4 条 ⇒ **177 pass / 3 fail**：① 四条原因 `Expected: "多选时只支持解析入库" / Received: "这份文件还没有解析记录"`；②③ `parse-enqueue` `Expected: false / Received: true`（入队仍按右键行判灰、触发项仍写行状态）。`case-materials-view.test.tsx` **26 pass / 1 fail**：`Expected: "已选 3 项" / Received: "未入队"`。（「右键第三行」那条实现前即绿——它钉的是现状单文件语义，不是新行为。）
  > **绿**：`file-tree.test.tsx` **180 pass / 0 fail / 405 expect**（既有 176 + 新增 4）；`case-materials-view.test.tsx` **27 pass / 0 fail / 88 expect**（既有 26 + 新增 1）。
  > **变异**：① 拆掉 view 层五处 `if (b.多选)`（四项原因 + 入队放行）⇒ 3 条红（多选 1、2、4）；② 拆掉 `状态文案` 的「已选 K 项」分支 ⇒ 3 条红（多选 1、2、单测）；③ `菜单依据` 第三参改传 `false` ⇒ 3 条红（多选 1、2、4），触发项文案仍绿（`选中集大小` 是另一条线）。三次恢复后均回 180 + 27 全绿。
  > **门禁**：`packages/app` `bun run typecheck` 退出 0；根 `bun run lint` 退出 1，唯一 error 在未触碰的 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`（既有）；本任务四文件仅命中既有警告（`consistent-return` ×3、`no-unsafe-type-assertion` ×1），新增行 0 警告。
  > **实现偏差**：按控制器裁定，selection 作用域「状态已读到即保持可点」（不看候选数），与原文「按候选非空亮」不同；`selection` 的 `onSelect` 本任务留明确 TODO（T010 接确认框），菜单亮灰与文案已完整。

  - **入参**：`判菜单目标(path)`、`选中集待入队(...)`、`选中集().size`（K）、`行们`、`rowsLoaded`
  - **出参**：`selection` 作用域下 —— `解析入库` 状态已读到即保持可点（已被本任务上方的实现偏差声明覆盖；候选为 0 仍弹确认框）、右侧「已选 K 项」；其余四项置灰且共用**同一句**原因；`file` / `folder` 作用域行为不变
  - **依赖**：T006、T007、T008
  - **验证**：用例含「右键行已解析但选中集有未入队 ⇒ 仍亮」「右键行不在选中集 ⇒ 只对自身」；先红后绿

- [x] T010 [US2] 确认框 N / M（先红后绿）：`file-tree.tsx:642-685` 的 `确认解析文件夹` 分支改造；用例进 `file-tree.test.tsx`

  > **基线（2026-11-15 实测）**：`file-tree.test.tsx` **180 pass / 0 fail / 405 expect**；`case-materials-view.test.tsx` **27 pass / 0 fail / 88 expect**。
  > **红（2026-11-15 实测）**：新增 3 条后 `file-tree.test.tsx` **181 pass / 2 fail / 183 tests**，两条都红在 selection 分支缺失（弹窗不出现）：用例 1、2 均 `Expected: "解析选中的文件" / Received: undefined`（`等到` 1s 超时，弹窗始终未挂到 body）；用例 3（folder 回归）实现前即绿，符合预期。
  > **绿**：`file-tree.test.tsx` **183 pass / 0 fail / 414 expect**（既有 180 + 新增 3）；`case-materials-view.test.tsx` **27 pass / 0 fail / 88 expect**（T007 既有断言一行未改）。
  > **变异**：① `选中集入队范围` 的 M 计数由「本项展开为空才 +1」改成「`+= 本项候选.length`」（错误口径：按文件数算 M）⇒ 用例 1 红 `Expected to contain: "另有 1 个选中项不在本次范围" / Received: "将解析选中的 2 个文件；另有 2 个选中项不在本次范围"`，**182 pass / 1 fail**；② 拆掉 N=0 弹窗的 `禁用` ⇒ 用例 2 红 `Expected: true / Received: false`（`parse-confirm-ok` 的 `disabled`），**182 pass / 1 fail**。两次恢复后均回 **183 pass / 0 fail / 414 expect** + **27 pass / 0 fail / 88 expect**。
  > **门禁**：`packages/app` `bun run typecheck` 退出 0（首次实跑暴露 `选中集()` 是 `ReadonlySet` ≠ `readonly string[]` 的 TS2740，改传 `[...选中集()]` 后通过）；根 `bun run lint` 退出 1，**唯一 error** 在未触碰的 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`（既有，octal escape），本任务三文件命中的三条 `consistent-return` 均为既有（`标记形状:12` / `悬停文案:43` / `成功文案:754`），新增行 0 诊断。
  > **落点核对（`#002-06`）**：`选中集待入队` 改为调用 `选中集入队范围(...).候选`，全仓仅此一处展开逻辑；`目录下待入队` 调用点仍只有文件夹弹窗与 `选中集入队范围`；`确认解析选中` 仅由 `parse-enqueue` 的 selection 分支调用。

  - **入参**：`选中项`（用于算 M）、候选集（N）、被排除的选中项数（M）
  - **出参**：`selection` 作用域标题「解析选中的文件」、正文「将解析选中的 N 个文件」+「另有 M 个选中项不在本次范围」；N=0 ⇒ 弹窗仍出、确认键禁用；`folder` 文案不变
  - **依赖**：T007
  - **验证**：3 选 1 已解析 ⇒ N=2、M=1；全不可入队 ⇒ N=0 + 禁用；先红后绿

  > **T010-fix（复审发现 #1，2026-11-15）**：`目录下待入队` / `选中集入队范围` 的分隔符口径缺陷——`文件们` 是 `fs.list` 原样（win32 带 `\`），`目录` 来自树节点（已被 `normalizeFileTreeV2Path` 归一成 `/`），混比导致 win32 下文件夹展开恒为空（N=0、M 偏大）；候选也必须回写 posix 形（服务端 `case-parse.ts:112` 按 `split("/")` 切段且拒收 `\`）。修复：比较与行表建键一律用归一键，返回归一形；顺序与去重语义不变。
  > **红（2026-11-15 实测）**：`case-materials-view.test.tsx` 新增 4 条 ⇒ **27 pass / 4 fail / 94 expect**，4 条都红在反斜杠清单展开为空：① `Expected: ["资料/甲.csv","资料/乙.xlsx"] / Received: []`；② `Expected: ["资料/乙.xlsx"] / Received: []`；③ `Expected: ["资料/甲.csv","资料/乙.xlsx"] / Received: []`；④ `Expected: ["资料/甲.csv"] / Received: []`。
  > **绿**：`case-materials-view.test.tsx` **31 pass / 0 fail / 95 expect**；`file-tree.test.tsx` **189 pass / 0 fail / 439 expect**；`packages/app` `bun run typecheck` 退出 0。
  > **变异**：① 前缀比较改回原始路径拼 `"/"` ⇒ 4 条 T010-fix 全红（①②③④均 `Received: []`），**27 pass / 4 fail**；② `目录下待入队` 行表建键改回 `row.path`（去掉归一）⇒ 用例 ② 红 `Expected: ["资料/乙.xlsx"] / Received: ["资料/甲.csv","资料/乙.xlsx"]`（原始 `资料\甲.csv` 的已解析行查不到、被当「未入队」），**30 pass / 1 fail**。两次恢复后均回 **31 pass / 0 fail / 95 expect** + **189 pass / 0 fail / 439 expect**。

- [x] T011 [US2] 抽出批量执行器 + 失败不中断（先红后绿）：`file-tree.tsx:663-682` 抽成 `执行批量入队(候选)`，`break`（`:673`）改「继续 + 收集」；用例进 `file-tree.test.tsx`

  > **红（2026-11-15 实测）**：既有 183 条 + 新增 6 条（另把旧「中途失败即停」改写为「失败不中断」）⇒ `file-tree.test.tsx` **186 pass / 3 fail / 189 tests**，三条全部红在旧 `break` 中断：① 文件夹失败不中断 `Expected` 3 条 `记.解析` / `Received` 2 条（缺 `资料/丙.csv`）；② 全失败 `Expected` 2 条 / `Received` 1 条（缺 `资料/乙.xlsx`）；③ 多选失败不中断 `Expected` 3 条 / `Received` 2 条（缺 `丙.csv`）。其余新增（全成功、A×2、B）实现前即绿——它们钉既有正确行为，红只来自 `break`（检查点：首跑时上一条红在半路、`toaster.clear()` 未执行导致 toast 串味，本组加 `beforeEach(() => toaster.clear())` 后得到上述干净基线）。
  > **绿**：`file-tree.test.tsx` **189 pass / 0 fail / 439 expect**。
  > **变异**：①「继续」改回 `break`（只在执行器一处）⇒ 3 条红（文件夹失败 / 全失败 / 多选），**186 pass / 3 fail**；② A 的变异：`入队不可用原因` 的 `if (b.多选)` 挪到 `rowsLoaded` 闸之前 ⇒ 2 条红（多选 + 还没读到 / 多选 + 读取失败，`Expected: true / Received: false`，即 `aria-disabled` 变亮），**187 pass / 2 fail**；③ B 的变异：`选中集入队范围` 的 M 判据改成 `本项候选.length === 0 || 文件 !== undefined` ⇒ B 红 `Expected: "将解析选中的 2 个文件" / Received: "将解析选中的 2 个文件；另有 1 个选中项不在本次范围"`（连带 T010 的 N/M 用例红，实得 `另有 3 个`），**187 pass / 2 fail**。三次恢复后均回 **189 pass / 0 fail / 439 expect**。
  > **门禁**：`packages/app` `bun run typecheck` 退出 0；根 `bun run lint` 退出 1，唯一 error 仍是未触碰的 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`（既有，octal escape）；本次两个文件单独 lint **0 error**（2 条均为既有警告：`成功文案` 的 `consistent-return`、测试里剪贴板断言）。
  > **落点核对（`#002-06`）**：全仓批量入队循环只剩 `执行批量入队` 一处（`file-tree.tsx:638` 起）；`确认解析文件夹` / `确认解析选中` 各一行调用（`:702` / `:752`）；成功/失败 toast 文案只在该执行器内。
  > **T011-fix（T011 复审发现，2026-11-15）**：契约 C5 的「逐份串行」原本没有 pin——假 `parse` 同步记录，改成 `Promise.all` 仍全绿。补一条用例：假 `parse` 在 `开始` 与 `结束` 之间让出一次事件循环，断言事件序列为 `开始 甲 / 结束 甲 / 开始 乙 / 结束 乙`。**绿**：`file-tree.test.tsx` **190 pass / 0 fail / 440 expect**，EXIT=0。**变异**：执行器去掉 `await 状态.parse(...)`（改并发）⇒ 该条红 `Expected` 串行序列 / `Received` 两次开始挤在两次结束之前，**0 pass / 1 fail**（`-t "逐份串行"`）；恢复后 **190 pass / 0 fail**。

  - **入参**：`候选: readonly string[]`、`状态.parse(path, "入队")`
  - **出参**：`{ 成功: number, 失败: { path, message }[] }`；逐份串行、失败继续；`状态.reload()` **恰好 1 次**；toast 成功/失败两类文案（失败含前 3 条原因与「重试只补没成功的、不会重复」）；`S + F = N`
  - **依赖**：T007（候选）、T010（弹窗）
  - **验证**：`假材料状态({ parse })` 让第 2 份回 error ⇒ 第 3 份仍被发出（`记.解析` 顺序）+ 失败报告；变异「继续改回 break」⇒ 该用例必须红

**Checkpoint**：US2 可独立验收（SC-002 / SC-003 / C3–C5）。US1+US2 = MVP。

---

## Phase 5: US3 - 左栏只留三个页签（Priority: P2）

**Goal**：删「实体」页签与接线；实体详情能力保留。

**Independent Test**：三页签 + 键盘 3 步环绕；实体详情伪路径仍渲染。

- [x] T012 [US3] 把页签测试改到红：`packages/app/src/project/sidebar-tabs.test.tsx`（`:71-72` 的 `entities` prop、`:82-86` 四 tab、`:172-175` 实体 pane、`:190/:206/:229` 文案断言、`:262-282` 键盘序列）、`packages/app/src/project/sidebar-tabs.stories.tsx`

  > **红（2026-11-15 实测，先红）**：`cd packages/app && timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/sidebar-tabs.test.tsx` ⇒ **15 pass / 6 fail / 44 expect / 21 tests**，EXIT=1；六条全部红在「多了一个实体」（组件仍是四 tab）：
  > ① tab 列表 `Expected` `["session","files","capability"]` / `Received` 中间多出 `"entity"`（`- Expected  - 0` / `+ Received  + 1`）；
  > ② 无计数文案 `Expected` `["会话","文件","能力"]` / `Received` 多出 `"实体"`；
  > ③ 有计数文案 `Expected` `["会话","文件","能力 3"]` / `Received` 多出 `"实体"`；
  > ④ 0 计数文案 `Expected` `["会话","文件","能力 0"]` / `Received` 多出 `"实体"`；
  > ⑤ 正向环绕 `Expected: ["capability"]` / `Received: ["entity"]`（文件按 → 落到实体）；
  > ⑥ 反向环绕 `Expected: ["files"]` / `Received: ["entity"]`（能力按 ← 落到实体）。
  > 说明：本任务只改测试、**不要求转绿**；`sidebar-tabs.tsx` 一个字节未动。`entities` prop 仍按现接口传参（删 prop 归 T014），实体 pane 注入断言已删；`sidebar-tabs.stories.tsx` 删除 `EntityTab` / 实体 body / `entities` 传参，注释与说明改为三 tab。

  - **入参**：目标形态 `["session","files","capability"]`
  - **出参**：断言改为三 tab、文案 `["会话","文件","能力"]`、环绕 3 步、`entities` prop 不再被使用；本步跑 **FAIL**（组件仍是四个）
  - **依赖**：无
  - **验证**：`A: project/sidebar-tabs.test.tsx` 红，红在「多了一个实体」

- [x] T013 [US3] 删页签实现：`packages/app/src/project/sidebar-tabs.tsx`（`:8` 键、`:12-16` 文案、`:20` 顺序、`:198-210` pane、`:3-6` 与 `:17-20` 的「四个 tab」注释）

  > **绿（2026-11-15 实测）**：`cd packages/app && timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/sidebar-tabs.test.tsx` ⇒ **21 pass / 0 fail / 47 expect / 21 tests**，EXIT=0。
  > 变异验证：把 `entity` 临时加回 `SidebarTabKey` / `TAB_LABEL` / `TAB_ORDER` ⇒ **15 pass / 6 fail**，EXIT=1，红点与 T012 完全一致（6 条全部是 `Received` 多出 `"entity"`）；恢复后复跑回到 21 pass / 0 fail。
  > 门禁：`cd packages/app && timeout 300 bun run typecheck` ⇒ EXIT=0；仓库根 `timeout 300 bun run lint` ⇒ EXIT=1，唯一 error 是既有的 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163` 八进制转义（与本任务无关，本文件 0 告警）。
  > 说明：`entities` prop **保留**（接口与注释标注「T013 撤页签，T014 删接线」），未触发 TS 未使用报错。

  - **入参**：T012 的红用例
  - **出参**：`SidebarTabKey` 三值；`TAB_ORDER` 三项；无 entity pane；注释改成「三个」
  - **依赖**：T012
  - **验证**：`A: project/sidebar-tabs.test.tsx` 全绿

- [x] T014 [US3] 清理接线并下架面板：`packages/app/src/workspace/workspace-entry.tsx`（`:27-28` import、`:211` prop、`:2101-2116` `entities` 注入）、`packages/app/src/pages/layout-new.tsx`（`:55` import、`:68`、`:256`）；删除 `packages/app/src/project/entity-panel.tsx` 与 `entity-panel.test.tsx`

  > **红（2026-11-15 实测）**：先删 `sidebar-tabs.tsx` 的 `entities` prop，`cd packages/app && timeout 300 bun run typecheck` ⇒ **EXIT=1**，5 条错误全部为 `TS2322 ... Property 'entities' does not exist on type 'IntrinsicAttributes & SidebarTabsProps'`（`sidebar-tabs.test.tsx:71/179/194/217` ＋ `workspace-entry.tsx:2103`）。
  > **绿（2026-11-15 实测）**：清掉四个 `entities=` 传参、`workspace-entry.tsx` 的 import/prop/注入块、`layout-new.tsx` 的 `createEntityApi`/`ENTITY_API`/`entityApi`，删掉 `entity-panel.tsx` 与 `entity-panel.test.tsx`，并去掉 `sidebar-tabs.stories.tsx` 的 `@ts-nocheck` ⇒ `cd packages/app && timeout 300 bun run typecheck` **EXIT=0**。
  > 测试：`timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/workspace/workspace-entry.test.tsx` ⇒ **238 pass / 0 fail / 634 expect / 15.25s**，EXIT=0（stderr 有一条 teardown 期 happy-dom `removeChild` DOMException，不影响断言与退出码）；同参数跑 `./src/project/sidebar-tabs.test.tsx` ⇒ **21 pass / 0 fail / 47 expect**，EXIT=0。
  > 变异验证：把 `entities={<探针 slot="probe-entity" />}` 加回 `sidebar-tabs.test.tsx` 一处调用点 ⇒ typecheck **EXIT=1**（`Property 'entities' does not exist`）；恢复后复跑 **EXIT=0**。
  > 落点清查：`grep -rn "EntityPanel" packages/app/src` ⇒ **0 命中**；`grep -rn "\bentityApi\b" packages/app/src` ⇒ **0 命中**；`git diff --name-only b83409c399 -- packages/app/src/project/entity-api.ts` ⇒ **空**（一个字节未动）。
  > 门禁：仓库根 `timeout 300 bun run lint` ⇒ EXIT=1，唯一 error 仍是既有的 `packages/session-ui/.../prompt-input/index.tsx` 八进制转义（与本任务无关）；本任务六个改动文件在 lint 输出中只有既有 warning（`entity-api.ts:76/84/88`、`layout-new.tsx:114/149`），无新增。

  - **入参**：T013 后的 `SidebarTabs` props（无 `entities`）
  - **出参**：app 包 typecheck EXIT=0；`entity-api.ts` **一个字节不动**；`实体路径` 若因此无引用则一并删 import（只删本改动造成的孤儿）
  - **依赖**：T013
  - **验证**：`T`（packages/app）+ `A: workspace/workspace-entry.test.tsx`

- [x] T015 [US3] 保留能力回归：`packages/app/src/project/entity-api.test.ts`、`packages/app/src/center/case-route.test.ts`、`packages/app/src/center/case-views/entity-profile.test.tsx`

  > **实测（2026-11-15，只跑不改）**：
  > - `cd packages/app && timeout 300 bun test ./src/project/entity-api.test.ts` ⇒ **6 pass / 0 fail / 13 expect**，EXIT=0。
  > - `cd packages/app && timeout 300 bun test ./src/center/case-route.test.ts` ⇒ **9 pass / 0 fail / 20 expect**，EXIT=0。
  > - `cd packages/app && timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/entity-profile.test.tsx` ⇒ **56 pass / 0 fail / 206 expect**，EXIT=0。
  > 结论：实体详情页、`case://` 伪路径、取数底座仍可用（FR-014）。本任务未改任何源码/测试。

  - **入参**：不做改动，只跑
  - **出参**：三个文件全绿 —— 实体详情页、`case://` 伪路径、取数底座仍可用（FR-014）
  - **依赖**：T014
  - **验证**：三条命令 EXIT=0

**Checkpoint**：US3 可独立验收（SC-004）。

---

## Phase 6: Polish

- [x] T016 门禁：两个包 typecheck + 本章受影响的全部测试文件 + 仓库根 lint

  > **实测（2026-11-15，逐条真实输出）**：
  > - `cd packages/app && timeout 300 bun run typecheck`（`tsgo -b`）⇒ **EXIT=0**。
  > - `cd packages/opencode && timeout 300 bun run typecheck`（`tsgo --noEmit`）⇒ **EXIT=0**。
  > - `cd packages/opencode && timeout 300 bun test ./test/server/openhive-file-ops.test.ts` ⇒ **117 pass / 0 fail / 660 expect**，EXIT=0。
  > - `cd packages/opencode && timeout 300 bun test ./test/server/openhive-case-materials.test.ts` ⇒ **38 pass / 0 fail / 132 expect**，EXIT=0。
  > - `cd packages/opencode && timeout 300 bun test ./test/server/openhive-file-upload-ingest.test.ts` ⇒ **14 pass / 0 fail / 32 expect**，EXIT=0。
  > - `cd packages/app && timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/file-tree.test.tsx ./src/project/case-materials-view.test.tsx` ⇒ **221 pass / 0 fail / 535 expect**（190 + 31），EXIT=0。
  > - `... ./src/project/file-transfer-dialog.test.tsx` ⇒ **8 pass / 0 fail / 23 expect**，EXIT=0。
  > - `... ./src/project/sidebar-tabs.test.tsx` ⇒ **21 pass / 0 fail / 47 expect**，EXIT=0。
  > - `... ./src/workspace/workspace-entry.test.tsx` ⇒ **238 pass / 0 fail / 634 expect**，EXIT=0。
  > - `cd packages/app && timeout 300 bun test ./src/project/entity-api.test.ts` ⇒ **6 pass / 0 fail**，EXIT=0；`./src/center/case-route.test.ts` ⇒ **9 pass / 0 fail**，EXIT=0；`... ./src/center/case-views/entity-profile.test.tsx` ⇒ **56 pass / 0 fail**，EXIT=0。
  > - 仓库根 `timeout 300 bun run lint` ⇒ **EXIT=1；1 error / 6231 warnings**。唯一 error 为既有且未触碰的 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163:19`（`'0'-prefixed octal literals`，`content-['\200B']`）。
  > **warning 基线口径（如实）**：T001 未记录全仓 warning 数，故无法逐数对比「不新增」。替代证据：本 feature 改动文件逐个单独 lint 均为 0 error、仅既有 warning（`layout-new.tsx:114/149`、测试剪贴板断言等，均出现在本 feature 之前）。此项作为 T016 的已知缺口登记，不写成「已对比基线」。
  > **口径修正（终审 D7）**：下方出参原文写「`L` 0 errors」，实得 EXIT=1、1 个**既有** error ⇒ 判据按「**0 新增 error**」解读；commit subject「门禁全绿」指 typecheck / 测试全绿 ＋ lint 无新增 error。

  - **入参**：T002–T015 的改动
  - **出参**：`packages/app` `T` EXIT=0；`packages/opencode` `T` EXIT=0；受影响测试全绿；`L` 0 errors（warning 数与 T001 基线对比不新增）
  - **依赖**：T002–T015
  - **验证**：命令与实得输出逐条记录（不写「已通过」了事）

- [x] T017 收尾检索 + 真栈手工 + 缺口登记：`grep 'EntityPanel' packages/app/src`、`grep '\bentityApi\b' packages/app/src`、`grep '入队材料(' packages/opencode/src`；按 [quickstart.md](./quickstart.md) §2 M1–M11 手工验收

  > **静态检索（2026-11-15 实测）**：
  > - `rg -n 'EntityPanel' packages/app/src` ⇒ **OK: 0 命中**。
  > - `rg -n '\bentityApi\b' packages/app/src` ⇒ **OK: 0 命中**。
  > - `rg -n '入队材料\(' packages/opencode/src` ⇒ 只剩 `case-parse.ts:303`（调用）；`file.ts:740` 为定义。
  > - 附加：`rg -n '判下载目标' packages/app/src` ⇒ **OK: 0 命中**。
  > **真栈探测（非破坏性）**：`netstat`/`curl` 探测 3010、3011、4711、4712、4700、4096 全部无监听；无 bun 进程 ⇒ **真栈未运行，按 brief 不启动**。状态目录：`%TEMP%\openhive-real-stack-state` 不存在（未保留），`D:\openhive-stack-state`、`D:\assets` 存在且未删改。
  > **M1–M11**：全部登记为「本轮未执行（未启动真栈）」，逐条结论与组件测试依据见 [implementation-report.md](./implementation-report.md) §2；缺口表见其 §3（与 quickstart §3 对齐，另加 lint warning 基线、v2 toast、`汇总全部` win32 既有缺陷三条）。
  > **产出**：[implementation-report.md](./implementation-report.md)（静态检索、真栈结论、缺口表、TDD 证据索引 17 条 commit）。
  > **终审修复**：2026-11-15 终审 D1–D7 的处置与证据见 [implementation-report.md](./implementation-report.md) §5.7（只做文档/规格对齐与 FR-011 截断用例，不改生产行为）。

  - **入参**：最终工作树 + 真栈
  - **出参**：前两条 0 命中；第三条只剩 `case-parse.ts:303`；M1–M11 结论逐条记录；本机验不了的写进缺口表（TR-007，不写成已覆盖）
  - **依赖**：T016
  - **验证**：命令输出逐条贴出；缺口表与 quickstart §3 对齐

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1（T001）**：无依赖，先做，其余任务的红/绿都要与基线对齐
- **Phase 2**：不存在（本 feature 无共享基础设施）
- **Phase 3（US1）**：T002 → T003 → T004；T005 可与它们并行（不同文件）
- **Phase 4（US2）**：T006 → T007 → {T009, T010, T011}；T008 可与 T006 并行
- **Phase 5（US3）**：T012 → T013 → T014；T015 在 T014 之后（只跑不改）
- **Phase 6**：T016 → T017

### User Story Dependencies

- **US1**：独立（只动上传链路与传输弹窗）
- **US2**：独立（只动文件树与候选判据），但复用 US1 不涉及的文件
- **US3**：独立（只动左栏与接线）

三条故事**互不依赖**，可按 US1 → US2 → US3 顺序做，也可并行（不同人分不同文件）。

### Within Each User Story

- 先写会红的用例 → 再写最小实现 → 变异验证 → 跑该包门禁
- 判据先抽函数（T006）再做菜单/弹窗（T009/T010），避免第二份同一前提（`#002-06`）
- 批量执行器（T011）最后做，它同时依赖候选与弹窗文案

---

## Parallel Example: US1

```bash
# T005 与 T002–T004 是不同文件，可同时开工：
Task: "T002 反转上传断言为红（test/server/openhive-file-ops.test.ts:3146）"
Task: "T005 上传完成提示（src/project/file-transfer-dialog.tsx + .test.tsx）"
```

## Parallel Example: US2

```bash
# T006 与 T008 改不同文件：
Task: "T006 抽出 文件待入队（src/project/case-materials-view.ts）"
Task: "T008 改名 判菜单目标（src/project/file-tree.tsx）"
```

---

## Implementation Strategy

### MVP First（US1 + US2）

1. T001 基线
2. US1（T002–T005）：上传只落盘 + 提示
3. US2（T006–T011）：多选批量 + 失败交代
4. **STOP and VALIDATE**：quickstart §2 的 M1–M9
5. US3（T012–T015）：页签下架（`07` 的三个决定代码上互不依赖；若 MVP 只收 US1+US2，本段可下一批）

### 每条任务的完成判据（统一）

1. 用例先红、红值实测记录（`#004-03`）；
2. 实现后该文件全绿；
3. 变异拆掉实现，钉它的用例必须红；
4. 受影响包 typecheck 通过；
5. 报告只写实际跑过的命令与输出。

---

## Notes

- 本清单 **17 条**（Setup 1 + US1 4 + US2 6 + US3 4 + Polish 2），每条按 2–5 分钟粒度切分，单一职责、可单独验证。
- `[P]` 只在「不同文件且无未完成依赖」时使用；改同一文件的任务按序做。
- 不做的事以 [spec.md](./spec.md) 的 Scope Boundaries 为准：不加服务端批量接口、不加迁移、不改解析链路与队列。
- 参考教训：`#002-06`（同一前提单一出处，T006）、`#010-06`（两套来源别各判一次，T008）、`#009-02`（组件测试 conditions/preload）、`#004-03`（红值实测）。

---

## 复审修复轮 2（2026-11-15，D8–D12）

只改文档 / 注释 / 测试，生产可执行逻辑零改动。完整报告见 `.superpowers/sdd/plan/fix-round-2-report.md`。

- **D8–D10（文档/注释）**：spec FR-007 / FR-009 与 US2 场景 4 随 2026-11-15 裁定修正；data-model / research / quickstart / plan / tasks 旧口径对齐；C7 作业新建口径改为「`入队` / `重新解析` 经 `入队材料`」；7 处「上传自动入队」残留改为「011 起上传只落盘、不再入队」（含新发现 `script/openhive-case-stage0.ts:46`）。
- **D11（FR-007 的 M 计数）**：
  - 绿：`case-materials-view.test.tsx` 新增 2 条（0 候选文件夹算 1 个被排除项；posix 尾分隔符 `资料/`）⇒ 文件 **33 pass / 0 fail**；与 file-tree 合跑 **225 pass / 0 fail / 556 expect**。
  - 变异：`case-materials-view.ts` 的 `if (本项候选.length === 0)` 改为 `&& 文件 !== undefined` ⇒ **32 pass / 1 fail**，`Expected: 1 / Received: 0`。恢复后全绿。
- **D12（生产 v2 toast 落屏）**：
  - 绿：`file-tree.test.tsx` 新增 `setV2Toast(true)` + `<ToastRegion v2 />` 用例，断言 S/F、前 3 条原因与尾句；合跑 225 pass。
  - 变异：`packages/ui/src/v2/components/toast-v2.tsx` 的 `description: entry.options.description` 改为 `undefined` ⇒ **1 fail**（`Expected to contain: "资料/一.xlsx" / Received: "成功 0 份；5 份未能入队"`）。恢复后 `git diff --stat packages/ui packages/app/src/project/case-materials-view.ts` 为空。
- **门禁**：见 `fix-round-2-report.md`；本轮未跑真栈（约束禁止启动/删除真栈进程与状态目录）。
