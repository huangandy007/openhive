# 实施进度 · AI 会话（右栏指令卡）

## 当前任务

**T009 已完成**（点指令卡 ＝ 填入一句话：`session-panel.tsx` 把 `activePrompt` / `onPick` 接上
`CommonCards`）→ 出参见下「T009 出参」。
**下一个：T010**（AI 执行 ＋ 展示过程）——它是 `onSubmitPrompt` 的接收方（真正调 SDK `session.prompt`）
⇒ 「点卡 → 一句话进输入框 → 回车 → AI 真的跑」这条链**今天断在终点**（右栏把正文交出去了，没人接）。

⚠️ 视觉规格在 `DESIGN.md §4.7`：T008 用到 §4.7.5（Hero 输入）与 §4.7.1（卡行）；不要凭记忆挑 token。
§4.7.0 末尾那条 ⚠️（**别把那张对照表照抄进源码注释**）是 T004 实测踩出来的；T008 那条
「会话行视觉是 self-decision」已进缺口表。

⚠️ **T004 前面那道门**（2026-10-07 裁定 U6 / runbook D0-5）之所以存在：T004 是**第一个有视觉值的
任务**，而参照物取样不到（`docs/superpowers/specs/design-reference/figma-export/` 只有 logo 与一份
shadcn 模板 `tokens.css`，**没有页面子目录**；`front/RightAIChat` 不在本仓）⇒ 规格只能对齐
`packages/ui/src/v2` 与 `packages/session-ui/src/v2` 的原生组件 ＋ `theme.css` 的 token。
T003 之所以能先做，正因为它**一个视觉值都没有**（纯函数，无 JSX）。

**用户已裁定三件事（2026-10-07，全按建议）**：① Hero 输入圆角取 **A**（沿用原生 10px，§3.1 已改）；
② 右栏底面 `layer-01` / 卡面 8px / 卡宽 96px 照草案；③「通用」的卡排模块自己的卡**前面**。

## 已完成

- **T001**（2026-10-07）· 定位原生右栏会话 + 会话管理真实入口 → 出参见下「T001 出参」。
  连带把**被 T001 证伪的 plan/spec 旧述就地更正**（`#002-06`：改一处就 grep 全部同类）。
- **T001 补测**（同日）· 追加第 7 条：**右栏不在路由 `DataProvider` 的子树内**（它是 `WorkspaceEntry` 的
  **后代**，不是祖先）⇒ 右栏须自挂一份，且 `useSync()`/`useSDK()` 在外壳层已可用、故可行。
  ⚠️ 这条是**查实**得出的，不是推断（`#004-13`：判「做不了 / 做得成」都要先验）。
- **T002**（2026-10-07）· 确定 skill 能力清单声明接口 → 出参见下「T002 出参」。
  落地 U4(b) 旁路清单 ＋ U9 三处目录清单 ＋ U10 契约移交（`#002-04`）。
- **T003**（2026-10-07）· 指令卡机制通用框架（投影能力清单）→ 出参见下「T003 出参」。
  纯函数四层投影 ＋ 15 条用例（四层各做过隔离变异验证）。
- **T004**（2026-10-07）· 顶部「常用操作」指令卡（渲染 ＋ 溢出收「⋯」）→ 出参见下「T004 出参」。
  四层共用的**视觉语法**单独成家（`instruction-cards.tsx`）＋ 本层（`common-cards.tsx`）＋ 13 条用例；
  `projection.ts` 补 `ProjectedCard.module`（＋1 条用例）。**U6 那道门已过**（§4.7 定稿后才落码）。
- **T005**（2026-10-07）· 「上下文指令」动态浮现（随中栏选中浮现、无上下文整段消失）→ 出参见下
  「T005 出参」。本层（`context-cards.tsx`，**长相零代码**，全走 T004 的共享语法）＋ 12 条用例；
  `capabilities.ts` 补 `InstructionCard.context` ＋ `capabilities.test.ts` 两条**报警断言**
  （今天空转，靠变异自证有牙）。11 批注入 ＋ 2 批报警注入，逐条实测。
- **T006**（2026-10-07）· 「更多 skill」抽屉（**只做「按 skill 分组」**，裁定 U8）→ 出参见下「T006 出参」。
  受控面板 `skill-drawer.tsx` ＋ 12 条用例（21 批注入 ＋ 1 批反向 ＋ 2 批报警，逐条实测）。
  **入口 ▸ 归 T008**（本层不带钮）；组顺序**保持输入顺序、不排序**（接 T003 那条挂账，至此闭合）。
- **T007**（2026-10-07）· `/` 命令面板（输入 `/` 唤起 ＋ 模糊匹配 skill 全集）→ 出参见下「T007 出参」。
  §4.7.4 的「能换数据源就不新写」**成立** ⇒ 产物是**一个纯映射函数**（`command-palette.ts` 的
  `skillCommands`）＋ 11 条用例（其中 7 条**真 controller ＋ 真状态机 ＋ 真 `fuzzysort`** 的端到端）；
  10 批变异（8 批产品 ＋ 2 批**反向注入上游**）＋ 2 批报警，逐条实测。**接线归 T008**。
  连带**就地更正 `plan.md` 的三处旧述**（`#002-06`）。
- **T008**（2026-10-07）· 新建「最小可用右栏会话」并挂进 `ThreePane.right` → 出参见下「T008 出参」。
  `session-panel.tsx`（自挂 `DataProvider` ＋ 消息流 ＋ 会话行 ＋ 卡行 ＋ 抽屉入口 ＋ Hero 输入）
  ＋ `route-session.ts` ＋ `right-pane-source.ts` ＋ `ai-session-slot.tsx`；新增 37 条用例
  （另 `workspace-entry.test.tsx` 补 3 条）；**6 批变异 + 1 批工具链假红的排查**。
  连带**就地更正 `plan.md §②` 一句被证伪的前提**（`useSync()` / `useSDK()` 在外壳层并不可用），
  并在**自己刚写的代码里**抓到一个真缺陷（`.then` 里注册的 `onCleanup` 没有 owner ⇒ 引用计数只增不减）。
- **T009**（2026-10-07）· 点指令卡 ＝ 填入一句话（FR-007）→ 出参见下「T009 出参」。
  `session-panel.tsx` 把 `activePrompt` / `onPick` 两个接缝**接上**（T004 📥 那一笔的兑现）；
  测试 ＋5 条（`session-panel.test.tsx` ＋4，含审查 R1 补的「替换 / 追加」那条；`capabilities.test.ts`
  ＋1 条文案哨兵；另把 `打字` 助手提到模块级，留一份）。**实现 4 批 ＋ 审查 3 批变异，逐批实测**；
  **审查三轮**——第一轮 2 条 Minor 全修；**第二轮打到「我刚落的修复」里**（`#003-02`），
  抓到的 **F1 是我那条哨兵本身是假的**（照抄了上游的 `$`，而上游判的是切片 `value.slice(0, cursor ?? value.length)`，
  那个 cursor 是**用户点卡前留下的位置**）⇒ 修完做了**双向变异自证**（旧写法对那张卡 9 pass / 0 fail
  ＝瞎的，新写法恰红 1 条）；第三轮定点复核 F1 的修复 ⇒ **0 缺陷 ＋ 4 条 Nit**（N1–N3 是引文 / 措辞 /
  记账，**N4 是我从它的差集实测反推出来的自纠**）。细节见下「T009 审查」。
  ⚠️ 如实记一条：接线通了，**但生产里今天没卡可点**（`MANIFESTS` 的 `cards` 全为空）。
- **U6 起草件 → 定稿**（2026-10-07）· 起草 → 用户审 → **移入 `openhive-DESIGN.md` 作 §4.7**（并改
  `§3.1` 的圆角口径）→ 出参见下「U6 起草件出参」。**起草件本身已删**（宪法 §八：DESIGN.md 是视觉真理的
  单一来源；留副本＝两份真相会漂，`#003-05`），其「取数命令核对记录」整段**挪进**了本节（不丢证据、
  不留镜像）。
- **开工前裁定 U1–U10**（2026-10-07，用户逐条裁定）→ 见下「裁定表」。**Spec 未定项至此清零**。

---

## 裁定表（U1–U10 · 2026-10-07）

`docs/workspace/dev_tdd.006.md` 的 Step 0.5 明写「未定项开工前必须裁定，不许自行拍板」。本轮**两轮**裁定：

| 项 | 裁定 | 落地动作 |
|---|---|---|
| **U1** | **(c) 另定「最小可用右栏会话」** —— 不搬 `SessionSidePanel`、不搬 `MessageTimeline`，用 `@opencode-ai/session-ui` 原语 + SDK `session.*` 新写 | plan.md §「② 右栏会话的真实接入面」；spec.md US4 改写；T008 重定义为「新建 `session-panel.tsx`」 |
| **U2** | **(b) 前端不过滤，执行层拦** —— 指令卡展示 skill **全集**（`capability`/`sessionRuleset` 在前端零引用），授权按宪法 §四 下沉执行层 | plan.md 宪法自查 IV 行 + 集成点；spec.md SC-004 降级、US3/FR-004/FR-005 改写 |
| **U3** | **并入 U2** —— 新端点路线被否，故 `X-User-ID` 那条身份链**本次不动** | 「不在本次范围」，无代码动作 |
| **U4** | **(b) 旁路一份 openhive 清单**（`app/src/ai-session/capabilities.ts`），**零上游改动** | T002 出参；须配一条**会报警**的断言钉「清单 ≡ 实际 SKILL.md 全集」；形状按 009 §11 资产元数据写，并标「**009 落地时须复核**」 |
| **U5** | **改写两条 + 挂账**：T011 →「确定性查询走**工具/代码执行路径**」（**不写 MCP**）；T012 → 复用工具层 `permission.ask`，高风险工具加强制 ask；「判定涉案」的判定逻辑**挂 F6/F7** | T011 / T012 开工时按此改写；依赖落进 007 / 008 的 `tasks.md` |
| **U6** | **由我起草 DESIGN.md 的「AI 会话 · 四层指令卡」一节**（行级规格，值走 token），对齐 `packages/session-ui` 原生组件 + `theme.css`；**落码前交用户审** | 起草件放本 feature，审过再进 `openhive-DESIGN.md` |
| **U7** | **沿用 005 裁定，继续挂账** —— 本轮**不启用暗色**；`--v2-background-bg-accent-soft` 在 dark 无覆盖一事只记一笔 | 缺口表 + DESIGN.md 新节各记一次 |
| **U8** | **抽屉只做「按 skill 分组」**；「最近使用」若做只做本机权重并写明降级形态；**「收藏」挂 009** | 009 的 `tasks.md` 接收方表 + 本文件缺口表 |
| **U9** | **确认：`ai-session` 三处一起加** | `packages/app/src/openhive-module-dirs.test.ts` 的 `moduleDirs`、`packages/app/src/workspace/design-token-refs.test.ts` 的 `自有目录`、根 `package.json` 的 `lint:openhive` |
| **U10** | **按 `LEARNINGS #002-04` 默认** —— 契约产物写进 **009 的 `tasks.md` 接收方表** + 本文件记一笔 | 随 T002 落地 |

---

## U6 起草件出参 · `DESIGN.md §4.7`「AI 会话 · 四层指令卡」（2026-10-07 定稿）

**已定稿并落地**：移入 `docs/superpowers/specs/openhive-DESIGN.md` 作 **§4.7**（接 §4.6 之后、同其写法）。
**同一提交里按裁定改了 `§3.1` 那一行**——「右栏对话 Hero 输入」的圆角从「12~16px」改为
「**沿用原生外壳的 10px**」（原生 `prompt-input-v2` 是 `rounded-xl`；要 12~16px 只能靠 app 级 CSS
覆盖，代价是多一处会漂的联姻）。

**用户裁定（2026-10-07）**：三件事**全部按建议**——① 圆角取 **A**（沿用原生 10px，改 §3.1 口径）；
② 右栏底面 `layer-01` / 卡面 8px / 卡宽 96px **照草案**；③「通用」的卡排模块自己的卡**前面**。

**它定了什么**（行级，值全部走既有 token / 既有 Tailwind 刻度）：

| 小节 | 内容 |
|---|---|
| 四层总表 | `common` / `context` / `drawer` / `all` 各落在哪个文件、常驻与否 |
| 4.7.1 指令卡 | 白底 + `shadow-[var(--v2-elevation-raised)]` + `border-v2-border-border-muted`；`w-24`／`h-8`／`rounded-lg`；13px `text-v2-text-text-base` 单行截断；hover 走 overlay、选中走浅金 |
| 4.7.2 分组标题与溢出 | 11px muted；`⋯` 与 `size-6` 照抄 `center/tab-bar.tsx`；溢出菜单用原生 `MenuV2`；可见数走**纯函数**（同 `splitTabOverflow` 形态） |
| 4.7.3 抽屉 | **只盖右栏**的面板（`absolute inset-0`），不做全屏 scrim；**不用** corvu 那支 `ui/drawer.tsx` |
| 4.7.4 `/` 命令面板 | 照抄原生 `PromptPopover` 的逐字 class；⚠️ 若 T008 用原生 `v2/prompt-input`，T007 可能只是**换数据源**而非新写 |
| 4.7.5 Hero 输入 | 沿用原生 `prompt-input-v2` 外壳；⚠️ 与 `§3.1` 的圆角冲突**待裁定** |

**三条「先量再写」的实况**（都写进起草件，且都附了取数命令）：

1. **`--v2-elevation-*` 没有 Tailwind 孪生**（实测生成物里 `--color-v2-elevation-*` **0 条**）⇒
   阴影只能写任意值 `shadow-[var(--v2-elevation-raised)]`；写 `shadow-v2-elevation-floating`
   **一定会红**（`design-token-refs.test.ts` 的工具类正则要求孪生存在）。起草件里把这条反例
   **明写出来**当警示，因此**自检会命中它**（`#005-14` 的自命中，不是缺陷）。
2. **桥接类只有 51 条，不覆盖全部 token**：`--v2-background-bg-accent-soft`（选中态）、
   `--v2-elevation-*`、`--v2-avatar-*`、`--v2-brand-*` **都没有**孪生。起草件列了一张对照表，
   写码前先对表。⚠️ 子代理的口头报告里说「`--v2-state-*` 也没有孪生」是**错的**——实测 **12 条都有**。
   又一次「先量再信」（`#003-04` / `#004-13`）。
3. **skill 今天没有图标 / 分组 / 标签元数据**（`capabilities.ts` 文件头已记）⇒ 起草件定「**卡面不带图标**」。
   给卡面配图标就是**造数据**，不是审美取舍。

**自检记录（草案里的每个 token 名都真存在）**：用 `design-token-refs.test.ts` **自己那两条正则**跑全文，
得 **9 个工具类（8 个有孪生，唯一命中的是上面那条反例）＋ 4 个 `var(--v2-*)` 引用（全部在册）**。
⚠️ 这个自检**自己坏过四次**，逐条记下来（都是 `#005-14` ③「自检命令本身也要自检」的实例）：
① 花括号简写（`--v2-background-bg-{base,accent,layer-01..04}`）被当成 token 名 ⇒ 8 条虚警；
② 孪生名单用 `^--color-` 抽，而生成物那些行**有前导空白** ⇒ 名单为空、全判「无孪生」；
③ bash 变量名用了中文（`名=`）**不是合法标识符** ⇒ 赋值行被当命令执行、`$名` 展开为空 ⇒ 整条核对**静默空转**；
④ `grep` 传两个文件时 `-o` 会加 `文件名:` 前缀 ⇒ `comm` 拿裸名比，全不中；`[\s]` 在 bracket 里也没按 `\s` 解释。
**判据**：核对类脚本**必须带正负对照**（喂一个真名、喂一个假名，看它报不报）——这次正是正对照先红，
才把 ③④ 那两处空转挖出来的。**没有对照的自检，绿是假的。**

**第四节 7.0 每条的取数命令**（复核时在仓库根重跑；起草件已随定稿删去，这张表挪来此处）：

| 说法 | 取数命令 |
|---|---|
| 桥接类 51 条及其名单 | `grep -oP '^\s*--color-\Kv2-[a-z0-9-]+' packages/ui/src/styles/tailwind/colors.css \| sort -u` |
| `--color-v2-elevation-*` 为 0 | `grep -c 'color-v2-elevation' packages/ui/src/styles/tailwind/colors.css` |
| 正则只收 `v2-` 开头的捕获组 | `design-token-refs.test.ts` 的 `名` / `变量引用` / `工具类引用` |
| 右栏 360px / 240~2/3、tab 40px、选中态浅金 | `openhive-DESIGN.md` §4.1 / §3.2 / §1.3 |
| 原生 Hero 外壳 `rounded-xl`＋`min-h-[96px]`＋`elevation-raised` | `packages/session-ui/src/v2/components/prompt-input/index.tsx` 的 `<form data-component="prompt-input-v2">` |
| 原生 `/` 弹层逐字 class | `packages/app/src/components/prompt-input/slash-popover.tsx`、`.../v2/components/prompt-input/index.tsx` |
| `⋯`＝U+22EF、`size-6`、`rounded` | `packages/app/src/center/tab-bar.tsx` |
| `splitTabOverflow(条数, 可用宽, {…})` 宽度是参数 | `packages/app/src/center/tab-overflow.ts` |
| 原生浮层 10px / 应用级 dialog 16px（12px 覆盖） | `slash-popover.tsx` / `auth/change-password.tsx` / `components/dialog-command-palette-v2.css` |
| skill 无图标 / 标签元数据 | `packages/app/src/ai-session/capabilities.ts` 文件头 |

