现在开始实现 `docs/superpowers/specs/009-ai-assets/`（内层仓库 openhive 内）。

> 以下路径均相对于**当前会话的工作目录**（= worktree 根 `openhive\.claude\worktrees\feat-009-ai-assets\`）。
> 绝对路径锚点：仓库根 `D:\project\study\openhive\openhive\`；外层工作区 `D:\project\study\openhive\`。

**本 feature 一句话**：把 **Skill / MCP / 知识库**统一抽象成「资产」，用**一套元数据、一套权限、一套生命周期**治理；
左栏纯导航、中栏浏览，Skill 走「草稿 → 审核中 → 待技术发布 → 已发布 → 迭代中 → 已下线 → 已归档」，
审核分「业务审内容 + 系统审技术」两道关，权限走 RBAC + 三级空间 + 授权组。

**任务总量 17 条**（T001–T017，7 个阶段）：

| 阶段 | 编号 | 内容 | 标签 |
|---|---|---|---|
| Phase 1 | T001–T002 | 资产统一元数据 + 状态机 / `/assets` 存放与部署方案 | **2 BE** |
| Phase 2 | T003–T004 | 资产服务（metadata + storage）/ RBAC + 三级空间 + 授权组 | **2 BE** |
| Phase 3 | T005–T007 | 左栏纯导航 / 中栏卡片网格 + 搜索 / 详情四 Tab | **3 FE·新增** |
| Phase 4 | T008–T010 | 生命周期流转 / 审核两道关 / 站内信通知 | **2 BE + 1 INT** |
| Phase 5 | T011–T013 | 授权 vs 收藏 / 资产治理 MCP server / Skill 制作入口 | **2 BE + 1 INT** |
| Phase 6 | T014–T015 | MCP 授权三层 + 数据隔离四环 / 「▶ 执行此 skill」 | **1 BE + 1 FE·新增** |
| Phase 7 | T016–T017 | 生命周期与审核测试 / 授权与收藏测试 | **2 BE** |

标签分布：**`[BE]` 11 条、`[FE·新增]` 4 条、`[INT]` 2 条**。

⚠️ **与 006 的关键差别，先记住五句**：

1. **009 是 BE 重头，不是「前端换皮」**：17 条里 11 条 BE。plan 写的资产服务、`/assets` 共享卷、
   资产治理 MCP server、RAGFlow，**今天在仓库里都不存在**（见 Step 0.5 D0-1 / D0-2 / D0-9 / D0-10）。
   照 plan 的目录图直接开写，会先撞上「没有落点」。
2. **009 的第一号风险不是 UI，而是「资产服务 ⇄ opencode 内核」的边界**：plan 说「内核只被动扫描、
   资产服务做全动作」（`plan.md:138`），但内核的 skill 发现只认 `Config.skills.paths`，
   **没有按用户/部门动态拼路径的能力**（D0-5）。这条边界要先裁定，否则 T003/T004/T014 会互相打架。
3. **它复用 F4 / F8，但两处都只是「部分可复用」**：F4 的 `auth.role` 只有 `id/name`，没有
   `role_type`、没有可见范围、没有部门 ID（D0-4）；F8 的能力清单是**静态常量 + 字段不全**，
   而且右栏投影今天直接读 `center.module()`（D0-6）。**别把「Prerequisites 已落地」当成「接口已就绪」**。
4. **009 的验收判据大量落在「状态 + 权限」，不在「页面长得对」**：T008/T009/T016 是状态机，
   T004/T011/T017 是权限与收藏分离。这些判据**必须能在 PGlite / 真 PG 上量出来**，
   happy-dom 只能覆盖前端结构（见 Step 3 / Step 4）。
5. **009 是 010 的前置**：010 治理后台的「AI 资产治理」以 F9 为准（`openhive-PRD.md:253`）。
   009 没落地的部分，**要明确写进 010 的缺口表**，不能默认「后面再说」。

---

## Step 0 · 开 worktree 之前 / 刚开后（**逐项验证，不要“顺手修”**）

**0.1 基点设置（易误判，先看这条）**

`worktree.baseRef` **已配置为 `head`**（`C:\Users\Administrator\.claude\settings.json`）——它是
**Claude Code 的设置项、不是 git config**，用 `git config worktree.baseRef` 查会显示为空，别据此判断
「没配置」（`LEARNINGS #001-03`：默认 `fresh` 会从 `origin/dev` 切）。

**0.2 验证基点正确**

```bash
git merge-base --is-ancestor multi-tenant HEAD    # 退出码 0 = 基点正确
```

不通过就**停下来告诉我**，不要自行 `git reset --hard`。

**0.3 验证前置 feature 已合入（只验 F4 / F8，不验 007 / 008）**

009 的 `tasks.md:5` 写的是「**F4 RBAC + F8 指令卡已落地**」。**不要**去验 007（资金分析）或
008（话单分析）——用户 2026-10-24 已明确：007 / 008 的产品设计未定，**暂停**，直接做 009 / 010。

```bash
git merge-base --is-ancestor v0.1.0-004-access-control multi-tenant \
  && echo "✅ 004 已合入" || echo "❌ 004 未合入，停"
git merge-base --is-ancestor v0.1.0-006-ai-session multi-tenant \
  && echo "✅ 006 已合入" || echo "❌ 006 未合入，停"
```

⚠️ **用 tag 而不是分支名**：`worktree-feat-004-access-control` / `worktree-feat-006-ai-session`
在合并后可能已被清理，tag 是持久引用。**两条都不要写死 SHA**（`LEARNINGS #002-06`：
会随提交而变的值写取数命令）。

**0.4 工作区残留体检（本 feature 的**头号开工阻塞**）**

当前 `git status --porcelain` 实测（2026-10-25，主检出 `multi-tenant`，HEAD `35cfe7e428`）：

```text
 M packages/auth/package.json
?? packages/auth/script/test-real-pg.ts
?? packages/auth/src/comments.test.ts
?? packages/auth/src/migrate.real-pg.test.ts
?? packages/auth/src/real-pg-test-support.ts
?? packages/auth/src/migrations/0008_column_comments.sql
?? packages/auth/src/migrations/0008_column_comments.down.sql
```

这**不是**「顺手带上的杂项」，而是 **009 的迁移验收地基**：

- `comments.test.ts` 会遍历整个 `auth` schema，**新增表/列漏写中文注释就变红**
  （`comments.test.ts:24-57`；阈值 `>=8` 张表 / `>=45` 列，见 `:39` / `:54`）。
- `migrate.real-pg.test.ts` 把 `auth` 表清单**逐字写死**（`migrate.real-pg.test.ts:29-39`），
  009 每加一张表都要回来改这个 `toEqual`。
- `real-pg-test-support.ts` 是 `OPENHIVE_TEST_PG=1` + `PG_DATABASE` 必须以 `_test` 结尾的硬闸
  （`:11` / `:26` / `:42`）；`package.json:13` 的 `test:real-pg` 是它的入口。
- `0008_column_comments.sql` 是**用户 2026-10-25 明确要求**的中文字段说明，已应用到远端三个库。

⚠️ **这些文件都不在 HEAD 上。** 如果现在直接 `claude --worktree feat-009-ai-assets`，
新 worktree 里**没有** 0008、没有 `comments.test.ts`、没有 `test:real-pg` 脚本——
009 新加的资产表就会**在没有守卫的情况下落地**，后面再补就是两套口径。

**开工前必须停下来定这一条**：

- **建议（需你确认）**：先在主检出把 0008 这一组作为一个**独立提交**落下来，再开 009 worktree。
  提交信息建议：`test(auth): 真 PG 迁移验收 + 中文字段注释（0008）`。
  **不要**把它混进 009 的功能提交（那违反「一个 PR 不混合重构与新功能」）。
- 本文档 `docs/workspace/dev_tdd.009.md` 本身也是**新文件**；如果不开提交，它同样不会出现在
  worktree 里。建议与 0008 分开提交：`docs(009): 开工前准备（dev_tdd.009）`。
- **我没有替你提交**。你确认后我再执行；不确认就**不要开 worktree**。

**0.5 符号链接体检**

仓库含 symlink 资产（favicon / logo / 图标）。本机 `core.symlinks` 已是 `true`（实测）。

```bash
git status --porcelain                # 除 0.4 那几行外，不应再有别的
# 若出现大量 " T"（typechange）→ 说明又被降级成路径文本文件了
```

**修法（仅在真的出现 `T` 时）**：

```bash
git status --porcelain | awk '{print substr($0,1,2)}' | sort -u   # 确认只有 " T"
git status --porcelain | grep '^ T' | cut -c4- | xargs rm
git checkout -- .
```

**0.6 陈旧锁体检**

```bash
ls -la .git/worktrees/feat-009-ai-assets/index.lock 2>&1   # 存在且 0 字节 + 无 git.exe ⇒ 陈旧锁（#005-10），可删
```

**0.7 `git add` 之前别跑 `git status`，也别用 `git add .`**——**点名文件**
（`LEARNINGS #005-08` / `#005-10`）。

---

## Step 0.5 · 开工前必须先实测的十五件事（**“命中就停下来问”**）

⚠️ 009 与 004 / 005 / 006 一样**没有预置决策点清单**（`plan.md` / `tasks.md` 里没有 D1–Dn）。
下面十五条**不是从它自己的文档里抄的**，是逐文件实测出来的「plan 假设 ⇄ 仓库现状」差集。
**每条都带落点与判据**，且每条都可能是「停下来问」的触发点。

> 📌 **可复用的做法**（003–008 各验证过）：
> **开工必读之后、动第一行代码之前，先问「这条 task 的出参，今天在仓库里打得到吗？」**
> 打不到就别做——**先裁定归属**。004 靠这一问省掉了两条假测试；005 靠它把 D0-4 认成「方案不是代码」；
> 006 靠它把「右栏会话」认成双重误判。009 的十五条里，前八条都会直接改变 task 的归属。

### 🔴 D0-1（头号风险）：**资产元数据与资产服务今天都不存在，plan 的 `asset-service/` 也不是 workspace**

