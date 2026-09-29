# T001 产出 · `database.ts` 单例现状 + 可仿模式清单

**Feature**: `003-multi-tenant-isolation` · **Task**: T001 [P][BE] · **日期**: 2026-09-30
**出参要求**: 「单例现状 + 可仿模式清单」（`tasks.md` T001）
**核实基点**: 分支 `worktree-feat-003-multi-tenant-isolation` @ `e788f9a9aa`

> **引用约定**：本文档按 `LEARNINGS #002-06` 执行——**引用源码写符号名 / 测试名，不写行号**
> （本 feature 之前的行号引用漂过三次，补数字是在追一个追不上的东西）。

---

## 0. 结论摘要

1. **真身确认**：`Database` 单例 = `packages/core/src/database/database.ts`（**不是** `packages/opencode/src/`）。
   同目录的 `path.ts` 是 drizzle 列类型定义（`absoluteColumn` / `directoryColumn` / `pathColumn`），
   **与 db 路由无关**——任务书这条提醒属实，照文件名找会找错地方。
2. **「一个进程一个 db」的根源 = `path()` 在模块导入时求值一次**，且它依赖的 `Global.Path.data`
   同样在导入时算死（`packages/core/src/global.ts` 顶层 `path.join(xdgData, app)`）。
   `node = makeGlobalNode({ service, layer: layerFromPath(path()), deps: [] })` 这一行把结果焊死。
3. **纯上游区确认（实测，非文档口径）**：`packages/core/src/database/` 下
   `git log --author=huangandy` **零条提交**；`database.ts` 最近 5 次改动全是上游 PR。
   ⇒ 宪法 §I / R1 的「我们从未碰过它」**成立**。
4. **现成的「加」的缝已存在**：`layerFromPath(filename)` **已经是导出的公开 API**——
   接受任意文件名的 layer 工厂。它是同文件里唯一不需要改动就能复用的东西，
   **`database.ts` 零改动即可产出「指向另一个文件」的 Database layer**。
5. **可仿模式有现成的一套**（`Location` 的 per-key 服务树），但不是照抄能用的——
   见 §3 的结构性发现，它直接影响 T004 的落点选择。

---

## 1. 单例现状（`packages/core/src/database/database.ts`）

### 1.1 `path()` —— 「一个进程一个 db 文件」的根源

优先级从高到低：

| 分支 | 条件 | 结果 |
|---|---|---|
| ① | `Flag.OPENCODE_DB === ":memory:"` 或 `isAbsolute(Flag.OPENCODE_DB)` | 直接用该值 |
| ② | `Flag.OPENCODE_DB` 为相对名 | `join(Global.Path.data, Flag.OPENCODE_DB)` |
| ③ | `InstallationChannel ∈ {latest, beta, prod}` 或 `OPENCODE_DISABLE_CHANNEL_DB` 为 `1`/`true` | `join(Global.Path.data, "opencode.db")` |
| ④ | 兜底 | `join(Global.Path.data, "opencode-<channel 净化后>.db")` |

⇒ **三条分支全部落在 `Global.Path.data`**（`xdgData/opencode`），而 `Global.Path.data`
是 `global.ts` 的**顶层常量**，在模块导入时就算死了。

### 1.2 `node` —— 导入即定

```
export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
```

- `path()` 在**模块导入时**求值 → 全进程（乃至同一进程内所有层树实例）指向**同一个文件**。
- tag = `tags.values.global`（`packages/core/src/effect/app-node.ts`）。
- `layerFromPath(filename)` 内部：`layer.pipe(Layer.provide(sqliteLayer({ filename })))`，
  其中 `layer` 负责跑 6 条语句——5 个 PRAGMA（`journal_mode=WAL` / `synchronous=NORMAL` /
  `busy_timeout=5000` / `cache_size=-64000` / `foreign_keys=ON`）、
  `wal_checkpoint(PASSIVE)`，以及 `DatabaseMigration.apply(db)`。

