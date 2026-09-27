# T001 产出 · 改造落点清单（三栏真实组件定位）

**Feature**: `001-platform-foundation` · **Task**: T001 [FE·换皮]
**日期**: 2026-09-27
**出参要求**: 三栏真实组件路径 + 可改造点说明
**核实基点**: 分支 `multi-tenant` @ `028d019ef1`（`packages/app` v1.18.29）
**行号性质**: 本文档所有 `path:line` 均在上述基点上**逐条核取**（非估算）

---

## 0. 结论摘要（含一条阻断性发现）

1. **三栏真实组件已定位**——但全部落在 **legacy 布局**（`pages/layout.tsx` + `pages/layout/sidebar-shell.tsx`）。
2. **阻断性发现：legacy 布局已被上游「退休」，是死代码。** 当前运行时恒走 **new 布局**（`pages/layout-new.tsx`），而 new 布局**只有 Titlebar + 单个 `<main>`，不存在图标栏、不存在左栏导航**。
3. 因此 plan.md「前端换皮区」表里作为靶子的三行，有**两行指向不可达代码**；且 plan.md 的 token 映射靶子（legacy `--xxx` 语义变量）**不是 new 布局实际读取的变量**（后者是 `--v2-*`）。
4. plan.md §风险 R4 已预判「具体源码路径需实现时定位」，T001 正是该风险的兑现点。**结论是偏差比 plan 预期的大：不止路径要改，而是「三栏靶子建在哪」需要定夺。**

> 该发现影响 T003/T006/T007/T009–T011。**本文档不擅自改 plan.md**——`session.md` 已锁定「plan 已定稿，禁止重新规划」。待决事项见 §6。

---

## 1. 布局开关真相（核实证据）

### 1.1 两套布局并存，由一个 flag 切换

| 位置 | 内容 |
|---|---|
| `packages/app/src/app.tsx:596` | `<Show when={newLayoutDesigns()} fallback={routerProps.children}>` → 真值走 `NewAppLayout` |
| `packages/app/src/app.tsx:597` | `<NewAppLayout serverScoped={…}>{routerProps.children}</NewAppLayout>` |
| `packages/app/src/app.tsx:588` | `<Show when={newLayoutDesigns().toString()} keyed>` 包住整个 Router——`.toString()` 后 `"true"`/`"false"` **都是真值**，故**不是开关**，而是借 `keyed` 在 flag 翻转时**整体重挂 Router** 的手法 |
| `packages/app/src/app.tsx:371-379` | `NewAppLayout` 定义 → `SelectedServerProviders` → `ServerScopedProviders` → `<NewLayout>`（`:375`） |
| `packages/app/src/app.tsx:61-62` | `import LegacyLayout from "@/pages/layout"` / `import NewLayout from "@/pages/layout-new"` |
| `packages/app/src/pages/layout-new.tsx:26-32` | 外层 div（`bg-v2-background-bg-deep`） |
| `packages/app/src/pages/layout-new.tsx:33-40` | `<Titlebar update={…} debugTools={…} />` |
| `packages/app/src/pages/layout-new.tsx:41-43` | **`<main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">`** — new 布局中栏 |
| — | 该文件**全文仅 49 行**。**无 rail、无 sidebar、无三栏骨架、无 tab 容器。** |

### 1.2 判定「legacy 已退休」的推理链

| 位置 | 内容 | 效果 |
|---|---|---|
| `packages/app/src/context/settings.tsx:63` | `export const oldInterfaceSunset = new Date(2026, 8, 14)` | 退休日 = **2026-09-14** |
| `packages/app/src/context/settings.tsx:251` | `const [oldInterfaceRetired, setOldInterfaceRetired] = createSignal(sunset ? Date.now() >= sunset.getTime() : false)` | 今天 2026-09-27 **已过** → `true` |
| `packages/app/src/context/settings.tsx:289-302` | sunset 定时器 effect（到点自动置 retired） | 保证会翻转 |
| `packages/app/src/context/settings.tsx:129` | `resolveNewLayoutDesigns(retired, preference, fallback) { if (retired) return true; return preference ?? fallback }` | **retired 为真时无条件返回 `true`，用户偏好被忽略** |
| `packages/app/src/context/settings.tsx:61` | `export const newLayoutDesignsDefault = true` | 兜底也是 new 布局 |
| `packages/app/src/context/settings.tsx:263-278` | `newLayoutDesigns` memo 全部三条分支 | 任一路径都落 `true` |

