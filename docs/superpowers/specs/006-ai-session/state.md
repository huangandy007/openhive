# 实施进度 · AI 会话（右栏指令卡）

## 当前任务

T001 已完成（Phase 1 Setup 的「定位」半条）。**下一个：T002**（skill 能力清单声明接口）。

## 已完成

- **T001**（2026-10-07）· 定位原生右栏会话 + 会话管理真实入口 → 出参见下「T001 出参」。
  连带把**被 T001 证伪的 plan/spec 旧述就地更正**（`#002-06`：改一处就 grep 全部同类）。
- **T001 补测**（同日）· 追加第 7 条：**右栏不在路由 `DataProvider` 的子树内**（它是 `WorkspaceEntry` 的
  **后代**，不是祖先）⇒ 右栏须自挂一份，且 `useSync()`/`useSDK()` 在外壳层已可用、故可行。
  ⚠️ 这条是**查实**得出的，不是推断（`#004-13`：判「做不了 / 做得成」都要先验）。
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

## 缺口（**不是**「已覆盖」，别读错）

> 纪律：`LEARNINGS #002-02` —— 测不了 / 本机做不了的，**单列一行写「缺口」**，不写成「已覆盖」。

| 缺口 | 位置 | 说明 |
|---|---|---|
| **SC-004 的「有权」一半** | `spec.md` | 前端无授权输入 ⇒ 只对「可发现」负责；「有权可发现」依赖 009 的资产授权元数据 |
| **「收藏」排序因子** | FR-004 / T006 | 本轮不做，**挂 009**（U8） |
| **「最近使用」** | FR-004 / T006 | 若做只做本机权重，须写明降级形态（U8） |
| **「判定涉案」的判定逻辑** | T012 | AI 只提取/查证/预填，不替人下结论；判定本身属 **F6/F7**（U5） |
| **暗色无 `--v2-background-bg-accent-soft`** | `packages/ui` 的 dark 块 | 沿用 005 裁定（R2-09）：`DESIGN.md §6.2` 明写**不启用暗色** ⇒ **非本次引入**，继续挂账（U7） |
| **能力清单的「真值来源」** | T002 | 旁路清单是**镜像**（`LEARNINGS #003-05`）⇒ 必须写成**会被上游变更惊醒**的样子；009 落地后须复核形状 |
| **U5 的两条依赖** | T011 / T012 | 「确定性走工具/代码执行路径」「高风险强制 ask」的落地依赖：007 / 008 的 `tasks.md` 接收方表 |

---

## 最后更新

2026-10-07（T001 收尾；裁定 U1–U10 全部落表）
