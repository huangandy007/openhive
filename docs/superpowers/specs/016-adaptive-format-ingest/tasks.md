# Tasks: 数据格式自适应与自动入库

**Input**: `docs/superpowers/specs/016-adaptive-format-ingest/`（plan.md / spec.md / research.md / data-model.md / contracts/ / quickstart.md）

**Prerequisites**: plan.md ✅、spec.md ✅（8 个 User Story，其中 US1–US5 为 P1）、data-model.md ✅、contracts/ ✅、research.md ✅

**Tests**: 每个任务内部包含测试（本项目强制 TDD）——**先红 → 改到绿 → 变异验证**（`#003-03`）。不单独立「写测试」任务，避免任务数翻倍；但每个任务的「判据」列都是可跑的断言，不是描述。

**Organization**: 按 User Story 分组；顺序以依赖为准（P1 的 US5 依赖 P2 的 US7/报告表，故排在后面，见「依赖」节）。

## Global Constraints（每个任务都适用）

1. 只在受影响 package 内跑 `bun test`，且**必须带 `timeout`**（`timeout 300 bun test …`）；退出码 124 = 被杀，先查是不是同步死循环，**不自动重跑**。根目录 `bun test` 禁止（`#004-10`）。
2. 每个任务收尾：受影响 package 的 `bun run typecheck` ＋ 该任务的用例 ＋ `bun run lint`（仓库根）全绿，报告只写实际输出。
3. 不新增依赖；不用 `as any`；不碰 `packages/opencode/src/skill/index.ts`、`sql.ts`；`bun install` 后必查 `git diff --stat bun.lock`。
4. 迁移每组 `.sql` + `.down.sql` 成对（照 `0035`–`0044`）。
5. 复用优先（`#002-06`）：表头归一、值闸、识别卡校验、启用校验各只允许一份出处；发现要实现「第二份」时先回 `plan.md` 的 R1–R16 对账。
6. **未决前提**：`plan.md` R14 的裁定（FR-042 优先；US1 场景 2 拆成「有问题 ⇒ 作业 +1 / 已解析 ⇒ 不新增」）**尚待用户确认**。任务 T004 的用例按该裁定写；若用户选另一种读法，先改 spec 再改 T004 与 T011。
7. 真栈不热重载：验源码改动必须重启内核；不杀在跑的进程；不删 `D:/openhive-stack-state`、`%TEMP%\openhive-real-stack-state`。

## Phase 1: Setup（共享基础设施）

**Purpose**: 存储与校验闸（跨 story 的阻塞项）

- [ ] T001 [P] 建迁移 `0045`–`0049`（每组 `.sql` + `.down.sql`，共 10 个文件）于 `packages/auth/src/migrations/`：`0045` = `case_ingest_job` 加 `reason_code/progress/adapter_id/adapter_version` + `case_material` 加 `probe` + 两条索引（作业 `(project_id, material_id, queued_at desc, id desc)`；材料部分索引 `(created_at) where parse_status='排队中' and probe is null`）；`0046` = 档案 4 列；`0047` = 开关表；`0048` = 白名单表；`0049` = 报告表。**入参**：迁移文件 → **出参**：列/表/索引存在且 `down` 可完全撤回。**判据**：`packages/opencode/test/server/openhive-case-ingest-schema.test.ts`（新）用 `startProductionDb()` + `migrate(pg.db)` 断言五组结构、`reason_code` 的 CHECK 拒非法值、down 后列消失。**变异**：删掉部分索引 ⇒ 索引断言红。

