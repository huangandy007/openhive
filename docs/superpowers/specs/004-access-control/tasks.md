# Tasks: 权限控制

**Input**: `docs/superpowers/specs/004-access-control/`

**Prerequisites**: spec.md（用户故事）、plan.md（结构 / 集成点）、F2 身份注入 + F3 db 路由已落地

**Tests**: 安全测试——越权工具调用被拒、越权 SQL 被 RLS 拦截、路径穿越 / SQL 注入 / 未授权直连。

## 任务格式约定

- `[P]` = 可并行（不同文件、无依赖）
- `[USn]` = 所属用户故事
- 每条含 `[FR-x 来源] [依赖任务] [出参验证方式]`

## Phase 1: Setup（定位 + 方案锁定）

- [x] T001 [P] 定位 opencode 工具执行器入口（tools 组装处 + 执行处），产出挂载点清单 [FR-002][FR-003] [无依赖] [出参：工具组装/执行两处真实入口]
  - ✅ 2026-10-04 完成。**实测推翻 plan.md 的前提**：不是「一个统一执行器入口」，而是**两条独立主链**
    （A = opencode v1 / web UI，B = core v2 / CLI·sdk-next，互不 import），且**两条链各自已有上游的
    ruleset 驱动钩子**（清单过滤 + 执行断言）。完整挂载点清单见 `state.md` 的 D0-1 表。
    用户裁定：**两条都接**（判定写一份、按链注入 ruleset），落点 **core**。
- [x] T002 [P] 确定 capability scope 结构（用户 + 项目 + 数据范围字段）[FR-001] [无依赖] [出参：capability 结构定义]
  - ✅ 2026-10-04 完成。落点 `packages/core/src/access/capability.ts`（**openhive 定制文件，非上游**）
    ＋ canary 测试 `packages/core/test/access-capability.test.ts`（4 pass）。结构：
    `Capability = { id: cap_* , scope: { user, project(=工作空间轴 Project.ID), dataScope }, permissions: Ruleset }`。
    **裁定（用户 2026-10-04）**：`dataScope` 只写「按谁、按哪条规矩查」
    （`{ subject, rule: "project-membership" }`），**不写任何项目 id 列表**——写死即冻结，
    与 FR-008「运行时实时算出」冲突。完整理由 / 实测 / 变异验证见 `state.md` 的 T002 段。

## Phase 2: Foundational（capability 签发 + RBAC）

- [x] T003 实现 capability 签发（按用户 + 项目 + 数据范围）[FR-001] [T002] [出参：签发函数产出 scope 限定 capability]
  - ⚠️ 出参 2026-10-04 由「**会话启动**产出」改写为「**签发函数**产出」：实测仓库里**没有「会话启动」可挂的时刻**
    （创建不启动、启动在首次 prompt、无 started 事件；链 B 且无可写每会话槽位）。裁定见 `state.md` D0-5。
    接线（把证挂到会话上）归 **T005 / T006**。
  - ✅ 2026-10-04 完成。落点 `packages/core/src/access/issue.ts`（**openhive 定制文件，非上游**）
    ＋ canary 测试 `packages/core/test/access-issue.test.ts`（4 pass）。
    `issue({ user: User.Info, project, permissions }) → Capability`；`scope.user` 与
    `dataScope.subject` **一律由 `user.id` 派生**（调用方无法替别人签，canary 钉死），
    `permissions` 原样焊进证里（未命中仍是上游兜底 `ask`）。变异 A/B/C 见 `state.md` T003 段。
    门禁：typecheck exit 0；`lint` 我两个新文件 0 命中；core **1149 pass / 8 skip / 5 fail**（差集为空）。
