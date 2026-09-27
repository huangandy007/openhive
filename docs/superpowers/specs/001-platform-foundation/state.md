# 实施进度 · 平台底座（三栏工作台）

## 当前任务
T013 已完成。**T014 进行中**：范围已裁定（3 个视图，PPT 拆出为 T018），前置改造（注册表改懒加载）已完成并单独提交；**3 个视图本身待做**。

✅ **T014 前置（2026-09-27）：视图注册表契约改懒加载 —— 已完成，按宪法 §四单独提交**。三个预览库实测合计 **976 kB（gzip 306 kB）** 本会随 `views/index.ts` 的静态 import 全部进首屏；改 `component` → `load: () => Promise<组件>` 后，三者**各自成 chunk**（174 / 366 / 436 kB），**入口包对三者零命中**——由真实 `bun run build` 核对（不只是那句源码守卫）。用户裁定原话：「现在改成异步工厂」。
⏭️ **T014 主体待做**：`image-view`（`.png/.jpg/.jpeg/.gif/.bmp/.webp`）/ `richtext-view`（`.md`/`.txt`）/ `mindmap-view`（`.xmind`）。**PPT 拆出为 T018**——design-v2 §9.5 把 PPT 预览定为**服务端** LibreOffice 转换，与 T014 的 `[FE·新增]` 标签相冲，方案须先由人定（见 `tasks.md` T018 与「待决项」）。

✅ T013 交付了 FR-007 的第三类真实视图（表格 `.xls/.xlsx/.csv`，SheetJS），并**顺手修掉 T012 埋下的一个真缺陷**：`CenterContent` 原用 `<Show fallback={props.children}>`，而 `Show` 的分支互换会**卸载重挂** `props.children`——它在生产里是上游路由页面，**点一张有视图的 tab 就丢掉整页状态**。已改为「页面常驻，只藏不卸」。
🔴 **T013 新发现、须 T017 处置**（见「待决项」）：**SheetJS 对特定输入会死循环**（`XLSX.read` 永不返回，同步 CPU 死循环，`try/catch`/超时/`AbortController` 全拦不住）——一个损坏的表格文件能把民警的浏览器标签页永久卡死。
🔴 **T012 的落差仍待复核**（见「待决项」）：裁定要求「补一条最小的『打开文件』路径」，**通路补了**，但**生产侧没有合法的 loader 供给方**——`loadFile` 目前只是注入点，不假装能点开文件。
⚠️ **T011 的范围裁量仍待复核**（见「待决项」）：边界止于「动作层」；T012 已在该边界之外补上「激活 tab → 注册表 → 渲染」的中栏路由。
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

- **T010** [US2] [FE·新增] 中栏 tab 的响应式状态与模块切换联动 `packages/app/src/center/tab-context.tsx` + `workspace/workspace-entry.tsx` 接线 + `tab-bar.tsx` 挂载修正（5 单测 / 4 集成测试）
  - **交付**：新增 `CenterTabsProvider({ initialModule? })` + `useCenterTabs()`（`module()` / `tabs()` / `active()` / `open` / `activate` / `close` / `switchModule`）；`WorkspaceEntry` 拆成「provider 外层 + `WorkspaceBody` 消费层」，图标栏与中栏 tab 共用同一份状态，`<TabBar>` 挂进 `ThreePane` 中栏顶部
  - **FR-006 的联动机制**：T008 那个组件内 `activeModule` signal **上移**进 `CenterTabState.module`，切模块走 `switchModule()`——它按定义只换 module、不动 tabs，故「切模块不清空 tab」**不是靠额外判断，而是结构上不可能发生**（单测 + 集成测试各证一次）
  - **为何用 context 而非模块级单例**（对比 T008 `current-user.ts` 的写法）：T011 模块动作 / T012+ 视图散在树深处，逐层传 prop 会把中栏状态焊进每一层；作用域随 provider 走 → 组件测试天然互不串味，**不需要全局复位钩子**
  - 🔴 **TDD 抓到的一次假绿（最有价值的记录）**：为「宽度未知先全显示」写的测试用了 `{...{ availableWidth: undefined }}` 覆盖助手默认值 → **测试立刻通过**。实因 **Solid 的 spread 跳过值为 `undefined` 的键**，`availableWidth` 仍是 `1000`，该测试什么都没测。改 `"availableWidth" in props` 后立刻真 RED（received `[]`），再实现才转绿。**教训：一写就绿不是省事，是空转；Solid 里「不传 prop」不能用 `undefined` 覆盖表达**
  - ⚠️ **`tab-bar.tsx` 的两处挂载修正**：① 根元素补 `w-full`（中栏容器是 `flex flex-col items-start`，缺它会缩到内容宽度；**happy-dom 量不出布局，只有人看浏览器才发现**）② `measured()` 为 0 改判为「还没量到」而非「宽度为零」，作不限宽先全显示
  - ⚠️ **视觉类零断言（L2 缺口，同前）**：`w-full` 的实际铺满效果、空 tab 栏的观感都属 T017 浏览器核对
  - ⚠️ **未接线的数据（不编造）**：`capabilities` 仍不传（001 无签发方）；tab 的**打开**通路虽已通（`open()`），但**没有任何模块动作去调它**——那是 T011（FR-010）。（本任务的集成测试用与 T011 同构的消费者驱动这条通路，非测试专用后门）
  - TDD 诚实标注：① RED 形态 = `Cannot find module './tab-context'` + 4 条集成测试报 `useCenterTabs 必须在 <CenterTabsProvider> 之内使用`（功能缺失）② 三个循环：`tab-context` 5 条 → 宽度未知 1 条（先假绿、修测试后真 RED、再实现）③ 4 条集成测试整批先失败后全绿，未逐个制造 4 次 RED ④ 无「先写实现后补测试」

