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
  - ⚠️ **范围（今天写成明账，动手前再核一遍）**：① **项目创建落库**——`ProjectTable`（上游）＋ `ProjectDirectoryTable`（上游）＋ `project_ext`（T003）＋ `project_member`（T004）的**同步创建**，U4 的「两张表同步创建 ⇒ 收成一个写入模块」正是这条要收的口子；② **项目列表查询**——把上表拼成 `ProjectEntry`（`id` / `name` / `type` / `memberCount` / `lastAccessedAt` / `archived`，形状见 `project-panel.tsx`）；③ **HTTP 出口**——`GET /project` 已有，**缺 create**；④ **建目录**——T017 的 `project-location.ts` 文件头「已知不覆盖 ①」原话是「只写路径，**目录由 T006 落地**」，而 T006 裁定不做落库 ⇒ 这一条一并归到本条（**这是 T006 → T018 的第二次移交，别以为它已经有人做了**）；⑤ **文件列表读取**——把 `GET /file`（上游已有，`.../httpapi/handlers/file.ts` 的 `list`）接进 `packages/app/src/project/project-files.ts`，**否则左栏文件树恒走空态**。⚠️ **本条是 2026-10-06 T008 收尾时补进来的**：`project-files.ts` 的文件头早就写着「把文件列表接进来是 **T018** 之后的欠账」，但**本条的范围里此前没有它**（`LEARNINGS #002-04`：责任推出边界必须落接收方的表）——不补，则 T020 开工时才发现「没有列文件就没有可操作的对象」。
  - ⚠️ **收口时必查（⑤ 的去向）**：`project-files.ts` 接上真数据后，空项目应给 `[]`（合法的「一个都没有」）而**不是**继续 `undefined`——两者的区别写在该文件头（同 `project-list.ts` 那条）。
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
- [ ] T019 [US2/US4] [FE·新增] 实现**左栏外壳：② [会话][文件] tab 容器 ＋ ④ MinIO 常驻窄条** [FR-005] [T007][T011] [出参：左栏能切「会话/文件」、MinIO 窄条常驻]
  - 🔒 **补编号裁定（2026-10-06，用户）**：同 T017/T018 先例——**编号排最后、不重排既有编号**。这两块**外壳**在 T007 侦察时被查出**无 task 认领**（`grep` 全 `tasks.md` 零命中，12 条 FR 也没有对应条款），而 US4 验收标准依赖 ②（「当前在**「文件」tab**」）⇒ 若不补，T012 的验收无从谈起。
  - ⚠️ **只收两块「外壳」**：② 的 tab 容器（切「会话/文件」）与 ④ 的 MinIO 常驻窄条（设计 §2）。**「会话」tab 里的会话列表（设计 §7）不在范围内**——它可能是别的 feature 的产物，留给裁定。
  - ⚠️ **搬家的接口**：T007 的文件树今天直接挂在锚点行下（`file-tree-slot`）。T019 落地时把 `file-tree-slot` **整体搬进 ② 的「文件」tab body**——`file-tree.tsx` 本身**一行不改**（这正是 T007 选「受控组件 ＋ 接缝」的原因）。
  - ⚠️ **顺带待办**：T007 已知的 **↑↓ 区间导航**（见 T007 的键盘条）与左栏整体键盘可达性，归本 task 一并考虑。

- [ ] T020 [US2] [BE] 实现文件树的**复制 / 移动 / 上传 / 下载**（四项的真执行＋接线）[FR-005] [T007][T008][T018] [出参：右键菜单这四项真能执行]
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

- [ ] T021 [US3] [BE] 实现成员**邀请 / 移除 / 退群**的落库 ＋ HTTP 出口（判定一律走 `decide`）[FR-004] [T004][T018] [出参：owner 能邀请/移除、member 能退群，越权被拒]
  - 🔒 **补编号裁定（2026-10-06，T010 开工前用户裁定「只做前端＋接缝，另补编号」）**：T010 侦察出的**计划缺口**——`grep` 全 `tasks.md`，「邀请 / 移除 / 退群」的**服务端出口与落库零任务认领**：T004 只交纯判定（`membership.ts`）＋ 两张表，T010 只交前端面板，T013／T014／T015 是归档线（归档 / 找回 / 失权），T018 的范围是项目 CRUD。按 T017／T018／T019／T020 先例：**编号排最后、不重排既有编号**，**归 Phase 5（US3 成员管理）**。
  - ⚠️ **为什么依赖 T018**：邀请的语义是「把某某加进**项目 X**」，前提是项目 X 真的在库里——而 `project` 行与 `project_ext` 行的**同步创建**归 T018（U4 的「收成一个写入模块」）。在那之前出口没有可作用的对象。这是本次「不在 T010 里硬做」的**实证理由**，不是排期偏好。
  - ⚠️ **判定不许重写**：授权一律走 `packages/core/src/project/membership.ts` 的 `decide`。它的出口是 `boolean`（无结构化理由），文案由本层接线组（T004 已记：接线层自己知道问的是哪个动作、归档态是什么）。
  - ⚠️ **两层要分清**：① **授权**（`decide`，服务端每次调用都问）与 ② **库的不变量**（`project_member` 的部分唯一索引管「至多一个 owner」、`project_archive` 管归档态）是**不同层的两件事**——别把库拿到的不变量当成授权，也别指望 `decide` 能看出「库里有两个 owner」（它只看得到一个 `role`，T004 已记）。
  - ⚠️ **文件落点开工前先核**：`membership.ts` 的文件头写着接线归 `packages/opencode/src/project/member.ts`，但 `packages/opencode/src/project/` 是**上游目录**（`bootstrap.ts` / `project.ts` / `vcs.ts` 都在那儿），而本仓定制惯例是自有目录 `packages/opencode/src/server/openhive/`（`access.ts` / `gateway.ts` / `ui-shell.ts`）。二选一要显式裁定并**回头改 `membership.ts` 文件头那句**（`LEARNINGS #002-06`：位置漂了不会报错，也没人会回来改）。

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
- **Phase 4**：T007 ✅（依赖 T001）；T008 ✅ ∥ T007（依赖 T001）；T009 ✅（依赖 T007）；T019（依赖 T007+T011，左栏外壳）；T020（依赖 T007+T008+T018，四项文件操作）
- **Phase 5**：T010（依赖 T004）；T021（依赖 T004+T018）
- **Phase 6**：T011（依赖 T002）；T012（依赖 T011）
- **Phase 7**：T013（依赖 T003+T011）→ T014（依赖 T013）；T015（依赖 T004+T013）∥ T016（依赖 T003）

共 **21** 条任务（T001–T021），超出 12–18 条范围（T017 / T018 / T019 / T020 / T021 都是补入的**孤儿认领**，见各自的裁定说明）。

> 📌 T018 / T019 / T020 / T021 的编号都排在最后、不重排既有编号（先例裁定），故正文里出现**编号与位置不一致**是**故意的**，不是笔误——现为：T018 列在 Phase 3 区（在 Phase 4 之前），T019 / T020 列在 Phase 4 区末尾、**排在 T008/T009 之后但编号最大**，T021 列在 Phase 5 区的 T010 之后。
