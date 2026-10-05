# 实施进度 · 权限控制

## 当前任务

**✅ 在册 12 条全部关闭**（2026-10-05）——T001–T008（代码 ＋ 测试）、T012–T014（**纯记账关闭**，
裁定「甲」）、T015（迁移 CLI）。

- **代码任务 9 条**：T001 / T002 / T003 / T004 / T005 / T006 / T007 / T008 / T015。
- **记账任务 3 条**：T012 / T013 / T014（机制可测的一半已被 T006/T008/003 的测试覆盖；另一半显式挂账）。
- **移交 3 条**：T009 → F6/F7（裁定「乙」）、T010 / T011 → F7（见 D0-4 段）。

✅ **Step 6 已收尾**（2026-10-05）：最终 commit 含 `Closes 004-access-control`，tag
`v0.1.0-004-access-control`，`session.md` 已从占位改成真交接，`LEARNINGS` 追加 `#004-01`–`#004-07`。
`multi-tenant` 合并由**用户**执行。后续动作与挂账见 `session.md`「下次会话要做的事」。

**Step 5 已完成**（2026-10-05）：6 类扫描出 **C1 ＋ I1–I10**，用户裁定**全修**（Minors 记账）；
表定稿后复核又发现 **I11**（资源支路缺 `read` ask，同一批安全结论的第三处出口），另裁**补齐授权**。
逐条修法与见证见下方「Step 5 · 代码审查」节（含 `#003-02` 的修复重审）。

---

## 开工前实测（Step 0.5 · 2026-10-04）

`dev_tdd.004.md` 的 Step 0.5 要求「T001 之前先实测四条生死前提，命中就停下来问」。
做法照 003：**5 片并行侦察 + 关键断言自己复核**。四条**全部命中**，均已由用户当场裁定。

### ✅ 裁定（用户 2026-10-04 逐条选定）

| 编号 | 问题 | 裁定 |
|---|---|---|
| **D0-1** | 工具执行守卫覆盖哪条链 | **① 两条链都接**（A = opencode v1 / web UI；B = core v2 / CLI·sdk-next）。判定逻辑写一份，ruleset 按链各注入一次 |
| **D0-2** | capability / RBAC 代码落哪个包 | **落 core**（`packages/core/src/`）。plan.md 原文的 `packages/opencode/src/{authz,rbac}/` **覆盖不到 B 链**，作废 |
| **D0-3** | RBAC 表建在哪个库 | **① 建在 auth 的 PG**（复用 `packages/auth/src/migrations/` 与 `migrate()`）。⚠️ 前提是 D-05（生产无迁移入口）要在 T004 之前另裁一次 |
| **D0-4** | 数据范围（T010 / T011） | **② 整条移交 F7**。落点 = `007-fund-analysis` 的 T004 / T001 ＋ `005-project-management` T004，移交块已写进**接收方的 tasks.md** |

### 🔴 D0-1 命中：工具执行有**两条独立主链**，且**没有「统一执行器入口」**

| | **链 A · opencode v1（web UI）** | **链 B · core v2（CLI / sdk-next）** |
|---|---|---|
| 端点 | `POST /session/{id}/prompt_async` 等 6 个 | `POST /api/session/{id}/prompt` |
| 清单组装 | `session/tools.ts` 的 `SessionTools.resolve` → `session/llm/request.ts` 的 `resolveTools` | `packages/core/src/tool/registry.ts` 的 `materialize(permissions)` |
| 模型请求 | `session/llm.ts` 的 `streamText`（**默认**）/ `native-runtime.ts` 的 `ToolRuntime.dispatch` | `session/runner/llm.ts` 的 `LLM.request({tools})` |
| 函数体执行 | `session/tools.ts` 的 `item.execute`（本地）/ 同文件 MCP 三处 / `tool/tool.ts` 的 `execute(decoded,ctx)`（builtin）/ `tool/registry.ts` 的 `fromPlugin`（plugin） | `tool/tool.ts` 的 `config.execute(input,context)` —— **全仓仅此一行**，`settle` 生产调用者仅 `registry.ts` |
| 清单过滤 | `packages/opencode/src/permission/index.ts` 的 `disabled` / `visibleTools` | `materialize` 里 `whollyDisabled(...)` |
| 执行鉴权 | 每工具 `ctx.ask({permission,patterns,always})` | 每工具 leaf `permission.assert({...})` |

取数（两条目录里都有，互不 import）：

```bash
grep -rn "PermissionV2" packages/core/src/tool/            # core 侧 per-tool assert
grep -rn "ctx.ask(" packages/opencode/src/                 # v1 侧 per-tool ask
grep -n "visibleTools\|export function disabled" packages/opencode/src/permission/index.ts
sed -n '106,122p' packages/core/src/tool/registry.ts       # materialize(permissions)
```

- 两套注册表 service tag 不同（`@opencode/ToolRegistry` vs `@opencode/v2/ToolRegistry`），工具名也不同
  （v1 是 `shell`，v2 是 `bash`）⇒ **是两套独立实现，不是同一套的两层**（core 在做 leaf migration，
  opencode 那套是仍在跑的 v1）。
- ⚠️ **两条链都已有上游自带的权限钩子，且都是 ruleset 驱动**：清单过滤（可见性）＋ 执行断言。
  这与提示词 Step 3 的要求一致（「能用『加一个判断』接上去，就别另起一套并行的」）。
- ⚠️ **`packages/core/src/tool/AGENTS.md`（上游文件）明文禁止**在该目录加
  「authorization callback / registry-owned executor」，并写着
  「**Definition filtering is catalog visibility, not execution authorization.**」
  ⇒ **不能**在 registry 上挂一个 `tool-guard.ts`。004 的做法应是
  **把 capability / RBAC 判出来的 ruleset 注入既有钩子**，判定写一份、按链注入（形状抄
  `packages/core/src/quota/session-quota.ts`）。

#### ⚠️ D0-1 补充（T003 开工前实测）：两条链的 `Rule` **形状不等价**，中间必须有一层改编

| | **链 A · `PermissionV1.Rule`** | **链 B · `PermissionV2.Rule`** |
|---|---|---|
| 字段 | `{ permission, pattern, action }` | `{ action, resource, effect }` |
| 定义处 | `packages/schema/src/v1/permission.ts` | `packages/schema/src/permission.ts` |
| 判定函数 | `evaluate(permission, pattern, ...rulesets)` | `evaluate(action, resource, ...rulesets)` |
| 命中条件 | `Wildcard.match(permission, rule.permission)` ∧ `Wildcard.match(pattern, rule.pattern)` | `Wildcard.match(action, rule.action)` ∧ `Wildcard.match(resource, rule.resource)` |
| 未命中兜底 | `{ action: "ask", permission, pattern: "*" }` | `{ action, resource: "*", effect: "ask" }` |

```bash
cat packages/schema/src/v1/permission.ts        # V1: { permission, pattern, action }
cat packages/schema/src/permission.ts           # V2: { action, resource, effect }
sed -n '28,37p' packages/opencode/src/permission/index.ts   # V1 evaluate 的兜底值
```

- 语义**一致**（都是 `findLast` ＋ 双字段 `Wildcard` ＋ 兜底 `ask`），但**字段名不同**，
  且「`action`」这个词在两处指**不同的东西**：V1 的 `action` 装的是**效果**（`allow|deny|ask`），
  V2 的 `action` 装的是**动作**（工具名）。照名字对字段会把两栏对调。
- ⇒「判定写一份、按链注入」中间**必须有一层改编**：
  V2 `{ action, resource, effect }` → V1 `{ permission: action, pattern: resource, action: effect }`。
  这是**纯改名**，而正因为是纯改名，**改错了不会报错、不会变红**——`LEARNINGS #003-05` 说的
  「假镜像」高危形状（看着一样、实际不等价、静默放行）。
- **归属**：改编层随**注入点**走，落在 T005/T006（那两处才真的把 ruleset 交进上游钩子）；
  T003 只负责产出**规范形状（V2）**的那一份，不提前给链 A 造一份平行 ruleset。

### 🔴 D0-5 命中（T003 开工前实测）：「会话启动」这个时刻**在两条链里都不存在**

`FR-001` 说「会话启动时签发」。实测（2026-10-04，Explore 全仓扫描 ＋ 本机复核）：

| 问题 | 实测结论 | 证据 |
|---|---|---|
| 「创建会话」在哪 | 链 A `POST /session`；链 B `POST /api/session` | `groups/session.ts`；`protocol/src/groups/session.ts` |
| 「创建」＝「启动」吗 | **不是**。创建只发 `Created` 事件并落一行，**不启动执行** | `session/session.ts`；`core/session.ts` |
| 「启动」在哪 | **首次 prompt** 触发 | `prompt.ts` 的 `ensureRunning`；`core/session.ts` 的 `execution.wake` |
| 有「执行已启动」事件吗 | **没有**。链 B 的启动是内存协调器 `wake`，不发布事件；链 A 是 `SessionRunState.runner.ensureRunning`，也不发布 | `execution/local.ts`；`run-state.ts` |
| 哪一层同时拿得到「验签身份 ＋ 项目」 | **只有 HTTP 请求 fiber** | 身份 `middleware/user-identity.ts` 注入 `User.Service`；项目 `core/session.ts` 的 `projects.resolve(input.location.directory)` |
| core 会话 / runner 层拿得到身份吗 | **拿不到**。三处 deps 里都没有 `User.Service` | `core/session.ts`、`runner/llm.ts`、`store.ts` |
| 有可写的「每会话槽位」吗 | **没有**。`SessionStore` 只读；写路径只有事件投影器或 `SessionV2.create` 的直接 `db.insert` | `store.ts` |

**链 A 有一条上游自带的「每会话 ruleset」通道**（本次最重要的正面发现）：

```
Session.Info.permission（V1 形状，可选，schema/v1/session.ts）
  └─ SessionTools.resolve: ruleset: Permission.merge(input.agent.permission, input.session.permission ?? [])
       └─ 每个工具的 ctx.ask({ ruleset })          ← session/tools.ts 的 SessionTools.resolve
```

- ⚠️ **今天这个字段由调用方在 create 请求里传**：HTTP payload 就有
  `permission: Schema.optional(PermissionV1.Ruleset)`（`groups/session.ts`，落到 `session.ts` 的创建/更新处），
  另有 `setPermission` 可随时改。
  ⇒ **今天「这个会话拿哪些工具权限」是客户端说了算的**——这正是 `FR-002` 要改掉的。
- **链 B 侧没有会话粒度的 ruleset 通道**：按会话取 ruleset 的现成机制是
  `PermissionV2.configured(sessionID, agentID)`（`core/permission.ts`），但它读的是
  `agent.permissions`——**按 agent，不按会话**。

⇒ **T003 的难点不是「找到那个时刻」，而是裁定「签发的产物放在哪里、由谁放」**。见下。

**裁定（用户 2026-10-04，三选一）：选「甲」——T003 只做签发函数，接线归 T005/T006。**

| 选项 | 内容 | 未选原因 |
|---|---|---|
| **甲 ✅** | T003 ＝ 纯函数 `issue()`，不接线 | —（选中） |
| 乙 | 现在就在两条链的会话创建处落地 | 链 B 无可写每会话槽位 ⇒ 需**新造**一个按 sessionID 的存储，并引入「内存 vs 落库 / 进程重启后证还在不在」的次级决策——把一个小任务撑成设计题 |
| 丙 | 只落链 A（用现成的 `Session.Info.permission` 通道） | 出不对称的中间态（链 A 有、链 B 无）；且它顺带要改「客户端自传 permission」那段，那是**独立的安全修复**，混进 T003 违反「一次只做一件事 / 一个提交别混两件事」 |

- 选甲的三条理由：① **T005/T006 本来就是「把 ruleset 注入既有钩子」的任务**，挂证是它们的正题，
  甲没漏掉任何东西；② 「挂到哪」本身是**未定的设计决策**（链 B 的存储），不该在一个小任务里顺手拍板；
  ③ 甲**只新增** `packages/core/src/access/` 下的文件，**官方代码一行不碰**——符合第一号约束
  「最小化上游合并冲突」；乙 / 丙都要动官方会话创建流程。
- **代价（已同步改 `tasks.md`）**：T003 出参由「会话启动产出 capability」改写为
  「签发函数产出 scope 限定 capability」。
- ⚠️ **顺带查实的真问题，归属 T005/T006（不在 T003 做）**：链 A 今天由**客户端**在 create 请求里传
  `session.permission`（`groups/session.ts`）⇒ **客户端能自己决定自己有哪些工具权限**。
  这正是 FR-002 要改掉的，但改它 ＝ 动官方会话创建流程，留给接线任务。

### 🔴 D0-2 命中：落点

- `packages/core/src/tool/` 与 `packages/opencode/src/tool/` **都是纯上游区**：
  ```bash
  git log -1 --format='%h %s' -- packages/core/src/tool/tool.ts   # 93159bccbf feat(core): port v2 runtime fixes onto dev
  git diff --stat multi-tenant...HEAD -- packages/core/src/tool/  # 空
  ```
  （两者最近改动逐个 `git merge-base --is-ancestor <sha> upstream/dev` 均为是。）
- 依赖方向单向 **opencode → core**：包名分别是 `@opencode-ai/core` 与 `opencode`；
  `packages/core` 无 opencode 依赖，`packages/opencode` 的 devDeps 有 `@opencode-ai/core`。
  ⇒ **core 不可能 import opencode** ⇒ 要管 B 链，判定代码必须在 core。
- 既有 `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts`
  **不是 003 的产物**（最后一次改动是上游提交，003 在该目录只动过
  `user-identity.ts` / `anchor-workspace.ts` / `matched-route.ts` / `session-quota.ts`）。
  它做的是**服务器口令认证（auth_token / Basic）**，与租户授权无关——**别当扩展点**。

### 🔴 D0-3 命中（硬阻塞，用户已裁定建库）

- auth PG 今天只有 `auth.user` ＋ 记账表 `auth._migration`：
  ```bash
  grep -rniE "create table" packages/auth/src/migrations/*.sql   # 仅 0001_init.sql 的 auth.user
  ```
- `migrate()` 生产**唯一**调用点 = `packages/opencode/src/server/openhive/gateway.ts` 的 `bootstrap()`，
  且被 `OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO` 门住、且**一次性**：
  ```bash
  grep -rn "migrate(" packages --include=*.ts | grep -v "\.test\.ts"   # 生产仅 gateway.ts 一处
  grep -rn "migrate" package.json packages/*/package.json turbo.json   # 输出为空：无 CLI / 无脚本 / 无 turbo 任务
  ```
  ⇒ **003 的 D-05 已成立**：004 的 RBAC 表是「新迁移」⇒ 按现状**上线建不出来**。
- **待裁（T004 之前必须解决，用户已知悉）**：给迁移一条独立于引导的生产入口（CLI / 启动开关），
  或明确「部署流程手动跑」并写进 `docs/workspace/deploy-todo.md`。CC: `deploy-todo.md` D-05。
  > ✅ **2026-10-04 已裁已落**：用户选**独立 CLI 脚本**（否掉「启动开关」：会把一次性引导变成常驻开关，
  > 撤变量的初衷就没了），且**只做向上迁移、不带 `rollback`**。落点 `packages/auth/src/migrate-cli.ts`
  > ＋入口 `packages/auth/script/migrate.ts`，命令 **`bun run --filter @opencode-ai/auth migrate`**。
  > ⇒ 上面那句「按现状**上线建不出来**」**至此不成立**：T004 的 `0004` 有路径可应用了。
  > 详见下方 **T015** 段与 `deploy-todo.md` D-05 的「已解」块。
- 建表约束（`packages/auth/src/migrations/README.md`）：整轮迁移**一个事务** ⇒ **禁写
  `CREATE INDEX CONCURRENTLY`**（报 25001）；分隔符 `--> statement-breakpoint`；隔离级别依赖
  READ COMMITTED（D-12）；别改 `MIGRATION_LOCK_KEY`。
- 业务 PG 今天**零代码**：`packages/auth/src/db.ts` 的 `connect()` 是单账号（`PG_*` 拼一条连接串），
  **无 `SET ROLE` / 无 RLS / 无第二连接池**。`deploy-todo.md` 里**没有任何 RBAC / RLS 条目**（需新增）。

### 🔴 D0-4 命中（已裁定移交）

```bash
grep -rn "fund_project_member\|call_project_member\|CREATE POLICY" packages --include=*.ts --include=*.sql   # 输出为空
```

- `fund_project_member` / `project_member` 等**只存在于 docs**，`packages/` 下零命中；
  全仓**没有任何业务数据表的迁移或 schema**。
- `007-fund-analysis` / `008-call-analysis` 任务**全部未勾选**，且 SOP §2 的依赖链是
  **F7 ← F1, F3, F4** ⇒ F7 要等 004，004 的 T010 又要 join F7 的表 = **循环依赖空档**。
- ⇒ **T010 / T011 整条移交 F7**（裁定 ②）。移交块已写进 `007-fund-analysis/tasks.md` 文件头
  ＋ 其 T004 条，以及 `005-project-management/tasks.md`（工作空间轴那半）。

---

## 环境坑：worktree 里没有 `node_modules`（`LEARNINGS #003-06` 原样复现）

开工跑第一道门禁时撞上：`bun run typecheck` 报 `@opencode-ai/enterprise#typecheck` 失败、
`console-app` 一片 `Cannot find module 'bun:test' / 'vite'`。根因 **不是代码**：

- `EnterWorktree` 建的 worktree **不含 `node_modules`**，而 bun 会**向上层目录解析** ⇒
  解析到了**主检出**的 `node_modules`，其中 `@opencode-ai/*` 是软链，**指向主检出的 packages**
  ⇒ 那一轮 typecheck **验的不是本 worktree 的代码**。
- 修法（照 `#003-06` 应对③）：`bun install --frozen-lockfile`（冻结锁文件，绕开本机镜像源污染）。
  完事复核 `git diff --stat bun.lock` = **空**，且
  `ls -la packages/opencode/node_modules/@opencode-ai/` 的 **12 个链接**全部是
  相对的 `../../../<pkg>/`（指向本 worktree 自己的包）。
- ⚠️ 附带教训：我第一次用 `bun run typecheck | tail` 取退出码，`$?` 拿到的是 **`tail` 的**，
  差点把 RED 记成 exit 0。**取退出码不许进管道**（同一类错的预防写法：`cmd > log 2>&1; echo $?`）。

**收尾（已解决）**：`bun install --frozen-lockfile` 只补到一半——`packages/core/node_modules/effect/`
仍缺 `package.json`（只有 `dist/` 与 `.bun-tag-*`）⇒ `@opencode-ai/enterprise#typecheck` 报
`Cannot find module 'effect'`。改跑 **`--force`** 后该目录出现完整内容（`package.json` + `src/` +
`LICENSE`，与主检出一致），**`bun run typecheck` 回到 exit 0（31/31）**。
判据链：`ls <pkg>/node_modules/effect/` 两侧对比 → 补齐 → 门禁转绿。（详见 `#003-06` 的应对③。）

---

## 质量门禁基线（2026-10-04 实跑，**补依赖之后**，串行）

> 取数方式：`cmd > log 2>&1; echo $?`（**不许进管道**，见上节教训）。全部**串行**跑，无并发
> （`LEARNINGS #003-01`：并行跑门禁会造假红）。

| 门禁 | 命令 | 结果 | 判据 |
|---|---|---|---|
| typecheck | `bun run typecheck` | **exit 0**，31 successful / 31 total | 必须 0 |
| openhive lint | `bun run lint:openhive` | **exit 0**，0 errors / 23 warnings / 69 files / **161 rules** | 必须 0；`161 = 131 + 30` 与 `#001-05` 恒等式一致 |
| 全局 lint | `bun run lint` | **exit 1**，4942 warnings / **1 error** / 3441 files / 130 rules | 全局恒红（见下），判「本次新增/改动文件 0 命中」 |
| core 测试 | `packages/core`: `bun test --timeout 30000` | **exit 1**，1141 pass / 8 skip / **5 fail** / 1154 tests / 152 files / 154.79s | 5 条红**全是环境引起**，见下 |
| auth 测试 | `packages/auth`: `bun test --timeout 30000` | **exit 0**，200 pass / 1 skip / 0 fail / 201 tests / 16 files / 242.36s | 与 003 记录的基线**逐字相同** |
| opencode 测试 | `packages/opencode`: `bun test --timeout 30000` | **exit 1**，3712 pass / 58 skip / 1 todo / **14 fail** / 3785 tests / 267 files / **1864.39s** | 14 条红**全在本 feature 开工之前就存在**，见下 |

