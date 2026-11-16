# Tasks: 关系图产物（.hgraph）功能与界面完善

**Input**: `docs/superpowers/specs/014-hgraph-usability-completion/` 下的 `plan.md`（技术方案）、`spec.md`（5 个用户故事 + 60 条 FR）、`research.md`（R1–R21 复用裁定）、`data-model.md`、`contracts/`、`quickstart.md`

**Prerequisites**: plan.md ✔ / spec.md ✔ / research.md ✔ / data-model.md ✔ / contracts/ ✔

**Tests**: **必需**。spec `TR-001..006` 把 TDD 写成硬约束——每个任务都是「先写会红的用例 → 改绿 → 变异验证 → 跑门禁」，不写用例不算完成。

**Organization**: 按用户故事分组（US1..US5），每组的任务合起来就能独立验收。

## Format: `[ID] [P?] [Story] 任务描述`

- **[P]**: 可与同相位其它任务并行（不同文件、不依赖未完成任务）
- **[Story]**: US1..US5 对应 `spec.md` 的用户故事
- 每个任务固定四段：**位置** / **入参 → 出参** / **先红的用例** / **验收**

## Path Conventions

本仓库是 Bun monorepo（`openhive/CLAUDE.md`），没有 `src/` 根目录：

- 前端：`packages/app/src/center/case-views/hgraph/`（编辑器）、`packages/app/src/project/`（HTTP 客户端）
- 后端：`packages/opencode/src/server/openhive/`；用例在 `packages/opencode/test/server/`
- 共享 UI：`packages/ui/src/v2/components/`

**两条测试命令（实测，`quickstart.md` §1/§2）**：

```bash
# 后端
cd packages/opencode && timeout 420 bun test test/server/case-hgraph-file.test.ts test/server/case-hgraph-edit.test.ts test/server/case-hgraph-ops.test.ts
# 前端（整个 hgraph 目录；不要把 .test.ts 单独拆到 --conditions=solid，export.test.ts 也 import JSX）
cd packages/app && timeout 420 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph
```

**改前基线（实测 2026-11-17，动第一行代码前先复跑一遍存档）**：前端 hgraph 目录 475 pass / 0 fail / 96.82s（17 文件）；`graph.test.tsx` 73 pass / 0 fail / 4.20s；后端 `case-hgraph-edit.test.ts` 27 pass / 0 fail / 3.43s。

---

## Phase 1: Setup

**无需初始化**：这是既有 monorepo 的功能迭代，不新建 package、不新增依赖、不建表（`plan.md` Technical Context）。

唯一的前置动作已并入 T018 的收尾（跑基线 + 门禁），不单独占任务。

---

## Phase 2: Foundational（阻塞所有用户故事）

**Purpose**: 两个跨故事的前提——共享尺寸常量、`来源.kind` 的枚举面。改这两个之前，任何 UI/事件任务都会踩到半成品。

- [ ] T001 共享面板常量升级为 320/0 并改完全部连带口径
  - **位置**: `packages/app/src/center/case-views/graph.tsx`（`:26` `面板宽`、`:27` `面板边距`、`:1302` 缩放条 `right:"292px"`、`:1326/:1411` 两处 class `w-[280px]`）、`hgraph/inspector.tsx:451`（class 里的死值 `w-[280px]`）、`graph.test.tsx:1289/1293/1332`
  - **入参 → 出参**: 常量 `280/24` → `320/0`；`布局目标` 与检查器读到的宽度一致；邻域图「让位」口径同步
  - **先红的用例**: 改常量后 `graph.test.tsx` 三条既有断言（`右界 = 宽 - 304`、class 含 `w-[280px]`、`style.right === "292px"`）必红 ⇒ 同步改口径到 320/`w-[320px]`/新的让位值，再绿
  - **验收**: `cd packages/app && timeout 420 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/graph.test.tsx` ⇒ 73 pass / 0 fail；变异：把 `inspector.tsx:451` 的 className 宽度改回 280 ⇒ 断言红
  - **约束**: 常量的唯一定义仍在 `graph.tsx`，hgraph 只 import（`#002-06`）

