现在开始实现 specs/003-multi-tenant-isolation/（内层仓库 openhive 内的 `docs/superpowers/specs/003-multi-tenant-isolation/`）。

> 以下路径均相对于**当前会话的工作目录**（= worktree 根 `openhive\.claude\worktrees\feat-003-multi-tenant-isolation\`）。
> 绝对路径锚点：仓库根 `D:\project\study\openhive\openhive\`；外层工作区 `D:\project\study\openhive\`。

**本 feature 一句话**：把 opencode 的**进程级单例 SQLite** 改造成「每用户独立 db + 每用户沙箱目录」的物理隔离。

⚠️ **这是全项目唯一「深改 opencode core」的地方**——宪法 §I（最小化上游合并冲突）在本 feature 最紧张。
本文件末尾的「上游侵入面」是 003 的专属红线，比 002 那条严重得多。

**任务总量 24 条**：

| 组 | 编号 | 来源 | 对网关的依赖 |
|---|---|---|---|
| 原计划 | T001–T013 | 003 自身 tasks.md | 部分（T012/T013 走本地链路） |
| 网关联 | T014–T018 | 002 移交 | **T014 是硬前置**；T015–T018 依赖 T014 |
| 评审移交 | T019–T024 | 002 收尾评审 | **不依赖网关，现在就能做** |

---

## Step 0 · 开 worktree 之前 / 刚开后（**逐项验证，不要"顺手修"**）

以下四项**都已经配好了**——所以本步是**体检**，不是修复。跑出不符就停下告诉我。

**0.1 基点设置（易误判，先看这条）**

`worktree.baseRef` **已配置为 `head`**（2026-09-28 22:52）。

⚠️ 它是 **Claude Code 的设置项**（`C:\Users\Administrator\.claude\settings.json`），**不是 git config**——
用 `git config worktree.baseRef` 查会**显示为空**，别据此判断「没配置」而去做多余操作。（002 提示词此条已过期，见其文件内更正标注。）

**0.2 验证基点正确**

```bash
git merge-base --is-ancestor multi-tenant HEAD    # 退出码 0 = 基点正确
```

不通过就**停下来告诉我**，不要自行 reset（001 曾被迫 `git reset --hard`）。

**0.3 验证 002 已合入（003 的地基）**

```bash
git merge-base --is-ancestor a7ea37ab90 HEAD      # 002 的合入点
git log --oneline -3                               # 应能看到 002 的收尾提交
```

**0.4 符号链接体检**

仓库含 **60 个 symlink 资产**（favicon / logo / 图标）。本机已修复（2026-09-29 21:39），`core.symlinks` 已是 `true`。

```bash
git status --porcelain                # 应为 0 行，干净
# 若出现大量 " T"（typechange）→ 说明又被降级成路径文本文件了
```

**修法（仅在真的出现 `T` 时）**：

```bash
git status --porcelain | awk '{print substr($0,1,2)}' | sort -u   # 确认只有 " T"
git status --porcelain | grep '^ T' | cut -c4- | xargs rm
git checkout -- .
```

> ⚠️ 上面是 **bash** 语法。若在 PowerShell 里跑，`awk`/`cut`/`xargs` 都不存在，改用：
> `git status --porcelain | Where-Object { $_ -match '^ T' } | ForEach-Object { Remove-Item $_.Substring(3) -Force }`

---

## Step 0.5 · 开工前的决策点（**D1–D6 全部已裁定** · 2026-09-30）

**这些是「停下来问我」的清单，不是让你自己拍板的清单。**

**状态**：D1 / D2 / D5 / D6 **已定案**；**D3 / D4 被有意推迟**到各自触发时点
（D3 → T015 开工前，D4 → T010/T011 开工前）——推迟是裁定本身，不是遗漏：
现在拍会拍在没有依据的地方。**到点时必须停下来问，别自行拍板。**

> ⚠️ **另有一条 2026-09-30 从 T005 收尾里长出来的新决策点**（不在原 D1–D6 里）：
> **db 路由要接进哪一层**才能让真实请求路径生效——见 `specs/003/state.md`「T005 结论 · 本轮未覆盖」。
> 它同样遵守「停下来问」的规矩。

### ✅ D1（**已裁定 2026-09-29 · 走【甲】真做验签**）：`X-User-ID` 到底可不可信？

**裁定**：**甲**。内核以**验签结果**为身份来源，**不以明文头为凭据**。

**三层保证，缺一不可**：

① 网关**剥离客户端传入的 `X-User-ID`** 后按会话凭证**强制覆盖**注入（是覆盖，不是拼接）；
② 内核端口**只对网关可达**（回环绑定 / 网络策略）；
③ 内核**验签后才认**——网关透传会话 JWT，内核调 `verifyToken(token, jwtSecret(env))`
   取 subject 为 userId，失败即拒（fail-closed）。

**为什么是甲**：原【乙】案（认链路不可达）给的省钱理由是「验签要两段共享密钥的分发与轮转」——
**这条不成立**。002 已经把整套 JWT 基建交齐：
`packages/auth/src/token.ts` 的 `signToken` / `verifyToken` / `jwtSecret` / `sessionCookie`，
而 `verifyToken` 返回的 `TokenSubject.id` **就是** 003 需要的 userId。
**甲零新增密钥、零新增轮转**——只是把登录时已签发的令牌在内核侧再验一次。
后果也不对称：乙失败 = 案件数据任意跨用户暴露；甲失败 = 攻击者仍拿不到密钥。

**甲不是回滚乙，是叠加**——上面 ① ② 两条在甲里**全部保留**。

**分工**：`T014` 管「注入 + 透传 JWT」，`T003` 管「验签后才认」。T003 用**自造令牌**即可独立测，不必等网关。

⚠️ **明文头 `X-User-ID` 保留但降级为路由提示**（兼「注入链路是否健在」的探针），
MUST NOT 当身份来源；与验签结果不一致时**以验签为准并拒绝**。

> 同步改动共 **5 处**（少一处就自相矛盾）：`spec.md`（FR-002 / 验收场景 3 / SC-003 / Assumptions）、
> `plan.md`（数据流向图 + 数据隔离说明 + 集成点）、`tasks.md`（T003 出参 + T014 裁定段）、
> `packages/opencode/src/server/user-identity.ts` 顶部注释、`003/state.md`。

**背景（保留）**：冲突源于 003 `spec.md` 原 FR-002 要求「由网关**验签**注入」，而 002 落地的
`X-User-ID` 是**明文头、不是凭证**（`packages/opencode/src/server/user-identity.ts` 顶部有言）。
裁【甲】后，原 FR-002 的措辞**重新成立**。

> 002 只交了**门**（读头 → 无头 401，由 `OPENHIVE_REQUIRE_USER_ID` 控制，**默认关**）与 **JWT 机制**；
> 注入器（网关）**尚不存在**。

### ✅ D2（**已裁定 2026-09-30 · 走【内嵌】**）：网关的形态

**裁定**：**模块内嵌**——让网关的 HTTP 面挂在**同一个服务端进程**内。

**为什么**：① 本项目第一号约束是最小化与上游的改动面，独立进程要多出一套部署 / 鉴权 / 日志边界；
② 本机**没有 Docker、没有 PG 二进制**（`LEARNINGS #002-05`），独立网关会立刻撞上「本机跑不起来」；
③ **模块边界本来就不损失**——002 的 `packages/auth` 已经是一个独立 package，
「内嵌」只是它的 HTTP 面挂在同进程，导出面不变。真到要拆的时候接口面已经在。

