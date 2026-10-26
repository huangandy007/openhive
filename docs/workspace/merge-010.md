# 主检出操作提示词 · 合并 010-governance-console

> **一次性 runbook**（2026-10-26 写于 010 工作台）。做完即失效，留在 `docs/workspace/` 备查。
> 通用模板**不重抄**：SOP 是 [`feature-delivery-sop.md`](./feature-delivery-sop.md)（Phase 6 合并 + tag），
> 上一份逐条 runbook 是 [`merge-009-open-010.md`](./merge-009-open-010.md)——**它那些「为什么」仍然成立**，
> 本文件只写 **010 与它不同的地方** ＋ 本次的取数与判据（`LEARNINGS #002-06`：同一件事不写两份）。
>
> ℹ️ 命名：前四次是 `merge-<本格>-open-<下一格>`。本次**下一格还没定**（001–010 已做完，横向铺开由用户裁定），
> 故文件名退成 `merge-010.md`。

## 0.0 · 给主检出会话的提示词（复制这个代码块，粘贴到新会话）

```
【任务】在主检出 D:\project\study\openhive\openhive 执行「010 合并」。

第一步：先读完这两份，再动手：
  D:\project\study\openhive\openhive\.claude\worktrees\feat-010-governance-console\docs\workspace\merge-010.md   （本次）
  D:\project\study\openhive\openhive\.claude\worktrees\feat-010-governance-console\docs\workspace\merge-009-open-010.md （上模板）

然后照本文件 Step A → Step E 逐步执行，每一步达标才走下一步：
  A 合并前体检（站位 / 工作区干净 / ff-only 可行性 / 取数）
  B 在【multi-tenant】分支上 git merge --ff-only worktree-feat-010-governance-console
  B1 合并后 bun install --frozen-lockfile（010 给 packages/opencode 新增了一条 workspace devDependency）
  C git push origin multi-tenant
  D git tag -a v0.1.0-010-governance-console ... 然后 git push origin v0.1.0-010-governance-console
  E 合并后验证（逐条给结论）

红线（与 009 那份逐字相同，没有任何例外）：
- 任何一步不达判据 ⇒ 停下来报告，不要「想办法让它过」。
- 全程禁止：--force / -f / -X / --no-ff / reset --hard / rebase / checkout -- / clean / stash / --no-verify。
  （唯一允许的 `checkout --` 是还原 bun.lock 的【镜像源污染】，判据见 B1。）
- 本次不写产品码、不改任何文件；不做任何 git add。
- ⚠️ bun.lock 本次有【真实改动】（1 行 workspace 依赖），别当污染还原。
- git push 会触发 .husky/pre-push 的 bun typecheck，红了先做 node_modules 链接差集，绝不 --no-verify。
- 不把 upstream 掺进来；不动 oh-mut / 007 / file-archive-download 的工作台与分支；不跑 git worktree prune。
- 不删任何历史工作台与分支；specs 目录永不删除。
- ⚠️ 合并落点分支必须显式是 multi-tenant。

最后按本文件 Step E 末尾的固定格式汇报。
```

---

## 0 · 本次是什么、与 009 的差别

010「治理后台」：在 009 的资产治理之上补齐**管理员控制台**——顶栏入口、全屏骨架、8 个板块
（账号管理 / 组织树 / AI 资产治理 / 用量成本 / 审计日志 / 数据源 / 模板库 / 数据项目权限），
后端补 `is_admin` ＋ RBAC 权限矩阵（`0013_governance.sql`）、审计底座（写动作与拒绝留痕）、
分析库增量抽取；收尾补了**真栈局部联调**（治理入口 → 账号页 → 真 PG）与**全量 axe 审计**。

| # | 目标 | 判据（唯一权威） |
|---|---|---|
| 1 | 010 进 `multi-tenant` | `git merge-base --is-ancestor worktree-feat-010-governance-console multi-tenant; echo $?` = **0** |
| 2 | 主线与 tag 进 `origin` | `git ls-remote origin refs/heads/multi-tenant refs/tags/v0.1.0-010-governance-console` **两条都在** |
| 3 | 主检出依赖到位 | `ls -la packages/opencode/node_modules/@opencode-ai/asset-service` **有链接** |

