# 实施进度 · 项目管理（工作空间轴）

## 当前任务
T001（定位）✅ ／ T002（MinIO 目录与权限方案）✅ ／ T003（`project_ext` 表 ＋ 建表钩子）✅ ／ T004（`project_member` ＋ `project_archive` ＋ 微信群模型判定）✅ ／ T017（「当前项目」身份的落地口径）✅ ／ T005（项目锚点行 ＋ 左栏接线 ＋ 空态接缝）✅ ／ T006（项目面板 ＋ 接缝 ＋ 左栏接线）✅ ／ T007（文件树 ＋ 接缝 ＋ 左栏接线）✅ ／ T008（文件树右键菜单）✅ —— 见「已完成」。
**下一步 = T009**（US2 删除二次确认 ＋ 重命名/删除选中后点亮、未选中置灰），依赖 T007 已满足；⚠️ 开工前读者注意：**T007 的 ⑤ 前置（3 处目录清单）已随 T005 办完**，不需重做（原文那句「单独一次提交」实测做不到，见下）；**T009 与 T007/T008 是同一个组件上的后续**，先读 `file-tree.tsx` 的文件头（状态归属、与 T009 的边界）；T007 刻意**没有**在「没选中」时禁用重命名/删除按钮，那是 T009 的活。
✅ **T008 留的待裁定项已裁定（2026-10-06，用户「补，phase 你定」）**：复制／移动／上传／下载四个动作零任务认领（`grep` 已核实）⇒ **补 T020，归 Phase 4**（同 T017／T018／T019 先例，编号排最后）。
✅ **T006 顺带接掉了 T005 的欠账（半个）**：`currentProject` 有了第一个写入方（面板点一行 ⇒ 写它 ⇒ 锚点行跟着变）——**但只接了「切项目」**，「新建项目」没有落库就没有项目可切，那半个**明账挂在 T018**（不是暗账）。
✅ **已补齐三条计划缺口（用户裁定）**：
  - **T018** 收「项目 CRUD 落库 ＋ 列表查询 ＋ HTTP 出口（含建目录）」——T006 侦察出「没有任何 task 认领建项目 / 列项目的落库」。
  - **T019** 收「左栏外壳：② [会话][文件] tab 容器 ＋ ④ MinIO 常驻窄条」——T007 侦察出「设计 §2 的这两块没有任何 task 认领」，而 **US4 验收标准原文写着「当前在『文件』tab」**⇒ ② 是 T012 的前置，不补则 T012 无从验收。
  - **T020** 收「文件树的**复制 / 移动 / 上传 / 下载**（四项的真执行＋接线）」——T008 侦察出这四个动作**零任务认领**（`grep` 全文只命中 T008 那一行，且只到「菜单」为止），而归 **Phase 4**（US2）。**本次同时给 T018 补了范围第 ⑤ 条**（文件列表读取）——那是 `project-files.ts` 早就挂给 T018 的账，但**接收方的表里此前没有它**（`#002-04`）。
  三条都按 `#002-04` 落进 `tasks.md`（编号排最后、不重排既有编号，同 T017 先例）；现在 `tasks.md` 共 **20 条**（T001–T020），已**超出** spec 写的 12–18 条范围。
✅ **T007 的 ⑤ 前置已作废**——`app/src/project/` 那 **3 处目录清单**已随 T005 落地（原文要求「单独一次提交、先于建目录」，实测做不到：git 提交不了空目录、清单里的断言要求目录存在 ⇒ 那次提交必红），T007 本体**不再需要**做这件事。
✅ **T004 开工前的两笔已裁定（2026-10-06，见「第四批」）**：① **U7** = 半条 ＋ 落 007 的表（T004 出参已按此**收窄**为「**工作空间轴**判定单测通过」；完整判据在 `007-fund-analysis/tasks.md` T004）；② T003 未闭合项 ① = **在 005 内补一条 T017**（建会话拼目录的接线），归属 Phase 2。
✅ **T004 新裁定一笔（2026-10-06）**：**「归档 = 冻结」**——FR-010 字面只写「成员失权、owner 保留找回」，本模块读成「归档后除 owner 的 `restore` 外任何动作都不成立」（含 owner 自己的 invite/remove/archive）。方向**收紧**；理由与「若本意是放宽则要有据再改」见下一节。

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

### T003 · openhive 自有 `project_ext` 表 ＋ 建表钩子

**落点（3 个文件，2 新 1 改）**

| 文件 | 性质 | 内容 |
|---|---|---|
| `packages/core/src/project/ext.ts` | **新增** | `ProjectExtTable`（drizzle 表声明）＋ `PROJECT_TYPES` 运行时闭集 ＋ `migration`（建表 DDL）＋ `findByProjectID`（D0-1 必给接口） |
| `packages/core/src/database/router.ts` | **改**（fork 自有文件） | 每用户库那一层加 `Layer.tap`：`DatabaseMigration.applyOnly(db, [ProjectExt.migration])` |
| `packages/core/test/project-ext.test.ts` | **新增** | 5 条用例（见下） |

**建表机制（这是本 task 唯一需要想清楚的地方）**

上游的库文件结构是三层：`database/migration/*`（一条一个文件）→ `migration.gen.ts` / `schema.gen.ts`（**生成物**，由 `packages/core/script/migration.ts` 产出）→ `database/migration.ts` 的 `apply()` / `applyOnly()`。
⇒ 往 `database/migration/` 加一个文件**不是「加」而是「改」**：生成物要重跑、清单要重排，每次 `git merge upstream/dev` 都要解冲突（宪法 §一 NON-NEGOTIABLE）。

改走**上游已经导出**的 `DatabaseMigration.applyOnly(db, input: Migration[])`——它本来就接受**任意** `Migration[]`，借同一本 `migration` journal 记账、幂等重放。于是：

- 我们的迁移**不占上游清单**，上游重跑生成器也不会挤掉它；
- 记账在 `migration` 表里（运行时数据，不是源码）⇒ 零冲突面；
- 钩子挂在 `router.ts` 的**每用户库那一层**（`Layer.fresh` 之后、`Layer.tap` 之前没有窗口）——与上游 `apply()` **同一次建库**，不存在「库开了、表还没建」的中间态。三条位置理由写在代码注释里。

**验证证据（`dev_tdd.005.md` Step 2 ④：RED→GREEN→REFACTOR）**

| 用例 | 判据 |
|---|---|
| ① 每个用户库都建出了 `project_ext` 表（钩子挂在 router 那一层） | 建库后 `sqlite_master` 里 `count(*) = 1` |
| ② 列形状 = `project_id` ＋ 个人态 4 字段；`archived` / `archived_at` 不在本表（Q3） | `pragma_table_info` 名字集合 **`toEqual`**（警报型，多一列就红） |
| ③ `type` 闭集由存储层兜：`PROJECT_TYPES` 全部通过、闭集外的值被拒 | 逐值插入 + 一个 `'public'` 必须 `Failure` |
| ④ `findByProjectID` 按 projectId 单行查询、查不到给 `undefined`（D0-1） | 命中行 `toEqual` 五字段；不存在的 id 给 `undefined` |
| ⑤ 属主隔离：alice 的 `project_ext` 行在 bob 的库里查不到 | 被测属性（bob 查不到）**排在前**，对照（alice 查得到）在后（`#004-14`） |

**变异验证（`#003-03`：三类结论都要据实记）**——① 是真正走完 RED→GREEN 的（首版 `n: 0`、④⑤ 首版 `ProjectExt.findByProjectID is not a function`）；②③⑤ 是**写在已实现代码上的钉子**，靠变异证它们会红：

| 变异 | 结果 | 结论 |
|---|---|---|
| M1 DDL 里多一列 `archived` | **恰红 1 条**（②） | 归「恰红目标那几条」。**顺带测出**：drizzle 的 `select()` 只取**声明过的**列，所以多出来的库列**不会**让 ④ 的 `toEqual` 变红——列形状只能靠 ② 这种 `pragma_table_info` 断言钉 |
| M2 去掉 `CHECK (type IN …)` | **恰红 1 条**（③） | 同上 |
| M3 去掉 `project_ext` 所在层的 `Layer.fresh` | **恰红 1 条**（⑤） | 同上。这条最有价值：`Layer.fresh` 缺失是 router.ts 里**登记在案的真实旧 bug**（「bob 的库里出现了 alice 建的表」），⑤ 能把它抓出来 |

**门禁（2026-10-06 实测，本 task 阶段）**

- `packages/core` 单测：`project-ext.test.ts` **5 pass / 0 fail**；同族回归（`database-router` / `database-migration` / `project*` / `session-project-isolation` / `database-routing` / `connection-routing` 9 个文件）**68 pass / 1 skip / 0 fail**（串行跑，`#003-01`）。
- `packages/core` `bun run typecheck`（`tsgo --noEmit`）：**EXIT=0**。
- 根 `bun run lint:openhive`：**23 warnings / 0 errors / 69 files / 161 rules**——与 T002 基线**逐项相同**，且 `grep` 本次三个文件**零命中**（判据按 `#001-02` 是「本次新增/改动文件 0 命中」）。

**本 task 未闭合、需要裁定的两条**（不自行拍板，`dev_tdd.005.md` Step 2 ⑦）

1. **「建会话拼目录」的接线没有任何 task 认领。** D0-1 裁定里 plan.md 的落地口径是「客户端只报 `projectId`（业务标识），**建会话时服务端查 `project_ext` 拼出 `join(sandbox, dir)` 写进 `session.directory`**」。T003 按 D0-1 的结论只交到**接口级**（`findByProjectID` 存在且可用），因为 T003 的**明文出参是「新表建成、typecheck 通过」**；而这句话**不在 T003 / T005 / T006 / T016 任何一条的文字里**。⇒ 要么补一条 task，要么并入某条已有 task——**请裁定**（`LEARNINGS #002-04`：责任推出边界必须落接收方的表）。
   ✅ **已裁定并落地（2026-10-06，同一天）**：用户裁定「**在 005 内补一条 T017**」，已实现并收尾——见「T017」节与 `tasks.md` 的 T017。上面那句「请裁定」保留为当时的记录，**问题本身已闭合**。
2. **钩子只覆盖每用户库，主库没有这张表。** 进程级那份主库（`Database.node`，`Global.Path.data/opencode.db`）由**上游** `database.ts` 建，为它加钩子＝破坏「上游一字不动」，故**没加**。当前没有任何消费者在**无身份**上下文里读 `project_ext`（D0-1 定的消费者是建会话那条路径，它带 `User.Service`、必走每用户库）。⇒ 记为**已知边界**；将来若出现 CLI / 后台任务要读它，**先回来改 `ext.ts` 顶部那段注释**。

**顺带实测出来的两条工具事实**（候选 LEARNINGS，本 feature 收尾时再定要不要收）

- `schema.sql.ts` 的 `Timestamps` 用 drizzle 的 **`.$default(() => Date.now())`**——那是**运行时**默认值，**不是 SQL 的 `DEFAULT`**。裸 SQL 插入 `project` 表不写 `time_created` / `time_updated` 会 `NOT NULL constraint failed`（实测）。
- `drizzle` 的 `select().from(table)` **只 select 声明过的列**：库里多出来的列不会出现在结果对象里（M1 实测），所以「表结构被偷偷加列」**测不出来**，得用 `pragma_table_info`。

**实装落点修正（已同步 plan.md）**：原文件树把 `project-ext.ts` 画在 `packages/opencode/src/project/`，实际落在 `packages/core/src/project/ext.ts`——建表钩子在 core，而**core 不能 import opencode**（反向依赖）。全文只有 plan.md 一处引用过旧路径（已 grep 确认并改）。

### T004 · `project_member` ＋ `project_archive` ＋ 微信群模型判定