- [x] T015 实现迁移 CLI（`migrate()` 的生产调用路径）[D-05 裁定] [出参：一条可执行的迁移命令——缺配置必响、没活干要说话]
  - ⚠️ **不在原计划里**：由 `docs/workspace/deploy-todo.md` 的 **D-05** 裁定产生。004 要加 `0004`（RBAC 表），
    正好撞上 D-05 那笔账（`migrate()` 唯一的调用点是一次性引导 ⇒ 撤掉变量后**新迁移没人应用**）。
    用户 2026-10-04 两问两裁：路径 ⇒ **独立 CLI 脚本**；回滚范围 ⇒ **只做向上迁移**。
  - ✅ 2026-10-04 完成。落点 `packages/auth/src/migrate-cli.ts`（openhive 定制）
    ＋入口 `packages/auth/script/migrate.ts`＋`packages/auth/package.json` 加 `migrate` 脚本
    （**package.json 是上游文件被改，提交信息已单独标注**）。命令：`bun run --filter @opencode-ai/auth migrate`。
  - 测试 `packages/auth/src/migrate-cli.test.ts`（2 pass）；**第二半是真库**——PGlite socket 走**生产驱动** `bun-sql`，
    钉「第一次有活干 / 第二次幂等且**仍有输出**」。变异 A（把缺配置降级成静默 `return []`）**恰红 1 条**。
  - ⚠️ **R11 未被解锁**：CLI 只做向上迁移 ⇒ 003 的**回归条件 ③**（`rollback()` 有了生产调用者）**未触发**，
    维持「明确不做」。🚩 触发条件已收紧并**逐字写进** CLI 头部注释 ＋ D-05 条目。完整裁定见 `state.md` T015 段。
- [x] T004 [P] 实现 RBAC 表（role / user_role / role_resource）+ 权限判定（读/写/审/管）[FR-007] [T001] [出参：角色授资源权限，判定函数返回正确结果]
  - ✅ 2026-10-04 完成。两处落点：**库**在 auth（`packages/auth/src/migrations/0004_rbac.sql` ＋ drizzle 模型 `rbac.ts`），
    **判定**在 core（`packages/core/src/access/rbac.ts` 的 `resolve()`，纯函数、碰不到库——core 不依赖 auth，实测）。
    出口 `Permission.Ruleset`（用户裁定），直接喂 T003 的证；**未授权仍落上游兜底 `ask`，绝不补 allow**。
  - 两问两裁：「用户例外」⇒ **不加第 4 张表**（例外 = 单独给一个自定义角色）；判定出口 ⇒ **`resolve(...) → Permission.Ruleset`**。
  - 测试：core `test/access-rbac.test.ts`（7 pass）＋ auth `src/rbac.test.ts`（8 pass，**打真库** PGlite）。
    变异 A–F：A/B/C/D/F **恰红目标**；**E（外键 CASCADE）一度全绿** ⇒ 查出「两条外键挂在同一个角色上互相掩护」，
    拆成两条各自只让一把外键在场的用例后 **E 恰红**（`LEARNINGS #003-03` 的 ③ 类处理）。
  - ⚠️ **0004 撞红了 4 个既有测试文件里的 7 条断言**（002 时期写死了迁移清单：`["0001_init", …]`、head = `0003_flags_not_null`）。
    按 `#002-06`（会随编辑变的值别写死）改为**从盘上取**：`migrate.ts` 新增 `migrationVersions()`（**openhive 定制，「加」不「改」**），
    4 处断言改用它 / 用 `migrate()` 的返回值；`register.test.ts` 那句 `drop table auth.user` 因新外键需加 `cascade`。
    见 `state.md` T004 段的「既有测试的连带修正」。
  - 门禁：typecheck exit 0；`lint` 我那 4 个新 `.ts` **0 命中**（全局 4942/1 与基线逐字相同）；auth **210 pass / 1 skip / 0 fail**（T015 后基线 202 → **+8**）。
  - 🔧 **修正（2026-10-04，T006 前置）**：`resolve()` 第一版产出的词表是 `{action=perm, resource="<type>:<id>"}`，
    而实测**所有消费者读的都是** `{action=<工具名>, resource=<工具实参>}` ⇒ 旧词表**一条都命中不了、全部静默落回 ask**
    （`LEARNINGS #003-05` 的假镜像形状）。用户 2026-10-04 三条裁定：① **改 `resolve()`**（不改消费者）；
    ② **只有 `read` 进 ruleset**；③ **`mcp` / `knowledge_base` 跳过 ＋ 显式记缺口**（指向 T007）。
    > ✅ ③ 里的 **`mcp` 已由 T007 落地**（2026-10-05，走 `sessionRuleset` 的 ② 段、名单由调用方给；
    > `resolve()`/`TOOL_OF` 这条出口**仍然只认 skill**——那条断言照旧成立）。`knowledge_base` 仍是缺口。
    落地：`rbac.ts` 加 `TOOL_OF` 对照表 ＋ 两个守卫；`test/access-rbac.test.ts` **7 → 8 条**（② ③ 换语义、新增 ③ 缺口断言）。
    变异 M1/M2/M3 **全部恰红目标**。门禁复跑全绿（typecheck 0／lint:openhive 0／全局 4942/1/3452 与基线逐字相同／core 三个 access 测试 16 pass）。
    详情见 `state.md` 的「T004 修正」段。

