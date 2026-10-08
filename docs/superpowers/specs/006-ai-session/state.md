# 实施进度 · AI 会话（右栏指令卡）

## 当前任务

**Step 5（代码审查）之后的修复期**。**16 条 task（T001–T016）全部完成**；Step 5 审出
**7 条 Important**，用户裁定**全修**。进度：

| 批 | 内容 | 状态 |
|---|---|---|
| （一） | D1 / R-01 / ④-1 / F-01 / F-02（5 条） | ✅ 已提交 `5a228efd90` · 出参见「Step 5 出参（一）」 |
| （二） | **②-1**（右栏整条会话链落沙箱根 ⇒ **B：cookie 通道**） | ✅ 已提交 `3ebe26da43` · 出参见「Step 5 出参（二）」 |
| （三） | **第二轮对抗性验证**（五席只读审查打在 `e972d14f44..HEAD` 上）⇒ **1 条 Important**（cookie / 信号刷新后分叉，三席独立命中）＋ 若干注释/文档不实；用户裁定 **B：启动清掉 cookie** | ✅ 已修 · 见「Step 5 出参（三）」 |
| **T016** | **D2：右栏导出会话入口**（复用上游 `utils/session-export.ts` 三件套） | ✅ 已完成 · 见「T016 出参」 |
| **Step 6** | **收尾**：final commit（信息带 `Closes 006-ai-session`）＋ `session.md` 重写 ＋ 缺口表补行 ＋ `LEARNINGS` 补 4 条（`#006-01`…`#006-04`）＋ 门禁在最终状态上串行复跑 | ✅ **已完成（2026-10-08）** · 见「最后更新」与同目录 `session.md` |

⇒ **本 feature 已收尾**，无待办 task。**merge / tag 由用户在主检出里跑**
（`git merge --ff-only worktree-feat-006-ai-session` ＋ `git tag v0.1.0-006-ai-session`）
——本 worktree 只做了最终提交。**交付摘要与门禁基线看 `session.md`**（同一目录）。

⚠️ **第二轮留了两笔给 T016 / 收尾**：① **裁定 B 的残余＝多标签页**（cookie 全浏览器共享，三种修法都
修不到，见缺口表）；② **「挂载即清」仰赖一条上游事实**（`NewAppLayout` 在路由根里 ⇒ SPA 不重挂），
**今天没有断言钉着**——两笔都在缺口表里，别当成「分叉已根除」。

⚠️ **②-1 那条改动的形状值得记住**：它是本 feature **唯一一条把「环境信号」当通道**的改动——头是
**意向**（无效就**拒**），cookie 是**环境**（无效就**当没有**）。这条语义差别**不写在类型里**，只写在
中间件文件头的「第四笔裁定」；改那条链之前**先读那一段**。

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
- **T010**（2026-10-07）· AI 执行 ＋ 展示过程（FR-007 / US4 场景 1）→ 出参见下「T010 出参」。
  新建 `submit-prompt.ts` ＋ `submit-prompt.test.ts`（12 条）＋ `packages/opencode/test/server/
  openhive-prompt-minimal.test.ts`（真链 1 条）；改 `session-panel.tsx` / `session-panel.test.tsx` /
  `ai-session-slot.tsx`；**8 批变异 ＋ 1 批反向**（M8 报「无牙」⇒ 改注释挂账，不补测试）。
  ⚠️ **本条漏记在「已完成」里，2026-10-07 补**（T011 收尾时核账发现的——出参节当时写了，
  这一节忘了加）。两处**推翻继承推断**：U6 的「右栏 `/skill` 会把命令名当正文发」**是错的**
  （会真的执行该 skill）；另一条写进注释的推断也**已删改挂账**（`LEARNINGS #003-04`）。
- **T011**（2026-10-07）· AI 不滥用确定性事（FR-008 / US5 场景 1）→ 出参见下「T011 出参」。
  按用户裁定落 **「配置注入的指令文件」**：新建 `.opencode/instructions/openhive-tool-path.md`
  （规则正文）＋ `.opencode/opencode.jsonc` 加 `instructions` 键（＋3 行）＋ 见证测试
  `packages/opencode/test/session/openhive-tool-path-instruction.test.ts`（2 条）。
  **3 批变异**（M1 恰红 2 / M2 ①pass②fail / M2b 恰红 1）；**两轮审查**（5 条：修 2 —— 夹具改
  `tmpdirScoped`、目录筛法改成「每个文件都要被注入」（`#005-11` 的漏口）；挂账 3）。
  **零上游源码改动**（只在上游文件里新增一个键，提交标【这是要保留的定制】）。
  出参**收窄**：交付「准则进提示词 ＋ 接线是活的」，**不**交付「AI 不会滥用」——硬那一半已按
  `#002-04` 落进 007 / 008 的 📥 块。连带落 U5 的两笔（`plan.md` / `spec.md` 正文改写 ＋ `tasks.md`
  的 `📌 T011 更正块` 与 `## 📤 交出`）；部署侧下发挂 `docs/workspace/deploy-todo.md` 的 **D-15**。
- **T012**（2026-10-07）· 高风险动作（删除数据）强制人确认（FR-009 / US5 场景 2）→ 出参见下「T012 出参」。
  按用户裁定落 **「配置文件的 `permission` 键」**：`.opencode/opencode.jsonc` 的 `permission` 从空 `{}`
  换成 `bash` 下 **8 条**删除类 pattern → `"ask"`（**＋17 / −1**）＋ 新建见证测试
  `packages/opencode/test/permission/openhive-highrisk-ask.test.ts`（**6 条 / 27 expects**）。
  **3 批变异**（M1 恰红 2 / M2 恰红 1 / M3 恰红 2）；**零上游源码改动**（M3 那次临时改上游 `findLast`
  已逐字节还原并核 `--numstat` 为空）。**RED 态本身是证据**（`3 pass / 3 fail`，红的正是「今天
  `rm -rf` 静默执行」）。⚠️ 途中踩到一个工具怪癖：**bun 默认单测超时 5s** 撞上本文件 2–5s 的实例装配
  ⇒ `[5071.84ms] (fail)`；用 100ms 探针取证后显式传 `30_000`。
  出参**收窄**：交付「通用删除类命令落到 `ask` ＋ 这条链是活的」，**不**交付「高风险动作被 100% 拦住」——
  **三个削弱面**（黑名单按模式匹配天生可绕过 / 上游 `once·always·reject` 语义 / 前端自动应答开关）
  如实进缺口表。**业务高风险动作清单 ＋「判定涉案」的判定逻辑**是 F6 / F7 的对象（📤-2，已按 `#002-04`
  在两文件的 📥 块里补上「闸门落在哪、业务动作要自己加 pattern」）；部署侧下发挂 **D-16**（与 D-15 同文件）。
  ⚠️ **副产品结论**：本条用**真 `Config`** 跑通 ⇒ 回溯证实 T011 那句「`.opencode/opencode.jsonc` 真会被
  目录发现加载」的前提成立。
- **T013**（2026-10-07）· 写测试：指令卡投影 ＋ 上下文动态浮现（SC-002）→ 出参见下「T013 出参」。
  按用户两项裁定落 **「新建集成测试文件」**：`ai-session/capability-pipeline.test.tsx`（**6 条 / 14 expect**），
  喂**第二份带卡的注入清单**走真 `projectCapabilities(清单, 模块)`，把 `.context` / `.drawer` / `.all`
  分别喂真 `ContextCards` / `SkillDrawer` / `skillCommands`；补的是 **`projection.context → ContextCards`**
  与 **`projection.drawer → SkillDrawer`** 这两条此前**零覆盖**的缝（两侧今天各喂手写夹具，这条链
  一次都没被走完过）。**8 批变异**（每批「注入 → 跑 → 逐字节还原」），6 条用例**每条**都被点红过。
  **零产品码改动**（还原后五文件 md5 与备份全等、`--numstat` 为空）。
  ⚠️ 夹具初版把通用清单声明在**最前** ⇒ 渲染层的 `通用优先()` 成了**空转**（摘掉排序 A1 照样绿）——
  已把通用挪到**最后**声明，并用 **M1** 证实那条断言**真的会红**（`LEARNINGS #005-15`）。
- **T014**（2026-10-07）· 写测试：高风险动作强制人确认（SC-003）→ 出参见下「T014 出参」。
  按用户两项裁定落**「新建 gate 测试文件」**：`test/permission/openhive-highrisk-gate.test.ts`
  （**4 条 / 16 expect**），把生产里那个 `ctx.ask`（含 `ruleset` 项）接上**真 `Permission.Service`
  ＋ 真 shell 工具** ⇒ 「挂起 → 等人 → 拒后不执行」真跑；T012 的 `openhive-highrisk-ask.test.ts`
  **一字不动**（两层各有各的见证）。**4 批变异**（每批「注入 → 跑 → 逐字节还原」），4 条用例**每条**
  都被点红过。**零产品码改动**（`packages/opencode` 侧；`.opencode/opencode.jsonc` 只读）。
  ⚠️ **M4 做砸过两次**：变异必须落在**被断言那件事的前置条件**上——落在断言**之后**＝**空转**
  （只把收尾的 `reject` 换成 `once` ⇒ 4 pass 全绿），落在会让用例体**提前中止**的地方＝红在别处。
- **T015**（2026-10-07）· 补齐右栏**会话管理三件事**（新建 / 切换 / 删除）→ 出参见下「T015 出参」。
  「接线级」的一条：三件事的现成能力都在（`session.create` / `session.remove` / 改路由），缺的只是
  「右栏把它们接上」。产物 **3 改 ＋ 2 新**（全在 `packages/app/src/ai-session/`）：新 `session-actions.ts`
  （有判断的那一半，注入依赖 ⇒ 今天能单测）＋ 它 **13 条**；`session-panel.tsx` 加删除钮
  （**就地二次确认**，按裁定）；`session-panel.test.tsx` **5 条**；`ai-session-slot.tsx` 三根接线。
  **13 批变异全部实测**，12 批「恰红 1」＋ 1 批「整组红」（`#003-03` 第 ② 类）。
  ⚠️ 一个**实测出来的名字坑**：`api.session` 上删除那个方法叫 **`remove`**，而 v2 生成客户端上叫
  **`delete`**——名字是 `CompatibleSessionApi` 改回来的，而 `api` 是 **lazy Proxy** ⇒ 写错**不报错**、
  静默取到 `undefined`，点到才 `TypeError`。
- **T016**（2026-10-08）· 右栏加**导出会话**入口（FR-010 / US4 场景 3）→ 出参见下「T016 出参」。
  Step 5 的 **D2** 补开：能力在上游 `utils/session-export.ts` 就在，缺的只是右栏的入口。产物
  **4 改 ＋ 2 改测**：新 `导出会话()`（取 ＋ 拼 ＋ 起名，**不落盘**）＋ **4 条**；会话行加导出钮；
  组件侧 **2 条** ＋ hover 组第 6 条；接线层一行 `.then(downloadSessionExport).catch(报错)`。
  **5 批变异全部实测**（两批「恰红 2」、一批「恰红 1 ＋ 连带 2」、两批「恰红 1」）。
  ⚠️ 一个**被 tsgo 推翻的前提**：task 条目说右栏 `会话出口` 上有 `messages` ——**没有**（新协议的消息
  在另一个命名空间），改接 **`DirectorySDK.client`（legacy）**才对，而那正是上游三处的传法。
- **U6 起草件 → 定稿**（2026-10-07）· 起草 → 用户审 → **移入 `openhive-DESIGN.md` 作 §4.7**（并改
  `§3.1` 的圆角口径）→ 出参见下「U6 起草件出参」。**起草件本身已删**（宪法 §八：DESIGN.md 是视觉真理的
  单一来源；留副本＝两份真相会漂，`#003-05`），其「取数命令核对记录」整段**挪进**了本节（不丢证据、
  不留镜像）。
- **开工前裁定 U1–U10**（2026-10-07，用户逐条裁定）→ 见下「裁定表」。**Spec 未定项至此清零**。

---

## 裁定表（U1–U11 · 2026-10-07）

`docs/workspace/dev_tdd.006.md` 的 Step 0.5 明写「未定项开工前必须裁定，不许自行拍板」。本轮**三轮**裁定
（第三轮 U11 是 T014 完成后清点「未结账」时补的一轮，见下「未结账单与裁定」）：

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
| **U11** | **三笔未结账的归属**（T014 之后清点出来的，全**没有接收方**）：① 右栏会话管理（新建 / 切换）＋ ② spec US4 场景 2 的「删除会话」→ **并成 T015 补进 006**；③ FR-010 的「导出会话」→ ~~改 spec 正文（本仓没有这个能力）~~ ⚠️ **二次更正（2026-10-07 · Step 5 的 D2）：能力在上游就在，缺的是右栏入口 ⇒ 改判为补进 006 的 T016** | `tasks.md` 新增 Phase 8 / T015（**✅ 2026-10-07 完成**）；`spec.md` 的 FR-010 更正块；本文件「未结账单与裁定」 |

---

## 未结账单与裁定（2026-10-07 · T014 之后清点）

**缘起**：回答「006 的 task 是否都完成了」时做了三层核实——**勾选层面** `- [x]` 计数 14 / `- [ ]` 计数 0
（`tasks.md` / `plan.md` / `spec.md` 三个文件都无未勾选项）；但**「需求在生产里成立」不成立**。逐笔如下，
全部**取证过**（`file:line` ＋ grep 结果，不是照 spec 文字推的）。

