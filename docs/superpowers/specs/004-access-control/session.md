# 会话交接 · 权限控制（004-access-control）

**状态**：✅ **已收尾**（2026-10-05）。15 条 task：**12 条落地**，
**3 条整条移交**下游 feature（T009 / T010 / T011，见下）。Step 5 审查发现 **C1 + I1–I11 共 12 条缺陷，
全部已修**；**Step 5 之后的独立审查（3 席）又得 R1–R5，也全部已修**（含 1 条 Critical：skill 命令出口
缺权限门）。两轮的 Minors 一律挂账未修。

2026-10-06 又走了一轮**收尾补测**（`backend-testing` 六步闭环）：越权那一类补了**命令出口的路由接缝**
（三条 **P0** 回归 `004-BF-01/02/03`），**产品码零改动** —— 详见 `state.md`
「收尾补测：`backend-testing` 六步闭环 · 2026-10-06」。

> 合并到 `multi-tenant` 由**用户**执行（本 feature 不自行 merge）。spec 目录 `004-access-control/`
> **永不删除**（下一 feature 的上下文 + CI 种子）。

---

## 上次做到哪

**全部 task 已处置完毕**——不是「跑完了」，而是每一条要么落地、要么**明确移交**：

| 处置 | task | 说明 |
|---|---|---|
| 落地 | T001–T008、T012–T015 | 12 条。能力签发 → 判定（RBAC）→ 工具清单过滤 → 执行守卫 → MCP 身份 → RLS 机制 → 测试 |
| 移交 | **T008（机制部分）** | 机制已钉成契约 + 见证测试，**落地**移交给 F6/F7 的 MCP server |
| 移交 | **T009** | 整条移交 F6/F7（结果量级控制住 MCP server，004 无 MCP server 可测） |
| 移交 | **T010 / T011** | 整条移交 `007-fund-analysis`（业务数据表今天不存在，无 join 对象） |

### 交付物一览

**core（判定层）**
- `packages/core/src/access/rbac.ts` —— RBAC 判定。出口是 `Permission.Ruleset`：**① fail-closed 基线
  （每个已映射类型一条整体 deny）→ ② 逐条 allow**（顺序即语义，`findLast` 后者胜）。只有 `read` 产
  allow。`RESOURCE_TYPES` / `PERMS` 是**运行时数组**（不是裸联合）——为了让防漂移断言拿得到值。
- `packages/core/src/access/session.ts` —— v1 投影 `sessionRuleset()`：① GOVERNED blanket deny →
  ② 每个 MCP server 两条规则 → ③ 只取 `effect === "allow"`。含 `namingConflicts`（MCP 工具名前缀冲突）。

**auth（授权存储 + RLS 契约）**
- `packages/auth/src/migrations/0004_rbac.sql` —— `role` / `user_role` / `role_resource` 三表，
  值与 core 侧**逐值双向**比对（见下）。
- `packages/auth/src/rls.ts` —— **RLS 写法模板 + 五条不变式**（账号级 / 行级策略、身份事务作用域、
  「LOCAL 剥不掉上一层」、「每个 GRANTed 表都要有 RLS」）。**这是 F6/F7 要照抄的契约**。
- `packages/auth/src/rls.test.ts` —— 见证测试（PGlite = WASM 版真 PG，真跑 RLS 执行器）。

**opencode（接线 + 见证）**
- 工具清单过滤、执行守卫（`AccessDenied` + 审计）、MCP 身份（`_meta["openhive/user"]`）、
  子 agent 权限继承、MCP 资源支路授权（见下「I11」）。
- `packages/opencode/test/server/openhive-rbac-closed-set.test.ts` —— DB 的两个 CHECK 闭集
  ⇔ core 的 `RESOURCE_TYPES` / `PERMS` **逐值双向**。**为什么住在 opencode**：全仓只有它同时
  依赖 auth（够得着真库）与 core（够得着值）。

