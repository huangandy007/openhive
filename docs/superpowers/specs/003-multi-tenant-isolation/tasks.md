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
- [x] T009 验证 session.project_id 逻辑隔离 + 确认零表结构改动 [FR-007][FR-004] [T005] [出参：session 表无 user_id 列，逻辑隔离生效]
  **✅ 2026-09-30 完成 —— 两条出参都达成**。零生产代码改动，新增
  `packages/core/test/session-project-isolation.test.ts`（3 条）。
  - **出参①「session 表无 `user_id` 列」**：对**真实建出来的表**断言（`pragma_table_info('session')`），
    **不只读 TS 模型**——模型与迁移是**两份真相**（`packages/auth/src/user.test.ts` 的「防漂移」即此思路）。
    core 里可行：`packages/core/test/preload.ts` 把 `OPENCODE_DB` 设成 `:memory:`，
    而 `Database.node` 开库时会 `DatabaseMigration.apply`。**两边都查**：模型（有人改 drizzle 定义）
    + 真实表（有人加迁移）。并同时钉 `project_id` **必须在**——只断言「没有 `user_id`」的话，
    查错表 / 表名写错 / 拿到空数组都会绿；钉一个**必须存在**的列才说明这份清单真读到东西了。
  - **出参②「逻辑隔离生效」**：同一用户（同一库）两个项目，`list({project})` 各只返回自己的会话。
    📌 **执行点不止一个，两条栈上都有**（本轮把两条都读了）：
    ① `@opencode-ai/core/session` 的 `SessionV2.list` —— `if ("project" in input)` 时按 `project_id` 过滤；
    ② **生产 HTTP 那条**：`packages/opencode/src/session/session.ts` 的 `Session.list` 调 `listByProject`，
    **无条件**先按 `projectID: ctx.project.id`（来自 `InstanceState.context`）过滤，再按 `directory` 收窄。
    ⇒ 「会话通过 `project_id` 逻辑归属到项目」**有真实执行点**，不是只写在文档里。
  - ⚠️ **但必须说清它是什么**：`SessionStore.get` **只按 `session_id` 查、不看 project**
    ⇒ 这是**查询侧的逻辑隔离**，**不是**一道能挡越权的门（拿得到 `session_id` 就取得到那行）。
    **跨用户那一半不靠它**，靠 T005 的每用户独立库。**别把 `project_id` 当授权判据。**
  - ⚠️ **顺带发现两条「项目边界之外」的读路径**（**登记给 T012/T013**，本轮未修未测。
    📌 **2026-09-30 补记**：T012/T013 已收尾**但仍未覆盖**它们——两者测的是**跨用户**，
    而这两条**不跨用户**、不在其出参内 ⇒ **现无接收方**，待裁，见 `state.md`「阻塞项」第 2 条）：
    ① `SessionV2.list` 走 `ListAllInput` 变体（**不带任何 scope**）时返回**本库内全部**会话；
    ② legacy 的 `Session.listGlobal` **完全不带 project 条件**，且经
    `handlers/experimental.ts` 的 `experimentalHandlers` 挂载（`server.ts` 里**无开关**，直接进路由组）。
    两条都**仍是「本库 = 本用户」内**（T005 的每用户库兜住跨用户），**不跨用户**；
    但「同一用户内项目之间不串」在它们上面**不成立**。
  - **与 T008 的接口**（本 task 最该一并念的事实）：`create` 里 `project_id` 是
    `projects.resolve(input.location.directory)` **从会话目录推出来的** ⇒ 两个目录算不算两个项目由 T008 决定；
    而 T008 已实测**首次提交之前二者都解析成 `global`**。
  - 于是第 3 条测**那个窗口里的后备判据**：项目 id 塌成一个时 `list({project})` 会把两边一起返回
    （**不是 bug**，是 T008 登记过的条件成立），但 `list({directory})` 仍把两边分开。
    📌 **这条不是「理论上还有一道」——它正是生产默认行为**：`Session.list` 在 `scope !== "project"` 时
    **总会**再加一个 `directory` 条件（`session.ts` 的 `listByProject`），前端 `directory-sync` 也正是
    传 `{ directory, ... }`。⇒ **项目边界有前提，目录边界没有；而生产默认走的就是目录边界。**
  - **不是 TDD**（同 T007 ③ / T008 的口径）：断言既有行为，**本机没有观察到 RED**。
  - **变异敏感性已验**（两条）：
    ① 往 `SessionTable` 加一列 `user_id` ⇒ 出参①红（`Expected to not contain: "user_id"`）；
    ② 把 `list` 的 project 条件停用 ⇒ **只有**出参②那条红（2 pass / 1 fail）。
    两个上游文件（`src/session/sql.ts`、`src/session.ts`）改后均**逐字还原**，`git diff --stat` 已核为空。
  - ⚠️ **诚实交代 ① 的敏感性边界**：上面那条变异只动**模型**，真实表未变，所以红的只有模型那半。
    要让**表**那半红，得加一个迁移（成本高，本轮**未做**）。表那半「不是空断言」由同一测试里的
    `expect(table).toContain("project_id")` + `expect(table.length).toBeGreaterThan(0)` 保证——它证明 `pragma_table_info('session')`
    真的读到了 `session` 表。
  - **质量门禁**（2026-09-30 实跑，非外推）：core `bun test` = **1109 pass / 8 skip / 5 fail**
    （= T008 的 1106 **+3**；5 条仍是既有 `NpmConfig`，与本轮无关）；
    `bun run typecheck` **31/31、exit 0**；该文件 `bunx oxlint -c script/oxlintrc.openhive.json`
    **0 warnings / 0 errors**（161 条规则）；`git diff --stat bun.lock` **无输出**。

## Phase 5: US4 资源配额（P2）

