# 实施进度 · 多用户隔离

## 当前任务
🔄 **T005 进行中**（2026-09-30 开工）——「db 查询按 User 上下文路由到对应连接」。
**探针已跑完**，结论见下「T005 探针结论」：**裁定「乙 · 取连接点路由」成立，落点不变**；
但「不碰 `packages/core` 上游文件」这条路被实测排除，**方案要碰 `sqlite.bun.ts` 约 5 行**，
**已停下来等用户裁定**（§I 红线：首次修改上游自有文件）。

（T004 已完成，见下「T004 结论」。）其余候选：T006 沙箱锚定（**承接 T004 移交的验收项**，
见 `tasks.md` T006 段）/ T019–T024 002 评审移交。未裁定的还有任务书 Step 0.5 的 **D2–D6**。

## 已完成
- **T004**（2026-09-30）· 每用户一个库的**注册表**落地（`packages/core/src/database/router.ts`，新增）。
  **零改动上游文件**。要点见下「T004 结论」，**含一个测试抓到的串库坑**（`Layer.fresh` 去掉即串库）。
- **T001**（2026-09-30）· 定位 `database.ts` 单例现状 + 可仿模式清单 → 产出 `refactor-targets.md`。
  要点见下「T001 结论」，**含一条影响 T004 落点的结构性发现**。
- **T002**（2026-09-30）· 目录挂载 + 受限用户权限方案 → 产出 `isolation-scheme.md`。
  要点见下「T002 结论」，**含一条阻断 T007 的未裁定问题**（已由 §5 裁定乙解锁）。
- **T003**（2026-09-30）· 验签门落地（取代 002 的「读头即放行」）。要点见下「T003 结论」，
  **含一处对 plan「模式 A」的有意偏离**（`LayerNode.unbound` → `Context.Service`，已 grep 全部引用点同步）。

## 阻塞项
（无——§5 已于 2026-09-30 裁定为**乙**，T007 解锁）

### ⛔ 本 feature 未覆盖（登记为缺口，**不是覆盖**——`LEARNINGS #002-02`）

| 缺口 | 原因 | 处置 |
|---|---|---|
| **两个用户共用同一个 `Location.Ref` 时的隔离** | T004 的落点是「取连接点路由」，按当前 fiber 的 `User` 选库；而 Location 树按**目录**缓存、不按用户分键 ⇒ 后台 fiber 会「陈旧身份捕获」 | **移交 T006**：验收项 = 一条测试证明「两个用户拿不到同一个 `Location.Ref`」（已写进 `tasks.md` T006 段）。**T006 落地前不得声称已隔离。** |
| **长连接（SSE `/event`、WebSocket `/pty`、`/tui`）与 `SessionPrompt`（发消息跑 agent）下的取连接行为** | 第三轮探针刻意避开（要 provider/LLM），只测了普通 HTTP 请求 | **T012/T013 的隔离测试**要覆盖到；落地前登记为未测 |
| **单进程多库方案本身**（一 client 服务多库、`Semaphore.make(1)` 的全局串行化、事务语义） | 探针只验了前提「acquirer 拿得到 `User`」 | T004 自己的测试覆盖 |

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

## T004 前置实测（2026-09-30 · 实测已做；落点**已裁定【甲】**，见下）

T001 留了一句「T004 必须实测」。**测了**（探针用完即删，未入库；完整数据见 `refactor-targets.md` §3）：

| 测法 | 结果 |
|---|---|
| 静态：`hoist` 后的 `hoisted` 集合 | 18 个 global 被切出，**`@opencode/v2/storage/Database` 在列**；主树里 global 残留 = 0 |
| 静态：数 `Database` 引用点 | **7 处** |
| 运行时：替换层计数 + materialize 两个 location key | **每 key 建 8 次**；同 key 再取不重建（缓存有效） |

⇒ **`Database` 不是进程级单例**：随 location key 各建一份，且每个引用点各建一份。
> 🔴 **2026-09-30 更正：本行结论在生产形状下不成立**——它是**用替换层**测出来的。
> 去掉替换层后实测：**整个进程只有一份 `Database.Service` 对象**。详见下「消费侧实测结果」（§C）。
⇒ ⚠️ **由此浮出一条会串库的坑**：路径**不能**由「当前请求的 `User`」决定——location 层按 key 缓存
（TTL 60 分钟），请求身份每次变，缓存里留下的是**第一个**用户解析出来的库。
路径必须由 **key（`Location.Ref`）** 派生，或把 userId **并进 key**。

