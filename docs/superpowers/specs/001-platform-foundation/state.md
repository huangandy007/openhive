# 实施进度 · 平台底座（三栏工作台）

## 当前任务
T009 已完成。**T010 待启动**（等用户说「next」）。
✅ T009 交付 `center/tab-bar.tsx` + `center/module-color.ts` + `center/tab-overflow.ts`。**未挂载**——挂进三栏 + tab-store 响应式化 + 模块切换联动（FR-006）留给 T010。
📌 T008 遗留的**计划缺口仍在**（非任何任务引入）：**右栏（AI 会话）没有任何任务供给**——详见「待决项」。

## 已完成
- **T001** [FE·换皮] 定位三栏真实组件 → 产出 `refactor-targets.md`
  - 三栏真实组件已定位，但 **rail / 左栏全在 legacy 布局**（`pages/layout.tsx` + `pages/layout/sidebar-shell.tsx`）
  - **legacy 已被上游退休（死代码）**：`settings.tsx:63` `oldInterfaceSunset = new Date(2026, 8, 14)` 已过 → `:251` `oldInterfaceRetired = true` → `:129` `resolveNewLayoutDesigns` 无条件返回 `true`
  - 运行时恒走 new 布局 `pages/layout-new.tsx`（仅 49 行：Titlebar + 单个 `<main>`，**无 rail、无左栏、无 tab 容器**）
  - 右栏 `SessionSidePanel` 在 new 布局存活，但职责是「文件树 + review」，非 AI 会话
  - 顶栏 `titlebar.tsx:614` 在 v2 分支**有现成注入点** `#opencode-titlebar-right`（站内信可挂）
  - 换皮靶子须由 legacy `--xxx` 改为 `--v2-*`（`packages/ui/src/v2/styles/theme.css`）
- **T002** [FE·新增] 建 `packages/app/src/{rail,center,topbar,workspace}/` 目录骨架
  - 4 目录各含空 `.gitkeep`（git 不跟踪空目录，故需占位文件；仓库原无 `.gitkeep` 先例）
  - 不变量测试 `packages/app/src/openhive-module-dirs.test.ts`（RED→GREEN，4 expect）——下游 002–010 按这些路径 import，误删/改名为静默破坏
  - **未写任何投机性 stub**：`rail/entries.ts`、`center/*`、`topbar/*`、`workspace/three-pane.tsx` 分别由 T006/T004/T005/T007/T003 交付（Simplicity First）
- **T003** [FE·新增] 三栏容器 `packages/app/src/workspace/three-pane.tsx` + 挂载 `layout-new.tsx:43`
  - 槽位式 API：`left` / `children` / `right` + `leftCollapsed` / `rightCollapsed`；**槽位不传则该栏与其手柄一起不渲染** → 挂载对既有布局零影响
  - 宽度按 DESIGN.md §4.1：左 280px（夹 160px~视口50%）、右 360px（夹 240px~视口2/3）；复用上游 `@opencode-ai/ui/resize-handle`（未改上游组件）
  - 中栏原样复刻挂载点 `<main>` 的 flex 上下文（`flex flex-col items-start`）——子路由此前直接挂在其下，换上下文会让既有页面布局静默改变
  - 6 个组件测试（`three-pane.test.tsx`，19 expect）**全部 RED 先行**：骨架/宽度 → 槽位缺省 → 左拖拽夹取 → 右拖拽反向符号+另一组夹取 → 折叠。REFACTOR 把夹取函数提为 `*_MIN` 常量 + `*Max()` thunk
  - ⚠️ **诚实标注**：其中「槽位内容各归其位」1 条是**事后补的测试强度断言**（前几条只验栏存在与宽度，若左右接线互换仍会全绿），非 RED 驱动，已在测试文件内注释声明
  - ⚠️ 出参「登录后渲染三栏骨架」为**结构性满足**：容器已入渲染树，但左右槽位暂空（T006/T007/T009 供货），此刻**看不到三栏**——任务切分的预期中间态
- **T003 附带：前端组件测试地基（本包此前为 0）**
  - 症状链：`packages/app` 原有 **0 个 `.test.tsx`**；`--conditions=solid` → `solid-js/web` 解析到 `dist/server.js`（"Client-only API called on the server side"）；改 `--conditions=browser` → 本包 `tsconfig` `"jsx": "preserve"` 使 Bun 退化成 `React.createElement`（"React is not defined"）；`solid-js/jsx-runtime` 不导出 `jsx`/`jsxs`/`Fragment`
  - 解法：**复用仓库既有范式**——照 `packages/tui` 的 `@opentui/solid/preload`，新建本包自有 preload `packages/app/solid-jsx.ts`（`Bun.plugin` + `babel-preset-solid` generate:"dom" + `@babel/preset-typescript`，只拦 `.tsx`/`.jsx`，`.ts` 仍走 Bun 原生）
  - 新增脚本 `test:components`；3 个 devDep（`@babel/core` / `@babel/preset-typescript` / `babel-preset-solid`）**均已在 `bun.lock` 中，无新增下载**；`bun.lock` 仅手加 3 行
  - ⚠️ **`test:unit` 必须加 `--path-ignore-patterns="**/*.test.tsx"`**：否则会扫进 `.tsx` 测试且在 `--conditions=solid` 下报 React 未定义（实测 6 fail）。`--conditions=browser` 也不能并进 `test:unit`——`src/context/server-session.test.ts` 等 3 条依赖 `solid` 条件的 store 代理语义

