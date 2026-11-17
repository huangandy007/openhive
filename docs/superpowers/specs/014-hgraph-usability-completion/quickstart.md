# Quickstart：怎么跑、怎么验

> 目标是「一条命令证明一层」。所有命令从仓库根 `D:\project\study\openhive\openhive` 起算、按每节 `cd` 到对应 package；所有测试都带超时（同步死循环 bun 自己拦不住，见 LEARNINGS 的 timeout 纪律）。

## 交付摘要（014-hgraph-usability-completion）

把 `.hgraph` 关系图从「能看」补到「能放心改」。用户可见能力：

- 未选中节点按类型着色（号码 / 账户 / 地点 / 组织 = 浅色底 + 1.5px 类型色描边）；未识别类型保持中性（设计 08 §4.3 开放词表，缺口见 §2b/§3）。
- 连续加节点自动命名「新节点 1/2/3…」；同一节点连粘两次得到两个不同 id。
- 手写事件九格与事件必填闸（名称 / 类型 / 来源 / x,y / 时间）；事件→参与方角色边走生产路径。
- AI 造节点撞同名时复用已有节点，工具结果给一行可见提示。
- **保存冲突/超时先读盘**：盘上 = 「已存 + 本批」⇒ 静默采纳并重放未发编辑；真冲突才提示；绝不自动重发同一批。
- 轮询同值补丁只推进版本；有未发批时只提问，不静默改文档。

关键实现落点：

| 落点 | 作用 |
|---|---|
| `hgraph/editor.tsx` | 串行确认发送槽（失败确认的读盘+判定期间独占 `正在发`）、`采纳盘上结果`、位置对齐 id 映射与未发编辑重放、轮询按**已存基线**比较 |
| `hgraph/same-content.ts` | 规范化比较（id 位置化、边端点换位序、忽略 `更新于`）与 `对齐映射` |
| `hgraph/default-name.ts` | 默认名递增唯一出处 |
| `center/case-views/graph.tsx` | `填充` / `类型描边` 单一色表（hgraph 只消费） |
| 服务端 `hgraph-file.ts` / `hgraph-ops.ts` / `case-hgraph-tools.ts` | 唯一「是事件节点」、幂等表四元组隔离、`graph_add` 复用提示 |

门禁与残余见 §1b / §2 / §2b。

## 0. 前置

- `bun install` 之后**必须** `git diff --stat bun.lock` 为空（只要非空就 `git checkout -- bun.lock`）。
- 后端测试用 PGlite/内存夹具，不需要真 PG。
- 真栈验收需要远端 PG：启动栈时**必须**带 `REAL_STACK_DB=remote`（缺了就静默走错库）；栈不热重载，改完源码必须重启。

## 1. 后端（写路径 + 格式闸）

```bash
cd packages/opencode
timeout 420 bun test test/server/case-hgraph-file.test.ts test/server/case-hgraph-edit.test.ts test/server/case-hgraph-ops.test.ts test/server/case-hgraph-tools.test.ts
```

**改前基线（实测 2026-11-17）**：`case-hgraph-edit.test.ts` 27 pass / 0 fail / 3.43s。

**期望**：0 fail。新增用例至少覆盖：

- 同批两个同名节点 ⇒ `新增 2`、两个不同 id；
- AI 工具同名 ⇒ 复用（开关只在 AI 路径为真）；
- `kind="事件"` 通过；缺 `来源.实体` ⇒ `BAD_SHAPE`；不要求 `依据`；
- 同载荷重试复用幂等键、异载荷换键（重放 `重放: true`）。注意 `批次` 每次发送都自增（`editor.tsx:854`），**不是**幂等键；服务端窗口是进程内 10 分钟（`hgraph-ops.ts:350`）。

## 2. 前端（交互 + 事件 + 面板）

用 `test:components` 那一套参数跑整个目录（**本目录不能按扩展名拆**：`export.test.ts` 虽是 `.ts` 也 import JSX，在 `--conditions=solid` 下会 `SyntaxError: Export named 'jsxDEV' not found`）：

