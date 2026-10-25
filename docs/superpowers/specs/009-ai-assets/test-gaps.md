# 009 收尾 · 结构性缺口补测记录

> 入口：`test-routing-advisor` 收尾报告判定 **主类单后端 / 次类单前端 / 启用跨模块契约**。
> 本文件记录路由后**真正补掉的缺口**与**验不了、没补的缺口**，都带实得证据。
> 纪律：`#002-02`（验不了的不得写成已覆盖）、`#003-03`（变异红集分类）、`#004-09`（门在副作用之前）。

| # | 缺口 | 路由 | 状态 |
|---|---|---|---|
| B1 | 对象级越权**出口层**（MCP 协议出口） | `backend-testing` | ✅ 已补（见 §1） |
| B2 | 真 PG 数据层（约束 / 序列化 / 迁移） | `backend-testing` | ✅ 已补（见 §2） |
| B3 | 真并发 / 竞态原子性 | `backend-testing` | ✅ 已补，**并修掉一个真缺陷**（见 §3） |
| B4 | stdio 真进程 MCP 入口 | `backend-testing` | ✅ 已补（见 §4） |
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

## 2. B2 / B3 / B4 · 真 PG 与真进程（`real-pg.test.ts`）

**为什么补**：PGlite 是单连接嵌入式引擎，`Promise.all` 打两条查询会撞 `42P05`
（T016 实测）⇒ 既有全部用例都是**串行**的。于是两件生产性质从未被验过：真实例的约束语义、
两条**真连接**同时打同一条不变量。B4 另补 `mcp-main.ts`（stdio 真进程入口）——它需要真进程
+ 真 PG 才起得来。

**跑法**（默认 `bun test` **skip**，只有这个命令跑真库）：

```bash
bun run --filter @opencode-ai/asset-service test:real-pg
# → 真 PG 测试 → 8.136.21.218:35432/openhive_test（角色 openhive_dev）
```

`script/test-real-pg.ts` 沿用 `packages/auth/script/test-real-pg.ts` 的约定：从
`packages/opencode/.env` + `.env.local` 读凭据、强制 `PG_DATABASE=openhive_test` 与
`OPENHIVE_TEST_PG=1`。**硬闸**：`withRealPg` 在 DROP 同一条路径上要求库名 `_test` 结尾。
⚠️ 每个用例都会 `DROP SCHEMA auth CASCADE`；**RLS 仍不在本仓，未覆盖（不得写成已覆盖）**。

### B2 约束与序列化（1 例，实得 pass）

| 断言 | 靠谁兜住 | 实得 SQLSTATE |
|---|---|---|
| `tags`（jsonb）与时间列往返：顺序、`createdAt`、`status` 不变 | 库 + drizzle 映射 | —（值断言） |
| 同一用户重复收藏同一资产 | 唯一约束 | `23505` |
| `role_resource.perm` 写未知值 `owner` | CHECK 约束 | `23514` |
| 给不存在的用户加组 | 外键 | `23503` |

SQLSTATE 从**错误链**取：drizzle 把驱动错误包成 `DrizzleQueryError`，真正的 `code` 在
`cause` 上，直接读顶层拿到 `undefined`（本机实测，2026-10-25）⇒ `sqlstateOf()` 走 cause 链。

### B3 真并发（2 例，实得 pass）

| 用例 | 不变量 | 结论 |
|---|---|---|
| 两条连接同时**收藏**同一资产 | `on conflict do nothing` + `exists(inserted)` ⇒ 恰好一个声称插入；收藏行 1 行；`favorite_count` 只加 1 | pass（一次就绿） |
| 两条连接同时**发布**同一资产 | 恰好一个 fulfilled；输家给状态机错误码；DB=`published`；文件在发布目录；pending 已搬走 | **首次跑红** → 揪出真缺陷（§3），修后 5/5 绿 |

## 3. B3 揪出的真缺陷：并发发布后「库里 published、文件在 pending」

### 现象（修前实得）

```
#0 rejected AssetTransitionError: 资产 asset_real 的状态已被并发修改，未执行 publish_tech
#1 fulfilled ok
DB 状态: published
目录树: [ "dept", "pending", "dept\\经侦支队", "pending\\asset_real",
         "dept\\经侦支队\\skills", "pending\\asset_real\\SKILL.md" ]
<root>\dept\经侦支队\skills\asset_real\SKILL.md => "(读不到: ENOENT…)"
```

两种红交错（同一用例跑 4 次：3 次 A、1 次 B）：

| 交错 | 现象 |
|---|---|
| A | 输家抛**原始 fs 异常** `源目录不存在：…pending\asset_real`（无 `code`，MCP / 前端拿到内部异常） |
| B | 输家抛 `concurrent_transition`，但它的回滚把**赢家已经搬过去**的发布目录搬回 pending |

### 根因（实测，不猜）

1. **OS 层 rename 不互斥**：一次性探针（5/5）——两条并发 `rename(src, dst)`（dst 不存在）
   **都 resolve 成功**，目录只搬了一次。临时脚本已删。
