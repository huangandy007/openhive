---

description: "Task list for 关系图产物（.hgraph）"
---

# Tasks: 关系图产物（`.hgraph`）

**Input**: `docs/superpowers/specs/012-relation-graph/`（plan.md、spec.md、data-model.md、research.md、contracts/、quickstart.md）

**Tests**: **必做**（spec「TDD Requirements」TR-001~TR-008：每条 FR 先有用例会红，红因必须是「缺该行为」）。

**Organization**: 按用户故事分阶段；每个任务都是「一个可独立验证的行为」，写清 `入参 → 出参`。

---

## 粒度约定（为什么是 19 个顶层任务）

- 每个任务 = **一个纯函数 / 一个端点 / 一个组件接缝**，自带用例文件，跑一条命令就知道过没过。
- 标 ⏱ 的任务写一版起来会超过 5 分钟（几何/组件/画布），**不拆更细**——再拆就变成「半截函数写不出来、测试挂不上」；这些任务内部按行内顺序 TDD（先纯函数红 → 再组件红 → 绿）。
- 19 个比理想上限 18 多 1：Phase 1 的两处抽取在 plan 里是**两个独立提交**（前端布局 / 后端出处解析），合并会让「行为等价重构」这件事失去单独的审查面。

---

## Phase 1: 复用前置（两处抽取，行为等价）

**Purpose**: 把「已经写在别处的同一件事」抽成一份，后面所有任务才有得复用（plan §3.1 / §3.3；`#002-06` 同一前提单一出处）。

- [ ] T001 [P] 抽出布局纯函数：`graph-layout.ts` 导出 `自动位置/布局/环半径/按经由分簇/簇/枢纽度数阈值`（入参=既有签名：`节点[]、边[]、模式`；出参=同名函数），`graph.tsx` 改为 import 并**保留同名 re-export**；文件 `packages/app/src/center/case-views/graph-layout.ts`、`graph.tsx`。**单独提交** `refactor: 抽出 graph-layout`。
- [ ] T002 [P] 抽出出处解析纯函数：`解析出处(串)` → `{材料,工作表,起,末} | null`、`压缩出处(材料,工作表,行号[])` → `string[]`（>50 行只留首末区间）；文件 `packages/opencode/src/server/openhive/citation.ts`，`case-mcp-tools.ts` 的 `get_citation` 改为调用它（行为不变）。**单独提交**。

**验证**

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/graph.test.tsx   # T001 前后同一文件、断言未改、全绿
cd D:/project/study/openhive/openhive/packages/opencode
timeout 300 bun test ./test/server/openhive-case-citation.test.ts                                                                   # T002：既有 get_citation 用例 + 新增 8 例
```

| 期望 | T002 新增用例钉什么 |
|---|---|
| 抽出**前** `graph.test.tsx` 全绿（基线） | 工作表名含 `#`（`m#A#B#12` ⇒ 表=`A#B`） |
| 抽出的 `citation.ts` 只有一份解析实现（`rg` 只剩 1 处正则） | 材料名不含 `#`、行号非整数 ⇒ `null` |
| `get_citation` 全部既有用例**原样全绿** | 区间 `12-40` 合法、`40-12` ⇒ `null` |
| | 51 行 ⇒ 压缩成 `m#t#1-51` |

---

## Phase 2: 地基（格式 + 唯一写入者，阻塞全部用户故事）

**Purpose**: `.hgraph` 的读写语义与单一写通道。任何页面、任何工具在这之前都不能动手。

