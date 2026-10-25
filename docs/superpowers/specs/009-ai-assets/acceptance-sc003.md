# T017 · SC-003 验收：授权与收藏分离 + 无权资产不可见 / 不可用

> 任务：`tasks.md` T017 `[BE] 写测试：授权/收藏分离 + 无权资产不可见 [SC-003] [T011]`
> 产物：`packages/asset-service/src/acceptance-sc003.test.ts`（6 条用例 / 231 个断言）

## 1. 与 T004 / T011 的分层

T004 的 `authorization.test.ts` **抽样**测空间 / 权限规则；T011 的 `preferences.test.ts`
**抽样**测「收藏不改授权」。验收层回答的是**全格扫描**与**出口一致性**：

| 用例 | 钉住什么 |
|---|---|
| 可见性全矩阵 | 7 状态 × 3 空间 × 6 类身份 = 126 格，逐格与独立口径对账 |
| 「不可见」是默认 | 非作者、无授权、非共享状态 ⇒ 任何空间都读不到（21 格） |
| 收藏全扫描（真库） | 21 份资产逐个收藏一遍，可见性与授权行一格不变；`role_resource` 仍 0 行 |
| 收藏清单契约 | `favoriteAssetIds()` 是**原始清单**（含读不到的），调用方过滤后只剩可读的 |
| 下发不超出可见 | 每个下发的 MCP 都满足 `canReadAsset` 且 `isAssetUsable`；review 授权可读但**不下发** |
| 排序不是过滤 | `orderForDrawer()` 是排列：入参原样保留（含读不到的资产），收藏只改先后 |

独立口径写在用例里（`共享状态` / `期望可读` / `身份们`），不读实现——实现改了口径没改，
用例必须红。

## 2. 「不可见 / 不可用」的两个出口

| 出口 | 判据 | 本任务怎么验 |
|---|---|---|
| 看不见 | `canReadAsset()`：作者恒可读；任一授权行附带 read；其余人只有**共享状态**下按空间放行（global 全单位 / department 同部门 / personal 空间永不放行） | 全矩阵 + 默认不可见 |
| 用不了（MCP） | `buildUserMcpConfig()`：`type=mcp` ∧ 可用状态 ∧ **显式** `(mcp,id,read)` | 下发集合 ⊆ 可读集合 ∩ 可用集合；无授权只剩内建治理 server |

两个出口是**单向包含**：下发的必定可读（不会泄漏），可读的不一定下发（MCP 下发按设计更严：
`review` / `admin` / `write` 授权都带 read，但连接详情含静态凭据，只认显式 `read`）。

## 3. 收藏与授权分离的三条证据

1. **写路径分离**：收藏只写 `auth.asset_favorite` + `asset.favorite_count`；`role_resource`
   一行都不写（真库扫描后断言计数为 0）。
2. **判据分离**：`canReadAsset()` 的入参里没有「收藏」；全矩阵里收藏前后逐格相同。
3. **出口分离**：收藏清单是原始清单，**必须**再过滤；抽屉排序只换顺序、不过滤——
   把「可见性」留给授权判据，把「先后」留给偏好（FR-007 的口径）。

## 4. 变异验证（拆完即还原）

| # | 拆掉什么 | 红 | 实得证据 |
|---|---|---|---|
| M1 | `spaceAllowsRead` 去掉「非共享状态不可读」门 | **3** | 全矩阵、「不可见是默认」、收藏全扫描 |
| M2 | `personal` 空间改成 `return true` | **3** | 全矩阵、收藏全扫描、收藏清单契约（`fav_personal` 漏出） |
| M3 | `hasMcpReadGrant` 不再要求 `perm === "read"` | **1** | 下发用例：review 情形多出 6 条下发（Expected 0 / Received 6） |
| M4 | `orderForDrawer` 按收藏过滤 | **1** | 排序用例：入参 3 条只剩收藏的 1 条 |

按 `#003-03` 分类：M1 / M2 为「一类改动红一片」（改的是共用判据，多格同时错——全矩阵该抓的）；
M3 / M4 只红对应判据。

## 5. 门禁（实得输出）

| 门 | 命令 | 实得 |
|---|---|---|
| 新用例 | `bun test src/acceptance-sc003.test.ts` | **6 pass / 0 fail**，231 断言 |
| 全包测试 | `bun test`（asset-service） | **197 pass / 0 fail**（T017 前 191） |
| typecheck | `bun run typecheck`（`tsgo --noEmit`） | 0 errors |
| oxlint | 仓库根 `bunx oxlint …/acceptance-sc003.test.ts` | 0 warnings / 0 errors |
| 锁文件 | `git diff --stat bun.lock` | 空（零新依赖） |

## 6. 缺口（如实记录，`#002-02`）

| 缺口 | 说明 |
|---|---|
| **没有生产消费者** | `canReadAsset()` / `favoriteAssetIds()` / `orderForDrawer()` / `buildUserMcpConfig()` 今天都没有生产调用点（资产 HTTP 接口、右栏抽屉接线、`opencode.json` 写入器都未落）。本任务验的是**判据与契约**，不是真栈行为 |
| **「不可见」在真栈上不可观察** | 中栏资产页今天只有空态（列表未接真源）；不得写成「资产列表已按权限过滤」 |
| **RLS 不在本仓** | 数据隔离第四环见 `mcp-downlink.md` §6；**不得写成「RLS 已覆盖」** |
| 收藏清单过滤的调用方未落 | 契约由 `preferences.ts` 文档 + 本用例钉住；真正接线时（资产 API / 抽屉）必须复用同一份过滤 |

## 7. 同类落点（`#002-06` 全量 grep）

- `canReadAsset`：定义 1 处（`authorization.ts:242`），生产调用点 **0**（测试与契约）。
- `favoriteAssetIds`：定义 1 处；生产调用点 0。
- `orderForDrawer`：定义 1 处；生产调用点 0。
- `buildUserMcpConfig`：定义 1 处；生产调用点 0（无 `opencode.json` 写入器，`state.md` 阻塞项）。
- 「收藏是否影响授权」的判定只有 `canReadAsset` 一处；没有第二处自己再判一遍收藏。
