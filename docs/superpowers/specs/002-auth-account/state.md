# 实施进度 · 认证与账号

## 当前任务
T008 [US1] [BE] 实现警号唯一性校验（重复录入拒绝）

## 已完成

### T007 [US1] [BE] 录入时创建沙箱目录 ✅（2026-09-29）
**交付物**：`src/workspace.ts`（`workspaceRoot` / `createWorkspace` / `WORKSPACE_ROOT_ENV`）+ `workspace.test.ts`（6 条）；
`register.ts` 增 `provisionUser(db, input, workspaceRoot)` → `{ id, workspace }` + 4 条流程测试。

**为什么要有 `provisionUser`**：FR-003 要求「建账号」与「建沙箱」一次发生。若只提供两个独立函数，
后续每个调用方都得自己记着按序调两个——FR-003 就没有代码承载点，漏调不会被任何东西发现。

**顺序裁定：先落库、后建目录**，且**有测试钉住**（那条「落库被拒时不留垃圾目录」）：
- 重复警号（T008 的主场）在落库这步被 PG UNIQUE 挡下，此时目录还没建 → **不留垃圾目录**。这是更常见的失败。
- 反过来先建目录、落库失败，每次重试漏一个空目录。
- 该测试对 T008 的实现方式是健壮的：无论 T008 是预检查还是捕获 23505，都不会建出目录。

**建目录失败时不做补偿删除**：PG 事务管不到文件系统。曾考虑「建目录失败就把已插入的行删掉」/「落库失败就把目录删掉」，
均否掉——`rm -rf` 一个用户沙箱是**破坏性**操作，里面可能有真实研判产物，而补偿逻辑本身也可能有 bug。
宁可留一个空目录（零成本、可人工清理），也不冒误删用户数据的风险。故障原样抛出，不静默返回一个没有沙箱的账号。

**路径穿越守卫**：`userId` 为空、含 `/` 或 `\`、或等于 `.` / `..` 时拒绝。
依据 design-v2 §5.3（`2026-09-06-openhive-design-v2.md:229`）——`{userId}` 就是**用户之间的隔离边界**，
「应用层锚定（防越权）」正是该节列的第一道锁。当前调用方传的是 `crypto.randomUUID()`（不可能触发），
但 F3 的中间件也会走这个函数，在唯一的建目录入口守一次比在每个调用点守可靠。

**`OPENHIVE_WORKSPACE_ROOT`**：新增环境变量，未配置时落到 design-v2 规定的 `/workspaces`。
有默认值（区别于 `AUTH_JWT_SECRET` 的「缺了就报错」）——因为文档已把 `/workspaces` 定为标准路径，
配了反而多一步。**但需要部署方确认挂载点**，见下方「待补环境变量」。

**TDD 过程**：RED「Cannot find module './workspace'」→ GREEN 6 条；再 RED「Export named 'provisionUser' not found」→ GREEN 流程 4 条。
**有牙验证**：① 顺序倒置成「先建目录」→ **2 条红**；② 拆掉穿越守卫 → 1 条红。两次均恢复干净、无残留。

**验收证据（真跑）**：包内 `bun test` **55 pass / 0 fail**（9 文件）；`bun run typecheck` **31/31**；
`bun run lint` 文件数 3364→**3366**、命中数 **4924 warnings / 1 error**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ **`packages/auth` 0 命中**；
`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

> ⚠️ **未接生产**：`workspaceRoot(env)` 目前无生产调用方（HTTP 层在 T009/T018 才出现）。
> 但它是纯函数、离线可测，与 T005 的 `jwtSecret(env)` 同性质，故不适用 T001 那条「无测试的生产代码」的推迟理由。

### T006 [US1] [BE] 管理员录入账号 ✅（2026-09-29）
**交付物**：`src/register.ts`（`registerUser` / `UserInsertTarget` / `RegisterInput`）+ `register.test.ts`（7 条）；
`src/time.ts`（`nowSeconds`）+ `time.test.ts`（2 条）。

**窄接口**：`UserInsertTarget` 只收「能往 `user` 表插一行」这一件事。两种驱动的 drizzle 数据库类型**互不可赋值**
（探测确认根因同裁定 ④：`Results<never>` vs `never[]`）。`values` 的入参类型从 `user.$inferInsert` **推导**而非手抄——
顺带发现这个位置**不是**双变放水的：字段不全的入参会被拒，且所有 NOT NULL 列都必须提供。
`db.test.ts` 加了一条类型标注断言，钉住**生产驱动（bun-sql）**也满足该接口——否则它只被 PGlite 验证过。