- [ ] T003 解析与保真：`解析图(原文)` → `{ok:true, 文档, 原文树} | {ok:false, code, 说明}`，`code ∈ BAD_JSON/BAD_VERSION/NEWER_VERSION/BAD_SHAPE`；未知键进 `原文树` 原样保留；序列化只覆盖已知键。文件 `packages/opencode/src/server/openhive/hgraph-file.ts`，用例 `test/server/case-hgraph-file.test.ts`。
- [ ] T004 来源硬闸与出处规则：`校验来源(对象)` → `{ok:true} | {ok:false, code, 话术}`（`FACTS_NEED_SOURCE/INFERENCE_NEEDS_BASIS/INFERENCE_NEEDS_CONFIDENCE/BAD_CITATION`），**全仓唯一实现**；调 T002 的 `解析出处`。依赖 T002、T003。
- [ ] T005 操作代数与 id 分配：`应用操作(文档, 操作[])` → `{文档, 映射, 复用, 新增, 更新, 删除}`；`分配id(前缀, 现有)` → `n<max+1>`；删节点连带删边并计入同一数；合并节点重指端点、并集出处/备注、写 `来源.并入`；服务端放置（邻居外圈 → 质心 → 画布中心）。依赖 T003、T004。
- [ ] T006 唯一写入者与路径闸：`read / init / ops / export` 四端点 → 见 `contracts/hgraph-ops.md`；含内容哈希版本（sha256 前 16 字节）、per-path 串行、版本 CAS（409 + 最新版本）、先全量校验再 `temp+rename`（win32 重试 50/150/450ms）、幂等键 10 分钟、`projectDirectory(root, 属主, id)`、复用 `inside/inGit/realInside`；同时给 `file.ts` 加 `.hgraph` 拒绝（`HGRAPH_READONLY`）。文件 `hgraph-ops.ts`、`hgraph-lock.ts`、`file.ts`、`routes/instance/httpapi/server.ts`；用例 `test/server/case-hgraph-ops.test.ts`。⏱ 依赖 T003–T005。

**验证**

```bash
cd D:/project/study/openhive/openhive/packages/opencode
timeout 300 bun test ./test/server/case-hgraph-file.test.ts
timeout 300 bun test ./test/server/case-hgraph-ops.test.ts
```

| 任务 | 先红实得（各一条） | 绿后钉住 |
|---|---|---|
| T003 | `格式:2` 被当合法 ⇒ 实得 `ok:true` | `2` ⇒ `NEWER_VERSION` + 只读 |
| T004 | 事实边无出处写入成功 ⇒ 实得 0 拒绝 | `FACTS_NEED_SOURCE` + 原话 |
| T005 | 第二个节点 id 也叫 `n1` ⇒ 实得重复 | 全图 id 唯一、临时 id 有映射 |
| T006 | 过期版本写入成功 ⇒ 实得 200 | 409 + 文件哈希不变；幂等重放 `版本` 相同；`POST /file/write` 写 `.hgraph` ⇒ `HGRAPH_READONLY` |

**Checkpoint**：格式与写入者可信 —— 后续任何任务都只能经 `应用并写回` 改图。

---

## Phase 3: User Story 1 - 民警亲手把图画出来并落盘（P1，MVP）

**Goal**: 新建 → 空画布 → 加节点/拉线/写文字/摆位/对齐/布局 → 关掉重开还在。

**Independent Test**: 新建一张图，放 10 节点、5 边、1 文字，关闭再打开逐项核对。

