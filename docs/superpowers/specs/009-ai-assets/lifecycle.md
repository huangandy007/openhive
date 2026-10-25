# 资产生命周期流转（009 T008 · D0-7）

- **状态**：已落地（T008）
- **代码**：`packages/asset-service/src/lifecycle.ts`（转移表·纯函数）、`service.ts`（`transitionAsset` 编排）、`asset.ts`（`updateAssetLifecycle` 条件更新）、`storage.ts`（`replaceDirectory`）
- **适用**：Skill 的 7 状态机（FR-004）；MCP / 知识库的简化生命周期不在本任务
- **不在本文件**：两道关的鉴权编排（T009）、站内信（T010）、迭代文件替换的产品交互、`/assets` HTTP 接口（未落）

## 1. 结论

| 项 | 约定 |
|---|---|
| 状态机真相 | `SKILL_TRANSITIONS` 一张表：状态、动作、角色、审核关、**物理动作**（`storage`） |
| 编排入口 | `transitionAsset({ db, root, assetId, action, actor, reason?, sourceDirectory?, now? })` |
| 适用范围 | **只接 Skill**。MCP / 知识库抛 `unsupported_asset_type`，不套错的状态表 |
| 元数据写入 | 条件更新：`where id = ? and status = 期望值`；落空 ⇒ 抛 `concurrent_transition` |
| 写入次序 | **文件先、元数据后**；写库失败按 `storage` 回滚文件 |
| 版本号 | `start_iteration` 时 +1（design §2.4：迭代中 = 旧版可用 + 新版在途） |
| 发布时间 | `publish_tech` / `publish_iteration` / `bring_online` 刷新为本次 |
| 归档时间 | `archive` 写入；归档是终态 |
| 驳回 | `in_review → draft`，必须带理由；**不动文件**（沙箱源仍在，下次提交覆盖 pending） |
| 下线 | **不搬目录**（见 §4 残差）；可用性由 `isAssetUsable()` 判 |
| 并发 | 不覆盖别人的状态；文件回滚后把并发错误抛给调用方 |

## 2. 流转表（状态 + 物理动作）

| 动作 | 从 | 到 | 触发者 | 物理动作（`storage`） |
|---|---|---|---|---|
| `submit_review` | `draft` | `in_review` | 作者 | `copy_to_pending`：沙箱 → `pending/{id}` |
| `approve_business` | `in_review` | `pending_tech` | 业务管理员 | `none` |
| `reject_business` | `in_review` | `draft` | 业务管理员 | `none`（必须带理由） |
| `publish_tech` | `pending_tech` | `published` | 系统管理员 | `move_pending_to_publish` |
| `start_iteration` | `published` | `iterating` | 作者 | `copy_to_pending`：沙箱新版 → `pending/{id}`；旧版留在发布目录 |
| `publish_iteration` | `iterating` | `published` | 系统管理员 | `move_pending_to_publish`（先备份旧版，确认后删） |
| `take_offline` | `published` | `offline` | 系统管理员 | `none` |
| `bring_online` | `offline` | `published` | 作者 / 系统管理员 | `none` |
| `archive` | `published` / `offline` | `archived` | 系统管理员 | `move_publish_to_archive` |

`source_directory` 只在 `copy_to_pending` 的两个动作必填；缺了在**碰库/搬文件之前**抛
`source_directory_required`。

## 3. 次序、补偿与并发

### 3.1 为什么文件先、元数据后

元数据是对外可读的那一侧。先写库再搬文件，前端会在「已发布」状态下找不到文件；先搬文件再
写库，写库失败还能把文件搬回去。反过来没有回滚手段。

| `storage` | 写库失败时 |
|---|---|
| `copy_to_pending` | 删掉本次复制出的 `pending/{id}`（源在沙箱，不丢内容） |
| `move_pending_to_publish` | 新目录搬回 `pending/`；目标若有旧版，备份放回（`replaceDirectory` 的 `rollback()`） |
| `move_publish_to_archive` | 搬回发布目录；archive 若有旧内容，备份放回 |
| `none` | 无需回滚 |

回滚本身失败 ⇒ 抛 `AggregateError`，同时保留原始错误与回滚错误，不静默吞掉任何一侧。

### 3.2 并发

`updateAssetLifecycle` 带 `status = 期望值` 条件：

- 命中 ⇒ 返回更新后的完整元数据；
- 落空 ⇒ 返回 `undefined`，`transitionAsset` 抛 `concurrent_transition` 并回滚文件。

不先查再写：两条语句之间别人改了状态，先查后写会覆盖别人的结果。

### 3.3 不假装「整体可重入」

跨存储没有事务。**崩溃窗口**（文件搬完、进程在写库前退出）仍会留下与库不一致的目录；重试
`move` 类动作会因源目录已不在而报错。这是设计已知残差（同 T003 的孤儿目录），需对账脚本
清理，不在 T008 造一个看似可重入的假象（`#007-01`）。

## 4. 已知残差与刻意偏离

| 项 | 现状 | 后续 |
|---|---|---|
| **下线不搬目录** | design §2.2 写「移出发布目录」，但 T002/T003 的目录布局没有 offline 位置，T003 已裁定「下线不搬目录、旧版仍可见」。T008 沿用该裁定 | 真正的「不可用」靠下发清单按状态过滤（T014）；不能靠目录位置，否则下线通知点回去就是 404 |
| 内核可能仍加载下线资产 | opencode 内核按目录被动扫描；下线资产仍在发布目录 | T014 生成 `skills.paths` 时排除 `offline` |
| 个人资产发布 | `publishDirectory` 拒绝 `personal`；`transitionAsset` 让这个错误显式抛出 | 发布前需先把可见范围改成 global/dept（编辑路径未落） |
| MCP / 知识库生命周期 | 未实现，显式 `unsupported_asset_type` | 按 design §2.0 的简化流程另做，不硬塞 7 状态机 |
| 驳回后的 pending 副本 | 保留，下次提交以 `replace: true` 覆盖 | 可接受；删除是不可回滚操作，不在此刻做 |
| 跨存储崩溃窗口 | 见 §3.3 | 对账脚本（T005 后接） |
| 版本号语义 | `start_iteration` 立即 +1，旧版在发布目录仍以新版本号展示 | 与 design §2.4 一致；若将来要区分「已发布版本号 / 在途版本号」，需拆字段（010 版本记录） |

## 5. 用例与变异验证

- 新增用例：`lifecycle.test.ts` 物理动作表 1 条；`storage.test.ts` 目录替换 3 条；
  `asset.test.ts` 条件更新 2 条；`service.test.ts` 流转编排 10 条（主路径 / 驳回 / 迭代 /
  下线上线 / 归档终态 / 越权与非法源状态 / 缺源目录 / 非 Skill / 两类并发回滚）。
- 全量：`packages/asset-service` 104 pass / 0 fail；`tsgo --noEmit` 0 errors；oxlint 0 errors。
- 变异（拆完即还原）：

| 拆掉什么 | 红在哪 | 条数 |
|---|---|---|
| `publish_tech` 的 `storage` 改成 `none` | 转移表 1 + 依赖发布搬运的流转 5 | 6 |
| 条件更新的 `and status = 期望值` | 条件更新用例 1 + 两类并发回滚 2 | 3 |
| 写库失败时的 `step.rollback()` | 两类并发回滚 | 2 |
| `start_iteration` 的版本号 +1 | 迭代用例 | 1 |
| 目录替换回滚时恢复备份 | 目录替换回滚 1 + 迭代发布并发回滚 1 | 2 |
