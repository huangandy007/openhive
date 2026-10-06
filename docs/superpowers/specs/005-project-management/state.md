# 实施进度 · 项目管理（工作空间轴）

## 当前任务
T001（定位）已完成（清单见「已完成」）。**三批开工前裁定全部落定**（U1 / U4 / U5 ＋ D0-1 / D0-2(b) / D0-4 / ⑤ / U8 ＋ Q1–Q4），见下方三张表。**T002（MinIO 目录/权限方案）的输入已齐**（Q1 定路径带 userId、Q4 定权限下沉、U8 定部署项去向），Phase 2 的 T003 / T004 亦解锁。

## 已完成

### T001 · 定位：`project` 表 / 文件树 / 左栏槽位的真实入口清单

**出参**（tasks.md：「project 表/文件树真实入口清单」）。取数时点 **2026-10-06**（HEAD `077c722c42`）。
定位性引用按 `LEARNINGS #004-05` **不写行号**（写文件 + 符号名）；段内给出的 `grep` 是复核命令。

#### ① `project` 表（每用户 SQLite）——生产入口 **6 处**，U4 裁定下**一处都不改**

锚点 = 定义处 `packages/core/src/project/sql.ts` 的 `ProjectTable`（`sqliteTable("project", …)`）。
取数：`grep -rn ProjectTable packages/core/src packages/opencode/src`

| # | 落点 | 做什么 | 性质 |
|---|---|---|---|
| 1 | `core/src/project/sql.ts` | 表定义本身 ＋ `ProjectDirectoryTable` 的外键 | **上游文件**（宪法 §一 红线） |
| 2 | `core/src/session.ts` | 建会话时 `insert(ProjectTable)`（保证项目行在） | 写 |
| 3 | `opencode/src/project/project.ts` | `Project.Service` —— 读/写**主入口**（select / insert / update / delete / 迁移期重命名） | 读写主入口 |
| 4 | `opencode/src/worktree/index.ts` | 按 id `select`（worktree 列表） | 读 |
| 5 | `opencode/src/session/session.ts` | 按 ids `select` `{id, name, worktree}`（会话列表要项目名） | 读 |
| 6 | `opencode/src/storage/schema.ts` | 纯 re-export（barrel，无逻辑） | 无逻辑 |

**外键引用**（结构层，不是读写；本 feature 不动）：`core/src/session/sql.ts`、`core/src/control-plane/workspace.sql.ts`、`core/src/permission/sql.ts`。

**同子系统旁支**：`core/src/project/directories.ts` 读写 `ProjectDirectoryTable`（project ↔ 目录 多对多）。

> ⚠️ **实测更正一处提示词前提**（`LEARNINGS #003-04`）：`dev_tdd.005.md` D0-3 把
> `packages/core/src/project.ts` 的 `ProjectV2.Service` 列为 `project` 表读写者——**不成立**。
> 该文件**不 import `ProjectTable`**（上面那条 grep 可证），它只解析 project id 并写 repo 本地缓存
> 文件；文件自己的 `Interface.commit` 注释写着「persistence 仍归旧服务，等持久化搬进 core 后这个
> bridge 才可删」。

**差集**：U4 裁定走 `project_ext` ⇒ 上表 1–6 **一处都不改**。改动面在**「项目列表查询的组装」那一层**
（多一次 LEFT JOIN），以及新表的建表钩子（挂 `core/src/database/router.ts`，每用户库那一层）。

#### ② 文件树——**同名 3 个、活跃 2 条链**（不是 1 条）

| 组件 | 落点 | 生产挂载点 |
|---|---|---|
| `FileTree`（v1） | `app/src/components/file-tree.tsx`（default export） | `pages/session/session-side-panel.tsx`（×2）← `pages/session.tsx` |
| `FileTreeV2` | `app/src/components/file-tree-v2.tsx` | `pages/session/v2/session-file-browser-tab.tsx`、`pages/session/v2/review-panel-v2.tsx` |
| `FileTree`（**第三方**） | `@pierre/trees`（`app/package.json` 依赖） | `components/dialog-select-directory-v2.tsx`（目录选择器）—— **同名不同源，与本 feature 无关** |