**实测**：

- `ls asset-service` ⇒ `No such file or directory`。
- 根目录 `services/` 只有上游的 `changelog` / `files` / `update` / `www`（`find services -maxdepth 3 -type f` 只看到 `.turbo/turbo-typecheck.log`），**没有资产服务**。
- 根 `package.json:27-33` 的 workspaces 是 `packages/*` / `packages/console/*` / `packages/stats/*` /
  `packages/sdk/js` / `packages/slack`——**根级 `asset-service/` 不在任何 workspace 里**。
- `packages/auth/src/migrations/` 现有表只有 `user` / `role` / `user_role` / `role_resource` /
  `project_member` / `project_archive` / `project_meta` / `project_backup_event`
  （`grep -rn "CREATE TABLE" packages/auth/src/migrations/*.sql`）——**没有任何 asset / favorite / review / notification 表**。
- plan 的 `metadata.ts` / `lifecycle.ts` / `storage.ts` / `notify.ts`（`plan.md:48-55`）**全是待新建文件**。

**为什么这是头号风险**：T001 的出参是「元数据 + 状态机定义」，T003 是「资产可提交/复制/删除」，
T004 是「授权组可定向授权」——**三条都要求先决定这些代码放在哪个 package、表放在哪个 schema**。
目录放错不会报错，只会让 `bun test` / `typecheck` / lint **扫不到它**，然后你以为它绿了。

**停下来问**：资产服务落在哪里？

| 选项 | 形态 | 代价 |
|---|---|---|
| **A（建议）** | 新建 `packages/asset-service/`，加入 workspace；导出 Hono/Effect 路由模块，由 opencode 进程挂载 | 与 plan 的「独立资产服务」语义一致；共享仓库工具链；但需要新增 package.json / tsconfig / 测试脚本 |
| B | 按 plan 建根级 `asset-service/`，再手动加进 workspaces + 所有门禁脚本 | 目录名与 plan 一致；但根级目录容易漏扫，且与上游 `services/` 命名混淆 |
| C | 直接放进 `packages/opencode/src/server/openhive/asset*.ts`，元数据表放 `auth` schema | 改动面最小；但「内核只被动扫描」的边界被打破，未来拆服务要搬家 |
| D | 元数据/状态机放 `packages/auth`，HTTP 出口放 `packages/opencode` | 复用 auth 的迁移与真 PG harness；但 `auth` 包会从「认证」变成「认证 + 资产」，语义变宽 |

**我的建议**：**A**。理由：009 的资产服务不是「给内核加一个函数」，它有独立的状态机、存储、通知、
MCP 工具出口；放进 `packages/opencode` 会让内核边界越来越厚。`packages/*` 是现成 workspace glob，
新建包**不需要动上游文件**，符合宪法 §一 / §五。

**同时要定**：资产表放 `auth` schema，还是新开 `asset` schema？

- `auth` schema 的**好处**：`migrate.ts` 的 advisory lock（`MIGRATE_LOCK_KEY = 424242`，`migrate.ts:53`）、
  `auth._migration`、`comments.test.ts`、`migrate.real-pg.test.ts` 都能直接复用。
- 新开 schema 的**代价**：迁移 runner 现在只认 `auth`（`migrate.ts:6` / `:81-83` / `:214`），
  真 PG 夹具也只 `DROP SCHEMA auth CASCADE`（`real-pg-test-support.ts:42`）。**这不是加一张表，是改迁移框架**。

**建议**：**先放 `auth` schema**，在表注释里写明「资产域，暂借 auth schema，F10 再评估拆 schema」。
这是**技术债**，要进 `state.md` 缺口表，不能当没发生。

**影响 task**：T001 / T002 / T003 / T004 / T008 / T009 / T011 / T012 / T016 / T017。

---

### 🔴 D0-2：**`/assets` 共享卷与部署形态今天没有承载体**

**实测**：

- `packages/auth/src/workspace.ts:13` 只有 `OPENHIVE_WORKSPACE_ROOT`，`:33` 只有 `OPENHIVE_SHARED_ROOT`；
  `:108` 的 `projectDirectory()` 只拼 `{root}/{userId}/{projectId}`。**没有 assets root 的环境变量或 helper**。
- `packages/opencode/Dockerfile` 共 18 行：只 `COPY` 预编译二进制、装 `libgcc/libstdc++/ripgrep`、
  `ENTRYPOINT ["opencode"]`。**没有 `/assets` volume、没有 compose、没有资产服务进程**。
- **业务代码里没有 `/assets` 共享资产根**：`grep -rn "/assets" packages --include='*.ts' --include='*.tsx'`
  只命中前端构建产物的 `dist/assets/…` 与 `@/assets/…` 静态资源路径；plan / design 里的 `/assets`
  是文档路径，不是可用的存储根。

**为什么重要**：T002 的出参是「目录/部署方案」，T003 要做「复制/删除/rename」。
如果 `/assets` 只是一个文档里的路径，**在开发机（Windows）上根本落不了地**；
如果直接写死 `/assets`，Windows / 测试环境会建到盘根，且和真实部署语义混在一起。

**停下来问**：

1. **开发机 fallback 放哪里？** 建议新增 `OPENHIVE_ASSETS_ROOT`，生产默认 `/assets`，
   开发/测试显式指到 `D:\openhive-stack-state\assets`（**不要**指到会被 C 盘清理删掉的 `%TEMP%`；
   见 memory「真栈落盘态被 C 盘清理删过」）。是否认可？
2. **T002 只出「方案文档」，还是同时落 storage helper？** 建议 T002 同时落：
   - `assetsRoot()` / `assetDirectory()` / `pendingDirectory()` / `publishDirectory()` / `archiveDirectory()`；
   - 幂等 `ensureDir()`；
   - **不**改 Dockerfile / compose（部署变更单独裁定，避免与上游构建面冲突）。
3. **物理迁移的原子性**：design §2.5（`2026-09-12-AI资产-design.md:162-174`）写「先删旧 + 复制新」或
   「临时目录 + 原子 rename」。**rename 在跨卷时会退化成复制**，Windows 上尤其要注意
   （`LEARNINGS #006-23`：`resolve` ≠ 同形；`#003-07`：别过 PowerShell）。建议统一走
   「同卷临时目录 → rename → 删旧」，并在 T003 写一条**中途失败**用例（`LEARNINGS #007-01`：
   每步幂等 ≠ 整体可重入）。

**影响 task**：T002 / T003 / T008 / T012。

---

### 🔴 D0-3：**AI 资产工作区的前端没有挂载点——左栏只有 project，中栏只认文件 tab / route page**

**实测**：

- 图标栏入口已存在：`packages/app/src/rail/entries.ts:56`
  `{ id: "ai-assets", label: "AI 资产", icon: "archive", capability: "ai-assets" }`。
  但**它今天只负责「切 module」**（`workspace-entry.tsx:1619-1624`）。
- 左栏只在 `project` 模块渲染：`workspace-entry.tsx:262`
  `const 左栏开着 = () => center.module() === "project" && projectOpen()`；
  `:1653-1654` 的 `left={center.module() === "project" ? (...)`。**`ai-assets` 没有左栏分支**。
- 中栏只有三种结果：激活文件 tab → 视图；否则 route page（`props.children`）；否则 empty
  （`center-content.tsx:125-208`）。**没有「模块级资产浏览器」这个分支**。
- 视图注册表只按扩展名认文件：`center/views/index.ts` 注册 `.docx/.xlsx/.pdf/.png/.md/.xmind/.ts…`，
  **没有 asset 视图**。
- `ContentTab` 只有 `{ module, title, path }`（`center/tab-store.ts:2-13`），
  `switchModule()` 只改 module、**明确不许动 tab**（`:119-121`）。资产详情**没有 path**，
  硬塞进 `ContentTab` 会污染 tab 身份模型。

**为什么重要**：T005/T006/T007 是 3 条 FE，plan 说落在 `packages/app/src/ai-assets/`，
但**这个目录不存在**，而且「左栏/中栏怎么切到资产浏览器」没有现成模式。

**停下来问**：

- **左栏**：在 `workspace-entry.tsx` 加 `center.module() === "ai-assets"` 分支，渲染 `AssetNav`？
  还是把「左栏内容」抽成按 module 的表？建议前者（改动小、与 `project` 分支同形）。
- **中栏**：资产浏览器是「route page（`props.children`）」还是「模块级页面」？
  - 走 route page：需要在 `layout-new.tsx` 给 `ai-assets` 传一个页面；但 `CenterContent` 只在
    **没有激活文件 tab** 时显示 `children`。如果用户从项目模块带着文件 tab 切到 AI 资产，
    资产页会被文件 tab 盖住。
  - 走模块级页面：在 `CenterContent` / `WorkspaceEntry` 增加「`module === "ai-assets"` 时渲染资产浏览器」，
    文件 tab **保留但不可见**，切回项目模块恢复。这符合「`switchModule` 不动 tab」。
  - **我的建议**：走模块级页面，但**新增一个明确的 `workspaceView` 概念**，不要在每个组件里
    散写 `module === "ai-assets"`（`LEARNINGS #002-06`：同一判断只留一处）。
- **详情**：资产详情用**页面内状态**（选中 assetId → 详情面板）还是中栏 tab？
  **建议页面内状态**：`ContentTab` 的 `path` 对资产没有意义；资产详情不是「文件」。
- **视觉规格**：`openhive-DESIGN.md` 有 §4.1 三栏、§4.2 关键 UI 块、§4.5 中栏 tab、§4.7 指令卡，
  **没有资产浏览器 / 卡片网格 / 资产详情 / 左栏导航的规格**。`docs/superpowers/design-reference/figma-export/`
  和根 `front/` **都不存在**；`ResourceMarketplace` 只在 `plan.md:99` 被提到，**全仓无实体**。
  ⇒ T005–T007 开工前要么**补 DESIGN.md 一节**，要么由你给一份可执行的视觉规格。**不要靠肉眼现编**。

**影响 task**：T005 / T006 / T007 / T015（以及 T013 的右栏入口）。

