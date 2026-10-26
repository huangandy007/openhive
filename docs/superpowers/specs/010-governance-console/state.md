# 实施进度 · 治理后台

## 当前任务
T007 已交付（axe 新增 8 格全绿）。**下一项 T008**（数据项目权限），等用户 `next`。
T005 的 axe 1 格红仍在等设计裁定（A/B/C，未定）。

## 已完成

- **T007** AI 资产治理（FR-006 / US3）
  - 后端新增 `packages/opencode/src/server/openhive/governance-assets.ts`，两条出口：
    `GET /openhive/governance/assets?status=&type=&q=`（治理后台看**全量**，草稿也在）、
    `POST /openhive/governance/assets/:id/transition`（体 `{ action, reason? }`）。
    复用 009 的 `listAssets` / `transitionAsset`——状态机与文件迁移**不重写**；动作白名单 7 个，
    作者动作（`submit_review` / `start_iteration`）单列 400；授权排在**读体之前**（`#004-09`）
  - **本轮的核心决定：治理板块权限 → 单份资产的授权行**。009 的每资产授权行**没有通配**
    （`resource_id` 就是资产 id），所以 `governance/asset-governance` 的 read/review/admin 不能
    直接拿去判；出口把治理授权行投影成「当前这一份资产」的 `GrantRow[]`（只投 `review` / `admin`，
    `write` 不投——后台没有「以作者身份改内容」的动作），`review ≠ admin` 的两道关因此原样保留，
    **009 一行未改**
  - **授权先于类型判定**：`transitionAsset()` 先查类型、再查授权 ⇒ 只有 read 的人对一份 MCP 资产
    会拿到 400 而不是 403（那 200ms 的差别就是「资产是什么类型」的探针）。出口用**同一个**
    `authorizeTransition()` 预检一次；服务层随后再算一次（确定性函数、无副作用）⇒ 不是两份规则
  - 错误映射：401 空体 / 403 / 404 资产不存在 / 409（`invalid_source`、`concurrent_transition`、
    `source_directory_required`）/ 400（缺 action、未知动作、作者动作、reason 非字符串、未知状态或
    类型；**驳回理由必填**那条带 `field: "reason"`）；**通知写失败** ⇒ 200 ＋ `notice`
    （流转已生效，不回 500——否则客户端会以为没生效而重试）
  - 接线 `server.ts`（只吃 `OpenhivePg.layer`；资产根每请求读 `OPENHIVE_ASSETS_ROOT`，与 009 同约定）；
    `packages/opencode` 增 workspace devDependency `@opencode-ai/asset-service` ⇒ `bun.lock` **1 行**
    （`bun install` 污染镜像源那次已按纪律还原，见仓库级 CLAUDE.md「锁文件污染」）
  - 前端新增 `governance/asset-api.ts`（与 account/org 同范式：同源路径、可注入 `send`、Outcome 三态、
    严格解析、10s 超时；状态/类型/动作闭集**刻意复写一份**，`#003-05`）与
    `governance/asset-governance.tsx`（状态筛选默认「待业务审核」；按状态画动作；七个动作全部过
    确认框且写明后果；驳回理由必填；失败不关框；`field=reason` 挂到理由框；读列表带代次守卫
    `#008-03`）；4 条 story（待审队列 / 空 / 错误 / 驳回确认框打开态）。`console.tsx` 增 `Match`、
    `console-host.tsx` / `console-connected.tsx` 接线（未注入 api ⇒ 回落占位）
  - 测试新增 **39 条**：`opencode/test/server/openhive-governance-assets.test.ts` 18（真 PGlite ＋
    临时资产根）、`app/src/governance/asset-api.test.ts` 10、`asset-governance.test.tsx` 10、
    `console.test.tsx` +1（接线）
  - 后端变异 B1–B6（均实得红并还原）：① 白名单去掉 `archive` ⇒ **1 红**（归档用例）；
    ② 合成授权行只投 `admin` ⇒ **3 红**；③ 去掉 `authorizeTransition` 预检 ⇒ **1 红**
    （只读角色 403 那条）；④ 丢掉 `q` ⇒ **1 红**；⑤ `notice` 分支改成 500 ⇒ **0 红**（见缺口 ①）；
    ⑥ 未知 `status` 不再 400（退化为空列表）⇒ **1 红**
  - 前端变异 F1–F6（均实得红并还原）：① `published` 返回无动作 ⇒ **1 红**；② 去掉理由必填 ⇒
    **1 红**（`Received: ""`）；③ 忽略状态筛选 ⇒ **3 红**；④ 成功后不置空 `确认()` ⇒ **1 红**
    （`等到(框已关)` 超时）；⑤ 409 当 `failed` ⇒ **1 红**（`Expected "rejected" / Received "failed"`）；
    ⑥ 丢掉 `field` ⇒ **1 红**
  - 门禁实得：opencode 路由 **18 pass / 0 fail**；app 治理 10 文件 **99 pass / 0 fail**；
    `test:components` 全量 **1420 pass / 0 fail**；根 `bun run typecheck` **32/32 successful**；
    oxlint（治理目录 ＋ 本轮后端两文件）**0 warning / 0 error**；
    `git diff --stat bun.lock` = **1 insertion**（有意新增的 workspace 依赖）
  - **一个被二分出来的假问题**（写下来防重复踩）：`通过审核要过确认框` 头几轮让 bun 进程尾部多睡
    ~37s，且 `expect(框).toBeNull()` 时绿时红。逐条二分（P1–P4 / P3b / P3c / P3d）后定位：
    **Kobalte 的 `Presence` 在 happy-dom 里不会把浮层从 DOM 摘掉**——关掉后连等 10 拍仍在，
    只打上 `data-closed`；于是「框已关」当场问 `querySelector(...) === null` 取决于它那一拍有没有被
    移除。判据改为**两条的交集**（元素没了 **或** 带 `data-closed`，见测试里的 `框已关()`），
    既仍抓得住「忘了把 `确认()` 置空」（F4 实得红），也不再跟 happy-dom 的移除时机赛跑；
    改后连跑 3 次均 10 pass、每次 ~1.2s，37s 尾巴消失
  - **axe 实得**（2026-10-26）：`node e2e/a11y/storybook-axe-audit.ts "App/OpenHive/Governance"`
    （12 story × 浅/深 = **24 格**）⇒ **23 ✅ / 1 ❌**。新增的 asset-governance 四 story × 两主题
    **8 格全 0 违例**（含驳回确认框打开态的 Kobalte Portal 子树）。唯一红仍是 T005 的
    account-manage「有数据 [light]」3 个 accent 标签（3.11:1），按护栏维持 HALT、不重报为新缺口。
    复跑：`bun --cwd packages/storybook storybook --port 6018 --ci --no-open` ＋
    `STORYBOOK_URL=http://127.0.0.1:6018`（6017 仍被占）
  - **缺口**：① `AssetNotificationError ⇒ 200 ＋ notice` **没有用例守**（B5 变异 0 红）——已知，
    要造出「通知写失败」得给 `transitionAsset` 一个可注入的 notifier，属 009 的接口范围，未改；
    ② 前端用例没逐个断言 `pending_tech` / `iterating` / `archived` 三态的按钮组合
    （`可用动作()` 的这几个分支只有 `console.test.tsx` 的一条间接覆盖）；
    ③ 本任务范围只到 Skill 治理动作：**MCP / 知识库 / 授权组 / 试跑 / 归档批量 / 分页** 不在其中
    （T008 起）；④ 治理壳 `console.tsx` 仍无 story（同 T005 / T006）；
    ⑤ **真栈未跑**（同 009 的 `openai@6.39.1` 缺口）；⑥ `packages/app` 的 `test:unit` 27 fail
    全是既有的 `jsxDEV` 预载缺失（`test:unit` 没有 `--preload ./solid-jsx.ts`）＋ project-data
    upload/download 两条，失败文件与 T003 记录同一批，**均未触碰**