- [ ] T002 [P] `来源.kind` 全仓落点加「事件」取值（5 处 + 1 处静默分支）
  - **位置**: `packages/app/src/center/case-views/hgraph/file.ts:32`；`packages/opencode/src/server/openhive/hgraph-file.ts:39`（类型）、`:514`（`来源类别们`）、`:469`（错误文案那句「实体/关系/推断/手写」）、`:523`（注释）；`hgraph/inspector.tsx:105-115`（`来源文本`）
  - **入参 → 出参**: 类型联合 `"实体"|"关系"|"推断"|"手写"` → `+ "事件"`；运行时 `来源类别们` 同步；`来源文本({kind:"事件"})` → `事件：<id>`（现在会落进 `: "手写"` 分支，静默显示成手写）
  - **先红的用例**: 后端 `case-hgraph-file.test.ts` 加「`kind="事件"` 的对象通过形状闸、非法取值仍被拒」；前端 `inspector.test.tsx` 加「`来源.kind="事件"` ⇒ 徽标文案含『事件』且不含『手写』」
  - **验收**: 两条用例由红转绿；变异：把 `来源类别们` 里的 `"事件"` 删掉 ⇒ 后端用例红
  - **注意**: 此时不写「事件必须绑 id + 出处非空」的语义闸——那是 T009

---

## Phase 3: User Story 1 - 画一张图，存得住、不丢、不重（P1）

**Goal**: 手动加节点不再被同名复用吞掉；重试不再误报冲突；不再出现「界面 7 个、盘上 4 个」；删除键在焦点离开画布后仍然有效。

**Independent Test**: 空白图上「加同名节点 ×2 → 连线 → 删除 → 模拟超时重试」，盘上内容与界面计数一致、撤销次数 = 动作次数。

- [ ] T003 [US1] 同名复用改成显式开关，只有 AI 工具传 `true`
  - **位置**: `packages/opencode/src/server/openhive/hgraph-edit.ts:707`（`应用操作` 签名）、`:409-419`（R7 署名复用分支）、`case-hgraph-tools.ts`（`graph_add` 调用点）
  - **入参 → 出参**: `应用操作(文档, 操作们, { 同名复用?: boolean })`，缺省 `false` → web 路径同名 + 无显式 id ⇒ `新增 2`、两个不同 id；AI 路径传 `true` ⇒ 仍复用
  - **先红的用例**: `case-hgraph-edit.test.ts` 加「同一 `操作[]` 内两个同名同类型节点、无显式 id ⇒ `新增.节点 === 2` 且 id 互不相同」；`case-hgraph-tools.test.ts` 加「`graph_add` 同名 ⇒ `复用` 命中 1 个」
  - **验收**: 后端两条命令各 0 fail；变异：把缺省值改成 `true` ⇒ 第一条用例红（`新增 1`）
  - **约束**: 复用判据本体不动，只加开关；客户端**不做**重名预检（`#002-06`）

- [ ] T004 [US1] 客户端补幂等键，并在成功分支收口 id 唯一
  - **位置**: `packages/app/src/project/hgraph-api.ts:105-106/158-159`（参数位已有、透传已有）、`hgraph/editor.tsx:838-900`（`发送`，`:854` `批次`）、`editor.tsx:900-967`（成功分支）、`hgraph/edge.ts`/`graphops.ts`（复制粘贴产生新 id 的路径自查）
  - **入参 → 出参**: `写({ …, 幂等键 })` → 同一失败载荷重试时**键相同**（服务端 `重放: true`、不推进版本）；载荷任一字节变化 ⇒ 新键；成功分支断言 `映射` 后 id 集合无重复，重复 ⇒ 触发整图重载 + 提示「图和你本地不一致，请重新载入」
  - **先红的用例**: `editor.test.tsx` 加「同一批发送失败后重试 ⇒ 两次请求的 `幂等键` 相同」与「改动载荷后重试 ⇒ 键不同」；再加「伪造应答映射撞 id ⇒ 出现重载调用与提示」
  - **验收**: 前端 hgraph 目录 0 fail；变异：① 每次发送重新生成键 ⇒ 第一条红；② 删掉唯一性断言 ⇒ 第三条红
  - **约束**: `批次` 不能当幂等键（`editor.tsx:854` 每次自增）；服务端零改动，窗口 10 分钟（`hgraph-ops.ts:350`）