```bash
cd packages/app
timeout 420 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph
```

**改前基线（实测 2026-11-17）**：**475 pass / 0 fail，96.82s，17 文件**。两条纪律：① 路径过滤器必须带 `./` 前缀，否则 bun 当名字匹配、报「did not match any test files」；② `bunfig.toml` 只 preload `happydom.ts`，`solid-jsx.ts` 必须命令行补，缺了就 `jsxDEV` 报错。

**期望**：0 fail。新增用例至少覆盖：

- 滚轮：`deltaY: 3.75` 改 `scale`；`deltaX:120, deltaY:0` 只平移；
- 空格/手模式光标；拖到名字标签松手建边；空白松手有提示；
- 删除键：点过工具栏后仍能删，且写盘批次 = 1；输入框内只删字；演示态静默；
- 事件卡：`[data-node-shape="event-card"]` 存在，两行文本逐字匹配；
- 两态：绑定事件九格无输入框；手写事件九格（含时间/参与方/金额/其他）均有可编辑控件；
- 布局：控件把模式原样传给 `布局目标`；
- 强度过滤：N=3 时 1–2 档边不渲染、提示条数正确、可恢复；
- 布局几何：搜索/筛选/计数 `rect.y` 在工具栏底与画布顶之间；画布高 ≥ 改前同窗口实测值。

**动了共享面板常量（`面板宽/面板边距`）时另跑邻域图**——它钉住了 304 / `w-[280px]` / 292 三个口径。改前基线（实测 2026-11-17）：**73 pass / 0 fail，4.20s**。

```bash
cd packages/app
timeout 420 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/graph.test.tsx
```

## 3. 门禁（在仓库根）

```bash
bun run typecheck
bun run lint
```

**期望**：两者退出码 0；`bun run lint` 改动面 0 error。

## 4. 真栈主流程（MVP 完成判据）

重启真栈后，用既有 `111.hgraph` 走一遍：

1. 工具栏「加事件」⇒ 视口中心出现事件卡（不切模式、不新增文字块）；
2. 从事件卡拖到实体 ⇒ 建立角色边（填角色 + 依据 + 可信度）；
3. 保存 ⇒ 「已保存」出现，盘上文件含该事件节点与边；
4. 关闭重开 ⇒ 事件卡两行文本与边标签原样；
5. 撤销一次 ⇒ 整批（事件 + 边）一起消失，不是只撤一半。

**任一步失败 ⇒ MVP 未完成**（spec SC-018）。记录每步实际结果，不写「应该没问题」。

## 5. 变异验证（每个切片必做）

按 `#003-03` 三类记录：拆哪一处 → 红哪几条 → 红成什么样。至少覆盖：

- 拆掉 `同名复用` 开关 ⇒ 同名用例红；
- 拆掉幂等键 ⇒ 超时重试用例红；
- 拆掉键盘监听上移 ⇒ 删除键用例红；
- 拆掉事件来源闸 ⇒ 半绑定事件用例红；
- 拆掉强度过滤 ⇒ 计数用例红。

## 6. 本机验不了的（写缺口表，不假装覆盖）

真实触控板 `deltaY`/`deltaMode`、200% 缩放下标签 LOD、A3 300DPI 出图、窄屏 1280/1440 观感、共享常量改动后邻域图观感、深色主题（宪法不启用）。见 spec §Assumptions 与设计文档 §6。

另有一条**必须真栈验**的：现网 `case_event_participant.role` 是否已按角色词表写入（`case-card-template.ts:34`）。PGlite 夹具里造得出，但不代表现网数据就是这样——真栈打开一个绑定事件看「角色」列，空/自由文本就记缺口。

## 014 实施结果（2026-11-17）

> 执行环境：Windows / Git Bash / bun 1.4.3（`c6da4a4d3`）/ worktree `014-hgraph-usability`。
> 六条命令**串行**跑（并行门禁会造假红，`#003-01`），下面贴的是本机**实际**输出，不是计划预期。
> **本机没有真栈**：§4 真栈主流程与远端 PG 项未跑，原样进缺口表；真栈由主会话另跑。

