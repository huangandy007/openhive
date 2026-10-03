现在开始实现 specs/004-access-control/（内层仓库 openhive 内的 `docs/superpowers/specs/004-access-control/`）。

> 以下路径均相对于**当前会话的工作目录**（= worktree 根 `openhive\.claude\worktrees\feat-004-access-control\`）。
> 绝对路径锚点：仓库根 `D:\project\study\openhive\openhive\`；外层工作区 `D:\project\study\openhive\`。

**本 feature 一句话**：落地「授权下沉执行层」的 capability 模型与三层拦截——**工具清单过滤 → 工具执行鉴权 → MCP 账号兜底（含 PG 行级 RLS）**，外加统一 RBAC 与数据轴/工作空间轴解耦。

**任务总量 14 条**（T001–T014，比 003 的 24 条少）：

| 组 | 编号 | 内容 |
|---|---|---|
| Phase 1 | T001–T002 | 定位工具执行器入口 / 定 capability 结构 |
| Phase 2 | T003–T004 | capability 签发 / RBAC 表 + 判定 |
| Phase 3 | T005–T006 | **工具清单过滤 + 执行守卫**（本 feature 的核心） |
| Phase 4 | T007–T009 | MCP 账号兜底 / PG 行级 RLS / 结果量级 |
| Phase 5 | T010–T011 | 数据范围（数据轴）——⚠️ 见 Step 0.5 的 D0-4 |
| Phase 6 | T012–T014 | **安全测试（本 feature 的验收门）** |

⚠️ **与 003 的关键差别，先记住这句**：003 的红线是「`packages/core/src/database/database.ts` 是纯上游区」；
**004 的红线换成了 `packages/core/src/tool/`**——**工具执行器在 core，不在 opencode**（已实测，见 Step 3）。
两处同型：**plan.md 写的是 opencode 侧，真身在 core**。

---

## Step 0 · 开 worktree 之前 / 刚开后（**逐项验证，不要"顺手修"**）

以下四项**都已经配好了**——本步是**体检**，不是修复。跑出不符就停下告诉我。

**0.1 基点设置（易误判，先看这条）**

`worktree.baseRef` **已配置为 `head`**。

⚠️ 它是 **Claude Code 的设置项**（`C:\Users\Administrator\.claude\settings.json`），**不是 git config**——
用 `git config worktree.baseRef` 查会**显示为空**，别据此判断「没配置」而去做多余操作。

**0.2 验证基点正确**

```bash
git merge-base --is-ancestor multi-tenant HEAD    # 退出码 0 = 基点正确
```

不通过就**停下来告诉我**，不要自行 reset（001 曾被迫 `git reset --hard`）。

**0.3 验证 003 已合入（004 的地基）**

004 的 `tasks.md` 的 Prerequisites 写的是「**F2 身份注入 + F3 db 路由已落地**」。**F3 = 003。**

```bash
# 在主检出执行（不是本 worktree）：
git merge-base --is-ancestor worktree-feat-003-multi-tenant-isolation multi-tenant \
  && echo "✅ 003 已合入" || echo "❌ 003 未合入，停"
```

⚠️ **不要写死 SHA**（`LEARNINGS #002-06`：会随提交而变的值写取数命令，别写死）。
003 的分支名与 tag 名都是**可变的引用**，上面的判据用分支名即可。

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

---

## Step 0.5 · 开工前必须先实测的四件事（**"命中就停下来问"**）

⚠️ **004 目前没有任何预置决策点清单**——`plan.md` / `tasks.md` 里没有 003 那种 D1–D6。
下面四条不是从它自己的文档里抄的，是**从 003 的血泪里推出来的「生死前提」**。
**这四条必须在 T001 之前实测**，且**每条都可能是「停下来问」的触发点**。

> 📌 **可复用的做法**（003 的正例，T016 与 T005 各验证过一次）：
> **开工必读之后、动第一行代码之前，先问「这条 task 的出参，今天在仓库里打得到吗？」**
> 打不到就别做——**先裁定归属**。003 靠这一问省掉了一整条假测试（T016）与一次返工（T005 落点）。

