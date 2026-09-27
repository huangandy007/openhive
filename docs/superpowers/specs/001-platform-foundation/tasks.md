# Tasks: 平台底座（三栏工作台）

**Input**: `docs/superpowers/specs/001-platform-foundation/`

**Prerequisites**: spec.md（用户故事）、plan.md（结构 / 集成点）

**Tests**: 本 feature 为前端框架改造，测试以「受影响 package 的 bun test + typecheck」为准，不单独写契约测试。

> **修订记录 2026-09-27（T001 落点核实后）**：T001 发现原定三栏靶子（`sidebar-shell.tsx` 图标栏、`layout.tsx` 三栏骨架）属**已退休的 legacy 布局**，运行时不可达。经决策**三栏改建于 new 布局**，下列任务已按事实复核：
> - **T003 / T006 由「换皮」升为「新增」**（new 布局无对应承载物，无皮可换）。
> - **T007 / T017 落点改为 v2**（`--v2-*` token；顶栏注入点 `titlebar.tsx:614`）。
> - 任务条数、阶段划分、依赖图、FR 覆盖**均不变**。
> - 落点证据见 `refactor-targets.md`。

> **修订记录 2026-09-27b（FR-007「10 类」口径澄清，用户确认）**：T004 实现视图注册表时暴露——FR-007 原文 10 类里的「数据明细 / 可视化图表 / 分析记录」来自业务 PG、**没有文件扩展名**，与 FR-007 自身「按内容类型（扩展名）路由」的定义相矛盾。经用户确认：**「10 类」= 日常办公常见的 10 类文件**，不含上述三类。
> - 受影响任务：**T012 / T013 / T014**（声明 10 类 → 扩展名映射）。
> - **最终 10 类待逐项确认**（T012 启动前定）；候选提案见 `state.md` 待决项。
> - 上述三类的路由归属与 T011/T016 的数据轴待决项**是同一个问题**，一并解决。

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
      ✅ 出参「typecheck 通过」已验证：首跑因本机 `core.symlinks=false` 把 2 个 `.d.ts` 符号链接检出为纯文本而报 TS1128（既有环境问题，主仓库同样如此）→ 已按决策修 `core.symlinks` 并重新物化 60 个 symlink → **`bun run typecheck` 30/30 通过**。详见 `state.md`「质量门禁」。
      ⚠️ 唯一仍红的门禁是 `bun run lint` 的 1 个 error（上游 `prompt-input/index.tsx:163`），已决策记为已知红、上报上游，不在本项目内私改（宪法 I）。

## Phase 2: Foundational（阻塞所有用户故事的底座）

- [x] T003 [FE·新增] 实现三栏布局容器 `workspace/three-pane.tsx`（左/中/右骨架 + 折叠/拖拽），并以最小挂载接入 new 布局 `layout-new.tsx:41` 的 `<main>`（**新增，非重定义 LegacyLayout**——legacy 已退休不改造）[FR-001] [T001] [出参：登录后渲染三栏骨架]
      → 产出 `packages/app/src/workspace/three-pane.tsx`（槽位式：`left` / `children` / `right` + `leftCollapsed` / `rightCollapsed`，宽度 280 / 360px 按 DESIGN.md §4.1，复用上游 `@opencode-ai/ui/resize-handle`，夹取 160px~视口50% 与 240px~视口2/3）+ 6 个组件测试 `three-pane.test.tsx`（全绿，19 expect）。挂载点 `layout-new.tsx:43`。
      ✅ 出参**结构性满足、视觉上未显现**：容器已进入 `layout-new.tsx` 渲染树，但左右槽位暂为空（左栏由 T006、右栏由 T007/T009 供给），故此刻**看不到三栏**——这是任务切分的预期中间态，非缺陷。中栏原样复刻 `<main>` 的 flex 上下文（`flex flex-col items-start`），既有路由布局**零变化**：`test:unit` 725 pass（与 T002 末一致）、`test:browser` 41 pass。
      🔧 **本 task 附带补齐了前端组件测试地基**：`packages/app` 此前 **0 个 `.test.tsx`、无组件测试能力**（`tsconfig` 为 `"jsx": "preserve"` → Bun 退化成 `React.createElement`）。按仓库既有范式（`packages/tui` 的 `@opentui/solid/preload`）新增本包自有 preload `packages/app/solid-jsx.ts`（`babel-preset-solid` generate:"dom" + `@babel/preset-typescript`），并加 `test:components` 脚本；3 个 devDep 均已存在于 `bun.lock`，**无新增下载**。T004–T017 可直接复用。