- [ ] T007 [US1] 打开通道：`views/index.ts` 注册 `.hgraph`（`load: () => import("./hgraph-view")`）；`hgraph-api.ts` 导出 `读/初始化/写/导出许可` 四方法（入参见 `contracts/ui.md` §2，出参 `结果<T>`）；`file-create-types.ts` 数据驱动数组（此刻只有「关系图」）+ `file-create-dialog.tsx` 加类型胶囊（名字已带后缀不重复加）；`hgraph-view.tsx`：0 字节先 `init` 再渲染。依赖 T006。
- [ ] T008 [US1] 画布几何纯函数：`连线目标(落点, 节点集)` → `{从,到}|null`（`落点 = {从, x, y}`，返回终边必须知道起点）；`对齐(ids, 边, 节点)` → `{id,x,y}[]`；`等距(ids, 轴, 节点)` → 同上（**原计划漏了 `节点`：纯函数没有坐标来源就算不出位置**）；`框选命中(矩形, 节点, 已选)` → `id[]`；`适配视口(节点, 尺寸)` → `{缩放,x,y}`；`隐藏计数(总, 可见)` → `number`。文件 `hgraph/geometry.ts` + `geometry.test.ts`（可与 Phase 2 并行）。
- [ ] T009 [US1] 编辑器与画布：`editor.tsx` 持有文档/版本/保存状态机（500ms 防抖，**拖动只在 dragend 进待发**，失败停在「待发」并提示「没存上」）；`canvas.tsx` 指针/连线两模式、Shift 加减选、框选、缩放平移、锁定节点不被框选拖动；文字块增删改拖。入参 `{path, api}`，出参 = 渲染的 SVG + 动作回调。⏱ 依赖 T007、T008、T001。
- [ ] T010 [US1] 动作单一出口 + 检查器：`toolbar.tsx` / 右键菜单 / `inspector.tsx` 全部调同一张动作表（`contracts/ui.md` §3）；检查器三段（可改区失焦即存、只读区、库里现在）、批量态换成对齐/等距/删除/合并；双击内联重命名；`F2`。入参 `{选中, 文档, 动作表}`，出参 = 回调 + 面板。依赖 T009。

**验证**

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/geometry.test.ts
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/editor.test.tsx
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/project/file-create-dialog.test.tsx
```

| 期望 | 时机 |
|---|---|
| `拖一个节点` 用例：拖动中 `ops` 调用数 0，松手后 1 | T009 红→绿 |
| 保存失败 ⇒ 字段回改前值 + 「没存上」（断言文案，不断言 `ok:false`） | T009 |
| 连线模式拖到空白不成边；指针模式拖动永不建边 | T008 纯函数 + T009 组件 |
| 对齐 2 个节点以选中范围边界为准；等距 3 个两端不动 | T008 |
| 键盘只在画布聚焦时生效；焦点在输入框时 `Delete` 不删 | T010 |

**Checkpoint**：MVP 可用 —— 手画 → 关 → 开，位置与连线一致。

---

## Phase 4: User Story 2 - 图纸能讲给人听（P1）

**Goal**: 演示态 chrome 收起，按 `出现序` 步进，`Esc` 退出。

**Independent Test**: 给节点/边写不同 `出现序`，空格/`Backspace` 走一遍。

- [ ] T011 [US2] 演示与 `出现序`：`演示步进(文档, 步号)` → `{可见节点: Set, 可见边: Set}`（未写 `出现序` 视为第 0 步，同序按 id）；`present.tsx` 覆盖层（隐藏工具栏/检查器/网格/选中描边，空格/Backspace/Esc 挂容器）；`inspector.tsx` 加出现序数字框（失焦即存、清空=删键、算一步撤销）。入参 `{文档, 步号}`，出参见左。依赖 T009、T010。

**验证**

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/present.test.tsx
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/inspector.test.tsx
```

| 期望 | 时机 |
|---|---|
| `演示步进` 断言可见 id 的**具体集合**（不是「不报错」） | 纯函数先红 |
| Esc 后编辑态快捷键恢复；演示中 `Delete` 不删节点 | 组件 |
| 出现序清空 ⇒ 文件里该键消失（不是 0） | 组件 |

---

## Phase 5: User Story 3 - AI 把查到的画上去（P1）

**Goal**: 5 个受约束工具改图；硬闸、批量原子、幂等、可一步撤销。

**Independent Test**: 只用工具从空图加 ≥5 节点 ≥3 边，人工核对每条边出处与性质。

