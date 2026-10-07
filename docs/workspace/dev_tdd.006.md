现在开始实现 `docs/superpowers/specs/006-ai-session/`（内层仓库 openhive 内）。

> 以下路径均相对于**当前会话的工作目录**（= worktree 根 `openhive\.claude\worktrees\feat-006-ai-session\`）。
> 绝对路径锚点：仓库根 `D:\project\study\openhive\openhive\`；外层工作区 `D:\project\study\openhive\`。

**本 feature 一句话**：落地**右栏 AI 会话**的四层「指令卡机制」——顶部常驻「常用操作」、随中栏选中浮现的
「上下文指令」、「更多 skill」抽屉、`/` 命令面板；四层全部由**同一套通用机制**投影各模块 skill 的能力清单，
点卡片 = 填一句话、AI 执行并展示过程。它是 design-v2 §8.2 那句「**薄界面 + 厚 skill**」的可发现入口。

**任务总量 14 条**（T001–T014，7 个阶段）：

| 阶段 | 编号 | 内容 | 标签 |
|---|---|---|---|
| Phase 1 | T001–T002 | 定位原生右栏会话 / 确定 skill 能力清单声明接口 | **2 FE** |
| Phase 2 | T003 | 指令卡机制通用框架（投影能力清单） | 1 FE·新增 |
| Phase 3 | T004–T005 | 顶部「常用操作」／「上下文指令」动态浮现 | 2 FE·新增 |
| Phase 4 | T006–T007 | 「更多 skill」抽屉／`/` 命令面板 | 2 FE·新增 |
| Phase 5 | T008–T010 | 复用原生右栏会话（换皮）／点卡片填一句话／AI 执行展示 | 2 FE + **1 INT** |
| Phase 6 | T011–T012 | 确定性查询走 MCP／高风险动作强制人确认 | **2 INT** |
| Phase 7 | T013–T014 | 测试：指令卡投影 + 上下文浮现／高风险强制确认 | 1 FE + 1 INT |

标签分布：**`[FE]` 10 条（换皮 2 + 新增 8）、`[INT]` 4 条、`[BE]` 0 条**。

⚠️ **与 005 的关键差别，先记住四句**：

1. **005 是 7 FE / 8 BE；006 是 10 FE / 4 INT / 0 BE——但「纯前端」是它自己的自我描述，不是实测（见 D0-2 / D0-3 / D0-4）。**
   这三条 🔴 里每一条的修法都**可能要动后端**。开工前先把「到底有没有 BE 活」量出来，别照标签表安排。
2. **006 是「第一个从零建的 UI 机制」：`grep -rn "指令卡\|instruction-card\|QuickAction" packages/app/src`
   今天零命中**。005 的 `[FE·换皮]` 至少还有 `components/file-tree.tsx` 可复用；006 的 8 条「新增」
   **上游没有任何近亲**，最像的三样（slash 弹层 / 命令面板模型 / drawer）都长在**别的场景**里。
3. **它的正确性判据不在「卡片长得对」，而在「机制通用」**（FR-006 / US1）：换个模块，四层跟着换内容，
   **不是把某个模块的卡片硬编进去**。这条判据今天没有现成观测面——**要自己造**（见 Step 3 的测试表）。
4. **006 的红线换成了「上游 skill schema + 上游前端组件」**：`packages/schema/src/skill.ts` 与
   `packages/opencode/src/skill/index.ts`（若 T002 走扩 frontmatter）、`packages/app/src/components/**`
   （`ui/drawer.tsx` / `command-palette.ts` / `prompt-input/slash-popover.tsx`）与
   `packages/app/src/pages/session/**`（`SessionSidePanel` / `message-timeline`）**全是上游文件**。

**006 是 009 的上游**：`docs/superpowers/specs/009-ai-assets/tasks.md:5` 的 Prerequisites 明写
「**F4 RBAC + F8 指令卡已落地**」。T002 产的那份「skill 能力清单声明格式」是 **006 → 009 的契约**，
写它的时候要按「**被调方**的样子写」（`LEARNINGS #004-07`），不是按 006 自己方便的样子写。

---

## Step 0 · 开 worktree 之前 / 刚开后（**逐项验证，不要"顺手修"**）

**0.1 基点设置（易误判，先看这条）**

`worktree.baseRef` **已配置为 `head`**（`C:\Users\Administrator\.claude\settings.json`）——它是
**Claude Code 的设置项、不是 git config**，用 `git config worktree.baseRef` 查会显示为空，别据此判断
「没配置」（`LEARNINGS #001-03`：默认 `fresh` 会从 `origin/dev` 切）。

**0.2 验证基点正确**

```bash
git merge-base --is-ancestor multi-tenant HEAD    # 退出码 0 = 基点正确
```

不通过就**停下来告诉我**，不要自行 `git reset --hard`。

**0.3 验证 005 已合入（006 的地基）**

006 的 `tasks.md` 的 Prerequisites 写的是「**F1 右栏骨架 + F4 权限已落地**」。F4 = 004，**F1 = 001**
（三栏骨架）。而**右栏骨架的「骨架」两字要打个问号**——见 D0-1：F1 只定义了右栏的**位置与宽度常量**，
**没有接任何内容**。005 是 006 的**直接前序**（005 交出了左栏与侧边栏的全部用法先例）。

006 开工前，先在主检出确认这两项：

```bash
git merge-base --is-ancestor v0.1.0-005-project-management multi-tenant \
  && echo "✅ 005 已合入" || echo "❌ 005 未合入，停"
git merge-base --is-ancestor v0.1.0-004-access-control multi-tenant \
  && echo "✅ 004 已合入" || echo "❌ 004 未合入，停"
```

⚠️ **用 tag 而不是分支名**：`worktree-feat-005-project-management` 这个分支在 005 合并后**可能已被清理**，
而 tag 是持久引用。**两条都不要写死 SHA**（`LEARNINGS #002-06`：会随提交而变的值写取数命令）。

**0.4 符号链接体检**

仓库含 **60 个 symlink 资产**（favicon / logo / 图标）。本机已修复，`core.symlinks` 已是 `true`。

```bash
git status --porcelain                # 应为 0 行，干净
# 若出现大量 " T"（typechange）→ 说明又被降级成路径文本文件了
```

**修法（仅在真的出现 `T` 时）**：

```bash
git status --porcelain | awk '{print substr($0,1,2)}' | sort -u   # 确认只有 " T"
git status --porcelain | grep '^ T' | cut -c4- | xargs rm
git checkout -- .
```

**0.5 工作区残留体检（005 那两枚坑会在 006 重演）**

```bash
git diff --numstat                      # 有孤零零一个 M 而这里为空 ⇒ 陈旧 stat 伪影（#005-08），别提交、别 checkout
ls -la .git/worktrees/feat-006-ai-session/index.lock 2>&1   # 存在且 0 字节 + 无 git.exe ⇒ 陈旧锁（#005-10），可删
```

⚠️ **`git add` 之前别跑 `git status`**，也别用 `git add .`——**点名文件**（`#005-08` / `#005-10`）。

---

## Step 0.5 · 开工前必须先实测的七件事（**"命中就停下来问"**）

⚠️ 006 与 004 / 005 一样**没有预置决策点清单**（`plan.md` / `tasks.md` 里没有 D1–Dn）。
下面七条**不是从它自己的文档里抄的**，是三份开工前实测（右栏接线 / skill 与权限机制 / 确认闸门与 UI 地基）
**逐条打出来的**「plan 假设 ⇄ 仓库现状」的差集。**每条都带落点与判据**，且每条都可能是「停下来问」的触发点。

> 📌 **可复用的做法**（003 / 004 / 005 各验证过）：
> **开工必读之后、动第一行代码之前，先问「这条 task 的出参，今天在仓库里打得到吗？」**
> 打不到就别做——**先裁定归属**。004 靠这一问省掉了 T010/T011 两条假测试（整条移交 F7）；
> 005 靠它把 D0-4 认成「方案不是代码」。

### 🔴 D0-1（头号风险）：**「复用 opencode 原生右栏会话」是双重误判——右栏是空槽，而 `SessionSidePanel` 不是会话流**

plan.md 的技术上下文写「**复用的是 opencode 原生 SessionSidePanel（右栏会话）**」，
依赖清单写「opencode SessionSidePanel｜右栏会话｜复用会话消息流 / 会话管理 / 导出」。
**实测两处都不成立**：

**(a) openhive 的右栏是个空槽，今天根本不渲染。**

```tsx
// packages/app/src/workspace/three-pane.tsx:16-25   ← props.right 存在，宽度常量 RIGHT_PANE_DEFAULT = 360 已写好
// packages/app/src/workspace/three-pane.tsx:82      ← <Show when={props.right !== undefined && !props.rightCollapsed}>
// packages/app/src/workspace/workspace-entry.tsx:424  ← 唯一的【生产】接线点
<ThreePane left={center.module() === "project" ? (<div data-component="project-sidebar">…</div>) : undefined}>
  <TabBar …/>
  <CenterContent …>{props.children}</CenterContent>
</ThreePane>
```

`left` **传了**（005 的 T005 接的），**`right` 从头到尾没传过一次** ⇒ `aside[data-slot="three-pane-right"]`
与其 `ResizeHandle` 都不渲染。**「F1 右栏骨架已落地」的真实含义是「位置与宽度常量已定义，内容空缺」**——
001 自己在 `docs/superpowers/specs/001-platform-foundation/state.md:379` 就把它记成
🔴 待决项：「**右栏（AI 会话）无任务供给**……在此之前，FR-001 的右栏仍只是『位置已定义、内容空缺』」。

**(b) `SessionSidePanel` 是 review diff + 文件树面板，不是会话消息流，也不在 openhive 界面里。**

| 你要的 | 真身 | 实测 |
|---|---|---|
| 「右栏会话」组件 | `packages/app/src/pages/session/session-side-panel.tsx:SessionSidePanel` | 内容是 `reviewPanel` / `SessionContextTab` / 文件树（`FileTree`）/ `OpenInAppV2`；**aria-label 是 `…reviewAndFiles`**。**没有**会话列表 / 新建 / 切换 / 重命名 / 删除 / 导出 |
| 会话**消息流** | `packages/app/src/pages/session/timeline/message-timeline.tsx` ＋ `pages/session.tsx:SessionPage` | 在**中栏**（主内容区），不在任何右栏 |
| 会话**管理** | 新建 `pages/home/home-sessions-controller.tsx:180`；重命名 `components/titlebar-tab-strip.tsx:108`、`message-timeline.tsx:677`；删除 `message-timeline.tsx:817` ＋ `DialogDeleteSession`；归档 `pages/session/session-archive.ts`；导出 `utils/session-export.ts` | **散在五六个上游文件里**，没有一处叫「会话管理面板」 |
| `SessionSidePanel` 的使用点 | `pages/session.tsx:2306` / `:2328` | 只在**上游 SessionPage 路由内**；openhive 入口链是 `layout-new.tsx → WorkspaceEntry → ThreePane`，**够不到它** |

⇒ T001「定位原生右栏会话 + 会话管理入口」、T008「复用原生右栏会话（消息流 + 会话管理）」的**出参
「右栏会话/会话管理真实入口」今天是不存在的**。plan 的 R1 把风险写成「是否侵入 SessionSidePanel」，
**真问题是「右栏里到底放什么」**。

**为什么是「停下问」**：三条路的量级差一个数量级，且互相不兼容——
- **(a) 把上游消息流体系搬进右栏**（`message-timeline` + composer + 会话管理接一遍）⇒ 侵入面最大，
  且与中栏既有的会话页**功能重叠**（`LEARNINGS #002-06`：同一个东西两处各写一份的同型风险）；
- **(b) 只把 `SessionSidePanel` 换皮后挂到 `right` 槽**⇒ 接线成本最小，但它**不是消息流**，
  US4 / AC「AI 回复展示在消息流」**当天就不成立**；
- **(c) 另定「右栏会话的最小形态」**（自建一个轻量消息流 + 复用上游 `session.*` API）⇒ 可控，
  但要自己写消息渲染，且要回答「它和中栏会话页谁是主」。

**判据一句话**：`workspace-entry.tsx:424` 那个 `<ThreePane>` 的 **`right` 槽里放什么组件**——
以及**「会话消息流」这个词指的是不是「把中栏那套搬过来」**。**由你裁定，不要自行选一条。**

**建议**（供你裁，不必接受）：先按 (c) 想清楚「最小可用右栏会话」是什么，再比 (a)/(b)；
**(b) 最省但最可能收不了场**——它会让 US4 的验收从第一天起就是假的。

### 🔴 D0-2：**「指令卡只展示有权 skill（capability 过滤）」今天没有任何承载体——plan 把它标 ✅ 是推定，不是实测**

plan.md 的 Constitution Check 第 IV 行写：「**指令卡只展示有权 skill（capability 过滤），
鉴权在 F4 执行层硬拦** ⇒ ✅ 无冲突」；集成点写「**复用 F4 权限**：指令卡只展示有权 skill」。
FR-004 / FR-005 的验收（SC-004）也全押在这句话上。

**实测：前端今天完全拿不到「当前用户有权用哪些 skill / 命令」。**

| 环节 | 真身 | 实测 |
|---|---|---|
| v1 列表端点 | `GET /skill`（`.../httpapi/handlers/instance.ts:84:getSkill`）、`GET /command`（`:76:getCommand`） | 直接 `skill.all()` / `command.list()`，**无权限参数、非会话作用域**（004 已挂账） |
| v2 列表端点 | `GET /api/skill`（`packages/server/src/handlers/skill.ts:7`）、`GET /api/command`（`.../command.ts:7`） | 同型：`SkillV2.list()` / `CommandV2.list()`，**无过滤** |
| 权限投影 | `packages/core/src/access/session.ts:165:sessionRuleset`；`packages/opencode/src/server/openhive/access.ts:47:capabilityFor` | `grep AccessSession\|sessionRuleset\|capabilityFor packages/app` ⇒ **No files found**（零前端消费者） |
| 权限真正拦在哪 | `packages/opencode/src/session/prompt.ts:1457`（R1 门，skill 命令出口）、`packages/opencode/src/tool/skill.ts`（`ctx.ask`）、`packages/opencode/src/session/tools.ts:88` | **只在执行层**——前端不过滤也拦得住，但**前端也没得过滤** |
| 前端今天消费 skill 吗 | `packages/app/src` 里 `skill` 只有 3 处且都不是列表消费（`server-session-v2-reducer.ts:84` 事件、`bootstrap.ts:291` 注释、`slash-popover.tsx:29/340/349` 的 `source==="skill"` 徽章，数据来自 command） | 真正消费 `GET /api/skill` 的是 **TUI**（`packages/tui/src/context/data.tsx:543`） |

⚠️ **这不是 005 一家的老账**。`docs/superpowers/specs/005-project-management/state.md` 的
「四份文档口径」一节已记：006 / 007 / 009 / 010 的 plan **都**声称「capability 三层拦截已由 F4 落地」，
与 004 的交付物**相矛盾**（`AccessCapability` / `AccessIssue` 零生产调用点）。
**用户 2026-10-06 的裁定是：本次不动那四份文档，只记一笔——各 feature 开工时须自己实测再钉。**
**这就是那一次「自己实测」的时刻。**

**为什么是「停下问」**：两条路的合规说法**完全不同**，且第二条不是「偷懒」而是宪法 §四 的正面要求——
- **(a) 新增一个会话作用域、带 capability 过滤的 skill 投影端点**（`GET /session/:id/skills` 之类）⇒
  前端才真的「只展示有权 skill」，SC-004 才说得通。**代价**：新端点 + 新投影逻辑（BE 活！），
  且要回答它与 004 已挂账的「`GET /skill` 非会话作用域」是不是同一件事的两半。
- **(b) 前端不过滤，四层一律展示全量**，靠执行层硬拦 ⇒ 宪法 §四 **允许**这个形状
  （「前端『只显示有权的』是 UX，**不是安全**」），但**必须同步改掉 plan 里那句 ✅ 的理由**，
  否则就是「用前端隐藏资源替代权限校验」的**文字版**（宪法 §四/Anti-Patterns 明令禁止）。

**判据一句话**：**「有权 skill」这四个字在 006 里是「前端过滤一个列表」还是「前端不过滤、执行层拦」**——
两条都合法，**但 plan 今天写的是第一条、仓库支持的是第二条**，这个差必须被消掉。

#### ⚠️ D0-2 附：F7/F8 的 MCP → 业务 PG RLS 链路上**仍在传身份**（003 的常驻下游项）

`docs/superpowers/specs/003-multi-tenant-isolation/tasks.md:747,750,906,907` 记着：
链路上仍在传 `X-User-ID`（明文头），**F7/F8 开工时须照 003 的 T014 裁定**。
**006 是 F8。** 若 D0-2 选了 (a)（新投影端点），这个问题**会立刻撞上**——新端点要不要读身份、
怎么读、和既有 `capabilityFor` 是不是同一条线。**先读 003 的那四处，再定。**

### 🔴 D0-3：**skill 没有任何可用于「分组 / 能力清单」的元数据——T002 要产的是「新契约」，而且它是 006 → 009 的契约**

T002 的措辞是「**确定 skill 能力清单声明接口**（各模块 skill 声明能力的契约）」，出参「能力清单声明格式定义」。
FR-006 要「机制通用——各模块 skill 只需声明能力清单，框架自动投影」。

**实测：两套 skill `Info` 都只有三个字段，没有任何分组 / 分类 / 标签 / 能力字段。**

| 栈 | 定义处 | `Info` 形状 | frontmatter 只认 |
|---|---|---|---|
| v1 上游 | `packages/opencode/src/skill/index.ts:37-42` | `{ name, description?, location, content }` | `name` / `description` |
| v2 core | `packages/schema/src/skill.ts:20-26` | `{ name, description?, slash?, location, content }` | `name` / `description` / `slash` |

- 发现机制是**文件系统 glob**（`SKILL_PATTERN = "**/SKILL.md"`，v1 `index.ts:21-25`；
  v2 `packages/core/src/skill.ts:73-105` 扫 `{*.md,**/SKILL.md}`），frontmatter 解码 schema 在
  `packages/core/src/skill.ts:33-37`。**没有 `group` / `category` / `tags` / 能力清单**。
