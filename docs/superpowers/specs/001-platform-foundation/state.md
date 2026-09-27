# 实施进度 · 平台底座（三栏工作台）

## 当前任务
T006 已完成。**T007 待启动**（等用户说「next」）。

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

## 质量门禁（T006 末）
> 工作基点：`multi-tenant` @ `028d019ef1`（`packages/app` v1.18.29）。

| 门禁 | 结果 | 归因 |
|---|---|---|
| `packages/app` `bun run test:unit` | ✅ **748 pass / 0 fail**（107 files） | 干净（T005 末 744 + T006 新增 4） |
| `packages/app` `bun run test:components` | ✅ **12 pass / 0 fail**（30 expect） | 干净（T005 末 6 + T006 新增 6） |
| `bun run typecheck`（turbo，根目录） | ✅ **30 successful / 30 total** | 曾真实报错 1 处，已修（见下） |
| `bun run lint`（oxlint，根目录） | ❌ **exit 1**：4902 warnings / **1 error** | **既有上游、已决策记为「已知红」**，见下 |

**T006 触碰文件 lint 自查**（`bunx oxlint packages/app/src/rail`）：**0 warning / 0 error**（4 files）。全仓那 **1 个 error 仍是既有上游**那条（`packages/session-ui/src/v2/components/prompt-input/index.tsx:163` 八进制转义），跨平台真实存在、与基点逐字节相同。

> ⚠️ **typecheck 修了什么**：`entries.test.ts:20` 的 `expect(visibleEntries(RAIL_ENTRIES)).toEqual(RAIL_ENTRIES)` 报 `TS2769`（`readonly RailEntry[]` 不可赋给可变形参）。**改的是断言** → `[...RAIL_ENTRIES]`（`toEqual` 走深比较，断言强度不变），**没改生产类型**——`visibleEntries` 返回可变数组是刻意的（给调用方留排序余地）。

> ⚠️ **warning 计数诚实标注**：T005 末记 4901，本次 **4902**（+1）。T005 已记录过同一抖动现象（oxlint 12 线程输出计数不稳定）。本任务 4 个文件在 lint 输出中 **0 命中**，故**只主张「我引入 0 命中」，不主张「4902 = 我引入」**，也不主张「4902 是既有噪声」——两轮读数差 1 而代码面无从属关系，**归因不明**，如实记为「未解释的 ±1 抖动」。

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
- ✅ **已解决（原「T006 前须定：能力位 / `is_admin` 契约口径」）**：用户 2026-09-27 裁定**「001 只出接口，门禁留给 010」**。T006 已按此落 `visibleEntries` 过滤接口（不接签发方）；同源问题（FR-003「用户管理」管理员专属 vs 001 无 admin 门禁）同样留待 010。**归属更正**：原记录写成「T006 前须定」有误——该项实属 FR-003 → **T007（顶栏下拉）**，非 FR-002 → T006（图标栏）；T006 只需出过滤接口，已具备。
- 🔴 **待决项（T017 前须定 / T017 阻断项）**：**选中底色的品牌色 token 不存在**。DESIGN §1.3/§4.1 要求选中底 = 浅金 `#FEF3C7`，但 v2 的 overlay 语义 token 只有中性黑/白 alpha，**无品牌色 overlay token**；T006 暂用 `--v2-overlay-simple-overlay-pressed`（中性灰，仓库既有「选中面」token）。按宪法 §八不能硬编码 `#FEF3C7`，按宪法 I `theme.css` 归 T017。**T017 须二选一**：① 全局重定 `overlay-pressed` 为品牌色；② 新增语义选中面 token（并**同改 `:root` 与 `[data-color-scheme="light"]` 两处**）。否则正式违反 DESIGN §4.1。
- 🆕 **待决项（T007 前须定）**：**plan.md 文件结构与实际产出的偏差**。T006 交付了 `rail/entries.ts` **和** `rail.tsx`，但 plan.md:61-62 只列了 `entries.ts`。**须回改 plan.md 文件结构**（补上组件文件），或明确声明为计划外新增。同类偏差可能还会在 T007/T009 出现，宜一次性回改。
- 🆕 **待决项（可延后，T017 视觉核对时定）**：**图标选型需设计评审**。DESIGN §4.2 未点名具体图标，T006 自选 `folder` / `archive` / `speech-bubble` / `bullet-list` / `branch` / `settings-gear`。语义是否贴合需人看（类型安全已由 `IconProps["name"]` 保证）。
- 🆕 **待决项（T011/T016 前须定）**：注册表只认**扩展名**，但 plan.md「数据流向」要求数据轴也汇入注册表，而「数据明细 / 可视化图表 / 分析记录」无扩展名。要么给注册表加一条非扩展名的键通道，要么让数据轴绕过注册表（动作直接携带组件）。**（用户已确认此发现成立）**
- 🆕 **待决项（T012 前须定）**：**FR-007 的「10 类」逐项枚举**。用户已确认口径 = **日常办公常见的 10 类文件**，原列的「数据明细 / 可视化图表 / 分析记录」**不计入**（它们与上一条数据轴待决项是同一个问题）。已落修订记录 2026-09-27b 于 `spec.md` / `tasks.md`。
  **候选提案（我拟，未获确认，仅作 T012 的起步锚点）**：① 文档 `.doc/.docx` ② 表格 `.xls/.xlsx/.csv` ③ 演示 `.ppt/.pptx` ④ PDF `.pdf` ⑤ 图片 `.png/.jpg/.jpeg/.gif/.bmp/.webp` ⑥ 文本/图文混排 `.txt/.md/.rtf` ⑦ 思维导图 `.xmind`（或 `.mm`）⑧ 压缩包 `.zip/.rar/.7z` ⑨ 音视频 `.mp3/.mp4/.wav` ⑩ 代码/配置 `.json/.xml/.yaml`。**待用户裁定后再动 T012**；⑧⑨ 是否要"预览"还是只"下载"也需一并定。
- 🆕 **待决项（T009/T012 前须定）**：应用级共享注册表实例放哪（T004 只给了 `createViewRegistry()` 工厂，刻意的）。

## 最后更新
2026-09-27（T006 完成：图标栏 `rail/`（五入口 + 系统设置 + capability 过滤接口）+ 10 个测试；test:unit 748 pass、test:components 12 pass、typecheck 30/30 曾真实报错 1 处已修、lint 本任务 4 文件 0 命中。**新增 T017 阻断项（选中底色无品牌色 token）**、**新增 plan.md 文件结构回改待办**；原「T006 前须定：能力位口径」已由用户裁定解决并更正归属到 T007）
