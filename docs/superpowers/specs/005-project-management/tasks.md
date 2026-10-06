# Tasks: 项目管理（工作空间轴）

**Input**: `docs/superpowers/specs/005-project-management/`

**Prerequisites**: spec.md（用户故事）、plan.md（结构 / 集成点）、F1 三栏 + F3 沙箱已落地

> 📥 **接收自 F4 的移交（2026-10-04，用户裁定）——半条**：004-access-control 的 **T011（数据轴 /
> 工作空间轴两套权限解耦）** 的工作空间轴一半落到本文件 **T004**（`project_member` 表 + 微信群模型
> 权限判定）。判据「**工作空间成员身份不改变数据访问结果**」需要**两轴的表都在**才验得了：
> 数据轴那半在 `007-fund-analysis` T004（`fund_project_member`）。完整移交说明见
> `007-fund-analysis/tasks.md` 的文件头 📥 块。

**Tests**: 以「受影响 package 的 bun test」覆盖成员权限判定、归档/找回状态流转。

## 任务格式约定

- `[P]` = 可并行（不同文件、无依赖）
- `[USn]` = 所属用户故事
- `[FE]` = 前端 / `[INT]` = 前后端集成 / `[BE]` = 后端。
- `[FE]` 任务标注「换皮」或「新增」：**换皮** = 改 opencode 已有组件 token（如原生文件树）；**新增** = 新建 openhive 组件（项目面板/成员面板/MinIO 双树）。token 映射见 plan.md「前端换皮区」。
- 每条含 `[FR-x 来源] [依赖任务] [出参验证方式]`

## Phase 1: Setup（定位 + 方案锁定）

- [x] T001 [P] [INT] 定位 opencode 原生 project 表与文件树组件，产出改造落点 [FR-001] [无依赖] [出参：project 表/文件树真实入口清单]
  - ✅ 清单落 `state.md` 的「T001 · 定位」节：`project` 表生产入口 **6 处**（U4 下全不改）／文件树**同名 3 个、活跃 2 条链**／左栏是**无人认领的空槽**／`{project}` 段 HTTP 层**不存在**／新增目录要同时改 **3 处**。
- [x] T002 [P] [BE] 确定 MinIO 部署与目录结构 `/minio/{userId}/{projectId}/` [FR-007] [无依赖] [出参：MinIO 目录/权限方案]
  - ✅ **出参落 `005-project-management/minio.md`**（单桶 `openhive` ＋ 对象键 `{userId}/{projectId}/{沙箱内相对路径}` 恒等镜像沙箱 ＋ bucket policy 用 `${aws:username}` 钉前缀 ＋ `@aws-sdk/client-s3` ＋ 窄接口约束）。**部署侧动作落 `deploy-todo.md` 的 D-13（建桶/策略/实测策略变量）与 D-14（`/shared` 共享卷）**。本机无 MinIO 可连 ⇒ 方案可写、效果验不了，如实标注。
  - 🔒 **Q1 裁定（2026-10-06）：路径带 userId**——沙箱各自独立、MinIO 镜像**各人自己的**沙箱 ⇒ `/minio/{userId}/{projectId}/`（对象键 `{userId}/{projectId}/…`），桶名下**不带 userId**。原写的路径形态保留，本裁定确认其依据（曾有两组自相矛盾的写法，见 `state.md`「第三批」的矛盾点表）。
  - 🔒 **Q4 裁定（2026-10-06）：权限下沉到存储层**——应用持服务凭据，policy 用 `${aws:username}` 钉前缀 `openhive/${aws:username}/*`。
  - ⚠️ **出方案时必须实测内网 MinIO 版本是否支持 policy 变量/STS**（plan.md R7）；不支持就退到「服务凭据 ＋ 应用层前缀」并**显式记成缺口**——不许把降级写成已覆盖（`LEARNINGS #002-02`）。
  - 📤 **部署项（U8）落 `docs/workspace/deploy-todo.md` 的 D 表**：endpoint / 凭据来源 / 桶创建 / `/shared` 共享卷（Q2）。

## Phase 2: Foundational（数据模型 + 权限）

