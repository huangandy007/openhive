现在开始实现 `docs/superpowers/specs/005-project-management/`（内层仓库 openhive 内）。

> 以下路径均相对于**当前会话的工作目录**（= worktree 根 `openhive\.claude\worktrees\feat-005-project-management\`）。
> 绝对路径锚点：仓库根 `D:\project\study\openhive\openhive\`；外层工作区 `D:\project\study\openhive\`。

**本 feature 一句话**：落地**工作空间轴**的项目管理——左栏项目锚点 + 项目面板、文件树完整操作、共享项目成员（微信群模型）、文件 ↔ MinIO 备份拖拽、项目归档/找回。项目 = 沙箱内的隔离边界 + git 仓库。

**任务总量 16 条**（T001–T016）：

| 组 | 编号 | 内容 | 标签 |
|---|---|---|---|
| Phase 1 | T001–T002 | 定位原生 project 表 / 文件树真实入口；定 MinIO 目录与权限方案 | **1 INT + 1 BE** |
| Phase 2 | T003–T004 | `project` 表加列 / `project_member` + 微信群模型判定 | 2 BE（**T004 接收 004 的 T011 之半**）|
| Phase 3 | T005–T006 | 项目锚点行 / 项目面板（＋新建 + 三 tab） | 2 FE·新增 |
| Phase 4 | T007–T009 | 文件树工具栏 / 右键菜单 / 删除二次确认 + 图标态 | 3 **FE·换皮** |
| Phase 5 | T010 | 成员面板（👥 侧滑：邀请 / 移除 / 退群） | 1 FE·新增 |
| Phase 6 | T011–T012 | MinIO 客户端（文件级备份/拉回） / 沙箱 ↔ MinIO 上下双树拖拽 | 1 BE + 1 FE·新增 |
| Phase 7 | T013–T016 | 归档 / 找回 / 归档后失权 / 会话私有 + git 留痕 | 4 BE |

标签分布：**`[FE]` 7 条（换皮 3 + 新增 4）、`[BE]` 8 条、`[INT]` 1 条**。

⚠️ **与 004 的关键差别，先记住三句**：

1. **004 一条 `[FE]` 都没有，005 的 `[FE]` 是主战场（7 条）** ⇒ 前端测试门第一次真正启用，
   且 004 那份提示词里「本 feature 无 `[FE]` ⇒ 不涉及 `test:components`」那句**在这里作废**（见 Step 4）。
2. **`[FE·换皮]` 三条的「换皮」是字面意义的换皮吗？——不是，见 D0-2。** 原生文件树今天
   **不在 openhive 的左栏里**，而且**没有工具栏/右键菜单要「换」**（那六项能力今天不存在）。
3. **004 的红线是 `packages/core/src/tool/`（守卫不许重写）；005 的红线换成了 `packages/core/src/project/sql.ts`
   ——上游表结构 + 宪法 §一 明令的 `sql.ts` 系文件**（见 D0-3）。

---

## Step 0 · 开 worktree 之前 / 刚开后（**逐项验证，不要"顺手修"**）

前两项是**体检**，不是修复。跑出不符就停下告诉我。

**0.1 基点设置（易误判，先看这条）**

`worktree.baseRef` **已配置为 `head`**。

⚠️ 它是 **Claude Code 的设置项**（`C:\Users\Administrator\.claude\settings.json`），**不是 git config**——
用 `git config worktree.baseRef` 查会**显示为空**，别据此判断「没配置」而去做多余操作。

**0.2 验证基点正确**

```bash
git merge-base --is-ancestor multi-tenant HEAD    # 退出码 0 = 基点正确
```

不通过就**停下来告诉我**，不要自行 reset（001 曾被迫 `git reset --hard`）。

**0.3 验证 004 已合入（005 的地基）**

005 的 `tasks.md` 的 Prerequisites 写的是「**F1 三栏 + F3 沙箱已落地**」，另有 004 的**半条移交**
（T011 的工作空间轴一半 → 005 的 T004）。**F4 = 004。** 而 004 的合并**由我在主检出执行**——
所以开 worktree 之前，先在主检出确认这一项：

```bash
git merge-base --is-ancestor worktree-feat-004-access-control multi-tenant \
  && echo "✅ 004 已合入" || echo "❌ 004 未合入，停"
```

⚠️ **不要写死 SHA**（`LEARNINGS #002-06`：会随提交而变的值写取数命令，别写死）。
分支名与 tag 名都是**可变的引用**，判据用分支名即可。

**0.4 符号链接体检**

仓库含 **60 个 symlink 资产**（favicon / logo / 图标）。本机已修复，`core.symlinks` 已是 `true`。

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

---

## Step 0.5 · 开工前必须先实测的六件事（**"命中就停下来问"**）

⚠️ 005 与 004 一样**没有预置决策点清单**（`plan.md` / `tasks.md` 里没有 D1–D6）。
下面六条**不是从它自己的文档里抄的**，是两份开工前实测（后端侧 / 前端侧）**逐条打出来的**
「plan 假设 ⇄ 仓库现状」的差集。**每条都带落点与判据**，且每条都可能是「停下来问」的触发点。

> 📌 **可复用的做法**（003 / 004 各验证过）：
> **开工必读之后、动第一行代码之前，先问「这条 task 的出参，今天在仓库里打得到吗？」**
> 打不到就别做——**先裁定归属**。004 靠这一问省掉了 T010/T011 两条假测试（整条移交 F7）。

