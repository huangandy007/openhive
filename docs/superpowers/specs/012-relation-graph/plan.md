# Implementation Plan: 关系图产物（`.hgraph`）

**Branch**: `012-relation-graph`（当前工作分支 `multi-tenant`） | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: `docs/superpowers/specs/012-relation-graph/spec.md`（边界与格式来源：`docs/superpowers/specs/2026-11-09-事实卡片抽象/08-关系图产物-设计.md`）

**本次规划的两条硬要求**（用户 2026-11-15 下达）：

1. 新开发的功能模块**优先复用源码中已有能力**，而不是新建；
2. 已有能力能支持的功能，**去适配而不是新建**，防止重复造轮子。

⇒ 本 plan 的 §3「复用地图」是主结构：每一块能力先写「复用什么 · 在哪个文件 · 为什么不新建」，只有确实没有落点时才写「新增」。

## Summary

把「关系图」从**邻域图的放大镜**升级为**可编辑、可交付的产物**：新增 `.hgraph` 文件视图，民警在画布上手画、AI 通过 5 个受约束工具改图、从库里挑人上图、导出 PNG + 证据附录；所有写入只走服务端一条通道（`hgraph-ops`），文件是唯一真相，图永不写回库。

技术路线一句话：**文件是唯一真相 + 单一写入者 + 前端只做渲染与操作**。服务端 `hgraph-ops` 承担路径闸、串行锁、内容哈希版本 CAS、schema 校验、id 分配、批量原子与幂等、增量放置、原子写；前端 `hgraph/` 承担画布、工具栏、检查器、撤销栈、演示与导出；AI 侧 5 个工具挂在既有案件 MCP server 上。

## Technical Context

**Language/Version**: TypeScript 5.8.2（`bun@1.4.2` 运行）；前端 SolidJS 1.9.10 + Vite 7.1.4 + Tailwind v4

**Primary Dependencies**:
- 服务端路由：既有 Hono 路由树 + Effect 4.0.0-beta.83（`HttpRouter.use` / `Layer.provide`，与 `case-ui-routes.ts` 同构）
- AI 工具：既有 `@modelcontextprotocol/sdk`（`case-mcp-server.ts` 的 `TOOLS` + `分发表`）
- 前端：`@opencode-ai/ui` 的 v2 组件（Dialog/Button/Field/TextInput）、既有 `view-registry`
- 图渲染：**纯 SVG + Solid 信号**（与 `case-views/graph.tsx` 同一套做法），不引入 d3 / cytoscape / canvas 渲染库

**Storage**: `.hgraph` JSON 文件落在项目目录（`{沙箱根}/{属主}/{projectId}`）；业务库**只读**（实体检索 / 快照 / 角标比对）；没有新增表、没有迁移；导出留痕写内核日志

**Testing**:
- 纯函数 / 服务端：`bun test`（受影响 package 内跑；根目录 `bun test` 被脚本禁止）
- 组件：`@solidjs/testing-library` 的 `mount`（与 `graph.test.tsx` 同形）
- 真栈：Playwright 手工/脚本验收（拖拽几何、演示态、导出文件、字体掉字）——验不了的进缺口表

**Target Platform**: 桌面浏览器（**仅浅色**，宪法 §八「不启用暗色模式」）；服务端 win32 / Linux

**Project Type**: 既有 Bun monorepo 的**功能新增**（`packages/app` + `packages/opencode`），不是新工程

**Performance Goals**:
- 1000 节点拖动：记录实测帧率；<30fps 如实写进实现报告（spec US7 场景 7 / 08 §13 第 12 条）
- 1000 节点导出（含证据附录）≤ 3 秒；超出降级为计数 + 前若干条明细并注明（SC-005）
- 300 节点：标签分级、隔离/筛选共用一个「已隐藏 N 个」口径

**Constraints**:
- **单一写路径**：`.hgraph` 只能经 `hgraph-ops` 写；通用文件写接口 `PUT /openhive/file/write` 必须拒绝 `.hgraph`（FR-011）
- **零 DB 迁移、零新增检索接口**（FR-031 / SC-008）；从库加入只用既有 `entities` / `entity` / `facts` / `graph` 读口
- **最小化上游冲突**：新文件全部落在 fork 自有目录（`server/openhive/`、`center/case-views/hgraph/`）；对既有文件的改动只有「注册一行 / 分发一条 / 类型胶囊一行」这类加法
- 撤销栈 20 步、按标签页独立；AI 批次算一步

