# Tasks: 多用户隔离

**Input**: `docs/superpowers/specs/003-multi-tenant-isolation/`

**Prerequisites**: spec.md（用户故事）、plan.md（结构 / 集成点）、~~F2 已落地 X-User-ID 注入~~
→ **修正（002 收尾核对，2026-09-29）**：F2 交的是**门**（opencode 中间件：读头 → 无头即 401），
**不是注入器**。注入器（网关）**尚不存在**，且 002 已把它连同登录页一并移交给 F3 —— 见文末
「002 移交的欠账」。plan.md 「与现有系统集成点」里「F2 已落地『关 Basic Auth + 注入 X-User-ID』」
这句同理需按此读。

**Tests**: 核心是「隔离测试」——用户 A 访问用户 B 的目录 / db 必须被拒（constitution §五质量门禁）。

## 任务格式约定

- `[P]` = 可并行（不同文件、无依赖）
- `[USn]` = 所属用户故事
- 每条含 `[FR-x 来源] [依赖任务] [出参验证方式]`

## Phase 1: Setup（定位现状 + 方案锁定）

- [x] T001 [P] 定位 `database.ts` 现状（`makeGlobalNode` 单例 / `path()` 固定落 db）与 `Location` 的 `LayerNode.unbound` 模式，产出改造落点 [FR-001] [无依赖] [出参：单例现状 + 可仿模式清单]
  - ✅ **完成 2026-09-30**，产出 `refactor-targets.md`（本目录）。四条要点：
    ① `layerFromPath(filename)` **已是公开导出**——`database.ts` 的「加」的缝现成，per-user 连接可零改动复用 PRAGMA + 迁移；
    ② `packages/core/src/database/` 经实测**我们零提交**，R1「从未碰过它」成立；
    ③ 可仿模式 = `Location` 的 `unbound`/`boundNode`（模式 A）+ `buildLocationServiceMap` 的
       `LayerMap` + `hoist` + `Layer.fresh` + `idleTimeToLive`（模式 B，**现成的 R2 连接回收机制**）；
    ④ ⚠️ **结构性发现**：`Database.node` 是 **global tag**，其消费者 9/10 是 global 节点，
       而 `locationServices` 组**不含**它们 → **不能照抄 Location 的替换点**。
       T004 落点三选一（见 `refactor-targets.md` §3），**开工前若未定需停下来问**。
  - ✅ **前置实测已完成（2026-09-30，T003 收尾后）**，见 `refactor-targets.md` §3 的「已测」表。
    两条改变判断的事实：① ~~`Database` **不是进程级单例**~~ 🔴 **2026-09-30 稍后更正：此条被推翻**——
    它是**用替换层**测出来的；去掉替换层后实测**整个进程只有一份 `Database.Service` 对象**
    （Effect 对同一 layer 对象只构建一次，`Layer.fresh` 才能打破；`Database.node` 是模块级单例）。
    且**真实 HTTP 请求读写的就是主树那份**（`state.md`「消费侧实测结果」）；
    ② ⚠️ **路径不能由「当前请求的 `User`」决定**——location 层按 key 缓存（TTL 60 分钟），
    请求身份每变一次，缓存里会留**第一个**用户的库 ⇒ **串库**。路径必须由 key（`Location.Ref`）
    派生，或把 userId 并进 key。
    ⇒ ~~✅ **落点已裁定（2026-09-30 · 用户裁定【甲】）**：在 server 根处把 `LocationServiceMap.node`
    换成我们自己的 map，其中把 `Database.node` 替换成「指向该 location 对应文件」的层。~~
    🔴 **2026-09-30 稍后：该裁定被消费侧实测推翻**——真实 HTTP 请求读写的是**主树**那份 `Database`，
    在 location map 里替换**碰不到它**。当前落点候选见 `state.md` 的「第三轮实测」。
  - ⚠️ **成本更正（我给用户的估计被实测推翻）**：甲**不是**「零改上游文件」——
    接线点 **4 处**：`packages/server/src/routes.ts`、`packages/opencode/.../httpapi/server.ts`、
    `.../handlers/pty.ts`、`.../handlers/file.ts`。漏改一处 = 那条路径**静默用回公共库**，
    故必须配**兜底测试**。
  - ✅ **第二轮实测（消费侧，HTTP 真请求）已做**：主树那份被真实请求消费，甲不成立。
    见 `state.md`「消费侧实测结果」。
  - ✅ **第三轮实测（取连接点，生死点）已做**：`sqlite.bun.ts` 的 `acquirer` 里
    **拿得到请求的 `User`**（`acq:alice`）；普通请求期间 `NONE` 出现 **0 次**；启动期迁移是 `NONE`。
    **但同一次探针暴露出「陈旧身份捕获」**：Location 层按目录缓存（不按用户分键），
    后台 fiber 会继承首个请求者的身份。⇒ **取连接点路由单独用不够**。
    见 `state.md`「第三轮实测」。
  - ✅ **落点最终裁定（2026-09-30 · 用户裁定「乙＋丙，丙挂 T006」）**：
    **乙**＝取连接点路由（`sqlite.bun.ts` 的 `acquirer` 按当前 fiber 的 `User` 选库）；
    **丙**＝Location 缓存键按用户分，**不现在做，挂 T006 的验收项**。
    理由（代价已实测）：`Location.Ref` 是 `packages/schema/src/location.ts` 的 `Schema.Struct`，
    加字段＝改上游 schema 包（18 个文件 import；`Ref.make` 字面构造点生产 17 + 测试 11 处），
    撞宪法 §I；而若 T006 沙箱锚定做实，这一维就是纯冗余。
    **三条件**（缺一不可）：① 丙 是 **T006 的书面验收项**（判据见 T006 段）；
    ② T006 落地前本缺口登记为**未覆盖**，不写成已覆盖；③ 非 HTTP 入口的回退判据按
    「谁在跑」而非「有没有 User」。详见 `state.md`「落点最终裁定」。
