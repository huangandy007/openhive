# Tasks: 治理后台

**Input**: `docs/superpowers/specs/010-governance-console/`

**Prerequisites**: spec.md（用户故事）、plan.md（结构 / 集成点）、F2 账号 + F4 RBAC/审计 + F9 资产治理已落地

> 📥 **接收自 F3 的移交（2026-10-01）**：003-multi-tenant-isolation 的 **T016（越权 BOLA/BFLA）**
> 整条落到本文件 **T015**。**别以为它已经在 F3 做完了**——F3 只交了 BOLA 那半边
> （跨身份拿不到对方的库/目录/会话），**BFLA 那半边一格都没测**，理由是当时**没有可测对象**：
> 管理员能力的三个端点不存在、`isAdmin` 在全仓库**没有任何一处在服务端做授权判断**
> （只被回传给前端供过滤显示）。端点的家是本文件的 **T005**，门的家是 **T003**。
> ⚠️ 更要紧的一句：**本文件 T014 不覆盖它**——T014 测的是「两类管理员**之间**互不越界」
> （管理员 A vs 管理员 B），而 T015 测的是「**普通民警 vs 管理员**」。
> 两者是不同的越权方向，缺哪一半都是真的缺口。详见 T015 条。

> 📥 **接收自 F3 的移交（2026-10-02，第二笔）**：003 的 **T022（录入账号的完整动作）** 与
> **T024（停用他人账号）** 的**触发者**都落在本文件的 **T005**（账号管理：用户列表 + 录入 +
> 重置 + 停用 + 僵尸清理）。两者在 F3 都是「**能力已交付、触发者未到**」——`provisionUser` /
> `disableAccounts` 除测试外**全仓库零调用**。三条要在写 T005 时当心：
> 1. **录入调 `provisionUser`，不要调 `registerUser`。** 后者只落库、**不建沙箱目录**
>    ⇒ 留下一个「**能过认证、却没有沙箱**」的账号（默认口令的 hash + `status = 1`，登录判据
>    只卡 `status !== 1` 与密码，所以它真能登进来），而且**挡住重试**：同警号再录一次撞 UNIQUE，
>    管理员看到「该警号已录入」，而那个账号用不了。F3 的 T022 就是为治这个把顺序反转成
>    「先建目录、后落库」，并让 `provisionUser` 不再调 `registerUser`（见
>    `packages/auth/src/register.ts` 的 `provisionUser` 文档注释）。
> 2. **`disableAccounts` 会抛 `LastAdminError`**（挡「停用最后一个管理员」）。今天**没有消费方**
>    ——调用方要把它翻译成一句给管理员看的话（例：「不能停用最后一个管理员（000051）」），
>    **别让它变成 500**。
> 3. **那道守卫有 TOCTOU 窗口**（先 `select` 出启用管理员、再 `update`）：两个管理员同时各自
>    停用对方时，可能都读到「还剩两个」而**都放行**，净结果 0 个管理员。**今天不可达是因为
>    没有调用方**——T005 一落地它就可达了。与 F3 的 T015（越权）**是两件事**，别互相顶替。
>
> ⚠️ 这三条在 F3 的缺口表里原先只写着「触发者属 **F10**」——**写着 F10 但没有落进 F10 的表**，
> 正是 `LEARNINGS #002-04` 说的「把责任推进黑洞」。本次由审查 R-21 补齐。

> 📥 **接收自 F4 的语义说明（2026-10-05，R4 —— 不是一条 task，是一条「别过度承诺」的语义）**：
> 004 定义了**授权变更的生效时点**（`004-access-control/spec.md` 的 Edge Cases）：
> capability 在**会话创建那一刻**把 ruleset 焊进 `session.permission`，之后建会话 / 改会话两条路径
> 都只走 `mergeClientRules`、**不回查** `auth.user_role` / `auth.role_resource`
> ⇒ **管理员改授权（增或删）对已存在的会话无效，要下一次建会话才生效；会话生命周期 = 滞后窗口。**
>
> **对 T003（RBAC 权限矩阵）的要求**：若这里做「改角色 / 改授权」的写入动作，**界面上不要写
> 「立即生效」**——它做不到，而 004 刻意不提供会话级吊销（回查角色表 = 违反 004 的 FR-002
> 「执行器只认 capability」）。真要「立刻踢掉」，落点是**让会话作废 / 重新签发**（新会话），
> 那是另一条路径，不是把回查塞回执行器。验收时**别把「改完立刻生效」写进出参**。

**Tests**: 以「受影响 package 的 bun test」覆盖两类管理员分权、审计检索。

## 任务格式约定

- `[P]` = 可并行（不同文件、无依赖）
- `[USn]` = 所属用户故事
- `[FE]` = 前端 / `[INT]` = 前后端集成 / `[BE]` = 后端。
- `[FE]` 任务标注「换皮」或「新增」：**换皮** = 改 opencode 已有组件 token；**新增** = 新建 openhive 组件（治理后台 + 8 大管理界面）。token 映射见 plan.md「前端换皮区」。
- 每条含 `[FR-x 来源] [依赖任务] [出参验证方式]`

## Phase 1: Setup（视图骨架 + 分权矩阵）

- [x] T001 [P] [FE·新增] 建立治理后台全屏视图骨架（一个系统两个视图 + 顶栏入口）[FR-001] [无依赖] [出参：管理员从用户下拉进入治理后台]
- [x] T002 [P] [BE] 确定两类管理员分权权限矩阵（系统管理员 vs 业务专家）[FR-003] [无依赖] [出参：权限矩阵记录在案]

## Phase 2: Foundational（分权 + 分析库）

- [x] T003 [BE] 实现管理员分权（is_admin + RBAC 权限矩阵）[FR-003] [T002] [出参：两类管理员各见各的功能]
- [x] T004 [BE] 实现分析库（event 表增量抽取 → 用量/成本）[FR-008] [T001] [出参：event 增量抽取到分析库]

## Phase 3: US2 账号 + 组织（P1）

