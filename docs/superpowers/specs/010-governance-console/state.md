# 实施进度 · 治理后台

## 当前任务
T014 已交付（两类管理员分权验收矩阵：可见面 ＋ 8×2 读矩阵 ＋ 5 板级写矩阵 ＋ 无副作用 ＋ 拒绝留痕）。
**下一项 T015**（越权 BFLA：普通民警凭证调管理员能力被拒，FR-013 / SC-005），等用户 `next`。
待裁定（都不属于某个进行中 task）：① T005 的 axe 1 格红（accent 标签 3.11:1）；
② **浅色主题低对比 token**——`--v2-state-fg-warning` #cb9f34 = 2.39:1、`--v2-state-fg-success`
#198b43 = 4.25:1、`--v2-text-text-faint` 13px（008 两格已红）；本轮按 A 案在本页绕开，token 本身未动。

## 已完成

- **T014** 两类管理员分权验收矩阵（SC-002 / T003）——**两笔提交**，**只加测试、生产代码零改动**
  - 新 `packages/opencode/test/server/openhive-governance-split.test.ts`（7 条 `it.live`）
    ＋ `openhive-governance-visibility.test.ts`（2 条，交付后补正拆出）
  - ① 可见面（`/me`）：两身份**恰好** 6 / 3 项 ＋ **交集只有 `asset-governance`** ＋ **并集八页全集**
    （关系断言）＋ 无凭证 401 自查
  - ② 读矩阵 8 板块 × 2 身份 = 16 请求，期望网格写字面量（`#003-05`）；放行格断言 **200**
  - ③ 写矩阵：专家撞账号 / 组织 / 数据源，管理员撞模板库 / 数据项目权限，**合法载荷**仍 403（`#004-09`）；
    `assets` 的写是资产级授权，排除；`usage-cost` / `audit-log` 无写出口
  - ④ 四个建行类越权写之后目标行数 = 0（正面对照行 = 1）；五个板块各留 `governance.denied`，
    写动作 `detail.perm` 记 `write`（项目权限记 `admin`）
  - 正向对照防「一律 403」假绿：管理员建账号 / 部门 / 数据源 = 201，专家建模板 = 201，
    专家归档不存在项目 = 404
  - 变异 M1–M5 在**最终版本**上逐条重跑，均实得红并还原（M5 ⇒ 3 红：写矩阵 403→201、
    无副作用 0→1、审计留痕缺）
  - **⚠️ 补正（T015 开工时发现）**：交付时读矩阵放行格写的是「非 403」，**放过了一个 500**
    （`#005-47` 假绿）。根因：`/me` 网关池与治理池在同一 PGlite 实例准备同一句 SQL ⇒ `42P05`，
    本进程第一个治理读请求 500。修法：断言改 **200** ＋ 可见面拆独立文件（只走网关池）。
    变异 M6 复现 500（期望 200 / 实得 500），M7 换回「非 403」⇒ 全绿（假绿复现）。
  - 门禁（补正后重跑）：split **7 pass / 0 fail（40 expect）**、visibility **2 pass / 0 fail（9 expect）**；
    交付时 12 个治理/网关文件 **174 pass / 0 fail**；opencode `tsgo --noEmit` exit=0；
    根 typecheck **32/32**；oxlint 两文件 0 warning / 0 error；`bun.lock` 无 diff
  - **缺口**：每板块只取一条代表写出口；`assets` 资产级授权归 T007；不含 FR-013（T015，本轮接着做）；
    真栈未跑；12 文件并行跑时观察到既有 `[openhive-audit] 审计写入失败` warn
    （0 fail，本文件单独跑无）；拆分让「可见面 ＋ 治理出口同进程」这一场景**没有任何测试覆盖**
    ——那是夹具的 `42P05` 硬约束，真机上不存在（真 PG 每连接独立 prepared statement）