- [x] T003 [BE] 实现 **openhive 自有 `project_ext` 表**（**个人态 4 字段**：type / project_type / shared_directory / last_accessed_at）＋建表钩子（挂 fork 自有的 `core/src/database/router.ts`；上游 `project/sql.ts` 与 `database/migration/` **一字不动**）[FR-008] [T001] [出参：新表建成、typecheck 通过]
  - ✅ **出参落地**：`packages/core/src/project/ext.ts`（表 `ProjectExtTable` ＋ `migration` ＋ `findByProjectID`）／`packages/core/src/database/router.ts` 的 `Layer.tap` 钩子／`packages/core/test/project-ext.test.ts` **5 条用例全绿**。
    **建表机制**：不走上游 `database/migration/`（那是上游清单＋生成物），改借上游**已导出**的 `DatabaseMigration.applyOnly(db, input)`——它接受任意 `Migration[]`、借同一本 `migration` journal 记账、幂等重放。钩子挂在每用户库那一层（`Layer.fresh` 之后），与上游 `apply()` 同一次建库。**实装落点修正**：原图写在 `opencode/project/project-ext.ts`，但建表要用表定义、而 **core 不能 import opencode**，故合并进 `core/project/ext.ts`（plan.md 的文件树与 Structure Decision 已同步改，全文只有那一处引用过旧路径）。
  - 🔒 **U4 裁定（2026-10-06）：另起表，不加列**——宪法行 57 的处方原话「新增独立文件/表；不碰表结构」。原出参「加列后 typecheck 通过」已作废。
  - 🔒 **Q3 裁定（2026-10-06）：六字段拆开落，本表只留个人态 4 个**——`type` / `project_type` / `shared_directory` / `last_accessed_at` 落**每用户库** `project_ext`；`archived` / `archived_at` 移出，落业务 PG 的 `project_archive`（见 T004）。理由：FR-010「归档后成员失权」要求归档状态是**项目级共享态**。
  - 🔒 **D0-1 裁定（2026-10-06）：本项目身份**：`project_ext` 要能被**建会话那条路径**按 `projectId` 查到（服务端据此拼目录），所以「按 id 单行查询」是**必给接口**，不是可选项。`anchor-workspace.ts` 一字不动。
  - ⚠️ **本 task 未闭合、需要裁定的两条**（已落 `state.md`「T003」节，不自行拍板）：
    ① **「建会话拼目录」的接线没有任何 task 认领**——`findByProjectID` 已按 D0-1 交到接口级，但 plan.md 那句「建会话时服务端查 `project_ext` 拼出 `join(沙箱, dir)` 写进 `session.directory`」**不在 T003/T005/T006/T016 任何一条的文字里**；
    ② **钩子只覆盖每用户库**——进程级主库（`Database.node`）由上游 `database.ts` 建，**没有**这张表（给上游加钩子＝破坏「一字不动」）。当前无消费者在无身份上下文里读它。