- [x] T005 [P] [FE·新增] 实现账号管理（用户列表 + 录入 + 重置 + 停用 + 僵尸清理）[FR-004] [T003] [出参：账号管理功能可用]
  - 📥 **本条是 003 的 T022（录入）/ T024（停用）的接收方**——**动手前先读文件头那笔移交**
    （录入调 `provisionUser` 不调 `registerUser` / `LastAdminError` 要有消费方 / 守卫的 TOCTOU 窗口）。
  - ✅ 交付（2026-10-26）：后端出口 `governance-accounts.ts`（7 条路由，授权排在一切副作用之前）
    ＋ 读面 `auth/account-admin.ts`（真库测）＋ 前端 `account-api.ts` / `account-manage.tsx`
    （含录入抽屉、详情、重置/停用确认、批量停用、僵尸开关）＋ 4 条 story。测试实得：
    auth 全量 **314 pass / 3 skip / 0 fail**、路由 **26 pass / 0 fail**、app 治理 **53 pass**
    （其中 T005 新增 30 条）、app 组件全量 **1393 pass / 0 fail**；变异 M1–M8 均实得红并还原。
  - ⚠️ **axe 红 1 格**（light，「启用」标签 `Tag variant="accent"` 3.11:1 < 4.5:1）——
    按护栏 HALT，**未改视觉**，等设计裁定（详见 `state.md` 的缺口 ①）。
- [x] T006 [P] [FE·新增] 实现组织架构（org/dept/section 三级树增删改）[FR-005] [T003] [出参：组织树增删改]

## Phase 4: US3 资产治理 + US4 数据项目（P1）

- [x] T007 [P] [FE·新增] 实现 AI 资产治理（审核/发布/上下架，复用 F9 机制）[FR-006] [T003] [出参：审核/发布动作可用]
  - 交付：内核两条出口（`governance-assets.ts`：列表 ＋ 流转）＋ 前端 `asset-api.ts` /
    `asset-governance.tsx` ＋ 4 条 story；接线 `console.tsx` / `console-host.tsx` /
    `console-connected.tsx`。**009 一行未改**——治理板块的 read/review/admin 在此**投影成单份资产的
    授权行**（009 的每资产授权行没有通配），`review ≠ admin` 的两道关原样保留。
  - 测试新增 39 条（后端 18 / asset-api 10 / 组件 10 / console 接线 1）；后端变异 B1–B6、
    前端 F1–F6 均实得红并还原，**B5（通知失败 ⇒ 500）0 红**——该分支无用例守，已记入缺口。
  - 门禁：opencode 路由 18 pass、app 治理 99 pass、`test:components` 全量 1420 pass、
    根 typecheck 32/32、oxlint 0 warning；`bun.lock` **1 行**（workspace 依赖，非镜像污染）。
  - **axe 新增 8 格全绿**（含驳回确认框打开态）；唯一红仍是 T005「有数据 [light]」3 个 accent 标签。
- [x] T008 [P] [FE·新增] 实现数据项目权限（管理员兜底撤销/归档）[FR-007] [T003] [出参：管理员兜底撤销/归档]
  - 交付：内核四条出口（`governance-projects.ts`：全量项目列表 / 成员名单 / 兜底撤销 / 兜底归档）
    ＋ `auth/project-member` 新增并集读面 `projectOverviews` ＋ 归档管线抽成 `archiveProject`
    （005 与治理**共用一份次序**：全员传完才开删、标记最后落）＋ 前端 `project-api.ts` /
    `data-project-perm.tsx` ＋ 4 条 story；接线 `console.tsx` / `console-host.tsx` /
    `console-connected.tsx`。
  - **FR-004 × FR-007 的冲突按下述裁定落地**（用户 2026-10-26 认可「按专业建议」）：管理员可撤
    **普通成员**、可**归档**整个项目；**不能撤 owner**（会留下无主项目，破 005 的不变量「项目永远
    有一个 owner」）——owner 调离一律走归档（全员转存备份 → 沙箱清空 → 冻结）。`decide` 的语义
    **一个字未改**：治理管理员不是成员，走的是 `authorizeGovernance(admin)` ＋ 自己的边界。
  - 测试新增 39 条（后端 13 / project-api 13 / 组件 11 / console 接线 2）；后端变异 B1–B4、
    前端 F1–F4 均实得红并还原（B4 连带钉住 005 的两条次序用例，证明共用函数没有把旧出口的
    不变量留在只有一份注释里）。
  - 门禁：治理后端 13 pass、005 归档/找回/项目 46 pass、005 成员/删除/改名/共享 42 pass、
    `test:components` 全量 1433 pass、`bun run typecheck` 32/32、oxlint 本批文件 0 warning；
    `bun.lock` **0 行**。
  - **axe 新增 8 格全绿**（4 条 story × light/dark，含归档确认框打开态）；另用真 Chromium 复核
    「确认框真的开了」与「有数据 story 真画了 3 行成员 / 2 颗撤销钮」，避免 Portal 子树与异步
    点击造成哑绿。已知红仍是 T005「有数据 [light]」3 个 accent 标签（等视觉裁定）。

## Phase 5: US5 用量 + 审计（P2）

- [x] T009 [P] [FE·新增] 实现用量/成本看板（谁调了多少模型/token/成本分摊）[FR-008] [T004] [出参：看板展示用量]
  - 交付：内核一条只读出口（`governance-usage.ts`：`GET /openhive/governance/usage-cost?from=&to=&groupBy=`）
    ＋ T004 的 `GroupBy` 增 `"user"`（纯增量：键是 `user_id`，姓名由出口翻）＋ 前端
    `usage-cost-api.ts` / `usage-cost.tsx` ＋ 4 条 story；接线 `console.tsx` / `console-host.tsx` /
    `console-connected.tsx`。
  - **抽取先于报表**（T004 `report` 的 docstring 把次序交给调用方）：每次读都 `extractAll → report`，
    幂等靠主键 ＋ 游标；v1 无调度器，同步 SQLite 扫增量占事件循环，记入缺口。
  - **两个「根」没有混用**（实测过）：抽取按 `dataRoot(process.env)`（`OPENHIVE_DATA_ROOT`）拼
    `{userId}/opencode.db`，**不是** `AnchorWorkspace.Config.root`（沙箱根）——混用会让所有用户
    都「缺库」⇒ `collected:false` 且不报错。出口因此不取 `AnchorWorkspace`。
  - 判定：`collected:false` ⇒ 四张卡片与水位全显示「—」并说明原因（不是 0）；窗口左闭右开；
    分组 `org`/`model`/`user`，`user` 标签「姓名（警号）」，账号已清理回落 `已注销用户（前 8 位）`
    （历史成本不抹掉，行不隐藏）；停用账号仍参与抽取（成本已经付过）。
  - 测试新增 30 条（后端 12 / usage-cost-api 8 / 组件 8 / console 接线 2）。
    变异 B1 拆授权闸门 ⇒ 2 红；B2 不抽取只报表 ⇒ 5 红；B3 窗口右端取闭（`to+1`）⇒ 6 红；
    B4 不做姓名翻译 ⇒ 1 红；B5 `KEY_OF.user` 读 org ⇒ 1 红；F1 `collected:false` 画 0 ⇒ 1 红；
    F2 拆代次守卫 ⇒ 1 红；F3 切分组不重拉 ⇒ 2 红；F4 去掉金额格式化 ⇒ 1 红。全部还原。
  - 门禁：opencode `analytics+usage` 27 pass、app 治理 143 pass（14 文件）、`test:components` 全量
    1443 pass、根 typecheck 32/32、oxlint 本批 0 warning；`bun.lock` **0 行**。
  - **axe 首轮 8 格中 4 格红**（4 条 story 的 dark 格，`serious · color-contrast`），落点是工具条
    选中钮——我照 `console.tsx` 的导航项用了 `accent-soft`，**违反 T006 已定的规矩**
    （`org-tree.tsx` 文件头：浅金底实测 1.07–1.99:1）。改为 T006 的方案（中性 `layer-02` 底 ＋
    金色描边）后**复跑 8 格全绿、0 违例**；未动断言、未加白名单、未改 token。
    已知红仍是 T005「有数据 [light]」3 个 accent 标签（等视觉裁定）。