- [ ] T005 [US1] 删除键监听上移到编辑器根容器并独家接管
  - **位置**: `hgraph/canvas.tsx:852-924`（`按键` 监听，含输入守卫与 `只读` 静默）、`editor.tsx:1685-1699`（`data-slot="hgraph-editor"` 根容器）、`editor.tsx:1602-1615`（`删除所选` 唯一翻译点）
  - **入参 → 出参**: `KeyboardEvent`（根容器）→ `删除所选()` 调用一次、写盘批次 = 1；焦点在 `input`/`textarea`/`contentEditable` ⇒ 不删对象；`只读`/演示态 ⇒ 静默
  - **先红的用例**: `editor.test.tsx` 加「点过工具栏按钮后按 Delete ⇒ 节点被删、`写` 调用 1 次」「焦点在检查器输入框内按 Delete ⇒ 只删字不删对象」「演示态按 Delete ⇒ 无副作用」；画布内旧监听删掉后这组必须仍绿
  - **验收**: 前端目录 0 fail；变异：把根容器监听拆掉 ⇒ 第一条红（只有输入框/演示两条还绿，正好证明不是「整段静默」）

---

## Phase 4: User Story 2 - 画图的手感（P1）

**Goal**: 精密触控板纵向滚轮能缩放；平移有可发现的入口（空格/手）；拖到名字上松手也能连线；空白松手有明确提示；选中被面板遮住时自动让位。

**Independent Test**: 逐个输入信号与拖拽路径触发，核对缩放比例、光标字符串、边是否建立、提示文案。

- [ ] T006 [US2] 滚轮判据改为「横向分量占优才平移」，并给空格加抓取光标
  - **位置**: `hgraph/canvas.tsx:83-86`（`是双指平移`）、`:345-352`（`空格`）、`:867-870`（空格分支）、`:1029-1033`（容器 class）、`:1038-1070`（模式条，T013 会删）
  - **入参 → 出参**: `{deltaX, deltaY, ctrlKey}` → `是双指平移` 为 `ctrlKey !== true && |deltaX| > |deltaY|`；`deltaY: 3.75` ⇒ 缩放比例变；`deltaX: 120, deltaY: 0` ⇒ 只平移；空格按住 ⇒ 容器光标 `grab`，拖动中 `grabbing`，松手回默认
  - **先红的用例**: `canvas.test.tsx` 加四条（小数 `deltaY` 缩放、纯横向平移、空格光标 `grab`、拖动中 `grabbing`）
  - **验收**: 前端目录 0 fail；变异：判据改回 `deltaY % 1 !== 0` ⇒ 小数 `deltaY` 缩放那条红
  - **约束**: 光标取值是字符串断言，不放宽成 `toContain("grab")` 之外的模糊匹配

- [ ] T007 [US2] 连线松手改用与按下同一套 DOM 命中，落空给提示
  - **位置**: `hgraph/canvas.tsx` 连线松手分支（约 `:840-850`）、按下命中（约 `:577`）、预览线渲染、`hgraph/geometry.ts:104-117`（数学命中，降为兜底）
  - **入参 → 出参**: 松手点 `(clientX, clientY)` → `elementFromPoint` + `closest("[data-node-id]")` 命中 ⇒ `动作.加边(从, 到)`；未命中 ⇒ 不建边 + 提示「松手不在节点上，未建立连线」；预览线 `pointer-events: none`（不得成为命中的目标）
  - **先红的用例**: `canvas.test.tsx` 加「松手落在目标节点的**名字标签**上 ⇒ 建边」「落在空白 ⇒ 不建边且出现提示文案」「落在预览线上 ⇒ 仍视为空白」
  - **验收**: 前端目录 0 fail；变异：把松手判据换回数学半径 ⇒ 名字标签那条红