| 笔 | 原文 / 位置 | 实况（取证） | 为什么算「无接收方」 |
|---|---|---|---|
| **1** | `tasks.md:84` T008 出参「右栏可对话、**可切换会话**」（已勾 `[x]`） | `session-panel.tsx` 的 `session-new` 钮调 `props.onNewSession?.()`、列表项调 `props.onSelectSession?.(会话.id)`；而生产 `ai-session-slot.tsx` **一个都没传** ⇒ 点列表不切、点「＋新会话」不建。⚠️ **裁定只覆盖一半**：T008 裁定 ④「本轮**不调** SDK `session.create`，只留接缝」管的是**新建**；**「切换」没有裁定依据** | 缺口表原话「这两颗各要一套新的异步链……是**下一条**的活」——而 **006 没有下一条** |
| **2** | `spec.md:79` US4 场景 2（**P1**）「民警新建/切换/**删除**会话，When 操作，Then 会话管理正常」 | 「删除会话」在 006 的 `tasks.md` / `state.md` 里**零命中**（不是「做了有缺口」，是**从没进过 14 条**）。⚠️ **但它不是「本仓没能力」**：上游**已有完整实现**——`pages/session/timeline/message-timeline.tsx:818-834`（取相邻会话 → `api.session.remove({sessionID})` → 失败 toast）；CLI 侧也有 `session delete`。**缺的只是右栏那个入口** | 同上 |
| **3** | `spec.md:122` FR-010「……会话管理、**导出会话**」；出处 `2026-09-06-openhive-design-v2.md:340` | **本节第一版的实况（已作废，见下方二次更正）**：本仓**没有** export 路由 / 命令。会话相关只有 CLI `session list` / `session delete`，与 SDK `session.share` / `unshare`——而 share 的文案是 **`"Publish on web"` /「复制链接」**（`packages/app/src/i18n/en.ts` 的 `session.share.popover.title`），是**发布到网上**，不是导出 ⇒ 这不是 006 漏接线，是 FR-010 **引用了一个本仓不存在的能力** | 不适用（**它不该有接收方，该被更正**） |

**裁定（U11，用户 2026-10-07 三轮）**：

- **笔 1 ＋ 笔 2 → 并成一条 T015 补进 006**（`tasks.md` 的 **Phase 8**，标「裁定补开」）。
  两笔本来就是**同一件事**：右栏的会话管理（建 / 切 / 删），且**都是接线级**（现成能力全在，见该条）。
  ✅ **2026-10-07 已完成**——见「T015 出参」。
- **笔 3 → ⚠️ 当天二次更正：原裁定的前提不成立**（2026-10-07 · Step 5 的 **D2** 复核）。
  第一版按「本仓没有这个能力」把 FR-010 收敛成「会话消息流 ＋ 会话管理」——**那条实测口径错了**：
  导出能力**在**（`packages/app/src/utils/session-export.ts` 的 `fetchSessionExport` /
  `sessionExportFilename` / `downloadSessionExport`，**上游文件**，来历 `f1adabcddc` ·
  `feat(app): export session as json from ui (#40781)`），今天**已有三处生产调用点**
  （`components/session/session-context-tab.tsx` · `pages/session/timeline/message-timeline.tsx` ·
  `pages/session/use-session-commands.tsx`）。**第一版为什么判错**：`grep` 的锚点选在**路由 / CLI**
  上，而导出是**客户端 util**、不经路由 ⇒ 锚点选错、缺口按定义不在集合里（`LEARNINGS #004-01`）。
  ⇒ **用户重新裁定：补进 006，另开 `tasks.md` 的 Phase 9 / T016**；`spec.md` 的 FR-010 更正块
  **当天二次更正**（该项**保留**在 FR-010 里）、`plan.md` 对应那行同步恢复。
  ⚠️ **仍然成立的那一半**：「分享」是云端发布（`"Publish on web"`）且**适用性未裁定**——
  它与导出（本地 JSON 落盘）**不是一回事**。
- ✅ **T015 开工前那一项已裁定（2026-10-07）**：**删除会话要人确认，形态＝就地二次确认**（点删除钮 →
  钮变成「确认删除？」→ 再点才真删）——与 FR-009 / SC-003「高风险动作（**删除数据**）必须人确认」同口径；
  闸门住 `permission.bash`（只管 shell 命令，**管不到 `api.session.remove` 这条 HTTP 出口**）⇒ 这层
  **只能在前端做**。成本：一个就地确认态 ＋ 它的用例（**不需要**弹层组件）。

**核对过、不算未结的**（免得这张账单看着比实际重）：

- `contexts` 恒空 / `MANIFESTS.cards` 全空 / `ContextCards` 未接线 → **F6 / F7 / F9**（缺口表已记）。
- FR-008 硬那一半、FR-009「判定涉案」→ **F6 / F7**（📤-1 / 📤-2，**接收方表已落**，实测两文件的 📥 块在）。
- SC-004 的「有权」一半、「收藏 / 最近使用」→ **009**（接收方表已记）。
- SC-003 的三个削弱面 ＋「弹窗渲染」那一层 → 缺口表 ＋ **D-16**（部署侧验）。
- 上游 / 环境类挂账（`prompt.ts` 摊进 `system` 那一跳、F3/F4/F5、`edit` / `write` 不在清单…）→ 逐条在缺口表。

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
  ⇒ ✅ **已收（2026-10-07）**：见「T013 出参」——换了**第二份带卡的**注入清单，且 `contexts` 的两个键
  刻意与这 12 条用的不同值。
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
  ⇒ ✅ **已收（2026-10-07）**：见「T013 出参」——补的是 `projection.drawer → SkillDrawer` 那条缝。

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
  ⇒ ✅ **已收（2026-10-07）**：见「T013 出参」——只补「池子跟着模块换」一条纯函数断言；端到端那条
  （→ 原生 `/` 弹层）**不重写**（`session-panel.test.tsx` 已钉）。
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
  ⇒ ✅ **已收（2026-10-07）**：见「T013 出参」——本条**没碰** `session-panel.test.tsx`（那 22 条未动），
  ① `common` 与 ④ 端到端两条缝都**留给它**，只补它证不到的（② ③ ＋ ④ 的模块切换）。

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

## T010 出参 · AI 执行并展示过程（FR-007 / US4 场景 1 · 2026-10-07）

这条出参是**两个半边**：「**AI 真的跑起来**」＋「**交出去的那句话在右栏看得见**」。
2026-10-07 裁定**两侧拆开测**——app 侧证「右栏把那句话按正确的形状**交出去了**」（止步于
`api.session.prompt` 那一下），`packages/opencode` 侧证「交出去之后**真的跑起来了**」。
⚠️ 理由在 `openhive-prompt-minimal.test.ts` 文件头：`bun test` 里起不了服务器 ⇒ app 侧**测不到执行**，
按 `LEARNINGS #002-02` 那一半只能写成**另一侧的判据**，不能拿 app 侧的绿去顶。

### 产物（3 处产品码 ＋ 3 处测试；其中 3 个是新文件）

| 文件 | 性质 | 内容 |
|---|---|---|
| `packages/app/src/ai-session/submit-prompt.ts` | **新** | `submitRightPanePrompt(input)`：正文 → 既有执行链。**依赖全由参数注入、本模块不碰 context**（这是它能被 `bun test` 测到的全部原因） |
| `packages/app/src/ai-session/session-panel.tsx` | 改 | ① `onSubmitPrompt` 的签名多了**回话**（`Promise<boolean> \| void`）；② `onSubmit` 的**三分支**（没接回调 / 回话 true / 回话 false）；③ `createPromptInputV2Store` 门面（清空走上游的 `reset()`） |
| `packages/app/src/ai-session/ai-session-slot.tsx` | 改 | 把生产的两样接上：`ensureDirSdkContext(目录).api.session`（⚠️ 必须在 `提交态` 那个 **memo** 里取——`ensureDir*Context` 是 `createRefCountMap`，释放走 `onCleanup`，在事件处理器里现取就是每次提交涨一份永不释放的上下文）＋ 失败时 `showToast` 并把 `catch` 翻成 `false`（正文留在框里，可重试） |
| `packages/app/src/ai-session/submit-prompt.test.ts` | **新** | 12 条 / **31 expects** |
| `packages/app/src/ai-session/session-panel.test.tsx` | 改 | ＋**4 条**（该文件 **27 条**）——本栏「提交」出口的三个分支各一条 ＋ 一条竞态 |
| `packages/opencode/test/server/openhive-prompt-minimal.test.ts` | **新** | 1 条 / **5 expects**（真 HTTP ＋ 真库 ＋ 假模型，22 秒） |

### 裁定

- **U5（2026-10-07）**：**复用既有会话执行链**（`components/prompt-input/submit.ts` 的
  `sendFollowupDraft`），不自己写第二份。理由：那条链里有 `Identifier.ascending("message")` 的消息号、
  `buildRequestParts`（正文 / 文件 / agent 提及 → part）、**v1-v2 双协议分流**、乐观插入与它的失败回滚、
  `/` 命令分支——重写＝同一件事的第二处写法（`LEARNINGS #002-06`）。
  **代价只有一处**：`FollowupDraft` 把 `agent` / `model` 声明成**必填**（右栏没有选择器 ⇒ 见下面那段让步）。
- **出参测试两侧拆开**（同日裁定）：app 组件 ＋ opencode 真链（理由见上）。

### U6 的裁定前提被实测推翻（本次最重的一次修正）

**原裁定**写着「`/skill-name` **不**命中 `sync.data.command` ⇒ 原样当正文发出去」。
**三环实测反证**：

1. `packages/opencode/src/command/index.ts` 把 `skill.all()` 的每一项都注册成一条命令
   （`source: "skill"`）—— **skill 在服务端就是命令**；
2. `packages/app/src/context/global-sync/bootstrap.ts` 的 `loadCommands` 把 `GET /command` 的返回
   **全量**装进 `sync.data.command`（不过滤 `source`；且是 `void loadCommands(…).then(setStore(…))`，
   **不 await**）；
3. `ai-session/command-palette.ts` 插进正文的 token 是 `/${条.skill}` —— 与上面那条命令名**同值**。

⇒ **「从 `/` 面板选一个 skill → 回车」这条主路径今天真的在执行那个 skill**，不是「当正文发」。

**停下来问了用户**，裁定＝**保持既有链行为**（不为它改产品码）。于是测试改成**如实钉住现实**：
两条各钉一半（命中 ⇒ 走命令分支；没命中 ⇒ 回退支）＋ 一条**哨兵**（F3，见缺口表）。
⚠️ 两个后果一并挂账：**命令分支解引用 `model`（F3）**、**命令分支无乐观插入 / 无 busy（回车后界面零反馈）**。

### 两个决定性的实测发现（下一个 task 会用上）

**① `it.live` 丢弃返回值 ⇒ 「return 一个待比对的对象」等于零断言。**
`packages/opencode/test/lib/effect.ts` 的 `make` 把 `it.live(name, effect)` 实现成
`test(name, () => run(value, liveLayer))` —— **effect 的返回值被丢掉**。所以断言**必须写在 effect 内部**
（`effect` / `live` 里直接 `expect(...)`）。
⚠️ 蓝本 `test/server/httpapi-sdk.test.ts` 里 `serverPathParity` 那几支正是 `return {…}` 形状
（`:411` / `:426` / `:434` 等）⇒ 那几条**一条断言都没有**，却一直是绿的。
（不写总数：`#002-06` 「会随编辑变的值别写死」，要数就现场 `grep`。）

**② `sync.data.command` 是异步填的 ⇒ 同一操作两种结果。**
`server-sync.tsx` 的 `void loadCommands(…).then(setStore("command", …))` 不 await
⇒ 命令表就绪前后，同一句 `/effect …` 会走**两条不同分支**（执行 skill / 当正文发）。
已挂账（缺口表）。

### 变异账（本轮 8 批；每批都是「注入 → 跑单测 → 还原」，上游文件逐字节还原并核 `--numstat`）

| 变异 | 落点 | 结果 |
|---|---|---|
| **M1** `find` 恒假 | 上游 `submit.ts` 的命令判定 | **恰红 2**（命令分支那两条） |
| **M2** `find` 恒真 | 同上 | **恰红 1**（回退支那条） |
| **M3** 删 `if (!回话) return` | `session-panel.tsx` 的 `onSubmit` | **恰红 1**（对照那条） |
| **M4** 回填永不发生 | 同上（`.then` 体清空） | **恰红 1**（回话 `false` 那条） |
| **M5** 删「用户还没打新字」判据 | 同上 | **恰红 1**（竞态那条） |
| **M6** 回话恒 `false` | `submit-prompt.ts` 的 `return sendFollowupDraft(…)` | **恰红 2**（normal ＋ 命令分支各一条）——**第二轮审查 F-2 补的**：这条缝原先**两端都没人看着** |
| **M7** 乐观那份 id 自己造 | 上游 `build-request-parts.ts` 的 `toOptimisticPart` | **恰红 1**（「两边同源」那条相等断言）——**第二轮审查 F-3 补的** |
| **M8** `reset()` 不归零 `cursor` | 上游 `session-ui` 的 `store.ts` | **无用例红（27 全绿）** —— 这不是「修好了」，是**如实记一条无牙的轴**（第二轮审查 F-1）：原先那句「漏了它下次打字光标会落旧位置」是**推断**，已从注释里删掉（`LEARNINGS #005-15`） |

⚠️ M8 是**反向用途**：变异跑出「全绿」不等于失败——它证明的是「这条轴今天没有断言守着」，
所以结论是**改注释、挂账**，不是补测试（补了也是补一条**测不出东西**的测试）。

### 审查（两轮；`#003-02` / `#005-04`：第一轮修完之后，**把「修复本身」再当靶子打一轮**）

**第一轮**挖出 **F1–F4 ＋ R2-1**，全部修掉：

- **F1 / F2（P1）**：第 10 条用例建在**空夹具**上（`造sync([])`）⇒ 它**只测到 normal 分支**，与真实部署**相反**；
  且那条注释里三处「形状事实」写反了。⇒ 拆成「命中命令分支」＋「回退支」两条 ＋ 一条哨兵，
  并用 **M1 / M2** 分别证明两条各有牙。
- **F3（P2）**：`/` 分支解引用 `model`（会话没记过 model 时当场抛）——**用户裁定「保持既有链行为」**
  ⇒ 只钉**哨兵**、挂账（缺口表 F3）。
- **F4（Minor）**：`submit.ts` 的 `{...undefined, variant}` 是**类型谎言** ⇒ 同根因的第二落点，
  一并挂账（缺口表 F4），不修补（同一裁定）。
- **R2-1（P2）**：**右栏提交后不清空输入框**（RED 实测：`Expected: ""` / `Received: "查一下…"`，
  且前一条断言绿 ⇒ 回车链本身是通的）⇒ 补三分支 ＋ 一条竞态，共 **4 条用例**（M3 / M4 / M5 证明四个落点各有牙）。
- **我自己漏掉的一个落点**：`onSubmit` 里「用户还没打新字才回填」**零断言**（`#005-04` 的现场：
  我是按「记忆里改了几处」打勾的）⇒ 补第 4 条用例 ＋ **M5**。

**第二轮（两席并行，靶子＝第一轮的修复本身）**：

**席①「修复的断言有没有牙」**：独立走码复核了我自报的三个变异（结论一致），**另外找到两条我没提的牙**
（`if (发了) return`、以及「清空是同步的、不等回话」），并报 **7 条缺口**（P1×1 / P2×1 / Minor×3 / info×2）：

| 编号 | 内容 | 处理 |
|---|---|---|
| **F-2（P1）** | 「**成功 ⇒ 回话 `true`**」这个契约**两端都没人看着**（本文件成功用例只 `await 提交(...)` 不看返回值，面板那侧喂的是手搓 `return true`）⇒ 坏法：每次**成功**提交后正文被回填进输入框 | 补 **2 条断言**（normal ＋ 命令分支各一）⇒ **M6 恰红 2** |
| F-1（P2） | `reset()` 的 `cursor` 归零**零断言**，且注释里那句后果是**推断** | **M8 实测**（拆掉上游那行 ⇒ **27 条全绿**）⇒ 按 `#005-15` **改写注释** ＋ 挂账 |
| F-3（Minor） | 注释声称「两边 id **同源**」，而断言只钉了「发出去那件带 id」 | 补那条**相等断言**（`#004-02`）⇒ **M7 恰红 1** |
| F-4（Minor） | 真链里那个 `id` 只复现「**字段在**」、不复现**取值形状** | 改注释（把这条限度写明） |
| F-5（Minor） | **空框回车照样调 `onSubmitPrompt("")`**（调用点 1、守卫点 0） | 挂账，**不补**（`#002-06`；详见缺口表） |
| F-6 / F-7（info） | `Promise \| void` 的恒真支没有会红的对照；本栏两条提交出口只钉了一条 | 保留自陈 / 如实挂账 |

**席②「注释里每个事实性说法是否属实」**：逐条给命令与输出，报 **3 条不实 ＋ 4 条部分属实**；
⚠️ 我**全部复跑复现之后**才改（`#004-04`：别人的结论也是待证断言）：

| 编号 | 我原先写下的说法 | 复跑取到的实况 |
|---|---|---|
| **不实-1** | 真链文件头：「本仓 server **只注册了** `/global/health`（`groups/global.ts`），**`/api/health` 零命中**」 | **假**：`/api/health` 由 `packages/protocol/src/groups/health.ts` 定义、经 `api.ts` 的 `.add(HealthGroup)` 进 `Api`、`httpapi/server.ts` 的 `serverRoutes` 真的 materialize。⇒ 那句删掉，理由改成「**第一档** `/global/health` 先命中」。⚠️ **它支撑的结论（本部署是 v1）不变**——退到第二档，`/api/health` 返回 `{healthy:true}`（无 `pid`）**仍然判 v1** |
| **不实-2** | `submit-prompt.ts`：「`createUserMessage`：`input.agent ?? agents.defaultInfo()`」 | **假**：`prompt.ts` 里**没有**那个表达式；真身是 `agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()`。⇒ 照抄真身（同一括号里的模型那一句 `input.model ?? ag.model ?? currentModel(...)` 原本就逐字**对**） |
| **不实-3** | `ai-session-slot.tsx`：「`态()` 是 `createMemo`」 | **假**：`态` 是 `<Show>` 的子访问器**参数**，memo 是 `提交态`。⇒ 名字改正 |
| 部分-1…4 | 「被 stub 的只有**三**处」「`submit()` **只**调 `onSubmit` 就完事」「`Show` 非 keyed ⇒ **消息增长不重挂**」「真链用例标题写『**会话**被写上…』」 | 漏了 `serverSync`（第四处替身，且它是**碰就抛的哨兵**）；`submit()` 还 `dispatch(popover.close)`；非 keyed 真正防的是「条件**仍是真值**但**引用变了**」（消息增长压根不让 `提交态` 重算）；标题按体内断言改「**用户那条消息**」 |

⚠️ **这三条不实里，不实-1 与不实-2 是同一形状**：**照着自己以为的形状写下来、没 grep 过**正要引用的那一行。
`#004-03`（「有 X 钉住」要去核）／`#004-04`（写下的结论本身也是靶子）讲的正是这一类。
⚠️ 不实-1 尤其值得记一笔：**结论对、理由错**——下一个人若按那句错理由去动 `detectServerProtocol`，
会以为「补上 `/api/health` 就能切 v2」。

### 门禁（2026-10-07，**串行**复跑；`#003-01`）

| 门 | 读数 |
|---|---|
| `lint:openhive` | **23 warnings / 0 errors**（131 files / 161 rules）—— 与基线一致；本次改动文件 **0 命中** |
| `bunx oxlint packages/opencode/test/server/openhive-prompt-minimal.test.ts` | **0 warnings / 0 errors**（130 rules）。⚠️ **这个文件不归 `lint:openhive` 管**（它的路径里没有 `packages/opencode`）⇒ 是我**单独**跑的。第一次跑报过 `no-unnecessary-type-conversion` 1 条（`String(...)` 包了个已经是 string 的值）⇒ 已去壳 |
| `typecheck`（turbo） | **31 successful / 31 total**（`@opencode-ai/app` 与 `opencode` 实跑未缓存） |
| `packages/app` `test:unit` | **977 pass / 0 fail / 3377 expects / 126 files** |
| `packages/app` `test:components` | **578 pass / 0 fail / 1240 expects / 34 files** |
| 真链用例（`openhive-prompt-minimal.test.ts`） | **1 pass / 5 expects**（22.55s） |

⚠️ 如实记一条**噪音**：`test:components` 的输出里有 `NetworkError: Failed to execute "fetch()" …
"http://xn--nqqs3etzam25g/": ECONNREFUSED`（happy-dom 自己的 `Fetch.js`）。**非本次引入**——实测
`session-panel.test.tsx` 单跑 **0 个**、全量跑才出现，且 **0 fail**。别把它当成新缺陷去追。

---

## T011 出参 · AI 不滥用确定性事（FR-008 / US5 场景 1 · 2026-10-07）

### 产品码落点（三处，全部随仓库版本化）

| # | 落点 | 是什么 |
|---|---|---|
| ① | `.opencode/instructions/openhive-tool-path.md`（**新建**） | 规则**正文**，四节：确定性的活走工具路径（不要靠印象）／需要专家经验的研判才是给意见的地方／高风险动作先问人／取不到数就如实说取不到。取数（2026-10-07 21:0x 实测）：`wc -l -c` ⇒ **27 行 / 1468 字节**，`file` ⇒ UTF-8 **LF**（无 CR）。⚠️ 正文里的数字与措辞是**产品文案**，不是断言——它好不好是人的判断 |
| ② | `.opencode/opencode.jsonc`（**改，+3 行**） | **接线**：`"instructions": [".opencode/instructions/*.md"]`（含一行注释说明它是 006 的定制、正文在同目录） |
| ③ | `packages/opencode/test/session/openhive-tool-path-instruction.test.ts`（**新建**） | **接线自检**（2 条用例 / 6 expects）。⚠️ 它测的**不是**「AI 会不会遵守」——本机没有真模型、没有真业务工具（F6/F7 才有）⇒ 那件事**测不了**；它测的是**接线是活的**（`LEARNINGS #005-15`：别让注释比断言强） |

**落点依据**：2026-10-07 用户裁定（压缩前的未定项询问）——产品码落在**「配置注入的指令文件」**这一层。
同一裁定里的两个 ⚠️ 都已落：① 这是**零上游源码改动**的形态（只加配置文件里的一个键）；② 「产品侧的配置
**下发**」属部署侧 ⇒ 已挂 `docs/workspace/deploy-todo.md` 的 **D-15**。

⚠️ **`.opencode/opencode.jsonc` 是纯上游文件**（实测：`git log` 提交史全是上游的；
`git merge-base --is-ancestor bb82aab5c8 upstream/dev` **成立**；本分支相对 `upstream/dev` 的提交里
`.opencode/` **零命中**）⇒ 这 3 行是**新增键**、不是改上游语义，但**提交信息里要标【这是要保留的定制】**。
（这一条记在审查结论的「上游侵入面」一项里，`#004-03` 的「有 X 钉住要核」同族。）

### 真链（读码 ＋ grep，非推断）

```
.opencode/opencode.jsonc 的 instructions
  → Instruction.systemPaths()   packages/opencode/src/session/instruction.ts
      · 绝对项 ⇒ 原样；相对项 ⇒ relative() ⇒ fs.globUp(项, ctx.directory, ctx.worktree)
        （**从实例目录逐级向上** glob 到 worktree，{absolute:true, include:"file", dot:true}）
  → 拼成 `Instructions from: <绝对路径>\n<正文>`（本 task 的判据正是这个**拼接形状**）
  → SessionPrompt.run           packages/opencode/src/session/prompt.ts:1313 的 instruction.system()
  → const system = [...env, ...instructions, ...(mcpInstructions?[..]:[]), ...(skills?[skills]:[])]
  → handle.process(…)
```

- **组装点只有一个**（实测取数：`grep -rn "instruction\.\(system\|resolve\)(" packages`）⇒
  `instruction.system()` 只被 `prompt.ts` 的 `SessionPrompt.run` 调，`instruction.resolve()` 只被
  `tool/read.ts` 调。**主会话与子会话走同一条链** ⇒ 不存在「另有一个出口忘了注入」。
- **`sys.environment()` 不含 instructions**（读 `packages/opencode/src/session/system.ts`）——
  `environment()` 是环境信息 ＋ references；`mcp()` 那个 `mcp.instructions()` 是 **MCP server 自己的
  说明**，另一回事。⇒ 「第二条注入出口」不存在。
- ⚠️ **另一套 ambient 通道（不在今天这条路上，但要记）**：`packages/core/src/instruction-context.ts`
  注册为 SystemContext 键 `core/instructions`，**只读 `AGENTS.md`**、**不读 `config.instructions`**。
  实测 `grep -rn "SystemContext" packages/opencode/src packages/app/src packages/session-ui/src`
  **零命中** ⇒ 它今天不在会话路径上。**风险如实记**：会话路径哪天迁到 SystemContext，本条接线会
  **静默失效**（已进缺口表）。

### ⚠️ 出参收窄（两半都要说清）

本条交付的是**两件事**：① **规则进了每次会话的系统提示词**；② **这条接线是活的**（有断言、变异会红）。
本条**没有**交付「AI 不会滥用确定性的事」——提示词是**软机制**：它只是让模型看见一句准则，**不强制任何行为**。
**硬**那一半（确定性查询 / 统计**真的**有可调用的工具、且调用受鉴权约束）在 **F6 / F7**：
已按 `#002-04` 落进 `007-fund-analysis/tasks.md` 与 `008-call-analysis/tasks.md` 的 **📥 块**（📤-1）。
⚠️ **不得声称 FR-008 已在 006 端到端验证**（`LEARNINGS #002-02`）。

### 测试怎么写的（两个反直觉处，都写进文件头了）

- **instance 指向仓库根**（不是 tmpdir）：相对项走 `globUp(…, ctx.directory, ctx.worktree)`，
  只有把实例对准仓库根，测的才是「**本仓配置里的相对路径能不能命中**」；喂 tmpdir 就得自己造一份
  `.opencode/instructions/`，那测的是**夹具**而不是产品（`#002-02`）。
- **但不用真 `Config`**：`packages/opencode/src/config/config.ts` 的 `.opencode` 目录循环里还挂着
  `ensureGitignore(dir)` ＋ `npmSvc.install(dir, {add:[@opencode-ai/plugin]}).forkDetach` **两个副作用**
  ⇒ 对着仓库根真跑一次会**污染工作树**。故 `Config` 用 `TestConfig.make` 桩，而喂给桩的 `instructions`
  **不是编的**——**照产品同一个解析器**（`ConfigParse.jsonc`）从**真配置**里读出来（`#002-06`）。
- `Global` 指向**空 tmpdir**（`tmpdirScoped`）：否则会去读开发机的 `~/.claude/CLAUDE.md`，测试就依赖本机了。

### 变异账（3 批，各自逐字节还原后复核）

| 批 | 注入 | 结果 |
|---|---|---|
| **M1** | 从 `.opencode/opencode.jsonc` 删掉 `"instructions": [` 这一行 | **恰红 2 条**（① 声明为空；② 集合相等 0 ≠ 1） |
| **M2** | 配置保留，把 `.md` 挪成 `.md.off` | **① pass / ② fail** —— 两个变异各自**恰好**让一条变红（声明层 / 命中层） |
| **M2b** | 真 `.md` 与 `.md.off` **并存**（后补，专为 F-5 的修复取证） | **② 恰红**，`Received length: 1` vs 期望 2 ⇒ 证实「目录里放进来却没注入」这个漏口**真会红** |

⚠️ 第一批跑之前踩过一个坑（**中文变量名**）：`备份=/tmp/… && cp … "$备份"` 报
`bash: line 1: 备份=/tmp/…: No such file or directory`（bash 变量名必须 ASCII）⇒ 变异**没跑**、
测试对着**未变异**的文件跑了 2 pass。**是「假绿」**——判据是「命令回执那一刻的样子」，不是「变异生效了」。
改用 ASCII 变量名 ＋ 分步（不串一条 `&&`）后复跑，读数如上。

### 审查（两轮；`#003-02` / `#005-04`）

**第一轮 5 条**，**修 2 、挂账 3**：

| 编号 | 性质 | 处置 |
|---|---|---|
| **F-3** | 夹具生命周期 | 模块级 `mkdtempSync` ＋ `process.on("exit")` 清理 ⇒ **改**为 `tmpdirScoped()` ＋ 用例体内 `Effect.provide(instructionLayer(空))`（与 `instruction.test.ts` 的 `withFiles` 同形） |
| **F-5** | **漏口** | 原 `readdirSync(dir).filter(名 => 名.endsWith(".md"))` ⇒ 往规则目录里放一份**非 `.md`** 的规则、它没被注入，**全套照样绿**。改成按 Dirent 判「是不是文件」⇒ 那个漏口自己当场变红（由 **M2b** 取证）。**这就是 `#005-11`**：横切机制在「新出口」上没人验 |
| F-1 / F-2 / F-4 | 挂账 | 见下 |

**挂账 3 条（未改产品码 / 未改测试，理由各自不同）**：

1. **`prompt.ts` 把 instruction 摊进 `system` 那一跳没有断言** —— 全仓没有任何测试钉住
   「`Instruction.system()` 的返回值真的进了 `system` 数组」。⚠️ 这是**所有** instruction 源共有的
   老账（非本条引入），且它要动的是 `SessionPrompt.run` 的内部结构 ⇒ 不在本 task 的出参里。
2. **`config.instructions` 的绝对路径支路没有断言** —— 本仓用的是相对项；绝对项那条分支
   （部署侧形态未定）今天没有观测面。
3. **另一套 ambient 通道的静默失效风险** —— `core/instruction-context.ts` 只读 `AGENTS.md`；
   会话路径若迁到 SystemContext，本条的 `config.instructions` 接线会**不报错地**失效。

**第二轮（把「第一轮的修复」再当靶子）**：两条修复各做一次**自证**，不靠「看起来对」——
- F-3 的 `tmpdirScoped` **真的会清**：跑测试前后数 `$TMPDIR/opencode-test-*` 目录数
  ⇒ **76 → 76**（顺带观察：本机已有 76 个**他人遗留**的临时目录，非本次引入）。
- F-5 的牙由 **M2b** 证（见上表）——不是「它应该会红」。

### 门禁（2026-10-07，**串行**；`#003-01`）

| 门 | 读数 |
|---|---|
| `bunx oxlint packages/opencode/test/session/openhive-tool-path-instruction.test.ts`（**仓库根**跑，`#004-10`） | **0 warnings / 0 errors**（1 file / 130 rules / 10.0s） |
| `bun run lint:openhive`（`packages/app` 侧） | **23 warnings / 0 errors**（131 files / 161 rules）—— 与基线一致；⚠️ 本条**不改 `packages/app` 任何文件** ⇒ 本次改动文件 0 命中 |
| `packages/opencode` 的 `bun run typecheck`（`tsgo --noEmit`） | **EXIT=0**，无输出 |
| 本文件 `bun test test/session/openhive-tool-path-instruction.test.ts` | **2 pass / 0 fail / 6 expect**（10.23s） |
| 兄弟文件 `bun test test/session/instruction.test.ts` | **9 pass / 1 todo / 0 fail** —— 未回归（两文件合跑即 **11 pass / 1 todo**） |

### 同 task 一并落的文档动作（U5 的两笔，2026-10-07）

- **`plan.md` / `spec.md` 正文改写**：「确定性走 **MCP**」⇒「确定性走**工具 / 代码执行路径**」——
  U5 原本就定「T011 开工时改写正文」，本次开工即落。理由照 `#004-13` 的 (b) 类：本仓**没有 MCP server**
  （opencode 只是 MCP **客户端**）⇒ 照原样写会得到一条**空的**断言。
- **`tasks.md`**：T011 出参**收窄**（「环境准则进系统提示词；业务查询工具的产源在 F6/F7」）；
  把那段注重构成带标签的 **`📌 T011 更正块`**（`plan.md` / `spec.md` 的指针本来就指着这个名字，
  而它**此前不存在**——`grep "更正块"` 零命中 ⇒ 指不解析，`#002-06` 同型，本次补上）；
  新增 **`## 📤 交出`** 节（📤-1 确定性查询 / 统计的工具产源 → 007 的 T006/T014、008 的 T006/T014；
  📤-2 「判定涉案」的判定逻辑 → 007/008 的 T014）。
- **`007-fund-analysis/tasks.md` / `008-call-analysis/tasks.md`**：各加一份同形的 **📥 接收块**
  （在 `**Tests**:` 行之前，两份互为镜像、各自点名对方同一块）——按 `#002-04`：**责任推出边界时，
  要落进接收方的表**，不能只写在自己文档里。

### 上游侵入面（审查的第 ⑥ 类）

| 文件 | 上游是不是动过 | 本次形态 | 同步风险 |
|---|---|---|---|
| `.opencode/opencode.jsonc` | **是上游文件**（本 fork 此前零改动） | **新增一个键**（`instructions`），不改既有键 | 低——上游改这个文件时是「各自加键」，冲突面是**相邻行**，不是语义 |
| `.opencode/instructions/openhive-tool-path.md` | 上游**没有**这个目录 | 全新文件 | **零**（上游不可能改一个它没有的文件） |
| `packages/opencode/test/session/openhive-tool-path-instruction.test.ts` | 上游没有同名文件 | 全新文件 | **零** |

---

## T012 出参 · 高风险动作（删除数据）强制人确认（FR-009 / US5 场景 2 · 2026-10-07）

### 产品码落点（两处；**零上游源码改动**）

| # | 落点 | 是什么 |
|---|---|---|
| ① | `.opencode/opencode.jsonc`（**改，+17 / −1**） | **规则**：`permission` 键从空的 `{}` 换成 `bash` 下 **8 条**删除类 pattern → `"ask"`（＋ 6 行注释说明它是 006 的定制）。⚠️ 生效的是**单数** `permission`（v1）；复数 `permissions` 在 `config/v2-compat.ts` 里**直接抛** `V2 permissions are not supported by OpenCode V1` |
| ② | `packages/opencode/test/permission/openhive-highrisk-ask.test.ts`（**新建**） | **见证**（6 条用例 / 27 expects）。⚠️ 它测的**不是**「民警真的会被弹窗拦住」——那要前端 ＋ 一次真会话（本机没有）；它测的是「**声明 → 规则集 → 判定**这条链是活的」，且**真 `Config`** 走完目录发现（顺带把「这个文件到底会不会被加载」一起测了）。✅ **2026-10-07 T014 已在它下游补上「判定之后那一跳」**（真挂起 ＋ 拒后不执行）＝ `test/permission/openhive-highrisk-gate.test.ts`（4 条）；⚠️ 但**仍止于「前端把 `Asked` 渲染成弹窗」之前** |

**落点依据**：2026-10-07 用户裁定（压缩前的未定项询问，三项全按建议）——
① **落地层**＝**配置文件的 `permission` 键**（复用上游闸门、零上游源码改动）；
② **清单范围**＝`bash` 的删除类模式 → `ask`，其余 bash 照旧 `allow`（`edit` / `write` 本轮不动）；
③ **100% 口径**＝接受上游 `once / always / reject` 语义 ＋ 前端自动应答开关，**把削弱面如实写进缺口表**
＋ 挂部署侧待办（**不改上游核心**）。

⚠️ `.opencode/opencode.jsonc` 是**纯上游文件**（T011 已实测：`git log` 全是上游提交；本分支相对
`upstream/dev` 的提交里 `.opencode/` 零命中）⇒ 本次是**改一个既有键的值**（`{}` → 规则块），
不是加键。与 T011 那笔**同文件相邻**：冲突面是相邻行，不是语义。**提交信息照标【这是要保留的定制】**。

### 真链（读码 ＋ grep，非推断）

```
.opencode/opencode.jsonc 的 permission
  → Config（真目录发现：config/config.ts 的 dir.endsWith(".opencode") 分支读 opencode.json/jsonc）
  → agent/agent.ts：每个 agent 的规则集 = Permission.merge(defaults, <本 agent 自己的>, user)
       · defaults = Permission.fromConfig({ "*": "allow", … })
       · user     = Permission.fromConfig(cfg.permission ?? {})   ← **排在最后**
  → evaluate(permission, pattern, ...rulesets)   permission/index.ts:28
       用 findLast ⇒ 最后一条命中的规则赢 ⇒ **配置里的 ask 赢过默认的 allow**
  → session/tools.ts 的 ask → permission/index.ts 的 ask()（逐 pattern 判：任一 deny ⇒ Denied；
       全 allow ⇒ 直接返回；否则弹窗 ＋ 等 reply）
  → 工具执行 / 不执行
```

- **今天不写这段规则会怎样**（RED 态实证，不是推断）：`defaults` 是 `"*": "allow"` ⇒ 本仓
  **`rm -rf` 一声不响就跑了**。RED 时 6 条里**恰红 3 条**，红的正是「清单里每条都落到 `ask`」
  那一条（实得全是 `allow`）。
- **每个 agent 都被影响**：`agent/agent.ts` 里**每个** agent 都 `merge(defaults, …, user)` ⇒ 配置是
  **全局**的。⑤ 组因此对**全部 7 个 native agent** 逐个打勾（`#005-04`：按**被改方的全部落点**打勾）。
- ⚠️ **一处如实记账的「放宽」**：`title` / `summary` / `compaction` 自己的规则集是
  `merge(defaults, { "*": "deny" }, user)`，`user` 排最后 ＋ `findLast` ⇒ 我们声明的 pattern 把它们
  自己的 `deny` **放宽成了 `ask`**（未声明的命令照旧 `deny`）。方向是「**更爱问**」不是「更放行」，
  但它**确实改了这三个隐藏 agent 的行为** ⇒ ⑤ 组里写成一条**报警断言**
  （`判定(title.permission, "bun run test") === "deny"`）：哪天 `user` 被排到 per-agent deny **之前**，
  它会红，逼人回来回答「要不要保留这个放宽」。

**每条 pattern 的形态不是随手编的**：它就是 `shell.ts` 的 `collect()` 里
`scan.always.add(BashArity.prefix(tokens).join(" ") + " *")` 的产物（`rm -rf build` → `rm *`、
`git clean -fdx` → `git clean *`）。② 组用**真 shell 工具**把这条相等断言钉死（不是靠注释声称）。

### ⚠️ 出参收窄（两半都要说清）

本条交付的是**两件事**：① **删除类动作真的落到「问人」这一步**（规则集上的判定是 `ask`，不是 `allow`）；
② **这条链是活的**（有断言、变异会红）。本条**没有**交付「高风险动作被 100% 拦住」——**三个削弱面**：

1. **黑名单按模式匹配 ⇒ 天生可绕过**：`sudo rm -rf build` 扫出来的 pattern 是**整条命令的源文本**
   （`sudo rm -rf build`），不以 `rm ` 开头 ⇒ 不命中 `rm *` ⇒ 兜底 `allow`。⑥ 组把这条**如实钉住**
   （它**不是**待修的 bug，是这类做法的天花板；真正的兜底在沙箱 / 备份）。同类的还有 `bash -c "rm …"`、
   脚本里调 rm、`find … -delete`。
2. **上游 `ask` 的 `once / always / reject` 语义是上游的**：「always」会把该 pattern 在**本会话内**
   永久放行。这是上游行为，本条不用它，也不假装能改变它。
3. **前端有一个自动应答开关**（`packages/app/src/context/permission-auto-respond.ts`，实测**默认关**）
   ⇒ 部署时若把它打开，闸门等于装饰（已写进 D-16）。

⚠️ **不得声称 FR-009 已在 006 端到端验证**（`LEARNINGS #002-02`）。U5 划的那半——「**判定涉案**」的
**判定逻辑**——是 **F6 / F7** 的对象（📤-2 已落 007 / 008 的 T014）；本条交的是**闸门机制 ＋ 一份清单**。

### 测试怎么写的（三个反直觉处，都写进文件头了）

- **样本命令一律取「单条、无操作符」的写法**：判据要锚在**被调方**上（`#004-07`）——工具真正拿去比的
  是 `scan.patterns.add(source(node))`，即**命令节点的源文本**。单条命令时 `source(node)` 就是命令串本身。
- **`ctx.ask` 换成「记下 ＋ die」**：`execute` 的流程是 `parse → collect → ask → run`，`ask` 在 spawn
  **之前** ⇒ 让 `ctx.ask` die 就**拿得到真 patterns，而命令一步都不会跑**（样本里有 `rm -rf`，
  这一步很要紧，`#004-08`：副作用类判据要先证机制是活的）。
- **真配置拷进 tmpdir，而不是把实例对准仓库根**：真 `Config` 每加载一个目录都会跑
  `ensureGitignore(dir)` ＋ `npmSvc.install(...).forkDetach` **两个副作用**（`config/config.ts`）⇒
  对准仓库根会**污染工作树**并起一个后台安装。拷进 tmpdir 则连「`.opencode` 目录会不会被发现」
  一起测，而副作用落在临时目录里。（与 T011 的取舍**相反**——T011 必须对准仓库根，因为它测的是
  `globUp` 的相对项解析；本条测的是「配置 → 规则集」，tmpdir 更隔离。两次取舍各自写进了文件头。）
- **配置用产品同一个解析器读**（`ConfigParse.jsonc`），不自己编一份（`#002-06`：同一个判断别两处各写一份）。

### 变异账（3 批，各自逐字节还原后复核）

| 批 | 注入 | 结果 |
|---|---|---|
| **M1** | 从 `.opencode/opencode.jsonc` 删掉 `"del *": "ask"` 这一行 | **恰红 2 条**（① 声明集合少一条；③ 该命令落到 `allow`）——差集打出 `"del data.csv": "ask" → "allow"`，**点名落点**（`#005-12`） |
| **M2** | 多加一条 `"ri *": "ask"`（不在清单里） | **恰红 1 条**（① 声明的集合 ≠ 清单）⇒ 证实①是**警报语义**（多一条也红，`#004-02`） |
| **M3** | 临时把上游 `permission/index.ts` 的 `findLast` 改成 `find`（**事后逐字节还原，`git diff --numstat` 为空**） | **恰红 2 条**（③ 判定；⑤ 全 agent 判定）⇒ 证明这两条**锚定了优先级**（配置规则赢过默认 allow 靠的正是 `findLast`） |

**RED 态本身也是证据**：`3 pass / 3 fail`，红的正是 ①（声明集合 `[]`）、③（全部 `allow`）、
⑤（`title` 为 `deny`）——即「今天 `rm -rf` 静默执行」的**实证**，不是空断言。

### 门禁（2026-10-07，**串行**；`#003-01`）

| 门 | 读数 |
|---|---|
| `bunx oxlint packages/opencode/test/permission/openhive-highrisk-ask.test.ts`（**仓库根**跑，`#004-10`） | **0 warnings / 0 errors** |
| `packages/opencode` 的 `bun run typecheck`（`tsgo --noEmit`） | **EXIT=0** |
| 本文件 `bun test test/permission/openhive-highrisk-ask.test.ts` | **6 pass / 0 fail / 27 expect**（27.92s） |
| 兄弟目录 `bun test test/permission/` | **91 pass / 0 fail** |
| `bun test test/config/`（本 task 改了配置文件 ⇒ 回归面） | **233 pass / 0 fail** |
| `bun test test/agent/agent.test.ts`（规则集装配面） | **43 pass / 0 fail** |
| `bun test test/session/instruction.test.ts test/session/openhive-tool-path-instruction.test.ts`（T011 的两个，**同文件相邻**） | **11 pass / 1 todo / 0 fail** |
| `bun run lint:openhive`（`packages/app` 侧） | **23 warnings / 0 errors** —— 与基线一致；⚠️ 本条**不改 `packages/app` 任何文件** ⇒ 本次改动文件 0 命中 |
| `git diff --stat bun.lock` | **空**（未污染，`CLAUDE.md` 的锁文件纪律） |

⚠️ **踩到一个工具怪癖（已探明、写进文件头）**：本文件每条 `it.instance` 要真装一次实例
（真 `Config` 走目录发现 ＋ fork 一次后台装依赖），耗时在 2–5s 之间抖，而 **bun 的默认单测超时正好是 5s**
⇒ 不带 `--timeout` 直接 `bun test <这个文件>` 时撞到一条 `[5071.84ms]` 的 `(fail)`。
**取证方式**：把超时压到 `100` 复跑一次，报的正是 `this test timed out after 100ms.`（5 条全红）
⇒ 证实那次红**就是默认超时**，不是断言毛病（`#003-01`：红之前先怀疑测量）。
修法：显式给 5 条 `it.instance` 传第 4 个参数 `30_000`（与包脚本的 `--timeout 30000` 同一个数）。

### 一个副产品结论（回溯证实了 T011 的一个前提）

本条用**真 `Config`**（不桩）跑通了 ⇒ **`.opencode/opencode.jsonc` 真的会被产品从目录发现里加载**。
T011 当时用的是 `TestConfig.make` 桩 ＋ 「照产品解析器读真配置」，其「`instructions` 会被注入」
的前提由此**回溯成立**（T011 的出参节写的就是那条链）。⚠️ 但两边的**测法**仍不同：T011 测的是
`Instruction.systemPaths()` 的 `globUp` 解析（要真仓库根），本条测的是「配置 → 规则集」
（tmpdir 就够）——**不要读成「本条替代了 T011 的测试」**。

### 上游侵入面（审查的第 ⑥ 类）

| 文件 | 上游是不是动过 | 本次形态 | 同步风险 |
|---|---|---|---|
| `.opencode/opencode.jsonc` | **是上游文件** | **改一个既有键的值**（`"permission": {}` → bash 规则块），与 T011 的 `instructions` 新键**同文件相邻** | 低——上游改这个文件时是「各自改键」，冲突面是**相邻行**，不是语义 |
| `packages/opencode/test/permission/openhive-highrisk-ask.test.ts` | 上游没有同名文件 | 全新文件 | **零** |
| **上游 `src/` 一行未改** | —— | M3 那次变异是**临时**改 `permission/index.ts` 的 `findLast`→`find`，**事后逐字节还原并核 `--numstat` 为空** | **零** |

---

## T013 出参 · 指令卡投影链的跨组件验收（SC-002 / FR-001 / FR-006 · 2026-10-07）

### 产品码落点

**零。** 本条是 `[FE] 写测试`，产物**就是测试本身**——新建
`packages/app/src/ai-session/capability-pipeline.test.tsx`（**6 条 / 14 expect**）。既有产品码
（`projection.ts` / `context-cards.tsx` / `skill-drawer.tsx` / `command-palette.ts` / `instruction-cards.tsx`）
**一行未改**（8 批变异全部逐字节还原，见下）。

### 开工第一件事：先把出参收窄（`#005-09`：先读本 feature 的挂账清单，别把已挂的当新缺口）

三条**已挂账**的约束决定了本条只能做到哪一步——**重报一遍就是把旧账当新发现**：

| 已挂账的事 | 对 T013 的约束 |
|---|---|
| **`contexts` 在生产里恒为空**（缺口表那条：中栏没有右栏读得到的选中态，T008 裁定不接线） | 「选中浮现 / 取消消失」**只能喂夹具**。⚠️ **不得**写成「民警能看到上下文指令」 |
| **`MANIFESTS.cards` 全为空**（缺口表那条） | 对着**真**清单写「卡浮出来了」是**空断言**（`#004-13`）⇒ 注入清单必须自己造 |
| **`projection.context → ContextCards` 零调用点**（`grep` 实测，见下表） | 本条的**唯一增量**就是这条缝与它的孪生（`drawer`） |

**用户两项裁定（2026-10-07，全按建议）**：① 产物形态 = **新建集成测试文件**（不改
`common-cards` / `context-cards` / `skill-drawer` 三个既有测试文件）；② `ContextCards` **维持 T008 裁定
不接线**（`session-panel.tsx` 不动 ⇒ 本条断言**止于「投影 → 组件」这条边**）。

### 真链：四条缝今天各自被谁钉过（`grep -rn "projectCapabilities" packages/app/src` 实测）

生产调用点只有两处：`ai-session-slot.tsx`（组装，一次投影喂四层）与 `session-panel.tsx`（收 `projection`
prop）；**其余全部在测试里**。四条缝的覆盖实况：

| 缝 | 今天谁钉过 | T013 怎么处理 |
|---|---|---|
| ① `projection.common → CommonCards → 右栏` | `session-panel.test.tsx`：真 `projectCapabilities` ＋「换一份清单 ⇒ 张数跟着变」 | **不重写** |
| ② `projection.context → ContextCards` | **零覆盖**——`context-cards.test.tsx` 的 12 条全喂**手写** `ProjectedCard[]`（`造卡(...)`），**一次都没过投影** | ✅ **补** |
| ③ `projection.drawer → SkillDrawer` | **零覆盖**——`skill-drawer.test.tsx` 的 11 条全喂**手写** `SkillGroup[]` | ✅ **补** |
| ④ `projection.all → skillCommands → 原生 `/` 弹层` | `command-palette.test.tsx` 11 条（函数本体）＋ `session-panel.test.tsx` 3 条（打 `/` 断言 `data-suggestion-id`） | 只补「**池子跟着模块换**」1 条 |

即：T005 / T006 / T007 各自证的是「**这个组件**按契约办事」，**没有一条**证过
「**带卡的清单走完投影之后**，这个组件还是按契约办事」——投影少过滤一层、或组件读错一个字段，
两侧的用例都照样全绿。这就是 `tasks.md` 在那三条下面各插一句「T013 收」的所指。

### 出参：6 条，各自「凭什么不是重复」

| 用例 | 断的是什么 | 凭什么不是 T005/T006/T007 的重写 |
|---|---|---|
| **A1** 真投影冒出来 ＋「通用那支排在模块卡前面」 | `card-row-title` ＝「上下文指令」；`card-label` ＝ `[通用研判模板, 查资金链]` | 那条**排序**读的是 `ProjectedCard.module`——**只能由投影补上**（卡在 `SkillCapability.cards` 里时「属于哪份清单」是结构性的，拍平就丢）。两侧单独测时都拿不到这个事实 |
| **A2** 换模块 ⇒ 换成话单那张、通用那张**留** | 同一实例上 `设模块(话单)` 后 `card-label` ＝ `[通用研判模板, 查通话对象]` | SC-002 第二步：断的是**跟着换**（同一实例），不是「换个夹具重挂一次」 |
| **A3** 取消选中 ⇒ 整段消失 | 同一实例上 `设上下文([])` 后 `无槽(host,"card-row")` 为真 | T005 有空集那条，但喂的是**手写夹具的空集**；这条是**真投影 ＋ 同一个实例**从有到无，是这条链上才有的性质 |
| **B1** 真投影进抽屉 | `group-title` ＝ `[资金研判, 通用]`（＝清单**声明序**，`分组()` 不排序）；`skill-entry-name` ＝ `[资金关联分析, 研判记录]` | 组序与条目名都由投影产出；夹具刻意让**显示名 ≠ 连接键** ⇒ 「读 `条.name` 还是 `条.skill`」有牙（生产里两者同值，要到 009 才分家） |
| **B2** 换模块 ⇒ 抽屉跟着换、通用那组留 | `[话单研判, 通用]` / `[话单关联分析, 研判记录]` | 同上 |
| **C1** 池子跟着模块换 | `skillCommands(projectCapabilities(注入清单, 模块).all)` 的 `label → title` 序列 | **不重写**端到端那条；这是纯函数断言，`session-panel.test.tsx` 只断言了 suggestion **id**，没断言过「换模块池子跟着换」 |

### ⚠️ 夹具的牙口：一条差点写成**空转**的断言（`#005-15`）

`注入清单` 的第一版是 `[通用清单, 资金清单, 话单清单]`——**通用那份在最前**。而 `projectCapabilities`
按清单顺序拍平 ⇒ 投影出来的卡**本来就是通用在前**；渲染层的 `通用优先()` 于是成了**空操作**：
**摘掉排序、A1 照样绿**。

判据「我这条断言拦住了排序」是**待证的断言**，不是「它看起来会红」。改法是把通用那份挪到**最后**声明
（模块卡在前、通用卡在后），让**声明序与 §4.7.1 的渲染序方向相反**——排序才是活的。改完之后的变异
实测（M1）证明它真的红了。⚠️ 代价是抽屉那两组也按首次出现序变成 `[模块组, 通用]`（`分组()` 不排序），
B1/B2 的期望值据此改。

### 变异账（8 批；每批都是「注入 → 跑 → **逐字节还原**」，还原后核 `--numstat` 为空 ＋ 五个文件 md5 与备份全等）

还原手段是 `cp <备份> <原文件>`（**不用** `git checkout --`）——备份在仓库外，还原后逐文件 `md5sum` 比对。

| # | 变异（产品码里改的那一行） | 恰红 | 绿 |
|---|---|---|---|
| **M1** | `instruction-cards.tsx` 的 `通用优先` **左右对调**（通用排到后面） | A1 A2 | 4 |
| **M2** | `projection.ts`：`module: 清单.module` → `module: 条.skill`（来源换掉） | A1 A2 | 4 |
| **M3** | `projection.ts`：`context` 支改收 `张.layer === "common"` | A1 A2 A3 | 3 |
| **M4** | `projection.ts`：`drawer: 分组(all)` → `分组(all.slice(0, 1))` | B1 B2 | 4 |
| **M5** | `skill-drawer.tsx`：条目名 `{条.name}` → `{条.skill}` | B1 B2 | 4 |
| **M6** | `context-cards.tsx`：摘掉上下文筛选（`该浮出的()` ＝ 全部） | A3 | 5 |
| **M7** | `command-palette.ts`：`label` 由 `/${条.skill}` → `/${条.name}` | C1 | 5 |
| **M8** | `projection.ts`：去掉「通用清单永远算数」那一支 | A1 A2 B1 B2 C1 | 1 |

**结论（按 `#003-03` 三类如实记，这批全是第 ① 类「恰红目标那几条」）**：
6 条用例**每一条**都至少被一个变异点红 ⇒ 没有恒绿的用例。M1 与 M2 的红集**完全相同**（A1 A2），
说明这两处是**同一条性质的两半**（渲染层的排序 ＋ 投影层的来源字段），少任何一半这条断言就废
——这也正是「两侧各测各的、缝没人测」会漏掉的东西。M8 的红集最大（5 条），因为「通用清单永远算数」
是四层共用的前提。

### 门禁（2026-10-07 实测，**串行**跑；`#003-01`）

| 门 | 结果 |
|---|---|
| 单文件 lint（**在仓库根**跑，`#004-10`） | **0 warnings / 0 errors**（161 rules） |
| 根 `lint:openhive` | **23 warnings / 0 errors**（与 T012 基线同值 ⇒ **本次新增文件 0 命中**） |
| `packages/app` typecheck（`tsgo -b`） | **EXIT=0** |
| 新文件 | **6 pass / 0 fail / 14 expect**（3.25s） |
| `ai-session` 组件测试（**7** 个 `.tsx`） | **90 pass / 0 fail / 173 expect**（8.88s） |
| `ai-session` 单测（**4** 个 `.ts`） | **47 pass / 0 fail / 71 expect**（2.32s） |
| 两道目录门（`openhive-module-dirs.test.ts` ＋ `workspace/design-token-refs.test.ts`） | **6 pass / 0 fail**（本文件是 `*.test.tsx`，**在 `design-token-refs` 的扫描范围外**——见该文件 `收集源文件()` 的 `if (/\.test\.(ts|tsx)$/.test(路径)) continue`） |
| `git diff --stat bun.lock` | **空**（本条没跑 `bun install`） |

⚠️ **跑 `.tsx` 测试要用包脚本那条命令，不能裸跑**（本轮实际踩了一次，写在这里省下一个人重踩）：
`bun test ./src/ai-session/xxx.test.tsx` 会抛
`Client-only API called on the server side`（`solid-js/web/dist/server.js` 那条），**既有文件也一样**——
因为缺 `--conditions=browser` 与 `--preload ./solid-jsx.ts`。正确形状照 `package.json` 的
`test:components`：

```bash
cd packages/app && bun test --conditions=browser --preload ./happydom.ts --preload ./solid-jsx.ts <文件>
```

（`bunfig.toml` 的 `[test] preload = ["./happydom.ts"]` 只补了 happy-dom 这一半；JSX 那一半在
`solid-jsx.ts`。**这不是本条引入的**——`context-cards.test.tsx` 用裸命令同样抛。）

### 上游侵入面

**零。** 本条不碰任何上游文件（`packages/app/src/ai-session/` 是 openhive 自有目录）。

---

## T014 出参 · 高风险动作强制人确认（判定之后那一跳 / SC-003 · 2026-10-07）

### 产品码落点

**零。** 本条是 `[INT] 写测试`，产物**就是测试本身**——新建
`packages/opencode/test/permission/openhive-highrisk-gate.test.ts`（**4 条 / 16 expect**）。
T012 那份清单（`.opencode/opencode.jsonc`）**只读**：4 批变异全部逐字节还原（`md5sum -c` 全 OK）。
⚠️ 与 T013 不同：T013 是前端 `.tsx`（要 `--conditions=browser` 那一套），本条是 `packages/opencode`
的 Effect 测试，**没有**那些预载要求。

### 开工第一件事：先把出参收窄（`#005-09`：先读挂账，别把已挂的当新缺口）

| 已被别处占住的事 | 对 T014 的约束 |
|---|---|
| **`ask` / `reply` 的机制**（once / always / reject / 同会话连坐 / 事件）——`test/permission/next.test.ts` 有一整组 | 本文件**不重写** `reply` 语义 |
| **前端自动应答开关默认关**——`packages/app/src/context/permission-auto-respond.test.ts:34` | 不重测那个开关 |
| **T012 已如实挂账的两条天花板**（模式匹配天生可绕过 / 真弹窗要前端＋真会话） | **只引用，不重报**（`#005-09`） |

T012 的文件头自己写明了它**止步于** `evaluate()` 的判定；**判定之后那一跳**（挂不挂得住、拒了跑不跑）
就是本条的唯一增量——这也是它那 6 条**证不到**的一段。

### 真链（读码，非推断）

```
真 shell 工具的 collect() → scan.patterns / scan.always
  → ctx.ask（生产形状：merge(agent.permission, session.permission ?? []) ＋ Effect.orDie）
  → Permission.ask()：命中 ask ⇒ 挂 pending ＋ publish Event.Asked ＋ **阻塞在 Deferred 上**
  → 测试扮演「民警」调 reply(reject / once)
  → 工具：die（RejectedError，命令一步没跑） / 真的执行
```

`ctx.ask` 那一行逐字照 `session/tools.ts` 写，**含 `ruleset` 那一项**（`#004-07`：判据清单要照
**被调方**逐项打勾——省了它 `ask` 会按「未知 permission」兜底，测试看着还绿）。

### 出参：4 条，各自「凭什么不是重复」

| 用例 | 断的是什么 | 凭什么不是别处的重写 |
|---|---|---|
| **①** 真挂起 | `待办.length === 1`；`{permission, patterns, always}` 逐字等于 `{bash, [命令], ["rm *"]}`；**靶子仍在**；交叉核对「`always[0]` 就是产品声明成 ask 的那条」 | T012 止于「判定是 `ask`」；这条接的是「判定之后**真挂住** ＋ 命令**真没跑**」 |
| **②** 拒绝 ⇒ 零副作用 | 先证靶子在（前置）→ reject → **靶子仍在**（被测属性在前）→ `Exit.isFailure` ＋ `Cause.squash` 是 `RejectedError` | `next.test.ts` 钉的是 `Pending` 被拒这个**机制**；这条钉的是**工具这一侧**的结局（`.pipe(Effect.orDie)` 真的 die 了） |
| **③** 对照：放行 once ⇒ 真删除 | 靶子没了 ＋ `Exit.isSuccess` | 没有它，② 的「还在」可能只是「**这条命令根本跑不动**」——文件头坑 ① 那个反斜杠就是这个形状（`#004-08`） |
| **④** 对照：不在清单里的命令 | `记录.length > 0`（**真问过**）＋ 记录里每条 pattern 都不在清单 ＋ `Exit.isSuccess` ＋ `pending` 为空 ＋ 命令真跑 | 「没人被拦」与「**压根没问**」是两件事（同 `#004-08` 的判据形状） |

### ⚠️ 两个夹具坑（都实测过，写进文件头）

① **命令里的路径必须走正斜杠**。`rm -rf C:\…\victim` 退出码是 **0**，而 victim **一个都没删**——
bash 把反斜杠当转义吃掉、`-f` 又把不存在的路径静默放过。这正是 `#004-08`「没报错 ≠ 执行了」，
也正是 ③ 那条**对照**存在的理由。
② **shell 必须显式 pin**。`shell.ts` 走 `Shell.acceptable(cfg.shell)`；不给就是 `select(process.env.SHELL)`，
win32 兜底取 `win()[0]`（本机顺序表里 `pwsh` 缺、落在 **powershell**），而 `rm -rf` 在 PowerShell 下
**参数不合法** ⇒ 同一份测试会**看谁在跑**而红绿不同。故 pin 成 Git Bash（同 `test/tool/shell.test.ts`）。

### 变异账（4 批；每批「注入 → 跑 → 逐字节还原」，还原后 `md5sum -c` 全 OK ＋ `--numstat` 为空）

| # | 变异（注入哪一侧、改了什么） | 恰红 | 绿 |
|---|---|---|---|
| **M1** | `.opencode/opencode.jsonc`：`"rm *": "ask"` → `"allow"` | **① ② ③** | ④ |
| **M2** | 测试文件：靶子路径去掉 `.replaceAll("\\", "/")` | **③** | ①②④ |
| **M3** | `.opencode/opencode.jsonc`：整份清单换成 `{"*": "ask"}` | **① ④** | ②③ |
| **M4** | 测试文件：在 ① 的「被测属性」断言**之前**插入 `reply once` ＋ 等命令跑完 | **①**（红在**目标断言**） | ②③④ |

⇒ 4 条用例**每条**都被至少一个变异点红，**无恒绿者**。

- **M1 的红集**（①②③）说明前三条**共用同一个前置**：「`rm *` 是 `ask`」。M1 之下 ① 的 `等挂起`
  会 3s 超时 `Effect.die`（请求根本没挂上来）⇒ 「闸门没生效」以**明说**的样子红，不会伪装成别的。
- **M3 的红集**（①④）正是那两条**带警报语义**的断言：① 的交叉核对（`always[0]` 不再命中清单）
  与 ④ 的「不该被拦」（`记录.every(… === undefined)` ＋ `pending` 为空）——`#004-02` 那两条**故意
  会红**的断言在这里各显形一次。

⚠️ **M4 做砸过两次，两种形状都记下来（`#003-03` 的「三类」之外还有「空转」这一类）**：
- **第一版**把 ① 收尾的 `reject` 换成 `once` 却**没等命令跑完** ⇒ 红的是**收尾那句重复 reply** 抛的
  `Permission.NotFoundError`（`permission/index.ts` 的 `reply`）——**红错了地方**，没证到目标；
- **第三版**（本次复跑）只把收尾换成 `once` ⇒ **4 pass / 0 fail 全绿**——因为 ① 的三条断言**全都写在
  `reply` 之前**，动「断言之后」的代码**根本不在被测性质的前置上** ⇒ **空转**；
- 正确形态是**第二版**：把注入点挪到**断言之前**（先放行、等命令真跑完，再看那条「靶子仍在」）
  ⇒ **恰红 ① 且红在目标断言**（`Expected: true / Received: false`）。
**判据一句话**：变异必须落在**被断言那件事的前置条件**上——落在断言**之后**是空转，落在会让用例体
**提前中止**的地方是红在别处。（`#005-15` 的同族：那条讲「拆掉哪一行它会红吗」，这条讲「**拆的位置
对不对**」。）

### 门禁（2026-10-07 实测，**串行**跑；`#003-01`）

| 门 | 结果 |
|---|---|
| 单文件 lint（**在仓库根**跑，`#004-10`） | **0 warnings / 0 errors**（161 rules） |
| `packages/opencode` typecheck（`tsgo --noEmit`） | **EXIT=0** |
| 新文件 | **4 pass / 0 fail / 16 expect**（18.55s） |
| `test/permission/`（**4** 个文件，含新文件） | **95 pass / 0 fail / 174 expect**（76.49s） |
| 既有三个文件（`openhive-highrisk-ask` / `arity` / `next`）单独跑 | **91 pass / 0 fail**（＝ T012 时的基线值，**新文件没影响它们**） |
| `git diff --stat bun.lock` | **空**（本条没跑 `bun install`） |

⚠️ 单文件 lint 有个尾巴：第一遍报 **9 warnings**，全是 `typescript-eslint(no-unnecessary-type-assertion)`
（`待办[0]!` 之类的 `!`——本仓 `noUncheckedIndexedAccess` 关着）⇒ 去掉那 9 个 `!` 才 0/0；
**改动只删断言符，不动任何断言**，删完复跑仍是 4 pass / 16 expect。

### 上游侵入面

**零。** 本条不碰任何上游文件；新增的测试在 `packages/opencode/test/permission/`（本仓自己的测试目录）。

---

## T015 出参 · 右栏会话管理三件事（FR-010 / US4 场景 2 · 2026-10-07）

> 裁定补开的一条（见上「未结账单与裁定」与 `tasks.md` 的 Phase 8）：把 T008 留下的两处接缝
> （`onNewSession` / `onSelectSession`）接上，**并入** spec US4 场景 2 里从未排期的「删除会话」。

### 产物（**3 改 ＋ 2 新**，全在 `packages/app/src/ai-session/`）

| 文件 | 动作 | 说明 |
|---|---|---|
| `session-actions.ts` | **新**（94 行） | 四个导出：`建会话` / `删会话` / `删除后去哪` / `会话路径`。**有判断的那一半**住这里 |
| `session-actions.test.ts` | **新**（180 行） | **13 条**（建 2 / 删 2 / 删完去哪 6 / 切会话 3） |
| `session-panel.tsx` | 改 **+60** | 加 `onDeleteSession?` 接缝 ＋ 行内删除钮（就地二次确认） |
| `session-panel.test.tsx` | 改 **+113 / −1** | 加「删除会话」一组 **5 条** |
| `ai-session-slot.tsx` | 改 **+62 / −14** | 三根接线（`useNavigate`、`报错` 抽成一处、三个 handler） |

（行数取自 `git diff --numstat`，2026-10-07 实测；**不凭记忆填**——`LEARNINGS #003-04`。）

**为什么把判断抽出来单测**：`ai-session-slot.tsx` 是**纯接线、挂不起来**（`useServerSync()` 要活着的
服务器连接，T008 已实测）⇒ 与 `right-pane-source.ts` 同因同法——**依赖注入**让判断那半今天能单测。
接线层只剩「取 SDK → 调这里 → `navigate`」。它剩下那几条**没有断言守着**的，照 `#002-02` 记在缺口表。

### 开工第一件事（铁律 #1：先答「这条 task 的出参，今天在仓库里打得到的吗」）

**三件事都是接线级，现成能力都在**——但**名字**要实测，不能照直觉写：

| 这件事 | 真实出口 | 蓝本（上游调用点） |
|---|---|---|
| 新建 | `api.session.create({ location: { directory } })` | `components/prompt-input/submit.ts:404` |
| 删除 | `api.session.remove({ sessionID })` | `pages/session/timeline/message-timeline.tsx:826` |
| 删完去哪 | `.filter(!parentID && !archived)` ＋ `[i+1] ?? [i-1]` | 同文件 **`:823`** |
| 切换 | **改路由**（不是状态） | `route-session.ts` 的**逆命题** |

⚠️ **`remove` 这个名字是实测的、不是推断**：`DirectorySDK["api"]["session"]` 来自 `createCompatibleApi`
（`utils/server-compat.ts:86`）——一个 **lazy Proxy**，而它底下 v2 生成客户端上那个方法其实叫 **`delete`**
（`packages/sdk/js/src/v2/gen/sdk.gen.ts` 的 `Session2`）。名字是 `CompatibleSessionApi` 那层显式改回来的
（`server-compat.ts:21-32`）。⇒ 写 `delete` **不报错、typecheck 也可能不红**，只会**静默取到 `undefined`**
（`lazyApi` 的 `get` 对非函数非对象直接返回 `sample`），点删除那一刻才 `TypeError`。
**这是本条最贵的一次核对**——已写进 `session-actions.ts` 与测试的文件头。

### 结论：**二次确认按裁定就地做了（无弹层）**，且确认态按**会话 id** 键控

裁定形态（2026-10-07，runbook Step 2 ⑦）：点「删除」→ 钮变「确认删除？」→ 再点才真删。
实现上多走了一步、理由是**数据丢失**：

> `待删` 存的是**会话 id** 而不是 `boolean`。两者在「不切会话」时完全等价；一旦切走，
> `boolean` 会让「**按钮显示的**」与「**它实际会删的**」错位——点过 A 的删除、切到 B、
> 钮上那句「确认删除？」**还在**，一下点击就删掉 **B**。

即 `LEARNINGS #004-02`（两个投影要有**故意会红的**相等断言）在前端的形态：**用同一个值同时决定
显示与动作**。用例 ④ 专钉这条（`createSignal` 换 id ⇒ 按钮当场回「删除」）。

⚠️ **仍留一个自陈的残留**：`待删` 是**粘**的——点过「删除」之后切走、再切回**同一场**，
那句「确认删除？」还在（第二下仍会删，即**仍是两次点击**，不构成单点误删）。**故意不修**
（修它要一个 `createEffect` 盯着 `sessionID` 归零，为一次「多问一次」引一个 effect 不划算），
且**没有断言守着**——已写在 `session-panel.tsx` 的 `待删` 注释里，免得注释比断言强（`#005-15`）。

### 两条不许发明：都照上游做了

- **删除后的落点** = `message-timeline.tsx:823` 那三行（**逐字**搬进 `删除后去哪`）。
  **找不到（`-1`）返回 `undefined`，不「回落到第一场」**——被删的 id 可能来自一份**旧表**
  （`data.session` 还没同步到），那种时候「跳去第一场」是把用户从原位挪走。
- **一场都不剩 ⇒ `/new-session`**（不是留在原地）：蓝本 `pages/session/session-archive.ts:35-38`
  的 `tabs.newDraft(...)`。**不能留在原地**——URL 会继续指着一场**已不存在**的会话，而右栏那条解析链
  是拿它去问服务器的（`right-pane-source.ts`，**没有** catch / reject 处理）。
- **新建后的落点** = 建完拿 id 跳过去（`submit.ts:404` 同款形状），**目录取自当前这场会话**
  ⇒ 新会话落在同一个项目目录里（`建会话` 把它带进 `location.directory`）。

### 变异账（**13 批**，全部实测；每批「注入 → 跑 → 还原」）

| # | 注入 | 结果 |
|---|---|---|
| M1 | `建会话` 丢掉 `location`（只传 `{}`） | **恰红 1**（形状那条） |
| M2 | `删会话` 写死一个 id、不用入参 | **恰红 1**（数据丢失那条） |
| M3 | `删除后去哪` 丢掉「前一邻」回落 | **恰红 1**（②） |
| M4 | 丢掉 `!parentID` 筛 | **恰红 1**（④） |
| M5 | 丢掉 `!archived` 筛 | **恰红 1**（⑤） |
| M6 | 丢掉 `会话路径` 的形状守卫 | **恰红 1**（③，两条断言同红） |
| M7 | `会话路径` 取错段（`段[1]` 当 key） | **恰红 1**（①） |
| P1 | 第一下**就真删**（拆掉整条二次确认） | ⚠️ **整组红：5 条**（`#003-03` 第 ② 类——该组全数，**不是**「恰红 1」） |
| P2 | 第一下不置 `待删`（只 `return`） | **恰红 1**（①） |
| P3 | 第二下不调 `onDeleteSession` | **恰红 1**（②） |
| P4 | 确认态用写死的 id、不读 `props.sessionID` | **恰红 1**（③） |
| P5 | 确认态用 `boolean` 而不是 id | **恰红 1**（④——**正是上一条理由的那条用例**） |
| P6 | 删除钮不挂 `text-v2-state-fg-danger` | **恰红 1**（⑤，视觉那条） |

⇒ **13 批里有 12 批「恰红 1」、1 批「整组红」**（据实记，`#003-03`：不许把第 ② 类写成第 ① 类）。
对照两次：模块侧 **13 pass / 0 fail**、面板侧 **32 pass / 0 fail**。

### 门禁（2026-10-07 实测）

| 门 | 结果 |
|---|---|
| `packages/app` typecheck（`tsgo -b`） | **干净** |
| 单文件 oxlint（**在仓库根**跑，`#004-10`；改动/新增的 5 个文件逐个） | **0 warnings / 0 errors** |
| `lint:openhive` | **23 warnings ＝ T008 记录的基线**（未变，**非本次引入**；本次改动文件 **0 命中**） |
| `bun test ./src/ai-session`（unit，**必须带** `--path-ignore-patterns="**/*.test.tsx"`） | **60 pass / 0 fail / 86 expect / 5 文件**（2.06s） |
| `bun test ./src/ai-session/*.test.tsx`（本目录 components） | **95 pass / 0 fail / 184 expect / 7 文件**（8.05s） |
| `bun run test:components`（**全 app** components ＝ 仓库自己的脚本） | **589 pass / 0 fail / 1265 expect / 35 文件**（20.99s） |
| `git diff --numstat -- bun.lock` | **空** |