- [x] T010 [FE·新增] 实现审计日志检索（谁/何时/调了什么，含越权记录）[FR-009] [T003] [出参：审计检索可用]
  - 交付（**两笔提交**：T010a 审计底座＋埋点，T010b 检索出口＋前端）：
    - **底座**：`packages/auth/src/audit.ts`（`AUDIT_RESULTS` / `AUDIT_ACTIONS` 闭集、`recordAuditEvent`
      、`listAuditEvents` 共用筛选 ＋ 总数分页）＋ `migrations/0015_audit_event.sql`（`auth.audit_event`，
      `occurred_at` 是 **int4 秒**）；内核 `server/openhive/audit.ts` 三个记录口——`写一行`（抛）
      / `尽力记`（**永不抛**，失败只 `console.warn`）/ `记治理`（按板块取 `{记, 记失败}`）。
    - **埋点**：`governance-authz.ts` 的 403 记 `governance.denied`；账号 / 组织 / 资产 / 项目 / 用量
      五个出口的写动作逐个记；工具越权记 `tool.denied`。
    - **检索**：`server/openhive/governance-audit.ts` 一条只读出口
      `GET /openhive/governance/audit-log?from=&to=&actor=&action=&result=&q=&page=&pageSize=`；
      前端 `audit-log-api.ts`（严格解析、snake→camel、五路 outcome）＋ `audit-log.tsx`（筛选条 / 表格 /
      行内展开 / 复制 / 分页 / 空加载错误三态）＋ 4 条 story ＋ `console*.tsx` 三处接线（未注入 ⇒ 占位）。
  - **审计不审计自己**：读这条出口**不落审计行**。把它记进同一张表会让翻页本身涨 `total`，管理员永远
    翻不到底——同一条边界也管住 T010a 的「治理读动作不记」。
  - **授权先于参数解析**（`#004-09`）：民警递 `from=abc&result=bogus` 必须 403，不是 400——否则 400/403
    的差别就是「这个端点吃什么参数」的探针。
  - **时间单位是秒、缺省近 7 天、窗口左闭右开**（DESIGN §4.11.7）。前端与 `usage-cost` 的毫秒口径
    **故意不同**，两边文件头都写明了，误传毫秒会让窗口落到五万年后的空集而界面看起来只是「没有记录」。
  - **越权记录 fail-closed**：`permission/index.ts` 的 deny 分支调用记录器，记录器自身**永不抛**
    （记录失败不能把一次该拒的调用变成放行）。
  - 测试新增 **78 条**：`@opencode-ai/auth` `audit.test.ts` 9；opencode `openhive-governance-audit.test.ts` 8、
    `permission/openhive-audit-denied.test.ts` 9、`openhive-governance-audit-log.test.ts` 21（真 PGlite、
    8 天前/1 小时前/1 分钟前三行夹具、权限矩阵、400 族、缺省窗口、半开区间、四类筛选、分页与「读不落行」）、
    app `audit-log-api.test.ts` 15、`audit-log.test.tsx` 16。
  - T010b 变异（均实得红并还原）：S1 授权挪到解析之后 ⇒ **1 红**；S2 缺省窗口改 30 天 ⇒ **3 红**；
    S3 丢掉结果筛选 ⇒ **1 红**；C1 前端默认天数改 30 ⇒ **2 红**；C2 详情永不渲染 ⇒ **2 红**；
    C3 下一页传同一页 ⇒ **1 红**；C4 加载时清空数据 ⇒ **1 红**；C5 语义色挪回文字层 ⇒ **1 红**。
    T010a 的变异记录见提交 `43fbb08984` 的提交信息。
  - 门禁实得：根 `bun run typecheck` **32/32 successful**；opencode 治理 **121 pass**（9 文件）；
    app 治理 **174 pass**（16 文件）；oxlint 本批 **11 文件 0 warning / 0 error**；
    `git diff --stat bun.lock` 无输出。（根 `bun run lint` 有既有基线 **5219 warning / 1 error**，
    不在本批文件内，据实记。）
  - **axe：首轮 8 格中 2 格红**（`有数据 [light]` / `详情展开 [light]`，`serious · color-contrast`），
    落点是**我给结果文字上的语义色**。真 Chromium ＋ axe 实测：`#198b43 / #fcfcfc` = **4.25:1**、
    `#cb9f34 / #fcfcfc` = **2.39:1**（要求 4.5:1）——低的是 **token 本身**（浅色取 `green-800` /
    `yellow-800`），不是布局。按用户裁定走 A 案：**语义色只上在图标上、文字一律正文色**
    （`text-v2-text-text-base`，16.91:1），依据 DESIGN §4.11.7「颜色只作辅助」＋ `Icon` 自带
    `aria-hidden`（冗余图形，WCAG 1.4.11 不设 3:1 门槛）。复跑 ⇒ **8 ✅ / 0 ❌、0 违例**；
    **未动断言、未加白名单、未改 token**。
  - **同类落点（`#002-06`，逐个查过、本轮都不动）**：`dual-file-tree.tsx:87/471/615` 也把
    `text-v2-state-fg-warning` 当**文字**色（浅色下同一个病，对应 story 恰好没画到那段）；
    `file-transfer-dialog.tsx:153` 只给 `aria-hidden` 图标上色（不受影响）；其余 `text-v2-state-fg-success`
    都落在 `bg-v2-state-bg-success` 的底色块上（不受影响）。另撞见 **008 的
    `dual-file-tree--backups-not-wired / backups-empty` 浅色两格已红**（`text-v2-text-text-faint` 13px）
    ——是本特性之外的既有红，一并记入待裁定。
  - **缺口**：① 备份事件（008 `backup.*`）**没有**并入审计视图；② 治理**读**动作不记（含审计出口自身，
    理由见上）；③ `Permission.ask` 钩子只覆盖链 A（`permission/index.ts` 的 deny 分支），
    **那一行接线本身没有测试盯着**；④ **无留存 / 归档策略**（表只增）；⑤ 工具拒绝记录是**同步等待**
    PG，PG 不可达时最坏等 3s 连接超时（挡在工具调用前）；⑥ **真栈未跑**；⑦ 组件层**实现前未观察到红**
    （首轮用了错 flag，跑出来是 `jsxDEV` 报错），红证据由变异 C1–C5 提供，据实记；
    ⑧ 后端实现后**首轮**曾出现 4 条失败（涉 `tool.denied` 行与 total），随后**连续 4 次复跑稳定 21 pass**，
    根因未定位，留作复核点。

