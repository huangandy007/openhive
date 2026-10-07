# 实施进度 · AI 会话（右栏指令卡）

## 当前任务

**U6 起草件已出，等用户审**：`docs/superpowers/specs/006-ai-session/design-draft-四层指令卡.md`
（未来的 `openhive-DESIGN.md` **§4.7**）。**T004 仍未开工**——起草件审过之前不许落任何视觉值。

⚠️ **T004 前面有一道门**（2026-10-07 裁定 U6 / runbook D0-5）：T004 是**第一个有视觉值的任务**，
而 `openhive-DESIGN.md` 里**还没有**「AI 会话 · 四层指令卡」那一节。**这一节由我先起草、交用户审过之后
才能落码**——参照物取样不到（`design-reference/figma-export/` 没有页面子目录、`front/RightAIChat`
不在本仓），规格只能对齐 `packages/session-ui` 原生组件 ＋ `theme.css` 的 token。
T003 之所以能先做，正因为它**一个视觉值都没有**（纯函数，无 JSX）。

**起草件里要请用户裁定的三件事**（详见该文件末尾的裁定表）：

| # | 事项 | 我的建议 |
|---|---|---|
| 1 | 原生 Hero 输入外壳是 `rounded-xl`＝**10px**，而 `DESIGN.md §3.1` 写「右栏对话 Hero 输入 12~16px」——**两边冲突**。取 (A) 沿用原生 10px 并改 §3.1 该行口径，还是 (B) 用 app 级 CSS 覆盖到 16px（正例：`dialog-command-palette-v2.css` 把原生 dialog 覆盖成 12px） | **(A)** |
| 2 | 右栏底面（拟 `bg-v2-background-bg-layer-01`）、卡面圆角（拟 8px，§3.1 的按钮档）、卡宽（拟 `w-24`＝96px）——三处 ⚠️ 待设计侧复核项 | 按草案 |
| 3 | 常用操作行内排序：「通用」清单的卡排模块自己的卡**前**还是**后**（T003 有意不钉，见 T003 出参） | **前**（常数在前才有肌肉记忆） |

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
- **U6 起草件**（2026-10-07）· `design-draft-四层指令卡.md`（未来的 `DESIGN.md §4.7`）→ 出参见下
  「U6 起草件出参」。**交用户审，未生效**——审过之后才移入 `openhive-DESIGN.md`，然后 T004 才能开工。
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

## U6 起草件出参 · `DESIGN.md §4.7`「AI 会话 · 四层指令卡」（2026-10-07）

**文件**：`docs/superpowers/specs/006-ai-session/design-draft-四层指令卡.md`（**草案，未生效**；
审过后移入 `docs/superpowers/specs/openhive-DESIGN.md` 作 §4.7，接在 §4.6 之后、同其写法）。

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
| **`cards` 今天全为空** | `capabilities.ts` | 006 只造机制，卡片文案随模块（F6 / F7 / F9 落地时填）。今天两个 skill 是 opencode 开发工具链的，对民警无指令卡语义 ⇒ 编文案就是造数据 |
| **指令卡的 `context` 层触发条件未进类型** | `InstructionCard` | FR-003 的「随中栏选中浮现」取决于中栏当前上下文，是 **T005** 的活；T005 落地时把触发字段加进 `InstructionCard` 并回填注释 |
| **U5 的两条依赖** | T011 / T012 | 「确定性走工具/代码执行路径」「高风险强制 ask」的落地依赖：007 / 008 的 `tasks.md` 接收方表 |
| **框架今天还没有生产调用点** | T003 | `projectCapabilities` 目前**只被测试调用**——右栏没有任何东西消费它（接线是 T004 / T008）。今天有一个「看上去已经能投影了」的错觉：测绿的只是**纯函数**，**不是**「右栏能看到卡」。别把它读成「FR-002 已实现」 |
| **`drawer` 的分组顺序未裁定** | `projection.ts` | 框架给的是**首次出现顺序**（不排序，理由写在那个私有函数的文档里：`group` 今天没有客观来源、排序要引中文排序规则）。抽屉要不要换个顺序是 T006 的渲染决定 |
| **`DESIGN.md §3.1` 与原生 Hero 输入的圆角冲突** | `openhive-DESIGN.md §3.1` | §3.1 写「右栏对话 Hero 输入 12~16px」，而原生 `prompt-input-v2` 外壳是 `rounded-xl`＝**10px**。起草件按 (A) 沿用原生并建议改 §3.1 该行口径；**裁 (B) 则要新增一处 app 级覆盖**。这是**已提交文档之间**的不一致，不是本 feature 引入的（等裁定） |

---

## 最后更新

2026-10-07（**U6 起草件已出**：`design-draft-四层指令卡.md`，交用户审。**T004 仍被这道门挡住**，
起草件里三件事待裁定——见「当前任务」表）
