# 审核两道关（009 T009 · FR-005）

- **状态**：已落地（T009）
- **代码**：`packages/asset-service/src/review.ts`（角色派生）、`service.ts`（`transitionAsset` 接线）
- **适用**：Skill 的流转动作鉴权（FR-005 / design §3.3）
- **不在本文件**：状态与物理动作（T008，见 `lifecycle.md`）、权限来源本身（T004，见 `authorization.md`）、
  站内信（T010）、审计日志（010）

## 1. 结论

| 项 | 约定 |
|---|---|
| 两道关 | 业务关 = `approve_business` / `reject_business`；技术关 = `publish_tech` / `publish_iteration` / `take_offline` / `archive` |
| 谁过业务关 | 持有该资产 `review` 授权的人（业务管理员） |
| 谁过技术关 | 持有该资产 `admin` 授权的人（系统管理员） |
| 作者动作 | `submit_review` / `start_iteration` / `bring_online` 要 `write`（作者身份或显式 `write` 授权） |
| 分离的口径 | `admin` 不蕴含 `review`，`review` 不蕴含 `admin`，两者都不蕴含 `write` |
| 角色来源 | **由权限派生**，调用方只能声明 `viewer`（我是谁）+ 授权行，不能自报 `actor` |
| 判定次序 | 授权 → 源状态 → 物理动作。过不了关就一个文件都不搬 |

## 2. 角色 → 权限映射

```text
author            → write      （提交 / 发起迭代 / 重新上线）
business_reviewer → review     （业务审核通过 / 驳回）
system_admin      → admin      （技术发布 / 迭代发布 / 下线 / 归档）
```

`TRANSITION_REQUIRED_PERMS` 是**最小**映射：不给 `admin` 补 `review`，也不给 `review` 补 `write`。
任何一步隐含都会让分离失效；需要一人多权时显式授多条，审计上也能看见。

`bring_online` 的角色表是「作者 / 系统管理员」，按转移表顺序取第一个满足的角色：
作者带 `write` 得 `author`，只有 `admin` 的人得 `system_admin`。

## 3. 为什么不让调用方传 `actor`

T008 的 `transitionAsset` 收 `actor: ActorRole`——调用方说自己是 `system_admin` 就能发布。
T008 阶段这是「编排层还没接出口」的中间形态；T009 接上 HTTP / MCP 之后，自报角色等于
**谁都能自称管理员**。

因此入口改为：

```text
transitionAsset({ db, root, assetId, action, viewer, grants?, reason?, sourceDirectory?, now? })
```

- `viewer` 只有 `{ userId, department }`；
- `grants` 省略时由 `grantsFor(db, viewer.userId)` 从真库取（`auth.role_resource` join）。
- 角色 = `effectivePermissions(viewer, asset, grants)` ∩ 转移表 `actors` 的第一个命中项。

授权判定发生在读资产、校验类型之后，**在任何文件操作与写库之前**（`#004-09`）。
所以越权调用不会留下 `pending/` 目录，元数据也不动。

⚠️ **`applySkillTransition()` 仍然收自报的 `actor`**——它是纯状态机校验，供 `transitionAsset`
与测试使用，不是对外入口。T012 的 MCP 工具（`submit_skill_for_review` / `publish_skill`）
必须走 `transitionAsset`，**不要**直接调它，否则自报角色的口子又被打开。

## 4. 已知残差

| 项 | 现状 | 后续 |
|---|---|---|
| 同一人显式持有 `review` + `admin` | 可连续过两道关。FR-005 的口径是「权限互不蕴含」，不是「审核人必须不同人」 | 需要记录每次流转的操作人（审计日志，010）；当前元数据表无审核人字段，不造字段无法强判 |
| 审核人记录 | 转移动作没有落 `asset_log` | 010 审计日志；T012 的 MCP 工具也要走同一出口 |
| 知识库 / MCP | 7 状态机只接 Skill；其他类型在 T008 已抛 `unsupported_asset_type` | 按 design §2.0 的简化生命周期另做 |
| 部门是自由文本 | 部门可见性用精确相等，改名会断 | 组织表与稳定部门 id（010） |

## 5. 用例与变异验证

- 新增用例：`review.test.ts` 10 条（映射表、作者 / 业务 / 技术三关的正例与反例、
  互不蕴含、作者自审、`write` 授权语义、重新上线双角色、无权限、未知动作）；
  `service.test.ts` 3 条（两道关集成、`grantsFor` 真库接线、无权限者在搬文件前被拦）。
- 全量：`packages/asset-service` 117 pass / 0 fail；`tsgo --noEmit` 0 errors；
  oxlint 0 errors / 6 warnings（均为既有测试文件告警）。
- 变异（拆完即还原）：

| 拆掉什么 | 红在哪 | 条数 |
|---|---|---|
| `authorizeTransition` 不查权限，直接取 `transition.actors[0]` | 纯逻辑 4（互不蕴含 / 作者自审 / 重新上线 / 无权限）+ 集成 4（越权与非法源、两道关、grantsFor 接线、路人提交） | 8 |
| `input.grants ?? (await grantsFor(...))` 改成 `?? []` | `grantsFor` 真库接线 | 1 |
