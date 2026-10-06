# 实施进度 · 项目管理（工作空间轴）

## 当前任务
T001（定位）✅ ／ T002（MinIO 目录与权限方案）✅ ／ T003（`project_ext` 表 ＋ 建表钩子）✅ ／ T004（`project_member` ＋ `project_archive` ＋ 微信群模型判定）✅ —— 见「已完成」。
**下一步 = T017**（「当前项目」身份的落地口径：建会话时按 `projectId` 查 `project_ext` 拼 `session.directory`），依赖 T003 已满足。
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

## 阻塞项
（无）

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

`006-ai-session` / `007-fund-analysis` / `009-ai-assets` / `010-governance-console` 四份 plan/spec 里写有「**capability 三层拦截已由 F4 落地**」「复用 F4 权限」之类表述。这与 004 自己的交班对不上：004 明说 `AccessCapability` / `AccessIssue` **契约零生产调用点、留给 F6/F7**；本次实测复核为真（`grep` 命中全部落在 `packages/core/src/access/` 定义处与 `packages/core/test/`，`src` 下 access 目录之外**零调用点**）。

**用户裁定（2026-10-06）：本次不动那四份文档，只在此记一笔。** 理由：它们是各自 feature 的开工依据，应由那些 feature 开工时像本部 U5 一样**自己实测**再钉（这正是 U5 被抓出来的方式）。**005 不受影响**——U5 已裁定 `project_member` 不接 capability。

## 最后更新
2026-10-06（**T004 收尾**：`project_member` ＋ `project_archive` 两表落 auth 的 `0005` 迁移，判定落 core 纯函数 `project/membership.ts`，防漂移断言落 opencode；本 task 自身 25 条（16＋8＋1）全绿，8 处变异全部恰红、已还原。新裁定一笔「**归档 = 冻结**」。下一步 = T017。见「T004」节）
