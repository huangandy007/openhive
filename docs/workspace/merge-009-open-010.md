# 主检出操作提示词 · 合并 009-ai-assets ＋ 开 010-governance-console

> **一次性 runbook**（2026-10-25 写于 009 工作台）。做完即失效，留在 `docs/workspace/` 备查。
> 本文件**不是** 010 的实现提示词——010 的规格五件套已在仓库里，见 **Step F5**。
> 本文件是交给**主检出会话**的一段操作指令，对应 SOP [`feature-delivery-sop.md`](./feature-delivery-sop.md)
> 的 **Phase 6（合并 + tag）** 与 **Phase 0/1（开下一个工作台）**。
>
> ⚠️ 本文件是在 009 工作台里写的，**要等合并完成后才会出现在主检出**——所以下面 §0.0 的提示词里给的是
> **工作台的绝对路径**。
>
> ℹ️ 命名说明：前三次都是 `merge-<本格>-open-<下一格>`（004→005、005→006、006→007）。
> 本次是 **009 合并 + 开 010**，故文件名是 `merge-009-open-010.md`。

## 0.0 · 给主检出会话的提示词（复制这个代码块，粘贴到新会话）

> 用法：在**主检出** `D:\project\study\openhive\openhive` 下开新会话，把下面代码块整段粘进去。
> 它只做一件事——让新会话**先读本文件、再照本文件办事**；所有判据、红线、报告格式都在下面各 Step 里，
> 提示词不重复它们（`LEARNINGS #002-06`：同一件事不写两份，免得漂）。
>
> ⚠️ 路径说明：合并**完成前**，主检出的 `docs/workspace/` 里还没有本文件（它只存在于 009 分支），
> 所以第一行给的是**工作台绝对路径**——合并后该路径依然有效（文件已进主检出）；
> 那时换用主检出相对路径 `docs/workspace/merge-009-open-010.md` 亦可。

```
【任务】在主检出 D:\project\study\openhive\openhive 执行「009 合并 + 010 开台」。

第一步：先读完整 runbook，再动手：

  D:\project\study\openhive\openhive\.claude\worktrees\feat-009-ai-assets\docs\workspace\merge-009-open-010.md

然后照它 Step A → Step G 逐步执行，每一步达标才走下一步：

  A 合并前体检（站位 / 工作区干净 / ff-only 可行性 / 记录取数）
  B 在【multi-tenant】分支上 git merge --ff-only worktree-feat-009-ai-assets
  B1 合并后在主检出补依赖（009 新增 workspace 包 packages/asset-service，主检出没有它的链接）
  C git push origin multi-tenant
  D git tag -a v0.1.0-009-ai-assets -m "009-ai-assets 收尾（资产统一元数据 + 7 状态生命周期 + 治理 MCP + 前端三栏；缺口表见 test-gaps.md）"
    然后 git push origin v0.1.0-009-ai-assets
  E 合并后验证（逐条给结论）
  F claude --worktree feat-010-governance-console；进去验基点、bun install --frozen-lockfile
  G 按固定格式报告

红线（runbook §1，本次没有任何例外）：
- 任何一步不达判据 ⇒ 停下来报告，不要「想办法让它过」。
- 全程禁止：--force / -f / -X / --no-ff / reset --hard / rebase / checkout -- / clean / stash / --no-verify。
  （唯一允许的 `checkout --` 是 B1/C1/F4 里还原 `bun.lock` 的那一条，且仅当它出现【镜像源污染】时。）
- 本次不写任何产品码、不改任何文件；不做任何 git add（不预期需要），更不许 git add .。
- ⚠️ bun.lock 在本次合并里是【真实改动】（新增 packages/asset-service workspace），
  别把它当污染还原掉；判据见 B1。
- git push 会触发 .husky/pre-push 的 bun typecheck，红了按 runbook Step C1 的顺序诊断
  （先做 node_modules 软链接差集，别照回声改业务代码），绝不 --no-verify 绕过。
- 不把 upstream 掺进来；不动 oh-mut 那条 prunable 工作台、不动 007 与 file-archive-download 的
  工作台/分支、不跑 git worktree prune。
- 不删任何历史工作台与分支；specs 目录永不删除。
- ⚠️ 合并落点分支必须显式是 multi-tenant（runbook A1 ＋ Step B 两处点名，别靠上下文猜）。

最后按 runbook Step G 的固定格式汇报。
```

