现在开始实现 `docs/superpowers/specs/010-governance-console/`（内层仓库 openhive 内）。

> 以下路径均相对于**当前会话的工作目录**（= worktree 根 `openhive\.claude\worktrees\feat-010-governance-console\`）。
> 绝对路径锚点：仓库根 `D:\project\study\openhive\openhive\`；外层工作区 `D:\project\study\openhive\`。

**本 feature 一句话**：治理后台是「一个系统的两个视图」——与民警三栏工作台同系统，复用同一套登录 +
`is_admin` + RBAC，承接八大类管理动作（账号 / 组织 / 用量成本 / 审计 / AI 资产治理 / 模板库 /
数据源配置 / 数据项目权限），两类管理员分权；**只做「配置 + 审核 + 查看」**，不承载民警日常分析。

**任务总量 15 条**（T001–T015，7 个阶段）：

| 阶段 | 编号 | 内容 | 标签 |
|---|---|---|---|
| Phase 1 | T001–T002 | 治理后台全屏骨架 + 顶栏入口 / 分权权限矩阵 | **1 FE·新增 + 1 BE** |
| Phase 2 | T003–T004 | 管理员分权落地 / 分析库（event 增量抽取） | **2 BE** |
| Phase 3 | T005–T006 | 账号管理（列表/录入/重置/停用/僵尸清理）/ 组织架构三级树 | **2 FE·新增** |
| Phase 4 | T007–T008 | AI 资产治理 / 数据项目权限（管理员兜底） | **2 FE·新增** |
| Phase 5 | T009–T010 | 用量成本看板 / 审计日志检索 | **2 FE·新增** |
| Phase 6 | T011–T012 | 模板库 / 数据源配置 | **1 FE·新增 + 1 INT** |
| Phase 7 | T013–T015 | 边界收口 / 分权测试 / **越权 BFLA 测试（003 移交）** | **1 FE·新增 + 2 BE** |

标签分布：**`[FE·新增]` 9 条、`[BE]` 5 条、`[INT]` 1 条**。

⚠️ **与 009 的关键差别，先记住六句**：

1. **009 已经合并进主线**（`v0.1.0-009-ai-assets`，2026-10-25 实测在 `multi-tenant` 上）：
   `packages/asset-service`、治理 MCP server（三工具）、迁移 `0009`–`0012`、`role_type` 都在仓库里。
   **010 消费这些出口，别另起一套**——动手前先跑
   `grep -n 'BUILTIN_MCP_SERVERS\|GOVERNANCE_MCP_SERVER' -r packages/auth packages/opencode packages/asset-service`。
2. **010 的头号风险不是界面，是「能力已就绪、门禁未接」**：三条管理员写能力的服务层都在，
   HTTP 端点零，`isAdmin` 在服务端**没有任何授权分支**（D0-1）。T005 一加路由就开出真接口，
   门必须同时补（T003），并由 T015 双向验收。
3. **资产 HTTP 出口仍未落**：`/assets` 列表接口不存在，资产页在真栈上今天只有空态（009 挂账）。
   T007 要展示资产业务，先裁定「010 补不补资产 HTTP 出口」。
4. **审计与分析库今天零代码**：审计只有一条设计意图注释，没有表 / 检索 / 埋点；分析库没有模块，
   `SyncEvent` 只有事件桥，没有抽取消费方（D0-5 / D0-7）。T004 / T009 / T010 的第一件事是定落点。
5. **部门 id 化没做**：`auth.user.org/dept/section` 仍是 free text，无组织表；T006 新建组织树时，
   要与 009 的 `/assets/dept/*` 迁移合并考虑（D0-6）。
6. **前端是全新目录，不是换皮**：`packages/app/src/governance/` 不存在；视觉参考
   `docs/superpowers/design-reference/figma-export/` **实测不存在**；「用户管理」入口今天
   **看得见但点了没反应**（D0-2）。视觉规格要另行给，**不要靠肉眼现编**。

---

## Step 0 · 开工前体检（逐项验证，不「顺手修」）

### 0.1 基点设置

`worktree.baseRef` **已配置为 `head`**（Claude Code 的设置项、不是 git config；用
`git config worktree.baseRef` 查会显示为空，别据此判断没配置 —— `LEARNINGS #001-03`）。

```bash
git merge-base --is-ancestor multi-tenant HEAD; echo "EXIT=$?"   # 期望 0
git branch --show-current                                        # 期望 worktree-feat-010-governance-console
```

不通过就**停下来报告**，不要自行 `git reset --hard`。

### 0.2 前置 feature 已合入（用 tag，不用分支名）

```bash
git merge-base --is-ancestor v0.1.0-002-auth-account       multi-tenant && echo "✅ 002 账号"
git merge-base --is-ancestor v0.1.0-004-access-control     multi-tenant && echo "✅ 004 RBAC"
git merge-base --is-ancestor v0.1.0-009-ai-assets          multi-tenant && echo "✅ 009 资产"
```

**只验这三条。** 007（资金分析）/ 008（话单分析）产品设计未定、已暂停，不要把它们当前置
（用户 2026-10-24 的决定，`dev_tdd.009.md` Step 0.3 同文）。三条都不要写死 SHA（`#002-06`）。

### 0.3 工作区 + 本机环境缺口

```bash
git status --porcelain     # 期望空
bun --version              # 期望满足根 package.json 的 bun@1.4.2
```

⚠️ **已知本机缺口（2026-10-25 实测，开工前先看）**：

本工作台建好后跑 `bun install --frozen-lockfile` **退出码 1**，卡在
`tree-sitter-powershell` 的 `install: node-gyp-build`：

```text
'node-gyp.cmd' is not recognized as an internal or external command
error: install script from "tree-sitter-powershell" exited with 1
```

已核事实（只读诊断）：

| 项 | 实测 |
|---|---|
| `bun.lock` | **无 diff**（未被镜像源污染） |
| `packages/app/node_modules/@opencode-ai/asset-service` | 链接到位 |
| 本机 PATH | **无 `node-gyp`**（主检出 `.bin` 里也没有） |
| 主检出同名包 | 有 `build/` 产物；本工作台**没有** |

**不许**用 `--ignore-scripts` / 跳过安装「想办法让它过」，也**不要**因此去改业务代码。
要么由用户裁定装 `node-gyp`，要么先避开依赖该原生模块的测试，并在报告里如实写。

### 0.4 陈旧锁体检

```bash
ls -la "$(git rev-parse --git-dir)/worktrees/feat-010-governance-console/index.lock" 2>&1
# 存在且 0 字节 + 无 git.exe ⇒ 陈旧锁（#005-10），可删
```

### 0.5 `git add` 纪律

只**点名文件**，永不 `git add .`（`#005-08` / `#005-10`）。

---

## Step 0.5 · 开工前必须先实测的十条（**命中就停下来问**）

> 📌 **可复用的做法**：开工必读之后、动第一行代码之前，先问
> **「这条 task 的出参，今天在仓库里打得到吗？」** 打不到就别做——**先裁定归属**。
> 下面是 2026-10-25 在合并后的 `multi-tenant`（HEAD `1a9fd75d35`）上逐条实测出的差集。

### 🔴 D0-1（头号风险）：**能力已就绪、门禁未接——`isAdmin` 在服务端零授权分支**

**实测**：

- 三条管理员写能力的服务层函数**都在**：
  - `packages/auth/src/password.ts:126` `resetPassword`
  - `packages/auth/src/register.ts:244` `provisionUser`（完整录入动作）；`:130` `registerUser` 只是落库那一半
  - `packages/auth/src/zombie.ts:147` `disableAccounts` / `:185` `restoreAccount` / `:79` `findZombieAccounts`
  - `packages/auth/src/zombie.ts:28` `LastAdminError`
- 它们**除测试与自身定义外零调用**（实测 grep 只命中注释：`gateway.ts:296`、`migrate.ts:191`、
  `sandbox-archive.ts:11`）。
- `isAdmin` 在 `packages/opencode/src/server/**` **只有两处，都是「回传」不是「判断」**：
  - `packages/opencode/src/server/openhive/gateway.ts:366`（登录结果里回传给前端）
  - `packages/opencode/src/server/routes/instance/httpapi/middleware/user-identity.ts:137`（搬进请求上下文）
  - **没有任何 `if (isAdmin)` 的授权分支**。
- 前端只有**界面收敛**：`packages/app/src/topbar/menu.ts:24-25`（管理员才显示菜单项）、
  `profile-dialog.tsx:51-55`（显示「管理员/民警」）。**这不是权限**。

**后果**：T005 加路由时若漏门，就**直接开出一个无授权的管理员接口**；服务层自己不会报错
（`resetPassword` 的 docstring 明写「本函数自己不做鉴权，真正的门禁在调用方」）。

**停下来问 / 动手前必须定**：

1. 门禁放在哪一层？建议**路由层统一一处**（`/openhive/admin/*` 前缀的中间件或 `HttpRouter.use`），
   不要每个 handler 各写一遍（`LEARNINGS #005-24`：接在共同出口）。
2. 业务专家（非 `is_admin`）怎么进治理后台？`is_admin` 是二值，两类管理员分权需要第二根轴
   （见 D0-8）。
3. T015 的判据必须是「路由**在**、身份**有效**、权限**不够** ⇒ 403」，**404 不是授权拒绝**
   （`#002-02`）；并且**管理员走同一条必须 200**（正向放行那半不能省）。

**影响 task**：T003 / T005 / T014 / T015。

---

### 🔴 D0-2：**治理后台的落点、入口、视觉依据今天都不存在**

**实测**：

- `packages/app/src/governance/` **不存在**；`packages/opencode/src/governance/` **不存在**。
  plan 的 9 个前端文件 + 2 个后端文件**全是待新建**（`plan.md:47-63`）。
- 入口「用户管理」今天**看得见但点了什么都不发生**：
  - `packages/app/src/topbar/menu.ts:24-25` 对管理员显示该项；
  - `packages/app/src/topbar/user-menu-actions.ts:15-33` 对 `"admin"` **明确返回 `undefined`**；
  - `packages/app/src/topbar/topbar-connected.test.tsx:145` 有一条**对照用例**专门钉住
    「管理员的『用户管理』看得见，但点了什么都不发生」。**T001 接线后这条对照必须改**，
    不能留着让人以为还没接。
- 视觉依据 `docs/superpowers/design-reference/figma-export/` **实测不存在**；
  `openhive-DESIGN.md` 有 §4.1 三栏 / §4.2 关键 UI 块，但**没有治理后台 / 管理表格 / 组织树规格**。
- 「独立全屏视图」与现有三栏工作台的切换方式**没有现成模式**：`packages/app/src/pages/layout-new.tsx`
  只接 `WorkspaceEntry` + 路由页。

**停下来问**：

1. 全屏视图是**路由页**（`props.children`）还是**覆盖层/独立 view**？切进去时三栏保留还是卸载？
2. 视觉规格由谁给？（用户给 / 先补 `openhive-DESIGN.md` 一节）**不要靠肉眼现编**。
3. 入口接线改 `user-menu-actions.ts` 的哪一支？返回什么动作语义（像现有三项那样，
   动作是语义、实现留在 `topbar-connected.tsx`）？

**影响 task**：T001 / T013（以及所有 `[FE·新增]` 的视觉基线）。

---

### 🔴 D0-3：**资产 HTTP 出口未落 ⇒ 资产治理界面今天没有数据源**

**实测**：

- `packages/opencode/src/server/openhive/` 现有文件：`access.ts` / `archive.ts` / `backup*.ts` /
  `file.ts` / `gateway.ts` / `member.ts` / `pg.ts` / `project.ts` / `ui-shell.ts`——**没有资产路由**。
- 全仓 `grep '"/assets'` 只命中 `ui-shell.ts` 的**静态资源目录**（前端构建产物），不是资产业务接口。
- 前端 `WorkspaceEntry.assets?: () => readonly AssetMetadata[]` **未在
  `packages/app/src/pages/layout-new.tsx` 注入**（该文件里没有 `assets`）。
- 009 `state.md` 的「阻塞项」已挂账：**「真栈上资产页今天只有空态」**。

**后果**：T007（资产治理界面）若按 plan 直接写，只能对着空态做 UI；T009 / T010 的
「用量 / 审计」同样**没有数据源**。

**停下来问**：资产 HTTP 出口由 010 补，还是先退回 009 的残差清单？如果 010 补，
落点是 `packages/opencode/src/server/openhive/asset.ts`（照 `project.ts` 的路由模式）还是
`packages/asset-service` 自己出 HTTP（需要宿主）？**这是 T007 的开工前提**。

**影响 task**：T007 / T009 / T010。

---

### 🟡 D0-4：**治理 MCP server 已有宿主，别重建；三个工具的动作是定死的**

**实测**：

- 内建名单：`packages/auth/src/builtin-mcp.ts:38` `GOVERNANCE_MCP_SERVER = "openhive-governance"`；
  `:46` `BUILTIN_MCP_SERVERS`。
- 信任边界已接进内核：`packages/core/src/access/session.ts`（`McpServerNaming.builtin`）+
  `packages/opencode/src/server/openhive/access.ts:39`（按**精确名字**打标，不做前缀匹配）。
- 三工具与 stdio 入口：`packages/asset-service/src/governance.ts`（`submit_skill_for_review` /
  `publish_skill` / `create_skill_draft`）+ `packages/asset-service/src/mcp-main.ts`。
- 流转权限落点：`packages/asset-service/src/review.ts:43` `TRANSITION_REQUIRED_PERMS` / `:59` `authorizeTransition`。

**要求**：010 的资产治理界面**通过资产服务 / 治理出口**办事，**不要**在 `packages/app` 或
`packages/opencode` 里再写一套状态流转。状态机的唯一真相在
`packages/asset-service/src/lifecycle.ts`。

**影响 task**：T007 / T012。

---

### 🔴 D0-5：**审计今天零实现——没有表、没有检索、没有埋点**

**实测**：

- `grep -rni 'accessdenied\|audit' packages --include='*.ts' --include='*.tsx' --include='*.sql'`
  （排除测试 / node_modules）只命中：
  - `packages/core/src/access/capability.ts:32` —— **一条设计意图注释**（「FR-010 要求越权留审计」），
    **没有实现**；
  - `packages/codemode/src/tool-runtime.ts:47` —— 上游 codemode 的**工具调用类型**（`ToolCall`），
    不是治理审计存储。
- `auth` 迁移里**没有任何 audit 表**（现有表见 D0-6 的清单）。
- 010 spec 的 Assumptions 写「审计日志埋点由 F4 已埋」——**实测不成立**。
  ⚠️ 这句必须核准：如果埋点在别的仓库/部署侧，写进缺口表；如果确实没有，T010 的
  「检索界面」**没有可检的东西**。

**停下来问**：审计表放 `auth` 还是新 schema？记录哪些动作（登录、越权、管理写操作、资产流转）？
写入是同步还是异步？**不要**把「审计检索界面」先做出来，再发现没有数据源。

**影响 task**：T010（以及 T003 / T005 的写操作要不要落审计）。

---

### 🔴 D0-6：**组织架构没有表——`org/dept/section` 只是用户表上的 free text**

**实测**：

- `packages/auth/src/migrations/0001_init.sql:20-22`：`auth.user` 的 `org` / `dept` / `section`
  都是 `text NOT NULL`，**没有组织表、没有层级、没有稳定 id**。
- 现有表清单（`grep 'CREATE TABLE' packages/auth/src/migrations/*.sql`）：
  `user` / `role` / `user_role` / `role_resource` / `project_member` / `project_archive` /
  `project_meta` / `project_backup_event` / `asset` / `asset_notification` / `asset_favorite` /
  `asset_usage`——**没有 org / dept / section 表**。
- 009 的挂账：**「发布目录当前用部门名；部门表与稳定 id 待 010，届时迁移 `/assets/dept/*`」**。

**后果**：T006 的「三级树增删改」**没有承载表**；改名 / 合并会断，且与 009 的资产发布目录同源。

**停下来问**：新建 `auth.org`（`id` / `parent_id` / `level` / `name`）三张表还是一张自引用表？
`auth.user` 的三个 free text 列怎么迁（加 `dept_id` 并回填？先并存？）？
009 的 `/assets/dept/*` 迁移是否同一批做？

**影响 task**：T006 / T005（部门搜索）/ 009 残差。

---

### 🔴 D0-7：**分析库零代码——`SyncEvent` 有事件桥，没有抽取消费方**

**实测**：

- 全仓**没有** `analytics` 模块；`packages/opencode/src/governance/analytics.ts` **不存在**。
- `SyncEvent` 只在事件桥里出现：`packages/opencode/src/event-v2-bridge.ts:52`、
  `packages/opencode/src/control-plane/workspace.ts:398-402`、`bus/global.ts:16`、
  `server/routes/instance/httpapi/groups/global.ts:17-47`。
- **没有**「从每用户 SQLite / event 表增量抽取到分析库」的代码，也没有分析库表结构。

**后果**：T004 的出参「event 增量抽取到分析库」今天**没有落点**；T009 的看板也没有数据。

**停下来问**：分析库落在哪个库 / schema（`auth` schema？独立 PG 库？SQLite？）？
增量键是什么（`syncEvent.id`？时间戳？）？抽取幂等怎么验？**「两个存储两个读者」**
（元数据 / 事件在哪、看板读哪）必须写清楚（`LEARNINGS #007-02`）。

**影响 task**：T004 / T009。

---

### 🟡 D0-8：**两类管理员分权没有现成载体**

**实测**：

- 今天只有：`auth.user.is_admin`（二值）+ RBAC 三张表（`role` / `user_role` / `role_resource`）。
- 009 给 `auth.role` 加了 `role_type`（`normal` / `group`，见
  `packages/auth/src/rbac.ts:41-48` 与 `0010_role_type.sql`），但那是**授权组标记**，
  **不是「系统管理员 vs 业务专家」**。
- `packages/core/src/access/rbac.ts` 的 `resolve()` 目前只把 `read` 产成 allow；
  `write` / `review` / `admin` 没有 carrier（009 的边界，动作级校验在资产服务自己做）。

**后果**：T002 的「权限矩阵」不是一张纸，要有**可查询的载体**；T003 的「各见各的功能」需要
服务端判定出口，不能只让前端菜单分叉。

**停下来问**：两类管理员用 **`is_admin` + 能力判定**表达，还是新增角色类型 / 权限位？
「业务专家不是 `is_admin`」时，治理后台入口与路由怎么放行（与 D0-1 同一根链条）？

**影响 task**：T002 / T003 / T014。

---

### 🟡 D0-9：**009 挂账里与 010 直接相关的六条（开工前必读原文）**

出处：`docs/superpowers/specs/009-ai-assets/state.md` 的「## 阻塞项」。

| # | 挂账 | 对 010 的含义 |
|---|---|---|
| 1 | **部门 id 化**：发布目录用部门名，部门表与稳定 id 待 010 | T006 建组织树时同批处理；届时迁移 `/assets/dept/*` |
| 2 | **资产 HTTP 接口未落**：`/assets` 列表不存在，`layout-new.tsx` 未注入 `WorkspaceEntry.assets` ⇒ 真栈只有空态 | T007 的前置（D0-3） |
| 3 | **没有 `opencode.json` 写入器**：`buildUserMcpConfig()` 只产出「该给什么」，本仓没有代码写进去 | 治理 MCP 在**部署侧接线之前**不会出现在模型工具清单；T007/T012 别把它写成「已生效」 |
| 4 | **🔴 RLS 未在本仓验证（D0-12）**：`mcp-downlink.md` §6 是接口契约 + 外部验收清单 | **不得在任何报告里写成「RLS 已覆盖」** |
| 5 | **业务 MCP 连接清单无常存储**：`connections` 是入参，没有配置表 / 管理端写入路径 | T012（数据源 / connector）很可能要和它合流，别做第二套 |
| 6 | **端到端接线用例被环境挡住**：`openhive-access-mcp-wiring.test.ts` 因 `openai@6.39.1` 缺 `version.mjs` 跑不起来；T014 用纯函数用例替代 | 010 补测时**如实写缺口**，别把替代用例写成端到端 |

另：**009 F1 前端 a11y 审计仍红 5 格**（`docs/superpowers/specs/009-ai-assets/test-gaps.md` §7，
实得 `19 ✅ / 5 ❌，EXIT=1`）：

- light：`text-text-faint` `#808080` on `bg-base` `#FCFCFC` = **3.85:1**（detail 三格）；
- dark：`text-text-base`（`#fafafa`）on `bg-accent-soft` `#FEF3C7` = **1.07:1**（nav 两格）。

**结论口径**：这是**设计裁定**项、未修。010 的管理界面**别照抄这两个组合**，
也**别在报告里写成已解决**。

**影响 task**：T006 / T007 / T012（以及所有前端任务的 token 选择）。

---

### 🟡 D0-10：**新增 `governance/` 前端目录会命中三处清单；本机还有 node-gyp 缺口**

**实测（2026-10-25）**：三处「自有目录」清单当前都包含 `ai-assets`，新目录 `governance` 必须
**三处一起加**，否则 lint / token 门**扫不到新文件**（006 的 D0-7 踩过一次）：

| 落点 | 现值 |
|---|---|
| `packages/app/src/openhive-module-dirs.test.ts:13` | `["rail","center","topbar","workspace","project","auth","ai-session","ai-assets"]` |
| `packages/app/src/workspace/design-token-refs.test.ts:47` | 同上（`自有目录`） |
| 根 `package.json:16` `lint:openhive` | 逐个列了这 8 个目录 |

另：本机 `bun install` 的 `tree-sitter-powershell` 构建缺口（Step 0.3），
**属环境问题，不是代码问题**，按那一节的处置走。

**停下来问**：改法先报告（三处一起加 + 确认新目录确实进 lint），**不要自己拍了就写**。

**影响 task**：所有 `[FE·新增]`。

---

## Step 1 · Worktree 隔离（**本工作台已建好，先验证再动**）

```bash
git merge-base --is-ancestor multi-tenant HEAD; echo "EXIT=$?"   # 期望 0
git branch --show-current                                        # worktree-feat-010-governance-console
```

（本工作台由主检出 `claude --worktree feat-010-governance-console` 建出，基准 = 当时的 HEAD =
`multi-tenant` 的 `1a9fd75d35`；`.worktreeinclude` 会自动复制 `.env*` / `.credentials.yaml`。）

---

## Step 2 · 启动必读（每个 task 开始前）

① 先读 `D:\project\study\openhive\.specify\memory\constitution.md`，遵守其全部原则——**冲突以宪法为准**。

> ⚠️ 必须用**绝对路径**：宪法在外层工作区、不在本仓库。worktree 里写
> `../.specify/memory/constitution.md` 会解析到 `.claude/worktrees/.specify/…`，**读不到**。
> 010 最吃重的是 **§一（最小化上游冲突）**、**§三（物理隔离）**、**§四（权限下沉执行层）**、
> **§五（质量门禁）**、**§八（前端设计系统）**、**§九（实现纪律）**。

② 读 010 自己的三份文档：

| 文档 | 读什么 |
|---|---|
| `docs/superpowers/specs/010-governance-console/spec.md` | 6 个用户故事、FR-001…FR-013、Edge Cases、Assumptions |
| `docs/superpowers/specs/010-governance-console/plan.md` | **已定稿，禁止重新规划**；文件结构、集成点、风险 |
| `docs/superpowers/specs/010-governance-console/tasks.md` | 15 条 task、依赖、出参；**文件头三笔移交必须读** |

③ 读权威设计依据：

| 文档 | 读什么 |
|---|---|
| `docs/superpowers/specs/openhive-DESIGN.md` | §1 Colors / §2 Typography / §3 Spacing / §4.1 三栏 / §4.2 关键 UI 块 / §4.5 中栏 tab；**没有治理后台规格**（D0-2） |
| `docs/superpowers/specs/2026-09-06-openhive-design-v2.md` §4.2 / §12.2 / §14.5 | 治理后台八大类 / 数据源 / 审计 |
| `docs/superpowers/specs/openhive-PRD.md` §F10（`:249` 起） | 治理后台范围；F2 / F4 / F9 是上游 |
| `docs/superpowers/specs/004-access-control/` | RBAC / capability / **授权变更生效时点**（见文件头第三笔移交） |

④ 读直接上游的交班：

- **009**：`docs/superpowers/specs/009-ai-assets/` 的 `state.md`（阻塞项，见 D0-9）、
  `test-gaps.md`、`governance.md`、`mcp-downlink.md`、`lifecycle.md`；
  `packages/asset-service/src/governance.ts` 文件头（三工具与身份边界）。
- **004**：`packages/core/src/access/rbac.ts`（`resolve()` 只产 `read`）、
  `packages/opencode/src/server/openhive/access.ts`。
- **003**：`docs/superpowers/specs/003-multi-tenant-isolation/` 的 T016（BOLA/BFLA 移交原文）、
  `tasks.md` 文件头的三笔移交。
- **002**：`packages/auth/src/register.ts` 的 `provisionUser` 文档注释（为什么录入不能调 `registerUser`）、
  `zombie.ts` 的 `LastAdminError` / TOCTOU。

⑤ `tasks.md` 的 Prerequisites 只是「前置 feature 已落地」，**不是「接口已就绪」**。
按 Step 0.5 重新表述：F2 给了账号服务层、**没有管理员端点**；F4 给了 RBAC 与 `read` 通道、
**没有 review/admin 的服务端判定**；F9 给了资产服务与治理 MCP、**没有资产 HTTP 出口**。
**别把 Prerequisites 当成已验收的 API。**

⑥ 取最小依赖且未完成的 task，用 `superpowers:test-driven-development`（RED→GREEN→REFACTOR）。

⑦ 每个 task 跑完：更新 `tasks.md` 该 task 的 checkbox → 更新 `state.md` → commit → **STOP**，
等我说「next」。

⑧ 全部 task 完成后 **STOP**，等审整个 feature。

⑨ **遇到「未定」的决策点先停下来问我**（见 Step 0.5 与文末「未定项清单」），不要自行拍板。
**非 bug 类内容（视觉规格、权限矩阵文案、模板字段）先走 `superpowers:brainstorming`，
谈定再动手。**

---

## Step 3 · 任务标签执行规则

### [BE] —— 5 条（T002–T004、T014、T015）

**🔑 落点实测（开工前先看这段，别照 plan 的目录图直接开写）**

| 要找的东西 | 真身 | 说明 |
|---|---|---|
| **迁移入口** | `packages/auth/src/migrate.ts`（`MIGRATIONS_DIR`，`:6`） | 新迁移从 **`0013_*`** 起（`0009`–`0012` 已被 009 占用）；必须成对 `.up/.down.sql` |
| **迁移锁 / 记账** | `migrate.ts:53`（advisory lock `424242`）、`auth._migration` | 不要另造 runner |
| **RBAC 读函数** | `packages/auth/src/rbac.ts`（`grantsFor` `:101`；`role_type` `:41-48`） | 只有读；写入口要新增 |
| **RBAC 规则投影** | `packages/core/src/access/rbac.ts`（`resolve()`） | 今天只产 `read` allow；`write/review/admin` 在资产服务里判 |
| **权限投影到会话** | `packages/opencode/src/server/openhive/access.ts:39`（`builtin` 精确名打标） | 治理 MCP 走这里，别再写一套名单 |
| **身份注入** | `packages/opencode/src/server/routes/instance/httpapi/middleware/user-identity.ts:137` | 验签后提供 `User.Service` + `DatabaseConnectionRouting.Hook` |
| **登录回包** | `packages/opencode/src/server/openhive/gateway.ts:366` | `isAdmin` 从这里回传前端；**不是授权** |
| **路由模式** | `packages/opencode/src/server/openhive/project.ts`（文件头）+ `server.ts` 的 `Layer.mergeAll` | `PREFIX` + `PATH` + `HttpRouter.use`；**不改上游 `api.ts`** |
| **账号能力** | `password.ts:126` / `register.ts:244`（`provisionUser`）/ `zombie.ts:147` / `:185` / `:79` / `:28` | 能力都在、端点零、门禁零（D0-1） |
| **真 PG 夹具** | `packages/auth/src/real-pg-test-support.ts` | `OPENHIVE_TEST_PG=1` + `PG_DATABASE` 必须以 `_test` 结尾 + **串行** |
| **资产服务出口** | `packages/asset-service/src/index.ts` | `asset` / `authorization` / `governance` / `lifecycle` / `review` / `service` 等；**别重写状态机** |
| **治理 MCP** | `packages/auth/src/builtin-mcp.ts:38` / `packages/asset-service/src/governance.ts` / `mcp-main.ts` | 三工具动作定死；010 只消费 |

**🔴 BE 测试纪律**

- **纯逻辑 / SQL 形状**：`cd packages/auth && bun test`（PGlite）。
- **迁移 / 注释 / 真 PG**：`cd packages/auth && OPENHIVE_TEST_PG=1 PG_DATABASE=openhive_test bun run test:real-pg`。
  ⚠️ **`PG_DATABASE` 必须以 `_test` 结尾**；夹具会 `DROP SCHEMA auth CASCADE`。
  **绝不要**指向 `openhive` / `openhive_dev`。
- **路由 / 越权**：`cd packages/opencode && bun test` 里已有 005/006 的路由测试模式；
  新端点照同一 harness 写，**不要只测 handler 不测 HTTP**。
- **`bun run test:httpapi`**：新增 HTTP 端点后先跑一次，看 `--fail-on-missing` 是否要求补文档；
  需要补就补，**不要**用 `--no-fail` 绕过。
- **403 不是 404**：未加路由时路径本来就 404，断言 404 会得到永远绿的假测试（`#002-02`）。
- **不 mock 数据库**：分权 / 审计 / 分析库的核心判据一律走 PGlite 或真 PG。
- **迁移测试**：新表 / 列必须有中文 `COMMENT ON`（照 `0008_column_comments.sql`）；
  `migrate.real-pg.test.ts` 的 `toEqual` 表清单要按字母序补新表，**不要改成 `toContain`**。

**🔴 BE 专属红线**

- **权限只在执行层收口**：`read` 影响可见性，`write/review/admin` 影响操作；
  **不要**用前端隐藏代替授权（宪法 §四 / Anti-Patterns）。
- **所有出口都要重放鉴权**（`#005-24` / `#004-01`）：账号管理的录入 / 重置 / 停用 / 恢复是
  多个出口，每个出口都要有 `is_admin`（或等价能力）判定，不能只在「录入」上做。
- **门在副作用之前**（`#004-09`）：审计写入、通知、文件操作都必须在鉴权通过之后。
- **录入用 `provisionUser`，不用 `registerUser`**（`tasks.md` 文件头第二笔移交）：
  后者不建沙箱目录，会留下「能登录、没沙箱」的账号，且同警号重试撞 UNIQUE。
- **`LastAdminError` 要翻译成人话**，不能变成 500（例：「不能停用最后一个管理员（000051）」）。
- **`disableAccounts` 的守卫有 TOCTOU 窗口**：两个管理员同时互停可能净结果 0 个管理员；
  T005 落地后它就可达了，要有用例或明确写缺口。
- **审计不得写成「已有」**：D0-5 实测零实现。报告只写跑过的命令与实得输出。
- **异步后重读上下文**（`#008-03`）：`await` 之后要读「当前管理员 / 当前部门」，
  必须在链首捕获 id，await 后重验。
- **`catch {}` 是盲区**（`#006-28`）：失败必须可观测，不能吞。

---

### [FE·新增] —— 9 条（T001、T005–T011、T013）

**🔑 落点实测**

| 要找的东西 | 真身 | 说明 |
|---|---|---|
| 入口菜单 | `packages/app/src/topbar/menu.ts:24-25` | 管理员才显示「用户管理」；**今天只显示、不接线** |
| 入口动作映射 | `packages/app/src/topbar/user-menu-actions.ts:21-33` | `"admin"` 返回 `undefined`；T001 从这里接 |
| 入口对照用例 | `packages/app/src/topbar/topbar-connected.test.tsx:145-151` | 钉住「点了什么都不发生」；**接线后必须同步改** |
| 页面接线 | `packages/app/src/pages/layout-new.tsx` | 路由页 / `WorkspaceEntry` 的挂载层 |
| 三栏壳 | `packages/app/src/workspace/workspace-entry.tsx` | 全屏视图切进去时保留/卸载哪部分要定（D0-2） |
| 卡片 / 表格地基 | `packages/ui/src/components/` | 先复用，别再造一套 |
| 现有资产 UI | `packages/app/src/ai-assets/*` | 009 刚落地；**只借样式与交互约定，不复制业务状态机** |
| token 守卫 | `packages/app/src/workspace/design-token-refs.test.ts:47` | 新目录必须加进 `自有目录` |
| 模块目录守卫 | `packages/app/src/openhive-module-dirs.test.ts:13` | 同上 |
| lint 目录 | 根 `package.json:16` `lint:openhive` | 同上 |

**🔴 宪法 §八 红线（NON-NEGOTIABLE）**

- **SolidJS，MUST NOT 用 React 自研**；`front` 的单文件原型只可能是视觉参考，不能搬代码。
- **视觉值一律走 token，禁硬编码**——`openhive/no-raw-color` 门是 **warn 级**，
  **退出码恒为 0**；「门绿」不等于「没硬编码」，要**读代码**核对。
- **绝不动生成物**：`packages/ui/src/v2/styles/colors.css`（`script/tailwind.ts` 生成）、
  `packages/ui/src/theme/themes/oc-2.json`。
- **不启用暗色模式、仅中文、桌面宽屏**（宪法 §八）。
- **薄界面 + 厚 skill**：治理后台只做「配置 + 审核 + 查看」，**MUST NOT 内置分析逻辑**。
- **不新增依赖**：表格、树、虚拟滚动先看仓库现成的；加库先问。
- **a11y 别照抄 009 的两个红组合**：dark 选中态 `1.07:1` / light `text-faint` `3.85:1`
  （`test-gaps.md` §7），属**设计裁定未修**。

**🟡 前端测试今天能测什么**

| 手段 | 命令 / 落点 | 实测约束 |
|---|---|---|
| 纯逻辑单测 | `cd packages/app && bun run test:unit`（`.test.ts`，`--conditions=solid`） | **不收 `.test.tsx`**（脚本带 `--path-ignore-patterns="**/*.test.tsx"`） |
| 组件渲染测试 | `cd packages/app && bun run test:components`（`.test.tsx`，`--conditions=browser` + `happydom.ts` + `solid-jsx.ts`） | happy-dom **无 CSS 引擎** ⇒ 量不出几何/颜色，只能钉 `className` 与结构不变量 |
| 浏览器层单测 | `cd packages/app && bun run test:browser` | 真浏览器；几何/虚拟滚动只能在这一层验 |
| E2E | `cd packages/app && bun run test:e2e` | 慢；治理后台的跨页交互可放这层 |
| 视觉契约门 | 根目录 `bun run lint:openhive` | 只扫自有目录；新目录不在里面就漏扫 |
| 类型 | `cd packages/app && bun run typecheck`（`tsgo -b`） | |

