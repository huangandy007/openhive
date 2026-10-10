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

- [x] T018 [US1] [BE] 实现**项目 CRUD 落库 ＋ 项目列表查询 ＋ HTTP 出口（含建目录）** [FR-002][FR-003] [T003][T004][T017] [出参：新建项目成功、项目列表可查询、客户端能切项目（`x-openhive-project`）]
  - 🔒 **补编号裁定（2026-10-06，T006 收尾时用户裁定「补一条 T018 进 tasks.md」）**：T006 侦察出的**计划缺口**——**没有任何 task 认领「建项目 / 列项目」的落库**。实证：上游两条链都**没有** `POST /project`（create）；`project_ext`（每用户 SQLite）只有读函数；`project_member` / `project_archive`（业务 PG）刻意留白；`ProjectDirectories` 有 create 但那是**目录**不是项目。于是 T005 的锚点行与 T006 的面板**两处都只立了缝、没人喂数**。`LEARNINGS #002-04`：责任推出边界必须落接收方的表。
  - ⚠️ **范围（今天写成明账，动手前再核一遍）**：① **项目创建落库**——`ProjectTable`（上游）＋ `ProjectDirectoryTable`（上游）＋ `project_ext`（T003）＋ `project_member`（T004）的**同步创建**，U4 的「两张表同步创建 ⇒ 收成一个写入模块」正是这条要收的口子；② **项目列表查询**——把上表拼成 `ProjectEntry`（`id` / `name` / `type` / `memberCount` / `lastAccessedAt` / `archived`，形状见 `project-panel.tsx`）；③ **HTTP 出口**——`GET /project` 已有，**缺 create**；④ **建目录**——T017 的 `project-location.ts` 文件头「已知不覆盖 ①」原话是「只写路径，**目录由 T006 落地**」，而 T006 裁定不做落库 ⇒ 这一条一并归到本条（**这是 T006 → T018 的第二次移交，别以为它已经有人做了**）；⑤ **文件列表读取**——把 `GET /file`（上游已有，`.../httpapi/handlers/file.ts` 的 `list`）接进 `packages/app/src/project/project-files.ts`，**否则左栏文件树恒走空态**。⚠️ **本条是 2026-10-06 T008 收尾时补进来的**：`project-files.ts` 的文件头早就写着「把文件列表接进来是 **T018** 之后的欠账」，但**本条的范围里此前没有它**（`LEARNINGS #002-04`：责任推出边界必须落接收方的表）——不补，则 T020 开工时才发现「没有列文件就没有可操作的对象」。
  - ⚠️ **收口时必查（⑤ 的去向）**：`project-files.ts` 接上真数据后，空项目应给 `[]`（合法的「一个都没有」）而**不是**继续 `undefined`——两者的区别写在该文件头（同 `project-list.ts` 那条）。
  - ⚠️ **收口时必查**：`current-project.ts` 的 `id` 必须**真的等于**服务端认的 projectId（T017 的中间件按它拼 `join(沙箱根, projectId)`）；`project-list.ts` 接上真数据后，空库里应给 `[]`（合法的「一个都没有」）而**不是**继续 `undefined`——两者的区别写在该文件头。
  - 🔒 **开工前三条裁定（2026-10-06，用户裁定，开工前问）**：
    - **(1) `projectId` 的形状 = `crypto.randomUUID()`**。它是三处共用的同一个值：`/workspaces/{userId}/{projectId}` 的目录名、`project_member.project_id`（**全成员共享**，只有 `userId` 那段不同）、`x-openhive-project` 头的值。选 UUID 的理由：零碰撞 ⇒ **不需要**「撞了就重取」那条检查与它的测试（`#002-06`：会漂的分支少一条是一条），取向也与上游 id 本来就是不透明哈希一致。**代价据实记**：沙箱目录长成 `3f2a-…`，人不可读（设计文档没给可读性要求）。⚠️ 形状上的唯一约束来自 `User.isSafePathSegment`（非空、非 `.` / `..`、不含 `/` `\`），UUID 天然满足。
    - **(2) 共享项目的 bare 仓库归 T018 建**。Q2 定的 `/shared/{projectId}.git` 此前**没有任何 task 认领创建**（T016 是纯验证、任务文字里没有「建」这一动作）——按 `#002-04` 落进接收方的表。⇒ 建共享项目 = `git init --bare` ＋ 把 `shared_directory` 写进 `project_ext`（该列「仅共享项目有值」）。⚠️ **同时新定一个配置源**：`/shared` 这个根**全仓零定义**（2026-10-06 `grep`：只有设计文档提过）⇒ 本条定义 `OPENHIVE_SHARED_ROOT`（env，同 `minio.md` §4 那批 `OPENHIVE_*` 的形状），并**与 T022 的 D-13 一样，在 state.md 记下「本机无目标内网、部署时实测」**。
    - **(3) HTTP 出口的落法 = fork 自己的 `HttpRouter` 层**，并进 `packages/opencode/src/server/routes/instance/httpapi/server.ts` 的 `Layer.mergeAll`（逐字照 `AuthGateway.routes` 那三行的先例，带 `【保留的定制 · 同步上游时不要丢】` 标记）。**不改上游 `api.ts` 的 endpoint 定义**——改 `server.ts` 那一行是不可避免的最小侵入（新增出口不可能不上挂），但要**单独提交**并标「这是要保留的定制」（宪法 §一 三原则）。
  - ⚠️ **一个不写就会静默分裂的接缝（读代码推出，动手时用测试钉住）**：上游 `ProjectV2.resolve()`（`packages/core/src/project.ts`）会对**同一个目录**算出**它自己的** project id，优先级 `git remote 哈希 → 仓库里的 `opencode` 缓存文件 → root commit`。⇒ T018 建完项目后，建会话时 `Project.fromDirectory()` 走进来会**再插一行 id 完全不同的 `project`**，而那行 `project_ext` 就永远配不上、不报错、不变红。唯一的对齐口是 `ProjectV2.commit({store, id})`——它把 id 写进仓库里那个缓存文件，`resolve()` 会优先读它（`readFileString(path.join(dir, "opencode")).trim()`）。⚠️ 本条是**读代码推出的口径，不是实测**（`#003-04`：复现不了的不要写成实测）——实测法见下：建一个带 `project_ext` 行的项目目录，跑一次 `fromDirectory`，断 id 与它相等。

  - ✅ **完成（2026-10-06）：两半都已交付** —— BE 半边（范围 ①②③④）＋ FE 半边（范围 ⑤）。⚠️ **本条标签是 `[BE]`，但 FE 半边也落在本条**（用户裁定「⑤ 留在 T018，本轮做完」）⇒ 收尾按 `[FE]` 规矩补跑了组件门禁并出了**实测落点表**（见 `state.md` 的 T018 节）。
    - ✅ **交付一**：`packages/opencode/src/server/openhive/project.ts`（新）——`GET /openhive/project` 列项目 ＋ `POST /openhive/project` 建项目。建项目的**八步顺序**（顺序本身是产物）：① 建 `{沙箱根}/{userId}/{projectId}` → ② 在其中 `git init` → ③ 把 id 写进仓库里的 `opencode` 缓存文件（`ProjectV2.commit`）→ ④ `Project.fromDirectory`（**只跑这一次**，它自己还会再 `commit` 一次，故 ③ 必须先做）→ ⑤ 改项目名 → ⑥ **仅共享项目**：`git init --bare /shared/{projectId}.git` → ⑦ `project_member` 写 owner → ⑧ `project_ext` 落 `type` / `shared_directory` / `last_accessed_at`。接线：`server.ts` ＋12 行挂进 `Layer.mergeAll`（带 `【保留的定制 · 同步上游时不要丢】`；**不改上游 `api.ts` 的 endpoint 定义**，符合裁定 (3)）。测试 `packages/opencode/test/server/openhive-project.test.ts`（新，**10 条**）**全绿**。
    - ✅ **交付二（范围 ⑤ ＋ 出参第三条）**：`packages/app/src/project/` 下 **4 个新文件**——`openhive-fetch.ts`（底座：`ForkFetch`／`defaultSend`／`trySend`／`readJson`／`isRecord`，**两条链共用一份**）＋ `openhive-project.ts`（项目列表 / 新建）＋ `openhive-files.ts`（`listProjectFiles`：深度优先走 `GET /file?path=`、**带 `x-openhive-project` 头**、只收 `type === "file"`、**一条走不通 ⇒ 整份 `undefined`**）＋ `project-data.ts`（窄接口 `ProjectData` ＋ 生产绑定 `PROJECT_DATA`）。接线：**上游文件** `pages/layout-new.tsx` **＋5 行**（1 import ＋ 1 prop，带【保留的定制 · 同步上游时不要丢】）＋ `workspace-entry.tsx`（进门拉清单／换项目拉文件／`onCreate` 接线）。**新增 44 条**（18＋11＋3＋9＋13）。
    - 🔒 **裁定 A/B/C ⇒ 取 (C)**（2026-10-06，用户「照 `gateway.ts` 先例写薄客户端」）：上游 `api.ts` **一字不动**，契约集中在 `packages/app/src/project/` 一层。**另两条同时裁定**：(4) 打开平台时**不自动选**当前项目（照 spec 字面：不选 ⇒ 不发头 ⇒ 后端落回沙箱根）；(5) 新建失败**在输入框下显示一句**（回话约定：字符串 = 没建成，`undefined` = 收工）。
    - ⚠️ **补记（2026-10-08，006 侧）**：上面 (4) 的**裁定不变**，但它的理由后半句（「不选 ⇒ 不发头 ⇒ 后端落回沙箱根」）**已经不成立**——006 Step 5 ②-1 给「当前项目」加了 **cookie 通道**（右栏那条 SDK v2 链够不着头；cookie 由浏览器自动附带、且**活得比页面久**）⇒ 刷新之后信号归零、cookie 却还指着旧项目，「不选」变成要**主动维持**的状态。006 已裁定 **B：启动清掉 cookie**，落点 `packages/app/src/workspace/workspace-entry.tsx` 的 `onMount`（`setCurrentProject(undefined)`）；详见 005 `state.md` 裁定表下那条同因补记（`LEARNINGS #002-06`）。
    - ✅ **两处原条目点名的接缝已真被钉住**（不是推断，是两条用例）：① 「不写就会静默分裂的接缝」——建项目后用该项目目录建会话，`ProjectV2.resolve()` 认的 id 与 `project_ext.project_id` **相等**（若 ③ 不做，会多出一行 id 不同的 `project`，且不报错、不变红）；② 建目录归谁——`shared_directory` 的 bare 仓库与沙箱项目目录都真在盘上（`existsSync` 判据）。
    - ✅ **两条收口必查项都已做到**：`project-files.ts` 接上真数据后空项目给 `[]`（合法的「一个都没有」）而非 `undefined`（用例钉着）；`current-project.ts` 的 `id` **真的送到服务端**——换项目 ⇒ `createEffect` ⇒ `listProjectFiles(id)` ⇒ `x-openhive-project` 头（`project-data.test.ts` 断言头里的值逐字等于传入的 id）。
    - ✅ **`＋` 的语义定过一次了**（裁定 (3)）：**保持「打开面板」**，不直达新建表单——直达要在这里再养一份「起名」状态，而面板那一份已经在了（`project-panel.tsx` 的 `起名`）。原「T018 接上落库后要再定一次」那句已按实测改掉。
    - 🔒 **两处实测抓到的坑（形状都与我事先以为的不同，已写进源码注释）**：① **`Schema.Literal(...PROJECT_TYPES)` 在 Effect 4 里是单数签名**（多值的是 `Literals`）⇒ 多出来的 `"shared"` 被 JS **静默丢掉**、解码器只认 `"private"`，建共享项目一律 **400**；② **`git init --bare <bare>` 跑不通**——`Git.run` 起进程前会 `FileSystem.access(cwd)`，cwd 不存在直接 `NotFound`、被收敛成 `exitCode: 1`、最终成**建项目 500**，且**只有共享项目中招**（私有项目一切正常，症状极具误导性）⇒ 必须先 `mkdir(bare)` 再进去 `git init --bare`。
    - ✅ **`workspace-entry.tsx` 那处不实注释已改**（T007 落下，「由应用入口注入（`layout-new.tsx` 拿 `useSDK()` 组）」实测为假）：改后写的是实情——**该由入口注入、今天还没接**（要六层 provider，属中栏视图那条线），省略 = 视图停在空态但路由与 tab 照常。
  - ⚠️ **三笔随本条记档的缺口**（已并入 `state.md`）：① `OPENHIVE_SHARED_ROOT` 与 T022 的 D-13 同性质——**本机无目标内网，部署时实测**；② `project_ext.project_type` 今天写**空串**（该列是自由文本 NOT NULL 无默认值，而 005 没有任何表单收集它）——**不是补默认值，是显式留白**；③ `workspace-entry.test.tsx` 的 `mount()` **从不 dispose** ⇒ 变异 W8（「换项目时不清空旧项目文件」）**全绿**、测不出来——据实记为全绿（`#003-03` ③），根因与修法已写进 `state.md`。

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
- [x] T008 [P] [US2] [FE·换皮] 实现文件树右键菜单（复制/移动/上传/下载/备份/拉回）[FR-005] [T001] [出参：右键菜单完整操作]
  - 🔒 **裁定（2026-10-06）：复用 `@opencode-ai/ui/context-menu`（Kobalte），不手写菜单**——理由：上游 `sidebar-project.tsx` 已经这么用（同一份菜单项／分隔符／禁用态的形状），手写等于把 Kobalte 的开合、键盘、`aria-disabled`、Portal 再实现一遍。实测该组件**无需任何 provider** 即可渲染（不是「得在六层 provider 里才跑得起来」的东西）。
  - ✅ **出参落地（T008，2026-10-06）**：`packages/app/src/project/file-tree.tsx`（同一文件内扩：`FileTreeMenuItem` 联合类型 ＋ 6 个回调 props ＋ 一份 `ContextMenu` 根）＋ `packages/app/src/project/file-tree.test.tsx`（＋19 条 ⇒ 53 条）。十项按设计 §6.2 的表落地：新建文件／新建文件夹 ｜ 重命名／复制／移动／删除 ｜ 上传／下载 ｜ 备份到 MinIO／从 MinIO 拉回——四组、组间一个分隔符。**探明的 Kobalte 契约**（记下来免得下次再探一遍）：内容元素的钩子是 `data-component="context-menu-content"`，而 Trigger／Item 用 `data-slot`（`data-slot` 在 Trigger 上还会被外层**强制覆盖**成 `context-menu-trigger`）；`onSelect` 由 **pointerdown ＋ pointerup** 触发（单独 `.click()` **不够**）；关闭走 `setTimeout` ＋ 退场动画 ⇒ **判「开着没」要看 `data-expanded` 属性，不能看元素在不在 DOM 里**（happy-dom 下退场动画永不结束，元素永不卸载）。
  - ⚠️ **唯一一处设计取舍（设计文档未定，我定的，待复核）——「工具栏作用于选中项、菜单作用于右键那一行」，两套当前项**：
    1. **一份 `ContextMenu` 根**，不是每行一个（十行树 ＝ 十个 Portal，白开销）。
    2. **Trigger ＝ 树区域**（行 ＋ 空态），**工具栏不在里面**——在工具栏上右键弹出「新建文件」是说不通的。
    3. **右键不改选中态**：菜单收的是 `记对象(event)` 从 `data-path` 读出的那一行，与 `selected()` 各走各的。
    4. 「**需对象**」的七项（rename/copy/move/delete/download/backup/restore）在没有右键到任何节点时**禁用**；「新建两项」与「**上传**」**不受影响**——它们要的是**落点目录**，没有对象时落点 ＝ 根。已用一条测试钉住（空树右键 ⇒ 新建／上传可用、copy 禁用，且点「新建文件」收到 `{ kind: "file", parent: "" }`）。
  - ⚠️ **实现踩到、且必须记住的坑**：`ContextMenu.Trigger` 会 `splitProps` 掉 `onContextMenu`，非 `disabled` 分支 `preventDefault()` ＋ `stopPropagation()` 之后**不调用**外部传进来的那个 ⇒ 挂在 Trigger 上的 `onContextMenu` **静默失效**（菜单照开，作用对象永远是「没有」，不报错不变红）。修法：挂在 **Trigger 内层**的 `data-slot="file-tree-region"` 上（冒泡时先跑）。首轮 GREEN 13 条红正是这么抓出来的。
  - ⚠️ **已知不覆盖（十项的接收方，逐项点名，`#002-04`）**：本 task 十项**全部只喊回调**，没有执行方。按动作分三处（**合计 10 项，不重不漏**）：<br>① **新建两项 ＋ 重命名 ＋ 删除**（4 项）⇒ 沙箱文件写入，归 **T018**（T007 就挂下的那条账）；<br>② **复制 ／ 移动 ／ 上传 ／ 下载**（4 项）⇒ 归 **T020**（本 task 收尾时补的编号，见上）；<br>③ **备份到 MinIO ／ 从 MinIO 拉回**（2 项）⇒ 归 **T011／T012**。
  - 🚩 **计划缺口 → 已补 T020（2026-10-06，用户裁定「补，phase 你定」）**：**复制 / 移动 / 上传 / 下载 四个动作在 `tasks.md` 里没有任何任务认领**——`grep` 全文只命中 T008 这一行（且只到「菜单」为止）与 T013／T014（MinIO 的归档 / 找回）。而 D0-2 已实测上游**没有**这四个动作 ⇒ 它们是**要新做的功能**，T008 只落了菜单入口。已按 T017／T018／T019 先例补 **T020**（编号排最后、不重排既有编号，**归 Phase 4**——见下面 T020 条目的裁定块）。
- [x] T009 [US2] [FE·换皮] 实现删除二次确认 + 重命名/删除选中后点亮、未选中置灰 [FR-006] [T007] [出参：删除有确认、未选中图标置灰]
  - 📌 **T007 已备好的料**：`file-tree.tsx` 已有**行级选中状态**（`data-selected`）与「未选中就不动作」的守卫；T009 只需在其上加**视觉门禁**（未选中置灰）与**二次确认**。⚠️ 注意 T007 刻意**没有**在「没选中」时禁用重命名/删除按钮（那是 T009 的活），别误以为是漏做。
  - ✅ **出参落地（T009，2026-10-06）**：`packages/app/src/project/file-tree.tsx`（同一文件内扩：`待删` 信号 ＋ **内联确认条** ＋ `禁用`／`点`／`点删`／`确认删` 四处 ＋ `TOOL_BUTTON_DANGER` 常量）＋ `packages/app/src/project/file-tree.test.tsx`（＋13 条 ⇒ **66 条**）。三条判据各钉一层：**置灰／点亮**（未选中禁、选中可点，且「没接线」与「没选中」是两条**独立**的禁用理由）、**二次确认**（点删除不立刻喊、条上写清要删谁、取消不喊、确认才喊）、**红色只给删除**（重命名不带 danger token）。
  - 🔒 **裁定（2026-10-06，用户）：二次确认用「内联确认条」，不用 `Dialog`**——`packages/ui` 的 `Dialog` 走 `useI18n()` ＋ `Kobalte.Content`，**要 provider**，而本组件从 T005 起就是「能脱离六层 provider 单独渲染」的受控组件；实测 `packages/app/src/components/` 下用 `Dialog` 的 10 个组件**测试数为 0**，把它拖进来等于给这一小块另开一套测试地基。确认条内联在树下方，用户的眼睛本来就在那儿。
  - ⚠️ **一条确认条，两个入口**：工具栏 🗑 与右键菜单「删除」都走同一个 `点删(path)` ⇒ 「不分入口」是**结构上**成立的（共享一份 `待删` 信号），不是靠两处各写一遍留意着（`#004-02` 的同型手法）。已用测试钉住：菜单删除同样先出确认条，且确认后喊的是**右键那一行**而不是选中项（沿用 T008 的「两套当前项」）。
  - ⚠️ **顺带补了 T007 的一个漏项**：设计 §6.1 最后一条「悬停给 tooltip 提示动作名」——工具栏五个图标此前只有 `aria-label`，本次补 `title`。搜索框**不**加：它是输入框不是图标，名字由 `aria-label` ＋ `placeholder` 承担，再挂 `title` 是三重冗余。
  - ⚠️ **「点亮」的写法**：另起 `TOOL_BUTTON_DANGER` 常量**整体替换**，而不是在原 class 串上追加 `text-v2-state-fg-danger`——`TOOL_BUTTON` 里写死了 `text-v2-text-text-muted`，两个同权重的文本色类同时挂在元素上时谁生效取决于 **CSS 里的先后**（不看 class 属性顺序）⇒ 那会是一个「看着该红、实际不一定红」的写法（`#003-05` 假镜像的同族）。
  - ⚠️ **两条既有用例按新行为更新（是设计变更，不是「改测试迁就代码」）**：T007 的「回传的是选中项的路径」与 T008 的「删除走的是工具栏那个 onDelete」都补了一次确认点击——FR-006 要求二次确认，行为**按设计变了**。后者还补了「确认条开着 ＋ 此刻未喊」的前置断言：它在变异 M3 里暴露过**假绿**（只断言终值的话，一个「直接喊」的实现照样满足）——这条用例的名字写着「同样过二次确认」，断言就得配得上那个名字。
  - ⚠️ **已知边界（未测、未要求，写明免得看着像漏，`#002-02`）**：① 确认条开着时改选别的行，条上写的仍是**原来那一项**（跟着 `待删` 走，不跟 `selected`）——测试只覆盖了「先取消、再选」这条路径；② 确认删除后 `selected()` **不清空**（树内容由父组件经 `paths` 受控，选中项是否随之失效不在本组件职责内）。
  - ✅ **变异验证（2026-10-06，串行跑，据实记三类 `#003-03`）**：<br>**M1** 去掉 `|| !selected()` ⇒ **恰红 2**（置灰那条 ＋ danger 点亮那条，对照不红）；<br>**M2** 工具栏 `点删(path)` 改回直接 `props.onDelete` ⇒ **恰红 5**（工具栏确认那一组全红，右键两条不红 ⇒ 入口隔离成立），⚠️ 但 T007／T008 两条既有用例在 M2 下**仍绿**（它们断言的是终值，对「过不过确认」不敏感——T008 那条已在 M3 后补强，T007 那条名字没宣称确认，保留）；<br>**M3** 菜单 `onSelect` 改回直接喊 ⇒ **恰红 3**（两条入口用例 ＋ 补强后的 T008 用例）；<br>**M5** `确认删` 喊 `selected()` 而非 `待删()` ⇒ **恰红 2**（含「喊的是右键那一行」）；<br>**M6** danger class 改回 `TOOL_BUTTON` ⇒ **恰红 1**。全部为①类（恰红目标），**无②③类**。
  - 🧭 **门禁（T009 收尾，串行，2026-10-06）**：`packages/app` 组件测试 **306 pass / 0 fail / 23 文件**（T008 基线 293 ⇒ ＋13）；`test:unit` **824 / 0 / 117 文件**（同基线）；`lint:openhive` **exit 0**（23 warnings / 0 errors / 78 files，同基线）；`bun run lint` **改动文件 0 命中**（命中的 `packages/app/src/components/file-tree.tsx` 是**上游既有**文件，与新写的 `project/file-tree.tsx` 同名不同物）；`typecheck` **31/31**。