### 🔴 D0-1（头号风险）：**沙箱里没有「project」这一层**

`plan.md` 的数据流向与集成点反复写 `/workspaces/{userId}/{project}/`（plan.md 的 mermaid 图与
「复用 F3 沙箱」一行），并称「项目是沙箱内的唯一隔离边界」。

**实测**：锚定中间件**永远**把请求的落点写成 `{root}/{userId}`，**没有 project 段**——

- `packages/auth/src/workspace.ts:workspaceRoot` / `createWorkspace`（`mkdir(join(root, userId), { mode: 0o700 })`）
- `packages/opencode/src/server/routes/instance/httpapi/middleware/anchor-workspace.ts:anchorWorkspaceLayer`
  （`const sandbox = join(config.root, user.value.id)`，把 URL / 头 / 请求体里的 directory **全部改写**成它）

⇒ plan 里那个 `{project}` 段**是新增，不是现状**。今天「项目」只活在**元数据层**
（`project` 表的 `worktree` 列、`project_directory` 表），而**HTTP 请求的落点被钉死在沙箱根**。

**为什么是「停下问」**：改锚定 = 动 003 的隔离机制本体（`anchor-workspace.ts` 是 003 新增、不是上游，
但它是**已上线的隔离点**）；不改锚定 = 「项目是唯一隔离边界」这句话在 HTTP 层**不成立**。
两条路的影响面完全不同，**由你裁定，不要自行选一条**。

**判据一句话**：`anchor-workspace.ts` 里那个 `join(config.root, user.value.id)` 是否要变成
三段（`{root}/{userId}/{project}`）、以及**「当前项目」这个身份从哪来**（URL 参数？会话字段？头部？）。
⚠️ 若裁定「要改」，**先读 003 的 `state.md` 缺口表**——那里记着锚定改写的等价写法绕过问题
（尾斜杠 / 重复斜杠 / 大小写），改锚定会**再碰一次那条边界**。

### 🔴 D0-2：**「换皮」的三条其实是「先接线 + 补六项能力」**

T007–T009 都标 `[FE·换皮]`，plan.md 的换皮表写「原生文件树（SolidJS）｜复用 + 换皮（token）+ 补工具栏 / 右键菜单」。
**实测两处与这句话不符**：

**(a) openhive 的左栏是个空槽。** `ThreePane` **声明了 `left` 槽**，但入口组件没传：

```tsx
// packages/app/src/workspace/three-pane.tsx     ← props.left 存在
// packages/app/src/workspace/workspace-entry.tsx:69
<ThreePane>
  <TabBar …/>
  <CenterContent …>{props.children}</CenterContent>
</ThreePane>
```

`<ThreePane left=…>` 全仓**只出现在 `workspace/three-pane.test.tsx`（测试里）**。
⇒ 「左栏 280px 项目侧栏」（`openhive-DESIGN.md` §4.1 的「图标栏 56px → 左项目侧栏 280px → 中 → 右」）
今天**没接线**，T005–T010 的第一件事是**接线**，不是换色。

⚠️ **接线前先读那条注释，别按它推断归谁**：`workspace-entry.tsx:60-62` 里写着
「不能塞进 `ThreePane` 的 `left` 槽（那是左项目侧栏，**归 T010**）」——这句话**逐字来自
`001-platform-foundation/tasks.md:114`**，那个 `T010` 是 **001 的 T010**，
**与 005 的 T010（成员面板）不是同一个任务**。照它接线会把两件事串错。

**(b) 原生文件树的操控能力今天不存在，而且它不在左栏里。** 组件是
`packages/app/src/components/file-tree.tsx:FileTree`（另有 v2 版 `file-tree-v2.tsx`），
但它的使用点是**上游**的会话侧栏 `packages/app/src/pages/session/session-side-panel.tsx`。
实测它**支持**：展开/折叠、单击/双击、`draggable` 拖出；
**不支持**（grep `contextmenu|rename|新建|upload|download|右键` 零命中）：
**右键菜单、新建、重命名、删除、上传、下载**——正是 T007/T008/T009 的全部内容。

⇒ **`[FE·换皮]` 的实际工作量 ≈ 新增**，且「复用」的对象是**上游文件**
（`components/file-tree.tsx` 不在 003/001 的自有目录清单里）。

**为什么是「停下问」**：这决定了 T007–T009 的**落点形态**，两种走法冲突面差一个量级——
(a) **改上游组件本体**（加 props/回调）⇒ 上游侵入面，须单独提交 + 标【这是要保留的定制】；
(b) **在 openhive 自有目录里包一层**（复用 token 与交互，树本体不动）⇒ 零侵入，但可能与上游
`file-tree.tsx` 的能力重复（`LEARNINGS #002-06`：「同一个判断在两处各写一份」的同型风险）。

**建议**（供你裁，不必接受）：**默认走 (b)**，只有确实必须动上游内部时才走 (a) 并单独提交。

### 🔴 D0-3：**`project` 表在每用户 SQLite 里，加列 = 动上游表结构 + 宪法 §一 红线**

T003 的措辞是「`project` 表加字段（type / project_type / shared_directory / last_accessed_at /
archived / archived_at）」，plan.md 的 R1 把风险写成「只加列不改列，冲突面小」。

**实测**：表**确实存在**，但它在**每用户 SQLite**、且定义在**上游文件**里：