---

## 0 · 你在哪儿、这件事是什么

- 你在**主检出** `D:\project\study\openhive\openhive`（不是 `.claude\worktrees\` 下的隔离副本）。
- 主检出就是 SOP §1 里「主检出」那张桌子：**分支恒为 `multi-tenant`，只做合并与打 tag**。
- 本次**只做三件事，不写任何产品码**：

| # | 目标 | 判据（唯一权威） |
|---|---|---|
| 1 | 009 进 `multi-tenant` | `git merge-base --is-ancestor worktree-feat-009-ai-assets multi-tenant` 退出码 **0** |
| 2 | 主线与 tag 进 `origin` | `git ls-remote origin refs/heads/multi-tenant refs/tags/v0.1.0-009-ai-assets` 两条都在 |
| 3 | 010 工作台开出来 | 新工作台内 `git merge-base --is-ancestor multi-tenant HEAD` 退出码 **0** |

### 009 这一次是什么

「AI 资产」：把 **Skill / MCP / 知识库**统一抽象成「资产」，一套元数据、一套权限、一套生命周期
（7 状态机）；新建 **workspace 包 `packages/asset-service`**；前端新增 `ai-assets/` 三栏（左栏导航 /
中栏网格 / 详情四 Tab）；治理走 **MCP server 三个工具**；收尾补了真 PG / 真并发 / stdio 真进程
**结构性缺口补测**，并修掉一个**并发发布的真缺陷**（详见 `docs/superpowers/specs/009-ai-assets/test-gaps.md`）。

### 与上一份 runbook（`merge-006-open-007.md`）的四处实质差别

先知道这四条，执行时就不会误判：

1. **本 feature 的 tag 尚不存在。** `v0.1.0-009-ai-assets` 实测**零命中**（2026-10-25，
   `git tag -l 'v0.1.0-*'` 回 `platform-foundation / 002 / 003 / 004 / 005 / 006 / beta1..3`，
   **007 与 008 都没有 tag**）⇒ 合并后**新建**即可，**全程不需要 `git tag -f`**——红线里没有例外。

2. **本次合并里有【真实】的 `bun.lock` 改动，而且主检出缺新 workspace 的链接。**
   009 新增了 `packages/asset-service`（`packages/app` 也新增了对它的 `workspace:*` 依赖），
   ⇒ diff 里 `bun.lock` 出现 `M` **是对的**，不许当镜像源污染还原。
   与之配套：主检出今天**没有** `packages/app/node_modules/@opencode-ai/asset-service` 这条链接
   （2026-10-25 实测 `ls -la` 报 No such file），所以 **Step B1 必须先 `bun install --frozen-lockfile`**，
   否则 Step C 的 pre-push typecheck 会因为「找不到 @opencode-ai/asset-service」而成片报红，
   而那**不是**业务代码坏了（`#003-06`：先做差集，再改代码）。

3. **本次没有下一格的 `dev_tdd.010.md`。** 前两次的收尾 tag 里内含下一格的 dev_tdd；
   009 的物料是**既有规格五件套**（`docs/superpowers/specs/010-governance-console/` 的
   `spec.md` / `plan.md` / `tasks.md` / `state.md` / `session.md`）＋ **009 的挂账清单**。
   ⇒ Step F5 交给下一个会话的是这些，**不是**一份 dev_tdd。是否另写 `dev_tdd.010.md` 是**用户的裁定项**，
   runbook 不代做。