- [x] T019 [US2/US4] [FE·新增] 实现**左栏外壳：② [会话][文件] tab 容器 ＋ ④ MinIO 常驻窄条** [FR-005] [T007][T011] [出参：左栏能切「会话/文件」、MinIO 窄条常驻]
  - 🔒 **补编号裁定（2026-10-06，用户）**：同 T017/T018 先例——**编号排最后、不重排既有编号**。这两块**外壳**在 T007 侦察时被查出**无 task 认领**（`grep` 全 `tasks.md` 零命中，12 条 FR 也没有对应条款），而 US4 验收标准依赖 ②（「当前在**「文件」tab**」）⇒ 若不补，T012 的验收无从谈起。
  - ⚠️ **只收两块「外壳」**：② 的 tab 容器（切「会话/文件」）与 ④ 的 MinIO 常驻窄条（设计 §2）。**「会话」tab 里的会话列表（设计 §7）不在范围内**——它可能是别的 feature 的产物，留给裁定。
  - ⚠️ **搬家的接口**：T007 的文件树今天直接挂在锚点行下（`file-tree-slot`）。T019 落地时把 `file-tree-slot` **整体搬进 ② 的「文件」tab body**——`file-tree.tsx` 本身**一行不改**（这正是 T007 选「受控组件 ＋ 接缝」的原因）。
  - ⚠️ **顺带待办**：T007 已知的 **↑↓ 区间导航**（见 T007 的键盘条）与左栏整体键盘可达性，归本 task 一并考虑。
  - ✅ **出参落地（T019，2026-10-06）**：新建 `packages/app/src/project/sidebar-tabs.tsx`（受控：`active` ＋ `onSelect`，`data-component="sidebar-tabs"`）＋ `sidebar-tabs.test.tsx`（13 条）；新建 `packages/app/src/project/minio-bar.tsx`（`data-component="minio-bar"`）＋ `minio-bar.test.tsx`（6 条）；新建数据接入缝 `packages/app/src/project/minio-backups.ts`；`workspace-entry.tsx` 把 T007 的 `file-tree-slot` **整体搬进** ② 的「文件」pane（组件本身一行未改）并把 ④ 接在 ② 之后，`workspace-entry.test.tsx` ＋8 条接线用例（既有 2 条按新结构更新）。
  - 🔒 **三处未定决策点 → 已问用户，2026-10-06 裁定（均为推荐项）**：
    1. **「会话」tab 的 body ＝ 显式空态**（`data-state="empty"` ＋ 文案「会话列表未接入」）。不白屏、也不装作有内容——设计 §7 的会话列表不属本 feature（本 task 的「只收两块外壳」条已写明），但 US4 验收依赖 ② 存在 ⇒ 空态必须**说清为什么空**。
    2. **点窄条 ＝ 只做设计 §5.1 步骤 2①**（若在「会话」tab 则切回「文件」tab）；2②「展开上下双树」**归 T012**——双树本身是 T012 的产物，这里没有可展开的东西。
    3. **键盘 ＝ 只做外壳自己的 ← →**（ARIA tabs 的自动激活变体，移动即激活、焦点跟着走），**↑↓ 继续挂账**。这遵守本 task 自己写下的「`file-tree.tsx` 一行不改」——↑↓ 是树内部的事（T007 的键盘条已挂账）。
  - ⚠️ **两个 pane 同时挂载、靠 `hidden` 切换**（不是 `<Show>`）：`FileTree` 自带搜索词／折叠态／选中行三份内部信号，一卸载就会**切一下 tab 全没了**。`hidden`（`display:none`）同时保证非激活的 pane **不进 Tab 顺序**。已用一条「切走切回是**同一棵树**（同节点 ＋ 内部计数还在）」的用例钉住——⚠️ 该用例**中段必须有一条「此刻「文件」pane 确实被藏起来了」的前置断言**，否则它在「压根没有 tab 容器」的旧结构上也全绿（旧结构里树从不卸载，「同一棵树」自然成立），那就成了一条不区分实现、只跟着代码走的断言。
  - ⚠️ **`data-slot="file-tree-slot"` 沿用旧名**：设计 §2 的 ③ 主体今天就是文件树那一块，搬的是**位置**不是身份 ⇒ T007 那批接线用例与 T012 都还能按原名找到它。
  - ⚠️ **一处 tsgo 与 oxlint 意见相反的写法（记下来免得下次再撞）**：tablist 的键盘处理器**必须写成内联箭头**。`(event.currentTarget as HTMLElement).querySelector(...)` 会被 oxlint 的 `no-unnecessary-type-assertion` 判为多余断言，但删掉断言后 **tsgo 报 TS18047 ＋ TS2339**（`currentTarget` 是 `EventTarget | null`）。仓库成文解法是**内联**（Solid 只在内联处理器上把 `currentTarget` 标成该元素，具名函数收的是裸 `KeyboardEvent`，`currentTarget` 退化成 `EventTarget`）——先例见 `packages/app/src/auth/login-page.tsx` 那批 `onInput={(event) => …event.currentTarget.value}`。照它写，两边同时过关。
  - ⚠️ **已知边界 / 挂账（`#002-02`，写明免得看着像漏做）**：
    1. **`minio-backups.ts` 今天没有写入方，且没有能写的东西**——T011 的 `@opencode-ai/core/minio` 是**包内库、没有任何 HTTP 出口**接到前端 ⇒ 窄条恒走「不知道几项」态（不显示数字）。第一个消费者是 **T012**。
    2. **↑↓ 区间导航继续挂账**（见上「键盘」条）；`workspace-entry.test.tsx` 里**既有**的 4 处 `expect(...).toBeNull()`（判 `topbar` / `document-view` 不在的那几处）**未清理**——不是本 task 加的，下次碰到再清。
  - ✅ **变异验证（2026-10-06，串行跑，据实记三类 `#003-03`）**：<br>**M1** 会话 pane 的 `hidden={props.active !== "session"}` 改成 `hidden={false}`（两个 pane 都不藏）⇒ **恰红 2**（都是直接断言 `hidden` 的用例），11 pass 对照不红；<br>**M2** 窄条 `props.count !== undefined` 改成 `!!props.count` ⇒ **恰红 1**（「明确 0 项时照样显示」），5 pass；<br>**M3** 窄条 `disabled={props.onOpen === undefined}` 改成 `disabled={false}` ⇒ **恰红 1**（「未接线时是禁用态」），5 pass；<br>**M4** 删掉键盘处理器里的焦点跟随那一行 ⇒ ⚠️ **第一次跑不是红，是崩**（详见下条），改成断布尔后复跑 ⇒ **恰红 1**（「← / → 把焦点与选中一起移到另一个 tab」），12 pass；<br>**M5** 去掉 `MinioBar` 的 `onOpen` 接线 ⇒ **恰红 1**（「点窄条：在「会话」tab 时自动切回「文件」」），46 pass。<br>**除 M4 的首次崩溃外，全部为①类（恰红目标），无②③类。**
  - 🔴 **M4 逼出来的重要发现：`#005-01` 那颗地雷的适用范围比原记的更宽，而且本次**新写的用例**里就埋了 4 处。**
    原条目只说了 `.toBeNull()`（「断某处没有元素」）这一种写法。实测：**任何把「被 Solid 渲染过的节点」当实得值的断言都会中招**——M4 一动，`expect(document.activeElement).toBe(tab(host, "session"))` 红了，bun 打印实得值（一个真实 button 节点）时**停不下来**：首次实测 **Bun internal assertion failure ＋ panic**、`timeout` 挡下时已跑 **29s**、峰值 **4.68GB**、`EXIT=3`、**一条结果都取不到**（不是「没跑完」，是**崩了**）。对照：把同一条断言改成比**布尔**后，2 秒出结果、恰红 1 条。
    ⇒ **本 task 新写的断言里，同形状的 4 处已全部改成断布尔**（每处都留了指回 `#005-01` 的注释）：`sidebar-tabs.test.tsx` 的焦点跟随、`sidebar-tabs.test.tsx` 的「同节点」（`槽(host,"probe") === 前`）、`sidebar-tabs.test.tsx` 的 aria 指向（`querySelector(...) === pane(...)`）、`workspace-entry.test.tsx` 的「文件树还是同一棵」（`树(host) === 前`）。
    ⚠️ **反例（不必改）**：`.not.toBeNull()` 失败时实得值是 `null`（原语），照打印不误——本次 `workspace-entry.test.tsx` 里那条「先有一棵树可比」的前置断言属于此类，保留。
  - 🧭 **门禁（T019 收尾，串行，2026-10-06）**：`packages/app` 组件测试 **357 pass / 0 fail / 812 expect / 26 文件**（T011 基线 330 ⇒ ＋13＋6＋8＝27 条，文件 24 ⇒ 26）；`test:unit` **824 / 0 / 3173 expect / 117 文件**（同基线）；`lint:openhive` **exit 0**（23 warnings / 0 errors / 86 files——警告数同基线 23，文件 81 ⇒ 86 即新增 5 个文件，**新增文件 0 命中**）；本次改动 7 文件单跑 oxlint **0 warnings / 0 errors**（仓库根跑，`#004-10`）；`typecheck` **31/31**。


- [x] T020 [US2] [BE] 实现文件树的**复制 / 移动 / 上传 / 下载**（四项的真执行＋接线）[FR-005] [T007][T008][T018] [出参：右键菜单这四项真能执行]
  - 🔒 **补编号裁定（2026-10-06，用户「补，phase 你定」）**：T008 侦察出的**计划缺口**——这四个动作在 `tasks.md` 里**零任务认领**（`grep` 全文只命中 T008 那一行，且只到「菜单」为止）。编号按先例**排最后、不重排既有编号**（同 T017／T018／T019）。**归 Phase 4（US2 文件树）**：功能域就是文件树，与 T007／T008／T009 同一组件；不归 Phase 6（MinIO）——那两条是**云端备份**，方向与对象都不同（设计 §6.3 已明确区分「拖拽 A 沙箱↔本地电脑」与「拖拽 B 沙箱↔MinIO」）。
  - ⚠️ **需求锚（**必须用现行编号**，理由见 `state.md` 的「跨 feature 备注」补记）**：现行 **`FR-005`**（文件树 MUST 支持新建／重命名／删除／**复制／移动／上传／下载**完整操作）＋ **US2 验收场景 3**（右键菜单**可执行**复制/移动/上传/下载/备份/拉回）。⚠️ 设计 §6.2 那句括号里的 `FR-016` 是**旧前端 spec `002-openhive-frontend-ui` 的编号，现行 spec 里不存在**——别照抄。
  - ⚠️ **范围（按 2026-10-06 的侦察实证写，四条）**：
    1. **沙箱内单文件 copy**——**今天完全没有**（无端点、无服务）。可复用的底座：`packages/core/src/file-mutation.ts` 的 `FileMutation.Service`（已有 `create` / `write` / `writeTextPreservingBom` / `writeIfUnchanged` / `remove`）。
    2. **沙箱内单文件 move**——同上，**没有**。全仓唯一「单文件移动」先例是 `packages/opencode/src/tool/apply_patch.ts` 的 `move_path` 分支（**写新 → 删旧**两步）；⚠️ V2 那侧**明确不支持**（`packages/core/src/tool/apply-patch.ts` 里 move 直接返回「not supported yet」）⇒ 别指望有现成实现。
    3. **上传**——**全仓无 multipart 端点**（`grep multipart/form-data` 只命中生成的 SDK 序列化器与 stats/console 无关应用）⇒ 端点要**从零新增**。
    4. **下载**——最接近的是 `packages/server/src/handlers/fs.ts` 的 `FileSystemHandler.fs.read`（`GET /api/fs/read/*`，直接返回原始字节），**但没有 `Content-Disposition: attachment`** ⇒ 要在它之上补，或另开一条；另有一条 JSON 形状的 `GET /file/content`（二进制转 base64）可作备选。
    5. **客户端接线**——四项回调（`onCopy` / `onMove` / `onUpload` / `onDownload`）今天**全未接线**（`workspace-entry.tsx` 只传 `paths`）。**已有先例可抄**：上传控件见 `packages/app/src/components/dialog-edit-project.tsx`（`<input type="file">` ＋ `onDrop`/`onDragOver`/`onDragLeave`）与 `packages/session-ui/src/v2/components/prompt-input/attachments.ts`（完整拖放：`dataTransfer.files` ＋ 文件选择器 ＋ `createObjectURL`）；下载触发见 `packages/app/src/utils/session-export.ts` 的 `downloadSessionExport`（`Blob` ＋ `createObjectURL` ＋ `<a download>` ＋ `revokeObjectURL`，最标准的模板）。
  - ⚠️ **交互口径（设计 §6.3「拖拽 A」）**：拖出浏览器到桌面＝下载、从桌面拖回＝上传，**含文件选择器上传**。右键菜单是「拖拽的替代入口」（设计 §6.2 原话），两条都要。
  - ⚠️ **为什么是一条而不是拆 BE／FE 两条**：`copy`／`move` 没有「库 vs 交互」的分野（不像 T011「MinIO 客户端」与 T012「双树拖拽」那样一为库、一为交互）；而上传／下载的 FE 与 BE 是**同一动作的两端**——控件选了文件却没有接收端点，就正好落回 T005–T008 立下的口径「**未接线即 disabled**」（一个点了没反应的按钮是对用户的谎）。故合为一条，标 `[BE]`（主体在后端）。
  - ⚠️ **权限锚（**不新造判定**）**：`plan.md` 的 IV 已裁定「**文件操作权限靠 F3 沙箱锚定**」——即**不**接 `project_member` 判定、**不**接 `core/access` capability（004 裁定④：契约零消费者，留给 F6/F7）。服务端按 `x-openhive-project` 头把目标目录钉在 `{OPENHIVE_WORKSPACE_ROOT}/{userId}/{projectId}`（`.../httpapi/middleware/project-location.ts` 的 `PROJECT_HEADER` ＋ `anchor-workspace.ts`）；⚠️ **头缺失时文件路由会退回纯沙箱根** `join(root, userId)` ⇒ 四个动作都必须**要求项目头在场**，否则会跨项目操作。
  - ⚠️ **边界**：**备份到 MinIO ／ 从 MinIO 拉回**（菜单第 9／10 项）**不在本 task**，归 **T011／T012**（设计 §6.2 表里它们与上传/下载同组但方向不同，别合并）。
  - 🚩 **前置两条（开工前必须先办）**：
    1. **文件列表读取**——`packages/app/src/project/project-files.ts` 今天**没有写入方**，左栏文件树**恒走空态**（该文件头已注明「读文件列表」是「T018 之后的欠账」）。⚠️ 但 **T018 的范围块里此前没有这一条** ⇒ 已按 `LEARNINGS #002-04` **补进 T018 的范围 ⑤**。没有「列文件」就没有可操作的对象，本 task 的四项全都落不了地。
    2. **先补一条用例：文件树入口的实例目录确实上移了**——`.../httpapi/middleware/project-location.ts` 文件头的「已知不覆盖」第三条**点名了本 task**：原话是「……于是**文件树 / pty / 上传那些入口的实例目录也跟着上移**。这是产品想要的方向……但那些入口**没有跑过带头的情形**——它们的行为是**推**出来的，不是测出来的。**要动它们之前先补一条用例**」。⇒ 本 task 是这条账的第一个消费者，**第一步就是补这条用例**（RED），别默认这条路已经验过。