- [x] T010 实现每用户并发 Session 计数 + 限流（中间件 + SessionExecution）[FR-008] [T003] [出参：超限新会话被拒]
  **✅ D4-1 已裁定（2026-09-30 · 维度甲 + 覆盖面丙）——形状已定，可开工**：
  - **计数维度** = 本用户**当前正在跑的** session（**不是**存量、**不是**新建）。
  - **拦点 = 启动执行时**，**不是**建会话时。
    ⚠️ **同日二次裁定（覆盖面）**：原本写的「数 `SessionExecution.active` ∩ 本用户的库」
    **只覆盖 B 链**，实测发现产品 UI 走的是 **A 链**（见下「两条链」）。
    **改【丙】：两条链都拦**，判定 + 阈值 + 计数逻辑全在同一个 `quota/session-quota.ts`，
    只有**「活跃集合从哪取」按链注入**。
  - **两条链**（挂在同一棵路由树上，`server.ts` 的 `createRoutes` 同时挂 `instanceRoutes` 与 `serverRoutes`）：
    | 链 | 端点 | 启动执行的落点 | 活跃集合 |
    |---|---|---|---|
    | **A · web UI** | `POST /session/{id}/prompt_async` | `SessionPrompt.prompt` → `SessionRunState.ensureRunning` | `SessionStatus` 的 busy（`InstanceState` 作用域） |
    | **B · CLI `serve` / sdk-next** | `POST /api/session/{id}/prompt` | core `SessionV2.prompt` → `execution.wake` | `SessionExecution.active`（进程级） |
    - A 链**完全不碰** core 的 `SessionExecution`——`packages/opencode` 生产代码里一处
      `yield* SessionExecution.Service` 都没有，只有接线。
    - **为什么必须两条都拦**：`/api/*` 与 T009 登记的 `listGlobal` 同型——**同一棵树上、没有开关**，
      过得了身份门的用户都够得着 ⇒ **能被另一个端点绕过的配额不是配额**。
    - 📌 **不连带返工**：T005 的库路由不受影响（A 链用的也是 core 的 `Database.Service`，
      路由发生在 `$client.reserve`、按发起查询的 **fiber** 的 `User` 分）。
    **为什么**：session 只是一行记录、几乎不耗资源，吃资源的是跑起来的 turn
    （模型调用 / 工具 / shell）。
    ⚠️ **spec.md 验收场景 1 措辞有歧义，不拿它当依据**：「A 的并发会话数达到上限 → A 再发起新会话被拒」
    可读成**不让建会话**、也可读成**不让跑起来**。甲取后者，依据是它自己用的词是**「并发」**
    （空闲的会话行不构成并发）。**与验收方对齐时要主动说出来。**
    **乙**（按存量 session 数拦在 `create`）被否：拦的不是资源消耗，建满上限的空会话反挡正常使用；
    **丙**（两道都上）被否：多一处执行点 + 多一套阈值，两套规则并存时「为什么不让用」难解释。
  - ⚠️ **落地时要核一件事**（D4 未涉及、但开工必查）：这个拦点与 **F4 的工具执行守卫**是否打架。
  **✅ 2026-09-30 完成 —— 出参「超限新会话被拒」在判据层与接线层达成；端到端那一枪仍是缺口（见末行）**。
  新增 4 文件，改动 2 文件（各 2 行挂载 + 1 行 import），**零错误契约改动、零 schema 改动**。
  - **落点**：core `packages/core/src/quota/session-quota.ts`（唯一一份判定 + 阈值 + 计数，7 测）；
    opencode `.../httpapi/middleware/session-quota.ts`（两种形态的适配器）；测试
    `packages/core/test/session-quota.test.ts`（7 pass）、
    `packages/opencode/test/server/session-quota-middleware.test.ts`（7 pass：5 条判据 + 2 条守夜）。
  - **有意偏离 `plan.md`**：模块放 **core**，不按 plan 写的 `packages/opencode/src/quota/`。
    理由：**B 链的拦截点在 core**（`SessionV2.prompt`），而 core 不能 import `@opencode-ai/opencode`
    （`packages/core/package.json` 无该依赖）⇒ 两条链要共用一份判定，只能放 core。
  - **⚠️ 裁定前提被实测推翻（本 task 最该念的一条）**：D4-1 覆盖面【丙】写「两条链都拦」，
    但当时**默认「有活跃集合 = 能拦」**，实测发现 **两条链活在两个不同的层作用域**：
    - `SessionV2.Service`（B 链活跃集合）、`Database.Service` —— 路由层够得着；
    - `SessionStatus.Service`（A 链活跃集合）—— 层构造期**取得到**，**请求期调用失败**。
      根因：实例上下文（`InstanceRef`）由**端点级** `HttpApiMiddleware`（`InstanceContextMiddleware`）
      注入，**任何路由级中间件都在它外面**。⇒ **A 链只能走端点级**（`.middleware(...)`），
      B 链走路由级。**两次挂载、一份判定**（`judge` 是唯一分支处）。
    - 探针实测过坏法：挂错位置不是静默放行，是 `Service not found` → **500**。
  - **⚠️ 官方 `HttpApiMiddleware.Service` 声明里不能写 `requires`**（typecheck 实测，二分定位）：
    写进去的需求会**焊进 API 的类型**（`InstanceHttpApi` 的 requirement），那个位置**任何
    `Layer.provide` 都消不掉**——层在下面供了、运行期也对，typecheck 却坚持说还欠着。
    照官方 `Authorization` 先例（它只有 `error`、没有 `requires`），需求留在**层**上即可。
  - **响应形状**：**裸 429 + JSON body**（`SessionQuotaExceeded`），**不声明进 HttpApi 错误契约**。
    这是「不碰 4~6 个上游契约文件」换来的代价，客户端按状态码识别。
  - **判据两段（不是优化）**：`exceeds` = `alreadyRunning` **先放行**、再看 `active >= limit`。
    `run-coordinator.ts` 的 `wake` 对已在跑的 key 只置 `pendingWake`、**不新建条目**⇒
    满配额时给正在跑的会话**追加一句 steer** 不增加并发，若只写 `active >= limit` 会把它误拒。
  - **阈值**：`OPENHIVE_MAX_SESSIONS_PER_USER`，默认 **5**；四种回落（没设 / 空串 / 非数字 / 非正数）
    一律回默认。**非数字那条是必须的**：`Number("abc")` 是 `NaN`，任何与 `NaN` 的比较恒假 ⇒
    放它过去 `active >= NaN` 恒 false、**限流静默失效**（门看着还在）。⚠️ 默认值**未经压测、非结论**。
  - **变异验证（两条，都实测）**：① 让 A 链的 `read` `Effect.die` ⇒ A 链那组测试立刻红（证明端点级
    中间件**真的在执行**，不是挂了个摆设）；② `countActiveForUser` 空集合不进 SQL 那条由单测钉住。
  - **核过 D4 未涉及、但本 task 必查的一条**：「与 F4 的工具执行守卫是否打架」——
    **不打架**。F4（`004-access-control`）**尚未落地**（无 `src/authz/` 代码），其两个钩点在
    **工具清单组装 / 执行器入口**，都在「一轮已经跑起来**之后**」；本 task 在**prompt 入口准入**。
    不同层、不重叠：被本 task 拒的 prompt 根本走不到工具执行；被 F4 拒的工具调用发生在已准入的轮内。
  - ⚠️ **未覆盖（缺口，不是覆盖）**：端到端「**第 6 个真会话被拒**」**未验证**——要让 `active ≥ limit`
    得先有真会话在跑（真 agent 执行，重且不确定）。守夜测试只能证「依赖解析得开、不是 500」，
    **证不了 429 会发生**。按 `LEARNINGS #002-02` 明写为**缺口**，留给 T012/T013 或压测补。
    📌 **2026-09-30 补记**：T012/T013 已收尾**但仍未覆盖它**（出参是「A 读不到 B」，不含限流）
    ⇒ **现无接收方**，待裁（见 `state.md`「阻塞项」第 2 条）。
  - **质量门禁（2026-09-30 实跑，非外推）**：`bun run typecheck` **31/31、exit 0**；
    `packages/core/test/session-quota.test.ts` **7 pass / 0 fail**；
    `packages/opencode` 影响面四文件（本 task + `user-identity` + `multi-tenant-routing` +
    `anchor-workspace`）**31 pass / 0 fail**；改动/新增 6 文件 `bunx oxlint` **0 errors**，
    2 条 warning 是 `groups/session.ts` 的 `Permission` / `MessageV2` 未使用 import，
    `git show HEAD:` 实测**同样存在于 HEAD** ⇒ 非本次引入，不动（`#001-02` + 外科手术式改动）；
    `git diff --stat bun.lock` **无输出**。
  - **`test/server` 全目录不做「全绿」门禁**（沿用 T005 登记）：本轮真跑**基线对照**——
    回退 2 个接线文件跑得 **298 pass / 23 skip / 9 fail**（**9 条全是 5s 超时**），
    带改动跑 **298 pass / 23 skip / 9 fail / 1 error**；失败集合**名称级差集双向变动**
    （7 条两边都红、2 条只在基线红、2 条只在带改动红）⇒ 同一「跑次噪声」签名，**本 task 未引入新失败**。
  - ⚠️ **顺带实测出的一条存量 flaky（登记，本轮未修）**：`user-identity.test.ts` 的
    「开关开：令牌被篡改 → 拒绝」以 **≈1/16** 概率**假红**。机制（300 条探针实测，非推理）：
    HS256 签名 32 字节 → base64url **43 字符**，末字符只有 4 个真比特、**低 2 位是填充**；
    该测试把末字符 `A`→`B`（`A`=000000 → `B`=000001）**只动了填充位** ⇒ 解出的签名字节
    **逐字节相同** ⇒ 验签照样通过（实测：300 条里末字符为 `A` 的 20 条**全部**「篡改后仍验过」，
    改中间字符 0/300 幸存）。**不是身份门漏了、也不是安全洞**，是**测试构造缺陷**。
    修法（未做）：别改末字符——改中间字符、或改 payload 再重签。**留给用户裁决是否本轮修。**