## Phase 3: US2 工具过滤 + 执行鉴权（P1）

- [x] T005 实现工具清单过滤（组装 tools 前按 capability 只放有权工具）[FR-003] [T001][T003] [出参：无权工具不出现在 tools]
  - ✅ 2026-10-05 完成。**前置结论**：T005 的字面出参（无权工具不出现在模型拿到的 `tools` 里）
    **已随 T006 的通道生效**——`SessionTools.resolve` 把 `session.permission` 交给 `registry.tools`，
    `prompt.ts` 再把它当 `permission` 传进 `resolveTools` ⇒ **不必新建 `tool-filter.ts`**
    （`plan.md:51` 那条路径已被 D0-1 判空）。
  - **用户 2026-10-05 裁定**：T005 在「三处可见性出口」里做到 **「补 `sys.skills` + 验收测试」**这一步
    （另两处非会话出口 `GET /skill`、`GET /experimental/tool` **显式挂账**，见下）。
  - 落地：`src/session/system.ts` 的 `skills(agent, permission?)` 改为吃 `session.permission`，
    判据用**与工具过滤逐字同款**的 `Permission.disabled(["skill"], merge(agent.permission, permission ?? []))`
    （照 `#003-05`，不另造一套判据）；`src/session/prompt.ts` 调用点传 `session.permission`（与 `sys.mcp` 同形）。
    两处**均为上游文件**，已单独提交并标【这是要保留的定制】。
  - 验收：`test/session/openhive-tool-visibility.test.ts` **6 条**（目录可见性 4 条，含
    「目录可见 ⟺ skill 工具可见」的 6-ruleset 矩阵；真 `LLMRequestPrep.prepare` 2 条）。
    变异 **M6**（`skills` 改回只读 `agent.permission`）⇒ 恰红 2 条；**M5**（`resolveTools` 的
    `input.permission` → `undefined`）⇒ **恰红 1 条**（据实记，非「两条都红」）。
  - 门禁（串行）：`typecheck` **31/31 exit 0**；`lint:openhive` **23/0 exit 0**（= 基线）；
    全局 `lint` **4942 warnings / 1 error**（= 基线逐字相同；新文件 0 命中，改动行 0 命中）；
    `test/session/` **408 pass / 1 fail**（唯一红 = 开工基线已知的 `snapshot race`）。
  - ⚠️ 本 task 顺带修掉 **T006 的一条回归**（见 T006 段的「契约适配」）。