- [ ] T012 [US3] 5 个 MCP 工具：`graph_list / graph_read / graph_add / graph_update / graph_remove`，全部转调 T006 的 `应用并写回`；注册进 `TOOLS` + `工具名` + `分发表`，三个写工具加进 `写工具名`；图工具**跳过**七字段信封；路径省略规则（1 张用它并回写路径 / 0 张 `not_found` / ≥2 张 `ambiguous_path`）；`≤50`；同名同类型复用；返回 `映射/复用/放置`。文件 `case-hgraph-tools.ts`、`case-mcp-server.ts`；用例 `test/server/case-hgraph-tools.test.ts`。依赖 T006。
- [ ] T013 [US3] 页面接收 AI 改动：`editor.tsx` 10 秒轮询 `GET /openhive/hgraph/read` 比 `版本`（**不是** `file/stat`：它只回 size、测不出同尺寸改动，R26），变了且无待发 ⇒ 静默重载；有 ⇒ 询问「重新载入？」且只重载本标签页；`undo.ts` 按 `批次` 把多步合并成一步（`Ctrl+Z` 一次全还原）。入参 `{批次, 逆操作[]}`，出参 = 撤销栈一步。依赖 T009、T012。

**验证**

```bash
cd D:/project/study/openhive/openhive/packages/opencode && timeout 300 bun test ./test/server/case-hgraph-tools.test.ts
cd D:/project/study/openhive/openhive/packages/app && timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/editor.test.tsx
```

| 期望 | 时机 |
|---|---|
| 第 30 条不合格 ⇒ 文件哈希不变（断言「零条写入」） | T012 |
| 同幂等键第二次 ⇒ `重放:true`、节点数不变 | T012 |
| 推断改性质无依据 ⇒ 整批拒绝（不能从 update 绕过） | T012 |
| 非属主 `graph_add` ⇒ `forbidden`，且不给 `not_found` 探路 | T012 |
| AI 批量删 3 节点 ⇒ 一次 `Ctrl+Z` 剩 0 条边（断言具体条数） | T013 |

---

## Phase 6: User Story 4 - 从库里把人调上图纸（P1）

**Goal**: 搜索/关系两页加入，拍自包含快照；过期只加角标不改文件。

**Independent Test**: 加 2 实体核对属性/时间/出处；回库改名后重开看角标且文件未变。

- [ ] T014 [US4] 从库加入与快照：`entity-picker.tsx`（搜索 `EntityApi.list({q})`、类型列前端筛选、勾选 → `GET /case/entity` 取快照 → `加节点`；关系页 `GET /case/graph?id&跳数=1` + `GET /case/facts?type=relation` → `加边` 带 `证据`）；取不到属性/出处 ⇒ `属性: []` + 界面「库中无记录属性 / 未取到出处」；重开时比对快照（改名/合并/排除）只加角标；「刷新此节点」「绑定到库实体」「打开档案」（未绑库灰显 + 「这条不在库里」）。入参 `{projectId, onAdd}`，出参 `操作[]`。依赖 T007、T010。

**验证**

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/entity-picker.test.tsx
```

| 期望 | 时机 |
|---|---|
| 加入的节点 `属性/时间/出处` 三项**断言具体值** | 红→绿 |
| 库取不到 ⇒ 节点仍建、文案出现（不拦） | 红→绿 |
| 改名后重开：角标出现且 `ops` 调用数 0（文件未被改） | 红→绿 |

---

## Phase 7: User Story 5 - 把图导出成交付材料（P1）

- [ ] T015 [US5] 导出：`export.ts` 的 `导出PNG({文档, 画布, 选项, 项目名, 导出人})` → `{png: Blob, 附录?: Blob, 文件名}`（2 倍屏 / A3 300DPI 3508×4961、白底、无交互态、标题块可选、附录按 `出现序` 排序、同名追加 `-2`）；服务端 `export` 已校验成员并留痕，前端先取许可再出图；`file-tree.tsx` 右键加「导出 PNG」调**同一函数**。依赖 T006、T009。

**验证**

```bash
cd D:/project/study/openhive/openhive/packages/app && timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/export.test.ts
cd D:/project/study/openhive/openhive/packages/opencode && timeout 300 bun test ./test/server/case-hgraph-ops.test.ts   # export 许可 + 留痕
```

| 期望 | 时机 |
|---|---|
| 文件名 `<项目名>-<图名>-<YYYYMMDD-HHmm>.png`；同分钟第二次 ⇒ `-2` | 纯函数 |
| 附录排序断言节点 id 序列（出现序空值排最后） | 纯函数 |
| 非成员 ⇒ 403，未发下载 | 线路级 |
| 两个入口调同一函数（`rg` 只有一处下载实现） | 收尾 grep |

---

## Phase 8: User Story 6 - 画错能收回（P2）

- [ ] T016 [US6] 撤销/合并/复制粘贴：`undo.ts` 20 步栈（入参 `{逆操作, 副本?, 批次?}`，出参 = 可撤销的一步）；逆操作生成（加⇒删、删⇒带副本还原、移动⇒回原位、改字段⇒旧值）；外部重载清旧栈 + 提示，AI 整批折成栈里唯一一步（可 `Ctrl+Z`、撤销时才写盘；不可整体还原的部分只提示不入栈）；`合并节点`（保留者/端点重指/并集/`来源.并入`，整次一步）；复制粘贴（只带两端在选区内的边、名称加「副本」、`Ctrl+D` 与 `Alt+拖` 一致）。依赖 T009、T010。

**验证**

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/undo.test.ts
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/editor.test.tsx
```