- [x] T004 [BE] 实现 `project_member` 表（业务 PG，走 auth 包迁移体系，与 004 的 rbac/rls 同构）＋微信群模型权限判定（owner/member 权责；判定写 core 纯函数、接线在执行层）[FR-004] [T001] [出参：权限判定单测通过]
  - ✅ **出参落地**：`packages/core/src/project/membership.ts`（判定纯函数：`MEMBER_ROLES` / `PROJECT_ACTIONS` / `decide`）／`packages/auth/src/migrations/0005_project_member.sql` ＋ `.down.sql`（`project_member` ＋ `project_archive` 两表）／`packages/auth/src/project-member.ts`（drizzle 模型，**刻意无查询辅助函数**——有消费者才写取数，`LEARNINGS #004-07`）。三个测试文件：core 16 条、auth 8 条、opencode 防漂移 1 条，**全绿**。
    **三条分工**（依赖方向是硬约束）：判定在 **core**（`auth` 不依赖 `core`、`core` 也不依赖 `auth`，故 core 侧只能是纯函数）、表在 **auth**（走既有 `migrations/` ＋ `migrate()`，D0-3 ①）、**防漂移断言在 opencode**（`project_member.role` 的 CHECK ⇔ core 的 `MEMBER_ROLES`，全仓只有它两边都够得着——同 `openhive-rbac-closed-set.test.ts` 的先例）。
  - 🔒 **U5 裁定（2026-10-06）：不接 `core/access` capability**——那是数据轴，004 裁定 ④ 明确「等 F6/F7 有消费者时再钉」。本条走自有成员判定线（存储 PG / 判定 core 纯函数 / 接线执行层）。
  - 🔒 **Q3 裁定（2026-10-06）：`project_archive` 表同批落这里**——`archived` / `archived_at` 两字段，与 `project_member` 同在业务 PG（同一次迁移 `0005_project_member.sql`）。它是**共享态**：owner 归档 ⇒ 全项目可见（FR-010 才立得住）。
  - 📥 **本条接收 004 的 T011 之半**（工作空间轴）——见文件头移交块。
  - 🔒 **U7 裁定（2026-10-06）：本条只做工作空间轴那半，完整判据显式移交 007**——判据「工作空间成员身份不改变数据访问结果」**要两轴的表都在**才验得了（数据轴那半 `fund_project_member` 在 `007-fund-analysis` T004）。本 feature 验工作空间轴能验的全部（owner/member 权责、邀请/移除/退群、归档后失权/owner 保留找回），**完整判据写进 `007-fund-analysis/tasks.md` 的 📥 块**（`LEARNINGS #002-04`：责任推出边界必须落**接收方**的表）。⚠️ 出参因此收窄为「**工作空间轴**判定单测通过」——**不得**写成「两轴解耦已验证」（`#002-02`：测不了要写成缺口，不是覆盖）。

- [x] T017 [BE] 实现**「当前项目」身份的落地口径**：建会话时服务端按 `projectId` 查 `project_ext`，拼出 `join(沙箱根, 目录)` 写进 `session.directory` [FR-001] [T003] [出参：建会话落进项目目录、且客户端给的目录一律无效]
  - ✅ **出参落地**：`packages/opencode/src/server/routes/instance/httpapi/middleware/project-location.ts`（新建 fork 中间件：按 `PROJECT_HEADER` 查 `ProjectExt.findByProjectID`，命中则把目录上移一层到 `join(config.root, user.id, projectId)`）／`.../httpapi/server.ts`（＋7 行挂载，**排在 `anchorWorkspaceLayer` 之后**）／`packages/opencode/test/server/openhive-project-directory.test.ts`（**8 条用例全绿**）。**两条链各一条主判据**（A 链 URL ／ B 链请求体），回归那条钉「不带项目头 ＋ 伪造 `../../` ⇒ 仍落沙箱根」。
  - 🔒 **裁定（2026-10-06，本 task 开工前用户裁定三笔）**：① 客户端用**请求头 `x-openhive-project`** 报 `projectId`（`payload.location` 里没有这个字段，两条链只有头是共用的）；② 落在**新 fork 中间件**，挂锚定**之后**；③ `join(沙箱根, 目录)` 里的**目录就是 `projectId` 本身**（`project_ext` 那四列里**没有**目录列）。
  - 🔒 **裁定（2026-10-06，按锚定 R-05 先例落的一笔，待复核）**：**非法 `projectId` 取「拒」**（`User.isSafePathSegment` 不过 ⇒ 抛错），不是「忽略后落沙箱根」。依据是锚定对**同一类**输入（会被 `join` 进路径的身份段）已经选了 fail closed。⚠️ **「非法」与「查不到」是两件事**：查不到（R5）走「落沙箱根」的正常路径。
  - ⚠️ **`anchor-workspace.ts` 一字不动**（D0-1 的另一半）：实测 `git diff --stat` 只有 `server.ts | 7 ++++`，锚定文件零改动；那条「客户端给的目录一律无效」的不变量原样保留（回归用例 5 钉着）。
  - ⚠️ **已知不覆盖三条**（详见 `project-location.ts` 文件头「已知不覆盖」）：① **不建目录**（只写路径，目录由 T006 落地）；② **剥 `PROJECT_HEADER` 没有测试守着**（本仓今天无下游读它 ⇒ 写不出会红的断言）；③ **射程 = 所有带头的请求，判断据只钉了建会话**（文件树 / pty 等入口的上移是**推**出来的，要动它们先补用例）。
  - 🔒 **裁定（2026-10-06，T003 收尾时用户裁定「补一条 T017」）**：**本条是 T003 逼出来的孤儿**——`plan.md` 的 D0-1 落地口径原文写着「客户端只报 `projectId`（业务标识），建会话时服务端查 `project_ext` 拼出 `join(sandbox, dir)` 写进 `session.directory`」，但这句**不在 T003 / T005 / T006 / T016 任何一条的文字里**（`LEARNINGS #002-04`：责任推出边界必须落接收方的表）。T003 只交到接口级（`ProjectExt.findByProjectID` 已就绪）。
  - ⚠️ **不动的东西（D0-1 的另一半）**：`anchor-workspace.ts` **一字不动**——它今天钉死两段 `join(config.root, user.value.id)`，客户端给的 `?directory=` / 头 / 请求体三条入参**全部被改写成沙箱根**。本条只是**在沙箱根里面**再加一段项目目录，**不碰**那条不变量；判据必须含**回归断言**：客户端自填的目录（含 `../../` 逃逸写法）**仍然无效**。
  - ⚠️ **查不到就落沙箱根**（plan.md R5）：**不做隐式建项目**（与 U4 的「两张表同步创建 ⇒ 收成一个写入模块」一致）。判据：查库失败**不改变**上面那条不变量。