- [x] T006 实现工具执行守卫（执行前验 capability，无权限 AccessDenied + 审计）[FR-004] [T001][T003] [出参：越权调用被拒并留审计]
  - 📌 **补充（2026-10-05，T005 收尾发现）**：`src/session/prompt.ts` 的 `input.tools` 由「整体覆盖」
    改「并入」后，上游测试 `prompt tools replace previous prompt tool rules` 变红（其名即编码旧的
    replace 语义）。用户 2026-10-05 裁定 **保留 merge**（安全属性由 `openhive-access.test.ts` ⑦ 单独钉住），
    该上游测试已改为断言新契约并标【这是要保留的定制】——**需适配的上游测试仅此一条**（已隔离复现确认）。
  - ✅ 2026-10-04 完成（**链 A 那一半**；链 B 与审计**显式挂账**，见下）。Step 0.5 式侦察已做
    （两条链 ＋ 各自已有的上游 ruleset 钩子 ＋ 工具执行必经点 `packages/core/src/tool/tool.ts` 的
    `config.execute`；`packages/core/src/tool/AGENTS.md` 明禁在该目录加并行守卫）；**前置修正已落地**
    （T004 的 `resolve()` 词表 —— 见 T004 段 🔧）。
  - **六条裁定**（用户 2026-10-04）：① 链 B 槽位 ⇒ **只接链 A，链 B 显式挂账**；
    ② 链 A 写入口 ⇒ **会话创建时写**；③ 未授权的 skill ⇒ **显式 deny**（不是落回 `ask`）；
    ④ 审计 ⇒ **只做「拒」，审计挂账**；⑤ 取库句柄 ⇒ **照 `gateway.ts` 的惰性闭包写法**；
    ⑥ 实测 `Session.fork` 不复制 `permission` ⇒ **在 fork 里带上原会话的 `permission`**。
    **capability 挂载点已裁定**（= ②，此前那句「尚未裁定」作废）。
  - 落点（**加，不是改**）：`packages/core/src/access/session.ts`（纯判定，D0-1 裁定归 core）、
    `packages/auth/src/rbac.ts` 的 `grantsFor()`（取行）、`packages/opencode/src/server/openhive/access.ts`
    （接线，openhive 定制新增）。改上游三处并**各自带【保留的定制】标记、单独提交**：
    `handlers/session.ts`（create 并入 ＋ update 顺序）、`session/prompt.ts`（`input.tools` 不再整体覆盖）、
    `session/session.ts`（fork 带上 permission）。另新增 `auth/src/test-support.ts` 的
    `startProductionDb()`（夹具拆出 start/stop，供跨用例生命周期，见下）。
  - 收口了两条**客户端可自批**的越权路：`update` 端点、`prompt.ts` 的覆盖（`input.tools` 是客户端发来的）。
    另有约 14 处 `Permission.merge` 调用点**未动** —— 它们本就已把 `session.permission` 放在最后。
  - 测试 12 条：`openhive-access.test.ts` 9 条（纯函数；拿链 A **真判决器** `evaluate` 验，不是对字符串）
    ＋ `openhive-access-wiring.test.ts` 3 条（真应用 ＋ 真库；**直接读库文件的 `permission` 列**，
    不经过被测接口）。变异：M1（去掉 merge）**3 条全红**；M2（并入顺序反）**恰红 1 条**（客户端绕过那条）；
    M3（去重）/ M4（`GOVERNED` 加 mcp）见 `state.md`。
  - 门禁：typecheck exit 0（31/31）；`lint:openhive` exit 0（23 warnings / 0 errors / 69 files / 161 rules，
    与基线逐字相同）；全局 lint exit 1（4941 warnings / 1 error / 130 rules / 3456 files，与基线 4942 差在
    `packages/llm/src/tool-runtime.ts:63:44` 一条 —— **我没碰过的文件**，名称级差集确认无新增）；
    auth **213 pass / 1 skip / 0 fail**（T004 后基线 210 → ＋3，恰是本次 rbac 用例）；
    opencode `test/server/` **380 pass / 23 skip / 1 fail**（唯一那条红是开工基线里 14 条之一的
    `file HttpApi > serves search endpoints`）。
  - ⚠️ **新运行期契约：门开 ⇒ 建会话须能连 auth 库**（fail-closed —— 「取不到授权」与「没有任何授权」
    在会话那一层长得一样，若按空授权放行，skill 会落回可自批的 `ask`）。既有测试
    `tenant-db-isolation.test.ts` 4 条因此 500，用户 2026-10-04 裁定**照 T020 先例给测试配真库**
    （`openhive-bootstrap.test.ts` 同一形状），已修复并单独提交。
  - 📤 **显式挂账**（**不写成「已覆盖」**，`LEARNINGS #002-02`）：
    ① **链 B**（core v2 / CLI·sdk-next）尚未接 —— 用户裁定；
    ② **审计**（留痕）未做，用户裁定挂账、落点 F10；
    ③ **存量会话**（本次改动之前建的）的 `permission` 里没有 deny；
    ④ **进程内 `approved` 可压过 capability deny**：`evaluate(permission, pattern, ruleset, approved)`
       把 `approved` 排在**最后**（实测 `packages/opencode/src/permission/index.ts:73`，`findLast` 后者胜），
       而它是 `InstanceState` 里的**进程内**数组（同文件 `:51`，重启即失）。要有这个洞，需要同一进程里
       先有一条 `ask`（= 当时没有 deny 盖住它）被点过「总是允许」——门关着跑过 dev、或升级前的旧会话
       都能造出这样一条。**不跨进程存活**，但同一进程内它对本 capability deny 全权生效。
       触发条件与判据逐字记在此处，不假装闭合。