- **T011** [US2] [FE·新增] 模块动作打开特有 tab `packages/app/src/center/module-actions.ts` + 5 个测试 + 1 条集成守卫
  - **交付**：`ModuleAction { title, content }` + `useModuleAction(): (action) => void`。**不导出全局单例、不起注册表**（Simplicity First：001 无模块 UI，没有第二个消费者）
  - **机制三要点**：① 来源模块由 hook 取 `center.module()`，不由调用方手填——FR-005 着色的来源不靠人手传就不会传错；**当前模块未定时不响应** ② 动作是特有 tab 的**唯一来源**，`CenterTabsProvider` 初始为空（FR-010「非预置常驻」；对照参考件 `CenterWorkspace.tsx:145` 把「研判笔记」预置进初值，正是要禁掉的做法）③ `content` 是**不可解释的内容键**（001 = 文件路径；数据轴 F6/F7 = 数据视图键），故两条轴都能走这里
  - ⚠️ **未接线的数据（不编造）**：`useModuleAction()` 目前**没有真实调用方**（F2+ 各模块的动作按钮才是）；测试用面板探针驱动，探针即该 hook 的既定用法（同 T010 `OpenTabs`）
  - 🔴 **TDD 抓到第二个真 RED**：循环 1「点动作开 tab」先写无守卫实现即绿；循环 2「当前模块未定时不凭空开 tab」**真 RED**——收到 `{ module: undefined, path: "detail:acct-4419" }`，正是预测的假来源 tab（其 key 会是 `undefined\n…`，着色落兜底灰），加守卫后转绿。**这条守卫是测试逼出来的，不是先见之明**
  - ⚠️ **命名遗留（新待决项）**：`ContentTab.path` 在数据轴 tab 上名不副实（存 `detail:acct-4419` 这类键）。**未动 T005 字段名**（改名波及 `tab-store.ts` / `tab-bar.tsx` + T005/T009/T010 三个测试文件），待数据轴落地时一并收口
  - ⚠️ **视觉类零断言（L2 缺口，同前）**：本任务不新增视觉元素（tab 由 T009 的 `tab-bar.tsx` 渲染），无新视觉核对项
  - TDD 诚实标注：① RED 形态 = `Cannot find module './module-actions'` ② 两个真循环（见上）③ 另 3 条（初始零 tab / 重复触发不重复开 / 跨模块累积）是**测试内声明为非 RED 驱动**的需求守卫，行为由既有 `openContentTab` 语义保证 ④ `workspace-entry.test.tsx` 新增的集成守卫同为非 RED（两段通路各自已绿），已注释声明 ⑤ 无「先写实现后补测试」

- **T012** [US3] [FE·新增] 文档与 PDF 视图 + 中栏内容区路由 `packages/app/src/center/`：`file-content.ts` + `views/{binary-view,document-view,pdf-view,index}.{tsx,ts}` + `center-content.tsx` + 4 个新测试文件 + 1 个文件新增测试（**6 个新文件 + 1 个文件新增，共 28 条**）
  - **交付**：`FileContent` / `LoadFileContent` / `decodeBytes`（取数接缝 + base64→字节）+ `BinaryView`（字节型视图公共壳：取字节 → 交渲染器 → `pending/ready/empty/error`）+ `renderDocx`/`DocumentView`（docx-preview）+ `renderPdf`/`PdfView`（pdfjs-dist）+ `viewRegistry`（应用级单例，认领 `.doc/.docx` 与 `.pdf`）+ `CenterContent`（激活 tab → 扩展名 → 注册表 → 视图）
  - **出参分两层兑现**：①「能预览 Word / PDF」= **机制已通**（渲染器真吃了字节，垃圾字节必落到 `error` 已被测试证明；`getDocument` 真跑到了 `InvalidPDFException`）②「画面真的出来」= **L2 缺口**，留 T017 真实浏览器核对（happy-dom 无 CSS/Canvas 引擎，**不谎称已验**）
  - **依赖处理**：`docx-preview@0.4.1` + `pdfjs-dist@6.3.289` **刻意写显式版本、不进根 catalog**（进 catalog 要动上游高频的根 `package.json`）；`bun.lock` 净改动 **+55 / −5**（其余为 bun 的传递依赖重提升，非降级）——773 条既有单测全绿反证对既有包无影响
  - **三处关键设计**：① **`CenterContent` 无解析结果时落回 `children`**（`Show ... fallback={props.children}`）→ 001 下行为与本组件引入前**完全一致**（有测试证明），且 `keyed` 保证两张 document tab 间切换时组件重挂、视图按新 path 重新取数 ② **注册表由调用方注入**（`registry` prop）而非中栏 import 单例 → 测试各用各的、互不串味（沿用 T010 用 context 而非模块级单例的同一理由）③ **`ViewProps` 加宽为 `{ path, load? }`**（T004 预告过）：`path` 保持**不可解释**（001 = 文件路径，数据轴 F6/F7 = 数据视图键），取内容改由 `load` 注入
  - ⚠️ **两处弃「猜」从「记」**：① view 层**不自己 `useFile()`**——那要六层 provider 才活得下来，会把工作台组件测试整个拖进去，故取数做成注入缝 ② 不猜「未知扩展名长什么样」——路由不到就落回上游路由页面，**降级呈现归 T015**
  - 🔴 **与用户裁定 #3 有落差的发现（请复核）**：裁定要求「补一条最小的『打开文件』路径」。**通路补了**（含集成测试证明 `loadFile` 一路走到视图），但**生产侧没有合法的 loader 供给方**：directory-scoped 的 SDK client 只在**路由页内部**可得（`pages/directory-layout.tsx:117`、`pages/session.tsx:273`），而 `WorkspaceEntry` 所在的 `NewLayout` 在**其上层**（`app.tsx:371-379`）；退而用 `serverSDK().client` 会**丢 directory 作用域**（多项目下读错文件），从 `layout.route()` 反推目录则要猜上游路由内部结构（违宪法 I）。且 001 无需求方（FR-010 的 tab 由模块动作打开，模块属 F2+）。故 `loadFile` 留作**注入点**，**不假装生产侧已能点开文件**。候选解法（留给 F2 裁量）：① 文件源上提到工作台层；② 改 context 注册制（与 T010 记的「不用模块级单例、避免全局复位钩子」相冲突，需权衡）
  - ⚠️ **pdfjs worker 未配**：`GlobalWorkerOptions.workerSrc` 未设 → 退回主线程渲染。Vite 构建期配置，本环境无从验证，**留待 T017**
  - ⚠️ **视觉类零断言（L2 缺口，同前）**：happy-dom 无 CSS 引擎。**T017 新增待核对**：① Word/PDF 真实文件的画面渲染；② PDF canvas 尺寸与滚动容器；③ `data-state` 的视觉表现（空态/错误态由 T015 补画）
  - TDD 诚实标注：① RED 形态 = `Cannot find module './xxx'`（**5 次**）② **2 次真行为 RED**：探针先行证明「垃圾字节必落 `error`」对两个渲染器都成立（`Can't find end of central directory : is this a zip file ?` / `InvalidPDFException Invalid PDF structure.`）③ **唯一一处非 RED 驱动**：`binary-view.tsx` 的**竞态令牌**是先写下的、没有失败测试逼出来 → 补测试并**临时把守卫改成 `mine === token || true` 验证它有牙**（立刻 RED，收到 `[111]` 说明旧文件盖掉了新的），恢复后 GREEN，**已在 tasks.md 如实标注** ④ 无「先写实现后补测试」的其余部分