**Scale/Scope**: 单图 ≤1000 节点（软上限，只提示不拦）；AI 单次批量 ≤50；图文件预计几百 KB 量级（出处已按区间压缩）

## Constitution Check

*GATE: Phase 0 前检查一次，Phase 1 后复查（见文末）。*

| 条款 | 判定 | 证据 / 做法 |
|---|---|---|
| I. 最小化上游合并冲突（NON-NEGOTIABLE） | ✅ PASS | 写入者 `hgraph-ops.ts`、AI 工具 `case-hgraph-tools.ts`、编辑组件 `center/case-views/hgraph/*` 全是新文件；对既有文件的改动是**加法**：`views/index.ts` 加一条注册、`httpapi/server.ts` 加一行挂载、`case-mcp-server.ts` 加 5 个工具条目与 3 个写工具名、`file-create-dialog.tsx` 加类型行、`file-tree.tsx` 加一个菜单项。**不碰**上游高频文件（`sql.ts` 等） |
| II. 品牌化走配置 | ✅ N/A | 本 feature 不涉及品牌名 / 环境值 |
| III. 物理隔离优先 | ✅ PASS | 图落在项目目录内，归属判定复用 `realInside`（真实路径）+ `projectDirectory(root, 属主, projectId)`；不新增存储、不跨目录 |
| IV. 权限下沉到执行层 | ✅ PASS | 导出在服务端先校验成员 + 归属再发许可（先授权后出图）；MCP 的 3 个图写工具并入 `写工具名`（属主门）；路径闸在**执行层**（`hgraph-ops` 内），不靠前端隐藏 |
| V. 侵入是「加」不是「改」 | ✅ PASS | 唯一的小重构是把 `自动位置` 系布局函数抽到 `graph-layout.ts` 并保留 `graph.tsx` 的同名 re-export（08 §11 第 4 条）；既有调用方与测试一行不改，且**单独一个提交** |
| 质量门禁（§五） | ✅ 计划内 | 仓库根 `bun run typecheck` + `bun run lint`；受影响包内 `bun test`；每条命令带 `timeout 300` |
| 前端设计系统（§八） | ✅ PASS | 颜色/间距/字号引用 `theme.css` 语义变量与 `openhive-DESIGN.md`；浅色；SVG 形状不引入外部图标资产；不写 React |
| 实现纪律（§九） | ✅ 计划内 | 严格 Red → Green → Refactor；每个 task 完成即更新 tasks.md 勾选并提交（`/speckit-tasks` 起执行） |

**Gate 结论**：无 ERROR，无需 Complexity Tracking 的豁免项。

## 复用地图（本次规划的硬要求）

> 读法：先看「复用」，只有「新建」一栏为空时才算真的需要新写代码。

### 3.1 前端：文件打开与注册

| 能力 | 复用 | 落点 | 为什么不新建 |
|---|---|---|---|
| `.hgraph` 在文件树双击打开 | `viewRegistry.register({ extensions, load })`，`extensionOf` 取最后一个点后的扩展名 | `packages/app/src/center/views/index.ts`（现无占用者）、`center/view-registry.ts:85-90` | 注册表就是为「加一种文件类型」设计的；`.hgraph` 目前无人认领 |
| 读取文件正文 | `LoadFileContent`（`load` 注入，生产走 `readProjectFile`） | `center/file-content.ts:25`；注入点 `pages/layout-new.tsx` 的 `loadFile` | 视图不自行发请求是既有接缝约定（文件头注释） |
| 视口 / 缩放 / 平移 / 面板避让选中节点 | `graph.tsx` 内的 SVG ref、缩放平移、`面板宽=280` 与「面板避开选中节点」 | `center/case-views/graph.tsx:29-35, 418+` | 邻域图已经把「SVG + 信号 + 缩放 + 侧栏避让」跑通了，重写一遍只会得到第二套手感 |
| 环形 / 力导向 / 分层 / 网格布局、分簇 | `自动位置`、`布局`、`环半径`、`按经由分簇`、`簇`、`枢纽度数阈值` | `graph.tsx:46,58,219,229,240,256` | 08 §11 第 4 条：**抽到** `case-views/graph-layout.ts`，`graph.tsx` 保留同名 re-export，现有调用方/用例零改动 |
| 节点形状 / 图标 / 图标边长 | `图标图形`、`节点图标`、`图标边长`、`节点图标组`、`图标名` | `center/case-views/graph-icons.tsx` | 类型→形状/图标已有唯一映射；图的「颜色不是唯一通道」靠它天然成立 |
| 名称截断（12 字符） | `截断(值, 上限=12)` | `graph.tsx` | 同一套截断两处写就会漂（`#002-06`） |
| 侧栏/工具栏/浮层的视觉壳 | `@opencode-ai/ui` v2 组件 + `theme.css` token | `packages/ui` | 宪法 §八：组件基底是 opencode 原生换皮 |
| PNG 落盘下载 | 上游「blob + `<a download>` + `URL.createObjectURL`」三件套的**形状** | `packages/app/src/utils/session-export.ts`（`downloadSessionExport`）、`ai-session/session-actions.ts:280` | 不新造一套下载机制；本 feature 只需一个按文件名 + Blob 的同形函数 |