⇒ `newLayoutDesigns()` 在当前运行时**恒为 true**。

**路由层同步佐证**（`packages/app/src/app.tsx`）：

| 位置 | 内容 |
|---|---|
| `:620-624` | `<Route component={…LegacyServerLayout…}>` 外层 |
| `:625` | `<Show when={!settings.general.newLayoutDesigns()}>` — legacy 路由分支 |
| `:628-629` | `/:` → `LegacyHome` / `/server/:serverKey/session/:id` → `LegacyTargetSessionRoute` |
| `:633-636` | `/:dir` 系列（两套布局共用） |
| `:638` | `<Show when={settings.general.newLayoutDesigns()}>` — new 路由分支 |
| `:639-641` | `NewHome` / `NewLayoutLegacySessionRedirect` / `TargetSessionRoute` |
| `:643` | `/new-session` → `DraftRoute`（无 gate） |

### 1.3 交叉验证：rail 全仓仅 5 处引用，全在 legacy 对

```
sidebar-shell.tsx:15   export const SidebarContent         ← 定义
sidebar-shell.tsx:52   data-component="sidebar-rail"       ← 根节点
layout.tsx:84          import { SidebarContent } from "./layout/sidebar-shell"
layout.tsx:203         querySelector("[data-component='sidebar-rail']")   ← aim 追踪锚点
layout.tsx:2222        <SidebarContent … />                ← 唯一实例化点
```

**`SidebarContent` / `sidebar-rail` 在 new 布局侧零引用**（`layout-new.tsx` / `titlebar.tsx` / `session-side-panel.tsx` / `layout-tabs.ts` 均不涉及）。

### 1.4 右栏是例外——new 布局下仍然存在

```
session.tsx:2304   <Show when={!newSessionDesign() && desktopSidePanelOpen()}>
session.tsx:2306      <SessionSidePanel/>        ← 分支 A（legacy，:2304-2321）
session.tsx:2322   <Show when={newSessionDesign()}>
session.tsx:2323      <Show when={isDesktop() ? desktopV2PanelLayout().visible : terminalOpen()}>
session.tsx:2325         <Show when={isDesktop() && (desktopV2ReviewOpen() || desktopFileTreeOpen())}>
session.tsx:2328            <SessionSidePanel/>  ← 分支 B（new 布局路径，存活）
```

⇒ **右栏 new 布局有**，**图标栏/左栏 new 布局无**。

---

## 2. 三栏落点清单（现状）

### 2.1 图标栏 rail —— ⛔ new 布局不存在，需新建

| 位置 | 内容 | 说明 |
|---|---|---|
| `pages/layout/sidebar-shell.tsx:15` | `export const SidebarContent = (props: {…})`（props `:16-33`，body `:34-125`） | **唯一导出组件**；加入口 = 加 prop |
| `sidebar-shell.tsx:52` | `data-component="sidebar-rail"` | — |
| `sidebar-shell.tsx:53` | `class="w-16 shrink-0 bg-background-base flex flex-col items-center overflow-hidden"` | **`w-16` = 4rem = 64px，文件内唯一宽度字面量，未 token 化** |
| `sidebar-shell.tsx:56-90` | 上半部：`flex-1 min-h-0 w-full` → `DragDropProvider`(`:57-62`) → 滚动容器(`:65`) → `SortableProvider`(`:66-68`) 渲染 projects + `IconButton icon="plus"`（open project，`:80-86`） | 入口来自 props，可拖排序 |
| `sidebar-shell.tsx:93-101` | 下半部第一项：`TooltipKeybind` → `IconButton icon="settings-gear"`（icon 行 `:95`） | **JSX 硬编码**，非数组 |
| `sidebar-shell.tsx:102-110` | 下半部第二项：`Tooltip` → `IconButton icon="help"`（icon 行 `:104`） | 同上 |
| — | **权限/可见性：全文件无任何判断**。无 `useSettings`、无 `visibility.*`、无 permission 引用；唯一的 `Show` 在 `:74`（keybind 角标）。两个 IconButton **无条件渲染** | ⛔ 与 FR-002「入口可见性读 capability」差距最大处 |
| `pages/layout.tsx:2221-2246` | `const sidebarContent = (mobile?: boolean) => (…)` — 唯一实例化辅助 |
| `pages/layout.tsx:2222` | `<SidebarContent … />` |
| `pages/layout.tsx:2241` | help 外链硬编码 `platform.openExternal("https://opencode.ai/desktop-feedback")` |
| `pages/layout.tsx:203` | rail 被用作 aim（hover-peek）追踪锚点——**改 rail 结构会破坏 peek** |