- **T013** [US3] [FE·新增] 表格视图 `packages/app/src/center/views/sheet-view.{tsx,test.tsx}` + 注册 `.xls/.xlsx/.csv` + **修掉 T012 埋的 `CenterContent` 卸挂缺陷**（**2 个新文件 + 3 处改动，共 8 条测试**）
  - **依赖（用户裁定「SheetJS 官方 CDN」）**：`xlsx@0.20.3` 取自 `https://cdn.sheetjs.com/…tgz`。npm 上的 `xlsx` 停在 0.18.5，OSV 显示 **CVE-2023-30533（原型污染 HIGH）/ CVE-2024-22363（ReDoS）在 npm 生态无任何 fixed 版本**，且两者**只在读取特制文件时触发——正是本产品的用法**。代价：绕过 npmmirror 镜像（内网重建需可达该 CDN 或内部镜像一份）；`bun.lock` 留一条非 registry URL。**本次 `bun.lock` 净 +3 行、零 churn**（T012 时是 +55/−5）
  - 🔴 **探针发现的重大缺陷：SheetJS 对特定输入死循环**。10 字节 `PK\x03\x04\x14\x00\x00\x00\x08\x00` 使 `XLSX.read` **永不返回**（Worker + `terminate()` 确证「10 秒到，Worker 仍在跑 → 强杀，不是慢是跑不完」）。**同步 CPU 死循环 → `try/catch`、Promise 超时、`AbortController` 全拦不住**：一个损坏/构造的表格文件能把民警的浏览器标签页**永久卡死**。缓解（Worker 化 + 超时 terminate）已验证可行但属 Vite 构建期配置，**留 T017**
  - ⚠️ **中文 CSV 乱码是真 bug**：SheetJS 对**无 zip 头**的文本默认按 Latin-1 解 → 「å§å」。`codepage: 65001` 修好且不伤真 `.xlsx/.xls`（zip 路径自带编码声明）。**不修则 `.csv` 整类不可用**
  - ⚠️ **SheetJS 的真实失败面（推翻常识）**：多数垃圾字节**不抛错**，而是被当 CSV「成功」解析（控制字节 / 64 个零 / PDF 前缀都如此），只有带 PK 头的残缺 zip 才真抛 → 「坏文件 → error 态」**必须用 PK 头输入才能测**，否则假绿
  - 🔴 **顺手修掉 T012 的真缺陷（`center-content.tsx`）**：`<Show when={current()} keyed fallback={props.children}>` 的**分支互换会卸载重挂** `props.children`——它在生产里是**上游路由页面**，于是**点一张有视图的 tab 就丢掉整页状态**（滚动位置、已取数据、填了一半的表单），点回来重新挂载。T012 时看不出来（除 `.docx/.pdf` 外无视图，`Show` 从不切换）；**T013 一注册 `.xls/.xlsx/.csv` 就踩响**（`workspace-entry.test.tsx` 的 tab 激活测试 pass→fail）。**A/B 确证**：撤注册 → 15 pass，加回 → 1 fail。**修法**：页面常驻只藏不卸（`display: contents` ↔ `none`；用 `contents` 不引入多余盒，页面仍是中栏 flex 的直接子项）。**先写 RED 钉住再改**
  - ⚠️ **一处假绿（我自己写的测试）**：第一版「只挂载一次」测试传的是 `<页面 />` 这个**已求值的 JSX 元素**——`setUp()` 时就变成固定 DOM 节点，反复插入不重跑组件体 → 通过但**什么都没测**（同族陷阱见 T010 的 `availableWidth: undefined`）。改传**组件函数** + `<Dynamic>` 后**立刻真 RED**（Expected 1, Received 2）
  - ⚠️ **lint 首轮 3 条 + 我第一版修法自引入 2 条，根因是我的错**：`sheet_to_json<T>` 的 `T` 是**行**类型，`header: 1` 下行本身是数组，我漏了外层 `[]`（写成 `string | number | boolean | null` 而非 `(…)[]`），oxlint 遂把单元格看成 `string` 而连报「转换多余」（`no-unnecessary-type-conversion` → 换写法 → `no-unnecessary-template-expression`）。补上外层 `[]` 后全部收口，`String(cell)` 回归。**教训：跟着 lint 换语法是治标——先怀疑自己写的类型**
  - ⚠️ **视觉类零断言（L2 缺口，同前）**：happy-dom 无 CSS 引擎。**T017 新增待核对**：表格的真实排版（列宽、sticky 表头、大表格滚动）
  - TDD 诚实标注：8 条里 **2 条真 RED**（① 模块缺失 ② 中文乱码真行为）、**1 条验证过有牙但非 RED 驱动**（行宽补齐：临时摘掉 `defval`/`blankrows` → 收到 `[3, 2]` → 恢复）、5 条守卫/集成断言；注册表 2 条真 RED；`center-content` 2 条由真 bug 驱动。**删掉一条死代码**：`if (!sheet)` 守卫被删（探针查实零工作表工作簿 `XLSX.write` 自己抛 `Workbook is empty`、读垃圾总得到 `SheetNames: ["Sheet1"]` → 不可达）

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

## 质量门禁（懒加载重构后 2026-09-27）
> 工作基点：`multi-tenant` @ `028d019ef1`（`packages/app` v1.18.29）。上一列括号内为 **T013 末**的值。

| 门禁 | 结果 | 归因 |
|---|---|---|
| `packages/app` `bun run test:unit` | ✅ **774 pass / 0 fail**（113 files / 3110 expect） | 干净（T013 末 773，**+1** = 注册表新增「解析出的是 loader 而不是组件：不调用它就不加载」） |
| `packages/app` `bun run test:components` | ✅ **92 pass / 0 fail**（183 expect） | 干净（T013 末 88，**+4** = `center-content` 懒加载空档 3 条 + `views/index` 首屏守卫 1 条） |
| `packages/app` `bun run test:browser` | ✅ **41 pass / 0 fail**（100 expect） | 干净（与基线**一致**） |
| `bun run typecheck`（turbo，根目录） | ✅ **30 successful / 30 total** | 干净（首轮即过） |
| `bun run lint`（oxlint，根目录） | ❌ **exit 1**：4902 warnings / **1 error** | **既有上游、已决策记为「已知红」**，见下。计数与 T013 末**逐字一致**（中途一度 4903，是我自己留下的孤儿变量，已清） |
| `bun run build`（`packages/app`，**本次新增的核对手段**） | ✅ 成功（31.5 s） | 分块结果见下「懒加载实测」 |

**本次触碰文件 lint 自查**：`bunx oxlint packages/app/src/center packages/app/src/workspace` → **0 命中**（33 files）。中途我自己的改动留下 1 个孤儿 `落定` 变量（+1 warning），已按「清掉自己的改动造成的孤儿」删掉。

### 懒加载实测（本次改造的**唯一理由**，故实测而非推断）
`bun run build` 产物（`packages/app/dist/assets/`）：

| chunk | 大小 | gzip |
|---|---|---|
| `document-view-*.js` | 174.31 kB | 51.48 kB |
| `sheet-view-*.js` | 366.22 kB | 123.98 kB |
| `pdf-view-*.js` | 436.06 kB | 130.56 kB |
| `index-*.js`（入口） | 2756.15 kB | 822.82 kB |