| 要找的东西 | 真身 |
|---|---|
| 表定义 | `packages/core/src/project/sql.ts:ProjectTable`（`sqliteTable("project", …)`）|
| DDL 来源 | `packages/core/src/database/migration/20260127222353_familiar_lady_ursula.ts` |
| 迁移汇总 | `packages/core/src/database/migration.gen.ts` |
| 建表者 | `packages/core/src/database/database.ts` 的 `DatabaseMigration.apply(db)`，**每次开库都跑** |
| 落在哪个库 | **每用户库**：`packages/core/src/database/router.ts:userDatabasePath` = `{dataRoot}/{userId}/opencode.db`（`OPENHIVE_DATA_ROOT`，默认 `/data`）|
| 读写者 | `packages/opencode/src/project/project.ts:Project.Service`、`packages/core/src/project.ts:ProjectV2.Service` |

实测现有列里**没有** plan 想加的那六个（`type` / `project_type` / `shared_directory` /
`last_accessed_at` / `archived` / `archived_at`）——「加字段」确需新增列。

**为什么是「停下问」**：三条独立风险叠在一起——
① **宪法 §一 明令**：「MUST NOT 动 `sql.ts`」（`project/sql.ts` 正是这个形状的文件，
且 `ProjectTable` 被上游 `Project.Service` 生产读写 ⇒ 改它是最典型的上游高频文件）；
② **每用户库**意味着新列要在**全局库 + 所有已存在的每用户库**上生效（迁移面比「一处 DDL」大）；
③ 新列若**带默认值 + NOT NULL**，在 SQLite 上有额外的表重建语义。

**两条候选路**（由你裁）：
- **(a) 照 plan 加列**——改上游 `project/sql.ts` + 新增一个上游迁移文件，单独提交标定制；
- **(b) 另起一张 openhive 自己的表**（如 `project_ext`，`project_id` 外键 + 六个列，
  新文件、零上游改动）——**代价**是 join 与「项目列表」查询要多一次关联。

**建议**（供你裁）：先按 (b) 想清楚要付什么代价再比；**不要因为「plan 写的是加列」就直接改上游表**。

### 🔴 D0-4：**MinIO 从零 + `project_member` 生产 schema 里不存在**——T002 要产的是「部署方案」而不是代码

**实测**：

- `packages/*/package.json` 里**没有任何对象存储 SDK**（无 minio / 无 `@aws-sdk/client-s3`）。
  唯一的 aws 依赖是 `@aws-sdk/credential-providers`，用途是 **Bedrock 认证**（`provider/provider.ts`
  的 `fromNodeProviderChain`），与对象存储无关。
- `minio` 这个词在全仓只出现在 `packages/opencode/src/permission/arity.ts` 的两行**注释**里
  （`mc ls myminio` / `mc admin info myminio`，即 `mc` 命令的 arity 表）。
  （`grep -rni minio` 另在 `packages/llm/src/protocols/gemini.ts` 命中一处，是 `geminiOptions`
  的子串假阳性——**别把它读成「已经有 MinIO 集成了」**。）
- plan 的前后端落点 `packages/opencode/src/minio/backup.ts` 与 `/minio/{userId}/{projectId}/`
  **全部是从零新增**。
- **`project_member` 今天不是「零命中」**——它在 `packages/auth/src/rls.test.ts` 里出现过，
  但那是 **004 的 RLS 见证测试的示意夹具**（测试内 `CREATE TABLE project_member(user_id, project_id)`，
  建在 PGlite 内存库里，**不是生产 schema**）。**生产 schema 里它不存在**；
  `fund_project_member` / `call_project_member` 同样只在文档里（那两张在 F6/F7）。
  ⇒ T004 建这张表时，**先读 `packages/auth/src/rls.test.ts` 的夹具与 `packages/auth/src/rls.ts` 的
  四条不变式**——名字一样，**形状以谁为准要先说清**（`LEARNINGS #002-06`：同一个东西两处各写一份）。

⇒ T002 的出参「MinIO 目录/权限方案」是**一份部署约定**，本机**没有 MinIO 可连**、也没有 SDK 可装
（装依赖要走 `bun install`，注意 `bun.lock` 污染纪律）。

**为什么是「停下问」**：这是**本 feature 唯一一处「加新外部依赖」**——
① 引入哪个 SDK（minio 官方包 vs `@aws-sdk/client-s3`）＝**新的上游依赖面**，宪法 §I 要求最小化；
② 桶的目录结构与账号权限要落进 `docs/workspace/deploy-todo.md`（部署侧事项的既定归口，**别只在
005 的文档里写**——`LEARNINGS #002-04`：责任被推出边界时必须落进接收方的表）；
③ 本机**测不了**真实上传/下载 ⇒ T011/T012/T013/T014 的「出参验证方式」要提前定成
**可 mock 的边界**（把 MinIO 客户端收成一个窄接口，测试注入替身）——**否则会写出「测替身」的假测试**
（`LEARNINGS #002-02`：没有真正执行被测路径的不是测试，是缺口）。

### 🟡 D0-5：**FR-012「文件并发靠 git」今天没有承载物**

spec 的 FR-012 / Assumptions 写「文件并发靠 git：各自 commit、冲突 merge，不做实时协同编辑」，
T016 的出参里含「git 留痕」。

**实测**：

- git 的**能力**在：`packages/core/src/git.ts:Git.Service`（`repo.create` 真的跑 `repositoryOperation("create", repository, ["init"])`，
  另有 clone / worktree / tree / patch）、`packages/opencode/src/project/project.ts:Project.Service.initGit`、
  `packages/opencode/src/project/vcs.ts:Vcs.Service`。