- 样例（本仓真实文件）：`.opencode/skills/effect/SKILL.md` 的 frontmatter **只有两行**（name / description）。

⇒ **T002 不是「确定一个既有接口」，是「新造一个契约」**，而且有三种后果要一起算：

1. **它是 006 → 009 的契约**（`009-ai-assets/tasks.md:5` 把「F8 指令卡已落地」列为 009 的前置）
   ⇒ 契约的**判据来源必须是被调方**（`LEARNINGS #004-07`）。今天被调方**不存在**，
   所以「按什么形状写」这件事本身**没有客观依据**——要么先定 009 的资产元数据（§11 已列：
   名称/ID/类型/描述/图标/标签；所有者/部门/可见范围；版本；状态；**收藏数、使用次数、评分**），
   要么承认这是一份**预测性契约**并写清「009 落地时须复核」。
2. **扩 frontmatter = 动上游两个 loader + 上游 schema**：`packages/schema/src/skill.ts` +
   `packages/core/src/skill.ts` + `packages/opencode/src/skill/index.ts`** 三处都要认新字段，
   否则 v1 / v2 两条栈会**静默不一致**（`LEARNINGS #002-06`：同一个判断两处各写一份）。
3. **旁路一份 openhive 自己的清单**（新文件，如 `docs/…/skill-capabilities.yaml` 或
   `packages/app/src/ai-session/capabilities.ts`）⇒ 零上游改动，但**清单与 `SKILL.md` 会漂**
   （skill 改名 / 新增而清单没跟上，**不报错、不变红**——`LEARNINGS #004-03` 的「有 X 钉住」假象）。

