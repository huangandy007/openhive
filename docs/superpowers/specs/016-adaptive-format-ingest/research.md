# Phase 0 Research: 数据格式自适应与自动入库

**Date**: 2026-11-19 | **Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

> 每条裁法含「Decision / Rationale / Alternatives considered」。凡规格已定的（§14 定稿、Clarifications），这里只记录**落地形状**，不复述理由；凡本计划新裁的，写明回退点。
> 本 feature 的规格无 NEEDS CLARIFICATION 项（§14 已全部定稿），本文件解决的是**技术形状**的不确定。

---

## D1 · 转换能力的位置：fork 自有模块，不新开 package

**Decision**: 注册表 / 探测 / 执行器 / 富化 / 准入全部建在 `packages/opencode/src/server/openhive/`，作为独立模块文件；不新建 package，不走 MCP。

**Rationale**: 需求 D2 / §14 第 1 条已定「确定性转换收进内核」。内核即 `packages/opencode`；新开 package 会引入跨包依赖与构建配置，且与「最小化上游冲突」无益——openhive 目录本身是 fork 自有，放这里冲突面为零。

**Alternatives considered**: ① 新建 `packages/adapter-runtime`——多一层构建与依赖管理，收益为零；② 走 MCP 工具——富化/转换在入库事务内，跨进程会丢事务边界（FR-053 明禁）。

**回退点**: 若将来转换器需要独立部署（如 GPU 预处理），再拆 package；本计划不为它预留抽象。

---

## D2 · 「数据入口」的操作定义：项目内固定目录 `材料/`

**Decision**: 自动入队判据 = 上传目标（`realpath` 归一后）落在 `<项目目录>/材料` 之下 **且** 扩展名过 `可解析扩展名` 白名单 **且** 项目开关开启。前端拖入区默认 `dir=材料`；「专用拖入区」就是该目录在工作台里的入口视图，两者共用同一条「落盘 → 建材料」路径。

**Rationale**: 需求 FR-01 要求「仅指定入口生效、普通上传不变」，但代码里目前没有「数据目录」这个概念（全仓无字面命中）。必须给一个**可判定、可测试**的规则；目录判据三条件都成立才入队，保证普通上传（AI 产物、附件、任意目录）零行为变化。测试夹具已按 `材料/话单.xlsx` 的约定书写，与既有习惯一致。

**Alternatives considered**: ① 新增专用上传端点 `/upload-data`——前端已有拖拽落盘通道，新端点等于复制一遍 multipart / 归属闸 / 同名不覆盖逻辑（`file.ts:826-868` 的既有防线），违背复用优先；② 全项目白名单扩展名自动入队——§14 第 2 条已否。

**回退点**: 若产品把数据目录改名，只改一个常量（`材料` 目录名）与前端默认 `dir`；判据本身不变。

---

## D3 · 探测通道：第二个轮询循环，DB 即队列

**Decision**: 新增 `case-probe-worker.ts`，形状照 `case-ingest-worker.ts` 的 `Layer.effectDiscard` + `Effect.forkScoped`（500ms 一拍）；队列就是 `auth.case_material` 表本身：`select ... where project_id is not null and probe is null and parse_status = '排队中' order by created_at limit 1`，用条件 `update` 原子认领（写 `{"状态":"探测中"}`）。探测完成后写 `probe`；进程重启后未探测的行照跑。独立环境开关 `OPENHIVE_CASE_PROBE_WORKER=0` 供测试关闭（照 `消费开关ENV` 的先例）。**不依赖后台模型**：探测是确定性的表头比对，不调 provider。

**Rationale**: FR-054 要求探测「不排在主转换队列之后」；主 worker 在 20 份排队时要几十秒才轮到后面的文件，复用主 worker 直接违反 SC-001。用表做队列免去新队列表与重启恢复逻辑（既有 worker 同一哲学：`claimNextJob` 不依赖内存状态）。只探测 `parse_status='排队中'` 的行，旧材料（已解析 / 有问题）不会被一次性批量标注。

