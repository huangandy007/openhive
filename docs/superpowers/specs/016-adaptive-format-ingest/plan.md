# Implementation Plan: 数据格式自适应与自动入库

**Branch**: `016-adaptive-format-ingest` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: `docs/superpowers/specs/016-adaptive-format-ingest/spec.md`（唯一依据：`2026-11-18-数据格式自适应与自动入库-需求.md` 2026-11-19 复核版）

## Summary

把「拖入即自动识别、自动转换、自动入库」接到现有案件导入链路上。**不重写任何已验收内核**：`file.ts` 的上传落盘、`case-ingest.ts` 的作业链、`case-status.ts` 的六态机、`case-source-profile.ts` 的档案匹配、`case-attribute-registry.ts` 的属性列、`case-translate-store.ts` 的按材料清理出口、`project-assets.ts` 的技能启停全部复用，只在其前加探测、在其旁加执行器与出口。

**不重复造轮子**（沿用 015 的现行约束）：本计划对每个待做项先回答「现有哪个符号能干这件事」，答不出来的才新建；每个新建模块都注明它复用的是哪份既有判据。

**二轮复用复核（2026-11-19）**：按「先复用、后新建」逐条回源码核对后，修正了 8 处落点与 1 处过时前提，全部有 `file:line` 或提交号作证据，见文末「二轮复核裁定 R1–R16」。结论未变：仍不需要新的目录扫描器、新的子进程框架、新的启用机制、新的表头判据。

**规格的交付边界是全量**：第一个对外版本 = 需求文档 §12.6 的第 1–4 组全部能力，AC-1 ~ AC-12 全部为门槛，**不存在可对外的部分 MVP**（spec Clarifications 第 1 条）。编码顺序按下表四组推进，组间有硬依赖（见「实施顺序」）。

## Technical Context

**Language/Version**: TypeScript 5.8.2（Bun 1.4.2 workspace monorepo）

**Primary Dependencies**: Effect（`packages/opencode` 服务端）、Drizzle ORM（`packages/auth` 迁移）、`xlsx`（既有，`case-sheet.ts`）、`node:child_process`（既有先例 `governance-mcp-supervisor.ts:1`）、SolidJS 1.9.10（`packages/app`）。**不新增依赖**（需求 §12.5）。

**Storage**: PostgreSQL `auth` schema；迁移接在 `packages/auth/src/migrations/` 的 `0044` 之后（本轮 `0045`–`0049`）。事实行 / 实体 / 别名 / 出处结构不动。

**Testing**: `bun test` 在受影响 package 内跑（`packages/opencode` / `packages/app`）；`packages/app` 有 happy-dom 可写组件用例；性能与真栈项（1 秒探测、5,000 行 ≤10 秒、富化 <1 秒）在**真栈实测**，不用 PGlite 推断（`#013-11` 反面教训：本机测试库与生产计划不同）；门禁在仓库根（`bun run typecheck` + `oxlint`），根目录 `bun test` 禁止（`#004-10`）。

**Target Platform**: 公安内网 Docker 私有部署；桌面浏览器；单 worker 顺序消费不变。

**Project Type**: Bun monorepo（`packages/opencode` 服务端 + `packages/app` 前端 + `packages/auth` 迁移）。

**Performance Goals**: 单份可解析表格落盘后 ≤1 秒出「已识别 / 未识别」（不含排队，探测独立通道）；5,000 行端到端 ≤10 秒；5,000 行 / ~1,000 去重键富化 <1 秒且逐行查询语句数为 0；100,000 行只留实测记录，不设阻塞阈值。

**Constraints**: 所有改动 MUST 可持续 `git merge upstream/dev`；转换器子进程 MUST NOT 拿到 PG 凭据；状态仍为六态闭集；自动入队只对「数据入口」生效；普通上传行为不变（回归用例钉住）。

**Scale/Scope**: 新增服务端模块 14 个（13 个在 `server/openhive/` + `asset-service/src/ingest-gate.ts`）、迁移 5 组（每组 `.sql` + `.down.sql`，共 10 个文件）、前端 9 个文件（2 改 + 7 新）；修改既有文件 14 个（11 个 openhive 模块 + `server.ts` + `asset-service` 的 `lifecycle.ts` / `service.ts`）；**不碰** `packages/opencode/src/skill/index.ts`、`case-recognize.ts`、`case-status.ts` 的状态集合、`case_event` / `case_entity` / `case_citation` 结构。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 宪法条款 | 本计划如何满足 |
|---|---|
| **I. 最小化上游合并冲突（NON-NEGOTIABLE）** | 全部服务端改动落 fork 自有目录 `packages/opencode/src/server/openhive/`；前端落 `packages/app/src/{project,governance,ai-assets}`（fork 自有）；迁移落 `packages/auth/src/migrations/`（fork 自有）。**唯一碰「上游风格文件」的是 `server.ts`**：该文件已有 30+ 个 openhive 导入（`server.ts:127-158`）、路由块（`:429-440`、`:531`）与 worker 层（`:551`）；本次按同一形状追加 **1 个 import + 1 个路由块 + 1 个 worker 层块**（不是「2 行」，如实记录）。`skill/index.ts`、`sql.ts` 不动。 |
| **II. 品牌化走配置** | 不涉及；无品牌字符串硬编码。 |
| **III. 物理隔离优先** | 业务数据仍在独立 PG + 项目隔离；探测 / 报告 / 富化缓存全部带 `project_id`，读取一律经既有项目成员闸；不新增跨项目通道。 |
| **IV. 权限下沉到执行层** | 新出口的权限全部在服务端：重跑批量出口要求项目成员（沿用 `case-ui-routes.ts` 的 `成员角色`）；档案建档 / 撤销沿用既有出口校验；可信技能白名单**平台级 `is_admin`** 在服务端判（`auth/account-admin.ts:58`），项目开关要求项目属主；转换器执行前校验适配器包已发布且已启用（服务端）。前端置灰只是省往返。 |
| **V. 侵入是「加」不是「改」** | 14 处「改」全部是**定点接线**（见 Reuse Inventory 的「新写量」列）：上传处理器 +3 行、作业链 +1 个前置分支、视图 SQL +5 列、`case-ui-routes.ts` 只加 `export`、`server.ts` 按既有形状挂一次；无重写、无结构迁移既有表（只加列）。 |
| **质量门禁** | 仓库根 `bun run typecheck`、`bun run lint`；受影响包 `bun test`；所有测试带 `timeout`（退出码 124 不自动重跑）。 |
| **九、TDD 纪律** | 每条 FR 先红后绿（TR-001 ~ TR-013）；「已落地」的复用点不写「假装新写」的用例，但新行为（探测、原因码、重跑、富化）必须先观测到红。 |