- **T013** 治理后台只承载「配置 ＋ 审核 ＋ 查看」（FR-012 / SC-004）——一笔提交
  - `sections.ts`：`GOVERNANCE_KINDS = ["config","review","view"]` 闭集（**无「分析」**）＋ 每项必填 `kind`；
    归类 配置 5 / 审核 1 / 查看 2；`console.tsx` 根加 `data-governance-kind`（**纯钩子、无视觉改动**）
  - 新 `governance-boundary.test.ts`（源码 import 图守卫）：治理不得 import 分析面、
    `src/workspace` 不得 import governance、全应用唯一接线点 `pages/layout-new.tsx`；带正向自检防空转
  - 新 `console-boundary.test.tsx`：八页全接线逐页钉「页面真的在 ＋ 类别一致 ＋ 分析标记命中 0」，
    另钉两棵互不包含的子树 / 打开时工作区 `inert` ＋ `aria-hidden` / 关闭后解禁
  - 测试新增 **11 条**；变异 M1–M6 均实得红并还原
  - 门禁：typecheck 32/32（app 直跑 `tsgo -b` exit=0）；components 1494 pass / 0 fail；
    unit 1292 pass / 27 fail（既有基线同数）；oxlint 5 文件 0 warning / 0 error；`bun.lock` 0 行
  - **axe 未跑**（无视觉改动、未加 story，如实记）
  - **缺口**：静态图挡不住手写聊天框 / 运行时搬 DOM；分析组件复制进 governance 判不出；`kind` 界面无视觉区分；真栈未跑
- **T012** 数据源配置（FR-011 / US6）——一笔提交
  - 迁移 `0017_data_source.sql` ＋ down：`auth.data_source`（int4 秒；kind/frequency/status 三个闭集 CHECK、
    名字 1..100 / 地址 ≤500 / 负责人 ≤50；**没有任何秘密列**，`information_schema` 断言钉住）＋
    `data_source_name_idx` **全局唯一**（无删除 ⇒ 停用行仍占名）；`auth.data_source_lineage`
    （双列 PK ＋ 自指 CHECK ＋ 双 FK CASCADE）
  - 表规则全在 `packages/auth/src/data-source.ts`（修剪、撞名、缺上游点名、成环用「从 id 沿下游可达上游」
    的递归 CTE、**校验完才删旧边**、事务里「插入 ＋ 设上游」）；`connector.ts` **只有接口**
  - 出口 `governance-data-source.ts` 四条（列表 / 注册 201 / 血缘 GET / 编辑 POST）；
    授权先于读体（`#004-09`）；读出口不落审计；血缘写入走编辑的 `upstreamIds`（未给 = 不动）
  - 审计 `data-source.create/update`（闭集 **19** 条）＋ `ACTION_LABELS` 两行；detail **不记连接地址**
  - 前端 `data-source-api.ts` ＋ `data-source.tsx`（表格六列 / 抽屉 / 血缘浮层 / 最近同步恒「—」）
    ＋ 4 story ＋ 三层接线；抽屉里**没有口令框、没有「测试连接」**；编辑**没动勾选就不发 `upstreamIds`**
  - 测试新增 **57 条**（auth 20 / 路由 13 / 前端 8＋14＋2）；变异 M1–M6 均实得红并还原
    （M1 首版挪得不够深、未红，据实记）
  - 门禁：typecheck 32/32；oxlint 16 文件 **21 warning / 0 error**（全属两个既有基线族）；`bun.lock` 0 行
  - **axe 8 格全绿 / 0 违例**；另跑浮层本身（Portal 在 `#storybook-root` 之外）`axe.run(body)` ⇒ 浅/深各 0
  - **缺口**：connector 无实现 / 无消费者；最近同步恒「—」；无删除；数据源无消费者；真栈未跑