⚠️ **一条夹具坑（写进本次的记录、别下次再踩）**：`bun test <目录>` 会把 `.test.tsx` **一起吞进
unit 那一轮**，于是报 **58 条假红**（首跑实测 66 pass / 58 fail / 1 error，跨 12 个文件）。用仓库自己
`packages/app/package.json` 的 `test:unit` 同一个开关 `--path-ignore-patterns="**/*.test.tsx"` 即解
⇒ **报「红了一片」时先看自己有没有带这个开关**（`#003-01`：先怀疑测量，再怀疑被测物）。

### 上游侵入面

**零。** 本条只在 `packages/app/src/ai-session/` 内新增 / 修改；`session-actions.ts` 是本仓自己的文件。

---

## T016 出参 · 右栏导出会话入口（FR-010 / US4 · 2026-10-08）

> Step 5 的 **D2** 补开的一条（原裁定「FR-010 的导出会话本仓没有这个能力」2026-10-07 被复核推翻：
> 能力在上游就在，缺的只是**右栏的入口**）⇒ 用户裁定补进 006。**出参：右栏能把当前会话导出成
> JSON 落盘。**

### 产物（**4 改 ＋ 2 改测**，全在 `packages/app/src/ai-session/`）

| 文件 | 动作 | 说明 |
|---|---|---|
| `session-actions.ts` | 改 **+71 / −5** | 新增 `导出物` 类型 ＋ `导出会话()`（**取 ＋ 拼 ＋ 起名，不落盘**） |
| `session-actions.test.ts` | 改 **+154 / −10** | 加「导出会话」一组 **4 条** ＋ 一个**新**假件 `造客户端`（见下） |
| `session-panel.tsx` | 改 **+25 / −0** | 加 `onExportSession?` 接缝 ＋ 会话行里那颗「导出」钮 |
| `session-panel.test.tsx` | 改 **+93 / −7** | 加「导出会话」一组 **2 条** ＋ hover 组**第 6 条**（F-01 口径从 7 处改 8 处） |
| `ai-session-slot.tsx` | 改 **+36 / −5** | 一行接线：`导出会话(...).then(downloadSessionExport).catch(报错)` |

（行数取自 `git diff --numstat`，2026-10-08 实测；**不凭记忆填**——`LEARNINGS #003-04`。）

### 开工第一件事（铁律 #1：先答「这条 task 的出参，今天在仓库里打得到的吗」）

**打得到**——上游 `utils/session-export.ts` 的三件套已存在、有单测，且**三处生产调用点**可抄
（`session-context-tab.tsx:231` / `message-timeline.tsx:796` / `use-session-commands.tsx:242`，形状一致）。

### ⚠️ 本条最重的一笔：task 条目自己写的**前提是半错的**（tsgo 抓出来的）

`tasks.md` 的 T016 条目原本写着：

> 「`fetchSessionExport` 用到的 `api.session.get` 与 `api.session.messages` 正是右栏 `会话出口`
> （`DirectorySDK["api"]["session"]`）上已有的两个方法 ⇒ 不需要新开取数通道」

**前半句对、后半句错**：`api.session.get` 有，**`api.session.messages` 没有**。写到 `session-actions.ts`
第一次 `tsgo -b` 就红：

```
error TS2739: Property 'messages' is missing in type 'CompatibleSessionApi'
but required in type 'SessionExportClient'.
```

查明（读码，非推断）：**新协议里根本没有 `session.messages` 这个出口**——消息在**另一个命名空间**
（`packages/client/src/contract.ts` 的 `endpointNames["session.messages"] = "list"`；协议侧
`packages/protocol/src/groups/message.ts` 的 `GET /api/session/:sessionID/message`），
且新形状要过 `normalizeSessionMessages` 才拼出 `{ info, parts }`。
而上游三处生产调用点传的**都不是** `api`，是 **`sdk().client`**——那份 `createOpencodeClient` 出来的
**legacy** 客户端（它上面 `session.get` / `session.messages` 是齐的）。

⇒ **一行适配都不用写**：右栏要的 `DirectorySDK.client` 与 `api` 就在**同一个** `ensureDirSdkContext(目录)`
上（`context/server-sdk.tsx` 的 `createDirSdkContext` 同时返回两者）。
**这就是「先抄同族、别自己发明」的价值**（`#004-12`）——我最初照 task 条目去接 `api`，
而三处同族传的从来不是它。

⚠️ **据实记**：这条前提错**不是本批引入的**（是写 T016 条目那天估的），但**只有动手写第一行代码、
让 tsgo 说话**才暴露——`tasks.md` 该条已加更正块，**别**把它读成「补开那天已核实」。
判据一句话：**「右栏有这个出口」是推断，「它的类型上真有两个方法」是事实**（`#005-11` 同族）。

### 出参：4 条，各自「凭什么不是重复」

| # | 钉什么 | 凭什么不是重复 |
|---|---|---|
| ① | 两下取数**按同一个 sessionID**，拼成一份 `{ info, messages }` | 钉的是「取的是**这一场**」——单测直接读**假客户端记下的入参**（两条 ledger），不是读返回值 |
| ② | 文件名交给上游 `sessionExportFilename`（英文标题 ⇒ `clone-pr-in-worktree.json`） | 钉的是「**没有**在这里重写一遍正则」；这条红了说明有人抄了一份自己的清洗规则（`#002-06`） |
| ③ | ⚠️ **中文标题 ⇒ `ses_甲.json`**（上游那条只留 `[a-z0-9_-]`，标题被洗空后回落成会话 id） | 记录 ＋ **哨兵**：本产品会话标题基本全是中文 ⇒ 这是**生产里真正会发生**的那条；哪天有人动那条正则它会红 |
| ④ | 会话取不到 ⇒ **抛出去**（`Session not found: ses_没了`） | 钉的是「失败**向上抛**」——接线层那句 `.catch(报错)` 才有话说（`#004-14`：泄漏/副作用类判据要有一层证明机制是活的） |

组件侧 2 条：**① 点了才交出去、交的是「当前」那一场**（不是列表第一条）；**② 入口坐在会话行上**
（展开列表后导出钮仍只有一颗，对照组是 `session-option` 计数 2）。

### 两条不许发明：都照上游做了

- **入口位置**：判据与「删除」**同**——它是**对当前会话**的动作 ⇒ 放会话行（§4.7.5 没写这一格，
  视觉是 self-decision，见缺口表）。
- **失败回话**：走 `ai-session-slot.tsx` 那处**唯一**的 `报错`（`#002-06`：同一句话不写第二遍）。
- **下载形态**：blob / 文件名 —— 照上游三处，不自己造；`downloadSessionExport` 那一下**不由本函数调用**
  （留在接线层的 `.then`），理由只有**可测性**一条：DOM 那一下留在里面这组就得打桩才测得了。
- ⚠️ **不加「成功 toast」**：上游三处有，但本 task 的**不许发明清单是闭的**，而右栏只有一处 `报错`
  通道 ⇒ **不引第二处**。「导出成功」的反馈就是**文件落了盘**（浏览器自己会说）。

### 变异账（**5 批**，全部实测；每批「注入 → 跑 → 还原」）

| # | 注入 | 结果 |
|---|---|---|
| M-a | `导出会话` 取数写死 `sessionID: "ses_默认"` | **恰红 2**（该组 ① ＋ ④——④ 连**抛出信息里的 id** 一起钉住了） |
| M-b | 起名用 `sessionExportFilename({ id: input.sessionID })`（不看 `info`） | **恰红 2**（② ＋ ③；③ 实得 `ses_.json`，顺带证明「id 走 name 那条路**也会**过一遍正则」——与 `clean \|\| session.id` 那条**不过**正则的路是两回事） |
| M-c | 面板那颗钮写死 `"ses_写死的"` | **恰红 1**（组件 ①） |
| M-d | 列表行里**重复**一个 `data-slot="session-export"` | **恰红 1**（组件 ②，`Received: 3`）＋ **2 条既有列表用例连带红**（`#003-03` 第 ② 类「整组红」，**不是**「恰红 1」） |
| M-e | 摘掉 `session-export` 的 `hover:bg-v2-overlay-simple-overlay-hover` | **恰红 1**（hover 组第 6 条） |

⇒ **据实记**：M-a / M-b 各**恰红 2**、M-d **恰红 1 ＋ 连带 2**——三次都不是「恰红 1」，
**不许把它们写成第 ① 类**（`#003-03`）。M-a / M-b 在**最终代码**上又各跑了一遍（中途因前提更正
重设计过一次，旧代码上的 4 批不算数）。

### 门禁（2026-10-08 实测，**串行**跑；`#003-01`）

| 门 | 结果 |
|---|---|
| `packages/app` typecheck（`tsgo -b`） | **干净**（`EXIT=0`） |
| 单文件 oxlint（**在仓库根**跑，`#004-10`；改动的 5 个文件逐个） | **0 warnings / 0 errors**（161 规则） |
| app unit（`./src/project` ＋ `./src/ai-session`，**同上一批口径**） | **182 pass / 0 fail / 252 expect / 11 文件**（上一批 178 ⇒ **＋4**，正是本批 4 条） |
| `packages/app` 全量 unit（`--path-ignore-patterns="**/*.test.tsx"`，递归 `./src`） | **1006 pass / 0 fail / 3426 expect / 128 文件** |
| `packages/app` 全量 components（递归 `./src`，同官方脚本**同一个文件集**） | **601 pass / 0 fail / 35 文件**（T015 记的 589 是**同一文件集** ⇒ ＋12 是 **T015 之后各批累计**，**不是**本批独占） |
| `session-panel.test.tsx` 单文件 | **41 pass / 0 fail / 75 expect** |
| `git diff --numstat -- bun.lock` | **空** |

⚠️ **一个测量层的小账**（`#005-14` 的口径：自检命令本身也要自检）：仓库自己的 `test:components`
写的是 `./src/**/*.test.tsx`，而**本机 Git Bash 的 `globstar` 是 `off`**（实测 `shopt globstar`
⇒ `off`）⇒ `ls src/**/*.test.tsx` 只出 **25** 个文件，而 `find src -name "*.test.tsx"` 出 **35** 个。
本轮改成 `--path-ignore-patterns="**/*.test.ts"` ＋ `./src` 取到 **35** 个（与 T015 记的 35 一致）
⇒ 两处口径**能对上**，但**别用 `ls src/**/*.test.tsx` 去核文件数**（那个数少 10）。

### 上游侵入面

**零。** 本条只在 `packages/app/src/ai-session/` 内改；`utils/session-export.ts` 是上游文件，**只调用不修改**。

---

## Step 5 出参（一）· 五条 Important 修复（D1 / R-01 / ④-1 / F-01 / F-02 · 2026-10-07）

### 审查面的口径（先把「审了什么」钉住）

Step 5 按 `docs/workspace/dev_tdd.006.md` 的 **6 类**跑（① 韧性 ② 横切一致性 ③ 防御性编码
④「机制通用」成色 ⑤ 前端换皮一致性 ⑥ 上游侵入面），产出 **7 条 Important**（用户裁定原文：
**「7 条全修」**）。7 条各走哪条路：

| 条 | 一句话 | 本批处理 |
|---|---|---|
| **D1** | 会话列表把**整张表**列出来（子会话 / 已归档都点得进去） | ✅ **本节**（已修） |
| **R-01** | 三根线（新建 / 切换 / 删除）**没有在途守卫**，连点两下建出两场（⚠️ **修法落在「两根」**：切换那条是**同步**的、没有在途窗口——2026-10-08 第二轮复核补注） | ✅ **本节**（已修） |
| **④-1** | `CapabilityManifest.module` 打错时 `projectCapabilities` **四层静默全空** | ✅ **本节**（已修） |
| **F-01** | hover 约定落在 **7 处**，清点时**只有 1 处**有断言 | ✅ **本节**（已修；⚠️ **今天是 8 处**——2026-10-08 T016 加了 `session-export`，见 F-01 段末补记） |
| **F-02** | 选中态与 hover **同色**（「必须不同色」那条只有正向断言） | ✅ **本节**（已修） |
| **②-1** | 右栏整条会话链落在**沙箱根**、不感知项目 | ✅ **见「Step 5 出参（二）」**（已修：用户裁定 **B：cookie 通道**） |
| **D2** | 导出会话：能力在（`utils/session-export.ts`）、入口缺 | ➡️ 裁定 **补进 006** ⇒ 另开 **T016**（`tasks.md` 已同步） |

⚠️ **②-1 的原裁定被推翻过一次**：第一轮裁定是「**修：带上项目头**」，真去读链之后发现照字面做是
**回归**——SDK 那条链的目录是 `?directory=` 查询参数，会被 `anchor-workspace.ts` **无条件**改写成
沙箱根，而**只有 005 那四个裸路由**带 `x-openhive-project` 头 ⇒ 只给 `建会话` 加头，新会话会落到
项目目录、而**列表查询仍被改写到沙箱根** ⇒ 新会话**在列表里看不见**。据此回报、用户重新裁定为
**B：cookie 通道**（改 `project-location.ts`，fork 文件、零上游改动）。
另：**②-1 不是 spec 违规**——`grep` 过 `spec.md` / `plan.md` / `tasks.md`，**没有一处**要求会话落在
项目目录；那句要求只存在于本文件（T015 时我自己写的）与代码注释里（`#003-04` 的形状：写下时没核）。

### 五条各是什么 · 落点 · 会红的那一条

**D1 · 会话列表直接把整张表列出来**

- **现象**：`session-panel.tsx` 的 `<For each={props.data.session}>` 吃**全表** ⇒ ① 点进**子会话**
  是一场没有独立上下文的会话；② 点进**已归档**会话 ＝ 把 005 的「归档＝冻结」**绕过**（那道门住在
  **请求**的路径前缀中间件上、管不到「从一份已经取回来的清单里点一下」，`#005-11` 同族）。
  而 `删除后去哪` **早就有**同一份筛选（`!parentID && !time?.archived`）⇒ 两个集合会**分家**，
  且不报错、不变红。
- **落点**：`session-actions.ts` 新增 `可列出的会话`（**唯一一份判据**，`#002-06`），`删除后去哪`
  改为调它；`session-panel.tsx` 的 `For` 改吃它。**共 2 改**。
- **会红的那一条**：`session-panel.test.tsx`「会话行」组的「列表只列**顶层且未归档**的会话」——
  fixture 是 `ses_1` / `ses_子`(parentID) / `ses_档`(archived) / `ses_2`，断的是**筛选后**的全表
  `["资金分析会话", "话单分析会话"]`（断全表而非「被筛的不在」：后者在**顺序被换过**时照样绿，
  `#003-03` ②）。RED 实测**恰红 1 条**（多了 2 条）。

