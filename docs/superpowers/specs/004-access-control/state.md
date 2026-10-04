# 实施进度 · 权限控制

## 当前任务

**T001 已完成**（工具执行挂载点清单，见下「已完成」），**质量门禁基线已实测并落档**（见下）。
已 commit，**停下等「next」**才进 T002。

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

---

## 阻塞项

（无技术阻塞。**待裁一项**：D-05「谁在生产里跑迁移」——须在 T004 之前裁定，见 D0-3。）

## 最后更新

2026-10-04（开工：Step 0.5 实测 + 四条裁定 + T001 + 门禁基线落档）
