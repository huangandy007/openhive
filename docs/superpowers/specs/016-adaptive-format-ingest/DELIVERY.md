# 016 交付说明：数据格式自适应与自动入库

**分支**：`016-adaptive-format-ingest`（基线 `multi-tenant@34c8cb65e2`）
**体量**：59 提交 / 124 文件 / +17904 −386（含规格文档、源码、测试与迁移）
**范围**：需求文档 §6 的自适应识别、自动入库、失败说清、批量补全、报告与重跑、可信技能
**状态**：任务全部完成；整分支 review 的 17 个修复提交已收口（见 §5）；未满足需求与待裁定项见 §6。

---

## 1. 交付清单（按用户故事）

| 故事 | 交付物 | 主要文件 |
|---|---|---|
| **US1 拖入一个文件夹，剩下的交给系统** | 上传落在 `材料/` 且扩展名可解析 ⇒ 自动入队；项目级开关（默认代开）；材料列表按解析状态可筛 | `server/openhive/file.ts`（`自动入队`）、`case-ingest.ts`（`enqueueMaterial` / `claimNextJob`）、`case-ingest-worker.ts`（500ms 轮询单 worker）、`case-ingest-settings.ts`、`app/src/project/file-tree.tsx` |
| **US2 系统自己认格式，用户不选 skill** | 识别卡注册表（目录签名缓存）+ 探测 worker（只跑表头闸）+ 发布/启用校验（四件套、字段规则、`entry` 白名单、属性键受控词表、id 唯一） | `case-adapter-registry.ts`、`case-adapter-probe.ts`、`case-probe-worker.ts`、`case-converter-runner.ts`、`asset-service/src/ingest-gate.ts`、`assets.ts` / `project-assets.ts`（发布闸） |
| **US3 开户行、银行卡号问得到，还带出处** | 键分类受控表（参考/身份/匹配，未登记 fail-closed 进身份类）；产键归一化；观察去重含出处；每类一次批量查 + 案件库一条 `unnest`；参考库带版本缓存 | `case-enrich.ts`、`case-field-registry.ts`、`case-attribute-registry.ts`、`case-reference-store.ts` |
| **US4 没解析成，也要说清为什么** | 原因码闭集 + `parse_detail`（reason/progress）；值闸在转换器成功后按 `admission.checks/thresholds` 判；material report（gates/命中项/落选者/旁路标记） | `case-ingest.ts`（`runJob`）、`contracts/reason-code-contract.md`、`case-material-report.ts`、迁移 `0045` / `0049` / `0050` |
| **US6 缺的值批量补全，不逐行查库** | 富化三类处置 + 逐行查询语句数为 0 的批量实现 | `case-enrich.ts`、`case-reference-store.ts` |
| **US7 每份材料的报告与版本可回滚** | 按内容查最新报告；报告行 append-only（同 jobId 二写抛错） | `case-material-report.ts`、迁移 `0049`（`case_material_report`）、`0050`（`matches`） |
| **US8 可信技能免确认** | 平台白名单（`is_admin` 维护）+ 项目开关（`auto_enable_trusted` 默认**关**）+ 上传触发自动启用（与人工启用**共用一份** `完整启用`） | `case-trusted-skill.ts`、`governance-trusted-skill.ts`、迁移 `0047` / `0048`、`project-assets.ts`（`完整启用`）、`app/src/project/case-ingest-settings.tsx`、`app/src/governance/trusted-skill-manage.tsx` |
| **US5 启用技能后，旧文件一键重跑** | 重跑候选扫描（排除产物行、同一 path 只认最新行）+ 重跑弹窗 + 文件树入口按钮 | `case-rerun-scan.ts`、`app/src/project/case-rerun-dialog.tsx`、`app/src/project/file-tree.tsx` |
| 数据源档案 | 档案构建/撤回 + 档案视图（属主可编辑，成员只读，空态有提示） | `case-source-profile.ts` / `case-source-profile-store.ts`、迁移 `0046`、`app/src/project/source-profile-view.tsx` |

## 2. 关键实现细节

1. **一份启用实现**（`#002-06`）：`project-assets.ts` 导出 `完整启用(deps, userId, projectId, assetId)` = 启用内核校验 → `enableAsset`（20 上限）→ `linkSkill` → 丢缓存 → 记治理。人工开关与自动启用**都调它**；审计 `asset.enable` 只在真新增（`enabled`)时写，`already_enabled` 仍修链接但不留痕（避免成员上传伪造「属主启用」记录）。
2. **属主归因 fail-closed**：上传链的自动启用用 `ownersOf` 取项目属主；**没有属主行就不启用**（不拿上传者顶替）。属主开开关即授权，成员上传不获得任何权限——`启用内核` 仍按属主身份判可视/可读，403 计失败不启用。
3. **适配器契约**：`adapter.json` 两种 kind——`converter` 走子进程执行器（`entry.command` 白名单前缀、cwd = 技能目录、固定输出文件）；`rowRules` 本期**只接受结构不执行**（Ruling F/I），探测只收 converter，rowRules 表头命中记一行 WARN。探测只跑表头闸，值闸由作业链读 `report.gates` 判定。
4. **转换器输出契约**：一个 JSON 文件含 rows + report；`startedAt` 存在但非有限数字 ⇒ `失败:转换器异常`（不再静默 NULL）；`rows` 为空 ⇒ 在任何删旧行之前失败（不清空既有事实）。
5. **注册表缓存**：目录签名 = 每份卡片 `realpath + mtimeMs + size`，键 = `realpath(项目目录)`；任何把签名简化成「目录级 mtime 汇总」的改动都会让跨用户可见性泄漏（禁止）。
6. **前端挂载**：`CaseIngestSettings` / `CaseRerunDialog`（+ file-tree 「扫描 / 重跑」按钮）/ `SourceProfileView` 挂进 `workspace-entry.tsx`；`TrustedSkillManage` 挂进治理台 `asset-governance`（四层透传，`isAdmin` 取会话身份）。`WorkspaceEntry` 提供**可选**注入缝（`caseIngestApi` / `sourceProfileApi`），生产不传、测试注入桩以保持组件测试离线。
7. **`CaseSkillHint` 未挂载**：三条硬阻塞（无 category 分类器 / 无「未识别份数」信号 / 「提交格式需求」后端零出口），按 Ruling BS park，属新功能。