- [x] T011 实现沙箱磁盘配额（Linux quota / docker volume）[FR-009] [T002] [出参：超配额写入被限制]
  **✅ D4-3 已裁定（2026-09-30 · 丙）——拆成「做的」+「挂账的」两半**：
  - **做的**：**应用层**配额——写入前统计沙箱占用，超限拒绝写入。**T011 的出参由这半达成**。
  - **挂账的**：**OS 级强制**（Linux quota / docker volume）写进部署文档待办 + `state.md` 缺口表一行，
    并照 `LEARNINGS #002-02` 明写「**未覆盖**」而非「已覆盖」。
    本机限制：`docker: command not found`，win32 无文件系统 quota（同 `#002-05` 的处境）。
  - **甲**（只做应用层、不提 OS 层）被否：会留下「已隔离」的不实印象——应用层配额**绕得过**
    （不走 opencode 工具的写入不受管），而 FR-009 要的是「沙箱磁盘配额」这道底线。
    **乙**（严格照 plan 走 OS 配额）被否：本机写得出配置、测不了效果，T011 只能整条挂账。
  **✅ 2026-09-30 完成 —— 出参「超配额写入被限制」在**应用层**达成；OS 级那半**挂账**（见末行）。**
  新增 3 文件、改动 1 文件（新增 1 行调用 + 错误联合 +1 项），**零 schema 改动、零错误契约改动**。
  - **拦点（用户裁定）**：**`FSUtil.writeWithDirs` 这道写漏斗**，不是插件钩子、不是各工具分别接。
    `write` / `edit` / `apply_patch` **三者全部收敛到它**（`tool/write.ts`、`tool/edit.ts`、
    `patch/index.ts`、`core/file-mutation.ts`）⇒ **一处接线覆盖三个工具**，不会漏一个。
    **绕过面**：`shell` 工具不走它（D4-3 已认）——那半只能靠部署侧，见末行。
  - **落点**：core `packages/core/src/quota/disk-quota.ts`（判定 + 阈值 + 统计，无 layer 可单测）；
    接线 `packages/core/src/fs-util.ts` 的 `writeWithDirs`（落盘**前**判）；`FSUtil.Error` 联合加一项
    `DiskQuota.SandboxWriteRejected`。测试 `packages/core/test/disk-quota.test.ts`（**19 pass**）、
    防漂移 `packages/opencode/test/disk-quota-drift.test.ts`（1 pass）。
  - **⚠️ 错误类为什么定义在 `disk-quota.ts` 而不是 `FSUtil` 命名空间**：`fs-util.ts` 要 import 本模块
    调守卫，本模块若反过来 import `FSUtil` 取错误类就是**运行时循环**（`session-quota.ts` 用
    `import type` 避开的是同类问题，但错误类在抛的时候是**值**，`import type` 消不掉）。
  - **四条判据（每条都有测试钉住）**：
    1. **`replacing` 抵扣（不是优化、是主路径必需）**：判据是 `used - replacing + incoming > limit`。
       三个写入工具**都是整文件重写**（改一个字符也重发全文），不抵扣的话沙箱一接近上限，
       **连把文件改小都会被拒**——「磁盘满了所以你不能删内容」，民警会卡在改不动也删不掉。
    2. **恰好写满到上限放行**（`>` 不是 `>=`）。⚠️ 与 T010 的 `exceeds`（`active >= limit` 就拒）
       **方向不同、不是笔误**：那边数**名额**（再要一个就超出），这边量**字节总量**（写满为止）。
    3. **沙箱外的路径直接放行、连统计都不做**：`/data/{userId}/` 的库、临时目录、ripgrep 解出的
       二进制、`~/.local/share/...` 的 storage 全都不在沙箱根下，判错一点就把整个进程写死。
       **要有第二段才算沙箱内**（`{root}/{userId}/…`）——沙箱根自身与**根下散文件**不算。
       ⚠️ 后半句是踩出来的：先把根下散文件也当成「一个用户的沙箱」，则扫它会 ENOTDIR ⇒
       那个文件的**每次写入都被判成「量不出来」而拒掉**（地雷，已由测试钉住）。
    4. **量不出来 ⇒ 拒（`reason: "unmeasurable"`），不静默放行**。这条可以反着定（`du` 就是
       「读不到的目录跳过、继续算」）；选拒绝的理由：这道门本来就绕得过，再对「量不出来」静默放行
       等于把配额做成一句声明（`LEARNINGS #002-02` 的「门看着还在、其实没有」）。
       扫描失败是异常态，宁可让管理员看到一条明确的错误。
  - **判的是最终落点、不是字符串**：两边 `resolve` 后再 `relative` ⇒ `{root}/alice/../bob/x` 归 **bob**；
    用字符串前缀比较则 `/w/ali` 会把 `/w/alice/f` 误判成自己的子路径（用户 id 长度不一，`alice`/`ali`
    完全可能同时存在）。两条都各有测试。
  - **中文按 UTF-8 字节算**（`Buffer.byteLength`），**不用 `content.length`**：后者是 UTF-16 码元数，
    中文一个字 1 码元、落盘 3 字节 ⇒ 用 `length` 会让配额**少算三分之二**，而民警的产物
    （研判报告 / 话单分析）恰恰全是中文——等于**专门对主用途失灵**。
  - **⚠️ core 取不到 auth 的常量 ⇒ 另立一份 + 防漂移测试**：沙箱根真身在 002 的
    `packages/auth/src/workspace.ts`，而 `core` 与 `auth` **互相都不依赖** ⇒ core 侧只能抄一份字面量。
    `packages/opencode`（同时依赖两者）里一条断言钉住「同名环境变量 + 同默认根」。
    **漂了会怎样**：auth 那半决定把用户锚到哪个目录、core 这半决定配额盯着哪个目录，一旦漂开，
    配额**永远显示 0 字节已用 ⇒ 永远不拒任何写入**，且不报错、不变红，只有那条测试会红。
  - **变异验证（四条，都实测）**：① `>` 改 `>=` ⇒ **4 条红**；② 去掉 `replacing` 抵扣 ⇒ **2 条红**；
    ③ 不排根外路径 ⇒ **5 条红**；④ 改掉 core 那份默认沙箱根（模拟漂移）⇒ 防漂移测试红。
  - **核过与 F4 是否打架 → 不打架**：F4 的工具执行守卫管**「谁可以」**，本 task 管**「还有没有地方」**；
    两者作用于同一次写但判据不同层。另：F4 的钩子只能阻断**工具调用**，拦不到 `storage.ts` /
    `config.ts` 这些**非工具**的写入，而本 task 在 FS 漏斗上——覆盖面不同，不互相替代。
  - ⚠️ **未覆盖（缺口，不是覆盖）**：① **OS 级强制**（下面那条，挂账）；② `shell` 工具绕过（D4-3 已认）；
    ③ **符号链接 / 设备 / 管道那支「不计数」的代码没有测试守着**（win32 建符号链接要管理员权限）——
    该分支只 1 行，行为是「跳过」，风险低但**如实记**。
  - **质量门禁（2026-09-30 实跑，非外推）**：`bun run typecheck` **31/31、exit 0**（`FSUtil.Error` 加一项
    **零连带**——全仓无一处因它改动）；core 全量 **1135 pass / 8 skip / 5 fail**，5 条全是**存量**
    `NpmConfig`（本机 `~/.npmrc` 镜像，T004/T009 已登记），且 **T009 基线 1109 + 26（T010 的 7 +
    本 task 的 19）= 1135 精确吻合**；opencode **三个写入工具 72 pass / 0 fail** + 防漂移 1 pass；
    三个新文件 `bunx oxlint` **0 errors / 0 warnings**，改动的 `fs-util.ts` 那 4 条 warning 用
    `git show HEAD:` 实测**同样存在于 HEAD** ⇒ 非本次引入，不动（`#001-02` + 外科手术式改动）；
    `git diff --stat bun.lock` **无输出**。
    📌 另记一次跑次噪声：同日第一次全量跑出 **8 fail / 1 error**（含 `snapshot.test.ts` 5s 超时），
    第二遍即回到 5 fail —— 与本 task 无因果（`#001-01`：判「有没有变坏」看**名单**不看总数）。
  - 🟡 **挂账那一半（OS 级强制）的落点 = `docs/workspace/deploy-todo.md` 的 D-01**（本 task 新建的文件）。
    为什么新建：任务书写「写进部署文档待办」，而仓库里**此前没有部署文档**（T007 ① 也记过同一处境）。
    该文件同时收纳 002 的密钥长度地板（D-03）与 T014 的网关侧两条（D-02）——**各任务落地时把条目
    「移」进去，不要抄**（抄两份就是两个真相）。D-01 的验收写的是「**绕开 opencode 工具**灌一个大文件、
    应当被 OS 拒绝」，并明写「**只验『应用层拒绝写入』不算过**」。

