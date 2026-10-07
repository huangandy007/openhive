# Tasks: AI 会话（右栏指令卡）

**Input**: `docs/superpowers/specs/006-ai-session/`

**Prerequisites**: spec.md（用户故事）、plan.md（结构 / 集成点）、F1 右栏骨架 + F4 权限已落地

**Tests**: 以「受影响 package 的 bun test」覆盖指令卡投影、上下文动态浮现、高风险人确认。

## 任务格式约定

- `[P]` = 可并行（不同文件、无依赖）
- `[USn]` = 所属用户故事
- `[FE]` = 前端 / `[INT]` = 前后端集成 / `[BE]` = 后端。本 feature 纯前端 + AI 执行集成，无 `[BE]`。
- `[FE]` 任务标注「换皮」或「新增」：**换皮** = 改 opencode 已有组件 token；**新增** = 新建 openhive 组件（指令卡/抽屉/命令面板/右栏会话）。⚠️ 2026-10-07 裁定 U1(c) 之后本 feature **已无「换皮」任务**——右栏会话改为**组合** `@opencode-ai/session-ui` 原语。token 映射见 plan.md「前端换皮区」。
- 每条含 `[FR-x 来源] [依赖任务] [出参验证方式]`

## Phase 1: Setup（定位 + 声明接口）

- [x] T001 [P] [FE·定位] 定位右栏会话槽位 + 会话管理入口 [FR-010] [无依赖] [出参：见 `state.md`「T001 出参」——右栏槽位 `ThreePane.right` **生产未接线**；`SessionSidePanel` 是 review-diff **不是**消息流；可复用原语在 `@opencode-ai/session-ui`]（2026-10-07 完成）
- [x] T002 [P] [FE·新增] 确定 skill 能力清单声明接口（各模块 skill 声明能力的契约）[FR-006] [无依赖] [出参：能力清单声明格式定义]（2026-10-07 完成）
  - **2026-10-07 裁定 U4(b)**：**旁路一份 openhive 清单**（`app/src/ai-session/capabilities.ts`），**零上游改动**；须配一条**会报警**的断言钉住「清单 ≡ 实际 `SKILL.md` 全集」（`#004-03`）；形状按 009 §11 资产元数据写，并标「**009 落地时须复核**」
  - **出参落地**：见 `state.md`「T002 出参」——四个类型（`CardLayer` / `InstructionCard` / `SkillCapability` / `CapabilityManifest`）＋ `MANIFESTS` 数据 ＋ 对账测试 3 条断言（各自做过变异验证）。**与 009 的契约已按 `#002-04` 落进 `009-ai-assets/tasks.md` 的 📥 块**

## Phase 2: Foundational（指令卡通用框架）

- [x] T003 [FE·新增] 实现指令卡机制通用框架（投影 skill 能力清单）[FR-001][FR-006] [T002] [出参：框架可投影能力清单]（2026-10-07 完成）
  - **出参落地**：见 `state.md`「T003 出参」——`app/src/ai-session/projection.ts` 的纯函数
    `projectCapabilities(清单集, 当前模块)` 投影出四层（`common` / `context` / `drawer` / `all`）
    ＋ 15 条用例（四层各做过隔离变异验证）。**无 JSX、无视觉值**——渲染是 T004 起的活

## Phase 3: US1 常用操作 + US2 上下文指令（P1）

- [x] T004 [FE·新增] 实现顶部「常用操作」指令卡（固定一行 + 溢出收「⋯」）[FR-002] [T003] [出参：常用操作渲染、溢出收⋯]（2026-10-07 完成）
  - ⚠️ U6 那道门（runbook `D0-5`）：T004 是本 feature 第一个有视觉值的任务，而参照物取样不到
    （`design-reference/figma-export/` 没有页面子目录、`front/RightAIChat` 不在本仓）⇒ 规格先由 006
    起草、交用户审，**审过才落码**（2026-10-07 裁定 U6）。→ **门已过**：规格定稿为
    `openhive-DESIGN.md §4.7`（并改了 §3.1 的右栏 Hero 输入圆角口径）。本条的可视规格一律以
    §4.7.0–§4.7.2 为准；§4.7.0 那张表就是为「哪个 token 有 Tailwind 孪生」写的。
  - **出参落地**：见 `state.md`「T004 出参」——`ai-session/instruction-cards.tsx`（**四层共用的视觉语法**：
    卡面 + 分组标题 + 溢出「⋯」）＋ `ai-session/common-cards.tsx`（本层：取 `common` 那一支 ＋ 标题）
    ＋ 13 条用例；`projection.ts` 补 `ProjectedCard.module`（＋1 条用例）。
  - **原先留的「顺序未裁定」已由 §4.7.1 裁定**：跨模块那支（`GENERIC_MODULE`）的卡排在模块卡**前面**
    ⇒ 顺序在**渲染层**（`instruction-cards.tsx` 的 `通用优先`），`projection.ts` 依旧只给集合与来源。