> **关键**：rail 的「五入口 + 系统设置」**在 new 布局中没有承载物**，属 plan.md 归类中的**「新增」而非「换皮」**。

### 2.2 左栏 sidebar —— ⛔ new 布局不存在（session tab 搬进了 Titlebar）

| 位置 | 内容 |
|---|---|
| `pages/layout.tsx:1710` | `const side = createMemo(() => Math.max(layout.sidebar.width(), 244))` — **硬下限 244** |
| `pages/layout.tsx:1711` | `const panel = createMemo(() => Math.max(side() - 64, 0))` — **面板宽 = 总宽 − 64(rail)** |
| `pages/layout.tsx:2290-2305` | `<Show when={layout.sidebar.opened()}>`(`:2290`) → `<ResizeHandle>`(`:2296`)：`size={layout.sidebar.width()}`(`:2298`)、`min={244}`(`:2299`)、`max={window.innerWidth * 0.3 + 64}`(`:2300`) |
| `pages/layout.tsx:2267` / `:2329` | `data-component="sidebar-nav-desktop"` / `sidebar-nav-mobile` |
| `pages/layout.tsx:2364-2387` | peek 浮层：`"hidden xl:flex absolute inset-y-0 start-16 z-30"`(`:2366`) → `<SidebarPanel/>`(`:2385`) |
| `pages/layout.tsx:2247-2289` | `SidebarPanel`（layout.tsx 内局部组件，非 export）：项目名 InlineEditor + worktree 路径 + workspace/session 列表 |
| `context/layout.tsx:30` | `const DEFAULT_SIDEBAR_WIDTH = 344` |
| `context/layout.tsx:273-281` | sidebar store：`opened: false`(`:275`)、`width: DEFAULT_SIDEBAR_WIDTH`(`:276`)、`workspaces`(`:277`)、`workspacesDefault`(`:278`) |
| `pages/layout/sidebar-workspace.tsx` | `SortableWorkspace` / `LocalWorkspace`（worktree + session 列表） |
| `pages/layout/sidebar-items.tsx` | `SessionItem` / `NewSessionItem` / `SessionSkeleton` / `ProjectIcon` |
| `pages/layout/sidebar-project.tsx` | `SortableProject`（rail 上 project 图标） |

> **注意**：左栏**不是文件树**——是 projects + git workspaces + sessions。文件树在**右栏**（§2.4）。
> new 布局的等价物是 `components/titlebar.tsx:398` 的 `TitlebarTabStrip`（session tab 条挂在顶栏）。

### 2.3 中栏 main + tab 系统

**挂载点**

| 位置 | 内容 |
|---|---|
| `pages/layout-new.tsx:41-43` | **new 布局中栏** `<main class="flex-1 … contain-strict">` |
| `pages/layout.tsx:2353-2361` | legacy 中栏 `<main>`（定位容器 `:2341-2362`） |
| `pages/session.tsx:329-334` | `SessionRouteFrame` |
| `pages/session.tsx:337-350` | `SessionPanelFrame(props: { newLayout; raised? })` |
| `pages/session.tsx:2061` | `const sessionPanelContent = () => (…)` — 中心内容 Switch（timeline / review / terminal） |
| `pages/session.tsx:499-503` | `sessionPanelWidth`：关 → `"100%"`(`:500`) / review → `${…}px`(`:501`) / 否则 `calc(100% - ${layout.fileTree.width()}px)`(`:502`) |
| `pages/session.tsx:468` | `desktopSidePanelOpen = desktopSessionResizeOpen() \|\| desktopFileTreeOpen()` |
| `pages/session.tsx:505-511` | `desktopV2PanelLayout = sessionPanelLayout({…})` |
| `pages/session.tsx:2256` | `"gap-2 p-2": settings.general.newLayoutDesigns()` |