## Phase 6: 隔离测试（验收，P1）

- [x] T012 写隔离测试：用户 A 访问用户 B 的 db 必须被拒 [FR-010][SC-001] [T005] [出参：测试通过，A 读不到 B 的会话/项目]
  **✅ 2026-09-30 完成 —— 出参「A 读不到 B 的会话/项目」在 HTTP 层达成。**
  新增 1 文件（`packages/opencode/test/server/tenant-db-isolation.test.ts`），**零产品代码改动**（`git diff
  --stat packages/core/src packages/opencode/src` 无输出）。
  - **为什么不是「再写一条 core 单测」**：T005 的 `packages/core/test/database-routing.test.ts` 证的是
    **机制**（同一段查询代码按身份落到不同库）；本 task 证的是**接线**——把整棵真应用的链路跑起来，
    从 HTTP 这一层问「A 能不能看见 B 的东西」。机制绿**不保证**接线装对了。
  - **求真（任务书 [INT]「跑真实端到端，不 mock」）**：走**真应用**（`HttpApiApp.routes`）+ **真实签发器**
    （`@opencode-ai/auth/token` 的 `signToken`）发带签名 Cookie 的请求，**没有任何 mock**。
  - **4 条断言，双向**（任务书 Step 4「过紧也是缺陷」）：① A 建的会话落在 A 自己的库文件里
    （同时断言 **B 的库文件这一步还不该存在**——不是「存在但为空」，是根本没被碰过）；② B 按 id 直取
    A 的会话 → **404**（不是「返回了但没权限看」）；③ B 列会话看不到 A 的，**且 B 看得到自己的**、
    A 看得到自己的；④ 各自的会话落在各自的库文件里。
  - **oracle 不经过被测对象**（`LEARNINGS #002-02`）：③④ 里「会话落在谁的库里」一律用 `bun:sqlite`
    **直接读库文件**断言，不调我们自己的接口——拿被测对象证明被测对象等于没证。
  - **⚠️ 首次跑就是 4 pass / 0 fail——没有 RED**。这是**验证既有行为**的任务（T004/T005/T006 早已落地），
    按 T008/T009 的同样做法改用**变异测试**证明断言真的守得住，共 3 次，全部还原：
    ① 在 `router.ts` 的取连接钩子里**提前 `return Option.none()`**（等于取消按用户路由）⇒ **4 条全红**；
    ② **只对 BOB 的 id 返回 `Option.none()`** ⇒ **仅第 ④ 条红**，其余 3 条绿——这正是要的：证明
    「过紧也是缺陷」那半（「A 看得到自己的」）确实在为**正确的理由**起作用，而不是搭便车。
  - **一条实测出的接线知识（别记错）**：`OPENHIVE_DATA_ROOT` **只能走 `process.env`**，**不能走
    `ConfigProvider`**——`DatabaseRouter.layer()` 读的是 `dataRoot(process.env)`，不是 Effect 的 `Config`
    服务。所以 `anchor-workspace.test.ts` 那种「env 全塞 ConfigProvider」的写法在这里**对身份门与锚定有效、
    对数据根会被无声忽略**（库会落到默认的 `/data/...` 去，测试看着还是绿的）。
    值的生命周期只到**层构建**为止（`Layer.unwrap` 里求值一次），故建完 handler 即可还原 `process.env`。
  - **⚠️ 未覆盖（缺口，不是覆盖）**：① **T009 登记的两条「项目边界之外」读路径**本轮**未测**——注意它们
    **不跨用户**（T005 的每用户库兜住跨用户），是「同一用户内项目之间不串」那半边，见 `state.md` 缺口表；
    ② **T010 的端到端 429** 本轮**未覆盖**（要让 `active ≥ limit` 得先有真会话在跑）；③ **长连接**
    （SSE `/event`、WebSocket `/pty`）与 `SessionPrompt` 下的取连接行为**仍未测**。
  - **质量门禁（2026-09-30 实跑，非外推）**：两个新测试文件 **9 pass / 0 fail / 33 expect**；
    `bun run typecheck` **31/31、exit 0**；本文件 `bunx oxlint` **0 warnings / 0 errors**；
    `git diff --stat bun.lock` **无输出**。

- [x] T013 写隔离测试：用户 A 访问用户 B 的目录必须被拒（含伪造 directory 场景）[FR-010][SC-003] [T006][T007] [出参：测试通过，A 读写不到 /workspaces/B/]
  **✅ 2026-09-30 完成 —— 出参「A 读写不到 `/workspaces/B/`」在**应用层**达成。**
  新增 1 文件（`packages/opencode/test/server/tenant-directory-isolation.test.ts`），**零产品代码改动**。
  - **⚠️ 这份断言证明的是什么——按 `plan.md` R3 ② 的原话如实写**：挡在中间的是**应用层锚定**（T006），
    **不是 OS 权限**。003 已裁定：单进程 = 一个 OS 主体，`0700` 对「A vs B」零作用，其效力降级为
    **容器外防护**（`isolation-scheme.md` §5）。所以本文件的每条断言只说明「**请求进不来**」，
    **不得**据此宣称「OS 已隔离」。
  - **为什么走真实 HTTP 而不是直接调锚定函数**：锚定是**全局中间件**，只有接进真实 `createRoutes`
    才测得到「装法对不对」——自己搭个最小路由套中间件，漏装也照样绿（同 `anchor-workspace.test.ts`
    的理由）。两者不重复：那边证「锚到哪」，这边证「**锚定之后，A 到底够不够得着 B 的东西**」。
  - **5 条断言，双向**：① A 伪造 `directory` 指向 **B 的沙箱**（比「随便一个不存在的绝对路径」更贴近
    真实攻击——攻击者会报一个**真实存在**的别人家目录）⇒ 被忽略，仍落自己的沙箱，**两边都验**；
    ② A 用 `..` 穿越读 B 沙箱里的文件 ⇒ 非 200 **且响应体里不含 B 的明文内容**；③ A 列 B 的沙箱目录 ⇒
    看不到 B 的文件名；④⑤ **反向**：A 读得到 / 列得到自己沙箱里的东西（「锚定没锚过头」）。
  - **为什么断言内容而不只断言状态码**：只断言非 200 的话，一个 200 + 错误体、或一个 500 + 把内容
    带进错误详情的实现都能混过去。真正的安全属性是「**内容没漏**」，状态码只是它的一个表征。
  - **⚠️ 挡住穿越的**不是**一处**（变异验证实测出来的，别记错）：有两道 `FSUtil.contains`，**都在上游
    自有代码里，本 feature 一行都没加**——① `packages/core/src/filesystem.ts` 的 `resolve()`
    （`read` / `list` **共用**）；② `handlers/file.ts` 的 `content`（只护 `content`）。实测：
    **只拿掉 ②**，本文件两条穿越用例**都还绿**（① 兜住）；**只拿掉 ①**，「列目录」那条**红**
    （`list` 只有 ①）；**两条都拿掉**，两条用例才都红。⇒「读文件」是**双重**的（任一道在就够），
    「列目录」**只有** ① 一道。⚠️ 变异 M2a（只动 ②）第一次跑出 **5 pass**，是我**归因错了**——
    记在这里免得下次重犯。
  - **Windows 8.3 短名的坑（实测）**：本机 `tmpdir()` 给的是**短名**（`ADMINI~1`），而应用把目录解析成
    **长名**（`Administrator`）——同一个目录，直接比字符串会**假红**。故断言前先 `realpathSync.native`
    再归一。`anchor-workspace.test.ts` 没撞上是因为它的沙箱目录**从未被创建**，应用不会去 realpath。
  - **⚠️ 未覆盖（缺口，不是覆盖）**：与 T012 同三条（T009 的两条读路径 / T010 端到端 429 / 长连接），
    见 `state.md` 缺口表；另：本文件只覆盖**读**路径（`read` / `list`），**写**路径的跨目录穿越未单独测
    （配额那道门由 T011 覆盖，但「A 写进 B 的沙箱」这一条本身没测）。
  - **质量门禁（2026-09-30 实跑，非外推）**：见 T012 末行（两文件合跑 **9 pass / 0 fail / 33 expect**，
    本文件单独跑 **5 pass / 13 expect**）。

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