4. **009 的定制面比 006 宽**（将来同步上游冲突时，**保留本地侧**）：

   | 落点 | 改了什么 | 为什么是要保留的定制 |
   |---|---|---|
   | `packages/core/src/access/session.ts` | `McpServerNaming` 新增可选 `builtin?: boolean`；`sessionRuleset` 第②层对 `builtin` 恒 `allow` | 009 T014：治理 MCP server 不是资产、没有 asset id 可授；动作级校验留在 server 内（第③层） |
   | `packages/opencode/src/server/openhive/access.ts` | 抽出 `mcpServerNaming()`，按 `BUILTIN_MCP_SERVERS` **精确名字**打标 | 同上；抽成纯函数是为了能单独验「内建标记从哪来」 |
   | `packages/auth/src/builtin-mcp.ts` | **新增文件**：`GOVERNANCE_MCP_SERVER` / `BUILTIN_MCP_SERVERS` | 内建名单的唯一真相，信任边界写在文件头 |
   | `packages/auth/src/rbac.ts` | `role` 表新增 `roleType`（默认 `normal`）、`ROLE_TYPES` 常量 | 009 T004：授权组只是**标记**，判定仍只 join `user_role` / `role_resource` |
   | `packages/auth/src/migrations/0009~0012_*` | **4 组新迁移**（asset / role_type / asset_notification / asset_preferences） | 009 的数据面；编号从 0008 之后顺序接上 |
   | `packages/asset-service/` | **新 workspace 包**（`bun.lock` 里那一行是它） | 009 的主战场 |
   | `packages/app/src/ai-assets/` | **新前端目录**（含 5 组 story） | 009 的界面 |
   | `package.json` | `lint:openhive` **追加** `packages/app/src/ai-assets` | 让新目录进 lint 门 |
   | `packages/opencode/.env.example` / `CONFIG.md` | 新增 `OPENHIVE_ASSETS_ROOT` 的说明行 | 资产共享根；**未挂进内核进程**，属部署侧 |

   ⚠️ 与 006 不同：**本次 `.opencode/opencode.jsonc` 一个字都没动**。

---

## 1 · 全局红线（覆盖后面每一步）

⚠️ 所有 worktree **共享主检出的 `.git`**（SOP §1「共用同一书库」）。因此：

- **任何一步不达判据 ⇒ 停下来报告**，不要「想办法让它过」。
- 本次**全程禁止**：`--force` / `-f` / `-X` / `--no-ff` / `reset --hard` / `rebase` / `checkout --` /
  `clean` / `stash` / `--no-verify`。需要用到其中任何一个，都说明**前提不成立**——那正是该报告的时刻。
  - **唯一允许的例外**：B1 / C1 / F4 里用 `git checkout -- bun.lock` **还原镜像源污染**。
    判据是「上面的 `git diff --stat bun.lock` 非空**且**你确认它是镜像 URL 那一列」；
    拿不准就停下报告（`#005-08`：先把 `git diff --numstat` 看清再决定）。
- **本次没有任何 tag 例外。** 本 tag 尚不存在；需要 `-f` 就意味着「它已经存在了」，那本身就是该停下来查的事。
- 全程 **`git add` 只点名文件**，永不用 `git add .`。本次**不预期有任何 `git add`**。

---

## Step A · 合并前体检（4 项，缺一不可）

### A1 · 站位

```bash
cd D:/project/study/openhive/openhive
pwd                       # 应为 D:/project/study/openhive/openhive
git branch --show-current # 应输出 multi-tenant
git worktree list         # 主检出那条应排第一行，方括号里是 [multi-tenant]
```

**判据**：`git branch --show-current` 必须**逐字**是 `multi-tenant`。

不是 ⇒ **停下报告**。不要自己 `git checkout` 切过去——主检出可能正被别的会话用着。
（这就是「合并落点」的闭合点：**落在 `multi-tenant` 上**，不是 `main`，也不是 `dev`。）

### A2 · 工作树干净

```bash
git status --porcelain
```

应为**空**（2026-10-25 实测：**0 行**）。有输出 ⇒ **停下报告**，唯二的例外见下。

> **已知例外（只有这两类）：**
>
> - **以 ` T`（typechange）打头的符号链接伪文件**（历史上约 60 个，如
>   `packages/console/app/public/email`）——SOP §4.1 记的已知项，**可继续**。
>   2026-10-25 主检出实测已为 0 行，若又冒出来，按 SOP §4.1 处置（配置共享、物化不共享）。
> - 孤立的 ` M` 但 `git diff --numstat <该文件>` **为空** ⇒ `#005-08` 的陈旧 stat 伪影，
>   **不要去「修」它**，也不要 `git add`，可继续。
>
> 除此之外**任何输出都停**（尤其 `A ` / `??` / 非空的 ` M`）。