### 🔴 D0-1（头号风险）：**工具执行到底有几条链？**

`plan.md` 的 R1 写「守卫挂在**执行器统一入口**」——**但那个「统一入口」是不是真的唯一，今天没人实测过。**

003 实测发现 prompt **有两条链**、挂在**同一棵路由树**上（`server.ts` 的 `createRoutes` 同时挂
`instanceRoutes` 与 `serverRoutes`）：

| 链 | 端点 | 落点 |
|---|---|---|
| A · web UI 走的 | `POST /session/{id}/prompt_async` | `SessionPrompt.prompt` → `SessionRunState.ensureRunning` |
| B · CLI / sdk-next 走的 | `POST /api/session/{id}/prompt` | core `SessionV2.prompt` → `execution.wake` |

**同一个坑今天在 003 里还开着一条**（`003/state.md` 的「阻塞项」第 5 条，审查 **R-17**）：
`packages/server/src/routes.ts` 用 `HttpApiBuilder.layer(Api, …)` 挂出**同一个 `/api`**，
而 003 的三条链（验签身份门 / 目录锚定 / 并发配额）**一条都没接过去**。

⇒ **T001 不是「定位文件」，是「穷举有几条链」**：
- 产出必须是**挂载点清单**，判据是 **`grep` 出全部挂载点后差集为空**——
  **不是「我数够 N 个了没有」**。003 就在这里翻过车：把「扫完了没有」偷换成「数够 5 处没有」，
  范围划小了等于没扫（`LEARNINGS #002-06`）。
- ⚠️ **守卫漏一条链 = 整套越权拦截在另一个端点上完全不存在**，且**不报错、不变红**
  （003 的配额就是这么漏的：照字面落 = web UI 主路径零配额）。
- **如果 T001 探出不止一条链** → 这就是一个**停下来问**的点：是两条都挂（多一个调用点、
  上游改任一条都要跟），还是先接一条。003 的裁定是**两条都拦**，且
  **判定 + 阈值 + 计数逻辑只写一份、只有「集合从哪取」按链注入**——
  **形状可以直接抄**：`packages/core/src/quota/session-quota.ts`。

### 🔴 D0-2：**守卫的落点**——执行器在 core，而 plan.md 写的是 opencode

**已实测**（这份物料里唯一一处我替你跑了的事实，其余仍要你自己穷举）：

```
packages/core/src/tool/          ← 工具执行器真身在这里（19 个文件）
├── tool.ts                      ← 挂守卫的候选：withPermission / permission / settle
├── registry.ts                  ← toolsNode / node
├── tools.ts / builtins.ts       ← 组装处候选
└── bash.ts / edit.ts / write.ts / read.ts / glob.ts / grep.ts / …（各工具）
```

- **它是纯上游区**：`git log -1 -- packages/core/src/tool/tool.ts` = 上游提交
  （`feat(core): port v2 runtime fixes onto dev`），**003 一行没碰**
  （`git diff --stat multi-tenant...HEAD -- packages/core/src/tool/` **无输出**）。
- ⚠️ **`packages/core` 不能 import `@opencode-ai/opencode`**（`packages/core/package.json` 无该依赖）。
  003 的落点**正因为这条被实测推翻过一次**：`plan.md` 当时写 `packages/opencode/src/{user,database,quota}/`，
  实际**三个半落 core**。004 的 `plan.md` 写的是 `packages/opencode/src/{authz,rbac}/`——
  **同一个形状的坑，别踩第二次**。
- ⇒ **T001 之后、T003 之前，先把落点问清楚**：执行器在 core ⇒ 守卫必须在 core ⇒
  `authz/` 大概率也得落 core。