| 期望 | 时机 |
|---|---|
| 撤销 21 步 ⇒ 剩 20 步可用（断言栈深） | 纯函数 |
| 合并后边端点指向保留者 id（断言具体 id） | 纯函数 |
| 重载后撤销栈为空且 `Ctrl+Z` 不发写请求 | 组件 |

---

## Phase 9: User Story 7 - 大图上找得到、看得清（P2）

- [ ] T017 [US7] 搜索/隔离/筛选/查找路径/标签分级：`查找路径(边, a, b)` → `{路径: id[], 跳数} | null`（BFS，本地）；`标签取舍(节点, 缩放, 选中, 悬停, 阈值)` → `id[]`（选中 > 悬停 > 外环高 > 度数高，>12 字符截断）；搜索 `Enter` 居中、`↑/↓` 跳转；隔离与筛选共用「已隐藏 N 个」；>800 默认关标签、>300/>1000 只提示不拦；拖动/缩放中隐藏标签、松手 200ms 恢复。依赖 T009。

**验证**

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/geometry.test.ts
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/editor.test.tsx
```

| 期望 | 时机 |
|---|---|
| BFS：不连通 ⇒ `null`；3 跳路径 ⇒ 断言途经 id 顺序 | 纯函数 |
| 缩放 55% 时只留外环 ≥3 档标签（断言 id 集合） | 纯函数 |
| 隐藏后文案含具体 N | 组件 |
| 帧率为**真栈实测项**，本机组件环境量不出 ⇒ 进缺口表 | 收尾 |

---

## Phase 10: User Story 8 - 关系强弱与方向不被画反（P2）

- [ ] T018 [US8] 视觉规格：`边偏移(k)` → `k×8px`；`线宽档(次数|金额, 阈值)` → `0..4`；`外环档(连接数, 阈值, 手动)` → `0..4`；事实实线/推断虚线；双向两条平行带箭头；图例常驻可折叠（四条说明）；类型形状 + 类型首字双通道；手动档覆盖自动档 + 「恢复自动」= 删键。依赖 T009。

**验证**

```bash
cd D:/project/study/openhive/openhive/packages/app
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/geometry.test.ts
timeout 300 bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts ./src/center/case-views/hgraph/canvas.test.tsx
```

| 期望 | 时机 |
|---|---|
| A→B 与 B→A ⇒ 两条边、偏移 0 与 8（断言数值） | 纯函数 |
| 手动 `线宽档:4` 覆盖按次数算出的档（断言 4） | 纯函数 |
| 深色**不验**（宪法 §八）；不进用例 | 说明 |

---

## Phase 11: Polish & 收尾

- [ ] T019 门禁与对账：仓库根 typecheck + lint、受影响包测试全绿；`quickstart.md` §1.8 六条 grep（唯一写路径 / 唯一出处解析 / 无全局 keydown）；`bun.lock` 无污染；按 quickstart §2 M1–M15 手工过一遍并记录；缺口表（帧率、导出耗时、A3 字体、预算 12 次、共享成员 route A、跨进程锁、手势、投屏、上游布局冲突）如实登记。依赖全部。

**验证**

```bash
cd D:/project/study/openhive/openhive/packages/opencode && timeout 300 bun run typecheck
cd D:/project/study/openhive/openhive/packages/app && timeout 300 bun run typecheck
cd D:/project/study/openhive/openhive && timeout 300 bun run lint
cd D:/project/study/openhive/openhive && git diff --stat bun.lock
rg -n "HGRAPH_READONLY" packages/opencode/src
rg -n "解析出处|校验来源" packages/opencode/src
rg -n "window.addEventListener\(.*keydown" packages/app/src/center/case-views/hgraph
```

期望：typecheck `EXIT=0`；oxlint 0 errors（warning 不新增）；`bun.lock` 无输出；守卫/解析各 1 处定义；全局 keydown 0 命中。

---

## Dependencies & Execution Order

```text
T001 ─┐
T002 ─┴─> T003 ─> T004 ─> T005 ─> T006 ─┬─> T007 ─> T009 ─┬─> T010 ─┬─> T011 (US2)
      T008 ─────────────────┘        │            ↑        │         ├─> T016 (US6)
                                      └─> T012 ────┘        │         ├─> T014 (US4)
                                                            │         └─> T017 (US7)
                                                            ├─> T013 (US3, 需 T012)
                                                            ├─> T015 (US5)
                                                            └─> T018 (US8)