### 唯一的那个 lint error（**上游的，不私改**）

落点 `packages/session-ui/src/v2/components/prompt-input/index.tsx` 里那行 Tailwind 任意值
`content-['\200B']` 被 oxlint 判为「0 前缀八进制字面量」。与 `LEARNINGS #001-02` 登记的**同一处**、
同一规则 ⇒ **基线未被本次改动污染**；裁定仍为**不私改、上报上游**。

### core 的 5 条红：环境引起，非缺陷

```
NpmConfig.load > reads registry from project .npmrc
NpmConfig.load > reads scoped registries from project .npmrc
NpmConfig.load > flattens boolean and list options
NpmConfig.registry > normalizes configured registry without trailing slash
NpmConfig.registry > leaves configured registry without trailing slash unchanged
```

全部是 `NpmConfig` 一族，根因是本机 `~/.npmrc` 指向 `registry.npmmirror.com`
（`CLAUDE.md`「锁文件污染」记的**同一个**环境事实）。**与 004 改动无关**，
判据：**按测试名做差集**，本次改动若让这个集合变化才算出问题。

### opencode 的 14 条红：**开工前就存在**，按**测试名差集**守

判据不是「14 这个数」，而是**测试名集合**。本 feature **尚未改动任何源码**
（`git status` = 只有 docs 改动）⇒ 这 14 条**不可能是本次引入的**。按成色归四类：

| 类别 | 条数 | 测试名 |
|---|---|---|
| **本机 registry / 网络**（`~/.npmrc` 镜像） | 3 | `installation > latest > reads {pnpm,npm,bun} versions via registry` |
| **cf-ai-gateway 外部网络** | 4 | `cf-ai-gateway token scoping (regression: #32051/#32052) > anthropic passthrough does NOT forward the Cloudflare token upstream`／`cf-ai-gateway routing > anthropic/* with a dotted models.dev id reaches Anthropic as a dashed native slug`／`cf-ai-gateway routing > anthropic/* rides the native Anthropic passthrough on the Messages API`／`cf-ai-gateway end-to-end (regression: #24432) > reasoning effort variants for anthropic models land as native adaptive thinking` |
| **Windows 路径大小写 / 规范化** | 3 | `tool.assertExternalDirectory > normalizes Windows path variants to one glob`／`tool.read external_directory permission > normalizes read permission paths on Windows`／`tool.shell permissions > normalizes external_directory workdir variants on Windows` |
| **时序 / 子进程 / 快照** | 4 | `tool execution produces non-empty session diff (snapshot race)`／`session.compaction.process > stops quickly when aborted during retry backoff`／`opencode run (non-interactive subprocess) > SIGINT interrupts an active non-interactive run without leaking the process`／`file HttpApi > serves search endpoints` |

第三类的直接证据（`read.test.ts` 那条的报错原文）：
`File not found: D:\users\administrator\appdata\local\temp\opencode-test-…\test.txt`
—— 路径被**小写化**后再去查（`D:\users\…` vs 真实 `D:\Users\…`），是 **Windows 路径规范化**问题，
与 004 无关。（对照 `LEARNINGS #003-04`：那条「短名/长名」观察当时**复现不出来**故未记；这次是**另一支**
——**大小写**——有原文可依。）

⚠️ **残差（据实记）**：**未做「主检出对照跑」**（同套 31 分钟，成本高）。既然本检出**零源码改动**，
「不可能是本次引入」已是比对照跑更强的判据；但要说「主检出也红这 14 条」**没有实测**，不许那样写。
本机 opencode 全量跑的**耗时**（≈31 min）也应记着：**它不是可用的逐 task 门禁**，
逐 task 判据仍是 `LEARNINGS #003-01` 的裁定——**受影响测试文件全绿 + 与上表做名称级差集**。

### 环境事实（非阻塞）：`bun install --force` exit 1

`bun install --frozen-lockfile --force` 退出码 **1**，唯一报错是
`install script from "tree-sitter-powershell" exited with 1`（node-gyp 在 Node v24 上原生编译失败）。
**非阻塞**：该包实际用到的是 `tree-sitter-powershell.wasm`
（`packages/opencode/src/tool/shell.ts` 只 import 那个 `.wasm`），而 `.wasm` 已随包落地；
失败的只是可选的 native binding。`git diff --stat bun.lock` = **空** ✅（无镜像源污染）。
⇒ 记在这里是为了下次别再把它当异常查一遍。

---

## 已完成

### T001 · 工具执行挂载点清单

**出参（tasks.md 要求「工具组装/执行两处真实入口」）** = 上面 D0-1 那张表，判据是
「**grep 出全部挂载点后差集为空**」，不是「数够了没有」。结论：

1. **存在两条独立主链**（A / B），互不 import —— 一条的守卫不会自动覆盖另一条。
2. **两条链各自已有**上游的 ruleset 驱动钩子：清单过滤（`visibleTools` / `materialize`）＋
   执行断言（`ask` / `assert`）。
3. **B 链（core）里 `tool.ts` 的工具栈是唯一必经点**；**A 链（opencode v1）里没有单一必经点**——
   本地工具 / MCP 工具 / MCP resource / plugin 工具各一处 `execute`，外加两处**非模型直调**
   （`session/prompt.ts` 的 `taskTool.execute` 与 `read.execute`）。
4. ⇒ 按 D0-1 裁定「两条都接」，**接线点是 2 处（每链一处注入 ruleset）**，而不是 6 处；
   因为上游的钩子已经把 6 个执行点收敛到「同一份 ruleset」上。

### T002 · capability scope 结构

**落点**（新建两个文件，**都是 openhive 定制、非上游**）：
- `packages/core/src/access/capability.ts` —— 结构定义
- `packages/core/test/access-capability.test.ts` —— 4 条 canary，4 pass

**形态**（出参 = 「capability 结构定义」）：

```text
Capability
├── id          cap_*   —— 审计要能回答「是哪一张证做的判定」（FR-010 / FR-004）
├── scope
│   ├── user       string         —— auth.user.id，**只能来自已验签的 User.Info**
│   ├── project    Project.ID     —— 工作空间轴（会话锚定），**不是**数据轴
│   └── dataScope  { subject, rule }  —— 只记「按谁、按哪条规矩查」
└── permissions    Ruleset        —— 签发时从 RBAC 焊进证里（FR-002）
```

**三个设计决定与理由**（都是「看着可以随手改、改了就静默出错」的那类）：

1. **`permissions` 焊进证里，不是欠条**。FR-002 说执行器「**只认 capability，不认角色表**」——
   若执行器每次还要回查 RBAC 表，它就在认角色表了。附带好处：这个形状**正好是上游两条链
   已经在吃的 `PermissionV2.Ruleset`**，不需要任何翻译层（D0-1 裁定「判定写一份、按链注入」）。
2. **`scope.user` 只留 id，不搬 `User.Info` 的 `policeNo` / `name` / `isAdmin`**。执行层要的是
   「这人是谁」（db 路由键 / MCP 身份 / 配额归属），不是「这人叫什么」；`isAdmin` 的判定归
   RBAC（T004），不在这里抄一份。**这是 `#002-06` 那句「同一个判断在两处各写一份」的预防。**
3. **`scope.project` = 工作空间轴**（`Project.ID`，即会话的 `projectID`，见
   `packages/core/src/session/info.ts`）。依据：FR-009 要求两轴解耦，而数据轴已归 `dataScope`
   那一栏；若 `project` 也指数据项目，两轴就在结构里绑死了。
   ⚠️ **这条是我从 FR-009 + design-v2 §14.1 推出来的，不是用户逐字确认过的**——用户只就
   `dataScope` 那一栏拍板（见下）。若这个理解有误，T003 签发前请指出。

**用户裁定（2026-10-04，三选一）**：`dataScope` 只写「按谁、按哪条规矩查」
⇒ `{ subject: 用户id, rule: "project-membership" }`，**刻意不含任何项目 id 列表**。
被否掉的两案：①把 design-v2 说的「两个来源」都做成字段（`projectMembership` + `interfaceScopes`）；
②干脆不要这一栏（与 FR-001 原文「按用户 + 项目 + 数据范围签发」不符）。

**为什么「不含项目 id 列表」是安全要求而非风格**：一份 `projectIds: ["p1","p2"]` 写进证里，
会在**整个会话生命周期内冻住**——用户事后被加进 p3，手里的证仍只认 p1/p2，**且没有任何报错**。
FR-008 明写数据范围「运行时 join 实时算出、不提前落库、非手动勾选」。

#### 变异验证（照 `LEARNINGS #003-03`，三类结论据实记）

| # | 变异 | 结果 | 属于哪类 |
|---|---|---|---|
| A | `DataScope` 加 `projectIds?: string[]` | **恰红 1 条**（「放不进冻结的项目 id 列表」），其余 3 条绿 | ① 最理想 |
| B | `DataScope` 加 `project?: string` | **恰红 1 条**（「不含工作空间项目」），其余 3 条绿 | ① 最理想 |
| C | 证里的 ruleset 补一条 catch-all `{action:"*",resource:"*",effect:"allow"}` | **恰红 1 条**（「未命中仍是 ask」） | ① —— 且**红的形态比预期更值钱** |

变异 C 的额外收获（值得单记）：**catch-all allow 会把已明确 `deny` 的动作也翻成 `allow`**
——报错原文 `Expected: "deny" / Received: "allow"`。因为上游 `evaluate` 用 `findLast` +
通配，最后一条匹配的说了算。⇒ 以后但凡有人为了「省事」补兜底 allow，
**拒掉的不是「多问一次」，而是把这个工具上明确写下的拒绝一起作废**。

三次变异都已还原，还原后复跑 **4 pass**。

#### 门禁（串行，取退出码不进管道）

| 门禁 | 结果 | 与基线比 |
|---|---|---|
| `bun run typecheck` | **exit 0**（31/31） | 同基线 |
| `bun run lint` | exit 1，**4942 warnings / 1 error / 3443 files** | 与基线**逐字相同**；文件数 3441 → 3443（= 新增 2 个）；**我这两个新文件 0 命中** |
| `packages/core` 全量测试 | **1145 pass / 8 skip / 5 fail** | pass 1141 → 1145（+4 = 新增用例）；**失败名差集为空**（仍是那 5 条 `NpmConfig` 环境红） |

（`lint:openhive` 只覆盖 `packages/app/src/...`，本次改动全在 `packages/core`，与该门禁无关。）

---

### T003 · capability 签发

- 落点：`packages/core/src/access/issue.ts`（**openhive 定制文件，非上游**）
  ＋ canary 测试 `packages/core/test/access-issue.test.ts`（4 pass）。新增文件，官方代码一行未碰。
- 接口与产出：

  ```ts
  issue({ user: User.Info, project: Project.ID, permissions: Permission.Ruleset }): Capability
  // ⇒ { id: cap_*, scope: { user: <user.id>, project,
  //                          dataScope: { subject: <user.id>, rule: "project-membership" } },
  //      permissions }
  ```

#### 三个设计决定

1. **入参收 `User.Info` 而不是 `string`**：`User.Info` 的唯一合法来源是 `packages/auth/src/token.ts`
   的 `verifyToken` 返回（`packages/core/src/user.ts` 顶部注释），而明文头 `X-User-ID` 只是一个
   字符串。收字符串 ＝ 让「明文头冒充身份」在**类型上**进得来。
2. **`scope.user` 与 `dataScope.subject` 一律由 `user.id` 派生，不接受任何独立入参**——
   这是整个模型的根：签发方只要能单独指定数据范围主体，就能**替别人签一张证**（拿张三的身份、
   开以李四为主体的数据范围），而且形状是对的、代码照跑、typecheck 照绿。已用 canary 钉死。
3. **`permissions` 作为入参、原样焊进证里，不增不减**：T003 的依赖只有 T002（RBAC 是并行的
   T004），函数**不认识角色表**——这正是 FR-002 的分工（执行器只认证，不回查角色表）。
   不增删的另一个含义：未命中的动作保持上游兜底 `ask`，不会被「顺手补一条全量 allow」退化成静默放行。

#### ⚠️ 本任务**不接线**（用户 2026-10-04 裁定，见上方 D0-5）

仓库里没有「会话启动」可挂的时刻；把证挂到会话上归 **T005/T006**。`tasks.md` 的 T003 出参已同步改写。

#### 变异验证（照 `LEARNINGS #003-03`，三类结论据实记）

| 变异 | 结果 | 类 |
|---|---|---|
| A：`subject: input.user.id` → `input.project` | **2 pass / 2 fail** | **精确多命中**——红的恰是两条断言含 `subject` 的用例（含「两张证不同」那条**对照**断言），不是整组红 |
| B：`permissions` 补一条 `{action:"*",resource:"*",effect:"allow"}` | **恰红 1 条**（③ FR-002 那条） | 理想 |
| C：`id` 写死成常量 | **恰红 1 条**（② 「两张证不同」） | 理想 |

已还原，`diff` 确认与原文逐字节一致，复跑 **4 pass**。

#### 门禁（串行，取退出码不进管道）

| 门禁 | 结果 | 与基线比 |
|---|---|---|
| `bun run typecheck` | **exit 0**（31/31） | 同基线 |
| `bun run lint:openhive` | **exit 0**，23 warnings / 0 errors / 69 files / 161 rules | 与基线**逐字相同** |
| `bun run lint`（全局） | exit 1，**4942 warnings / 1 error / 3445 files** | 与基线逐字相同；文件数 3443 → 3445（＝新增 2 个）；**我这两个新文件 0 命中** |
| `packages/core` 全量测试 | **1149 pass / 8 skip / 5 fail** | pass 1145 → 1149（+4 ＝新增用例）；**失败名差集为空**（仍是那 5 条 `NpmConfig` 环境红） |

#### ⚠️ 顺带查实：`lint:openhive` **覆盖不到本 feature 的代码**

`package.json` 里 `lint:openhive` 脚本的原文是
`oxlint -c script/oxlintrc.openhive.json packages/app/src/{rail,center,topbar,workspace,auth}`
——只扫 **openhive 的 5 个前端目录**。004 的定制代码全在 `packages/core/src/access/`，
**不被这条门禁覆盖**，只有全局 `lint`（130 规则、非 openhive 配置）扫得到。
⇒ 本项目「给 openhive 自有代码加更严的 lint 配置」这件事，**目前只管前端**；core 侧的定制代码
没有专属配置。记在这里，收尾时再决定要不要扩（**不在 T003 里顺手扩**——那是另一件事）。

---

### T015 · 迁移 CLI（**计划外任务**，由 D-05 裁定产生）

#### 为什么会有这条

`docs/workspace/deploy-todo.md` 的 **D-05**：`packages/auth` 的 `migrate()` 在生产里**唯一**的调用点是
003 引导首个管理员的 `bootstrap()`（`gateway.ts`），而引导是**一次性**的、跑通就该撤变量 ⇒
**撤掉之后新迁移没人应用**。002 承诺「幂等、部署可无脑重复调」，但仓库里**没有那个「调」**。
004 要加 `0004`（RBAC 表），正好撞上这笔欠账 ⇒ **它是 T004 的前置**（见下方「阻塞项」的变更）。

#### 两问两裁（用户 2026-10-04 选定）

| 问题 | 选项 | 结果 | 为什么否掉另一侧 |
|---|---|---|---|
| 「定一条可执行的路径」 | ① **独立 CLI 脚本** ／ ② 给引导加启动开关 | ✅ **①** | ② 会把「一次性引导」变成常驻开关：撤变量的初衷是「谁被引导过看得出来」，加开关等于又埋一个「看不出跑没跑」的洞——**与原病同形** |
| CLI 要不要带 `rollback` | ① **只做向上迁移** ／ ② 连 `rollback()` 一起暴露 | ✅ **①** | ② 会**立刻**解锁 002 评审的 **R11**（`rollback()` 的 head 守卫在「账上有版本、文件已删」时静默失效）。修 R11 是另一笔账，不该搭本次便车 |

#### 落点与命令

| 文件 | 性质 |
|---|---|
| `packages/auth/src/migrate-cli.ts` | **openhive 定制，新增**——逻辑在这（放 `src/` 才测得到） |
| `packages/auth/script/migrate.ts` | **openhive 定制，新增**——`import.meta.main` 入口，失败 ⇒ `console.error` ＋ `process.exit(1)` |
| `packages/auth/src/migrate-cli.test.ts` | **openhive 定制，新增**——canary |
| `packages/auth/package.json` | ⚠️ **上游文件被改**（只加一行 `"migrate"` 脚本）——**提交信息单独标注** |

命令：**`bun run --filter @opencode-ai/auth migrate`**。⚠️ `packages/auth` 是 002 才加进来的 workspace 包，
实测**不在 `upstream/dev` 的 `packages/` 列表里** ⇒ 该目录整体是 openhive 自有，改它的 `package.json` 风险可控
（但为守「改动可追溯」，仍在提交信息里单列）。

#### 三个设计决定

1. **缺 `PG_*` 必须当场抛，且抛在连库之前**：D-05 的**病根就是「静默不跑」**——今天不设引导变量，
   迁移一个字节都不做且不报错，而部署方以为跑过了。CLI 若把缺配置降级成跳过 / 默认值 / warning，
   就是把同一个病换个入口再得一遍。这条钉在 `resolveDatabaseUrl`（`connect()` 内部，`try` 之外），
   测试 ① 就是它的 canary。
2. **没活干也要说一声**：`applied.length === 0` 时打印「已是最新」。运维必须能分清
   **「跑了、没事干」**与**「根本没跑」**——这正是 D-05 那句话的两半。测试 ② 的第二半钉它。
3. **测试里刻意不断言具体版本列表**（不写死 `["0001_init", …]`）：004 正要加 `0004`，
   写死了这条会被下一个迁移撞红，而它要钉的根本不是「有哪些迁移」（`LEARNINGS #002-06`：
   会随编辑变的值别写死）。

#### 测试（2 pass）

| 用例 | 钉什么 |
|---|---|
| ① `缺 PG_*：当场抛错，不静默空操作` | 病根那半——**必须是 Error 且消息含 `PG_HOST`**，不是「返回空数组」 |
| ② `真库：应用待迁移；第二次幂等，且仍有输出` | **真库**（PGlite socket × **生产驱动** `bun-sql`，夹具 `test-support` 的 `withProductionDb`，见 `LEARNINGS #002-05`）；两半都断，**第二半才是这条存在的理由** |

变异验证（`LEARNINGS #003-03`）：把 `connect(env)` 前面加一句
`if (!env.PG_HOST) return []`（＝把缺配置降级成静默空操作）⇒ **恰红 1 条**（正是用例 ①），
失败信息正是新写法想要的那句「期望 runMigrate 当场抛错…实际它成功返回了」；用例 ② 仍绿。
已还原（`grep MUTATION` 无残留），复跑 **2 pass**。

#### ⚠️ 途中修正：`await expect(...).rejects` 触发 `await-thenable`（全仓存量 98 处）

用例 ① 原写成 `await expect(runMigrate({}, () => {})).rejects.toThrow(/PG_HOST/)`，被全局 lint 记 1 条
`typescript-eslint(await-thenable): Unexpected await of a non-Promise (non-"Thenable") value`。
**根因在类型声明不在我的代码**：`bun-types@1.3.13/test.d.ts` 把 `rejects` 声明成
`Matchers<unknown>`（`toThrow` 返回 `void`），于是 `await` 一个 `void` 就中招。
本机实测全仓已有 **98 处**同类命中（含 `packages/app/src/center/views/zip-entry.test.ts`、
`packages/core/test/*.test.ts` 的既有测试），**是既有模式不是本次引入**。
但判据是「**本次新增/改动文件 0 命中**」（`LEARNINGS #001-02`），所以换了写法——**不牺牲语义**：
`.then(() => null, (e: unknown) => e)` 接住结果，断言照样真的被执行（不是悬空的 promise），
且「它居然没抛」这件事自己会红。**没用 `as` 强转**（守 `LEARNINGS #002-03`：修测试对齐真实形状，
不是把产品码迁就错误假设；这里则是让断言形状与「真的被执行」一致）。

