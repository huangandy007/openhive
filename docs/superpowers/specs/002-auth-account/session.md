# 会话交接 · 认证与账号（002-auth-account）

## 状态：已完成，待合并（2026-09-29）

**T001–T018 全部落地**（16 条任务；T010/T012 已按裁定移出到 003）；收尾补测（`backend-testing`
六步走完步骤 0–4）与**四轮代码评审**均已完成。
分支 `worktree-feat-002-auth-account`，合并前 HEAD 见文末。

## 合并怎么做（要人工在另一个检出里跑）

本 worktree **推不了 `multi-tenant`**：该分支正被主检出占用，且 `receive.denyCurrentBranch`
未设 → 默认 `refuse`。在 `D:\project\study\openhive\openhive`（主检出）里跑：

```bash
git merge --ff-only worktree-feat-002-auth-account
```

**已核验**：`multi-tenant` 是该分支 HEAD 的**祖先**（`git merge-base --is-ancestor` 退出码 0），
落后 0——纯快进、零冲突。待合入的提交**全部**是 002 的（T001–T018 + 评审修复 + 文档），无夹带。

条数**不写死**（本文件先前写「28 个」是错的，实测 31——正是 LEARNINGS `#002-06` 那类不实记述）。
要准数自己数：

```bash
git rev-list --count multi-tenant..worktree-feat-002-auth-account
```

## 门禁（合并前最后一次实测）

| 门 | 实测值 |
|---|---|
| `cd packages/auth && bun test` | **149 pass / 0 fail**（13 文件） |
| `cd packages/auth && bunx tsgo --noEmit` | **exit 0**（直接跑，确认不绿在 turbo 缓存里） |
| `bun run typecheck`（根） | 31/31 |
| `bunx oxlint -c script/oxlintrc.openhive.json packages/auth/src` | **0 warnings / 0 errors** |
| `bun.lock` 里的 `registry.npmmirror.com` | **0 行**（基线 0 → 首次污染 3226 → 峰值 3234 → 现 0） |

## 下次会话要做的事

1. **先读** `state.md` 的「收尾评审发现与处置」一节——**四轮**评审的完整处置都在那里，逐轮可查
   （第四轮一节是收口复核，0 Critical / 0 Important）。
2. **移交项在 003 的表里**，不在本文件：`003-multi-tenant-isolation/tasks.md` 的
   「002 移交的欠账」节 **T014–T024**。**T014（网关）是 T015/T016/T017/T018 的硬前置；
   T019–T024 不依赖网关，可以立刻开工。**
3. 两条**用户已裁定但尚未实现**的事，开工前先看：
   - **引导首个管理员**（003 T019）：环境变量 `OPENHIVE_BOOTSTRAP_ADMIN_POLICE_NO`，
     **仅在表里一个管理员都没有时**生效、一次性。
   - **越权 BOLA/BFLA（P0）**：002 是纯服务层，授权被刻意留给调用方，而调用方（网关）不存在，
     故只能在 003 用双身份凭证在 HTTP 层写。**这是 002 留下的唯一一条 P0 未闭合账。**
4. ⚠️ **不属于 002、但本次评审量出来的一个坏门（建议单独一轮修）**：`LEARNINGS.md` 的
   `#001-05` 留的验证配方是「`bunx oxlint -c script/oxlintrc.openhive.json --rules` 数
   Enabled? 列，**应 = 160**，少一条说明 plugins 被换过」。**实测 = 161**，配方是错的：
   根配置 `.oxlintrc.json` 实测 **131**（不是 130），+ jsx-a11y **30** = 161
   （按来源拆：eslint 60 / typescript 39 / jsx_a11y 30 / oxc 17 / unicorn 15 = 161，插件集完整）。
   后果：**照着这条验的人会看到 161，判成「插件被换过了」**，然后可能去删规则——一个防故障的
   门自己会误报。**没有在本轮改**：`#001-05` 属 001、且改它会让「本次 diff 全是 002」变成假的。
5. ⚠️ **跨 feature 语义冲突，003 开工前必须先裁定**：003 spec 的 FR-002 要求「网关**验签**注入、
   用户不可伪造」，而 002 落地的 `X-User-ID` 是**明文头**、`user-identity.ts` 顶部明写「不是凭证」。

## 禁止重新规划

`plan.md` 已定稿、`tasks.md` 已锁定。002 本身没有剩余工作。

## 合并前 HEAD

**本文件不写死哈希**——写死了就会过期（本 feature 的行号引用已经因此漂过三次，
见 LEARNINGS `#002-06`）。要合并时取：

```bash
git log -1 --format=%H worktree-feat-002-auth-account
```
