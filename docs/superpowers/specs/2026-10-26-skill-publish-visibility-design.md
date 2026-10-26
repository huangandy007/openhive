# Skill 发布范围（发布时选定可见范围）· 设计

- **日期**：2026-10-26
- **状态**：设计已与用户谈定（Q1 谁选 / Q2 谁的部门 / Q3 能否改），待评审
- **关联**：010 治理后台「技术发布审核」；009 Skill 生命周期与存储布局
- **前置（已实现，工作区未提交）**：把存储层的裸 `Error` 翻成 `personal_asset_not_shared` → HTTP 409（见 §1.2）

## 1. 为什么改

### 1.1 现象

民警把一份自己写的 skill 提交审核、业务关通过后，在治理后台点「发布」：

```text
POST /openhive/governance/assets/asset_15c2d13f-…/transition  500 (Internal Server Error)
```

修复错误翻译后变成 409：

```text
个人资产不进入共享空间：asset_15c2d13f-…（需先把可见范围改为部门 / 全局）
```

提示本身没错，但**用户没有可走的路**——这正是本设计要解决的产品缺口。

### 1.2 根因（已实测）

| 事实 | 证据 |
|---|---|
| 可见范围只在**创建时**由 MCP `create_skill_draft` 写入，默认 `personal` | `packages/asset-service/src/governance.ts:140-144`；`service.ts:199` |
| 创建之后**没有任何改可见范围的入口**（前端只读展示） | `packages/app/src/ai-assets/asset-detail.tsx:239`、`asset-card.tsx:57` 只渲染徽章 |
| 发布动作不带范围参数 | `governance.ts:109-121`；`lifecycle.ts` 的 `publish_tech` 只有 `storage: "move_pending_to_publish"` |
| `personal` 没有共享发布目录，`publishDirectory` 直接抛错 | `packages/asset-service/src/storage.ts` 的 `PersonalAssetDirectoryError` |
| 案例资产：`status=pending_tech, visibility=personal, department=x` | PostgreSQL `auth.asset` 实测（2026-10-26 21:50）；pending 目录仍在 `D:\assets\pending\asset_15c2d13f-…` |

### 1.3 用户的原始意图

> 「我个人的 skill，我要发布给全局或是本单位使用。」

即：**发布 = 决定给谁用**。当前模型却把「给谁用」锁死在创建那一刻，且默认值是个人。

## 2. 已谈定的语义

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 范围由谁、在哪一步定 | **发布这一步由发布者（system_admin）选**，与状态变更同一次提交；作者创建时的选择降级为「默认值 / 意图记录」 |
| Q2 | 「本部门」是谁的部门 | **资产元数据里的 `department`（创建时取作者档案）**，发布者不手选部门 |
| Q3 | 作者已选共享范围时发布者能否改 | **能改**；发布者最终决定，变更记进同一条审计 |

### 规则

1. 预选：资产当前 `visibility` 是 `department` / `global` ⇒ 弹窗预选它；
2. 资产当前是 `personal` ⇒ **无默认、必须选一个共享范围**才能发布；
3. 发布范围只允许 `department` / `global`；显式传 `personal` ⇒ 400；
4. 选 `department` 且资产 `department` 为空 / 空白 ⇒ 409 `department_missing`，文案要求改选全局或先补部门；
5. 不传范围且资产是个人 ⇒ 保持 409 `personal_asset_not_shared`（直连 API / MCP 的兜底）；
6. 非发布动作（`approve_business` / `take_offline` 等）带了 `visibility` ⇒ 400 `visibility_not_applicable`（不静默忽略）。

## 3. 错误码

| 错误码 | HTTP | 触发条件 | 文案要点 |
|---|---|---|---|
| `personal_asset_not_shared`（已有） | 409 | 个人资产发布且未传范围 | 个人资产不进入共享空间，请选择发布范围 |
| `department_missing`（新） | 409 | 选本部门，但资产 `department` 为空 | 该资产没有部门信息：请发布为全局，或先补部门 |
| `visibility_not_applicable`（新） | 400 | 非发布动作带了 `visibility` | 动作 X 不支持可见范围 |
| 路由 / 工具层校验（不经领域码） | 400 | 范围值不在闭集，或显式传 `personal` | `未知可见范围：x` / `发布范围必须是部门或全局` |

`映射错误()`（`packages/opencode/src/server/openhive/governance-assets.ts:346-369`）增加两条 409 / 400 的映射；审计 `detail` 增 `visibility`。

## 4. 契约

