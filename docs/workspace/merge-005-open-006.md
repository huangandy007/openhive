# 主检出操作提示词 · 合并 005-project-management ＋ 开 006 AI 会话工作台

> **一次性 runbook**（2026-10-07 写于 005 工作台）。做完即失效，留在 `docs/workspace/` 备查。
> 本文件**不是** 006 的实现提示词——那份是 [`dev_tdd.006.md`](./dev_tdd.006.md)。
> 本文件是交给**主检出会话**的一段操作指令，对应 SOP [`feature-delivery-sop.md`](./feature-delivery-sop.md)
> 的 **Phase 6（合并 + tag）** 与 **Phase 0/1（开下一个工作台）**。
>
> ⚠️ 本文件是在 005 工作台里写的，**要等合并完成后才会出现在主检出**——所以下面 §0.0 的提示词里给的是
> **工作台的绝对路径**。

## 0.0 · 给主检出会话的提示词（复制这个代码块，粘贴到新会话）

> 用法：在**主检出** `D:\project\study\openhive\openhive` 下开新会话，把下面代码块整段粘进去。
> 它只做一件事——让新会话**先读本文件、再照本文件办事**；所有判据、红线、报告格式都在下面各 Step 里，
> 提示词不重复它们（`LEARNINGS #002-06`：同一件事不写两份，免得漂）。
>
> ⚠️ 路径说明：合并**完成前**，主检出的 `docs/workspace/` 里还没有本文件（它只存在于 005 分支），
> 所以第一行给的是**工作台绝对路径**——合并后该路径依然有效（文件已进主检出）；
> 那时换用主检出相对路径 `docs/workspace/merge-005-open-006.md` 亦可。

```
【任务】在主检出 D:\project\study\openhive\openhive 执行「005 合并 + 006 开台」。

第一步：先读完整 runbook，再动手：

  D:\project\study\openhive\openhive\.claude\worktrees\feat-005-project-management\docs\workspace\merge-005-open-006.md

然后照它 Step A → Step G 逐步执行，每一步达标才走下一步：

  A 合并前体检（站位 / 工作区干净 / ff-only 可行性 / 记录取数）
  B git merge --ff-only worktree-feat-005-project-management
  C git push origin multi-tenant
  D git tag -a v0.1.0-005-project-management -m "005-project-management 收尾（含 006 开工物料 dev_tdd.006.md）"
    然后 git push origin v0.1.0-005-project-management
  E 合并后验证（逐条给结论）
  F claude --worktree feat-006-ai-session；进去验基点、bun install --frozen-lockfile
  G 按固定格式报告

红线（runbook §1，本次没有任何例外）：
- 任何一步不达判据 ⇒ 停下来报告，不要「想办法让它过」。
- 全程禁止：--force / -f / -X / --no-ff / reset --hard / rebase / checkout -- / clean / stash / --no-verify。
- 本次不写任何产品码、不改任何文件；不做任何 git add（不预期需要），更不许 git add .。
- git push 会触发 .husky/pre-push 的 bun typecheck，红了按 runbook Step C1 的顺序诊断
  （先做 node_modules 软链接差集，别照回声改业务代码），绝不 --no-verify 绕过。
- 不把 upstream 掺进来；不动 oh-mut 那条 prunable 工作台；不跑 git worktree prune。
- 不删 005/004/003 的工作台与分支；specs 目录永不删除。

最后按 runbook Step G 的固定格式汇报。
```

---

## 0 · 你在哪儿、这件事是什么