**tab 系统有两条，互不相同——共享中栏必须新建第三条**

| 系统 | 位置 | 语义 | 能否复用 |
|---|---|---|---|
| A. 顶层 session tabs（全局） | `context/tabs.tsx`：`SessionTab`(`:17-21`)、`DraftTab`(`:23-29`)、`Tab = SessionTab \| DraftTab`(`:31`)、`tabKey`(`:47`)、`TabsProvider`/`useTabs`(`:53`)、`createStore<Tab[]>`+`Persist.window("tabs")`(`:60-66`)、`tabs.recent/info/closed`(`:67-69`)、actions(`:179-383`)。渲染在 `components/titlebar.tsx:398` | 「打开多个 session」 | ❌ 键是 session/draft，不是「内容视图」 |
| B. 面板内 file tabs（per-session） | `context/layout-tabs.ts`：`SESSION_OPEN_FILE_TAB`(`:1`)、`SessionTabs = {active?, all[]}`(`:3-6`)、`SessionTabState`(`:8-11`)、`previewSessionTab`(`:16`)、`openSessionTab`(`:43`)、`closeSessionTab`(`:82`)；`context/layout.tsx:994` `tabs(sessionKey)` accessor；渲染在 `session-side-panel.tsx:336-464` / `:549-685` | 右栏 review/文件 tab | ❌ per-session，切 session 即丢，**与 FR-004/006「跨模块累积、切模块不清空」相反** |
| **C. openhive 共享中栏（本 feature 新增）** | 计划 `center/tab-store.ts` | 跨模块累积、模块着色、切模块不清空 | ✅ 需全新实现 |

> **中栏目前没有 tab bar**；两条现存 tab 系统都不满足 FR-004（跨模块累积）/FR-006（切模块不清空）。plan.md「独立 `tab-store`，不碰 session 状态」的判断**成立**。

### 2.4 右栏 SessionSidePanel —— ✅ new 布局存活，但职责不符

| 位置 | 内容 |
|---|---|
| `pages/session/session-side-panel.tsx:68-84` | `export function SessionSidePanel(props: {…})` |
| `session-side-panel.tsx:110-114` | `panelWidth`：`"0px"`(`:111`) / `"auto"`(`:112`) / `${fileTreeWidth()}px`(`:113`) |
| `session-side-panel.tsx:291` | 门禁 `<Show when={isDesktop() && !(settings.general.newLayoutDesigns() && !params.id)}>` |
| `session-side-panel.tsx:292-293` | `<aside id="review-panel">`；`:309` `style={{ width: panelWidth() }}` |
| `session-side-panel.tsx:96` / `:108` / `:62` | `const shown = settings.visibility.fileTree` / `fileTreeWidth` / `FILE_TREE_WIDTH_MIN = 240` |
| `session-side-panel.tsx:336-464` | v2 文件 tab 条（`DragDropProvider` → `Tabs.List` → review/context 触发器 → `SortableProvider` + `For`） |
| `session-side-panel.tsx:484` / `:712` | `<Mark class="w-14 opacity-10" />` 空态水印 |
| `context/layout.tsx:704-742` | `fileTree` accessor（`opened`/`width`/`tab`/`resize`），`DEFAULT_FILE_TREE_WIDTH = 200`(`:31`) |

> **定位差异**：右栏当前是「文件树 + review」面板，**不是 AI 会话面板**——会话聊天内容在**中栏**（`session.tsx:2061` `sessionPanelContent()`）。
> openhive 要求「右栏 = AI 会话（对话优先 Hero 输入）」，属**换皮 + 重定职责**，比 plan.md 估的「换皮」重。

### 2.5 顶栏 Titlebar —— ✅ new 布局存活，可作换皮主战场