- **T006** 组织架构（FR-005）
  - 新增迁移 `packages/auth/src/migrations/0014_org_node.sql`（＋ `.down.sql`）：
    **一张自引用表** `auth.org_node`（`level` 显式 1/2/3；`(parent_id IS NULL) = (level = 1)`；
    同级同名用**表达式唯一索引** `coalesce(parent_id, '')`——NULL 互不相等，不套 coalesce 能建出两个根同名）。
    六个字段全带中文注释（`comments.test.ts` 先红后绿，0008 起的硬约束）
  - 新增 `packages/auth/src/org-tree.ts`：`listNodes`（`path` / `childCount` / `accountCount` 由两张
    group-by 映射补齐）、`createNode`、`renameNode`（**同一事务**里改节点名 ＋ 级联
    `auth.user` 的 org/dept/section 三列文本，停用账号也改）、`deleteNode`（先判有下级、再判有账号）、
    `importFromAccounts`（显式、幂等：同父同名复用已有节点，只补缺的层级）
  - 新增 `packages/opencode/src/server/openhive/governance-org.ts`：5 条路由
    （tree / nodes / rename / delete / import）。每请求**先** `authorizeGovernance`（`org-tree` 的
    read / write），**排在读体之前**（`#004-09`）；错误映射 400 名/层级、409 同名/非空/有账号、404 不存在。
    接线 `server.ts`（只吃 `OpenhivePg.layer`，不碰沙箱）
  - **PGlite 夹具的 `42P05` 根因**（本轮最花时间的一处）：7 条路由用例 500，日志里是
    `prepared statement "Pselect … from auth.user where id = $1$0" already exists`。
    根因是**夹具**把多条连接汇进同一个 PG 会话（预编译语句是会话级的），而 `bun-sql` 的语句缓存是
    连接级的：`db.transaction()` 从池里独占第二条连接后，下一条带参查询重新准备同名语句 ⇒ 42P05。
    真 PG 每会话独立，生产不受影响。修法是**配置优先**的可选旋钮 `PG_POOL_MAX`（`db.ts` 的
    `poolMaxOf`），测试里设 `1` 让被测代码只持一条连接；生产不配 ⇒ 驱动默认 10。
    该旋钮另有 3 条单测（不配 / 配 1 / 非正整数报错）
  - 新增前端 `governance/org-api.ts`（同 `account-api` 范式：同源路径、可注入 send、Outcome 三态、
    严格解析、10s 超时）、`governance/org-tree.tsx`（左树右详情；行内新增/改名 Enter·Esc；
    新节点建好即进改名态；删除有**两条禁用原因**：有下级 / 有账号；确认框；读树带**代次守卫**）。
    选中态用中性 `layer-02` ＋ 2px 品牌金左边框，**不用** `accent-soft`（009 实测 dark 1.07–1.99:1）。
    `console.tsx` 改为 `Switch/占位` 分派，`console-host.tsx` / `console-connected.tsx` 接线
  - 测试新增 **61 条**：`auth/src/org-tree.test.ts` 19（PGlite 真库）、
    `auth/src/db.test.ts` 3（PG_POOL_MAX）、`opencode/test/server/openhive-governance-org.test.ts` 14、
    `app/src/governance/org-api.test.ts` 9、`org-tree.test.tsx` 15、`console.test.tsx` 1（接线）；
    另有 4 条 story（有数据 / 空 / 错误 / 确认框打开态）
  - 变异 M1–M6（后端，均实得红并还原）：① 改名不级联账号 ⇒ 对应用例红；② 去掉同级同名守卫 ⇒ 撞名用例红；
    ③ 去掉删除的账号守卫 ⇒ 有账号可删；④ 放开三级上限 ⇒ 第四级能建；⑤ 导入不幂等 ⇒ 第二次重复建；
    ⑥ 移除测试里的 `PG_POOL_MAX=1` ⇒ **恰好原 7 条路由用例复现 500 / 42P05**（证明该旋钮是承重的，
    不是为绿而绿）。前端 F1–F4（实得红并还原）：① 去掉 `orgApi` 接线 ⇒ console 接线用例 1 红；
    ② 去掉代次守卫 ⇒ 代次用例 1 红；③ `删除原因` 恒 `undefined` ⇒ 删除守卫用例 1 红；
    ④ 建完不自动进改名态 ⇒ 新增用例 1 红
  - 门禁实得：`packages/auth` 全量 **336 pass / 3 skip / 0 fail**（339 条 / 27 文件 / 296s；
    首个全量跑出 `comments.test` 1 红，补注释后本轮三个受影响文件 **33 pass / 0 fail**，再全量复跑即上数）；
    `packages/opencode` 路由（org ＋ accounts）**40 pass / 0 fail**；
    `packages/app` 治理 8 文件 **78 pass / 0 fail**、`test:components` 全量 **1409 pass / 0 fail**；
    根 `bun run typecheck` **32/32 successful**；`bun run lint:openhive` **0 error / 67 warning**
    （governance 目录 **0 条**）；`git diff --stat bun.lock` **无输出**
  - **axe 实得**（2026-10-26）：`node e2e/a11y/storybook-axe-audit.ts "App/OpenHive/Governance"`
    （8 story × 浅/深 = **16 格**）⇒ **15 ✅ / 1 ❌**。新增的 org-tree 四 story × 两主题 **8 格全 0 违例**，
    含确认框打开态（Kobalte Portal 子树）。唯一红仍是 T005 「有数据 [light]」的 3 个 accent 标签
    （3.11:1），按护栏维持 HALT，不重报为新缺口。复跑同日用 `--port 6018`
    （6017 被 009 工作台的 storybook 占着）＋ `STORYBOOK_URL=http://127.0.0.1:6018`
  - **缺口**：① 跨行的「子级 = 父级 + 1」只有服务层，DB 只挡了「根必须是 1 级」那一半（要触发器才行）；
    ② 账号与节点的关联是**同路径文本**，改名级联在同一事务里改三列，但 `analytics` 的 org 是抽取时点
    快照，历史不追溯；③ 没有「移动节点 / 调层级 / 同级排序」动作（T006 范围只到增删改）；
    ④ `importFromAccounts` 按文本建树：中间层级为空串的账号会被跳过，同名不同义会合并成同一节点；
    ⑤ 治理壳 `console.tsx` 仍无 story（同 T005 缺口）；⑥ **真栈未跑**（同 009 的 `openai@6.39.1` 缺口）