- **不存在**：任何「多写者用分支/合并做文件并发」的机制；没有 `simple-git` / `isomorphic-git` 依赖。
  git 今天只用于 snapshot / 历史 / `projectV2.commit`（留痕），**不是并发机制**。
- 另有一条 003 已登记的已知问题：`initGit` **只 `git init`、不提交**，首次提交前同沙箱内多个目录
  的 id 都是 `global`（`docs/superpowers/specs/003-multi-tenant-isolation/state.md` 的缺口表 T008）。

**为什么是「停下问」**：T016「验证文件并发靠 git」的出参**今天既打不到**（没有第二个写者、
没有 merge 触发点），也会与**既有的「首次提交前都是 `global`」**那条缺口纠缠。
按 003/004 的做法：**先探，打不到就停下来问**——是「只验 `git init` + 留痕那半、并发那半登记挂账」，
还是「整条 FR-012 挂 `deploy-todo.md`」。**不要造一个假 merge 把测试写绿。**

### 🟡 D0-6：**plan 说「鉴权走 F4 执行层」——但今天在生产里跑的是哪条线？**

plan.md 的集成点写「**复用 F4 权限**：`project_member` 是工作空间轴权限，鉴权走 F4 执行层」，
T004 要产「权限判定单测」。

**实测（F4 的两套东西，别认错）**：

| 名字 | 落点 | 生产调用点 |
|---|---|---|
| `AccessSession`（v1 投影：`sessionRuleset` / `namingConflicts` / `mergeClientRules`）| `packages/core/src/access/session.ts` | **有**：`opencode/src/server/openhive/access.ts`、`.../handlers/session.ts`、`session/prompt.ts` |
| `AccessRbac`（v2 形状 `{action,resource,effect}`）| `packages/core/src/access/rbac.ts` | 仅被 `core/src/access/session.ts` 生产引用（core 内）|
| `AccessCapability` / `AccessIssue` | `packages/core/src/access/capability.ts` / `issue.ts` | **零生产调用点**——取数：`grep -rn "AccessCapability\.\|AccessIssue\." packages/core/src packages/opencode/src packages/app/src`，命中**只有定义自身**（`capability.ts` / `issue.ts`）与 `rbac.ts:15,20` 的**注释**；生产路径零命中（`rbac.ts` 那条注释自己就是这么写的）|
| 角色授权表 `grantsFor` | `@opencode-ai/auth/rbac` | **有**：`opencode/src/server/openhive/access.ts` |

⚠️ `grantsFor` 来自 **auth 包的角色表**，**不是** `core/access` 这一套——名字像，来源不同。

**为什么是「停下问」**：004 收尾时的**裁定 ④**（`004/session.md`）已经写明：capability 契约
**零消费者时不许凭空写形状断言**，要**等 F6/F7 的消费者**来钉（`LEARNINGS #004-07`：判据来源必须是
**被调方**）。005 的 T004 **是不是**那个消费者？——如果是，就按 004 的移交（`007/008` 的「第四笔」）
把契约钉住；如果 005 的 `project_member` 判定走的是 `auth/rbac` 那条线，就**明说**，并说明它与
`core/access` 那套的关系。**两条都不说 = 又一处「同一个判断两处各写一份」（`LEARNINGS #002-06`）。**

---

## Step 1 · Worktree 隔离

```bash
claude --worktree feat-005-project-management    # 基准 = 当前开发主线 multi-tenant
```

（自动按 `.worktreeinclude` 复制 `.env` / `.env.local` / `.env.development` / `.credentials.yaml`）

---

## Step 2 · 启动必读（每个 task 开始前）

① 先读 `D:\project\study\openhive\.specify\memory\constitution.md`，遵守其全部原则——**冲突以宪法为准**。

> ⚠️ 必须用**绝对路径**：宪法在外层工作区、不在本仓库。worktree 里写 `../.specify/memory/constitution.md`
> 会解析到 `.claude/worktrees/.specify/…`，**读不到**。
> 本 feature 最吃重的是 **§八（前端设计系统）**、**§一/§五（最小化上游冲突 / 侵入是「加」不是「改」）**、
> **§三（物理隔离优先）**、**§四（权限下沉执行层）**。

② 读 `docs/superpowers/specs/openhive-DESIGN.md`（**本 feature 的视觉真理源**，7 条 `[FE]` 全靠它）
+ 该目录下的 `2026-09-11-项目管理-design.md`（前置设计）+ 本 feature 的 `plan.md` + `tasks.md`。

③ **读 `docs/superpowers/specs/004-access-control/session.md`**（004 的交班）——005 是 004 的**下游**：
- **「交付物一览」+ 「已知缺口」两张表**：004 的三条挂账（MCP 来源命令无 server 字段 /
  `GET /command` 与 `GET /skill` 同型 / R1 门被拒呈现 500）——**先扫一眼有没有落到 005 头上的**。
- **再读本 feature 自己的 `tasks.md` 文件头 📥 块**（最容易漏的一处）：**004 的 T011 有「半条」
  （工作空间轴那一半）已经落在 005 的 T004 上**，判据「**工作空间成员身份不改变数据访问结果**」
  要**两轴的表都在**才验得了——数据轴那半在 `007-fund-analysis` T004（完整移交说明在
  `007-fund-analysis/tasks.md` / `008-call-analysis/tasks.md` 的文件头）。
  ⇒ **T004 做完只能算「半条落地」**，别把整条判据写成已达成（`LEARNINGS #002-02`）。

