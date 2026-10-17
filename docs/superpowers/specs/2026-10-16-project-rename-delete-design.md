# 项目重命名与删除设计

- **日期**：2026-10-16
- **分支**：`multi-tenant`
- **性质**：本仓定制（openhive），提交信息须标注「这是要保留的定制」
- **上游约束**：改动落在 fork 自己的文件里（`packages/opencode/src/server/openhive/**`、`packages/app/src/project/**`、`packages/auth/src/project-member.ts`），**不碰** `packages/ui` 与 `packages/session-ui` 的上游源码。**入侵方式是「加」不是「改」**：新增出口与服务函数，不修改上游 `Project.update` 的语义
- **来由**：2026-10-16 用户提出——「项目管理只有新增，没有重命名、删除功能，要加上这两个」

---

## 1. 背景与目标

今天「项目」有五个动作：**建、列、切换、归档/找回、成员管理**（邀请 / 移除 / 退出）。**没有重命名、没有删除。**

一句话目标：**给项目补上「改名」和「删除」两个动作**，其中删除是系统里**第一个不可恢复的动作**，必须跟可恢复的「归档」在界面上分得开。

### 用户逐条谈定的裁决（2026-10-16，全部为本轮问答原话）

| # | 问题 | 裁决 |
|---|---|---|
| 1 | 删除的语义 | **归档（可找回）＋ 删除（找不回）并存**，界面上长得明显不同 |
| 2 | 删除的深度 | **只删项目、聊天记录留着**（软删除） |
| 3 | 留档的出口 | **不要入口，纯留底** |
| 4 | 共享项目谁删 | **只有创建人能删**；成员用「退出」 |
| 5 | 入口位置 | 项目行悬停出的 **「⋯」菜单** |
| 6 | 确认强度 | **普通确认框** |
| 7 | 确认框措辞 | **不提聊天记录**，只说文件会删、找不回 |
| 8 | 设计整体的形状 | 「四节都行」→ 即 §3–§6 的架构 |

**本轮由实施方代定的两条**（用户未反对，附理由，可推翻）：① 删除时**盘上目录也删掉**（不删的话跟归档无区别）；② 改名**也只有创建人**能做（共享项目的名字是所有人共用的那一份）。

## 2. 范围

### v1 做

- **改名**：项目行 ⋯ → 改名 → 名字那格就地变输入框 → 回车提交 → **自己那份与公共库那份两处一起写**
- **删除**：项目行 ⋯ → 删除 → 普通确认框 → 执行 → 项目从所有清单消失、盘上目录删掉、**会话与聊天记录留底**
- 已归档的项目**也能删除**（连 MinIO 备份一起清）
- 两项都**只有创建人**能做；非创建人 ⇒ 403
- 删除**可重入**（再点一次接着清，不报错）

### v1 不做

- **不给「已删除项目」的界面入口**（用户裁决 3）——聊天记录留在库里，界面上看不见
- **不做个人别名**（成员不能给共享项目起自己的名字）
- **不动项目面板现有的「新建」输入行**（它是手写的原生 input；按「没坏就别动」不在本轮统一）
- **不做右键菜单**（本仓无先例，`project-panel.tsx:1098-1099` 有注释明写不做）
- **不做批量删除**、**不做撤销 / 回收站**

## 3. 原则与落点

| 干什么 | 入口 | 形状 | 结果 |
|---|---|---|---|
| **改名** | 项目行悬停「⋯」→ 改名 | 名字那格就地变输入框，回车提交、Esc 取消 | 名字两处一起写 |
| **删除** | 项目行悬停「⋯」→ 删除 | 普通确认框 → 执行 | 项目从清单消失、目录删掉、**聊天记录留底** |

**两条贯穿的原则：**

1. **不可恢复的动作必须跟可恢复的动作长得不一样。** 归档今天在行上是一颗常显钮、删除在 ⋯ 里 —— 形态不同是刻意的，不是布局巧合。
2. **只碰该碰的。** 改名不顺手统一输入行写法；删除不顺手把会话行也清掉（那是被明确否决的）。

## 4. 事实底账（实施前已核实，逐条带证据）

### 4.1 名字存在两处——这是本轮最大的雷