**出参**（tasks.md：「权限判定单测通过」）。⚠️ 按 🔒 **U7 裁定**，出参**收窄为「工作空间轴」那半**——
完整判据「工作空间成员身份不改变数据访问结果」需要**数据轴那半**（`fund_project_member`）也在，
那条已显式落到 `007-fund-analysis/tasks.md` T004（`LEARNINGS #002-04`：责任推出边界要落**接收方**的表）。
**不得**据此写「两轴解耦已验证」（`#002-02`：测不了要写成缺口，不是覆盖）。

**四处落点（依赖方向是硬约束，不是偏好）**

| 层 | 文件 | 内容 |
|---|---|---|
| 判定 | `packages/core/src/project/membership.ts`（新） | `MEMBER_ROLES` / `PROJECT_ACTIONS` / `decide`——**纯函数**，不读库、不抛错、不碰 Effect |
| 存储 | `packages/auth/src/migrations/0005_project_member.sql` ＋ `.down.sql`（新） | `project_member`（成员关系）＋ `project_archive`（归档态；Q3 裁定） |
| 存储 | `packages/auth/src/project-member.ts`（新） | drizzle 模型；**刻意无查询辅助函数** |
| 防漂移 | `packages/opencode/test/server/openhive-project-member-closed-set.test.ts`（新） | DB 的 `role` CHECK ⇔ core 的 `MEMBER_ROLES`，逐值双向 |

为什么只能是这个分布（实测，不是偏好）：`packages/auth` 的 deps 只有 `drizzle-orm` / `hono`
（**不依赖 core**），而 core 也不依赖 auth ⇒ ① core 侧**碰不到库**，判定收不到「行」、只收得到
「身份」⇒ 只能是纯函数；② 两侧各测各的半边；③ 要**同时**看见真库（CHECK 在库里）与 core 的值，
**全仓只有 `packages/opencode`** 够得着（与 `openhive-rbac-closed-set.test.ts` 同因）。
「有消费者才写取数」同 `rbac.ts` 的先例：`grantsFor()` 是 T006 有链 A 之后才加的，
本条**没有**任何消费者（T010/T013/T015 才接），故模型只交表定义（`LEARNINGS #004-07`：判据形状由被调方定义）。

**两条不变量，各由一层守**

1. **项目永远有一个 owner**——「**至少**一个」由判定守（`leave` 拒 owner、`remove` 拒 owner 目标），
   「**至多**一个」**只能**由库守（部分唯一索引 `project_member_single_owner`，`WHERE role = 'owner'`）。
   判定函数只看得到一个 `role`，它**分不出**「这个项目有两个 owner」这种库状态；两个 owner 各自都能
   归档、都能找回，谁说了算没有答案，而两行 `project_member` 都完全合法。
2. **`project_id` 没有外键、也不可能有**——项目本体是 opencode 原生 `project` 表，活在**每用户 SQLite**
   （003 的物理隔离），与 PG 是两个库。所以「悬空 project_id」**在本层查不出来**，能拦住它的只有写入侧
   把 `project` 行与这两张表的行**收成一个写入模块**（`plan.md` R1 的代价栏）。已写进迁移头部。

**「归档 = 冻结」是一次裁定，不是顺手写的**

FR-010 的字面只说「归档后**成员**失权，owner 保留**找回**权」。本模块读成：
**归档后除 owner 的 `restore` 之外，任何动作都不成立**（含 owner 自己的 `invite` / `remove` / 再来一次 `archive`）。
理由：归档时沙箱文件已上传、本地已删，此时「邀请谁进来」「成员退群」都没有可作用的实体，唯一有意义的出口是找回。
方向是**收紧**（比字面更严），不会放走任何一次越权。
⚠️ **若本意是「owner 归档后仍可邀请」，那是一次放宽**，要有据再改（`LEARNINGS #002-02` 的取向）。

**验证（本 task 自身 25 条）**

| 文件 | 条数 | 判据要点 |
|---|---|---|
| `packages/core/test/project-membership.test.ts` | 16 | 邀请三向 / 移除三向（含**目标 owner ⇒ 拒**）/ 退群三向 / 归档两向 / 「归档 = 冻结」**按闭集遍历** / 非成员 fail-closed **按闭集遍历** / 闭集取值 |
| `packages/auth/src/project-member.test.ts` | 8 | 防漂移（两表列形状 ⇔ 模型）/ PK 含 `project_id`（对照：一人可跨项目）/ `role` CHECK（**含中文「群主」**）/ 悬空用户被外键拒 / 第二个 owner 被索引拒 ＋ **第二个 member 放行（对照）** / 归档态 PK / coherence CHECK ＋ **两种正当组合（对照）** |
| `packages/opencode/test/server/openhive-project-member-closed-set.test.ts` | 1 | CHECK 定义串抠字面量 ⇔ `MEMBER_ROLES`，`toEqual` 双向 |

两处「按闭集遍历」是刻意的（`LEARNINGS #002-06` 的形状）：逐动作各写一条的话，**新加一个动作时没人会回来补**，
那条新动作会在归档态下悄悄放行而全部用例照样绿。

**变异验证（`#003-03`：三类结论都要据实记）**

| 变异 | 结果 | 结论 |
|---|---|---|
| M1 core `MEMBER_ROLES` 加 `"guest"` | core 闭集组**恰红 1**；opencode 防漂移**恰红 1** | 归「恰红」。**两条各自都红** ⇒ 两侧都在看 |
| M2 SQL 的 CHECK 加 `'guest'` | 防漂移**恰红 1**（core 侧不动） | 同上。证明它测的是「两侧相等」，不是「已知值被接受」 |
| M3 `remove` 去掉 `target === "member"` | 移除组**恰红 2**（目标 owner ／ 目标 null），邀请·退群组不动 | 同上 |
| M4 `remove` 整条改成「actor 是 owner 或 member」 | 移除组红 3 | 同上（这条变异不精确，故另跑 M3 把 `target` 那一半单独证） |
| M5 归档短路写成 `if (false && …)` | 归档组**恰红 3**（「已归档 owner 可找回」＋两条闭集遍历）；**「未归档 restore 被拒」不红** | 同上。不红的那条对——它走的是 `restore` 那一支，与归档短路无关 |
| M6 部分唯一索引去掉 `WHERE role = 'owner'` | auth **恰红 1**，红的正是**对照那半**（member 加不进去） | 同上。**索引写宽了不会让「第二个 owner 被拒」变红**（它照样拒），只有对照能抓 ⇒ 对照不是装饰 |
| M7 删 `project_archive_coherence_check` | auth **恰红 1** | 同上 |
| M8 删 `user_id` 外键 | auth **恰红 1** | 同上 |
| M9 重构后复跑 M3 | 同上（恰红 2） | **重构没有把钉子变松** |

**门禁（2026-10-06 实测，本 task 阶段；全程串行，`#003-01`）**

- 本 task 自身：core **16 pass**／auth **8 pass**／opencode **1 pass** ⇒ 共 **25 pass / 0 fail**。
- `packages/auth` 全量（`bun test`，包目录内）：**229 pass / 1 skip / 0 fail / 230 tests / 20 files**。
  **基线是本次实测的 221 / 1 / 0**——取法：临时把本文件移出 `src/` 跑一遍（跑完移回），
  ⇒ 差集 **＋8 pass ＋ 1 file，恰是本次 8 条用例**（`#001-01`：判「有没有变坏」看**名称级差集**，不看总数）。
  ⚠️ 004 收尾记录的是 **220**，本次实测基线 **221**，**差 1、未归因**——据实记（`#003-04`：复现不出来的别写成结论）。
- `packages/core` 同族回归（`project*` / `database-*` / `session-project-isolation`，8 文件）：
  **67 pass / 1 skip / 0 fail**。
- `packages/opencode` access 族（8 文件，含 004 的 5 个接缝测试）：**34 pass / 0 fail**。
- typecheck：`packages/core` / `packages/auth` / `packages/opencode` 三包 `bun run typecheck`（`tsgo --noEmit`）**全 0 错**
  （auth 那侧第一版红在测试里 `count.rows[0].n` 的 `TS2532`，改 `?.` 后干净）。
- lint：根 `bun run lint:openhive` = **23 warnings / 0 errors / 69 files / 161 rules**（与 T002/T003 基线**逐项相同**）。
  本次 5 个代码文件**不在**它的 glob 内（它只扫 `app/src/` 的 5 个前端目录，`69 files` 是这条的佐证）
  ⇒ 另在**仓库根**单跑 `bunx oxlint <这 5 个文件>`（`#004-10`：单文件 lint 必须在仓库根）得到
  **0 warnings / 0 errors / 130 rules**。

**出参外的两点说明（是刻意，不是缺口）**

1. **`decide` 的出口是 `boolean`，没有「为什么被拒」的结构化理由。** 接线层（T010/T015）自己知道问的是哪个
   动作、归档态是什么，文案由它组。现在就加一层 reason 是投机结构（Karpathy 原则 2）。
2. **防漂移只覆盖 `role` 的 CHECK**：`PROJECT_ACTIONS` **没有**对应的 SQL 闭集（动作不进库）⇒ 它不需要镜像，
   只在 core 侧有一条取值断言。别把这条扩展成「所有闭集都有防漂移」，那是无对象的断言（`#002-02`）。

**工具事实（候选 LEARNINGS）**

- auth 的 `migrate()` 的 `upFiles()` **动态扫** `migrations/*.sql`（排除 `*.down.sql`）⇒ 新增迁移**无需登记**，
  全仓**没有「迁移清单」这种东西**（复核：`grep` 只命中注释）。加 `0005` 不必改任何注册表。
- 「根目录禁止 `bun test`」的**实装方式**是 `bunfig.toml` 的 `[test] root = "./do-not-run-tests-from-root"`
  （不是脚本 `exit 1`）⇒ 判据是「**必须 `cd <包>` 再跑**」，在根目录跑会收不到用例。
- 第一版 `decide` 写成穷尽 `switch`，**被 oxlint 的 `consistent-return` 记了 1 warning**
  （TS 知道它对联合类型穷尽、linter 不知道）。改法是 `Record<ProjectAction, …>` 映射表——
  顺带把「加动作忘了写规则」从**静默拒**提升成**编译错误**。这条是「本次新增/改动文件 0 命中」
  那条判据**抓出来的**，不查就会带进提交。

### T017 · 「当前项目」身份的落地口径（建会话落进项目目录）

**出参**（tasks.md：「建会话落进项目目录、且客户端给的目录一律无效」）。
⚠️ 这是 T003 逼出来的**孤儿**：`plan.md` 的 D0-1 落地口径写着「建会话时服务端查 `project_ext` 拼出
`join(sandbox, dir)` 写进 `session.directory`」，但这句话**不在 T003 / T005 / T006 / T016 任何一条**里
——T003 只交到接口级（`ProjectExt.findByProjectID` 就绪）。2026-10-06 用户裁定「补一条 T017」。

**三处落点**

| 层 | 文件 | 内容 |
|---|---|---|
| 实现 | `packages/opencode/src/server/routes/instance/httpapi/middleware/project-location.ts`（新） | 读 `PROJECT_HEADER` → 校验 → 查库 → 三处目录入参上移一层 |
| 接线 | `.../httpapi/server.ts`（＋**7 行**） | 挂在 `anchorWorkspaceLayer` **之后**，与锚定**共用**同一个 `AnchorWorkspace.Config` |
| 验证 | `packages/opencode/test/server/openhive-project-directory.test.ts`（新，**8 条**） | 两条链各一条主判据 ＋ 伪造目录回归 ＋ 镜像分歧点 |

**三笔裁定（2026-10-06，本 task 开工前用户裁定）**