### 3.2 前端：库衔接（从库加入 / 角标 / 打开档案）

| 能力 | 复用 | 落点 | 为什么不新建 |
|---|---|---|---|
| 实体搜索（名称/别名） | `EntityApi.list({ projectId, q, limit })`（`GET /openhive/case/entities`，`q` 只匹 `canonical_value`/`aliases`） | `app/src/project/entity-api.ts:129-166`；服务端 `case-entity-list.ts:143-150` | FR-031 明写**不新增后端检索接口**；`07` §3.2 已定该模块不删不改契约 |
| 结果列（类型/细类/可信态/关联数）+ 前端类型筛选 | `实体清单项` 字段已够四列 | `entity-api.ts:22-38` | 类型当列当筛选，零服务端改动 |
| 实体详情（值/类型/可信态/时间/引用） | `GET /openhive/case/entity`（`CaseDetailApi` 实体分支） | `case-ui-routes.ts:56`、`app/src/center/case-detail-api.ts` | 检查器「图上记的 / 库里现在 / 打开档案」三段直接用现有读口 |
| 单条关系的事实详情（含引用、证据） | `GET /openhive/case/facts?type=relation&id=` | `case-fact-routes.ts:33,100-131`、`case-store.ts` 的 `事实详情` | 关系页勾选后加边需要「关系 + 出处成对」；这是既有唯一出口 |
| 某实体的既有关系（关系页列表） | `GET /openhive/case/graph?id=<实体>&跳数=1&强度=…` 的 `边` | `case-graph.ts:405`、`case-ui-routes.ts:58` | 关系页只要 1 跳；复用邻域图取数，不写第二份关系 SQL |
| 打开实体档案（伪路径） | `案件伪路径({projectId, view: "entity", arg})`；`case-view.tsx` 的 `open(..., { 另一栏: true })` | `center/case-route.ts`、`center/case-view.tsx` | 分屏打开另一栏是现成能力 |

### 3.3 服务端：写入者与路径闸

| 能力 | 复用 | 落点 | 为什么不新建 |
|---|---|---|---|
| 路径闸：项目内 + 真实路径 + 非 `.git` | `inside`、`inGit`、`realInside`（**导出**，已做 realpath 与目录链接逃逸判定） | `server/openhive/file.ts:465,520,548` | `LEARNINGS #009-03`：归属必须 `realpath` 后再比；自己写第二份必漏 |
| 项目目录解析 | `projectDirectory(root, userId, projectId)`（`{root}/{属主}/{projectId}`） | `packages/auth/src/workspace.ts:108`；用法先例 `backup.ts:239-249` | 共享成员写图必须落到**属主**目录，这条已经解过 |
| 成员 / 属主判定 | `成员角色` / `项目属主` / `过门`（同一出口，避免每口各查一遍） | `project-actor.ts:43,79`；`case-ui-routes.ts:180+` 的 `过门` | `#005-24`：门接在共同出口 |
| 路由注册与依赖 | `HttpRouter.use((router) => router.add(...))` + `Layer.provide(AnchorWorkspace.Config.layer, OpenhivePg.layer)` | `case-ui-routes.ts:87-116`；挂载 `server/routes/instance/httpapi/server.ts:420-445` | 与文件出口同一套依赖组合 |
| 出处 `材料#工作表#行号` 解析 | **抽出既有实现**（首/末 `#` 分割，中间整段是工作表名）为纯函数，`get_citation` 改为调用它 | 现内联在 `case-mcp-tools.ts:1412-1445` | FR-003 / TR-002：材料名与工作表名都可能含 `#`，两处各写一份必然分叉；抽出**前后既有用例全绿**（行为不变） |
| 服务端「固定信封」之外的工具返回 | 图工具**不套** `09` 的七字段信封（`case-mcp-server.ts` 的 `校验信封` 只对 `分发表` 内工具生效——需按工具名分流） | `case-mcp-server.ts:717-719` | 08 §6.2 明写图工具返回自己的结构；这是**适配**既有信封校验，不是新写一套 |
| MCP 身份门 / 成员门 / 属主门 / 留痕 | `解析调用身份`、`校验成员`、`校验属主`、`留痕` | `case-mcp-server.ts:670-720` | 5 个图工具只新增**工具实现**，门的顺序与留痕格式原样沿用 |
| 导出留痕 | 内核日志一行（与 MCP 留痕同形：JSON 一行写 stderr / 内核日志） | 沿用 `case-mcp-server.ts` 的 `默认留痕` 形状 | 08 §8.1：不新增审计表，并入将来同一处 |

