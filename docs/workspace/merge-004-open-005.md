# 主检出操作提示词 · 合并 004-access-control ＋ 开 005 工作台

> **一次性 runbook**（2026-10-06 写于 004 工作台）。做完即失效，留在 `docs/workspace/` 备查。
> 本文件**不是** 005 的实现提示词——那份是 [`dev_tdd.005.md`](./dev_tdd.005.md)。
> 本文件是交给**主检出会话**的一段操作指令，对应 SOP [`feature-delivery-sop.md`](./feature-delivery-sop.md)
> 的 **Phase 6（合并 + tag）** 与 **Phase 0/1（开下一个工作台）**。
>
> ⚠️ 本文件是在 004 工作台里写的，**要等合并完成后才会出现在主检出**。本次执行请以对话里粘贴的文本为准
> （或直接读工作台路径 `D:\project\study\openhive\openhive\.claude\worktrees\feat-004-access-control\docs\workspace\merge-004-open-005.md`）。

## 0 · 你在哪儿、这件事是什么

- 你在**主检出** `D:\project\study\openhive\openhive`（不是 `.claude\worktrees\` 下的隔离副本）。
- 主检出就是 SOP §1 里「主检出」那张桌子：**分支恒为 `multi-tenant`，只做合并与打 tag**。
- 本次**只做三件事，不写任何产品码**：

| # | 目标 | 判据（唯一权威） |
|---|---|---|
| 1 | 004 进 `multi-tenant` | `git merge-base --is-ancestor worktree-feat-004-access-control multi-tenant` 退出码 **0** |
| 2 | 主线与 tag 进 `origin` | `git ls-remote origin refs/heads/multi-tenant refs/tags/v0.1.0-004-access-control` 两条都在 |
| 3 | 005 工作台开出来 | 新工作台内 `git merge-base --is-ancestor multi-tenant HEAD` 退出码 **0** |

## 1 · 全局红线（覆盖后面每一步）

⚠️ 所有 worktree **共享主检出的 `.git`**（SOP §1「共用同一书库」）。因此：

- **任何一步不达判据 ⇒ 停下来报告**，不要「想办法让它过」。
- 本次**全程禁止**：`--force` / `-f` / `--no-ff` / `-X` / `reset --hard` / `rebase` / `checkout --` / `clean` / `stash`。
  需要用到其中任何一个，都说明**前提不成立**——那正是该报告的时刻。
- **唯一例外**是 Step D 里的 `git tag -f`：本 tag 经实测**尚未推送**（`git ls-remote` 空输出），
  重打不构成对已发布历史的重写。**推送之后就再没有这个余地了。**

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

应为**空**。有输出 ⇒ **停下报告**。

> **唯一例外**：若输出里只有以 ` T`（typechange）打头的符号链接伪文件（约 60 个，如
> `packages/console/app/public/email`），那是已知项（SOP §4.1），可继续。
> **其他任何输出都停**。本次也不负责修它（修法见 SOP §4.1，与本次无关）。

### A3 · 快进可行性（本条最要紧）

```bash
git merge-base --is-ancestor multi-tenant worktree-feat-004-access-control; echo "EXIT=$?"
```

应为 `EXIT=0`（2026-10-06 实测：**0**）。
`EXIT≠0` ⇒ `multi-tenant` 上有 004 没有的提交，本次**不是**快进 ⇒ **停下报告**，
不要改用 `--no-ff` 硬合。

### A4 · 记录（只看，不判红绿）

```bash
git rev-parse --short multi-tenant
git rev-parse --short worktree-feat-004-access-control
git log --oneline --no-decorate multi-tenant..worktree-feat-004-access-control | wc -l
git rev-list --left-right --count multi-tenant...origin/multi-tenant
```

把这些数抄进最后的报告。⚠️ **不要与任何写死的数字比对**——本 runbook 里出现的数字都是取数当天的快照，会漂
（`LEARNINGS #002-06`：会随编辑/提交变的值不写死，写取数命令）。

---

## Step B · 合并

```bash
git merge --ff-only worktree-feat-004-access-control
```

**判据**：退出码 0，且 `git log --oneline -1` 的内容 = 004 分支的 HEAD 提交。

**失败即停**（`--ff-only` 是安全阀，不是提速手段，见 SOP §3 Phase 6）：

- `fatal: Not possible to fast-forward` ⇒ **停下报告**（先回去重核 A3）。
- 出现 `CONFLICT`、或提示要创建 merge commit ⇒ **停下报告**：不要 `git commit` 收尾、不要 `--abort` 后重试、
  不要换 `--no-ff`。先让人看一眼为什么会进这种状态。

---

## Step C · 推送主线

```bash
git push origin multi-tenant
```

- ⚠️ **禁止** `--force` / `-f` / `--force-with-lease`。被拒（non-fast-forward）⇒ 停下报告。
- 2026-10-06 实测：`origin/multi-tenant` 与本地同点（差集 `0  0`），本次推送即把 004 整条推上去。

---

## Step D · tag（⚠️ 有一处需要你先裁定）

### D0 · 现状（2026-10-06 实测）

```bash
git tag -n1 -l 'v0.1.0-004-access-control'
git cat-file -t v0.1.0-004-access-control                    # → tag（是「附注 tag」，不是轻量 tag）
git rev-parse --short 'v0.1.0-004-access-control^{commit}'   # → 30a50cd038 = 004 的收尾提交
git ls-remote origin refs/tags/v0.1.0-004-access-control     # → 空输出 ⇒ 远程【还没有】这个 tag
```

tag **已经存在**（在 004 工作台里打的，未推送），但它指向 004 的**收尾提交**；
而分支在那之后又多了提交：`docs(005): 005-project-management 开工提示词（dev_tdd.005.md）`
（以及本次这份 runbook）。⇒ **tag 落在合并后的 HEAD 之后。**

