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

- [x] T006 [P] [US1] [FE·新增] 实现图标栏 `rail/`：五入口 + 系统设置，入口可见性读 capability（**新增，非换皮**——new 布局无图标栏）[FR-002] [T003] [出参：五入口可点、无权限入口隐藏]
      → 产出 `packages/app/src/rail/entries.ts`（清单 + 过滤）+ `rail.tsx`（组件）+ 单测 `entries.test.ts`（4 条，走 `test:unit`）+ 组件测 `rail.test.tsx`（6 条，走 `test:components`），共 10 条 / 15 expect。
      ✅ 出参已满足：①「五入口可点」——点击回调带出的是入口 **id**（`fund-analysis`）而非显示名，另有断言钉住五入口文案与顺序恰为 FR-002 所列 + 系统设置吸底；②「无权限入口隐藏」——`capabilities={new Set(["project"])}` 时只渲染 `项目管理` + `系统设置`。另断言图标栏宽 56px（DESIGN §4.1）、当前入口带左侧竖条与 `aria-current="page"` 而其余入口都没有（§4.1 + §4.3 不只靠颜色）。
      **capability 契约（用户决策：001 只出接口，不接签发方）**：入口声明自己需要的 `capability`；`visibleEntries(entries, capabilities?)` 里 `capabilities` **省略 = 尚未接签发方 → 不过滤**，**传入（哪怕空集）= 已由签发方定夺 → 只留有能力的那些**；无 `capability` 的入口（系统设置）恒留。`Rail` 对应 `capabilities?` prop。真正的鉴权仍在下游执行层（宪法 IV，前端隐藏不替代校验）。
      **API（纯数据 + 无状态组件）**：`RailEntry` / `RAIL_ENTRIES` / `SETTINGS_ENTRY` / `visibleEntries` / `Rail` / `RAIL_WIDTH`。`Rail` 不持有选中态，`active` 由外部传入（选择态归 T010 的模块切换）。
      ⚠️ **`rail.tsx` 超出 plan.md「文件结构」清单**——plan.md:61-62 只列了 `rail/entries.ts`，未列组件文件。理由是「清单 + 过滤」没有视觉承载物就满足不了 FR-002 的「图标栏」。**须回改 plan.md 文件结构**（或明确声明为计划外新增），已记入 `state.md` 待办。
      ⚠️ **图标选型是我的裁量，需设计评审**：DESIGN §4.2 只说「单色线性图标」，未点名。实取 `folder` / `archive` / `speech-bubble` / `bullet-list` / `branch` / `settings-gear`（末位沿用仓库先例）。取值为 `IconProps["name"]`（= `keyof typeof icons`），故编不出不存在的图标；但**语义对不对要人看**。`Icon` 默认 `size="normal"` = 20px，与参考件 `w-5 h-5` 一致，无需显式传。
      **视觉来源**：`front/src/components/LeftIconBar.tsx`（**仅视觉参考，未移植一行 React**，按 [FE] 规则重建为 SolidJS）+ DESIGN.md §4.1/§4.3。落点：容器白底 + 右侧分隔线、40px 方形图标按钮、选中态浅金底 + 左侧金色竖条、设置项以细分隔线隔开并吸底。
      🔴 **DESIGN 与 token 的真实冲突（T017 阻断项）**：DESIGN §1.3 / §4.1 要求选中底 = **浅金 `#FEF3C7`**，但 v2 的 overlay 语义 token **只有中性黑/白 alpha**（`--v2-alpha-dark-*` / `light-*`），**不存在品牌色 overlay token**（已核 `v2/styles/theme.css` + `v2/styles/colors.css` 全部 overlay / alpha 定义）。本任务取仓库既有的「选中面」token `--v2-overlay-simple-overlay-pressed`（先例：`v2/components/file-tree-v2.css:38-41` 的 `[data-selected]`）——语义正确，但**值是中性灰，不等于 DESIGN 要求的浅金**。按宪法 §八「绝不硬编码新 hex」不能就地写 `#FEF3C7`；按宪法 I，`theme.css` 归 T017。→ **T017 必须二选一**：全局重定 `overlay-pressed` 为品牌色，或新增一个语义选中面 token（并同改 `:root` 与 `[data-color-scheme="light"]` 两处），否则正式违反 DESIGN §4.1。另：选中态的**金色身份**目前由竖条 `bg-v2-background-bg-accent` + 图标 `text-v2-icon-icon-accent` 承载，这两者 T017 会重定为蜂蜜金，故 T017 后选中态 = 金条 + 金图标 + 中性底。
      ⚠️ **视觉类无测试断言（L2 缺口）**：happy-dom 无 CSS 引擎，`classList` / `text-v2-*` 全部断言不到，测试只覆盖了 DOM 结构（`data-slot` / `aria-*` / 内联 `style.width`）。颜色/间距/圆角的正确性须在 T017 用真实浏览器核对。已与 `test-routing-advisor` 判定的「单前端 L2 视觉回归」缺口对齐。
      ⚠️ **上游遗留观察（未本地修，宪法 I）**：`packages/ui/src/components/icon.css` 给图标元素自身设了 `color: var(--icon-base)`，理论上会盖住父级下的 `text-v2-icon-icon-muted`。本任务沿用仓库既有先例（`packages/app/src/components/dialog-connect-provider.tsx:135` 在父按钮上放 `text-v2-*` 给内部 `Icon` 上色），未改上游 CSS。**T017 视觉核对时须确认图标颜色是否真的生效**；若确被 `--icon-base` 覆盖，那是上游问题 → 上报，不本地改。
      ⚠️ **系统设置也能是当前入口**：参考件里设置是「打开设置对话框」而非「切模块」，故 T010 接线后 `active="settings"` 大概率永不被传。仍按**统一实现**（谁 id 命中谁高亮）而非给设置开特例——更简单、且不预设 T010 的结论。
      TDD 诚实标注：① `entries.test.ts` 第 1 条（五入口清单）**非 RED 驱动**，是「数据 ↔ 需求」守卫断言，已在测试内注释声明。② 循环 2 的 GREEN 与第 1 条写在同一次 Write 里（`visibleEntries` 的 filter 分支提前落地）→ 按 Iron Law **回退为最小直通**（`void capabilities; return [...entries]`），确认真 RED（得 5、期望 2）后再恢复，且**刻意只写「需要能力位的才过滤」**，把 `!entry.capability` 留给循环 3 驱动。③ 循环 3（组件按能力位过滤）与循环 4（56px 宽）同样因提前写进同一 Write 而先绿 → 各自回退、各自确认 RED（6 labels / `Received ""`）后恢复。④ 循环 5（竖条 + `aria-current`）真 RED（`not.toBeNull()` Received `null`）。⑤ 循环 6（设置项也能是当前入口）是 GREEN 之后**发现 `SETTINGS_ENTRY` 未接线**才补写的独立测试，先真 RED（设置项无竖条）再接线——非事后贴测试。
      门禁：`test:unit` **748 pass / 0 fail**（T005 末 744 + 4）/ `test:components` **12 pass / 0 fail**（T005 末 6 + 6）/ `turbo typecheck` **30-30** / `bunx oxlint packages/app/src/rail` **0 命中**（4 files）。
      ⚠️ typecheck 曾**真实报错**：`entries.test.ts:20` 的 `toEqual(RAIL_ENTRIES)` 让 `readonly RailEntry[]` 撞上可变形参（TS2769）。**改的是断言**（`[...RAIL_ENTRIES]`，`toEqual` 深比较故强度不变），**没改生产类型**——`visibleEntries` 返回可变数组是刻意的（保留调用方排序余地）。
      ⚠️ 全仓 warning 总数 4901 → 4902：T005 已记录过同一现象（oxlint 12 线程输出不稳定）。本任务 4 个文件 0 命中，故**不主张**「4902 是我引入的」，只主张「我引入 0 命中」。全仓那 **1 个 error 仍是既有上游**那条（`packages/session-ui/src/v2/components/prompt-input/index.tsx:163` 八进制转义），按既定决策上报上游、不本地改。
