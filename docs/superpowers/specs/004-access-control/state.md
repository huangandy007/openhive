# 实施进度 · 权限控制

## 当前任务

**T003 已完成**（capability 签发，见下「已完成」）。已 commit，**停下等「next」**。

下一条可选：**T004**（RBAC 表 + 判定，依赖 T001，与 T003 无双依赖）／**T005**（工具清单过滤）／
**T006**（执行守卫）——T005/T006 依赖 T001 ＋ T003，两条已就绪。先做哪条由用户定。

**待裁一项**：D-05（生产里谁跑迁移）须在 **T004 之前**裁定，见 D0-3 段。

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
| 「创建会话」在哪 | 链 A `POST /session`；链 B `POST /api/session` | `groups/session.ts:88`；`protocol/src/groups/session.ts:129` |
| 「创建」＝「启动」吗 | **不是**。创建只发 `Created` 事件并落一行，**不启动执行** | `session/session.ts:535`；`core/session.ts:241` |
| 「启动」在哪 | **首次 prompt** 触发 | `prompt.ts:1343`→`ensureRunning`；`core/session.ts:382`→`execution.wake` |
| 有「执行已启动」事件吗 | **没有**。链 B 的启动是内存协调器 `wake`，不发布事件；链 A 是 `SessionRunState.runner.ensureRunning`，也不发布 | `execution/local.ts:33`；`run-state.ts:88` |
| 哪一层同时拿得到「验签身份 ＋ 项目」 | **只有 HTTP 请求 fiber** | 身份 `middleware/user-identity.ts:70-79` 注入 `User.Service`；项目 `core/session.ts:212` `projects.resolve(input.location.directory)` |
| core 会话 / runner 层拿得到身份吗 | **拿不到**。三处 deps 里都没有 `User.Service` | `core/session.ts:477-486`、`runner/llm.ts:426-441`、`store.ts:63` |
| 有可写的「每会话槽位」吗 | **没有**。`SessionStore` 只读；写路径只有事件投影器或 `SessionV2.create` 的直接 `db.insert` | `store.ts:14-24` |

**链 A 有一条上游自带的「每会话 ruleset」通道**（本次最重要的正面发现）：

```
Session.Info.permission（V1 形状，可选，schema/v1/session.ts:566）
  └─ SessionTools.resolve: ruleset: Permission.merge(input.agent.permission, input.session.permission ?? [])
       └─ 每个工具的 ctx.ask({ ruleset })          ← session/tools.ts:84-90
```

- ⚠️ **今天这个字段由调用方在 create 请求里传**：HTTP payload 就有
  `permission: Schema.optional(PermissionV1.Ruleset)`（`groups/session.ts:53`，落到 `session.ts:509/525`），
  另有 `setPermission` 可随时改（`:437`、`:780-782`）。
  ⇒ **今天「这个会话拿哪些工具权限」是客户端说了算的**——这正是 `FR-002` 要改掉的。
- **链 B 侧没有会话粒度的 ruleset 通道**：按会话取 ruleset 的现成机制是
  `PermissionV2.configured(sessionID, agentID)`（`core/permission.ts:137-145`），但它读的是
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
  `session.permission`（`groups/session.ts:53`）⇒ **客户端能自己决定自己有哪些工具权限**。
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

落点 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`：Tailwind 任意值
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
（`packages/opencode/src/tool/shell.ts:325` 只 import 那个 `.wasm`），而 `.wasm` 已随包落地；
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
3. **B 链（core）里 `tool.ts:95` 是唯一必经点**；**A 链（opencode v1）里没有单一必经点**——
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

`package.json:16` 的脚本原文是
`oxlint -c script/oxlintrc.openhive.json packages/app/src/{rail,center,topbar,workspace,auth}`
——只扫 **openhive 的 5 个前端目录**。004 的定制代码全在 `packages/core/src/access/`，
**不被这条门禁覆盖**，只有全局 `lint`（130 规则、非 openhive 配置）扫得到。
⇒ 本项目「给 openhive 自有代码加更严的 lint 配置」这件事，**目前只管前端**；core 侧的定制代码
没有专属配置。记在这里，收尾时再决定要不要扩（**不在 T003 里顺手扩**——那是另一件事）。

---

## 阻塞项

（无技术阻塞。**待裁一项**：D-05「谁在生产里跑迁移」——须在 T004 之前裁定，见 D0-3。）

## 最后更新

2026-10-04（开工：Step 0.5 实测 + 四条裁定 + T001 + 门禁基线落档 + T002 capability 结构 + T003 签发）