- [x] T004 [P] [FE·新增] 实现 `center/view-registry.ts`（扩展名→视图组件 的注册式接口 + 查找）[FR-007][FR-008] [T002] [出参：注册一个测试视图可被查找到]
      → 产出 `packages/app/src/center/view-registry.ts`：`createViewRegistry()`（`register` / `resolve`）+ `extensionOf(path)`；8 个单测 `view-registry.test.ts`（17 expect，`.ts` 无 JSX，走 `test:unit`）。
      ✅ 出参已满足：`register({extensions:[".docx"]})` 后 `resolve(".docx")` 取回同一组件（测试 1）。
      **自定的契约（plan/spec 未定义，T012–T015 将依赖）**：
      - `ViewProps = { path: string }`——视图只接一个文件路径，内容自行读取。**故意留到最小**，T012+ 需要再加（加宽向后兼容）。
      - `register` 说**扩展名**（带点，如 `[".doc",".docx"]`），`resolve` 也按扩展名查；`extensionOf(path)` 单独负责「路径 → 扩展名」，调用方组合 `resolve(extensionOf(p))`。两侧各司其职、无歧义。
      - `extensionOf` 语义对齐 `path.extname`：纯 dotfile（`.gitignore`，含 `a/b/.gitignore`）无扩展名；`/` 与 `\` 都当分隔符（`node:path` 不能进浏览器包，手写 4 行）。
      **两个我做的行为决策（未经指示，请复核）**：
      1. **同一扩展名重复注册 → 抛错**（非静默覆盖）。理由：FR-008 面向插件作者，静默覆盖会让后注册者无声打掉前者的视图；真要覆盖可日后加显式 `override` 选项。
      2. **同批注册中途冲突 → 整批不生效**（先全量校验再落库），不留半注册状态。
      ⚠️ **未导出应用级单例**（Simplicity First：此刻无消费者）。T009/T012 落首个真实视图时需决定共享实例放哪。
      ⚠️ **待决（T011/T016 前须定）**：plan.md「数据流向」mermaid 把**两条轴都汇入内容视图注册表**，但本注册表按**扩展名**索引，而 FR-007 的「数据明细 / 可视化图表 / 分析记录」三类**没有文件扩展名**（数据轴来自业务 PG）。这两类现在无法经本注册表路由，需在 T011/T016 前厘清。
      ⚠️ FR-007 列了 10 类内容类型，注册表**没有「内容类型」概念**，只有扩展名——刻意的：暂无消费者需要它（FR-005 按**来源模块**着色，不是按内容类型）。10 类 → 扩展名的映射留待 T012–T015 声明。
      TDD 诚实标注：循环 1 我提前写了「多扩展名 for 循环」（类型是复数，顺手就 loop 了），属无失败测试的生产代码 → **已按 Iron Law 删除**，由循环 2 的测试驱动回来。门禁：`test:unit` 733 pass（725 + 8）/ `test:components` 6 pass / typecheck 30-30 / 本目录 lint 0 命中。
- [x] T005 [P] [FE·新增] 实现 `center/tab-store.ts`（跨模块 tab 累积、切模块不清空的状态）[FR-004][FR-006] [T002] [出参：单测验证跨模块切 tab 状态保留]
      → 产出 `packages/app/src/center/tab-store.ts` + 11 个单测 `tab-store.test.ts`（22 expect，`.ts` 无 JSX，走 `test:unit`）。
      ✅ 出参已满足：`switchModule(before, "项目管理")` 后 `tabs` 与 `active` 逐字段不变（测试「切换模块只换工作上下文，中栏 tab 与激活态 100% 保留」），且跨模块累积（模块 A 的 tab 在切到 B 后仍在）另有断言。
      **API（纯 reducer，照 `context/layout-tabs.ts` 范式——不引入 Solid store/signal，响应式层留 T009/T011）**：`openContentTab` / `activateContentTab` / `closeContentTab` / `switchModule` + `contentTabKey`。
      **关键设计**：tab 身份 = `模块 + \n + 路径`（**来源模块是身份的一部分**，故同一文件在两个模块里打开算两张 tab——FR-005 按模块着色，不这么定就会出现同内容两色冲突）。分隔符取 `\n` 而非 `:`，因路径里含 `:`（`C:\…`）。
      **关闭语义**沿用 `layout-tabs.ts`：关激活项 → 优先左邻居，无左邻居取右邻居；关最后一张 → `active` 清空（中栏回无内容）。关**非**激活项 → 激活态不动。
      ⚠️ **`ContentTab.module`（tab 的*来源*模块）与 `CenterTabState.module`（当前*停留*的模块）同名而义不同**——已在两处类型注释里拉开对比，是 T009/T010 最容易踩的坑。
      TDD 诚实标注：循环 7 的 GREEN 里我顺手写了「关非激活项不动激活态」的守卫（当时无失败测试）→ **已按 Iron Law 删掉**，由循环 9 的测试驱动回来。另循环 6「跨模块累积」非 RED 驱动，是强度断言（已在测试内注释声明）。
      门禁：`test:unit` **744 pass / 0 fail**（T004 末 733 + 11）/ `test:components` 6 pass / typecheck 30-30 / `bunx oxlint packages/app/src/center` **0 命中**；全仓 lint 唯 1 个 error 仍是既有上游那条（已知红），新文件 0 命中。

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
      ⚠️ **T012–T014 三任务共同前置**：FR-007 的「10 类」= **日常办公常见的 10 类文件**（修订记录 2026-09-27b），原列的「数据明细 / 可视化图表 / 分析记录」**不计入**。最终 10 类须在 T012 启动前逐项确认（候选提案见 `state.md` 待决项）。
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