> 📌 **T020 编号排最后、归属在 Phase 4**（2026-10-06 T008 收尾时裁定补入，同 T017／T018／T019 先例）：编号是 **ID 不是顺序**，故正文里出现编号与位置不一致是**故意的**。

  - ✅ **出参落地（T020，2026-10-07）**：右键菜单那四项**真能执行**——「复制」「移动」弹同一个**目标目录选择器**（`target-picker.tsx`）、「上传」走**文件选择器**（含从桌面**拖入**）、「下载」把字节取回并**落盘**。四项都只落在项目内，**且四项一律要求 `x-openhive-project` 头在场**（第 171 行那条 ⚠️ 的警告——头不在时文件路由退回**裸沙箱根**＝所有项目的父目录）。**权限锚不新造判定**，搭 F3 沙箱那道锚走。
    - **改动文件（15 个）**：生产 8 —— 新 `packages/opencode/src/server/openhive/file.ts`（425 行）、`packages/app/src/project/openhive-file-ops.ts`（234）、`packages/app/src/project/target-picker.tsx`（122）；改 `packages/app/src/project/{file-tree.tsx,project-data.ts,project-files.ts}`、`packages/app/src/workspace/workspace-entry.tsx`、**上游** `packages/opencode/src/server/routes/instance/httpapi/server.ts`。测试 7 —— 新 `packages/opencode/test/server/openhive-file-ops.test.ts`（753 行）、`packages/app/src/project/openhive-file-ops.test.ts`（305）、`packages/app/src/project/target-picker.test.tsx`（190）；改 `file-tree.test.tsx`、`project-data.test.ts`、`workspace-entry.test.tsx`、`openhive-project-directory.test.ts`。
    - **上游侵入面 1 处**：`server.ts` **9 insertions / 0 deletions**（全是「加」），带 `【保留的定制 · 同步上游时不要丢】`；**与它挂载的 `file.ts` 同属一次提交**（`server.ts` 那句 import 指向 `file.ts`，硬拆则中间那个提交**连导入都解析不了**；而 `openhive-file-ops.test.ts` 走 `HttpApiApp.routes`，少了挂载四条路由全 404 ⇒ 拆不出「既过测试、又只含上游那一处」的提交），**前端半边另起一次提交**。`git diff --stat bun.lock` **空**。
    - **门禁（全部串行，`#003-01`；命令一律带 `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`）**：新文件（opencode）**19 pass / 0 fail / 92 expect**；opencode 项目族 **10 文件 88/0**；app `test:components` **470/0/28 文件**、`test:unit` **895/0/121 文件**、`test:browser` **41/0/14 文件**；`typecheck` **31/31 exit 0**；`lint:openhive` **23 warnings / 0 errors / 99 files / exit 0**（改动文件 0 命中）；根 `lint` **4953 w / 1 error / exit 1**——那个 error 仍是**既有上游** `session-ui/…/prompt-input/index.tsx:163`（同 `#001-02`），**改动文件 0 命中**。
    - **变异 21 组，三类据实记（`#003-03`）**：BE **14 组**（M1 12/1；**M2 11/2 属 ②类**；M2b 12/1 **只有移动那条红**；M4、M5、M11–M19 各恰红 1）＋ FE/UI **7 组**（**F-M1 红 3、F-M5 红 3，皆 ②类**；F-M2／F-M3／F-M4 恰红 1；F-M6 红 4；`file-tree` 去掉 `types.includes("Files")` 恰红 1）。⚠️ **M19 ≡ M2b**（同一处同一改法、跑过两次）**记为同一条证据、不重复计数**；**M15 的报错文本在同一行号打印两次**（不是两处都触发，由 **M16** 恰红在**另一行**反证）；**F-M5 第一次的改法是「翻转判据」得 7 红**，换成「摘掉」才是要测的形状——两次都记 ②类、**不写成恰红**。⚠️ 表里 M1／M2／M2b／M4／M5 五行的数字**从会话记录回收、本轮未复跑**（详见 `state.md` T020 节）。
    - **★ 第二轮审查（`#003-02`，三席并行）抓到 5 条、全部已修**，最重一条是**本次 diff 自己引入的 Critical**：`inside` 是**纯词法**判据，而复制 / 上传 / 下载走**跟随链接**的系统调用 ⇒ 项目里一个指向**兄弟项目**的 junction 就能让四项动作**全都伸到项目外**（探针独立复现：`copyFile` 真把兄弟项目的文件写进沙箱根）⇒ 新增 `realInside` **四处**落点 ＋ 下载 `stat`→`lstat`，**RED 先行 14 pass / 5 fail → 19 pass / 0 fail**，成牙证据 M11–M14 各恰红 1。另四条：**「不带头上传」那条断言判别力为零**（只发**同名**时 `exists` 预检 ＋ `wx` **各自**就回 400 ⇒ 绿得毫无信息；补**新名**「偷渡.txt」作真判据，由 **M16** 证明有牙）／四处 `tasks.md:177` **引用错行**（真锚在 **171**，改成点名内容，`#004-05`）／`openhive-file-ops.ts` 拿「挂账」去指 `tasks.md` 而那里写的是「两条都要」（改成明说二者不是一回事、指向 `state.md` 的 T020 节，`#004-03` 同族）／测试文件指向的「变异记录」当时不存在（该节即是）。
    - ⛔ **缺口的另一半（如实记，不是「做了」）**：**「拖出浏览器到桌面＝下载」没做**——用户 2026-10-07 裁定**挂账**（三条平台事实：`dataTransfer` 在 `dragstart` 后**只读**；`DownloadURL` 要真 HTTP URL 而**带不了项目头**；行今天本就**不可拖**——`draggable` 挂在属 **T022** 的 `onBackup` 上）。⚠️ 第 169 行那句「两条都要」是**设计口径**，**不是现状**；而「从桌面拖回＝上传」这**另一半做了**，别一起当成没做。
    - ⛔ **挂账（不阻塞）**：**上传无体积上限 ＋ 四项无超时**（`formData()` 把整个请求体读进内存；**上限是产品数字**——话单 / 资金文件本来就大，故不凭空造常量，**留人裁定**）；**移动的「目标已存在」在竞态下有缝**（Node 的 `fs` **没有**「目标存在即失败」的改名原语；复制有 `COPYFILE_EXCL` 兜底、**移动没有**）；`Content-Disposition` 清洗与 `inside` 的 UNC／盘符判据**本机测不出**；两条旧账**本次不修**（`workspace-entry.test.tsx:466` 写死「27 条」而实际 **80**，出处 `6afafc08`；`workspace-entry.tsx:316` 指向「state.md 的欠账表」与「AI 资产」而全仓 `grep` **零命中**，出处 `2c35b888`）——遵「外科手术式改动」。

## Phase 5: US3 成员管理（P1）

- [x] T010 [US3] [FE·新增] 实现成员面板（👥 侧滑：邀请/移除/退群，按微信群模型）[FR-004] [T004] [出参：owner 邀请/移除、member 退群]
  - 🔒 **范围裁定（2026-10-06，T010 开工前用户裁定）**：**照 T005–T008 口径 = 前端面板 ＋ 接缝**（受控组件，只喊 `onInvite` / `onRemove` / `onLeave`），**不新增后端 API、不真落库**。真执行的接收方见下面的 **T021**（本次同批补入）。
  - ⚠️ **置灰判据不许重写**：面板上「谁能移除谁、谁能退群」的可用性一律走 `ProjectMembership.decide`（`packages/app` **已依赖** `@opencode-ai/core`，实测 `packages/app/package.json`）——**同一份规则不写第二遍**（`LEARNINGS #002-06` / `#004-02`：一份判定、多个出口，必须共享实现而非靠注释对齐）。`decide` 收 `{actor, action, target, archived}` 四项，面板的 props 里要有「我的 role」与「项目是否已归档」才喂得进。
  - 📌 **设计规格**：`2026-09-11-项目管理-design.md` §4（👥 侧滑面板：`＋ 邀请成员（输入警号）` ／ 成员列表带 role 与「本人」标记 ／ 每行 `[移除]` ／ 底部 `[退出项目]`）。
  - ✅ **出参落地（T010，2026-10-06）**：新建 `packages/app/src/project/member-panel.tsx`（受控组件，`data-component="member-panel"`）＋ `member-panel.test.tsx`（**18 条**）＋ 接缝 `packages/app/src/project/project-members.ts`；接线落在 `packages/app/src/workspace/workspace-entry.tsx`（`memberOpen` 信号 ＋ `ProjectAnchor` 的 `onOpenMembers`——T005 就预留好的回调、注释点名「接的是 T010」＋ `member-panel-slot` 浮层）＋ `workspace-entry.test.tsx`（＋6 条）。**权限一律问 `decide`，本组件零规则复述**：`actor` 从 `selfPoliceId` 在成员表里反查 role，查不到就是 `null` ⇒ 前面对每个动作都落空 ⇒ 天然 fail-closed。
  - ⚠️ **「权限决定画不画、接线决定能不能点」——两条独立的理由**：`decide` 说不成立 ⇒ 按钮**根本不渲染**；回调没给 ⇒ 渲染成 `disabled`。混在一起写就会得到「有权限但没接线」时按钮**可点而无声**的形状（T005 起的老口径）。四条权限各有用例：member 看不到别人的 `[移除]`、owner 自己那一行也没有 `[移除]`（移除目标必须是 member，否则项目无主）、owner 看不到 `[退出项目]`、已归档时三条动作全不画。
  - ⚠️ **变异 M5 逼出的一处收敛（`#002-06` 的又一实例）**：「谁是我」我一开始写了**两遍**——`我()` 里的 `find(...)` 判权限，标记里另写 `m.policeId === props.selfPoliceId`。把 `find` 换成 `成员()[0]` 时**只有权限那侧红**（5 条），标记那侧一条都不动。改成 `<Show when={m === 我()}>`（比**同一个对象引用**，两处都取自 `props.members` 的元素）后，同一个变异红 **6** 条——一个判断一处实现，一个变异点覆盖两处。
  - ⚠️ **探针自己的一处 bug（红得莫名其妙的那类）**：`行内有(row, slot)` 起初写成 `row?.querySelector(...) !== null`，**行压根不存在**时 `undefined !== null` 为 `true` ⇒ 它替一棵没渲染出来的行作证「里面有权限按钮」（假绿），并把紧接着的 `null!` 撑成 `null.querySelector` 的 TypeError。判据：**返回布尔的探针必须显式判 `row !== null`**，不能靠 `?.` 的 `undefined` 碰巧不等于 `null`。
  - 📌 **面板形态**：定位（`absolute`）由**调用方**包一层，同 `ProjectPanel`——`MemberPanel` 自己不知道自己在哪儿（happy-dom 没有 CSS 引擎，几何本来也测不进组件）。两个浮层**互斥**（开一个就关另一个）：左栏只有一列宽，叠着是「坏了」的样子不是风格选择，有测试钉住。
  - ✅ **变异验证（2026-10-06，串行跑，据实记三类 `#003-03`）**：<br>**组件侧**：**M1** `能("invite")`⇒`true` 恰红 **2**；**M2** `能("remove", m.role)`⇒`true` 恰红 **4**；**M3** `能("leave")`⇒`true` 恰红 **3**；**M4** 忽略归档 恰红 **1**；**M5** 不看 `selfPoliceId` 恰红 **6**（收敛后；收敛前 5）；**M6** 未接线也可点 恰红 **1**；**M7** 空警号也喊 恰红 **1**；**M8** 喊错人（永远喊第一行）恰红 **1**。<br>**接线侧**：**N1** 徽章点了不开 恰红 **5**；**N2** 两浮层不互斥 恰红 **1**（⚠️ 首跑 sed 的子串匹配**连带删掉** `onOpen` 回调里那处同名的 `setPanelOpen(false)`，红成 2 条——**收窄到 `onOpenMembers` 行内**后才是恰红；那是**工具不精确**造的②类假象，据实记在这里，不是被测对象的性质）；**N3** `members` 恒 `undefined` 恰红 **1**；**N4** 标题硬编码 恰红 **1**。<br>**12 个变异全部①类（恰红目标），无②③类**。
  - 🧭 **门禁（T010 收尾，串行，2026-10-06）**：`packages/app` 组件测试 **330 pass / 0 fail / 24 文件**（T009 基线 306 ⇒ ＋24，其中 T010 ＋24）；`lint:openhive` **exit 0**（23 warnings / 0 errors，**本次三文件 0 命中**——引入的 4 处已当场清掉：`Icon` 死导入 ＋ 3 处类型断言）；`typecheck` **31/31，exit 0**（⚠️ 首跑红 3 条：`文本(行(host,…), …)` 传进去 `HTMLElement | null`——`bun test` **不做类型检查**，所以 RED/GREEN 一路没暴露，已放宽 `文本` 的签名收 `| null`）；`bun run lint` **本次文件 0 命中**（那 1 error 仍是 `#001-02` 记的上游 `session-ui/src/v2/components/prompt-input/index.tsx:163`，裁定不私改）。
  - ⛔ **不在本 task 交付**：邀请 / 移除 / 退群的**落库与 HTTP 出口**——三个回调今天不接线（⇒ 按钮 `disabled`），归 **T021**。

- [x] T021 [US3] [BE] 实现成员**邀请 / 移除 / 退群**的落库 ＋ HTTP 出口（判定一律走 `decide`）[FR-004] [T004][T018] [出参：owner 能邀请/移除、member 能退群，越权被拒]
  - 🔒 **补编号裁定（2026-10-06，T010 开工前用户裁定「只做前端＋接缝，另补编号」）**：T010 侦察出的**计划缺口**——`grep` 全 `tasks.md`，「邀请 / 移除 / 退群」的**服务端出口与落库零任务认领**：T004 只交纯判定（`membership.ts`）＋ 两张表，T010 只交前端面板，T013／T014／T015 是归档线（归档 / 找回 / 失权），T018 的范围是项目 CRUD。按 T017／T018／T019／T020 先例：**编号排最后、不重排既有编号**，**归 Phase 5（US3 成员管理）**。
  - ⚠️ **为什么依赖 T018**：邀请的语义是「把某某加进**项目 X**」，前提是项目 X 真的在库里——而 `project` 行与 `project_ext` 行的**同步创建**归 T018（U4 的「收成一个写入模块」）。在那之前出口没有可作用的对象。这是本次「不在 T010 里硬做」的**实证理由**，不是排期偏好。
  - ⚠️ **判定不许重写**：授权一律走 `packages/core/src/project/membership.ts` 的 `decide`。它的出口是 `boolean`（无结构化理由），文案由本层接线组（T004 已记：接线层自己知道问的是哪个动作、归档态是什么）。
  - ⚠️ **两层要分清**：① **授权**（`decide`，服务端每次调用都问）与 ② **库的不变量**（`project_member` 的部分唯一索引管「至多一个 owner」、`project_archive` 管归档态）是**不同层的两件事**——别把库拿到的不变量当成授权，也别指望 `decide` 能看出「库里有两个 owner」（它只看得到一个 `role`，T004 已记）。
  - ⚠️ **文件落点开工前先核**：`membership.ts` 的文件头写着接线归 `packages/opencode/src/project/member.ts`，但 `packages/opencode/src/project/` 是**上游目录**（`bootstrap.ts` / `project.ts` / `vcs.ts` 都在那儿），而本仓定制惯例是自有目录 `packages/opencode/src/server/openhive/`（`access.ts` / `gateway.ts` / `ui-shell.ts`）。二选一要显式裁定并**回头改 `membership.ts` 文件头那句**（`LEARNINGS #002-06`：位置漂了不会报错，也没人会回来改）。
  - ✅ **出参落地（T021，2026-10-07）—— 两半一次做完（用户裁定）**：<br>**BE** ＝ 新建 fork 自有路由模块 `packages/opencode/src/server/openhive/member.ts`（四个出口：`GET /openhive/project/member?projectId=` 名单 ／ `POST …/member/{invite,remove,leave}`）＋ 挂进 `httpapi/server.ts` 的 `Layer.mergeAll`（**11 insertions / 0 deletions**，全「加」、带【保留的定制 · 同步上游时不要丢】）＋ auth 侧两处「加」（`user.ts` 的 `usersByIds` / `userByPoliceNo` ＝ 警号 ⇄ UUID 的翻译层；`project-member.ts` 的 `removeMember` 由移除与退群共用、**判定留在各自调用点**）＋ 测试 `packages/opencode/test/server/openhive-project-member-route.test.ts`（**18 条**）。<br>**FE** ＝ 新建 `packages/app/src/project/openhive-members.ts`（四个出口的薄客户端，同 `openhive-project` / `openhive-file-ops` 口径：`listMembers` 三态、三条写出口共用一条 `memberAction`）＋ `openhive-members.test.ts`（**23 条**）＋ `project-data.ts` 四个方法（`members` / `invite` / `remove` / `leave`）＋ 接线落 `workspace-entry.tsx`（名单 effect ＋ 三个 handler ＋ `member-op-message` 一句话）＋ `workspace-entry.test.tsx`（**＋10 条**）。
  - ✅ **本 task 的核心是「翻译」（BE 文件头整节）**：`project_member.user_id` 存的是 `auth.user.id` 那个 **UUID**，而界面说的、`selfPoliceId` 比的、邀请框里填的都是**警号**。不翻译不会报错——只会画出一列谁也看不懂的字符。翻译**只能在服务端**（本仓只有 `packages/opencode` 同时看得见两张表），故 FE 层**一个 UUID 都不出现**；把这个映射提到前端 = 把「谁是谁」变成两份判断（`#002-06`）。
  - ✅ **那条 ⚠️「文件落点开工前先核」已办结（用户裁定「自有目录 `server/openhive/`」）**，但**它的前半句是一条已经假掉的镜像声明**：`grep` 实测**该 ⚠️ 写下时**文件头确实写着 `packages/opencode/src/project/member.ts（T010/T013/T015）`，而 **T015（`403ad2fafb`）已把那行改成**「`server/openhive/archive.ts` ＋ `middleware/project-location.ts`」——本 task 开工时**那句早就不在了**。⇒ 本次办的是 ⚠️ 的**意图**（文件头必须点名真落点）：在该表的接线行补上 `server/openhive/member.ts`（T021）。`#004-03` 的又一实例——**「文件头写着 X」也是会假的镜像声明，开工前必须 `grep`，不能照抄**。
  - ⚠️ **三处刻意（都写在 `member.ts` 文件头，各有专门观测面钉住）**：① **名单的门是成员身份、不是 `decide`**（`PROJECT_ACTIONS` 里没有 `read` 是刻意的；归档**冻的是动作、不是看见**）⇒ 同一个已归档项目上「名单读得到、邀请 403」；② **邀请的授权先于解析警号**（反过来，非成员能拿 400/403 的差别当「这个警号在不在」的探针——而端点断言对顺序不敏感，`#004-09`，故专门造观测面）；③ **移除的目标只能取自本项目名单**（改按警号直删不报错，只会删掉**别人项目里**同一个人的行，而两次删除都回「成功」）。
  - ⚠️ **四个出口都不带 `x-openhive-project` 头**（与归档 / 找回同款）：带头会被 T017 中间件接住并套上「已归档 ⇒ 403」（`project-location.ts`），那样「冻不冻」就有了**两个**判据，而名单要的正是「归档 ≠ 看不见」（`#002-06`：同一个判断只留一处）。FE 侧为此专门钉了一条「不带项目头」（`openhive-members.test.ts`）。
  - ⚠️ **`invite` 与 `remove` 是「接反了不报错」那一类**：签名一模一样 `(projectId, policeNo)`、体一模一样、结论类型一样，**只有路径不同**（同 T020 的「复制 / 移动」）。接反的后果是「点移除，把那个人**又邀请了一遍**」，两次都回 200。故两条各钉一条「走的是哪条出口」，`project-data.ts` 的 `PROJECT_DATA` 上也有对应的 ⚠️ 注释。
  - ✅ **变异验证（据实记三类 `#003-03`）**：**BE 7 处 ＋ FE 11 处，全部①类（恰红目标），无②③类**。<br>**BE（7）**：拿掉名单的门 → 1 fail（恰好那条）；`policeId` 不翻译 → 4；解析挪到授权之前 → 1；拿掉邀请的门 → 4；`remove` 改按警号直删 → 1；拿掉退群的门 → 2；不读归档态 → 3；**对照用例均不红**。<br>**FE（11）**：M1 `invite` 走成 `remove` → 2；M2 403 并进 `[]` → 2；M3 去掉「切项目时先清空名单」 → 1；M4 去掉迟到回包的 `作废` 守卫 → 1；M5 退群后不收起面板 → 1；M6 归档态恒 `false` → 1；M7 办成后不拨名单代次（不重取） → 1；M8 移除传成姓名 → 1；M9 坏行改成「跳过」而不是整份 `undefined` → 2；M10 去掉「体里自述的 `projectId` 相符」判据 → 1；M11 未接线且去掉 `projectData` 守卫 → 1（**证明「没注入数据源 ⇒ 三颗按钮禁用」那条用例确有牙**）。**全部已还原**，还原后各套门禁复跑全绿。
  - 🧭 **门禁（T021 收尾，串行，2026-10-07）**：`packages/app` `test:unit` **922 pass / 0 fail / 3295 expect / 122 文件**；`test:components` **480 pass / 0 fail / 1052 expect / 28 文件**；单跑 `workspace-entry.test.tsx` **90 pass / 0 fail / 212 expect**、`openhive-members.test.ts` **23 pass / 0 fail / 24 expect**；根 `bun run typecheck`（turbo）**31/31 successful, exit 0**；`lint:openhive` **23 warnings / 0 errors / 101 files**（＝基线；**本次改动文件 0 命中**，23 条全在 `center/` 那几处）；**文件级** oxlint（**仓库根**，`#004-10`）本次 7 个文件 **0 warnings / 0 errors / 130 rules / exit 0**；`git diff --numstat bun.lock` **空**（一行未动）。BE 半边门禁见其提交信息（opencode typecheck exit 0、`openhive-project-member-route.test.ts` 18 pass / 0 fail / 47 expect、项目族 10 文件 88/0、auth `user.test.ts` ＋ `project-member.test.ts` 23/0）。
  - ⚠️ **测试夹具抓到一处既有缺陷（非本 task 引入，本次修掉）**：`workspace-entry.test.tsx` 的 `mount()` **从未调用 `render()` 的 dispose** ⇒ 每个挂过的 `WorkspaceEntry` **仍订阅**那几条模块级接缝，后面的用例改项目时，**旧实例**会用**它自己的假数据源**去取数并写同一条缝 ⇒ 谁的回包最后落地谁赢。实测证据：`Expected to contain: "乙/话单.csv" Received: [ "资料", "资料/话单.csv" ]`，而 `["资料/话单.csv"]` 在本文件**只出现一次**（那处 stub 无视 id）。本 task 让每个实例多一个名单订阅者 ⇒ 把这场竞态从「偶尔」拨成「常红」（新用例第二次跑就翻）。修法 ＝ `afterEach` 里**先卸载、再清 body**（顺序要紧）；修后连跑三次全绿，该文件耗时 **~50s ⇒ ~6s**。**同型 `mount()` 散落在 `src/**/*.test.tsx`**（`center/views`、`project/`、`auth` 都有），但只有「会写接缝的组件」才咬得到——已挂账。
  - ⛔ **已知不覆盖（如实记账，`#002-02`）**：① **重复邀请的预检只把 500 翻成 400**——并发下两次都过预检、第二次撞 PK ⇒ **500**（可接受；同族见 T020 的「移动在竞态下有缝」）；② **被邀者不做 `status` / `deactivated_at` 过滤**（本链回答「名单上有没有他」，不是「他今天能不能登录」）；③ `asRole` / `actorIn` 与 `archive.ts` 各一份，`messageOf` 与 `openhive-project.ts` / `openhive-file-ops.ts` 各一份（**三份逐字相同**）——都属「记账，留给下一次单开一笔」，本次遵「一个 PR 不混『重构』与『新功能』」。另两条残差见 state.md 的 T021 节：**`成员话` 在切换项目时不清**（与已审过的 `文件话` 同款）、**`member-panel.tsx` 把 `undefined` 与 `[]` 都显示成「还没有成员」**（对 403 / 网络错是一句假话；修它要动 T010 已审组件与它钉住的断言）。