## Phase 6: US6 模板 + 数据源（P2）

- [x] T011 [FE·新增] 实现模板库（报告模板/图谱样式/报表口径）[FR-010] [T003] [出参：模板可配置]
  - 交付：
    - **迁移**：`packages/auth/src/migrations/0016_template.sql`（`auth.template`：text id、**int4 秒**、
      `scope`/`content` 缺省 `''`、`status` 缺省 `'active'`；五个 CHECK 与 TS 常量逐字相同——名字 1..100
      / 范围 ≤200 / 正文 ≤20000 / kind、status 闭集；`CREATE UNIQUE INDEX template_active_name_idx
      ON auth.template (kind, name) WHERE status = 'active'` ＋ `template_kind_updated_idx`）＋ `.down.sql`。
    - **表规则全在** `packages/auth/src/template.ts`：`listTemplates`（只 active、`updated_at desc, name asc`、
      `LEFT JOIN auth.user` 取更新人姓名/警号）／`createTemplate`（名字与范围**修剪**、正文不修剪；`23505`
      → `TemplateNameTakenError`）／`updateTemplate`（`coalesce` 部分更新、`where id = … and status = 'active'`）
      ／`disableTemplate`（幂等：`changed` 由 `returning` 行数决定）。路由与前端只翻译，一条规则都不重写（`#002-06`）。
    - **出口**：`server/openhive/governance-templates.ts` 四条（`GET` 列表带 `?kind=`、`POST` 新建 201、
      `POST /:id` 编辑、`POST /:id/disable` 停用），`server.ts` 注册；**授权先于读体**（`#004-09`）。
    - **审计**：`AUDIT_ACTIONS` 增 `template.create` / `template.update` / `template.disable`（闭集 17 条）；
      前端 `ACTION_LABELS` 同步三行。成功行记 `{kind,name}` / `{name,fields}` / `{name,changed}`，
      4xx 记 `result: failed`，无权者由 `governance-authz` 记 `governance.denied`。
    - **前端**：`template-api.ts`（严格逐字段解析、10s 超时、三态 outcome）＋ `template-lib.tsx`（分段控件 /
      表格 / 抽屉 / 危险确认）＋ `overlay.tsx`（**共用的** `浮层`，DESIGN §4.11.4 几何）＋ 4 条 story ＋
      `console*.tsx` 三处接线（未注入 ⇒ 占位）。抽屉里**没有类型选择器**：类型取自当前分段（避免两个真相）。
  - **停用不可逆，确认框必须说出来**：v1 只有停用、无启用入口，文案写「无法恢复启用（v1 没有启用入口）」
    ＋「停用后同名可以重新新建」——后者不写，人会以为停用把名字也占死了。
  - 测试新增 **51 条**：`@opencode-ai/auth` `template.test.ts` 15；opencode `openhive-governance-templates.test.ts`
    14（真 PGlite ＋ 真 app：401/403 矩阵含**系统管理员对 template-lib 无权限**这一格、授权先于读体、
    400/409/404、kind 过滤、停用后同名可重建、连停两次幂等、三个审计动作与 failed 行、读列表不落行）；
    app `template-api.test.ts` 7、`template-lib.test.tsx` 13、`console.test.tsx` +2。
  - 变异（均实得红并还原）：M1 授权挪到读体之后 ⇒ **1 红**（`Expected: 403 / Received: 400`）；
    M2 删 kind 过滤 ⇒ **auth 1 ＋ 路由 1 红**；M3 拆 `23505` 映射 ⇒ **auth 2 ＋ 路由 2 红**；
    M4 停用改 `select`、不写状态 ⇒ **auth 3 ＋ 路由 3 红**；M6 保存成功后不刷新 ⇒ **1 红**；
    M7 文案改回「可以重新启用」⇒ **1 红**。
  - **M5 暴露一条假绿（`#005-47` / `#005-18`）**：去掉 `disable` 的 `and status = 'active'` 后，auth 层 1 红，
    但**路由层 0 红**——那条用例只比 `updatedAt`，而两次调用落在**同一秒**。补硬判据：第二次由**另一个专家**
    （新增 `EXPERT2`）点，断言 `updatedBy` 仍是第一位专家；重放 M5 ⇒ 两层各 **1 红**
    （`Expected: "cccccccc-…" / Received: "eeeeeeee-…"`）。
  - 门禁实得：根 `bun run typecheck` **32/32 successful**；auth `template.test.ts` **15 pass**；opencode 路由
    **14 pass**；app `template-api.test.ts` **7 pass**、`template-lib.test.tsx` ＋ `console.test.tsx` **29 pass**；
    oxlint 本批 **17 文件 13 warning / 0 error**——13 条全落在既有基线族（`await-thenable` 9、
    `no-unsafe-type-assertion` 2、`no-base-to-string` 2，同族在 `org-tree.ts` / `org-tree.test.ts` 里既有），
    本轮**新引入的 2 条**（未用 import、多余类型实参）已清掉；`git diff --stat bun.lock` **无输出**。
  - **axe：8 格全绿、0 违例、几何 0 格失格**（`有数据/空/错误/停用确认` × light/dark；实得命令输出在提交信息里）。
    **未动断言、未加白名单、未改 token。**
  - **同类落点（`#002-06`，逐个查过）**：`org-tree.tsx` / `account-manage.tsx` / `ai-assets` / `project-perm`
    各自内联的 460px 浮层仍在——本轮新增共用 `overlay.tsx` 时**没有**回头改它们（Surgical Changes），
    文件头写明「后续迁移」；`console*.tsx` 三层注入的模式与既有四个板块一致，未改。
  - **缺口**：① **停用不可逆**（v1 无启用入口，只能改库）；② 正文是**自由文本**、无按类型的结构化 schema
    （消费者不存在，拒绝为没人读的字段写校验）；③ **无消费者**读取模板（报告/图谱/口径都还没有读它的代码）；
    ④ **真栈未跑**（只有真 PGlite ＋ 真 app ＋ storybook 真 Chromium 的 axe）；⑤ 组件层首轮无红证据，
    红由变异 M6/M7 提供；⑥ `no-base-to-string` 两处落在 `template.ts` 的 join 列（类型上是 `unknown`），
    与邻文件同族、未新开写法。
