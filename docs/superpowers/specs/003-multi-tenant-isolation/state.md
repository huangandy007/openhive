# 实施进度 · 多用户隔离

## 当前任务
⏸️ **卡在 T004 的落点裁定上**（见下「T004 前置实测」）。三条路各有代价，需要你拍板，我没有自行选。
（T003 已完成；其余候选：T006 沙箱锚定 / T019–T024 002 评审移交。未裁定的还有任务书 Step 0.5 的 D2–D6。）

## 已完成
- **T001**（2026-09-30）· 定位 `database.ts` 单例现状 + 可仿模式清单 → 产出 `refactor-targets.md`。
  要点见下「T001 结论」，**含一条影响 T004 落点的结构性发现**。
- **T002**（2026-09-30）· 目录挂载 + 受限用户权限方案 → 产出 `isolation-scheme.md`。
  要点见下「T002 结论」，**含一条阻断 T007 的未裁定问题**（已由 §5 裁定乙解锁）。
- **T003**（2026-09-30）· 验签门落地（取代 002 的「读头即放行」）。要点见下「T003 结论」，
  **含一处对 plan「模式 A」的有意偏离**（`LayerNode.unbound` → `Context.Service`，已 grep 全部引用点同步）。

## 阻塞项
（无——§5 已于 2026-09-30 裁定为**乙**，T007 解锁）

### ⚠️ 顺带上报：宪法 §III 的措辞可能仍需一次修订（**未动宪法**）
宪法 §III 原文：「用户间数据隔离 MUST 靠 **OS 文件权限 + 每用户独立 db** 实现；
MUST NOT 仅靠应用层 `if` 判断过滤。」
- **我的读法（已写进 `plan.md` 的 Constitution Check）**：裁定乙下 §III **仍成立**——
  独立 db 那半边是真正的物理隔离（连接级分离），所以不构成「**仅**靠应用层」。
- **但**：措辞把「OS 文件权限」与「每用户独立 db」**并列**为 MUST 手段，
  一个较真的审计方可能读成「OS 文件权限必须承担用户间隔离」——那样乙就不合规。
- ⇒ **未擅自改宪法**：§六 治理明写「修改本宪法 MUST 经 PR + 书面理由 + 维护者审批」。
  **这是给你的一条待决项**，不是本 feature 擅自处理的事。宪法文件在外层工作区
  （`D:\project\study\openhive\.specify\memory\constitution.md`），不在本仓库。

## 已裁定的事项（feature 内）
- ✅ **§5 隔离模型（2026-09-30 定稿）：走【乙】· 降级为容器级**。
  单进程模型下「OS 层兜底」不成立（一容器 = 一进程 = 一 OS 主体）⇒ 用户间隔离由
  **每用户独立 db（真文件级物理隔离）+ 应用层锚定**承担；`0700` 降级为**容器外防护**。
  理由见 `isolation-scheme.md` §5.4；**丙（每用户一进程/容器）记为真正的答案 + 触发条件**
  （§5.5，**主要是合规评审触发，不是技术触发**）。
  **已同步 6 处**：`spec.md`（US2 引言 + 验收场景 2 + FR-006 + SC-003）、`plan.md`
  （数据流向图 + 工作空间轴 + R3）、`isolation-scheme.md` §5、`tasks.md` T002 段、
  `2026-09-06-openhive-design-v2.md`（§3 原则 3 + §5.2 + §14.4）、本文件。

- ✅ **2026-09-30 补两刀（同一类缺陷，grep 后一次清完）**：收尾核对时按 `LEARNINGS #002-06`
  「改完一处立刻 grep 谁引用了它」扫了 design-v2，发现两类**说过了头**的记述，已一并修正并加勘误块：
  1. **「应用层 bug 也拦得住」（§3 原则 3 / §5.2）**——**我自己上一轮的表述**。它把 `Map[userId]`
     说成「不存在忘了过滤这条路径」，实际上是**防住「过滤遗漏」、防不住「取错 key」**：
     取错时进程照样打得开别人的库，单进程下 OS 不拦。真正强的是身份**来自验签**。
  2. **「`X-User-ID` 是信任通道 / 只认它」（§3 原则 1 + 数据流 + 必改点 ① + §4.1 + §5.2）**——
     **2026-09-29 的【甲】裁定漏 sync 了 design-v2**（当次只同步了 5 处，见上）。
     `X-User-ID` 是明文头，作不了信任通道；甲下它**降级为路由提示**，验签发生在**内核**这一侧。
  > 教训写在这次的修正动作里：上一轮我把「五处必须同改」当成范围，**范围划小了就等于没扫**。