v1 的能力面（实测 `FileTree` 的 props 签名）：`path / class / nodeClass / active / level / allowed /
modified / kinds / draggable / onFileClick / onFileDoubleClick` ＋ 五个 `_` 前缀内部参数。
**没有**右键菜单 / 新建 / 重命名 / 删除 / 上传 / 下载 ⇒ **D0-2(b) 成立**：T007–T009 那六项能力今天
**不存在**，`[FE·换皮]` 的实际工作量 ≈ 新增。

⚠️ **这是「不止一条链」**（Step 3 [INT] 的「停下问」触发点）：v1 与 v2 谁当「复用底座」要裁。
实测差别：v2 另有独立的**纯函数 model**（`file-tree-v2-model.ts`，可单测），v1 把逻辑写在组件内。

#### ③ 左栏槽位——今天是个**无人认领的空槽**

- `app/src/workspace/three-pane.tsx` 声明 `props.left`（＋ `leftCollapsed`），渲染 `<Show when={props.left !== undefined && !props.leftCollapsed}>`
- 生产码 `workspace-entry.tsx` 的 `<ThreePane>` **不传 `left`**；传 `left` 的只有 `workspace/three-pane.test.tsx`（4 处）
- `pages/layout/sidebar-project.tsx` 是**上游**文件（被上游 `pages/layout.tsx` 用），**不是** openhive 左栏
- **交叉引用指不到兑现者**：`workspace-entry.tsx` 的注释写「那是左项目侧栏，归 T010」；001 的 `T003`
  备注另一处写「左栏由 T006 供给」——而 001 实测 **T006 = 图标栏、T010 = 模块切换联动**，
  **两条都没建左栏** ⇒ 左栏今天**无主**，005 是第一个来建它的（**D0-2(a) 成立**）。

#### ④ 「当前项目」这个身份——**HTTP 层今天不存在**（D0-1 的锚点）

- `opencode/src/server/routes/instance/httpapi/middleware/anchor-workspace.ts` 的 `anchorWorkspaceLayer`：
  `const sandbox = join(config.root, user.value.id)` —— **两段，无 project 段**；把 URL query、
  头（`x-opencode-directory`）、请求体（`payload.location.directory`）三条入参**全部改写成沙箱根**
- 该文件自己的注释写明出口是「**伪造 directory 被忽略，落沙箱根**」
- ⇒ plan 反复写的 `/workspaces/{userId}/{project}/` 里的 `{project}` 段**是新增**；今天「项目」只活在
  **元数据层**（`project` 表 ＋ `project_directory`），而请求落点被钉死在**沙箱根**

#### ⑤ 新增 `packages/app/src/project/` 要**同时**改 3 处（`LEARNINGS #002-06`）

| # | 落点 | 今天的内容 |
|---|---|---|
| 1 | 根 `package.json` 的 `lint:openhive` | 5 个目录：`rail/center/topbar/workspace/auth` |
| 2 | `app/src/openhive-module-dirs.test.ts` 的 `moduleDirs` | 同上 5 个 |
| 3 | `app/src/workspace/design-token-refs.test.ts` 的 `自有目录` | 同上 5 个（该文件注释**自己写着**「扩范围时两处要一起扩」） |

⇒ plan 要的 `packages/app/src/project/` **不在其中任何一处** ⇒ **视觉契约门（`lint:openhive`）扫不到新文件**
（runbook Step 4 已点名此例外）。**改法按 runbook 原话：「先报告、别自己拍」。**

#### 本 task 逼出来的「停下问」项