## Phase 4: US3 MCP 账号兜底 + RLS（P1）

- [x] T007 实现 MCP 端带 user 身份 + 受限数据库账号执行 [FR-005] [T003] [出参：MCP 查询带身份、受限账号]
  - ✅ 2026-10-05 完成（**只做今天打得到的那一半**；「受限数据库账号 + GRANT/RLS」**挂账 F6/F7**，见下）。
    > ✅ 前向指针（2026-10-05 补）：那条挂账的**机制那一半**已由 **T008** 补上（契约 + 见证测试，
    > 见下方 T008 块）；**落地那一半**仍归 F6/F7（接收行在其 tasks.md 文件头）。
  - **四条裁定**（用户 2026-10-04 / 10-05）：① 身份载体 = 调用点直读 `User`
    （`Effect.serviceOption(User.Service)`）——**不读** session `metadata`（客户端可写 ⇒ 可伪造）；
    ② 未授权 server 的堵法 = **capability 里加 server 名单**（取 `Config.mcp` 的键）；
    ③ 名字翻译 = **core 出形状、opencode 出名字**（`sessionRuleset(grants, mcp?)` 收调用方用真
    `McpCatalog.sanitize` 算好的前缀 ⇒ core 里没有一份复制来的 sanitize，`#003-05`）；
    ④ T007 范围 = 只做打得到的（受限 DB 账号挂账）；T006 回归**保留 merge**、改上游测试。
    > ⚠️ 早先框的「把 `TOOL_OF` 升为函数」**作废** —— 落地是 ③ 那条，core 侧连一个可漂移的字符都不留。
  - 落地①**身份注入**：`src/mcp/openhive-identity.ts`（新，`USER_META_KEY` + `userMeta()`）；上游三处
    加**可选** `meta` 参数并**各自带【这是要保留的定制】、单独提交**——`src/mcp/catalog.ts`（`convertTool`）、
    `src/mcp/index.ts`（`Interface` **声明** ＋ `layer` **实现**两处！）、`src/session/tools.ts`
    （`const mcpMeta = yield* userMeta()`，**取一次、两个出口共用**）。
    `meta` 为空 ⇒ **连键都不多一个**（「没有身份就不注入」≠「注入一个空身份」）。
  - 落地②**capability 投影**（T004 明确留给 T007 的连接级那一半）：`packages/core/src/access/rbac.ts`
    新增常量 `READ`；`packages/core/src/access/session.ts` 新增 `McpServerNaming` ＋ `sessionRuleset()` 的
    ② 段（**`mcp` 省略时与 T006 逐字相同** ⇒ 既有调用点零回归）；`src/server/openhive/access.ts` 的
    `toolPatternOf`（**拿真 `McpCatalog.toolName(server, "")` 取前缀**，不自拼分隔符）＋ 名单取 `Config.mcp`。
  - **两套形状**（实测 `src/session/tools.ts`）：server 工具 `ask` 的是**工具名** ⇒ 可隐藏也可拒；
    资源工具 `ask` 的是 `read` + `mcp:<原样 server>:*` ⇒ **与文件读取同名，不能隐藏**（只能执行期拒）。
    每个 server 因此出**两条**同向规则——**只 deny 是半条**（MCP 的 `ask` 带 `always:["*"]`，授过的
    server 不显式 allow 一样会弹「总是允许」）。「资源可见但不可用」是取舍，非遗漏。
  - 验收 **24 条**，四层各一组、**每组带对照**：`test/session/openhive-mcp-identity.test.ts` 2（真 `resolve`
    ＋ 真 `convertTool`，假 client 只记出站参数）；`test/mcp/openhive-mcp-identity.test.ts` 2（真 `MCP.Service`
    ＋ 进程内 streamable-HTTP 服务器记 `resources/read` 参数）；`test/server/openhive-access-mcp.test.ts` 10
    （纯函数 ＋ 链 A 真判决器；含可见性不对称那条）；`test/server/openhive-access-mcp-wiring.test.ts` 1
    （真应用 ＋ 真 PGlite，**直接读库里的 `permission` 列**）。对照 = 「无身份 ⇒ `"_meta" in params === false`」。
  - 变异 / RED 观察：回退 `mcp/index.ts` 两处 ⇒ 线路那 2 条红；去掉 wiring 的两条 mcp 规则 ⇒ 该断言红。
  - 门禁（串行，2026-10-05）：同 `state.md` T007 段 §7 —— typecheck **31/31 exit 0**（首跑 3 条真错已修，
    根因是 `Interface` 声明漏改、只在**调用点**报警）、`lint:openhive` **23/0 exit 0** = 基线、
    全局 `lint` 唯一 error = 既有上游文件、`test/mcp/` **67 pass / 0 fail**、core RBAC **8 pass**、
    `test/session/` 4 条红经**中性化对照**确认非本次引入（5 秒线超时）。
  - 📤 **显式挂账**（见 `state.md` T007 段 §8，**不写成「已覆盖」**）：
    > ✅ 前向指针（2026-10-05 补）：挂账 ① 的**机制那一半**已由 **T008** 补上（契约 + 见证测试）；
    > **落地那一半**仍归 F6/F7。其余 ②–⑤ 不受 T008 影响。
    ① **受限数据库账号 ＋ GRANT/RLS** 归 **F6/F7**（本机无 PG/Docker）；
    ② `POST /mcp` 运行期加的 server 不在名单 ⇒ 落回上游 `ask`，
    且该端点接受 `type:"local"`（任意进程）——**上游既有洞，只上报不修**；③ `src/tool/code-mode.ts`
    第二处 `callTool` 不走 `resolve()`（env 门、默认关）⇒ 该模式不带身份；④ 链 B MCP 无消费者（同 T006 挂账 ①）；
    ⑤ 资源工具**藏不了**（归一成 `read`）。