- ⚠️ 另有命名干扰：`packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts`
  **是既有文件、不是 003 的产物**（003 在该目录只动了 4 个文件：
  新增 `anchor-workspace.ts` / `matched-route.ts` / `session-quota.ts`，改 `user-identity.ts`）。
  **别把 `authorization.ts` 当成「已经有人做过授权了」**。

### 🔴 D0-3：**RBAC 表建在哪个库？迁移由谁跑？**

004 **必须建表**（`role` / `user_role` / `role_resource`）——这是与 003 的第二个关键差别：
**003 的红线是「零表结构改动」，004 没有这条豁免**。

`plan.md` 的 Storage 行只写「RBAC 表（`role` / `user_role` / `role_resource`）；业务数据 PG 行级 RLS」，
**没说建在哪个库**。今天仓库里有**两套存储**：

| 存储 | 落点 | 谁在用 |
|---|---|---|
| 每用户 SQLite | `packages/core/src/database/router.ts` | 会话 / 消息 / 项目（003 做的按用户路由） |
| 业务 PG | `packages/auth` 的迁移机制 | 账号 / 会话凭证（002、003） |

- **往哪边建，影响整条链**：建在 auth 的 PG ⇒ 复用 `packages/auth/src/migrations/`；
  建在每用户 SQLite ⇒ RBAC 表**会随用户库分裂**，而 RBAC 是**跨用户**的授权底座（角色授资源，
  资源是全体的）——**大概率不该进每用户库**。这是要你拍板的。
- ⚠️ **迁移机制自带一个已知欠账，004 会立刻撞上**：`003/state.md` 的 **D-05**
  （`packages/auth` 的 `migrate()` 在生产里**唯一的调用点是引导，而引导是一次性的**）
  ⇒ **撤掉引导变量后，新迁移没有任何东西会去应用**。
  **004 建的 RBAC 表正是「新迁移」** ⇒ 004 上线时**表建不出来**。
  **这条要在 T004 之前裁掉**，或至少明确「部署时手动跑」并写进 `docs/workspace/deploy-todo.md`。
- 📖 动手前读 `packages/auth/src/migrations/README.md`（003 新建）：整轮迁移在**一个事务**里、
  **不能写 `CREATE INDEX CONCURRENTLY`**（报 25001）、语句分隔符、隔离级别依赖（D-12）、
  别改 `MIGRATION_LOCK_KEY`。**建 RBAC 表 + 索引时会直接用到。**

### 🟡 D0-4：**T010 / T011（数据范围）的出参，今天在仓库里打得到吗？**

`spec.md` 的 Assumptions 自己写着：「业务数据的 RLS 落地**依赖 F6/F7 的数据项目成员表**
（如 `fund_project_member`），本 feature 定义权限机制，具体表结构在 F6/F7 展开。」
而 `SOP §2` 的依赖链是 **F7 ← F1, F3, F4** ⇒ **F6/F7 都还没开工，F7 还依赖 004 自己。**

⇒ **T010「数据范围运行时 join 实时算出」很可能今天没有对象可 join。**
按 003 的做法：**先探，打不到就停下来问**——是「定义机制 + 桩表」还是「整条移交 F7」，
**由你裁定，不要自行造一张假表把测试写绿**。
（003 的 T016 就是没这么干的代价示范：差点写出一条「404 == 越权被拒」的假测试。）

---

## Step 1 · Worktree 隔离

```bash
claude --worktree feat-004-access-control    # 基准 = 当前开发主线 multi-tenant
```

（自动按 `.worktreeinclude` 复制 `.env` / `.env.local` / `.env.development` / `.credentials.yaml`）

---

## Step 2 · 启动必读（每个 task 开始前）

① 先读 `D:\project\study\openhive\.specify\memory\constitution.md`，遵守其全部原则——**冲突以宪法为准**。

> ⚠️ 必须用**绝对路径**：宪法在外层工作区、不在本仓库。worktree 里写 `../.specify/memory/constitution.md`
> 会解析到 `.claude/worktrees/.specify/…`，**读不到**。

