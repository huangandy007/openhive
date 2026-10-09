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
    跑（本文件今天喂的全是测试自己的夹具，`MANIFESTS` 的 `cards` 全空）。⇒ ✅ **已收（2026-10-07）**：见下方 T013 条。
  - 📤 **F6 / F7 收**：`context` 的**取值词表**归它们（US2 场景 1 举的「选中账户」是 F6 中栏的选中）；
    006 只钉「不能为空」。

## Phase 4: US3 抽屉 + 命令面板（P1）

- [x] T006 [FE·新增] 实现「更多 skill」抽屉（**只做「按 skill 分组」**）[FR-004] [T003] [出参：抽屉按 skill 分组]（2026-10-07 完成）
  - **2026-10-07 裁定 U8**：「最近使用」「收藏加权」本轮**不做** → 挂 009（见 `state.md` 缺口表）
  - **出参落地**：见 `state.md`「T006 出参」——`ai-session/skill-drawer.tsx`（**受控面板**：
    `open` / `groups` / `onClose`，**不带入口钮**）＋ 12 条用例；组顺序**保持输入顺序、不排序**
    （接 T003 那条挂账，至此闭合）。
  - 📤 **T013 收（`#002-04`）**：这 12 条已经在了，T013 **别再写一遍**——该做的是**换一份注入的清单**跑。
    ⇒ ✅ **已收（2026-10-07）**：见下方 T013 条。
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
    ⇒ ✅ **已收（2026-10-07）**：见下方 T013 条（本条只补「池子跟着模块换」一条纯函数断言；端到端那条
    `projection.all → skillCommands → 原生 `/` 弹层` 已由 `session-panel.test.tsx` 钉过，不重写）。

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
    ⚠️ **但本条的出参里有半句当时没兑现**：「可切换会话」——`onNewSession` / `onSelectSession` **生产侧
    都没传**（`ai-session-slot.tsx` 只传了 `data` / `directory` / `sessionID` / `projection` /
    `onSubmitPrompt`）⇒ 点会话列表不切、点「＋新会话」不建。出参见 T015。
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
- [x] T010 [INT] 实现 AI 执行并展示过程 [FR-007] [T009] [出参：AI 执行 + 过程展示]（2026-10-07 完成）

## Phase 6: US5 业务规则（P2）

- [x] T011 [INT] 实现 AI 不滥用确定性事（确定性查询/统计走 **工具 / 代码执行路径**）[FR-008] [T010] [出参：环境准则进系统提示词；业务查询工具的产源在 F6/F7]（2026-10-07 完成）
  - **📌 T011 更正块**（`plan.md` 的数据流图注与 `spec.md` 的 US5 场景 1 都指向这里）
    - **2026-10-07 裁定 U5**：「走 MCP」的措辞**作废**——本仓**没有 MCP server**（opencode 只是 MCP **客户端**），
      写「走 MCP」会得到一条**空的**断言（`#004-13` 的 (b) 类）。改为锚在**工具路径**上：确定性查询/统计
      由 harness 的工具（代码执行 / 查询工具）承担，不由 AI 自由生成。
    - **落点（2026-10-07 用户裁定）＝配置注入的指令文件**：规则正文 `.opencode/instructions/*.md`
      ＋ `.opencode/opencode.jsonc` 的 `instructions` 项（配置驱动、零上游源码改动，合宪法 §II）。
      接线自检：`packages/opencode/test/session/openhive-tool-path-instruction.test.ts`。
    - ⚠️ **出参**（`LEARNINGS #002-02`：测不了的别写成覆盖）：本条交付的是「**规则进了每次会话的系统
      提示词**」＋「这条接线是活的（有断言、变异会红）」，**不是**「AI 不会滥用确定性的事」——
      提示词是**软机制**（宪法 §四管的是**权限**，本条是行为准则，两者不冲突）；**硬**的那一半是
      「确定性工具确实存在、且调用受鉴权约束」，其产源在 **F6 / F7**（见下方 📤）。
  - 📤 **交出**（`LEARNINGS #002-04`：责任推出边界要落进**接收方**的表）：见下方「## 📤 交出」。
