# Implementation Plan: 关系图产物（.hgraph）功能与界面完善

**Branch**: `014-hgraph-usability-completion` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `docs/superpowers/specs/014-hgraph-usability-completion/spec.md`

## Summary

把 `.hgraph` 关系图从「开发者工具」补成民警能用的产物：先修写路径（手动加节点被同名复用吞掉、超时重试误报冲突、幻影重复态），再修手感（滚轮、平移可发现性、连线命中、删除键作用域），然后补事件对象（事实卡片上图、两态面板、参与方角色边），最后收口布局入口、强度过滤、检查器与画布视觉。

技术路线一句话：**只加不造**——四种布局、节点形状、外环、图例、面板常量、幂等键通道、参与方角色词表、事件类型词表**全部已存在**，界面图标**已有成套组件与 39 个图形**（缺的十几个图形补在同一张表里，与 2026-10-29 补 `star` 同一先例），本方案的角色是「接线 + 适配 + 补闸」，新增文件只用于纯函数与事件映射这类没有归属的缝。

## Technical Context

**Language/Version**: TypeScript 5.8.2（Bun monorepo，`bun@1.4.2`）

**Primary Dependencies**: SolidJS 1.9.10 + Vite 7.1.4 + Tailwind CSS v4（前端 `packages/app`）；Hono 4.10.7 + Effect + Drizzle（后端 `packages/opencode`）；无新增运行时依赖

**Storage**: 图文件落沙箱磁盘（JSON，服务端校验 + 原子写）；事件/参与方/出处来自案件 PG（只读消费，不新建表）

**Testing**: `bun test`（按 package）；前端组件用例 happy-dom + solid-jsx；后端用例在 `packages/opencode/test/server/`

**Target Platform**: 公安内网桌面浏览器（浅色、中文），Windows 开发机

**Project Type**: 现有大型 Web monorepo 的功能迭代（非新建项目）

**Performance Goals**: 不新增性能承诺——沿用现有渲染路径；本方案只引入 O(1) 的开关与 O(n) 的过滤，不新增全量重算

**Constraints**: 最小化上游合并冲突（定制只落在 fork 自有文件与配置层）；不引入新依赖；不改数据库表结构；单次写入仍为一个批次、一次撤销

**Scale/Scope**: 单图沿用现有量级（数百节点可交互）；本方案 60 条 FR、18 条 SC、6 条 TR，MVP 为其中 41 条（按 spec Assumptions 的「纳入 MVP」清单逐项数，含 FR-025/027/059 的部分条款）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 本方案如何满足 | 结论 |
|---|---|---|
| I. 最小化上游合并冲突（NON-NEGOTIABLE） | 代码改动全部落在 fork 自有文件（`packages/app/src/center/case-views/hgraph/*`、`packages/opencode/src/server/openhive/hgraph-*.ts`）；**不碰** `sql.ts`、`packages/ui` 的 token 源文件、`colors.txt`。唯一落在上游文件的是 `packages/ui/src/v2/components/icon.tsx` 的**纯追加**图标符号（新增键，不改既有键），与 2026-10-29 加 `star`/`star-filled` 同一先例，commit message 里带「【同步上游时保留】」 | PASS |
| II. 品牌化走配置 | 品牌金用既有语义槽位（`--v2-brand-gold*`、`border-focus`、`text-accent`），不新增硬编码色值 | PASS |
| III. 物理隔离优先 | 不涉及用户数据存储路径；图文件沿用既有沙箱与项目权限 | PASS |
| IV. 权限下沉执行层 | 事件数据一律经既有 `case-fact-read` 读出口（已有鉴权），前端不直连 PG、不新增旁路 | PASS |
| V. 侵入是「加」不是「改」 | 新增 `事件` 枚举值、`同名复用` 开关、`hgraph-canvas-bar` 为新挂载点、事件映射为新增纯函数；不改既有函数语义 | PASS |
| 前端：SolidJS + 原生换皮 | 全部在 `packages/app`（SolidJS）内实现；不引入 React；不新建组件库 | PASS |
| 前端：不启用暗色模式 | 深色品牌金按 spec 裁定登记缺口，本轮只保证浅色 | PASS |
| 质量门禁 | 每个切片跑受影响 package 的 typecheck + 测试 + 根 oxlint；TDD 六步轨道 | PASS |
| 禁止模式：PR 混合重构与新功能 | 每个切片单独提交；重构（如常量导出）与功能变更分开 | PASS |