- [x] T012 [INT] 实现数据源配置（注册 + connector 接口 + 血缘）[FR-011] [T003] [出参：数据源注册 + connector 接口]
  - 交付：
    - **迁移**：`packages/auth/src/migrations/0017_data_source.sql` —— `auth.data_source`（text id；`endpoint`/`owner`
      缺省 `''`、`frequency` 缺省 `'manual'`、`status` 缺省 `'active'`、`last_synced_at` **int4 秒、可空**；
      CHECK：kind ∈ database/file/api、frequency ∈ manual/hourly/daily/weekly、status ∈ active/disabled、
      名字 1..100 / 地址 ≤500 / 负责人 ≤50。**没有任何秘密列**——连接串账号口令一律不落库，由测试里
      `information_schema` 那条断言钉住）＋ `CREATE UNIQUE INDEX data_source_name_idx (name)`（全局唯一：
      没有删除，停用行仍占名）＋ `data_source_name_order_idx`；`auth.data_source_lineage(upstream_id,
      downstream_id)` 双列 PK ＋ 自指 CHECK ＋ 双 FK `ON DELETE CASCADE` ＋ downstream 索引 ＋ `.down.sql`。
    - **表规则全在** `packages/auth/src/data-source.ts`：`listDataSources`（含停用、`name asc`）／
      `createDataSource`（事务：插入 ＋ 设上游）／`updateDataSource`（`coalesce` 部分更新；**给了
      `upstreamIds` 才动边**）／`getDataSourceLineage`（上游 = `downstream_id` 侧，下游 = `upstream_id` 侧）／
      `设上游`（去重 → 自指 → 缺上游（单条 `IN` 查、点名第一个缺的）→ 成环（**从 id 沿下游能走到这条上游**
      才成环，`union` 的递归 CTE）；**校验全做完才删旧边**，整体替换）。七个领域错误。
    - **connector 只留接口**：`packages/auth/src/connector.ts`（`ConnectorConfig` / `ProbeResult` /
      `SyncResult` / `DataSourceConnector` 一个 `probe` 一个 `sync`），**无实现、无注册表、无消费者**。
    - **出口**：`server/openhive/governance-data-source.ts` 四条（`GET` 列表 / `POST` 注册 201 /
      `GET /:id` 血缘 / `POST /:id` 编辑），`server.ts` 注册；**授权先于读体**（`#004-09`）；
      血缘**写入走编辑抽屉的 `upstreamIds`**（未给 = 不动，`[]` = 清空），`GET` 只读；
      读出口**不落审计**（同 T010 口径）。
    - **审计**：`AUDIT_ACTIONS` 增 `data-source.create` / `data-source.update`（闭集 **19** 条）；
      前端 `ACTION_LABELS` 同步两行；`detail` 只记 `{name,kind}` / `{name,fields}`，**不记连接地址**。
    - **前端**：`data-source-api.ts`（三态 outcome、逐列严格解析、`lastSyncedAt` 为 null **原样保留**、
      10s 超时、路径字面量）＋ `data-source.tsx`（表格六列 ＋ 操作、注册/编辑抽屉、血缘浮层、
      最近同步恒「—」、空态「还没有登记数据源」/「尚未登记血缘」）＋ 4 条 story ＋ `console*.tsx` 三处接线
      （未注入 ⇒ 占位）。
  - **抽屉里没有口令框，也没有「测试连接」**：v1 只收非秘密的连接地址/库名；connector 未落地，
    点「测试连接」必然骗人。两件事各有一条测试钉住（`input[type=password]` 为 0、按钮文案里没有「测试连接」）。
  - **编辑「没动勾选就不发 `upstreamIds`」**：预填是一次 `await`，回包晚到或失败时若照样提交会把已登记
    的上游清空。抽屉只在用户动过上游勾选后才把 `upstreamIds` 放进 patch；晚到的预填整包丢掉（代次守卫，`#008-03`）。
  - 测试新增 **57 条**：`@opencode-ai/auth` `data-source.test.ts` 20（真 PGlite：缺省值 / 三个超长 /
    全局唯一含停用行 / 部分更新保留 created_* / 两个方向血缘 / 缺上游回滚 / 自指 / 成环回滚中文名一起 / 整体替换 vs
    `[]` 清空 / 去重 / `information_schema` 无秘密列）；opencode `openhive-governance-data-source.test.ts` 13
    （真 PGlite ＋ 真 app：401、业务专家 403、只读角色能读不能写、授权先于读体、201、400 字段族 / 409 / 404、
    血缘三条门且无半截行、两条审计动作与 failed 行、读接口不落行）；app `data-source-api.test.ts` 8、
    `data-source.test.tsx` 14、`console.test.tsx` +2。
  - 变异（均实得红并还原）：M1 授权挪到载荷收窄之后 ⇒ **路由 1 红**（`Expected: 403 / Received: 400`）——
    第一版只挪到「读取体之后」**未红**（读取体本身不拒绝，400 来自收窄），据实记；
    M2 删成环检查 ⇒ **auth 1 ＋ 路由 1 红**；M3 不删旧边 ⇒ **auth 1 红**
    （`duplicate key value violates unique constraint "data_source_lineage_pkey"`）；
    M4 下游查询方向反转 ⇒ **auth 1 红**；M5 `lastSyncedAt` null 渲染假时间 ⇒ **app 页 2 红**
    （`Expected: "—" / Received: "2026-10-26 06:26"`）；M6 编辑无脑发 `upstreamIds` ⇒ **app 页 1 红**。
  - 门禁实得：根 `bun run typecheck` **32/32 successful**；auth `data-source.test.ts` **20 pass**
    （连跑 template/org-tree 共 54 pass）；opencode 三个治理路由文件 **35 pass**（本 task 13）；
    app governance 单测 **91 pass**、组件 **129 pass**（含本 task 40）；oxlint 本批 **16 文件 21 warning / 0 error**
    ——21 条全落两个既有基线族（`await-thenable` 9、`no-unsafe-type-assertion` 12，同族在 `template.ts` /
    `org-tree.test.ts` 里既有），本轮新引入的 3 条（未用参数、2 条多余断言）已清掉；`git diff --stat bun.lock` **无输出**。
  - **axe：8 格全绿、0 违例**（`有数据/空/错误/血缘` × light/dark）。**未动断言、未加白名单、未改 token。**
    另加一次**浮层本身**的审计：Kobalte Portal 把 `governance-lineage` 渲染在 `#storybook-root` **之外**，
    标准脚本的作用域扫不到它 ⇒ 另跑 `axe.run(document.body)`，light/dark **各 0 违例**（实得）；
    同时确认第 4 条 story 真把浮层点开了（上游「在逃人员接口 接口」/ 本数据源「话单库 数据库」/
    下游「资金交易明细 文件」）。第一版 story 在 `queueMicrotask` 里点血缘按钮**点不到**（行要等 list
    回包才渲染）——改成 50ms 轮询等按钮出现（实测打开）。
  - **同类落点（`#002-06`，逐个查过）**：板块 id `data-source` 在 `auth/governance.ts` 闭集、授角色矩阵、
    `sections.ts`、两侧测试里**早已一致**（T002 落的），本 task 只加 `BOARD` 常量一处；审计动作清单**只有**
    内核 `AUDIT_ACTIONS` 与前端 `ACTION_LABELS` 两处，都已补且顺序与内核一致；迁移目录无「最新版本号」
    枚举点（`migrate.test.ts` 用注入目录）；全仓无其它模块消费 `DATA_SOURCE_*` 闭集。
  - **缺口**：① connector **只有接口**——没有实现、没有注册表、没有消费者；「测试连接」故意不渲染
    （有测试钉住）；② **最近同步恒「—」**（`last_synced_at` 无写入者），「有值则格式化」那条分支只有单测覆盖，
    真栈永远走不到；③ **没有删除**（也没有「清空秘密」——秘密根本不存在，迁移测试钉住没有这类列）；
    ④ 数据源**没有消费者**（分析链路还没读它）；⑤ **真栈未跑**（只有真 PGlite ＋ 真 app ＋ storybook
    真 Chromium 的 axe）；⑥ 组件层实现前未观察到红，红由变异 M5/M6 提供；⑦ 编辑抽屉血缘预填失败时
    只提示「已有的上游血缘没取到」，**没有重试按钮**（关掉重开即重试）；⑧ 血缘只展开**一级**（DESIGN 口径），
    没有递归图。