- [x] T012 [INT] 实现高风险动作（删除数据）强制人确认 [FR-009] [T010] [出参：删除类动作落到「问人」；业务清单/判定在 F6/F7]（2026-10-07 完成）
  - **2026-10-07 裁定 U5**：**复用工具层 `permission.ask`**（与 `tools.ts` 同形，`#004-07`：按**被调方的全部必填项**逐项核对，
    含 `ruleset`），对高风险工具加强制 ask；**「判定涉案」的判定逻辑不在本 feature** → 挂 **F6/F7**（AI 只提取/查证/预填，不替人下结论）。
  - **📌 T012 更正块**（落地形态与 U5 的措辞有两处差异，都按 2026-10-07 用户裁定，写在这里免得下一个人按 U5 原文去找）
    - ① **U5 原话是「对高风险**工具**加强制 ask」，落地的是「对高风险**命令模式**」**：闸门住在 `bash` 这一个
      权限名下，靠 `command` 的模式匹配（`rm *` / `git clean *` …），**不是**「新增一个高风险工具」。
      这样**零上游源码改动**（宪法 §I），代价是黑名单**按模式匹配 ⇒ 天生可绕过**（见 006 `state.md` 的缺口表）。
    - ② **落地层＝`.opencode/opencode.jsonc` 的 `permission` 键**（配置驱动，不是改 `agent/agent.ts` 的 defaults）。
      生效机制：`user = Permission.fromConfig(cfg.permission ?? {})` 排在规则集**最后**，
      而 `evaluate()` 用 **`findLast`** ⇒ 配置里的 `ask` 赢过默认的 `"*": "allow"`。
    - ③ **出参收窄**（`LEARNINGS #002-02`）：本条交付「**通用删除类命令落到 `ask`**」＋「这条链是活的
      （有断言、变异会红）」，**不是**「高风险动作被 100% 拦住」——三个削弱面（模式可绕过 / 上游 `always`
      语义 / 前端自动应答开关）如实进缺口表；**业务高风险动作清单 ＋「判定涉案」的判定逻辑**是 F6 / F7 的
      对象（📤-2）。
    - 见证：`packages/opencode/test/permission/openhive-highrisk-ask.test.ts`（6 条 / 27 expects）；
      部署侧下发挂 `docs/workspace/deploy-todo.md` 的 **D-16**。
      ✅ **2026-10-07 T014 已在它下游补上「判定之后那一跳」**（真挂起 ＋ 拒后不执行）——
      见下方 T014 条；⚠️ 但**仍止于「前端把 `Event.Asked` 渲染成弹窗」之前**。

## Phase 7: 测试验收（P1）

- [x] T013 [FE] 写测试：指令卡投影 + 上下文动态浮现 [SC-002] [T003][T005] [出参：测试通过]（2026-10-07 完成）
  - **出参落地**：见 `state.md`「T013 出参」——新建 `ai-session/capability-pipeline.test.tsx`（**6 条**），
    喂**第二份带卡的注入清单**走真 `projectCapabilities(清单, 模块)`，把 `.context` → 真 `ContextCards`、
    `.drawer` → 真 `SkillDrawer`、`.all` → 真 `skillCommands`。补的是 T005 / T006 / T007 各自**证不到**的
    那两条缝：`projection.context → ContextCards` 与 `projection.drawer → SkillDrawer`（此前两侧各喂手写
    夹具，这条链**一次都没被走完过**）。8 批变异（`state.md` 有表），每条用例都至少被一个变异点红。
  - **2026-10-07 两项裁定**：① 产物形态 = **新建集成测试文件**（不改 `common-cards` / `context-cards` /
    `skill-drawer` 三个既有测试文件）；② `ContextCards` **维持 T008 裁定不接线**（`session-panel.tsx` 不动，
    本条的断言**止于「投影 → 组件」这条边**）。
  - ⚠️ **夹具的通用清单刻意排在最后声明**：通用卡「排到模块卡前面」是 §4.7.1 定的、由渲染层排序落；
    若把通用清单声明在最前，声明序与渲染序**同向** ⇒ 那条断言会**空转**（`LEARNINGS #005-15`）。
  - 📤 **F6 / F7 收**：本文件喂的仍是**测试自己造的**清单；真正的 `contexts` 产源与 `MANIFESTS.cards`
    仍归它们（`state.md` 缺口表那两条不动）。
