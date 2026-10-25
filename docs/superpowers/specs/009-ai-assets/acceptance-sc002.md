# T016 · SC-002 验收：生命周期流转正确 + 审核两道关分离

> 任务：`tasks.md` T016 `[BE] 写测试：生命周期状态流转 + 审核两道关 [SC-002] [T008][T009]`
> 产物：`packages/asset-service/src/acceptance-sc002.test.ts`（4 条用例 / 573 个断言）

## 1. 为什么另起一个文件（不去加 T008 / T009 的用例）

T008 的 `service.test.ts` 把动作**分段**测（主路径 / 驳回 / 迭代 / 下线 / 归档各一条），
T009 的 `review.test.ts` **抽样**测授权。SC-002 是验收口径，要回答的是另外两个问题：

| 问题 | T016 的做法 |
|---|---|
| **连起来还对不对**：状态一路带下去时，版本号 / 发布时间 / 文件位置会不会漏刷新 | 一条连续旅程，10 步全部串在同一个 assetId 上，步步对账 |
| **有没有漏格**：某个「状态 × 动作 × 身份」组合悄悄放行 / 悄悄拒绝 | 全矩阵：7 状态 × 9 动作 × 6 类身份，逐格对账 |

期望值**独立写死在用例里**（`验收转移表` / `角色所需权限` / `身份们的权限`），不从实现读。
实现改了而口径没改 ⇒ 用例必须红（变异验证见 §4）。

## 2. 三条用例的覆盖

### 2.1 连续旅程（真 PGlite + 真临时目录）

草稿 → 提交 → **业务驳回**（带理由）→ 重提 → 业务通过 → 技术发布 → 发起迭代 →
迭代发布 → 下线 → 重新上线 → 归档 → 终态再流转被拒。

每一步既断返回值，也断**库里那一行**与**磁盘上那个文件**：

- 版本号：发起迭代 +1（1 → 2），迭代发布 / 下线 / 上线 / 归档不再 +1；
- 发布时间：技术发布落定 → 迭代发布刷新 → 下线**保留** → 重新上线**刷新**；
- 文件：提交后进 `pending/`；驳回**不动** pending（T008 口径）；发布后 pending 消失、
  发布目录就位；迭代时旧版在发布目录、新版在 pending；迭代发布后发布目录换成新版；
  下线不搬目录；归档后发布目录消失、`archive/` 就位；终态目录快照只剩 archive 两件。

### 2.2 身份 → 权限口径

6 类身份（作者 / 他人+write / 他人+review / 他人+admin / 他人+review+admin / 无授权外人）
的权限集，逐条与 `effectivePermissions()` 的实际输出比对——防止「身份表」与实现悄悄分家，
也把 T009「角色由权限派生，不信调用方自报」钉在验收层。

### 2.3 全矩阵

对每个（状态, 动作, 身份）：

1. 身份权限不够 ⇒ `authorizeTransition` 抛 `actor_not_allowed`（**先判权限、再判源状态**）；
2. 权限够但源状态不对 ⇒ `applySkillTransition` 抛 `invalid_source`；
3. 两者都够 ⇒ 返回的角色 = 转移表里第一个权限满足的角色，目标状态 = 验收表 `to`。

`review` 与 `admin` 在这一层被逐格证明**互不蕴含**：review-only 过不了 `publish_tech` /
`take_offline` / `archive`；admin-only 过不了 `approve_business` / `reject_business`。

### 2.4 拒绝无副作用（真库 + 真文件 + 真通知表）

三类拒绝各跑一遍：

| 场景 | 期望 |
|---|---|
| 作者自审 / 评审人发布 / 管理员业务审核 / 外人下线 | `actor_not_allowed` |
| 评审人发起迭代且**不给源目录** | `actor_not_allowed`（不是 `source_directory_required` —— 权限门在文件操作之前） |
| 管理员在已发布状态走 `publish_tech` | `invalid_source` |

事后断言：三行资产元数据**逐字段**不变、资产根**目录快照**不变、`auth.asset_notification` 0 行。

## 3. 门禁（实得输出）

| 门 | 命令 | 实得 |
|---|---|---|
| 新用例 | `bun test src/acceptance-sc002.test.ts` | **4 pass / 0 fail**，573 断言 |
| 全包测试 | `bun test`（asset-service） | **191 pass / 0 fail**（T016 前 187） |
| typecheck | `bun run typecheck`（`tsgo --noEmit`） | 0 errors |
| oxlint | 仓库根 `bunx oxlint …/acceptance-sc002.test.ts` | 0 warnings / 0 errors |
| 锁文件 | `git diff --stat bun.lock` | 空（零新依赖） |

## 4. 变异验证（拆完即还原）

| # | 拆掉什么 | 红 | 实得证据 |
|---|---|---|---|
| M1 | `effectivePermissions` 给作者也加 `review`（自审放行） | **3** | 身份口径、全矩阵、拒绝无副作用（作者自审没被拒） |
| M2 | `business_reviewer` 映射改成要 `admin`（两道关合并） | **3** | 连续旅程（驳回被拒）、全矩阵、拒绝无副作用（管理员可过业务关） |
| M3 | `transitionAsset` 把 `prepareStorageStep` 挪到授权之前 | **1** | 拒绝无副作用：`source_directory_required` ≠ `actor_not_allowed` |
| M4 | `PUBLISHING_ACTIONS` 去掉 `bring_online` | **1** | 连续旅程：重新上线后 `publishedAt` 4001 → 3001 |
| M5 | `VERSION_BUMPING_ACTIONS` 清空 | **1** | 连续旅程：发起迭代后版本 2 → 1 |

按 `#003-03` 分类：M1 / M2 为「一类改动红一片」（它们改的是**共用判据**，多格同时错，
正是全矩阵该抓的）；M3–M5 为「只红对应判据」，说明无副作用断言与旅程断言都能独立咬住。

## 5. 未覆盖 / 缺口（如实记录）

| 缺口 | 说明 |
|---|---|
| 「同一人显式同时持 `review` + `admin` 可连过两道关」 | 设计 §3.3 的口径是「权限**互不蕴含**」，不是「必须不同人」；更强的人员分离要 `asset_log` 记每步审核人（010 审计）。已记于 `review.md` |
| MCP 出口（`submit_skill_for_review` / `publish_skill`） | 复用同一个 `transitionAsset`，T012 的 `governance.test.ts` 已测工具语义；T016 不重复走 MCP 协议层 |
| HTTP 出口 | 本仓尚无资产 HTTP 接口（`state.md` 阻塞项），验收只到服务层 |
| 真 PG（`test:real-pg`） | 本任务跑的是 PGlite（`startProductionDb`）；生产 PG 的行为差异不在本任务范围 |

## 6. 同类落点（`#002-06` 全量 grep）

- `authorizeTransition` 生产调用点：仅 `service.ts:337`（`transitionAsset` 内），治理 MCP 工具
  经 `transitionAsset` 间接使用——没有第二处自己再做一遍角色判断。
- `applySkillTransition` 生产调用点：仅 `service.ts:339`（同上）。
- `SKILL_TRANSITIONS` 的读者：`lifecycle.ts` 自身与 `lifecycle.test.ts`；验收表**故意**另写一份
  （测试预言机不与实现共用）。