- **T011** 模板库（FR-010 / US6）——一笔提交
  - 迁移 `0016_template.sql` ＋ down：`auth.template`（int4 秒；五个 CHECK 与 TS 常量逐字相同；
    **局部唯一索引 `(kind, name) WHERE status='active'`** ⇒ 停用后同名可重建）
  - 表规则全在 `packages/auth/src/template.ts`（trim 名字/范围、正文不 trim；`23505` ⇒ 撞名；
    编辑只动 active 行；停用幂等且第二次不刷 `updated_at`）；路由 `governance-templates.ts` 四条
  - 审计 `template.create/update/disable`（闭集 17 条）＋ `ACTION_LABELS` 三行
  - 前端 `template-api.ts` ＋ `template-lib.tsx` ＋ 共用 `overlay.tsx` ＋ 4 story ＋ 三层接线
  - 测试新增 **51 条**（auth 15 / 路由 14 / 前端 7＋13＋2）；变异 M1–M7 均实得红并还原
  - **M5 假绿已修**：停用幂等的路由用例原本只比 `updatedAt`，两次同秒 ⇒ 变异后仍绿；改为「第二个专家点、
    比 `updatedBy`」后重放 ⇒ 两层各 1 红
  - 门禁：typecheck 32/32；oxlint 17 文件 **13 warning / 0 error**（全属既有基线族）；`bun.lock` 0 行
  - **axe 8 格全绿 / 0 违例 / 几何失格 0**
  - **缺口**：停用不可逆（无启用入口）；正文自由文本无 schema；无消费者读模板；真栈未跑