**无违规项，Complexity Tracking 留空。**

## Project Structure

### Documentation (this feature)

```text
docs/superpowers/specs/014-hgraph-usability-completion/
├── spec.md              # 已定稿（含 5 条澄清）
├── plan.md              # 本文件
├── research.md          # Phase 0：复用裁定与备选方案
├── data-model.md        # Phase 1：事件对象与属性/校验
├── quickstart.md        # Phase 1：可跑验收脚本
├── contracts/           # Phase 1：图文件契约 + 写接口契约 + UI 槽位契约
├── checklists/          # 规格质量清单
└── tasks.md             # Phase 2 输出（/speckit-tasks 生成）
```

### Source Code (repository root)

```text
packages/app/src/center/case-views/
├── graph.tsx                     # 邻域图（共享面板常量 / 类型配色 / 形状映射的来源）
├── graph-layout.ts               # 四种布局（排列模式 + 布局目标）
├── graph-icons.tsx               # 节点类型图标（12 个，只画在节点圆心；工具栏**不**复用）
└── hgraph/                       # .hgraph 编辑器（本方案主战场）
    ├── canvas.tsx                # 画布渲染：节点/边/文字、滚轮、连线命中、外环
    ├── editor.tsx                # 编辑器壳：写盘、撤销、键盘、动作表、顶栏
    ├── toolbar.tsx               # 工具栏（四组图标）
    ├── inspector.tsx             # 检查器（四段/两态/字段）
    ├── entity-picker.tsx         # 从库加入（实体/关系/事件页签）
    ├── legend.tsx                # 图例（编辑态与导出态）
    ├── geometry.ts               # 几何与档位（线宽档/外环档/标签取舍）
    ├── graphops.ts               # 图操作（复制/粘贴/移动/删除的纯函数）
    ├── history.ts / undo.ts       # 撤销栈
    ├── file.ts                   # 图文件类型（前端契约）
    ├── present.tsx / export.ts    # 演示与导出
    └── *.test.ts(x)              # 既有单测（红线：不能变红）

packages/opencode/src/server/openhive/
├── hgraph-file.ts                # 图文件解析 + 来源闸 + 必填字段
├── hgraph-edit.ts                # 应用操作（加/删/改/移动），含同名复用判据
├── hgraph-ops.ts                 # 写入编排（幂等索引 + CAS + 原子写）
├── case-hgraph-tools.ts          # AI 工具（graph_add 等）
├── case-fact-read.ts             # 事实详情读出口（事件/参与方）
├── case-event-types.ts           # 事件类型词表
├── case-card-template.ts         # 角色词表与九格模板
└── case-mcp-tools.ts             # MCP 事件工具（事件列表取数参考）

packages/opencode/test/server/     # 后端用例（含 case-hgraph-*）
```

**Structure Decision**: 沿用现有 monorepo 结构，不新建 package、不新建顶层目录。新增代码按「归属明确才新建文件」原则放入 `hgraph/`（前端）与 `server/openhive/`（后端）；能加在既有文件里的不另起炉灶。

## Complexity Tracking

> 本方案无宪法违规项，本节留空。

## Phase 0：复用裁定（Research）

> 原则（用户指令）：**已支持的只适配，不重复造轮子**。每条给出「复用点 / 需适配什么 / 备选方案与被否原因」。

### R1 写路径：同名复用开关

- **决策**：在既有「应用操作」入口上加显式入参 `同名复用?: boolean`（缺省 `false`），唯一的 `true` 由 AI 工具 `graph_add` 传入；复用判据本体（名称+类型相同、无显式 id）**原样保留**，只是从「无条件」改成「受开关控制」。
- **复用点**：`hgraph-edit.ts` 处理加节点里的 R7 署名复用分支（`hgraph-edit.ts:409-419`）；`应用操作(文档, 操作)` 签名（`:707`）。
- **适配**：签名扩一个可选参数 + 透传到内部上下文。客户端**不做** id 去重（现在也没有）：显式 id 撞车已由服务端拒（`hgraph-edit.ts:355-385`），客户端只按 R3 在成功应答后断言 id 唯一。
- **备选**：在客户端预检重名 → 否（同一前提两处判，`#002-06`）；新建一套「手动加节点」服务端函数 → 否（重复实现复用了坐标/属性语义）。