- [x] T007 [P] [US1] [FE·换皮+新增] 实现顶栏 `topbar/`（品牌 Logo/站内信/全屏/用户下拉）：品牌部分换皮 opencode `titlebar.tsx`（v2 分支挂在 `titlebar.tsx:614` 的 `#opencode-titlebar-right` 注入点，**不改 Titlebar 主体**），站内信为新增 [FR-003] [T003] [出参：顶栏四要素渲染]
      → 产出 `packages/app/src/topbar/`：`brand.ts`（品牌名唯一读取点）+ `fullscreen.ts`（全屏切换）+ `menu.ts`（下拉项清单 + 管理员过滤）+ `topbar.tsx`（`Topbar` + `BrandMark` + `TopbarIconButton` + `UserMenu`）；测试 `brand.test.ts`（4）+ `fullscreen.test.ts`（2）+ `menu.test.ts`（4）走 `test:unit`，`topbar.test.tsx`（10）走 `test:components`，共 **20 条 / 29 expect**。另改 `packages/app/src/env.d.ts`（新增 `VITE_OPENHIVE_BRAND_NAME?`）+ `openhive-DESIGN.md`（新增 §4.4 顶栏）。
      ✅ 出参已满足：四要素各自有断言——① 品牌 = 图形标 + 「OpenHive」+「蜂巢」标签；② 站内信按钮（无未读时不带红点 / 有未读时红点带数字 + 点击回调）；③ 全屏按钮点击触发一次全屏切换；④ 用户下拉（默认收起、点头像展开、管理员多一项「用户管理」、点项回调带出 **id** 而非显示名、选中后收起）。用户区另断言首字头像 + 姓名 + 「警号: xxx」。
      **API**：`Topbar` / `TopbarProps`（`user` / `unreadCount?` / `onSelect?` / `onOpenMessages?`）/ `TopbarUser` / `BRAND_NAME` / `BRAND_BADGE` / `resolveBrandName` / `toggleFullscreen` / `FullscreenHost` / `USER_MENU_ITEMS` / `UserMenuItem` / `visibleUserMenuItems`。下拉选中沿用 T006 的「回调带 id」口径（`onSelect(id)`），与 `rail/entries.ts` 同构。
      **品牌名走配置（宪法 II）**：`resolveBrandName(import.meta.env.VITE_OPENHIVE_BRAND_NAME)`，源码只留兜底默认值；空串/纯空白也回落（CI 常见的 `VITE_X=` 场景）。**T017 只需补配置注入 + Logo 资源，不用动组件**。⚠️ `env.d.ts` 是上游文件（1 行新增），已按「加不是改」处理。
      **挂载点复核（推翻了子代理的结论，实测为准）**：`titlebar.tsx` 的 `<Switch>` 里 **v2 分支 = `:192-437`、legacy 分支 = `:438-589`**（`:437` 的 `</Match>` 与 `:438` 的 `<Match when>` 是关键分界）。`#opencode-titlebar-left`（`:562`）/ `#opencode-titlebar-center`（`:571`）**都只在 legacy 分支**，v2 分支唯一的注入点是 `TitlebarV2Right`（`:608`）里的 `#opencode-titlebar-right`（`:614`）。⚠️ 另注：`#opencode-titlebar-left` **全仓无任何代码引用**（是个上游预留的空挂载 div，但**在 legacy 分支里，新布局拿不到**）。v2 顶栏高度 = **36px**（`:43-44` `v2TitlebarHeight = 36`），不是 front 参考件的 52px。
      🔴 **未接线（本任务最大的偏离，须你裁定）**：`Topbar` **没有**挂进 `layout-new.tsx`。理由：FR-003 的用户区需要真实用户身份，而 001 当前**没有任何登录态/用户来源**（登录流程是 T008 / FR-001）；若为了「看起来接上了」而塞一个假用户对象，等于往 DOM 里放谎。挂载只是 3 行（上游已有 `useTitlebarRightMount()` + 仓库既有的 `<Show when={mount()} keyed><Portal mount={mount}>` 惯用法，先例：`pages/new-session/new-session-view.tsx:77-93`）。→ **建议把「把 `Topbar` 挂上顶栏」明确写进 T008**（T008 才有用户身份）。若你认为应当现在就挂，请说一声，我按你的口径补。
      🔴 **T017 阻断项扩展（原 T006 那条 + 新增一条）**：`BrandMark` 的描边与渐变用的是 `--v2-icon-icon-accent` / `--v2-icon-icon-accent-hover`——已核 `v2/styles/theme.css`，**这两个 token 今天都是蓝色**（`--v2-blue-600` / `--v2-blue-700`），**全 v2 色板里没有任何金色 token**。所以按宪法 §八/§九「不硬编码新 hex」，logo 现在是**蓝的**，DESIGN §5.1 要求的蜂蜜金渐变要等 T017 换皮才生效（换皮后自动变金，组件不用改）。T017 须同时处理：① 选中底色（T006 记的那条）；② 品牌金 token（本条）。
      ⚠️ **图标选型是我的裁量，需设计评审**：原生图标集**没有 `bell` / `user` / `lock` / `logout`**（已核 `packages/ui/src/components/icon.tsx` 全键表），宪法 I 又不允许往上游的 `icon.tsx` 加图标。实取：站内信 = `comment`（避开 rail 已用的 `speech-bubble`）、全屏 = `expand`。语义对不对要人看。
      ⚠️ **全屏按钮不随全屏状态切换图标**（front 参考件是 Maximize2/Minimize2 两态）：本任务只用单一 `expand` + `aria-label="全屏"`，切换态要接 `fullscreenchange` 事件——**刻意没做**（Simplicity First，FR-003 只要求「全屏」）。若产品要两态图标，请说一声。
      ⚠️ **站内信红点做成了「数字胶囊」而非纯色圆点**：DESIGN §4.4 写的是「红点 + 未读数」，本任务用 v2 的 danger 三件套 `bg-v2-state-bg-danger` + `text-v2-state-fg-danger` + `border-v2-state-border-danger`（浅红底 + 深红字 + 深红边），因为 v2 **没有**「纯色红填充」的语义 token（`--v2-avatar-bg-red` 语义是头像色，借用不当）。同时满足 DESIGN §4.3「不只靠颜色」。视觉对不对要人看。
      ⚠️ **视觉类无测试断言（L2 缺口）**：同 T006——happy-dom 无 CSS 引擎，`class` / `text-v2-*` 断言不到，测试只覆盖 DOM 结构与交互。**新增一条待真实浏览器核对的**：`BrandMark` 的渐变色用 `stop-color="var(--v2-…)"`（跟上游 `packages/ui/src/components/logo.tsx` 的 `fill="var(--icon-base)"` 同一写法），需确认 Chromium 下 SVG `stop-color` 真的吃 CSS 变量。
      ⚠️ **前端隐藏 ≠ 鉴权（宪法 IV）**：`visibleUserMenuItems` 只决定「显示哪些」，「用户管理」的授权必须在执行层；已在 `menu.ts` 与 `TopbarUser.isAdmin` 的注释里写死这条。
      ⚠️ **DESIGN.md 新增 §4.4 顶栏**：宪法 §八要求「未覆盖的，先在 DESIGN.md 补充再引用」，而 DESIGN 原本**没有任何顶栏章节**，故先补 §4.4（四要素表 + 「高度沿用原生 36px」+「颜色只引用 token，不新增 hex」+「品牌名走配置」）再写组件。**§4.4 的措辞是我的裁量，请设计侧过一眼**。
      ⚠️ **plan.md 文件结构回改待办（累加 T006 那一条）**：plan.md 只列了 `rail/entries.ts`；现在实际产出还有 `rail/rail.tsx` + `topbar/` 下 4 个源文件。**须一并回改 plan.md**（或明确声明为计划外新增）。
      TDD 诚实标注：① `menu.test.ts` 第 1 条（下拉项清单）**非 RED 驱动**，是「数据 ↔ 需求」守卫断言，已在测试内注释声明（同 T006 的做法）。② 循环 1/2/3（`fullscreen` / `brand` / `menu`）均以「模块不存在」起步——这是本仓新文件的标准 RED 形态，失败原因是功能缺失而非拼写。③ 顶栏组件的 RED 分 5 次拿到：品牌位、站内信（两条一起写、一起 RED）、全屏（`Expected ["enter"] / Received []`）、用户区（`Received: undefined`）、下拉 4 条（`菜单项 helper 抛「下拉里没有…」`）——每条都真 RED 后才写实现。④ REFACTOR 把用户区抽成 `UserMenu`（自带展开态）后重跑仍全绿。
      ⚠️ typecheck 曾**真实报错**：去掉 `as unknown as Document` 断言、把 `toggleFullscreen` 的参数收紧为结构类型 `FullscreenHost` 后，测试假对象的 `fullscreenElement: {}` 不再满足 `Element | null`（TS2345 ×2）。**修的是测试假对象**（改用 `document.createElement("div")`），**没放宽生产类型**——参数反而从 `Document` 收窄了，是更强的约束。
      门禁：`test:unit` **758 pass / 0 fail**（T006 末 748 + 10）/ `test:components` **22 pass / 0 fail**（T006 末 12 + 10）/ `turbo typecheck` **30-30** / `bunx oxlint packages/app/src/topbar` **0 命中**（8 files，初次有 2 条 warning——`no-unsafe-type-assertion` + `unbound-method`——均已按上一条修掉）。
      ⚠️ 全仓 `bun run lint` 仍**退出码 1**：**4902 warnings + 1 error**（与 T006 末一致）。已单独复核那 1 个 error 的归属文件 `packages/session-ui/src/v2/components/prompt-input/index.tsx`（该文件自带 13 warnings + 那 1 error），即**既有的上游问题**，按既定决策上报上游、不本地改（宪法 I）。我的 8 个文件 0 命中。
- [ ] T008 [US1] [INT] 接入登录后进入三栏工作台的入口流程 [FR-001] [T003] [出参：登录后默认落在三栏工作台]
      🆕 **本任务追加产出（由 T007 移交）**：把 `Topbar` 挂到 `#opencode-titlebar-right`（上游已有 `useTitlebarRightMount()`，Portal 惯用法见 `pages/new-session/new-session-view.tsx:77-93`），并把登录后拿到的用户身份（姓名 / 警号 / 是否管理员）喂给它。

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
