# Tasks: 认证与账号

**Input**: `docs/superpowers/specs/002-auth-account/`

**Prerequisites**: spec.md（用户故事）、plan.md（结构 / 集成点）

**Tests**: 认证逻辑以「受影响 package 的 bun test」覆盖登录/改密/停用/僵尸识别；隔离测试（用户 A 不能冒充用户 B）在 F3 一并验收。

## 任务格式约定

- `[P]` = 可并行（不同文件、无依赖）
- `[USn]` = 所属用户故事
- `[FE]` = 前端 / `[INT]` = 前后端集成 / `[BE]` = 后端。本 feature 主体是 Auth 后端，前端仅登录页 + 改密弹窗。
- `[FE]` 任务标注「换皮」或「新增」：**换皮** = 改 opencode 已有组件 token；**新增** = 新建 openhive 组件（本 feature 前端全为新增）。token 映射见 plan.md「前端换皮区」。
- 每条含 `[FR-x 来源] [依赖任务] [出参验证方式]`

## Phase 1: Setup（服务骨架 + 方案锁定）

- [x] T001 [P] [BE] 新建 Auth 服务模块目录与构建配置 [FR-001] [无依赖] [出参：模块可编译、typecheck 通过]
  - 落点 `packages/auth/`（非 plan 原写的顶层 `auth/`，理由见 plan.md Structure Decision + state.md 裁定 ②）
  - 实测出参：`bun run typecheck` turbo 任务数 **30 → 31**（证明 `packages/auth` 真进图，没被静默跳过）；包内 `bun test` 4 pass；`bun run lint` 命中数与 001 基线逐字相同（新增文件 0 命中）
  - 含 PG 连接层 `src/db.ts`（`resolveDatabaseUrl`，TDD）+ PGlite 工具链冒烟；`connect()` 留待 T003 与迁移一并落地（避免先写无测试的生产代码）
  - 新增依赖：`drizzle-orm`（catalog）、`@electric-sql/pglite@0.5.8`（devDep，测试用）
- [x] T002 [P] [BE] 锁定默认密码取值 + 密码哈希方案（argon2id）+ 凭证有效期 [FR-003][FR-004] [无依赖] [出参：方案记录在案，纳入测试样例]
  - 默认密码 `admin@123456` —— design-v2 §4.1（`:147`）**已定，沿用未改**（用户确认）
  - 哈希 argon2id —— `Bun.password` 内建（实测产出 `$argon2id$v=19$m=65536,t=2,p=1$`），**零新增依赖**
  - 凭证有效期 2 小时 —— spec.md FR-004
  - JWT 库定 `hono/jwt`（实测 `Bun.jwt` **不存在**已排除；`hono` 4.10.7 已在 catalog）→ 依赖落 T005
  - 落点 `src/policy.ts`（常量）+ `src/policy.test.ts`（5 条，含「同密码两次哈希不同」的盐随机性断言）

## Phase 2: Foundational（账号实体 + 密码 + 凭证）

- [x] T003 [BE] 实现用户表模型与迁移（8 业务字段 + 系统字段）[FR-001] [T001] [出参：表结构建出，警号唯一约束生效]
  - 迁移机制定为**手写 up/down**（用户裁定）：`src/migrations/0001_init.sql` + `0001_init.down.sql` 成对
  - `src/migrate.ts`：`migrate()`（记账表 `auth._migration`，幂等可重复执行）+ `rollback(db, version)`
  - `src/user.ts`：drizzle pg-core 模型，**只负责类型安全查询**；表真相来源是 SQL 文件
  - `src/db.ts` 补 `connect()`（`drizzle-orm/bun-sql`，零新增驱动依赖；连接惰性）
  - 实测出参：包内 `bun test` **19 pass / 0 fail**；`bun run typecheck` **31/31**；`bun run lint` 4924w/1e 与基线逐字相同（`packages/auth` 0 命中）；`bunx oxlint packages/auth` 0/0
  - ⚠️ 类型断言「生产驱动满足 MigrationTarget」**当场抓到** bun-sql 与 PGlite 的 `execute()` 行结构不同（数组 vs `{rows}`）——见 state.md 裁定 ④