④ 取最小依赖且未完成的 task，用 Superpowers 的 `test-driven-development` skill（RED→GREEN→REFACTOR）。

⑤ 每个 task 跑完：更新 `tasks.md` 该 task 的 checkbox → 更新 `state.md` → commit → **STOP**，等我说「next」。

⑥ 全部 task 完成后 **STOP**，等审整个 feature。

⑦ **遇到「未定」的决策点先停下来问我**（见 Step 0.5 的 D0-1…D0-6 + 文末「未定项清单」），不要自行拍板。

---

## Step 3 · 任务标签执行规则

### [FE] —— 本 feature 的主战场（7 条：T005–T010、T012）

**🔑 落点实测（开工前先看这段，别照 plan 的目录图直接开写）**

| 要找的东西 | 真身 | 说明 |
|---|---|---|
| 图标栏五入口 | `packages/app/src/rail/entries.ts:RAIL_ENTRIES` | 001 已落地；`{ id: "project", label: "项目管理", icon: "folder", capability: "project" }` **是第一个** |
| 图标栏渲染 / 接线 | `packages/app/src/rail/rail.tsx:Rail` / `packages/app/src/workspace/workspace-entry.tsx:WorkspaceBody` | |
| **左栏槽位** | `packages/app/src/workspace/three-pane.tsx:ThreePane`（`props.left`）| ⚠️ **今天是空槽**，`<ThreePane left=…>` 只在测试里出现过（见 D0-2a）|
| 原生文件树 | `packages/app/src/components/file-tree.tsx:FileTree`（`file-tree-v2.tsx:FileTreeV2`）| ⚠️ **上游文件**；使用点是**上游**的 `pages/session/session-side-panel.tsx`；**无**右键菜单/新建/重命名/删除/上传/下载（见 D0-2b）|
| openhive 自有目录 | `packages/app/src/{rail,center,topbar,workspace,auth}` | 001 划的；plan.md 要的 `packages/app/src/project/` **今天不存在**（新增目录！）|
| token 第二层守卫 | `packages/app/src/workspace/design-token-refs.test.ts` | 随 `test:unit` 跑，校验自有目录里 `var(--v2-*)` / `bg-v2-*` 的**名字存在**（不证渲染值）|
| 模块目录守卫 | `packages/app/src/openhive-module-dirs.test.ts` | **新增目录前先读它**（别凭文件名推断它的规则）|
| 拖拽基建 | 已有 `@dnd-kit/solid` / `@thisbeyond/solid-dnd`（用在 `components/titlebar-tab-strip.tsx`、`pages/layout/sidebar-project.tsx` 等）+ `file-tree.tsx` 的原生 HTML5 `draggable` | MinIO 双树**没有**现成实现，但拖拽底座不用新引依赖 |

**🔴 宪法 §八 红线（NON-NEGOTIABLE）**

- **SolidJS 换皮，MUST NOT 用 React 自研**；`design-reference/figma-export/` 与 `front` 只作**视觉参考**，
  **不搬代码**（front 的 React 代码搬过来是重写不是换皮）。
- **视觉值一律走 token，禁硬编码**——`openhive/no-raw-color` 门（`bun run lint:openhive`）就是查这条。
- **绝不手改 `colors.css`**（`script/tailwind.ts` 的生成物）；token 真相链是**三处**：
  1. `packages/ui/src/v2/styles/theme.css` 的 `:root`（生成器输入）
  2. 同文件 `[data-color-scheme="light"]` 块（静态 CSS 路径）
  3. `packages/ui/src/theme/themes/oc-2.json` 的 `light.v2Overrides`（**运行时真正生效**：
     它写进一个**不带 `@layer`** 的 `<style id="oc-theme">`，压过 `theme.css` 整体所在的 `@layer theme`）
  ⇒ **只改 1、2 再跑生成器**；漏一处时构建 / typecheck / 既有测试**全绿**
  （守卫测试：`packages/ui/src/theme/brand-paint.test.ts`）。
  ⚠️ 有**两个** `theme.css`：`packages/ui/src/styles/theme.css` 是 **v1 legacy**，
  **`packages/ui/src/v2/styles/theme.css` 才是换皮靶子**（`LEARNINGS #001-04`）。
- 不启用暗色模式、仅中文、桌面宽屏（宪法 §八）。

**🟡 前端测试今天能测什么（实测手段表，别写出测不了的断言）**

| 手段 | 命令 / 落点 | 实测约束 |
|---|---|---|
| 纯逻辑单测 | `cd packages/app && bun run test:unit`（`.test.ts`，`--conditions=solid`）| 现有 **117** 个；**不收 `.test.tsx`**（脚本带 `--path-ignore-patterns="**/*.test.tsx"`）|
| 组件渲染测试 | `cd packages/app && bun run test:components`（`.test.tsx`，`--conditions=browser` + `happydom.ts` + `solid-jsx.ts`）| 现有 **20** 个；happy-dom **无 CSS 引擎** ⇒ **量不出几何/颜色**，只能钉**结构不变量**（照 `workspace/three-pane.test.tsx` 的做法）|
| 浏览器层单测 | `cd packages/app && bun run test:browser`（`./test-browser`）| 与组件测试分开的另一条 |
| E2E | `cd packages/app && bun run test:e2e`（playwright，`e2e/`）| 真浏览器；拖拽 / 视觉只能在这一层验，但慢 |
| 视觉契约门 | 根目录 `bun run lint:openhive` | 只扫 `rail/center/topbar/workspace/auth` **五目录**（见 Step 4）|
| token 名字完整性 | 随 `test:unit` 自动跑（`design-token-refs.test.ts`）| 只证名字存在 |
| 类型 | `cd packages/app && bun run typecheck`（`tsgo -b`）| |

