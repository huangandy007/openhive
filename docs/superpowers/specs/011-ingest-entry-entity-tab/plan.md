# Implementation Plan: 解析入库入口收敛与实体页签下架

**Branch**: `011-ingest-entry-entity-tab` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `docs/superpowers/specs/011-ingest-entry-entity-tab/spec.md`
**上游设计**：`docs/superpowers/specs/2026-11-09-事实卡片抽象/07-解析入库入口与实体页签-设计.md`（含 §6 功能边界）

## Summary

把「入队」收敛成唯一入口——右键「解析入库」，并让它支持多选；上传只落盘、不再顺手入队；左栏去掉「实体」页签但保留实体详情页。技术上是**纯适配**：候选判据、批量执行器、确认弹窗、逐份入队接口、选中集判据、完成态弹窗全部复用现有实现，只抽出共用函数、加多选分支、删掉上传入队段与实体页签接线（含 `entity-panel.tsx` 下架）。**不新增接口、不新增迁移、不改解析链路。**

MVP 范围：**US1 + US2**（spec 的两条 P1）。US3 同批实现，但不作为 MVP 验收门（`07` 三条决定在代码上互不依赖；若改判，只影响验收批次，不影响任务顺序）。

## Technical Context

**Language/Version**: TypeScript 5.8（Bun 1.4.2 monorepo）

**Primary Dependencies**: SolidJS 1.9.10 / Kobalte（菜单与弹窗）/ Vite 7.1.4；后端 Hono 4.10.7 + Effect 4.0.0-beta.83

**Storage**: 不改存储。上传仍写沙箱文件；材料与作业仍由右键入队产生（PG 表不变）

**Testing**: `bun test`（包内单文件跑）；Solid 组件测试需 `--conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts`（`#009-02`）

**Target Platform**: 桌面浏览器（内网 Web）

**Project Type**: Bun monorepo：前端 `packages/app`，后端 `packages/opencode`

**Performance Goals**: 批量提交 ≥10 份文件不卡界面（逐份串行、每份一次请求）；上传请求耗时不变

**Constraints**: 零新增服务端接口、零数据库迁移；不改解析链路、作业队列与置顶；批量失败不中断且 S+F=N

**Scale/Scope**: 改动面 2 个包、约 8 个源文件 + 6 个测试文件；无新增依赖

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 本 feature 的落法 | 判定 |
|---|---|---|
| I 最小化上游合并冲突 | 改的全是本地 fork 定制文件（`project/*`、`server/openhive/file.ts`）；不碰 `sql.ts` 与上游高频文件 | ✅ |
| II 品牌化走配置 | 无品牌相关改动 | ✅ |
| III 物理隔离优先 | 无数据隔离改动 | ✅ |
| IV 权限下沉执行层 | 未新增/未放宽任何权限；上传与入队仍走既有鉴权 | ✅ |
| V 侵入是「加」不是「改」 | 本 feature 是本地定制删减与前端适配；不重写核心模块，不改上游既有文件语义 | ✅ |
| 禁止模式：直接改 `sql.ts` / 硬编码品牌 / 前端隐藏替代鉴权 / 信任 AI SQL | 均不涉及 | ✅ |

**Re-check（Phase 1 后）**：设计产物只涉及前端交互契约与纯函数抽取，仍全部通过；无 Complexity Tracking 需要。

## Reuse First（硬性要求：已有能力只适配，不新建）

| 需要的能力 | 现有实现（2026-11-15 实读） | 处理方式 |
|---|---|---|
| 多选集合与「右键行是否在选中集」 | `file-tree.tsx:445` `选中集`、`:708` `是选中集` | **原样复用** |
| 右键作用范围判定（file / folder / selection） | `file-tree.tsx:723` `判下载目标` | **改名** `判菜单目标`，下载与解析共用（不抄第二份，`#002-06`） |
| 文件夹候选口径 | `case-materials-view.ts:162` `目录下待入队` | **抽出** `文件待入队(path,row,extensions)`；`目录下待入队` 改调它，行为不变 |
| 单项亮灰原因 | `case-materials-view.ts:215-280` 五个 `*不可用原因` | **原样复用**；多选只在调用处分流 |
| 逐份入队请求 | `case-materials-api.ts:16` `/openhive/case/parse`、`状态.parse(path,"入队")` | **原样复用**，不新增接口 |
| 确认弹窗组件 | `parse-confirm-dialog.tsx` `ParseConfirmDialog` | **原样复用**，只换标题/正文/禁用 |
| 文件夹批量执行（确认→逐个发→reload→toast） | `file-tree.tsx:645-685` `确认解析文件夹` | **抽公共执行器**，文件夹与多选两种候选来源共用 |
| 成功/失败提示 | `showToast`（现有） | **原样复用** |
| 触发项右侧状态文字 | `case-materials-view.ts:68` `状态文案` | **加一支**「已选 K 项」 |
| 上传完成弹窗 | `file-transfer-dialog.tsx:144` `完成态` | **加一行**提示；`FileTransferState` 已有 `action`，不加 prop |
| 当前「未入队」提示 | `悬停文案`（`case-materials-view.ts:43`）已写「未入队 · 右键「解析」可入库」 | **不改**（已存在，不造第二句） |
| 上传写盘与判重 | `file.ts:815` `handleUpload` | **只删**落盘后的入队段；其余原样 |

