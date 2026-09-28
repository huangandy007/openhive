# 实施进度 · 认证与账号

## 当前任务
T002 [P] [BE] 锁定默认密码取值 + 密码哈希方案（argon2id）+ 凭证有效期

## 已完成

### T001 [P] [BE] 新建 Auth 服务模块目录与构建配置 ✅（2026-09-28）
- **落点** `packages/auth/`：`package.json`（`@opencode-ai/auth`，scripts `test`/`typecheck` 照 `packages/effect-drizzle-sqlite` 约定）、`tsconfig.json`（extends `@tsconfig/bun`）、`src/db.ts`、`src/db.test.ts`。
- **TDD 过程**（RED→GREEN 两轮 + 一次类型 RED）：
  1. RED `Cannot find module './db'` → GREEN `resolveDatabaseUrl` 最小实现（2 tests）
  2. RED 密码 `p@ss:w/rd` 未转义冲垮连接串结构 → GREEN 加 `encodeURIComponent`（3 tests）
  3. RED tsgo `TS2345: '[PGlite]' is not assignable`（运行时能跑、类型不合法）→ GREEN 改 `drizzle({ client: new PGlite() })`（位置传参不在类型签名里）
- **验收证据（真跑）**：`bun run typecheck` **31/31**（区间原 30，证明新包进 turbo 图）；包内 `bun test` **4 pass / 0 fail**；`bun run lint` 文件数 3348→**3350**、命中数 **4924 warnings / 1 error（与 001 基线逐字相同）** → 新增文件 0 命中；`bunx oxlint packages/auth` 0/0。
- **诚实标注**：`db.test.ts` 里「PG 工具链」那条**是冒烟测试，不是行为测试**——它断言的是第三方接线（drizzle + PGlite 能跑 SQL），没有 RED 阶段，价值在于拦住「依赖没装对/方言不通」这类问题（即本次 49 个假错的同类）。T001 真正被 TDD 覆盖的单元是 `resolveDatabaseUrl`。
- **未落的东西（有意）**：`connect()`（生产的 `drizzle-orm/bun-sql` 连接）**没写**——它需要真实 PG，离线测不了，先写就是「无测试的生产代码」。留到 T003 与迁移一并落地。

## 关键裁定（开工前，2026-09-28）

### ① R4 用户表存储 → 并入业务 PG，落独立 `auth` schema
- **裁定**：用户表存 `.env` 的 `PG_*` 所指向的 `openhive` 库，建独立 `auth` schema（`auth.user`）。
- **理由**：`user_role (user_id, role_id)`（design-v2 §14.3，`:878`）与 `fund_project_member (fund_project_id, user_id, ...)`（§14.1，`:442`）都在业务 PG，且 §14.1 写明数据范围是「运行时由 MCP 查询语句 join『数据项目 ↔ 用户』关联表实时算出」（`:847`）。账号表若另立存储，从 F4/F10（治理后台 = 账号 × 组织 × 角色 × 数据权限联合视图，PRD `:113`）起会持续制造跨存储 join。
- **否掉的备选**：Auth 自有 SQLite（跨存储 join）；同实例独立 database（PG 跨库无法 join，等于没解决）；public schema + 表名前缀（账号与业务混在同一命名空间，受限 DB 账号授权要按表逐个 GRANT）。
- **连带修订**：`plan.md` 的 Storage 行、Structure Decision、R4 行已同步。

### ② Auth 服务目录 → `packages/auth/`（原 plan 写顶层 `auth/`）
- **理由**：根 `package.json` workspaces = `packages/*`（+ `packages/console/*`、`packages/stats/*`、`packages/sdk/js`、`packages/slack`）。顶层 `auth/` **不是 workspace 成员**，turbo typecheck 与 `bun test` 都覆盖不到 → 架空宪法 §五质量门禁。落 `packages/auth/` 符合宪法 §三「包在 `packages/*`」，且不动上游 `package.json`（宪法 §一）。
- **连带修订**：`plan.md` 项目文件结构与 Structure Decision 已同步。

### ③ 实现方式（随 ①② 定下）
- 访问层：`drizzle-orm` + `drizzle-orm/bun-sql`（走 Bun 内建 SQL 客户端，**零新增驱动依赖**；drizzle-orm 1.0.0-rc.2 已含该 dialect）。
- 测试：`@electric-sql/pglite`（WASM 内嵌 PG，进程内跑，离线可跑、真 PG 语义如 UNIQUE 约束可验）。`drizzle-orm/pglite` dialect 已存在；`@electric-sql/pglite` 当前**不在依赖树**，需新增（devDependency 性质）。

## 环境基线（真跑所得，非推断）

### Step 0 验证（2026-09-28）
| 项 | 结果 |
|---|---|
| `git merge-base --is-ancestor multi-tenant HEAD` | ✅ 退出码 0，基点正确（绕开 `#001-03`） |
| 分支 | `worktree-feat-002-auth-account` |
| `bun run typecheck` | ✅ `30 successful, 30 total`，exit 0 |

> ⚠️ **worktree 首次 typecheck 必须先 `bun install`**：本 worktree 初始无 `node_modules`，首跑 `@opencode-ai/app#typecheck` 报 **49 个假错**（TS2307「Cannot find module 'solid-js' / 'bun:test' / 'fuzzysort' / '@opencode-ai/ui' …」+ TS7026/TS2875 JSX.IntrinsicElements），**不是** Step 0 预设的 `core.symlinks` 问题（那是 TS1128，且本机未复现）。`bun install` 后同一命令即 30/30 全绿。
> `bun install` 唯一报错：`tree-sitter-powershell` 的 node-gyp 原生编译失败（本机无 Visual Studio C++），属**预存局部环境问题**，不影响 TS 模块解析。

### 基础设施（`.env` 预置，代码侧零引用 —— 002 是首个连 PG 的 feature）
- `PG_HOST=8.136.21.218` / `PG_PORT=35432` / `PG_DATABASE=openhive` — TCP 端口**实测可达**（2026-09-28）
- 另有 `DEEPSEEK_*` / `MINIO_*` / `RABBITMQ_*` / `RAGFLOW_*`（本 feature 不用）
- 全仓库 `*.ts/tsx/json/md/toml/yaml/yml` 内 **`PG_` 零命中** → PG 访问层（连接 + 迁移 + 回滚）需本 feature 从零建

## 阻塞项
（无）

## 最后更新
2026-09-28（T001 完成并全门禁验证通过；等待「next」进 T002）