⚠️ **「真渲染下的对比度 / 焦点顺序 / 屏幕阅读器行为」今天测不了**——配置注释明写需要 axe + 真浏览器，
本轮未做；`jsx-a11y` 只覆盖静态可判的一半。**别把「排除了这类断言」写成「已覆盖」**
（`LEARNINGS #002-02`）。

### [BE] —— 8 条（T002–T004、T011、T013–T016）

**🔴 宪法 §一 红线**：`packages/core/src/project/sql.ts` 是上游表定义（见 D0-3）。
**「加」不是「改」**：能另起一张表 / 新增一个模块挂上去，就别改上游表的定义；
确实要改的行**单独提交**，message 里标注「**这是要保留的定制**」（宪法 §二 / §五）。

**其余 BE 红线**

- **物理隔离优先，不靠应用层 `if` 过滤**（宪法 §三）。
- **权限下沉执行层**（宪法 §四）：**不认角色表、不靠提示词**；前端「只显示有权的」是 UX，**不是安全**。
- **两轴解耦**（004 的 FR-009 / 005 的 T004 注记）：数据轴（`fund_project_member` / `call_project_member`）
  与工作空间轴（`project_member`）**两套独立**，**不绑定**。

**004 / 003 留下的可复用资产（别重复造）**

| 资产 | 位置 | 用法 |
|---|---|---|
| **每用户库 + 会话私有的现成见证** | `packages/opencode/test/server/tenant-db-isolation.test.ts` | T016 的「成员会话只存自己 db」**可直接照这个形状**：真应用 + 真签令牌 + 用 `bun:sqlite` **直读库文件**做 oracle（判据要点：oracle 不经过被测接口）|
| 按用户路由机制 | `packages/core/src/database/router.ts`（`userDatabasePath` / `DatabaseRouter`）+ `connection-routing.ts` | ⚠️ 库路径**无 project 维度**（`{dataRoot}/{userId}/opencode.db`）⇒ **FR-011 的「成员之间看不见」靠库已闭合**，而**「同一用户的不同项目之间」不靠库**，只能靠 `project_id` 的逻辑过滤（`opencode/src/session/session.ts:Session.list` 先按 `ctx.project.id` 过滤）——**T016 的判据要写清验的是哪一个**，后一半今天**没有见证** |
| 迁移机制与约束 | `packages/auth/src/migrations/` + `README.md` | ⚠️ **若 T003 走「新增迁移」那条路**：整轮迁移在**一个事务**里、**不能写 `CREATE INDEX CONCURRENTLY`**（报 25001）、隔离级别依赖、别改 `MIGRATION_LOCK_KEY` |
| 真库测试手法 | `packages/auth/src/production-driver.test.ts:withProductionDb` | 本机无 Docker / 无 PG 二进制；用 `@electric-sql/pglite-socket` 把 PGlite 经 TCP 暴露，让**生产那一支** `connect()` 真跑（`LEARNINGS #002-05`）。端口传 `0`；**残差要写明**（WASM 构建的 PG ≠ 生产 PG）|
| 上游文件改动的既定纪律 | 004 的 `session.md` 文件头「上游文件里的『要保留的定制』」一节 | 照它的做法：**单独提交 + 标记 + 说清为什么不能走配置** |

### [INT] —— 1 条（T001）

T001 的措辞是「**定位** opencode 原生 project 表与文件树组件，产出改造落点」——
**它不是「找几个文件」，是「穷举有几条链 / 有几个入口」**。本提示词已经替你跑了**头一遍**
（Step 3 的落点表 + D0-2/D0-3），**但那是基线，不是终点**：

- 产出必须是**清单 + 差集为空**：`grep` 出**全部**调用点 / 全部挂载点后，逐个问「这里要不要改」，
  **判据是「调用点数 == 要改的数」**，不是「我找到几个够不够」。
  004 在这里差点翻车：一开始按「已经有守卫的地方」清点，**缺口按定义不在集合里**
  （`LEARNINGS #004-01`：锚在「**做那件事的那一行**」，不是「已经守在旁边的那一行」）。
- 若探出**不止一条链 / 不止一个入口** ⇒ **这就是「停下来问」的点**（是都接、还是先接一条）。
- 003 有个现成的形状可抄：「**一份判定、多条链注入**」——
  `packages/core/src/quota/session-quota.ts`（判定 / 阈值 / 计数写一份，只有「集合从哪取」按链注入）。

---

## Step 4 · 质量门禁（宪法第五章，审查前先过）

- **在受影响 package 内跑 `bun test`**（**禁止根目录 `bun test`**，根脚本强制 `exit 1`）。
  005 至少影响 **`packages/app`**、**`packages/opencode`**（BE 侧落点），若 T003 动到核心表
  还会影响 **`packages/core`**——**按实际改动逐个跑**。