**证伪方向也验了**：用 `SheetJS\|docx-preview\|PDFDocumentProxy\|pdfjs-dist` 去 grep 入口 chunk → **0 命中**；同一 pattern 在三个视图 chunk 里分别 6 / 1 / 1 命中。即**三个库确实不在入口包里**（改契约前它们随 `views/index.ts` 静态 import 必然在入口里）。
> ⚠️ 该 grep 只是**旁证**：它证明库不在入口，不证明入口因此小了多少——**未做「改动前 vs 改动后」的入口体积对账**（那要回退代码再构建一次，未做），故 state.md 只记「三者各自成 chunk + 入口零命中」，**不声称节省了 976 kB**。

> 🔴 **T013 的教训（最该记住的一条）**：**跟着 lint 换语法是治标，先怀疑自己写的类型**。`sheet_to_json<T>` 的 `T` 是**行**类型，`header: 1` 下行本身是数组，我漏写了外层 `[]`；oxlint 于是把单元格推断成 `string`，接着连报两条「转换多余」（`no-unnecessary-type-conversion` → 我把 `String(cell)` 换成模板串 → `no-unnecessary-template-expression`）。**换了两轮语法都没用**——因为错的是我写的类型注解，不是那行代码。补上 `(…)[]` 后两条同时消失，`String(cell)` 原样回归。

> 🔴 **T013 的另一条**：**`Show` 的分支互换会卸载重挂该分支内容**。`<Show when={x} fallback={children}>` 里，`children` 在 `x` 真假翻转时被**卸掉再挂回**。若 `children` 是上游路由页面，用户点一张有视图的 tab 就丢掉整页状态。**判断「有没有视图」时，「藏起来」与「从树上摘掉」是两回事**——要保挂载就用 `display: none`，要保布局就用 `display: contents`。这条在 T012 完全看不出来（当时 `Show` 从不切换），是 T013 注册新扩展名才踩响的。

> 🔴 **懒加载重构的教训一：异步链的「起点」变了，固定睡一个 tick 的等待写法就失效**。`workspace-entry.test.tsx` 原用 `await 落定()`（`setTimeout 0`）等「动作 → 视图」。视图改成懒加载后，这条链**以动态 import 起头**（读盘 + 编译，耗时看机器），一个 tick 远远不够 → 两条集成测试变红。**改法是「等到条件成立」（有上限的轮询），不是「多睡几个 tick」**——后者只是把脆弱性藏起来，机器一慢又红。**推论：任何「睡 N 个 tick 就断言」的测试，都在假设链路的异步结构不变。**

> 🔴 **懒加载重构的教训二：有些要求没有 DOM 可观测面，只能守源码——但要诚实标注它的性质**。「首屏不带三个预览库」在单元测试里**无法**用 DOM 断言（测的是打包结果，不是运行时行为），故 `views/index.test.tsx` 直接读 `index.ts` 源码，禁止静态 import 视图模块 + 要求出现 `import(...)`。它是**回归守卫**而非行为测试：能抓住「有人改回静态 import」，但**不能证明包真的变小**（后者只能靠 `bun run build` 实测，见「懒加载实测」）。**TDD 允许这种测试，前提是不把它当行为证据用。**

> 🔴 **懒加载重构的教训三：「加载中」是个必须表态的状态，且两条岔路必须分开表态**。空档期里我选**留住旧视图**（不闪调用方的路由页——用户明确说过「不能让用户感觉到慢」）；但**加载失败**时必须**清空**，否则民警会对着「卷宗.pdf」这个标题看立项书的内容。**「还没好」与「好不了」是两回事，不能用同一个分支处理**——三条测试分别钉住：留旧、失败收手、迟到的结果不覆盖新的（竞态令牌 `alive` + `onCleanup`）。

> 🔴 **T010 的教训（仍在生效）**：那条「宽度未知先全显示」的测试**第一版是假绿**——用了 `{...{ availableWidth: undefined }}` 覆盖助手默认值，而 **Solid 的 spread 会跳过值为 `undefined` 的键**，`availableWidth` 其实仍是 1000，测试什么都没测（立刻通过）。改成 `"availableWidth" in props` 判定后，同一测试立刻真 RED（received `[]`）。**测试一写就绿要当红灯看**。

> 🔴 **T011 最该记住的一条**：守卫（「当前模块未定时不凭空开 tab」）是**测试逼出来的**——无守卫的实现先绿，补上这条测试立刻真 RED（`{ module: undefined, path: "detail:acct-4419" }`）。**先写一版不做边界处理的实现，再让测试指出边界在哪**，比一开始就凭想象加一堆 if 更可靠。

> ⚠️ **typecheck 修了什么**：`tab-bar.tsx` 的 `MODULE_ICONS: Record<string, string>` 把图标名喂给 `<Icon name>` 报 `TS2322`（`string` 不可赋给 97 个名字的联合）。**改的是新代码自己的类型** → `Record<string, IconProps["name"]>`（同 `RailEntry.icon` 的既有做法），**没放宽上游 `Icon` 的类型**（放宽会掩盖「编出不存在的图标」这类真错）。

> ⚠️ **warning 计数诚实标注**：T005 末记 4901，T006/T007/T008/T009/T010 末均为 4902，**T011 末为 4901**（不是 4903）。本任务新增 2 个文件在 lint 输出中 **0 命中**，故**只主张「我引入 0 命中」，不主张「4901 与我无关」**——该总计数在 4901/4902 间抖动而代码面无从属关系（T005 已记录同一现象：oxlint 12 线程输出计数不稳定），**归因不明**，如实记为「未解释的抖动」。**计数下降不代表修好了什么**。

