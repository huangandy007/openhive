# 实施进度 · 认证与账号

## 当前任务
**T018 已完成 —— 002 的 16 条任务全部落地**（T001–T018，T010/T012 已裁定移出）。
剩余收尾：① 本任务提交（T018 是 002 唯一动 opencode 边界的任务，单独一条 commit）；
② **feature 收尾时按 CLAUDE.md 追加 1–5 条 LEARNINGS（`#002-01` 起）**；③ 评审 / 合入 `multi-tenant`。

## 补提交记录（2026-09-29，用户裁定「逐条补提交」）

T001–T008 各有提交，**T009 之后的五条一直积在工作区**（`login.ts` 连 untracked 都还在）。
按用户裁定补成 **6 条提交**（T009 / T011 / T013 / T014 / 重构 / T015），非 5 条——
因为 T015 顺手做的窄接口提取按项目 Anti-Pattern「重构与新功能拆成两个提交」**单独立了一条**。

**⚠️ 实情说清楚（不粉饰）**：这些提交是**事后**补的，不是当时逐条做的。为了让每条提交状态自洽，
T009 与 T013 的 `login.ts` / `password.ts` 里那份「本文件自己的窄接口」是**照后来的提取结果重建的**，
不是当时的原件（原件从未落盘过版本历史）。重建后**每个中间态都真跑过对应测试**：
T009 态 17 pass、T011 态 11 pass、T013 态 9 pass、T014 态 12 pass，全绿。
最终态与提交前**逐字相同**（`login.test.ts` 提交前后与 HEAD 零差异即为例证）。

**教训**：逐条提交的价值在**变更边界**，事后补能拿回来大部分；但「中间态长什么样」的细节会丢。
下次在 worktree 里做多任务时，**完成一条就先提交一条**，别攒。

## 已完成

### T018 [BE] opencode 身份门 ✅（2026-09-29）
**交付物**：新增 `packages/opencode/src/server/user-identity.ts`（开关 Config）、
`.../httpapi/middleware/user-identity.ts`（全局中间件）、`test/server/user-identity.test.ts`（10 条）；
`.../httpapi/server.ts` 接线 **+5 行**（2 行 import + 3 行）。**opencode 上游文件只动了这一处、只加了 5 行。**

**为什么先问后做**：tasks.md 在本任务旁标着「属范围决策，须先由人定，不能由实现者顺手夹带」。
摸排后发现三条必须由人定的岔路，都用 AskUserQuestion 提了，用户全取推荐项：

| 岔路 | 若按字面做的后果 | 裁定 |
|---|---|---|
| 门无条件生效？ | dev:web / desktop / CLI / 内置 web UI **全部立刻 401** | 配置开关，**默认关** |
| 中间件落哪个包 | 002 `plan.md:57` 写 `packages/auth/`，但那样 auth 要反向依赖 opencode 内部 | 落 `packages/opencode` |
| per-request 上下文归谁 | 002 `plan.md:98` 与 003 `plan.md:94`**都认领了同一件事** | 归 003，002 只做「读头 → 无头即拒」 |

**关键发现一：「关闭 Basic Auth」这半是零代码。** `server/auth.ts` 的 `required()` 在没设
`OPENCODE_SERVER_PASSWORD` 时返回 false，`middleware/authorization.ts` 的三处中间件
（`:104` / `:122` / `:138`）全部退化成直通。所以「关闭」= **不设环境变量**，一行源码都不用改——
正好落在「品牌化/环境值走配置，不硬编码进核心源码」上。

**关键发现二（安全，已写进代码顶部注释）：`X-User-ID` 不是凭证。** 它明文、可自填，谁够得着端口
谁就能填成任意 id 含管理员。这道门拦的是**注入链路的缺失**（网关没跑、头被剥掉、反代漏配），
**不是伪造**——真边界是「只有网关够得着这个端口」（回环绑定 / 网络策略，F3）。
它比「不设密码跑裸奔」严格，但它**不是鉴权**；后来者若按「无该头即拒绝」的字面理解去信任它，
就等于把门牌号当门锁。这条不确定下来，这个 feature 会出厂一个**看起来安全**的门。

**关键发现三：整目录跑测试不是可靠的门。** `packages/opencode/test/server/` 同一条命令三次跑出
**4 / 6 / 3** 条失败，名单各不相同，全是整齐的 5000ms 超时。取 **HEAD 基线（把本任务三个文件全部移走、
`server.ts` 还原）同样 3 条超时**。即：该套件受负载抖动，**失败集不稳定**。
判据因此定为「单文件 + 具体用例名」，不看整目录总数。

**两处刻意放行规则**：① **空白按没有处理**——网关注入坏掉时送的是空串/空白而非「没有这个头」，
放行等于给下游一个**空身份**，而空身份在 F3 会被当成合法的路由键；② **公共 UI 资源豁免**——
同 Basic Auth（`shared/public-ui.ts`），拦了会让 PWA 装不上（上游 #25698）。拒绝时**不发**
`www-authenticate`：那是给浏览器弹 Basic 框用的，这里没有 Basic，发了只会弹一个永远填不对的框。

**变异验证（全部真跑）**：

| 变异 | 红 |
|---|---|
| 拆掉 `createRoutes` 里的接线 | **1**（真应用那条） |
| 不拒绝无头请求 | **3** |
| 开关关了也照样拦 | **2** |
| 不豁免公共 UI 资源 | **1** |
| 默认值 false → true | **2** |
| `!userId` → `userId === undefined` | **1**（且恰好只这一条，证明空白用例有独立牙） |
| 去掉 `?.trim()` | **0** → 冗余，已删 |

最后一条的处理同 T016 的空名单守卫：变异 0 红 → 实测 `"   "` → `""`、`" u_1 "` → `"u_1"`
（HTTP 层按 RFC 9110 已去首尾空白），`.trim()` **在任何输入下都不改变结果**，删掉；
测试注释改为陈述真实机制，并注明「变异成 `=== undefined` 会让本条红」。

**实测出参**：T018 测试 **10 pass / 0 fail**；带上游 `httpapi-ui.test.ts` 共 **22 pass / 0 fail**
（12 条上游 Basic Auth 用例全绿 = 没破坏既有认证）；`bunx oxlint` 四个文件 **0/0**；
`bun run typecheck` **31/31**（`opencode` / `auth` 均真跑非缓存）；`bun run lint`
**4924w / 1e / 3375 文件**——w/e 与基线逐字相同，文件数 +3（本任务 3 个新文件），
单条 error 仍是上游 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`。

### T017 [P] [US5] [BE] 密码重置 ✅（2026-09-29）
**交付物**：`password.ts` 加 `resetPassword`；`password.test.ts` 增 4 条（重置 describe）；
`password.ts` 的 policy import 加 `DEFAULT_PASSWORD`。

**与 `changePassword` 的三处刻意不同**（都写进了代码注释）：
1. **不校验当前密码**——管理员不知道也不该知道民警的密码，「不知道旧密码也能换掉」正是重置的用途。
   ⚠️ **本函数自己不做鉴权**：它是一条**能力**，谁能拿到由网关（管理员后台 + `is_admin`）决定。
   这是有意的分层，不是遗漏——在服务层再判一次会给人一种「这里安全」的错觉，而真正的门禁在别处。
2. **不收新密码参数**，固定回 `DEFAULT_PASSWORD`。让管理员自选新密码是**另一个产品行为**
   （等于让管理员知道民警的密码），design-v2 没写，不擅自加。
3. **`must_change_pw` 置 1**。默认密码是写在 `policy.ts` 与设计文档里的**公开值**，
   重置完不强制改密 = 把账号留在一个谁都能进的状态，正好是 FR-006 要防的事。

**账号不存在时报错、不静默成功**：静默的话管理员会转告民警「用默认密码登录」，
而民警登不进来、**两边都不知道为什么**。`changePassword` 出于需要读行顺带也有这条，
这里显式读一次是为了对齐——多一次 SELECT 换一个看得见的失败。

**⚠️ 又踩了同一类 lint 坑**：我在测试里写了 `(thrown as Error).message`，撞上
`typescript-eslint(no-unsafe-type-assertion)`——与 T013 那条**同一规则**。
处理沿用既有做法：加 `errorOf` 类型守卫（与 `login.test.ts` 的同名 helper 一致），**不加 disable 注释**。
**教训：`failureOf` 返回 `unknown`，要读它的字段就必须走守卫；`login.test.ts` 早就有现成的 `errorOf` 可抄。**

**验收证据（真跑）**：RED 确认为 `Export named 'resetPassword' not found`；
包内 `bun test` **104 pass / 0 fail**（12 文件，+4）；`bunx oxlint packages/auth` **0/0**；
`bun run typecheck` **31/31**；`bun run lint` **4924 warnings / 1 error / 3372 文件**（与基线逐字相同）→ `packages/auth` 0 命中。

**有牙验证（逐个变异，真跑）**：
| 变异 | 结果 |
|---|---|
| `mustChangePw: 1` 改 `0` | **1 条红**（强制改密那条） |
| 不换哈希（只置标记） | **3 条红** |
| 去掉「账号不存在」检查 | **1 条红** |

### T016 [P] [US4] [BE] 停用后保留 30 天（账号侧闭环）✅（2026-09-29，用户裁定方案 A）
**交付物**：迁移 `0002_deactivated_at`（up/down）；`user.ts` 模型加 `deactivatedAt`；
`zombie.ts` 加 `restoreAccount` / `findArchivableAccounts`，`disableAccounts` 改记停用时刻；
`policy.ts` 加 `DEACTIVATED_RETENTION_DAYS = 30`；`zombie.test.ts` 增 9 条；
`migrate.test.ts` 的 `DESIGN_V2_COLUMNS` 与 design-v2 §4.1 的表同步加列。

**⚠️ 加列是平台级改动，不是 002 内部的事**：`deactivated_at` 是 design-v2 §4.1 的**第 16 列**，
原表 15 列里生命周期只有 `status`，**没有任何地方记「什么时候停用的」**——没有它，
FR-010 的「保留 30 天」窗口无从判定（这就是 T016 原先卡住的原因）。
列落在末尾而非 `status` 旁边：`ALTER TABLE ADD COLUMN` 只能追加，而迁移是物理真相
（`migrate.test.ts` 有一条「与 design-v2 **顺序逐字一致**」的强断言钉着，故 design-v2 也照物理顺序写）。

**三分语义（刻意留白第三态）**：`NULL + status=1` 从未停用 / `NULL + status=0` 停用但**时刻未知**
（002 之前的历史数据）/ 非空 + status=0 停用且知道起算点。
**时刻未知的账号一律不进归档清单**——把 NULL 当成「很久以前」会让一次误删再也回不来，
而 FR-010 要的恰恰是「避免误删」。**宁可漏归档，留给人判断。**

**边界与 90 天那条刚好相反**（别照抄）：FR-009 是「**超过** 90 天」（`<`），
FR-010 是「保留 30 天」（保留期满即到期 → `<=`）。写测试时踩过一次：测试名写「恰好 30 天不算」，
实现写的 `<=`，两边打架——**回去核原文，是测试错了**。

**文件系统部分（沙箱归档/恢复/删除）明确不在 002**：002 的沙箱还只是 `createWorkspace` 建的空目录，
没有可作用的对象；写出来只能是一堆无从验证的 `rm -rf`。留 F3（见 tasks.md T016 与 design-v2 §4.3）。

**验收证据（真跑）**：RED 确认为 `Export named 'restoreAccount' not found`；
包内 `bun test` **100 pass / 0 fail**（12 文件，+9）；`bunx oxlint packages/auth` **0/0**；
`bun run typecheck` **31/31**。

**有牙验证（逐个变异，真跑，各恰好 1 条红）**：
| 变异 | 红的哪条 |
|---|---|
| `restoreAccount` 不清 `deactivated_at` | 「恢复：…并清掉停用时刻」 |
| 逾期判定 `<=` 改 `<` | 边界那条 |
| `coalesce(deactivated_at, 0) <= cutoff`（把 NULL 当纪元 0） | 「没有停用时刻的…不进逾期清单」 |
| `disableAccounts` 不写停用时刻 | 「停用时记下停用时刻」 |

**第一条变异暴露了一件值得记的事**：「清空 `deactivated_at`」**今天是与查询冗余的**——
`findArchivableAccounts` 同时要求 `status = 0`，恢复后 `status = 1` 就已被挡住，不清也只红那一条
数据不变式测试。**仍然清**，理由是守住「有值即当前处于停用中」这条不变式：它只在
「每个消费方都记得带 status 过滤」时才成立，而靠查询纪律维持的安全是陷阱——
F3 的归档任务写漏一次 status 条件，动到的就是正在办案的民警的沙箱。**让安全性长在数据上。**

### T015 [P] [US4] [BE] 僵尸账户筛选 + 一键批量停用 ✅（2026-09-29）
**交付物**：新建 `src/zombie.ts`（`findZombieAccounts` / `disableAccounts` / `lastSeenAtOf`）；
`src/zombie.test.ts` 12 条；`policy.ts` 增 `ZOMBIE_INACTIVE_DAYS = 90`。
**顺带的行为不变重构**：`login.ts` / `password.ts` 各抄一份的窄接口提为 `user.ts` 的 `UserAccountTarget`
（第 3 处出现才提，T013 的注释里预支过这句话）；`db.test.ts` 的类型标注随之改名。重构与 T015 **同一提交**，
交付前已验证：重构后包内 79 pass / 0 fail，与重构前逐字相同。

**⚠️ design-v2 §4.3 的字面写法在本仓库会静默失效——这是本任务最关键的判断**：
`:180` 写「识别（`last_active_at` 距今 > 90 天）」，但 **`last_active_at` 全仓库没有写入方**
（design-v2 §4.1 `:135` 说它「请求时更新」——那是**网关每个请求刷一次**，属 T018/F3）。
照字面写 `last_active_at < 截止线`，NULL 的比较结果为 NULL（不为真）→ **永远返回 0 条**。
而 0 条**不报错、不变红**，管理员只会看到「暂无僵尸账户」并信以为真——比报错危险。
**故改为 `coalesce(last_active_at, last_login_at, created_at)`**：三级回退（最准 → 登录过 → 从没登录过）。
**今天就能用**，等网关接上写入方后回退链自然收敛到第一级。
**另一个理由（同样独立成立）**：从没登录过的账号 `last_login_at` 也是 NULL，而**「建号后从没登录过」
恰恰是最该清理的一类**（默认密码多半没改）。字面写法会恰好漏掉这一整类。

**两份实现 + 一条对账测试**：筛选走 SQL 的 `coalesce`，返回的 `lastSeenAt` 走 JS 的 `lastSeenAtOf`，
同一规则写了两次。`zombie.test.ts` 尾部有一条对账测试，对**库里每一行**断言
`「是否出现在名单里」=== status===1 && lastSeenAtOf(row) < 截止线`，两者漂移即红。

**验收证据（真跑）**：RED 确认为 `Cannot find module './zombie'`（0 pass / 1 fail）；
包内 `bun test` **91 pass / 0 fail**（12 文件）；`bunx oxlint packages/auth` **0/0**；`bun run typecheck` **31/31**。

**有牙验证（逐个变异，真跑）**：
| 变异 | 结果 |
|---|---|
| 去掉「只筛启用账户」的 `status = 1` | **3 条红** |
| `coalesce(...)` 换回字面 `last_active_at` | **6 条红**（含「从没登录过」「建号超 90 天」等，即上面那个坑） |
| `<` 改 `<=` | **1 条红**，恰是边界那条 |
| **删掉 `disableAccounts` 的 `if (ids.length === 0) return`** | **0 条红** |

最后一行是**变异验证逼出来的删除**：守卫没有失败测试能区分它（`inArray(id, [])` 生成恒假条件，
一行也动不了）。按「没有失败测试就不写产品码」，那 3 行删了，注释改成「空名单不必特判」。
**这是本次变异验证唯一的意外收获——原以为它是个必要的防御。**

### T014 [US3] [BE] 「稍后修改」下次登录再弹 → 改写为回归测试 ✅（2026-09-29，用户裁定）
**交付物**：`login.test.ts` 增 1 条（`「稍后修改」后再登录仍弹`）。

**原任务按字面是空任务，这已写进 tasks.md 并请用户裁定**：
`login()` 全程只**读** `must_change_pw`（写的是 `last_login_at`），该列只由真的改了密码（`changePassword`）置 0；
而「稍后修改」= 前端关掉弹窗、**不发任何写请求**。故「下次登录仍弹」**一行代码不写就已成立**，
照原样交生产代码只会变成凑数。

**改写后钉的是**：「登录不清 `must_change_pw`」。保护的是一件**真会发生**的事——有人觉得「登录都成功了，
顺手把改密标记清掉吧」，而那会让**强制改密形同虚设**，且**没有任何别的测试会发现**（清掉之后第一次登录看起来完全正常）。

**⚠️ 诚实标注：这条测试没有 RED 阶段**——它断言的是既有行为，写下来就是绿的。
故它的「牙」全靠变异验证：给 `login()` 的 update 加上 `mustChangePw: 0` → **恰好 1 条红**，恢复后全绿。
（这与 T001 那条冒烟测试同类：价值在拦住未来的回归，不在驱动实现。）

**验收证据（真跑）**：包内 `bun test` **79 pass / 0 fail**（11 文件）；`bun run typecheck` **31/31**；
`bun run lint` **4924 warnings / 1 error / 3370 文件**（与基线逐字相同）→ **`packages/auth` 0 命中**；
`bun run lint:openhive` **真实退出码 0**；`bunx oxlint packages/auth` **0/0**。

### T013 [US3] [BE] 改密解除 must_change_pw ✅（2026-09-29）
**交付物**：`src/password.ts` 增 `changePassword` / `PasswordChangeTarget` / `InvalidCurrentPasswordError` /
`EmptyNewPasswordError`；`password.test.ts` 增 4 条（含 DB 断言的 describe）。

**落点选 `password.ts` 的依据**：plan.md 的文件结构明写 `password.ts # 改密 / 重置（must_change_pw 状态流转）`。
哈希原语与用它们的流程同处一文件，改密码策略时只有一个地方要看。