**三条路（未定，需要你拍板）**：
| 方向 | 思路 | 代价 / 风险 |
|---|---|---|
| 甲 · 换掉 `Database.node` 指向 | 新增一个「按 location 上下文派生 db 路径」的层，作为 replacement 传入 | 零改上游文件；但路径只能由 **key** 派生（不能看请求身份），且需 T006 锚定「一个 location ↔ 一个用户」 |
| 乙 · `Database` 自持 `Map<userId, 连接>`（节点仍 global） | plan.md 原案 | 实测显示 `{db}` 句柄在 7 个引用点各有一份 ⇒ 要么改所有消费者取用方式（侵入大），要么做 drizzle 代理（脆弱） |
| 丙 · userId 并进 location map 的键 | 复用现成 LayerMap + TTL | 要动 `Location.Ref` 的语义（上游类型）⇒ 侵入面偏大 |

### ✅ 落点裁定（2026-09-30 · 用户裁定【甲】）

**甲 = 在 server 根处把 `LocationServiceMap.node` 换成我们自己的 map，并在其中把 `Database.node`
替换成「指向该 location 对应文件」的层。**

> 🔴 **2026-09-30 稍后：本裁定的前提被消费侧实测推翻**（见下「消费侧实测结果」§D）。
> 本节保留作为**决策记录**，但**不要照此开工**。

**⚠️ 我给用户的成本估计被实测推翻，更正两处**（按 `LEARNINGS #002-06`：不实数字代价最大）：

1. 我说过「**甲零改上游文件**」——**不对**。`AppNodeBuilder.build` 的自动分支**不是**两个 server 根
   实际走的路径（R1 的 `hasUnbound(app, LocationServiceMap.node) === false`）；甲的接线点是 **4 处**，
   见下「接线点清点」。
2. 我说过「**甲结构上不可能串库**」——**对 per-location 树成立，对主树不成立**。见下「第一轮实测」。

**为什么不选乙 / 丙**（复述给未来的自己，免得重新发现一轮）：

- **乙**（`Database` 自持 `Map<userId, 连接>`）：它有甲没有的好处——**不用逐根接线**（一处改动，
  所有根自动生效）。但代价是要改 ~10 个上游消费者，或做 drizzle 代理（脆弱）。
  ⚠️ 这条在下面「第一轮实测」之后**分量上升了**：主树那条路径恰恰是甲碰不到的。
- **丙**（userId 并进 location key）：**它并不能单独解决路由**——db 文件指针仍来自
  `Database.node.implementation`，所以丙 = 甲的工作 **加上** 改上游 `Location.Ref` 的类型语义。
  ⇒ 严格劣于甲。

### 接线点清点（2026-09-30 · 实测）

**两个 server 根都活着**，各自服务真实流量（`cli serve` 走 R2；opencode 自带 server 走 R1）：

| # | 接线点 | 现状 | 要改成 |
|---|---|---|---|
| 1 | `packages/server/src/routes.ts`（`makeRoutes`） | 靠 `AppNodeBuilder` 的**自动分支**建 map | 显式传入我们的 map |
| 2 | `packages/opencode/.../httpapi/server.ts` 的 `createRoutes` | 显式调 `buildLocationServiceMap()` | 换我们的 builder |
| 3 | `.../httpapi/handlers/pty.ts` | handler 自己 `Layer.provide(locationServiceMapLayer)` | 换我们的 layer |
| 4 | `.../httpapi/handlers/file.ts` | 同上 | 同上 |

⚠️ **接线式的缝有个固有缺点**：**漏改一处 = 那条路径静默用回公共库**（不报错、不变红）。
⇒ 必须配一条**兜底测试**（把每个根 build 出来，断言解析到的 `Database` 落在租户路径下）。
这条测试**不是锦上添花，它是这个方案的安全网**。

### ⚠️ 第一轮实测（静态依赖图）：主树确实有「不经过 location map」的 Database 路径

**两个根都是「是」**（探针用完即删，未入库）：

- **R1**（`app` 组，56 个直接成员）：**31 个**依赖 Database；根 → Database 共 **600 条路径**，
  其中**含 location map 一跳的 = 0 条**。
- **R2**（`applicationServices`，10 个直接成员）：主树消费者 = `Event` / `Session` /
  `PermissionSaved` / `Credential` + Database 自身。