- [x] T014 [INT] 写测试：高风险动作强制人确认 [SC-003] [T012] [出参：测试通过]（2026-10-07 完成）
  - **出参落地**：见 `state.md`「T014 出参」——新建 `test/permission/openhive-highrisk-gate.test.ts`（**4 条 /
    16 expects**），接的是 T012 文件头自己写明**缺的那一跳**：T012 止步于 `evaluate()` 判定出 `ask`；
    本文件把生产里那个 `ctx.ask`（`session/tools.ts`：`merge(agent.permission, session.permission ?? [])`
    ＋ `orDie`，含 `ruleset` 那一项）原样接上**真 `Permission.Service` ＋ 真 `shell` 工具**，
    于是「判定之后那一跳」在测试里真跑：挂 pending ＋ publish `Asked` ＋ 阻塞在 `Deferred` → 测试扮演民警
    `reply(reject / once)` → 工具 die / 真执行。**不需要前端、不需要真模型。**
  - **明确不测的三条**（都已在别处占住，重写只会稀释证据，`#005-09`）：① 上游 `ask/reply` 机制
    （`next.test.ts` 一整组）；② 前端自动应答开关的默认值（`permission-auto-respond.test.ts:34`）；
    ③ T012 已如实挂账的两条天花板（模式可绕过 / 真弹窗要靠前端）——只引用，不重报。
  - **2026-10-07 两项裁定**：① 产物形态 = **新建 gate 测试文件**（`openhive-highrisk-ask.test.ts` **一字不动**，
    两层各有各的见证，与 T013 先例一致）；② 夹具规则来源 = **config 注入 ＋ pin shell**——用产品自己的
    `ConfigParse.jsonc` 从仓库 `.opencode/opencode.jsonc` 读出 `permission.bash` 那份清单
    （不自己编一份，`#002-06`），经 `it.instance` 的 `config` 注入；同时显式 pin `shell`。
  - ⚠️ **两个夹具坑（都实测过，写进文件头）**：① 命令里的路径必须**正斜杠**——`rm -rf C:\…\victim`
    退出码 **0** 却什么都没删（bash 吃反斜杠 ＋ `-f` 静默放过），正是 `#004-08`「没报错 ≠ 执行了」，
    也正是 ③ 组那条**对照**的用处；② **shell 不 pin 就会「看谁在跑」**——`Shell.acceptable` 无 config 时
    落 `win()[0]`，本机是 **powershell**，而 `rm -rf` 在 PowerShell 下参数不合法。
  - **4 批变异（全部实测）**：M1（配置 `rm *` → `allow`）⇒ ①②③ 红 / ④ 绿；M2（靶子路径改回反斜杠）
    ⇒ **恰红 ③**；M3（配置只剩 `"*": "ask"`）⇒ **恰红 ① ④**；M4 第一版**红错了地方**（红在收尾那句重复
    reply 的 `Permission.NotFoundError`，即变异**没证到**目标），重做（先 `reply once` 再等命令跑完才断言）
    ⇒ **恰红 ① 且红在目标断言**。⇒ 4 条用例每条都被至少一个变异点红，**无恒绿者**。两版都如实记进
    `state.md` 的变异账（`#003-03`）。
  - 📤 **F6 / F7 收**：本文件用的是**产品声明的通用删除类清单**；**业务高风险动作清单 ＋「判定涉案」的
    判定逻辑**仍归它们（📤-2，`tasks.md` 下方那一节不动）。

## Phase 8: US4 补 · 右栏会话管理（2026-10-07 裁定补开）