#### 门禁（串行，取退出码不进管道）

| 门禁 | 结果 | 与基线比 |
|---|---|---|
| `bun run typecheck` | **exit 0**（31/31） | 同基线 |
| `bun run lint:openhive` | **exit 0**，23 warnings / 0 errors / 69 files / 161 rules | 与基线**逐字相同** |
| `bun run lint`（全局） | exit 1，**4942 warnings / 1 error / 3448 files** | warnings 与基线**逐字相同**（修正前曾多 1，见上）；文件数 3445 → 3448（＝本次新增 3 个）；**我的 5 个新文件逐个 0 命中** |
| `packages/auth` 全量 | **exit 0**，**202 pass / 1 skip / 0 fail** / 203 tests / 17 files | 基线 200/1/0 → **+2 pass ＋ 1 file，恰是本次两条用例** |
| `packages/core` 全量 | **不重跑** | 本次**未改** core（T015 只落 `packages/auth`）⇒ 按 `#003-01`「改动影响面所在的测试文件全绿」不适用 |

#### ⚠️ R11 未解锁（触发条件已收紧并要求后续遵守）

003 给 **R11** 写的**回归条件 ③**原文是「`rollback()` 有了生产调用者」。裁定「只做向上迁移」⇒
**③ 未触发** ⇒ 维持 003 的「明确不做」，本次一行未动 R11。
🚩 **本 CLI 一旦加 `rollback` 子命令（或任何会调到 `rollback()` 的路径）⇒ R11 立即回归**——
这句话**逐字写进了** `migrate-cli.ts` 与 `migrate-cli.test.ts` 的头部注释，并同步更新了
`deploy-todo.md` 的 D-05 条目（原文「解 D-05 时顺手把 R11 一起裁掉」**已作废**，改为上面这个条件）。

### T004 · RBAC 表 ＋ 权限判定（FR-007 / FR-002）

#### 两处落点（由 D0-2 ＋ D0-3 两条裁定**共同逼出**，不是二选一）

| 半 | 落点 | 性质 |
|---|---|---|
| **表** | `packages/auth/src/migrations/0004_rbac.sql`（＋`.down.sql`） | openhive 定制，新增——复用 002 的 `migrations/` 与 `migrate()`（D0-3 ①） |
| **模型** | `packages/auth/src/rbac.ts` | openhive 定制，新增——drizzle 类型安全查询 |
| **判定** | `packages/core/src/access/rbac.ts` | openhive 定制，新增——纯函数，**碰不到库**（D0-2） |

**为什么判定必须在 core 且必须是纯函数**（实测，不是选择）：`packages/auth` 的 deps 只有
`drizzle-orm` / `hono`，**不依赖 `@opencode-ai/core`**；而 `@opencode-ai/core` 反过来也不依赖 auth。
⇒ core 侧**拿不到 `db`**。取行那一步（user → 角色 → 授权 的 join）因此归 **T005/T006**——
那两处住在 `packages/opencode`，而**全仓只有它同时依赖 auth 与 core**（实测）。
本任务只落「行 → ruleset」这一步。

#### 两问两裁（用户 2026-10-04 选定）

| 问题 | 选项 | 结果 | 为什么否掉另一侧 |
|---|---|---|---|
| 「用户例外」怎么表达 | ① **不加第 4 张表**（例外 = 单独给一个自定义角色）／ ② 加一张 user_resource 表 | ✅ **①** | ② 造投机结构：F9 的「授权组」也走「自定义 role」这条路（§14.3 标题「角色为主 + 用户例外」），今天不必先建一张没有消费方的表 |
| 判定函数的出口 | ① **`resolve(...) → Permission.Ruleset`** ／ ② 返回 `boolean` | ✅ **①** | ② 接线处还得再包一层把布尔翻回 ruleset——那层包装正是「同一个判断在两处各写一份」的入口（`LEARNINGS #002-06`）。① 直接喂 T003 的证，形成「角色表 → ruleset → capability」一条直线 |

#### 三个设计决定

1. **`perm` / `resource_type` 存 ASCII，不存中文**：设计文档里的「读 / 写 / 审 / 管」是**散文**。
   这四个值要进 DB、进规则字符串（`action`）、跨语言比对；编码成中文是在每个边界上多一层
   **没有任何校验兜着**的转换。CHECK 把闭集钉在**数据**上——否则一个拼错的动作（`"rade"`）
   会静静地躺在表里，症状是「某人莫名少一条权限」，根因在几天前的某次录入。
2. **`effect` 恒为 `"allow"`，未授权的绝不在这一层补 allow**：`role_resource` 表里**没有 effect 列**
   （§14.3 只给了 `role_id, resource_type, resource_id, perm`）——它记的是「授了什么」，不是「禁了什么」。
   **没有授权 ⇒ 空 ruleset**，未命中落回上游 `evaluate` 的兜底 `ask`（FR-002 的分工：执行器只认证）。
   把空输入兜底成一条 `{action:"*", resource:"*", effect:"allow"}` 会让**每个没被授权的资源静默放行**，
   且形状是对的、typecheck 照绿——这是整组里最该防退化的一条（测试 ⑤）。
3. **外键不级联**（PG 默认 RESTRICT）：删一个还被引用的角色**报错**，而不是静默把它的授权、成员关联
   一起抹掉。RBAC 的授权丢失是「有人突然没权限了」这类最难查的故障；真要级联是另一个裁定 ＋ 另一个迁移。

#### 测试（core 7 pass ＋ auth 8 pass，共 15）

> ⚠️ **已被下方「T004 修正」段取代**：core 那 7 条里 **① ② ③ ⑤ ⑦**（本表按当时的编号）断言的是
> **旧词表** `{action=perm, resource="<type>:<id>"}`，修正后重写为 8 条、且 **② ③ 更换了语义**
> （② 由「四条 perm 原样映射」变「只有 read 产规则」；③ 由「类型是一个轴」变「未投影类型＝显式缺口」）。
> 本表保留**当时的**记录，别照它读现状——现状见「T004 修正」段。auth 那 8 条**未受影响**。

| 文件 | 用例 | 钉什么 |
|---|---|---|
| `core/test/access-rbac.test.ts` | ① 单条授权 ⇒ 一条 allow，且被**下游真匹配器** `PermissionV2.evaluate` 命中 | 映射约定（action=perm、resource=`<type>:<id>`），`LEARNINGS #003-05`：对着下游行为写，不做假镜像 |
| | ② 四条 perm 各自原样映射 | 存 ASCII 不存中文 |
| | ③ 资源类型是判定的**一个轴**（两向都断） | **变异 C 补出来的**：只断「skill 不落到 mcp」时，把类型写死成 `skill:` 的实现照样全绿——反向断言才照得出 |
| | ④ 两个角色授同一条 ⇒ 去重后只出一条 | ruleset 要对两条链可直读 |
| | ⑤ 没有任何授权 ⇒ **空 ruleset**（不是全 allow） | 见设计决定 2 |
| | ⑥ 授过的是 allow、没授的仍是上游兜底 ask | 证明 resolve 没顺手把未授权的变 allow |
| | ⑦ 出口**真是** `Permission.Ruleset`（编译期可赋给 issue 入参） | 形状对不上要在类型上红 |
| `auth/src/rbac.test.ts` | 防漂移：三张表的 drizzle 模型与迁移建出的列逐列一致 | 同 `user.test.ts` 的做法（`information_schema.columns` vs `getTableColumns`） |
| | 给角色授 skill 读并把角色给用户 ⇒ 从用户 join 得回 | US4 的 Independent Test（库里那半边） |
| | join 按用户收窄（同一角色两个用户） | 上面那条即使 join 漏了 `where` 也绿——**它需要第二条数据才照得出来** |
| | 重复授同一条 ⇒ 被主键拒／未知 perm、type ⇒ 被 CHECK 拒／悬空引用 ⇒ 被外键拒 | 约束是数据层事实，打真库验，不靠注释自觉 |
| | 删角色 · **只被授权引用** ⇒ 被拦 ／ 删角色 · **只被成员关联引用** ⇒ 被拦 | 两条外键**要分别问一次**（见下方变异 E） |

⚠️ **本任务没有生产侧的 join**：取行归 T005/T006。这里用**内联 join 打真库**证明「这个 schema
支撑得住那条流程」，而不是先造一个没人调的 `grantsOf()` 放着（`LEARNINGS #002-02`：没真跑过的
路径只能记成缺口，不能记成覆盖——所以宁可在测试里真跑一次）。

#### 变异验证（`LEARNINGS #003-03`：三类都要据实记）

| 变异 | 打哪 | 观察到的红 | 类别 |
|---|---|---|---|
| A 禁掉去重 | core `resolve` | **恰红 ④** | ① 恰红目标 |
| B `grants.length === 0` 时返回一条全 allow | core `resolve` | **恰红 ⑤** | ① |
| C 类型写死成 `skill:${id}` | core `resolve` | **恰红 ③**（**强化 ③ 之后**——原来只断单向，C 全绿） | ①（先补测试） |
| D 从迁移里去掉 `perm` CHECK | `0004_rbac.sql` | **恰红 CHECK 那条** | ① |
| E `role_resource.role_id` 改成 `ON DELETE CASCADE` | `0004_rbac.sql` | 🔴 **全绿** | ③ 全绿＝**被测的那句询问没被问出来** |
| F join 去掉 user 过滤 | `rbac.test.ts` 的内联 join | **恰红「join 按用户收窄」** | ① |

**E 的全绿是本组最有价值的一次**：我的删除测试在**同一个角色**上同时挂了两种引用，于是 `user_role`
那条 RESTRICT **先**把删除拦下，`role_resource` 那条是不是悄悄级联了**根本没被问出来**。
处理照 `#003-03` 的 ③：不是「测试没覆盖」，而是**测试问错了问题**——拆成两条各自只让**一把**外键
在场的用例。用 E 仍应用的状态复跑 ⇒ **恰红 role_resource 那条** ⇒ 回退 E ⇒ 8 pass。
（同一条规则的另一面：C 的「全绿」是**测试太弱**，处理是**强化测试**；E 是**信息隔离**，两回事。）

所有变异已回退，`grep MUTATION` 无残留，探针文件（`probe-tmp.test.ts`）已删。

#### ⚠️ 连带修正：0004 撞红了 002 时期写死的 7 条断言

`0004_rbac` 让迁移 **head 从 `0003_flags_not_null` 变成 `0004_rbac`**，于是 002 写死的那些
「版本清单 / head」断言全红（实测：`packages/auth` 从基线 202 pass 掉到 **7 fail**，红的正是
`migrate > 重复执行安全`、`按逆序逐个回滚`、`rollback 的边界 ×2`、`生产驱动 ×2`、`register 警号唯一性`）。

根因是 `LEARNINGS #002-06` 那条「**会随编辑或提交而变的值都别写死**」被违反了 4 处。
修法照该条的原意——**改为从盘上取，不写死**：

| 位置 | 原来 | 改为 |
|---|---|---|
| `migrate.ts`（**产品码，「加」不「改」**） | 无 | 新增 `migrationVersions()`：返回迁移目录里的版本号（与 `rollback` 共用同一个 `upFiles`，**不是**各写一份判据，`LEARNINGS #003-05`） |
| `migrate.test.ts` 重复执行安全 ／ `production-driver.test.ts` migrate | `toEqual(["0001_init","0002_deactivated_at","0003_flags_not_null"])` | `toEqual(await migrationVersions())`——**断言强度不变**（仍是「应用了整批、且一条不多」），但不再随迁移数漂 |
| `migrate.test.ts` ／ `production-driver.test.ts` 逆序回滚 | 三行写死的 `rollback(db, "0003…")`… | `const applied = await migrate(db); for (const v of [...applied].reverse()) await rollback(db, v)`——逆序的起点取**账自己报的**那份 |
| `migrate.test.ts` 拒绝非 head ／ 回滚 head | 写死 `"0001_init"` / `"0003_flags_not_null"` | `migrationVersions()` 的**首**与**尾**（`versions[0]` / `.at(-1)`）——顺手**变强**了：原断言只钉「消息里有那个字符串」，现在钉「消息里是**当前真正的** head」 |
| `register.test.ts` 非唯一冲突不被误判 | `drop table auth.user` | `drop table auth.user **cascade**`——`user_role` 的新外键让裸 `drop` 自己先失败（2BP01），**是真语义变化**，不是写死值 |

**改写后的断言仍咬得住**（对改写本身再做变异，`LEARNINGS #003-02`「把修复当新代码再审一轮」）：
- **M1**（把守卫报的 head 写死成 `0001_init`）⇒ **恰红「拒绝回滚非 head 版本」1 条**；
- **M2**（`head` 取 `appliedInOrder.at(0)` 而不是 `.at(-1)`）⇒ **红 3 条**，含我改写的那两条。
均回退，`grep MUTATION` 干净，复跑 18 pass。

> 📌 这 4 个文件是 **002 / 003 时期的既有测试**，本次为 T004 的迁移而改。按 `dev_tdd.004.md` Step 3
> 的约定：**改到其它 feature 的既有测试 ⇒ 改完重跑被改文件**（已跑，见门禁表）。

#### 门禁（串行，取退出码不进管道）

| 门禁 | 结果 | 与基线比 |
|---|---|---|
| `bun run typecheck` | **exit 0**（31/31） | 同基线。⚠️ 首次红：`Permission.Ruleset` 是 `readonly Rule[]` ⇒ `.push` 不存在（TS2339）；改为累加进 `Permission.Rule[]`（可变数组可赋给 readonly 返回类型，出口形状不变） |
| `bun run lint:openhive` | **exit 0**，23 warnings / 0 errors / 69 files / 161 rules | 与基线**逐字相同** |
| `bun run lint`（全局） | exit 1，**4942 warnings / 1 error / 3452 files** | warnings/error 与基线**逐字相同**；文件数 3448 → 3452（＝本次新增 4 个 `.ts`；两个 `.sql` 不进 lint）；**改动的 8 个文件逐个 0 命中**（用 `,-[` 位置标记逐文件复核） |
| `packages/auth` 全量 | **exit 0**，**210 pass / 1 skip / 0 fail** / 211 tests / 18 files | T015 后基线 202/1/0 → **+8 pass ＋ 1 file，恰是本次 8 条用例**；7 条被撞红的既有断言已全部恢复 |
| `packages/core` 影响面 | `bun test test/access-rbac.test.ts` **exit 0，7 pass / 0 fail** | 本次**未改** core 的任何既有文件（只新增）⇒ 按 `#003-01`「改动影响面所在的测试文件全绿」，不重跑全包（core 全包基线本就含 5 条环境红）。⚠️ 7 pass 是**修正前**的数，修正后 8 pass（见「T004 修正」段） |

#### 未接线（明确记账，不是已覆盖）

`resolve()` **今天没有生产调用者**——接线（把证挂到会话上）归 **T005 / T006**（表 → ruleset →
`AccessIssue.issue` → 挂到两条链）。执行器也**仍然只认 capability、不回查角色表**（FR-002）。
⚠️ 别把本节读成「权限已生效」：**表建好、判定写好了，但没有任何一处生产代码调用它**。

---

### T004 修正 · `resolve()` 改用**工具断言词表**（T006 前置；用户 2026-10-04 三条裁定）

#### 为什么是「修正」而不是「打补丁」

T006（执行守卫）开工前的侦察里，实测了**所有**吃 ruleset 的消费者，发现 T004 第一版的映射
**一条都命中不了**。消费者读的是 `{ action: <工具名>, resource: <工具实参> }`：

| 证据 | 落点 |
|---|---|
| 上游自带默认规则集 | `packages/core/src/plugin/agent.ts` 的 `{ action: "read", resource: "*.env", effect: "ask" }` |
| 「总是允许」存的两列 | `packages/core/src/permission/saved.ts` |
| 清单过滤的判据 | `packages/core/src/tool/registry.ts` 的 `whollyDisabled(permission(tool, name), permissions)` |
| 链 B 断言 | `packages/core/src/tool/skill.ts` 的 `permission.assert({ action: "skill", resources: [skill.name] })` |
| 链 A 断言 | `packages/opencode/src/tool/skill.ts` 的 `ctx.ask({ permission: "skill", patterns: [params.name] })` |

而 `Wildcard.match`（`packages/core/src/util/wildcard.ts`）是**全串锚定**（`^…$`）——T004 第一版产出的
`{ action: "read", resource: "skill:fund-analysis" }` 两边字段都对不上，**全部落回兜底 `ask`**。
不报错、不变红、typecheck 照绿：`LEARNINGS #003-05` 的**假镜像**形状（写的时候以为对上了，其实只在一边成立）。

> 这也是一次**自己打自己脸**的复核：T004 收尾时我先说「所有消费者都用 `{工具名, 实参}`」，
> 随后实测发现链 A 的 MCP 资源工具用的是 `{ permission: "read", patterns: ["mcp:<server>:*"] }`
> （`packages/opencode/src/session/tools.ts` 的工具注册与 `ctx.ask` 两处）——**那句总结是错的**，当场向用户更正。
> 更正后的实测反而定住了裁定：**skill 维上两条链同构**（上表最后两行），所以改词表可行。

#### 三条裁定（用户 2026-10-04）

| 问题 | 裁定 | 落地 |
|---|---|---|
| 词表冲突怎么办 | **改 T004 的 `resolve()`**（不改消费者） | `rbac.ts` 加 `TOOL_OF` 对照表；`action` 取工具名、`resource` 取 `resourceId` |
| 四个 `perm` 都进吗 | **只有 `read` 进 ruleset** | `if (grant.perm !== "read") continue`。写 / 审 / 管是管理动作，今天没有承载它们的工具；仍留在表里，记账为「无消费者」 |
| `mcp` / `knowledge_base` 投不到怎么办 | **跳过 ＋ 显式记缺口**（指向 T007） | `if (tool === undefined) continue` ＋ 测试 ③ 断言 `Object.keys(TOOL_OF) === ["skill"]` |

> ✅ **第三行里 `mcp` 那一半已由 T007 落地**（2026-10-05）：走 `sessionRuleset` 的 ② 段（名单由调用方给），
> `resolve()`/`TOOL_OF` 这条出口**仍然只认 skill**（上表那行断言照旧成立、未被作废）。
> `knowledge_base` 仍无承载它的工具 —— 真缺口。

#### 测试与变异（照 `LEARNINGS #003-02`：把修复本身当新代码再审一轮）

测试 `test/access-rbac.test.ts` **7 → 8 条**（重写 ①②④⑤⑥⑦⑧、新增 ③ 缺口断言）。三个变异**全部恰红目标**：

| 变异 | 红 |
|---|---|
| M1 去掉 `perm !== "read"` 守卫 | **恰红 ②**（1 条） |
| M2 去掉 `tool === undefined` 守卫 | **恰红 ③**（1 条） |
| M3 `resource` 写死成 `resourceType` | 红 **5** 条，含专为「写死 resource」设计的 ④ |

均回退，`grep MUTATION` / `grep 'if (false) continue'` 无残留，复跑 8 pass。

#### 门禁（串行，取退出码不进管道）

| 门禁 | 结果 | 与基线比 |
|---|---|---|
| `bun run typecheck` | **exit 0**（31/31） | 同基线 |
| `bun run lint:openhive` | **exit 0**，23 / 0 / 69 files / 161 rules | 与基线**逐字相同** |
| `bun run lint`（全局） | exit 1，**4942 warnings / 1 error / 3452 files** | 与 T004 后基线**逐字相同**；改动 2 文件定向复核 **0 命中 / 0 errors** |
| `packages/core` 004 三个测试 | **exit 0，16 pass / 0 fail** | capability 4 ＋ issue 4 ＋ rbac 8 |

#### 🔴 挂账的缺口（**不是**「已覆盖」）