- [x] T008 实现业务数据 PG 行级 RLS 策略（CREATE POLICY）[FR-006] [T007] [出参：越权行被 RLS 过滤]
  - ✅ 2026-10-05 完成（**甲裁定**：机制在本 feature **定义**并**本机可验证**；**落地**（建表 / 建策略 /
    建角色 / GRANT）**移交 F6/F7**，接收行已写进 `007-fund-analysis/tasks.md` 与
    `008-call-analysis/tasks.md` 的**文件头**——`LEARNINGS #002-04①`：移交要落进**接收方**的表）。
  - **裁定「甲」**（用户 2026-10-05）：出参「越权行被 RLS 过滤」**今天在仓库里打不到**——`spec.md:137`
    自己写着「业务数据的 RLS 落地依赖 F6/F7 的数据项目成员表，**本 feature 定义权限机制**」。
    ⇒ 只做打得到的那一半（同 T007 处置）：**契约 + 见证测试**，**产品代码不落任何业务表或策略迁移**
    （本仓没有业务库迁移目录；auth 的 `src/migrations/` 是 **auth schema** 的，两者是**两个库**）。
  - **Step 0.5 实测（动代码前）**：`fund_project_member` / `call_project_member` / `project_member`
    在 `packages/**` 下**零命中**（全仓无业务表迁移）；`packages/core/src/access/capability.ts` 已把成员规则
    记为 F7 的；本机无 Docker / PG 二进制（`#002-05`），但 **PGlite 探针实测** `CREATE ROLE` / `GRANT` /
    `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` / `SET LOCAL ROLE` / `set_config(…, true)` **全部真跑**，
    且连接用户 `rolsuper = true`（⇒ owner/superuser 绕过 RLS 这一层也量得到）。
  - **落点**：`packages/auth/src/rls.ts`（契约常量 `IDENTITY_SETTING` ＋ 文件头承载策略模板与四条不变式）
    ＋ 同目录 `rls.test.ts`（见证测试）。**为什么在 auth**：`@electric-sql/pglite` 只装在 auth
    （devDependency），且 **auth 不 import core**（实测）⇒ 放 core 会造一条今天不存在的边；auth 的
    `policy.ts` + `policy.test.ts` 是本仓「契约常量模块 + 同目录测试」的**先例**。**不新建包、不写投机 SQL 构造器。**
  - **身份通道（与 T007 的接缝）**：`_meta["openhive/user"]`（T007 已交付）→ MCP server 在**同一事务内**
    `SET LOCAL ROLE <受限账号>` ＋ `set_config('openhive.user_id', <id>, true)` → PG RLS。两端名字
    **故意不同**（`_meta` 键 ≠ GUC 名）——同形是**假镜像**（`#003-05`）。
  - 见证测试 **7 条**：①成对正向（alice→[1,2] / bob→[3]）②反向（互不可见）③无身份⇒空集（含 carol）
    ④**负对照**（连接用户看到全部 3 行）⑤作用域（LOCAL vs 连接级残留 + 空串/NULL 两形态 + LOCAL 不剥上层）
    ⑥无 GRANT⇒`42501` 非空集 ⑦GUC 名字面钉死。
  - **变异（证据来自变异，首次绿不算，`#002-02`）**：M1（不 ENABLE RLS）⇒ 恰红 ①②③⑤；
    M2（`USING (true)`）⇒ 恰红 ①②③⑤（与 M1 同集——本组**区分不了**「没开」与「恒真」）；
    M3（`USING (false)`）⇒ **恰红 ①⑤**，②③绿 ⇒ **只有 ① 的相等断言**抓得住「过紧」，
    这正是 spec 风险 R3 要**双向**的实证；M4b（身份改连接级、无事务）⇒ **恰红 ③④⑤**（③ 抓跨请求串号）。
  - 门禁（串行，2026-10-05）：见 `state.md` T008 段。
  - 📤 **显式挂账**（不写成「已覆盖」）：① 业务表 / 策略 / 角色 / GRANT **落地**归 F6/F7；
    ② PGlite **≠** 生产 PG 同版本同构建（owner / `BYPASSRLS` / `FORCE` 那层仍需 CI 真实例）；
    ③ **`packages/auth` 测试不进 CI** ⇒ 本组是**本地门禁**；④ 改 GUC 名要**同时改 F6/F7 策略 SQL**，
    而**策略侧不会红**（故 ⑦ 把本侧钉死）；⑤ 结果量级（LIMIT / 分页 / 导出）是 **T009**，不在本 task。