| 问题 | 裁定 |
|---|---|
| 客户端用什么通道报 `projectId` | **请求头 `x-openhive-project`**——`payload.location` 里没有这个字段（`Location.Ref` 只有 `directory` / `workspaceID`），两条链也只有**头**是共用的 |
| 这段代码落在哪 | **新 fork 中间件**，挂锚定**之后**——它在**沙箱根里面**再进一层，排在前面会被锚定原样覆盖（锚定把三处目录入参全改成沙箱根） |
| `join(沙箱根, 目录)` 里的「目录」取什么 | **`projectId` 本身**——`project_ext` 那四列里**没有目录列** |

**⚠️ 一笔按先例落的裁定（本 task 自行落的，**待用户复核**）**

**非法 `projectId` 取「拒」**（`User.isSafePathSegment` 不过 ⇒ 抛错），不是「忽略后落沙箱根」。
依据：锚定的 R-05 对**同一类**输入（会被 `join` 进路径的身份段）已经选了 fail closed，而在这里改成
「忽略」会让同一个仓库里两个**同类**输入有两种处置——它们的安全性不因名字不同而不同。
⚠️ **「非法」与「查不到」是两件事**：合法但库里没有（R5）走的是「落沙箱根」这条**正常路径**，
**不做隐式建项目**。若本意不同，说一声即可改（改的是一处判据 ＋ 一条用例）。

**两条不变量，各由一层守**

1. **「客户端给的目录一律无效」（D0-1 的另一半）由锚定守**——本层一个字都没动 `anchor-workspace.ts`
   （实测 `git diff --stat` 只有 `server.ts | 7 ++++`），且本层只**上移一层**：目录的每一段都来自
   「服务端算的根」＋「服务端校验过的身份段」。回归用例 5 钉着这条（不带项目头 ＋ 伪造 `../../` ⇒ 仍落沙箱根）。
2. **「项目目录在沙箱根**里面**」由本层守**——判据是本层**重算** `join(config.root, user.value.id, projectId)`
   而**不是**从请求里捡锚定写下的 `x-opencode-directory`。选重算的理由：捡请求＝把「基准安全」挂在
   **挂载次序**上（本层被挪到锚定前面 ⇒ `join(客户端目录, projectId)` 直接逃出沙箱，而次序错了**没有任何
   测试会红**——挂载数组里两行换个位置而已）。重算的失败模式轻得多：即使锚定将来把沙箱多加一层，
   本层算出的路径仍在**沙箱信封之内**。⇒ 判据一句话：**基准要能自己算出来，别从请求里捡**。

**验证（本 task 自身 8 条，两条链各一条主判据＝`LEARNINGS #004-01` 的「数出口」）**

| # | 判据 |
|---|---|
| 1 | B 链带项目头 ⇒ 落 `{沙箱根}/{projectId}` 且**在沙箱根里面** |
| 2 | A 链同一个头 ⇒ 同样落 `{沙箱根}/{projectId}`（**两个出口各一条**，只改一处的写法活不过这两条） |
| 3 | 带项目头 ＋ **同时**伪造 `../../escaped-outside-sandbox` ⇒ 落项目目录，伪造值无效 |
| 4 | 不发 `Content-Type` ／ 大写带参数 ⇒ 体改写照样生效（**`#003-05` 的两个分歧点**，各一条） |
| 5 | **不带**项目头 ＋ 伪造 `../../` 目录 ⇒ 仍落沙箱根（**锚定不变量的回归断言**，T017 的 ⚠️ 要求） |
| 6 | 合法 projectId 但库里没有 ⇒ 落沙箱根，且**一行 `project_ext` 都不多出来**（不隐式建项目） |
| 7 | BOB 报 ALICE 的项目 id ⇒ 查不到（**各人各自的库**）⇒ 落 BOB 自己的沙箱根 |
| 8 | projectId 含 `..` ⇒ 被拒，且**一条会话都没落盘**（断言顺序：**落盘在前**、状态码在后） |

第 8 条的断言顺序是刻意的（`#004-14`：一个用例里既钉安全属性又钉伴随信号时，**安全属性排前面**）——
状态码在前时红出来只会说「放行了」，看不出会话有没有落盘。

**变异验证（`#003-03`：三类结论都要据实记；全程用 `cp` 备份 / 还原，未用 git stash）**

| 变异 | 结果 | 结论 |
|---|---|---|
| M1 摘掉挂载 | **红 4**（两条链主判据 ＋ 伪造目录 ＋ 改签名那条）；**3 条「落沙箱根」的回归用例不红** | 归「恰红」。不红的那 3 条对——没有本层时「落沙箱根」**恰好就是今天的正确行为**，它们守的是锚定，不是本层 |
| M2 去掉 **URL** 改写 | **恰红 1**，只有 **A 链**那条 | 同上。两条链**各自**有钉子 |
| M3 去掉**体**改写 | **恰红 2**，**只有两条 B 链**那条 | 同上。M2/M3 对称 ⇒ 两个出口谁少改一处都有人红 |
| M4 去掉 `isSafePathSegment` 校验 | **恰红 1**（第 8 条），且**红在第一条断言上**（`sessionCount` 12 → 13，即「一条会话真的落盘了」） | 同上。**校验不是装饰**——去掉它的后果里有「真的写到盘上」 |
| M5 跳过查库（恒 `undefined`） | **恰红 2**（第 1、2 条主判据） | 同上 |
| M6 把 `isJsonRequest` 漂回 `includes("application/json")` 写法 | **只有**第 4 条镜像用例红 | 同上。证明那条**不是空跑**，且印证文件头那句「没有任何别的用例会红」——`#003-05` 的分歧点只有专门钉它才抓得住 |

**门禁（2026-10-06 实测，本 task 阶段；全程串行，`#003-01`）**

- 本 task 自身：**8 pass / 0 fail**。
- 相邻同族**串行**复跑：`anchor-workspace` ＋ `tenant-directory-isolation` **24 pass**；
  `tenant-db-isolation` ＋ `session-quota-middleware` **18 pass**；
  `multi-tenant-routing` ＋ `openhive-gateway` ＋ `user-identity` **41 pass**；
  `openhive-access-wiring` ＋ `openhive-access-command-route` **8 pass**；
  三个 closed-set / naming 防漂移 **4 pass** —— **全绿**。
- typecheck：`bun run typecheck`（`tsgo --noEmit`）**exit 0**。
  ⚠️ 取数坑：`bun run typecheck | tail` 会让 `$?` 变成 `tail` 的状态，**看不出红**——要查输出内容或取 `${PIPESTATUS[0]}`。
- lint：在**仓库根**单跑三个文件（`#004-10`：单文件 lint 必须在仓库根，在包目录里跑是**配置解析失败**不是 lint 失败）
  ⇒ **0 warnings / 0 errors / 130 rules**。
- `git diff --stat bun.lock` **为空**（本项目第一号纪律：锁文件不许被镜像源污染）。

**已知不覆盖（三条，`LEARNINGS #002-02`：测不了要写成缺口，不是覆盖）**

1. **不建目录**——本层只把路径**写进** `session.directory`；`{沙箱根}/{projectId}` 那个目录由建项目那一步（T006）落地。
   实测：两条链在目录**不存在**时照样 200（锚定 / 租户那两组测试的沙箱根都从未被创建）。
2. **剥 `PROJECT_HEADER` 这件事没有测试守着**——本层把该头从往下游的请求上摘掉（同网关剥 `X-User-ID` 的取向），
   但**本仓今天没有任何下游读它** ⇒ 写不出会红的断言。这是一条**预防**，不是一条已验证的性质。
3. **射程 = 所有带头的请求，而断言只钉了建会话**——本层**不按路由清单收窄**（收窄＝多一处会漂的清单，
   `session-quota.ts` 文件头讲的正是这个坑）：带了头，三处目录入参**一律**上移一层，于是文件树 / pty / 上传
   那些入口的实例目录也跟着上移。这是产品想要的方向（「当前项目」就该是当前工作目录），但那些入口
   **没有跑过带头的情形**——它们的行为是**推**出来的。要动它们之前先补一条用例。

**出参外的两点说明（是刻意，不是缺口）**

1. **请求体那半没有 `needsLocation` 等价物**（锚定有「体里没有 location 就补一个」那一支）。锚定先跑，
   跑到本层时建会话端点的体里**已经有了** `location.directory`（＝沙箱根）⇒「补一个」这件事不存在。
   少写一个**会漂的判据**，而不是少写一个安全属性。
2. **`isJsonRequest` 是第二份镜像**（第一份在锚定，共同镜像 `HttpApiBuilder` 的 `getRequestContentType` /
   `getRequestMediaType`）。接受这个代价：本层**改不动**锚定（T017 明文「一字不动」），而请求体这条缝
   只有「读体重建」一条路（`HttpServerRequest.modify` 只管 url / headers / remoteAddress，没有 body）。
   分工让代价可接受：**安全边界在锚定那边**——本层的体改写若因判据漂移而跳过，结果是「**退回沙箱根**」，
   不是「逃出沙箱」⇒ 漂移的后果是**功能**缺口，不是安全缺口。

### T005 · 项目锚点行（左栏顶部）

**出参**（tasks.md：「左栏顶部锚点渲染」）。

**落点表**

| 层 | 文件 | 内容 |
|---|---|---|
| 组件 | `packages/app/src/project/project-anchor.tsx`（新） | 受控：`name` / `memberCount` / `onToggleList` / `onCreate` / `onOpenMembers`；四个槽位顺序 = 项目名 → 成员数 → ▾ → ＋ |
| 接缝 | `packages/app/src/project/current-project.ts`（新） | 模块级 `createSignal`，仿 `@/workspace/current-user`；未选中读作 `undefined` |
| 接线 | `packages/app/src/workspace/workspace-entry.tsx`（＋20/−2） | `ThreePane` 的 `left` 槽：`center.module() === "project" ? <ProjectAnchor … /> : undefined` |
| 验证 | `packages/app/src/project/project-anchor.test.tsx`（新，**9 条**）＋ `workspace-entry.test.tsx` 新增 **5 条** | 全是结构不变量（happy-dom 没有 CSS 引擎，钉不了像素） |

**四条设计取舍（都是刻意的）**

1. **空态宁缺勿假**——没有当前项目时显示「未选择项目」＋ `data-state="empty"`，**不**塞占位项目名。
   理由同 `current-user`：假数据进了 DOM，等真数据接上时没人分得清哪个是真的。
2. **成员徽章按「属性在不在」决定画不画**——私有项目没有成员可言，调用方传 `undefined` 即可；
   组件**不给 0、也不给假数**。
3. **三个按钮未接线时渲染成 `disabled`**——▾ / ＋ 接 T006、成员徽章接 T010，**今天都还没落地**。
   一个点了没反应的按钮是对用户的谎，而「看起来能点」比「少个按钮」更难查（同「没报错 ≠ 执行了」）。
   T006 / T010 接上回调，禁用态自然消失。
   ✅ **补记（2026-10-06，T006 收尾时回填）**：T006 已接 ▾ / ＋（`workspace-entry.test.tsx` 有断言钉
   「`＋` 不再是禁用态」）；**成员徽章仍禁用**，等 T010。
4. **条件落在 `left` prop 本身，不包 `<Show>`**——`ThreePane` 判的是 `props.left !== undefined`，而
   `<Show>` 元素**恒非 `undefined`** ⇒ 包一层会在空态下留一条 **280px 空栏**（`LEFT_PANE_DEFAULT`），
   且**不报错、不变红**。这条已写进源码注释。

**🔒 裁定（2026-10-06，开工前用户裁定）：范围 = 组件 ＋ 左栏接线 ＋ 空态接缝**

不做真实数据源、不新增后端 API。「谁来喂真实项目数据」登记成明确欠账交 **T006**（`currentProject` 的
写入方），届时**只改调用处**，锚点组件一字不动。

**⚠️ 与 ⑤ 前置的原文不符（已改口径，两处文档同步）**