**Gate 结论**：通过。需要登记的风险只有一处：`file.ts` 的上传处理器是全仓唯一落盘入口，M1 的接线必须保证「数据入口以外零行为变化」，用回归用例钉住（见「已知风险」1）。

## Project Structure

### Documentation (this feature)

```text
docs/superpowers/specs/016-adaptive-format-ingest/
├── spec.md
├── plan.md              # 本文件
├── research.md          # Phase 0：15 个技术裁法（D1–D15，含替代方案与回退点）+ 二轮裁定 R1–R16
├── data-model.md        # Phase 1：新增列 / 新表 / 状态与原因码 / 富化键分类表
├── contracts/
│   ├── adapter-json-contract.md      # 识别卡 schema 与发布校验
│   ├── converter-output-contract.md  # 转换器 JSON 输出（rows + report）
│   ├── reason-code-contract.md       # 六种原因码字面值与写入时机
│   └── ingest-api-contract.md        # 新出口 / 变更字段（材料视图、重跑、档案、开关、报告）
├── quickstart.md        # 可复跑的验收命令与真栈步骤
├── checklists/requirements.md
└── tasks.md             # 下一阶段（/speckit-tasks）生成，不在本计划内
```

### Source Code (repository root)

```text
packages/opencode/src/server/openhive/
├── file.ts                          # 【改】M1：上传成功后按「数据入口」规则调 入队材料（+3 行；userId 在 handler 内取，gate 签名不改）
├── case-ingest.ts                   # 【改】M2 适配器前置分支 / M3 原因码 / N8 准入结论 / M7 派生存储登记
├── case-ingest-worker.ts            # 【改】M5 进度写入点（阶段切换 + 每批）
├── case-materials.ts                # 【改】M4 视图加 adapterId/adapterVersion/reasonCode/progress/probe + 未识别筛选
├── case-source-profile.ts           # 【改】M6 只加 priority 决胜（可选表头**不参与命中**，FR-065）
├── case-source-profile-store.ts     # 【改】M6 新增列读写 + rule_version / hints 写入
├── case-field-registry.ts           # 【改】C7 账号形状精准放宽（@wx.tenpay.com）
├── case-mapping.ts                  # 【改】M8 裸属性列裁决（`修饰语放行` + `合成词长` 两处漏点）
├── case-parse.ts                    # 【改】M4 透传 `未识别=1` 查询参数（+2 行）
├── project-assets.ts                # 【改】N7/M10 启用侧：抽出可复用的「启用内核」，先过识别卡校验
├── case-ui-routes.ts                # 【改】仅 `export` 既有 `过门` / `Deps` / `PREFIX`（实现零改）
├── case-adapter-registry.ts         # 【新】N1 适配器注册表（复用 SKILL_LINK_DIR / skillLinkPath / usableSkillAssets）
├── case-adapter-probe.ts            # 【新】N2 表头闸探测（值闸由转换器报告承担，Ruling X；priority 决胜）
├── case-probe-worker.ts             # 【新】探测独立通道（DB 即队列，不占转换 worker）
├── case-converter-runner.ts         # 【新】N3 子进程执行器（cwd=技能目录、输出已存在即拒＋运行标记自愈、默认 60s、无 PG 凭据）
├── case-ingest-admission.ts         # 【新】N8 准入结论闸（命名避开既有 case-admission.ts：那是实体泛称闸）
├── case-enrich.ts                   # 【新】N4 富化层（产键 → 批量查 → Map 回填；键分类受控表）
├── case-reference-store.ts          # 【新】N4 静态参考库（内存缓存 + 版本）+ 外部服务客户端（并发/超时/负缓存）
├── case-rerun-scan.ts               # 【新】N5 候选扫描 + 批量入队（复用 扫树 / 入队材料；按 sha256 去重）
├── case-material-report.ts          # 【新】N8/FR-057 报告存取（append-only，历史版本保留）
├── case-ingest-settings.ts          # 【新】项目级开关（自动入队 / 自动启用可信技能）读写
├── case-trusted-skill.ts            # 【新】N7 平台级白名单读写（is_admin 闸）
├── case-ingest-routes.ts            # 【新】新 HTTP 出口（重跑 / 档案扩展 / 开关 / 报告 / 材料筛选）
└── governance-trusted-skill.ts      # 【新】白名单管理出口（/openhive/governance/trusted-skills）

packages/opencode/src/server/routes/instance/httpapi/server.ts
                                    # 【改】+1 import +1 路由块 +1 worker 层块（与既有 30+ 处 openhive 挂载同形状）

packages/asset-service/src/
├── ingest-gate.ts                   # 【新】N1/M10 识别卡 + 四件套校验（发布闸与注册表共用同一份，#002-06）
├── lifecycle.ts                     # 【改】M10 发布闸：新增拒绝码（贴在既有 mcp_probe_failed 同处）
├── service.ts                       # 【改】M10 发布执行流调用 ingest-gate（:830 / :848 两个 throw 点旁）
└── enablement.ts                    # 【不改】N7 直接复用 enableAsset / enabledAssetIds / ENABLEMENT_LIMIT

packages/app/src/project/
├── case-materials-api.ts            # 【改】M4 字段
├── case-materials-view.ts           # 【改】M4 探测徽标 / 原因码 / 进度 / 队列位置分开呈现
├── source-profile-api.ts            # 【新】C1 档案 CRUD 客户端（复用既有 HTTP 三出口）
├── source-profile-view.tsx          # 【新】C1 列表 + 建档 + 撤销
├── case-rerun-dialog.tsx            # 【新】N5/N6 扫描结果与一键重跑弹窗
├── case-ingest-settings.ts          # 【新】自动入队 / 可信技能开关（项目属主）
└── case-skill-hint.tsx              # 【新】N6 三个时刻的提醒（复用 ai-assets/enable-api；提醒状态走 localStorage）

packages/app/src/governance/
├── trusted-skill-manage.tsx         # 【新】N7 平台管理员白名单维护
└── trusted-skill-api.ts             # 【新】同上客户端

packages/auth/src/migrations/
├── 0045_case_ingest_probe_reason_progress.{sql,down.sql}          # 作业 4 列 + 材料 probe + 2 条索引
├── 0046_case_source_profile_priority.{sql,down.sql}              # 档案 4 列
├── 0047_project_case_ingest_settings.{sql,down.sql}              # 开关表
├── 0048_trusted_skill.{sql,down.sql}                             # 白名单表
└── 0049_case_material_report.{sql,down.sql}                      # 报告表

packages/opencode/test/server/         # 测试落点（命名见 quickstart）
packages/app/src/{project,governance}/*.test.{ts,tsx}
```