T001..T018 ─> T019
```

- **必须串行**：T003→T004→T005→T006（同一份纯函数逐层加规则）；T007→T009→T010（打开→画布→动作）。
- **可并行**：T001 与 T002；T008 与 Phase 2 全程（不同文件）；T012（服务端）与 T007–T010（前端）；T014/T015/T017/T018 在 T009 绿后互不冲突。
- **不得并行**：任何两个改 `hgraph/editor.tsx` 的任务（T009/T011/T013/T016），按顺序做。

## Parallel Examples

```text
# 两处抽取同时开（不同 package、不同提交）
T001 graph-layout.ts 抽取          ｜ T002 citation.ts 抽取

# 地基稳了以后：服务端 AI 工具 与 前端打开通道 并行
T012 case-hgraph-tools.ts          ｜ T007 views/index.ts + hgraph-api.ts

# 画布绿了以后：三条 P1 支线
T014 从库加入 ｜ T015 导出 ｜ T018 视觉规格
```

## Implementation Strategy

1. **Phase 1 + Phase 2 先做完**（T001–T006）。没有唯一写入者，后面每个故事都会各写一份写盘代码——正是本 feature 要防的。
2. **MVP = Phase 3（US1）**：手画 + 关开一致。此处停下来按 quickstart §2 M1–M4 验收。
3. 之后按 US2 → US3 → US4 → US5 推进（都是 P1），每条完成即独立验收；P2（US6/US7/US8）随后。
4. 每个任务：先写用例看到红（记录实得值）→ 最小实现到绿 → 变异验证（拆掉实现必须红）→ 在仓库根跑受影响包的 typecheck + lint → 提交时把命中的 `LEARNINGS` 条目号写进提交信息。

## Notes

- `[P]` = 不同文件、无未完成依赖；`[USn]` 对应 spec 的用户故事编号。
- 用例命令一律带 `timeout 300`；退出码 `124` 停手报告，不重试。
- 前端用例必须带 `--conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts`。
- 本机验不了的（帧率、A3 字体、真手势、投屏）进 `quickstart.md` §3 缺口表，**不写成已覆盖**。
- 不新建 `tasks` 之外的文件；`implementation-report.md` 在实现期生成（红/绿实得、变异三类结论、缺口表）。