**为什么是「停下问」**：这三条路的**上游侵入面**与**漂移风险**正好相反，且 T002 的产物是**跨 feature 契约**
（009 要在它上面长）。**由你裁定。**

**判据一句话**：**能力清单住在 `SKILL.md` 的 frontmatter 里（动上游三处），还是住在 openhive 自己的
一份旁路文件里（零上游改动但要防漂）**——以及**若走前者，v1 与 v2 两个 loader 要不要一起改**。

### 🔴 D0-4：**US5 的两条出参今天都打不到——确定性查询没有 MCP server，高风险强确认没有后端闸门**

T011 的出参是「**确定性查询走 MCP**」，T012 是「**高风险动作（删除数据/判定涉案）强制确认**」，
SC-003 要「**100% 强制人确认**」。**实测四条硬事实**：

**(a) 仓库里只有 MCP 客户端，没有生产 MCP server。**

- 客户端：`packages/opencode/src/mcp/index.ts`（`StdioClientTransport` / `SSEClientTransport` /
  `StreamableHTTPClientTransport`），`@modelcontextprotocol/sdk:1.29.0` **只声明在
  `packages/opencode/package.json:84`**。
- **全仓唯一的 server 侧代码在测试夹具里**：`packages/opencode/test/fixture/mcp-lifecycle-stdio.ts`
  （`import { Server } from "@modelcontextprotocol/sdk/server/index.js"`，只暴露一个 `current_directory` 工具）
  与 `packages/opencode/test/tool/code-mode-integration.test.ts:11`。`packages/*/src` 下**零命中**。
- 被查询的 server（`Config.mcp` 的键，如 `fund.db`）是**外部配置**，不是本仓产物。
- 旁证：`packages/core/src/access/capability.ts:57-60` 记着「T010/T011 整条**已移交**
  `007-fund-analysis`」。**006 与 007 有依赖关系——而 006 的 tasks 里没写。**

**(b) `permission.ask` 的全部调用点都在工具/会话执行路径——业务动作层没有闸门。**

| 落点 | 实测 |
|---|---|
| 闸门本体 | `packages/opencode/src/permission/index.ts:ask`（:67）+ `evaluate`（:28-38）**按规则集触发**：`deny` ⇒ 抛 `DeniedError`；`allow` ⇒ 放行；**其余（含兜底 `ask`）⇒ 挂起等人答** |
| 调用点（全） | `session/tools.ts:88`（工具壳）、`session/prompt.ts:735`（MCP 资源）、`:1464`（skill 命令 R1 门）、`session/processor.ts:372`、`session/llm.ts:187` |
| **不在**哪些地方 | `server/openhive/archive.ts` / `file.ts` / `member.ts` / `project.ts`、`handlers/session.ts` 的 remove/setArchived —— **一个都没有** |
| 005 的「高风险确认」是什么 | `packages/app/src/project/file-tree.tsx`（`data-slot="file-tree-delete-confirm"`）等三处**纯前端内联确认条** |
| 前端旁路 | `packages/app/src/context/permission-auto-respond.ts`（auto-accept）**能让弹窗不出现** |

⇒ 「强制人确认」若要**硬拦（不被前端绕过）**，今天**没有后端承载体**；SC-003 的「100%」无从判定。

**(c) T012 举的两个例子里，「判定涉案」全仓零命中。**`grep 涉案 packages/*/src` ⇒ **只命中文档**
（006 自己的 `spec.md:33/41/78/87/111/127` 与 `tasks.md:45`）。F6 资金 / F7 话单未落地 ⇒
**这个动作没有 action、没有端点、没有 skill、没有 MCP 工具**，出参**无对象可验**。

**(d) 「删除数据」这一半有对象，但和 T012 的语境对不上。**删除的现成实现是文件删除
（`file-tree.tsx`）与会话删除（`handlers/session.ts:404 deleteMessage` / `:413 deletePart`），
都是**上游或 005 的既有物**，不是「AI 执行的高风险动作」。

**为什么是「停下问」**：US5 是 spec 里唯一的 P2 故事，但它的**两条判据都是空的**。
按 003/004/005 的做法：**先探，打不到就停下来问**——是
「T011 改写成『确定性查询走工具/代码执行路径』（不写 MCP）」+
「T012 复用**工具执行层**的 `permission.ask`，对高风险**工具**加强制 ask 规则」+ 把「判定涉案」挂账到 F6/F7，
还是「US5 整条挂 `deploy-todo.md`」。**不要造一个假 MCP server / 假业务动作把测试写绿**
（`LEARNINGS #002-02`：没有真正执行被测路径的不是测试，是缺口）。

**判据一句话**：**T011 的「MCP」三个字今天指的是哪个进程**；**T012 的闸门住在
`permission/index.ts`（工具层）还是别处**。两条都要落到**打得开的东西**上才算数。

⚠️ **顺带**：若裁定 T011 依赖 007 的 MCP server，**必须落进 007 的表**，不能只写在 006 的文档里
（`LEARNINGS #002-04`：责任被推出边界时必须落进**接收方**的表）。

### 🔴 D0-5：**视觉规格「两头都缺」——DESIGN.md 没有指令卡/抽屉/命令面板，参考样本 `figma-export/<page>/` 也不存在**

T003–T007、T009 都是 `[FE·新增]`，plan.md 的换皮区写「视觉真理来源：`../openhive-DESIGN.md` + `theme.css`」，
并在 ③ 列了两处参考样本。**实测：两头都打不到。**

**(a) `openhive-DESIGN.md` 只有「通用卡片」级别的规格，没有一条是这四个组件的规格。**

取数（**本条已复跑，数字为实测**）：
`grep -n "指令卡\|右栏\|抽屉\|命令面板" docs/superpowers/specs/openhive-DESIGN.md` ⇒ **只有 2 处**
（L93 圆角、L114 右栏宽度）。放宽成 `grep -n "会话\|卡片"` ⇒ 11 处，其中有价值的仍是**通用**条目：