- [x] T005 [FE·新增] 实现「上下文指令」动态浮现（随中栏选中，无上下文消失）[FR-003] [T003] [出参：选中浮现、取消消失]（2026-10-07 完成）
  - **出参落地**：见 `state.md`「T005 出参」——`ai-session/context-cards.tsx`（本层：取 `context` 那一支
    ＋ 按 `contexts` 筛 ＋ 空集整段不渲染；**长相零代码**，全走 T004 的 `instruction-cards.tsx`）
    ＋ 12 条用例；`capabilities.ts` 补 `InstructionCard.context?: string`（可选字段 ＋ 运行时报警，
    **未**重塑类型）＋ `capabilities.test.ts` 两条报警断言。
  - 📤 **T013 收（`#002-04`）**：这 12 条已经在了，T013 **别再写一遍**——它该做的是**换一份注入的清单**
    跑（本文件今天喂的全是测试自己的夹具，`MANIFESTS` 的 `cards` 全空）。
  - 📤 **F6 / F7 收**：`context` 的**取值词表**归它们（US2 场景 1 举的「选中账户」是 F6 中栏的选中）；
    006 只钉「不能为空」。

## Phase 4: US3 抽屉 + 命令面板（P1）

- [x] T006 [FE·新增] 实现「更多 skill」抽屉（**只做「按 skill 分组」**）[FR-004] [T003] [出参：抽屉按 skill 分组]（2026-10-07 完成）
  - **2026-10-07 裁定 U8**：「最近使用」「收藏加权」本轮**不做** → 挂 009（见 `state.md` 缺口表）
  - **出参落地**：见 `state.md`「T006 出参」——`ai-session/skill-drawer.tsx`（**受控面板**：
    `open` / `groups` / `onClose`，**不带入口钮**）＋ 12 条用例；组顺序**保持输入顺序、不排序**
    （接 T003 那条挂账，至此闭合）。
  - 📤 **T013 收（`#002-04`）**：这 12 条已经在了，T013 **别再写一遍**——该做的是**换一份注入的清单**跑。
  - 📤 **T008 收（`#002-04`）**：**抽屉的入口 ▸ 按钮 ＋ 开合状态归它**（T006 是受控面板，那两个 prop
    就是给它留的接缝）。另：§4.7.3 **没写 header**，本条的 header 是**照原生右栏抽屉抄**的
    self-decision ⇒ T008 接进去时一并复核（`state.md` 缺口表有一条）。
- [x] T007 [FE·新增] 实现 `/` 命令面板（模糊匹配 **skill 全集**）[FR-005] [T003] [出参：输入 `/` 唤起 + 模糊匹配]（2026-10-07 完成）
  - **2026-10-07 裁定 U2**：**不做**前端授权过滤（宪法 §四，授权在执行层）
  - ⚠️ **2026-10-07 标签就地更正**：本条**不是**「新写一个浮层」——原生 `v2/prompt-input` 自带的弹层
    本来就挂在 `/` 上（`DESIGN.md §4.7.4` 的硬指令「**能换数据源就不新写**」，T007 开工第一件事核过）。
    `plan.md` 的三处旧述（`command-palette.tsx`、「新增」两处）已就地更正（`#002-06`）。
  - **出参落地**：见 `state.md`「T007 出参」——`ai-session/command-palette.ts` 的纯函数
    `skillCommands(清单) → PromptInputV2Suggestion[]` ＋ 11 条用例（4 条适配层 ＋ 7 条**真 controller
    ＋ 真状态机 ＋ 真 `fuzzysort`** 的端到端）；10 批变异（含 2 批反向注入上游）＋ 2 批报警验证。
    **`label` / `trigger` 取连接键、`title` 取显示名**（2026-10-07 用户裁定）。
  - 📤 **T008 收（`#002-04`）**：**把 `skillCommands(projectCapabilities(...).all)` 传进右栏 Hero 输入的
    controller 的 `commands`** —— 这是 `/` 命令面板在生产里唯一缺的那根线（本条零生产调用点）。
    ⚠️ 唤起走 **`onInput`** 那条链（`machine.ts` 的 `input.changed`），**不是** `onKeyDown`。
  - 📤 **T013 收（`#002-04`）**：这 11 条已经在了，T013 **别再写一遍**——该做的是**换一份注入的清单**跑。

