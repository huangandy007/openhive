# 实施进度 · 多用户隔离

## 当前任务
下一步候选：T003（验签门，D1 已裁【甲】）/ T004（db 路由，**落点三选一未定**，见「T001 结论」）/
T006（沙箱锚定）/ T019–T024（002 评审移交，不依赖网关）。等「next」。
未裁定的还有任务书 Step 0.5 的 D2–D6。

## 已完成
- **T001**（2026-09-30）· 定位 `database.ts` 单例现状 + 可仿模式清单 → 产出 `refactor-targets.md`。
  要点见下「T001 结论」，**含一条影响 T004 落点的结构性发现**。
- **T002**（2026-09-30）· 目录挂载 + 受限用户权限方案 → 产出 `isolation-scheme.md`。
  要点见下「T002 结论」，**含一条阻断 T007 的未裁定问题**。

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
  **已同步 5 处**：`spec.md`（US2 引言 + 验收场景 2 + FR-006 + SC-003）、`plan.md`
  （数据流向图 + 工作空间轴 + R3）、`isolation-scheme.md` §5、`tasks.md` T002 段、本文件。

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
| A · `unbound` / `boundNode` | `packages/core/src/location.ts` + `effect/layer-node.ts` | T003 的「未填即构建失败」编译期保证 |
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
  `packages/opencode/src/server/user-identity.ts`（顶部注释）——**五处必须同改，否则自相矛盾**。

  落地分工：**T014 管「注入 + 透传」，T003 管「验签后才认」**；T003 用自造令牌即可独立测，
  真链路端到端在 T014 之后。

## 最后更新
2026-09-30（T001/T002 完成；**§5 隔离模型已裁定为【乙】**。FR-002 信任模型 2026-09-29 定稿为【甲】真做验签）