| 位置 | 内容 |
|---|---|
| `components/titlebar.tsx:64` | `export function Titlebar(props: { update?; debugTools? })` — 全 app 唯一顶栏 |
| `titlebar.tsx:74` | `const useV2Titlebar = createMemo(() => settings.general.newLayoutDesigns())` |
| `titlebar.tsx:172-173` | `<header data-slot={useV2Titlebar() ? "titlebar-v2" : undefined}>` |
| `titlebar.tsx:192` | `<Match when={useV2Titlebar()}>` — v2 分支 |
| `titlebar.tsx:398-412` | **`TitlebarTabStrip`**（组件定义在 `components/titlebar-tab-strip.tsx:212`） |
| `titlebar.tsx:316-325` | `command.register("titlebar-home", …)`（`home.toggle` `:318`，keybind `mod+b` `:321`） |
| `titlebar.tsx:327-355` | `command.register("tabs", …)`：`tab.new`(`:332`, `mod+t,mod+n`) / `tab.close`(`:340`, `mod+w`) / `tab.reopenClosed`(`:350`, `mod+shift+t`) |
| `titlebar.tsx:562` / `:571` / `:583` | legacy 三个外部挂载点 `#opencode-titlebar-left` / `-center` / `-right` |
| `titlebar.tsx:608-614` | `TitlebarV2Right` → `#opencode-titlebar-right`(`:614`) |
| `titlebar.tsx:55-62` | `useTitlebarRightMount()` — 经 `getElementById("opencode-titlebar-right")` 注入 |
| `pages/layout-new.tsx:33-40` / `pages/layout.tsx` | 两处 `<Titlebar>` 调用点 |

> **可挂载性**：**v2 分支也有 `#opencode-titlebar-right`(`:614`)**，故「站内信 / 全屏 / 用户下拉」（FR-003）在 new 布局下**有现成注入点**，无需改 Titlebar 结构——这是本 feature 冲突面最小的一块。

---

## 3. 换皮落点（token）——靶子要换一半

### 3.1 new 布局实际读取（⭐ 主战场）

`packages/ui/src/v2/styles/theme.css`（503 行）：

| 位置 | 内容 |
|---|---|
| `:14-145` | **`:root` 浅色一套**（`:14` `:root {`） |
| `:17-27` | Background：`--v2-background-bg-base`(`:18`, = `var(--v2-grey-50)`)、`-deep`(`:19`)、`layer-01..04`(`:20-23`)、`inverse`(`:24`)、`contrast`(`:25`)、`button-neutral`(`:26`)、**`accent`(`:27`, = `var(--v2-blue-600)`)** |
| `:29-37` | Text：`text-base`(`:30`)、`muted`(`:31`)、`faint`(`:32`)、`inverse`(`:33`)、`contrast`(`:34`)、**`accent`(`:35`= `--v2-blue-600`)**、`accent-hover`(`:36`= `--v2-blue-700`)、`code-accent`(`:37`) |
| `:39-45` | Icon：`icon-base`(`:40`)、`muted`(`:41`)、`inverse`(`:42`)、`contrast`(`:43`)、**`accent`(`:44`= `--v2-blue-600`)**、`accent-hover`(`:45`) |
| `:47-52` | Border：`muted`(`:48`)、`base`(`:49`)、`strong`(`:50`)、`inverse`(`:51`)、**`focus`(`:52`= `--v2-blue-500`)** |
| `:54-63` | Overlay |
| `:66` / `:92` / `:113-137` / `:138-143` | State / Project avatar / Elevation / Illustration |
| `:143-144` | `--font-family-text` / `--v2-font-family-sans` |

**⚠️ 关键陷阱（本次复核新发现）：v2 的浅色值不只在 `:root`。**

| 位置 | 内容 |
|---|---|
| `:148-259` | `/*@media (prefers-color-scheme: dark) { … }*/` — **整块被注释掉**，不生效 |
| `:261-380` | **`[data-color-scheme="light"]` 显式覆盖块** —— accent 行 `:273`、`:280-282`、`:288-289` |
| `:383-502` | `[data-color-scheme="dark"]` 显式覆盖块 —— accent 行 `:395`、`:402-404`、`:410-411` |

⇒ **换皮只改 `:root` 可能被 `[data-color-scheme="light"]` 覆盖**。必须同时确认 `ThemeProvider` 是否给 `documentElement` 写了 `data-color-scheme`（`packages/ui/src/theme/context.tsx:153-159` 会写 `dataset.colorScheme`）。**只改 `:root` 是不够的**——这是一个实现时会踩的坑。

