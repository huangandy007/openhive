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
- [ ] T004 [BE] 实现 `project_member` 表（业务 PG，走 auth 包迁移体系，与 004 的 rbac/rls 同构）＋微信群模型权限判定（owner/member 权责；判定写 core 纯函数、接线在执行层）[FR-004] [T001] [出参：权限判定单测通过]
  - 🔒 **U5 裁定（2026-10-06）：不接 `core/access` capability**——那是数据轴，004 裁定 ④ 明确「等 F6/F7 有消费者时再钉」。本条走自有成员判定线（存储 PG / 判定 core 纯函数 / 接线执行层）。
  - 🔒 **Q3 裁定（2026-10-06）：`project_archive` 表同批落这里**——`archived` / `archived_at` 两字段，与 `project_member` 同在业务 PG（同一次迁移 `0005_project_member.sql`）。它是**共享态**：owner 归档 ⇒ 全项目可见（FR-010 才立得住）。
  - 📥 **本条接收 004 的 T011 之半**（工作空间轴）——见文件头移交块。

## Phase 3: US1 项目列表与新建（P1）

- [ ] T005 [US1] [FE·新增] 实现项目锚点行（项目名 + 成员数 + ▾ + ＋）[FR-001] [T003] [出参：左栏顶部锚点渲染]
- [ ] T006 [US1] [FE·新增] 实现项目面板（＋新建私有/共享 + 最近/全部/已归档三 tab）[FR-002][FR-003] [T003] [出参：新建项目成功、三 tab 可切换]

## Phase 4: US2 文件树（P1）

- [ ] T007 [US2] [FE·换皮] 实现文件树工具栏（新建/重命名/删除 + 搜索/折叠/展开）[FR-005] [T001] [出参：工具栏图标可用]
  - 🔒 **D0-2 裁定（2026-10-06）：包一层，不碰上游**——上游 `components/file-tree.tsx` 一字不动；新建 `app/src/project/file-tree.tsx`，**底座取 v2 的纯函数 model**。实测上游该组件**没有**工具栏/右键菜单/新建/重命名/删除/上传下载 ⇒ 标注的「换皮」实为**新增**。
  - ⚠️ **⑤ 前置（单独一次提交，先于建目录）**：`app/src/project/` 加入 **3 处**目录清单——根 `package.json` 的 `lint:openhive`、`app/src/openhive-module-dirs.test.ts` 的 `moduleDirs`、`app/src/workspace/design-token-refs.test.ts` 的 `自有目录`。少一处 ⇒ **视觉契约门扫不到新文件**且不报错（`LEARNINGS #002-06`）。
- [ ] T008 [P] [US2] [FE·换皮] 实现文件树右键菜单（复制/移动/上传/下载/备份/拉回）[FR-005] [T001] [出参：右键菜单完整操作]
- [ ] T009 [US2] [FE·换皮] 实现删除二次确认 + 重命名/删除选中后点亮、未选中置灰 [FR-006] [T007] [出参：删除有确认、未选中图标置灰]

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
- **Phase 2**：T003（依赖 T001）；T004（依赖 T001，可与 T003 并行）
- **Phase 3**：T005（依赖 T003）；T006（依赖 T003）
- **Phase 4**：T007（依赖 T001）；T008 ∥ T007（依赖 T001）；T009（依赖 T007）
- **Phase 5**：T010（依赖 T004）
- **Phase 6**：T011（依赖 T002）；T012（依赖 T011）
- **Phase 7**：T013（依赖 T003+T011）→ T014（依赖 T013）；T015（依赖 T004+T013）∥ T016（依赖 T003）

共 16 条任务（T001–T016），符合 12–18 条范围。