- **T004** [FE·新增] 视图注册表 `packages/app/src/center/view-registry.ts` + 8 个单测（17 expect）
  - API：`createViewRegistry()` → `{ register, resolve }`；外加 `extensionOf(path)`。`register`/`resolve` 说**扩展名**，`extensionOf` 说**路径**，调用方组合，两侧无歧义
  - **自定契约**：`ViewProps = { path: string }`（plan/spec 未定义视图入参，T012–T015 依赖此类型；故意留最小，加宽向后兼容）
  - `extensionOf` 对齐 `path.extname` 语义（纯 dotfile 无扩展名；`/` 与 `\` 都当分隔符）。**不用 `node:path`**——`packages/app` 是浏览器包，出厂代码从无 node 内建先例；仓库前端惯用法是纯字符串切分（`packages/web/src/components/share/part.tsx:329`）
  - **两个行为决策（未经指示）**：① 重复注册同一扩展名 → **抛错**（非静默覆盖；FR-008 面向插件作者，静默覆盖是无声破坏）；② 同批注册中途冲突 → **整批不生效**（先全量校验再落库）
  - ⚠️ **未导出应用级单例**（Simplicity First，此刻无消费者）→ T009/T012 落首个真实视图时须决定共享实例归属
  - ⚠️ **待决（T011/T016 前）**：plan.md「数据流向」把两条轴都汇入注册表，但本表按扩展名索引，而「数据明细 / 可视化图表 / 分析记录」无扩展名 → 数据轴无法经此路由
  - TDD 诚实标注：循环 1 提前写了多扩展名 for 循环（无失败测试）→ 已删除并由循环 2 驱动回来
  - 8 条循环：① 注册后可查 ② 一视图认领多扩展名 ③ 查找不区分大小写 ④ 注册侧大小写等价 ⑤ 重复注册抛错 ⑥ 中途冲突整批不生效 ⑦ 路径取扩展名 ⑧ 取不到（dotfile / 结尾点 / 空串）

- **T005** [P] [FE·新增] 中栏共享 tab 状态 `packages/app/src/center/tab-store.ts` + 11 个单测（22 expect）
  - API（**纯 reducer，照 `context/layout-tabs.ts` 范式**——不引入 Solid store/signal；响应式 provider 留 T009/T011，同 T004 的「此刻无消费者」理由）：`openContentTab` / `activateContentTab` / `closeContentTab` / `switchModule` + `contentTabKey`
  - **tab 身份 = 来源模块 + `\n` + 路径**：来源模块是身份的一部分，故同一文件在两个模块里打开算两张 tab（FR-005 按模块着色，否则同内容两色冲突）。分隔符取 `\n` 不是 `:`——路径里含 `:`（`C:\…`）
  - 关闭语义沿用 `layout-tabs.ts`：关激活项 → 优先左邻居，无左邻居取右邻居；关最后一张 → `active` 清空。关**非**激活项 → 激活态不动
  - ⚠️ **`ContentTab.module`（tab 的*来源*模块）与 `CenterTabState.module`（当前*停留*的模块）同名而义不同**——已在这两处类型注释里拉开对比，是 T009/T010 最易踩的坑
  - TDD 诚实标注：循环 7 的 GREEN 里顺手写了「关非激活项不动激活态」的守卫（当时无失败测试）→ **已按 Iron Law 删除**，由循环 9 驱动回来。另循环 6「跨模块累积」非 RED 驱动，是强度断言（测试内已注释声明）
  - 11 条循环：① 打开追加并激活 ② 重复打开不增张只激活 ③ 同文件异模块算两张 ④ 切模块 100% 保留 tab 与激活态 ⑤ 打开不动工作上下文 ⑥ 跨模块累积（强度断言）⑦ 关激活项退左邻居 ⑧ 关第一张退右邻居 ⑨ 关非激活项激活态不动 ⑩ 关最后一张激活态清空 ⑪ 点击已有 tab 切过去且不重排

- **T006** [P] [FE·新增] 图标栏 `packages/app/src/rail/`：`entries.ts` + `rail.tsx` + 10 个测试（15 expect）
  - **capability 契约（用户决策：001 只出接口，不接签发方）**：入口声明所需 `capability`；`visibleEntries(entries, capabilities?)` 中 `capabilities` **省略 = 未接签发方 → 不过滤**，**传入（含空集）= 已由签发方定夺 → 只留有能力的**；无 `capability` 的入口（系统设置）恒留。`Rail` 对应 `capabilities?` prop。**真正的鉴权仍在下游执行层**（宪法 IV：前端隐藏不替代校验）
  - API：`RailEntry` / `RAIL_ENTRIES` / `SETTINGS_ENTRY` / `visibleEntries` / `Rail` / `RAIL_WIDTH`。`Rail` **不持有选中态**，`active` 外部传入（选择态归 T010 的模块切换）
  - **视觉来源**：`front/src/components/LeftIconBar.tsx`（**仅视觉参考，未移植一行 React**）+ DESIGN.md §4.1/§4.3。容器白底 + 右侧分隔线、40px 方形按钮（`rounded-xl`）、选中态浅金底 + 左侧金色竖条（`absolute left-0 top-2 bottom-2 w-1 rounded-r-full`）、设置项细分隔线隔开吸底
  - 6 条组件循环：① 五入口 + 设置全渲染 ② 点击回调带出 **id**（非显示名）③ 按能力位过滤 ④ 宽 56px ⑤ 当前入口带竖条 + `aria-current="page"`、其余都没有 ⑥ 设置项也能是当前入口
  - ⚠️ **`rail.tsx` 超出 plan.md:61-62 的「文件结构」清单**（只列了 `entries.ts`）——须回改 plan.md 或明确声明为计划外新增（见待决项）
  - ⚠️ **图标选型为我的裁量，需设计评审**：DESIGN §4.2 只说「单色线性图标」未点名，实取 `folder` / `archive` / `speech-bubble` / `bullet-list` / `branch` / `settings-gear`。类型受 `IconProps["name"]` 约束故不会编出不存在的图标，但**语义对不对要人看**
  - 🔴 **DESIGN 与 token 的真实冲突（T017 阻断项）**：DESIGN §1.3/§4.1 要求选中底 = **浅金 `#FEF3C7`**，但 v2 overlay 语义 token **只有中性黑/白 alpha**，**不存在品牌色 overlay token**。现取仓库既有「选中面」token `--v2-overlay-simple-overlay-pressed`（先例 `file-tree-v2.css:38-41`）——语义正确但**值是中性灰，≠ 浅金**。宪法 §八禁硬编码 `#FEF3C7`，宪法 I 令 `theme.css` 归 T017 → **必须由 T017 收口**
  - ⚠️ **视觉类零断言（L2 缺口）**：happy-dom 无 CSS 引擎，`classList` / `text-v2-*` 全部断言不到，测试只覆盖 DOM 结构（`data-slot` / `aria-*` / 内联 `style.width`）。颜色/间距/圆角须 T017 真实浏览器核对
  - ⚠️ **上游遗留观察（未本地修）**：`packages/ui/src/components/icon.css` 给图标自身设 `color: var(--icon-base)`，理论上会盖住父级 `text-v2-icon-icon-muted`。沿用仓库先例（`dialog-connect-provider.tsx:135` 在父按钮放 `text-v2-*`），未改上游 CSS。T017 须确认图标颜色是否真生效；若被覆盖属上游问题 → 上报
  - TDD 诚实标注：① `entries.test.ts` 第 1 条（五入口清单）非 RED 驱动，是需求守卫断言（测试内已注释）② 循环 2 的 filter 分支与第 1 条写在同一次 Write（提前落地）→ **回退为最小直通**确认真 RED（得 5、期望 2）后恢复，且刻意只写「需要能力位的才过滤」把 `!entry.capability` 留给循环 3 ③ 循环 3/4 同样提前写进同一 Write → 各自回退、各自确认 RED（6 labels / `Received ""`）后恢复 ④ 循环 5 真 RED（`not.toBeNull()` Received `null`）⑤ 循环 6 是 GREEN 后发现 `SETTINGS_ENTRY` 未接线**才补写的独立测试**，先真 RED 再接线