**明确不新建**：不做新弹窗组件、不做新批量 API、不做新候选函数（只抽）、不做新状态存储、不做新 toast。

## Project Structure

### Documentation (this feature)

```text
docs/superpowers/specs/011-ingest-entry-entity-tab/
├── spec.md          # 已生成
├── plan.md          # 本文件
├── research.md      # Phase 0：关键决策与替代方案
├── data-model.md    # Phase 1：视图实体与状态（无 DB 变更）
├── contracts/       # Phase 1：交互契约（菜单/弹窗/上传行为）
│   └── ui-contracts.md
└── quickstart.md    # Phase 1：可复跑的验收步骤
```

### Source Code (repository root)

```text
packages/app/src/
├── project/
│   ├── file-tree.tsx              # 改：判菜单目标、多选分支、批量执行器、确认框数字
│   ├── file-tree.test.tsx         # 改/加：多选、N/M/K、批量失败继续
│   ├── case-materials-view.ts     # 加：文件待入队、选中集待入队；状态文案加一支
│   ├── case-materials-view.test.tsx # 加：抽出函数用例；既有用例全绿
│   ├── file-transfer-dialog.tsx   # 改：完成态上传提示
│   ├── file-transfer-dialog.test.tsx # 加：上传有提示、下载无提示
│   ├── sidebar-tabs.tsx           # 改：删 entity 页签与 pane
│   ├── sidebar-tabs.test.tsx / .stories.tsx # 改/删对应项
│   ├── entity-panel.tsx / entity-panel.test.tsx # 删（本地定制下架）
│   └── entity-api.ts              # 不动（保留清单见 07 §3.2）
├── workspace/workspace-entry.tsx  # 改：删 EntityPanel 注入与 entityApi prop
├── workspace/workspace-entry.test.tsx # 改：去接线
└── pages/layout-new.tsx           # 改：删 createEntityApi/ENTITY_API

packages/opencode/
├── src/server/openhive/file.ts    # 改：删上传入队段、收口 pg 参数、改随事实过期的注释
├── test/server/openhive-file-ops.test.ts     # 改：反转上传断言（:3146）
├── test/server/openhive-case-materials.test.ts # 不改：既有路由级入队用例当守门（:452）
└── test/server/openhive-file-upload-ingest.test.ts # 不改：`入队材料` 库函数用例仍有效
```

**Structure Decision**: 沿用既有分层——前端交互组件在 `packages/app/src/project`，服务端在 `packages/opencode/src/server/openhive`。不新建目录、不新建包。

## Phase 0: Research

见 [research.md](./research.md)。关键决策（均已由 `07` 定案，这里只登记与替代方案）：

1. **批量只在前端**：替代方案「服务端批量接口」被否——会被写成按状态全集扫，把「已跳过」翻回来（`07` §5.6）。
2. **候选判据抽函数而非复制**：替代方案「解析抄一份三元判断」被否——第二份同一前提（`#002-06`）。
3. **上传弹窗提示写在弹窗自身**：替代方案「workspace-entry 传文案」被否——一句话两个来源。
4. **MVP = US1+US2**：US3 同批实现但不计 MVP 验收门（`07` 三决定代码无依赖）。

## Phase 1: Design

- [data-model.md](./data-model.md)：五个视图实体（盘上文件 / 材料 / 解析作业 / 选中集 / 候选集），**无数据库变更**。
- [contracts/ui-contracts.md](./contracts/ui-contracts.md)：上传响应行为、菜单五项亮灰、确认框三个数字、批量收尾报告、上传完成提示。
- [quickstart.md](./quickstart.md)：逐条可复跑的验证步骤（单测 + 真栈手工）。