- [x] T015 [FE·新增] 补齐右栏**会话管理三件事**（新建 / 切换 / 删除）——把 T008 留下的两处接缝接上（`onNewSession` / `onSelectSession`）＋ 新增删除入口 [FR-010 / US4 场景 2] [T008][T010] [出参：右栏能新建 / 切换 / 删除会话]（2026-10-07 完成）
  - **为什么补开（`#005-09`：先读挂账，别把已挂的当新缺口）**：两笔账本来各自悬着——
    ① T008 的 `state.md` 缺口表原写「这两颗各要一套新的异步链（建会话 → 改路由 → 右栏跟着换），
    是**下一条**的活」，而 006 **没有下一条** ⇒ 那笔账**无接收方**；② spec 的 **US4 场景 2**
    「新建 / 切换 / **删除**会话」（`spec.md:79`）在 006 从未排期（`tasks.md` / `state.md` 里
    「删除会话」**零命中**）。2026-10-07 用户裁定：**两笔并成这一条**，补进 006。
  - **开工第一件事（铁律 #1：先答「这条 task 的出参，今天在仓库里打得到的吗」）**——三件事**都是接线级**，
    现成能力都在，缺的只是「右栏把它们接上」：① 新建 = SDK `api.session.create({ location: { directory } })`
    （形状见上游先例 `components/prompt-input/submit.ts:404`；`agent` / `model` 是否必填**在 RED 阶段实测**，
    不照抄上游那份「提交时顺带建会话」的参数）；② 切换 = **改路由**（右栏的 id 从 `location.pathname` 解，
    见 `right-pane-source.ts` 文件头——所以「切换」不是一个状态，是一次跳转）；③ 删除 =
    SDK `api.session.remove({ sessionID })`——**上游已有完整实现可抄**（`#004-12` 先抄同族）：
    `pages/session/timeline/message-timeline.tsx:818-834` 的「取相邻会话 → remove → 失败 toast」。
  - **产物预案**（照 T008 的先例：**可测的抽成模块，生产组装层只做薄接线**）：
    ① `ai-session/session-actions.ts`（**新文件**，异步链 ＋ 依赖注入 `navigate` / `api` / `directory`，
    与 `right-pane-source.ts` 同因同法——它今天能单测，正是因为依赖是注进来的）；② `session-panel.tsx`
    加删除入口（`onDeleteSession?` 接缝 ＋ 列表项上的钮）；③ `ai-session-slot.tsx` 接线（`useNavigate`
    ＋ 三个回调）——**薄接线、无测试**（该文件挂不起来，已如实记在缺口表；不许写成「已覆盖」）。
  - ✅ **开工前那项未定项已裁定（2026-10-07，runbook Step 2 ⑦）**：**删除会话要人确认**，形态＝
    **就地二次确认**（点删除钮 → 钮变成「确认删除？」→ 再点才真删）——FR-009 / SC-003 写「高风险动作
    （**删除数据**）必须人确认」，而定下来的闸门住在 `permission.bash`（**只管 shell 命令**，
    **管不到 `api.session.remove` 这条 HTTP 出口**）⇒ 这层**只能在前端做**，成本：一个就地确认态
    ＋ 它的用例（**不需要**弹层组件）。⇒ **本条无遗留未定项，可直接开工。**
  - **两条不许发明**：① 删除**当前**会话之后的落点、② 新建会话之后的落点——**先看上游怎么做的**
    （删除：`message-timeline.tsx:823` 取相邻会话；新建：建完跳过去），别自造一套。
  - **出参落地**：见 `state.md`「T015 出参」——**3 改 ＋ 2 新**，全在 `packages/app/src/ai-session/`：
    ① **新** `session-actions.ts`（`建会话` / `删会话` / `删除后去哪` / `会话路径` 四个导出，**94 行**）＋
    **新** `session-actions.test.ts`（**13 条**，**180 行**）；② `session-panel.tsx` 加 `onDeleteSession?` 接缝 ＋
    行内删除钮（**+60**）；③ `session-panel.test.tsx` 加「二次确认」一组（**5 条**，**+113/−1**）；
    ④ `ai-session-slot.tsx` 三根接线（**+62/−14**：`useNavigate`、`报错` 抽成一处、三个 handler）。
    ⚠️ 上面这串数字是 **T015 交付那一刻的快照**（`#004-05`：取证快照带时点）。**Step 5 的修复**
    又给这两份文件加了货：`session-actions.test.ts` **+3**（在途守卫）、`session-panel.test.tsx` **+6**
    （D1 一条 ＋ hover 五条）、`common-cards.test.tsx` **+2**（hover 面 A / B）⇒ 见
    `state.md`「Step 5 出参（一）」。**别拿这份快照去核当前的条数。**
    ⚠️ **同批还有第二笔修复（②-1），它不在这份快照的范围内**——用户裁定 **B：cookie 通道**，
    落点是 `packages/opencode/src/server/routes/instance/httpapi/middleware/project-location.ts`（fork 文件：
    新增 `PROJECT_COOKIE` 通道 ＋ 两处 `if (ambient) return`）、`packages/app/src/project/current-project.ts`
    （005 T005 建的接缝：`setCurrentProject` 成为 cookie 的唯一写入点）、**新文件**
    `packages/app/src/project/current-project.test.ts`（5 条）、`openhive-project-directory.test.ts`（**+6 条**）；
    `ai-session-slot.tsx` 只改了**注释**（那条「②-1 尚未修」的过时话）⇒ 见 `state.md`「Step 5 出参（二）」。
    **这一笔与 T015 的产物数字无关，别混算。**
    （行数取自 `git diff --numstat`，2026-10-07 实测。）
    ⇒ **两条不许发明都照做了**：删除后的落点 = `message-timeline.tsx:823` 的
    `.filter(!parentID && !archived)` ＋ `[i+1] ?? [i-1]`（**逐字**搬进 `删除后去哪`）；新建后 = 建完
    拿 id 跳过去（`submit.ts:404` 同款形状）；**一场都不剩 ⇒ `/new-session`** 照
    `pages/session/session-archive.ts:35-38` 的 `tabs.newDraft(...)`，**不留在原地**——URL 会继续指着
    一场已不存在的会话，而右栏那条解析链是拿它去问服务器的（`right-pane-source.ts`，无 catch）。
  - **二次确认按裁定做了**（就地，无弹层）：确认态按**会话 id** 键控（`待删`），**不是 `boolean`**
    ——`boolean` 会让「按钮显示的」与「它实际会删的」在切会话后错位（点过 A 的删除、切到 B、
    钮上那句「确认删除？」还在 ⇒ 一下点击删掉 B）。这是 `#004-02`「两个投影要有会红的相等断言」
    在前端的形态：**用同一个值同时决定显示与动作**。用例 ④ 专钉这条（`createSignal` 换 id ⇒ 当场回「删除」）。
  - **13 批变异（全部实测，表在 `state.md`）**：模块侧 7 批（M1 建会话丢 `location` / M2 删会话写死 id /
    M3 丢前一邻回落 / M4 丢 `parentID` 筛 / M5 丢 `archived` 筛 / M6 丢形状守卫 / M7 取错段）——
    **每批恰红 1 条**；面板侧 5 批 —— M2/M3/M4/M5 **每批恰红 1 条**，**M1（第一下就真删）是
    `#003-03` 第 ② 类「整组红」**：它拆掉的是整条二次确认机制，红了 5 条（该组全数）。
    对照两次均 13/13 与 32/32 全绿。
  - **门禁**：`tsgo -b`（app）**干净**；单文件 oxlint（**仓库根**跑，`#004-10`）改动文件 **0 命中**；
    `lint:openhive` **23 warnings ＝ T008 记录的基线**（未变，非本次引入）；`bun.lock` **未动**
    （`git diff --numstat -- bun.lock` 空）。
  - **两笔新挂账**（写进 `state.md` 缺口表，**不写成已覆盖**，`#002-02`）：① 删除钮的**视觉是本处自定的**
    ——`DESIGN.md` §4.7.5 只写了「新建 / 切换」，**没有**写删除、更没有写它长什么样；② **005 的
    「归档＝冻结」门在 `session.remove` 这条新出口上没有断言**——它是路径前缀中间件（`project-location.ts`
    的 `isArchived`），**结构上**覆盖 `DELETE /session/:sessionID`，但 005 的测试打的是
    `POST /api/session` 与 `GET /api/session/:id`（`#005-11` 的形状：横切机制在新出口上没人验）。
    另加一笔**自陈的残留**：`待删` 是**粘**的（切走再切回来，「确认删除？」还在），**故意不修**、
    **没有断言守着**——已在 `session-panel.tsx` 的 `待删` 注释里写明，免得注释比断言强（`#005-15`）。