- [x] **T014 实现网关（Auth 服务的 HTTP 面）**：登录 HTTP 端点 + JWT 验签 + httpOnly Cookie 下发 +
  注入 `X-User-ID` + **透传会话 JWT** + 错误呈现。[无依赖，但**是 T015 的前置**]
  > ⏭ 原文写「是 T015/T016 的前置」——**T016 已于 2026-10-01 整条移交 F10**（见 T016 段），
  > 这里随之更正。它将来在 F10 落地时**仍然**依赖本 task 的产物，只是不再计入 003。
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
    真链路端到端验收在 T014 之后——**它已随 T016 一并移交 F10**（2026-10-01，见 T016 段）。
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
  - ✅ **完成 2026-09-30**。产品码 = **1 个新文件 + 3 处改动**（零 schema 变更）：
    - **新增** `packages/opencode/src/server/openhive/gateway.ts`（网关本体：`layer` 剥头覆盖注入、
      `routes` 两个端点、启动期密钥地板）；
    - **新增** `packages/auth/src/test-support.ts`（真库夹具，从 `production-driver.test.ts` 抽出——
      T014 的测试落在 `packages/opencode/`，而 `@electric-sql/pglite` 是**本包**的 devDependency，
      共用一份夹具才不会两处各写一份、早晚漂）；
    - **改** `httpapi/server.ts`（接线两处：`AuthGateway.routes` 并进 `Layer.mergeAll`；
      `AuthGateway.layer` 排进 provide 数组的**身份门之前**——**次序即语义**，剥离注入测试守着它）；
    - **改** `httpapi/middleware/user-identity.ts` + `server/user-identity.ts`
      （放行规则第 5 条：网关登录/登出路径豁免；`cookieValue` 提为导出，两处读同一个 Cookie 只留一份实现）。
  - ✅ **三项硬要求怎么落的**：
    ① **剥离 + 覆盖注入**在 `AuthGateway.layer`：先 `Headers.remove` 再按验签结果 `Headers.set`；
    **验不过就保持「没有这个头」**，不是回落到客户端自己填的那个。
    ② **端口仅网关可达**是**部署项，本 task 没做**，落 `deploy-todo.md` **D-02**。
    ③ **透传会话 JWT**：Cookie 天然随请求流动，**不加新头**——网关验它并按 subject 覆盖注入 userId，
    内核那道门再验一次**同一张 Cookie**。**两次验签是深度防御，不是冗余**：网关这层被绕过
    （或有人直连内核端口）时门仍拦得住；那时「头与凭证不一致」正说明**网关与内核之间被改写**。
  - ✅ **登录契约**（Q1 裁定【甲】）：`POST /openhive/auth/login` → 200
    `{id, policeNo, name, isAdmin, mustChangePw}` + `Set-Cookie: openhive_session=<JWT>; HttpOnly;
    SameSite=Lax; Path=/; Max-Age=7200`；**四种失败原因同一个 401、同一句话、都不下发 Cookie**
    （分辨得出「账号存不存在」等于白送一个账号枚举接口）；`POST /openhive/auth/logout` →
    204 + 同一 Cookie 以 `Max-Age=0` 覆盖。
  - ✅ **启动检查跟开关走**（Q3 裁定【甲】）：`OPENHIVE_REQUIRE_USER_ID` 未设 ⇒ 网关层是恒等中间件、
    **一个端点都不注册**、也**不去要 PG 配置与密钥**（`bun run dev` 行为逐字不变）；
    置 `1` ⇒ 层构造期调 `jwtSecret`，缺 / 短于 32 字符**当场起不来**（上面 🔑 那条要的「启动时调一次」）。
  - 🔴 **未覆盖（缺口，不是覆盖）**：`AUTH_JWT_SECRET` 的**轮转**（代码侧无机制，是部署纪律）、
    Cookie `Secure` 在真 HTTPS 下的行为、内核端口的**真实网络可达性**（D-02，本机 win32 单进程验不了）。
  - ⚠️ 测试夹具的两条硬约束（**实测撞出来后才写下的**，详见 `test-support.ts` 文件头）：
    ① `PGLiteSocketServer` 的 `maxConnections` **默认 1，超出是掐掉不是排队**，而 `bun-sql`
    每个客户端自带连接池；② **同一实例上两个客户端不能执行同一句 SQL**（PGlite 预编译语句实例级、
    bun-sql 缓存按客户端 ⇒ `42P05`）。**真 PG 按会话隔离，故不是产品缺陷**——落地要求是
    「一次夹具只起一个被测客户端」（生产本来也是一个进程、一个连接池）。

### 随网关一并做的呈现层

- [x] **T015 登录页 + 强制改密弹窗**（002 的 T010 / T012，`[FE·新增]`）[依赖 T014]
  [出参：登录失败统一提示「账号或密码错误」；`must_change_pw` 命中时全屏遮罩锁死]
  - 服务层半边 002 已交（`login()` 对四种失败原因抛同一个 `InvalidCredentialsError` + 同一句消息；
    成功时透出 `mustChangePw`）。**缺的是「把它显示出来」**。
  - ✅ **落点已定**（2026-09-30）：`packages/app/src/auth/`（四个文件：`gateway.ts` 纯 HTTP 形状、
    `auth-gate.tsx` 分岔 + 接线缝、`login-page.tsx`、`change-password.tsx`）；
    在 `app.tsx` 里包在 `<ServerProvider>` 内、`<GlobalProvider>` 外——
    未登录时连落盘查询都不建；刻意**不进** `ConnectionGate`（那道门要先健康检查）。
  - ✅ **接线缝已接**：`setCurrentUser` 由 `AuthGate` 的一个 `createEffect` 驱动
    （已登录喂身份、其余情况喂 `undefined`）。**002 实测的「零生产调用者」到此闭合**。
  - ✅ **完成 2026-09-30**。三段：
    - **T015-a 网关端点**（`packages/opencode/src/server/openhive/gateway.ts` 增 `GET /me`、
      `POST /change-password`）：**T014 留的那个洞补上了**——T014 只有登录/登出，
      而「已登录」与「该不该强制改密」这两件前端启动时就要知道的事，当时**没有端点可问**。
    - **T015-b 身份门放行外壳**：`packages/opencode/src/server/openhive/ui-shell.ts`（新增）
      + 身份门放行规则。放行**正向白名单**（不是「除了 API 都放」）——
      否则以后新增一个后端路径会**默认变成公开的**。
    - **T015-c 前端**：`packages/app/src/auth/` 四文件 + `app.tsx` 接线（见上面「落点已定」）。
  - ✅ **两个新目录的口径已同步**：「`auth` 目录」加进了**同口径的两处**
    （`package.json` 的 `lint:openhive` 扫描范围、`design-token-refs.test.ts` 的 `自有目录`）
    ＋ `openhive-module-dirs.test.ts` 的骨架不变量。**三处的计数文字一并去掉了数字**——
    「四个目录」这种写法在这个 feature 里已经过期两次。
  - ✅ **dev 下的同源问题以 Vite 代理解决**（`packages/app/vite.config.ts`）：
    `auth/` 发的是**同源相对路径**（登录/改密靠 `credentials: "same-origin"` 才会带上 Cookie），
    故 `/openhive` 前缀在 dev 必须转给内核。代理的地址**与 `entry.tsx` 解析内核地址共用同一对
    环境变量与同一个兜底**（`VITE_OPENCODE_SERVER_HOST/PORT`，兜底 `localhost:4096`）——
    只改一处会让「数据面到了内核、登录到不了」，且**不报错，只是永远登不进去**。
  - ✅ **门禁实测（2026-09-30）**：`bun run typecheck` **31/31 successful**；
    `packages/app` `test:unit` **812 pass / 0 fail**、`test:components` **194 pass / 0 fail**；
    `packages/ui` `brand-paint.test.ts` **18 pass / 0 fail**；
    `packages/opencode` 三个 T015 测试文件 **41 pass / 0 fail**；
    `packages/auth` **149 pass / 1 skip / 0 fail**；
    `bun run lint:openhive` **23 warnings / 0 errors**，其中**本次新增目录 0 命中**
    （23 与本 feature 之前的基线**同数**）；`bunx oxlint` 三个改动源码目录 **0/0**；
    `git diff --stat bun.lock` **为空**。
  - 🔴 **未覆盖（缺口，不是覆盖）**——七条，全部落进 `state.md` 的缺口表：
    ① DESIGN §6.1 的**六边形网格纹理**没做（本环境无法目视验证几何，宁缺勿滥，只做了金色光晕）；
    ② **登出入口**（`POST /logout` T014 已有端点，但前端没有触发它的入口）；
    ③ 改密遮罩**没有焦点陷阱**（自己起 overlay 的代价，见 `change-password.tsx` 文件头）；
    ④ **dev 下数据面仍直连 `:4096`**（`entry.tsx` 的 `getCurrentUrl()`），跨源 fetch 默认
    `credentials: "same-origin"` ⇒ 会话 Cookie **不随数据请求发出**；T015 只保证登录/改密
    这三条自身可用（同源相对路径 + 上面的代理），**把它登记成缺口而不是含糊过去**；
    ⑤ `AuthGate` **不是安全边界**（前端门谁都能跳过，真正的门禁在内核身份门 + 网关验签）；
    ⑥ 会话中途过期时 `change-password` 的 401 只给一句通用失败提示，**不把人踢回登录页**；
    ⑦ **没有凭证吊销机制**——**停用账号的旧凭证在内核那道门仍然有效**（签发时带 2 小时 TTL，
    内核只看签名、不看账号状态）。`packages/auth/src/session.ts` 的会话自查把停用的人挡在**界面**外，
    但那是界面门禁不是撤销；「停用即立即失效」要一张**凭证吊销表**，**本 feature 没做**。
    （`session.ts` 的文件头原先写「已记在 tasks.md 的未覆盖项里」——**当时 tasks.md 并没有这一条**，
    是这次 grep 出来的悬空引用，现在补上，两边对得住了。）