- [ ] T002 [P] 实现识别卡校验一份并接到发布 / 启用两处：`packages/asset-service/src/ingest-gate.ts`（新，校验 `adapter.json` schema、四件套、`entry` 存在、`attributeKeys` ⊂ 词表、A 类档案 `mapping` 键为表头原文且 `requiredHeaders` 非空）；拒绝码登记在 `packages/asset-service/src/lifecycle.ts:173-201`，发布流在 `packages/asset-service/src/service.ts:830,848` 旁调用，HTTP 映射在 `governance-assets.ts:838`，启用侧接 `packages/opencode/src/server/openhive/project-assets.ts` 抽出的启用内核（成员→属主→`type='skill'`→`published`→非个人→可读→落点存在）。**入参**：`(assetRow, 技能目录)` → **出参**：`{ok:true} | {ok:false, problems: string[]}`。**判据**：`test/server/openhive-case-adapter-publish.test.ts`（新）断言坏包（缺 `convert.*`、`adapter.json` 非法、词表外键）发布被拒且问题项逐条列出；`publish_iteration` 同样被拦。**变异**：删四件套检查 ⇒ 红。

**Checkpoint**: 表结构齐、坏包进不来。

---

## Phase 2: Foundational（读侧视图）

- [ ] T003 `材料视图` 加 5 个字段 + `未识别=1` 筛选：`packages/opencode/src/server/openhive/case-materials.ts`（SQL 读最近作业的 `adapter_id/adapter_version/reason_code/progress` 与 `case_material.probe`），`case-parse.ts` 解析 `未识别=1` 并透传（+2 行，不改 `PREFIX`/`PATH`）。**入参**：`(db, projectId, {未识别?: boolean})` → **出参**：`材料视图行 & {adapterId, adapterVersion, reasonCode, progress, probe}`。**判据**：`test/server/openhive-case-materials.test.ts`（已有，扩）直插 `case_ingest_job`/`case_material` 行，断言五字段值；`未识别=1` 只返回 `reason_code like '未识别:%'`，其余材料不出现；不带参数时响应与改前一致。**变异**：删掉筛选条件 ⇒ 筛选用例红。

**Checkpoint**: 材料列表能显示「用了哪个适配器 / 为什么失败 / 进度」。

---

## Phase 3: US1 - 拖入一个文件夹，剩下的交给系统（P1）

**Goal**: 上传落 `材料/` 自动建材料并排队；其他目录零行为变化。

**Independent Test**: 经上传出口向 `材料/` 传 3 份表格 ⇒ 3 材料 + 3 作业；传其他目录 ⇒ 只有文件；PDF/`.xlsm`/尾随空格 ⇒ 不入队。

- [ ] T004 [US1] M1 上传接线：`packages/opencode/src/server/openhive/file.ts` 的 `handleUpload`（`:826`）落盘成功后判三条件（`inside(材料目录)` ∧ `可解析材料(path)` ∧ 项目开关开）⇒ 调 `入队材料`（`:751`），`by` 用 handler 内 `Effect.serviceOption(User.Service)` 取的 userId（**不改** `gate` 签名，`:593-604`）；入队失败不回删文件。是否真排作业交 `该走哪个动作`（`case-ingest.ts:108-129`）。**入参**：multipart 文件 + 目录 → **出参**：落盘相对路径 + 材料 id/是否入队。**判据**：`test/server/openhive-case-autoenqueue.test.ts`（新）四条：`材料/` ⇒ 材料+作业；其他目录 ⇒ 0 材料；白名单外扩展名 ⇒ 0；已解析材料换名同内容再传 ⇒ 材料仍 1 条、作业不新增（R14）。**变异**：把入口判据放宽到全项目 ⇒ 「其他目录零变化」红。

**Checkpoint**: US1 的入口闭环（探测显示依赖 US2 的 T006/T007）。

---

## Phase 4: US2 - 系统自己认格式，用户不选 skill（P1）

**Goal**: 注册表 → 探测三态 → 执行器 → 作业链按适配器执行；失败不回退四层。

**Independent Test**: 三份文件分别命中「已启用转换器 / 只有档案 / 都没有」，断言路径、报告适配器 id+版本、无匹配时的 `未识别:无匹配适配器`。