**上游文件里的「要保留的定制」**（各自单独提交，带 `【这是要保留的定制】` 标记）
- `packages/opencode/src/session/prompt.ts` —— ① 会话创建时取一次 `mcpMeta`；② **I11**：
  `resolvePart` 的 `source.type === "resource"` 支路补上**与工具路径同形**的 `permission.ask`；
  ③ **R1**：`command()` 里 `source === "skill"` 的命令在**读模板之前**补
  `permission.ask({ permission: "skill", patterns: [cmd.name], always: [cmd.name], metadata: {} })`
  ——并**把 agent 解析上移**，好让规则集并上 `agent.permission`（与工具路径同形；`Config.permission.skill`
  只进 agent 规则集、不进会话规则集）。
- `packages/opencode/src/mcp/index.ts` —— MCP 出站带身份那几处（可选 `meta` 形参）；
  **R5** 又给 `getPrompt` 加第 4 个可选 `meta` 并写进出站 `_meta`。⚠️ `Interface` 的**声明与实现两处都要改**
  （漏了声明就是「实现改了、契约没改」，只在调用点报警）。
- `packages/opencode/src/command/index.ts` —— **R5**：MCP prompt 命令的 `template` getter 里
  `const meta = yield* userMeta()` 再传下去（身份本来就在请求 fiber 上，`bridge` 捕获了全量 context）。

### Step 5 修了什么（12 条，全修）

| 编号 | 一句话 |
|---|---|
| C1 | 004 侧 fail-closed 校验：`Config.mcp` 名单 sanitize 后**任意两名不得互为前缀**，重叠即拒绝建会话 |
| I1 | 客户端规则与既有键冲突时**丢弃客户端那条**，保证 capability 恒在最后（不被 `findLast` 前移） |
| I2 | 子 agent 继承时保留受管工具的整体 deny（`blanketDenied`），无 blanket deny 时与上游**逐字节相同** |
| I3/I6/I9 | opencode 接线与见证测试补齐 |
| I4/I5 | auth 侧（RLS 不变式 ④ 事务作用域 + 连接干净；⑤ 每个 GRANTed 表都要有 RLS） |
| I6 | core 值面 + 注释面：**改正一条不实的「有断言钉住」声明**（那条断言原先不存在，现已补上） |
| I7 | `resolve()` 补 fail-closed 基线 + 改正「落回 `ask` 是保守的」这句错话 |
| I8/I11 | `prompt.ts`（上游文件，单独提交） |
| I10 | state.md 的行号引用清理（**42 处**；定位性引用改写符号名，取证快照保留行号 + 标时点） |

**I11 的由来值得记一笔**：它是「表定稿之后」为了把「同形」这句话写准、去逐字核对工具路径时**顺手
发现**的，当时**不在表里**——而它恰恰是最重的一条（资源支路能整个绕开会话里的 MCP deny）。

### Step 5 之后的独立审查（3 席 · 2026-10-05，R1–R5 **全修**）

| 编号 | 一句话 | commit |
|---|---|---|
| **R1**（Critical） | skill 命令出口（`Command.init` 把每个 skill **也**注册成一条命令）**不经过工具层** ⇒ `POST /session/:id/command` 能绕开 `{ skill, *, deny }`。补权限门 + 两条见证 | `0a63df3f6e` |
| **R2**（Important） | 「`packages/auth` 测试**不进 CI**」这处**实测为假**的记述 **7 处**改正（`turbo.json:20` ＋ `test.yml:68`） | `3554cbbc54` |
| **R3**（定位） | `capability.ts` / `issue.ts` **今天零生产调用点**——补文档说清定位（裁定**不删**：F7 要照抄这套结构）；改正 `rbac.ts` 那句「一条直线」（与实测不符） | `982cc71848` |
| **R4**（语义） | **定义「授权变更的生效时点」**：capability 在会话创建那刻焊死 ⇒ **会话生命周期 = 授权的滞后窗口**；落进 **F10 接收表** | `37d8daa86a` |
| **R5**（Important） | `prompts/get` 是三个 MCP 出口里**唯一不带身份**的 ⇒ `getPrompt` 加可选 `meta` ＋ 接线层 `userMeta()`；变异 M-K / M-J 各恰红 1 条 | `35ece21bff` |