**校验当前密码不是「顺手加固」，是 design 要求的**：design-v2 §8.3（`:321`）把弹窗画成
「**当前密码** + 新密码（强度条）+ 确认」——服务端不验，那个输入框就是摆设；更要紧的是，
**光有会话凭证就能改密**意味着凭证一旦被劫持，攻击者能把真正的用户锁在门外。

**拒绝空密码（地板，不是策略）**：空密码的账号，任何人输空串都能登进去——这是本功能**自己就能造出来**的坏状态。
**但真正的密码强度策略没有实现**：design-v2 只画了「强度条」没写规则，不擅自定一套（见文末遗留项 ③）。

**两个错误类型故意「说得清楚」**（`当前密码不正确` / `新密码不能为空`）：这里与登录侧**相反**——
登录必须含糊（FR-005，防止枚举警号），而改密时用户**已经通过鉴权**，含糊只会让人不知道错在哪。

**`PasswordChangeTarget` 与 `UserLoginTarget` 逐字重复是有意的**：`password.ts` 与 `login.ts` 互相 import
（前者要用后者的接口就会成环），且两种 PG 驱动类型互不可赋值（裁定 ④）。这点重复是**类型别名**，
写错编译器当场抓，不会像复制逻辑那样悄悄漂移。**出现第三处就该提到 `user.ts`**——已写进代码注释。

**依赖修正**：tasks.md 原写 `[T012]`，改成 `[T004]`。T012 已移出 002，且**从来不是真依赖**——改密能力不需要弹窗存在才能写。

**TDD 过程**：RED「Export named 'changePassword' not found」→ GREEN 9 条（本文件）。
**有牙验证**：① 去掉 `mustChangePw: 0` → **恰好 1 条红**；② 拆掉当前密码校验 → **恰好 1 条红**。两次均恢复干净。

**🔧 过程中撞到 2 条新告警，都消掉了（没加 disable 注释，沿用 T008 做法）**
| 告警 | 处理 |
|---|---|
| `preserve-caught-error` | catch 里 throw 新错没挂 `cause` → 改为**不抛出**（`failureOf` 只把错交回来），无 catch-throw 即无告警 |
| `no-unsafe-type-assertion` | `row.must_change_pw as number \| null` → **改断言方式不改实现**：不读该列，改用**登录行为**断言状态未变 |

> 第二处顺带把测试**变强**了：只查列的话，「顺手清了 `must_change_pw`、但哈希没换」的半成品实现能蒙混过关；
> 改成断言「原密码仍可登 + 仍要求改密」才真正咬住「一次失败的改密不能留下任何后果」。
> ⚠️ 代价：首次全量 lint 因此读到 **4926**（比基线 +2），**已修回 4924**——这与 T005 记的那次「读数波动」不同，
> 是真回归。**判据用「新增/改动文件 0 命中」，不用总数**（`#001-02`）。

**验收证据（真跑）**：包内 `bun test` **78 pass / 0 fail**（11 文件）；`bun run typecheck` **31/31**；
`bun run lint` **4924 warnings / 1 error / 3370 文件**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ **`packages/auth` 0 命中**；
`bun run lint:openhive` **真实退出码 0**；`bunx oxlint packages/auth` **0/0**。

### T011 [US2] [BE] 停用账号登录拒绝 ✅（2026-09-29）
**交付物**：`src/login.ts` 增一句停用判定；`login.test.ts` 增 2 条（停用被拒 / 密码对错同错）。

**提示口径选了「不区分」**：停用账号也报 FR-005 那句「账号或密码错误」，**不另给「账号已停用」**。
依据：FR-005 写的是「**登录失败** MUST 统一提示……不暴露账号是否存在」——无限定的绝对句；
design-v2 §8.3（`:320`）与安全节（`:888`「统一登录失败响应」）同口径；FR-008 只说「拒绝登录」，未指定文案。
**代价**：被停用的民警（尤其 90 天未活跃被批量停用的）只会看到「账号或密码错误」，
容易误以为是自己忘了密码，得走一圈到管理员那里才知道。**若产品上更看重这条，改独立文案是一行改动，但须先定。**

**🔑 位置是安全决策，不是排版**：判定放在**密码校验之后**。
挪到之前的话，停用账号会**跳过 argon2** 直接返回，耗时与「正常账号 + 错密码」可测量地不同——
外人拿它当探针就能枚举「哪些警号被停用了」。放在之后，只有**已出示正确密码**的人才走得到，对外无可观察差异。
（这跟已有的「警号不存在 → 直接返回」是同类问题，见文末遗留项 ①。）
**⚠️ 诚实标注**：这一条**没有测试能钉**——两种次序对外行为完全相同，只差耗时，写时序断言会变成 flaky 测试。
故只落成代码注释，属「靠评审与注释守」而非「靠测试守」。

**「不刷新最后登录时间」不是顺带**：检查在 `update` 之前，否则停用账号会留下一串登录痕迹，
运维看 `last_login_at` 会以为它还在被人使用。

**TDD 过程**：RED 两条——`Expected constructor: [class InvalidCredentialsError]` / `Received value: undefined`，
即「停用账号居然登录成功」，失败原因正确（缺功能，不是笔误）→ GREEN 74 pass。
**有牙验证**：注释掉 `if (record.status !== 1)` → **2 条齐红**，其余 9 条不受影响；恢复后全绿、无残留。

**验收证据（真跑）**：包内 `bun test` **74 pass / 0 fail**（11 文件）；`bun run typecheck` **31/31**；
`bun run lint` **4924 warnings / 1 error / 3370 文件**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ **`packages/auth` 0 命中**；
`bun run lint:openhive` **真实退出码 0**（`oxlint` 0 error）；`bunx oxlint packages/auth` **0/0**。

### T009 [US2] [INT] 登录流程 ✅（2026-09-29）
**交付物**：`src/login.ts`（`login` / `InvalidCredentialsError` / `UserLoginTarget`）+ `login.test.ts`（9 条）；
`db.test.ts` 增生产驱动接口断言 1 条。

**本 task 关掉了 T004 留下的交接项**（曾挂在 state.md 顶部）：
`Bun.password.verify` 对空 hash 返回 `false`、对**垃圾 hash 抛** `UnsupportedAlgorithm`。放任它抛出去，
调用方会回 500——与 FR-005 的统一提示不一致，等于**变相告诉对方「这个账号有异常」**，反而制造了一个可枚举信号。
`passwordMatches()` 把它归为「不匹配」。
**有牙验证**：拆掉那个 try/catch → 该测试当场抛 `UnsupportedAlgorithm` 变红。