## T004 前置实测（2026-09-30 · 实测已做，**落点未裁定，卡在这里**）

T001 留了一句「T004 必须实测」。**测了**（探针用完即删，未入库；完整数据见 `refactor-targets.md` §3）：

| 测法 | 结果 |
|---|---|
| 静态：`hoist` 后的 `hoisted` 集合 | 18 个 global 被切出，**`@opencode/v2/storage/Database` 在列**；主树里 global 残留 = 0 |
| 静态：数 `Database` 引用点 | **7 处** |
| 运行时：替换层计数 + materialize 两个 location key | **每 key 建 8 次**；同 key 再取不重建（缓存有效） |

⇒ **`Database` 不是进程级单例**：随 location key 各建一份，且每个引用点各建一份。
⇒ ⚠️ **由此浮出一条会串库的坑**：路径**不能**由「当前请求的 `User`」决定——location 层按 key 缓存
（TTL 60 分钟），请求身份每次变，缓存里留下的是**第一个**用户解析出来的库。
路径必须由 **key（`Location.Ref`）** 派生，或把 userId **并进 key**。

**三条路（未定，需要你拍板）**：
| 方向 | 思路 | 代价 / 风险 |
|---|---|---|
| 甲 · 换掉 `Database.node` 指向 | 新增一个「按 location 上下文派生 db 路径」的层，作为 replacement 传入 | 零改上游文件；但路径只能由 **key** 派生（不能看请求身份），且需 T006 锚定「一个 location ↔ 一个用户」 |
| 乙 · `Database` 自持 `Map<userId, 连接>`（节点仍 global） | plan.md 原案 | 实测显示 `{db}` 句柄在 7 个引用点各有一份 ⇒ 要么改所有消费者取用方式（侵入大），要么做 drizzle 代理（脆弱） |
| 丙 · userId 并进 location map 的键 | 复用现成 LayerMap + TTL | 要动 `Location.Ref` 的语义（上游类型）⇒ 侵入面偏大 |

## T003 结论（2026-09-30 · 验签门已落地）

### 落点（两处新增 / 重写，**未改上游既有文件**）
- `packages/core/src/user.ts`（新）—— `User.Service` = `Context.Service`，`Info` = `{ id, policeNo, name, isAdmin }`。
  **放 core 不放在 `opencode/src/user/`**：T005 要 core 的 `Database` 读得到它（与 `Location` 同侧）。
- `packages/opencode/src/server/routes/instance/httpapi/middleware/user-identity.ts`（重写）——
  取代 002 的「读头即放行」：用 002 的 `verifyToken` 验 `AUTH_JWT_SECRET` 签的会话 Cookie，
  取 subject 为 `User`，`Effect.provideService` 填进请求上下文。
- `packages/opencode/src/server/user-identity.ts`（重写）—— `Config` 改为 `{ required, secret }`；
  `HEADER` 保留但**降级为路由提示**；`COOKIE_NAME` 复用 `packages/auth/src/policy.ts` 的常量（不写死名字）。
- `packages/opencode/test/server/user-identity.test.ts`（重写）—— 002 的 4 条**换成**验签语义（不是加）。

### 放行规则（四条刻意的选择）
1. **验不了就拒**：无凭证 / 签名不符 / 过期 / 换密钥签 / 密钥缺失 / 密钥短于 002 的地板 ⇒ 一律 401。
2. **`X-User-ID` 只在「与验签结果矛盾」时拒**：**缺失不拒**（提示不是必要条件，拒了等于又把它当身份来源）；
   不一致拒（令牌说 A 头说 B，只有两种解释：链路被改写，或有人手工塞了头）。
3. **不制造「默认用户」或空身份**——拿不到身份就不放行，宁可 401 也不给下游一个假主体。
4. **公共 UI 资源豁免**（同 Basic Auth，上游 #25698 的 PWA manifest）；
   拒绝时**不发** `www-authenticate`（那是给浏览器弹 Basic 框用的，这里没有 Basic）。