### 唯一仍在红的门禁：lint 的 1 个 error（已知，待上报上游）
上游 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163` 的 `content-['\200B']`（Tailwind 类里的八进制转义）。该文件与基点**逐字节相同**，跨平台真实存在（非 Windows 特有）。修它需改上游文件 → 违反宪法 I（最小化合并冲突），**决策：不在本项目内私改，记为已知红，上报上游**。本次新增文件在 lint 输出中 **0 命中**；warning 明细全部落在既有文件上（本任务触碰的 `packages/app/src/center` + `workspace` 33 文件 0 命中），但**总计数有 ±1 抖动、归因不明**，见上。

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
- 🔴🔴 **待决项（T013 新增，T017 必须处置，否则可致命）**：**SheetJS 对特定输入死循环**。10 字节 `PK\x03\x04\x14\x00\x00\x00\x08\x00` 使 `XLSX.read` **永不返回**（探针用 Worker + `terminate()` 确证：10 秒到点，Worker 仍在跑 → 强杀）。这是**同步 CPU 死循环**，故 `try/catch`、Promise 超时、`AbortController` **全部无效**——损坏或**被人为构造**的表格文件能让民警的浏览器标签页**永久卡死**（连"关闭/刷新"都要靠浏览器强杀）。缓解方向（把解析放进 Worker + 超时 `terminate()`）**探针已验证可行**，但它是 Vite 构建期配置，**本环境无法验证**，猜错会破坏构建 → 不在 T013 写。**T017（真实浏览器核对）必须一并处置**，可选：① Worker 化 + 超时兜底；② 换一个不做同步全量解析的库；③ 至少在 spec 里显式记为已知风险并由产品决定接受。**注意**：本条与 T012 记的「pdfjs worker 未配」是**两件不同的事**——那条是性能（退回主线程会卡界面），这条是**可用性/安全**（永不返回）。
- ✅ **已解决（原「T013 待决项：三个视图库静态 import、包体积未评估」）**：**2026-09-27 用户裁定「现在改成异步工厂」，已落地并单独提交**。注册表契约 `component: ViewComponent` → `load: ViewLoader = () => Promise<ViewComponent>`；`views/index.ts` 三条注册全改 `async () => (await import("./xxx-view")).XxxView`；`CenterContent` 随之改异步解析（含空档期/失败/竞态三种处理，见「教训三」）。**实测**：三者各自成 chunk（174 / 366 / 436 kB），入口包零命中。**新增守卫**：`views/index.test.tsx` 读源码禁止静态 import 回潮。**T014 的新视图须沿用 `load:` 契约**。
  - **原文留档（已过时，勿据此行动）**：**三个视图库均随 `views/index.ts` 静态 import，包体积与懒加载策略未评估**。`docx-preview` + `pdfjs-dist` + `xlsx`（**单是 xlsx 就 2.4 MB**）全部进首屏，与「薄界面」目标相悖；`view-registry.ts` 的机制按扩展名映射到**组件本身**，不是「按需 import 工厂」，故懒加载要改注册表契约（`component` → `load: () => Promise<...>`）。**改契约会波及 T012/T013/T014 的注册调用**，宜在 T014 落地前一并定，避免 T014 再按旧契约写一遍。**当前未做任何优化，如实记为未评估**。（⚠️ 该原文里的「单是 xlsx 就 2.4 MB」是**包的体积**，不是它进构建产物的量——实测该 chunk 是 366.22 kB / gzip 123.98 kB。留档不作更正，但引用时别把这两个数当一回事。）
- 🔴 **待决项（T018 前须定，2026-09-27c 新增）**：**PPT 预览走服务端还是客户端**。design-v2 §9.5 明写「PPT 预览 | **LibreOffice headless** 转图片/PDF」——那是**服务端**方案，而本 feature 声明「纯前端，无 `[BE]`」。客户端有现成库（`pptxviewjs*` / `@takemynotes/slideframe`），**但都是 canvas 渲染**，而 happy-dom **无 canvas 引擎** → 渲染正确性连 DOM 结构都验不到，只能靠 T017 人工逐页核对。**须人定**：① 服务端转换（要后端 + 部署改动，需另立 feature 或扩 001 边界）；② 客户端 canvas（自动测试面进一步变窄）。**若走服务端，还须定转换产物怎么进中栏**（现有 `loadFile` 注入缝是否够）。**在定下之前不按猜测实现**（这正是把 PPT 从 T014 拆出的原因）。
- 🔴 **待决项（T017 前须定 / T017 阻断项，T007 后已扩为两条）**：
  1. **选中底色的品牌色 token 不存在**。DESIGN §1.3/§4.1 要求选中底 = 浅金 `#FEF3C7`，但 v2 的 overlay 语义 token 只有中性黑/白 alpha，**无品牌色 overlay token**；T006 暂用 `--v2-overlay-simple-overlay-pressed`（中性灰，仓库既有「选中面」token）。**T017 须二选一**：① 全局重定 `overlay-pressed` 为品牌色；② 新增语义选中面 token（并**同改 `:root` 与 `[data-color-scheme="light"]` 两处**）。否则正式违反 DESIGN §4.1。
  2. 🆕 **品牌金 token 不存在（T007 新增）**。`topbar/BrandMark` 的描边/渐变取 `--v2-icon-icon-accent` / `--v2-icon-icon-accent-hover`，而这两个 token 今天**都是蓝色**（`--v2-blue-600` / `--v2-blue-700`），**整个 v2 色板无任何金色 token**。按宪法 §八不能硬编码 `#F59E0B`/`#B45309`，故 **logo 现在是蓝的**，DESIGN §5.1 的蜂蜜金要等 T017 换皮生效（换皮后组件无需改动）。