**Structure Decision**：沿用现有布局。服务端新能力全部建在 `server/openhive/`（fork 自有目录，与上游零冲突面）；路由新增独立文件、复用既有 `过门`（`case-ui-routes.ts:157` 加 `export`，实现零改），避免把 1,000+ 行的 `case-ui-routes.ts` 继续撑大与复制一份权限闸（`#005-24` 共同出口）；识别卡校验只有一份，落在 `asset-service/src/ingest-gate.ts`——发布闸与运行期注册表都调它，不各写一次；前端按「已有目录放同类」——材料相关进 `project/`，平台管理进 `governance/`，资产启用复用 `ai-assets/`。

## Reuse Inventory（先回答「现有谁在做」，再决定写不写）

| 待做项 | 复用的既有符号 | 位置 | 新写量 |
|---|---|---|---|
| 上传落盘 + 路径归属闸 | `handleUpload` / `inside` / `realInside` | `file.ts:826-868` | 接线 3 行 |
| 取当前用户（M1 的 `by`） | `Effect.serviceOption(User.Service)`（`gate` 内已这么做但**丢弃**了 user） | `file.ts:593-604` | handler 内单独取一次，**不改** `gate` 签名 |
| 建材料 + 排队（幂等按指纹） | `入队材料` → `enqueueMaterial`；`createMaterial` 指纹 upsert | `file.ts:751`、`case-ingest.ts:132`、`case-store.ts:96-111` | 0 |
| 材料当前状态 → 该不该重跑 | `该走哪个动作`（已解析不自动重跑） | `case-ingest.ts:108-129` | 0 |
| 作业项目目录（N1/N5 目录口径） | `作业项目目录`（前两段过闸，含 win32 归一） | `case-ingest.ts:313` | 0 |
| 沙箱内读盘闸 | `沙箱内路径` | `case-ingest.ts:151`（worker 已用） | 0 |
| 表格读取（表头 + 数据行 + 面积闸） | `readSheets(bytes, { maxRowsPerSheet })` | `case-sheet.ts:223` | 0（探测用 `maxSheets:1, maxRowsPerSheet:5`） |
| 扩展名白名单（M1 入口判据） | `可解析材料` / `解析方式` | `case-parseable.ts:1-32` | 0 |
| 档案匹配（表头集合、列序无关、缺列不命中、前两名打平不猜） | `匹配数据源档案` | `case-source-profile.ts:46-119` | 只加 `priority` 决胜排序；**不**加可选头判据（FR-065） |
| 档案命中后的记录回落（**M6 不做缓存回写**） | `建数据源档案` 里的 `读命中档案id` 回退分支 | `case-source-profile-store.ts:248-270`（commit `92c8e1252a` 已修） | 0，见 R2 |
| 属性列解析与词表 | `解析属性列` / `属性键们` / `属性列形状` | `case-attribute-registry.ts` | 0 |
| 属性挂载与去重（按值保留首次出处） | `翻译资金` 的 extras 分支（只消费 `属性:` 键） | `case-translate.ts:341-350` | 0（转换器行直接喂给它） |
| **裸属性列误分类（M8 真落点）** | `需修饰裁决` / `修饰语放行` / `合成词长` + 词表 `对手修饰` / `本方修饰` / `账号词尾` | `case-mapping.ts:138-175,200+` | 收紧 2 处判据；`case-translate.ts` 不动 |
| 事实行写入 / 事务 | 现有 `跑表格` 写完路径 + `case-fact-store.ts` | `case-ingest.ts:504-720` | 转换器分支复用同一写入函数 |
| 按材料清理派生行（M7 出口） | `清本材料翻译`（清孤儿参与者 / 撤销别名 / 按出处剥离 attrs / 删引用 / 重建旧对） | `case-translate-store.ts:70-145`；调用 `case-ingest.ts:720-723` | 新派生存储逐项登记策略（不新增清理代码） |
| 六态状态机 + 动作表 | `case-status.ts:13-31` | 不改 | 0 |
| 材料视图 SQL | `材料视图` | `case-materials.ts:43-128` | SQL +5 列、+1 筛选参数（列名可在 `case-parse.ts` 透传） |
| 子进程执行先例（spawn + 超时 + 环境白名单） | `spawnGovernanceMcp` | `governance-mcp-supervisor.ts:219` | 照形状写 runner，不抄业务 |
| 审计留痕 | `记治理` / `尽力记` | `audit.ts:80-101` | 调用，不新建审计表 |
| 项目内权限闸（新出口共用） | `过门({要属主})` + `成员角色` | `case-ui-routes.ts:157`（加 `export`）、`project-actor.ts` | 1 行 export，实现零改（`#005-24`） |
| 技能启用内核 + 20 上限 | `enableAsset` / `enabledAssetIds` / `ENABLEMENT_LIMIT` | `asset-service/src/enablement.ts` | 0；把 `handleToggle` 内联校验抽成导出函数供自动启用共用 |
| 技能链接投影（N1 扫描落点） | `SKILL_LINK_DIR` / `skillLinkPath` / `linkSkill` | `asset-service/src/project-skill-link.ts` | 0 |
| 可用技能集合（type=skill + published + 可见） | `usableSkillAssets` / `scanUsableSkills` | `skill-availability.ts:80,154` | 0 |
| 发布闸（M10 落点） | `TransitionErrorCode` + `service.ts` 的 MCP 发布闸 | `lifecycle.ts:173-201`、`service.ts:830,848`、`governance-assets.ts:838` | 新增 2 个拒绝码 + 调 `ingest-gate.ts` |
| 目录扫描（N5） | `扫树`（`默认上限 50000` / `默认并发 4` / `truncated`） | `project-tree-scan.ts:69`；经 `project-tree.ts:161` | 0 |
| 平台管理员判定 | `user.is_admin` | `packages/auth/src/account-admin.ts:58` | 0（白名单出口直接判） |
| 档案 HTTP 三出口 | 列表 / 建档 / 撤销 | `case-ui-routes.ts:586-690` | 前端直接调，服务端只扩字段 |
| 资产启用提示与启停接口 | `ai-assets/enable-api.ts` | `packages/app/src/ai-assets/` | 复用，不新建通道 |
| 管理员页面骨架 | `governance/` 各 manage 页；权限拒绝码映射 | `packages/app/src/governance/`、`governance-assets.ts:838` | 照骨架加一页 |
| ~~用户偏好表（N6 提醒状态）~~ | `readPreferences` / `PreferenceKey` | `preferences.ts:55-105` | **不采用**：键集合封闭，见 R12（改走 localStorage） |
| ~~010 数据源配置~~ | `@opencode-ai/auth/data-source`、`governance/data-source.tsx` | — | **不复用、不合并**：平台级同步连接 vs 项目级表头档案，不是同一实体，见 R16 |