**两个默认值显式写出**（不靠列默认值）：
- `isAdmin: 0` —— 8 个业务字段里没有「是否管理员」，所以录入出来的账号一律不是管理员。**提权必须是另一条独立路径**，
  否则管理员录入界面本身就成了提权入口。
- `mustChangePw: 1` —— FR-003 的**要求**，写在调用点才看得见。

**🔴 本 task 撞到并修掉一个真缺陷（已请用户裁定）**：
用户表时间列在 design-v2 §4.1 是 PG `integer`（int4 上限 **2147483647**），而 `Date.now()` 返回**毫秒**（1.79e12）——
超三个数量级，`22003 numeric_value_out_of_range`，**首行都插不进去**。文档只写了 `INTEGER` 没写单位，属真实二义。
用户裁定 **A：沿用 INTEGER、统一存 Unix 秒**（理由：与文档吻合；与 JWT `exp` 同单位，同一模块不混两套时间单位；
将来要扩到 2038 之后，`alter column ... type bigint` 是**值不变**的加宽）。
落地四点：① 新增 `src/time.ts` 的 `nowSeconds()`，名字自带单位；② `register.ts` 与 `migrate.ts` 记账表都改走它
（记账表原先也是毫秒，属同一处内部不一致，一并纠正）；③ `0001_init.sql` 与 `user.ts` 补单位注释；
④ 加**单位锁**测试（断言与 `Date.now()/1000` 同量级），防复发。

**TDD 过程**：RED「Cannot find module './register'」；时间单位先写 `time.test.ts` RED → GREEN；
`created_at` 单位断言先加 RED（当时 7 条全红，全因毫秒）→ 改 `register.ts` GREEN。
**有牙验证**：把 `nowSeconds()` 临时改成 `Date.now()` → **9 条齐红**（时间锁 + 7 条录入 + 记账单位），恢复后全绿、无残留。

**验收证据（真跑）**：包内 `bun test` **45 pass / 0 fail**（8 文件）；`bun run typecheck` **31/31**；
`bun run lint` 文件数 3360→**3364**、命中数 **4924 warnings / 1 error**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ **`packages/auth` 0 命中**；
`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

> 📌 **未做（有意）**：警号唯一性拒绝（T008）、沙箱目录创建（T007）都不在本 task 内。数据库层 UNIQUE 约束已在迁移里，
> 本 task 录入重复警号会撞 PG 23505 直接抛——**友好的拒绝提示留给 T008**。

### T005 [P] [BE] 登录凭证签发与下发（JWT + httpOnly Cookie）✅（2026-09-29）
**交付物**：`src/token.ts`（`jwtSecret` / `signToken` / `verifyToken` / `sessionCookie`）+ `src/token.test.ts`（10 条）；
`policy.ts` 补 `SESSION_COOKIE_NAME = "openhive_session"`、`JWT_SECRET_ENV = "AUTH_JWT_SECRET"`；
`package.json` 加 `hono: catalog:`（实测解析到 4.10.7，`bun.lock` 仅 +1 行）。

**线格式契约**：载荷是 `{ sub, police_no, name, is_admin, exp }`，与 design-v2 §4.1（`2026-09-06-openhive-design-v2.md:150`）逐字对齐。
专门写了一条**不验签、直接 base64 解载荷**的测试断言 `Object.keys`——只断言 `verifyToken().id === "u1"` 挡不住「内部映射对了、线上字段名写错」，
而字段名是跨服务契约，错了要到前端或网关才炸。

**`verifyToken` 的载荷校验**：4 个 claim 全类型正确才返回。这不是「防御不可能的输入」——函数签名承诺返回完整 `TokenSubject`，
不校验就会让调用方拿到 `undefined` 却被类型告知是 `string`。`is_admin` 要求 `boolean` 而非 truthy，避免 `"false"` 这类字符串被判为真。

**Cookie 设计**：`httpOnly` + `sameSite=lax` + `path=/`，`maxAge` 取 `TOKEN_TTL_SECONDS`。
**`secure` 默认关**（可选参数开）——内网部署多为 HTTP，置 true 浏览器会**静默丢弃** Cookie，症状是「登录成功但立刻又未登录」，极难归因；网关前挂 HTTPS 时再由调用方开。

**🔑 运维动作（需用户执行）**：新增环境变量 **`AUTH_JWT_SECRET`**，`.env` 目前**没有**这一项（现有仅 `PG_*` / `DEEPSEEK_*` / `MINIO_*` / `RABBITMQ_*` / `RAGFLOW_*`）。
`jwtSecret()` 缺值**点名报错、不兜默认值**——仓库里放默认密钥等于给所有人发万能钥匙。部署前需生成一个随机串写入 `.env`。

**TDD 过程**：RED「Cannot find module './token'」→ GREEN 4 个函数。
**有牙验证**：临时停掉 `verifyToken` 的载荷校验 → **只有**「签名合法但载荷缺字段的凭证被拒」变红，其余 9 条不受影响 → 证明该断言咬的是真实逻辑。
**自纠**：token.test.ts 首版有 4 处 `await expect(...).rejects.toThrow()` 触发 `await-thenable` 告警（Bun 把 `rejects.toThrow()` 类型标为非 Promise）——
改为 `failureOf()` 显式 catch 助手，既消警又让「抛没抛」成为可断言的返回值。

**验收证据（真跑）**：包内 `bun test` **34 pass / 0 fail**（6 文件）；`bun run typecheck` **31/31**；
`bun run lint` 文件数 3358→**3360**、命中数 **4924 warnings / 1 error**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ **`packages/auth` 0 命中**；
`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