- **T010** 审计日志检索（FR-009 / US5）——两笔提交（T010a 底座＋埋点 / T010b 检索＋前端）
  - **底座** `packages/auth/src/audit.ts`：`AUDIT_RESULTS` / `AUDIT_ACTIONS` 闭集、
    `recordAuditEvent`、`listAuditEvents`（**共用筛选** ＋ `total` 分页 ＋ ILIKE 转义）；
    `migrations/0015_audit_event.sql` 建 `auth.audit_event`（`occurred_at` 是 **int4 秒**）。
    内核 `server/openhive/audit.ts` 三个记录口：`写一行`（抛）/ `尽力记`（**永不抛**，失败只
    `console.warn`）/ `记治理`（按板块给出 `{记, 记失败}`）
  - **埋点**：`governance-authz.ts` 的 403 记 `governance.denied`；账号 / 组织 / 资产 / 项目 / 用量
    五个出口的写动作逐个记；工具越权记 `tool.denied`（接在 `permission/index.ts` 的 deny 分支，
    记录器自身永不抛——记录失败不能把该拒的调用变成放行）
  - **检索出口** `server/openhive/governance-audit.ts`：
    `GET /openhive/governance/audit-log?from=&to=&actor=&action=&result=&q=&page=&pageSize=`。
    **授权排在参数解析之前**（`#004-09`：民警递 `from=abc` 拿 403 而不是 400）；
    **时间单位是秒**（与 `usage-cost` 的毫秒口径**故意不同**，两边文件头都写明）；**缺省近 7 天**、
    窗口 **`[from, to)`**；`action` / `result` 只认闭集，未知值 400（不是静默回落默认值）
  - **审计不审计自己**：读这条出口不落审计行——记进同一张表会让翻页本身涨 `total`，管理员永远翻不到底
  - 前端 `governance/audit-log-api.ts`（严格解析、snake→camel、401/403/400/5xx/网络五路 outcome）
    ＋ `governance/audit-log.tsx`（筛选条 / 只读表格 / 行内展开 JSON / 复制 / 分页 / 空·加载·错误三态，
    窗口在 await **之前**算好 ＋ 代次守卫 `#008-03`，**无编辑删除入口**）＋ 4 条 story
    （有数据 / 空 / 错误 / 详情展开）＋ `console.tsx` / `console-host.tsx` / `console-connected.tsx` 接线
  - 测试新增 **78 条**：`auth` `audit.test.ts` 9；opencode `openhive-governance-audit.test.ts` 8、
    `permission/openhive-audit-denied.test.ts` 9、`openhive-governance-audit-log.test.ts` 21（真 PGlite、
    8 天前/1 小时前/1 分钟前三行夹具、权限矩阵、400 族、缺省 7 天窗口、半开区间、四类筛选、
    `%` 按字面量、分页与「读不落行」）、app `audit-log-api.test.ts` 15、`audit-log.test.tsx` 16
  - T010b 变异（均实得红并还原）：S1 授权挪到解析之后 ⇒ **1 红**；S2 缺省窗口改 30 天 ⇒ **3 红**；
    S3 丢掉结果筛选 ⇒ **1 红**；C1 前端默认天数改 30 ⇒ **2 红**；C2 详情永不渲染 ⇒ **2 红**；
    C3 下一页传同一页 ⇒ **1 红**；C4 加载时清空数据 ⇒ **1 红**；C5 语义色挪回文字层 ⇒ **1 红**。
    T010a 的变异记录见提交 `43fbb08984`
  - 门禁实得：根 `bun run typecheck` **32/32 successful**；opencode 治理 **121 pass / 0 fail**（9 文件）；
    app 治理 **174 pass / 0 fail**（16 文件）；oxlint 本批 **11 文件 0 warning / 0 error**；
    `git diff --stat bun.lock` 无输出。（根 `bun run lint` 有既有基线 **5219 warning / 1 error**，
    不在本批文件内）
  - **axe 实得（两轮，据实记）**：4 条 story × 浅/深 = 8 格，首轮 **2 格红**
    （`有数据 [light]` / `详情展开 [light]`，`serious · color-contrast`）。真 Chromium ＋ axe 读数：
    `#198b43 / #fcfcfc` = **4.25:1**、`#cb9f34 / #fcfcfc` = **2.39:1**（要求 4.5:1）——
    低的是 **token 本身**（浅色取 `green-800` / `yellow-800`），不是布局、不是类名拼错。
    按用户裁定走 **A 案**：语义色**只上在图标**上、文字一律 `text-v2-text-text-base`（16.91:1），
    依据 DESIGN §4.11.7「颜色只作辅助」＋ `Icon` 自带 `aria-hidden`（冗余图形不设 3:1 门槛）。
    并补一条结构性用例钉住它（颜色在图标层、文字层不含 `text-v2-state-fg-`）。
    复跑 ⇒ **8 ✅ / 0 ❌、0 违例、几何 0 格**；**未动断言、未加白名单、未改 token**
  - **同类落点（`#002-06`，查过、本轮都不动）**：`dual-file-tree.tsx:87/471/615` 也把
    `text-v2-state-fg-warning` 当文字色（浅色同病，story 没画到那段）；`file-transfer-dialog.tsx:153`
    只给 `aria-hidden` 图标上色（不受影响）；其余 `text-v2-state-fg-success` 都在
    `bg-v2-state-bg-success` 底色块上（不受影响）。另：**008 的 `dual-file-tree--backups-not-wired /
    backups-empty` 浅色两格已红**（`text-v2-text-text-faint` 13px），是既有红
  - **缺口**：① 备份事件（008 `backup.*`）**没有**并入审计视图；② 治理**读**动作不记（含审计出口自身，
    理由见上）；③ `Permission.ask` 钩子只覆盖链 A，**那一行接线本身没有测试盯着**；④ **无留存 / 归档
    策略**（表只增）；⑤ 工具拒绝记录是**同步等待** PG，PG 不可达时最坏等 3s 连接超时；
    ⑥ **真栈未跑**；⑦ 组件层**实现前未观察到红**（首轮跑错 flag，得到的是 `jsxDEV` 报错），
    红证据由变异 C1–C5 提供；⑧ 后端实现后**首轮**曾出现 4 条失败（涉 `tool.denied` 行与 total），
    随后**连续 4 次复跑稳定 21 pass**，根因未定位