---

### 🔴 D0-4：**RBAC 与 plan 的「授权组 / 三级空间 / 四类权限 / 两道审核」对不上**

**实测**：

- `auth.role` 只有 `id` / `name`（`0004_rbac.sql:36-40`），**没有 `role_type`、没有 scope、没有部门列**。
- `auth.role_resource` 的 `resource_type` 闭集是 `('skill','mcp','knowledge_base')`，
  `perm` 闭集是 `('read','write','review','admin')`（`0004_rbac.sql:47-52`）——**值的闭集有了，但没有承载者**。
- `auth.user` 的 `org` / `dept` / `section` 都是 **free text**（`0001_init.sql:20-22`），
  只有 `is_admin integer DEFAULT 0`（`:25`）。**没有稳定的部门 ID，也没有「业务管理员 vs 系统管理员」两列**。
- `core/access/rbac.ts`：
  - `RESOURCE_TYPES` / `PERMS` 与 DB CHECK 是同一份值的两处写法（`:44` / `:55`）；
  - `TOOL_OF_TABLE` 只有 `skill`（`:129`）；
  - `knowledge_base` **零工具映射，注释自认是真缺口**（`:111`）；
  - `resolve()` **只有 `perm === "read"` 产 allow**（`:155`），`write` / `review` / `admin` **没有 carrier**。
- `packages/opencode/src/server/openhive/access.ts` 的 `capabilityFor()` 只把 grants 投影成
  session 规则集；**没有 review/admin 的判定出口**。

**后果**：

- T004 的「授权组（`role_type='group'`）」**今天写不出来**——表里没有 `role_type`。
- T004 的「三级空间（全局/部门/个人）」需要资产侧的 `visibility` / `owner_dept`，**今天也没有资产表**。
- T009 的「业务审核 + 技术发布分离」没有 actor 载体：只有 `is_admin`，**分不出业务管理员 / 系统管理员**。
- T017 的「无权资产不可见」可以测，但「review/admin 权限」**无法测**，因为 `resolve()` 不产这两种 allow。

**停下来问**：

1. **`role_type` 怎么加？** 建议 `0009_asset_rbac.sql` 给 `auth.role` 加：
   ```sql
   role_type text NOT NULL DEFAULT 'normal'
     CHECK (role_type IN ('normal', 'group'))
   ```
   授权组 = `role_type='group'`；普通角色 = `normal`。**不要**用 `role.name` 字符串约定，
   那会在改名时静默失效。
2. **业务管理员 / 系统管理员怎么表达？** 建议**不新增 actor 列**，用 grants 表达：
   - 业务审核权 = 对资产 `perm='review'` 的 grant；
   - 技术发布权 = 对资产 `perm='admin'` 的 grant；
   - 系统管理员仍保留 `is_admin` 作为治理后台总开关。
   这样 T009 直接查 `grantsFor()`，不需要改 `core/access/rbac.ts` 的 `resolve()`。
   **但**：`resolve()` 不产 `review/admin` allow，所以 **review/admin 只能在资产服务里判**，
   不能指望它变成工具规则。是否接受这个边界？
3. **三级空间怎么落？** 建议资产表带 `visibility text CHECK (visibility IN ('global','dept','personal'))`
   和 `owner_dept text`；部门沿用 `auth.user.dept` 的 free text（**已知技术债**：部门改名/合并会断，
   F10 再上组织架构 ID）。是否认可？
4. **`knowledge_base` 的权限**：它今天没有工具映射。009 只做「资产浏览 + 授权」，不做 RAGFlow 执行
   （见 D0-10）。那么 `knowledge_base` 的 grant 只影响**可见性**，不影响工具——这条要写进 T004 的注释，
   否则会误导后来人以为「授权了就能用」。

**影响 task**：T004 / T009 / T011 / T014 / T017。

---

### 🔴 D0-5：**`skills.paths` 是「进程级配置」，plan 的「登录时按用户部门 + 全局自动拼写」没有落点**

**实测**：

- `packages/opencode/src/skill/index.ts:211-219`：
  ```ts
  for (const item of cfg.skills?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) { ... continue }
    yield* scan(state, dir, SKILL_PATTERN)
  }
  ```
  它读的是 `cfg.skills.paths`，而 `Config` 是**实例级**的，不是每用户一份。
- `packages/core/src/config.ts:90` 的 `skills` 是 `Schema.Array(Schema.String)`；
  `packages/core/src/v1/config/skills.ts:6-9` 只有 `paths` / `urls`。**没有 `perUser` / `department` 语义**。
- `packages/opencode/src/session/system.ts:114-133` 的 openhive 定制只做「skill 工具被禁用时，
  提示词里的 skill 清单也清空」；**单个无权 skill 仍会列在提示词里**（只要有一个 skill grant，
  skill 工具就开着）。执行层的 `tool/skill.ts` 会 `ask({ permission: "skill", patterns: [name] })`，
  但**提示词已经泄露了名字与描述**。

**后果**：plan `:122` 的「全局/部门走 `skills.paths`（登录时按用户部门 + 全局自动拼写）」
**今天无法直接实现**。如果强行在每次登录改 config，会污染进程级配置，且并发用户互相覆盖。

**停下来问**：分发模型选哪条？

| 选项 | 做法 | 代价 |
|---|---|---|
| **A（建议）** | `skills.paths` 全局指向 `/assets/global/skills` **和所有部门目录**；发现是宽的，**安全边界放在「提示词清单过滤 + 执行鉴权」** | 需要改 `session/system.ts`，让无权 skill 不进提示词；`tool/skill.ts` 已有 ask；不按用户拼 path |
| B | 每用户一个目录（symlink/junction 到有权资产），`skills.paths` 指向每用户目录 | 需要**每用户 config 注入**；当前 `Config` 是实例级，改动大；Windows junction 还要处理（memory：`ln -s` 是深拷贝） |
| C | 资产服务生成一份「用户 → 允许 skill 名」的清单，内核启动时按会话过滤 | 需要新的内核接口；opencode 上游侵入面最大 |

**我的建议**：**A**，并把「`session/system.ts` 的提示词过滤」列为 009 的**必须改动**（不是可选）。
判据：一个无权 skill 的 `name` / `description` **不得**出现在该用户的 system prompt 里；
同时 `tool/skill.ts` 的 ask 仍然是第二道门。**两条都要测**（`LEARNINGS #004-01`：
数「做那件事的那一行」，不是「已经守着的那一行」）。

⚠️ 这条一旦确认，`packages/opencode/src/session/system.ts` 就是**上游文件改动**，
必须单独提交并标注「这是要保留的定制 · 同步上游时不要丢」。

**影响 task**：T003 / T004 / T014；以及 006 的右栏 skill 清单供给。

---

### 🔴 D0-6：**006 的能力清单是静态常量、字段不全，而且右栏投影直接读 `center.module()`——与 009 的边界情况正面冲突**

**实测**：

- `packages/app/src/ai-session/capabilities.ts`：
  - `SkillCapability` 只有 `skill` / `name` / `description` / `group` / `cards`；
  - `group` 的注释明写「**取值今天没有客观来源**……是 009 的『业务分类 / 标签』落地前的**占位**」（`:111-118`）；
  - `MANIFESTS` 是**模块级常量**，今天只有两个开发工具 skill，`cards: []`（`:158-190`）。
  - 009 spec FR-001 要的「类型 / 图标 / 所有者 / 部门 / 可见范围 / 版本 / 状态 / 收藏数 / 使用次数 /
    评分 / 反馈」**都没有字段**。
- `projection.ts` 的 `projectCapabilities(manifests, module)` 只按 `module` 过滤；
  `GENERIC_MODULE` 永远算数；**不做授权过滤**（文件头注释已写明）。
- `ai-session-slot.tsx:302`：
  ```ts
  const 投影 = createMemo(() => projectCapabilities(MANIFESTS, center.module()))
  ```
  ⇒ 用户切到 `ai-assets` 模块时，右栏投影会去找 `module === "ai-assets"` 的清单；
  **今天没有这份清单**，于是四层内容会退化成「只剩通用清单」（甚至空）。
- 009 spec 的 Edge Cases 明写：「**AI 资产工作区的右栏不做指令卡投影切换**（AI 资产本身不是业务分析模块）」
  （`spec.md` Edge Cases 节）。

**后果**：这是 009 与 006 的**契约冲突**，不是 UI 细节。T006/T007/T013/T015 都会碰到右栏；
如果按现状接线，进入 AI 资产页右栏就会「换错内容」。

**停下来问**：

1. **投影键怎么定？** 建议把 `projectCapabilities` 的第二个参数从「当前 module」改成
   **显式的 `projectionModule`**：
   - 业务模块（项目 / 话单 / 资金）→ 自己的 module；
   - `ai-assets` → **保持进入前的业务模块**（或 `GENERIC_MODULE`），**不切**。
   这需要给 `AiSessionSlot` 加 prop / context，不能继续读 `center.module()`。
   是否认可？**这是 006 代码的修改**，要按「保留的定制」标注。
2. **资产服务怎么供数？** 建议：
   - T001 定契约：在 `SkillCapability` 上**加可选字段**（`id` / `type` / `icon` / `owner` / `department` /
     `visibility` / `version` / `status` / `favoriteCount` / `usageCount` / `rating` / `feedback`）；
   - T003 出 `GET /assets/capabilities?module=...`；
   - 前端**异步取数**，取不到时回退到 `MANIFESTS`（保证 009 未完成时 006 不回归）。
   **不要**把资产数据硬编码进 `MANIFESTS`（那是造数据）。
3. **`group` 怎么办？** 009 的「业务分类 / 标签」落地前，`group` 只能是占位。
   建议 T005/T006 先按资产服务的 `category` 字段分组，`group` 保留为兼容字段；
   不要在 009 里继续手填。

**影响 task**：T001 / T003 / T005 / T006 / T007 / T013 / T015；以及 006 的 `capabilities.ts` / `projection.ts` / `ai-session-slot.tsx`。

---