**🔴 三条 happy-dom 铁律**

1. `.toBeNull()` 的实得值必须是原语（`#005-01`）。
2. 视觉约定只能钉 `className` 字符串；一个约定落在 N 处就写 N 条断言 + 一条对照（`#005-07`）。
3. `mount()` 要记账 + `afterEach` 先卸载再清 `document.body`（`#005-03`）。

---

### [INT] —— 1 条（T012 数据源配置）

- 后端要有**注册表 + connector 接口 + 血缘**的落点；**MVP 手动上传，不预实现自动接入**（plan R3）。
- ⚠️ 009 挂账：「业务 MCP 连接清单无常存储」——T012 很可能就是那个「配置表」的家，
  **先核一遍 `buildUserMcpConfig()` 的入参形状**，别做第二套。
- 判据：注册、列表、更新各有 HTTP 出口；connector 接口存在但允许「未实现」；
  血缘字段能存能读；**不要**把接口预留写成「已支持自动接入」。

---

### 跨标签的公共纪律

- **先写会红的用例**（`superpowers:test-driven-development`）：门禁、分权、审计、分析抽取，
  都必须先有一条红用例。
- **变异验证**：修好后把修复拆掉，用例必须红；按 `LEARNINGS #003-03` 三类据实记。
- **grep 全部同类落点**：鉴权出口、写操作出口、目录清单、迁移表清单，都列清单逐个打勾
  （`#002-06` / `#004-01`）。