**Alternatives considered**: ① 在上传请求内同步探测——20 份拖入时串行读文件，上传响应变慢且占用 HTTP worker；② 独立内存队列——重启即丢，失败的文件永远没有探测结论；③ 另建 `case_probe_job` 表——多一张表只为一列结论，不划算。

**回退点**: 若探测吞吐成瓶颈（大批量），把 limit 1 改批量、或起多个 probe 协程；表结构不变。

---

## D4 · 探测的读盘方式：复用 `readSheets`，小窗口

**Decision**: 探测用 `readSheets(bytes, { maxSheets: 1, maxRowsPerSheet: 5 })` 取表头 + 5 行样本；两道闸（表头闸 / 值闸）都只在这份小窗口上跑。**只对表格材料探测**；文本材料（`.txt` / `.md` / `.log` / `.docx`）不走适配器探测，沿用既有抽取链（文本没有表头，注册表无判据可用）。

**Rationale**: `case-sheet.ts` 刻意不用 SheetJS 的 `sheetRows`（文件头写明理由：扫描面积闸要按声明区域算，防整列格式化文件把内核拖死）。小窗口让探测的「识别」与作业链的「识别」用**同一份读表函数**（`#002-06`：同一前提单一出处），不另写一条 header peek。已知代价：`XLSX.read` 仍整本解析容器，超大文件探测可能超 1 秒——按「已知风险 2」处理，不放大承诺。

**Alternatives considered**: ① 直接用 zip 读 `xl/worksheets/sheet1.xml` 取首行——快，但 csv / xls / html 各要一条路径，等于把 `readSheets` 的格式分派抄一遍；② 延迟探测到大文件读完——违反 1 秒。

---

## D5 · 探测结论的落点：`case_material.probe`（新列），不写状态机

**Decision**: 迁移 `0045` 加 `case_material.probe jsonb`，形状 `{"状态":"探测中"|"已识别"|"未识别","适配器id"?, "版本"?, "原因码"?, "完成秒"?}`。探测**不改** `parse_status`：排队中的材料仍是「排队中」；作业结论写 `parse_status` 且**始终覆盖**探测结论（视图以作业为准）。零命中时探测只写 `未识别:无匹配适配器` 到 `probe`，等 worker 走完作业落「有问题」。

**Rationale**: 六态机 `case-status.ts:13-31` 不允许「排队中 → 有问题」直接转移（`case-ingest.ts:363-366` 注释记着这个坑：非法转移被吞会把材料卡死）。探测是「第一版结论」，不是状态迁移；混写状态会造出「已识别但没入库」的假终态（US3/SC-001 的失败模式）。独立列也让报告与界面能同时展示「探测结论」与「作业结论」。

**Alternatives considered**: ① 探测直接置「有问题」——非法转移 + 材料卡死；② 写进 `parse_detail`——该字段是给人看的识别明细，写入时机会与作业结果竞争（§14 第 6 条对进度列的同一条理由）。

---

## D6 · 执行器：照 `governance-mcp-supervisor.ts` 的子进程形状

**Decision**: `case-converter-runner.ts` 用 `node:child_process` 的 `spawn`（既有先例 `governance-mcp-supervisor.ts:1`）；`cwd` = 已启用技能目录（`作业项目目录/.opencode/skill/<assetId>`）；命令来自 `adapter.json` 的 `entry.command`（只允许白名单前缀：`bun run` / `node`）；输入只读原件路径（由内核复制 / 只读挂载不必要——直接给原件绝对路径，子进程只读）；输出写技能目录内 `output.file`（技能包是共享资产：运行前已存在即拒，只删本次新建的输出）；超时（默认 60 秒，可按作业覆盖）；环境变量**剔除 `PG_*` 与数据库连接串**，只给 `PATH` / `HOME` / 临时目录等最小集。`kind` 闭集 `{"rowRules","converter"}`：`rowRules` 由内核按声明的规则执行（FR-011，不起子进程）；`converter` 走本执行器，`rowRules` 字段在 `converter` 包里仅作评审与回归说明，不执行。