- [ ] T005 [P] [US2] N1 适配器注册表：`packages/opencode/src/server/openhive/case-adapter-registry.ts`（新），目录口径复用 `作业项目目录`（`case-ingest.ts:313`）+ `SKILL_LINK_DIR`/`skillLinkPath`（`asset-service/src/project-skill-link.ts`），技能集合复用 `usableSkillAssets`（`skill-availability.ts:80`）；缓存键 = 目录签名（realpath + `adapter.json` mtime + size）。**入参**：`(projectId, 资产列表)` → **出参**：`{id, name, version, kind, materialType, match, admission, entry}[]`。**判据**：`test/server/openhive-case-adapter-registry.test.ts`（新）：可用技能才出现（未发布/个人技能不出现）、改 mtime 后重扫拿到新版本、`adapter.json` 非法时跳过并告警。**变异**：删签名比较 ⇒ 「改 mtime 重扫」红。

- [ ] T006 [US2] N2 探测闸 + 独立通道：`packages/opencode/src/server/openhive/case-adapter-probe.ts`（新，表头闸复用抽出的 `表头下标()`——落点 `packages/opencode/src/server/openhive/case-source-profile.ts`，与 `匹配数据源档案` 共用一份；**只跑表头闸**——值闸的权威证据是转换器 `report.gates`，由作业链映射原因码（Ruling X）；多命中 `priority desc → id`），`packages/opencode/src/server/openhive/case-probe-worker.ts`（新，500ms 轮询、只认领 `parse_status='排队中' and probe is null`、只写 `probe` 不写 `parse_status`）。**入参**：表头 + 注册表 → **出参**：`{状态:"已识别"|"未识别", 适配器id?, 版本?, 原因码?}` 写入 `probe`。**判据**：`openhive-case-adapter-probe.test.ts`（新）：三态各一例；同 `priority` 重复跑结论恒定（不靠目录顺序）；探测后 `parse_status` 仍为「排队中」。**变异**：决胜改回目录顺序 ⇒ 确定性用例红；探测直接写 `parse_status` ⇒ 状态用例红。

- [ ] T007 [P] [US2] N3 转换器执行器：`packages/opencode/src/server/openhive/case-converter-runner.ts`（新），照 `governance-mcp-supervisor.ts:219` 的子进程形状：`cwd`=技能目录、原件只读（argv[2] 与 `OPENHIVE_INPUT_PATH` 两通道）、输出固定 `output.file`（已存在且无运行标记 ⇒ 拒绝覆盖；带运行标记的异常残留 ⇒ 清掉重跑）、默认超时 60s、环境白名单（**不透传 `PG_*`**）。**入参**：`{适配器, 原件, 超时ms?}` → **出参**：`{ok:true, rows, report} | {ok:false, detail, 报告?}`。**判据**：`openhive-case-converter-runner.test.ts`（新）：非零退出、超时、输出不合 `converter-output-contract.md`、环境里查不到 `PG_PASSWORD`，四类各一例。**变异**：去掉环境清理 ⇒ 「无 PG 凭据」红。

- [ ] T008 [US2] M2 作业链接入：`packages/opencode/src/server/openhive/case-ingest.ts` 的 `跑表格`——档案之后、缓存之前问注册表；`rowRules` 由内核执行（不起子进程），`converter` 调 T007；两者构造与 `识别材料` **同形状**的 `材料识别`，下游零改动；写 `adapter_id`/`adapter_version`；失败落「有问题」，**不回退四层**。**入参**：sheets + 注册表 + 档案结果 → **出参**：既有写入路径的事实行 + 作业快照列。**判据**：`openhive-case-ingest.test.ts`（已有，扩）：适配器命中跳过四层（用模型不可用的夹具也可绿）；适配器失败后 `parse_detail` 不出现四层结论；两列已写。**变异**：删「不回退」分支 ⇒ 失败用例红。

**Checkpoint**: US2 独立可验（探测 + 转换 + 入库）。

---

## Phase 5: US3 - 开户行、银行卡号问得到，还带出处（P1）

**Goal**: 非数字账号行不丢属性；裸属性列不被误认成对方/本方账号。

**Independent Test**: 含 `属性:对方:开户行` 与 `@wx.tenpay.com` 账号的真实流水 ⇒ 属性与户名别名都挂上；转换器输出裸列 `对方银行卡号` ⇒ 告警/拒收。