- **不谎称改了**：报告只写跑过的命令与**实际输出**；没跑的、跑不动的，明说没跑。
- **不把测不了的写成已覆盖**：服务端 RLS、真模型、外部 MCP server、本机 node-gyp 缺口，
  一律进缺口表（`#002-02`）。

---

## Step 4 · 质量门禁（宪法第五章，审查前先过）

**受影响 package（按实际改动逐个跑，不要只跑 app）**

| package | 何时跑 | 命令 |
|---|---|---|
| `packages/auth` | 迁移 / RBAC / 组织树 / 审计表 | `cd packages/auth && bun test`；真 PG 另跑 `OPENHIVE_TEST_PG=1 PG_DATABASE=openhive_test bun run test:real-pg` |
| `packages/opencode` | 管理员路由 / 审计 / 分析库 | `cd packages/opencode && bun test`；新增端点再跑 `bun run test:httpapi` |
| `packages/asset-service` | 资产治理界面要消费它的出口时（只读消费不改它） | `cd packages/asset-service && bun test` / `bun run typecheck` |
| `packages/app` | 所有 `[FE·新增]` | `bun run test:unit`、`test:components`、必要时 `test:browser`、`bun run typecheck` |
| `packages/core` | 只有动 `resolve()` / `capability.ts` 才跑 | `cd packages/core && bun test` + `bun run typecheck` |