### 3.4 服务端：只「适配」不新建的既有通道（关键判断）

| 既有通道 | 能不能直接用 | 结论 |
|---|---|---|
| `PUT /openhive/file/write`（`save` 接缝，带 `base` CAS） | **不能** | 它的语义与本 feature 冲突：① `content.trim()` + BOM/CRLF「信封」还原——JSON 的尾换行会被削；② 读→比→写之间有间隙、**无 per-path 串行锁**；③ 非原子写（无 temp+rename、无 win32 占用重试）；④ 版本用「读口 trim 后的文本」而非内容哈希，同毫秒同大小互换漏判。⇒ `.hgraph` **必须**走 `hgraph-ops`，且通用写口**拒绝** `.hgraph`（FR-011 的负向断言就钉这条） |
| `LoadFileContent`（读） | 可以，但**不够** | 读口不返回「版本」。版本只能由服务端算（原始字节哈希）。⇒ 新增 `GET /openhive/hgraph/read` 返回 `{ 内容, 版本 }`；不用它做写入 |
| 「新建文件」`POST /openhive/file/create`（`{flag:"wx"}`，不覆盖） | **用它建空文件**，不扩展它 | 08 §5.11.3 已裁定：不改通用 create 支持初始内容；create 成功后再调 `POST /openhive/hgraph/init` 写骨架（幂等：非空不覆盖） |
| `GET /openhive/file/download` | 不用于导出 | 导出是「先授权后出图」：服务端只发许可 + 留痕，PNG 由前端 canvas 产出后按 blob 下载（08 §8.1 的定位是「可追溯」，不是「禁止」） |

### 3.5 真正需要新建的部分（且必须是最小集）

| 新增 | 为什么没有现成落点 |
|---|---|
| `packages/app/src/center/views/hgraph-view.tsx` | 文件视图注册需要一个 `ViewComponent`；`.hgraph` 无占用者 |
| `packages/app/src/center/case-views/hgraph/`（`canvas / toolbar / inspector / legend / undo / present / export / entity-picker / file.ts`） | 可编辑画布 = 邻域图没有的语义（选择、连线模式、对齐、撤销、检查器）；但**布局、图标、缩放、截断全部来自 graph.tsx / graph-icons.tsx** |
| `packages/app/src/center/case-views/graph-layout.ts`（**抽出**，非新写） | 08 §11 第 4 条：两个视图都要用同一套布局，抽出来才不漂 |
| `packages/app/src/project/hgraph-api.ts`（读/写/初始化/导出许可的客户端） | 复用 `entity-api.ts` 的 `请求` / `默认发送` / `TIMEOUT_MS` / 超时重试三者；只是 `PREFIX = /openhive/hgraph` 的另一组调用 |
| `packages/opencode/src/server/openhive/hgraph-ops.ts`（唯一写入者 + init + export 许可） | 通用写口语义不符（见 §3.4），且 FR-011 要求单一通道 |
| `packages/opencode/src/server/openhive/hgraph-file.ts`（解析 / 保留原始 JSON 树 / schema 校验 / 操作应用**纯函数**） | 08 §4.4：必须保留原始 JSON 树以免丢未知字段；解析与写盘分离才可纯函数测 |
| `packages/opencode/src/server/openhive/case-hgraph-tools.ts`（5 个工具） | 图工具的返回结构不套查库信封，混进 `case-mcp-tools.ts`（2948 行）会让两种口径纠缠 |
| `packages/app/src/project/file-create-types.ts`（数据驱动的「可新建类型」数组） | 08 §5.11.1 明写列表要数据驱动；本期数组只放一项「关系图」（澄清 Q4） |