- [ ] T008 [US2] 选中被检查器遮住时平移一次，之后不跟随
  - **位置**: `hgraph/editor.tsx` 选中变化处；复用 `graph.tsx:597-607` 的让位算法（`面板宽`/`面板边距`，T001 已改 320/0）
  - **入参 → 出参**: 选中 id + 检查器矩形 + 画布尺寸 → 一次 `视口平移` 使对象居中于未覆盖区域；同一选中期间后续拖动**不再**平移
  - **先红的用例**: `editor.test.tsx` 加「选中被遮挡节点 ⇒ 平移一次」（断言平移值非 0）与「随后拖动同一节点 ⇒ 不再追加平移」
  - **验收**: 前端目录 0 fail；变异：把「一次」改成「每次渲染」⇒ 第二条红
  - **约束**: 不改渲染路径，只加一次副作用

---

## Phase 5: User Story 3 - 在图上表达「事件」（P2）

**Goal**: 事件卡上图（两行文本）、手写/绑定两态面板、工具栏与右键两个入口、事件→参与方角色边；出处缺失与时间缺失各自 fail-closed。

**Independent Test**: 从工具栏与右键各建一个手写事件 ⇒ 卡面两行正确、九格可编；从库加一个绑定事件 ⇒ 九格只读、角色边标签正确；无出处事件被拒且提示可区分。

- [ ] T009 [US3] 事件来源两道闸：必须绑定 event id、绑定事件必须有出处
  - **位置**: `packages/opencode/src/server/openhive/hgraph-file.ts:580-611`（`校验来源`）、`:620-624`（必填字段）
  - **入参 → 出参**: `{kind:"事件", 实体: string, 出处: unknown[]}` → 合法；`实体` 缺/空串 ⇒ `BAD_SHAPE` + 「事件必须绑定库事件 id」；`出处` 空 ⇒ 拒 + 「这条事件没有出处，不能上图」；`时间` 缺 ⇒ 拒
  - **先红的用例**: `case-hgraph-file.test.ts` 加三条（缺 id / 空出处 / 缺时间），并加一条「手写事件不要求出处」
  - **验收**: 后端三条命令 0 fail；变异：把出处闸删掉 ⇒ 空出处那条红
  - **约束**: 不要求事件节点带 `依据`（那是推断边的闸）

- [ ] T010 [US3] 事件卡渲染：96×34、rx=6、两行文本
  - **位置**: `hgraph/canvas.tsx:1219-1247`（节点形状 `<Switch>`）、`:1260-1269`（标签 12px）
  - **入参 → 出参**: 节点 `{来源:{kind:"事件"}, 类型, 属性[]}` → `<rect data-node-shape="event-card" width=96 height=34 rx=6>` + 第一行 `类型首字 · 金额`（无金额只显示类型首字）+ 第二行按 `时间精度` 渲染（日→`MM-DD`；时→`MM-DD HH时`；分/未标→`MM-DD HH:mm`）；忽略 `样式.形状`
  - **先红的用例**: `canvas.test.tsx` 加「存在 `[data-node-shape="event-card"]`」「两行文本逐字等于取值表三组」「缺金额 ⇒ 第一行只有类型首字」
  - **验收**: 前端目录 0 fail；变异：精度分支全按 `MM-DD` 渲染 ⇒ 后两组红
  - **约束**: 事件卡仍走原节点渲染路径（命中/拖拽/标签取舍不另写一套）