### 🔴 P0：越权 BOLA / BFLA

- [ ] **T016 越权测试：跨身份访问被拒**（P0）[依赖 T014] ⏭ **已移交 F10**（2026-10-01）
  [出参（**原样保留，但不再由本 feature 交付**）：普通民警凭证调管理员能力
  （重置他人密码 / 停用他人账号 / 录入账号）**被拒**，且正向放行]
  - ⏭ **移交裁定（2026-10-01 · 用户选定【甲】）**：本 task **在 003 边界内无对象可测**，
    整条移交 **F10 治理后台**。落点 = `010-governance-console/tasks.md` 的 **T015**，
    且该文件的 Prerequisites 已同步（**不只写在自己文档里**——`LEARNINGS #002-04`）。
    **勾选框保持 `[ ]`：它没被做，只是换了归属。**
    - **实测依据**（Explore 穷举 `packages/opencode/src/server/**` 的 `router.add`、
      `packages/auth/src` 全部导出、`packages/app/src` 全部调用点）：三条「管理员能力」
      在**服务层都在**（`resetPassword` / `disableAccounts` / `restoreAccount` /
      `registerUser`），但**零 HTTP 端点**——系统唯一的认证面是 `AuthGateway` 的四条路径
      （login / logout / me / change-password），全是自助。
      而 `isAdmin` **全仓库没有任何一处在服务端做授权判断**，只被回传给前端供过滤显示
      （`packages/app/src/topbar/menu.ts` 的 `adminOnly`），且那个菜单项在
      `workspace-entry.tsx` 里**连 `onSelect` 都没传**，点了没反应。
    - **归属**：端点的家是 F10 的 **T005**（账号管理：录入 / 重置 / 停用），授权门的家是
      F10 的 **T003**（管理员分权 + RBAC），而 F10 自己的 **T014**「两类管理员分权，
      互不越界」就是 F10 版本的 T016。
    - **为什么不原地造端点（否掉【丙】）**：那要跑到 **F4** 定义的 RBAC 模型前面
      （F10 的 Prerequisites 明写需要「F4 RBAC/审计已落地」，而 F4 **尚未开工**）
      ⇒ 授权结构会被草率定型、F4/F10 到时要推翻重做；也超出「最小改上游」的红线
      （`宪法 §I`）。
    - **为什么不改服务层签名（否掉【乙】）**：那要**推翻 002 收尾时你选的路线 A**。
      路线 A 之所以看着失效，只是因为它写着「等网关落地后再在 HTTP 层写」而端点还没生出来——
      **端点一旦存在它就成立**，没必要为一个暂时性缺口改掉一个仍然正确的边界划分。
  - ✅ **BOLA 那半边已经做完了，别重复**——它的对象**今天存在**，且已被真跑的测试守着
    （按**测试名**引用，不写行号——`LEARNINGS #002-06`）：
    - `test/server/openhive-gateway.test.ts`「身份只从会话取：请求体里塞一个**别人的**
      userId 不生效，改的仍是自己的密码」：双身份（`withAccounts`），**两半都断**
      （甲改成了 + 乙没被动到）；
    - `test/server/user-identity.test.ts`：伪造头与验签主体不一致即拒（fail-closed）；
    - `test/server/anchor-workspace.test.ts` / `tenant-db-isolation.test.ts` /
      `tenant-directory-isolation.test.ts`：跨身份拿不到对方的目录与库。
    再写一遍就是 `LEARNINGS #002-02` 说的**假绿**（没执行被测路径却记成覆盖）。
  - 🔎 **移交后仍留在 003 的两条同源风险**（**不随移交走**）：
    ① **没有任何服务端授权分支** ⇒ 将来谁在网关里加了管理员路由却忘了加 `isAdmin` 判断，
    就直接开出一个无授权的管理员接口——**这正是 F10 T015 要拦的那一格**；
    ② `X-User-ID` 在 **F7/F8 的「MCP → 业务 PG RLS」**链路上**仍在传身份**（见本文件 T014 段
    的「已知的下游同型问题」），那半边要 F7/F8 开工时照 T014 同样裁定。
  - **为什么 002 没做**（**背景，不再是本 task 的待办**）：002 是纯服务层，
    `resetPassword(db, userId)` / `changePassword` /
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