**统一门禁**

- **禁止根目录 `bun test`**（根脚本强制 `exit 1`）。
- **`.test.tsx` 进不了 `test:unit`**，必须单跑 `test:components`；**漏跑 = 白写**。
- **`bun run lint:openhive` 退出码 0**；⚠️ 门是 warn 级 ⇒ 退出码恒为 0，
  存量 warning 是基线，**开工时自己跑一次、把真实数字落进 `010/state.md` 再引用**
  （`#001-02` / `#003-04`）。本 feature 的专属动作：先把 `governance` 加进三处清单（D0-10）。
- **`bun run lint` 只判「本次新增/改动文件 0 命中」**；全局有已登记的上游 error，
  不对它改上游代码，也不拿它当阻断。单文件 lint **在仓库根**跑（`#004-10`）。
- **`bun run typecheck`（turbo）退出码 0**；前端另有 `cd packages/app && bun run typecheck`。
- **门禁串行跑，别并行**（`#003-01`）；看到红先串行复跑再当结论。
- **`bun install` 之后必查 `git diff --stat bun.lock`**；被镜像源污染就 `git checkout -- bun.lock`
  （`CLAUDE.md`「锁文件污染」）。
- **迁移门**：中文 `COMMENT ON`；`migrate.real-pg.test.ts` 的表清单更新；
  `--> statement-breakpoint` 不能漏（`#005-31`）。