- [ ] T009 [P] [US3] C7 账号形状精准放宽：`packages/opencode/src/server/openhive/case-field-registry.ts` 的 `是账户形状` 增加「剥空白后以 `@wx.tenpay.com` 结尾（忽略大小写）」，不放宽任意邮箱。**入参**：单元格文本 → **出参**：布尔。**判据**：`openhive-case-account-shape.test.ts`（新）用真行原文：该账号行属性挂上 + 户名别名 `kind='户名'` 挂上；`abc@example.com` 仍不通过。**变异**：恢复纯数字 ⇒ 两条挂载断言红。

- [ ] T010 [P] [US3] M8 裸属性列裁决：`packages/opencode/src/server/openhive/case-mapping.ts` 的 `修饰语放行`（`:142-153`）与 `合成词长`（`:162-175`）——没有 `属性:` 前缀的标准字段词（`对方银行卡号`/`本方银行卡号`）必须在疑似副本上告警或拒收，不得落到 `counterparty`/`ownerAccount`。**入参**：表头 + 候选 `识别字段` → **出参**：映射结果 / `undefined` + 告警项。**判据**：`openhive-case-attribute-registry.test.ts`（已有，扩）喂裸列原文，断言不映射成对方/本方账号且报告带告警。**变异**：删两处判据 ⇒ 裸列被认领 ⇒ 红。

---

## Phase 6: US4 - 没解析成，也要说清为什么（P1）

**Goal**: 六个原因码字面值 + 进度落库；「未入队」不伪造原因码。

**Independent Test**: 六种成因各一份文件，逐条断言 `reason_code` 字面值；历史「未入队」材料无原因码。

- [ ] T011 [US4] 原因码与进度写入：`packages/opencode/src/server/openhive/case-ingest.ts` 在三个边界赋码（读表抛错 ⇒ `失败:读文件`；执行器失败 ⇒ `失败:转换器异常`；写入事务失败 ⇒ `失败:入库异常`；`未识别:*` 由探测/前置分支显式抛出，**不靠匹配错误文案**），`packages/opencode/src/server/openhive/case-ingest-worker.ts` 在阶段切换与每批写 `progress`。**入参**：各阶段结果/异常 → **出参**：`reason_code`（六值闭集）+ `progress`。**判据**：`openhive-case-ingest-reason.test.ts`（新）六值**逐字面**断言（禁 `toContain('未识别')`，`#005-47`）；未入队材料 `reason_code is null`；阶段切换后 `progress.阶段` 变化。**变异**：把「缺必需列」改成「无匹配适配器」⇒ 红。

---

## Phase 7: US6 - 缺的值批量补全，不逐行查库（P2）

- [ ] T012 [P] [US6] N4 富化层：`packages/opencode/src/server/openhive/case-enrich.ts`（新，受控键分类表：参考类/身份类/匹配类，**未登记键 fail-closed 进身份类**；产键去重 → 每类一次批量查 → Map 回填）+ `packages/opencode/src/server/openhive/case-reference-store.ts`（新，整表载入内存带版本；外部服务并发 4 / 超时 5s / 负缓存 TTL 10 分钟）。结果作为属性观察写既有 `attrs`（带 `材料#表#行` 出处），不落新表。**入参**：行集合 → **出参**：`attrs` 回填 + `{补全数, 未补全数, 参考库版本}`。**判据**：`openhive-case-enrich.test.ts`（新）：三类处置各一例；未登记键进「待确认」；案件库查询语句数 = 1（用语句计数探针）。**变异**：未登记键默认参考类 ⇒ 红。

---

## Phase 8: US7 - 每份材料的报告与版本可回滚（P2）