- ✅ **已解决（原「T008 前须定：T007 的 `Topbar` 未接线」）**：T008 已把 `Topbar` 挂进 `#opencode-titlebar-right`（经 `pages/layout-new.tsx` 的 `useTitlebarRightMount()` 注入 + `<Portal>`），并建立身份接入缝 `workspace/current-user.ts`。**身份未就位时顶栏不渲染用户区**（宁缺勿假，未采纳「塞占位身份」方案）；F2 落地时**只改 `current-user.ts` 一个文件**。
- 🔴 **待决项（须尽快定，建议补任务）**：**右栏（AI 会话）无任务供给**（T008 发现）。FR-001 要求「右栏 AI 会话」，但 T001–T017 里没有任何任务把 AI 会话放进 `ThreePane` 的右槽（plan.md ① 把它列为「换皮 + 重定职责」却未派生 task；T003 备注「右栏由 T007/T009 供给」**是错记**——T007 顶栏、T009 中栏 tab 栏）。**建议补一个任务**（把 `pages/session/session-side-panel.tsx` 换皮 + 重定职责后填入右槽，或在 001 明确记为「右栏内容归 F8」并据此降低 FR-001 的验收口径）。在此之前，FR-001 的右栏仍只是「位置已定义、内容空缺」。
- 🆕 **待决项（T009 起须留意）**：**`#opencode-titlebar-right` 是共享注入点**。上游 `new-session-view.tsx:77-93`（`NewSessionStatus`）与 `session-header.tsx:285` 都往同一元素 Portal；T008 挂上的 openhive 顶栏会与它们**并列出现在顶栏右侧**。T017 浏览器核对时须定归属/顺序（可能与 T009「顶栏 session tab 条 vs 中栏 tab 容器」的分工是同一类问题）。
- 🆕 **待决项（T007 前须定，T010 后已累计）**：**plan.md 文件结构与实际产出的偏差**。T006 交付了 `rail/entries.ts` **和** `rail.tsx`（plan.md:61-62 只列了 `entries.ts`）；T007 新增 `topbar/` 下 4 个源文件；T008 新增 `workspace/workspace-entry.tsx` + `workspace/current-user.ts`（plan 的 `workspace/` 只列了 `three-pane.tsx`）；T009 新增 `center/module-color.ts` + `center/tab-overflow.ts`；**T010 新增 `center/tab-context.tsx`**；**T011 新增 `center/module-actions.ts`**；**T012 新增 `center/file-content.ts` + `center/center-content.tsx` + `center/views/index.ts` + `center/views/binary-view.tsx`**；**T013 新增 `center/views/sheet-view.tsx`**（plan.md:69-70 的 `center/` 只列了 `tab-bar.tsx` + `tab-store.ts` + `view-registry.ts` + `views/`）。**须一次性回改 plan.md 文件结构**，或明确声明为计划外新增。⚠️ 按此规律 **T014 还会再添 4 个 `views/*-view.tsx`**，回改宜等 T014 落地后一次做完。
- 🆕 **待决项（T010 新增，T017 视觉核对前定）**：**中栏 tab 栏「一个 tab 都没有」时怎么呈现**。首屏就是这个状态（FR-010：tab 由模块动作打开，非预置常驻），现在渲染的是一条 **40px 空条**。**DESIGN §4.5 没定**空态，我没擅自加「空则不渲染」——须设计侧定后改（改动只在 `workspace-entry.tsx` 一个 `<Show>` 或 `tab-bar.tsx` 一处）。
- 🆕 **待决项（T009 新增，可延后，设计侧复核）**：**DESIGN.md §4.5 的两项裁量**——① 「模块 → 实体身份色」的**取值**（仅「话单=蓝」有 §1.3 既有依据，其余五个按色相可区分性挑）；② **用「模块图标」取代 front 参考件的「文件类型图标」** 这一选择。改色只动 §4.5 表 + `center/module-color.ts` 一处映射，组件不受影响；改图标选型同 T006/T007 的图标评审一并看。
- 🆕 **待决项（可延后，T017 视觉核对时定）**：**图标选型需设计评审**。DESIGN §4.2 未点名具体图标——T006 自选 `folder` / `archive` / `speech-bubble` / `bullet-list` / `branch` / `settings-gear`；T007 又自选 `comment`（站内信，因原生集**无 `bell`**）、`expand`（全屏）；**T009 的溢出按钮「⋯」直接用字面字形 U+22EF**（原生 97 个图标名里**无** `ellipsis` / `more-horizontal` / `dots`，已核）。语义是否贴合需人看（类型安全已由 `IconProps["name"]` 保证；宪法 I 禁止往上游 `icon.tsx` 加图标）。
- ✅ **已解决（原「T006 遗留：`icon.css` 会不会盖住父级 `text-v2-icon-*`」）**：T009 查实——`packages/ui/src/components/icon.css:8` 给 `[data-component="icon"]` 显式 `color: var(--icon-base)`，而 legacy `theme.css:243` 在 `:root` 全局定义了 `--icon-base: #8f8f8f`。**结论：父级 `text-v2-icon-*` 确实不会给 `Icon` 上色**，必须由**祖先元素提供 `--icon-base`**（自定义属性继承）。T009 的 tab 模块色即按此实现（wrapper 提供 inline `--icon-base`）。**T017 视觉核对与后续任何 Icon 着色都适用此条**；仍按宪法 I 不改上游 CSS。
- 🆕 **待决项（可延后，设计侧复核）**：**DESIGN.md 新增的 §4.4 顶栏章节的措辞是我拟的**。因宪法 §八要求「未覆盖的先在 DESIGN.md 补充再引用」，而 DESIGN 原本完全没有顶栏章节，T007 先补了 §4.4（四要素表 + 高度沿用原生 36px + 只引用 token + 品牌名走配置）。**内容与措辞需设计侧过一眼**。
- 🆕 **待决项（T011/T016 前须定）**：注册表只认**扩展名**，但 plan.md「数据流向」要求数据轴也汇入注册表，而「数据明细 / 可视化图表 / 分析记录」无扩展名。要么给注册表加一条非扩展名的键通道，要么让数据轴绕过注册表（动作直接携带组件）。**（用户已确认此发现成立）**
- 🆕 **待决项（T012 前须定）**：**FR-007 的「10 类」逐项枚举**。用户已确认口径 = **日常办公常见的 10 类文件**，原列的「数据明细 / 可视化图表 / 分析记录」**不计入**（它们与上一条数据轴待决项是同一个问题）。已落修订记录 2026-09-27b 于 `spec.md` / `tasks.md`。
  **候选提案（我拟，未获确认，仅作 T012 的起步锚点）**：① 文档 `.doc/.docx` ② 表格 `.xls/.xlsx/.csv` ③ 演示 `.ppt/.pptx` ④ PDF `.pdf` ⑤ 图片 `.png/.jpg/.jpeg/.gif/.bmp/.webp` ⑥ 文本/图文混排 `.txt/.md/.rtf` ⑦ 思维导图 `.xmind`（或 `.mm`）⑧ 压缩包 `.zip/.rar/.7z` ⑨ 音视频 `.mp3/.mp4/.wav` ⑩ 代码/配置 `.json/.xml/.yaml`。**待用户裁定后再动 T012**；⑧⑨ 是否要"预览"还是只"下载"也需一并定。
- ✅ **已解决（原「T009/T012 前须定：应用级共享注册表实例放哪」）**：T012 已落——**机制**归 `center/view-registry.ts`（`createViewRegistry()` 工厂，保持不变），**注册了哪些**归 `center/views/index.ts`（导出 `viewRegistry` 单例 + 两条 `register`）；**归属分离**使得「单例」与「视图清单」各改各的。由 `WorkspaceEntry` **注入**给 `CenterContent`（`registry` prop）而非被中栏 import——组件测试得以各用各的注册表，不需要全局复位钩子（与 T010 弃模块级单例的理由一致）。
- 🔴 **待决项（T012 新增，请复核）**：**中栏视图的生产侧 loader 供给方不存在**。`CenterContent` / 视图的取数走注入的 `loadFile`，通路与集成测试都齐了，但**应用入口拿不到合法的 directory-scoped 文件源**：`useSDK()` 只在路由页内部可用（`pages/directory-layout.tsx:117`、`pages/session.tsx:273`），而 `WorkspaceEntry` 所在的 `NewLayout` 在其上层（`app.tsx:371-379`）。候选解法：① 把文件源上提到工作台层（要动上游 provider 层级，须评估宪法 I 的冲突面）；② 改 context 注册制（路由页把 client 注册进一个 context，工作台层消费——**与 T010 记的「不用模块级单例、避免全局复位钩子」相冲突，需权衡**）；③ 若 F2 的模块 UI 本就自带文件源，则此缝可由模块侧供给。**在定下之前，`.docx` / `.pdf` 视图在生产链路上取不到内容（停在空态），001 不因此假装已能「点开文件」。**
- 🆕 **待决项（T012 新增，T017 前定）**：**pdfjs 的 `GlobalWorkerOptions.workerSrc` 未配置** → 当前退回主线程渲染（功能可用但大文件会卡主线程）。属 **Vite 构建期**配置（`new Worker(new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url), {type:"module"})` 或 `?url` 导入），**本环境（bun test / happy-dom）无从验证**，须在 T017 真实浏览器中配置并核对。
- 🔴 **待决项（T011 新增，请复核）：T011 的范围裁量**。T011 原文「实现『特有 tab 由模块动作打开』的机制」在本 feature 里**没有可供它服务的模块 UI**（001 只有框架）。我把边界定在**动作层**：模块如何声明/触发动作、来源模块如何确定、初始零 tab——并**刻意不造**「动作清单渲染」「动作 → 视图渲染的中栏路由」这类此刻无消费者的抽象（Simplicity First），也**未动** `view-registry.ts`。**若认为 T011 应一并交付「动作 → 视图渲染」，请指出**——那会与 T012 的首个真实视图合并考虑（且需先定上面「共享注册表实例」与「数据轴键通道」两条）。
- 🆕 **待决项（T011 新增，数据轴落地时收口）**：`ContentTab.path` **命名遗留**。FR-010 的动作 tab 里，数据轴（F6/F7）的内容标识是数据视图键（`detail:acct-4419`）而非文件路径，`path` 这个字段名届时名不副实。T011 的动作层已用中性的 `ModuleAction.content` 表达该键，**但 `ContentTab` 与 `contentTabKey` 仍是 T005 的 `path`**——改名波及 `tab-store.ts` / `tab-bar.tsx` 及 T005/T009/T010 三个测试文件，故**未在本任务顺手改**（Surgical Changes），待数据轴真正落地时与「注册表键通道」一并收口。

