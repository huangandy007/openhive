# 契约：HTTP 出口（新增 / 变更）

**来源**：spec FR-038 / FR-040 / FR-041 / FR-047 / FR-048 / FR-057 / FR-060；需求 §12.4 C1。
**落点**：新出口集中在新文件 `case-ingest-routes.ts`（形状照 `case-fact-routes.ts` / `case-ui-routes.ts` 的 `HttpRouter.use` + `router.add`）；平台管理员白名单出口放 `governance-trusted-skill.ts`（前缀 `/openhive/governance`）。既有出口只**加字段**，不改语义。

> 通用约定（与既有 openhive 路由一致）：身份走 `User.Service`（cookie）；项目内出口先判 `成员角色`，非成员 403；错误体 `{error, code?}`；成功 200 JSON。

---

## 1. 变更：`GET /openhive/case/materials`

现有响应 `{ materials: [...], parseableExtensions: [...] }`（`case-parse.ts:33`）。`materials[]` 每行**新增**：

| 字段 | 类型 | 数据来源（列） | 说明 |
|---|---|---|---|
| `adapterId` | `string \| null` | `case_ingest_job.adapter_id`（`0045` 新增） | 最近作业实际采用者 |
| `adapterVersion` | `string \| null` | `case_ingest_job.adapter_version`（`0045` 新增） | 同上 |
| `reasonCode` | `string \| null` | `case_ingest_job.reason_code`（`0045` 新增） | 最近作业的结构化原因码（六值之一或 null） |
| `progress` | `object \| null` | `case_ingest_job.progress`（`0045` 新增） | 最近作业进度（`{阶段, 已处理?, 总数?, 更新时间}`） |
| `probe` | `object \| null` | `case_material.probe`（`0045` 新增） | 探测结论（`{状态, 适配器id?, 版本?, 原因码?, 完成秒?}`） |

> 全部读 `case_ingest_job` / `case_material`，**不读** `case_material_report`——材料视图属于第 1 组，报告表属于第 3 组（N8），组间不得倒挂依赖。

新增查询参数：

| 参数 | 取值 | 语义 |
|---|---|---|
| `未识别` | `1` | 只返回最近作业 `reason_code LIKE '未识别:%'` 的材料（FR-038） |

兼容：不带参数时行为与现在一致；`status` 仍是六态闭集取值。`未识别=1` 的解析落在 `case-parse.ts` 的 handler（+2 行透传给 `材料视图`），不改 `PREFIX` / `PATH` 常量。

**权限闸**：本出口与其余项目内出口共用 `case-ui-routes.ts:157` 的 `过门`（需加 `export`），不复制一份成员判断。

---

## 2. 新增：`GET /openhive/case/ingest/scan?projectId=…`

只读扫描，返回候选集（FR-039/040）：

```json
{
  "合计": 12,
  "候选": {
    "目录独有": [{ "path": "材料/微信流水.xlsx" }],
    "未入队": [{ "materialId": "m1", "path": "材料/话单.csv" }],
    "未识别": [{ "materialId": "m2", "path": "材料/资金.xls", "原因码": "未识别:无匹配适配器" }]
  },
  "样本": ["材料/微信流水.xlsx", "材料/话单.csv"]
}
```

- `合计` 必须与实际候选数一致（FR-040）。
- 只扫项目 `材料/` 目录（D2 的同一口径），不递归其他目录；扫描实现复用 `project-tree-scan.ts` 的 `扫树`。
- 「目录独有」按**内容 sha256** 对已有材料去重：同内容材料被 `createMaterial` 改写过 `path`（`case-store.ts:96-111`）时，旧路径不得一直报成候选。
- 扫描上限触顶（`扫树.truncated`）时响应带 `"截断": true` 与已扫数量，如实告知，不得少报 N。
- 已解析材料**不**进候选（FR-042）。
- 权限：项目成员（`过门`）。

## 3. 新增：`POST /openhive/case/ingest/rerun`

体：