- [x] T002 [P] 确定 `/data/{userId}/` 与 `/workspaces/{userId}/` 的目录挂载 + 受限用户权限方案 [FR-001][FR-005] [无依赖] [出参：目录/权限方案记录在案]
  - ✅ **完成 2026-09-30**，产出 `isolation-scheme.md`（本目录）。三条要点：
    ① `/workspaces` 侧 **002 已交**（`packages/auth/src/workspace.ts` 的 `WORKSPACE_ROOT_ENV` /
       `workspaceRoot()` / `createWorkspace()`，含 `../` 穿越校验）——**不重造**，本 task 只补 `/data` 侧 + 挂载 + 权限；
    ② **SQLite WAL 的坑**：`database.ts` 设了 `journal_mode = WAL` → 会在 db 旁生成 `-wal`/`-shm`
       ⇒ **`/data/{userId}/` 目录本身必须可写**，「文件 0600 + 目录 0500」会让 SQLite 打不开库；
    ③ ⚠️ **§5 是一条必须先裁定的问题（未裁定，已上报）**——见下。
  - ✅ **裁定（2026-09-30 · 乙 · 降级为容器级）**：单进程模型下「OS 层兜底」不成立，
    已上报并由用户裁定走**乙**。证据链：design-v2 §11.6 部署 = **一个 opencode 容器**；
    §6 = **共享单进程**；**实测** `cross-spawn-spawner` 的 spawn 选项**无 `uid`/`gid`**，
    上游 `Dockerfile` 也**无 `USER`**。⇒ 一个进程 = 一个 OS 主体，`chmod 700` 对
    「用户 A vs 用户 B」**零作用**。
    **后果**：用户间隔离改由**每用户独立 db（真文件级物理隔离）+ 应用层锚定**承担；
    OS 权限（`0700`）降级为**容器外防护**。
    **已同步**：`spec.md`（US2 引言 + 验收场景 2 + FR-006 + SC-003）、`plan.md`
    （数据流向图 + 工作空间轴说明 + R3）、`isolation-scheme.md` §5、`state.md`。
    **丙（每用户一进程/容器）记为真正的答案 + 触发条件**（`isolation-scheme.md` §5.5）——
    主要是**合规评审**触发，不是技术触发。
  - ⚠️ **T007 的验收口径据此调整**：`0700` 照做，但**不得宣称它承担用户间隔离**。
    T013 的断言必须**如实写「由应用层锚定保证」**。

## Phase 2: Foundational（用户上下文 + db 路由）

- [x] T003 实现 per-request User 上下文（**中间件验签后**填 userId）[FR-002][FR-003] [T001] [出参：请求内可读到**经密码学验证**的 userId；无令牌 / 令牌被篡改或过期 / 与 `X-User-ID` 不一致 → 一律拒绝（fail-closed）]
  - ✅ **已落地（2026-09-30）**。落点两处：`packages/core/src/user.ts`（`User.Service` = `Context.Service`）；
    中间件 `packages/opencode/src/server/routes/instance/httpapi/middleware/user-identity.ts`
    （验签 → `Effect.provideService` 填 `User`）。测试在 `packages/opencode/test/server/user-identity.test.ts`。
  - ⚠️ **有意偏离 plan 的「模式 A」（`LayerNode.unbound`）**——理由见 `refactor-targets.md` §5 的 T003 条：
    模式 A 造的是「按 key 构造 / 缓存的服务树」占位，而用户身份是**每请求的纯数据**，没有可缓存的东西；
    「未填即失败」这层保证由 `Context.Service` 的消费者要求（`R`）承担，且运行时兜底更硬（认不出就 401）。
    **模式 A 的真归宿是 T004/T005 的 `Database` 按用户替换**，不是这里。
  - ⚠️ **本 task 必须一并处置 002 留下的那道具名门**：`packages/opencode/src/server/user-identity.ts`
    （读 `X-User-ID` → 有则放行；由 `OPENHIVE_REQUIRE_USER_ID` 控制，**默认关**）及其测试
    `packages/opencode/test/server/user-identity.test.ts`（4 条）。
    甲落地后「有头即放行」**不再构成任何保证**——留着它 = 留一道**看起来像鉴权、实际不是**的门。
  - ✅ **已裁定（2026-09-29）：走 ① 被验签门取代**——`user-identity.ts` 的语义从「读头即放行」
    换成「验签后才认」；其 4 条测试**重写**（是**换**，不是加）。
    理由：验签结果本身就含 userId，明文头不再携带任何身份信息；而一道「有头即放行」的门
    **看起来像鉴权、实际不是**，比没有它更危险——它会让人以为已经有人管了。
  - ⚠️ **`OPENHIVE_REQUIRE_USER_ID` 默认仍保持「关」**：002 定它默认关，是因为当时没有客户端会发身份；
    甲下同理——网关（T014）还不存在，**默认开等于把 app / desktop / CLI / 内置 web UI 全锁死**。
    仍由 T014 上线时置 `1` 打开。**名字继续贴切**（「要求请求带用户身份」这层含义没变，
    变的是**怎么带**——从明文头改为可验签令牌），故不改名。
  - 4 条测试重写为验签语义：**合法令牌放行 / 无令牌拒 / 篡改拒 / 过期拒**。
  - 琐碎项（`HEADER` 常量是否保留、网关是否仍发这个头）**落地时定**——spec 只钉
    「`X-User-ID` MUST NOT 作为身份来源」，与它存不存在无关。
  - 🔗 **取代后的中间件与 T014 是一条链的两端**：T014 网关侧注入 + 透传，本 task 内核侧验签。
    本 task 用**自造令牌**（直接调 002 的 `signToken`）即可独立测，**不必等网关**。
- [x] T004 实现 Database `Map<userId, 连接>`（惰性打开 + 复用 + 各自 PRAGMA）[FR-001][FR-003] [T001] [出参：多 userId 各自连接独立]
  - ✅ **完成 2026-09-30**。落点 `packages/core/src/database/router.ts`（新增）＋
    `packages/core/test/database-router.test.ts`（新增，6 用例）。
    **零改动上游文件**——`database.ts` / `sqlite.bun.ts` 一行没动。
    （后续更正：当时说「接进 `node` 是 T005 的事」——**T005 最终走「取连接点路由」，没接 `node`**，
    改的是给 `sqlite.bun.ts` 加钩子；`node` 至今仍在原地。）
  - 出参三条怎么落的：① 路径 = `join(dataRoot(env), userId, "opencode.db")`，
    `OPENHIVE_DATA_ROOT` 常量落在本 task（`isolation-scheme.md` §1 要求）；
    ② 惰性 `mkdir -p` 在**层构造里**（`Layer.unwrap`）、开库之前（`new Database(...)` 不建父目录）；
    **不放 `forUser` 里**——T005 后那是按查询调用，等于每查询一次 `mkdir` 系统调用；
    ③ 各自 PRAGMA + 迁移——**复用 `Database.layerFromPath`**，不自己开库（那 5 条 PRAGMA、
    `wal_checkpoint`、`DatabaseMigration.apply` 全在里面）。
  - ⚠️ **踩到并已修的坑（值得记）**：`Layer.fresh` **不能去掉**。`layerFromPath` 内部的 `layer`
    是**模块级常量**，`Layer.buildWithMemoMap` 按**层对象身份**缓存 ⇒ 不加 fresh 时，
    第二个用户会复用第一个用户已建好的连接，**两个 userId 指向同一个库文件**。
    这不是理论风险：本 task 的测试第一版就撞上了（bob 的库里出现了 alice 建的表）。
  - 口径：校验按 002 `createWorkspace` **等价**本地实现（core 无 `@opencode-ai/auth` 依赖，
    不能反向 import）；用 `LayerMap` + TTL 60 分钟而非裸 `Map`，直接对上 `plan.md` R2（连接泄漏）。
  - 门禁：单测 6 pass / typecheck 通过 / oxlint 0-0（161 rules）；**全包回归做了基线对照**
    （`state.md`「T004 结论 · 质量门禁」）——**Δ = +6 pass / 0 新失败**，既有 5 条 `NpmConfig`
    失败是本机 `~/.npmrc` 镜像导致的存量，与 T004 无关。