- [ ] T011 [US3] 检查器两态 + 参与方段（手写可编 / 绑定只读，未对上档案灰字）
  - **位置**: `hgraph/inspector.tsx` 节点段（`:528-610` 输入区、`:672-730` 只读区）、新增 `data-slot="hgraph-event-participants"`
  - **入参 → 出参**: 选中节点 `来源.kind` → `手写` ⇒ 九格输入框可编、无可信态控件、徽标「手写」；`事件` ⇒ 九格只读、仅备注/外环可改、**无**解绑入口；参与方行 = `角色 + 名字`，未对上档案 ⇒ 灰字「未对上档案」且不建节点
  - **先红的用例**: `inspector.test.tsx` 加「手写事件九格有输入框、绑定事件没有」「绑定事件无解绑控件」「未对上档案行含『未对上档案』」
  - **验收**: 前端目录 0 fail；变异：把两态判据固定成 `kind === "事件"` ⇒ 手写那条红
  - **约束**: 展示口径沿用既有 `role：value` 拼法（`case-mcp-tools.ts:984`）

- [ ] T012 [US3] 加事件两入口（工具栏 + 右键）与角色边生成
  - **位置**: `hgraph/toolbar.tsx`（「画」组，紧跟「从库加入」）、`canvas.tsx:1416-1574`（右键菜单）、`editor.tsx` 动作表（`:1567-1663`）、`hgraph/edge.ts:21-40`（边的构造与依据话术）
  - **入参 → 出参**: 点击「加事件」→ 视口中心落 1 个 `{来源:{kind:"手写"}, 时间, 名称兜底}` 节点、**一个** `加节点` 批次（不切模式、不加文字块）；右键「加事件」→ 落右键点，同一个动作；建角色边 → 实线 1px + 箭头 + 角色标签 + 性质 `推断` + 依据 `手写事件「<摘要>」的<角色>`（库事件用 `库事件 <event_id> 的<角色>`）
  - **先红的用例**: `editor.test.tsx` 加「工具栏加事件 ⇒ 落点 = 视口中心、写盘 1 批」「右键加事件 ⇒ 落点 = 右键点」「两条入口产出同形节点」；`edge.test.ts` 加「依据话术两种前缀逐字匹配」
  - **验收**: 前端目录 0 fail；变异：把工具栏入口改成落原点 `(0,0)` ⇒ 第一条红
  - **延后（不在本任务）**: 「从库加入 → 事件」第三页签与「事件→事件」边（spec 澄清 2 已裁降级）

---

## Phase 6: User Story 4 - 让界面像产品，而不是开发者工具（P2）

**Goal**: 三行结构（顶栏/工具栏/画布条）；图例离开画布；检查器 320px 贴边、四段、可收起；工具栏四组图标单行；品牌金选中态真的有色。

**Independent Test**: 固定窗口下量矩形与色值，逐条比对；窄画布下图例折叠为按钮；`I`/`Esc` 行为符合判据。

- [ ] T013 [US4] 三行布局：新增画布条、撤掉画布内模式条、图例搬出画布
  - **位置**: `hgraph/editor.tsx:2199-2299`（stage）、`editor.tsx:1953-1958`（现有搜索/筛选/计数所在处，迁入画布条）、`canvas.tsx:1038-1070`（模式条，删除）、`canvas.tsx:1409-1413`（图例挂载，迁出）、`hgraph/legend.tsx:41/113-124`（折叠态）
  - **入参 → 出参**: 编辑器打开 → `[data-slot="hgraph-editor-bar"]`(34px) / `[data-slot="hgraph-toolbar"]`(单行) / `[data-slot="hgraph-canvas-bar"]`(约 30px，含搜索 + 筛选 + 节点·边·文字计数 + 图例)；`[data-slot="hgraph-canvas-mode-bar"]` **不存在**；`[data-slot="hgraph-legend"]` 不在 `hgraph-canvas` 内；画布条宽 <900 ⇒ 图例折叠为按钮浮层
  - **先红的用例**: `editor.test.tsx` 加「画布条存在且四个包围盒都在其中」「`hgraph-canvas-mode-bar` 查询为 null（用布尔比较，`#013-12`）」「图例的祖先里没有 `hgraph-canvas`」
  - **验收**: 前端目录 0 fail；变异：把图例挂回画布 ⇒ 第三条红
  - **约束**: 导出侧图例渲染（`export.ts:447-468`）不动，导出仍含图例