⚠️ 影响 **T014 落点**：网关的 HTTP 面落在 `packages/opencode` 的服务端进程内。

### ⏸ D3（**已裁定 2026-09-30 · 推迟到 T015 开工时再定**）：T015 登录页挂在哪

**裁定**：**现在不定。** 它是纯前端落点，与后端任何决策都不耦合；现在拍，风险是拍完被前面的实现推翻。

⚠️ **但有一条必做项已经确定**（这是验收项，不是决策项）：接线缝
`packages/app/src/workspace/current-user.ts` 的 `setCurrentUser` **至今零生产调用者**（002 实测）
——**T015 必须接上它**，否则登录成功也进不去。

> ✅ **不再需要问的**：登录页深色**已裁定**——`002-auth-account/plan.md` 明写「**不启用暗色**（登录页深色是门面，非 dark 模式）」。
> 即「页面级固定深色」，**不新增 dark 语义 token**。002 提示词里那条「落地前先跟我确认」已作废。

### ⏸ D4（**已裁定 2026-09-30 · 推迟到 T010/T011 开工时再定**）：配额阈值（plan.md 风险点 R4）

**裁定**：**数字与维度现在都不定。** 理由：**T010/T011 的实现形状会决定阈值该按什么维度计**
（并发 session？还是 agent 并发？）——现在定维度可能是错的，定了反而会被当成结论传下去。

**到点时已经确定的形状约束**（这些现在就成立，不必等）：

- 阈值走**配置（env）**，照 `OPENHIVE_DATA_ROOT` 先例（`packages/core/src/database/router.ts` 的
  `dataRoot(env)`）——**读 env 记录，不直接读 `process.env`**，让调用方与测试能注入。