- **报告门禁实得输出**：失败数、跳过数、警告数都要写，不能只写「全绿」。

---

## Step 5 · 代码审查（`superpowers:requesting-code-review`）

质量门禁过 + 全部 task 绿后触发，至少覆盖以下 8 类：

① **门禁（本 feature 头号风险）**
> - 三条管理员写能力（录入 / 重置他人密码 / 停用他人账号）**各自的 HTTP 出口**在哪？
>   每个出口是否都过了服务端 `is_admin`（或等价能力）判定？
> - 有没有把「入口隐藏」当授权？404 与 403 是否分得清？
> - 正向放行（管理员走同一条 200）是否也有断言？

② **分权矩阵两个方向**
> - T014：管理员 A vs 管理员 B（系统管理员 / 业务专家各见各的）；
> - T015：**普通民警 vs 管理员**；
> - 两条都绿才叫闭合，**不许互相替代**。

③ **审计完整性**
> - 审计表 / 写入点 / 检索出口是否真的存在（D0-5 今天为零）；
> - 越权 AccessDenied 是否真的落库，而不是一条注释；
> - 「谁、何时、调了什么」三个字段是否都可查。

④ **分析库与幂等**
> - event 增量抽取的键是什么、重复跑是否幂等；
> - 「两个存储两个读者」是否写清（`#007-02`）；
> - 抽取失败是否可重试、可观测。