> **对 T004 的意义**：这 6 条语句和迁移都在 `layerFromPath` 里面，
> **per-user 连接只要复用它，PRAGMA 与迁移自动跟着走**——不需要重写，也不需要复制这段逻辑。

### 1.3 引用面（`Database.node` 被谁用）

`git grep 'Database\.node'` 命中的**生产**文件（排除测试）：

| 包 | 文件 | 节点类型 |
|---|---|---|
| `core` | `credential.ts` | global |
| `core` | `event.ts` | global |
| `core` | `permission/saved.ts` | global |
| `core` | `project/copy.ts` | global |
| `core` | `project/directories.ts` | global |
| `core` | `session/projector.ts` | global |
| `core` | `session/runner/llm.ts` | global |
| `core` | `session/store.ts` | global |
| `core` | `session/todo.ts` | **location** |
| `core` | `session.ts` | global |

测试里已有**替换 `Database.node`** 的既有写法（说明替换是被上游支持的既有能力，不是我们要发明的）：
`packages/core/test/session-create.test.ts` 的 `[[Database.node, targetDatabase]]`
（`targetDatabase` 由 `Database.layerFromPath(...)` 产出）；
`packages/core/test/database-migration.test.ts` 同理。

---

## 2. 可仿模式清单

按「直接可复用程度」排序。

### 模式 A · `unbound` / `boundNode` 配对 —— `packages/core/src/location.ts`

```
export const node = LayerNode.unbound(Service, tags.values.location)
export const boundNode = (ref: Ref) => makeLocationNode({ service: Service, layer: layer(ref), deps: [Project.node] })
```

`LayerNode.unbound`（`packages/core/src/effect/layer-node.ts`）造一个**没有实现、只有 tag 的占位**；
`compile` 遇到它直接 `throw new Error("Unbound layer node: ...")`——
**这就是「必须被替换掉，否则构建失败」的编译期保证**，也正是 T003 想要的形状
（User 上下文没被填 = 直接炸，而不是静默拿到 `undefined`）。

### 模式 B · `LayerMap` + `hoist` + `compile` —— `packages/core/src/location-services.ts`

`buildLocationServiceMap(replacements)` 是本仓库**「按身份键做 per-key 服务树」的唯一先例**：

```
LayerMap.make((ref) => {
  const allReplacements = replacements.concat([[Location.node, Location.boundNode(ref)]])
  const location = LayerNode.hoist(locationServices, Node.tags.values.global, allReplacements)
  return LayerNode.compile(location.node)
    .pipe(Layer.fresh, ..., Layer.provide(LayerNode.compile(location.hoisted)))
}, { idleTimeToLive: "60 minutes" })
```

三个可直接搬的组件：

| 机制 | 作用 | 对应本 feature 的诉求 |
|---|---|---|
| `LayerNode.hoist(group, globalTag, replacements)` | 遍历层树时**把替换注进去**，并把 global-tagged 节点「切」出来单独建 | T004 的「替换 `Database.node` 为 per-user」 |
| `Layer.fresh` | 强制每个 key 独立实例、不复用 | 每用户独立连接 |
| `idleTimeToLive: "60 minutes"` | **空闲回收** | plan.md **R2 连接泄漏**——现成的回收机制，不用自己写 |

> ⚠️ `hoist` 的注释里有一句关键的坑：替换**必须在 hoist 期间**应用，不能建完再替换——
> 「replacements can introduce new tagged dependencies, and the hoist walk is the only pass
> that can still slice those back out」。T004 若仿此模式，这条必须照做。

### 模式 C · `AppNodeBuilder.build(root, replacements)` —— `packages/core/src/effect/app-node-builder.ts`

公开接受 `replacements`，并**自动**在 `LocationServiceMap.node` 未被替换时补上 location map。
测试与 CLI 都走这个入口。⇒ T004 的替换若能挂在 `replacements` 上，就不必改任何既有调用点。

### 模式 D · 环境变量常量先例

`packages/auth/src/policy.ts` 的 `JWT_SECRET_ENV`（002 落）、
`packages/opencode/src/server/auth.ts` 的 `ConfigService.Service` + `EffectConfig.string(...)`。
本 feature 新增的 env 常量（如沙箱根、限流阈值）照这两个来。