`tasks.md` 原文要求「`app/src/project/` 加进 3 处目录清单，**单独一次提交，先于建目录**」——实测**做不到**：
git 提交不了空目录，而两份清单里各带断言要求该目录存在（`openhive-module-dirs.test.ts` 的 `existsSync`、
`design-token-refs.test.ts` 的 `readdirSync`）⇒「只更新清单」的那次提交**必红**。
实做为**与建目录同一次提交**（就是本提交），`tasks.md` 的 T005 / T007 两处措辞已同步改写。
三处清单：根 `package.json` 的 `lint:openhive`、`openhive-module-dirs.test.ts` 的 `moduleDirs`、
`design-token-refs.test.ts` 的 `自有目录`。

**⚠️ 待设计侧复核项（一笔）**

成员徽章图形取设计文档**字面的** `👥`（`MEMBER_GLYPH`）——opencode 原生图标集里**没有** people / users
一档（已逐个枚举 `packages/ui/src/components/icon.tsx` 的全部图标名）。代价：**emoji 不接 `--icon-base`**，
与 DESIGN §1.2「单色线性图标」不同调，而同一行的 `▾`／`＋` 都是单色 `Icon`。两条收尾各带代价，
留待设计侧裁定：① 往上游 `icon.tsx` 加一档＝动**上游文件**，按宪法 §二须单独提交；② 自绘内联 SVG＝
照 `@/topbar/topbar` 品牌标记的先例。先例是 DESIGN.md §4.6（图标集里没有匹配项时取最近的原生图标并标记复核）。

**变异验证（7 条；`#003-03`：三类结论都要据实记；全程用 `cp` 备份 / 还原，未用 git stash）**

| 变异 | 结果 | 结论 |
|---|---|---|
| M1 空态伪造项目名（`EMPTY_LABEL` → `"PLACEHOLDER"`） | **恰红 1**（「没有当前项目时走空态，不伪造项目名」），对照 8 全绿 | 恰红 |
| M2 徽章不再由成员数决定（`when={props.memberCount}` → `?? 3`） | 第一次跑**挂死**（>60s 被 `timeout` 杀，进程涨到 ~375MB，**一条结果都取不到**）；改完测试写法后 **恰红 1**，对照 8 全绿 | 恰红（**修完才取得**，见下一节） |
| M3 ▾ 的槽位名改成 ＋ 的 | **红 5**（顺序 / 恒在 / 点击回调 / 禁用态 / 可访问名称——凡碰 toggle 的全红），对照 4 全绿 | 整组红（**预期**：改的正是那 5 条断言都跟着的那个名字） |
| M4 去掉未接线时的禁用态（三处 `disabled={false}`） | **恰红 1**（「未接线时 ▾ / ＋ / 成员数是禁用态」），对照 8 全绿 | 恰红 |
| M5 ▾ 误接到 `onCreate` | **恰红 1**（「点 ▾ / ＋ / 成员数，各触发各的回调」），对照 8 全绿 | 恰红 |
| M6 左栏不看模块（`center.module() === "project"` → `true`） | **恰红 1**（「切到别的模块，左栏让位」），对照 19 全绿 | 恰红 |
| M7 接线处写死空态（`name={currentProject()?.name}` → `name={undefined}`） | **恰红 1**（「接入缝写进项目后锚点跟着显示」），对照 19 全绿 | 恰红 |

**⚠️ 变异验证逼出来的一处真缺陷（本 task 内已修）——「红变哑」**

M2 第一次跑出来的**不是红，是挂死**。根因（2026-10-06 实测，bun 1.3.14 ＋ happy-dom；四个探针逐步收窄）：
**断言失败时 bun 会打印「实得值」，而被 Solid 渲染过的节点会让打印器停不下来**。
同一条断言，实得值换成手搓的 `document.createElement("button")`（挂进文档、带子节点）**133ms** 出结果，
换成 `render()` 出来的元素则 **45s 仍未结束**、被 `timeout` 杀掉；**脱离文档也一样**（挂不挂进文档
**不是**条件）；脱离文档的空 `div` 是 **36ms**。
⚠️ 挂死时**一条结果都拿不到**——不是红，是**哑**，而且看着像「还没跑完」，比红更坏。

中招的是 `expect(<节点>).toBeNull()` 这一类**失败时实得值是节点**的断言；`.not.toBeNull()` 失败时实得值是
`null`（原语），照打印不误。**修法**：本 task 新写的 3 条一律改成断在**布尔**上（`无槽(…) === null` /
`不存在(…) === null`），红时打印的是 `false`、毫秒级。修完 M2 立刻给出**恰红 1**——这也反过来证明
挂死出在**报告路径**上，不在被测逻辑上。
⚠️ **没动的地方**：`workspace-entry.test.tsx` 里既有 4 处同形状的 `expect(…).toBeNull()`（判 `topbar` /
`document-view` 不在的那几处）**同样会挂哑**，但不是本 task 加的，按「只动自己碰过的地方」留原样，
**登记在此**：下次碰到再清，清法同上。

**门禁（2026-10-06 实测，本 task 阶段；全程串行，`#003-01`）**

- `packages/app` `bun run test:components`（**005 是第一次真正用它**）：**209 pass / 0 fail / 21 文件**
  （含本 task 新文件；`find src -name '*.test.tsx'` 实测同为 **21** ⇒ 新文件确实被 glob 收进来了，
  209 **不是**「没扫到新文件」的假绿）。
- `packages/app` `bun run test:unit`：**824 pass / 0 fail / 117 文件**。
- `packages/app` `bun run typecheck`（`tsgo -b`）：**exit 0**。
- `bun run lint:openhive`：**23 warnings / 0 errors / 72 文件 / exit 0**——warnings / errors 与 T002 记下的基线**逐项相同**
  （23 / 0，见 T002 节），文件数由 69 涨到 72 正是本 task 新增的 3 个源文件（含测试），而 warnings **一条没多**。
- `bunx oxlint -c script/oxlintrc.openhive.json` 单跑本 task 的 4 个文件（在**仓库根**，`#004-10`）：
  **0 warnings / 0 errors / 161 rules**。
- 根 `bun run lint`：**4952 warnings / 1 error / 3481 文件 / exit 1**——本仓根 lint **天生就是红的**
  （`#001-02`：那 1 个 error 是上游 `session-ui` 的，001 已裁定不私改）。本 task 的判据是
  「**本次新增 / 改动文件 0 命中**」：对全量输出（53609 行）grep 本 task 的路径 ⇒ **0 命中**。
  ⚠️ 这条**不是空绿**——同一份输出里 `packages/app/src/` 被点名 **825 行**，说明根 lint 确实在扫这片代码，
  不是「没扫到所以没命中」（`#002-02`：不执行被测路径的断言是缺口，不是覆盖）。
- `git diff --stat bun.lock`：**空**（本 task 没跑过 `bun install`）。

**已知不覆盖（三条；`#002-02`：测不了要写成缺口，不是覆盖）**

1. **没有真实数据源**——`currentProject` 今天**没有任何写入方**（T006 才写）。断言全是「往接缝里写一个值、
   看锚点跟不跟」，**不是**「从库里读出项目名」。这条欠账的接收方 = **T006**。
   ✅ **补记（2026-10-06，T006 收尾时回填）**：T006 **接了「切项目」这半个**（面板点一行 ⇒ 写 `currentProject`
   ⇒ 锚点行跟着变），**「新建项目」那半个没接**——没有落库就没有项目可切。所以上面那句「没有写入方」
   现在**只对「新建」成立**；剩下的落库缺口由 **T018** 认领。这条注释保留原样，是因为它记的是
   **T005 当时的事实**（`#004-05`：记录一次测量的，写但标时点）。
2. **钉的是结构，不是像素**——happy-dom **没有 CSS 引擎**，量不到几何、读不到 computed style。
   所以「▾ 在 ＋ 左边」「成员徽章多宽」「禁用态有没有把悬停底色撤掉」这些**视觉**判据一个都没钉；
   钉的是槽位在不在、顺序、文本、点了通知谁、`disabled` 属性。视觉验收要真浏览器，**005 全程没有**。
3. **`--icon-base` 注入没有断言守着**——`ICON_WRAP` 那串 `[--icon-base:var(--v2-icon-icon-muted)]` 是照
   `rail.tsx` 抄的：不注入不会报错，只会**静默恒灰**，而 happy-dom 读不到 computed style ⇒
   **写不出会红的断言**（同 T017 的「剥头没有下游读」）。这是**照先例办**，不是已验证的性质。

### T006 · 项目面板（FR-002 / FR-003）

**出参**（tasks.md：「新建项目成功、三 tab 可切换」）——**拆两半据实记**：三 tab ✅ 交付；
**「新建项目成功」不在本 task 交付**（理由与依据见下）。

**落点表**

| 层 | 文件 | 内容 |
|---|---|---|
| 组件 | `packages/app/src/project/project-panel.tsx`（新） | 受控：`projects` / `currentId` / `onOpen` / `onCreate` / `onRestore`；置顶「＋新建项目（私有/共享）」＋ `role="tablist"` 三 tab（默认停「最近」） |
| 接缝 | `packages/app/src/project/project-list.ts`（新） | 模块级 `createSignal<readonly ProjectEntry[] \| undefined>`；**今天没有写入方** |
| 接线 | `packages/app/src/workspace/workspace-entry.tsx` | `▾` / `＋` 开面板；点一行 ⇒ 写 `currentProject` 并收起面板 |
| 组件（改） | `packages/app/src/project/project-anchor.tsx` | `MEMBER_GLYPH` 改**导出**（面板的 `👥 N` 与锚点行是同一设计元素 ⇒ 同一个常量，改一处不会漏另一处） |
| 接缝（改） | `packages/app/src/project/current-project.ts` | 补 `id?: string`（面板靠它认「哪一行是当前」；T018 起还要靠它发 `x-openhive-project`） |
| 验证 | `project-panel.test.tsx`（新，**18 条**）＋ `workspace-entry.test.tsx` 新增 **8 条** | 同 T005：钉结构不钉像素（happy-dom 无 CSS 引擎） |

**四条设计取舍**

1. **三个 tab 是同一份集合的三个视图，过滤在组件里做**——依据是**数据字段**（`type` / `archived`），
   不是调用方给的顺序。否则三份清单只是「碰巧长得像」。
2. **空态文案分两句**——「还没有项目」与「没有已归档的项目」说的不是一件事（后者是「你有项目，
   只是没有归档的」）。写成同一句会把两件事糊成一件，且**不报错、不变红**，所以专门有一条断言钉它。
3. **归档组的行是 `div` 不是 `button`**——它里面还要放「找回」按钮，**按钮不能嵌按钮**（无效 HTML）。
   行的内容（名字 / 当前标记 / 成员数）仍是同一套 `ItemBody`，只有外壳不同。
4. **两个新建按钮渲染成 `disabled`**——`onCreate` 不接线。同 T005 三个按钮的口径：
   一个点了没反应的按钮是对用户的谎，「看起来能点」比「少个按钮」更难查。

**🔒 裁定（2026-10-06，开工前用户裁定）：范围 = 前端面板 ＋ 接缝（同 T005 口径）**

不新增后端 API、不真落库。**依据是侦察实证，不是判断**：① 上游两条链**都没有** `POST /project`（create）；
② `project_ext` 只有读函数（T003）；③ `project_member` / `project_archive` 刻意留白（T004 裁定
「有消费者才写取数」）；④ 客户端今天**零处**发 `x-openhive-project`（`grep` 零命中）——T017 建的契约
**还没有调用方**。⇒「新建项目成功」这个出参**今天不可能交付**，写进 ✅ 就是假记述（`#003-04`）。

**⚠️ 计划缺口 → 补 T018（用户裁定）**