**本轮新增三条挂账**（都据实记在 `state.md`，不假装闭合）：① MCP 来源的命令在 `Command.Info` 里
**没有 server 字段** ⇒「它属于哪个 server」表达不出来、capability 判据写不出（R1 只堵住了 skill 那一支）；
② `GET /command` 与已挂账的 `GET /skill` **同型**（instance 级、**非会话作用域** ⇒ 无处过滤，而
`Command.Info[]` 里 skill 的 `template` **就是正文**）；③ R1 的门被拒时**呈现为 500**（`Effect.orDie`，
与工具路径逐字同形；要出可读文案得动 `command()` 的契约错误类型＝动 `Interface` 的全部调用方＝上游面）。

**`M-b` 的现场实测**（3 席 Minor 之一，收尾时补做）：`tools.ts` 的 `ask` 与 R1 的门都是
`merge(agent.permission, session.permission ?? [])`，而 **I11 的资源支路只带 `current.permission`**
⇒ 与工具路径**不同形**：`Config.permission.read` 这类**只进 agent 规则集**的配置在那条支路上**不生效**。
今天记账不改（Minors 裁定）；形状是 `#002-06` 的「同一个判断两处各写一份」，留待有生产调用点时一并处理。

---

## 下次会话要做的事

**本 feature 已收尾，无待办 task。** 后续动作只有两类：

### 1. 用户侧
- 把 `worktree-feat-004-access-control` 合并到 `multi-tenant`（**由用户执行**）。
- ✅ **裁定 ③（2026-10-06，已裁定）**：**PGlite ≠ 生产 PG** —— **挂账，留到 F6/F7 一并闭合**
  （那时第一次出现真实 RLS 策略，版本敏感行为恰在那时才被真正检验）。判据仍是「**缺 PG 就红**」，
  `env` 缺失即 `skip` 会造出**假覆盖**。**落点已写进接收方的表**（F6/F7 的「第四笔」）。
- ✅ **裁定 ④（2026-10-06，已裁定）**：**capability 契约零消费者** —— **等 F6/F7 有消费者时再钉**：
  契约的形状由**消费者**定义（`LEARNINGS #004-07`），零消费者时写下的形状断言很可能钉错形状。
  **落点已写进接收方的表**（F6/F7 的「第四笔」）。
- 裁定一条挂账：**改动过的两个测试文件**的全局 lint 残差（现值，2026-10-05 复测）——
  `packages/opencode/test/session/openhive-mcp-identity.test.ts` **8 warnings / 0 errors**
  （8 条**全是** `no-unsafe-type-assertion`，都落在 Service 桩上）；
  `packages/opencode/test/mcp/openhive-mcp-identity.test.ts` **3 warnings / 0 errors**
  （2 条 `no-unsafe-type-assertion` ＋ 1 条 `no-floating-promises`——`http.stop(true)` 未 `await`，
  **T007 建文件时就在**（R5 的 diff 里它是**未改动的上下文行**），与上游 `test/mcp/lifecycle.test.ts`
  的两行**逐字同款**）。规则是 warning 级、全局 error 数不变（仍 1 条，在上游
  `packages/session-ui/src/v2/components/prompt-input/index.tsx:163:19`）。**当前处置：记账保留**，
  待用户裁定「接受」还是「改 stub 写法」。
  > 取数命令：**在仓库根**跑 `bunx oxlint <文件>`（在包目录里跑会因根配置的 `options.typeAware`
  > 报「only supported in the root config」而测不到数）。

### 2. 下游 feature（**四笔**移交，均已在接收方 `tasks.md` 落表）