**判定规则**：上表任何一行若在实现期发现「现有符号干不了」，退回 research 并更新本表，不准凭空新建第二条通道（`#002-06`）。

## 实施顺序（TDD）

> 顺序照需求文档 §12.6 的四组；组内按 TDD「先红后绿」。每步写明完成判据（什么命令跑出什么结果）。

### 第 1 组 · 入口与状态（M1、M3、M4、M5、C6）

1. **定「数据入口」判据（D2 落地）**：项目内固定目录 `材料/`（项目相对）；上传落点 `inside(材料目录)` 且扩展名过 `可解析材料`（`case-parseable.ts`，只此一份白名单）且项目开关开启 ⇒ 入队；是否真排作业再问 `该走哪个动作`（`case-ingest.ts:108-129`），已解析材料只更新材料行、不排作业（FR-042 优先于 FR-004，见 R14）。先写红用例：`file.ts` 上传到 `材料/` 产生材料+作业；上传到其他目录**零行为变化**；`.xlsm` / 图片 / 尾随空格不入队。
2. **M1 接线**：`handleUpload` 落盘成功后调 `入队材料`（`by` = handler 内 `Effect.serviceOption(User.Service)` 取到的 userId；`gate` 只返回目录、签名不改）；入队失败不回删文件。
3. **M3 原因码 + 作业快照列**：迁移 `0045` 给 `case_ingest_job` 加 `reason_code text`、`progress jsonb`、`adapter_id text`、`adapter_version text`，给 `case_material` 加 `probe jsonb`，并加两条索引：作业 `(project_id, material_id, queued_at desc, id desc)`（M4 取「最近作业」）与 `case_material (created_at) WHERE parse_status='排队中' AND probe IS NULL`（探测认领）；成功 / 失败两路写结构化码，`reason` 自由文本保留。
4. **M5 进度**：worker 阶段切换与每批写入 `progress`；`parse_detail` 不动。
5. **M4 视图 + C6**：`材料视图` 加 `adapterId` / `adapterVersion`（读 `0045` 的新列，**不依赖** N8 的 `case_material_report`）/ `reasonCode` / `progress` / `probe`；`case-parse.ts` 解析 `未识别=1` 并透传给 `材料视图`（+2 行）；批量上传显示「整体进度」（已处理 / 总数 + 当前阶段），不再是只有 `queueAhead`。

**完成判据**：上述红用例转绿；`bun test openhive-case-ingest-*.test.ts openhive-case-materials*.test.ts`（按实际文件名）绿；typecheck 绿。

