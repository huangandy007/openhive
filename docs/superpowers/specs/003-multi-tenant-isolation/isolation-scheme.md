# T002 产出 · 目录挂载与受限用户权限方案

**Feature**: `003-multi-tenant-isolation` · **Task**: T002 [P][BE] · **日期**: 2026-09-30
**出参要求**: 「确定 `/data/{userId}/` 与 `/workspaces/{userId}/` 的目录挂载 + 受限用户权限方案」
（`tasks.md` T002），产出「方案记录在案」
**核实基点**: 分支 `worktree-feat-003-multi-tenant-isolation` @ `21d0b61b52`

> 引用源码按 `LEARNINGS #002-06` 写**符号名不写行号**。

---

## 0. 结论摘要

1. **`/workspaces` 侧 002 已经交了**——`packages/auth/src/workspace.ts` 的
   `WORKSPACE_ROOT_ENV` / `workspaceRoot()` / `createWorkspace()`（含 `../` 路径穿越校验）。
   本 task **不重复造**，只补 `/data` 侧与权限、挂载。
2. **`{userId}` = UUID**（`packages/auth/src/register.ts` 的 `crypto.randomUUID()`）
   ⇒ 可直接作目录名，天然不含分隔符。
3. **§5 是一条必须先裁定的问题（未裁定，已上报）**：design-v2 §11.6 的部署形态是
   **一个 opencode 容器**（`/assets` 共享卷 + `/workspaces`、`/data` 持久卷），
   §6 又说「共享单进程」。**一个进程 = 一个 OS 主体** ⇒
   `chmod 700 /workspaces/{userId}/` 对「用户 A vs 用户 B」**不起任何作用**。
   ⇒ FR-006 / US2 验收场景 2 / SC-003 字面要求的「被 OS 文件权限拒绝」
   **在单进程模型下不成立**。三个可选方向见 §5，**本文档不裁定**。
4. **SQLite WAL 的坑（本节是 T004/T007 的前置约束）**：`database.ts` 层里设了
   `PRAGMA journal_mode = WAL` —— WAL 会在 db 文件旁生成 **`-wal` / `-shm` 两个同目录文件**。
   ⇒ **`/data/{userId}/` 目录本身必须对运行身份可写**，
   「db 文件 0600 + 目录 0500」这种只读目录的方案**会让 SQLite 直接打不开库**。

---

## 1. 目录布局

```
/workspaces/                    ← OPENHIVE_WORKSPACE_ROOT（002 已交，默认 "/workspaces"）
  └── {userId}/                 ← 沙箱根 = 用户级物理边界（FR-005）
        └── {project}/          ← 项目 = 唯一隔离边界 + 独立 git 仓库（FR-007）
              └── ...           ← 案件子目录等，非隔离单元

/data/                          ← 【本 task 新增】OPENHIVE_DATA_ROOT，默认 "/data"
  └── {userId}/
        ├── opencode.db         ← core 数据（FR-001）
        ├── opencode.db-wal     ← WAL 自动生成，勿手动管理
        └── opencode.db-shm

/assets/                        ← 共享资产层（design-v2 §11.6，独立于用户隔离）
```

**既有资产（复用，不重造）**：