**R-01 · 三根线没有在途守卫**

> ⚠️ **标题是「发现」的名字，不是「修法」的清单**（2026-10-08 第二轮复核补注）：三根线**当时都没有**
> 守卫，而**修法落在两根**——切换那条是**同步**的（只 `navigate`）、没有在途窗口。见下面「落点」那段。
> 补注的理由：`session-actions.ts` 的注释原文把它记成「三根线各配一份」，读起来像「一共该有三份守卫」
> （`LEARNINGS #002-06`：改完一处要 grep 谁引用了它）。

- **现象**：连点两下「＋ 新会话」⇒ **建出两场**，第二场没人认领（界面只跳到第一场）；连点「确认删除」
  ⇒ 第二下在第一下没回来时就发出去了（`session-panel.tsx` 的二次确认在 `await` **之前**就把 `待删`
  归零，拦不住）。⚠️ 与缺口表那条「`待删` 是**粘**的」**不是同一件事**：那条讲「确认态残留」，
  这条讲「同一动作同时在途两份」。
- **落点**：`session-actions.ts` 新增 `在途守卫()`；`ai-session-slot.tsx` 里 `建在途` / `删在途`
  **各一份**（不共用：共用会让「建还没回来时删不了」）。**共 2 改**。⚠️ 切换那条**不配**：它是
  **同步**的（只 `navigate`），没有在途窗口。
- **会红的那一条**：`session-actions.test.ts` 的三条（① 在途忽略 ② 完成后解锁 ③ **失败后**也解锁）。
  ③ 是**失败路径上的 ②**：少了它，`结果.then(() => { 忙 = false })` 这种「只在成功分支解锁」的写法
  会同时过 ①②，而症状最坏——**一次网络抖动之后那颗钮永久没反应**。
- ⚠️ **返回 `Promise<T> | undefined` 而不是 `Promise<T | undefined>`**：`undefined` 要能**同步**
  拿到，调用方才能区分「这次被忽略了」与「这次跑完了」（`async` 函数永远回承诺，两个含义会撞在一起）。

**④-1 · `module` 打错 ⇒ 四层静默全空**

- **现象**：`projection.ts` 声称有「跨 manifest 重名 / 错名」的报警断言（注释里点了 `capabilities.test.ts`），
  实测**该文件里对 `module` 零断言**（`#004-03`：「有 X 钉住」必须 grep 验证）。后果：`module` 打错一个
  字母 ⇒ `projectCapabilities` 四层**全空**，界面上就是「这个模块还没有 skill」，**不报错、不变红**。
- **为什么不能用类型收窄**：`CapabilityManifest.module` 是自由 `string`、`RailEntry.id` 也是 `string`
  （没有 `as const`）、`CenterTabState.module` 是 `Accessor<string | undefined>` ⇒ **运行时告警**才是
  正确的杠杆（不是「懒得改类型」）。
- **落点**：`capabilities.test.ts` **3 条**（① 子集从 `RAIL_ENTRIES` 读 ② 用到的模块集合**逐项钉住**
  ③ **对照**：打错一个字母 ⇒ 四层静默全空）。**只改测试**。
- **会红的那一条**：② 是**带警报语义**的（加一份清单就红，逼人回来回答「这个模块 id 是真的吗」），
  ① 钉「确实是真模块 id」，③ 是**对照**（证明 ① 守的那个洞真的存在）。

**F-01 · hover 约定 7 处只钉了 1 处**

- **现象**：`hover:bg-v2-overlay-simple-overlay-hover` 在本 feature 源码里落在 **7 处**
  （`instruction-cards.tsx` 的 `:78` 卡面 / `:143` 溢出钮；`session-panel.tsx` 的 `session-toggle` /
  `session-new` / `session-delete` / `session-option` / `drawer-entry`），清点时**只有溢出钮那 1 处**
  有断言（`common-cards.test.tsx`）⇒ 另 6 处**改回旧 token 也全套绿**（`#005-07` 的老形状）。
- **落点**：`common-cards.test.tsx` **2 条**（卡面 A / 卡面 B）＋ `session-panel.test.tsx` 新起一组
  **5 条**（①–⑤，一处一条）。**只改测试**。
- **为什么是 5 条、不是 1 条遍历**（`#005-12`）：合成一条「把这 5 个槽过一遍」时，摘掉其中一处只会让
  **那一条**红，而红的集合读不出「是哪个落点漏了」——这条纪律要的正是那个信息。
- ⚠️ **判据的边界**（`#002-02` / `#005-15`，注释里也写了）：只断 `className` **串**（happy-dom 不跑
  布局、不解析 CSS，`#005-07`）⇒ **hover 真的会不会变色量不出来**，证的是「那串类名还在」。每条的
  **对照**是「那一处的**容器**不带 hover」——它**不**防「容器与叶子同时带上」，那种改法两条都还是绿的。
- ⚠️ **2026-10-08 补记（T016）：本条口径已从「7 处」变「8 处」，上面那张表与这段都是 T015 当时的快照。**
  T016 给会话行加了 `session-export`（导出钮，**同一档视觉**：`hover:bg-v2-overlay-simple-overlay-hover`）
  ⇒ `session-panel.tsx` 那一侧由 5 处变 **6 处**，`session-panel.test.tsx` 的 hover 组同步加第 **⑥** 条。
  **上面的「7 处 / 5 条」不要改**（那是当时的取证快照，`#004-05`：记录一次测量的保留、标时点）；
  要核**当前**值跑：`grep -c "hover:bg-v2-overlay-simple-overlay-hover" packages/app/src/ai-session/session-panel.tsx`
  （现应 **6**）＋ 同法数 `instruction-cards.tsx`（**2**）⇒ 合计 **8**。
  ⚠️ 这正是 `#002-06`「改一处就 grep 谁引用了它」的形状：**新增一处 hover 时，第一个要回来改的是这张表**。

**F-02 · 选中态与 hover 同色**

- **现象**：「选中态与 hover **必须不同色**」（`DESIGN.md:311`；`instruction-cards.tsx:60` 那段注释
  写着同一句），而这条只有**正向**断言（「选中 ⇒ 带浅金」），没有一条钉「选中 ⇒ **不带** hover」。
  ⇒ 把 `classList` 里那句 `: !props.选中`（`:78`）写成无条件的静态类，**全套仍绿**，而表现是
  「悬停时那张选中的卡像坏了」。
- **落点**：`common-cards.test.tsx` 的「hover 面 B」一条。**只改测试**。
- **两面互不耦合**（这是能拆成两条的前提）：A 的对照是「容器不带 hover」，B 的对照是「那张卡**确实是
  选中的**（带浅金）」⇒ 所以「整行删掉」只红 A、「改成无条件」只红 B。若把 B 的对照写成「另一张未选中
  的带 hover」，两次变异会一起红、归属又糊了。

### 变异账（**12 批**，全部实测；每批「注入 → 跑 → **逐字节还原**」）

| # | 注入 | 结果 |
|---|---|---|
| 1 | **D1**：`<For each={可列出的会话(props.data.session)}>` → `each={props.data.session}` | **恰红 1**：那条筛选用例（37 pass / 1 fail） |
| 2 | **R-01 a**：`if (忙) return undefined` → `if (false) return undefined` | **恰红 1**：① 在途忽略（15 pass / 1 fail） |
| 3 | **R-01 b**：`结果.finally(…)` → `结果.then(…)`（只在成功分支解锁） | **恰红 1**：③ 失败后解锁 |
| 4 | **④-1**：`MANIFESTS[0].module` 的 `GENERIC_MODULE` → `"通用2"` | **恰红 2**：① 真模块 id ＋ ② 集合逐项钉住；**③ 对照不红**（它用自己的夹具） |
| 5 | **F-01 卡面（删行）**：`instruction-cards.tsx:78` 整行删掉 | **恰红 1**：`hover 面 A`（52 pass / 1 fail） |
| 6 | **F-02 卡面（改无条件）**：同处 `!props.选中` → `true` | **恰红 1**：`hover 面 B` |
| 7 | **F-01 溢出钮**：`instruction-cards.tsx:143` 摘 token | **恰红 1**：溢出钮那条 |
| 8–12 | **F-01 ①–⑤**：`session-panel.tsx` 的 **5 处 `hover:bg-v2-overlay-simple-overlay-hover`** **逐处**摘 token（**5 批**） | **各恰红 1**，且红的正是该槽那一条（①…⑤） |

⚠️ **上面第 8–12 批原来记的是行号 `229 / 239 / 255 / 282 / 327`——那是当时的快照，已经漂了**
（`#004-05`：取证快照要带时点与取数命令）。2026-10-08 复量是 **`230 / 240 / 256 / 283 / 328`**，
逐行 +1：D1 给该文件加了一行 import。取数命令（**仓库根**跑）：
`grep -n "hover:bg-v2-overlay-simple-overlay-hover" packages/app/src/ai-session/session-panel.tsx`。
⇒ **别拿行号去核这 5 处，拿这个 grep 的 5 条命中去核**（`#002-06`：会随编辑变的值写取数命令，不写死）。

⚠️ **拆成两条的代价与收益**（批次 5/6 的由来）：第一版把 F-01 卡面与 F-02 合成**一条**，两次变异
**红在同一条用例上**、归属读不出来 ⇒ 拆成 A / B 两条、各配**不耦合**的对照后，**摘哪处、红哪条**
（`#005-12`）。批次 5/6/7 每次跑的都是**两个文件合起来**（`common-cards.test.tsx` ＋
`session-panel.test.tsx`），所以「恰红 1」是**跨这两个文件**的计数。

⚠️ **一条非测试的实测**（本批**引入**的命中，别当成老账）：`session-panel.test.tsx` 的
`oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion` 原本贴在 `const 造会话` 那一行上，
而 D1 给 `造会话` 加了 `额外` 展开之后，命中的**报告节点从左值那行挪到了断言表达式那行**
⇒ 实测：**HEAD 版本该文件 0 warnings，加了展开 1 warning**（复现命令：把 `git show HEAD:<该文件>`
落到同目录下的临时 `.tsx` 里、在**仓库根**跑 oxlint，量完删掉）。修法＝把 disable 注释挪到**断言那一行**，
复跑 **0 warnings / 0 errors**（161 规则）。⚠️ 这是**位置**类的事实，落笔前量过（`#003-04`）。

### 一个测量层的小账（本批差点写成「文档数字不一致」）

T015 门禁表里那条 `95 pass / 184 expect / 7 文件` 用的 glob 是**非递归**的
`./src/ai-session/*.test.tsx`；本轮一度用**递归**的 `./src/ai-session` 量到 `155 / 270 / 12 文件`
——两个数**不是同一条命令**，谁也证不了谁错（`#003-01`：先怀疑测量，再怀疑被测物）。
用**原命令**复跑：**103 pass / 200 expect / 7 文件**，比 T015 记录的 **+8**，正好等于本批给这两个文件
加的 8 条（`session-panel.test.tsx` +6 ＝ D1 一条 ＋ hover 五条；`common-cards.test.tsx` +2）。
⇒ **T015 那个数不改**（它是自己那条命令的快照，`#004-05`：取证快照带时点与取数命令），本轮的数
按本条命令记。

### 门禁（2026-10-07 实测，**串行**跑；`#003-01`）

| 门 | 结果 |
|---|---|
| `packages/app` typecheck（`tsgo -b`） | **干净** |
| 单文件 oxlint（**在仓库根**跑，`#004-10`；本批 7 个改动文件） | **0 warnings / 0 errors**（161 规则，3.6s） |
| `bun test ./src/ai-session`（unit，**必须带** `--path-ignore-patterns="**/*.test.tsx"`） | **66 pass / 0 fail / 99 expect / 5 文件**（+6：`session-actions.test.ts` +3、`capabilities.test.ts` +3） |
| `bun test ./src/ai-session/*.test.tsx`（**同一非递归 glob**，与 T015 那条可比） | **103 pass / 0 fail / 200 expect / 7 文件** |
| `bun test ./src/ai-session`（**递归**，含 `.test.tsx`） | **169 pass / 0 fail / 299 expect / 12 文件** |
| `git diff --numstat -- bun.lock` | **空** |

### 上游侵入面

**零。** 本批 7 个改动文件全部在 `packages/app/src/ai-session/`（本仓自有目录）；
`ai-session-slot.tsx` / `session-actions.ts` 都是本仓自己的文件。

### 顺带更正的两处文档不准确（座位 ② 的清点 · 都按实测改）

1. **`session-panel.tsx` 的三处注释说生产组装在 `workspace-entry.tsx`**（`useSync()` 注入 `data` /
   传 `projectCapabilities` / 改 `sessionID`）——**过时**。实测：今天的生产组装是
   **`ai-session-slot.tsx`**，而 `workspace-entry.tsx` 只把 `right` 访问器交给
   **`layout-new.tsx:57`** 的 `right={() => <AiSessionSlot />}`（取数命令：
   `grep -n "SessionPanel\|AiSessionSlot" packages/app/src -r --include=*.tsx`，
   `workspace-entry.tsx` 侧**零命中** `SessionPanel`）。已把三处注释改点名 `ai-session-slot.tsx`。
2. **缺口表那条「005 的归档＝冻结门在 `session.remove` 上没有断言」里对 005 测试面的枚举不全**。
   原句写「005 的测试打的是 `POST /api/session` 与 `GET /api/session/:id`」；实测（取数命令：
   `grep -ohn '"/[a-zA-Z0-9/_:?=$-]*"' packages/opencode/test/server/openhive-project-frozen*.test.ts`）
   出现的路由是 `/session`(4) · `/api/session`(2) · `/api/session/foo`(1) · `/permission`(1) ·
   `/openhive/project/restore`(1) · `/file?path=`(1) · `/`(2)。已按实测改。
   ⚠️ 顺带记一笔**实测**：`LEARNINGS #005-11` 那句「三份 `openhive-project-frozen*.test.ts`」，
   本仓今天只有**两份**（`openhive-project-frozen.test.ts` / `openhive-project-frozen-pending.test.ts`）。
   **LEARNINGS 条目已冻结、不改**（该文件自己的规矩），此处只留实测供下一个人核。

---

## Step 5 出参（二）· ②-1 修复（**B：cookie 通道** · 2026-10-07）

### 为什么必须有第二个通道（开工前的实测，不是推断）

服务端的「当前项目」原本只有一个通道：请求头 `x-openhive-project`（005 裁定 ① 建立）。它是**显式意向**
——值不合法 ⇒ 400、指向已归档项目 ⇒ 403。右栏那条链**够不着它**，而这**不是「fork 侧忘了写」，是没有缝**：
右栏的目录作用域客户端由**上游** `context/server-sdk.tsx` 的 `createDirSdkContext` 造、会话数据走
`context/server-sync.tsx`，**两份都是上游文件** ⇒ 照「给每条请求加个头」去修，等于改两处上游
（第一号约束），**而且改不干净**：只有 005 那四个裸路由带头 ⇒ 新会话落项目目录、**列表仍被改写到
沙箱根** ⇒ 新会话在列表里看不见。**这就是第一轮裁定的字面做法，实测是回归。**
⇒ 用户第二次裁定（2026-10-07）：**走 cookie**。cookie 的特别之处是**浏览器对每一条同源请求自动附带**，
于是 SDK 那条链**不写一行**也带上了它。判据一句话：**头是意向，cookie 是环境。**

### 用户第三次裁定：环境信号不构成归档意向

cookie 每一条请求都带 ⇒ 若照头那套语义（已归档 ⇒ 403）处置，**当前项目被归档那一刻整个 app 变砖**：
`GET /openhive/project/list` 也会 403 ⇒ **项目清单读不到、用户切不出去**（唯一挡住它的是「这个请求压根
没带项目」）。⇒ 两条通道**语义不同**，下面这张表**就是实现**：

| 情形 | 头 `x-openhive-project`（**意向通道**） | cookie `openhive_project`（**环境通道**） |
|---|---|---|
| 值不合法（`..` / 含分隔符 / 空） | **400**（照旧） | **当作没带** ⇒ 落沙箱根 |
| 指向**已归档**项目 | **403**（照旧，005 的门） | **当作没带** ⇒ 落沙箱根、**200** |
| 指向查不到的项目 | **落沙箱根、200**（R5 直通，`:462`，**不是 400**） | 当作没带 ⇒ 落沙箱根 |
| **两者都在场** | **头优先** | **一次都不看** |
| 谁都没来 | 不改写请求（照旧） | 同左 |

⚠️ 「已归档 ⇒ 当作没带」**不等于**放开了「归档＝冻结」：会话作用域那条链上还有**另一道门**
（中间件里 `isArchived` 的**第二个取用点**——从**会话行自己的目录**反解 projectId ⇒ 已归档 ⇒ 403）
继续守着 005 那条规则。本次让开的只是**目录上移那一步**。
⚠️ 但「两道门共用 `isArchived`」是**推断**，「这条出口上它**真的**生效」才是**事实**（`LEARNINGS #005-11`）
——共用这件事写在中间件文件头，**由 005 的 frozen 测试面见证**；其中 `session.remove` 那条出口今天
**零断言**，已单列在缺口表（**非本批引入**，T015 时记的）。

### 落点（2 处产品码 ＋ 2 处测试 ＋ 1 处注释）

| 文件 | 改什么 |
|---|---|
| `packages/opencode/src/server/routes/instance/httpapi/middleware/project-location.ts` | 新增 `PROJECT_COOKIE`（＋客户端契约的文档块）；读两个通道（`headerProjectId ?? cookieProjectId`）＋ `const ambient = headerProjectId === undefined`；**两处**（非法支 / 归档支）各加 `if (ambient) return yield* effect`；文件头新增「第四笔裁定」，并更正三处会随本次变旧的旧话（「没有项目头 ⇒ 不改写请求」等） |
| `packages/app/src/project/current-project.ts` | `setCurrentProject` 从「裸信号 setter」变成**唯一写入点**（写信号 ＋ 写/清 cookie）；新增 `writeProjectCookie` |
| `packages/opencode/test/server/openhive-project-directory.test.ts` | 新 `describe` **6 条**；夹具改造：`as()` 拆出 `sessionCookie()` ＋ 加 `extraCookie` 参数、`createV1As` / `createV2As` 加 `projectCookie?`、新增 `标成已归档` |
| `packages/app/src/project/current-project.test.ts` | **新文件 · 5 条** |
| `packages/app/src/ai-session/ai-session-slot.tsx` | 那条「②-1 尚未修」的注释改成现状（**只有注释**） |

⚠️ 顺带修的**夹具缺陷**（本批唯一「改测试基建」的动作）：原 `as()` 用 `headers.set("Cookie", …)`
**整份覆盖** ⇒ 直接把第二个 cookie 传进去会被身份那条挤掉，会造出「带着 cookie 却什么都没带」的
**假绿**（`LEARNINGS #004-08` 同族：没报错 ≠ 执行了）。改成 `sessionCookie()` ＋ `Cookie` 头**一次拼好**
（`jar.join("; ")`）。

### 会红的那一条（RED 实测）

**服务端 6 条**（`openhive-project-directory.test.ts` 的 `describe("项目 cookie 通道（006 Step 5 · ②-1）")`）：

| # | 钉的是什么 | 会红的那一条断言 |
|---|---|---|
| ① | **B 链**（v2 / SDK 那侧）只带 cookie ⇒ 落 `{沙箱根}/{projectId}` | 落点相等（且**在沙箱根之内**） |
| ② | **A 链**（v1）同 | 同上 |
| ③ | **头优先**：头指向查不到的项目 ＋ cookie 指向存在的项目 ⇒ 落**沙箱根** | 落点相等（**不是** cookie 指的那个目录） |
| ④ | 环境通道遇**已归档** ⇒ 当没带、落沙箱根、**200** | 状态码 200 ＋ 落点 |
| ⑤ | **对照**：同一已归档项目走**头** ⇒ **403** 且 `sessionCount` 不变 | 403 排在**副作用**之前（`#004-14`：被测的安全属性在前、伴随信号在后） |
| ⑥ | 环境通道值**非法**（`../../bob`）⇒ 当没带、落沙箱根、**200** | 状态码 200 ＋ 落点 |

**客户端 5 条**（`current-project.test.ts`）：写 id / 甲→乙切换 / `undefined` ⇒ 清掉 / **没有 id** 的项目 ⇒
清掉且**不写 `=undefined`** / **对照**：cookie 与信号同步（没 id 的项目照样进信号）。

⚠️ **RED 那天只有 2 ＋ 2 条真红，另 7 条当场就是绿的**——**据实记**（`#003-03` 第 ③ 类的近亲）：那 7 条
钉的是**退化语义**（「环境通道不产生错误」），而退化那一支**恰好就是当时的行为**（cookie 压根没人读）
⇒ 它们在 RED 阶段**不可能红**。它们的牙只能靠**变异**证（下面 9 批），**不能靠 RED**——这句就是给下一个人
看「为什么这个文件的 RED 账不平」的。

### 变异账（9 批，全部实测；每批「注入 → 跑 → 逐字节还原 → 复跑基线全绿」）

服务端 6 批（基线 **16 pass**）：

| 批 | 注入 | 结果 |
|---|---|---|
| **M1** | cookie 不被读（`const cookieProjectId = undefined`） | **恰红 2**（①② 两条链各一条），其余 4 绿 |
| **M2** | 通道顺序反过来（`cookieProjectId ?? headerProjectId`） | **恰红 1**（③：头没压过 cookie） |
| **M3** | 非法支忽略环境通道（`if (false)`） | **恰红 1**（⑥） |
| **M4** | 归档支忽略环境通道（`if (false)`） | **恰红 1**（④） |
| **M5** | 归档支**无条件**当没带（`if (true)` ——**反向批**） | **恰红 1**（⑤ **对照**）、15 pass |
| **M6** | 非法支**无条件**当没带（`if (true)` ——**反向批**） | **恰红 1**（**既有的**「`..` 被拒」那条）、15 pass |

客户端 3 批（基线 **5 pass**）：

| 批 | 注入 | 结果 |
|---|---|---|
| **N1** | 一个字都不写（`writeProjectCookie` 直接 return） | **恰红 2**（写 / 切换）；⚠️ 两条「清」的用例**照旧绿**（一个字都没写时没什么可清——**记下来**，免得被读成「N1 覆盖了全部五条」） |
| **N2** | 朴素 `${project?.id}`（去掉 undefined 那一支） | **恰红 2**（清 / 无 id），实得值 `"undefined"` |
| **N3** | 只写不清（`if (id === undefined) return`） | **恰红 2**（清 / 无 id），实得值 = **旧项目 id** `prj_alpha_0001` |

⚠️ M5 / M6 是**反向**批（`#003-03` 第 ② 类）：它们不证明新代码有牙，证明的是**对照组自己有牙**——
⑤ 与既有的 400 那条不是「顺手写的绿」，拆掉各自守的那一半它们会红。还原后已复跑基线、并 `grep` 确认
无 `if (true)` / `if (false)` 残留。

### 门禁（本批实测）

| 门 | 结果 |
|---|---|
| `packages/opencode` typecheck（`tsgo --noEmit`） | **干净** |
| `packages/app` typecheck（`tsgo -b`） | **干净** |
| 单文件 oxlint（**在仓库根**跑，`#004-10`；本批 5 个改动文件） | **0 warnings / 0 errors** —— 根配置 **130 规则** 7.2s；`-c script/oxlintrc.openhive.json`（＋jsx-a11y）**161 规则** 6.9s（与上一批同一口径，可直接比） |
| `bun test test/server/openhive-project-directory.test.ts` | **16 pass / 0 fail / 62 expect**（+6） |
| `bun test`（opencode：目录 ＋ 两份 frozen） | **27 pass / 0 fail / 123 expect / 3 文件** |
| `bun test ./src/project/current-project.test.ts`（app unit） | **5 pass / 0 fail / 8 expect** |
| `bun test ./src/ai-session`（app unit，**必须带** `--path-ignore-patterns="**/*.test.tsx"`） | **66 pass / 0 fail / 5 文件** |
| `bun test`（app components：`workspace-entry` ＋ `session-panel` ＋ `right-pane-source`） | **142 pass / 0 fail / 327 expect / 3 文件** |
| `git diff --numstat -- bun.lock` | **空** |

⚠️ 第一轮 lint 在新建的 `current-project.test.ts` 上报了 **1 warning**（`no-unsafe-type-assertion`，
＝ happy-dom 的 `happyDOM` 那个 cast），已按本仓先例处置：`oxlint-disable-next-line … -- <理由>`
（全仓 **70 处**同款；`packages/app/src/ai-session/*.test.ts` 里正是用它对夹具断言，且注释写法一致）
⇒ 才是上表那个 0/0。

### 上游侵入面

**零。** 两个产品文件都是 **fork 自有**：`project-location.ts`（005 建）、`current-project.ts`
（005 T005 建）⇒ 不添上游合并冲突面；其余三处是测试（两改一新）＋ 一个 fork 文件里的注释。
**没有动任何上游文件**，也没有新增依赖（`bun.lock` 空）。

### 本批新增的缺口（已并进下面的表）

1. **环境通道的射程远大于断言**：cookie 对**每一条同源请求**生效（文件 / pty / 上传 / 权限 / 项目清单
   全在射程内），而本批只跑了 **6 条**（两条会话链 ＋ 四条语义边界）⇒ 其余出口「带着 cookie 会怎样」
   **没跑过**。⚠️ 这正是 `LEARNINGS #005-11` 的形状（横切机制在**新出口**上自动生效 ⇒ **反而没人去验**）。
2. **归档态翻转导致的落点翻转未测**：项目从「活跃」变「已归档」的那一刻，同一条带 cookie 的请求
   **落点会从项目目录翻到沙箱根**（**推得、未测**）。要测它需要一个「先活跃后归档」的时序夹具。
3. **客户端 `Path=/` 没有任何断言钉住**：happy-dom 的 `document.cookie` **读回完全不按路径过滤**
   （探针实测），构造不出会红的断言 ⇒ 护栏只剩**代码可读性**（写与清在同一个函数、相隔四行、同一个
   `Path`）。已**同时**写进 `current-project.ts` 的注释与 `current-project.test.ts` 文件头的
   「本组不覆盖」（`#005-15`：别让注释比断言强——这里如实标成**缺口**，不标成已覆盖）。

### 一个测量层的小账（工具怪癖两枚 ＋ 一条自伤）

1. **happy-dom 的文档默认是 `about:blank`**，而它**正确地**拒绝往一个没有源 / 没有路径的文档上落 cookie
   ⇒ `document.cookie = "X=1; Path=/"` **整条被丢弃**、读回来是空串。症状极具误导性：两条「cookie
   写上了」的用例红成 `Received: undefined`，看着像**产品没写**，其实是**写入被环境吃了**（`#003-01`：
   先怀疑测量）。对照探针：同一句**去掉 `Path`** 就能写进去 ⇒ 拒的正是产品**必需**的那个属性。
   ⇒ 夹具补 `happyDOM.setURL("http://localhost/")`，**不是**把 `Path` 从被测字符串里删掉让它绿。
2. **happy-dom 的 `Max-Age=0` 不删条目、只把值置空**（读回 `openhive_project=`），而**真实浏览器整条删掉**
   ⇒ 「清掉」那一支的判据写成「**值是空的或不存在**」（服务端的 `cookieValue` 对空值正是
   `if (!raw) return undefined`，两种形态在这个通道的语义上**等价**）——写死任一种，都是在钉 happy-dom。
3. **自伤一处**：本批新建的测试文件第一版把 `--path-ignore-patterns="**/*.test.tsx"` 抄进了文件头的
   块注释 ⇒ 那个 `*/` **提前闭合注释**，炸在第 24 行那句散文上（`Unexpected *`，与真正的原因隔着几行）。
   `LEARNINGS #004-06` 的现形，已在该文件头写明「本注释里刻意不写那个 glob」。

---

## Step 5 出参（三）· 第二轮对抗性验证（2026-10-08）

`#003-02` / `#005-04`：**刚修完的东西**要再当一次靶子，而且要**换一套视角**——同一套视角只会得到
第一轮的复述。本轮的靶子 ＝ `e972d14f44..HEAD` 那**两个提交**（Step 5 的（一）（二）两批修复）。
打法：**五席只读审查**（L1–L5，各自独立读 diff ＋ 读码，**不给它们前一轮的结论**），收回后**逐条自己复核**
（`#004-04`：审查方说的每一句事实性说法，落笔前都去代码/grep 核一遍）。

### 三席独立命中同一处 ⇒ 判 **Important**，用户裁定 **B：启动清掉 cookie**

**现象**：②-1 之后「当前项目」多了一条 **cookie 通道**，而**写入点只有一个**（`setCurrentProject`）——
**没有任何东西在启动时把它拉回来**。cookie 又**活得比页面久** ⇒ **刷新之后**：
信号回到 `undefined`（锚点行显示「未选择项目」）、cookie 却还指着上次那个项目
⇒ **界面说没有项目、请求落在旧项目目录里**。

**为什么它不是 ②-1 的重报、也不是「本来就有」**：②-1 **之前没有任何东西读这个 cookie**
（写它＝往 jar 里放一个没人看的字符串）⇒ 分叉无从成立。它是 ②-1 **自己引入**的新缺口——正是
`#003-02` 说的那个形状（新 Important 长在上一轮的修复里）。三席**独立**得出同一结论，故判 Important。

**用户裁定（2026-10-08）：B —— 启动清掉 cookie。**（另两条：A 什么都不做 / C 改成请求头。
C 走不通的理由就是 ②-1 的立论：右栏那条 SDK v2 链**够不着头**。）

### 落点（1 处产品码 ＋ 1 处测试 ＋ 6 处注释/文档）

| # | 落点 | 改什么 |
|---|---|---|
| 1 | `packages/app/src/workspace/workspace-entry.tsx` 的 `onMount` | **加一行 `setCurrentProject(undefined)`**（裁定 B）；并把那两段注释重写——原话「不选 ⇒ 不发 `x-openhive-project` ⇒ 后端落回沙箱根」在 ②-1 之后**已经是假的** |
| 2 | `packages/app/src/workspace/workspace-entry.test.tsx` | **新一节**（裁定的判据，2 条断言 ＋ 1 条对照）＋ 文件头夹具（`happyDOM.setURL`）＋ 一处过时理由的更正（`#002-06`：改完一处要 grep 谁引用了它） |
| 3 | `packages/app/src/ai-session/session-actions.ts`（**只改注释**） | 「三根线（新建 / 切换 / 删除）各配一份在途守卫」**数错了**——**切换那条是同步的**（只 `navigate`）、没有在途窗口 ⇒ 是**两根**；并补上 ③④ 两条复位路径的出处 |
| 4 | `packages/app/src/ai-session/session-actions.test.ts` | 新增**用例 ④**（**同步抛出**那条复位路径）。⚠️ 它与 ③ 是**两条各钉一条**（异步拒绝 / 同步抛出），缺了它，把实现里那个 `catch { 忙 = false }` 整个删掉**全组照旧绿**（`#005-12`：落点 N 处写 N 条） |
| 5 | `packages/app/src/ai-session/capabilities.test.ts` | 用例③ 原先只断 `.all`，而它的**标题写着「四层」** ⇒ 改成**四层各断一条**（`all` / `common` / `context` / `drawer`）。`drawer` 是**另一个落点**（`projection.ts` 的 `分组`），不是从 `.all` 构造性推出来的（`#005-12`） |
| 6 | `packages/app/src/project/current-project.ts` ＋ `current-project.test.ts` | `PROJECT_COOKIE` 的契约文档：**四处**字面量（原写「三处」——**数错了**）＋ 取数命令；测试文件头如实收窄（**「服务端那个解析器读得到」本组没有断言**，`#003-05`） |
| 7 | `packages/opencode/.../middleware/project-location.ts`（**只改注释**，4 处） | ① 42 行漏了 ` * ` 前缀（JSDoc 没闭合）；② 「`%2E%2E%2Fbob` 能绕过这一行」**把风险说大了**——两条路径**落点一模一样**（都落沙箱根）⇒ 它**不是**逃逸防线；用例⑥ 摘掉解码也绿（`#005-15`）；③ **用例⑤ 挂错了门**（它打 `POST /api/session`，那条路由**没有 `sessionID` 路由参数** ⇒ 第二道门压根不触发；它的 403 来自**第一道门**）；④ 与 6 同因的四处字面量 |
| 8 | `006/state.md` ＋ `006/tasks.md` ＋ `005/state.md` ＋ `005/tasks.md` | 语义表 R5 行（指向查不到的项目 ⇒ **落沙箱根、200**，不是 400）；变异批那行的**行号快照**换成「**5 处**」＋ 漂移说明（`#004-05`）；T016 那节从 **T015 中间**搬走（它原先把 T015 劈成两半）；**005 侧两条补记**——裁定 (4) 的**理由后半句已不成立**，裁定本身不变 |

### 会红的那一条（RED 实测）

`workspace-entry.test.tsx` 新节 —— RED 那天 **95 pass / 1 fail**，红在**第一条**后置断言
（`Expected: "" / Received: "prj_stale_0001"`，`#004-14`：被测属性排在伴随信号之前）。
⚠️ 前置两条（「cookie 真的写进去了」＋「信号真的非空」）**当天就通过了**——这正是夹具生效的证据：
没有 `happyDOM.setURL("http://localhost/")` 那一句，`Path=/` 的写会被 happy-dom 整条丢弃，
**两条后置断言会在任何实现下都绿**（`#004-08`：判「没发生」之前先证明机制是活的）。

### 变异账（2 批，全部实测；每批「注入 → 跑 → 还原 → 复跑基线全绿」）

基线 **96 pass / 0 fail**（本文件）。

| 批 | 注入 | 结果 |
|---|---|---|
| **M1** | 摘掉 `onMount` 里那句 `setCurrentProject(undefined)` | **恰红 1**（cookie 那条），95 pass |
| **M2** | 换成**手搓** `document.cookie = "openhive_project=; …; Max-Age=0"`（绕过唯一写入点） | **恰红 1**（**信号**那条），95 pass —— **cookie 那条照旧绿** |