- **T007** [P] [FE·换皮+新增] 顶栏 `packages/app/src/topbar/`：`brand.ts` + `fullscreen.ts` + `menu.ts` + `topbar.tsx` + 20 个测试（29 expect）
  - **品牌名走配置**（宪法 II）：`resolveBrandName(import.meta.env.VITE_OPENHIVE_BRAND_NAME)`，源码只留兜底默认值；空串/纯空白也回落（CI 的 `VITE_X=` 场景）。**T017 只需补配置注入 + Logo 资源，不用动组件**
  - **挂载点复核（推翻了子代理结论，以实测为准）**：`titlebar.tsx` 的 `<Switch>` 中 **v2 分支 = `:192-437`、legacy 分支 = `:438-589`**。`#opencode-titlebar-left`（`:562`）/ `#opencode-titlebar-center`（`:571`）**都只在 legacy 分支**；v2 唯一注入点是 `TitlebarV2Right`（`:608`）里的 `#opencode-titlebar-right`（`:614`）。v2 顶栏高 **36px**（`:43-44`），非 front 的 52px
  - **DESIGN.md 新增 §4.4 顶栏**：宪法 §八要求「未覆盖的，先在 DESIGN.md 补充再引用」，而 DESIGN 原本**无顶栏章节**。§4.4 记四要素 + 「高度沿用原生 36px」+「颜色只引用 token，不新增 hex」+「品牌名走配置」
  - 5 条组件循环（品牌位 / 站内信含未读数 / 全屏 / 用户区 / 下拉 4 条）+ 3 条纯函数循环（`fullscreen` / `brand` / `menu`）。REFACTOR 把用户区抽成 `UserMenu`（自带展开态）后重跑全绿
  - 🔴 **未接线（本任务最大偏离）**：`Topbar` **没有**挂进 `layout-new.tsx`。FR-003 的用户区需真实身份，而 001 当前**无任何登录态来源**（登录是 T008/FR-001）；塞假用户等于往 DOM 里放谎。挂载仅 3 行（上游 `useTitlebarRightMount()` + `<Portal mount>` 惯用法，先例 `new-session-view.tsx:77-93`）→ **已移交 T008**（tasks.md T008 条目下已写明）
  - ⚠️ **图标选型（与 T006 同源问题）**：原生图标集**无 `bell`/`user`/`lock`/`logout`**；宪法 I 不许往上游 `icon.tsx` 加图标 → 站内信取 `comment`（避开 rail 的 `speech-bubble`）、全屏取 `expand`
  - ⚠️ **全屏按钮不随状态切图标**：只用单一 `expand`，接 `fullscreenchange` 做两态**刻意没做**（Simplicity First；FR-003 只要求「全屏」）
  - ⚠️ **站内信红点做成「数字胶囊」**：v2 无「纯色红填充」语义 token（`--v2-avatar-bg-red` 语义是头像色），改用 danger 三件套 `bg/fg/border-v2-state-*-danger`；同时满足 §4.3「不只靠颜色」
  - ⚠️ **视觉类零断言（L2 缺口）**：同 T006。**T017 新增待核对项**——`BrandMark` 渐变用 `stop-color="var(--v2-…)"`（同上游 `logo.tsx` 的 `fill="var(--icon-base)"` 写法），需确认 Chromium 下 SVG `stop-color` 真吃 CSS 变量
  - TDD 诚实标注：① `menu.test.ts` 第 1 条（下拉项清单）非 RED 驱动，是需求守卫断言（测试内注释声明，同 T006）② 三条纯函数循环以「模块不存在」起步（本仓新文件的标准 RED 形态）③ 组件 RED 分 5 次拿到，每条都先真 RED（`Expected ["enter"] / Received []`、`Received: undefined`、helper 抛错）④ 去掉 `as unknown as Document` 断言后 typecheck 报 TS2345 ×2 → **修的是测试假对象**，生产参数反而从 `Document` 收窄为结构类型 `FullscreenHost`（更强约束）