## Project Structure

### Documentation (this feature)

```text
docs/superpowers/specs/012-relation-graph/
├── spec.md                  # 已完成（clarify 已整合）
├── plan.md                  # 本文件
├── research.md              # Phase 0：全部技术未知项的决定与替代方案
├── data-model.md            # Phase 1：图文件 / 节点 / 边 / 文字 / 快照 / 导出记录的字段与校验
├── quickstart.md            # Phase 1：可跑通的验收路径
├── contracts/
│   ├── hgraph-format.md     # 文件格式契约（key 词表、校验规则、版本与未知字段）
│   ├── hgraph-ops.md        # 写入者 HTTP 契约（read / ops / init / export、操作词表、错误码）
│   ├── mcp-tools.md         # 5 个 AI 工具的入参/返回/拒绝语义
│   └── ui.md                # 视图注册、组件接缝、动作单一出口、快捷键归属
├── checklists/requirements.md
└── tasks.md                 # 由 /speckit-tasks 生成（本命令不建）
```

### Source Code (repository root)

```text
packages/app/src/center/
├── views/
│   ├── index.ts                         # 改：注册 .hgraph（加一行）
│   └── hgraph-view.tsx                  # 新：文件视图外壳（load → hgraph/ 编辑器）
├── case-views/
│   ├── graph-layout.ts                  # 新（抽出）：自动位置/布局/环半径/按经由分簇/簇/枢纽度数阈值
│   ├── graph.tsx                        # 改：改为从 graph-layout 引入并保留同名 re-export（单独提交）
│   ├── graph-icons.tsx                  # 不改：形状/图标唯一映射，hgraph/ 直接用
│   └── hgraph/
│       ├── file.ts                      # 新：解析 + schema 校验 + 保留原始 JSON 树（纯函数，不写盘）
│       ├── ops.ts                       # 新：操作类型与前端侧应用/逆操作构造（纯函数）
│       ├── editor.tsx                   # 新：编辑器根（状态、保存节流、轮询、冲突处理）
│       ├── canvas.tsx                   # 新：SVG 画布（指针/连线模式、选区、拖动、对齐、缩放）
│       ├── toolbar.tsx                  # 新：全图标工具栏
│       ├── inspector.tsx                # 新：右侧浮动检查器（三段 + 失焦即存 + 失败回滚）
│       ├── legend.tsx                   # 新：可折叠图例（线粗/环粗/虚实/箭头）
│       ├── undo.ts                      # 新：20 步撤销栈（逆操作 + 被删对象副本）
│       ├── present.tsx                  # 新：演示最小版（出现序步进）
│       ├── export.ts                    # 新：SVG→canvas→PNG（2 倍 / A3 300DPI）、标题块、证据附录 .md
│       ├── entity-picker.tsx            # 新：从库加入（复用 entity-api / facts / graph）
│       └── *.test.ts(x)                 # 新：就近放用例
├── case-view.tsx                        # 不改（.hgraph 走文件视图，不走 case:// 伪路径）
└── file-content.ts                      # 不改（读口复用；写口不用于 .hgraph）

packages/app/src/project/
├── file-create-types.ts                 # 新：可新建类型数据源（本期数组一项：关系图）
├── file-create-dialog.tsx               # 改：加「类型」胶囊行（数据驱动）
├── file-tree.tsx                        # 改：右键菜单加「导出 PNG」（与工具栏同一动作）
├── hgraph-api.ts                        # 新：read / init / ops / export 许可的客户端（复用请求范式）
└── entity-api.ts                        # 不改（07 §2.1 定：不删、不改契约）

packages/opencode/src/server/openhive/
├── hgraph-file.ts                       # 新：纯函数（解析、校验、来源硬闸、出处解析/区间压缩、操作应用、id 分配）
├── hgraph-ops.ts                        # 新：唯一写入者（路径闸、串行锁、版本 CAS、原子写、init、export 许可）
├── hgraph-lock.ts                       # 新：进程内 per-path 串行锁 + 内容哈希版本（小工具，两个入口共用）
├── case-hgraph-tools.ts                 # 新：graph_list / read / add / update / remove
├── case-mcp-server.ts                   # 改：TOOLS + 工具名 + 分发表 + 写工具名（加 5 条）
├── case-mcp-tools.ts                    # 改：get_citation 改为调用抽出的出处解析纯函数（行为不变）
├── file.ts                              # 改：handleWrite 拒绝 .hgraph（第二写路径的负向断言）
└── routes/instance/httpapi/server.ts    # 改：挂载 OpenhiveHgraphOps.routes（加一行）

packages/opencode/test/server/
├── case-hgraph-file.test.ts             # 新：格式/校验/出处/幂等纯函数
├── case-hgraph-ops.test.ts              # 新：写入者（线路级 + 真实临时目录）
└── case-hgraph-tools.test.ts            # 新：5 个工具的协议语义（in-memory transport）
```