- 你在**主检出** `D:\project\study\openhive\openhive`（不是 `.claude\worktrees\` 下的隔离副本）。
- 主检出就是 SOP §1 里「主检出」那张桌子：**分支恒为 `multi-tenant`，只做合并与打 tag**。
- 本次**只做三件事，不写任何产品码**：

| # | 目标 | 判据（唯一权威） |
|---|---|---|
| 1 | 005 进 `multi-tenant` | `git merge-base --is-ancestor worktree-feat-005-project-management multi-tenant` 退出码 **0** |
| 2 | 主线与 tag 进 `origin` | `git ls-remote origin refs/heads/multi-tenant refs/tags/v0.1.0-005-project-management` 两条都在 |
| 3 | 006 工作台开出来 | 新工作台内 `git merge-base --is-ancestor multi-tenant HEAD` 退出码 **0** |

### 与上一份 runbook（`merge-004-open-005.md`）的三处实质差别

先知道这三条，执行时就不会误判：

1. **本 feature 的 tag 尚不存在。** `v0.1.0-005-project-management` 实测**零命中**（2026-10-07，
   `git tag -l 'v0.1.0-*'` 只回 `platform-foundation / 002 / 003 / 004 / beta1..3`）。
   ⇒ 上次那种「tag 已存在、要不要重打」的**甲/乙裁定本次不存在**；合并后**新建**即可，
   **全程不需要 `git tag -f`**——红线里也就**没有任何例外**了（见 §1）。
2. **推送会触发 `.husky/pre-push` 里上游自带的 `bun typecheck`。** 这是 004 那份 runbook 没写、
   而本次必须写清的一层判据：`git push origin multi-tenant` 的成败**不只取决于网络**，
   还取决于**主检出当时的 `node_modules` 与新代码能否 typecheck 通过**（详见 Step C1）。
3. **006 是「纯前端 ＋ 0 BE」标签，但开工前有三条 🔴 需要后端。** 这是 Step F5 要提醒下一个会话的事——
   别把标签表的结论当成开工结论。

---

## 1 · 全局红线（覆盖后面每一步）

⚠️ 所有 worktree **共享主检出的 `.git`**（SOP §1「共用同一书库」）。因此：

- **任何一步不达判据 ⇒ 停下来报告**，不要「想办法让它过」。
- 本次**全程禁止**：`--force` / `-f` / `-X` / `--no-ff` / `reset --hard` / `rebase` / `checkout --` /
  `clean` / `stash` / `--no-verify`。需要用到其中任何一个，都说明**前提不成立**——那正是该报告的时刻。
- **本次没有任何例外。** 上次 runbook 给 `git tag -f` 开的那扇门，本次**不适用**（本 tag 尚不存在，
  见 §0 差别 ①）——需要 `-f` 就意味着「它已经存在了」，那本身就是该停下来查的事。
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

不是 `multi-tenant` ⇒ **停下报告**。不要自己 `git checkout` 切过去——主检出可能正被别的会话用着。

### A2 · 工作树干净

```bash
git status --porcelain
```

应为**空**。有输出 ⇒ **停下报告**，唯二的例外见下。

> **已知例外（只有这两类，本检出实测过）：**
>
> - **以 ` T`（typechange）打头的符号链接伪文件**（约 60 个，如 `packages/console/app/public/email`）——
>   SOP §4.1 记的已知项，**可继续**。它还会让 typecheck 变红，与 Step C1 相关。
> - 除此之外**任何输出都停**（尤其 ` M` / `A ` / `??`）。
>
> ⚠️ 上一份 runbook 里提到过的那条「陈旧 stat 伪影 `M packages/opencode/test/server/openhive-project-frozen.test.ts`」
> （`LEARNINGS #005-08`）**在本检出不会出现**——实测该文件是 005 分支**新增**的
> （`git diff --name-status multi-tenant..worktree-feat-005-project-management -- <该文件>` → `A`），
> `multi-tenant` 上**根本没有这个文件**。它只是 005 工作台里的残留，与本次无关，别去找它。

### A3 · 快进可行性（本条最要紧）

```bash
git merge-base --is-ancestor multi-tenant worktree-feat-005-project-management; echo "EXIT=$?"
```

应为 `EXIT=0`（2026-10-07 实测：**0**）。
`EXIT≠0` ⇒ `multi-tenant` 上有 005 没有的提交，本次**不是**快进 ⇒ **停下报告**，
**不要**改用 `--no-ff` 硬合。