### 第 2 组 · 清理与 A 类（M7、M6、C1）

1. **M7 派生存储登记**：把 N4 富化缓存（内存）、N7 开关留痕（审计表）、`case_material_report`（按材料历史）逐项写下清理 / 保留策略，写进 `data-model.md`；红用例：同一材料连续重跑两次，属性 / 别名 / 参与者行数不增长（TR-006）。
2. **M6 档案补列**：迁移 `0046` 加 `optional_headers` / `priority` / `rule_version` / `hints`；匹配仍 fail-closed（可选头只进报告 / 建档提示，**不参与命中**——FR-065 明确要求不改表头集合规则）；同分决胜改 `priority desc → id`。**不做格式缓存回写**（见 R2：`setMaterialFormatFingerprints` 本已覆盖所有工作表，`case-ingest.ts:781-791`；写 `case_table_format` 会让撤销的档案经缓存复活）。红用例：同 `priority` 多次跑结论恒定；可选头缺失仍命中；可选头多出来仍命中。
3. **M10 前移校验**：识别卡校验实现一份 `asset-service/src/ingest-gate.ts`（`adapter.json` schema、四件套、entry 存在、`attributeKeys` 在词表内）；发布闸接在 `service.ts` 既有 MCP 发布闸同处（`:830` / `:848`），新拒绝码在 `lifecycle.ts:173-201` 登记、在 `governance-assets.ts:838` 映射为 409；启用侧接在 `project-assets.ts` 抽出的启用内核里。A 类档案的字段映射 / 必需列校验追加在 `case-source-profile-store.ts` 既有建档写入路径上（不另写一条发布通道）。**必须先于 N1**。
4. **C1 档案前端**：`source-profile-api.ts` + `source-profile-view.tsx`，调既有三出口。

**完成判据**：重跑不叠加用例绿；档案扩展用例绿（含可选头不影响命中的反例）；坏包发布被拒并列出缺项；前端组件用例绿。

### 第 3 组 · 适配器主链（M10→N1→N2→N3→M2、M8、M9、N5、N9、C7、C2、N6、C5）

硬依赖逐条兑现（违反即返工）：
- **C7 先于 C2**：`是账户形状` 精准放宽 `@wx.tenpay.com`（不区分大小写），红用例先钉「属性挂上 + 户名别名挂上」，再动首个转换器。
- **M10 先于 N1**：坏包不许进注册表。
- **N1→N2→N3→M2 顺序**：注册表先能加载、探测能出结论、执行器能跑、最后才接作业链（M2 不得先接空注册表）。
- **M8 与 C2 同批**：转换器改列名 + 内核裸属性列防线。

1. **N1 注册表**：目录口径直接复用 `作业项目目录` + `SKILL_LINK_DIR` / `skillLinkPath`（`project-skill-link.ts`），技能集合来自 `usableSkillAssets`（`skill-availability.ts:80`，已含 `type='skill' AND status='published'` 与可见性），只在其落点上读 `adapter.json`——**不自己遍历 `.opencode/skill`、不自己判资产可见性**；缓存按目录签名（realpath + mtime + size）失效；不改 `skill/index.ts`。
2. **N2 探测**：**只跑表头闸**（`requiredHeaders` 全含，沿用 `匹配数据源档案` 的表头归一语义——抽成一份 `表头下标()` 给档案与适配器共用，`#002-06`）；值闸不在探测期跑，由作业链在转换器成功返回后读 `report.gates` 判定（Ruling X）；多命中按 `priority` 降序、打平按 `id` 字典序；报告列全部命中项。
3. **N3 执行器**：子进程、`cwd` = 技能目录（输出 `output.file` 也落在技能目录；运行前已存在即拒，只删本次新建的输出）、只读输入、默认 60s 超时、环境清理（不透传 `PG_*`）；运行时命令前缀白名单 `bun run` / `node`（与发布闸同一口径）；只认 §6.2 JSON。
4. **M2 作业链**：读表后先问注册表 ⇒ 命中 `kind: "converter"` 调执行器读 JSON；`kind: "rowRules"` 本期不执行（Ruling F/I：探测只收 converter，命中记 WARN 并按「未识别」处理）；转换器命中者构造一份与 `识别材料` 返回**同形状**的 `材料识别`，下游（`翻译资金` / 写入 / 按材料清理）零改动；转换成功返回后按转换器报告的 `report.gates` 判值闸（探测不跑值闸，值闸判据只有这一处，`#002-06`；Ruling X/AV）；失败落「有问题」+ 原因码，**不回退四层识别**。
5. **N8 前移**：转换完成后写 `case_material_report`，准入闸读报告（适配器 id / 版本 / SHA-256）；原件直入走旁路标记并在界面显示。**自动入队对外打开前必须就绪**（开发期用开关关闭验证）。
6. **N5 重跑**：`case-rerun-scan.ts` 用既有 `扫树`（`project-tree-scan.ts:69`，经 `project-tree.ts:161`）取目录集，算三类候选（目录有库没有 / 未入队 / 未识别），一个请求逐份调 `入队材料` 并返回汇总；已解析不自动重跑（`该走哪个动作` 兜底）。**「目录独有」必须按内容 sha256 对已有材料去重**——`createMaterial` 同内容重复上传会改写 `path`（`case-store.ts:96-111`），不去重会出现「旧路径永远是目录独有」的来回振荡；`扫树.truncated` 为真时如实报告，不得少报候选数（FR-040）。
7. **C2 首个转换器**：微信流水四件套（`SKILL.md` / `adapter.json` / `convert.ts` / `test/`）+ 金标准与变异样本（N9）。
8. **N6 / C5 前端**：三时刻提醒、失败重试按钮、启用后扫描弹窗。提醒的「已提醒 / 稍后」状态存 `localStorage`（FR-044 只要求同一份文件不重复提醒，不要求跨设备；不新建表，也不扩 `preferences` 的封闭键集，见 R12）。