T006 侦察出的缺口：**没有任何 task 认领「建项目 / 列项目」的落库**。于是 T005 的锚点行与 T006 的面板
**两处都只立了缝、没人喂数**。按 `#002-04`（责任推出边界必须落接收方的表），用**新编号 T018** 收
「项目 CRUD 落库 ＋ 列表查询 ＋ HTTP 出口（含建目录）」，编号排最后、**不重排**既有编号——
与 T017 同一条先例。`T017` 文件头「目录由 T006 落地」那句话由此**第二次移交**（T006 → T018）。

**变异验证（7 条；`#003-03`：三类结论都要据实记）**

| 变异 | 结果 | 结论 |
|---|---|---|
| M1 「最近」去掉排序（`.sort(...)` 删掉） | **恰红 1**（「最近按 `lastAccessedAt` 倒序」），对照 17 全绿 | 恰红 |
| M2 「最近」不滤已归档（`活跃()` → `全部()`） | **红 2**（「最近不含已归档项目」＋「点 tab 真的切换内容」——后者在 recent tab 也断内容，**真依赖同一性质**），对照 16 全绿 | 整组红（同一性质的两条） |
| M3 「全部」两组判据反过来（private ↔ shared） | **红 2**（「分两组」的顺序断言 ＋「共享带成员数、私有不带」——后者也靠分组），对照 16 全绿 | 整组红（同一处变异牵动） |
| M4 body 与 tab 解耦（body 恒停「最近」，页签高亮照旧跟手点走） | **红 6**（「内容跟着 tab 走」那一组全红；只断高亮 / 角色的两条**照旧绿**） | 整组红（**且正好反证**：那两条不越权声称自己覆盖了内容） |
| M5 两个空态文案并成一句 | **红 2**（「归档空态 ≠ 最近空态」＋「没项目时三 tab 都走空态」），对照 16 全绿 | 整组红 |
| M6 接线不写 `setCurrentProject`（点一行只收面板） | **恰红 1**（「点一行：锚点行跟着变」），对照 27 全绿 | 恰红 |
| M7 接线不传 `currentId`（`currentId={undefined}`） | **全绿（首次跑：28 pass / 0 fail）** ⇒ **是缺口不是死码**，补一条断言后 **恰红 1** | **先归 ③ 类、再据实改判**（见下） |

**⚠️ M7 逼出来的一条真缺口（本 task 内已补）**

`currentId` 的**组件内部**早有覆盖（`project-panel.test.tsx` 的「当前标记」），缺的是「接线把
`currentProject()?.id` 传下去」**这一根线**——把它换成 `undefined`，全文件 28 条**一条都不红**。
按 `#003-03` ③ 的形态（全绿）该判「被变异的代码不可达 ⇒ 删代码」，**但这里不能照搬**：面板标出当前项目
是设计 §3 明写的**用户可见行为**，死的是**接线**、活的是**组件** ⇒ 处理是**补断言**不是删代码。
补的那条（`workspace-entry.test.tsx`）先在这条变异下跑，**恰红 1 条正是它**，然后回滚变异转绿。
这条测试**出自变异、不是出自最初的 RED 循环**——据实记，不算 TDD 的 RED（`#003-04`）。

**门禁（2026-10-06 实测，本 task 阶段；全程串行，`#003-01`）**

- `packages/app` `bun run test:components`：**235 pass / 0 fail / 22 文件**（T005 基线 209 / 21；
  +18 面板 ＋ +8 接线，22 文件 = 21 + 1 个新文件）。
- `packages/app` `bun run test:unit`：**824 pass / 0 fail / 117 文件**——与 T005 基线**逐项相同**。
- `packages/app` `bun run typecheck`（`tsgo -b`）：**exit 0**。
- `bun run lint:openhive`：**23 warnings / 0 errors / 75 文件 / exit 0**——warnings / errors 与 T002 记下的
  基线（23 / 0）**逐项相同**，文件数 72 → 75 正是本 task 新增的 3 个源文件（含测试），**warnings 一条没多**。
- `bunx oxlint -c script/oxlintrc.openhive.json` 单跑本 task 的 **7 个**文件（在**仓库根**，`#004-10`）：
  **0 warnings / 0 errors / 161 rules**。
- 同一批文件**不带 `-c`**（走根配置）再跑一次：**0 warnings / 0 errors / 130 rules**。
  ⚠️ **两次的 rules 数不同是配置不同（161 = 130 + 30 jsx-a11y + 1），不是基线漂移**——写在这免得
  下一个人拿 130 去对 T005 记的 161（`#001-05` 的恒等式）。
- 根 `bun run lint`：**本轮不重跑**（T005 已实测 4952 warnings / 1 error / exit 1，根 lint 天生是红的，
  `#001-02`）。本 task 的判据改为「**本次新增 / 改动文件 0 命中**」，由上面两条 oxlint 单跑正面取数。
- `git diff --stat bun.lock`：**空**（本 task 没跑过 `bun install`）。

**新实测事实两条（本次第一次踩实，值得下一个人先知道）**

1. **组件测试必须走 `test:components` 的三段式**：`bun test --conditions=browser --preload ./happydom.ts
   --preload ./solid-jsx.ts <file>`。**裸 `bun test <file>` 会把 `solid-js/web` 解析到 server 构建**，
   `render()` 抛 `Client-only API called on the server side.` ⇒ **该文件里所有组件测试全红**。
   本次实测：T005 那条**一直绿**的 `project-anchor.test.tsx` 裸跑同样 **9 fail** ⇒ 「裸跑红了」先怀疑
   **运行方式**，别去改被测代码（同 `#003-06`：先怀疑测量，再怀疑被测物）。
2. **设计文档一处措辞滞后（未改，登记）**：`2026-09-11-项目管理-design.md` §3 写「按
   `project.last_accessed_at` 倒序」，读起来像**上游 `project` 表**；实际裁定（U4 / Q3）是这四个个人态
   字段落**每用户库的 `project_ext`**——该文件 §9 的数据模型**已经是对的**（含 U4/Q3 的落点修正批注），
   只有 §3 那一句没跟上。**属文档措辞、不影响实现**（前端读的是组件 prop，不认识表名），故不在本 task 改，
   登记在此待设计侧收口。

**已知不覆盖（三条；`#002-02`：测不了要写成缺口，不是覆盖）**

1. **项目数据没有任何真实来源**——`projectList` 缝读作 `undefined`，**不是** `[]`。两者是两件事
   （「还没有来源」vs「来源说了『一个都没有』」），文件头写着；接上真数据后空库应给 `[]`。接收方 = **T018**。
2. **钉的是结构，不是像素**——同 T005：happy-dom 没有 CSS 引擎。「面板滑出的位置 / 宽度 / 阴影」
   「两组之间的间隔」这些视觉判据一个都没钉；钉的是槽位、顺序、文本、角色、点了通知谁。
3. **`＋` 的语义是暂定的**——它今天打开面板（面板置顶就是新建入口）。T018 接上落库后要**再定一次**：
   `＋` 继续开面板，还是直达新建表单。已写进 `tasks.md` T006 的「已知不覆盖 ②」。


## 阻塞项

（无）

### T007 · 文件树（FR-005 / 设计 §6）

**出参**（tasks.md：「工具栏图标可用」）＝ 一个**受控组件** ＋ 一条接入缝 ＋ 一次接线：
`packages/app/src/project/file-tree.tsx`（组件）＋ `file-tree.test.tsx`（34 条）＋
`packages/app/src/project/project-files.ts`（接入缝）＋ `workspace-entry.tsx` 的 `file-tree-slot`（＋5 条接线测试）。

**落点表**：

| # | 设计 §6.1 的入口 | 落点 | 判据 |
|---|---|---|---|
| 1 | 🔍 搜索 | `<input data-action="search">`（**真输入框**，不是「点一下弹框」） | 顺序第 1；输入即过滤；`tagName === "INPUT"` |
| 2 | ⊟ 全部收缩 | `button[data-action="collapse-all"]`，图标 `collapse` | 全收后只剩顶层 |
| 3 | ⊞ 全部展开 | `button[data-action="expand-all"]`，图标 `expand` | 与上一动作**互逆** |
| 4 | ＋ 新增 | `button[data-action="create"]` → 下拉两个 `button` | 两项文案、`kind` 各报各的、落点跟选中走 |
| 5 | ✏️ 重命名 | `button[data-action="rename"]`，图标 `pencil-line` | 回传**选中项**路径 |
| 6 | 🗑 删除 | `button[data-action="delete"]`，图标 `trash` | 同上 |
| — | 树本体 | `div[role="tree"]` → 行 `div[role="treeitem"][data-path][data-type][data-level]` | 默认全展开、层级缩进、选中唯一 |

图标名全表实测于 `packages/ui/src/components/icon.tsx`（`collapse` / `expand` / `plus` / `pencil-line` / `trash` / `magnifying-glass` / `chevron-down` / `chevron-right` / `open-file` / `folder`）。
**注意**：设计 §6.1 那张表里的「🔍」**不是**一个图标名——仓库里**没有** `search` 图标，只有 `magnifying-glass`；搜索落成输入框后也不需要图标。

**五条设计取舍**：
1. **底座取 v2 的纯函数 model，不碰上游**（D0-2）——上游 `components/file-tree-v2.tsx` 要 `useFile()`
   （六层 provider），组件测试拖不进来。本组件底座是 `components/file-tree-v2-model.ts` 的
   `buildFileTreeV2Model` / `flattenFileTreeV2`（上游文件**一字未改**），展开态自持。
2. **默认全展开**——镜像 v2 model 那侧 `expanded` 缺省为真的行为（`!live()` ⇒ 全展开）。
3. **搜索 = 纯前端过滤 ＋ 全展开**——过滤后的模型**只含命中项及其祖先**，于是「父级路径自动展开」
   （设计 §6.1 原话）就是「对过滤后的模型不做展开判断」这一件事，不需要单独写一段展开逻辑。
4. **开合归箭头、选中归行**（本 task 唯一一处设计文档没定、由我定的取舍，已在 `tasks.md` T007 标为「待复核」）。
5. **未接线即禁用**（同 T005/T006）：`＋` / 重命名 / 删除 在三个回调都缺席时禁用；
   搜索与全部收缩/展开**恒可用**（它们不依赖任何接收方）。

**🔒 裁定（2026-10-06，用户，开工前问，侦察实证四条）**：
1. **范围 = 「组件＋接缝，先挂锚点行下」**——设计 §2 的 ②[会话][文件] tab 容器今天**不存在**
   （`grep` 全 `tasks.md` 零命中，12 条 FR 也没对应条款），故先把文件树直接挂在锚点行下（＝默认「文件」态）；
   ② 落地时**整块搬进 tab body**，组件一行不改。
2. **计划缺口 → 补 T019**（编号排最后、不重排既有编号，同 T017/T018 先例）。
3. US4 验收标准原文「当前在**『文件』tab**」⇒ ② 是 **T012 的前置**，不补则 T012 无从验收（这是补 T019 的**理由**，不是凑数）。
4. 「会话」tab 里的**会话列表**（设计 §7）**不在 T019 范围内**——可能是别的 feature 的产物，留给裁定。

**变异验证（8 条，全部据实记；对照 = 未红的那些）**：

| # | 变异 | 结果 |
|---|---|---|
| M1 | 搜索时不做「父级自动展开」（`k ? () => true : 展开` → `展开`） | **恰红 1**，对照 33 全绿 |
| M2 | 搜索不过滤（模型恒用全量，只高亮） | 红 3（输入即过滤／父级自动展开／无匹配空态）——三条都**真依赖「过滤」这一性质**，对照 31 全绿 |
| M3 | 选中标记恒真（`selected() === path` → `selected() !== undefined`） | **恰红 1**（「同一时刻只有一行是选中的」），对照 33 全绿 |
| M4 | 落点算错（选中文件也拿它自己当父目录） | **恰红 1**，对照 33 全绿 |
| M5 | 「全部展开」退化成「全部收缩」 | **恰红 1**（互逆那条），对照 33 全绿 |
| M6 | 没选中时回退到第一行（`selected() ?? 行列表()[0]`） | **恰红 1**，对照 33 全绿 |
| M7 | **接线层**：`<FileTree paths={projectFiles()} />` → `<FileTree />` | **恰红 1**，对照 66 全绿 |
| M8 | 两个空态文案并成一句 | 红 2，对照 32 全绿 |

