# 009 收尾 · 结构性缺口补测记录

> 入口：`test-routing-advisor` 收尾报告判定 **主类单后端 / 次类单前端 / 启用跨模块契约**。
> 本文件记录路由后**真正补掉的缺口**与**验不了、没补的缺口**，都带实得证据。
> 纪律：`#002-02`（验不了的不得写成已覆盖）、`#003-03`（变异红集分类）、`#004-09`（门在副作用之前）。

| # | 缺口 | 路由 | 状态 |
|---|---|---|---|
| B1 | 对象级越权**出口层**（MCP 协议出口） | `backend-testing` | ✅ 已补（见 §1） |
| B2 | 真 PG 数据层（约束 / 序列化 / 迁移） | `backend-testing` | 待办 |
| B3 | 真并发 / 竞态原子性 | `backend-testing` | 待办 |
| B4 | stdio 真进程 MCP 入口 | `backend-testing` | 待办 |
| F1 | L3 运行期 a11y（axe） | `frontend-testing` | 待办 |
| — | HTTP 出口层越权 | — | 🔧 无接口，无被测对象 |
| — | L2 视觉基线 / L4 多视口 | `frontend-testing` | ⚠️ 需人审裁决 |

## 1. B1 · MCP 出口层双身份越权（`acceptance-sc003-mcp.test.ts`）

**为什么补**：T017 的 `acceptance-sc003.test.ts` 验的是**判据**（`canReadAsset` 等纯函数）；
判据全绿不等于出口关得住——出口可能忘取身份、可能先搬文件后鉴权。今天已落地的出口只有
治理 MCP 一条（HTTP 接口未落），所以补这里。

**独立口径**：8 类身份 × 3 工具的期望写死在用例表里（不读实现）：

| 身份 | create_skill_draft | submit（草稿，作者 u1） | publish（待发布，作者 u1） |
|---|---|---|---|
| 作者 u1 | 放行 | 放行（作者身份） | 拒（作者不派生管理权） |
| 同部门他人 u3 | 放行 | 拒（同部门可见 ≠ 可写） | 拒 |
| 跨部门 + read u7 | 放行 | 拒（读 ≠ 写） | 拒（读 ≠ 管） |
| 跨部门 + write u4 | 放行 | 放行（显式写授权） | 拒 |
| 跨部门 + review u5 | 放行 | 拒（审 ≠ 写） | 拒（审 ≠ 管） |
| 跨部门 + admin u6 | 放行 | 拒（管 ≠ 写） | 放行 |
| 停用账号 u_off | 拒 `user_disabled` | 同左 | 同左 |
| 不存在 u404 | 拒 `user_not_found` | 同左 | 同左 |
| 未注入身份 | 拒 `identity_required` | 同左 | 同左 |

**拒绝格的断言不止错误码**（`#004-09`）：资产状态行、目标目录、`auth.asset_notification`
计数三份快照都不动。另有 1 条：参数里塞 `ownerId` / `department` / `userId` 不能提权。

**变异验证**（拆完即还原，产品码零改动）：

| # | 拆掉什么 | 红 | 实得 |
|---|---|---|---|
| M1 | `governance.userOf` 的停用检查 | **1** | 停用账号格 `Expected "user_disabled" / Received "ok"` |
| M2 | `TRANSITION_REQUIRED_PERMS.system_admin` 改 `review` | **2** | review 格 `Expected actor_not_allowed / Received ok`；admin 格反之 |
| M3 | `TRANSITION_REQUIRED_PERMS.author` 改 `read` | **3** | read / review / admin 三格都被放行 |

按 `#003-03`：M2 / M3 是「一类改动红一片」——改的是共用判据，多身份同时错，矩阵该抓的；
M1 只红对应身份。

**门禁（实得输出）**

| 门 | 命令 | 实得 |
|---|---|---|
| 新用例 | `bun test src/acceptance-sc003-mcp.test.ts` | 10 pass / 0 fail，82 断言 |
| 全包测试 | `bun test`（asset-service） | 207 pass / 0 fail（补测前 197） |
| typecheck | `bun run typecheck` | 0 errors |
| oxlint | 仓库根 `bunx oxlint …/acceptance-sc003-mcp.test.ts` | 0 warnings / 0 errors |

**同类落点（`#002-06`）**：治理出口只有 `createGovernanceServer` 一处；
`userIdOf` 只被 `runTool` / `runCreateDraft` 两处调用，都已进矩阵。

**仍缺**：HTTP 出口（无接口）；RLS（不在本仓）。**不得写成「出口层已全覆盖」**。