- **T008** [INT] 入口接线 `packages/app/src/workspace/workspace-entry.tsx` + `current-user.ts` + 7 个组件测试（13 expect）
  - **产出**：新增 `workspace/workspace-entry.tsx`（入口组件：图标栏 → 三栏，顶栏另挂注入点）+ `workspace/current-user.ts`（身份接入缝）+ `workspace-entry.test.tsx`；改 3 个既有文件——`topbar/topbar.tsx`（`user` 改可选 + `<Show>` 包住用户区）、`pages/layout-new.tsx`（**3 行**：import ×2 + `const titlebarRight = useTitlebarRightMount()` + `<ThreePane>` → `<WorkspaceEntry titlebarRight={titlebarRight}>`）
  - **出参拆解**：「**落在三栏工作台**」= 实质达成（入口把图标栏 + 三栏 + 顶栏一起接线，默认停在图标栏第一个入口「项目管理」）；「**登录后**」= **001 无登录**（属 F2/002-auth-account：网关验签注入 `X-User-ID`），本任务**不改这一点**，改为建立身份接入缝
  - **新增布局事实**：new 布局本就是默认（`settings.tsx:61` `newLayoutDesignsDefault = true`，且 `oldInterfaceSunset` 已过 → `oldInterfaceRetired` 恒真）→ 「默认落在」在路由层面**无需改动**，缺的只是接线
  - **身份接入缝**：`current-user.ts` 导出 `[currentUser, setCurrentUser]`；身份未就位时顶栏**不渲染用户区**（品牌/站内信/全屏与身份无关，照常渲染）。**宁缺勿假**：塞占位用户 = 把假身份放进 DOM，F2 接真身份时没人分得清
  - **三个设计决策**：① **图标栏是三栏之外的独立一列**（DESIGN §4.1：图标栏 56px → 左项目侧栏 280px → 中 → 右），**不进 `ThreePane.left`**（那是左项目侧栏，归 T010）→ 需外层行容器（挂载点 `<main>` 是 `flex-col items-start`，直接并列会上下堆叠）。② **当前停留模块的状态由本组件持有**（T006 记的「选择态归 T010」需修正为「T008 落地、T010 在其上加联动」——T008 是第一个真正挂上图标栏的任务，状态必须落在某处；T010 别再另起一套）。③ **顶栏挂载点由调用方注入**（`titlebarRight` 访问器）而非组件内调 `useTitlebarRightMount()`：后者要 `useLanguage()` 上下文，会把组件测试拖进 provider 组装；注入后测试可造假挂载点，**完整验证 Portal 落点**
  - 🔴 **计划缺口（本任务发现，非我引入）**：**右栏（AI 会话）没有任何任务供给**。FR-001 要求「右栏 AI 会话」，T003 备注写「右栏由 T007/T009 供给」——**实为错记**：T007 是顶栏、T009 是中栏 tab 栏，两者都不填右栏；T001–T017 无「把 `SessionSidePanel` 换皮搬进右栏」的任务（plan.md ① 把它列为「换皮 + 重定职责」却未派生 task）。**建议补一个任务**，否则收尾时 FR-001 仍只是「结构性满足、看不到右栏」
  - ⚠️ **`#opencode-titlebar-right` 是共享注入点**：上游已有 `new-session-view.tsx:77-93`（`NewSessionStatus`）与 `session-header.tsx:285` 往同一元素 Portal。挂上后 openhive 顶栏与上游会话状态**并列出现在同一顶栏右侧**——T017 浏览器核对须看是否拥挤/重叠，必要时定归属与顺序
  - ⚠️ **未接线的数据（不编造）**：`capabilities` 不传（001 无 capability 签发方）→ 五入口恒可见；`unreadCount` / `onSelect` / `onOpenMessages` 均无数据源，故未接
  - ⚠️ **系统设置入口按统一实现**（点它也会高亮为当前模块）；是否改为「打开设置对话框」由 T010 定（T006 已记同一项）
  - ⚠️ **视觉类零断言（L2 缺口，同 T006/T007）**：happy-dom 无 CSS 引擎，断言只到 DOM 结构（`data-component` / `aria-current` / DOM 顺序）。**新增两条待浏览器核对**：① 外层行容器与 `ThreePane`（`flex-1 … w-full flex`）的嵌套；② 图标栏 `h-full` 在 `<main>`（`flex-col items-start`）下的实际高度
  - TDD 诚实标注：① RED 形态 = `Cannot find module './current-user'`（本仓新文件的标准形态，失败因功能缺失而非拼写）② 7 条测试在同一文件，整文件因模块缺失先失败，GREEN 后全绿（未逐个制造 7 次 RED——本任务的一体性使然，如实记录）③ **`TopbarProps.user` 改为可选是测试驱动出来的**（第 6 条「身份未就位不给用户区」逼出类型放宽），非为宽松而放宽；T007 的 10 条组件测试**未改一行仍全绿**（它们都传 `user`），佐证放宽向后兼容 ④ 无「先写实现后补测试」