⑤ **账号管理的坑**
> - 录入是否走 `provisionUser`（建沙箱）而不是 `registerUser`；
> - `LastAdminError` 是否被翻译、不是 500；
> - `disableAccounts` 的 TOCTOU 是否被处理或明确挂账；
> - 僵尸筛选是否用 `last_active_at`（90 天）而不是 `created_at`。

⑥ **上游侵入面**
> - 新增文件 vs 修改上游文件，逐个列出；
> - `server.ts` 的路由挂载是否只有一行、是否标注「保留的定制 · 同步上游时不要丢」；
> - 是否动了 `sql.ts` / `colors.css` / `oc-2.json` / 上游高频文件；
> - 新目录是否进了 workspace 与三处门禁清单。

⑦ **前端一致性与视觉**
> - SolidJS，不是 React；没有搬 `front` 代码；
> - 视觉值是否走 token（lint 是 warn 级，必须读代码）；
> - 是否仅中文、无暗色、桌面宽屏；
> - 是否照抄了 009 的 a11y 红组合；
> - 组件名/类名约定是否每处都钉了 `className` 断言 + 对照（`#005-07`）。

⑧ **测试诚实性**
> - 有没有 mock 掉 DB / 文件 / AI，导致核心判据没被测；
> - 真 PG 用例是否只在 `_test` 库跑、是否串行；
> - 迁移表清单 / 中文注释是否更新；
> - 服务端 RLS、真模型、外部 MCP 等本机验不了的，是否如实进缺口表；
> - 变异验证做了没有？拆掉修复后哪条用例红？