**⚠️ 一处「本来就绿」的测试，据实记（`#003-03`）**：「文件行按 ← / → 不动也不报错」这条
**不是** RED 循环的产物——它在实现前就是绿的（因为当时 `onKeyDown` 根本不存在）。
它是**对照/守行为**的一条：防的是「把方向键也当成选中」，靠的是它后半句
（`data-selected` 仍为 null）。8 条变异没有一条能把它弄红，也不该有——**它的价值在防过宽，不在抓缺失**。

**门禁记录（2026-10-06 实测，全程串行——`#003-01`）**：

| 门 | 结果 | 对照 T006 基线 |
|---|---|---|
| `packages/app` `bun run test:components` | **274 pass / 0 fail / 23 文件** | 235 / 0 / 22 ⇒ ＋39 条、＋1 文件 |
| `packages/app` `bun run test:unit` | **824 pass / 0 fail / 117 文件** | 逐项相同（本次没加非 tsx 测试文件） |
| `bun run typecheck`（根，`tsgo -b`） | **EXIT=0**（31/31 tasks） | 同 |
| `bun run lint:openhive` | **23 warnings / 0 errors / 78 文件 / EXIT=0** | 23 / 0 / 75 ⇒ warnings **一条没多**，文件 ＋3（本次新增 3 个源文件） |
| 仓库根单跑本次改动文件 `bunx oxlint` | **0 warnings / 0 errors**（130 rules；带 `-c script/oxlintrc.openhive.json` 为 161 rules） | — |
| `git diff --stat bun.lock` | **为空**（本次没跑 `bun install`） | — |

> ⚠️ **中途抓到的 4 条 warning 已全部清掉，不是「本来就有」**：首跑 `lint:openhive` 是 **27 warnings**
> （基线 23）——多出的 4 条全在本次新文件里：1 条 `click-events-have-key-events`（**真缺陷**：行可点但键盘不可达）
> ＋ 3 条 `no-unsafe-type-assertion`（测试里的 `as HTMLInputElement` / `as FileTreeAction`）。
> 前者**按 TDD 补了 5 条键盘测试再实现**（RED 4 红／1 绿 → 实现 → 5 绿），后者改用
> `instanceof` 收窄与 `as const`。**没有一条是「记进基线」打发的。**

**新实测事实（两条，供后面的人省一次探针）**：
1. **同层节点的排序随 locale 变**——`file-tree-v2-model.ts` 用 `localeCompare`，本机实测是**拼音序**：
   `["乙","甲"]` → `["甲","乙"]`、`["话单.csv","笔记.md"]` → `["笔记.md","话单.csv"]`（不是码点序：
   乙 U+4E59 < 甲 U+7532 却排在后面）。⇒ 测试里「两个**同层**文件谁在前面」**一律不写**，
   改按名字找行；只有「**目录恒排在文件前**」这一条是 model 用 `type` 定死的，才敢直接比顺序数组。
2. **`aria-expanded` 的类型是 `"true" | "false" | boolean | undefined`，不收 `string`**——
   写 `String(展开(path))` 会让 `typecheck` 报 `TS2322`（`SolidJS` 的 `HTMLAttributes` 比 DOM 的更窄）。
   同理空 `new Set()` 会推成 `Set<unknown>`，要塞进 `ReadonlySet<string>` 得写 `new Set<string>()`。

**已知不覆盖（四条，都是「本机/本 task 内验不了」，不是漏做）**：
1. **新建 / 重命名 / 删除没有落库接收方**——`projectFiles` 缝里**今天没有写入方**，故只验了
   「未接线即禁用」与「接了线喊对回调」；真落库归 **T018**。⇒ 左栏文件树**今天恒走空态**，
   这是**据实显示**，不是占位。
2. **删除二次确认 ＋ 选中点亮/置灰** 按计划归 **T009**（T007 只交付**选中机制本身**）。
3. **搜索是纯前端过滤**（`path.includes(kw)`），不是后端全文检索——设计与 spec 都没要求后端检索。
4. **↑↓ 区间导航没有**（键盘只到 Tab / 回车 / 空格 / ←/→）——理由见 `tasks.md` T007 的键盘条，归 **T019**。

**一处小账（顺手修的，不是本次引入的）**：`## 阻塞项` 的**标题**在 T006 那次插入时被吃掉了，
只剩一个孤零零的 `（无）` 悬在 T006 节与本节之间（`git show HEAD:… | grep -n 阻塞` 零命中可证）。
它**正好落在本次要插入的位置**，且会让本节读起来像「（无）」的内容，故本次**恢复标题**——
两行的事，但留着就是给下一个人一个「这『（无）』是谁的」的坑（`#002-06`：编辑会静默顶掉邻居）。

### T002 · MinIO 部署与目录 / 权限方案

**出参**（tasks.md：「MinIO 目录/权限方案」）＝ **`005-project-management/minio.md`**（本次新建）。
性质：**一份部署约定，不是代码**——`dev_tdd.005.md` D0-4 已实测定性（本机无 MinIO 可连、`packages/*/package.json` 无任何对象存储 SDK），
所以「写得出来、跑不了」是这条的**正常形态**，不是没做完。

**方案要点**（每条都锚在一条裁定上）：

| 要素 | 取值 | 锚 |
|---|---|---|
| 桶 | 单桶 `openhive`（不建 1600 个桶） | 运维面不随人数涨 |
| 对象键 | `{userId}/{projectId}/{沙箱内相对路径}`，与沙箱**恒等镜像** | Q1（各存一份）⇒ `{userId}` 是**调用者自己**的 id |
| 权限 | 服务凭据 ＋ STS 会话；bucket policy 用 `${aws:username}` 钉 `openhive/${aws:username}/*` | Q4（下沉到存储层，宪法 §四） |
| SDK | `@aws-sdk/client-s3` | D0-4 |
| 应用侧形状 | **窄接口**（put/get/list/delete，入参**不带**桶名与前缀）＋ 测试注入替身 | runbook D0-4 ③ ＋ `LEARNINGS #002-02`（防「测替身」的假测试） |
| 过期策略 | 不配自动过期 | 找回手动且无期限，自动过期 = 静默丢证据 |

**移交（`LEARNINGS #002-04`：责任推出边界必须落接收方的表）**：部署侧两笔已落 `docs/workspace/deploy-todo.md`
**D-13**（建桶 ＋ 策略 ＋ **实测策略变量是否生效**——`plan.md` R7 点名的唯一风险）与
**D-14**（`/shared` 共享卷，Q2 的 bare 仓库落点）。两条的「怎么验」都写了**反向判据**
（D-13：同会话上传别人的前缀**应被拒**；D-14：**冲突那一半**要验，不是只验能 push）。

**本 task 未闭合的账**：`minio.md` §5 列了五条指向，其中「策略变量是否生效」**只能在目标环境验**
（本机与替身都验不了——替身会把存储层的拒绝一起假掉）。

### T008 · 文件树右键菜单（FR-005 / 设计 §6.2）

**出参**（tasks.md：「右键菜单完整操作」）＝ **同一个组件上的扩写**（不新增文件）：
`packages/app/src/project/file-tree.tsx`（`FileTreeMenuItem` 联合类型 ＋ 6 个回调 props ＋ 一份 `ContextMenu` 根）
＋ `packages/app/src/project/file-tree.test.tsx`（＋19 条 ⇒ **53 条**）。

**落点表**（设计 §6.2 的十项，顺序即表里的行序）：

| # | 菜单项 | `data-action` | 禁用条件 | 回传 |
|---|---|---|---|---|
| 1 | 新建文件 | `create-file` | `!onCreate` | `{ kind: "file", parent: 落点 }` |
| 2 | 新建文件夹 | `create-dir` | `!onCreate` | `{ kind: "directory", parent: 落点 }` |
| — | 分隔符 | | | |
| 3 | 重命名 | `rename` | 需对象 | 右键那一行的 path |
| 4 | 复制 | `copy` | 需对象 | 同上 |
| 5 | 移动 | `move` | 需对象 | 同上 |
| 6 | 删除 | `delete` | 需对象 | 同上 |
| — | 分隔符 | | | |
| 7 | 上传 | `upload` | `!onUpload` | 同上（**无对象时 ＝ 根**） |
| 8 | 下载 | `download` | 需对象 | 同上 |
| — | 分隔符 | | | |
| 9 | 备份到 MinIO | `backup` | 需对象 | 同上 |
| 10 | 从 MinIO 拉回 | `restore` | 需对象 | 同上 |

**探明的 Kobalte 契约（六条，下次不必再探）**：
1. **无需任何 provider** 即可渲染（`SidebarProject` 也在用，属既有可复用件）。
2. Portal 到 `document.body`（**不在 host 里**，测试要用 `document.querySelector` 而不是 `host.querySelector`）。
3. `data-component="context-menu-content"` 是**内容**的钩子；Trigger／Item 走 `data-slot`。
   ⚠️ `data-slot` 挂在 Trigger 上会被外层封装**强制覆盖**成 `context-menu-trigger`。
4. `onSelect` 由 **pointerdown ＋ pointerup** 触发——单独 `.click()` **不够**（`menu-item-base.tsx`）。
5. 关闭是 `setTimeout(() => menuContext.close(true))` ＋ `context-menu.css` 的退场动画
   ⇒ **判「开着没」要看 `data-expanded` 属性，不能看元素在不在 DOM 里**（happy-dom 没有 CSS 引擎，退场动画永不结束，元素永不卸载）。
6. `disabled` 的项带 `aria-disabled="true"` ＋ `data-disabled`（判禁用看这两个，不看 `disabled` 属性）。

**唯一一处设计取舍（设计文档未定，我定的，待复核）——两套当前项**：
「工具栏作用于**选中项**、菜单作用于**右键那一行**」。四个推论：
① 一份 `ContextMenu` 根（不是每行一个）；② Trigger ＝ 树区域（行 ＋ 空态），**工具栏不在里面**；
③ **右键不改选中态**；④ 「需对象」的七项在没有对象时禁用，而**新建两项与上传不受影响**
（它们要的是**落点目录**，没有对象时落点 ＝ 根）。已用一条测试钉住第 ④ 条。

**实现踩到的坑（写成注释落在触发点旁边了）**：`ContextMenu.Trigger` 会 `splitProps` 掉 `onContextMenu`，
非 `disabled` 分支 `preventDefault()` ＋ `stopPropagation()` 之后**不调用**外部传进来的那个
⇒ 挂在 Trigger 上的 `onContextMenu` **静默失效**（菜单照开，作用对象永远是「没有」）。
修法：挂在 **Trigger 内层**的 `data-slot="file-tree-region"` 上。**首轮 GREEN 13 条红**正是这么抓出来的。

**变异验证（6 条，`#003-03` 三类据实记）**：

| # | 变异 | 红的集合 | 类别 |
|---|---|---|---|
| M1 | `要对象` 去掉 `!菜单对象()` | **恰红 1** | ① 恰红 |
| M2 | 菜单作用对象改读 `selected()` | **整组红 13** | ② 整组红 |
| M3 | 少画一个分隔符 | **恰红 1** | ① 恰红 |
| M4 | 上传也判成「需对象」 | **恰红 1** | ① 恰红 |
| M5 | rename 错接到 `onDelete` | **恰红 1** | ① 恰红 |
| M6 | `记对象` 挂回 Trigger（复现实现期的坑） | **整组红 13** | ② 整组红 |