- [x] T005 实现 db 查询从 User 上下文取 userId 路由到对应连接 [FR-003] [T003][T004] [出参：A/B 查询落各自 db 文件]
  - ✅ **完成 2026-09-30**。出参达成：**同一条查询代码、同一个 `Database.Service`，按当前 fiber
    的身份落到不同库文件**（`packages/core/test/database-routing.test.ts` 3 用例，断言一律用
    `bun:sqlite` 直接读库文件，不经过我们自己的代码）。
  - 落点：`connection-routing.ts`（tag / `Disabled` / **两支共用的 `routed(...)`**）、
    `router.ts`（实现路由，并在 `Interface` 上暴露 `hook`）、**上游自有文件 `sqlite.bun.ts` 与
    `sqlite.node.ts`**（两处 `routed(...)` 各一层）、`middleware/user-identity.ts`（请求期注入钩子）、
    `httpapi/server.ts`（一行接线）。`database.ts` 与 `package.json` **一行没动**。
    文件清单与行数**别抄写死的数**，取数用 `git diff --stat`（`LEARNINGS #002-06`）。
  - ✅ **收尾补的三件事**（都写进 `state.md`「T005 结论」）：
    ① `routed` 抽成**两支共用的一份**——否则 node 那份永远没人跑（`#002-01` 的形状）；
    ② **`sqlite.node.ts` 一起接**（`#sqlite` 是按 `bun`/`node` 条件解析的，只改一支 =
       隔离在一个构建条件下**静默失效**）；为此加了两条**形状守卫**，
       ⚠️ **形状守卫不是行为验证**，它只防漏接线；
    ③ **接进真实请求路径**——原计划的「加进 `AppLayer`」**被实测证伪**（**请求 fiber 里没有 app 层
       服务**，报 `Service not found`），改为**身份中间件每请求 `provideService` 注入钩子**，
       与 `User` **同源**。变异验证：去掉 `server.ts` 那行接线 ⇒ 用例**红在层构造期**（非静默回退）。
  - 侵入点形状：`acquirer` / `transactionAcquirer` 各包一层 `routed(...)`——先问 fiber context 里
    有没有 `DatabaseConnectionRouting.Hook`，**没有就逐字走原来的 `fallback`**。所以 CLI / TUI /
    ACP 等无身份入口、以及全部既有测试，行为一字不变（测试 2 钉的就是这条）。
  - **为什么 tag 单独一个文件**：`sqlite.bun.ts` 要 import 它，而 `router.ts` 已 import
    `database.ts`、后者 import `#sqlite` ⇒ 并进 `router.ts` 会成环；而 `database.ts` 在**模块求值期**
    就调 `layerFromPath(path())`，谁先求值都可能踩 TDZ。`connection-routing.ts` **刻意不 import
    任何本仓库模块**，故无此风险。
  - ⚠️ **两个「必做」都做了，且都拿变异验证过**（不是「写了就算」）：
    ① **重入保护 `Disabled`**——停用它后本组测试**挂住**（超过 75s 无任何输出，连 bun 的 10s
       超时都没报出来）。⚠️ 也就是说**破坏它的表现是 CI 挂住、不是变红**。
    ② **`transactionAcquirer` 也路由**——停用它后「事务路径」用例**红**，alice 库为 `[]`（写回了主树）。
    ②这条测试是**实现之后补写的**（实现 GREEN 时顺手做了③，超出 RED 覆盖）——为补偿，
    补写后立刻做了变异验证，确认它真的守得住；不把它写成「已覆盖」蒙混过去。
  - ⚠️ **本次新增 1 条 oxlint warning**（`no-unsafe-type-assertion`，
    `multi-tenant-routing.test.ts` 里 `db.all(...) as Array<{v:string}>`）——与 `packages/core`
    既有测试**同款写法**，随大流。另一条 `no-unsafe-type-assertion`（`Hook.resolve` 那个 `as`）
    **不是新增**：它是 `routed` 从 `sqlite.bun.ts` **搬到** `connection-routing.ts` 时跟着搬的，
    净 0。为什么留：`Hook.resolve` 的静态类型是 `Effect<Connection, SqlError, Scope>`，而
    `client.export` / `loadExtension` 要求无 `Scope` 的 R（那是上游两行，不去动）。已试过的替代
    都不成立（改 `SqliteClient` 接口 = 动更多上游行；让钩子返回无 Scope 类型 = 把断言挪个位置，
    warning 照报）。**这些文件本来就是 warning 存量文件**，如实登记而非隐藏。
  - 门禁（收尾后重跑）：T005 新增单测 **core 8 pass + opencode 19 pass / 0 fail**；
    `packages/core` 与 `packages/opencode` typecheck 均 **EXIT=0**；oxlint **0 error**
    （9 个改动文件 15 warning：13 上游存量 + 1 搬过来的 + 1 新增，见上）；
    core 全包 **1101/7/5**（T004 基线 1093/7/5 ⇒ Δ = +8 pass / 0 新失败，5 条失败全是本机
    `~/.npmrc` 镜像导致的存量 `NpmConfig`，与 T005 无关）。
  - 🟡 **`packages/opencode` 全包在本机不是可用门禁**（已登记进 `state.md`「未覆盖」表）：
    跑一次 **2183s**，且 `test/server` **单独跑**也有存量 flaky 5s 超时带——基线 9 fail / 带改动
    10 fail，失败集合**双向**变动（4 条「基线红、改动绿」+ 1 条反向，该条单独跑为绿）。
    ⇒ 判据改为「**改动影响面所在的测试文件**全绿 + 与基线做**名称级差集**」。
    证据与复现命令见 `state.md`「全包回归：无可用基线，已改用名称级差集判据」。
  - 🟡 **未覆盖（登记为缺口，不是覆盖）**：**`node` 构建条件下「路由真的生效」未验证**——
    `sqlite.node.ts` 在本机**加载即报错**（bun 不提供 `node:sqlite`），只有形状守卫；
    需 CI 提供 node 运行时才算补齐。在此之前**不得声称「两种构建条件下都已隔离」**。
  - ⚠️ **更正一条我曾写在这里的错误推断**：本段原文断言「`run()` 用 `native.query(...)`，acquirer
    只是 facade ⇒ 换库必须发生在更靠上的地方」。**该推断被实测推翻**：`Client.make` 的
    `getConnection` **每条查询都回调 acquirer**，acquirer 返回哪个 connection 就决定落到哪个文件
    （实测：同一个 `db`、只换 fiber 里的身份标签，写就分别落到 A/B 两个文件）。
    教训同 `LEARNINGS #001-01` / `#002-03`：**读代码的推断不等于实测**。
  - 🔴 **但另两条候选路被实测排除，别重走**：
    ① **请求级替换 `Database.Service` 无效**——消费者在**建层时**就把它捕获了（不是每次 `yield*`）。
       实测：alice `POST /session` 返回 200，**alice 库 0 行**，紧接着 **bob 的 `GET /session` 读到了
       alice 那条会话**。⇒ 「`packages/core` 零改动、只在服务端加注入点」这条路**不存在**。
    ② **把 `#sqlite` 映射改成包装层会死锁**——per-user 层在**调用方 fiber** 里构建，建层期的查询
       会以同一 key 重入 `LayerMap`，实测 **5s 超时挂住**（不是递归、不是报错）。
  - ✅ **方案已获用户裁定（2026-09-30）**：批准「方案 A」——碰上游自有文件
    `packages/core/src/database/sqlite.bun.ts`，acquirer 先问一个**可选**钩子、**无钩子时逐字
    等于现状**。这是本 feature 首次**修改**而非新增上游自有文件（§I 红线），已按流程停下问过。
    （改动**远多于**当时估的「约 5 行」——多出来的全是解释性注释，刻意如此：
    同步上游冲突时，读到注释才知道这块不能丢。**别引用写死的行数**，
    取数用 `git diff --stat`；收尾后两支各只剩两行 `routed(...)` 调用。）
  - 接口形状（本 task 已定）：钩子要的是 **connection**，取法 = `forUser(id).db.$client.reserve`
    ——`reserve` 就是 `transactionAcquirer`，与「当前这次取连接」语义一致。
  - ✅ **一条新识别预设已裁定（2026-09-30）**：库路径是 `/data/{userId}/opencode.db`，
    **没有 workspace 维度** ⇒ 同一用户的多个工作区会共享同一个库。
    **裁定：不给库路径加维度**，改为把「一人一工作区」钉成**被测试保证的事实**
    ——已写成 T006 的追加验收项（见该段）。**没有未决项留在这里。**