## Phase 3: US1 项目列表与新建（P1）

- [x] T005 [US1] [FE·新增] 实现项目锚点行（项目名 + 成员数 + ▾ + ＋）[FR-001] [T003] [出参：左栏顶部锚点渲染]
  - ✅ **出参落地**：`packages/app/src/project/project-anchor.tsx`（受控组件：`name` / `memberCount` / `onToggleList` / `onCreate` / `onOpenMembers`；空态文案「未选择项目」＋ `data-state="empty"`；成员徽章按**属性在不在**决定画不画，不给 0 也不给假数）／`packages/app/src/project/current-project.ts`（模块级接入缝，仿 `@/workspace/current-user`，未选中读作 `undefined`）／`packages/app/src/workspace/workspace-entry.tsx`（＋20/−2：把 `ThreePane` 的 `left` 槽接到锚点行，条件落在 **`left` prop 本身**——包一层 `<Show>` 是错的，`ThreePane` 判的是 `props.left !== undefined`，`<Show>` 元素恒非 `undefined`，会给空态留一条 280px 空栏）。测试：`project-anchor.test.tsx` **9 条**＋`workspace-entry.test.tsx` 新增 **5 条**，**全绿**。
  - 🔒 **裁定（2026-10-06，开工前用户裁定）：范围 = 组件 ＋ 左栏接线 ＋ 空态接缝**——不做真实数据源、不新增后端 API。「谁来喂真实项目数据」登记成明确欠账交 **T006**（`currentProject` 的写入方），届时**只改调用处**，锚点组件一字不动。
  - ⚠️ **⑤ 前置措辞已修正**——原文（写在 T007 下）要求「清单更新**单独一次提交，先于建目录**」，实测**做不到**：git 提交不了空目录，而两份清单里各带断言要求该目录存在（`openhive-module-dirs.test.ts` 的 `existsSync`、`design-token-refs.test.ts` 的 `readdirSync`）⇒ 「只更新清单」的那次提交**必红**。故实做为**与建目录同一次提交**（就是本提交）。T007 下那条已同步改写。
  - ⚠️ **待设计侧复核项**：成员徽章图形取设计文档字面的 `👥`（`MEMBER_GLYPH`）——opencode 原生图标集里**没有** people/users 一档（已逐个枚举 `packages/ui/src/components/icon.tsx`）。代价写在源码注释里：emoji 不接 `--icon-base`，与 DESIGN §1.2「单色线性图标」不同调，而同一行的 `▾`／`＋` 都是单色 `Icon`。两条收尾各带代价（① 往上游 `icon.tsx` 加一档＝动**上游文件**，须单独提交；② 自绘内联 SVG＝照 `@/topbar/topbar` 品牌标记先例），留待设计侧裁定。