- [ ] T014 [US4] 检查器：320 贴边、四段骨架、收起窄条，并收口档位数值
  - **位置**: `hgraph/inspector.tsx:448-453`（容器，宽度已接常量）、`:105-115`（头段文案）、`:528-610`/`:672-730`（可改区/只读区）、`:837-982`（连接段）、操作脚、`:214-221`（外环档，只判 finite）、`:224-228`（外环颜色自由文本）、`:340-357`（线宽档样板，复用）
  - **入参 → 出参**: 选中态 → 宽 320 / 右缘与上缘 0 / 高 100%，四段齐全（头 / 可改 / 只读灰底 + 🔒 + 出处 chip / 操作脚）；收起 ⇒ 40px 竖条「详情」+ 类型色点；未选中 ⇒ 不渲染；`I` 展开、`Esc` 先取消选中再收起；外环档 `12` ⇒ 就地提示「要填 0–4 的整数」且**不写文件**；外环颜色 ⇒ 只能从 7 预设 + 「自动」选
  - **先红的用例**: `inspector.test.tsx` 加「四段 `data-slot` 齐」「收起态宽 40」「未选中不渲染」「外环档 12 ⇒ 提示且 `改字段` 未调用」「外环颜色是 `<select>` 且有 8 个选项」
  - **验收**: 前端目录 0 fail；变异：把外环档校验换成 `Number.isFinite` 单判（现状）⇒ 越界那条红
  - **约束**: 校验/提示文案与线宽档同一实现点（`#002-06`）；色表复用 `canvas.tsx:523-531`，不另建

- [ ] T015 [US4] 工具栏四组图标（含往 v2 图标表追加 13 个图形）+ 模式按下态 + 危险色 + 悬停说明
  - **位置**: `packages/ui/src/v2/components/icon.tsx`（`icons` 表，追加键；`name` 类型已是 `keyof | (string & {})`，不用改类型）、`hgraph/toolbar.tsx`（全文件，现在只有纯文字按钮）
  - **入参 → 出参**: 点击/悬停事件 → 四组（选择/画/排/找+整）单行不出现横向滚动；模式按钮有按下态（品牌金边框 + 浅金底）、动作按钮无；删除用危险色；悬停 300ms 出带快捷键的说明
  - **先红的用例**: `toolbar.test.tsx` 加「四组 `data-slot="hgraph-toolbar-group"` 齐」「模式按钮 `aria-pressed` 随点击变、动作按钮恒 false」「删除按钮 class 含危险色 token」「`scrollWidth <= clientWidth`（happy-dom 量不出真宽 ⇒ 该条用布尔比较 + 真栈补量）」
  - **验收**: 前端目录 0 fail；`bun run typecheck` 0；变异：把模式按钮的 `aria-pressed` 固定 `false` ⇒ 第二条红
  - **约束**: 图标来自 v2 表；新键带注释「openhive 定制 · 【同步上游时保留】」，与 2026-10-29 加 `star` 同例；**不**用 `graph-icons.tsx`

---

## Phase 7: User Story 5 - 排布、筛选、数值与首用引导（P3）

**Goal**: 排列下拉把既有四算法接上；强度过滤能隐藏弱边并明示条数、可恢复。

**Independent Test**: 逐个模式核对落点与目标位置一致；设 N=3 核对隐藏条数与恢复。