**蓝色原语**：`packages/ui/src/v2/styles/colors.css:133-139`（`--v2-blue-300`(`:133`) … `--v2-blue-900`(`:139`)，`600` 在 `:136`）。

### 3.2 legacy 语义变量（次战场，new 布局少量组件仍引用）

`packages/ui/src/styles/theme.css`（631 行）：

| 位置 | 内容 |
|---|---|
| `:1-358` | `:root` 浅色一套（`:1` `:root {`） |
| `:94` | `--background-base: #f8f8f8` |
| `:123` | `--surface-brand-base: #dcde8d`（黄绿，非蜂蜜金） |
| `:167` | `--text-strong: #171717` |
| `:172` | `--text-interactive-base: #034cff`（蓝） |
| `:203` | `--border-selected: rgba(3, 76, 255, 0.99)`（蓝）；亦被 `:72` / `:77` 的 shadow recipe 引用 |
| `:360-630` | `@media (prefers-color-scheme: dark)` 覆盖块（`:365` `--background-base: #101010`） |

### 3.3 生成物纪律（宪法 §八）——修正 plan.md 的一处表述

| 文件 | 性质 | 结论 |
|---|---|---|
| `packages/ui/src/styles/tailwind/colors.css` | `:1-2` 有 `/* Generated by script/tailwind.ts */` + `/* Do not edit this file manually */` | ⛔ **绝不手改** |
| 生成器 | `packages/ui/script/tailwind.ts`（`:14` 写头注释，`:23` 写出文件）；`packages/ui/package.json:63` `"generate:tailwind"` | 改 theme.css 后重跑 |
| `packages/ui/src/styles/colors.css` | **无 generated 头**，772 行纯原语 `--gray-*` 等 | plan.md/宪法把「colors.css」笼统当作生成物——**精确说，只有 `styles/tailwind/colors.css` 是生成物**。二者都应避免手改（无收益且易被覆盖） |
| `packages/ui/src/v2/styles/colors.css` | 无 generated 头，纯原语 `--v2-grey-*` / `--v2-alpha-*` / `--v2-blue-*`（`:4-172`） | 品牌色注入点 |

### 3.4 导入链与 body 设计分支

| 位置 | 内容 |
|---|---|
| `packages/app/src/index.css:1-4` | `@import "@opencode-ai/ui/styles/tailwind";` / `@import "@opencode-ai/session-ui/styles";` / `@import "@opencode-ai/ui/v2/styles/tailwind.css";` / `@import "tw-animate-css";` |
| `packages/ui/src/styles/index.css:3-4` | `@import "./colors.css" layer(theme);` + `@import "./theme.css" layer(theme);`（两个 theme.css 均**间接**引入，非 app 直引） |
| `packages/app/src/app.tsx:294-309` | `BodyDesignClass()`：`:300` `const enabled = settings.general.newLayoutDesigns()`；**`:301` `document.body.toggleAttribute("data-new-layout", enabled)`**；`:302-305` 切 `text-12-regular` / 字体族 / `text-[13px]` / `font-[440]` |
| `packages/app/src/app.tsx:316` | `<BodyDesignClass />` 挂载（在 `SharedProviders` `:313-323` 内） |

> 换皮时**两套 body 样式并存**，需注意 `data-new-layout` 属性对样式的影响。

### 3.5 品牌资产（宪法 II：走配置，不硬编码）