---

## T001 出参 · 右栏会话 / 会话管理真实入口（2026-10-07 实测）

| # | 事实 | 取数 |
|---|---|---|
| 1 | 右栏**槽位存在、生产未接线** | `three-pane.tsx` 有 `ThreePaneProps.right?`（不传则整栏含手柄不渲染）；**唯一生产调用点** `workspace-entry.tsx` 的 `<ThreePane` 只传 `left` 与 `children` ⇒ 右栏 360px 今天空着 |
| 2 | `SessionSidePanel` **不是会话** | `pages/session/session-side-panel.tsx` 的 props 是 `canReview` / `diffs` / `reviewPanel` / `fileBrowserState` ⇒ **review-diff ＋ 文件树**；仅被原生会话页 `pages/session.tsx` 使用 |
| 3 | 原生消息流**搬不进右栏** | `pages/session/timeline/message-timeline.tsx` 的 `MessageTimeline` 有 **20 个 props**，过半是滚动机制（`scroll` / `setScrollRef` / `onAutoScrollHandleScroll` / `hasScrollGesture` / `onHistoryScroll` / `shouldAnchorBottom`…），且内部直接用 `useSessionKey()` / `useSync()` / `useSDK()` 等**页面级** context |
| 4 | 可复用的**原语**在 `@opencode-ai/session-ui` | `session-turn`（`SessionTurn({ sessionID, messageID, messages?, actions?, … })`）、`message-part`、`markdown`、`v2/prompt-input`；数据/上下文：`@opencode-ai/session-ui/context` 的 `DataProvider` / `useData` |
| 5 | 会话数据与管理的**出口**是 SDK | `client.session.list / create / messages / update`（既有调用点：`context/directory-sync.ts`、`context/server-session.ts`、`components/prompt-input/submit.ts`） |
| 6 | 原生**空态**另有组件 | `components/session/session-new-view.tsx`、`pages/new-session/new-session-view.tsx` |
| 7 | ⚠️ **右栏不在路由 `DataProvider` 的子树内** | `pages/directory-layout.tsx` 的 `<DataProvider>` 挂在**路由组件**里（渲染进**中栏**的 `{props.children}`）；`WorkspaceEntry` 在**外壳** `pages/layout-new.tsx`（由 `app.tsx` 的 `NewAppLayout` 渲染）⇒ `ThreePane` 的 `right` 槽与之**平级**。而 `SessionTurn` / `MessagePart` 都 `useData()` ⇒ **直接放会抛错** |

**结论**：右栏落地 **最小可用会话** = 消息流（`SessionTurn` 逐个渲染）＋ Hero 输入（`v2/prompt-input`）
＋ 会话新建/切换。**不引入** `MessageTimeline`，**不改** `SessionSidePanel`。
**T008 的「复用原生」措辞据此作废**——它是「**组合原生原语**」，不是「套既有组件」。

**必要接线（T001 补测）**：右栏须**自挂一份 `DataProvider`**。可行——`useSync()` / `useSDK()` 由 `app.tsx`
的 `SelectedServerProviders` 提供、**在 `WorkspaceEntry` 那层已可用**（它们在 `NewLayout` 之上），
故右栏可直接 `<DataProvider data={sync().data} directory={…}>`；`enterprise` 分享页与 storybook 有独立挂载先例。
⇒ **T008 的 RED 用例第一条就是它**：不挂时右栏必须红（否则说明「原生 set 里已有」的错觉没被证伪）。

---

## T002 出参 · skill 能力清单声明接口（2026-10-07）

**产物**：`packages/app/src/ai-session/capabilities.ts`（格式 ＋ 今天的清单）
＋ `capabilities.test.ts`（对账 ＋ 形状约束，5 条用例）。

| # | 定型的事 | 取数 / 依据 |
|---|---|---|
| 1 | **走旁路清单，不动上游**（U4(b)） | 实测：两套 skill `Info` 都只有 `name` / `description`(＋`slash`)，无分组 / 分类 / 标签 / 能力字段；扩 frontmatter 要动上游三处（`packages/schema/src/skill.ts` ＋ `packages/core/src/skill.ts` ＋ `packages/opencode/src/skill/index.ts`）⇒ 顶在第一号约束上 |
| 2 | **四个类型**：`CardLayer`("common" / "context")、`InstructionCard`(label / prompt / layer)、`SkillCapability`(skill / name / description / group / cards)、`CapabilityManifest`(module / capabilities) | 009 spec **FR-001** 的元数据清单取前端拿得到的子集；`§8.2` 那张四层表定 `CardLayer` |
| 3 | **`skill` 是连接键**，必须等于文件系统里那个 skill 的名（上游 `Info.name`） | 上游 `SkillV2.load`：先取 frontmatter `name`，没有才回退「**根层** `.md` 的文件名」，子目录里没 `name` 的**跳过** |
| 4 | **扫描口径逐字镜像上游**：目录源 = `<configDir>/skill` 与 `<configDir>/skills`（`packages/core/src/config/plugin/skill.ts`）⇒ 本仓扫 `.opencode/skills`；文件集 = 上游 glob 的「根层 `*.md`」＋「任意深度 `SKILL.md`」 | 不是「文件夹里的 `SKILL.md`」那种差不多写法（`#003-05`：镜像要写成会被上游变更惊醒的样子） |
| 5 | **对账断言 3 条，方向分开写**（`#005-12`） | ① 元断言「扫到了 > 0 条」（防空转）② 无孤儿 ③ 无悬空。**合成一条时一个方向先红，另一方向的证据就看不见了** |
| 6 | **今天 `cards` 全为空**——不是漏写 | 006 只造机制；卡片文案是**内容、随模块**（`§8.2`：框架「不重画一遍」）。今天本仓只有两个 opencode **开发工具链**的 skill（`effect` / `rtl-aware-development`），对民警没有指令卡语义，替它们编文案就是造数据 |

**变异验证（每条断言各自隔离注入，`#005-04` / `#005-15`）**：

| 注入 | 期望 | 实得 |
|---|---|---|
| **M1** 在 `.opencode/skills/` 丢一个 `zz-probe-tmp/SKILL.md`（真 skill，清单没声明） | 恰红「无孤儿」，另一方向绿 | **1 fail**，红的正是「无孤儿」并点名 `zz-probe-tmp` ✅ |
| **M2** 往 `MANIFESTS` 塞一条 `zz-ghost-tmp`（清单声明了不存在的 skill） | 恰红「无悬空」，另一方向绿 | **1 fail**，红的正是「无悬空」并点名 `zz-ghost-tmp` ✅ |
| **M3** 把扫描根改到 `.opencode/themes`（存在但无 `.md`） | 元断言必红（否则它是摆设） | **2 fail**：元断言 ＋ 无悬空 ✅（顺带证了「扫空了」这件事有两双眼睛盯着） |

> ⚠️ M3 的实得是 **2 fail 而不是 1**：扫描为空时，「无悬空」也会红（所有声明都悬空）。这是对的
> ——记下来是因为**它说明元断言不是唯一那道保险**，而不是「变异不精确」。

**U9 三处目录清单**（`ai-session` 一起加）：`packages/app/src/openhive-module-dirs.test.ts` 的
`moduleDirs`、`packages/app/src/workspace/design-token-refs.test.ts` 的 `自有目录`、
根 `package.json` 的 `lint:openhive`。**加之前先跑过一趟 `openhive-module-dirs`**：红在
`ai-session/ 缺失` ⇒ 这条清单确实有牙，不是摆设。

**U10 契约移交**：已按 `#002-04` 落进 `009-ai-assets/tasks.md` 的 📥 块（两笔：U10 契约形状 ＋
U8 的「收藏」因子下落）。**不写在只有 006 自己会读的地方。**

---

## T003 出参 · 指令卡机制通用框架（2026-10-07）

**产物**：`packages/app/src/ai-session/projection.ts`（纯函数投影层）
＋ `projection.test.ts`（15 条用例）；连带给 T002 的 `capabilities.ts` 补了 `GENERIC_MODULE` 常量
（＋ `capabilities.test.ts` 一条跨清单重名的报警断言）。

FR-006 的判据是「**换模块，四层跟着换内容**」——happy-dom 量不出来（不跑布局、不解析 CSS），
所以框架的取模块那一步做成**形参**：`projectCapabilities(清单集, 当前模块)`。

| # | 定型的事 | 取数 / 依据 |
|---|---|---|
| 1 | **四层字段**：`common`（FR-002）/ `context`（FR-003）/ `drawer`（FR-004）/ `all`（FR-005） | design-v2 §8.2 那张四层表逐行对应；`InstructionCard.layer` 的两种取值分别进前两层 |
| 2 | **「当前模块」的真值来源已存在**，不是本 task 新造的 | `center/tab-store.ts` 的 `CenterTabState.module`（文档：「当前**停留**的模块（左栏所在的那个）」）；UI 取用口 `center/tab-context.tsx` 的 `CenterTabs.module: Accessor<string \| undefined>`；`workspace-entry.tsx` 已用它喂 `<Rail active>` |
| 3 | **`module` 可空**，未登记不抛错 | `CenterTabState.module?: string`，`CenterTabsProvider` 初值就是 `props.initialModule`（可为 `undefined`）⇒ 「未登记」「`undefined`」各一条用例 |
| 4 | **`module` 取 `string` 不取联合类型** | 先例 `center/module-color.ts` 的 `moduleColorVar(moduleId: string)`（带兜底）——F6/F7 加模块时不用改签名 |
| 5 | **通用清单跨模块常在**：命中条件是 `module === 当前模块 \|\| module === GENERIC_MODULE`（一个 filter 写全，天然不会同一份被算两次） | design-v2 §8.2「通用 skill（研判记录 / 类案对照）跨模块常在」 |
| 6 | **补 `GENERIC_MODULE` 常量**（T002 文件） | 框架**必须**知道哪个清单算跨模块那份；两处各写魔法串 `"通用"` 时改一处不报错、只静默「通用 skill 只在某一个模块里出现」（`#002-06`） |
| 7 | **`ProjectedCard` 比 `InstructionCard` 多一个 `skill`** | spec 的 Key Entities 把「**关联 skill**」列为指令卡属性；卡片在 `SkillCapability.cards` 里时这个关联是**结构性**的，拍平成一层列表就丢了 |
| 8 | **有意不去重**：`all` 是选中清单按序拍平的结果；同 skill 跨清单重复会**出现两次** | 静默替人在两份声明里挑一份比「让它重复」更坏；冲突该在**数据**那侧拦 ⇒ `capabilities.test.ts` 新增一条会报警的断言（已变异验证） |
| 9 | **有意不钉层的顺序** | 「`通用` 的卡排模块的卡前面还是后面」是**产品决定**、属渲染层（T004）；钉了就把一个未裁定的决定焊进测试。测试一律做**集合**比较 |
| 10 | **不 import 中栏 context、不引用 `MANIFESTS`** | 取数（见下）——框架只能通过形参拿模块，清单只能通过形参拿 |

**runbook 的判据取数**（「`grep` 出框架里所有取『当前模块』的地方，每个都要能跟着注入换」）：

```
$ grep -n "module" packages/app/src/ai-session/projection.ts | grep -v '^\s*[0-9]*:\s*\*' | grep -v '//'
projection.ts:81:  module: string | undefined,
projection.ts:83:  const 选中 = manifests.filter((清单) => 清单.module === module || 清单.module === GENERIC_MODULE)

$ grep -n "tab-context\|useCenterTabs\|useContext\|center/" packages/app/src/ai-session/projection.ts   ⇒ 无
$ grep -n "MANIFESTS" packages/app/src/ai-session/projection.ts                                          ⇒ 仅文档注释一行
```

⇒ **读「当前模块」的地方恰好 1 处**（那个形参），四层都从它派生。接线（把 `center.module()` 传进来）
是 T004/T008 的事，那时会变成两处，**两处都是跟着注入换的、没有第三处偷读全局**（`#004-01`）。

**变异验证（四层各一次隔离注入，`#005-04` / `#005-12` / `#005-15`）**：

| 注入 | 期望 | 实得 |
|---|---|---|
| **M-a** `common` 改从**全部清单**取（不看模块） | 「常用操作」那几条红，另三层绿 | **4 fail**：③、四层来源(common)、两条边界。**全落在 common 层**，context/drawer/`all` 三条照旧绿 ✅ |
| **M-b** `context` 同上 | context 那条红 | **4 fail**，含「「上下文指令」层同样跟着模块换」✅ |
| **M-c** `drawer` 同上 | 抽屉那两条红 | 首跑 **2 fail**（见下「一处小账」）；**改过网眼后复跑 3 fail**，③ 也红了 ✅ |
| **M-d** `all` 同上 | 「/」那条红 | **4 fail**，含「「/」命令面板的匹配池跟着模块换」✅ |
| **M-e** 往 `MANIFESTS` 塞一份**跨清单重名**（新增的报警断言） | 恰红它自己 | **1 fail**，正是那条；「无孤儿 / 无悬空 / 同清单内不重复」全绿 ⇒ 它盯的是**别的断言够不到的维度** ✅ |

**一处小账（M-c 首跑暴露的，已修）**：③ 那条「甲的卡一处都不出现」初版对抽屉用的是 **`条.name`**
（显示名），而夹具里显示名不含「甲」⇒ **抽屉漏进了乙的条目，③ 照样绿**。四层改成一律按 **`skill`**
（连接键）取之后，M-c 复跑 ③ 才红。这正是 `#005-15`：**一条网拦不拦得住，只能靠拆掉那一行去看**，
不能靠读它的自我描述。教训候选（留给收尾的 LEARNINGS）：**横切网在每一腿上要用同一个键**——
混用显示名/连接键时，其中一条腿是瞎的且没人会发现。

**今天的实况（给 T004 的交接）**：`MANIFESTS` 只有「通用」那一份（两个 opencode 开发工具链的 skill、
卡片为空）⇒ 在 `ai-session` 模块下四层是「抽屉/命令面板各 2 条、两张卡层皆空」。
业务模块的清单（F6 资金 / F7 话单 / F9 资产）落地时往 `MANIFESTS` 里加。

---

## T004 出参 · 顶部「常用操作」指令卡（2026-10-07）

**产物**（3 新 ＋ 2 改）：

| 文件 | 内容 |
|---|---|
| `packages/app/src/ai-session/instruction-cards.tsx`（新） | **四层共用的视觉语法**：卡面（§4.7.1）＋ 分组标题 ＋ 行末溢出「⋯」（§4.7.2）。导出 `InstructionCardRow({ title, cards, availableWidth?, activePrompt?, onPick? })` ＋ 三个宽度常量（`CARD_WIDTH` / `CARD_GAP` / `OVERFLOW_WIDTH`——导出是给 T005 的用例算期望张数用的，别在测试里重抄 96/8/24） |
| `packages/app/src/ai-session/common-cards.tsx`（新） | 本层：`<InstructionCardRow title="常用操作" …>`。**一个组件一行代码**，是刻意的 |
| `packages/app/src/ai-session/common-cards.test.tsx`（新） | 13 条用例（下面那张变异表就是逐条打它的） |
| `projection.ts` ＋ `projection.test.ts`（改） | 补 `ProjectedCard.module` ＋ 1 条用例（见 T003 出参第 9 条的续：**顺序仍不在投影层**） |

**为什么语法与层要拆成两个文件**：DESIGN §4.7 开篇那句「同一张卡的语法只有一个」。语法若住在
`common-cards.tsx` 里，T005 的 `context-cards.tsx` 就得从一份**叫「常用操作」的文件**里 import 卡面，
或者被诱着再抄一遍长相——那就把 FR-001 要的「机制通用」在视觉上又拆回两份。拆开后各层只剩
「取投影哪一支 ＋ 叫什么标题」。**拆完顺手更正了两处旧述**（`#002-06`：改一处就 grep 全部同类）：
`plan.md` 的目录注释原把 `instruction-cards.tsx` 写成「指令卡机制通用框架」（框架其实在
`projection.ts`，T003 的产物），DESIGN §4.7.1 的配色注记原指 `common-cards.tsx`。