```json
{ "projectId": "p1", "范围": ["目录独有", "未入队", "未识别"] }
```

- 一个请求完成批量入队并返回汇总（FR-041），服务端逐份调既有 `入队材料`（幂等按内容指纹）。
- 响应：

```json
{ "已入队": 10, "跳过": [{ "path": "…", "原因": "已解析" }], "失败": [{ "path": "…", "原因": "…" }] }
```

- 已解析材料即使出现在请求里也必须跳过（FR-042 双重防线）。
- 权限：项目成员（与既有 `POST /openhive/case/parse` 的入队动作同口径）。

## 4. 新增：`GET /openhive/case/ingest/report?projectId=…&materialId=…`

返回该材料**最新一份**报告（FR-057）：

```json
{ "report": { "adapterId": "…", "adapterVersion": "…", "ruleVersion": "…", "sourceSha256": "…",
              "gates": [], "warnings": [], "skippedRows": [], "enrich": {}, "admission": {}, "createdAt": 1730000000 } }
```

再加 `&历史=1` 返回全部（按 `createdAt` 降序，FR-060：历史报告保留当时版本）。权限：项目成员。

## 5. 新增：项目开关

`GET /openhive/case/ingest/settings?projectId=…` →

```json
{ "autoEnqueue": true, "autoEnableTrusted": false, "updatedAt": 1730000000 }
```

`POST /openhive/case/ingest/settings`，体 `{ "projectId": "p1", "autoEnqueue"?: boolean, "autoEnableTrusted"?: boolean }`：

- 权限：**项目属主**（成员 403；非属主 403）。
- 变更写 `记治理`：`action: "case.ingest_settings"`，`detail` 含改前 / 改后（FR-048 留痕）。
- 响应返回更新后的完整设置。

## 6. 新增（平台管理员）：可信技能白名单

前缀 `/openhive/governance`，三个出口：

| 方法 / 路径 | 语义 |
|---|---|
| `GET /openhive/governance/trusted-skills` | 列表（含资产名 / 状态 / 加入人 / 时间） |
| `POST /openhive/governance/trusted-skills` | 体 `{ "assetId": "…" }`；只允许 `type=skill` 且 `status=published` |
| `POST /openhive/governance/trusted-skills/revoke` | 体 `{ "assetId": "…" }` |

- 权限：`user.is_admin`（服务端判；非管理员 403）。
- 变更写 `记治理`：`action: "case.trusted_skill.add"` / `"case.trusted_skill.revoke"`。
- 自动启用走既有 `asset-service` 的 `enableAsset`（`enablement.ts`，含 `ENABLEMENT_LIMIT=20` 原子上限），不新建启用通道；白名单条目在启用前再判一次 `status='published'`。

## 7. 不变（明确不改）

| 出口 | 裁定 |
|---|---|
| `POST /openhive/case/parse` | 单文件人工动作原样保留（§14 第 5 条）；批量重跑走新出口 |
| `POST /openhive/file`（上传） | 路径、参数、响应形状不变；**行为**只增加「落在 `材料/` 且开关开 ⇒ 入队」 |
| `GET /openhive/case/source-profiles` / `POST .../source-profile/build` / `.../revoke` | 原样；发布校验在服务端内部加强，出口形状不变 |

## 8. 前端触点（客户端约定）

| 客户端文件 | 调用的出口 |
|---|---|
| `packages/app/src/project/case-materials-api.ts` | 1（加字段） |
| `packages/app/src/project/source-profile-api.ts` | 既有三出口 |
| `packages/app/src/project/case-rerun-dialog.tsx` | 2 / 3 |
| `packages/app/src/project/case-ingest-settings.ts` | 5 |
| `packages/app/src/governance/trusted-skill-api.ts` | 6 |
| `packages/app/src/project/case-skill-hint.tsx` | —（展示型；提醒状态存 `localStorage`，不新增出口、不扩 `preferences` 键集） |
| `packages/app/src/ai-assets/enable-api.ts` | 既有启停接口（不新增） |