**完成判据**：探测三态用例 + 确定性用例（同 priority 重复跑结论恒定）；转换器金标准全绿；C7 用例绿；裸属性列告警用例绿；重跑批量汇总与候选数一致的用例绿；真栈 5,000 行 ≤10 秒实测记录。

### 第 4 组 · 富化与准入开关（N4、N7、C3 收口）

1. **N4 富化**：键分类受控表（参考类 / 身份类 / 匹配类，未登记键 fail-closed 进身份类）；产键 → 每类一次批量查 → Map 回填；案件库一条 `unnest`；参考库内存缓存带版本；外部服务并发上限 + 超时 + 负缓存。
2. **N7 可信技能**：迁移 `0047`（项目开关表）、`0048`（平台白名单表）；白名单 `is_admin` 维护；项目开关属主；变更走 `记治理` 留痕。自动启用**不新写启用逻辑**：与人工「启用」共用 `project-assets.ts` 抽出的 `完整启用`（启用内核校验 + `asset-service` 的 `enableAsset`（含 `ENABLEMENT_LIMIT=20` 原子上限）+ `linkSkill` + 丢缓存 + 记治理，一条实现，`#002-06`）；白名单条目在启用前再判一次 `asset.status='published'`。
3. **C3 收口**：N8 的旁路标记在界面完整可见；「拒收结论拦住原件直入」验收。

**完成判据**：富化三类处置各有用例 + 「未登记键默认进待确认」变异变红（TR-013）；逐行查询语句数为 0；白名单 / 开关权限用例（成员 403、非属主 403、非管理员 403）；真栈富化 <1 秒实测。

### 收尾 · 门禁与真栈

1. 仓库根 `bun run typecheck`、`bun run lint`；受影响包 `bun test`（逐文件带 `timeout`）。
2. 真栈：拖入文件夹 → 1 秒探测 → 后台转换入库 → 属性可查 → 启用新转换器 → 扫描重跑 → 富化。
3. 验不了的（真实模型 A1/A2、100,000 行性能、20 份并发观感）写进缺口表，不写成已覆盖（`#004-03`）。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 新增 5 组迁移（`0045`–`0049`，每组 `.sql` + `.down.sql` 共 10 个文件） | 进度 / 原因码 / 作业适配器快照 / 探测结论 / 档案扩展 / 报告历史 / 两个开关都必须可查询、可重启恢复 | 塞进 `parse_detail` 会把「给人看的明细」与「运行中状态」混一处（§14 第 6 条裁定）；不落库则重启即丢，进度与筛选都做不了 |
| 转换器子进程（外部代码执行） | B 类逐行角色翻译无法用声明式规则穷尽，需求 D2 已定「内核调用适配器」 | 纯规则化会让每个新格式都改内核；沙箱 + 无凭据 + 超时 + 白名单已把风险面压到与 `governance-mcp-supervisor.ts` 同级 |
| 新增独立路由文件 + `server.ts` 挂载（import / 路由块 / worker 层） | 新出口 6 个（重跑 / 档案 / 开关 / 报告 / 白名单 / 筛选），继续堆进 `case-ui-routes.ts` 会把它变成第二个 `case-mcp-tools.ts` | 塞进既有文件只省一处挂载，却把 1,000 行文件再撑大，审查与冲突定位都变差；权限闸仍复用既有 `过门`，不复制第二份 |
| 探测独立 worker（第二个轮询循环） | FR-054 要求探测不排主转换队列 | 复用主 worker 会在 20 份排队时让探测等几十秒，直接违反 SC-001 |

## 已知风险

1. **M1 误伤普通上传**：`handleUpload` 是唯一落盘入口。对策：入口判据（`材料/` 目录 + 白名单扩展名 + 开关）三条件同时成立才入队；回归用例钉住「其他目录零变化」。
2. **探测 1 秒在超大文件上守不住**：`readSheets` 走 `XLSX.read` 整本解析（`case-sheet.ts` 刻意不用 `sheetRows`），100,000 行可能超过 1 秒。对策：探测只取 `maxSheets:1, maxRowsPerSheet:5`；1 秒承诺按典型文件（≤5,000 行）实测，超大文件写进缺口表，不放大承诺。
3. **探测与作业结论冲突**：探测先写 `probe`，作业后写 `parse_status`；视图以作业为准。变异用例：把探测结论直接当最终状态 ⇒ 必须变红（TR-012 第三条）。
4. **重跑叠加派生数据**：新派生存储（报告 / 富化缓存 / 开关留痕）必须逐项登记策略（第 2 组第 1 步），否则批量重跑会增长（M7）。
5. **档案与适配器同时命中**：适配器优先并记入报告（§12.6 M2 顺序）。
6. **组件假绿**：DOM「不存在」断言一律布尔比较（`#013-12`）；置灰按钮同时断言「不可点击」与「原因可见」（TR-010）。
7. **远端 PG 的 JIT**：真栈性能实测前确认 `jit = off`（`#013-11`），否则会把 JIT 编译时间误当 SQL 慢。
8. **组间倒挂**：材料视图（第 1 组）要显示适配器 id / 版本，若改读 `case_material_report`（第 3 组）等于让第 1 组等第 3 组。对策：`0045` 在 `case_ingest_job` 上落 `adapter_id` / `adapter_version`（R4）。
9. **规格内部冲突**：FR-004（重复拖入 = 重新入队）与 FR-042（已解析不自动重跑）字面互斥，US1 场景 2 还与上传口同名 400 冲突。对策：按 FR-042 裁定并把场景 2 拆成两张判据（有问题 ⇒ 作业 +1 / 已解析 ⇒ 不新增，均为换名同内容，R14）；`/speckit-tasks` 前若用户不认可该裁定，需先改 spec 再拆任务。
10. **内容寻址导致的路径漂移**：同内容重复上传会改写 `path`（`case-store.ts:96-111`），扫描若不按 sha256 去重，「目录独有」会在新旧路径之间来回振荡。对策：R9。