| # | 定型的事 | 取数 / 依据 |
|---|---|---|
| 1 | **行内排序在渲染层**（`通用优先`），**不在**投影层 | §4.7.1「常数在前才形成肌肉记忆」；T003 出参第 9 条（投影**有意不钉顺序**——那时是「未裁定」，现在裁定在渲染层，故投影那边一个字都没改，只多给了 `module` 这个**事实**） |
| 2 | `ProjectedCard` 补 `module`：**拍平后「这张卡来自哪份清单」就推不出来了** | §4.7.1 的排序要用它。`skill` 早在 T003 补过；`module` 与它同理——卡片在 `SkillCapability.cards` 里时这两样是**结构性**的，拍平就丢（`#004-07` 的同类：**结构里有的，拍平后必须显式带下来**） |
| 3 | 卡面底面**二选一**（`classList` 互斥），**不是叠加** | 两条 `background-color` 落同一个元素上谁赢由 Tailwind 生成顺序定 ⇒ 现场看着像「选中态坏了」，实际是**两份底色在打架**。hover 同理只挂在默认态（选中态悬停不该变灰，§4.7.1） |
| 4 | `truncate` 挂**内层 `span`**，不挂按钮 | 按钮是 `flex` 容器，`text-overflow` 要在块级／内联块子元素上才生效；先例 `center/tab-bar.tsx` 的 `tab-title` 同形 |
| 5 | 浅金与阴影只能走**任意值**写法（`bg-[var(--v2-…)]` / `shadow-[var(--v2-…)]`） | §4.7.0 那张表：`--v2-background-bg-accent-soft` 与全部 `--v2-elevation-*` **没有 Tailwind 孪生** |
| 6 | 宽度**来源**可以是量出来的，**计数**必须是纯函数 | §4.7.2。`ResizeObserver`（无该 API 时跳过 ⇒ 保持「还没量到」）；计数走 `center/tab-overflow.ts` 的 `splitTabOverflow`（**不改它**——它在守 FR-005） |
| 7 | 「还没量到」⇒ 当**不限宽**先全显示 | 判成 0 会把整行一股脑塞进「⋯」，**凭空隐藏比暂时多显示更糟**（同 `center/tab-bar.tsx`） |
| 8 | 溢出菜单用**原生 `MenuV2`**，不自造浮层 | §4.7.2：min-width / padding / 圆角 / `box-shadow: var(--v2-elevation-floating)` / z-index 都由 `menu-v2.css` 给 |
| 9 | 溢出「⋯」与「更多 skill」**是两件事**，界面必须分开（注释里点明） | §4.7.2：前者装**本行放不下的那几张**，后者开**整个 skill 全集**，差一个数量级。「更多 skill」是 T006 |
| 10 | 溢出钮的无障碍标签「还有 N 张卡片」＋ 字形字面量 `⋯`（U+22EF） | 与 `center/tab-bar.tsx` 同一颗钮、同一档取舍（原生图标集没有 ellipsis/more） |

**实测（`MenuV2` 在 happy-dom 里的行为——都是探针跑出来的，不是读文档推的）**：

| # | 现象 | 取数 |
|---|---|---|
| 1 | Trigger **只在 `pointerdown`（主键、非 touch）时开**；`.click()` 不开（那条分支只服务 `pointerType === "touch"`） | 上游 `menu-trigger.tsx` 的 `onPointerDown` / `onClick` ＋ 探针（`.click()` 后 body 里 item 数 **0**，`pointerdown` 后 **1**）。**第一版探针判错过**：先得出「MenuV2 在 happy-dom 里不可用」，读了上游源码才发现是**我发错了事件**（`#003-01`：先怀疑测量，再怀疑被测物）⇒ 这条教训写进了用例里的 `开菜单` 注释 |
| 2 | Item 在 **`pointerup`**（`button === 0`）时选中，`onSelect` 于此刻触发；`pointerdown` / `click` 都不触发 | 上游 `menu-item-base.tsx` ＋ 探针 |
| 3 | **菜单不会因选中而从 DOM 消失**：同步 / 微任务 / `setTimeout 0` / 50ms / rAF / **200ms** 全试过，item 始终在 `document.body` | 探针。与 `#005-07` 同族（happy-dom 无 CSS 引擎 ⇒ Kobalte 的 `Presence` 等不到 exit 动画）⇒ **「选完菜单收起」在本环境不可断言**，按 `#002-02` 记进缺口表，**不写成「已覆盖」** |
| 4 | Portal 渲染进 `document.body`（**不在 host 里**）；`dispose()` 能清干净 | 探针（dispose 后 body 里 0 个残留）⇒ 本文件的 `mount` **非卸载不可**，否则上一个用例的菜单项会留在 body 里被下一个用例读到 |

**变异验证**（18 批，逐条「注入 → 跑 → 还原」；`#005-04` / `#005-12` / `#005-15`）。
**基线 13 pass / 0 fail（组件）＋ 16 pass / 0 fail（单元）；18 批跑完再跑一次，两档都回到同一个数**
（还原是逐字节的，脚本自己记着原串）：

| 注入 | 实得 |
|---|---|
| **a** 排序去掉 `通用优先` | **4 fail**：排序、点卡、放不下、放得下（见下「一类②」） |
| **b** 标题 11→12px | 1 fail，「渲染分组标题」 |
| **c** 卡高 `h-8`→`h-9` | 1 fail，「卡面取 §4.7.1 那一串」 |
| **d** 卡面去掉白底 | 同上 1 fail |
| **e** 描边 muted→base | 同上 1 fail |
| **f** 卡面去掉阴影 | 同上 1 fail |
| **g** 卡文字 13→14px | 1 fail，「卡面文字取 §4.7.1」 |
| **h** 卡文字去掉 `truncate` | 同上 1 fail |
| **i** 整行底面 layer-01→base | 1 fail，「整行取右栏底面 layer-01」 |
| **j** 点卡不回调 | 1 fail，「点一张卡：回调带出那一张」 |
| **k** 选中态不点亮 | 1 fail，「选中态……其余两张不带」 |
| **l** 卡宽 96→128 | **4 fail**：放不下、菜单列出、点菜单项、溢出钮（都是溢出那组的） |
| **m** `收进` 从头部切（全收） | **5 fail**：菜单列出、点菜单项、放得下、还没量到、溢出钮 |
| **n** 菜单项不回调 | 1 fail，「点菜单里一项」 |
| **o** 溢出钮 `size-6`→`size-5` | 1 fail，「溢出钮取 §4.7.2 那颗」 |
| **p** 无障碍标签改名 `aria-label`→`aria-zzz` | 同上 1 fail |
| **q** 未量到时不再兜底成不限宽 | 1 fail，「还没量到可用宽度」 |
| **r** 卡的来源一律标成 `GENERIC_MODULE`（改 `projection.ts`） | 1 fail（单元档），「每张卡带 `module`」 |

**一类②（红得不够「恰」的那三条，据实记，不凑成「恰红」）**：`a` / `l` / `m` 三种注入落在**共享的排序
与切分**上，红的是**所有依赖那个值的用例**——`a` 里连「点卡回调」也红（卡换了位置，`槽(host,"card")[1]`
指向了另一张）。这不是「变异不精确」，是**那三处的语义本来就是全行共享**：切分错了整行的成员就都错。
`#003-03` 第 ② 类。

**一处小账（工具）**：上一轮跑变异时有一批的 `perl` 模式里写了 `${收进().length}`，**被 bash 在双引号
里展开掉**，`perl` 报错退出、文件根本没被改——而打印出来的还是**基线**的 `13 pass / 0 fail`，
看着像「这条变异杀不掉」。这次改成**写一个 `.mjs` 数组**（`Bun.spawnSync` 跑测试、`finally` 里还原、
**先数模式命中次数、不为 1 就报「没注入」**），全程不经 shell。教训候选（留给收尾的 LEARNINGS）：
**变异脚本要能自证「注入真的发生了」**——否则「全绿」既可能是被测物坚固，也可能是**你什么都没改**。

**门禁（2026-10-07 实测）**：

| 门 | 结果 |
|---|---|
| `packages/app/src/workspace/design-token-refs.test.ts` | **5 pass / 0 fail**（先红后修，见下） |
| oxlint（**仓库根**跑，5 个文件；`#004-10`） | **0 warnings / 0 errors** |
| `packages/app` 的 `tsgo -b`（＝ `bun run typecheck`） | **EXIT=0**。⚠️ 走 `turbo` 那次报的是 **`cache hit, replaying logs`**——缓存命中不是实测，故改跑包内脚本取真值（`#001-01`） |
| `packages/app/src/openhive-module-dirs.test.ts`（U9 那条） | **1 pass / 0 fail** |
| `ai-session` ＋ `center`：单元档 / 组件档 | **72 pass / 0 fail** / **56 pass / 0 fail** |

**一处实账（`design-token-refs.test.ts` 先红了）**：我在 `instruction-cards.tsx` 的**源码注释**里把
「哪个写法不对」写成**反例原文**（`bg-` 直接接上 `v2-background-bg-accent-soft`、`shadow-` 直接接上
`v2-elevation-raised`），而那个测试扫的是**文件全文** ⇒ 注释里的反例一样算「写了工具类形态」，判
**`["v2-background-bg-accent-soft", "v2-elevation-raised"]` 两个名字没有对应色值**。修法是把前缀与名字
**拆开写**（「`bg-` ＋ 前者」）。**DESIGN §4.7.0 能照原样写反例，只因为文档不在扫描范围内**（它只扫
`packages/app/src` 下那七个目录）——这条已补进 §4.7.0 末尾，免得 T005–T007 各踩一次。

**交接**：

- **T005**：只用 `<InstructionCardRow title="上下文指令" …>` 取 `context` 那一支；**不要**再写卡面、
  不要另立一副长相。`InstructionCard` 的触发字段也归 T005 加（缺口表最后那条）。
  ✅ **已兑现**（2026-10-07，同一天）——上面这两句 T005 都照做了：`context-cards.tsx` 长相零代码、
  `InstructionCard` 补了 `context?: string`。**这一条留在原处是当记录用的，不是待办**（见「T005 出参」）。
- **T009**（`#002-04`：推出去的责任要落进接收方的表）：`activePrompt` 这个 prop 的**生产来源是 T009**
  ——「点卡片 = 填入一句话」把它填进输入框，选中态才有东西可点亮。今天它是**测试专用接缝**，
  生产里恒为 `undefined` ⇒ **§4.7.1 的选中态在生产里还看不见**。这一笔已落 `tasks.md` 的 T009 条。
- **T008**：`availableWidth` 的**生产来源**。本行自己会量（`ResizeObserver`，同 `tab-bar`），
  但**整行今天还没接进右栏** ⇒ 生产里不会真的发生溢出（缺口表）。
- **T006**：溢出「⋯」与「更多 skill」是两件事，别合并（§4.7.2，注释里已写）。

---

## T005 出参 · 「上下文指令」动态浮现（2026-10-07）

**产物**（2 新 ＋ 2 改）：

| 文件 | 内容 |
|---|---|
| `packages/app/src/ai-session/context-cards.tsx`（新） | 本层：取投影的 `context` 那一支 → 按「中栏当前具备哪些上下文」筛 → 一张都不剩就**整段不渲染**。**长相一行都没有**——全部走 T004 的 `instruction-cards.tsx` |
| `packages/app/src/ai-session/context-cards.test.tsx`（新） | 12 条用例（下面那张变异表逐条打它，`#004-12` 抄的 `common-cards.test.tsx` 那副 harness） |
| `packages/app/src/ai-session/capabilities.ts`（改，+17/−3） | `InstructionCard` 补**触发字段** `context?: string` ＋ 注释（006 的 self-delegation 到期兑现，见缺口表那条已闭合行） |
| `packages/app/src/ai-session/capabilities.test.ts`（改，+30/−0） | 两条**报警断言**（上下文层必须带非空 `context`；常驻层不该带 `context`）＋ `全部卡()` 助手 |

**本层只做三件事，一件长相的事都不做**：① 取 `context` 那一支；② 筛；③ 空集就整段不渲染（连分组标题
都不留）。`title="上下文指令"` 是本层**唯一**与「常用操作」不同的东西——那正是 §4.7 开篇「同一张卡的语法
只有一个」想看到的样子。**筛选落在渲染层、不进 `projectCapabilities`**：投影层的契约是「给事实，不给政策」
（`projection.ts` 文件头，T004 的行内排序也是照它落在渲染层）；把「当前中栏选中了什么」塞进那个纯函数，
会让每次点击都重投一遍 `drawer` / `all`——那两支根本不看选中。

| # | 定型的事 | 取数 / 依据 |
|---|---|---|
| 1 | 触发按**种类**匹配，不按「谁被选中」、也不按选中个数 | US2 场景 1 原文就是「选中**若干**账户 → **三条卡**」——三条卡各要一次同种上下文，不是每个账户三条。`context` 因此是 `string` 不是集合 |
| 2 | `InstructionCard.context` 取**可选字段 ＋ 运行时报警**，**不改写成交替联合**（discriminated union） | Simple first（`CLAUDE.md` 行为准则 §2）＋ 本文件既有先例（`group: string` 同样靠报警断言守）。`capabilities.ts` 里本来就写着「T005 落地时把触发条件的字段加进本类型」——**加了字段，没重塑类型** |
| 3 | `contexts` **必填**（不给默认值） | 「忘了喂」若静默退化成「这一层永远不出现」，那与「今天确实没有上下文」**长得一模一样**。必填能在**调用点**报出来。反面是 `availableWidth` 能缺省——因为「还没量到」是个**正常**状态，`contexts` 不是 |
| 4 | 畸形声明（`layer === "context"` 却没 `context`）⇒ **fail-closed，不浮出** | 同 `rbac.ts` 那条「先整体 deny、再逐条 allow」的基线取法。静默放过等于让一张不该出现的卡凭空冒出来，**比少一张更难查**。⚠️ 兜底不是主逻辑——主逻辑是那两条报警断言 |
| 5 | 「一张都不剩」⇒ **整段不渲染**（标题也不留） | §4.7 那张表（「无上下文时整段不渲染」）＋ US2 场景 2（「消失，不占空间」） |
| 6 | 两条报警断言**今天空转**，靠**变异**自证有牙 | `MANIFESTS` 的 `cards` 全为空（006 只造机制）⇒ 不注入畸形卡就永远绿（`#004-13`：要问「我这条断言是不是空的」）。已用 M1/M2 各自恰红一条证明（下） |

**变异验证**（11 批，逐条「注入 → 跑 → 还原」；`#005-04` / `#005-12` / `#005-15`）。
**基线 12 pass / 0 fail（组件档）／ 24 pass / 0 fail（单测档，含两条报警）；11 批跑完再跑一次，
两档都回到同一个数**（注入前先数锚命中次数，不为 1 直接报「没注入」，`oh-mut-006c.mjs` 不经 shell）：

| 注入 | 实得 |
|---|---|
| **a** 筛选整个去掉（全部浮出） | **5 fail**（见下「一类②」） |
| **b** 不比对上下文集合（只看有没有触发键） | **4 fail**（同上） |
| **c** 整段不渲染那道门去掉 | **3 fail**：空集 / 不命中 / 空数组 |
| **d** 门的条件换成「卡数组非空」 | **2 fail**：空集 / 不命中 |
| **e** fail-closed 兜底反过来（缺触发键也浮出） | 1 fail，「卡没有声明触发上下文 ⇒ 不浮出来」 |
| **f** 分组标题改字（上下文指令→上下文） | 1 fail，「有对应上下文 ⇒ 浮现」 |
| **g** 不转发 `onPick` | 1 fail，「点一张浮出来的卡：回调带出那一张」 |
| **h** 不转发 `activePrompt` | 1 fail，「选中态沿用 §4.7.1」 |
| **i** 不转发 `availableWidth` | 1 fail，「放不下时也照 §4.7.2 溢出收「⋯」」 |
| **j** 共享语法的标题字号 11→12px（改 `instruction-cards.tsx`） | 1 fail，「复用是真的，不是又画了一份」 |
| **k** 共享语法的排序去掉（改 `instruction-cards.tsx`） | **4 fail**（同上「一类②」） |

**两条报警断言的牙**（另跑一批，`oh-mut-006b.mjs`）：往 `MANIFESTS` 注入一张畸形卡 ⇒
**M1**（上下文层不带触发键）恰红 1 条、**M2**（常驻层带了触发键）恰红 1 条，各红各的（`#005-12`）。

**一类②（红得不够「恰」的那五条，据实记，不凑成「恰红」）**：`a` / `b` / `c` / `d` / `k` 落在
**筛选与切分**上，红的是**所有依赖「这一行有哪几张卡」的用例**。这不是变异不精确，是那几处的语义
本来就**全行共享**：`a` 里连「空集整段不渲染」也红（没有筛选，集合是不是空都不影响结果）。
`#003-03` 第 ② 类。
⚠️ **j / k 打在 T004 的 `instruction-cards.tsx` 上**（文件本身零改动，跑完逐字节还原、`git diff`
为空）——它们是**反向**证明：T005 这 12 条里那些「长相 / 次序」断言**不是空的**，共享语法被改一下
这里就会红。这正是「复用是真的」该有的样子（`#004-02`：两个投影之间要有故意会红的相等断言）。

**两处小账（自查，趁写测试时就抓住的）**：第一版 `context-cards.test.tsx` 里我自己写错了两处**算术**，
**都不是跑出来的、是读出来的**：① 一条多用例断言写了 `["记一笔研判","查甲的流水"].sort()`——自相矛盾
（「通用优先」把「记」排在「查」前面，而默认 `sort()` 比 UTF-16 码元会把「查」排前面），改成对着默认
夹具写死 `["查甲的流水","看话单"]`；② 溢出那条给了 3 张卡，但只有 2 张命中当前上下文 ⇒ **不会溢出**，
补了第三张（`丙卡`）才让「⋯」真的出现。教训：**夹具的算术要在跑之前自己算一遍**——这两处若漏了，
②会静默变成「一条断「⋯」的用例其实什么都没断」。

**门禁（2026-10-07 实测，串行跑；`#003-01`）**：