- [ ] T009 ~~实现结果量级控制（MCP LIMIT + 分页 + 导出需更高权限）~~ 📤 **整条移交 F6/F7**（2026-10-05 用户裁定「乙」，见 `state.md` T009 段）[FR-006] [T007] [出参：超限查询被 LIMIT 拦截]
  - 移交原因：design-v2 §14.2 原话「**MCP 层**强制 LIMIT + 分页 + 导出需更高权限」——强制点**全在
    MCP server**，而全仓**没有 MCP server**（实测：opencode 只是 MCP **客户端**）、没有业务查询路径、
    没有「导出」承载物（`Perm` 只有 read/write/review/admin，只有 `read` 产生规则）⇒ **无可测对象**。
  - 与 T008 的**关键差别**：T008 有真引擎（PG 的 RLS 执行器）可被变异见证；这里 LIMIT 只是 MCP server
    自己 SQL 的一句子句，写「`LIMIT 10` 只回 10 行」是在测 PG、不是测我们的代码 ⇒ **空断言**
    （TDD：测试立刻通过 ＝ 你在测既有行为）⇒「机制见证」这条**这次做不出非空版本**，故整条移交。
  - 落点 = `007-fund-analysis` / `008-call-analysis` 的 **T006**（各自的数据查询 MCP）＋ 两文件头的
    第三笔移交块。⚠️ **不得声称 FR-006 第四档已在 F4 覆盖**（`LEARNINGS #002-02`）。