## Phase 7: 收尾 + 测试（P1）

- [x] T013 [FE·新增] 实现治理后台只承载「配置 + 审核 + 查看」的边界 [FR-012] [T001] [出参：后台不接入民警分析]
  - **交付（2026-10-26）**：FR-012 从「一句 spec 文字」变成**会红的三道缝**。
    ① **注册表闭集**：`sections.ts` 新增 `GOVERNANCE_KINDS = ["config", "review", "view"] as const`，
    `治理页类别` 由它派生，`GovernanceSection.kind` 必填——**闭集里没有「分析」**，往导航表加分析页
    得先改这个常量，`sections.test.ts` 当场红。八页归类：账号管理 / 组织架构 / 模板库 / 数据项目权限 /
    数据源配置 = `config`（5），AI 资产治理 = `review`（1），用量成本 / 审计日志 = `view`（2）。
    ② **DOM 钩子**：`console.tsx` 根节点 `data-governance-kind`（跟随选中项）。**纯钩子，无视觉改动、
    不加 story**——FR-012 是范围约束，不是视觉需求。
    ③ **代码图守卫** `governance-boundary.test.ts`（读源码、仿 `workspace/design-token-refs.test.ts`）：
    治理目录不得 import 分析面（`@/ai-session` / `@/workspace` / `@/center` / `@/components/prompt-input*`，
    相对路径解析后按「去扩展名前缀」判落点）；`src/workspace/**` 不得 import `@/governance`；
    全应用**只有** `pages/layout-new.tsx` 引治理后台。带正向自检（扫到 >100 文件且含治理 / 工作区 /
    分析面已知文件），防「空集合上永远绿」（`#005-47`）。
    ④ **运行时边界** `console-boundary.test.tsx`：八页**全部接线**（省略接口会回落占位，DOM 太小 → 假绿），
    逐页断言「本页根 `[data-slot=<id>][data-section=<id>]` 存在（正向可达）＋ `data-governance-kind`
    等于注册表 ＋ console 子树里分析标记命中 0」；另钉 console 与工作区**两棵互不包含的子树**、
    打开时工作区 `inert` ＋ `aria-hidden`、关闭后解禁。
  - 测试新增 **11 条**：`sections.test.ts` +3、`governance-boundary.test.ts` 4、`console-boundary.test.tsx` 4。
  - 变异（均实得红并还原）：M1 `audit-log.tsx` 加 `import "@/ai-session/session-list"` ⇒ 图守卫 1 红
    （实得 `governance/audit-log.tsx → @/ai-session/session-list`）；M2 `workspace-entry.tsx` 加
    `import "@/governance/sections"` ⇒ 图守卫 **2 红**（反向 + 唯一接线点，实得引入者多出
    `workspace/workspace-entry.tsx`）；M3 console 内容区插一个 `data-slot="session-list"` 的 div ⇒
    运行时负向断言红（`Expected: 0 / Received: 1`）；M4 某页 `kind` 改 `"analysis"`（`as` 绕过类型）⇒
    注册表 **2 红**（闭集 + 逐项归类，实得 `asset-governance=analysis`）；M5 删 `data-governance-kind` ⇒
    运行时红（`Expected: "config" / Received: null`）；M6 把 console 挪进工作区盒子 ⇒ 结构断言红
    （`工作区.contains(console)` 实得 `true`）。
  - 门禁实得：根 `bun run typecheck` **32/32 successful**；另在 `packages/app` 直跑 `tsgo -b` **exit=0**
    （turbo 报 cache hit 时以直跑为准）；app `test:components` **1494 pass / 0 fail**（含本 task 8）；
    `test:unit` **1292 pass / 27 fail / 19 error**——与 010 既有基线**同数**（state.md T001/T003 记的
    同一批 `jsxDEV` 预载问题 ＋ `project-data` 2 条，失败文件全未触碰，治理文件 0 fail）；oxlint 本批
    **5 文件 0 warning / 0 error**；`git diff --stat bun.lock` **无输出**。
  - **axe：本 task 无视觉改动、未新增 story，未跑**（不谎称跑过）。如需 8 格复验，说一声即跑。
  - **同类落点（`#002-06`，逐个查过）**：`GovernanceSection` 字面量只有 `sections.ts` 与 `sections.test.ts`
    一处测试夹具（已补 `kind`）；`GOVERNANCE_SECTIONS` 的消费者只有 `console.tsx` 与两个测试；
    `@/governance` 的引入者只有 `pages/layout-new.tsx`（已被测试钉住）；「配置 · 审核 · 查看」文案在
    `console.tsx` 两处（导航头 + 页头副标题）都是静态文案，本 task 未动；服务端板块闭集
    （`auth/governance.ts`）与 FE 的 `kind` 是两套东西，不需要同步。
  - **缺口**：① 图守卫是**静态 import 图**，挡不住「页内手写一个聊天框」或「运行时把别处的 DOM 搬进来」
    ——后者由运行时断言与真栈验收兜，前者只能靠审阅；② 若有人把分析组件**复制**进 `governance/` 目录，
    路径守卫判不出来（按目录判定，不看内容）；③ `data-governance-kind` 只是钩子，**界面无视觉区分**
    （页头副标题仍是静态「配置 · 审核 · 查看」）；④ 运行时断言依赖 happy-dom 的 `inert` 属性存在性，
    不验证浏览器里真的不可聚焦（真栈未跑）；⑤ **真栈未跑**。