### 1. 六条命令实测

| # | 命令 | 实际结果 | 基线 → 现在 | exit |
|---|---|---|---|---|
| 1 | `packages/app`：hgraph 目录全量 | **558 pass / 0 fail**，2461 expect，**18 文件**，113.30s | 475 pass / 0 fail，17 文件，96.82s ⇒ +83 pass、+1 文件，0 fail | 0 |
| 2 | `packages/app`：`graph.test.tsx` | **73 pass / 0 fail**，709 expect，1 文件，3.63s | 73 pass / 0 fail，4.20s ⇒ 条数持平，0 fail | 0 |
| 3 | `packages/opencode`：后端 3 文件（file / edit / ops） | **109 pass / 0 fail**，514 expect，3 文件，7.67s | 基线只记了 edit 单文件 27 pass / 3.43s；本次 3 文件合计 109 pass | 0 |
| 4 | 根 `bun run typecheck` | **32 successful / 32 total**（31 cached，`@opencode-ai/app` 实跑 `tsgo -b`），2.675s | 32/32 | 0 |
| 5 | 根 `bun run lint` | **1 error**（既有，见 §4）+ 6895 warnings，4356 文件，32.6s | 同左（非本 feature 引入） | **1** |
| 5b | 根 `bun run lint:openhive`（改动面口径） | **0 error** / 1072 warnings，486 文件，2.4s | 0 error | 0 |
| 6 | `git diff --stat bun.lock` | **空输出**（工作区其余文件也 clean） | 必须为空 | 0 |

补充（quickstart §1 同一条命令里的第 4 个文件，单跑）：`case-hgraph-tools.test.ts` **43 pass / 0 fail**（4.47s）；同目录其余 3 个 `case-hgraph-contract` / `citation-parity` / `whitelist-parity` **24 pass / 0 fail**（6.56s）。后端 7 个 hgraph 测试文件全绿。

### 1b. 终局 code review 及五轮修复后的最终数字（2026-11-17）

上表是 T018 时的快照。整支终局评审判 BLOCK（7 Critical，均为未声明的 spec MUST 缺口），先按 1a / 1b / 2 三轮修复（592/118）；随后按用户要求做**双视角 code review（spec 一致性 + TDD 真实性）**，两位评审均判 BLOCK，再经三轮修复：review-fix3（FR-007 读盘采纳 / FR-052 类型色 / FR-003 默认名 / FR-005 复用提示 / `toBeNull()` 布尔化 / 幂等四元组 / 粘贴两次）、review-fix4（FR-007 重做为**串行确认**并重放未发编辑）、review-fix5（轮询同值分支改用**已存基线**比较，未发批不再被静默推进版本），每轮都由独立评审定点复核，最终均 PASS。最终实测：

| # | 命令 | 最终实际结果 |
|---|---|---|
| 1 | `packages/app`：hgraph 目录全量 | **619 pass / 0 fail**，3096 expect，20 文件，134.92s（T018 时 558） |
| 2 | `packages/opencode`：后端 3 文件 | **119 pass / 0 fail**（T018 时 109）；`case-hgraph-tools.test.ts` **43 pass** |
| 3 | 根 `bun run typecheck` | **32 successful / 32 total** |
| 4 | 改动文件 oxlint | **0 error**（329 warnings 为既有风格类） |
| 5 | `git diff --stat bun.lock` | **空** |

修复轮落点（详见 `.superpowers/sdd/tasks/progress.md` 与 `code-review-spec.md` / `code-review-tdd.md` 及 `review-fix3~5.md`）：角色边生产路径、手写事件九格、事件时间/名称两道闸（服务端唯一 `是事件节点`）、画布 1px 描边与圆角、F2 上移、筛选覆盖层与两浮层 Esc/点外、外环自动类型色、连接/绑定事件操作脚；review 轮另修未选中节点**类型色底 + 1.5px 类型色描边**（FR-052）、默认名递增（FR-003）、AI 复用节点可见提示（FR-005）、冲突/超时**先读盘、同内容静默采纳**（FR-007，串行确认 + id 映射重放）。