⚠️ **M2 是本轮的关键一条**：它证明第二条断言**不是第一条的复述**。手搓清 cookie 的实现「看起来也对」，
但它**留着信号** ⇒ 变成「界面还显示着上次那个项目、而请求已经落回沙箱根」——**换了个方向的分叉**
（`LEARNINGS #002-06`：同一个判断两处各写一份，早晚不等）。若当初只写 cookie 那一条断言，这种实现**全绿**。

### 门禁（2026-10-08 实测，**串行**跑；`#003-01`）

| 门 | 结果 |
|---|---|
| `packages/app` typecheck（`tsgo -b`） | **干净** |
| `packages/opencode` typecheck（`tsgo --noEmit`） | **干净** |
| 单文件 oxlint（**在仓库根**跑，`#004-10`；本批 8 个改动文件） | **0 warnings / 0 errors** —— `-c script/oxlintrc.openhive.json`（＋jsx-a11y）**161 规则** 6.3s |
| `bun test`（app components：`./src/workspace` ＋ `./src/project` ＋ `./src/ai-session`） | **608 pass / 0 fail / 1095 expect / 29 文件** |
| `bun test`（app unit：`./src/project` ＋ `./src/ai-session`，**必须带** `--path-ignore-patterns="**/*.test.tsx"`） | **178 pass / 0 fail / 246 expect / 11 文件** |
| `bun test`（opencode：目录 ＋ 两份 frozen） | **27 pass / 0 fail / 123 expect / 3 文件**（与 ②-1 基线逐字相同） |
| `git diff --stat -- bun.lock` | **空** |

### 本批新增的缺口（已并入下面的表）

1. **多标签页**——裁定 B **修不到**（cookie 全浏览器共享）。
2. **「挂载即清」仰赖一条上游事实**（`NewAppLayout` 落在路由根里 ⇒ SPA 不重挂），**今天没有断言钉着**。
3. **头被剥、cookie 留着**——不对称，已写进 `project-location.ts` 的注释，属明账。

### 上游侵入面

**零。** 唯一的产码改动落在 `packages/app/src/workspace/workspace-entry.tsx`——`git log --diff-filter=A`
实测它由 **005 自己的提交**（`54a96ab2b1`）引入，`upstream/dev` 对它**零历史** ⇒ **fork 自有**。
其余 7 个落点里：3 个是测试、2 个是 fork 文件里的**注释**、4 个是文档。

---

## 收尾补测 · 前端结构性缺口（`frontend-testing` skill · 2026-10-08）

**性质**：006 办结之后单独跑的一次**前端结构性缺口闭环补测**，与 005 的「收尾补测 · 后端结构性缺口」
（`backend-testing`，`005-BT-01…04`）是同一条线上的另外半。**产品码零改动**——下面每一条**今天就是绿的**，
不是修缺陷（`git diff --numstat` 对已跟踪文件为空，可复跑）。判据、自愈护栏与归档口径按
`frontend-testing` ＋ `testing-system-blueprint` 走。

### ① 命中的维度（防过度测）

| 层 | 命中 | 依据 |
|---|---|---|
| L0 / L1 测试地基 | ❌ **已存在，只核对** | `test:unit` **1006 pass** ／ `test:components` **601 pass**（口径见 `#006-03`） |
| ① 编译期 token 门 | ❌ **已存在，只核对** | `lint:openhive` 的任意值禁令 ＋ `workspace/design-token-refs.test.ts` 双覆盖（本批零新增） |
| **③ L3 a11y** | ✅ | 右栏有交互组件（卡／溢出钮／抽屉／输入框），且**对比度已知敏感**（dark 选中态） |
| **③ L4 响应式** | ✅ | `spec.md` 把「空间不足收「⋯」、**不用横向滚动条**」写成验收标准 ⇒ 几何硬约束 |
| ③ L4 跨浏览器 | ⚠️ **记缺口**（见 ③节） | `packages/app/playwright.config.ts` 只有一个 chromium project |
| **④ L6 契约 mock** | ✅ | 右栏吃 `/api/session/<id>` ＋ `/api/session?directory=`，而**生产组装那一层从来没被观测过** |
| ⑤ L2 视觉回归 | ⚠️ **记缺口**（见 ③节） | 视觉契约存在，而基线裁决是整套里**唯一**的人审节点 |

### ② 覆盖区分 → 落地的三件产物

| ID | 缺口 | 落点 | 判据 | 风险 | 发布门 |
|---|---|---|---|---|---|
| **006-FE-01** | a11y · 右栏三组组件**没有 story ⇒ axe 照不到** | `packages/app/src/ai-session/instruction-cards.stories.tsx`（7 组）／`session-panel.stories.tsx`（2 组）／`skill-drawer.stories.tsx`（3 组） | 24 格 axe 审计（12 组 story × light/dark） | P1 | 发布前绿 |
| **006-FE-02** | 响应式 · 「空间不足收⋯、不横向滚动」**两个既有测试层都到达不了** | `instruction-cards.stories.tsx` 的 `MeasuredNarrow`／`MeasuredWide` ＋ `packages/app/e2e/a11y/storybook-axe-audit.ts` 的几何那一半 | 16 格（ai-session 全部）／12 格（指令卡） | **P0**（横滚＝布局破） | **硬阻断** |
| **006-FE-03** | 契约 · 右栏**生产组装那一层**（`layout-new` → `AiSessionSlot` → `SessionPanel`）零观测面 | `packages/app/e2e/regression/ai-session-right-pane.spec.ts` | 1 条 / 5 组断言 | P1 | 发布前绿 |

#### 006-FE-01：story 是「审计面」的开关，不是装饰

`session-panel.stories.tsx`（2 组）与 `skill-drawer.stories.tsx`（3 组）为本批新建；
`instruction-cards.stories.tsx` 补齐到 7 组（新增 `MeasuredNarrow`／`MeasuredWide`）。
**每格跑 light ＋ dark 两遍**（审计输出里 `theme-in-DOM` 那一列是证据：dark 那遍 `<html>` 上真有
`data-color-scheme`），因为 axe 只在**选中态那一格**照得出对比度问题。

**实测**（2026-10-08，本条两次独立跑，尾行逐字相同）：

```
合计 1 条违例｜几何 16 格，0 条失格
❌ app-openhive-ai-session-instruction-cards--common-selected [dark]　1 违例
     - serious · color-contrast · Elements must meet minimum color contrast ratio thresholds
```

⚠️ **这 1 条不是新缺口**（`LEARNINGS #005-09`：已挂账的别再当新发现）——它就是本文件缺口表里
「暗色无 `--v2-background-bg-accent-soft`」那条（沿用 005 裁定 R2-09 / U7，**非本次引入**）。
本次的**增量只有一条**：它此前被记在 **rail ／ 005** 那两处落点上，**axe 现在给出第 3 个落点
（指令卡选中态）** ⇒ 根因仍是同一个，而**已知落点数从 2 涨到 3**（`#005-04`：按被改方的**全部落点**
打勾）。⇒ 只引用、不重报；**级别不变**。

#### 006-FE-02：被两条支路绕开的那条路，只有真浏览器到得了

`instruction-cards.tsx` 里有**两条**算宽的路：`props.availableWidth ?? (量到的() || ∞)`。
既有的三组 story **全都显式传了 `availableWidth`** ⇒ 走的是**入参那一支**；而**实测那一支**要
`ResizeObserver`，happy-dom 里**不存在**（组件自己判了 `typeof ResizeObserver === "undefined"` 就
`return`）⇒ `量到的()` 恒为 0 ⇒ 走「不限宽」⇒ **溢出永远不会发生**。也就是说 `spec.md` 那条验收标准
在**两个既有测试层里都到达不了**。这正是 `#004-13` 那个问法的实例——问「我要写的那条断言，是不是
空的」：**不是空的**（它有真实观测面，只是要真浏览器），缺的只是**观测面**。

补法是给**被绕开的那一支**单独开观测面：新增 `MeasuredNarrow`／`MeasuredWide` **不传 `availableWidth`**、
宽度由外层 `div` 给死（视口不变也能确定地窄／宽），且配成**正反两条**（`#005-07`：只写窄的那条时，
「量到的恒为 0 ⇒ 于是永远全显示」这个坏法**照样绿**——因为它也只是「没收」）。审计脚本对**任何**带
`[data-slot="card-row"]` 的 story 跑三条不变量（① 不横向滚动；② **卡片守恒** `可见 ＋ 收进 == 总数`，
总数由夹具外层的 `data-fixture-cards` 声明；③ **有收进 ⇒ 必须有溢出钮**），外加一条跨格单调性。
⚠️ 不变量**不重抄产品那条算式**（`#002-06`）。

**实测**（尾行 `合计 … 几何 16 格，0 条失格`）：

```
measured-narrow 量到宽=320 可见=2 收进=3 总数=5
measured-wide   量到宽=900 可见=5 收进=0 总数=5
```

**变异账（2 批，全部实测；每批「注入 → 跑 → 逐字节还原」）**：

| # | 注入 | 结果 | 类别（`#003-03`） |
|---|---|---|---|
| M1 | **审计脚本**：记录块被我放在 `continue` **之后** | 24 格只剩 **1 格**被记 | **③类（全绿=白）**——**不是测试没覆盖，是整段被跳过**，处置＝**修脚本位置**，不是补测试 |
| M2 | **产品码**：`observer.observe(行)` → `observer.disconnect()`（＝ happy-dom 里的实际情形） | **恰红**：`量到宽=320 可见=5 收进=0 总数=5 —— 横向溢出 204px`，**2 条失格** | **①类（恰红目标那几条）** |

⚠️ **M1 的机制**：记录块被插在 `if (违例.length === 0) { console.log("✅ …"); continue }` **下面**，
于是**每一格干净的 story 都跳过它** ⇒ 唯一被记的恰好是那格**有违例**的。危险在于**它长得像结果**
（「几何 1 格」读起来是「只审到一格」，不会让人想到「代码在 continue 下面」）。
修正后格数 **1 → 16**（`#004-14` 的同族：**书写位置决定你拿到哪条证据**）。

⚠️ **M2 逼出一条诚实的子结论**：变异那一格 **②守恒判据仍然是绿的**（`5 + 0 == 5`，一张都没丢）
⇒ **载荷在①那条（横向溢出）上，②不是**。②管的是「丢没丢」，对「没地方放、但被硬塞进去」
**完全不敏感**（`#005-15`：断言**声称**拦住了什么，要靠变异证，不能靠「它看起来会红」）。

#### 006-FE-03：第一次观测到「生产组装」那一层

`ai-session-slot.tsx` 自陈是**纯接线、在 `bun test` 里挂不起来**（要活着的服务器连接），并把六处
「只有人读代码才看得见」的接线列在那儿。本条用**假后端**（`mockOpenCodeServer` 在浏览器里拦掉全部
后端流量）把「要活着的服务器」这件事满足掉 ⇒ ③ **第一次有了观测面**。它不覆盖 ④⑤⑥ 那些接线的
**行为**（那半边仍归单测），覆盖的是这条链**真的接通了**：路由 → 会话 id → 目录 → 数据 → 面板。

夹具**逐字照同族 spec**（`#004-12`）：`e2e/regression/file-browser-sidebar-tab-switch.spec.ts` 的
**新布局**那条 URL `/server/<base64 serverKey>/session/<id>`。⚠️ **不能照抄
`session-request-docks.spec.ts` 的 URL**——那条是旧布局形态 `/<base64 dir>/session/<id>`，而
`route-session.ts` 明写**不认**它（会被 `NewLayoutLegacySessionRedirect` 重定向掉）⇒ 右栏在那条 URL 上
**故意不亮**。

最强的判据是 `[data-slot="session-current"]` 显示**会话 payload 里的 title**：它非空 ⇒
① 右栏问到了那场会话（`ServerSession.lineage.resolve`）；② 拿会话身上的 `directory` 去取了那个目录的
会话列表；③ 假后端按 `directory=` **过滤**了列表（`session.directory === directory`）——目录错一个字节，
列表就是空的、`session-current` 会退回显示 `sessionID`。**URL 里没有目录可解**，这个 title 只可能来自
会话 payload ⇒ 一条断言同时钉住 006 的设计断言（`route-session.ts` 文件头）。另有一条断言把
**观测到的请求**记下来（`/api/session/<id>` 与 `/api/session?directory=<dir>` 都在），按参数解析、
不拼字符串（`#002-06`）。

**变异账（1 批）**：注入 `directoryOf` 的 `.then((血缘) => 血缘.session.directory + "-wrong")`
⇒ **恰红**在那条 title 断言，实得 `"ses_ai_session_pane"`——正是 `?? props.sessionID` 那条回退
⇒ 证明它**不是恒真的**（`#005-15`）。跑：**`1 passed (34.8s)`**。已逐字节还原。

⚠️ **本机跑法（与 CI 的差异只有一处）**：`@playwright/test@1.59.1` 期望
`chromium_headless_shell-1217`，本机实装 `-1208`／`-1234` ⇒ 默认 `launch()` 必失败。故 spec 里用
**环境变量门控**顶一个已装的可执行文件：**CI 不设 `E2E_BROWSER` ⇒ 这一项不出现、行为与上游完全一致**
（`npx playwright install chromium` 在本机约 18KB/s，不可行）：

```bash
E2E_BROWSER="C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe" \
  bunx playwright test regression/ai-session-right-pane.spec.ts
```

⚠️ **审计脚本那半必须用 `node` 跑**（`AXE_BROWSER=… node e2e/a11y/storybook-axe-audit.ts`）：
bun 的 node 兼容层接不上 Playwright 的 CDP 传输层（同机同 binary 对照实测：`node` ✓534ms ／
`bun` ✗挂到超时），脚本文件头有完整对照。**但这不等于「本机用不了 Playwright」**——`bunx playwright
test` 起的是 **node** 里的 runner ⇒ 那条不兼容**不在这条路径上**（判据：`bunx` 只是转发器，
**不决定被测程序的运行时**）。

### ③ 跳过的维度 → 两条如实记成缺口（`#002-02`：测不了要写成缺口，**不写成覆盖**）

| 缺口 | 为什么今天做不了 | 复现命令（复核用） |
|---|---|---|
| **L2 视觉回归** | 基线裁决是整套里**唯一的人审节点**（「这个 diff 算不算回归」是语义判断，机器只能给 diff）；且可靠像素基线要**渲染环境稳定**（本机 win32、**无 Docker** ⇒ 平台 flake 会把真信号淹掉） | `bunx playwright test --update-snapshots`——⚠️ **今天没有任何基线文件**，跑它等于**新建**基线，不是回归检查 |
| **L4 跨浏览器** | `playwright.config.ts` 只有 **1 个 project（chromium / Desktop Chrome）**；firefox ／ webkit 的浏览器包本机**未装**，`playwright install` 在这里约 18KB/s ⇒ 不可行 | `bunx playwright test --list`（数 project）／`ls "$LOCALAPPDATA/ms-playwright"`（看实装了哪些） |

**这一批没做、也不声称做了的另外两件事，一并写明**：① 视觉／语义类里**机器断言不了**的那一类
（设计样本还原度、装饰克制、认知层级、整体质感）按 `frontend-testing` 的口径**明确划在自动化之外**，
留人审——**不为它们写脆弱断言**；② **焦点顺序 ／ 屏幕阅读器行为不在 axe 的覆盖范围内**
（axe 自动检约 57%）——这批只做到 axe 那一层。

---

## 收尾补测 · 局部前后端接缝（`fullstack-slice-testing` skill · 2026-10-08）

**性质**：006 办结之后单独跑的一次**局部前后端接缝对账**，与本文件上面那节「收尾补测 · 前端结构性
缺口」（`frontend-testing`）互补——那节把**后端 mock 掉**只验前端，本节把**mock 停掉、起真栈**，
让单前端阶段对后端撒的那纸「善意的谎」第一次与真实碰面。**产品码零改动**（`git diff --numstat` 对
已跟踪文件为空，可复跑）。判据、自愈护栏与归档口径按 `fullstack-slice-testing` ＋ `testing-system-blueprint` 走。

### ① 圈定的切片与命中缺口（防过度测）

**切片**：右栏「AI 会话」的**建会话落库 ＋ 列表可见**链——`session-actions.ts` 的真 SDK
（`建会话` / `可列出的会话`）→ 真内核（`Server.listen`）→ 真 PG（PGlite）。**单切片、不贪多**。

| 缺口 | 命中 | 依据 |
|---|---|---|
| ① 环境编排 | ✅ **命中（本格前提）** | 本仓**所有** `openhive-*.test.ts` 走 `toWebHandler`（**进程内、无网络**），浏览器只能连**真在监听**的地址 ⇒ 必须真起 `Server.listen` |
| ② 契约真实性 | ✅ **命中（有实证）** | 见 ④ 节——`/api/reference` 的 mock 与真后端**当场对不上** |
| ③ 接缝粘合 | ✅ **命中** | 身份 cookie 透传 ＋ 目录参数 ＋ 同源/跨源差异，正是本切片的核心风险 |
| ④ 真实时序/实时 | ❌ **不命中**（如实记） | 切片是**普通请求-响应**，无流式 / 无 SSE / 无长轮询 ⇒ **不硬造时序断言**（skill 明文：非流式切片只命中 ①②③ 是正常的） |

### ② 起真栈（本格核心难点，不可跳过）

三个文件、一个进程做三件事：

| 文件 | 角色 | 关键点 |
|---|---|---|
| `packages/opencode/test/real-stack/serve.ts` | **提供者侧** | 真内核（`Server.listen`，与 `cli/cmd/serve.ts` 同源）＋ 真 PG（`startProductionDb` 经 TCP）＋ 真 seed ＋ 真签发 token；打印 `READY {json}` 后挂住等 SIGTERM |
| `packages/app/e2e/real-stack/stack.ts` | **编排器** | 起内核 ＋ 用 Vite **程序化**（`createServer`）监听前门端口 ⇒ **页面同源**；模块图由 Vite 自己服务（**零代理**），只有**数据面**过 proxy |
| `packages/app/e2e/real-stack/playwright.config.ts` | **真栈专属配置** | 与 `packages/app/playwright.config.ts` **分开**（那一份要起 28 个 mock spec，混进来会把它们拖进 25s 起步的真栈） |

**为什么必须同源**：生产形态是**同源反代**，而 `bun run dev` 是**跨源**的（Vite :3000 ／ 内核 :4096）。
跨源下浏览器**不会**把身份 cookie 带进对内核的 `fetch`——不是 SameSite 问题（同站点），是 **Fetch 的
`credentials` 语义**（默认 `same-origin` ⇒ 跨源一律不带），而本仓 SDK 客户端（`utils/server.ts`）
**没设 `credentials`**、内核 CORS **也没有 `credentials` 选项** ⇒ 身份门开着时跨源形态下**数据面必 401**。

**路由规则按「请求意图」而非路径前缀**：内核的 `/session` 与 app 的客户端路由 `/session/:id`
**同形**（`app.tsx`）⇒ 前缀路由会误判。判据取浏览器自己给的信号（`server.proxy` 的 `bypass` 契约）：
`Sec-Fetch-Dest: empty` 且非 `Upgrade` ⇒ 数据面转内核，其余交回 Vite。

⚠️ **编排路上踩了四处自伤，全部实测、全部记进 `LEARNINGS`**（这正是 skill 说的「本格新难点在起真栈，
不在写断言」）：

| # | 自伤 | 症状 | 处置 | 条目 |
|---|---|---|---|---|
| 1 | Playwright `outputDir` 落在 Vite root 内 | 测试**中途**页面被 full-reload，事件流**只有 REQ 没有 RES** ⇒ `net::ERR_ABORTED`（**长得像接缝断**） | 挪到 `tmpdir()`（reload 2 → 0） | `#006-09` |
| 2 | `VITE_OPENCODE_SERVER_HOST/PORT` 被「页面同源」与「`vite.config.ts` 的 `/openhive` 规则」**两个用途抢占** | Vite 把 `/openhive/*` **代理给自己** ⇒ 无限自环、`/openhive/auth/me` 先挂、后续请求一起饿死 | 内联配置里**显式重写**那条规则（并放在 `/` 之前） | `#006-10` |
| 3 | 种子漏种 `status`（默认 0 ＝ 停用） | 内核门**只看签名** ⇒ `/api/session` 200 而 `/openhive/auth/me` 401 ⇒ 正确停在**登录页**（**像「身份通道没接通」**） | 显式种 `status = 1` | `#006-11` |
| 4 | 种子漏种 `must_change_pw`（建表默认 1 ＝ 强制改密） | `aria-modal` 改密弹窗**截获**所有点击（**像「按钮点不动」**） | 显式种 `must_change_pw = 0` | `#006-11` |

⚠️ **第 2 处推翻了一个我写下的假设**：原以为「往 `createServer({ server: { proxy } })` 里写一份
＝ 替换文件里那份」——**错**，那是**深度合并**，文件里既有规则仍在（只是目标被覆盖）。判据已在
`stack.ts` 与 `#006-10` 里写明。

**为什么不让手写反代搬流量**：第一版自己写了个 Bun 反代搬**所有**流量，被**打爆**——一页要 ~800 个
模块请求，连接池在中段耗尽，成批 `✗ Error: Unable to connect`，`load` 事件永远等不到（实测日志
790 行、尾部 7 条 connection 错误）。正解是**别去搬模块图**：让 Vite 当同一端口上的前门。

### ③ 两层落地（步骤 3）

| ID | 层 | 落点 | 判据 | 缺口 | 风险 | 发布门 |
|---|---|---|---|---|---|---|
| **006-FS-01** | 结构化接缝断言 | `e2e/real-stack/ai-session-real.spec.ts` 测试① | 真浏览器里对**同一个内核**发两次 `fetch`，只差**同源/跨源**一个变量：经前门 **200** ／ 直连内核 **401** | ③ 接缝粘合 | P1 | 发布前绿 |
| **006-FS-02** | 黑盒冒烟 | 同文件测试② | 真 SDK 建会话 → 真内核落库 → 右栏渲染（3 组断言） | ② 契约 ＋ ③ 接缝 | P1 | 发布前绿 |

**测试①（最强的那条）**：它同时证明「**②-1 的 cookie 环境通道成立的前提是同源**」，而本仓
`bun run dev` 的跨源形态**不满足**这个前提。两个状态码都由**真内核的身份证**给出，不是转述。

**测试②**：真栈起点会话用**测试侧 oracle**（直接打内核 v2 出口 `/api/session`）建；再走真前端
（真 SDK 兼容层）→ 断言 ① 面板 ＋ hero 输入框可见；② 数据面走的是**同源前门**（请求 host 是前门
端口）且带上**本场目录**；③ 点「新会话」→ **内核侧会话数 +1**（oracle 只读真内核，不经前端）。

⚠️ **判据取「实测形状」不取「我以为的形状」**：断言第一版写 `GET /api/session`（**我以为**的 v2
形状），红了才发现右栏实际打的是 `GET /session?directory=…`（兼容层 `createCompatibleApi` 那条
**v1** 出口）⇒ 改成实测形状（`#006-12`）。

### ④ RED 变异（步骤 4，`#005-15`：断言「拦住了什么」要靠变异证）

| # | 注入 | 结果 | 类别（`#003-03`） |
|---|---|---|---|
| M1 | 摘掉 `context.addCookies(...)` | **恰红**：`Expected: 200 / Received: 401`，红的正是「同源应带得上 cookie」那一条；另一半（跨源 401）**照旧绿** | **①类（恰红目标）** |
| M2 | 摘掉 `/openhive` 那条代理规则（＝回退第 2 处自伤的修法） | **恰红但「粗」**：红在第一层冒烟（`session-panel` `element(s) not found`），证明该规则**承重**，但对「**哪一条**断言有牙」**毫无信息** | **②类（整组红）**——据实记，**不写成「恰红 1」** |

⚠️ **M2 的诚实读法**：它打在**编排层**（上游于一切断言），所以红的是「面板根本没出现」，
不是某一条结构化断言 ⇒ 它证的是「这条代理规则不能少」，**不是**「我的断言精准」。两条变异都已
**逐字节还原**并复跑基线：**`2 passed (1.4m)`**。

### ⑤ 数据隔离（步骤 4 前提）与拆栈

- **沙箱**：`mkdtempSync(path.join(tmpdir(), "openhive-real-stack-"))` ⇒ `OPENHIVE_DATA_ROOT` /
  `WORKSPACE_ROOT` / `SHARED_ROOT` 三个根**全落在沙箱内**，与真机数据零交叉。
- **库**：**进程内 PGlite 经 TCP 暴露**（`startProductionDb`）⇒ 零外部依赖、离线可得，且**测的就是
  生产那一支** `connect()`（`#002-05`）。
- **拆栈成对**：`serve.ts` 收 SIGTERM ⇒ 依次 `listener.stop()` → `pg.stop()` → `还原 env` →
  `rmSync(沙箱)`。实测：Playwright 跑完 **4711 ／ 3010 ／ 4096 三个端口零残留监听**。
- **产物不落仓库**：Playwright `outputDir` 在 `tmpdir()`（见第 1 处自伤）；临时诊断 spec 与探针**已删**。

### ⑥ 切片外发现（**挂账，不在本轮修**——护栏：只写测试与编排，不改产品码）

| 发现 | 说明 |
|---|---|
| **`/api/reference` 的 mock 与真后端对不上** | **假后端**（`e2e/utils/mock-server.ts`）返 **200** `{location, data: []}`；**真内核**返 **500**（`grep` 下来内核**没有**这个 handler / group，它是 v2 生成的 SDK 端点「List references」）。⚠️ **这是本格价值的实证**（mock 撒的谎在这里穿帮），但它**不在本轮圈定的切片内**（本切片＝建会话落库 ＋ 列表可见）⇒ 按护栏**不自行改产品码**、**不顺手扩切片**，如实挂账。**判据一句话**：mock 返回得比真后端**更好**（200 vs 500）就是漂移（`#006-12`） |

⚠️ **本轮没做、也不声称做了的**：缺口 ④（真实时序/实时）**不命中**（切片非流式）；**导出**与
**指令卡投影**两条链**本轮没圈**（切片只圈了「建会话落库 ＋ 列表可见」）⇒ 别把本条读成「右栏已端到端对账」。

---

## 缺口（**不是**「已覆盖」，别读错）

> 纪律：`LEARNINGS #002-02` —— 测不了 / 本机做不了的，**单列一行写「缺口」**，不写成「已覆盖」。