**原因是结构性的，不是巧合**：`LocationServiceMap.node` 是 **unbound 叶子**
（实测 `kind: unbound`、`dependencies.length === 0`），而 per-location 树来自**另一个模块级 group**
（`locationServices`），由 `LayerMap` **运行时**按 ref 建出——**不是从根可达的子树**。
⇒ **它不在任何一条通往 `Database` 的路径上**，所以在根上替换它**结构上碰不到主树**。

主树的消费者里含**真实租户数据**的持有者：`Session`、`session-projector`、`PermissionSaved`、
`Credential`、`Event`、`ProjectDirectories`。

⇒ **甲按现在划定的范围，不足以保证「用户 A 读不到 B 的会话」——只要有一个租户请求由主树服务。**

### 🔴 消费侧实测结果（2026-09-30 · **HTTP 真请求**，非静态推断）

方法：重建 `packages/server/src/routes.ts` 的 `makeRoutes`（逐字照抄，只把 `Database.node` 换成
带账本的探针层，用 `:memory:`），`HttpRouter.toWebHandler` 起 handler，`fetch` 真实路由。
探针用完即删。**结论：主树那份 `Database` 被真实请求消费了。**

#### A. 因果对照（把「谁在执行 SQL」钉死）

| 场景 | 探针行为 | 结果 |
|---|---|---|
| A1 | 主树那份**一调用就 die** | `GET /api/session?limit=5` → **500**；`POST /api/session` → **500** |
| A2 | 主树那份**只对 `insert` die**，`select` 正常 | 同一个 `GET /api/session` → **200**；`POST /api/session` → **500**（die 在 `insert`） |
| B | **per-location** 那份一调用就 die，主树正常 | 5 个请求**全部 200**，**无一失败** |

A2 是决定性的一条：同一个 GET，`select` 不 die 就 200、`insert` die 就 500
⇒ 这条链路上执行 SQL 的**确实是主树那份**。

#### B. per-location 那份在生产形状下几乎不被调用

场景 B 的 5 个请求里，per-location 那份 `Database` **总共只被调用一次**
（`ProjectCopy.refresh` 的 `db.transaction`），且它的失败被
`packages/core/src/project/copy.ts` 的 `Effect.catchCause(..., "project copy refresh failed")`
**吞成一条 WARN**，不进 HTTP 响应。⇒ **失败都不会暴露**，这正是「看起来像隔离」的典型形状。

#### C. 生产形状下**整个进程只有一份 `Database.Service` 对象**

去掉替换层、按生产写法实测：

```
distinct real Database.Service objects: 1   （19 次构建事件，全部指向同一个对象）
```

配套控制实验（同一 layer 对象被引用两次会构建几次）：

```
E1 merge             builds=1 value=1
E2 provideMerge      builds=1 value=1
E3 两份 Layer.fresh   builds=2 value=2
E4 一份 fresh 一份不 fresh  builds=2 value=2
```

⇒ **Effect 对同一个 layer 对象只构建一次**；`Database.node` 是模块级单例对象，被主树与
per-location 树共同引用 ⇒ **两者共用一份**。这也解释了为什么上面的替换层实验会得出
「每 key 建 8 次」——**替换层是每次新建的 layer 对象**，把 `Layer.fresh` 的效果放大了。

#### D. 对方案的直接影响

**⇒ 甲按现在划定的范围不成立**：真实请求读写的是**主树**那份 Database，
而在 location map 里替换 `Database.node` **碰不到主树**（见上「第一轮实测」）。
⇒ **T004 回到未决状态**，需重新裁定（用户 2026-09-30 已裁定甲，**此实测推翻了它的前提**）。

#### E. 未测出的部分（**不当结论用**）

1. **R1（`packages/opencode/.../httpapi/server.ts` 的 `app` 组）没有运行时实测**——
   全部运行时证据来自 `packages/server` 这条路。R1 只有静态事实。
2. 场景 A 里 500 的**确切 defect 文本没拿到**（body 为空）；归因来自事件顺序 + A2 的方法级对照，
   不是直接读到错误消息。
3. **未覆盖全部路由**（`file` / `pty` / `question` / `permission` 等 group 没跑），
   per-location 那份在别的路由上是否被更多调用，未知。
4. 生产形状探针必然注入了 replacement 节点；「未改动的 `Database.node` 在生产图里也只构建一次」
   这一层是**由控制实验 E1/E2 推出**的，不是直接观测。

**旁证**：`handlers/pty.ts` / `handlers/file.ts` 的 handler 走 v1 `Session`
（`packages/opencode/src/session/session.ts`）；`packages/server` 的 handler 走 v2 `SessionV2`。
两条路都存在（见 `state.md` 上方 R1/R2 的静态结论）。