- [x] **T017 `last_active_at` 的写入方**（002 评审移交）[依赖 T014] ✅ **2026-10-01 落地**
  [出参：带上有效会话凭证的请求经过网关后，`auth.user.last_active_at` 被刷成当前时刻；
  距上次记录不足节流窗口（默认 60 秒）的请求**不写**；认不出凭证的请求**一行都不碰**。]
  - ✅ **落点**：`AuthGateway.layer` 里那层**全局中间件**（`server.ts` 把 `AuthGateway.layer` 装进
    `Layer.provide` 数组，装在**合并路由树**之上）——所以「每个请求」是字面成立的，不是近似。
    **没有新增装配点**，只在那段中间件里加了一步。
  - ✅ **领域逻辑与接线分开**（照 T014/T019 的分法）：
    `packages/auth/src/activity.ts` 的 `touchActivity` **只做领域判断**——不读环境变量、不连库，
    `now` 与 `throttleSeconds` 都从参数进来（时间从外面进，模块里才没有第二个时钟）。
    窗口值的解析在 `packages/auth/src/policy.ts` 的 `activityThrottleSeconds(env)`，
    接线在 `gateway.ts`。**照 `router.ts` 的 `dataRoot(env)` 先例读 env 记录、不直读 `process.env`**，
    调用方与测试才都能注入。
  - ✅ **两条 2026-10-01 用户裁定**（原先是「未定」项，已问过）：
    ① **带条件节流，默认 60 秒**——不节流的话这一条 UPDATE 会成为全系统最高频的写
    （客户端是**轮询**的：`/session`、事件流），而 60 秒的滞后对唯一的消费者（90 天未活跃）
    没有任何意义；窗口可用 `OPENHIVE_ACTIVITY_THROTTLE_SECONDS` 覆盖。
    ② **写失败吞掉、照常放行**——记活动是**非关键路径**，不该把业务请求带下水。
    实现上落在 `gateway.ts` 的 `recordActivity`：`Effect.catch` → `Effect.logWarning`。
    **记录警告是有意的**：吞掉 ≠ 假装它没发生，PG 长时间不可用时要能从日志看出来。
  - ✅ **判据全在那一条 UPDATE 的 `where` 里**（不在 TypeScript 这侧）：先查再写会多一次往返，
    且两次之间有窗口。两个容易写错的点各有一条用例钉着：
    ① **`is null` 那一支不能少**——这一列的存量值**全是 NULL**，而 `NULL <= n` 在 SQL 里是 NULL
    （不为真）⇒ 少了它，所有从没被记过的账号永远刷不上，**恰是要修的那批**；
    ② **边界取「≥ 窗口」**（恰好一个窗口时**写**）。
  - ✅ **只有认得出来的人才刷**——认不出就不写。否则伪造的 Cookie 也能写别人的活跃时间，
    那是把「谁在线」这条运维信号交给外人来写。两半都有用例。
  - ✅ **解析失败**当场抛（`activityThrottleSeconds`），不静默退回默认值：
    `NaN` 会一路变成 `last_active_at <= NaN`，那个比较在 SQL 里恒不为真 ⇒ **这一列再也不更新**，
    而全系统没有一处会红。调用点在**层构造期**，所以抛 = 进程起不来 = 看得见的失败。
  - **证据**（按**测试名**引用，不写行号——`LEARNINGS #002-06`）：
    `packages/auth/src/activity.test.ts` 六条（从没记过(NULL)⇒写上 / 窗口内不写 /
    窗口外写 / 距今正好一个窗口⇒写 / 只碰自己那一行 / 账号不存在⇒安静返回）；
    `packages/auth/src/policy.test.ts` 的「活跃节流窗口走配置」三条（默认值 / 配了就用配的 /
    不是正整数就抛）；`packages/opencode/test/server/openhive-activity.test.ts` 五条
    （带凭证⇒刷上 / 认不出⇒一行都不碰 / 窗口值从配置进来：大窗口不覆盖旧值、
    小窗口覆盖同一旧值 / 库连不上⇒失败被吞掉、请求照常 204）。
  - ⚠️ **残留缺口，别当已覆盖**（`LEARNINGS #002-02`）：
    ① **真实时钟下的节流**本机没有用例——窗口判据由 `activity.test.ts` 那组钉着
    （靠把行摆到一个**确定的过去时刻**，用例里没有 sleep），wire 那一组只钉「配置值进没进来」；
    ② **多进程同时刷同一行**——单进程夹具起不了两个实例（同 T019 缺口②）。
  - ⚠️ **写这个 task 时踩到的坑，留给下一个人**（`LEARNINGS #002-02` 那类假绿）：
    网关读窗口用的是 **`process.env`**，第一版 wire 测试却拿 `ConfigProvider` 塞值——
    **被无声忽略**。症状是「大窗口」那条**照样绿**（默认 60 秒在这个时间尺度上给出同一结果），
    是它的对照组「小窗口」把它揪出来的。**塞环境变量要过 `restorePoint`**（同 T019 的
    `OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO`）。
  - ⚠️ **明说的代价：一个进程里有两条连接池**。`layer` 里的连接持有器与 `routes` 里那份
    **同名同形但不能合并**——两处是各自层构造期的闭包；提到模块级会让同一进程里多个
    `app()` 共用一个已关掉的连接（**测试直接失真**），改成 Effect 服务则改动面更大（`宪法 §I`）。
    两边都是惰性建、建一次就留着——按请求建 = 按请求泄漏（plan.md 风险点 R2）。
  - **为什么是 `Promise<void>` 而不是「写没写成」**：两种 PG 驱动对 UPDATE 结果的形状不一致
    （`LEARNINGS #002-01`），为一个断言便利去碰它不划算；想知道有没有写上，去读那一行。
- [x] **T018 沙箱目录的归档 / 恢复 / 删除**：[依赖 T014] 002 只交了账号侧半边
  （`deactivated_at` 列 + `restoreAccount` + 逾期清单筛选）。文件系统部分在 002 时
  「没有可作用的对象」（沙箱还只是空目录），网关落地后才有真实研判产物。
  ✅ **2026-10-01 落地**（**领域三件套已交付；「谁在什么时候调」挂账**，见下方缺口④）
  - ✅ **先跑「出参可达吗」（2026-10-01 探针，本题第一件事）**——结论是**两半分明**，
    这决定了本 task 的边界，所以记在最前面：
    - **领域三件套 ⇒ 可达**。输入是 `(root, userId)`，不依赖任何尚未落地的东西。
    - **触发者 ⇒ 打不到**。① `zombie.ts` 的 `findArchivableAccounts`（002 交的逾期筛选）
      **除测试外无任何生产调用方**；② 全仓**没有调度基础设施**（`cron` / `setInterval` 的
      命中全在 `heap.ts` / `ws-pool.ts` / `flock.ts`，与定时无关）；③ **没有归档端点**。
      与 T017 那堵墙同型（`#002-04` 的 D-05 亦是）：**没有那个「谁」**。
    - 顺带确认：[依赖 T014] 这条**实际不咬合**——三件套全是纯文件系统动作，网关在不在都不影响；
      真正缺的是**运行者**，不是网关。计划里的依赖关系在这里输给了探针（照实记）。
  - ✅ **三项裁定（2026-10-01，你拍的）**：
    ① **只做领域三件套，触发者挂账**——不硬造调度器、不加端点；
    ② **归档形态 = 同卷 `rename` 到 `{root}/.archived/{userId}/`**（不是复制、不是打包）；
    ③ **恢复时目标位置已有东西 ⇒ 拒绝、抛错**（不自动合并）。
  - ✅ **落点**：`packages/auth/src/sandbox-archive.ts`（新建，导出 `ARCHIVED_DIRNAME` /
    `archiveSandbox` / `restoreSandbox` / `deleteSandbox`）+ 同名测试（15 条）；
    **唯一改动已有文件**：`packages/auth/src/workspace.ts` 抽出 `assertSafeUserId(userId, acting)`，
    让 `createWorkspace` 与三个新动作**共用同一份判据**（`isolation-scheme.md` §3 的要求）。
    `createWorkspace` 对外的错误消息**逐字节未变**（`非法用户 id，拒绝建沙箱目录：…`），
    改动前已 grep 确认没有测试钉住它的其它形态。
  - ✅ **三个动作共用校验，不是各抄一份**：销毁性动作比建目录危险得多（`../victim` 会让「删除」
    删到沙箱根外面），而**抄一份判据就会漂**（两处分头演化、改一处漏一处）。
    `acting` 只进错误信息，让三个调用点各自说清「拒绝的是什么动作」。
  - ✅ **「删除只够得到归档区」是代码属性，不是调用约定**：`deleteSandbox` 的活动目录那一侧
    **根本没有参数能指过去**（要删活得先归档）。002 拒绝自动删空目录的原话是「宁可留一个空目录
    也不冒误删的风险」，这里让它在**签名层面**成立。
  - ✅ **变异检验：五支，全部被杀**（每支都记录「杀死了哪几条」，`LEARNINGS #002-02`）：
    | 变异 | 结果 |
    |---|---|
    | M1 删 `archiveSandbox` 的冲突检查 | 1 红（「冲突是自己判出来的」）—— ⚠️ **加强前它是 14/14 全绿**，见下 |
    | M2 删 `restoreSandbox` 的冲突检查 | 1 红（「恢复 > 活动位置已经有东西」），收到的正是裸 `EPERM` |
    | M3 `deleteSandbox` 改删活动目录 | 3 红（删除那三条全中） |
    | M4 删三个 `assertSafeUserId` | 2 红（校验那两条） |
    | M5 删 `archiveSandbox` 的「没沙箱就返回」 | 2 红（从没建过 + 幂等，两者走同一条早返回） |
  - ⚠️ **M1 暴露了一条假绿测试（本 task 最值得留的教训）**：第一版冲突用例只断言「抛了错」
    ——**删掉那行检查它照样绿**，因为 `rename` 自己也会抛。实测探针（win32）：
    `rename` 撞**非空**目录与**空**目录**都**报 `EPERM` ⇒ 行为断言在本机**分不出**
    「我们自己判的」与「文件系统碰巧报的」。而它在 **Linux（CI 与生产）上不等价**：
    `rename` 撞**空**目录会**静默成功并替换**——正是 FR-010 要防的那种静默丢失。
    ⇒ 判据改为**钉错误消息**（含「冲突」），重跑 M1 才正确地红 1 条。
    **这条是靠变异检验发现的，不是靠评审。**
  - ⚠️ **残留缺口，别当已覆盖**（`LEARNINGS #002-02`）：
    ① **跨卷 `rename`（`EXDEV`）**——归档区与活动目录同在 `{root}` 下，本机构造不出跨卷；
    ② **`rename` 的原子性没有用例**——由 OS 保证，但**没有测试验到它**，被中途打断的归档
    只在纸面上安全；
    ③ **归档物不受磁盘配额约束**：`disk-quota.ts` 的 `sandboxOf` 按路径首段认沙箱
    （`{root}/.archived/...` 会被认成名叫 `.archived` 的「沙箱」），而归档走 `rename`、
    **不经过写漏斗**（`FSUtil.writeWithDirs`）⇒ 配额根本看不到它。可接受（它已不被写入）但要**知道**；
    ④ **触发者在 003 边界内打不到**（没有「谁」）——按你的裁定**不硬造**，改为**挂账**：
    落点 = `docs/workspace/deploy-todo.md` 的 **D-06**（所以它**不是「没有接收方」**，
    而是「有接收方、待部署侧开工」）。
    ⚠️ **不得**写成「FR-010 已闭合」：本 feature 交付的是**能归档**，不是**会自动归档**。
  - **顺带修的一处门禁命中**：新测试里 `(error as Error).message` 撞 `no-unsafe-type-assertion`。
    改用 `messageOf(thrown)` 做 **`instanceof` 收窄**而不是 `as`——这里恰恰**在验证**它是不是
    `Error`，用断言等于把待验证的东西预先当成已知（`expect().toBeInstanceOf` 在 bun 里不收窄类型，
    所以必须有个显式的收窄点）。
  - **门禁（2026-10-01 实测，非外推）**：`packages/auth` 全量 **179 pass / 1 skip / 0 fail**
    （T017 收工时 164，164 + 15 = 179 对得上）；`bunx tsgo --noEmit` 在 `packages/auth` 与
    `packages/opencode` **均 exit 0**；oxlint 三个改动文件 **0 warnings / 0 errors**；
    `git diff --stat bun.lock` **为空**。