- [ ] T016 [US5] 「排列」下拉把模式原样传给既有 `自动布局`
  - **位置**: `hgraph/toolbar.tsx:146-156`（现在 `自动布局()` 不传参）、复用 `editor.tsx:1631-1634`（`自动布局(模式)` 已收参）、`:1376-1377`（执行侧已用 `布局模式()`）、`graph-layout.ts:81/83`（`排列模式们`）
  - **入参 → 出参**: 下拉值 `排列模式` → `动作表.自动布局(模式)` ⇒ 落点 = `自动位置(图, 尺寸, 模式)` 的结果；每次弹确认条；锁定节点不动；默认环形
  - **先红的用例**: `toolbar.test.tsx` 加「选『分层』后点自动布局 ⇒ 动作表收到的模式是 `分层`」；`editor.test.tsx` 加「四模式各跑一次 ⇒ 坐标等于 `布局目标` 的返回值、锁定节点坐标不变」
  - **验收**: 前端目录 0 fail；变异：下拉不传参（退回现状）⇒ 第一条红（收到 `undefined`）
  - **约束**: 不另写算法，不复制 `自动位置`

- [ ] T017 [US5] 强度过滤「只看 ≥ N 档」+ 角落提示 + 一键恢复
  - **位置**: `hgraph/canvas.tsx:501-506`（`可见节点们`/`可见边们` 已是过滤点）、`:1091`（边渲染）、既有筛选浮层、角落 overlay
  - **入参 → 出参**: `N ∈ {关闭,0..4}` → 渲染集合 = `演示可见 ∩ (边档 >= N)`；角落提示「已隐藏 N 条较弱关系」（N 用实际条数）；一键恢复 ⇒ 回到不隐藏；图例保持纯说明
  - **先红的用例**: `canvas.test.tsx` 加「N=3 时 1–2 档边不渲染、3–4 档仍渲染」「提示条数 = 实际隐藏数」「恢复后边全部回来」「图例里没有可点击控件」
  - **验收**: 前端目录 0 fail；变异：把过滤条件写成 `> N` ⇒ 边界档（正好 N）那条红
  - **约束**: 档位换算复用 `geometry.ts` 的 `线宽档`/`外环档`，不自算

---

## Phase 8: Polish & 跨故事收尾

- [ ] T018 全量门禁 + 变异记录 + 真栈主流程 5 步
  - **位置**: 仓库根；`docs/superpowers/specs/014-hgraph-usability-completion/quickstart.md`
  - **入参 → 出参**: 本轮全部改动 → 三项门禁退出码 0 + 真栈 5 步逐条实测结果（成功/失败与现象）+ 缺口表更新
  - **要跑的命令**（都在仓库根起算）:
    1. `cd packages/app && timeout 420 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph`（基线 475 → 只增不减）
    2. `cd packages/app && timeout 420 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/graph.test.tsx`（基线 73）
    3. `cd packages/opencode && timeout 420 bun test test/server/case-hgraph-file.test.ts test/server/case-hgraph-edit.test.ts test/server/case-hgraph-ops.test.ts`
    4. `bun run typecheck`；`bun run lint`（改动面 0 error）
    5. 真栈：加手写事件 → 连参与方 → 存盘 → 重开 → 一次撤销（5/5，`spec` SC-018）
  - **变异记录**: 按 `LEARNINGS #003-03` 三类逐条写「拆哪一行 → 红哪几条 → 红成什么样」；本表每个任务的变异项都要有实测输出
  - **缺口表**: 真实触控板 `deltaY`、200% 缩放 LOD、窄屏 1280/1440 观感、A3 300DPI 出图、深色主题、现网 `case_event_participant.role` 是否按词表写入（`quickstart.md` §6）
  - **验收**: 五条命令全部贴实际输出；任一步失败 ⇒ 不宣称 MVP 完成

---

## 覆盖对照（FR → 任务）