## 3. 数据模型与迁移

`0045` 探测原因与进度列 · `0046` 数据源档案优先级 · `0047` 项目入库开关 · `0048` 平台可信技能白名单 · `0049` 材料报告 · `0050` 报告命中项。
所有新建表均为 `auth.*`，随既有迁移链一起版本化；真 PG 见证表清单（`migrate.real-pg.test.ts`）已同步到 61 张。

## 4. 验证（实跑输出，非转述）

```
bun run typecheck（仓库根）                      ⇒ EXIT 0，32 successful, 32 total
packages/opencode 5 个受影响测试文件             ⇒ 172 pass / 0 fail / 902 expect
packages/app 9 个组件测试文件（--conditions=browser）⇒ 489 pass / 0 fail / 1268 expect
lint:openhive                                    ⇒ 1226 warnings / 0 errors，EXIT 0
后端改动源文件 oxlint                             ⇒ 4 warnings / 0 errors（全部为既有行）
adapter-registry + adapter-publish               ⇒ 18 pass / 0 fail
git diff --stat bun.lock                         ⇒ 空
```

## 5. 整分支 review 与修复

首轮 5 个 reviewer 并行（spec 一致性 / TDD 真实性 / 功能链路 / 遗漏链路 / 代码质量），范围 `34c8cb65e2..62a8b6f251`；按严重度修 17 个提交（`62a8b6f251..b156bdb1c8`）：

- **Critical**：K2 自动启用零接线（US8 场景 2 不可能发生）→ 接线并共享 `完整启用`；K3 五个前端组件零生产 import → 挂 4 个；K1/I5 spec 与实现关于 rowRules 的口径矛盾 → 文档改口。
- **数据完整性**：K4① `startedAt` 静默 NULL、K4② 0 行仍判「已解析」并清空旧事实 → 均改为 fail-closed。
- **断言可信度**：I9 物化断言被内嵌 CTE 满足的假绿 → 收紧为钉具体 CTE 名；I12 真 PG 表清单缺项 → 补齐。
- **审计污染**：`already_enabled` 也记 `asset.enable` → 只在真新增时记。
- **测试真实性**：补「无属主 fail-closed」、幂等链接修复（用生产出口 `unlinkSkill` 删链接再重建）、`file-tree` 重跑入口按钮、注入缝离线断言、无角色仍置灰等用例；每条行为改动均做「先红 → 绿 → 变异」。
- **门禁口径修正**（Ruling BT）：`lint:openhive` 只扫 `packages/app/src` 九个目录，**不覆盖后端**；后端改用逐文件 `oxlint`。

## 6. 未满足需求与待裁定（交产品）

| 项 | 状态 |
|---|---|
| **FR-011** rowRules 由内核执行 | 本期**未实现**（需求只给一条无语法示例字符串）；结构接受 + 执行期按「未识别」处理 + WARN |
| **FR-043~046** 案件技能提醒（`CaseSkillHint`） | 未交付：缺 category 分类器、缺未识别份数信号、FR-046「提交格式需求」后端零出口 |
| **FR-056 / 属性人工确认入口** | 不存在（`parse_detail.mapping` 只落库），属新 feature |
| **K5** 注册表候选不要求项目启用 | 待裁定：任何已发布可读 skill 都能当适配器执行，与 FR-047 保障面不符；建议 fail-closed（候选再过 `enabledAssetIds`） |
| **自动启用与入队竞态** | 待裁定：自动启用晚于入队，worker 可能在 `linkSkill` 前认领 ⇒ 「未识别:无匹配适配器」且无重探；建议移到入队之前（当前无确定性用例，Ruling BY） |
| FR-063 / I4 / I10 / I11 | 按已有留痕认定 / spec 无硬要求 / PGlite 测不出 / 环境缺口（见 §7） |

## 7. 缺口（本机未验，如实记录）

- 真 PG 迁移用例未跑：`withRealPg` 要求 `PG_DATABASE` 以 `_test` 结尾且会 DROP SCHEMA，远端只有 `openhive_dev`。
- `packages/asset-service` 测试本机 EXIT 124（超时）。
- `bunx tsc -p packages/app` EXIT 2：29 个 `Uint8Array<ArrayBufferLike>` 错误，全在未触碰的既有测试文件。
- 仓库根 `bun run lint` EXIT 1：既有 error 在 `session-ui/src/v2/components/prompt-input/index.tsx:163`，与本分支无关。
- worker 认领时序 / 多 worker 并发无用例（PGlite 单会话）。
- 真栈验收 AC-2/3/8/9 未验（`D:/assets` 无 `adapter.json` 资产）；AC-1「1 秒内」字面未达（1–5s）。
- `WorkspaceEntry` 无路由级用例：挂载正确性由组件级用例 + 定向复审覆盖。