### A4 · 记录（只看，不判红绿）

```bash
git rev-parse --short multi-tenant
git rev-parse --short worktree-feat-005-project-management
git log --oneline --no-decorate multi-tenant..worktree-feat-005-project-management | wc -l
git rev-list --left-right --count multi-tenant...origin/multi-tenant
git diff --stat multi-tenant..worktree-feat-005-project-management | tail -1
```

把这些数抄进最后的报告。2026-10-07 的快照（**仅供比对形状，不要拿来判红绿**）：
领先 **51** 个提交、`left-right` = `0  0`、规模 `94 files changed, 28782 insertions(+), 87 deletions(-)`。

> ⚠️ **不要与任何写死的数字比对**——本 runbook 里出现的数字都是取数当天的快照，会漂
> （`LEARNINGS #002-06`：会随编辑/提交变的值不写死，写取数命令）。合并之后这几个数**必然**变化。

---

## Step B · 合并

```bash
git merge --ff-only worktree-feat-005-project-management
```

**判据**：退出码 0，且 `git log --oneline -1` 的内容 = 005 分支的 HEAD 提交
（应是一条 `docs(...)` 开头的收尾/文档提交；**`docs/workspace/merge-005-open-006.md` 这份 runbook
本身就应当是它**——与 004 那次同形）。

**失败即停**（`--ff-only` 是安全阀，不是提速手段，见 SOP §3 Phase 6）：

- `fatal: Not possible to fast-forward` ⇒ **停下报告**（先回去重核 A3）。
- 出现 `CONFLICT`、或提示要创建 merge commit ⇒ **停下报告**：不要 `git commit` 收尾、
  不要 `--abort` 后重试、不要换 `--no-ff`。先让人看一眼为什么会进这种状态。
- 提示「local changes would be overwritten」⇒ **停下报告**（先回 A2 看清是哪个文件）。

---

## Step C · 推送主线

```bash
git push origin multi-tenant
```

- ⚠️ **禁止** `--force` / `-f` / `--force-with-lease` / `--no-verify`。
  被拒（non-fast-forward）⇒ 停下报告。
- 2026-10-07 实测：`origin/multi-tenant` 与本地同点（`left-right` = `0  0`），本次推送即把 005 整条推上去。

### C1 · ⚠️ 本次新增的一层判据：pre-push 钩子会跑 `bun typecheck`

`git push` **不是**一个纯网络动作。本仓库 `core.hooksPath = .husky/_`，`.husky/pre-push` 会：

1. 校验 `bun` 版本满足根 `package.json` 的 `packageManager`（`bun@1.3.14`）；
   本机 `bun --version` = **1.3.14**（2026-10-07 实测）⇒ 这条会过；
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
   ls -la packages/opencode/node_modules/@opencode-ai/   # 看软链接齐不齐
   ```
2. 缺链接 ⇒ 补依赖，**不是**改代码：
   ```bash
   bun install --frozen-lockfile
   git diff --stat bun.lock        # 必须为【空】
   ```
   （`--frozen-lockfile` 绕开本机 `~/.npmrc` 的镜像源污染；`bun.lock` 一旦出现 diff
   就 `git checkout -- bun.lock` 还原——注意这条 `checkout --` 是**还原锁文件**，与红线里禁的
   「用 `checkout --` 抹掉工作区改动」不是一回事；如不确定就停下报告。）
3. 报 `error TS1128` 落在 `custom-elements.d.ts` ⇒ 那是 SOP §4.1 的 60 个伪符号链接所致，
   与本次合并无关，按 §4.1 的修法**对主检出单独做一次**（配置是共享的，物化不是）。
4. **怀疑「绿」也要查**：turbo 会拿缓存报假绿（SOP §4.1 实测过），必要时
   `bunx turbo typecheck --filter=<包名> --force` 重跑。
5. 以上都不成立、或报错指向 005 真正改动的文件 ⇒ **停下报告**。**绝不 `--no-verify` 绕过**，
   也**不照回声去改 `gateway.ts` / 业务代码**（`#003-06` 明写了那会把好代码改坏、还改出假绿）。