### 2. 缺口表（本机验不了，不假装覆盖）

| # | 项 | 为什么本机验不了 | 怎么验 |
|---|---|---|---|
| G1 | **真栈主流程 5 步（SC-018）**：加手写事件 → 连参与方 → 存盘 → 重开 → 一次撤销 | 本工作区无真栈；组件/后端用例只覆盖各段，不覆盖真进程 + 真文件 + 真浏览器串联 | 主会话重启真栈后按 §4 逐步记录实际现象 |
| G2 | **远端 PG**（`REAL_STACK_DB=remote`）下的写路径与幂等 | 后端测试全部用 PGlite/内存夹具；量不出远端往返、半开连接、连接槽占满 | 真栈带 `REAL_STACK_DB=remote` 走主流程，记录耗时与失败现象 |
| G3 | 现网 `case_event_participant.role` 是否已按角色词表写入（`case-card-template.ts:34`） | PGlite 夹具造得出不代表现网数据如此 | 真栈打开一个绑定事件看「角色」列；空/自由文本即记缺口 |
| G4 | **AI 工具造手写事件不带 `时间精度` 的口径** | `graph_add` 造的手写事件若缺 `时间精度`，前端 `是事件节点` 判据为 false ⇒ 渲染成普通形状而非事件卡（`canvas.test.tsx:1032` 只钉判据本身）；真模型/工具层会不会补、该不该补，本机无真模型 | 真栈让 AI 起一张带事件节点的图，看落盘属性与渲染；口径定了再决定是否在工具层补 |
| G5 | 真浏览器几何：画布条四项矩形、画布高、检查器三态、工具栏底/画布顶 | happy-dom 没有真布局，`getBoundingClientRect` 是桩值；几何用例只钉信号与相对关系 | 真浏览器按固定窗口量矩形（`#006-06`：`overflow:visible` 恒 0 的坑） |
| G6 | 真浏览器对比度/色相：品牌金选中态、12px 标签对比度 | 组件测试不解析 CSS 层叠与最终色值；深色主题宪法不启用、无 token 覆盖 | 真浏览器取 computed style + 对比度工具（参考 axe 配方） |
| G7 | 悬停 300ms 说明浮层的**裁切与定位** | 用例用假计时器只验「出现/消失」，portal 在 happy-dom 里不产生真裁切 | 真浏览器把窗口压窄、贴边悬停，看浮层是否被父容器裁掉 |
| G8 | 图例 <900 折叠的**真宽观感/热区**（FR-057 精修） | 组件用例只钉 `图例应折叠(宽)` 信号与 DOM 挂载，不量真宽与热区 | 真浏览器把画布条拉过/拉回 900，量折叠按钮热区与浮层位置 |
| G9 | 真实触控板 `deltaY`/`deltaMode` | 本机无触控板；组件用合成 `WheelEvent` | 真机触控板逐档记录缩放/平移 |
| G10 | 200% 缩放下标签 LOD | 缩放是浏览器级，组件环境无真 DPR/缩放 | 真浏览器 200% 缩放看标签分级 |
| G11 | 窄屏 1280 / 1440 下工具栏单行不折行与观感 | 同上，无真窗口宽度 | 真浏览器两档宽度截图 + 横向溢出量 |
| G12 | A3 300DPI 出图 | 导出走 canvas/SVG 光栅化，组件环境不产出可比位图 | 真浏览器导出后用图像工具核尺寸/DPI |
| G13 | 深色主题 | 宪法规定不启用暗色模式，无 dark token 覆盖（已知 dark 选中态对比度缺陷，见 memory） | 待启用时统一处理，不在本轮 |
| G14 | **「客户端超时、服务端其实已落盘」的生产链路**（FR-007 的串行确认 + 同键重放） | 本机用假服务端建模（迟到提交、CAS、无幂等表）与后端单测（幂等表、PGlite）各自覆盖，但没有真网络超时 + 真幂等表 + 真轮询串起来跑过 | 真栈人为断网/拖慢 `写` 后重试，看最终一致（不重复、不分叉、无「保存中…」悬挂） |