- [x] T004 [P] [BE] 实现密码哈希与校验函数（argon2id）[FR-004] [T001] [出参：哈希/校验往返单测通过]
  - 落点 `src/password.ts`：`hashPassword()` / `verifyPassword()`，**唯一**接触密码哈希的地方（T006/T013/T017 都走它）
  - 算法从 `policy.ts` 取（`PASSWORD_HASH_ALGORITHM`），不在此处硬编码
  - 实测出参：包内 `bun test` **24 pass / 0 fail**（5 条新测试）；`bun run typecheck` **31/31**；`bun run lint` 4924w/1e 与基线逐字相同（`packages/auth` 0 命中）；`bunx oxlint packages/auth` 0/0
  - 有牙验证：把 `policy.ts` 的算法临时改成 bcrypt → 只有「算法锁定」那条变红，证明接线是真的
  - ⚠️ **交接 T009**：实测 `Bun.password.verify` 对**空 hash** 返回 `false`，对**垃圾 hash 抛** `UnsupportedAlgorithm`。登录路径需决定是否兜住——见 state.md「交接项」
- [x] T005 [P] [BE] 实现登录凭证签发与下发（JWT + httpOnly Cookie）[FR-004] [T001] [出参：签发凭证可被校验解析出 userId]
  - 落点 `src/token.ts`：`jwtSecret()` / `signToken()` / `verifyToken()` / `sessionCookie()`；库用 `hono/jwt`（用户裁定），算法 HS256
  - 载荷字段**逐字对齐 design-v2 §4.1 线格式**：`{ sub, police_no, name, is_admin, exp }`，有专门一条测试断言 `Object.keys` 而非只看 `id`——防「内部映射对了、线上字段名错了」
  - `verifyToken` 校验全部 4 个 claim 后才返回；`is_admin` 必须是 `boolean`（非 truthy 判断）——返回类型承诺了完整 `TokenSubject`，校验是让承诺不说谎
  - Cookie：`httpOnly` + `sameSite=lax` + `path=/`，`maxAge` 取自 `TOKEN_TTL_SECONDS`。**`secure` 默认关**（内网多为 HTTP，置 true 浏览器会静默丢弃 Cookie，症状是「登录成功立刻又未登录」）
  - 新增环境变量 **`AUTH_JWT_SECRET`**：`jwtSecret()` 缺值时**点名报错、不兜默认值**（宪法 §二·II 品牌化/配置不硬编码；默认密钥入库等于给所有人发万能钥匙）→ **部署方需在 `.env` 补这一项**，见 state.md
  - 实测出参：包内 `bun test` **34 pass / 0 fail**（10 条新测试）；`bun run typecheck` **31/31**；`bun run lint` 4924w/1e 与基线逐字相同（`packages/auth` 0 命中）；`bun run lint:openhive` exit 0；`bunx oxlint packages/auth` 0/0
  - 有牙验证：临时停掉载荷校验 → 只有「载荷缺字段被拒」那条变红，其余 9 条不受影响

## Phase 3: US1 管理员录入（P1）