### 🔴 D0-7：**“7 状态机”在 spec / design 里有三种写法，T001 无法直接落 enum**

**实测**：

- `spec.md:33` / `:125`：写「7 状态机（草稿 → 审核中 → 已发布 → 迭代中 → 已下线 → 已归档）」——
  **只列了 6 个**。
- `spec.md:41-43` 的验收场景又说：「业务审核通过 → **进入待技术发布**，通知作者 + 系统管理员」。
- `2026-09-12-AI资产-design.md:122-136` 的图：草稿 → 审核中 → 已发布 → 迭代中 → 已发布 →
  已下线 → 已归档；**没有「待技术发布」节点**。
- 同文档 `:138-149` 的流转表：「审核中 + 业务审核通过 → **已发布**（经技术发布后复制到发布目录）」；
  `:176-190` 的通知表又有「**待发布 → 已发布**」。
- `tasks.md:45` T001 写「7 状态机定义」，`T008` 写「提交/审核/发布/迭代/下线/归档」——**没有枚举值**。

**后果**：T001 的第一行代码就是 enum。**六种写法会导致 T008/T009/T016 全部重做**。

**停下来问**：建议把 7 个状态定成：

```text
draft（草稿）
in_review（审核中）
pending_tech（待技术发布）
published（已发布）
iterating（迭代中）
offline（已下线）
archived（已归档）
```

- **驳回**不是第 8 个状态，而是 `in_review → draft` 的**转移事件**，带 `rejectReason`；
- 「业务审核通过」= `in_review → pending_tech`；
- 「技术发布」= `pending_tech → published`；
- 「发起迭代」= `published → iterating`，**旧版仍可用**；
- 「新版本发布」= `iterating → published`；
- 「下线」= `published → offline`；
- 「重新上线」= `offline → published`；
- 「归档」= `offline|published → archived`（终态）。

是否认可？认可后要**同步修 spec.md / design 的图与表**（它们是 Draft，不是冻结接口），
否则 T016 的测试会按旧表写。

**影响 task**：T001 / T008 / T009 / T010 / T016。

---

### 🔴 D0-8：**站内信没有后端收件箱——现有 notification 只是「本机会话提示」**

**实测**：

- `packages/app/src/context/notification.tsx:21-38` 的联合类型只有
  `TurnCompleteNotification` / `ErrorNotification`，**没有系统/资产通知类型**。
- `:55` `MAX_NOTIFICATIONS = 500`，`:240` 用 `persisted(...)` 存**本地**。
- 全仓**没有** `notification` 表、没有收件箱端点、没有「已读/未读」服务端状态。

**后果**：T010 的「状态变化推送到人」今天只能弹一个本机 toast，**换设备就丢**；
而 spec 要的是「站内信」+「🧩 资产」标签（design `:176-190`）。

**停下来问**：T010 的交付形态？

- **A（建议）**：新增 `auth.notification`（`id` / `user_id` / `type` / `asset_id` / `payload` /
  `created_at` / `read_at`），出 `GET /openhive/notifications` + `POST /openhive/notifications/:id/read`；
  前端在现有 notification store 里加一类「系统通知」，轮询拉取。
- B：只做本机通知（复用 `context/notification.tsx`），把「跨设备」挂到 010。**这会让 T010 的出参名不副实**。
- C：T010 整体移交 010 治理后台。**那 009 的生命周期就少一条闭环**。

**建议 A**，但轮询间隔、未读数上限、是否复用 `MAX_NOTIFICATIONS` 要你定。
**不要**把通知做成「发布广播给全体」——spec 明确「发布不广播」（Edge Cases）。

**影响 task**：T008 / T009 / T010。

---

### 🟡 D0-9：**「资产治理 MCP server」在本仓只有 MCP 客户端，没有 server 宿主**

**实测**：

- `packages/opencode/src/mcp/index.ts:8-18` 只 import `Client` / `StreamableHTTPClientTransport` /
  `SSEClientTransport` / `StdioClientTransport`——**全是客户端**。
- `grep -rn "McpServer" packages/opencode/src` 没有 server 实现；`@modelcontextprotocol/sdk` 在
  `packages/opencode/package.json` 里，但只用于 client。
- plan `:56` 把 `asset-governance/` 放在 `packages/opencode/src/mcp/` 下——**那是客户端模块目录**，
  把 server 放进去会让「谁是 client、谁是 server」含混。

**后果**：T012 的 `submit_skill_for_review` / `publish_skill` **没有宿主**。

**停下来问**：

- **A（建议）**：新建独立 workspace 包 `packages/asset-governance-mcp/`，用 SDK 的 `McpServer` 起
  stdio server；工具实现调用资产服务的内部 HTTP API；用户身份从 `_meta["openhive/user"]` 取
  （`mcp/openhive-identity.ts:51` 已有键名）。
- B：不做 MCP，改成 opencode 原生 tool（`packages/opencode/src/tool/asset-*.ts`）。**更简单，但偏离 spec FR-004**。
- C：T012 挂起，先用 REST 端点完成提交/发布。**T009/T016 可以不等它**。

**建议 A**，但要先定：MCP server 怎么拿到资产服务的地址与凭证？是否只允许内网？
`submit_skill_for_review` 的 capability 判定是在 MCP server 里做，还是在资产服务里做？
**建议在资产服务里做**（单一授权点，`LEARNINGS #005-24`：接在共同出口），MCP server 只传身份。

**影响 task**：T003 / T004 / T009 / T012 / T016。

---

### 🟡 D0-10：**RAGFlow / 知识库执行链今天零代码，009 到底做到哪一层？**

**实测**：

- 全仓 `grep -rni "ragflow"` 只命中 `packages/core/src/access/rbac.ts` 的注释；
  `knowledge_base` 只在 `RESOURCE_TYPES` 闭集与注释里出现（`:44` / `:111`）。
- `plan.md:15` 把 RAGFlow 列为 Primary Dependencies；`spec.md` 的 Assumptions 说
  「知识库建库粒度已确定为『按主题一个库』……知识库管理在 F10 治理后台」。
- `tasks.md` 里**没有** RAGFlow 接入 / 知识库上传 / 检索的任务；T005–T007 只是把知识库当卡片浏览。

**后果**：如果按 FR-001 做「三类资产统一元数据」，知识库在 009 只能做到**登记 + 浏览 + 授权**；
真正的「上传资料 → 建库 → 检索」不在 009。

**停下来问**：确认 009 的知识库范围：

- **A（建议）**：009 只做**元数据 + 浏览 + 授权**；知识库执行/RAGFlow 明确写进 010 的缺口表。
  T014 只管 MCP 三层，不管知识库。
- B：009 加 RAGFlow 接入（新外部依赖、本机无法验收、与「内网 docker」部署绑定）。
- C：009 先不做知识库 Tab（违反 FR-001 / FR-002）。

**建议 A**，并在 T005 的卡片上明确标「知识库（未接入执行）」，**不要**让民警以为点进去能检索。

**影响 task**：T001 / T005 / T006 / T007 / T010（通知里可能提到知识库）/ T014。

---

### 🟡 D0-11：**收藏 / 使用次数 / 评分 / 反馈都没有持久化——T011 只靠现有表做不出来**

**实测**：

- `auth` schema 没有 `favorite` / `usage` / `rating` / `feedback` 表（`migrations/` 表清单见 D0-1）。
- 006 的 `capabilities.ts` 注释把「收藏数 / 使用次数 / 评分 / 反馈」列为**没有真值来源**的字段。
- `tasks.md:65` T011 只写「授权 vs 收藏分离（收藏只影响抽屉排序）」，**没有说评分/反馈怎么办**。

**停下来问**：T011 的最小持久化面？

- **A（建议）**：只落 `auth.asset_favorite(user_id, asset_id, created_at)` + 资产表的
  `usage_count` 计数；**评分 / 反馈**进 `state.md` 缺口表，归 010。这样 T011 的「收藏只影响排序、
  不改授权」可测，且不造用不上的表。
- B：四张表一次落全（favorite / usage_event / rating / feedback）。**工作量与测试面翻倍**，
  且 009 的 UI 还没有评价/反馈入口。
- C：收藏只存本地（localStorage）。**跨设备丢失，且抽屉排序在服务端做不了**。

**建议 A**。另：T011 的「无权资产不可见」必须用**真 PG** 验（授权 + 收藏 join），
PGlite 只够验 SQL 形状。

**影响 task**：T004 / T011 / T017。

---

### 🟡 D0-12：**MCP「数据隔离四环」的服务端 RLS 不在本仓——T014 只能验到第三环**

**实测**：

- `packages/opencode/src/mcp/openhive-identity.ts:51-65`：`USER_META_KEY = "openhive/user"`，
  `userMeta()` 把当前用户 id 放进 MCP `_meta`；没有 `User.Service` 时不注入。
- 本仓**没有**任何 MCP server 的业务 PG RLS 实现；`packages/auth/src/rls.ts` 是 auth 库自己的 RLS 辅助，
  不是「MCP server 侧」的。
- `packages/opencode/src/server/openhive/access.ts` 有已知残留：`POST /mcp` 动态 server 端点未覆盖
  （文件头/注释已记）。

**后果**：FR-009 的四环是「授权 → 下发 → 连接带身份 → 服务端 RLS」。
本仓能验的是**前三环**；第四环在外部 MCP server，**本机验不了**。

**停下来问**：T014 的验收口径？

- **A（建议）**：T014 只验「授权过滤 + 下发配置 + `_meta` 身份注入」，
  RLS 以**接口契约 + 外部验收清单**交付；在 `state.md` 缺口表写明「服务端 RLS 未在本仓覆盖」。
- B：在本仓造一个**测试用 MCP server fixture**（带 RLS）做端到端；但这验的是 fixture，
  不是真实外部服务，**不能写成「RLS 已覆盖」**。
- C：T014 整体挂起，等外部 MCP server 就绪。

**建议 A + B 的 fixture 只用于「身份确实到达 server」这一条**，不冒充 RLS 覆盖。
报告里必须写「RLS 未在本仓验证」（`LEARNINGS #003-04`：实测要当场复现；`#005-18`：假绿四问）。