## Phase 5: US4 右栏会话 + 点卡片执行（P1）

- [x] T008 [FE·新增] 新建「**最小可用右栏会话**」（`app/src/ai-session/session-panel.tsx`：`SessionTurn` 消息流 ＋ `v2/prompt-input` Hero 输入 ＋ 会话新建/切换），挂 `ThreePane` 的 `right` 槽 [FR-010] [T001] [出参：右栏可对话、可切换会话]（2026-10-07 完成）
  - **出参落地**：见 `state.md`「T008 出参」——`ai-session/session-panel.tsx`（自挂 `DataProvider` ＋
    消息流 ＋ 会话行 ＋ Hero 输入 ＋ 卡行 ＋ 抽屉入口）＋ `route-session.ts`（路由解 id）＋
    `right-pane-source.ts`（id → 目录 → 数据那条异步链）＋ `ai-session-slot.tsx`（生产组装，薄接线）
    ＋ `workspace-entry.tsx` 的 `right` 访问器 prop ＋ `layout-new.tsx` 的挂载；新增 **37 条**用例
    （`session-panel.test.tsx` 18 ＋ `right-pane-source.test.tsx` 9 ＋ `route-session.test.ts` 10）
    ＋ `workspace-entry.test.tsx` 补 3 条。实测：`ai-session` 全目录 **109 pass / 0 fail（9 文件）**
    （T007 时基线 72；T008 新增 3 个文件）＋ `workspace-entry.test.tsx` **95 pass / 0 fail**。
    ⚠️ 上面这些数是 **T008 当时的快照**（`#002-06`：会随编辑变的值别读成现状）——
    T009 又给 `session-panel.test.tsx` 加了 4 条（审查 R1 补的那第 4 条在内）、给
    `capabilities.test.ts` 加了 1 条（审查 R2 的哨兵）⇒ **`session-panel.test.tsx` 现 22**、
    `ai-session` 全目录现 **114**（2026-10-07 实测）。
  - **2026-10-07 用户裁定五条**（开工前，全按建议）：① `contexts` **本轮不接这一层**（中栏没有右栏读得到的
    选中态，喂恒空集＝这一层永远不显示 ⇒ 真正的产源是 F6/F7，已落缺口表）；② 会话新建/切换做成
    **右栏自带的会话行**；③ 「当前会话」**右栏自带**（从路由解 id，不走全局 context）；④ 「＋ 新会话」
    **本轮不调 SDK `session.create`，只留接缝**；⑤ 当前目录 **A′：解出会话 id，目录向会话要**。
  - ⚠️ **连带就地更正 `plan.md §②` 一句被证伪的前提**（原文写「`useSync()` / `useSDK()` 在
    `WorkspaceEntry` 那一层已可用」——`SDKProvider` 其实挂在**路由层**、`useSync()` 根本不是 context）。
  - **2026-10-07 裁定 U1(c)**：原条「复用 opencode 原生右栏会话」**作废**（T001 实测 `SessionSidePanel` 不是消息流）
  - 📥 **T004 / T005 / T006 / T007 各交来一笔（`#002-04`：推出去的责任要落进接收方的表）**：指令卡那一行
    （`InstructionCardRow` 的两个层）**接进右栏是本条**，接的时候有两个 prop **今天没有生产来源**：
    ① **`availableWidth`**（T004）——本行自己会量（`ResizeObserver`），但**没接进右栏就不会真的量到**
    ⇒ 生产里永远不溢出；② **`contexts`**（T005）——中栏**没有任何右栏读得到的「选中」状态**
    （`CenterTabState` 只有 `tabs` / `active` / `module`；`project/file-tree.tsx` 的选中行是组件内部状态）。
    ⚠️ ② 这条**不要在本条里悄悄发明**：喂一个恒空集等于「这一层永远不显示」，而真正的产源是
    **F6 资金 / F7 话单**的中栏选中 ⇒ 若本条开工时那个信号还不存在，**按未定项停下来问**
    （runbook Step 2 ⑦），别自行裁定。③ **「更多 skill」抽屉的入口 ▸ 按钮 ＋ 开合状态**（T006）——
    抽屉本身是受控面板（`skill-drawer.tsx` 的 `open` / `onClose`），**钮坐在哪由本条的 Hero 输入决定**
    （design-v2 §8.2 与 `2026-09-12-AI资产-design.md` 都画在输入框旁边）。④ **`/` 命令面板的接线**（T007）
    ——把 `skillCommands(projectCapabilities(...).all)` 传进 controller 的 `commands`。
    ⚠️ 唤起走 **`onInput`**（`machine.ts` 的 `input.changed`）而**不是** `onKeyDown`——状态机里 `keyDown`
    对 `/` 一支都没有，照 keydown 写会得到「按了没反应」。四条都已进 `state.md` 缺口表。
    ✅ **T008 已收（2026-10-07）**：① `availableWidth` —— **不传**，`InstructionCardRow` 自己挂
    `ResizeObserver`，挂进右栏即在量（有 1 条用例把「观察的是卡行自己」钉住）；② `contexts` ——
    **用户裁定本轮不接**（缺口留在表里，产源是 F6/F7）；③ 抽屉入口 ▸ ＋ 开合状态 —— 落在
    `session-panel.tsx` 的 `session-tools` 行（`drawer-entry` 钮 ＋ `抽屉开` 信号，2 条用例）；
    ④ `/` 命令面板接线 —— `命令集 = createMemo(() => skillCommands(props.projection.all))` 传进
    controller 的 `commands`（2 条用例 ＋ 1 条**对照**）。