`mcp`（FR-005，归 **T007**）与 `knowledge_base` **今天投不到任何能命中的工具断言** ⇒ 不产规则、
落回上游兜底 `ask`（保守：不会误放行，但**也不生效**）。这条缺口**写进了 `rbac.ts` 的 `TOOL_OF`
注释**，并由 `access-rbac.test.ts` 的 ③ 钉在明面上——将来接上 mcp 必须**同时**改那张表和那条断言
（`LEARNINGS #002-02`）。另：`write` / `review` / `admin` 三个 `perm` 今天**没有消费者**，同样挂账。

---

### T006 · 工具执行守卫（**链 A 那一半**）（FR-004 / FR-002）

#### 这一段做了什么

把「**授权行 → 会话规则集 → 链 A 的判决器**」接成一条直线。链 A（opencode v1）的 `evaluate`
读 `session.permission`，所以 capability 的落点就是**会话创建时把它写进去**（裁定 ②）。

```
auth.role_resource ──join──> grantsFor()   ──> AccessRbac.resolve() ──> AccessSession.sessionRuleset()
   (PG, auth 包)              (auth 包)              (core, 纯函数)            (core, 纯函数)
                                                                                    │
                             handlers/session.ts create ──────────────────────────────┘
                                        │  并入（客户端规则在前）
                                        ▼
                              session.permission  ──> evaluate() ──> deny / allow / ask
                                 (每用户 sqlite)      (上游，未改)
```

**为什么判定放 core**（不是放 `src/server/openhive/`）：`prompt.ts` 也要用它，而 `src/session`
引 `src/server` 是**今天不存在的方向**（实测 0 条 `src/session|tool|agent → @/server` 的 import）。
D0-1 也已裁定判定归 core。core **碰不到库**（实测 `packages/auth/package.json` 的 deps 只有
`drizzle-orm` / `hono`），所以取行那半步留在 auth（`grantsFor()`），接线留在
`packages/opencode/src/server/openhive/access.ts`（**全仓只有它同时依赖 auth 与 core**）。

#### 产出（提交分片）

| 提交 | 内容 | 性质 |
|---|---|---|
| `feat(004): T006 会话规则集判定` | `core/src/access/session.ts`（新增）＋ `core/src/access/rbac.ts` | openhive 定制新增 |
| `feat(004): T006 取授权行 grantsFor` | `auth/src/rbac.ts` ＋ `rbac.test.ts` | 加，非改 |
| `test(004): T006 auth 夹具拆出 start/stop` | `auth/src/test-support.ts` | 夹具重构 |
| `feat(004): T006 capability 取数接线` | `opencode/src/server/openhive/access.ts`（新增） | openhive 定制新增 |
| `feat(004): T006 接入 capability ——【保留的定制】` | `handlers/session.ts` / `session/prompt.ts` / `session/session.ts` | **改上游三文件** |
| `test(004): T006 验收` | `openhive-access.test.ts`（9 条）＋ `openhive-access-wiring.test.ts`（3 条） | 新增 |
| `test(004): T006 tenant-db-isolation 适配新契约 ——【保留的定制】` | `test/server/tenant-db-isolation.test.ts` | **改上游测试文件** |

#### 顺手堵掉的两条**客户端可自批**的越权路

`session.permission` 有**三个**客户端够得着的写入口，原来是三个都能把 capability 抹掉：

| 入口 | 上游原来怎么写 | 后果 | 改法 |
|---|---|---|---|
| `POST /session`（`CreateInput.permission`） | 客户端值直接落库 | 自带 `allow skill:*` | 客户端在前、capability 在后 |
| `PATCH /session/:id`（`update`） | `Permission.merge(current, payload)`（**payload 在后**） | 同上 | 改 `mergeClientRules(payload, current)` |
| `POST /session/:id/prompt`（`input.tools`） | 非空时**整体覆盖** `session.permission` | `tools: { skill: true }` | 并入且客户端规则在前 |

另约 **14 处 `Permission.merge` 调用点未动** —— 逐个读过，它们本就已把 `session.permission`
放在最后（`findLast` 后者胜），没有越权面。**不做无差别改写**（Surgical Changes）。

#### 验证

**变异验证**（`LEARNINGS #003-03` 的三类据实记）：

| 变异 | 结果 | 类别 |
|---|---|---|
| M1 去掉 `create` 里那句 merge | wiring **3 条全红** | ② 整组红（含对照）—— 去掉的正是三条共同断言的东西，符合预期 |
| M2 并入顺序反（capability 在前） | wiring **恰红 1 条**（客户端绕过那条） | ① 恰红目标 |
| M3 删掉 `mergeClientRules` 的去重 | 纯函数 **恰红 1 条**（幂等那条） | ① |
| M4 `GOVERNED` 加 `"mcp"` | **恰红 1 条**（⑥ 键集同步） | ① |

**关键的前后对照**（不是「跑绿了」而是「跑红过」）：`tenant-db-isolation.test.ts` 在**加夹具之前**
4 fail（`POST /session` 500），加夹具之后 4 pass ⇒ 那个夹具**真的供上了**新契约，不是摆设。

`openhive-access-wiring.test.ts` 的判据**不经过被测接口**：会话建完后直接读**库文件**里的
`permission` 列（`packages/core/src/session/sql.ts` 的 JSON 列），再拿链 A **真正的判决器**
`evaluate` 去问放不放。从 `GET /session/:id` 读等于拿被测对象证明被测对象（`LEARNINGS #002-02`）。

#### 门禁（2026-10-04 复跑，串行）

| 门禁 | 结果 | 与基线比 |
|---|---|---|
| `bun run typecheck` | **exit 0**（31/31） | 同基线 |
| `bun run lint:openhive` | **exit 0**，23 warnings / 0 errors / 69 files / 161 rules | 与基线**逐字相同** |
| `bun run lint`（全局） | exit 1，**4941 warnings / 1 error / 130 rules / 3456 files** | 全局恒红；文件数 3452 → 3456（＝新增 4 个 `.ts`）。⚠️ warnings **4942 → 4941**：名称级差集查明消失的是 `packages/llm/src/tool-runtime.ts:63:44` —— **我没碰过的文件**，且无任何新条目出现，是 `#001-01` 记的 12 线程 ±1 抖动。**改动的 12 个文件里，上游三文件各带 1~3 处既有 warning，全部落在未触及的行**（`handlers/session.ts:426`／`prompt.ts:653`／`session.ts:13,14,15`），我用 `git diff -U0` 的 hunk 范围逐个核对过：我的改动行在 163-177·218-221／1061-1074／701-705（⚠️ 这是 **T006 阶段的快照**——T007 起 `prompt.ts` 等又被改过，行号**已漂**；复核请重跑 `git diff -U0 <merge-base>`，勿照抄这串数字，`#002-06`）。 |
| `packages/auth` 全量 | **exit 0**，**213 pass / 1 skip / 0 fail** / 214 tests / 18 files | T004 后基线 210/1/0 → **＋3 pass，恰是本次 3 条 rbac 用例** |
| `packages/core` 影响面 | `access-rbac` ＋ `access-issue` ＋ `access-capability` **exit 0，16 pass / 0 fail** | 按 `#003-01`「改动影响面所在的测试文件全绿」 |
| `packages/opencode` `test/server/` | **380 pass / 23 skip / 1 fail** / 404 tests / 60 files | 唯一那条红 `file HttpApi > serves search endpoints` **正是开工基线 14 条之一**（类别「时序 / 子进程 / 快照」）⇒ 差集为空 |
| `bun.lock` | `git status` 无该文件改动 | 未跑 `bun install` |

⚠️ **一次假红的教训（本次实测）**：我第一次跑 `bun test test/server/` **没带 `--timeout 30000`**
（基线一直带），得到 **371 pass / 10 fail / 1 error**，比真值多 9 条。带上正确参数后是
**380 pass / 1 fail**。**但那 10 条的名字没留下**（后台作业被中止、`grep` 块缓冲没落盘），
所以「多出来的是超时」**是推断不是实测** —— 据实记：**同一目录、命令少一个参数，红数从 1 变 10**；
判据一律以带 `--timeout 30000` 的那次为准。这条正是 `#001-01`「报门禁数字前先真跑一次」的另一面：
**不只是「要跑」，还得「跑对命令」**。

#### 📤 显式挂账（**不写成「已覆盖」**）

1. **链 B**（core v2 / CLI·sdk-next）尚未接 —— 用户 2026-10-04 裁定。
2. **审计**（留痕）未做 —— 用户裁定「只做『拒』」，落点 F10。
3. **存量会话**（本次改动之前建的）的 `permission` 里没有 deny；fork 那个补丁也**不覆盖**存量会话。
4. **进程内 `approved` 可压过 capability deny**（实测，不是推测）：
   `packages/opencode/src/permission/index.ts` 里那次调用是
   `evaluate(request.permission, pattern, ruleset, approved)`，而 `evaluate` 取 `findLast`
   ⇒ **`approved` 排在最后、它赢**。`approved` 是 `InstanceState` 里的**进程内**数组（同文件，
   随实例销毁而失，**不落库**）。要出现这个洞，需要同一进程里先有一条 `ask`（= 当时没有 deny 盖住它）
   被点过「总是允许」——**门关着跑过 dev、或升级前的旧会话**都能造出这样一条。
   **不跨进程存活**，但同一进程内它对本 capability deny 全权生效。
   触发条件与判据逐字记在此处，不假装闭合。
5. `write` / `review` / `admin` 三个 `perm` 今天仍无消费者；`mcp` / `knowledge_base` 仍投不到
   工具断言（归 T007）—— 同上，落回 `ask`，**不生效但不误放行**。
   > ✅ **本条的 `mcp` 一半已由 T007 落地**（2026-10-05）：不在 `resolve()`/`TOOL_OF` 那条 v2 出口上，
   > 而是走 `sessionRuleset` 的 ② 段（名单由调用方给）。`knowledge_base` 仍是缺口（链 A/链 B 都没有承载它的工具）。

---

### T005 · 技能目录可见性 ＋ 模型侧工具清单（FR-003 / SC-003）

**一句话**：T005 的字面出参（无权工具不出现在模型拿到的 `tools` 里）**不用新写代码**——T006 的
通道顺带做成了；T005 要做的是**把最后一个会话级可见性出口（系统提示词里的技能目录）也接到同一判据上**，
并用测试把这条不变式钉死。

#### 1. 前置实测：字面出参已经打得到（否则要去建 `tool-filter.ts`）

D0-1 已裁定 `plan.md` 里 `tool-filter.ts` 那条路径**判空**（链 A 的上游 `Permission.disabled` 就是
过滤点）。本次实测确认搬运通道完整：

```
session.permission（T006 在 create/update/prompt/fork 四处写入 capability）
  → SessionTools.resolve 把它交给 registry.tools + ctx.ask
  → prompt.ts 当 permission 传进 process → llm.stream
  → LLMRequestPrep.prepare → resolveTools
      Permission.disabled(Object.keys(tools), Permission.merge(agent.permission, input.permission ?? []))
```

⇒ **无需「加」任何东西**，字面出参今天在仓库里打得到（Step 0.5 的那句「出参今天能不能打到」的答案）。

#### 2. 缺口：唯一一个**不读 capability** 的会话级出口

| 出口 | 位置 | 吃什么 | 今天跟不跟 capability |
|---|---|---|---|
| 模型侧工具清单 | `session/llm/request.ts` `resolveTools` | `agent.permission` + `session.permission` | ✅ 跟（T006 通道） |
| 系统提示词技能目录 | `session/system.ts` `skills` | **只读 `agent.permission`** | ❌ **不跟**（本次修） |
| MCP 指令 | `session/system.ts` `mcp` | `agent.permission` + `permission?` | ✅ 跟（上游本就带参） |
| `GET /skill` | `server/.../handlers` | 全局技能列表 | ⛔ 非会话作用域（挂账） |
| `GET /experimental/tool` | 同上 | 全局工具列表 | ⛔ 非会话作用域（挂账） |

后果：零授权的民警**看不到 `skill` 工具、提示词却照样列出全部技能**，还写着「用 skill 工具加载技能」
——提示词与工具清单互相打架，模型会去调一个不存在的工具。形状即 `#003-05` 的**假镜像**：
同一个判断在两处各写一份，一处跟 capability、一处不跟。

#### 3. 修法（用户 2026-10-05 裁定：甲）

**不改「再写一套判据」，改「两处用同一个」**：`skills(agent, permission?)` 的判据写成与 `resolveTools`、
与同文件 `mcp()` **逐字同款**——同一个 `Permission.disabled`、同一个合并顺序
`merge(agent.permission, permission ?? [])`（capability 在后 ⇒ 后者胜）。

不变式：**目录可见 ⟺ `skill` 工具可见**（同一个 helper、同一个顺序、同一个 `findLast`）。

改动（**两处均为上游文件**，各自单独提交并标【这是要保留的定制】）：

| 文件 | 改动 | 提交 |
|---|---|---|
| `src/session/system.ts` | `skills(agent, permission?)` 判据改为同款；接口签名加参 | `310cda0d83` |
| `src/session/prompt.ts` | 调用点传 `session.permission`（与紧邻的 `sys.mcp` 同形） | 同上 |
| `test/session/openhive-tool-visibility.test.ts` | 新增验收 6 条 | `b0b0a6cb3f` |

#### 4. 验收与变异

`test/session/openhive-tool-visibility.test.ts` **6 条**：
- 第 1 段（`SystemPrompt.skills`，走**真** `Permission.disabled`）：零授权 ⇒ `undefined`；授过一条 ⇒ 照旧；
  agent 自拒 ⇒ 照旧（上游行为不变）；**矩阵** 6 个 ruleset 断言「目录可见 ⟺ 工具可见」。
- 第 2 段（走**真** `LLMRequestPrep.prepare`）：零授权 ⇒ `skill` 不在 `tools`、`bash` 照旧在；授过一条 ⇒
  `skill` 照旧在。（这段是**钉现状**，不是 TDD 红——把 T006 的通道钉住，断了它会红。）

| 变异 | 操作 | 结果（实测） |
|---|---|---|
| **M6** | `skills` 改回只读 `agent.permission` | **恰红 2 条**（零授权 / 矩阵） |
| **M5** | `resolveTools` 的 `input.permission` → `undefined` | **恰红 1 条**（只有「零授权」那条；「授过一条」照绿——据实记，非「两条都红」） |

#### 5. 顺带：发现并处置 **T006 的一条回归**

收尾跑 `test/session/` 时发现上游测试 **`prompt tools replace previous prompt tool rules`** 变红
（**不在**开工基线的 14 条红名单里）。根因（隔离复现）：T006 把 `prompt.ts` 的 `input.tools` 从
「整体覆盖」改成「并入」，而**该测试名与断言正是编码旧的 replace 语义** ⇒ 第二次 `prompt` 不再掀掉
第一次的 `bash: deny`。**T006 当时只跑了 `test/server/`，没跑 `test/session/`** ⇒ 漏网（呼应 `#003-01`：
受影响面选错）。

**用户 2026-10-05 裁定：保留 merge**（客户端一条 `tools:{skill:true}` 不得抹掉 capability；该安全属性
已由 `test/server/openhive-access.test.ts` 的「⑦ 客户端 allow 不得压过 capability deny」**单独钉住**，
不依赖这条上游测试）。据此把这条上游测试改为断言新契约并标【这是要保留的定制】（提交 `f114f00a7c`）。
**评估：需随 T006 契约适配的上游测试仅此一条。**

#### 6. 门禁（2026-10-05 实跑，**串行**）

| 门禁 | 命令 | 本次实测 | 判据 |
|---|---|---|---|
| 类型 | `bun run typecheck` | **exit 0**，31/31 tasks | 必须 0 |
| openhive lint | `bun run lint:openhive` | **exit 0**，23 warnings / 0 errors / 69 files / 161 rules | = 基线逐字相同 |
| 全局 lint | `bun run lint` | exit 1，**4942 warnings / 1 error** | = 基线**逐字相同**；新文件 0 命中、改动行 0 命中 |
| 受影响测试 | `bun test test/session/` | **408 pass / 20 skip / 1 todo / 1 fail** | 唯一红 = 开工基线已知的 `snapshot race`；总数 430 = 改前 430 |

> 全局 lint 里 `system.ts:122/138` 两条 `consistent-return`、`prompt.ts:653` 的 `unbound-method`、
> `prompt.test.ts` 十余条，**均在本次改动行之外**（行号为该次 lint 输出的原文快照；`system.ts:138` 那个函数本次根本没动，形状与
> `skills` 同款 ⇒ 证明该规则是文件既有性质，非本次引入）。warnings 总数与基线逐字相同 ⇒ **0 新增**。

#### 7. 挂账（据实记，不假装闭合）

1. **`GET /skill` 与 `GET /experimental/tool` 两个非会话端点**不吃 capability（本次判为 T005 范围外）。
   它们返回的是**全局**列表、不带会话作用域；要收口得先回答「这个端点代表谁、按哪条会话授权」——
   属接口设计问题，**显式挂账**。
2. **第 2 段那两条测试今天即绿**（钉现状，非 TDD 红）——已在文件注释里写明，证据是 M5 的恰红 1 条。
3. `skills` 判据走的是「整体 deny 才隐藏」（与工具过滤同款），**不是**「按名字 allow-list」——
   逐条授权由**执行期** `evaluate` 兜底（T006）。这是**有意**与工具过滤保持一致，非缺陷。

---

### T007 · MCP 端带身份 ＋ capability 的 mcp 投影（FR-005；FR-006 的**连接级**那一半）

#### 1. 这一段做了什么（两半，各自有自己的出参）

| 半 | 出参 | 落点 |
|---|---|---|
| ① 身份注入 | 出站 MCP 请求带 `_meta["openhive/user"]`（server 工具的 `tools/call` ＋ 资源工具的 `resources/read`） | `src/mcp/openhive-identity.ts`（新）＋ 上游三处加**可选** `meta` 参数 |
| ② 未授权 server 堵法 | capability 里为**每个** server（含未授予的）出一对规则：授过 = allow、未授 = deny | core `access/session.ts` 的 ② 段 ＋ `src/server/openhive/access.ts` 的名单 |

「受限数据库账号 + GRANT/RLS」（FR-005 的**另一半**）本机打不到 ⇒ **挂账 F6/F7**，见 §8。

#### 2. 四条裁定（用户 2026-10-04 / 10-05）

1. **身份载体 = 调用点直读 `User`**（`Effect.serviceOption(User.Service)`），不读 session `metadata`
   —— 那是**客户端可写**的（伪造身份）。
2. **未授权 server 的堵法 = capability 里加 server 名单**：名单取 `Config.mcp` 的键，sanitize 后
   为每个 server 铺一对规则（未授 = deny）。
3. **名字翻译 = core 出形状、opencode 出名字**：`sessionRuleset(grants, mcpPrefixes)` 收的是调用方用
   **真** `McpCatalog.sanitize` 算好的前缀 ⇒ core 里**没有**一份复制来的 sanitize（`#003-05`）。
4. **T007 只做今天打得到的那一半**（受限 DB 账号 ＋ GRANT 挂账 F6/F7）；T006 的回归**保留 merge**、改上游测试。

> ⚠️ 早先框定的「把 `TOOL_OF` 升为函数」**作废**：落地是上面第 3 条的「core 出形状 ＋ 调用方出名字」，
> 比升成函数更彻底——core 侧连一个可漂移的字符都不留。

#### 3. 落地（提交分片）

**上游文件**（各自【这是要保留的定制】、**单独提交**）：

- `src/mcp/catalog.ts` — `convertTool()` 加第 4 参 `meta`，写进出站 `tools/call` 的 `_meta`；
  `meta` 为空时**连键都不多一个**。
- `src/mcp/index.ts` — **两处**：`Interface` 的 `readResource` **声明** ＋ `layer` 里的**实现**都加
  第 3 参 `meta`（为什么两处都要，见 §5）。
- `src/session/tools.ts` — `const mcpMeta = yield* userMeta()`，**取一次、两个 MCP 出口共用**
  （server 工具 ＋ 资源工具）。**不是**在工具 `execute` 里各取一次：那是同一判断写两份。

**openhive 自有**（不碰上游领地）：