② 读 `docs/superpowers/specs/openhive-DESIGN.md`（视觉真理源，本 feature 用到的地方不多）+ 本 feature 的
`plan.md` + `tasks.md`。

③ **读 `docs/superpowers/specs/003-multi-tenant-isolation/state.md` 的「阻塞项」与「未覆盖」两张表**——
**004 是 003 的下游**，那里面有几条的接收方可能正是本 feature（尤其 R-17 与 D-05，见 Step 0.5）。

④ 取最小依赖且未完成的 task，用 Superpowers 的 `test-driven-development` skill（RED→GREEN→REFACTOR）。

⑤ 每个 task 跑完：更新 `tasks.md` 该 task 的 checkbox → 更新 `state.md` → commit → **STOP**，等我说「next」。

⑥ 全部 task 完成后 **STOP**，等审整个 feature。

⑦ **遇到「未定」的决策点先停下来问我**（见 Step 0.5 的 D0-1…D0-4），不要自行拍板。

---

## Step 3 · 任务标签执行规则

### [BE] —— 本 feature 的主战场（14 条全部是 BE）

**🔑 落点实测（开工前先看这段）**

| 要找的东西 | 真身 | 说明 |
|---|---|---|
| **工具执行器** | `packages/core/src/tool/` | ⚠️ **在 core，不在 `packages/opencode`**。`tool.ts` 的 `withPermission` / `settle` 是守卫候选 |
| 工具组装 | `packages/core/src/tool/tools.ts` / `builtins.ts` / `registry.ts` | T005 的过滤点候选（**T001 去穷举，别只信这三个**） |
| 用户身份 | `packages/core/src/user.ts` | 003 交的。capability 签发以它为身份来源 |
| 按用户路由 | `packages/core/src/database/router.ts` + `connection-routing.ts` | 003 交的 |
| 身份门 | `.../httpapi/middleware/user-identity.ts` | 002 建、003 改（验签 + 路由提示） |
| 目录锚定 / 配额 / 路由匹配 | 同目录 `anchor-workspace.ts` / `session-quota.ts` / `matched-route.ts` | 003 新增，**形状可抄** |
| 第二支服务器入口 | `packages/server/src/routes.ts` | ⚠️ 上游文件；R-17 说它挂的是**同一个 `/api`**（见 D0-1） |
| 迁移机制 | `packages/auth/src/migrations/` + `README.md` | 003 交的约束，**建 RBAC 表前必读** |

**🔴 宪法 §I 红线（本 feature 的最高风险）**

`packages/core/src/tool/` 是**纯上游区**，003 一行没碰。动它 = 动上游高频文件
（每个工具都长在这套 registry 上）= 每次同步官方都可能冲突。

**应对**：
- 用「**加**」的方式——新增守卫模块并**挂**上去，**不重写** `tool.ts` / `registry.ts`。
- 改上游文件的那几行**单独提交**，message 里标注「**这是要保留的定制**」（宪法 §二 / §五）。
- **先核对上游是不是已经有现成的授权钩子**：`tool.ts` 里已经有 `withPermission` / `permission`
  这套上游自带的机制——**能用「加一个判断」接上去，就别另起一套并行的**
  （否则就是 `LEARNINGS #002-06` 说的「同一个判断在两处各写一份」）。

**其余 BE 红线**：

- **物理隔离优先，不靠应用层 `if` 过滤**（宪法 §三）：RLS 是数据库原生强制，前两层是应用层兜底。
- **权限下沉执行层**（宪法 §IV）：**不认角色表、不靠提示词**——执行器只认 capability。
  前端「只展示有权用的」只是 UX，**不是安全**。
- **两轴解耦**（FR-009）：数据轴（数据项目成员）与工作空间轴（`project_member`）**两套独立**。

**003 留下的可复用资产（别重复造）**