## Phase 3: US2 沙箱目录（P1）

- [x] T006 实现工作目录强制锚定中间件（忽略客户端传入 directory）[FR-005] [T003] [出参：伪造 directory 被忽略，落沙箱根]
  - 🔴 **本 task 承接一条 T004 移交的验收项（2026-09-30 裁定「乙＋丙，丙挂 T006」）**：
    **判据（必须是一条测试，不是一句声明）**：**两个不同用户拿不到同一个 `Location.Ref`**。
    为什么挂这里：T004 走的是「取连接点路由」，它按**当前 fiber 的 `User`** 选库；
    而 Location 服务树按 **`Location.Ref`（目录）** 缓存（`LayerMap`，TTL 60 分钟），**不按用户分键**。
    两者合起来 ⇒ **留驻在按目录缓存的 Location 层里的后台 fiber 会「陈旧身份捕获」**
    （继承首个碰该目录的用户的身份，把结果写进**那个用户**的 db）。实测证据链见
    `state.md`「第三轮实测」。
    **只要「一人一工作区」成立，两个用户就碰不到同一目录，该风险消失**——这正是本 task 的产出。
    **改判条件**：若本 task 最终**做不到**「一人一工作区」（例如产品上允许打开任意路径），
    则必须回到 T004 显式给 Location 键加 userId 维度，**不得默认放行**。
  - ⚠️ **本 task 未落地前，该缺口在 `state.md` 登记为「未覆盖」**（`LEARNINGS #002-02`）：
    今天没有任何一条测试压过「两用户抢同一目录」，所以它**不是覆盖**。
  - 🔴 **追加一条验收项（2026-09-30 裁定）：「一人一工作区」必须是被测试保证的事实，不是口头假设。**
    **判据 = 一条测试**证明「同一用户拿不到第二个工作区」（或等价表述：用户与其沙箱是一对一）。
    **这条与 T005 收尾时识别的那条预设是同一件事**——库路径是 `/data/{userId}/opencode.db`，
    **没有 workspace 维度** ⇒ **同一用户的多个工作区会共享同一个库**。
    裁定是**不给库路径加维度**（那会为一个不该存在的场景增加路径复杂度），
    代价是**必须把「一个用户只有一个工作区」钉成被验的事实**。
    **改判条件**：若产品上确实要允许一个民警开多个工作区，则本条作废，
    必须回到 T004 给**库路径**也加 userId 以外的维度，**不得默认放行**。
  - 📌 与「缺口表」里那条 `Location.Ref` 的关系：本 task 的产出**同时**关掉两个东西——
    Location 的陈旧身份捕获（风险消失）与「库路径无 workspace 维度」的隐含假设（被验为真）。
  - ✅ **完成 2026-09-30**。出参达成：**客户端传什么 directory 都会被改写成 `{沙箱根}/{userId}`**。
    三条验收项各有对应测试（`packages/opencode/test/server/anchor-workspace.test.ts`，4 用例）：
    ① 出参 —— 伪造 `?directory=` 被忽略、落自己的沙箱；
    ② T004 移交的「两个用户拿不到同一个 `Location.Ref`」—— **真的构造 `Location.Ref.make(...)`
       再用 `Equal.equals` 比对**（LayerMap 的键用的正是这套结构相等），而不是拿「目录字符串不等」充数；
    ③ 「一人一工作区」—— 同一用户换三种 directory（含他自己的沙箱根）仍只有一个锚点。
    另有第 4 条**零回归守卫**：身份门关着时锚定**必须直通**（见下）。
  - 落点：**新增** `middleware/anchor-workspace.ts` + `httpapi/server.ts` 一行接线（`anchorWorkspaceLayer`，
    **必须排在 `userIdentityLayer` 之后**——它靠身份门放进上下文的 `User` 决定锚到谁，
    排前面就抓不到 User、整道锚定静默直通；测试守着这个次序）。
    **上游文件零改动**：两条目录解析链（`workspace-routing.ts` 的 `defaultDirectory`、
    旧版 `@opencode-ai/server/location` 的 `ref`）一行没碰。
  - **为什么是「改写请求」而不是「改解析函数」**：两条链**都从同一个 `HttpServerRequest` 读**，
    在请求进路由树之前用 `HttpServerRequest.modify` 把它换掉，两条链同时被锚定（宪法 §V
    「侵入是加不是改」）。三处入参都改（`?directory=`、`location[directory]`、`x-opencode-directory`），
    因为它们**不是同一条读法**，只改一处 = 留一条明路。
  - ✅ **一条超出字面出参的决定——2026-09-30 已结案：维持「一并删掉 `?workspace=`」**。
    它同样由客户端给，而 `planRequest` 会用该工作区的 `target.directory` **完全绕过**
    `defaultDirectory` —— 留着它，上面三处改写等于白改。删而不是替换，是因为
    「一人一工作区」（T004 裁定）下没有第二个工作区 id 可填。

    **结案依据（查出来的，不是推断的）**：
    ① **全仓零个生产者**——`grep` 遍 `packages/**`（排除 node_modules 与测试）没有任何地方构造
       `?workspace=`（`searchParams.set("workspace"` / `"workspace="` / `workspace=${` 全零命中）。
       前端 `packages/app` 里的 `data-workspace=` 是 **CSS 属性**、`src/workspace/` 是 openhive
       **自有模块目录**，都不是这个查询参数。⇒ 删掉它**不可能弄坏任何现有调用方**。
    ② 该特性在 opencode 里是**实验性的**（`@opencode/ExperimentalHttpApiWorkspaceRouting`）。
    ③ 它比「目录提示」重：`resolveTarget` 可给出 **Remote** target，请求会被 **proxy 到另一台服务器**
       （`proxyRemote`）——是**请求转发开关**。留着它不只是绕过目录，是能把请求转走。
    ④ openhive 的模型是「一人一沙箱一工作区」，项目隔离在沙箱**内部**（T008），没有「跨工作区」这回事。

    ⚠️ **并补了一条此前缺失的测试守住这行删除**（原先 4 条用例**没有一条**能发现它被去掉）：
    `packages/opencode/test/server/anchor-workspace.test.ts` 的
    「客户端传 `?workspace=` 指别人的工作区：参数被剥掉，仍落自己的沙箱」。
    **做过变异验证**：把那行 `delete` 去掉 ⇒ **只有这一条红**（500 而非 200，4 pass / 1 fail）。
    **为什么非补不可**：删这行是**承重**的（不删 = 锚定被绕过），而「全仓没人发它」这个论据
    **会随时间失效**——哪天有人加了生产者就悄悄破了。**论据会过期，测试不会。**
  - ⚠️ **残留（不假装已闭合）**：`planRequest` 是 `session?.directory || defaultDirectory(...)`——
    **会话行里的 directory 优先于请求**。所以锚定上线**之前**就已存在的会话仍会解析到它当年记下的目录。
    T005 的每用户库把**跨用户**那一半关掉了（`Session.Service.get` 只读自己的库），
    **同一用户的历史会话**那一半不闭合（影响面：该用户自己的目录，非越权）。已登记进缺口表。
  - ✅ **T006 开工前挂着的那个未决问题已结案**：`packages/protocol` 的 `v2.session.create` 声明了
    请求体 `location: Location.Ref`，一度怀疑是绕过锚定的口子。**实测结案：不可利用**——
    ①`SessionLocationMiddleware` **不读请求体**，它读 `route.params.sessionID` 再查 `SessionTable.directory`；
    ②`ServerApi`（`/api/*` 那一家族）在本仓库**只有 schema、没有任何 `HttpApiBuilder.layer(ServerApi)`**，
    即根本没有 handler 去消费那个字段。
    **若将来 v2 handler 层落地，这条要重新裁定**（届时请求体 `location` 会是一个活的绕过向量）。