| 谁 | 名字写在哪 | 名字从哪读 |
|---|---|---|
| **自己建的项目** | ① 每用户 SQLite 的 `project.name`：建项目第 ⑤ 步 `deps.project.update({projectID, name})`（`packages/opencode/src/server/openhive/project.ts:467`），落库 `packages/opencode/src/project/project.ts:349`；表定义 `packages/core/src/project/sql.ts:10`<br>② PG `auth.project_meta.name`：建项目第 ⑦b 步 `recordProject`（调用点 `project.ts:495-497`），实现 `packages/auth/src/project-member.ts:383-388`（**纯 `insert`**）；表定义 `packages/auth/src/project-member.ts:89-94`，迁移 `packages/auth/src/migrations/0006_project_meta.sql:50-54` | 清单里 **owner 那一行**读**本地**：`project.ts:354`（`named.get(...)?.name ?? ""`） |
| **被邀加入的成员** | 本地**没有**这一行（`project.ts:390` 注释明写「自己库那边必然没有，所以实际取 PG」；`packages/core/src/project/ext.ts:179` 注释「成员没有 `project_ext` 行」） | 清单里 **影子行**读 **PG**：`project.ts:391`（`named ?? meta ?? ""`），`meta` 来自 `projectMetaOf`（`project.ts:332` → `packages/auth/src/project-member.ts:441-457`） |

**推论（本条是设计的根据）**：一个「自己建的共享项目」，名字**两处都有**，而 owner 读本地那份、成员读 PG 那份 ⇒ **改名必须两处一起写**。只写一处就会出现「我改了，同事看到的还是旧的」。

**今天缺的那一半**：全仓 `project_meta` 的写入点**只有建项目时的那个 `insert`**，**没有 update / upsert**（grep 全仓，`project-member.ts:384-387` 是唯一写入）。0006 迁移文件的文件头自述「今天**没有**『重新写名字』的出口」（`0006_project_meta.sql:47`）。

**上游那条现成接口不能用**：`PATCH /project/:projectID` → `Project.update`（`packages/opencode/src/project/project.ts:345-364`，HTTP 出口 `.../httpapi/groups/project.ts:52-60`）只 `update(ProjectTable)`，**一个字都不碰 `project_meta`**。前端已有调用（`packages/app/src/pages/layout.tsx:1284-1304`）——那套只服务于上游 project，本设计不接它。

### 4.2 删除牵连的七处

| # | 牵连 | 位置 | 证据 |
|---|---|---|---|
| 1 | 项目目录（`.git`、用户文件、上传文件） | `<根>/<userId>/<projectId>/` | `packages/auth/src/workspace.ts:108-110` |
| 2 | **共享仓库**（共享项目才有） | `/shared/<projectId>.git` | `project.ts:471-480`。⚠️ **归档不动它**（`archive.ts:88`） |
| 3 | 会话 / 消息 / 待办 | 每个成员各自的 `data/<userId>/opencode.db` | `packages/core/src/session/sql.ts:22-176` |
| 4 | `project_directory` 行 | 每用户库 | `packages/core/src/project/sql.ts:20-35` |
| 5 | `project_ext` 行 | 每用户库 | `packages/core/src/project/ext.ts:64-70` |
| 6 | **PG 三表**：成员关系 / 归档标记 / 共享名字 | 公共库 | `0005_project_member.sql:45-51,64-69`、`0006_project_meta.sql:50-54`。⚠️ **跨库、无外键**（`0005:33-37`、`0006:24-27`），**必须手工删** |
| 7 | 快照 / worktree 临时目录 / MinIO 备份 | 全局数据目录、对象存储 | `packages/opencode/src/snapshot/index.ts:71`、`packages/opencode/src/worktree/index.ts:208`、`packages/core/src/minio.ts:33,131` |

现成的「一个 project id 牵连哪些表」官方清单在上游的项目 id 迁移函数里：`packages/opencode/src/project/project.ts:146-193`（它同时改 `project` 行、`project_directory`、`session.project_id`、`workspace.project_id`）。

### 4.3 「留底」在技术上站得住——读会话不依赖项目目录

**已实测判定（不是推断）**：本部署是 v1 协议（`packages/app/src/utils/server-protocol.ts:24-35`），app 走 A 链 `/session...`；该链的中间件只有 `InstanceContextMiddleware + WorkspaceRoutingMiddleware + Authorization`（`.../httpapi/groups/session.ts:491-493`），读 handler（list / get / messages / message，`.../httpapi/handlers/session.ts:71-160`）**只查数据库**；实例 boot（`packages/opencode/src/project/instance-store.ts:45-63,108-124`）与 bootstrap（`packages/opencode/src/project/bootstrap.ts:32-46`）对缺失目录**容错**；**全程不构造该目录的 location 服务** ⇒ 不会触发 `packages/core/src/filesystem.ts:65` 的 `realPath(...).orDie`。