2. 于是两条流转都以为自己的文件步骤成功 → 都去抢条件更新 → 只有一条落库。
3. 输家的 `step.rollback()` 是**无条件**的：`moveDirectory(target → source)` 搬的是「此刻
   target 里放的东西」，而它已是赢家的结果 ⇒ 跨资源不一致。

### 修复（产品码，最小改动）

| 位置 | 改动 | 为什么 |
|---|---|---|
| `service.ts` `transitionAsset` | 条件更新落空后**回读状态**：已是 `applied.to` ⇒ 另一个写者完成了**同一条**流转 ⇒ `step.commit()`（只清自己的备份），**不回滚** | 回滚等于抹掉别人已提交的结果；`commit` 是幂等的，备份不泄漏 |
| `storage.ts` | 新增 `MissingSourceDirectoryError`（消息保持 `源目录不存在：…`，既有断言不动） | 让编排层能按**类型**识别「源已被搬走」，不靠字符串匹配 |
| `service.ts` `moveWithinTransition` | 两个搬目录动作统一走它：`MissingSourceDirectoryError` ⇒ `AssetTransitionError("invalid_source", …)` | 状态机说该搬、文件已不在 ⇒ 并发流转先一步搬走；不该把 fs 异常原样抛给模型 / 前端 |

**残差（如实写）**：

- 判据是「当前 `status` == 本次目标态」。本转移表里**同源状态**的多个动作只有 `archive` 会搬
  publish 目录（`start_iteration` 是复制、`take_offline` 无文件动作），所以「不同动作并发搬同一
  目标」今天不存在；将来若新增「同源状态、同目标、不同 `to`」的动作，此判据要重新审。
- 文件步骤与元数据步骤仍**非原子**：真并发窗口里双方都发起了 rename（其中一次是空操作）。
  本修复保证**不产生跨资源不一致**，不保证「只有一次物理搬移」。
- `copy_to_pending` 的源在作者沙箱（不是共享卷），源缺失仍走原始错误——未纳入本次范围。

### 确定性回归（`service.test.ts`，2 例）

| 用例 | 守什么 |
|---|---|
| 并发写者已完成同一流转：条件更新落空不回滚目标目录 | 用既有 `raceOnUpdate` 把状态改成 `published` 再让本次条件更新落空；断言发布目录内容在、pending 已消失、库仍 published |
| 待发布目录已被并发搬走：抛 `invalid_source` | 故意不建 pending；断言错误码是 `invalid_source`（不是 `undefined`），且元数据没动 |

### 变异验证（拆完即还原）

| # | 拆掉什么 | 红集 | 实得 |
|---|---|---|---|
| M1 | `他人已落地` 判据（一律 `rollback`） | **1**（`service.test.ts` 新用例）＋ 真并发 **3/3** | 两处都是 `ENOENT: …dept\经侦支队\skills\asset_real\SKILL.md` |
| M2 | `MissingSourceDirectoryError` 映射（原样抛） | **1**（`service.test.ts` 新用例） | `Expected: "invalid_source" / Received: undefined`；真并发 9 次都走了 guard 路径，**未触发**源缺失分支（概率覆盖，如实记） |
| M3 | 判据写成恒 `true`（一律不回滚） | **2**（既有两条并发用例：提交审核 / 迭代发布） | 证明 guard 是**有条件的**，不是「丢掉回滚」 |

按 `#003-03`：M1 / M3 是「拆防护 ⇒ 对应用例红」；M2 只有确定性用例守得住（真并发的两种交错
里它只占一种），**不得写成「真并发用例覆盖了源缺失分支」**。

## 4. B4 stdio 真进程（1 例，实得 pass）

`StdioClientTransport` 起 `bun run mcp-main.ts`（真进程、真 PG），校验：

- `listTools()` 恰好 3 个治理工具；
- `create_skill_draft`（`_meta["openhive/user"]=u1`）出参 `status=draft`；
- **真库**里 `owner_id=u1`、`status=draft`——不是只回了一个 ok。

## 5. 门禁（实得输出）

| 门 | 命令 | 实得 |
|---|---|---|
| 全包测试 | `bun test`（asset-service） | **209 pass / 4 skip / 0 fail**（补测前 207；4 skip = 真库用例默认跳过） |
| 真库测试 | `bun run --filter @opencode-ai/asset-service test:real-pg` | **4 pass / 0 fail**（重复 5 次，5/5） |
| typecheck | 仓库根 `bun run typecheck` | **32 successful / 32 total** |
| oxlint | 仓库根 `bunx oxlint <5 个改动文件>` | **0 warnings / 0 errors** |
| 锁文件 | `git diff --stat bun.lock` | 空 |

## 6. 仍未覆盖（不得含糊）

| 缺口 | 为什么没补 |
|---|---|
| RLS / DB GRANT | 策略不在本仓（`mcp-downlink.md` §6），本机也没有可跑的策略对象 |
| HTTP 出口层越权 | 接口尚未落地，无被测对象 |
| L2 视觉基线 / L4 多视口 | 机器只能出 diff，基线裁决需人审 |
| 前端运行期 a11y（F1） | 待办（见上表） |