### 与 009 的三处实质差别

1. **tag 尚不存在**。`git tag -l 'v0.1.0-*'` 实测（2026-10-26）：`platform-foundation / 002 / 003 /
   004 / 005 / 006 / 009 / beta1..3`——**没有 010**。⇒ 合并后**新建**，全程不需要 `git tag -f`。
   （007 / 008 仍无 tag，本次**不补**。）

2. **没有新 workspace 包，但 `bun.lock` 仍有 1 行真实改动**。010 把已在 009 建好的
   `@opencode-ai/asset-service` 加进了 `packages/opencode` 的 **devDependencies**（治理 MCP 的
   验收测试要用它）。⇒ 合并后 `bun.lock` 的 diff 就是那一行；`bun install --frozen-lockfile` 必须跑，
   它只建链接、不重写锁文件。**别把这一行当镜像污染还原掉。**

3. **010 的定制面**（将来同步 upstream 时要**保留本地侧**；前两行才是**上游文件**，其余是本项目自有的改造点）：

   | 落点 | 改了什么 | 为什么是要保留的定制 |
   |---|---|---|
   | `packages/ui/src/v2/components/badge-v2.css` | accent 标签字色 `text-text-contrast` → `text-text-base` | 白字压品牌金底 axe 实测 3.18:1，低于 4.5:1 |
   | `packages/app/playwright.config.ts` | `testIgnore` 增加 `real-stack/**` | 真栈 spec 有独立配置，混进 mock 门禁必红 |
   | `packages/core/src/access/rbac.ts`、`packages/opencode/src/server/openhive/{gateway,archive}.ts` | 治理出口与审计留痕接线 | 010 的能力面 |
   | `packages/app/src/topbar/{topbar-connected,user-menu-actions}.ts(x)` | 顶栏「用户管理」入口（`adminOnly`） | 010 的唯一用户入口 |

   其余是**新增目录**：`packages/app/src/governance/`、`packages/auth/src/migrations/0013~0017_*`
   （5 组 up/down）、`packages/opencode/src/server/openhive/governance-*.ts`（9 个出口文件）及其测试。

---

## Step A · 合并前体检

与 `merge-009-open-010.md` 的 **Step A（A1–A4）逐条同形**，照抄那里的命令与判据，这里只记当天的取数：

- A1 站位：`git branch --show-current` 必须**逐字**是 `multi-tenant`（主检出那条 `git worktree list` 排第一）。
  2026-10-26 实测：主检出 `1a9fd75d35 [multi-tenant]`。**不是就停下报告**，别自己切分支。
- A2 干净：`git status --porcelain` 期望**空**。例外只有 009 那份列的两类（` T` 符号链接伪文件、
  空 diff 的陈旧 ` M`）。
- A3 快进可行性（**本次最要紧**）：

  ```bash
  git merge-base --is-ancestor multi-tenant worktree-feat-010-governance-console; echo "EXIT=$?"
  ```

  2026-10-26 实测 **EXIT=0**（领先 24 个提交——**本文件自己这一条提交后是 25**；落后 **0**）。
  `EXIT≠0` ⇒ 本次不是快进 ⇒ **停下报告**，**不要**改用 `--no-ff`。
- A4 取数（只记不判）：`git rev-parse --short multi-tenant` / `... worktree-feat-010-governance-console` /
  `git rev-list --count multi-tenant..worktree-feat-010-governance-console`（实测 **24**，含本文件后 **25**）/
  `git diff --stat multi-tenant..HEAD | tail -1`（实测 `143 files changed, 29003 insertions(+), 137 deletions(-)`）/
  `git ls-remote origin refs/heads/multi-tenant`。
  ⚠️ 这些数字是**当天快照**，会漂——**判红绿只认命令，不认本文件里的数**。

---

## Step B · 合并（**在 `multi-tenant` 上**）

```bash
git merge --ff-only worktree-feat-010-governance-console
```

判据：退出码 0，`git log --oneline -1` = 010 分支 HEAD。
失败即停（`Not possible to fast-forward` / `CONFLICT` / 提示要建 merge commit / local changes would be
overwritten ⇒ 一律**停下报告**，不 abort 重试、不换 `--no-ff`）。