| 行 | 内容（实测原文摘要） | 对 006 有用吗 |
|---|---|---|
| L19 | 「千问办公｜对话优先（Hero 输入）、冷启动引导、**阴影分层（卡片浮起）**」 | **参考气质**——右栏对话的设计母题 |
| L23 | 「**三栏**：左导航 / 中浏览（内容工作区）/ **右 AI 会话**」 | 只给位置 |
| L80 | 「标题/卡片标题｜14~16px｜600~700」 | **可用**（卡片标题字号） |
| L93 | 「卡片 / 输入框（右栏对话 Hero 输入）｜**12~16px**」圆角 | 只给圆角，**且它说的是输入框** |
| L113 | 中栏「白底卡片 + 柔和阴影」 | 通用 |
| L114 | 「右栏（AI 会话）｜**360px（可拖 240~2/3）**｜对话优先，输入框视觉中心｜借千问 Hero 输入」 | 只给宽度与气质 |
| L121 | 「图标栏五入口｜项目 / AI 资产 / AI 会话 / 话单分析 / 资金分析」 | 无关 |
| L126 | 「卡片｜白底 + 阴影 `0 1px 2px + 0 4px 12px` 柔和投影，**16px 圆角**」 | **可用**（卡片本体；⚠️ 原文写的是 hex `#FFF`，落码要走 token） |
| L160 | 中栏 tab 的「opencode 会话 tab」 | 无关 |
| L180 | 「AI 会话 `ai-session`｜`--v2-avatar-bg-cyan`」 | 只给模块色 |

**缺的是**：指令卡**行的尺寸 / 间距 / 溢出「⋯」的形态 / 选中态 / 悬停态**、
抽屉的**宽度 / 分组标题 / 「最近使用」分段样式**、命令面板的**行高 / 当前项高亮 / 模糊匹配的强调**——
**一条都没有**（L93 只给圆角、L126 只给卡片本体，都不足以定一个**行**）。
⇒ 直接触发宪法 §八 那句：**「DESIGN.md 未覆盖的，先在 DESIGN.md 补充再引用」**。
**这是 10 条 `[FE]` 任务的第一块砖**（所以标 🔴 而不是 🟡）。

**(b) plan.md 的两处「视觉参考样本」都不在仓库里。**

- `plan.md:87` 的 `../design-reference/figma-export/` ⇒ 实测**只有 5 个文件**：
  `logo-dark.svg` / `logo-light.png` / `logo-light.svg` / `logo-mark.svg` / `tokens.css`。
  **没有页面子目录**（`find docs/superpowers/specs/design-reference -type d` ⇒ 只有它自己）。
  而宪法 §九 要求 `[FE]` 任务在写组件代码前读 `design-reference/figma-export/<page>/`——
  **这个 `<page>` 今天不存在**。
- `plan.md:88` 的「front 组件 `RightAIChat`」⇒ **`ls front` ⇒ No such file or directory**。
  `front` 是**外层工作区的 Figma 前端**，不在本仓库（`RightAIChat.tsx` 全仓零命中，只在
  001 的 `plan.md:126`、006 的 `plan.md:88`、归档文档里被**引用**过）。

**(c) 有一条替代路径可查，别自己发明。**`docs/superpowers/specs/archive/2026-08-30-前端落地策略-opencode换皮-design.md:30`
已经裁定过：「会话 UI｜front 手绘 `RightAIChat.tsx`｜**`@opencode-ai/session-ui` 包（60+ 组件）**」——
即**视觉参考应转成 `packages/session-ui` 的原生组件来对齐**。006 的「右栏对话」最贴的现成物是
`packages/session-ui/src/` 那一批（含 `v2/components/prompt-input/`、`dock-prompt`、
`attachment-card-v2.tsx`、`tool-error-card-v2.tsx` 等）。

**为什么是「停下问」**：视觉规格由**你**拍，不是由 AI 编。**开工第一步是补 `openhive-DESIGN.md`
的「指令卡 / 更多 skill 抽屉 / `/` 命令面板」一节**（或明确引用既有哪几条），
并把「参考样本」的实际可得来源钉清楚（`session-ui` 原生组件 + `theme.css` token）。

**判据一句话**：**这四个组件的视觉值写在哪一行 DESIGN.md 里**。写不出行号 ⇒ 先补 DESIGN.md，再写代码。

#### ⚠️ D0-5 附：005 交接了一枚**选中态 token**的暗色缺口，而 006 会**再引入三处选中态**

`docs/superpowers/specs/005-project-management/session.md:147` 的缺口表里有一条（005 的编号 **R2-09**）：
**深色方案没有 `--v2-background-bg-accent-soft`**（`packages/ui` 的 dark 块缺覆盖 ⇒ 回落浅色值 ⇒
近白字压奶黄底）；005 自己的裁定是**非阻断**，理由是 `openhive-DESIGN.md §6.2` 明写**不启用暗色**。

006 会**新增至少三处选中态**（常用操作卡片选中 / 抽屉行选中 / 命令面板当前项高亮），
大概率复用**同一个 token**。**补 DESIGN.md 那一节时，把这条一并处理**——
沿用 005 的裁定（「本轮不启用暗色，此 token 在 dark 的值继续挂账」），或顺手在
`packages/ui/src/v2/styles/theme.css` 的 dark 块里定掉。**两条都要说出口，别默默跳过。**
⚠️ 若动 token，**三处真相链必须同步 + 跑生成器**（`packages/ui/src/v2/styles/theme.css` 的 `:root` 与
`[data-color-scheme="light"]` 两处 + 重跑生成器产出 `oc-2.json`），漏一处**构建/typecheck/既有测试全绿**
（`LEARNINGS #001-04`）。

### 🟡 D0-6：**FR-004 的三个排序键（分组 / 最近使用 / 收藏加权）今天全无承载体**

T006 的出参是「抽屉按规则排序」，FR-004 写「**按 skill 分组 + 最近使用上浮 + 收藏加权排序**」。

**实测：三个键一个都没有。**

| 键 | 今天的事实 |
|---|---|
| **分组** | skill 无 `group` 元数据（见 D0-3）。**有 UI 层分组机制但无 skill 分组数据**：`components/dialog-command-palette-v2.tsx:27:groups()` 按 `entry.category` 分组，那是**功能命令**的 category（`command.category.*` i18n 键），不是 skill 的 |
| **收藏** | `grep -rn "favorite\|favourite\|收藏" packages/app/src packages/core/src` ⇒ **零命中**（唯一 `favorite` 在 `packages/web/src/content/docs/**/keybinds.mdx` 的**模型**收藏，与 skill 无关） |
| **收藏的存储** | **auth 库（每用户库）的建表全集**只有：`auth.user`（`migrations/0001_init.sql:14`）、`auth.role`/`auth.user_role`/`auth.role_resource`（`0004_rbac.sql`）、`auth.project_member`/`auth.project_archive`（`0005_project_member.sql`）。**没有任何 preference / favorite / recent 表。**客户端只有一份 localStorage（`context/settings.tsx:233` 的 `persisted("settings.v3")`，是视图/布局偏好，非每用户服务端存储） |
| **最近使用** | app 里的 `recent` **全是别的维度**：`context/server.tsx:86:recentlyClosed`（最近关闭的**项目**）、`components/command-palette.ts:118:recentFileEntries`（最近打开的**文件**）。**没有 skill 维度** |

- 006 自己的 spec 已经把这件事推给 F9（`spec.md:138`）：
  「收藏（个人偏好）作为抽屉排序的加权因子，**其存储与治理在 F9**」。

**为什么是「停下问」**：FR-004 的三个键今天只能有**降级形态**（本机权重 / 无收藏层 / 分组靠
旁路清单的某个字段），而**「降级」与「挂账」是两回事**——
- 若做「降级形态」，**判据要写清降级到什么**（`LEARNINGS #002-02`：测不了的写成缺口，不是覆盖）；
- 若挂账，**落点必须是 F9 的表**，不能只写在 006 的文档里（`LEARNINGS #002-04`）。

**判据一句话**：**抽屉的排序输入从哪来**——今天能给的是「三键里哪一个」，另外两个**写进 006 的
`state.md` 缺口表 + 落进 009 的 tasks.md**，并明说「**收藏/最近使用的存储是 F9 的**」。

### 🟡 D0-7：**新增 `packages/app/src/ai-session/` 会在三处「自有目录」清单上静默漏扫**

plan.md 的文件结构要新建 `packages/app/src/ai-session/`（5 个文件）。**实测：三份「自有目录」清单，
漏加不会报错，只会静默失去覆盖。**

