# 实施进度 · 治理后台

## 当前任务
T004 已交付。**下一项 T005**（账号管理），等用户 `next`。

## 已完成

- **T004** 分析库（FR-008；event 表增量抽取 → 用量/成本）
  - 新增 `packages/opencode/src/governance/analytics.ts`（约 420 行）：
    `analyticsPath(env)`（`OPENHIVE_ANALYTICS_DB` 优先，默认 `{OPENHIVE_DATA_ROOT}/analytics.db`）、
    `open(path)`（自建最小 schema，不跑 opencode 全量迁移）、`extractUser` / `extractAll`、
    `report`
  - 事实表 `usage_fact` 一行 = 一个 `step.ended`，主键 `(user_id, event_id)`；
    `INSERT OR IGNORE` 保幂等；游标 `analytics_cursor` 按事件 id 升序，**最后写**
  - 事件类型从 `EventManifest.Durable` 按前缀派生（不写死 `.2`）；模型归属先查批内
    `step.started` 映射、跨轮再回查源库；`org` 由调用方传入并快照
  - 报表：窗口 `[from, to)`、`groupBy: "org" | "model"`、4 项指标
    （`totalTokens` 口径 = 输入 + 输出；成本 6 位小数）、`collected` / `watermark`
  - 新增测试 `packages/opencode/test/governance/analytics.test.ts` **15 条**
    （路径 / 建表幂等 / 抽取 / 幂等 / 崩溃窗口重扫 / 游标 / 跨轮模型回查 / 脏数据 /
    缺库 / extractAll / 窗口边界 / 分组 / token 口径 / collected / 类型派生）
  - 变异 M1–M7 均实得红并还原：
    ① 游标 `>`→`>=` ⇒ 幂等 + 游标 + 回查 3 条红；② `INSERT OR IGNORE`→`INSERT` ⇒
    **首次没红**（第二次扫 0 条，根本没触到）⇒ 先补「游标未落盘时重扫」用例再变异，
    实得 `UNIQUE constraint failed`；③ 删回查 ⇒ model_id 变 null；④ 窗口上界 `<=` ⇒
    边界用例红；⑤ 去掉「未标注」兜底 ⇒ key 变空串；⑥ `totalTokens` 漏 output ⇒ 60→40；
    ⑦ 活跃单位不过滤空串 ⇒ 2→3
  - 门禁实得：`bun test test/governance/analytics.test.ts` **15 pass / 0 fail**；
    `packages/opencode` `bun run typecheck` **exit 0**；oxlint **0 warning / 0 error**；
    `git diff --stat bun.lock` **无输出**
  - 文档：`CONFIG.md` §3 与 `packages/opencode/.env.example` 增 `OPENHIVE_ANALYTICS_DB`
  - **缺口**：① `extractUser` / `report` 尚无生产消费者（T009 的读接口接线，与 T003 同型）；
    ② 同步 SQLite 会占住 Effect 事件循环，MVP 规模可接受，接线时记风险；③ 首抽扫表
    （event 表无 `type` 单列索引，`schema.gen.ts` 是上游生成物，不加索引）；④ `org` 是
    抽取时点快照，组织调整不追溯历史；⑤ 测试夹具是**手写的最小 event DDL**（只含
    id/type/data），core 的 DDL 若改这三列形状本文件不会红；⑥ **真栈未跑**（同 009 的
    `openai@6.39.1` 缺口）

- **T003** 管理员分权落码（FR-003；T002 的矩阵进代码）
  - 新增 `packages/auth/src/governance.ts`：`GOVERNANCE_BOARDS`（八板块，与前端
    `sections.ts` 逐字对账）、四动作、两张模板常量；`governanceGrants()` / `governanceBoards()` /
    `authorizeGovernance()`
  - 新增迁移 `0013_governance.sql`（+ `.down.sql`）：`role_resource` CHECK 加 `'governance'`、
    种两张模板角色（10 + 6 = 16 行授权），并覆盖 0008 里过时的列注释；不给人挂模板
  - `sessionIdentity` 增 `governance: GovernanceBoard[]`（`is_admin` 总开关在
    `governanceBoards()` 内一刀切断；非管理员不取行）
  - 网关登录响应与 `/me` 都带 `governance`（同一投影）；app `Identity` 增
    `governance: string[]`（缺字段 / 非字符串项 ⇒ `[]`，fail-closed）；新增
    `governance/console-connected.tsx` 把身份投影成导航能力集，`layout-new` 改挂它
  - core `RESOURCE_TYPES` 加 `'governance'`（`resolve()` 不产任何工具规则）；asset-service
    镜像断言语义改为 `ASSET_TYPES ∪ {governance}`；四处整表断言收窄到本用例建的行
  - 文档：`authorization.md` §5.3 改成「治理动作立即 / 导航刷新 / AI 工具等下一次建会话」
    三分；§6 定下模板分配归 `account-manage.write` + 目标 `is_admin=1`（落 T005）
  - 测试实得：`auth` 全量 **300 pass / 3 skip / 0 fail**，治理文件 **14 pass**；
    `asset-service` 全量 **209 pass / 4 skip / 0 fail**；opencode gateway **27 pass**、
    闭集 **1 pass**；core access-rbac **9 pass**；app `test:components` **1377 pass / 0 fail**、
    `test:unit` 1201 pass / 27 fail（与 T001 既有基线一致，失败文件
    `file-tree/ comments/ terminal/ project-data(2)/ persist/ submit/ child-store` 与
    6 条 `(unnamed)`，均未触碰）
  - 变异 M1–M5 均实得红并还原：
    ① `governanceBoards` 去掉 `if (!isAdmin) return []` ⇒ 新补的直接用例红
    （发现并补上该分支的覆盖缺口）；② 删业务专家 `asset-governance/read` 种子 ⇒ 模板对账 +
    可见板块 + 网关 `/me` 等 5 条红；③ core `RESOURCE_TYPES` 去掉 `governance` ⇒ 闭集红；
    ④ 接线层不读身份 / `readIdentity` 恒回 `[]` ⇒ 各 2 条与 1 条红；
    ⑤ 迁移 CHECK 少 `governance` ⇒ 种子插入违反 CHECK，12 条红
  - 门禁：触碰包强制 typecheck **5/5 successful、0 cached、0 error**；oxlint **0 error /
    1 warning**（`layout-new.tsx:85` 上游既有 `consistent-return`，非本轮改动）；
    `git diff --stat bun.lock` **无输出**
  - **缺口**：`authorizeGovernance()` 尚无生产消费者（T005–T012 的写动作接它）；
    「把别人提升为管理员 / 分配模板」没有路径与 UI（T005）；**真栈未跑**（009 的
    `openai@6.39.1` 缺口，同 T001）