### A3 · 快进可行性（本条最要紧）

```bash
git merge-base --is-ancestor multi-tenant worktree-feat-009-ai-assets; echo "EXIT=$?"
```

应为 `EXIT=0`（2026-10-25 实测：**0**）。
`EXIT≠0` ⇒ `multi-tenant` 上有 009 没有的提交，本次**不是**快进 ⇒ **停下报告**，
**不要**改用 `--no-ff` 硬合。

顺带核一下前置：

```bash
git merge-base --is-ancestor worktree-feat-008-file-backup-snapshot multi-tenant; echo "EXIT=$?"   # 期望 0
```

### A4 · 记录（只看，不判红绿）

```bash
git rev-parse --short multi-tenant
git rev-parse --short worktree-feat-009-ai-assets
git log --oneline --no-decorate multi-tenant..worktree-feat-009-ai-assets | wc -l
git rev-list --left-right --count multi-tenant...origin/multi-tenant
git diff --stat multi-tenant..worktree-feat-009-ai-assets | tail -1
git ls-remote origin refs/heads/multi-tenant          # 远程真实位置（网络不通就跳过并如实记）
```

把这些数抄进最后的报告。2026-10-25 的快照（**仅供比对形状，不要拿来判红绿**）：

- `multi-tenant` = **ea65f4d14c**（合并的**目标**，本次不动它）
- `worktree-feat-009-ai-assets` = **4a7c736ff4**（⚠️ **本 runbook 一旦提交，这条就变了**——
  新 HEAD 就是**这份 runbook 自己的提交**，见 Step B 判据；所以**别拿这个值判红绿**）
- 领先 **20** 个提交（runbook 提交后会变成 21）、`left-right` 本地侧 = `0  0`
- 规模 `113 files changed, 14687 insertions(+), 122 deletions(-)`（runbook 提交后会 +1 文件）

> ⚠️ **不要与任何写死的数字比对**——本 runbook 里出现的数字都是取数当天的快照，会漂
> （`LEARNINGS #002-06`：会随编辑/提交变的值不写死，写取数命令）。合并之后这几个数**必然**变化。

---

## Step B · 合并（**在 `multi-tenant` 上**）

```bash
git merge --ff-only worktree-feat-009-ai-assets
```

⚠️ **落点是 A1 验过的 `multi-tenant`**——不进 Step B 才切分支（A1 已经保证了站位；
若 A1 不成立就该在 A1 停下）。

**判据**：退出码 0，且 `git log --oneline -1` 的内容 = 009 分支的 HEAD 提交
（应是一条 `docs(ops): 009 合并 + 010 开工的主检出操作提示词（merge-009-open-010.md）`；
**这份 runbook 本身就应当是它**——与 004、005、006 三次同形）。

**失败即停**（`--ff-only` 是安全阀，不是提速手段，见 SOP §3 Phase 6）：

- `fatal: Not possible to fast-forward` ⇒ **停下报告**（先回去重核 A3）。
- 出现 `CONFLICT`、或提示要创建 merge commit ⇒ **停下报告**：不要 `git commit` 收尾、
  不要 `--abort` 后重试、不要换 `--no-ff`。先让人看一眼为什么会进这种状态。
- 提示「local changes would be overwritten」⇒ **停下报告**（先回 A2 看清是哪个文件）。

---

## Step B1 · 合并后补依赖（⚠️ 本次新增，必做）

009 带进一个新的 workspace 包 `packages/asset-service`，主检出的 `node_modules` 里**没有**它的链接
（2026-10-25 实测：`packages/app/node_modules/@opencode-ai/asset-service` 不存在）。
不补这一步，Step C 的 pre-push typecheck 会**成片**报「找不到模块」，状似业务代码坏了。

```bash
bun install --frozen-lockfile
git diff --stat bun.lock        # 必须为【空】
```