⇒ **目录删掉后，会话列表 / 会话详情 / 消息列表 / 消息内容都读得出来。**

**会炸的只有三条**（记下来，别混）：① **发消息**（`prompt_async` → `packages/core/src/session/execution/local.ts:21` 的 `locations.get`）；② 文件 / pty 端点；③ **B 链** `/api/session/...`（`packages/server/src/middleware/session-location.ts:56`）。这三条**不在「读会话」这条路上**。

### 4.4 光删目录不会让项目从清单消失（决定了删除的实现方式）

`handleList`（`project.ts:309`）**不 stat 目录**（`:369` 只是 `projectDirectory(...)` 纯拼接）⇒ 单纯删掉盘上目录，项目**仍然挂在清单里**——那就是 2026-10-16 早上那个**僵尸状态**（项目在列表、点开 500）。

**左栏「会话」列表的过滤发生在客户端的「项目清单」这一层**，不在会话行上：目录来源只有一处 `const 目录 = createMemo(() => 当前项目目录(currentProject()?.id, projectList()))`（`packages/app/src/ai-session/sidebar-sessions.tsx:86`），而 `当前项目目录`（`packages/app/src/ai-session/session-actions.ts:247-255`）在**行不存在**或**已归档**时返回 `undefined` ⇒ 该项目的会话不显示。**会话行本身原样留在 DB**。

⇒ **这正好就是「纯留底」要的形状**：项目一从清单里拿掉，那些会话在界面上自然就没有落脚点了。

## 5. 方案：两条路，取 A

### 路 A「拿掉登记」（**采用**）

清掉「**我的项目登记行 ＋ 公共库里的成员关系 ＋ 盘上目录**」。项目从此不在任何清单里；会话行原样留着。

- 复用现有机制（**归档也是「从清单里消失」那一路**：`session-actions.ts:253` 对已归档返回 `undefined`），**不引入新概念**
- 干净、彻底、不可逆 —— 正合裁决 1（找不回）
- 代价：系统里不留「这个项目曾经存在过」的痕迹（除服务器日志）

### 路 B「打标记」（**不采用**）

给项目加「已删除」标记，让所有列清单的地方忽略它。

- 好处：留痕（谁、何时删的）
- 否决理由：**每个列清单的地方都要认这个新标记**——今天至少四处（项目面板 / 左栏会话 / 顶部锚点行 / 共享同事那份清单），**漏一处就出现「删了还在」的怪象，且不报错**。这正是本项目反复踩过的那类坑（同一个判断散在多处，`#002-06` / `#004-02`）

### 路 C「删项目行」（**排除**）

数据库规定 `session.project_id` 是 `NOT NULL` ＋ `ON DELETE CASCADE`（`packages/core/src/session/sql.ts:26-29`）⇒ **删项目行 = 会话必删**，与裁决 2 正面冲突，直接排除。

**⚠️ 由此得出一条必须写死在代码注释里的禁令**：删除**绝不能**删每用户库里的 `project` 行（`ProjectTable`），否则会话会被数据库连带删掉。**留它与留底是一回事。**

## 6. 删除：清哪几处、顺序、可重入

按路 A，一次清这几样：

| 序 | 清什么 | 备注 |
|---|---|---|
| ① | **公共库里的成员关系**（`project_member`，**所有成员的**，不只发起人） | ⚠️ **不能忘**：只删自己的登记、留着成员关系的话，项目会从「我的项目」**降级成影子行**继续挂在列表上（影子行由 `memberships` 产出，`project.ts:317-320`）。**必须两样一起删** |
| ② | **公共库里的归档标记 / 共享名字**（`project_archive` / `project_meta`） | 跨库无外键，手工删 |
| ③ | **我自己的项目登记行**（`project_ext`） | `handleList` 的 `ProjectExtTable` 那一支（`project.ts:309-320`） |
| ④ | **盘上的项目目录** ＋ 共享项目的 **bare 仓库** | bare 仓库归档都不动它，删除必须专门处理（`archive.ts:88` 是反例） |
| ⑤ | **MinIO 里的归档备份**（`<userId>/<projectId>/`） | 只在项目**已归档**时存在；理由见 §7「已归档也能删」 |
| ⑥ | **快照 / worktree 等按项目 id 分的残留目录** | `snapshot/index.ts:71`、`worktree/index.ts:208` |
| ⑦ | **每用户库的 `project_directory` 行** | 已核实（2026-10-17）无别的读取者按「项目存在与否」依赖它，见下方 |