> ⚠️ 过程记录：本 task 首次全量 lint 读出 **4923**（比基线少 1）。未按「大概是抖动」放过，而是**同代码连跑两次复核**——两次均 **4924**，
> 与基线一致，且 `packages/auth` 0 命中、唯一 error 位置未变。故判定为 `#001-01` 记录的 oxlint 12 线程计数抖动，非回归。

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

### ⑤ 时间列一律存 **Unix 秒**（T006 请用户裁定）
- **背景**：design-v2 §4.1 的用户表时间列写 `integer` 但**没写单位**。PG `integer` = int4，上限 `2147483647`；
  Unix 毫秒现在是 `1.79e12`——T006 首次录入账号时实测 `22003 numeric_value_out_of_range`，**一行都插不进去**。
  这不是「防御不可能的输入」，是眼前就挡路的真缺陷，且 T003 已把它提交进 0001_init。
- **裁定（用户选 A）**：列类型沿用 `integer`，**存 Unix 秒**。上限 2038-01-19，将来要扩则
  `alter table auth.user alter column created_at type bigint` 属**值不变**的加宽，非破坏性迁移。
- **否掉的备选 B**：改 `bigint` 存毫秒 —— 偏离 design-v2 原文，且会与 JWT 的 `exp`（本来就是秒）在同一个模块里并存两套单位，
  早晚有人拿 `last_login_at` 去和 `exp` 比。
- **落地约定（后续 task 必须遵守）**：写入一律走 `src/time.ts` 的 `nowSeconds()`，**不要直接写 `Date.now()`**。
  迁移记账表 `_migration.applied_at` 一并从毫秒纠正为秒（内部记账，列类型仍 bigint，只看单位）。
- **防复发**：`time.test.ts` 断言 `nowSeconds()` 与 `Date.now()/1000` 同量级（写成毫秒即红）；`register.test.ts` 与
  `migrate.test.ts` 各有一条断言落库值量级。**有牙验证**：把 `nowSeconds()` 改成毫秒 → 9 条齐红。

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

### 🔑 待补环境变量（部署前必须，T005 引入）
| 变量 | 状态 | 用途 |
|---|---|---|
| `AUTH_JWT_SECRET` | ❌ **`.env` 中尚无**，需部署方生成随机串写入 | `src/token.ts` 签发/校验 JWT 的 HS256 密钥 |
| `OPENHIVE_WORKSPACE_ROOT` | ⚠️ **可选**，未配置时用 `/workspaces` | 每用户沙箱目录的根（`src/workspace.ts`） |

代码侧**不提供默认值**：`jwtSecret()` 缺值时点名报错（`缺少环境变量 AUTH_JWT_SECRET`）。理由见 T005 节。
`OPENHIVE_WORKSPACE_ROOT` 相反——**有默认值**，因为 design-v2 §5.3 已把 `/workspaces` 定为标准路径；
只有当部署环境的挂载点不是 `/workspaces` 时才需要配。

## 阻塞项
（无）

## 最后更新
2026-09-29（T007 完成并全门禁验证通过；等待「next」进 T008）