| 资产 | 位置 | 说明 |
|---|---|---|
| `WORKSPACE_ROOT_ENV = "OPENHIVE_WORKSPACE_ROOT"` | `packages/auth/src/workspace.ts` | env 常量先例 |
| `workspaceRoot(env)` | 同上 | 默认 `/workspaces` |
| `createWorkspace(root, userId)` | 同上 | `mkdir -p` 幂等 + **`../` 穿越校验**（拒绝 `/`、`\`、`.`、`..`） |
| `provisionUser()` | `packages/auth/src/register.ts` | 录入时调用 `createWorkspace`，返回 `{ id, workspace }` |

**本条新增**：`OPENHIVE_DATA_ROOT`（照 `WORKSPACE_ROOT_ENV` 先例，落点 T004，
不要在 `packages/auth` 侧加——`/data` 是内核概念，`/workspaces` 是账号概念）。

> ⚠️ `/data/{userId}/` 的创建时机：**不能只靠录入时**。002 的 `provisionUser` 建的是 `/workspaces/{userId}/`；
> `/data/{userId}/` 应当由 **T004 的 db 连接惰性打开时** `mkdir -p` 出来
> （原因：惰性打开是 FR-001 明写的语义，且历史账号没有这个目录）。见 §6。

---

## 2. 挂载方案（docker）

design-v2 §11.6 原文：「`/assets` 是共享资产层……单独挂**共享卷**，资产服务 rw + opencode ro 挂同一卷；
`/workspaces`、`/data` 为持久卷；config 用 ConfigMap/下发。」

| 卷 | 挂载点 | 类型 | 属主/权限（**待 §5 裁定后定**） |
|---|---|---|---|
| 工作区卷 | `/workspaces` | 持久卷（per-instance） | opencode 运行身份 **rw** |
| 数据卷 | `/data` | 持久卷（per-instance） | opencode 运行身份 **rw**（WAL 需要，见 §0.4） |
| 资产卷 | `/assets` | **共享卷** | 资产服务 **rw** / opencode **ro** |

**三个卷分开的理由**（照 design-v2，不是自创）：
① 分卷才能分别做配额与备份——`/workspaces` 是用户产物（大、可归档），`/data` 是 core 数据（小、必须保）；
② `/assets` 是共享资产层，**不属于任何用户**，混进 `/workspaces` 会把它拖进用户隔离语义；
③ T011 的沙箱磁盘配额与 T018 的归档/删除都只需要作用于 `/workspaces`。

> ⚠️ **`/assets` 对 opencode 是 ro**：opencode 只「被动扫描」skill 目录（design-v2 §11.6 的角色分工表），
> 写动作全部由资产服务执行。这与 §5 的权限讨论是**独立**的一件事，即便是单进程方案也应保持 ro。

---

## 3. `{userId}` 作目录名的安全性

- 来源：`packages/auth/src/register.ts` 的 `crypto.randomUUID()` ⇒ 形如 `550e8400-e29b-41d4-a716-446655440000`，
  **天然不含 `/`、`\`、`.`、`..`**。
- 002 的 `createWorkspace` **仍然二次校验**（拒绝含分隔符、`.`、`..` 的值）——理由写在它的 docstring 里：
  「F3 的中间件也会走这里，界面上守一次比在每个调用点守一次可靠」。
- ⇒ 本 task **沿用该校验**，不再另写一套。T006（锚定中间件）必须走 `createWorkspace` 或等价的校验，
  **不要自己 `join(root, userId)`**。

---

## 4. 权限方案（在 §5 裁定前能确定的部分）

以下四条**与 §5 的结论无关**，现在就能定：

| 项 | 方案 | 依据 |
|---|---|---|
| `/data/{userId}/` 目录 | 运行身份 **rw + x**（`0700`）。**不能只给文件权限**——WAL 要在同目录建 `-wal`/`-shm` | `PRAGMA journal_mode = WAL`（`database.ts`） |
| `opencode.db` 文件 | 由 SQLite 自建，**不预建、不 chmod** | 惰性打开；预建空文件会让迁移逻辑面对一个非空但无 schema 的库 |
| `/workspaces/{userId}/` | 运行身份 **rwx**（`0700`） | 用户产物读写 |
| `/assets` | opencode **只读**；写只由资产服务 | design-v2 §11.6 |

**为什么 `0700` 而不是 `0770` 或 `0755`**：最小权限原则（plan.md R3）。
但**它挡的是谁**取决于 §5 的裁定——单进程下它挡的是**容器外的其他系统用户/其他容器**，
**不挡容器内的用户 A vs 用户 B**。这一点必须说清楚，否则会误以为「已经隔离了」。

---

## 5. ⚠️ 未裁定：单进程模型下「OS 层兜底」不成立

### 5.1 证据链

| # | 事实 | 来源 |
|---|---|---|
| 1 | 部署形态 = **一个 opencode 容器**，`/workspaces`、`/data` 是它的持久卷 | design-v2 §11.6 |
| 2 | 执行模型 = **共享单进程** + 并发上限；多进程是 §6.1 的「后手」 | design-v2 §6 |
| 3 | 声称「进程以受限用户运行，文件权限只放行自己名下目录」「应用层 bug 也拦得住」 | design-v2 §2 / §5.3 |
| 4 | **实测**：`packages/core/src/cross-spawn-spawner.ts` 的 spawn 选项 = `cwd / env / stdio / detached / shell / windowsHide` —— **无 `uid` / `gid`** | 源码 |
| 5 | **实测**：`packages/opencode/Dockerfile`（上游）**无 `USER` 指令** → 以 root 运行；且它只装 CLI 二进制，不是服务镜像 | 源码 |

### 5.2 推论

**一个进程 = 一个 OS 主体。** `/workspaces/{userId}/` 下的所有目录属于**同一个 uid**；
同一个进程处理 A 的请求与处理 B 的请求，内核看到的 uid **完全相同**。
⇒ `chmod 700` 对「用户 A vs 用户 B」**零作用**。
⇒ `spec.md` 的 FR-006、US2 验收场景 2（「被 OS 文件权限拒绝」）、SC-003 字面**无法成立**。

> 这不是「配置没配好」，是**模型层面的**：单进程共享身份，OS 没有可用的区分维度。

### 5.3 三个方向（**未裁定，需你定**）

| 方向 | 做法 | 能真正做到 OS 层用户隔离吗 | 代价 |
|---|---|---|---|
| **甲 · 逐用户 uid + 子进程** | 每用户一个系统用户，工作子进程切 uid | **部分**——只对**走子进程**的执行路径有效（Bash 工具）；Read/Write/Edit 等**进程内 fs** 仍是内核 uid | ①1600 个系统用户 + uid 映射表；②`cross-spawn-spawner` 无 `uid` 选项，要动它 = **深改 core**（撞宪法 §I/§V）；③Bash 每次调用多一层 `runuser` |
| **乙 · 单进程，OS 兜底降级为「容器级」** | 承认用户间硬隔离由**独立 db + 应用层锚定**承担；`0700` 只作防「容器外」的一层 | **否** | ①需同步改 FR-006 / US2 场景 2 / SC-003 的措辞；②宪法 §III 的「MUST NOT 仅靠应用层 `if`」**仍成立**——因为 `每用户独立 db` 那半边是真正的物理隔离 |
| **丙 · 每用户一个内核进程/容器** | 内核不再单进程，一用户一进程一挂载 | **是**（挂载命名空间 + uid 双重强制） | 把 §6.1 的「后手」提前到 P0；1600 用户 × 进程的资源模型、网关用户亲和 + 进程生命周期全要做；process-local 组件（`LayerMap` / watcher / 缓存）行为需重验 |

### 5.4 我的建议（供参考，**不是拍板**）

**本轮走乙**，理由三条：
1. **真正的物理隔离已经在了**——`每用户独立 db` 是文件级隔离，不是 `if` 判断。
   §III 禁的是「**仅**靠应用层」，有独立 db 在就不构成「仅」。
2. **甲是「部分有效 + 高代价 + 撞宪法 §I」的组合**：它挡不住进程内 fs 那条路，
   而那条路恰恰是 AI 读写文件的主路径（Read/Write/Edit 工具）。
   「看起来像隔离、实际不是」比没有更危险——同 002 那个具名门被裁定取代的理由。
3. **丙才是正解，但它正是 design-v2 §6.1 明确推迟的事**，且触发条件（并发压测结果）还没测。

⇒ 走乙时，本 feature 需要**同步修改**三处措辞：`spec.md` FR-006、US2 验收场景 2、SC-003
（把「OS 文件权限拒绝」改为「应用层锚定 + 独立 db 承担，`0700` 作容器外防护」），
并**在 PLAN/设计文档里记下丙是真正的答案、触发条件是什么**——免得将来当成新问题重新发现。

---

## 6. 对后续 task 的输入

| Task | 本 task 给它什么 |
|---|---|
| **T004** | ①`/data/{userId}/opencode.db` 的路径 = `join(OPENHIVE_DATA_ROOT, userId, "opencode.db")`；②**目录惰性 `mkdir -p`**（历史账号没有该目录）；③**WAL 需要目录可写**，建目录时就要给写权限 |
| **T006** | 锚定必须走 `createWorkspace` 的**同一套校验**（或等价），别自己 `join` |
| **T007** | 权限方案 = §4 四条 + **§5 裁定后的结论**；§5 未定前**不要动** |
| **T011** | 磁盘配额只能作用于 `/workspaces`（`/data` 是 core 数据，配额打它会把用户锁死在开不了库） |
| **T013** | 隔离测试的目录侧断言以 §5 结论为准：走乙时「A 读不到 B」由**应用层锚定**保证，测试须**如实这样写**，不能假装是 OS 拦的 |
| **T018** | 归档/删除只作用 `/workspaces/{userId}/`；`/data/{userId}/` 的处置（账号停用后 db 留不留）本 feature 不含，记为下游 |

---

## 7. 待办（写进 state.md）

- **§5 需用户裁定（甲/乙/丙）**。裁定前 T007 不能开工；T004/T006 不受阻。
- `OPENHIVE_DATA_ROOT` 常量落点 = T004（不在 `packages/auth`）。
- `/data/{userId}/` 的创建时机 = T004 连接惰性打开处（不是 002 的 `provisionUser`）。