### ✅ 第三轮实测：acquirer 能不能看到请求的 `User`（2026-09-30 · **生死点，已验**）

甲被推翻后，候选落点收敛到「**在取连接的那一刻路由**」——`packages/core/src/database/sqlite.bun.ts`
里的 `acquirer`。它成立与否，只取决于一个问题：**acquirer 跑起来时，当前 fiber 的 context 里有没有
请求的 `User.Service`**。

> **类型上的死路与绕法（先记下，省得下一个人再撞）**：`Connection.Acquirer` 的类型是
> `Effect<Connection, SqlError, Scope>` —— **`R` 通道写死**，所以「在 acquirer 上声明依赖 `User`」
> 编译不过。绕法是 `Effect.withFiber((fiber) => ...)`（`R = never`，直接摸 `fiber.context`）——
> 同文件的 `run()` 早就这么取 `Client.SafeIntegers` 了。**缝一直在，只是不在类型上。**

**实验一（核心层最小复现，层只 build 一次模拟启动，随后在 provide 了 `User` 的 fiber 里跑真查询）**：

| 问题 | 结果 |
|---|---|
| provide `User` 时账本记什么 | **`acq:alice`** |
| 不 provide 时记什么（对照，证明账本有效） | `acq:NONE` |
| 事务路径（`transactionAcquirer`） | `tx:alice`，同样看得见 |
| `Layer.build` 在谁的 context 里执行 | **调用方的**——build 期查询 provide 了 User 就记 `alice`，没 provide 就记 `NONE` |

**实验二（HTTP 真请求，生产路由树 `HttpApiApp.routes` + `HttpRouter.toWebHandler`，身份门真开着）**：

门确实开着（无凭证 / 坏凭证都 401，**没有绕过门当成功**）：

```
NO-TOKEN  /session -> 401
BAD-TOKEN /session -> 401
```

| 问题 | 结果 |
|---|---|
| **普通请求期间 `NONE` 出现几次** | **0 次**。`GET/POST/PATCH/DELETE /session`、`/session/:id/message` 全部 `acq:alice`（事务路径 `tx:alice`） |
| 有没有请求**同时**出现 userId 与 `NONE` | 没有 |
| 空闲 2000ms 账本新增 | **0 条**（本窗口内无周期性后台查询） |
| 启动期（`DatabaseMigration.apply`） | **`NONE`**——`Database` 层构造不在请求 fiber 里，走建层 fiber |

⇒ **落点成立**：取连接那一刻，身份是拿得到的，且**每次查询看的是发起查询那个 fiber 的身份**
（不是「首个请求」的）。

### 🔴 但它带回来一个方案没预料到的反向风险：**陈旧身份捕获**（不是「无身份」）

`ProjectCopy.refresh` 在账本里记的是 **`acq:alice` / `tx:alice`**，**不是 `NONE`**。
它跑在一个由 `Effect.forkScoped` 派生、经 `InstanceStore.load` 的 `Effect.forkIn` 从**请求 fiber**
分叉出去的**后台 fiber** 里——**该 fiber 继承了发起首个请求的那个用户的身份**。

而 Location 服务树是按 **`Location.Ref`（目录）** 缓存的（`LayerMap`，TTL 60 分钟），
**不按用户分键**。两件事合起来：

> 留驻在按目录缓存的 Location 层里的**后台工作**，会写进**第一个碰该目录的用户**的 db。

危害的**机制**是证据链支撑的（实验一的 `Layer.build 继承调用方 context` + 实验二账本里
`COPY_REFRESH` 段记到 `alice`）；但**危害本身没有直接实测到**——跨用户那组只跑了 3 个请求、
1 个目录对，且 **bob 的两个请求压根没产生 DB 查询（账本 0 条）**，所以严格说：
**没有观察到泄漏，但也没有压到会泄漏的那条路径。**

⇒ **落点成立 ≠ 落点充分**：这一条是「取连接点路由」单独用不够的证据，
它指向 **Location 层的缓存键必须按用户分**（或由 T006 沙箱锚定天然达成——见下）。

### 本轮未覆盖（按 `LEARNINGS #002-02`：缺口写成缺口，不写成覆盖）

1. 只跑了一个进程、一个 `:memory:` 库——**没验证真实文件路径下**的行为（多文件、WAL、目录权限）。
2. **没测长连接**：SSE `/event`、WebSocket `/pty`、`/tui`——它们跨多个用户生命周期，是明显的下一个疑点。
3. **没测 `SessionPrompt`（发消息跑 agent）**——最长的一条链路（工具调用、后台 job、LLM 流），
   `BackgroundJob` / `SessionProcessor` 里的 fork 极可能重现上面的「陈旧身份」同类问题。