- `src/mcp/openhive-identity.ts`（新）——`USER_META_KEY = "openhive/user"` ＋ `userMeta()`。
  文件头记了三条判据：`_meta` 是 schema 合法的透传字段（两边都是 `z.core.$loose`）；
  为什么要**按调用**注入（按目录缓存的 client 是**实现产物**、不是协议保证）；
  为什么**没有身份就不注入**（不是注入一个空身份）。
- `packages/core/src/access/rbac.ts` — 新增常量 `READ`（`resolve()` 与 `sessionRuleset` 的 mcp 段
  都用它筛授权行：两处各写一个 `"read"` 字面量就是「同一判断两份」的最小形态）。
- `packages/core/src/access/session.ts` — 新增 `McpServerNaming` ＋ `sessionRuleset()` 的 ② 段。
  **`mcp` 省略时与 T006 逐字相同**（既有调用点 `src/session/prompt.ts` 不传它 ⇒ 零回归）。
- `src/server/openhive/access.ts` — `toolPatternOf = (server) => McpCatalog.toolName(server, "") + "*"`
  （**故意**拿真函数取前缀，而不是自己拼 `sanitize(server) + "_"`）＋ 名单取 `Config.mcp`。

#### 4. 两个关键技术判断（都是实测逼出来的）

**① MCP 的两个出口在链 A 里是两条权限通道，形状不同**（`src/session/tools.ts` 实测）：

| 出口 | `ask` 的 permission | 能不能隐藏 | 本 task 怎么管 |
|---|---|---|---|
| server 工具 | **工具名**（`sanitize(server) + "_" + sanitize(name)`） | 能（`disabled` 查得到） | `{permission: <toolPattern>, pattern: "*", action}` |
| 资源工具 | `read`，pattern `mcp:<原样 server>:*` | **不能**（归一成 `read`，隐藏会连累读文件） | `{permission: "read", pattern: "mcp:<server>:*", action}` |

⇒ 每个 server 出**两条**同向规则。⚠️ **只 deny 是半条**：MCP 工具的 `ask` 带 `always: ["*"]`，
授过的 server 若不显式 allow，一样会弹「总是允许」（放行侧的洞，与 T006 那段同形）。
「资源工具**可见但不可用**」是**取舍、不是遗漏**，已用测试钉住（`openhive-access-mcp.test.ts` 的可见性不对称那条）。

**② 名单从 `Config.mcp` 来，不从 `MCP.status()` 来**：capability 是**建会话那一刻冻结**的规则集；
按运行时连接状态取名单会让它随「谁先连上」而变，且把建会话绑到 MCP 连接上（迟到、甚至挂住）。
配置是声明式、稳定、**权威**的——能不能连上是 MCP 自己的事，**能不能调**由这里说了算。

#### 5. ⚠️ 途中修错：typecheck 首跑 3 条**真错**（不是回声）

`bun run typecheck` 第一次退出 2，报：

- `src/server/openhive/access.ts(76,5)`：`Type 'Effect<…, never, Service>' is not assignable to 'Effect<…, never, never>'`
  ⇒ **`capabilityFor()` 的出参类型里没写出 `Config.Service` 这个需求**（T007 起 capability 依赖配置）。
  修法是把需求**写进类型**，不是补 cast：那条红正是「capability 现在依赖配置」唯一会被编译器看见的地方。
- `src/session/tools.ts(355,80)` ＋ `test/mcp/openhive-mcp-identity.test.ts(71,77)`：`Expected 2 arguments, but got 3`。
  **一个根因**：`MCP` 的 `Interface.readResource` **声明**只有两个参数。实现里多一个**可选**参数
  照样满足旧签名 ⇒ 编译器**不在实现处报错，只在调用点报错**。
  ⇒ 教训：改「实现 ＋ 契约」这类成对的东西时，**契约那一侧漏改只会以调用点的形式报警**
  （与 `#002-06`「改完一处，立刻 grep 谁引用了我刚改掉的东西」同型；这里引用者是**调用点**）。
  修完复跑：**31/31 exit 0**。

（同一次首跑里 `packages/core` 与其余 29 个 task 全绿——不是环境回声，是真错。）

#### 6. 测试（24 pass，四层各有一组，**每组都带对照**）

| 文件 | 条数 | 测哪一层 |
|---|---|---|
| `test/session/openhive-mcp-identity.test.ts` | 2 | 真 `SessionTools.resolve` ＋ 真 `convertTool`，**假 client 只记出站参数** |
| `test/mcp/openhive-mcp-identity.test.ts` | 2 | 真 `MCP.Service` ＋ **进程内** streamable-HTTP 服务器记 `resources/read` 的参数（线上可见） |
| `test/server/openhive-access-mcp.test.ts` | 10 | 纯函数 ＋ 链 A **真判决器**（`evaluate` / `Permission.disabled`） |
| `test/server/openhive-access-mcp-wiring.test.ts` | 1 | 真应用 ＋ 真 PGlite，**直接读库里的 `permission` 列**（不经过被测接口） |

- 🔴 **对照是这一组的骨架**：每组都有一条「**没有身份 ⇒ `"_meta" in params === false`**」——
  钉的是「不注入」，不是「注入空身份」（后者在服务器侧看起来一样、语义不同）。
- RED 观察（据实记）：临时回退 `mcp/index.ts` 的两处 ⇒ 线路那 2 条红（`_meta` 为 `undefined`）而 `uri` 匹配；
  把 wiring 的两条 mcp 规则去掉 ⇒ 那条断言红。
- 可见性矩阵里专门有**一条**钉住 §4-① 的不对称：server 工具被**藏**、资源工具**藏不了但执行被拒**。

#### 7. 门禁（2026-10-05 实跑，**串行**）

| 门禁 | 命令 | 本次实测 | 判据 |
|---|---|---|---|
| 类型 | `bun run typecheck` | **exit 0**，31/31 tasks（首跑 3 条真错 → 修 → 复跑 0，见 §5） | 必须 0 |
| openhive lint | `bun run lint:openhive` | **exit 0**，23 warnings / 0 errors / 69 files / 161 rules | = 基线**逐字相同** |
| 全局 lint | `bun run lint` | exit 1，**4949 warnings / 1 error / 3462 files** | 唯一 error = 既有上游 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`（裁定不私改）；**新文件 0 命中、改动行 0 命中** |
| MCP 目录 | `bun test test/mcp/` | **67 pass / 0 fail** | 全绿 |
| 受影响测试 | `bun test test/session/` | **407 pass / 20 skip / 1 todo / 4 fail**（432 总） | 4 条红**全是 5 秒线超时**，见下方⚠️ |
| core RBAC | `bun test test/access-rbac.test.ts` | **8 pass / 0 fail** | 全绿 |

> ⚠️ **`test/session/` 那 4 条红**：名字是 `glob tool keeps instance context during prompt runs`、
> `restore messages in sequential order`、`restore same file in sequential order`、
> `tool execution produces non-empty session diff`；耗时 **5001 / 5008 / 5030 / 5013 ms**（不是断言失败，是 5 秒预算）。
> **对照**：把 `session/tools.ts` 里的 `mcpMeta` 临时中性化成 `undefined`（=`meta` 永不注入）后，
> **逐个文件复跑，同样这 4 条、同样 5.00–5.20s** ⇒ **与 T007 无关**（`#003-01` 那一类：先怀疑测量）。
> 据实记的**残差**：T005 收尾时同目录是 `408 pass / 20 skip / 1 todo / 1 fail`（唯一红 = 已知 `snapshot race`），
> 本次多出的 3 条**我没能归零**，只能记「中性化对照复现 ⇒ 非 T007 引入」＋「本机当前整体偏慢」；
> 总数 430 → 432 恰是本次新增的 2 条用例（`+2` 对得上）。
> 全局 lint 的 warnings 总数在 **4941–4949** 之间抖动（12 线程，`#001-01` 已记 ±抖动）⇒ 判据是
> **名称 ＋ 文件行**：逐条核过 7 处命中（`tools.ts:18/23` 未用导入、`mcp/index.ts:23 FSUtil`、`:123`、`:341`、`:479`、
> `catalog.ts:66` 既有断言），**全在未改的上游行上**。

#### 8. 📤 显式挂账（**不写成「已覆盖」**，`LEARNINGS #002-02`）

1. **受限数据库账号 ＋ `GRANT` / RLS**（FR-005 的另一半）：本机无 PG / Docker，且「按用户的受限账号」
   要等数据项目（F6/F7）落地 ⇒ **整条挂账 F6/F7**。今天做到的是**连接级**（谁能调）＋ **请求级**（带谁的身份）。
   > ✅ **前向指针（2026-10-05 补）**：**机制那一半已由 T008 补上**（`packages/auth/src/rls.ts` 契约 ＋
   > 见证测试）。**落地那一半**仍归 F6/F7（接收行在其 `tasks.md` 文件头）。见下方 T008 段。
2. **`POST /mcp` 运行期加的 server**：该端点只写 `InstanceState`、**不回写配置** ⇒ 不在 `Config.mcp` 名单里
   ⇒ 它的工具落回上游 `ask`（不再被 capability 兜住）。**同一端点还接受 `type:"local"`**（= 任意进程）
   且只受上游 basic `Authorization` 管 —— **上游既有洞，本次只上报、不修**（本 task 范围外）。
3. **`src/tool/code-mode.ts` 的第二处 `callTool`**：那条路从 `resolve()` 提前 return（`flags.experimentalCodeMode`），
   **不走**本次的身份注入 ⇒ 该模式下 MCP 调用不带身份。该开关是 env 门、默认关。
4. **链 B（v2 / CLI·sdk-next）的 MCP** 至今没有消费者 ⇒ 那一半仍是缺口（同 T006 挂账 ①）。
5. **资源工具无法隐藏**（`Permission.disabled` 把三个 `*_mcp_resource*` 归一成 `read`）：
   未授权 server 的资源**可见但不可用**。这是取舍（隐藏会把民警读文件一起拒掉），已在代码注释与测试里写明。


（无技术阻塞。**D-05 已解**（2026-10-04，见 T015 段）——原「待裁一项：D-05 须在 T004 之前裁定」**已消**，
T004 现无前置。）

⚠️ **新增运行期契约（T006，2026-10-04）**：**身份门开着 ⇒ 建会话必须连得上 auth 库**。取不到授权
= 不建会话（fail-closed）。**凡建真应用（`HttpApiApp.routes`）的测试，都要像真部署那样把 PG 与
`OPENHIVE_DEFAULT_PASSWORD` 配齐** —— 落点见 T006 段，先例是 `openhive-bootstrap.test.ts`。
后续 task（T007 / T008 / T012–T014）开工前先读这条。

### T008 · 业务数据 PG 行级 RLS（FR-006 的**行级**那一半）—— 机制在此定义，落地移交 F6/F7

#### 1. 裁定「甲」（用户 2026-10-05）

出参「越权行被 RLS 过滤」**今天在仓库里打不到**：业务库 / 业务表 / 成员表 / 受限账号**全部不存在**，
`spec.md` 自己写着「业务数据的 RLS 落地依赖 F6/F7 的数据项目成员表，**本 feature 定义权限机制**」。
⇒ 用户裁定**甲**：**机制**在本 feature **定义**并**本机可验证**；**落地**（建表 / 建策略 / 建角色 /
GRANT）**移交 F6/F7**（接收行落进对方的 `tasks.md` 文件头，`#002-04①`）。
同 T007 的处置：**只做今天打得到的那一半**。

#### 2. Step 0.5 实测（动第一行代码前）

- `fund_project_member` / `call_project_member` / `project_member` 在 `packages/**` 下**零命中**
  （全仓没有任何业务数据表的迁移或 schema）。
- `packages/core/src/access/capability.ts` 已把「数据项目成员」规则记为 **F7 的**。
- 本机无 Docker / PG 二进制（`#002-05`）。**PGlite 探针实测**：`CREATE ROLE` / `GRANT` /
  `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` / `SET LOCAL ROLE` / `set_config(…, true)` **全部真跑**；
  连接用户 `rolsuper = true` ⇒「owner / superuser 绕过 RLS」这一层**也量得到**。
  ⇒ 机制**本机可验证**这个前提，是**量出来的**，不是假设的。

#### 3. 落点（为什么在 auth，且不新建包）

`packages/auth/src/rls.ts`（契约常量 `IDENTITY_SETTING` ＋ 文件头承载**策略模板**与**四条不变式**）
＋ 同目录 `rls.test.ts`（见证测试）。依据：① `@electric-sql/pglite` **只**装在 auth（devDependency）；
② **auth 不 import core**（实测）⇒ 放 core 会造一条今天不存在的边；③ auth 的 `policy.ts` +
`policy.test.ts` 是本仓「契约常量模块 ＋ 同目录测试」的**先例**。
⇒ **不新建包、不写投机 SQL 构造器**（D0-3 裁定的反面）。
⚠️ 产品代码里**不落任何业务表或策略迁移**：本仓没有业务库迁移目录，auth 的 `src/migrations/` 是
**auth schema** 的 —— 两者是**两个库**（design-v2 §12.1）。

#### 4. 契约内容（`rls.ts` 文件头，F6/F7 照抄）

- **身份通道**（与 T007 的接缝）：`_meta["openhive/user"]`（T007 已交付）→ MCP server 在**同一事务内**
  `SET LOCAL ROLE <受限账号>` ＋ `set_config('openhive.user_id', <该 id>, true)` → PG RLS。
  两端名字**故意不同**（`_meta` 键 ≠ GUC 名）——写成同一个字符串是**假镜像**（`#003-05`）。
- **策略模板**：账号级（每个角色一个 `NOLOGIN` 账号 ＋ 最小 `GRANT`）＋ 行级
  （`ENABLE ROW LEVEL SECURITY` ＋ `CREATE POLICY … USING (<项目列> IN (SELECT … WHERE user_id =
  current_setting('openhive.user_id', true)))`）。判据是「**行所属项目 ∈ 用户是成员的项目**」，
  **不是**「这一行是谁建的」。
- **四条不变式**：① 受限账号不得是表 owner / superuser / `BYPASSRLS`；② 无身份 ⇒ 空集；
  ③ 必须**双向**验证；④ 身份必须**事务作用域**。
- GUC 名 `openhive.user_id`：**带命名空间前缀**（PG 对未注册的带前缀 GUC 任何角色都能 `SET`，
  实测受限账号设得进去）。

#### 5. 见证测试（7 条，`rls.test.ts`）

①正向成对（alice→[1,2] / bob→[3]）②反向（互不可见）③无身份 ⇒ 空集（含 carol 对照）
④**负对照**（连接用户看全 3 行）⑤作用域 ⑥无 GRANT ⇒ `42501` 非空集 ⑦GUC 名字面钉死。

> **为什么这组不是「新功能的红→绿」**：首次跑就绿**不构成证据**（`#002-02`：没执行过被测路径的测试
> 是缺口，不是覆盖）。**证据来自变异**（§6）。

#### 6. 变异（`LEARNINGS #003-03`：三类都要据实记，红集不许美化）

| 变异 | 改了哪条判据 | 红集 | 读法 |
|---|---|---|---|
| M1 | 不 `ENABLE ROW LEVEL SECURITY` | **恰红 ①②③⑤** | 策略没生效 ⇒ 全都不过滤 |
| M2 | `USING (true)`（过松） | **恰红 ①②③⑤** | 与 M1 **同集** |
| M3 | `USING (false)`（过紧） | **恰红 ①⑤**，②③ 绿 | 只有 ① 的**相等断言**抓得住「过紧」 |
| M4b | 身份改**连接级**、无事务 | **恰红 ③④⑤** | ③ 抓跨请求串号 |

- **M1 与 M2 同集** ⇒ 本组**区分不了**「没开 RLS」与「策略恒真」（两者含义都是「没过滤」）。据实记。
- **M3 只红 ①⑤** ⇒ **只有 ①**（`toEqual([1,2])` 这种**相等**断言）抓得住「把所有人拦死」；
  ②③ 用的是 `not.toContain` / `toEqual([])`，过紧时**照样绿**。这是 spec 风险 R3「必须双向」的**实证**
  —— 不是教条。
- **M4b 红 ③** 正是「跨请求串号」那条；④ 连带红是因为 readAs 不再复位 `SET ROLE`。
  ⚠️ M4b 的写法要点：`SET ROLE` / `SET`（**非** `LOCAL`）**在事务内也会被回滚** ⇒ 要真造出「连接级」，
  必须**在事务之外**设，否则量的不是那个轴（首跑 M4 因**忘了先还原 M3** 而红集错乱，已作废重跑）。

#### 7. 途中修错（都是**我引入的**，据实记）

- **⑤ 的「空串」断言写错了**：我原先断言「事务回滚后 `current_setting` 读空串」——实测在**该会话**
  已有连接级残留时，回滚后**回到残留值** `"alice"`，不是空串。按 `#002-03`：**改测试，不改产品假设**。
  改写成**两个实测事实**（在**新库**上量，避开残留）：① 从没设过 ⇒ `NULL`，设过又回滚 ⇒ **空串**；
  ② 🔴 **`LOCAL` 剥不掉上一层** —— 会话已有残留时，事务内 LOCAL 值回滚后**回到残留值**。
  ② 这条比 ①–⑤ 都隐蔽：它**静默地**让一个事务拿到「别人的身份」⇒「用 `SET LOCAL` 就安全了」是**错的**，
  前提是**连接本身干净**。已写进 `rls.ts` 不变式 ④ 与 F6/F7 的移交行。
- **`await expect(...).rejects.toThrow()`**：本包**两处先例**（`rbac.test.ts` / `migrate-cli.test.ts`）
  都**刻意避开**（`bun-types` 把 `.rejects` 声明成 `Matchers<unknown>` ⇒ `await-thenable` 命中）。
  改为本包既有的 `failure(run)` 辅助，并按探针实测把 ⑥ 钉到 SQLSTATE **字符串** `"42501"`
  （探针 `typeof` 量的：`code` 是 string、`cause` 是 undefined）。
- **`no-unsafe-type-assertion` / `no-unnecessary-type-conversion`**：`failure()` 首版用了
  `as unknown as Record<string, unknown>`、断言用了 `String(err.message)` ⇒ 两条 lint 命中。
  改用具名 `interface PgError extends Error { code?: string }` 与直读 `err.message`。
  ⇒ 两个新文件在**全局限 lint 下 0 命中**（本 feature 判据）。

#### 8. 门禁（2026-10-05 实跑，**串行**）

| 门 | 命令 | 结果 |
|---|---|---|
| 类型 | `bun run typecheck` | **31/31 exit 0**（auth 那条**真跑**，非缓存） |
| 新规 lint | `bun run lint:openhive` | **23/0 exit 0** = 基线（⚠️ 该门只覆盖 `packages/app/src/*`，**不含** auth ⇒ 它验不到本次文件） |
| 全局限 lint | `bun run lint` | exit 1（**既有**上游 error）；**新文件 `rls.ts` / `rls.test.ts` 0 命中**（判据） |
| 包测试 | `bun test`（in `packages/auth`） | **220 pass / 1 skip / 0 fail**（基线 213 ＋ 新 7） |

#### 9. 移交（接收方表已落，`#002-04①`）

- `007-fund-analysis/tasks.md` **文件头**：第二笔移交块（T001 建表时建角色/GRANT/策略；T006 走身份通道）。
- `008-call-analysis/tasks.md` **文件头**：同款块（同构）。
- ⚠️ 两块都点名了**跨 feature 语义冲突**（`#002-04③`）：007/008 的 T006 现写「带 **X-User-ID** + RLS」，
  而本仓 MCP **出站**身份载体是 **T007 的 `_meta["openhive/user"]`**（`X-User-ID` 是 **F3 的入站 HTTP 头**，
  方向不同）⇒ 需按 T007 更正。**只点出，不代改**（surgical）。

#### 10. 📤 显式挂账（**不写成「已覆盖」**，`LEARNINGS #002-02`）

1. **业务表 / 策略 / 角色 / GRANT 的落地**归 **F6/F7**（本机无 PG/Docker；无业务表可建）。
2. **PGlite ≠ 生产 PG 同版本同构建** ⇒ owner / superuser / `BYPASSRLS` / `FORCE ROW LEVEL SECURITY`
   这一层仍需 **CI 上的真实例**复核。见证测试钉的是「机制形状」，不是「生产构建」。