**顺序**（2026-10-17 终审对账，以计划裁定 R2 的实现为准；表里 ①–⑦ 是**清点编号**，不是执行序）：

```
读成员名单 → ⑤ MinIO 备份 → ④ 盘（沙箱＋bare）→ ⑥ 残留 → ③＋⑦ 自己的账 → ①＋② 成员与册页
```

**为什么不是「先摘账、后删盘」**：⑤ 要按 `project_member` 逐个成员清前缀；若按原序把 ① 排在它前面，第一次调用删完成员关系之后，**第二次调用（可重入）就建不出「哪些人的前缀要清」** ⇒ 备份成永久孤儿、⑤ 的可重入当场失效。spec §6 自己要求「可重入」，原序自相矛盾（`LEARNINGS #007-01`）。

**R2 换序的代价（如实记账，见 §11 缺口 19）**：盘在 ⑤/④/⑥ 已经**不可逆删除**，之后 ③/⑦/①/② 任一失败 ⇒ 接口 500、用户看到「删除失败」但文件已经没了；① 成功而 ② 失败 ⇒ 项目已从所有人清单消失、界面上没有入口重试。两段都只能直打 HTTP 收敛。

**可重入**：每一处都**容忍「已经不在了」**（文件不存在、行不存在都不报错），再点一次接着清。

**⚠️ 明确不动**：会话与聊天记录（裁决 2）、每用户库的 `project` 行（§5 路 C 的那条禁令）。

**已核实（2026-10-17 实施时）**：
- ✅ MinIO 删除对象的能力**已有**：`Minio.Interface.delete({path})`（`packages/core/src/minio.ts`）
  ⇒ 删除备份 = 按成员 scope `list()` ＋ 逐键 `delete`（不是整桶清空）。
- ✅ `project_directory` 行**没有别的读取者按「项目存在与否」依赖它**（⑥ 步清点见 Task 3 Step 7）
  ⇒ 删除它是安全的。

## 7. 权限与确认

| 动作 | 谁能做 | 判定依据 | 确认 |
|---|---|---|---|
| 改名 | **只有创建人** | 见下 | 无（就地改、回车即走） |
| 删除 | **只有创建人** | 同上 | 普通确认框 |
| 成员想走 | 用现成的 `leave` | — | 已有 |

**判定复用现成件**：`project_member.role` 取值 `owner` / `member`（列定义 `packages/auth/src/project-member.ts:57`，闭集 CHECK `0005_project_member.sql:48`，「项目至多一个 owner」由部分唯一索引 `project_member_single_owner` 钉住 `:62`）；判定走纯函数 `ProjectMembership.decide`（`packages/core/src/project/membership.ts:127-131`，规则表 `:106-118`）——**归档今天已经只认 owner（`:114`），删除照抄这条规则**，不新造。

**改名限创建人的理由**：共享项目的名字是**所有人共用的那一份**（写 PG `project_meta`，§4.1），成员随手改会让别人莫名其妙。代价：成员没有个人别名（v1 不做）。

**已归档的项目也能删除**，删的时候**把 MinIO 备份一起清掉**。理由：不这样的话，「删除找不回」这个承诺在已归档项目上**不成立**（备份还在 = 还能找回）。⚠️ 归档行今天摆着「找回」钮，会变成「找回 ｜ ⋯」并存，**如实记入本文件**。

## 8. 界面与措辞

**⋯ 菜单**：鼠标移到项目行上出现；**键盘聚焦时也出现**（`focus-within`，不做成鼠标专属，见 §11 取舍 1）。两项：**「改名」「删除」**。做法可参照上游主页项目行（`packages/app/src/pages/home/home-projects-view.tsx:481-524` 的 `MenuV2`，`:488-495` 的悬停 IconButton）与上游左栏磁贴（`packages/app/src/pages/layout/sidebar-project.tsx:89-184`）。

**就地改名**：复用 `packages/app/src/components/inline-rename-input.tsx`——props 为 `槽位 / 可访问名称 / 占位? / 原名? / on提交 / on取消`（`:65-83`），`on提交: (新名: string) => void`（`:80`）。空名字 / 未改动 ⇒ 当取消（`改名草稿` `:99-103` 的判据）。**复用它是刻意的**：它带着「一次编辑只结一次账」那条**真栈实测**出来的守卫。

**删除确认框**（照现有 `ProjectActionDialog` 的样子，`packages/app/src/project/project-action-dialog.tsx:94`，文案表 `:76-92`）：
```
确定删除「甲项目」？
项目里的文件会一并删掉，删了找不回来。
                    [取消]  [删除]
```
**不提聊天记录**（裁决 7）。这句话**不是假话**——它只讲文件，没有声称「所有数据都没了」；但**它是省略**，所以「聊天记录仍在库里」这件事**必须对管理员写清楚**（写进本 spec §11 与运维文档）。

