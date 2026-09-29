# 实施进度 · 认证与账号

## 当前任务
T005 [P] [BE] 实现登录凭证签发与下发（JWT + httpOnly Cookie）

## 已完成

### T004 [P] [BE] 密码哈希与校验函数 ✅（2026-09-29）
**交付物**：`src/password.ts` —— `hashPassword(plain)` / `verifyPassword(plain, hash)`。

设计意图：这是**唯一**接触密码哈希的地方。T006（录入）、T013（改密）、T017（重置）都走这两个函数，
哪天要换算法只改一处。算法取值从 `policy.ts` 取，不在此处硬编码——「锁定值只写在 policy 里」。

**TDD 过程**：RED「Cannot find module './password'」→ GREEN 两个函数（argo2id 由 `Bun.password` 承担）。

**有牙验证**：把 `policy.ts` 的 `PASSWORD_HASH_ALGORITHM` 临时改成 `"bcrypt"` → **只有**「算法锁定为 argon2id」那条变红，
其余 4 条不受影响 → 证明 policy → password 的接线是真的（否则该测试只靠 Bun 默认值恰好也是 argon2id 而「假绿」）。

**验收证据（真跑）**：包内 `bun test` **24 pass / 0 fail**；`bun run typecheck` **31/31**；
`bun run lint` 文件数 3356→**3358**、命中数 **4924 warnings / 1 error**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ 新增文件 0 命中；
`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

## 交接项（留给后续 task，勿丢）

### ⚠️ → T009：`verifyPassword` 对畸形 hash 的两种表现（实测）
| 输入 | `Bun.password.verify` 表现 |
|---|---|
| 正常 argon2id hash | `true` / `false` |
| 空串 `""` | `false`（不抛） |
| 垃圾串 `"not-a-hash"` | **抛** `Password verification failed with error "UnsupportedAlgorithm"` |

T004 **有意不兜**（库里的 hash 由本模块自己写入，畸形属「不可能的输入」，提前防御是投机）。
但 T009 的登录路径必须决定：垃圾 hash 抛出去就是 HTTP 500，而 FR-005 要求**统一提示「账号或密码错误」**——
500 与统一提示不同，等于**变相泄露「这个账号有异常」**。届时要么在登录层兜住，要么论证它确实不可能发生。

### T003 [BE] 实现用户表模型与迁移 + PG 连接 ✅（2026-09-29）
**交付物**（`packages/auth/src/`）：

| 文件 | 职责 |
|---|---|
| `migrations/0001_init.sql` | `auth.user` 建表（15 列，design-v2 §4.1 逐字） |
| `migrations/0001_init.down.sql` | `DROP TABLE auth.user` |
| `migrate.ts` | `migrate()` / `rollback()` / `rowsOf()` |
| `user.ts` | drizzle pg-core 模型（**只做类型安全查询**） |
| `db.ts` | 补 `connect()`（`drizzle-orm/bun-sql`） |

**迁移机制（用户裁定：手写 up/down）**：
- 运行器**自动执行**，PG 里不需要人工敲任何 SQL（这是用户此前问清的点）。
- 记账表 `auth._migration (version, applied_at)` 让 `migrate()` 幂等——部署可无脑重复调。
- `auth` schema 由运行器 bootstrap（`create schema if not exists`），不写在 0001 里。
- 语句按 `--> statement-breakpoint` 切分逐条执行（drizzle-kit 同款约定）：多语句一次下发在各驱动上不可移植。

**TDD 过程**（RED→GREEN，逐条看过失败）：
1. RED「Cannot find module './migrate'」→ GREEN 建表 + 唯一约束
2. RED「relation "user" already exists」（重复执行）→ GREEN 加记账表
3. RED「rollback is not defined」→ GREEN 加 down 脚本与 `rollback()`
4. RED「Cannot find module './migrate'」（db.test）→ GREEN 加 `connect()`
5. 补 `rowsOf` 三态单测后**做了「拆掉实现看是否变红」的有牙验证**——只数组那条红，另两条不受影响

**诚实标注**：
- 「警号唯一约束」与「建表」共用同一份 DDL、同一次 GREEN，**无独立 RED**（DDL 是先写下的断言、再照它写 SQL，不是事后补测）。
- 防漂移测试里 `DESIGN_V2_COLUMNS` 是我从 design-v2 §4.1 的**人工转录**，不是机器解析。它保证「SQL ↔ drizzle 模型」不漂移，但**挡不住两侧同时抄错**。要做成机器校验需解析设计文档，超出本 task。
- 迁移文件是**运行时从磁盘读**的（`import.meta.dir`），不参与打包。若日后改成 bundle 部署，需确认 `.sql` 被打进产物。

**验收证据（真跑）**：包内 `bun test` **19 pass / 0 fail**；`bun run typecheck` **31/31**；`bun run lint` 文件数 3350→**3356**、命中数 **4924 warnings / 1 error**（与 001 基线逐字相同，那 1 error 仍是登记在案的上游 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`）→ 新增文件 0 命中；`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

### T002 [P] [BE] 锁定认证策略 ✅（2026-09-28）
方案记录在案（可执行版落在 `packages/auth/src/policy.ts`）：

| 项 | 锁定值 | 来源 |
|---|---|---|
| 默认密码 | `admin@123456` | design-v2 §4.1（`2026-09-06-openhive-design-v2.md:147`）**已定，沿用未改**（用户确认） |
| 哈希算法 | `argon2id` | plan.md 依赖清单；用 **`Bun.password` 内建**实现（实测产出 `$argon2id$v=19$m=65536,t=2,p=1$`，verify 正确/错误均正确）→ **零新增依赖** |
| 凭证有效期 | 7200 秒（2 小时） | spec.md FR-004 / Assumptions |
| JWT 库 | `hono/jwt` | 用户裁定。实测 **`Bun.jwt` 不存在**（已排除）；`hono` 4.10.7 已在 catalog → 依赖在 T005 落 |

- **测试样例**：`src/policy.test.ts`（5 条）——常量契约 2 条 + argon2id 安全属性 3 条（哈希不含明文、**同一密码两次哈希不同**/盐随机、verify 往返）。
- **诚实标注**：argon2id 那 3 条**不是本模块的行为测试**，它们断言的是 `Bun.password` 的行为；价值在于**锁定方案**——若有人日后换成固定盐或换掉算法，这几条会红。真正的行为测试从 T004（哈希函数）起。
- 验收：包内 `bun test` **9 pass / 0 fail**；`bun run typecheck` **31/31**；`bunx oxlint packages/auth` 0/0。

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

### ④ 两个 PG 驱动的 `execute()` 行结构不同（T003 实测，类型系统当场抓到）
- `drizzle-orm/pglite` → 结果形如 `{ rows: [...] }`；`drizzle-orm/bun-sql` → **直接就是行数组** `[...]`。
- **发现方式**：`db.test.ts` 里写了 `const target: MigrationTarget = connect(env)`，tsgo 报 TS2322 当场暴露。
  若无此断言，这坑会潜伏到部署连真 PG 时才炸（且症状是 `undefined.map`，不好归因）。
- **应对**：`MigrationTarget` 的 `execute()` 返回值收成 `unknown`，由 `rowsOf()` 显式抹平两种形态；
  两种都不像时报错而非静默返回空。**不能用 `PgAsyncDatabase<any, any>`「抹平」**——实测它确实能让两个驱动都编译通过，
  但那只是把类型警报掐掉：运行时 `result.rows` 在 bun-sql 上仍是 `undefined`。
- 附带：`drizzle-kit` **没有 down/回滚能力**（只有 generate/migrate/push…），这也是「手写 up/down」更稳的一条实证。

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
2026-09-29（T004 完成并全门禁验证通过；等待「next」进 T005）