---

## Step D · tag（本次**没有**需要你裁定的地方）

### D0 · 现状（2026-10-07 实测）

```bash
git tag -l 'v0.1.0-005-project-management'                  # → 空输出 ⇒ 尚不存在
git tag -n1 -l 'v0.1.0-platform-foundation' 'v0.1.0-002-auth-account' \
               'v0.1.0-003-multi-tenant-isolation' 'v0.1.0-004-access-control'
git cat-file -t v0.1.0-004-access-control                    # → tag（附注 tag）
```

- 本 tag **尚不存在**（SOP 的 `v0.1.0-<slug>` 与既有五个 tag 的实际写法不一致——
  实际仓库里是 `v0.1.0-<NNN>-<slug>`，本文件从实，用 **`v0.1.0-005-project-management`**）。
- 既有 tag 的类型**不统一**：001/002/004 是**附注 tag**（`cat-file -t` → `tag`），
  003 是**轻量 tag**（→ `commit`）。本次**从多数、也从紧邻的 004**，打成**附注 tag**。

### D1 · 打（必须在 merge **之后**，SOP §3 Phase 6 ④）

```bash
git tag -a v0.1.0-005-project-management -m "005-project-management 收尾（含 006 开工物料 dev_tdd.006.md）"
```

> 为什么必须打在这时候：tag 要指向**最终状态**。005 分支上在这份 runbook 之后不应再有任何提交；
> 打在合并后的 HEAD 上，tag 才**内含** `dev_tdd.006.md` 与这份 runbook——这正是 **001 的教训**
> （tag 打早了，后面又冒提交）的反面做法。

### D2 · 自检

```bash
git rev-parse --short HEAD
git rev-parse --short 'v0.1.0-005-project-management^{commit}'   # 两行应【相同】
```

不相同 ⇒ **停下报告**（说明打错了对象）。

### D3 · 推送 tag

```bash
git push origin v0.1.0-005-project-management
```

同 Step C：禁止任何 force / `--no-verify`；被拒 ⇒ 停下报告。
（这条推送**同样会过 pre-push 钩子**——若 C 已过，这条通常也过。）

---

## Step E · 合并后验证（逐条给结论）

```bash
git merge-base --is-ancestor worktree-feat-005-project-management multi-tenant; echo "EXIT=$?"  # 期望 0
git branch --show-current                                                                       # 期望 multi-tenant
git log --oneline -3
git status --porcelain                                                                          # 期望空（T 例外见 A2）
git ls-remote origin refs/heads/multi-tenant refs/tags/v0.1.0-005-project-management            # 期望两条
```

---

## Step F · 开 006 的工作台

### F1 · 前置（SOP §4.2）

`C:\Users\Administrator\.claude\settings.json` 里应有：

```json
"worktree": { "baseRef": "head" }
```

**已于 2026-09-28 配置**。扫一眼确认即可，**不要改它**（`fresh`＝从上游 `origin/dev` 切，会切到官方代码上）。

### F2 · 开

```bash
claude --worktree feat-006-ai-session
```

（在**主检出目录下**执行。自动生成：目录 `.claude/worktrees/feat-006-ai-session`、
分支 `worktree-feat-006-ai-session`——SOP §1 的命名规则。）

### F3 · 进去后第一件事——验基点（SOP §3 Phase 1）

```bash
git merge-base --is-ancestor multi-tenant HEAD; echo "EXIT=$?"   # 期望 0
git branch --show-current                                        # 期望 worktree-feat-006-ai-session
```

`EXIT≠0` ⇒ **停下**，别自行 `git reset`（001 踩过，`LEARNINGS #001-03`）。