## Phase 6: US4 MinIO 备份（P1）

- [x] T011 [US4] [BE] 实现 MinIO 客户端（文件级备份/拉回）[FR-007] [T002] [出参：文件可备份/拉回]
  - 🔒 **D0-4 裁定（2026-10-06）：用 `@aws-sdk/client-s3`**——复用既有 `@aws-sdk/credential-providers` 的同一 SDK 家族，`bun.lock` 增量最小；MinIO 是 S3 兼容。加依赖后**必查** `git diff --stat bun.lock`（只应有本次新增的条目）。
  - ✅ **§ 范围裁定（2026-10-06，T011 开工前用户裁定，三问全取推荐项）**：*落点* = `packages/core/src/minio.ts`（core 顶层，**不是** `core/src/project/`）；*凭据半场* = **只收凭据、不签发凭据**（STS / 策略变量留给 D-13）；*测试深度* = 加一个 `Bun.serve` **假 S3 端点**，让真 `@aws-sdk/client-s3` 真发请求。
  - ✅ **D0-4 的前提被实测推翻（省下一件事）**：`@aws-sdk/client-s3@3.933.0` **本来就是上游根 `package.json` 的依赖**（`upstream/dev:package.json` 第 113 行），已装、全仓**零 import** ⇒ **本次没有 `bun add`、`bun.lock` 一行未动**（实测 `git diff --stat bun.lock` 为空）。D0-4 担心的锁文件污染不存在；那条「加完必查」的纪律仍照走，只是这次查出来是空的。落点也顺带零成本：`packages/core` 的 `exports` 是通配 `"./*": "./src/*.ts"` ⇒ 新增 `src/minio.ts` **零 `package.json` 改动**。
  - ✅ **出参落地（T011，2026-10-06）**：新建 `packages/core/src/minio.ts`（`Minio.makeStore(config) ⇒ Minio.Interface`：`put` / `get` / `list` / `delete` 四个动作，**入参不带桶名与前缀**——前缀由构造时的 `scope` 定死）＋ `packages/core/test/minio.test.ts`（**22 条**）＋ 观测面 `packages/core/test/fixture/fake-s3.ts`（`Bun.serve({ port: 0 })` 起一个真 HTTP 端点）。
  - ⚠️ **观测面为什么是「假 S3」而不是「替身」**：`minio.md` §3 说的「测试注入替身」是给 **T012 / T013** 用的（它们的被测对象是归档流程，换掉 MinIO 是**边界替身**）；而 **T011 自己的产物就是那段 S3 实装**，用替身等于把被测对象换掉，那不是测试是缺口（`#002-02`）。本机没有 MinIO 可连，但可以有**一个够用的端点**——同 `#002-05` 的路数（PGlite 让生产驱动真连上）。残差也一样如实记：**它不闭合「真实 MinIO 的语义」**。
  - ⚠️ **收窄接口的用处**：`scope` 定死前缀 ⇒ **调用者给不出自己的前缀**（入参里根本没有这个位置）；同时 T012 / T013 的测试能在**边界**注入替身。这两件事是同一个设计的两个收益。
  - ⚠️ **键的前两段也是输入（`#004-01` 在这里的形态）**：「数底层函数的调用点」在键拼装这件事上表现为——键是**三段拼起来的**（`userId` / `projectId` / `path`），只查第三段会漏掉前两段；而前两段**比第三段更隐蔽**，因为它们**不在任何一次调用的入参里**。所以 `scope` 在**构造时**过同一条判据，`path` 在**每次调用**过，`keyOf` 是唯一拼装点。
  - ⚠️ **路径边界是「安全 ＋ 正确性」两条腿，判据取「请求根本没产生」**：S3 的键是不透明字符串，但 URL 不是——`007/p-42/../p-99/x` 若原样进请求路径，HTTP 那层一规范化就落在**别人的前缀**里。所以 `拒于门外` 的第一条断言是 `s3.requests.length === 0`，「调用方收到了错」是**伴随信号**排在其后（`#004-14`）。反斜杠单列一条：win32 拿它当分隔符，`..\p-99\x` 与 `../p-99/x` 在那边是同一件事。
  - ⚠️ **`list` 必须把分页走完**：`ListObjectsV2` 一次最多 1000 条，超出置 `IsTruncated` ＋ `NextContinuationToken`。只发一次请求的写法**在小项目上永远绿**，项目文件过千就静默少列——而归档（T013）正是拿这份清单去传文件的，「少列一条」= **少备份一个文件**，且不报错。夹具把 1000 缩成 `pageSize: 2`，于是「过千才出错」的缺陷在三条数据上就现形（`#002-01` 的形态）。
  - ⚠️ **404 要分「对象没备份过」与「桶配错了」**：只认 `NoSuchKey` ⇒ `undefined`；`NoSuchBucket`（**也是 404**）必须上抛。判据钉在 `error.name` 上，实测（探针，2026-10-06）`@aws-sdk/client-s3` 把响应 XML 里的 `<Code>` **原样放进 `error.name`**（403 那条实得 `"InternalError"`，桶配错那条实得 `"NoSuchBucket"`）。后果方向相反：一个是「这个文件没备份过」，一个是「你的桶根本不存在」。
  - ⚠️ **一处观测面修正（`#004-13` 情形①「没有现成观测面 ≠ 没有观测面」）**：夹具最初绑 `127.0.0.1`，于是 **M15**（`forcePathStyle: true ⇒ false`）跑出 **21 条全绿**。根因不是「那行是多余的」，而是**端点 host 是 IP 字面量时 SDK 会自己退回 path-style**（`openhive.127.0.0.1` 不是合法主机名）⇒ 那一行**在原来的观测面里根本不可见**。换观测面（夹具绑 `localhost`、端点给主机名）后 M15 变红 **13** 条。这不是洁癖：`forcePathStyle` 在真环境里是要命的（MinIO 在 `minio.internal:9000`，不开就打到 `openhive.minio.internal`）。夹具里另有一条兜底：万一某台机器把 `*.localhost` 通配解析了，请求会带着桶名当主机名到达，落到「桶名不是 openhive」那条 404 上——**两种世界都是红**。
  - ⚠️ **一条「只有 typecheck 才守得住」的代码——M14 全绿的正确读法**：`if (response.Body === undefined) throw` 变异掉之后**22 条全绿**。按 `#003-03` 类③ 的规矩本该删，但**实测删掉它 `typecheck` 立刻红**（`src/minio.ts(132,16): error TS18048: 'response.Body' is possibly 'undefined'`，`packages/core` `tsgo --noEmit` exit 2；还原后 exit 0）。⇒ 那段代码**不是「没人守的多余代码」，而是一次类型收窄**——`#003-03` 类③ 的前提是「只有测试能守它」，这里前提不成立，而这件事是**量出来的、不是推出来的**（`#003-04`）。故按要求保留，并把「谁在守它」写在这里。
  - ⚠️ **补的一条「杀死另一种实现」的用例**：403 那条只能证明「**非 404** 的真错误会抛」；把判据写成 `状态码 === 404 ⇒ undefined`（很自然的写法，因为「404 就是没有」）那条**照样绿**。故补「桶名配错（404 `NoSuchBucket`）」一条，钉 `error.name === "NoSuchBucket"`；**M16**（把判据改成按状态码）**恰红 1 条**、正是这条 ⇒ 它确有牙。⚠️ 据实说明：**这条不是 RED-first 写出来的**——补它时实装已经是对的，所以拿 M16 的恰红当它的成牙证据，不冒充「先红后绿」。
  - ⚠️ **一处我自己的 bug（测试先红才发现的）**：把 `拦住了` 改成基于新助手 `抛了` 时，`.then` 两个分支**写反了**——`抛了` 在「动作真的抛错」时是**正常 resolve**（它把错误当返回值交出去），只有「动作居然成功了」才 reject。于是 7 条路径边界用例当场全红。是测试先红的，产品码没动。
  - ✅ **变异验证（2026-10-06，串行跑，据实记三类 `#003-03`）**：**16 个变异全部①类（恰红目标），无②③类**。<br>**M1** 去掉「`..`」判据 ⇒ 红 **5**（它一处守着**三个输入**：`path` ＋ `scope.userId` ＋ `scope.projectId`，各自有用例）；**M2** 反斜杠 红 **1**；**M3** 盘符 红 **1**；**M4** 开头的「/」红 **1**；**M5** 空路径 红 **1**；**M6** 建店时不校验 `scope.userId` 红 **1**；**M7** `list` 不剥前缀 红 **4**；**M8** `list` 不翻页 红 **1**（正是「三条数据一条不少」那条）；**M9** 前缀漏掉 `projectId` 红 **6**；**M10** 把所有错误都吞成 `undefined` 红 **3**（403 条 ＋ 桶配错条 ＋ **`get` 的路径边界条**——因为 `keyOf` 在 `notFoundToUndefined` 的闭包**里面**，吞错会连带吞掉边界校验的抛出）；**M11** `put` 绕过键边界 红 **6**；**M12** `get` 绕过 红 **1**；**M13** `delete` 绕过 红 **1**；**M14** 空 body 分支 红 **0**（见上，守它的是 typecheck）；**M15** 关掉 `forcePathStyle` 红 **13**；**M16** 改按状态码判 404 红 **1**。
  - 🧭 **门禁（T011 收尾，串行，2026-10-06）**：`packages/core` `bun test` ⇒ **1209 pass / 8 skip / 5 fail / 3275 expect() / 1222 tests / 159 files**（对比**本轮开工时同机同 worktree** 的 **1208 / 8 / 5 / 3274 / 1221**：＋1 条用例、＋1 次 expect，**5 条失败名称未变**，全是上游 `NpmConfig.*`——本机 `~/.npmrc` 指向镜像所致，与本题无关）；`packages/app` `bun run test:components` **不适用**（本题零前端改动）；`bun run typecheck`（根 `tsgo -b`）**31/31 successful，exit 0**（29 cached）；**文件级** oxlint（仓库根，`#004-10`）`bunx oxlint packages/core/src/minio.ts packages/core/test/minio.test.ts packages/core/test/fixture/fake-s3.ts` ⇒ **0 warnings / 0 errors / 3 files / 130 rules / exit 0**；`bun.lock` **一行未动**。
  - 🚩 **`lint:openhive` 对本题是空结论（记下来免得下次再报一次假的）**：它 **exit 0**（23 warnings / 0 errors / 81 files），但**只扫 `packages/app/src/{rail,center,topbar,workspace,project,auth}` 六个目录**——**不覆盖 `packages/core`**（脚本原文见根 `package.json`；输出里 29 处文件命中全是 `packages/app/`）。所以「本次文件 0 命中」在这道门上**恒真**。**任何 `[BE]` 落在 `packages/core` / `packages/auth` / `packages/opencode` 的 task，必须另取文件级 oxlint，不能拿这道门当判据。**
  - ⚠️ **文件级 oxlint 首跑 1 warning，已按仓库成文写法清掉**：`await-thenable` 命中 `await expect(store.get(...)).rejects.toThrow()`。`packages/auth/src/{rbac,rls,migrate-cli}.test.ts` 三处都留着同因同注——「**刻意不写** `await expect(...).rejects.toThrow()`：`bun-types` 把 `.rejects` 声明成 `Matchers<unknown>`，`await` 一个 `void` 会被记一条，**全仓已有 98 处同类命中**」。本文件改成仓库同一写法：一个返回**错误本体**的 `抛了(run)` 助手。顺带比原写法更强——「抛了」只是伴随信号，返回错误本体才能钉「抛的是**哪一个**错」（`#004-14`），而正是这一条让 M16 有牙。
  - ⛔ **不在本 task 交付**：① **文件级备份/拉回的接线与出口**（谁调 `makeStore`、endpoint 与桶从哪来、菜单第 9/10 项背后谁执行）⇒ 归 **T012**（前端双树）与 **T013**（归档）；② **环境变量读取**（`minio.md` §4 的五个 `OPENHIVE_MINIO_*`）**刻意没有落进本模块**——§4 原文写着「最终以 T011 的实装为准」，但凭据那一半的形状**恰恰是 D-13 要裁定的东西**，现在写死「读 `ACCESS_KEY` / `SECRET_KEY`」等于替 D-13 提前拍板，与本次裁定的「只收凭据、不签发凭据」相抵。⇒ **`OPENHIVE_MINIO_*` 在本 task 收尾时全仓零引用，读取落点随 D-13 一并裁定**。<br>⚠️ **2026-10-06 补记（T013 收尾时同步，`#002-06`：同一件事别在两处各写一份）**：**T013 已落地这份读取**——`archive.ts` 里的 `MinioConfig` 读 `minio.md` §4 那五个 `OPENHIVE_MINIO_*`（`Config.option(Config.all({…}))`，**整组配齐才算配**），用户裁定「落 env 读取，D-13 只留『怎么签』」。所以本节那句「随 D-13 一并裁定」**已过期**：读取落点就是 T013，D-13 剩的是**凭据路径**（STS / 桶策略 / `${aws:username}` / 服务端代写各前缀），不是「读哪几个变量」。**T022 复用 `MinioConfig`，别另造一个。**；③ **桶策略 / STS `AssumeRole` / `${aws:username}`**——本机一条都验不到（无 MinIO、无目标内网），**如实记为缺口**（`#002-02`：测不了的要写成缺口，不能写成覆盖），D-13 部署时实测。
- [x] T012 [US4] [FE·新增] 实现上下双树拖拽（沙箱 ↔ MinIO，已备份标 ✓）[FR-007] [T011] [出参：拖拽备份/拉回成功]
  - ✅ **§ 范围裁定（2026-10-06，T012 开工前用户裁定，四问全取推荐项 A）**：① **范围** = 只做前端 ＋ **另补编号 T022** 承接 MinIO 的 HTTP 出口（凭据形状 D-13 **不提前拍板**）；② **✓ 的判据** = **纯路径**（`MinIO key 清单 ∋ 沙箱相对路径`），不动 `Minio.Interface.list`；③ **双树落点** = 只替换「文件」pane 的**内容**，`[会话][文件]` tab 容器（T019）**保留**；④ **同名冲突** = 备份**直接覆盖**（盖的是自己那份旧备份，反复备份不该被拦），拉回覆盖沙箱现行那份时**先确认一次**。
  - ✅ **出参落地（T012，2026-10-06）**：新建 `packages/app/src/project/dual-file-tree.tsx`（`DualFileTree`：上树＝`FileTree` 本体、下树＝`MinioTree` 只读树、中间 `ResizeHandle` 可拖分隔条、拉回二次确认内联条）＋ `packages/app/src/project/dual-file-tree.test.tsx`（**20 条**）；改 `packages/app/src/project/file-tree.tsx`（**只加一个 `draggable?: boolean` prop** ＋ 行上一个判断，其余一行未动）；接线 `packages/app/src/workspace/workspace-entry.tsx`（`dualOpen` 信号 ＋ 「文件」pane 换内容 ＋ 窄条 `onOpen` 一步做两件事）。
  - ⚠️ **上树不另起一棵，`FileTreeProps` 整份 `extends` 后 spread**：上树要能干文件树能干的**一切**（搜索 / 折叠 / 新建 / 右键，T007–T009 已做完），逐项转发就是一份会漂的镜像（`#004-07`：说「同形」要按**被调方的全表**打勾）。`extends` ＋ `splitProps` 掉自己那五个、其余原样给 `FileTree` ⇒ 上树的能力面**跟着 `FileTree` 长**，本组件不必每次回来补。
  - ⚠️ **拖拽用事件委托，两棵树的行结构**刻意**同构**：两棵树的行都带 `data-slot="file-tree-row"` ＋ `data-path` ＋ `data-type`，靠 `data-tree` 区分是哪棵 ⇒ 「从哪棵树、拖的哪一行、放到哪棵树的哪一行」在**最外层**一次问完（`#004-12`）。代价是下树**复用 `file-tree-row` 这个 `data-slot`**（看着像笔误，实为委托的唯一前提），两处注释都写了。收益是 `FileTree` / `MinioTree` **都不必知道「MinIO」这种东西存在**——它们只交出一个事实：「这行可以拖」。
  - ⚠️ **收起态只卸载下树，上树恒挂载**：`FileTree` 自带搜索词 / 折叠态 / 选中行三份内部信号，展开再收起就清掉的话，用户会看见刚选好的东西不见了（同 `sidebar-tabs.tsx`「两个 pane 常挂不卸载」）。有一条用例**比节点本身**（`树(host,"sandbox") === 前`）钉住——注意那处也是比**布尔**（`#005-01`）。
  - ⚠️ **拉回确认走内联条不套 `Dialog`**：同 T009 的删除确认——树是用户眼睛已经在的地方，再叠一层跨模块模态还得让人多解释一步「这是在拉回哪儿」。`role="alert"` 让屏幕阅读器在条冒出来时读一遍（不是模态，不需要焦点管理）。
  - ⚠️ **`#005-01` 在本 task 的落点**：本次所有「某处没有元素」的断言都断在**布尔**上（`不存在 = (el) => el === null`），因为实得值若是**被 Solid 渲染过的节点**，红了会把整轮 `bun test` **挂死**（不是红，是哑）。⚠️ 该测试文件里**既有**的 4 处同形状断言（判 `topbar` / `document-view` 不在的那几处）**不在 T012 范围内、未动**，仍在 005 的 `state.md` 挂账。
  - ⚠️ **happy-dom 没有 `DragEvent`（有 `DataTransfer`）**：拖拽用例一律拿**裸 `Event`** 顶着，产品码对 `dataTransfer` 一律可选链（`event.dataTransfer?.setData`）——那两处 `?.` 不是防御性编程，是**测试进得来**的前提。同理，判「拖的是谁」用组件自己的 `拖源` 信号而不是 `dataTransfer` 的 payload（payload 照放，与上游 `file-tree-v2.tsx` 同为 `file:<path>` 形状，但**没有一条断言依赖它**）。
  - ✅ **变异验证（2026-10-06，串行跑，据实记三类 `#003-03`）**：**14 个变异**。<br>**组件侧 10 个**：**M1** 去掉「跨树」判据（同树也放行）红 **1**；**M2** 落点改成「目录行也取父目录」红 **5**（一处判据被 5 条共同依赖，红的全是「目标为目录」的用例、**对照条不红**）；**M3** 落点改成「文件行取自己」红 **1**；**M4** 下树 `draggable` 去掉「只文件行」⇒ **19 条全绿**（见下）；**M5** 上树 `draggable` 恒 `true` 红 **1**；**M6** 下树 `draggable` 恒 `true` 红 **1**；**M7** `可放` 的方向判据恒 `true` ⇒ **19 条全绿**（见下）；**M8** 拉回不看同名红 **1**；**M9** ✓ 也画在目录行红 **1**；**M10** 收起态仍渲染下树红 **1**。<br>**接线侧 4 个**：**N1** 窄条不 `setDualOpen` 红 **4**（同一个「展开」动作被 4 条共同依赖，含两条「先展开再操作」的后续用例，**对照条不红**）；**N2** 窄条不切回「文件」红 **2**（T019 那条 ＋ T012 那条）；**N3** `onCollapse` 不接红 **1**；**N4** `backups` 不传红 **1**。
  - ⚠️ **M4 / M7 全绿 —— 不是「代码多余」，是「测试少了一条」（`#003-03` 类③ 的前提在这里不成立）**：两个是**同一个形态**——同一件事有**两道判据**，而用例只压了前一道。<br>**M4**：「目录行不可拖」上树那条由 `file-tree.tsx` 守、**下树那条由 `MinioTree` 自己守**，而对照用例压的是上树 ⇒ 削掉下树那处，**19 条全绿**。<br>**M7**：`draggable` 属性是「浏览器不发 `dragstart`」（外部手段），`可放` 里的方向判据是「组件自己挡」（内部手段）⇒ 只测前者的话，削掉后者**一条都不会红**（`#004-09` 的形态：端点判据对「拦在哪儿」不敏感）。<br>⇒ **各补一条用例，且都是在变异体上补的**（先红后绿，成牙证据就是这两次红）。补完 M4→恰红 1、M7→恰红 1。
  - ⚠️ **M2 顺带逼出的第三处同型缺口**：M2 红了 5 条后回头数 `拼路径` 的**分支覆盖面**——它有两个分支（目录行 / 非目录行），而落点用例只压到「目录行」与「空白」，「**文件行**」一条都没有；文件行与空白在 `位.路径` 上**恰好相反**（有父目录 vs 没有），所以「空白那条绿着」**证明不了**「文件行也对」（`#004-01`：判据的出口数要数全）。补了一条（`拖到文件行上 ⇒ 落点仍是它所在目录`），**成牙证据是 M3 的恰红 1**。⚠️ 据实说明：**这条不是 RED-first 写的**（补它时实装已经是对的），拿 M3 的恰红当证据，不冒充「先红后绿」。
  - ⚠️ **一处 RED 阶段就记下的「假绿」**：「展开 → 收起 → 再展开，沙箱树是**同一个节点**」这条在**空壳上也绿**（那时两边都是 `null`，`null === null`）——它当时**恒真**，要等实装落地才成为真判据。记在这里是因为**它绿过**：别把它算作「RED-first」，它没有红过。
  - 🧭 **门禁（T012 收尾，串行，2026-10-06）**：`packages/app` 组件测试 **383 pass / 0 fail / 27 文件**（T010 基线 330 ⇒ ＋53；T011 零前端改动，故这 53 全是 T012 的：组件 20 ＋ 接线 6 ＝ 26 条新用例 × 断言展开）；`bun run test:unit` **824 pass / 0 fail / 117 文件**；`typecheck`（`tsgo -b`）**exit 0**（⚠️ 首跑红 1 条：`MinioTree` 的 `aria-expanded` 我写成 `String(展开(...))`，而 Solid 只收 `"true" | "false" | boolean` ⇒ 改成布尔，与 `file-tree.tsx` 同写法；**这条 `bun test` 不做类型检查、RED/GREEN 一路没暴露**）；`lint:openhive` **exit 0**（23 warnings / 0 errors，**本次三文件 0 命中**——引入的 1 处 `require-array-sort-compare`（`.sort()` 没给 compare）已当场清掉）；`bun run lint` **本次文件 0 命中**（那 1 error 仍是 `#001-02` 记的上游文件，裁定不私改）；`bun.lock` **一行未动**。
  - ⛔ **不在本 task 交付**：`onBackup` / `onRestore` 的**接收方**——MinIO 的 HTTP 出口（谁读 `OPENHIVE_MINIO_*`、`projectId` 从哪来、路由挂在哪）今天**不存在**，归 **T022**。因此**生产里这两个 prop 不传 ⇒ 行不可拖**（「未接线即禁用」，与右键菜单第 9/10 项自 T008 起就禁用是同一件事）。组件这一侧的能力由 `dual-file-tree.test.tsx` 证明，接线缺口记在 T022。