- [x] T009 [FE·新增] 实现点指令卡 = 填入一句话 [FR-007] [T003] [出参：点卡片填入一句话]（2026-10-07 完成）
  - **出参落地**：见 `state.md`「T009 出参」——**2 处产品码 ＋ 2 处测试，没有新文件**：
    `session-panel.tsx` 把 `activePrompt={controller.value()}` 与
    `onPick={…dispatch({type:"input.changed"})…}` 接给 `<CommonCards>`；`session-panel.test.tsx`
    ＋4 条（另把 `打字` 助手提到模块级，留一份）。**审查两轮**：第一轮 2 条 Minor（R1 测试轴缺失 /
    R2 状态机旁支未挂账），两条都修 ⇒ 补 `capabilities.ts` 的文案约束注释 ＋
    `capabilities.test.ts` 1 条**报警哨兵**（R2）。**变异**：实现 4 批（3 恰红 ＋ 1 整组红，其中 M2
    如实标注「不能当第 3 条有牙的证据」，第 3 条的牙由 M3 单独证）＋ 审查补的 2 批（R1 追加式 ⇒ 恰红
    新用例；R2 三张畸形卡 ⇒ 恰红哨兵且三条正则各自显形）。
  - **第二轮**（`#003-02`：把「第一轮的修复」再当靶子）**报到修复自己头上**：**F1 = 我那条哨兵的
    第 ③ 支是假的**——照抄了上游的 `$`，而上游判的是 `value.slice(0, cursor ?? value.length)`，那个 `cursor` 是
    **用户点卡前留下的位置**（`interaction.ts` 把 `draft.state` 当 `persisted` 传）⇒ `查 @张三 记录`
    在光标 5 时上游**真会弹面板**而哨兵不命中 ＝ **漏报**。改法：③ 去掉 `$`、取**存在性**判定；
    **双向变异自证**（旧写法＋那张卡 ＝ 9 pass / 0 fail**瞎的**；新写法＝恰红 1 条）。另 F2（用例名
    改成逐字引用）已修；F3（新用例的绿依赖上游一次性 `localInput` 守卫）如实记进用例注释、不改。
    第三轮定点复核 F1 的修复 ⇒ **0 缺陷 ＋ 4 条 Nit**，全修：N1（引文漏了上游那半句
    `?? value.length`）、N2（「同一个 transition 里」把**产出 command** 说成了**执行**）、
    N3（旧变异批次缺「句中 `@`」这一类的样本）、**N4（自纠）**——我第二轮顺手写的「另一个方向会
    误报」**是错的**，旧写法是**真子集**、只可能漏报（细节见 `state.md`「T009 审查」第三轮）。
  - **三条定型**：① 填入走 `dispatch({type:"input.changed"})` ⇒ 状态机自己那条程序化改文的道
    （`machine.ts` 的 `draft.setText`，`/` 与 `@` 用的就是它），**不自己拼 part 形状**（`#002-06`）；
    ② `activePrompt` 取**输入框实时值**，不另立「点过哪张」的信号——§4.7.1 的判据本就是相等
    （⚠️ 那句「输入框一改就掉」是本实现的**已知代价**，已写成期望；设计侧若要改，红的就是那条用例）；
    ③ 填入是**替换**输入框的文字、不是追加（`store.ts` 的 `setText` 换掉整个 text part；另有
    `addText` ＝ 游标处插入，**未选**）——理由同 ② 是**相等**：追加的话「用户已打过字」时相等永不成立
    ⇒ 选中态成为死分支。⚠️ 代价：用户先打的那半句**没了**（无确认无撤销），已如实记进 `state.md`。
  - 📥 **T004 / T005 交来一笔（`#002-04`）**：`activePrompt` 那一半 ✅ **已收**（选中态在生产里
    **看得见**——前提是先有卡）。另半笔**仍在**：`ContextCards` 与 `CommonCards` **同形**，但那一层
    **今天没被 `session-panel.tsx` 渲染**（T008 裁定「本轮不接」）⇒ 它的同名 prop **不需要接线**
    （接了是死代码）。**接线随 `contexts` 的产源（F6 / F7）一起来**，照 `CommonCards` 那两行加。
  - ⚠️ **别把它读成「生产里能点卡了」**：`MANIFESTS` 的 `cards` 全为空 ⇒ **今天没卡可点**。
    测绿的是「右栏把两个接缝接上了」（喂一份**有卡**的投影）。产源同样是 **F6 / F7**。