| FR 段 | 任务 |
|---|---|
| FR-001..009（写路径） | T003、T004、T005 |
| FR-010..013（手感） | T006、T007 |
| FR-014（浮层统一） | T013（浮层层级）、T011（检查器收起） |
| FR-015（选中让位） | T008 |
| FR-016（排列四模式） | T016 |
| FR-017..027（事件） | T002、T009、T010、T011、T012 |
| FR-028（强度过滤） | T017 |
| FR-031..033（数值收口） | T014 |
| FR-034..036/048..050（检查器） | T014 |
| FR-043..047（布局/工具栏） | T013、T015 |
| FR-051/052/059（画布边界与 token） | T001（常量）、T015（图标/颜色类） |

**本轮不覆盖（spec 已裁延后）**：FR-025 的③（第三页签）、FR-026（整批加入）、FR-027 的事件→事件行、FR-039（行尾回滚）、FR-040/041（空图/演示引导）、FR-049（面板密度）、FR-053/054（选中态与 halo 精修）、FR-057（图例搬家后的窄宽精修）、FR-058（HUD）、FR-060（字号）。

---

## Dependencies & Execution Order

### 相位依赖

- **Phase 2（T001、T002）**: 无依赖，可并行；**阻塞**后面所有任务
- **Phase 3（US1）/ Phase 4（US2）/ Phase 5（US3）**: 都只依赖 Phase 2，彼此可并行
- **Phase 6（US4）**: 依赖 T001（常量已改），其余独立
- **Phase 7（US5）**: 依赖 T013（画布条里有筛选入口）
- **Phase 8（T018）**: 依赖全部

### 任务间真实依赖（同文件或同语义）

- T003 → T002（先有枚举值才谈事件节点的构造）
- T009 → T002（语义闸建在枚举之上）
- T010 → T002（渲染判据按 `kind`）
- T011 → T009（两态的只读判据依赖语义闸）
- T012 → T010、T011（入口要产出能正确渲染与编辑的节点）
- T006、T007、T008 都改 `canvas.tsx`/`editor.tsx` ⇒ **串行**
- T013 → T001（画布条里的让位口径）；T013 → T006（模式条删除与「手」模式共存，模式条删掉后「手」必须在工具栏）
- T015 → T001（危险色/品牌金 token 与选中态）
- T017 → T013（筛选浮层已迁到画布条）

### 并行机会

- **可并行**: T001 ∥ T002；T003 ∥ T004（服务端 vs 客户端文件不同）；T005 ∥ T006..T008（editor 根容器 vs canvas 交互，但都会动 `editor.tsx` ⇒ 实际建议串行）
- **不可并行**: T006/T007/T008（同文件同段交互）；T009..T012（同一事件链路）

---

## Implementation Strategy

### MVP 先做（按 spec 澄清 1 的裁定）

1. **Phase 2**: T001、T002（半天级，两个前提）
2. **Phase 3 + 4**: T003–T008（写路径与手感，US1+US2 都是 P1）
3. **Phase 5**: T009–T012（事件，手写优先）
4. **Phase 6 + 7**: T013–T017（界面与深度项）
5. **Phase 8**: T018（门禁 + 真栈，**这一步不做完就不算 MVP 完成**）

### 每个任务的完成定义（六步轨道，`openhive/CLAUDE.md`）

1. 复述现象/期望，用证据定根因（不猜）
2. 先写**会红的**用例（贴实得值）
3. 改到绿
4. 变异验证：拆掉修复 ⇒ 那条用例必须红（按 `#003-03` 三类记）
5. 门禁：受影响 package 的 typecheck + 测试 + 根 oxlint
6. grep 全部同类落点逐个打勾（`#002-06`）

---

## Notes

- `[P]` = 不同文件、无未完成依赖；同文件的两个任务一律串行
- **每个任务一次提交**，提交信息写清「这是要保留的定制」并附命中的 LEARNINGS 条目号（`#013-12` 布尔比较、`#002-06` 单一出处等）
- **不谎称改了**：报告只写实际跑过的命令与输出；跑不动的明说没跑
- 真栈不热重载，任何真栈验收前必须重启；启动必须带 `REAL_STACK_DB=remote`