| 门 | 结果 |
|---|---|
| `packages/app/src/workspace/design-token-refs.test.ts` ＋ `openhive-module-dirs.test.ts` | **6 pass / 0 fail** |
| `ai-session` 单元档（`capabilities.test.ts` ＋ `projection.test.ts`） | **24 pass / 0 fail** |
| `ai-session` 组件档（4 文件） | **49 pass / 0 fail** |
| oxlint（**仓库根**跑，4 个文件；`#004-10`） | **0 warnings / 0 errors**（130 rules） |
| `packages/app` 的 `tsgo -b`（＝ `bun run typecheck`） | **EXIT=0**（直接跑包内脚本，不取 turbo 缓存） |

**交接**：

- **T013**（写测试：指令卡投影 ＋ 上下文动态浮现）：**这 12 条已经在了，别再写一遍**。T013 该做的是
  **换一份注入的清单**跑（`#003-05`：框架的判据是「换输入，四层跟着换」）——本文件今天喂的都是
  测试自己的夹具，`MANIFESTS` 全空。
- **T008**（右栏会话接进 `ThreePane.right`）：已落 📥 到 `tasks.md` 的 T008 条（`#002-04`）。
  本条给它添的是 **`contexts` 无处可取**——T004 那条只交代了 `availableWidth`。
- **F6（资金）/ F7（话单）**：`context` 的**取值词表**归它们（006 只钉「不能为空」）。
  US2 场景 1 举的是「选中账户」——那是 F6 中栏的选中。
- **009**：`capabilities.ts` 是 **006 → 009 的契约**（009 的 Prerequisites 把「F8 指令卡已落地」列为前置）。
  本次给它**加了一个可选字段**，未重塑形状；009 落地时仍按它自己的资产元数据复核一遍。

---

## T006 出参 · 「更多 skill」抽屉（2026-10-07）

**产物**（2 新，零改）：

| 文件 | 内容 |
|---|---|
| `packages/app/src/ai-session/skill-drawer.tsx`（新） | 受控面板 `SkillDrawer`：`open` / `groups` / `onClose`。**只做「按 skill 分组」**（U8）＋ §4.7.3 逐格写死的那几样长相 |
| `packages/app/src/ai-session/skill-drawer.test.tsx`（新） | 12 条用例（harness 整段抄 `context-cards.test.tsx`，`#004-12`） |

**本层只做一件事**：把 `projectCapabilities(...).drawer` 那份 `SkillGroup[]` 画出来。分组的**内容、顺序、
条数全来自输入**——本组件不排序、不筛、不合并、不分组。它跟 T004/T005 那条「指令卡四层」的路**不重合**：
那两层渲染的是**卡**（`ProjectedCard`），本层渲染的是 **skill 全集本身**（`SkillCapability`），所以
`instruction-cards.tsx` 那套视觉语法这里一格都用不上。

**入口不在这里**（2026-10-07 裁定）：▸ 按钮 ＋ 开合状态归 **T008**。design-v2 §8.2 与
`docs/superpowers/specs/2026-09-12-AI资产-design.md` 都把那颗钮画在**输入框旁边**，而输入框是 §4.7.5
的 Hero 输入（T008 的 `session-panel.tsx`）⇒ 钮坐在哪由**容器**决定。本文件里放一颗钮＝替 T008 提前钉死。

| # | 定型的事 | 取数 / 依据 |
|---|---|---|
| 1 | 受控面板，**不带**入口 ▸ 按钮与开合状态 | 见上；`open` / `onClose` 是给 T008 的接缝（本文件里由测试驱动） |
| 2 | 组顺序 = **输入顺序**，不排序 | 2026-10-07 裁定（接 T003 那条挂账）。夹具刻意用 ASCII **逆序**（`zz-工具` 在 `aa-研判` 前面）：加一句 `localeCompare` 当场红。中文的字母序依赖 ICU 数据、写不死，而这条要钉的恰恰是「**不排序**」 |
| 3 | `absolute inset-0` 而**不是** `fixed`（不做全屏遮罩） | §4.7.3 明写「不做全屏遮罩」：`absolute` 盖的是**右栏那个容器**（该容器须 `relative`），`fixed` 盖的是**整个视口**。判据是**两条**：含 `absolute` ＋ 不含 `fixed` |
| 4 | 圆角 10px 走**任意值** `rounded-[10px]` | 「右栏内浮层唯一的一档」（§4.7.3 末条）；与 §3.1「弹窗 16px」不是一档，别混 |
| 5 | 底面与阴影走**任意值**（`bg-v2-background-bg-base` / `shadow-[var(--v2-elevation-overlay)]`） | §4.7.0 那张表：`--v2-elevation-*` 没有 Tailwind 孪生；**把工具类前缀直接接上它**会被 `design-token-refs` 判红（该测试扫**文件全文**，注释里也不能出现那种形态） |
| 6 | 头部一行：40px、`border-b border-v2-border-border-muted`、`px-4`；关闭钮 = `IconButtonV2` ＋ `xmark-small`／`variant="ghost-muted"` | **本条的 self-decision**（§4.7.3 的表里没有 header 这一格）：`onClose` 得有个出口，而**原生右栏抽屉**（`components/help-button.tsx`）就是这个形状 ⇒ 照它长，省掉一次「这面板是不是野生的」判断。⚠️ 这条要复核（见下方缺口表） |
| 7 | 条目**不带图标** | §4.7 开篇：skill 的图标今天**没有客观来源**（`capabilities.ts` 的元数据里就没这一项），配图标就是造数据 |
| 8 | 条目读 **`name`（显示名）**，不是 `skill`（连接键） | 两者**今天同值**（`MANIFESTS` 两条都是 `skill: "effect" / name: "effect"`），但**夹具刻意分家**（`fund-link-analysis` / 「资金关联分析」——`capabilities.ts` 预告的 009 形状）⇒ 渲染里读错字段**当场红**。若夹具让两者同值，那个变异**摘不出来**、这条断言就是空的（`#004-13`）。**生产里它变成一条真断言的那天是 009** |
| 9 | 组标题 11px muted **各写一份字面量**，不提取共享常量 | 提取要动**已交付并审过**的 T004 那个文件；而两处**各自都有断言**钉着（卡行标题那侧：`common-cards.test.tsx` 的「11px 的 muted」＋ `context-cards.test.tsx` 断 className 那处；本侧：本文件一条）⇒ 改一处会红另外那几条，**不是静默可漂的镜像**（`#004-02` / `#003-05`）。**靠的是「两侧都有断言」，不是靠共享常量**——已由反向变异 M21 实测（下） |
| 10 | 行高 ≥ 40px 落成 `min-h-10` | happy-dom 无 CSS 引擎 ⇒ **量不出高度**，只能断类名（`#005-07`） |

**变异验证**（21 批注入 ＋ 1 批反向 ＋ 1 批报警；逐条「注入 → 跑 → 还原」，`oh-mut-006d.mjs`／
`oh-mut-006d-m4.mjs` 不经 shell，注入前先数锚命中次数、**不为 1 直接报「没注入」拒跑**）。
**基线 12 pass / 0 fail；21 批跑完再跑一次，回到 12 / 0**（两次还原都逐字节相同）：

| 注入 | 实得 |
|---|---|
| **M1** 摘掉 `absolute` / **M2** `absolute→fixed` / **M3** 摘掉 `inset-0` | 各 1 fail，红的都是「只盖右栏、不带 `fixed`」那条 |
| **M4** 底面换 `layer-01` ｜ **M5** 圆角 `10px→2xl` ｜ **M6** 阴影 `overlay→raised` | 各 1 fail，「底面 / 圆角 / 阴影取 §4.7.3 那三格」 |
| **M7** `open` 门形同虚设（`when={true}`） | 1 fail，「`open === false` ⇒ 整块不渲染」 |
| **M8** 组标题写死 | **2 fail**（见下「一类②」） |
| **M9** 组标题字号 11→12 ｜ **M13** 条目名 13→14 ｜ **M14** 描述 11→12 | 各 1 fail，各红各的字号那条（`#005-12`：一个修法落 N 处就写 N 条） |
| **M10** 分组改字母序（`localeCompare`） | 1 fail，「顺序 = 清单给的顺序，不做任何排序」 |
| **M11** 名字读连接键（`条.name`→`条.skill`） ｜ **M12** 描述写死 | 各 1 fail，「两行文字取显示名 `name` 与 `description`」 |
| **M15** 名字去 `truncate` ｜ **M16** 描述去 `truncate` | 各 1 fail，「两行都单行截断」 |
| **M17** `min-h-10→min-h-8` | 1 fail，「行高 ≥ 40px」 |
| **M18** 条目里塞 `<svg />` | 1 fail，「条目不带图标」 |
| **M19** 关闭钮标签改字 ｜ **M20** 关闭钮回调摘掉 | 各 1 fail，「关闭钮」那条（一个断标签、一个断回调） |

**一类②（红得不够「恰」的那一条，据实记，不凑成「恰红」）**：**M8** 红**2** 条——组名写死后，
「组标题就是 `group` 名」与「组标题的顺序」**两条同时**红（它们读的是同一个东西）。不是变异不精确，
是那两条的**观测面重叠**。`#003-03` 第 ② 类。

**反向变异（M21）——证明第 9 条那句「不提取共享常量」是实测不是空话**：把 **T004 的
`instruction-cards.tsx`** 的卡行标题 11→12px ⇒ **本文件 12 / 0 全绿**，而 `common-cards.test.tsx`
与 `context-cards.test.tsx` **各红 1 条**（跑完那个文件逐字节还原、`git diff` 为空）。
它证明的**边界也说清楚**：卡行标题漂**不会**惊动本文件——两处漂是**各由自己那条**抓的，不是靠共享常量。
这正是「两份字面量 ＋ 两侧都有断言」的真实形状（`#005-15`：不让注释比断言强）。

**报警验证两处（都为了回答「那道绿是不是空转」，`#004-13`）**：

- 给新文件塞一个不存在的 token（`bg-v2-token-does-not-exist`）⇒ `design-token-refs.test.ts` 恰红
  **2 条**、两条都点名该 token ⇒ **新文件确在它的扫描范围内**，那道 5 pass 不是空转。
- 给新文件塞 `const 报警探针: number = "…"` ⇒ `tsgo -b --force` **EXIT=1** 并点名该文件 ⇒ 那次
  EXIT=0 是真无错（不是增量构建「无事可做」）。

**两处测量自纠（都趁写报告时就抓住的）**：

1. 第一遍 `bunx tsgo -b | tail -8; echo EXIT=$?` 打出的 **`EXIT=0` 是 `tail` 的退出码**，不是
   `tsgo` 的——管道末端把被测进程的退出码吃掉了。去掉管道重测才是真的（`#003-01`：先怀疑测量）。
2. oxlint 首轮报 **6 warnings**，全是同一个 `no-unnecessary-type-assertion`（`槽(...)[0]!.className`
   的 `!` 多余——包内 tsconfig **未开** `noUncheckedIndexedAccess`，`[0]` 本就是 `HTMLElement`）。
   按 `#001-02` 的判据（「本次新增 / 改动文件 0 命中」，不是「全局退出码 0」）**不达标** ⇒ 6 处 `!`
   全去后 0 / 0。

**门禁（2026-10-07 实测，串行跑；`#003-01`）**：

| 门 | 结果 |
|---|---|
| `ai-session` 组件档（4 文件，含本文件 12 条） | **45 pass / 0 fail** |
| `ai-session` 单元档（`capabilities.test.ts` ＋ `projection.test.ts`） | **24 pass / 0 fail** |
| `design-token-refs.test.ts`（扫 `ai-session` 全目录，**含新文件**） | **5 pass / 0 fail**（＋上面那道报警验证） |
| oxlint（**仓库根**跑，2 个新文件；`#004-10`） | **0 warnings / 0 errors**（130 rules） |
| `packages/app` 的 `tsgo -b --force` | **EXIT=0**（＋上面那道报警验证 EXIT=1） |

**交接**：

- **T008**：▸ 入口 ＋ 开合状态 ＋ 把抽屉挂进去是它的（`tasks.md` 已落 📥，`#002-04`）。本条**没有**
  替它决定钮坐哪，只把 `onClose` / `open` 两个 prop 的形状定下来。⚠️ 另：T008 也要复核 §4.7.3
  里那条**没写 header** 的地方（本条的 self-decision 见第 6 条）。
- **009**：抽屉的「最近使用 / 收藏加权」按 U8 挂它（缺口表已有两行）；`group` 取值的真来源也是它。
- **T013**（测试验收）：**这 12 条已经在，别再写一遍**。T013 该做的是换一份注入的清单跑
  （今天喂的全是测试自己的夹具）。

---

## T007 出参 · `/` 命令面板（2026-10-07）

**出参**：输入 `/` 唤起 ＋ 模糊匹配。§4.7.4 的硬指令（「能换数据源就不新写」）**成立**——
本条的产物**不是一个浮层**，是一个**纯映射函数**。

| 产物 | 说明 |
|---|---|
| `packages/app/src/ai-session/command-palette.ts` | `skillCommands(清单) → PromptInputV2Suggestion[]`。唯一的出口，**无 JSX、无视觉值、不 import 任何组件** |
| `packages/app/src/ai-session/command-palette.test.tsx` | **11 条**：适配层 4 条（纯函数）＋ 端到端 7 条（**真 controller ＋ 真状态机 ＋ 真 `fuzzysort`**） |

**本层只做一件事**：把 `SkillCapability` 填进原生 controller 的**那一个空位**
（`commands: Accessor<PromptInputV2Suggestion[]>`）。**接线是 T008**。

### 为什么没有浮层（开工第一件事的核查结果）

§4.7.4 要求先核「原生弹层是不是本来就挂在 `/` 上」。**是**，而且是逐环都短不了：

| 环节 | 原件 | 取数命令 |
|---|---|---|
| 打 `/` 唤起 | `machine.ts` 的 `inputChanged`：正文匹配 `/^\/(\S*)$/` ⇒ `popover = { type: "command-inline" }`；正文非空时 `openCommands()` 走 `command-menu` 支 | `grep -n 'command = value.match' packages/session-ui/src/v2/components/prompt-input/machine.ts` |
| 浮层形态 | `index.tsx` 的 `PromptInputV2Popover`——§4.7.4 那张表的 class 串就是它的逐字实况 | `grep -n 'PromptInputV2Popover' packages/session-ui/src/v2/components/prompt-input/index.tsx` |
| 模糊匹配 | `interaction.ts` 的 `commandList = useFilteredList({ filterKeys: ["trigger","title"] })`（`fuzzysort`，**真子序列**） | `grep -n 'filterKeys' packages/session-ui/src/v2/components/prompt-input/interaction.ts` |
| 数据源 | controller 入参 `commands` —— **唯一的空位** | `grep -n 'commands:' packages/session-ui/src/v2/components/prompt-input/interaction.ts` |

上游填这个空位的地方是 `packages/app/src/components/prompt-input-v2.tsx`（SDK 自定义命令 ＋ 内置斜杠
命令），那是**高频文件**（CLAUDE.md 的 Anti-Patterns）⇒ 本函数**不碰它**，只做一份并列的数据源。

### 探明但没料到的三件事（都是踩出来的，写在这里省下一个人重踩）

1. **`/` 不从 `onKeyDown` 进来，从 `onInput` 进来**。第一版探针照 `onKeyDown(键("/"))` 打，
   三条路（打 `/`、非空正文 `openCommands()`、`setQuery`）**全空**——状态机里 `keyDown` 对 `/`
   **一支都没有**（`popover` 关着时直接 `unchanged`）。真正的入口是正文变化：
   `controller.onInput("/", prompt, cursor)` ⇒ `input.changed` ⇒ 那个正则。**判据**：
   `grep -n '"key.down"' .../machine.ts` 与 `grep -n 'inputChanged' .../machine.ts` 一对照就清楚。
2. **`suggestions()` 是异步的**（`useFilteredList` 底下是 `createResource`）⇒ 打完字要等一个 tick；
   探针第一版读同步值，拿到的是初始化时的 `empty`。
3. **`suggestions()` 与弹层开关无关**。`interaction.ts` 的 `suggestions = () => list().flat()`——
   controller 一建起来就把 `commands()` 收进去了，资源一 resolve 就有内容。所以「打 `/` 之前列表是
   空的」**是假的**：本条第一版测试就栽在这句上（红的正是那条不实的前置，不是产品）。测里已注明。

### 定型的事

| # | 事 | 依据 |
|---|---|---|
| 1 | **不新写浮层**，只换数据源 | §4.7.4 的硬指令（第一号约束）。连带**就地更正 `plan.md` 的三处旧述**（`├── command-palette.tsx`、「新增」两处）——那三行写在「原生弹层挂在 `/` 上」这个事实查明**之前**（`#002-06`：改一处就 grep 全部同类） |
| 2 | 文件名是 `command-palette.ts`（不是 `plan.md` 曾写的 `.tsx`） | 本条没有组件。**self-decision**，理由是「文件后缀要跟内容一致」 |
| 3 | **`label` 与 `trigger` 取连接键 `skill`、`title` 取显示名 `name`** | **2026-10-07 用户裁定**（三个候选里选第一个）。硬约束是实测定下来的：原生弹层**渲染的是 `item.label`**（`index.tsx` 只画 `label` ＋ `description`，**`title` 不显示**），而选中后插进正文的也是 `label`（`machine.ts` 的 `suggestionSelected` 走 `replaceTrigger`）⇒ `label` **一物二用**，做不出「显示中文名、插入连接键」。插进正文的 token 会原样成为 prompt 正文，得让下游对得回 skill ⇒ 取寻址名；而民警**不必记英文**，因为 `filterKeys` 含 `title`——**打中文一样筛得到** |
| 4 | `title` 填显示名（**不**照上游自定义命令那样填标识符） | 同上，这正是「打中文能搜到」的来源。夹具刻意让连接键与显示名**不同值**，让这条断言今天就有牙（`#004-13`） |
| 5 | **不做**前端授权过滤 | 裁定 U2 / 宪法 §四。传进来的就是 `projectCapabilities(...).all` |
| 6 | 顺序 = 清单给的顺序，**不排序** | 与 T003 / T006 同口径 |
| 7 | 端到端测试**不渲染 DOM**，直接驱动 controller | 原生把 `suggestions` / `dispatch` / `setQuery` 都挂在 controller 的 return 上（`interaction.ts:292` 起），且 `@opencode-ai/session-ui/v2/prompt-input/interaction` 是**公开导出** ⇒ 「唤起 ＋ 匹配」这两条**真的打得到**，测的是**真组件的那套机器**，不是影子实现（`#004-13`：先问「断言是不是空的」，答案是不是） |