M2／M6 属第 ② 类而非①，**据实记**：两条都让「作用对象」整体失效 ⇒ 所有依赖对象的断言一起红。
M4 是**补出来的**——变异前发现「上传不需要作用对象」这条没被钉住（M4 不会红），补断言后先跑 M4 证明**恰红 1**，再回滚。

**门禁（2026-10-06 实测，全程串行，`#003-01`）**：

| 门 | 结果 | 与基线比 |
|---|---|---|
| `test:components` | **293 pass / 0 fail / 23 文件** | 基线 274 ⇒ ＋19 正好 |
| `test:unit` | **824 pass / 0 fail / 117 文件** | 与基线**逐项相同** |
| `bun run typecheck` | **31/31 successful，EXIT=0** | 缓存命中 30，只有 `app` 重跑 |
| `bun run lint:openhive` | **23 warnings / 0 errors / 78 文件 / EXIT=0** | 与基线**逐项相同**，本次新文件 **0 命中** |
| 仓库根单跑改动两文件 `bunx oxlint` | **0 warnings / 0 errors（130 rules）** | `#004-10`：必须在仓库根 |

**已知不覆盖（两条）**：① 十项**全部只喊回调**，没有落库接收方（同 T007 那条账），归 **T018**；
② **备份 / 拉回**的真执行归 **T011／T012**。

**🚩 计划缺口 → 已补 T020（2026-10-06，用户裁定「补，phase 你定」）**：**复制 / 移动 / 上传 / 下载 四个动作在 `tasks.md` 里没有任何任务认领**——
`grep` 全文只命中 T008 这一行（且只到「菜单」为止）与 T013／T014（MinIO 的归档 / 找回）。
D0-2 已实测上游**没有**这四个动作 ⇒ 它们是**要新做的功能**，T008 只落了菜单入口。
已按 T017／T018／T019 先例补 **T020**（编号排最后、不重排既有编号，**归 Phase 4**）。

**十项的接收方（逐项点名，`#002-04`）**：① 新建两项 ＋ 重命名 ＋ 删除（4）⇒ **T018**；
② 复制 ／ 移动 ／ 上传 ／ 下载（4）⇒ **T020**；③ 备份 ／ 拉回（2）⇒ **T011／T012**。合计 10，不重不漏。

**一处小账（顺手修的，不是本次引入的）**：本次插入本节点时发现，**`### T002 · MinIO 部署与目录 / 权限方案`
这一行标题在上一次（T007）插入节点时被整个顶掉了**——正文还在、标题没了，于是 T002 的正文读起来像是 T007 的续篇。
`git diff 6afafc08e7 adfa4f936f -- …/state.md` 可见 `-### T002 …` / `+### T007 …` 两行成对，可证。
本次**恢复标题**。⚠️ 这与 T007 那节记的「`## 阻塞项` 标题被吃掉」是**同一次编辑的同一类误伤**
（`#002-06`：编辑会静默顶掉邻居）——**下一次往长文档中段插内容时，插完先 `grep '^#'` 数一遍标题**。

### T009 · 删除二次确认 ＋ 选中点亮 / 置灰（FR-006 / 设计 §6.1）

**交付**：`packages/app/src/project/file-tree.tsx`（`待删` 信号 ＋ **内联确认条** ＋ `禁用`／`点`／`点删`／`确认删` 四处 ＋
`TOOL_BUTTON_DANGER` 常量）＋ `packages/app/src/project/file-tree.test.tsx`（＋13 条 ⇒ **66 条**）。
测试命令同 T007／T008 的三段式（`--conditions=browser` ＋ 两个 `--preload`）。

**裁定（2026-10-06，用户）：二次确认用「内联确认条」，不用 `Dialog`。**
`packages/ui` 的 `Dialog` 走 `useI18n()` ＋ `Kobalte.Content`，**要 provider**；而本组件从 T005 起就是
「能脱离六层 provider 单独渲染」的受控组件（T005 / T006 / T007 / T008 的每一组测试都不带 provider）。
实测 `packages/app/src/components/` 下用 `Dialog` 的 10 个组件**测试数为 0**——把它拖进来等于给这一小块
另开一套测试地基，代价与收益不成比例。确认条内联在树下方，用户的眼睛本来就在那儿。

**一条确认条、两个入口**：工具栏 🗑 与右键菜单「删除」共用一份 `待删` 信号 ＋ 一个 `点删(path)` ⇒
「不分入口」是**结构上**成立的（`#004-02` 的同型手法），不是两处各写一遍靠注释约定同步。

**「点亮变红」为什么不追加 class**：`TOOL_BUTTON` 里写死了 `text-v2-text-text-muted`；若在它之上再追加
`text-v2-state-fg-danger`，两个同权重的文本色类同时在元素上时谁生效取决于 **CSS 里的先后**（不是 class 属性顺序）
⇒ 那会是一个「看着该红、实际不一定红」的写法。故另起 `TOOL_BUTTON_DANGER` 整体替换（`#003-05` 假镜像的同族）。

**顺带补了 T007 的漏项**：设计 §6.1 最后一条「悬停给 tooltip 提示动作名」——工具栏五个图标此前只有 `aria-label`，
本次补 `title`；搜索框**不加**（它是输入框不是图标，名字由 `aria-label` ＋ `placeholder` 承担，再挂 `title` 是三重冗余）。

**两条既有用例按新行为更新（是设计变更，不是「改测试迁就代码」）**：T007 的「回传的是选中项的路径」与
T008 的「删除走的是工具栏那个 onDelete」各补一次确认点击。后者另补「确认条开着 ＋ 此刻未喊」的前置断言——
它在变异 M3 下暴露过**假绿**：只断言终值的话，一个「直接喊」的实现照样满足。

**门禁（串行跑，2026-10-06）**：

| 门 | 结果 | 对照 |
|---|---|---|
| `packages/app` `test:components` | **306 pass / 0 fail / 23 文件** | T008 基线 293 ⇒ ＋13 |
| `packages/app` `test:unit` | **824 pass / 0 fail / 117 文件** | 与基线相同 |
| `bun run typecheck` | **31/31，EXIT=0** | 同基线 |
| `bun run lint:openhive` | **23 warnings / 0 errors / 78 文件 / EXIT=0** | 与基线逐项相同 |
| `bun run lint` | **改动文件 0 命中** | 命中项里的 `packages/app/src/components/file-tree.tsx` 是**上游既有**文件，与新写的 `project/file-tree.tsx` **同名不同物** |

**变异（串行跑，据实记 `#003-03`，全部为①类恰红）**：M1 去掉 `|| !selected()` ⇒ 恰红 **2**；
M2 工具栏绕过确认 ⇒ 恰红 **5**（右键两条不红 ⇒ 入口隔离成立）；M3 菜单绕过确认 ⇒ 恰红 **3**；
M5 `确认删` 喊 `selected()` 而非 `待删()` ⇒ 恰红 **2**；M6 danger class 回退 ⇒ 恰红 **1**。

**已知边界（未测、未要求，写明免得看着像漏，`#002-02`）**：① 确认条开着时改选别的行，条上写的仍是
**原来那一项**（跟着 `待删` 走、不跟 `selected`）——测试只覆盖了「先取消、再选」这条路径；
② 确认删除后 `selected()` **不清空**（树内容由父组件经 `paths` 受控，选中项是否随之失效不在本组件职责内）。

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
- **U2 / U3** 未裁（案件实体无 task / 超期提醒触发者）——按 `dev_tdd.005.md` 的节奏在对应 task 开工前裁定。**U6（FR-012 并发靠 git）已由 Q2 解决**（载体＝`/shared/{projectId}.git`）；**U8 已由第二批默认执行**；**U7 已由第四批裁定**（半条 ＋ 落 007 的表）。

**门禁基线（2026-10-06 实测，T002 阶段快照）**：`bun run lint:openhive`

```
Found 23 warnings and 0 errors.
Finished in 1.3s on 69 files with 161 rules using 12 threads.   EXIT=0
```

**按规则名归并**（`LEARNINGS #001-01`：判「有没有变坏」看**规则名 ＋ 文件行**，不看总数——12 线程下总数有抖动）：

| 条数 | 规则 |
|---|---|
| 17 | `typescript-eslint(no-unnecessary-type-assertion)` |
| 2 | `typescript-eslint(unbound-method)` |
| 1 | `typescript-eslint(no-unsafe-type-assertion)` |
| 1 | `typescript-eslint(no-misused-spread)` |
| 1 | `eslint-plugin-unicorn(no-new-array)` |
| 1 | `eslint-plugin-jsx-a11y(click-events-have-key-events)` |

**这是一条真实基线，不是抄的**（`LEARNINGS #001-02` / `#002-06`）：退出码 **0**、23 条全在 `warn` 级、**零 error**。
⚠️ 因此本 feature 的门禁判据必须是「**本次新增 / 改动文件 0 命中**」，**不是**「全局 0 warning」——
全局基线本来就带着这 23 条存量（`#001-02` 的第二条：存量未清零前不许把门升成 error）。
⚠️ **`161 rules` 与「5 个自有目录」对得上**：本 feature 若新增 `app/src/project/` 而**忘改 3 处目录清单**，
这个门会**静默扫不到新文件**（第二步已裁，见「第二批」表的 ⑤ 行）。

### 第四批：T003 收尾裁定（2026-10-06，同一天）——两条我拆不动的

**为什么到 T003 收尾才裁**：这两条都是 T003 **做出来才显形**的，不是开工前就能预见的——① U7 是「004 移交来的判据在本 feature 里到底验到哪一步」，「验不了」这个事实要等 `project_member` 的表**摆在眼前**才看得清；② T017 的孤儿是 `plan.md` 的 D0-1 落地口径**只有一句话、没有主人**，而那句话要到 T003 把 `findByProjectID` 交到接口级才暴露（接口有了，接线的 task 却没有）。

| # | 事项 | 裁定 | 落点 |
|---|---|---|---|
| **U7** | T004 的「半条」判据怎么落——判据「工作空间成员身份不改变数据访问结果」**要两轴的表都在**才验得了，而数据轴那半（`fund_project_member`）在 `007-fund-analysis` T004 | **半条 ＋ 落 007 的表**：005 的 T004 只做工作空间轴那半并**自验能验的全部**（owner/member 权责、邀请/移除/退群、归档后失权 / owner 保留找回）；**完整判据显式写进 `007-fund-analysis/tasks.md` 的 📥 块**（`LEARNINGS #002-04`：责任推出边界必须落**接收方**的表，不能只写在自己文档里）。⚠️ 005 一侧出参**收窄**为「**工作空间轴**判定单测通过」——**不得**写成「两轴解耦已验证」（`#002-02`：测不了要写成缺口，不是覆盖） | 005 `tasks.md` T004 的 🔒 U7 行 ／ 007 `tasks.md` 第三笔 📥 块 |
| **T017** | T003 逼出来的**孤儿**：`plan.md` 的 D0-1 落地口径原文「建会话时服务端查 `project_ext` 拼出 `join(sandbox, dir)` 写进 `session.directory`」**不在 T003 / T005 / T006 / T016 任何一条的文字里** | **在 005 内补一条 T017**（不推出 feature、不等 007）：建会话时按 `projectId` 查 `project_ext` 拼目录写进 `session.directory`；`anchor-workspace.ts` **一字不动**；**判据必须含回归断言**「客户端自填目录（含 `../../` 逃逸写法）仍然无效」；查不到落沙箱根，**不做隐式建项目**（与 U4 的「写入收成一个模块」一致） | `tasks.md` T017（归属 Phase 2，取**末号不重排**） |