### 002 收尾评审未修项（2026-09-29 落表）

002 的收尾评审报 3 Critical + 10 Important + 16 Minor。Critical 与低争议 Important 已在 002 内
修完（commit `c0c342421a`）；下列 6 条经用户裁定**移交本 feature**。

**与上面 T014–T018 的关键区别：这 6 条不依赖网关**，没有 T014 这个前置，现在就能做。

- [x] **T019 引导首个管理员**（002 评审 I1）[无依赖] ✅ **2026-10-01 落地**
  [出参：`OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO` 指定的账号，在 `auth.user` 里**一个
  `is_admin = 1` 的行都没有**时被置为管理员；表里已有管理员时该变量**完全无效**（不是"再置一个"）。
  引导是**一次性**的——跑通后即可从环境里撤掉该变量。]
  - ✅ **落点（用户选定【甲】）**：`AuthGateway.layer` 的**层构造期**。生产那条路是
    `server.ts` 的 `Layer.buildWithMemoMap`——**构建一次**，所以「只在启动时判一次」是字面成立的，
    不是近似。装配点没有新增：`AuthGateway.layer` 本来就在 `createRoutes` 的中间件数组里。
  - ✅ **引导排在迁移之后**：设了该变量时先 `migrate()` 再 `bootstrapAdmin()`。
    两者都落在 `gateway.ts` 的 `bootstrap()` 里。**这个次序有测试钉着**——
    `openhive-bootstrap.test.ts`「开关设了 ⇒ 启动时跑一遍，且排在迁移之后」那条**刻意不预先建表**，
    次序若反了会当场报 42P01。
  - ✅ **判据是表级的**：「`auth.user` 里一个 `is_admin = 1` 的行都没有」——不是「这个警号不是管理员」。
    后者会让「把某警号提权」变成能反复用的常开开关（T019 明令不许）。
  - ✅ **开关只看 `OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO`，不看 `OPENHIVE_REQUIRE_USER_ID`**
    （该调用排在后者早退**之前**）。理由：若两个开关都要，部署方只设了引导变量时会得到
    **静默的空操作**——系统照样在「一个管理员都没有」的状态下起来，正是 T019 要防的那件事。
  - ✅ **账号不存在时建出来**（用户选定）：`name` 用**警号本身**，`idCard`/`phone`/`org`/`dept`/
    `section` 留**空串**（不编造身份数据——公安库里这两列是明文、是研判对象），`status = 1`，
    `must_change_pw = 1`（默认口令是公开的，必须强制改）。
  - **证据**（按**测试名**引用，不写行号——`LEARNINGS #002-06`）：
    `packages/auth/src/bootstrap.test.ts` 六条（建的/提的/跳过的 × 行数与 id / 不碰别人的行 /
    建出来的能登进去且要求改密）；`packages/opencode/test/server/openhive-bootstrap.test.ts` 三条
    （开关没设不碰库 / 开关设了且排在迁移之后 / 库连不上时不静默跳过）。
  - ⚠️ **残留缺口，别当已覆盖**（`LEARNINGS #002-02`）：
    ① **撤掉该变量后，没有任何东西会把新迁移应用到生产库**——`packages/auth` 的 `migrate()`
    在生产里**只有这一个调用点**，而它随引导变量一起消失。见 `state.md` 缺口表；
    ② 多实例**并发引导**的 TOCTOU（后到者撞 UNIQUE、当场起不来，重启即自愈）——单进程夹具起不了两个实例；
    ③ 「引导失败 ⇒ **进程退出**」这条语义本机验不到，夹具里只表现为一次请求失败；
    ④ 被提权的账号若 `status = 0`，它**登不进去**、系统仍锁死，而引导会报 `promoted`。
  - **为什么必须有**：002 全仓库**没有任何产生管理员的路径**（实测：`registerUser` 恒写
    `isAdmin: 0`）。而**治理后台（F10）**的全部能力（录入 / 重置 / 停用）都要求 `is_admin`——
    没有第一个管理员，就没有第二个，**系统第一天就锁死**。
    > ✏️ **措辞更正（2026-10-01）**：原文写的是「**003** 治理后台」，**是错的**——
    > 治理后台归 **F10**（本 feature `spec.md` 的 Assumptions 与
    > `010-governance-console/` 的 T003/T005 都这么说）。T019 本身仍**留在 003**：
    > 它是**服务层不变量**（首个管理员的引导），不依赖 HTTP 端点，与 T016 的移交无关。
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
> **T014 是 T015 / T018 的硬前置**——三者**现在都已落地**（T014 / T015 于 2026-09-30、
> T017 / T018 于 2026-10-01），所以这条依赖**不再卡任何待办**；
> T019–T024 **不依赖 T014**，可并行开工。
> （原文把 T015 列得像待办，那是**更早一次编辑留下的**——`LEARNINGS #002-06` 说的正是这类
> 悄悄失效的记述：改了一处，没 grep 谁还在按旧状态描述它。）
> ⏭ **T016 已于 2026-10-01 整条移交 F10**（在 003 边界内无对象可测，理由见 T016 段）；
> 它在 F10 那侧**仍**是本 task 的下游，只是**不再计入 003 的交付**。
> 于是上面那 24 条的账要这么读：**003 的账是 23 条**（T016 除外，它改为 F10 的 T015）。
> ⚠️ **别把「账」读成「已交付」**——23 条里**已勾选 18 条、未勾选 5 条**
> （T020 / T021 / T022 / T023 / T024）。
> 数法：`grep -cE '^- \[x\]'` 与 `grep -cE '^- \[ \]'`，两个数相加应 = 24（含已移交的 T016）；
> 上面「未勾选 5 条」= `grep` 出来的 **6** 条减 1（T016 已移交，不占 003 的账）。
> ⚠️ 这些数字**都随移交与拆分而变**（`LEARNINGS #002-06`、`#001-02`），
> 别照抄，**跑上面的命令重算**。