| 缺口 | 位置 | 说明 |
|---|---|---|
| **前端 L2 视觉回归（本机无基线）** | 006 收尾补测 → `packages/app/playwright.config.ts` | 见「收尾补测 · 前端结构性缺口」③节：基线裁决**是整套里唯一的人审节点**，且本机 win32 ＋ **无 Docker** ⇒ 渲染 flake 会淹掉真信号。**今天没有任何基线文件**，`--update-snapshots` 等于**新建**基线。⇒ 如实记缺口，**不写成「视觉已覆盖」**（对比度那一半由 axe 覆盖、几何那一半由几何不变量覆盖，**都不等于像素级回归**） |
| **前端 L4 跨浏览器（只有 chromium）** | 同上 → `packages/app/playwright.config.ts` | 同上 ③节：配置里只有 **1 个 project（chromium / Desktop Chrome）**，firefox ／ webkit 浏览器包本机未装且下载不可行。⇒ 「跨浏览器」这一半今天**没有观测面**，如实记缺口 |
| **SC-004 的「有权」一半** | `spec.md` | 前端无授权输入 ⇒ 只对「可发现」负责；「有权可发现」依赖 009 的资产授权元数据 |
| **「收藏」排序因子** | FR-004 / T006 | 本轮不做，**已落 009 的 `tasks.md` 📥 块**（U8 → 009 T011） |
| **「最近使用」** | FR-004 / T006 | 若做只做本机权重，须写明降级形态（U8）；**服务端统计那一半已落 009 的 📥 块** |
| **「判定涉案」的判定逻辑** | T012 | AI 只提取/查证/预填，不替人下结论；判定本身属 **F6/F7**（U5）。✅ **2026-10-07 T011 已按 `#002-04` 落进接收方表**：`007-fund-analysis/tasks.md` 与 `008-call-analysis/tasks.md` 各一份 📥 块（📤-2 → 两文件 T014） |
| **FR-008「确定性的事」的硬那一半** | T011 → **F6 / F7** | 本条（T011）交付的是**软**机制：一句进系统提示词的准则 ＋ 它的接线自检。**硬**那一半——「查询 / 统计**真的**有可调用的工具、且调用受鉴权约束」——本仓**今天没有对象**：通用工具只有 `shell` / `grep` / `glob` / `read`，**没有任何业务查询路径**（F6 的资金 / F7 的话单才有）。✅ 已落 007 / 008 的 📥 块（📤-1 → 两文件 T006/T014）。⚠️ **不得声称 FR-008 已在 006 端到端验证**（`LEARNINGS #002-02`） |
| **`prompt.ts` 摊进 `system` 那一跳无断言** | T011 审查 F-1 挂账 | 全仓**没有任何测试**钉住「`Instruction.system()` 的返回值真的进了 `SessionPrompt.run` 的 `system` 数组」——今天绿的是「`system()` 返回了对的东西」，**不是**「它到了模型面前」。⚠️ **非本条引入**（是**所有** instruction 源共有的老账），且要动的是 `SessionPrompt.run` 的内部结构 ⇒ 挂账。判据一句话：**能红的那一条只到 `system()` 的边界为止**（`#004-09`：端点断言对最后一跳不敏感） |
| **`config.instructions` 的绝对路径支路无断言** | T011 审查 F-2 挂账 | `systemPaths()` 对绝对项是**原样收下**的分支，而本仓用的是**相对项** ⇒ 那条分支今天没有观测面。**部署形态未定**（D-15 那条下发路径是不是绝对路径，今天无从知道）⇒ 等 D-15 落定再钉，别凭空造一个形态（`#004-07`：判据来源必须是**被调方**） |
| **另一套 ambient 通道：路由改了会静默失效** | T011 审查 F-4 挂账 | `packages/core/src/instruction-context.ts` 是**第二套** ambient instruction 系统（注册为 SystemContext 键 `core/instructions`），它**只读 `AGENTS.md`**、**不读 `config.instructions`**。实测它在今天这条链上**够不着**（`grep -rn "SystemContext" packages/opencode/src packages/app/src packages/session-ui/src` **零命中**）⇒ 本条接线今天成立。⚠️ **风险**：会话路径哪天迁到 SystemContext，`config.instructions` 会被**绕过而无人报错** —— 那条准则就**不报错地**从民警的提示词里消失了（`LEARNINGS #003-05`：镜像要写成能被惊醒的样子；这是它的同族——**两条并行通道之间没有任何断言看着**） |
| **暗色无 `--v2-background-bg-accent-soft`** | `packages/ui` 的 dark 块 | 沿用 005 裁定（R2-09）：`DESIGN.md §6.2` 明写**不启用暗色** ⇒ **非本次引入**，继续挂账（U7） |
| **能力清单的「漂」已建网，但网只罩住「skill 集合」** | T002 | 旁路清单是**镜像**（`LEARNINGS #003-05`）。`capabilities.test.ts` 双向对账**文件系统里真实存在的 skill 名**（三条断言各自做过变异验证）⇒ 改名 / 新增 / 删除会红。**它不管**：① 描述文案改了对不上（本轮不钉，skill 描述不是判据）；② `packages/opencode/test/fixture/skills/` 下那两个上游**测试夹具** skill（口径是「扫 `.opencode/skills` 这一个目录源」，不是全仓 glob，故夹具天然在外）；③ 全局 skill 目录（`~/.config/opencode/skills`）——**跟机器走，不能进断言** |
| **frontmatter 只读 `name:` 一条正则** | `capabilities.test.ts` | 上游用真 YAML 解码器，这边只认单行 `name:`。**不为此加保护代码**——两个方向互相看着（真读漏 ⇒ 清单那条变「悬空」而红），故漏读会被另一种红抓住。已写进测试文件头 |
| **`SkillCapability.group` 的取值是占位** | `capabilities.ts` | skill 无分组 / 分类 / 标签元数据（实测）⇒ 今天两个 skill 都填「开发工具」，是 006 手填的。真来源 = 009 的业务分类 / 标签（已进 009 的 📥 块） |
| **`cards` 今天全为空** | `capabilities.ts` | 006 只造机制，卡片文案随模块（F6 / F7 / F9 落地时填）。今天两个 skill 是 opencode 开发工具链的，对民警无指令卡语义 ⇒ 编文案就是造数据。⚠️ **连带后果（T009 起口径更明确了）**：卡行为空 ＝ **T009 的「点卡填一句」与 §4.7.1 的选中态在生产里无从发生**——不是没接线，是**没东西可点**。所以 T009 的测试判据只能是「喂一份有卡的投影」（生产那条链上今天是空集） |
| **指令卡的 `context` 层触发条件未进类型** | `InstructionCard` | FR-003 的「随中栏选中浮现」取决于中栏当前上下文。**2026-10-07 T005 已就地兑现**（补 `context?: string` 可选字段 ＋ 注释 ＋ 两条报警断言）——**缺口已闭合**，此行留作出处，也是 006 那句 self-delegation（「T005 落地时把触发字段加进本类型」）的兑现记录 |
| **`contexts` 生产里必为空 ⇒ 上下文指令这一层在生产里必然不渲染** | T005 → T008 | **实测**（不是推断）：中栏**没有任何右栏读得到的「选中」状态**——`CenterTabState` 只有 `tabs` / `active` / `module`（`center/` 侧），`project/file-tree.tsx` 的选中行是组件**内部**状态。且 `MANIFESTS` 的 `cards` 全为空 ⇒ 就算喂了 `contexts` 也没卡可浮。今天测绿的是**纯组件**（喂夹具），**不是**「右栏能看到上下文指令」。真正的产源是 **F6 资金 / F7 话单**的中栏选中。**2026-10-07 T008 开工时按未定项问了，用户裁定「本轮不接这一层」** ⇒ `session-panel.tsx` 里**没有** `ContextCards`（喂恒空集＝把「这一层永远不显示」伪装成已接线，故宁可不接）。📤 **F6 / F7 收**（`#002-04`）。⚠️ **2026-10-07 T013 之后本条口径更准、但没闭合**：T013 补的是「**带卡的清单走完投影之后**，组件仍按契约办事」这条缝（见「T013 出参」），**生产里这一层照旧不渲染**（`contexts` 仍恒空）——**别**把 T013 测绿读成「民警能看到上下文指令」 |
| **`context` 的取值词表不由 006 定义** | `InstructionCard.context` | 同 `group` 那条：US2 场景 1 举的是「选中账户」「上传文件」，但真正的词表是各模块内容作者的（F6 / F7）。006 只钉一条能钉实的性质——「上下文层的卡必须带**非空**值」（报警断言），渲染层对畸形声明 **fail-closed** |
| **`capabilities.ts` 形状本次有变（006→009 契约）** | T005 → 009 | 加了一个**可选字段** `context`，**未**重塑类型。009 的 Prerequisites 把「F8 指令卡已落地」列为前置 ⇒ 009 落地时仍须按它自己的资产元数据复核一遍（本文件头也写着这条） |
| **U5 的两条依赖** | T011 / T012 | 「确定性走工具/代码执行路径」「高风险强制 ask」的落地依赖：007 / 008 的 `tasks.md` 接收方表。📌 **2026-10-07 状态**：**两条都已在 006 侧落地** —— T011 侧落「准则正文 ＋ 接线」（📤-1）；T012 侧落「**闸门机制 ＋ 8 条通用删除类 pattern 的清单**」（📤-2）。两文件 T014 要接的是**业务高风险动作清单 ＋「判定涉案」的判定逻辑**——⚠️ **业务动作要自己在同一份配置里加 pattern**，别以为闸门已罩住业务动作（`LEARNINGS #005-11`：横切机制在**新出口**上没人验）。✅ 两文件的 📥 块已各补一句「闸门落在哪」的指针（`#002-04`） |
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
| **`onSubmitPrompt` 生产里没人接** | T008 → **T010 已闭合（2026-10-07）** | 用户按回车的**终点**是 T010（真正调 SDK `session.prompt`）。`SessionPanel` 只把正文交出去（`controller.value()`），而 `ai-session-slot.tsx` **没传**这个 prop ⇒ 当时回车**什么都不会发生**。✅ **T010 已接线**：`ai-session-slot.tsx` 传 `onSubmitPrompt`（实现＝`submitRightPanePrompt` ＋ 失败 `showToast`），`SessionPanel` 按**回话**决定清空还是把正文留下。⚠️ **但「点卡 → 回车」这条链今天仍走不到终点**——`MANIFESTS` 的 `cards` 全为空 ⇒ **没卡可点**（见上面「`cards` 今天全为空」那条）。链路本身已由 **4 条组件用例 ＋ 12 条 app 单测 ＋ 1 条真链用例**钉住（喂的是有卡的投影 / 手搓的替身） |
| **`ContextCards` 的两个 prop 还没有接线** | T005 → 待接 | `context-cards.tsx` 与 `common-cards.tsx` 是**同形**的（都吃 `InstructionCardRowProps`），T009 只接了 `CommonCards` 那一层。`ContextCards` **今天根本没被 `session-panel.tsx` 渲染**（T008 裁定「本轮不接这一层」，因为中栏没有右栏读得到的选中状态）⇒ 它的 `activePrompt` / `onPick` **不需要接线**，否则是死代码。**接线随 `contexts` 的产源一起来**（F6 / F7 把中栏选中喂进来时，照 `CommonCards` 那两行的样子加，别再发明一套） |
| **「＋ 新会话」/「切会话」只留接缝** | T008 → **✅ 2026-10-07 T015 已收（并入「删除会话」）** | 按钮调的是 `props.onNewSession?.()`，而生产侧**没传**（不调 SDK `session.create`）；`onSelectSession` 同样没接 ⇒ **点会话列表不会真的切会话**。⚠️ **更正一句**：原先写「两头都待 T010 落地」，而 **T010 只接了「提交那一句话」**——这两颗各要一套新的异步链（建会话 → 改路由 → 右栏跟着换），是**下一条**的活；**而 006 没有下一条** ⇒ 2026-10-07 清点成「**无接收方**」，用户裁定**补开 T015**（并入 spec US4 场景 2 的「删除会话」）。✅ **T015 已闭**：三根线都接上了（见「T015 出参」）。⚠️ **但「接上」不等于「验过」**——接线层那三句 `navigate(...)`（含「一场都不剩 ⇒ `/new-session`」那条分支）**没有断言守着**（要活路由器 ＋ 活服务器）；**有判断的那一半**已抽到 `session-actions.ts` 并 13 条单测覆盖 |
| **会话列表 = 注入数据的 `session`，本栏不自己拉** | T008 | 列表渲染的是 `props.data.session`（`For` 直接吃它），**不**调 `session.list`。故数据没同步到的那一瞬列表可能是空的（当前会话名会退回显示 id）。**不为此加保护代码**——T010 接 SDK 时若需要「主动拉一次列表」，那是那一条的决定 |
| **会话行的视觉是 self-decision** | T008 / `openhive-DESIGN.md §4.7.5` | §4.7.5 只写了「新建 / 切换走 SDK `session.create` / `session.list`」，**没写长什么样**（原生 `SessionHeader` 依赖页面级 context，搬不进来）。本条的取法是**对齐原生右栏抽屉那一档**（`layer-01` 底 ＋ `text-[13px]`），**不是设计给的** ⇒ 若 §4.7 后续补写这一格，**以 DESIGN 为准**（宪法 §八）。⚠️ 同时复核 `skill-drawer.tsx` 那条同型缺口（抽屉 header 也是照原生抄的） |
| **删除钮的视觉是 self-decision**（T015 新增） | T015 / `openhive-DESIGN.md §4.7.5` | §4.7.5 只写了「新建 / **切换**」，**根本没写「删除」这个动作**、更没写它长什么样 ⇒ 本条自己定的：`text-[11px]` 小字钮 ＋ 危险态 `text-v2-state-fg-danger`（确认中）／平时 `text-v2-text-text-muted`。⚠️ **危险色不是随手挑的**——`--v2-state-fg-danger` 是 `packages/ui/src/v2/styles/theme.css:89` 现成的语义 token，仓里有先例（`auth/change-password.tsx:118`、`dialog-connect-provider.tsx:880`）。⇒ 若 §4.7 后续补写这一格，**以 DESIGN 为准**（宪法 §八） |
| **005 的「归档＝冻结」门在 `session.remove` 这条新出口上没有断言**（T015 新增） | T015 → 005 的横切机制 | 005 那道门住在**路径前缀中间件**（`packages/opencode/src/server/routes/instance/httpapi/middleware/project-location.ts` 的 `isArchived`）⇒ **结构上**覆盖 `DELETE /session/:sessionID`，但 005 的测试打的是别的出口（实测枚举：`/session` · `/api/session` · `/permission` · `/openhive/project/restore` · `/file?path=`，取数命令见上「顺带更正的两处文档不准确」） —— ⚠️ **正是 `LEARNINGS #005-11` 的形状**：「中间件是全局的」是**推断**，「这条出口上它真的生效」是**事实**，两者不能互相顶替。⇒ 如实挂账，**不写成已覆盖**（`#002-02`）。补法：照 `#005-11` 的收尾清单——把 005 已有的横切机制（冻结门 / 权限门）在新出口上各重放一遍、**这条出口写一条断言** |
| **`待删` 是粘的（故意不修）**（T015 新增） | T015 / `session-panel.tsx` | 点过「删除」之后切走、再切回**同一场**会话，钮上那句「确认删除？」**还在**（第二下仍会删 ⇒ 仍是两次点击，不构成单点误删）。**故意不修**：修它要一个 `createEffect` 盯 `sessionID` 归零，为一次「多问一次」引一个 effect 不划算。⚠️ **没有断言守着**——已在 `session-panel.tsx` 的 `待删` doc 注释里自陈（`#005-15`：别让注释比断言强）。⚠️ 与它相对的那条**有**断言（P5：「确认态挂在哪一场上」，改用 `boolean` 会恰红） |
| **F3：`/` 命令分支解引用 `model`（有哨兵）** | 上游 `submit.ts` → T010 挂账 | `sendFollowupDraft` 的命令分支读 `input.draft.model.modelID`，而右栏在「会话没记过 model」时**正是要传 `undefined`** ⇒ 组合起来当场抛 `Cannot read properties of undefined (reading 'modelID')`。**2026-10-07 用户裁定「保持既有链行为」**（不为它改产品码）⇒ `submit-prompt.test.ts` 有一条**哨兵**钉着（`.rejects.toThrow(/modelID/)`，用例名自带「⚠️ 已知缺陷」）。⚠️ **它何时触发没有实测**：原先注释里那句「右栏展示的会话都已有 model」是**推断**，已删（`#003-04`）⇒ 右栏接上 `onNewSession` 那天，第一件事就是验「新会话第一次提交，`session.model` 在不在」 |
| **F4：`{...undefined, variant}` 是类型谎言** | 上游 `submit.ts` → T010 挂账（Minor） | normal 分支组 `Message` 时写 `model: { ...input.draft.model, variant }`，而 `draft.model` 就是 `undefined` ⇒ 展开得 `{}`。类型上 `Message.model` 必填 ⇒ **骗过了 typecheck**。**与 F3 同根因的第二落点**（右栏「不自选」＝传 `undefined`，而上游那两处都假设它必有值）⇒ 一并挂账、不修补（同一裁定） |
| **命令分支没有乐观插入、没有 busy** | 上游 `submit.ts` 的 `/` 分支 → T010 挂账 | normal 分支是 `batch(() => { setBusy(); add() })`；`/` 分支**既不 add 也不 setBusy**（`optimisticBusy` 未传 ⇒ `setBusy()` 是 no-op）⇒ **从 `/` 面板选 skill 回车，界面上零反馈**（消息流不动、忙碌态不亮），只能等服务端那条消息回环。⚠️ **不是右栏漏接**，是既有链在这个分支上的样子；已用一条断言把「不碰 `api.session.prompt`、不做乐观插入」**钉住**（免得它悄悄变） |
| **`sync.data.command` 异步填充 ⇒ 同一操作两种结果** | `server-sync.tsx` / `bootstrap.ts` → T010 挂账 | `void loadCommands(…).then(setStore("command", …))` **不 await**。命令表就绪**前**发 `/effect …` ⇒ 当正文发；就绪**后** ⇒ 执行 skill。**同一句输入两种结果，且没有任何提示**。⚠️ 不改：这是上游的加载时序，右栏自建一份命令表就是 `#002-06` 的第二处写法 |
| **提交链没有超时 / 没有 Cancel / 没有 stop** | 上游 `submit.ts` ＋ `PromptInputV2` → T010 挂账 | `sendFollowupDraft` 的每个 `await` 都没有超时预算；`view.submit.onStop` 在右栏是空函数（`session-panel.tsx` 写 `onStop: () => {}`）⇒ 服务端卡住时右栏**没有任何取消手段**。⚠️ 要动的是上游那条链 ＋ `controller` 的 stop 语义，不是右栏能单独解决的 ⇒ 挂账 |
| **`reset()` 的 `cursor` 归零没有断言守着** | 上游 `session-ui` 的 `store.ts` → T010（第二轮审查 F-1） | 右栏清空走 `createPromptInputV2Store` 的 `reset()`（它顺手写 `cursor: 0`）。**实测（变异 M8）**：把上游那行 `setStore()("cursor", 0)` 拆掉 ⇒ 本组 **27 条全绿、一条都不红** ⇒ 「不归零会怎样」**今天没有观测面**（审查方读码复核也找不到可达路径：打字时 `onInput` 按 DOM selection 重算并覆写 cursor）。注释已按 `#005-15` 改写（删掉那句**推断**的后果），轴本身挂账 |
| **空输入框按回车照样调 `onSubmitPrompt("")`** | 上游 `PromptInputV2` → T010 挂账（第二轮审查 F-5） | `index.tsx` 的 Enter 分支**不查 `canSubmit()`**（只有提交钮查），`controller.submit()` 无条件调 `onSubmit`。今天**无害**只因**接收方**拦下了（`submit-prompt.ts` 的 `trim()===""`）——`#004-01` 的又一实例：**调用点 1 个、守卫点 0 个**。⚠️ **不在右栏补第二道门**（那是 `#002-06` 的第二处写法，且会让右栏与上游 Enter 语义分叉）⇒ 挂账 |
| **本栏两条提交出口只钉了一条** | 上游 `PromptInputV2` → T010 挂账（第二轮审查 F-7） | Enter（`index.tsx` 的 `onKeyDown`）与提交钮（`onSubmit={props.controller.submit}`）都汇进同一个 `controller.submit()` ⇒ 行为等价、风险低；4 条用例**只打了 Enter**。按 `#005-11`（新出口逐个验）它是一条零断言的出口 ⇒ 如实记 |
| **真链用例的 5 秒预算可能 flake（本机未见）** | `openhive-prompt-minimal.test.ts` → T010 挂账 | `pollWithTimeout` 默认 5 秒，而本机已有卡 5 秒线的用例（`#003-01` 记过：PGLite / 首次 spawn `rg.exe`）。**至今未见过它 flake**（22 秒那次是首次冷启动，判据等的是「假模型被调」，冷启动那一段在 `it.live` 的 60 秒兜底里）⇒ 真出现 flake 时**先加预算、别改判据** |
| **黑名单按模式匹配 ⇒ 天生可绕过** | T012 / `shell.ts` 的 `collect()` | 高风险闸门靠 `command` 的**模式匹配**（`rm *` …），而 `scan.patterns.add(source(node))` 取的是**命令节点的源文本**⇒ `sudo rm -rf build` 扫出来的就是整条 `sudo rm -rf build`（不以 `rm ` 开头）⇒ 不命中 ⇒ 兜底 `allow`。同类的还有 `bash -c "rm …"`、脚本内调 rm、`find … -delete`、`\rm`。**不是待修的 bug**（这类做法的天花板），⑥ 组用一条**哨兵**钉住（哪天这层加了「拆包装器」的解析，它会红，逼人回来重判）。**真正的兜底在沙箱 / 备份，不在这一层**（D-01 / D-16） |
| **上游 `ask` 的 `once / always / reject` 语义是上游的** | T012 → 上游 `permission/index.ts` 的 `reply` | 「always」会把该 pattern 在**本会话内**永久放行（`reply` 里 `approved.push(...)`，之后 `evaluate(…, approved)` 命中即 allow）。这是**上游行为**，本条不改也不假装能改（改它要动上游核心 ⇒ 与第一号约束冲突）。⚠️ **部署侧据此有一条纪律**：D-16 写明「前端自动应答开关**不得**打开」——那个开关在 `packages/app/src/context/permission-auto-respond.ts`（实测**默认关**），一旦打开，闸门就变成**自动 say yes**，而**没有任何测试会变红** |
| **配置规则排最后 ⇒ 三个隐藏 agent 的 `"*":"deny"` 被放宽成 `ask`** | T012 → `agent/agent.ts` 的 `merge(defaults, 本 agent, user)` | `title` / `summary` / `compaction` 自己的规则集是 `Permission.fromConfig({ "*": "deny" })`（＝`{permission:"*", pattern:"*", action:"deny"}`，**匹配一切**）⇒ 这三个 agent 本来**一条命令都跑不了**；而 `user`（配置）排**最后** ＋ `findLast` ⇒ 我们声明的 8 条 pattern 把它们自己的 deny 放宽成 `ask`（**未声明**的命令照旧 deny）。方向是「**更爱问**」不是「更放行」——这三个 agent 若真去跑删数据的命令，现在是**弹窗**而不再是**当场拒绝**。⑤ 组里用一条**报警断言**钉住它（`user` 哪天排到 per-agent deny **之前** ⇒ 红 ⇒ 回来回答「要不要保留这个放宽」） |
| **民警真的会被弹窗拦住 —— 本机测不到**（⚠️ **T014 之后只剩最后一层**） | T012 → 缺口 | 本机**没有真模型、没有前端**⇒ 「弹窗出现、民警点『拒绝』、命令不执行」这条端到端链**测不了**（`LEARNINGS #002-02`）。✅ **2026-10-07 T014 已把中间那一层收进来**：`Permission.ask()` **挂 pending ＋ 阻塞在 `Deferred`** ⇒ `reply(reject)` ⇒ 工具 **die ＋ 命令一步没跑**（`openhive-highrisk-gate.test.ts` ①②③，4 批变异证实有牙）。⇒ 端到端链上**只剩「前端把 `Event.Asked` 渲染成弹窗」这一段**没测；本机两跳合起来＝ **判定是 `ask`**（T012 ③ 组）＋ **挂起后被拒则真不执行**（T014）。**仍不得声称 FR-009 已在 006 端到端验证**；把「弹窗真的出现」写进 D-16 的**怎么验**（部署 / 目标环境侧）。⚠️ **2026-10-08 更新**：链上这一段**多了一个必要的落点**——`SessionPermissionDock` 原只长在**中栏那页**上，而中栏在会话路由下让位 ⇒ 闸门 UI 无人点得到（见上面「待答闸门搬进右栏」那条），本轮把它搬进了**右栏**（`ai-session/session-docks.tsx`）。⇒ **「前端把 `Event.Asked` 渲染成弹窗」的宿主现在在右栏**；但**「弹窗真的出现」这条断言仍然没有**（要真模型 ＋ 一次真工具调用 ⇒ 成本与不确定性都不合适，无法用 E2E 兜底）⇒ **这一行照旧挂着**，只把宿主位置写准 |
| **`edit` / `write` 本轮不动** | T012 裁定 ② | 本次清单**只覆盖 `bash` 的删除类命令**；`edit` / `write` 工具改文件（含删文件内容）**不在本轮的 `ask` 清单里**（用户裁定 ②：本轮 bash 删除类，其余照旧）。⇒ 「修改 / 覆盖数据文件」这一类高风险动作**今天仍静默执行**。⚠️ 与 `capabilities.ts` 的 `cards` 那条不同：这里不是「没有对象」，是**明确划出范围**——要扩就改 `.opencode/opencode.jsonc` 的 `permission` 块（`edit` / `write` 各有自己的权限名） |

| **环境通道（cookie）的射程远大于断言**（②-1 新增） | 006 Step 5 · ②-1 | 服务端那条 cookie 通道（`PROJECT_COOKIE`，见「Step 5 出参（二）」）对**每一条同源请求**生效——文件 / pty / 上传 / 下载 / 权限 / 项目清单**全在射程内**，而本批只跑了 **6 条**（A / B 两条会话链 ＋ 四条语义边界：非法值 / 已归档 / 头优先 / 对照）。⇒ ① **其余出口「带着 cookie 会怎样」没跑过**——⚠️ 正是 `LEARNINGS #005-11` 的形状：「机制对每条出口生效」是**推断**，「这条出口上它真的生效」才是**事实**；② **归档态翻转导致的落点翻转未测**（项目由活跃变已归档那一刻，同一条带 cookie 的请求落点**从项目目录翻到沙箱根**——**推得、未测**，要一个「先活跃后归档」的时序夹具）；③ **客户端 `Path=/` 没有任何断言钉住**（happy-dom 的 `document.cookie` **读回不按路径过滤**，探针实测 ⇒ 构造不出会红的断言，护栏只剩代码可读性；已同时写进 `current-project.ts` 注释与 `current-project.test.ts` 文件头）。**不写成已覆盖**（`#002-02`）。补法：照 `#005-11` 的收尾清单——新增出口时把这条环境通道在**那条出口上**重放一遍、写一条断言 |
| **多标签页：cookie 是全浏览器共享的 ⇒ 裁定 B 修不到它**（第二轮审查裁定 B 的残余） | 006 · 裁定 B | 「启动清掉 cookie」把**本标签页**拉回「未选择」，但 cookie 的存储**不按标签页隔离**（`Path=/` ＋ 无 `Max-Age`）⇒ 甲标签页正在用项目 A 时，乙标签页**启动**会把 cookie 清掉 ⇒ 甲标签页**下一次请求**落回沙箱根（**推得、未测**——要两个真标签页的夹具）。⚠️ 三种修法（A 什么都不做 / B 启动清 / C 改成请求头）**没有一种**解决它：真正的解法是**每标签页各自的通道**（`sessionStorage` ＋ 显式头），而右栏那条 SDK v2 链**够不着头**（②-1 的立论）⇒ 属下一轮。**不写成已覆盖**（`#002-02`）。⚠️ 与它相对的是**已覆盖的那一半**：单标签页的「刷新后分叉」已由裁定 B ＋ `workspace-entry.test.tsx` 新节两条断言钉住 |
| **「挂载即清」仰赖一条上游事实，今天没有断言钉着**（第二轮新记） | `workspace-entry.tsx` 的 `onMount` → 上游 `app.tsx` | 这一行只在「`WorkspaceEntry` **每次启动只挂一次**」时才对，而那条依据是 `NewAppLayout` 落在**路由根**里（`app.tsx` 那段注释：lives in the router root so it remains mounted across route changes）⇒ SPA 换路由**不重挂**。**本案没有断言钉住这条上游事实**：哪天有人把 `NewAppLayout` 挪进某个 `<Route>` 之下，`onMount` 就变成**每次导航清一次**民警刚选的项目——而 `workspace-entry.test.tsx` 那节会**照旧全绿**（它只挂一次）。⚠️ 正是 `#005-15`「注释不许比断言强」的形状：两个落点的注释都**如实标明**了这条假设无断言。要钉得用真路由器挂一次 `NewLayout` 再 navigate 两次、断言 cookie 未再被清 |
| **头被剥、cookie 留着 —— 不对称是明账**（第二轮新记） | `project-location.ts` 的 `Headers.remove(…, PROJECT_HEADER)` | 那条中间件**读完之后**把 `x-openhive-project` 头剥掉，而 **cookie 留着**。两者「客户端可填」的性质相同，差别在 cookie 里还装着身份（剥不了整头）⇒ 今天**无读者**（服务端不再读这个头）⇒ **无实际危害**；但这是一处**不对称**：将来谁回到头上去读，读到的会是「已经被剥过」的表象。已同时写进那个文件的 `PROJECT_COOKIE` 注释（明文自陈是明账，不是漏掉） |
| **导出钮的视觉是 self-decision**（T016 新增） | T016 / `openhive-DESIGN.md §4.7.5` | §4.7.5 连「删除」都没写，**更没有「导出」** ⇒ 本条自己定的：与会话行里那颗删除钮**同档**（`text-[11px]` 小字 ＋ `text-v2-text-text-muted` ＋ 同一串 hover token）。**位置**不是 self-decision——它是**对当前会话**的动作 ⇒ 与「删除」同居会话行（判据同 T015）。⇒ 若 §4.7 后续补写这一格，**以 DESIGN 为准**（宪法 §八） |
| **导出的「落盘那一句」没有断言守着**（T016 新增） | T016 / `ai-session-slot.tsx` 的 `.then((导出物) => downloadSessionExport(...))` | `导出会话` 有 4 条单测、上游 `downloadSessionExport` 有上游的单测，而**「有没有把这一份交给它」**只有人读代码看得见（与 T015 的 ⑤ 同形：接线层挂不起来测，`#002-02`）。⚠️ **旁边那句 `.catch(报错)` 同理**——「失败到底报不报得出来」要靠人在浏览器里拉一次网络失败才看得见。⇒ 如实挂账，**不写成已覆盖** |
| **中文标题 ⇒ 文件名回落成会话 id**（T016 新增） | T016 → 上游 `utils/session-export.ts` | `sessionExportFilename` 只保留 `[a-z0-9_-]`（上游既有行为，**本处不改**——照抄不重写正则，`#002-06`）⇒ 本产品会话标题基本全是中文，导出的文件叫 **`ses_xxxx.json`**，民警看不出是哪一场。⚠️ **可理解性与命名规则是产品问题、不是本条的**：今天已用一条**哨兵**把这个行为记下来（改名 ⇒ 红 ⇒ 回来重判）。真要改（如「标题拼音 + 日期」）＝改**上游文件**，按第一号约束先议「是否可提上游」 |
| **`openhive-project-directory.test.ts` 与任何另一个测试文件同进程同跑 ⇒ 稳定挂**（收尾实测 · **非 006 引入**） | `packages/opencode/test/server/` → **测试基建**（不在本 feature 的改动面里） | 收尾复跑实测（**三次不同组合，症状逐字相同**）：该文件与**任何**另一个测试文件放进同一次 `bun test` ⇒ `(fail) (unnamed) [5.0~5.3s]  ^ a beforeEach/afterEach hook timed out for this test.` ＋ `# Unhandled error between tests` / `PostgresError: Connection closed` / `code: "ERR_POSTGRES_CONNECTION_CLOSED"`（`wrapPostgresError (internal:sql/postgres:171:10)`）。✅ **不是 006 引入**（**已实测、不是推断**）：把 006 起点那一版（`git show 39be0146df:packages/opencode/test/server/openhive-project-directory.test.ts`，603 行 / 005 时代的 8 条）拉到**当前**环境与同一个文件同跑 ⇒ **现象逐字相同**（`6 pass / 1 fail / 1 error`）。`--max-concurrency=1` **也不解** ⇒ 不是文件级并发争抢，是**同进程里两套 PGlite 夹具互相关连接**（`LEARNINGS #005-02` 的**同一族**：那条是 42P05 预编译语句撞名，这条是连接被关）。⚠️ **成因未定论**（`#003-04`）：能确定的是「同进程 ＋ 另一个文件 ⇒ 挂」，**没有**继续拆到「是哪两样资源打架」。**门禁口径**：按 `#003-01` 的既有裁定取「受影响文件**逐个 / 分组单跑**」——该文件**单跑 16 pass / 0 fail / 62 expect**（与 006 早先记录逐字相同），其余 4 个 feature 文件成组 **13 pass / 0 fail**。⚠️ 全包类命令在本机**本来就不是可用门禁** |
| **`/api/reference` 的 mock 与真后端对不上**（`fullstack-slice-testing` 收尾补测新增） | `packages/app/e2e/utils/mock-server.ts` → 真内核 | **假后端返 200** `{location: …}` ＋ `data: []`，**真内核返 500**（`grep` 下来内核**没有**这个 handler / group，它是 v2 生成的 SDK 端点「List references」）。⚠️ **这是本格价值的实证**——单前端那份 mock 撒的谎在这里**当场穿帮**；但它**不在本轮圈定的切片内**（本切片 ＝ 建会话落库 ＋ 列表可见）⇒ 按护栏**不自行改产品码、不顺手扩切片**，如实挂账（`#006-12`）。**判据一句话**：mock 返回得比真后端**更好**（200 vs 500）就是漂移 |
| **中栏在会话路由上让位 —— 那条接线只有真栈 E2E 钉得着**（2026-10-08 缺陷修复新增） | `pages/layout-new.tsx` 的 `routePageVisible={() => routeSessionID(location.pathname) === undefined}` | 判定**由壳层算**（`WorkspaceEntry` / `CenterContent` 被组件测试**裸挂**、无 Router ⇒ 在里面 `useLocation()` 当场抛），单测只能量「拿到 `false` 之后中栏怎么摆」——`center-content.test.tsx`（5 条）＋ `workspace-entry.test.tsx`（4 条），**4 批变异各恰红、对照条不红**（摘 `|| !露页()` ⇒ 红 3；`!内容() && !露页()` 改 `!露页()` ⇒ 红 1「tab 优先」；硬编码 `pageVisible={true}` ⇒ 红 2；把判定**冻在组件体执行那一刻**（非访问器）⇒ 红 1「判定是访问器」）。**「那一行有没有接上」单测看不见** ⇒ 由真栈 E2E **唯一**钉住（`ai-session-real.spec.ts` 测试 ③，判据取可见性不取存在性：上游会话页在这一档只是 `display:none`，用 `count()` 数会恒为 1、永远绿）。两条各管一半，谁也不能顶替谁（`#005-11`）。⚠️ 另记一笔：中栏**今天基本常空**——唯一能往中栏开 tab 的 `useModuleAction()`（`center/module-actions.ts`）**生产调用者为 0** ⇒ 本轮把「错的内容」换成「空态 ＋ 一句提示」，**中栏的内容来源（文件 / 成果浏览器）应单独排一个 feature** |
| **右栏同一条消息显示两遍 —— 上游高频文件里两个写入出口判据不一致**（2026-10-08 真栈肉眼报 ＋ 就地最小修） | `context/server-session.ts` 的 `message.updated` 分支（**上游逐字节原样**的文件） | 现场：发一条消息，右栏出现**两条同 id** 的 user turn，**刷新即消失**。根因：乐观插入按**客户端**时钟给 `time.created`，服务端回包按**内核**时钟（同 `id`、不同 `time.created`），而事件那条出口按 `messageKey = time.created + id` 二分找 ⇒ **找不到 ⇒ 再插一条**。修法：**先按 `id` 认一次身份**再走原判据（就地最小修，3 行）。复现网在单测 `context/server-session-optimistic-duplicate.test.ts`；真栈端到端在 `ai-session-real.spec.ts` 测试 ④。⚠️ 那条 E2E 的度量**曾被一个假阳性污染**：右栏表头那个会话题名按钮也承载这句话（内核收到首条消息后把标题从建会话时的名字改成了它）⇒ 锚在**整根右栏**上时 `getByText` 同时命中标题与 turn ⇒ 峰值**恒为 2**、与有没有重复**无关**，红也红不出真因（`#006-06` 那一族：测量取错了对象，而它看起来像结果）⇒ 判据改锚 `[data-slot="session-turns"]`。⚠️ 采样**取整段窗口的峰值**、不只断稳定态——「最终是 1」在修复前**也成立**（整页 fetch 那条出口按 id 去重，会把重复吃掉），只看终值会漏掉被测的坏法。⚠️ **另三处同类落点未验可达性**：`context/global-sync/event-reducer.ts:279`、`context/sync.tsx:71`、`context/sync.tsx:96`（后者**无条件 splice**）——形状相同，但今天**没有观测面**（要活服务器 ＋ 真流）。⚠️ **未做上游文件变异**（改 `server-session.ts` 跑一次真栈 E2E 成本高、且它是上游高频文件）⇒ 这条 E2E 的「真牙」今天**只在单测层**，如实记 |
| **右栏「没有垂直滚动」—— 上游 `SessionTurn` 的 CSS 前提被本容器违背**（2026-10-08 真栈肉眼报 ＋ 修） | `ai-session/session-panel.tsx` 的 `[data-slot="session-turns"]` 那一层 | 现场：消息多了滚不动、长回答挤在一起。根因（真栈**两次实测、精确吻合**）：`SessionTurn` 自带 `[data-component="session-turn"]{height:100%}`（写在 `session-ui` 的样式表里、**按属性选择器**、不是 Tailwind 类 ⇒ **从源码里看不见**），其设计前提是**父层高度 auto**；而列表是 `flex-1`（高度确定）⇒ `height:100%` 解析成**容器全高** ⇒ n 条 `flex-basis` 全等 ⇒ 被 flex-shrink 按比例压成 `容器高 / n`（实测 637÷6＝**106.17**、637÷3＝**212.33**，而内容真实需要 139 / 340 / 269px）⇒ ① 长回答在**格内滚**（内层那条 `overflow-y:auto`）；② 外层 `scrollHeight` 恒等于 `clientHeight` ⇒ **永远没有滚动条**。修法：每条 turn 外面包一层 `w-full shrink-0`——**两个作用缺一不可**（实测只治内层不够，turn 仍被压成 `容器高/n`）；撑高一条到 1500px 的对照实测：容器 `scrollHeight` **637 → 1876**、`maxScroll` **1239**（精确 = 1876−637）⇒ 真能滚。⚠️ **单测只能断结构、断不了几何**（happy-dom 不跑布局，`#005-07`）⇒ 结构那条是「修复的**必需条件**」（变异：去包层 ⇒ 红在「父层不是列表本身」那组；留包层去 `shrink-0` ⇒ 红在 `shrink-0` 那组，**两条各自有牙、红在不同断言组**）；几何判据在真栈 E2E。⚠️ 顺带记一笔：上游两处权威用法（`timeline-playground.stories.tsx` / `enterprise/routes/share/[shareID].tsx`）都传了 `classes={{content: "… !overflow-visible"}}`，**本处不传**——内层高度变 auto 后它那条 `overflow-y:auto` 就此惰性，少传一个 prop 就少一份与上游漂移的面（另实测：带 `!` 的 Tailwind 变体在本仓**并没生成**） |
| **待答闸门搬进右栏；提问那半没有单测**（2026-10-08 新增） | `ai-session/session-docks.tsx`（新 fork 文件）＋ `ai-session-slot.tsx` 的 `dock={…}` | **为什么必须搬**：全仓**只有一处**回话出口——`pages/session/composer/session-composer-state.ts` 的 `decide`（`api.permission.reply`，2026-10-08 `grep` 全 `src/` **唯一**调用点），而它只被 `pages/session.tsx`（**中栏那页**）用；`layout-new.tsx` **零** permission/question 处理 ⇒ 中栏一藏，`Permission.ask` 阻塞在 `Deferred` 上、工具**永远挂着**，界面上什么都没说（`#005-11` 那一族：机制的**老出口**被藏了，没人发现它的活没人接）。**权限那半**有 8 条单测（`session-docks.test.tsx`：筛法 / 挑哪一场 / 回话三字段 / 在途），**3 批变异**：摘 `autoResponds` 筛法 ⇒ 恰红 1（对照条）；`sessionID` 错用 `props.sessionID` ⇒ 恰红 1（子会话条）；**在途守卫 ⇒ 全绿**（见下）。⚠️ **提问那半没有单测**——`SessionQuestionDock` 内部自用 `useServerSDK()`（`ScopedKey.from(serverSDK().scope, …)`），要一个**活着的服务器连接**才建得起来 ⇒ `bun test` 里挂不动（`#002-02`：如实写缺口，**不写成「已覆盖」**）。⚠️ **三样注入本身没有断言守着**：`permission` 表喂错 / `autoResponds` 忘了传目录 / `reply` 接成 `api.session`（**两个不同命名空间**）——最后那种是 `undefined.reply` 式的运行时报错，也可能被 lazy Proxy **静默**吞掉（`#006-01`），界面上只是「闸门不弹」或「点了没反应」；已写进 `ai-session-slot.tsx` 文件头「未被测到的接线」清单第 ⑦ 条，并注明**不能用 E2E 兜底**（要弹一条真闸门得让真模型跑一次真工具调用）。⚠️ **在途守卫那条断言没有牙**（`#005-15` / `#003-03` ②）：把 `if (响应中() === 请求.id) return` 整句摘掉，本文件**照旧 8 pass**——因为 `responding` 一置上三个按钮**同时 `disabled`**，而**禁用按钮不派发 click** ⇒ 第二次点击根本进不到 `决定` ⇒ 那句话在**渲染出来的界面**上**不可达**。处置：**改写断言的自我描述**（从「守卫挡住了重入」改成「按钮变灰、点不动，回来之后能再发」），**不删**那句代码——它与上游 `session-composer-state.ts:78-88` **逐字同形**，两处形状对着看本身有价值。⚠️ 另：`onSubmit` 传**空实现** ⇒ 回完话后 dock 会**多留一瞬**（等服务的 `question.replied` 事件把它摘掉；中栏那页有 `controller.onResponseSubmit()` 做乐观收起）。⚠️ 中栏那页（`display:none` 常驻）**仍会渲染自己那份 dock**，只是不可见、无人点得到 |
| **真栈编排上的五处新发现**（2026-10-08 新增） | `packages/app/e2e/real-stack/**` | ① **`STACK_FILE` 是固定路径**（`path.join(tmpdir(), "openhive-real-stack.json")`）⇒ **后起的栈覆盖它**；而 Playwright 可能在 `webServer` 起栈**之前**就加载 spec（收集阶段）⇒ 模块级 `const` 会把**上一套栈**的端口冻进去（默认形态下恰好同端口、看不出差别，**换端口并行跑第二套栈时**才会打到别人那套栈上、读别人的会话写别人的数据而断言照样绿）⇒ 已改成**每次现读**（`#003-01` 那一族：测量打到别的对象上）。② 本仓 **`bunx playwright` 起得来**（起的是 **node** 里的 runner ⇒ 与 `#006-05` 记的「bun 跑不了 Playwright」**不是同一枚障碍**）；真正的障碍是 `@playwright/test@1.59.1` 期望 `chromium_headless_shell-1217` 而本机实装 `-1208`／`-1234` ⇒ 默认 `launch()` 必失败 ⇒ 走**环境变量门控**的 `launchOptions.executablePath`（CI 不设该变量 ⇒ 与上游行为**完全一致**）。③ **Tabs 引导浮层遮挡右栏提交钮**：`TabsInfoPopup` 是 `fixed bottom-5 end-5 z-50`／192×240，位置正好压在**右栏底部的 hero 输入框**上 ⇒ Playwright 报 `intercepts pointer events`，读起来像「按钮点不动」，真因是一个**引导浮层**（`#006-11` 同族：那里是强制改密弹窗）⇒ 夹具里 `shouldDisplayTabsToast: false`，且**只影响本套真栈**。④ **约 30 个 `openhive-real-stack-*` 沙箱残留在系统临时目录**（`stack.ts` 用 `mkdtempSync` 建、**不清理**）⇒ 部署 / CI 上要单独收，本轮不动。⑤ **`bunx playwright` 解析到哪一版随 cwd 而变 ⇒ 从仓库根跑必挂**（2026-10-08 实测）：仓库根 `node_modules` 里**没有** `playwright` / `@playwright/test` ⇒ bunx 去缓存里取**最新的**（实测 `bunx playwright --version` ＝ **1.64.0**），而 `packages/app/node_modules/@playwright/test` 是指向 `@playwright+test@1.59.1` 的**符号链接** ⇒ **同一份 spec 被两个版本的库各加载一次**，报 `Error: Playwright Test did not expect test.beforeEach() to be called here.` ＋ `Error: No tests found`，栈里点名的是根目录之外那份 `bunx` 缓存里的 `playwright@1.59.1` ⇒ 读起来像「spec 写坏了」。**正确口径：一律 `cd packages/app` 再跑**（那里 `bunx playwright --version` ＝ **1.59.1**，与配置同版）。⚠️ 同族于 `#006-05`（那条问「入口跑在哪个**运行时**」，这条问「入口从哪个 **cwd** 解析」）——两者症状都是「工具起不来」，处置完全不同 |
| **单测层对 `contentRef` 零观测面**（2026-10-08 新增） | `session-panel.tsx` 的 `ref={自动跟随.contentRef}` | **实测（变异 M3）**：把那一条 ref 整条摘掉，`session-panel.test.tsx` **47 pass 全绿 / 一条都不红**，而真栈 E2E **⑤⑦ 红**。原因**结构性**：`contentRef` 只喂 `createResizeObserver(...)`，而 happy-dom **不跑布局、`ResizeObserver` 也不真触发** ⇒ 那个消费者在本环境里是**惰性的**，接没接上**看不见**。⇒ 「两个 ref 都接上了」这句话**只有把两层合起来读才成立**（① 锚 `scrollRef` 的可见痕迹 `overflowAnchor`；② 锚**结构**——中间那层包裹层在不在；**几何**归真栈）。⚠️ **别**把单测全绿读成「接线接上了」（`LEARNINGS #006-18`，与 `#005-07` 同族但对象不同：那条讲**测量**失效，这条讲**接线**失效） |
| **自动跟随的「用户意图」两条入口只验了一条**（2026-10-08 新增） | `session-panel.tsx` 的 `[data-slot="session-turns"]` 上那几个监听 | 本轮 E2E ⑥ 验的「用户想自己看」走的是**合成 `scroll` 事件**（`scrollTop = 0` ＋ `dispatchEvent(new Event("scroll"))`），而生产里用户**怎么**发出这个意图有两条：① **真滚轮**——原语 `handleWheel` 对 `event.target.closest("[data-scrollable]")` 命中的**嵌套滚动区**提前 `return`，而本仓多处带该属性（`session-turn-diff-view`、`message-part.tsx`）⇒ 真滚轮验法有**假绿风险** ⇒ **没用它**（也没写成断言）；② **选中文本**（`onClick={自动跟随.handleInteraction}`；原语内部**只在 `window.getSelection()` 非空**时才 `stop()`）⇒ **零断言**。⇒ 「跟随会暂停」这条性质**只在合成 scroll 那一条入口上有证据**，另两条今天**没有观测面**（`#002-02`：不写成已覆盖）。⚠️ 顺带记：那条 `onClick` 是**观察**不是动作（没有可键盘触发的行为）⇒ jsx-a11y 的两条警告按理由 `oxlint-disable-next-line`，**没**补一个空 `onKeyDown` 哄门 |
| **`resume()` 的两个恢复点：提交那处已验、切会话那处仍零断言**（2026-10-08 新增，**第三轮收窄**） | 提交处 ＝ `session-panel.tsx` 的 `view.submit.onSubmit` 里那句 `自动跟随.resume()`；切会话处 ＝ `createEffect(on(() => props.sessionID, () => 自动跟随.resume(), { defer: true }))` | **提交处**（第三轮新增）**已有观测面**：单测 ③「提交 ⇒ 距底 0」＋ ④ 对照「没接 `onSubmitPrompt` ⇒ 视野一动不动」（各配变异，见「最后更新」第三轮）；真栈 E2E **⑧** 走真提交两条腿验「回到底部 ＋ 继续跟随」，且**变异实测**：只摘这一句 ⇒ 恰红 ⑧（`Expected < 2 / Received 286`）、⑤⑥⑦ 全绿 ⇒ 它**真有牙**（`#003-03` 类①）。原始现场见「最后更新」第三轮。**切会话处今天仍无观测面**：右栏**不随会话切换重挂**（`ai-session-slot.tsx` 用非 keyed `<Show>`）⇒ 原语内部的 `userScrolled` 是**跨会话留着**的，不 `resume()` 的话，用户在一场会话里滚上去读过东西、**切到另一场后新内容也不再跟随**。⚠️ 这是**推得、未测**（要一个「先滚上去 → 切会话 → 再提交」的夹具，而本套真栈一次只起一场会话）⇒ 如实挂账 |
| **真栈验的是「乐观插入长高 / 人造长高」，不是「流式长高」**（2026-10-08 新增，**第三轮扩写**） | `e2e/real-stack/ai-session-real.spec.ts` ⑤⑥⑦⑧ | 真栈**没有模型** ⇒ 「AI 一边答一边逐块长高」这种生产常态**在这里做不出来**。今天两条路都不是流式：⑤⑦⑧ 靠**真 Hero 提交 ⇒ 乐观插入**（一次落一整条）；**⑥ 靠一次人造 append**（`长高一截`：往 `[data-slot="session-turns-content"]` 末尾塞一个定高 `div`，用于制造「用户在看历史时内容自己长高」那个**被动**场景，用例里自陈是人造注入，`#005-13`）。而 `ResizeObserver` 回调在**流式**形态下会被调用**很多次**（每次一行、甚至每个 token）⇒ 「那种形态下会不会抖 / 会不会把已经滚上去的用户反复拽回底部」**没有观测面**（`#002-02`：如实记缺口，**不写成已覆盖**）。⚠️ 但它**不属于**「本机做不了」那一类（`#004-13`）：要补得先有一条**假模型的流式 SSE**（`openhive-prompt-minimal.test.ts` 已有假模型先例）⇒ 属下一轮的活 |