### D1 · 两种口径，二选一（这是本次**唯一**要你拍板的地方）

| | 做法 | 后果 |
|---|---|---|
| **(甲) 重打到合并后的 HEAD**（**推荐**） | 合并完成后 `git tag -f …`，再推 | tag ＝ 主线在 004 收尾时的**完整状态**（含 005 开工物料）。与 SOP §3 Phase 6「④ 打 tag —— **必须在 merge 之后**」字面一致；也与 **003 的先例**一致——`v0.1.0-003-multi-tenant-isolation` 恰好就打在 `docs(004): 004 开工物料 dev_tdd.004.md` 那个提交上。 |
| (乙) 保持不动 | 直接推 | tag 停在 004 的收尾提交，**不含** `dev_tdd.005.md`。好处是「005 物料不算 004 交付物」这条口径更纯；代价是与 SOP 字面、与 003 先例都不一致，且形状上正是 SOP 里记的 **001 的教训**（tag 打早了，后面又冒提交，tag 没覆盖最终状态）。 |

**执行（按选定项二选一）**：

```bash
# 甲
git tag -f -a v0.1.0-004-access-control -m "004-access-control 收尾（含 005 开工物料）"
git rev-parse --short 'v0.1.0-004-access-control^{commit}'   # 应 = 合并后的 HEAD
```

```bash
# 乙
git rev-parse --short 'v0.1.0-004-access-control^{commit}'   # 应仍 = 30a50cd038
```

### D2 · 推送 tag

```bash
git push origin v0.1.0-004-access-control
```

同 Step C：禁止任何 force；被拒 ⇒ 停下报告。

---

## Step E · 合并后验证（逐条给结论）

```bash
git merge-base --is-ancestor worktree-feat-004-access-control multi-tenant; echo "EXIT=$?"  # 期望 0
git branch --show-current                                                                   # 期望 multi-tenant
git log --oneline -3
git status --porcelain                                                                      # 期望空（T 例外见 A2）
git ls-remote origin refs/heads/multi-tenant refs/tags/v0.1.0-004-access-control            # 期望两条
```

---

## Step F · 开 005 的工作台

### F1 · 前置（SOP §4.2）

`C:\Users\Administrator\.claude\settings.json` 里应有：

```json
"worktree": { "baseRef": "head" }
```

**已于 2026-09-28 配置**。扫一眼确认即可，**不要改它**（`fresh`＝从上游 `origin/dev` 切，会切到官方代码上）。

### F2 · 开

```bash
claude --worktree feat-005-project-management
```

（在**主检出目录下**执行。自动生成：目录 `.claude/worktrees/feat-005-project-management`、
分支 `worktree-feat-005-project-management`。）

### F3 · 进去后第一件事——验基点（SOP §3 Phase 1）

```bash
git merge-base --is-ancestor multi-tenant HEAD; echo "EXIT=$?"   # 期望 0
git branch --show-current                                        # 期望 worktree-feat-005-project-management
```

`EXIT≠0` ⇒ **停下**，别自行 `git reset`（001 踩过，`LEARNINGS #001-03`）。

### F4 · 装依赖（新检出自带 `node_modules`）

```bash
bun install --frozen-lockfile
git diff --stat bun.lock        # 必须为【空】
```

- `--frozen-lockfile` 是为绕开本机 `~/.npmrc` 的镜像源污染；`bun.lock` 一旦出现 diff 就
  `git checkout -- bun.lock` 还原（CLAUDE.md「锁文件污染」）。
- 若测试 / typecheck 成片报错且形状雷同（`Cannot find module '@opencode-ai/*'`、
  `'cause' is of type 'unknown'`、`Property 'x' does not exist on type '{}'`…），
  **先按 `LEARNINGS #003-06` 做软链接差集**（`ls -la packages/*/node_modules/@opencode-ai/`），
  别照着回声去改业务代码。

### F5 · 开工指令

把 `docs/workspace/dev_tdd.005.md` 交给新会话，**照它办**。
⚠️ 它的「未定项清单 U1–U8」要先裁定——尤其 **U1**（plan R4 与 spec 自相矛盾）、
**U4**（`project` 表加列 vs 另起表）、**U5**（成员判定走哪条权限线）：这三条决定第一步怎么落。

---

## Step G · 收尾报告（固定格式）

```
① 合并：multi-tenant <合并前 sha> → <合并后 sha>；--ff-only <成功/失败>；快进 <N> 个提交
② 推送：origin/multi-tenant <成功/被拒>；tag 口径 <甲/乙>；origin tag <成功/被拒>
③ 005 工作台：<已开/未开>；目录 ……；分支 ……；基点验证 EXIT=<0/其他>
④ 依赖：bun install --frozen-lockfile <已跑/未跑>；bun.lock diff <空/非空>
⑤ 命中「停下报告」的项：<无 / 列出>
```

---

## 附 · 本次**不要**做的事

- ❌ 不在主检出写产品码、不改任何文件（本次是「合并 + 开台」，主线只前进一格）。
- ❌ 不删 004 的工作台 / 分支（specs 目录**永不删除**；历史工作台留着当路标——SOP §1）。
- ❌ 不动那条 `prunable` 的临时工作台 `C:/Users/Administrator/AppData/Local/Temp/oh-mut`
  （`git worktree list` 里会看到）。它与本次无关，别顺手 `git worktree prune`。
- ❌ 不在主检出跑全量测试 / typecheck（那是工作台的事；主检出的 `node_modules` 可能过期，
  `LEARNINGS #003-06`）。
- ❌ 不把 `upstream` 掺进来（`upstream/dev → 本地` 是**另一个**例行动作，不在本次范围）。