| 资产 | 位置 | 用法 |
|---|---|---|
| **「一份判定、两条链注入」的现成形状** | `packages/core/src/quota/session-quota.ts` | D0-1 若探出多条链，**照抄这个形状**：判定 / 阈值 / 计数写一份，只有「集合从哪取」按链注入 |
| 路由匹配结果 | `.../middleware/matched-route.ts` | 要按「命中了哪个路由」做判断时用（**别比对请求原文的 pathname**——003 在这里踩过：忽略尾斜杠 / 重复斜杠 / 大小写的等价写法会绕过） |
| env 常量先例 | `packages/auth/src/policy.ts`（`JWT_SECRET_ENV`） | 照它加新常量；**读 env 记录，不直接读 `process.env`** |
| 领域错误脱敏 | `packages/auth/src/pg-errors.ts` | **别绕过它**——原样重抛 / 序列化 / 写日志都会让保护作废 |
| 真库测试手法 | `packages/auth/src/production-driver.test.ts`（`withProductionDb`） | ⚠️ **RLS（T008 / T013）必用**：本机无 Docker / 无 PG 二进制，用 `@electric-sql/pglite-socket` 把 PGlite 经 TCP 暴露，让**生产那一支 `connect()`** 连上去真跑（`LEARNINGS #002-05`）。端口传 `0`；**残差要写明**（WASM 构建的 PG ≠ 生产 PG） |

---

## Step 4 · 质量门禁（宪法第五章，审查前先过）

- **🔴 安全测试（本 feature 特设，失败即阻断）**——对应 003 的「隔离测试」那一格。
  宪法 §五明写「失败即阻断合并」。覆盖：
  ① 越权工具调用被拒 + 审计留痕（T012）；② 越权 SQL 被 RLS 拦截、拿不到无权数据行（T013）；
  ③ 路径穿越 / SQL 注入 / 未授权直连 / 越权读他人数据（T014）。
  **双向都要验**：**A 读不到 B，A 也能读自己**（过紧也是缺陷，见 `plan.md` R3）。
  ⚠️ **不得用「替身 / mock」把被测对象换掉**——那等于没测（`LEARNINGS #002-02`：
  没有真正执行被测路径的测试不是测试，是缺口）。
- 在受影响 package 内跑 `bun test`（**禁止根目录 `bun test`**，根脚本强制 `exit 1`）。
  ⚠️ **004 无 `[FE]` 任务** ⇒ 不涉及 `test:components`。**若实现中长出任何 `.test.tsx`，
  停下来告诉我**——`.test.tsx` 进不了 `test:unit`（`packages/app` 的 `test:unit` 带
  `--path-ignore-patterns="**/*.test.tsx"`），漏跑 = 白写。
- `bun run lint:openhive` 退出码 **0**（001 的视觉契约门，扫
  `packages/app/src/{rail,center,topbar,workspace,auth}`）。本 feature 若不碰前端，这条**应当天然过**；
  若**新增了目录**，扫不到 ⇒ **告诉我，我扩范围**（别当成「过了」）。
- `bun run lint` **只判「本次新增/改动文件 0 命中」**：全局有 **1 个已登记的「上游」error**
  （`packages/session-ui` 的 prompt-input 组件，裁定为不私改、登记待上报）→ 全局退出码**恒为 1**。
  **不要为它改上游代码，也不要拿它当阻断**。
- `bun run typecheck`（turbo typecheck）退出码 **0**。
- ⚠️ **门禁串行跑，别并行**：同一台机器上并行跑多道门禁会**造假红**——
  003 实测（core 报 18 fail / 6 errors、auth 报 11 fail），**各自串行复跑全部回到基线**。
  看到红先串行复跑一次再当结论（`LEARNINGS #003-01`）。
- ⚠️ **基线先测再写**：把本 feature 开工时的真实门禁数字（含失败数）落进
  `004/state.md` 再引用，别从 003 的文档里抄（`LEARNINGS #001-02`：别把不可达/未测的当已达成）。

---

## Step 5 · 代码审查（用 Superpowers 的 `requesting-code-review` skill）

质量门禁过 + 全部 task 绿后触发审查，至少覆盖以下 6 类：