- **T009** [US2] [FE·新增] 中栏 tab 栏 `packages/app/src/center/`：`module-color.ts` + `tab-overflow.ts` + `tab-bar.tsx` + 3 个测试文件（11 单测 / 8 组件测试）
  - **交付**：`moduleColorVar(moduleId)`（模块 → 身份色**变量名**，非色值）+ `splitTabOverflow(count, available, {tabWidth, overflowWidth})`（溢出判定纯函数）+ `TabBar({ tabs, active?, onActivate, onClose, availableWidth? })` + `TAB_HEIGHT = 40`。**未挂载**（挂进三栏 / tab-store 响应式化 / FR-006 联动 → T010）
  - 🔴 **MUST 级冲突的裁定（本任务核心）**：FR-005「中栏 tab MUST 按来源模块着色标识」vs DESIGN §4.2 + 附录#3「**无模块徽章**」。依宪法 §八（视觉以 DESIGN 为准；未覆盖的**先在 DESIGN.md 补充再引用**）——两者**不真冲突**：「着色」≠「徽章」。裁定 **不做文字胶囊（合 §4.2）**，模块身份落在 tab 的**模块图标**上（形状 + 颜色双通道，合 §4.3）。据此**先补 `openhive-DESIGN.md` §4.5**（分工表 + tab 规范表 + 模块→色表），并改掉 §1.3 自相矛盾的那行为「话单**模块色**」。**代码写在 §4.5 落地之后**，非事后补文档
  - ⚠️ **设计系统无「模块色板」**：Tailwind 只映射 51 个 `--color-v2-*` 且无 avatar；唯一多色相族 `state-*` 语义是「状态」非「实体身份」。故复用 **`--v2-avatar-bg-*`**（`ProjectAvatar` 同源的稳定色轮转）+ 默认档灰兜底，**不新增 hex/token**（宪法 §八）。⚠️ **取值待设计侧复核**（仅「话单=蓝」有 §1.3 依据，其余五个是我按可区分性裁量）；改色只动 §4.5 表 + `module-color.ts` 一处
  - ⚠️ **激活态故意不写 `#D97706`**：品牌金 token 至今不存在（见「待决项」②），顶边条取既有 `bg-v2-background-bg-accent`（T006 图标栏竖条同一取值），T017 换皮即自动变金。**不自造 hex**
  - 💡 **回答了 T006 的遗留疑问（`Icon` 着色机理）**：`icon.css:8` 给 `[data-component="icon"]` 显式 `color: var(--icon-base)`，legacy `theme.css:243` 又在 `:root` 全局定义 `--icon-base` → **父级 `text-v2-icon-*` 不会给 `Icon` 上色**，必须由**祖先元素提供 `--icon-base`**（自定义属性继承）。故 tab 身份色由 `data-slot="tab-icon"` wrapper 以 inline `--icon-base: var(--v2-avatar-bg-*)` 提供。**此条对 T017 视觉核对及后续任何 Icon 着色都适用**
  - ⚠️ **溢出判定不照抄上游**：上游 `titlebar-tab-strip.tsx` 用 `scrollWidth > clientWidth` 量 DOM，happy-dom 无 CSS 引擎、两者恒为 0（永远判「放得下」）。故抽成纯函数可单测，组件以 `availableWidth?` 作注入缝（沿用 T008 给顶栏留 `titlebarRight` 的范式），省略时才自量（guarded `ResizeObserver`）
  - ⚠️ **「⋯」用字面字形 U+22EF**：原生图标集 97 个名字里**无** `ellipsis` / `more-horizontal` / `dots`（已核）；宪法 I 不许往上游 `icon.tsx` 加图标
  - ⚠️ **视觉类零断言（L2 缺口，同 T006/T007）**：happy-dom 无 CSS 引擎，断言只到 DOM 结构（`data-slot` / `data-module` / `aria-selected` / 内联 `style`）。**T017 新增待核对**：① 顶边条 `h-0.5` 在 40px tab 上的实际观感；② 身份色作为 `--icon-base` 是否真染到 svg；③ 溢出菜单的层级/遮挡
  - TDD 诚实标注：① RED 形态均为 `Cannot find module './xxx'`（本仓新文件的标准形态）② `module-color.ts` 走了**两个真循环**——循环 1 的 GREEN **刻意不写兜底**，循环 2「未知模块兜底灰」才拿到真 RED（received `undefined`）③ `module-color.test.ts` 末 2 条（话单=蓝、色值形态一律 `--v2-avatar-bg-*`）是**在测试内声明为非 RED 驱动**的守卫断言，**不谎称它们抓过 bug** ④ 8 条组件测试同处一文件，整文件先失败、GREEN 后全绿——**未逐个制造 8 次 RED**，如实记录 ⑤ 无「先写实现后补测试」
  - ⚠️ **首轮 typecheck 失败 1 处（已修）**：`Icon` 的 `name` 是枚举联合而非 `string` → 改用 `IconProps["name"]` 收口（同 `RailEntry.icon` 的既有做法）。**未放宽上游类型**
  - ⚠️ **首轮 oxlint 4 条（已修）**：全是 `tab-bar.test.tsx` 的 `TABS[n]!`（`no-unnecessary-type-assertion`）——本仓 `tsconfig` 未开 `noUncheckedIndexedAccess`，故 `!` 多余，已删

## 阻塞项
**无。** 原阻塞（「三栏建在哪套布局」）已决策：

| 方案 | 说明 | 结果 |
|---|---|---|
| **A. 建在 new 布局** | 在 `layout-new.tsx:41` 的 `<main>` 上下游新增三栏骨架；换皮对 `--v2-*` | ✅ **已采纳**（合宪法 I/V） |
| B. 改回 legacy 布局 | 改 `newLayoutDesigns` 判定逻辑，换皮 legacy 三栏 | ⛔ 违反宪法 I/V，且 legacy 将被上游删除 |
| C. 双轨 | 两套都做 | ⛔ 不推荐 |

决策后已按宪法 §六完成**同步修订**（`refactor-targets.md` §6 清单 1–4 全部 ✅）：
- `plan.md`：修订记录 + Summary + 文件结构 + 换皮区 ①② 表 + ④ 汇总 + R4/R5/R6 + 宪法 Check V
- `spec.md`：修订记录 + FR-001…010 承载物标注 + Assumptions
- `tasks.md`：修订记录 + T003/T006 换皮→新增 + T007/T009/T017 落点
- `refactor-targets.md` §4 标注不适用、§6 标注已决策

## 质量门禁（T009 末）
> 工作基点：`multi-tenant` @ `028d019ef1`（`packages/app` v1.18.29）。