**Structure Decision**：完全沿用现有两条轴——**工作空间轴**（`.hgraph` 是项目产物，落项目目录）与**数据轴只读**（实体/关系/出处从既有读口取）。前端「文件视图」与「案件视图」保持现状分离：`.hgraph` 双击走 `views/`（文件），不塞进 `case-views/` 的 `case://` 伪路径（那套是「数据轴视图」，没有文件写口）。

## 分层与数据流

```text
                    ┌──────────────────────────── 前端 ────────────────────────────┐
文件树双击 .hgraph → │ views/index.ts 注册 → hgraph-view.tsx → hgraph/editor.tsx     │
                    │   ├─ 读：GET /openhive/hgraph/read → { 内容, 版本 }            │
                    │   ├─ 编辑：本地信号 → 操作队列（父→子单向下行）                │
                    │   ├─ 存：POST /openhive/hgraph/ops { 路径, 版本, 操作[] }      │
                    │   ├─ 轮询：10s 一次 stat 版本（无未发出改动才静默重载）        │
                    │   └─ 导出：POST /openhive/hgraph/export → 许可 → canvas → blob │
                    └──────────────────────────────────────────────────────────────┘
                                              │
                    ┌───────────────────────── 服务端 ─────────────────────────────┐
                    │ hgraph-ops.ts：路径闸 → 成员门 → 串行锁 → 版本 CAS →          │
                    │ schema/来源硬闸（**与 MCP 同一函数**）→ 应用操作 → 原子写 →    │
                    │ 返回新版本 + 正式 id 映射 + 批次号                             │
                    │ case-hgraph-tools.ts：同一 ops 函数，不另写写入逻辑            │
                    └──────────────────────────────────────────────────────────────┘
                                              │
                                    .hgraph 文件（唯一真相，永不回写业务库）
```

**关键不变量**（每条都要有用例钉住）：

1. 同一张图的写**只有一处**：`hgraph-ops` 的 `应用并写回`；HTTP 与 MCP 都调它。
2. 「事实必须有出处 / 推断必须有依据+可信度」是**一个函数**（`校验来源`），在 `应用并写回` 里对**每个**待写对象调用——入口有几个不重要，判据只有一处。
3. 版本 = 原始字节的内容哈希（不是 `mtime:size`，不是 trim 后文本）。
4. 任何失败都不写盘（先全量校验、再一次性写临时文件 + rename）。

## 阶段划分（按用户故事实现与验收的先后，不表示可砍）