- [x] T006 [US1] [BE] 实现管理员录入账号（8 字段 + 默认密码 + must_change_pw=1）[FR-002][FR-003] [T003][T004] [出参：录入后账号可登录且被标记需改密]
  - 落点 `src/register.ts`：`registerUser(db, input)` → `{ id }`（T007 拿这个 id 建沙箱目录）
  - `UserInsertTarget` 窄接口：两种 PG 驱动的 drizzle 数据库类型**互不可赋值**（根因同裁定 ④），只收「能往 user 表插一行」；`values` 入参从 `user.$inferInsert` **推导**，列名漂移与漏填 NOT NULL 列都由编译器兜住
  - `isAdmin: 0` 显式写出：8 个业务字段里没有「是否管理员」，故录入出来的账号一律不是管理员——提权必须是另一条独立路径，否则录入界面就成了提权入口
  - `mustChangePw: 1` 显式写出而非靠列默认值：这是**要求**，写在调用点才看得见
  - 🔴 **撞到并修掉一个真缺陷**：用户表时间列在 design-v2 §4.1 是 PG `integer`（int4 上限 2147483647），而 `Date.now()` 是毫秒（1.79e12）→ `22003 numeric_value_out_of_range`，**首行都插不进去**。经用户裁定选 **A：沿用 INTEGER、统一存 Unix 秒**（与 JWT `exp` 同单位）。落地：新增 `src/time.ts` 的 `nowSeconds()`，register 与迁移记账表都改走它；迁移 SQL 与 `user.ts` 补单位注释；加单位锁测试防复发
  - 实测出参：包内 `bun test` **45 pass / 0 fail**（+11：录入 7、时间单位 2、记账单位 1、生产驱动接口 1）；`bun run typecheck` **31/31**；`bun run lint` 4924w/1e 与基线逐字相同（`packages/auth` 0 命中）；`bun run lint:openhive` exit 0；`bunx oxlint packages/auth` 0/0
  - 有牙验证：把 `nowSeconds()` 临时改成 `Date.now()`（毫秒）→ **9 条齐红**（时间单位锁 + 全部 7 条录入 + 记账单位），恢复后 45 全绿、无残留