| 门禁 | 结果 | 归因 |
|---|---|---|
| `packages/app` `bun run test:unit` | ✅ **769 pass / 0 fail**（112 files / 3102 expect） | 干净（T008 末 758 + 11 = `module-color` 4 + `tab-overflow` 7） |
| `packages/app` `bun run test:components` | ✅ **37 pass / 0 fail**（81 expect） | 干净（T008 末 29 + 8） |
| `packages/app` `bun run test:browser` | ✅ **41 pass / 0 fail** | 干净（与 T003 基线**一致**；本任务未动渲染树，复跑确认零回归） |
| `bun run typecheck`（turbo，根目录） | ✅ **30 successful / 30 total** | 首轮**真实报错 1 处已修**（`Icon` 的 `name` 是枚举联合 → 改用 `IconProps["name"]`） |
| `bun run lint`（oxlint，根目录） | ❌ **exit 1**：4902 warnings / **1 error** | **既有上游、已决策记为「已知红」**，见下 |

**T009 触碰文件 lint 自查**：`bunx oxlint packages/app/src/center packages/app/src/rail` → **0 warning / 0 error**（14 files）。首轮曾报 **4 条** `no-unnecessary-type-assertion`，全在 `tab-bar.test.tsx` 的 `TABS[n]!`——本仓 `tsconfig` **未开** `noUncheckedIndexedAccess`，故 `!` 属多余，已删。改的是**测试里的多余断言**，未动生产类型。

> ⚠️ **typecheck 修了什么**：`tab-bar.tsx` 的 `MODULE_ICONS: Record<string, string>` 把图标名喂给 `<Icon name>` 报 `TS2322`（`string` 不可赋给 97 个名字的联合）。**改的是新代码自己的类型** → `Record<string, IconProps["name"]>`（同 `RailEntry.icon` 的既有做法），**没放宽上游 `Icon` 的类型**（放宽会掩盖「编出不存在的图标」这类真错）。

> ⚠️ **warning 计数诚实标注**：T005 末记 4901，T006/T007/**T008/T009 末均为 4902**（本次未变）。T005 已记录过同一抖动现象（oxlint 12 线程输出计数不稳定）。本任务 6 个文件在 lint 输出中 **0 命中**，故**只主张「我引入 0 命中」，不主张「4902 与我无关」**——该总计数曾出现 ±1 抖动而代码面无从属关系，**归因不明**，如实记为「未解释的抖动」。

### 唯一仍在红的门禁：lint 的 1 个 error（已知，待上报上游）
上游 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163` 的 `content-['\200B']`（Tailwind 类里的八进制转义）。该文件与基点**逐字节相同**，跨平台真实存在（非 Windows 特有）。修它需改上游文件 → 违反宪法 I（最小化合并冲突），**决策：不在本项目内私改，记为已知红，上报上游**。本次新增文件在 lint 输出中 **0 命中**；warning 明细全部落在既有文件上（本任务 4 文件 0 命中），但**总计数有 ±1 抖动、归因不明**，见上。

### 已解决：typecheck 门禁（Windows 符号链接检出问题）
**根因**：`git ls-files -s` 显示仓库有 **60 个 symlink 条目（mode 120000）**；本机 `core.symlinks=false`（Windows 默认）→ git 把它们检出为**内容为路径文本的普通文件**。其中 `packages/app/src/custom-elements.d.ts` 与 `packages/enterprise/src/custom-elements.d.ts` 被 tsgo 当 TS 解析 → `TS1128`。**主仓库同样如此**（非 worktree 造成）。

**修复**（用户已授权，2026-09-27）：
1. `git config core.symlinks true`（**仓库本地配置，不进版本库**；worktree 与主 checkout 共享此配置）
2. 删除这 60 个伪符号链接文件 → `git checkout -- .` 重新物化 → 全部变为真 symlink（`lrwxrwxrwx`），工作区回到 clean（60 个 `T` typechange 全部消除）
3. 验证：`packages/app` typecheck 通过 → 全量 typecheck 30/30 → 测试仍 725 pass / 0 fail

> ⚠️ 本机**新建的 worktree / 新克隆**仍需各自 `git config core.symlinks true` 后重新检出，否则同一问题复现。
> 📌 附带收益：`packages/app/public/favicon.svg`、`favicon-v3.svg`、`favicon.ico` 等**品牌资产**（symlink → `packages/ui/src/assets/favicon/`）现已可正常读取——**这是 T017 换 Logo 的落点**。

## 环境备忘
- worktree：`.claude/worktrees/feat-001-platform-foundation`，分支 `worktree-feat-001-platform-foundation`
- ⚠️ **本机需 `git config core.symlinks true`**（已设）：仓库含 60 个 symlink 资产，Windows 默认 false 会检出成路径文本。新克隆/worktree 须重设并重新检出（详见「质量门禁」）。
- ⚠️ worktree 创建时默认基点取的是 `origin/dev` 尖端（v1.18.18），**已 `git reset --hard multi-tenant` 对齐**；后续重建 worktree 需注意 `worktree.baseRef` 未设（默认 `fresh`），应显式从 `multi-tenant` 切出
- `bun install` 后 `tree-sitter-powershell` 原生构建失败（node-gyp），**主仓库同样如此，属既有问题**，不影响 `packages/app` 测试与 typecheck
- ⚠️ **本机 `bun install` 会污染 `bun.lock`**：它把每个包的空 registry 字段改写成本机 `https://registry.npmmirror.com/...` 显式地址（纯 churn，3201 行）。**每次 `bun install` 后须 `git checkout -- bun.lock` 回退**，否则会把本机镜像源配置提交进仓库
- 🆕 **前端组件测试入口**（T003 起）：`packages/app/solid-jsx.ts`（本包自有 Solid JSX preload）+ `package.json` 脚本 `test:components`。改任何 `packages/app` 的 `.tsx` 组件/测试后，跑 **`bun run test:components`**；`.tsx` 测试**不能**并进 `test:unit`（`--conditions=solid` 下会报 React 未定义）。
- 🆕 `.tsx` 测试的 glob 坑：带引号的 `"./src/**/*.test.tsx"` 会被 bun 当**过滤器**（"Test filter had no matches"）；必须**不加引号**写成 `./src/**/*.test.tsx`，由 shell 展开 globstar 才能匹配任意深度（已用探针文件实测）。
- ✅ **已解决（原「T006 前须定：能力位 / `is_admin` 契约口径」）**：用户 2026-09-27 裁定**「001 只出接口，门禁留给 010」**。T006 已按此落 `visibleEntries` 过滤接口（不接签发方）；同源问题（FR-003「用户管理」管理员专属 vs 001 无 admin 门禁）同样留待 010。**归属更正**：原记录写成「T006 前须定」有误——该项实属 FR-003 → **T007（顶栏下拉）**，非 FR-002 → T006（图标栏）；T006 只需出过滤接口，已具备。**T007 已按此落地**：`menu.ts` 的 `visibleUserMenuItems(entries, isAdmin)` 只做界面收敛（`TopbarUser.isAdmin` 控制「用户管理」显隐），并在源码注释里写死「这不是鉴权，授权在执行层」（宪法 IV）。
- 🔴 **待决项（T017 前须定 / T017 阻断项，T007 后已扩为两条）**：
  1. **选中底色的品牌色 token 不存在**。DESIGN §1.3/§4.1 要求选中底 = 浅金 `#FEF3C7`，但 v2 的 overlay 语义 token 只有中性黑/白 alpha，**无品牌色 overlay token**；T006 暂用 `--v2-overlay-simple-overlay-pressed`（中性灰，仓库既有「选中面」token）。**T017 须二选一**：① 全局重定 `overlay-pressed` 为品牌色；② 新增语义选中面 token（并**同改 `:root` 与 `[data-color-scheme="light"]` 两处**）。否则正式违反 DESIGN §4.1。
  2. 🆕 **品牌金 token 不存在（T007 新增）**。`topbar/BrandMark` 的描边/渐变取 `--v2-icon-icon-accent` / `--v2-icon-icon-accent-hover`，而这两个 token 今天**都是蓝色**（`--v2-blue-600` / `--v2-blue-700`），**整个 v2 色板无任何金色 token**。按宪法 §八不能硬编码 `#F59E0B`/`#B45309`，故 **logo 现在是蓝的**，DESIGN §5.1 的蜂蜜金要等 T017 换皮生效（换皮后组件无需改动）。
