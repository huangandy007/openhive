# Tasks: 权限控制

**Input**: `docs/superpowers/specs/004-access-control/`

**Prerequisites**: spec.md（用户故事）、plan.md（结构 / 集成点）、F2 身份注入 + F3 db 路由已落地

**Tests**: 安全测试——越权工具调用被拒、越权 SQL 被 RLS 拦截、路径穿越 / SQL 注入 / 未授权直连。

## 任务格式约定

- `[P]` = 可并行（不同文件、无依赖）
- `[USn]` = 所属用户故事
- 每条含 `[FR-x 来源] [依赖任务] [出参验证方式]`

## Phase 1: Setup（定位 + 方案锁定）

- [x] T001 [P] 定位 opencode 工具执行器入口（tools 组装处 + 执行处），产出挂载点清单 [FR-002][FR-003] [无依赖] [出参：工具组装/执行两处真实入口]
  - ✅ 2026-10-04 完成。**实测推翻 plan.md 的前提**：不是「一个统一执行器入口」，而是**两条独立主链**
    （A = opencode v1 / web UI，B = core v2 / CLI·sdk-next，互不 import），且**两条链各自已有上游的
    ruleset 驱动钩子**（清单过滤 + 执行断言）。完整挂载点清单见 `state.md` 的 D0-1 表。
    用户裁定：**两条都接**（判定写一份、按链注入 ruleset），落点 **core**。
- [x] T002 [P] 确定 capability scope 结构（用户 + 项目 + 数据范围字段）[FR-001] [无依赖] [出参：capability 结构定义]
  - ✅ 2026-10-04 完成。落点 `packages/core/src/access/capability.ts`（**openhive 定制文件，非上游**）
    ＋ canary 测试 `packages/core/test/access-capability.test.ts`（4 pass）。结构：
    `Capability = { id: cap_* , scope: { user, project(=工作空间轴 Project.ID), dataScope }, permissions: Ruleset }`。
    **裁定（用户 2026-10-04）**：`dataScope` 只写「按谁、按哪条规矩查」
    （`{ subject, rule: "project-membership" }`），**不写任何项目 id 列表**——写死即冻结，
    与 FR-008「运行时实时算出」冲突。完整理由 / 实测 / 变异验证见 `state.md` 的 T002 段。

## Phase 2: Foundational（capability 签发 + RBAC）

- [x] T003 实现 capability 签发（按用户 + 项目 + 数据范围）[FR-001] [T002] [出参：签发函数产出 scope 限定 capability]
  - ⚠️ 出参 2026-10-04 由「**会话启动**产出」改写为「**签发函数**产出」：实测仓库里**没有「会话启动」可挂的时刻**
    （创建不启动、启动在首次 prompt、无 started 事件；链 B 且无可写每会话槽位）。裁定见 `state.md` D0-5。
    接线（把证挂到会话上）归 **T005 / T006**。
  - ✅ 2026-10-04 完成。落点 `packages/core/src/access/issue.ts`（**openhive 定制文件，非上游**）
    ＋ canary 测试 `packages/core/test/access-issue.test.ts`（4 pass）。
    `issue({ user: User.Info, project, permissions }) → Capability`；`scope.user` 与
    `dataScope.subject` **一律由 `user.id` 派生**（调用方无法替别人签，canary 钉死），
    `permissions` 原样焊进证里（未命中仍是上游兜底 `ask`）。变异 A/B/C 见 `state.md` T003 段。
    门禁：typecheck exit 0；`lint` 我两个新文件 0 命中；core **1149 pass / 8 skip / 5 fail**（差集为空）。
- [x] T015 实现迁移 CLI（`migrate()` 的生产调用路径）[D-05 裁定] [出参：一条可执行的迁移命令——缺配置必响、没活干要说话]
  - ⚠️ **不在原计划里**：由 `docs/workspace/deploy-todo.md` 的 **D-05** 裁定产生。004 要加 `0004`（RBAC 表），
    正好撞上 D-05 那笔账（`migrate()` 唯一的调用点是一次性引导 ⇒ 撤掉变量后**新迁移没人应用**）。
    用户 2026-10-04 两问两裁：路径 ⇒ **独立 CLI 脚本**；回滚范围 ⇒ **只做向上迁移**。
  - ✅ 2026-10-04 完成。落点 `packages/auth/src/migrate-cli.ts`（openhive 定制）
    ＋入口 `packages/auth/script/migrate.ts`＋`packages/auth/package.json` 加 `migrate` 脚本
    （**package.json 是上游文件被改，提交信息已单独标注**）。命令：`bun run --filter @opencode-ai/auth migrate`。
  - 测试 `packages/auth/src/migrate-cli.test.ts`（2 pass）；**第二半是真库**——PGlite socket 走**生产驱动** `bun-sql`，
    钉「第一次有活干 / 第二次幂等且**仍有输出**」。变异 A（把缺配置降级成静默 `return []`）**恰红 1 条**。
  - ⚠️ **R11 未被解锁**：CLI 只做向上迁移 ⇒ 003 的**回归条件 ③**（`rollback()` 有了生产调用者）**未触发**，
    维持「明确不做」。🚩 触发条件已收紧并**逐字写进** CLI 头部注释 ＋ D-05 条目。完整裁定见 `state.md` T015 段。