3. ~~**`packages/auth` 的测试不进 CI**~~ ❌ **这句是错的（2026-10-05 更正，R2）**：`turbo.json`
   有 `@opencode-ai/auth#test`（2026-09-30 由 `c013619ddc` 加入，**早于本 feature 的 merge-base**），
   CI 跑 `GITHUB_ACTIONS=false bun turbo test` ⇒ 本组测试**在 Linux 矩阵上真跑**。
   原句想说的「别把 CI 绿当成这组跑过的证据」，在**本机 win32 被 skip 的那些用例**上仍成立，
   但理由不是「CI 到不了」，是「本机环境验不了」（如 `workspace.test.ts` 的 `0700` 那条）。
4. **改 GUC 名要同时改 F6/F7 的策略 SQL**，而**策略侧不会红** ⇒ ⑦ 只把本仓这一侧钉死。
5. **结果量级**（LIMIT / 分页 / 导出）是 **T009**，不在本 task。

#### 11. 留给后续 task 的裁定点（**不自行拍板**，Step 2 ⑦）

- **T013**（「越权 SQL 被 RLS 拦截、拿不到无权数据行」）与 **T014**（安全测试）依赖 T008。按同一逻辑，
  它们的**链路出参**（真跑业务表的越权查询）今天**同样打不到** —— 能打的只有本 task 的**机制见证**。
  ⇒ T013/T014 到时是「标记机制已见证、链路验收移交 F6/F7」，还是另行处置，**到那一步再问**。

  ✅ **2026-10-05 已裁定**（用户选「甲」）：正是「标记机制已见证、链路移交 F6/F7」这一支。
  逐项记账见上文 `### T012–T014` 段。

### T009 · 结果量级控制（FR-006 **第四档**）—— **整条移交 F6/F7**（用户裁定「乙」）

#### 1. Step 0.5 实测（动第一行代码前）

| 实测项 | 结果（今天在仓库里打得到吗？） |
|---|---|
| 强制点在哪 | design-v2 §14.2 原话「**MCP 层**强制 LIMIT + 分页 + 导出需更高权限」 |
| 仓库里有 MCP **server** 吗 | **没有**。opencode 只是 MCP **客户端**（`McpServer` 是客户端状态类型，全仓零 server 实现） |
| 有业务查询路径吗 | 没有（无业务表、无业务 MCP；资金/话单查询 MCP 是 F6/F7 的 T006） |
| 有「导出」承载物吗 | 没有。`Perm ∈ {read, write, review, admin}`，且**只有 `read` 产生规则**（T004 裁定：不许发明没人请求的权限） |
| 有量级 / 分页的既有物吗 | 没有（`maxRows` / `pageSize` 零业务命中） |

⇒ 出参「超限查询被 LIMIT 拦截」**今天打不到**，**强制点全在 F6/F7 的 MCP server**。

#### 2. 裁定「乙」（用户 2026-10-05）：整条移交 F6/F7

**与 T008 的差别是裁定的全部理由**：

- T008 能走「机制在此定义」是因为背后有一个**真引擎**——PG 的 RLS 执行器，可以被**变异见证**
  （M1–M4b 各红一组，证明测试非空）。
- T009 **没有引擎可见证**：`LIMIT` 只是 MCP server **自己 SQL 里的一句子句**。写一条
  「`SELECT … LIMIT 10` 只回 10 行」的测试，是在**测 PG**、不是测我们的代码 —— **空断言**
  （TDD：测试立刻通过 ＝ 你在测既有行为）。⇒ 「机制见证」这条路**这次做不出非空版本**。
- 且「上限是多少」是**策略数字**，应由 F6 的性能目标（SC-001「200 万条秒级」）配套定；
  004 今天拍一个数＝**凭空发明**（Karpathy #2「Nothing speculative」的反面）。
- 先例：T010 / T011 同样因「无可测对象」整条移交（D0-4）。

> 被否决的另两条（据实记，供后来者）：**甲**（照 `session-quota.ts` 先例做 env 阈值纯函数模块）——
> 可测但**今天没有消费者**，落回 T004 `TOOL_OF` 那种「不生效的规则」（须显式挂账）；
> **丙**（在 `convertTool` 出口对 MCP 结果做**客户端**夹取）——是本仓可测的真行为，但要改上游文件语义，
> 且夹取发生在数据**已传回之后**（只减下游、不减数据库/网络负载），与 spec 的「**查**多少条」本意不符。

#### 3. 移交落点（`#002-04①`：落进接收方的表）

- `007-fund-analysis/tasks.md` **文件头**：**第三笔**移交块。
- `008-call-analysis/tasks.md` **文件头**：同款块。
- 落点任务 = 各自 **T006**（资金 / 话单数据查询 MCP）。
- 移交块里**特意写进了两条接手方容易漏的东西**：
  ① 上限数字**由接手方定**（配套性能目标），004 不凭空拍数；
  ② **导出权限怎么接进 004 的机制**：今天 `TOOL_OF`（core）只映射 `skill`、`read` 以外的 `perm`
  不产生规则 ⇒ 「导出」若做成工具，**要么走 mcp 段、要么给 `TOOL_OF` 加映射**，
  **两种都要改 004 侧代码**，不能只在 F6/F7 侧加个工具名（否则导出落回上游兜底 `ask`，**不报错也不生效**）。

#### 4. 📤 显式挂账（**不写成「已覆盖」**，`LEARNINGS #002-02`）

1. **FR-006 第四档（结果量级）在 F4 未实现、未验证** —— 整条在 F6/F7，且**本机连见证测试都没有**
   （理由见 §2）。**不得声称已在 F4 覆盖**。
2. tasks.md 的 Phase 4 与在册条数已同步（3 条移交 ⇒ 在册 12 条）。

#### 5. 门禁

本 task **无任何代码变更**（纯文档：两份接收方 tasks.md + 本 feature 的 tasks.md / state.md）
⇒ 门禁沿用 T008 末次结果（同一棵树，代码零差异）。**没有新代码就没有新门禁要跑**——
这一点据实说明，不假装又跑了一遍。可由 `git diff --stat` 自证：改动全在 `docs/`。

### T012–T014 · 安全测试（验收）—— 三条均按裁定「甲」**纯记账关闭**（零新增测试）

#### 1. Step 0.5 实测：这三条**今天在仓库里打得到什么**

「动第一行代码之前先问：这条 task 的出参今天打得到吗？」逐条量：

| task | 要的出参 | 今天打得到吗 | 依据 |
|---|---|---|---|
| T012「越权工具调用被拒」 | deny / AccessDenied | **打得到** | T006 的 12 条测试已在链 A 真判决器上钉住 |
| T012「审计留痕」 | 审计记录 | **打不到** | 审计**零实现**，且落点早由用户裁到 **F10**（T006 裁定 ②） |
| T013「越权 SQL 被 RLS 拦截」 | 无权行不可见 | **打得到**（机制） | T008 见证测试真跑 PG RLS 执行器 |
| T013 同一句的**链路** | A→网关→MCP→PG | **打不到** | 业务表 / 受限账号 / MCP server 都不存在（同 T008 Step 0.5） |
| T014「路径穿越」 | 穿越被拒 | **打得到** | 003 的 `anchor-workspace` / `tenant-directory-isolation` 已覆盖 |
| T014「SQL 注入」 | 注入串当字面量 | **打得到**（判据层） | `rbac.test.ts` 的参数化用例 |
| T014「未授权直连」 | 直连被拒 | **打不到** | 部署属性（design-v2 §14.4 ①：零对外端口） |
| T014「越权读他人数据」 | 读不到别人的 | **会话/文件打得到；业务行级打不到** | 会话/文件 = 003 那两条；业务行级 = 同 T013 链路 |

#### 2. 裁定「甲」与其理由

**用户 2026-10-05 裁定「甲」：纯记账关闭，不新增任何测试。**

- 可测的那一半，**已经有测试**（T006 / T008 / 003 的同类）⇒ 再写一条就是**重复**，
  且新写的会在**第一次跑就绿**（TDD 纪律：那不算证据，`LEARNINGS #002-02`）。
- 不可测的那一半**没有对象**：审计（F10 落地物）、链接级越权（F6/F7 落地物）、
  未授权直连（部署形态）。**凭空补一条 = 测一个不存在的对象**。
- ⇒ 这三条的**正确交付物是「记账」**：把「哪一半被谁覆盖、哪一半是缺口」写清楚，
  而不是制造「全通过」的假象。这也正是 `LEARNINGS #002-02`（「测不了」要写成缺口、
  不是覆盖）与 `#003-04`（「实测」必须当场复现才落笔）要求的做法。

> 另两条被否方案（据实记）：**乙（只关 T012，T013/T014 照写）** 会把「无对象可测」那几条
> 写成空断言；**丙（三条全移交给 F6/F7/F10）** 的落点分散在三个 feature、且 T014 的路径穿越/
> SQL 注入两半**本就在 004 打得到**，整条移交会把已有的证据也一并推走。故取**甲**。

#### 3. 逐项证据索引（**名字级**，不写行号 —— `LEARNINGS #002-06`）

- **T012「拒」**：`packages/opencode/test/server/openhive-access.test.ts` ①「授 skill 读 ⇒ 先整体
  deny、后逐条 allow」/ ②「零授权 ⇒ 仍有一条整体 deny（不是空集，否则落回可自批的 ask）」/
  ③「用链 A 真判决器验：授过的是 allow、没授的是 deny（不是 ask）」/ ⑦「客户端 tools 里的 allow
  不得压过 capability 的 deny」＋ `openhive-access-wiring.test.ts` 3 条（真应用 + 真库）。
- **T012「审计」**：**挂账**，落点 F10（T006 裁定 ②）。**不写成已覆盖。**
- **T013「机制」**：`packages/auth/src/rls.test.ts` ①「授过的项目：用户只看得到自己是成员的那些行」/
  ②「换一个身份，别人的行一行都看不见」/ ③「无身份 ⇒ 空集（fail-closed…）」（PGlite 真跑 RLS 执行器,
  M1–M4b 变异验过会红）。**T013「链路」**：**挂账**，落点 F6/F7 的 T001 + T006（三笔移交块已落）。
- **T014「路径穿越」**：`packages/opencode/test/server/anchor-workspace.test.ts`（**003 的** T006）
  › `describe("非法 user id 拼路径（R-05）")`：对照组 `it.live("正常 UUID：URL 与头都被改写成自己的沙箱")`
  ＋ 7 条 `it.live("id = … ⇒ 拒绝（不放行、也不锚到沙箱外）")`（`HOSTILE_IDS` = `../bob` / `a/b` /
  `a\b` / `/abs` / 空串 / `.` / `..`）；另 `tenant-directory-isolation.test.ts`（**003 的** T013）
  › `describe("跨目录隔离（T013 · FR-010 / SC-001 / SC-003）")` 5 条（伪造 directory / `..` 穿越 /
  列 B 目录 ＋ 2 条反向）。
- **T014「SQL 注入」**：`packages/auth/src/rbac.test.ts` › `test("userId 走参数化：注入串把它当字面量，
  一条都不回")`。⚠️ 只覆盖 `grantsFor` 这条参数化路径；**业务查询 SQL 的参数化是 F6/F7 自己的责任**。
- **T014「未授权直连」**：**挂账**（部署属性，`LEARNINGS #002-02`）。**不写成已覆盖。**
- **T014「越权读他人数据」**：会话/文件 = 上两条 003 测试；业务行级 = 同 T013（落点 F6/F7）。

⚠️ **别张冠李戴**：`tenant-db-isolation.test.ts`（**003 的** T012）钉的是「**会话数据**跨库隔离」，
**不是**业务行级 RLS ⇒ 不能当 T013 的证据（故未列进上表）。

#### 4. 本次真跑数字（**当场实测，不抄记忆** —— `#003-04` / `#001-01`）

- `packages/opencode`：`bun test test/server/anchor-workspace.test.ts test/server/tenant-directory-isolation.test.ts`
  ⇒ **24 pass / 0 fail / 80 expect / 2 files**（串行）。
- `packages/opencode`：`bun test test/server/openhive-access.test.ts test/server/openhive-access-wiring.test.ts`
  ⇒ **12 pass / 0 fail / 25 expect / 2 files**。
- `packages/auth`：`bun test src/rbac.test.ts src/rls.test.ts` ⇒ **18 pass / 0 fail / 35 expect / 2 files**。
- ⚠️ 这三跑是**复核**（证明索引里点名的测试今天确实绿），**不是**新增测试 —— 本次 task 代码零变更。

#### 5. 📤 显式挂账（**不写成「已覆盖」**）

1. **审计留痕** —— 零实现，落点 **F10**（T006 裁定 ②）。
2. **T013 的链路那一半**（A→网关→MCP→PG）—— 落点 **F6/F7** 的 T001 + T006。
3. **T014「未授权直连」** —— 部署属性，本仓不可跑断言。
4. **T014「越权读他人数据」的业务行级那一半** —— 同上面第 2 条。

#### 6. 门禁

本 task（T012–T014）**无任何代码变更**（改动全在 `docs/`：本 feature 的 `tasks.md` / `state.md`）
⇒ 门禁沿用 T008 末次结果（同一棵树，代码零差异）。**没有新代码就没有新门禁要跑**；
上面 §4 的三跑是**证据复核**、不是门禁。可由 `git diff --stat` 自证改动全在 `docs/`。

## Step 5 · 代码审查（2026-10-05）

`run-feature` Step 4 ＋ `superpowers:requesting-code-review`，扫 6 类：① 韧性 ② 横切一致性
③ 防御性 ④ DB 迁移 ⑤ 宪法合规（本 feature **无 `[FE]`** ⇒ 视觉合规那一半豁免，代之以
⑥ **上游同步面**：改动是否都以「最小化合并冲突」为前提）。

### 裁定（用户 2026-10-05）：**全修**（C1 ＋ I1–I10），Minors 一律**记账不修**

`I11` 是 Step 5 表定稿**之后**复核时新发现的，用户当场另裁「**补齐授权**」（见下）。

### 缺陷表

⚠️ 表里的 `文件` 一律写**文件名 ＋ 符号名**，不写行号（`#002-06`：行号会随编辑／上游同步漂，
写死的行号是「看着像证据的旧数」）。类别按 6 类扫描归类。

| 编号 | 类别 | 文件（符号） | 描述 | 优先级 |
|---|---|---|---|---|
| **C1** | 安全·越权 | `core/src/access/session.ts` 的 `namingConflicts` ＋ `opencode/src/server/openhive/access.ts` 的 `capabilityFor` | MCP 工具名通配 `sanitize(server)+"_*"` 的 `*` 跨得过 `_` ⇒ 前缀重叠的 server 之间规则互相命中，**放行取决于 `Config.mcp` 键序**（未授权 server 的工具可被 allow；反向命名也能借证） | Critical |
| I1 | 正确性 | `core/src/access/session.ts` 的 `mergeClientRules` | 「保留首次出现」去重把 capability 自己的 allow 挪到整体 deny 之前 ⇒ 客户端回送同键规则即 **over-deny**（已授予的 skill 反被拒） | Important |
| I2 | 完整性 | `opencode/src/agent/subagent-permissions.ts` ＋ `tool/task.ts` | 子代理会话的手写 filter 只留 deny ⇒ **capability 的 allow 全丢**，子代理里已授予的 skill 不可用；文档把「写入口」只列了 3 处，漏了这条 | Important |
| I3 | 测试缺口 | `handlers/session.ts` 的 `update` 端点、`session/session.ts` 的 `Session.fork` | 两者的**安全修复无测试**——回退成上游顺序全套仍绿（第一号约束下最易被静默回退） | Important |
| I4 | 契约不实 | `auth/src/rls.ts` 不变式 ④；本文件 | 不变式 ④ 漏「**连接必须干净**」前提（见证测试 ⑤ 已实测出这事），而本文件谎称「已写进 `rls.ts`」 | Important |
| I5 | 安全·泄漏 | `auth/src/rls.ts` 的**策略模板** | 模板 `GRANT SELECT ON <业务表>, <成员表>` 却只对业务表开 RLS ⇒ 受限账号可**直读全部成员关系**（FR-005 明说 MCP 会生成任意 SQL） | Important |
| I6 | 假镜像声明 | `auth/src/migrations/0004_rbac.sql` 注释；`core/src/access/rbac.ts` | 注释声称 `rbac.test.ts` 有「CHECK 闭集 ⇔ core 的 `ResourceType`/`Perm`」防漂移断言，**该断言不存在**（实测零命中，两侧各写各的） | Important |
| I7 | 潜在缺口 | `core/src/access/rbac.ts` 的 `resolve()`；`capability.ts` | v2 `resolve()` 不产整体 deny ⇒ 落回 `ask`（v2 的 `always` 可永久放行）；注释「`ask` 不会误放行」**不成立**。今天**零生产调用点** ⇒ 潜在 | Important |
| I8 | 横切不一致 | `opencode/src/session/prompt.ts` 的 `resolvePart` 资源支路 | 同一请求 fiber 里的 `mcp.readResource` **不带 `_meta`** ⇒ 资源工具的**两个出口身份不对称**，且未记为缺口 | Important |
| I9 | 测试缺口 | `opencode/src/session/tools.ts` 的资源工具 | 资源工具「共用身份」的**接线无测试**（摘掉 `mcpMeta`，两文件仍全绿） | Important |
| I10 | 文档债 | 本文件 | 源码行号引用（违反 `#002-06`），多指向**上游文件** ⇒ 同步时静默漂移 | Important |
| **I11** | 安全·越权 | `opencode/src/session/prompt.ts` 的 `resolvePart` 资源支路 | **Step 5 表定稿后新发现**：该支路**不经过工具层**，客户端自填 `source.type === "resource"` 的 part 就能绕过会话里那条 `{ read, "mcp:<server>:*", deny }` 把资源读出来。上游自 `c5442d418d` 起就没有这一问 | Critical |

### I10 的处置（据实记，与「29 处」不符）

原判据写「29 处」。**实测 42 处**（`grep -oE '[A-Za-z0-9_./-]+\.(ts|tsx|sql|json):[0-9]+'`）。
按「**引用当前位置** vs **记录一次测量**」两类分：

- **定位性（改）**——「X 在哪 / 落点在 Y」那一类，共 31 处 ⇒ 一律改成**文件名 ＋ 符号名／表达式**
  （如 `prompt.ts:1343`→`ensureRunning` → `prompt.ts` 的 `ensureRunning`；`groups/session.ts:53`
  → `groups/session.ts`）。
- **门禁取证快照（留）**——`file:line:col` 是 **lint 输出的原文**，而 `#001-01` 恰好要求门禁判据
  看「**规则名 ＋ 文件行**」⇒ 改掉会毁掉证据。保留，并给两处会漂的加**时点限定 + 取数命令**
  （`state.md` 里 T006 门禁那行原写「我的改动行在 163-177…」，T007 之后已漂，已改成
  「T006 阶段快照 … 复核请重跑 `git diff -U0 <merge-base>`」）。

⇒ 两条规则的张力（`#002-06` 要「别写死会漂的值」 vs `#001-01` 要「判据含文件行」）用
「**定位引用不写行号、取证快照标时点**」化解。

### 修复与见证（逐条）