### ⚠️ 与 plan 的有意偏离：**没用模式 A**（`LayerNode.unbound`）
`unbound`/`boundNode` 解决的是「**按 key 构造并缓存一棵服务树**」，且替换物**由 key 算出来**
（`Location` 有 `LayerMap` + `Layer.fresh` + TTL 才有意义）；而用户身份是**每请求验出的纯数据**——
没有要构造的东西、没有要缓存的树、没有「由 key 算替换物」。为它建层树 = 每请求重建一棵树。
「未填即失败」这层保证 `Context.Service` 照样给：编译期消费者把 `User.Service` 写进 `R`，
运行时兜底是 **401**（比抛异常更贴 T003 的验收口径）。
⇒ **模式 A 留给 T004/T005 的 `Database` 替换**，那才是真·按用户构造连接的地方。
**已同步**（**别记条数**——条数把「扫完了没有」偷换成「数够 N 条没有」，`LEARNINGS #002-06` 就是这么栽的）：
`tasks.md`（T003 段 + T014 段的落点文件名）、`refactor-targets.md`（§5 + §4 基线表）、
`plan.md`（Technical Context / 宪法对照 V / 文件结构 / 依赖表 / 集成点）、`state.md`（可仿模式表）、
`design-v2.md`（§5.2 步骤 1）。判据是 `grep`（`unbound` / `context.ts` / `src/user/`），不是这个列表。
> 手法照 `LEARNINGS #002-06`：**改完立刻 grep「谁引用了刚改掉的东西」**（`unbound` / `context.ts` / `src/user/`）。
> 这次 grep 出的第 5、6 处（`state.md` 的模式表、`tasks.md` T014 段的 `user/context.ts`）**是偏离发生后我才想到去扫的**
> ——先做代码、后扫文档，顺序颠倒；正确顺序是**决定偏离的那一刻就扫**。

### 质量门禁（2026-09-30 实跑，非外推）
| 门 | 命令 | 结果 |
|---|---|---|
| 单测 | `bun test test/server/user-identity.test.ts`（`packages/opencode`） | **17 pass / 0 fail**（18 expect） |
| typecheck | `bun run typecheck`（`opencode` / `core` / `auth` 三个包各跑一次） | 三个包**均无输出=干净** |
| lint | `bunx oxlint <本次改动的 4 个 .ts 文件>`（仓库根配置） | **0 warnings / 0 errors**（130 rules） |

**变异验证**（证伪「测试在守空气」）：三条关键行为各只有一条测试守着——
删「`X-User-ID` 不一致即拒」只红那一条；把密钥强度校验短路成 `return raw` 只红「短于 32 字符」；
去掉 `Effect.provideService(..., User.Service, user)` 只红「读到验签出来的 userId」。**每次改完即还原**。

### 踩到的 API 坑（值得记）
`UserIdentity.Config` 在**类型位置**指的是「键」（`ServiceClass`：`key` / `[ServiceTypeId]` / `Service`），
**没有** `required` / `secret`——那是 `yield* Config` 之后才拿到的值。取形状要走 Effect 官方的
`Context.Service.Shape<typeof Tag>`。走错时报的是 `Property 'secret' does not exist on type 'Config'`，
外加一条**连带的** `Type '{} | null' is not assignable to type 'string | undefined'`（不是独立缺陷）。

### 未覆盖 / 挂账（按 `LEARNINGS #002-02`：缺口要写成缺口，不写成覆盖）
- **真网关链路的端到端未测**——T014 之后才有，作为 T016 的前置。本 task 用 002 的 `signToken`
  **自造令牌**独立测（这是 task 设计如此，不是缺口）。
- **中间件类型参数暂未声明 `provides: User.Service`**——T003 没有消费者要求它；
  等 T004/T005 定了消费者形状再加，现在加是猜。
- **`OPENHIVE_REQUIRE_USER_ID` 仍默认关**（002 定的，T003 沿用）：网关还不存在，默认开 = 把
  app / desktop / CLI / 内置 web UI 全锁死在自己机器上。由 T014 上线时置 `1`。

## T002 结论（2026-09-30 · 基点 `21d0b61b52`）

### 能确定的部分
- **`/workspaces` 侧 002 已交**：`packages/auth/src/workspace.ts` 的
  `WORKSPACE_ROOT_ENV` / `workspaceRoot()` / `createWorkspace()`（含 `../` 穿越校验）——**不重造**。
- **`{userId}` = UUID**（`register.ts` 的 `crypto.randomUUID()`）⇒ 可直接作目录名。
- 目录布局：`/workspaces/{userId}/{project}/` + `/data/{userId}/opencode.db` + `/assets`（共享，独立于用户隔离）。
- 挂载：`/workspaces`、`/data` 持久卷，`/assets` 共享卷（资产服务 rw + opencode **ro**）。
- 本 task 新增 `OPENHIVE_DATA_ROOT`（照 `WORKSPACE_ROOT_ENV` 先例）——**落点在 T004，不在 `packages/auth`**。
- **`/data/{userId}/` 的创建时机 = T004 连接惰性打开处**（不是 002 的 `provisionUser`——
  历史账号没有该目录）。