### 变异验证（10 批：8 批注入产品码 ＋ 2 批**反向**注入上游；`oh-mut-007.mjs`）

每批「注入 → 跑 → 还原」，**注入前先数锚命中次数、不为 1 直接报「没注入」拒跑**；每批跑的是
**整个 `src/ai-session/` 目录**（既取「红的集合长什么样」（`#003-03`），又顺带证没波及其他用例）。
**基线 72 pass / 0 fail；10 批跑完再跑一次回 72 / 0**；三个被改的文件还原后**逐字节相同**。

| 注入 | 实得（pass / fail） |
|---|---|
| **M1** `label` 取显示名 | **70 / 2**——适配层那条 ＋ 「选中后插进正文的是连接键」那条（**下游认不出中文名这件事，今天就有断言守**） |
| **M2** `trigger` 取显示名 | **69 / 3**——适配层、顺序、**「打 `/rtl` 按连接键筛」** |
| **M3** `title` 取连接键（去掉中文搜索面） | **68 / 4**——适配层、打中文、真·模糊、选中那条 |
| **M4** `description` 置空 | **71 / 1**（适配层） |
| **M5** `id` 塌成一个常量 | **66 / 6**——`id` 那条 ＋ 5 条端到端（`createList` 按 id 去重 ⇒ 列表只剩一条，`#005-11`：一条出口漏了，另一个出口的断言不会替你看见） |
| **M6** `kind` 换成 `reference` | **70 / 2**——适配层 ＋ 选中那条（非 `command` 走 `mention.add`，正文不动） |
| **M7** 清单顺序反转 | **69 / 3**——顺序、打 `/` 列全集、非空正文唤起（三处都按序比对） |
| **M8** 只发第一条 | **67 / 5**——`id` 那条 ＋ 4 条端到端 |
| **M9（反向）** 原生 `filterKeys` 去掉 `title` | **69 / 3**——打中文、真·模糊、**选中那条（级联：筛空 ⇒ `suggestions()[0]` 是 `undefined`）**。**这一批证明端到端那几条真的在吃原生机制**，不是自说自话（`#005-15`） |
| **M10（反向）** 原生唤起正则改成 `/^\/(\S+)$/`（至少要一个字符） | **71 / 1**——正是「打 `/` ⇒ 弹层开」那条 |

**没有一类②**：10 批每批 pass ＋ fail 都 = 72（无名外波及），也没有「红得不成比例」的集合。
**M9 的第三个红是级联**（`#003-03` 第 ② 类的近亲），据实记在这里，不写成「恰红三条」。

**两条断言在变异里被改准了（记载下来，因为它们是「测试自己错」而不是「产品错」）**：

- 夹具第二条 skill 的显示名一度写成「RTL 与 LTR」，而连接键是 `rtl-aware-development` ⇒
  **打 `/rtl` 其实命中的是 `title`**，「按连接键筛」那条断言**测的不是它说的那件事**
  （M2 跑了它照样绿）。改成纯中文显示名「双语方向适配」后 M2 才红它（`#005-15`）。
- 「`id` 逐条不同」那条一度写成**有序** `toEqual` ⇒ M7（顺序反转）红在它头上，而它声称的是
  「id 各不相同」。改成 `new Set(...).size`，顺序归顺序那条管。

### 报警验证（证两道全局门是活的，`#004-08`）

| 注入 | 实得 |
|---|---|
| 往新文件里塞 `bg-v2-token-does-not-exist` | `design-token-refs.test.ts` **3 pass / 2 fail**，两条红都点名那个假 token |
| 往新文件里塞 `const 报警探针: number = "我不是数字"` | `tsgo -b --force` **EXIT=1**，点名 `command-palette.ts(58,7): error TS2322` |

（`#003-01` 同族的坑：`bunx tsgo -b \| tail; echo $?` 取到的是 **`tail`** 的退出码，上面这两个 EXIT
都是**去掉管道**另取的。）

### 门禁（2026-10-07 实测，串行跑；`#003-01`）

| 门 | 结果 |
|---|---|
| `ai-session` 组件档（4 个 `.test.tsx`，含本条 11 条） | **48 pass / 0 fail** |
| `ai-session` 单元档（`capabilities.test.ts` ＋ `projection.test.ts`） | **24 pass / 0 fail** |
| `ai-session` 全目录（browser 条件，6 文件，上面两档的并集） | **72 pass / 0 fail** |
| `design-token-refs.test.ts`（扫 `ai-session` 全目录，含新文件） | **5 pass / 0 fail**（＋上面那道报警验证） |
| oxlint（**仓库根**跑，2 个新文件；`#004-10`） | **0 warnings / 0 errors**（130 rules） |
| `packages/app` 的 `tsgo -b --force` | **EXIT=0**（＋上面那道报警验证 EXIT=1） |

### 交接

- **T008**：**把 `skillCommands(projectCapabilities(...).all)` 传进右栏 Hero 输入的 controller 的
  `commands`** —— 这一条就是本 feature 的 `/` 命令面板在生产里唯一缺的那根线（`tasks.md` 已落 📥，
  `#002-04`）。⚠️ 走 `onInput` 那条链（不是 `onKeyDown`），见上文第 1 条。
- **T013**（测试验收）：**这 11 条已经在，别再写一遍**。T013 该做的是换一份注入的清单跑。
- **可提上游的一件事**（不是缺口，是观察）：原生弹层**不渲染 `title`**，所以「列表里显示中文名」
  在今天这个形状下做不到——除非改上游 `PromptInputV2Popover`。已记缺口表。

---

## T008 出参 · 最小可用右栏会话（2026-10-07）

### 产物（6 处产品码 ＋ 1 处测试预载修复；其中 3 个新文件带测试、1 个新文件是薄接线）

| 文件 | 是什么 | 用例 |
|---|---|---|
| `ai-session/route-session.ts` | 从路由路径解出会话 id。**为什么要它**：右栏挂在 shell 层（`ThreePane.right`），而 shell 在所有路由**之上** ⇒ 它拿不到 `:id` 路由参数 | 10 条 |
| `ai-session/right-pane-source.ts` | 「路由 → 会话 id → 那个会话的目录 → 那个目录的会话数据」那条**异步链**（含**代次**防竞态 ＋ `ready` 三样齐） | 9 条 |
| `ai-session/session-panel.tsx` | 右栏本体：**自挂** `DataProvider` ＋ `SessionTurn` 消息流 ＋ 会话行（切换 / ＋新会话）＋ 常用操作卡行 ＋ 抽屉入口 ▸ ＋ Hero 输入 | 18 条 |
| `ai-session/ai-session-slot.tsx` | 生产组装（读 `useLocation` / `useServerSync` / `useCenterTabs` 三份 context） | **0（缺口，见缺口表）** |
| `workspace/workspace-entry.tsx` | 新增 `right?: () => JSX.Element` **访问器** prop，接到 `ThreePane` 的 `right` 槽 | ＋3 条（该文件共 95 条） |
| `pages/layout-new.tsx` | 挂载点：`right={() => <AiSessionSlot />}` | —— |
| `solid-jsx.ts`（测试预载） | 修一条**假红**：Bun 的转译缓存把 `packages/ui` 的 `sprite.svg` 按 **JSX** 解析（见下「门禁」里那段 ⚠️） | —— |

### 2026-10-07 用户裁定五条（开工前问的，全按建议）

| # | 问题 | 裁定 |
|---|---|---|
| ① | `contexts`（T005 的上下文指令层）需要「中栏选中了什么」，而这个信号今天在仓库里不存在 | **本轮不接这一层** ⇒ 缺口表那条继续挂着，产源是 F6/F7 |
| ② | 会话「新建 / 切换」做成什么形态（§4.7.5 只写「走 SDK」，没写长相；原生 `SessionHeader` 依赖页面级 context） | **右栏自带的会话行** |
| ③ | 右栏的「当前会话」从哪来（全仓唯一的「当前会话」是路由参数，而右栏在路由之外） | **右栏自带**（从路由路径解 id） |
| ④ | 「＋ 新会话」本轮调不调 SDK `session.create` | **不调，只留接缝** |
| ⑤ | 右栏要一份「当前目录」才取得到数，而 shell 层拿不到 | **A′：解出会话 id，目录向会话要**（`session.lineage.resolve`） |

### 两条被实测推翻的事（都就地更正/落证据，不写成「本来就知道」）

**① `plan.md §②` 那句「`useSync()` / `useSDK()` 在 `WorkspaceEntry` 那一层已可用」——假的。**
两处都错：`SDKProvider`（`context/sdk.tsx`）挂在**路由层**（`app.tsx` 的 `ResolvedDraftRoute` 那一支，
渲染进**中栏**），不在 `SelectedServerProviders` 里；而 `useSync()` **根本不是 context**——它是
`context/sync.tsx` 里 `serverSync().ensureDirSyncContext(sdk().directory)` 的一层薄组合、**依赖 `useSDK()`**。
外壳层真正取得到的是 **`useServerSync()`**。⇒ 右栏写的是
`useServerSync().ensureDirSyncContext(<这个会话的目录>)`，而目录**向会话要**（裁定 ⑤）。
`plan.md §②` 已就地更正（`#002-06`）。

**② 我自己在 T008 写的 `right-pane-source.ts` 里有一个真缺陷：`onCleanup` 在 `.then` 里没有 owner。**
原写法把取数（`ensureDirSyncContext`）放在 effect 的 `.then` 回调里 ⇒ 探针实测（2026-10-07，
bun 1.3.14 ＋ solid-js 1.9.10）：**effect 体内 `getOwner()` 非空，同一个 effect 的 `.then` 里是 `null`**
（探针原文：`同步owner有？ true ｜then里的owner有？ false`，卸载后注册的回调**一条都没跑**）。
而 `createRefCountMap`（`utils/refcount.ts`，`ensureDirSyncContext` 用的就是它）**把释放动作写在
`onCleanup` 里** ⇒ 每换一次会话只**加**引用、从不减，目录同步上下文再也放不掉——**不报错、不变红**。
**修法**：`data` 由目录**派生**成 `createMemo`（取数发生在有 owner 的计算里），与 `context/sync.tsx`
的 `useSync()` 同形。有牙：变异 **M2**（改回 `.then` 写法）**恰红 1 条**。

### 变异验证（6 批注入，逐批「注入 → 跑 → 还原」）

| 注入 | 实得 | 类 |
|---|---|---|
| **M1** `workspace-entry.tsx` 的 `right={props.right?.()}` 换成 `right={undefined}` | **93 pass / 2 fail**——红的正是 T008 新加的两条（内容落在右栏、内容创建在 provider 之内）；**那条对照（不传 `right` ⇒ 右栏不在）照旧绿** | ① 恰红 |
| **M2** `right-pane-source.ts` 的 `data` 改回「effect 的 `.then` 里 `dataFor` ＋ 信号」 | **8 pass / 1 fail**——恰是那条「`onCleanup` 要真的跑」 | ① 恰红 |
| **M3** `ready` 不再等目录（`if (!id) return undefined` ＋ `dir ?? ""` ＋ `数据!`） | **8 pass / 1 fail**——恰是那条「目录还没解出来之前不算就绪」 | ① 恰红 |
| **M4** `session-panel.tsx` 的 `commands: 命令集` 换成 `() => []` | **16 pass / 2 fail**——`/` 唤起 ＋ 「继续打字真的在筛」；**那条对照（打普通字 ⇒ 弹层不开）照旧绿** | ① 恰红 |
| **M5** `session-panel.tsx` 摘掉自挂的 `DataProvider` | **2 pass / 16 fail**——凡是要挂载渲染的都当场抛（`SessionTurn` 要 `useData()`）；活下来的 2 条是**那条对照**（它本来就断言「不挂会抛」）与「空会话 ⇒ 零 turn」（没有消息就不渲染 `SessionTurn`） | **② 整组红**（据实记，不写成恰红，`#003-03`） |
| **M6** `session-panel.tsx` 抽屉入口的 `set抽屉开(true)` 改成 `(false)` | **16 pass / 2 fail**——恰是两条抽屉用例（入口开 / 关闭钮收） | ① 恰红 |

**M5 属 `#003-03` 的第 ② 类**：摘的是一个**全体依赖**的 provider，红得广是应该的；判据是那 2 条活下来的
**恰是应该活下来的**（对照 ＋ 无需渲染的边界），而不是「红得多就算数」。

**三条断言在写的过程中被改准了**（记下来，因为它们是「测试自己错」而不是「产品错」）：

- 「内容落在右栏」那条一度写成 `expect(host.querySelector("[data-slot='three-pane-left']")).toBeNull()`
  ⇒ **整轮 `bun test` 挂死**（EXIT=124）。根因是 `#005-01`：左栏**存在**（模块默认 `project`）⇒ 断言失败，
  而实得值是**被 Solid 渲染过的节点**，bun 的打印器停不下来。**改法**：判据取**字符串**
  （`?.textContent ?? ""`），并用一个**本页不可能撞车的标记**（否则「不在左栏」会因为侧栏本来就有
  「会话」两个字而假红）。
- 「会话行取 `layer-01`」那条一开始只钉了正向；补上**对照**（展开的列表必须是白底）才算数（`#005-07`）。
- `/` 那条补了一条**对照**（打普通字 ⇒ 弹层不开）——只写正向的话，「浮层恒开」也能过。

### 门禁（2026-10-07 实测，**串行**跑；`#003-01`）

| 门 | 结果 |
|---|---|
| `packages/app` 组件档（`bun run test:components`，34 文件） | **569 pass / 0 fail** |
| `packages/app` 单元档（`bun run test:unit`，125 文件） | **964 pass / 0 fail** |
| `ai-session` 全目录（browser 条件，9 文件） | **109 pass / 0 fail**（T007 基线 72 ⇒ T008 ＋37） |
| `workspace-entry.test.tsx`（单文件） | **95 pass / 0 fail**（含 T008 的 3 条） |
| `bun run lint:openhive`（**仓库根**跑；`#004-10`） | **0 errors**；25 → **23 warnings**，且**本次新增/改动文件 0 命中**（判据按 `#001-02`；存量那 23 条在 `center/views`、`center/tab-bar.tsx`，非 006 引入） |
| `packages/app` 的 `typecheck`（`tsgo -b`） | **EXIT=0** |
| `layout-new.tsx` 那 1 条 `consistent-return` | **非本次引入**（`version()` 那段是 HEAD 原文，`git diff` 只有 1 行 import ＋ 1 个 prop）；且 `pages/` **不在** `lint:openhive` 的扫描范围里 |

⚠️ **一条工具链假红，记在这里免得下一个人重查**：跑 `workspace-entry.test.tsx` 时一度报
`Expected JSX element name but found "?"`，指向 **`packages/ui` 的 `sprite.svg` 第 1 行**——看着像
「上游资源坏了」，而 `git status` 干净、同一条链在别的测试文件里照样绿。**根因是 Bun 的转译缓存**
（`C:\Users\Administrator\.bun\install\cache\@t@\`）：登记了 bun 插件之后，那个 `.svg` 的 loader 判定
**不稳定，而且错的那次会被写进缓存**（清空缓存后第一次过、第二次起次次红）。
**判据**（认这条现场用）：把 `BUN_RUNTIME_TRANSPILER_CACHE_PATH` 指到一个**空目录**再跑 ⇒ 绿；用默认缓存
⇒ 红。**修法**：在 `packages/app/solid-jsx.ts` 里显式给 `.svg` 挂一个 `onLoad`（默认导出 ＝ 路径串，
`loader: "js"`，照 Vite 的资源导入语义）⇒ 缓存里存的就是我们返回的产物。修完**默认缓存连跑 3 次全绿**。

### 待落 LEARNINGS 的候选（**feature 收尾时**按模板整理，别丢）

1. **Bun 的转译缓存会在「登记了插件」的情况下把 `.svg` 按错 loader 缓存** ⇒ 假红指向上游资源，
   而 `git status` 干净。判据：`BUN_RUNTIME_TRANSPILER_CACHE_PATH` 指空目录跑 ⇒ 绿 ⇒ 是缓存不是代码。
   修法：在预载插件里显式给 `.svg` 挂 `onLoad`。
2. **`onCleanup` 需要一个 owner，而 effect 的 `.then` 回调里 `getOwner()` 是 `null`** ⇒
   `createRefCountMap`（`utils/refcount.ts`）的释放**永不执行**，引用计数只增不减（不报错、不变红）。
   判据：把「取数」放进有 owner 的**计算**（`createMemo`）里，并用一条「释放回调真的跑了」的用例钉住。
3. **`bun test --conditions=solid` 解析到的是 Solid 的 SSR 构建**（`dist/server.js`，响应式是**一次性**的）
   ⇒ 任何测响应式（`createEffect` / 换信号）的文件写成 `.test.ts` 会**假红**。落地：这类文件一律
   `.test.tsx`，由 `test:components`（`--conditions=browser`）跑，`test:unit` 的
   `--path-ignore-patterns` 把 `.test.tsx` 排除在外。（`solid-jsx.ts` 文件头有实测原文。）
4. **块注释里别写 glob**（`#004-06` 复发一次）：`right-pane-source.test.tsx` 文件头注释里差点写出
   `星号＋斜杠` 那条排除模式，会**当场闭合块注释**——已改成文字描述。