**→ F6 `007-fund-analysis` / F7 `008-call-analysis`（两处同构，都要做）**
- **T008 机制落地**：建业务表时一并 `CREATE ROLE … NOLOGIN` + 最小 `GRANT` +
  `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `CREATE POLICY … USING (…)`，**模板照抄
  `packages/auth/src/rls.ts`**；T006（查询 MCP）每个查询在**同一事务内**
  `SET LOCAL ROLE` + `set_config('openhive.user_id', <id>, true)`。
- **T009 整条**：查询强制带上限、超限截断并告知；分页；导出需更高权限。
- ⚠️ **两处 `tasks.md` 都记着的跨 feature 语义冲突**：T006 现写「带 `X-User-ID` + RLS」——
  `X-User-ID` 是 F3 的**入站** HTTP 头（明文、非凭证）；本仓 MCP **出站**身份载体是
  **`_meta["openhive/user"]`**（`packages/opencode/src/mcp/openhive-identity.ts`）。**方向不同、
  载体不同**，MCP server 应读 `_meta`。**开工前按 T007 更正措辞**。
- ⚠️ **三条不许忘**（rls.ts 不变式，见证测试钉着）：① 受限账号**不得**是表 owner / superuser /
  `BYPASSRLS`；② 无身份 ⇒ **空集**（fail-closed），不是「看得见全部」；③ 身份**必须事务作用域**，
  且**连接本身要干净**（`LOCAL` 剥不掉会话级残留 ⇒ 连接池先 `RESET ALL`）。
- ⚠️ **不得声称 FR-006 行级部分已在 F4 端到端验证**（`LEARNINGS #002-02`）。`packages/auth`
  的测试**进 CI**（`turbo.json` 有 `@opencode-ai/auth#test`，CI 跑 `GITHUB_ACTIONS=false bun turbo test`
  ——2026-10-05 更正，原文写「不进 CI」与事实相反）；PGlite **不等于**生产 PG 同版本同构建（残差见 rls.ts 文件头）。
- **补测 ③ / ④（2026-10-06 用户裁定后新增，两处同构）**：**(a)** 「PGlite ≠ 生产 PG」在**你们建表 /
  写策略的那一批**一并闭合 —— CI 加真 PG service，判据必须是「**缺 PG 就红**」（`env` 缺失即 `skip` ＝
  **假覆盖**）；**(b)** `capability` 契约今天**零消费者** ⇒ **由你们（消费者）在接 `dataScope` 时把形状钉住**，
  而不是在零消费者时凭空写形状断言（`LEARNINGS #004-07`：判据来源必须是**被调方**）。
  **完整块在** `007-fund-analysis/tasks.md` / `008-call-analysis/tasks.md` 的**「第四笔」**。

**→ `007-fund-analysis`（T010 / T011）**
- **T010 数据范围**：004 只交**机制定义** —— capability 的 `dataScope` 字段结构 + 「两轴不绑定」的
  架构约定（见 `plan.md` 与 `state.md` 裁定块）。**运行时 join 在 007 实现**（落 T001 建
  `fund_project_member` + T004 判定）。
- **T011 两轴解耦**：落 007 T004 + `005-project-management` T004；验收判据「工作空间成员身份不改
  数据访问结果」要**两轴的表都建出来之后**才验得了。

**→ F10 `010-governance-console`（**不是** task 移交，是一条**语义**，R4）**
- **授权变更的生效时点**：capability 在**会话创建那一刻**焊死（建会话 / 改会话两条路径都只走
  `mergeClientRules`、**不回查**角色表）⇒ **改授权对已存在的会话无效**（**增也一样**），下一次建会话
  才生效。**会话生命周期 = 授权的滞后窗口**；这是 FR-002 的直接代价，不是缺陷。
- 因此 **T003**（RBAC 权限矩阵）若做「改角色 / 改授权」的写入动作：界面**不要写「立即生效」**，
  验收**别把「改完立刻生效」写进出参**。真要「立刻踢掉」只能**让会话作废 / 重新签发**。
- 已在**接收方**的表里落字（`010-governance-console/tasks.md` 文件头，`LEARNINGS #002-04③`）。