## Step B1 · 补依赖

```bash
bun install --frozen-lockfile
git diff --stat bun.lock                                   # 必须为【空】
ls -la packages/opencode/node_modules/@opencode-ai/asset-service   # 期望一条链接
```

`git diff --stat bun.lock` 非空 ⇒ 那是 `~/.npmrc` 镜像源污染，`git checkout -- bun.lock` 还原后复查。
`postinstall` 的 `fix-node-pty` 报错 ⇒ **停下报告**。

## Step C · 推送主线

```bash
git push origin multi-tenant
```

禁止任何 force / `--no-verify`。pre-push 会跑全仓 `bun typecheck`：红了**先做 node_modules 链接差集**
（`ls -la packages/*/node_modules/@opencode-ai/`，含新加的 `asset-service`），别照回声改业务代码
（`LEARNINGS #003-06`）。被拒（non-fast-forward）⇒ 停下报告。

## Step D · tag

```bash
git tag -a v0.1.0-010-governance-console -m "010-governance-console 收尾（治理后台 8 板块 + is_admin/RBAC 权限矩阵 + 审计底座 + 用量成本看板；真栈联调与 axe 全绿，缺口见 state.md）"
git rev-parse --short HEAD
git rev-parse --short 'v0.1.0-010-governance-console^{commit}'   # 两行【相同】才算对
git push origin v0.1.0-010-governance-console
```

## Step E · 合并后验证（逐条给结论）

```bash
git merge-base --is-ancestor worktree-feat-010-governance-console multi-tenant; echo "EXIT=$?"   # 0
git branch --show-current                                                                        # multi-tenant
git status --porcelain                                                                           # 空
git ls-remote origin refs/heads/multi-tenant refs/tags/v0.1.0-010-governance-console              # 两条
ls -d packages/app/src/governance
ls packages/auth/src/migrations/00{13,14,15,16,17}_*.sql | wc -l        # 期望 10（5 组 up/down）
grep -n '@opencode-ai/asset-service' packages/opencode/package.json
```

固定报告格式：

```
① 合并：multi-tenant <合并前 sha> → <合并后 sha>；--ff-only <成功/失败>；快进 <N> 个提交
② 依赖：bun install --frozen-lockfile <已跑/未跑>；asset-service 链接 <到位/缺>；bun.lock diff <空/非空>
③ 推送：origin/multi-tenant <成功/被拒>；pre-push typecheck <过/红→结论>；
        tag <新建 sha>；origin tag <成功/被拒>
④ 验证：<逐条 EXIT / 命中行>
⑤ 命中「停下报告」的项：<无 / 列出>
```

---

## 附 · 本次**不要**做的事

- ❌ 不在主检出写产品码、不改任何文件（主线只前进一格）。
- ❌ 不把 `bun.lock` 那一行（`@opencode-ai/asset-service`）当污染还原。
- ❌ 不删 010 与任何历史工作台 / 分支；不跑 `git worktree prune`；不动 oh-mut / 007 / file-archive-download。
- ❌ 不在主检出跑 `bun test`（根目录被脚本强制 `exit 1`）。
- ❌ 不把 `upstream` 掺进来。
- ❌ 不去「修」010 `state.md` 里记的待裁定项（浅色低对比 token、`file-tree.tsx` 疑似同类）——
  那两条是**设计裁定**，合并动作不碰它们。

## 附 · 交给下一格的挂账（合并不处理，但别丢）

1. `docs/superpowers/specs/010-governance-console/state.md` 的「收尾补测」节：
   ② 浅色主题低对比 token（`state-fg-warning` 2.39:1 / `state-fg-success` 4.25:1 / `text-faint` 13px）；
   ③ `file-tree.tsx` 的 `<mark class="bg-transparent text-v2-text-text-contrast">` 疑似白字压浅底。
2. 009 那份 `merge-009-open-010.md` F6 的两条对比度裁定（dark 选中态、`text-faint`）**仍未定**。
3. 010 的真栈联调只做了 **S1 切片**（入口 → 账号管理页）；其余 7 个页面同构但**未上真栈**，
   逐页清单见收尾测试路由报告。