## 9. 落点清单（文件级）

| 文件 | 改什么 |
|---|---|
| `packages/auth/src/project-member.ts` | **新增**「改写 `project_meta.name`」的函数（今天是纯 insert，无 update）。可与 `recordProject:383` 并排，命名沿用同族风格 |
| `packages/opencode/src/server/openhive/project.ts` | ① **新增两条路由**：改名、删除（`PATH` `:144-148` / 路由注册 `:216-218` 各加一条），复用 `membershipsOf` / `removeMember` / `rolesOf` / `markArchived` 一族与 `ProjectMembership.decide` ② 改名处理器：**两处一起写**（本地 `project.name` ＋ PG `project_meta.name`），并写死「必须两处」的注释 ③ 删除处理器：按 §6 的①–⑦，可重入；写死「不能删 `ProjectTable` 行」的注释 |
| `packages/app/src/project/project-data.ts` | `ProjectData` 接口（`:55`）**新增两条**：改名、删除；`PROJECT_DATA` 常量（`:135-153`）补实现 |
| `packages/app/src/project/openhive-project.ts` | 两个新客户端函数（同族 `NewProjectInput:52`） |
| `packages/app/src/project/project-panel.tsx` | ① `ProjectPanelProps`（`:164`）新增 `onRename` / `onDelete` ② 项目行加 ⋯ 菜单 ③ 就地改名接 `inline-rename-input` ④ 删除走确认框 |
| `packages/app/src/workspace/workspace-entry.tsx` | 接线：`onRename` / `onDelete`（同族 `onCreate` `:916-937`），成功后重取清单 |
| `packages/app/src/pages/layout-new.tsx` | **不改**（`projectData` 注入在 `:131`，接口扩了它自动带上） |

**明确不改**：`packages/app/src/components/inline-rename-input.tsx`（复用，不改）、项目面板现有「新建」输入行（§2）、上游 `Project.update` 与 `PATCH /project/:id`（不接）。

## 10. 测试与完成判据

### 要钉的判据（每条都要走红→绿，不许口头声称）

**后端**
1. 改名后**两处名字都变了**（本地 `project.name` ＋ PG `project_meta.name`）——**本轮最该钉死的一条**
2. 改名后**被邀成员那一侧读到的也是新名字**（钉住「两处一起写」的**效果**，不只钉写入动作）
3. 删除后项目**从清单消失**（`handleList` 不再返回它）
4. 删除后**会话行仍在数据库里**，且**读得出来**（钉住「留底」是真留底）
5. 非创建人调改名 / 删除 ⇒ **403**
6. 删除**再点一次不报错**（可重入）
7. 删除后**共享仓库 / 盘上目录确实没了**

**前端**
8. ⋯ 菜单：悬停出现、键盘聚焦也出现
9. 就地改名：回车提交调对了回调；Esc / 空名字 ⇒ 不提交
10. 确认框：取消 ⇒ 一个请求都不发
11. 删除成功后项目从列表消失、并重取清单

**真栈**
12. 建项目 → 改名 → 两处都对 → 删除 → 列表里没了、**直接读会话读得出来**（钉住 §4.3 的结论，别只信代码分析）

### 完成判据（命令 ＋ 实得输出）

- `packages/app`、`packages/opencode`、`packages/auth` 三个包各自 `bun test` 全绿，**用例数不低于开工前实测的基线**（开工第一步先量基线并记下）
- 三个包各自的 typecheck
- 仓库根 `bunx oxlint <改动目录>`（根 `bun run lint` 天生红，`#001-02`）
- 真栈跑 §10 第 12 条

### 变异验证（`#003-03` 三类据实记）

- 拆掉「写第二处名字」那一行 ⇒ 判据 1 或 2 **必须红**；不红 ⇒ 那条用例是空转
- 拆掉「删成员关系」那一步 ⇒ 判据 3 **必须红**（项目会以影子行身份留在清单里）
- 拆掉「可重入」的容错 ⇒ 判据 6 **必须红**

### 十二条判据对账（2026-10-17 收尾）