4. **没有并发请求**（任务要求串行），「两个用户同时打同一目录、Location 层正在构造」的竞争没测。
5. 跨用户那组样本极小且**没压到目标路径**（见上）。
6. 未验证方案本身（一 client 服务多库、`Semaphore.make(1)` 的全局串行化、事务语义）——只验了前提。

### ✅ 落点最终裁定（2026-09-30 · 用户裁定「**乙＋丙，丙挂 T006**」）

**裁定内容**：T004 的落点 = **取连接点路由**（`sqlite.bun.ts` 的 `acquirer` 按当前 fiber 的 `User`
选库）＋ **Location 缓存键必须按用户分**；后者**不现在做**，而是**挂到 T006 的验收项**上。

**为什么不是「现在就显式给 Location 键加 userId」**（代价已实测，非估计）：

| | 丙现在就做 | 丙挂 T006 |
|---|---|---|
| 改动面 | `Location.Ref` 是 **`packages/schema/src/location.ts` 的 `Schema.Struct`**，加字段 = **改上游 schema 包**（被 **18 个文件** import）；`Ref.make` 字面构造点 **生产 17 处 + 测试 11 处**，`Location.Ref` 相关命中全仓 **198 处** | 只碰 `sqlite.bun.ts` 的 acquirer（一处内部小改）＋ 新增 `router.ts` |
| 与上游冲突面 | 每次上游动 `location.ts` / `schema/location.ts` 都撞上我们 ⇒ 撞宪法 §I | 窄一个数量级 |
| 是否冗余 | 若 T006 沙箱锚定做实，两个用户拿不到同一目录 ⇒ 这一维**纯冗余**，代价是每目录每用户多一棵 60 分钟 TTL 的服务树 | 无冗余 |

**但这个选择把一条安全不变量推迟到了另一个 task**，故附**三个条件**（缺一不可，是把「延迟的风险」
变成「登记在案、有验收项的风险」的全部差别）：

1. **丙 是 T006 的书面验收项**——判据是一条**测试**：「两个用户拿不到同一个 `Location.Ref`」。
   已写进 `tasks.md` 的 T006 段。理由：`LEARNINGS #002-04`（责任推出去时既没指定接收方、
   也没核对接收方是否知道）——002 的欠账就是这么在两份文档之间蒸发的。
2. **T006 落地前，本缺口在本文档登记为「未覆盖」，不写成「已覆盖」**（`LEARNINGS #002-02`）。
   判据：今天没有任何一条测试压过「两用户抢同一目录」，所以它**不是覆盖**。
3. **非 HTTP 入口的回退判据按「谁在跑」而非「有没有 `User`」**——与落点无关，无论选哪个都得做对。
   见下方「非 HTTP 入口」清单：回退判据若是「context 里没有 User 就回退」，
   等于给 HTTP 请求留了一条**静默串库的暗道**。

**改判回「丙现在就做」的触发条件**（现在就写进 T006，到时不必重新论证）：
若 T006 最终**做不到「一人一工作区」**（例如产品上允许民警打开任意路径），
则 `Location.Ref` 不再天然按用户分，丙从「冗余」变成「必需」，**必须回到本 task 补**。

**刻意不做的一件事**：不为丙写一条**长期红灯**的测试。红灯挂久了会被当噪音忽略，比没有更糟——
丙的红灯测试属于 **T006 的交付物**，不属于 T004。

#### 非 HTTP 入口清单（条件 3 的对象）

以下入口**都没有 `User`**，但**共享同一个 `Database.node` 单例**，故都需要一条显式回退：

| 入口 | 落点 |
|---|---|
| TUI | `packages/opencode/src/cli/tui/layer.ts` → `AppNodeBuilder.build(Global.node)` |
| CLI 主层 | `packages/opencode/src/effect/app-runtime.ts` → `AppLayer` |
| 启动层 | `packages/opencode/src/effect/bootstrap-runtime.ts` → `BootstrapLayer` |
| ACP（编辑器集成） | `packages/opencode/src/acp/service.ts` → `AppNodeBuilder.build(ACPSession.node)` |
| SDK-next | `packages/sdk-next/src/opencode.ts` |
| HTTP server（第二支） | `packages/server/src/routes.ts`（**没看到**身份中间件，待确认） |