- `--frozen-lockfile` 保证**不重写**锁文件——009 的 `bun.lock` 改动已经随合并进来了，
  这一步只是按合并后的锁文件建链接。
- `git diff --stat bun.lock` **非空** ⇒ 那是本机 `~/.npmrc` 镜像源污染（CLAUDE.md「锁文件污染」），
  用 `git checkout -- bun.lock` 还原，然后重跑一次 `git diff --stat bun.lock` 确认空。
- `postinstall` 会跑 `bun run --cwd packages/core fix-node-pty`；它若报错 ⇒ **停下报告**，
  别跳过、也别单独去修。
- 自检新包链接到位：

```bash
ls -la packages/app/node_modules/@opencode-ai/asset-service   # 期望是一条链接（不是 No such file）
```

---

## Step C · 推送主线

```bash
git push origin multi-tenant
```

- ⚠️ **禁止** `--force` / `-f` / `--force-with-lease` / `--no-verify`。
  被拒（non-fast-forward）⇒ 停下报告。

### C1 · ⚠️ pre-push 钩子会跑 `bun typecheck`

`git push` **不是**一个纯网络动作。本仓库 `core.hooksPath = .husky/_`，`.husky/pre-push` 会：

1. 校验 `bun` 版本满足根 `package.json` 的 `packageManager`（**`bun@1.4.2`**）；
   本机 `bun --version` = **1.4.3**（2026-10-25 实测）⇒ `^1.4.2` 满足，只打印一行 warning，**能过**；
2. 跑 **`bun typecheck`**（= 全仓 turbo typecheck）。

于是 `git push` 有**两种不同的失败**，症状完全不同、处理也完全不同：

| 失败形态 | 含义 | 怎么办 |
|---|---|---|
| `! [rejected] … (non-fast-forward)` | 远程有新提交 | **停下报告**（禁止 force） |
| 钩子报错 / 退出码非 0（大量 typecheck 报错） | 本地 typecheck 没过 | 见下 |

**typecheck 红时的诊断顺序（照 `LEARNINGS #003-06`／SOP §4.1 走，别跳步）：**

1. **先做差集，再改代码**：报错是否**成片、形状雷同**（`Cannot find module '@opencode-ai/*'`、
   `'cause' is of type 'unknown'`、`Property 'x' does not exist on type '{}'`）？
   ⇒ 那是**主检出 `node_modules` 陈旧**的回声，不是业务代码坏了。
   ```bash
   ls -la packages/opencode/node_modules/@opencode-ai/
   ls -la packages/app/node_modules/@opencode-ai/
   ls -la packages/asset-service/node_modules/         # 新包要有自己的 node_modules
   ```
2. 缺链接 ⇒ 补依赖，**不是**改代码：
   ```bash
   bun install --frozen-lockfile
   git diff --stat bun.lock        # 必须为【空】
   ```
3. 报 `error TS1128` 落在 `custom-elements.d.ts` ⇒ 那是 SOP §4.1 的伪符号链接所致，
   与本次合并无关，按 §4.1 的修法**对主检出单独做一次**（配置是共享的，物化不是）。
4. **怀疑「绿」也要查**：turbo 会拿缓存报假绿（SOP §4.1 实测过），必要时
   `bunx turbo typecheck --filter=<包名> --force` 重跑。
5. 以上都不成立、或报错指向 009 真正改动的文件 ⇒ **停下报告**。**绝不 `--no-verify` 绕过**，
   也**不照回声去改** `access.ts` / `session.ts` / `rbac.ts` 这些 009 的定制点（`#003-06` 明写了
   那会把好代码改坏、还改出假绿）。

> 009 改动的**高冲突面**（合并后若红，先看这几处是不是都被完整带进来了）：
> `packages/core/src/access/session.ts`、`packages/opencode/src/server/openhive/access.ts`、
> `packages/auth/src/rbac.ts`、`packages/auth/src/builtin-mcp.ts`、
> `packages/auth/src/migrations/0009~0012_*`、`packages/app/src/{rail,workspace,ai-session}/*`。
> 其余是**新增目录**（`packages/asset-service/`、`packages/app/src/ai-assets/`）与测试。

