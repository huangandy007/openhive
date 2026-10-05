/**
 * 004 T008（FR-006 **行级**）· 业务数据 RLS 的**身份通道契约**。
 *
 * ## 这个文件是什么、不是什么（甲裁定，用户 2026-10-05）
 *
 * 出参「越权行被 RLS 过滤」今天在仓库里**打不到**：业务库、业务表、数据项目成员表
 * （`fund_project_member` 等）与受限数据库账号**全部归 F6/F7**——spec.md:137 自己写着
 * 「业务数据的 RLS 落地依赖 F6/F7 的数据项目成员表……**本 feature 定义权限机制**」。
 *
 * ⇒ 本 feature 只做**打得到的那一半**（与 T007 「只做打得到的」同款处置）：
 * - **机制**（本文件 ＋ 它的见证测试 `rls.test.ts`）：真 PG 上**实测**这套写法拦不拦得住越权行；
 * - **落地**（建表 / 建策略 / 建角色 / GRANT）：**移交 F6/F7**，接收行写在
 *   `docs/superpowers/specs/007-fund-analysis/tasks.md` 与 `008-call-analysis/tasks.md`。
 * - 🔴 **产品代码里不落任何业务表或策略迁移**：本仓没有业务库的迁移目录，auth 的
 *   `src/migrations/` 是 **auth schema** 的（两者是**两个库**，见 design-v2 §12.1）。
 *   在这里建一张示意表 = 投机结构（D0-3 裁定的反面）。
 *
 * ## 身份通道（与 T007 的接缝，这是本文件存在的**唯一**理由）
 *
 * | 环节 | 谁做 | 落点 |
 * |---|---|---|
 * | ① 身份**进 MCP 请求** | 已完成（T007） | `_meta["openhive/user"]`＝用户 id，opencode 侧注入并已测 |
 * | ② 身份**进 PG 连接** | **F6/F7 的 MCP server** | 读 `_meta["openhive/user"]`；每个查询前在**同一事务内** `SET LOCAL ROLE <受限账号>` ＋ `set_config(openhive.user_id, <该 id>, true)` |
 * | ③ 行级过滤 | **PG（RLS 执行器）** | 本文件下方的**策略模板** |
 *
 * 两端名字**故意不同**：`openhive/user` 是**我们自己的协议字段**（MCP `_meta` 的键），
 * `openhive.user_id` 是 **PG 侧 GUC 的名字**（策略 SQL 要按字面写进 `current_setting(...)`）。
 * 把它们写成同一个字符串是**假镜像**——两层用的转义/命名规则不同，改一层另一层不会红
 * （`LEARNINGS #003-05`）。
 *
 * ## 策略模板（F6/F7 照抄这一份；`<…>` 处按各自表名填）
 *
 * ```sql
 * -- 账号级：每个角色一个受限账号（FR-006 第二档）。⚠️ 见下方不变式 1。
 * CREATE ROLE <每角色一个> NOLOGIN;
 * GRANT USAGE ON SCHEMA public TO <受限账号>;
 * GRANT SELECT ON <业务表>, <成员表> TO <受限账号>;   -- 只读；写权限单独授予
 *
 * -- 行级（FR-006 第三档）：
 * ALTER TABLE <业务表> ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY <策略名> ON <业务表> FOR SELECT TO <受限账号>
 *   USING (<项目列> IN (SELECT pm.<项目列> FROM <成员表> pm
 *                       WHERE pm.user_id = current_setting('openhive.user_id', true)));
 *
 * -- ⚠️ 成员表**也要**开 RLS（不变式 5）：只 GRANT 不设策略 = 整表可读。
 * ALTER TABLE <成员表> ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY <成员表策略名> ON <成员表> FOR SELECT TO <受限账号>
 *   USING (user_id = current_setting('openhive.user_id', true));
 * ```
 *
 * 判据的形状是「**这一行属于的项目 ∈ 这个用户是成员的项目**」——**不是**「这一行是谁建的」。
 * 成员表由 F6/F7 落地（T010/T011 已整条移交 F7，D0-4）；两轴独立（FR-009）。
 *
 * ## 五条不变式（**每一条都有见证测试钉住**，不是散文）
 *
 * 1. **受限账号不得是业务表的 owner、不得是 superuser / `BYPASSRLS`** —— PG 对 owner 与
 *    superuser **默认不套** RLS 策略（`rls.test.ts` ④ 实测：连接用户 `rolsuper = true` 时
 *    同一个查询看得到**全部**行）。若将来让 owner 也参与查询，必须
 *    `ALTER TABLE <业务表> FORCE ROW LEVEL SECURITY`。
 * 2. **无身份 ⇒ 空集**（③）：`current_setting(..., true)` 未设时给 **NULL** ⇒ 判据恒不成立。
 *    所以「身份通道断了」的后果是**查不到数据**，不是看到所有人的数据。
 *    ⚠️ `missing_ok` 必须传 `true`：传 `false` 会**报错**——那会把「未认证」变成 500，
 *    而空集在语义上更准确（同 T006「取不到授权 ⇒ 不建会话」的取向：失败要 fail-closed，
 *    但**能表达成空集就别表达成崩溃**，崩溃会让调用方去 catch 一个不该 catch 的东西）。
 * 3. **双向验证**（①②）：只测「读不到别人的」会把「把所有人拦死」当成通过；只测
 *    「读得到自己的」会把「完全没过滤」当成通过。两侧都要（spec 风险 R3：过松＝越权，
 *    过紧＝自己查不到）。
 * 4. **身份必须是事务作用域，且前提是「交到你手上的连接本身干净」**（⑤）：
 *    连接池里一条连接**跨请求复用**，用连接级 `set_config(..., false)` 或 `SET ROLE`
 *    （不带 LOCAL）⇒ 上一个人的身份**留到下一个请求**，RLS 会按残留身份放行 —— 越权且
 *    **静默**（返回另一个人的数据，看起来完全正常）。
 *    ⇒ 写法只有一种：**同一事务内** `SET LOCAL ROLE` ＋ `set_config(..., true)`。
 *    🔴 **但 `LOCAL` 剥不掉上一层**（⑤ 后半段实测）：连接里**已有残留**时，事务内的 LOCAL 值
 *    回滚后**回到那个残留值**，不是回到「无身份」⇒ 「**用了 `SET LOCAL` 就安全了」是错的**。
 *    前提是**连接本身干净**：新连接、或先 `RESET ALL` / `DISCARD ALL`、且**绝不用会话级 SET**。
 *    ⇒ 消费侧（F6/F7 的 MCP server）在 `SET LOCAL` **之前**要先确认这一条；连接池若是跨请求
 *    复用同一批连接，必须在借出/归还时清干净。这条比 ①–⑤ 都隐蔽——它**静默地**让一个事务
 *    拿到「别人的身份」，而表面上一切正常。
 * 5. **被 `GRANT` 的每一张表都要开 RLS —— 成员表不是例外**（⑧）：只 GRANT、不设策略的表
 *    对受限账号是**整表可读**的，且**不报错、不变红**（结果看起来完全正常）。FR-005 明说
 *    MCP 侧会按自然语言**生成任意 SQL** ⇒ 「谁和谁在一个项目里」这张关系图会直接外泄。
 *    ⑧ 的成员表策略取的是**最小的一侧**（只看得到自己的成员关系行）；若 F6/F7 的业务流程
 *    确需读同一项目的完整名册，那是**另一次有据的放宽**，不是本模板的默认。
 *
 * ## 残差（据实记，不假装闭合）
 *
 * - 见证测试跑在 **PGlite**（WASM 版真 PG，本机无 Docker/PG，`#002-05`）。它**不是**
 *   「与生产 PG 同版本同构建」⇒ owner / superuser / `FORCE` 这一层仍需 CI 用真实例复核。
 * - `packages/auth` 的测试**进 CI**（`turbo.json` 有 `@opencode-ai/auth#test`，CI 跑
 *   `GITHUB_ACTIONS=false bun turbo test`）⇒ 本组测试**不只是本地门禁**。
 *   ⚠️ 2026-10-05 更正（R2）：这里原来写「**不进 CI**」，**与事实相反**——`turbo.json` 第 20 行
 *   就是 `@opencode-ai/auth#test`（2026-09-30 由 `c013619ddc` 加入，早于本 feature 的 merge-base）。
 *   复核取数：`grep -n "@opencode-ai/auth#test" turbo.json` ＋ `bun turbo run test --dry-run`。
 * - 结果量级（FR-006 第四档：LIMIT / 分页 / 导出）是 **T009**，不在本文件。
 */

/**
 * 承载「这次查询以谁的身份执行」的 **PG 自定义 GUC 名**。
 *
 * 命名规则：`<命名空间>.<键>`。⚠️ **必须带点**——不带点的名字会撞 PG 自己的设置项，
 * 而带前缀的未注册 GUC 任何角色都能 `SET`（实测：受限账号设得进去）。
 *
 * 🔴 **改名等于同时改两侧**：策略 SQL（写在 F6/F7 的迁移里，**那边不会红**）与本常量。
 * 所以 `rls.test.ts` ⑦ 把字面值钉死——至少本仓这一侧改名会红。
 */
export const IDENTITY_SETTING = "openhive.user_id"
