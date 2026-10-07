# 实施进度 · AI 会话（右栏指令卡）

## 当前任务

**T006 已完成**（「更多 skill」抽屉，**只做「按 skill 分组」**；裁定 U8）→ 出参见下「T006 出参」。
**下一个：T007**（`/` 命令面板，模糊匹配 **skill 全集**）——它与 T006 消费的是**同一份输入**
（`projectCapabilities(...).all` / `drawer`），差别只在「匹配」与「呈现」：T006 分组列出，T007 输入 `/`
唤起 ＋ 模糊匹配。⚠️ **授权过滤不在前端**（裁定 U2：宪法 §四，执行层拦）。
⚠️ 视觉规格两处都在 `DESIGN.md §4.7`：T006 用到 §4.7.3，**T007 的那两行先读一遍再落码**。

📥 **T008 欠的那一笔**：抽屉的入口 ▸ 按钮 ＋ 开合状态归它（T006 是**受控面板**，`open` / `onClose`
就是给它留的接缝）——已落 `tasks.md` 的 T008 条。

⚠️ 写码时按 `DESIGN.md §4.7.0`（一行里的取用纪律）与 §4.7.1 / §4.7.2，不要凭记忆挑 token；
§4.7.0 末尾那条 ⚠️（**别把那张对照表照抄进源码注释**）是 T004 实测踩出来的。

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
| **指令卡的 `context` 层触发条件未进类型** | `InstructionCard` | FR-003 的「随中栏选中浮现」取决于中栏当前上下文。**2026-10-07 T005 已就地兑现**（补 `context?: string` 可选字段 ＋ 注释 ＋ 两条报警断言）——**缺口已闭合**，此行留作出处，也是 006 那句 self-delegation（「T005 落地时把触发字段加进本类型」）的兑现记录 |
| **`contexts` 生产里必为空 ⇒ 上下文指令这一层在生产里必然不渲染** | T005 → T008 | **实测**（不是推断）：中栏**没有任何右栏读得到的「选中」状态**——`CenterTabState` 只有 `tabs` / `active` / `module`（`center/` 侧），`project/file-tree.tsx` 的选中行是组件**内部**状态。且 `MANIFESTS` 的 `cards` 全为空 ⇒ 就算喂了 `contexts` 也没卡可浮。今天测绿的是**纯组件**（喂夹具），**不是**「右栏能看到上下文指令」。真正的产源是 **F6 资金 / F7 话单**的中栏选中。已落 📥 进 `tasks.md` 的 T008 条（`#002-04`） |
| **`context` 的取值词表不由 006 定义** | `InstructionCard.context` | 同 `group` 那条：US2 场景 1 举的是「选中账户」「上传文件」，但真正的词表是各模块内容作者的（F6 / F7）。006 只钉一条能钉实的性质——「上下文层的卡必须带**非空**值」（报警断言），渲染层对畸形声明 **fail-closed** |
| **`capabilities.ts` 形状本次有变（006→009 契约）** | T005 → 009 | 加了一个**可选字段** `context`，**未**重塑类型。009 的 Prerequisites 把「F8 指令卡已落地」列为前置 ⇒ 009 落地时仍须按它自己的资产元数据复核一遍（本文件头也写着这条） |
| **U5 的两条依赖** | T011 / T012 | 「确定性走工具/代码执行路径」「高风险强制 ask」的落地依赖：007 / 008 的 `tasks.md` 接收方表 |
| **框架今天还没有生产调用点** | T003 → T008 | `projectCapabilities` 目前**仍只被测试调用**。T004 交给它的是 `cards` 这个 prop（组件本身能渲染了），但**没有任何生产代码把投影出来的卡喂进去**，整行也没挂进右栏 ⇒ 今天有一个「看上去已经能投影了」的错觉：测绿的是**纯函数 ＋ 组件**，**不是**「右栏能看到卡」。别把它读成「FR-002 已实现」 |
| **`activePrompt` 生产里恒为 `undefined`** | T004 → T009 | §4.7.1 的**选中态**靠它驱动（输入框那句话来自哪张卡就点亮哪张）。今天它是**测试专用接缝**——「点卡片 = 填入一句话」是 T009 的活 ⇒ **选中态在生产里还看不见**。已按 `#002-04` 落进 `tasks.md` 的 T009 条 |
| **「选完菜单收起」不可断言** | T004 / `MenuV2` | happy-dom 无 CSS 引擎 ⇒ Kobalte 的 `Presence` 等不到 exit 动画（实测 200ms 后菜单项仍在 `document.body`）。已断的是**本组件的契约**（「⋯」出现、菜单列出被收走的那几张、点项回调带对的卡）；**「收起」是 `MenuV2` 自己的行为**，未断，也没办法在此环境断（`#002-02`：测不了的写成缺口，不写成覆盖） |
| **`availableWidth` 尚无生产来源** | T004 → T008 | 本行自己会量（`ResizeObserver`，同 `center/tab-bar.tsx`；无该 API 时保持「还没量到」），但**整行今天没接进右栏** ⇒ 生产里不会真的发生溢出。接进 `ThreePane.right` 是 T008 |
| **`drawer` 的分组顺序** | `projection.ts` → T006 | **2026-10-07 已裁定：保持框架给的「首次出现顺序」，不排序** ⇒ T006 照搬输入顺序、一行排序都不加（已由变异 **M10** 钉住：加 `localeCompare` 当场红）。**T003 留下的那条未定项至此闭合**，此行留作出处 |
| **抽屉今天没被任何生产视图渲染** | T006 → T008 | 组件测绿 ≠ 民警能看到抽屉。本组件**零生产调用点**（`projectCapabilities` 本身也仍只被测试调用）。与 T004 / T005 那两条缺口同形：测绿的是**纯组件**，不是「右栏能开抽屉」。入口与挂载点都在 T008 |
| **抽屉头部那一行是 self-decision** | T006 / `openhive-DESIGN.md §4.7.3` | §4.7.3 的表里**没有 header 这一格**（只写了组标题 / 条目两行 / 底面 / 圆角 / 阴影 / 行高 / 无图标）。本条的取法是**对齐原生右栏抽屉**（`components/help-button.tsx`：`h-[40px]` ＋ 下边框 ＋ `px-4` ＋ `IconButtonV2`／`xmark-small`＋`ghost-muted`），**不是设计给的** ⇒ T008 接进去时若它丑、或 §4.7 后续补写 header 规格，**以 DESIGN 为准**（宪法 §八：DESIGN.md 是视觉真理的单一来源） |
| **`DESIGN.md §3.1` 与原生 Hero 输入的圆角冲突** | `openhive-DESIGN.md §3.1` | §3.1 原写「右栏对话 Hero 输入 12~16px」，而原生 `prompt-input-v2` 外壳是 `rounded-xl`＝**10px**。**2026-10-07 已裁 A 并就地改口径**（「沿用原生外壳的 10px」）——**缺口已闭合**，此行留作出处。这是**已提交文档之间**的不一致，不是本 feature 引入的 |

---

## 最后更新

2026-10-07（**T006 已完成**：「更多 skill」抽屉，**只做按 skill 分组**（裁定 U8），入口 ▸ 归 T008
→ 出参见上「T006 出参」（21 批注入 ＋ 1 批反向 ＋ 2 批报警验证逐条实测 ＋ 五道门禁；**闭合 1 条**
——T003 留下的「`drawer` 顺序未定」；**新增 2 条**缺口，其中一条是本条的 self-decision 待复核）。
**下一个 T007**——`/` 命令面板，模糊匹配 skill 全集（裁定 U2：前端不做授权过滤）；
它与 T006 同一份输入，差别只在「匹配 ＋ 呈现」）