- **不得硬编码进源码**（宪法 Anti-Patterns；也是第一号约束）。
- 默认值给**宽松**的，且文档里必须标明「**未经压测，非结论**」。

### ✅ D5（**已裁定 2026-09-30 · 保留文档正文的示例值**）：T020 的文档裁定

**裁定**：**保留 `admin@123456` 作为文档正文的示例值**，另在**配置项注释**里说清二者关系。

**为什么**：改文档正文会让「**首次怎么登录**」这条引导链断掉——而**管理员引导（T019）依赖它**。

⚠️ 但注释里必须写死一句：**生产部署必须改；公开的示例值等于没有口令**。

### ✅ D6（**已裁定 2026-09-30 · 沿用 002 的形式**）：tag 命名

**裁定**：**`v0.1.0-003-multi-tenant-isolation`**（沿用 002 带编号的形式）。

001 打的 `v0.1.0-platform-foundation` 不带编号，是它自己没跟上——**不让这个不一致继续扩散**。

---

## Step 1 · Worktree 隔离

```bash
claude --worktree feat-003-multi-tenant-isolation    # 基准 = 当前开发主线 multi-tenant
```

（自动按 `.worktreeinclude` 复制 `.env` / `.env.local` / `.env.development` / `.credentials.yaml`）

---

## Step 2 · 启动必读（每个 task 开始前）

① 先读 `D:\project\study\openhive\.specify\memory\constitution.md`，遵守其全部原则——**冲突以宪法为准**。

> ⚠️ 必须用**绝对路径**：宪法在外层工作区、不在本仓库。worktree 里写 `../.specify/memory/constitution.md`
> 会解析到 `.claude/worktrees/.specify/…`，**读不到**。

② 读 `docs/superpowers/specs/openhive-DESIGN.md`（视觉真理源）+ 本 feature 的 `plan.md` + `tasks.md`。

③ 取最小依赖且未完成的 task，用 Superpowers 的 `test-driven-development` skill（RED→GREEN→REFACTOR）。

④ 每个 task 跑完：更新 `tasks.md` 该 task 的 checkbox → 更新 `state.md` → commit → **STOP**，等我说「next」。

⑤ 全部 task 完成后 **STOP**，等审整个 feature。

⑥ **遇到「未定」的决策点先停下来问我**（清单见 Step 0.5），不要自行拍板。

---

## Step 3 · 任务标签执行规则

### [BE] —— 本 feature 的主战场

**🔑 落点实测（开工前先看这段，能省掉半小时找文件）**

T001 写的「定位 `database.ts` 现状」——**真身不在 `packages/opencode/src/`**：

```
packages/core/src/database/database.ts      ← Database 单例真身
packages/core/src/database/path.ts          ← ⚠️ 陷阱：这不是那个 path()
```

- **`Database` 单例** = `packages/core/src/database/database.ts`：
  `export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })`
  —— 全局节点，**导入时就把 db 路径算死了**。
- **`path()` 函数也在同一个文件里**（不是 `path.ts`）。它的逻辑是：`Flag.OPENCODE_DB` 优先，
  否则落到 `Global.Path.data/opencode.db`（或按 channel 命名的变体）。
  **「一个进程一个 db 文件」的根源就在这个函数。**
- ⚠️ 旁边的 `packages/core/src/database/path.ts` 是 **drizzle 的列类型定义**（`absoluteColumn` /
  `directoryColumn` / `pathColumn`），**与 db 路由无关**。别照着文件名找错地方。

**🔴 宪法 §I 红线（本 feature 的最高风险，plan.md 风险点 R1）**

`packages/core` 是**纯上游区**：`database.ts` 最后一次改动是上游 PR
（`refactor(core): remove infrastructure layer exports (#34624)`），**我们从未碰过它**。

> 动它 = 动上游高频文件 = 每次同步官方都可能冲突。这正是宪法 §I 要防的事。

**应对（R1 已定）**：用「**加**」的方式新增 `router.ts`，**不重写 `database.ts`**；
改造点**单独提交**并在 message 里标注「这是要保留的定制」（宪法 §二 / §五）。

**其余 BE 红线**：

- **零表结构改动**——`session` 表**不加 `user_id` 列**，**不碰 `sql.ts`**。T009 的验收就是确认这一点。
- 改造收敛到两处（宪法 §三 物理隔离的正面落地）：
  ① 用户中间件（002 已交「读头 → 无头即 401」的门，003 消费该身份）
  ② Database 按用户路由（003 落地）