- [ ] T022 [US4] [BE] 实现 MinIO 的 **HTTP 出口**（读 `OPENHIVE_MINIO_*` ＋ `projectId` 透传 ＋ 备份/拉回路由），把 T012 的双树接上线 [FR-007] [T011][T012][D-13] [出参：生产里拖拽真的能备份/拉回]
  - 🔒 **补编号裁定（2026-10-06，T012 开工前用户裁定「只做前端 ＋ 接缝，另补编号」）**：T012 侦察出的**计划缺口**——双树那两个回调**没有接收方**：`packages/core/src/minio.ts`（T011 的产物）**全仓零生产调用方**（`grep makeStore` 只命中它自己与测试），而 `packages/app/src/project/project-location.ts` 又把项目头**剥掉**了 ⇒ 任何 handler 都读不到 `projectId`。按 T017–T021 先例：**编号排最后、不重排既有编号**，归 Phase 6（US4）。
  - ⚠️ **依赖 D-13，开工前先裁**：`minio.md` §4 的五个 `OPENHIVE_MINIO_*` 环境变量**在本条写下时全仓零引用**（T011 已记），因为「凭据怎么读 / 怎么签」**恰恰是 D-13 要裁定的东西**（T011 只收凭据、不签发凭据）。别在这里提前拍板。<br>⚠️ **2026-10-06 补记（T013 收尾时同步）**：**配置读取这一半已经不是缺口了**——T013 落的 `MinioConfig`（`archive.ts` 内）就是 §4 那五个变量的读取点，`server.ts` 的 `Layer.mergeAll` 已把它供上。⇒ 本条的 ① 从「自己读 env」改成「**复用 `MinioConfig`**」，只剩 ② `projectId` 透传 与 ③ 路由/处理器 要做，而 ③ 的蓝本是**同目录的 `archive.ts`**（同族接缝：路由体 `yield*` 取 `MinioConfig` ＋ `AnchorWorkspace.Config`，白名单/授权走 `decide`）。**D-13 剩的仍是凭据路径**（§2 桶策略钉在 `${aws:username}` ⇒ 表达不出「服务端代写各前缀」，S3-01）。
  - ⚠️ **三处都要接上才算完**：① **配置读取**（env → `Minio.Config`）；② **`projectId` 透传**（今天被 `project-location.ts` 剥掉，要与 T003 的租户解析走**同一条身份来源**、别另开一条）；③ **路由 / 处理器**（落点按本仓定制惯例放 `packages/opencode/src/server/openhive/`，同 `access.ts`）。⚠️ `packages/opencode/src/project/` 是**上游目录**，别往那儿放（`#002-04`：位置漂了不会报错）。三处缺一条，双树的行**照样不可拖**。
  - ⚠️ **别忘前端那一侧的回填**：备份 / 拉回成功后要把 `@/project/minio-backups` 那条缝**写进去**——它今天**没有写入方**，缝里恒 `undefined` ⇒ ④ 窄条走「不知道几项」态、下树走「备份清单未接入」空态。缝的写入方与上面三个出口是**同一件事的两面**，别只做一半。
  - 🔒 **开工前必读：本条的备份出口与 `archive.ts` 的 `backupAll` 是同一个前缀的第二个写入方（2026-10-07 Step 5 审查 X3-1 补记）。** `backupAll` 收尾会把**不在这份清单里**的旧对象 delete 掉（收敛，语义＝「此刻沙箱的镜像」），它的判据是**整段前缀**。⇒ 本条的文件级备份出口一旦往 `<userId>/<projectId>/` 这个前缀写对象，两者会**互相删对方的对象**（先跑的那个把后跑的删掉，且不报错）。两种出路，开工前二选一：① 本条改用**独立子前缀**（如 `<userId>/<projectId>/backups/`）并在 `backupAll` 的收敛判据里排除它；② 明确本条与 `backupAll` **不共存**（同前缀只留一个写入方）。**不要**默认它们能各写各的。

## Phase 7: US5 归档 / 找回（P2）

- [x] T013 [US5] [BE] 实现项目归档（上传 MinIO + 删除沙箱 + archived=1）[FR-008] [T003][T011] [出参：归档后项目移入「已归档」]
  - 🔒 **Q1×Q3 缺口裁定（2026-10-06，用户裁定取 (c)）**：owner 归档时，**成员的**沙箱文件怎么办？——原缺口是 owner 读不到成员沙箱（物理隔离），而 FR-008 写的是「沙箱文件**全部**上传 MinIO + 删除沙箱文件」，两句话对不上。用户裁定取 **(c) 服务端替全体成员各跑一遍**：归档时服务端对该项目**每个成员**的沙箱各跑「上传到**该成员自己的** MinIO 前缀 ＋ 删该成员沙箱」。理由：这是唯一同时满足 FR-008 字面（「全部」）与归档目的（释放沙箱空间）的读法；被否的两条——(a) 只动 owner 自己那份（成员文件继续占盘、失权后取不回，与「归档释放空间」相抵）、(b) 成员收到通知后各自上传（需站内信＋状态机，而站内信是本 feature 还没有的组件，且把 T013 拆成多步流程）。
    - ⚠️ **这条裁定带一个必须先对齐的架构前提**：`/minio/{userId}/{projectId}/` 的前缀是**按用户分**的（Q1 裁定：镜像各人自己的沙箱）⇒ (c) 是**每个成员各上传到自己那一份前缀**，不是收进一个共享前缀。务必与 T011 已落的 `makeStore(scope)` 前缀约定对齐（`scope` 定死前缀、调用者给不出自己的前缀——**这条约束正是为 (c) 准备的**，见 T011 条的「收窄接口的用处」）。
    - ⚠️ **同时新增了一条跨用户写路径**：服务端要以**非锚定身份**读写「别人的」沙箱。这是 003 隔离设计的既有假设之外的东西（003 的隔离是**请求作用域**的：一个请求绑定一个 userId、只能碰自己的锚定根）。**动手前先确认这条与 003 的隔离口径不冲突**，冲突则以宪法 III（物理隔离优先）为准；不冲突也要在 state.md 里写清「这是哪一类特权路径、凭什么被授权」。
  - ✅ **出参落地（T013，2026-10-06）**：新建 `packages/opencode/src/server/openhive/archive.ts`（`OpenhiveArchive.routes`：一个 `POST /openhive/project/archive`，体收 `{projectId}`）＋ `packages/opencode/test/server/openhive-project-archive.test.ts`（**15 条**）与 `…-unconfigured.test.ts`（**2 条**，**必须分文件**，理由见下）；给 `packages/auth/src/project-member.ts` 加 `markArchived`（`archived = true` ＋ `archived_at` 的 **upsert**——找回后再归档会撞已存在的 `project_id` 主键，主键冲突在这里是**正常流程**不是异常；`archived_at` 与 `archived = true` 由**同一个写入点**决定，迁移的 `project_archive_coherence_check` 钉着这一对）；观测面 `packages/core/src/test-support/fake-s3.ts`（**从 `test/fixture/` 迁入 `src/`**——`packages/opencode` 要 import 它，而 core 的 `exports` 是 `"./*": "./src/*.ts"`，放 `test/` 下别的包**够不着**）；接线 `packages/opencode/src/server/routes/instance/httpapi/server.ts` 的 `Layer.mergeAll` 加一项（沙箱根**复用** `AnchorWorkspace.Config`、与项目出口同一个——漂了就是「建到 A、归档时去 B 找」；`MinioConfig` 是本层自己的配置服务、同样必须在这里供上）。
  - ⚠️ **「服务端批处理特权路径」与 003 隔离口径的关系（上面那句要求的对齐）**：**不冲突**。003 的隔离是**请求作用域**的——一个请求绑定一个 userId、只能碰自己的锚定根；而本模块的**作用对象来自服务端的 `project_member` 表**，请求入参里**只有 `projectId`**（没有 userId 那个位置）。它与 003 自己的 `archiveSandbox(root, userId)`（账户级沙箱归档）**同类**：领域函数显式收 `(root, userId)`、内部不做身份校验，授权建立在**调用点**——这里的调用点凭据 ＝ 该项目 `project_member` 表里的 **owner 行**（`ProjectMembership.decide({action:"archive"})`）。换言之：拿到 owner 行且只拿到 owner 行，才能让服务端替全体成员跑一遍；成员拿不到别人的锚定根。这段已逐字写进 `archive.ts` 文件头。
  - ⚠️ **次序是要求不是巧合：「全员传完，才开删」；标记最后落**：`backupAll`（只读沙箱 ＋ 只写 MinIO）**整个跑完**才轮到 `releaseAll`（只删），两者之间隔一次 `await` 且刻意是**两个函数**——合成一个循环就又是「传一个删一个」，那时第二个成员上传失败会让第一个成员的沙箱**已经没了**、而项目**没**被标成已归档。判据落在「第二个成员上传失败 ⇒ 第一个成员的沙箱也还在」那条（靠假 S3 的 `failOn` 按对象键造出「甲全成、乙起全败」）。
  - ⚠️ **假 S3 的失败态从「按请求个数」改成「按对象键」（M2 变异逼出来的）**：初版 `failAfter(count)` 有两个不报错的坑——① 计数用**服务端累计的** `requests.length`，而夹具是**文件级共享**的（同文件跑完前若干条用例后水位早已上千）⇒ `failAfter(1, …)` 的实际含义是「**从这个请求起全失败**」，与「第一次外呼就失败」成了同一件事；② 「一个成员要传几个对象」不是测试该去数的数（沙箱项目目录必然含 `.git`，本机实测 19 个文件，会随平台/版本漂）。改成 `failOn(status, when)` 按**键**判定后，用例说的是本意「**乙的第一个对象**起失败」，而乙的键在甲的全部键之后（`backupAll` 按成员逐个传完）⇒「前一半成功、后一半失败」**由构造保证**。旧夹具下 M2（「全员传完再删」改成「传一个删一个」）**全绿**；换上后 M2 **恰红**那条。
  - ⚠️ **`filesUnder` 的跳过口径分两层，一层都不能少**：目录不存在 / 空目录 / 符号链接**刻意跳过、不报错**。**第二层**（S2-01 抓到的）是**根那一步**：`existsSync` / `statSync` 是**跟随**链接的，`lstatSync` 才是「看这个条目本身」。只把 walk 里的条目判成符号链接、根那一步仍在跟随 ⇒ 成员把 `{userId}/{projectId}` 换成指向别处的链接，归档就把**别人的目录**读进自己的前缀，而 `rm` 删的只是那个链接（**泄漏不是破坏**，所以更隐蔽）。改用 `lstatSync` 后由「项目目录本身是符号链接」那条钉住（win32 用 `junction` 造，不需要管理员；`rm(link, {recursive:true, force:true})` **只删链接不删目标**，本条另有一条独立断言）。
  - ⚠️ **「未挂载」不是 404，判「出口在不在」必须断 `Content-Type`**：本应用未匹配的路径落 SPA 兜底、回 **200 ＋ `text/html`**。所有读 JSON 体的地方都在 `json()` 里**先断 `content-type` 含 `application/json`** 再解体——否则「路由没挂上」会以「200 且解析失败」的形态出现，看着像体坏了。
  - ⚠️ **MinIO 没配时的「次序」是一条独立判据（`#004-09`）**：`① 身份 → ② 归档态 → ③ 授权判定（`decide`，纯函数在 core） → ④ 配置检查（`Option.isNone(deps.minio)` ⇒ 503） → ⑤ 成员 id 逐条校验 → ⑥ 全员上传 → ⑦ 全员删 → ⑧ 标记`。③ 排在 ④ **之前**：未授权的人不该从「503 还是 403」读出这台机器的部署状态。**端点断言对顺序不敏感**——把 ③④ 调个头，「配好了」那一整个文件**全绿**（那里人人都是 owner 或干脆没这回事）；钉它的是 `-unconfigured.test.ts` 的「非成员 ⇒ 403（**不是** 503）」，观测面要**未配置 ＋ 非成员**两个条件缺一不可（2026-10-06 三席评审 S1-02 补；**M3** 调换 ③④ **恰红** 1 条）。`Config.option(Config.all({…}))` 的粒度取**整组**：endpoint 有、密钥没有 ＝ **配了一半**，当「配好了」只会在第一次外呼时炸在 SDK 里、报一个与配置无关的错（实测语义：全缺 → `None`、缺一个 → `None`、全给 → `Some`）。
  - ⛔ **未查到底的一件事，已挂 `005/state.md` 缺口表**：**一个进程里建第二个 app，它的第一条 PG 查询会被 `PostgresError: Connection closed` 打回一次（耗时 3–11ms，不是 3 秒连接超时），同一 app 的下一条请求即自愈**。四条实测把范围缩到「除进程第一条请求外，任何新 app 的首查撞一次」——与 MinIO 配没配无关、与「第几个 app」无关（先用第二个 app，则是**第一个** app 首查撞）；裸连接池连开三条各自首查**全通**（⇒ 与连接数 / `PG_*` / DB 层无关）。读 `server.ts` 后**证伪了**原先「生产不存在这个场景」的说法：`handler(request, HttpApiApp.context)` 与 `Effect.provide(HttpApiApp.context)` 共用**同一份模块级** `Context.makeUnsafe(new Map())`，而 `createRoutes()` 每个 listener 调一次 ⇒ **可能生产可达**。**机制未查明**。这也是两个归档测试文件**必须分开**（各自只建一个 app）的原因——处置走 `#004-12`（同族接缝测试的手段整段搬、按需分文件）。
  - ✅ **变异验证（2026-10-06，串行跑，5 个变异全部①类「恰红目标」，无②③类 `#003-03`）**：**M1** `filesUnder` 的 `lstatSync` 换回 `statSync` ⇒ 红 **1**（符号链接用例的「别人的东西没被搬走」）；**M2** 删掉 `isSafePathSegment(projectId)` 那道门 ⇒ 红 **1**（逃逸用例的**副作用**断言——哨兵文件真的没了，`join(root, userId, ".")` ＝ 整个沙箱），**不是**状态码那条；**M3** 调换 ③ 授权与 ④ 配置 ⇒ 红 **1**（「非成员 ⇒ 403」变 503）；**M4** `releaseAll` 改成删整个成员沙箱 ⇒ 红 **1**（「隔壁专案的无关.txt 存活」，S3-06 补的观测面）；**M5** `endpointOf` 去掉协议判断 ⇒ 红 **1**（拼出 `http://https://…`）。每条改完即还原、复跑回绿。
  - ⚠️ **一条我自己的不实记述（三席评审 S1-01/S2-02 抓到，已整段重写）**：逃逸用例原来自称「400 ＋ 零副作用」，而三条副作用断言**恒真**（没真的走到副作用那一步）。重写的关键是**取值必须选「守卫若缺席、副作用真会发生」的那个**：`projectId` 取 `"."`——它**过** `Minio` 的段检查（`"."` 不是 `..`、不以 `/` 开头、不是盘符、不含 `\`）但**过不了** `User.isSafePathSegment`，而 `join(root, userId, ".")` ＝ **整个沙箱**。另需**注入一行 `project_id = "."` 的 owner 行**让逃逸路径真的走得通（否则 `membersOf` 空集 ⇒ 403 ⇒ 断言又恒真）。这条正对应 `#004-13`：**「没有现成观测面」≠「没有观测面」**。
  - ⚠️ **据实记两类之外的两笔**：① `endpointOf` 那条纯函数用例**不是 RED-first**（补它时实装已经是对的），成牙证据取 **M5 的恰红**，不冒充「先红后绿」；② 重入那条（归档一个已归档的项目 ⇒ 403）**只能抓跨秒的重入**——`nowSeconds()` 是秒粒度，同一秒内 `archived_at` 不比上一次更早 ⇒ 断言次序必须是「先比归档行相等、后比状态码」（`#004-14`：`expect` 一失败即中止用例体，**书写顺序决定拿到哪条证据**）。
  - 🧭 **门禁（T013 收尾，串行，2026-10-06）**：`packages/opencode` 归档两文件 **15 pass / 0 fail（102 expect）** ＋ **2 pass / 0 fail（14 expect）**；同族 project / directory / member-closed-set / bootstrap 四文件 **23 pass / 0 fail（102 expect）**；`packages/core` `bun test` ⇒ **1211 pass / 8 skip / 5 fail / 3278 expect / 1224 tests / 159 files**（5 条失败**按名比对**全是 `NpmConfig.*`——本机 `~/.npmrc` 镜像所致，**无新增**，`#003-01`）；`packages/auth` `bun test` ⇒ **238 pass / 1 skip / 0 fail**；`packages/app` `bun run test:components` ⇒ **405 pass / 0 fail / 27 文件**（本题零前端改动，跑它是为了确认 T018/T019 的既有绿没被带坏）；`bun run typecheck`（turbo）**31/31 successful，exit 0**；**文件级** oxlint（仓库根，`#004-10`）⇒ **0 warnings / 0 errors / 5 files / 130 rules / exit 0**；`bun run lint:openhive` ⇒ **exit 0**（**23 warnings / 0 errors / 161 rules** ＝ 基线，**本次文件 0 命中**）；`bun.lock` **一行未动**。
  - ⛔ **不在本 task 交付（均已落 `005/state.md` 缺口表，`#004-03`）**：① **FE 归档入口**（项目/列表里的「归档」按钮、已归档分组的呈现）——**补编号 T023**（见 Phase 7）；② **FR-008 的「超期 3 个月自动提醒」**——22 条任务里**一条都没认领**（S3-04 指出），补一条认领（见 Phase 7）；③ **共享项目 bare 仓库 `/shared/{projectId}.git` 归档后既不上传也不删除**（第 3 席的附加观察）——移交 **T014**；④ 已修但**空目录不备份**（`filesUnder` 跳过口径的代价，可接受、如实记）；⑤ `.git` 一并上传（本机实测 19 个文件，含 `.git/opencode`）；⑥ 每成员各建一个 `S3Client` 而 `Minio.Interface` **没有 close**（S2-06）；⑦ `assertSafeSegment` 的 `DRIVE` 判据会在 POSIX 上误伤 `C:xxx` 这类**文件名**以致整个归档 500（S3-07）；⑧ `fake-s3.ts` 的「生产代码不得 import」是**没有门守着的约定**（S1-06，要变成有门的约束得加 lint 的 `no-restricted-imports`，**本轮没做**）。