### R2 幂等键

- **决策**：客户端生成稳定键 `web:${图路径}:${序号}`，仅「与上次失败载荷逐字相同」才复用同键；服务端**零改动**（幂等索引已排在 CAS 之前）。
- **复用点**：客户端接口已留参数位但**现在一次都没传**（`project/hgraph-api.ts:106` 声明、`:159` 透传，`hgraph/*.ts*` 里 grep 无 `幂等键`）；服务端窗口是**进程内 10 分钟**、按「人＋项目＋归一路径＋键」隔离（`hgraph-ops.ts:347-371`），重放分支在 CAS 之前（`:513-519`），`写结果.重放` 已回但**客户端目前不消费**（`hgraph-api.ts:85-88`）；服务端重放能力已有用例钉着（`test/server/case-hgraph-ops.test.ts:424`）。
- **不能用 `批次` 充当幂等键**：`批次 = 批-${++批次序号}` 每次 `发送` 都自增（`editor.tsx:854`），重试正是新的一次 `发送` ⇒ 键会变，重放永远打不中。
- **备选**：改为服务端按「操作指纹」自动去重 → 否（改动服务端契约，且与 AI 工具的重放语义冲突）；客户端按时间戳生成 → 否（重试不会复用）。

### R3 幻影重复态

- **决策**：写入成功分支加一条「id 唯一」断言，不唯一即请求重载；不新增轮询逻辑。
- **复用点**：既有轮询与版本比较（`editor.tsx:1077`）、既有重载函数。
- **备选**：修改轮询条件为「版本不一致或图内容不一致」→ 否（每次轮询全量比较，代价高）。

### R4 滚轮 / 平移 / 连线命中

- **决策**：滚轮判据换成「`ctrlKey` 非真 且 |deltaX|>|deltaY| 才平移」；空格状态复用既有 `空格` 信号加光标；连线松手复用按下的 DOM 命中（`elementFromPoint` + `closest`），数学判据降为兜底。
- **复用点**：`canvas.tsx:83`（判据）、`:349`（空格状态）、`:577`（按下命中）、`geometry.ts:104-117`（数学兜底）。
- **备选**：新增「滚轮行为」设置项 → 否（YAGNI，设计明确不加）；重写一套指针状态机 → 否（现有 pointer 事件链已覆盖拖动/框选）。

### R5 删除键作用域

- **决策**：键盘监听上移到编辑器根容器并由其独家接管，画布内不再监听同一按键；输入守卫与 `present` 静默逻辑原样搬。
- **复用点**：`canvas.tsx:852-901`（监听 + 守卫 + Delete 分支）、`editor.tsx:1602-1615`（唯一翻译点）、`editor.tsx:1685-1696`（根容器）。
- **备选**：在每个按钮上 `preventDefault` 焦点 → 否（治标，面板/输入框仍会吃焦点）；注册全局窗口热键 → 否（违反基线 §11-12）。

### R6 布局入口

- **决策**：「排列」下拉（四模式）+ 自动布局按钮，复用 `graph-layout.ts` 的 `排列模式` 与 `布局目标`，确认条与锁定语义原样保留。
- **关键发现（省一大截活）**：模式参数**已经通了**——`动作表.自动布局: (模式) => { set布局模式(模式); set待确认布局(true) }`（`editor.tsx:1631-1634`），执行时 `布局目标(文档(), 布局模式())`（`:1376-1377`）。现在缺的只是**工具栏没传模式**（`toolbar.tsx:153` 调 `自动布局()`）⇒ 改动面 = 工具栏加一个下拉把值传进去，编辑器侧一行不用改。
- **复用点**：`graph-layout.ts:81/83`（`排列模式` 与 `排列模式们`）、`:211-219`（`自动位置` 的四路分派：环形复用 `布局`，网格/分层/力导向各一支）、邻域图四按钮（`graph.tsx:891-909`）的调用方式、`editor.tsx:401-419`（已有 `布局目标(文档, 模式)` 包装）、`toolbar.tsx:146-156` 现有按钮与确认条。
- **备选**：四个独立按钮 → 否（工具栏宽度不够，§1.3-1 已裁）；右键菜单 → 否（可发现性差）。