### ⚠️ SQLite WAL 的坑（T004 / T007 的前置约束）
`database.ts` 层里设了 `PRAGMA journal_mode = WAL` → WAL 会在 db 文件**旁**生成 `-wal` / `-shm`。
⇒ **`/data/{userId}/` 目录本身必须对运行身份可写**。
「db 文件 0600 + 目录 0500」这种只读目录方案**会让 SQLite 直接打不开库**。

### ✅ 已裁定（乙）：单进程模型下「OS 层兜底」不成立
证据链：design-v2 §11.6 部署 = **一个 opencode 容器**（`/workspaces`、`/data` 是它的持久卷）；
§6 = **共享单进程**；**实测** `packages/core/src/cross-spawn-spawner.ts` 的 spawn 选项
= `cwd / env / stdio / detached / shell / windowsHide`，**无 `uid`/`gid`**；
上游 `packages/opencode/Dockerfile` **无 `USER` 指令**（以 root 跑，且只是 CLI 镜像）。

⇒ **一个进程 = 一个 OS 主体**：`/workspaces/{userId}/` 全属同一 uid，同一进程处理 A 与处理 B
看到的 uid 完全相同 ⇒ **`chmod 700` 对「用户 A vs 用户 B」零作用**。
⇒ `spec.md` 的 **FR-006 / US2 验收场景 2 / SC-003** 字面**无法成立**（不是配置问题，是模型问题）。

三个方向（见 `isolation-scheme.md` §5.3）：
| 方向 | 能真正 OS 隔离吗 | 代价 |
|---|---|---|
| 甲 · 逐用户 uid + 子进程 | **部分**（Bash 走子进程有效；Read/Write/Edit 进程内 fs 无效） | 1600 系统用户 + uid 映射；要动 `cross-spawn-spawner` = **深改 core**（撞 §I/§V） |
| 乙 · 降级为「容器级」 | 否 | 改 FR-006/US2-2/SC-003 措辞；§III 仍成立（独立 db 是真物理隔离） |
| 丙 · 每用户一进程/容器 | **是** | 把 §6.1 的「后手」提前到 P0，资源模型全变 |

**裁定结果：乙**（用户 2026-09-30）。理由见 `isolation-scheme.md` §5.4。
**丙记为真正的答案 + 触发条件**（`isolation-scheme.md` §5.5）——主要是**合规评审**触发，
不是技术触发。**T007 据此解锁**：`0700` 照做，但**不得宣称它承担用户间隔离**。

## T001 结论（2026-09-30 · 基点 `e788f9a9aa`）

### 单例现状
- 真身 = `packages/core/src/database/database.ts`（**不是** `packages/opencode/src/`）；
  同目录 `path.ts` 是 drizzle 列类型定义，**与 db 路由无关**（任务书提醒属实）。
- 「一个进程一个 db」的根源 = `path()` 在**模块导入时**求值一次；它依赖的 `Global.Path.data`
  同样在导入时算死。`node = makeGlobalNode({ service, layer: layerFromPath(path()), deps: [] })` 焊死结果。
- **实测**：`git log --author=huangandy -- packages/core/src/database/` **零条提交**；
  `database.ts` 最近改动全为上游 PR（最新 `472d0f376e`）。⇒ R1「我们从未碰过它」**成立**。
- **实测**：`grep -rn 'user_id' --include=sql.ts packages/core/src/` **零命中**；
  `session` 表只有 `project_id` + `session_project_idx`。⇒ **零表结构改动基线成立**。

### 可仿模式清单
| 模式 | 落点 | 本 feature 的用法 |
|---|---|---|
| A · `unbound` / `boundNode` | `packages/core/src/location.ts` + `effect/layer-node.ts` | T004 的 `Database` 按用户替换（**真·按 key 构造**）。⚠️ T003 原写的是用它，**落地时改判没用**——per-request 数据无树可缓存，见 `refactor-targets.md` §5 |
| B · `LayerMap` + `hoist` + `Layer.fresh` + `idleTimeToLive` | `packages/core/src/location-services.ts` | T004 的 per-user 连接树 + **R2 连接回收（现成的）** |
| C · `AppNodeBuilder.build(root, replacements)` | `packages/core/src/effect/app-node-builder.ts` | 挂在 `replacements` 上就无需改既有调用点 |
| D · env 常量先例 | `packages/auth/src/policy.ts` / `server/auth.ts` | 新增 env 常量的写法 |