- [x] T014 [BE] 写测试：两类管理员分权（各见各的功能，互不越界）[SC-002] [T003] [出参：分权测试通过]
  - **交付** `packages/opencode/test/server/openhive-governance-split.test.ts`（**只加测试**，生产代码零改动）。
    范围严格按本文件头部的分工：只测「两类管理员**之间**」；普通民警 vs 管理员（FR-013）归 T015。
  - ① **可见面**：两身份 `/me` 的 `governance` 分别 `toEqual` 各自的**恰好** 6 / 3 项；再加两条
    关系断言——**交集恰好 `["asset-governance"]`**、**并集恰好八页全集**。各板块文件只保证「这一格
    没坏」，关系断言才能抓住「一边加一页、另一边删一页」这种两边各自看起来都对的漂移。
  - ② **读矩阵**：8 板块 × 2 身份 = **16 个 HTTP 请求**；期望网格写成**字面量**（`#003-05`，不 import
    生产矩阵）。附 401 自查（无凭证 ⇒ 401），防「门都不在」被读成「分权对了」。
  - ③ **写矩阵**：五个**板级**写出口——专家撞 `POST accounts` / `POST org/nodes` / `POST data-sources`，
    管理员撞 `POST templates` / `POST projects/:id/archive` / `POST projects/:id/members/remove`；
    全部递**合法载荷**仍得 403（授权在解析之前，`#004-09`）。`assets` 的写是**资产级**授权（板级只有
    read），不属板级分权，明确排除；`usage-cost` / `audit-log` 无写出口。
  - ④ **被拒之后**：四个建行类越权写之后 `auth.user` / `auth.org_node` / `auth.data_source` /
    `auth.template` 里**目标行数 = 0**（配正向对照行 = 1，否则「不存在」也可能是夹具没生效）；
    五个板块 × 拒绝各留一条 `governance.denied`，`detail like '%"perm":"write"%'`（数据项目权限记
    `admin`）——拒绝留痕不是「写了就算」，**动作要记对**。
  - **正向对照不是装饰**：「一律 403」也会让 ③ 前三格全绿。故每个写出口在**有权的一侧**再打一次：
    管理员建账号 / 部门 / 数据源 = 201，专家建模板 = 201，专家归档不存在项目 = **404**（门已过、
    只是对象不在，404 ≠ 403）。
  - 测试 **8 条**（`it.live`），48 个 `expect`。夹具：真 PG（`startProductionDb` ＋ `migrate`）＋
    真应用（`HttpApiApp` ＋ `ConfigProvider` 注入 OPEN 环境）＋ Cookie 身份；`PG_POOL_MAX=1` 与同族
    文件一致（PGlite socket 合并连接，第二条连接再准备同名语句撞 `42P05`，见 `pg.ts` 文件头）。
    该参数是本 task 实测**需要**的：未设时第 4 个写请求起 `[openhive-audit] 审计写入失败` ⇒ 500。
  - 变异（在**最终版本**文件上逐条重跑，实得红并还原）：
    M1 种子里给业务专家加 `account-manage/read` ⇒ 可见面 1 红（交集）+ 专家读矩阵 1 红
    （实得 `板块=account-manage` 期望 403 / 实得 **200**）；
    M2 `authorizeGovernance` 跳过「进门要 read」⇒ 读矩阵 **2 红**（管理员 `template-lib` 403→**200**、
    专家 `account-manage` 403→**200**；写矩阵仍绿——写权是第二跳，两层各自有效）；
    M3 种子里删 `gov-system-admin` 的 `data-source/write` ⇒ 正向对照 1 红（期望 201 / 实得 **403**）
    ＋ 依赖它的「正面对照行 = 1」1 红（实得 **0**）；
    M4 `进()` 不记 `governance.denied` ⇒ 审计留痕 1 红（`有留痕` 实得 **false**）；
    M5 拆掉 accounts create 的写门 ⇒ 写矩阵 1 红（403→**201**）＋ 无副作用 1 红（**0→1**）＋
    审计留痕 1 红（**3 红**）。
  - 门禁实得：本文件 **8 pass / 0 fail**；12 个治理/网关文件一起跑 **174 pass / 0 fail**（57s）；
    `packages/opencode` 直跑 `tsgo --noEmit` **exit=0**；根 `bun run typecheck` **32/32 successful**；
    oxlint 本文件 **0 warning / 0 error**（首轮 3 warning 已修：`as` 断言改 Schema 解码、
    去掉两处多余的 `!`）；`git diff --stat bun.lock` **无输出**。
  - **同类落点（`#002-06`，逐个查过）**：① `grep -c EXPERT` 在账号测试与审计日志测试里各 **0**——
    这两格此前**从未**用业务专家身份打过，本文件补上；② `governance.denied` 的生产写入点**唯一**
    （`governance-authz.ts`）；③ `governanceBoards(` 的调用点只有 session / `authorizeGovernance` /
    gateway 三处，同一投影；④ 板级门共 **17 处**（`有权(…, "read"|"write"|"admin")`），矩阵每板块
    取一条代表写出口，其余写出口由各板块文件自己的用例覆盖（未重复造）。
  - **缺口**：① 写矩阵每板块只取**一条代表**写出口，账号的 password / disable / enable / batch-disable、
    组织的 rename / delete / import、模板的 edit / disable、数据源的 update / 血缘**没有**在矩阵里
    再打一遍（各板块文件有）；② `assets` 的资产级授权（review/admin 投影、作者动作 400）属 T007，
    不在此文件；③ 不含 FR-013（T015）；④ **真栈未跑**；⑤ 12 文件并行跑时观察到既有的
    `[openhive-audit] 审计写入失败` warn（**0 fail**，本文件单独跑无；属多文件同进程的 PGlite 争用，
    非本 task 引入）。