**影响 task**：T012 / T014 / T017。

---

### 🟡 D0-13：**009 每加一张表，都会撞上「注释 + 真 PG 表清单」两道现存测试**

**实测**：

- `comments.test.ts:39`：`expect(tables.length).toBeGreaterThanOrEqual(8)`；
  `:54`：`expect(columns.length).toBeGreaterThanOrEqual(45)`；
  `:40-41` / `:55-56`：**每张表、每一列都必须有非空中文注释，且含汉字**。
- `migrate.real-pg.test.ts:29-39`：`expect(tables).toEqual([...])` **逐字列了 9 张表**
  （`_migration` + 8 张业务表）。009 加表后**必须回来改这个数组**，否则真 PG 用例红。
- `migrate.ts:53` advisory lock `424242`；`:81-83` 只认 up 脚本、忽略 `.down.sql`；
  `:214` 回滚走 down。**新迁移必须成对提供 `0009_*.sql` / `0009_*.down.sql`**。
- `migrate.real-pg.test.ts:44` 用 `migrationVersions()` 动态读目录——**不要在测试里写死版本号**。

**后果**：这不是「顺手加个迁移」，而是**两道门会立刻变红**。如果 0008 还没提交（Step 0.4），
新 worktree 里连这两道门都没有，问题会延后暴露。

**停下来问**：

1. 先提交 0008（Step 0.4）——**建议是**。
2. 009 的新表/列**一律带中文 `COMMENT ON`**，包括状态闭集、单位、特殊语义
   （照 `0008_column_comments.sql` 的写法）。
3. `migrate.real-pg.test.ts` 的 `toEqual` 数组**按字母序**补新表；不要改成 `toContain` 逃避
   （那是把「表清单完整性」这条判据拆掉）。
4. 真 PG 验收只能跑 `PG_DATABASE=openhive_test`，且**串行**（`real-pg-test-support.ts:26` / `:40`）。
   **绝不要**把 `PG_DATABASE` 指向 `openhive` / `openhive_dev`。

**影响 task**：T001 / T002 / T003 / T004 / T008 / T009 / T011 / T016 / T017。

---

### 🟡 D0-14：**新增 `ai-assets/` 目录与新增 workspace 包，会命中三处「自有目录」清单 + 根 workspaces**

**实测**：

- `packages/app/src/openhive-module-dirs.test.ts:12`：
  `const moduleDirs = ["rail", "center", "topbar", "workspace", "project", "auth", "ai-session"]`
- `packages/app/src/workspace/design-token-refs.test.ts:46`：
  `const 自有目录 = ["rail", "center", "topbar", "workspace", "project", "auth", "ai-session"]`
- 根 `package.json:16` 的 `lint:openhive` 逐个列了 7 个目录。
- 根 `package.json:27-33` 的 workspaces 不含任何资产服务包。

**后果**：新增 `packages/app/src/ai-assets/` 后，如果只加目录、不加这三处，
`bun run lint:openhive` **扫不到**新文件；`design-token-refs.test.ts` 也**不会检查**新目录的 token 引用。
**这不叫「过了」，叫「漏扫」**（006 的 D0-7 已踩过一次）。

**停下来问**：

- 确认「**三处一起加 `ai-assets`**」这个改法（改法先报告、别自己拍）。
- 如果 D0-1 选 A（新建 `packages/asset-service`），还要把它加进根 workspaces，
  并确认 `bun run typecheck`（turbo）会覆盖它；如果选根级 `asset-service/`，
  必须手动加进 workspace 和门禁脚本，**否则它不在任何门禁里**。
- 改完后 `grep -rn "ai-session" package.json script packages/app/src/*.test.ts packages/app/src/**/*.test.ts`
  逐个打勾（`LEARNINGS #002-06`）。

**影响 task**：T005 / T006 / T007 / T015；以及 D0-1 选 A 时的所有 BE task。

---

### 🟡 D0-15：**左栏「业务分类折叠」没有分类数据源**

**实测**：

- spec FR-002 要「业务分类折叠（分类名 + 数量角标）」；
- 006 的 `SkillCapability.group` 是**手填占位**（`capabilities.ts:111-118`），不是资产分类；
- 本仓没有 `category` / `tag` 字典表，也没有 seed 数据。

**后果**：T005 的左栏会面临「分类从哪来」的问题。硬编码几个分类名 = 造业务数据；
从 `tags` 现推 = 分类会随标签漂移。

**停下来问**：建议 T001 的资产元数据带 `category`（单值）与 `tags`（数组），
分类字典先落一份**可审阅的 seed 文件**（如 `packages/asset-service/src/categories.ts`），
由你给初始分类；T005 只消费字典，不硬编码。**不要**让前端自己 `split` 标签生成导航。

**影响 task**：T001 / T005 / T006。

---

## Step 1 · Worktree 隔离

```bash
claude --worktree feat-009-ai-assets    # 基准 = 当前开发主线 multi-tenant
```

（自动按 `.worktreeinclude` 复制 `.env` / `.env.local` / `.env.development` / `.credentials.yaml`）

⚠️ **开之前先解决 Step 0.4**：0008 与 `dev_tdd.009.md` 不在 HEAD 上，新 worktree 里没有。
建议先提交，再开 worktree。

---

## Step 2 · 启动必读（每个 task 开始前）

① 先读 `D:\project\study\openhive\.specify\memory\constitution.md`，遵守其全部原则——**冲突以宪法为准**。

> ⚠️ 必须用**绝对路径**：宪法在外层工作区、不在本仓库。worktree 里写 `../.specify/memory/constitution.md`
> 会解析到 `.claude/worktrees/.specify/…`，**读不到**。
> 009 最吃重的是 **§一（最小化上游冲突）**、**§三（物理隔离）**、**§四（权限下沉执行层）**、
> **§五（质量门禁）**、**§八（前端设计系统）**、**§九（实现纪律）**。

② 读 009 自己的三份文档：

| 文档 | 读什么 |
|---|---|
| `docs/superpowers/specs/009-ai-assets/spec.md` | 6 个用户故事、FR-001…FR-010、Edge Cases、Assumptions |
| `docs/superpowers/specs/009-ai-assets/plan.md` | 文件结构、数据流、集成点、风险；**注意它多处是「计划」不是「实测」** |
| `docs/superpowers/specs/009-ai-assets/tasks.md` | 17 条 task、依赖、出参；**文件头两笔 006 移交必须读** |

③ 读权威设计依据：

| 文档 | 读什么 |
|---|---|
| `docs/superpowers/specs/2026-09-12-AI资产-design.md` | **本 feature 的正典**：§1 前端（左栏纯导航 / 中栏卡片+详情 / 收藏语义 / 元数据）、§2 生命周期（§2.1 状态机 / §2.2 流转表 / §2.3 两道关 / §2.5 物理迁移 / §2.6 通知）、§3 权限（四类 / 三级 / 授权组 / 授权 vs 收藏 / 三层拦截）、§4 MCP 差异、§5 Skill 制作、§7 待决策 |
| `docs/superpowers/specs/2026-09-06-openhive-design-v2.md` §11（L628–L760） | §11.1 统一抽象 / §11.2 三级空间+四类权限 / §11.3 角色分工 / §11.4 Skill 制作 / §11.5 生命周期+授权收藏 / §11.6 治理动作↔物理机制 / §11.7 MCP 多用户 |
| `docs/superpowers/specs/openhive-PRD.md` F9（L234–L247） | 触发、核心流程、业务规则；F10（L253）看 009 与 010 的边界 |
| `docs/superpowers/specs/openhive-DESIGN.md` | §1 Colors、§2 Typography、§3 Spacing、§4.1 三栏、§4.2 关键 UI 块、§4.5 中栏 tab；**没有资产浏览器/卡片/详情规格**（D0-3） |

④ 读 006 的交班（009 是 006 的直接下游）：

- `docs/superpowers/specs/006-ai-session/session.md` 的「交付物一览 / 已知缺口」两张表；
- `packages/app/src/ai-session/capabilities.ts` 文件头（契约的**字段来源与缺口**）；
- `packages/app/src/ai-session/projection.ts` 文件头（**不做授权过滤**的边界）；
- `docs/superpowers/specs/009-ai-assets/tasks.md:5-30` 的两笔移交：
  ① 能力清单契约要按资产服务的形状复核；② 收藏加权 / 服务端使用次数归 T011。

⑤ `tasks.md` 的 Prerequisites 只是「前置 feature 已落地」，**不是「接口已就绪」**。
开工前按 Step 0.5 重新表述：F4 只给了 RBAC 三张表和 `read` 的 allow 通道；
F8 只给了静态能力清单和右栏壳。**别把 Prerequisites 当成已验收的 API。**

⑥ 取最小依赖且未完成的 task，用 Superpowers 的 `test-driven-development` skill（RED→GREEN→REFACTOR）。

⑦ 每个 task 跑完：更新 `tasks.md` 该 task 的 checkbox → 更新 `state.md` → commit → **STOP**，等我说「next」。

⑧ 全部 task 完成后 **STOP**，等审整个 feature。

⑨ **遇到「未定」的决策点先停下来问我**（见 Step 0.5 的 D0-1…D0-15 + 文末「未定项清单」），
不要自行拍板。**非 bug 类内容（分类字典、视觉规格、通知文案）先走 `superpowers:brainstorming`，谈定再动手。**

---

## Step 3 · 任务标签执行规则

### [BE] —— 本 feature 的主战场（11 条：T001–T004、T008–T009、T011–T012、T014、T016–T017）

**🔑 落点实测（开工前先看这段，别照 plan 的目录图直接开写）**