### R7 事件对象

- **决策**：`来源.kind` 加 `"事件"`，沿用「所绑库对象 id」槽位（`来源.实体`），不新增键；属性沿用 `属性[]` + 三个保留键；形状复用画布 `<Switch>` 加一条事件卡分支。
- **复用点**：前端类型 `hgraph/file.ts:31-40`；后端 `hgraph-file.ts:39/469/514/523`（枚举、文案、取值闸、注释）；形状渲染 `canvas.tsx:1219-1247`；必填校验 `hgraph-file.ts:620-624`。
- **适配**：新增两道闸——「事件来源必须有绑定 id」（FR-017）、「绑定事件上图时出处非空，否则拒并提示『这条事件没有出处，不能上图』」（FR-023）；`entity-picker` 的「已在图上」判据仍只认 `实体`（FR-018，不混用）。
- **全文落点（grep 实测，加枚举值时必须逐个过）**：
  1. `app/.../hgraph/file.ts:32` 联合类型；
  2. `server/.../hgraph-file.ts:39` 联合类型、`:514` `来源类别们`、`:469` 错误文案里那句「实体/关系/推断/手写」、`:523` 注释；
  3. `hgraph/inspector.tsx:105-115` `来源文本` —— **坑**：最后一支 `: "手写"` 会把任何未知 kind 静默显示成「手写」，不加 `事件` 分支就等于「绑定了事件却显示手写」；
  4. `hgraph/inspector.tsx:655`（「绑定到库实体」入口的条件 `kind === 手写 || kind === 推断`）；
  5. `hgraph/canvas.tsx:1219-1247` 节点形状 `<Switch>`（事件卡分支）。
- **备选**：新增第 5 种对象集合 → 否（格式契约面扩大，且事件就是节点）；用 `kind="实体"` 冒充 → 否（事件 id 会被当成实体 id，面板两态失效）。

### R8 参与方与角色

- **决策**：参与方读既有 `case_event_participant`（`role` 已是词表落点）；角色词表复用 `case-card-template.ts`（§6.1 词表）；事件详情复用 `case-fact-read.ts` 的事件详情接口，**按需扩展**返回参与方（含 role），不新建读出口。
- **复用点**：`case-fact-read.ts:73-88`（事件详情）、`:220-239`（participants 读取与排除规则）、`case-mcp-tools.ts:960-995`（`role` 已在读、按 `ordinal` 排序、拼成 `role：value`）、`case-card-template.ts:34`（角色词表）、`case-fact-store.ts:392`（写入形态参考）。
- **适配（已核实）**：事件详情确实只回 `participants: string[]`（`case-fact-read.ts:81`，无 role），所以在同一读出口补结构化 role（加法，不改既有字段）；面板「角色 + 名字」的展示直接沿用 `role：value` 约定。
- **备选**：新建事件图专用 endpoint → 否（权限与排除规则要重写一遍）；前端按名字匹配参与方 → 否（`01` §3.8.3 明确不做姓名匹配）。

### R9 事件间关系（先/同时/同一事件）

- **决策**：**只做手写边**（spec MVP-2 已裁）；不新建表、不新增读出口。边语义与依据文案按 spec FR-027。
- **复用点**：既有连线浮层（必填依据 + 可信度）与推断边写入。
- **事实核对**：仓库里**没有**事件关系表（grep `case_event_relation` 无命中），事件之间只能走手写边；而**事件列表**能力是有的——`query_events`（`case-mcp-tools.ts:1011`）＋ 界面出口 `/openhive/timeline`（`case-ui-routes.ts:334-360`），但它强制要求实体 id，没有项目级列表，前端也没有客户端 API。后续批次补第三页签时**只加一条可选参数的路由**，不复制 SQL、不重写权限与排除。
- **备选**：新建事件关系表 → 否（超出本轮，且已裁定降级）。

### R10 强度过滤

- **决策**：复用既有档表计算（线宽档 0–4），在渲染前按 N 过滤边并计数；恢复即清空 N。图例保持纯说明。
- **复用点**：`geometry.ts` 线宽档表、`canvas.tsx` 的 `可见` 过滤入口（演示态已有同型过滤）、既有筛选浮层。
- **适配**：把「仅演示态可见过滤」扩展为「演示可见 ∩ 强度可见」；角落提示复用既有 overlay 写法。
- **备选**：把图例做成筛选器 → 否（设计 §1.2-10 与用户实测都否掉）。