- [x] T006 [US1] [FE·新增] 实现项目面板（＋新建私有/共享 + 最近/全部/已归档三 tab）[FR-002][FR-003] [T003] [出参：新建项目成功、三 tab 可切换]
  - ✅ **出参落地**：`packages/app/src/project/project-panel.tsx`（受控组件：置顶「＋新建项目（私有/共享）」＋ `role="tablist"` 三 tab；「全部」按 `type` 分「我的项目 / 共享项目」两组，「最近」按 `lastAccessedAt` 倒序；空态**分两句**）／`packages/app/src/project/project-list.ts`（模块级接入缝，仿 `current-project.ts`）／`packages/app/src/workspace/workspace-entry.tsx`（接线：`▾`／`＋` 开面板、点一行写 `currentProject` 并收起）／`packages/app/src/project/project-anchor.tsx`（`MEMBER_GLYPH` 改**导出**——面板的 `👥 N` 与锚点行是同一设计元素）／`packages/app/src/project/current-project.ts`（补 `id?: string`，面板靠它认「哪一行是当前」）。测试：`project-panel.test.tsx` **18 条**＋`workspace-entry.test.tsx` 新增 **8 条**，**全绿**。
  - 🔒 **裁定（2026-10-06，开工前用户裁定）：范围 = 前端面板 ＋ 接缝（同 T005 口径）**——不新增后端 API、不真落库。依据是侦察实证（不是判断）：上游两条链**都没有** `POST /project`（create），`project_ext` 只有读函数（T003），`project_member` / `project_archive` 刻意无查询辅助（T004 裁定「有消费者才写取数」），客户端今天**零处**发 `x-openhive-project`（`grep` 零命中）⇒「新建项目成功」这个出参**今天不可能交付**，写进 ✅ 就是假记述（`#003-04`）。
  - ⚠️ **⑤ 出参拆成两半，据实记**：「三 tab 可切换」✅ **已交付**；「新建项目成功」❌ **不在本 task 交付**——`onCreate` 不接线 ⇒ 两个新建按钮渲染成 `disabled`。**这是实情不是缺陷**：同锚点行三个按钮的既有口径——一个点了没反应的按钮是对用户的谎，「看起来能点」比「少个按钮」更难查。落库缺口由 **T018** 认领（`#002-04`：责任推出边界必须落**接收方**的表）。
  - ⚠️ **已知不覆盖三条**：① **项目数据没有任何来源**——`projectList` 缝读作 `undefined` 而**不是** `[]`（「还没有来源」与「来源说一个都没有」是两件事，后者才配渲染「你还没有项目」）；② 锚点行的 `＋` 今天**退化成「打开面板」**（面板置顶就是新建入口），T018 接上落库后要再定一次：`＋` 继续开面板，还是直达新建表单；③ `current-project.ts` 的 `id` 今天**没有真实写入方**（测试里那一行的 id 来自 `projectList` 造数），T017 建立的 `x-openhive-project` 契约要等 T018 才接得上。
  - ⚠️ **待设计侧复核项（T005 那条的延续）**：面板的 `👥 N` 直接 `import { MEMBER_GLYPH }`——**同一设计元素在两处**，故取同一常量而非各写一份（改一处不会漏另一处）；emoji 不接 `--icon-base` 的代价与两条收尾仍在 T005 下挂着。

