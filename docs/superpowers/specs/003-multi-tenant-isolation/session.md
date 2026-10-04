# 会话交接 · 多用户隔离

## 状态：✅ 已完成（2026-10-04 · 合并 + 打 tag + 推送均已执行）

**本文件没有「下一步」了**——下面记的是**已经做过的事**，留在这里供后来的人核对。

## 上次做到哪

**Step 5（代码审查）走完两轮，已到 0 缺陷；代码冻结在最终提交 `512ee3c62d` 上。**

- 第一轮：审出 **35 条存活**（编号 **R-01…R-32**，⚠️ 存活数与编号数不是同一本账，**不存在
  R-33/34/35**），按裁定「修代码 + 清文档，越界的只登记」全部落地。
- 第二轮：把**修复本身**再当靶子打一轮（5 片并行 + 对抗证伪），抓到 **R2-01…R2-05**，逐条修完，
  各带 RED 与变异验证。
- 收尾门禁全部真跑过（数见 `state.md` 的「当前任务」与「最后更新」两节，**别抄旧数**）。

## 收尾动作的执行记录（均已执行，2026-10-04）

| 动作 | 结果 |
|---|---|
| `git merge --ff-only worktree-feat-003-multi-tenant-isolation` | ✅ 003 的最终提交已进 `multi-tenant`。取数：`git merge-base --is-ancestor worktree-feat-003-multi-tenant-isolation multi-tenant`（退出码 0） |
| `git tag v0.1.0-003-multi-tenant-isolation` | ✅ 已打并推送。⚠️ **位置比 003 分支尖端早 2 个提交**——其后是 `docs(workspace)` 的步骤手册与 `docs(003)` 的两条 LEARNINGS（取数：`git log --oneline v0.1.0-003-multi-tenant-isolation..worktree-feat-003-multi-tenant-isolation`）。**代码全在 tag 内，缺的只是文档**；已推送的 tag 刻意不移动（移动会给所有 clone 留歧义） |
| `git push origin multi-tenant` + tag | ✅ |
| 合并前那三件事（R-15 多做的 `packages/auth/src/migrations/README.md`、两个新增文件、`.playwright-mcp/` 不进提交） | ✅ 已按 `state.md`「当前任务」顶部执行 |

## 合并之后（第 1 条已做，其余仍欠着）

1. ✅ **`LEARNINGS.md` 已补两条**：`#003-06`（同一提交在两处检出一红一绿 ⇒ 先怀疑环境）、
   `#003-07`（PowerShell 重定向写出 UTF-16LE）。原列的另外三个素材此前已各自有落点：
   「同判据两处各写一份」→ `#003-05`、「并行跑门禁造假红」→ `#003-01`、
   「5 秒超时带与首次 spawn `rg.exe`」→ 写在 `state.md` 的缺口表里，未单独立条目。
2. **`docs/workspace/deploy-todo.md` 是交接物**：**D-01…D-12** 是**部署侧**的欠账，上线前逐条过。
   其中三条**不是「配一下就好」**，别当普通配置项读：**D-05**（撤销引导变量后，新迁移**没人应用**）、
   **D-09**（Cookie 的 `Secure` **代码侧没有任何开关能打开**，要先补开关）——这两条本表自己标了
   「与 D-05 同型」；**D-06**（归档**能力**已交付，缺的是**运行者**，仓库里没有调度基础设施）。
   其余是配额 / 非 root / 限速 / `lock_timeout` / 隔离级别等。
   > ⚠️ 凭证吊销表、登录页纹理、登出入口这些**在 `state.md` 的缺口表里**（不在 deploy-todo），
   > 两处别混读。
3. ⚠️ **`state.md`「阻塞项」里是九条待裁，不是两条**（这里原先写错了；R-17 / R-18 只是其中
   第 5、6 条）。其中**第 3 条「谁在生产里跑迁移」会在 004 的 T004 变成硬阻塞**——
   004 要建的 RBAC 表正是「新迁移」，而撤掉引导变量后没人应用它。
   **取数以 `state.md`「阻塞项」为准，别抄这里。**

## 禁止重新规划

`plan.md` 已定稿、`tasks.md` 已锁定且全部勾选。**不要 re-plan**；
要改的是**部署侧欠账**与**「阻塞项」里那九条待裁**，它们都有明确落点。

## 交给 004 的三句（`004-access-control`，2026-10-04 补）

- 004 的地基是**上游同步之后**的 `multi-tenant`（同日合入 `upstream/dev`，前进 150 个提交），
  **不是本工作台**。本工作台可删；**分支名 `worktree-feat-003-multi-tenant-isolation` 要留着**——
  `docs/workspace/dev_tdd.004.md` 的 0.3 检查引用的就是它。⚠️ 因此**别往这个分支上补提交**，
  它一往前挪，那道检查就会假报「003 未合入」。
- **003 的门禁数字（`state.md` 里那些）是「同步前」的基线**，004 必须按同步后的代码重测
  （`dev_tdd.004.md` 的 Step 0）。
- `dev_tdd.004.md` Step 0.5 的生死前提，2026-10-04 复核：**D0-2 仍成立**——上游那 150 个提交对
  `packages/core/src/tool/` 与 `packages/core/src/database/` **零改动**（取数：
  `git diff --name-only worktree-feat-003-multi-tenant-isolation multi-tenant -- packages/core/src/tool/ packages/core/src/database/`）。
  另：**D0-1（穷举工具执行的挂载点）与上面阻塞项第 5 条 R-17 是同一件事**，建议 004 的 T001 一并裁掉。
  但上游这次改了 `packages/opencode/src/server/routes/instance/httpapi/middleware/error.ts`，
  **那正是 003 落点所在的目录**（003 在那里新增了 3 个文件）——004 的守卫若也挂这里，冲突面提前记一笔。