回退**目标**是现状的 `path()` 结果（本机用户自己的库）——对本地 CLI/TUI 是**对的**。

## T005 探针结论（2026-09-30 · 三问全部实跑；**推翻了我自己的一条读码推断**）

T005 开工第一步跑探针（不预设形状）。探针文件已删、临时改的上游文件已还原
（`git status` 只有本文档与 `tasks.md` 两处 M，无未跟踪文件；`git diff` 对
`packages/opencode/.../user-identity.ts` 与 `packages/core/src/database/` 均为空）。

### ❌ 先更正一条错话：我说「裁定落点站不住」，**是错的**

我据「`sqlite.bun.ts` 的 `run()` 里是 `native.query(query)`」推断「acquirer 只是 facade、
换不了库」。**实测推翻**：`Client.make` 的 `getConnection` **每条查询都回调 acquirer**，
`Statement.make(getConnection, …)` 每查询取一次；**acquirer 返回哪个 connection 就决定落到哪个文件**。

实测（把两个 `layerFromPath` 各自的 connection 交给第三个自建 client 的 acquirer 按身份二选一）：

| 实验 | 结果 |
|---|---|
| 身份 = B 时写 `probe` | 只落在 **B** 的文件（`a_has_probe:false, b_has_probe:true`） |
| 身份 = A 时写 `probe_a` | 只落在 **A** 的文件 |
| 对照：acquirer 写死 connA/connB | 身份不再影响落点（`a:["fixed_a"], b:["fixed_b"]`） |

⇒ **裁定「乙 · 取连接点路由」成立，T004 的落点不变。** 教训：`LEARNINGS #001-01` / `#002-03`
——**读代码的推断不等于实测**，我这次就是以「看起来对」的代码形状下了结论，被 10 分钟的实验推翻。

### ❌ 候选路 ①：请求级替换 `Database.Service` —— **无效**

做法：真 HTTP 请求路径上，在身份中间件里 `Effect.provideService(effect, Database.Service, 每用户实例)`，
身份门真开、真签发的 JWT。结果：

```
[Q2] POST /session (alice) -> 200      ← 建会话成功
[Q2] alice 库: []                       ← 但 alice 库里 0 行
[Q2] bob  库: []
[Q2] GET /session (bob)   -> 200  [{… "title":"alice-probe" …}]   ← bob 读到了 alice 的会话
```

**机制定位（决定性）**：`[Q2-机制] {"lazy":"OUTER(中间件注入的)","captured":"INNER(路由层提供的)"}`
—— 同一棵树、同一处注入，**每次 `yield*` 的惰性读者看得到注入，而建层时捕获的读者看不到**。
⇒ 失败原因**不是遮蔽，是消费者在建层时就把 `Database.Service` 捕获了**。
捕获点成串（`opencode/session/session.ts` 的 `layer`、`core/session.ts`、`core/event.ts`、
`core/credential.ts`、`core/project/copy.ts` … 十余处），都是
`Layer.effect(…, Effect.gen(function*(){ const { db } = yield* Database.Service …}))`。

⇒ **「`packages/core` 零改动、只在服务端加一个注入点」这条路不存在**（探索过，排除）。

### ❌ 候选路 ②：把 `#sqlite` 映射换成包装层 —— **死锁**

```
[Q3-①] 建层期看到的身份: ["k:caller-identity"]      ← per-user 层在调用方 fiber 里构建
[Q3-②] {"ok":false,"why":"TimeoutError"}           ← 构建中再取同一 key：5s 挂住，不是报错
```

合成真链路：`router.ts` 的 per-user 层 → `Database.layerFromPath` → `#sqlite` → `make()`，
而该层的构建体（`database.ts` 的 `layer`）**自己就跑 6 条 PRAGMA + `DatabaseMigration.apply`**
⇒ 包装层若按 fiber 身份回调 router，这些建层期查询会以**同一 key** 再进一次 ⇒ 同型死锁。
**要走这条必须先显式打断递归**（例：per-user 层 `Layer.provide(Layer.succeed(AlreadyRouting, true))`，
包装层见标记即退回 `config.filename`）。

### ✅ 推荐落点（方案 A）：`sqlite.bun.ts` 里加一个**可选钩子**，路由逻辑全在 `router.ts`

- `make()` 的 `acquirer`（**及 `transactionAcquirer`**）改成：先问 fiber context 里一个**可选**钩子；
  **没有钩子就逐字用本层 `connection`**（默认路径与现状逐字相同）。