### R11 数值收口

- **决策**：线宽档已有校验与提示模板（`0–4` 整数、非空清键、越界就地提示），外环档**复用同一模板**（同一实现点）；外环颜色输入改为下拉，选项直接复用画布的外环色表。
- **复用点**：`inspector.tsx:340-357`（线宽档：清空删键 / 非有限 / 非整数 / 越界 ⇒ 提示「要填 0–4 的整数」，样板就在这）、`inspector.tsx:214-221`（外环档现状：**只判 finite**，缺 0–4 与整数闸）、`:224-228`（外环颜色现在是自由文本）、`canvas.tsx:523-531`（色名 → 主题槽位，7 色）、`geometry.ts:505-517`（`线宽档`/`外环档` 纯函数与 `最大档 = 4`）。
- **备选**：另建一份色表 → 否（`#002-06`）；接受任意色名兜底 → 否（静默失效已被实测）。

### R12 检查器与共享常量

- **决策**：`面板宽/面板边距` 从 `graph.tsx:26-27` 升级为 320/0（唯一定义），hgraph 检查器继续 import；四段骨架在既有面板内重排，不新建面板组件。
- **复用点**：`graph.tsx:26`（`面板宽 = 280`）、`:27`（`面板边距 = 24`）、`inspector.tsx:44`（import）、`:448-453`（容器，`style` 已用常量、class 里另写死一份 `w-[280px]`）。
- **连带改动（实测清单，漏一处就两套宽度）**：
  1. `graph.tsx:1326`、`graph.tsx:1411` 两处面板 class `w-[280px]`；
  2. `inspector.tsx:451` class 里的 `w-[280px]`（被 `style` 覆盖但仍是一份死值，删掉）；
  3. `graph.tsx:1302` 缩放条 `right: "292px"` 硬字面量（必须重新算到让开 320）；
  4. `graph.test.tsx:1289` `右界 = 画布.宽 - 304`、`:1293` 断言 class 含 `w-[280px]`、`:1332` 断言 `条().style.right === "292px"`——**这三条是既有红线用例，改常量必须同步改口径**，先让它们绿再动别的。
- **备选**：hgraph 另存一份常量 → 否（两份会漂）；新建通用 Panel 组件 → 否（上游无此抽象，新建即冲突面）。

### R13 视觉 token

- **决策**：品牌金类缺样式只修**一处**（`canvas.tsx:1011` 的 `border-v2-brand-gold-deep` → 语义槽位 `border-v2-border-border-focus`），其余内联 `var(--v2-brand-gold*)` 本就生效；裸 `rounded` 实测 15 处（hgraph+graph.tsx），逐个改显式 `rounded-md/lg/xl`；**不动** `packages/ui` 的 `colors.txt`/`tailwind.ts`/`theme.css`。
- **复用点**：`packages/ui/src/v2/styles/theme.css:23-25/67`（既有语义槽位）。
- **备选**：在 `colors.txt` 补 `v2-brand-gold` → 否（改上游生成源 = 合并冲突面）；补 `--radius` 基值 → 否（设计明确说不补）。

### R14 节点类型色 / 外环默认色

- **决策**：复用邻域图已存在的类型→色映射，以导出方式供 hgraph 按「类型字符串」调用；不新建配色表。
- **复用点（实测行号）**：`graph.tsx:46` `形状(类型)`（**已导出**）、`:53` `填充(点)`、`:65` `描边(点)`、`:76` `描边色(点, 焦点)`、`:81` `边颜色(类型)`（后四个是模块内私有，需导出）。
- **适配**：hgraph 的节点类型与邻域图的 `图节点` 不同构 ⇒ 导出时把入参收窄成结构型 `{ readonly type: string; readonly subtype?: string }`，两边的节点都能直接传；只在 `graph.tsx` 加 `export`，不改函数体。
- **备选**：hgraph 自建一套类型色 → 否（同类型两处不同色，用户会当成两套语义）；改 `entity-type-badge`（明确「不建映射表」）→ 否。

### R15 工具栏与图标