---

## 最后更新

2026-10-08（**合并后缺陷修复轮 · 第三轮** —— 用户在第二轮的自动跟随后**再测**，报出残留的那一处，原话：
「当滚动条在最底部的时候，可以实现实时显示输出。但是当滚动条不在底部的时候……用户敲回车键后，滚动条
应当自动滚动到底部，然后实时显示输出的信息给用户」。⇒ 第二轮接上了「内容长高就跟随」，但
`createAutoScroll` 的 `userScrolled` 是**粘性**的（用户一往上滚，之后内容怎么长都不再跟随——这是
「别把正在读历史的人拽走」该有的样子），而**没有谁在「提交」时把它清掉** ⇒ 滚上去看过历史之后发的
每一条问题，回答都落在视野外面。**产品码 1 处 ＋ 单测 +2 条 ＋ 真栈 E2E 改写 1 条 / 新增 1 条**：

- **产品码**（`ai-session/session-panel.tsx`）：`view.submit.onSubmit` 里、`草稿操作.reset()` 之旁补一句
  `自动跟随.resume()`。选择这个位置有**两层理由**：① 放在 `if (!回话) return` **之后**——触发条件是
  「**确实交出去了**」，与上面清空正文**同一条判据**；没接回调时一个字都没发出去，此时把视野拽到底
  只是莫名其妙（这也是它与上游 `pages/session.tsx` 的差别：那边回调恒在、没有这道门）；② 放在
  `reset()` **之旁**——两者都是「交出去了」的收官动作，读起来是一件事。**同一原语今天有两个恢复点**
  （切会话 ＋ 提交），两处都写了「为什么必须有」的注释并互相点名（`#002-06`：别让两处各长一份）。
- **单测**（`session-panel.test.tsx` 新增 ③④，落在既有的「自动跟随」describe 里）：这一组原先
  **只断结构、断不了几何**（happy-dom 不跑布局）。③④ 给它开了一个观测面——`装假几何` 给容器装一副假
  的 `scrollHeight` / `clientHeight`，让原语在 happy-dom 里**真跑起来**：**假的是它拿来算的输入，
  不是它算的东西**（原语的数学、以及提交那条真实链路 `打字` → 回车 → controller → `view.submit.onSubmit`
  一行都没假；`LEARNINGS #006-08`：某条支路在某个测试层里没有观测面时，是**给它开一个观测面**，
  不是把断言换弱）。③ 提交 ⇒ `距底 0`；④ **对照**：没接 `onSubmitPrompt` ⇒ 视野**一动不动**。
  ⚠️ 夹具里「滚上去」走的是 `scrollTop = 0` ＋ 一次 `WheelEvent`（**不是**只置 `scrollTop`）——
  原语 `handleScroll` 里那条「这是我们自己滚的」支路靠 `isAuto` 判，与用户意图无关的那个置 0 会被
  **弹回底部**（`LEARNINGS #006-17` 的现场；`handleWheel` 是原语专门留的用户意图入口、没有时间窗）。
- **真栈 E2E**（`ai-session-real.spec.ts`）：**⑥ 改写** ＋ **⑧ 新增**（编号按文件顺序，⑧ 排在 ⑦ 之后）。
  - **⑥ 旧判据与新需求相反**，必须改写而不是留着：旧 ⑥ 是「用户先滚上去、**再提交一条** ⇒ 视野不许被
    拽回来」，而本轮需求正相反（提交**就该**拽回来）。⇒ 把**同一条性质**用另一条触发源诚实复活：
    「用户先滚上去、**然后内容自己长高**（`长高一截`：往 `[data-slot="session-turns-content"]` 末尾
    append 一个定高 `div`）⇒ 视野不许被拽走」。注入是**人造**的、用例里自陈（`#005-13`），但**触发链
    仍然是产品码**（`ResizeObserver` → `scrollToBottom(false)` → 因 `userScrolled` 而 `return`），
    只有「长高的来源」是假的。⇒ 它今天是**对照 / 哨兵**（修复前后都该绿），而不是缺陷探测器。
  - **⑧** 用**真提交**验两段（用户原话就有两个落点，`#005-12`：落点 N 处就写 N 条断言）：
    ① 滚上去之后提交 ⇒ **回到底部**（`距底 < 2`）＋ 新那一轮 `toBeInViewport`；
    ② **再**提交一条 ⇒ 仍然 `距底 < 2`（即「回到底部」之后要**继续**跟随，不是只弹一次）。
  - ③④ 与 ⑥⑧ 的分工照 `#006-18`：单测能钉「提交这条链把粘性清掉了」（有牙、会红），
    「长高 ⇒ 跟随」那一半仍**只有真栈**有观测面（`ResizeObserver` 在 happy-dom 20.12.0 里
    `typeof` **是 `function`**、回调却**恒为 0** 次 ⇒ 不触发，见 `LEARNINGS #006-19`）。

**变异验证（据实记，`#003-03`）**：只摘掉**提交处**那一句 `自动跟随.resume()` ⇒ 真栈 E2E
**1 failed / 3 passed（2.2m）**，红的**恰是 ⑧**（`Error: 提交之后就该回到底部（滚上去时 距底=221
scrollTop=0）`／`Expected: < 2`／`Received: 286`／`Timeout 15000ms exceeded while waiting on the
predicate`），⑤⑥⑦ 全绿 ⇒ **对照条不红、只有被测那一条红**（类①）。⚠️ 另记一处**当时就退回来的**：
⑥ 的第一版在缺陷态（M3 那类）下红在**它自己的前置**「先把它滚上去」上，而不是红在被测属性——缺陷态里
内容压根没跟着长、视野**本来就在顶部**，那次「置 0」是**空操作**（`LEARNINGS #006-17` 的又一实例）。
⇒ ⑥ 的判据**不改**，但它的**前置断言保留了失败消息里的实测值**，好让下一次读到「红在前置」时能一眼分辨。

**门禁（2026-10-08 实测，串行跑；`#003-01`）**：`packages/app` `tsgo -b` **EXIT=0**；
`session-panel.test.tsx` 单跑 **49 pass / 0 fail / 95 expect（6.86s）**；真栈 E2E ⑤⑥⑦⑧
**4 passed（1.7m）**；三个改动文件在**仓库根**跑 `oxlint -c script/oxlintrc.openhive.json`
**7 warnings / 0 errors**——**本轮新增行 0 命中**（取证：`git diff -U0` 显示本轮首个改动 hunk 在第
**239** 行，而那 7 条警告的落点是 `ai-session-real.spec.ts` 的 **48 / 65(×2) / 77 / 134 / 140**
与 `session-panel.test.tsx` 的 **90**，**全部早于首个 hunk**，即全在**未改动的既有行**上；
判据按 `#001-02` 的「本次新增 / 改动文件 0 命中」）。**未提交**：浏览器工具产物 `.playwright-mcp/`、
`right-pane-dup-and-scroll.png`。
⚠️ **别读错**：本轮只修「**提交时**回到底部并继续跟随」；「**流式**长高」（AI 一边答一边逐块长高）
在真栈里**仍然没有观测面**（真栈无模型；⑥ 那一次长高是**人造的一次 append**，不是几百次小长高）
⇒ 见缺口表那一行。「**切会话**那个恢复点」**仍然零断言** ⇒ 见缺口表那一行。

2026-10-08（**合并后缺陷修复轮 · 第二轮** —— 用户在第一轮修完后的真栈（前门 `:3010` / 内核 `:4711`）
上肉眼复验，报出下一处：「当我输入问题之后，AI 助手的回答不能实时显示在我能够看见的地方，我需要通过
鼠标滚动才能够看到」。⇒ 右栏**内容增长时不自动跟到底部**（第一轮修的③是「**压根没有滚动条**」，
本轮是「**有滚动条但不跟着走**」，两件事）。**产品码 1 处 ＋ 单测 +2 条 ＋ 真栈 E2E +3 条**：

- **产品码**（`ai-session/session-panel.tsx`）：接入上游原语 `createAutoScroll`
  （`packages/ui/src/hooks/create-auto-scroll.tsx`，**全仓唯一**；用法与上游 `pages/session.tsx` 同款：
  `{ working: () => true, overflowAnchor: "none" }`）——`scrollRef` 挂滚动容器 ＋ `onScroll` ＋ `onClick`；
  `contentRef` 挂**中间新增的内容包裹层**；补一条
  `on(() => props.sessionID, () => 自动跟随.resume(), { defer: true })`（右栏**不随会话切换重挂**——
  `ai-session-slot.tsx` 用的是非 keyed `<Show>` ⇒ 切会话必须自己 `resume()`）。
  ⚠️ **两个 ref 必须分挂两处**：`ResizeObserver` 观测的是**元素自己的盒子**，而滚动容器是 `flex-1`
  （高度确定）⇒ 内容长高时它**自己不变** ⇒ `contentRef` 挂在容器上会**静默失效**（挂哪一层由
  「**谁的高度随内容变**」定，不由「谁在滚」定）。
- **单测**（`session-panel.test.tsx` 新增 2 条）：① 滚动容器上 `style.overflowAnchor === "none"`
  ——**那串样式是原语自己写上去的**，所以它是「原语接上了」的证据；② turn **不**直接挂在滚动容器下、
  中间那层 `[data-slot="session-turns-content"]` 在（容器自己不长高，观测它没用）。
- **真栈 E2E**（`ai-session-real.spec.ts` 新增 ⑤⑥⑦，共用一条夹具：`压矮`（`setViewportSize 1440×420`
  让内容必然溢出）＋ `提交到能滚`（循环提交到 `可滚量 >= 200`，超限报错带上实测值））：
  ⑤ 内容长到能滚之后**距底 < 2**（缺陷态停在顶部，实得 **221**）；⑥ **用户已经滚上去 ⇒ 新内容不把视野
  拽走**（这是「无脑跳到底」唯一会红的地方）；⑦ 最后一条落进**视口**（`toBeInViewport`）。

**变异验证（据实记，`#003-03`）**：M1 摘 `ref={自动跟随.scrollRef}` ⇒ 单测**恰红 ①**
（`Expected: "none" Received: ""`）；M2 删内容包裹层（`<For>` 直挂容器）⇒ 单测**恰红 ②**；
**M3 摘 `ref={自动跟随.contentRef}`（包裹层留着）⇒ 单测全绿 47 pass ✗**，而 E2E **⑤ 红**（`距底` 期望 <2
实得 **221**）／**⑦ 红**（`viewport ratio 0`）；M4 `onScroll={undefined}` ⇒ E2E **恰红 ⑥**（红在**被测属性**，
⑤⑦绿）；M5 临时加「无脑跳到底」 ⇒ E2E **恰红 ⑥**（同样红在被测属性，⑤⑦绿）⇒ 坐实 ⑥ 是这条缺陷的
**对照面**。⚠️ **M3 下 ⑥ 红在它自己的前置**（不是被测属性）：缺陷态下**跟随从没发生**、视野一直停在顶部
（`scrollTop` 恒为 0），于是「置 0」是**空操作**，紧跟着 `scrollTop` 被**弹回 221**（到底）。成因**定位到
原语的时间窗**：`handleScroll` 那条「忽略我们自己触发的滚动」的支路是 `!userScrolled && isAuto(el)`，
而 `isAuto` = 「`|scrollTop - a.top| < 2` **且距 `markAuto` 那次记账不到 1500ms**」，`markAuto` 记的又是
`Math.max(0, scrollHeight - clientHeight)`（**maxScroll，不是 scrollTop**）⇒ 窗口内记下的那个数只要
落在 `scrollTop=0` 附近，这次置 0 就被认成「它自己刚滚到底的位置」。⚠️ **那次记账由谁触发没有逐条定位**
（`#003-04`：写成相关、不写成因果）；**能钉住的是窗口本身**——**对照实测：只加 2 秒等待即 1 passed**；
修复态不会发生（那时最后一次 `markAuto` 记的是真实 maxScroll，与 0 必然不等 ⇒ 走 `stop()`）⇒
**不改判据、据实记录**（已沉淀 `LEARNINGS #006-17`；M3 那条沉淀成 `#006-18`）。

**门禁（2026-10-08 实测，串行跑；`#003-01`）**：`packages/app` `tsgo -b` **EXIT=0**；
`tsgo -p e2e/tsconfig.json` **EXIT=0**；`session-panel.test.tsx` 单跑 **47 pass / 0 fail / 89 expect**；
真栈 E2E ⑤⑥⑦ **3 passed（54.3s）**；三个改动文件在**仓库根**跑
`oxlint -c script/oxlintrc.openhive.json` **7 warnings / 0 errors**（**本轮新引入 0 条**——原先的 9 条里
有 2 条是本次新加的 `onClick={自动跟随.handleInteraction}` 招来的 jsx-a11y
`click-events-have-key-events` ＋ `no-static-element-interactions`；**上游把同一个回调挂在
`<ScrollView onClick>`（组件）上、经 `{...rest}` 落到 div ⇒ DOM 形状与这里逐字相同，只是 jsx-a11y
看不见跨组件那一跳**；那条 `onClick` 是**观察**不是动作（原语内部只在 `window.getSelection()` 非空时
`stop()`），**没有**可键盘触发的行为 ⇒ 按本仓 `oxlint-disable-next-line -- 理由` 惯例**据实标注**，
理由写在那行）。**未提交**：浏览器工具产物 `.playwright-mcp/`、`right-pane-dup-and-scroll.png`。
⚠️ **别读错**：本轮只修「跟随」；**流式**（AI 一边答一边逐块长高）在真栈里**没有观测面**（真栈无模型，
E2E 靠**乐观插入**模拟内容增长）⇒ 见缺口表新增那一行。

2026-10-08（**合并后的缺陷修复轮** —— 006 已合并进 `multi-tenant`（`7761bc812b`），用户在真栈
（前门 `:3010` / 内核 `:4711`）上肉眼验收，报出三处，**全部先定位到根因再修**（`systematic-debugging`）。
三处与用户的原话：①「中栏怎么显示的也是 AI 的 session 界面呢」⇒ **中栏在会话路由下让位**；
②「右栏显示两次回答」⇒ **同一条消息显示两遍**；③「没有垂直滚动」⇒ **右栏滚不动**。
**四件产物 ＋ 一件连带**：

- **① 中栏让位**：`center-content.tsx` 新增 `pageVisible?: boolean` ＋ `empty?: JSX.Element`（三档：
  tab ＞ 页面 ＞ 空态；**藏 ≠ 卸**，仍 `display:none` 常驻）；`workspace-entry.tsx` 新增
  `routePageVisible?: () => boolean` 并就地提供 `[data-slot="center-empty"]` 那句提示；
  `pages/layout-new.tsx`（**上游已改文件，改动只加在既有 openhive 标记块里**）接上
  `routePageVisible={() => routeSessionID(location.pathname) === undefined}`。
- **② 右栏不重复**：`context/server-session.ts`（**上游逐字节原样**的文件）的 `message.updated`
  分支**先按 `id` 认一次身份**再走原判据（乐观插入与回包两枚时钟不同 ⇒ 原 `messageKey` 二分找不到）。
  用户此前裁定「重复条目挂账不修」，**本轮改裁为「纳入本轮、先证根因再修」＋「就地最小修」**。
- **③ 右栏能滚**：`session-panel.tsx` 每条 turn 外面包一层 `w-full shrink-0`（上游 `SessionTurn`
  自带 `height:100%`，前提是父层高度 auto；本容器是 `flex-1` ⇒ 被压成 `容器高/n`、滚动藏在格内）。
- **④ 右栏不渲空壳**：`session-panel.tsx` 的 `<For>` 改喂 `(data.message[sessionID] ?? []).filter(role === "user")`
  （`SessionTurn` 只接受 user id，根 div 却无条件渲染 ⇒ 4 轮对话屏上 8 格、4 格是空壳）。
- **连带（必须做）**：`ai-session/session-docks.tsx`（新 fork 文件）把**待答权限 / 提问闸门**搬进右栏
  ＋ `ai-session-slot.tsx` 接线 ＋ `session-panel.tsx` 新增 `dock?: JSX.Element`。
  **为什么必须**：全仓唯一回话出口 `session-composer-state.ts` 的 `decide` 只被**中栏那页**用
  （`layout-new.tsx` 零 permission/question 处理）⇒ 中栏一藏，`Permission.ask` 阻塞在 `Deferred` 上、
  **工具永远挂着**，界面上什么都没说（`#005-11` 那一族）。

**变异验证（据实记，`#003-03`）**：`center-content.test.tsx` 5 条 ＋ `workspace-entry.test.tsx` 4 条
（新增）—— 摘 `|| !露页()` **红 3**；`!内容() && !露页()` → `!露页()` **红 1**（「tab 优先」）；
硬编码 `pageVisible={true}` **红 2**；判定**冻在组件体那一刻**（非访问器）**红 1**（「判定是访问器」）。
`session-panel.test.tsx` —— 摘 user 过滤 **红 2**（①被测 ＋ ②对照；③「全是 user」**不红**，正是对照
该有的样子）；去包层 **红 1**（「父层不是列表本身」那组）；留包层去 `shrink-0` **红 1**（`shrink-0` 那组）
——**两条各自有牙、红在不同断言组**。`session-docks.test.tsx` 8 条 —— 摘 `autoResponds` 筛法 **红 1**（对照条）；
`sessionID` 错用 `props.sessionID` **红 1**（子会话条）；**在途守卫摘掉 ⇒ 全绿 ✗**：`responding` 同时
`disabled` 三个按钮、禁用按钮不派发 click ⇒ 那句话在界面上**不可达**，按 `#005-15` **改写断言的自我描述**、
**不删**代码（与上游 `session-composer-state.ts:78-88` 逐字同形）。**⚠️ 两处没做变异**：`server-session.ts`
（真栈 E2E 成本高 ＋ 上游高频文件）⇒ E2E ④ 的真牙**只在单测层**；dock 的三样注入（无观测面）。

**门禁（2026-10-08 实测，串行跑；`#003-01`）**：`packages/app` `tsgo -b` **EXIT=0**；
`ai-session/` ＋ `center/` ＋ `workspace-entry.test.tsx` ＋ `server-session-optimistic-duplicate.test.ts`
成组 **483 pass / 0 fail / 1057 expect（36 文件）**；真栈 E2E **4 passed（1.7m）**。缺口表 **+5 行**
（中栏让位接线 / 右栏重复条目 / 右栏滚动 / 闸门搬迁 ＋ 提问半无单测 / 真栈编排四处新发现）＋ **改写 1 行**
（「民警真的会被弹窗拦住」——宿主搬到右栏，**断言仍未落地**）。**未提交**：浏览器工具产物
`.playwright-mcp/`、`right-pane-dup-and-scroll.png`。

2026-10-08（**收尾补测 · 局部前后端接缝**（`fullstack-slice-testing` skill）——与上一条「前端结构性缺口」
是同一批收尾补测的另一半：**停掉 mock、起真栈**，让单前端对后端撒的那纸善意的谎第一次与真实碰面。
**切片** ＝ 右栏「建会话落库 ＋ 列表可见」；**缺口命中 ①②③**、**④（真实时序）不命中**（切片非流式，
如实记）。**四件产物**：① `packages/opencode/test/real-stack/serve.ts`（真内核 `Server.listen` ＋
真 PGlite 经 TCP ＋ 真 seed ＋ 真签发 token）；② `packages/app/e2e/real-stack/stack.ts`（用 Vite 程序化
当**同源前门**的编排器）；③ 同目录 `playwright.config.ts`（真栈专属配置，与既有那份**分开**）；
④ 同目录 `ai-session-real.spec.ts`（2 条接缝对账：`006-FS-01` cookie 通道同源/跨源对照 ＋
`006-FS-02` 右栏真栈冒烟）。＋ **`e2e/tsconfig.json` include +1 行**（`./real-stack/**/*.ts`，纯加）
＋ 本文件新增节 ＋ 缺口表 **+1 行**（`/api/reference` mock 200 vs 真 500）＋ **`LEARNINGS.md` 顶部 +4 条**。
**实测与变异**：spec **`2 passed (1.4m)`**；**M1**（摘 `addCookies`）**恰红**（`Expected: 200 /
Received: 401`）；**M2**（摘 `/openhive` 代理规则）**粗红**（红在第一层冒烟 —— `session-panel`
`element(s) not found`；它证的是「这条规则**承重**」，**不是**「哪条断言有牙」，据实记，`#003-03` 第②类）。
**起栈路上四处编排自伤，全部实测**：`#006-09`（`outputDir` 落在 Vite root 内 ⇒ 被测页被自己的 trace
**full-reload**，症状「只有 REQ 没有 RES」像接缝断）、`#006-10`（同一对 env 被「页面同源」与
`vite.config.ts` 的 `/openhive` 规则**两个用途抢占** ⇒ Vite 代理给自己**成环**、请求饿死；且
「内联配置覆盖文件配置」**是错的**——是**深度合并**）、`#006-11`（种子两列默认值把界面**锁住**：
`status` 漏种 ⇒ 停用（像「身份通道没接通」）、`must_change_pw` 漏种 ⇒ 改密弹窗截胡点击（像「按钮点不动」））、
`#006-12`（真栈第一产出常是**挂账清单**；断言要锚在**实测形状**上——右栏实际打 v1 `/session`，
不是我以为的 v2 `/api/session`）。**数据隔离**：`mkdtempSync` 沙箱 ＋ 进程内 PGlite，SIGTERM 时
**拆栈成对**（实测三个端口**零残留监听**）；产物落 `tmpdir()`、不落仓库。**切片外发现**（护栏：
只写测试与编排 ⇒ **不修、挂账**）：`/api/reference` **假后端返 200、真内核返 500**（内核没有该
handler / group）——正是本格价值的实证。
**门禁（2026-10-08 实测，串行跑；`#003-01`）**：`packages/opencode` 与 `packages/app` 的 `tsgo -b`
各 **EXIT=0**；`tsgo -b e2e/tsconfig.json` **EXIT=0**，且 `--listFiles` **实测**三个 real-stack 文件
都在编译集内（**不让「跑绿」当 include 生效的证据**）；`bun run lint:openhive` **23 warnings / 0 errors /
138 files / 161 rules**（＝既有基线，**未变**）；真栈 4 文件 oxlint（仓库根 / openhive 配置）
**7 warnings / 0 errors**；`git diff --numstat -- bun.lock` **空**；临时探针 `probe.ts` 与诊断 spec
`_diag.spec.ts` 已删。
⚠️ **别读错**：本轮只圈了**一条切片**，**导出**与**指令卡投影**两条链**没圈**；缺口 ④ 不命中是**如实的**
（非流式切片），不是漏做。）

2026-10-08（**收尾补测 · 前端结构性缺口**（`frontend-testing` skill，与 005 的 `backend-testing` 那批
同一条线的另外半）。**产品码零改动**（已跟踪文件 `git diff --numstat` 为空）。四件产物：① **3 个 story
文件**（`ai-session/instruction-cards.stories.tsx` 7 组、`session-panel.stories.tsx` 2 组、
`skill-drawer.stories.tsx` 3 组）——story 是 **axe 的审计面开关**；② **`e2e/a11y/storybook-axe-audit.ts`**
（零新依赖：仓库既有 Playwright ＋ addon-a11y 的传递依赖 axe-core，**不动任何 `package.json`／`bun.lock`**）
——同一次渲染里顺带跑 **24 格 axe（12 组 × light/dark）＋ 16 格几何**；③
**`e2e/regression/ai-session-right-pane.spec.ts`**——右栏**生产组装那一层**的第一次观测面（假后端）；
④ **本文件新增节 〈收尾补测 · 前端结构性缺口〉** ＋ **缺口表 +2 行**（L2 / L4 跨浏览器）。
**实测与变异**：axe 尾行 `合计 1 条违例｜几何 16 格，0 条失格`（那条违例＝已挂账的 dark 选中态对比度，
**不是新缺口**，增量只是**已知落点数 2→3**）；几何 M2 变异（`observer.observe` → `disconnect`）
**恰红**（`横向溢出 204px`／2 条失格），并逼出「②守恒判据不是载荷」这条诚实子结论；
契约 spec `1 passed (34.8s)`，其 title 断言的变异**恰红**（实得 `ses_ai_session_pane`）。
**门禁**：`lint:openhive` **23 warnings / 0 errors / 138 files / 161 rules**（＝既有基线）；
`packages/app` `tsgo -b` 与 `e2e/tsconfig.json` 各 **EXIT=0**；`git diff --numstat -- bun.lock` **空**；
throwaway 探针已删。**`LEARNINGS.md` 顶部 +4 条**（`#006-05` 「bun 驱动不了 Playwright」被 runner 跑在
node 上这条事实推翻／`#006-06` `overflow: visible` ⇒ `scrollWidth - clientWidth` 恒为 0／
`#006-07` 插在 `continue` 下面的整段会被静默跳过／`#006-08` 「有 story」≠「响应式那半有审计」）。）