⚠️ **编号说明**：T017 是**补**进 Phase 2 的（Phase 2 已有 T003/T004），故取末号而**不重排**既有编号——编号是 **ID 不是顺序**（同 `LEARNINGS.md` 的条目号规则）。已写进 `tasks.md` 并行组的 📌 行。

📌 **同型先例**：这两条都是「**责任推到边界外，接收方不知道**」的形状（`LEARNINGS #002-04`）。本次的处理一律是**落进接收方的表**：U7 落 007 的 📥 块，T017 落 005 自己的 tasks.md（它没被推出本 feature，只是原先没有主人）。

## 跨 feature 备注（2026-10-06，本次实测发现 · 未处理）

### 补记（T008 收尾，2026-10-06）：`2026-09-11-项目管理-design.md` 的 FR 引用**整体指向一份旧 spec**

T008 收尾时要给「复制／移动／上传／下载」找需求锚，才发现设计文档里那串 `FR-0xx` **对不上现行的 005 spec**：

| 设计文档引用 | 现行 005 `spec.md` 里有吗 |
|---|---|
| `FR-008`、`FR-010` | ✅ 有 |
| `FR-015`、`FR-016`、`FR-017`、`FR-025`、`FR-033`、`FR-034`、`FR-036`、`FR-041`、`FR-044` | ❌ **均无** |

取数：`grep -o "FR-[0-9]\{3\}" docs/superpowers/specs/2026-09-11-项目管理-design.md | sort -u`（11 个）
对 `…/005-project-management/spec.md`（**只有 FR-001…FR-012**）。设计文档在 8 处把这些编号标成「**前端 spec** FR-0xx」，
指的是 001／002 时代那份 `002-openhive-frontend-ui`（`001-platform-foundation/plan.md` 与 `002-auth-account/plan.md` 各有一处引用它在先）；
**那份文档不在本仓库**（`grep -rn` 全仓零命中）。⇒ 005 的 spec 是**后来重写**的（新编号体系），设计文档没跟着改。

另有一处**张冠李戴**：设计 §6.3 给「拖拽 A」标的出处是 `design-v2 §9.2`，
而 `2026-09-06-openhive-design-v2.md` 的 §9.2 是「**文档编辑方式：拖拽出 ↔ 拖拽回**」（中栏文档），**不是**文件树的上传下载。

**处理（本次）**：**不改设计文档**（它是该模块的开工依据，改动权归下次动它的 feature），只在
`tasks.md` 的 T020 条目里把需求锚**落到现行编号**（`FR-005` ＋ US2 验收场景 3），并把上面这张对照表记在此处。
⚠️ **凡引用本设计文档的 FR 编号前，先回 005 spec 核一遍**——照抄会引到不存在的条款（`#003-04`：不实记述）。

`006-ai-session` / `007-fund-analysis` / `009-ai-assets` / `010-governance-console` 四份 plan/spec 里写有「**capability 三层拦截已由 F4 落地**」「复用 F4 权限」之类表述。这与 004 自己的交班对不上：004 明说 `AccessCapability` / `AccessIssue` **契约零生产调用点、留给 F6/F7**；本次实测复核为真（`grep` 命中全部落在 `packages/core/src/access/` 定义处与 `packages/core/test/`，`src` 下 access 目录之外**零调用点**）。

**用户裁定（2026-10-06）：本次不动那四份文档，只在此记一笔。** 理由：它们是各自 feature 的开工依据，应由那些 feature 开工时像本部 U5 一样**自己实测**再钉（这正是 U5 被抓出来的方式）。**005 不受影响**——U5 已裁定 `project_member` 不接 capability。

## 最后更新
2026-10-06（**补 T020（用户裁定「补，phase 你定」）**：T008 侦察出「复制／移动／上传／下载」四个动作**零任务认领** ⇒ 补 **T020**、归 **Phase 4**（US2），依赖 `[T007][T008][T018]`。补之前先做了一轮**只读侦察**（上游到底有没有现成能力），五条实证已落 T020 条目：① 上游**文件路由全是只读**（新 HttpApi 与旧 protocol v2 两套都只有 read／list／find，**无 write／create／delete／rename／move／copy**）；② 单文件 **copy／move／rename 无任何端点或服务**——唯一「单文件移动」先例是 `packages/opencode/src/tool/apply_patch.ts` 的 `move_path` 分支（**写新 ＋ 删旧**两步），而 V2 那侧明确 **not supported**；可复用底座是 `core/src/file-mutation.ts` 的 `FileMutation.Service`（`create`/`write`/`remove`）；③ **multipart 上传端点全仓查无** ⇒ 要新增；④ 下载最贴近的是 `GET /api/fs/read/*` 返回原始字节、**缺 `Content-Disposition: attachment`**；⑤ 客户端上传／下载**有先例可抄**（`dialog-edit-project.tsx` 的 `<input type="file">`＋onDrop、`session-ui` 的 `prompt-input/attachments.ts` 完整拖放、`utils/session-export.ts` 的 `downloadSessionExport`）。**同时给 T018 补范围第 ⑤ 条「文件列表读取」**（`project-files.ts` 早把这条账挂给 T018，但**接收方的表里此前没有它**，`#002-04`）——不补则 T020 开工才发现「没有列文件就没有可操作的对象」。另记一笔：设计文档 11 个 FR 引用里 **9 个在现行 005 spec 里不存在**（旧前端 spec `002-openhive-frontend-ui` 的编号），见「跨 feature 备注」补记）
2026-10-06（**T008 收尾**：`file-tree.tsx` 扩出右键菜单——**复用 `@opencode-ai/ui/context-menu`（Kobalte），不手写**；十项按设计 §6.2 落地（新建文件／新建文件夹｜重命名／复制／移动／删除｜上传／下载｜备份到 MinIO／从 MinIO 拉回），四组三分隔符。**不新增文件**，只有 `file-tree.tsx` ＋ `file-tree.test.tsx`（＋19 条 ⇒ **53 条**）。本 task 首轮 GREEN **13 条红**，根因是 `ContextMenu.Trigger` **吞掉外部 `onContextMenu`**（`splitProps` ＋ `preventDefault()` 后不调用）⇒ 挪到 Trigger 内层即解。**6 处变异**：M1／M3／M4／M5 恰红 1，**M2／M6 整组红 13**（据实记，`#003-03` 第②类）；**M4 是补出来的**——变异前先补断言证明能抓，再跑。四道门禁串行全过（`test:components` **293 pass / 23 文件**（基线 274＋19）／ `test:unit` **824 pass** 逐项同基线／ typecheck **31/31** exit 0 ／ `lint:openhive` **23 / 0 / 78 文件** 逐项同基线、新文件 0 命中 ／ 改动两文件 oxlint **0/0**）。**六条 Kobalte 契约已落 `state.md`**（内容钩子是 `data-component`、Trigger/Item 是 `data-slot`；`onSelect` 要 pointerdown＋pointerup；关闭看 `data-expanded` 不看元素在不在）。**一处设计取舍（我定的，待复核）**：工具栏作用于选中项、菜单作用于右键那一行——**两套当前项**。**🚩 计划缺口**：复制／移动／上传／下载**四个动作零任务认领**（grep 已核实），待裁定是否补编号。**顺手恢复被 T007 那次编辑顶掉的 `### T002` 标题**。下一步 = T009。见「T008」节）
2026-10-06（**T007 收尾**：新建 `app/src/project/file-tree.tsx`（受控组件，**不依赖 `useFile()`**——底座取 `components/file-tree-v2-model.ts` 的纯函数，上游一字未改）＋ `file-tree.test.tsx`（34 条）＋ 接入缝 `project-files.ts`；`workspace-entry.tsx` 把文件树**挂到锚点行下**（`file-tree-slot`，＋5 条接线测试）。工具栏六入口全落地（搜索＝真输入框／全部收缩／全部展开／＋下拉两项／重命名／删除）。本 task 34 ＋ 接线 5 = **39 条全绿**（`test:components` **274 pass / 23 文件**）；**8 处变异**：6 处恰红、M2 红 3（都真依赖「过滤」）、M8 红 2，**M7 是接线层的恰红**（断 `projectFiles()` 那根线 ⇒ 接线测试恰红 1）。**门禁首跑抓到 4 条新 warning**（27 vs 基线 23）——1 条是真 a11y 缺陷（行可点但键盘不可达）**按 TDD 补 5 条键盘测试再实现**，3 条是测试里的危险强转，全部清掉后回到 **23 / 0 / 78 文件 / exit 0**；四道门禁串行全过（`test:unit` **824 pass** ／ typecheck exit 0 ／ 改动文件 oxlint **0/0** ／ `bun.lock` 为空）。**两条新实测事实**：同层节点排序随 locale（本机拼音序）⇒ 测试按名字找行不按顺序；`aria-expanded` 类型不收 `string`、空 `new Set()` 推成 `Set<unknown>`。**计划缺口补 T019**（左栏 ② tab 容器 ＋ ④ MinIO 窄条；US4 验收原文依赖 ②）＋ 顺手恢复被 T006 吃掉的 `## 阻塞项` 标题。下一步 = T008。见「T007」节）
2026-10-06（**T006 收尾**：新建 `app/src/project/project-panel.tsx`（受控组件：置顶「＋新建私有/共享」＋ 最近/全部/已归档三 tab；「全部」按 `type` 分两组、「最近」按 `lastAccessedAt` 倒序、空态**分两句**）＋ `project-list.ts`（接入缝）；`workspace-entry.tsx` 把 `▾`/`＋` 接到面板、点一行回写 `currentProject` 并收起；`project-anchor.tsx` 的 `MEMBER_GLYPH` 改导出、`current-project.ts` 补 `id`。本 task 18 ＋ 接线 8 = **26 条全绿**（`test:components` **235 pass / 22 文件**）；7 处变异：5 处恰红、M2/M3/M4/M5 整组红（都据实记），**M7 第一次全绿**——由此抓出真缺口「接线没把 `currentId` 传下去」并**补一条断言**（在变异下恰红 1 后转绿）。四道门禁串行全过（`test:unit` **824 pass** ／ typecheck exit 0 ／ `lint:openhive` 23 warnings·0 errors·exit 0，warnings 与基线逐项相同 ／ 7 个改动文件 oxlint **0/0**）。**出参拆两半**：「三 tab 可切换」交付、「新建项目成功」**不交付**（无落库接收方，两个按钮 disabled）；缺口按用户裁定**补 T018**。**两条新实测事实**：组件测试必须走 `test:components` 三段式（裸跑全红）；设计 §3 一处措辞滞后（登记未改）。下一步 = T007。见「T006」节）
2026-10-06（**T005 收尾**：新建 `app/src/project/project-anchor.tsx`（受控组件）＋ `current-project.ts`（空态接缝）＋ `workspace-entry.tsx` 把 `ThreePane` 的 `left` 槽接上（＋20/−2）；新增目录已同步进 **3 处清单**（⑤ 前置的原文「单独一次提交」**实测做不到**，已改口径）。本 task 自身 9 ＋ 接线 5 = **14 条全绿**；7 处变异：6 处恰红、M3 整组红（预期），**M2 第一次跑挂死**——由此抓出真缺陷「`expect(<Solid 节点>).toBeNull()` 失败时打印器停不下来，红变哑」，本 task 新写的 3 条已改成断布尔；既有 4 处同形状断言**留原样挂账**。四道门禁串行全过（`test:components` **209 pass** ／ `test:unit` **824 pass** ／ typecheck exit 0 ／ `lint:openhive` 23 warnings·0 errors·exit 0 ／ 根 lint 本 task 文件 **0 命中**，非空绿）。**一笔待设计侧复核**：成员徽章 `👥`（图标集无 people/users 一档）。下一步 = T006（顺带接掉「谁喂真实项目数据」这条欠账）。见「T005」节）