- [x] T014 [US5] [BE] 实现项目找回（archived=0 + MinIO 下载回沙箱）[FR-009] [T013] [出参：找回后项目回到「最近/全部」]
  - 🔒 **两笔未定项开工前裁定（2026-10-06，用户裁定，均取推荐项）**：
    **(1) 共享 bare 仓库 `/shared/{projectId}.git`（T013 缺口表第 3 条移交的那笔）⇒ 归档/找回都不动它。**
    理由：它是**项目级**的 git 载体、在 `/shared` 共享卷上，而 MinIO 那些键镜像的是**各人沙箱**（`minio.md` §1）——
    一个项目级的对象塞不进「按 `{userId}` 分区」的键空间。代价如实记账（**`/shared` 的占用不随归档释放**）⇒
    落 `005/state.md` 缺口表 ＋ `docs/workspace/deploy-todo.md` 的 **D-14 第 ④ 项** ＋ `minio.md` §1 的一段。
    ⇒ **T014 的实现量：零**——那笔账就此**关掉**，不是又挪一处（`#002-04`）。
    **(2) 找回时 `archived = false` 什么时候落 ⇒ 标记最后落**：下载**全部**成功之后才落。这把 `design` §8.3 的
    「②改状态 ③下载」调成与 T013 归档同一条次序。理由：中途失败 ⇒ 项目**仍是「已归档」**、可重试，界面不会
    谎称已找回；`design` 的原顺序反过来则这次**没有「标记」可以回退**。
  - ✅ **出参落地（2026-10-06）**：**同一个文件**（`packages/opencode/src/server/openhive/archive.ts`）加**第二个出口**
    ——`PATH.restore` ＝ `POST /openhive/project/restore`，体收同一个 `{projectId}`（`ArchiveBody` 改名 `ProjectIdBody`，
    **两个出口共用一份契约**，不各写一份）；`packages/auth/src/project-member.ts` 加 `markRestored`；新测试文件
    `packages/opencode/test/server/openhive-project-restore.test.ts`（**11 条**／664 行）；`…-unconfigured.test.ts`
    加**第 3 条**（找回的次序，见下）。⚠️ **接线只加一行**（`routes` 里 `router.add("POST", PATH.restore, …)`），
    **`server.ts` 一行未动**——沙箱根（`AnchorWorkspace.Config`）与 `MinioConfig` 那个层 T013 已供上。
  - ⚠️ **为什么是同一个文件、不是新起 `restore.ts`**：两个方向共用得太多——`MinioConfig` / `endpointOf` /
    `MinioSettings` / `asRole` / `Deps`（惰性 pg 池）/ 三个响应构造 / 路径段守卫。各写一份就是 `#002-06` 那句话本身；
    而把 `archive.ts` 的私有件导出去给新文件用，是把 API 外扩一次。`plan.md` 第 60 行本来就写
    `archive.ts # 项目归档/找回`。文件头新增一整节「找回（T014 / FR-009）——本文件的另一半，三条约定」。
  - ⚠️ **找回是同一条 (c) 裁定的镜像，不是自由选择**：owner 触发、服务端按 `project_member` 对**每个成员**各跑一遍
    「把**他自己前缀**的文件下载回**他自己沙箱**」。成员**已失权**（FR-010）自己触发不了；只还原 owner 那一份，
    成员的文件就永远留在 MinIO 里——直接违背 FR-009 的「MinIO 文件**全部**下载回沙箱」。
  - ⚠️ **次序（八步，与归档逐条同形，只有 ⑥⑦ 反向）**：`① 身份 → ② 归档态 → ③ 授权判定（`decide`，纯函数在 core）
    → ④ 配置检查（`Option.isNone(deps.minio)` ⇒ 503） → ⑤ 成员 id 逐条校验 → ⑥ 全员下载（`restoreAll`，只读 MinIO ＋
    只写沙箱） → ⑦ **到这里才**翻标记（`markRestored`）`。③ 仍在 ④ **之前**（同归档：未授权的人不该从
    「503 还是 403」读出部署状态）；⑦ 最后落 = 下载中途失败时项目**仍是「已归档」**、重试即可。
  - ⚠️ **`restoreAll` 三处刻意的选择**：① **清单空 ⇒ 跳过、不建目录**（与 `filesUnder` / `releaseAll` 同一个跳过口径：
    成员从没 clone 过时凭空给他建一个空项目目录，等于让他的文件树显示一个**他从没有过的项目**）；
    ② **`mkdir` 逐级递归**（键里的相对路径带目录，只写一层在 win32 与 POSIX 上都会 `ENOENT`；`.git/**` 一并回来
    也是这条）；③ **`store.get` 回 `undefined` ⇒ 抛出，不静默跳过**（`list` 刚说这个键在；跳过会让「找回完成」与
    「沙箱里少一个文件」同时成立、而调用方只看得见前者）。⚠️ 写入方向的**符号链接守卫**没有对应物（归档那侧的
    `lstatSync` 是**读**方向的），如实记在缺口表，不假装覆盖。
  - ⚠️ **`markRestored` 是 `update` 而不是 upsert**（对照 `markArchived` 的 upsert）：走得到这里 ＝ 上一句刚从这个表里
    读出 `archived = true` ⇒ **那一行必然在**。写成 upsert 就等于允许「本来没有也行」，把「该翻的那一行找不着」
    也静默算成成功。⚠️ **残差如实记**：`update` 命中 0 行**同样成功返回**，调用方分辨不出——那条路今天**不可达**
    （没有任何代码删 `project_archive` 的行）；真要防得去数 `rowsOf(update)` 的行数，而那条形状在两种驱动下是否
    一致**没验过**（`#002-01`）⇒ **不写没验过的判据**。`archived = false` 与 `archived_at = null` **必须成对写**
    （迁移的 `project_archive_coherence_check` 钉着这一对；**M5 变异证明它是真的拦得住**，见下）。
  - ✅ **变异验证（2026-10-06，串行跑，据实记三类 `#003-03`）**：**5 个变异**。
    **M1** 把 `markRestored` 提到 `restoreAll` **之前** ⇒ **恰红 1**（「下载失败 ⇒ 项目仍是「已归档」」，8 pass / 1 fail）；
    **M2** 删掉找回里的 `isSafePathSegment(projectId)` 门 ⇒ **恰红 1**（逃逸用例 `projectId = "."`，8 pass / 1 fail）；
    **M3** `restoreAll` 里所有成员**共用一个 store**（`targets[0]` 的 scope）⇒ **红 2**（「谁的东西进谁的沙箱」这条
    不变量的两个投影：主用例 ＋「没 clone 过的成员不被建空目录」；**无对照被误伤** ⇒ 属②类「整组红」，不是①类恰红）；
    **M4** 把找回的 ③ 授权与 ④ 配置**调换** ⇒ **恰红 1**（`-unconfigured.test.ts` 的第 3 条，403 变 503；
    **restore 那 8 条全绿** ⇒ 这条次序**确实只有它在钉**）；**M5** `markRestored` 的成对写拆开（只 `set archived = false`）
    ⇒ **红 4**（所有「成功找回」的用例，同一根因：库的 `project_archive_coherence_check` 真的拒了 ⇒ 500 ⇒
    `json()` 先断 `content-type` 就红；未授权/失败那 3 条仍绿 ⇒ 属②类）。每条改完即还原、复跑回绿。
  - 🔍 **审查（2026-10-06，子代理，覆盖 runbook 六类）0 条「必须修」**，报 F1–F7：
    **F1（找回缺「无凭证 ⇒ 401」与「畸形体 ⇒ 400」两条，归档侧两条都有）已办，但据实改写了结论**。
    补完两条后**按 TDD 取成牙证据**，发现两者性质不同：**畸形体那条有牙**（**M7**：删掉
    `handleRestore` 的 `badRequest("请求体要带 projectId")` ⇒ **恰红 1**，400 → 500，其余 10 条全绿）；
    **401 那条没有牙，而且是结构性的**（**M6**：把 `handleRestore` 的
    `if (Option.isNone(user)) return unauthorized()` **整行删掉** ⇒ **11 条全绿**；**M8**：把 `handleArchive`
    的同一行删掉 ⇒ 归档两文件 **18 条全绿**）。根因：`user-identity.ts` **中间件**在进 handler **之前**就把
    无身份请求回成 401，而 `OpenhiveArchive.routes` 全仓**只有一个挂载点**（`httpapi/server.ts`，且在那条链里）
    ⇒ handler 那行**不可达**。**401 用例保留**（它如实断言了出口级的性质、将来中间件豁免表一变它就是第一道网），
    但**不写成「产品码被钉住了」**；**handler 那行没删**——它与 `handleArchive` 逐条同形是整条链的骨架，
    单删一侧会让两个 handler 悄悄分叉（**这是明写的判断，不是「忘了」**）。**这条同时更正了 T013 收尾时的
    理解**：那条「不带凭证 ⇒ 401」用例当时被读成「钉住了 handler 的守卫」，实测**不成立**。
    **F2（4 处 `expect(…?..archived_at).not.toBeNull()` 是弱形式：行整个不见了时实得值 `undefined`、
    断言照样通过）已修** —— 抽 `仍是已归档(id)` 助手，**先断 `行` 在、再断 `archived_at`**，与
    `-unconfigured.test.ts` 那条 ③ **同口径**（`#002-06`）。**F3–F7 挂缺口**（F3/F4 原已记；
    **F5** `restoreAll` 的 `get === undefined ⇒ throw` 分支本地**测不到**（`fake-s3` 的 `list`/`get`
    读同一份 map、`failOn` 只回 `InternalError`）；**F6** 空目录不还原 ⇒ 往返**不是逐字节「完整还原」**；
    **F7** 「八步同形」**只靠复制粘贴维持**、单侧漏改不会有测试变红 ⇒ 新增缺口第 7/8/9 条）。
    审查**逐项核实成立**的关键项：同形①②③④⑤ 对着**被调方**逐条打勾（`#004-07`）、`server.ts` 一行不动
    属实、`markRestored` 的「命中 0 行不可达」为真、主判据**非空**（逐键全等能拦住「把 owner 的备份铺给
    所有成员」）、测试 oracle 不经过被测对象、找回**只有一条出口**。
  - ⚠️ **一条工具怪癖复现（T018 记过，本次又撞上）**：`packages/app` 的 `test:components` 在**启用默认运行时转译缓存**时
    本次实测 **257 pass / 3 fail / 3 error**（`Expected JSX element name but found "?" at
    packages/ui/src/components/file-icons/sprite.svg:1:2` 级联出空白的 `# Unhandled error between tests`），
    而 `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` **405 pass / 0 fail / 27 文件** ＝ 基线。**先怀疑测量**（`#003-01`）：
    本题**零前端改动**，那 3 红与代码无关。
  - 🧭 **门禁（T014 收尾，串行，2026-10-06）**：`packages/opencode` 找回 **11 pass / 0 fail（106 expect）** ＋
    归档两文件 **18 pass / 0 fail（124 expect）**（T013 是 15 ＋ 2 ＝ 17，本题 ＋1 条 = 18）；
    `packages/auth` `src/project-member.test.ts` **14 pass / 0 fail**；`packages/core` `bun test` ⇒
    **1211 pass / 8 skip / 5 fail** ＝ 基线（5 条全是 `NpmConfig.*`，**无新增**，`#003-01`）；
    `packages/app` `bun run test:components` ⇒ **405 pass / 0 fail / 27 文件**（⚠️ 须带
    `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`，见上）；`bun run typecheck`（turbo）⇒ **31/31 successful，exit 0**；
    **文件级** oxlint（仓库根，`#004-10`，四个文件）⇒ **0 warnings / 0 errors / 130 rules / exit 0**
    （⚠️ 首跑 1 warning：新测试里 `test` import 未使用 ⇒ **当场清掉、不留账**，同 T018 的处置）；
    `bun run lint:openhive` ⇒ **exit 0**（**23 warnings / 0 errors / 161 rules** ＝ 基线，本次文件 0 命中）；
    `bun run lint` ⇒ **本次 4 个改动文件 0 命中**（全局 4953 warnings / 1 error / 3513 files，那 1 error 仍是
    `#001-02` 记的上游文件，裁定不私改）；`git diff --stat bun.lock` **为空**。
  - ⛔ **不在本 task 交付**：① **MinIO 下载没有重试 / 超时 / 熔断**（与上传同款，全项目一致 ⇒ 挂缺口表，不写成覆盖）；
    ② **找回的写入方向没有符号链接守卫**（对照 `filesUnder` 的 `lstatSync`）；③ **`restoreAll` 的重入/部分成功语义**
    （标记没落时重试 = 重下一遍）未测；④ FE 的**找回入口**归 **T023**（与「归档入口」同一条）；⑤ T015（归档后失权
    的正向出口）仍待做——本题只证明 `decide` 在找回这条链上把 member/非成员都拦住了。
    ⑥ **`restoreAll` 的 `get === undefined ⇒ throw` 分支本地测不到**（审查 F5：`fake-s3` 的 `list`/`get` 读
    同一份 `objects` map ⇒ 造不出「list 见到、get 见不到」；`failOn` 只回 `InternalError`、不是 `NoSuchKey`）
    ——语义方向对（fail-closed），但**是未验证的分支、不是「已覆盖的刻意选择」**（`#002-02`）；
    ⑦ **空目录不还原 ⇒ 往返不是逐字节「完整还原」**（审查 F6：归档侧 `filesUnder` 只收 `isFile()`）——
    T013 已记过，但 T014 的 `restoreAll` 注释**没重申**，读 FR-009 容易误以为已闭合；
    ⑧ **「八步与归档逐条同形」只靠复制粘贴维持**（审查 F7：守卫序列是两份拷贝，只有 ③④ 的**先后**
    被 `-unconfigured` 第 3 条钉住 ⇒ **单侧漏改**（漏成员 id 循环、漏 `userId` 的 `die`）**不会有测试变红**）
    —— 正是本文件头引的 `#002-06`，也是 `#004-02` 说的「两个投影必须有一条**故意会红**的相等断言」，**今天没有那条**；
    ⑨ **handler 里的 401 守卫是「纵深防御」、不是被测行为**（审查 F1 ＋ 实测 M6/M8：`handleRestore` 与
    `handleArchive` 的那行**整行删掉两边测试全绿**，因为 401 由 `user-identity.ts` **中间件**在进 handler
    之前给出，而 `OpenhiveArchive.routes` 全仓**只有一个挂载点**）—— 照 `#003-03` ③类本应删码，**没删的理由明写在上**。
- [x] T015 [US5] [BE] 实现归档后成员失权、owner 保留找回权 [FR-010] [T004][T013] [出参：归档后 member 失权]
  - 🔒 **开工前三笔裁定（2026-10-06，用户，均取推荐项）**：
    **(1) 冻结射程 ⇒ 延伸：已归档一律拒（含 owner）**——把「归档 = 冻结」这条收紧口径延伸到「在项目里干活」
    （建会话 / 读写文件）这个出口。与 T004 的裁定同一条：归档后除 owner 的「找回」外任何动作都不成立。
    理由：沙箱文件已上传 MinIO 并删除 ⇒ 放行只会把**空目录**重建出来，把「归档」变成半个撤销。
    ⚠️ **风险如实记**：将来 T022 的 MinIO 浏览若也带这个头，会被这道门挡住（今天它前置不齐，且可改成
    不带头的另一种定位方式）。
    **(2) 门的位置 ⇒ `middleware/project-location.ts` + 403 JSON**：该头服务端**唯一**的消费者，一次覆盖
    会话 / 文件 / pty / 上传全部出口（`#004-01` 的锚法：锚在「做那件事的那一行」）；403 ＋ JSON 与归档 /
    找回同一口径（`{ error }`，前端读得懂）。该文件本来就是 **fork 文件**（T017 产物），是「加」不是「改」。
    **(3) 判据落点 ⇒ 查一次 `project_archive`，判据与 `decide` 同文件**：用现成的 `archiveStatesOf`（单元素）
    ⇒「归档 = 冻结」仍然只有**一处定义**（core 的 `membership.ts`，紧挨 `decide`）。代价：每个带头的请求
    多**一次** PG 往返。**否掉的两条**：加进 `PROJECT_ACTIONS` 走 `decide`（中间件还得再查一次 `project_member`
    拿角色 ⇒ 每请求两次往返，而「角色」今天没有真实消费者 ⇒ 猜形状，`#004-07`）；在中间件里直接
    `if (archived) 403`（「归档 = 冻结」就变成两处各写一份，`#002-06`）。
  - 🔒 **开工后补第四笔：D1 处置 ⇒ 本 feature 内补第二道门**（2026-10-06，用户裁定）：建会话时带了头、
    之后用这个会话**不必再带** —— 会话作用域那条链的实例目录取自**会话行**（上游
    `middleware/workspace-routing.ts` 的 `session?.directory || defaultDirectory(...)`）⇒ 归档后它照样在
    那个（已被 T013 删掉的）目录里跑。补法：从 `MatchedRoute.current` 的 `params["sessionID"]` 取会话
    （**不拿 URL 原文比对**——`R-01`/`R-02` 证明 `/session/ses_x/message/`、`%61`、`;x` 都匹配同一条路由），
    读会话目录、**恰好**是 `join(沙箱根, 本人 id, projectId)` 且该项目已归档 ⇒ 403。**连带语义：归档项目的
    会话整体冻住**（连 `GET /session/:id` 也 403，不只「在它里面跑提示词」）。
    ⚠️ `Session.Service` 因此进了中间件的 `requires`——这是本次**唯一**的上游侵入面（本层是 fork 文件，
    `workspace-routing.ts` 一字未动）。
  - ✅ **交付（2026-10-06，三个提交）**：① core 加 `ProjectMembership.frozen(archived)`（与 `decide` 同文件，
    是它的**读法出口**而非第二份实现）；② `project-location.ts` 两道门（带头 ⇒ 查 `project_archive` ⇒ 403；
    会话作用域请求 ⇒ 按**会话行**再问一次，**与带不带头无关**）；③ 新测试文件
    `packages/opencode/test/server/openhive-project-frozen.test.ts`（**8 条**：①②③ 建会话两条链 ＋ 文件树
    的「零副作用 ＋ 403」、④ 默认值回归（无归档行 ⇒ 不冻）、⑤ 管理类链带头被门拦下（403 vs 不带头 503 的对照）、
    ⑥⑦ 第二道门（会话行）、⑧ 诱饵头）；④ `packages/core/test/project-membership.test.ts` 加 T015 组；
    ⑤ 业务 PG 客户端收口成一个共享池（**单独一个提交**，见下的 ⚠️）。
  - ⚠️ **池子收口是「顺带」但按「定制单独提交」办（`2862dcaed6`）**：建 / 列项目（T018）与归档 / 找回（T013）
    原先各持一个惰性池、形状一样各写一份，而门要读同一张 `auth.project_archive`。PGlite 夹具的预编译语句是
    **实例级**的（socket 服务端把多条连接汇进同一个 PG 会话）⇒ 两个客户端跑同一句 SQL 文本撞
    **`42P05 duplicate_prepared_statement`**，症状是 500 且与用例判据无关、谁先跑谁赢。收成
    `@/server/openhive/pg` 的 `OpenhivePg.layer`：**一个应用层一个池**。⚠️ 刻意**不是**模块级单例——
    模块级在「多文件一起跑」时**必红**（第二个文件会用上第一个文件那个已在 `afterAll` 里停掉的库，
    **实测 10 fail**）；层记忆化既保证共享、又让每个测试文件拿回自己那个库。动因是**夹具失真**
    （让被测的形状回到生产形状：一个进程一个池服务所有请求），不是性能。
  - ⚠️ **判据只有一处默认值**：两道门共用 `isArchived()`，其中 `states.get(id)?.archived ?? false`
    （**缺归档行 ⇒ 未归档**）是唯一一份——与 T018 列表那条「没有归档行 ⇒ 省略 `archived` 键 ⇒ 前端读作活跃」
    是同一条口径（两处漂了就是「列表说活跃、进门被拒」）。
  - ⚠️ **次序是裁定的，不是随手排的**：第一道门的归档检查排在 R5（`project === undefined` 直通）**之后**
    ——便宜的 SQLite 读先排除外人 / 幽灵项目，再付 PG 往返；PG 挂掉时未知项目的请求仍走 R5 而不 500。
    **代价如实记**（见下缺口表）：头指向一个**已归档**项目、而请求方在该项目**没有** `project_ext` 行时，
    走 R5 ⇒ **200 落沙箱根**（不是 403）；不构成对项目目录的访问，但与「已归档 ⇒ 一律 403」的字面不一致。
  - ⚠️ **「门排在 handler 之前」在管理类链上测不出来**（`#004-09`）：那条链没有副作用可当观测面，
    端到端断言分不出门的先后（门若排在 handler 之后，带头这一枪同样是 403——handler 先跑回它自己的 403/503）。
    建会话那条链上是**测过**的（用例 ①②③ 断的是**落盘目录**，门在 handler 之后就不会是那个目录）。
  - ⚠️ **T023 接线告诫**：归档 / 找回那两条管理链**也在本层的下游**（全局中间件挂在合并路由之上）——
    **谁给「找回」的调用带上项目头，已归档的项目就再也找回不了**（找回正需要「已归档」这个前提）。
    今天不会发生（前端那两条薄客户端都不发这个头，`grep` 全仓只有 `openhive-files.ts` 发）。
  - ✅ **变异验证（2026-10-06，串行，按 `#003-03` 三类据实记）**：**M11**（删掉第一道门的归档检查整行）
    ⇒ **整组红 4 条**（①②③⑤ 红、④⑥⑦⑧ 绿；②类：不精确，但方向对——「门在不在」有牙）；
    **M5**（拆掉第二道门）⇒ **恰红 1**；**M6**（会话目录推导恒 `undefined`）⇒ **恰红 1**；
    **M7**（`isArchived` 的 `?? false` → `?? true`，当时 7 条用例）⇒ **恰红 2**（用例 ④ 与 ⑦——共享同一个
    默认值的两个出口各红一条；⚠️ 这是**加用例 ⑧ 之前**的快照）；**M8**（`params["sessionID"]` →
    `["sessionId"]`）⇒ **恰红 1**（参数名被钉住）；**M9**（去掉「第一段必须等于本人 id」那道防线）
    ⇒ **全绿 7/0**（③类：测不到 ⇒ **记成缺口**，不记成已覆盖，理由写在该函数的 JSDoc 里）；
    **M10**（把第二道门挂回 `if (projectId === undefined)` 里 = 恢复 F1 的 bug）⇒ **恰红 1**（用例 ⑧），
    且**两式诱饵分别见证过**（把诱饵① 临时换成会话所属的已归档项目头 ⇒ 执行推进到诱饵②、红在它那里）。
    每条改完即还原、复跑回绿。
  - 🔍 **审查与修复**：**第一轮三席**——纠正了三处**不实记述**（①「403 vs 503 的差 = 门排在 handler 之前」
    是**假的**，那个差只证明「门在不在」；② `project-location.ts` 里「owner 行与 `project_ext` 行同生共死」
    按字面是假的；③ `membership.ts` 表里写的接线文件 `project/member.ts` **不存在**，实为 `archive.ts`）。
    **第二轮两席（`#003-02`：把「修复本身」再当靶子，换视角）**——对抗证伪席实测出 **F1（Critical）**：
    第一版把第二道门挂在 `if (projectId === undefined)` 里 ⇒ **「请求有没有说自己属于哪个项目」被当成了
    「要不要问会话行」的开关**：带**任意**一个不是「已归档项目」的头（一个查不到的 id ⇒ 第一道门 R5 直通；
    **本人名下的活跃项目** ⇒ 第一道门按它放行并改写目录），归档项目里的旧会话就照常干活。
    实测：同一归档项目、同一条会话、同一个应用，**只差一个诱饵头**，403 → 200。
    修复 = 提交 `8976cc5b5f`（那段从 `if` 里提出来、**无条件先问会话行**）＋ 用例 ⑧（两式诱饵）＋ 文件头
    两处改准（「没有项目头 ⇒ **不改写**请求」，不再是「一次都不碰 / 连库都不查」）＋「已知不覆盖」补四条。
    横切 / 上游侵入面席的结论见 `state.md` 的 T015 节（本轮收尾时并入）。
  - 🧭 **门禁（T015 收尾 + F1 修复后，串行，2026-10-06）**：`packages/opencode` 受影响 **7 文件
    56 pass / 0 fail（348 expect）**（T015 前基线 55 / 342，本题 ＋1 用例）；新文件
    `openhive-project-frozen.test.ts` **8 pass / 0 fail（27 expect）**；`packages/core`
    `test/project-membership.test.ts` **17 pass / 0 fail**；`bun run typecheck`（turbo）**31/31 successful，
    exit 0**；**文件级** oxlint（仓库根，`#004-10`）**0 warnings / 0 errors / 130 rules / exit 0**；
    `bun run lint:openhive` ⇒ **exit 0**（**23 warnings / 0 errors / 161 rules** ＝ 基线，本次文件 0 命中）；
    `bun run lint` ⇒ **本次改动文件 0 命中**；`packages/app` `bun run test:components` ⇒
    **405 pass / 0 fail / 27 文件**＝基线；`git diff --stat bun.lock` **为空**。
  - ⛔ **缺口 / 挂账（`#002-02`：没覆盖的写成缺口，不写成已覆盖）**：① **M9 那条防线测不到**（造不出那样一条
    会话行 ⇒ 属 `#003-03` ③类，留着并如实标注，理由在 `projectIdOfSessionDirectory` 的 JSDoc 里）；
    ② **管理类链上「门排在 handler 之前」测不出来**（无观测面，要补得先造出门之前的副作用）；
    ③ **第二道门只认「恰好一层」目录**（`…/{projectId}/sub` 不认、放行；真到那条路要同时补用例）；
    ④ **参数名 fail-open**（F3）：第二道门靠 `params["sessionID"]` 认出入境，上游给任一条链改名、或新增
    第三条会话链用别的名字 ⇒ 读不到 ⇒ **静默放行**、不报错不变红。今天全仓会话作用域出口都叫 `sessionID`
    （两条 GET 各有用例钉着），**其余出口与将来新增的链**没有人守；
    ⑤ **pty 不在第二道门射程内**（F7）：它走 `ptyID`，归档前建的 pty 其 cwd 仍指着已删目录；**未实测**，登记为同族出口；
    ⑥ **「缺归档行 ⇒ 未归档」这个默认值有三处写法**（F4）：两道门共用一份（刻意收在一处），归档链的 `decide`
    输入与 T018 列表的键缺席各有一份 ⇒ 今天同口径，但**没有**一条断言把三处钉在一起；
    ⑦ **第一道门排在 R5 之后**（F5，裁定的次序）⇒ 已归档 ＋ 无 `project_ext` 行的请求 200 落沙箱根，与
    「已归档 ⇒ 一律 403」的字面不一致；
    ⑧ **第二道门给会话作用域请求多一次会话行读**（本地 SQLite）＋可能一次归档查询——安全换成本，如实记；
    ⑨ **「归档项目会话整体冻住」的连带后果**：连 owner 读自己归档项目里的会话也是 403（裁定延伸的一致读法）。