**FR-005 统一性落在类型层面**：账号不存在与密码错误抛**同一个** `InvalidCredentialsError`、同一句消息。
不设两个错误类型是有意的——一旦有细分类型，调用方迟早会分支处理，这条要求在类型系统里就失守了。
**有牙验证**：把「账号不存在」改成单独报错 → 对应测试红。

**`mustChangePw` 的落点**：随 `LoginResult` 透出供 T012 决定弹不弹窗。**刻意不塞进 JWT 载荷**——
载荷是线格式契约（T005 有测试逐字钉 `Object.keys`），加字段的改动面比加一个返回字段大得多。

**⚠️ 出参「进入主界面」未做，且在当前结构下做不了——需用户确认**
tasks.md 原文写「校验密码 → 签发凭证 → **进入主界面**」，但：
- plan.md 的「项目文件结构」里**没有任何 HTTP 层**（无 server / route / handler 文件），
- 002 也没有前端目录，FE 任务（T010/T012）目前只有标题、没有落点。

故本 task 按 [INT] = **服务层集成**落地（把 T003 用户表 / T004 密码 / T005 凭证接起来），
出参改述为「拿到可校验的会话 Cookie」。「进入主界面」需要 T010 登录页 + F1 三栏，是纯前端的事。
**已在报告中向用户提出**：若期望 002 交付一个真正可登录的 HTTP 端点，那是范围决策，需要用户先定。

**TDD 过程**：RED「Cannot find module './login'」→ GREEN 9 条。
**有牙验证**：见上两处，各自只红对应的一条，其余不受影响。

**验收证据（真跑）**：包内 `bun test` **72 pass / 0 fail**（11 文件）；`bun run typecheck` **31/31**；
`bun run lint` 文件数 3368→**3370**、命中数 **4924 warnings / 1 error**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ **`packages/auth` 0 命中**；
`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

**⚠️ 两个已知未处理项（有意，非遗忘）**
1. **用户枚举的时序侧信道**：密码错误要做一次 argon2 校验，账号不存在直接返回——**耗时不同**，理论上可用来枚举警号。
   FR-005 只要求**提示**一致，没要求**耗时**恒定。补法是在查不到时也跑一次假哈希（约 2 行），
   但那属未被要求的功能，且会放大未知警号的校验开销。**判定：不擅自加，交用户定。**
2. **hash 损坏的账号被静默当成密码错误**：用户永远登不进来，运维也无从得知。
   这是拿**可观测性**换 FR-005 的 conscious tradeoff。要补的话应在 `passwordMatches` 里接日志，
   而不是把错抛出去（抛出去就退回 500 了）。详见 `login.ts` 内注释。

### T008 [US1] [BE] 警号唯一性校验 ✅（2026-09-29）
**交付物**：`register.ts` 增 `DuplicatePoliceNoError` + 私有 `insertUser()`（挂捕获）+ `register.test.ts` 增 5 条；
新增 `src/pg-errors.ts`（`pgErrorCode`）+ `pg-errors.test.ts` 2 条。

**检查放在哪——捕获 23505，不做前置 SELECT 预检**：
预检有 **TOCTOU 竞态**——两个管理员同时录同一个警号，双方都通过预检，仍会有一个撞上 UNIQUE。
既然捕获省不掉，预检就只是多一次查询、一个额外的失败点，并不减少任何一类错误。故只保留捕获这一条权威路径。

**只翻译 23505，其余不原样抛、也不误判**：有一条测试专门钉这个——先把 `auth.user` 表 `drop` 掉制造 `42P01`，
断言它**不是** `DuplicatePoliceNoError`。否则「表不存在」会变成「警号重复」，运维会被彻底带偏。

> ⚠️ **本节已被 I2 修订（2026-09-29，见下方「收尾评审发现与处置」）**。「其余**原样抛**」是 T008 当时的
> 实现；收尾复审发现 `DrizzleQueryError.message` **内联了查询参数**，而这条 insert 的参数里有
> `password_hash` / `id_card` / `phone` —— 原样抛等于把三样一起交出去。现改为非 23505 一律换成
> **不带参数**的 `AccountWriteError`（SQLSTATE 单独带出）。**排查线索没丢**（SQLSTATE 仍可取），
> 但「原错误挂在 `cause` 上」这句已不成立——读本节时请以 I2 的口径为准。

**`src/pg-errors.ts` 的来历（重构披露）**：`pgErrorCode` 原本长在 T003 的 `migrate.test.ts` 里。
T008 起生产也要用它，于是抽成生产模块，`migrate.test.ts` 改为 import——两处共用一份，
避免「drizzle 改了包装方式、只有一边跟着改」这种漂移。**本次改动了 T003 的测试文件**，特此记录。

**TDD 过程**：RED「Export named 'DuplicatePoliceNoError' not found」；`pg-errors.test.ts` 另起一轮 RED → GREEN。
**有牙验证**：把 `if (pgErrorCode(cause) === UNIQUE_VIOLATION)` 放宽成 `if (true)` → 那条防误判测试变红，其余 15 条不受影响。

**验收证据（真跑）**：包内 `bun test` **62 pass / 0 fail**（10 文件）；`bun run typecheck` **31/31**；
`bun run lint` 文件数 3366→**3368**、命中数 **4924 warnings / 1 error**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ **`packages/auth` 0 命中**；
`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

> 🔧 过程中 `register.test.ts` 出现 2 条 `no-unsafe-type-assertion`（`thrown as Error`）。
> 按 `#001-05` 所在文件的既定做法，用类型守卫（新增 `errorOf()` 助手）消掉，**没有加 disable 注释**。

### T007 [US1] [BE] 录入时创建沙箱目录 ✅（2026-09-29）
**交付物**：`src/workspace.ts`（`workspaceRoot` / `createWorkspace` / `WORKSPACE_ROOT_ENV`）+ `workspace.test.ts`（6 条）；
`register.ts` 增 `provisionUser(db, input, workspaceRoot)` → `{ id, workspace }` + 4 条流程测试。

**为什么要有 `provisionUser`**：FR-003 要求「建账号」与「建沙箱」一次发生。若只提供两个独立函数，
后续每个调用方都得自己记着按序调两个——FR-003 就没有代码承载点，漏调不会被任何东西发现。

**顺序裁定：先落库、后建目录**，且**有测试钉住**（那条「落库被拒时不留垃圾目录」）：
- 重复警号（T008 的主场）在落库这步被 PG UNIQUE 挡下，此时目录还没建 → **不留垃圾目录**。这是更常见的失败。
- 反过来先建目录、落库失败，每次重试漏一个空目录。
- 该测试对 T008 的实现方式是健壮的：无论 T008 是预检查还是捕获 23505，都不会建出目录。

**建目录失败时不做补偿删除**：PG 事务管不到文件系统。曾考虑「建目录失败就把已插入的行删掉」/「落库失败就把目录删掉」，
均否掉——`rm -rf` 一个用户沙箱是**破坏性**操作，里面可能有真实研判产物，而补偿逻辑本身也可能有 bug。
宁可留一个空目录（零成本、可人工清理），也不冒误删用户数据的风险。故障原样抛出，不静默返回一个没有沙箱的账号。

> ✏️ **2026-10-01 更正（003 的 T022 反转了上面这两条裁定）**——原文保留，见下面的分条回应。
> **新事实**：上面「宁可留一个空目录……不静默返回一个没有沙箱的账号」里那个「不静默」**只对了一半**。
> 错误确实抛出去了，但**库里那行没人管**：它带着默认口令的 hash、`status` 取自录入表单
> （正常录入新民警就是 1），而 `login` 的判据只卡 `status !== 1` 与密码 ⇒ **它能登录**。
> 于是「一次管理员看到的失败」实际留下了一个**能过认证、却没有沙箱**的账号，并且**挡住重试**
> （同警号再录撞 UNIQUE，管理员只会看到「该警号已录入」，而那个账号用不了）。
> **003 实测确认**（不是推演）：`register.test.ts` 里那条「建目录失败之后，那个警号登不进来」
> 在反转前是**红的**——`login` 真的放行了。
>
> **处置（用户 2026-10-01 裁定）：反转顺序，先建目录、后落库。** 目录建不出来时账号行**根本还没被插**，
> 是**结构性做不到**，不是事后补偿。上面两条否掉的理由逐条回应：
> ① 「`rm -rf` 用户沙箱是破坏性操作，里面可能有真实研判产物」——**仍然成立，故不 `rm -rf`**：
>    清理用 `rmdir`，它**拒绝删除非空目录**，这个安全性是内建的；而且清理的对象是本次刚建的空目录
>    （`id` 是当次新生成的 UUID，必然是新目录）。
> ② 「补偿逻辑本身也可能有 bug」——**这条没有根治**，只做了两件事：清理只在一处、且有一条测试钉住它
>    真的在跑（003 的变异检验：删掉清理 ⇒ 「不留垃圾目录」那条红）。清理自身失败的路径**无测试守着**，
>    已登记在 003 `state.md` 的缺口表。
> ③ 上面「顺序裁定」那条的**结果**（重复警号不留垃圾目录）在反转后**仍然成立**，只是改由清理达成，
>    代价是常见失败多一次 `mkdir` + `rmdir`。那条测试的断言没变、名字与注释已改。
> ④ 上面「有牙验证 ① 顺序倒置成『先建目录』→ 2 条红」——**那个倒置现在就是实现**，
>    该变异已失效（不再能证明什么）。
>
> 📌 **同上，别照抄 002 的这条裁定**——新信息（半成品能登录）推翻了它的前提。

**路径穿越守卫**：`userId` 为空、含 `/` 或 `\`、或等于 `.` / `..` 时拒绝。
依据 design-v2 §5.3（`2026-09-06-openhive-design-v2.md:229`）——`{userId}` 就是**用户之间的隔离边界**，
「应用层锚定（防越权）」正是该节列的第一道锁。当前调用方传的是 `crypto.randomUUID()`（不可能触发），
但 F3 的中间件也会走这个函数，在唯一的建目录入口守一次比在每个调用点守可靠。

**`OPENHIVE_WORKSPACE_ROOT`**：新增环境变量，未配置时落到 design-v2 规定的 `/workspaces`。
有默认值（区别于 `AUTH_JWT_SECRET` 的「缺了就报错」）——因为文档已把 `/workspaces` 定为标准路径，
配了反而多一步。**但需要部署方确认挂载点**，见下方「待补环境变量」。

**TDD 过程**：RED「Cannot find module './workspace'」→ GREEN 6 条；再 RED「Export named 'provisionUser' not found」→ GREEN 流程 4 条。
**有牙验证**：① 顺序倒置成「先建目录」→ **2 条红**；② 拆掉穿越守卫 → 1 条红。两次均恢复干净、无残留。

**验收证据（真跑）**：包内 `bun test` **55 pass / 0 fail**（9 文件）；`bun run typecheck` **31/31**；
`bun run lint` 文件数 3364→**3366**、命中数 **4924 warnings / 1 error**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ **`packages/auth` 0 命中**；
`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

> ⚠️ **未接生产**：`workspaceRoot(env)` 目前无生产调用方（HTTP 层在 T009/T018 才出现）。
> 但它是纯函数、离线可测，与 T005 的 `jwtSecret(env)` 同性质，故不适用 T001 那条「无测试的生产代码」的推迟理由。

### T006 [US1] [BE] 管理员录入账号 ✅（2026-09-29）
**交付物**：`src/register.ts`（`registerUser` / `UserInsertTarget` / `RegisterInput`）+ `register.test.ts`（7 条）；
`src/time.ts`（`nowSeconds`）+ `time.test.ts`（2 条）。

**窄接口**：`UserInsertTarget` 只收「能往 `user` 表插一行」这一件事。两种驱动的 drizzle 数据库类型**互不可赋值**
（探测确认根因同裁定 ④：`Results<never>` vs `never[]`）。`values` 的入参类型从 `user.$inferInsert` **推导**而非手抄——
顺带发现这个位置**不是**双变放水的：字段不全的入参会被拒，且所有 NOT NULL 列都必须提供。
`db.test.ts` 加了一条类型标注断言，钉住**生产驱动（bun-sql）**也满足该接口——否则它只被 PGlite 验证过。