---

## 3. ⚠️ 结构性发现（影响 T004 的落点，务必先看）

**`Database.node` 的 tag 是 `global`，而 `Location.node` 的 tag 是 `location`。二者不对称。**

- `Location.boundNode` 能 per-key 替换，是因为 `buildLocationServiceMap` 在
  `LayerMap.make` 回调里对 **`locationServices` 组**做 hoist。
- 但 `Database.node` 的消费者里，**绝大多数是 global 节点**（§1.3 表，9/10 是 global），
  而 `locationServices` 组（`packages/core/src/location-services.ts`）
  **并不包含** `EventV2.node` / `SessionStore.node` / `SessionProjector.node` / `Credential.node` 等。
- ⇒ **不能照抄 Location 的替换点**：把 `Database.node` 塞进 `locationServices` 的替换列表，
  只能影响组内那一个消费者（`SessionTodo.node`），**组外 9 个节点仍拿到全局单例**。

**这是 T004 需要单独定夺的落点问题**，不是照搬就能过的。可选方向（T004 开工时定，本文档不预先拍板）：

| 方向 | 思路 | 代价 |
|---|---|---|
| ① 在 `AppNodeBuilder.build` 的 `replacements` 层替换 `Database.node` | 全局替换，所有消费者一起生效 | 需要每个请求/每个用户各自 build 一棵树（现有 location map 已是 per-ref build，可能天然契合） |
| ② 让 `Database` 自身持 `Map<userId, 连接>`，**节点仍是 global** | `Database.node` 不变，只改 `router.ts` 内部按上下文取连接 | 与 plan.md 「新增 `router.ts`」的落点最贴合；但需要 User 上下文在**连接取用点**可达（T005 的「从 User 上下文取 userId 路由」） |
| ③ 把 per-user 键并入 location map 的键 | 复用现成 LayerMap + TTL 回收 | 依赖「一个用户 ↔ 一个 Location.Ref」这个前提是否成立（T006 锚定沙箱后可能成立） |

> 本文档**只登记事实与代价，不裁定**。T004 开工前若方向未定，按任务书 Step 0.5 停下来问。

### ✅ 待实测项 —— 已测（2026-09-30，T003 收尾后、T004 开工前）

原文写「T004 必须实测（数一下同一进程内 `sqliteLayer` 被 build 了几次）」。**测完了**，三项：

| 测法 | 结果 |
|---|---|
| 静态：`LayerNode.hoist(locationServices, Node.tags.values.global)` 后看 `hoisted` 集合 | **18 个 global 节点被切出**，`@opencode/v2/storage/Database` **在列**；切完后主树里带 global tag 的节点 = **0**（全被切走） |
| 静态：数 hoisted 子树里 `Database` 的引用点 | **7 处**（5 个节点直接依赖 + 经 `ModelsDev` 的 1 处深层 + 节点自身） |
| 运行时：用替换层包住 `Database.layerFromPath(":memory:")` 计数，materialize 两个 location key | **每 key 建 8 次**；同一个 key 再取**不重建**（16 → 16，`LayerMap` 缓存有效） |

**结论（实测，非推断）**：现状下 `Database` **不是进程级单例**——它随 location key 各建一份，
且**每个引用点各建一份**（7 处引用 / 8 次构建，量级一致）。同一 key 内由 `LayerMap` 缓存兜住
（TTL 60 分钟），跨 key 不共享。

> 探针是一个临时测试 + 一个临时脚本，**用完即删、未入库**。要不要把它固化成一条长期测试
> （钉住「Database 在 hoisted 里」这个 T004 依赖的前提）由 T004 决定——好处是上游哪天改了会立刻变红，
> 代价是我们为此多了一个盯上游内部的测试。

**对 T004 的三条直接影响**：

1. **「按用户替换 `Database.node`」的管道已经现成**——per-key 构造本来就在发生，
   改的是「**指向哪个文件**」，不是「怎么构造」。不必为它发明新机制。