**Rationale**: 需求 §7.2 要求「不注入 PG 凭据、只读输入、只写临时输出、有超时」；既有 supervisor 已把 spawn / 环境白名单 / 超时的坑踩过一遍，照形状写比重新发明安全。`kind` 必须区分，否则 FR-011 与 FR-012 无法分别验证。

**Alternatives considered**: ① `Bun.spawn`——可用，但与既有先例不一致，测试桩也要另写一份；② 进程内 `import()` 执行 convert.ts——外部代码拿到内核进程的全部环境（含 DB 凭据），直接违反 §7.2。

---

## D7 · 原因码：`case_ingest_job.reason_code`，材料视图经最近作业 JOIN

**Decision**: 迁移 `0045` 给 `case_ingest_job` 加 `reason_code text`（可空）；六种字面值见 `contracts/reason-code-contract.md`。材料视图用 `distinct on (material_id) ... order by material_id, started_at desc nulls last, queued_at desc, id desc` 取最近一次作业的原因码（**带 `id` 兜底**：同一毫秒入队的两个作业必须有确定次序）；「未识别」筛选 = `reason_code like '未识别:%'`。`parse_detail.reason` 与作业 `error` 的自由文本**保留**，两者并存。同一条迁移还加 `adapter_id` / `adapter_version`（材料视图要显示，二轮复核 R4）与 `(project_id, material_id, queued_at desc, id desc)` 索引（R5）。

**Rationale**: 需求 §6.4 明写「原因码写入作业结果」；作业表本就是一次执行的结果载体，且失败路径与成功路径同一事务写（`case-ingest.ts:388-398` 的「各自兜底」形状不改）。放材料表会让「同一材料多次重跑的原因历史」丢失。

**Alternatives considered**: ① 材料表加列——重跑会覆盖，报告与审计看不到历史原因；② 只解析 `parse_detail.reason` 字符串——自由文本不可筛选（M3 的原始问题）。

---

## D8 · 进度：`case_ingest_job.progress jsonb`（§14 第 6 条裁定）

**Decision**: 形状 `{"阶段":"读表|探测|转换|写入|富化","已处理"?:n,"总数"?:n,"更新时间":秒}`；worker 在阶段切换与每批写入时 `update`。材料视图取最近作业的 progress。

**Rationale**: §14 第 6 条已定「独立进度列，不复用 `parse_detail`」。`progress` 是运行中状态，`parse_detail` 是给人看的识别明细；混写会让重跑时旧明细与新进度互相污染。

**Alternatives considered**: 见 §14 第 6 条，不复述。

---

## D9 · 数据源档案扩展：`0046` 加 4 列，匹配仍 fail-closed

**Decision**: `case_source_profile` 加 `optional_headers jsonb NOT NULL DEFAULT '[]'`、`priority integer NOT NULL DEFAULT 100`、`rule_version text`、`hints jsonb`。匹配判定**只用 `header_set`**（缺列即不命中，保持既有语义）；`optional_headers` 只进报告与建档提示；多档案同分时按 `priority` 降序、再按 `id` 字典序（与适配器同一决胜规则）。~~同时修：档案命中的表也要写 `format_fingerprints`~~ —— **此条已撤销（二轮复核 R2，2026-11-19）**：`setMaterialFormatFingerprints` 现状对全部工作表无条件写（`case-ingest.ts:781-791`），档案分支跳过的只是 `case_table_format`（`:548`）；「只被档案命中的材料无法再建档」已由 commit `92c8e1252a` 在 `case-source-profile-store.ts:248-270` 用「回落到命中档案」修掉。反过来写缓存，档案撤销后不再命中时缓存行就是唯一来源（顺序：档案 → 缓存 → 四层 / 模型，`case-ingest.ts:453-477`），等于用撤销的映射继续解析（违反 FR-059 一族）。

**Rationale**: §14 第 7 条已定本次补齐四项。匹配判据不动是宪法 V 与「不重写档案匹配」的硬边界；可选头若参与命中，会让档案从「缺列不命中」退化成「猜」，与 fail-closed 相悖。

**Alternatives considered**: ① 可选头参与打分——改变既有匹配语义，且会让原先不命中的表突然命中，历史结论漂移；② 档案也用指纹——档案的粒度是「表头集合」，指纹是「表头 + 样本 + 别名版本」，语义不同（0043 文件头已登记该偏差）。