## Step 5（三）· 第二轮对抗性验证（2026-10-08 · ✅ 已完成 · **不新增 task**）

`#003-02` / `#005-04` 的明文要求：把 Step 5 那两批修复**本身**再当靶子打一轮（换视角、查「全部同类落点」）。
五席只读审查打在 `e972d14f44..HEAD` 上 ⇒ **三席独立**命中同一处 Important：**②-1 的 cookie 通道刷新后
与信号分叉**；用户裁定 **B：启动清掉 cookie**。落点与变异账见 `state.md` 的「**Step 5 出参（三）**」——
本节留个指针，免得下一个人以为「Step 5 到此为止了」。

⚠️ **2026-10-09 更新（Task B）**：用户改判 **A：跟随当前项目**（启动**还原**而非清），取代上面的裁定 B。
详见 `state.md` 的「Step 5 出参（三）」那条替代说明。

⚠️ **它留了两笔给 T016 / 收尾**（都在 `state.md` 缺口表，**不写成已覆盖**）：① **多标签页**那条残余
（cookie 全浏览器共享，A/B/C 三种修法都修不到；裁定 A 取代 B 后语义已改，见缺口表该行）；② 「挂载即清」
仰赖一条**上游事实**（`NewAppLayout` 落在路由根里 ⇒ SPA 不重挂），**今天没有断言钉着**——别把本轮读成
「分叉已根除」。