- [x] T007 [US1] [BE] 实现录入时创建沙箱目录 `/workspaces/{userId}/` [FR-003] [T006] [出参：录入后沙箱目录存在]
  - 落点 `src/workspace.ts`：`workspaceRoot(env)`（默认 `/workspaces`，可被 `OPENHIVE_WORKSPACE_ROOT` 覆盖）+ `createWorkspace(root, userId)`
  - 落点 `src/register.ts` 增 `provisionUser(db, input, workspaceRoot)` → `{ id, workspace }`：把「建账号 + 建沙箱」做成一件事，FR-003 才有代码承载点（否则后续调用方得记着按序调两个函数）
  - **顺序：先落库、后建目录**，并有测试钉住（不是只写在注释里）——重复警号在落库这步就被 UNIQUE 挡下，此时目录还没建，**不留垃圾目录**；反过来先建目录则每次重试漏一个空目录
  - **建目录失败不做补偿删除**：PG 事务管不到文件系统，而 `rm -rf` 用户沙箱是破坏性操作（里面可能有真实研判产物），宁可留空目录也不冒误删风险。故障原样抛出，不静默返回没有沙箱的账号
  - 路径穿越守卫：`userId` 含 `/`、`\`、`.`、`..`、空串则拒。design-v2 §5.3 明写 `{userId}` 就是隔离边界，「应用层锚定防越权」；当前调用方传 `crypto.randomUUID()`，但 F3 中间件也走这里
  - 实测出参：包内 `bun test` **55 pass / 0 fail**（+10：workspace 6、录入流程 4）；`bun run typecheck` **31/31**；`bun run lint` 4924w/1e 与基线逐字相同（`packages/auth` 0 命中）；`bun run lint:openhive` exit 0；`bunx oxlint packages/auth` 0/0
  - 有牙验证：① 把顺序倒置成「先建目录」→ **2 条红**（含那条顺序钉）；② 拆掉路径穿越守卫 → 对应 1 条红。两次均恢复干净
  - ⚠️ **未接生产**：`workspaceRoot(env)` 目前没有生产调用方（HTTP 层在 T009/T018），env 变量名按约定先定下来
- [x] T008 [US1] [BE] 实现警号唯一性校验（重复录入拒绝）[FR-001] [T003] [出参：重复警号录入被拒]
  - 落点 `src/register.ts`：`DuplicatePoliceNoError` + `insertUser()` 把 PG `23505` 翻译成领域错误；`registerUser` 拆出私有 `insertUser` 以便挂捕获
  - **靠捕获 23505，不做前置 SELECT 预检**：预检有 TOCTOU 竞态——两个管理员同时录同一警号，双方都过预检，仍有一个撞 UNIQUE；既然省不掉捕获，预检只是多一次查询
  - **只翻译 23505**：42P01 之类原样抛出，绝不误判成「警号重复」。有一条测试专门钉这个（先 `drop table` 再造错）
  - 原错误保留在 `cause` 上，不丢排查线索
  - 新增 `src/pg-errors.ts`：`pgErrorCode()` 从 drizzle 包装错误的 `cause` 上取 SQLSTATE。**这是 T003 测试里那段逻辑的抽取**（生产 T008 起也要用），`migrate.test.ts` 改为 import，两边共用一份——顺带消除重复
  - 实测出参：包内 `bun test` **62 pass / 0 fail**（+7：唯一性 5、pgErrorCode 2）；`bun run typecheck` **31/31**；`bun run lint` 4924w/1e 与基线逐字相同（`packages/auth` 0 命中）；`bun run lint:openhive` exit 0；`bunx oxlint packages/auth` 0/0
  - 有牙验证：把「只翻译 23505」放宽成「翻译所有错误」→ 那条防误判测试变红
  - ⚠️ **重构披露**：改动了 T003 的 `migrate.test.ts`（删掉其局部 `pgErrorCode`，改为 import）。这是消除本次抽取产生的重复，非顺手改无关代码

## Phase 4: US2 警号登录（P1）

- [x] T009 [US2] [INT] 实现登录流程（校验密码 → 签发凭证）[FR-004] [T004][T005] [出参：正确凭证登录拿到可校验的会话 Cookie]
  - 落点 `src/login.ts`：`login(db, input, secret)` → `{ token, cookie, subject, mustChangePw }`；`UserLoginTarget` 窄接口（select 查人 + update 记登录），同因裁定 ④
  - **⚠️ 出参里的「进入主界面」未做也做不了**：plan.md 的文件结构里没有 HTTP 层，002 也没有 UI 目录，故 [INT] 落点是**服务层集成**（把 T003 用户表 / T004 密码 / T005 凭证接起来）。「进入主界面」需要 T010 登录页 + F1 三栏，属前端任务。**已就此向用户提出，见 state.md**
  - 🔴 **关掉 T004 的交接项**：`Bun.password.verify` 对垃圾 hash 抛 `UnsupportedAlgorithm` → 放任即 HTTP 500，与 FR-005 的统一提示不一致。`passwordMatches()` 把它归为「不匹配」。**有牙验证：拆掉兜底 → 那条测试当场抛 `UnsupportedAlgorithm` 变红**
  - **FR-005 统一性**：账号不存在与密码错误抛**同一个** `InvalidCredentialsError`、同一句「账号或密码错误」。细分错误类型会让这条要求在**类型层面**失守
  - 登录成功刷 `last_login_at`（走 `nowSeconds()`，见裁定 ⑤）；失败**不签发凭证、不刷时间**
  - `mustChangePw` 随结果透出供 T012 弹窗，**刻意不塞进 JWT 载荷**——载荷是线格式契约（T005 有测试钉字段名），改动面更大
  - 实测出参：包内 `bun test` **72 pass / 0 fail**（+10：登录 9、生产驱动接口 1）；`bun run typecheck` **31/31**；`bun run lint` 4924w/1e 与基线逐字相同（`packages/auth` 0 命中）；`bun run lint:openhive` exit 0；`bunx oxlint packages/auth` 0/0
  - 有牙验证两处：① 拆 `passwordMatches` 的 try/catch → 畸形 hash 那条红；② 账号不存在改为单独报错 → FR-005 那条红
  - ⚠️ **已知未处理（有意）**：① 用户枚举的**时序**侧信道——密码错误会做一次 argon2 校验，账号不存在直接返回，耗时不同。FR-005 只要求提示一致，未要求恒定耗时；补法是在查不到时也跑一次假哈希，属额外复杂度，**留给用户决定**。② hash 损坏的账号被静默当成密码错误，**运维看不到线索**（换 FR-005 的可观测性代价，详见 `login.ts` 注释）
- [-] ~~T010 [US2] [FE·新增] 实现登录失败统一提示「账号或密码错误」~~ 🚚 **已移出 002**（用户裁定 2026-09-29，见文末「前端落点裁定」）
  - FR-005 的**服务层**半边已在 T009 落地：账号不存在 / 密码错误 / 停用 / hash 损坏，四种情况抛**同一个** `InvalidCredentialsError`、同一句「账号或密码错误」，各有测试钉住
  - 移出的是**呈现**那半边（登录页上把这句话显示出来），它随 F3 网关一起做
- [x] T011 [US2] [BE] 实现停用账号登录拒绝 [FR-008] [T009] [出参：status=0 账号登录被拒]
  - 落点 `src/login.ts` 一句 `if (record.status !== 1) throw new InvalidCredentialsError()`（1 启用 / 0 停用，design-v2 §4.1 `:136`）
  - **提示口径：仍走 FR-005 那句「账号或密码错误」，不另给「账号已停用」**。依据 spec.md FR-005「**登录失败** MUST 统一提示……不暴露账号是否存在」是无限定的绝对句，design-v2 §8.3（`:320`）与 §安全（`:888`「统一登录失败响应」）同口径；FR-008 只说「拒绝登录」，未指定文案。
    ⚠️ **代价**：被停用的民警（尤其 90 天未活跃被批量停用的）只会看到「账号或密码错误」，容易误以为是自己忘了密码、走一圈才从管理员处得知。若产品上更看重这条，改成独立文案是一处一行改动——但**必须先定**（见 state.md 待裁定）
  - 🔑 **位置在密码校验之后，且这是安全决策不是排版**：挪到之前，停用账号会跳过 argon2 直接返回，耗时与「正常账号 + 错密码」可测量地不同 → 外人拿它当探针枚举「哪些警号被停用」。放在之后，只有已出示正确密码的人才走得到，对外无可观察差异
  - 不刷新 `last_login_at`：检查在 `update` 之前，否则停用账号会留下登录痕迹，运维误以为它还在被人使用（有测试钉住）
  - 实测出参：包内 `bun test` **74 pass / 0 fail**（+2：停用被拒 + 密码对错同错）；`bun run typecheck` **31/31**；`bun run lint` **4924w/1e / 3370 文件**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ `packages/auth` 0 命中；`bun run lint:openhive` **退出码 0**；`bunx oxlint packages/auth` **0/0**
  - 有牙验证：注释掉该行 → **2 条齐红**，其余 9 条不受影响，恢复后全绿无残留
  - ⚠️ **诚实标注**：那句「必须在密码校验之后」**没有测试能钉**——两种次序的对外行为完全一致，只差耗时，写时序断言会变成 flaky 测试。故只落成代码注释，属「靠评审与注释守」而非「靠测试守」

## Phase 5: US3 首次强制改密（P1）

- [-] ~~T012 [US3] [FE·新增] 实现 must_change_pw 检测 + 强制改密弹窗（全屏遮罩锁死）~~ 🚚 **已移出 002**（用户裁定 2026-09-29，见文末「前端落点裁定」）
  - **检测**那半边已在 T009 落地：`login()` 的结果里带 `mustChangePw`（`LoginResult.mustChangePw`，有测试钉住），前端拿到即可决定弹不弹
  - 移出的是**弹窗**那半边（全屏遮罩 + 「稍后修改」按钮），它随 F3 网关一起做
- [x] T013 [US3] [BE] 实现改密成功解除 must_change_pw 状态 [FR-006] [T004] [出参：改密后状态解除，下次不再弹]
  - 落点 `src/password.ts` 增 `changePassword(db, { userId, currentPassword, newPassword })`（plan.md 文件结构本就把 改密/重置 归在 `password.ts`）+ `password.test.ts` 增 4 条
  - **必须校验当前密码**（不是可选的加固）：design-v2 §8.3（`:321`）把改密弹窗画成「**当前密码** + 新密码（强度条）+ 确认」——
    服务端不验的话那个输入框就是摆设，而**光有会话凭证就能改掉密码**意味着凭证一旦被劫持，攻击者能把真正的用户锁在门外
  - **拒绝空密码**（这是地板不是策略）：空密码的账号任何人输空串都能登进去，是本功能自己就能制造出来的坏状态，一行挡住
  - ⚠️ **依赖由 `[T012]` 修正为 `[T004]`**：T012 已移出 002，且**从来不是真依赖**——改密能力不需要弹窗存在才能写；T003/T004 才是
  - 错误类型 `InvalidCurrentPasswordError`（「当前密码不正确」）/ `EmptyNewPasswordError`（「新密码不能为空」）。**允许说清楚**——用户已通过鉴权，不构成枚举信号（与 FR-005 的登录侧相反，那里必须含糊）
  - `PasswordChangeTarget` 窄接口与 `UserLoginTarget` 形状逐字相同，是**有意的重复**：`password.ts` 与 `login.ts` 互相 import（前者要用后者的接口就会成环）。这点重复是类型别名，写错编译器当场抓，不会像复制逻辑那样悄悄漂移；**出现第三处就该提到 `user.ts`**（已写进代码注释）
  - 实测出参：包内 `bun test` **78 pass / 0 fail**（+4）；`bun run typecheck` **31/31**；`bun run lint` **4924w/1e / 3370 文件**（与基线逐字相同）→ `packages/auth` 0 命中；`bun run lint:openhive` **退出码 0**；`bunx oxlint packages/auth` **0/0**
  - 有牙验证两处：① 去掉 `mustChangePw: 0` → **恰好 1 条红**（「解除」那条）；② 拆掉当前密码校验 → **恰好 1 条红**。两次均恢复干净、无残留
  - 🔧 **过程中撞到 2 条新告警并消掉**：`preserve-caught-error`（catch 里 throw 新错没挂 `cause`）与 `no-unsafe-type-assertion`（`row.must_change_pw as number | null`）。
    前者改为不抛出（`failureOf` 只把错交回来）；后者**改了断言方式而不改实现**——不再读 `must_change_pw` 列，改用**登录行为**断言状态未变（原密码仍可登 + 仍要求改密），
    比查列更强：只查列的话，「顺手清了 `must_change_pw`、但哈希没换」的半成品实现能蒙混过关。**两处都没用 disable 注释**（沿用 T008 做法）
- [x] T014 [US3] [BE] 「稍后修改」下次登录再弹 —— **改写为回归测试**（用户裁定 2026-09-29）[FR-006] [T013] [出参：选稍后修改后下次登录仍弹]
  - ⚠️ **原任务按字面是「什么都不用做」**：`login()` 全程只**读** `must_change_pw`（写的是 `last_login_at`），
    该列只由真的改了密码（T013 `changePassword`）置 0。而「稍后修改」= 前端关掉弹窗、**不发任何写请求**。
    故「下次登录仍弹」**一行代码不写就已成立**——交付生产代码只会变成凑数
  - **改写成一条刻画性测试**：钉住「登录不清 `must_change_pw`」。它保护的是一件真会发生的事——
    有人觉得「登录都成功了，顺手把改密标记清掉吧」，而那会让**强制改密形同虚设**，
    且**没有任何别的测试会发现**（清掉之后第一次登录看起来完全正常）
  - ⚠️ **诚实标注：这条测试没有 RED 阶段**（它断言的是既有行为，写下来就是绿的）。故其「牙」全靠变异验证：
    给 `login()` 的 update 加上 `mustChangePw: 0` → **恰好 1 条红**，恢复后全绿
  - 实测出参：包内 `bun test` **79 pass / 0 fail**（+1）；`bun run typecheck` **31/31**；`bun run lint` **4924w/1e / 3370 文件**（与基线逐字相同）→ `packages/auth` 0 命中；`bun run lint:openhive` **退出码 0**；`bunx oxlint packages/auth` **0/0**

## Phase 6: US4/US5 停用 / 僵尸 / 重置（P2）

- [x] T015 [P] [US4] [BE] 实现僵尸账户筛选（90 天未活跃）+ 一键批量停用 [FR-009] [T003] [出参：筛选出超 90 天未活跃账户并可停用]
  - ✅ **2026-09-29 完成**。`src/zombie.ts` + `zombie.test.ts`（12 条）；`policy.ts` 增 `ZOMBIE_INACTIVE_DAYS = 90`
  - ⚠️ **不能照 design-v2 §4.3 的字面写 `last_active_at`**：该列**全仓库无写入方**（归网关，T018/F3），
    字面写法对 NULL 求值为 NULL → **永远返回 0 条**，且**不报错不变红**，管理员只看到「暂无僵尸账户」。
    改用 `coalesce(last_active_at, last_login_at, created_at)` 三级回退。**另有一个独立理由**：从没登录过的
    账号 `last_login_at` 也是 NULL，而这一类（默认密码多半没改）**恰恰最该清理**——字面写法会整类漏掉
  - 筛选（SQL）与返回值 `lastSeenAt`（JS）是同一规则的两份实现，由一条**对账测试**钉住
  - 顺带做了一次行为不变重构：`UserAccountTarget` 从 login/password 两处副本提为 `user.ts` 共享（重构后 79 pass 逐字相同）
  - 变异验证：去掉 `status = 1` → 3 红；`coalesce` 换回字面 → 6 红；`<` 改 `<=` → 1 红；**删掉空名单守卫 → 0 红**（故删掉该守卫）
  - 实测出参：包内 `bun test` **91 pass / 0 fail**（12 文件）；`bunx oxlint packages/auth` **0/0**；`bun run typecheck` **31/31**
- [ ] T016 [P] [US4] [BE] ~~实现停用后保留 30 天再归档/删除（可恢复）~~ **改为账号侧闭环** [FR-010] [T003] [出参：停用后 30 天内可恢复]
  - ⛔ **2026-09-29 原任务阻塞**：缺「停用时刻」列，且 FR-010 的保留对象是**沙箱目录/数据**（不是账号行）
  - ✅ **用户裁定（方案 A，2026-09-29）**：本 feature 只做**账号侧**——
    ① 加 `deactivated_at INTEGER` 列（迁移 `0002`）② `restoreAccount`（保留期内恢复）
    ③ 逾期清单筛选（供 F3 定时任务用）。**文件系统部分（沙箱归档/恢复/删除）移出 002，留给 F3**
  - ⚠️ **加列是平台级改动**：要同步改 `user.ts` 模型、`user.test.ts` 的防漂移断言、以及 design-v2 §4.1 的表
- [x] T017 [P] [US5] [BE] 实现密码重置（回默认密码 + must_change_pw=1）[FR-007] [T003][T004] [出参：重置后默认密码可登录且强制改密]
  - ✅ **2026-09-29 完成**。`password.ts` 加 `resetPassword`（固定回 `DEFAULT_PASSWORD`，不收新密码参数）；
    `password.test.ts` 增 4 条
  - 与 `changePassword` 的三处刻意不同：**不校验当前密码**（管理员本就不知道旧密码，这正是重置的用途；
    门禁在调用方——本函数不做鉴权）、**不收新密码参数**（让管理员自选等于让他知道民警密码，design-v2 没写）、
    **`must_change_pw` 置 1**（默认密码是文档里的公开值）
  - 账号不存在时**报错不静默成功**：静默的话管理员会转告「用默认密码登录」而民警登不进来，两边都不知道为什么
  - ⚠️ 过程撞到 1 条 `no-unsafe-type-assertion`（我写的 `(thrown as Error).message`），
    **用类型守卫消掉、未加 disable 注释**（同 T008/T013 做法）
  - 变异验证：`mustChangePw` 改 0 → 1 红；不换哈希 → 3 红；去掉不存在检查 → 1 红
  - 实测出参：包内 `bun test` **104 pass / 0 fail**（12 文件）；`bunx oxlint packages/auth` **0/0**；
    `bun run typecheck` **31/31**；`bun run lint` **4924w/1e / 3372 文件**（与基线逐字相同）→ `packages/auth` 0 命中

## Phase 7: opencode 边界（P1）

- [ ] T018 [BE] 关闭 opencode Basic Auth（不设 `OPENCODE_SERVER_PASSWORD`），网关注入并校验 `X-User-ID` [FR-011][FR-012] [T005] [出参：opencode 只认 X-User-ID，无该头即拒绝]

---

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003（依赖 T001）；T004 ∥ T005（依赖 T001，可并行）
- **Phase 3**：T006（依赖 T003+T004）→ T007 / T008（依赖 T006 / T003）
- **Phase 4**：T009（依赖 T004+T005）→ T011（依赖 T009）；~~T010~~ 已移出
- **Phase 5**：T013（依赖 T004；原写 T012 已修正）→ T014；~~T012~~ 已移出
- **Phase 6**：T015 ∥ T016 ∥ T017（依赖 T003/T004，可并行）
- **Phase 7**：T018（依赖 T005）

共 18 条任务（T001–T018），符合 12–18 条范围；其中 **T010 / T012 已移出本 feature**（见上「前端落点裁定」），
**002 实际执行 16 条**。

---

## 前端落点裁定：T010 / T012 移出 002（2026-09-29，用户裁定 A）

**裁定**：**002 只交服务层**。T010（登录失败提示的呈现）与 T012（强制改密弹窗）**移出本 feature**，
随 **F3 网关**一并做——那时才有登录 HTTP 端点、Cookie 下发与 `X-User-ID` 注入，前端才接得上。

> 两条的 **FR-005 / FR-006 服务层半边已经在 002 内落地**（T009）：`login()` 对四种失败原因抛同一个
> `InvalidCredentialsError` + 同一句消息；成功时透出 `mustChangePw`。移出的只是**呈现**。
> 换言之 FR 覆盖没有丢失，丢的是「把它显示出来」这个动作。

**现象（裁定依据）**：T010「登录失败统一提示」与 T012「强制改密弹窗」标的是 `[FE·新增]`，但 002 里**没有前端可加**：

| 检查 | 结果 |
|---|---|
| plan.md「项目文件结构」 | 只有 `packages/auth/` 一个块，**零个前端文件** |
| plan.md「前端换皮区」 | 描述了**登录页**与**改密弹窗**的视觉 token，但没给落点 |
| 002 目录下 | 无 UI 目录 |
| 全仓库 `*login*` / `*auth*` 前端文件 | **0 个**（`packages/app` / `packages/ui` / `packages/session-ui` 均无） |
| 001（平台底座）T008 备注原文 | 「**001 没有登录**（登录属 F2 / `002-auth-account`……），本任务**不改这一点**，改为建立接入缝」 |

**结论**：登录页是**两条任务都默认它已存在、但没有任何一条任务负责造它**的缺口（T009 的出参「进入主界面」同因未达成）。
不是实现难度问题，是**计划缺口**——`plan.md` 与 `tasks.md` 之间对不齐。

**为什么不擅自补**：造一个登录页 = 新建 openhive 前端组件 + 登录 HTTP 端点 + Cookie 下发 + 错误呈现 + 与 F1 三栏（001 的 `workspace/current-user.ts` 接入缝）对接。
那是**一个新的切分单元**，且直接决定 T018（网关 `X-User-ID`）的形态——属范围决策，须先由人定，不能由实现者顺手夹带
（违反 CLAUDE.md「一个 PR 混合重构与新功能」的精神，以及宪法 §四边界纪律）。

**否掉的备选**：
- **B：002 内补登录面**（新增 `[INT]` 任务造登录 HTTP 端点 + 登录页）。否掉理由：登录页服务的正是网关，
  没有网关就只能对着一个空地址发请求；且它会顺手把 T018 的形态定死，等于让「认证机制」这一个 feature 越界去定「网关架构」。
- **C：任务表不动、先挂着**。否掉理由：挂着的任务会被后来者反复重新推导同一堆证据（本次就重新查了 5 处）；
  裁定写进表里，欠账才是**可检索**的。

**移出的欠账随谁落地**：F3 网关。届时需要一并决定「登录页挂在 `packages/app` 的哪个位置」以及
「Auth 服务以什么形态暴露 HTTP」（plan.md R3 倾向「网关模块内嵌」，但未定案）。