---

## D10 · 富化：受控键分类表在代码里；缓存只在内存

**Decision**: 键分类受控表写成代码常量（`case-enrich.ts` 内的 `键分类` 映射），参考类 / 身份类 / 匹配类；**未登记键 fail-closed 按身份类**。查询路径：`distinct` 键 → 参考库（整表载入内存，带版本号）→ 案件库（一条 `unnest`，复用既有唯一索引）→ 外部服务（并发上限 4、超时 5 秒、内存 LRU 缓存 + 负缓存 TTL 10 分钟）。富化结果**不落新表**：补全值作为属性观察写入既有 `attrs`（带 `材料#表#行` 出处），由既有「按出处剥离 attrs」清理出口覆盖；缓存只是内存加速，重启即失，不构成派生数据。

**Rationale**: FR-049/050 要求批量与缓存；M7 的清理义务针对「没有 `material_id`、也无出处反查」的派生存储——内存缓存天然没有这个问题，少一张表就少一条清理义务与一个漂移点。键分类放代码而非库：类别是产品语义（决定「查不到时怎么办」），不是数据；进库会变成可被随意改的口径，破坏 fail-closed。

**Alternatives considered**: ① 富化结果单独落表——与 `attrs` 双写，必然漂（`#007-02` 两个存储两个读者）；② 键分类进库表——同上级，且要多一套管理界面。

---

## D11 · 重跑批量出口：一个端点、复用 `入队材料` 的幂等语义

**Decision**: 新端点 `POST /openhive/case/ingest/rerun-scan`（扫描，只读）+ `POST /openhive/case/ingest/rerun`（确认后批量入队）。扫描三类候选：① 项目 `材料/` 目录里有、库里无材料记录的文件（按路径扫文件树）；② `parse_status='未入队'` 的材料；③ `parse_status='有问题'` 且最近作业原因为 `未识别:%` 的材料。确认后的批量入队**逐个**调既有 `入队材料`（带 `force` 语义：未识别的重新排队），返回 `{候选数, 已入队, 跳过（已解析/产物）, 失败}`。不使用 `case-parse.ts` 的单文件 API（它要求单文件人工动作，不改）。

**Rationale**: §14 第 5 条已定「新开独立批量出口，不改 `case-parse` 单文件 API」。复用 `入队材料` 保证幂等（内容指纹）、归属闸、白名单三份判据仍是单一出处。扫描只读项目 `材料/` 目录 = 与 D2 的入口口径同一判据。

**Alternatives considered**: ① 前端循环 N 次——正是原裁定禁止的形态（`file-tree.tsx:692-695`）；② 全目录递归扫描项目所有子目录——会把产物目录也扫进来，且与「数据入口」定义冲突。

---

## D12 · 可信技能：平台白名单（`is_admin`）+ 项目开关（属主）

**Decision**: 迁移 `0048` 建 `auth.trusted_skill (asset_id PK, added_by, added_at)`，外键级联到 `auth.asset` / `auth.user`；维护出口要求 `user.is_admin`。迁移 `0047` 建 `auth.project_case_ingest_settings (project_id PK, auto_enqueue boolean NOT NULL DEFAULT true, auto_enable_trusted boolean NOT NULL DEFAULT false, updated_by, updated_at)`；两个开关的写入都要求项目属主，变更一律 `记治理`（`audit.ts:97`）留痕。开关判断在服务端执行路径上（入队前 / 自动启用前），前端只是显示。

**Rationale**: §14 第 4、8 条已定。平台管理员即既有 `is_admin`（`account-admin.ts:58`、`governance.ts:203`），不新造角色。开关表用「行在即开、行删即关」还是「布尔列」？选布尔列 + 默认值：两个开关都要能 `NOT NULL` 表达默认（自动入队默认 true、可信技能默认 false），行缺失时也按默认读，语义更直白。