- [ ] T013 [P] [US7] 报告存取 + N8 准入：`packages/opencode/src/server/openhive/case-material-report.ts`（新，append-only，`UNIQUE(project_id, job_id)`；五要素入 `gates/warnings/skipped_rows/enrich/admission`）+ `packages/opencode/src/server/openhive/case-ingest-admission.ts`（新，读最新报告判「准入/旁路」，命名避开既有实体泛称闸 `case-admission.ts`），在 T008 的转换完成点调用。**入参**：作业结果 → **出参**：报告行 + `{结论:"准入"|"旁路", 依据[]}`。**判据**：`test/server/openhive-case-material-report.test.ts`（新）：五要素齐全；同材料重跑新增一行（历史版本不变）；停用适配器后新文件回到 `未识别:无匹配适配器` 且旧报告仍在。**变异**：把追加改成 upsert ⇒ 「历史版本不变」红。

---

## Phase 9: US8 - 可信技能免确认（P3）

- [ ] T014 [P] [US8] 白名单 + 项目开关 + 自动启用：`packages/opencode/src/server/openhive/case-trusted-skill.ts`（新，平台级，`is_admin` 维护，启用前复判 `status='published'`）、`packages/opencode/src/server/openhive/case-ingest-settings.ts`（新，`auto_enqueue` 默认 true / `auto_enable_trusted` 默认 false，行缺失取默认，写要求项目属主），自动启用直接调 `enableAsset`（`asset-service/src/enablement.ts:90`，含 20 上限），变更走 `记治理`（`audit.ts:97`）。**入参**：`{projectId, assetId, userId, 开关}` → **出参**：开关状态 + 启用结果。**判据**：`openhive-case-trusted-skill.test.ts`（新）：默认关闭；白名单内零确认；白名单外仍提示；超 20 被拒；非管理员 403；变更留痕一行。**变异**：删启用前的 `published` 复判 ⇒ 「下线后不自动启用」红。

---

## Phase 10: US5 - 启用技能后，旧文件一键重跑（P1）

> 排在 US6–US8 之后的原因：批量出口要一次接齐扫描/重跑/开关/报告/白名单五个出口，且扫描复用 T004 的入口判据（依赖，不是优先级）。

- [ ] T015 [US5] N5 扫描与批量重跑：`packages/opencode/src/server/openhive/case-rerun-scan.ts`（新）用 `扫树`（`packages/opencode/src/server/openhive/project-tree-scan.ts:69`，经 `project-tree.ts:161`）算三类候选（目录独有 / 未入队 / 未识别），**按内容 sha256 对已有材料去重**（`createMaterial` 同内容会改写 `path`，`case-store.ts:96-111`），`truncated` 如实上报；批量逐份调 `入队材料`。**入参**：`(db, projectId, 范围)` → **出参**：`{合计, 候选{目录独有,未入队,未识别}, 样本, 截断} | {已入队, 跳过[], 失败[]}`。**判据**：`openhive-case-rerun-scan.test.ts`（新）：三类候选各命中；已解析不进候选；同内容材料改过 `path` 后不报「目录独有」；汇总数 = 实际入队数。**变异**：删 sha256 去重 ⇒ 振荡用例红。

- [ ] T016 [US5] 新出口与权限：`packages/opencode/src/server/openhive/case-ingest-routes.ts`（新，`GET /openhive/case/ingest/scan`、`POST .../rerun`、`GET/POST .../settings`、`GET .../report`）+ `packages/opencode/src/server/openhive/governance-trusted-skill.ts`（新，前缀 `/openhive/governance/trusted-skills` 三个出口），权限闸 import 既有 `过门`（`packages/opencode/src/server/openhive/case-ui-routes.ts:157`，本任务先加 `export` 连 `Deps`/`PREFIX`，实现零改），`packages/opencode/src/server/server.ts` 按既有形状加 1 import + 1 路由块（+1 worker 层块若 T006 需要）。**入参**：HTTP 请求 → **出参**：`contracts/ingest-api-contract.md` 定义的字段。**判据**：`openhive-case-ingest-routes.test.ts`（新）：成员 403 改开关、非属主 403、非管理员 403 白名单；确认后**一个**请求完成批量；`report` 与 `材料列表` 字段符合契约。**变异**：把属主判断挪到前端 ⇒ 403 用例红。

---

## Phase 11: Polish