---

## Step D · tag（本次**没有**需要你裁定的地方）

### D0 · 现状（2026-10-25 实测）

```bash
git tag -l 'v0.1.0-009-ai-assets'                            # → 空输出 ⇒ 尚不存在
git tag -n1 -l 'v0.1.0-006-ai-session' 'v0.1.0-005-project-management'
git cat-file -t v0.1.0-006-ai-session                        # → tag（附注 tag）
```

- 本 tag **尚不存在**。
- 命名沿用实际仓库的 `v0.1.0-<NNN>-<slug>`（SOP 原文写的 `v0.1.0-<slug>` 与实不符；**本文件从实**）。
- 既有 tag 类型：001/002/004/005/006 是**附注 tag**，003 是轻量 tag。本次**从多数**，打成**附注 tag**。
- **007 / 008 没有 tag**（`git tag -l 'v0.1.0-00[78]-*'` 为空）——本次**不补**，见 `附` 节。

### D1 · 打（必须在 merge **之后**，SOP §3 Phase 6 ④）

```bash
git tag -a v0.1.0-009-ai-assets -m "009-ai-assets 收尾（资产统一元数据 + 7 状态生命周期 + 治理 MCP + 前端三栏；缺口表见 test-gaps.md）"
```

> 为什么必须打在这时候：tag 要指向**最终状态**。009 分支上在这份 runbook 之后不应再有任何提交；
> 打在合并后的 HEAD 上，tag 才**内含**这份 runbook——这正是 **001 的教训**
> （tag 打早了，后面又冒提交）的反面做法。

### D2 · 自检

```bash
git rev-parse --short HEAD
git rev-parse --short 'v0.1.0-009-ai-assets^{commit}'    # 两行应【相同】
```

不相同 ⇒ **停下报告**（说明打错了对象）。

### D3 · 推送 tag

```bash
git push origin v0.1.0-009-ai-assets
```

同 Step C：禁止任何 force / `--no-verify`；被拒 ⇒ 停下报告。
（这条推送**同样会过 pre-push 钩子**——若 C 已过，这条通常也过。）

---

## Step E · 合并后验证（逐条给结论）

```bash
git merge-base --is-ancestor worktree-feat-009-ai-assets multi-tenant; echo "EXIT=$?"   # 期望 0
git branch --show-current                                                               # 期望 multi-tenant
git log --oneline -3
git status --porcelain                                                                  # 期望空（例外见 A2）
git ls-remote origin refs/heads/multi-tenant refs/tags/v0.1.0-009-ai-assets             # 期望两条
```

009 特有的落点抽查（都应有输出）：

```bash
ls -d packages/asset-service packages/app/src/ai-assets
ls packages/auth/src/migrations/00{09,10,11,12}_* | wc -l        # 期望 8（4 跑 up，4 跑 down）
grep -n '@opencode-ai/asset-service' packages/app/package.json   # 期望 1 行
grep -n 'asset-service' bun.lock | head -3                        # 期望有 workspace 条目
grep -n 'packages/app/src/ai-assets' package.json                 # 期望在 lint:openhive 那一行
```

---

## Step F · 开 010 的工作台

### F1 · 前置（SOP §4.2）

`C:\Users\Administrator\.claude\settings.json` 里应有：

```json
"worktree": { "baseRef": "head" }
```

**已于 2026-09-28 配置**（2026-10-25 复看仍在）。扫一眼确认即可，**不要改它**
（`fresh`＝从上游 `origin/dev` 切，会切到官方代码上；`LEARNINGS #001-03`）。

### F2 · 开

```bash
claude --worktree feat-010-governance-console
```

（在**主检出目录下**执行。自动生成：目录 `.claude/worktrees/feat-010-governance-console`、
分支 `worktree-feat-010-governance-console`——SOP §1 的命名规则。）

### F3 · 进去后第一件事——验基点（SOP §3 Phase 1）

```bash
git merge-base --is-ancestor multi-tenant HEAD; echo "EXIT=$?"   # 期望 0
git branch --show-current                                        # 期望 worktree-feat-010-governance-console
```