- [ ] T010 [INT] 实现 AI 执行并展示过程 [FR-007] [T009] [出参：AI 执行 + 过程展示]

## Phase 6: US5 业务规则（P2）

- [ ] T011 [INT] 实现 AI 不滥用确定性事（确定性查询/统计走 **工具 / 代码执行路径**）[FR-008] [T010] [出参：确定性查询走工具路径]
  - **2026-10-07 裁定 U5**：「走 MCP」的措辞**作废**——本仓**没有 MCP server**（opencode 只是 MCP **客户端**），
    写「走 MCP」会得到一条**空的**断言（`#004-13` 的 (b) 类）。改为锚在**工具层选择**上：确定性查询/统计
    由 harness 的工具（代码执行 / 查询工具）承担，不由 AI 自由生成。
- [ ] T012 [INT] 实现高风险动作（删除数据）强制人确认 [FR-009] [T010] [出参：高风险动作强制确认]
  - **2026-10-07 裁定 U5**：**复用工具层 `permission.ask`**（与 `tools.ts` 同形，`#004-07`：按**被调方的全部必填项**逐项核对，
    含 `ruleset`），对高风险工具加强制 ask；**「判定涉案」的判定逻辑不在本 feature** → 挂 **F6/F7**（AI 只提取/查证/预填，不替人下结论）。

## Phase 7: 测试验收（P1）

- [ ] T013 [FE] 写测试：指令卡投影 + 上下文动态浮现 [SC-002] [T003][T005] [出参：测试通过]
- [ ] T014 [INT] 写测试：高风险动作强制人确认 [SC-003] [T012] [出参：测试通过]

---

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003（依赖 T002）
- **Phase 3**：T004 ∥ T005（依赖 T003，可并行）
- **Phase 4**：T006 ∥ T007（依赖 T003，可并行）
- **Phase 5**：T008（依赖 T001）；T009（依赖 T003）→ T010（依赖 T009）
- **Phase 6**：T011 ∥ T012（依赖 T010，可并行）
- **Phase 7**：T013（依赖 T003+T005）∥ T014（依赖 T012）

共 14 条任务（T001–T014），符合 12–18 条范围。