**两个默认值显式写出**（不靠列默认值）：
- `isAdmin: 0` —— 8 个业务字段里没有「是否管理员」，所以录入出来的账号一律不是管理员。**提权必须是另一条独立路径**，
  否则管理员录入界面本身就成了提权入口。
- `mustChangePw: 1` —— FR-003 的**要求**，写在调用点才看得见。

**🔴 本 task 撞到并修掉一个真缺陷（已请用户裁定）**：
用户表时间列在 design-v2 §4.1 是 PG `integer`（int4 上限 **2147483647**），而 `Date.now()` 返回**毫秒**（1.79e12）——
超三个数量级，`22003 numeric_value_out_of_range`，**首行都插不进去**。文档只写了 `INTEGER` 没写单位，属真实二义。
用户裁定 **A：沿用 INTEGER、统一存 Unix 秒**（理由：与文档吻合；与 JWT `exp` 同单位，同一模块不混两套时间单位；
将来要扩到 2038 之后，`alter column ... type bigint` 是**值不变**的加宽）。
落地四点：① 新增 `src/time.ts` 的 `nowSeconds()`，名字自带单位；② `register.ts` 与 `migrate.ts` 记账表都改走它
（记账表原先也是毫秒，属同一处内部不一致，一并纠正）；③ `0001_init.sql` 与 `user.ts` 补单位注释；
④ 加**单位锁**测试（断言与 `Date.now()/1000` 同量级），防复发。

**TDD 过程**：RED「Cannot find module './register'」；时间单位先写 `time.test.ts` RED → GREEN；
`created_at` 单位断言先加 RED（当时 7 条全红，全因毫秒）→ 改 `register.ts` GREEN。
**有牙验证**：把 `nowSeconds()` 临时改成 `Date.now()` → **9 条齐红**（时间锁 + 7 条录入 + 记账单位），恢复后全绿、无残留。

**验收证据（真跑）**：包内 `bun test` **45 pass / 0 fail**（8 文件）；`bun run typecheck` **31/31**；
`bun run lint` 文件数 3360→**3364**、命中数 **4924 warnings / 1 error**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ **`packages/auth` 0 命中**；
`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

> 📌 **未做（有意）**：警号唯一性拒绝（T008）、沙箱目录创建（T007）都不在本 task 内。数据库层 UNIQUE 约束已在迁移里，
> 本 task 录入重复警号会撞 PG 23505 直接抛——**友好的拒绝提示留给 T008**。

### T005 [P] [BE] 登录凭证签发与下发（JWT + httpOnly Cookie）✅（2026-09-29）
**交付物**：`src/token.ts`（`jwtSecret` / `signToken` / `verifyToken` / `sessionCookie`）+ `src/token.test.ts`（10 条）；
`policy.ts` 补 `SESSION_COOKIE_NAME = "openhive_session"`、`JWT_SECRET_ENV = "AUTH_JWT_SECRET"`；
`package.json` 加 `hono: catalog:`（实测解析到 4.10.7，`bun.lock` 仅 +1 行）。

**线格式契约**：载荷是 `{ sub, police_no, name, is_admin, exp }`，与 design-v2 §4.1（`2026-09-06-openhive-design-v2.md:150`）逐字对齐。
专门写了一条**不验签、直接 base64 解载荷**的测试断言 `Object.keys`——只断言 `verifyToken().id === "u1"` 挡不住「内部映射对了、线上字段名写错」，
而字段名是跨服务契约，错了要到前端或网关才炸。

**`verifyToken` 的载荷校验**：4 个 claim 全类型正确才返回。这不是「防御不可能的输入」——函数签名承诺返回完整 `TokenSubject`，
不校验就会让调用方拿到 `undefined` 却被类型告知是 `string`。`is_admin` 要求 `boolean` 而非 truthy，避免 `"false"` 这类字符串被判为真。

**Cookie 设计**：`httpOnly` + `sameSite=lax` + `path=/`，`maxAge` 取 `TOKEN_TTL_SECONDS`。
**`secure` 默认关**（可选参数开）——内网部署多为 HTTP，置 true 浏览器会**静默丢弃** Cookie，症状是「登录成功但立刻又未登录」，极难归因；网关前挂 HTTPS 时再由调用方开。

**🔑 运维动作（需用户执行）**：新增环境变量 **`AUTH_JWT_SECRET`**，`.env` 目前**没有**这一项（现有仅 `PG_*` / `DEEPSEEK_*` / `MINIO_*` / `RABBITMQ_*` / `RAGFLOW_*`）。
`jwtSecret()` 缺值**点名报错、不兜默认值**——仓库里放默认密钥等于给所有人发万能钥匙。部署前需生成一个随机串写入 `.env`。

**TDD 过程**：RED「Cannot find module './token'」→ GREEN 4 个函数。
**有牙验证**：临时停掉 `verifyToken` 的载荷校验 → **只有**「签名合法但载荷缺字段的凭证被拒」变红，其余 9 条不受影响 → 证明该断言咬的是真实逻辑。
**自纠**：token.test.ts 首版有 4 处 `await expect(...).rejects.toThrow()` 触发 `await-thenable` 告警（Bun 把 `rejects.toThrow()` 类型标为非 Promise）——
改为 `failureOf()` 显式 catch 助手，既消警又让「抛没抛」成为可断言的返回值。

**验收证据（真跑）**：包内 `bun test` **34 pass / 0 fail**（6 文件）；`bun run typecheck` **31/31**；
`bun run lint` 文件数 3358→**3360**、命中数 **4924 warnings / 1 error**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ **`packages/auth` 0 命中**；
`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

> ⚠️ 过程记录：本 task 首次全量 lint 读出 **4923**（比基线少 1）。未按「大概是抖动」放过，而是**同代码连跑两次复核**——两次均 **4924**，
> 与基线一致，且 `packages/auth` 0 命中、唯一 error 位置未变。故判定为 `#001-01` 记录的 oxlint 12 线程计数抖动，非回归。

### T004 [P] [BE] 密码哈希与校验函数 ✅（2026-09-29）
**交付物**：`src/password.ts` —— `hashPassword(plain)` / `verifyPassword(plain, hash)`。

设计意图：这是**唯一**接触密码哈希的地方。T006（录入）、T013（改密）、T017（重置）都走这两个函数，
哪天要换算法只改一处。算法取值从 `policy.ts` 取，不在此处硬编码——「锁定值只写在 policy 里」。

**TDD 过程**：RED「Cannot find module './password'」→ GREEN 两个函数（argo2id 由 `Bun.password` 承担）。

**有牙验证**：把 `policy.ts` 的 `PASSWORD_HASH_ALGORITHM` 临时改成 `"bcrypt"` → **只有**「算法锁定为 argon2id」那条变红，
其余 4 条不受影响 → 证明 policy → password 的接线是真的（否则该测试只靠 Bun 默认值恰好也是 argon2id 而「假绿」）。