**Alternatives considered**: ① 复用 `project_asset_auto_delivery`——那是「资产自动送达」的用户级设置，语义不同（是否把资产投递到项目 vs 是否自动解析 / 自动启用），共用一张表会让两个开关互相踩；② 白名单放项目级——§14 第 8 条已否（单位管理员维护）。

---

## D13 · 报告存储：`case_material_report` append-only，历史保留

**Decision**: 迁移 `0049` 建 `auth.case_material_report`：`(project_id, id) PK`、`job_id`、`material_id`、`adapter_id`、`adapter_version`、`rule_version`、`source_sha256`、`gates jsonb`、`warnings jsonb`、`skipped_rows jsonb`、`enrich jsonb`、`admission jsonb`、`created_at`；唯一 `(project_id, job_id)`；索引 `(project_id, material_id, created_at desc)`。每次作业成功 / 失败（有报告时）追加一行；**重跑不删历史**（FR-060：历史报告保留当时版本）。N8 准入闸读本表最新一行。

**Rationale**: FR-057 要五项报告内容、FR-060 要历史版本、N8 要「读转换报告」——都需要可持久、可按材料回看的存储；`parse_detail` 是单值字段，覆盖即丢历史。append-only 与「规则升级不自动改写历史结论」直接对齐。

**Alternatives considered**: ① 存进 `parse_detail.report`——重跑覆盖，历史版本无从保留；② 报告写文件到项目目录——产出物污染项目树，且成员权限与清理都要另做。

**清理策略登记（M7）**: 报告是**执行历史**（与审计同类），不属于「可重算的派生数据」；保留策略 = 随材料存在而保留、材料删除时级联（后续若加材料删除出口，按 `material_id` 一并删）。重跑不增长派生数据（属性 / 别名 / 参与者 / 富化）——报告每跑一行是**预期**的 run log，不在 SC-007 的「派生数据」口径内（该口径见 spec TR-006 / SC-007）。

---

## D14 · 非数字账号：只放宽 `@wx.tenpay.com`

**Decision**: `是账户形状`（`case-field-registry.ts:48,56`）在既有「剥空白与连字符后 `^\d{6,32}$`」之外，增加精确分支：剥空白后以 `@wx.tenpay.com` 结尾（不区分大小写）。**不**放宽任意邮箱、不采用「含 `@` 即账户」。新增后缀 = 改同一处 + 补用例。

**Rationale**: §14 第 10 条已定；C7 的动机是属性列在微信账号行上被静默丢弃（`case-attribute-registry` 与 `case-translate.ts:347-348` 的挂载前提）。判定只有一处（`#002-06`），放宽点也必须只有一处。

**Alternatives considered**: ① 泛化邮箱——会把 `abc@example.com` 之类的备注文本认成账户，制造错误实体；② 只放宽翻译层——识别层仍不认，形成「识别认了、实体建不出来」的反向错位。

---

## D15 · A 类档案发布校验与 M10 同一道闸

**Decision**: 发布 / 启用校验（M10）分两支：转换器包走 `contracts/adapter-json-contract.md` 的全量校验（四件套、schema、entry、`attributeKeys` 词表）；A 类档案走「字段映射合法 + 必需列声明」校验（映射的键是表头原文、值是字段目录内的识别字段；必需列非空；`type` 在闭集）。两支在同一路由的发布 / 启用路径上执行，失败列出问题项。

**Rationale**: §14 补充口径已定「A 类档案也受发布 / 启用校验，至少校验字段映射与必需列」。共用同一路由位置 = 权限与留痕机制复用，不另开一条发布通道。

**Alternatives considered**: 只校验转换器包——A 类档案写错映射会在首次使用时才暴露，且错误会被当成「未识别」归因到数据。

---

## 二轮复核裁定（2026-11-19）：按「先复用、后新建」回源码核过的 16 条

> 完整推演与证据在 `plan.md` 的「二轮复核裁定 R1–R16」；这里只记录**对本文件 D1–D15 的修订与新增结论**。