- [ ] T017 [P] 前端 7 个文件：`packages/app/src/project/case-materials-api.ts`（+5 字段）、`case-materials-view.ts`（探测徽标 / 原因码 / 进度 / 队列位置分列）、`source-profile-api.ts` + `source-profile-view.tsx`（调既有三出口）、`case-rerun-dialog.tsx`（扫描数量与一键重跑）、`case-ingest-settings.ts`（开关）、`case-skill-hint.tsx`（三时刻提醒，状态存 `localStorage`）、`packages/app/src/governance/trusted-skill-api.ts` + `trusted-skill-manage.tsx`。**入参**：契约字段 → **出参**：界面状态。**判据**：组件用例（`bun run test:components`）：「元素不存在」断言用布尔比较（`#013-12`）；置灰按钮同时断言「不可点击」＋「原因可见」（`#005-47`）；「稍后」后不再弹提示。**变异**：把置灰改成 `disabled` 属性但保留 handler ⇒ 「不可点击」红。

- [ ] T018 门禁与真栈：仓库根 `timeout 600 bun run typecheck`、`bun run lint`、`bun run lint:openhive`；受影响包逐文件 `timeout 300 bun test …`；真栈按 quickstart §3 走 AC-1 ~ AC-12（含 R14 的两张判据），性能项先确认应用角色 `jit = off`（`#013-11`）；验不了的（真实模型 A1/A2、100,000 行、20 份并发观感）写进缺口表（`#004-03`）。**入参**：全分支 → **出参**：门禁输出 + 真栈记录 + 缺口表。**判据**：命令与输出**原样**贴进交付报告；退出码 124 不重跑。

---

## Dependencies & Execution Order

### Critical path

```
T001(迁移) ─→ T002(校验闸) ─→ T003(视图)
   │
   ├→ T004(入口) ──┐
   ├→ T005(注册表) ├→ T006(探测) → T007(执行器) → T008(作业链) → T011(原因码) 
   │                │                                              │
   │                └→ T009(C7) ─ T010(M8)（与主链并行，靠同一链路的用例）│
   └→ T012(富化) ─→ T013(报告) ─→ T014(白名单) → T015(重跑扫描) → T016(出口) → T017(前端) → T018(门禁)
```

- **T004 必须先于 T015**：扫描复用「数据入口」判据（`可解析材料` + `材料/`）。
- **T008 必须先于 T011**：原因码要挂在作业链的阶段边界上。
- **T008 必须先于 T013**：报告由转换完成点写。
- **T015 必须先于 T016**：出口调扫描/批量。
- **T014 必须先于 T016**：设置/白名单出口调它们的存储层。
- **T002 必须先于 T005/T008**：坏包不许进注册表（M10 先于 N1）。
- `case-ingest.ts` 被 T004/T008/T011/T013 依次修改 → **这几个任务不得并行**；`case-materials.ts`/`case-parse.ts` 只被 T003 碰。

### Parallel Opportunities

- T001 与 T002 可并行（不同文件）。
- T005、T007、T009、T010、T012、T013、T014 互相独立（不同文件），可由不同人并行；其中 T009/T010 属同一 story，建议同批做（C7 先于 C2 的口径）。
- T017 前端可与后端并行（按契约字段先写），但验收须在 T016 之后。

### MVP 口径

Spec Clarifications 第 1 条：**对外没有部分 MVP**——第一个对外版本 = 四组全量、AC-1 ~ AC-12 全为门槛。内部的 T001–T004 是「可见但无转换能力」的中间态，只用于分层验证，不出对外版本。

## Notes

- 每条任务的「变异」列就是 `#003-03` 要求的第四步：拆掉修复，指定用例必须红，并据实记录红在哪一句。
- 任务编号即提交顺序；一次提交只做一条（`openhive/CLAUDE.md` 定制化三原则第 2 条）。
- 收尾提交信息里写命中的 LEARNINGS 条目号（`#002-06` / `#003-03` / `#005-24` / `#005-47` / `#013-09` / `#013-12`）。