## 交付后仍存在的缺口（不伪装成已覆盖）

- 其它支付账号形状（支付宝邮箱等）仍不满足账户形状；其行上的属性与户名别名会被丢弃。
- 真实模型识别 A1 / A2 本机不可验，只登记不关闭。
- 100,000 行性能只有实测记录，无阻塞阈值。
- 20 份并发观感：单 worker 顺序消费，只承诺「队列位置可见」，不承诺并发提速。
- 跨项目共享数据源档案不在本期（档案仍项目级）。

## 二轮复核裁定（2026-11-19）

> 按「先复用、后新建」逐条回源码核对后落定的 16 条。每条给出证据，实现期按此执行；若发现证据过时，先更新本条再改代码（`#003-04`）。

**R1 · M1 的 `by` 从哪来**：`gate` 拿到 `User.Service` 只是为了判「有没有登录」，随后**丢弃**了 user（`file.ts:593-604`，`const user = …; if (Option.isNone(user)) return unauthorized();` 之后只返回 directory）。裁定：在 `handleUpload` 内再取一次 `Effect.serviceOption(User.Service)` 得 userId，**不改** `gate` 的签名——它被 10 个 handler 共用，改签名等于把 M1 的冲突面扩散到整个文件。

**R2 · M6 「档案命中也要写格式缓存」是过时前提（删除）**：现状 `setMaterialFormatFingerprints` 对**所有工作表**无条件写（`case-ingest.ts:781-791`），档案分支跳过的只是 `case_table_format`（`:548` 的「档案命中：不重写格式缓存」）；「只被档案命中的材料无法再建档」那个 400 已由 commit `92c8e1252a`（2026-11-15）在 `case-source-profile-store.ts:248-270` 用「回落到命中档案」修掉。裁定：M6 **不追加任何缓存写入**——解析顺序是「档案 → 格式缓存 → 四层 / 模型」（`case-ingest.ts:453-477`），档案先被读；一旦档案被撤销、不再命中，缓存行就成了唯一来源，等于用撤销的映射继续解析（FR-059 一族）。M6 只补 4 列 + `priority` 决胜 + `rule_version` 入报告。`data-model.md` 与 `quickstart.md` 的对应文字同步删除。

**R3 · M8 落在 `case-mapping.ts`，不在 `case-translate.ts`**：裸列被判成对手/本方账号发生在映射层——`对手修饰 = /对方|对手|交易对方|收方|付方/`、`本方修饰 = /本方|查询|客户|本人/`（`case-mapping.ts:142-153`）配上 `合成词长`（`:162-175`，注释里叫「合成候选」），所以「对方银行卡号」先被 `修饰语放行` 放过、再被 `合成词长` 认领；`case-translate.ts:320-352` 只遍历 `extras` 里以 `属性:` 开头的键，错不在它。裁定：M8 改 `case-mapping.ts` 的两处判据，`case-translate.ts` 不动。

**R4 · M4 的 `adapterId` / `adapterVersion` 必须有来源**：`case_ingest_job` 现只有 `(id, project_id, material_id, status, attempts, queued_by, queued_at, started_at, finished_at, error, source_path, template_id)`（`0031_case_fact_layer.sql:312-329`、`0032:54`、`0044:17`），没有适配器列。裁定：`0045` 一并加 `adapter_id` / `adapter_version`，材料视图读「最近作业」的这两列；**不**让材料视图去读 `case_material_report`——那张表在本计划里属于第 3 组（N8），第 1 组不能依赖它。报告仍按 FR-058/060 冻结当时版本，两者分工是「最新运行 vs 历史快照」。

**R5 · 给新查询形状补索引**：材料视图取「最近作业」是 `distinct on (path)`（`case-materials.ts:43-128`），需要 `case_ingest_job (project_id, material_id, queued_at desc, id desc)`；探测认领是 `parse_status='排队中' and probe is null`，需要 `case_material` 上的部分索引。两条都进 `0045`（后者随 `probe` 列同组），否则 5,000 材料时每轮轮询全表扫。

**R6 · N1 不复刻目录遍历与资产可见性判定**：技能包的落点本来就是 `SKILL_LINK_DIR = join(".opencode","skill")` + `skillLinkPath(projectDir, assetId)`（`asset-service/src/project-skill-link.ts`），可用集合已有 `usableSkillAssets`（`skill-availability.ts:80`，含 `type='skill' AND status='published' AND visibility<>'personal'`）。裁定：注册表在这两个既有符号上读 `adapter.json`，**不**自己 walk `.opencode/skill`、**不**自己判「哪些技能可用」——那会与启用/发布规则形成第二份真相。

**R7 · 表头判据只一份，`priority` 不参与命中**：`匹配数据源档案` 已有「表头归一 + 集合包含 + 有效列数<2 拒 + 前两名同分不猜」完整体（`case-source-profile.ts:46-119`）。裁定：抽 `表头下标()` 一份给档案与适配器共用（`#002-06`）；`priority` 只作用于**排序决胜**，不改包含式判据——否则 FR-065（MUST NOT 改变数据源档案的表头集合匹配规则）当场被破坏。