- **T009** 用量 / 成本看板（FR-008 / US5）
  - 后端新增 `packages/opencode/src/server/openhive/governance-usage.ts`，一条只读出口：
    `GET /openhive/governance/usage-cost?from=&to=&groupBy=org|model|user`。板块 `usage-cost`，
    只授**系统管理员** `read`（业务专家在 `auth/src/governance.ts` 没有这一格）；授权排在
    参数解析之前（`#004-09`，未授权者递 `from=abc` 拿 403 而不是 400）
  - `packages/opencode/src/governance/analytics.ts` 的 `GroupBy` 增 `"user"`（键 `user_id`）——纯增量，
    分组 SQL 不抄第二份；姓名由出口用 `usersByIds` 翻（分析库仍不依赖 auth）
  - **抽取先于报表**：`analytics.ts` 的 `report` docstring 把次序交给调用方，所以出口固定
    `extractAll → report`；反过来会让首次打开永远空、第二次突然有数。v1 无调度器，每次读都同步
    抽一遍（幂等靠主键 ＋ 游标）
  - **两个「根」没有混用**（实测确认）：`AnchorWorkspace.Config.root` 是**沙箱根**
    （`OPENHIVE_WORKSPACE_ROOT`），分析库与每用户 SQLite 的根是 `dataRoot(process.env)`
    （`OPENHIVE_DATA_ROOT`）。出口因此**不取** `AnchorWorkspace`；混用会让所有用户「缺库」⇒
    `collected:false` 且**不报错**（该模块文件头写明了这个坑）
  - 判定：窗口左闭右开 `[from,to)`；缺省近 30 天、按单位；`collected:false` ⇒ 卡片与水位显示「—」
    并说明原因（不是 0）；`user` 标签「姓名（警号）」，账号被清理回落 `已注销用户（前 8 位）`
    （历史成本不抹、行不隐藏）；停用账号仍参与抽取（成本已经付过，没有新事件只是因为没新会话）
  - 前端新增 `governance/usage-cost-api.ts`（严格解析 ＋ 401/403/400/5xx/网络五路 outcome）与
    `governance/usage-cost.tsx`（7/30/90 天 × 单位/模型/人员，切换即重拉，窗口在 await **之前**
    算好 ＋ 代次守卫 `#008-03`）；4 条 story（有数据 / 窗口内无记录 / 尚未抽取 / 错误）；
    `console.tsx` / `console-host.tsx` / `console-connected.tsx` 接线（未注入 ⇒ 回落占位）
  - 测试新增 **30 条**：`opencode/test/server/openhive-governance-usage.test.ts` 12（真 PGlite ＋ 假源库；
    身份矩阵、抽取先于报表、幂等、窗口边界、三种分组、已注销回落、空数据根、缺省窗口、400 族）、
    `app/src/governance/usage-cost-api.test.ts` 8、`usage-cost.test.tsx` 8、
    `console.test.tsx` +2（接线 / 回落占位）
  - 后端变异 B1–B5（均实得红并还原）：① 拆授权闸门 ⇒ **2 红**；② 只报表不抽取 ⇒ **5 红**；
    ③ 窗口右端取闭（`to+1`）⇒ **6 红**；④ 不做姓名翻译 ⇒ **1 红**；⑤ `KEY_OF.user` 读 org ⇒ **1 红**
  - 前端变异 F1–F4（均实得红并还原）：① `collected:false` 照画 0 ⇒ **1 红**；② 拆代次守卫 ⇒ **1 红**；
    ③ 切分组不重拉 ⇒ **2 红**；④ 去掉金额格式化 ⇒ **1 红**
  - 门禁实得：opencode `analytics+usage` **27 pass / 0 fail**；app 治理 **143 pass / 0 fail**（14 文件）；
    `test:components` 全量 **1443 pass / 0 fail**；根 `bun run typecheck` **32/32 successful**；
    oxlint（本轮新前端文件＋改动文件）**0 warning / 0 error**；`git diff --stat bun.lock` **无输出**
  - **axe 实得（两轮，据实记）**：首轮 4 条 story × 浅/深 = 8 格中 **4 格红**（全是 dark，
    `serious · color-contrast`），落在我新加的工具条选中钮——我照 `console.tsx` 导航项用了
    `accent-soft`，**违反 T006 已定的规矩**（`org-tree.tsx` 文件头：浅金底实测 1.07–1.99:1），
    等于自己造了一个已知缺陷的新落点。改成 T006 的方案（中性 `layer-02` 底 ＋ 金色**描边**）后
    复跑 ⇒ **8 ✅ / 0 ❌、0 违例、几何 0 格**；**未动断言、未加白名单、未改 token**。
    已知红仍是 T005「有数据 [light]」3 个 accent 标签（3.11:1），按护栏维持 HALT
  - **缺口**：① **无调度器** ⇒ 每次读同步抽取，占事件循环；并发 GET 各自抽一遍（幂等但重复做功）；
    ② 单个用户源库读穿（文件损坏 / 非 SQLite）会让整个请求 500——`extractAll` 只对「缺库」容错，
    没有逐用户隔离；③ `org` 是**抽取时快照**，组织调整不追溯历史（T004 既有口径）；
    ④ 治理壳 `console.tsx` 仍无 story（同 T005–T008）；⑤ **真栈未跑**（同 009 的 `openai@6.39.1`
    缺口）；⑥ `packages/app` 的 `test:unit` 仍是那 **27 fail**（既有 `jsxDEV` 预载问题 ＋
    project-data 两条，与 T009 无关）