---

## 已知缺口（**不是**「已覆盖」，别读错）

| 缺口 | 位置 | 说明 |
|---|---|---|
| **链 B 的 MCP 授权** | `sessionRuleset` 的 mcp 段 | 只对**链 A**（v1 / web UI）生效。链 B（v2 / CLI·sdk-next）**尚无落点**——v2 侧没有对应的 MCP 承载 |
| **`knowledge_base` 资源类型** | `TOOL_OF` | 全仓 `packages/` 下**零命中**，没有对应工具 ⇒ 不产 allow，只被 fail-closed 基线罩着。接上时必须**同时**改 `TOOL_OF` 与 `access-rbac.test.ts` 的 ③ |
| **`write` / `review` / `admin` 三个动作** | `resolve()` | 是**管理动作**（改内容 / 批上线 / 上下架），今天没有承载它们的工具 ⇒ 只有 `read` 产 allow。不是漏做 |
| **`capability.ts` / `issue.ts` 今天无生产调用点**（R3） | `packages/core/src/access/` | 机制定义**已就绪**、结构由 canary 测试逐条钉着，但 `AccessIssue.issue` 在生产里**零调用点**（`issue.ts` 自己写着「本文件不接线」，D0-5）。**不删**——F7 落数据范围时要照抄这套结构；接线那一半在 T005/T006/F7。**2026-10-06 补测裁定 ④：挂账 → 等 F6/F7 有消费者时由消费者钉**（已落进接收方 `tasks.md` 的「第四笔」）。它的「契约」那一面属**跨模块契约**类（`test-routing-advisor` 的候选类，路由表里标 🔧占位·待建），**不在 `backend-testing` 射程**（真库 / 越权 / 并发 / 韧性）；今天能做的只有结构断言（canary 级已有：`core/test/access-capability.test.ts`） |
| **授权的滞后窗口**（R4，**已定义的语义**、不是缺口） | 会话创建 | 改授权（**增也一样**）对**已存在**的会话无效，下一次建会话才生效；今天**不提供**会话级吊销（回查＝在执行器里认角色表＝违反 FR-002）。F10 的授权管理界面**不要承诺「立即生效」** |
| **MCP 来源的命令无法用 capability 表达**（R1 派生） | `src/command/index.ts` 的 `Info` | 字段里**没有 server** ⇒「这条 prompt 命令属于哪个 server」表达不出来，`mcp:<server>:*` 的判据写不出（R1 只堵住了 skill 那一支） |
| **`GET /command`**（R1 派生） | `handlers/instance.ts` 的 `getCommand` | 与 `GET /skill` / `GET /experimental/tool` **同型**：instance 级、**非会话作用域** ⇒ 拿不到 capability、无处过滤，而 `Command.Info[]` 里 skill 的 `template` **就是正文** |
| **R1 的门被拒时呈现为 500** | `prompt.ts` 的 `command()` | `Effect.orDie`（`command()` 的契约错误类型只有 `Image.Error`；改它＝动 `Interface` 的全部调用方＝上游面）。**呈现层**粗糙，不改变授权结论 |
| **Minors（Step 5 的 M14 ＋ 3 席的 `M-a`…`M-e`）** | 见 `state.md` | 一律**挂账未修**（用户裁定）。其中 **`M-b` 已现场实测**（I11 的资源支路只带 `current.permission`，与工具路径不同形，见上） |
| **lint 残差** | 见上「用户侧」 | 待裁定（8 条 / 3 条，均 warning 级） |
| **PGlite ≠ 生产 PG**（③） | `packages/auth/src/rls.test.ts` | 闭合的是**测试自己写的那一半**（RLS 执行器 / 身份事务作用域 / 策略拼装），**不闭合**「与生产 PG **同版本同构建**」。要闭合得在 CI 加真 PG service —— 那要动**上游** `.github/workflows/test.yml`。**2026-10-06 裁定：挂账 → 移交 F6/F7**（两处 `tasks.md` 的「第四笔」：建表/写策略那一批一并闭合，判据「缺 PG 就红」） |
| 命令出口的**路由接缝**（**已补**，2026-10-06） | `session/prompt.ts` 的 `command()` | 原缺口：R1 的两条见证在 **Effect 层**且**自己把规则集塞进会话** ⇒「HTTP 身份头 → 用户 → 每用户库 → 会话行 → 规则集 → 判决」这条搬运**零覆盖**（**把门去掉它们照样全绿**）。**已补** `004-BF-01`（拒 ＋ 正文**零字节**进模型）/ `004-BF-02`（同一条请求换身份的**对照**），落点 `packages/opencode/test/server/openhive-access-command-route.test.ts` |
| 门的**顺序**（**已补**，2026-10-06） | 同上 | 原缺口：门必须在读 `cmd.template` **之前**（否则正文里的 `` !`…` `` 块**先被执行**、再被拒）。**已补** `004-BF-03`；变异 M-②（把门挪到读模板之后）**恰红一条**，证明它是**独立**判据 |