2. ⚠️ **不能用「当前请求的 `User` 上下文」来决定路径**：location 层是**按 key 缓存**的（TTL 60 分钟），
   而请求身份是**每次变**的。缓存里存下的是**第一个**用户解析出来的库 ⇒ **会串库**。
   路径必须由 **key 自身**（`Location.Ref`）派生，或把 userId **并进 key**。
   这一条是与 T003 的 `User`（每请求填）**生命周期不匹配**造成的，是本 spec 里最容易埋雷的地方。
3. **连接基数按实测算**：不是「每用户 1 条」，而是「**每个 location key 8 条**（指向同一文件），
   × location 数 × 用户数」。plan.md R2（连接泄漏）的评估基数据此重算。

---

## 4. 红线复核（宪法 §I / R1）

| 项 | 实测结果 |
|---|---|
| `packages/core/src/database/database.ts` 我们改过吗 | **零条提交**（`git log --author=huangandy` 空） |
| 该文件最近改动 | 全为上游 PR，最新 `472d0f376e refactor(core): remove infrastructure layer exports (#34624)` |
| `sql.ts` 里有 `user_id` 吗 | **无**（`grep -rn 'user_id' --include=sql.ts packages/core/src/` 零命中） |
| `session` 表结构 | `project_id: text()` + `index("session_project_idx").on(table.project_id)`；**无 `user_id`** |
| `packages/opencode/src/{user,database,middleware,quota}/` | **均不存在**，需新建（plan.md 已定落点）。⚠️ 2026-09-30 更新：T003 的 `User` 上下文**没落在 `src/user/`，落在了 `packages/core/src/user.ts`**——T005 要 `core` 的 `Database` 读得到它，tag 就必须在 core（与 `Location` 同侧） |

⇒ **零表结构改动的基线成立**（T009 的验收前提），**`database.ts` 保持零改动**是 T004 的硬约束。

---

## 5. 对后续 task 的输入

- **T003**（User 上下文）：⚠️ **落地时没用模式 A**（2026-09-30 改判，原文写的是「用模式 A」）。
  实际落地 = `packages/core/src/user.ts` 的 `Context.Service` + 中间件每请求 `Effect.provideService`。
  **为什么模式 A 在这里是错的**：`unbound`/`boundNode` 的用武之地是「**按 key 构造并缓存一棵服务树**」
  （`Location` 有 `LayerMap` + `Layer.fresh` + `idleTimeToLive` 才需要它）——占位节点在 `compile`
  时才被替换，替换物**由 key 算出来**。而用户身份是**每请求从凭证里验出来的纯数据**：
  没有要构造的东西、没有要缓存的树，也没有「由 key 算出替换物」这回事。为它建层树 = 每请求重建一棵树。
  它要的「未填即失败」有两层，`Context.Service` 都给了：编译期（消费者把 `User.Service` 写进 `R`，
  没人提供就过不去）+ 运行时（验不出身份直接 401，**比抛异常更贴 T003 的验收口径**）。
  ⇒ **模式 A 留给 T004/T005**：那里要替换的是 `Database.node`（真·按用户构造的连接），才是它该在的位置。
  落点文件：`packages/core/src/user.ts`（**core 不是 opencode**——T005 要 core 的 `Database` 读得到它）、
  `packages/opencode/src/server/routes/instance/httpapi/middleware/user-identity.ts`。
- **T004**（`Map<userId, 连接>`）：**复用 `layerFromPath(filename)`** 拿到 PRAGMA + 迁移；
  落点选择见 §3（**三选一，未定**）；参考**模式 B** 的 `Layer.fresh` 与 `idleTimeToLive`。
- **T005**（查询路由）：模式 B 的 `LayerMap` 是现成的「按 key 取服务」实现，可参照。
- **T006**（沙箱锚定）：`Location.Ref.directory` 是现有工作目录的载体
  （`packages/core/src/location.ts` 的 `layer(ref)` 里 `project.resolve(ref.directory)`）——
  锚定的落点大概率在 `ref` 的构造处，T006 开工时确认。