- 钩子与全部路由逻辑放 `packages/core/src/database/router.ts`（**新增**，零冲突面）。
- 上游触碰：**1 文件 / 约 5 行**（`sqlite.bun.ts`）；`database.ts` 与 `package.json` **都不用动**。
- ⚠️ 仍须解 Q3 的重入（见上），且事务路径也要路由。

### 本轮未覆盖（按 `LEARNINGS #002-02`：缺口写成缺口）

① **没有端到端跑过**「改了 `sqlite.bun.ts` 的 acquirer 之后落点确实改变」——Q1 是用**同型**自建
client 证明机制，上游文件当时一行未动；这一步是「Q1 实测 + 静态读码」的**合成**。
② 未测事务路由后的行为；③ 未测长连接（SSE/WebSocket）与 `SessionPrompt`（agent 链路）；
④ 未测并发（两用户同打一目录）。③④ 与第三轮的未覆盖项重合，仍未覆盖。
⑤ 捕获点清单来自 grep + 读码，**没有逐个消费者跑**。
⑥ Q3 的「真链路会死锁」由 ①+②+静态事实推出，**没在真实 router + `#sqlite` 包装下跑出死锁**。

## T004 结论（2026-09-30 · 每用户一个库的注册表已落地）

**落点**：`packages/core/src/database/router.ts`（新增）+ `packages/core/test/database-router.test.ts`（新增）。
**零改动上游文件**——`database.ts` / `sqlite.bun.ts` 一行没动。接进 `Database.node` 是 **T005** 的事，
本 task 只交**注册表本身**：给一个 userId，给出那个用户独有的 `Database.Interface`；**不读任何上下文**。

**公开面**：`DATA_ROOT_ENV` / `dataRoot(env)` / `userDatabasePath(root, userId)` /
`Service`（`Interface = { forUser }`）/ `layer({ root })`。

**三条出参怎么落的**：

| 出参（`tasks.md` T004） | 落法 |
|---|---|
| `/data/{userId}/opencode.db`，`OPENHIVE_DATA_ROOT` 常量落本 task | `join(dataRoot(env), userId, "opencode.db")`；`dataRoot` 照 002 的 `workspaceRoot(env)` 先例读 **env 记录**（可注入），空串按没设处理 |
| 目录**惰性** `mkdir -p` | 在**层构造里**（`Layer.unwrap`）、开库之前——`new Database(...)` 不会建父目录（`isolation-scheme.md` §1）。**不能放 `forUser` 里**：T005 后那是按查询调用，等于每查询一次 `mkdir` 系统调用 |
| 各自 PRAGMA + 迁移 | **复用 `Database.layerFromPath`**，不自己开库。那 5 条 PRAGMA、`wal_checkpoint`、`DatabaseMigration.apply` 全在里面；自己写一份等于把「新库要跑迁移」分裂成两处 |
| 多 userId 各自连接独立 | `LayerMap`（TTL 60 分钟）按 userId 缓存 + **`Layer.fresh`**（见下） |

**校验口径**：与 002 `createWorkspace` **等价**、本地实现。为什么本地写：`packages/core/package.json`
**没有 `@opencode-ai/auth` 依赖**，core 是最底层，反向 import 会让依赖倒过来。

**为什么用 `LayerMap` 而不是裸 `Map`**：它自带空闲回收（TTL）与并发去重——`plan.md` R2（连接泄漏）
要的正是这个，不必重造；`location-services.ts` 是同一个用法。

### 🔴 踩到并已修的坑：`Layer.fresh` 去掉就**串库**

`Database.layerFromPath(filename)` 内部是 `layer.pipe(Layer.provide(sqliteLayer({ filename })))`，
其中 `layer` 是 **`database.ts` 的模块级常量**。而 `Layer.buildWithMemoMap` **按层对象身份缓存** ⇒
不加 `Layer.fresh` 时，**第二个用户会直接复用第一个用户已建好的连接**，两个 userId 指向**同一个库文件**。

**这不是理论风险——本 task 的测试第一版就撞上了**：关键断言「bob 看不到 alice 建的表」直接变红
（bob 的库里查到了 `probe` 表）。修法就是 `.pipe(Layer.fresh)`，与 `location-services.ts` 同款。

> 这是本 feature 第二次撞「**同一 layer 对象被共享 memo 缓存**」这一类问题（第一次是 `Database`
> 的进程级单例），而两次都是**测试**而不是推理抓到的。`LEARNINGS #001-04`（三段真相链）同源：
> 层树里「看起来一样」的东西，缓存键未必含你以为的那一维。