## Phase 2: Implementation Tasks（严格 TDD，先红后绿）

> 顺序按依赖排；每步「Run」见 quickstart。**红色必须实测记录**（`#004-03`）。

### Task 1 上传只落盘：先把既有断言反转成红

**Files**: `packages/opencode/test/server/openhive-file-ops.test.ts:3146`，用例
`上传真 .xlsx ⇒ 200，且 case_material / case_ingest_job 各落一行（接线真调了入队）`

- [ ] 改断言：材料行与作业数从 1 改为 0，用例名同步改成「上传真 .xlsx ⇒ 200，且不建材料行、不排作业（上传只落盘）」
- [ ] 跑单文件，确认红，实得「材料 1 / 作业 1」
- [ ] 注释一并改：该用例上方 `:3134-3145` 讲的「接线真调了入队」「上传时 `enqueueMaterial` 扰动后续 app」在删除后不再成立，改成「上传不再触库」+ 保留它对扰动历史的说明（历史事实不删，只纠正现在时）

### Task 2 唯一入口的守门用例：留基线（已有，不新建）

**Files**: `packages/opencode/test/server/openhive-case-materials.test.ts:452-467`

- [ ] 跑该文件，确认既有用例「入队一份新表格：材料进「排队中」、作业落库…」**绿**，留作 Task 3 之后的回归守门
- [ ] 说明：spec TR-003 原文称「今天这条接线没有任何用例」，实读后不成立（该用例已断言材料行 / 状态 / `queued_by` / 指纹 / 作业行），spec 已带日期修正；**不要再造一条重复用例**

### Task 3 删上传入队段 → 转绿

**Files**: `packages/opencode/src/server/openhive/file.ts`

- [ ] 删 `handleUpload` 落盘后的入队段（`:854-872`，「落盘即入队（设计 §5.2）」注释起至 `}` 止）
- [ ] `handleUpload` 去 `pg` 参数（`:815`），路由注册处同步（`:406`）；`User` 的 import **不动**（`gate:587` 仍在用）；`OpenhivePg` 的 import **不动**（`handleTransfer:624` 仍在用）
- [ ] 注释随事实改：`入队材料` 的 JSDoc（`:727-738`「上传落盘后顺手入队」）、`:743`（「`handleUpload` 传的就是它」）、`:752-756`（force 与「上传是幂等的」）、`:759-762`（「上传自动入队不传」）
- [ ] Task 1 转绿、Task 2 的基线仍绿；`openhive-file-ops` 与 `openhive-case-materials` 两个文件全绿

### Task 4 抽 `文件待入队`（行为不变）

**Files**: `case-materials-view.ts`、`case-materials-view.test.tsx`

- [ ] 先把 `目录下待入队` 的既有用例跑一遍留基线（全绿）
- [ ] 抽出 `文件待入队(path, row, extensions)`（含「产物 / 已解析 / 已跳过 / 运行中 / 不可解析」排除）
- [ ] `目录下待入队` 改调它；既有用例原样全绿（不改断言）

### Task 5 新增 `选中集待入队`（先红）

**Files**: `case-materials-view.ts`、`case-materials-view.test.tsx`

- [ ] 先写四条用例：文件+文件夹混选去重、0 候选、已跳过排除、不可解析排除
- [ ] 实现：文件调 `文件待入队`，文件夹调 `目录下待入队`，用 `见过` 去重
- [ ] 转绿；**变异**：去掉「已跳过」排除 ⇒ 对应用例必须红

### Task 6 判菜单目标（重命名，下载共用）

**Files**: `file-tree.tsx`

- [ ] `判下载目标`（`:723`）改名 `判菜单目标`；三处引用同步（`:737` 下载文案、`:744` 下载可用性、`:1452` 下载执行），解析子菜单也用它
- [ ] 既有下载用例原样全绿（不改断言）

### Task 7 菜单多选分支（先红）

**Files**: `file-tree.tsx`、`file-tree.test.tsx`

- [ ] 先写用例：多选时其余四项置灰 + 统一原因；「解析入库」按候选非空亮；右键行已解析但选中集有未入队 ⇒ 仍亮
- [ ] 实现：解析子菜单看 `判菜单目标(path).kind`；`selection` ⇒ 只有「解析入库」放行且原因取 `选中集待入队` 非空；其余四项统一原因
- [ ] `状态文案` 加「已选 K 项」一支（K = 选中集大小）
- [ ] 转绿