### F4 · 装依赖（新检出自带 `node_modules`）

```bash
bun install --frozen-lockfile
git diff --stat bun.lock        # 必须为【空】
```

- `bun.lock` 一旦出现 diff 就 `git checkout -- bun.lock` 还原（CLAUDE.md「锁文件污染」）。
- 若 typecheck / 测试成片报错且形状雷同，**先按 `LEARNINGS #003-06` 做软链接差集**
  （`ls -la packages/*/node_modules/@opencode-ai/`），别照着回声去改业务代码。

### F5 · 开工指令

把 `docs/workspace/dev_tdd.006.md` 交给新会话，**照它办**。三条不可省的提醒：

- ⚠️ **「0 BE」是标签表的结论，不是开工结论。** 006 的 plan 写 `[FE] 10 + [INT] 4 + [BE] 0`，
  但 runbook Step 0.5 实测出**三条 🔴 需要后端 / 需要先裁定**：
  **D0-2**（capability 过滤无承载体，四个列表端点都返回全量）、**D0-3**（技能契约没有
  `group`/`category` 字段，T002 要先**造**契约，且它是 006→009 的接口）、
  **D0-4**（US5 两项输出都够不着：仓库只有 MCP **客户端**、业务动作层无 `permission.ask`）。
- ⚠️ **先裁定「未定项清单 U1–U10」再动手**——尤其 **U1**（右栏会话的形态：`ThreePane` 的 `right`
  prop 从未被传入、`SessionSidePanel` 不是消息流）、**U4**（技能契约形态）、**U2**（capability 落点）。
  这三条决定第一步怎么落；U2/U4 还牵动 009。
- ⚠️ **每开一个 task 前**：为 `[FE]` 组件读 constitution → `openhive-DESIGN.md` → 对应的
  `design-reference/figma-export/`；**做完一个 task 就停下等「next」**（宪法 §九）。

---

## Step G · 收尾报告（固定格式）

```
① 合并：multi-tenant <合并前 sha> → <合并后 sha>；--ff-only <成功/失败>；快进 <N> 个提交
② 推送：origin/multi-tenant <成功/被拒>；pre-push typecheck <过/红→诊断结论>；
        tag <新建 sha>；origin tag <成功/被拒>
③ 006 工作台：<已开/未开>；目录 ……；分支 ……；基点验证 EXIT=<0/其他>
④ 依赖：bun install --frozen-lockfile <已跑/未跑>；bun.lock diff <空/非空>
⑤ 命中「停下报告」的项：<无 / 列出>
```

---

## 附 · 本次**不要**做的事

- ❌ 不在主检出写产品码、不改任何文件（本次是「合并 + 开台」，主线只前进一格）。
- ❌ 不删 005 的工作台 / 分支，也**不删 004、003 的历史工作台**（specs 目录**永不删除**；
  历史工作台留着当路标——SOP §1）。
- ❌ 不动那条 `prunable` 的临时工作台 `C:/Users/Administrator/AppData/Local/Temp/oh-mut`
  （`git worktree list` 里会看到）。它与本次无关，**别顺手 `git worktree prune`**。
- ❌ **不在主检出跑全量测试**（除了 Step C1 里那个**由推送自动触发**的 typecheck——
  那是钩子的行为，不是让你主动去跑；`LEARNINGS #003-06`：主检出 `node_modules` 可能过期）。
- ❌ 不把 `upstream` 掺进来（`upstream/dev → 本地` 是**另一个**例行动作，不在本次范围）。
- ❌ 不提交 005 工作台里那个残留文件
  `packages/opencode/test/server/openhive-project-frozen.test.ts`（陈旧 stat 伪影，
  `git diff --numstat` 为空，`LEARNINGS #005-08`）；也**不要**用 `git checkout --` 去「修」它。
  它不参与本次合并（见 A2）。
- ❌ 不提交 005 工作台里未跟踪的 `.playwright-mcp/`（浏览器工具产物，与本次无关）。
