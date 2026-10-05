# 会话交接 · 权限控制（004-access-control）

**状态**：✅ **已收尾**（2026-10-05）。15 条 task：**12 条落地**，
**3 条整条移交**下游 feature（T009 / T010 / T011，见下）。Step 5 审查发现 **C1 + I1–I11 共 12 条缺陷，
全部已修**；Minors 除 M14 外一律挂账未修。

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

**上游文件的两处「要保留的定制」**（各自单独提交，带 `【这是要保留的定制】` 标记）
- `packages/opencode/src/session/prompt.ts` —— ① 会话创建时取一次 `mcpMeta`；② **I11**：
  `resolvePart` 的 `source.type === "resource"` 支路补上**与工具路径同形**的 `permission.ask`。

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

---

## 下次会话要做的事

**本 feature 已收尾，无待办 task。** 后续动作只有两类：

### 1. 用户侧
- 把 `worktree-feat-004-access-control` 合并到 `multi-tenant`（**由用户执行**）。
- 裁定一条挂账：`packages/opencode/test/session/openhive-mcp-identity.test.ts` 的全局 lint
  警告数 **6 → 7**（+2 `no-unsafe-type-assertion`、−1 `no-unnecessary-type-assertion`），
  新增两条与新测试 stub 逐字同款于文件既有 5 条。规则是 warning 级、全局 error 数不变（仍 1 条，
  在上游文件）。**当前处置：记账保留**，待用户裁定是「接受」还是「改 stub 写法」。

### 2. 下游 feature（三笔移交，均已在接收方 `tasks.md` 落表）

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

**→ `007-fund-analysis`（T010 / T011）**
- **T010 数据范围**：004 只交**机制定义** —— capability 的 `dataScope` 字段结构 + 「两轴不绑定」的
  架构约定（见 `plan.md` 与 `state.md` 裁定块）。**运行时 join 在 007 实现**（落 T001 建
  `fund_project_member` + T004 判定）。
- **T011 两轴解耦**：落 007 T004 + `005-project-management` T004；验收判据「工作空间成员身份不改
  数据访问结果」要**两轴的表都建出来之后**才验得了。

---

## 已知缺口（**不是**「已覆盖」，别读错）

| 缺口 | 位置 | 说明 |
|---|---|---|
| **链 B 的 MCP 授权** | `sessionRuleset` 的 mcp 段 | 只对**链 A**（v1 / web UI）生效。链 B（v2 / CLI·sdk-next）**尚无落点**——v2 侧没有对应的 MCP 承载 |
| **`knowledge_base` 资源类型** | `TOOL_OF` | 全仓 `packages/` 下**零命中**，没有对应工具 ⇒ 不产 allow，只被 fail-closed 基线罩着。接上时必须**同时**改 `TOOL_OF` 与 `access-rbac.test.ts` 的 ③ |
| **`write` / `review` / `admin` 三个动作** | `resolve()` | 是**管理动作**（改内容 / 批上线 / 上下架），今天没有承载它们的工具 ⇒ 只有 `read` 产 allow。不是漏做 |
| **Minors（除 M14）** | 见 `state.md` Step 5 表 | 一律**挂账未修**（用户裁定） |
| **M14** | `state.md` | Step 5 唯一记进 M14 的 minor |
| **lint 残留 6 → 7** | 见上「用户侧」 | 待裁定 |

⚠️ **`ask` 不是安全的一侧**（I7 的核心结论）：两条链的弹窗都带「总是允许」，点一次就把没规则的动作
变成持久 allow ⇒ **「没规则」在这里等于「可自批」**，这正是 `resolve()` 必须有 deny 基线的原因。

---

## 门禁（Step 5 全修后**串行**复跑，2026-10-05）

| 门 | 结果 |
|---|---|
| `bun run typecheck` | 31/31，exit 0 |
| `bun run lint:openhive` | exit 0（23 warnings / 0 errors / 69 files / 161 rules = 基线逐字） |
| `bun run lint`（全局） | 本次新增/改动文件 **0 命中**（全局基线恒红，见 `LEARNINGS #001-02`） |
| `packages/core` | 25 pass |
| `packages/auth` | 19 pass |
| opencode access 套件 | 39 pass |
| `test/session/prompt.test.ts` | 49 pass / 14 skip |
| `openhive-mcp-identity.test.ts` | 4 pass |
| `git diff --stat bun.lock` | **空**（无镜像源污染） |

> ⚠️ 门禁**串行**跑（`LEARNINGS #003-01`：并行跑重测试会造假红）。取退出码**不许进管道**。

---

## 禁止重新规划

`plan.md` 已定稿、`tasks.md` 已锁定、**本 feature 已收尾**。交接给下游的三笔都已写进**接收方**
的 `tasks.md`（不是只写在这里）。若要重开本 feature，先与用户确认；否则直接进入依赖 004 的下一个
feature。
