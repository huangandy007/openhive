# 资产生命周期的站内信通知（009 T010 · FR-004）

- **状态**：已落地（T010）
- **代码**：`packages/asset-service/src/notify.ts`、`service.ts`（`transitionAsset` 接线）、
  `packages/auth/src/migrations/0011_asset_notification.sql`
- **适用**：Skill 7 状态机每次流转后的「推送到人」
- **不在本文件**：前端站内信面板 / 未读红点 / 标记已读（design-v2 §8.3，独立 feature）、
  状态机本身（T008）、鉴权（T009）

## 1. 结论

| 项 | 约定 |
|---|---|
| 存储 | `auth.asset_notification`：一行一人，收件人与资产名在写入时快照 |
| 收件人来源 | **库里的授权行**（`role_resource` → `user_role`），不是调用方预取的 `grants` |
| 投递时机 | 流转提交（元数据更新 + 文件 commit）之后 |
| 失败语义 | 抛 `AssetNotificationError`（`code = "notification_failed"`），**不回滚已生效的流转** |
| 无收件人 | 返回 0，不抛错——没人可通知不该让流转失败 |
| 发布 | **不广播**（design §2.6）：只通知作者 / 授权人，新资产靠民警主动发现 |
| 去重 | 同一人既是作者又有 admin 授权 ⇒ 一条 |
| 排除发起人 | 自己做的动作不通知自己 |
| 类目标签 | 本表即「系统类 · 🧩 资产」的来源；前端标签由站内信面板渲染，不重复存 |

## 2. 收件人矩阵（design §2.6）

| 动作 | 推给谁 | 标题 / 正文要点 |
|---|---|---|
| `submit_review` | 持有该资产 `review` 授权的人 | 「有 skill 待审核」/ 请审内容正确性与可泛化性 |
| `approve_business` | 作者 + `admin` 授权人 | 「skill 已过业务审核」/ 等待技术发布 |
| `reject_business` | 作者 | 「skill 被驳回」/ 含驳回理由 |
| `publish_tech` | 作者 | 「skill 已发布」 |
| `start_iteration` | **无** | 作者自己发起的，通知自己只会制造噪音 |
| `publish_iteration` | 作者 | 「skill 新版本已发布」/ 含版本号 |
| `take_offline` | 作者 + 收藏者（「使用者」的第一半，见 §4） | 「skill 已下线」/ 有原因时附原因 |
| `bring_online` | 收藏者（作者没收藏就不通知） | 「skill 已重新上线」/ 可以继续使用 |
| `archive` | 作者 | 「skill 已归档」 |

解析只认**该资产**的授权行：`resource_type = asset.type` 且 `resource_id = asset.id`。
别的资产的 `review` / `admin` 不会串进来（有用例钉住）。

## 3. 为什么通知失败不回滚状态

流转的顺序是「文件 → 元数据」；通知发生在两者都成功之后。此时把文件倒回旧目录只会制造
「元数据说已发布、文件在 pending」的不一致——比丢一条通知严重得多。

因此：

- 通知失败抛 `AssetNotificationError`，消息里写明「`<action>` 已生效」；
- 调用方（T012 的 MCP 工具 / 将来的 HTTP 出口）据此区分「流转没做成」与「做成了但通知没写进去」，
  **不要**因此重试流转（会撞 `concurrent_transition`）。

写通知本身是一条批量 `insert`：解析收件人（读）→ 一次写入。没有收件人时**不执行 insert**。

## 4. 已知残差

| 项 | 现状 | 后续 |
|---|---|---|
| 「使用者」中的「最近用过」 | T011 已补**收藏者**（`auth.asset_favorite`）；`auth.asset_usage.last_used_at` 也有明细了，但设计没定义「最近」的时间窗，**不擅自取 7 天 / 30 天** | 产品给出窗口后，在 `favoriteUsers` 旁加一条 `recentUsers(assetId, since)` |
| 收藏者可能已无权读取该资产 | 收藏行不随授权撤销而消失；通知只含资产名，不含内容摘要，不构成内容泄漏 | 若正文要带内容摘要，必须先按 `canReadAsset()` 过滤收件人 |
| 已读状态 | 表里没有 `read_at`；未读红点与「标记已读」属站内信面板 | design-v2 §8.3 的独立 feature |
| 重试 / outbox | 通知失败不重试，也没有投递记账 | 与资产对账一起考虑；不现在造假可靠 |
| 站内信读取接口 | 无（表已按收件箱查询形状建索引） | 站内信面板 feature |
| 审核人记录 | 通知里没有「谁审的」——`actorId` 只用于排除发起人 | 010 审计日志 |

## 5. 用例与变异验证

- 新增用例：`notify.test.ts` 17 条（CHECK 防漂移 1、收件人矩阵 14、内容快照与级联 2；
  其中 3 条为 T011 追加：下线通知收藏者、重新上线只通知收藏者、别资产收藏者隔离）；
  `service.test.ts` 2 条（全链路通知到人、通知失败语义）。
- 全量（T011 后）：`packages/asset-service` 152 pass / 0 fail；`packages/auth` 286 pass /
  3 skip / 0 fail（含 0011 / 0012 迁移与中文注释全覆盖）；`tsgo --noEmit` 0 errors；
  oxlint 0 errors（改动文件）。
- 变异（拆完即还原）：

| 拆掉什么 | 红在哪 | 条数 |
|---|---|---|
| `submit_review` 的收件人改成 `["author"]` | 提交只通知审核人 / 只认 review·admin / 服务层全链路通知 | 3 |
| 去掉发起人排除（`recipients.delete(actorId)`） | 发起人是唯一收件人时不发 | 1 |
| 去掉 `AssetNotificationError` 包装 | 通知写库失败语义 | 1 |
| `bring_online` 的收件人改回 `[]`（T011） | 矩阵口径 / 重新上线只通知收藏者 | 2 |