⚠️ **`ask` 不是安全的一侧**（I7 的核心结论）：两条链的弹窗都带「总是允许」，点一次就把没规则的动作
变成持久 allow ⇒ **「没规则」在这里等于「可自批」**，这正是 `resolve()` 必须有 deny 基线的原因。

---

## 门禁（**代码最终状态 `35ece21bff` 上串行复跑**，2026-10-05）

> ⚠️ **时点**：`35ece21bff` 是本 feature **产品码**最后一次改动（R5）；其后只有 docs 提交与
> **2026-10-06 的收尾补测**（只加一个测试文件、产品码一行未动）⇒ 下表数字对该产品码状态仍成立，
> 别读成「在当前 HEAD 上跑过」。
> 复核请在自己的检出上**串行**重跑（`#003-01` 并行会造假红；`LEARNINGS #004-05`）。

| 门 | 结果 |
|---|---|
| `bun run typecheck` | 31 successful / 31 total，exit 0 |
| `bun run lint:openhive` | exit 0（23 warnings / 0 errors / 69 files / 161 rules = 基线逐字） |
| `bun run lint`（全局） | 4953 warnings / **1 error** / 3468 files，exit 1（恒红）。唯一 error = 既有上游 `prompt-input/index.tsx:163:19`；`src` 改动行 **0 命中**；＋2 与两个测试桩对得上（见 `LEARNINGS #001-02`） |
| `packages/core`（4 个 access 测试文件） | 25 pass / 0 fail |
| `packages/auth`（`rls` ＋ `rbac` ＋ `workspace`） | 25 pass / 1 skip / 0 fail（`rls` 走 PGlite 真跑，31 s） |
| opencode access 套件（7 文件） | 39 pass / 0 fail |
| `test/session/prompt.test.ts` | **51** pass / 14 skip / 0 fail（含 R1 的两条见证） |
| `test/session/openhive-mcp-identity.test.ts` | **6** pass / 0 fail（含 R5 的两条） |
| `test/mcp/openhive-mcp-identity.test.ts` | **4** pass / 0 fail（含 R5 的两条） |
| `test/server/openhive-access-command-route.test.ts`（**2026-10-06 新增**） | **2** pass / 0 fail（`004-BF-01/02/03`）；＋ 与同族 `openhive-access-wiring.test.ts` **同一进程**跑 **8 pass / 0 fail** |
| `git diff --stat bun.lock` | **空**（无镜像源污染） |

> ⚠️ 门禁**串行**跑（`LEARNINGS #003-01`：并行跑重测试会造假红）。取退出码**不许进管道**。

---

## 禁止重新规划

`plan.md` 已定稿、`tasks.md` 已锁定、**本 feature 已收尾**。交接给下游的三笔都已写进**接收方**
的 `tasks.md`（不是只写在这里）。若要重开本 feature，先与用户确认；否则直接进入依赖 004 的下一个
feature。