- ✅ **已解决（原「T008 前须定：T007 的 `Topbar` 未接线」）**：T008 已把 `Topbar` 挂进 `#opencode-titlebar-right`（经 `pages/layout-new.tsx` 的 `useTitlebarRightMount()` 注入 + `<Portal>`），并建立身份接入缝 `workspace/current-user.ts`。**身份未就位时顶栏不渲染用户区**（宁缺勿假，未采纳「塞占位身份」方案）；F2 落地时**只改 `current-user.ts` 一个文件**。
- 🔴 **待决项（须尽快定，建议补任务）**：**右栏（AI 会话）无任务供给**（T008 发现）。FR-001 要求「右栏 AI 会话」，但 T001–T017 里没有任何任务把 AI 会话放进 `ThreePane` 的右槽（plan.md ① 把它列为「换皮 + 重定职责」却未派生 task；T003 备注「右栏由 T007/T009 供给」**是错记**——T007 顶栏、T009 中栏 tab 栏）。**建议补一个任务**（把 `pages/session/session-side-panel.tsx` 换皮 + 重定职责后填入右槽，或在 001 明确记为「右栏内容归 F8」并据此降低 FR-001 的验收口径）。在此之前，FR-001 的右栏仍只是「位置已定义、内容空缺」。
- 🆕 **待决项（T009 起须留意）**：**`#opencode-titlebar-right` 是共享注入点**。上游 `new-session-view.tsx:77-93`（`NewSessionStatus`）与 `session-header.tsx:285` 都往同一元素 Portal；T008 挂上的 openhive 顶栏会与它们**并列出现在顶栏右侧**。T017 浏览器核对时须定归属/顺序（可能与 T009「顶栏 session tab 条 vs 中栏 tab 容器」的分工是同一类问题）。
- 🆕 **待决项（T007 前须定，T009 后已累计）**：**plan.md 文件结构与实际产出的偏差**。T006 交付了 `rail/entries.ts` **和** `rail.tsx`（plan.md:61-62 只列了 `entries.ts`）；T007 新增 `topbar/` 下 4 个源文件；T008 新增 `workspace/workspace-entry.tsx` + `workspace/current-user.ts`（plan 的 `workspace/` 只列了 `three-pane.tsx`）；**T009 又新增 `center/module-color.ts` + `center/tab-overflow.ts`**（plan.md:70 的 `center/` 只列了 `tab-bar.tsx`）。**须一次性回改 plan.md 文件结构**，或明确声明为计划外新增。
- 🆕 **待决项（T009 新增，可延后，设计侧复核）**：**DESIGN.md §4.5 的两项裁量**——① 「模块 → 实体身份色」的**取值**（仅「话单=蓝」有 §1.3 既有依据，其余五个按色相可区分性挑）；② **用「模块图标」取代 front 参考件的「文件类型图标」** 这一选择。改色只动 §4.5 表 + `center/module-color.ts` 一处映射，组件不受影响；改图标选型同 T006/T007 的图标评审一并看。
- 🆕 **待决项（可延后，T017 视觉核对时定）**：**图标选型需设计评审**。DESIGN §4.2 未点名具体图标——T006 自选 `folder` / `archive` / `speech-bubble` / `bullet-list` / `branch` / `settings-gear`；T007 又自选 `comment`（站内信，因原生集**无 `bell`**）、`expand`（全屏）；**T009 的溢出按钮「⋯」直接用字面字形 U+22EF**（原生 97 个图标名里**无** `ellipsis` / `more-horizontal` / `dots`，已核）。语义是否贴合需人看（类型安全已由 `IconProps["name"]` 保证；宪法 I 禁止往上游 `icon.tsx` 加图标）。
- ✅ **已解决（原「T006 遗留：`icon.css` 会不会盖住父级 `text-v2-icon-*`」）**：T009 查实——`packages/ui/src/components/icon.css:8` 给 `[data-component="icon"]` 显式 `color: var(--icon-base)`，而 legacy `theme.css:243` 在 `:root` 全局定义了 `--icon-base: #8f8f8f`。**结论：父级 `text-v2-icon-*` 确实不会给 `Icon` 上色**，必须由**祖先元素提供 `--icon-base`**（自定义属性继承）。T009 的 tab 模块色即按此实现（wrapper 提供 inline `--icon-base`）。**T017 视觉核对与后续任何 Icon 着色都适用此条**；仍按宪法 I 不改上游 CSS。
- 🆕 **待决项（可延后，设计侧复核）**：**DESIGN.md 新增的 §4.4 顶栏章节的措辞是我拟的**。因宪法 §八要求「未覆盖的先在 DESIGN.md 补充再引用」，而 DESIGN 原本完全没有顶栏章节，T007 先补了 §4.4（四要素表 + 高度沿用原生 36px + 只引用 token + 品牌名走配置）。**内容与措辞需设计侧过一眼**。
- 🆕 **待决项（T011/T016 前须定）**：注册表只认**扩展名**，但 plan.md「数据流向」要求数据轴也汇入注册表，而「数据明细 / 可视化图表 / 分析记录」无扩展名。要么给注册表加一条非扩展名的键通道，要么让数据轴绕过注册表（动作直接携带组件）。**（用户已确认此发现成立）**
- 🆕 **待决项（T012 前须定）**：**FR-007 的「10 类」逐项枚举**。用户已确认口径 = **日常办公常见的 10 类文件**，原列的「数据明细 / 可视化图表 / 分析记录」**不计入**（它们与上一条数据轴待决项是同一个问题）。已落修订记录 2026-09-27b 于 `spec.md` / `tasks.md`。
  **候选提案（我拟，未获确认，仅作 T012 的起步锚点）**：① 文档 `.doc/.docx` ② 表格 `.xls/.xlsx/.csv` ③ 演示 `.ppt/.pptx` ④ PDF `.pdf` ⑤ 图片 `.png/.jpg/.jpeg/.gif/.bmp/.webp` ⑥ 文本/图文混排 `.txt/.md/.rtf` ⑦ 思维导图 `.xmind`（或 `.mm`）⑧ 压缩包 `.zip/.rar/.7z` ⑨ 音视频 `.mp3/.mp4/.wav` ⑩ 代码/配置 `.json/.xml/.yaml`。**待用户裁定后再动 T012**；⑧⑨ 是否要"预览"还是只"下载"也需一并定。