- [ ] T018 [US1] [BE] 实现**项目 CRUD 落库 ＋ 项目列表查询 ＋ HTTP 出口（含建目录）** [FR-002][FR-003] [T003][T004][T017] [出参：新建项目成功、项目列表可查询、客户端能切项目（`x-openhive-project`）]
  - 🔒 **补编号裁定（2026-10-06，T006 收尾时用户裁定「补一条 T018 进 tasks.md」）**：T006 侦察出的**计划缺口**——**没有任何 task 认领「建项目 / 列项目」的落库**。实证：上游两条链都**没有** `POST /project`（create）；`project_ext`（每用户 SQLite）只有读函数；`project_member` / `project_archive`（业务 PG）刻意留白；`ProjectDirectories` 有 create 但那是**目录**不是项目。于是 T005 的锚点行与 T006 的面板**两处都只立了缝、没人喂数**。`LEARNINGS #002-04`：责任推出边界必须落接收方的表。
  - ⚠️ **范围（今天写成明账，动手前再核一遍）**：① **项目创建落库**——`ProjectTable`（上游）＋ `ProjectDirectoryTable`（上游）＋ `project_ext`（T003）＋ `project_member`（T004）的**同步创建**，U4 的「两张表同步创建 ⇒ 收成一个写入模块」正是这条要收的口子；② **项目列表查询**——把上表拼成 `ProjectEntry`（`id` / `name` / `type` / `memberCount` / `lastAccessedAt` / `archived`，形状见 `project-panel.tsx`）；③ **HTTP 出口**——`GET /project` 已有，**缺 create**；④ **建目录**——T017 的 `project-location.ts` 文件头「已知不覆盖 ①」原话是「只写路径，**目录由 T006 落地**」，而 T006 裁定不做落库 ⇒ 这一条一并归到本条（**这是 T006 → T018 的第二次移交，别以为它已经有人做了**）。
  - ⚠️ **收口时必查**：`current-project.ts` 的 `id` 必须**真的等于**服务端认的 projectId（T017 的中间件按它拼 `join(沙箱根, projectId)`）；`project-list.ts` 接上真数据后，空库里应给 `[]`（合法的「一个都没有」）而**不是**继续 `undefined`——两者的区别写在该文件头。

> 📌 **T018 编号排最后、归属在 Phase 3**（2026-10-06 T006 收尾时裁定补入）：它服务的是 US1「项目列表与新建」，内容上属 Phase 3；补编号时 Phase 3 已有 T005/T006，故用末号而**不重排**既有编号——与 T017 同一条先例（编号是 **ID 不是顺序**，同 `LEARNINGS.md` 的条目号规则）。

## Phase 4: US2 文件树（P1）

- [x] T007 [US2] [FE·换皮] 实现文件树工具栏（新建/重命名/删除 + 搜索/折叠/展开）[FR-005] [T001] [出参：工具栏图标可用]
  - 🔒 **D0-2 裁定（2026-10-06）：包一层，不碰上游**——上游 `components/file-tree.tsx` 一字不动；新建 `app/src/project/file-tree.tsx`，**底座取 v2 的纯函数 model**。实测上游该组件**没有**工具栏/右键菜单/新建/重命名/删除/上传下载 ⇒ 标注的「换皮」实为**新增**。
  - ⚠️ **⑤ 前置**：`app/src/project/` 加入 **3 处**目录清单——根 `package.json` 的 `lint:openhive`、`app/src/openhive-module-dirs.test.ts` 的 `moduleDirs`、`app/src/workspace/design-token-refs.test.ts` 的 `自有目录`。少一处 ⇒ **视觉契约门扫不到新文件**且不报错（`LEARNINGS #002-06`）。
    ✅ **已于 T005（2026-10-06）办完**——原文写「**单独一次提交**，先于建目录」，实测**做不到**：git 提交不了空目录，而两份清单里各带断言要求该目录存在 ⇒ 单独提交必红。实做为**与建目录同一次提交**（T005 那一笔），此处保留记录以免后面有人照着原文重做一遍。T007 本体**不再需要**做这件事。
  - ✅ **出参落地（T007，2026-10-06）**：`packages/app/src/project/file-tree.tsx`（受控组件，`data-component="file-tree"`，**不依赖 `useFile()`**）＋ `packages/app/src/project/file-tree.test.tsx`（34 条）＋ 接入缝 `packages/app/src/project/project-files.ts` ＋ 挂进左栏（`workspace-entry.tsx` 的 `file-tree-slot`，＋5 条接线测试）。工具栏六入口逐一落地：搜索（真 `<input>`，输入即过滤）／全部收缩／全部展开／＋（下拉两项）／重命名／删除。
  - 🔒 **裁定（2026-10-06，用户，开工前问）**：
    - **范围 = 「组件＋接缝，先挂锚点行下」**。设计 §2 的左栏 ② [会话][文件] tab 容器**今天不存在**（全 `tasks.md` 零命中，12 条 FR 也没对应条款），而 US4 验收标准原文写着「当前在**「文件」tab**」⇒ ② 是 T012 的前置。故 T007 先把文件树**直接挂在锚点行下**（＝默认「文件」态），让「工具栏可用」变成看得见的东西；② 落地时**整块搬进 tab body**，组件本身一行不改。
    - **计划缺口 → 补 T019**（见下），同 T017/T018 先例。
  - ⚠️ **唯一一处设计取舍（设计文档未定，我定的，待复核）**：**开合归箭头、选中归行**——点目录行**不**收起它。理由：若点行即开合，则「选中目录 ⇒ 在它下面新建」会把落点当场收起来，用户看不见自己在哪建。已用一条测试把这条区分钉住（「开合归箭头、选中归行」）。
  - ⚠️ **键盘**：行可 Tab 聚焦、回车/空格选中、目录行 ←/→ 开合。**不做 roving tabindex**——若不补齐 ↑↓ 区间导航，键盘用户反而出不了这一行，比「多几个 Tab 停靠点」更糟。↑↓ 导航**今天没有**，归 T019 的左栏外壳一并考虑。
  - ⚠️ **已知不覆盖（三条，均**不可**在本 task 内验，不是漏做）**：① 新建/重命名/删除**没有落库接收方**（缝里今天没有写入方）⇒ 只验「未接线即禁用」与「接了线喊对回调」，落库归 **T018**；② **删除二次确认 / 选中点亮置灰** 按计划归 **T009**（T007 只到选中机制本身）；③ 搜索是**纯前端过滤**（`includes`），不是后端全文检索——设计与 spec 都没要求后端检索。