- **物理隔离优先，不靠应用层 `if` 过滤**（宪法 §三）。
- 新增模块落点（plan.md 已定）：`packages/opencode/src/{user,database,middleware,quota}/`。

**002 留下的可复用资产（别重复造）**：

| 资产 | 位置 | 用法 |
|---|---|---|
| 环境变量常量先例 | `packages/auth/src/policy.ts`（`JWT_SECRET_ENV`） | 照它加新常量 |
| JWT 密钥地板检查 | `packages/auth/src/token.ts`（`jwtSecret` / `WeakJwtSecretError`） | T014 需在**启动路径**调用一次 |
| 领域错误脱敏 | `packages/auth/src/pg-errors.ts` | **网关只需别绕过它**——原样重抛/序列化/写日志都会让保护作废 |

### [FE] —— 只有 T015 一条

**写测试/组件前必须先读**：

- `docs/superpowers/specs/openhive-DESIGN.md`（hex / token / 圆角 / 间距的**唯一事实源**）
- `docs/superpowers/specs/design-reference/figma-export/`（logo + tokens.css，`logo-dark.svg` 用于登录页深色底）

实现 = **opencode 原生 SolidJS 换皮**，绝不写 React、绝不把 front 的 React 代码搬成组件
（front 仅作视觉参考，对齐对象是 `openhive-DESIGN.md`，不是 front 源码）。

**换皮落点 = 三段真相链**（漏一处**静默失效**，构建/typecheck/既有测试全绿）：

1. `packages/ui/src/v2/styles/theme.css` 的 `:root`
2. 同文件的 `[data-color-scheme="light"]` —— 与上一条**逐字镜像**
3. **重跑生成器**产出 `packages/ui/src/theme/themes/oc-2.json`

> ⚠️ **不是** `packages/ui/src/styles/theme.css`——那是 **v1 legacy**，不是换皮靶子。
> ⚠️ **绝不手改生成物 `oc-2.json`**（同「绝不手改 `colors.css`」的道理）。
> ⚠️ 为什么漏第三处会失效：`ThemeProvider` 把 `oc-2.json` 的 `v2Overrides` 写进一个
> **不带 `@layer`** 的 `<style id="oc-theme">`，无层级样式压过 `theme.css` 所在的 `@layer theme`
> ——**与顺序无关**。

**已裁定**：登录页是**页面级固定深色**（门面），**不启用暗色、不新增 dark 语义 token**（见 Step 0.5 D3）。
所以本 feature **不涉及 dark 块**。

**token 现状（002 已核）**：CTA 暖黑 `#1C1A18` = `--v2-text-text-base` ✅ 已有；
品牌金 `#D97706` = `--v2-brand-gold` ✅ 已有；
**登录页背景 `#0F172A` 目前无任何 token，属「需新增」那一类**——但按 D3 的裁定，它是**页面级固定值**，
不需要走三段真相链。落地前若拿不准，再问我一次。

### [INT] —— T012 / T013 / T016 是本 feature 的**真正验收**

- 必须在对应 `[FE]` 与 `[BE]` 都通过后启动，**跑真实端到端，不 mock**。
- 只有 E2E 类 `[INT]` 在最后跑真实链路；仅 config/migration/契约类按 tasks.md 依赖图正常排序。
- 跨 feature patch 类 `[INT]`，改完必须**重跑被改 feature 的现有单测**，绿了才算过。

> ⚠️ **与 002 的关键差别**：002 **豁免**了隔离测试（那是 F3 的事）。
> **003 必须过**——隔离测试就是本 feature 的核心验收，见 Step 4。

---

## Step 4 · 质量门禁（宪法第五章，审查前先过）

- **隔离测试（本 feature 特设，失败即阻断）**：用户 A 访问用户 B 的目录 / db **必须被拒**
  （宪法 §五明写「失败即阻断合并」）。对应 T012（跨 db）与 T013（跨目录，含**伪造 directory** 场景）。
  双向都要验：**A 读不了 B，A 也能读自己**（过紧也是缺陷，见 plan.md R3）。
- 在受影响 package 内跑 `bun test`（**禁止根目录 `bun test`**，根脚本强制 `exit 1`）。
  ⚠️ 本 feature 含 `[FE·新增]`（T015）→ 必产 `.test.tsx`，而 `.test.tsx` **进不了 `test:unit`**
  （`packages/app` 的 `test:unit` 带 `--path-ignore-patterns="**/*.test.tsx"`）
  → 前端测试须跑 **`bun run test:components`**（在 `packages/app` 内）。