**R8 · 适配器命中要伪装成 `材料识别`**：下游（翻译、写入、按材料清理）只认 `材料识别` / `工作表识别`（`case-recognize.ts` 的 `识别材料(输入)` 返回值）。裁定：适配器命中后构造同形状结果，下游零改动；值闸判据只取转换器报告的 `report.gates` 一份（探测不跑值闸，Ruling X/AV），不各写一份。

**R9 · N5 复用 `扫树`，但必须按内容去重**：目录扫描已有 `扫树`（`project-tree-scan.ts:69`，`默认上限 50000`、`默认并发 4`、返回 `truncated`），经 `project-tree.ts:161` 的 Effect 桥调用。裁定：N5 用它取路径，**再按 sha256 排除已有材料**——因为 `createMaterial` 是「同内容 upsert 并改写 `path`」（`case-store.ts:96-111`），材料换了路径后旧路径会一直显示为「目录独有」，形成来回振荡；`truncated=true` 时必须如实告知，不得少报 N（FR-040）。

**R10 · M10 挂 `asset-service` 的发布闸，不挂 `project-assets.ts`**：发布校验的既有位置是 `service.ts:830` / `:848`（「MCP 发布闸门」），拒绝码在 `lifecycle.ts:173-201`（`TransitionErrorCode`），到 HTTP 的映射在 `governance-assets.ts:838`，覆盖 `publish_tech` 与 `publish_iteration` 两条发布路径；`project-assets.ts` 只管「启用 / 停用」。裁定：校验实现落 `asset-service/src/ingest-gate.ts` 一份，发布闸调用它；启用侧把 `handleToggle`（`project-assets.ts:885-930`）里的校验序列抽成导出函数（成员→属主→类型→已发布→非个人→可读→落点存在），自动启用复用同一序列，不复制。

**R11 · 路由层复用 `过门`**：`case-ui-routes.ts:157` 的 `过门(deps, projectId, {要属主?, …})` 是本仓项目内出口的统一权限闸，但**未导出**。裁定：加 `export`（含 `Deps` / `PREFIX`），新路由文件直接 import；实现零改，不复制一份权限判断（`#005-24`）。

**R12 · N6 的「已提醒 / 稍后」不落库**：`preferences` 是**封闭键集**（`preferences.ts:55-105` 的 `值合法` 只认 `asset.pageSize` 一类），为提醒状态扩键集等于把「用户偏好」变成「按文件的状态表」。裁定：存前端 `localStorage`——FR-044 只要求同一份文件不重复提醒，没有跨设备要求；不新建表、不扩键集。

**R13 · 迁移成对**：本仓每组迁移都是 `.sql` + `.down.sql`（`0035`–`0044` 均配）。裁定：`0045`–`0049` 共 10 个文件，`down` 必须能把加列/建表/加索引完全撤回（含 `0045` 的部分索引）。

**R14 · 规格内部有两处冲突，按「FR-042 + FR-065」裁定（待用户确认）**：

- **冲突 A（FR-004 vs FR-042）**：FR-004「同内容指纹 MUST NOT 建第二条材料，重复拖入 MUST 视为对已有材料的重新入队」 vs FR-042「已解析材料 MUST NOT 自动重跑」；US1 Independent Test / 场景 2 还要求「同一文件再拖一次，作业新增一次，材料条数不变」。
- **冲突 B（US1 场景 2 vs FR-065/现状）**：`handleUpload` 对同目录同名文件直接 400（`exists` 分支，`file.ts:826-868`），而同路径再拖只有这一个出口；要让它「再入队一次」就得改上传语义，而 FR-065 明写 MUST NOT 改变普通文件上传行为。**字面上的「同一文件再拖一次」在本 feature 范围内不可达。**
- **现状证据**：`该走哪个动作`（`case-ingest.ts:108-129`）按当前状态决定动作——未入队 ⇒ 排队；有问题 / 已跳过 ⇒ 重新解析；已解析 ⇒ 只在 `force` 时重新解析；排队中 / 解析中 ⇒ 不动作。所以「重复拖入 ⇒ 作业 +1」只在材料处于**未入队 / 有问题 / 已跳过**时成立，已解析不成立（这正是 FR-042 要的）。
- **裁定**：① 同内容重复拖入一律走 `createMaterial` 指纹 upsert，材料恒为一条（本就是现状，无需改代码）；② 是否新增作业交给 `该走哪个动作`，**不在上传口另写判断**；③ US1 场景 2 的判据改为两张：**有问题材料换名同内容再拖 ⇒ 作业 +1**、**已解析材料换名同内容再拖 ⇒ 作业不新增、状态仍已解析**；④ 同名同路径的 400 保持现状，不在本 feature 改。
- **需确认**：若用户认为「拖入」本身就是 FR-042 说的「人工显式触发」，则应改为「已解析材料重复拖入也重跑」，但那样就必须先改 FR-065（上传行为）或另开一个「同名覆盖」入口——这是一次范围扩张，不能悄悄做。`/speckit-tasks` 写用例前需要用户在这两种读法里选一个。

**R15 · 文档笔误**：`ohive-case-materials*` → `openhive-case-materials*`；「14 个技术裁法」→ 15（research 是 D1–D15）；「只加 2 行」→ 1 import + 1 路由块 + 1 worker 层块。已改。

**R16 · 010 的「数据源配置」与本 feature 的「数据源档案」不是同一实体**：`governance-data-source.ts` / `packages/app/src/governance/data-source.tsx` 是**平台级**数据源连接与血缘（`@opencode-ai/auth/data-source`，仅系统管理员），本 feature 的 `case_source_profile` 是**项目级**表头映射档案。裁定：不合并、不复用、命名不互借；前端入口分别放 `project/` 与 `governance/`。