- [x] T007 配置 opencode 容器以受限系统用户运行 + 文件权限（`0700`）[FR-006] [T002] [出参：容器**非 root**；`/workspaces/{userId}/` 以 `0700` 建出；`/data/{userId}/` **目录可写**（WAL 需在同目录建 `-wal`/`-shm`）]
  - ⚠️ **出参口径已改（2026-09-30 裁定乙）**：原文「OS 层拒绝跨用户读写」**不成立**——
    单进程下 OS 权限不区分用户 A 与 B（见 T002 段与 `isolation-scheme.md` §5）。
    **不得宣称本 task 的产出承担用户间隔离**；它挡的是**容器外**（同主机其他容器/系统用户）。
  - **范围裁定（2026-09-30，用户拍板）**：只做 ②③，①「容器非 root」**挂缺口**（没有可改的产物、
    本机无 docker），不新建任何部署产物。①②③ 逐条交代见下。
  - ① **容器非 root —— 缺口，非本 task 可闭合**。依据：官方 `packages/opencode/Dockerfile`
    **没有 `USER` 指令**，且它只装 CLI 二进制；仓库内**没有服务镜像、没有 docker-compose、没有
    k8s 清单**（`grep '^USER' --include=Dockerfile*` 全仓无命中）。**没有产物可改** →
    登记在本 feature 缺口表（`state.md`），不在本 task 里造部署产物。
    ⚠️ **更正一处错引（2026-09-30）**：先写的是「挂 `isolation-scheme.md` §11.6 部署任务」，
    这句**两处都不对**——**§11.6 是 `2026-09-06-openhive-design-v2.md` 的章节，讲的是
    「AI 资产治理（skill 存放 / 审核发布）」，不是部署任务**；`isolation-scheme.md` 全文**没有 §11**，
    它只在 §5.1 引用 design-v2 §11.6 说明「部署形态 = **一个 opencode 容器**」。
    规范出处其实是 `spec.md` 的 **FR-006**（「容器 MUST 以受限系统用户运行（非 root）」）。
    ⇒ **承接这条的部署任务目前并不存在**：003 的 tasks.md 无部署任务、仓库无部署产物。
    按 `LEARNINGS #002-04`，「这件事归别人做」必须先确认那个「别人」存在且有排期——
    此处不成立，故**不假称已移交**，只登记为缺口。
  - ② **`0700` 落地**：`packages/auth/src/workspace.ts` 的 `createWorkspace` 与
    `packages/core/src/database/router.ts` 的建目录处，都加了 `{ mode: 0o700 }`。
    **但「已建出」这件事在本机不可验**（见下方缺口行）——**不得据此宣称本出参已验**。
  - ③ **`/data/{userId}/` 目录可写**：`router.ts` 原本就 `mkdir`（无 mode），默认权限已可写。
    本 task 补的是**回归护栏**（真写一个 canary 文件再读回，而非只看权限位——位断言在 win32 恒真，
    等于没测）。**这条在改动前就是绿的**，不是 RED→GREEN，如实记为护栏。
  - 落点与验法：`packages/core/test/database-router.test.ts`（canary 护栏 + win32 跳过的 `0700` 断言）、
    `packages/auth/src/workspace.test.ts`（win32 跳过的 `0700` 断言）。
  - 📌 **两处 `0700` 的可验性并不相同**（实测确认，别混为一谈）：
    | 目录 | 落点 | 谁跑得到 |
    |---|---|---|
    | `/data/{userId}/` | `packages/core` | ✅ Linux CI **真跑**（`turbo.json` 有 `@opencode-ai/core#test`，CI 跑 `bun turbo test`，ubuntu 矩阵） |
    | `/workspaces/{userId}/` | `packages/auth` | ❌ **无人跑**：本机 win32 忽略 mode → skip；且 `turbo.json` **没有 `@opencode-ai/auth#test`**，CI 根本到不了这个包 |
  - ⚠️ **附带发现（需裁定，未自行处理）**：`turbo.json` 只为 `opencode` / `@opencode-ai/core` /
    `function` / `app` / `ui` / `session-ui` 声明了 `test`，**`@opencode-ai/auth` 缺席** ⇒
    **002 的整个 auth 包测试（149 条）从未在 CI 里跑过**。修法是在 `turbo.json` 加一行
    `"@opencode-ai/auth#test": {}`，但那是**上游文件**（`宪法 §I` 冲突面）。**未自行改动**，
    留给用户裁定。（改动后本出参的 auth 侧才进入被验状态。）