## Phase 9: Step 5 补 · 右栏导出会话入口（2026-10-07 裁定补开）

- [x] T016 [FE·新增] 右栏加**导出会话**入口（复用上游 `utils/session-export.ts` 的三件套）[FR-010] [T015] [出参：右栏能把当前会话导出成 JSON 落盘]（✅ **2026-10-08 完成**；产物、变异账、门禁见 `state.md` 的「**T016 出参**」）
  - **为什么补开（`#005-09`：先读挂账，别把已挂的当新缺口）**：Step 5 的 **D2**。原裁定（U11 · 笔 3）
    是「FR-010 的『导出会话』**本仓没有这个能力** ⇒ 改 spec 正文」；2026-10-07 复核时**原裁定的前提
    被推翻**——能力在上游就在，缺的只是**右栏的入口**。用户裁定：**补进 006，新开一条 task**。
    （`spec.md` 的 FR-010 更正块已当天二次更正，`plan.md` 那行同步恢复。）
  - **开工第一件事（铁律 #1：先答「这条 task 的出参，今天在仓库里打得到的吗」）**：**打得到**——
    `packages/app/src/utils/session-export.ts` 的三个导出（`fetchSessionExport` /
    `sessionExportFilename` / `downloadSessionExport`）已存在、有单测（`session-export.test.ts`），
    且**上游已有三处生产调用点**可抄（`#004-12` 先抄同族，形状三处一致）：
    `components/session/session-context-tab.tsx:231` · `pages/session/timeline/message-timeline.tsx:796` ·
    `pages/session/use-session-commands.tsx:242`（三处都是 `fetchSessionExport({…})` →
    `sessionExportFilename(data.info)` → `downloadSessionExport(filename, data)`）。
  - **它要的东西右栏都有**：`fetchSessionExport` 要的是 `{ session: { get, messages } }`，
    而这**两样在右栏同一个 `ensureDirSdkContext(目录)` 上都取得到** ⇒ **不需要新开取数通道**
    （那是本条能做小的根据）。⚠️ **但落点不是那一个属性，见下面那条更正。**
  - ⚠️⚠️ **更正（2026-10-08，动第一行代码时被 `tsgo` 推翻的原始前提）**：本条**原先写的是**
    「`api.session.get` 与 `api.session.messages` 正是右栏 `会话出口`（`DirectorySDK["api"]["session"]`）
    上已有的两个方法」——**前半对、后半错**。`api.session.get` 有，**`api.session.messages` 没有**；
    写 `client: 出口.api.session` 当场红 `TS2739: Property 'messages' is missing in type
    'CompatibleSessionApi' but required in type 'SessionExportClient'`。
    真因：**新协议里没有 `session.messages` 这个出口**——消息在**另一个命名空间**
    （`packages/client/src/contract.ts` 的 `endpointNames["session.messages"] = "list"`；协议侧
    `packages/protocol/src/groups/message.ts` 的 `GET /api/session/:sessionID/message`），
    且新形状要过 `normalizeSessionMessages` 才是 `{ info, parts }`。
    ⇒ **传 `出口.client`**（`DirectorySDK` 的另一个属性，`createOpencodeClient` 出来的 **legacy**
    客户端）——**上游三处生产调用点传的从来都是 `sdk().client`**，不是 `api`（`#004-12`：
    先抄同族，别自己发明）。**一行适配都不用写。**
    ⚠️ 记这条的用意不是自责，是给下一个人一个判据：**「右栏有这个出口」是推断，
    「它的类型上真有两个方法」是事实，两者不能互相顶替**（`#005-11` 同族）。
  - ⚠️ **不许发明**（照 T015 的同一条纪律）：① **入口位置**——判据与「删除」同：它是**对当前会话**的
    动作 ⇒ 放会话行；② **失败回话**——走 `ai-session-slot.tsx` 那处唯一的 `报错`（`#002-06`：
    同一句话不写第二遍）；③ **下载的触发形态**（blob / 文件名）——照上游三处，不自己造。
  - ⚠️ **与 `session.share` 不是一回事**：share 是**发布到网上**（`"Publish on web"` /「复制链接」），
    公安数据场景的适用性**未裁定**（见 `spec.md` 的 FR-010 更正块）。别把两者混成一条需求。
  - ⚠️ **排期**：`plan.md` 没排这条（它是 Step 5 补开的）⇒ 落地时同步 `plan.md`，别让「15 条」
    与「tasks.md 里 16 条」在两个文件里各说各话。