| # | 文件 | 符号 | 内容 |
|---|---|---|---|
| 1 | `packages/app/src/openhive-module-dirs.test.ts:11` | `moduleDirs` | `["rail","center","topbar","workspace","project","auth"]`，**只断言「列出的目录存在」** |
| 2 | `packages/app/src/workspace/design-token-refs.test.ts:45` | `自有目录` | 同一份清单，校验目录内 `var(--v2-*)` / `bg-v2-*` 的**名字在 `packages/ui` 里有定义** |
| 3 | 根 `package.json:16` | `lint:openhive` | 命令行尾随那 6 个路径——`script/oxlintrc.openhive.json` **没有目录清单**，扫描范围**完全由它决定** |

- **`openhive-module-dirs.test.ts` 全文 19 行，没有目录名白名单**——它约束的是
  「列出的目录必须存在」，**不是**「只允许这些目录」⇒ **新增 `ai-session/` 不会让任何测试变红**。
- **静默放过的后果是真的**：漏加时 `test:unit` / `test:components` / `lint:openhive` / CI **全绿**，
  但 `ai-session/` 里新写的**裸色值不被 `no-raw-color` 扫**、**错误 token 名不被 token 守卫查**。
- `design-token-refs.test.ts` 有两条元断言（`源文件.length > 20` / `引用.size > 3`），
  但它们防的是「整个扫描变空」，**防不住「漏了一个新目录」**（6 个剩 5 个，计数照样过）。
- **Storybook 不用改**：`packages/storybook/main.ts:28` 是**通配**
  （`"../../app/src/**/*.stories.@(js|jsx|mjs|ts|tsx)"`），新目录的 `.stories.tsx` **自动被收**。

⇒ **开工第一件事**就是把 `"ai-session"` 加进上面 **① ②** 两处 + `package.json:16` 的**③**。
**三处要同时改**（只改一处 = 一个真相三份写法，`LEARNINGS #002-06`）。**改法先报告、别自己拍。**

**判据一句话**：`grep -rn "ai-session" packages/app/src/openhive-module-dirs.test.ts
packages/app/src/workspace/design-token-refs.test.ts package.json` ⇒ **应当 3 处命中**。

---

## Step 1 · Worktree 隔离

```bash
claude --worktree feat-006-ai-session    # 基准 = 当前开发主线 multi-tenant
```

（自动按 `.worktreeinclude` 复制 `.env` / `.env.local` / `.env.development` / `.credentials.yaml`）

---

## Step 2 · 启动必读（每个 task 开始前）

① 先读 `D:\project\study\openhive\.specify\memory\constitution.md`，遵守其全部原则——**冲突以宪法为准**。

> ⚠️ 必须用**绝对路径**：宪法在外层工作区、不在本仓库。worktree 里写 `../.specify/memory/constitution.md`
> 会解析到 `.claude/worktrees/.specify/…`，**读不到**。
> 本 feature 最吃重的是 **§八（前端设计系统——006 是它最纯的适用对象）**、
> **§九（每个 `[FE]` task 写码前必须读 DESIGN.md 与匹配的参考样本）**、
> **§四（权限下沉执行层——见 D0-2）**、**§一/§五（最小化上游冲突 / 侵入是「加」不是「改」）**。

② 读 `docs/superpowers/specs/openhive-DESIGN.md`（**本 feature 的视觉真理源**，但见 D0-5：
**它对指令卡/抽屉/命令面板是空白的**）+ 本 feature 的 `plan.md` + `tasks.md`
+ 下面这三份**权威设计依据**（006 的四层卡片形态全部出自这里）：

| 文档 | 读什么 |
|---|---|
| `docs/superpowers/specs/2026-09-06-openhive-design-v2.md` §8.1 / §8.2 / §8.3 | **§8.2 是 006 的正典**：右栏 = AI 会话的重定义 + **四层指令卡表格**；§8.3 是 rail 五入口 |
| 同文档 §11（AI 资产治理） | §11.5 明写「**收藏 = 个人偏好（加入常用清单，影响右栏『更多 skill 抽屉』排序**）」——**这正是 D0-6 那三个键的出处**；§11 的统一资产元数据是 T002 契约的上游 |
| `docs/superpowers/specs/openhive-PRD.md` §F8 | 触发方式（右栏输入 / 点指令卡）、**AC-F8-01**（选中账户 → 点「关联分析」→ AI 填一句话并执行） |

③ **读 `docs/superpowers/specs/005-project-management/session.md`**（005 的交班）——006 是 005 的**直接下游**：
- **「交付物一览」+「已知缺口」两张表**：逐条问「**这条落不落到 006 头上**」。可预期的两笔：
  **① 深色下无 `--v2-background-bg-accent-soft`**（006 会再引三处选中态，见 D0-5 附）；
  **② 前端 fetch 无 `AbortController`**（006 的 skill 取数、命令面板模糊匹配同理）。
- **005 留下的可复用先例（别重复造）**：`docs/superpowers/specs/005-project-management/session.md` 开头
  「上游文件里的『要保留的定制』」一节（改上游文件的纪律）＋ `state.md` 的收尾补测记账法。
- **再读本 feature 自己的 `tasks.md` 文件头**（最容易漏的一处）：Prerequisites 写的是
  「F1 右栏骨架 + F4 权限已落地」——**但 D0-1 实测「右栏骨架」只有位置没有内容**、
  **D0-2 实测「F4 权限」对前端不可见**。⇒ **两条 Prerequisites 都要按 Step 0.5 的结论重新表述**，
  别把它们当成「已完成的前置」直接开工。

④ 取最小依赖且未完成的 task，用 Superpowers 的 `test-driven-development` skill（RED→GREEN→REFACTOR）。

⑤ 每个 task 跑完：更新 `tasks.md` 该 task 的 checkbox → 更新 `state.md` → commit → **STOP**，等我说「next」。

⑥ 全部 task 完成后 **STOP**，等审整个 feature。

⑦ **遇到「未定」的决策点先停下来问我**（见 Step 0.5 的 D0-1…D0-7 + 文末「未定项清单」），不要自行拍板。

---

## Step 3 · 任务标签执行规则

### [FE] —— 本 feature 的主战场（10 条：T001–T009、T013）

**🔑 落点实测（开工前先看这段，别照 plan 的目录图直接开写）**