审查报告用 `receiving-code-review` 消化，格式：
`| 编号 | 类别 | 文件:行 | 描述 | 修复优先级 |`

**0 个缺陷** → 进 Step 6；**有缺陷** → 回到对应 task 走 TDD 修复，重新审查，直到 0 缺陷。

> 📌 第一轮修完之后，把「修复本身」再当靶子打一轮（`#003-02` / `#005-04`）：
> 说「已修 / 已统一」之前先 `grep` 全部同类落点、逐个打勾。

---

## Step 6 · 收尾

1. 最终 commit，message 含 `Closes 010-governance-console`。
2. **merge 回开发主线由我在主检出执行**——`multi-tenant` 已在主检出被 checkout（一个分支不能
   checkout 两次）。你只做 final commit，然后把 `git merge --ff-only worktree-feat-010-governance-console`
   交给我。
3. **tag 不由你打**——它与 merge 配套，由我在主线合入之后执行（`v0.1.0-010-governance-console`）。
4. 更新 `010-governance-console/session.md` / `state.md`：
   - 当前任务、已完成、阻塞项、最后更新；
   - **缺口表**逐笔写「谁接、接在哪张表 / 哪个 feature」。
5. `specs/010-governance-console/` **永不删除**。
6. 009 挂账中由 010 接手或仍未覆盖的（部门 id / 资产 HTTP / 审计 / RLS / `opencode.json` 写入器），
   在 010 `state.md` 与 009 `state.md` **两边都对账**，不能只改一边。