| # | 判据 | 钉它的用例 | 实得 |
|---|---|---|---|
| 1 | 改名后两处名字都变了 | `openhive-project-rename.test.ts` 第一条 | 绿（Task 4）。本地名经公开 list 出口、PG 名直打 `pg.db`（Task 4 评审） |
| 2 | 改名后被邀成员读到的也是新名 | 同上第二条 | 绿（Task 4）。成员侧经 BOB 身份读、带旧名前置（Task 4 评审） |
| 3 | 删除后项目从清单消失 | `openhive-project-delete.test.ts` 第一条 ② | 绿（Task 5）。变异 A 拆 `removeAllMembers` 恰红在此 |
| 4 | 删除后会话行仍在且读得出来 | 同上 ⑥ | 绿（Task 5）。`GET /session/:sessionID/message` 仍 200（R16） |
| 5 | 非创建人 ⇒ 403 | 两个路由文件各一条 | 绿（Task 4 改名 403 ＋ Task 5 删除 403，删除为三面零副作用） |
| 6 | 删除再点一次不报错 | 同上第二条 | 绿（Task 5，R14 授权门） |
| 7 | 删除后共享仓库 / 盘上目录确实没了 | 同上 ③ | 绿（Task 5，A 用例建 shared 类型） |
| 8 | ⋯ 菜单：悬停出现、键盘聚焦也出现 | 组件层只钉「在不在」；真栈只有「`hover()` → 点 ⋯」这条**操作路径**，**没有可见性断言** | 见下方逐字说明（两半目前都无判据） |
| 9 | 就地改名：回车提交 / Esc / 空名字不提交 | `project-panel.test.tsx` 那组 | 绿（Task 7；变异 C 红 2、F2 裸 input 红 3） |
| 10 | 确认框取消 ⇒ 一个请求都不发 | 同上 | 绿（Task 7） |
| 11 | 删除成功后项目从列表消失、并重取清单 | 真栈（Task 9）＋ `workspace-entry` 接线 | 见下方逐字说明 |
| 12 | 真栈：建 → 改名 → 两处都对 → 删除 → 会话读得出来 | `project-rename-delete-real.spec.ts` | 绿（Task 9，`1 passed (46.3s)`；PG 那份真栈读不到） |

**判据 8 覆盖程度（逐字）**：组件层只钉「菜单项在不在」（`project-panel.test.tsx` 的存在性断言，happy-dom 无 CSS 引擎量不出可见性，#005-07）；真栈（Task 9）只走了「`行.hover()` → 点 ⋯」这条**操作路径**（`project-rename-delete-real.spec.ts:146,184`），**没有**断悬停前后的可见性 / opacity；而 `hover-reveal` 只是 `opacity-0`（`packages/ui/src/styles/tailwind/utilities.css:11-17`，**无** `pointer-events: none`），Playwright 视 `opacity:0` 为可见可点 ⇒ 拆掉「悬停出现」，那条真栈用例**仍会绿**。⇒「悬停出现」与「键盘 `focus-within` 出现」**两半目前都没有判据**——见 §11 缺口 14。

**判据 11 覆盖程度（逐字）**：真栈覆盖（Task 9 判据 12 的「面板消失」＋「服务端清单消失」两个独立观测）；组件层 `workspace-entry` 的接线**已有两条用例**（Task 8 修复轮补的「改名当前项目 ⇒ 锚点变新名」＋「删除当前项目 ⇒ 锚点变未选择项目」），但「清单重拉」本身仍由真栈那条钉——组件层没有独立的「重取清单」判据。

## 11. 取舍与缺口（不藏着）

1. **悬停「⋯」不摸到就不出现**——触屏和不太用电脑的人可能发现不了（用户裁决 5）。缓解：**键盘聚焦时也出现**。**这是本次最可能被用户抱怨的一条。**
2. **普通确认框：手滑即可删、且不可恢复**（用户裁决 6）。将来真出事，**这是第一个该加强的地方**（改「手敲项目名」或「等五秒」）。
3. **「纯留底」的诚实性**：用户会以为删干净了，**其实聊天记录还在库里**（用户裁决 2＋3＋7）。它只对管理员可见、只对管理员说清。**涉密场景下这一点须由管理员知悉**——本 spec 在此明写，运维文档须同步。
4. **改名限创建人**：实施方代定（用户未反对）。
5. **删除时盘上目录也删**：实施方代定（用户未反对）。
6. **项目面板暂时并存两套输入行写法**（「新建」是手写的原生 input，改名用通用件）——按「没坏就别动」不在本轮统一。
7. **已核实（原「待实施时核实」，2026-10-17）**（§6 末）：MinIO 有现成删除函数（`Minio.Interface.delete`）；`project_directory` 行无别的按「项目存在与否」依赖它的读取者。
8. **要真跑才知道的**：快照 / worktree 残留目录删掉之后会不会影响执行——在真栈上量；**量不出来就如实写缺口，不写成已覆盖**。
9. **本轮不覆盖**：批量删除、撤销 / 回收站、个人别名、成员自助删除。
10. **`updateProjectName` 命中 0 行时静默成功**（R4）：调用方分辨不出「改了」与「本来就没有」。
    真要防它得数返回行数，而那条形状在 PGlite 与生产 bun-sql 下是否一致**没验过**（#002-01）。