## Phase 5: US5 数据范围（数据轴）（P2）

- [ ] T010 ~~实现数据范围运行时 join「数据项目 ↔ 用户」实时算出~~ 📤 **整条移交 `007-fund-analysis`**（2026-10-04 用户裁定，见 `state.md` D0-4）[FR-008] [T003][T007] [出参：数据范围按有权项目实时过滤]
  - 移交原因：**今天没有对象可 join**（`fund_project_member` 等表在 `packages/` 下零命中），
    且 F7 反向依赖 004 ⇒ 循环依赖空档。落点 = `007-fund-analysis` 的 **T004 / T001**。
    ⚠️ **不得声称 FR-008 已端到端验证**（`LEARNINGS #002-02`）。
- [ ] T011 ~~实现数据轴 / 工作空间轴两套权限解耦~~ 📤 **整条移交 F7**（同上）[FR-009] [T010] [出参：工作空间成员不影响数据访问权限]
  - 落点 = `007-fund-analysis` **T004**（数据轴）＋ `005-project-management` **T004**（工作空间轴）。
    004 只交**架构约定**（capability 的 `dataScope` 字段结构 + 两轴不绑定）。

## Phase 6: 安全测试（验收，P1）

- [ ] T012 写测试：越权工具调用被拒 + 审计留痕 [FR-010][SC-001] [T006] [出参：测试通过，AccessDenied + 审计]
- [ ] T013 写测试：越权 SQL 被 RLS 拦截、拿不到无权数据行 [SC-002] [T008] [出参：测试通过，越权行不可见]
- [ ] T014 写安全测试（路径穿越 / SQL 注入 / 未授权直连 / 越权读他人数据）[design-v2 §14.5] [T006][T008] [出参：安全测试全通过]

---

## 并行组与依赖总览

- **Phase 1**：T001 ∥ T002（并行）
- **Phase 2**：T003（依赖 T002）；T004 ∥ T003（依赖 T001，可与 T003 并行）
- **Phase 3**：T005（依赖 T001+T003）；T006（依赖 T001+T003，可与 T005 并行）
- **Phase 4**：T007（依赖 T003）；T008（依赖 T007）；~~T009~~ —— **整条移交 F6/F7**（2026-10-05 用户裁定「乙」）
- **Phase 5**：~~T010~~ / ~~T011~~ —— **整条移交 F7**（2026-10-04 用户裁定）。本 feature 的 Phase 5 清空，
  只留架构约定（`dataScope` 字段结构 + 两轴不绑定），运行时 join 与两轴验收在 `007-fund-analysis` T004
  ＋ `005-project-management` T004 落地。
- **Phase 6**：T012（依赖 T006）∥ T013（依赖 T008）∥ T014（依赖 T006+T008）

共 15 条任务（T001–T015），其中 **3 条移交**（T010 / T011 → F7；**T009 → F6/F7**）
⇒ **本 feature 在册 12 条**（T001–T008 + T012–T015），符合 12–18 条范围。
⚠️ **T015 是计划外新增**（D-05 裁定产生，非原 tasks 列表），已计入。