7. 报告：**共 15 个 task（9 FE·新增 / 5 BE / 1 INT）** / 审查发现 X 个缺陷已全部修复 /
   门禁基线数字（含失败数、跳过数、warning 数）/ 本机验不了的清单。
8. 按需把新教训补进 `LEARNINGS`（值得记的才写；条目号一旦分配永不变动）。

---

## 节奏铁律

- **逐 task 停**：每个 task commit 后 STOP 等「next」确认（宪法第九章）。
- **一个 feature 跑完停下来等审**，再下一个。
- **严禁多 agent 并发跑多个 feature。**
- **本 feature 额外四条**：
  1. **未裁定 D0 前不动代码**。D0-1 / D0-2 / D0-3 / D0-5 / D0-7 每一条都会改变 task 归属；
     照 plan 的目录图直接开写，返工面比 009 大。
  2. **每个 task 开工前回头核一遍 Step 0.5 还有没有活的**，并固定那个习惯：
     **动第一行代码之前，先问「这条 task 的出参，今天在仓库里打得到吗？」**
  3. **完成判据先声明**：每条 task 开工前说清「什么命令跑出什么结果算完成」，你认可再动手。
  4. **非 bug 类（视觉规格、权限矩阵文案、模板字段）先走 `superpowers:brainstorming`**，
     谈定再动手；不要先斩后奏。

---

## 未定项清单（**开工前先裁定**）

| # | 事项 | 今天的事实（已实测） | 需要你定什么 |
|---|---|---|---|
| **U1** | **服务端门禁**（D0-1） | 三条管理员能力在服务层都在、HTTP 端点零、`isAdmin` 零授权分支 | 门禁放路由层统一一处还是逐 handler？业务专家怎么放行？ |
| **U2** | **治理后台挂载方式**（D0-2） | `app/governance/` 不存在；「用户管理」点了没反应；无三栏切换模式 | 路由页 / 覆盖层 / 独立 view？切进去时三栏保留还是卸载？ |
| **U3** | **视觉规格来源**（D0-2） | `figma-export/` 不存在；DESIGN.md 无治理后台章节 | 用户给规格 / 先补 DESIGN.md 一节 / 用 009 的 ai-assets 样式延伸 |
| **U4** | **资产 HTTP 出口**（D0-3） | `/assets` 列表接口不存在；资产页真栈只有空态 | 010 补 / 退回 009 残差 / T007 先做只读空态 |
| **U5** | **审计存储与埋点**（D0-5） | 零表、零检索、零埋点，只有一条注释 | 表放哪、记哪些动作、同步还是异步、越权怎么落 |
| **U6** | **分析库落点**（D0-7） | 无 analytics 模块；`SyncEvent` 只有事件桥 | 库/schema、增量键、幂等口径、看板读哪 |
| **U7** | **组织架构表**（D0-6） | 只有 user 表上的三个 free text 列 | 三张表还是一张自引用表？`dept_id` 怎么回填？与 009 `/assets/dept/*` 同批做？ |
| **U8** | **两类管理员的表达**（D0-8） | 只有 `is_admin` + RBAC + 009 的 `role_type('normal','group')` | `is_admin` + 能力判定 / 新角色类型 / 权限位？ |
| **U9** | **数据源配置存储**（T012） | 009 业务 MCP 连接清单无常存储 | 复用同一张配置表 / 另建；connector 接口预留到什么程度 |
| **U10** | **本机 node-gyp 缺口**（Step 0.3） | 本工作台 `bun install` 退出码 1，`tree-sitter-powershell` 无 `build/` | 装 `node-gyp` / 暂不处理并避开相关测试 / 其他 |