- **决策**：工具栏图标复用**已有的 v2 图标组件** `@opencode-ai/ui/v2/icon`（`<Icon name="…">`，读 `#opencode-v2-icon-<name>` 精灵）；缺的图形**追加键**到同一张 `icons` 表（`packages/ui/src/v2/components/icon.tsx`），每个新键带注释「openhive 定制 · 【同步上游时保留】」。
- **复用点（实测）**：
  - 组件本体 `packages/ui/src/v2/components/icon.tsx:165`（`symbol`）、`:194`（`name` 已开放为 `string & {}`，**加新键不必改类型**）；
  - 同页已有先例：`case-views/card-template-editor.tsx:5` 就在用 `@opencode-ai/ui/v2/icon`（`name="xmark-small"`），工具栏与它同风格；
  - 现成图形够用的：`plus`（加节点）、`folder-add-left`（从库加入）、`chevron-down`（排列下拉）、`grid-plus`/`reset`（自动布局）、`outline-sliders`（强度过滤）、`magnifying-glass`（搜索）、`expand`（适配全部）、`outline-share`/`outline-square-arrow`（导出）。
- **缺的图形（要追加）**：指针、手、连线、加文字、删除、锁定、对齐、等距、隔离、查找路径、合并、演示、路径标注（约 13 个）。**不**用 `graph-icons.tsx`——那份只有 12 个**节点类型**图标（人/手机/证件……），且文件头写明「不进 `packages/ui/src/components/icon.tsx`」，用途不同。
- **先例依据**：2026-10-29 提交 `e5b4745882` 已按同样方式往该表加过 `star`/`star-filled`，commit 里写明「上游图标表没有星形」与保留约定。
- **备选**：用旧版 `@opencode-ai/ui/icon`（97 个图形，`selector`/`link`/`trash`/`eye`/`dot-grid` 都在）→ 否（同页两套图标系统，笔画粗细与视口不一致）；新建 `hgraph/toolbar-icons.tsx` 内联 SVG → 否（第二套系统，且 case-views 已在用 v2）；引入第三方图标库 → 否（新增依赖 + 视觉不一致）。

### R16 图例

- **决策**：编辑态图例整体搬到新建的画布条右端，组件本身复用 `legend.tsx`；导出侧独立 SVG 渲染保持不变（导出仍含图例）。
- **复用点**：`legend.tsx`（编辑态与导出态渲染）、`export.ts`（导出组合）。
- **备选**：图例可拖拽并记忆位置 → 否（§1.3-2 定案 B）；只在窄画布折叠 → 否（只缓解遮挡）。

### R17 滑块（强度过滤）

- **决策**：仓库内无 Slider 组件（实测 `packages/app/src` 无 `Slider`），用原生 `input[type=range]` + 既有 token 样式，封装为 hgraph 本地小控件（不新增依赖）。
- **备选**：引入 Kobalte Slider → 否（新增依赖）；用四个档位按钮代替滑块 → 可接受但占宽，滑块更省。

### R18 事件卡渲染

- **决策**：在节点形状 `<Switch>` 中前置一个「来源.kind === 事件」分支，渲染 96×34 `rx=6` 圆角卡 + 两行文本（`data-node-shape="event-card"`），并忽略 `样式.形状`。
- **复用点**：`canvas.tsx:1219-1247` 形状 Switch、`:1256` 首字文本、标签渲染。
- **备选**：把事件卡做成 HTML foreignObject → 否（导出 SVG 不一致）；新增独立图层 → 否（命中/拖拽/连线要重写一遍）。

### R19 空态与浮层

- **决策**：空态两入口复用既有「从库加入」按钮与 AI 会话入口；浮层关闭统一走既有 overlay 写法（Esc + 点外），层级通过 z-index 顺序修正。
- **复用点**：`entity-picker` 浮层、筛选浮层、右键菜单 z 序。
- **备选**：新建通用 Modal 组件 → 否（三处浮层各有交互细节）。

### R20 测试基建

- **决策**：前端用例沿用 `hgraph/*.test.tsx` 既有渲染方式（happy-dom + solid-jsx preload）；后端沿用 `packages/opencode/test/server/case-hgraph-*` 的夹具（`摆图`/`空图`）；每个 FR 先红后绿，变异验证按 `#003-03` 记录。
- **备选**：新建 e2e 套件 → 否（本轮用真栈手工主流程替代，见 spec SC-018）。

## Phase 1：数据模型与契约