| 位置 | 内容 |
|---|---|
| `packages/ui/src/components/logo.tsx:3` / `:18` / `:34` | `Mark` / `Splash` / `Logo`（wordmark "opencode"，换品牌需重画 path） |
| `packages/ui/src/components/favicon.tsx:3` / `:6-9` | `<Favicon/>`；硬编码 `/favicon-96x96-v3.png`(`:6`)、`/favicon-v3.ico`(`:7`)、`/apple-touch-icon-v3.png`(`:8`)、`/site.webmanifest`(`:9`) |
| `packages/app/index.html:9` | **`<title>OpenCode</title>`** |
| `index.html:10-14` | favicon link 四连（硬编码） |
| `index.html:15` | `<meta name="theme-color" content="#fafafa" />` |
| `index.html:21` | `<script id="oc-theme-preload-script" src="/oc-theme-preload.js">` — 首屏防闪白 |
| `index.html:25` | `<div id="root" class="flex flex-col h-dvh bg-v2-background-bg-deep p-px">` |
| `index.html:2` / `:23` | `<html … style="background-color: var(--v2-background-bg-deep, #fafafa)">` / `<body class="… bg-v2-background-bg-deep">` |
| `packages/ui/src/assets/favicon/site.webmanifest:2-3` | `"name": "OpenCode"` / `"short_name": "OpenCode"`；`:21-22` `theme_color`/`background_color: #080808` |
| `packages/app/src/entry.tsx:73` | 通知图标硬编码 `https://opencode.ai/favicon-96x96-v3.png` |
| `packages/app/src/entry.tsx:100` | 域名特判 `if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"` |
| `packages/ui/src/theme/themes/opencode.json:3-4` | `"name": "OpenCode"` / `"id": "opencode"`；`:9` `primary: #3b7dd8`、`:10` `accent: #d68c27` |
| `packages/app/src/i18n/en.ts` | 字面量 `"OpenCode"` **26 处**：`130, 146, 151, 160, 168, 351, 388, 402-411, 419, 426, 428, 430, 455, 584, 600, 626, 850, 890, 898, 909, 915, 917, 919, 973, 981` |
| `pages/home/legacy-home.tsx:70`、`pages/error.tsx:284`、`session-side-panel.tsx:484,712`、`components/session/session-new-view.tsx:56`、`app.tsx:494,515` | `<Logo>` / `<Mark>` / `<Splash>` 水印与加载态 |

---

## 4. 硬编码耦合点（⚠️ 已决策走 A → **本表不适用**，仅作存档）

> **2026-09-27 决策后状态**：已决定**三栏改建于 new 布局**（方案 A），legacy **不改造**，故下表所有耦合点**均不适用**（不碰即无需同步）。本表保留仅作「若日后需要动 legacy」的存档，以及佐证「new 路线附带好处：这些硬编码耦合天然不存在」。openhive 新建 rail 的宽度按 DESIGN.md §4.1 = **56px**，落点是本项目自有文件，不涉及下表任何位置。

plan.md / DESIGN.md §4.1 要求 rail = **56px**，而上游 legacy 硬编码 **64px（4rem）**：

| 位置 | 硬编码值 |
|---|---|
| `pages/layout/sidebar-shell.tsx:53` | `w-16`（rail 宽 = 64px，文件内唯一宽度字面量） |
| `pages/layout.tsx:1711` | `Math.max(side() - 64, 0)`（面板宽 = 总宽 − 64） |
| `pages/layout.tsx:1710` | `Math.max(layout.sidebar.width(), 244)`（左栏下限） |
| `pages/layout.tsx:2299` | `<ResizeHandle min={244}>`（244 重复出现） |
| `pages/layout.tsx:2300` | `max={window.innerWidth * 0.3 + 64}`（+64 rail 余量） |
| `pages/layout.tsx:2313` | `style={{ "inset-inline-start": "calc(4rem + 12px)" }}`（顶部细线） |
| `pages/layout.tsx:2350` | `"--main-left": … : "4rem"`（rail 收起时中栏起点） |
| `pages/layout.tsx:2366` | `"… absolute inset-y-0 start-16 z-30"`（peek 浮层贴 rail 边） |
| `pages/layout.tsx:2398` | `inset-inline-start: calc(4rem + ${panel()}px)`（peek 阴影） |
| `pages/layout.tsx:1703-1708` | `--dialog-left-margin`（`:1706` 关时 `48px`） |

> 三者（`244` / `64` / `w-16`）**不来自共享常量**，是各自硬编码——改 rail 宽需全部同步，属高危点。
> 若走 new 布局新建 rail，上述 legacy 耦合点**天然不复存在**——这是 new 路线的一个附带好处。

---

## 5. 与 plan.md 的偏差汇总