5. **镜像会抄错在「输入那一侧」，而抄错了照样读起来像忠实**（T009 第二轮 F1）：哨兵逐字抄了上游三条
   判定，唯独第 ③ 支抄的是「**上游吃饱之后**的那个形状」（整句 `$` 锚定），而上游真正吃的是切片
   `value.slice(0, cursor ?? value.length)`——`#003-05` 讲的是「镜像要能被上游变更惊醒」，这条讲的是
   **镜像连当下都没对上**。判据：**镜一个策略时，把「上游喂进去的那个表达式」逐字抄进注释**
   （本次漏的正是它；⚠️ 连 `?? value.length` 这种**兜底那一半也要抄**，第三轮 **N1** 就是漏了它；
   同一轮 **N2** 还指出「transition **产出** command」与「`interaction` 的 `execute` **执行**它」
   是两件事，别把两者说成「同一个 transition 里做的」）。
   验法：**构造一个只有正确形态才抓得住的输入**（本次 `查 @张三 记录`：错误写法对它有**全绿**＝**瞎**），
   两个形态各跑一遍对比。⚠️ 附带一条**判关系**的方法（第三轮反推出 **N4**）：把两个形态的
   命中集合各列出、**比出包含关系**——本次旧写法是新写法的**真子集** ⇒ 它**只可能漏报、不可能误报**，
   而我当时顺手写的「另一个方向会误报」**是错的**。**「两个方向都会错」这句话本身要证**。
6. **夹具的「起手态」会替你挡掉一整条轴**（T009 第一轮 R1）：三条用例都从**空输入框**起手
   ⇒「替换」与「追加」实得值**逐字相同**，改产品码为追加时 **21 pass / 0 fail**。
   判据：写「行为 X」的断言时先问「**如果实现变成它的反面 Y，这条会红吗**」；不会红就说明夹具
   把那一轴盖住了（本次修法是**先在框里打半句**再点卡，并断言**恰好相等**而不是 `toContain`）。
   ⚠️ 反面：**断言比注释弱**时（`#005-15`）注释就会变成「没人验的承诺」——本次那条注释写着
   「R1 已补」，而**补的那条**必须自己去变异证一遍才算数。

### 交接

- **T009** ✅ **已收**（见下「T009 出参」）：`activePrompt` / `onPick` 两个接缝已接进右栏，
  测试 ＋5 条（`session-panel.test.tsx` ＋4 ／ `capabilities.test.ts` ＋1），**审查三轮**；
  ⚠️ **但**留了两笔给下一层，见「T009 出参」的交接 ＋ 缺口表（`ContextCards` 未接线 / 卡文案形状约束）。
- **T010**（AI 执行 ＋ 过程展示）：`onSubmitPrompt` 的接收方就是它（真正调 SDK `session.prompt`）。
  右栏今天把正文交出去（`controller.value()`）而**没人接** ⇒ 回车什么都不会发生。
  ✅ **开工前取数（2026-10-07，T009 收尾时顺手核的）**：这条**打得到**——外壳层能拿
  `useServerSDK()`（`packages/app/src/context/server-sdk.tsx` 导出 `use`，`ServerSDKProvider` 在
  `SelectedServerProviders` 里，是 `NewLayout` 的祖先），**与 T008 那条实测不冲突**：取不到的是
  `useSDK()`（它在**路由层**）。既有调用先例：`packages/app/src/components/prompt-input/submit.ts`。
  ⚠️ 但**别照抄 `submit.ts`**：它整条链挂在页面级 context 上（`usePromptInputV2Controller` 那九个），
  要按被调方的签名重核（`#004-07`）；且 `protocolKind()` 决定 `session.prompt` 的形状（v1/v2 两支）。
- **F6 / F7 收**（`#002-04`）：两笔——① `contexts` 的产源（中栏选中）＝ 上下文指令层在生产里能不能显示，
  取决于它；② **`MANIFESTS` 的 `cards`**＝今天全为空 ⇒ 指令卡行在生产里**是空的**（没卡可点）
  （T009 出参里如实记了这条）。
- **T013**：`session-panel` 这 **22** 条已经在（T008 的 18 ＋ T009 的 4），**别再写一遍**——
  该做的是换一份注入的清单 / 数据跑。

---

## T009 出参 · 点指令卡 ＝ 填入一句话（2026-10-07）

### 产物（2 处产品码 ＋ 2 处测试；**没有新文件**）

> ⚠️ 后两行是**审查之后**才加进来的（第一轮的表格只写了前两行）。写在这里而不是另开一节，
> 是为了让产物表**一处说全**——否则下一个读的人会以为本条只动了 `session-panel.tsx`。
> 后两行在**第二轮 F1 又被改过一次**（哨兵第 ③ 支由整句 `$` 锚定改成**存在性**判定、注释与用例名
> 一并改正）：**落到这 4 个文件上的改动 = 实现 1 轮 ＋ 审查 3 轮**，别只按第一版读。

| 文件 | 是什么 | 用例 |
|---|---|---|
| `ai-session/session-panel.tsx` | 把 `activePrompt={controller.value()}` 与 `onPick={…dispatch…}` 接给 `<CommonCards>`。**这是 T004 📥 交来的那一笔的兑现**——两个 prop 在 T004/T005 就在了（组件层断言在 `common-cards.test.tsx` / `context-cards.test.tsx`），缺的从来不是接缝本身，是**右栏把不把它接上** | 该文件共 **22** 条（T008 的 18 ＋ 本条 4） |
| `ai-session/session-panel.test.tsx` | ＋4 条（新 describe「点指令卡 ＝ 填入一句话」；**第 4 条是审查 R1 补的**——旧 3 条都从**空输入框**起手，而空框下「替换」与「追加」实得值逐字相同 ⇒ 三条合起来也认不出追加）；另把 `打字` 助手从 describe 内**提到模块级**（T009 起两组用例都要它——留一份，别抄第二份） | ＋4 |
| `ai-session/capabilities.ts` | **审查 R2 补的**：`InstructionCard.prompt` 的 JSDoc 加「文案形状约束」（状态机那三个特殊分支）。**纯注释、零逻辑改动**——它是本条**第二个产品码文件**，写进产物表免得这里少算一处 | — |
| `ai-session/capabilities.test.ts` | **审查 R2 补的**：＋1 条报警哨兵「卡文案不落状态机的三个特殊分支」，与 T005 那两条**同型**（今天 `cards` 全空 ⇒ **空转**，管 F6/F7 加卡那一天）。已用**变异**证过三条正则**各自是活的**（见下「审查」节） | ＋1 |

### 为什么填入走 `dispatch({ type: "input.changed" })`，不是自己拼 `PromptInputV2Prompt`

`machine.ts` 的 `inputChanged` 收到它就会发 `{ type: "draft.setText", value }`——**`/` 与 `@` 两个
原生入口用的就是这条道**（`openCommands` / `openContext` 都发同一个命令），store 的 `setText` 连
**游标**都替我们摆好。自己拼 part 形状是把「一段文字长什么样」在第二处再写一份（`LEARNINGS #002-06`），
而且拼错游标**不报错、不变红**，只是光标位置怪。取数：`packages/session-ui/src/v2/components/prompt-input/`
的 `interaction.ts`（`execute`）＋ `machine.ts`（`inputChanged`）＋ `store.ts`（`setText`）。

### 为什么 `activePrompt` 取「输入框的**实时值**」，不另立一个「点过哪张」的信号

按 `DESIGN.md §4.7.1` 的定义，选中态的判据**就是相等**——「输入框里那句话来自这张卡」。
另立一个点击时 `set` 的信号 = 同一件事的两处写法（`#002-06`），且症状是**卡还亮着而输入框里
已经不是那张卡的句子**（用户改一个字之后）。§4.7.1 末尾那句 ⚠️ 点名的正是「输入框一改就掉」——
本实现**就是**「一改就掉」，且把它写成了**期望**（那条用例的自我描述里说明了理由）。
⇒ 若设计侧要改成「填过就一直亮」，**红的就是那条用例**（这是有意的）。

### 定型：填入是**替换**输入框的文字，不是追加

`store.ts` 的 `setText(content)` 把**整个 text part 换掉**（`prompt.filter((p) => p.type !== "text")`
只留下图片 / 提及那些**非文本** part），游标摆到 `content.length`；同一个文件里另有 `addText(content)`
＝ **在游标处插入**。选了前者。

这不是随手挑的：§4.7.1 的选中态判据是**相等**（「输入框里那句话来自这张卡」），若为追加，则在
「用户已经打过字」这个常见情形下相等**永不成立** ⇒ 选中态成了一条**永不命中的分支**，正是 §4.7.1
那句 ⚠️ 要避免的东西。

⚠️ 代价如实记：用户先打了一半、再去点卡 ⇒ **他已经打的那半句没了**（无确认、无撤销）。本轮按设计
原文落地（判据就是相等）；若设计侧要改成「追加」或「二次确认」，那是一次**设计裁定**，落点就是审查
R1 补的第 4 条用例（先打字再点卡、断言 `toBe` 卡片句子）——它会**红**，这正是它该有的样子。

### 变异验证（4 批注入，逐批「注入 → 跑 → 还原」；`#003-03` 三类如实记）

| 注入 | 实得 | 类 |
|---|---|---|
| **M1** `activePrompt={controller.value()}` → `{undefined}` | **20 pass / 1 fail**——恰是「点卡 ⇒ 那张亮浅金」 | ① 恰红 |
| **M2** `onPick` → `undefined` | **18 pass / 3 fail**——三条全红。⚠️ 但**第 3 条红在它的前置**（「点卡填进去」那半句）上，**不是**红在它自己要测的那条 ⇒ **M2 不能当第 3 条有牙的证据**（`#003-03` 第 ② 类：红得不够 ≠ 没价值，但必须据此改写它**声称**的作用） | ② 整组红 |
| **M3** `activePrompt` 换成「点击时 `set` 的信号」（`createSignal` ＋ `set已选(卡.prompt)`） | **20 pass / 1 fail**——正是第 3 条，前两条照绿 | ① 恰红（**这才**是第 3 条的牙：它是「实时值 vs 快照」的探测器） |
| **M4** `onPick` 恒填**第一张**卡 | **18 pass / 3 fail**——红在「点了哪张」上（点第二张却点亮/填进第一张） | ② 整组红 |

**审查轮另跑的 3 批**（逐批见下「T009 审查」，都在同一条「注入 → 跑 → 还原」下做的）：

| 注入 | 实得 | 类 |
|---|---|---|
| **R1** `onPick` → 在游标处**追加**（`controller.value() + 卡.prompt`） | **21 pass / 1 fail**——红的恰是 R1 补的第 4 条，实得 `"先打的半句帮我画关系图谱"`；**旧三条照绿** ⇒ 坐实「旧三条认不出这一轴」 | ① 恰红 |
| **R2** 往 `MANIFESTS` 塞三张各落一支的畸形卡 | **8 pass / 1 fail**——哨兵把三张**逐张列出** ⇒ 三条 OR 项**各自是活的** | ① 恰红 |
| **F1** 只换哨兵第 ③ 支的写法、塞**只有新写法抓得住**的那张卡（`查 @张三 记录`） | 旧写法（带 `$`）**9 pass / 0 fail＝瞎**；新写法 **8 pass / 1 fail**，实得 `["变异D → 查 @张三 记录"]` | ① 恰红（**这一批是修完 F1 之后补的自证**，也是「旧写法为什么必须换」的直接证据） |

### 门禁（2026-10-07 实测，**串行**跑；`#003-01`）

| 门 | 结果 |
|---|---|
| `ai-session` 全目录（browser 条件，9 文件） | **114 pass / 0 fail**（T008 基线 109 ⇒ T009 ＋5） |
| `packages/app` 组件档（`bun run test:components`，34 文件） | **573 pass / 0 fail**（T008 基线 569 ⇒ ＋4） |
| `packages/app` 单元档（`bun run test:unit`，125 文件） | **965 pass / 0 fail**（T008 基线 964 ⇒ ＋1：审查 R2 的哨兵，`capabilities.test.ts`） |
| `packages/app` 的 `typecheck`（`tsgo -b`） | **EXIT=0** |
| `bun run lint:openhive`（**仓库根**跑；`#004-10`） | **0 errors**；**23 warnings**（= T008 基线，未增），且**本次改动文件 0 命中**（判据 `#001-02`） |

⚠️ 上表是**三轮审查的改动全部落定之后**重跑的一次（不是第一版实现的快照，也不是 F1 一处的快照）：
哨兵的正则与两处注释改过之后，三档数字**一个都没动**（`ai-session` 仍 **114 / 0 fail**）。
⚠️ 判据是 `#001-02` 那条：**看「本次改动文件 0 命中」，不看总数**——本次 `grep ai-session` 在 lint
输出里**只命中 oxlint 回显的那行命令**（即那条命令的七个目录参数），**告警里 0 命中**。

⚠️ **第一遍 lint 是 26 条（多 3 条），命中的正是我新写的那三行**——`卡们(宿主)[1]!.click()` 的 `!`：
数组下标本就不带 `undefined`（本仓未开 `noUncheckedIndexedAccess`）⇒ `typescript-eslint(no-unnecessary-type-assertion)`
报「断言多余」。**修法**：收成一个点了名说第二张的动作 `点第二张卡(宿主)`（顺带把「点的是第几张」
写进名字里，读的时候不必逐句确认）。⇒ 回到 23 条。**这条不是洁癖**：`lint:openhive` 是 **warn 级**
（退出码恒 0），判据只能是「本次改动文件 0 命中」，多出来的 3 条**只有这一条判据能抓住**。

⚠️ **一条无关噪音，记在这里免得下一个人重查**：`test:components` 的 stderr 里有一段 happy-dom 的
`NetworkError: Failed to execute "fetch()" … http://xn--nqqs3etzam25g/ ECONNREFUSED`。**非本次引入**：
① 该轮 **0 fail**（它是被某个用例容错的真 fetch）；② 单独跑 `ai-session` 全目录**无此噪音** ⇒ 它出自
别的文件。**没有去改它**（不属于本条范围，且 `#002-06` 那条纪律讲的是「改一处要 grep 全部同类」，
不是「顺手修无关注噪」）。

### T009 审查（2026-10-07，三轮）

#### 第一轮：对抗审查（subagent；报 **2 条 Minor**，其余 6 项逐条核过、干净）

| 编号 | 类别 | 落点 | 描述 | 优先级 |
|---|---|---|---|---|
| R1 | 韧性（测试覆盖） | `session-panel.test.tsx` 原有那 3 条 | 三条都从**空输入框**起手 ⇒ 分辨不出「替换」与「追加」（空框下两种实现实得值**逐字相同**）。它实测：把 `onPick` 换成在游标处 append ⇒ **21 pass / 0 fail，三条全绿** | Minor |
| R2 | 防御性 / 边界 | `session-panel.tsx` 的 `onPick` | 走 `input.changed` 就继承状态机三个旁支：整句 `!`（切 shell **且清空正文**＝**静默丢字**）／整句 `/…`（弹 `/` 面板）／尾随 `@…`（弹 `@` 面板）。今天 `cards` 全空 ⇒ **潜伏**，但缺口表**没有这一条** ⚠️ 本行**照原报告留下**（`#002-06`：旧述不改写，但要标出来）——其中「**尾随** `@…`」这个措辞**不准确**，第二轮 F1 已改正为「行首或空白领起的 `@`」，理由见下 | Minor / 挂账 |

**它验过、值得留档的三条**（都是它自己实跑出来的，不是复述我的话）：

1. **上游侵入面 0 处**：`git diff --name-only` ＋ 未跟踪 0 ⇒ 改动只在 `packages/app/src/ai-session/`
   （没碰 `packages/session-ui/**` / `packages/ui/**` / `sql.ts` / `colors.css` / `oc-2.json`）。
2. **它独立设计的 4 批变异里，3 批复现了我的 M1/M2/M3**（数字逐条对上），第 4 批（`addPart` ＝ **追加**）
   **全绿** ⇒ **这就是 R1 的来源**（我的 M1–M4 里没有「替换 / 追加」这一轴）。它还抽验了我
   `state.md` 里的数字（112 ／ 21 ／ `EXIT=0` ／ 0 errors 23 warnings ／ 161 rules）**全部属实**。
3. **`onInput(value)` 与 `dispatch({type:"input.changed"})` 逐字等价**（`interaction.ts`，`prompt` 缺省
   ⇒ `persist: true`）⇒ 现写法不是「更绕的写法」；而 `draft.setText` 公开取不到、`machine.ts` 不在包的
   导出映射里 ⇒ **没有更短的路**。（审查结论：**不算缺陷**，保持现写法。）