- **🔴 `cd packages/app && bun run test:components`（005 第一次真正启用）**。
  `.test.tsx` **进不了** `test:unit`（脚本带 `--path-ignore-patterns="**/*.test.tsx"`），
  **漏跑 = 白写**。T005–T010、T012 的组件测试都落在这里。
  ⚠️ 若新增的 `.test.tsx` **不在** `packages/app/src/` 下（例如落进 `test-browser/`），
  **停下来告诉我**——那属于另一条脚本。
- **`bun run lint:openhive` 退出码 0**（`openhive/no-raw-color` 视觉契约门，扫
  `packages/app/src/{rail,center,topbar,workspace,auth}` 五个目录）。
  ⚠️ 门规则级别是 **warn** ⇒ 「退出码 0」= **0 error**；**存量 warning 是基线，不是本次命中**。
  **基线先测再写**（`LEARNINGS #001-02` / `#003-04`）：**开工时自己跑一次、把当时的真实数字
  （warnings / errors / 文件数）落进 `005/state.md` 再引用**——**不要抄 001 的数**，
  那是另一台时间点的快照（`LEARNINGS #002-06`：会随编辑而变的值别写死，写取数命令）。
  🔴 **本 feature 的专属例外**：plan.md 要的前端落点是 `packages/app/src/project/`——
  **不在上面五个目录里** ⇒ **这道门扫不到你的新文件**。这不叫「过了」：
  **要么把新目录加进 `package.json` 的 `lint:openhive` 目录列表，要么告诉我由我扩范围**；
  同时**读一遍** `packages/app/src/openhive-module-dirs.test.ts` 与
  `design-token-refs.test.ts`——它们各自维护着一份「自有目录」清单，**新增目录时要一起改**，
  且**两处（或多处）必须同时改**（只改一处 = 一个真相两份写法）。
  **改法先报告、别自己拍。**
- **`bun run lint` 只判「本次新增/改动文件 0 命中」**：全局有 **1 个已登记的「上游」error**
  （`packages/session-ui` 的 prompt-input 组件，裁定为不私改、登记待上报）⇒ 全局退出码**恒为 1**。
  **不要为它改上游代码，也不要拿它当阻断。**
- **`bun run typecheck`（turbo）退出码 0**；前端另有 `cd packages/app && bun run typecheck`（`tsgo -b`）。
- ⚠️ **门禁串行跑，别并行**：同机并行跑多道门禁会**造假红**——003 实测（core 报 18 fail / 6 errors、
  auth 报 11 fail），**各自串行复跑全部回到基线**。看到红先串行复跑一次再当结论（`LEARNINGS #003-01`）。
- ⚠️ **不得用「替身 / mock」把被测对象换掉**——那等于没测（`LEARNINGS #002-02`）。
  MinIO 那一类外呼**更要小心**：把客户端收成窄接口再注入替身是**允许**的（边界替身），
  但**替身必须验证的是「被测方的行为」**，不是「替身被调了几次」。

---

## Step 5 · 代码审查（用 Superpowers 的 `requesting-code-review` skill）

质量门禁过 + 全部 task 绿后触发审查，至少覆盖以下 6 类：

① **韧性缺陷**：缺重试 / 缺超时 / 缺熔断器（MinIO 上传/下载、归档大批文件时**必然**要问这条）
② **横切一致性缺陷**：权限判定是否覆盖**所有**入口（成员面板 / 项目面板 / 文件操作 / 归档找回，
　　**以及 INT 那条链**）；「4 个入口里 3 个有检查，第 4 个漏了」是 004 的头号翻车场景
③ **防御性编码缺陷**：未处理的 null / 缺输入校验 / 缺幂等键（**归档/找回天然要幂等**——R3 已点出）
④ **数据库迁移缺陷**：加的列/表可回滚 + 别写 `CONCURRENTLY`（若走迁移那条路）
⑤ **🔴 前端换皮一致性（本 feature 特有）**：
> 逐项核对 §八 与 `openhive-DESIGN.md`——
> - 是否**硬编码了本应走 token 的视觉值**（跑 `lint:openhive` 之外还要**读**：warn 级门会放过）
> - 是否**手改了生成物**（`colors.css` / `oc-2.json`）
> - 若动了 token：**三处真相链是否同步 + 是否跑了生成器**（漏一处**全绿**，见 Step 3）
> - 是否引入了**项目禁止的依赖**（React / 新树控件 / 新拖拽库）
> - 是否**仅中文、无暗色模式**、桌面宽屏
⑥ **🔴 上游侵入面（本 feature 特有）**：

> 004 的侵入面是「往上游的工具执行链上挂守卫」；**005 的侵入面是「上游的表结构 + 上游的前端组件」**。
> 审查必须确认：
> - 是否**真的**用「加」而不是「改」——`packages/core/src/project/sql.ts` 与
>   `packages/app/src/components/file-tree.tsx` 是**两个最可能被改的上游文件**
> - 每处上游改动是否**单独提交**、message 是否标注「**这是要保留的定制**」
> - 是否碰到了 `sql.ts` / `colors.css` 或其他上游高频文件（宪法 §一 明令）
> - 新增目录（如 `packages/app/src/project/`）是否**同时**更新了所有「自有目录」清单

审查报告用 `receiving-code-review` skill 消化，格式：
`| 编号 | 类别 | 文件:行 | 描述 | 修复优先级 |`

**0 个缺陷** → 进 Step 6；**有缺陷** → 回到对应 task 走 TDD 修复，重新审查，直到 0 缺陷。

