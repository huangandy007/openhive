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

- [ ] T009 [US2] 多选分支菜单（先红后绿）：`file-tree.tsx` 解析子菜单 + `case-materials-view.ts` 的 `状态文案`；用例进 `file-tree.test.tsx`

  - **入参**：`判菜单目标(path)`、`选中集待入队(...)`、`选中集().size`（K）、`行们`、`rowsLoaded`
  - **出参**：`selection` 作用域下 —— `解析入库` 按候选非空亮、右侧「已选 K 项」；其余四项置灰且共用**同一句**原因；`file` / `folder` 作用域行为不变
  - **依赖**：T006、T007、T008
  - **验证**：用例含「右键行已解析但选中集有未入队 ⇒ 仍亮」「右键行不在选中集 ⇒ 只对自身」；先红后绿

- [ ] T010 [US2] 确认框 N / M（先红后绿）：`file-tree.tsx:642-685` 的 `确认解析文件夹` 分支改造；用例进 `file-tree.test.tsx`

  - **入参**：`选中项`（用于算 M）、候选集（N）、被排除的选中项数（M）
  - **出参**：`selection` 作用域标题「解析选中的文件」、正文「将解析选中的 N 个文件」+「另有 M 个选中项不在本次范围」；N=0 ⇒ 弹窗仍出、确认键禁用；`folder` 文案不变
  - **依赖**：T007
  - **验证**：3 选 1 已解析 ⇒ N=2、M=1；全不可入队 ⇒ N=0 + 禁用；先红后绿

- [ ] T011 [US2] 抽出批量执行器 + 失败不中断（先红后绿）：`file-tree.tsx:663-682` 抽成 `执行批量入队(候选)`，`break`（`:673`）改「继续 + 收集」；用例进 `file-tree.test.tsx`

  - **入参**：`候选: readonly string[]`、`状态.parse(path, "入队")`
  - **出参**：`{ 成功: number, 失败: { path, message }[] }`；逐份串行、失败继续；`状态.reload()` **恰好 1 次**；toast 成功/失败两类文案（失败含前 3 条原因与「重试只补没成功的、不会重复」）；`S + F = N`
  - **依赖**：T007（候选）、T010（弹窗）
  - **验证**：`假材料状态({ parse })` 让第 2 份回 error ⇒ 第 3 份仍被发出（`记.解析` 顺序）+ 失败报告；变异「继续改回 break」⇒ 该用例必须红

**Checkpoint**：US2 可独立验收（SC-002 / SC-003 / C3–C5）。US1+US2 = MVP。

---

## Phase 5: US3 - 左栏只留三个页签（Priority: P2）

**Goal**：删「实体」页签与接线；实体详情能力保留。

**Independent Test**：三页签 + 键盘 3 步环绕；实体详情伪路径仍渲染。

- [ ] T012 [US3] 把页签测试改到红：`packages/app/src/project/sidebar-tabs.test.tsx`（`:71-72` 的 `entities` prop、`:82-86` 四 tab、`:172-175` 实体 pane、`:190/:206/:229` 文案断言、`:262-282` 键盘序列）、`packages/app/src/project/sidebar-tabs.stories.tsx`

  - **入参**：目标形态 `["session","files","capability"]`
  - **出参**：断言改为三 tab、文案 `["会话","文件","能力"]`、环绕 3 步、`entities` prop 不再被使用；本步跑 **FAIL**（组件仍是四个）
  - **依赖**：无
  - **验证**：`A: project/sidebar-tabs.test.tsx` 红，红在「多了一个实体」

- [ ] T013 [US3] 删页签实现：`packages/app/src/project/sidebar-tabs.tsx`（`:8` 键、`:12-16` 文案、`:20` 顺序、`:198-210` pane、`:3-6` 与 `:17-20` 的「四个 tab」注释）

  - **入参**：T012 的红用例
  - **出参**：`SidebarTabKey` 三值；`TAB_ORDER` 三项；无 entity pane；注释改成「三个」
  - **依赖**：T012
  - **验证**：`A: project/sidebar-tabs.test.tsx` 全绿

- [ ] T014 [US3] 清理接线并下架面板：`packages/app/src/workspace/workspace-entry.tsx`（`:27-28` import、`:211` prop、`:2101-2116` `entities` 注入）、`packages/app/src/pages/layout-new.tsx`（`:55` import、`:68`、`:256`）；删除 `packages/app/src/project/entity-panel.tsx` 与 `entity-panel.test.tsx`

  - **入参**：T013 后的 `SidebarTabs` props（无 `entities`）
  - **出参**：app 包 typecheck EXIT=0；`entity-api.ts` **一个字节不动**；`实体路径` 若因此无引用则一并删 import（只删本改动造成的孤儿）
  - **依赖**：T013
  - **验证**：`T`（packages/app）+ `A: workspace/workspace-entry.test.tsx`

- [ ] T015 [US3] 保留能力回归：`packages/app/src/project/entity-api.test.ts`、`packages/app/src/center/case-route.test.ts`、`packages/app/src/center/case-views/entity-profile.test.tsx`

  - **入参**：不做改动，只跑
  - **出参**：三个文件全绿 —— 实体详情页、`case://` 伪路径、取数底座仍可用（FR-014）
  - **依赖**：T014
  - **验证**：三条命令 EXIT=0

**Checkpoint**：US3 可独立验收（SC-004）。

---

## Phase 6: Polish

- [ ] T016 门禁：两个包 typecheck + 本章受影响的全部测试文件 + 仓库根 lint

  - **入参**：T002–T015 的改动
  - **出参**：`packages/app` `T` EXIT=0；`packages/opencode` `T` EXIT=0；受影响测试全绿；`L` 0 errors（warning 数与 T001 基线对比不新增）
  - **依赖**：T002–T015
  - **验证**：命令与实得输出逐条记录（不写「已通过」了事）

- [ ] T017 收尾检索 + 真栈手工 + 缺口登记：`grep 'EntityPanel' packages/app/src`、`grep '\bentityApi\b' packages/app/src`、`grep '入队材料(' packages/opencode/src`；按 [quickstart.md](./quickstart.md) §2 M1–M11 手工验收

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