### 2b. 代码层残余（已知、已裁定不修）

| # | 项 | 影响 | 裁定 |
|---|---|---|---|
| R1 | 采纳（`采纳盘上结果`）不重映射 `草稿副本` | 该字段今天只有透传、无消费者；真正还原走已重映射的逆操作 ⇒ 当前不可感知 | 将来接消费者时必须一起映射（`#002-06`） |
| R2 | 轮询 `await 读` 后无 `文档代` 复核 | 理论上旧应答可重载一次旧内容；下一 tick 按版本自愈 | 低危，记残余 |
| R3 | review-fix5 新用例的假服务端不建幂等表 | 生产走「同键重放」、用例走「409 → 采纳」；两条路线终态一致，主判据（重试带旧版本）不变 | 用例注释按实情写；真栈链路见 G14 |

### 3. 本轮未交付的规格项（spec / tasks 已裁延后）

| FR | 未交付内容 | 现状/依据 |
|---|---|---|
| FR-045 | 「路径标注」按钮 | 动作表无条目、任何 FR 未定义行为 ⇒ **按裁定不挂死按钮**（`hgraph/toolbar.tsx:11`、`:399` 注释；`path-label` 图形键留待接管） |
| FR-057 | 图例搬家后的**窄宽精修** | 主体已交付：图例已移出画布、`<900` 折叠为按钮（T013，用例守着）；浮层/热区/观感的真宽精修未做，见 G8 |
| FR-025③ | 从库加入事件的**第三页签** | spec 明确延后（第三入口与①②不同批次） |
| FR-026 | 从库加入事件的**整批生成 + 一次撤销** | spec 明确延后（依赖 FR-025③） |
| FR-027 | **事件→事件**点线 + 箭头 + 「先/同时/同一事件」 | 事件→参与方实线 + 角色标签已交付；事件间那段延后 |
| FR-039 | 行尾「↩ 撤销此字段」 | spec 明确延后（不另造历史，复用全局撤销栈的前提还在） |
| FR-040 | 空图正中「从库加入 / 让 AI 起一张」引导 | spec 明确延后 |
| FR-041 | 演示模式「先填出现序」提示 | spec 明确延后 |
| FR-049 | 检查器面板密度与字段形态精修 | 最小骨架已交付（尺寸/贴边/四段/收起）；精修延后 |
| FR-053 | 选中态 `#FEF3C7` + `#B45309` 2px 精修 | 品牌金选中态已生效；精修延后 |
| FR-054 | 边标签 12px + 2px 同底 halo | spec 明确延后 |
| FR-058 | 开发态 HUD（`?hud=1`） | spec 明确延后 |
| FR-060 | 字号 12px 口径（画布标签 / 面板 12–13px） | spec 明确延后 |

### 4. 已知既有红（非本 feature 引入，未改动、不粉饰）

| 项 | 实测 | 归属证据 |
|---|---|---|
| `packages/app/src/workspace/design-token-refs.test.ts` | **4 pass / 1 fail**（exit 1）：`引用完整性：写了 bg-v2-x 这类工具类，就得有 --color-v2-x 孪生`，缺 `v2-background-bg-accent-soft` 孪生 | 报错面在 `material-facts.tsx:296/307`；该文件最后改动 `557f778b97`（2026-11-16，012 修复轮），`git log 8062d55d17^..HEAD -- material-facts.tsx` 为空 ⇒ 014 未碰 |
| 根 `bun run lint` 唯一 1 error | `'0'-prefixed octal literals and octal escape sequences are deprecated`，`packages/session-ui/src/v2/components/prompt-input/index.tsx:163:19` | 该文件最后改动 `edc8d1d91e`（2026-08-04 `chore: generate`）；014 改动面 55 文件里不含 `session-ui` ⇒ 与 014 无关 |

> 根 lint 的 6895 条 warning 不计入退出码，本次未逐条判定新增/既有；改动面以 `lint:openhive` 的 **0 error** 为准。