- [x] T016 [P] [BE] 验证会话彻底私有（成员会话只存自己 db）+ 文件并发靠 git [FR-011][FR-012] [T003] [出参：owner 看不到 member 会话、git 留痕]
  - 🔒 **Q2 裁定（2026-10-06）：`git` 的载体 = 共享 bare 仓库 `/shared/{projectId}.git`**——成员各自 clone / commit / push（FR-012「各自 commit、冲突 merge」的唯一逐字实现：不同检出、同一仓库）。**不经 HTTP** ⇒ 锚定不变量不破。原 `U6`（「FR-012 无载体」）由此解决；本 task 要验的就是「两个检出各自 commit 后能 push 并 merge 冲突」。
    - ⚠️ **2026-10-06 补记（裁定「裸仓库归 T018」时一并落）**：**仓库的「建」这一动作归 T018**（见 T018 的裁定 (2)）——本 task 只**用**它，不建它。开工时那个 `/shared/{projectId}.git` 应当已经存在（由 T018 建的共享项目带出来）；若没有，说明是 T018 的缺口，回来查 T018 而不是在这里补建。
  - ✅ **出参落地（T016，2026-10-06）**：新建 `packages/opencode/test/server/openhive-project-shared.test.ts`（**5 条 · 55 expect**，**全绿**；门禁：同族 9 文件 **69 pass / 0 fail**，typecheck 31/31 exit 0，`lint:openhive` exit 0，新文件在根 lint **0 命中**，`bun.lock` diff 空）。**零生产代码改动**（`git diff packages/*/src` 为空）——两半属性**都已达成**，本条是「钉属性」（同 T025 的形态）。
    - **两半的判据点**：① FR-011 钉的是**共享项目里的 owner 与 member**（003 的 `tenant-db-isolation.test.ts` 钉的是一般情形），四条用例：对照（owner 带项目头 ⇒ 头生效，证明机制是活的）／双向 404 ＋双向列表／直接读两个库文件／**共享根下只有 `<projectId>.git`**（FR-011 的反面）；② FR-012 一条用例走完整流程：两个检出各自 commit ⇒ 第二个 push **被拒** ⇒ merge **出冲突** ⇒ 解冲突后 push **成功** ⇒ 第三个检出 clone 下来**两次提交都在**。
    - ⚠️ **`git` 那半走上游 `Git` 服务、不自己 spawn**（照 `project.ts` 的 `gitInit` 注释：那串 `-c core.autocrlf=false` 等必须一致——本机 `core.autocrlf=true`，`LEARNINGS #003-07`）。
    - ★ **两条实测发现（都不在本条出参内，已挂 `state.md`）**：**(a) 成员带项目头被无声忽略**——`project_ext`（个人态）里只有创建者那一行，成员那头查不到 ⇒ 中间件**静默退回沙箱根**（`projectID` 读作 `global`）：探针实测 200 但落点不对。「成员进不去共享项目的目录」是真缺口，修它 = 新能力（T018 / T021 地界）。**(b) 「必须是裸仓库」只由测试里那一条断言钉着**——把 `--bare` 拿掉，①–⑨ **全绿**（非裸仓库的当前分支是未出生的默认分支，推 `trunk` 不被 `denyCurrentBranch` 拦）⇒ Q2 裁定那个字面**没有第二道防线**。
- [x] T023 [US5] [FE·新增] 实现项目归档的**前端入口**（项目/列表上的「归档」动作 ＋ 「已归档」分组的呈现）[FR-008] [T013] [出参：民警点得到「归档」、能在「已归档」里看见它]
  - 🔒 **补编号裁定（2026-10-06，T013 收尾时用户裁定「补编号 T023，排最后、不重排」）**：T013 落地的是**后端出口**（`POST /openhive/project/archive`），而 `005/spec.md` 的 FR-002 要求项目面板有「最近 / 全部 / **已归档**」三 tab、FR-008 要求「项目可**手动**归档」——**触发这个出口的那个按钮，22 条任务里一条都没认领**（同 T022 的形态：能力有了、没有入口）。按 T017–T022 先例：**编号排最后、不重排既有编号**，归 Phase 7。
  - ⚠️ **依赖 T013，别提前做**：出口与「归档 ⇒ 冻结」的判定（`ProjectMembership.decide({action:"archive"})`：owner 才放行、已归档的只放行 restore ＋ owner）都已落地；本 task 只做**接线 ＋ 呈现**，不重新判定、不重写文案（同 T021：`decide` 的出口是 `boolean`，文案由接线层给）。
  - ⚠️ **前端换皮纪律照走（宪法 §八）**：SolidJS（非 React）、所有视觉值走 token、绝不手改 `colors.css`、token 真相链是**三处**。落点按既有惯例在 `packages/app/src/project/` ＋ `packages/app/src/workspace/`，**别新建目录**。
  - ⚠️ **三 tab 的「已归档」今天是什么态，开工先量**：T018 那条列表查询已带 `archived` 字段（`state.md` / T013 的 `Entry` schema 里可见），但**呈现**归本 task——先跑一次看它现在长什么样（空态？还是压根没有这一 tab），再决定改动面，别照记忆写。
  - ⚠️ **归档是破坏性操作（沙箱文件会被删）**：入口必须**二次确认**，同 FR-006 的删除确认与 T012 的拉回确认。确认文案要让人看懂「文件会先备份进 MinIO、本地这份会删掉、之后可以找回归档」（这正是 T013 的次序保证）。
  - ✅ **出参落地（T023，2026-10-07）**：民警点得到「归档」（**「全部」tab** 行内、**二次确认**后才送出）、能在「已归档」tab 看见它并**找回**——FR-008 与 FR-009 两条出口都接上了。归档成功后**重拉清单**（§8.2 第 5 步「从最近/全部移到已归档」）＋ **归档的若是当前项目就清掉它**；找回**只重拉清单、不碰当前项目**（找回 ≠ 切到它）。失败时把服务端那句话**原样**交回面板，前端不改写措辞。
    - **改动文件（11 个）**：`packages/app/src/project/{openhive-project,project-data,project-panel}.{ts,tsx}` 及三个 `.test.*`、`packages/app/src/workspace/workspace-entry.{tsx,test.tsx}`、`packages/auth/src/project-member.ts`、`packages/opencode/src/server/openhive/project.ts` ＋ `packages/opencode/test/server/openhive-project.test.ts`。**「谁能归档」一份判定**（全走 `ProjectMembership.decide`，面板零规则复述）；**上游文件 0 处**（改动全在 openhive 自有文件）。
    - **门禁（全部串行，`#003-01`）**：app `test:components` **431 pass / 0 fail / 27 文件**、`test:unit` **870 pass / 0 fail / 120 文件**、`test:browser` **41 pass / 0 fail**；opencode 项目族 **9 文件 67 pass / 0 fail**；auth **238 pass / 1 skip / 0 fail**；`typecheck` **31/31 exit 0**；`lint:openhive` **23 warnings / 0 errors / exit 0**；根 `lint` **4953 warnings / 1 error / exit 1**——那个 error 是**既有上游** `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`（同 `#001-02`），**我改的 11 个文件 0 命中**（阳性对照：同一份输出里 `member-panel` / `file-tree` 有 35 处命中、路径格式一致，所以「0」不是模式假）。`git diff --stat bun.lock` **空**。
    - **变异**：面板 6 ＋ project-data 1 ＋ 接线 5 ＝ **12 组**（主阶段）＋ 本轮审查补的 **5 组**（见下）。其中 M5「归档接到 `restore` 出口」属 `LEARNINGS #003-03` ② 类「**整组红、连对照一起红**」，**据实记**，不写成恰红。
    - **`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`（本 task 起所有门禁/变异一律带）**：bun 的运行时转译缓存在复用时**确定性**报 `Expected JSX element name but found "?" at packages/ui/src/components/file-icons/sprite.svg:1:2`，使整个测试文件**中止**（`0 pass / 1 fail / 1 error`），看着像「还没跑完」。本会话独立复现并细化：缓存目录**首次写**那一轮必过，**紧接着复用同一个已写过的目录**必挂（分辨实验：换无关 env 仍挂 ⇒ 不是「随便加个变量就好」）。已记 `005/state.md`。
    - **第二轮审查（六类 ＋ `#003-02`，2026-10-07，三席并行）**——抓到 3 条「声明的语义没有断言守着」，**全部已修**：① **[最重]** 面板调用方把 `onRestore` 包成**恒真函数** `(p) => void 办(p, props.onRestore)`，把 `ArchivedGroup` 里 `<Show when={props.onRestore}>` 那条「不给回调即不画」整个绕过 ⇒ 未接线时「已归档」tab 多出一个**点了没反应**的「找回」。**这是本 task 自己引入的回归**（HEAD 是 `props.onRestore` 透传），根因正是我自己写下的那条规矩没贯彻到第二个出口（`#003-02` 一句话）。② `rolesOf` 的 `where user_id = ?` 那半条**没有测试钉住**——上面那条 fail-closed 用例把成员行**全删**了，于是「查全部成员再挑」这种丢过滤的写法得到**同样的空结果**、两条都绿。③ 「**找回不碰当前项目**」是**裁定过的语义**，而本节所有找回用例都没先设过当前项目 ⇒ 补一句 `setCurrentProject(undefined)` 全绿。
    - **本轮补的 5 组变异，全属 `#003-03` ① 类「恰红目标那一条、对照不红」**：① 恒真函数 ⇒ 恰红 1（47 pass）；② 去掉 `user_id` 过滤 ⇒ 恰红 1（2 pass）；③ `onRestore` 里清当前项目 ⇒ 恰红 1（70 pass）；④ 归档失败分支也清 ⇒ 恰红 1（70 pass）；⑤ 把 `setProjectFiles(undefined)` 挪到早退之后 ⇒ 恰红 1（70 pass）。判据特意**不**写成「owner 拿到 owner、member 拿到 member」——那要靠 SQL 返回顺序才能决定红不红（`new Map()` 后写覆盖先写），是**不稳定的红**，不算数。
    - ⚠️ **射程外（如实记）**：设计 §8.1 的「归档触发」写了**两条**路径——「项目列表『全部』tab 内，**或项目名右键**」。本 task 只落前者；右键菜单是 T008 的机制、不在 `ProjectPanel` 里，属**未覆盖**（不是「做了」）。
    - ⚠️ **TDD 偏差如实记**：面板段与客户端段的生产代码**先于**测试写成（不是 RED→GREEN），证据由**变异**补上（7 组）；只有**接线**段是真 TDD（先 **62 pass / 6 fail**，再改 `workspace-entry.tsx`）。
    - ⚠️ **挂账（Minor，不阻塞）**：找回无「在办」锁 ⇒ 连点两次发两次请求（非破坏性、服务端方向幂等）；非 400/403 的失败体被丢（内核在 **MinIO 未配时回 503 ＋ `{error}`**，民警只看到「归档项目失败」）——与既有「缺口 12」同源，合并挂账；回调抛异常时面板静默（沿用 `建` 的既有约定）；`roleOf` 的 `null` / 数字边界未钉（行为已 fail-closed）；`rolesOf` 出口不做闭集校验（今天列有 CHECK、唯一消费方自己兜底）；`rolesOf` 在 `packages/auth` 无**单元**测试（同族两条都有；安全属性已由上面的集成用例守住）。