## Phase 4: US3 项目 / 会话隔离（P1）

- [x] T008 验证项目 = 唯一隔离边界 + 独立 git 仓库（复用 opencode 原生 project）[FR-007] [T006] [出参：沙箱内项目各自独立 git]
  **✅ 2026-09-30 完成 —— 出参成立，但带一条必须一并念的前提**（按裁定【甲】登记 / 【乙】测出上报）。
  **零生产代码改动**（只新增测试 + 文档），复用 opencode 原生 project 解析。
  - **落点**：`packages/core/test/project-sandbox-isolation.test.ts`（新增，4 条）。
    **刻意不复用** `packages/core/test/project.test.ts` 的既有测试——它已把 id 优先级链的**原语**
    逐条钉过（含「非 git 目录 → global + 文件系统根」「空仓库 → global」两条）。本文件钉的是
    **沙箱形状的复合**：多个项目**共用一个祖先目录**时边界还在不在。这是「不重复覆盖」的取舍，不是漏测。
  - **出参「沙箱内项目各自独立 git」的准确口径 = 成立，但带前提**：
    | 情形 | 实测结果 |
    |---|---|
    | 两个项目**各自成库、且已有首次提交** | ✅ id 互不相同（各 = 自己的根提交哈希），worktree 各是自己的库根（不是沙箱根） |
    | 两个项目**已 `git init`、但还没提交** | ⚠️ **同属 `global`** —— 见下「前提」 |
    | 尚未 git 化的目录 | ⚠️ id = `global`，且项目 **worktree = 文件系统根**（不在沙箱里） |
  - **前提的成因**：`Project.resolve` 的 id = `remote() ?? .git/opencode 缓存 ?? 根提交哈希 ?? global`，
    而 `initGit`（`packages/opencode/src/project/project.ts`）**只 `git init`、不提交** ⇒ 三个来源
    全空 ⇒ 一律回落 `global`。**即「项目 = 隔离边界」是首次提交之后才成立的**。
  - 📌 **按裁定【甲】：只登记为「条件成立」，不在此处兜底。** 「建项目时是否要自动补一次提交」
    属**产品决定**，不由验证类任务顺手改（宪法 §I 也要求别动上游行为）。已登记进 `state.md` 缺口表。
  - 📌 **按裁定【乙】：`worktree = "/"` 那条已测出并上报**（第 4 条测试）。边界要说清：
    **不是** T006 的目录锚定失效——请求目录仍被锚在沙箱内；指到沙箱外的是**项目元数据**那一份。
  - **不是 TDD**（同 T007 ③ 的口径）：零生产代码改动 ⇒ 断言的是既有行为，属**特征化测试**。
    ⚠️ **本机观察到的那个 RED 是我自己 fixture 的 bug，不是产品缺陷**：两个 `--allow-empty`
    提交（空树 / 同身份 / 同 message / **落在同一秒**）在内容寻址下**哈希相同**，于是
    `a.id !== b.id` **假红**（单独跑时前两条 id 断言反而是绿的，正好暴露它是 setup 问题）。
    修法：给每个库写一个不同的种子文件——**确定性**地不同，不靠运气等时间跨秒。
  - **变异敏感性已验**（两条，都**只红目标那一条**）：
    ① 去掉 beta 的首次提交 ⇒ 「两项目独立」红（3 pass / 1 fail）；
    ② 给「条件成立」那条的一方补上提交 ⇒ 该条红（3 pass / 1 fail）。
    ② 的意义：它是**真特征化**而非空断言——上游哪天改了回落规则它就会红，而那正是要回来重读本段的时候。
  - **质量门禁**（2026-09-30 实跑，非外推）：core `bun test` = **1106 pass / 8 skip / 5 fail**
    （= 基线 1102 **+ 新增 4**；5 条失败**全是既有的 `NpmConfig`**，本机 `~/.npmrc` 镜像所致，与本次无关）；
    `bun run typecheck` **31/31 成功、exit 0**；`bunx oxlint -c script/oxlintrc.openhive.json` 该文件
    **0 warnings / 0 errors**（161 条规则，合 `LEARNINGS #001-05` 的恒等式）；`git diff --stat bun.lock` **无输出**。
- [ ] T009 验证 session.project_id 逻辑隔离 + 确认零表结构改动 [FR-007][FR-004] [T005] [出参：session 表无 user_id 列，逻辑隔离生效]

## Phase 5: US4 资源配额（P2）

- [ ] T010 实现每用户并发 Session 计数 + 限流（中间件 + SessionExecution）[FR-008] [T003] [出参：超限新会话被拒]
- [ ] T011 实现沙箱磁盘配额（Linux quota / docker volume）[FR-009] [T002] [出参：超配额写入被限制]

## Phase 6: 隔离测试（验收，P1）

- [ ] T012 写隔离测试：用户 A 访问用户 B 的 db 必须被拒 [FR-010][SC-001] [T005] [出参：测试通过，A 读不到 B 的会话/项目]
- [ ] T013 写隔离测试：用户 A 访问用户 B 的目录必须被拒（含伪造 directory 场景）[FR-010][SC-003] [T006][T007] [出参：测试通过，A 读写不到 /workspaces/B/]

---

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003（依赖 T001）；T004（依赖 T001）；T005（依赖 T003+T004）
- **Phase 3**：T006（依赖 T003）；T007（依赖 T002，可与 T006 并行）
- **Phase 4**：T008（依赖 T006）；T009（依赖 T005）
- **Phase 5**：T010（依赖 T003）∥ T011（依赖 T002）
- **Phase 6**：T012（依赖 T005）∥ T013（依赖 T006+T007）

共 13 条任务（T001–T013），符合 12–18 条范围。

---

## 002 移交的欠账（2026-09-29 落表）

002（认证与账号）收尾时把以下项**移交 F3**。**它们不在 003 原计划内**，是本表**新增的接收记录**。