- **`layerFromPath(filename)` 已是公开导出**——接受的任意文件名，内部含 5 个 PRAGMA + `wal_checkpoint` +
  `DatabaseMigration.apply`。⇒ per-user 连接**零改动复用**它，不必重写这段逻辑。

### ⚠️ 结构性发现（影响 T004 落点，**未裁定**）
`Database.node` 的 tag 是 **`global`**，消费者 9/10 是 global 节点
（`credential` / `event` / `permission/saved` / `project/copy` / `project/directories` /
`session/projector` / `session/runner/llm` / `session/store` / `session.ts`；只有 `session/todo` 是 location），
而 `locationServices` 组**不含**这些节点。
⇒ **把 `Database.node` 塞进 `locationServices` 的替换列表只能影响 1/10 的消费者**，
**不能照抄 Location 的替换点**。T004 落点三选一（见 `refactor-targets.md` §3），
**开工前未定则停下来问**（任务书 Step 0.5 规则）。

### 待实测（**不写进结论**）
`LayerNode.compile(location.hoisted)` 位于 `LayerMap.make` 的 per-key 回调内 →
按字面语义 global 节点会每 key 重建一次。若属实，`Database` 现状可能已「每 location 一个连接（同一文件）」，
**直接影响 R2 的评估**。⇒ T004 必须实测，本次**不据此下结论**。

## 开工前已裁定的事项
- ✅ **FR-002 的信任模型（2026-09-29 定稿）：走【甲】真做验签**。
  > 演变：002 收尾时曾裁【乙】「认链路不可达」，同日**推翻**改为【甲】。
  > 推翻理由：乙的成本论据（「要两段共享密钥的分发与轮转」）不成立——002 已把整套 JWT 基建
  > 交齐（`packages/auth/src/token.ts` 的 `signToken` / `verifyToken` / `jwtSecret` / `sessionCookie`，
  > 且 `verifyToken` 返回的 subject 就是 userId），**甲零新增密钥、零新增轮转**。
  > 后果不对称：乙失败 = 案件数据任意跨用户暴露；甲失败 = 攻击者仍拿不到密钥。

  **甲 = 三层保证，缺一不可**（乙那两条全部保留，验签是叠加不是替换）：
  ① 网关**剥离客户端传入的 `X-User-ID`** 后按会话凭证**强制覆盖**注入（是覆盖，不是拼接）；
  ② 内核端口**只对网关可达**（回环绑定 / 网络策略）；
  ③ 内核**验签后才认**——网关透传会话 JWT，内核用 `verifyToken` + `AUTH_JWT_SECRET` 验签，
     取 subject 为 userId，失败即拒（fail-closed）。

  ⚠️ **明文头 `X-User-ID` 保留但降级为路由提示**，MUST NOT 作为身份来源。

  同步改动：`spec.md`（FR-002 / 验收场景 3 / SC-003 / Assumptions）、`plan.md`
  （数据流向图 + 数据隔离说明 + 集成点）、`tasks.md`（T003 出参 + T014 裁定段）、
  `packages/opencode/src/server/user-identity.ts`（顶部注释）——**每处都必须同改，否则自相矛盾**。
  ⚠️ **勘误（2026-09-30）**：原文写的是「**五处**必须同改」。这个数字本身就是错的——当次同步
  **漏了 design-v2**（共 6 处），而「数几条」这种写法的毛病在于：它把「扫完了没有」偷换成
  「我数够 N 条了没有」，**范围划小了就等于没扫**。判据应当是**命令**（`grep` 出全部引用点），不是一个数。

  落地分工：**T014 管「注入 + 透传」，T003 管「验签后才认」**；T003 用自造令牌即可独立测，
  真链路端到端在 T014 之后。

## 最后更新
2026-09-30（**T004 前置实测已做，落点待你裁定**；T003 验签门已落地）
2026-09-30（**T003 验签门已落地**；T001/T002 完成；**§5 隔离模型已裁定为【乙】**。
FR-002 信任模型 2026-09-29 定稿为【甲】真做验签。
补①：design-v2 的两类过头记述已按 `LEARNINGS #002-06` grep 后清完——【甲】那次的同步范围划小了，漏了 design-v2。
补②：T003 落地时**改判不用模式 A**（`LayerNode.unbound` → `Context.Service`），已 grep 全部引用点并同步）