> 📌 **`LEARNINGS #003-02`：第一轮修完之后，把「修复本身」再当靶子打一轮。**
> 003 第一轮审出 35 条、全修完之后，第二轮（**5 片并行 + 对抗证伪**）抓到的 **R2-01…R2-05
> 全部长在刚修出来的代码里**，其中两条是 P0/P1。**「修完」不等于「审完」**——
> 这一轮别用同一套视角，否则只会得到第一轮的结论复述。

---

## Step 6 · 收尾

1. 最终 commit，message 含 `Closes 005-project-management`。
2. **merge 回开发主线**：⚠️ **这一步做不了，交给我**——`multi-tenant` 已在主检出被 checkout
   （一个分支不能 checkout 两次），且隔离会话对共享检出的 git 操作会被拦。
   你只做 final commit，然后把 `git merge --ff-only worktree-feat-005-project-management` 给我，
   **我在主检出执行**。
3. `git tag v0.1.0-005-project-management`（沿用 002/003/004 带编号的形式）。
   ⚠️ **tag 不由你打**——它与 merge 配套，**由我在主线合入之后执行**（SOP Phase 6；
   001 的教训是 tag 打在收尾提交上、漏掉了后来的补测提交 ⇒ **tag 必须指向最终状态**）。
   你只交 merge 命令（上一条）。
4. 更新 `docs/superpowers/specs/005-project-management/session.md` 标记完成
   （它今天是「尚未开始」的空壳）。
5. `specs/005-project-management/` **永不删除**（下一个 feature 的上下文）。
6. 报告：**共 16 个 task（7 FE / 8 BE / 1 INT）** / 审查发现 X 个缺陷已全部修复 /
   门禁基线数字（含失败数）。
7. **把 `LEARNINGS.md` 补上**（1–5 条，加在最顶部，不值得记的宁可不写）。
   **可预期的素材**：左栏空槽的发现、上游文件树的能力缺口、token 三处真相链在 005 的第二次踩点、
   `test:components` 的实际约束（happy-dom 量不出 CSS）、MinIO 边界替身的做法。

---

## 节奏铁律

- **逐 task 停**：每个 task commit 后 STOP 等「next」确认（服从宪法第九章）。
- **一个 feature 跑完停下来等审**，再下一个。
- **严禁多 agent 并发跑多个 feature。**
- **本 feature 额外一条**：005 与 004 一样**没有**预置的 D1–Dn 清单，所以「到点必须停下来问」
  **没有人工提醒机制**。按 003/004 的做法：**每个 task 开工前回头核一遍 Step 0.5 六条还有没有活的**，
  并固定那个习惯——**动第一行代码之前，先问「这条 task 的出参，今天在仓库里打得到吗？」**

---

## 未定项清单（**开工前先裁定**）

| # | 事项 | 今天的事实（已实测） | 需要你定什么 |
|---|---|---|---|
| **U1** | **自动归档形态**：spec 与 plan **自相矛盾** | `spec.md` 里有 **4 处**写「**已确定**：先提醒、owner 确认后归档」（AC4、US5 后的注记、FR-008、Assumptions）；而 `plan.md` 的风险表 **R4** 仍写「**待决策**（先提醒 vs 直接归档）」 | 按 spec 收口（把 plan R4 改掉），还是另有裁量？**开工前改掉 R4**，否则 T013 的判据两处打架 |
| **U2** | **`案件（case）` 实体无任务** | `spec.md` 的 Key Entities 列了「案件（case）：结构化属性落业务 PG，通过 `project_case` 与项目多对多关联」；但 `tasks.md` 与 `plan.md` 里 `案件` / `project_case` **零命中** | 是**漏了 task**，还是**明确划出 005 范围**？写明一句，别让它悬着 |
| **U3** | **超期自动提醒的「触发者」** | FR-008 要 3 个月无操作 ⇒ 提醒。仓库**没有任何调度设施**（无 cron、无 timer；同类问题 003 已登记在 `docs/workspace/deploy-todo.md` **D-06**） | 是「只做能力 + 挂账运行者」（照 D-06 的做法），还是本 feature 引入调度？ |
| **U4** | **`project` 表加列 vs 另起表** | 见 D0-3：上游 `sql.ts` + 每用户库 + 宪法 §一 | 加列（单独提交标定制）还是新增 `project_ext`？ |
| **U5** | **`project_member` 的判定走哪条线** | 见 D0-6：`AccessCapability`/`AccessIssue` **零生产调用点**；生产跑的是 `AccessSession` + `auth/rbac.grantsFor` | 005 是不是 capability 的第一个消费者？若不是，明说它走哪条线 |
| **U6** | **FR-012「文件并发靠 git」** | 见 D0-5：无分支/合并承载体；`initGit` 只 init 不 commit（003 已登记） | 只验「留痕」那半 + 并发挂账，还是整条挂 `deploy-todo.md`？ |
| **U7** | **T004 的「半条」判据怎么落** | 004 的 T011 一半在 005 T004、一半在 007 T004；判据「工作空间成员身份不改变数据访问结果」**要两轴的表都在** | 005 只做工作空间轴那半并**显式记「另一半在 007」**，还是等 007 一起验？ |
| **U8** | **`docs/workspace/deploy-todo.md` 的接收方** | 本 feature 至少有两笔部署侧事项（MinIO 桶/账号；可能的 OS 级归档与配额） | 确认「MinIO 相关部署项落 D 表」（`LEARNINGS #002-04`：责任推出边界时必须落进**接收方**的表） |