`EXIT≠0` ⇒ **停下**，别自行 `git reset`（001 踩过，`LEARNINGS #001-03`）。

### F4 · 装依赖（新检出自带 `node_modules`）

```bash
bun install --frozen-lockfile
git diff --stat bun.lock        # 必须为【空】
```

- `bun.lock` 一旦出现 diff 就 `git checkout -- bun.lock` 还原（CLAUDE.md「锁文件污染」）。
- 若 typecheck / 测试成片报错且形状雷同，**先按 `LEARNINGS #003-06` 做软链接差集**
  （`ls -la packages/*/node_modules/@opencode-ai/`，**别忘了新包 `packages/asset-service`**），
  别照着回声去改业务代码。

### F5 · 开工物料（⚠️ 本次**不是**一份 dev_tdd，见 §0 差别 ③）

交给新会话的是**下面四样**，照它们办：

1. **规格五件套**（已在仓库里）：
   `docs/superpowers/specs/010-governance-console/` 的
   `spec.md`（业务需求 / AC）→ `plan.md`（定稿，**禁止重新规划**）→ `tasks.md`（已锁定）
   → `state.md` / `session.md`（**注意：state 里写着「尚未开始」，与仓库里已写好的
   spec/plan/tasks 不同步**——开工第一步是读规格并核准起点，不是信 state 里那句「无阻塞项」）。
2. **010 已有的两块移交**（在 `010-governance-console/tasks.md` 顶部，`grep '接收自 F3'` 直取）：
   - **F3 的 T016（越权 BOLA/BFLA）** → 010 的 **T015**（BFLA 半边**一格都没测**，别以为 F3 做完了）；
   - **F3 的 T022 / T024 触发者** → 010 的 **T005**（录入用 `provisionUser` 不用 `registerUser`；
     `LastAdminError` 要翻译成人话；那道守卫有 TOCTOU 窗口）；
   - **F4 的语义说明**：授权变更**当场不生效**，界面别写「立即生效」。
3. **009 的挂账清单**（`docs/superpowers/specs/009-ai-assets/state.md` 的「## 阻塞项」）。
   与 010 **直接相关**的几条，开工前必须读：
   - **部门 id 化**：发布目录当前用**部门名**，部门表与稳定 id 待 010 ⇒ 届时迁移 `/assets/dept/*`。
   - **资产 HTTP 接口未落**：`/assets` 列表接口不存在，`pages/layout-new.tsx` 也没注入
     `WorkspaceEntry.assets` ⇒ **真栈上资产页今天只有空态**。010 若要展示资产用量，先核这一点。
   - **没有 `opencode.json` 写入器**：`buildUserMcpConfig()` 只产出「该给什么」，本仓没有代码写进去；
     治理 MCP 与已授权 MCP 资产在**部署侧接线之前**不会出现在模型工具清单里。
   - **🔴 RLS 未在本仓验证**（D0-12）：`mcp-downlink.md` §6 是接口契约 ＋ 外部验收清单。
     **不得在任何报告里写成「RLS 已覆盖」。**
   - **业务 MCP 连接清单无常存储**；**端到端接线用例被环境挡住**（`openai@6.39.1` 缺 `version.mjs`）。
   - **009 F1（前端 a11y）审计仍红 5 格**（`test-gaps.md` §7）：dark 选中态对比度 1.07:1、
     light `text-faint` 3.85:1。**属设计裁定，未修**——010 的界面别照抄这两个组合，
     也别在报告里把它写成已解决。
4. **每个 task 启动必读**（`openhive/CLAUDE.md` 的「工作流」第 2 条）：
   `../.specify/memory/constitution.md`（**在外层工作区**，相对本仓根是
   `D:/project/study/openhive/.specify/memory/constitution.md`）＋
   `docs/superpowers/specs/openhive-DESIGN.md` ＋ 本 feature 的 `plan.md` / `tasks.md`。

**三条不可省的提醒**：

- ⚠️ **010 是「治理」格**：它消费 009 的 governor MCP（三个工具）、004 的 RBAC、002 的账号。
  动手前先跑一遍 `grep -n 'BUILTIN_MCP_SERVERS\|GOVERNANCE_MCP_SERVER' -r packages/auth packages/opencode packages/asset-service`，
  确认自己接的是**已有出口**而不是另起一套。