| 要找的东西 | 真身 | 说明 |
|---|---|---|
| **迁移入口** | `packages/auth/src/migrate.ts`（`MIGRATIONS_DIR = join(import.meta.dir, "migrations")`，`:6`） | 新迁移放 `packages/auth/src/migrations/0009_*.sql`；必须成对 `.down.sql` |
| **迁移锁 / 记账** | `migrate.ts:53`（advisory lock `424242`）、`auth._migration` | 不要另造 runner |
| **RBAC 读函数** | `packages/auth/src/rbac.ts`（`grantsFor`） | 只有读；review/admin 的写入口要新增 |
| **RBAC 规则投影** | `packages/core/src/access/rbac.ts`（`resolve()` `:169`） | 默认**不改**；只有 D0-4 选 B 才动 |
| **权限投影到会话** | `packages/opencode/src/server/openhive/access.ts`（`capabilityFor`） | 已有 grants → sessionRuleset；review/admin 不走这里 |
| **身份注入** | `packages/opencode/src/server/routes/instance/httpapi/middleware/user-identity.ts:71-78` | 验签后提供 `User.Service` + `DatabaseConnectionRouting.Hook` |
| **MCP 身份** | `packages/opencode/src/mcp/openhive-identity.ts:51-65` | `_meta["openhive/user"]`；没有身份不注入 |
| **MCP 客户端** | `packages/opencode/src/mcp/index.ts:8-18` | **只有 client**；D0-9 要 server 得另建包 |
| **路由模式** | `packages/opencode/src/server/openhive/project.ts`（文件头） + `server.ts:335-391` | `PREFIX` + `PATH` + `HttpRouter.use` + `Layer.mergeAll`；**不改上游 `api.ts`** |
| **路由挂载点** | `server.ts:303-391`（`defaultBackupRoutes` / `createRoutes` 的 `Layer.mergeAll`） | 新资产路由加在这里；这是**唯一不可避免的侵入行**，要标注「保留的定制」 |
| **PG 客户端** | `packages/opencode/src/server/openhive/pg.ts`（`OpenhivePg.layer`） | 005/006 已用；资产服务复用同一个实例，别每处 new |
| **沙箱根** | `packages/auth/src/workspace.ts:13` / `:108` | `OPENHIVE_WORKSPACE_ROOT`；**没有 assets root**（D0-2） |
| **skill 发现** | `packages/opencode/src/skill/index.ts:211-225` | 只认 `cfg.skills.paths` / `urls`；没有按用户拼路径（D0-5） |
| **skill 提示词** | `packages/opencode/src/session/system.ts:114-133` | 只做「工具禁用 → 清单清空」；**单个无权 skill 仍会列出**（D0-5） |
| **skill 执行鉴权** | `packages/opencode/src/tool/skill.ts` | `ask({ permission: "skill", patterns: [name] })`；已有，别绕过 |
| **真 PG 夹具** | `packages/auth/src/real-pg-test-support.ts` | `OPENHIVE_TEST_PG=1` + `_test` 库 + 串行 |
| **PGlite 夹具** | `packages/auth/src/test-support.ts` / `migrate.test.ts` | 单元测试默认走 PGlite；快，但不验 RLS/并发 |

**🔴 BE 测试纪律**

- **纯逻辑 / SQL 形状**：`cd packages/auth && bun test`（PGlite）。
- **迁移 / 注释 / 真 PG**：`cd packages/auth && OPENHIVE_TEST_PG=1 PG_DATABASE=openhive_test bun run test:real-pg`。
  ⚠️ **`PG_DATABASE` 必须以 `_test` 结尾**；`withRealPg()` 会 `DROP SCHEMA auth CASCADE`
  （`real-pg-test-support.ts:26` / `:42`）。**绝不要**指向 `openhive` / `openhive_dev`。
- **路由**：`cd packages/opencode && bun test` 里已有 005/006 的路由测试模式
  （`openhive-*.test.ts`）；新资产路由照同一 harness 写，**不要**只测 handler 不测 HTTP。
- **`bun run test:httpapi`**：如果新增了 HTTP 端点，先跑一次看 `--fail-on-missing` 是否要求补文档；
  需要补就补，**不要**用 `--no-fail` 绕过。
- **不 mock 数据库**：资产状态机/权限的核心判据一律走 PGlite 或真 PG。
  Mock 掉 DB 等于没测（`LEARNINGS #002-02`）。
- **迁移测试**：`comments.test.ts` 与 `migrate.real-pg.test.ts` 是**现成的门**；
  新表/列必须带中文 `COMMENT ON`，并把新表补进 `migrate.real-pg.test.ts:29-39` 的 `toEqual`。

**🔴 BE 专属红线**

- **资产服务拥有目录/复制/状态**：内核**不建目录、不复制、不懂待审/发布**（plan `:138`）。
  如果发现要改 `packages/opencode/src/skill/index.ts` 去建目录，先停下来——那是边界破了。
- **权限只在执行层收口**：`read` 影响可见性，`write/review/admin` 影响操作；
  **不要**用前端隐藏代替授权（宪法 §四 / Anti-Patterns）。
- **所有出口都要重放鉴权**（`LEARNINGS #005-24` / `#004-01`）：T009 的「提交/审核/发布/驳回/下线/归档」
  是多个出口；每个出口都要有 review/admin 判定，不能只在「提交」上做。
- **文件操作幂等**（`LEARNINGS #007-01`）：复制/删除/rename 的每一步幂等 ≠ 整体可重入；
  要测「中途失败后重试」。
- **两个存储两个读者**（`LEARNINGS #007-02`）：资产元数据在 PG、文件在 `/assets`；
  任何「先写 PG 再写文件」的地方都要定「谁是真源、失败了谁回滚」。
- **异步后重读上下文**（`LEARNINGS #008-03`）：资产操作里 `await` 之后如果要读「当前用户/当前部门」，
  必须在链首捕获 id，await 后重验，别读旧值。
- **Windows 路径**：`resolve` ≠ 同形（`#006-23`）；不要走 PowerShell（`#003-07`）。
- **`catch {}` 是盲区**（`#006-28`）：文件操作的失败必须可观测，不能吞。

---

### [FE·新增] —— 4 条（T005–T007、T015）

**🔑 落点实测**

| 要找的东西 | 真身 | 说明 |
|---|---|---|
| 图标栏入口 | `packages/app/src/rail/entries.ts:56` | 已有 `ai-assets`，**只切 module** |
| 左栏分支 | `packages/app/src/workspace/workspace-entry.tsx:262` / `:1653-1654` | 今天只有 `project`；要加 `ai-assets` |
| 中栏容器 | `packages/app/src/center/center-content.tsx:125-208` | 文件 tab / route page（`children`）/ empty 三态；**没有模块级资产页** |
| 视图注册表 | `packages/app/src/center/views/index.ts` | 只按扩展名；**不要**把资产塞进文件视图 |
| tab 模型 | `packages/app/src/center/tab-store.ts:2-13` / `switchModule` `:119` | `ContentTab` 有 `path`；资产详情**不要**硬塞 |
| 页面接线 | `packages/app/src/pages/layout-new.tsx`（`right` / `sessions` / `routePageVisible`） | 资产页若走 route page，从这里接 |
| 卡片组件 | `packages/ui/src/components/card.tsx` | 已有 Card；先复用，别再造一套 |
| 虚拟滚动 | `@tanstack/solid-virtual`（`packages/app/package.json` 已有） | T006 用；不要引入新库 |
| 模糊搜索 | `fuzzysort`（已有） | T006 用；不要引入新搜索库 |
| 右栏输入框 | `packages/app/src/ai-session/ai-session-slot.tsx` | T015 要把「▶ 执行此 skill」的指令填进去；**需要跨组件契约**（D0-6） |
| token 第二层守卫 | `packages/app/src/workspace/design-token-refs.test.ts:46` | 新目录要加进去，否则漏扫（D0-14） |
| 模块目录守卫 | `packages/app/src/openhive-module-dirs.test.ts:12` | 同上 |
| lint 目录 | 根 `package.json:16` 的 `lint:openhive` | 同上 |

**🔴 宪法 §八 红线（NON-NEGOTIABLE）**

- **SolidJS 换皮 / 新增，MUST NOT 用 React 自研**；`front` 的 `ResourceMarketplace` **不在本仓库**，
  只可能是视觉参考，不能搬代码（D0-3）。
- **视觉值一律走 token，禁硬编码**——`openhive/no-raw-color` 门（`bun run lint:openhive`）是 **warn 级**，
  **退出码恒为 0**；「门绿」不等于「没硬编码」。要**读代码**核对。
- **绝不动生成物**：`packages/ui/src/v2/styles/colors.css`（`script/tailwind.ts` 生成）、
  `packages/ui/src/theme/themes/oc-2.json`。
- **不启用暗色模式、仅中文、桌面宽屏**（宪法 §八）。
- **薄界面 + 厚 skill**：资产浏览器只做「浏览 + 操作」，**MUST NOT 内置分析逻辑**。
- **不新增依赖**：虚拟滚动、搜索、卡片都有现成的；加库先问。

**🟡 前端测试今天能测什么**

| 手段 | 命令 / 落点 | 实测约束 |
|---|---|---|
| 纯逻辑单测 | `cd packages/app && bun run test:unit`（`.test.ts`，`--conditions=solid`） | **不收 `.test.tsx`**（脚本带 `--path-ignore-patterns="**/*.test.tsx"`） |
| 组件渲染测试 | `cd packages/app && bun run test:components`（`.test.tsx`，`--conditions=browser` + `happydom.ts` + `solid-jsx.ts`） | happy-dom **无 CSS 引擎** ⇒ 量不出几何/颜色，只能钉 `className` 字符串与结构不变量 |
| 浏览器层单测 | `cd packages/app && bun run test:browser`（`./test-browser`） | 真浏览器；虚拟滚动/几何只能在这一层验 |
| E2E | `cd packages/app && bun run test:e2e`（playwright） | 慢；T005–T007 的交互可放这一层 |
| 视觉契约门 | 根目录 `bun run lint:openhive` | 只扫 7 个自有目录（D0-14：新目录不在里面就漏扫） |
| token 名字完整性 | 随 `test:unit` 自动跑（`design-token-refs.test.ts`） | 只证名字存在 |
| 类型 | `cd packages/app && bun run typecheck`（`tsgo -b`） | |

