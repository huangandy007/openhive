# 实施进度 · 权限控制

## 当前任务

**T005 已完成**（技能目录可见性 ＋ 模型侧工具清单验收，FR-003 / SC-003）。已 commit（3 个提交：
验收测试 `b0b0a6cb3f` ／ 上游改动【保留的定制】`310cda0d83` ／ T006 契约适配【保留的定制】`f114f00a7c`），
**停下等「next」**。收尾时发现并处置了 **T006 的一条回归**（上游 `prompt tools replace…` 测试 ⇒ 已按裁定
改为 merge 契约，见 T005 段 §5）。

**T006 已完成**（工具执行守卫 · 链 A，FR-004 / FR-002）。链 B 与审计**显式挂账**。

下一条可选：**T007**（MCP 身份 ＋ 受限数据库账号）／**T008**（RLS）／**T009**（结果大小控制）
／**T012–T014**（安全测试）。**T010 / T011 已移交 F7**（见 D0-4 段）。先做哪条由用户定。

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
| 上游自带默认规则集 | `packages/core/src/plugin/agent.ts:109-140` `{ action: "read", resource: "*.env", effect: "ask" }` |
| 「总是允许」存的两列 | `packages/core/src/permission/saved.ts:62` |
| 清单过滤的判据 | `packages/core/src/tool/registry.ts:113` `whollyDisabled(permission(tool, name), permissions)` |
| 链 B 断言 | `packages/core/src/tool/skill.ts:76` `permission.assert({ action: "skill", resources: [skill.name] })` |
| 链 A 断言 | `packages/opencode/src/tool/skill.ts:28` `ctx.ask({ permission: "skill", patterns: [params.name] })` |

而 `Wildcard.match`（`packages/core/src/util/wildcard.ts`）是**全串锚定**（`^…$`）——T004 第一版产出的
`{ action: "read", resource: "skill:fund-analysis" }` 两边字段都对不上，**全部落回兜底 `ask`**。
不报错、不变红、typecheck 照绿：`LEARNINGS #003-05` 的**假镜像**形状（写的时候以为对上了，其实只在一边成立）。

> 这也是一次**自己打自己脸**的复核：T004 收尾时我先说「所有消费者都用 `{工具名, 实参}`」，
> 随后实测发现链 A 的 MCP 资源工具用的是 `{ permission: "read", patterns: ["mcp:<server>:*"] }`
> （`packages/opencode/src/session/tools.ts:172-179` / `:346-347`）——**那句总结是错的**，当场向用户更正。
> 更正后的实测反而定住了裁定：**skill 维上两条链同构**（上表最后两行），所以改词表可行。

#### 三条裁定（用户 2026-10-04）

| 问题 | 裁定 | 落地 |
|---|---|---|
| 词表冲突怎么办 | **改 T004 的 `resolve()`**（不改消费者） | `rbac.ts` 加 `TOOL_OF` 对照表；`action` 取工具名、`resource` 取 `resourceId` |
| 四个 `perm` 都进吗 | **只有 `read` 进 ruleset** | `if (grant.perm !== "read") continue`。写 / 审 / 管是管理动作，今天没有承载它们的工具；仍留在表里，记账为「无消费者」 |
| `mcp` / `knowledge_base` 投不到怎么办 | **跳过 ＋ 显式记缺口**（指向 T007） | `if (tool === undefined) continue` ＋ 测试 ③ 断言 `Object.keys(TOOL_OF) === ["skill"]` |

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
| `bun run lint`（全局） | exit 1，**4941 warnings / 1 error / 130 rules / 3456 files** | 全局恒红；文件数 3452 → 3456（＝新增 4 个 `.ts`）。⚠️ warnings **4942 → 4941**：名称级差集查明消失的是 `packages/llm/src/tool-runtime.ts:63:44` —— **我没碰过的文件**，且无任何新条目出现，是 `#001-01` 记的 12 线程 ±1 抖动。**改动的 12 个文件里，上游三文件各带 1~3 处既有 warning，全部落在未触及的行**（`handlers/session.ts:426`／`prompt.ts:653`／`session.ts:13,14,15`），我用 `git diff -U0` 的 hunk 范围逐个核对过：我的改动行在 163-177·218-221／1061-1074／701-705。 |
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
   `packages/opencode/src/permission/index.ts:73` 是
   `evaluate(request.permission, pattern, ruleset, approved)`，而 `evaluate` 取 `findLast`
   ⇒ **`approved` 排在最后、它赢**。`approved` 是 `InstanceState` 里的**进程内**数组（同文件 `:51`，
   随实例销毁而失，**不落库**）。要出现这个洞，需要同一进程里先有一条 `ask`（= 当时没有 deny 盖住它）
   被点过「总是允许」——**门关着跑过 dev、或升级前的旧会话**都能造出这样一条。
   **不跨进程存活**，但同一进程内它对本 capability deny 全权生效。
   触发条件与判据逐字记在此处，不假装闭合。
5. `write` / `review` / `admin` 三个 `perm` 今天仍无消费者；`mcp` / `knowledge_base` 仍投不到
   工具断言（归 T007）—— 同上，落回 `ask`，**不生效但不误放行**。

---

### T005 · 技能目录可见性 ＋ 模型侧工具清单（FR-003 / SC-003）

**一句话**：T005 的字面出参（无权工具不出现在模型拿到的 `tools` 里）**不用新写代码**——T006 的
通道顺带做成了；T005 要做的是**把最后一个会话级可见性出口（系统提示词里的技能目录）也接到同一判据上**，
并用测试把这条不变式钉死。

#### 1. 前置实测：字面出参已经打得到（否则要去建 `tool-filter.ts`）

D0-1 已裁定 `plan.md:51` 的 `tool-filter.ts` 路径**判空**（链 A 的上游 `Permission.disabled` 就是
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
> `prompt.test.ts` 十余条，**均在本次改动行之外**（`system.ts:138` 那个函数本次根本没动，形状与
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

## 最后更新

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