> 详细内容见 `data-model.md`、`contracts/`、`quickstart.md`。此处只列结论。

### 数据模型（无新增表）

- **事件节点**：`节点` 的一种，`来源.kind="事件"`，`来源.实体` = 库事件 id，`来源.库类型` = 事件类型，`来源.可信` = 信任态。
- **保留属性键**：`金额`、`时间精度`、`参与方·<角色>`；其余归「其他」。
- **状态**：手写（`kind="手写"`，九格可编）↔ 绑定（`kind="事件"`，九格只读）；**无解绑**。
- **校验**：`来源.kind="事件"` 且 `来源.实体` 为空 ⇒ `BAD_SHAPE`；事件节点必填 `id/名称/类型/来源/x/y/时间`。
- **兼容**：旧图（无事件）继续可读；不要求旧客户端读新文件。

### 契约

- **图文件格式契约**：`contracts/hgraph-format.md`（新增枚举值 + 保留键 + 闸位）。
- **写接口契约**：`contracts/hgraph-write.md`（`幂等键` 语义、重试复用规则、409 静默采纳条件）。
- **UI 槽位契约**：`contracts/ui-slots.md`（`hgraph-canvas-bar`、`hgraph-toolbar-add-event`、`data-node-shape="event-card"`、`hgraph-toolbar-layout`），供用例与后续实现对齐。

### 宪法复审（Phase 1 后）

设计与本方案一致：无新依赖、无新表、无权限旁路；唯一的非 fork 文件改动是 `packages/ui/src/v2/components/icon.tsx` 的**纯追加**图标符号（R15，已有同例先例）⇒ **PASS**（无违规项）。

## 交付分层（与 spec MVP 对齐）

| 层 | 内容 | 对应任务批次 |
|---|---|---|
| MVP | 写路径、手感、画布边界与品牌金、三行布局+删除键、工具栏+强度+布局、事件（手写优先）、检查器骨架+数值收口 | T1–T6 |
| 后续批 | 面板密度、行尾回滚、图例搬家、圆角显式化、空态/演示提示、HUD、字号、选中态与标签 halo | T7–T9 |

## 开工前置核查：两项都已核（2026-11-17）

| 核查项（spec Assumptions） | 核对结果 | 对 MVP 的影响 |
|---|---|---|
| ①「事件→事件」取数出口 | **没有**事件关系表（grep 无 `case_event_relation`）⇒ 事件间只能手写边，与 spec 裁定一致 | 无（已按降级做） |
| ①「从库加入事件」取数出口 | **部分具备**：`query_events`（`case-mcp-tools.ts:1011`）＋ `/openhive/timeline`（`case-ui-routes.ts:334-360`）已在用，但路由强制实体 id、无项目级列表、前端无客户端 API | 无（第三页签本就在延后批）；后续补只需加一条可选参数路由 |
| ② 现网参与方是否已按角色词表写入 | **本机核实不了**（要真 PG + 真案件数据）。代码侧词表与落点齐全（`case-card-template.ts:34`、`case-fact-store.ts:392`、`case-mcp-tools.ts:974` 已按 `ordinal` 读 `role`） | 若现网 `role` 为空/自由文本，面板「角色」列会空 ⇒ 记缺口，**不阻塞** MVP（手写事件不依赖它） |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 键盘监听上移导致同一次按键两次写入 | 根容器独家接管 + 画布删除监听；用例断言「写盘批次 = 1」 |
| 共享面板常量改为 320/0 连带邻域图 | 按 R12 的四项连带清单一起改；邻域图用例（`graph.test.tsx:1289/1293/1332`）改口径后必须先绿；真栈看一眼邻域图 |
| 往上游 `packages/ui/src/v2/components/icon.tsx` 加图形 | 只追加键、不改既有键；每个新键带「【同步上游时保留】」注释；冲突时保留两侧（纯新增，合并无歧义） |
| 事件读取补 `role` 会碰到权限/排除规则 | 只在既有读出口做加法；排除规则（`case-fact-read.ts:228-239`）原样保留 |
| 事件卡影响命中/标签取舍 | 复用现有节点命中与标签逻辑；用例钉 `data-node-shape` 与两行文本 |
| 裸圆角替换面较广 | 按文件分批，替换后视觉对比浅色截图；不顺手改无关样式 |