- [ ] T008 [P] [US2] [FE·换皮] 实现文件树右键菜单（复制/移动/上传/下载/备份/拉回）[FR-005] [T001] [出参：右键菜单完整操作]
- [ ] T009 [US2] [FE·换皮] 实现删除二次确认 + 重命名/删除选中后点亮、未选中置灰 [FR-006] [T007] [出参：删除有确认、未选中图标置灰]
  - 📌 **T007 已备好的料**：`file-tree.tsx` 已有**行级选中状态**（`data-selected`）与「未选中就不动作」的守卫；T009 只需在其上加**视觉门禁**（未选中置灰）与**二次确认**。⚠️ 注意 T007 刻意**没有**在「没选中」时禁用重命名/删除按钮（那是 T009 的活），别误以为是漏做。
- [ ] T019 [US2/US4] [FE·新增] 实现**左栏外壳：② [会话][文件] tab 容器 ＋ ④ MinIO 常驻窄条** [FR-005] [T007][T011] [出参：左栏能切「会话/文件」、MinIO 窄条常驻]
  - 🔒 **补编号裁定（2026-10-06，用户）**：同 T017/T018 先例——**编号排最后、不重排既有编号**。这两块**外壳**在 T007 侦察时被查出**无 task 认领**（`grep` 全 `tasks.md` 零命中，12 条 FR 也没有对应条款），而 US4 验收标准依赖 ②（「当前在**「文件」tab**」）⇒ 若不补，T012 的验收无从谈起。
  - ⚠️ **只收两块「外壳」**：② 的 tab 容器（切「会话/文件」）与 ④ 的 MinIO 常驻窄条（设计 §2）。**「会话」tab 里的会话列表（设计 §7）不在范围内**——它可能是别的 feature 的产物，留给裁定。
  - ⚠️ **搬家的接口**：T007 的文件树今天直接挂在锚点行下（`file-tree-slot`）。T019 落地时把 `file-tree-slot` **整体搬进 ② 的「文件」tab body**——`file-tree.tsx` 本身**一行不改**（这正是 T007 选「受控组件 ＋ 接缝」的原因）。
  - ⚠️ **顺带待办**：T007 已知的 **↑↓ 区间导航**（见 T007 的键盘条）与左栏整体键盘可达性，归本 task 一并考虑。

## Phase 5: US3 成员管理（P1）

- [ ] T010 [US3] [FE·新增] 实现成员面板（👥 侧滑：邀请/移除/退群，按微信群模型）[FR-004] [T004] [出参：owner 邀请/移除、member 退群]

## Phase 6: US4 MinIO 备份（P1）