| 阶段 | 覆盖 | 主要落点 | 完成判据（TDD：先红后绿） |
|---|---|---|---|
| P0 地基 | 格式 + 写入者 + 视图注册 | `hgraph-file.ts`、`hgraph-ops.ts`、`graph-layout.ts`（抽出）、`views/index.ts`、`hgraph-view.tsx` | 纯函数用例全绿；`ops` 的路径闸/版本 CAS/原子写/init 幂等各有一条用例；抽出布局后 `graph.test.tsx` 原样全绿 |
| P1 手画（US1） | 画布、工具栏、检查器、对齐、自动布局、拖拽落盘 | `hgraph/canvas.tsx`、`toolbar.tsx`、`inspector.tsx`、`undo.ts` | 组件级：连线模式/指针模式、框选、对齐、锁定节点不被布局动、`dragend` 一次保存、关闭重开位置一致 |
| P1 演示（US2） | 演示态 + `出现序` 编辑入口 | `hgraph/present.tsx`、`inspector.tsx` | 组件级：chrome 收起、空格/Backspace 步进、未写出现序视为第 0 步、Esc 恢复原快捷键归属 |
| P1 AI 改图（US3） | 5 个工具 + 复用 + 幂等 + 可撤销 | `case-hgraph-tools.ts`、`case-mcp-server.ts`、`undo.ts` | 协议级：事实缺出处被拒、推断缺可信度被拒、第 30 条不合格整批不写、同幂等键不重复、同名同类型复用、批次一步撤销 |
| P1 从库加入（US4） | 选择器 + 快照 + 角标 + 刷新节点 | `hgraph/entity-picker.tsx` + 既有 `entity-api`/`facts`/`graph` | 组件/线路级：加入快照字段齐全、取不到如实标注、角标只改界面不改文件、未绑库按钮灰显 |
| P1 导出（US5） | PNG 两档 + 标题块 + 附录 + 留痕 + 文件名 | `hgraph/export.ts`、`hgraph-ops.ts` 的 export、`file-tree.tsx` | 组件/线路级：两入口同一动作、非成员 403、文件名格式唯一、附录与 PNG 同次下载、留痕一条 |
| P2 收回（US6） | 撤销 20 步、合并、复制粘贴、冲突 | `undo.ts`、`canvas.tsx`、`editor.tsx` | 状态机断言具体值：撤销后剩几条边、合并后端点指向谁、外部重载清栈、409 不静默合并 |
| P2 大图（US7） | 搜索、隔离、筛选、查找路径、标签分级、降级 | `hgraph/canvas.tsx`、`toolbar.tsx` | 纯函数（BFS 最短路径、标签取舍、隐藏计数）+ 组件；帧率为真栈实测项，进缺口表 |
| P2 视觉（US8） | 双向边平行、实线/虚线、线宽/外环档、图例 | `hgraph/canvas.tsx`、`legend.tsx`、`graph-icons.tsx` | 纯函数（边偏移 k×8、线宽档映射）+ 组件；深色**不验** |

**提交切分**（宪法：一个 PR 不混合重构与新功能）：
1. `refactor: 抽出 graph-layout`（纯移动 + re-export，用例零改动）；
2. `feat(hgraph): 格式与写入者`；
3. `feat(hgraph): 画布与手画`；
4. `feat(hgraph): 演示 / AI 工具 / 从库加入 / 导出`；
5. `feat(hgraph): 撤销 / 大图 / 视觉规格`。

## Complexity Tracking

无宪法豁免项。以下三处是本 plan 主动收敛的复杂度（不算 violation，登记以免后来者误解）：

| 事项 | 为什么需要 | 更简单的替代为什么不成立 |
|---|---|---|
| 新增 `hgraph-ops.ts` 写入者，而不是复用通用写口 | FR-011 要求单一写路径；通用写口 trim/CRLF/非原子/无锁/版本口径不同 | 改通用写口来兼顾 `.hgraph` = 为一个小功能动共享写口，且两种语义在一处必然互相污染 |
| 抽出 `graph-layout.ts`（小重构） | 两个视图必须同一套布局，否则观感分叉 | 复制一份进 `hgraph/` = 第二份布局算法（`#002-06`），且抽出保持 re-export 后既有调用方零改动 |
| 服务端纯函数 `hgraph-file.ts` 与写入者分离 | 解析/校验/操作应用必须能在无磁盘、无 HTTP 的条件下测（TDD 前提） | 全塞进 `hgraph-ops.ts` 只能靠临时目录 + 线路级用例，红得慢、变异验证不精确 |

## 复查（Phase 1 设计之后）

Phase 1 产出的 `data-model.md` / `contracts/` / `quickstart.md` 与本 plan 一致，复查结论：

- 宪法 I（冲突最小）：契约里没有新增对上游高频文件的改动；`case-mcp-tools.ts` 的唯一改动是「把内联解析改成调用抽出的纯函数」，是行为等价重构且单独提交。
- 宪法 IV（权限下沉）：`contracts/hgraph-ops.md` 把「成员门 → 路径闸 → 写入」的顺序写死，导出口先授权后出图；`contracts/mcp-tools.md` 把 3 个写工具列入属主门。
- 宪法 V（加不改）：`contracts/ui.md` 要求右键菜单/工具栏/检查器调**同一个动作函数**，明确「新加接线，不改既有动作语义」。
- 无新增 [NEEDS CLARIFICATION]：spec 的 5 条澄清已覆盖本期边界（全部 8 个 US、`出现序` 人工输入、浅色、只列一种类型、关系页只列选中实体）。