| 要找的东西 | 真身 | 说明 |
|---|---|---|
| **右栏槽位** | `packages/app/src/workspace/three-pane.tsx:ThreePane`（`props.right`）| ⚠️ **从未被传过** ⇒ 右栏今天不渲染（D0-1a）；宽度常量 `RIGHT_PANE_DEFAULT = 360` 已写好 |
| **右栏接线点（唯一）** | `packages/app/src/workspace/workspace-entry.tsx:424` 的 `<ThreePane>` | 加一个 `right={…}` prop 即可，**无需改 `three-pane.tsx`** |
| 上游「右栏会话」 | `packages/app/src/pages/session/session-side-panel.tsx:SessionSidePanel` | ⚠️ **是 review diff + 文件树，不是消息流**（D0-1b）；使用点 `pages/session.tsx:2306/2328` |
| 会话**消息流** | `packages/app/src/pages/session/timeline/message-timeline.tsx` ＋ `pages/session.tsx:SessionPage` | 在**中栏** |
| 会话**管理**（六件事，散在五六个文件） | 新建 `pages/home/home-sessions-controller.tsx:180` / `components/prompt-input/submit.ts:404`；重命名 `components/titlebar-tab-strip.tsx:108`、`message-timeline.tsx:677`；删除 `message-timeline.tsx:817`；归档 `pages/session/session-archive.ts`；导出 `utils/session-export.ts` | 全在**上游**区域，无 openhive 定制标记 |
| **指令卡** | **零命中** | `grep -rn "instruction-card\|指令卡\|QuickAction" packages/app/src` ⇒ No files found。**从零建** |
| 最接近的地基 ①：`/` 弹层 | `packages/app/src/components/prompt-input/slash-popover.tsx`（`PromptPopover`）+ `context/command.tsx` | ⚠️ **长在中栏 composer 上**，不是右栏顶部；上游文件，**import 复用不改** |
| 最接近的地基 ②：命令面板 | 模型 `packages/app/src/components/command-palette.ts`（纯模型、无 UI）；壳 `components/dialog-command-palette-v2.tsx:DialogCommandPaletteV2` | ⚠️ 它编目的是**功能命令 + 文件 + 会话**，**不含 skill**；`matchesEntry` 是**子串**匹配不是真模糊（可用 `fuzzysort`，依赖已在） |
| 最接近的地基 ③：抽屉 | `packages/app/src/components/ui/drawer.tsx`（导出一整套 `Drawer*`，基于 `@corvu/drawer`，右侧 560px 滑入）| 唯一消费者是 `components/help-button.tsx`；头注释自认「可提升为 v2」。**最直接可复用/可照抄** |
| **skill 列表取数** | v1 `GET /skill`（`.../httpapi/handlers/instance.ts:84`）/ v2 `GET /api/skill`（`packages/server/src/handlers/skill.ts:7`）| ⚠️ **前端今天零消费**（只有 TUI 用，`packages/tui/src/context/data.tsx:543`）⇒ 取数入口基本等于从零接 |
| **skill 元数据** | `packages/schema/src/skill.ts:20`（v2）/ `packages/opencode/src/skill/index.ts:37`（v1）| 只有 `name` / `description`(v2 多 `slash`)。**没有分组/标签/能力清单**（D0-3）|
| **权限过滤** | `packages/core/src/access/session.ts:165:sessionRuleset` / `packages/opencode/src/server/openhive/access.ts:47:capabilityFor` | **零前端消费者**；执行层拦在 `session/prompt.ts:1457`（R1 门）与 `tool/skill.ts`（D0-2）|
| **人确认闸门** | `packages/opencode/src/permission/index.ts:ask`（:67）+ 前端 `pages/session/composer/session-permission-dock.tsx:SessionPermissionDock` | 按**规则集**触发，不是「高风险专用」；旁路 `context/permission-auto-respond.ts`（D0-4b）|
| 005 的「确认条」先例 | `packages/app/src/project/file-tree.tsx`（`data-slot="file-tree-delete-confirm"`）、`project-panel.tsx`（`project-archive-confirm`）、`dual-file-tree.tsx`（`restore-confirm`） | 三处同款「`data-slot` + `role="alert"` + 取消/确认」；005 的文件头明写「**面板本身就是浮层，再叠一层模态只会难收场**」——**新面板沿用此约定** |
| openhive 自有目录 | `packages/app/src/{rail,center,topbar,workspace,project,auth}`（**6 个，已含 005 的 `project`**）| plan 要的 `ai-session/` **不存在**（新增目录！三处清单一起加，见 D0-7）|
| token 第二层守卫 | `packages/app/src/workspace/design-token-refs.test.ts:45:自有目录` | 随 `test:unit` 跑，只证**名字存在**，不证渲染值 |
| 模块目录守卫 | `packages/app/src/openhive-module-dirs.test.ts:11:moduleDirs` | **新增目录前先读它**（它没有白名单，别凭文件名推断）|
| 别名 | `@` → `packages/app/src` | 006 用 `@/ai-session/…`；⚠️ `ai-session/command-palette.tsx` 与上游 `components/command-palette.ts` **同名不同目录**，import 时注意区分 |

**🔴 宪法 §八 红线（NON-NEGOTIABLE）**

- **SolidJS 换皮，MUST NOT 用 React 自研**；`front` 的 `RightAIChat` 只作**视觉参考、不搬代码**
  （Solid 组件无法嵌进 React 组件树，反之亦然——归档文档 §2 已裁定）。**006 的「参考」实际应落在
  `packages/session-ui` 的原生组件上**（见 D0-5c）。
- **视觉值一律走 token，禁硬编码**——`openhive/no-raw-color` 门（`bun run lint:openhive`）就是查这条。
  ⚠️ 门是 **warn 级 ⇒ 退出码恒为 0**，**放过是常态**（`script/oxlintrc.openhive.json` 注释自记
  「23 warnings / 0 errors ⇒ 退出码 0，门当前是『通过但带告警』」）⇒ **「门绿」不等于「没硬编码」**。
- **绝不动生成物**：`packages/ui/src/v2/styles/colors.css`（`script/tailwind.ts` 生成）、
  `packages/ui/src/theme/themes/oc-2.json`（生成器产出）。token 真相链是**三处**（见 D0-5 附）。
- **不启用暗色模式、仅中文、桌面宽屏**（宪法 §八）。
- **薄界面 + 厚 skill**：**界面 MUST NOT 内置分析逻辑**——卡片只声明「这是什么能力」，
  能力本身在 skill 里。006 的 UI 里**不该出现任何业务判断**。

**🟡 前端测试今天能测什么（实测手段表，别写出测不了的断言）**

| 手段 | 命令 / 落点 | 实测约束 |
|---|---|---|
| 纯逻辑单测 | `cd packages/app && bun run test:unit`（`.test.ts`，`--conditions=solid`，`--preload ./happydom.ts`）| **不收 `.test.tsx`**（脚本带 `--path-ignore-patterns="**/*.test.tsx"`）；`.tsx` 不加载 `solid-jsx.ts` |
| 组件渲染测试 | `cd packages/app && bun run test:components`（`.test.tsx`，`--conditions=browser` + `happydom.ts` + `solid-jsx.ts`）| happy-dom **无 CSS 引擎** ⇒ **量不出几何/颜色**，**只能钉 `className` 字符串与结构不变量** |
| 浏览器层单测 | `cd packages/app && bun run test:browser`（`./test-browser`）| 与组件测试分开的另一条 |
| E2E | `cd packages/app && bun run test:e2e`（playwright，`e2e/`）| 真浏览器；抽屉动画 / 拖拽 / 视觉只能在这一层验，但慢 |
| 视觉契约门 | 根目录 `bun run lint:openhive` | 只扫 6 个自有目录（见 D0-7：**新目录不在里面就漏扫**）|
| token 名字完整性 | 随 `test:unit` 自动跑（`design-token-refs.test.ts`）| 只证名字存在 |
| Storybook | `packages/storybook/main.ts:28` 通配收 `app/src/**/*.stories.tsx` | 005 用它做过 a11y 审计面；006 的面板/卡片**很适合补 stories** |
| 类型 | `cd packages/app && bun run typecheck`（`tsgo -b`）| |

**🔴 三条 happy-dom 铁律（005 用两轮审查换来的，直接抄）**

1. **`.toBeNull()` 的实得值必须是原语**——断言「某处没有元素」时断在**布尔**上
   （`const 无槽 = (h,s) => 槽(h,s) === null` 再 `expect(无槽(h,"x")).toBe(true)`）。
   把 Solid 渲染过的**节点**当实得值，**红了会把整轮 `bun test` 挂死**（004 实测：45s 未结束、被 timeout 杀掉）
   ——**不是红，是哑**（`LEARNINGS #005-01`）。
2. **视觉约定只能钉 `className` 字符串**（`expect(el.className).toContain(金)`），
   且**一个约定落在 N 处就写 N 条断言 + 一条对照**（「别的行 / 另一个 tab **不带**」）。
   只写正向那条时，把整个列表刷成浅金也算过（`LEARNINGS #005-07`）。
3. **组件测试的 `mount()` 要记账 + `afterEach` 先卸载再清 `document.body`**（**顺序要紧**）。
   005 的 T021 曾因旧实例还订阅着模块级接缝，把「偶尔翻车」拨成**稳定常红**，且症状看着像「产品串项目」
   （`LEARNINGS #005-03`）。判据：**「红在别人的数据上」先找订阅者，别去改被测组件。**

**🔴 本 feature 特有的测试难题：「机制通用」怎么测？**

FR-006 的判据是「**换模块，四层跟着换内容**」——这**不是** happy-dom 能自然量出来的东西。
做法建议（供参考）：把「模块 → 能力清单」做成**可注入的投影输入**，测试里**喂两份不同的清单**，
断言①第一份的卡片出现、②第二份的卡片出现、③**第一份的卡片在第二份下不出现**。
**判据是「调用点数 == 要改的数」**——即 `grep` 出框架里**所有**取「当前模块」的地方，
每个地方都要能跟着注入换（`LEARNINGS #004-01`：锚在「**做那件事的那一行**」，不是「已经守着的那一行」）。

### [INT] —— 4 条（T010–T012、T014）

**🔴 先读 D0-4**：T011（确定性走 MCP）与 T012（高风险强确认）的**出参今天都打不到**。
T010（AI 执行并展示过程）相对可行——它走的是既有会话执行链；但「展示过程」的载体
（中栏 `message-timeline` 那套 vs 右栏自建）**取决于 D0-1 的裁定**。

**其余 INT 红线**

- **不认角色表、不靠提示词**（宪法 §四）：前端「只显示有权的」是 UX，**不是安全**；鉴权必须落在执行层。
- **横切机制要在每条出口上重放一遍**（`LEARNINGS #005-11`）：006 的 skill 有**四条取数出口**
  （常用操作 / 上下文指令 / 抽屉 / 命令面板）。若 D0-2 选了「前端过滤」，**四条都要过滤**，
  且**每条写一条断言**——「框架是同一个，应该都过滤了吧」是推断不是事实。004 的头号翻车场景
  正是「4 个入口里 3 个有检查，第 4 个漏了」。