- [ ] T011 [US4] [BE] 实现 MinIO 客户端（文件级备份/拉回）[FR-007] [T002] [出参：文件可备份/拉回]
  - 🔒 **D0-4 裁定（2026-10-06）：用 `@aws-sdk/client-s3`**——复用既有 `@aws-sdk/credential-providers` 的同一 SDK 家族，`bun.lock` 增量最小；MinIO 是 S3 兼容。加依赖后**必查** `git diff --stat bun.lock`（只应有本次新增的条目）。
- [ ] T012 [US4] [FE·新增] 实现上下双树拖拽（沙箱 ↔ MinIO，已备份标 ✓）[FR-007] [T011] [出参：拖拽备份/拉回成功]

## Phase 7: US5 归档 / 找回（P2）

- [ ] T013 [US5] [BE] 实现项目归档（上传 MinIO + 删除沙箱 + archived=1）[FR-008] [T003][T011] [出参：归档后项目移入「已归档」]
  - ⚠️ **开工前必须先钉（Q1×Q3 逼出的缺口，2026-10-06 本批不拍）**：owner 归档时，**成员的**沙箱文件怎么办？——owner 读不到成员沙箱（物理隔离），「沙箱文件全部上传 MinIO」只能覆盖**自己**那一份。两种读法：(a) 归档只动 owner 自己那份，成员那份留在各自沙箱、仅由 `archived` 状态拦住后续写入；(b) 成员各自在收到归档通知后上传自己的那份（需站内信 + 状态机）。**这两条实现量与产物完全不同，动手前问用户**（`dev_tdd.005.md` Step 2 ⑦）。
- [ ] T014 [US5] [BE] 实现项目找回（archived=0 + MinIO 下载回沙箱）[FR-009] [T013] [出参：找回后项目回到「最近/全部」]
- [ ] T015 [US5] [BE] 实现归档后成员失权、owner 保留找回权 [FR-010] [T004][T013] [出参：归档后 member 失权]
- [ ] T016 [P] [BE] 验证会话彻底私有（成员会话只存自己 db）+ 文件并发靠 git [FR-011][FR-012] [T003] [出参：owner 看不到 member 会话、git 留痕]
  - 🔒 **Q2 裁定（2026-10-06）：`git` 的载体 = 共享 bare 仓库 `/shared/{projectId}.git`**——成员各自 clone / commit / push（FR-012「各自 commit、冲突 merge」的唯一逐字实现：不同检出、同一仓库）。**不经 HTTP** ⇒ 锚定不变量不破。原 `U6`（「FR-012 无载体」）由此解决；本 task 要验的就是「两个检出各自 commit 后能 push 并 merge 冲突」。

---

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003 ✅（依赖 T001）；T004 ✅（依赖 T001，可与 T003 并行）；T017 ✅（依赖 T003，可与 T004 并行）

> 📌 **T017 编号排最后、归属在 Phase 2**（2026-10-06 T003 收尾时裁定补入）：它是 D0-1 落地口径的实装，属「Foundational」而非某个用户故事；补编号时 Phase 2 已有 T003/T004，故用末号而**不重排**既有编号（编号是 ID 不是顺序，同 `LEARNINGS.md` 的条目号规则）。
- **Phase 3**：T005 ✅（依赖 T003）；T006 ✅（依赖 T003）；T018（依赖 T003+T004+T017）
- **Phase 4**：T007 ✅（依赖 T001）；T008 ∥ T007（依赖 T001）；T009（依赖 T007）；T019（依赖 T007+T011，左栏外壳）
- **Phase 5**：T010（依赖 T004）
- **Phase 6**：T011（依赖 T002）；T012（依赖 T011）
- **Phase 7**：T013（依赖 T003+T011）→ T014（依赖 T013）；T015（依赖 T004+T013）∥ T016（依赖 T003）

共 19 条任务（T001–T019），超出 12–18 条范围（T017 / T018 / T019 都是补入的**孤儿认领**，见各自的裁定说明）。

> 📌 T018 / T019 的编号都排在最后、不重排既有编号（先例裁定），故正文里出现**编号与位置不一致**是**故意的**，不是笔误——现为：T018 列在 Phase 3 区（在 Phase 4 之前），T019 列在 Phase 4 区、**排在 T008/T009 之后但编号最大**。