### 质量门禁（2026-09-30 实跑，非外推）

| 门 | 命令 | 结果 |
|---|---|---|
| 单测 | `cd packages/core && bun test test/database-router.test.ts` | **6 pass / 0 fail**，21 expect |
| 类型 | `cd packages/core && bun run typecheck` | 通过（`tsgo --noEmit` 无输出） |
| lint | `bunx oxlint -c script/oxlintrc.openhive.json <两个新文件>` | **0 warning / 0 error**，161 rules（＝ `LEARNINGS #001-05` 的 161 = 131 + 30 恒等式，配置未被换过） |
| 回归 | `cd packages/core && bun test`（全包） | **基准对照，Δ 见下** |

**全包回归的基准对照**（`LEARNINGS #001-02`：门禁数字先测真实基线再引用）。两次真跑，唯一变量
是这两个新文件在不在树里（把它们临时挪出仓库再挪回，不是靠「它没被 import」推断）：

| | pass | skip | fail | 失败名单 |
|---|---|---|---|---|
| **无 T004（基线）** | 1087 | 7 | 5 | 5 条 `NpmConfig` |
| **有 T004** | 1093 | 7 | 5 | **同一条不差**的 5 条 `NpmConfig` |

⇒ **Δ = +6 pass（本 task 的 6 个用例）/ 0 新失败**。

那 5 条 `NpmConfig` 是**存量环境失败，不是本 task 的**，根因与 CLAUDE.md 记的 `bun.lock` 污染**同源**：
本机 `~/.npmrc` 指向 `registry.npmmirror.com`，漏进了「读项目 `.npmrc`」的用例
（实测报错正文：`Expected "https://registry.example.test/" / Received "https://registry.npmmirror.com/"`）。
**未动 `~/.npmrc`**——那是本机全局配置，改它超出本 feature 边界。

⚠️ **一次抖动，已如实记下**：其中一次全包跑里 `test/snapshot.test.ts` 的
`isolates snapshot indexes by canonical Git worktree` **超时**（`timed out after 5000ms`），
另两次跑**都不出现**。判定为 5s 超时的存量 flake（与机器负载相关），**不是**稳定失败；
本 task 没有结论依赖它，但**「跑几次绿一次」不等于稳**，若它在 T005 之后复现要当回事查。

**未覆盖**（缺口，不是覆盖）：① 没跑 HTTP，本 task 的注册表**还没接进任何真实请求路径**（T005 的事）；
② 没验真实 `OPENHIVE_DATA_ROOT` 下的权限/属主（T007 的事）；③ `Layer.fresh` 后每用户一棵树，
    多用户下的**连接基数与内存占用**没量（R2 的量化留给收尾评审）。

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
2026-09-30（**T005 探针已跑完** → 裁定「乙」成立、落点不变；**但我据读码写的「落点站不住」被实测推翻**，
已更正。另两条候选路被排除：请求级替换 `Database.Service` 无效（消费者建层时捕获）、`#sqlite` 包装层死锁。
推荐方案 A 要碰 `sqlite.bun.ts` 约 5 行（§I 红线，**等用户裁定**）。详见下「T005 探针结论」）
2026-09-30（**T004 已完成**：每用户一个库的注册表落地，零改动上游文件；**下一个候选 T005**。
补：全包回归已做**基线对照**（挪开/挪回两个新文件各真跑一次）——Δ = **+6 pass / 0 新失败**；
既有 5 条 `NpmConfig` 失败是本机 `~/.npmrc` 镜像导致的**存量**，与 T004 无关；另记一次 `snapshot` 5s 超时抖动。
补：REFACTOR 把 `mkdir` 从 `forUser` 挪进**层构造**（`Layer.unwrap`）——否则 T005 后是每查询一次系统调用；
已按 `LEARNINGS #002-06` grep 后同步 `state.md` / `tasks.md` 两处旧记述）
T004 落点三轮实测后裁定「乙＋丙，丙挂 T006」——取连接点路由 + Location 缓存键按用户分）
2026-09-30（**T003 验签门已落地**；T001/T002 完成；**§5 隔离模型已裁定为【乙】**。
FR-002 信任模型 2026-09-29 定稿为【甲】真做验签。
补①：design-v2 的两类过头记述已按 `LEARNINGS #002-06` grep 后清完——【甲】那次的同步范围划小了，漏了 design-v2。
补②：T003 落地时**改判不用模式 A**（`LayerNode.unbound` → `Context.Service`），已 grep 全部引用点并同步）