| 编号 | 修法 | 见证 |
|---|---|---|
| C1 | core 出纯函数 `namingConflicts`（前缀比较，**不碰 `sanitize`**——core 不依赖 opencode，抄一份就是假镜像）；`access.ts` 的 `capabilityFor` **先跑、有冲突即拒建会话**（fail-closed） | `core/test/access-session.test.ts` 8 条 ＋ `openhive-access-naming.test.ts` 验**后果**（判定与后果钉在同一条测试里，`#003-02`） |
| I1 | 去重**拆到每个来源内部**；客户端侧与既有侧**撞键的一律丢弃**（既有那份留在原位置） | `openhive-access.test.ts`「客户端不得把既有规则『提前』」＋幂等条 |
| I2 | `deriveSubagentSessionPermission` 加 `blanketDenied`：**只**把「被父级整体 deny 罩住的那些 permission」的父级 allow 带下去（`#这是要保留的定制`，纯新增） | `test/agent/openhive-subagent-capability.test.ts` 4 条（含上游行为逐字不变的对照条） |
| I3 | 补两条 live 测试 | `openhive-access-wiring.test.ts`「update 端点…」＋「fork ⇒ 派生会话的规则集与源会话逐字相同」（断言**逐字相同** ＋ 拿链 A 真判决器 `evaluate` 验 allow/deny） |
| I4 | 不变式 ④ 改成「身份必须事务作用域，**且前提是「交到你手上的连接本身干净」**」，补 🔴 段（新连接 / `RESET ALL` / `DISCARD ALL` / 绝不用会话级 SET） | `rls.test.ts` ⑤ 后半段（LOCAL 剥不掉上一层）＋ `rls.ts:103` 的 `IDENTITY_SETTING` ⑦ 钉字面值 |
| I5 | 模板加「成员表**也要**开 RLS ＋ 策略」（不变式 5）；夹具同步 | `rls.test.ts` ⑧（alice 只看得到自己那行、无身份空集、**负对照**连接用户看得到 2 行） |
| I6 | core 的 `ResourceType`/`Perm` 从**裸联合**改成**运行时数组**（`RESOURCE_TYPES`/`PERMS`，类型由它导出）；`packages/opencode/test/server/openhive-rbac-closed-set.test.ts` 从 `pg_constraint` 读 CHECK **定义串**、抠字面量、与 core 数组**逐值双向**比；两处假镜像注释改写 | 变异 **M-H**（动 core ⇒ 红）／**M-I**（动 SQL ⇒ 红），两条都恰红 |
| I7 | `resolve()` 补 ① fail-closed 基线（遍历 `TOOL_OF_TABLE`，每个已映射类型一条整体 deny）；改正「ask 不会误放行」那句 | `core/test/access-rbac.test.ts` ③（没有映射的类型**只被基线罩着**）＋ ⑨（`bash`/`read` 不被基线波及） |
| I8 | `mcpMeta` 在 `SessionTools.resolve` **取一次**（`tools.ts` 的 `resolveTools`），server 工具路径与 resource 工具路径**共用** | 变异 **M-F**（剥掉 resource 路径的 `mcpMeta`）⇒ **恰红 1**（identity 那条），匿名对照保持绿 |
| I9 | `openhive-mcp-identity.test.ts` 补**资源侧**假 client（`getServerCapabilities().resources`）＋ 2 条测试 | 同上 M-F：摘掉 `mcpMeta` 时**恰红那 1 条** ⇒ 接线被钉住 |
| I10 | 见上「I10 的处置」 | 42 → 11（余下 11 处全是门禁取证快照） |
| **I11** | `resolvePart` 资源支路插入与工具路径**同形的一问**（`permission.ask`：`permission:"read"`、`metadata:{server,uri}`、`patterns:["mcp:<server>:<uri>"]`、`always:["mcp:<server>:*"]`、`ruleset: current.permission`），拒了走文件既有的「读失败」合成 text 支路（不抛）；**【这是要保留的定制】单独提交** | 两条见证测试（`test/session/prompt.test.ts`）：deny ⇒ **出站 `resources/read` 一次都不发生** ＋ 对照 allow ⇒ 发生 1 次且读到 `ledger`；变异 **M-D/M-E** 恰红 |

**I11 的镜像核对**（`#003-05` 要求「判据逐字对着上游写」）：把 I11 与
`opencode/src/session/tools.ts` 资源工具那条 `ctx.ask` 的四个字段（`permission` /
`metadata` 形状 / `patterns` / `always`）**逐字比过，完全同形**；并 grep 全仓
`readResource` 只有**两个调用点**（`tools.ts` / `prompt.ts`），两处都已有 ask ⇒ **无第三条泄漏路径**。

> ⚠️ **2026-10-05 补正（3 席的 `M-b`，见下文实测表）**：上面那句只核了**四个字段**——`ask` 还有
> **第五项 `ruleset`**：工具路径的 `ask` 在 `tools.ts` 里绑的是
> `merge(input.agent.permission, input.session.permission ?? [])`，而 I11 那条只带
> `current.permission` ⇒ **这一项不同形**（`Config.permission.read` 这类只进 agent 规则集的配置
> 在那条支路上不生效）。原判「完全同形」应读作「四个字段同形」。

### 重审修复本身（`LEARNINGS #003-02`：把修复当新代码再打一轮）

问法是「**谁在按同一个前提做同一件事**」——不是「谁提到了这个名字」（`#002-06`）。逐项结果：

| 前提 | 有几处实现 | 结论 |
|---|---|---|
| MCP 资源读要过 `read` ask | 2（`tools.ts` / `prompt.ts`，即 I11） | **四个字段已逐字对齐**，无第三处；⚠️ `ruleset` 一项**不同形**（`M-b`，2026-10-05 实测） |
| v1/v2 两条链的「整体 deny 基线」 | 2（`sessionRuleset` ① 按 `GOVERNED` / `resolve()` ① 按 `TOOL_OF_TABLE`） | 两表**键集相等**由 `openhive-access.test.ts` ⑥ 钉住（**故意**是警报条：谁把 `mcp` 塞进 `TOOL_OF` 它会红）；且 `sessionRuleset` ③ 只取 `effect==="allow"`，避免把 v2 的基线搬进来造成**过拒** |
| 「创建会话必须带 capability」 | 4（create / update / prompt / fork） | 前 3 处走 `mergeClientRules`，fork 无客户端输入 ⇒ **直接继承** `original.permission`；**四条都有测试**（I3 补的就是缺的那两条） |
| 「子代理会话怎么继承父级权限」 | 1（`deriveSubagentSessionPermission`，只被 `tool/task.ts` 调） | 单点，已测 |
| 「`Config.mcp` 名单的命名冲突」 | 1（`namingConflicts`，只被 `capabilityFor` 调） | 单点，已测 |

⇒ **本轮重审未发现新缺陷**（I11 是上一轮发现的，已在本轮修复）。

### Minors（**记账，不修** —— 逐条列出，不假装闭合）

`M14`（杂项，合并一条）：`TOOL_OF` 原型链键（不可达）／`grantsFor` 无生产驱动用例／
`stop()` 不漏句柄实为漏／`rollback` 非事务（既有）／负对照 ④ 只证「该用户绕过」／
模板缺 membership 的 `GRANT`／`doom_loop` 只用 `agent.permission`／`Effect.promise` 失败不可归类／
`prompts/get` 未带身份／空 user id 注入空身份／重名 server 无校验。

> 判据：这些**都不改变今天可达路径上的安全结论**（或落在上游既有代码上），记在这里备查；
> 修它们会扩大与上游的冲突面（第一号约束），留待有生产调用点或同步上游时再议。

### 门禁（全修后**串行**复跑，`#003-01`：并行会造假红）

| 门禁 | 结果 | 判据 |
|---|---|---|
| `bun run typecheck` | **exit 0**，31/31 tasks | 必须 0 |
| `bun run lint:openhive` | **exit 0**，23 warnings / 0 errors / 69 files / 161 rules | = 基线**逐字相同** |
| `bun run lint`（全局） | exit 1，**4951 warnings / 1 error / 3468 files**（恒红） | 唯一 error = 既有上游 `packages/session-ui/src/v2/components/prompt-input/index.tsx` 那行；`prompt.ts` 的唯一命中在 **655**，**不在本次改动行**（本次 hunk = `+23,2` / `+702,9` / `+727,32`）⇒ **改动行 0 命中** |
| `packages/core` | **25 pass / 0 fail**（`access-rbac` ＋ `access-session` ＋ `access-capability` ＋ `access-issue`） | 改动影响面所在文件全绿 |
| `packages/auth` | **19 pass / 0 fail**（`rls.test.ts` ＋ `rbac.test.ts`） | 同上（`rls` 走 PGlite 真跑，25 s） |
| `packages/opencode` access 套件 | **39 pass / 0 fail**（7 文件：`openhive-access{,-wiring,-mcp,-mcp-wiring,-naming}` ＋ `openhive-rbac-closed-set` ＋ `openhive-subagent-capability`） | 同上 |
| `packages/opencode` `test/session/prompt.test.ts` | **49 pass / 14 skip / 0 fail** | 同上 |
| `packages/opencode` `test/session/openhive-mcp-identity.test.ts` | **4 pass / 0 fail** | 同上 |
| `bun.lock` | `git diff --stat bun.lock` = **空** | 未跑 `bun install`，无镜像源污染 |

⚠️ **一处据实记（不假装 0 命中）**：改动文件 `packages/opencode/test/session/openhive-mcp-identity.test.ts`
的全局 lint 命中 **6 → 7**（单文件实测：`bunx oxlint <该文件>`）——**＋2 条** `no-unsafe-type-assertion`、
**−1 条** `no-unnecessary-type-assertion`。＋的这 2 条落在本次新写的两个测试桩
（`resourceRecordingClient` 的 `as unknown as Client`、`fakeMcpWithResources` 的 `as … as MCP.Interface`），
**与同文件既有 5 条逐字同款**（该文件用 10 个 Service 桩，MCP 那两个因实现不全、必须双断言）。
规则是 **warning 级**（全局 error 仍恰 1 条、在上游文件上）⇒ 按「照抄同文件既有写法」保留，
不用为凑门禁偏离本文件风格。

> 判据出处：`#001-02`「全局红的门 ⇒ 判据改为『本次新增/改动文件 0 命中』」，且**改动行 0 命中**
> 是本 feature 沿用 003 的更严版本。上面那条是它的**实测残差**，不是「已闭合」。

---

## Step 5 之后的独立审查（3 席 · 2026-10-05）

Step 5 收尾（含 I11 补修）之后，用户另开一轮**独立审查**（3 席并行 ＋ 对抗证伪），得 **R1–R5**。
裁定：**全修 R1–R5**（R3 = 补文档说清定位；R4 = 定义语义 ＋ 登记缺口），Minors 一律**记账不修**。

> 口径：本节所有数字/事实均为**本节落笔前在当时的代码 HEAD（`35ece21bff`）上串行复跑复测**所得
> （`#001-01`「报门禁数字前先真跑」、`#003-04`「实测类记述落笔前先复现」、测试**串行**跑 `#003-01`）。
> ⚠️ **时点快照**（`LEARNINGS #004-05`）：`35ece21bff` 是本 feature **代码**最后一次改动；其后只有
> docs 提交、不动一行代码，故这些数字对该代码状态仍成立——但**别把 `35ece21bff` 读成「当前 HEAD」**。

### 缺陷表

| 编号 | 类别 | 文件（符号） | 描述 | 优先级 | 处置 |
|---|---|---|---|---|---|
| **R1** | 安全 | `session/prompt.ts` 的 `command()` | `Command.init` 把每个 skill **也**注册成一条命令（`source: "skill"`，`template` 就是 skill 正文），而这条路径**不经过工具层** ⇒ `POST /session/:id/command { command: "<未授权的 skill 名>" }` 可绕过 `session.permission` 里那条 `{ permission: "skill", pattern: "*", action: "deny" }`（`AccessSession.sessionRuleset` ①，**零授权时也照样有**） | **Critical** | ✅ 修（`0a63df3f6e`；上游文件 ⇒ 单独提交 ＋【这是要保留的定制】） |
| **R2** | 文档不实 | 7 处（`packages/auth/src/rls.ts`、`workspace.test.ts`、本 feature 三份主文档、F7/F8 的 `tasks.md`） | 本仓文档与注释写「`packages/auth` 的测试**不进 CI**」——**实测为假** | Important | ✅ 修（`3554cbbc54`） |
| **R3** | 定位不实 | `core/src/access/{capability,issue}.ts` ＋ `rbac.ts` 的一段注释 | 两文件是 FR-008/FR-010 的**机制定义**（结构由 canary 测试逐条钉着），但**今天零生产调用点**；`rbac.ts` 却把它们说成「角色表 → ruleset → capability 一条直线」——与实测不符 | 定位（裁定：**不删**） | ✅ 补文档说清定位（`982cc71848`） |
| **R4** | 语义缺口 | `spec.md` 的 Edge Cases（缺一条） | 004 全程**没写下「授权变更什么时候生效」** | Important | ✅ 定义语义（`37d8daa86a`）＋ 落进 F10 接收表 |
| **R5** | 横切一致性 | `mcp/index.ts` 的 `getPrompt` ＋ `command/index.ts` 的 MCP prompt `template` | 原 M14 里的一条 minor，复核后**升级为 Important**（**与 I8 同形**）：`_meta` 只写进 `tools/call`（`convertTool`）与 `resources/read`（`MCP.readResource`）⇒ `prompts/get` 是**三个 MCP 出口里唯一不带身份**的那个；而它在生产里**真的会被调** | Important | ✅ 修（`35ece21bff`；上游文件 ×2 ⇒ 单独提交 ＋【这是要保留的定制】） |

### 修复与见证（逐条）

**R1 —— skill 命令出口补权限门**（`command()`，`0a63df3f6e`）

- 加的一问：`permission.ask({ permission: "skill", patterns: [cmd.name], always: [cmd.name], metadata: {}, ruleset: Permission.merge(agent.permission, session.permission ?? []) })`，与工具路径（`src/tool/skill.ts` 的 `ctx.ask`）**同形**；只对 `cmd.source === "skill"` 生效。
- **位置**：在 `cmd.template` 被读取之前。⚠️ 据实记——真正的执行点是模板被**展开**那一步（`ConfigMarkdown.shell` 匹配 `` !`cmd` `` 后 `Process.text` 真的执行 shell），读 `cmd.template` 本身对 skill 只是纯字符串拼接；把门放在读模板之前是**更强**的约束，把两处一起罩住。
- **agent 解析上移**（上游原本在 `getModel` 之后）：规则集必须与工具路径一样并上 `agent.permission`——`Config.permission.skill` 是上游一等的配置键（`core/src/v1/config/permission.ts`），它**只进 agent 的规则集、不进会话规则集**，只并会话那份会比上游的工具路径**更弱**。上移本身等价，只有一处次序变化（变好）：agent 找不到时现在**先于**模板的 shell 块报错。
- 见证（`test/session/prompt.test.ts`，两条；探针 skill 由 `writeProbeSkill` 落在 tmpdir）：
  - `R1：未授权 skill ⇒ /command 调不动它，skill 正文一个字节都没进模型` —— 断言 `Exit.isFailure` ＋ `Cause.squash(...)` 是 `PermissionV1.DeniedError` ＋ **模型调用 0 次**；
  - `R1 对照：已授权 skill ⇒ 命令照常执行、正文进模型` —— 断言 `Exit.isSuccess` ＋ 模型调用 > 0 ＋ 末条输入里含 skill 正文的 marker（**负对照**：拒的是越权，不是把 `command` 功能整个关掉）。
  - RED：新用例 **1 fail**（修复前不拒、模型被调用）→ GREEN：**2 pass**；整文件 **51 pass / 14 skip / 0 fail**（本节复跑）。
- ⚠️ **一处据实记（顺序本身没有被测试见证）**：两条见证钉住的是「**未授权 ⇒ 模型拿不到正文**」；「门在模板展开之前」这一条**没有**测试守着。要写它得让探针 skill 的 `` !`…` `` 块落一个 marker 文件、再断言被拒时 marker 不存在——**本机做不了**：本仓的 shell 用例是 Unix 门（`unixNoLLMServer` ＋ `withSh` / `hasBash`，本机 `hasBash` 为假时**静默 return**），照抄就成了 `#002-02` 说的「没有真正执行被测路径的测试＝缺口」。故记成**缺口**，不写成「已覆盖」。

**R2 —— 「auth 测试不进 CI」这处不实记述（7 处）**（`3554cbbc54`）

- 事实（本节复测，取数命令已写进 `rls.ts` 的注释）：`turbo.json` **第 20 行**就是 `"@opencode-ai/auth#test"`（2026-09-30 由 `c013619ddc` 加入，**早于本 feature 的 merge-base `907b3bc5`**），`.github/workflows/test.yml` 第 68 行跑 `GITHUB_ACTIONS=false bun turbo test` ⇒ 本包测试**进 CI**。复核命令：`grep -n "@opencode-ai/auth#test" turbo.json` ＋ `grep -rn "turbo test" .github/workflows/`。
- 复核取数：`grep -rn "不进 CI" docs packages` ⇒ **7 处**（`packages/auth/src/rls.ts`、`packages/auth/src/workspace.test.ts`、`state.md`、`session.md`、`tasks.md`、`007-fund-analysis/tasks.md`、`008-call-analysis/tasks.md`），均已改正为自足表述。
- 与 I6 同型（`#004-03`）：写着「有 X / 没有 Y」的**镜像声明本身也会假**；其中 `workspace.test.ts` 那一处是**本 feature 期间我自己写的**，且没被我自己那轮 Step 5 审计抓到。

**R3 —— `capability.ts` / `issue.ts` 的定位**（`982cc71848`）

- 实测（取数：`grep -rn "AccessIssue\.\|AccessCapability\." packages/core/src packages/opencode/src packages/auth/src`）⇒ 只命中 `issue.ts` 自身 ＋ `rbac.ts` 那句注释；**零生产调用点**，而 `issue.ts` 自己就写着「本文件不接线」（D0-5 裁定）。
- 今天真正跑着的是**另一条**：角色表 → `AccessRbac.resolve()` → `AccessSession.sessionRuleset()` → `session.permission`（`resolve()` 的生产调用点在 `session.ts` 里，**不在** `issue.ts`）。出口选 `Ruleset` 的理由不受影响——它同时是两条链已经在吃的形状。
- 处置：**不删**（F7 要照抄这套结构：`cap_` 前缀 / `DataScope.rule` / `Scope` 三件套由 `packages/core/test/access-capability.test.ts` ＋ `access-issue.test.ts` 逐条钉着）＋ 三个文件各补一段「今天的定位」（`capability.ts` 文件头、`rbac.ts` 的出口段）＋ 改正 `rbac.ts` 那处**与实测不符**的「一条直线」。
- 判据：两个文件都是 openhive **定制创建**的文件（`git log` 只有 004 的提交）⇒ 纯注释改动**零上游冲突面**。见证：无行为变化 ⇒ 门禁复跑与基线逐字相同。

**R4 —— 授权变更的生效时点**（纯文档，`37d8daa86a`）

- 实测依据：`capabilityFor()` 只在会话 **create** 时调（`handlers/session.ts`），`update` 只走 `AccessSession.mergeClientRules`、**不回查** `auth.user_role` / `auth.role_resource` ⇒ capability 在**会话创建那一刻焊死**，改授权（**增也一样**）对已有会话无效。
- `spec.md` 的 Edge Cases 新增第 4 条：**会话生命周期 = 授权的滞后窗口**；这是 FR-002「执行器只认 capability、不回查角色表」的**直接代价、不是缺陷**（回查就等于在执行器里认角色表）；将来要「立刻踢掉」的落点是**让会话作废 / 重新签发**，**不是**把回查塞回执行器；今天**不提供**会话级吊销。
- 落进**接收方**的表（`LEARNINGS #002-04③`：责任/语义出边界必须落进对方文档，否则等于推进黑洞）：`010-governance-console/tasks.md` 的 T003 —— 界面**不要承诺「立即生效」**，验收**别把「改完立刻生效」写进出参**。
- 判据：这不是「做不完的 task」，是一条**设计语义**——它决定 F10 的授权管理界面能承诺什么。

**R5 —— `prompts/get` 补身份**（上游文件 ×2，`35ece21bff`）