**两条观察（未裁定、不计缺陷）**：

- **点卡后焦点不落进输入框**：`input.changed` 只发 `draft.setText`，**不发** `focus.editor`
  （`interaction.ts` 里只有另一条道 `editor?.focus()`）。FR-007 原文（`spec.md`）只写「点指令卡
  MUST = 填入一句话」，**未约定焦点** ⇒ 不算缺陷；若设计侧要「点完就能接着改」，这是要补的落点。
- **③ 支的触发取决于点击前的光标位置**（同一句 `查 @张三`：游标在句尾 ⇒ 弹 `@` 面板；游标在 0
  ⇒ 不弹）——已并入 R2 的文案约束里。

#### 第一轮的修法（两条都修；逐条「注入 → 跑 → 还原」）

**R1 ⇒ 补一条用例**（`session-panel.test.tsx` 新 describe 的第 4 条）：「点卡是**替换**、不是追加
（先打过字 ⇒ 只剩卡片的句子）」。判据取 **`toBe`（恰好相等）而不是 `toContain`**——用 `toContain`
的话「先打的半句 ＋ 卡片句子」照样通过，那就又变回一条认不出追加的断言了。两条断言按
`#004-14` 排序：先**被测属性**（编辑器 DOM 里剩什么），再**伴随信号**（选中态 `[false,true]`，
它是「store 里也只留了卡片那一句」的反证）。

- 实测（注入**追加**语义 `value: controller.value() + 卡.prompt`）⇒ **21 pass / 1 fail**，
  红的**恰是这条**，实得值 `"先打的半句帮我画关系图谱"` ⇒ 追加的可辨形状。**旧三条照绿**
  ⇒ 坐实「旧三条认不出这一轴」。还原后 **22 pass / 0 fail**。
- ⚠️ 这条用例的红**不依赖** DOM 同步的细节：先查过一个疑点——`prompt-input/index.tsx` 的
  `createEffect` 有个 `localInput` 守卫，但它是**一次性**的（DOM input 置位、effect 命中后即清）
  ⇒ 「先打字 → 再点卡」时它已复位，**程序化 `setText` 会真的重渲染 DOM**。

**R2 ⇒ 拦在「文案被写下的那一侧」，不在产品码里拦**：

- `capabilities.ts` 的 `InstructionCard.prompt` JSDoc 加「文案形状约束」（三个旁支的形状 ＋ 为什么
  不能自己再实现一遍那三条正则）。**纯注释、零逻辑改动**。
- `capabilities.test.ts` 加一条**报警哨兵**「卡文案不落状态机的三个特殊分支」——与 T005 那两条
  **同型**（今天 `cards` 全空 ⇒ **空转**，管的是 F6/F7 加卡那一天）。
- ⚠️ 哨兵里那三条正则**是镜像**（`#003-05`）：本意是逐字对着 `machine.ts` 的 `inputChanged` 写，
  注释里点名了上游函数与三条判定，并写明「**上游改了这三条，本处要跟着改**」。
  ⚠️⚠️ **但这一版里第 ③ 支并没有做到逐字**（第二轮 F1 实测）：它抄了整句 `$` 锚定，而**上游喂的是
  切片**（`value.slice(0, cursor ?? value.length)`）⇒ **对着「上游改了会惊醒」写下来的镜像，自己先抄错了一处**
  （`#005-15` 的另一面：镜像的每一支都得对着上游**逐个**核，不能只看整体形状像）。
- **变异证牙**：往 `MANIFESTS` 临时塞**三个形状各一**的畸形卡
  （`变异A → !` / `变异B → /分析` / `变异C → 查 @张三`）⇒ **8 pass / 1 fail**，红的恰是哨兵，
  且实得值把**三张逐张列出**（`["变异A → !", "变异B → /分析", "变异C → 查 @张三"]`）
  ⇒ 三条 OR 项**各自都是活的**（不是只有一条在起作用）。其余 8 条照绿 ⇒ 哨兵是隔离的。
  还原后 `MANIFESTS` 回到两个 `cards: []`、**9 pass / 0 fail**。
  ⚠️ **这一批的第三个样本是「尾随」形状**（`查 @张三`）＝**当时那版正则**抓得住的形状；F1 改正后
  新覆盖的那一类（**句中** `@`，如 `查 @张三 记录`）在这批里**没有样本** ⇒ 它由**后面 F1 那一批**
  （`变异D`）单独证。这处记账缺口是**第三轮 N3** 指出来的，已在此补齐（`#002-06`：文档里
  「已用变异证过」的范围要说准）。

#### 第二轮：针对修复本身的对抗复核（`#003-02`）—— **抓到 1 条真缺陷，长在我刚落的修复里**

`#003-02` 说的就是这件事：**「修完」≠「审完」，而新条目的高发地正是「上一轮的修复」**。这一轮报
**F1（Minor，必修）** ＋ **F2（Nit）** ＋ 一条观察（F3），其余逐条核过。

| 编号 | 类别 | 落点 | 描述 | 修复优先级 |
|---|---|---|---|---|
| F1 | **镜像不忠实（哨兵是假的）** | `capabilities.test.ts` 哨兵第 ③ 支（＋ `capabilities.ts` 同款理由） | ③ 对**整句**匹配（带 `$`），而上游对 `value.slice(0, cursor ?? value.length)` 匹配。我写的理由「填字时游标会被 `setText` 摆到句尾 ⇒ 两者等价」**讲错了时机**——判据读的是 `persisted.cursor`，那是**用户点卡前留下的位置**，与卡片句子的长度无关。⇒ `查 @张三 记录`（用户光标停在 5）上游**真的会弹面板**而整句写法**不命中** ⇒ **漏报** | **Minor（必修）** |
| F2 | 记述不实（轻） | `capabilities.ts` 的 JSDoc | 引用的哨兵用例名只写了**前缀**，不是逐字（`#004-03`：说「有 X 钉住」必须点名测试名） | Nit |
| F3 | 脆弱依赖（观察，不改） | `session-panel.test.tsx` 新用例 | 它的绿要求上游 `prompt-input/index.tsx` 那个**一次性** `localInput` 守卫被 `打字` 那一步消费掉 | 观察（记一笔） |

**F1 这条我没有直接采信——自己去源码把坐标读实了**（`#005-15`：别人的结论同样是待证断言）：
`machine.ts` 那一行是 `inputChanged(state, event.value, …, persisted.cursor)`，而 `interaction.ts`
的 `dispatch` 传给 `transitionPromptInputV2` 的 `persisted` **就是** `draft.state`
（`interaction.ts` 的 `transitionPromptInputV2(state, event, draft.state)`）⇒ **判据读的是用户上一次
留下的游标**，不是句子长度。审查方说的是对的。

**改法**：③ 去掉 `$`，改成**存在性**判定 `/(?:^|\s)@[^\s@]*/`（「句中出现行首或空白领起的 `@` 即算犯规」）
——把「**某些**游标位置会炸」按**最坏情形**收成一条静态约束。理由：**用户的游标停在哪，不是文案能规定的**。
段尾那个 `[^\s@]*` 对 `.test` 不起作用，留着只为让形状读起来与上游那一段一致。

**这次的牙是我自己跑出来的**（不再只引用复核方的探针）：往 `MANIFESTS` 塞进那张**旧写法会漏掉**的卡
`变异D → 查 @张三 记录`，**两版写法各跑一遍**——

- **旧写法（带 `$`）＋ 同一张卡 ⇒ 9 pass / 0 fail（瞎的，一个都不红）**；
- **新写法 ＋ 同一张卡 ⇒ 8 pass / 1 fail**，红的恰是哨兵，实得值 `["变异D → 查 @张三 记录"]`
  ⇒ **漏报这一侧闭合**。

两处都还原（`MANIFESTS` 回到两个 `cards: []`），复跑 **9 pass / 0 fail**。

**F2 一并修了**，顺带修了 F2 隔壁那处措辞：`capabilities.ts` 里把用例名改成**逐字全文**；把第 3 支的
形状描述从自相矛盾的「句中**尾随** `@xxx`」改成「句中出现**行首或空白领起的 `@`**……在某些游标位置」；
① 支补上上游那个 `state.mode === "normal"` 前提，并写明本处**故意不带**它（只会多报、不会漏报）。

**F3 记一笔、不改**（复核方也判不必改）：两个探针——**把守卫整段删掉 ⇒ 照样 22 pass**（绿不是守卫给的）；
**把守卫改成不复位 ⇒ 恰好这一条红**（实得值仍是 `"先打的半句"`）。⇒ 它**脆**，但**不瞎**。已把这条
结论写进那条用例的注释里，并写明「上游真动了那个守卫，先怀疑测量」（`#003-01`）。

**复核方另有一条如实标注**（记在这里，免得被读成「新用例更强」）：它跑的变异「永远填**第一张**卡」⇒
**18 pass / 4 fail**，新用例也在红的那 4 条里——但**那不是它的独有牙**：那一轴上本来就有三条旧用例守着。
新用例**唯一**的牙在**「写入语义＝替换还是追加」**这一轴（M4 的变异里也看得出来：红的三条与它无关）。
记这一笔是为了**别把「＋1 条用例」读成「＋1 条覆盖」**——它补的是**一条此前无人守的轴**，不是多一层保险。

#### 第三轮：针对 F1 修复的定点复核（`#003-02` 的递归：修完 F1 之后，把 F1 的修复再当靶子）

**口径**：不重复普查（第一/二轮已做），只打**两处**——① F1 换掉的那条正则**本身对不对**；
② 改过的那几段注释**逐句对不对**。报 **0 缺陷 ＋ 3 条 Nit**（N1/N2/N3 全修，见下）；
**第 4 条（N4）是它的实测反推出来的**——它那张「两个方向差集」表把我**第二轮自己写错的那半句**照了出来。

| 编号 | 类别 | 落点 | 描述 | 修复优先级 |
|---|---|---|---|---|
| N1 | 引文不逐字 | `capabilities.test.ts` 注释 ＋ `capabilities.ts` 的 JSDoc | 两处都把上游写成 `value.slice(0, cursor ?? value.length)`，**真身是 `value.slice(0, cursor ?? value.length)`**（`types.ts` 里 `cursor?: number`）。⚠️ **不改判定**：漏掉的正是「游标缺省 ⇒ 拿整句匹配」那一支，而那是存在性判定的**子集** | Nit（已修） |
| N2 | 时序措辞不准（结论对） | `capabilities.test.ts` 注释 | 「`setText` 在**同一个 transition 里**、分支判完之后摆游标」——transition 只**产出** `{type:"draft.setText"}` 这条 command，真正写 store 的是 `interaction.ts` 的 `execute`，**晚于** transition 返回 | Nit（已修） |
| N3 | 记账缺口（只报不动文档） | 本节 R2 的变异行 | 那一批的第三个样本 `变异C → 查 @张三` 是**尾随**形状（＝旧版正则抓得住的形状）⇒ F1 改正后**新覆盖的那一类**（句中 `@`）在那批里**没有样本** | Nit（已修） |
| **N4** | **自纠（我在第二轮写错的半句）** | 第二轮 F1 行 ＋ `capabilities.test.ts` 注释 | 我写的「`帮我查 @张三`（空框）整句写法命中 ⇒ **误报**」**是错的**：凡旧写法命中者都含「行首或空白领起的 `@`」⇒ 必命中新写法 ⇒ **旧写法是新写法的真子集**，只可能漏报、**不可能误报**（那句在游标 5/6/7 真的会炸）。**是第三轮那张「两个方向差集」表把我这半句照出来的**——它的假阳性集合为空，而按我的说法那里该有一条 | Nit（已修；**由第三轮的实测反推出来的自纠**，不是它直接点的） |

**A（最重要那一问）：新的存在性判定可靠吗？—— 不只是过近似，是最紧的那条。**
它用「**直调真实状态机** ＋ 文案 × 游标全枚举」对拍 19 个句子，**两个方向的差集都是空集**：

```
【假阴性】(真触发 而 正则不命中)   = []      【假阳性】(正则命中 而 真从不触发) = []
【③ 之外的副作用】= 只有 "!" 带来的 mode 切换 ⇒ ③ 自己只改 popover
[A2] "查 @张三 记录" 长度=8 触发游标=[3,4,5]      [A2] "查 @" 长度=3 触发游标=[3,4]
```

**这条我没有照抄它的结论——我自己把它当命题证了一遍**（结构性复核，比再跑一次探针更强）：
若句子含「行首或空白领起的 `@`」（位置 `j`），**取游标 `j+1`** ⇒ `slice(0, j+1)` 恰以 `@` 结尾、
`[^\s@]*` 匹配空串 ⇒ **必触发**；反过来，要触发就得让切片以 `@` 结尾且其前是行首或空白 ⇒
**整句必含该形状**。两个方向互为充分必要 ⇒ 正则与「∃ 游标会炸」**等价**（`A2` 的 `[3,4,5]` 正是
这个构造：3 ＝ `"查 @"`、5 ＝ `"查 @张三"`）。
⇒ 上一轮提的那个误报例子也一并落地：`帮我查 @张三` 被**新写法**判犯规，理由是「**某个**游标会炸」，
而它**真的**会炸（游标 5/6/7）⇒ **那不是误报，是真犯规**（旧写法判它犯规靠的是另一条错理由）。

**它自己又把 F1 的修复当靶子打了一次**（`#003-02` 的第二层）：临时塞一张**句中 `@`** 的卡
（`探针卡 → 查 @张三 记录`）⇒ **8 pass / 1 fail**，红的恰是哨兵、实得值逐字列出 `"探针卡 → 查 @张三 记录"`。
⚠️ 与**我**那次的数字不必相同（我这边没有挂探针块，实得 **9 pass / 0 fail** ⇒ 旧写法**一个都不红**；
它那轮带着自己的探针块，总数与红数因此不同）——**能对上的那条是判据本身**：**旧写法对这张卡不红**
＝瞎的，新写法恰红。

**B：注释逐句核过，除 N1/N2 两处措辞外全为真。** 取证里有两条值得留档：
① 它把 `capabilities.test.ts` 的 `test("…")` 名字与 `capabilities.ts` JSDoc 里引用的那串**提取出来做
diff** ⇒ `RESULT: 逐字符相同 (IDENTICAL)`（**F2 这才算真闭合**，不再靠「我抄的时候看着一样」）；
② 它逐字核了 `interaction.ts` 把 `draft.state` 当 `persisted` 传、`machine.ts` 取 `persisted.cursor`、
`store.ts` 的 `setText` 先写 `prompt` 再写 `cursor = content.length`（＝ F1 那条修法的**全部坐标**）。

**C：基线没坏**：`session-panel.test.tsx` **22 pass / 0 fail**；`capabilities.test.ts` **9 pass / 0 fail**。

**它自己声明的「工作区已还原」我独立验过**（`#005-15`：别人的「已还原」也是待证断言）：
`grep -rn "PROBE\|探针" packages/app/src/ai-session/` **零新命中**（只有既有注释里的「探针」二字）、
`git ls-files --others` **空**、`packages/session-ui` 与 `packages/ui` **不在 diff 里**、
`--numstat` 恰那 6 个文件。

---

## 缺口（**不是**「已覆盖」，别读错）

> 纪律：`LEARNINGS #002-02` —— 测不了 / 本机做不了的，**单列一行写「缺口」**，不写成「已覆盖」。