T001 只做定位、不动产品码。它把下列**开工前裁定**推到了台面上（另见 `dev_tdd.005.md` Step 0.5）：

1. **D0-1**：`anchor-workspace.ts` 的 `join(config.root, user.value.id)` 要不要变三段？「当前项目」身份从哪来（URL 参数 / 会话字段 / 头部）？
2. **D0-2(a)**：左栏怎么接——填 `ThreePane.left` 槽，还是照 001 的先例走外层行容器？
3. **D0-2(b)**：文件树走 **(a)** 改上游组件本体（单独提交 + 标定制）还是 **(b)** 在 openhive 自有目录里包一层（零侵入）；**并**顺带定 v1 / v2 谁当底座。
4. **⑤**：把 `app/src/project/` 加进那 3 处清单——**改法要先报告**。

## 阻塞项
（无）

## 开工前裁定（2026-10-06，用户裁定 · 主检出会话执行）

来源：`docs/workspace/dev_tdd.005.md` 文末「未定项清单」。三条已裁定，并已同步到 plan.md / tasks.md / 两份 design 文档。

| # | 事项 | 裁定 | 落点 |
|---|---|---|---|
| U1 | 自动归档形态（spec 与 plan R4 自相矛盾） | **按 spec 收口**：先提醒 → owner 确认后归档。plan R4 原写「待决策」，与 spec 四处（AC4 / US5 注记 / FR-008 / Assumptions）打架，改的是 plan | plan.md R4 |
| U4 | `project` 表加列 vs 另起表 | **另起 openhive 自有 `project_ext` 表**（六字段）。建表钩子挂 fork 自有的 `packages/core/src/database/router.ts`（每用户库那一层）；上游 `project/sql.ts` 与 `database/migration/` **一字不动**（宪法行 57 处方原话「新增独立文件/表」）。**代价**：项目列表查询多一次 LEFT JOIN ＋ `project` 行与 `project_ext` 行须同步创建 ⇒ 收成一个写入模块 | plan.md / tasks.md T003 / 两份 design |
| U5 | `project_member` 判定走哪条线 | **自成一条线，不接 `core/access` capability**（004 裁定 ④：契约零消费者，留给 F6/F7）。存储落业务 PG（auth 包迁移体系）、判定写 core 纯函数、接线在 `packages/opencode/src/server/openhive/` 执行层 | plan.md / tasks.md T004 |

### 第二批：T001 逼出来的裁定（2026-10-06，同一天）

来源：`dev_tdd.005.md` Step 0.5 的 D0-1 / D0-2 / D0-4，＋ T001 实测的 ⑤。

| # | 事项 | 裁定 | 落点 |
|---|---|---|---|
| **D0-1** | 「当前项目」身份从哪来（锚定今天钉死两段 `{root}/{userId}`） | **服务端算目录，锚定不动**：客户端只报 `projectId`（业务标识），建会话时服务端查 `project_ext` 拼 `join(sandbox, dir)` 写进 `session.directory`。`anchor-workspace.ts` **一字不动** ⇒ 003 的「客户端报的目录一律无效」不变量原样保留 | T003 / T005 / T006 |
| **D0-2(b)** | 文件树落点（实测无右键菜单/新建/重命名/删除/上传/下载） | **在 `app/src/project/` 包一层**，上游 `packages/app/src/components/file-tree.tsx` **一字不动**（零侵入面）；**底座取 v2**——`file-tree-v2-model.ts` 是**纯函数**、可单测，v1 把逻辑写在组件内 | T007–T009 |
| **D0-4** | MinIO 依赖选型（今天零对象存储 SDK） | **`@aws-sdk/client-s3`**：复用既有 `@aws-sdk/credential-providers`（Bedrock 认证）的**同一 SDK 家族**，`bun.lock` 增量最小；MinIO 是 S3 兼容 ⇒ 能直连 | T002 / T011 |
| **⑤** | 新增 `app/src/project/` 不在视觉门扫描范围 | **加进 3 处**（根 `package.json` 的 `lint:openhive` ＋ `openhive-module-dirs.test.ts` ＋ `design-token-refs.test.ts`），与既有 5 个目录同口径；在**建目录之前**单独提交 | T007 前置 |
| **U8** | MinIO 部署项落哪 | **落 `docs/workspace/deploy-todo.md` 的 D 表**（本会话按 `LEARNINGS #002-04` 默认执行，未单独裁定） | T002 |