① **韧性缺陷**：缺重试 / 缺超时 / 缺熔断器
② **横切一致性缺陷**：鉴权是否覆盖**所有**工具入口与**所有**路由链
　（**本 feature 的头号翻车场景**，见 D0-1；"4 个入口里 3 个有检查，第 4 个漏了"）
③ **防御性编码缺陷**：未处理的 null / 缺输入校验 / 缺幂等键
④ **数据库迁移缺陷**：RBAC 表的迁移可回滚 + 别写 `CONCURRENTLY`（见 `migrations/README.md`）
⑤ **安全缺陷**：capability 能否被伪造 / 越权路径是否真的被拒 / 审计是否真的落盘
⑥ **🔴 上游侵入面（本 feature 特有）**：

> 003 的侵入面是改造 `Database` 单例；**004 是往上游的工具执行链上挂守卫**。审查必须确认：
> - 是否**真的**用「加」而不是「改」——`packages/core/src/tool/tool.ts` / `registry.ts` 应**零改动**或最小改动
> - 是否**复用了上游已有的 `withPermission` / `permission` 机制**，而不是另起一套并行的
> - 改造是否**单独提交**、message 是否标注「这是要保留的定制」
> - 是否碰到了 `sql.ts` 或其他上游高频文件（宪法 §一 明令）

审查报告用 `receiving-code-review` skill 消化，格式：
`| 编号 | 类别 | 文件:行 | 描述 | 修复优先级 |`

**0 个缺陷** → 进 Step 6；**有缺陷** → 回到对应 task 走 TDD 修复，重新审查，直到 0 缺陷。

> 📌 **003 的实测教训（`LEARNINGS #003-02`）：第一轮修完之后，把「修复本身」再当靶子打一轮。**
> 003 第一轮审出 35 条、全修完之后，第二轮（**5 片并行 + 对抗证伪**）抓到的
> **R2-01…R2-05 全部长在刚修出来的代码里**，其中两条是 P0/P1。
> **「修完」不等于「审完」**——这一轮别用同一套视角，否则只会得到第一轮的结论复述。

---

## Step 6 · 收尾

1. 最终 commit，message 含 `Closes 004-access-control`。
2. **merge 回开发主线**：⚠️ **这一步做不了，交给我**——`multi-tenant` 已在主检出被 checkout
   （一个分支不能 checkout 两次），且隔离会话对共享检出的 git 操作会被拦。
   你只做 final commit，然后把 `git merge --ff-only <你的分支>` 给我，**我在主检出执行**。
3. `git tag v0.1.0-004-access-control`（沿用 002/003 带编号的形式，见 D6）。
   ⚠️ 打在**最终状态**上——001 那个 tag 打在收尾提交上、漏掉了后来的补测提交，别重蹈。
4. 更新 `docs/superpowers/specs/004-access-control/session.md` 标记完成。
5. `specs/004-access-control/` **永不删除**（下一个 feature 的上下文）。
6. 报告：共 14 个 task / 审查发现 X 个缺陷已全部修复。
7. **把 `LEARNINGS.md` 补上**（1–5 条，加在最顶部）。
   **可预期的素材**：工具执行链的条数实测、RBAC 表落库的裁定、RLS 在无 PG 环境下怎么真跑。

---

## 节奏铁律

- **逐 task 停**：每个 task commit 后 STOP 等「next」确认（服从宪法第九章）。
- **一个 feature 跑完停下来等审**，再下一个。
- **严禁多 agent 并发跑多个 feature。**
- **本 feature 额外一条**：004 **没有**预置的 D1–Dn 清单，所以 003 那句「到点必须停下来问」在这里
  **没有人工到点提醒**——它不会有任何机制提醒你。
  按 003 的做法：**每个 task 开工前回头核一遍 Step 0.5 的四条还有没有活的**，
  并固定那个习惯——**动第一行代码之前，先问「这条 task 的出参，今天在仓库里打得到吗？」**