- **T008** 数据项目权限（FR-007 / US4）
  - 后端新增 `packages/opencode/src/server/openhive/governance-projects.ts`，四条出口：
    `GET /openhive/governance/projects`（**全量**，含已归档）、`GET …/:id/members`、
    `POST …/:id/members/remove`、`POST …/:id/archive`。板块 `data-project-perm`，
    读口要 `read`、写口要 `admin`；授权**排在读体与配置检查之前**（`#004-09`，实测由
    `-unconfigured` 文件里「只读角色归档 ⇒ 403 而不是 503」钉住）
  - **FR-004 × FR-007 的冲突裁定**（用户 2026-10-26 认可「按专业建议」，落在这里备查）：
    管理员可撤**普通成员**、可**归档**整个项目；**不能撤 owner**——owner 撤掉就留下无主项目，
    破 005 的「项目永远有一个 owner」不变量，而修复它需要「转移所有权」这个 feature 没有的动作。
    owner 调离 ⇒ 归档（全员转存备份 → 沙箱清空 → 冻结，权限一并收回）。`ProjectMembership.decide`
    **一个字未改**：治理管理员不是成员，走的是 `authorizeGovernance(admin)`；「已归档名单冻结」
    读的仍是 `auth.project_archive` 那一处事实（不是把 `decide` 的规则抄第二份）
  - `packages/auth/src/project-member.ts` 新增**并集读面** `projectOverviews`：`project_meta`
    ∪ `project_member` ∪ `project_archive` 的 id 并集——只看 `project_meta` 会让 0006 之前建的
    项目从治理清单里**消失**（那是本 feature 最该看见的一批）。`memberCount` 在这里填 `0`
    （而 `memberCountsOf` 缺席保留键不存在），差别写在函数注释里
  - `archive.ts` 把 ⑤–⑧（成员 id 校验 → 全员上传 → 全员删沙箱 → 标记最后落）抽成
    `archiveProject`，**005 与治理共用一份次序**（`#002-06` / `#004-01`：先数底层调用点，
    `backupAll` / `releaseAll` / `markArchived` 今天各有两个调用者，仍只有一处写次序）
  - 前端新增 `governance/project-api.ts`（同范式四出口 ＋ 严格解析）与
    `governance/data-project-perm.tsx`（项目表 + 点「成员」展开名单；**撤销按钮只出现在 member
    行**、已归档项目**一个动作都不画**；两个动作都过确认框且写明后果、失败不关框；列表与名单
    **各一个代次守卫**，`#008-03`）；4 条 story（有数据 / 空 / 错误 / 归档确认框打开态）；
    `console.tsx` / `console-host.tsx` / `console-connected.tsx` 接线（未注入 ⇒ 回落占位）
  - 测试新增 **39 条**：`opencode/test/server/openhive-governance-projects.test.ts` 11
    （真 PGlite ＋ 假 S3 ＋ 真 app；身份矩阵、撤销、归档、上传失败次序、重复归档）、
    `…-unconfigured.test.ts` 2（独立 app，无 `OPENHIVE_MINIO_*`）、
    `app/src/governance/project-api.test.ts` 13、`data-project-perm.test.tsx` 11、
    `console.test.tsx` +2（接线 / 回落占位）
  - 后端变异 B1–B4（均实得红并还原）：① 去掉「已归档 ⇒ 409」⇒ **1 红**；② 去掉 owner 守卫
    ⇒ **1 红**（`Expected 409 / Received 200` ＋ 库行数变化）；③ 把 MinIO 配置检查提到授权之前
    ⇒ **1 红**（`Expected 403 / Received 503`）；④ 把 `markArchived` 挪到管线最前 ⇒ **3 红**
    （本 feature 1 条 ＋ 005 归档 2 条——共用函数没有把旧出口的不变量丢在注释里）
  - 前端变异 F1–F4（均实得红并还原）：① 撤销按钮不再区分角色 ⇒ **2 红**（创建人行 / 冻结行）；
    ② 已归档行照画归档按钮 ⇒ **1 红**；③ 去掉名单代次守卫 ⇒ **1 红**（切项目后旧回包占住面板）；
    ④ 失败时关掉确认框 ⇒ **2 红**（409 / 503 两条「框不关」）
  - 门禁实得：治理后端 **13 pass / 0 fail**；005 归档/找回/项目 **46 pass / 0 fail**；
    005 成员/删除/改名/共享 **42 pass / 0 fail**；`test:components` 全量 **1433 pass / 0 fail**；
    根 `bun run typecheck` **32/32 successful**；oxlint（本轮 5 个新前端文件）**0 warning / 0 error**；
    `git diff --stat bun.lock` **无输出**
  - **typecheck 抓到的真缺陷（记一笔）**：`archiveProject` / `加入时刻` 的 `pg` 参数先前写成
    `OpenhivePg.Interface["pg"]`（那个**闭包**的类型），而运行时传的是 `deps.pg()` 的**返回值**
    ——单测全绿、类型全红。改成 `ReturnType<OpenhivePg.Interface["pg"]>` 后 32/32
  - **axe 实得**（2026-10-26）：`node e2e/a11y/storybook-axe-audit.ts "App/OpenHive/Governance/DataProjectPerm"`
    （4 story × 浅/深 = **8 格**）⇒ **8 ✅ / 0 ❌**。另用真 Chromium 复核两条**容易哑绿的**：
    归档确认框 story 里 `project-confirm` 真的挂了（文案含「归档后全员失权」）；有数据 story
    真的画了 2 个项目行 / 3 个成员行 / 2 颗撤销钮（创建人没有）
  - **缺口**：① 成员 id 不是合法路径段时的 **500 分支**没有用例守（要往库里塞坏 id）；
    ② 「撤销后他沙箱里已下载的文件不删」只有文案、没有断言（那是 005 的既有行为，不是本出口的
    副作用）；③ 前端确认框沿用治理模块手写 Kobalte Dialog（005 项目面板用的是 `useDialog()` ＋
    `DialogV2`）——两套壳并存，属治理模块四页一致的既有选择，统一是另一笔裁定；
    ④ 治理壳 `console.tsx` 仍无 story（同 T005–T007）；⑤ **真栈未跑**（同 009 的 `openai@6.39.1`
    缺口）；⑥ `packages/app` 的 `test:unit` 仍是那 **27 fail**（既有 `jsxDEV` 预载问题 ＋
    project-data 两条）：本轮**排除 `governance/**` 后仍 27 fail**，证据在此，与 T008 无关

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
2026-10-26（T008 交付）