- 🆕 **待决项（T009/T012 前须定）**：应用级共享注册表实例放哪（T004 只给了 `createViewRegistry()` 工厂，刻意的）。

## 最后更新
2026-09-27（T009 完成：**中栏 tab 栏**——新增 `center/tab-bar.tsx` + `center/module-color.ts`（模块→身份色变量名）+ `center/tab-overflow.ts`（溢出判定纯函数）+ 3 个测试文件（11 单测 / 8 组件测试）。**未挂载**，留给 T010。🔴 裁定了一个 MUST 级冲突（FR-005「按模块着色」vs DESIGN §4.2「无模块徽章」）→ **着色≠徽章**，依宪法 §八**先补 `openhive-DESIGN.md` §4.5** 再写码，并改掉 §1.3 自相矛盾的「话单模块徽章」行。**不新增任何 hex/token**（复用 `--v2-avatar-bg-*`；激活态取既有 `--v2-background-bg-accent`，不写 `#D97706`）。💡 **回答了 T006 遗留疑问**：`Icon` 的色来自 `--icon-base`，父级 `text-v2-icon-*` 无效，须由祖先元素提供。test:unit **769** pass、test:components **37** pass、test:browser 41 pass、typecheck 30/30（首轮真报错 1 处已修）、本任务目录 oxlint 0 命中（首轮 4 条已修）。⚠️ 全仓 lint 仍 exit 1 / 4902 warnings + 1 error（与 T008 末逐字一致）。）

2026-09-27（T008 完成：**入口接线**——新增 `workspace/workspace-entry.tsx`（图标栏 → 三栏 + 顶栏挂上游注入点）+ `workspace/current-user.ts`（身份接入缝）+ 7 个组件测试；改 3 个既有文件共 3 行 + `topbar.tsx` 的 `user` 改可选。T007 移交的两件事均已落地。**`layout-new.tsx` 只动 3 行**。test:unit 758 pass（与 T007 末一致）、test:components **29** pass、test:browser 41 pass（主动复跑）、typecheck 30/30、本任务目录 oxlint 0 命中。🔴 发现**计划缺口：右栏（AI 会话）无任务供给**，建议补任务。⚠️ `#opencode-titlebar-right` 是共享注入点，会与上游会话状态并列）

2026-09-27（T007 完成：顶栏 `topbar/`（品牌 Logo / 站内信 / 全屏 / 用户下拉）+ 20 个测试；test:unit 758 pass、test:components 22 pass、typecheck 30/30 曾真实报错 1 处已修、lint 本任务 8 文件 0 命中。**DESIGN.md 新增 §4.4 顶栏**。**两处红旗**：① `Topbar` **未接线**（无登录态来源，已移交 T008）；② 🔴 T017 阻断项由 1 条扩为 2 条——除选中底色外，**品牌金 token 也不存在**（`--v2-icon-icon-accent` 今天是蓝色，logo 因此暂时是蓝的）。另：复核推翻了「`#opencode-titlebar-left` 可用」的结论——它只在 legacy 分支）
