# 实施进度 · 平台底座（三栏工作台）

## 当前任务
T003 已完成。**T004 待启动**（等用户说「next」）。

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

## 质量门禁（T003 末）
> 工作基点：`multi-tenant` @ `028d019ef1`（`packages/app` v1.18.29）。

| 门禁 | 结果 | 归因 |
|---|---|---|
| `packages/app` `bun run test:unit` | ✅ **725 pass / 0 fail**（104 files） | 干净（与 T002 末持平；T003 新增的 `.tsx` 测试已由 `--path-ignore-patterns` 排除） |
| `packages/app` `bun run test:components` | ✅ **6 pass / 0 fail**（19 expect） | T003 新增门禁（本包首个组件测试入口） |
| `packages/app` `bun run test:browser` | ✅ **41 pass / 0 fail**（14 files） | 干净（未受影响） |
| `bun run typecheck`（turbo，根目录） | ✅ **30 successful / 30 total** | 持续绿 |
| `bun run lint`（oxlint，根目录） | ❌ **exit 1**：4903 warnings / **1 error** | **既有上游、已决策记为「已知红」**，见下 |

**T003 触碰文件 lint 自查**（`bunx oxlint <4 个文件>`）：**0 error / 1 warning**，且该 warning 位于 `layout-new.tsx:20:7`（`consistent-return`）——**在我未触碰的第 19–20 行**，属既有噪声。我自己的新文件（`three-pane.tsx` / `three-pane.test.tsx` / `solid-jsx.ts`）**0 命中**（首轮 `three-pane.test.tsx:8:10` 的 `no-unsafe-type-assertion` 系我引入，已把 `mount(element: () => unknown)` 改为 `() => JSX.Element` 消除）。

### 唯一仍在红的门禁：lint 的 1 个 error（已知，待上报上游）
上游 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163` 的 `content-['\200B']`（Tailwind 类里的八进制转义）。该文件与基点**逐字节相同**，跨平台真实存在（非 Windows 特有）。修它需改上游文件 → 违反宪法 I（最小化合并冲突），**决策：不在本项目内私改，记为已知红，上报上游**。本次新增文件在 lint 输出中 **0 命中**；4902 条 warning 亦为既有噪声。

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
- 🆕 **待决项（T006 前须定）**：能力位 / `is_admin` 契约口径。001 的 FR-003 把「用户管理」列为固定下拉项，但 `010/spec.md:121` FR-001 要求它是**管理员专属**，而 001 内**零 admin 门禁**。两者需在 T006 读 capability 之前对齐。

## 最后更新
2026-09-27（T003 完成：三栏容器 + 最小挂载 + 前端组件测试地基；test:unit 无回归、组件测试 6 绿、typecheck 30/30；lint 仍唯 1 个既有上游 error 已知红）