- [x] T004 [P] 实现 RBAC 表（role / user_role / role_resource）+ 权限判定（读/写/审/管）[FR-007] [T001] [出参：角色授资源权限，判定函数返回正确结果]
  - ✅ 2026-10-04 完成。两处落点：**库**在 auth（`packages/auth/src/migrations/0004_rbac.sql` ＋ drizzle 模型 `rbac.ts`），
    **判定**在 core（`packages/core/src/access/rbac.ts` 的 `resolve()`，纯函数、碰不到库——core 不依赖 auth，实测）。
    出口 `Permission.Ruleset`（用户裁定），直接喂 T003 的证；**未授权仍落上游兜底 `ask`，绝不补 allow**。
  - 两问两裁：「用户例外」⇒ **不加第 4 张表**（例外 = 单独给一个自定义角色）；判定出口 ⇒ **`resolve(...) → Permission.Ruleset`**。
  - 测试：core `test/access-rbac.test.ts`（7 pass）＋ auth `src/rbac.test.ts`（8 pass，**打真库** PGlite）。
    变异 A–F：A/B/C/D/F **恰红目标**；**E（外键 CASCADE）一度全绿** ⇒ 查出「两条外键挂在同一个角色上互相掩护」，
    拆成两条各自只让一把外键在场的用例后 **E 恰红**（`LEARNINGS #003-03` 的 ③ 类处理）。
  - ⚠️ **0004 撞红了 4 个既有测试文件里的 7 条断言**（002 时期写死了迁移清单：`["0001_init", …]`、head = `0003_flags_not_null`）。
    按 `#002-06`（会随编辑变的值别写死）改为**从盘上取**：`migrate.ts` 新增 `migrationVersions()`（**openhive 定制，「加」不「改」**），
    4 处断言改用它 / 用 `migrate()` 的返回值；`register.test.ts` 那句 `drop table auth.user` 因新外键需加 `cascade`。
    见 `state.md` T004 段的「既有测试的连带修正」。
  - 门禁：typecheck exit 0；`lint` 我那 4 个新 `.ts` **0 命中**（全局 4942/1 与基线逐字相同）；auth **210 pass / 1 skip / 0 fail**（T015 后基线 202 → **+8**）。

## Phase 3: US2 工具过滤 + 执行鉴权（P1）

- [ ] T005 实现工具清单过滤（组装 tools 前按 capability 只放有权工具）[FR-003] [T001][T003] [出参：无权工具不出现在 tools]
- [ ] T006 实现工具执行守卫（执行前验 capability，无权限 AccessDenied + 审计）[FR-004] [T001][T003] [出参：越权调用被拒并留审计]

## Phase 4: US3 MCP 账号兜底 + RLS（P1）

- [ ] T007 实现 MCP 端带 user 身份 + 受限数据库账号执行 [FR-005] [T003] [出参：MCP 查询带身份、受限账号]
- [ ] T008 实现业务数据 PG 行级 RLS 策略（CREATE POLICY）[FR-006] [T007] [出参：越权行被 RLS 过滤]
- [ ] T009 实现结果量级控制（MCP LIMIT + 分页 + 导出需更高权限）[FR-006] [T007] [出参：超限查询被 LIMIT 拦截]

## Phase 5: US5 数据范围（数据轴）（P2）

- [ ] T010 ~~实现数据范围运行时 join「数据项目 ↔ 用户」实时算出~~ 📤 **整条移交 `007-fund-analysis`**（2026-10-04 用户裁定，见 `state.md` D0-4）[FR-008] [T003][T007] [出参：数据范围按有权项目实时过滤]
  - 移交原因：**今天没有对象可 join**（`fund_project_member` 等表在 `packages/` 下零命中），
    且 F7 反向依赖 004 ⇒ 循环依赖空档。落点 = `007-fund-analysis` 的 **T004 / T001**。
    ⚠️ **不得声称 FR-008 已端到端验证**（`LEARNINGS #002-02`）。
- [ ] T011 ~~实现数据轴 / 工作空间轴两套权限解耦~~ 📤 **整条移交 F7**（同上）[FR-009] [T010] [出参：工作空间成员不影响数据访问权限]
  - 落点 = `007-fund-analysis` **T004**（数据轴）＋ `005-project-management` **T004**（工作空间轴）。
    004 只交**架构约定**（capability 的 `dataScope` 字段结构 + 两轴不绑定）。

## Phase 6: 安全测试（验收，P1）

- [ ] T012 写测试：越权工具调用被拒 + 审计留痕 [FR-010][SC-001] [T006] [出参：测试通过，AccessDenied + 审计]
- [ ] T013 写测试：越权 SQL 被 RLS 拦截、拿不到无权数据行 [SC-002] [T008] [出参：测试通过，越权行不可见]
- [ ] T014 写安全测试（路径穿越 / SQL 注入 / 未授权直连 / 越权读他人数据）[design-v2 §14.5] [T006][T008] [出参：安全测试全通过]

---

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003（依赖 T002）；T004 ∥ T003（依赖 T001，可与 T003 并行）
- **Phase 3**：T005（依赖 T001+T003）；T006（依赖 T001+T003，可与 T005 并行）
- **Phase 4**：T007（依赖 T003）；T008（依赖 T007）；T009（依赖 T007，可与 T008 并行）
- **Phase 5**：~~T010~~ / ~~T011~~ —— **整条移交 F7**（2026-10-04 用户裁定）。本 feature 的 Phase 5 清空，
  只留架构约定（`dataScope` 字段结构 + 两轴不绑定），运行时 join 与两轴验收在 `007-fund-analysis` T004
  ＋ `005-project-management` T004 落地。
- **Phase 6**：T012（依赖 T006）∥ T013（依赖 T008）∥ T014（依赖 T006+T008）

共 15 条任务（T001–T015），其中 **2 条移交 F7**（T010 / T011）⇒ **本 feature 在册 13 条**（T001–T009 + T012–T015），
符合 12–18 条范围。⚠️ **T015 是计划外新增**（D-05 裁定产生，非原 tasks 列表），已计入。