## 最后更新
2026-09-27（**T014 前置：视图注册表改懒加载 —— 按宪法 §四单独提交，不含 T014 的视图代码**。契约 `component: ViewComponent` → `load: ViewLoader = () => Promise<ViewComponent>`（`resolve()` 交回的是「怎么拿到组件」而非组件本身）；`views/index.ts` 三条注册改 `async () => (await import("./xxx-view")).XxxView`；`CenterContent` 随之**改异步解析**——`createEffect` 里算 loader，用 `alive` 标志 + `onCleanup` 丢弃迟到结果。🔴 **空档期（chunk 还没到）取「留住旧视图」而非清空**：清空会因页面层随 `view()` 真假翻转而把调用方的路由页**翻出来闪一下**（用户已明确「不能让用户感觉到慢」）；但**加载失败必须收手清空**，否则民警会对着「卷宗.pdf」这个标题看立项书的内容——**「还没好」与「好不了」是两回事**，三条新测试分别钉住留旧 / 失败收手 / 迟到不覆盖。🔴 **实测（新增核对手段 `bun run build`）**：三个预览库各自成 chunk `document-view` 174.31 kB / `sheet-view` 366.22 kB / `pdf-view` 436.06 kB（gzip 51 / 124 / 131），入口 chunk **对三者零命中**（同一 pattern 在三个视图 chunk 里 6 / 1 / 1 命中）。**未做「改前 vs 改后」入口体积对账**，故**不声称节省了 976 kB**，只记「各自成 chunk + 入口零命中」。🔴 **一处测试写法被迫升级**：`workspace-entry.test.tsx` 原用 `await 落定()`（睡一个 0ms）等「动作 → 视图」，而懒加载让这条链**以动态 import 起头**（读盘 + 编译），一个 tick 等不到 → 两条集成测试变红；改**有上限的轮询等待 `等到(条件)`**（断言仍由调用方下，等不到就是失败）。⚠️ **一条非行为测试、已诚实标注**：`views/index.test.tsx` **读源码**禁止静态 import 回潮——「首屏体积」在单元测试里没有 DOM 可观测面，它只是回归守卫，不能证明包变小。⚠️ 门禁：test:unit **774 pass**（773 + 1）、test:components **92 pass**（88 + 4）、test:browser **41 pass**（与基线一致）、typecheck **30/30**、定向 oxlint **0 命中**（中途自留 1 个孤儿变量 `落定` 已清）；全仓 lint 仍 exit 1 / **4902 warnings + 1 error**（既有上游 `\200B`，与 T013 末逐字一致）。📌 **T014 范围同时裁定并记入 `tasks.md` 修订记录 2026-09-27c**：4 个视图缩为 3 个（`image-view` / `richtext-view` / `mindmap-view`），**PPT 拆出为新增的 T018**（design-v2 §9.5 的服务端 LibreOffice 方案与 `[FE]` 标签相冲，方案未定前不实现）；`.xmind` 归导图、`.md`/`.txt` 归图文、`.rtf` 本轮不做。）

2026-09-27（T013 完成：**表格视图（FR-007 的第三类，`.xls/.xlsx/.csv`，SheetJS）**——新增 `center/views/sheet-view.{tsx,test.tsx}`（`renderSheet` 字节→表格 + 接进 `BinaryView` 壳的 `SheetView`，8 条测试，夹具是 SheetJS 自造的真 xlsx 字节）；改 `center/views/index.ts`（注册三类扩展名）+ `index.test.tsx` + `packages/app/package.json` + `bun.lock`（**净 +3 行、零 churn**）。**依赖按用户裁定走 SheetJS 官方 CDN**（npm 版 0.18.5 的两个 CVE 无 fixed 版本且只在读特制文件时触发，正是本产品用法）。🔴 **探针发现 SheetJS 对特定 10 字节输入死循环、`XLSX.read` 永不返回**——同步 CPU 死循环，`try/catch`/超时/`AbortController` 全无效，**留 T017 处置**（Worker+超时已验证可行但属构建期配置）。⚠️ 中文 CSV 默认按 Latin-1 解会乱码，`codepage: 65001` 修好（不修则 `.csv` 整类废掉）；**SheetJS 对多数垃圾字节不抛错而是当 CSV「成功」解析**，故「坏文件→error」必须用 PK 头输入才能测。🔴 **顺手修掉 T012 埋的真缺陷**：`CenterContent` 用 `<Show fallback={props.children}>`，`Show` 的分支互换会**卸载重挂** `props.children`——它在生产里是上游路由页面，**点一张有视图的 tab 就丢掉整页状态**；T013 一注册新扩展名就踩响（`workspace-entry` 的 tab 激活测试 pass→fail，A/B 确证）。改为**页面常驻、只藏不卸**（`display: contents` ↔ `none`），先写 RED 钉住。⚠️ **一处假绿**：第一版「只挂载一次」测试传了已求值的 `<页面 />` 元素 → 通过但什么都没测；改传组件函数 + `<Dynamic>` 后立刻真 RED。⚠️ **lint 首轮 3 条 + 我修法自引入 2 条，根因是我把 `sheet_to_json<T>` 的 `T`（行类型）漏了外层 `[]`**，跟着 lint 换了两轮语法都没用，补对类型后同时消失。门禁：test:unit **773 pass**（与 T012 末一致）、test:components **88 pass**（77 + 11）、test:browser **41 pass**（与基线一致）、typecheck **30/30**（首轮即过）、定向 oxlint **0 命中**；全仓 lint 仍 exit 1 / **4902 warnings + 1 error**（既有上游 `\200B`，与 T012 末逐字一致）。新待决项：**SheetJS 死循环（T017 阻断）** + **三个视图库静态 import、包体积未评估（宜在 T014 前定契约）**。）

