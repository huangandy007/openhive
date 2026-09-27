# Tasks: 平台底座（三栏工作台）

**Input**: `docs/superpowers/specs/001-platform-foundation/`

**Prerequisites**: spec.md（用户故事）、plan.md（结构 / 集成点）

**Tests**: 本 feature 为前端框架改造，测试以「受影响 package 的 bun test + typecheck」为准，不单独写契约测试。

> **修订记录 2026-09-27（T001 落点核实后）**：T001 发现原定三栏靶子（`sidebar-shell.tsx` 图标栏、`layout.tsx` 三栏骨架）属**已退休的 legacy 布局**，运行时不可达。经决策**三栏改建于 new 布局**，下列任务已按事实复核：
> - **T003 / T006 由「换皮」升为「新增」**（new 布局无对应承载物，无皮可换）。
> - **T007 / T017 落点改为 v2**（`--v2-*` token；顶栏注入点 `titlebar.tsx:614`）。
> - 任务条数、阶段划分、依赖图、FR 覆盖**均不变**。
> - 落点证据见 `refactor-targets.md`。

## 任务格式约定

- `[P]` = 可并行（不同文件、无依赖）
- `[USn]` = 所属用户故事
- `[FE]` = 前端 / `[INT]` = 前后端集成 / `[BE]` = 后端。本 feature 为纯前端，无 `[BE]`。
- `[FE]` 任务标注「换皮」或「新增」：**换皮** = 改 opencode 已有组件的 token（**v2** `packages/ui/src/v2/styles/theme.css`，因生效布局是 new 布局/v2）；**新增** = 新建 openhive 组件。token 映射见 plan.md「前端换皮区」。
- 每条含 `[FR-x 来源] [依赖任务] [出参验证方式]`

## Phase 1: Setup（定位 + 建目录）

- [x] T001 [P] [FE·换皮] 定位 opencode 前端三栏真实组件（sidebar-rail / session 主内容区 / SessionSidePanel），产出「改造落点清单」[FR-001] [无依赖] [出参：三栏真实组件路径 + 可改造点说明]
      → 产出 `refactor-targets.md`（行号已逐条核取）。**阻断性发现：三栏靶子（rail / 左栏）全在 legacy 布局，而 legacy 已被上游退休**（`oldInterfaceSunset = 2026-09-14` 已过 → `settings.tsx:251` `oldInterfaceRetired = true` → `:129` `resolveNewLayoutDesigns` 无条件返回 `true`），当前运行时 `newLayoutDesigns()` 恒为 true，走 `layout-new.tsx`（仅 49 行：Titlebar + 单个 `<main>`，**无 rail、无左栏**）。右栏 `SessionSidePanel` 存活但职责是「文件树 + review」而非 AI 会话。token 靶子须由 legacy `--xxx` 换为 `--v2-*`（且 v2 浅色值同时在 `:root` 与 `[data-color-scheme="light"]`，只改前者会被覆盖）。**决策已定：建在 new 布局**（合宪法 I/V：加不是改）。论证见 `refactor-targets.md` §6。T002 起按此执行。
- [x] T002 [P] [FE·新增] 在 `packages/app/src/` 下建 `rail/`、`center/`、`topbar/`、`workspace/` 目录骨架 [FR-001] [无依赖] [出参：目录结构就位，typecheck 通过]
      → 4 目录已建（各含空 `.gitkeep`——git 不跟踪空目录）+ 不变量测试 `src/openhive-module-dirs.test.ts`（RED→GREEN，4 expect；下游 002–010 按这些路径 import，误删/改名为静默破坏）。`bun run test:unit` 725 pass / 0 fail。
      ⚠️ 出参中「typecheck 通过」**本机无法验证**：`bun run typecheck` 在 `packages/app` / `packages/enterprise` 上因 2 个 `.d.ts` 符号链接被 Windows（`core.symlinks=false`）检出为纯文本而报 TS1128，属**既有环境问题**（主仓库同样如此），与本改动无关。详见 `state.md`「质量门禁」。

## Phase 2: Foundational（阻塞所有用户故事的底座）