**🔴 三条 happy-dom 铁律（005/006 换来的，直接抄）**

1. **`.toBeNull()` 的实得值必须是原语**——断在布尔上；把 Solid 节点当实得值，红了会把整轮 `bun test` 挂死
   （`LEARNINGS #005-01`）。
2. **视觉约定只能钉 `className` 字符串**，且**一个约定落在 N 处就写 N 条断言 + 一条对照**
   （`LEARNINGS #005-07`）。
3. **`mount()` 要记账 + `afterEach` 先卸载再清 `document.body`**（顺序要紧，`LEARNINGS #005-03`）。

**🔴 T015 的专属问题：详情页怎么把指令送进右栏？**

右栏 `AiSessionSlot` 的输入框是内部状态，详情页在**中栏**。今天没有「中栏 → 右栏填一句话」的通道。
建议先定契约（D0-6 一起裁定）：

- 方案 A：在 `layout-new.tsx` 层建一个 `AssetExecutionRequest` signal/context，
  `asset-detail` 写入，`AiSessionSlot` 读取并填入；
- 方案 B：用现有 event bus / custom event；
- 方案 C：右栏暴露一个 `fillPrompt(text)` 的 context 方法。

**不要**直接 DOM 查询右栏 textarea（跨组件、不可测、易随上游改）。T015 开工前先定 A/B/C。

---

### [INT] —— 2 条（T010、T013）

**T010 站内信通知**：后端 + 前端都要动。

- 后端：`auth.notification` 表 + 两个端点（列表 / 已读）；状态机在 T008/T009 的转移点调用 `notify.ts`。
- 前端：现有 `context/notification.tsx` 只认 `TurnComplete` / `Error`；要加「系统通知 / 🧩 资产」类型，
  并决定轮询还是 SSE。
- 判据：状态变化 → 目标用户**换设备登录**仍能看到未读（真 PG / 服务端状态），
  不能只测本机 toast。
- ⚠️ 通知是**副作用**，必须放在状态转移成功之后（`LEARNINGS #004-09`：门在副作用之前）。
  通知失败**不能回滚**已完成的发布；要记录可重试。

**T013 Skill 制作入口**：右栏 AI 对话生成 skill 落沙箱。

- 现有地基：右栏能提交 prompt（`ai-session-slot.tsx` / `submit-prompt.ts`），opencode 能写文件；
  **没有**「生成 skill」专用入口，spec 说「无需专门入口」。
- 要定：AI 写到哪里（作者沙箱 `/workspaces/{authorId}/{project}/`？项目内 `skills/`？）；
  生成后如何被 skill 发现（`SKILL.md` 命名/位置）；是否需要模板。
- 测试：按 004/005 的假模型 harness，**假模型要回真 SSE**，不要把「AI 执行」整段 mock 掉；
  断言产物是**沙箱里的真实文件**，不是内存字符串。
- ⚠️ 这是「自然语言生成代码/文档」的入口，**prompt injection / 路径穿越**要防：
  生成的文件路径必须在作者沙箱内（`resolve` 后做前缀校验，`LEARNINGS #006-23`）。

---

### 跨标签的公共纪律

- **先写会红的用例**：T001 的状态机、T004 的权限、T008 的流转、T011 的收藏分离，
  都必须先有一条红用例（`superpowers:test-driven-development`）。
- **变异验证**：修好后把修复拆掉，用例必须红；按 `LEARNINGS #003-03` 三类据实记。
- **grep 全部同类落点**：权限出口、状态转移出口、目录清单、迁移表清单，都要列清单逐个打勾
  （`#002-06` / `#004-01`）。
- **不谎称改了**：报告只写跑过的命令与**实际输出**；没跑的、跑不动的，明说没跑。
- **不把测不了的写成已覆盖**：RAGFlow、服务端 RLS、真模型、真 MinIO 等本机验不了的，
  写进缺口表（`#002-02`）。

---

## Step 4 · 质量门禁（宪法第五章，审查前先过）

**受影响 package（按实际改动逐个跑，不要只跑 app）**

| package | 何时跑 | 命令 |
|---|---|---|
| `packages/auth` | 任何迁移 / RBAC / 真 PG 改动 | `cd packages/auth && bun test`；真 PG 另跑 `OPENHIVE_TEST_PG=1 PG_DATABASE=openhive_test bun run test:real-pg` |
| `packages/opencode` | 资产路由 / skill 发现 / 提示词过滤 / MCP | `cd packages/opencode && bun test`；新增端点再跑 `bun run test:httpapi` |
| `packages/core` | 只有 D0-4 选 B（改 `resolve`）才跑 | `cd packages/core && bun test` + `bun run typecheck` |
| `packages/app` | T005–T007 / T015 | `bun run test:unit`、`test:components`、必要时 `test:browser`、`bun run typecheck` |
| `packages/asset-service`（若 D0-1 选 A） | 新包 | 在包内 `bun test` / `bun run typecheck`；并确认根 turbo 覆盖 |

**统一门禁**

- **禁止根目录 `bun test`**（根脚本强制 `exit 1`）。
- **`cd packages/app && bun run test:components`**：`.test.tsx` 进不了 `test:unit`（脚本带
  `--path-ignore-patterns="**/*.test.tsx"`），**漏跑 = 白写**。统一加前缀
  `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`。
- **`bun run lint:openhive` 退出码 0**。⚠️ 门是 **warn 级 ⇒ 退出码恒为 0**；存量 warning 是基线，
  **开工时自己跑一次、把真实数字落进 `009/state.md` 再引用**（`LEARNINGS #001-02` / `#003-04`）。
  **本 feature 的专属动作**：先把 `ai-assets` 加进三处清单（D0-14），否则扫不到新文件。
- **`bun run lint` 只判「本次新增/改动文件 0 命中」**：全局有已登记的上游 error，全局退出码可能恒为 1；
  不要为它改上游代码，也不要拿它当阻断。单文件 lint **在仓库根**跑
  （`bunx oxlint packages/...`），在包目录里跑会配置解析失败（`LEARNINGS #004-10`）。
- **`bun run typecheck`（turbo）退出码 0**；前端另有 `cd packages/app && bun run typecheck`（`tsgo -b`）。
- **门禁串行跑，别并行**：同机并行会造假红（`LEARNINGS #003-01`）。看到红先串行复跑一次再当结论。
- **不得用「替身 / mock」把被测对象换掉**（`LEARNINGS #002-02`）。AI 侧尤其：假模型要回真 SSE。
- **`bun install` 之后必查 `git diff --stat bun.lock`**：本机 `~/.npmrc` 指向镜像源，跑一次会污染
  3000+ 行；应为空或只剩有意新增的依赖。被污染就 `git checkout -- bun.lock`
  （`CLAUDE.md` 的「锁文件污染」一节）。
- **迁移门**：新表/列必须有中文 `COMMENT ON`；`migrate.real-pg.test.ts:29-39` 的表清单要更新；
  `migrate.ts` 的 `--> statement-breakpoint` 不能漏（`#005-31`：漏 `*/` 会静默吞用例，同理漏 breakpoint 会静默合并语句）。
- **报告门禁实得输出**：失败数、跳过数、警告数都要写，不能只写「全绿」。

---

## Step 5 · 代码审查（用 Superpowers 的 `requesting-code-review` skill）

质量门禁过 + 全部 task 绿后触发审查，至少覆盖以下 8 类：

① **资产服务 ⇄ 内核边界（本 feature 头号风险）**
> - 内核有没有建目录 / 复制 / 懂待审与发布？plan `:138` 说「不」。
> - 资产服务有没有反向 import `packages/opencode` 的内部模块？依赖方向要单向。
> - 元数据真源在哪（PG）？文件真源在哪（`/assets`）？两边不一致时谁赢？（`LEARNINGS #007-02`）

② **权限与鉴权（第一等公民）**
> - `read` / `write` / `review` / `admin` 四类动作，每类**各自的出口**在哪？逐个打勾。
> - 「无权资产不可见」在资产服务里怎么过滤？`knowledge_base` 没有工具映射，是否只做可见性？
> - skill 执行是否仍过 `tool/skill.ts` 的 `ask`？提示词清单是否过滤了无权 skill（D0-5）？
> - 有没有用前端隐藏代替后端授权？（宪法 §四 / Anti-Patterns）

③ **生命周期正确性**
> - 7 个状态是否与 D0-7 的裁定一致？驳回是否回 `draft` 且带理由？
> - 「业务审核通过」是否只到 `pending_tech`，**不是**直接 `published`？
> - 「迭代中」旧版是否仍可用？新版本发布是否替换旧版而不留残文件？
> - 归档是否终态？已归档还能不能改？
> - 每次转移是否写审计（谁、何时、从哪到哪、理由）？

④ **存储与文件操作**
> - 复制/rename/删旧是否幂等？中途失败会不会留下半成品？
> - 跨卷 rename 是否退化成复制？Windows 路径是否同形？（`#006-23`）
> - 并发「提交审核」/「发布」是否会互相覆盖？（`#007-01`）
> - 删除资产时，`/assets` 文件、PG 元数据、收藏、通知是否一致？

⑤ **上游侵入面**
> - 新增文件 vs 修改上游文件，逐个列出来。
> - `server.ts` 的路由挂载是否只有一行？是否标注「保留的定制 · 同步上游时不要丢」？
> - 是否动了 `sql.ts` / `colors.css` / `oc-2.json` / 上游高频文件？
> - `session/system.ts` 的提示词过滤（若 D0-5 选 A）是否单独提交、单独标注？
> - 新增 `packages/asset-service` / `packages/asset-governance-mcp` 是否进了 workspace 与门禁？

⑥ **前端一致性与视觉**
> - SolidJS，不是 React；没有搬 `front` 代码（`front` 不在本仓库）。
> - 视觉值是否走 token？有没有硬编码颜色/圆角/字号？（lint 是 warn 级，必须读代码）
> - 是否手改生成物？
> - 是否仅中文、无暗色、桌面宽屏？
> - 薄界面 + 厚 skill：资产浏览器里有没有混进业务判断？
> - 卡片/选中态/悬停态的约定，是否每处都钉了 `className` 断言 + 对照（`LEARNINGS #005-07`）？
> - 虚拟滚动是否真的只渲染可视区？搜索是否跨类型/跨分类？