- **T002** 两类管理员分权权限矩阵（FR-003）
  - 新增 `authorization.md`：八板块 × 四动作（`read`/`write`/`review`/`admin`）× 两类管理员，
    每一格标出处（FR-003 / US2–US6 / 009 `lifecycle.md` 触发者表 / 009 `authorization.md`）
  - 三条裁定：① **不硬互斥**（两张 RBAC 模板，取并集）；② `is_admin` 仍是**进门总开关**
    （沿 009 D0-4）；③ 表示法建议 `resource_type='governance'` + `resource_id`=八板块 id
  - 迁移代价如实记：新迁移 `0013_*` 改 `role_resource_resource_type_check`；core
    `RESOURCE_TYPES` 加值；asset-service 的镜像断言语义改为 `ASSET_TYPES ∪ {"governance"}`
  - 边界写清：页面门 ≠ 资产门（009 的 `review`/`admin` 仍要单独过）、T014 管管理员之间、
    T015 管民警 vs 管理员、004 R4 的「新会话才生效」
  - id 对账实得：`sections.ts` 8 条 ⇔ 主表 8 条，集合相同
  - **不写码**；T003 按本文件落码

- **T001** 治理后台全屏视图骨架 + 顶栏入口（FR-001）
  - 新增 `packages/app/src/governance/{sections,console,console-host}` 与三条测试
    （sections 7 / console 8 / host 4）
  - 顶栏「用户管理」⇒ `onOpenGovernance`；`layout-new` 用 host 包住 `WorkspaceEntry`
    （工作区不卸载、打开时 `inert` + `aria-hidden`、关闭后焦点回顶栏）
  - 三处目录清单同步扩 `governance`（`lint:openhive` / `openhive-module-dirs` / `design-token-refs`）
  - 变异 M1–M5 均实得红并还原（M5 附注：大写 typo 不入 token 扫描器字符集）
  - 门禁：`test:components` 1373 pass / 0 fail；`test:unit` 仅剩未触碰文件的既有失败；
    governance+topbar oxlint 0 warning / 0 error；`bun.lock` 无 diff
  - **缺口**：`typecheck` 仍红 136 条，全在未触碰的上游文件（环境 `effect` store 残缺已
    用 `--frozen-lockfile` 修复）；**真栈未跑**（009 的 `openai@6.39.1` 缺口）

## 📥 接收自 F3 的移交（2026-10-01）
003-multi-tenant-isolation 的 **T016（越权 BOLA / BFLA，P0）**整条落到本 feature 的 **T015**。
**别以为它已经在 F3 做完了**——F3 只交了 BOLA 那半边（跨身份拿不到对方的库 / 目录 / 会话），
**BFLA 那半边一格都没测**，理由是当时**没有可测对象**：管理员能力的三个端点不存在，
`isAdmin` 在 `packages/opencode/src/server/**` 里只被搬进请求上下文、**没有任何授权分支**。

落点（**都在本目录**，不是只在 003 的文档里——`LEARNINGS #002-04`）：
- `tasks.md`：Prerequisites 加了「接收自 F3」段；**新增 T015**；并行组与总数改为 15 条。
- `spec.md`：US2 新增验收场景 5；新增 **FR-013**（服务端 `is_admin` 授权，MUST NOT 只靠前端隐藏）
  与 **SC-005**（越权 100% 被拒 + **正向放行必须一起验**）。
  ⚠️ 这两条是**补写的**——原文只有 FR-001「仅管理员可见」，管的是**入口呈现**，
  不是**能力门禁**。任务得有 spec 撑着，否则就是又一次「欠账没有落点」。

⚠️ **与本 feature T014 的分工别搞混**：T014 = 管理员**之间**分权；T015 = 普通民警**对**管理员。
两条都绿才叫分权矩阵两个方向都闭合。

## 阻塞项
（无）

## 最后更新
2026-10-26（T004 交付）