- **外呼超时**（`LEARNINGS #005-05` / `#005-06`）：给 skill 取数 / 命令面板加超时时，
  **先数这条路径有几个阶段**（请求 / 收头 / 读体 / 分页），别只罩 `send` 那一下。
- **交出去的依赖要落进对方的表**（`LEARNINGS #002-04`）：若 T011 依赖 007 的 MCP server、
  或收藏/最近使用依赖 009，**写进 007 / 009 的 `tasks.md`**。

### [BE] —— 0 条（但**「0」是标签表的结论，不是开工的结论**）

006 的 `tasks.md` 写「本 feature 纯前端 + AI 执行集成，无 `[BE]`」。**实测：三条 🔴 都可能要 BE 活**：

| 源头 | 可能的 BE 改动 |
|---|---|
| **D0-2**（capability 过滤无承载体） | 新增会话作用域、带过滤的 skill 投影端点 ⇒ `packages/opencode/src/server/openhive/` + 路由 |
| **D0-3**（skill 无元数据） | 扩 frontmatter ⇒ `packages/schema/src/skill.ts` + `packages/core/src/skill.ts` + `packages/opencode/src/skill/index.ts` |
| **D0-4b**（高风险无后端闸门） | 业务动作层的 `permission.ask`，或在工具层加强制 ask 规则 ⇒ `packages/opencode/src/permission/` 附近 |

⇒ **开工前先把这三条的裁定拿到手**，再决定「有没有 BE 活、在哪几个 package 里」。
**不要**因为标签表写着 0 就跳过 Step 0.5。

---

## Step 4 · 质量门禁（宪法第五章，审查前先过）

- **在受影响 package 内跑 `bun test`**（**禁止根目录 `bun test`**，根脚本强制 `exit 1`）。
  006 至少影响 **`packages/app`**；**按 D0-2/D0-3/D0-4 的裁定**，可能还影响
  **`packages/core`**（skill schema）与 **`packages/opencode`**（投影端点 / 权限规则）——**按实际改动逐个跑**。
- **🔴 `cd packages/app && bun run test:components`（10 条 `[FE]` 的测试都落在这里）**。
  `.test.tsx` **进不了** `test:unit`（脚本带 `--path-ignore-patterns="**/*.test.tsx"`），
  **漏跑 = 白写**。
  ⚠️ 若新增的 `.test.tsx` **不在** `packages/app/src/` 下（例如落进 `test-browser/`），
  **停下来告诉我**——那属于另一条脚本。
  ⚠️ 005 记过 `test:components` 在**默认运行时转译缓存**开启时会出问题 ⇒ 一律加前缀
  **`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`**。
- **`bun run lint:openhive` 退出码 0**。⚠️ 门是 **warn 级 ⇒ 退出码恒为 0**；
  **存量 warning 是基线，不是本次命中**。**基线先测再写**（`LEARNINGS #001-02` / `#003-04`）：
  **开工时自己跑一次、把当时的真实数字落进 `006/state.md` 再引用**——**不要抄 005 的数**。
  🔴 **本 feature 的专属动作**（D0-7）：**先把 `ai-session` 加进那三处清单**，
  否则**这道门扫不到你的新文件**——那**不叫「过了」**。
  **改法先报告、别自己拍。**
  ⚠️ 单文件 lint 一律**在仓库根**取数（`bunx oxlint packages/app/src/ai-session/…`），
  在包目录里跑会**配置解析失败**（`LEARNINGS #004-10`）。
- **`bun run lint` 只判「本次新增/改动文件 0 命中」**：全局有 **1 个已登记的「上游」error**
  （`packages/session-ui` 的 prompt-input 组件，裁定为不私改、登记待上报）⇒ 全局退出码**恒为 1**。
  **不要为它改上游代码，也不要拿它当阻断。**
- **`bun run typecheck`（turbo）退出码 0**；前端另有 `cd packages/app && bun run typecheck`（`tsgo -b`）。
- ⚠️ **门禁串行跑，别并行**：同机并行跑多道门禁会**造假红**——003 实测（core 报 18 fail / 6 errors、
  auth 报 11 fail），**各自串行复跑全部回到基线**。看到红先串行复跑一次再当结论（`LEARNINGS #003-01`）。
- ⚠️ **不得用「替身 / mock」把被测对象换掉**——那等于没测（`LEARNINGS #002-02`）。
  AI 那一侧尤其要小心：**假模型要回真 SSE**（照 004 / 005 的 harness），
  **别把「AI 执行」整段 mock 掉**——那样 T010 的「展示过程」就没有被测对象了。
- ⚠️ **`bun install` 之后必查 `git diff --stat bun.lock`**（本机 `~/.npmrc` 指向镜像源，
  跑一次会污染 3000+ 行）⇒ 应当为空或只剩有意新增的依赖（`CLAUDE.md` 的「锁文件污染」一节）。

---

## Step 5 · 代码审查（用 Superpowers 的 `requesting-code-review` skill）

质量门禁过 + 全部 task 绿后触发审查，至少覆盖以下 6 类：

① **韧性缺陷**：缺重试 / 缺超时 / 缺熔断（skill 取数、AI 外呼、抽屉/命令面板的列表加载）。
　　**先数这条路径有几个阶段再配超时**（`LEARNINGS #005-05`）；**流式响应体 `abortSignal` 管不着**
　　（`#005-06`：`send` resolve ≠ 读完，要 `body.destroy(new Error(...))`）。
② **横切一致性缺陷（本 feature 的头号风险）**：skill 有**四条取数出口**
　　（常用操作 / 上下文指令 / 抽屉 / 命令面板）。**逐个问「这里有没有过权限那道关」**——
　　**锚在「做那件事的那一行」（`getSkill` / `list`），不是「已经守着的那一行」**（`LEARNINGS #004-01`）。
　　判据：**调用点数 == 带守卫的数**。
③ **防御性编码缺陷**：未处理的 `null`（skill 清单为空 / 某模块无 skill / 无上下文）、
　　缺输入校验、缺幂等；**prompt injection**（R4）——注入路径上有没有「人确认 + 执行层」两层兜底。
④ **「机制通用」是不是真的通用（本 feature 特有）**：
> - 四层卡片里有没有**硬编码某个模块**的名称 / id / 内容？
> - `grep` 出框架里**所有**取「当前模块」/「当前上下文」的地方，逐个问「换了还成立吗」
> - 有没有把 F6/F7 的卡片内容**提前写进框架**（plan 说那是 F6/F7 的事）
⑤ **🔴 前端换皮一致性（本 feature 特有，且是第一等公民）**：
> 逐项核对 §八 与 `openhive-DESIGN.md`——**注意 D0-5：DESIGN.md 那几节是本次新补的**，
> 所以要核对的是「**代码里的值与新补的那节是否逐条对得上**」：
> - 是否**硬编码了本应走 token 的视觉值**（**读**，不能只信 `lint:openhive`——warn 级门会放过）
> - 是否**手改了生成物**（`colors.css` / `oc-2.json`）
> - 若动了 token：**三处真相链是否同步 + 是否跑了生成器**（漏一处**全绿**）
> - 是否引入了**项目禁止的依赖**（React / 第二个 UI 库 / 新搜索库——`fuzzysort` 已有）
> - 是否**仅中文、无暗色模式**、桌面宽屏
> - **薄界面 + 厚 skill**：UI 里有没有混进**业务判断**（宪法 §八 明令 MUST NOT）
> - **四条出口的视觉约定**（选中态 / 悬停态）是否**每处都钉了断言 + 有对照**（`LEARNINGS #005-07`）
⑥ **🔴 上游侵入面（本 feature 特有）**：

> 005 的侵入面是「上游的表结构 + 上游的前端组件」；**006 的侵入面是「上游的 skill schema +
> 上游的前端组件库」**。审查必须确认：
> - **可能的被改上游文件**（逐个问「真的必须改吗」）：
>   `packages/schema/src/skill.ts`、`packages/core/src/skill.ts`、`packages/opencode/src/skill/index.ts`
>   （若走 D0-3 的扩 frontmatter）；`packages/app/src/components/ui/drawer.tsx`、
>   `components/command-palette.ts`、`components/prompt-input/slash-popover.tsx`、
>   `pages/session/**`（若走 D0-1 的复用）
> - 每处上游改动是否**单独提交**、message 是否标注「**这是要保留的定制 · 同步上游时不要丢**」
> - 新增目录 `packages/app/src/ai-session/` 是否**同时**更新了**三处**「自有目录」清单（D0-7）
> - 是否碰到了 `sql.ts` / `colors.css` / `oc-2.json` 或其他上游高频文件（宪法 §一 明令）