2026-09-27（T012 完成：**文档与 PDF 视图（FR-007 的头两类）+ 中栏内容区路由**——新增 `center/file-content.ts`（取数接缝 + base64→字节）、`center/views/binary-view.tsx`（字节型视图公共壳）、`center/views/document-view.tsx`（docx-preview）、`center/views/pdf-view.tsx`（pdfjs-dist）、`center/views/index.ts`（**应用级注册表单例，解掉 T004/T009 记的待决项**）、`center/center-content.tsx`（激活 tab → 扩展名 → 注册表 → 视图）；改 `view-registry.ts`（`ViewProps` 加宽为 `{ path, load? }`）、`workspace-entry.tsx`（加 `loadFile` prop + 挂 `CenterContent`）、`packages/app/package.json`（+2 显式版本依赖，**不进根 catalog**）、`bun.lock`（**净 +55/−5**，其余为 bun 传递依赖重提升）。**6 个新文件 + 1 个文件新增，共 28 条测试**。test:unit **773** pass（769 + 4）、test:components **77** pass（53 + 24）、test:browser 41 pass、typecheck 30/30（首轮真报错 1 处已修）、本任务目录 oxlint 首轮 1 条 `consistent-return` 已修。🔴 **一处与裁定 #3 有落差，请复核**：通路已补且有集成测试证明 `loadFile` 一路走到视图，但**生产侧没有合法的 loader 供给方**（directory-scoped SDK client 只在路由页内部，`WorkspaceEntry` 在其上层）→ `loadFile` 留作注入点，**不假装已能点开文件**。⚠️ **一处非 RED 驱动**：`BinaryView` 的竞态令牌是先写的，已补测试 + 临时把守卫改成恒真验证它有牙（立刻 RED）后恢复，如实记录。⚠️ **L2 缺口**：Word/PDF **画面是否真的渲染出来**在 happy-dom 下验不了（无 CSS/Canvas 引擎），留 T017；**pdfjs worker 也未配**（退回主线程）。（T011 完成：**模块动作打开特有 tab（FR-010）**——新增 `center/module-actions.ts`（`ModuleAction { title, content }` + `useModuleAction()`）。**来源模块由 hook 取当前模块**（不手填，FR-005 着色的来源就不会传错）；当前模块未定时**不响应**（不开假来源 tab）；**动作是特有 tab 的唯一来源**，进门时中栏零 tab（非预置常驻）。`content` 是**不可解释的内容键**（001 = 路径；数据轴 F6/F7 = 数据视图键），故**不必先解开「注册表只认扩展名」那个结**。🔴 **真 RED 一次**：无守卫实现先绿 → 补「当前模块未定」测试立刻 RED（收到 `{ module: undefined, … }`）→ 加守卫转绿，**边界是测试逼出来的**。test:components **53** pass（47 + 5 + 1 集成守卫）、test:unit **769** pass、test:browser 41 pass、typecheck 30/30、本任务目录 oxlint 0 命中。⚠️ 全仓 lint 仍 exit 1 / **4901** warnings + 1 error（既有上游；计数较 T010 末少 1，属已记录的 ±1 抖动，**不代表修好了什么**）。⚠️ **两处范围裁量待复核**：① T011 边界止于「动作层」，未含「动作 → 视图渲染」；② `ContentTab.path` 命名遗留未顺手改。）

2026-09-27（T010 完成：**中栏 tab 接线 + FR-006 联动**——新增 `center/tab-context.tsx`（`CenterTabsProvider` + `useCenterTabs`），`WorkspaceEntry` 拆为「provider 外层 + `WorkspaceBody` 消费层」，图标栏当前模块与中栏 tab **共用同一份状态**（T008 的组件内 signal 上移进 `CenterTabState.module`），`<TabBar>` 挂进 `ThreePane` 中栏顶部。**切模块不清空 tab 因此是结构性的，不靠额外判断**。`tab-bar.tsx` 补 `w-full`（中栏是 `flex-col items-start`，缺它会缩到内容宽度）+ 「量不到宽度先全显示」。🔴 **抓到一次假绿**：测试用 `{...{availableWidth: undefined}}` 覆盖默认值，而 Solid 的 spread 跳过 `undefined` 键 → 测试空转立刻通过；改 `"availableWidth" in props` 后立刻真 RED。test:unit **769** pass、test:components **47** pass、test:browser 41 pass、typecheck 30/30、本任务目录 oxlint 0 命中（首轮 1 条 unused import 已删）。⚠️ 全仓 lint 仍 exit 1 / 4902 warnings + 1 error（既有上游，与 T009 末逐字一致）。）

2026-09-27（T009 完成：**中栏 tab 栏**——新增 `center/tab-bar.tsx` + `center/module-color.ts`（模块→身份色变量名）+ `center/tab-overflow.ts`（溢出判定纯函数）+ 3 个测试文件（11 单测 / 8 组件测试）。**未挂载**，留给 T010。🔴 裁定了一个 MUST 级冲突（FR-005「按模块着色」vs DESIGN §4.2「无模块徽章」）→ **着色≠徽章**，依宪法 §八**先补 `openhive-DESIGN.md` §4.5** 再写码，并改掉 §1.3 自相矛盾的「话单模块徽章」行。**不新增任何 hex/token**（复用 `--v2-avatar-bg-*`；激活态取既有 `--v2-background-bg-accent`，不写 `#D97706`）。💡 **回答了 T006 遗留疑问**：`Icon` 的色来自 `--icon-base`，父级 `text-v2-icon-*` 无效，须由祖先元素提供。test:unit **769** pass、test:components **37** pass、test:browser 41 pass、typecheck 30/30（首轮真报错 1 处已修）、本任务目录 oxlint 0 命中（首轮 4 条已修）。⚠️ 全仓 lint 仍 exit 1 / 4902 warnings + 1 error（与 T008 末逐字一致）。）

2026-09-27（T008 完成：**入口接线**——新增 `workspace/workspace-entry.tsx`（图标栏 → 三栏 + 顶栏挂上游注入点）+ `workspace/current-user.ts`（身份接入缝）+ 7 个组件测试；改 3 个既有文件共 3 行 + `topbar.tsx` 的 `user` 改可选。T007 移交的两件事均已落地。**`layout-new.tsx` 只动 3 行**。test:unit 758 pass（与 T007 末一致）、test:components **29** pass、test:browser 41 pass（主动复跑）、typecheck 30/30、本任务目录 oxlint 0 命中。🔴 发现**计划缺口：右栏（AI 会话）无任务供给**，建议补任务。⚠️ `#opencode-titlebar-right` 是共享注入点，会与上游会话状态并列）

2026-09-27（T007 完成：顶栏 `topbar/`（品牌 Logo / 站内信 / 全屏 / 用户下拉）+ 20 个测试；test:unit 758 pass、test:components 22 pass、typecheck 30/30 曾真实报错 1 处已修、lint 本任务 8 文件 0 命中。**DESIGN.md 新增 §4.4 顶栏**。**两处红旗**：① `Topbar` **未接线**（无登录态来源，已移交 T008）；② 🔴 T017 阻断项由 1 条扩为 2 条——除选中底色外，**品牌金 token 也不存在**（`--v2-icon-icon-accent` 今天是蓝色，logo 因此暂时是蓝的）。另：复核推翻了「`#opencode-titlebar-left` 可用」的结论——它只在 legacy 分支）