⑦ **006 契约**
> - `SkillCapability` 加字段是否可选、向后兼容？
> - `projectCapabilities` 的投影键是否已从 `center.module()` 改为显式 `projectionModule`（D0-6）？
> - 进入 AI 资产页右栏是否**不切换**投影（spec Edge Cases）？
> - 资产服务取不到数时是否回退到静态 `MANIFESTS`，006 不回归？

⑧ **测试诚实性**
> - 有没有 mock 掉 DB / AI / 文件系统，导致核心判据没被测？
> - 真 PG 用例是否只在 `_test` 库跑？是否串行？
> - 迁移表清单是否更新？中文注释是否补全？
> - RAGFlow / 服务端 RLS / 真模型等本机验不了的，是否如实写进缺口表？
> - 变异验证做了没有？拆掉修复后哪条用例红？

审查报告用 `receiving-code-review` skill 消化，格式：
`| 编号 | 类别 | 文件:行 | 描述 | 修复优先级 |`

**0 个缺陷** → 进 Step 6；**有缺陷** → 回到对应 task 走 TDD 修复，重新审查，直到 0 缺陷。

> 📌 **`LEARNINGS #003-02` / `#005-04`：第一轮修完之后，把「修复本身」再当靶子打一轮。**
> 「修完」不等于「审完」——第二轮别用第一套视角，否则只会复述第一轮结论。
> 判据：说「已修 / 已统一」**之前**先 `grep` 出**全部同类落点**、逐个打勾
> （落点来源必须是**被改的那一侧**，不是「我记得改了几处」）。

---

## Step 6 · 收尾

1. 最终 commit，message 含 `Closes 009-ai-assets`。
2. **merge 回开发主线**：⚠️ **这一步做不了，交给我**——`multi-tenant` 已在主检出被 checkout
   （一个分支不能 checkout 两次），且隔离会话对共享检出的 git 操作会被拦。
   你只做 final commit，然后把 `git merge --ff-only worktree-feat-009-ai-assets` 给我，
   **我在主检出执行**。
3. `git tag v0.1.0-009-ai-assets`（沿用 002–006 带编号的形式）。
   ⚠️ **tag 不由你打**——它与 merge 配套，**由我在主线合入之后执行**；
   tag 必须指向最终状态（含补测提交）。
4. 更新 `docs/superpowers/specs/009-ai-assets/session.md` / `state.md`：
   - 当前任务、已完成、阻塞项、最后更新；
   - **缺口表**逐笔写「谁接、接在哪张表/哪个 feature」。
5. `specs/009-ai-assets/` **永不删除**（下一个 feature 的上下文）。
6. **更新 010 的前置/缺口**：009 没做的（RAGFlow、知识库执行、评分/反馈、服务端 RLS、
   组织架构 ID）写进 `010` 的 `tasks.md` 或 `state.md`，不能只留在 009 的聊天里。
7. 报告：**共 17 个 task（11 BE / 4 FE / 2 INT）** / 审查发现 X 个缺陷已全部修复 /
   门禁基线数字（含失败数、跳过数、warning 数）/ 本机验不了的清单。
8. **把 `LEARNINGS.md` 补上**（1–5 条，加在最顶部，不值得记的宁可不写）。
   **可预期的素材**：
   - 「复用 F4 RBAC」在四份 plan 里被互相抄，但表里没有 `role_type` / review-admin 载体；
   - 「复用 F8 指令卡」实际是静态常量 + 未接入资产服务；
   - `/assets` 共享卷在 plan 里是既定事实，代码里零命中；
   - 「7 状态」在 spec / design 里有三种写法；
   - 资产服务与内核的边界，靠一句「内核只被动扫描」撑不住，要有 prompt 过滤。

---

## 节奏铁律

- **逐 task 停**：每个 task commit 后 STOP 等「next」确认（服从宪法第九章）。
- **一个 feature 跑完停下来等审**，再下一个。
- **严禁多 agent 并发跑多个 feature。**
- **本 feature 额外四条**：
  1. **未裁定 D0 前不动代码**。009 的前八条 D0 每一条都会改变 task 归属；
     照 plan 直接开写，返工面比 006 大。
  2. **每个 task 开工前回头核一遍 Step 0.5 还有没有活的**，并固定那个习惯：
     **动第一行代码之前，先问「这条 task 的出参，今天在仓库里打得到吗？」**
  3. **完成判据先声明**：每条 task 开工前说清「什么命令跑出什么结果算完成」，你认可再动手。
  4. **非 bug 类（分类字典、视觉规格、通知文案）先走 `superpowers:brainstorming`**，
     谈定再动手；不要先斩后奏。

---

## 未定项清单（**开工前先裁定**）

| # | 事项 | 今天的事实（已实测） | 需要你定什么 |
|---|---|---|---|
| **U1** | **资产服务与元数据落在哪**（D0-1） | `asset-service/` 不存在；根 `services/` 只有上游四个；`asset-service/` 不在 workspaces；`auth` schema 没有资产表 | 新建 `packages/asset-service`（建议）／根级 `asset-service/`／塞进 `packages/opencode`／元数据放 `auth` + HTTP 放 opencode。**T001/T003/T004 全押在这条上** |
| **U2** | **`/assets` 与开发机 fallback**（D0-2） | `workspace.ts` 只有 workspace/shared 两个根；Dockerfile 只拷二进制；代码零 `/assets` | 新增 `OPENHIVE_ASSETS_ROOT`？生产默认 `/assets`、开发指到 `D:\openhive-stack-state\assets`？T002 只出文档还是同时落 helper？ |
| **U3** | **资产浏览器的挂载方式**（D0-3） | 左栏只认 `project`；中栏只认文件 tab / route page；`ContentTab` 有 `path`；DESIGN 无资产规格；`figma-export/` / `front/` 不存在 | 左栏加 module 分支／中栏走模块级页面还是 route page／详情用页面内状态还是 tab／视觉规格谁来补 |
| **U4** | **RBAC 扩展与两道审核的 actor**（D0-4） | `role` 只有 id/name；`role_resource` 有 perm 闭集但 `resolve()` 只产 read；`is_admin` 一个布尔；org/dept/section 是 free text | 加 `role_type ('normal','group')`？业务审核=`review` grant、技术发布=`admin` grant？三级空间用 `visibility` + `owner_dept`？部门先沿用 free text？ |
| **U5** | **skill 分发模型**（D0-5） | `skills.paths` 是实例级；没有按用户拼路径；`session/system.ts` 只做工具禁用时清空 | 全局扫所有资产 + 提示词/执行过滤（建议）／每用户目录 + config 注入／资产服务出清单 + 内核新接口。**要改上游 `session/system.ts` 的话，单独提交** |
| **U6** | **006 契约与右栏投影**（D0-6） | `SkillCapability` 字段不全；`group` 是占位；`MANIFESTS` 静态；`ai-session-slot.tsx:302` 读 `center.module()`；spec 要求 AI 资产页不切投影 | 加可选字段 + 异步供数 + 静态回退？投影键改成显式 `projectionModule`？进入 `ai-assets` 时保持哪个模块？ |
| **U7** | **7 状态机的 enum**（D0-7） | spec 说 7 个但只列 6 个；design 图没有「待技术发布」；流转表写「审核中→已发布」；通知表写「待发布→已发布」 | 是否认可 `draft / in_review / pending_tech / published / iterating / offline / archived`？驳回作为转移事件？认可后同步修 spec/design |
| **U8** | **站内信形态**（D0-8） | 只有本机 `TurnComplete` / `Error`；无后端收件箱；`MAX_NOTIFICATIONS=500` | 新增 `auth.notification` + 列表/已读端点（建议）／只做本机／整体移交 010。轮询还是 SSE？ |
| **U9** | **资产治理 MCP server 的宿主**（D0-9） | `mcp/index.ts` 只有 client；无 `McpServer`；plan 把 server 放进 client 目录 | 独立 `packages/asset-governance-mcp`（建议）／改成原生 tool／T012 挂起。能力判定放资产服务还是 MCP server？ |
| **U10** | **知识库范围**（D0-10） | 全仓无 RAGFlow；`knowledge_base` 只有权限闭集；tasks 无接入任务 | 009 只做元数据+浏览+授权，执行归 010（建议）／现在接 RAGFlow／先不做知识库 Tab |
| **U11** | **收藏/使用/评分/反馈的持久化**（D0-11） | `auth` 无相关表；006 注释说这些字段无真值来源；T011 只写收藏排序 | 只落 `asset_favorite` + `usage_count`（建议）／四张表全落／收藏只存本地 |
| **U12** | **MCP 数据隔离四环的验收口径**（D0-12） | `_meta["openhive/user"]` 已注入；本仓无服务端 RLS；`POST /mcp` 有已知残留 | 只验前三环 + 外部 RLS 契约（建议）／本仓 fixture 端到端／T014 挂起。**不能把 fixture 写成「RLS 已覆盖」** |
| **U13** | **0008 与 009 迁移的先后**（D0-13） | 0008 一组 7 个文件未提交；`comments.test.ts` / `migrate.real-pg.test.ts` 是现成门 | 先提交 0008 再开 worktree（建议）／混进 009／不带 0008。新表是否都放 `auth` schema、都写中文注释？ |
| **U14** | **三处目录清单 + workspace**（D0-14） | `openhive-module-dirs.test.ts:12` / `design-token-refs.test.ts:46` / `package.json:16`；workspaces 不含资产包 | 三处一起加 `ai-assets`（建议）；新资产包加进 workspaces（建议）。改法先报告 |
| **U15** | **业务分类字典**（D0-15） | 006 的 `group` 是占位；无 category/tag 表；无 seed | T001 带 `category` + `tags`，先落一份可审阅的分类 seed（建议）；初始分类由你给 |