> 为什么必须写在这里：002 的裁定原本只写在 `002-auth-account/state.md` 里，
> 而 003 的 Prerequisites 又写着「F2 已落地 X-User-ID 注入」——**两边都以为对方在做**，
> 净结果无人认领（登录页就是这样丢了两次）。欠账写进**接收方**的表，才是可检索的。

### ⚠️ 第一优先：网关本身（其余项的前置）

- [ ] **T014 实现网关（Auth 服务的 HTTP 面）**：登录 HTTP 端点 + JWT 验签 + httpOnly Cookie 下发 +
  注入 `X-User-ID` + **透传会话 JWT** + 错误呈现。[无依赖，但**是 T015/T016 的前置**]
  [出参：浏览器带 Cookie 访问 → 网关验签 → 剥离客户端头并覆盖注入 + 透传 JWT → 内核**再验一次** → 认身份]
  - 形态待定：`002-auth-account/plan.md` R3 倾向「网关模块内嵌」，未定案。
  - ✅ **已裁定（2026-09-29）：走【甲】真做验签**。002 收尾时曾裁【乙】「认链路不可达」，
    **本次推翻**——`spec.md` 的 FR-002 与验收场景 3、`plan.md` 的数据流向图、本段、
    `state.md` 均已同步改回。
    **推翻理由**：乙当时给的成本论据（「要两段共享密钥的分发与轮转」）**不成立**——
    002 已把整套 JWT 基建交齐（`packages/auth/src/token.ts` 的 `signToken` / `verifyToken` /
    `jwtSecret` / `sessionCookie`，且 `verifyToken` 返回的 subject 就是 userId）。
    **甲零新增密钥、零新增轮转**，只是把已签发的令牌多用一次。
    后果不对称：乙失败 = 公安案件数据任意跨用户暴露；甲失败 = 攻击者仍拿不到密钥。
    ⚠️ **甲是叠加不是回滚**——乙那两条硬要求（剥头覆盖 + 端口仅网关可达）在甲里**全部保留**。
  - 本 task 的三项硬要求：
    ① **网关注入前必须剥离客户端传入的 `X-User-ID`**（是覆盖，不是拼接）——
      否则够得着网关的用户可以自填身份；
    ② **内核端口只对网关可达**（回环绑定 / 网络策略），并写进部署文档；
    ③ **网关必须把会话 JWT 一并透传给内核**（Cookie 天然随请求流动；或显式走独立头——
      载体在 T003 落地时定），内核据此验签。
  - 🔗 **验签本身落在 T003**（**已落地**：`src/server/routes/instance/httpapi/middleware/user-identity.ts` 的中间件），不在本 task——
    本 task 管「注入 + 透传」，T003 管「验签后才认」。两者是同一条链的两端：
    T003 用**自造的合法 / 非法令牌**就能独立测（不必等网关）；
    真链路端到端验收在 T014 之后，作为 T016 的前置。
  - ⚠️ **明文头 `X-User-ID` 保留但降级**：仍是「注入链路是否健在」的廉价探针，
    但 **MUST NOT 被当作身份来源**。与验签结果不一致时，**以验签结果为准并拒绝请求**（fail-closed）。
  - 🔭 **已知的下游同型问题（不在本 feature 范围，但同根因）**：`X-User-ID` 在
    **F7/F8 的「MCP → 业务 PG RLS」**链路上**仍在传身份**（见 `007-fund-analysis/plan.md`
    与 `008-call-analysis/plan.md` 的数据流图与依赖表：`MCP -->|X-User-ID| RLS`）。
    那边若不验签，就是**同一个「明文头当凭证」的窟窿换了个位置**——
    F7/F8 开工时需照本条同样裁定。⚠️ 本 feature **不改 F7/F8 的 spec**，只在此记下，
    免得将来把它当成新问题重新发现一遍。
  - ⚠️ 002 的车牌门**默认关**（`OPENHIVE_REQUIRE_USER_ID` 未设即直通）。网关上线时置 `1` 打开。
  - 🔑 **`AUTH_JWT_SECRET` 必须 ≥ 32 字符**（002 评审 I7 加的地板，依据 RFC 7518 §3.2）。
    002 只交了**检查**（`packages/auth/src/token.ts` 的 `jwtSecret`，短了就抛 `WeakJwtSecretError`），
    而**全仓库没有任何生产代码调用它**——执行点就在这里。网关要做两件事：
    ① 在**启动路径**上调一次（`jwtSecret(process.env)`）并留着结果，让弱密钥当场起不来、
    而不是等到签发时才 500；② 把「≥32 字符」写进部署文档 / `.env.example`，
    别让运维靠报错反推。
    > 这条与上面 I2 脱敏是同一种移交：**003 只承诺「别绕过它」是不够的，得知道它存在**。

### 随网关一并做的呈现层

- [ ] **T015 登录页 + 强制改密弹窗**（002 的 T010 / T012，`[FE·新增]`）[依赖 T014]
  [出参：登录失败统一提示「账号或密码错误」；`must_change_pw` 命中时全屏遮罩锁死]
  - 服务层半边 002 已交（`login()` 对四种失败原因抛同一个 `InvalidCredentialsError` + 同一句消息；
    成功时透出 `mustChangePw`）。**缺的是「把它显示出来」**。
  - 落点待定：挂在 `packages/app` 的哪个位置；以及接线到 001 留的接入缝
    `packages/app/src/workspace/current-user.ts` 的 `setCurrentUser`
    ——**该缝至今零生产调用者**（002 实测）。

### 🔴 P0：越权 BOLA / BFLA

- [ ] **T016 越权测试：跨身份访问被拒**（P0）[依赖 T014]
  [出参：普通民警凭证调管理员能力（重置他人密码 / 停用他人账号 / 录入账号）**被拒**，且正向放行]
  - **为什么 002 没做**：002 是纯服务层，`resetPassword(db, userId)` / `changePassword` /
    `registerUser` **都没有「调用者身份」参数**——授权被刻意留给调用方
    （`packages/auth/src/password.ts` 的 `resetPassword` docstring：「本函数自己不做鉴权……
    真正的门禁在调用方」），
    而调用方不存在。**只能等 HTTP 层**，用双身份凭证写。
  - 002 已覆盖的部分（别重复）：`register.test.ts` 的「**is_admin 不在 8 字段内，默认关闭**」
    那条钉了「录入产生的账号一律非管理员」
    （服务层唯一可测的提权不变量）。
  - ✅ **脱敏 002 已做，不必重做**（2026-09-29 评审修复）：原始 `DrizzleQueryError` 的 `params`
    带 `password_hash` 明文，002 已在**三个写库点**（录入的 insert、改密与重置的 update）
    统一换成不带参数的 `AccountWriteError`，只带 SQLSTATE 出门（`packages/auth/src/pg-errors.ts`）。
    **网关只需别绕过它**——把错误原样「重抛 / 序列化 / 写日志」都会把领域错误的保护作废，
    接错误呈现时直接用领域错误的 `message` 与 `sqlState` 即可。