⚠️ **D0-2(a) 左栏接法未单独裁定**——我按 `openhive-DESIGN.md` §4.1 的语义直接落：「图标栏 56px → 左项目侧栏 280px → 中 → 右」里图标栏是**三栏之外**的独立列（正因如此才有 001 那层外层行容器），左项目侧栏**填 `ThreePane.left`**。这与 `workspace-entry.tsx` 现有注释不冲突（那句说的是「Rail 不进 left 槽」）。**若你本意不同，说一声即可改。**

### 第三批：T002 开工前裁定（2026-10-06，同一天）——MinIO 目录 / 权限 / 共享载体 / `archived` 归属

**为什么到 T002 才裁**：T002 的出参就是「MinIO 目录 / 权限方案」，而它被一组**自相矛盾**卡住（下节四条裁定正是把这个矛盾摊平）。原以为 T001 定位时就钉得住，**没钉住**（T001 只定位，不裁业务语义）——本条纠正那个预期。

**矛盾点（取证，`LEARNINGS #003-04` 实测口径）**：

| 出处 | 说法 | 指向 |
|---|---|---|
| `design-v2` §5.3 ＋ `005/plan.md` 集成点 | 项目在 `/workspaces/{userId}/{project}/` 内，用户根是隔离边界 | 每人一份 |
| `design-v2` §13.3 `shared_directory` | 指向 `/shared/{projectId}/` | 项目一份 |
| `design-v2` §13.3 / §8 归档路径 | `/minio/{userId}/{projectId}/`（**带 userId**） | 每人一份 |
| `005/spec.md` FR-010 | 「归档后**成员**失权，owner 保留找回权」 | 项目一份（个人态归档推不出「成员失权」） |
| `005/spec.md` FR-012 | 「各自 commit、冲突 merge」 | 项目一份（各存各的不会冲突） |

存量事实（T001）：锚定**两段**、`{project}` 段 HTTP 层**不存在**、`/shared/` **不存在** ⇒ 两组说法**都没有载体**，选哪边都是新增，区别只在加在哪。

| # | 事项 | 裁定 | 落点 |
|---|---|---|---|
| **Q1** | 共享项目的文件几份 | **各存一份**：锚定 `join(root, userId)` **一字不动**，项目是沙箱内的子目录；MinIO **镜像各人沙箱** ⇒ `/minio/{userId}/{projectId}/`。共享的是**成员关系**，不是文件实体 | T002 / T003 / T007 / T011 |
| **Q2** | 「文件共享」靠什么承载 | **共享 bare 仓库**：`/shared/{projectId}.git`，成员各自 clone / commit / push —— FR-012「各自 commit、冲突 merge」的**唯一逐字实现**（不同检出、同一仓库）。**不经 HTTP** ⇒ 锚定不变量不破 | T016（＋ `/shared/` 挂卷 → deploy-todo D 表） |
| **Q3** | `archived` 归谁 | **拆开落**（**覆盖 U4 的「六字段一张表」**）：个人态 `type` / `project_type` / `shared_directory` / `last_accessed_at` 留每用户库 `project_ext`；共享态 `archived` / `archived_at` 进业务 PG（**新表 `project_archive`**，与 `project_member` 同侧）⇒ **FR-010 成立，spec 一字不改** | T003 / T004 / T013 / T015 |
| **Q4** | MinIO 权限模型 | **policy 变量下沉**：应用持服务凭据，MinIO policy 用 `${aws:username}` 把可写范围钉在 `openhive/${aws:username}/*` ⇒ 越权在**存储层**被拒（宪法 §四「权限下沉执行层」），不建 1600 个账号 | T002 / T011 |