11. **改名的写入次序（PG 先、本地后）在成功路径上不可观测**：拆掉／调换它，用例全绿
    （Task 4 Step 5 变异 B 实测）。那条次序的保证是**论证**（拒绝时两处一致），不是测试。
12. **`dropResidue` 的 worktree 那一半没有守护者**：造一个 worktree 残留要真跑一次 worktree
    流程，成本与本 feature 不成比例（Task 5 Step 6 变异 D 实测：只删 snapshot 也全绿）。
13. **真栈验不到 PG 那份名字**（Task 9 Step 4）：真栈挂具跑 PGlite 内存实例、前端没有直接读
    `auth.project_meta` 的出口 ⇒ 界面上看到的新名字只证明**本地**那份变了（owner 读本地）；
    PG 那份由 Task 4 的路由测试直打 `pg.db` 钉着，真栈这一层**没有**通往它的观测点
    （挂具里也读不到那次请求实际落库的值）。**危险在哪**：`updateProjectName` 若在真栈的 PG 上
    静默失败（例如命中 0 行，见缺口 10），界面与真栈**都看不出来**，直到某个成员打开清单读到旧名。
14. **判据 8 的「悬停出现」与「键盘 `focus-within` 出现」两半都没有判据**：组件层只能钉「菜单项
    在不在」（happy-dom 没有 CSS 引擎、量不出可见性，#005-07）；真栈只走了「`hover()` → 点 ⋯」的
    **操作路径**、**没有**断悬停前后的可见性。**为什么测不了**：要断「悬停前不可见、悬停后可见」
    得量计算样式（`opacity`）及其 hover 前后变化，happy-dom 无排版/样式引擎；真栈虽在浏览器里，
    但现有用例没写这条断言，且 `hover-reveal` 只是 `opacity-0`、**没有** `pointer-events: none`
    （`packages/ui/src/styles/tailwind/utilities.css:11-17`）⇒ Playwright 把 `opacity:0` 当可见可点，
    即便补一句「点得动」也证明不了可见性。**危险在哪**：`opacity:0` 在 Playwright 里仍可点 ⇒
    悬停可见性**坏掉不会被任何现有用例发现**（这正是 `#005-47` 型的空转：断言看似在测这件事，
    实际被默认行为满足）。
15. **删除的「可重入」在真栈上只做了「一次删除动作」**（含 win32 `EBUSY` 的有限重试，
    `project-rename-delete-real.spec.ts:183-201`），没有「删除成功后再删一次」的可重入判据；
    第二次调用只在路由测试里钉（Task 5 用例第二条）。**为什么测不了**：真栈那 3 次循环是**同一动作
    的重试**（失败才重试、成功即 break），不是两次独立删除；要在真栈上再删一次得先让第一次成功、
    再对已消失的行发起删除——行已不在面板上，入口无从点起（只能直打 HTTP，那已出界面射程）。
    **危险在哪**：真栈上的可重入只在路由层被证明，界面层若在删除后对已消失项目做重试
    （例如 `EBUSY` 重试恰好落在「第一次其实已成功」之后），没有真栈判据兜住。
16. **spec §11 取舍 1 那条**（悬停「⋯」不摸到就不出现）**是设计接受的缺口**，不是本轮能修的
    ——缓解只有键盘聚焦也出现，而那需要浏览器真的用 Tab 走一遍（真栈未做）。
17. **spec §11 取舍 8「删掉快照 / worktree 残留之后会不会影响执行」本轮没量出来**：真栈 spec
    （Task 9）**没有造过任何快照或 worktree 残留** ⇒ `dropResidue` 在那条链上**删的是空**
    （目录本来就不存在），「删了它会不会影响后续执行」这件事**一次都没被观测到**。
    **为什么测不了**：要观测它得先在真栈上真跑一次产生快照 / worktree 的流程（改一次文件、
    进一次 worktree），再删项目、再验证后续操作不受影响——成本与本 feature 不成比例。
    **危险在哪**：`dropResidue` 删的是 `join(Global.Path.data, "snapshot"|"worktree", projectId)`
    ——那是**全局数据目录**下的路径，删错一层就是别人的数据。当前它只靠
    「路径由 `projectId` 拼成」这一条**论证**保着，没有实测（同 `#002-02` 的取向：
    没测到的写成缺口，不写成没问题）。