### 其余移交项（体量小，可并入上面任一条）

- [ ] **T017 `last_active_at` 的写入方**：[依赖 T014] design-v2 §4.1 说它「请求时更新」，
  实为**网关每个请求刷一次**。002 只加了列，**全仓库无写入方**（逾期停用判定依赖它）。
- [ ] **T018 沙箱目录的归档 / 恢复 / 删除**：[依赖 T014] 002 只交了账号侧半边
  （`deactivated_at` 列 + `restoreAccount` + 逾期清单筛选）。文件系统部分在 002 时
  「没有可作用的对象」（沙箱还只是空目录），网关落地后才有真实研判产物。

### 002 收尾评审未修项（2026-09-29 落表）

002 的收尾评审报 3 Critical + 10 Important + 16 Minor。Critical 与低争议 Important 已在 002 内
修完（commit `c0c342421a`）；下列 6 条经用户裁定**移交本 feature**。

**与上面 T014–T018 的关键区别：这 6 条不依赖网关**，没有 T014 这个前置，现在就能做。

- [ ] **T019 引导首个管理员**（002 评审 I1）[无依赖]
  [出参：`OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO` 指定的账号，在 `auth.user` 里**一个
  `is_admin = 1` 的行都没有**时被置为管理员；表里已有管理员时该变量**完全无效**（不是"再置一个"）。
  引导是**一次性**的——跑通后即可从环境里撤掉该变量。]
  - **为什么必须有**：002 全仓库**没有任何产生管理员的路径**（实测：`registerUser` 恒写
    `isAdmin: 0`）。而 003 治理后台的全部能力（录入 / 重置 / 停用）都要求 `is_admin`——
    没有第一个管理员，就没有第二个，**系统第一天就锁死**。
  - ⚠️ **不许做成"每次启动都置一遍"**：那等于把提权做成常开开关，能改环境变量的人就能提权。
    判据必须是「表里一个管理员都没有」，且**只在启动时判一次**。
  - 形态：`packages/auth/src/policy.ts` 已有 `JWT_SECRET_ENV` 这类环境变量常量的先例，照它加。
  - 与 T024 配套：T019 让管理员**存在**，T024 保证它不会被误停用掉。

- [ ] **T020 默认口令走配置**（002 评审 I3）[无依赖]
  [出参：`DEFAULT_PASSWORD` 不再硬编码在 `packages/auth/src/policy.ts`，改为
  环境变量读取 + 该值作兜底（兜底留给开发/测试）]
  - ⚠️ **先裁定文档**：design-v2 §4.1（`2026-09-06-openhive-design-v2.md:155-157`）
    把 `admin@123456` 当公开示例**写在正文里**。改配置时要么同步文档，要么保持文档为
    "示例值"并在配置项注释里说清二者关系——否则两处会互相矛盾。
  - 这条是项目约束「品牌 / 环境值走 config，不硬编码进源码」的直接落点。

- [ ] **T021 migrate 的事务与并发锁**（002 评审 I4）[无依赖]
  [出参：两个进程同时 `migrate()` 时只有一个应用迁移，另一个等待后看到"已应用"；
  单个迁移文件内失败时**整文件回滚**，不留半应用状态]
  - 现状（据 `packages/auth/src/migrate.ts` 源码，非文档口径）：`runFile` 逐条 `execute`
    且无 BEGIN/COMMIT；`_migration` 的记账 insert 排在 `runFile` **之后**。于是单文件中途
    失败 = 「改了库、没记账」，重试**从文件头重跑**——002 的 `0003_flags_not_null` 因此
    把「4 条语句全部幂等」写进了文件头。并发上，两个 runner 各自读 `applied` 后都会去应用。
  - ⚠️ **`migrate.ts` 里要补上这段缺口说明**：`0003` 的文件头原本写着「见 migrate.ts 的
    已知缺口」，而 `migrate.ts` **全文没有这个缺口的记载**——引用是悬空的。
    **`0003` 那半边已于 002 第二轮复审（R9，commit `e77ec877aa`）改为自足表述**
    （「原因写在这里、不指向别处」），所以只剩 `migrate.ts` 侧要补：加一句
    「逐条执行、无事务，故迁移文件必须自幂等」。
    > 保留这段记录是因为：**它记的是「谁该说什么」，不是「哪句话现在错了」**。
  - ⚠️ 加了事务与锁之后，回头**核对注释是否仍成立**——别让注释停在一个已被代码推翻的说法上。
    具体是两处：`migrate.ts` 新增的那段，以及 `0003` 文件头那段「运行器没有事务…」。

- [ ] **T022 provisionUser 的半成品处置**（002 评审 I5）[无依赖]
  [出参：建沙箱目录失败时，已落库的账号行有明确处置（删除 / 标记待补），
  不再留下「有账号、没沙箱」的静默半成品]
  - 002 的 `register.ts` 已把**目录侧**的取舍写明（先落库后建目录、宁可留空目录也不冒误删风险）；
    缺的是**账号行侧**的处置——那半边的取舍还没人做过。

- [ ] **T023 connect() 的超时 / 连接池 / close**（002 评审 I8）[无依赖]
  [出参：PG 连接有连接超时与语句超时；服务退出时连接池被关闭；配置集中在一处]
  - 002 的 `connect()` 直连、无池、无超时、无 `close`。生产上的症状不是报错而是**挂住**——
    PG 不可达时请求一直等，没有快速失败。

- [ ] **T024 停用不得停掉最后一个管理员**（002 评审 I9 的另一半）[无依赖]
  [出参：批量停用的入参里含某管理员，且停用后 `is_admin = 1 and status = 1` 的行数为 0 →
  该次停用被拒（或该 id 被跳过并明确报出）]
  - ⚠️ **判据别搞错**：**不要**用「把管理员从僵尸名单里滤掉」来实现。特权休眠账号
    **恰恰最该被看见**——一个 90 天没人用、却能录入账号和重置密码的账号是风险最高的一类，
    滤掉等于把它藏起来。要拦的是那个**一键动作**，不是那条名单。
  - 与 T019 配套（见上）。

> **移交来源**：`002-auth-account/state.md` 的「范围裁定」① ②、「收尾补测」节、
> 「收尾评审发现与处置」节；`002-auth-account/tasks.md` 的「前端落点裁定」段。

> **任务总数更新**：13 条（003 原计划 T001–T013）+ 5 条（002 移交 T014–T018）
> \+ 6 条（002 收尾评审移交 T019–T024）= **24 条**。
> **T014 是 T015 / T016 / T017 / T018 的硬前置**；T019–T024 **不依赖 T014**，可并行开工。