| 编号 | 结论 | 证据 |
|---|---|---|
| R1 | M1 的 `by` 在 `handleUpload` 内单独取 `User.Service`；**不改** `gate` 签名 | `file.ts:593-604`（gate 丢弃 user，10 个 handler 共用） |
| R2 | **撤销 D9 的「同时修写指纹」**（过时前提）；档案命中不写 `case_table_format`，否则档案撤销后缓存成唯一来源 | `case-ingest.ts:781-791` / `:548` / `:453-477`；commit `92c8e1252a`；`case-source-profile-store.ts:248-270` |
| R3 | M8 落 `case-mapping.ts`（`修饰语放行` + `合成词长`），不是 `case-translate.ts` | `case-mapping.ts:138-175,200+`；`case-translate.ts:320-352` |
| R4 | `0045` 加 `adapter_id` / `adapter_version`，材料视图不跨组读报告表 | `0031:312-329` 现有列清单；数据模型分工 |
| R5 | 两条索引：作业「最近一条」复合索引、探测认领部分索引 | `case-materials.ts:43-128` 的 `distinct on (path)` |
| R6 | N1 用 `SKILL_LINK_DIR` / `skillLinkPath` / `usableSkillAssets`，不自建 walk 与可见性判定 | `asset-service/src/project-skill-link.ts`；`skill-availability.ts:80` |
| R7 | 表头归一抽 `表头下标()` 一份；`priority` 只决排序不参与命中（FR-065） | `case-source-profile.ts:46-119` |
| R8 | 适配器命中构造与 `识别材料` 同形状结果；值闸与 N2 同一函数 | `case-recognize.ts`；`#002-06` |
| R9 | N5 复用 `扫树`，按 sha256 去重，`truncated` 如实上报 | `project-tree-scan.ts:69`；`case-store.ts:96-111`（同内容改写 path） |
| R10 | M10 发布闸挂 `asset-service`（`service.ts:830/848`、`lifecycle.ts:173-201`、`governance-assets.ts:838`），启用侧抽共用内核 | 同上；`project-assets.ts:885-930` |
| R11 | 新路由 import 既有 `过门`（加 `export`），不复制权限闸 | `case-ui-routes.ts:157`；`#005-24` |
| R12 | N6 提醒状态走 `localStorage`，不建表、不扩 `preferences` 封闭键集 | `preferences.ts:55-105` |
| R13 | 迁移 5 组成对（`.sql` + `.down.sql`，共 10 文件） | `0035`–`0044` 惯例 |
| R14 | **FR-004 vs FR-042 冲突按 FR-042 裁定（待用户确认）**：是否新增作业一律交 `该走哪个动作`；已解析重复拖入不排作业；US1 场景 2 改为「换名同内容」双向判据（有问题 ⇒ +1 / 已解析 ⇒ 不新增）。字面「同名再拖」被上传口 400 挡住，改它要动 FR-065 | `case-ingest.ts:108-129`；`file.ts:826-868`（同名 400） |
| R15 | 笔误：`ohive-` → `openhive-`；14 → 15 个裁法；「2 行注册」→ import + 路由块 + worker 块 | 本文件与 plan 已改 |
| R16 | 010「数据源配置」与 `case_source_profile` 不是同一实体，不合并 | `governance-data-source.ts`、`governance/data-source.tsx` |

**新增（D 表未覆盖）**：状态机与 `该走哪个动作` 的共同出口（`case-ingest.ts:108-129`）必须作为 N5 批量入队的去重依据——批量出口自己再写一遍「已解析不重跑」就是第二份真相。

---

## 遗留技术不确定（登记，不阻塞）

| 项 | 现状 | 处理 |
|---|---|---|
| 超大文件探测 >1 秒 | `XLSX.read` 整本解析 | 按已知风险 2 登记；1 秒承诺只覆盖典型文件，100k 行只记录 |
| 外部服务具体是哪个 | 需求未点名具体服务 | 富化层先按契约留接口（`外部服务` 分支），接入方与参考库条目由内容侧后续补；本计划只钉「并发 / 超时 / 缓存 / 负缓存」四项约束 |
| 参考库数据来源与版本 | 需求只给契约 | 同上：`case-reference-store.ts` 定义「整表载入 + 版本号」的加载接口，首批数据由内容侧提供，测试用夹具 |