18. **opencode 门禁的 14 条基线失败名单是「取数当时」的快照，成员可能随环境更替**：那 14 条是
    flaky / 环境基线（联网读 registry、30s 超时、win32 路径归一化等），不是「永远红的固定集合」。
    本轮 Task 10 的门禁在与 Task 5 **相同的代码**上实得 **15 条**——多出的
    `test/server/httpapi-sdk.test.ts`（`HttpApi SDK > routes configured SDK directory and workspace for v2 location GETs`，
    实得 `SDK file search index was not ready`，出自 `test/lib/effect.ts:173-175` 的
    `Effect.timeoutOrElse` 轮询超时、**非断言失败**）是一条 **pass→fail 翻转**。证据：
    ① `gate-opencode-task5.txt` 同代码实得 `4010 pass / 58 skip / 1 todo / 14 fail`（该条为绿）；
    ② `bc01eb25cf..HEAD` 对 `packages/opencode` **零改动**；③ 该测试文件自基线 `2d13554cab` 起
    **零改动**；④ 总用例仍 **4083**（只是 pass→fail 翻转，没有用例被吞，排除 `#005-31` / `#004-06`）。
    **为什么没做定向复跑**：R6 只禁「全量重跑捞失败名」，单文件复跑本可行，本轮**未做** ⇒
    定性为**高置信推断**而非实测复现。**危险在哪**：真正的回归可能被误当成本条 flaky 而漏看
    ⇒ 判据只能是「下次门禁逐条对名单」，不能只看计数。
19. **删除中途失败 ⇒ 重试收敛没有用例**（2026-10-17 终审补充）：R2 先删盘后摘账，
    ③/⑦/①/② 任一失败会 500 而盘已删；① 成功而 ② 失败后项目已从所有人清单消失、
    界面无重试入口。**为什么测不了**：路由测试跑真 PGlite，没有「在指定步骤注入失败」的接缝；
    造接缝的改动面大于本 feature。**危险在哪**：用户看到「删除失败」但文件已不可逆删除；
    或残留 `project_archive` / `project_meta` 只能直打 HTTP 清。
20. **已退出 / 被移除成员的 MinIO 备份不在 ⑤ 的覆盖范围**：`dropBackups` 只遍历当前
    `project_member`；`member.ts` 的移除 / 退出不清 MinIO ⇒ 归档后成员退出、项目再被删，
    该成员前缀下的备份**永久保留**。根因在 005 的成员移除路径，本 feature 只登记不修。
    **危险在哪**：涉密备份留存与存储泄漏。
21. **`project_directory` 只清发起者那一份**：分库路由让查询落在请求者库，共享项目其他成员
    库里的行会残留。**为什么没修**：要逐成员开库（`DatabaseRouter`）成本与本 feature 不成比例；
    且已核实没有读取者按「项目存在与否」依赖它。**危险在哪**：孤儿行；`layouts.tsx:1181`
    一类读者可能为已删项目拿到旧路径。
22. **MinIO 未配置支路（`archive.ts:538` 直接返回）没有用例**：删除不因 MinIO 没配而不可用
    这条语义只靠读码保证。**危险在哪**：将来有人把这里改成 503，删除在无 MinIO 部署上
    整体不可用，而无判据会红。
23. **spec §11 取舍 3 要求「运维文档须同步：聊天记录仍留底」，仓库里找不到该文档，本轮也未改**。
    **危险在哪**：运维 / 用户仍以为删除会清聊天记录。登记为待办。
24. **组件层没有两条用例**（2026-10-17 终审补充）：「改名 / 删除失败 ⇒ 面板显示服务端那句话」
    与「删除**非当前项目** ⇒ 锚点保持不变」（变异下会全绿）。**危险在哪**：失败文案与锚点
    副作用可能被后续改动弄坏而无声。

## 12. 与其它文件的关系

- 本设计**独立于** `2026-10-16-file-op-failure-in-place-design.md`（那份管**文件级**失败提示的落点，这份管**项目级**的改名与删除）。两者**不合并提交**。
- `project-data.ts` 的接口本次扩两条（§9），那份 spec 明确写了「`project-data.ts` 一行不改」——**那是针对那份 spec 的射程说的**，两份改动各自独立提交，不冲突。