- [ ] T015 [BE] 写测试：**越权（BFLA）——普通民警凭证调管理员能力被拒**（**003 移交**，2026-10-01）
  [FR-013][SC-005]（**FR-013 / SC-005 是本 task 落地时补进 spec.md 的**——原文没有这条要求，
  只有 FR-001「仅管理员可见」，那是**入口**不是**门禁**。任务要有 spec 撑着，故一并补上）
  [T003][T005]
  [出参：**普通民警**凭证调「重置**他人**密码 / 停用**他人**账号 / 录入账号」**三条各自被拒**，
  且**管理员凭证走同样这三条正向放行**]
  - **本 task 就是 003 的 T016**，整条搬过来。003 那边勾选框保持 `[ ]`——**它没被做，只是换了归属**。
  - **为什么当时做不了**（实测，供本 task 复核）：三条能力在服务层**都在**
    （`packages/auth/src` 的 `resetPassword` / `disableAccounts` / `restoreAccount` /
    `registerUser`），但**零 HTTP 端点**；系统唯一的认证面是 `AuthGateway` 的四条路径，
    全是自助（⚠️ 「录入」的**完整动作**是 **`provisionUser`**（= 建账号 **+** 建沙箱目录），
    `registerUser` 只是它的落库那一半——**别照上面那份名单里的 `registerUser` 去接录入**，
    见文件头第二笔 📥 与 T005 条）。`isAdmin` 在 `packages/opencode/src/server/**` 里**只被搬进请求上下文**，
    **没有任何 `if (isAdmin)` 的授权分支**。
  - **本 task 的存在理由（一句话）**：**能力先于门禁落地**——那三条服务层函数现在就是
    「能力已就绪、门禁未接」状态。**T005 加路由时若忘了加 `isAdmin` 判断，就直接开出一个
    无授权的管理员接口**，而且服务层自己**不会**报错（`resetPassword` 的 docstring 明写
    「本函数自己不做鉴权……真正的门禁在调用方」）。所以本 task 不是「补一条测试」，
    是**替 T005/T003 兜住这个窗口**。
  - ⚠️ **别把它测成 404。** 未加路由时这三个路径本来就 404——**404 不是授权拒绝**，
    断言 404 会得到一条永远绿的假测试（`LEARNINGS #002-02`）。判据必须是
    「路由**在**、身份**有效**、权限**不够** ⇒ 403（或等价物）」，且**管理员走同一条必须通**。
  - ⚠️ **它与 T014 的分工**：T014 = 管理员**之间**分权；本 task = 普通民警**对**管理员。
    两条都绿才叫「分权矩阵两个方向都闭合」，**不要互相替代**。
  - ❓ **为什么落 F10 而不是 F4 权限控制**（免得将来重新论证一遍）：F4 的 FR-010 说的是
    「越权调用**工具** / 越权查询**数据** MUST 100% 被拒」——对象是 **AI 执行层**；
    本 task 的对象是「非管理员调用管理员**能力**」。F4 的 capability / RBAC 模型是**门禁的
    实现手段**，但**这一格验收的归属**在治理后台——**能力在这、端点在这、`is_admin` 也在这**。
  - 🔗 **正向放行的那一半别漏**：只测「被拒」会让「把所有人都拒掉」也全绿。
    三条能力各自要**双向**（普通民警 403 / 管理员 200）。

---

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003（依赖 T002）；T004（依赖 T001，可与 T003 并行）
- **Phase 3**：T005 ∥ T006（依赖 T003，可并行）
- **Phase 4**：T007 ∥ T008（依赖 T003，可并行）
- **Phase 5**：T009（依赖 T004）；T010（依赖 T003，可与 T009 并行）
- **Phase 6**：T011 ∥ T012（依赖 T003，可并行）
- **Phase 7**：T013（依赖 T001）；T014（依赖 T003）；T015（依赖 T003+T005）

共 **15** 条任务（T001–T015），符合 12–18 条范围。
> 数法：T001–T014 是本 feature 原有的；**T015 是 2026-10-01 从 F3（003 的 T016）接收的移交**。
> 复算命令：`grep -c '^- \[[x ]\] T0' docs/superpowers/specs/010-governance-console/tasks.md` → **15**
> （2026-10-26 T014 交付后：未勾 **1** ＝ T015）。
> 这个数字随拆分与移交而变（`LEARNINGS #002-06`），改了任务就回来重算一次。