- **T005** 账号管理（FR-004 / US2；003 的 T022 录入 ＋ T024 停用的触发者）
  - 新增 `packages/auth/src/account-admin.ts`（**读面**）：`listAccounts`（q 命中警号/姓名/单位/部门/科室，
    `%` `_` `\` 当字面量；status 筛选；僵尸筛选；page/pageSize 夹取；全局统计与 `matched` 分开算）、
    `accountById`（多吐 `idCard` / `phone`）。列表项**键集合**断言不含 PII 与 `password_hash`；
    `zombieOnly` 的 id 集合与 `findZombieAccounts` **逐值对账**（`#002-06`：同一条规则三处实现）
  - 新增 `packages/opencode/src/server/openhive/governance-accounts.ts`：7 条路由
    （list / detail / create / password / disable / enable / batch-disable）。每请求查
    `authorizeGovernance`（read / write），**排在解析、校验、建目录、落库之前**（`#004-09`）；
    录入走 `provisionUser`（不调 `registerUser`——否则留「能登录却没沙箱」的账号）；
    不能停用自己（单条 400、批量**整批** 400）；`LastAdminError` → 409「系统至少保留一个管理员」
  - 接线 `server.ts`：与项目出口共用 `AnchorWorkspace.Config`（沙箱根）与 `OpenhivePg`
  - 新增前端 `governance/account-api.ts`（同源路径、可注入 fetch、Outcome 三态 ok/rejected/failed、
    严格解析、10s 超时）、`governance/account-manage.tsx`（统计卡 / 搜索 / 僵尸开关 / 表格 + 分页 /
    空·加载·错误三态 / 录入抽屉 / 详情抽屉 / 重置与停用确认 / 批量停用；列表请求带**代次守卫**，
    await 之后不读旧上下文——`#008-03`）；`console.tsx` / `console-host.tsx` /
    `console-connected.tsx` 接线（未注入 api 时回落占位）
  - 测试新增 **69 条**：`auth/src/account-admin.test.ts` 13（PGlite 真库）、
    `opencode/test/server/openhive-governance-accounts.test.ts` 26、
    `app/src/governance/account-api.test.ts` 14、`app/src/governance/account-manage.test.tsx` 16；
    另有 4 条 story（有数据 / 空 / 错误 / 确认框打开态）
  - 变异 M1–M8（均实得红并还原）：① 删录入授权 ⇒ 3 红；② 授权挪到 `provisionUser` **之后**
    ⇒ 2 红（`Expected: 0 / Received: 1` 行数）。**这条第一次拆法没红**——把授权挪到「解析之后、
    副作用之前」仍然全绿（非法载荷本就被校验挡成 400），改成「副作用之后」才红，属于变异设计纠错；
    ③ 僵尸筛选去掉 `status = 1` ⇒ 1 红；④ 删「不能停用自己」⇒ 400 变 204 ＋ 3 条连锁红；
    ⑤ 批量只停第一个 id ⇒ 1 红；⑥ `provisionUser` 换 `registerUser` ⇒ 1 红（沙箱目录不存在）；
    ⑦ 前端自己那行不 `disabled` ⇒ 1 红；⑧ 去掉重置确认 ⇒ 1 红（确认框永不出现，等到超时）
  - 门禁实得：`packages/auth` 全量 **314 pass / 3 skip / 0 fail**（265s，`bun test`）；
    `packages/opencode` 路由 **26 pass / 0 fail**；`packages/app` 治理四个文件 **53 pass / 0 fail**、
    `test:components` 全量 **1393 pass / 0 fail**；根 `bun run typecheck` **32/32 successful**；
    `bun run lint:openhive` **0 error / 67 warning**（无一条落在本轮文件）；
    `git diff --stat bun.lock` **无输出**
  - **缺口**：① **axe 红 1 格**（见下，HALT）；② `LastAdminError` 经本路由**不可达**
    （自己不能停用先挡下），映射只做了单测；③ `disableAccounts` 守卫的 **TOCTOU 窗口从本条起可达**
    （两个管理员同时互停可归零），未加锁；④ 没有「编辑账号 / 提升管理员 / 分配模板」动作；
    ⑤ 治理壳 `console.tsx` 没有 story；⑥ **真栈未跑**（同 009 的 `openai@6.39.1` 缺口）；
    ⑦ 批量停用的 `disabled` 报的是「本次处理条数」，不是「状态真的翻转的条数」
  - **axe 实得**（2026-10-26）：`node e2e/a11y/storybook-axe-audit.ts "App/OpenHive/Governance"`
    （4 story × 浅/深 = 8 格）⇒ **7 ✅ / 1 ❌，EXIT=1**。红在 light「有数据」：
    3 个 `<span data-component="tag" data-variant="accent">启用</span>`，
    前景 `--v2-text-text-contrast`=#FCFCFC / 底 `--v2-background-bg-accent`=#D97706 ⇒ **3.11:1**
    （11px / 530 需 4.5:1）。根因是 **token 组合**（品牌金配近白字），不是布局；
    #1C1A18 深字压同底为 **5.45:1**。按护栏 **HALT：未改视觉、未加白名单、不弱化断言**。
    候选裁定（等用户定）：A. 状态标签改用 DESIGN §1.3 的语义状态色
    （启用 = `--v2-state-bg-success` / `--v2-state-fg-success`，停用 = 中性）；
    B. 保留金色强调，accent 标签在 light 改用深字（需新增局部前景 token）；
    C. 记入已知缺陷（与 009 F1 的 5 格同列），不改。
    复跑提示：6017 当时被 009 工作台的 storybook 占着，本次用
    `--port 6018` ＋ `STORYBOOK_URL=http://127.0.0.1:6018`

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
2026-10-26（T007 交付）