- 两半：**传输层**（`MCP.Interface.getPrompt` 加第 4 个可选 `meta` ＋ 实现把它塞进出站 `_meta`；`...(meta ? { _meta: meta } : {})` ⇒ 不传就**压根没有这个键**，不是「带了个空身份」）＋ **接线层**（`command/index.ts` 的 MCP prompt `template` getter 里 `const meta = yield* userMeta()` 传下去）。
- 为什么取得到：身份本来就在请求 fiber 上（`User.Service`，每请求注入），而 `bridge` 捕获了**全量** context（`src/effect/bridge.ts` 的 `Effect.context()`）⇒ `bridge.promise(...)` 里能 `yield* userMeta()`。
- 理由写进 `src/mcp/openhive-identity.ts` 文件头（「补的是哪个洞」「为什么三条出口必须是**同源的一份**身份」，与 I9 同因 `#003-05`）。
- 见证（两半各一对：身份 ＋ **对照**）：
  - `test/mcp/openhive-mcp-identity.test.ts`：``getPrompt` 把身份放进 `prompts/get` 的 `_meta`（线上可见）`（记录服务端实收的 params）＋ 对照`不传 meta ⇒ `prompts/get` 的 params 里没有 `_meta` 这个键``。RED **3 pass / 1 fail**（实收 `undefined`）→ GREEN **4 pass**。
  - `test/session/openhive-mcp-identity.test.ts`：`带身份 ⇒ MCP prompt 命令取模板时 getPrompt 拿到这个人`（接线层，用 `LayerNode.compile(commandRoot, [[MCP.node, fakePromptMcp]])` 替换实现）＋ 对照「没有身份 ⇒ 第 4 个实参是 `undefined`」。RED **5 pass / 1 fail** → GREEN **6 pass**。
- 变异（`#003-03`：红集据实记，三类分开）：
  - **M-K**（把 `...(meta ? { _meta: meta } : {})` 改成无条件 `_meta: meta ?? {}`）⇒ **恰红 1 条 = 那条对照**（其余 3 绿）——证明对照条抓得住「默认塞一个空身份」。
  - **M-J**（接线层 `const meta = yield* userMeta()` → `const meta = undefined`）⇒ **恰红 1 条 = 接线身份测试**，对照绿。

### 本轮新增的挂账（据实记，不假装闭合）

1. **MCP 来源的命令今天无法用 capability 表达**：`Command.Info` 的字段里**没有 server**（只有 `source: "mcp"`，见 `src/command/index.ts` 的 `Info`），而 mcp 那条投影按 `mcp:<server>:*` 判 ⇒ 「这条 prompt 命令属于哪个 server」在数据里**不存在**，判据写不出来。R1 只堵住了 skill 那一支（`name` 就在 `Command.Info` 里）。
2. **`GET /command` 与已挂账的 `GET /skill` 同型**：instance 级、**非会话作用域**（`handlers/instance.ts` 的 `getCommand` 直接 `command.list()`）⇒ 拿不到 capability、无处可过滤；而返回的 `Command.Info[]` 里 skill 的 `template` **就是正文**。并入 `GET /skill` / `GET /experimental/tool` 那一张账（见「T005」节的挂账行）。
3. **R1 的门被拒时呈现为 500**：`command()` 的契约错误类型只有 `Image.Error`，把 `PermissionV1.Error` 写进签名要动 `Interface` 的全部调用方（HTTP 路由 / CLI）＝上游面 ⇒ 用 `Effect.orDie`（与工具路径**逐字同形**），代价是呈现层粗糙。落点注释已写明（`prompt.ts` 的 R1 段）。

### 3 席的 Minors（**记账，不修** —— 逐条列出，不假装闭合）

| 编号 | 类别 | 文件（符号） | 描述 | 复核结论 |
|---|---|---|---|---|
| `M-a` | 文档 | `core/src/access/session.ts` | 一段 `sessionRuleset` 说明**重复且错位** | **两席独立命中**，属实 |
| `M-b` | 一致性 | `session/prompt.ts` 的资源支路 | `ask` 只带 `current.permission`、**未叠加** `agent.permission`，与同类调用**不同形**（`#003-05` 形状） | 属实（本节复核见下） |
| `M-c` | 可用性 | `core/src/access/session.ts` 的 `sessionRuleset` | mcp 授权行须与配置键**逐字相同**（`fund.db` vs `fund_db`），否则**静默过拒** | 属实 |
| `M-d` | 健壮性 | 同上 | server 名含 glob 元字符（`*`）⇒ 资源 pattern **过宽** | 属实 |
| `M-e` | 可用性 | `access.ts` 的 `capabilityFor` | 配置冲突用 `Effect.die`（defect）表达，500 里不带结构化原因 | 属实 |

**`M-b` 的现场实测**（本节补做；`#004-04`：表里「同形 / 已覆盖」这类**事实性说法**要逐条去代码核）：

| 调用点 | `ruleset` |
|---|---|
| `session/tools.ts` 的 `ask`（工具路径，资源工具走它） | `Permission.merge(input.agent.permission, input.session.permission ?? [])` |
| `session/prompt.ts` 的 `command()`（**R1 新增**的门） | `Permission.merge(agent.permission, session.permission ?? [])` |
| `session/prompt.ts` 的资源支路（I11 新增的门） | `current.permission ?? []` —— **未叠加 `agent.permission`** |

⇒ 与工具路径**不同形**：`Config.permission.read` 这类**只进 agent 规则集**的配置在这条支路上**不生效**。今天不改（Minors 记账），但它是「**同一条判定的两处实现只对上了四个字段、第五个字段各写各的**」——`#002-06` 的形状，留待有生产调用点时一并处理。

> 判据：这五条**都不改变今天可达路径上的安全结论**（或落在上游既有代码上），记在这里备查；
> 修它们会扩大与上游的冲突面（第一号约束）。

### 门禁（**代码最终状态** `35ece21bff` 上**串行**复跑，`#003-01`：并行会造假红）

> ⚠️ **时点**：下表是 `35ece21bff`（R5 之后、代码最后一次改动）上的快照；其后只有 docs 提交、不动代码
> ⇒ 复核请**串行**重跑，别读成「在当前 HEAD 上跑过」（`LEARNINGS #004-05`）。

| 门禁 | 结果 | 判据 |
|---|---|---|
| `bun run typecheck` | **exit 0**，31 successful / 31 total（其中 30 个是 turbo 缓存命中——输入未变的包复用上次结论） | 必须 0 |
| `bun run lint:openhive` | **exit 0**，23 warnings / 0 errors / 69 files / 161 rules | = 基线**逐字相同** |
| `bun run lint`（全局） | exit 1，**4953 warnings / 1 error / 3468 files**（恒红） | 唯一 error = 既有上游 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163:19`（`'\200B'` 八进制转义，`#001-02` 裁定**不私改**、登记上报上游）⇒ `src` 侧**改动行 0 命中**；相对 Step 5 那次（4951/1、同为 3468 files）**＋2**，与 R5 在两个测试文件里各新加的一个 Service 桩（各 ＋1 条 `no-unsafe-type-assertion`）**对得上**（`#001-01`：总数有 ±1 抖动，判「有没有变坏」看**规则名 ＋ 文件行**） |
| `packages/core`（4 个 access 测试文件） | **25 pass / 0 fail** | 改动影响面所在文件全绿 |
| `packages/auth`（`rls` ＋ `rbac` ＋ `workspace`） | **25 pass / 1 skip / 0 fail** | 同上（`rls` 走 PGlite 真跑，31 s） |
| `packages/opencode` access 套件（7 文件） | **39 pass / 0 fail** | 同上 |
| `packages/opencode` `test/session/prompt.test.ts` | **51 pass / 14 skip / 0 fail**（97 s） | 含 R1 的两条见证 |
| `packages/opencode` `test/mcp/openhive-mcp-identity.test.ts` | **4 pass / 0 fail** | 含 R5 的两条 |
| `packages/opencode` `test/session/openhive-mcp-identity.test.ts` | **6 pass / 0 fail** | 含 R5 的两条 |
| `bun.lock` | `git diff --stat bun.lock` = **空** | 未跑 `bun install`，无镜像源污染 |

⚠️ **据实记（不假装 0 命中）**：两个**改动过的测试文件**的全局 lint 残差（单文件实测，
取数：**在仓库根**跑 `bunx oxlint <文件>`——在包目录里跑会因根配置的 `options.typeAware`
报「only supported in the root config」而测不到数）：

- `test/session/openhive-mcp-identity.test.ts`：**8 warnings / 0 errors**，8 条**全是**
  `no-unsafe-type-assertion`（Step 5 记的是 6 → 7；R5 又 ＋1——新写的 `fakePromptMcp` 桩）；
- `test/mcp/openhive-mcp-identity.test.ts`：**3 warnings / 0 errors** ＝ 2 条 `no-unsafe-type-assertion`
  ＋ 1 条 `no-floating-promises`（`http.stop(true)` 未 `await`）。**那条 `no-floating-promises` 不是 R5 引入的**
  ——取数：`git diff 35ece21bff~1 35ece21bff -- <该文件> | grep 'http.stop'` **零命中**（它是**未改动的上下文行**），
  且与上游 `test/mcp/lifecycle.test.ts` 的 `await protocol.close().catch(() => {})` ＋ `http.stop(true)`
  两行**逐字同款**（上游 `headers.test.ts` 则 `await` 了——两种写法上游都有）。

规则是 **warning 级**（全局 error 仍恰 1 条、在上游文件上）⇒ 按「照抄同文件/同上游既有写法」保留，
不为凑门禁偏离既有风格。

## 最后更新

2026-10-05（**Step 5 之后的独立审查（3 席）**：得 **R1–R5**，用户裁定**全修**（Minors 记账）——
R1/Critical：`Command.init` 把每个 skill 也注册成一条命令，`POST /session/:id/command` 可绕开
`{ skill, *, deny }`（上游文件 `session/prompt.ts`，【这是要保留的定制】**单独提交** `0a63df3f6e`；
两条见证 ＋ RED 1 fail → GREEN 2 pass；据实记「门的位置本身**没有测试见证**——要写它得让 skill 里的
`` !`…` `` 落一个 marker，而本仓 shell 用例是 **Unix 门**、本机静默 return ⇒ 记**缺口**不记覆盖」）／
R2/Important：「auth 测试不进 CI」这处**实测为假**的记述 **7 处**已改正（`turbo.json:20` ＋
`.github/workflows/test.yml:68`，取数命令写进注释）`3554cbbc54`／R3：`capability.ts` / `issue.ts`
**今天零生产调用点**的定位补进文档（裁定**不删**——F7 要照抄这套结构）＋ 改正 `rbac.ts` 那句
「一条直线」（实测为假）`982cc71848`／R4：**定义「授权变更的生效时点」**（capability 在会话创建那刻
焊死 ⇒ **会话生命周期 = 授权的滞后窗口**；是 FR-002 的直接代价、不是缺陷；将来要「立刻踢掉」只能让
会话作废）＋ 落进 **F10 接收表** `37d8daa86a`／R5/Important（原 M14 的 minor 升级，**与 I8 同形**）：
`prompts/get` 是三个 MCP 出口里唯一不带身份的 ⇒ `getPrompt` 加第 4 个可选 `meta` ＋ 接线层
`userMeta()`（上游文件 ×2，【这是要保留的定制】）`35ece21bff`，见证两对 ＋ 变异 **M-K / M-J 各恰红
1 条**）＋ 本轮**新增三条挂账**（MCP 来源的命令 `Command.Info` 里**没有 server 字段** ⇒ 表达不出
capability／`GET /command` 与已挂账的 `GET /skill` 同型（instance 级、非会话作用域，`template` 就是
skill 正文）／R1 的门被拒时呈现为 **500**）＋ **3 席的 Minors `M-a`…`M-e` 记账**（其中 **`M-b` 现场
实测**：`tools.ts` 的 ask 与 R1 的门都是 `merge(agent.permission, …)`，而 I11 的资源支路只带
`current.permission` ⇒ **不同形**，`Config.permission.read` 在那条支路不生效）＋ 门禁在**代码最终状态
（`35ece21bff`）上串行复跑**（typecheck 31/31 exit 0 · lint:openhive 23/0/69 files/161 rules 与基线逐字相同 ·
全局 lint **4953 warnings / 1 error**（唯一 error 仍是上游 `prompt-input/index.tsx:163:19`；＋2 与两个
测试桩对得上、`src` 改动行 0 命中）· core 25 · auth 25 pass/1 skip · opencode access 39 ·
`prompt.test.ts` 51 pass/14 skip · 两张身份测试表 **4 ＋ 6 pass** · `bun.lock` 空））

2026-10-05（**Step 5 代码审查**：6 类扫描出 **C1 ＋ I1–I10**，用户裁定**全修**（Minors 记账）；
表定稿后复核又发现 **I11**（`prompt.ts` 资源支路缺 `read` ask —— 与工具路径**同形的一问**，
上游自 `c5442d418d` 起就没有，客户端自填 `source.type==="resource"` 的 part 即可绕过
`{ read, "mcp:<server>:*", deny }`），另裁**补齐授权** ＋ 【这是要保留的定制】**单独提交** ＋
两条见证测试（deny ⇒ 出站 `resources/read` **一次都不发生** / 对照 allow ⇒ 发生 1 次）＋
变异 M-D/M-E 恰红 ＋ 逐字核对四个字段与 `tools.ts` 的资源工具 ask **完全同形**、grep 全仓
`readResource` **仅两个调用点**、两处都已有 ask ⇒ 无第三条泄漏路径）＋ **`#003-02` 修复重审**
（问「谁在按同一个前提做同一件事」：MCP 资源读 2 处已对齐 / 两条链的整体 deny 基线 2 处由
`openhive-access.test.ts` ⑥ 键集断言钉住 / 「创建会话必须带 capability」4 处中 fork 走直接继承、
四条都有测试 / 子代理继承 1 处 / 命名冲突 1 处 ⇒ **未发现新缺陷**）＋ **I10 据实修正**
（原判「29 处」实测 **42 处**：定位性 31 处改文件名＋符号名、门禁取证快照保留并加时点限定 ＋
取数命令 ⇒ 余 11 处，见节内说明）＋ 门禁**串行**全绿（typecheck 31/31 · lint:openhive 23/0 与基线
逐字相同 · core 25 pass · auth 19 pass · opencode access 39 pass · `prompt.test.ts` 49 pass/14 skip ·
`bun.lock` 空）＋ 据实记一处残差（改动文件 `openhive-mcp-identity.test.ts` 全局 lint **6 → 7**：
＋2 `no-unsafe-type-assertion`/－1 `no-unnecessary-type-assertion`，新增两条与同文件既有 5 条**逐字同款**、
warning 级、不改安全结论）＋ RLS 不变式升至**五条**（新增「被 GRANT 的每一张表都要开 RLS」）
＋ `state.md:1136` 的 I4 断言两半**都已为真**（`rls.ts` ④ ＋ F6/F7 移交行均已核））

2026-10-05（**T012–T014**：用户裁定**甲** —— 安全测试三条**纯记账关闭、零新增测试** ＋ Step 0.5
实测表「这三条今天打得到什么」（可测的一半：拒绝 / RLS 机制 / 路径穿越 / SQL 注入判据；
不可测的一半：审计→F10、链路级越权→F6/F7、未授权直连→部署属性）＋ **据实记另两条被否方案**
（乙只关 T012 / 丙整条移交）＋ 逐项证据索引**按测试名引用**（不写行号）＋ **当场真跑复核**
（opencode 24 pass · opencode 12 pass · auth 18 pass，全 0 fail）＋ 四点显式挂账 ＋
无代码变更 ⇒ 门禁沿用 T008 末次结果 ⇒ **在册 12 条全部 `[x]`**）

2026-10-05（**T009**：用户裁定**乙** —— 结果量级控制（FR-006 第四档）**整条移交 F6/F7** ＋
Step 0.5 实测表（强制点在 MCP 层；全仓无 MCP **server**、无业务查询路径、无「导出」承载物；
`Perm` 只有 read/write/review/admin 且只有 read 产生规则）＋ **裁定理由是「与 T008 的差别」**：
T008 有真引擎（PG RLS 执行器）可被变异见证，T009 没有——`LIMIT` 是 MCP server 自己 SQL 的子句，
测它是在测 PG ＝ 空断言 ⇒ 「机制见证」做不出非空版本，故整条移交 ＋ 另两条被否方案（甲 env 阈值模块
无消费者 / 丙 客户端夹取只减下游）也据实记 ＋ 移交块落进 `007-fund-analysis` / `008-call-analysis`
**第三笔**（含两条接手方易漏点：上限数字由接手方定、导出权限要么走 mcp 段要么改 `TOOL_OF`）
＋ tasks.md 同步 Phase 4 与在册条数（3 条移交 ⇒ 在册 12 条）＋ 无代码变更 ⇒ 门禁沿用 T008 末次结果）

2026-10-05（**T008**：用户裁定**甲** —— 业务数据行级 RLS 的**机制**本 feature 定义并本机可验证、
**落地**（建表/策略/角色/GRANT）移交 F6/F7 ＋ Step 0.5 实测「PGlite 真跑 RLS 执行器、连接用户
`rolsuper = true`」＋ 落点 `packages/auth/src/rls.ts`（契约 ＋ 策略模板 ＋ 四条不变式）与
`rls.test.ts`（见证测试 7 条）＋ 变异 M1–M4b（红集**据实记**：M1/M2 同集、M3 只红 ①⑤ ⇒ 只有相等断言
抓得住「过紧」、M4b 红 ③④⑤）＋ **途中修错三处**（⑤ 空串断言写错 ⇒ 改成两个实测事实、由此发现
「`LOCAL` 剥不掉上一层」、`await expect().rejects` 与两处 lint 改为本包既有写法）＋ 门禁串行全绿
（typecheck 31/31 · lint:openhive 23/0 · 全局限 lint 新文件 0 命中 · auth **220 pass/1 skip/0 fail**）
＋ 移交行落进 `007-fund-analysis` / `008-call-analysis` 的 `tasks.md` 文件头（含点名的 `X-User-ID`
vs `_meta["openhive/user"]` **跨 feature 语义冲突**）＋ 五条挂账 ＋ 一条留给 T013/T014 的裁定点）

2026-10-05（**T007**：MCP 出站带用户身份（`src/mcp/openhive-identity.ts` 新 ＋ 上游三处加可选 `meta`，
各自【保留的定制】）＋ capability 的 **mcp 投影**（core `McpServerNaming`/`sessionRuleset` ②段 ＋
`Config.mcp` 名单，core 侧零镜像）＋ 四条裁定（身份载体 / 堵法 / 名字翻译 / 只做打得到的那一半）＋
24 条测试（四层各带对照）＋ typecheck 首跑 3 条**真错**已修（`Interface` 声明漏改 ⇒ 只在调用点报警）＋
门禁串行全绿（typecheck 31/31 · lint:openhive 23/0 · 全局限 lint 唯一 error = 既有上游文件 ·
`test/mcp/` 67 pass）＋ `test/session/` 4 条 5 秒线超时经中性化对照确认**非本次引入** ＋ 五条挂账）

2026-10-05（**T005**：前置实测「字面出参已随 T006 生效 ⇒ 不建 `tool-filter.ts`」＋ 用户裁定「补
`sys.skills` ＋ 验收测试」＋ `system.ts` / `prompt.ts` 两处上游改动（【保留的定制】）＋ 6 条验收
（矩阵不变式 ＋ 真 `prepare`）＋ M5/M6 变异 ＋ 收尾跑 `test/session/` 揪出并处置 **T006 的一条回归**
（上游 `prompt tools replace…` 测试 ⇒ merge 契约，用户裁定保留 merge）＋ 三个提交 ＋ 门禁串行复跑
（typecheck 31/31 · lint:openhive 23/0 · 全局 lint 4942/1 = 基线 · `test/session/` 408 pass/1 fail=已知 `snapshot race`））

2026-10-04（开工：Step 0.5 实测 + 四条裁定 + T001 + 门禁基线落档 + T002 capability 结构 + T003 签发
+ D-05 裁定 ＋ T015 迁移 CLI ＋ T004 RBAC 表 ＋ 权限判定（含 0004 撞红 7 条既有断言的连带修正）
＋ T004 修正：`resolve()` 改用工具断言词表（T006 前置，三条裁定）
＋ **T006 工具执行守卫（链 A）：`AccessSession` 判定 ＋ `grantsFor()` 取行 ＋ 三处上游接线
（各自【保留的定制】单独提交）＋ 两条客户端自批越权路收口 ＋ 12 条测试（含 M1–M4 变异验证）
＋ tenant-db-isolation 适配新契约**）