| 缺口 | 位置 | 说明 |
|---|---|---|
| **SC-004 的「有权」一半** | `spec.md` | 前端无授权输入 ⇒ 只对「可发现」负责；「有权可发现」依赖 009 的资产授权元数据 |
| **「收藏」排序因子** | FR-004 / T006 | 本轮不做，**已落 009 的 `tasks.md` 📥 块**（U8 → 009 T011） |
| **「最近使用」** | FR-004 / T006 | 若做只做本机权重，须写明降级形态（U8）；**服务端统计那一半已落 009 的 📥 块** |
| **「判定涉案」的判定逻辑** | T012 | AI 只提取/查证/预填，不替人下结论；判定本身属 **F6/F7**（U5） |
| **暗色无 `--v2-background-bg-accent-soft`** | `packages/ui` 的 dark 块 | 沿用 005 裁定（R2-09）：`DESIGN.md §6.2` 明写**不启用暗色** ⇒ **非本次引入**，继续挂账（U7） |
| **能力清单的「漂」已建网，但网只罩住「skill 集合」** | T002 | 旁路清单是**镜像**（`LEARNINGS #003-05`）。`capabilities.test.ts` 双向对账**文件系统里真实存在的 skill 名**（三条断言各自做过变异验证）⇒ 改名 / 新增 / 删除会红。**它不管**：① 描述文案改了对不上（本轮不钉，skill 描述不是判据）；② `packages/opencode/test/fixture/skills/` 下那两个上游**测试夹具** skill（口径是「扫 `.opencode/skills` 这一个目录源」，不是全仓 glob，故夹具天然在外）；③ 全局 skill 目录（`~/.config/opencode/skills`）——**跟机器走，不能进断言** |
| **frontmatter 只读 `name:` 一条正则** | `capabilities.test.ts` | 上游用真 YAML 解码器，这边只认单行 `name:`。**不为此加保护代码**——两个方向互相看着（真读漏 ⇒ 清单那条变「悬空」而红），故漏读会被另一种红抓住。已写进测试文件头 |
| **`SkillCapability.group` 的取值是占位** | `capabilities.ts` | skill 无分组 / 分类 / 标签元数据（实测）⇒ 今天两个 skill 都填「开发工具」，是 006 手填的。真来源 = 009 的业务分类 / 标签（已进 009 的 📥 块） |
| **`cards` 今天全为空** | `capabilities.ts` | 006 只造机制，卡片文案随模块（F6 / F7 / F9 落地时填）。今天两个 skill 是 opencode 开发工具链的，对民警无指令卡语义 ⇒ 编文案就是造数据。⚠️ **连带后果（T009 起口径更明确了）**：卡行为空 ＝ **T009 的「点卡填一句」与 §4.7.1 的选中态在生产里无从发生**——不是没接线，是**没东西可点**。所以 T009 的测试判据只能是「喂一份有卡的投影」（生产那条链上今天是空集） |
| **指令卡的 `context` 层触发条件未进类型** | `InstructionCard` | FR-003 的「随中栏选中浮现」取决于中栏当前上下文。**2026-10-07 T005 已就地兑现**（补 `context?: string` 可选字段 ＋ 注释 ＋ 两条报警断言）——**缺口已闭合**，此行留作出处，也是 006 那句 self-delegation（「T005 落地时把触发字段加进本类型」）的兑现记录 |
| **`contexts` 生产里必为空 ⇒ 上下文指令这一层在生产里必然不渲染** | T005 → T008 | **实测**（不是推断）：中栏**没有任何右栏读得到的「选中」状态**——`CenterTabState` 只有 `tabs` / `active` / `module`（`center/` 侧），`project/file-tree.tsx` 的选中行是组件**内部**状态。且 `MANIFESTS` 的 `cards` 全为空 ⇒ 就算喂了 `contexts` 也没卡可浮。今天测绿的是**纯组件**（喂夹具），**不是**「右栏能看到上下文指令」。真正的产源是 **F6 资金 / F7 话单**的中栏选中。**2026-10-07 T008 开工时按未定项问了，用户裁定「本轮不接这一层」** ⇒ `session-panel.tsx` 里**没有** `ContextCards`（喂恒空集＝把「这一层永远不显示」伪装成已接线，故宁可不接）。📤 **F6 / F7 收**（`#002-04`） |
| **`context` 的取值词表不由 006 定义** | `InstructionCard.context` | 同 `group` 那条：US2 场景 1 举的是「选中账户」「上传文件」，但真正的词表是各模块内容作者的（F6 / F7）。006 只钉一条能钉实的性质——「上下文层的卡必须带**非空**值」（报警断言），渲染层对畸形声明 **fail-closed** |
| **`capabilities.ts` 形状本次有变（006→009 契约）** | T005 → 009 | 加了一个**可选字段** `context`，**未**重塑类型。009 的 Prerequisites 把「F8 指令卡已落地」列为前置 ⇒ 009 落地时仍须按它自己的资产元数据复核一遍（本文件头也写着这条） |
| **U5 的两条依赖** | T011 / T012 | 「确定性走工具/代码执行路径」「高风险强制 ask」的落地依赖：007 / 008 的 `tasks.md` 接收方表 |
| **框架今天还没有生产调用点** | T003 → T008 | `projectCapabilities` 目前**仍只被测试调用**。T004 交给它的是 `cards` 这个 prop（组件本身能渲染了），但**没有任何生产代码把投影出来的卡喂进去**，整行也没挂进右栏 ⇒ 今天有一个「看上去已经能投影了」的错觉：测绿的是**纯函数 ＋ 组件**，**不是**「右栏能看到卡」。别把它读成「FR-002 已实现」。✅ **T008 已接线（2026-10-07）**：`ai-session-slot.tsx` 调 `projectCapabilities(MANIFESTS, center.module())`，一次投影喂四层（`SessionPanel` 的 `projection` 是**必填**，忘了传会红）。⚠️ **但**：① `MANIFESTS` 的 `cards` 今天全为空 ⇒ 生产里卡行**是空的**；② `contexts` 那一层按裁定 ① 不接。即「**接线通了、还没有内容**」 |
| **`activePrompt` 生产里恒为 `undefined`** | T004 → T009 | §4.7.1 的**选中态**靠它驱动（输入框那句话来自哪张卡就点亮哪张）。✅ **T009 已接线（2026-10-07）**：`session-panel.tsx` 传 `activePrompt={controller.value()}`（判据是**实时值**，用户一改就掉——§4.7.1 那句 ⚠️ 点名的正是它）。⚠️ **但**「接线通了」不等于「生产里看得见」：`MANIFESTS` 的 `cards` 全为空 ⇒ **今天没卡可点**（见下一条 `cards` 缺口） |
| **卡文案不能落状态机的三个特殊分支** | T009 审查 R2 → **F6 / F7 / F9 造卡时**回看 | 填入走 `input.changed`（`onPick`），那条道**自带三个旁支**：整句恰好 `!`（且 normal 模式）⇒ 切 shell 模式**且把正文清空**（点了等于没点、卡也不亮，**不报错**）；整句 `/^\/(\S*)$/` ⇒ 顺带弹 `/` 面板；句中出现**行首或空白领起的 `@`** ⇒ 顺带弹 `@` 面板。今天 `MANIFESTS` 的 `cards` 全空 ⇒ **潜伏**（真实中文指令句也不落这三支）。**不在产品码里拦**：拦＝把状态机那三条正则在本处再写一份（`#002-06`）⇒ 拦在**文案这一侧**：`capabilities.ts` 的 `InstructionCard.prompt` JSDoc 写了约束 ＋ `capabilities.test.ts` 一条**报警哨兵**（与 T005 那两条同型：今天空转，管加卡那一天；已用变异证过**三条正则各自是活的**）。⚠️ 那是**镜像**（`#003-05`）⇒ 哨兵的正则对着 `machine.ts` 的 `inputChanged` 写，**上游改了要跟着改**；且③支**不是**照抄——上游吃的是切片 `value.slice(0, cursor ?? value.length)`（`cursor` 可缺省，**第三轮 N1** 补齐了那半句引文），而 `cursor` 是**用户点卡前留下的位置**（不是句子长度）⇒ 哨兵按**最坏情形**收成「出现空白领起的 `@` 即犯规」（**第二轮 F1 改正**，第一版抄了 `$` ⇒ **会漏报**；第三轮另证这个存在性判定与「∃ 游标会炸」**互为充分必要**，既不漏报也不误报——详见「T009 审查」） |
| **「选完菜单收起」不可断言** | T004 / `MenuV2` | happy-dom 无 CSS 引擎 ⇒ Kobalte 的 `Presence` 等不到 exit 动画（实测 200ms 后菜单项仍在 `document.body`）。已断的是**本组件的契约**（「⋯」出现、菜单列出被收走的那几张、点项回调带对的卡）；**「收起」是 `MenuV2` 自己的行为**，未断，也没办法在此环境断（`#002-02`：测不了的写成缺口，不写成覆盖） |
| **`availableWidth` 尚无生产来源** | T004 → T008 | 本行自己会量（`ResizeObserver`，同 `center/tab-bar.tsx`；无该 API 时保持「还没量到」），但**整行今天没接进右栏** ⇒ 生产里不会真的发生溢出。接进 `ThreePane.right` 是 T008。✅ **T008 已接线（2026-10-07）**：**故意不传宽度**——卡行一挂进右栏就自己在量（转一手就多一个会漂的来源）；`session-panel.test.tsx` 有 1 条用例把「它观察的是卡行自己」钉住 |
| **`drawer` 的分组顺序** | `projection.ts` → T006 | **2026-10-07 已裁定：保持框架给的「首次出现顺序」，不排序** ⇒ T006 照搬输入顺序、一行排序都不加（已由变异 **M10** 钉住：加 `localeCompare` 当场红）。**T003 留下的那条未定项至此闭合**，此行留作出处 |
| **抽屉今天没被任何生产视图渲染** | T006 → T008 | 组件测绿 ≠ 民警能看到抽屉。本组件**零生产调用点**（`projectCapabilities` 本身也仍只被测试调用）。与 T004 / T005 那两条缺口同形：测绿的是**纯组件**，不是「右栏能开抽屉」。入口与挂载点都在 T008。✅ **T008 已接线（2026-10-07）**：入口 ▸（`session-tools` 行）＋ 开合状态都在 `session-panel.tsx`，本体 `<SkillDrawer>` 挂同一容器（`relative` 那一层） |
| **抽屉头部那一行是 self-decision** | T006 / `openhive-DESIGN.md §4.7.3` | §4.7.3 的表里**没有 header 这一格**（只写了组标题 / 条目两行 / 底面 / 圆角 / 阴影 / 行高 / 无图标）。本条的取法是**对齐原生右栏抽屉**（`components/help-button.tsx`：`h-[40px]` ＋ 下边框 ＋ `px-4` ＋ `IconButtonV2`／`xmark-small`＋`ghost-muted`），**不是设计给的** ⇒ T008 接进去时若它丑、或 §4.7 后续补写 header 规格，**以 DESIGN 为准**（宪法 §八：DESIGN.md 是视觉真理的单一来源） |
| **命令面板今天没被任何生产视图渲染** | T007 → T008 | 与「框架还没有生产调用点」「抽屉今天没被任何生产视图渲染」同形：`skillCommands` **零生产调用点**（全仓只有 `command-palette.test.tsx` 调它）。测绿的是**纯函数 ＋ 真实原生机器**，**不是**「民警在右栏打 `/` 能看到 skill」——那根线（把结果传进 Hero 输入的 controller `commands`）在 T008。✅ **T008 已接线（2026-10-07）**：`命令集 = createMemo(() => skillCommands(props.projection.all))` 传进 controller；`session-panel.test.tsx` 有 2 条＋1 条对照 |
| **列表里显示的是连接键，不是中文名** | T007 / 原生 `PromptInputV2Popover` | 实测定下来的：原生弹层**只渲染 `item.label`**（`index.tsx`：`<span>{item.label}</span>` ＋ `description`，**`title` 根本不显示**），而 `label` 同时决定「选中后插进正文的那串」⇒ 二者拆不开。2026-10-07 用户裁定取连接键（理由：插进正文的 token 要能让下游对回 skill）。**代价**：列表里民警看到的是 `/fund-link-analysis` 而非「资金关联分析」（`description` 仍是中文，且**打中文能搜到**）。要显示中文名只能改上游 `PromptInputV2Popover` ⇒ 与第一号约束冲突，**不改**；若将来要改，这是**可提上游**的一条 |
| **很散的子序列匹不上** | T007 / `fuzzysort` 默认阈值 | 实测：`/资金分析` 命中「资金关联分析」（跳过「关联」，**真子序列** ✅），而 `/flz` **不**命中 `fund-link-analysis`（f-z-l 之间隔太远）。**非本次引入**——上游自定义命令走的是同一个 `useFilteredList`，行为完全一致。**不改**（改阈值要动上游 `interaction.ts`，且会让匹配变噪声） |
| **`ai-session-slot.tsx` 无测试（薄接线）** | T008 | 它是**纯接线**（读三份 context、把结果交给上面两件），**没有分支、没有状态**；而 `useServerSync()` 的 provider 要一个**活着的服务器连接**才建得起来 ⇒ `bun test` 里挂不起来。按 `LEARNINGS #002-02`：**写成缺口，不写成覆盖**。它里面**真的会出错**的两件事都单独抽出来测了：① 「路由 → id → 目录 → 数据」那条异步链 ＝ `right-pane-source.test.tsx`（9 条）；② 投影 ＝ `projection.test.ts`。**未覆盖的是「这三份 context 名字接对了」**——名字接错的症状是右栏整栏不出现（`Show` 恒假）或当场抛，不会静默 |
| **`onSubmitPrompt` 生产里没人接** | T008 → T010 | 用户按回车的**终点**是 T010（真正调 SDK `session.prompt`）。`SessionPanel` 只把正文交出去（`controller.value()`），而 `ai-session-slot.tsx` **没传**这个 prop ⇒ 今天回车**什么都不会发生**。⚠️ `activePrompt` 那一半已由 **T009 接线**（选中态看得见了——前提是得先有卡）；空的这一半仍在 ⇒ **「点卡 → 一句话进输入框 → 回车」这条链今天断在终点** |
| **`ContextCards` 的两个 prop 还没有接线** | T005 → 待接 | `context-cards.tsx` 与 `common-cards.tsx` 是**同形**的（都吃 `InstructionCardRowProps`），T009 只接了 `CommonCards` 那一层。`ContextCards` **今天根本没被 `session-panel.tsx` 渲染**（T008 裁定「本轮不接这一层」，因为中栏没有右栏读得到的选中状态）⇒ 它的 `activePrompt` / `onPick` **不需要接线**，否则是死代码。**接线随 `contexts` 的产源一起来**（F6 / F7 把中栏选中喂进来时，照 `CommonCards` 那两行的样子加，别再发明一套） |
| **「＋ 新会话」只留接缝** | T008 / 用户裁定 ④ | 按钮调的是 `props.onNewSession?.()`，而生产侧**没传**（本轮**不调** SDK `session.create`）。同样地 `onSelectSession` 也没接 ⇒ **点会话列表不会真的切会话**（受控接缝的两头都待 T010 那一段落地） |
| **会话列表 = 注入数据的 `session`，本栏不自己拉** | T008 | 列表渲染的是 `props.data.session`（`For` 直接吃它），**不**调 `session.list`。故数据没同步到的那一瞬列表可能是空的（当前会话名会退回显示 id）。**不为此加保护代码**——T010 接 SDK 时若需要「主动拉一次列表」，那是那一条的决定 |
| **会话行的视觉是 self-decision** | T008 / `openhive-DESIGN.md §4.7.5` | §4.7.5 只写了「新建 / 切换走 SDK `session.create` / `session.list`」，**没写长什么样**（原生 `SessionHeader` 依赖页面级 context，搬不进来）。本条的取法是**对齐原生右栏抽屉那一档**（`layer-01` 底 ＋ `text-[13px]`），**不是设计给的** ⇒ 若 §4.7 后续补写这一格，**以 DESIGN 为准**（宪法 §八）。⚠️ 同时复核 `skill-drawer.tsx` 那条同型缺口（抽屉 header 也是照原生抄的） |

---

## 最后更新

2026-10-07（**T009 已完成**：点指令卡 ＝ 填入一句话。产物 **2 处产品码 ＋ 2 处测试、没有新文件**
（`session-panel.tsx` 把 `activePrompt` / `onPick` 接给 `CommonCards`；`capabilities.ts` 加**纯注释**的
文案形状约束）＋ **5 条用例**（`session-panel.test.tsx` ＋4，含审查 R1 补的「替换 vs 追加」；
`capabilities.test.ts` ＋1 条报警哨兵）；五道门禁全绿（ai-session **114**／组件档 **573**／单元档 **965**／
typecheck **EXIT=0**／lint **23 警告、0 errors、本次改动文件 0 命中**）→ 出参见上「T009 出参」。

**6 批变异 ＋ 2 批自证**：实现 4 批（3 恰红、1 批整组红——**M2 那条如实标了「不能当第 3 条有牙的
证据」**，它红在**前置**上，第 3 条的牙由 **M3** 单独证）＋ 审查 2 批（R1 追加式 ⇒ 恰红新用例；
R2 三张畸形卡 ⇒ 恰红哨兵且三条正则各自显形）＋ **F1 修复的双向自证**（旧写法对 `查 @张三 记录`
**9 pass / 0 fail＝瞎的**，新写法**恰红 1 条**）。

第一遍 lint 多出 3 条（**命中我新写的行**）⇒ 当场修掉（数组下标的 `!` 是多余的）。

**审查三轮**（`#003-02`）：第一轮 2 条 Minor 全修；**第二轮打到「我刚落的修复」里**——**F1 是我那条
哨兵本身是假的**（照抄上游的 `$`，而上游判的是 `value.slice(0, cursor ?? value.length)`，那个 `cursor` 是**用户点卡前
留下的位置** ⇒ `查 @张三 记录` 在光标 5 时上游真会弹面板而哨兵不命中＝**漏报**），已修 ＋ 自证；
第三轮定点复核 F1 的修复 —— **0 缺陷 ＋ 4 条 Nit**：N1（引文漏了 `?? value.length` 那半句）、
N2（说「在同一个 transition 里」把**产出 command** 说成了**执行**）、N3（旧变异批次缺「句中 `@`」
这一类的样本），＋ **N4 是我从它那张差集表反推出的自纠**：我第二轮顺手写的「另一个方向会误报」
**是错的**（旧写法是新写法的**真子集**，只可能漏报）。
**闭合缺口 1 条**（`activePrompt` 生产里恒为 `undefined`），**新增缺口 2 条**——①`ContextCards` 的同名
prop 今天不需要接线（那一层还没被渲染 ⇒ 接线随 `contexts` 的产源一起来，已按 `#002-04` 写清「谁接、
接在哪」）；②**卡文案不能落状态机的三个特殊分支**（拦在文案侧，不在产品码里再写一份判定）。

⚠️ 如实记一笔：**接线通了，但生产里今天没卡可点**（`MANIFESTS` 的 `cards` 全为空）。
**下一个 T010**——AI 执行 ＋ 展示过程（`onSubmitPrompt` 的接收方）。