- ⚠️ **每开一个 task 前**：为 `[FE]` 组件读 constitution → `openhive-DESIGN.md` → 对应的
  `design-reference/figma-export/`；**做完一个 task 就停下等「next」**（宪法 §九）。
- ⚠️ **收尾补测要按路由走**（`test-routing-advisor`）：010 涉及管理员端点（BFLA）与审计，
  大概率命中 `backend-testing` 的越权 / 真库两类缺口；009 已给出一条可照抄的样板
  （`acceptance-sc003-mcp.test.ts` 的身份 × 工具矩阵、`real-pg.test.ts` 的真库用例）。

### F6 · 待用户裁定的项（**runbook 不代做**）

1. **是否另写 `dev_tdd.010.md`**（照 `dev_tdd.009.md` 的形态，把五件套 ＋ 移交 ＋ 实测差集揉成一份开工指令）。
   F5 已给出不依赖它的开工路径。
2. **009 F1 的两条对比度缺陷**（`test-gaps.md` §7）：
   - dark 选中态：给 `--v2-background-bg-accent-soft` 加 dark 覆盖，还是给选中态换文字色？
   - `text-faint`：调 token 值，还是规定「faint 只用于 ≥18px / 非必需文本」？
   两条都是**设计裁定**，且影响面横跨 rail / ai-session / project / file-tree / ai-sessions / ai-assets。
3. **是否补 007 / 008 的 tag**（仓库里没有 `v0.1.0-007-*` / `v0.1.0-008-*`）。本次**不补**。

---

## Step G · 收尾报告（固定格式）

```
① 合并：multi-tenant <合并前 sha> → <合并后 sha>；--ff-only <成功/失败>；快进 <N> 个提交
② 依赖：bun install --frozen-lockfile <已跑/未跑>；asset-service 链接 <到位/缺>；bun.lock diff <空/非空>
③ 推送：origin/multi-tenant <成功/被拒>；pre-push typecheck <过/红→诊断结论>；
        tag <新建 sha>；origin tag <成功/被拒>
④ 010 工作台：<已开/未开>；目录 ……；分支 ……；基点验证 EXIT=<0/其他>
⑤ 010 依赖：bun install --frozen-lockfile <已跑/未跑>；bun.lock diff <空/非空>
⑥ 命中「停下报告」的项：<无 / 列出>
```

---

## 附 · 本次**不要**做的事

- ❌ 不在主检出写产品码、不改任何文件（本次是「合并 + 开台」，主线只前进一格）。
- ❌ **不把 `bun.lock` 的 `M` 当污染还原**——009 新增了 workspace 包，那一行是**真实改动**。
  只有「镜像 URL 那一列被填满」才是污染（见 Step B1）。
- ❌ 不删 009 的工作台 / 分支，也**不删 006、005、004、003 的历史工作台**（specs 目录**永不删除**；
  历史工作台留着当路标——SOP §1）。
- ❌ 不动 `feat-007-fund-analysis`（它停在 `7761bc812b`，即 006 合并点，**本就没开工**）与
  `feat-file-archive-download`（另一条支线）的工作台/分支；不跑 `git worktree prune`。
- ❌ 不动那条 `prunable` 的临时工作台 `C:/Users/Administrator/AppData/Local/Temp/oh-mut`
  （`git worktree list` 里会看到）。
- ❌ **不在主检出跑全量测试**（Step B1 的 `bun install` 与 Step C 的 typecheck 是必要动作；
  `bun test` 在根目录被脚本强制 `exit 1`，本就不该跑）。
- ❌ 不把 `upstream` 掺进来（`upstream/dev → 本地` 是**另一个**例行动作，不在本次范围）。
- ❌ 不去「修」009 的 a11y 红格与对比度缺陷——那是**设计裁定**项，见 F6。
- ❌ 不提交 009 工作台里任何未跟踪的浏览器工具产物（`.playwright-mcp/` 等，与本次无关）。