| plan.md 原述 | 实际情况 | 性质 |
|---|---|---|
| 改造 `pages/layout/sidebar-shell.tsx` 为五入口 rail（「换皮 + 新增入口」） | 该文件在 new 布局**不可达**；五入口**无承载物**，需从零新建 | ⚠️ 换皮 → **新增** |
| 改造 `pages/layout.tsx`（LegacyLayout）为三栏重定义（「换皮」） | legacy 已退休，**死代码**；new 布局无三栏骨架 | ⚠️ 换皮 → **新增** |
| 改造 `pages/session/session-side-panel.tsx` 为右栏 AI 会话（「换皮」） | 组件存活（new 分支 `session.tsx:2328`），但当前职责是「文件树 + review」，**不是 AI 会话**；会话在中栏 | ⚠️ 换皮 → **换皮 + 重定职责** |
| token 靶子 = `packages/ui/src/styles/theme.css` 的 `--xxx` | new 布局实际读 **`packages/ui/src/v2/styles/theme.css` 的 `--v2-*`** | ⚠️ **靶子要换** |
| — | **新增坑**：v2 浅色值同时在 `:root` 与 `[data-color-scheme="light"]`，只改前者可能被覆盖 | ⚠️ **实现陷阱** |
| 建议落点 `packages/app/src/rail\|topbar\|workspace\|center/` | 目录本身仍需新建（T002 不受影响） | ✅ 一致 |
| 中栏 tab 状态独立成 `tab-store`，不碰 session 状态 | 两条现存 tab 系统均不满足 FR-004/006，**确需独立新建** | ✅ 与 plan 判断一致 |
| 「站内信」在顶栏 `app.tsx`/`command-palette.ts` 等「散在」 | **v2 分支有现成注入点** `titlebar.tsx:614` `#opencode-titlebar-right` | ✅ 比预期好 |

---

## 6. 待决事项（✅ 已决策：采纳 A）

> **决策结果（2026-09-27）**：采纳 **A. 建在 new 布局**。下面的选项表与理由保留作决策留痕。

**核心问题：openhive 三栏工作台建在哪套布局上？**

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. 建在 new 布局（推荐）** | 在 `layout-new.tsx` 的 `<main>`（`:41`）上下游新增 openhive 三栏骨架（rail 五入口 / 左栏导航 / 共享中栏 tab / 右栏 AI 会话）；换皮靶子对准 `--v2-*`（含 `[data-color-scheme="light"]` 块） | 上游方向所在，可持续合并；legacy 的 244/64/`4rem`/`w-16` 耦合点天然消失；顶栏有现成注入点；改动以「新增文件」为主（合宪法 I/V） | 新增代码量大（rail + 左栏 + 共享中栏 tab 全新）；`titlebar.tsx` / `layout-new.tsx` 是上游活跃文件，需靠「新增文件 + 最小挂载」控制冲突 |
| **B. 改回 legacy 布局** | 让 `newLayoutDesigns` 恒为 false（改 `settings.tsx:63` 的 sunset 或 `:129` 的 resolve 逻辑），再换皮 legacy 三栏 | 三栏结构现成，改动量小 | ⛔ **违反宪法 I/V**：要「改」上游核心判定逻辑；且 legacy 是上游**已排定删除**的死代码，一旦合并上游即全盘作废 |
| **C. 双轨** | 两套都做 | — | ⛔ 工作量翻倍且必然一半废弃，不推荐 |

**推荐 A**。理由：宪法原则 I（最小化上游合并冲突）与 V（侵入是加不是改）共同指向「不要往已退休代码上加东西」；openhive 要长期跟着 upstream 走，把 F1 底座建在**将被删除的目录**上，等于把整个平台的地基放在流沙上。

**采纳 A 后需同步修订项**（宪法 §六「任何修订 MUST 同步检查并更新受影响的 plan / spec / tasks」）——**已全部完成（2026-09-27）**：

1. ✅ `plan.md` §项目文件结构 → 落点改为 new 布局挂载 + 新增组件；§前端换皮区 ① 表整体重写，② token 表靶子换成 `--v2-*`（并补 §3.1 的 `[data-color-scheme="light"]` 陷阱）。
2. ✅ `spec.md` → FR-002/003 的承载物（rail 五入口、站内信）明确为「新建于 new 布局」，并补修订记录。
3. ✅ `tasks.md` → T003/T006/T007/T009/T017 落点与「换皮/新增」标注已复核（T003、T006 由「换皮」升为「新增」）。
4. ✅ 本文档 §4 的 legacy 耦合点表已标注「不适用（legacy 不改造）」。