| 层 | 文件 | 改动 |
|---|---|---|
| 领域入参 | `packages/asset-service/src/service.ts` | `TransitionAssetInput` 增 `visibility?: AssetVisibility` |
| 领域错误码 | `packages/asset-service/src/lifecycle.ts` | `TransitionErrorCode` 增 `department_missing`、`visibility_not_applicable` |
| 元数据写入 | `packages/asset-service/src/asset.ts:287-308` | `AssetLifecycleUpdate` 增可选 `visibility`；同一条条件 UPDATE 里用 `coalesce` 写入（部门在这一步不变，不写） |
| HTTP | `packages/opencode/src/server/openhive/governance-assets.ts` | body 收 `visibility`；闭集校验；审计 detail |
| MCP 工具 | `packages/asset-service/src/governance.ts:109-121` | `publish_skill` 增可选 `visibility`（枚举 department / global），与 HTTP 同一套领域规则 |
| 前端 | `packages/app/src/governance/asset-api.ts` | `transition()` 载荷增 `visibility?` |
| 前端 UI | `packages/app/src/governance/asset-governance.tsx` | 发布弹窗加范围单选（见 §6） |

**兼容性**：不传 `visibility` 时行为与今天完全一致——资产是部门 / 全局就照旧发布，是个人就照旧 409。现有测试无需改写。

## 5. 存储与原子性

```text
读资产 → 授权 → 状态机 → 解析目标范围（新）→ 校验部门（新）
      → prepareStorageStep(生效后的 metadata) → 条件 UPDATE（status + visibility）
      → commit 文件搬迁 → 写站内信
```

- **目标目录用生效后的 metadata 算**：`publishDirectory(root, type, {visibility: 目标范围, department}, id)`。personal 从此不会走到这里；`PersonalAssetDirectoryError` 退化为最后一道防线（直接调存储层的路径仍受保护）。
- **同一条 UPDATE**：`status`、`version`、`published_at`、`visibility` 一起写，条件仍是 `where id = ? and status = ?`（`asset.ts:296-305`）。状态与范围在同一行，不存在「范围改了但没发布」的中间态。
- **并发**：两个管理员同时发布、选了不同范围 ⇒ 先到先得；后者条件更新落空 ⇒ `concurrent_transition`（409），文件按现有逻辑回滚，不覆盖前者的范围。
- **失败边界**：文件搬迁失败 ⇒ 按现有 catch 分支回滚文件；库中状态与范围已同事务落定，不会半截。
- **通知**：不变；文案仍是「发布后进入共享空间」。

## 6. 界面

技术发布审核页的「发布 / 发布新版本」弹窗（`asset-governance.tsx:80-82,110`）：

- 正文保留现有说明，追加一组单选：**本部门 / 全局**；
- 预选规则同 §2；个人资产打开时两项都不选，并显示提示「这份资产当前是个人可见，请选择发布范围」；
- 未选时「发布」按钮 `disabled`；
- 选「本部门」时展示将落到的部门名（来自资产 `department`），让发布者看得见落点；
- 请求成功后列表刷新，卡片 / 详情原本就渲染 `visibility`，无需新组件。

## 7. 测试与验收

### 领域（`service.test.ts` / `governance.test.ts`）

| 用例 | 期望 |
|---|---|
| 个人 + `visibility=department` | 成功；`status=published`、`visibility=department`；文件在 `department/<dept>/<id>/`，pending 已空 |
| 个人 + 不传 | `personal_asset_not_shared`；状态与文件零副作用 |
| 部门 → 全局（覆盖作者原选） | 成功；文件落到 `global/` |
| 部门为空 + 选本部门 | `department_missing` |
| 非发布动作 + `visibility` | `visibility_not_applicable` |
| MCP `publish_skill` 带 `visibility` | 个人资产可发布；不带仍拒绝 |

### HTTP（`openhive-governance-assets.test.ts`）

- 409 → 200：同一条请求补上 `visibility` 后成功，审计 `detail.visibility` 正确；
- 400：未知范围值；显式 `personal`；非发布动作带范围；
- 409：部门为空。

### 前端（`asset-governance.test.tsx` / `asset-api.test.ts`）

- 个人资产：无默认选中、按钮禁用、选后可用；
- 部门 / 全局资产：预选正确；
- 载荷包含所选范围；错误文案透出。

### 真栈验收

`asset_15c2d13f-…`（个人、待技术发布）选「全局」发布 ⇒ 200；卡片显示「全局 / 已发布」；`D:\assets\pending\asset_15c2d13f-…` 消失，`D:\assets\global/skills/…` 出现。

### 变异验证

拆掉「解析目标范围」那一步 ⇒ 个人 + 选部门用例必须红（回到 409）；只拆「写入 visibility」⇒ 目录对、库里仍是 personal，用例必须红。

## 8. 非目标

- 已发布资产改可见范围（要改先下架，另立需求）；
- 作者侧「改可见范围」编辑入口（本设计里作者原选只作默认值）；
- 部门白名单 / 部门树（`department` 仍是自由文本）；
- 批量发布、发布审批流变更。

## 9. 风险

| 风险 | 处置 |
|---|---|
| 发布者选错范围把个人资产推给全局 | 弹窗展示落点；审计记录范围；已发布范围修改列入非目标，后续单独评估 |
| 资产 `department` 是脏值（如测试数据的 `x`） | 落盘目录照旧按 `department` 字面量；`department_missing` 只挡空值。脏值清理不属本设计 |
| 与官方上游的合并面 | 只改 fork 已有的 `openhive/` 路由与 `asset-service` 包，不碰上游文件 |