审查报告用 `receiving-code-review` skill 消化，格式：
`| 编号 | 类别 | 文件:行 | 描述 | 修复优先级 |`

**0 个缺陷** → 进 Step 6；**有缺陷** → 回到对应 task 走 TDD 修复，重新审查，直到 0 缺陷。

> 📌 **`LEARNINGS #003-02` / `#005-04`：第一轮修完之后，把「修复本身」再当靶子打一轮。**
> 003 第一轮审出 35 条、全修完之后，第二轮（**5 片并行 + 对抗证伪**）抓到的 **R2-01…R2-05
> 全部长在刚修出来的代码里**，其中两条是 P0/P1。005 的第二轮（3 席 × 9 条）抓到的**两条 Important
> 也都在刚落的修复里**，形状是同一个：**「同一个修法要打几个勾」被数错了**。
> **「修完」不等于「审完」**——这一轮别用同一套视角，否则只会得到第一轮的结论复述。
> 判据：说「已修 / 已统一」**之前**先 `grep` 出**全部同类落点**、逐个打勾
> （落点的来源必须是**被改的那一侧**，不是「我记得改了几处」）。

---

## Step 6 · 收尾

1. 最终 commit，message 含 `Closes 006-ai-session`。
2. **merge 回开发主线**：⚠️ **这一步做不了，交给我**——`multi-tenant` 已在主检出被 checkout
   （一个分支不能 checkout 两次），且隔离会话对共享检出的 git 操作会被拦。
   你只做 final commit，然后把 `git merge --ff-only worktree-feat-006-ai-session` 给我，
   **我在主检出执行**。
3. `git tag v0.1.0-006-ai-session`（沿用 002/003/004/005 带编号的形式）。
   ⚠️ **tag 不由你打**——它与 merge 配套，**由我在主线合入之后执行**（SOP Phase 6；
   001 的教训是 tag 打在收尾提交上、漏掉了后来的补测提交 ⇒ **tag 必须指向最终状态**）。
   你只交 merge 命令（上一条）。
4. 更新 `docs/superpowers/specs/006-ai-session/session.md` 标记完成
   （它今天是「尚未开始」的空壳）。
5. `specs/006-ai-session/` **永不删除**（下一个 feature 的上下文）。
6. **更新 `006/state.md` 的缺口表**——本 feature 预期的挂账至少有三笔：
   **收藏/最近使用的存储（→ 009）**、**`判定涉案` 类业务动作（→ F6/F7）**、
   **US5 被迫改写时剩下的那一半**。**逐笔写清「谁接、接在哪张表」**（`LEARNINGS #002-04`）。
7. 报告：**共 14 个 task（10 FE / 4 INT / 0 BE，实际 BE 面按 D0-2/D0-3/D0-4 的裁定计）** /
   审查发现 X 个缺陷已全部修复 / 门禁基线数字（含失败数）。
8. **把 `LEARNINGS.md` 补上**（1–5 条，加在最顶部，不值得记的宁可不写）。
   **可预期的素材**：「右栏骨架」存在但从未接线（001 就记过的待决项，一路留到 006）；
   `SessionSidePanel` 名不副实；「capability 过滤已由 F4 落地」这句话在四份 plan 里被互相抄；
   skill 无元数据导致「机制通用」的契约要凭空造；happy-dom 下「机制通用」怎么测。

---

## 节奏铁律

- **逐 task 停**：每个 task commit 后 STOP 等「next」确认（服从宪法第九章）。
- **一个 feature 跑完停下来等审**，再下一个。
- **严禁多 agent 并发跑多个 feature。**
- **本 feature 额外两条**：
  1. 006 与 004 / 005 一样**没有**预置的 D1–Dn 清单，所以「到点必须停下来问」**没有人工提醒机制**。
     按既有做法：**每个 task 开工前回头核一遍 Step 0.5 七条还有没有活的**，
     并固定那个习惯——**动第一行代码之前，先问「这条 task 的出参，今天在仓库里打得到吗？」**
  2. **这是本仓第一个「纯 UI 机制」feature，「做得对不对」最容易靠肉眼判断** ⇒
     每张卡片 / 每个面板的视觉约定，**先写成会红的断言再实现**；
     **happy-dom 量不出颜色**，所以约定必须落成 `className` 串断言 + 一条对照
     （`LEARNINGS #005-07`）。**别用「我看了觉得对」当判据。**

---

## 未定项清单（**开工前先裁定**）

| # | 事项 | 今天的事实（已实测） | 需要你定什么 |
|---|---|---|---|
| **U1** | **右栏会话的形态**（D0-1） | `ThreePane` 的 `right` 槽**从未被传过**（右栏不渲染）；`SessionSidePanel` 是 **review + 文件树**，不是消息流；消息流在中栏 `message-timeline`，会话管理散在五六个上游文件 | (a) 把上游消息流体系搬进右栏 / (b) 只换皮 `SessionSidePanel` 挂上去 / (c) 另定「右栏会话的最小形态」。**T001/T008 的出参全押在这条上** |
| **U2** | **「有权 skill」怎么落**（D0-2） | 两个列表端点都无权限过滤；`sessionRuleset`/`capabilityFor` **零前端消费者**；权限只在执行层拦 | 新增会话作用域的过滤端点（BE 活）／前端不过滤只靠执行层拦（**并同步改掉 plan 那句 ✅ 的理由**）。**两条都合法，但不能都不说** |
| **U3** | **`X-User-ID` 链路**（D0-2 附） | 003 `tasks.md:747,750,906,907`：**F7/F8 的 MCP → 业务 PG RLS 链路上仍在传身份**，须照 003 T014 裁定 | 006 是不是那个裁定时刻？若 U2 选了新端点，这条**会立刻撞上** |
| **U4** | **skill 能力清单契约的形态**（D0-3） | 两套 `Info` 都只有 name/description(+slash)；扩 frontmatter 要动**上游三处**（schema + 两个 loader）| 扩 `SKILL.md` frontmatter（动上游）／旁路一份 openhive 清单（零侵入但要防漂）。**它还是 006 → 009 的契约**（009 的 `tasks.md:5` 把 006 列为前置）|
| **U5** | **US5 两条出参**（D0-4） | T011 的 MCP server **不在本仓**（只有客户端；T010/T011 已移交 007）；T012 的「高风险」在**业务动作层无闸门**（`permission.ask` 只在工具/会话路径）；「判定涉案」**全仓零命中** | T011 改写（不写 MCP / 依赖 007）＋ T012 复用**工具层** `permission.ask` ＋「判定涉案」挂 F6/F7 —— 还是整条 US5 挂 `deploy-todo.md`？**依赖要落进 007/009 的表** |
| **U6** | **视觉规格先补 DESIGN.md 哪几条**（D0-5） | DESIGN.md 只有**通用卡片级**规格（L19 气质 / L80 标题字号 / L93 圆角 / L126 卡片本体），**没有这四个组件（指令卡行 / 抽屉 / 命令面板）的规格**；`figma-export/` 只有 4 个 logo + `tokens.css`，**无页面子目录**；`front/RightAIChat` **不在本仓库** | 补哪一节、补到什么颗粒度；「参考样本」改用 `packages/session-ui` 原生组件对齐是否认可（归档文档 §3.2 的先例） |
| **U7** | **005 那枚深色选中态 token**（D0-5 附） | `005/session.md:147`（R2-09）：dark 块无 `--v2-background-bg-accent-soft`；005 **已判非阻断**（§6.2 不启用暗色）。006 会**再引三处选中态**、大概率复用同一 token | 沿用 005 的裁定（继续挂账）／顺手在 dark 块定掉（动 token 真相链三处 + 跑生成器）。**两条都要说出口** |
| **U8** | **抽屉三个排序键**（D0-6） | 分组无元数据、收藏**零命中**（auth 库**无 preference 表**）、最近使用无 skill 维度；006 的 spec 已把收藏推给 F9 | 三键里今天做哪个、降级到什么、另外几个**落进 009 的 tasks.md** |
| **U9** | **新增目录三处清单的改法**（D0-7） | `openhive-module-dirs.test.ts:11` / `design-token-refs.test.ts:45` / `package.json:16`；**漏加不报错，只静默漏扫** | 确认「三处一起加 `ai-session`」这个改法（**改法先报告**） |
| **U10** | **006 是 009 的前置**（跨 feature） | `009-ai-assets/tasks.md:5`：「F4 RBAC + **F8 指令卡已落地**」 | U4 的契约产物怎么交给 009 —— 写进 009 的表，还是先在 006 的 `state.md` 记一笔待传（`LEARNINGS #002-04`）|
