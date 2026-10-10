# 实施进度 · 项目管理（工作空间轴）

## 当前任务
**⛳ 本 feature 已收尾（2026-10-07，Step 6 办结）**：**25 条 task 里 24 条落地**，唯一未勾的是 **T022**
（MinIO 的 HTTP 出口，前置 `D-13` **只能在目标环境办** —— 本机 `docker: command not found`、无 MinIO，
**已整条移交** `docs/workspace/deploy-todo.md` 的接收方表）。**两轮审查新账 25 条**（Step 5 五席 16 ＋
第二轮三席 9），**改了代码/配置的 10 条 ＋ 文档层修 2 条 ＋ 挂账 13 条**，**Minors 一律挂账**。**下一步 ＝ 用户在主检出合入 ＋ 打 tag**
（命令见 `session.md` 的「用户侧」）；交接全貌见 `session.md`，本节以下留作**过程记录**。

T001（定位）✅ ／ T002（MinIO 目录与权限方案）✅ ／ T003（`project_ext` 表 ＋ 建表钩子）✅ ／ T004（`project_member` ＋ `project_archive` ＋ 微信群模型判定）✅ ／ T017（「当前项目」身份的落地口径）✅ ／ T005（项目锚点行 ＋ 左栏接线 ＋ 空态接缝）✅ ／ T006（项目面板 ＋ 接缝 ＋ 左栏接线）✅ ／ T007（文件树 ＋ 接缝 ＋ 左栏接线）✅ ／ T008（文件树右键菜单）✅ ／ T009（删除二次确认 ＋ 选中点亮/置灰）✅ ／ T010（成员面板 ＋ 接缝 ＋ 接线）✅ ／ T011（MinIO 客户端）✅ ／ T019（左栏外壳：② tab 容器 ＋ ④ MinIO 常驻窄条）✅ ／ T012（US4 上下双树拖拽：沙箱 ↔ MinIO，已备份标 ✓）✅ ／ T018（项目 CRUD 落库 ＋ 列表查询 ＋ HTTP 出口）✅ ／ **T013（US5 项目归档：上传 MinIO ＋ 删除沙箱 ＋ `archived=1`）✅** ／ **T014（US5 项目找回：`archived=0` ＋ MinIO 下载回沙箱）✅** —— 见「已完成」（T013 的同一条链的另一半：**同一个文件** `archive.ts`、同一张路由表、`ProjectIdBody` 共用一份契约，只是方向反过来 ⇒ 接线只加一行）／ **T015（US5「归档 = 冻结」：`project-location.ts` 两道门 ＋ core 的 `frozen`）✅**（见「已完成 → T015」；第二次审查实测 F1 后修复，8 pass / 0 fail）／ **T025（US5 射程外那类出口：实测为「只钉属性、不加门」）✅**（见「已完成 → T025」；零生产代码改动，2 条用例）／ **T016（FR-011 会话私有 ＋ FR-012 文件并发靠 git：实测同为「钉属性、零生产代码改动」）✅**（见「已完成 → T016」；5 条用例，两条实测发现已挂账）／ **T023（US5 项目归档的 FE 入口 ＋ 找回入口：只接线 ＋ 呈现，判定全走 `ProjectMembership.decide`）✅**（见「已完成 → T023」；2026-10-07，第二轮审查抓到一条**自己引入的回归**并已修）／ **T021（US3 成员管理四个出口：名单 / 邀请 / 移除 / 退群 —— BE ＋ FE 接线都交付）✅**（见「已完成 → T021」；2026-10-07，用户裁定「BE ＋ FE 一次做完」）／ **T024（US5 超期自动提醒：`last_accessed_at` 超 90 天 ⇒ 列表出参多一个 `stale` ＋ 行上「超期未归档」徽章，并补上 `POST /openhive/project/touch` 这个**写入口**）✅**（见「已完成 → T024」；2026-10-07，开工前三问全取推荐项）。
**下一步 = 待定**，用户在 main checkout 说「next」后开工：**T020 ✅（2026-10-07）／ T021 ✅（2026-10-07）两条前置齐的都办完了**，未尽项只剩 **T022**（依赖 T011＋T012＋**D-13**——D-13 是部署时实测、本机做不了 ⇒ **前置不齐**）——**T024 已于 2026-10-07 办结**（U3 三问当天裁定、判定 ＋ 提醒呈现 ＋ 写入口三半都交付，见「已完成 → T024」）⇒ **25 条任务里只剩它一条**。✅ **T023 已完成（2026-10-07）**——FE 归档入口 ＋ 找回入口交付（原「依赖 T013 ⇒ 前置齐，FE」那条已办结）。✅ **T021 已完成（2026-10-07）**——成员四个出口的落库与 HTTP 出口 ＋ 客户端接线都交付（原「依赖 T004＋T018 ⇒ 前置齐」那条已办结；`tasks.md` 里那条「文件落点二选一」的 ⚠️ 一并办结，裁定取**自有目录 `server/openhive/`**）。⚠️ T014 那笔提示已办结（T015 补的正是**其余出口**那一侧：会话 / 文件 / 上传全部出口 ＋ 目录来自会话行的那条旁路）——**旧提示「别把已有那几条当成失权已覆盖」从此作废**，别再据它开工。另：T013 顺带补了**两条编号**（用户裁定「排最后、不重排」）——**T023**（FE 归档/**找回**入口：出口有了、按钮没有）＋ **T024**（FR-008 的「超期 3 个月自动提醒」：`spec.md` 三处写了它、22 条任务零覆盖；⚠️ **开工前必须先裁 U3「提醒触发者」** —— ✅ **2026-10-07 已裁、已交付**，见「已完成 → T024」）。✅ **T022 是 T012 收尾时补的编号**（MinIO 的 HTTP 出口），**依赖 D-13**；⚠️ 但它的「读 env」那一半**已由 T013 落地**（`MinioConfig`）⇒ 复用它、别再造一个，D-13 剩的是**凭据路径**。
**其余候选**：**T016 ✅**（依赖 T003；**已完成**（2026-10-06）——两半属性**都已达成**，本条只钉属性、零生产代码改动，见「已完成 → T016」；其两条实测发现已挂账）／ **T020 ✅**（依赖 T007＋T008＋T018；**已完成**（2026-10-07）——文件树的复制 / 移动 / 上传 / 下载四个**真执行**出口 ＋ 客户端接线，见「已完成 → T020」）／ **T021 ✅**（依赖 T004＋T018；**已完成**（2026-10-07）——成员四个出口的落库 / HTTP 出口 ＋ 客户端接线，见「已完成 → T021」）／ T022（依赖 T011＋T012＋**D-13**——D-13 是部署时实测、本机做不了 ⇒ **前置不齐**）／ **T023 ✅**（依赖 T013；**已完成**（2026-10-07）——FE 归档入口 ＋ 找回入口交付，第二轮审查抓到一条**自己引入的回归**并已修，见「已完成 → T023」）／ **T024 ✅**（依赖 T013；**已完成**（2026-10-07）——超期判定 ＋ 提醒呈现 ＋ 补 `last_accessed_at` 的写入口，见「已完成 → T024」）／ **T025 ✅**（依赖 T015；**已完成**（2026-10-06）——取数证明出参已由**实例口径**达成、原设想的端点级中间件是 no-op ⇒ 用户裁定「只钉属性、不加门」，见「已完成 → T025」）。
（上一轮读者留下的注意，已完成：**T007 的 ⑤ 前置（3 处目录清单）已随 T005 办完**，不需重做；T009 那条「T007 刻意没在未选中时禁用重命名/删除」的活也已随 T009 办完。）
✅ **T008 留的待裁定项已裁定（2026-10-06，用户「补，phase 你定」）**：复制／移动／上传／下载四个动作零任务认领（`grep` 已核实）⇒ **补 T020，归 Phase 4**（同 T017／T018／T019 先例，编号排最后）。
✅ **T006 顺带接掉了 T005 的欠账（半个）**：`currentProject` 有了第一个写入方（面板点一行 ⇒ 写它 ⇒ 锚点行跟着变）——**但只接了「切项目」**，「新建项目」没有落库就没有项目可切，那半个**明账挂在 T018**（不是暗账）。
✅ **已补齐三条计划缺口（用户裁定）**：
  - **T018** 收「项目 CRUD 落库 ＋ 列表查询 ＋ HTTP 出口（含建目录）」——T006 侦察出「没有任何 task 认领建项目 / 列项目的落库」。
  - **T019** 收「左栏外壳：② [会话][文件] tab 容器 ＋ ④ MinIO 常驻窄条」——T007 侦察出「设计 §2 的这两块没有任何 task 认领」，而 **US4 验收标准原文写着「当前在『文件』tab」**⇒ ② 是 T012 的前置，不补则 T012 无从验收。
  - **T020** 收「文件树的**复制 / 移动 / 上传 / 下载**（四项的真执行＋接线）」——T008 侦察出这四个动作**零任务认领**（`grep` 全文只命中 T008 那一行，且只到「菜单」为止），而归 **Phase 4**（US2）。**本次同时给 T018 补了范围第 ⑤ 条**（文件列表读取）——那是 `project-files.ts` 早就挂给 T018 的账，但**接收方的表里此前没有它**（`#002-04`）。
  三条都按 `#002-04` 落进 `tasks.md`（编号排最后、不重排既有编号，同 T017 先例）；现在 `tasks.md` 共 **25 条**（T001–T025，上限随 T021–T025 逐次裁定顺延），已**超出** spec 写的 12–18 条范围。
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

### T010 · 成员面板（FR-004 / US3 / 设计 §4）

**交付**：新建 `packages/app/src/project/member-panel.tsx`（受控组件，`data-component="member-panel"`）＋
`member-panel.test.tsx`（**18 条**）＋ 接缝 `packages/app/src/project/project-members.ts`（与 `project-list.ts`
同型同因）；接线落在 `packages/app/src/workspace/workspace-entry.tsx`（`memberOpen` 信号 ＋
`ProjectAnchor` 的 `onOpenMembers` ＋ `member-panel-slot` 浮层）＋ `workspace-entry.test.tsx`（＋6 条）。
测试命令同 T007–T009 的三段式（`--conditions=browser` ＋ 两个 `--preload`）。

**`onOpenMembers` 不是新加的接口**：`ProjectAnchorProps` 在 T005 就预留了它，注释原文「点成员徽章：滑出成员
面板（T010）。省略 = 禁用」——今天只是把回调接上，禁用态自然消失。徽章本身（`👥 N`）也只在 `memberCount`
非空时渲染 ⇒ **私有项目没有成员管理入口**是既有的、天然成立的（`ProjectAnchor` 的 `<Show when={props.memberCount}>`）。

**权限：一律问 `decide`，本组件零规则复述。** `actor` 从 `selfPoliceId` 在成员表里反查 role，**查不到就是
`null`** ⇒ `decide` 对每个动作都落空 ⇒ 前端天然 fail-closed（身份没到之前宁少勿假）。四条权限各有用例：
member 看不到别人的 `[移除]`、owner 自己那一行也没有 `[移除]`（移除目标必须是 member）、owner 看不到
`[退出项目]`、已归档时三条动作全不画（FR-010 的冻结在面板上一样成立）。

**「权限决定画不画，接线决定能不能点」——两条独立的理由**（T005 起的老口径）：`decide` 说不成立 ⇒
按钮**根本不渲染**；回调没给 ⇒ 渲染成 `disabled`。所以组件里 `disabled` **只**看「接没接线」，从不看权限。
混在一起写就会得到「有权限但没接线」时按钮**可点而无声**的形状。

**⚠️ 变异 M5 逼出的一处收敛（`#002-06` 的又一实例）**：「谁是我」我一开始写了**两遍**——`我()` 里的
`find(...)` 判权限，标记里另写 `m.policeId === props.selfPoliceId`。把 `find` 换成 `成员()[0]` 时**只有权限
那侧红**（5 条），标记那侧一条用例都不动。改成 `<Show when={m === 我()}>`（比**同一个对象引用**，两处都取自
`props.members` 的元素）后，同一个变异红 **6** 条 —— 一个判断一处实现，一个变异点覆盖两处。

**⚠️ 探针自己的一处 bug（「红得莫名其妙」的那类）**：`行内有(row, slot)` 起初写成
`row?.querySelector(...) !== null` —— **行压根不存在**时 `undefined !== null` 为 `true` ⇒ 它替一棵没渲染
出来的行作证「里面有权限按钮」（假绿），并把紧接着的 `null!` 撑成 `null.querySelector` 的 TypeError。
判据：**返回布尔的探针必须显式判 `row !== null`**，不能靠 `?.` 的 `undefined` 碰巧不等于 `null`。

**面板形态**：定位（`absolute`）由**调用方**包一层，同 `ProjectPanel` —— `MemberPanel` 自己不知道自己在
哪儿（happy-dom 没有 CSS 引擎，几何本来也测不进组件，故这一层不进组件测试）。两个浮层**互斥**（开一个就
关另一个，两处开关都顺手收掉对方）：左栏只有一列宽，叠着是「坏了」的样子不是风格选择，有测试钉住。

**门禁（串行跑，2026-10-06）**：

| 门 | 结果 | 对照 |
|---|---|---|
| `packages/app` `test:components` | **330 pass / 0 fail / 24 文件** | T009 基线 306 ⇒ ＋24（T010 的 18 ＋ 接缝 6） |
| `bun run typecheck` | **31/31，EXIT=0** | 同基线（⚠️ 首跑红 3 条，见下「一处 typecheck 才抓到的」） |
| `bun run lint:openhive` | **23 warnings / 0 errors / EXIT=0** | **本次三文件 0 命中**——引入的 4 处已当场清掉 |
| `bun run lint` | **本次文件 0 命中** | 那 1 error 仍是 `#001-02` 记的上游 `session-ui/src/v2/components/prompt-input/index.tsx:163`，裁定不私改 |

**⚠️ 一处只有 typecheck 才抓到的**：`member-panel.test.tsx` 里 `文本(行(host, …), …)` 把 `HTMLElement | null`
递给了收非空的 `文本` —— `bun test`（bun 的 runner）**不做类型检查**，所以 RED/GREEN 一路都是绿的、没暴露。
已把 `文本` 的第一参数放宽为 `HTMLElement | null`（那一行真不存在时该是「文本读作 `undefined`，于是断言红」，
不是抛异常）。同批清掉 lint 引入的 4 处：`member-panel.tsx` 的 `Icon` 死导入（本组件两个图标都是 emoji，
不用 `Icon`）＋ 测试里 3 处类型断言（泛型 `槽<T>` 会被 `no-unnecessary-type-parameters` 报「T 只用一次」，
改用具名的 `输入框` / `行内按钮` 两个 helper）。

**变异（串行跑，据实记 `#003-03`，全部为①类恰红）**：

- **组件侧**：M1 `能("invite")`⇒`true` 恰红 **2**；M2 `能("remove", m.role)`⇒`true` 恰红 **4**；
  M3 `能("leave")`⇒`true` 恰红 **3**；M4 忽略归档 恰红 **1**；M5 不看 `selfPoliceId` 恰红 **6**
  （收敛后；收敛前 5）；M6 未接线也可点 恰红 **1**；M7 空警号也喊 恰红 **1**；M8 喊错人 恰红 **1**。
- **接线侧**：N1 徽章点了不开 恰红 **5**；N2 两浮层不互斥 恰红 **1**（⚠️ 首跑 sed 的**子串匹配**连带删掉了
  `onOpen` 回调里那处同名的 `setPanelOpen(false)`，红成 2 条——收窄到 `onOpenMembers` 行内后才是恰红；
  那是**工具不精确**造的②类假象，不是被测对象的性质，据实记）；N3 `members` 恒 `undefined` 恰红 **1**；
  N4 标题硬编码 恰红 **1**。

**⛔ 不在本 task 交付**：邀请 / 移除 / 退群的**落库与 HTTP 出口** —— 三个回调今天不接线（⇒ 按钮 `disabled`），
归 **T021**（同批已补编号，见「第五批：T010 开工前裁定」）。

### T011 · MinIO 客户端（FR-007 / US4 / `minio.md` §1 §3）

**交付**：新建 `packages/core/src/minio.ts`（`Minio.makeStore(config) ⇒ Minio.Interface`：`put` / `get` /
`list` / `delete`，**入参不带桶名与前缀**——前缀由构造时的 `scope` 定死）＋ `packages/core/test/minio.test.ts`
（**22 条**）＋ 观测面 `packages/core/src/test-support/fake-s3.ts`（`Bun.serve({ port: 0 })` 起一个真 HTTP 端点）。
> ⚠️ **2026-10-06 补记**：上面那个路径**当时写的是 `packages/core/test/fixture/fake-s3.ts`**，T013 时**迁到 `src/test-support/`**（`packages/opencode` 的归档测试要 import 它，而 core 的 `exports` 是 `"./*": "./src/*.ts"`，放 `test/` 下别的包**够不着**）。本行已按现值改，历史留在这里免得读旧记录的人去 grep 一个不存在的路径。
**零 `package.json` 改动、零 `bun.lock` 改动**（见下）。

**范围（开工前用户裁定，三问全取推荐项）**：落点 = `packages/core/src/minio.ts`（core 顶层，**不是**
`core/src/project/`）；凭据 = **只收凭据、不签发凭据**（STS / 策略变量留给 D-13）；测试深度 = 加
`Bun.serve` **假 S3 端点**，让真 `@aws-sdk/client-s3` 真发请求。

**D0-4 的前提被实测推翻（省下一件事）**：`@aws-sdk/client-s3@3.933.0` **本来就是上游根 `package.json`
的依赖**（`upstream/dev:package.json` 第 113 行），已装、全仓**零 import** ⇒ 本次**没跑 `bun add`**，
`git diff --stat bun.lock` **为空**。D0-4 担心的「加依赖 ⇒ 锁文件被本机镜像源污染」**不存在**（那条
「加完必查」的纪律仍照走，只是这次查出来是空的）。落点也顺带零成本：`packages/core` 的 `exports` 是
通配 `"./*": "./src/*.ts"` ⇒ 新增 `src/minio.ts` **零 `package.json` 改动**。

**观测面为什么是「真端点」而不是「替身」**：`minio.md` §3 那句「测试注入替身」是给 **T012 / T013** 用的
（它们的被测对象是归档流程，换掉 MinIO 是**边界替身**）；而 **T011 自己的产物就是那段 S3 实装**，
用替身等于把被测对象换掉——那不是测试是缺口（`#002-02`）。本机没有 MinIO 可连，但**可以有**一个够用的
端点，同 `#002-05` 的路数（PGlite 让生产驱动真连上）。夹具回答的只是「**我们发出去的请求长什么样**」
（键 / method / body / 错误映射）。**残差如实登记**：桶策略 / STS / `${aws:username}` 一个都没验。

**每个动作都从 `keyOf` 过，而键的前两段也是输入（`#004-01` 在这里的形态）**：`keyOf` 是唯一拼装点，
`scope.userId` / `projectId` 在**构造时**过同一条判据、`path` 在**每次调用**过。为什么这算「数底层函数的
调用点」：键是**三段拼起来的**，只查第三段（`path`）就漏掉前两段——而前两段**不在任何一次调用的入参里**，
比第三段更隐蔽。

**判据取「请求根本没产生」**：`拒于门外` 的第一条断言是 `s3.requests.length === 0`，「调用方收到了错」作为
伴随信号排在其后（`#004-14`）。理由：S3 的键是不透明字符串、但 URL 不是——`007/p-42/../p-99/x` 若原样进
请求路径，HTTP 那层一规范化就落在**别人的前缀**里。反斜杠单列一条：win32 拿它当分隔符。

**`list` 必须把分页走完**：`ListObjectsV2` 一次最多 1000 条，超出置 `IsTruncated` ＋
`NextContinuationToken`。只发一次请求的写法**在小项目上永远绿**，项目文件过千就静默少列——而归档
（T013）正是拿这份清单去传文件的，「少列一条」= **少备份一个文件**，且不报错。夹具把 1000 缩成
`pageSize: 2`，于是「过千才出错」的缺陷在三条数据上就现形（`#002-01` 的形态）。

**404 要分「对象没备份过」与「桶配错了」**：只认 `NoSuchKey` ⇒ `undefined`；`NoSuchBucket`（**也是
404**）必须上抛。判据钉在 `error.name` 上——探针实测（2026-10-06）：`@aws-sdk/client-s3` 把响应 XML 里的
`<Code>` **原样放进 `error.name`**（403 那条实得 `"InternalError"`，桶配错那条实得 `"NoSuchBucket"`）。
后果方向相反：一个是「这个文件没备份过」，一个是「你的桶根本不存在」。

**⚠️ 一处观测面修正（`#004-13` 情形①「没有现成观测面 ≠ 没有观测面」）**：夹具最初绑 `127.0.0.1`，
于是 **M15**（`forcePathStyle: true ⇒ false`）跑出 **21 条全绿**。根因**不是**「那行是多余的」，而是
**端点 host 是 IP 字面量时 SDK 自己会退回 path-style**（`openhive.127.0.0.1` 不是合法主机名）⇒ 那一行
**在原来的观测面里根本不可见**。换观测面（夹具绑 `localhost`、端点给主机名）后 M15 变红 **13** 条。
这不是洁癖：`forcePathStyle` 在真环境里是要命的（MinIO 在 `minio.internal:9000`，不开就打到
`openhive.minio.internal`）。夹具里另有一条兜底——万一某台机器把 `*.localhost` 通配解析了，请求会带着
桶名当主机名到达，落到「桶名不是 openhive」那条 404 上，**两种世界都是红**。

**⚠️ 一条「只有 typecheck 才守得住」的代码——M14 全绿的正确读法**：`if (response.Body === undefined) throw`
变异掉之后 **22 条全绿**。按 `#003-03` 类③ 的规矩本该删，但**实测删掉它 `typecheck` 立刻红**：
`src/minio.ts(132,16): error TS18048: 'response.Body' is possibly 'undefined'`（`packages/core`
`tsgo --noEmit` exit 2；还原后 exit 0）。⇒ 那段代码**不是「没人守的多余代码」，而是一次类型收窄**——
类③ 的前提是「只有测试能守它」，这里前提**不成立**。这件事是**量出来的、不是推出来的**（`#003-04`），
故按要求保留，并把「谁在守它」写在这里。

**⚠️ 补的一条「杀死另一种实现」的用例**：403 那条只能证明「**非 404** 的真错误会抛」；把判据写成
`状态码 === 404 ⇒ undefined`（很自然的写法，因为「404 就是没有嘛」）那条**照样绿**。故补「桶名配错
（404 `NoSuchBucket`）」一条，钉 `error.name === "NoSuchBucket"`；**M16 恰红 1 条、正是这条** ⇒ 它有牙。
⚠️ 据实说明：**这条不是 RED-first 写出来的**——补它时实装已经是对的，所以拿 M16 的恰红当它的成牙证据，
**不冒充「先红后绿」**。

**⚠️ 一处我自己的 bug（测试先红才发现的）**：把 `拦住了` 改成基于新助手 `抛了` 时，`.then` 的两个分支
**写反了**——`抛了` 在「动作真的抛错」时是**正常 resolve**（它把错误当返回值交出去），只有「动作居然成功了」
才 reject。于是 7 条路径边界用例当场全红。是测试先红的，产品码没动。

**变异（串行跑，据实记 `#003-03`，16 个全部①类恰红，无②③类）**：**M1** 去掉「`..`」判据 红 **5**（它一处
守着**三个输入**：`path` ＋ `scope.userId` ＋ `scope.projectId`，各自有用例）；**M2** 反斜杠 红 **1**；
**M3** 盘符 红 **1**；**M4** 开头的「/」红 **1**；**M5** 空路径 红 **1**；**M6** 建店时不校验 `scope.userId`
红 **1**；**M7** `list` 不剥前缀 红 **4**；**M8** `list` 不翻页 红 **1**（正是「三条数据一条不少」那条）；
**M9** 前缀漏掉 `projectId` 红 **6**；**M10** 把所有错误都吞成 `undefined` 红 **3**（403 条 ＋ 桶配错条 ＋
**`get` 的路径边界条**——因为 `keyOf` 在 `notFoundToUndefined` 的闭包**里面**，吞错会连带吞掉边界校验的
抛出）；**M11** `put` 绕过键边界 红 **6**；**M12** `get` 绕过 红 **1**；**M13** `delete` 绕过 红 **1**；
**M14** 空 body 分支 红 **0**（见上，守它的是 typecheck）；**M15** 关掉 `forcePathStyle` 红 **13**；
**M16** 改按状态码判 404 红 **1**。

**门禁（串行跑，2026-10-06）**：

| 门 | 结果 | 对照 |
|---|---|---|
| `packages/core` `bun test` | **1209 pass / 8 skip / 5 fail / 3275 expect() / 1222 tests / 159 files** | 本轮开工时同机同 worktree **1208 / 8 / 5 / 3274 / 1221** ⇒ ＋1 条用例、＋1 次 expect；**5 条失败名称未变** |
| `packages/app` `bun run test:components` | **不适用** | 本题零前端改动 |
| `bun run typecheck`（根 `tsgo -b`） | **31/31 successful，EXIT=0** | 29 cached |
| 文件级 oxlint（仓库根，`#004-10`） | **0 warnings / 0 errors / 3 files / 130 rules / EXIT=0** | 见下「首跑 1 warning」 |
| `bun.lock` | **一行未动** | `git diff --stat bun.lock` 为空 |

那 5 条失败**全是上游 `NpmConfig.*`**（`NpmConfig.load` 三 ＋ `NpmConfig.registry` 二）——本机 `~/.npmrc`
指向镜像所致，与本题无关。

**🚩 `lint:openhive` 对本题是空结论（记下来免得下次再报一次假的）**：它 **exit 0**（23 warnings / 0 errors /
81 files），但**只扫 `packages/app/src/{rail,center,topbar,workspace,project,auth}` 六个目录**，
**不覆盖 `packages/core`**（脚本原文见根 `package.json`；输出里 29 处文件命中全是 `packages/app/`）。
⇒ 对本题，「本次文件 0 命中」在这道门上**恒真**，等于没测。**任何 `[BE]` 落在 `packages/core` /
`packages/auth` / `packages/opencode` 的 task，必须另取文件级 oxlint**，不能拿这道门当判据。

**文件级 oxlint 首跑 1 warning，按仓库成文写法清掉**：`await-thenable` 命中
`await expect(store.get(...)).rejects.toThrow()`。`packages/auth/src/{rbac,rls,migrate-cli}.test.ts`
三处都留着同因同注——「**刻意不写** `await expect(...).rejects.toThrow()`：`bun-types` 把 `.rejects` 声明成
`Matchers<unknown>`，`await` 一个 `void` 会被记一条，**全仓已有 98 处同类命中**」。本文件照抄同一写法：
一个返回**错误本体**的 `抛了(run)` 助手——比原写法更强，「抛了」只是伴随信号，返回本体才能钉「抛的是
**哪一个**错」（`#004-14`），而正是这一条让 M16 有牙。

**⛔ 不在本 task 交付**：

1. **接线与出口**——谁调 `makeStore`、endpoint 与桶从哪来、菜单第 9/10 项背后谁执行 ⇒ 归 **T012**
   （前端双树）与 **T013**（归档）。
2. **环境变量读取**（`minio.md` §4 那五个 `OPENHIVE_MINIO_*`）**刻意没有落进本模块**：§4 原文写着「最终以
   T011 的实装为准」，但凭据那一半的形状**恰恰是 D-13 要裁定的东西**——现在写死「读 `ACCESS_KEY` /
   `SECRET_KEY`」等于替 D-13 提前拍板，与本次「只收凭据、不签发凭据」的裁定相抵。⇒ **`OPENHIVE_MINIO_*`
   目前全仓零引用（改名前无需 grep），读取落点随 D-13 一并裁定。**
   > ⚠️ **2026-10-06 补记（T013 收尾时同步，`#002-06`）**：**这条已过期**——**T013 已落地这份读取**
   > （`archive.ts` 的 `MinioConfig`，`Config.option(Config.all({…}))`、**整组配齐才算配**），用户裁定
   > 「落 env 读取，D-13 只留『怎么签』」。D-13 剩的是**凭据路径**，不是「读哪几个变量」。
3. **桶策略 / STS `AssumeRole` / `${aws:username}`**——本机一条都验不到（无 MinIO、无目标内网），
   **如实记为缺口**（`#002-02`：测不了的要写成缺口，不能写成覆盖），D-13 部署时实测。
   > ⚠️ **2026-10-06 补记（T013 收尾按 (c) 裁定扩）**：这条缺口**比原先记的更大**——`${aws:username}`
   > 把写权限绑在**调用者**身上，而 (c) 要「服务端写**别人**的前缀」⇒ **策略这一层表达不出来**。
   > 见 `minio.md` §2 补记 与 `deploy-todo.md` D-13 的第 ④ 步（本轮按静态服务凭据落地 ⇒ 端到端测试
   > 跑的是**那条**路径，这条缺口**没被覆盖**）。

**顺手恢复**：`tasks.md` 的 Phase 5 追踪行漏了 T010 的 ✅（`[x] T010` 早就是完成态），本次编辑相邻一行时
一并补上——不是本次引入的问题，登记在此以免被当成新改动。

### T019 · 左栏外壳：② [会话][文件] tab 容器 ＋ ④ MinIO 常驻窄条（FR-005 / 设计 §2②④、§5.1）

**交付**（3 新 ＋ 2 改）：

| 文件 | 内容 |
|---|---|
| `packages/app/src/project/sidebar-tabs.tsx` | **受控**组件（`active` ＋ `onSelect`，自己不带 tab 状态）；13 条测试 |
| `packages/app/src/project/minio-bar.tsx` | MinIO 常驻窄条；6 条测试 |
| `packages/app/src/project/minio-backups.ts` | 数据接入缝（`project-files.ts` / `project-members.ts` 之后的**第三件**，同型同因） |
| `packages/app/src/workspace/workspace-entry.tsx` | T007 的 `file-tree-slot` **整体搬进** ② 的「文件」pane（`file-tree.tsx` 一行未改）＋ ④ 接在 ② 之后 |
| `packages/app/src/workspace/workspace-entry.test.tsx` | ＋8 条接线用例；**既有 2 条按新结构更新**（左栏层级、树在不在——是设计变更，不是「改测试迁就代码」） |

**三处未定决策点 → 已问用户（2026-10-06），裁定均为推荐项**：① 「会话」tab 的 body ＝ **显式空态**
（`data-state="empty"` ＋「会话列表未接入」），不白屏也不装作有内容；② 点窄条 ＝ **只做设计 §5.1 步骤 2①**
（拨回「文件」tab），2②「展开上下双树」归 T012；③ 键盘 ＝ **只做外壳自己的 ← →**，**↑↓ 继续挂账**——
这遵守本 task 自己写下的「`file-tree.tsx` 一行不改」（↑↓ 是树内部的事，T007 的键盘条已挂）。

**两个 pane 同时挂载、靠 `hidden` 切换**（不是 `<Show>`）：`FileTree` 自带搜索词／折叠态／选中行三份内部信号，
一卸载就「切一下 tab 全没了」。已用「切走切回是**同一棵树**（同节点 ＋ 内部计数还在）」钉住。
⚠️ **该用例中段必须有一条「此刻「文件」pane 确实被藏起来了」的前置断言**——缺了它，它在「压根没有 tab 容器」
的旧结构上也全绿（旧结构里树从不卸载，「同一棵树」自然成立），那就成了一条不区分实现、只跟着代码走的断言。

**一处 tsgo 与 oxlint 意见相反的写法**：tablist 的键盘处理器**必须写成内联箭头**。
`(event.currentTarget as HTMLElement).querySelector(...)` 被 oxlint 的 `no-unnecessary-type-assertion` 判为多余，
删掉断言后 **tsgo 报 TS18047 ＋ TS2339**。仓库成文解法是**内联**——Solid 只在内联处理器上把 `currentTarget`
标成该元素，具名函数收的是裸 `KeyboardEvent`（`currentTarget` 退化成 `EventTarget`）。先例：
`packages/app/src/auth/login-page.tsx` 那批 `onInput={(event) => …event.currentTarget.value}`。

**🔴 本 task 最重要的产出：`#005-01` 那颗地雷的适用范围比原记的更宽，而且本次新写的用例里就埋了 4 处。**

`#005-01` 原文只说了 `.toBeNull()`（「断某处没有元素」）这一种写法。实测（2026-10-06）：**任何把「被 Solid
渲染过的节点」当实得值的断言都会中招**。抓到它的经过：变异 **M4** 删掉键盘的焦点跟随那一行，按预期该「恰红 1 条」，
实际**不是我预期的红，是崩**——`expect(document.activeElement).toBe(tab(host, "session"))` 红了，bun 打印
实得值（一个真实 button 节点）时停不下来：**Bun internal assertion failure ＋ panic**、`timeout` 挡下时已跑
**29s**、峰值 **4.68GB**、`EXIT=3`、**一条结果都取不到**。对照：同一条断言改成比**布尔**之后，**2 秒**出结果、
恰红 1 条、12 pass。即危险的不是「慢」，是**它看着像还没跑完，其实是崩了**——在 CI 上就是卡住。

⇒ 本 task 新写的断言里同形状的 **4 处已全部改成断布尔**（每处都留了指回 `#005-01` 的注释）：
`sidebar-tabs.test.tsx` 的焦点跟随、同节点（`槽(host,"probe") === 前`）、aria 指向（`querySelector(...) === pane(...)`）、
`workspace-entry.test.tsx` 的「文件树还是同一棵」（`树(host) === 前`）。
⚠️ **反例（不必改）**：`.not.toBeNull()` 失败时实得值是 `null`（原语），照打印不误——本次那条「先有一棵树可比」
的前置断言属于此类，保留。
📌 **收尾时要把这条并入 `#005-01`**（原条目只写了 `.toBeNull()` 一档，实际是「实得值为节点」一档）。

**变异验证（串行，2026-10-06，据实记三类 `#003-03`）**：

| 变异 | 结果 |
|---|---|
| **M1** 会话 pane `hidden={props.active !== "session"}` → `hidden={false}` | **恰红 2**（都是直接断言 `hidden` 的），11 pass |
| **M2** 窄条 `count !== undefined` → `!!count` | **恰红 1**（「明确 0 项时照样显示」），5 pass |
| **M3** 窄条 `disabled={props.onOpen === undefined}` → `false` | **恰红 1**（「未接线时是禁用态」），5 pass |
| **M4** 删掉键盘的焦点跟随 | 首次**崩溃**（见上）→ 修断言后复跑**恰红 1**，12 pass |
| **M5** 去掉 `MinioBar` 的 `onOpen` 接线 | **恰红 1**（「点窄条切回「文件」」），46 pass |

**除 M4 的首次崩溃外全部为①类（恰红目标），无②③类。**

**门禁（T019 收尾，串行，2026-10-06）**：`packages/app` 组件测试 **357 pass / 0 fail / 812 expect / 26 文件**
（基线 330 / 24 ⇒ ＋27 条、＋2 文件）；`test:unit` **824 / 0 / 3173 expect / 117 文件**（同基线）；
`lint:openhive` **exit 0**（**23 warnings / 0 errors / 86 files**——警告数同基线 23，文件 81 ⇒ 86 ＝新增 5 个文件，
即**新增文件 0 命中**）；本次改动 7 文件单跑 oxlint **0 warnings / 0 errors**（仓库根跑，`#004-10`）；
`typecheck` **31/31**。

**⛔ 不在本 task 交付**：

1. **「会话」tab 里的会话列表**（设计 §7）——本 task 的「只收两块外壳」条已写明，且它可能是别的 feature 的产物。
2. **窄条的 2②「展开上下双树」**——双树本身是 T012 的产物（见上决策点②）。
3. **↑↓ 区间导航**——继续挂账（见上决策点③）。

**缺口 / 挂账（`#002-02`，写明免得看着像漏做）**：

1. **`minio-backups.ts` 今天没有写入方，而且没有能写的东西**——T011 的 `@opencode-ai/core/minio` 是**包内库、
   没有任何 HTTP 出口**把它接到前端 ⇒ 窄条恒走「不知道几项」态（`count` 为 `undefined`，不显示数字）。
   第一个消费者是 **T012**。⚠️ 这不是「没接线」，是**今天没有可接的东西**——把 `undefined` 画成「· 0 项」
   等于替后端回答一个它还没回答的问题。
2. **`workspace-entry.test.tsx` 里既有的 4 处 `expect(...).toBeNull()`**（判 `topbar` / `document-view` 不在的那几处）
   **未清理**——不是本 task 加的（`#005-01` 原始挂账），下次碰到再清。

### T012 · 上下双树拖拽（沙箱 ↔ MinIO）（FR-007 / US4 / 设计 §5）

**交付**（2 新 ＋ 3 改）：

| 文件 | 内容 |
|---|---|
| `packages/app/src/project/dual-file-tree.tsx` | `DualFileTree`（上树＝`FileTree` 本体、下树＝同文件内的 `MinioTree` 只读树、可拖分隔条、拉回确认条） |
| `packages/app/src/project/dual-file-tree.test.tsx` | **20 条**（8 条双树结构 ＋ 12 条拖拽） |
| `packages/app/src/project/file-tree.tsx` | **只加一个 `draggable?: boolean` prop** ＋ 行上一个 `draggable={props.draggable === true && row.node.type === "file"}`；**其余一行未动** |
| `packages/app/src/workspace/workspace-entry.tsx` | `dualOpen` 信号；「文件」pane 的内容由 `FileTree` 换成 `DualFileTree`；窄条 `onOpen` 一步做两件事（切回「文件」＋ 展开） |
| `packages/app/src/workspace/workspace-entry.test.tsx` | ＋**6 条**接线用例 |

**范围（开工前用户裁定，四问全取推荐项 A）**：① 只做前端 ＋ 另补编号 **T022** 承接 HTTP 出口（凭据形状 D-13
**不提前拍板**）；② ✓ 的判据 ＝ **纯路径**（`MinIO key 清单 ∋ 沙箱相对路径`）；③ 双树只替换「文件」pane 的
**内容**，`[会话][文件]` tab 容器（T019）**保留**；④ 备份**直接覆盖**、拉回覆盖沙箱现行那份时**先确认一次**。

**上树不另起一棵**：`DualFileTreeProps extends Omit<FileTreeProps, "draggable">`，`splitProps` 掉自己那五个、
其余原样 spread 给 `FileTree` ⇒ 上树的能力面**跟着 `FileTree` 长**（搜索 / 折叠 / 新建 / 右键都在），不必逐项
转发——那份转发清单本身就是一份会漂的镜像（`#004-07`：说「同形」要按**被调方的全表**打勾）。

**拖拽是「最外层一次问完」**：两棵树的行**刻意同构**（都带 `data-slot="file-tree-row"` ＋ `data-path` ＋
`data-type`，靠 `data-tree` 分是哪棵），所以四个问题——从哪棵树、拖的哪一行、放到哪棵树的哪一行——在 `DualFileTree`
自己那层一次问完（`#004-12`）。代价是**下树复用了 `file-tree-row` 这个 `data-slot`**（看着像笔误，实为委托的
唯一前提），两处注释都写明了。收益是 `FileTree` / `MinioTree` **都不必知道「MinIO」这种东西存在**——它们只交出
一个事实：「这行可以拖」。

**收起态只卸载下树，上树恒挂载**：`FileTree` 自带搜索词 / 折叠态 / 选中行三份内部信号，展开再收起就清掉的话，
用户会看见刚选好的东西不见了（同 T019 的「两个 pane 常挂不卸载」）。有一条用例比**节点本身**
（`树(host, "sandbox") === 前`）钉住——那处也是比布尔，见下。

**`#005-01` 在本 task 的落点**：本次所有「某处没有元素」的断言都写成 `不存在 = (el) => el === null`，因为实得值
若是**被 Solid 渲染过的节点**，红了会把整轮 `bun test` **挂死**（是哑不是红——T019 已实测：29s / 4.68GB /
一条结果都取不到）。⚠️ `workspace-entry.test.tsx` 里**既有**的 4 处同形状断言（判 `topbar` / `document-view`）
**不在本 task 范围内、未动**，仍在挂账。

**happy-dom 没有 `DragEvent`（有 `DataTransfer`）**：拖拽一律拿**裸 `Event`** 顶着，产品码对 `dataTransfer` 一律
可选链（`event.dataTransfer?.setData`）——那两处 `?.` 不是防御性编程，是**测试进得来**的前提。判「拖的是谁」用
组件自己的 `拖源` 信号，而不是 `dataTransfer` 里的 payload（payload 照放，与上游 `file-tree-v2.tsx` 同为
`file:<path>` 形状，但**没有一条断言依赖它**）。

**变异验证（串行，2026-10-06，据实记三类 `#003-03`）**：

| 变异 | 结果 |
|---|---|
| **M1** 去掉「跨树」判据（同树也放行） | **恰红 1**（「同树内拖 ⇒ 两个回调都不喊」） |
| **M2** 落点改成「目录行也取父目录」 | **恰红 5**（红的全是「目标为目录」的用例，**对照条不红**） |
| **M3** 落点改成「文件行取自己」 | **恰红 1**（正是 M2 逼出的那条补条） |
| **M4** 下树 `draggable` 去掉「只文件行」 | **19 条全绿** → 补一条后**恰红 1**（见下） |
| **M5** 上树 `draggable` 恒 `true` | **恰红 1** |
| **M6** 下树 `draggable` 恒 `true` | **恰红 1** |
| **M7** `可放` 的方向判据恒 `true` | **19 条全绿** → 补一条后**恰红 1**（见下） |
| **M8** 拉回不看同名 | **恰红 1**（「无同名 ⇒ 直接拉回」） |
| **M9** ✓ 也画在目录行 | **恰红 1** |
| **M10** 收起态仍渲染下树 | **恰红 1** |
| **N1** 窄条不 `setDualOpen` | **恰红 4**（同一个「展开」动作被 4 条共同依赖，含两条「先展开再操作」的后续用例，**对照条不红**） |
| **N2** 窄条不切回「文件」 | **恰红 2**（T019 那条 ＋ T012 那条） |
| **N3** `onCollapse` 不接 | **恰红 1** |
| **N4** `backups` 不传 | **恰红 1** |

**M4 / M7 全绿不是「代码多余」，是「测试少了一条」**（`#003-03` 类③ 的前提在这里不成立）：两个是**同一个形态**
——同一件事有**两道判据**，而用例只压了前一道。**M4**：上树「目录行不可拖」由 `file-tree.tsx` 守、
**下树那条由 `MinioTree` 自己守**；**M7**：`draggable` 属性是「浏览器不发 `dragstart`」（外部手段）、`可放` 里的
方向判据是「组件自己挡」（内部手段）⇒ 只测前者的话，削掉后者**一条都不会红**（`#004-09` 的形态：端点判据对
「拦在哪儿」不敏感）。⇒ 各补一条用例，**且都是在变异体上补的**（先红后绿，成牙证据就是这两次红）。

**M2 逼出的第三处同型缺口**：M2 红了 5 条后回头数 `拼路径` 的**分支覆盖面**——它有两个分支（目录行 /
非目录行），而落点用例只压到「目录行」与「空白」，「**文件行**」一条都没有；文件行与空白在 `位.路径` 上
**恰好相反**（有父目录 vs 没有），所以「空白那条绿着」**证明不了**「文件行也对」（`#004-01`：判据的出口数要
数全）。补了一条（`拖到文件行上 ⇒ 落点仍是它所在目录`），成牙证据是 M3 的恰红 1。
⚠️ **据实说明：这条不是 RED-first 写的**（补它时实装已经是对的），拿 M3 的恰红当证据，不冒充「先红后绿」。

**一处 RED 阶段就记下的「假绿」**：「展开 → 收起 → 再展开，沙箱树是**同一个节点**」这条在**空壳上也绿**
（那时两边都是 `null`，`null === null`）——它当时**恒真**，要等实装落地才成为真判据。记在这里是因为**它绿过**：
别把它算作「RED-first」，它没有红过。

**门禁（T012 收尾，串行，2026-10-06）**：`packages/app` 组件测试 **383 pass / 0 fail / 27 文件**
（T019 基线 357 / 26 ⇒ **＋26 条、＋1 文件**，正是 T012 的 20 ＋ 6）；`test:unit` **824 / 0 / 117 文件**（同基线）；
`lint:openhive` **exit 0**（23 warnings / 0 errors / 88 files，**本次三文件 0 命中**——引入的 1 处
`require-array-sort-compare`（`.sort()` 没给 compare）已当场清掉）；`bun run lint` **本次文件 0 命中**；
`typecheck` **exit 0**（⚠️ 首跑红 1 条：`MinioTree` 的 `aria-expanded` 写成 `String(展开(...))`，而 Solid 只收
`"true" | "false" | boolean` ⇒ 改布尔，与 `file-tree.tsx` 同写法；**`bun test` 不做类型检查，RED/GREEN 一路
没暴露**）；`bun.lock` **一行未动**。

**⛔ 不在本 task 交付**：

1. **`onBackup` / `onRestore` 的接收方**（MinIO 的 HTTP 出口）——归 **T022**。⇒ **生产里这两个 prop 不传 ⇒
   行不可拖**（「未接线即禁用」，与右键菜单第 9/10 项自 T008 起就禁用同因）。组件这一侧的能力由
   `dual-file-tree.test.tsx` 证明。
2. **`minio-backups.ts` 的写入方**——同 T022（缝里恒 `undefined` ⇒ 下树走「备份清单未接入」空态、窄条走
   「不知道几项」态）。

**缺口 / 挂账（`#002-02`）**：

1. ✅ **T019 挂的那条「窄条 2② 展开上下双树」本 task 已还清**（`MinioBar` 的 `onOpen` 现在一步做两件事）。
2. `workspace-entry.test.tsx` 里**既有**的 4 处 `expect(...).toBeNull()`（判 `topbar` / `document-view` 不在的
   那几处）**仍未清理**（同 T019 挂账 2，不在本 task 范围内）。
3. **↑↓ 区间导航**仍挂账（T019 挂账 3，本 task 未动）。

### T018 · 项目 CRUD 落库 ＋ 列表查询 ＋ HTTP 出口（✅ 两半都已交付）

**出参**（tasks.md：「新建项目成功、项目列表可查询、客户端能切项目（`x-openhive-project`）」）——**三条全交付**：

| 出参 | 交付方式（FE 半边） |
|---|---|
| 新建项目成功 | `ProjectPanel.onCreate` 接线 ⇒ 真落库（`POST /openhive/project`），**建成后成为当前项目**（FR-003） |
| 项目列表可查询 | 进门拉一次 ＋ 建完重拉（`project-list` 缝）；面板三 tab 读它 |
| 客户端能切项目 | 点一行 ⇒ 写 `currentProject` ⇒ `createEffect` 拉该项目文件（**带 `x-openhive-project` 头**，T017 契约落地） |

范围 ⑤（文件列表读取）也一并落地（见下「FE 半边」）。

**落点（三件）**

| 层 | 文件 | 内容 |
|---|---|---|
| 实现 | `packages/opencode/src/server/openhive/project.ts`（**新**） | `PREFIX = "/openhive/project"`；`GET` 列项目、`POST` 建项目；`SharedRootConfig`（本层自己的配置服务）＋ `gitInit` 薄包装 |
| 接线 | `.../httpapi/server.ts`（＋**12 行**） | 并进 `Layer.mergeAll`，逐字照 `AuthGateway.routes` 先例，带 `【保留的定制 · 同步上游时不要丢】` |
| 验证 | `packages/opencode/test/server/openhive-project.test.ts`（**新**，**10 条**） | 建私有/共享项目四处落库、id 是 UUID v4、**建完项目用它建会话**（接缝支点）、建私有项目 `/shared` 下不留东西（对照）、列项目排序与次级键、空库 `[]`、身份隔离、不带凭证 401 |

**建项目的八步顺序——顺序本身就是产物**

① `mkdir({沙箱根}/{userId}/{projectId})` → ② 在其中 `git init` → ③ **把 id 写进仓库里的 `opencode`
缓存文件**（`ProjectV2.commit`）→ ④ `Project.fromDirectory`（**只跑这一次**：它自己末尾还会再 `commit` 一次）
→ ⑤ 改名 → ⑥ **仅共享项目**：`git init --bare {共享根}/{projectId}.git` → ⑦ `project_member` 写 owner
→ ⑧ `project_ext` 落 `type` / `shared_directory` / `last_accessed_at`。

③ 的位置是全条的关键：上游 `ProjectV2.resolve()` 优先级是 `git remote 哈希 → 仓库里的 `opencode`
缓存文件 → root commit`，不先写缓存文件的话 `fromDirectory` 会**再插一行 id 完全不同的 `project`**，
那行 `project_ext` 就永远配不上、**不报错、不变红**。这正是 tasks.md 原条目点名「不写就会静默分裂的
接缝」——本条**真跑了**（用例：建项目 → 用该项目目录建会话 → 断两个 id 相等），不是推断。

**两处实测抓到的坑**

| # | 形状 | 实测症状 | 修法 |
|---|---|---|---|
| 1 | Effect 4 的 `Schema.Literal(...arr)` **是单数签名**（多值的是 `Literals`），多出来的实参被 JS **静默丢掉** | 解码器只认 `"private"` ⇒ **建共享项目一律 400**，私有一切正常（5 条用例红，`Expected: 200 / Received: 400`） | 改 `Schema.Literals(PROJECT_TYPES)`；注释写明「闭集唯一来源是 core 的 `PROJECT_TYPES`」 |
| 2 | `git init --bare <bare>` 的 `cwd` **必须已存在**——`Git.run` 起进程前 `FileSystem.access(cwd)` | 不存在 ⇒ `NotFound` ⇒ 收敛成 `exitCode: 1` ⇒ **建项目 500**；**只有共享项目中招** | 先 `mkdir(bare)` 再进去 `git init --bare` |

两处症状都极具误导性（都是「私有项目全绿、只有共享项目炸」），定位靠的是**临时包一层
`Effect.catchCause` 把 cause 打出来**，不是靠猜。

**门禁（串行，`#003-01`）**

| 门 | 结果 |
|---|---|
| `packages/opencode` `bun test test/server/openhive-project.test.ts` | **10 pass / 0 fail**（57 expect） |
| `packages/auth` `bun test` | **238 pass / 1 skip / 0 fail** |
| `packages/core` `bun test` | **1211 pass / 8 skip / 5 fail**——5 条全是上游 `NpmConfig.*`（本机 `~/.npmrc` 镜像源的产物），与基线做**名称级差集为空** |
| `bun run typecheck` | **31/31 successful** |
| `bun run lint:openhive` | **exit 0 · 23 warnings / 0 errors**（＝T012 基线，本次改动目录**不在它扫的六个目录内**⇒「0 命中」是**空结论**，故另取文件级） |
| 文件级 oxlint（仓库根跑，`#004-10`；9 个改动文件） | **0 warnings / 0 errors** |
| 根 `bun run lint` | 本次新增/改动文件 **0 命中**（那 1 error 仍是 `#001-02` 记的上游 `session-ui` 那处） |
| `git diff --stat bun.lock` | **空**（未跑 `bun install`） |

**⚠️ 一处 lint 规则的行为（记下来省下一次排查）**：`oxlint-disable-next-line` 看的是**字面下一行**——
指令与目标行之间**再夹任何一行注释**（哪怕还是注释）就等于**没禁用**，而且警告行号会跟着目标往下漂，
看着像「指令失效」。本次实测：三行注释块 ⇒ 警告照旧；收成紧贴函数的**一行** ⇒ `0 warnings`。

**FE 半边（2026-10-06 续作，用户裁定 A/B/C ⇒ 薄客户端）**

**实测落点表**（`[FE]` 规矩；「上游文件」一列点明哪一行是合并时要保留的定制）

| 层 | 文件 | 内容 |
|---|---|---|
| 客户端底座 | `packages/app/src/project/openhive-fetch.ts`（新） | `ForkFetch` 类型 ＋ `defaultSend`（默认 `globalThis.fetch`）＋ `trySend`（网络错 ⇒ `undefined`，**不抛**）＋ `readJson`（解不开 ⇒ `undefined`）＋ `isRecord`。**两条链共用一份**：`LEARNINGS #002-06`「同一个判断别两处各写一份」 |
| 客户端 | `packages/app/src/project/openhive-project.ts`（新） | `GET /openhive/project` 列表（`listProjects`）＋ `POST` 新建（`createProject`）；`CreateProjectOutcome` 三态 `created` / `rejected` / `failed` |
| 客户端 | `packages/app/src/project/openhive-files.ts`（新） | `listProjectFiles`：**深度优先**走 `GET /file?path=`（上游 `list` 只回一层），**带 `x-openhive-project` 头**；只收 `type === "file"` 的路径（收目录会把它画成文件）；**一条走不通 ⇒ 整份 `undefined`**（不交半棵树） |
| 接口 ＋ 生产绑定 | `packages/app/src/project/project-data.ts`（新） | 窄接口 `ProjectData`（`list` / `create` / `files`，**按「谁要用」定的**）＋ 生产绑定 `PROJECT_DATA` |
| 接线（**上游文件**，＋5 行） | `packages/app/src/pages/layout-new.tsx` | 1 行 import ＋ 1 个 prop（`projectData={PROJECT_DATA}`）；带 `⚠️ openhive 定制（005 T018）：这是要保留的定制 —— 合并上游时两侧都留着` |
| 接线 | `packages/app/src/workspace/workspace-entry.tsx` | ① 进门拉清单（**代次闸** `清单代次`）；② `createEffect` 换当前项目 ⇒ 拉文件（**`onCleanup` 作废闸**）；③ `onCreate` 接线：真落库 ⇒ 建成后写 `currentProject` ＋ **重拉清单** |
| 验证 | `openhive-project.test.ts`（新 **18**）／`openhive-files.test.ts`（新 **11**）／`project-data.test.ts`（新 **3**）／`workspace-entry.test.tsx`（**＋9**）／`project-panel.test.tsx`（**＋13**） | 替身只替**系统边界**（HTTP 出口 / 进程 `fetch`），**不替被测对象** |

**两条闸为什么必需**（不是防御性编程，各自对应一个**真出口**）：

| 闸 | 挡的是什么 | 不写的后果 |
|---|---|---|
| `清单代次`（计数器） | 「进门那一次」与「建完重拉那一次」**两个写清单的出口**都异步、都可能迟到 | 一个慢的进门响应把**刚建好的新项目**从清单里抹回去 |
| `作废`（`onCleanup`） | `currentProject` 换得快时，**上一轮的文件响应迟到** | 回来时把**上一个项目的文件**写进缝里——看起来像串项目 |

判据来源：`LEARNINGS #004-01`（数出口要数「谁在写这个缝」，不是数「谁看起来像这一类」）＋ `#004-09`（顺序判据只在门之前有观测面时才测得出来）。两条都用**变异**分开证明（见下 W 系列）。

**门禁（串行，`#003-01`；全部在 worktree 内跑）**

| 门 | 结果 |
|---|---|
| `packages/app` `test:unit` | **856 pass / 0 fail / 3211 expect / 120 文件**（T012 基线 **824 / 0 / 117**：＋3 文件 ＋32 条 = 本 task 新增的三个客户端测试文件） |
| `packages/app` `test:components` | **405 pass / 0 fail / 918 expect / 27 文件**（基线 **383** ＋ 本 task **22** 条） |
| `bun run typecheck` | **31/31 successful，exit 0** |
| `bun run lint:openhive` | **exit 0 · 23 warnings / 0 errors** ＝基线**逐项相同**（本 task 初测 **26** = 基线 ＋ 我引入的 3，**已全部修掉**，见下「三处告警」） |
| 根 `bun run lint` | 本次新增/改动文件 **0 命中**（唯一命中在 `layout-new.tsx:25` 的 `consistent-return`，是**上游代码**：`git show HEAD:` 里同一行在 `:21`，被我 ＋4 行 import 顶下去；**不私改**，见下） |
| `git diff --stat bun.lock` | **空**（未跑 `bun install`） |

**三处告警（初测 26 = 基线 23 ＋ 我这 3）——都修了，不留账**

| 规则 | 位置 | 修法 |
|---|---|---|
| `consistent-return` | `workspace-entry.tsx` 的 `onCreate` | 该回调两个出口都回值（没建成回一句话、建成回「没有话要说」）⇒ 补 `return undefined`，不靠落空 |
| `no-base-to-string` | `project-data.test.ts` 假服务里的 `String(input)` | 摊成 `typeof input === "string" ? input : input instanceof URL ? input.href : input.url`（真 `fetch` 收三种入参） |
| `no-unsafe-type-assertion` | `project-panel.test.tsx` 的 `输入框` | 改 `host.querySelector<HTMLInputElement>(...)`（同文件 `按钮` 的既有写法），不用 `as` |

**typecheck 红了 8 条（只有 `tsgo` 看得见，运行期全绿）——据实记，两形状**

| 形状 | 处数 | 位置 | 修法 |
|---|---|---|---|
| fixture 的 `type` 被**拓宽成 `string`** ⇒ 撞 `ProjectEntry.type: ProjectType` | 4 | `openhive-project.test.ts`（`ENTRY`）、`project-data.test.ts`（`一行`） | 给 fixture **标 `ProjectEntry`**（不标的话 `type: "private"` 拓宽成 `string`，`toEqual` 就撞不上） |
| `onCreate={(input) => 记.push(input)}` ⇒ 回调**返回 `number`** | 4 | `project-panel.test.tsx` | 改块体（`push` 的返回值不外露）。⚠️ `void` 返回类型的**特例**在这里不适用：`onCreate` 的返回是 `void \| string \| Promise<string \| undefined>` **联合**，不是裸 `void` |

⚠️ **`layout-new.tsx:25` 那条不私改**：它是上游 `TitlebarUpdate.version` 的既有 `consistent-return`，不是本 task 引入的（`git show HEAD:` 同一行在 `:21`）。**只改自己碰过的那几行**（宪法「侵入是加不是改」）——修它就得改上游代码，为 0 收益换一处同步冲突面。

**变异验证（W 系列，8 处，据实记 `#003-03`）**

| # | 变异 | 结果 |
|---|---|---|
| W1 | 去掉进门拉清单 | **恰红 1** |
| W2 | 去掉建完重拉清单 | **恰红 1** |
| W3 | 去掉 `清单代次` 闸 | **恰红 1** |
| W4 | `createEffect` 里不清空旧文件 | **恰红 1** |
| W5 | 去掉 `onCleanup` 作废闸 | **2 红**（目标 ＋ 一条真实的依赖项「进门那次清单迟到」——**可解释**，不是误伤） |
| W6 | 建完不写 `currentProject` | **恰红 1** |
| W7 | `files` 不带 `x-openhive-project` 头 | **2 红**（目标 ＋ T005 时代的一条 ——同一性质被保护了两次） |
| W8 | 换项目时不清空旧项目文件 | **全绿** ⇒ 见下「测试框架缺口」，**据实记为全绿，不记成恰红**（`#003-03` ③：全绿的处置是**查代码可达性**，不是补测试） |

**⚠️ 测试框架缺口（W8 全绿的根因，据实挂账）**：`workspace-entry.test.tsx` 的 `mount()` 是
`document.body.appendChild(host); render(element, host); return host`——**`render()` 返回的 dispose 被丢掉**。
于是此前挂上的组件**在整个文件里一直活着**、并且**继续响应模块级的缝**（`currentProject` / `projectFiles`…）：
较早的组件稍后会往缝里写，把被测值顶掉。W8 那条「清空旧项目文件」因此**测不出来**——
探针实测：变异下缝里存的是**上一个用例**的 `["资料/话单.csv"]`。
⇒ **不是「测试没覆盖」，是「挂载没卸载」**。修它要动 `mount()`（影响本文件全部用例），
**不在本 task 范围内**，挂账。

**⚠️ 一条与本 task 有关的工具怪癖（据实记，值一次排查）**：`bun test` 在**启用运行时转译缓存**（默认）时，
**间歇性**报 `error: Expected JSX element name but found "?" at packages/ui/src/components/file-icons/sprite.svg:1:2`，
使整个文件中止（`0 pass / 1 fail / 1 error`）并**级联**出后续文件的空白 `# Unhandled error between tests`。
判据：**`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`** ⇒ 完全确定、全绿。实测对比（同一条命令、同一棵树）：
**禁用缓存 405 pass / 0 fail / 27 文件** vs **启用默认缓存 257 pass / 3 fail / 3 error**。
不是代码缺陷（`solid-jsx.ts` 插件的 `onLoad` 过滤器压根不匹配 `.svg`）⇒ **本 task 起所有门禁/变异一律带这个 env**。
性质同 `#003-01`：**先怀疑测量，再怀疑被测物**。

**⚠️ 一次基线对账（记下来省得下次重算）**：本 task 起 `test:components` 记的是 **383**（T012 收尾值），
而实测 **405** ⇒ 差额 **22**。对账法：把两个改过的测试文件用 `git show HEAD:` 换回旧版再跑，
得 **HEAD 全量 = 383**（`workspace-entry.test.tsx` **53** ＋ `project-panel.test.tsx` **18** ＋ 其余 **312**）；
我的版本是 **62** ＋ **31** ⇒ 383 ＋ 9 ＋ 13 = **405** ✓。
（最初算成 393，是因为**误记** `project-panel.test.tsx` 的 HEAD 版是 30 条，**实际 18 条**——
`LEARNINGS #003-04`：数字落笔前先复现一次。）

**三条新裁定（2026-10-06，用户）**

| # | 事项 | 裁定 |
|---|---|---|
| (4) | 打开平台时「当前项目」要不要自动选一个 | **不自动选**（照 spec 字面：不选 ⇒ 不发 `x-openhive-project` ⇒ 后端落回沙箱根，即 005 之前的行为）。已写进 `onMount` 的注释 |

> ⚠️ **补记（2026-10-08，006 侧）**：上表 (4) 的**裁定不变**，但它的**理由后半句已经不成立**。
> 006 Step 5 ②-1 给「当前项目」加了 **cookie 通道**（右栏那条 SDK v2 链够不着请求头，只能靠 cookie
> ——「头是意向，cookie 是环境」）。cookie 由浏览器**对每一条同源请求自动附带**、且**活得比页面久**
> ⇒ 刷新之后信号归零、cookie 却还指着上次那个项目，「不选」不再是自然状态、**要主动维持**。
> 006 已裁定 **B：启动清掉 cookie**，落点在 `packages/app/src/workspace/workspace-entry.tsx` 的
> `onMount`（`setCurrentProject(undefined)`，走那个唯一的写入点），判据在同目录的
> `workspace-entry.test.tsx` 末尾那一节。**005 的四个裸路由行为一个字未变**——变的只是
> 「不选会自动落回沙箱根」这条推断（`LEARNINGS #002-06`）。
| (5) | 新建失败怎么告诉民警 | **输入框下显示一句**（`ProjectPanel` 的 `错误` 槽；回话约定：**字符串 = 没建成**，`undefined` = 收工） |
| (3) 的读法 | 「单独提交」 | 实做为**一次专门的 T018 提交**（带【保留的定制 · 同步上游时不要丢】标记），与 T014 / T017 先例一致——**不与别的 feature 的改动混在一个提交里**即满足原意 |

**缺口 / 挂账（`#002-02`）**

1. ✅ **范围 ⑤（文件列表读取）已还清**（`openhive-files.ts` ＋ `project-files` 有了真写入方）。
2. **`OPENHIVE_SHARED_ROOT` 的部署面**——本机（开发机）无目标内网，`/shared` 只是**默认值可用**，
   不代表部署环境挂载正确。同 **T022 的 D-13**，**部署时实测**。
3. **`project_ext.project_type` 今天写空串**——该列是自由文本 `NOT NULL` 无默认值，而 005 没有任何
   表单/流程收集它。**这不是「暂时用空串」，是显式留白**：谁将来收这个字段，谁负责迁已有行。
4. ✅ **`workspace-entry.tsx` 那处不实注释已改**（T007 落下，「由应用入口注入（`layout-new.tsx` 拿
   `useSDK()` 组）」实测为假）。改后写的是实情：**该由入口注入、今天还没接**（接它要六层 provider，
   属中栏视图那条线），并注明「省略 = 视图拿不到内容（停在空态），但路由与 tab 照常」。
   同时改了 `＋` 旁那句「T018 接上落库后要再定一次」——**定过一次了**（裁定 (3)：面板内联一行命名输入），
   结论是 `＋` 保持「打开面板」，不直达表单（直达要再养一份「起名」状态，而面板那一份已经在了）。
5. **`loadFile` 仍未注入到任何地方**——`WorkspaceEntryProps.loadFile` 的接缝在，但 `layout-new.tsx`
   只传了 `titlebarRight` 与 `projectData`。属**中栏视图**那条线，不是 T018 的事（注释里已写明）。
6. **`workspace-entry.test.tsx` 里既有的 4 处 `.toBeNull()` 仍未清理**（T019 挂账 2；同 `#005-01`）。
7. **`mount()` 从不 dispose** ⇒ W8 测不出（见上「测试框架缺口」）。
8. **`↑↓` 区间导航仍挂账**（T019 挂账 3）。

### T013 · 项目归档（FR-008 / US5 / 设计 §8.2）

**交付**：新建 `packages/opencode/src/server/openhive/archive.ts`（`OpenhiveArchive.routes` —— 一个
`POST /openhive/project/archive`，体收 `{projectId}`）＋ `packages/opencode/test/server/openhive-project-archive.test.ts`
（**15 条**）与 `openhive-project-archive-unconfigured.test.ts`（**2 条**）；给 `packages/auth/src/project-member.ts`
加 `markArchived`（`archived = true` ＋ `archived_at` 的 **upsert**）；观测面 `packages/core/src/test-support/fake-s3.ts`
（**从 `test/fixture/` 迁入 `src/`**）；接线 `packages/opencode/src/server/routes/instance/httpapi/server.ts`
的 `Layer.mergeAll` 加一项。

**🔒 (c) 裁定落地**（Q1×Q3，2026-10-06 用户裁定）：归档时服务端对该项目**每个成员**的沙箱各跑
「上传到**该成员自己的** MinIO 前缀 ＋ 删该成员沙箱」。落地形态 ＝ `backupAll` 里**每个成员各造一个
`Minio.makeStore`**（`scope = {userId: 该成员, projectId}`），**不是所有人共用一个前缀**——拼错方向
不会报错、不会变红，只会让成员找回时拿到**别人的**文件。

**⚠️ 「服务端批处理特权路径」与 003 隔离口径的关系（`tasks.md` 那条要求的对齐）**：**不冲突**。
003 的隔离是**请求作用域**的（一个请求绑定一个 userId、只能碰自己的锚定根）；本模块的**作用对象
来自服务端的 `project_member` 表**，请求入参里**只有 `projectId`**。它与 003 自己的
`archiveSandbox(root, userId)` 同类：领域函数显式收 `(root, userId)`、内部不做身份校验，授权建在
**调用点**——这里的调用点凭据 ＝ 该项目 `project_member` 表里的 **owner 行**
（`ProjectMembership.decide({action:"archive"})`）。换言之：**拿到 owner 行、且只拿到 owner 行**，
才能让服务端替全体成员跑一遍。

**⚠️ 次序是要求不是巧合**：`① 身份 → ② 归档态 → ③ 授权判定（`decide`，纯函数在 core） →
④ 配置检查（`Option.isNone(deps.minio)` ⇒ 503） → ⑤ 成员 id 逐条校验 → ⑥ 全员上传（`backupAll`，
只读沙箱 ＋ 只写 MinIO） → ⑦ 全员删（`releaseAll`，只删） → ⑧ 标记最后落（`markArchived`）`。
③ 排在 ④ **之前**（未授权的人不该从「503 还是 403」读出这台机器的部署状态）；⑥⑦ 是**两个函数**、
中间隔一次 `await`——合成一个循环就又是「传一个删一个」，那时第二个成员上传失败会让第一个成员的
沙箱**已经没了**而项目**没**被标成已归档。

**⚠️ 一条端到端性质没被默认：`minio.md` §1 末段与 (c) 字面冲突**。§1 写「归档/找回**始终只动调用者
自己的前缀**」，而 (c) 要服务端写**别人的**前缀。用户裁定「**按 (c) 改写 §1，并扩 D-13 实测项**」
⇒ 见 [`minio.md`](./minio.md) §1（已改）与 `deploy-todo.md` 的 D-13 格（已扩）。

**关键实测事实（本 task 量出来的，不是推的，`#003-04`）**

1. **`Config.option(Config.all({…}))` 的粒度是整组**：全缺 → `None`、**缺一个 → `None`**、
   全给 → `Some`（2026-10-06 探针）。⇒「endpoint 有、密钥没有」＝ **配了一半**，当「配好了」只会
   在第一次外呼时炸在 SDK 里、报一个与配置无关的错。
2. **`filesUnder` 的跳过口径分两层**：目录不存在 / 空目录 / 符号链接**刻意跳过不报错**。第二层是
   **根那一步**——`existsSync` / `statSync` **跟随**链接，`lstatSync` 才是「看这个条目本身」。只判
   walk 里的条目、根仍在跟随 ⇒ 成员把 `{userId}/{projectId}` 换成指向别处的链接，归档就把**别人的
   目录**读进自己的前缀，而 `rm` 删的只是那个链接（**泄漏不是破坏**，更隐蔽）。这条是 S2-01 抓到的，
   已改 `lstatSync`。
3. **win32 用 `junction` 造目录链接不需要管理员**，`lstat().isDirectory()` 为假（判据与 POSIX
   symlink 同形），且 `rm(link, {recursive:true, force:true})` **只删链接不删目标**（本次实测）。
4. **「未挂载」不是 404**：未匹配路径落 SPA 兜底回 **200 ＋ `text/html`** ⇒ 判「出口在不在」必须
   断 `Content-Type`。
5. **`git init` 的文件数 ＝ 18（＋ `.git/opencode` 1 ＝ 19）**。原先 `tasks.md` / `fake-s3.ts` 里
   写的「~1038 个对象文件」错**两个数量级**，已按实测改正（S3-08）。
6. **`Effect.die` → defect → 500**（`{"name":"UnknownError",…,"ref":"err_…"}`）。

**🚩 未查到底的一件事（grep 得到的四条实测，机制不明 ⇒ 挂账，见下）**：**一进程多 app 时，除进程
第一条 HTTP 请求外，任何新 app 的第一次 PG 查询会被 `PostgresError: Connection closed` 打回一次**
（3–11ms，**不是** 3 秒连接超时），同一 app 的下一条请求即自愈。四条实测：与 MinIO 配没配无关；
与「第几个 app」无关（先用第二个，则是**第一个** app 首查撞）；裸连接池连开三条各自首查**全通**
（⇒ 与连接数 / `PG_*` / DB 层无关）；读 `server.ts` 后**证伪了**我原先「生产不存在这个场景」的说法
——`handler(request, HttpApiApp.context)`（第 59 行）与 `Effect.provide(HttpApiApp.context)`（第 127 行）
共用**同一份模块级** `Context.makeUnsafe(new Map())`（第 133 行），而 `createRoutes()` 每个 listener
调一次 ⇒ **可能生产可达**。这也是两个归档测试文件**必须分开**（各自只建一个 app）的原因。

**✅ 变异验证（2026-10-06，串行跑，5 个变异全部①类「恰红目标」，无②③类 `#003-03`）**：
**M1** `filesUnder` 的 `lstatSync` 换回 `statSync` ⇒ 红 **1**（符号链接用例的「别人的东西没被搬走」）；
**M2** 删掉 `isSafePathSegment(projectId)` 那道门 ⇒ 红 **1**（逃逸用例的**副作用**断言——哨兵文件
真的没了，`join(root, userId, ".")` ＝ 整个沙箱），**不是**状态码那条；**M3** 调换 ③ 授权与 ④ 配置
⇒ 红 **1**（「非成员 ⇒ 403」变 503）；**M4** `releaseAll` 改成删整个成员沙箱 ⇒ 红 **1**（「隔壁专案的
无关.txt 存活」，S3-06 补的观测面）；**M5** `endpointOf` 去掉协议判断 ⇒ 红 **1**（拼出
`http://https://…`）。每条改完即还原、复跑回绿。

**⚠️ 三席评审抓到的、我自己的不实记述（已改）**

- **S1-01 / S2-02**：逃逸用例原自称「400 ＋ 零副作用」，而三条副作用断言**恒真**（没走到副作用
  那一步）。重写的关键是**取值必须选「守卫若缺席、副作用真会发生」的那个**：`projectId` 取 `"."`
  ——它**过** `Minio` 的段检查（不是 `..`、不以 `/` 开头、不是盘符、不含 `\`）但**过不了**
  `User.isSafePathSegment`，而 `join(root, userId, ".")` ＝ **整个沙箱**；另需**注入一行
  `project_id = "."` 的 owner 行**让逃逸路径真的走得通（否则 `membersOf` 空集 ⇒ 403 ⇒ 断言又恒真）。
  正对应 `#004-13`：**「没有现成观测面」≠「没有观测面」**。
- **S3-02**：「生产不存在一进程多 app」被 `server.ts` 读码**证伪**（见上「未查到底的一件事」）。
- **S3-03**：三处「已登记成已知缺口（state.md）」当时**都不存在** ⇒ 本节的「缺口 / 挂账」就是它们的
  落点（`#004-03`：说「有 X 钉住」必须点名那条测试）。
- **S3-08**：`~1038` 实测 **18/19**（见上事实 5）。
- **S1-03 / S3-05**：重入用例的注释把「时刻没被刷新」说成判据，实为**秒粒度 ＋ 断言次序**使然。
- **S1-04**：`.git` 用例原先只钉了 owner 前缀 ⇒ 补成**共享项目 ＋ 两个成员各进各的前缀**。
- **S3-06**：主用例原先不观测「别的项目有没有被误删」⇒ 补「隔壁专案」存活断言（M4 的证据正是它）。
- **S3-09**：`endpointOf`（带协议原样用 / 不带按 `useSSL` 补）原先是内联表达式 ⇒ 提成导出函数 ＋
  四条纯函数用例（⚠️ 据实说明：**不是 RED-first 写的**，成牙证据取 **M5 的恰红**）。

**🧭 门禁（T013 收尾，串行，2026-10-06）**

- `packages/opencode` 归档两文件：**15 pass / 0 fail（102 expect）** ＋ **2 pass / 0 fail（14 expect）**；
  同族 project / directory / member-closed-set / bootstrap 四文件 **23 pass / 0 fail（102 expect）**。
- `packages/core` `bun test` ⇒ **1211 pass / 8 skip / 5 fail / 3278 expect / 1224 tests / 159 files**；
  5 条失败**按名比对**全是 `NpmConfig.*`（本机 `~/.npmrc` 镜像所致），**无新增**（`#003-01`）。
- `packages/auth` `bun test` ⇒ **238 pass / 1 skip / 0 fail**。
- `packages/app` `bun run test:components` ⇒ **405 pass / 0 fail / 27 文件**（本题零前端改动，跑它是为了
  确认 T018/T019 的既有绿没被带坏）。
- `bun run typecheck`（turbo）⇒ **31/31 successful，exit 0**。
- **文件级** oxlint（仓库根，`#004-10`，五个文件）⇒ **0 warnings / 0 errors / 130 rules / exit 0**。
- `bun run lint:openhive` ⇒ **exit 0**（**23 warnings / 0 errors / 161 rules** ＝ 基线，本次文件 0 命中）。
- `git diff --stat bun.lock` **为空**。

**⚠️ 缺口 / 挂账（`#002-02` / `#004-03`，写明免得看着像覆盖）**

1. **FE 归档入口零认领** ⇒ **已补编号 T023**（排最后、不重排；用户裁定 2026-10-06）。出口存在但
   **没有按钮**，生产里归档**点不到**——与 T022 同形（能力有了、没有入口）。
2. **FR-008 的「超期 3 个月自动提醒」零认领** ⇒ **已补编号 T024**（S3-04 指出；`spec.md` 的场景 4、
   边界、Assumptions 三处都写了它，而 22 条任务一条都没覆盖）。⚠️ **开工前必须先裁 U3
   （提醒触发者）**——`state.md` 的「尚未裁定」清单里挂着它。
3. **共享项目 bare 仓库 `/shared/{projectId}.git` 归档后既不上传也不删除**（第 3 席的附加观察）——
   归档流程只处理**沙箱项目目录**。**移交 T014**（找回时也不下载它）⇒ 与「项目归档可完整还原」
   这个读法对不上，T014 开工前要一并裁。
4. **空目录不备份**（`filesUnder` 跳过口径的代价）——可接受，如实记：空目录在 MinIO 里不产生对象，
   找回时也就出不来一个空目录。
5. **`.git` 一并上传**（本机实测 19 个文件，含 `.git/opencode`）——B9 那个「文件数」事实的副产品：
   归档会把 `.git` 整个传上去。是否要排除未定，先记为现状。
6. **每成员各建一个 `S3Client`，而 `Minio.Interface` 没有 `close`**（S2-06）——成员多时连接不回收。
   本轮没做。
7. **`assertSafeSegment` 的 `DRIVE` 判据会在 POSIX 上误伤 `C:xxx` 这类**文件名**（S3-07）——整个归档
   回 500。属 `packages/core/src/minio.ts` 的口径问题，改动面跨包，本轮没动。
8. **`fake-s3.ts` 的「生产代码不得 import」是**没有门守着的约定**（S1-06）——文件搬进 `src/` 后进了
   生产包的编译面，谁在生产代码里 import 它，typecheck / lint / 全部测试**一个都不会红**。要变成有门
   的约束得加 lint 的 `no-restricted-imports`（或一条「生产文件不得出现该 import」的断言），**本轮没做**。
9. **「新 app 首查 `Connection closed`」机制未查明**（见上「未查到底的一件事」）——**可能生产可达**。
   本轮只把它变成测试可读的边界（两个文件各自只建一个 app），没修。

### T014 · 项目找回（FR-009 / US5 / 设计 §8.3）

**交付**：**同一个文件**（`packages/opencode/src/server/openhive/archive.ts`）加**第二个出口**
——`PATH.restore` ＝ `POST /openhive/project/restore`，体收同一个 `{projectId}`（`ArchiveBody` 改名
`ProjectIdBody`，**两个出口共用一份契约**）；新测试文件
`packages/opencode/test/server/openhive-project-restore.test.ts`（**11 条**／664 行）；
`packages/opencode/test/server/openhive-project-archive-unconfigured.test.ts` 加**第 3 条**；
给 `packages/auth/src/project-member.ts` 加 `markRestored`。⚠️ **接线只加一行**
（`routes` 里 `router.add("POST", PATH.restore, …)`），**`server.ts` 一行未动**——沙箱根
（`AnchorWorkspace.Config`）与 `MinioConfig` 那个层 T013 已经供上了。

**🔒 两笔未定项已在开工前裁定（2026-10-06，用户裁定，均取推荐项）**

1. **共享 bare 仓库 `/shared/{projectId}.git`（T013 缺口表第 3 条移交的那笔）⇒ 归档/找回都不动它**。
   它是**项目级**的 git 载体、在 `/shared` 共享卷上；而 MinIO 那些键镜像的是**各人沙箱**
   （`minio.md` §1），塞不进一个项目级对象。代价如实记账：**`/shared` 的占用不随归档释放** ⇒
   已落 `minio.md` §1 的一段 ＋ `docs/workspace/deploy-todo.md` 的 **D-14 第 ④ 项**。
   ⇒ **T014 的实现量：零**——那笔账就此**关掉**（不是又挪一处，`#002-04`）。
2. **找回时 `archived = false` 什么时候落 ⇒ 标记最后落**：下载**全部**成功之后才落。这把 `design` §8.3 的
   「②改状态 ③下载」调成与 T013 归档同一条次序。理由：中途失败 ⇒ 项目**仍是「已归档」**、可重试，
   界面不会谎称已找回；`design` 的原顺序反过来则这次**没有「标记」可以回退**。

**⚠️ 找回是同一条 (c) 裁定的镜像，不是自由选择**：owner 触发、服务端按 `project_member` 对**每个成员**
各跑一遍「把**他自己前缀**的文件下载回**他自己沙箱**」。成员**已失权**（FR-010）自己触发不了；
只还原 owner 那一份，成员的文件就永远留在 MinIO 里——直接违背 FR-009 的「MinIO 文件**全部**下载回沙箱」。
落地形态 ＝ `restoreAll` 里**每个成员各造一个 `Minio.makeStore`**（`scope = {userId: 该成员, projectId}`）
——与 `backupAll` 是**同一条不变量**、只是方向反过来。

**⚠️ 次序（八步，与归档逐条同形，只有 ⑥⑦ 反向）**：`① 身份 → ② 归档态 → ③ 授权判定（`decide`，纯函数在 core）
→ ④ 配置检查（`Option.isNone(deps.minio)` ⇒ 503） → ⑤ 成员 id 逐条校验 → ⑥ 全员下载（`restoreAll`，
只读 MinIO ＋ 只写沙箱） → ⑦ **到这里才**翻标记（`markRestored`）`。③ 仍在 ④ **之前**（同归档：
未授权的人不该从「503 还是 403」读出这台机器的部署状态）；⑦ 最后落 = 下载中途失败时项目**仍是「已归档」**、
重试即可，而不是「界面说找回了、沙箱却是空的/半份」。

**⚠️ `restoreAll` 三处刻意的选择**：① **清单空 ⇒ 跳过、不建目录**（与 `filesUnder` / `releaseAll` 同一个
跳过口径：成员从没 clone 过时凭空给他建一个空项目目录，等于让他的文件树显示一个**他从没有过的项目**）；
② **`mkdir` 逐级递归**（键里的相对路径带目录，只写一层在 win32 与 POSIX 上都会 `ENOENT`；`.git/**`
一并回来也是这条）；③ **`store.get` 回 `undefined` ⇒ 抛出，不静默跳过**（`list` 刚说这个键在；跳过会让
「找回完成」与「沙箱里少一个文件」同时成立、而调用方只看得见前者）。

**⚠️ `markRestored` 是 `update` 而不是 upsert**（对照 `markArchived` 的 upsert）：走得到这里 ＝ 上一句刚从
这个表里读出 `archived = true` ⇒ **那一行必然在**；写成 upsert 就等于允许「本来没有也行」，把「该翻的那一行
找不着」也静默算成成功。`archived = false` 与 `archived_at = null` **必须成对写**（迁移的
`project_archive_coherence_check` 钉着这一对）。**残差如实记**：`update` 命中 0 行**同样成功返回**、调用方
分辨不出——那条路今天**不可达**（没有任何代码删 `project_archive` 的行）；真要防得去数 `rowsOf(update)`
的行数，而那条形状在两种驱动下是否一致**没验过**（`#002-01`）⇒ **不写没验过的判据**。

**⚠️ 一条次序用例的观测面要多造一个条件（`#004-13`）**：`-unconfigured.test.ts` 新加的第 3 条钉的是
「找回里 ③ 授权排在 ④ 配置之前」。造观测面需要**未配置 ＋ 非成员 ＋ 项目已归档**三个条件——少第三个就退化：
**未归档**的项目上 `decide` 走 `RULES.restore`（那个函数**恒 false**），**连 owner 都是 403** ⇒ 那条绿
**证明不了**「403 是因为你不是 owner」。所以用 `标成已归档` 这个**夹具注入**（直接往 `auth.project_archive`
写一行；本文件 MinIO 配了一半 ⇒ 真归档跑不了），并**先断言注入生效**（`前置` 那两句）——否则下面那条 403
会退化成「未归档 ⇒ 谁都拒」，**看着一样绿**（`#002-02`）。

**✅ 变异验证（2026-10-06，串行跑，据实记三类 `#003-03`）**：**5 个变异**。
**M1** 把 `markRestored` 提到 `restoreAll` **之前** ⇒ **恰红 1**（「下载失败 ⇒ 项目仍是「已归档」」，
8 pass / 1 fail）；**M2** 删掉找回里的 `isSafePathSegment(projectId)` 门 ⇒ **恰红 1**（逃逸用例
`projectId = "."`，8 pass / 1 fail）；**M3** `restoreAll` 里所有成员**共用一个 store**（`targets[0]` 的 scope）
⇒ **红 2**（「谁的东西进谁的沙箱」这条不变量的**两个投影**：主用例 ＋「没 clone 过的成员不被建空目录」；
**无对照被误伤** ⇒ 属②类「整组红」，**不许写成①类恰红**）；**M4** 把找回的 ③ 授权与 ④ 配置**调换**
⇒ **恰红 1**（`-unconfigured.test.ts` 第 3 条，403 变 503；**restore 那 8 条全绿** ⇒ 这条次序**确实只有它
在钉**）；**M5** `markRestored` 的成对写拆开（只 `set archived = false`）⇒ **红 4**（所有「成功找回」的用例，
**同一根因**：库的 `project_archive_coherence_check` 真的拒了 ⇒ 500 ⇒ `json()` 先断 `content-type` 就红；
未授权/失败那 3 条仍绿 ⇒ 属②类）。每条改完即还原、复跑回绿。

**🔍 审查（2026-10-06，子代理，覆盖 runbook 六类；重点压「恒真/空断言」与「同形」声明是否属实）**：
**0 条「必须修」**；报出 F1–F7，处置见下。审查**逐项核实并判定成立**的关键项（这些不是我的自述，
是它对着被调方核过的）：① 「同形」①②③④⑤ **逐条打勾**（对着 `handleArchive` 的**全部**必填项，
不是凭直觉——`#004-07`）；② `ProjectIdBody` 确为两出口共用、`server.ts` **一行不动**属实
（第 330 行整段 `OpenhiveArchive.routes.pipe(…)`）；③ `decide` 语义与注释相符；④ `markRestored`
的「命中 0 行不可达」为真（全仓无任何代码 `delete`/`truncate` `auth.project_archive`）；⑤ 「标记最后落」
**有真有牙**（把 `markRestored` 提到 `restoreAll` 之前 ⇒ 恰红）；⑥ 测试 oracle **不经过被测对象**
（归档行走裸 SQL、MinIO 走 `fakeS3` 记录、沙箱走 `fs`）；⑦ 主判据**非空**（逐键全等能拦住「把 owner 的
备份铺给所有成员」）；⑧ `PATH.restore` 无路由冲突；⑨ 找回**只有一条出口**（`grep restoreAll`/`markRestored`
的非测试命中只在 `archive.ts`）。**处置**：

- **F1（覆盖不对称）已办，但据实改写**：审查的原判断是「补上 401 与畸形体两条即可对齐归档侧」。
  按 TDD 补完之后**取成牙证据，把它的框架修正了**（见本节末「追加变异」）：**畸形体那条有牙**（M7 恰红 1），
  **401 那条没有牙、且是结构性的**（M6 **全绿**；归档侧 M8 **也全绿**）⇒ 401 用例**保留**（它如实断言了
  出口级的性质），但如实记为缺口第 10 条，**不写成「产品码被钉住了」**。
- **F2（弱断言）已修**：`restore.test.ts` 里 **4 处** `expect((yield* 归档行(id))?.archived_at).not.toBeNull()`
  （行整个不见了时实得值是 `undefined`，那条**照样通过**）⇒ 抽成 `仍是已归档(id)` 助手，**先断 `行`
  `toBeDefined()`、再断 `archived_at`**，与 `-unconfigured.test.ts` 那条 ③ **同口径**（`#002-06`：
  同一个判断别在两处各写一份不一样）。审查标它「挂缺口」，按「同一口径两处不一致本身就是缺陷」当场修。
- **F3–F7 挂缺口**：F3 ⇒ 缺口 2（原已记）；F4 ⇒ 缺口 1（原已记）；**F5/F6/F7 ⇒ 新增缺口 7/8/9**。

**✅ 追加变异（2026-10-06，为 F1/F2 取成牙证据；按 `#003-03` 三类据实记）**：
**M6** 删掉 `handleRestore` 的 `if (Option.isNone(user)) return unauthorized()` ⇒ **全绿**（11/0）
—— ③类「白」，**根因查明是「不可达」而非「测试没覆盖」**（中间件先在）；**M7** 删掉 `handleRestore`
的 `badRequest("请求体要带 projectId")` ⇒ **恰红 1**（400 → 500，其余 10 条全绿）；
**M8** 删掉 `handleArchive` 的同一行 ⇒ 归档两文件 **全绿**（18/0）—— 与 M6 同因，
**这条同时更正了 T013 收尾时的理解**。M6/M8 按 ③类本应删码，**没删的理由已明写**（见缺口第 10 条）。

**🧭 门禁（T014 收尾，串行，2026-10-06）**

- `packages/opencode` 找回 **11 pass / 0 fail（106 expect）**；归档两文件 **18 pass / 0 fail（124 expect）**
  （T013 是 15 ＋ 2 ＝ 17，本题 ＋1 条）。
- `packages/auth` `src/project-member.test.ts` ⇒ **14 pass / 0 fail**。
- `packages/core` `bun test` ⇒ **1211 pass / 8 skip / 5 fail** ＝ 基线（5 条**按名比对**全是 `NpmConfig.*`，
  **无新增**，`#003-01`）。
- `packages/app` `bun run test:components` ⇒ **405 pass / 0 fail / 27 文件**＝基线（⚠️ **必须带
  `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`**，见下）。
- `bun run typecheck`（turbo）⇒ **31/31 successful，exit 0**。
- **文件级** oxlint（仓库根，`#004-10`，四个文件）⇒ **0 warnings / 0 errors / 130 rules / exit 0**
  （⚠️ 首跑 1 warning：新测试里 `test` import 未使用 ⇒ **当场清掉、不留账**）。
- `bun run lint:openhive` ⇒ **exit 0**（**23 warnings / 0 errors / 161 rules** ＝ 基线，本次文件 0 命中）。
- `bun run lint` ⇒ **本次 4 个改动文件 0 命中**（全局 4953 warnings / 1 error / 3513 files，那 1 error 仍是
  `#001-02` 记的上游 `session-ui` 文件，裁定不私改）。
- `git diff --stat bun.lock` **为空**。

**⚠️ 一条工具怪癖复现（T018 记过，本次又撞上）**：`test:components` 在**启用默认运行时转译缓存**时本次实测
**257 pass / 3 fail / 3 error**（`Expected JSX element name but found "?" at
…/file-icons/sprite.svg:1:2`，级联出空白 `# Unhandled error between tests`），而
`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` ⇒ **405 pass / 0 fail / 27 文件** ＝ 基线。**先怀疑测量**（`#003-01`）：
本题**零前端改动**，那 3 红与代码无关。

**⚠️ 缺口 / 挂账（`#002-02` / `#004-03`，写明免得看着像覆盖）**

1. **MinIO 下载没有重试 / 超时 / 熔断**——与上传（T013 缺口第 6 条）同款，全项目一致的缺口。
   大项目找回时一次外呼抖动 = 整个请求 500（可重试，因为标记最后落），但**没有退避**。本轮没做。
2. **找回的写入方向没有符号链接守卫**：归档那侧有 `filesUnder` 的 `lstatSync`（**读**方向，S2-01），
   而 `restoreAll` 是**写**方向——`mkdir` / `writeFile` 若碰到沙箱里已有的符号链接会**跟随**它写到别处。
   今天的触发面很窄（找回的前提是 `releaseAll` 刚删过整个目录），但**没有测试钉着**，如实记为缺口。
3. **`restoreAll` 的重入 / 部分成功语义未测**：标记没落时重试 = 重下一遍（覆盖同路径文件）。
   判据是「幂等」还是「覆盖」没验过，也没写测试。
4. **T015 仍待做**：本题只证明 `decide` 在**找回这条链**上把 member / 非成员都拦住了；
   「归档后成员失权」的**正向出口**（成员访问文件 / 会话时的拒绝）归 T015。
5. **FE 的找回入口零认领** ⇒ 与归档入口同归 **T023**（出口存在但**没有按钮**，生产里找回**点不到**）。
6. **`fake-s3.ts` 的「生产不得 import」仍无门**（T013 缺口第 8 条，本题未动）。
7. **`restoreAll` 的 `get === undefined ⇒ throw` 那条分支本地测不到**（审查 F5，2026-10-06 实测）：
   `fake-s3` 的 `list` 与 `get` 读**同一份 `objects` map** ⇒ 造不出「list 见到、get 见不到」；
   `failOn` 只回 `<Code>InternalError</Code>`、不是 `NoSuchKey`（也就不会被 `Minio.get` 折成 `undefined`）。
   ⇒ 那个 `throw` 的**语义方向是对的**（fail-closed，`minio.ts` 只把 `NoSuchKey` 映射成 `undefined`），
   但它是**未验证的分支**、不是「已被覆盖的刻意选择」——注释里当初把它写成了后者（`#002-02`）。
8. **空目录不还原 ⇒ 往返不是逐字节「完整还原」**（审查 F6）：归档侧 `filesUnder` 只收 `isFile()`
   （空目录没有对象），找回侧只按对象键写 ⇒ 沙箱里一个**空目录**会在往返后消失。T013 已把
   「空目录不备份」记进自己的缺口表，但 T014 的 `restoreAll` 注释**没有重申**——读 FR-009 的
   「MinIO 文件全部下载回沙箱」时容易误以为已闭合。
9. **「八步与归档逐条同形」只靠复制粘贴维持**（审查 F7）：守卫序列是**两份拷贝**（只有
   `badRequest`/`forbidden`/`unavailable`/`ProjectIdBody`/`asRole` 抽成了公共），而全仓只有
   `-unconfigured` 那条 ③ 钉住 ③④ 的**先后** ⇒ **单侧漏改**（漏掉成员 id 循环、漏掉 `userId` 的
   `die`）**不会有任何测试变红**。这正是本文件头自己引的 `#002-06`，也是 `#004-02` 说的
   「两个投影必须有一条故意会红的相等断言」——**今天没有那条断言**。
10. **handler 里的 401 守卫是「纵深防御」、不是被测行为**（审查 F1 ＋ 2026-10-06 实测）：
    `handleRestore` **和** `handleArchive` 的 `if (Option.isNone(user)) return unauthorized()`
    整行删掉，**两边测试全绿**（找回 11/0、归档 18/0）——因为 `user-identity.ts` 中间件在进
    handler **之前**就把无身份请求回成 401，而 `OpenhiveArchive.routes` 全仓**只有一个挂载点**
    （`httpapi/server.ts`，且在那条链里）。⇒ 「没身份 ⇒ 401」这条性质**是出口级的、由中间件保证**，
    handler 里那行**不可达**；照 `#003-03` ③类本应删码，但**没删**——它与归档侧逐条同形是整条链的
    骨架，单删一侧会让两个 handler 悄悄分叉（**这是一条明写的判断，不是「忘了」**）。
    ⚠️ **顺带更正 T013 收尾时的理解**：那条「不带凭证 ⇒ 401」的用例当时被读成「钉住了 handler 的
    守卫」，实测**不成立**——它钉的一直是中间件。

### T015 · 归档 = 冻结（FR-010）：两道门 ✅（2026-10-06）

**交付（三个提交）**

| 提交 | 是什么 |
|---|---|
| `2862dcaed6` | `refactor(005)`：建 / 列项目、归档 / 找回原先**各持一个惰性池** ⇒ 收成 `OpenhivePg.layer`（**一个应用层一个池**）。按 `CLAUDE.md`「定制单独提交」办 |
| `403ad2fafb` | `feat(005)`：core 的 `frozen` ＋ `project-location.ts` **两道门** ＋ 新测试文件 8 条 |
| `8976cc5b5f` | `fix(005)`：第二轮对抗证伪实测出的 **F1（Critical）**——第二道门不能被「再带一个项目头」解除 |

判定本体**没有新写一份**：core 的 `ProjectMembership.frozen(archived)` 与 T013/T014 用的 `decide` 是**同一条规则的
两个投影**，等值关系由 `packages/core/test/project-membership.test.ts` 的 T015 组**故意会红**地钉着——遍历
`PROJECT_ACTIONS` × `archived ∈ {true,false}` × 三种 actor，断言「`frozen(archived)` ⟺ 归档态下**没有任何**
非 `restore` 动作成立」（`#004-02`：两个投影之间必须有一条故意会红的相等断言）。

**🔒 四笔裁定（2026-10-06，用户）**

开工前**三笔**（均取推荐项）：

1. **冻结射程 ⇒ 延伸：已归档一律拒（含 owner）**——把「归档 = 冻结」这条收紧口径延伸到「在项目里干活」
   （建会话 / 读写文件）这个出口。与 T004 的裁定同一条。理由：沙箱文件已上传 MinIO 并删除 ⇒ 放行只会把
   **空目录**重建出来，把「归档」变成半个撤销。⚠️ 风险如实记：将来 T022 的 MinIO 浏览若也带这个头会被挡
   （今天它前置不齐，且可改成不带头的另一种定位方式）。
2. **门的位置 ⇒ `middleware/project-location.ts` ＋ 403 JSON**——该头服务端**唯一**的消费者，一次覆盖
   会话 / 文件 / pty / 上传全部出口（正是 `#004-01` 的锚法：锚在「做那件事的那一行」）；403 ＋ JSON 与
   归档 / 找回同一口径（`{ error }`，前端读得懂）；该文件本来就是 **fork 文件**（T017 产物），是「加」不是「改」。
3. **判据落点 ⇒ 查一次 `project_archive`，判据与 `decide` 同文件**——用现成的 `archiveStatesOf`（单元素）
   ⇒「归档 = 冻结」仍然只有**一处定义**。代价：每个带头的请求多**一次** PG 往返。
   **否掉的两条**：走 `decide`（中间件还得再查一次 `project_member` 拿角色 ⇒ 每请求**两次**往返，而「角色」
   这半条判定今天**没有真实消费者** ⇒ 现在写就是猜形状，`#004-07`）；在中间件里直接 `if (archived) 403`
   （「归档 = 冻结」变成两处各写一份，`#002-06`）。

开工后**第四笔（D1 处置）⇒ 本 feature 内补第二道门**：起因是我自己复核出的一条旁路——「建会话时带了头、
以后用这个会话**不必再带**」：会话作用域那条链的实例目录取自**会话行**（上游 `workspace-routing.ts` 的
`session?.directory || defaultDirectory(...)`）⇒ 归档后它照样在那个（已被 T013 删掉的）目录里跑。补法见下。

**⚠️ 实现要点**

- **两道门，一句话分工**：带 `x-openhive-project` 的请求 ⇒ 第一道门；**目录来自会话行**的那一半 ⇒ 第二道门。
  两者共用同一个 `isArchived()`（**唯一取用点**）⇒「缺归档行 ⇒ 未归档」那个 `?? false` 只有一处会漂，
  与 T018 列表那条「没有归档行 ⇒ 省略 `archived` 键 ⇒ 前端读作活跃」是同一条口径。
- **第二道门与「带不带头」无关**（`8976cc5b5f` 之后的形状）：`MatchedRoute.current` 的 `params["sessionID"]`
  （**不拿 URL 原文比对**——`R-01`/`R-02` 证明 `/session/ses_x/message/`、`%61`、`;x` 都匹配同一条路由）
  ⇒ `session.get(...)` 拿目录 ⇒ `relative(沙箱根, 目录)` **恰好两段**且第一段 = 本人 id ⇒ 查归档 ⇒ 403。
  会话不存在 ⇒ 放行（`Effect.option` 只吞**类型化**的 `NotFoundError`；DB 真炸是 `orDie` 的缺陷、照样 500）。
  连带语义：**归档项目的会话整体冻住**（连 `GET /session/:id` 也 403，不只「在它里面跑提示词」）。
- **次序是裁定的，不是随手排的**：第一道门的归档检查排在 R5（`project === undefined` 直通）**之后**——
  便宜的 SQLite 读先排除外人 / 幽灵项目，再付 PG 往返；PG 挂掉时未知项目的请求仍走 R5 而不 500。
  代价已记缺口（下表第 7 条）。
- **本次唯一的上游侵入面**：`Session.Service` 进了中间件的 `requires`（本层是 fork 文件，`workspace-routing.ts`
  **一字未动**）。用 `Session` 而不是自己查 `SessionTable`：那是生产真正走的读法，不该有第二份实现。
- **`OpenhivePg` 刻意不是模块级单例**：模块级在「多文件一起跑」时**必红**（第二个文件会用上第一个文件那个
  已在 `afterAll` 里停掉的库，**实测 10 fail**）；层记忆化既保证共享、又让每个测试文件拿回自己那个库。
  动因是**夹具失真**——PGlite 夹具的预编译语句是**实例级**的，两个客户端跑同一句 SQL 文本撞
  `42P05 duplicate_prepared_statement`（症状 500、与判据无关、谁先跑谁赢）；收成一个池让被测的形状回到
  生产形状（一个进程一个池服务所有请求）。
- **T023 接线告诫**：**别给「找回」的调用带项目头**——归档 / 找回那两条管理链也在本层的下游，带了头，
  已归档的项目**再也找回不了**（见缺口表第 10 条）。

**✅ 变异验证（串行，按 `#003-03` 三类据实记；每条改完即还原、复跑回绿）**

| 变异 | 改法 | 结果 | 类 |
|---|---|---|---|
| M11 | 删掉第一道门的归档检查整行 | **整组红 4**（①②③⑤ 红、④⑥⑦⑧ 绿）| ② |
| M10 | 第二道门挂回 `if (projectId === undefined)`（= 恢复 F1 的 bug）| **恰红 1**（用例 ⑧）；**两式诱饵分别见证** | ① |
| M5 | 拆掉第二道门 | 恰红 1 | ① |
| M6 | 会话目录推导恒 `undefined` | 恰红 1 | ① |
| M7 | `?? false` → `?? true` | 恰红 2（用例 ④ 与 ⑦——共享默认值的两个出口各一条）⚠️ **加用例 ⑧ 之前**的快照 | ① |
| M8 | `params["sessionID"]` → `["sessionId"]` | 恰红 1（参数名被钉住）| ① |
| M9 | 去掉「第一段必须等于本人 id」那道防线 | **全绿 7/0** ⇒ **测不到** | ③ |

M9 的处置是**留着 ＋ 记成缺口**（不是删码）：它是让判定**自己站得住**的等式（不依赖一条没说出口的上游
不变量），理由写在该函数的 JSDoc 里。M10 的两式诱饵：把诱饵① 临时换成会话所属的已归档项目头 ⇒ 执行推进到
诱饵②、红在它那里 ⇒ **两式各自有牙**。

**🔍 审查与修复（`#003-02`：把「修复本身」再当靶子打一轮，换视角）**

- **第一轮三席**纠正了三处**不实记述**（都属 `#004-03`「写『有 X 钉住』之前先核」）：
  ① 「403 vs 503 的差 = 门排在 handler **之前**」是**假的**——那个差只证明「门在**不在**」（门若排在 handler
  **之后**，带头这一枪同样是 403：handler 先跑、回它自己的 403 / 503，门根本没机会）；② `project-location.ts` 里
  「owner 行与 `project_ext` 行同生共死」按字面是**假的**（成员今天就没有 `project_ext` 行，而项目完全可能已归档）；
  ③ `membership.ts` 表里写的接线文件 `packages/opencode/src/project/member.ts` **不存在**，实为 `archive.ts`
  （`decide`）＋ `project-location.ts`（`frozen`）。
- **第二轮两席**：
  - **对抗证伪席**（「还有没有别的出口能绕过归档冻结」）实测出 **F1 → Critical**：第二道门第一版挂在
    `if (projectId === undefined)` 里 ⇒ **「请求有没有说自己属于哪个项目」被当成了「要不要问会话行」的开关**。
    带**任意**一个不是「已归档项目」的头（一个查不到的 id ⇒ 第一道门走 R5 直通；**本人名下的活跃项目** ⇒
    第一道门按它放行**并改写目录**），归档项目里的旧会话就照常干活。实测：同一个归档项目、同一条会话、
    同一个应用，**只差一个诱饵头**，**403 → 200**。
    ⇒ 修复 = `8976cc5b5f`（那段从 `if` 里提出来、**无条件先问会话行**）＋ 用例 ⑧（两式诱饵各断一遍）
    ＋ 文件头两处改准（「没有项目头 ⇒ **不改写**请求」，不再是「一次都不碰 / 连库都不查」）
    ＋「已知不覆盖」补四条。同席另登记 **F3–F7**（参数名 fail-open / pty 走 `ptyID` / 缺失归档行的默认值
    三处各写一份 / 第一道门排在 R5 之后），**均进缺口表，不写成已覆盖**。
  - **横切与上游侵入面席**（结论已回，2026-10-06）：它**独立从 `7c3596e34e..403ad2fafb` 的代码推出了 F1 的机制**（与对抗证伪席同结论），并逐条判了六类。**已修**：**R2**（见下）。**新增缺口**：**R3 / R4**（会话身份不在 `params["sessionID"]` 里的那类出口）＋ **R6**（前端丢掉 403 的 JSON 体）⇒ 已补进缺口表第 11/12 条，并按用户裁定**补编号 T025**。**判为「无发现」**：R9（迁移，本次无 schema/数据改动）、R10（防御性编码，两道门都用 `Effect.option` / 显式 `?? false`，未见吞错）。**R7 上游侵入面**：逐 hunk 核对 ⇒ T015 在 `server.ts` 的改动**全是「加」**（三处 `Layer.provide(OpenhivePg.layer)`）；`git diff upstream/dev --stat -- server.ts` 的 94 insertions / 1 deletion 里，那 1 处删除是**上一 feature** 对 provide 数组的排版；`middleware/workspace-routing.ts` **未被改**（与提交信息相符）。**它另做了一件我没做的实测**：把 `pg.ts` 临时改回模块级池 ⇒ 归档＋找回两文件 **16 pass / 10 fail**（与 `pg.ts` 文件头「实测 10 fail」吻合），并由此**补了 `#004-11` 的边界**——**同一次 `bun test` 里模块级状态跨文件共享，而 `globalThis` / `process.env` 不共享**。**它明确标了「未实测」**：R3/R4 的端到端利用、R6 的浏览器行为、`projectIdOfSessionDirectory` 的「本人 id」那半、真 PG 下的池共享、pty 出口，**以及 `8976cc5b5f` 之后的运行行为**（它只读了 diff，8 pass 等数字取自提交信息）——本节不把那几处当已覆盖。
  - **R2（Important —— 本门**自己引入的**回归）已修（提交 `9affc63b86`）**：第二道门拿**客户端说了算**的路由参数去 `SessionID.make()` 造带 brand 的会话 id，而 brand 检查（`packages/schema/src/session-id.ts` 的 `isStartsWith("ses")`）**失败是同步 throw** ⇒ 在 `Effect.gen` 体内变 **defect** ⇒ **500**（`Effect.option` 只接 typed failure，接不住它）。实测：`GET /api/session/foo` 在本门之前是 **400**（handler 的口径 `{"_tag":"InvalidRequestError","field":"sessionID"}`），加了本门后变 **500**；影响面**不是个例**——所有带 `sessionID` 路由参数的 `/api/*` v2 请求都经过这一行（本节上面八条用例全走它）。**TDD**：用例 ⑨ 先红（`Expected: 400 / Received: 500`，**8 pass / 1 fail**，只它红 ⇒ 该次 RED **同时是成牙证据**），再把 `if (sessionID !== undefined)` 改成 `if (sessionID !== undefined && Schema.is(SessionID)(sessionID))` ⇒ **9 pass / 0 fail / 29 expect**。⚠️ 修法**刻意不写 `startsWith("ses")`**：那是把 schema 的判据镜像一份到本文件（`#003-05`），上游改前缀/改哈希时这里**不报错、不变红，只会静默放行本该被拦的会话**（正是本门要防的方向）。
- 我按 `#004-08`（「没报错」≠「执行了」）与 `#004-14`（一用例内按「被测属性 → 伴随信号 → 对照」排）复核了
  8 条用例的断言顺序：主判据（**一条会话都没落盘** / 草稿没进模型）在**前**、伴随信号（403）在后。
  用例 ⑦⑧ 的「归档前 200」是**前置条件**（时间序逼的），已**断死在状态码上**——这条取舍写在该用例的注释里。

**🧭 门禁（T015 收尾 ＋ F1 修复 ＋ R2 修复后，串行，2026-10-06）**

| 项 | 数字 |
|---|---|
| `packages/opencode` 受影响 7 文件 | **57 pass / 0 fail / 350 expect**（T015 前基线 55 / 342，本题 ＋2 用例）|
| 新文件 `openhive-project-frozen.test.ts` | **9 pass / 0 fail / 29 expect**（用例 ⑨ 是 R2 修复的 RED）|
| `packages/core` `test/project-membership.test.ts` | **17 pass / 0 fail** |
| `bun run typecheck`（turbo） | **31/31 successful，exit 0** |
| 文件级 oxlint（仓库根，`#004-10`） | **0 warnings / 0 errors / 130 rules / exit 0** |
| `bun run lint:openhive` | **exit 0**（**23 warnings / 0 errors / 161 rules** ＝ 基线，本次文件 0 命中）|
| `bun run lint` | 本次改动文件 **0 命中**（全局仍那 1 个已登记的上游 error，裁定不私改）|
| `packages/app` `bun run test:components` | **405 pass / 0 fail / 27 文件** ＝ 基线（本题零前端改动）|
| `git diff --stat bun.lock` | **为空** |

**⚠️ 缺口 / 挂账（`#002-02`：没覆盖的写成缺口，不写成已覆盖）**

1. **M9 那条防线测不到**（`#003-03` ③类）：造不出「会话目录落在别人沙箱」那样一条会话行 ⇒ **留着 ＋ 标注**。
2. **「门排在 handler 之前」在管理类链上测不出来**（`#004-09`）：那条链没有副作用可当观测面。建会话那条链上
   是**测过**的（用例 ①②③ 断的是**落盘目录**）。要补得先给管理类链造一个门之前就能读到的副作用（`#004-13`）。
3. **第二道门只认「恰好一层」目录**：`…/{projectId}/sub` 不认、放行。今天到不了那条路；真要支持子目录会话，
   改这里的同时得补用例。
4. **参数名 fail-open**（F3）：第二道门靠 `params["sessionID"]` 认出入境 ⇒ 上游给任一条链改名、或新增第三条
   会话链用别的名字 ⇒ 读不到 ⇒ **静默放行**，不报错、不变红。今天全仓会话作用域出口（两条链的 session /
   message / permission / question / background）都叫这个名字，其中两条 GET 各有用例钉着；**其余出口与将来
   新增的链**没有人守。
5. **pty 不在第二道门射程内**（F7）：它走 `ptyID`（`packages/server/src/handlers/pty.ts`），不带 `sessionID`
   参数 ⇒ 归档**前**在项目目录里建出来的 pty，其 cwd 仍指着那个（已被 T013 删掉的）目录。利用面弱（进程级、
   目录已删），**未实测**，登记为同族出口。
6. **「缺归档行 ⇒ 未归档」有三处写法**（F4）：两道门共用的 `isArchived`（刻意收在一处）、归档链 `decide` 的
   输入、T018 列表的键缺席 ⇒ 今天同口径，但**没有**一条断言把三处钉在一起。
7. **第一道门的归档检查排在 R5 之后**（F5，**裁定的次序**）：请求头指向一个**已归档**项目、而请求方在该项目
   **没有** `project_ext` 行时，走 R5 ⇒ **200 落沙箱根**（不是 403）。不构成对项目目录的访问，但与「已归档
   ⇒ 一律 403」的字面不一致；改它要动次序（每次无 `project_ext` 行的带头请求多一次 PG 往返）。
8. **第二道门的开销**：会话作用域请求多一次会话行读（本地 SQLite）＋可能一次归档查询。**安全换成本**，如实记。
9. **「归档项目会话整体冻住」的连带后果**：连 **owner 读自己归档项目里的会话**也是 403（裁定延伸的一致读法）。
10. **T023 的入口规矩（移交项）**：归档 / 找回入口接线时**别给找回的调用加项目头**——加了就再也找回不了
    （`#002-04`：移交项要落进接收方的表；此条同时写在 `tasks.md` 的 T015 与 T023 两处）。
11. **会话身份不在 `params["sessionID"]` 里的那类出口**（第二次审查 **R3 / R4**，**用户裁定「挂缺口 ＋ 补编号 T025」**）：第二道门按**路由参数**认出入境，于是四条出口在射程外——`POST /api/permission/:requestID/reply` 与 `/api/question/:requestID/reply|reject`（会话身份在**资源 id**）、`POST /api/sync/steal` 与 `/api/experimental/workspace/warp`（会话身份在**请求体**）。后果：已归档项目会话里**挂起的工具审批仍能被放行**（＝给那个冻结的会话放行一次工具执行），`steal` / `warp` 也照旧能写。
    ⚠️ **这是本 task 数漏出口的形态**（`#004-01`）：数的是「带 `sessionID` 参数的路由」，而闸门该锚的是「**做那件事的那一行**」（这里＝「这个请求实际会作用在哪个会话上」，而会话身份可以出现在参数、资源 id、请求体三处）。
    ⚠️ **端到端利用未实测**（审查只到「路由定义与参数名逐条核对」这一层），且实操面被 T013 削弱：项目沙箱目录归档时已删，被放行的工具落地会撞 `ENOENT` ⇒ **真缺口、但非已知可利用**，如实记（`#002-02`）。归 **T025**。✅ **T025 已收尾（2026-10-06）**：permission 出口实测为「出参已由**实例口径**达成、原设想中间件是 **no-op**」⇒ **只钉属性、不加门**；`question` 属**推断**、`sync`／`warp` 仍**挂缺口**，见「已完成 → T025」。（⚠️ 本条原文把四条路径写成 `/api/...` 前缀，实测是 **v1 裸路径**，已在 `tasks.md` 的 T025 条目改正。）
12. **前端丢掉 403 的 JSON 体**（R6）：`packages/app/src/project/openhive-files.ts` 只把 `!response.ok` 折成 `false`（返回 `undefined`）⇒ 后端那句 `{"error":"项目已归档，请先找回"}` **到不了 UI**。今天「前端能把这句话直接显示给人看」**不成立**；T023 接归档/找回入口时要一并处理（本 task 零前端改动，故挂账）。

### T025 · 「归档 = 冻结」射程外的那类出口：实测为「只钉属性、不加门」（2026-10-06）

**性质**：T015 缺口表第 11 条（第二次审查 R3/R4）的认领 task。原设想＝给这些出口**补一条端点级中间件**。

**取数（2026-10-06，实测，已固化成用例）**：出参**已经达成**——达成它的**不是**中间件，是 **`Permission` 的实例分桶**。

| 答复姿态 | 实例目录 | 状态 | 审批被消费 | 那一轮继续 |
|---|---|---|---|---|
| 无头 | 沙箱根 | **404** `PermissionNotFoundError` | 否 | 否（模型只被调 1 次） |
| 诱饵头（ACTIVE） | `{沙箱根}/ACTIVE` | **404** | 否 | 否 |
| 真头（FROZEN） | `{沙箱根}/FROZEN` | **403**「项目已归档，请先找回」 | 否 | 否 |
| 解冻后 ＋ 真头 | `{沙箱根}/FROZEN` | **200** | **是** | **是（第 2 次）** |

机制：`packages/opencode/src/permission/index.ts` 的 `State = { pending: Map<…>, approved: […] }` 挂在
`InstanceState.make` 上，而 `InstanceState` 按 `ctx.directory` 分桶（`packages/opencode/src/effect/instance-state.ts`
的 `directory` / `get`）。会话在项目目录里挂起审批 ⇒ pending 记在**那个实例**；答复请求按**它自己所在**的实例去查
⇒ 只要答复方落不到会话那个实例，就查不到。

**⚠️ 原设想的端点级中间件是 no-op**：它在**同一实例**里调 `Permission.list()`，而跨项目的 pending 不在该实例 ⇒
列表恒 `[]`。所以「加门」既加不进去、也不需要 ⇒ **用户裁定：只钉属性、不加门**（生产代码 0 行、上游文件 0 处）。

**哪两道门管不着它**：
- 第一道门（`x-openhive-project` 头那条）**够不着**会话：它按头改写实例目录，但这条出口没有头可带（带了也只会落到
  另一个实例，仍是 404）；带**诱饵头**（本人名下的活跃项目）实测同样 404。
- 第二道门（`params["sessionID"]` 那条）**根本不跑**：这条路由的 `params` 里只有 `requestID`（会话身份在资源 id 里，
  不在参数里 ⇒ 正是 T015 缺口第 11 条说的射程外）。

**为什么「无头 404」也算数（判据形状）**：404 的成因是「这个实例里没有这条 pending」而不是「你没权限」——但它**同样
是「放行不了」**（那条挂起的工具执行没被放行、那一轮没有继续）。出参达成，只是**达成的方式**与原设想不同
（**实例口径**而非**端点口径**）。

**用例（`packages/opencode/test/server/openhive-project-frozen-pending.test.ts`，新，2 条）**：① 主——FROZEN 项目里
挂起一条审批，三种姿态都放行不了 ＋ 那一轮没继续 ＋ 解冻后真头列表里**它还在**（没被消费）＋ 对照：真头答复 200 才消费、
那一轮才继续；② 对照——**无头**建的会话（沙箱根），无头答复 **200**（证明机制是活的，`#004-08`：副作用类判据要先有
对照证明机制活着）。

**⚠️ 缺口 / 挂账（`#002-02`）**
1. **`sync/steal` 与 `experimental/workspace/warp` 未实测**：会话身份在**请求体** `sessionID` 里（`payload: SessionPayload` /
   `WarpPayload`），既不在路由参数、也不在资源 id。它们**不**经过 `Permission` 的分桶 ⇒ **很可能真的没有门**（原 R4 的
   判断），但 T025 未实测，如实挂账。实操面同样被 T013 削弱（项目沙箱目录归档时已删）。
2. **`question` 出口（`POST /question/:requestID/reply|reject`）同形属**推断**：路由形状与 permission 同款（同样只有
   `requestID` 参数），挂起态**预期**也走 `InstanceState` 分桶，但**未实测**，如实记为推断、不写成已覆盖。
3. **42P05 夹具假红**（见下）——生产不会撞，是夹具产物。

**★ 测试过程中的一枚假红：`42P05 duplicate_prepared_statement`**（2026-10-06，值得单独记一条）
- **症状**：第一版夹具用「fork 那一轮 ＋ 每 100ms 轮询 `GET /permission`」，**稳定**假红——被 fork 的那一轮 **15ms 就回
  500**，长得像「门在并发下崩了」。
- **真因**：`PostgresError errno "42P05" / routine "StorePreparedStatement" → prepared statement "…project_archive…"
  already exists`。**PGlite 的预编译语句名是实例级的**（socket 服务端把多条连接汇进同一个 PG 会话），所以同一进程里
  **两个并发请求撞同一句 SQL** 就 500。触发条件＝「被 fork 的那一轮（第二道门）与第一次轮询（第一道门）**同时**准备同一句 SQL」。
- **生产不会撞**：生产是**多连接池**（`packages/auth/src/db.ts` 的 `connect` = `drizzle({connection:{url,…}})`，注释写着
  「只落在池里那一条连接上，其余连接照旧」）⇒ 这是一枚**夹具假红**（`#003-01`：先怀疑测量，再怀疑被测物）。
- **修法**：夹具改成**先在进程内等**（等假模型被调用，一个 HTTP 都不发），再发列表请求；此时那一轮已阻塞在 `Permission.ask`，
  不再碰门。**别把它改回紧轮询**（测试文件头有醒目注释）。
- **建议（本轮按裁定**不改**生产码）**：给 `packages/opencode/src/server/openhive/pg.ts` 的文件头（那里已记过**两个客户端**
  版本的同一枚 42P05）补一句「**并发**（同一进程两个并发请求）也会撞」，免得下一个人再花一轮定位。

**🧭 门禁（T025，串行，2026-10-06）**

| 项 | 数字 |
|---|---|
| `packages/opencode` 同族 8 文件 | **59 pass / 0 fail**（archive 15 / archive-unconfigured 3 / frozen 9 / restore 11 / project 10 / directory 8 / member-closed-set 1 / frozen-pending 2）|
| 新文件 `openhive-project-frozen-pending.test.ts` | **2 pass / 0 fail / 32 expect**（连跑 3 次稳定，~39s）|
| `bun run typecheck`（turbo） | **31/31 successful，exit 0** |
| 文件级 oxlint（仓库根，`#004-10`） | **0 warnings / 0 errors / 130 rules / exit 0** |
| `bun run lint:openhive` | **exit 0**（23 warnings / 0 errors ＝ 基线，本次文件 0 命中）|
| `bun run lint` | 本次新增文件 **0 命中**（全局 4953 warnings / 1 error ＝ 已登记的上游 `prompt-input/index.tsx:163`，裁定不私改）|
| `git diff --stat bun.lock` | **为空** |

**变异验证（`#003-03` 三类据实记）**
- **M2**（`instance-state.ts` 的 `directory` 换成常量 ⇒ 全应用单桶）：**整组红、含夹具**（`等模型开口` false，0 pass /
  1 fail / 3 expect）⇒ 属 `#003-03` **第②类**，**不证明判据有牙**（红在夹具）。
- **M3**（`permission/index.ts` 的 `pending` 拉成模块级 ⇒ 审批不再按实例分桶）：**恰红目标那一条**——无头答复由 404 变
  **200**（放行了），红在用例 ① 的首条断言，**0 pass / 1 fail / 8 expect**，只它红 ⇒ `#003-03` **第①类**。
  ⚠️ 记一处形状：**调序前**这条红是 `SchemaError: Expected object, got true`（我的断言先解 `NotFound`、而实得是成功体
  `true`）；按 `#004-14` 把**状态码排到正文字段之前**后，红变成可读的 `Expected: 404 / Received: 200`。
- **两处变异均已还原**（`git diff` 对 `src/` 为空）。

### T016 · 会话彻底私有（FR-011）＋ 文件并发靠 git（FR-012）：实测为「钉属性、零生产代码改动」（2026-10-06）

**性质**：`[BE] 验证` 任务（同 T025 的形态）。出参两半：**owner 看不到 member 会话**／**git 留痕**。

**落地**：新建 `packages/opencode/test/server/openhive-project-shared.test.ts`（**5 条 · 55 expect**，全绿）。
`git diff packages/*/src` **为空**——两半属性**都已达成**，本条只把它们钉住（`FR-011` 由 003 的每用户库路由达成、
`FR-012` 由 T018 建的裸仓库 ＋ git 本身达成）。harness 与 `openhive-project.test.ts` 同源（`#004-12`）。

**判据点（为什么这样切）**
- **FR-011 钉的是「共享项目里的 owner 与 member」**，不是重述 003：`tenant-db-isolation.test.ts` 钉的是**任意两个用户**
  的跨库不可见；共享项目引入了一条**新的潜在泄漏路径**（「共享项目 ⇒ 会话也共享」），那正是 FR-011 要挡的。
  四条用例：**对照**（owner 带项目头 ⇒ 头生效，证明机制是活的）／双向 404 ＋ 双向列表（含「看得见自己的」那半）／
  **直接读两个库文件**（HTTP 那两条证端点、这条证存储，`#004-09`）／**共享根下只有 `<projectId>.git`**（FR-011 的反面：
  共享项目**不产生**共享存储；断言写成「非 `.git` 条目为空集」并**带警报语义** `#004-02`）。
- **FR-012 一条用例走完整流程**（流程本身就是被测的那一件事）：两个检出各自 commit ⇒ 第二个 push **被拒（非快进）**
  ⇒ merge **出冲突**（冲突文件用 `git diff --diff-filter=U` 自己列的为准）⇒ 解冲突后 push **成功** ⇒ **第三个检出 clone
  下来两次提交都在**。顺带钉住 FR-012 后半句「不做实时协同」：甲推上去后，**乙不动手就看不见**。
  oracle 是**第三个检出**，不是「拿 `--git-dir` 窥探仓库内部」——后者假设了裸布局，而「新成员 clone 得到什么」才是留痕的本意。
- **git 那半走上游 `Git` 服务、不自己 `spawn`**（照 `project.ts` 的 `gitInit` 注释：那串 `-c core.autocrlf=false` 等
  必须与生产一致；本机 `core.autocrlf=true`，`LEARNINGS #003-07`）。提交身份走 **env** 且**给死**（`extendEnv: true` 会合并）
  ——否则测试会依赖这台机器的 `~/.gitconfig`。

**★ 两条实测发现（都不在本条出参内 ⇒ 挂账，不在这里修）**

1. **成员带项目头会被**无声**忽略**（探针实测，2026-10-06，探针文件已删）：

   | 请求 | 状态 | `projectID` | `directory` |
   |---|---|---|---|
   | owner 带 `x-openhive-project: <共享项目>` | 200 | 项目 id | `{workspaces}/{ALICE}/{projectId}` |
   | **member** 带同一个头 | 200 | **`"global"`** | `{workspaces}/{BOB}`（**没有项目段**）|
   | member 不带头 | 200 | `"global"` | 同上 |

   机制：`project_ext` 是**个人态**，T018 只给**创建者**写那一行 ⇒ 成员那头查不到 ⇒ 中间件**静默退回沙箱根**
   （T017 的文件头早写过这个退化路径，这是它在会话链上的第一个实例）。**后果**：「成员进不去共享项目的目录」——
   而这**正是** FR-012「两个检出」缺的那只脚：成员那几个检出**由谁建**（clone 到 `{沙箱根}/{memberId}/{projectId}`？）
   在 `tasks.md` 里**仍然零任务认领**（T016 是纯验证、T018 的范围是创建者那一次）。**修它 = 给成员建 `project_ext` /
   沙箱目录 = 新能力**，属 T018 / T021 地界 ⇒ **本 task 不补**。⚠️ 因此用例里**不用带头的会话**去钉隔离：那会把一个
   **退化路径**当成预期行为钉死（`#002-02` 的反面）；带头的只有对照那一条。
2. **「必须是裸仓库」只有一道防线**：把 T018 的 `["init","--bare","--quiet"]` 里的 `--bare` 拿掉，**①–⑨ 全绿**
   （非裸仓库的当前分支是那个**未出生**的默认分支，我们推的 `trunk` 不是它 ⇒ `receive.denyCurrentBranch` 拦不住）。
   即 Q2 裁定那个字面**只**挂在那一条断言上。已把这句话写进用例注释，免得后手当它装饰删掉。

**门禁（串行跑，`#003-01`）**

| 项 | 结果 |
|---|---|
| 新文件 `openhive-project-shared.test.ts` | **5 pass / 0 fail / 55 expect**（~22s）|
| `packages/opencode` 同族 9 文件（含 003 的两条租户隔离） | **69 pass / 0 fail / 446 expect** |
| `bun run typecheck`（turbo） | **31/31 successful，exit 0** |
| 文件级 oxlint（仓库根，`#004-10`） | **0 warnings / 0 errors / 130 rules** |
| `bun run lint:openhive` | **exit 0**（23 warnings / 0 errors ＝ 基线，本次文件 **0 命中**）|
| `bun run lint` | 本次新增文件 **0 命中**（全局 4952 warnings / 1 error ＝ 已登记的上游 `prompt-input/index.tsx:163`；**总计数 ±1 抖动**，`#001-01`）|
| `git diff --stat bun.lock` | **为空** |

**变异验证（`#003-03` 三类据实记）**
- **M1**（`packages/core/src/database/router.ts` 的 `forUser(user.value.id)` ⇒ 换成常量，即路由不看身份）：
  **3 红 / 2 绿**——红的正是三条**声称隔离**的用例（对照 / 双向 / 读库文件），**共享根那条与 git 那条不动**。
  含「对照」一起红 ⇒ `#003-03` **第②类**（整组红），据实记，不当第①类。
- **M2**（T018 的 `git init --bare` ⇒ `git init`）：**恰红 1 条**（FR-012 那条），红在 ⓪ 的
  `rev-parse --is-bare-repository`，话是 `fatal: not a git repository: '…\shared\{id}.git'` ⇒ `#003-03` **第①类**。
- **M2 的追加探针**：把 ⓪ 那条断言**临时去掉**、`--bare` 仍缺 ⇒ **①–⑨ 全绿**（见上面「发现 2」）。这一笔是**为量
  「⓪ 是不是装饰」**而专门跑的（`#004-04`：写下的结论也要当靶子）。
- **无法用变异证明的那几条（据实记）**：FR-012 流程里的「push 被拒 / 冲突发生 / 新检出看得见两次提交」是 **git 本身**的行为，
  本仓没有可以「改坏」的那一行；它们的可为红性由 M2（产物必须是合格的裸仓库）间接支撑。
- **两处变异均已还原**（`git diff` 对 `packages/*/src` 为空）。

**开工时抓到的一处夹具坑（写进用例注释）**：`session` 表那一列叫 **`project_id`**（下划线），而 HTTP 响应体里是
`projectID`（`Schema` 解码出的**线上形状**）——照着响应体写 SQL 会红成 `SQLiteError: no such column: projectID`，
看着像「库搭错了」。另一处：`canonical()` **必须过 `realpathSync.native`**——夹具的 `SANDBOX` 是 win32 **8.3 短名**
（`…/Temp/ADMINI~1/…`），而被测对象（应用自己 realpath 过）写进库的是**长名**，只归一斜杠与大小写时红成
`admini~1` vs `administrator`。这一笔与 `LEARNINGS #003-04` 那笔「探了三种取法都返短名、复现不出来」**不冲突**：
那次三种取法**都在夹具侧**，这次差异的一方**是被测对象**。

### T023 · 项目归档的 FE 入口 ＋ 找回入口：只接线 ＋ 呈现（2026-10-07）

**出参**：民警**点得到**「归档」（「全部」tab 行内，**二次确认**后才送出）、能在「已归档」tab 看见它并**找回**——
FR-008 与 FR-009 两条出口都接上了。**判定一份都不在这里**：谁能归档全走 `ProjectMembership.decide`
（面板的 `canArchive`），组件零规则复述；后端 `archive.ts` 自己再判一次（宪法 IV：前端的隐藏不是授权）。

**用户裁定的四条**（全取推荐项，2026-10-07）：① 「归档」的授权数据 = **列表多给 `role`**（新增 `rolesOf`
批量读，`GET /openhive/project` 逐行用 `...(role ? { role } : {})` 摊上去）；② 「归档」动作只画在
**「全部」tab**（设计 §8.1）；③ 归档成功后 **重拉清单 ＋ 清当前项目**（若归档的正是当前项目）；
④ 缺口 12（403 的 JSON 体到不了 UI）＝ 只做规避 ＋ **继续挂账**。

**改动文件（11 个）**：生产 6 —— `packages/app/src/project/{openhive-project,project-data,project-panel}.{ts,tsx}`、
`packages/app/src/workspace/workspace-entry.tsx`、`packages/auth/src/project-member.ts`（`rolesOf`）、
`packages/opencode/src/server/openhive/project.ts`；测试 5 —— 对应的三个 `.test.*`、
`packages/app/src/workspace/workspace-entry.test.tsx`、`packages/opencode/test/server/openhive-project.test.ts`。
**上游文件 0 处**、**`bun.lock` 未动**（`git diff --stat bun.lock` 空）。

**门禁（全部串行，`#003-01`）**：app `test:components` **431 pass / 0 fail / 27 文件**、`test:unit`
**870 pass / 0 fail / 120 文件**、`test:browser` **41 pass / 0 fail**；opencode 项目族 9 文件 **67 pass / 0 fail**；
auth **238 pass / 1 skip / 0 fail**；`typecheck` **31/31 exit 0**；`lint:openhive` **23 warnings / 0 errors / exit 0**；
根 `lint` **4953 warnings / 1 error / exit 1**（唯一那个 error 是**既有上游**
`packages/session-ui/src/v2/components/prompt-input/index.tsx:163`，同 `#001-02`；**我改的 11 个文件 0 命中**——
本条判据的**阳性对照**：同一份输出里 `member-panel` / `file-tree` 有 35 处命中、路径格式一致，所以「0」不是模式假）。

**变异（逐组还原并复跑）**：主阶段 12 组（面板 6 ＋ project-data 1 ＋ 接线 5），本轮审查补 5 组 ——
全部属 `#003-03` ① 类「恰红目标那一条、对照不红」：恒真函数 ⇒ 恰红 1；去掉 `user_id` 过滤 ⇒ 恰红 1；
`onRestore` 里清当前项目 ⇒ 恰红 1；归档失败分支也清 ⇒ 恰红 1；把 `setProjectFiles(undefined)` 挪到早退之后 ⇒ 恰红 1。
⚠️ 主阶段的 **M5「归档接到 `restore` 出口」属 ② 类「整组红、连对照一起红」**——据实记，不写成恰红。

**第二轮审查（六类 ＋ `#003-02`，三席并行）抓到 3 条「声明的语义没有断言守着」，全部已修**：

1. **[最重 · 本 task 自己引入的回归]** 面板调用方把 `onRestore` 写成
   `(project) => void 办(project, props.onRestore)`——**恒为一个函数**，把 `ArchivedGroup` 里
   `<Show when={props.onRestore}>` 那条「不给回调即不画」整个绕过 ⇒ **未接线时「已归档」tab 多出一个
   点了没反应的「找回」**（HEAD 是 `props.onRestore` 透传，是本次改坏）。根因就是我**自己写下的那条规矩
   只贯彻到一个出口**（`问归档` 那张三元旁边那段注释明写「靠的是调用方不递」）——正是 `#003-02` 那句话。
   修法照 `onAskArchive` 写：`props.onRestore === undefined ? undefined : 找回`（`找回` 是组件体里的稳定常量）。
2. **[Important]** `rolesOf` 的 `where user_id = ${input.userId}` 那半条**没有测试钉住**——原那条 fail-closed
   用例把成员行**全删**了，于是「查全部成员再挑一个」这种丢过滤的写法得到**同样的空结果** ⇒ 两条都绿。
   补一条夹具：把我那一行**换成 BOB 的**（`dropMemberRows` ＋ `addMember`），ALICE 必须**仍然没有 `role` 键**。
3. **[Important]** 「**找回不碰当前项目**」是**裁定过的语义**，而本节所有找回用例的 `beforeEach` 都把当前项目
   清成 `undefined`、用例里也没设过 ⇒ 给 `onRestore` 补一句 `setCurrentProject(undefined)` **全绿**。
   补一条：先把当前项目设成 p2，再找回 p1，断锚点仍是 p2。同形状的还有「**归档没办成 ⇒ 当前项目也不动**」。

**挂账（Minor，不阻塞）**：找回无「在办」锁 ⇒ 连点两次发两次请求（非破坏性、服务端方向幂等）；非 400/403 的
失败体被丢——内核在 **MinIO 未配时回 503 ＋ `{error}`**（`archive.ts` 的 `unavailable`），民警只看到「归档项目失败」，
**与缺口 12 同源、合并挂账**；回调抛异常时面板静默（沿用 `建` 的既有约定）；`roleOf` 的 `null` / 数字边界未钉
（行为已 fail-closed）；`rolesOf` 出口不做闭集校验（今天列有 CHECK、防漂测试在、唯一消费方自己兜底）；
`rolesOf` 在 `packages/auth` 无**单元**测试（同族两条都有；安全属性已由集成用例守住）。

⚠️ **射程外（如实记，不是「做了」）**：设计 §8.1「归档触发」写了**两条**路径——「项目列表『全部』tab 内，
**或项目名右键**」。本 task 只落前者；右键菜单是 T008 的机制、不在 `ProjectPanel` 里。

⚠️ **TDD 偏差如实记**：**面板段与客户端段的生产代码先于测试写成**（不是 RED→GREEN），证据由**变异**补上；
只有**接线**段（`workspace-entry.tsx`）是真 TDD（先 **62 pass / 6 fail**，再改）。

**工具怪癖（本 task 起所有门禁 / 变异命令一律带 `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`）**：不设它时，bun 的
运行时转译缓存在**复用**时**确定性**地报
`Expected JSX element name but found "?" at packages/ui/src/components/file-icons/sprite.svg:1:2`，使整个测试文件
**中止**（`0 pass / 1 fail / 1 error`），**看着像「还没跑完」而不是「失败了」**（连跑 5 次全挂；`-t "zzz不存在zzz"`
同样失败 ⇒ 是加载期不是用例级）。2026-10-07 本会话独立复现并**细化**：缓存目录**首次写**那一轮**必过**，
**紧接着复用同一个已写过的目录必挂**；分辨实验——换成一个无关的 env（`OPENHIVE_PROBE=1`）**仍挂** ⇒ 不是
「随便加个环境变量就好」，是这个变量本身。性质同 `#003-01`：**先怀疑测量，再怀疑被测物**。

**`openhive-project-frozen.test.ts` 在 `git status` 里显示 `M` 是伪影**：`git diff` / `--numstat` / `--raw` 全空，
工作区 blob `1e64044d9dddda332dbc2277668ff6a2b3bfed0f` 与 `HEAD:` **逐字节相同** ⇒ 陈旧 stat 缓存，**内容零改动**
（提交时是 no-op）。

### T020 · 文件树的复制 / 移动 / 上传 / 下载：四个真执行出口 ＋ 客户端接线（2026-10-07）

**出参**：右键菜单那四项**真能执行**——「复制」「移动」弹同一个**目标目录选择器**（`target-picker.tsx`）、
「上传」走**文件选择器**（含从桌面拖进来）、「下载」把字节取回并**落盘**。四项都只落在**项目内**
（`{沙箱根}/{userId}/{projectId}`），**且四项一律要求 `x-openhive-project` 头在场**。

**权限锚（不新造判定）**：文件动作的授权**搭 F3 沙箱那道锚**走——不是 `project_member`、不是 `core/access`
的能力位。服务端靠 `x-openhive-project` 头把工作目录钉进项目，而**头不在时文件路由会退回裸沙箱根**
（＝**所有项目的父目录**）⇒ **四个动作必须一律要求这个头**，这正是 `tasks.md` T020 那条 ⚠️ 警告的由来
（`file.ts` / 两个客户端文件 / 测试文件头都引了它）。

**用户裁定的四条**（2026-10-07，全取推荐项）：① 复制 / 移动**共用一个**目标目录选择器；
② 服务端落点 = fork 自有新路由文件 `packages/opencode/src/server/openhive/file.ts`（**上游 `api.ts` 一字不动**）；
③ 上传走 **`multipart/form-data`**；④ **「拖出浏览器到桌面＝下载」挂账**（见下），下载只走右键菜单那一项。

**改动文件（15 个真改动；另 1 个伪影）**

- **生产 8**：新 3 —— `packages/opencode/src/server/openhive/file.ts`（425 行）、
  `packages/app/src/project/openhive-file-ops.ts`（234）、`packages/app/src/project/target-picker.tsx`（122）；
  改 5 —— `packages/app/src/project/{file-tree.tsx,project-data.ts,project-files.ts}`、
  `packages/app/src/workspace/workspace-entry.tsx`（214＋/6−）、
  **上游** `packages/opencode/src/server/routes/instance/httpapi/server.ts`。
- **测试 7**：新 3 —— `packages/opencode/test/server/openhive-file-ops.test.ts`（753 行）、
  `packages/app/src/project/openhive-file-ops.test.ts`（305）、`packages/app/src/project/target-picker.test.tsx`（190）；
  改 4 —— `packages/app/src/project/file-tree.test.tsx`（238＋/1−）、`packages/app/src/project/project-data.test.ts`、
  `packages/app/src/workspace/workspace-entry.test.tsx`（306＋/3−）、
  `packages/opencode/test/server/openhive-project-directory.test.ts`（97＋/1−）。
- **伪影**：`openhive-project-frozen.test.ts` 在 `git status` 里显示 ` M` 但**不出现在 `git diff --numstat`** ⇒
  陈旧 stat 缓存、**内容零改动**（同 T023 记的那条），**未**写进本次提交的改动清单。

**上游侵入面**：唯一上游文件 `server.ts`，**9 insertions / 0 deletions**（全是「加」），带
`【保留的定制 · 同步上游时不要丢】`。**提交切分**：这一处**与它挂载的 fork 模块 `file.ts` 同属一次提交**——
`server.ts` 那句 import 指向 `file.ts`，硬拆会让中间那个提交**连导入都解析不了**；而
`openhive-file-ops.test.ts` 走的是 `HttpApiApp.routes`，**少了这次挂载四条路由全 404** ⇒
拆不出一个「既能过测试、又只含上游那一处」的提交。**前端半边另起一次提交**，上游 diff 因此仍在一眼可辨的范围里。
**`bun.lock` 一行未动**（`git diff --stat bun.lock` 空）。

**门禁（全部串行，`#003-01`；命令一律带 `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`）**：新文件
`openhive-file-ops.test.ts`（opencode）**19 pass / 0 fail / 92 expect**；opencode 项目族 **10 文件 88 pass / 0 fail**
（＝ 19 ＋ 同族 9 文件的 69）；app `test:components` **470 pass / 0 fail / 28 文件**、`test:unit`
**895 pass / 0 fail / 121 文件**、`test:browser` **41 pass / 0 fail / 14 文件**；`typecheck`（turbo）**31/31 exit 0**；
`lint:openhive` **23 warnings / 0 errors / 99 files / exit 0**（本次改动文件 **0 命中**）；根 `lint`
**4953 warnings / 1 error / exit 1**（唯一那个 error 仍是既有上游
`packages/session-ui/…/prompt-input/index.tsx:163`，`#001-02`，**改动文件 0 命中**）。

⚠️ **一次「看着像红」的测量**：合并跑 opencode 同族时首跑报 **29 pass / 1 fail（30 条）**，串行复跑两次均
**29 pass / 0 fail**；两个文件各自单跑为 **10 / 19** ⇒ 29 才是正确总数，首跑多吐了一个**匿名条目**
（与 T018 记的那次 `# Unhandled error between tests` 同族）。据 `#003-01`：**先怀疑测量**。

**变异（逐组还原并复跑）**。BE（`file.ts`）**14 组**：

| 组 | 变异 | 判词 | `#003-03` 类 |
|---|---|---|---|
| M1 | `projectDirectoryOf` 恒 `undefined` | 12 pass / 1 fail（「不带头」那条） | ① |
| M2 | 预检 ＋ `COPYFILE_EXCL` **一起**去掉 | 11 pass / 2 fail（复制 ＋ 移动各一） | **②**（连对照一起红，据实记） |
| M2b | **只**去预检 | 12 pass / 1 fail（**只有移动那条红**——复制被 `COPYFILE_EXCL` 兜住） | ① |
| M4 | `inside` 去掉越界判据 | 恰红 1 | ① |
| M5 | 去掉 `info.isFile()` | 恰红 1 | ① |
| M11 | transfer **目标目录**的 `realInside` 去掉 | 恰红 1（复制到目录链接） | ① |
| M12 | 下载 `lstat` → `stat` | 恰红 1（文件符号链接） | ① |
| M13 | transfer **源**那一侧的 `realInside` 去掉 | 恰红 1（源在目录链接底下） | ① |
| M14 | upload 目标目录的 `realInside` 去掉 | 恰红 1（上传到目录链接） | ① |
| M15 | `gate` 一律退回沙箱根（＝全门失效） | 恰红 1（「不带头四项」） | ① |
| M16 | **只摘 upload 的门** | 恰红 1，**红在「偷渡.txt」那一条** | ① |
| M17 | `inside` 越界判据去掉 | 恰红 1 | ① |
| M18 | 上传文件名不取末段（`join(targetDir, part.name)`） | 恰红 1（名里带 `../` 那条） | ① |
| M19 | 去掉「目标存在预检」 | 恰红 1（**只有移动那条**） | ① |

⚠️ **M19 与 M2b 是同一处、同一改法**（主阶段跑一次、审查轮又跑一次），据实记为**同一条证据**、
不重复计数。⚠️ **M15 的报错文本在同一行号打印了两次**（bun / Effect 把一次失败打了两遍），**不是**
两处都触发了——由 **M16**（只摘 upload 的门）恰好红在**另一行**反证。
⚠️ 表格里 **M1 / M2 / M2b / M4 / M5** 这五行是**从本 task 的会话记录回收的**（当时未落进本节），
判词与数字照记录誊入、**本轮未复跑**；**M11–M19 是本轮与审查轮当场实测**的。

FE / UI **7 组**：**F-M1**「复制」接到 `move` 出口 ⇒ **红 3**（都走 `onCopy` 那条路）＝ **②类**；
**F-M2** 办成后不重取清单 ⇒ **恰红 1**；**F-M3** 被拒时也重取清单 ⇒ **恰红 1**；**F-M4** 下载不存盘 ⇒
**恰红 1**；**F-M5** `要文件` 退回 `要对象`（对目录不再置灰）⇒ **红 3**（两条 T020 判据 ＋ 空树那条）＝ **②类**；
**F-M6** `落点` 只回原路径 ⇒ **红 4**（该规则的四个出口）；`file-tree.test.tsx` 去掉拖放判据里
`types.includes("Files")` ⇒ **恰红 1**（新加的 dragover 那条）。⚠️ **F-M5 第一次的改法是「翻转判据」，得 7 红**——
翻转本来就宽，换成**摘掉**（`return !接`）才是要测的形状；两次都按 `#003-03` **②类**记，**不写成恰红**。

**★ 第二轮审查（`#003-02`，三席并行）抓到 5 条，全部已修**：

1. **[Critical · 本次 diff 引入]「项目里的链接」不是越界通道，而 `inside` 拦不住它**（审查时报为 S1）。
   `inside` 是**纯词法**判据（`resolve` ＋ `relative`），而复制 / 上传 / 下载走的是**跟随链接**的系统调用 ⇒
   项目里一个指向**兄弟项目**的 junction（`symlinkSync(t, p, "junction")`，本机实测**与是否管理员无关**）
   就能让四项动作**全都伸到项目外**。用探针独立复现：`copyFile` 真把兄弟项目的文件写进了沙箱根。
   修法 = 新增 `realInside`（先 `realpath`、再过一遍 `inside`）落**四处**（transfer 的目标目录 /
   transfer 的 `dirname(source)` / upload 的目标目录 / download 的 `dirname(target)`）＋ 下载把 `stat` 换
   `lstat`（判「最后一段是不是普通文件」**不能跟随链接**）。**RED 先行**：新文件 **14 pass / 5 fail → 19 pass / 0 fail**。
   成牙证据 = M11 / M12 / M13 / M14 **各恰红 1**。
2. **[Important]「不带头上传」那条断言**判别力为零**：只发**同名**文件时，`exists` 预检 ＋ `writeFile` 的
   `wx` **各自**就会回 400 ⇒ 那条绿**证明不了**门在不在。补一次**新名**（`偷渡.txt`）作真判据，断言顺序按
   `#004-14`（先断**副作用一个都没有**——密件正文没变、兄弟项目里没有 `偷渡.txt`——再断那串五个状态码）。
   成牙证据 = **M16**（只摘 upload 的门）**恰红在它那一行**。
3. **[Important] 四处 `tasks.md:177` 引用错行**（`#004-05`）：真锚在 **171**，177 是「T020 编号排最后、
   归属在 Phase 4」那条注。四处改成**点名内容**（「T020 的『⚠️ 权限锚（**不新造判定**）』那条」）而不写行号。
4. **[Important] `openhive-file-ops.ts` 文件头拿「挂账」去指 `tasks.md`，而 `tasks.md` 说的是「两条都要」**
   （`#004-03` 同族）：改成**明说二者不是一回事**——`tasks.md` 那句是**设计口径**，裁定与平台原因是**挂账**，
   指向本节（即这条记录本身）。
5. **[Medium] 测试文件指向「本 task state.md 的变异记录」，而那份记录当时不存在**：本节即为那条记录。

**挂账 / 已知不覆盖**

- **🔴「拖出浏览器到桌面＝下载」没做（用户 2026-10-07 裁定：挂账）**。设计 §6.2 原话是「拖出浏览器到桌面＝下载、
  从桌面拖回＝上传」，裁定把前半**挂账**、只落右键菜单那一项。三条原因逐条都是平台事实（`#002-02`：
  不可做要写成缺口，不能写成覆盖）：① `dataTransfer` 在 `dragstart` **之后只读**，而 `DownloadURL` 必须在
  `dragstart` **里**设（先取字节再设＝来不及）；② Chrome 的 `DownloadURL` 要一条**真 HTTP URL**，而那条 URL
  **带不了 `x-openhive-project` 头** ⇒ 中间件退回沙箱根 ⇒ 服务端的「这次请求在不在项目里」当场判否 ⇒ 400
  （同 `openhive-file-ops.ts` 文件头「下载为什么不返回一个可以点的 URL」那条）；③ 行**今天本来就不可拖**——
  `draggable={local.onBackup !== undefined}`，而 `onBackup` 属 **T022**。
  另**据实记**：「从桌面拖回＝上传」这**另一半做了**（`file-tree.tsx` 的 `dragover` / `drop` ＋
  `workspace-entry.tsx` 的 `传(dir, files)`）⇒ **「拖入」有、「拖出」没有**。
- **上传无体积上限、四个动作均无超时（R1，留待人裁定）**：`formData()` 把整个请求体**读进内存**。
  ⚠️ 上限是**产品数字**（话单 / 资金文件本来就大——那正是这个 feature 存在的理由），故**不在这里凭空造一个
  常量**（同 T011 不替 D-13 拍板的理由）；已写进 `file.ts` 的「已知不覆盖」待裁。超时同 `MinIO` 那侧的既有缺口。
- **移动的「目标已存在」在竞态下有缝**：`move` 只有 `exists(target)` 预检 ＋ 裸 `rename`；Node 的 `fs`
  **没有**「目标存在就失败」的改名原语（`rename` 是 POSIX 语义＝**静默替换**，win32 那侧还有
  `MOVEFILE_REPLACE_EXISTING`）。复制有 `COPYFILE_EXCL` 兜底，**移动没有** ⇒ 两个并发移动落到同一个新名时，
  前一个被**静默吃掉**。修它要么 CAS 式命名、要么把四个动作串行化，**都出了 T020 的射程**。M2b / M19 的
  「**只有移动那条红**」正是这处缝的现场证据。
- **`Content-Disposition` 的清洗本机测不出**（转义 / 非 ASCII 文件名在真浏览器里的落盘名）——`file.ts` 已记。
- **`inside` 的 UNC / 盘符判据无独立用例**——`file.ts` 已记。
- **两条旧账（本次**不修**，遵「外科手术式改动」）**：① `packages/app/src/workspace/workspace-entry.test.tsx`
  第 466 行注释写「全文件 **27** 条」，而该文件现在 **80** 条 —— **写死会漂的数字**（`#002-06` / `#003-04` 同族，
  出处 `6afafc08`）；② `packages/app/src/workspace/workspace-entry.tsx` 第 316 行注释指向「**state.md 的欠账表**」
  与「**AI 资产**」，`grep` 全仓**零命中** —— **悬空引用**（`#004-03` 同族，出处 `2c35b888`）。两条都在本次
  diff 的语义之外。

**⚠️ TDD 次序如实记**：本轮**补的**两处是 **RED 先行**——链接那组（14 pass / 5 fail → 19 pass）与 F2 的新名断言
（由 M16 证明有牙）。**主阶段各段的次序本节不追述**——不在本次收尾的观测范围内，不补写没测过的话。

### T021 · 成员管理四个出口（名单 / 邀请 / 移除 / 退群）：BE ＋ FE 接线都交付（2026-10-07）

**★ 用户裁定（T021 开工前，三问）**：取 **T021**；接线落点取 **自有目录 `server/openhive/`**（办结 `tasks.md` 里那条 ⚠️）；范围取 **BE ＋ FE 接线一次做完**。于是本 task 交两次提交：**BE 半边 `ef5a6a3ee5`**（其提交信息里「详见 …state.md 的 T021 节」指的就是**本节**——那次提交**不含 docs**，本节随 FE 半边那次提交一并落地）＋ **FE 半边**（本次）。

**交付面（改动 7 个文件 ＝ 生产 4 ＋ 测试 3，另 `membership.ts` 一行注释）**

| 半边 | 文件 | 是什么 |
|---|---|---|
| BE | `packages/opencode/src/server/openhive/member.ts`（新） | 四个出口：`GET /openhive/project/member?projectId=` ／ `POST …/member/{invite,remove,leave}`。**fork 自有文件**，上游 `api.ts` 一字不动 |
| BE | `packages/opencode/src/server/routes/instance/httpapi/server.ts` | **11 insertions / 0 deletions**，挂进 `Layer.mergeAll`，带【保留的定制 · 同步上游时不要丢】——**唯一的入口侵入面** |
| BE | `packages/auth/src/user.ts` ＋ `project-member.ts` | 两处「加」：`usersByIds` / `userByPoliceNo`（警号 ⇄ UUID）与 `removeMember`（移除与退群共用，**判定留在各自调用点**） |
| BE | `packages/opencode/test/server/openhive-project-member-route.test.ts`（新） | **18 pass / 0 fail / 47 expect** |
| FE | `packages/app/src/project/openhive-members.ts`（新） | 四个出口的薄客户端。`listMembers` **三态**（取不到 / 空 / 有），三条写出口共用一条 `memberAction` |
| FE | `packages/app/src/project/openhive-members.test.ts`（新） | **23 pass / 0 fail / 24 expect** |
| FE | `packages/app/src/project/project-data.ts` | ＋4 方法（`members` / `invite` / `remove` / `leave`）；`PROJECT_DATA` 上留了「一个都别接错」的 ⚠️ |
| FE | `packages/app/src/workspace/workspace-entry.tsx` ＋ `.test.tsx` | 名单 effect ＋ 三个 handler ＋ `member-op-message`（服务端那句话给人看）；测试 **＋10 条** |
| — | `packages/core/src/project/membership.ts` | **一行注释**：接线行补上 `server/openhive/member.ts`（T021）——办结下面那笔账 |

**★ 本 task 的核心是「翻译」**：`project_member.user_id` 存的是 `auth.user.id` 那个 **UUID**，而界面说的、`selfPoliceId` 比的、邀请框里填的都是**警号**。**不翻译不会报错**——只会画出一列谁也看不懂的字符。翻译**只能在服务端**（本仓只有 `packages/opencode` 同时看得见 `auth.user` 与 `project_member` 两张表），故 FE 层**一个 UUID 都不出现**；把这个映射提到前端 ＝ 把「谁是谁」变成两份判断（`#002-06`）。

**⚠️ 三处刻意（都写在 `member.ts` 文件头，各有专门观测面钉住）**

1. **名单的门是成员身份，不是 `decide`**：`PROJECT_ACTIONS` 里没有 `read`（那是**刻意**的），归档**冻的是动作、不是看见**——T018 的列表对成员照样列出已归档的项目。在这里再判一次归档 ＝ 把「冻结」写成两份。判据：**同一个人、同一个状态，名单读得到、邀请 403**。为此四个出口**一律不带 `x-openhive-project`**（带了会被 T017 中间件套上「已归档 ⇒ 403」，`project-location.ts`）。
2. **邀请的授权先于解析警号**：反过来的话，非成员能拿 400/403 的差别当「这个警号存不存在」的探针。**端点断言对顺序不敏感**（`#004-09`），故专门造了一条观测面来钉它。
3. **移除的目标只能取自本项目名单**：改按警号直删**不会报错**，只会把**别人项目里**同一个人的行删掉，而两次删除都回「成功」。

**⚠️ 一笔账（`#004-03` 的又一实例）：`tasks.md` 那条 ⚠️ 的前半句，开工时已经假了。**
那条 ⚠️ 写「`membership.ts` 的文件头写着接线归 `packages/opencode/src/project/member.ts`」。`grep` 实测：**它写下时是真的**（T004 原文就是那个路径），但 **T015（`403ad2fafb`）已把那行改成**「`server/openhive/archive.ts` ＋ `middleware/project-location.ts`」——**本 task 开工时那句早就不在了**。所以本次办的是 ⚠️ 的**意图**（文件头必须点名真落点）：在接线行补上 `server/openhive/member.ts`。
判据一句话：**「文件头写着 X」也是会假的镜像声明**——开工前必须 `grep`，不能照抄（同 `#003-04`：实测类记述落笔前先复现，只是对象从「数字」换成了「文件里有没有这句话」）。

**✅ 变异验证（据实记三类 `#003-03`）**

- **BE 7 处，全部①类**（数字见 BE 提交信息）：拿掉名单的门 → 1 fail（恰好那条）；`policeId` 不翻译 → 4；解析挪到授权之前 → 1；拿掉邀请的门 → 4；`remove` 改按警号直删 → 1；拿掉退群的门 → 2；不读归档态 → 3。**对照用例均不红。**
- **FE 11 处，全部①类**：**M1** `invite` 走成 `remove` → 2；**M2** 403 并进 `[]` → 2；**M3** 去掉「切项目时先清空名单」 → **1**；**M4** 去掉迟到回包的 `作废` 守卫 → **1**；**M5** 退群后不收起面板 → 1；**M6** 归档态恒 `false` → 1；**M7** 办成后不拨名单代次（不重取） → 1；**M8** 移除传成姓名 → 1；**M9** 坏行改成「跳过」而不是整份 `undefined` → 2；**M10** 去掉「体里自述的 `projectId` 相符」判据 → 1；**M11** 未接线且去掉 `projectData` 守卫 → 1。
- ⚠️ **M3 是补出来的**：先写的端到端用例（切项目 ⇒ 换一份名单）**对 M3 不敏感**——旧的名单被新的一次取数覆盖，端点上看不出「有没有先清空」。补了一条**窗口用例**（新项目的名单**永不落地**）才把它钉住；M3 恰红**只红这一条**。这就是 `#004-09` 的现场（端点断言对「时序 / 窗口」不敏感）。
- **全部已还原**（`git diff --stat packages/*/src` 除本 task 的改动外为空），还原后各套门禁复跑全绿。
- ⚠️ **这些数字没有在收尾时复跑**：**BE 7 处**的数字取自 BE 提交信息（`ef5a6a3ee5`），**FE 11 处**取自本 feature 的会话记录。收尾只复跑了**门禁**（各套测试全绿），**没有重跑变异** —— 据实标在这里（同 T020 节的做法 `#003-04`）。
- ⚠️ **M11 的读法**：它证明「**没注入数据源 ⇒ 三颗按钮禁用**」那条用例**确有牙**——去掉 `projectData` 守卫后，那条红。没有它，那三条 `?.disabled` 断言可能是**空断言**。

**🧭 门禁（T021 收尾，串行，2026-10-07；数字均为本轮实跑）**

| 门 | 结果 |
|---|---|
| `packages/app` `test:unit` | **922 pass / 0 fail / 3295 expect / 122 文件 / 6.81s** |
| `packages/app` `test:components` | **480 pass / 0 fail / 1052 expect / 28 文件 / 10.65s** |
| 单跑 `workspace-entry.test.tsx` | **90 pass / 0 fail / 212 expect / 6.17s** |
| 单跑 `openhive-members.test.ts` | **23 pass / 0 fail / 24 expect** |
| 根 `bun run typecheck`（turbo） | **31/31 successful, exit 0**（27 cached） |
| `lint:openhive` | **23 warnings / 0 errors / 101 files / exit 0**（＝ T020 基线；**本次改动文件 0 命中**——23 条全在 `center/`（`tab-bar` / `image-view` / `mindmap-view` / `zip-entry`）） |
| **文件级** oxlint（**仓库根**，`#004-10`） | 本次 **7 个文件** ⇒ **0 warnings / 0 errors / 130 rules / exit 0** |
| `git diff --numstat bun.lock` | **空**（一行未动） |
| BE 半边（见其提交信息） | opencode typecheck exit 0；`openhive-project-member-route.test.ts` **18/0/47**；项目族 10 文件 **88/0**；auth `user.test.ts` ＋ `project-member.test.ts` **23/0** |

**⚠️ 测试夹具里抓到一处既有缺陷（不是本 task 引入的，本次修掉）**

`packages/app/src/workspace/workspace-entry.test.tsx` 的 `mount()` **从来没调用过 `render()` 的 dispose** ⇒ 每个挂过的 `WorkspaceEntry` **一直订阅**着那几条模块级接缝（`currentProject` / `projectList` / `projectFiles` / `projectMembers`）。后面的用例一改项目，**旧实例**仍活着、用**它自己那份假数据源**去取数、再写回**同一条缝** ⇒ **谁的回包最后落地谁赢**。

- **实测证据（不是推断）**：`Expected to contain: "乙/话单.csv" Received: [ "资料", "资料/话单.csv" ]`，而 `["资料/话单.csv"]` 在本文件里**只出现一次**（那处 stub 无视 id）——**唯一来源**就是某个旧实例，把「换项目」这场竞态从「偶尔」拨成「常红」的正是本 task 给每个实例多加的**一个名单订阅者**。
- **修法**：`mount()` 记账 ＋ 外层 `afterEach` 里**先卸载、再清 `document.body.innerHTML`**（**顺序要紧**：先清 body 会让 Solid 的 dispose 去碰已经摘掉的节点）。修后连跑三次全绿，该文件耗时 **~50s ⇒ ~6s**。
- **同型 `mount()` 散落在 `src/**/*.test.tsx`**（`center/views`、`project/`、`auth` 都有），但**只有「会写接缝的组件」才咬得到**——已在下面挂账。

**⛔ 已知不覆盖 / 残差（如实记账，`#002-02`）**

- **重复邀请的预检只把 500 翻成 400**：并发下两次都过预检、第二次撞 PK ⇒ **500**（可接受；同族见 T020 的「移动在竞态下有缝」）。已写在 `member.ts` 的「已知不覆盖」。
- **被邀者不做 `status` / `deactivated_at` 过滤**：本链回答的是「名单上有没有他」，不是「他今天能不能登录」。已写在 `member.ts`。
- **三份逐字相同的 `messageOf`**（本文件 / `openhive-project.ts` / `openhive-file-ops.ts`）与**两份 `asRole` / `actorIn`**（`member.ts` / `archive.ts`）：该收进一层，但那要动已审过的文件——**记账，留给下一次单开一笔**（本次遵「一个 PR 不混『重构』与『新功能』」）。
- **`成员话` 在切换项目时不清**：与已审过的 `文件话` 同款行为（切项目后上一句失败话还挂着）。**不单独修**——两条要一起修才算一致，而那属于另一次改动。
- **`member-panel.tsx` 把 `undefined` 与 `[]` 都显示成「还没有成员」**：对 403 / 网络错来说这是一句**假话**（面板替后端声称了「查询成功且一个人都没有」）。⚠️ 修它要动 **T010 已审组件**与它钉住的断言 ⇒ 本次**只记账**。FE 层已经把三态分清了（`openhive-members.ts`），**能修的是面板那一层**。
- **`workspace-entry.test.tsx` 里那句写死的条数又漂了一次**：本 task ＋10 条 ⇒ 该文件现 **90** 条，而注释里写的是 **27**（T020 节记的「现在 80 条」也已成旧数）。**两条都是 `#003-04` 那类「写死会漂的值」**——本次**仍不修**（同 T020 的裁定：外科手术式改动）。

**⚠️ TDD 次序如实记**：FE 半边的测试是 **RED 先行**（先写用例看它红，再写实现）；其中**第 ③ 条（切项目先清空）与第 ⑤ 条（未注入数据源 ⇒ 禁用）各返工过一次**，两次都是**我的用例写错了位置/顺序**、产品码没动：③ 起初把 `setProjectMembers(名册)` 写在 `mount()` **之前**，而新加的名单 effect 第一次跑就会清空那条缝 ⇒ 红在「按钮不在」——那是一条**归因错了的红**（`#004-14` 说的正是这个：先确认红的是不是你要测的那条）；⑤ 同因，改成 mount ⇒ setCurrentProject ⇒ setProjectMembers ⇒ 点。

### T024 · 超期自动提醒（FR-008 的下半条）：判定 ＋ 提醒呈现 ＋ 补写入方（2026-10-07）

**做了什么**（FR-008 有**两半**：上半「项目可**手动**归档」由 T013 落地、T023 给入口；本 task 是下半「**超期 3 个月自动提醒 ⇒ owner 确认后才归档**」）。三个半边：

| 半边 | 落点 | 内容 |
|---|---|---|
| core | `packages/core/src/project/ext.ts` | `STALE_AFTER_MS`（90 天定值）＋ `isStale(lastAccessedAt, now)`（**纯函数、不取时钟**）＋ `touchProjectExt`（写 `last_accessed_at`） |
| BE | `packages/opencode/src/server/openhive/project.ts` | `GET` 出参多一个 `stale`（`handleList` 里 `now` **一次取、整列共用**）＋ **新出口** `POST /openhive/project/touch` |
| FE | `openhive-project.ts` → `project-data.ts` → `workspace-entry.tsx` → `project-panel.tsx` | `touchProject` 薄客户端 → `ProjectData.touch` → `onOpen` 记账 → 行上「超期未归档」徽章 |

**改动面**：新增 `packages/opencode/test/server/openhive-project-stale.test.ts`（6 例 / 30 expect）；生产 6 文件（core 1 ＋ BE 1 ＋ FE 4）＋ 测试 5 文件 ＋ docs 两份。**上游文件 0 处**（本 task 一行都没碰上游）。

#### 🔒 三笔开工前裁定（用户，全取推荐项）

| # | 裁定 | 落实处 | 代价（如实记） |
|---|---|---|---|
| ① | **提醒触发者 ＝ 服务端在「列项目」时算** | `handleList` 里 `isStale(row.last_accessed_at, now)` | **民警不开界面就没有提醒**——三个候选里这是**不引入调度设施**的那一个（② 定时任务要新基础设施；③ 登录时算粒度更粗、且同样只在登录那一刻存在） |
| ② | **范围 ＝ 判定 ＋ 提醒呈现**；**确认入口复用现成的** | 未新增确认流程、未新增归档出口（整套复用 T013 的 `POST …/archive` ＋ T023 的按钮与二次确认条） | 无新增出口 ⇒ 也无新增授权面 |
| ③ | **判据 ＝ 先补「访问时刷新 `last_accessed_at`」的写入方，再按它判** | `touchProjectExt` ＋ `POST …/touch` | 见下「为什么必须是独立出口」 |

#### ⭐ 四处刻意（各有专门观测面）

1. **`stale` 是「一定给」的键，不是可省略的**——它**恰好相反**于 `memberCount` / `archived` / `role` 那三个（「缺键就是缺键」：来源没说是缺键）。`stale` 是「服务端算完的结论」，所以**一定要给**（`false` 也要给）。FE 侧 `readEntry` 用 `=== true` 取它，理由**不是**「来源没说」，而是**两个方向的代价不对称**：少一条提醒最多是「这个项目晚一天被收拾」；把没有依据的行读成超期，会在**没超期**的项目旁边（同一行上就有「归档」按钮）画出「超期未归档」，民警照着它把**在用**的项目归档掉——沙箱文件当场被搬走。
2. **必须是独立的 `POST …/touch`**（三条替代方案**全被否**，理由是「不报错、不变红」）：塞进 `list` handler ⇒ **读出口变成自己的写入方**（列一次项目＝所有项目都被访问一次，`stale` **恒假**、提醒**永不出现**）；塞进 T017 的身份中间件 ⇒ 每个请求都写；前端自己算 ⇒ 把阈值判据抄进 JS（`#002-06`）。
3. **授权是结构性的，没有 `decide` 可问**——`project_ext` 在**每用户库**里、`update … where project_id = ?` 天生只动自己那行 ⇒ **不给 `PROJECT_ACTIONS` 加一个「访问」动作**（加了会是一条**谁也不会问**的规则）。判据用**结果**钉：touch 别人的项目 ⇒ `200`，而**对方那行一个毫秒都没动**，且自己库里**不凭空多一行**（防 upsert）。
4. **FE 的提醒门 ＝ `canArchive(project) && stale === true`**——复用 `decide`，组件**零规则复述**（成员 / 无 role 的行天生不提醒）；提醒**不**与归档按钮绑同一个 tab（每天打开的是「最近」，绑了就等于没有提醒）。

#### 📌 一处不实记述的更正（`#004-03` 的又一实例）

`tasks.md` T024 条目原文写「阈值判据的字段是 `last_accessed_at`（**`project` 表**）」——**不成立**：按 Q3 裁定它落在**每用户库的 `project_ext`**（`ProjectExtTable`，与 `type` / `project_type` / `shared_directory` 同表；FR-002 的排序用的就是它，**那半句是对的**）。同日实测的**写入方只有一处**：生产里只有建项目那一步写它（`handleCreate` 的 `const lastAccessedAt = Date.now()`）⇒ **今天「3 个月无操作」等价于「建项目后 3 个月」，项目天天在用也照样到期**。已在 `tasks.md` 原地改正、不改原文。

#### 🔍 收尾变异 7 组，**全属 `#003-03` ① 类**（恰红目标那几条、对照不红）

| # | 变异 | 结果 | 备注 |
|---|---|---|---|
| M1 | BE：`stale` 硬写成 `false` | 恰红 **2**（判超期那两条），其余 4 条（新建 / 89 天 / touch 别人的 / 401 / 400）全绿 | — |
| M2 | BE：去掉 `handleTouch` 的体解码门 | 恰红 **1**（体缺 `projectId` ⇒ 应为 400） | 5 pass / 1 fail |
| M3 | core：边界 `>=` 改 `>` | 恰红 **1**（「差 90 天算超期」那条） | 11 pass / 1 fail |
| M4 | FE：`touchProject` 改成只看状态码 | 恰红 **2**（200 + HTML 兜底 ／ `projectId` 不匹配） | 另 3 条（成功 / 500 / 网络错）不红 |
| M5 | FE：去掉 `stale === true` | 恰红 **1**（不超期那条） | 53 pass / 1 fail |
| M6 | FE：去掉 `canArchive(project)` | 恰红 **2**（member / 无 role） | **「已归档」那条不红**，见下 |
| M7 | FE：去掉 `onOpen` 那次记账 | 恰红 **1**（点开 ⇒ 记一次访问） | 91 pass / 1 fail |
| M7′ | FE：**反向**——把记账塞进「拉清单」 | 恰红 **2**，**含「进门拉清单 ⇒ 不记访问」那条对照自己** | ⇒ 该对照**非空**，它守的正是裁定 ② 里被否掉的第一个替代方案 |

7 处变异**均已还原**，还原后逐句 `grep` 复查（残留探针 0 命中、正句 4 处各 1 命中），并**在最终树形上重跑全部门禁**。

#### ⚠️ 未做变异 / 无测试可钉 —— 如实记（不写成已覆盖）

- **`touch 别人的项目` 那条的敏感面在 `DatabaseRouter` 的按用户分库上**（属 003 的接线，不在本 task 改动面内，且它有自己的测试）⇒ **本 task 未变异它**。本 task 里对这条只实抓过一次**假绿**并已修：原判据只断 `status === 200`，而**未挂载的路径被 SPA 兜底回 200 ＋ `text/html`** ⇒ 出口不存在时它**照样绿**；改成 `touchOk`（200 **且**体能当 JSON 解且 `projectId` 相符）后 RED 才是诚实的 **5 fail / 1 pass**（`#004-08`：副作用类判据要先证明机制是活的）。
- **`handleList` 里 `now` 提到 map 之外**只对**语义**负责（「这个响应说它们各自超期了吗」是**一个**判断，不是 N 个）——90 天阈值下，逐行取时钟与整列共用在行为上**不可分辨**，任何断言都测不出差别 ⇒ 它是**可读性选择、不是判据**。**不补测试、也不假装有**。
- **「已归档的行不带提醒」对 M6 不敏感**（实测不红）——它守的是**结构**（归档组走 `ArchivedGroup`、不过 `Group` 那条渲染路径），不是门。两条都在、各管一段。
- **TDD 次序如实记**：core ／ BE ／ FE 三条链都是 **RED 先行**（先看预期的那几条红、再写实现）；其中 BE 的 `touchOk` 是**在 RED 阶段发现假绿后补的**（不是事后补断言）。

#### 🧭 门禁（2026-10-07 实测，**串行**，照 `#003-01`；一律带 `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`）

- core：`project-ext.test.ts` **12 pass / 0 fail / 21 expect**；
- BE：**4 文件 47 pass / 0 fail / 229 expect**（`openhive-project-stale.test.ts`（新）＋ `openhive-project-frozen.test.ts` ＋ `openhive-project.test.ts` ＋ `openhive-file-ops.test.ts`，~56s）；
- app：全量 `unit` **930 pass / 0 fail / 3305 expect / 122 文件**；全量组件 **394 pass / 0 fail / 789 expect / 18 文件**；
- `typecheck`：三个包（core / opencode / app）**全过**；
- **文件级 oxlint：在仓库根跑（`#004-10`）改动 12 文件 —— 0 warnings / 0 errors / 130 rules / exit 0**；
- `bun.lock`：**本次未跑 `bun install`，一行未动**。

#### ⛔ 缺口 / 残差（沿用开工侦察，本 task **未改变**）

- **成员没有 `project_ext` 行** ⇒ 共享项目的提醒**天然只到得了创建者**；「**成员在动、owner 3 个月没动**」这类判据今天**没有可分辨的输入**（`#002-02`：缺口的形状，不是已覆盖）。
- **不开界面就没有提醒**（裁定 ① 的代价，三候选里唯一不引入调度设施的那个）。
- **阈值今天等价于「建项目后 90 天」**——写入方虽已补，但只有「点开项目」这一条路径会刷新它（下载 / 上传 / 编辑文件都**不算访问**，只有**打开项目**算）。这是「访问」的定义问题，**本 task 按裁定收在「打开」**。

## Step 5 · 代码审查（2026-10-07，五席并行 · runbook 六类）

> **范围**：`8e20357f59..b02c64a861`（83 文件 / 26266＋ / 62 新文件 / 39 提交）。**六类**：韧性 / 横切一致性 /
> 防御性编码 / 迁移 / 前端换皮一致性 / 上游侵入面。**五席分工**：① 横切一致性 ＋ 防御性编码；
> ② 测试质量与断言牙齿（`#003-02` 的那一席）；③ 上游侵入面与重构取舍；④ 韧性；⑤ 前端换皮一致性。
> 每条**由我回代码逐条核对**（`#004-04`：表里的「同形 / 已覆盖 / 有测试」都是待核的说法，不是结论）。
> **去重后 16 条新账**：**已修 4**（X3-1 / X3-3 / X2-6 / **X5-2**——它随 X5-1 一并改掉了）·
> **待裁定 4**（X4-1 / X4-2·3 / X4-4 / X5-1——**均已按下面「四条裁定」落地**）· **挂账 8**。
> 迁移一类**零缺陷**（0005 的 down / up 逐项对称、无 `CONCURRENTLY`）。

| 编号 | 类别 | 文件 · 位置 | 描述 | 优先级 | 处置 |
|---|---|---|---|---|---|
| X3-1 | 防御性编码 | `opencode/.../openhive/archive.ts` / `backupAll`＋`restoreAll` | `backupAll` 只 `put`、**从不 `delete`**；`restoreAll` 全量按 `list()` 写盘 ⇒「归档→找回→**删沙箱里的 B**→再归档→再找回」**B 静默复活**（往返用例止步于「再归档」，抓不到） | Important | ✅ 已修 `03f4fbe436` |
| X3-3 | 防御性编码 | `routes/.../middleware/project-location.ts` | `x-openhive-project` 头非法 ⇒ `throw` 在 `Effect.gen` 体内是 **defect** ⇒ 折成 **500**，与同文件对 `sessionID` 刻意回 400 的口径**不一致** | Minor | ✅ 已修 `dc0facdfbf` |
| X2-6 | 上游侵入面 | `script/oxlintrc.openhive.json:54` | 注释里的存量基线仍写「`packages/app/src/{rail,center,topbar,workspace}` 62 文件」，**没跟着加 `project` / `auth`**（fork 自建文件、仅历史快照注释，非门禁判据） | Minor | ✅ 已修（本次） |
| X4-1 | 韧性 | `core/src/minio.ts` / `makeStore` | `S3Client` **无 `requestHandler` / 超时**（`requestTimeout` / `connectionTimeout` / `socketTimeout` 全缺）⇒ MinIO 僵死时归档/找回**无限期挂起**（不是 500、不是可重试） | **Critical** | ⏸ 待裁定 |
| X4-2 | 韧性 | `archive.ts` / `backupAll` | 大项目归档**每文件一次 `store.put`、纯串行**（双层 `for`＋`await`），无并发、无批数上限、无 per-call 超时；外呼量＝Σ（各成员沙箱文件数） | Important | ⏸ 待裁定（与 X4-3 同源） |
| X4-3 | 韧性 | `archive.ts` / `restoreAll` | 找回反向同理：每人先 `store.list()`（内部**分页**，每 1000 对象一次 LIST），再逐对象 `store.get`、纯串行，同样无并发 / 无上限 / 无超时 | Important | ⏸ 待裁定（与 X4-2 同源） |
| X4-4 | 韧性 | `archive.ts` / `handleArchive` 第 ⑧ 步 | **真·半成功窗口、用户可见**：`releaseAll`（删整个项目目录）**先跑**、`markArchived` **后跑**；若前者已删光、后者因 PG 抖动失败 ⇒「**归档没落 ＋ 沙箱已空 ＋ MinIO 有整份备份**」，列表显示**未归档**而点进去**文件没了**。文件头注释只讲了「上传失败」那一半 | Important | ⏸ 待裁定 |
| X5-1 | 前端换皮一致性 | `project/file-tree.tsx` `ROW_SELECTED`、`sidebar-tabs.tsx`、`project-panel.tsx` | 选中态用中性 `layer-03`、**且与 hover 同色**（鼠标移开分不清选中）；而 `plan.md:95` 与 `DESIGN.md:59` 都写选中态＝浅金 `--v2-background-bg-accent-soft`（同栏 `rail.tsx` 用的正是它） | Important | ⏸ 待裁定 |
| X1-1 | 横切一致性 | `opencode/.../openhive/file.ts`（`gate` / `projectDirectoryOf`） | 四个文件出口**无 `decide`**，授权隐含在中间件、等价「创建者」（**今天 fail-closed**）；与已登记缺口同根因 ⇒ **修那个缺口时这四个出口必须同时补 `decide`** | 挂账 | 📝 已挂账（本表） |
| X3-2 | 防御性编码 | `archive.ts:435` ＋ `core/src/minio.ts` | `plan.md:156` R3 明写的缓解措施＝「**上传校验 ＋ 归档前确认完整性**」，实现里**无对应物**（`put` 用裸 `PutObject`），且**缺口表零登记**（`#002-02` 违例） | 挂账 | 📝 已挂账（本表） |
| X4-6 | 韧性 | `state.md` T014 缺口 1 | 那条挂账**引错了条目**（说「同 **T013 缺口第 6 条**」，而那实际是「**每成员各建一个 `S3Client`、`Minio.Interface` 没有 `close`**」）⇒ 上传侧「**无重试 / 超时**」**并未真正写进缺口表** | Minor | 📝 已更正（本表） |
| X4-8 | 韧性 | `app/src/project/openhive-fetch.ts` / `defaultSend` | 前端所有 fork 出口走裸 `fetch(input, init)`，**无 `AbortController` / 超时** ⇒ 服务端挂住时（X4-1）界面一直转、无中止手段 | Minor | 📝 已挂账 |
| X4-9 | 韧性 | `opencode/.../openhive/project.ts` / `handleCreate` | 建项目八步**无事务、无补偿**：中途失败（如第 ⑦ 步 `addMember` PG 抖动）留下**孤儿目录 ＋ git 仓库**，而项目不可见；重试生成**新 UUID** ⇒ 每次失败泄漏一个目录、**无清理** | Minor | 📝 已挂账 |
| X5-2 | 前端换皮一致性 | `project-anchor.tsx:69`、`project-panel.tsx:234` | hover 底色 token **不统一**：绝大多数 12 处用 `bg-v2-background-bg-layer-03`，这两处用 `bg-v2-overlay-simple-overlay-hover`，且 `project-panel.tsx` **同一文件内两种混用** | Minor | ✅ 已随 X5-1 一并修（见下「四条裁定」） |
| X5-3 | 前端换皮一致性 | `member-panel.tsx:111/115`、`project-panel.tsx:254/261/528`、`project-anchor.tsx:68` | 圆角 token **不统一**：同 feature 内并存 `rounded-[4px]`（22 处）、`rounded-[6px]`（3）、`rounded-lg`（2，弹层）、`rounded-md`（1） | Minor | 📝 挂账 |
| X2-4 | 上游侵入面 | `server.ts` 的 T015 提交 `403ad2fafb` | 那处改动**不是纯加**：它把 **T017** 加的那行 `projectLocationLayer.pipe(Layer.provide(AnchorWorkspace.Config))` **就地重写**（fork 自建行改 fork 自建行，可接受，但记录在案） | Minor | 📝 已挂账 |
| X2-7 | 上游侵入面 | `server.ts` 的提交信息（`403ad2fafb` T015） | 7 个碰 `server.ts` 的提交里 **6 个**在提交信息里带「**保留的定制 · 同步上游时不要丢**」，**T015 那个没有** | Minor | 📝 挂账（历史提交，不改） |

**非缺陷 / 已挂账（去重后**不计新账**）**：X1-2（`member.ts` 的 `list` 走 `actorIn`、其余三个走 `decide`——**刻意**，文件头写明「冻结的是动作，不是看见」）；
X1-3（`archive.ts` 两出口的次序**正确**：`decide → 403` 排在 MinIO 配置之前）；
X2-1 / X2-2 / X2-3 / X2-5（**核实项**：`server.ts` / `layout-new.tsx` / `package.json` 的 `lint:openhive` 行确为上游文件，改动都是「加」为主；
X2-5 另纠正了**任务书误列**——`core/src/database/router.ts`、`app/src/workspace/workspace-entry.tsx` 等**不是**上游文件，是 fork 自建，
详见下面「一处我自己的更正」）；X3-4/5/6（去重后**已挂账**）；X4-5（「一部分传上去了、一部分没传」**是设计不是缺陷**——
`backupAll` 中间隔着一次 `await`、`releaseAll` 未跑，项目仍可重试幂等重传）；X4-7（PG 有 `connectionTimeout: 3`s、无语句超时 / 无查询重试，
**已挂账于** `auth/db.ts`）。

### 已修两条（含 TDD 证据）

- **X3-1**（`03f4fbe436`）：`backupAll` 在**上传完之后**加一段**收敛**——`for (path of await store.list()) if (!wanted.has(path)) await store.delete({ path })`。
  **次序＝先传后删**：任一时刻 MinIO 里是「旧全量 ∪ 新全量」的超集，中途失败仍够找回（反过来先清空再传，中途失败就丢备份）。
  上面那句 `files.length === 0 ⇒ continue` 是这一步的**前提**不是优化（空沙箱的语义是「跳过」，若也收敛，第二次归档空沙箱会把整个备份删光）。
  **RED**：`openhive-project-restore.test.ts` 加一条往返用例（归档→找回→`rmSync` 删 乙.txt→再归档→再找回），实得 `["乙.txt","甲.txt"]`
  —— **恰红 1 条、对照 11 条绿**（这一条 RED 同时就是它的**变异证据**：去掉收敛 ⇒ 恰红那一条）。**GREEN 12 pass / 0 fail**；归档侧同批复跑 **15 pass / 0 fail**。
  ⚠️ 收敛删的是「不在这份清单里的键」，判据是**整段前缀** ⇒ **这个前缀下不许有第二个写入方**，已在 `tasks.md` 的 T022 条目补了警告。
- **X3-3**（`dc0facdfbf`）：加 `badRequest()`（`{ error }` 体，与 `forbidden()` 同一口径），非法头直接 **400**；「不锚定任何目录」这个判据不变。
  旧用例的 `Exit.isFailure(outcome) || outcome.value.status !== 200` 把 **defect 也当成「被拒」**收下了，所以这个不一致一直绿着 ⇒
  收紧为 `Exit.isSuccess(outcome) ? outcome.value.status : "FiberFailure"` **必须 `=== 400`**。**RED 实得 500**（恰红 1 条、对照 9 条绿）；**GREEN 10 pass / 0 fail**。
  同株复跑（都走这个头）：frozen 9/0、frozen-pending 2/0、shared 5/0、file-ops 19/0、project 13/0、stale 6/0、member-route 18/0、archive-unconfigured 3/0。

### 缺口表补登（X3-2 / X1-1 / X4-6）

- **X3-2（`#002-02` 违例的补登记）**：`plan.md` R3 写的「上传校验 ＋ 归档前确认完整性」**今天没有对应物**，缺口表里**一个字都没有** ⇒ 在这条补上：
  「**本 feature 未覆盖**：`backupAll` 的「上传后校验每个对象确实落盘」与「归档前确认完整性」——`minio.ts` 的 `put` 是裸 `PutObject`、
  不回读校验；风险＝**上传静默截断**时备份缺内容、而归档照落。原因＝`plan.md` R3 只写了意图，实现期无对应物。」
- **X1-1（与已登记缺口同根因）**：四个文件出口（`file.ts`）没有 `decide`，授权靠中间件隐含、等价「创建者」——**今天 fail-closed**。
  与**已登记**的「成员在文件出口上没有独立的授权点」同一根因 ⇒ **补那条时这四个出口必须同时补 `decide`**，别只补一处（`#004-01`：数底层调用点，不是数已有守卫的点）。
- **X4-6（更正一处错误引用）**：T014 缺口 1 里那句「与上传（**T013 缺口第 6 条**）同款」**引错了**——T013 第 6 条讲的是「每成员各建一个 `S3Client` / 无 `close`」。
  因此**上传侧「无重试 / 超时」过去并未真正挂账** ⇒ 现在如实补登：**本 feature 未覆盖**：`backupAll` / `restoreAll` 的 MinIO 调用**无重试**（全仓无自动重试：失败即上抛，靠用户重试）。
  ⚠️ **更正（第二轮 R2-08）**：本条原文写「**无重试、无超时**（与 X4-1 同根因、**被 X4-1 的裁定一并解决**）」——**只对了一半**：**超时**那一半确实已由 X4-1 落地（`Config.timeoutMs`，默认 30s，四处外呼都过 `withTimeout`）；**重试**那一半**没有任何东西解决它**，仍是未覆盖项，如实留在这里（`#002-02`：做不到的要写成缺口，不能写成覆盖）。

### 一处我自己的更正：哪些文件**真**是上游侵入面

发起审查时我把 `server.ts` **之外**的一批文件（`core/src/database/router.ts`、`app/src/workspace/workspace-entry.tsx`、
`app/src/project/**`、`auth/**` 等）也当成了「上游文件」，席 3 独立核对后证明**它们是 fork 自建、不在 `upstream/dev` 里**（`git ls-tree upstream/dev` 零命中，
作者是 fork 提交者）。⇒ **真正的上游侵入面只有 3 个文件**：`packages/opencode/src/server/routes/instance/httpapi/server.ts`、
`packages/app/src/pages/layout-new.tsx`、`package.json`。这条更正已写进本表（见 X2-5）。
（教训本身与 `#004-03` 同族：**「我记得这是上游文件」也是待核的说法**，去 `git ls-tree` 核一下比记着强。）

### 四条裁定 ＋ 落地（2026-10-07，用户裁定 · 全取推荐项）

| 条目 | 裁定 | 落地 |
|---|---|---|
| X4-1 | **现在就配超时** | ✅ 已修：`core/src/minio.ts` 给**每一次 `client.send`** 套 `AbortSignal` 超时（新增 `Config.timeoutMs`，默认 `DEFAULT_TIMEOUT_MS = 30_000`；四处外呼**都走同一处 `withTimeout`**，`#004-01`）⇒ 挂起变成**可捕获的失败**。**TDD**：`minio.test.ts` 加「黑洞端点」用例（`Bun.serve` 收下连接、永不回话），**RED 实得兜底标记**（恰红 1 条 / 对照 22 绿）→ **GREEN 23/0**；opencode 归档＋找回复跑 **27/0**；core / opencode typecheck 过。 |
| X4-2·3 | **挂账 ＋ 回归条件** | 📝 已挂账（见下「补登」）。 |
| X4-4 | **接受 ＋ 如实文档化** | ✅ 已文档化：`archive.ts` 文件头新增「窄窗口」一节——写明「归档没落 ＋ 沙箱已空 ＋ MinIO 有备份」这个**用户可见**的半成功、**恢复＝重试归档**（三函数幂等）、以及「为什么不在本期加『归档中』中间态」。 |
| X5-1 | **改成规范浅金** | ✅ 已修：`file-tree.tsx` 的 `ROW_SELECTED`、`sidebar-tabs.tsx` 的 `TAB_ACTIVE`、`project-panel.tsx` 两处选中态（当前项目 / 选中页签）改用 `bg-[var(--v2-background-bg-accent-soft)]`（先例＝`rail/rail.tsx`）；**顺带统一 X5-2**——`project/**` 的 hover 底全部对齐**全 app house 标准** `hover:bg-v2-overlay-simple-overlay-hover`（`center` / `workspace` / `rail` / `components` 一律用它）：本次把 fork 自造 `layer-03` 的 **12 处**改过来（`dual-file-tree` 3 / `file-tree` 4 / `member-panel` 1 / `minio-bar` 1 / `project-panel` 1 / `sidebar-tabs` 1 / `target-picker` 1），另 **2 处**（`project-anchor.tsx`、`project-panel.tsx`，即 X5-2 的原始两处）本就是它。**TDD**：`file-tree.test.tsx` 加「选中＝浅金 且 ≠ hover」用例，**变异**（把 `ROW_SELECTED` 改回 `layer-03`）**恰红 1 条 / 对照 79 绿**；GREEN `project/**` 组件测试 **217/0**；app typecheck 过；改动 10 文件 lint **0/0**。 |

**补登（裁定后新增的缺口条目）**：

- **X4-2·3（挂账 ＋ 回归条件）**：**本 feature 未覆盖**——`backupAll` / `restoreAll` 对每个文件**逐个 `await`**，无并发、无批数上限；规模上界＝Σ（各成员沙箱文件数）。（⚠️ **更正（第二轮 R2-08）**：原文还列着「无 per-call 超时」——那一项**已由 X4-1 落地**（`Config.timeoutMs`），不再计入本条。）今天是**性能问题不是正确性问题**（`restoreAll` 逐个 `get → 写盘`，不把全部读进内存）。**回归条件**：当真实项目文件数**常态上千**时回来做（届时上界与内存都要重测）。
- **X4-8 / X4-9**（详见上表，本表已登记）：前端 `fetch` 无 `AbortController`（Minor）；`handleCreate` 八步无事务 / 补偿、失败泄漏孤儿目录（Minor）。

### 第二轮对抗审查（`#003-02` · 2026-10-07 · 三席并行 · 靶子＝「修复本身」）

按 `#003-02`「**修完 ≠ 审完**」，把上面四条裁定的**修复**再当靶子打一轮，三席都从**证伪**出发
（①X4-1 超时实现 ②X5-1 / X5-2 前端 token ③本节这堆「事实性说法」逐条去代码核 —— `#004-04`）。
**新账 9 条：已修 4 · 文档更正 1 · 挂账 4**。

> **本节的四条修复落在 `d63f136c47`**（6 文件 / 224 insertions / 18 deletions；R2-01 与 R2-03 各带
> TDD 三段证据，见下面「已修四条」）。⚠️ 这个 SHA 是在**下一提交**里回填的——一个提交写不进自己的
> SHA，故 R2 那一轮收尾时**刻意留白**，收尾时补。

| 编号 | 类别 | 位置 | 描述 | 优先级 | 处置 |
|---|---|---|---|---|---|
| R2-01 | 韧性 | `core/src/minio.ts` / `get` | **X4-1 修了 `put`、漏了 `get`**：定时器在 `client.send` resolve 时就 `clearTimeout` 了，而 `GetObjectCommand` 的 `Body` 是**流**、body 是之后才读的 ⇒ MinIO「发得出头、发不出 body」时 `get`（**找回**路径）**仍无限期挂起**——同一个症状换了个入口 | **Important** | ✅ 已修 |
| R2-02 | 韧性 | `core/src/minio.ts` / `withTimeout` | 回调**同步**抛时（`keyOf` 对非法路径当场抛）`.finally()` 根本接不上那个 promise ⇒ **定时器白活一整段 `timeoutMs`**（每条被拒的非法路径泄漏一个 30s 定时器） | Minor | ✅ 已修 |
| R2-03 | 测试质量 | `sidebar-tabs.test.tsx` / `project-panel.test.tsx` | X5-1 一共改了 **4 处**选中态，**只钉了 1 处**（`file-tree`）⇒ 另 3 处改回 `layer-03` **全套仍绿**（`#004-02`：投影各长各的，没有相等断言钉在一起） | Important | ✅ 已补断言 |
| R2-04 | 前端换皮一致性 | `project-panel.tsx` / `ITEM_NAME_BUTTON` | `project/**` 里**最后一处**非 house hover（`hover:bg-v2-background-bg-layer-01`）；且它当「上游 home 的逐字镜像」这个说法**已不成立**（选中态已改浅金，两半不再对应 —— `#003-05`：假镜像比没镜像更坏） | Minor | ✅ 已统一 |
| R2-05 | 前端换皮一致性 | `sidebar-tabs.tsx` / `file-tree.tsx` / `rail.tsx` | **「选中项 hover 时该不该变色」三处不一致**：`rail` / `file-tree` 的选中项**带** `hover:overlay-hover`（划过去浅金被盖住），`sidebar-tabs` 的 `TAB_ACTIVE` **不带**（划过去保持浅金）。两种都能用，但**没人裁定过**，属既定差异 | Minor | 📝 挂账 |
| R2-06 | 韧性 | `archive.ts`（2 处 `makeStore`） | `timeoutMs` **生产不可配**：两处都用默认 30s，也没有 env 通道 ⇒ 大文件 / 慢链路只能改代码 | Minor | 📝 挂账 |
| R2-07 | 韧性 | `core/src/minio.ts` / `list` | 超时是**每页各拿一次** ⇒ 整轮上界 = **页数 × `timeoutMs`**（有界，不是无限挂起） | 记录 | 📝 已写进注释 |
| R2-08 | 文档账 | 本节 | 三处不实：**(a)** X4-2·3 补登仍写「无 per-call 超时」（已被 X4-1 解决）；**(b)** X4-6 补登写「无重试、无超时……被 X4-1 的裁定一并解决」（超时解决了、**重试没有**）；**(c)** X5-2 标「挂账」而实际已随 X5-1 修掉、计数没回填 | Minor | ✅ 已更正 |
| R2-09 | 前端换皮一致性 | `packages/ui` 的 dark 块 | 深色方案里**没有** `--v2-background-bg-accent-soft`（回落浅色值 `#FEF3C7`）⇒ 近白字压奶黄底、不可读。`DESIGN.md §6.2` 明写**不启用暗色** ⇒ **非本次引入** | Minor | 📝 挂账 |

**已修四条（含 TDD 证据）**

- **R2-01**：`get` 分**两阶段**——① `client.send` **收到响应头就返回**（`Body` 是流，SDK 不替你收完）；② `transformToByteArray()` 才真读。定时器只活到 ①，② 落在超时之外。
  **RED**（`minio.test.ts` 加「发得出头、不发完整 body」端点）：实得**兜底标记**，**恰红 1 条 / 对照 23 绿**。
  ⚠️ **第一次没修好**：只把读取挪进 `withTimeout` 的回调**仍然红** ⇒ 探针定位到 **`abortSignal` 对已经发出的响应流没有约束力**（SDK 只在请求阶段听它，`send` 一 resolve 这条线就断了），必须**自己把中断接到流上**。
  ⚠️ **再接一次也错**：探针（Bun 1.3.14，2026-10-07）实测 **裸 `body.destroy()` 只 emit `aborted` ＋ `close`、`transformToByteArray()` 照样挂着**；**`destroy(new Error(...))` 才 emit `error` 并让读取当场 reject**。
  **GREEN 24/0**。**变异**：`destroy(new Error(...))` → 裸 `destroy()` ⇒ **恰红 1 条 / 对照 23 绿**。同批复跑 opencode 归档＋找回 **27/0**。
- **R2-02**：`withTimeout` 从 `run(signal).finally(clearTimeout)` 改成 **`async` ＋ `try/finally`**（同步抛也走 `finally`）。
  ⚠️ **这一条没有测试守着**——「有没有活着的定时器」本机没有现成观测面，**如实登记**（`#002-02`），别当它已覆盖。
- **R2-03**：`sidebar-tabs.test.tsx` 与 `project-panel.test.tsx` 各补一条「选中＝浅金、未选中的不带」（实得值取 `className` **字符串**，不是节点 —— `#005-01`）。
  **变异**（三处选中态改回 `layer-03`）⇒ **恰红 2 条 / 对照 67 绿**；GREEN **`src/project/` 全部 325 pass / 0 fail（13 文件）**。
- **R2-04**：`ITEM_NAME_BUTTON` 的 hover 统一到 house 标准，注释里写明两条理由（镜像已不成立 / `layer-01` 与底色几乎同色）。
- **R2-08**：上面三处文档更正已就地回填（2293 的计数、2310 的 X5-2 处置、2344 与 2365 的补登、以及「最后更新」里那条）。

**第二轮没抓到的**（据实记，`#003-03`）：核心/前端的**功能性缺陷**零新增——`put` / `list` / `delete` 三条外呼确实都闭合在超时内（`list` / `delete` 的响应体由 SDK 在 `send` **内部**收完再解析，天然被罩住，只有 `get` 是流的例外）；前端 `layer-03` 的 13 处残留**逐一核过**，全是输入框底 / 徽章 / 弹层底 / 内联确认条，没有第二个选中态漏网。

## 待裁定（2026-10-06，T018 BE 半边收尾时报请用户裁定 · ✅ 已裁定，见文末「裁定 (A/B/C)」）

> ✅ **2026-10-06 已裁定**：**照 `gateway.ts` 先例写薄客户端** ＝ 下面的候选 **(C)**。
> 落点：`openhive-fetch.ts`（底座）＋ `openhive-project.ts` / `openhive-files.ts`（两条链），
> 上游 `api.ts` **一字不动**。用户同时裁定 **⑤ 留在 T018、本轮做完**，并另下两条（(4) 不自动选当前项目、
> (5) 新建失败在输入框下显示一句），见「T018」节的「三条新裁定」。



**问题**：**前端怎么够到 fork 的裸路由。**

**为什么它挡住两件事**：① 范围 ⑤「把 `GET /file` 接进 `project-files.ts`」——`project-files.ts`
是模块级信号，文件头写明写入方是「应用入口（或以后的模块动作）」，而 `workspace-entry.tsx`
**拿不到 `useSDK()`**（在六层 provider 之下），被它注释指认为「应用入口」的 `pages/layout-new.tsx`
也**并没有**做这件事（实测假注释，见上「缺口 4」）；② 收口必查项「`current-project.ts` 的 `id`
必须真的等于服务端认的 projectId」——**写进去的是 id，送出去要有路**。

**为什么不能用 SDK 走**：`GET /openhive/project` 是 fork 自己的裸 `HttpRouter` 路由，
**不在上游 `api.ts` 的 endpoint 定义里** ⇒ SDK **类型上没有它**；而裁定 (3) 明写
「**不改上游 `api.ts` 的 endpoint 定义**」。两条同时成立 ⇒ 无路。

**三条候选**

| 候选 | 做法 | 代价 |
|---|---|---|
| **(A) 直连裸路径** | 前端 `fetch("/openhive/project")`，不经 SDK | 零上游侵入；契约写死**两处**（服务端 `PATH` ＋ 前端字符串），丢掉 SDK 现成的身份头与错误处理链路 |
| **(B) 补进上游 `api.ts`** | 按 `HttpApiBuilder` 那套定义 endpoint | 类型与 SDK 全都有；与裁定 (3) **字面冲突**，且**动上游文件** ⇒ 每次同步都要解这处冲突（宪法第一号约束） |
| **(C) 前端自写薄客户端** | `src/project/openhive-client.ts`：自己 `fetch` ＋ 自己 `Schema` 收口，其余前端只认它 | 契约集中一处；仍绕开 SDK，且新增一层要维护的镜像（`#003-05`） |

**我的取向（供参考，不是决定）**：**(C)**——它把「契约只有一处」与「零上游侵入」同时拿住，
代价（一层镜像）可以用一条「`PATH` 与前端常量必须逐字相等」的断言钉住（`#004-02` 的做法）。
但 (A) 更省一层、且 005 现有的三条缝（`project-list` / `project-files` / `current-project`）
本来就是「组件不碰网络」的形状，**(A) 与它们的形状更合**。⇒ **两条都站得住，请裁定。**

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
- ~~**U3**（超期提醒触发者）~~——**已裁（2026-10-07，T024 开工前，见「第六批」）**：服务端在「列项目」时算；范围 ＝ 判定 ＋ 提醒呈现（确认入口复用现成的）；判据 ＝ **先补「访问时刷新 `last_accessed_at`」的写入方**。
- **U2** 未裁（案件实体无 task）——按 `dev_tdd.005.md` 的节奏在对应 task 开工前裁定。**U6（FR-012 并发靠 git）已由 Q2 解决**（载体＝`/shared/{projectId}.git`）；**U8 已由第二批默认执行**；**U7 已由第四批裁定**（半条 ＋ 落 007 的表）。

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

### 第五批：T010 开工前裁定（2026-10-06，同一天）——成员出口**没有接收方**

**为什么这次是开工前**：T004（判定 ＋ 表）、T005–T009（前端面板）三期做下来，「谁能真的把张三分号加进项目 X」这件事**一次都没被问过**——
因为 T004 只交**纯函数**（`membership.ts`，不读库、不抛错）、前端只交**面板**（只喊回调）。开工 T010 前的侦察（`grep` 全 `tasks.md` + 读 T004 的落点表）才把缺口照出来。

| # | 事项 | 裁定 | 落点 |
|---|---|---|---|
| **成员出口** | 「邀请 / 移除 / 退群」的**落库 ＋ HTTP 出口**零任务认领：T004 只交判定与两张表，T010 只交前端面板，T013／T014／T015 是归档线（归档 / 找回 / 失权），T018 的范围是**项目** CRUD | **两件事分开**：① T010 照 T005–T008 口径**只做前端面板 ＋ 接缝**（受控组件、只喊 `onInvite` / `onRemove` / `onLeave`，不新增后端、不真落库）；② **补一条 T021** 认领服务端出口与落库（**编号排最后、不重排既有编号，归 Phase 5**，依赖 `T004`＋`T018`） | 005 `tasks.md` 的 T010 🔒 行 ＋ T021 条目 ＋ 并行组总览（20 → **21** 条） |

**T021 为什么依赖 T018（实证，不是排期偏好）**：邀请的语义是「把某某加进**项目 X**」，前提是项目 X 真的在库里——
而 `project` 行与 `project_ext` 行的**同步创建**归 T018（U4 的「收成一个写入模块」）。在那之前出口没有可作用的对象，
即今天硬做也**测不起来**。

⚠️ **同型先例第三次**：T006 → T018（「建项目/列项目」无主人）、T008 → T020（复制/移动/上传/下载无主人）、
本次 T010 → T021（成员出口无主人）。三次都是**责任被推到边界外、接收方不知道**（`LEARNINGS #002-04`），
三次的处理都是**落进接收方的表**（`tasks.md` 的独立条目 ＋ 编号），而不是只记在自己文档里。

### 第六批：T024 开工前裁定（2026-10-07，同一天）——超期提醒的触发者、范围与判据

**为什么这次是开工前**：T024 是 FR-008 的**下半条**（「超期（3 个月无操作）自动触发提醒，owner 确认后才归档」），`tasks.md` 的条款里明写 ⛔「**开工前必须先裁 U3（提醒触发者）**」，而 `state.md` 的「尚未裁定」清单里挂着的正是它。三个候选取哪一个，决定的是**整条流程**（谁算、在哪算、确认入口归不归本 task），**不能由实现顺手定**。

**开工侦察（实测，`#003-04`）**：

| 取数 | 结果 |
|---|---|
| `grep -rn "last_accessed_at\|lastAccessedAt" packages/*/src` | 生产里**只有建项目写一次**（`server/openhive/project.ts` 的 `handleCreate`）；**读**有两处（列表排序 ＋ 「最近」tab 排序） |
| 该列住在哪张表 | `project_ext`（**每用户库**，`core/src/project/ext.ts`）——`tasks.md` 原文写的「`project` 表」是笔误（同 Q3 裁定的四字段之一） |
| 谁有 `project_ext` 行 | `insertProjectExt` 全仓**只有建项目一个调用点** ⇒ **成员没有这一行**（T015 审查 / T016 实测已记） |

⇒ 推论一（判据来源）：**「3 个月无操作」今天等价于「建项目后 3 个月」**——项目天天在用也照样到期。这正是裁定 ③ 要说的那件事。
⇒ 推论二（残差，如实记）：成员没有 `project_ext` 行 ⇒ 共享项目**只出现在创建者（owner）自己的列表里**，提醒因此天然只到得了 owner；**代价**是「成员在动、owner 3 个月没动」这类情形今天**没有可分辨的输入**（成员根本进不去共享项目，见 T016 挂账）——**记成残差，不写成已覆盖**（`#002-02`）。

| # | 事项 | 裁定 | 落点 |
|---|---|---|---|
| **触发者** | 超期提醒由谁、在什么时候算出来 | **服务端在「列项目」时算**（`GET /openhive/project` 本来就返回 `lastAccessedAt` ⇒ 判定搭在已有那次读取上，前端只画）。**代价如实记：民警不开界面就没有提醒**——三个候选里唯一**不引入调度设施**的 | T024（BE 的列表出口出参加一个布尔） |
| **范围** | 本 task 做到哪 | **判定 ＋ 提醒呈现**；**确认入口复用现成的**（T013 的 `archive` 出口 ＋ T023 的「归档」按钮与二次确认条）⇒ **不新增确认流程、不新增归档出口** | T024（FE 只画提醒） |
| **判据** | 拿什么当「超期」 | **先补「访问时刷新 `last_accessed_at`」的写入方，再按它判**——没有写入方时该判据恒真（见上侦察表） | T024（core 加判定 ＋ 一条 touch 写入路径） |

**本批未裁、由实现层定的两件小事（如实登记，可推翻）**：① **「3 个月」怎么算** —— 取**90 天**（固定毫秒数）而不是日历月：日历月减法有 `5-31 − 3 月 = 2-31 → 3-2/3` 这种归一化歧义，而固定天数确定、单调、可测；② **提醒画在哪些行** —— 画在**过得了 `canArchive` 且 `stale` 的行**（⇒ 只在 owner 自己的行上，且「最近」「全部」两个 tab 都画，因为动作那一半仍只在「全部」tab 里）。

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
2026-10-07（**Step 6 · 收尾 ✅ —— 005 收口**：**25 条 task：24 落地，1 条整条移交**（T022 依赖 `D-13`，本机无 MinIO 不可开工；已落 `deploy-todo.md` 的接收方表）。按标签 **FE 9 / BE 15 / INT 1**（⚠️ runbook 收尾节写的「16 个 task（7 FE / 8 BE / 1 INT）」是任务书自己没跟上的**旧数**，以 `tasks.md` 实测为准）。**两轮审查新账 25 条**：Step 5 五席 **16**（已修 4 / 待裁定 4 —— 用户全取推荐项、均已落地 / 挂账 8）＋ 第二轮三席 **9**（已修 4 / 文档更正 1 / 挂账 4）；**Minors 一律挂账**，没有一条写成「已覆盖」。**本提交做的事**：① `session.md` 从「尚未开始」空壳改写成**已收尾**的交接（交付物一览 / 两轮修了什么 / 用户侧与部署侧移交 / 22 处缺口里最容易读错的 9 条 / 门禁）；② 回填第二轮那条**刻意留白**的 SHA `d63f136c47`（一个提交写不进自己的 SHA）；③ `LEARNINGS.md` **＋5 条**（`#005-04`…`#005-08`：按**被改的落点数**打勾 / 加超时先数**阶段** / 已发出的流不听 `abortSignal` 且必须 `destroy(Error)` / happy-dom 断 `className` 串 / 陈旧 stat 伪影）。<br>**🧭 门禁（本轮最终状态上串行复跑，全部实测）**：core `minio.test.ts` **24 pass / 0 fail / 39 expect**；opencode 项目族 **10 文件 93 pass / 0 fail / 554 expect**；app `test:unit` **930 pass / 0 fail / 3305 expect / 122 文件**、`test:components` **491 pass / 0 fail / 1075 expect / 28 文件**；`typecheck`（turbo）**31/31 successful exit 0**（28 cached，实跑 = core/app/opencode 三个改过的包）；`lint:openhive` **23 warnings / 0 errors / 101 files / 161 rules**（＝基线、无回归）；**文件级 oxlint（仓库根，`#004-10`）本 feature 改动面 83 文件 / 130 rules** ⇒ 命中 **4 条**，**逐条核过全在未改动的既有代码里**（`core/src/project/copy.ts` ×2 ＋ `copy-strategies.ts` ×1 是**上游文件**；`app/src/pages/layout-new.tsx:25` 是上游 `version` 函数，005 只加了 import 与 prop）⇒ **本 feature 改动行 0 命中**；`git diff --numstat bun.lock` **空**（本 feature 未跑 `bun install`）。<br>**交给用户的两步**（本 feature 不自行 merge、不自己打 tag）：`git merge --ff-only worktree-feat-005-project-management`（**主检出**执行）→ 合入后 `git tag v0.1.0-005-project-management`（⚠️ **tag 必须指向最终状态**，001 的教训）。spec 目录 `005-project-management/` **永不删除**。<br>**⚠️ 已知残留**：`packages/opencode/test/server/openhive-project-frozen.test.ts` 在 `git status` 里的 `M` 是**陈旧 stat 伪影**（`--numstat` / `--raw` 全空、blob 与 `HEAD:` 逐字节相同），**未写进任何提交**——已记 `LEARNINGS #005-08`。）
2026-10-07（**第二轮对抗审查（`#003-02`）✅ —— 三席对「修复本身」再打一轮：新账 9 条（已修 4 / 文档更正 1 / 挂账 4）**：抓到的两条重的**都长在刚落的修复里**——① **R2-01**：X4-1 的超时**修了 `put`、漏了 `get`**（`GetObjectCommand` 的 `Body` 是**流**，定时器在 `send` resolve 时就放掉了）⇒ 找回路径**仍会无限期挂起**，与 X4-1 同一个症状；修的过程还实测出两条形状：**`abortSignal` 对已经发出的响应流没有约束力**、**裸 `body.destroy()` 不管用，必须 `destroy(new Error(...))`**。② **R2-03**：X5-1 改了 4 处选中态、**只钉了 1 处**（`#004-02`）。两条都按 TDD 修（RED 恰红 → GREEN → 变异恰红）；另两条 Minor 顺手修（R2-02 定时器泄漏 / R2-04 最后一处非 house hover）。**文档更正 3 处**（R2-08：X4-2·3 的「无 per-call 超时」、X4-6 的「无重试、无超时」**只对一半**、X5-2 的挂账计数）。**落点提交 `d63f136c47`**（6 文件 / 224 insertions / 18 deletions）。<br>
2026-10-07（**Step 5 四条裁定 ＋ 落地 ✅**：Step 5 审查里需要用户裁定的四条，用户**全取推荐项**。<br>① **X4-1（Critical）= 现在就配超时** → `core/src/minio.ts` 给**每一次 `client.send`** 套 `AbortSignal` 超时（新增 `Config.timeoutMs`，默认 30s；四处外呼走同一处 `withTimeout`）⇒ MinIO 僵死从「**无限期挂起**」变成「可捕获的失败」。TDD：`minio.test.ts` 加「黑洞端点」用例（收下连接、永不回话），RED 实得兜底标记（恰红 1 / 对照 22 绿），GREEN 23/0；opencode 归档＋找回复跑 27/0。<br>② **X4-2·3 = 挂账 ＋ 回归条件** → 登记「双层串行、无并发/无上限/无 per-call 超时」，附回归条件「文件数常态上千时回来做」。<br>③ **X4-4 = 接受 ＋ 如实文档化** → `archive.ts` 文件头新增「窄窗口」一节：写明「归档没落 ＋ 沙箱已空 ＋ MinIO 有备份」这个**用户可见**的半成功、**恢复＝重试归档**（三函数幂等）、以及为什么不加「归档中」中间态。<br>④ **X5-1 = 改成规范浅金** → `file-tree` / `sidebar-tabs` / `project-panel` 的选中态改用 `bg-[var(--v2-background-bg-accent-soft)]`（先例 `rail.tsx`）；**顺带统一 X5-2**——`project/**` 的 hover 底全部对齐 house 标准 `overlay-simple-overlay-hover`：本次改 fork 自造 `layer-03` 的 **12 处**，另 2 处本就是它。TDD：`file-tree.test.tsx` 加「选中＝浅金 且 ≠ hover」，**变异恰红 1 / 对照 79 绿**；GREEN `project/**` 组件 217/0；app typecheck 过；改动 10 文件 lint 0/0。<br>下一步：**第二轮审查（`#003-02`）**——把这些修复本身再当靶子打一轮。）
2026-10-07（**Step 5 · 代码审查 ✅（五席并行 · runbook 六类）**：范围 `8e20357f59..b02c64a861`（83 文件 / 62 新文件 / 39 提交）。五席：横切一致性与防御 / 测试质量与断言牙齿 / 上游侵入面与重构取舍 / 韧性 / 前端换皮一致性；每条由我回代码逐条核对（`#004-04`）。**去重后 16 条新账** —— <br>**✅ 已修 3**：X3-1（`backupAll` 只 put 不 delete ⇒「归档→找回→删 B→再归档→再找回」B **静默复活**；加**收敛**，先传后删；RED 恰红 1 条 / 对照 11 绿，GREEN 12/0；`03f4fbe436`）· X3-3（非法项目头被 `throw` 折成 **500**；改回 **400**、与同文件 `sessionID` 同口径；旧断言把 defect 也当「被拒」收下所以一直绿；RED 实得 500，GREEN 10/0；`dc0facdfbf`）· X2-6（`script/oxlintrc.openhive.json` 注释里的存量基线还停在「4 目录 62 文件」，已补记「现为 6 目录」）。<br>**⏸ 待裁定 4**：X4-1（**Critical**：`S3Client` 无任何超时 ⇒ MinIO 僵死时归档/找回**无限期挂起**）· X4-2·3（`backupAll`/`restoreAll` 双层串行 `for`＋`await`，无并发/无上限/无 per-call 超时）· X4-4（`releaseAll` 先于 `markArchived` ⇒ PG 抖动时「**归档没落 ＋ 沙箱已空 ＋ MinIO 有备份**」的半成功窗口，用户可见）· X5-1（选中态用中性 `layer-03` 且与 hover 同色，而 `plan.md`/`DESIGN.md` 指定浅金 `--v2-background-bg-accent-soft`，`rail.tsx` 用的正是它）。<br>**📝 挂账 8**（X5-2 已随 X5-1 修掉，不再计入）：X1-1（`file.ts` 四个出口无 `decide`，今天 fail-closed，补缺口时须同时补）· X3-2（`plan.md` R3 的「上传校验＋归档前确认完整性」**无对应物且零登记** —— `#002-02` 违例，本表补登）· X4-6（T014 缺口 1 **引错条目** ⇒ 上传侧「无重试/超时」过去并未真正挂账，已更正）· X4-8（前端 `fetch` 无 `AbortController`）· X4-9（建项目八步无事务/补偿 ⇒ 失败泄漏孤儿目录）· X5-3（圆角 token 四种并存）· X2-4（T015 那处改动是**就地重写** T017 的 fork 自建行）· X2-7（T015 提交信息缺「保留的定制」）。<br>**迁移类零缺陷**（0005 的 down/up 逐项对称、无 `CONCURRENTLY`）。**一处我自己的更正**：发起审查时我把 `router.ts`/`workspace-entry.tsx`/`app/src/project/**`/`auth/**` 也当成「上游文件」，席 3 独立核对证明**它们是 fork 自建、不在 `upstream/dev`** ⇒ **真上游侵入面只有 3 文件**（`server.ts`/`layout-new.tsx`/`package.json`）。<br>**第二轮（`#003-02`）**：待四条裁定落地、按裁定修完后，把「修复本身」再当靶子打一轮。详见新增「**Step 5 · 代码审查**」节。
2026-10-07（**T024 收尾 ✅ —— 超期自动提醒（FR-008 的**下半条**）：判定 ＋ 提醒呈现 ＋ 补写入方**：FR-008 有两半——上半「手动归档」T013 落地、T023 给入口；本 task 是「**超期 3 个月自动提醒 ⇒ owner 确认后才归档**」。**三个半边**：**core** `project/ext.ts` 的 `STALE_AFTER_MS`（90 天定值）＋ `isStale(lastAccessedAt, now)`（**纯函数、不取时钟**——取了就测不出边界，而这条判据唯一要说清的正是边界：**恰好 90 天算超期**，`>=` 不是 `>`）＋ `touchProjectExt`；**BE** `server/openhive/project.ts` 的 `GET` 出参多一个 `stale`（`handleList` 里 `now` **一次取、整列共用**）＋ **新出口** `POST /openhive/project/touch`；**FE** `openhive-project.ts` 的 `touchProject` → `project-data.ts` 的 `ProjectData.touch` → `workspace-entry.tsx` 的 `onOpen` 记账 → `project-panel.tsx` 行上的「超期未归档」徽章。<br>**🔒 三笔开工前裁定（用户，全取推荐项）**：① 触发者＝**服务端在「列项目」时算**（搭在已有那一次读取上；代价如实记「**不开界面就没有提醒**」，三候选里唯一**不引入调度设施**的）；② 范围＝**判定 ＋ 提醒呈现**、**确认入口复用现成的**（**未新增确认流程、未新增归档出口**——整套复用 T013 ＋ T023）；③ 判据＝**先补写入方再判超期**。<br>**⭐ 四处刻意**：① **`stale` 与 `memberCount` / `archived` / `role` 恰好相反**——那三个「缺键就是缺键」，它**一定给**（`false` 也给）；FE 侧 `readEntry` 只认 `=== true`，理由**不是**「来源没说」而是**代价不对称**（少一条提醒最多晚一天收拾；把没有依据的行读成超期，会在**没超期**的项目旁、**同一行就有「归档」按钮**的情况下画出提醒，民警照着它把**在用**的项目归档掉——沙箱文件当场被搬走）。② **必须是独立的 `POST …/touch`**（三条替代方案全被否，且都不报错不变红：塞进 `list` = 读出口变成自己的写入方 ⇒ `stale` 恒假、提醒永不出现；塞进 T017 中间件 = 每请求都写；前端自己算 = 判据抄进 JS）。③ **授权是结构性的、没有 `decide` 可问**（`project_ext` 在每用户库、`where project_id = ?` 天生只动自己那行）⇒ **不给 `PROJECT_ACTIONS` 加「访问」动作**，判据用**结果**钉（touch 别人的 ⇒ 200，而**对方那行一个毫秒都不动**、自己库里**不凭空多一行**）。④ **FE 提醒门 = `canArchive(project) && stale === true`**（复用 `decide`、组件零规则复述）且**不与归档按钮绑同一个 tab**（每天打开的是「最近」）。<br>**📌 一处不实记述的更正（`#004-03`）**：`tasks.md` 原文写该字段在「**`project` 表**」——不成立（按 Q3 裁定它在**每用户库的 `project_ext`**，FR-002 排序用的就是它）；同日实测**写入方只有一处**（只有建项目那一步写）⇒ **今天「3 个月无操作」等价于「建项目后 3 个月」**。已原地改正、不改原文。<br>**✅ 变异 7 组，全属 `#003-03` ① 类（恰红目标、对照不红）**：M1 `stale` 硬写 false ⇒ 恰红 2；M2 去掉 touch 的体解码门 ⇒ 恰红 1；M3 core 边界 `>=`→`>` ⇒ 恰红 1；M4 `touchProject` 只看状态码 ⇒ 恰红 2；M5 去掉 `stale === true` ⇒ 恰红 1；M6 去掉 `canArchive` ⇒ 恰红 2；M7 去掉 `onOpen` 记账 ⇒ 恰红 1；**M7′ 反向**（把记账塞进「拉清单」）⇒ 恰红 2 且**含「进门拉清单 ⇒ 不记访问」那条对照自己** ⇒ 该对照**非空**（它守的正是被否掉的第一个替代方案）。7 处均已还原（残留探针 0 命中、正句 4 处各 1 命中），并**在最终树形上重跑门禁**。<br>**⚠️ 未做变异 / 无测试可钉（据实记，不写成已覆盖）**：`touch 别人的项目` 那条的敏感面在 **`DatabaseRouter` 按用户分库**（003 的接线，不在本 task 改动面内）⇒ 未变异它；本 task 里这条只实抓过一次**假绿**并已修——原判据只断 `status === 200`，而**未挂载的路径被 SPA 兜底回 200 ＋ `text/html`**，出口不存在时它**照样绿**；改成 `touchOk`（200 **且**体能当 JSON 解且 `projectId` 相符）后 RED 才诚实（**5 fail / 1 pass**，`#004-08`）。另：`now` 提到 map 之外只对**语义**负责，90 天阈值下与逐行取时钟**不可分辨** ⇒ **可读性选择、不是判据**，不补测试也不假装有；「已归档的行不带提醒」对 M6 不敏感，它守的是**结构**（归档组不过 `Group`）。**TDD 次序**：三条链都是 RED 先行，`touchOk` 是 **RED 阶段抓到假绿后补的**。<br>**🧭 门禁串行全过（实跑，一律 `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`）**：core **12/0/21**；BE 四文件 **47/0/229**（`-stale`（新）＋`-frozen`＋空 `openhive-project`＋`-file-ops`，~56s）；app `unit` **930/0/3305/122 文件**、组件 **394/0/789/18 文件**；三包 `typecheck` 全过；**文件级 oxlint（仓库根，`#004-10`）改动 12 文件 0/0/130 rules / exit 0**；本次**未跑 `bun install`** ⇒ `bun.lock` 一行未动。<br>**⛔ 残差（沿用开工侦察，本 task 未改变）**：**成员没有 `project_ext` 行** ⇒ 共享项目的提醒**天然只到创建者**，「成员在动、owner 3 个月没动」今天**没有可分辨的输入**；**不开界面就没有提醒**；阈值今天等价「建项目后 90 天」——写入方虽已补，但只有「**点开项目**」会刷新它（下载 / 上传 / 改文件**不算访问**），这是「访问」的定义问题、按裁定收在「打开」。见「T024」节）
2026-10-07（**T021 收尾 ✅ —— 成员管理的四个出口：名单 / 邀请 / 移除 / 退群，BE ＋ FE 接线一次做完**：`ProjectMembership.decide`（T004 的纯函数）与 `member-panel.tsx`（T010 的三颗按钮）中间那一段**终于接上了**。**用户三条裁定**：取 T021 ／ 接线落点取**自有目录 `server/openhive/`**（办结 `tasks.md` 那条 ⚠️）／ **BE ＋ FE 一次做完**。<br>**两半**：**BE `ef5a6a3ee5`** ＝ 新 fork 自有路由 `server/openhive/member.ts`（四个出口）＋ 挂进 `httpapi/server.ts`（**11 insertions / 0 deletions**，带【保留的定制】）＋ auth 两处「加」（`user.ts` 的警号 ⇄ UUID 翻译层、`project-member.ts` 的 `removeMember`）＋ `openhive-project-member-route.test.ts`（18/0/47）；**FE** ＝ 新 `openhive-members.ts`（薄客户端、`listMembers` 三态、三条写出口共用 `memberAction`）＋ `openhive-members.test.ts`（**23 pass / 0 fail / 24 expect**）＋ `project-data.ts` ＋4 方法 ＋ `workspace-entry.tsx` 接线（名单 effect ＋ 三个 handler ＋ `member-op-message`）＋ `workspace-entry.test.tsx` **＋10 条**。<br>**★ 核心是「翻译」**：`project_member.user_id` 存 UUID，界面说的全是**警号**——不翻译**不报错**，只会画出一列谁也看不懂的字符；翻译只能在服务端（本仓只有 `packages/opencode` 同时看得见两张表），故 FE 层**一个 UUID 都不出现**（`#002-06`）。<br>**★ 三处刻意（各有专门观测面）**：① **名单的门是成员身份、不是 `decide`**（归档**冻的是动作、不是看见**）⇒ 同一已归档项目上「名单读得到、邀请 403」；② **授权的顺序**——邀请先判授权、再解析警号（反过来非成员能拿 400/403 的差别当「这个警号在不在」的探针；**端点断言对顺序不敏感**，`#004-09`）；③ **移除的目标只能取自本项目名单**（改按警号直删不报错，只会删掉别人项目里同一个人的行）。**为此四个出口一律不带 `x-openhive-project`**（带了会被 T017 中间件套上「已归档 ⇒ 403」）——`#002-06`：同一个判断只留一处。<br>**⚠️ 一笔账（`#004-03` 的又一实例）**：`tasks.md` 里那条 ⚠️ 写「`membership.ts` 的文件头写着接线归 `packages/opencode/src/project/member.ts`」——`grep` 实测那句**在 T015（`403ad2fafb`）就被改掉了**，本 task 开工时**早就不在**。办的是它的**意图**：在接线行补上 `server/openhive/member.ts`。判据：**「文件头写着 X」也会假，开工前必须 `grep`**。<br>**✅ 变异 18 处据实记三类**：**BE 7 处**（拿掉名单的门 1 ／ `policeId` 不翻译 4 ／ 解析挪到授权前 1 ／ 拿掉邀请的门 4 ／ `remove` 按警号直删 1 ／ 拿掉退群的门 2 ／ 不读归档态 3）＋ **FE 11 处**（M1–M11，2/2/1/1/1/1/1/1/2/1/1），**全部①类（恰红目标），无②③类**，对照均不红。⚠️ **M3（切项目先清空名单）是补出来的**——端到端用例对它不敏感，补了一条**窗口用例**（新项目的名单永不落地）才钉住，恰红**只红那一条**（`#004-09` 的现场）。⚠️ **M11 证明「没注入数据源 ⇒ 三颗按钮禁用」确有牙**（否则那三条 `?.disabled` 可能是空断言）。**全部已还原**；⚠️ **这些数字来自会话记录 / BE 提交信息，收尾只复跑了门禁、未重跑变异**（已在节内标注）。<br>**🧭 门禁串行全过（实跑）**：app `unit` **922/0/3295 expect/122 文件**、`components` **480/0/1052 expect/28 文件**；单跑 `workspace-entry.test.tsx` **90/0/212**、`openhive-members.test.ts` **23/0/24**；`typecheck`（turbo）**31/31 exit 0**；`lint:openhive` **23 warnings / 0 errors / 101 files**（＝基线，**本次文件 0 命中**）；**文件级** oxlint（仓库根，`#004-10`）本次 **7 文件 0/0/130 rules / exit 0**；`git diff --numstat bun.lock` **空**。<br>**⚠️ 测试夹具抓到一处既有缺陷（非本 task 引入，本次修掉）**：`workspace-entry.test.tsx` 的 `mount()` **从不调用 `render()` 的 dispose** ⇒ 旧实例一直订阅着那几条模块级接缝，后一个用例改项目时**旧实例**用自己的假数据源取数再写回同一条缝 ⇒ **谁的回包最后落地谁赢**。证据：`Received: [ "资料", "资料/话单.csv" ]`，而 `["资料/话单.csv"]` 在本文件**只出现一次**（那处 stub 无视 id）；本 task 每实例多一个名单订阅者，把它从「偶尔」拨成「常红」。修法 ＝ `afterEach` **先卸载、再清 body**；修后连跑三次全绿，该文件 **~50s ⇒ ~6s**。**同型 `mount()` 散落在 `src/**/*.test.tsx`**（`center/views`、`project/`、`auth`），但只有「会写接缝的组件」咬得到——**挂账**。<br>**⛔ 缺口 / 残差（已落「T021」节）**：**重复邀请**在并发下撞 PK ⇒ 500（预检只把 500 翻成 400）；被邀者**不做 `status` / `deactivated_at` 过滤**；**三份逐字相同的 `messageOf`** ＋ **两份 `asRole` / `actorIn`**（记账、留给下次单开一笔）；**`成员话` 切项目不清**（与已审过的 `文件话` 同款）；**`member-panel.tsx` 把 `undefined` 与 `[]` 都显示成「还没有成员」**（对 403 / 网络错是句假话；修它要动 T010 已审组件与它钉住的断言 ⇒ **只记账**）；`workspace-entry.test.tsx` 里那句写死的条数又漂一次（现 **90** 条 vs 注释写 **27**）。另：`openhive-project-frozen.test.ts` 在 `git status` 里又是 `M` —— 与 T023 记的同一枚**陈旧 stat 伪影**（`--numstat` 为空），**未写进本次提交**。见「T021」节）
2026-10-07（**T020 收尾 ✅ —— 文件树的复制 / 移动 / 上传 / 下载：四个**真执行**出口 ＋ 客户端接线**：右键菜单那四项**真能执行**（复制 / 移动共用一个目标目录选择器、上传走文件选择器含拖入、下载把字节取回落盘），四项**一律要求 `x-openhive-project` 头在场**（头不在时文件路由退回**裸沙箱根**＝所有项目的父目录）。**权限锚「不新造判定」**——搭 F3 沙箱那道锚走，不是 `project_member`、不是 `core/access`。**四条裁定（用户全取推荐项）**：共用选择器／服务端落 fork 自有新文件 `server/openhive/file.ts`（上游 `api.ts` 一字不动）／上传走 `multipart/form-data`／**「拖出浏览器到桌面＝下载」挂账**（下载只走右键菜单）。**改动 15 个文件**（生产 8 ＋ 测试 7）；**上游侵入面 1 处** —— `httpapi/server.ts` **9 insertions / 0 deletions**、带 `【保留的定制 · 同步上游时不要丢】`；**与它挂载的 `file.ts` 同属一次提交**（硬拆：`server.ts` 的 import 解析不了 ＋ 测试走 `HttpApiApp.routes`、少了挂载四条路由全 404 ⇒ 拆不出「既过测试又只含上游那一处」的提交），**前端半边另起一次提交**；`bun.lock` 一行未动。<br>**★ 第二轮审查（`#003-02`，三席并行）抓到 5 条、全部已修**，最重一条是**本次 diff 自己引入的 Critical**：`inside` 是**纯词法**判据而复制/上传/下载走**跟随链接**的系统调用 ⇒ 项目里一个指向**兄弟项目**的 junction 就能让四项动作**全都伸到项目外**（探针独立复现：`copyFile` 真把兄弟项目的文件写进沙箱根）⇒ 新增 `realInside` **四处**落点 ＋ 下载 `stat`→`lstat`，**RED 先行 14 pass / 5 fail → 19 pass / 0 fail**。另四条：**「不带头上传」那条断言判别力为零**（只发同名 ⇒ `exists` 预检 ＋ `wx` **各自**就回 400，绿得毫无信息；补**新名**「偷渡.txt」作真判据）／四处 `tasks.md:177` **引用错行**（真锚在 **171**，改成点名内容，`#004-05`）／`openhive-file-ops.ts` 拿「挂账」去指 `tasks.md` 而那里写的是「两条都要」（改成明说二者不同、指向本节，`#004-03` 同族）／测试文件指向的「变异记录」当时不存在（本节即是）。<br>**✅ 变异 21 组据实记三类（`#003-03`）**：BE **14 组**（M1 12/1、**M2 11/2 属②类**、M2b 12/1 **只有移动那条红**、M4、M5、M11–M19 各恰红 1）＋ FE/UI **7 组**（**F-M1 红 3、F-M5 红 3 皆②类**，F-M2/F-M3/F-M4 恰红 1、F-M6 红 4、`file-tree` 去掉 `types.includes("Files")` 恰红 1）。⚠️ **M19 ≡ M2b**（同一处同一改法，跑过两次）**记为同一条证据、不重复计数**；**M15 的报错文本在同一行号打印两次**（不是两处都触发，由 **M16** 恰红在**另一行**反证）；**F-M5 第一次改法（翻转判据）得 7 红**，换成「摘掉」才是要测的形状 —— 两次都记 ②类、**不写成恰红**。⚠️ 表里 **M1/M2/M2b/M4/M5 五行的数字是从会话记录回收的、本轮未复跑**（已在节内标注）。<br>**🧭 门禁串行全过**：新文件（opencode）**19 pass / 0 fail / 92 expect**；opencode 项目族 **10 文件 88/0**；app `components` **470/0/28 文件**、`unit` **895/0/121 文件**、`browser` **41/0/14 文件**；`typecheck` **31/31 exit 0**；`lint:openhive` **23·0·99 files·exit 0**（改动文件 0 命中）；根 `lint` **4953 w / 1 error / exit 1**（那 1 个 error 仍是既有上游 `prompt-input/index.tsx:163`，**改动文件 0 命中**）；`bun.lock` 空。⚠️ **一次「看着像红」的测量**：opencode 同族合并跑首报 **29 pass / 1 fail（30 条）**、串行复跑两次均 **29/0**，逐文件单跑 **10 / 19** ⇒ 29 才对，首跑多吐一个**匿名条目**（`#003-01`：先怀疑测量）。<br>**⛔ 缺口（已落「T020」节）**：**「拖出浏览器到桌面＝下载」没做**（裁定挂账；三条平台事实：`dataTransfer` 在 `dragstart` 后**只读** ／ `DownloadURL` 要真 HTTP URL 而**带不了项目头** ／ 行今天本就不可拖——`draggable` 挂在属 **T022** 的 `onBackup` 上），⚠️ **「拖入＝上传」这另一半做了**；**上传无体积上限 ＋ 四项无超时**（**R1，留人裁定**——上限是产品数字，不凭空造常量）；**移动的「目标已存在」在竞态下有缝**（无独占改名原语，复制有 `COPYFILE_EXCL` 兜底、**移动没有**）；`Content-Disposition` 清洗与 `inside` 的 UNC/盘符判据本机测不出；**两条旧账本次不修**（`workspace-entry.test.tsx:466` 注释写死「27 条」而实际 **80**，出处 `6afafc08` ／ `workspace-entry.tsx:316` 指向「state.md 的欠账表」与「AI 资产」而全仓 `grep` **零命中**，出处 `2c35b888`）——遵「外科手术式改动」。见「T020」节）
2026-10-07（**T023 收尾 ✅ —— 项目归档的 FE 入口 ＋ 找回入口**：民警点得到「归档」（「**全部**」tab 行内、**二次确认**后才送出）、能在「已归档」tab 看见它并**找回**。**判定一份都不在这里**——全走 `ProjectMembership.decide`，组件零规则复述，后端 `archive.ts` 各自再判一次（宪法 IV）。改动 **11 个文件**（生产 6 ＋ 测试 5），**上游文件 0 处**、`bun.lock` 未动（`git diff --stat bun.lock` 空）。四条裁定（用户全取推荐项）：列表多给 `role`（新增 `rolesOf` 批量读）／「归档」只画「全部」tab（设计 §8.1）／归档成功 ⇒ **重拉清单 ＋ 清当前项目**／缺口 12 只规避 ＋ 继续挂账。**门禁全绿（串行）**：app `components` **431 pass / 27 文件**、`unit` **870 pass / 120 文件**、`browser` **41 pass**；opencode 项目族 9 文件 **67 pass**；auth **238 pass / 1 skip**；`typecheck` **31/31 exit 0**；`lint:openhive` **23 warnings / 0 errors**；根 `lint` **4953 warnings / 1 error**（唯一 error 是**既有上游** `session-ui/…/prompt-input/index.tsx:163`，我改的 11 个文件 **0 命中**——阳性对照：同份输出里 `member-panel` / `file-tree` 有 35 处命中）。**变异 17 组**（主阶段 12 ＋ 审查补 5）；补的 5 组全属 `#003-03` ① 类「恰红目标那一条」，主阶段 **M5 属 ② 类「整组红、连对照一起」**（据实记，不写成恰红）。<br>**★ 第二轮审查（三席并行 ＋ `#003-02`）抓到 3 条「声明的语义没有断言守着」，全部已修**：① **最重 ＝ 本 task 自己引入的回归**——面板调用方把 `onRestore` 写成 `(p) => void 办(p, props.onRestore)`（**恒真函数**），把 `ArchivedGroup` 里 `<Show when={props.onRestore}>` 那条「不给回调即不画」整个绕过 ⇒ **未接线时「已归档」tab 多出一个点了没反应的「找回」**；根因就是**我自己写下的规矩只贯彻到一个出口**（`问归档` 旁那段注释明写「靠的是调用方不递」）——正是 `#003-02`。② `rolesOf` 的 `where user_id = ?` 那半条**没测试钉住**（原用例把成员行**全删**了 ⇒ 丢过滤得到同样空结果、两条都绿），补「把我那一行换成 BOB 的 ⇒ ALICE 仍无 `role` 键」（判据特意**不**写成「owner 拿 owner、member 拿 member」——那要靠 SQL 返回顺序才决定红不红，是不稳定的红）。③ 「**找回不碰当前项目**」是**裁定过的语义**，而本节找回用例的 `beforeEach` 都清成 `undefined` ⇒ 补一句 `setCurrentProject(undefined)` 全绿；补两条（找回另设当前项目 ＋ **归档没办成也不清**）。**挂账（Minor）**：找回无「在办」锁（连点两次发两次，非破坏性）／非 400/403 失败体被丢（内核 **MinIO 未配回 503 ＋ `{error}`**，民警只看到「归档项目失败」——**与缺口 12 同源、合并挂账**）／回调抛异常时面板静默（沿用 `建` 的既有约定）／`roleOf` 的 `null`·数字边界未钉（行为已 fail-closed）／`rolesOf` 在 `packages/auth` 无**单元**测试（安全属性已由集成用例守住）。<br>**⚠️ 射程外（如实记，不是「做了」）**：设计 §8.1「归档触发」写了**两条**路径——「『全部』tab 内，**或项目名右键**」；本 task 只落前者（右键是 T008 的机制、不在 `ProjectPanel` 里）。**⚠️ TDD 偏差如实记**：**面板段与客户端段的生产代码先于测试写成**（不是 RED→GREEN），证据由**变异**补（7 组）；只有**接线**段是真 TDD（先 **62 pass / 6 fail** → 改 → **68 pass**）。<br>**⚠️ 工具怪癖（本 task 起所有门禁 / 变异一律带 `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`）**：不设它时 bun 的运行时转译缓存在**复用**时**确定性**报 `Expected JSX element name but found "?" at …file-icons/sprite.svg:1:2`，使整个测试文件**中止**（`0 pass / 1 fail / 1 error`）——**看着像「还没跑完」，不是「失败了」**（连跑 5 次全挂；`-t "zzz不存在zzz"` 同样失败 ⇒ 加载期而非用例级）。本会话独立复现并**细化**：缓存目录**首次写**那一轮必过、**紧接着复用同一个已写过的目录必挂**；换无关 env（`OPENHIVE_PROBE=1`）**仍挂** ⇒ 不是「随便加个变量就好」。性质同 `#003-01`：**先怀疑测量，再怀疑被测物**。另：`openhive-project-frozen.test.ts` 在 `git status` 里显示 `M` 是**陈旧 stat 伪影**（`git diff`/`--numstat`/`--raw` 全空，工作区 blob `1e64044d…` 与 `HEAD:` **逐字节相同**）⇒ **内容零改动**，**未**写进本次提交的改动清单。）
2026-10-06（**T016 收尾 ✅ —— 会话私有（FR-011）＋ 文件并发靠 git（FR-012）：实测为「只钉属性、零生产代码改动」**：只加 `packages/opencode/test/server/openhive-project-shared.test.ts`（新，**5 条 · 55 expect**）＋ 本 docs 两份；**`packages/*/src` 一行未动、上游文件 0 处**。**FR-011 的增量不是重述 003**——`tenant-db-isolation.test.ts` 的 describe 是「跨库隔离（T012 · **FR-010** / SC-001）」，钉的是**任意两个用户**；本 task 钉的是**同一个共享项目里的 owner 与 member**（一条新的潜在泄漏路径），oracle **不经过被测对象**（直接读两个库文件 ＋ 双向 404 ＋ 双向 list）。**FR-012 走完整流程**：⓪ 先断 **`--is-bare-repository` = true**（**这条承重、别当装饰**，见下）→ ① 甲 clone ＋ 建 `trunk` ＋ commit ＋ push → ② 乙 clone → ③ 甲改、commit、push → ④ 断乙**工作区没变**（＝不做实时协同）→ ⑤ 乙改、commit → ⑥ 乙 push **被拒**（`exitCode !== 0` 且 stderr 含 `rejected`）→ ⑦ fetch ＋ merge ⇒ 非 0 且 `diff --diff-filter=U` 里**有那个文件** → ⑧ 解冲突、commit、push → ⑨ **第三个检出**从 bare 取留痕（三条提交信息 ＋ 合并后正文）。全程走上游 `Git` 服务（**不自己 spawn**：那串 `-c core.autocrlf=false` 等是本机 `core.autocrlf=true`（`#003-07`）下仓库落盘形态与上游一致的前提，照 `project.ts` 的 `gitInit` 注释办）。**★ 两条实测发现（`#003-04`）**：<br>① **成员带项目头被无声忽略**——`project_ext` 是**个人态**、T018 只给**创建者**写一行 ⇒ 成员那头查不到 ⇒ 中间件**静默退回沙箱根**（`projectID` 读作 `"global"`，四行探针取数已固化进文件头）。这是 T017 文件头早写过的退化路径在**会话链**上的第一个实例；**因此下面一律用「不带头的会话」去钉隔离**（带不带头对成员是同一结果 ⇒ 拿头当判据会**假绿**）。⚠️ **挂账**：「**成员进不去共享项目的目录**」与「**成员那几个检出由谁建**（clone 到 `{沙箱根}/{memberId}/{projectId}`？）」在 `tasks.md` 里**仍然零任务认领**——修它 = 新能力，属 **T018 / T021** 地界（`#002-04`）。<br>② **「必须是裸仓库」只有一道防线**——去掉 `--bare` 后 ①–⑨ **全绿**：非裸仓库的当前分支是那个**未出生**的默认分支，推 `trunk` 不被 `receive.denyCurrentBranch` 拦。⇒ **M2 只红 ⓠ 那一条**，其余全靠它守着；这条性质今天**只由测试里一句断言钉着**，已记缺口。**✅ 变异 2 处、三类据实记（`#003-03`）**：**M1**（`router.ts` 的 `hook.resolve` **不看身份**＝恒用本层自己的库）⇒ **3 红 2 绿**，红的是三条声称隔离的用例**含对照**（「owner 带真头落在自己库与项目目录」也红）＝**②类**，**不许写成①类恰红**；**M2**（`project.ts` 去掉 `--bare`）⇒ **恰红 1** ＝ **①类**（无对照被误伤）。两处变异**均已还原**（`git diff --stat packages/opencode/src packages/core/src` **为空**）。**⚠️ 开工抓到的三处夹具坑**：(a) `bun:sqlite` 导出名是 **`Database as Sqlite`**（不是 `Sqlite`）；(b) `session` 表的列名是 **`project_id`**（`packages/core/src/session/sql.ts`）——`projectID` 只是 Schema 解码出的**线上形状**，照着响应体写 SQL 会红成 `no such column:`；(c) `canonical` 漏掉 **`realpathSync.native`** 时 **win32 假红**（`ADMINI~1` vs `Administrator`）——**这是对 `#003-04` 的补充**：那条原写「探了三种取法都返短名 ⇒ 复现不出来遂不写」，本次**复现出来了**，条件是**差异的一方是被测对象**（应用自己 realpath），**不是**夹具侧的自比。**🧭 门禁串行全过**：新文件 **5 pass / 0 fail / 55 expect**；同族 9 文件 **69 pass / 0 fail / 446 expect**；`typecheck`（turbo）**31/31 exit 0**；文件级 oxlint（**仓库根**，`#004-10`）**0 warnings / 0 errors / exit 0**（首跑 2 warnings：`rowsOf` 死导入 ＋ `queryOne<T>` 的 `no-unnecessary-type-parameters`——收掉 `queryOne`、把查询内联进 `sessionRow`，**当场清掉、不留账**）；`lint:openhive` **exit 0（23/0 ＝ 基线，本次文件 0 命中）**；根 `lint` 本次新增文件 **0 命中**（全局 4952 w / 1 error ＝ 上游 `prompt-input/index.tsx:163`，裁定不私改）；`git diff --stat bun.lock` **为空**。**⛔ 缺口（已落「T016」节）**：成员的项目头被无声忽略 ＋ 成员检出无归属；「裸仓库」只靠一条断言钉着；FR-012 只钉「git 能这么用」，**没有**钉「共享项目里真有这个 bare 仓库给成员用」（建它属 T018、用它得先解决成员检出归属）。下一步 = **T020 / T021 / T023**（前置齐；T023 是 FE）。见「T016」节）
2026-10-06（**T025 收尾 ✅ —— 「归档 = 冻结」射程外那类出口：实测为「只钉属性、不加门」**：原设想＝给「会话身份不在 `params["sessionID"]` 里」的出口补一条**端点级中间件**。**取数推翻了前提**——出参**已经达成**，达成它的**不是**中间件，是 **`Permission` 的实例分桶**（pending 挂在 `InstanceState.make` 上、按 `ctx.directory` 分桶 ⇒ 答复请求落不到会话那个实例就查不到）。**四行实测（已固化成用例）**：无头 **404**／诱饵头（ACTIVE）**404**／真头（FROZEN）**403**／解冻后＋真头 **200**（消费且那一轮继续）。**原设想的中间件是 no-op**：它在**同一实例**里 `Permission.list()` ⇒ 跨项目 pending 不在该实例、列表恒 `[]`。⇒ **用户裁定「只钉属性、不加门」**：**生产代码 0 行、上游文件 0 处**，只加 `packages/opencode/test/server/openhive-project-frozen-pending.test.ts`（新，2 条）＋ 本 docs 两份。**两道门都管不着它**：第一道门（项目头）**够不着**会话（带了也只会落到**另一个**实例、仍 404）；第二道门（`params["sessionID"]`）**根本不跑**（这条路由只有 `requestID` 参数 ⇒ 正是 T015 缺口第 11 条说的射程外）。**⚠️ `question` 同形属推断、`sync`／`warp` 仍挂缺口**（会话身份在**请求体**、**不**经过 `Permission` 分桶 ⇒ 很可能真没门；**未实测** ⇒ 挂账，`#002-02`）。**★ 一枚夹具假红：`42P05 duplicate_prepared_statement`**——第一版夹具「fork 那一轮 ＋ 每 100ms 轮询」**稳定**假红（被 fork 那一轮回 500、长得像「门在并发下崩了」）；真因是 **PGlite 的预编译语句名是实例级的**（socket 服务端汇进同一个 PG 会话）⇒ 同一进程**两个并发请求撞同一句 SQL** 就 500；**生产是多连接池 ⇒ 不会撞** ⇒ 是**夹具产物**（`#003-01`：先怀疑测量）。修法＝夹具**先进程内等**（等假模型被调用、一个 HTTP 都不发）、再发列表请求（那时那一轮已阻塞在 `Permission.ask`）；**别改回紧轮询**（文件头有注释）。建议给 `pg.ts` 文件头补「**并发**也会撞」一句，**本轮按裁定不改**。**🧭 门禁串行全过**：同族 8 文件 **59 pass / 0 fail**；新文件 **2 pass / 0 fail / 32 expect**（3 连跑稳定，~39 s）；`typecheck`（turbo）**31/31 exit 0**；文件级 oxlint（**仓库根**）**0 warnings / 0 errors / 130 rules / exit 0**（首跑 3 warnings ＝ `marker!` 多余非空断言 ⇒ 当场改成 `if` 收窄、清掉）；`lint:openhive` **exit 0（23/0 ＝ 基线，本次文件 0 命中）**；根 `lint` 本次新增文件 **0 命中**（全局 4953 w / 1 error ＝ 上游 `prompt-input/index.tsx:163`，裁定不私改）；`git diff --stat bun.lock` **为空**。**✅ 变异 2 处（`#003-03` 三类据实记）**：**M2**（`instance-state.ts` 的 `directory` 换常量 ⇒ 单桶）**整组红含夹具**＝**②类**（不证明判据有牙）；**M3**（`permission/index.ts` 的 `pending` 拉成模块级）**恰红 1**＝**①类**（无头答复 404→200、只它红，8 expect）——⚠️ **调序前**红是 `SchemaError: Expected object, got true`，按 `#004-14` 把**状态码排到正文字段前** ⇒ 红变成 `Expected: 404 / Received: 200`；两处变异**均已还原**（`git diff` 对 `src/` 为空）。另改正 `tasks.md` 一处**不实数字**（「共 24 条」⇒ **25 条**）与四条**路径名**（`/api/...` ⇒ v1 裸路径）。见「已完成 → T025」节）
2026-10-06（**T015 收尾补记 · 第二轮两席审查全部落地**：① **对抗证伪席**实测的 **F1（Critical）**已修（`8976cc5b5f`）；② **横切与上游侵入面席**独立从 `7c3596e34e..403ad2fafb` 的代码推出**同一机制**，并逐条判六类。**R2 是本门自己引入的回归，已按 TDD 修掉（`9affc63b86`）**：第二道门拿**客户端说了算**的路由参数去 `SessionID.make()` 造带 brand 的会话 id，而 brand 检查（`packages/schema/src/session-id.ts` 的 `isStartsWith("ses")`）**失败是同步 throw** ⇒ 在 `Effect.gen` 体内变 **defect** ⇒ **500**（`Effect.option` **只接 typed failure**）；实测 `GET /api/session/foo` 加门之前 **400**、之后 **500**，影响面**不是个例**——**所有**带 `sessionID` 路由参数的 `/api/*` v2 请求都经过这一行。修法 = `Schema.is(SessionID)`（**刻意不写 `startsWith("ses")`**：那是把 schema 判据镜像一份到本文件，上游改前缀/改哈希时**不报错、不变红，只会静默放行本该被拦的会话**）。用例 ⑨ 先红（`Expected: 400 / Received: 500`，**8 pass / 1 fail**、只它红 ⇒ 该次 RED **同时是成牙证据**）、后绿。③ **R3 / R4**（`POST /api/permission/:requestID/reply` 与 `/api/question/:requestID/reply|reject` 的会话身份在**资源 id**；`POST /api/sync/steal` 与 `/api/experimental/workspace/warp` 的在**请求体** ⇒ 一律在第二道门射程外，已归档会话里**挂起的工具审批仍可被放行**）**经用户裁定「挂缺口 ＋ 补编号」** ⇒ 落 T015 缺口第 11 条 ＋ **新编号 T025**（排最后、不重排）；⚠️ **端到端利用未实测**，且实操面被 T013 削弱（沙箱目录归档时已删 ⇒ 放行的工具落地撞 `ENOENT`），**据实记为「真缺口、非已知可利用」**。④ **R6**（`packages/app/src/project/openhive-files.ts` 只把 `!response.ok` 折成 `false` ⇒ 403 的 JSON 体到不了 UI，**T023 接线时要一并处理**）落缺口第 12 条。⑤ 该席判「**无发现**」的两类：**R9**（迁移，本次无 schema/数据改动）、**R10**（防御性编码，两道门都用 `Effect.option` / 显式 `?? false`，未见吞错）；**R7 上游侵入面**逐 hunk 核对**成立**——T015 在 `server.ts` 的改动**全是「加」**（三处 `Layer.provide(OpenhivePg.layer)`），`workspace-routing.ts` **一字未动**，`Session.Service` 进的是 **fork 文件**的 `requires`。⑥ 它另做了一件我没做的实测、**补了 `#004-11` 的边界**：**同一次 `bun test` 里模块级状态跨文件共享，而 `globalThis` / `process.env` 不共享**（把 `pg.ts` 改回模块级 ⇒ 归档＋找回两文件 **16 pass / 10 fail**，与 `pg.ts` 文件头「实测 10 fail」吻合）。**🧭 门禁（R2 修复后，串行）**：`openhive-project-frozen.test.ts` **9 pass / 0 fail / 29 expect**；受影响 7 文件 **57/0/350**（修前 56/348）；文件级 oxlint（**仓库根**）**0/0/130 rules / exit 0**；`typecheck`（turbo）**31/31 exit 0**。**📌 缺口数 10 → 12**（第 11 条已由 **T025** 认领、第 12 条归 T023）。下一步 = **T016 或 T025**（两条前置都齐；T025 与刚落的判据同源、上下文最热）。见「T015」节）
2026-10-06（**T015 收尾 ✅ —— 归档 = 冻结（FR-010 / US5）：两道门**：**没有新写一份判定**——core 加 `ProjectMembership.frozen`，与 T013/T014 用的 `decide` 是**同一条规则的两个投影**，等值关系由 `packages/core/test/project-membership.test.ts` 的 T015 组**故意会红**地钉着（遍历 `PROJECT_ACTIONS` × `archived` × 三种 actor，断言「`frozen` ⟺ 归档态下没有任何非 `restore` 动作成立」，`#004-02`）。门落在 `packages/opencode/src/server/routes/instance/httpapi/middleware/project-location.ts`（**fork 文件**，是「加」不是「改」）：**两道门共用同一个 `isArchived()`**——① 带 `x-openhive-project` 的请求走 `ProjectExt.findByProjectID` ⇒ 归档 ⇒ 403；② **目录来自会话行**的那一半（会话作用域路由的工作目录取自**会话行**，不取自请求：A 链 `workspace-routing.ts` 的 `session?.directory || defaultDirectory(...)`，B 链 `packages/server/src/middleware/session-location.ts` 直读 `SessionTable.directory`）⇒ 由 `MatchedRoute.current` 的 `params["sessionID"]` 取会话（**不拿 URL 原文比对**：`R-01`/`R-02` 证明 `/session/ses_x/message/`、`%61`、`;x` 都匹配同一条路由）⇒ `relative(沙箱根, 目录)` **恰好两段**且第一段 = 本人 id ⇒ 归档 ⇒ 403。**🔒 四笔裁定（用户）**：开工前**三笔**（均取推荐项）——① **冻结射程 = 延伸：已归档一律拒（含 owner）**（沙箱文件已上传 MinIO 并删除 ⇒ 放行只会把**空目录**重建出来、把归档变成半个撤销；⚠️ 风险如实记：将来 T022 的 MinIO 浏览若也带这个头会被挡，今天它前置不齐）；② **门的位置 = `project-location.ts` 中间件 ＋ 403 JSON**（该头服务端**唯一**的消费者，一次覆盖会话/文件/pty/上传 = `#004-01` 的锚法；403＋JSON 与归档/找回同口径）；③ **判据落点 = 查一次 `project_archive`、判据与 `decide` 同文件**（用现成的 `archiveStatesOf`（单元素）⇒「归档 = 冻结」仍只有**一处定义**；代价每请求多**一次** PG 往返。**否掉**：走 `decide`（还要查 `project_member` 拿角色 ⇒ 每请求两次往返，而「角色」今天**没有真实消费者** ⇒ 猜形状 `#004-07`）；中间件里直接 `if (archived) 403`（两处各写一份，`#002-06`））；开工后**第四笔（D1 处置）= 本 feature 内补第二道门**（起因是我自己复核出的旁路：建会话时带了头、以后用这个会话**不必再带**）。**⚠️ 池子收口另起一个提交**（`2862dcaed6`，按 `CLAUDE.md`「定制单独提交」）：原先建/列项目与归档/找回**各持一个惰性池** ⇒ 收成 `OpenhivePg.layer`。**刻意不做模块级单例**——模块级在「多文件一起跑」时**必红**（第二个文件会用上第一个文件那个已在 `afterAll` 停掉的库，**实测 10 fail**）；层记忆化既共享、又让每个文件拿回自己的库。动因是**夹具失真**：PGlite 夹具的预编译语句是**实例级**的，两个客户端跑同一句 SQL 文本撞 `42P05 duplicate_prepared_statement`（症状 500、与判据无关、谁先跑谁赢）。**⚠️ 次序是裁定的**：第一道门的归档检查排在 R5（`project === undefined` 直通）**之后**——便宜的 SQLite 读先排除外人/幽灵项目，再付 PG 往返；PG 挂掉时未知项目的请求仍走 R5 而不 500（代价已记缺口）。**本次唯一的上游侵入面**：`Session.Service` 进了中间件的 `requires`（用 `Session` 而非自己查 `SessionTable`：那是生产真正走的读法，不该有第二份实现）。**✅ 变异 7 个、三类据实记（`#003-03`）**：**M11** 删第一道门的归档检查整行 ⇒ **整组红 4**（①②③⑤ 红、④⑥⑦⑧ 绿）＝ ②类；**M10** 第二道门挂回 `if (projectId === undefined)`（= 恢复 F1 的 bug）⇒ **恰红 1**（用例 ⑧），**两式诱饵分别见证**（把诱饵① 临时换成会话所属的已归档项目头 ⇒ 执行推进到诱饵②、红在它那里）；**M5** 拆掉第二道门 ⇒ 恰红 1；**M6** 会话目录推导恒 `undefined` ⇒ 恰红 1；**M7** `?? false` → `?? true` ⇒ **恰红 2**（用例 ④ 与 ⑦，共享默认值的两个出口各一条；⚠️ **加用例 ⑧ 之前的快照**）；**M8** `params["sessionID"]` → `["sessionId"]` ⇒ 恰红 1；**M9** 去掉「第一段必须等于本人 id」那道防线 ⇒ **全绿 7/0** ＝ **③类测不到**（处置：**留着 ＋ 记缺口**，不删码——它是让判定**自己站得住**的等式，理由写在该函数 JSDoc 里）。**🔍 审查：第一轮三席 ＋ 第二轮两席（`#003-02`）**。第一轮纠正三处**不实记述**（皆属 `#004-03`）：① 「403 vs 503 的差 = 门排在 handler **之前**」是**假的**（那个差只证明门在**不在**；门若排在 handler 之后，带头这一枪同样是 403）；② 「owner 行与 `project_ext` 行同生共死」按字面是**假的**（成员今天就没有 `project_ext` 行，而项目完全可能已归档）；③ `membership.ts` 表里写的接线文件 `project/member.ts` **不存在**，实为 `archive.ts` ＋ `project-location.ts`。第二轮**对抗证伪席**实测出 **F1 → Critical**：第二道门第一版挂在 `if (projectId === undefined)` 里 ⇒ **「请求有没有说自己属于哪个项目」被当成了「要不要问会话行」的开关**——带**任意**一个不是「已归档项目」的头（查不到的 id ⇒ 第一道门 R5 直通；**本人名下的活跃项目** ⇒ 第一道门按它放行**并改写目录**），归档项目里的旧会话照常干活；实测同一归档项目、同一条会话、同一个应用，**只差一个诱饵头，403 → 200**。⇒ 修复提交 **`8976cc5b5f`**（那段从 `if` 里提出来、**无条件先问会话行**）＋ 用例 ⑧ ＋ 文件头两处改准（「没有项目头 ⇒ **不改写**请求」，不再是「一次都不碰/连库都不查」）＋「已知不覆盖」补四条；同席登记 **F3–F7**（参数名 fail-open / pty 走 `ptyID` / 缺失归档行的默认值三处各写一份 / 第一道门排在 R5 之后），**均进缺口表、不写成已覆盖**。**🧭 门禁串行全过（F1 修复后）**：新文件 `openhive-project-frozen.test.ts` **8 pass / 0 fail / 27 expect**；`packages/opencode` 受影响 7 文件 **56/0/348**（T015 前基线 55/342）；`packages/core` `project-membership.test.ts` **17/0**；`typecheck`（turbo）**31/31 exit 0**；文件级 oxlint（**仓库根**，`#004-10`）**0/0/130 rules/exit 0**；`lint:openhive` **exit 0（23 warnings / 0 errors / 161 rules ＝ 基线，本次文件 0 命中）**；根 `lint` 本次改动文件 **0 命中**；`packages/app` `test:components` **405/0/27 文件** ＝ 基线（本题**零前端改动**）；`git diff --stat bun.lock` **为空**。**⛔ 缺口 10 条（已落「T015」节缺口表）**：M9 测不到；「门排在 handler 之前」在**管理类链**上测不出来（无观测面，`#004-09`）；第二道门只认**恰好一层**目录；**参数名 fail-open**（F3，上游改名/新增第三条会话链即静默放行）；**pty 在射程外**（F7，走 `ptyID`，**未实测**）；「缺归档行 ⇒ 未归档」**三处写法**（F4，同口径但无断言钉住）；**第一道门排在 R5 之后**（F5，裁定的次序 ⇒ 已归档 ＋ 无 `project_ext` 行时 200 落沙箱根）；第二道门多一次会话行读 ＋ 可能一次归档查询（安全换成本）；**归档项目会话整体冻住**的连带（连 owner 读自己的会话也 403）；**T023 接线规矩**（**别给「找回」的调用带项目头**，加了就再也找回不了）。**📌 移交留痕**：`2862dcaed6` 那笔池子收口**开工时未先问用户**即改了 `project.ts`/`archive.ts`/`server.ts` 三处**已提交**代码（**用户可否决**）。下一步 = **T016**（未完成项里依赖最少：只依赖 T003 ⇒ 前置已齐）。见「T015」节）〔补记 2026-10-06：本条的门禁数字（8/0/27、56/0/348）与「缺口 10 条」**已被上方那条取代**（9/0/29、57/0/350、缺口 12 条）；缺口第 11 条由新编号 **T025** 认领〕
2026-10-06（**T014 收尾 ✅ —— 项目找回（FR-009 / US5 / 设计 §8.3）**：给 `packages/opencode/src/server/openhive/archive.ts` 加**第二个出口**（`POST /openhive/project/restore`，`PATH.restore`）＋ 新测试文件 `openhive-project-restore.test.ts`（**11 条**／664 行）＋ `-unconfigured.test.ts` 加**第 3 条**；`packages/auth/src/project-member.ts` 加 `markRestored`。**⚠️ 接线只加一行**（`routes` 里 `router.add("POST", PATH.restore, …)`），**`server.ts` 一行未动**——沙箱根（`AnchorWorkspace.Config`）与 `MinioConfig` 那个层 T013 已经供上。**同一个文件而非新建 `restore.ts`**：两方向共用 `MinioConfig`/`endpointOf`/`MinioSettings`/`asRole`/`Deps`/三个响应构造/路径段守卫（另起文件要么复制 ⇒ `#002-06`、要么把私有件导出 ⇒ API 外扩），且 `plan.md` 原本就写 `archive.ts # 项目归档/找回`。**🔒 开工前两笔裁定（用户，均取推荐项）**：① **共享 bare 仓库 `/shared/{projectId}.git` 归档/找回都不动它**——它是**项目级** git 载体、在 `/shared` 共享卷上，而 MinIO 对象键只镜像**各人沙箱**（`minio.md` §1）⇒ 项目级对象塞不进按 `{userId}` 分区的键空间；代价如实记账（`/shared` 占用**不随归档释放**）⇒ 落 `minio.md` §1 末段 ＋ `docs/workspace/deploy-todo.md` **D-14 第 ④ 项**，T014 实现量**零**（`#002-04` 那笔就此**关掉**、不再往下挪）。② **标记最后落**：`archived=false` 等**下载全部成功**后才落——把 design §8.3 的「②改状态 ③下载」调成与 T013 归档同一条次序；理由：中途失败时项目**仍是「已归档」**、可重试，界面不会谎称已找回。**八步（与归档逐条同形，只有 ⑥⑦ 反向）**：`① 身份 → ② 归档态 → ③ 授权判定（ProjectMembership.decide，core 纯函数） → ④ 配置检查（Option.isNone(deps.minio) ⇒ 503） → ⑤ 成员 id 逐条校验 → ⑥ 全员下载（restoreAll，只读 MinIO ＋ 只写沙箱） → ⑦ 标记最后落（markRestored）`；③ 仍在 ④ **之前**（未授权的人不该从 503/403 读出部署状态）。**⚠️ 找回是同一条 (c) 裁定的镜像，不是自由选择**：成员已失权（FR-010）自己触发不了，只还原 owner 那一份则成员的文件永远留在 MinIO 里、直接违背 FR-009 ⇒ `restoreAll` 里**每个成员各造一个 `Minio.makeStore`**（`scope={userId:该成员, projectId}`）——与 `backupAll` 是**同一条不变量**、只是方向反过来；**拼错方向不报错不变红**，只会让成员找回时拿到**别人的**文件。**`restoreAll` 三处刻意的选择**：① **清单空 ⇒ 跳过、不建目录**（凭空给没 clone 过的成员建空项目目录 = 让他的文件树显示一个**他从没有过的项目**）；② `mkdir` **逐级递归**（键里的相对路径带目录，只写一层在 win32/POSIX 上都会 `ENOENT`；`.git/**` 一并回来也靠这条）；③ `store.get` 回 `undefined` ⇒ **抛出、不静默跳过**（`list` 刚说这个键在；跳过会让「找回完成」与「沙箱里少一个文件」同时成立、而调用方只看得见前者）。**`markRestored` 是 `update` 不是 upsert**（对照 `markArchived` 的 upsert）：走得到这里 = 上一句刚从表里读出 `archived=true` ⇒ **那一行必然在**；写成 upsert = 允许「本来没有也行』，把「该翻的那一行找不着」静默算成成功。`archived=false` 与 `archived_at=null` **必须成对写**（迁移的 `project_archive_coherence_check` 钉着这一对）。**残差如实记**：`update` 命中 0 行**同样成功返回**、调用方分辨不出——那条路今天**不可达**（没有代码删 `project_archive` 的行），真要防得数 `rowsOf(update)` 而那条形状在两驱动下是否一致**没验过**（`#002-01`）⇒ **不写没验过的判据**。**⚠️ `-unconfigured` 第 3 条的观测面要多造一个条件（`#004-13`）**：钉「找回里 ③ 授权排在 ④ 配置之前」需要**未配置 ＋ 非成员 ＋ 项目已归档**三个条件——少第三个就退化（**未归档**时 `RULES.restore` **恒 false**、**连 owner 都拒** ⇒ 那条绿**证明不了**「403 是因为你不是 owner」）⇒ 用 `标成已归档` **夹具注入**（本文件 MinIO 配了一半 ⇒ 真归档跑不了），并**先断言注入生效**（`前置` 那两句），否则 403 会退化成「未归档 ⇒ 谁都拒」、**看着一样绿**（`#002-02`）。**✅ 变异 5 个，据实记三类（`#003-03`）**：**M1** `markRestored` 提到 `restoreAll` **之前** ⇒ **恰红 1**（「下载失败 ⇒ 项目仍是已归档」，8 pass/1 fail）；**M2** 删找回里的 `isSafePathSegment(projectId)` 门 ⇒ **恰红 1**（逃逸用例 `projectId="."`）；**M3** `restoreAll` 所有成员**共用一个 store**（`targets[0]` 的 scope）⇒ **红 2**（「谁的东西进谁的沙箱」这条不变量的**两个投影**；**无对照被误伤** ⇒ 属**②类**，**不许写成①类恰红**）；**M4** 调换找回的 ③④ ⇒ **恰红 1**（`-unconfigured` 第 3 条 403 变 503；**restore 那 8 条全绿** ⇒ 这条次序**确实只有它**在钉）；**M5** 成对写拆开（只 `set archived = false`）⇒ **红 4**（所有「成功找回」的用例，**同一根因**：库的 `project_archive_coherence_check` 真的拒了 ⇒ 500；未授权/失败那 3 条仍绿 ⇒ 属**②类**）。每条改完即还原、复跑回绿。**🧭 门禁串行全过**：`packages/opencode` 找回 **11 pass / 0 fail（106 expect）** ＋ 归档两文件 **18 pass / 0 fail（124 expect）**；`packages/auth` `project-member.test.ts` **14/0**；`packages/core` **1211/8/5** ＝ 基线（5 条按名比对全是 `NpmConfig.*`、**无新增**）；`packages/app` `test:components` **405/0/27 文件** ＝ 基线（⚠️ **须** `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`，见下）；`typecheck`（turbo）**31/31 successful，exit 0**；**文件级** oxlint（**仓库根**跑，`#004-10`，4 文件）**0 warnings / 0 errors / 130 rules / exit 0**（⚠️ 首跑 1 warning：新测试里 `test` import 未使用 ⇒ **当场清掉、不留账**）；`lint:openhive` **exit 0**（**23/0/161** ＝ 基线，本次文件 0 命中）；根 `lint` 本次 **4 个改动文件 0 命中**（全局那 1 error 仍是 `#001-02` 记的上游 `session-ui` 文件，裁定不私改）；`git diff --stat bun.lock` **为空**。**⚠️ 一条工具怪癖复现（T018 记过，本次又撞上）**：`test:components` 在**启用默认运行时转译缓存**时本次实测 **257 pass / 3 fail / 3 error**（`Expected JSX element name but found "?" at …/file-icons/sprite.svg:1:2`，级联出空白 `# Unhandled error between tests`），而 `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` ⇒ **405/0/27** ＝ 基线。**先怀疑测量**（`#003-01`）：本题**零前端改动**，那 3 红与代码无关。**⛔ 不在本 task（缺口表 / 挂账）**：MinIO 下载**无重试 / 超时 / 熔断**（与上传同款、全项目一致的缺口，大项目一次外呼抖动 = 整个请求 500、可重试但**无退避**）；找回的**写方向没有符号链接守卫**（归档那侧有 `filesUnder` 的 `lstatSync`＝**读**方向 S2-01，而 `restoreAll` 是**写**方向——`mkdir`/`writeFile` 碰到沙箱里已有的符号链接会**跟随**它写到别处；今天触发面窄但**没有测试钉着**）；`restoreAll` 的**重入 / 部分成功语义未测**（标记没落时重试 = 重下一遍；判据是「幂等」还是「覆盖」没验过）；**FE 的找回入口零认领 ⇒ 与归档入口同归 T023**（出口存在但**没有按钮**，生产里找回**点不到**）；`fake-s3.ts` 的「生产不得 import」**仍无门**。**🔍 审查（子代理，六类，2026-10-06）0 条必须修**，报 F1–F7：F1（找回缺 401 与畸形体两条 ⇒ 对齐归档侧）**已办但据实改写** —— 补完后**取成牙证据**发现 **401 那条没有牙、且是结构性的**（**M6** 删 `handleRestore` 的守卫 ⇒ **11 条全绿**；**M8** 删 `handleArchive` 的同一行 ⇒ 归档两文件 **18 条全绿**——**这条同时更正了 T013 收尾时的理解**：那条 401 用例钉的一直是 `user-identity.ts` **中间件**，不是 handler 的守卫，handler 那行**不可达**）；**畸形体那条有牙**（**M7** 恰红 1：400→500）；**没删那行**（与归档逐条同形是整条链的骨架，单删一侧会让两个 handler 悄悄分叉），改为**挂缺口第 10 条**。F2（4 处 `?.archived_at).not.toBeNull()` 是弱形式：行没了时实得值 `undefined`、**照样通过**）**已修** —— 抽 `仍是已归档(id)` 助手，**先断行在、再断字段**，与 `-unconfigured` 第 3 条**同口径**。F3–F7 挂缺口（F3/F4 原已记；**F5** `get === undefined` 分支本地测不到、**F6** 空目录不还原 ⇒ 往返非逐字节完整、**F7** 「八步同形」只靠复制粘贴维持、单侧漏改不会变红 ⇒ 新增第 7/8/9 条）。审查**逐项核实成立**的关键项：同形①②③④⑤ 对着被调方**逐条打勾**、`server.ts` 一行不动属实、`markRestored` 的重入不可达、主判据非空（逐键全等能拦住「把 owner 的备份铺给所有成员」）、oracle 不经过被测对象、找回只有一条出口。下一步 = **T015**（FR-010 的正向出口：已归档项目上成员一律被拒；⚠️ T014 只把**找回出口**那一侧钉住，**别当成「失权已覆盖」**）。见「T014」节）〔补记 2026-10-06：该「下一步」**已办结** —— T015 收尾见本文件顶部那条〕
2026-10-06（**T013 收尾 ✅ —— 项目归档（FR-008 / US5 / 设计 §8.2）**：新建 `packages/opencode/src/server/openhive/archive.ts`（`OpenhiveArchive.routes` —— `POST /openhive/project/archive`，体收 `{projectId}`）＋ `openhive-project-archive.test.ts`（**15 条**）与 `openhive-project-archive-unconfigured.test.ts`（**2 条**）；给 `packages/auth/src/project-member.ts` 加 `markArchived`（`archived=true` ＋ `archived_at` 的 **upsert** —— 找回后再归档会撞已存在的 `project_id` 主键，主键冲突在这里是**正常流程**）；观测面 `packages/core/src/test-support/fake-s3.ts`（**从 `test/fixture/` 迁入 `src/`**：`packages/opencode` 要 import 它，而 core 的 `exports` 是 `"./*": "./src/*.ts"`，放 `test/` 下**够不着**）；接线 `server.ts` 的 `Layer.mergeAll` 加一项（沙箱根**复用** `AnchorWorkspace.Config`、与项目出口同一个；`MinioConfig` 是本层自己的配置服务，**必须在这里供上**——路由体在层构造期 `yield*`，漏供是**层构造期炸**）。**🔒 (c) 裁定落地**：`backupAll` 里**每个成员各造一个 `Minio.makeStore`**（`scope={userId:该成员, projectId}`），不是共用一个前缀——拼错方向不报错不变红，只会让成员找回时拿到**别人的**文件。**⚠️ 「服务端批处理特权路径」与 003 不冲突**（已写进模块文件头）：003 的隔离是**请求作用域**的，而本模块作用对象**来自服务端的 `project_member` 表**、入参里**只有 `projectId`**；调用点凭据＝该项目的 **owner 行**（`decide`），拿到 owner 行且只拿到它才能替全体成员跑。**⚠️ 次序是要求**：`① 身份 → ② 归档态 → ③ 授权判定 → ④ 配置检查（503） → ⑤ 成员 id 逐条校验 → ⑥ 全员上传 → ⑦ 全员删 → ⑧ 标记最后落`；③ 在 ④ **之前**（别让人从 503/403 读出部署状态）；⑥⑦ 是**两个函数**、中间隔一次 `await`（合成循环＝「传一个删一个」，第二个成员上传失败会让第一个的沙箱**已经没了**而项目**没**被标归档）。**⚠️ 用户裁定「按 (c) 改写 `minio.md` §1 ＋ 扩 D-13 实测项」**（§1 末段「始终只动调用者自己的前缀」与 (c) 字面冲突，已改；D-13 格已扩）。**关键实测（`#003-04`）**：`Config.option(Config.all({…}))` **粒度是整组**（全缺/缺一个 ⇒ `None`，全给 ⇒ `Some`）⇒「endpoint 有、密钥没有」＝配了一半；`filesUnder` 的跳过口径**分两层**，**根那一步**用 `lstatSync`（`existsSync`/`statSync` **跟随**链接 ⇒ 成员把 `{userId}/{projectId}` 换成指向别处的链接就能把**别人的目录**读进自己前缀，而 `rm` 只删链接＝**泄漏不是破坏**，S2-01）；win32 用 `junction` 造链接**不需管理员**、`rm` 只删链接不删目标；**「未挂载」不是 404**（SPA 兜底回 200 ＋ `text/html` ⇒ 判出口必须断 `Content-Type`）；**`git init` ＝ 18 个文件（＋`.git/opencode` 1 ＝ 19）**——原先写的「~1038」错**两个数量级**（S3-08）。**🚩 未查到底、已挂账**：**一进程多 app 时，除进程第一条请求外，任何新 app 的首查被 `PostgresError: Connection closed` 打回一次（3–11ms，非超时），下一条自愈**；四条实测 + 读 `server.ts` 后**证伪**了我原先「生产不存在这场景」的说法（`handler(request, HttpApiApp.context)` 与 `Effect.provide(HttpApiApp.context)` 共用**同一份模块级** `Context.makeUnsafe(new Map())`，而 `createRoutes()` 每个 listener 调一次 ⇒ **可能生产可达**）⇒ 这也是两个测试文件**必须分开**的原因。**✅ 变异 5 个全部①类恰红**：M1 `lstatSync`→`statSync` 红 1（符号链接用例「别人的东西没被搬走」）；M2 删 `isSafePathSegment(projectId)` 门 ⇒ 红 1（逃逸用例的**副作用**断言——哨兵真的没了，`join(root,userId,".")`＝整个沙箱），**不是**状态码那条；M3 调换 ③④ ⇒ 红 1（403 变 503）；M4 `releaseAll` 删整个成员沙箱 ⇒ 红 1（「隔壁专案」存活，S3-06）；M5 `endpointOf` 去协议判断 ⇒ 红 1（拼出 `http://https://…`）。**⚠️ 三席评审抓到我的不实记述（已改）**：S1-01/S2-02 逃逸用例原自称「400 ＋ 零副作用」而三条断言**恒真**（重写取 `projectId="."`——**过** `Minio` 段检查、**过不了** `isSafePathSegment`，且需**注入一行 `project_id="."` 的 owner 行**让逃逸路径真走得通，`#004-13`）；S3-02「生产不存在一进程多 app」被读码证伪；S3-03 三处「已挂缺口表」当时**都不存在**（本节的缺口表就是它们的落点）；S3-08 数字；S1-03/S3-05 重入注释说错判据（实为秒粒度 ＋ 断言次序）；S1-04 `.git` 用例补成两成员各进各前缀；S3-06 补「隔壁专案」存活观测面；S3-09 `endpointOf` 提成导出函数（⚠️ **不是 RED-first**，成牙证据取 M5）。**🧭 门禁串行全过**：归档两文件 **15/0（102 expect）** ＋ **2/0（14 expect）**；同族四文件 **23/0**；`packages/core` **1211/8/5**（5 条按名比对全是 `NpmConfig.*`、**无新增**）；`packages/auth` **238/1/0**；`packages/app` `test:components` **405/0/27**；`typecheck` **31/31 exit 0**；文件级 oxlint **0/0/5 files/130 rules**；`lint:openhive` **23·0·161·exit 0** ＝基线；`bun.lock` 一行未动。**⛔ 不在本 task（已落本节缺口表）**：**补 T023**（FE 归档入口，用户裁定「排最后、不重排」）、**补 T024**（FR-008 的「超期 3 个月自动提醒」，S3-04 指出 22 条零覆盖；⚠️ 开工前**必须先裁 U3**）、共享 bare 仓库归档后**既不上传也不删除**（移交 T014）、空目录不备份、`.git` 一并上传、每成员一个 `S3Client` 而无 `close`（S2-06）、`assertSafeSegment` 的 `DRIVE` 会误伤 POSIX 上的 `C:xxx` 文件名（S3-07）、`fake-s3.ts` 的「生产不得 import」**无门**（S1-06）。下一步 = T014（依赖 T013）。见「T013」节）
2026-10-06（**T018 FE 半边收尾 ✅ —— T018 整条完成**：用户裁定 A/B/C **取 (C)「照 `gateway.ts` 先例写薄客户端」**、并裁定 **⑤ 留在 T018 本轮做完**，另下两条（(4) **不自动选当前项目**、(5) **新建失败在输入框下显示一句**）。新建 4 个文件：`openhive-fetch.ts`（底座：`ForkFetch`／`defaultSend`／`trySend`／`readJson`／`isRecord`，**两条链共用一份**）＋ `openhive-project.ts`（`GET`/`POST /openhive/project`，`CreateProjectOutcome` 三态）＋ `openhive-files.ts`（`listProjectFiles`：**深度优先**走 `GET /file?path=`，**带 `x-openhive-project` 头**，只收 `type==="file"`，**一条走不通 ⇒ 整份 `undefined`**）＋ `project-data.ts`（窄接口 `ProjectData` ＋ 生产绑定 `PROJECT_DATA`）。接线：**上游文件** `pages/layout-new.tsx` **＋5 行**（1 import ＋ 1 prop，带【保留的定制 · 同步上游时不要丢】——这是本 task 唯一碰上游的地方）；`workspace-entry.tsx` 三件事（进门拉清单／`createEffect` 换项目拉文件／`onCreate` 接线）。**两条闸各有真出口**：`清单代次`（挡「进门那一次」与「建完重拉那一次」的迟到，`#004-01`）、`onCleanup` 作废（挡换项目时上一轮文件响应迟到）。**顺带改掉 T007 落下的不实注释**（「由 `layout-new.tsx` 拿 `useSDK()` 组」实测为假）＋ `＋` 旁那句「T018 后要再定一次」（**定过了**，见裁定 (3)：`＋` 保持「打开面板」）。**新增 44 条**（18＋11＋3＋9＋13）。**门禁串行全过**（`test:unit` **856/0/3211/120 文件**，基线 824/0/117 ⇒ ＋3 文件＋32 条；`test:components` **405/0/918/27 文件**，基线 383 ⇒ ＋22 条，**差额已对账**：HEAD 全量 383 = 53（workspace-entry）＋18（project-panel）＋312，我的 62＋31 ⇒ 383＋9＋13＝405；`typecheck` **31/31**；`lint:openhive` **23·0·exit 0** ＝基线**逐项相同**；根 `lint` 本次文件 **0 命中**；`bun.lock` 一行未动）。**据实记三类「红」**：① **lint 初测 26 = 基线 23 ＋ 我引入的 3**（`consistent-return`／`no-base-to-string`／`no-unsafe-type-assertion`）⇒ **三处全修掉、不留账**；② **typecheck 红 8 条**（只有 `tsgo` 看得见、运行期全绿）：2 个 fixture 的 `type` **拓宽成 `string`**（⇒ 4 条）＋ `onCreate={(input) => 记.push(input)}` **回调返回 `number`**（⇒ 4 条，`onCreate` 的返回是**联合**不是裸 `void`，TS 的「返回值被丢弃」特例不适用）；③ **变异 W 系列 8 处**：W1–W4、W6 各恰红 1，**W5 = 2 红**（目标 ＋ 一条真实依赖项「进门那次清单迟到」，可解释），**W7 = 2 红**（目标 ＋ T005 时代那条，同一性质保护了两次），**W8 = 全绿**（`#003-03` ③：**据实记为全绿**）——W8 的根因查出来了：`workspace-entry.test.tsx` 的 `mount()` **把 `render()` 的 dispose 丢掉** ⇒ 早先组件一直活着、继续写模块级缝，把被测值顶掉（探针实测：变异下缝里是**上一个用例**的 `["资料/话单.csv"]`）⇒ **不是「测试没覆盖」，是「挂载没卸载」**，挂账。**⚠️ 一条新工具怪癖（值一次排查）**：`bun test` **启用默认运行时转译缓存**时**间歇性**报 `Expected JSX element name but found "?" at .../sprite.svg:1:2`、整个文件中止并**级联**出空白 `# Unhandled error between tests`；`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` ⇒ 完全确定。实测对比（同命令同树）：**禁缓存 405/0/27** vs **默认缓存 257/3/3 error**。性质同 `#003-01`：**先怀疑测量**。见「T018」节）
2026-10-06（**T018 BE 半边收尾 🟡**：新建 `packages/opencode/src/server/openhive/project.ts`——`GET /openhive/project` 列项目 ＋ `POST /openhive/project` 建项目（**八步顺序**：建目录 → `git init` → **写仓库里的 `opencode` 缓存文件（`ProjectV2.commit`）** → `fromDirectory`（只跑一次）→ 改名 → 仅共享项目再 `git init --bare {共享根}/{id}.git` → `project_member` 写 owner → `project_ext` 落 `type`/`shared_directory`/`last_accessed_at`）＋ `server.ts` **＋12 行**挂进 `Layer.mergeAll`（带 `【保留的定制 · 同步上游时不要丢】`，**不改上游 `api.ts`**，符合裁定 (3)）＋ `openhive-project.test.ts`（新，**10 条全绿**）。③ 那一笔的位置是全条关键：不先写缓存文件，上游 `ProjectV2.resolve()` 会**再插一行 id 完全不同的 `project`**，两行配不上却**不报错不变红**——本条真跑了（建项目 → 用该项目目录建会话 → 断两个 id 相等）。**两处实测抓到的坑**：① Effect 4 的 `Schema.Literal(...arr)` **是单数签名**（多值的是 `Literals`），多出来的 `"shared"` 被 JS **静默丢掉** ⇒ 建共享项目一律 **400**、私有全绿；② `git init --bare <bare>` 的 `cwd` 不存在 ⇒ `FileSystem.access` `NotFound` ⇒ `exitCode: 1` ⇒ **建项目 500**，**只有共享项目中招**（两者症状都极具误导性，定位靠临时 `catchCause` 打 cause，不是猜）⇒ 先 `mkdir(bare)` 再进去。**同时按裁定 (2) 新定一个配置源**：`OPENHIVE_SHARED_ROOT`（`packages/auth/src/workspace.ts` 的 `sharedRoot`，与 `workspaceRoot` 同款同形；此前 `/shared` 全仓零定义）。**门禁串行全过**（`packages/auth` **238/1/0**；`packages/core` **1211/8/5**、5 条全是上游 `NpmConfig.*`、与基线**名称级差集为空**；typecheck **31/31**；`lint:openhive` **exit 0 · 23 warnings / 0 errors** ＝T012 基线、且本次改动**不在它扫的六个目录内**⇒「0 命中」是**空结论**、故另取文件级；**文件级 oxlint（仓库根跑）9 个改动文件 0/0**；根 `lint` 本次文件 0 命中；`bun.lock` 一行未动）。**一并记下一条 oxlint 行为**：`oxlint-disable-next-line` 看的是**字面下一行**，指令与目标之间夹任何一行注释（哪怕还是注释）＝**没禁用**，且行号会跟着目标漂（三行块照旧红 → 收成紧贴函数一行 ⇒ 0 warnings）。**⛔ 范围 ⑤（文件列表读取）未做，且卡在未定决策点上**：`GET /openhive/project` 是 fork 的**裸 `HttpRouter` 路由**、不在上游 `api.ts` 里 ⇒ SDK **类型上没有它**，而裁定 (3) 又禁改 `api.ts`；同时 `project-files.ts` / `project-list.ts` **至今零写入方**、`workspace-entry.tsx` 拿不到 `useSDK()`。⇒ 「前端怎么够到 fork 的裸路由」**报请用户裁定**（三条候选 A/B/C 与代价见「待裁定」节），**不自行拍板**。**另记一笔不实注释**：`workspace-entry.tsx` 里「由应用入口注入（`pages/layout-new.tsx` 拿 `useSDK()` 组）」——**实测为假**（该文件既无 `useSDK()` 也无 `loadFile` prop），T007 落下，收口时改。见「T018」节）
2026-10-06（**T012 收尾**：新建 `app/src/project/dual-file-tree.tsx`（`DualFileTree`：上树＝`FileTree` **本体**、下树＝同文件内 `MinioTree` 只读树、中间 `ResizeHandle` 可拖分隔条、拉回二次确认**内联条**）＋ `dual-file-tree.test.tsx`（**20 条**）；`file-tree.tsx` **只加一个 `draggable?: boolean`**（＋行上一个判断，其余一行未动）；`workspace-entry.tsx` 把「文件」pane 的内容换成 `DualFileTree`（`dualOpen` 信号）＋ 窄条 `onOpen` **一步做两件事**（§5.1 步骤 2①②：切回「文件」**并**展开）⇒ **还清 T019 挂的「2② 归 T012」**。**四问全按推荐项 A 裁定**（① 只前端 ＋ 补编号 **T022** 承接 HTTP 出口；② ✓ 判据＝纯路径；③ 只换 pane 内容、tab 容器保留；④ 备份直接覆盖、拉回先确认）。**上树不另起一棵**——`extends Omit<FileTreeProps, "draggable">` ＋ `splitProps` ＋ 其余原样 spread ⇒ 能力面跟着 `FileTree` 长（逐项转发＝会漂的镜像，`#004-07`）。**拖拽是最外层一次问完**：两棵树的行**刻意同构**（共用 `data-slot="file-tree-row"` ＋ `data-path` ＋ `data-type`，`data-tree` 分哪棵）⇒ 四个问题一次问完（`#004-12`），代价是下树**复用了那个 `data-slot`**（看着像笔误，实为委托的唯一前提），收益是两棵树都不必知道「MinIO」存在。**14 个变异**（组件 10 ＋ 接线 4）：M1 1／M2 5／M3 1／**M4 全绿→补条后 1**／M5 1／M6 1／**M7 全绿→补条后 1**／M8 1／M9 1／M10 1；N1 4／N2 2／N3 1／N4 1。**M4／M7 全绿不是代码多余，是测试少了一条**——同一个形态：同一件事有**两道判据**（M4：上树那条由 `file-tree.tsx` 守、下树那条由 `MinioTree` 守；M7：`draggable` 属性＝「浏览器不发 `dragstart`」（外）、`可放` 的方向判据＝「组件自己挡」（内）），而用例只压了前一道 ⇒ **各补一条，都是在变异体上补的**（先红后绿）。**M2 逼出第三处同型缺口**：数 `拼路径` 的**分支覆盖面**，发现「文件行」一个用例都没有（文件行与空白在 `位.路径` 上**恰好相反** ⇒ 空白那条绿着证明不了文件行也对，`#004-01`）⇒ 补一条，成牙证据是 M3 的恰红（⚠️ 据实说明：**不是 RED-first 写的**）。**记下一处 RED 阶段的假绿**：「展开 → 收起 → 再展开是同一节点」在空壳上也绿（两边都是 `null`）——它绿过，别算作 RED-first。**`#005-01` 的落点**：所有「某处没有元素」都断布尔（`不存在 = el === null`）。**happy-dom 没有 `DragEvent`**（有 `DataTransfer`）⇒ 用例拿裸 `Event`，产品码对 `dataTransfer` 全用可选链（那两处 `?.` 是测试进得来的前提）。**门禁串行全过**（`test:components` **383/0/27 文件**，基线 357/26 ⇒ ＋26 条＋1 文件；`test:unit` **824/0/117** 同基线；`lint:openhive` **23·0·88 files·exit 0** 本次三文件 **0 命中**——引入的 1 处 `require-array-sort-compare`（`.sort()` 没给 compare）当场清掉；`bun run lint` 本次文件 0 命中；`typecheck` exit 0——⚠️ 首跑红 1 条：`aria-expanded` 写成 `String(...)`，Solid 只收布尔，**`bun test` 不做类型检查一路没暴露**；`bun.lock` 一行未动）。**⛔ `onBackup`/`onRestore` 的接收方（HTTP 出口）归 T022** ⇒ 生产里不传 ⇒ 行不可拖（「未接线即禁用」）；`minio-backups.ts` 的写入方同归 T022。下一步 = T013（⚠️ 开工前必须先钉 Q1×Q3 那条未定项：owner 归档时**成员的沙箱文件**怎么办）。见「T012」节）
2026-10-06（**T019 收尾**：新建 `app/src/project/sidebar-tabs.tsx`（**受控**组件：`active` ＋ `onSelect`，自己不带 tab 状态；两个 pane **同时挂载、靠 `hidden` 切换**——`FileTree` 的搜索词／折叠态／选中行是内部信号，一卸载就「切一下 tab 全没了」，`hidden` 同时保证非激活 pane 不进 Tab 顺序）＋ `minio-bar.tsx`（`cloud-upload` 图标而非设计字面的 `⬆`，DESIGN §1.2 单色线性图标纪律）＋ 接缝 `minio-backups.ts`（第三件）；`workspace-entry.tsx` 把 T007 的 `file-tree-slot` **整体搬进** ② 的「文件」pane（`file-tree.tsx` **一行未改**，`data-slot` 沿用旧名——搬位置不是搬身份）。**＋27 条**（13＋6＋8）。**三处未定决策点已问用户、全部按推荐项裁定**：① 「会话」tab ＝ **显式空态**（`data-state="empty"` ＋「会话列表未接入」）；② 点窄条 ＝ **只做设计 §5.1 步骤 2①**（拨回「文件」tab），2②「展开上下双树」归 T012；③ 键盘 ＝ **只做外壳自己的 ← →**，**↑↓ 继续挂账**（遵守本 task 自己写的「`file-tree.tsx` 一行不改」）。**🔴 本 task 最重要的产出是变异 M4 逼出来的**：`#005-01` 那颗地雷**适用范围比原记的更宽**——不止 `.toBeNull()`，**任何把被 Solid 渲染过的节点当实得值的断言**都在内。M4 删掉键盘焦点跟随后，预期「恰红 1 条」，实际**不是红是崩**（`expect(document.activeElement).toBe(tab(...))` 红了、bun 打印实得值停不下来 ⇒ **Bun internal assertion failure ＋ panic**、`timeout` 挡下时已 29s、峰值 **4.68GB**、`EXIT=3`、**一条结果都取不到**）；改成比**布尔**后 **2 秒**出结果、恰红 1、12 pass。**新写的 4 处同形状断言已全部改成断布尔**（焦点跟随／同节点／aria 指向／「文件树还是同一棵」），`.not.toBeNull()` 那类留原样（失败时实得值是 `null`，原语）。**变异 5 处：除 M4 首次崩溃外全部①类**（M1 恰红 2；M2／M3 各恰红 1；M4 修断言后恰红 1；M5 恰红 1）。**一处 tsgo 与 oxlint 意见相反**：键盘处理器**必须内联箭头**（加断言被 oxlint 判多余、不加 tsgo 报 TS18047＋TS2339；Solid 只在内联处收窄 `currentTarget`，先例 `auth/login-page.tsx`）。**门禁串行全过**（`test:components` **357/0/812 expect/26 文件**，基线 330/24 ⇒ ＋27 条＋2 文件；`test:unit` **824/0/3173/117** 同基线；`lint:openhive` **23 warnings·0 errors·86 files·exit 0**——警告数同基线、文件 81⇒86 即新增 5 个文件 **0 命中**；改动 7 文件单跑 oxlint **0/0**；typecheck **31/31**）。**⚠️ 缺口**：`minio-backups.ts` **今天没有写入方、也没有能写的东西**（T011 的 `core/minio` 是包内库、**零 HTTP 出口**）⇒ 窄条恒走「不知道几项」态；第一个消费者是 **T012**。**⛔ 「会话」tab 的会话列表（设计 §7）、窄条 2② 双树展开、↑↓ 导航均不在本 task**。收尾时把「实得值为节点」这档并入 `#005-01`。下一步 = T012。见「T019」节）
2026-10-06（**T011 收尾**：新建 `packages/core/src/minio.ts`（`Minio.makeStore(config) ⇒ Minio.Interface`：`put`/`get`/`list`/`delete`，**入参不带桶名与前缀**——前缀由构造时的 `scope` 定死）＋ `packages/core/test/minio.test.ts`（**22 条**）＋ 观测面 `packages/core/test/fixture/fake-s3.ts`（`Bun.serve({port:0})` 真 HTTP 端点）〔**2026-10-06 补记：路径当时是 `test/fixture/`，T013 迁到 `src/test-support/`**〕。**零 `package.json` 改动、零 `bun.lock` 改动**——**D0-4 的前提被实测推翻**：`@aws-sdk/client-s3@3.933.0` **本来就是上游根 `package.json` 的依赖**（`upstream/dev:package.json` 第 113 行），已装、全仓零 import ⇒ 没跑 `bun add`；落点也零成本（`packages/core` 的 `exports` 是通配 `./*`）。**观测面取「真端点」而非替身**（T011 的产物就是那段实装，用替身=把被测对象换掉，`#002-02`），残差如实记（桶策略/STS/`${aws:username}` 本机一条未验 ⇒ D-13）。**16 个变异全部①类恰红**（5/1/1/1/1/1/4/1/6/3/6/1/1/**0**/13/1），两条「全绿/异常」都追到了根因：**M15**（关 `forcePathStyle`）首跑**21 条全绿**——不是那行多余，而是**端点 host 是 IP 字面量时 SDK 自己退回 path-style**，那行在原观测面里不可见；夹具改绑 `localhost` 后红 13（`#004-13` 情形①换观测面）；**M14**（空 body 分支）全绿则**实测**出另一件事——删掉它 `typecheck` 立刻红（`TS18048`，exit 2），所以它是**类型收窄**、守它的是编译器不是测试（`#003-03` 类③ 的前提在这里不成立，这条是量出来的）。另**补一条杀死另一种实现的用例**（桶名配错=404 `NoSuchBucket`；M16 恰红 1 正是它；据实说明：**不是 RED-first 写的**，拿 M16 当它的成牙证据）。修掉**我自己的一个 bug**（`拦住了` 的 `.then` 两分支写反，7 条用例当场红）。**门禁串行全过**（`packages/core` `bun test` **1209/8/5**，对照开工时 **1208/8/5**，5 条失败名称未变、全是上游 `NpmConfig.*`；`test:components` **不适用**；typecheck **31/31 exit 0**；文件级 oxlint **0/0**；`bun.lock` 一行未动）。**🚩 两条要记住的**：① **`lint:openhive` 只扫 `packages/app/src/*` 六个目录、不覆盖 `packages/core`**——对本题「0 命中」**恒真、等于没测**，`[BE]` 落在 core/auth/opencode 的 task 必须另取文件级 oxlint；② `await expect(...).rejects.toThrow()` 会被 `await-thenable` 记一条，仓库成文写法是**返回错误本体**的助手（`auth/src/*.test.ts` 三处同注，全仓已有 98 处）。**⛔ 接线与出口归 T012/T013**；`minio.md` §4 的 `OPENHIVE_MINIO_*` **刻意没落进本模块**（凭据形状正是 D-13 要裁定的，现在写死等于替它拍板；全仓零引用，改名前无需 grep）。下一步 = T012。见「T011」节）
2026-10-06（**T010 收尾**：新建 `app/src/project/member-panel.tsx`（受控组件：`👥 成员管理 · 项目名` ＋ `＋ 邀请成员（输入警号）` ＋ `成员（N）` ＋ 每行 `👤 名字（本人） role [移除]` ＋ 底部 `[退出项目]`，按设计 §4）＋ `member-panel.test.tsx`（**18 条**）＋ 接缝 `project-members.ts`；接线落在 `workspace-entry.tsx`（`memberOpen` 信号 ＋ 接上 **T005 就预留**的 `ProjectAnchor.onOpenMembers`——注释原文「接的是 T010 的成员面板」＋ `member-panel-slot` 浮层，**两个浮层互斥**）＋ `workspace-entry.test.tsx`（＋6 条）。**权限一律问 `ProjectMembership.decide`、本组件零规则复述**（`actor` 从 `selfPoliceId` 反查 role、查不到即 `null` ⇒ 天然 fail-closed）；**「权限决定画不画、接线决定能不能点」两条独立理由**。**12 处变异全部①类恰红**（组件侧 8：2/4/3/1/6/1/1/1；接线侧 4：5/1/1/1），其中 **M5 逼出一处真收敛**——「谁是我」我一开始写了两遍（`我()` 的 `find` ＋ 标记里的 `policeId ===`），变异后标记那侧**一条都不红**，改成 `<Show when={m === 我()}>` 比同一对象引用后同一变异红 6 条（`#002-06` 的又一实例）；另修掉**探针自己的 bug**（`row?.querySelector(...) !== null` 在行不存在时返回 `true`，替没渲染的行作证）。**一处只有 typecheck 才抓到的**：测试里 `文本(行(host,…), …)` 把 `HTMLElement | null` 递给收非空的 `文本`——`bun test` 不做类型检查所以 RED/GREEN 一路没暴露，已放宽签名。四道门禁串行全过（`test:components` **330 pass / 0 fail / 24 文件**（基线 306＋24）／ typecheck **31/31 exit 0** ／ `lint:openhive` **23 warnings·0 errors·exit 0**、**本次三文件 0 命中**（引入的 4 处当场清：`Icon` 死导入 ＋ 3 处类型断言）／ 根 `lint` 本次文件 **0 命中**，那 1 error 仍是 `#001-02` 记的上游那处）。**⛔ 落库与 HTTP 出口不在本 task 交付**（三个回调不接线 ⇒ 按钮 `disabled`），归 **T021**。下一步 = T011。见「T010」节）
2026-10-06（**补 T020（用户裁定「补，phase 你定」）**：T008 侦察出「复制／移动／上传／下载」四个动作**零任务认领** ⇒ 补 **T020**、归 **Phase 4**（US2），依赖 `[T007][T008][T018]`。补之前先做了一轮**只读侦察**（上游到底有没有现成能力），五条实证已落 T020 条目：① 上游**文件路由全是只读**（新 HttpApi 与旧 protocol v2 两套都只有 read／list／find，**无 write／create／delete／rename／move／copy**）；② 单文件 **copy／move／rename 无任何端点或服务**——唯一「单文件移动」先例是 `packages/opencode/src/tool/apply_patch.ts` 的 `move_path` 分支（**写新 ＋ 删旧**两步），而 V2 那侧明确 **not supported**；可复用底座是 `core/src/file-mutation.ts` 的 `FileMutation.Service`（`create`/`write`/`remove`）；③ **multipart 上传端点全仓查无** ⇒ 要新增；④ 下载最贴近的是 `GET /api/fs/read/*` 返回原始字节、**缺 `Content-Disposition: attachment`**；⑤ 客户端上传／下载**有先例可抄**（`dialog-edit-project.tsx` 的 `<input type="file">`＋onDrop、`session-ui` 的 `prompt-input/attachments.ts` 完整拖放、`utils/session-export.ts` 的 `downloadSessionExport`）。**同时给 T018 补范围第 ⑤ 条「文件列表读取」**（`project-files.ts` 早把这条账挂给 T018，但**接收方的表里此前没有它**，`#002-04`）——不补则 T020 开工才发现「没有列文件就没有可操作的对象」。另记一笔：设计文档 11 个 FR 引用里 **9 个在现行 005 spec 里不存在**（旧前端 spec `002-openhive-frontend-ui` 的编号），见「跨 feature 备注」补记）
2026-10-06（**T008 收尾**：`file-tree.tsx` 扩出右键菜单——**复用 `@opencode-ai/ui/context-menu`（Kobalte），不手写**；十项按设计 §6.2 落地（新建文件／新建文件夹｜重命名／复制／移动／删除｜上传／下载｜备份到 MinIO／从 MinIO 拉回），四组三分隔符。**不新增文件**，只有 `file-tree.tsx` ＋ `file-tree.test.tsx`（＋19 条 ⇒ **53 条**）。本 task 首轮 GREEN **13 条红**，根因是 `ContextMenu.Trigger` **吞掉外部 `onContextMenu`**（`splitProps` ＋ `preventDefault()` 后不调用）⇒ 挪到 Trigger 内层即解。**6 处变异**：M1／M3／M4／M5 恰红 1，**M2／M6 整组红 13**（据实记，`#003-03` 第②类）；**M4 是补出来的**——变异前先补断言证明能抓，再跑。四道门禁串行全过（`test:components` **293 pass / 23 文件**（基线 274＋19）／ `test:unit` **824 pass** 逐项同基线／ typecheck **31/31** exit 0 ／ `lint:openhive` **23 / 0 / 78 文件** 逐项同基线、新文件 0 命中 ／ 改动两文件 oxlint **0/0**）。**六条 Kobalte 契约已落 `state.md`**（内容钩子是 `data-component`、Trigger/Item 是 `data-slot`；`onSelect` 要 pointerdown＋pointerup；关闭看 `data-expanded` 不看元素在不在）。**一处设计取舍（我定的，待复核）**：工具栏作用于选中项、菜单作用于右键那一行——**两套当前项**。**🚩 计划缺口**：复制／移动／上传／下载**四个动作零任务认领**（grep 已核实），待裁定是否补编号。**顺手恢复被 T007 那次编辑顶掉的 `### T002` 标题**。下一步 = T009。见「T008」节）
2026-10-06（**T007 收尾**：新建 `app/src/project/file-tree.tsx`（受控组件，**不依赖 `useFile()`**——底座取 `components/file-tree-v2-model.ts` 的纯函数，上游一字未改）＋ `file-tree.test.tsx`（34 条）＋ 接入缝 `project-files.ts`；`workspace-entry.tsx` 把文件树**挂到锚点行下**（`file-tree-slot`，＋5 条接线测试）。工具栏六入口全落地（搜索＝真输入框／全部收缩／全部展开／＋下拉两项／重命名／删除）。本 task 34 ＋ 接线 5 = **39 条全绿**（`test:components` **274 pass / 23 文件**）；**8 处变异**：6 处恰红、M2 红 3（都真依赖「过滤」）、M8 红 2，**M7 是接线层的恰红**（断 `projectFiles()` 那根线 ⇒ 接线测试恰红 1）。**门禁首跑抓到 4 条新 warning**（27 vs 基线 23）——1 条是真 a11y 缺陷（行可点但键盘不可达）**按 TDD 补 5 条键盘测试再实现**，3 条是测试里的危险强转，全部清掉后回到 **23 / 0 / 78 文件 / exit 0**；四道门禁串行全过（`test:unit` **824 pass** ／ typecheck exit 0 ／ 改动文件 oxlint **0/0** ／ `bun.lock` 为空）。**两条新实测事实**：同层节点排序随 locale（本机拼音序）⇒ 测试按名字找行不按顺序；`aria-expanded` 类型不收 `string`、空 `new Set()` 推成 `Set<unknown>`。**计划缺口补 T019**（左栏 ② tab 容器 ＋ ④ MinIO 窄条；US4 验收原文依赖 ②）＋ 顺手恢复被 T006 吃掉的 `## 阻塞项` 标题。下一步 = T008。见「T007」节）
2026-10-06（**T006 收尾**：新建 `app/src/project/project-panel.tsx`（受控组件：置顶「＋新建私有/共享」＋ 最近/全部/已归档三 tab；「全部」按 `type` 分两组、「最近」按 `lastAccessedAt` 倒序、空态**分两句**）＋ `project-list.ts`（接入缝）；`workspace-entry.tsx` 把 `▾`/`＋` 接到面板、点一行回写 `currentProject` 并收起；`project-anchor.tsx` 的 `MEMBER_GLYPH` 改导出、`current-project.ts` 补 `id`。本 task 18 ＋ 接线 8 = **26 条全绿**（`test:components` **235 pass / 22 文件**）；7 处变异：5 处恰红、M2/M3/M4/M5 整组红（都据实记），**M7 第一次全绿**——由此抓出真缺口「接线没把 `currentId` 传下去」并**补一条断言**（在变异下恰红 1 后转绿）。四道门禁串行全过（`test:unit` **824 pass** ／ typecheck exit 0 ／ `lint:openhive` 23 warnings·0 errors·exit 0，warnings 与基线逐项相同 ／ 7 个改动文件 oxlint **0/0**）。**出参拆两半**：「三 tab 可切换」交付、「新建项目成功」**不交付**（无落库接收方，两个按钮 disabled）；缺口按用户裁定**补 T018**。**两条新实测事实**：组件测试必须走 `test:components` 三段式（裸跑全红）；设计 §3 一处措辞滞后（登记未改）。下一步 = T007。见「T006」节）
2026-10-06（**T005 收尾**：新建 `app/src/project/project-anchor.tsx`（受控组件）＋ `current-project.ts`（空态接缝）＋ `workspace-entry.tsx` 把 `ThreePane` 的 `left` 槽接上（＋20/−2）；新增目录已同步进 **3 处清单**（⑤ 前置的原文「单独一次提交」**实测做不到**，已改口径）。本 task 自身 9 ＋ 接线 5 = **14 条全绿**；7 处变异：6 处恰红、M3 整组红（预期），**M2 第一次跑挂死**——由此抓出真缺陷「`expect(<Solid 节点>).toBeNull()` 失败时打印器停不下来，红变哑」，本 task 新写的 3 条已改成断布尔；既有 4 处同形状断言**留原样挂账**。四道门禁串行全过（`test:components` **209 pass** ／ `test:unit` **824 pass** ／ typecheck exit 0 ／ `lint:openhive` 23 warnings·0 errors·exit 0 ／ 根 lint 本 task 文件 **0 命中**，非空绿）。**一笔待设计侧复核**：成员徽章 `👥`（图标集无 people/users 一档）。下一步 = T006（顺带接掉「谁喂真实项目数据」这条欠账）。见「T005」节）

---

## 收尾补测 · 后端结构性缺口（`backend-testing` · 2026-10-07）

**性质**：005 办结（Step 6）之后单独跑的一次**结构性缺口闭环补测**，与「前端缺口补测」（`8dc671e72a`，8 组 stories / 31 条）是同一条线上的两半。**产品码零改动**——下面四条回归**全部是补测**（今天就是绿的），不是修缺陷。四类缺口的判据、自愈护栏与归档口径按 `backend-testing` ＋ `testing-system-blueprint` 走。

### ① 命中的维度

| 维度 | 命中 | 依据 |
|---|---|---|
| 真库数据层（约束 / 迁移 / 事务） | ✅ | 005 落了 `0005_project_member.sql`（PK ＋ 单 owner 偏索引 ＋ `project_archive` 的一致性 CHECK）；而 `handleCreate` 一次请求跨 **SQLite ＋ PG ＋ 文件系统 ＋ git** 四个存储 |
| 越权 BOLA / BFLA | ✅ | 三个身份（owner / member / 外人）＋ 项目级共享态 |
| 并发 / 竞态 | ❌ | 见 ③ 的判据 |
| 韧性 / 故障注入 | ✅ | `archive.ts` / `restore.ts` 外呼 MinIO；`minio.ts` 四个动作 |

### ② 覆盖区分 → 落地的四条回归

| ID | 缺口 | 落点 | 用例 | 风险 | 发布门 |
|---|---|---|---|---|---|
| **005-BT-01** | 韧性 · `list` / `delete` 外呼**无超时** | `packages/core/test/minio.test.ts` | 2 | P1 | 发布前绿 |
| **005-BT-02** | 越权 · **归档＝冻结（FR-010）没落在 `file.ts` 四个出口上** | `packages/opencode/test/server/openhive-file-ops.test.ts` | 2 | **P0** | **硬阻断** |
| **005-BT-03** | 越权 · 跨身份递同一个项目头（BOLA） | 同上 | 1 | P1（见下「牙在哪」） | 发布前绿 |
| **005-BT-04** | 真库 · **建项目中途失败 ⇒ 项目不可见**（八步的「可见性最后落」） | `packages/opencode/test/server/openhive-project.test.ts` | 1 | P1 | 发布前绿 |

**四处证据与代价，如实记**：

- **005-BT-01 的缺口形状比「漏一个」更细**：`minio.ts` 原注释写着「`list` / `delete` 不受影响：它们的响应体由 SDK 在 `send` 内部收完再解析，天然落在定时器覆盖范围内」——**那句话当时没有任何测试撑着**，而 `withTimeout` 的**调用点**只有 `put` / `get`（`#004-01`：数「做那件事的那一行」，不数「已经包了的那几行」）。补法是**现成可装**：复用本文件既有的「黑洞端点」夹具（`Bun.serve` 收下连接、永不回话）。变异：摘 `list` 的 `withTimeout` ⇒ 恰红 1 条；摘 `delete` 的 ⇒ 恰红 1 条——**两条各自有牙**，不是一条替两条。
- **005-BT-02 是本次最重的一条**：`file.ts` 的复制 / 移动 / 上传 / 下载**此前零归档断言**。T015 的两道门确实被钉过，但钉的是**别的出口**（2026-10-07 复核实测：`openhive-project-frozen*.test.ts` 打的是 `/api/session`、`/file?path=`、`/permission`、`/session`、`/openhive/project/restore`，**三份里 `file/` 零命中**）。变异：摘掉 `isArchived` 那道门 ⇒ 恰红 1 条，且红的**正是第一个副作用断言**（`sub/a.txt` 存在 = true，即变异让写入通过了）——被测属性排在伴随信号之前（`#004-14`）。
- **005-BT-03 的牙在哪里**（`#003-04`：写进文档的实测必须当场复现）：一条两行改动（中间件 `join(root, projectId)` ＋ `projectDirectoryOf` 的 `relative(root, directory)`）**只让对照组变红，乙那半 6 条断言照旧全绿**。原因是围堵有两套**独立**机制：① 一人一个库 ⇒ 甲的行在甲的库里；② 目录是 `join(root, caller.id, projectId)`，**从调用者的 id 建**、不从项目头建。所以这条今天的身份是**回归网 ＋ 哨兵**，**不是缺陷探测器**；它在 **T016「成员进共享项目」落地那天会变红**（那时乙必须进得去）。用例注释里逐字记了这个实测。
- **005-BT-04 的注入点是人造的**：⑦ `addMember` 的 `user_id` 有外键 `→ auth.user(id)`，故**一个没有 `auth.user` 行的身份**建项目会在 ⑦ 被拒（①–⑥ 已成功）。生产里登录就落 `auth.user` 行，这个状态不会自然出现——选它是因为它**确定**（真实触发源 PG 抖动不可控）。用例问的是**次序那条契约**（中途失败 ⇒ 不可见），不是「外键会不会拒」。变异：把 ⑧ 挪到 ⑦ 之前 ⇒ 恰红 1 条，落在**可见性**那一条（列表多出一行 `project_ext`），前提证据那条照旧绿。另有一层：`expect(directoryCount(...)).toBe(1)` 是**注入点证据**（`#004-08`：副作用类判据要先证明机制是活的），它保证「500 是中途失败」而不是「请求畸形」。

### ③ 跳过的维度及理由

| 跳过的 | 为什么 |
|---|---|
| 并发 / 竞态 | **不命中**。判据是「存在共享可变状态的读-改-写」，而 005 全盘核过：`markArchived` / `markRestored` 只写 PG 单语句 upsert；`touchProjectExt` 写的是**调用者自己**的库（一人一份）；`insertProjectExt` 只在建项目写一次 ⇒ **没有任何跨存储的读-改-写**，不变量全由 DB 守（`project_member` 的 PK、单 owner 偏索引、一致性 CHECK），而那几条的真库断言**已有**（T004 那批）。⚠️ 另有一条**反向**理由：005 已实测 PGlite 夹具下**同进程两个并发请求会撞 `42P05`**（`LEARNINGS #005-02`），照那个形状补并发用例等于**制造假红**（`#003-01`）。 |
| 越权的**路由级** 403（成员出口 / 归档 / 找回） | **已被开发期测试覆盖**——本表初稿误记为「路由级无」，2026-10-07 复查改正（`#005-04`：「我记得的都改了」不是检完）：`openhive-project-member-route.test.ts`（名单 / 邀请 / 移除 / 退群各自的非成员 403 ＋ 「零副作用」两半）＋ `-archive.test.ts`（「非成员（外人）不能归档：同样零副作用、403」）＋ `-restore.test.ts`（6 处 403）。**不重复造**。 |
| 真库约束 / 迁移 up-down | **已覆盖**（T004 那批 ＋ `migrate.test.ts` 的反向回滚）。残差：`0005` 没有**专属**往返断言（P2）——登记不补。 |
| 韧性 · 归档 503 / 失败语义 | **已覆盖**（`-archive.test.ts` 的假 S3 故障注入）。 |
| 韧性 · `put` 上传后无回读校验 | **已挂账，本次不重复报**：`plan.md:156` R3 的缓解措施「上传校验 ＋ 归档前确认完整性」在实现里无对应物——正是 Step 5 的 **X3-2**（已挂账 / **Minor**）。本次复核后**同意那个分级**，我先前的「P0」是**高估**：`PutObject` 的 body 是内存 `Uint8Array`、`Content-Length` 由 SDK 算，服务端收下更少字节即违反 S3 语义 ⇒ 传输层截断会**报错**而非静默；真正会静默截断的是「读一个正在被写的文件」，而那种损坏**回读也查不出来**（上游就坏了），回读只是把每次上传流量翻倍。**不改产品码、不加用例**。

### ④ 产品码改动

**无。** 全程只写测试；四次变异（`minio.ts` ×2、`project.ts` 的 ⑧↔⑦ ×1、`middleware/project-location.ts` 与 `file.ts` 的那两行 ×1）**全部当场还原**，`git diff --stat` 空。

### ⑤ 门禁复跑（**串行**，`#003-01`）

| 文件 | 结果 |
|---|---|
| `packages/core/test/minio.test.ts` | **26 pass / 0 fail**（41 expect） |
| `packages/opencode/test/server/openhive-file-ops.test.ts` | **22 pass / 0 fail**（113 expect；19 → 22） |
| `packages/opencode/test/server/openhive-project.test.ts` | **14 pass / 0 fail**（86 expect；13 → 14） |

### ⑥ 仍然开着、需要裁定的两件事（本次范围之外）

1. **X4-9 的物理残留**：本次实测确认它**今天确实发生**——建项目中途失败后，项目目录**在**、`.git` **在**、上游 `project` 与 `project_directory` **各一行在**、`project_member` **0 行**（⑦ 正是被拒的那一步）；`shared` 那支还会多一个 bare 仓库。005-BT-04 **只钉「不可见」，不断言残留**——断言一个缺陷「按预期发生」等于把它写成规格。补它要动产品码（补偿或清理），**留待裁定**。
2. **`put` 侧的超时 / 重试**：X4-6 更正之后已如实登记（上传侧「无重试」此前并未真正进表）。


---

## 加固轮（2026-10-10）

> 本节按轮次追加。**编号 ＝ 用户逐条下达的顺序**，每条都走完六步轨道（`CLAUDE.md`「加固/修 bug
> 铁律」：①证据定根因 ②会红的用例 ③改到绿 ④变异验证 ⑤门禁 ⑥grep 同类落点）。
>
> ⚠️ 本节 ①② 两条的正文是**文档回填时补写**的（代码与真栈 spec 都早已落地，只是没当场落字）；
> ③④ 是当场写的。四条的 commit 都在 2026-10-10 这一天。

### ① 文件树空白处右键呼不出菜单（2026-10-10 · 已提交 `87decf7fca`）

**现象（用户实报）**：「左栏文件 tab 页面，在空白处单击右键呼不出右键。」

**根因（真栈实测，不推演）**：files pane（`sidebar-tabs.tsx` 的 `file-tree-slot`）只有 `flex-1`、
**自身不是 flex 容器** ⇒ 里面 `dual-file-tree` 的 `flex-1` 无剩余空间可分 ⇒ 退化成「高度＝内容高」。
实测：页签 `file-tree-slot` bottom = 841，而 `dual-file-tree` bottom = 185（空项目）/ 697（有文件）。

⇒ 页签余下的空白归 `file-tree-slot`，**不在任何 `ContextMenu` 触发区的盒子里** ⇒ 右键冒不到触发器。

**改法（4 处 class，只动 fork 自有文件）**：`sidebar-tabs.tsx` 新增 `PANE_FILES`（＝ `PANE` ＋
`flex flex-col`），只给「文件」pane 用（`PANE` 一字未改 ⇒ 会话 pane 不受影响）；`file-tree.tsx` 的
根 / `ContextMenu.Trigger` / `file-tree-region` 各补 `flex-1 min-h-0`，region 另接 `overflow-y-auto`。
`dual-file-tree.tsx` / `sandbox-tree` **未改**——它们本就写着 `flex-1 min-h-0`。副作用是改善：
滚动容器下移到 `file-tree-region` ⇒ 工具栏钉住、只有树滚。

**回归网**：新增真栈 spec `file-tree-blank-menu-real.spec.ts`（4 条）。组件层**钉不住**这条——
happy-dom 没有布局引擎，量不出 flex 高度（`#006-18`）。

**变异验证**（逐处各拆一次）：

| 拆哪一处 | 红的条数 |
|---|---|
| `PANE_FILES` 的 `flex flex-col` | 3 |
| `file-tree-region` 的 `flex-1` | 2 |
| `ContextMenu.Trigger` 的 `flex-1` | 4 |

⚠️ 拆 `file-tree-region` 那次**不是恰红**（`#003-03` 第二类）：两条「菜单开不开」的用例照样绿，
红的只有滚动那条 ⇒ 暴露出回归网漏了一条判据——`记对象`（定菜单作用对象）挂在 region 上，空白落到
Trigger 时它不跑，**菜单会开、作用对象却是上一次的残留**。据此补了第 4 条（「右键空白 ⇒ 重命名须为
禁用态」，带目录行对照组），补后该变异红 2 条。

**门禁**：`packages/app` typecheck 净；`typecheck:e2e` 仅 2 条**既有**报错（未改动的
`sidebar-project-switch-real.spec.ts`，`#006-02` 老账）；组件 **772 pass / 0 fail**；
改动产品文件 oxlint **0 warnings / 0 errors**。

**🔴 登记挂账（同类落点，用户未报 ⇒ 当场不动手）**：`ai-session/session-list.tsx:206` 的根
`flex min-h-0 w-full flex-1 flex-col` 与本条同型，父级同样是那个不成 flex 容器的 `PANE`。
真栈实测：会话页签 bottom = 841、列表根 bottom = 189 ⇒ **空白处右键同样呼不出菜单**
（当时的探针 `session-pane-blank-probe.spec.ts` 已随 ⑤ 的收尾删除——它没有断言，⑤ 的
真栈 spec 把同一组读数变成了硬判据）。
⇒ ✅ **已于 ⑤ 闭合**（用户 2026-10-10 点头后开工；另查出本条没有的第二层，见 ⑤）。

### ② 右键菜单 ⇒ 重命名 / 新建 时输入条拿不到焦点（2026-10-10 · 已提交 `db1a346da2`）

**现象（用户实报）**：「新建有问题，重命名不成功」——工具栏的 ＋ / ✏️ 两条都好，走**右键菜单**那两条
则输入条看得见、**裸键盘的字进不去**、磁盘一动不动。

**根因（真栈实测，不推演）**：`packages/ui` 的 `ContextMenu` 默认 `modal: true` ⇒ Kobalte 的
`createFocusScope` 在菜单开着时锁焦点，并在**菜单卸载那一刻**把焦点归还给「打开菜单时容器外的聚焦
元素」——被右键的那一行 `div[file-tree-row]`。焦点时间线（菜单 ⇒ 重命名）：

```
9027ms focus() → input[file-tree-rename-input]  ⟵ inline-rename-input.tsx:40
9028ms focus() → div[context-menu-item]{rename} ⟵ onFocusOut / onFocusIn
9050ms focus() → div[file-tree-row](path=话单.csv) ⟵ ★ 凶手
⇒ 输入条 blur ⇒ 就地改名「提交」时草稿没变 ⇒ 自己收掉
```

同仓对照：`ai-session/session-list.tsx` 的 `<ContextMenu modal={false}>` 拿得到焦点。

**改法**：`file-tree.tsx` 的 `<ContextMenu>` 加 `modal={false}`（**一行**）。

**回归网**：新增真栈 spec `file-tree-menu-focus-real.spec.ts`（2 条），判据是**裸键盘**敲字 ＋ 磁盘真变
（`.type()` 会先聚焦，分不出「输入条在」与「字进得去」）。

**变异验证**（拆掉 `modal={false}`）——**不是恰红，是「另一类」**（`#003-03`）：重命名那条 **红**；
新建那条 **假绿**！追加了**同一份 spec、同一套钩子、只差 `modal={false}`** 的对照，定性为**竞态**：
`inline-rename-input.tsx:40` 的 rAF 与焦点陷阱的抢回相差 1ms 级，谁赢看调度 ⇒ 无 `modal={false}` 时
「菜单⇒新建」多数坏、偶尔碰巧好。该 spec 文件头已据实写明「判据 4 不是 `modal={false}` 的守护者，
别拿它单独守」。

**⑥ 同类落点**：全仓 `ContextMenu` 根用法共 3 处 —— `session-list.tsx`（本就 `modal={false}`）、
`sidebar-project.tsx`（**上游文件**，触发器是单个 button、菜单里没有要焦点的输入条 ⇒ 不同型）、
`file-tree.tsx`（本次）。

**门禁**：`packages/app` typecheck 净；组件 **772 pass / 0 fail**；改动产品文件 oxlint **0 warnings**；
两条真栈回归网 **6 passed**。

### ③ 会话过期时横幅只说「新建失败」（2026-10-10 · 已提交 `be7257e0b4`）

**现象（用户实报）**：会话过期后点「新建」⇒ 红字横幅只写「新建失败」；重命名 / 删除 / 上传同理，
**每个动作都回同一句话**。用户自己贴的控制台里 `GET /api/health`、`GET /global/health`、
`POST /openhive/file/create` **全是 401**——他那套 3010 的 token 操作时已过期 345 秒
（`TOKEN_TTL_SECONDS = 2h`，真栈只在启动时签一次 ⇒ 跑满两小时必然如此）。

**根因（真栈实测，不推演）**：探针打桩 `window.fetch` 记到的原话 ——

```
resolve 401 POST /openhive/file/create      ⟵ 401 是 resolve 出来的，不是 reject
横幅 = ["新建失败"]；登录页在吗 = 0（页面没被赶去登录页，URL 停在 /）
```

⇒ **状态码到得了结论函数**（`trySend` 那两个 `catch` 只吞「网络抛」与「体解不开」，与 401 无关），
丢信息的是各层结论函数自己的兜底：401 落进 `!response.ok`，与「网络挂了」「体解不开」共用一句。

⚠️ 探针只用于取证，跑完即删（结论引在上面这段与 `openhive-fetch.ts` 的注释里）。

**改法**：判断与话各只写一份，落在**共用外呼底座** `packages/app/src/project/openhive-fetch.ts`
（`SESSION_EXPIRED` ＋ `isSessionExpired`），四处结论函数认它。归 `rejected` 而非 `failed`：
重试永远撞同一道门（同 403 已归档那条的理由）。

**⑥ 步落点清单（`grep trySend` 逐个打勾）**

| 落点 | 处置 |
|---|---|
| `openhive-file-ops.ts` `outcomeOf`（复制 / 移动 / 上传 / 新建 / 重命名 / 删除 共用一条） | ✅ 改 |
| `openhive-project.ts` `projectAction`（归档 / 找回）＋ `createProject` | ✅ 改 |
| `openhive-members.ts` `memberAction`（邀请 / 移除 / 退群） | ✅ 改（**grep 时才冒出来的第四个文件**） |
| `openhive-file-ops.ts` `downloadFile` | ⬜ 返回 `Blob \| undefined`，**没有「显示一句话」的通道**（改签名是另一件事） |
| `listProjects` / `touchProject` / `openhive-files.ts` / 会话列表 | ⬜ 二 / 三态设计（`undefined` ＝ 还不知道），本就不显示话 |
| **过期后没有「重新登录」的入口** | ⬜ 见下方缺口 3 |

**验证（全部实跑）**

- 单测 **12 条**新用例（每类写动作各一条，`LEARNINGS #005-12`）：先红 12 / 后绿 12；
  **变异**：拆掉四处 401 分支 ⇒ **恰红 12 条、其余 97 条不红**（`#003-03` 第①类）
- 真栈 `e2e/real-stack/file-tree-session-expired-real.spec.ts`：过期 ⇒ 横幅
  「登录已过期，请重新登录」＋ 磁盘没变；**对照**（会话正常）⇒ 真建出来。
  变异下**过期那条红**（横幅 = 新建失败）、对照那条仍绿 ⇒ 判据 1 的守护者是它自己；
  **判据 2（磁盘没变）不守护本条**（据实记，`#003-03` 三类都要写）
- 门禁（**串行**，`#003-01`）：`packages/app` typecheck 净；`bun test ./src`
  （该 package 单测）**1082 pass / 0 fail**；`oxlint` 本次改动的产品码与单测 **0 warning**
  （根 lint 仍为既有的 5046 warnings ＋ 1 上游 error ＝ `#001-02` 那条，**未新增 error**）

**⛔ 缺口 / 挂账（`#002-02`：没做的写成缺口，不写成已覆盖）**

1. **`downloadFile` 的 401** 仍说「下载失败」——那个函数的返回类型没有消息通道（上表）。
2. **读侧**（项目清单 / 文件树 / 会话列表）在 401 时折成「取不到」⇒ 界面停在「还不知道」态。
   这是它们**刻意**的三态设计（`listProjects` 文件头），不是坏；但「取不到」与「没身份」今天
   在界面上分不开——要分清得再给读侧一条消息通道。
3. **🔴 会话过期后没有重新登录的入口**：页面**不跳登录页**（实测 `登录页在吗 = 0`、URL 停在 `/`），
   今天「重新登录」＝**手动刷新页面**（冷加载时 `AuthGate` 会探一次身份）。横幅那句话说的是真的，
   但**手上没有可点的东西**。根治要给外呼底座一个「身份没了 ⇒ 让 `AuthGate` 重探」的信号，
   属**跨模块改动**，本轮范围之外 ⇒ **待裁定**。

### ④ 新建的空文件夹建完就看不见（2026-10-10 · 已提交 `84ff47bd78`）

**现象（用户实报）**：「新建的文件夹建完就看不见」。

**根因（真栈实测，不推演）**：上游 `GET /file?path=` 的体里**有**那条目录项 ——

```
{"name":"资料","path":"资料\\","type":"directory","ignored":false}
```

⇒ **服务端没藏**，丢在客户端**读侧**：`project/openhive-files.ts` 的 `walk()` 只 `files.push` 文件、
目录只用来往下走；而上游 `buildFileTreeV2Model` 认目录的唯一依据是「这条路径**还有下一段**」
（`components/file-tree-v2-model.ts:37` 把最后一段恒判 `file`）。
一个没有文件的目录交不出任何子路径 ⇒ 两条合起来它**整个消失**。

**改法三层**

| 层 | 落点 | 做什么 |
|---|---|---|
| 读侧 | `project/openhive-files.ts` | 空目录**自己占一条**，原样带上游 `fs.list` 那个尾分隔符（`资料\`）。`walk` 改成**三态**：`undefined` ＝ 这一支走不成；`true`/`false` ＝ 走成了、这一支下面有没有`文件` |
| 建树 | `project/file-tree-model.ts`（新） | 用**诱饵**（多喂一条 `<目录>/<占位>`）让上游按**中段**规则把它建成 directory —— type / children 键 / 排序**全由上游那一份规则说了算**，一行不复刻（`#002-06` / `#003-05`） |
| 接线 | `file-tree.tsx` / `dual-file-tree.tsx` | 两棵树的建树入口都改接这个函数（`#002-06`：不让同一份清单形状在两棵树上各有一套建树规则） |

判据是**「这一支下面有没有文件」**，不是「这一支贡献了几条清单项」—— 两者只在「只有空子目录的
目录」上分得开（`资料\` 里只有一个空目录 `8·17\`），而那正是最容易漏的那种。

**⑥ 步落点清单（`grep` 逐个打勾）**

| 落点 | 处置 |
|---|---|
| `file-tree.tsx:247,265`、`dual-file-tree.tsx:280` | ✅ 已接 `buildProjectFileTreeModel` |
| `target-picker.tsx` 的 `目录清单` | ⬜ **不改代码**——空目录那条在这里**碰巧**走通（归一后 `["资料",""]`，`pop()` 掉的是空段）。正因「碰巧对」才补了一条用例钉住 |
| 上游 `components/file-tree-v2.tsx:138` | ⬜ **不动**（上游组件，吃的是上游 live 树的数据） |
| `file-tree.stories.tsx` 的过期注释 | ✅ 已改，并补 `EmptyDir` 审计档（`#006-08`：新渲染形状要有审计面） |
| `dual-file-tree.tsx:231,238`（`拼路径`/`父目录`） | ✅ 不受影响——吃的是归一后的 `node.path`（无尾分隔符），且空目录行不可拖 |
| `workspace-entry.tsx:781,802` | ✅ 只喂 `paths` prop，无「按路径查清单」的逻辑 |
| `components/file-tree.tsx` / `session-side-panel.tsx` / `review-diff-kinds.ts` | ⬜ 上游 / 会话链的路径切分，与本条无关 |

**验证**

- 真栈端到端（新增 `e2e/real-stack/file-tree-empty-dir-real.spec.ts`，2 条）**2 passed**：
  空目录是一条 `data-type=directory` 的行、目录排在文件前、出口里那条 path 确实带尾分隔符，
  以及**通过界面新建文件夹 ⇒ 建完就看得见**（用户原话那个动作）。这条是**唯一**把
  「读侧 → 建树 → 渲染」三个环节同框的观测点 —— 单测喂手写清单、组件测试喂手写 `paths`，
  两层的绿都建立在「清单里已经有空目录那条」这个**真栈上不成立的前提**（`#006-18`）。
- **变异验证**（拆掉修复 ⇒ 用例必红）：
  - 真栈：读侧不补空目录 ⇒ **恰红**，红的正是用户原话的形状（「资料」整行不存在）
  - 单测 / 组件层共 7 处全部恰红，**无一处「拆掉仍绿」**；其中一处证明新用例的边际价值——
    给 `目录清单` 加 `.filter(Boolean)` ⇒ **新用例红、既有用例全绿**
  - 据实记一类：拆「读侧补空目录」时**组件层 0 红**（组件测试喂的是手写 `paths`，绕过了读侧）
    ⇒ 分层清楚，不是漏网
- **门禁**（**串行**，`#003-01`）：`packages/app` typecheck 净；单元 **1091 pass / 0 fail**；
  组件 **776 pass / 0 fail**；改动文件 scoped oxlint **0 warnings / 0 errors**（新 e2e spec 的
  6 warnings 与**已提交的同族 harness 同数同型**，`#004-12`）；`typecheck:e2e` 仅 2 条既有报错；
  `bun.lock` **无污染**（`git diff --stat bun.lock` 为空）。

**⛔ 缺口 / 挂账（`#002-02`）**

1. 空目录节点的 `originalPath` 是 `"资料"`、清单里那条是 `"资料\\"`（**尾分隔符没了**：诱饵建出的
   节点是归一后的形状）。**今天无消费者**（`originalPath` 是上游 live 树用的，fork 侧只用
   `node.path`），已写进 `file-tree-model.ts` 文件头。
2. `EmptyDir` 这个新 story 挂在 storybook a11y 审计面上，但**本轮没跑那个审计脚本**（它是手工跑的
   重编排）⇒ 进面 ≠ 已审。

### ⑤ 会话 pane 空白处右键呼不出菜单（2026-10-10 · 本轮）

**现象（用户没报，是 ① 的 ⑥ 步实测出来的）**：① 的文件树那条修完之后按 `#002-06` 问「谁在按同一个
前提做同一件事」，探针 `session-pane-blank-probe.spec.ts` 真栈实测**会话 tab 逐字同型**
（该探针已随本轮收尾删除，读数转成硬判据落进本轮的 `session-pane-blank-menu-real.spec.ts`）：

| | 会话 tab（修前） |
|---|---|
| `session-list-slot` bottom | 841 |
| `session-list` 根 bottom | **189** |
| 空白点(125,801) 最上层 | `div[session-list-slot]` ⇒ 菜单开 = **false** |

**根因（**两层**，都得拆）**

- **第一层**＝① 同一个：会话 pane 用的还是那个**不是 flex 容器**的 `PANE` ⇒ `session-list` 根的
  `flex-1` 无剩余空间可分 ⇒ 空白落在 pane 上、不在触发区里。
- **第二层（① 没有、为会话新查出来的）**：就算 pane 是 flex 容器，`session-list-region`
  （`onContextMenu={记行}` 挂的那一层）也**没有 `flex-1`** ⇒ 空白落在 **`ContextMenu.Trigger`** 上
  ⇒ **菜单照开**，而 `记行` 没跑 ⇒ **作用对象停在上一次的残留**。这不报错、也不变红（`#005-19`）。

**改法（3 个文件，全是 fork 自有）**

- `sidebar-tabs.tsx`：把 `PANE_FILES`（＝ `PANE` ＋ `flex flex-col`）**并回 `PANE`**，删掉那个常量。
  合并后「文件」pane 的 class 串**逐字不变**（原来就是这两条拼出来的），会话 pane 得到同一份骨架。
  不保留两个常量的理由：它们本来就会一样，留着就是同一件事的第二个说法（`#002-06`）。
- `session-list.tsx`：按 `file-tree.tsx` 那一对**逐字镜像**（`#004-12`）——触发器
  `flex min-h-0 w-full flex-1 flex-col`；region 接 `flex-1 min-h-0 overflow-y-auto px-1 pt-1`、
  `onContextMenu` 留在它身上。**滚动容器从触发器下移到 region**，`px-1 pt-1` 一并搬过去
  ⇒ 视觉逐像素不变、而空白点必然落在 `记行` 的射程里。
- `session-list.test.tsx`：**改掉一条从头就在空转的用例**（见下），并新增一条类名判据。

**🔴 顺带挖出的既有缺陷：`session-list.test.tsx` 那条「右键空白处 ⇒ 不动作、不误删」**
**从写下那天起就是空转的**。它查 `[data-slot='session-list-body']`，而这个名字**在 DOM 里从不存在**
——`packages/ui/src/components/context-menu.tsx:29-43` 的 `ContextMenuTrigger` 把
`data-slot="context-menu-trigger"` **硬写在 `{...rest}` 之后**，调用方传的值被静默覆盖。于是
`身子 = null` ⇒ 右键辅助函数 `el?.dispatchEvent(...)` 一个事件都没发 ⇒ 两个 `if (菜单项(...))`
都不进 ⇒ 两条断言度量的是**什么都没做**。当场取证（注入临时日志后实得）
`[取证] 身子 = null ； region存在 = true`、29 pass / 0 fail，随后还原探针。
⇒ 改查 `session-list-region`、并把「菜单确实开了」写成**会炸的前提**（`#004-14`、`#005-22`）。

**回归网**：新增真栈 spec `e2e/real-stack/session-pane-blank-menu-real.spec.ts`（3 条：无会话 /
有会话（含「右键行 ⇒ 重命名可用」对照组）/ 30 场滚动）；单元层改 1 条为真、新增 1 条钉类名。
组件层**钉不住**几何（happy-dom 无布局引擎，`#005-07`）。

**变异验证（逐处拆，据实记三类，`#003-03`）**

| 拆哪一处 | 恰红 | 假绿 / 另一类 |
|---|---|---|
| M1：`PANE` 的 `flex flex-col` | 真栈 **3/3 全红**（`列表根 bottom=189≠841`、最上层＝pane ⇒ 开=false、`槽滚 996/728` 标题行会滚走） | — |
| M2：`session-list-region` 的 `flex-1 min-h-0` | 真栈 2 条红（「region 要撑满触发器」＋「右键空白 ⇒ 作用对象为无」，实测 `禁用=false`＝上一条会话的残留） | **①「菜单开不开」那两条照样绿**（实得最上层 `div[context-menu-trigger]` ⇒ 开=true）——这正是第二层缺陷的形态，靠新加的「作用对象」判据兜住；**②「30 场只有列表区滚」照样绿，而它绿得正确**：`overflow-y-auto` 让该子项 `min-height:auto` 归零 ⇒ 被 `flex-shrink` 压到容器高、在自己内部滚动 ⇒ 那条判据仍为真（`#005-23` 分诊表第四类） |
| M2（单元层）| 新增的类名判据**恰红**（就红在 `flex-1` 上） | 那条「右键空白处」行为用例照样绿（行为没变，符合预期） |

**门禁**（**串行**，`#003-01`）：`bun run typecheck`（仓库根，turbo）**31/31 successful**；`packages/app`
单元 **1091 pass / 0 fail**；组件 **777 pass / 0 fail**（＝上一轮 776 ＋ 新增 1 条）；改动文件
scoped oxlint **0 warnings / 0 errors**（当场的实测：`file-tree-empty-dir` 6 / `file-tree-blank-menu` 5 /
`sidebar-session-nav` 6 / 本轮新 spec 6，全是同型 `no-unsafe-type-assertion`）；
`bun.lock` **无污染**（`git diff --stat bun.lock` 为空）。

**⑥ 步：同类落点逐个判（`grep -rn "ContextMenu.Trigger" / "onContextMenu"`，全仓 6 处消费点）**

| 落点 | 前提成立？ | 处置 |
|---|---|---|
| `src/project/file-tree.tsx`（fork） | 成立 | ✅ ① 已修；本轮复核：触发器 ＋ region 那一对都在 |
| `src/ai-session/session-list.tsx`（fork） | 成立（**第二层**也成立） | ✅ **本轮修** |
| `src/project/sidebar-tabs.tsx`（fork） | 成立（两个 pane 同一常量） | ✅ **本轮修**（合并 `PANE_FILES` → `PANE`） |
| `src/pages/layout/sidebar-project.tsx:97`（**上游**） | ⬜ 不成立 | 触发器 `as="button"` `size-10`，**没有**内层 `flex-1` 区域；每个项目一个自己的盒子 ⇒ 不存在「空白归谁」 |
| `src/components/session/session-sortable-terminal-tab{,-v2}.tsx`（**上游**） | ⬜ 不成立 | `onContextMenu` 挂在**页签自身**，作用对象就是那个页签 |
| `src/pages/home/home-projects-view.tsx:428`（fork 的主页定制） | ⬜ 不成立 | 只有 `preventDefault`，不是触发区 |
| `src/components/help-button.tsx:65`（上游） | ⬜ 不成立 | 同上 |
| `MenuV2` 各处（点击触发，非右键） | ⬜ 不成立 | 没有「空白归属」这回事 |
| `packages/ui/**` | — | 上游，不碰 |

**⛔ 缺口 / 挂账（`#002-02`）**

1. 本轮的**真栈 3 条**是本机跑的真浏览器 ＋ 真内核；**CI 上跑不跑**这件事仍然没接线（与
   ① ~ ④ 同一笔账）。
2. `#005-22` 那条教训的**同一个洞**在 `file-tree.tsx:398` 上也在：调用方传的
   `data-slot="file-tree-area"` **同样被 `packages/ui` 覆盖**（真栈实测该名字不存在）。今天**没有**
   用例按这个名字查（`file-tree.test.tsx` 查的是 `file-tree-region`，那层是自己的、没被覆盖）
   ⇒ 还没咬到人，**如实登记、本轮不动**。
3. 会话 pane 与文件 pane 现在都是 `overflow-y-auto`（pane）＋ 子项 `overflow-y-auto`（region）
   的**双层滚动容器**。今天内层先吸收、外层恒为 0（真栈实测 `槽滚 scrollHeight==clientHeight`），
   但它不是「设计成两层」而是「照抄文件树那一对」的副作用 ⇒ 记在这里，将来若要收拢归一次。

### ⑥ 会话过期后没有「重新登录」的出口（2026-10-10 · 用户裁定「401 自动重探身份」）

**现象（③ 的挂账，用户本轮下达要办）**：会话在页面开着的时候失效 ⇒ 点「新建」⇒ 横幅说得对
（「登录已过期，请重新登录」），而**界面一动不动**：没有登录入口，URL 停在 `/`。
今天「重新登录」＝**刷新页面**（冷加载时 `AuthGate` 才探一次身份）。

**根因（真栈实测，不是推演；探针 `session-expired-no-login-probe.spec.ts` 已随本轮收尾删除）**

| 时刻 | 登录页 | 工作台 | URL |
|---|---|---|---|
| 载入后（好 cookie） | 0 | 1 | `/` |
| 弄坏 cookie 后静置 3s（`/api/health`、`/global/health` 已 401） | 0 | 1 | `/` |
| 点「新建」（`POST /openhive/file/create` 401，横幅说对了） | **0** | **1** | `/` |
| **冷加载**（同一条坏 cookie） | **1** | 0 | `/` |

⇒ **判据没坏**（冷加载出得来登录页 ⇒ `probeSession` 的三态判定好着），缺的是**第二次探查**：
`probeSession` 是全仓**唯一**那道「我现在有身份吗」的判断，而它的生产调用者只有 `AuthGate` 一处
（`onMount`）。401 则在**十个** fork 外呼落点上被遇到，其中**五处**认得出它（经三个结论函数）
——而那五处能做的只是把话说对，**够不到唯一能处理它的那一层**。

**改法（一处接线 ＋ 一处订阅，全在 fork 自有文件里）**

- **新接缝** `src/auth/session-expired.ts`：`onSessionExpired(听众)` / `markSessionExpired()`。
  模块级**订阅表**（不是信号：这里要传的是**事件**，没有「当前值」可读；读的人只有一个）。
  ⚠️ 身份那条链（`gateway.ts` 的 `probeSession` / `login` / `logout`）**不走 `trySend`**：
  「登录被拒」也是 401，那条链若也报信，一次输错密码就会把重探引成回环。接口注释里写明。
- `src/project/openhive-fetch.ts`：`trySend` 拿到响应后 `if (isSessionExpired(response)) markSessionExpired()`。
  **接在底座、不接在结论函数**：实测 `grep -c 'await trySend('` = **10** 处，认得出 401 的只有 5 处
  ⇒ 接在结论函数里就是「谁记得谁接」。返回值一个字不改（旁路）。
- `src/auth/auth-gate.tsx`：启动那次探查与「听见 401」**共用同一个 `重探`**
  （`async () => setSession(await probeSession(props.send))`），订阅写在 `onMount` 里、
  退订交给 `onCleanup`（模块级接缝不会自己收，`session-context.ts` 那条老话）。
  ⇒ 门只是**再问一次**；跳不跳登录页仍由原来那处 `view()` 依**重探的结论**定。

**为什么是「重探」而不是「听见就跳登录页」**：一次 401 可能只是一条链上的偶发（内核刚重启、
会话正好在这一次往返里被顶掉）。两条对照用例钉住这件事，变异 M3 证明它们不是摆设（见下表）。

**回归网**：单元 `src/project/openhive-fetch.test.ts`（新，3 条：401 要喊 / 非 401 不喊 /
**不认 401 的客户端（列目录）也会喊**）；组件 `auth-gate.test.tsx` 新增 3 条（重探 ⇒ 回登录页；
对照：重探说「你还是你」⇒ 留；重探遇上网关不在 ⇒ 留）；真栈
`file-tree-session-expired-real.spec.ts` 判据 1 **从「那句话」迁到「去路」**（理由见下）。

**判据迁移（本轮的取舍，据实记）**：③ 当初钉的是**横幅那句话**，而修复后那句话在 e2e 里
**量不到了**——从 401 到换屏是本机两个往返（实测 ~10ms），探针复跑实得 `横幅 = []`。
⇒ 真栈判据改成「登录页出现 ＋ 工作台消失 ＋ 磁盘没变」；**那句话的判据没丢**：它在单元层
（`openhive-file-ops` / `openhive-project` / `openhive-members` 共 9 条）钉着。

**变异验证（逐处拆，据实记三类，`#003-03`）**

| 拆哪一处 | 恰红 | 另一类（射程之外 / 绿得正确） |
|---|---|---|
| M1：`trySend` 的报信 | 单元 2 条红（「401 要喊」「不认 401 的客户端也会喊」）；**真栈判据 1 红**（`element(s) not found`） | 单元第 3 条（非 401 不喊）绿——射程之外；组件 20 条全绿（它们直接喊 `markSessionExpired`，不走底座）；真栈对照组绿（磁盘真建出来了） |
| M2：门的订阅（`onCleanup(onSessionExpired(...))`） | 组件 1 条红（主判据「吃到 401 ⇒ 回登录页」） | 单元 3 条全绿；两条对照用例**照样绿**——它们断言的是「留在工作台」，拆掉订阅后什么都不发生（`#005-23` 第四问：这条判据的射程里有我刚拆的那一行吗） |
| M3：听见就直接 `setSession({kind:"signed-out"})`（不去重探） | 组件 **2 条对照**红（「重探说你还是你 ⇒ 留」＋「网关不在 ⇒ 留」），主判据照样绿 | 真栈（**未跑**，据实记）：本机真栈那条链分辨不出这两种实现——这正是它们必须留在单元层的理由 |

**门禁**（**串行**，`#003-01`）：`bun run typecheck`（仓库根，turbo）**31/31 successful**；
`packages/app` 单元 **1094 pass / 0 fail**（＝上轮 1091 ＋ 新增 3）；组件 **780 pass / 0 fail**
（＝上轮 777 ＋ 新增 3）；改动文件 scoped oxlint **0 warnings / 0 errors**；e2e spec **6 warnings**
（＝改动前逐字同数——当场用 `git show HEAD:…` 那一版实跑对比，也是 6，全落在抄来的 harness 上）；
`bun.lock` **无污染**（`git diff --stat bun.lock` 为空）；真栈 spec 复跑 **3 passed**（本轮 spec 2 条 ＋ 探针 1 条）。

**⑥ 步：同类落点逐个判**

| 落点 | 前提成立？ | 处置 |
|---|---|---|
| `trySend`（**十个** fork 外呼落点共用的底座） | 成立 | ✅ 本轮接线；返回值不变 |
| `isSessionExpired` 的 5 个消费点（上传＋文件动作、`projectAction`、`createProject`、`memberAction`） | 部分 | ✅ 保持原样——它们负责**当前这一屏说什么话**；去路已由底座统一负责，不重复接（`#002-06`） |
| 列目录 / 下载 / `touchProject` / `listProjects` / `listMembers`（认不出 401 的 5 处） | 成立（也遇到 401） | ✅ 由底座兜住（新增单元用例专钉这一条：它写的是**不认 401** 的那个客户端） |
| `@/auth/gateway` 的 `roundTrip`（`probeSession` / `login` / `logout`） | ⬜ **刻意不成立** | 不走底座：登录被拒也是 401，会成回环。接口注释与测试注释都写明 |
| `probeSession` 的生产调用者 | — | ✅ 收敛成**一处**（`AuthGate` 的 `重探`，启动与 401 共用同一个函数） |
| `setSession` 的写入方 | — | ✅ 仍只有 `AuthGate`；`signed-out` 的生产者只有两处（`probeSession` 的 401 分支、退出登录成功的那一支） |

**⛔ 缺口 / 挂账（`#002-02`）**

1. **上游出口的 401 仍无人处理**（实测）：会话失效后 `/api/health`、`/global/health`（以及会话列表
   那条上游 `/api/*`）同样回 401，而它们走 `utils/server-protocol.ts` / `context/server-sync.tsx`
   ——**都不是 fork 自有文件**，接它们＝改上游高频文件（第一号约束）。⇒ **后果**：用户静置时这些轮询
   401 不会把人赶去登录页；只要他做**任何一个 fork 动作**（文件／项目／成员）就会。如实登记，
   不假装覆盖。要不要收这一口，等用户裁。
2. **登录页不说原因**：被送回登录页时没有任何提示（横幅随工作台一起卸载，实测 `横幅 = []`）。
   要不要在登录页上补一句「登录已过期」，属产品决策，本轮不动。
3. **同时刻多个出口吃 401 ⇒ 重探多次**（接缝刻意不去重：多探几次得到同一结论，实测每条就是
   `/openhive/auth/me` 一条本机请求）。要收就收在门那一侧（它知道自己在探），本轮不动。
4. 真栈这几条**在 CI 上跑不跑**仍未接线（与 ① ~ ⑤ 同一笔账）。

### ⑦ 五项交互优化 · 第 1 项：新建改弹窗（2026-10-11 · 本轮）

> ⚠️ **用户本轮一次下达了五条交互反馈**（新建改弹窗 / ＋ 改浮层菜单 / 删除改弹窗 / 右键点外关闭 /
> 默认全收缩）。按「铁律」的**逐条、不跳步、不合并**，本节只记**第 1 条**；② ~ ⑤ 各自开工时另起小节。
> 用户当场批准的设计与执行顺序（AskUserQuestion 四项回答：「照此执行」/「连会话 pane 一起改」/
> 「自动展开（推荐）」/「要显示（推荐）」）见 `session.md`。

**现象（用户原话）**：「新建文件、新建文件夹时，会在文件 Tab 页面的图标下方显示输入框……这与日常
习惯不符，我希望还是以弹窗的方式进行交互更好。」

**根因（① 步真栈探针实测，读数逐条记；探针 `e2e/real-stack/file-tab-interaction-probe.spec.ts` 已删）**

| 点「＋」前 | 点「＋」后 | 选「新建文件」后 | 输入条开着时再点「＋」 |
|---|---|---|---|
| `{下拉:0, 项数:0, 输入条:0}` | `{下拉:1, 项数:2, 输入条:0}` | `{下拉:0, 输入条:1, 占位:"文件名"}` | **输入条静默消失** |

⇒ 名字在**树上撑开的一根行内输入条**里问，而不是弹窗。第 4 列那格另揭出一条**既有缺陷**：
兜底走的是 `就地改名输入` 的 `onBlur=提交`，空草稿被判成「取消」⇒ 用户以为点了「＋」没反应。
⚠️ 这一格属 ② 的射程（＋ 的行为），本轮只登记、不顺手改。

**改法（新增一个自包含组件，树那一侧只换「名字在哪儿问」）**

- **新** `packages/app/src/project/file-create-dialog.tsx`：`useDialog()` ＋ v2 壳（`DialogV2` /
  `DialogHeader` / `DialogBody` / `DialogFooter`，同 `components/dialog-edit-project-v2.tsx` 那一套）。
  顶层挂载、点遮罩关、Escape 关、焦点陷阱四样都白拿（`auth/change-password.tsx` 的注释里记着
  手搭 overlay 的代价）。**名字值不值得交出去**复用 `改名草稿`（`@/components/inline-rename-input`），
  不在这里再写一份（`#002-06`）；新建这一支没有「原名」，传 `undefined`。
- **改** `packages/app/src/project/file-tree.tsx`：函数体开头 `const dialog = useDialog()`；`新建()`
  改成 `dialog.show(() => <FileCreateDialog …/>)`；**删掉** `新建中` 信号与那整块行内输入条。
  **出参一字未改**：仍是 `props.onCreate({ kind, parent, name })`，`kind` / `parent` 仍由**入口**
  （工具栏 ＋ / 右键菜单）定下、作为 prop 进弹窗，弹窗只回一个名字 ⇒ 接线方（`workspace-entry` →
  `dual-file-tree` → `FileTree` 三跳）**一行都不用动**。
- 落点写在弹窗里（`建在：<目录>`，根那一档写「项目根目录」而不是留空）：弹窗一盖，树就不在眼前了，
  「选中目录 ⇒ 建在它里面 / 选中文件 ⇒ 建在它所在目录 / 没选 ⇒ 根」这条规则是**看不见**的。

**回归网**：新增 `packages/app/src/project/file-create-dialog.test.tsx`（9 条：标题两档 / 落点两档 /
空名与纯空白禁用 / 提交只交一个名字 / trim / 取消一次都不喊）；`file-tree.test.tsx` 的 9 条新建
用例改成弹窗流程（＋ `mount()` 补 `DialogProvider` 并记账 `dispose`）；`workspace-entry.test.tsx`
的 3 条同类用例同改；`dual-file-tree.test.tsx` 的 `mount()` 补 `DialogProvider` ＋ 记账
（它此前**丢 dispose**，属 `#005-03` 那一类，本轮一并收掉）。

**变异验证（逐处拆，据实记三类，`#003-03`）**

| 拆哪一处 | 恰红 | 另一类（射程之外 / 绿得正确） |
|---|---|---|
| ④-A：拆掉弹窗（`新建()` 直接交一个空名字，即改之前那种「点完入口就发请求」的形状） | `file-tree.test.tsx` **9 条红**（那 9 条新建用例：弹窗不在 ⇒ 探针抛错）＋ `workspace-entry.test.tsx` **3 条红**；合计 12 | `file-create-dialog.test.tsx` **9 条全绿**——射程之外（它直接挂弹窗，不走 `新建()`） |
| ④-B：把 `改名草稿(草稿(), undefined)` 换成裸 `草稿() \|\| undefined` | `file-create-dialog.test.tsx` **2 条红**（「只敲了空白 ⇒ 仍是禁用态」「两头带空白 ⇒ 交出去的是 trim 后的值」） | `file-tree.test.tsx` **87 条全绿**——如实记：树上那 9 条**都喂干净名字**，trim 这条判据**只钉在 dialog 那一层**（这正是「判据只写一份」的代价，也是它的意思） |

**门禁**（**串行**，`#003-01`）：`packages/app` typecheck（`tsgo -b`）**净**；单元 **1094 pass / 0 fail**；
组件 **789 pass / 0 fail**；改动文件 scoped oxlint（`bun run lint:openhive`）**0 命中**（该门总 36
warnings / 0 errors，全是既有；其中一条 `no-floating-promises` 是本轮 `dialog.show(...)` 引入的，
已按仓库惯例加 `void` ⇒ 从 37 降到 36）；`bun.lock` **无污染**（`git diff --stat bun.lock` 为空）；
真栈 spec **串行**复跑：`file-tree-empty-dir-real.spec.ts` **2 passed**、
`file-tree-menu-focus-real.spec.ts` **2 passed**、`file-tree-session-expired-real.spec.ts`
**2 passed**。

**⚠️ 一处本机实测踩到的坑（据实记，已修）**：`file-tree-menu-focus-real.spec.ts` 那条新建判据
我改写时把焦点断言写成了**提交之后再取**（`expect(await 焦点在新建弹窗里(page), …)`），而提交
（Enter）正是 `dialog.close()` ⇒ 弹窗随后被拆掉，「焦点还在弹窗里吗」**恒为 false**。红的样子很
有迷惑性：**三条读数全对**（`焦点 = input[text-input-v2-input]`、`条里的字 = "菜单建的.csv"`、
`磁盘 = [".git","菜单建的.csv","话单.csv"]`）而断言独红。改成**在对象还在的时候取、断言打在变量上**
后 2 passed。⇒ 沉淀为 `LEARNINGS #005-26`。

**⑥ 步：同类落点逐个打勾**

| 落点 | 前提成立？ | 处置 |
|---|---|---|
| `file-tree.test.tsx` 的 `mount()` | 不成立 | ✅ 补 `DialogProvider` ＋ 记账 `dispose` |
| `workspace-entry.test.tsx` 的 `mount()` | 不成立（3 条用例） | ✅ 同上 |
| `dual-file-tree.test.tsx` 的 `mount()`（上树就是 `FileTree`） | 不成立（23 条齐炸） | ✅ 同上（顺带收掉它「丢 dispose」的老账） |
| `file-tree.stories.tsx` / `dual-file-tree.stories.tsx` | **成立** | ⬜ 不改——`storybook/.storybook/preview.tsx` 的全局 `frame` 装饰器**早就套了 `DialogProvider`**（一开始按印象写了 `decorators`，读一眼后撤回） |
| `app.tsx`（生产） | 成立 | ⬜ 不改 |
| `e2e/real-stack/file-tree-empty-dir-real.spec.ts`（内联了 `file-tree-create-input`） | — | ✅ 改走弹窗探针 `[data-slot='file-create-dialog'] input` |
| `e2e/real-stack/file-tree-session-expired-real.spec.ts` 的 `工具栏新建()` | — | ✅ 同上 |
| `e2e/real-stack/file-tree-menu-focus-real.spec.ts`（判据 4） | — | ✅ 同上；头部「判据 4 不是 `modal={false}` 的守护者」那段补了一句**结构事实**（焦点改由弹窗的 `onOpenAutoFocus` 在菜单卸载之后点），并**如实声明本轮没重跑那个变异**、不写没实测过的话 |
| `e2e/real-stack/file-tab-interaction-probe.spec.ts`（一次性探针） | — | ✅ 本轮结束即删（读数已落在上面的表里） |

**⛔ 缺口 / 挂账（`#002-02`）**

1. **🔴 `file-tree-blank-menu-real.spec.ts` 第 4 条红**（「空白右键后，菜单作用对象必须是『无』」）——
   **不是本轮引入的**：按 `#006-02` 把改动 `git stash -u` 掉、在同一环境重跑，**基线同样 1 failed**
   （读数逐字相同：`点(125,801) 最上层=span[file-tree-name]` ⇒ 那个「空白点」今天落在一行文件上）。
   属既有账（① 那一轮补的判据，其取点前提被后来的布局改动破了）。本轮**不动**，登记待裁。
2. `file-tree.tsx` 的 `data-slot="file-tree-area"` 仍是被 `packages/ui` 覆盖掉的那个名字（⑤ 登记的
   同一个洞，今天无消费者）。未动。
3. 两个 pane 的双层滚动容器、真栈 spec 在 CI 上跑不跑，均与 ① ~ ⑥ 同一笔账，未动。

### ⑦ 五项交互优化 · 第 2 项：＋ 改浮层菜单（2026-10-11 · 本轮）

> 承接 ⑦-1 的头注：五条交互反馈**逐条、不跳步、不合并**。本节只记**第 2 条**。

**现象（用户原话）**：「点击"+"新建图标,会同时新建文件、新建文件夹。这个在交互感觉上与 windows 习惯
冲突，我们还是要在点击"+"新建图标时，滑出新建文件、新建文件夹的列表，用户选择对应的选项后走对应的
新建链路。」

**根因（① 步真栈探针实测；探针 `e2e/real-stack/create-plus-probe.spec.ts` 已删，读数逐条记）**

功能层解释不通——**改之前那个下拉本来就「滑出两项、选了才走」**。所以这句抱怨在**形式层**：

| 读数 | 旧实现（＋ 那两块**长在工具栏流里**） |
|---|---|
| 下拉的盒子 | `{上:145, 左:69, 宽:262, 高:54, 定位:"static"}` —— **与工具栏同宽（262）同左（69）**，且 `static` |
| 树上首行的 y | **145 → 203**（点开就把整棵树往下推 **58px**） |
| 点树里一行后 | 下拉**还在** |
| 点树下方空白后 | 下拉**还在** |
| 点工具栏搜索框后 | 下拉**还在**（只有 Escape 与「再点 ＋」才关） |

⇒ 它读起来不像一个菜单，像「工具栏底下**多长出来两块内容**」，而且这两块**把树推下去、点哪儿都不走**。
这正是「会同时新建文件、新建文件夹」这句抱怨的形式层解释：**两块并排摊在眼前**，不像「点 ＋ 滑出一个
列表、我得挑一项」。

**改法（换成仓库里已有的浮层组件，不自造浮层）**

- **改** `packages/app/src/project/file-tree.tsx`：工具栏那颗 ＋ 从「`<button>` ＋ 一个自己管的
  `createOpen` 信号 ＋ 流内两块」改成 **`DropdownMenu`**（`@opencode-ai/ui/dropdown-menu`，Kobalte
  薄包装）：`DropdownMenu.Trigger` 就是那颗 ＋、`DropdownMenu.Content` 里两个 `DropdownMenu.Item`
  （新建文件 / 新建文件夹）。**出参一字未改**：仍是 `props.onCreate({ kind, parent, name })`，
  `kind` 由**菜单项**定、`parent` 仍是 `selected()`，**调用方一行都不用动**。
- 顺带抽出一个 `工具钮` 组件（五颗钮共用：图标 / `aria-label` / `data-action` / 两种配色），
  五颗钮的名字与顺序集中成 `工具栏五颗` 一个常量。
- **删掉** `createOpen` 信号（开关归 Kobalte 自己管）与那两块流内内容。
- ⚠️ **菜单项按 `data-create-kind` 定位，不用 `data-slot`**：`DropdownMenuItem` 把
  `data-slot="dropdown-menu-item"` 写在 `{...rest}` **之后** ⇒ 调用方传的 `data-slot` 被**静默覆盖**、
  那个名字在 DOM 里**从来不存在**（`#005-22` 同病，第二例）。`Content` 上的 `data-slot` 落得下
  （它包的是 `data-component`，两个名字不撞）。
- ⚠️ **`工具钮` 的 `{...rest}` 排在自定义属性之前**（与 `#005-22` 那个病**相反**且**必须**）：
  `disabled` / `onClick` 要能从 `DropdownMenu.Trigger` 传来。`disabled` 自己也落一份，
  因为 Kobalte `ButtonRoot` 的 `createTagName` 要等 `ref` 挂载后才认标签名（晚一拍）。

**⚠️ `modal` 参数：本轮**加过又去掉**，过程与证据都记下来（这是本条最费功夫的一处）**

初版照着本文件右键菜单那段注释加了 `modal={false}`，理由是「默认 `modal: true` 会在浮层**卸载那一刻**
把焦点归还/抢走，与下游 `autofocus` 的弹窗互抢」。本轮**两臂对照把它证伪**：

| 读数（同一份 spec、**每臂 5 轮**、只差 `modal` 一个变量） | `modal={false}` | Kobalte 默认 `true` |
|---|---|---|
| `activeElement` @ `+0ms` | `DIV[dropdown-menu-item]` | **`INPUT[fileName]`** |
| `activeElement` @ `+100 / +400 / +1000ms` | **`BODY`**（5 轮全同） | **`INPUT[fileName]`**（5 轮全同） |
| **裸键盘打进去的字**（`.fill()`/`.type()` 会先聚焦、判别力为零，`#005-17`） | 5/5 进得去 | 5/5 进得去 |
| 点外面（树里一行 / 下方空白 / 搜索框，用**底层指针** `page.mouse.click`） | 三种都关 | 三种都关 |
| 几何（上/左/宽/高/首行 y） | 145/255/128/65、首行恒 145 | **逐字一致** |

⇒ 两臂的**用户级判据等价**（字都进得去、点外面都关、几何一致），而**默认臂的焦点更早更稳**
（`+0ms` 起就在输入框，`modal={false}` 臂要到**打字那一刻**才补回来）。⇒ **去掉 `modal={false}`**，
用 Kobalte 默认。那段被搬来的理由的**前提就不是同一个东西**：右键菜单那条链的下游是
**行内输入条**（`inline-rename-input.tsx`，会被焦点归还机制自杀），这一处的下游是**弹窗**（自己管
`autofocus`）。同仓对齐：全仓 10 处 `<DropdownMenu>`，**8 处不传 `modal`**。

⚠️ 量「点外面关不关」**必须用 `page.mouse.click`**，不能用 `locator.click()`：`modal: true` 的菜单
让页面其余部分 inert ⇒ `locator.click()` 的 actionability 检查**永远不过**、一路重试到超时（实测卡死
在「点树里一行」那步）。量到的是 **Playwright 的规矩，不是产品的行为**。

**回归网**：`file-tree.test.tsx` 新增 3 条（浮层挂到 `body` 上、不在 host 里 / 点浮层外面 ⇒ 收掉 /
按 Escape ⇒ 收掉）；既有 6 处「点 ＋ ⇒ 点流内那块」的序列全换成 `点加号(host)` ＋ `点菜单行(kind)`。
两条真栈 spec（`file-tree-empty-dir-real` / `file-tree-session-expired-real`）的菜单项定位从
`[data-slot='file-tree-create-*']` 换成 `[data-create-kind='*']`。

⚠️ **「菜单关没关」的判据是 `data-expanded`，不是「节点在不在」**：Kobalte 的 `Content` 外面套
`Presence`，它等**退场动画** `animationend` 才摘节点，而组件测试**没加载样式表** ⇒ 节点**一直挂着**
（实测关掉 800ms 后仍在，`data-expanded` 换成 `data-closed`）。按「节点在不在」判，红的样子长得像
「点外面根本关不掉」——用一次性 scratch 探针定到根因后才改对的。

**变异验证（逐处拆，据实记三类，`#003-03`）**

| 拆哪一处 | 恰红 | 另一类 |
|---|---|---|
| A：去掉 `<DropdownMenu.Portal>` | `file-tree.test.tsx` **恰红 1 条**（「不在 host 里」那条结构判据） | 其余 88 条全绿——射程之外 |
| B：`git stash push -- src/project/file-tree.tsx`（撤回旧实现） | **红同样的 9 条**（与初始 RED 集合逐条一致） | — |
| C：给 `DropdownMenu` 加回 `modal={false}` | **89 条全绿** | **第三类「变异全绿」**：组件测试里这个参数**没有任何守护者**，它的后果只有在真栈量得出来（本次用一次性探针量了，读数在上表） |

**门禁**（**串行**，`#003-01`）：`tsgo -b` 全仓 typecheck **31/31 successful**；`packages/app` 组件套
**791 pass / 0 fail**；单元套 **1094 pass / 0 fail**；改动文件 scoped oxlint（四个文件）**12 warnings /
0 errors，且 12 条全在两个 e2e spec 的「非本轮改动行」**（`file-tree.tsx` / `file-tree.test.tsx`
**0 命中**；那 12 条是既有的 `no-useless-fallback-in-spread` / `no-unsafe-type-assertion`）；
`bun.lock` 无污染；真栈三个 spec **串行**复跑
（`file-tree-empty-dir-real` 2 / `file-tree-session-expired-real` 2 / `file-tree-menu-focus-real` 2）
**6 passed**。

**⑥ 步：同类落点逐个打勾**

| 落点 | 前提成立？ | 处置 |
|---|---|---|
| 旧流内块的槽名 `file-tree-create-file` / `-dir` | — | ✅ 全仓清零 |
| `createOpen` 信号 | — | ✅ 清零（grep 命中全是 `createOpencodeClient` 等无关名） |
| 依赖 `data-slot="dropdown-menu-item"` 的别处（`session-header.tsx` / `index.css` / `prompt-project-selector.tsx`） | **不成立** | ⬜ 不改——那是**上游自己的**用法，无一依赖本链 |
| `file-tree-action-create` 的落点 | 成立 | ⬜ 不改——`file-tree.test.tsx:806`、`workspace-entry.test.tsx:642/2060` 断的是 `disabled`，`工具钮` 已自己落这份；**全在已跑绿的两套里** |
| 本仓另 9 处 `<DropdownMenu>`（含 `windows-app-menu.tsx` 的 `modal={false}`、`layout.tsx` 的 `modal={!sidebarHovering()}`） | **成立** | ⬜ 不改——各有自己的理由，不在本条射程 |

**⛔ 缺口 / 挂账（`#002-02`）**

1. **🔴 「浮层 ⇒ 弹窗 这一跳的焦点」今天没有常驻守护者**：量它的探针
   （`e2e/real-stack/modal-focus-probe.spec.ts`）按「一次性探针跑完即删」的惯例删了，而组件测试对
   `modal` **完全无感**（变异 C 全绿）。⇒ 若日后有人再给这处加 `modal={false}`（或上游改了 Kobalte
   默认值），**没有任何门禁会红**。要收就落一条真栈 spec（判据：菜单项点下去之后 `+1000ms` 时
   `activeElement` 必须是弹窗输入框），本轮不动、登记待裁。
2. **默认臂下「菜单开着时 ＋ 自己也进不去（inert）」**：真实指针再点一次 ＋ 仍能关掉菜单（实测
   连点 true→false），但 `locator.click()` 点不进去。本轮如实记，不当缺陷处理（模态菜单的正常行为）。
3. `file-tree-blank-menu-real.spec.ts` 第 4 条红、`data-slot="file-tree-area"` 被覆盖、
   两个 pane 的双层滚动容器、真栈 spec 在 CI 上跑不跑——**与 ⑦-1 第 1~3 条同一笔账**，本轮不动。

---

### ⑦ 五项交互优化 · 第 3 项：删除改弹窗（2026-10-11 · 本轮）

> 承接 ⑦-1 / ⑦-2 的头注：五条交互反馈**逐条、不跳步、不合并**。本节只记**第 3 条**。

**现象（用户原话）**：「选定文件，点击删除图标或右键弹窗功能进行删除时，删除的交互在**本页面的底部**
显示"取消"、"删除"，这个体验感不好，我希望还是以弹窗的方式进行交互。」

**根因（① 步真栈探针实测；探针 `e2e/real-stack/delete-confirm-probe.spec.ts` 已删，读数逐条记）**

用户那句「底部」**不是修辞，是一条几何**。改之前那条确认**内联**在文件树栏里，真栈读数：

| 读数 | 旧实现（一条内联 `<div role="alert">`） |
|---|---|
| 条的盒子 | `{上:813, 左:69, 宽:262, 高:28, 下:841}`（视口 900） |
| 宽 | **262 ＝ 与工具栏同宽**（整栏宽横幅，不是贴在那一行旁边） |
| 树区域 | `{上:145, 下:809}` ⇒ **条的顶(813) 在树区域底(809) 之下** |
| 挂在谁下面 | 祖先链 `file-tree < sandbox-tree < … < three-pane-left` ⇒ 它是 **`file-tree` 栏的最后一个孩子** |
| 两入口（工具栏钮 / 右键那一项） | 量到**同一条、同一位置** |
| 矮窗口（高 500） | 条仍在可视区内（不是「跑到屏幕外」，是「离得太远」） |

⇒ 比「内联」更准的说法：**它是钉在栏底、落在树区域之外的整栏宽横幅**。用户点的是树里第 3 行，
条出现在整棵树下方 —— 中间隔了 31 行。所以问题不是「不好看」，是**确认对象（那一行）与确认动作（那颗钮）
被整棵树隔开了**。

**改法（照抄 ⑦-1 那套壳，不自造模态）**

- **新增** `packages/app/src/project/file-delete-dialog.tsx`：与 `file-create-dialog.tsx` 同一个壳
  （`useDialog()` ＋ `DialogV2/DialogHeader/DialogBody/DialogFooter` ＋ `ButtonV2`）。顶层挂载、
  点遮罩关、Escape 关、右上角关闭键、**焦点陷阱**五样白拿——而「遮罩/Escape 关掉时**不能**删」
  正是这条链最容易写漏的一支。
- **改** `packages/app/src/project/file-tree.tsx`：删掉内联横幅 ＋ `待删` 信号 ＋ `确认删()`；
  `点删(path)` 改成 `dialog.show(() => <FileDeleteDialog path={path} onConfirm={() => 交(path)} />)`。
  **出参一字未改**：仍是 `props.onDelete(path)`，两个入口共用 `点删` ⇒ 「不分入口」仍是**结构上**成立的。
- **删掉** `MENU_ITEM` 常量（我的改动使它变成孤儿——它此前**只**被那条横幅用）。
- 破坏性动作的初始焦点给**「取消」**（`autofocus`）：敲 Enter 的肌肉记忆在这里不该正好命中删除。
  `DialogV2` 的 `onOpenAutoFocus` 按 `[autofocus]` 找元素（`dialog-v2.tsx:103`），找不到才退回 Kobalte 默认。
- 与 ⑦-1 同一条约定：作用对象在**开弹窗那一刻**定下、作为 prop 交给弹窗 ⇒ 确认的**永远**是那一刻那一项。

**回归网**：`file-tree.test.tsx` 删除那组 8 条改写 ＋ **新增 1 条结构判据**（「它是弹窗、落在
`document.body`，**不在**文件树栏里」——「有弹窗」与「弹窗不在栏里」是**两条独立判据**`#005-19`）；
`workspace-entry.test.tsx` 2 处、`file-tree.test.tsx` 另 2 处的「点旧钮」改成「点弹窗里的钮」。
**新增真栈 spec** `e2e/real-stack/file-tree-delete-dialog-real.spec.ts`（2 条：工具栏入口走完
取消→确认全链 ＋ 右键入口走同一个弹窗），钉的是**几何**（居中 ＋ **不在树区域盒子里**）——
happy-dom 量不出布局（`#006-06`），这条是唯一能钉住「不再隔一棵树」的观测点。

⚠️ **量几何要往上去一层**：`[data-slot='file-delete-dialog']` 那个壳是 `display: contents`
（同 `file-create-dialog.tsx` 的 `<form class="contents">`）⇒ **它没有盒**，`getBoundingClientRect()`
恒为零矩形。本 spec 第一版正是拿它量的，量出「离视口中心 720px」（视口才 1440 宽）——读起来像
「弹窗跑到屏幕外」，其实是我量错了东西。改量 `closest("[data-slot='dialog-content']")` 才拿到真盒子。

⚠️ **弹窗「关没关」不能等固定一拍**：`context/dialog.tsx` 的 `close()` 把 `open` 置 false 之后，
真摘节点是**再等 100ms** 的事（`setTimeout(…, 100)` 里才 `dispose()`）。测试里加了个 `等到(条件)`
轮询辅助（同 `#005-29` 的处方：等条件、不等时间），超时返回**最后一次实得值**让断言红在它自己身上。

**变异验证（逐处拆，据实记三类，`#003-03`）**

| 拆哪一处 | 恰红 | 另一类 |
|---|---|---|
| A：`点删` 直接喊 `props.onDelete(path)`（拆掉弹窗） | `file-tree.test.tsx` **红 9 条**（删除确认整组 ＋ 菜单那条） | 其余 76 条全绿——射程之外 |
| B：`file-delete-dialog.tsx` 里「取消」钮改接 `确定` | **恰红 1 条**（「取消 ⇒ 一次都没喊」） | 其余 84 条全绿 |
| C：`onConfirm={() => 交(selected() ?? path)}`（确认时改读选中项） | **恰红 1 条**（「菜单确认后喊的是**右键那一行**」） | 其余 84 条全绿 |

**门禁**（**串行**，`#003-01`）：`tsgo -b` 全仓 typecheck **31/31 successful**；`packages/app` 组件套
**792 pass / 0 fail**（＝ 基线 791 ＋ 新增 1 条）；单元套 **1094 pass / 0 fail**；改动文件 scoped oxlint
（10 个文件）**0 warnings / 0 errors**；`bun.lock` 无污染；真栈复跑 `file-tree-delete-dialog-real` **2 passed**
＋ 既有三个 spec（`file-tree-empty-dir-real` 2 / `file-tree-menu-focus-real` 2 /
`file-tree-session-expired-real` 2）**6 passed**，`file-tree-blank-menu-real` **1 红**（**已知基线红**，
第 4 条「空白右键后菜单作用对象必须是无」，与本条无关）。

⚠️ **对账时抓到一处自己的错**：整组门禁第一次跑出「组件套 **787**」，比基线 **791** **少 4 条**——
我**多加 1 条却少了 4 条**。逐文件对到 `file-tree.test.tsx`（基线 89 / 我 85），再用 junit 报告取**运行时**
用例名清单对差，查出根因：我改探针注释时**漏掉了块注释的闭合 `*/`**，那一段之后的**整组用例被吞进
注释里、根本没注册**（`#004-06` 的镜像面：那次是 `*/` **提前**闭合，这次是**从不**闭合）。补上 `*/`
后 **90 = 89 + 1**。⇒ 「用例数对账」是门槛不是洁癖：**静默不注册的用例，与「跑绿了」长得一模一样**。

**⑥ 步：同类落点逐个打勾**

| 落点 | 前提成立？ | 处置 |
|---|---|---|
| 旧槽名 `file-tree-delete-confirm` / `-cancel` / `-ok` / `-name` | — | ✅ 全仓清零（`file-tree.test.tsx:1426` 那条是**反向断言**，故意查它不在） |
| `待删` 信号 / `确认删()` / `MENU_ITEM` | — | ✅ 清零（三者只被那条横幅用） |
| `dual-file-tree.tsx` 的 `restore-confirm`（**class 串逐字同形**） | — | ⬜ **不改行为**（登记 T022，语义是「覆盖」不是删除）。只**改正两处陈旧指针**：它写着的「同 `file-tree.tsx` 的 `待删`」与「同 T009 的删除确认」都随本条失效 |
| `project-panel.tsx` 的 `project-archive-confirm`（① 步**漏了**的第三处内联条） | **不成立** | ⬜ 不改——它自己的理由是「**面板本身就是浮层**，再叠一层模态只会难收场」，与删除那条的理由**不是同一条**，从没被推翻。只改正那句「同 `file-tree.tsx` 的删除确认」 |
| 援引「T009 的删除确认」当活先例的注释：`target-picker.tsx:15`、`target-picker.stories.tsx:10`、`target-picker.test.tsx:195`、`workspace-entry.tsx:796`、`project-panel.tsx:730` | **成立**（改完就成了假话） | ✅ 逐处删掉该引用（`#004-03`：文档里的「有 X 钉着」本身也会假） |
| `session-list.tsx:345` / `session-panel.tsx:467` 的删除二次确认 | — | ⬜ **不在射程**：它们是**就地**二次确认（菜单项文案变「确认删除？」／钮文案变「确认删除？」），**不是**底部横幅。推翻了我上一轮「连会话 pane 一起改」在这条上的说法 |

**⛔ 缺口 / 挂账（`#002-02`）**

1. **🔴 别处的「内联条」理由今天成了待验的**：`target-picker.tsx` 与本仓另两处内联确认援引的理由
   （「树是用户眼睛已经在的地方，再叠一层模态还得让人多解释一步」）**与删除那条被推翻的理由逐字同源**
   ——真栈实测那条内联条落在树区域**之外**。它们各自是否也有同样的几何问题，**本轮没量、没证**。
   要收就按本条的探针法量一遍（判据：内联条盒子是否落在它那个「眼睛已经在的地方」的盒子里）。
   本轮不动、登记待裁。
2. **真栈 spec 有一次偶发**：3 次运行里 1 次在第 1 条用例的「等树落地」处 30s 超时
   （读数是 `element(s) not found`，落点是**既有**的等待步、非本条改动路径），另 2 次全绿
   （含单跑与整文件跑）。如实记，不当缺陷处理。
3. 「弹窗点遮罩关 / 按 Escape 关 ⇒ onDelete **一次都没喊**」目前只有**组件层**的「取消钮」守护着；
   遮罩与 Escape 两支走的是 `DialogV2` 自带机制，**没有单测**（`#006-14` 同族：横切机制无人验）。
   要收就补两条组件用例（点 `[data-component='dialog-overlay']` ／ 派一个 Escape）。本轮登记待裁。

### ⑦ 五项交互优化 · 第 4 项：右键菜单点外关闭（2026-10-11 · 本轮）

> 承接 ⑦-1 / ⑦-2 / ⑦-3 的头注：五条交互反馈**逐条、不跳步、不合并**。本节只记**第 4 条**。

**现象（用户原话）**：「右键后呼出右键弹窗，但是不选择对应的选项，弹窗不消失。我希望的是 windows 风格，
鼠标左键单击弹窗以外的地方时，弹窗消失。」

**根因（① 步真栈探针实测；探针 `e2e/real-stack/context-menu-dismiss-probe.spec.ts` 已删，读数逐条记）**

用户那句「以外」不是「菜单以外」那么简单——它是一条**几何**。探针三条落点同一次运行里的读数：

| 落点（视口坐标） | 在触发器盒子里？ | 修复前菜单关不关 |
|---|---|---|
| 树内另一行 `(200,829)`（最上层 `div[file-tree-row]`） | **是** | **不关**（用户报的那一处） |
| 工具栏搜索框 `(135,129)`（同一面板，在树区域上边界 145 之上） | 否 | 关 |
| 树栏之外 `(395,413)`（最上层 `aside`） | 否 | 关 |

而「触发器是谁」是**量出来的**，不是读文档读来的：`file-tree-region` 盒子 `{左:69,上:145,宽:262,高:696}`，
往上 `closest` 到它那个 `[data-slot='context-menu-trigger']`，盒子**逐字相同**、`contains` 为真 ⇒
**触发器就是整片树区域**。根因因此在 Kobalte 侧：`DismissableLayer` 默认
`excludedElements={[context.triggerRef]}`（`chunk/LEK3K6R3.jsx:700`）把触发器**排除在「外面」之外**
⇒ 在整片树里左键**一律不算点外面**，只有点到树栏之外才关。

修复＝调用侧传 `excludedElements={[]}`（该 prop 未写进 Kobalte 的 `MenuContentBaseOptions`，但
`{...others}` 排在它之后 ⇒ 调用方能覆盖；`packages/ui` 的包装层透传，`bun run typecheck` 实测通过）。
**两处落点都改**：`project/file-tree.tsx` 与 `ai-session/session-list.tsx`（后者触发器是**整块会话列表**，同病）。

**② 步的一个副产品：一条假红，根因在**测试环境**、不在被测物**（据实记，`#003-01`）

新增的「左键点工具栏搜索框 ⇒ 也收掉」在**单跑时绿、整文件跑时红**，实得
`data-expanded = [false]`——菜单压根没开住。逐层取证：

1. 同步读（右键那一刻）：`data-expanded = [true]` ⇒ **菜单开出来了**；
2. 一拍之后：`[false]` ⇒ 是**在这一拍里被关掉的**；
3. 挂 `document` 上的 capture 事件录：`["focusin@body[]", "focusin@div[]"]`——比正常多出一次
   `focusin@body`；
4. **对照**：把上一条用例 `.skip` 掉重跑，事件录只剩 `["focusin@div[]"]`、`data-expanded = [true]`
   ⇒ **被上一条用例污染**。

根因：上一条用例**开着菜单**被卸载，拆菜单的收尾**晚一拍**去 `focus()` 一次 `document.body`
（happy-dom 于是在 `body` 上派 `focusin`）。Kobalte 的 `createInteractOutside` 在 `document` 上
capture 收 `focusin`（`chunk/MGQGUY64.jsx:41-46`），而 `body` 既不在菜单里也不在被豁免的触发器里
⇒ 判成「焦点走到外面」⇒ 立刻 dismiss。**被测代码一字没改**，两种读数的差只来自上一条用例跑没跑。
处置：`file-tree.test.tsx` 的 `afterEach` 改成**异步三步**（① 卸载 ② 让出一拍宏任务 ③ 再擦 body），
把那个幽灵 `focusin` 消化在**没有菜单开着**的时候。改完 94 pass / 0 fail（修复前 93 pass / 1 fail，
那 1 条正是缺陷本身）。

**变异验证（逐处拆，据实记三类，`#003-03`）**

| 拆哪一处 | 实得 |
|---|---|
| 组件层 `file-tree.tsx` 的 `excludedElements={[]}` | **只红 1 条**（「树内另一行」）；同组另 3 条**全绿** ⇒ 那 3 条**不是这条修复的守护者**（第 ③ 类：② 守的是边界的另一侧、③ 守的是过度关闭、④ 只钉「收掉之后还能用」），已把这句话写进该 spec 的文件头 |
| 组件层 `session-list.tsx` 的同一处 | 第一条红、第二条绿（同样第 ③ 类，已写进文件头） |
| 真栈 `context-menu-dismiss-real.spec.ts` | **恰红**：`① 树内另一行 点(200,829) 最上层=div[file-tree-row] ⇒ 菜单还开着=true` ⇒ `1 failed`；装回去 `1 passed`。⚠️ 判据 3、4 在变异下**没跑到**（第 2 条先红、用例中止）⇒ 未证明有牙 |

**门禁**（**串行**，`#003-01`）：`tsgo -b` 全仓 typecheck **31/31 successful**；`packages/app` 组件套
**798 pass / 0 fail**（＝ 基线 792 ＋ ⑥ 新增 4 ＋ 2）；单元套 **1094 pass / 0 fail**；改动 4 个文件的
scoped oxlint **0 warnings / 0 errors**（130 rules）；`git diff --stat bun.lock` **为空**；真栈
`context-menu-dismiss-real` **1 passed**（含修复前三处落点的前后对照读数）。

**⑥ 步：同类落点逐个打勾**

| 落点 | 前提成立？ | 处置 |
|---|---|---|
| `project/file-tree.tsx:507` 的 `ContextMenu.Content` | **成立**（触发器＝整片树区域，实测盒子逐字相同） | ✅ 已改 ＋ 4 条组件用例 ＋ 1 条真栈 spec |
| `ai-session/session-list.tsx:328` 的同一处 | **成立**（触发器＝整块会话列表） | ✅ 已改 ＋ 2 条组件用例（用户裁定「连会话 pane 一起改」） |
| `pages/layout/sidebar-project.tsx:150` | **不成立**——触发器是**单个按钮**（`<ContextMenu.Trigger as="button">`），点按钮之外本来就算「外面」 | ⬜ 上游文件（`src/pages/**`），本轮不动。⚠️ 但**「左键点触发器自己（那一行按钮）收不收菜单」这一支没验** ⇒ 登记待裁 |
| `components/help-button.tsx`、`session/session-sortable-terminal-tab{,-v2}.tsx` | — | ⬜ 不在射程：只有 `onContextMenu` 回调（`preventDefault` / 开自己的菜单），不是 Kobalte `ContextMenu` |
| `pages/home/home-projects-view.tsx` | — | ⬜ 不在射程：自己的 `createStore` 上下文菜单，不是 Kobalte `ContextMenu` |
| `packages/ui/src/v2/components/menu-v2.tsx:196` 的 `MenuV2ContextContent` | — | ⬜ 上游 ui，且**仓内无调用方**（只有定义与 export）。⚠️ **将来有页面用 `MenuV2.Context.Content` 时，同一缺陷会在那儿复现**——那是个块级触发器的壳子 |

**⛔ 缺口 / 挂账（`#002-02`）**

1. **🔴 真栈 spec 仍未接线 CI**：`context-menu-dismiss-real.spec.ts`（以及本 feature 已有的 7 个真栈
   spec）**只在有真栈（Playwright ＋ 内核 ＋ 前端）时跑**，本机是唯一读到过这些读数的机器。
   要与既有的同一条缺口合账（⑦-1/⑦-2/⑦-3 都记过）。
2. **🟡 `sidebar-project.tsx` 那一支没验**（见上表）：块级触发器与单按钮触发器的差别只是**触发面大小**，
   「点在按钮自己身上」在 Kobalte 眼里仍不算外面 ⇒ 那一处**可能是同一族缺陷的另一种形态**，本轮没量。
3. **🟡 组件层只有一条有牙**（变异记录）：其余三条是**边界**与**过度关闭**的判据，拆掉修复照样绿。
   留着它们是对的（下一轮谁把 `excludedElements` 撤了、或引入「任何左键都关」的假修法时才看得出），
   但**别把这一组的绿读成四层防护**——这句话已写进两个 spec 的文件头。

### ⑦ 五项交互优化 · 第 5 项：默认全收缩（＋「新建后开链」配套）（2026-10-11 · 本轮）

> 承接 ⑦-1~⑦-4 的头注：五条交互反馈**逐条、不跳步、不合并**。本节只记**第 5 条**，也是这五条的最后一条。

**现象（用户原话）**：「开始进入文件Tab页面时，默认全部收缩。」

**① 步：把它拆成两个问题，分别定根因（不猜）**

*问题一：今天「默认」是在哪儿被定下来的？* —— 旧代码是
`const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())`：**反向存**（收起集合为空 ⇒
全展开）。这个「空集合 ＝ 全展开」不是谁写下的规定，是**镜像上游静态树的缺省**——上游
`src/components/file-tree-v2.tsx:139` 的 `file.tree.state(path)?.expanded ?? !live()`，缺省为真。所以旧行为
**在仓里没有任何一行写着「默认全展开」**，它是从上游缺省**漏**进来的（`#002-06` 的变体：一件事只有一份
说法，而那份说法在**上游文件**里）。改法：把存储**翻成正向**（`expanded`：空集合 ＝ 全收缩 ＝ 默认），
这样「默认是什么」第一次在**我们自己的文件里**有一行看得见的说法。

*问题二：谁在决定初始态？* —— 只有一处：`file-tree.tsx` 自己（组件内的 `createSignal`，纯 UI 状态、
随挂载重建）。所以第 5 条改这一处就够了，不需要动出参、也不需要动三跳接线
（`workspace-entry` → `dual-file-tree` → `FileTree`）。

**配套（本条第 2 个决定，用户裁定「自动展开（推荐）」）**：默认全收缩之后，「在深层目录里新建」会
**建完看不见自己刚建的东西**（落点那一支本来收着）。所以在**用户提交那一刻**把**落点及其祖先链**打开
（`展开链(parent)`，只加不减、别的目录不受牵连）。⚠️ **时机是「用户提交了」，不是「服务端回了成功」**：
`onCreate` 是 `void` 转发，组件既不知道成没成、也不知道落库后的路径。代价只是「失败时多展开了几个目录」
（已登记为缺口 3）。⚠️ 只开**落点这一条链**，不是「随便开点什么」——「落点是根 ⇒ 一层都不展开」有一条
**对照**用例钉着。

**② 步：先写的会红用例（6 条，全在 `packages/app/src/project/file-tree.test.tsx`）**

| # | 用例名 | 钉的是 |
|---|---|---|
| 1 | 默认**全收缩**——进入文件 tab 时只看得见顶层 | 默认值本身（`路径(host)` 由全量 收成 `["资料","笔记.md"]`） |
| 2 | 目录行带展开状态（`aria-expanded`） | 默认态下可访问性属性是 `false`（不只靠箭头方向） |
| 3 | 箭头在 tooltip 触发壳内，且可访问名随开合变 | 默认态可访问名是「展开」（不是「收起」） |
| 4 | 新建成功后自动展开落点 > 落点是深层目录 ⇒ 落点及祖先链都打开 | 配套行为 |
| 5 | 新建成功后自动展开落点 > 落点是根 ⇒ 一层都不展开 | 配套的**对照**（守「不是随便开点什么」） |
| 6 | 搜索 > 匹配项在深层目录里，父级路径自动展开 | **既有**用例：旧默认下它的前提恒真、判据在空转 |

改写 4 条（方向整体翻面：旧「默认全部展开／点全部收缩／全收缩→全展开／按 ← 收起、→ 展开」⇒
新「默认全收缩／点全部展开／全展开→全收缩／按 → 展开、← 收起」）＋ 新增 2 条（上表 4、5）⇒ 净 **+2**。
另外**就地补前提**若干处：`file-tree.test.tsx` 里 5 条原本「一进来树就是全摊开」的用例补上
`动作(host,"expand-all")?.click()`（它们判的是**别的事**，默认值一翻就没前提了）。

**④ 步变异验证（据实记三类，`#003-03`）**

先记**为什么这次用「整份撤回」而不是「拆一行」**：第一版取「把 `展开` 取反」
（`!expanded().has(path)`）——它让 `展开` 与 `切换` **失步**（一个说开、一个说关），红出 **15 条**，
噪声盖过目标。改用 *`git checkout HEAD -- packages/app/src/project/file-tree.tsx`*（把第 5 条**整份**撤掉、
其余不动）⇒ **恰红 6 条**（`224 pass / 6 fail`），且**逐条对得上 ② 步那张清单**（第 ① 类：恰红目标那几条）。
装回（`cp` 备份）后 `96 pass / 0 fail` 复现两次。

| 拆哪一处 | 红哪几条 | 类别 |
|---|---|---|
| `file-tree.tsx` 的第 5 条**整份**（撤回 HEAD 版） | 上表 1~6，**恰 6 条**，全在 `file-tree.test.tsx` | ① 恰红目标 |
| （同上）`dual-file-tree.test.tsx` 23 条 / `workspace-entry.test.tsx` 111 条 | **全绿** | ③ 那不是守护者——那 8 处/3 处补丁守的是**自己文件的前提**（撤回产品码后旧默认本就全展开 ⇒ 补丁退化成 no-op）。⚠️ 这句话已写进**两个 spec 的文件头** |
| （同上）空树判据（`file-tree.test.tsx` 的「空态」那条本就 mount 一棵空树） | **必然绿** | ③ 不变判据：空树在两种默认态下读数逐字相同 ⇒ 它天生不可能区分 |

**⑤ 门禁（串行，`#003-01`）**

- 全仓 `tsgo -b` typecheck **31/31 successful**（中途一次真红：`setExpanded(new Set())` 推成
  `Set<unknown>` ⇒ `TS2769`；改成 `new Set<string>()` 后过）；
- `packages/app` 组件套 **800 pass / 0 fail**（46 文件；＝ ⑦-4 后的基线 798 ＋ 本条新增 2，对账成立）；
- 单元套 **1094 pass / 0 fail**；
- 改动 5 个文件的 scoped oxlint **0 warnings / 0 errors**；
- `git diff --stat bun.lock` **为空**（未跑 `bun install`）；
- **真栈 13 passed / 0 failed（3.2m）**——六个受影响的 spec 一次跑完：
  `file-tree-empty-dir-real`(2) / `file-tree-blank-menu-real`(4) / `file-tree-delete-dialog-real`(2) /
  `file-tree-menu-focus-real`(2) / `file-tree-session-expired-real`(2) / `context-menu-dismiss-real`(1)。
  ⚠️ 事前静态核过「这些 spec 引用的行名全是**顶层**」（`话单.csv` / `资料` / `有内容的` / `子目录` /
  `八月的资料` / `话单-000.csv`）⇒ 默认收缩本不该影响它们；**跑完证实如此**。
  ⚠️ **一条既有账不再复现**：`file-tree-blank-menu-real` 第 4 条此前登记为「基线同样红」（⑦-1 那行的挂账，
  `git stash -u` 对照实测过）。这一轮它**绿了**。据实记：**没有做单条隔离归因**（没把它单独撤回再跑一遍），
  所以只能说「六 spec 全绿、那条旧账不再复现」，**不能**说是被 ⑦ 的哪一项治好的。

**⑥ 步：同类落点逐个打勾**

| 落点 | 前提成立？ | 处置 |
|---|---|---|
| `project/file-tree.tsx:236` 的 `expanded` | **成立**（就是第 5 条讲的那棵树） | ✅ 已改（正向存储）＋ `展开链` ＋ ② 步 6 条判据 |
| `project/dual-file-tree.tsx:285` 的 `MinioTree.collapsed` | **不成立**——名字像同一件事，**其实是两回事**：它管的是**下树（MinIO 只读备份镜像）内部**目录的开合；上树那个 `open` prop（第 38 行）管的是**整个 MinIO 面板**收不收。第 5 条原话是「进入**文件 Tab 页面**时」，讲的是**沙箱树**的初始态；这棵是拿来跟沙箱**对照**的只读镜像、一屏本来就短。且**生产侧 `minioBackups()` 今天没有写入方**（恒 `undefined` ⇒ 空态）⇒ 改了也看不见效果，而 ~15 条用例的前提要跟着重写（代价落在没有观测面的地方）。 | ⬜ **行为不改**（`#005-28`：理由的前提不同就不能照搬）✅ **但注释改了**——它原文写着「（同 `file-tree.tsx`）」，翻面后这句**成了假的**（一个正向、一个反向）⇒ 改成记清「故意相反 ＋ 为什么 ＋ 裁定在哪」 |
| `src/components/file-tree-v2.tsx:139`（上游） | — | ⬜ 上游文件（`src/components/**`），且**仓内沙箱树不走它**（我们走 `buildProjectFileTreeModel` ＋ `flattenFileTreeV2` 两个纯函数）⇒ 它的缺省仍是全展开，与我们无关 |
| 其余「收合态」 | — | ⬜ 三个我们自己的目录（`src/project` / `src/workspace` / `src/ai-session`）grep `collapsed` / `默认全展开` ⇒ **只剩上表两处**，无第三份 |

**⛔ 缺口 / 挂账（`#002-02`）**

1. **🔴 真栈 spec 仍未接线 CI**：同 ⑦-1~⑦-4 的那条账——这 13 条读数只在**本机**读到过。
2. **🟡 「切走再切回来会不会重置」没有守护者**：默认态是组件自持的 `createSignal`，切 tab 会不会卸载组件
   取决于父级怎么挂（`<Show>` / `<Switch>` / `display:none`），本轮**没量**（真栈里切一次 tab 的读数没取）。
   第 5 条的字面（「开始**进入**文件 Tab 页面时」）只要求**挂载时**收缩，所以不影响验收；但「切回来又摊开了」
   这类投诉会落在这一条上。
3. **🟡 展开链的时机是取舍**：`展开链(parent)` 接在「用户提交」而非「服务端回成功」（见上「配套」）。失败时
   多展开几个目录，无功能影响；**将来 `onCreate` 若改成回传落库路径，这里应跟着改成「按真路径开链」**。