⚠️ **两条要说明的账**（`LEARNINGS #002-06`：别让两个投影各长各的）：

1. **Q1 预览与 Q3 打架，以 Q3 为准**。Q1 选项里写的「`project_ext` 六字段留每用户库（U4 已裁）」与 Q3 题干是同一个问题的深浅两面，Q3 选的是**拆开落** ⇒ **U4 的「六字段一张表」被本批改为「4 字段 + 2 字段两张表」**。U4 那行「另起 openhive 自有表、上游 `project/sql.ts` 一字不动」**仍然成立**，变的只是表的数量与字段切分。
2. **Q1 × Q3 逼出一条新缺口，本批不拍**：owner 归档时，**成员的**沙箱文件怎么办？owner 读不到成员沙箱（物理隔离），所以「沙箱文件全部上传 MinIO」只能覆盖**自己**那一份。两种读法：(a) 归档只动 owner 自己那份，成员那份留在各自沙箱、仅由 `archived` 状态拦住后续写入；(b) 成员各自在收到归档通知后上传自己的那份（需站内信 + 状态机）。**留待 T013 开工前钉**（T013 的第一行代码正落在这里）。
3. **`shared_directory` 的语义随 Q2 收窄**（本批顺带定，若与本意不符说一声）：原写「指向 `/shared/{projectId}/`」——在 Q2 下这个路径**就是共享 bare 仓库**，故字段值定为 `/shared/{projectId}.git`，仅共享项目有值（私有项目为空）。它**不是**工作目录，是 git remote 路径。

**尚未裁定**：

- ~~**共享项目的 `archived` 语义**~~——**已裁（Q3，2026-10-06）**：拆开落，共享态进 PG，FR-010 成立。（原写「留待 T001 定位时钉」，实际 T001 未钉，由 T002 开工前裁定补齐。）
- **U2 / U3 / U6 / U7** 未裁（案件实体无 task / 超期提醒触发者 / T004 半条判据 / —）——按 `dev_tdd.005.md` 的节奏在对应 task 开工前裁定。**U6（FR-012 并发靠 git）已由 Q2 解决**（载体＝`/shared/{projectId}.git`）；**U8 已由第二批默认执行**。

**门禁基线**：**未测**。按 `dev_tdd.005.md` Step 4：开工时自己跑一次 `bun run lint:openhive`，把当时的 warnings / errors / 文件数落进本文件再引用——**不要抄 001 的数**（`LEARNINGS #001-02` / `#002-06`）。

## 跨 feature 备注（2026-10-06，本次实测发现 · 未处理）

`006-ai-session` / `007-fund-analysis` / `009-ai-assets` / `010-governance-console` 四份 plan/spec 里写有「**capability 三层拦截已由 F4 落地**」「复用 F4 权限」之类表述。这与 004 自己的交班对不上：004 明说 `AccessCapability` / `AccessIssue` **契约零生产调用点、留给 F6/F7**；本次实测复核为真（`grep` 命中全部落在 `packages/core/src/access/` 定义处与 `packages/core/test/`，`src` 下 access 目录之外**零调用点**）。

**用户裁定（2026-10-06）：本次不动那四份文档，只在此记一笔。** 理由：它们是各自 feature 的开工依据，应由那些 feature 开工时像本部 U5 一样**自己实测**再钉（这正是 U5 被抓出来的方式）。**005 不受影响**——U5 已裁定 `project_member` 不接 capability。

## 最后更新
2026-10-06（三批开工前裁定全部落定：U1/U4/U5 ＋ D0-1/D0-2b/D0-4/⑤/U8 ＋ Q1–Q4）