### Task 8 确认框 N/M/K（先红）

**Files**: `file-tree.tsx`、`file-tree.test.tsx`

- [ ] 用例：3 选中、1 已解析 ⇒ 正文 N=2 且含「另有 1 个选中项不在本次范围」；N=0 ⇒ 弹窗仍出、确认键禁用
- [ ] 实现：沿用现有结构（`标题="解析这个文件夹"`、正文「将解析…N 个文件」，`file-tree.tsx:642-685`）；选中集分支标题改「解析选中的文件」，并在正文追加 M 一句；N=0 分支已存在（`:646-657`），补多选文案
- [ ] 计数单位按「一份文件 / 一个 0 候选文件夹」；K 只出现在触发项右侧（Task 7）
- [ ] 转绿

### Task 9 批量执行器共用 + 失败不中断（先红）

**Files**: `file-tree.tsx`、`file-tree.test.tsx`

- [ ] 用例：`假材料状态({ parse })` 让**中间那份**回 `{kind:"error"}` ⇒ 断言后面几份仍被发出（`记.解析` 顺序）+ 收尾失败报告含原因；`S+F=N`
- [ ] 把 `确认解析文件夹` 的执行体（`:663-682`）抽成 `执行批量入队(候选)`；`break`（`:673`）改「继续 + 收集 `{path, message}`」
- [ ] 文件夹路径与多选路径共用同一执行器；跑完 `状态.reload()` 恰好一次
- [ ] 转绿；**变异**：把「继续」改回 `break` ⇒ 新用例必须红

### Task 10 上传完成提示（先红）

**Files**: `file-transfer-dialog.tsx`、`file-transfer-dialog.test.tsx`

- [ ] 用例：`action === "上传"` 的 done 态含「右键…解析入库」提示；下载不含
- [ ] 实现：`完成态` 内按 `props.state.action` 渲染一行弱化文字
- [ ] 转绿

### Task 11 实体页签下架（先改测试到红）

**Files**: `sidebar-tabs.tsx` / `.test.tsx` / `.stories.tsx`、`workspace-entry.tsx` / `.test.tsx`、`layout-new.tsx`、`entity-panel.tsx` / `.test.tsx`

- [ ] 先把四 tab 断言、键盘环序列、注入用例改成三 tab 期望 → 跑红
- [ ] 删 `entity` 键、文案、顺序项、pane；改文件头与 pane 编号注释
- [ ] 删 `EntityPanel` / `实体路径` import、`entityApi` prop 与注入；删 `createEntityApi` 与 `ENTITY_API` 传参
- [ ] 删 `entity-panel.tsx` 与测试；**`entity-api.ts` 一个字节不动**
- [ ] 转绿

### Task 12 门禁与收尾

- [ ] `packages/app` typecheck；`packages/opencode` typecheck
- [ ] 受影响测试文件全跑（命令见 quickstart）
- [ ] 仓库根 `bun run lint`
- [ ] grep 收尾：`EntityPanel` 无结果；`\bentityApi\b` 在 `packages/app/src/` 无结果；`入队材料` 调用只剩 `case-parse.ts` 一处
- [ ] 真栈手工三条（quickstart §手工）

## Gates

1. 每条 FR 都有先红后绿的用例与实得（`#004-03`）；
2. 变异验证逐条留痕（Upload 反转入队段、候选「已跳过」、批量 break）；
3. 两个包 typecheck 通过、受影响测试全绿、lint 通过；
4. 无新增接口、无迁移（`git diff` 里不出现迁移文件与路由注册新增）；
5. 真栈手工验收：上传不入队 + 文件夹批量 + 多选批量 + 三页签；验不了的写缺口表。

## Risks / 未决

1. **MVP 边界**（spec 澄清问题 1 未答）：本方案按推荐项取 US1+US2 为 MVP；若改为「三条一起验收」，只调整 Task 11 的验收批，不改实现。
2. 批量提交是**串行等待**（沿用现有文件夹批量）：100 份时界面要等 N 次往返；本期不做并发，避免失败归因与「已跳过」翻回风险。
3. 同名同内容两份文件先后解析会改写老材料行路径（既有行为）；批量更容易撞到，只记录不修。
4. 批内执行顺序倒序（置顶算法既有）；不改。
5. 实体详情页下架入口后不可达（`07` §9.5）：已知，代码保留。