---

## 📤 交出（T011 / T012 各一笔；接收方 = `007-fund-analysis` / `008-call-analysis`）

> **为什么要交出去**：FR-008 / FR-009 各有**一半**在 006 里做不出来——不是没排期，是**没有对象**
> （`LEARNINGS #002-02`：测不了的写成交出 / 缺口，不写成覆盖）。机制那一半落在 006，
> 另一半必须随 F6 / F7 的业务 skill 一起落地。**接收方表已记**（两份 `tasks.md` 的文件头 📥 块，
> `LEARNINGS #002-04`：责任推出边界必须落进**接收方**的表）。

### 📤-1 · 确定性查询 / 统计的**工具产源**（T011 · FR-008）→ 007 的 T006 / T014、008 的 T006 / T014

006 **交出**的：环境准则正文（`.opencode/instructions/openhive-tool-path.md`）＋ 它被解析进
`Instruction.system()` 的**接线**（有断言、变异会红）。
006 **交不出**的：一句提示词管不住「确定性的事」——让 FR-008 真正成立的是**确定性工具确实存在**
（查库 / 统计 / 比对），且**能被 agent 调用**。本仓今天的工具只有通用那几个
（`shell` / `grep` / `glob` / `read`），**没有任何业务查询路径**。

⇒ **接收方要做的**：业务 skill（007 / 008 的 **T014**）落地时，把「查询 / 统计」做成**可调用的工具**
（007 / 008 的 **T006**「数据查询」含统计聚合），而不是让模型自己算。

### 📤-2 · 「判定涉案」的判定逻辑（T012 · FR-009）→ 007 的 T014、008 的 T014

006 **交出**的：**闸门机制**（006 **T012**，✅ **2026-10-07 已完成**）——规则住在 `.opencode/opencode.jsonc`
的 `permission.bash`（**8 条通用删除类 pattern → `"ask"`**，与 `shell.ts` 扫出的 `always` 同形），
见证 `packages/opencode/test/permission/openhive-highrisk-ask.test.ts`。
⚠️ **它只管通用删除类命令**；本模块自己的高风险动作（删资金数据 / 批量标注 / 覆盖产物 …）
**要自己在同一份配置里加 pattern**——别以为闸门已经罩住了业务动作
（`LEARNINGS #005-11`：横切机制在**新出口**上没人验）。
006 **交不出**的：**哪些结论算「判定涉案」**——那是业务定性，藏在各模块的研判 skill 里。

⇒ **接收方要做的**：研判 skill（007 / 008 的 **T014**）里给出「判定涉案」的**判定逻辑与高风险动作
清单**，并接上 006 的闸门（**人确认**由 006 的机制强制，**判定**由接收方的 skill 提供）。

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003（依赖 T002）
- **Phase 3**：T004 ∥ T005（依赖 T003，可并行）
- **Phase 4**：T006 ∥ T007（依赖 T003，可并行）
- **Phase 5**：T008（依赖 T001）；T009（依赖 T003）→ T010（依赖 T009）
- **Phase 6**：T011 ∥ T012（依赖 T010，可并行）
- **Phase 7**：T013（依赖 T003+T005）∥ T014（依赖 T012）
- **Phase 8**（2026-10-07 裁定**补开**）：T015（依赖 T008+T010）
- **Phase 9**（2026-10-07 **Step 5 补开**）：T016（依赖 T015）

共 **16** 条任务（T001–T016），符合 12–18 条范围。⚠️ 其中 **T015 / T016 都是裁定补开的**
（各见该条「为什么补开」），**不在 `plan.md` 的原始排期里**——所以「16 条」不等于「plan 排了 16 条」。
（**16 条全部完成**：T015 于 2026-10-07、T016 于 2026-10-08。）