2026-10-08（**Step 6 · 收尾完成 ⇒ feature 006 收官**。四件产物：① **`session.md` 重写**（原为
「尚未开始」的空壳 ⇒ 现为完整交班：状态 ✅ 已收尾 / 16 条 task 按标签 **FE 12（定位 1 / 新增 10 / 验收 1）· INT 4 · BE 0**（⚠️ 初稿误写「FE 11 · INT 4 ·
P 1」——`[P]` 是并行标记、不是范围标签，见 `session.md` 的更正行）/
两轮审查表 / 交付物一览 / 用户侧 merge+tag 命令 / 三笔下游移交 / 缺口指针 / 门禁基线）；
② **缺口表 +1 行**（`openhive-project-directory.test.ts` 与任何另一个测试文件同进程同跑必挂——
**已实测非 006 引入**，见该行）；③ **`LEARNINGS.md` 顶部补 4 条**（`#006-01` 任务书前提要用编译器验 /
`#006-02` 「是不是本次引入」用「拉起点那版同跑」判 / `#006-03` 本机 `globstar off` ⇒ `**` 少算 10 个
测试文件 / `#006-04` `#003-02` 第三次成立，增量是「同一条新账三席独立命中」）；④ **最终提交**。
**门禁在本 feature 最终状态上串行复跑（2026-10-08）**：`packages/app` 与 `packages/opencode` 的
`tsgo -b` **干净**；`bun run lint:openhive` **23 warnings / 0 errors / 135 files**（＝ T008 记录的基线，
**未变**）；opencode 侧 6 个改动文件单文件 oxlint（仓库根跑）**0/0**（161 规则）；app unit 同口径
**182 pass / 0 fail / 252 expect / 11 文件**、全量 **1006 pass / 0 fail / 3426 expect / 128 文件**、
components 全量 **601 pass / 0 fail / 1292 expect / 35 文件**；opencode 侧 4 文件成组 **13 pass / 0 fail**
＋ `openhive-project-directory.test.ts` **单跑 16 pass / 0 fail / 62 expect**（见「缺口」表末行）；
`git diff --numstat -- bun.lock` **空**。**上游侵入面 2 个文件**（`package.json` 的 `lint:openhive`
目录清单 ＋ `packages/app/src/pages/layout-new.tsx` 的 `right` 槽），都是**纯加**。
**merge 与 tag 留用户在检出执行**：`git merge --ff-only worktree-feat-006-ai-session` ＋
`git tag v0.1.0-006-ai-session`。⚠️ **report 里那两条别读错**：Task 数取 `tasks.md` 实测 **16**
（runbook 写 14 是它自己没跟上的旧数）；**「本机测不到」的条目照旧是缺口、不是已覆盖**。）

2026-10-08（**T016 完成 ⇒ 16 条 task（T001–T016）全部收官** —— 右栏加了**导出会话**入口，
复用上游 `utils/session-export.ts` 三件套。产物 **4 改 ＋ 2 改测**（全在 `packages/app/src/ai-session/`）；
出参见上「**T016 出参**」。**5 批变异全部实测**（M-a / M-b 各**恰红 2**、M-d **恰红 1 ＋ 连带 2**、
M-c / M-e **恰红 1**——据实记，**不写成「恰红 1」**，`#003-03`）。
门禁全过（typecheck 干净、5 个改动文件 oxlint **0/0**（161 规则）、app unit 同口径 **182 pass**、
全量 unit **1006 pass**、全量 components **601 pass**、`bun.lock` 未动）。
⚠️ **本批最重的一笔不是代码，是一处被推翻的前提**：`tasks.md` 的 T016 条目写着「右栏 `会话出口`
上已有 `get` 与 `messages` 两个方法」——**后半错**（新协议没有 `session.messages`，消息在另一个命名空间），
改接 `DirectorySDK.client`（legacy）才对。**tsgo 抓出来的**（`TS2739`），不是推断；该条已加更正块。
本文件同步：新增「**T016 出参**」一节、顶部「当前任务」改**剩一步**（只剩 feature 收尾）、
「已完成」加条目、缺口表加 **3 行**（导出钮视觉 self-decision / 落盘那一句无断言 / 中文标题 ⇒ `ses_.json`）、
**F-01 的 hover 口径从 7 处补记为 8 处**（加在那一节末，原表保留作快照）。
**上游侵入面：零**（`utils/session-export.ts` 只调用不修改）。）

2026-10-08（**Step 5 · 第二轮对抗性验证已跑完（出参见「Step 5 出参（三）」）** —— 五席只读审查打在
`e972d14f44..HEAD` 上，**三席独立**命中同一处 Important：**②-1 的 cookie 通道在刷新后与信号分叉**
（界面说没项目、请求仍落旧项目目录）。⚠️ 它是 ②-1 **自己引入**的（②-1 之前没有任何东西读那个 cookie），
属 `#003-02` 的形状。用户裁定 **B：启动清掉 cookie** ⇒ 产品码 **1 处**（`workspace-entry.tsx` 的
`onMount` 加一行 `setCurrentProject(undefined)`）、测试 **1 处**（新节：2 条断言 ＋ 1 条对照 ＋ 夹具）、
注释与文档 **6 处**（含 4 处**事实性说法被改正**：`session-actions.ts` 的「三根线」实为**两根**、
`PROJECT_COOKIE` 的「三处」实为**四处**、`%2E%2E%2Fbob` 那条**把风险说大了**、用例⑤**挂错了门**）。
**2 批变异全部实测**：M1 摘掉那一行 ⇒ **恰红 1**（cookie 那条）；M2 换成手搓 `document.cookie`
（绕过唯一写入点）⇒ **恰红 1**（**信号**那条）——**证明第二条断言不是第一条的复述**。
门禁全过（两个包 typecheck 干净、8 个改动文件 oxlint **0/0**（161 规则）、app components **608 pass**、
app unit **178 pass**、opencode 目录 ＋ 两份 frozen **27 pass**（与 ②-1 基线逐字相同）、`bun.lock` 未动）。
本文件同步：新增「出参（三）」一节、缺口表加 **3 行**（多标签页残余 /「挂载即清」仰赖一条**无断言**的上游
事实 / 头剥 cookie 留的不对称）、顶部「当前任务」改成**剩两步**（T016 ＋ 收尾）。**上游侵入面：零**
（`workspace-entry.tsx` 经 `git log --diff-filter=A` 实测由 005 自己的提交引入、`upstream/dev` 零历史）。
⚠️ **本批据实记两处不平衡**：① 裁决只动**一行产品码**，其余全是「把说过头的话收回来」——
本轮最重的产物其实是**四处不实的记述**；② **多标签页那条分叉修不掉**（三种修法都修不掉），已挂账。）

2026-10-07（**Step 5 · ②-1 已修（用户裁定 B：cookie 通道）**——产品码 **2 处**（服务端
`project-location.ts` 的 `PROJECT_COOKIE` 通道 ＋ 客户端 `current-project.ts` 的写入点）、测试 **2 处
（1 改 ＋ 1 新）**、注释 1 处（`ai-session-slot.tsx`）；出参见新增的「**Step 5 出参（二）**」一节。
**9 批变异全部实测**（M1–M6 服务端、N1–N3 客户端，每批还原后复跑基线全绿）；门禁全过（两个包
typecheck 干净、改动文件 oxlint 0 命中（首轮 1 warning，已按本仓 70 处先例处置）、opencode 27 pass、
app 单元 66 ＋ 5 pass、app components 142 pass、`bun.lock` 未动）。⚠️ **据实记一处不平衡**：RED 那天
11 条里只有 **4 条真红**，另 7 条钉的是退化语义、当时不可能红，牙全靠变异证。
本文件同步：新增「Step 5 出参（二）」一节、②-1 指针改 ✅、缺口表加 **1 行**（环境通道射程 / 归档翻转
未测 / `Path=/` 未钉，三合一）。**上游侵入面：零**（两个产品文件都是 fork 自有）。

⚠️ **那一版末尾那句「第二轮对抗性验证尚未跑」已作废**——**2026-10-08 已跑完**，见上面那条
「最后更新」与「Step 5 出参（三）」。）

2026-10-07（**T015 完成 ⇒ 15 条 task（T001–T015）全部收官** —— 右栏会话管理三件事（新建 / 切换 /
删除）接线完毕。产物 **3 改 ＋ 2 新**、全在 `packages/app/src/ai-session/`；**13 批变异全部实测**
（12 批「恰红 1」＋ 1 批「整组红」，据实记）；门禁全过（typecheck 干净、改动文件 oxlint 0 命中、
unit 60 pass、本目录 components 95 pass（全 app components 589 pass）、`bun.lock` 未动）。本文件同步：新增「**T015 出参**」一节、
「当前任务」改写、「已完成」加条目、缺口表加 **3 行**（删除钮视觉 self-decision / 005 冻结门在
`session.remove` 上无断言 / `待删` 粘性残留）、「只留接缝」那条补 ✅。
下一个动作是 **feature 收尾**：final commit（带 `Closes 006-ai-session`）→ **merge / tag 由用户在
主检出里跑**（本 worktree 只做最终提交）→ 更新 `006-ai-session/session.md` → 往 `LEARNINGS.md`
顶部补 1–5 条。

⚠️ **T014 那一轮的记录（上一版「最后更新」）**：三笔未结账的归属已裁定——① 右栏会话管理
（新建 / 切换）② spec US4 场景 2 的「删除会话」（在 006 里**零命中**）③ FR-010 的「导出会话」
（本仓**没有**这个能力）。用户裁定：**①② 并成 T015 补进 006**、**③ 改 spec 正文**（`spec.md` 的
FR-010 已加更正块）。T015 开工前那项未定项当场裁定：删除会话**要**人确认、形态＝**就地二次确认**。）
**本次未动任何产品码。**）

2026-10-07（**T014 已完成** ⇒ ~~14 条 task 全部完成，本 feature 的 task 轮到此结束~~
⚠️ **这一句已被上面新增的 T015 作废**：写测试 ——
高风险动作强制人确认 / SC-003。产物 **1 处：1 个新文件** ——
`packages/opencode/test/permission/openhive-highrisk-gate.test.ts`（**4 条 / 16 expect**）；
**零产品码改动**）→ 出参见上「T014 出参」。

**用户两项裁定（全按建议）**：① 产物形态 = **新建 gate 测试文件**（T012 的 `openhive-highrisk-ask.test.ts`
**一字不动**——两层各有各的见证，与 T013 先例一致）；② 夹具规则来源 = **config 注入 ＋ pin shell**：
用产品自己的 `ConfigParse.jsonc` 从仓库 `.opencode/opencode.jsonc` 读出 `permission.bash` 那份清单
（不自己编一份，`#002-06`），经 `it.instance` 的 `config` 注入，避免把「配置怎么被发现」再测一遍。

**开工第一件事：先读挂账、再收窄**（`#005-09`）：三条已被别处占住（`next.test.ts` 的 `ask/reply` 机制、
`permission-auto-respond.test.ts:34` 的默认关、T012 已挂的两条天花板）⇒ 本条唯一增量正是 T012 文件头
自己写明**缺的那一跳**：把生产里那个 `ctx.ask`（含 `ruleset` 项，`#004-07`）接上**真
`Permission.Service` ＋ 真 shell 工具**，让「挂起 → 等人 → 拒后不执行」真跑。

**4 批变异**（每批「注入 → 跑 → **逐字节还原**」，还原后 `md5sum -c` 全 OK ＋ `--numstat` 为空）：
**M1**（配置 `rm *` → `allow`）**恰红 3**（①②③）／**M2**（靶子路径去掉正斜杠转换）**恰红 1**（③）／
**M3**（配置整份换成 `{"*": "ask"}`）**恰红 2**（①④）／**M4**（在「被测属性」断言**之前**插入放行 ＋
等命令跑完）**恰红 1**（①，红在**目标断言**）。⇒ 4 条用例**每条**都被点红过，无恒绿者。

⚠️ **M4 做砸过两次，两种形状都值得记**（`#003-03` 的「三类」之外还有「空转」这一类）：第一版改收尾
却**没等命令跑完** ⇒ 红在**收尾那句重复 reply** 抛的 `Permission.NotFoundError`（**红错地方**）；
第三版只改收尾 ⇒ **4 pass 全绿**（① 的断言**全在 `reply` 之前**，动「断言之后」的代码＝**空转**）。
正确形态是把注入点挪到**断言之前**。判据一句话：**变异必须落在被断言那件事的前置条件上**
（`#005-15` 的同族：那条讲「拆哪一行」，这条讲「**拆的位置对不对**」）。

⚠️ **两个夹具坑（实测，写进文件头）**：① `rm -rf C:\…\victim` 退出码 **0** 却什么都没删（bash 把
反斜杠当转义吃掉 ＋ `-f` 静默放过）——`#004-08`「没报错 ≠ 执行了」，也是 ③ 那条对照存在的理由；
② **shell 不 pin** 就落 `win()[0]`（本机 **powershell**），而 `rm -rf` 在 PowerShell 下**参数不合法**
⇒ 同一份测试会「看谁在跑」而红绿不同。

**门禁（串行，`#003-01`）**：单文件 lint（**在仓库根**跑，`#004-10`）**0 warnings / 0 errors**（161 rules；
⚠️ 第一遍报 **9** 条 `no-unnecessary-type-assertion`，删掉那 9 个 `!` 才 0/0——**只删断言符，不动断言**）；
`packages/opencode` typecheck（`tsgo --noEmit`）**EXIT=0**；新文件 **4 pass / 0 fail / 16 expect**（18.55s）；
`test/permission/`（**4** 个文件）**95 pass / 0 fail / 174 expect**（76.49s）；既有三个文件单独跑
**91 pass / 0 fail**（＝ T012 时的基线值，**新文件没有影响它们**）；`git diff --stat bun.lock` **空**。

**同 task 一并落的文档动作**：`tasks.md` 勾 T014 ＋ 出参条；`state.md` 里 **T012 的产出表**与
**缺口表那条**（「民警真的会被弹窗拦住」）各补一句 ✅ 已收／只剩最后一层（`#002-06`：这类跨节点标记
在本文件里有多处）。

**⚠️ 下一步是 T015，不是 feature 收尾**——~~14 / 14 已完成 ⇒ 收尾~~ 这一句已被 2026-10-07 补开的
T015 作废（见上「未结账单与裁定」）。**T015 完成之后**才是 final commit ＋ 交**用户在主检出**跑
`git merge --ff-only worktree-feat-006-ai-session`；`006-ai-session/session.md` 与根 `LEARNINGS.md`
的收尾补充同时做。

---

2026-10-07（**T013 已完成**：写测试 —— 指令卡投影 ＋ 上下文动态浮现 / SC-002。产物 **1 处：1 个新文件**
——`packages/app/src/ai-session/capability-pipeline.test.tsx`（**6 条 / 14 expect**）；**零产品码改动**）
→ 出参见上「T013 出参」。

**用户两项裁定（全按建议）**：① 产物形态 = **新建集成测试文件**（不改 `common-cards` / `context-cards` /
`skill-drawer` 三个既有测试文件）；② `ContextCards` **维持 T008 裁定不接线**（`session-panel.tsx` 不动，
断言**止于「投影 → 组件」这条边**）。

**开工第一件事：先读挂账、再收窄**（`#005-09`）：`grep -rn "projectCapabilities" packages/app/src` 实测
生产调用点只有两处（`ai-session-slot.tsx` / `session-panel.tsx`），其余全在测试里。四条缝逐条问过之后，
**只有两条**是本条该补的——`projection.context → ContextCards` 与 `projection.drawer → SkillDrawer`
**零覆盖**（两侧今天各喂手写夹具，这条链一次都没走完过）；① `common` 归 `session-panel.test.tsx`、
④ 端到端归它 ＋ `command-palette.test.tsx` ⇒ **不重写**（只补「池子跟着模块换」1 条）。

**8 批变异**（每批「注入 → 跑 → **逐字节还原**」，还原后 `--numstat` 为空 ＋ 五文件 md5 与仓库外备份全等）：
**M1** `通用优先` 左右对调 **恰红 2**（A1 A2）／**M2** 投影的 `module` 改取 `条.skill` **恰红 2**（A1 A2，
与 M1 的红集**完全相同**——这两处是**同一条性质的两半**）／**M3** `context` 支改收 `common` **恰红 3**
（A1 A2 A3）／**M4** `drawer` 只喂 1 条 **恰红 2**（B1 B2）／**M5** 抽屉条目改读连接键 **恰红 2**（B1 B2）／
**M6** 摘掉上下文筛选 **恰红 1**（A3）／**M7** `label` 改取显示名 **恰红 1**（C1）／
**M8** 去掉「通用清单永远算数」**恰红 5**（A1 A2 B1 B2 C1）。⇒ 6 条用例**每条**都被点红过，无恒绿者。

⚠️ **一条差点写成空转的断言**（本轮最值得记的一笔）：夹具初版把通用清单声明在**最前**，而
`projectCapabilities` 按清单顺序拍平 ⇒ 投影出来**本来就是**通用卡在前，渲染层的 `通用优先()` 于是成了
**空操作**——**摘掉排序、A1 照样绿**。判据「我这条断言拦住了排序」是**待证的断言**（`#005-15`），
改法是让**声明序与 §4.7.1 的渲染序方向相反**（通用挪到**最后**声明），再用 **M1 证实它真的会红**。

⚠️ **一条工具怪癖（实测，省下一个人重踩）**：`bun test ./src/ai-session/xxx.test.tsx` **裸跑会抛**
`Client-only API called on the server side`（`solid-js/web/dist/server.js`），**既有 `.tsx` 测试文件也一样**
——缺 `--conditions=browser` 与 `--preload ./solid-jsx.ts`（`bunfig.toml` 的 `[test] preload` 只补了
happy-dom 那一半）。照包脚本 `test:components` 的形状跑。

**门禁（串行，`#003-01`）**：单文件 lint（**在仓库根**跑，`#004-10`）**0 warnings / 0 errors**；
根 `lint:openhive` **23 warnings / 0 errors**（与 T012 基线同值 ⇒ **本次新增文件 0 命中**）；
`packages/app` typecheck（`tsgo -b`）**EXIT=0**；新文件 **6 pass / 0 fail / 14 expect**；
`ai-session` 组件测试（**7** 个 `.tsx`）**90 pass / 0 fail**；`ai-session` 单测（**4** 个 `.ts`）
**47 pass / 0 fail**；两道目录门（`openhive-module-dirs` ＋ `design-token-refs`）**6 pass / 0 fail**；
`git diff --stat bun.lock` **空**。

**同 task 一并落的文档动作**：`tasks.md` 勾 T013 ＋ 出参条 ＋ **三处「📤 T013 收」各补一句 ✅ 已收**；
`state.md` 里 **T005 / T006 / T007 / T008 四面**的 T013 挂账指针同样各补一句 ✅ 已收
（`#002-06`：改一处就 grep 出全部同类——这类跨节点标记两边都写过，且 `state.md` 里有四处）。

---

2026-10-07（**T012 已完成**：高风险动作（删除数据）强制人确认 / FR-009。产物 **2 处**——
`.opencode/opencode.jsonc` 的 `permission` 从空 `{}` 换成 `bash` 下 **8 条**删除类 pattern → `"ask"`
（**＋17 / −1**）＋ 新建 `packages/opencode/test/permission/openhive-highrisk-ask.test.ts`
（**6 条 / 27 expects**）；**零上游源码改动**）→ 出参见上「T012 出参」。

**落点由用户裁定（三项全按建议）**：① 落地层＝**配置文件的 `permission` 键**（复用上游工具层的
`permission.ask`，不改一行源码）；② 清单范围＝`bash` 的**删除类模式** → `ask`，其余 bash 照旧 `allow`
（`edit` / `write` 本轮不动——**如实进缺口表**）；③ **100% 口径**＝接受上游 `once / always / reject`
语义 ＋ 前端自动应答开关，把削弱面写进缺口表 ＋ 挂部署侧待办（**不改上游核心**）。

**生效机制**（读码，非推断）：`user = Permission.fromConfig(cfg.permission ?? {})` 排在规则集**最后**，
而 `evaluate()` 用 **`findLast`** ⇒ 配置里的 `ask` **赢过** `defaults` 的 `"*": "allow"`
——这也正是**RED 态的真增量**：6 条里恰红 3 条，红的正是「今天 `rm -rf` 一声不响就跑」。

**3 批变异**（逐批逐字节还原后复核）：**M1**（删 `"del *"` 一行）**恰红 2**（①③，差集打出
`"del data.csv": "ask" → "allow"`，**点名落点**）／**M2**（多加 `"ri *"`）**恰红 1**（①，证警报语义）／
**M3**（临时把上游 `permission/index.ts` 的 `findLast` 改成 `find`，**事后逐字节还原并核 `--numstat` 为空**）
**恰红 2**（③⑤，证这两条**锚定了优先级**）。

**门禁（串行，`#003-01`）**：单文件 lint **0 warnings / 0 errors**；`packages/opencode` typecheck
**EXIT=0**；本文件 **6 pass / 0 fail / 27 expect**（27.92s）；`test/permission/` **91 pass**；
`test/config/` **233 pass**；`test/agent/agent.test.ts` **43 pass**；T011 的两个 instruction 文件
**11 pass / 1 todo**；`lint:openhive` **23 warnings / 0 errors**（本次改动文件 0 命中——本条不碰
`packages/app`）；`git diff --stat bun.lock` **空**。

⚠️ **踩到一个工具怪癖（已探明、写进测试文件头）**：本文件每条 `it.instance` 要真装一次实例
（真 `Config` 走目录发现 ＋ fork 一次后台装依赖），耗时 **2–5s** 抖，而 **bun 的默认单测超时正好是 5s**
⇒ 不带 `--timeout` 直接 `bun test <这个文件>` 时撞到一条 `[5071.84ms] (fail)`。
**取证**：把超时压到 `100` 复跑，报的正是 `this test timed out after 100ms.`（5 条全红）
⇒ 证实那次红**就是默认超时**，不是断言毛病（`#003-01`：红之前先怀疑测量）。修法：5 条 `it.instance`
显式传第 4 个参数 `30_000`（与包脚本的 `--timeout 30000` 同一个数）。

⚠️ **一条副产品结论（回溯证实 T011 的前提）**：本条用**真 `Config`**（不桩）跑通 ⇒
**`.opencode/opencode.jsonc` 真的会被产品从目录发现里加载**。T011 当时用 `TestConfig.make` 桩 ＋
「照产品解析器读真配置」，其「`instructions` 会被注入」的前提由此**回溯成立**。⚠️ 但两边**测法不同**
（T011 测 `globUp` 的相对项解析、要真仓库根；本条测「配置 → 规则集」、tmpdir 就够）——
**不要读成「本条替代了 T011 的测试」**。

**同 task 一并落的文档动作**：`tasks.md` 勾 T012 ＋ **`📌 T012 更正块`**（记 U5 原话与落地形态的两处
差异：①「高风险**工具**」→「高风险**命令模式**」；② 落地层是配置文件的 `permission` 键）；`📤-2`
补上「闸门**已落地**、落在哪、业务动作要自己加 pattern」；`007` / `008` 的 `tasks.md` 📥 块各补一句
**指针**（`#002-04`）；`docs/workspace/deploy-todo.md` 新增 **D-16**（与 **D-15 同一份文件的两笔**，
部署时要一起做）。

**下一个 T014**——[INT] 写测试：高风险动作强制人确认 [SC-003]。⚠️ 与 T013 **同型**：是**测试验收**条，
**不是**实现条（闸门机制 T012 已落地并带 6 条见证）。开工前先读 `tasks.md` 的 T014 行与它的锚
（T012 的配置清单 ＋ `openhive-highrisk-ask.test.ts`）＋ `LEARNINGS #005-09`（先读本 feature 的**挂账清单**，
别把已挂的当新缺口）⇒ **先把出参收窄**：T012 已如实挂了两条——**黑名单按模式匹配天生可绕过**
（包装器 / 脚本内调用）与**「民警真的会被弹窗拦住」本机测不到**（没有真前端、没有真模型）
——**别把这两条挂账重报成新缺口**；T014 能补的是**再往上一段**的可测性质。
✅ **2026-10-07 T014 已收**（见下「T014 出参」）：落点就是「**判定之后那一跳**」——真挂起 ＋ 拒后
不执行，4 条用例 ＋ 4 批变异（含 M4 两次做砸的形状）。

---

2026-10-07（**T011 已完成**：AI 不滥用确定性事 / FR-008。产物 **3 处**——新建
`.opencode/instructions/openhive-tool-path.md`（规则正文，27 行 / 1468 字节）＋ `.opencode/opencode.jsonc`
加 `instructions` 键（**＋3 行**）＋ 新建 `packages/opencode/test/session/openhive-tool-path-instruction.test.ts`
（2 条 / 6 expects）；**零上游源码改动**）→ 出参见上「T011 出参」。

**落点由用户裁定**（压缩前的未定项询问）＝**「配置注入的指令文件」**：规则正文 ＋ `config.instructions` 接线，
不改任何上游代码。同一裁定里的第二个 ⚠️（产品侧配置**下发**属部署侧）已落
`docs/workspace/deploy-todo.md` 的 **D-15**。

**3 批变异**（逐批逐字节还原后复核）：**M1**（删配置声明）**恰红 2**／**M2**（挪走 `.md`）**①pass ②fail**
——两个变异各自**恰好**让一条红（声明层 vs 命中层）／**M2b**（真文件与 `.md.off` 并存）**恰红 1**，
`Received length: 1` vs 期望 2。M2b 是**专为第一轮审查 F-5 的修复**补的取证。

⚠️ **如实记一个假绿**：M1 第一次跑时中文变量名（`备份=…`）把 `&&` 链弄断了（bash 变量名必须 ASCII）
⇒ 变异**根本没执行**，测试对着**未变异**的文件跑了 **2 pass**。改用 ASCII 名 ＋ 分步后复跑才是上表读数。
**教训**：变异脚本的「命令回执」不等于「变异生效」——两次都得看（`#003-01` 同族：先怀疑测量）。

**审查两轮**（`#003-02` / `#005-04`）：第一轮 5 条，**修 2**——F-3（模块级 `mkdtempSync` ＋ `process.on("exit")`
⇒ 换 `tmpdirScoped()` ＋ 用例体内 `Effect.provide`）、**F-5**（`readdirSync` 只筛 `.md` ⇒ 往规则目录里放一份
**非 `.md`** 的规则、没被注入也全套绿，即 `#005-11` 的漏口；改成按 Dirent 判文件）；**挂账 3**——
① `prompt.ts` 摊进 `system` 那一跳全仓无断言（非本条引入，是所有 instruction 源共有的老账）；
② `config.instructions` 的**绝对路径支路**无观测面（部署形态未定，等 D-15）；③ `core/src/instruction-context.ts`
是**第二套** ambient 通道（只读 `AGENTS.md`，实测 `SystemContext` 在本仓三个 app 包里零命中）⇒
会话路径若迁过去，本条接线会**静默失效**（`#003-05` 同族）。**第二轮**：两条修复各做**自证**——
`tmpdirScoped` 真会清（跑前跑后 `$TMPDIR/opencode-test-*` 计数 **76 → 76**）、F-5 的牙由 **M2b** 证。

**门禁（串行，`#003-01`）**：单文件 lint **0 warnings / 0 errors**（130 rules）；`lint:openhive`
**23 warnings / 0 errors**（131 files / 161 rules，与基线一致，**本次改动文件 0 命中**——本条不碰
`packages/app`）；`packages/opencode` typecheck（`tsgo --noEmit`）**EXIT=0 无输出**；本文件 **2 pass / 0 fail**；
兄弟文件 `instruction.test.ts` **9 pass / 1 todo / 0 fail**（未回归）。

**同 task 一并落的文档动作（U5 的两笔）**：`plan.md` / `spec.md` 正文「走 MCP」⇒「走**工具 / 代码执行路径**」
（依据 `#004-13` 的 (b) 类：本仓没有 MCP server，照原样写会得到**空的**断言）；`tasks.md` 出参收窄 ＋
把那段注**补上 `📌 T011 更正块` 标签**（`plan.md` / `spec.md` 一直指着这个名字而它**此前不存在**，
`grep "更正块"` 零命中，`#002-06` 同型）＋ 新增 **`## 📤 交出`**；`007` / `008` 的 `tasks.md` 各加一份
同形 **📥 块**（`#002-04`）。

⚠️ **出参收窄（`#002-02`）**：交付的是「**准则进了每次会话的系统提示词**」＋「**这条接线是活的**」，
**不是**「AI 不会滥用确定性的事」——提示词是**软**机制；**硬**那一半（查询 / 统计真的有工具可调、
且调用受鉴权约束）在 F6 / F7，已落 007 / 008 的 📥 块（📤-1）；「判定涉案」的判定逻辑同（📤-2）。

⚠️ **收尾核账时发现一条账目缺口**：**T010 缺席「已完成」清单**（出参节当时写了，清单忘了加）⇒
本次一并补上（`#002-06` 同族：改一处要 grep 同类）。

---

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

---

2026-10-07（**T010 已完成**：AI 执行 ＋ 展示过程。产物 **6 处：3 个新文件 ＋ 3 处改动**——
新建 `submit-prompt.ts`（右栏正文 → 上游 `sendFollowupDraft`）、`submit-prompt.test.ts`（12 条 / 31 expects）、
`packages/opencode/test/server/openhive-prompt-minimal.test.ts`（真链 1 条 / 5 expects）；改
`session-panel.tsx`（`onSubmitPrompt` 的回话语义 ＋ 三个清空分支）、`session-panel.test.tsx`（＋4 条）、
`ai-session-slot.tsx`（把 `useServerSDK` / `LanguageProvider` / `showToast` 接进来））；
五道门禁全绿（单元档 **977**／组件档 **578**／真链 **1 pass·5 expects**／typecheck **31-31**／
lint **23 警告、0 errors、本次改动文件 0 命中**）→ 出参见上「T010 出参」。

**8 批变异 ＋ 1 批反向**（M1–M8，逐批注入 → 跑 → **逐字节还原**上游三个文件并核 `--numstat` 全空）：
实现 5 批（M1 恰红 2／M2 恰红 1／M3 恰红 1／M4 恰红 1／M5 恰红 1）＋ 第二轮修复 **M6**（回话恒 `false`
⇒ **恰红 2**）、**M7**（乐观 id 自己造 ⇒ **恰红 1**）＋ **M8**（拆掉上游 `reset()` 里的 `cursor: 0`
⇒ **27 条全绿、一条不红**）——M8 是**反向用途**：结论是**改注释、挂账**，不是补测试。

**审查三轮**（`#003-02` / `#005-04`）：第一轮挖出 **F1–F4 ＋ R2-1** 全修（含**我自己按记忆打勾漏掉的那个落点**）；
**第二轮两席并行打到「我刚落的修复」里**——断言席报 **7 条缺口**（**F-2（P1）**：回话契约**两端都没人看着**
⇒ 补 2 条断言；**F-3**：注释说「同源」而只钉了「字段在」⇒ 补**相等断言**；**F-1**：`reset()` 的 cursor
零断言 ⇒ **M8 实测无牙** ⇒ 改注释挂账；F-4/F-5/F-6/F-7 改注释或如实挂账），
注释席报 **3 不实 ＋ 4 部分属实**，**我逐条复跑复现后才改**——三不实里**两条是同一形状**
（**照着自己以为的形状写下来、没 grep 过那一行**）：① 真链文件头「`/api/health` 零命中」**是假的**
（它真注册；结论 v1 不变，退到第二档也仍判 v1）⇒ 这正是 `#004-03` / `#004-04` 点的那类
——**「结论对、理由错」最危险**，下一个人会按错理由去改 `detectServerProtocol`；② `createUserMessage`
的 agent 那一句我写的 `??` 表达式**在 `prompt.ts` 里不存在** ⇒ 照真身逐字改。

⚠️ **两处推翻继承下来的推断**：① **裁定 U6 的前提被实测证伪**——「右栏 `/skill-name` 会把命令名原样当正文发」
**是错的**，它会**真的执行该 skill**（skill 在服务端就是命令）；2026-10-07 用户裁定**保持既有链行为**，
只钉哨兵、不修补。② 另一条我写进注释的推断也**已删并改挂账**（「右栏展示的会话都已有 model」——
`LEARNINGS #003-04`：复现不了的别写成实测）。

**下一个 T012**——高风险动作强制人确认 [FR-009]。
开工前先读 `tasks.md` 的 **`📌 T011 更正块`** 与 **`## 📤 交出`**（U5 的时序：T011 开工时已改写正文，
T012 同类动作先看自己那一格），并按 T011 的先例**先把出参收窄**：「闸门机制」（工具层 `permission.ask`）
在本仓可交付、可测；「判定涉案」的**判定逻辑**是 F6 / F7 的对象（📤-2 已落 007 / 008 的 T014）。