- `bun run lint:openhive` 退出码 **0**（001 新增的视觉契约门，扫
  `packages/app/src/{rail,center,topbar,workspace}`）。
  ⚠️ 若 T015 的落点在这四个目录**之外**，这道门**扫不到** → 落地时**告诉我，我扩范围**（别当成"过了"）。
- `bun run lint` **只判「本次新增/改动文件 0 命中」**：全局有 **1 个已登记的「上游」error**
  （`packages/session-ui` 的 prompt-input 组件，裁定为不私改、登记待上报）→ 全局退出码**恒为 1**。
  **不要为它改上游代码，也不要拿它当阻断**。
- `bun run typecheck`（turbo typecheck）退出码 **0**。

---

## Step 5 · 代码审查（用 Superpowers 的 `requesting-code-review` skill）

质量门禁过 + 全部 task 绿后触发审查，至少覆盖以下 6 类：

① **韧性缺陷**：缺重试 / 缺超时 / 缺熔断器
　（本 feature 高发：连接惰性打开 / 复用 / 回收——plan.md 风险点 R2 **连接泄漏**）
② **横切一致性缺陷**：鉴权 / 限流 / 日志是否覆盖**所有**接口
　（"4 个接口里 3 个有检查，第 4 个漏了"是经典翻车场景）
③ **防御性编码缺陷**：未处理的 null / 缺输入校验 / 缺幂等键
④ **数据库迁移缺陷**（如涉及）：回滚脚本 + 分批操作
⑤ **前端一致性缺陷**（T015）：硬编码本应走 token 的 hex / 把 front 的 React 搬进 SolidJS /
　 手改 `colors.css` / 未对齐 `openhive-DESIGN.md`
⑥ **🔴 上游侵入面（本 feature 特有，比 002 严重）**：

> 002 的侵入面是「关 Basic Auth」一个开关；**003 是改造 `Database` 单例**——这是全项目**唯一深改 core** 处。
> 审查必须确认：
> - 是否**真的**用「加」而不是「改」——`packages/core/src/database/database.ts` 应**零改动**或最小改动
> - 连接路由是否落在**新增的** `router.ts` 里，而不是塞进 `database.ts`
> - 改造是否**单独提交**、message 是否标注「这是要保留的定制」
> - 是否碰到了 `sql.ts` 或其他上游高频文件（宪法 §一 明令）
> - **零表结构改动**是否成立（`session` 表无 `user_id` 列）

审查报告用 `receiving-code-review` skill 消化，格式：
`| 编号 | 类别 | 文件:行 | 描述 | 修复优先级 |`

**0 个缺陷** → 进 Step 6；**有缺陷** → 回到对应 task 走 TDD 修复，重新审查，直到 0 缺陷。

---

## Step 6 · 收尾

1. 最终 commit，message 含 `Closes 003-multi-tenant-isolation`。
2. **merge 回开发主线**：⚠️ **这一步做不了，交给我**——`multi-tenant` 已在主检出被 checkout
   （一个分支不能 checkout 两次），且隔离会话对共享检出的 git 操作会被拦。
   你只做 final commit，然后把 `git merge --ff-only <你的分支>` 给我，**我在主检出执行**。
3. `git tag v0.1.0-003-multi-tenant-isolation`（命名依据见 Step 0.5 D6）。
   ⚠️ 打在**最终状态**上——001 那个 tag 打在收尾提交上、漏掉了后来的补测提交，别重蹈。
4. 更新 `docs/superpowers/specs/003-multi-tenant-isolation/session.md` 标记完成。
5. `specs/003-multi-tenant-isolation/` **永不删除**（下一个 feature 的上下文）。
6. 报告：共 N 个 task / M 个 `[FE]` / K 个 `[BE]` / 审查发现 X 个缺陷已全部修复。
7. **把 `LEARNINGS.md` 补上**（1–5 条，加在最顶部）。本 feature 已有素材可预期：上游侵入的实际手感、
   `Database` 单例改造的坑、隔离测试怎么写。

---

## 节奏铁律

- **逐 task 停**：每个 task commit 后 STOP 等「next」确认（服从宪法第九章）。
- **一个 feature 跑完停下来等审**，再下一个。
- **严禁多 agent 并发跑多个 feature。**
- 本 feature **额外一条**：**Step 0.5 的 D1–D6 已全部裁定**（2026-09-30）。
  其中 **D3 推迟到 T015 开工前、D4 推迟到 T010/T011 开工前**——**推迟是裁定本身**
  （现在拍会拍在没有依据的地方），**到点必须停下来问**。
  另有一条从 T005 收尾长出来的新决策点（db 路由接进哪一层），同样「命中就停下来问」。
  T001 / T002（调研类）和 T019–T024（评审移交，不依赖网关）**可以先动**。