- [x] T024 [US5] [BE] 实现**超期自动提醒**（`last_accessed_at` 超 3 个月 ⇒ 提醒 owner 确认后归档）[FR-008] [T013] [出参：超期项目提醒到 owner、owner 确认才归档]
  - ✅ **§ 范围裁定（2026-10-07，T024 开工前用户裁定，三问全取推荐项）**：
    - **① 提醒触发者 = 服务端在「列项目」时算**（`GET /openhive/project` 本来就返回 `lastAccessedAt`，判定搭在**已有那一次读取**上；前端只画提醒，**不自己算**）。代价如实记：「**民警不开界面就没有提醒**」——三个候选里这是**不引入调度设施**的那一个（② 定时任务要新基础设施；③ 登录时算粒度更粗、且同样只在登录那一刻存在）。
    - **② 范围 = 判定 ＋ 提醒呈现**，**确认入口复用现成的**（T013 的 `POST /openhive/project/archive` ＋ T023 的「归档」按钮与二次确认条）——**本 task 不新增确认流程、不新增归档出口**。
    - **③ 超期判据 = 先补「访问时刷新 `last_accessed_at`」的写入方，再按它判**。实证见下面 ⚠️ 那条：该列**今天只在建项目时写一次**。
  - ⛔ **开工前必须先裁 U3（提醒触发者）**——✅ **已裁（2026-10-07，见上条 ✅）**，原文保留备查：（2026-10-06，T013 收尾时用户裁定「补编号、排最后、不重排」）**：FR-008 是**两半**——「项目可**手动**归档」（T013 落地 ＋ T023 入口）**＋「超期（3 个月无操作）自动触发提醒（owner 确认后才归档）」，而 `005/spec.md` 的场景 4、边界与 Assumptions 三处都写了这半条，**22 条任务里一条都没认领**（2026-10-06 三席评审 S3-04 指出）。补编号归 Phase 7。
  - ⛔ **开工前必须先裁 U3（提醒触发者）**——`005/state.md` 的「尚未裁定」清单里明写 **U2 / U3 未裁（案件实体无 task / 超期提醒触发者）**。三个候选各要一份设计：**① 前端进入时算**（无后台任务，但「提醒」只在用户打开时存在）、**② 服务端定时任务**（真提醒，要引入调度设施）、**③ 登录时算**（够用，粒度粗）。**别在实现里默认选一个**——这条的读者是 owner（谁确认、在哪确认），选错了整套流程都要返工。
  - ⚠️ **形态已由 spec 定死，别再讨论**：**先提醒、owner 确认后才归档**（`spec.md` 边界 ＋ Assumptions 两处同款）——超期**不直接归档**。T013 已经落地「确认后归档」那一步的**出口**，本 task 做的是**阈值判定 ＋ 提醒的产生与投递**（owner 在哪确认、确认入口归不归本 task，**随 U3 一并裁**——别先写死 `[BE]` 还是 `[FE]`）。
  - ⚠️ **阈值判据的字段是 `last_accessed_at`**（`project` 表，FR-002 的排序也用同一个字段）⇒ 它得有**写入方**。开工先 grep 一次「谁在写 `last_accessed_at`」——若没有，那本身就是一条缺口（「3 个月无操作」会恒真或恒假），先补它而不是先补提醒。
  - ⚠️ **上一条里有一处不实、一处已实测（2026-10-07 开工侦察）**：① **`last_accessed_at` 不在 `project` 表**——按 Q3 裁定它落在**每用户库的 `project_ext`**（`packages/core/src/project/ext.ts` 的 `ProjectExtTable`，与 `type` / `project_type` / `shared_directory` 同表；FR-002 的排序用的就是它，那个说法是对的）。原文的「`project` 表」是笔误，按 `#004-03`（「文档里写着 X」本身就是会假的镜像声明）**在此改正、不改原文**。② **写入方实测只有一处**：`grep -rn "last_accessed_at\|lastAccessedAt" packages/*/src` ⇒ 生产里只有建项目那一步写它（`packages/opencode/src/server/openhive/project.ts` 的 `handleCreate`，`const lastAccessedAt = Date.now()`）⇒ 今天「3 个月无操作」**等价于「建项目后 3 个月」**，**项目天天在用也照样到期**。这正是裁定 ③「先补写入方」的实证。③ 附带一条既知事实（T015 审查 / T016 实测已记）：**成员没有 `project_ext` 行**（`insertProjectExt` 全仓只有建项目一个调用点）⇒ 共享项目今天**只出现在创建者自己的列表里**；本 task 的提醒因此天然只到得了 owner，但也意味着「**成员在动、owner 3 个月没动**」这类判据今天**没有可分辨的输入**（成员根本进不去共享项目），**如实记为残差、不写成已覆盖**（`#002-02`）。
  - ✅ **交付（2026-10-07）** —— 三个半边，全在本 feature 自有面上（**上游文件 0 处**）：
    ① **core**：`STALE_AFTER_MS`（90 天定值）＋ `isStale(lastAccessedAt, now)`（纯函数、`now` 由调用方给）＋ `insertProjectExt` / `touchProjectExt` 两个写入方；
    ② **BE**：`GET /openhive/project` 的出参加 `stale`（`handleList` 里 `now` **一次取、整列共用**）＋ **新出口** `POST /openhive/project/touch`（请求体只有 `projectId`，时间由服务端取）；
    ③ **FE**：`touchProject`（薄客户端）→ `ProjectData.touch` → `workspace-entry` 的 `onOpen` 记账 → `ProjectPanel` 行上的「超期未归档」徽章。
    - **裁定三条逐条落实**：① 触发者是**服务端**（搭在列项目那次已有的读取上）；② 范围就是**判定 ＋ 呈现**——**未新增确认流程、未新增归档出口**（确认链整套复用 T013 的 `POST …/archive` ＋ T023 的按钮与二次确认条）；③ 写入方已补（下面的核心改动就是它）。
    - ⚠️ **为什么必须是独立的 `POST …/touch`（三条替代方案都被否）**：塞进 `list` handler = 读出口变成自己的写入方（**列一次项目＝所有项目都被访问一次**，`stale` 恒假、提醒永不出现，且不报错不变红）；塞进 T017 的身份中间件 = 每个请求都写；前端自己算 = 把阈值判据抄进 JS（`#002-06`）。
    - ⚠️ **授权是结构性的，没有 `decide` 可问**：`project_ext` 在**每用户库**里，`update … where project_id = ?` 天生只动自己那行——因此**不给 `PROJECT_ACTIONS` 加「访问」这个动作**（加了会是一条谁也不会问的规则）。判据用**结果**钉：touch 别人的项目 ⇒ 200，而**对方那行一个毫秒都没动**，且自己库里**不凭空多一行**（防 upsert）。
    - ⚠️ **FE 的提醒门 = `canArchive(project) && stale === true`**：复用 `decide`，组件**零规则复述**（成员 / 无 role 的行天生不提醒）；提醒**不**与归档按钮绑同一个 tab（每天打开的是「最近」，绑了就等于没有提醒）。
    - ⚠️ **`stale` 的取法（两个方向的代价不对称）**：BE **一定给**（布尔），FE 侧 `readEntry` 只认 `=== true`——少一条提醒最多是「这个项目晚一天被收拾」，而把没依据的行读成超期，会在**没超期**的项目旁（同一行上就有「归档」按钮）画「超期未归档」，民警照着它把**在用**的项目归档掉（沙箱文件当场被搬走）。
  - **改动面**：新增 `packages/opencode/test/server/openhive-project-stale.test.ts`（BE 半边 6 例 / 30 expect）；生产代码 4 个文件（core `project/ext.ts` ＋ BE `openhive/project.ts` ＋ FE `openhive-project.ts` / `project-data.ts` / `project-panel.tsx` / `workspace-entry.tsx`）＋ 对应 5 个测试文件 ＋ docs 两份。
  - ✅ **门禁（2026-10-07 实测，串行照 `#003-01`）**：core `project-ext.test.ts` **12 pass / 0 fail**；BE 四文件（`-stale`（新）＋ `-frozen` ＋ 空 `openhive-project` ＋ `-file-ops`）**47 pass / 0 fail / 229 expect**；`packages/app` 全量 unit **930 pass / 0 fail / 122 files**、全量组件 **394 pass / 0 fail / 18 files**；三个包 `typecheck` 全过；**仓库根** lint 改动 12 文件 **0 warnings / 0 errors**（`#004-10`）。
  - ✅ **变异 7 组，全属 `#003-03` ① 类「恰红目标那几条、对照不红」**：① `stale: false` 硬写 ⇒ 恰红 2（判超期那两条）；② 去掉 touch 的体解码门 ⇒ 恰红 1（缺 `projectId` 那条）；③ core 边界 `>=` 改 `>` ⇒ 恰红 1（边界那条）；④ FE `touchProject` 改成只看状态码 ⇒ 恰红 2（HTML 兜底 ＋ `projectId` 不匹配）；⑤ 去掉 `stale === true` ⇒ 恰红 1（不超期那条）；⑥ 去掉 `canArchive` ⇒ 恰红 2（member / 无 role）；⑦ 去掉 `onOpen` 那次记账 ⇒ 恰红 1；**反向**再变一次（把记账塞进「拉清单」）⇒ 恰红 2，**含「进门拉清单 ⇒ 不记访问」那条对照自己** ⇒ 该对照**非空断言**（它守的正是裁定②里被否掉的第一个替代方案）。
  - ⚠️ **未做变异、如实记**：`touch 别人的项目` 那条的敏感面在 `DatabaseRouter` 的**按用户分库**上（属 003 的接线，不在本 task 改动面内，且它有自己的测试）——本 task 里对这条只实抓过一次**假绿**并已修：原判据只断 `status === 200`，而**未挂载的路径被 SPA 兜底回 200 ＋ `text/html`** ⇒ 出口不存在时它照样绿；改成 `touchOk`（200 **且**体能当 JSON 解且 `projectId` 相符）后 RED 才是诚实的 5 fail / 1 pass（`#004-08`：副作用类判据要先证明机制是活的）。
  - ⚠️ **一处有意为之、但无测试能钉（不写成已覆盖）**：`handleList` 里 `now` **提到 map 之外**只对**语义**负责（「这个响应说它们各自超期了吗」是一个判断，不是 N 个）——90 天阈值下，逐行取时钟与整列共用**不可分辨**，任何断言都测不出差别。故它是**可读性选择**，不是判据；不补测试、也不假装有。
  - ⚠️ **「已归档的行不带提醒」那条对 `canArchive` 变异不敏感**（实测：变 ⑥ 时它不红）——它守的是**结构**（归档组走 `ArchivedGroup`、不过 `Group` 那条渲染路径），不是门。两条都在、各管一段，如实记。
  - ⚠️ **残差（沿用开工侦察，本 task 未改变）**：**成员没有 `project_ext` 行** ⇒ 共享项目的提醒**天然只到得了创建者**；「成员在动、owner 3 个月没动」这类判据今天**没有可分辨的输入**。另：**不开界面就没有提醒**（裁定①的代价，三候选里唯一不引入调度设施的那个）。
- [x] T025 [US5] [BE] 把「归档 = 冻结」扩到**会话身份不在 `params["sessionID"]` 里**的那类出口（permission / question 的 `requestID`；sync / warp 的**请求体** `sessionID`）[FR-010] [T015] [出参：已归档项目会话里挂起的工具审批放行不了]
  - ✅ **收尾口径（2026-10-06，T025 取数后用户裁定「只钉属性、不加门」）**：取数**推翻了本 task 的前提**——出参**已经达成**，但达成它的不是本 task 原设想的「端点级中间件」，而是 **`Permission` 的实例分桶**（`InstanceState` 按 `ctx.directory` 分桶）：pending 记在**会话所在那个实例**里，`reply` handler 在**另一个实例**（沙箱根 or 诱饵项目）里查它 ⇒ 查不到，404。原设想的那条中间件经实测是 **no-op**（它在同一实例里调 `Permission.list()`，跨项目的 pending 不在该实例 ⇒ 列表恒 `[]`）。
  - 故落点改为：**不写门、零生产代码改动**，只用**两条用例**把「放行不了」这一属性钉住（外加一条对照证明机制是活的）。改动文件：`packages/opencode/test/server/openhive-project-frozen-pending.test.ts`（新）＋ 本 docs 两份；**生产代码 0 行、上游文件 0 处**。取数四行表 / 「为什么中间件是 no-op」/ `question` 同形属**推断** / `sync`·`warp` 挂**缺口**，见 `state.md` 的 T025 节。
  - 🔒 **补编号裁定（2026-10-06，T015 收尾时用户裁定「挂缺口 ＋ 补编号」，排最后、不重排）**：T015 的第二道门按 `MatchedRoute.current` 的 `params["sessionID"]` 认出入境 ⇒ **会话身份藏在别处**的出口一律在射程外。逐条核对路由定义（2026-10-06）：`POST /permission/:requestID/reply`（`groups/permission.ts`，`params: { requestID }`）、`POST /question/:requestID/reply` 与 `POST /question/:requestID/reject`（`groups/question.ts` 两处同形）、`POST /sync/steal`（`groups/sync.ts`，`payload: SessionPayload`）、`POST /experimental/workspace/warp`（`groups/workspace.ts`，`payload: WarpPayload`）——四条**都没有** `sessionID` 路由参数。归 Phase 7。
    - ⚠️ **路径名改正（2026-10-06，T025 取数时）**：原文把这四条写成 `/api/...` 前缀，实测是 **v1 裸路径**——v1 路由树 `groups/*.ts` 的 `root` 不带 `/api`（`permission.ts` 的 `root = "/permission"`、`sync.ts` 的 `root = "/sync"`、`workspace.ts` 的 `root = "/experimental/workspace"`）；`/api/permission` 在本仓**不存在**，请求它会落 SPA 兜底（`uiRoute`）而不是那个 handler。同批改正：`question` 那两个是**同一条路径下的两个动作**（`.../reply` 与 `.../reject`），不是「两处同形」。
    - 形态属 `LEARNINGS #004-01`：**数出口要锚在「做那件事的那一行」，不是锚在「已经有守卫的那些」**。T015 数的是「带 `sessionID` 参数的路由」，而这四条的会话身份在**资源 id** 与**请求体**里。
    - ✅ **端到端取数已做（2026-10-06，见 `state.md` 的四行表）**：`permission` 出口**已实测**——无头 404、诱饵头 404、真头 403（未消费）、解冻后＋真头 200（消费且那一轮继续）。**`question` 同形属推断**（未实测，如实记）；`sync`／`warp` **挂缺口**（未实测，且实操面被 T013 削弱：项目沙箱目录在归档时已删，被放行的工具落地会撞 `ENOENT` ⇒ 真缺口、但不是已知可利用，`#002-02`）。
  - ✅ **开工第一件事是取数、不是写门——已做，结论见上**：实测的是「`Permission` 是不是实例级」——**是**（`InstanceState` 按 `ctx.directory` 分桶）。于是 `requestID → 会话` 这条查法**走不通**（跨项目的 pending 不在当前实例里），这也正是出参**已经达成**的机制。原设想的「端点级中间件」因此是 no-op（实测：它在同一实例里 `Permission.list()`，恒空）。按用户裁定，**不造第二条链、不加门**，改为钉属性。
  - ⚠️ **请求体那两条另有一层代价**：中间件要**读体**才拿得到 `sessionID`，而读体就得像本文件 `rewriteBody` 那样**重建请求**（已有先例，但面更险）。要动就先想清楚失败模式——「体读坏了 ⇒ 下游 handler 收到空体」由谁兜。
  - ✅ **不重复做的事**：`ProjectMembership.frozen` 与第一道门（带 `x-openhive-project` 那条）都已落地 ⇒ 本 task 只补**认路**这一半，不重写判定（`#002-06`：同一个判断两处各写一份迟早不齐）。

---

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003 ✅（依赖 T001）；T004 ✅（依赖 T001，可与 T003 并行）；T017 ✅（依赖 T003，可与 T004 并行）

> 📌 **T017 编号排最后、归属在 Phase 2**（2026-10-06 T003 收尾时裁定补入）：它是 D0-1 落地口径的实装，属「Foundational」而非某个用户故事；补编号时 Phase 2 已有 T003/T004，故用末号而**不重排**既有编号（编号是 ID 不是顺序，同 `LEARNINGS.md` 的条目号规则）。
- **Phase 3**：T005 ✅（依赖 T003）；T006 ✅（依赖 T003）；T018 ✅（依赖 T003+T004+T017）
- **Phase 4**：T007 ✅（依赖 T001）；T008 ✅ ∥ T007（依赖 T001）；T009 ✅（依赖 T007）；T019 ✅（依赖 T007+T011，左栏外壳）；T020（依赖 T007+T008+T018，四项文件操作）
- **Phase 5**：T010 ✅（依赖 T004）；T021（依赖 T004+T018）
- **Phase 6**：T011 ✅（依赖 T002）；T012 ✅（依赖 T011）；T022（依赖 T011+T012+D-13）
- **Phase 7**：T013 ✅（依赖 T003+T011）→ T014（依赖 T013）；T015 ✅（依赖 T004+T013）∥ T016 ✅（依赖 T003，实测为「钉属性、零生产代码改动」）；T023 ✅（依赖 T013，FE 归档入口 ＋ 找回入口，2026-10-07 交付）；T024 ✅（依赖 T013，**2026-10-07 交付**：判定 ＋ 提醒呈现，＋ 补 `last_accessed_at` 的写入方；**U3 已于同日裁定**：提醒触发者＝服务端列项目时算）；T025 ✅（依赖 T015，第二道门射程外的那类出口 ⇒ 实测为「只钉属性、不加门」）

共 **25** 条任务（T001–T025），超出 12–18 条范围（T017 / T018 / T019 / T020 / T021 / T022 / T023 / T024 / T025 都是补入的**孤儿认领**，见各自的裁定说明）。

> 📌 T018 / T019 / T020 / T021 / T022 / T023 / T024 / T025 的编号都排在最后、不重排既有编号（先例裁定），故正文里出现**编号与位置不一致**是**故意的**，不是笔误——现为：T018 列在 Phase 3 区（在 Phase 4 之前），T019 / T020 列在 Phase 4 区末尾、**排在 T008/T009 之后但编号最大**，T021 列在 Phase 5 区的 T010 之后，T022 列在 Phase 6 区的 T012 之后，T023 / T024 / T025 列在 Phase 7 区末尾、**排在 T016 之后**。

---

## 加固轮登记（2026-10-10）

> 这一轮**不新增 task**：用户逐条下达要改的地方（`CLAUDE.md`「加固/修 bug 铁律」），每条都走完
> 六步轨道。这里只做**归属登记**（这条落在哪个已交付的 task 上、回归网在哪个文件、欠账在哪），
> 完整记录见 `state.md` 的同编号小节。**编号 ＝ 下达顺序**，不是 task 号。

| # | 现象（用户原话） | commit | 归属 | 回归网 | 同类落点 / 欠账 |
|---|---|---|---|---|---|
| ① | 「左栏文件 tab 页面，在空白处单击右键呼不出右键」 | `87decf7fca` | **T019**（左栏外壳）＋ **T007**（文件树） | `e2e/real-stack/file-tree-blank-menu-real.spec.ts`（4 条，真栈） | ✅ 那条同型挂账**已由 ⑤ 闭合** |
| ② | 「新建有问题，重命名不成功」（右键菜单那条路径） | `db1a346da2` | **T008**（右键菜单） | `e2e/real-stack/file-tree-menu-focus-real.spec.ts`（2 条，真栈） | 全仓 `ContextMenu` 根用法 3 处已逐个判定，**无第三处同型** |
| ③ | 「会话过期后新建失败」（用户贴的控制台全是 401） | `be7257e0b4` | **T018**（FE 半边的结论话） | 单测 12 条 ＋ `e2e/real-stack/file-tree-session-expired-real.spec.ts` | ✅ **会话过期后没有重新登录入口**已被 ⑥ 闭合（2026-10-10）；另有 2 条小缺口见 `state.md` ③ |
| ④ | 「新建的文件夹建完就看不见」 | `84ff47bd78` | **T018**（范围 ⑤「列文件」）＋ **T007** | 单测/组件共 +9 条 ＋ `e2e/real-stack/file-tree-empty-dir-real.spec.ts`（2 条，真栈） | 空目录 `originalPath` 丢了尾分隔符（今天无消费者）；`EmptyDir` story 进了 a11y 审计面但脚本未跑 |
| ⑤ | （用户**未报**）① 的 ⑥ 步实测出「会话 tab 逐字同型」——空白处右键同样呼不出；**另查出 ① 没有的第二层**：region 不撑满时**菜单照开、作用对象却是上一次的残留** | 本轮 | **T019**（左栏外壳）＋ **T023**（会话列表） | 真栈 `e2e/real-stack/session-pane-blank-menu-real.spec.ts`（3 条）＋ 单元改 1 条（**原为空转**）、新增 1 条类名判据 | 🔴 `session-list.test.tsx` 那条「右键空白处」**从写下那天起就空转**（查 `session-list-body`，该名字被 `packages/ui` 覆盖、DOM 里从不存在）⇒ 本轮改成真用例；🔴 同一个洞在 `file-tree.tsx:398` 的 `data-slot="file-tree-area"` 上还在（今天无消费者，登记不动） |
| ⑥ | （③ 的挂账，用户本轮点名要办）「会话过期后没有重登录出口」⇒ 方案由用户裁定为 **「401 自动重探身份」** | 本轮 | **T015**（登录门 / `AuthGate`）＋ **T018**（fork 外呼底座 `trySend`） | 单元 `src/project/openhive-fetch.test.ts`（新 3 条）＋ 组件 `src/auth/auth-gate.test.tsx`（+3）＋ 真栈 `e2e/real-stack/file-tree-session-expired-real.spec.ts`（判据 1 **从「横幅那句话」迁到「去路：出得来登录页」**） | 🔴 **上游出口的 401 仍无人处理**（真栈实测 `/api/health`、`/global/health` 也 401，走 `utils/server-protocol.ts` / `context/server-sync.tsx`——均非 fork 文件，改它们＝动上游高频文件，登记不动）；🟡 登录页不说原因（横幅随工作台卸载，实测 `[]`）；🟡 同一刻多个出口吃 401 ⇒ 重探多次（接缝刻意不去重）。三条均见 `state.md` ⑥ |
| ⑦ | （用户一次下达的五条交互反馈之**第 1 条**）「新建文件、新建文件夹时，会在文件 Tab 页面的图标下方显示输入框……我希望还是以弹窗的方式进行交互更好」 | 本轮 | **T007**（文件树）＋ **T008**（右键菜单那条入口） | 新增组件 `src/project/file-create-dialog.tsx`（自包含）＋ 单测 `file-create-dialog.test.tsx`（9 条）；`file-tree.test.tsx` 9 条改写（`mount()` 补 `DialogProvider` ＋ 记账 `dispose`）；`workspace-entry.test.tsx` 3 条同改；`dual-file-tree.test.tsx` 的 `mount()` 补 `DialogProvider`（此前丢 `dispose`，一并收掉）；3 个真栈 spec 的定位改走弹窗（`file-tree-empty-dir-real` / `file-tree-menu-focus-real` / `file-tree-session-expired-real`） | 出参**一字未改**（仍 `onCreate({kind,parent,name})`）⇒ 三跳接线（`workspace-entry`→`dual-file-tree`→`FileTree`）**一行未动**。🔴 挂账：`file-tree-blank-menu-real.spec.ts` 第 4 条红——**基线同样红**（`git stash -u` 对照实测），既有账、非本轮引入，登记待裁；另见 `state.md` ⑦ 第 2/3 条 |

**对既有 task 正文的影响**：

- **T007 / T008 / T019 / T018** 的**出参**均未变——这四条改的都是「出参已声明、但落地时没走通」的地方
  （触发区盒高、菜单焦点归还、401 的结论话、空目录的清单条目），不新增功能面。
- **T015（登录门）** 的**出参**同样未变：`view()` 的三分支、`LoginPage` 的入参、身份缝的写入时机都没动。
  ⑥ 加的是**同一道门多了一个开合时机**（运行中吃到 401 ⇒ 重探），走的还是启动时那一个 `probeSession`
  ——不是第二套身份判断。⚠️ 因此组件 `auth-gate.test.tsx` 的既有 17 条**不动**，新增 3 条（共 20）。
- **T018 范围 ⑤「列文件」** 的完成判据要补一句：清单里除了文件路径，还要有**空目录**那条
  （带尾分隔符）——否则「新建文件夹」这个动作在界面上没有可见的果。见 `state.md` ④ 的改法表。
- **T007（文件树）** 的**出参**同样未变：`onCreate` 的入参与喊的时机（敲完名字才喊，不是点一下
  入口就喊）逐字未变，换的只是「名字在哪儿问」——从**树上撑开的行内输入条**换成**模态弹窗**
  （⑦）。⚠️ 因此它的**回归网口径**要跟着记一笔：树那一层量不到「名字值不值得交出去」这条判据
  （树上那 9 条都喂干净名字），trim / 空名禁用两条钉在新组件 `file-create-dialog.test.tsx` 里
  ——判据**只有一份**（`#002-06`）的代价，④-B 变异实测确认。