**验收证据（真跑）**：包内 `bun test` **24 pass / 0 fail**；`bun run typecheck` **31/31**；
`bun run lint` 文件数 3356→**3358**、命中数 **4924 warnings / 1 error**（与基线逐字相同，1 error 仍是上游 session-ui 那条）→ 新增文件 0 命中；
`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

## 交接项（留给后续 task，勿丢）

### ⚠️ → T009：`verifyPassword` 对畸形 hash 的两种表现（实测）
| 输入 | `Bun.password.verify` 表现 |
|---|---|
| 正常 argon2id hash | `true` / `false` |
| 空串 `""` | `false`（不抛） |
| 垃圾串 `"not-a-hash"` | **抛** `Password verification failed with error "UnsupportedAlgorithm"` |

T004 **有意不兜**（库里的 hash 由本模块自己写入，畸形属「不可能的输入」，提前防御是投机）。
但 T009 的登录路径必须决定：垃圾 hash 抛出去就是 HTTP 500，而 FR-005 要求**统一提示「账号或密码错误」**——
500 与统一提示不同，等于**变相泄露「这个账号有异常」**。届时要么在登录层兜住，要么论证它确实不可能发生。

### T003 [BE] 实现用户表模型与迁移 + PG 连接 ✅（2026-09-29）
**交付物**（`packages/auth/src/`）：

| 文件 | 职责 |
|---|---|
| `migrations/0001_init.sql` | `auth.user` 建表（15 列，design-v2 §4.1 逐字） |
| `migrations/0001_init.down.sql` | `DROP TABLE auth.user` |
| `migrate.ts` | `migrate()` / `rollback()` / `rowsOf()` |
| `user.ts` | drizzle pg-core 模型（**只做类型安全查询**） |
| `db.ts` | 补 `connect()`（`drizzle-orm/bun-sql`） |

**迁移机制（用户裁定：手写 up/down）**：
- 运行器**自动执行**，PG 里不需要人工敲任何 SQL（这是用户此前问清的点）。
- 记账表 `auth._migration (version, applied_at)` 让 `migrate()` 幂等——部署可无脑重复调。
- `auth` schema 由运行器 bootstrap（`create schema if not exists`），不写在 0001 里。
- 语句按 `--> statement-breakpoint` 切分逐条执行（drizzle-kit 同款约定）：多语句一次下发在各驱动上不可移植。

**TDD 过程**（RED→GREEN，逐条看过失败）：
1. RED「Cannot find module './migrate'」→ GREEN 建表 + 唯一约束
2. RED「relation "user" already exists」（重复执行）→ GREEN 加记账表
3. RED「rollback is not defined」→ GREEN 加 down 脚本与 `rollback()`
4. RED「Cannot find module './migrate'」（db.test）→ GREEN 加 `connect()`
5. 补 `rowsOf` 三态单测后**做了「拆掉实现看是否变红」的有牙验证**——只数组那条红，另两条不受影响

**诚实标注**：
- 「警号唯一约束」与「建表」共用同一份 DDL、同一次 GREEN，**无独立 RED**（DDL 是先写下的断言、再照它写 SQL，不是事后补测）。
- 防漂移测试里 `DESIGN_V2_COLUMNS` 是我从 design-v2 §4.1 的**人工转录**，不是机器解析。它保证「SQL ↔ drizzle 模型」不漂移，但**挡不住两侧同时抄错**。要做成机器校验需解析设计文档，超出本 task。
- 迁移文件是**运行时从磁盘读**的（`import.meta.dir`），不参与打包。若日后改成 bundle 部署，需确认 `.sql` 被打进产物。

**验收证据（真跑）**：包内 `bun test` **19 pass / 0 fail**；`bun run typecheck` **31/31**；`bun run lint` 文件数 3350→**3356**、命中数 **4924 warnings / 1 error**（与 001 基线逐字相同，那 1 error 仍是登记在案的上游 `packages/session-ui/src/v2/components/prompt-input/index.tsx:163`）→ 新增文件 0 命中；`bun run lint:openhive` **exit 0**；`bunx oxlint packages/auth` **0/0**。

### T002 [P] [BE] 锁定认证策略 ✅（2026-09-28）
方案记录在案（可执行版落在 `packages/auth/src/policy.ts`）：

| 项 | 锁定值 | 来源 |
|---|---|---|
| 默认密码 | `admin@123456` | design-v2 §4.1（`2026-09-06-openhive-design-v2.md:147`）**已定，沿用未改**（用户确认） |
| 哈希算法 | `argon2id` | plan.md 依赖清单；用 **`Bun.password` 内建**实现（实测产出 `$argon2id$v=19$m=65536,t=2,p=1$`，verify 正确/错误均正确）→ **零新增依赖** |
| 凭证有效期 | 7200 秒（2 小时） | spec.md FR-004 / Assumptions |
| JWT 库 | `hono/jwt` | 用户裁定。实测 **`Bun.jwt` 不存在**（已排除）；`hono` 4.10.7 已在 catalog → 依赖在 T005 落 |

- **测试样例**：`src/policy.test.ts`（5 条）——常量契约 2 条 + argon2id 安全属性 3 条（哈希不含明文、**同一密码两次哈希不同**/盐随机、verify 往返）。
- **诚实标注**：argon2id 那 3 条**不是本模块的行为测试**，它们断言的是 `Bun.password` 的行为；价值在于**锁定方案**——若有人日后换成固定盐或换掉算法，这几条会红。真正的行为测试从 T004（哈希函数）起。
- 验收：包内 `bun test` **9 pass / 0 fail**；`bun run typecheck` **31/31**；`bunx oxlint packages/auth` 0/0。

### T001 [P] [BE] 新建 Auth 服务模块目录与构建配置 ✅（2026-09-28）
- **落点** `packages/auth/`：`package.json`（`@opencode-ai/auth`，scripts `test`/`typecheck` 照 `packages/effect-drizzle-sqlite` 约定）、`tsconfig.json`（extends `@tsconfig/bun`）、`src/db.ts`、`src/db.test.ts`。
- **TDD 过程**（RED→GREEN 两轮 + 一次类型 RED）：
  1. RED `Cannot find module './db'` → GREEN `resolveDatabaseUrl` 最小实现（2 tests）
  2. RED 密码 `p@ss:w/rd` 未转义冲垮连接串结构 → GREEN 加 `encodeURIComponent`（3 tests）
  3. RED tsgo `TS2345: '[PGlite]' is not assignable`（运行时能跑、类型不合法）→ GREEN 改 `drizzle({ client: new PGlite() })`（位置传参不在类型签名里）
- **验收证据（真跑）**：`bun run typecheck` **31/31**（区间原 30，证明新包进 turbo 图）；包内 `bun test` **4 pass / 0 fail**；`bun run lint` 文件数 3348→**3350**、命中数 **4924 warnings / 1 error（与 001 基线逐字相同）** → 新增文件 0 命中；`bunx oxlint packages/auth` 0/0。
- **诚实标注**：`db.test.ts` 里「PG 工具链」那条**是冒烟测试，不是行为测试**——它断言的是第三方接线（drizzle + PGlite 能跑 SQL），没有 RED 阶段，价值在于拦住「依赖没装对/方言不通」这类问题（即本次 49 个假错的同类）。T001 真正被 TDD 覆盖的单元是 `resolveDatabaseUrl`。
- **未落的东西（有意）**：`connect()`（生产的 `drizzle-orm/bun-sql` 连接）**没写**——它需要真实 PG，离线测不了，先写就是「无测试的生产代码」。留到 T003 与迁移一并落地。

## 关键裁定（开工前，2026-09-28）

### ① R4 用户表存储 → 并入业务 PG，落独立 `auth` schema
- **裁定**：用户表存 `.env` 的 `PG_*` 所指向的 `openhive` 库，建独立 `auth` schema（`auth.user`）。
- **理由**：`user_role (user_id, role_id)`（design-v2 §14.3，`:878`）与 `fund_project_member (fund_project_id, user_id, ...)`（§14.1，`:442`）都在业务 PG，且 §14.1 写明数据范围是「运行时由 MCP 查询语句 join『数据项目 ↔ 用户』关联表实时算出」（`:847`）。账号表若另立存储，从 F4/F10（治理后台 = 账号 × 组织 × 角色 × 数据权限联合视图，PRD `:113`）起会持续制造跨存储 join。
- **否掉的备选**：Auth 自有 SQLite（跨存储 join）；同实例独立 database（PG 跨库无法 join，等于没解决）；public schema + 表名前缀（账号与业务混在同一命名空间，受限 DB 账号授权要按表逐个 GRANT）。
- **连带修订**：`plan.md` 的 Storage 行、Structure Decision、R4 行已同步。

### ② Auth 服务目录 → `packages/auth/`（原 plan 写顶层 `auth/`）
- **理由**：根 `package.json` workspaces = `packages/*`（+ `packages/console/*`、`packages/stats/*`、`packages/sdk/js`、`packages/slack`）。顶层 `auth/` **不是 workspace 成员**，turbo typecheck 与 `bun test` 都覆盖不到 → 架空宪法 §五质量门禁。落 `packages/auth/` 符合宪法 §三「包在 `packages/*`」，且不动上游 `package.json`（宪法 §一）。
- **连带修订**：`plan.md` 项目文件结构与 Structure Decision 已同步。

### ③ 实现方式（随 ①② 定下）
- 访问层：`drizzle-orm` + `drizzle-orm/bun-sql`（走 Bun 内建 SQL 客户端，**零新增驱动依赖**；drizzle-orm 1.0.0-rc.2 已含该 dialect）。
- 测试：`@electric-sql/pglite`（WASM 内嵌 PG，进程内跑，离线可跑、真 PG 语义如 UNIQUE 约束可验）。`drizzle-orm/pglite` dialect 已存在；`@electric-sql/pglite` 当前**不在依赖树**，需新增（devDependency 性质）。

### ④ 两个 PG 驱动的 `execute()` 行结构不同（T003 实测，类型系统当场抓到）
- `drizzle-orm/pglite` → 结果形如 `{ rows: [...] }`；`drizzle-orm/bun-sql` → **直接就是行数组** `[...]`。
- **发现方式**：`db.test.ts` 里写了 `const target: MigrationTarget = connect(env)`，tsgo 报 TS2322 当场暴露。
  若无此断言，这坑会潜伏到部署连真 PG 时才炸（且症状是 `undefined.map`，不好归因）。
- **应对**：`MigrationTarget` 的 `execute()` 返回值收成 `unknown`，由 `rowsOf()` 显式抹平两种形态；
  两种都不像时报错而非静默返回空。**不能用 `PgAsyncDatabase<any, any>`「抹平」**——实测它确实能让两个驱动都编译通过，
  但那只是把类型警报掐掉：运行时 `result.rows` 在 bun-sql 上仍是 `undefined`。
- 附带：`drizzle-kit` **没有 down/回滚能力**（只有 generate/migrate/push…），这也是「手写 up/down」更稳的一条实证。

### ⑤ 时间列一律存 **Unix 秒**（T006 请用户裁定）
- **背景**：design-v2 §4.1 的用户表时间列写 `integer` 但**没写单位**。PG `integer` = int4，上限 `2147483647`；
  Unix 毫秒现在是 `1.79e12`——T006 首次录入账号时实测 `22003 numeric_value_out_of_range`，**一行都插不进去**。
  这不是「防御不可能的输入」，是眼前就挡路的真缺陷，且 T003 已把它提交进 0001_init。
- **裁定（用户选 A）**：列类型沿用 `integer`，**存 Unix 秒**。上限 2038-01-19，将来要扩则
  `alter table auth.user alter column created_at type bigint` 属**值不变**的加宽，非破坏性迁移。
- **否掉的备选 B**：改 `bigint` 存毫秒 —— 偏离 design-v2 原文，且会与 JWT 的 `exp`（本来就是秒）在同一个模块里并存两套单位，
  早晚有人拿 `last_login_at` 去和 `exp` 比。
- **落地约定（后续 task 必须遵守）**：写入一律走 `src/time.ts` 的 `nowSeconds()`，**不要直接写 `Date.now()`**。
  迁移记账表 `_migration.applied_at` 一并从毫秒纠正为秒（内部记账，列类型仍 bigint，只看单位）。
- **防复发**：`time.test.ts` 断言 `nowSeconds()` 与 `Date.now()/1000` 同量级（写成毫秒即红）；`register.test.ts` 与
  `migrate.test.ts` 各有一条断言落库值量级。**有牙验证**：把 `nowSeconds()` 改成毫秒 → 9 条齐红。

## 环境基线（真跑所得，非推断）

### Step 0 验证（2026-09-28）
| 项 | 结果 |
|---|---|
| `git merge-base --is-ancestor multi-tenant HEAD` | ✅ 退出码 0，基点正确（绕开 `#001-03`） |
| 分支 | `worktree-feat-002-auth-account` |
| `bun run typecheck` | ✅ `30 successful, 30 total`，exit 0 |

> ⚠️ **worktree 首次 typecheck 必须先 `bun install`**：本 worktree 初始无 `node_modules`，首跑 `@opencode-ai/app#typecheck` 报 **49 个假错**（TS2307「Cannot find module 'solid-js' / 'bun:test' / 'fuzzysort' / '@opencode-ai/ui' …」+ TS7026/TS2875 JSX.IntrinsicElements），**不是** Step 0 预设的 `core.symlinks` 问题（那是 TS1128，且本机未复现）。`bun install` 后同一命令即 30/30 全绿。
> `bun install` 唯一报错：`tree-sitter-powershell` 的 node-gyp 原生编译失败（本机无 Visual Studio C++），属**预存局部环境问题**，不影响 TS 模块解析。

### 基础设施（`.env` 预置，代码侧零引用 —— 002 是首个连 PG 的 feature）
- `PG_HOST=8.136.21.218` / `PG_PORT=35432` / `PG_DATABASE=openhive` — TCP 端口**实测可达**（2026-09-28）
- 另有 `DEEPSEEK_*` / `MINIO_*` / `RABBITMQ_*` / `RAGFLOW_*`（本 feature 不用）
- 全仓库 `*.ts/tsx/json/md/toml/yaml/yml` 内 **`PG_` 零命中** → PG 访问层（连接 + 迁移 + 回滚）需本 feature 从零建

### 🔑 待补环境变量（部署前必须，T005 引入）
| 变量 | 状态 | 用途 |
|---|---|---|
| `AUTH_JWT_SECRET` | ❌ **`.env` 中尚无**，需部署方生成随机串写入。**必须 ≥ 32 字符**（I7 加的地板，依据 RFC 7518 §3.2；短了抛 `WeakJwtSecretError`） | `src/token.ts` 签发/校验 JWT 的 HS256 密钥 |
| `OPENHIVE_WORKSPACE_ROOT` | ⚠️ **可选**，未配置时用 `/workspaces` | 每用户沙箱目录的根（`src/workspace.ts`） |

代码侧**不提供默认值**：`jwtSecret()` 缺值时点名报错（`缺少环境变量 AUTH_JWT_SECRET`）。理由见 T005 节。
`OPENHIVE_WORKSPACE_ROOT` 相反——**有默认值**，因为 design-v2 §5.3 已把 `/workspaces` 定为标准路径；
只有当部署环境的挂载点不是 `/workspaces` 时才需要配。

## 范围裁定（2026-09-29，均由用户拍板）

### ① T010 / T012 移出 002（用户选 A）

**002 只交服务层。** T010（登录失败提示的呈现）与 T012（强制改密弹窗）移出本 feature，随 **F3 网关**一并做。
移出的是**呈现**；FR-005 / FR-006 的**服务层半边已在 T009 落地**（四种失败原因共用同一个 `InvalidCredentialsError` 与同一句消息；成功时透出 `mustChangePw`）。**FR 覆盖没丢，丢的是「把它显示出来」这个动作。**

**连带修正**：T013 的依赖由 `[T012]` 改回 **T004**——改密能力不需要弹窗存在才能写，T012 从来不是它的真依赖。

**下面保留裁定时的取证，供 F3 接手时直接复用。**

#### T010 / T012 无前端落点——计划缺口（裁定时的取证，供 F3 复用）

两条都是 `[FE·新增]`，但 002 里**没有前端可加**，逐项核实如下：

| 检查 | 结果 |
|---|---|
| plan.md「项目文件结构」 | 只有 `packages/auth/` 一个块，**零个前端文件** |
| plan.md「前端换皮区」 | 描述了**登录页**与**改密弹窗**的视觉 token，但**没给落点** |
| 002 目录 | 无 UI 目录 |
| 全仓库前端 `*login*` / `*auth*` | **0 个**（`packages/app` / `packages/ui` / `packages/session-ui` 均无） |
| 001（平台底座）T008 备注原文 | 「**001 没有登录**（登录属 F2 / `002-auth-account`……），本任务**不改这一点**，改为建立接入缝」 |

**缺口形态**：登录页是**两条任务都默认它已存在、却没有任何一条任务负责造它**的东西。
T009 的出参「进入主界面」同因此未达成。不是实现难度问题，是 plan.md 与 tasks.md 对不齐。

**为什么不擅自补**：造登录页 = 新建 openhive 前端组件 + 登录 HTTP 端点 + Cookie 下发 + 错误呈现
+ 与 001 的 `workspace/current-user.ts` 接入缝对接。这是一个**新的切分单元**，
且直接决定 T018（网关 `X-User-ID`）的形态——属范围决策，不能由实现者顺手夹带。

**否掉的备选 B（002 内补登录面）**：登录页服务的正是网关，没有网关就只能对着一个空地址发请求；
且它会顺手把 T018 的形态定死，等于让「认证机制」这一个 feature 越界去定「网关架构」。

### ② T014 改写为回归测试（用户选 A）

`[BE] 实现「稍后修改」下次登录再弹 [FR-006] [出参：选稍后修改后下次登录仍弹]`

**按原样写，是一件不做任何事的任务**（做完 T013 后复核，结论不变）：
「稍后修改」= 前端关掉弹窗、**不发任何写请求**；而 `must_change_pw` **只由真的改了密码**（T013）置 0。
`login()` 全程只**读**该列，写的是 `last_login_at`。故「下次登录仍弹」**一行代码不写就已成立**。

**裁定 A：交一条回归测试**，钉住「登录不顺手清 `must_change_pw`」。零新增生产代码。

**否掉的备选**：
- **B（它其实是 FE，弹窗上那个按钮）**：也已随 T012 移出 002；但那样 T014 就变成一条「移出」记录，
  而它其实**有一条值得写的测试**，白白丢掉可惜。
- **C（引入「本次会话内不再弹」的 snooze）**：会给 `must_change_pw` 引入**第三个状态**，
  而 spec/design-v2 只定义了「要改 / 不要改」两态；且 FR-006 的「下次登录再弹」恰恰说明不需要它。
  这是**新增产品行为**，不能由一个「实现既定验收标准」的任务夹带。

## T016 阻塞（2026-09-29，已停下等用户裁定）

**任务原文**：「实现停用后保留 30 天再归档/删除（可恢复）[FR-010] [出参：停用后 30 天内可恢复、逾期归档]」

**先纠正一处我自己起先读错的地方**：FR-010 与 design-v2 §4.3（`:180`）的原文都是
「其**沙箱目录与数据** MUST 保留 30 天再归档/删除」——**保留对象是文件系统的沙箱，不是账号行**。
账号行的动作只有「`status=0`，登录被拒」（T011 已做）。

**两个硬事实（已核实）**：
1. **表里没有「停用时刻」这一列**。design-v2 §4.1 的表 15 列全文核对过，生命周期只有 `status`
   一个字段。没有它，**「是否已满 30 天」根本无从判定**——这正是 T016 卡住的直接原因。
2. **沙箱目前是空目录**。`workspace.ts` 的 `createWorkspace` 只 `mkdir`，每用户 db 文件、
   真实研判产物都属 F3。此刻对 `/workspaces/{id}/` 做归档/删除，**动的是一摞空目录**。

**由此产生的岔路（三条，均需用户拍板）**：

| 选项 | 做什么 | 代价 |
|---|---|---|
| **A** | 只做**账号侧闭环**：加 `deactivated_at` 列（迁移 `0002`）+ `restoreAccount` + 逾期清单筛选；**文件系统归档/删除留给 F3** | 偏离 design-v2 §4.1 的 15 列，要同步改 `user.test.ts` 的防漂移断言；FR-010 的「归档」一半未落地 |
| **B** | 按字面做全：加列 + 实现目录归档/恢复/删除 | 002 的沙箱是空目录，现在实现等于**对空目录做破坏性操作**；本机没有 `/workspaces` 挂载点 |
| **C** | **T016 整体移出 002**，与 T010/T012 一样留给 F3 | 002 的 US4 只交「筛选 + 停用」，不交「恢复」 |

**我的倾向：A**——`restoreAccount` 是**真实且当下就有用**的动作（误停用了要能放回来），
窗口判定也确有业务含义；而「归档/删除沙箱目录」在 F3 之前**没有可作用的对象**，
现在写只能写一堆无从验证的 `rm -rf`。

### ✅ 裁定（2026-09-29，用户选 A）

T016 只做**账号侧闭环**，且**要加 `deactivated_at` 列**（迁移 `0002`）——不加列就没有「停用时刻」，
30 天窗口无从判定。随之必须同步改的：`user.ts` 模型、`user.test.ts` 的防漂移断言、
以及 design-v2 §4.1 那张表在文中的呈现（这是**平台级**改动，不只影响 002）。

**文件系统部分（沙箱归档/恢复/删除）明确移出 002，留给 F3**，理由见上表 A 行。

## 收尾补测：`backend-testing` 六步闭环 · 2026-09-29

来源：`test-routing-advisor` 把 002 判为**单后端**（默认四类里唯一命中），缺口路由到
`backend-testing`。本节是后者的**步骤 4「按蓝本归档」**（蓝本 = `testing-system-blueprint`）。

> ⚠️ **工具链现状（供后来者省一次试错）**：`test-routing-advisor` / `backend-testing` /
> `testing-system-blueprint` 三个 skill 都在**外层工作区**
> （`D:\project\study\openhive\.claude\skills\`），**未注册进本会话可调用 skill 清单**——
> `Skill` 工具对它报 `Unknown skill: backend-testing`。因此本次是**按文件内容执行规程**，
> 与「调用 skill」在结果上等价、在可追溯上不等价（清单里没有它，别以为是漏调）。

### 步骤 1–2 · 命中判定（防过度测）

| 缺口 | 命中 | 依据 | 覆盖状态 |
|---|---|---|---|
| 真库数据层 / 迁移 / 约束 | ✅ | 2 个迁移、警号唯一约束、`registerUser` 写入、批量停用 UPDATE | 🔧 部分未覆盖 → **本轮补齐** |
| 鉴权 / 越权 BOLA·BFLA | ✅ **P0** | 多账号 + `is_admin` + 4 条管理员能力**零守卫** | 🔧 **未覆盖 → 被范围挡住，见下** |
| 并发 / 竞态 / 限频 | ❌ | 唯一约束由 PG 23505 **原子拒**（`register.ts` 的 `insertUser` docstring 明写不做预检、预检有 TOCTOU），无限频/配额 | 不命中（防过度测） |
| 韧性 / 故障注入 | ❌ | `packages/auth` 无出网调用 | 不命中 |

**覆盖区分**（步骤 2）的依据留档：`migrate.test.ts` 的 `rowsOf` 那组自己写着「bun-sql 那支离线跑不到真库，
只能靠本组单测钉住」；`db.test.ts` 只用**类型标注**钉生产驱动（`PG_PORT: "1"`，靠惰性连接不碰网络）。
即：002 全程**没有任何一条断言真正执行过 `drizzle-orm/bun-sql` 这一支**。

### 步骤 3–4 · 新增回归 + 风险分级

| ID | 回归 | 档 | 发布门 | 层 | 落点 |
|---|---|---|---|---|---|
| `002-BF-01` | 生产驱动连真库、结果解析成裸行数组 | P1 | 硬阻断 | L2 集成 | `production-driver.test.ts` |
| `002-BF-02` | `migrate` 在生产驱动上跑通且第二次幂等 | P1 | 硬阻断 | L2 | 同上 |
| `002-BF-03` | 重复警号 UNIQUE 被真库拦下、翻成 `DuplicatePoliceNoError` | P1 | 硬阻断 | L2 | 同上 |
| `002-BF-04` | `registerUser` + `login` 在生产驱动上跑通 | P1 | 硬阻断 | L2 | 同上 |
| `002-BF-05` | `rollback` 在生产驱动上可逆 | P1 | 硬阻断 | L2 | 同上 |
| `002-BF-06` | `pgErrorCode` 认 bun-sql 的 `errno` 形态 | P1 | 硬阻断 | **L1 快** | `pg-errors.test.ts` |

**三层节奏**：`BF-01`–`05` **只能落 L2**——它们要「真库 + 生产驱动」同时拼装才暴露，
按蓝本「需要真实拼装才暴露的 P0/P1 落 L2」。`BF-06` 是纯逻辑，下沉到 L1。

**为什么全是 P1 而不是 P0**：`BF-03` 是本轮唯一有真实缺陷背景的，其失败后果是
**管理员看到内部报错而非「该警号已录入」**——核心流程的错误路径断了，但**不损坏数据、不越权、不可逆性为零**，
按蓝本判据落 P1。⚠️ **需 F3 注意的升级条件**：原始 `DrizzleQueryError` 的 `params` 里**带着 `password_hash` 明文**
（本轮实测，见下），若 F3 把它原样透给后台 UI，即构成「敏感信息泄漏」→ **升 P0**。F3 接错误呈现时必须先脱敏。

### 🔴 本轮抓到的真 bug（**产品码改动，需人审**）

`packages/auth/src/pg-errors.ts` 的 `pgErrorCode` **只读 `cause.code`**，而两个驱动的 shape 不同（实测）：

| 驱动 | `cause.code` | `cause.errno` |
|---|---|---|
| `drizzle-orm/pglite`（002 全部测试） | `"23505"` ✅ | — |
| `drizzle-orm/bun-sql`（**生产**） | `"ERR_POSTGRES_SERVER_ERROR"` ❌ | `"23505"` |

→ 生产环境 `=== "23505"` **恒假**，`DuplicatePoliceNoError` **永不抛出**。002 的测试全跑 PGlite，故一路绿灯。

**修法（最小）**：先按 SQLSTATE 形状（`/^[0-9A-Z]{5}$/`）认 `code`，认不出退到 `errno`；
两条都不像返回 `undefined`——**绝不把驱动的内部码当 SQLSTATE**。生产消费者只有 `register.ts` 的 `insertUser` 捕获处一个。

**有牙验证（变异，真跑）**：

| 变异 | 结果 |
|---|---|
| A：`pgErrorCode` 退回「只认 `code`」 | **3 红**（2 单元 + 集成 `BF-03`） |
| B：`rowsOf` 去掉 bun-sql 的裸数组分支 | **5 红**（`BF-01`–`05` 全红） |

**实测输出**：`packages/auth` 全量 **111 pass / 0 fail**；`turbo typecheck --filter=@opencode-ai/auth` 绿；
`oxlint` 三个改动文件 **0 warnings / 0 errors**。

**为什么不用 Docker**：本机 `docker: command not found`，亦无 `psql`/`pg_ctl`/`initdb`。
改用 PGlite（编译成 WASM 的 PostgreSQL）经 **TCP** 暴露，让生产驱动 `connect()` 连上去。
⚠️ **残差（说清楚，不假装闭合）**：服务端是 **WASM 构建的 PG**，不是生产那个 PG 二进制/版本。
**闭合的是驱动那一半**（序列化、结果解析、错误对象形状——自己写的、会错的那一半），
**不闭合**「与生产 PG 同版本同构建」。后者仍需真 PG 实例，应由 CI 提供。

### 🔧 未闭合的 P0：越权 BOLA/BFLA —— **不是遗漏，是被范围挡住**

`002-BF-03` 修完仍**无法**测越权，原因是结构性的：**服务层根本没有「调用者身份」这个参数。**

| 函数 | 签名 | 有无调用者身份 |
|---|---|---|
| `registerUser` / `provisionUser` | `(db, input[, root])` | ❌ 完全没有 |
| `resetPassword` | `(db, userId)` | ❌ 只有**目标**，没有**调用者** |
| `changePassword` | `(db, { userId, ... })` | ❌ 同上（注释：userId「调用方从已验签的凭证里取」） |
| `login` | `(db, input, secret)` | — |

`password.ts` 的 `resetPassword` docstring 把这条分层写成了**有意为之**：「**本函数自己不做鉴权**……真正的门禁在调用方」——
而调用方（F3 网关）**还不存在**。所以此刻写越权测试，要么断言不出东西，要么就得
**在服务层新造一层授权**——那是产品架构改动，且与既有设计相反，属范围决策，不能由补测顺手夹带。

**另一条确证**：服务层**唯一**可测的提权不变量——「录入产生的账号一律非管理员」——**已被覆盖**
（`register.test.ts` 的「is_admin 不在 8 字段内，默认关闭」那条）。故此缺口在服务层确实**没有剩余的空白**可填。

**待用户裁定（两条互斥路线）**：

| 路线 | 做法 | 代价 |
|---|---|---|
| **A（推荐）** | **承认它归 F3**：002 服务层不引入授权参数；等 F3 网关落地后，在 **HTTP 层**用双身份凭证写 BOLA/BFLA 断言 | 002 留下一条 P0 未闭合账，须**写进 F3 的 tasks.md**（不是只写在本文件里） |
| **B** | 002 内给 `resetPassword`/`changePassword`/`registerUser` 加**调用者身份参数** + 服务层授权 | 改 4 个函数签名 + 推翻 `password.ts` 的 `resetPassword` docstring 里那条分层；与「002 只交服务层」的既有裁定冲突 |

> 路线 A 有一个**必须一并处理的坑**（002 内已踩过同类）：这笔账若只写进 002 的 state.md，
> F3 读不到就等于没写——003/004 的「登录页归属」已经这样丢过一次（002 说移给 F3，003 说 F2 已交，净结果无人认领）。

> ⏭ **后续（2026-10-01 补记，读到这里的人请跟到最新一跳）**：用户已裁定**路线 A**，
> F3 **确实把这条账写进了自己的表**（`003-multi-tenant-isolation/tasks.md` 的 **T016**，
> 「为什么 002 没做」那段逐字引了本文件）——**这一跳是成功的，坑没再踩**。
> 但 F3 开工 T016 时探明**它在 F3 边界内无对象可测**（管理员能力的三个端点不存在、
> `isAdmin` 全仓库没有服务端授权分支），于是**又移交了一跳**：
> **现在它在 `010-governance-console/tasks.md` 的 T015**，配套补写了该 feature 的
> FR-013 / SC-005（原文只有「仅管理员可见」，那是**入口呈现**不是**能力门禁**）。
> F3 那侧贡献了**BOLA 半边**（跨身份拿不到对方的库/目录/会话，已交付并有测试守着），
> 留给 F10 的是 **BFLA 半边**（普通民警对管理员能力）。
> 📌 于是这条 P0 的完整链路是：**002 服务层（结构上做不了）→ 003 T016（无对象可测）
> → 010 T015（能力与端点都在这里）**。**结论：路线 A 的判断没错，只是落点又远了一跳。**

### 步骤 4 · 追溯与发布门：**现状是无闸**

按蓝本，`BF-01`–`06` 标了「硬阻断」，但**本项目目前没有任何 CI 闸**去执行
「测试全绿 / 无孤儿需求 / 无破坏性契约变更」三项机械判据。故上表「发布门」一列
**目前是纸面声明，不是机读事实**——真实拦截力仍只有 `bun test` + `typecheck` + `oxlint` 三样。
本节的 ID 也是**给未来留的锚点**：项目一旦引入追溯校验脚本，`002-BF-xx` 即可被机械收集。

### 步骤 5 · 交付（**按本项目惯例**，2026-09-29 用户裁定 A）

**裁定**：本项目**不用 PR**（001 至今也没走过，"PR" 只作为「一个 PR 不混重构与新功能」这条纪律出现）。
故步骤 5 的载体是**本交付说明 + 收尾提交信息**，而非 PR 描述。`backend-testing` skill 的步骤 5
原先写死「产 PR · 人审」——**那是 skill 违反了自己第 2 条绝对约束（project-agnostic）**，
已改为「**内容清单固定、载体随项目惯例**」（改的是外层工作区的 skill，不随本仓库版本化）。

内容清单（步骤 5 要求四项，逐项对应）：

| 项 | 002 的答案 |
|---|---|
| **命中维度** | ① 真库数据层/迁移/约束 ✅ ② 越权 BOLA·BFLA ✅（**P0**，被范围挡住，见上） |
| **跳过维度及理由** | ③ 并发/竞态 ❌ 唯一约束由 PG `23505` **原子拒**（`insertUser` 有意不做预检，预检有 TOCTOU），且无限频/配额 ④ 韧性/故障注入 ❌ `packages/auth` 无出网调用 |
| **新增回归的缺口 ID 与风险级别** | `002-BF-01`–`06`，**全部 P1 硬阻断**（分级理由见上表下的说明） |
| **产品码改动（单独列出）** | **仅一处**：`pg-errors.ts` 的 `pgErrorCode` 认 bun-sql 的 `errno` 形态（本轮唯一真 bug，见上节） |

> **「有人审过」不随载体变**：本 feature 由用户在主检出跑 `git merge --ff-only` 合入，
> 审核动作发生在合并那一刻；交付说明（本节 + 上几节）就是给人审的材料。

## 遗留项（已判定「不擅自加」，等用户定；不是遗忘）

| # | 项 | 现状 | 补法 |
|---|---|---|---|
| ① | **用户枚举的时序侧信道** | 密码错误要做一次 argon2，账号不存在直接返回——**耗时不同**，理论上可用来枚举警号 | 在查不到时也跑一次假哈希（约 2 行）。FR-005 只要求**提示**一致，未要求耗时恒定；加了会放大未知警号的校验开销 |
| ② | **hash 损坏的账号被静默当成密码错误** | 用户永远登不进来，**运维也看不到线索**（T004 交接项的落地代价） | 在 `passwordMatches` 里接日志，**不是**把错抛出去（抛出去就退回 500，与 FR-005 冲突） |
| ③ | **密码强度策略未实现** | 只挡「填了等于没填」（地板）。**收尾评审后地板从 1 条加到 4 条**：非空白 / 非系统默认密码 / 非当前密码 / 非空——仍**没有**长度或字符类规则，design-v2 `:321` 画了「强度条」但没写规则 | 须先定规则（长度？字符类？）再实现。倾向**随 T012 的改密 UI 一起定**——强度条本来就是它的一部分 |

> ①②③ 都是**有意识的不作为**，不是漏做。每条都写明了代价与补法，避免后来者重新推导一遍。

## 收尾评审发现与处置（2026-09-29）

按 `run-feature` Step 4 用 `superpowers:requesting-code-review` 评审 002 全部产物
（三个独立视角；**三方交叉项**是最高信号——同一问题被互不知情的三方同时读到）。
共报 3 Critical + 10 Important + 16 Minor。经用户裁定取「Critical 3 + 低争议 Important」
在本 feature 内修完（commit `c0c342421a`），其余移交 003
（`003-multi-tenant-isolation/tasks.md` 的「002 移交的欠账」节 **T019–T024**）。
每条修复都先写 RED、再做**变异验证**（把实现改坏，确认断言真会红）——本轮有 3 条首跑即绿，
正是变异验证揪出来的假绿。

### Critical：3 条，全部已修

| 编号 | 文件:行 | 缺陷 | 处置 |
|---|---|---|---|
| C1 | `password.ts` 的 `changePassword`（引言那句「本节全部是『地板』」所指的一段） | 改密可把新密码设成**系统默认密码**或纯空白。默认密码是写在 design-v2 正文里的公开值，而 `must_change_pw` 随后被清成 0：账号停在人尽皆知的口令上，且与「正常改过密」**完全同形**，测试与运维视图都看不出区别 | 已修：三条「地板」检查（非空白 / 非默认密码 / 非当前密码）。顺序上「非当前密码」**必须**排在验密之后，否则退化成猜密码的预言机 |
| C2 | `bun.lock` | 锁文件被写入 `registry.npmmirror.com` URL（本机 `~/.npmrc` 指向镜像，bun 认它），给全体开发者与 CI 定死下载源，且**每次同步上游都在这些行上冲突**。实测行数：基线 `d9fefaf329` **0** → 首次污染 `85eca3a020` **3226** → 峰值 `ff7f7ec544` **3234**（此处更正先前写的「3260」，那是**未实测**的数字，同 `#001-01` 的坑；commit `6267ef68d3` 的 message 里也留了这个错数，不改写历史、以本行为准） | 已修（commit `6267ef68d3`）：还原为上游写法（该列留空串）。`HEAD` 实测 **0** 行；diff vs 基线只剩 35 行插入，全是有意新增 |
| C3 | `migrate.ts` 的 `rollback` | `rollback` 可回滚**任意**已应用版本 → 账与 schema 永久背离，`migrate()` 再也修不回来；该守卫**同时**是路径穿越的闸门（版本号会拼进文件名） | 已修：只允许回滚最后一个已应用版本 |

### Important：10 条（6 已修 / 4 移交）

| 编号 | 一句话 | 处置 |
|---|---|---|
| I1 | **全仓库没有任何产生管理员的路径**——`registerUser` 恒写 `isAdmin: 0`，而治理后台（录入 / 重置 / 停用）全部要求 `is_admin`，于是系统**第一天就锁死**：没有第一个管理员，就没有第二个 | 移交 → **003 T019**（用户裁定：环境变量引导首个管理员，**仅在表里无管理员时**生效、一次性）<br>✅ **2026-10-01 已落地**：挂在 `AuthGateway.layer` 层构造期、排在迁移之后。⚠️ **它带出四条未覆盖**（撤掉变量后新迁移无人应用 / 多实例 TOCTOU / 「进程退出」验不到 / 被提权账号 `status=0` 时仍锁死），见 003 `state.md` 缺口表 |
| I2 | 领域错误携带原始 `DrizzleQueryError`，其 `message` 就是 `` `Failed query: …\nparams: …` ``——**查询参数被内联进消息**，含 `password_hash` / `id_card` / `phone` | **已修**，且按 `LEARNINGS #002-01` 当**类**清了一遍：register 的 insert + 改密/重置的两处 update，只带 SQLSTATE 出门 |
| I3 | `DEFAULT_PASSWORD` 硬编码在 `policy.ts` | 移交 → **003 T020**（与 design-v2 `:155-157` 把 `admin@123456` 当公开示例写在正文里有关，改前先裁定文档）<br>✅ **2026-10-01 已落地**：常量从仓库删除，改走 `OPENHIVE_DEFAULT_PASSWORD`（**缺失即抛、无兜底**）；文档裁定为「保留示例值 + 追加裁定注」。残留缺口见 003 `state.md` 缺口表 |
| I4 | `migrate()` 无事务、无并发锁。**实测代码**（`migrate.ts` 的 `runFile` 逐条 `execute`、无 BEGIN/COMMIT；`migrate()` 里的记账 insert 排在 `runFile` **之后**）：单个迁移文件中途失败会留下「改了库、没记账」的半应用状态，重试从文件头重跑 —— 所以**每个迁移文件必须自幂等**（`0003_flags_not_null.sql` 把它写进了文件头；那里原先引用「`migrate.ts` 的已知缺口」是个**悬空引用**——该缺口在 `migrate.ts` 里根本没写——**已由第二轮复审 R9 改为自足表述**，只剩 `migrate.ts` 侧待 003 T021 补记）。并发上，两个 runner 会各自读到同一份 `applied` 后都去应用 | 移交 → **003 T021** |
| I5 | `provisionUser` 建目录失败时留下「有账号、没沙箱」的半成品，账号行侧无处置 | 移交 → **003 T022** |
| I6 | 录入零输入校验：8 个字段可填空白（8 列全 NOT NULL，故这是唯一能造出「有行但没有姓名」的路径）；`status` 无取值约束 | **已修** |
| I7 | `jwtSecret` 不判强度——HS256 的安全性整个押在它上面，短密钥可离线枚举 | **已修**（下限 32 字符，RFC 7518 §3.2） |
| I8 | `connect()` 无超时 / 无连接池 / 无 `close`；PG 不可达时表现为**挂住**而非快速失败 | 移交 → **003 T023** |
| I9 | 僵尸停用两个边界：① 重复停用改写 `deactivated_at` → 30 天保留期**从头起算**；② 一键批量停用可能停掉管理员 | ① **已修**；② 移交 → **003 T024**（**改判据**：管理员仍应出现在名单里——特权休眠账号恰恰最该被看见；要拦的是那个一键动作，不是那条名单） |
| I10 | `is_admin` / `must_change_pw` 可空，`must_change_pw = NULL` 被 login 的 `=== 1` 读成「不需改密」——**fail-open** | **已修**：`0003_flags_not_null` 迁移追加 NOT NULL（回填 + SET NOT NULL，四句全幂等）；down 是**有损**的，已在文件头写明 |

### Minor：16 条**未落盘**（记录一处流程缺口，不补记）

评审报出的 16 条 Minor（`state.md` / `plan.md` 口径、治理项等）**没有写进任何文件**，
只存在于评审当轮的会话输出里，随上下文压缩丢失。本节**不凭印象复述**没落盘的条目。

> 缺口本身值得记：本项目已经吃过一次「两边都以为对方在做」（登录页丢了两次，
> 见 `003-multi-tenant-isolation/tasks.md:69-71`）。**评审发现也是移交物**——同一轮里
> 已经把 Important 写进了接收方的表，Minor 却只停在会话里。下次评审收尾时，
> 无论优先级高低，发现一律**先落盘、再处置**。

### 第二轮复审（复审那轮修复本身）：0 Critical / 5 Important / 9 Minor

按 Step 4「有缺陷 → 回到 task 修，重走 review，直到 0 缺陷」，对修复提交
（`ff7f7ec544..6267ef68d3`）再评一轮。**5 条 Important 全部已修**——它们有一个共同的形状：
**修复本身是对的，但没有任何测试/文档在它被改坏时出声**。

| 编号 | 复审发现 | 处置 |
|---|---|---|
| R1 | `register.ts` 的 `insertUser` docstring 仍写「其余错误**原样抛出**」，与同一个函数 catch 里的实现（包成 `AccountWriteError`）**相反**。下一个实现者若照这句「还原」，I2 关掉的泄露就静默重开 | 已改为与实现一致，并点明为什么不能原样抛 |
| R2 | C1 里那条被代码自己标为 `⚠️ 必须` 的**顺序性质**无测试守着。把「新密码 = 当前密码」检查移到验密**之前**，18 条测试**全绿**——即改密退化成猜当前密码的预言机而无人察觉 | 已补 RED-式守卫测试（当前密码**错**且与新密码相同 → 必须 `InvalidCurrentPasswordError`）。变异验证：把顺序调反 → **恰好 1 条红**，恢复即绿 |
| R3 | I6 的 `typeof value !== "string"` 分支无测试。删掉它，56 条全绿——而它一删，「少填一个字段」就从可识别的领域错误变成 `TypeError` → 500 | 已补 3 条（`null` / `undefined` / 数字·布尔·数组）。变异验证：删掉 `typeof` → **恰好 3 条红** |
| R4 | `textReachableFrom` **无正向对照**：四条脱敏断言全是 `not.toContain`，walker 若退化成恒返回 `""`，它们**全部空转**。这与本轮 3 条「首跑即绿」的假绿是同一失败模式，只隔一次重构 | 已补 4 条正向对照（register / password 各 2：`message` 与嵌套 `cause`）。变异验证：让 walker 返回 `""` → **恰好 4 条红** |
| R5 | ≥32 字符密钥地板**没写进接收方的表**。`token.ts` 的注释称「这是进程启动路径上的一次性检查」，但**全仓库无任何生产代码调用 `jwtSecret`**（调用者只有 `token.test.ts`）——注释描述的是一个尚未发生的调用 | 注释改为「调用方**应当**如此」并点名执行点；地板写进 **003 T014** 与本节上方「待补环境变量」表 |

**顺带修掉的 5 条 Minor**（都是「说了假话」型，代价低）：
R6 录入侧哈希在 `try` 内（失败会被包成无 SQLSTATE 的「账号写入失败」，同 `password.ts` 改密里「哈希在 try **之外**算」那句的立场，I2 那类只修了 2/3 处）→ 提到 `try` 外；
R9 `0003` 引用「`migrate.ts` 的已知缺口」而该缺口根本不存在 → 改为自足表述；
R10 `token.ts` 的 `MIN_SECRET_LENGTH` 注释称「按字节理解也成立」，而 `String.length` 数的是 UTF-16 码元 → 改为「对 ASCII 成立、非 ASCII 偏保守」；
R12 T008 节仍写「原错误挂在 `cause` 上，不丢排查线索」（已被 I2 推翻）→ 加修订注；
R14 `bun.lock` 行数「3260」未实测 → 实测量准为 3234（见 C2 行）。

**未修的 4 条 Minor（登记理由，不静默丢弃）**：R7 `AccountWriteError` 在非 PG 失败时丢原始错误（要改错误契约，须与网关的错误呈现一并定）；R8 `DuplicatePoliceNoError` 靠 `cause.code` 让 `pgErrorCode` 取到 SQLSTATE，与 `AccountWriteError` 的 `sqlState` 字段两套机制（同 R7，一并定）；R11 `rollback` 的 `head` 只由磁盘文件推导，账上有版本而文件被删时守卫会退化（低概率，待 T021 加锁时一并处理）；R13 测试助手在 4 个文件里逐字重复 ~50 行（属重构，与「一个 PR 不混合重构与新功能」冲突，单开）。

### 第三轮复审（复审第二轮修复本身）：0 Critical / 2 Important / 3 Minor

**代码侧零缺陷**——三条守卫经独立复核全部为真，且"只出该出的声"：删 `typeof` → 3 红、顺序调反 → 1 红、
walker 坏掉 → 4 红（注：4 红要求**两份 walker 都**改坏，只改一份只有 2 红——各文件的正向对照只守自己那份，
属实、非缺陷）。复审另加两条我没做过的变异：① 把 `typeof` 换成 `String(value).trim()`
（强制转换而非拒绝）→ 3 条新测试全红，说明它们对"把 `null` 强转成 `"null"` 放行"也有牙齿；
② 越界输入的 `Object.assign` 构造确已达到 `typeof` 分支（反证：若它丢了 `{phone: undefined}` 的键，
删 `typeof` 后那 3 条应仍绿，实测全红）。

**2 条 Important——全部是这一轮改动自己引入的**，形态相同：改对了一处，却让另一处的记述失去前提。

| 编号 | 发现 | 处置 |
|---|---|---|
| F1 | `state.md` 同一个「最后更新」块里先写 **149 pass**、隔一行又写 **141 pass**。141 是第一轮之后的正确值，但我新增的段落**插在它前面**，让它掉了标题、变成新段的续行，「最终门禁数」于是同段出现两个答案 | 已把 141 那段归位到第一轮段落并标注「此数为第一轮之后；当前见下一段（149）」 |
| F2 | `003/tasks.md` 的 T021 与 `state.md` 的 I4 行仍断言「`0003` 的文件头引用 migrate.ts 的已知缺口，是悬空的」——而 R9 已把它改成自足表述，**这个前提在 HEAD 上已不成立**。003 的实现者照它走会去找一个不存在的引用。**这正是 `LEARNINGS #002-04` 说的温床：接收方的表在描述一个已消失的现状** | 两处均已改：说明 `0003` 那半边已由 R9 修掉，只剩 `migrate.ts` 侧待补 |

**3 条 Minor，全部已修**：
F3 交叉引用再次漂移——`003/tasks.md` 里指向 `register.test.ts` 的**行号引用**已对不上实际位置。
  这条引用**已经漂了两次**（每轮改动都把它往下推），**故不再补数字，改为按测试名引用**。
  **顺带查出复审没发现的第二条**：同一文件里指向 `password.ts` 的行号引用同样失效，
  一并改为按 `resetPassword` 的 docstring 定位。
  > ⚠️ **但这句「改为按名字引用」当时只做到了 `003/tasks.md`，`state.md` 自己没扫**——
  > 第四轮收口复核（S1–S3）抓到的正是**本文件里**同类的失效引用（且 S1 就出在上面这段叙述自己身上：
  > 它在讲「行号会漂」，而它引的行号也漂了）。
  > **教训：说完「把这类问题一次消掉」，要立刻 grep 一遍同类；否则那句话自己就是一条新的不实记述。**
  > 已经照此把本文件所有指向 `packages/auth/src/*` 的行号引用改成按函数 / 测试名定位。
F4 正向对照**名不副实**：标题说「message 是不可枚举的，正是本函数要够到的东西」，但 `Error` 的
  `stack` 首行**就是** message 文本——把 walker 改成跳过 `message` 键，34 条**全绿**，这半边根本没被守住。
  已按复审验证过的修法加 `delete probe.stack`（删后同一变异 **1 红**，实测确认）。
  整体防护性本就不受影响（walker 退化成 `""` 仍会被抓），但「注释声称的性质」与「测试真守的性质」
  不一致，正是本轮要清的形态。
F5 安全理由说过头：新注释称顺序反了会「**无需登录即可**试出当前密码」。而 `userId` 取自
  **已验签的凭证**，攻击者**得先持有该账号的会话**。真正的损失是**绕过登录接口的限频与审计**，
  已按此改写。

> **本轮教训（值得进 LEARNINGS）**：三次复审，缺陷从「代码错」→「测试没守住」→「文档自相矛盾」，
> 每一轮的新 Important 都是**上一轮修复动作自己引入的**。修一处而让别处的记述失去前提，
> 是本轮最稳定的缺陷来源。**改完要顺手扫一遍「哪些地方引用了我刚改掉的东西」**——
> 行号、数字、前提、交叉引用，都是会在编辑中悄悄失效的东西。

### 第四轮收口复核（复审第三轮修复本身）：0 Critical / 0 Important / 3 Minor

**裁定：代码侧零缺陷，可合并。** 3 条 Minor 全是**失效引用**，且都落在「上一轮那笔修复自己的 diff 里」：

| 编号 | 发现 | 处置 |
|---|---|---|
| S1 | 第三轮写的「改为按测试名引用，**把这类问题一次消掉**」——那句话**只做到了 `003/tasks.md`**，本文件（`state.md`）没扫。讽刺的是 S1 就出在那段叙述自己身上：那段在讲「行号会漂」，而它引的行号也漂了 | 改为写明「只做到 003 那一半」，并改正过头话；本文件全部行号引用改按函数 / 测试名 |
| S2 | 本文件仍有一批指向 `packages/auth/src/*` 的行号引用对不上实际位置 | **全量**改为按函数名 / 测试名定位（grep 验证 0 命中；剩余行号引用全是上游 opencode 的 `session-ui/prompt-input/index.tsx:163`——那个我们不碰、不会漂，保留） |
| S3 | 同类的两条既存失效引用（并发那行的 `register.ts:63` 实为 118、覆盖区分那行的 `migrate.test.ts:56` 实为 67） | 一并改掉 |

> **收尾自查又核出 4 项同型失效记述**（同一类：不报错、不变红），随本次收尾提交一并改掉——
> 均已记入 commit message 与 `session.md`：`session.md` 写死的「合并前 HEAD」与「领先 28 个提交」
> （实测 31）、`tasks.md` 里 T016 的复选框（实现已完成却是 `[ ]`）、`LEARNINGS #001-05` 的
> 验证配方数字（应 161 而非 160，属 001，未在本轮改、记入 `session.md` 待单独一轮）。
> **教训：本 feature 最稳定的缺陷来源不是代码，是「文档状态与事实脱节」——它不报错、不变红，
> 只能靠主动核对。**

## 最后更新
2026-09-29（T018 完成、002 全部 16 条任务落地；收尾补测：`backend-testing` **六步走完**（步骤 5 的载体按本项目惯例＝交付说明，见该节），
新增回归 `002-BF-01`–`06`，抓到并修掉 `pgErrorCode` 的生产驱动 bug；**越权 P0 待用户裁定 A/B**）

2026-09-29 续（**收尾评审**）：三视角评审判定 3 Critical + 10 Important + 16 Minor，
经用户裁定修完 C1/C2/C3 + I2/I6/I7/I9①/I10（commit `c0c342421a` + `6267ef68d3`），
其余 4 条 Important（I3/I4/I5/I8）与 I1、I9② 移交 003（T019–T024）。
门禁实测（**第一轮修复后**、`adca77d5aa`）：`packages/auth` **141 pass / 0 fail**；`bun run typecheck` **31/31**；
`oxlint -c script/oxlintrc.openhive.json packages/auth/src` **0 warning 0 error**；
`bun.lock` vs 基线 **35 行插入 / 0 删除**（`--frozen-lockfile` 通过）。
16 条 Minor 未落盘，已在上面记为流程缺口。
> ⚠️ 本段的 141 是**第一轮之后的数**。第二轮新增 8 条测试，**当前数见下一段（149）**。

2026-09-29 再续（**第二轮复审 + 收口**）：复审判定 **0 Critical / 5 Important / 9 Minor**；
5 条 Important（R1–R5）全部修完并逐条变异验证，另修 5 条「说了假话」型 Minor，4 条登记不修。
修完门禁实测（**当前口径**）：`packages/auth` **149 pass / 0 fail**（13 文件）、
`bun run typecheck` **31/31**（`@opencode-ai/auth` 真跑非缓存）、
`bunx oxlint -c script/oxlintrc.openhive.json packages/auth/src` **0 warnings / 0 errors**、
`bun.lock` 镜像 URL **0 行**（基线 0 → 首次污染 3226 → 峰值 3234 → 现 0）。
