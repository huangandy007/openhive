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

- [ ] T006 [US1] [BE] 实现管理员录入账号（8 字段 + 默认密码 + must_change_pw=1）[FR-002][FR-003] [T003][T004] [出参：录入后账号可登录且被标记需改密]
- [ ] T007 [US1] [BE] 实现录入时创建沙箱目录 `/workspaces/{userId}/` [FR-003] [T006] [出参：录入后沙箱目录存在]
- [ ] T008 [US1] [BE] 实现警号唯一性校验（重复录入拒绝）[FR-001] [T003] [出参：重复警号录入被拒]

## Phase 4: US2 警号登录（P1）

- [ ] T009 [US2] [INT] 实现登录流程（校验密码 → 签发凭证 → 进入主界面）[FR-004] [T004][T005] [出参：正确凭证登录成功进入主界面]
- [ ] T010 [US2] [FE·新增] 实现登录失败统一提示「账号或密码错误」[FR-005] [T009] [出参：错密码/错账号提示一致]
- [ ] T011 [US2] [BE] 实现停用账号登录拒绝 [FR-008] [T009] [出参：status=0 账号登录被拒]

## Phase 5: US3 首次强制改密（P1）

- [ ] T012 [US3] [FE·新增] 实现 must_change_pw 检测 + 强制改密弹窗（全屏遮罩锁死）[FR-006] [T009] [出参：需改密账号登录后强制弹窗]
- [ ] T013 [US3] [BE] 实现改密成功解除 must_change_pw 状态 [FR-006] [T012] [出参：改密后状态解除，下次不再弹]
- [ ] T014 [US3] [BE] 实现「稍后修改」下次登录再弹 [FR-006] [T012] [出参：选稍后修改后下次登录仍弹]

## Phase 6: US4/US5 停用 / 僵尸 / 重置（P2）

- [ ] T015 [P] [US4] [BE] 实现僵尸账户筛选（90 天未活跃）+ 一键批量停用 [FR-009] [T003] [出参：筛选出超 90 天未活跃账户并可停用]
- [ ] T016 [P] [US4] [BE] 实现停用后保留 30 天再归档/删除（可恢复）[FR-010] [T003] [出参：停用后 30 天内可恢复、逾期归档]
- [ ] T017 [P] [US5] [BE] 实现密码重置（回默认密码 + must_change_pw=1）[FR-007] [T003][T004] [出参：重置后默认密码可登录且强制改密]

## Phase 7: opencode 边界（P1）

- [ ] T018 [BE] 关闭 opencode Basic Auth（不设 `OPENCODE_SERVER_PASSWORD`），网关注入并校验 `X-User-ID` [FR-011][FR-012] [T005] [出参：opencode 只认 X-User-ID，无该头即拒绝]

---

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003（依赖 T001）；T004 ∥ T005（依赖 T001，可并行）
- **Phase 3**：T006（依赖 T003+T004）→ T007 / T008（依赖 T006 / T003）
- **Phase 4**：T009（依赖 T004+T005）→ T010 / T011（依赖 T009）
- **Phase 5**：T012（依赖 T009）→ T013 / T014（依赖 T012）
- **Phase 6**：T015 ∥ T016 ∥ T017（依赖 T003/T004，可并行）
- **Phase 7**：T018（依赖 T005）

共 18 条任务（T001–T018），符合 12–18 条范围。