- [ ] T003 [FE·新增] 实现三栏布局容器 `workspace/three-pane.tsx`（左/中/右骨架 + 折叠/拖拽），并以最小挂载接入 new 布局 `layout-new.tsx:41` 的 `<main>`（**新增，非重定义 LegacyLayout**——legacy 已退休不改造）[FR-001] [T001] [出参：登录后渲染三栏骨架]
- [ ] T004 [P] [FE·新增] 实现 `center/view-registry.ts`（扩展名→视图组件 的注册式接口 + 查找）[FR-007][FR-008] [T002] [出参：注册一个测试视图可被查找到]
- [ ] T005 [P] [FE·新增] 实现 `center/tab-store.ts`（跨模块 tab 累积、切模块不清空的状态）[FR-004][FR-006] [T002] [出参：单测验证跨模块切 tab 状态保留]

## Phase 3: US1 三栏框架（P1）

- [ ] T006 [P] [US1] [FE·新增] 实现图标栏 `rail/`：五入口 + 系统设置，入口可见性读 capability（**新增，非换皮**——new 布局无图标栏）[FR-002] [T003] [出参：五入口可点、无权限入口隐藏]
- [ ] T007 [P] [US1] [FE·换皮+新增] 实现顶栏 `topbar/`（品牌 Logo/站内信/全屏/用户下拉）：品牌部分换皮 opencode `titlebar.tsx`（v2 分支挂在 `titlebar.tsx:614` 的 `#opencode-titlebar-right` 注入点，**不改 Titlebar 主体**），站内信为新增 [FR-003] [T003] [出参：顶栏四要素渲染]
- [ ] T008 [US1] [INT] 接入登录后进入三栏工作台的入口流程 [FR-001] [T003] [出参：登录后默认落在三栏工作台]

## Phase 4: US2 共享中栏跨模块累积（P1）

- [ ] T009 [US2] [FE·新增] 实现 `center/tab-bar.tsx`（跨模块 tab 栏 + 模块着色 + 溢出收「⋯」）；**需同时厘清与顶栏 session tab 条的分工**（`titlebar.tsx:398` `TitlebarTabStrip` 已在顶栏；约定：顶栏只管 session tab，本容器只管「内容视图 tab」）[FR-005] [T005] [出参：多模块 tab 着色显示，溢出收⋯]
- [ ] T010 [US2] [FE·新增] 实现左栏切换模块时不清空中栏 tab 的联动 [FR-006] [T005] [出参：切模块后中栏 tab 仍在]
- [ ] T011 [US2] [FE·新增] 实现「特有 tab 由模块动作打开」的机制（非预置常驻）[FR-010] [T005] [出参：模块动作能打开新 tab 并累积]

## Phase 5: US3 中栏多形态内容区（P1）

- [ ] T012 [P] [US3] [FE·新增] 实现 `document-view`（Word/PDF 预览，docx-preview）[FR-007] [T004] [出参：.docx/.pdf 点开渲染预览]
- [ ] T013 [P] [US3] [FE·新增] 实现 `sheet-view`（Excel 表格，SheetJS）[FR-007] [T004] [出参：.xlsx 点开渲染表格]
- [ ] T014 [P] [US3] [FE·新增] 实现 `slide-view`/`mindmap-view`/`richtext-view`/`image-view`（演示/导图/图文/图片）[FR-007] [T004] [出参：对应类型文件渲染]
- [ ] T015 [US3] [FE·新增] 实现未知扩展名降级呈现（不白屏、可提示）[FR-007] [T004] [出参：未知类型文件点开有降级提示]

## Phase 6: US4 职责分离 + 收尾（P2）

- [ ] T016 [US4] [FE·换皮] 将代码编辑器降级为「少数技术用户可选工作区」（非默认视图）[FR-009] [T004] [出参：默认不进入代码编辑器，可手动开启]
- [ ] T017 [P] [FE·换皮] 品牌化走配置（Logo/名称从配置读取，不硬编码）[宪法 II] [T007] [出参：改配置即可换 Logo/名称]
      → 含 v2 语义 token 换皮（`--v2-*` → DESIGN.md 蜂蜜金/暖白/暖黑）。⚠️ v2 浅色值**同时在 `:root` 与 `[data-color-scheme="light"]` 两处**，只改前者会被 ThemeProvider 覆盖，须两处同改；**绝不手改 `v2/styles/colors.css` 原语色阶**。

---

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003（依赖 T001）；T004 ∥ T005（依赖 T002，可并行）
- **Phase 3**：T006 ∥ T007 ∥ T008（依赖 T003）
- **Phase 4**：T009 / T010 / T011（依赖 T005）
- **Phase 5**：T012 ∥ T013 ∥ T014 ∥ T015（依赖 T004）
- **Phase 6**：T016（依赖 T004）∥ T017（依赖 T007）

共 17 条任务（T001–T017），符合 12–18 条范围。
